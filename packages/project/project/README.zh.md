---
description: "持久项目与任务看板（ctx.projects），供选择、挂载或排障 project 存储领域、其比较并交换修订与依赖规则的宿主方阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-project

[English](README.md) | 中文

## 概述

`dsh-project` 维护一份持久的项目与任务看板，使工作能够超出一个 agent（智能体）会话的寿命。每个项目是 `project` 存储领域中一条经 schema 校验的记录，内含自己的任务；每次变更都携带调用方最后读到的修订号，因此过期编辑会被拒绝，而不会静默覆盖另一个会话的改动。存储在写入前校验标题、依赖边以及"状态与阻塞者"的一致性。它是宿主侧状态：不注册工具、不注入提示词、不写会话事件，因此在诸如 `dsh-tool-project` 之类的消费者读取之前，什么都不会到达模型。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当工作必须比发起它的会话活得更久时使用本包：部署希望每个工作目录有一份看板，其任务在重启后仍保留状态、依赖与被关联的会话，并且该目录下的多个会话共享这份看板。

### 何时选择它

为持久且共享的规划状态选择它。为一个会话的工作记忆则避免使用它——那由 `todo_write` 拥有；当多个进程必须协同工作时也避免使用它：本存储是单进程的持久记录，第二个 harness 实例只有在重新读取介质之后才能看到写入。

### 最小组合

