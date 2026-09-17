---
description: "作用于持久项目看板的人工 /project 命令；列出本工作目录的项目或渲染某一块看板，供不消耗模型轮次即可阅读看板的用户使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-project

[English](README.md) | 中文

## 概述

`dsh-command-project` 把持久项目看板带到人这一侧的输入框。`/project` 列出本工作目录的项目及其修订号与已完成任务数；`/project <id>` 渲染某一块看板——其泳道、可以开始的任务，以及卡在未完成依赖后面的任务——都不消耗模型轮次。看板是由 [`dsh-project`](../project/README.zh.md) 拥有、由同一目录下每个会话共享的宿主侧持久状态。该命令**有意只读**：变更属于模型的 [`project` 工具](../tool-project/README.zh.md)。

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

当人需要直接阅读看板时使用本包：这里有哪些项目、各自处于什么状态、哪些工作现在可以开始。把它挂载在它所读取的存储与派发它的命令注册表旁边。

### 何时选择它

选择它是为了**读**，不是为了**改**。变更需要调用方最后读到的修订号，而这是模型的工具在多次调用之间携带的，一次裸命令调用无法提供；给命令添加写动作，要么绕过 compare-and-set 契约，要么要求人手输修订号。已发布的 `dsh-base` 组合把这套命令挂载在 [`dsh-project`](../project/README.zh.md) 与 [`dsh-tool-project`](../tool-project/README.zh.md) 旁边，因此人与模型读的是同一块看板。

### 最小组合

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/data
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-project'
- name: '@deepseek-ai/dsh-command-project'
```

### 命令语法

| 调用 | 结果 |
|---|---|
| `/project` | 调用会话所在工作目录的项目，最新的在前 |
| `/project <project-id>` | 该项目的看板 |
| `/project <id> <id>` | 被拒绝：`Name one project id, not several.` 后接用法行 |
| `/project <unknown-id>` | 被拒绝：`No project <id> exists. Run /project to list the projects of this working directory.` |

### 列表显示什么

空的工作目录会渲染 `No project exists for this working directory yet. Ask the model to create one, then run /project again.`。否则首行是 `Projects (N):`，其后每行携带项目的 id、标题、状态、修订号，以及已完成任务数占总数的比例：

```text
Projects (2):
  8f1c… · Release · active · revision 4 · tasks 3/7 finished
  2b90… · Migration · closed · revision 11 · tasks 11/11 finished
```

列表以用法行收尾，因此想看某一块看板的读者能从输出本身学到该传什么参数。

### 看板显示什么

首行给出项目、状态，以及一次变更必须携带的修订号。随后每个非空泳道一块，顺序为 `todo`、`doing`、`blocked`、`done`、`cancelled`，每个任务一行：

```text
Project 8f1c… · Release · active · revision 4
todo (2):
  [todo] task-2 second (blocked by task-1)
  [todo] task-3 third
doing (1):
  [doing] task-4 fourth (blocked by task-1)
Ready: task-3
Stranded: task-4 (a blocker is unfinished)
```

任务行只在依赖既非 `done` 也非 `cancelled` 时追加 `(blocked by …)`，因此后缀命名的正是当前真正拖住该任务的东西。没有任务的项目渲染 `  (no tasks)`。`Ready:` 列出阻塞项全部完成的 `todo` 任务，`Stranded:` 列出仍有未完成阻塞项的 `doing` 任务；某一行为空时该行不出现——这正是让"存储的状态"与"依赖图所表达的状态"之间的不一致一眼可见的原因。

### 读者会看到的失败

第二个 id 会在读取存储之前被拒绝，并指明语法（`Name one project id, not several.`）。存储不持有的 id 会给出指名列表命令的可行动句子。而完全无法作答的存储——未初始化的域、不可读的介质——会暴露其自身失败，而不是给出一份空列表。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本段解释该命令背后的设计决策，并指向实现它们的代码；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

该命令是 [`ctx.projects`](../project/README.zh.md) 与那个包已导出的看板派生之上的一个薄只读渲染层。它拥有存储所不拥有的三件事：参数语法、人读到的文本，以及工作区作用域——调用会话的工作目录。它不拥有任何状态，因此运行它不可能改变看板内容，重启也不会改变它打印的东西。

### 源码分布

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：参数语法、列表与看板渲染、调用方工作区作用域、命令注册 |

### 导出形态

该插件是函数/命名空间插件：导出 `name` / `inject` / `apply`，没有默认导出，也没有 `Config`，因为它自身没有可调项。多出一个 `export default` 会让 Loader 的 `unwrapExports` 折叠整个模块并丢掉 `inject`（见 [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

### 调用方身份与工作区

命令从调用信息读取调用方 agent：`agent.session.header.cwd` 成为列表的工作区过滤条件。没有工作目录的会话改为列出全部项目而不是一个都不列，因为这才是读者能够据以行动的结果：不带过滤的列表展示存在什么，并让读者自行显式传入 id。

### 有意只读

这棵树里每条变更路径都携带修订号。命令没有任何参数可以承载它，因此无法满足 compare-and-set 契约；添加写动作就意味着要么无保护地写入，要么让人手输修订号。模型的 [`project` 工具](../tool-project/README.zh.md) 已经在修订契约完整的前提下拥有变更能力，而看板 UI 将拥有交互式的场景。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从该命令走向它所读取的存储，以及修改它的界面。

- [项目子系统](../../../docs/subsystems/project.zh.md)——列表与看板背后的存储契约，含错误码。
- [project 组地图](../README.zh.md)——同级组页面及其包表。
- [project 存储包](../project/README.zh.md)——持久存储、其依赖规则，以及本命令所渲染的看板派生。
- [面向模型的项目工具](../tool-project/README.zh.md)——携带 compare-and-set 修订号的变更面。
- [持久项目看板 Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.zh.md)——该存储与其规则背后的设计。

-----

<a id="model-experience"></a>
## 模型体验

### 人工 `/project` 命令

#### 模型看到什么

什么都没有。该命令由人的 UI 派发，从不触达模型：它不贡献提示词段落、不贡献工具 schema、也不贡献派生历史，因此模型看到的请求与是否运行过它完全无关。它唯一写入的事件是运行时那一对 `command/run` 与 `command/done`。

#### Token 影响

对模型没有影响。渲染出的列表或看板返回给派发它的命令界面。

#### KV Cache 影响

没有影响；该命令不组装也不发送任何 provider 请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该命令不做什么。它们是当前的包约束，不是任务清单。

- **只读**——命令不能添加任务、改变状态或关闭项目；一切变更属于模型的 `project` 工具或将来的看板 UI。
- **列表跟随会话的工作目录**——它按 `agent.session.header.cwd` 过滤，因此用同一目录的另一种写法创建的项目不会出现；没有工作目录的会话则列出全部项目。
- **没有分页**——看板整体渲染，因此有数百个任务的项目会打印全部泳道；存储的任务上限是唯一的天花板。
- **标题整份打印**——命令没有 `maxTitleLength` 之类的等价项，因此存储的标题按原样渲染。
- **没有 Remote 面或看板 UI**——Web 客户端目前没有任何界面渲染看板，因此该命令与模型工具是仅有的两个读者。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。该命令不拥有状态，每一行都派生自 `ctx.projects` 与该包的 `boardOf`；这里的运行时检查只能重读存储刚刚提供过的同一批记录。值得钉住的行为——参数语法、两个渲染器、调用方的工作区作用域、拒绝文案，以及注册的生命周期——已由本包的测试在真实存储组合上证明。
