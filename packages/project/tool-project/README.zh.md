---
description: "面向模型的项目工具，作用于持久项目看板：一个工具，含 list/create/read/add_task/update_task/link_session 动作，供选择、配置或排障它的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-project

[English](README.md) | 中文

## 概述

`dsh-tool-project` 给 agent（智能体）一个用于"必须超出一个会话寿命"的工作的工具：列出本工作目录中的项目、创建一个、读取其泳道、增改任务，并把调用会话关联到某个任务。看板是 [`dsh-project`](../project/README.zh.md) 拥有的宿主侧持久状态，由同一目录下的每个会话共享，因此计划能在重启与交接后存活。每次变更都携带模型最后读到的修订号，这意味着过期编辑会被拒绝，而不是覆盖另一个会话的改动；每个结果都受配置约束。

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

当部署希望 agent 维护持久且共享的任务状态时使用本包：一份比单个会话活得更久、并由同目录的下一个会话接着推进的计划。把它挂载到它所读取的存储旁边。

### 何时选择它

为"工作赖以存活"的那份看板选择它。会话自身的工作记忆仍属于 [`dsh-tool-todo`](../../todo/tool-todo/README.zh.md)：`todo_write` 是 agent 可自由重写的整表替换，而本工具修改的是其他会话同样会读取的持久记录。当 agent 既要规划本会话又要跟踪周边工作时，两者都挂载；当持久看板本身就是目的时，只挂载本包即可。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/data
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-project'
- name: '@deepseek-ai/dsh-tool-project'
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxProjectsListed` | `20` | 单次 `list` 结果最多携带的项目数 |
| `maxTasksListed` | `50` | 单次 `read` 结果跨所有泳道最多携带的任务数 |
| `maxTitleLength` | `120` | 结果中单个项目或任务标题的最大字符数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-project)是受支持字段的详尽来源。

### 各动作做什么

| 动作 | 参数 | 结果 |
|---|---|---|
| `list` | `include_closed?` | 有界的项目摘要；`truncated` 表示触达了上界 |
| `create` | `title` | 新项目的 `id`、`revision` 与摘要 |
| `read` | `project_id` | 有界看板：泳道、`ready` 与 `stranded` 任务 id、任务行、`truncated` |
| `add_task` | `project_id`、`revision`、`title`、`blocked_by?` | 项目摘要与新的 `revision` |
| `update_task` | `project_id`、`revision`、`task_id`、`title?`、`status?`、`blocked_by?` | 项目摘要与新的 `revision` |
| `link_session` | `project_id`、`revision`、`task_id` | 项目摘要与新的 `revision` |

`blocked_by` 是该任务的完整依赖列表，而不是往其上追加。工作区来自调用会话的工作目录：`create` 记录它，`list` 按它过滤，因此没有工作目录的会话会创建一个未限定工作区的项目，任何按工作区过滤的列表都不会返回它。

### 修订契约

每次变更都需要对该项目上一次读取返回的 `revision`。以更旧修订号提交的变更会被拒绝——工具会报告项目已前移——模型重新读取后重试。由于记录是共享的，第二个会话编辑同一项目时得到的正是这种拒绝，而不是静默覆盖；落败的那次编辑必须重新读取并重新应用。

### 模型会看到的失败

缺失参数会被点名（`title is required for this action`、`revision is required for this action`），未知 id 会连同能找到它的动作一起报告（`no project <id> exists; use action "list" to find one`、`no task <id> exists in this project`），而存储自身的规则以其消息呈现：标题为空或过长、依赖未知、自依赖或成环、状态与阻塞者状态矛盾、触达任务上界、项目已关闭，或修订号过期。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释工具背后的设计决策并指向实现它们的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

本工具是 [`ctx.projects`](../project/README.zh.md) 之上的一层轻薄且有界的适配器。它拥有存储刻意不拥有的四件事：模型书写的参数语法、施加于每个结果的上界、参数名到存储调用的映射，以及展示卡片。它不拥有任何状态，因此重启不会改变看板的内容。

### 源码分布

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、动作分发、结果上界、工具注册、展示器 |

### 导出形态

本插件是函数／命名空间插件：导出 `name`、`inject`、`Config`、`apply`，没有默认导出。多余的 `export default` 会让 Loader 的 `unwrapExports` 折叠模块并丢弃 `inject`（参见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 调用方身份与工作区

`execute` 从工具执行上下文读取调用 agent：`exec.agent.session.id` 成为 `link_session` 记录下来的会话，`session.header.cwd` 成为 `create` 记录、`list` 过滤所用的工作区。没有所属 agent 会话的调用既没有可关联的会话，也没有工作目录：`link_session` 会拒绝，`create` 会存储一个没有工作区的项目，其余动作仍然可用。

### 结果上界

每个列表与看板结果都会按配置上界切片，丢弃任何内容时报告 `truncated: true`；标题在 `maxTitleLength` 处用省略号截短。上界的存在使单个工具结果不会随看板增长：拥有数百个任务的项目仍返回模型读得动结果，而模型可以重新读取以看到后续切片。

### 有界结果类型

`ProjectSummary`、`TaskRow` 与 `BoardResult` 是渲染与输出 schema 唯一读取的形状；每个都是由基本类型构成的普通记录，因此面向模型的输出在存储变化时保持稳定。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从工具走向它所读取的存储，以及钉住模型所接收内容的目录。

- [项目子系统](../../../docs/subsystems/project.zh.md)——每个动作背后的存储契约，含错误码。
- [project 组地图](../README.zh.md)——同级组页面及其包表。
- [project 存储包](../project/README.zh.md)——持久存储及其依赖规则。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-project)——模型收到的确切 `project` schema。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-project)——每个受支持的界及其默认值。
- [持久项目看板 Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.zh.md)——存储及其规则背后的设计。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`project` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-project)：一个必填的 `action` 枚举，取值为 `list`、`create`、`read`、`add_task`、`update_task`、`link_session`，以及这些动作使用的可选参数 `project_id`、`revision`、`title`、`task_id`、`status`、`blocked_by`、`include_closed`。描述陈述了修订契约——每次变更都需要上一次读取返回的修订号，过期修订必须重新读取后重试——并说明 `todo_write` 持有本会话的工作，而本看板持有必须比会话活得更久的工作。

#### Token 影响

在工具可见的每个请求上产生固定的 schema 开销；给定配置下描述与 schema 是稳定的。

#### KV Cache 影响

除工具 schema 本身位于请求头部之外没有影响：在其可见性与配置不变时定义是前缀稳定的，且该工具不会追加自己的提示词内容。

### 工具调用历史与结果

#### 模型看到什么

每次调用的参数按模型书写的样子保留在 assistant 历史中，每个结果都是一条有界记录：`list` 与 `create` 返回项目摘要，`read` 返回看板，变更返回更新后的摘要与新的 `revision`。失败返回存储的消息，因此模型能知道是哪条规则拒绝了它。除普通的工具调用与结果对之外，本工具不写任何会话事件：看板位于存储领域而非日志中，因此看板变化在会话中只以造成它的那次调用出现。

#### Token 影响

结果大小受 `maxProjectsListed`、`maxTasksListed` 与 `maxTitleLength` 约束，因此增长随配置而非随看板规模变化。调用参数与结果在压缩之前一直保留。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使既有 KV-cache 条目失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定本工具何时不适合使用。它们是当前的包约束，不是任务清单。

- **截断而非分页**——触达上界的结果报告 `truncated: true` 后停止；没有游标或偏移参数，因此需要被省略行的模型重新读取时拿到的仍是同一段开头切片。
- **没有项目改名或关闭动作**——存储可以改名和关闭项目，但工具两者都不暴露，因此模型无法让一份看板退役；必须由人或另一个消费者来完成。
- **工作区限定跟随会话**——`create` 记录调用会话的工作目录，`list` 按它过滤；没有工作目录的会话创建出的项目不会被任何按工作区过滤的列表返回，而从另一个目录创建的项目对本会话的 `list` 不可见。
- **并发编辑导致拒绝而非合并**——修订契约意味着两个会话编辑同一项目时轮流进行：落败方重新读取并重新应用，且不会自动按字段合并。
- **提示词里的备注是快照而非订阅**——[`dsh-project-context`](../project-context/README.zh.md) 每次看板状态变化只报告一次本会话关联的任务，因此请求进行中发生的看板变化要到下一次请求才可见。
- **没有任务历史或归属**——`read` 显示当前任务状态；看板不保留逐任务历史、作者，也不链接外部 issue tracker。
- **面向模型的行按 profile 归属**——`dsh-base` 为无头 profile 全局挂载本工具，而 Web profile 撤回该全局行、改由 agent preset 挂载，因此会话的工具目录取决于它加入的 preset。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随检查。本工具不拥有持久状态，每个结果都派生自 `ctx.projects`，而存储在其写入之前已校验了自身规则；这里的伴随检查只能重读存储刚刚提供的同一批记录。值得钉住的行为——有界结果、在调用之间携带的修订号、调用会话与工作区进入 `link_session` 与 `create`——由本包的 spec 在真实存储组合上证明。