存储通过 `ctx.storageDomain` 打开 `project` 领域，因此必须在它旁边挂载存储中枢、一个后端以及领域形式：

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/data
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-project'
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxTasksPerProject` | `256` | 单个项目可容纳的最大任务数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-project)是受支持字段的详尽来源。

### 存储对外提供什么

`ctx.projects` 返回分离的视图：`ProjectView` 携带身份、标题、状态、工作区、修订号以及按创建顺序排列的全部任务，每个 `TaskView` 携带任务的身份、标题、状态、依赖与已关联会话。`board()` 追加读者需要的排布：`columns` 按状态对任务分组，`ready` 列出阻塞者均已完成的 `todo` 任务，`stranded` 列出仍有未完成阻塞者的 `doing` 任务。

### 比较并交换修订

每次变更都接收一个 `ProjectRef`——项目 id 加上调用方最后观察到的修订号。以更旧修订号提交的变更会被 `project/stale-version` 拒绝，调用方重新读取后重试。不改变任何内容的请求（重复关联同一会话）保留已存记录且不递增修订号，因此空操作绝不会使另一个调用方的令牌失效。

### 校验规则

- 标题会被去除首尾空白，必须非空且不超过 200 个字符。
- `blockedBy` 必须命名同一项目中存在的任务，不能命名任务自身，也不能在任务之间形成环。
- 当任务所阻塞依赖的任一任务尚未完成时，该任务不能变为 `doing` 或 `done`；除非至少有一个阻塞者未完成，它也不能变为 `blocked`。
- 输入与依赖校验先于容量检查执行，因此提交不可用标题或未知依赖的调用方得到的是前者，而不是"项目恰好满了"。
- 已关闭的项目以 `project/closed` 拒绝一切任务操作。

### 失败

| 代码 | 含义 |
|---|---|
| `project/not-found` | 没有记录携带该身份，或存储尚未初始化 |
| `project/stale-version` | 提交的修订号比已存修订号更旧 |
| `project/closed` | 项目已关闭并拒绝任务工作 |
| `project/unknown-task` | 引用的任务在本项目中不存在 |
| `project/dependency-cycle` | 请求的依赖会让任务到达自身 |
| `project/invalid-input` | 标题为空或过长，或状态与阻塞者状态矛盾 |
| `project/limit-exceeded` | 项目已持有 `maxTasksPerProject` 个任务 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释存储背后的设计决策并指向实现它们的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

任务存放在其项目记录内部，而不是各自独立的表中。因此一次持久写入同时携带任务变更与它递增的修订号，比较并交换令牌也绝不会与它所属的任务列表不一致。其余部分由领域形式提供：持久边界上的 schema 校验、来自权威内存状态的同步读取，以及每个领域一条有序写入链。

### 源码分布

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`ProjectStore` 服务、`Config`、领域打开，以及唯一的 `mutate` 写入路径 |
| [`src/board.ts`](src/board.ts) | 纯派生与校验：标题、任务 id、依赖无环、状态规则、看板排布 |
| [`src/spec.ts`](src/spec.ts) | 领域声明：记录 schema、`defineDomain` spec、版本 |
| [`src/errors.ts`](src/errors.ts) | `ProjectError` 与稳定的 `ProjectErrorCode` 集合 |
| [`src/types.ts`](src/types.ts) | 公共视图、过滤器，以及带品牌标记的 `ProjectId` 与 `TaskId` |

### 持久形态

领域是 `project`，版本 1，含一张以随机 uuid 为键的 `projects` 表。一条记录持有 `title`、`status`、可选的 `workspace`、`createdAt`、`updatedAt`、`revision` 以及 `tasks` 数组；一条存储的任务持有 `id`、`title`、`status`、`blockedBy`、`sessionIds` 及其时间戳。删除记录会连同该项目的任务一起删除，这正是该领域成为任务状态唯一拥有者的原因。任务 id 按项目已有编号任务的最大值之后分配为 `task-<n>`，因此创建顺序在重新加载后依然保留。

### 先校验，后持久化

存储执行的每条规则都以纯函数形式存在于 `board.ts`，因此无需存储后端即可检验，而存储剩下的职责只有持久化与比较并交换写入。`ProjectStore.mutate` 读取已存记录，拒绝缺失项目与过期修订号，随后在 `table.update` 的链槽位内再次检查修订号，因此两个针对同一修订号竞争的变更不可能同时落地。当请求不改变任何内容时，变换函数返回 `undefined`，此时存储保留已存记录——不递增修订号，也不为一次没有改变任何内容的写入发出变更事件。

### 生命周期

`Service.init` 打开领域并保留其表句柄；领域关闭注册为同一 fiber 上的副作用。在该初始化完成之前，`ctx.projects` 存在，但每个操作都会以 `project/not-found` 与"not initialized"消息响亮失败，而不是读取一张不存在的表。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从持久领域走向其消费者以及其下的存储层。

- [项目子系统](../../../docs/subsystems/project.zh.md)——视图、错误码与生成的 `ctx.projects` API 的权威契约。
- [project 组地图](../README.zh.md)——同级组页面及其包表。
- [存储子系统](../../../docs/subsystems/storage.zh.md)——本存储在其上打开领域形式的领域数据形式。
- [tool-project 包](../tool-project/README.zh.md)——本存储面向模型的消费者。

-----

<a id="model-experience"></a>
## 模型体验

### 项目记录与任务视图

#### 模型看到什么

什么都没有。`ctx.projects` 只服务宿主侧消费者：本包不注册工具、不注入提示词、不写会话事件，因此任何请求字段都不会携带本包的数据。模型只会在诸如 [`dsh-tool-project`](../tool-project/README.zh.md) 之类的消费者把项目状态作为已记录的工具结果返回时看到它。

#### Token 影响

每个请求零直接 token。

#### KV Cache 影响

无；本包从不组装或发送 provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本存储何时不适合使用。它们是当前的包约束，不是任务清单。

- **单一进程拥有持久记录**——没有跨进程变更推送，因此第二个 harness 实例只有在重新读取介质之后才能看到写入；本存储也不派生自己的缓存，所以每次读取都直接服务领域的权威内存状态。
- **项目按工作目录字符串匹配**——项目的 `workspace` 是创建时记录的规范路径并按字符串相等比较，而不是 workspace registry 的 id，因此重命名或移动该目录后这条路径就不再匹配。
- **`list` 按创建时间从新到旧**——同一毫秒的并列项保留稳定的插入顺序，而不是某个具名的次级键；过滤器也只提供工作区与已关闭项目两种选择。
- **没有历史，也没有归属**——一条记录只持有当前任务状态：没有逐任务或逐变更的历史，没有多用户归属，除 `createdAt` 与 `updatedAt` 之外也没有审计线索。
- **没有外部看板同步**——不会读写 GitHub、Jira 或任何其他 issue tracker；该领域是这份看板的唯一拥有者。
- **尚无模型可见的上下文段落**——把已关联项目的状态放入请求的 `project-context` 插件被推迟；在它落地之前，模型只能通过调用消费者的工具了解看板。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随检查。存储执行的每条规则都在领域写入之前的进程内运行，而领域形式已经拥有它所依赖的持久关系——经 schema 校验的记录与每次落地写入对应一个 `domain/changed`——因此独立的伴随检查只会重跑那些写入，而不会观察到本包尚未检查的关系。承重规则（修订号单调、依赖无环、状态与阻塞者一致）由本包的 spec 在真实存储组合上证明。
