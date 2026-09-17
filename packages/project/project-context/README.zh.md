---
description: "Request-context note telling the model which durable project-board tasks this session is linked to, for users and maintainers of the project board."
kind: "package-reference"
---

# @deepseek-ai/dsh-project-context

[English](README.md) | 中文

## 概述

`dsh-project-context` 把当前会话关联到哪些持久看板任务告诉模型。看板比创建它的会话活得更久，因此另一个会话把本会话关联到某个任务时，如果模型不去调用 [`project` 工具](../tool-project/README.zh.md)，该关联就是不可见的。本条说明在请求时从 `ctx.projects` 推导，受配置上界约束，并且每种看板状态只注入一次：看板未变时保持沉默，而重新读取同一看板的刷新或 fork 会再次读到同一条说明。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在任何希望会话不花一次调用就得知自己看板关联的组合里，把它与 [`dsh-project`](../project/README.zh.md) 一起挂载；正式提供的 `dsh-base` bundle 两者都挂载。它注册一个 `agent/pre-step` 监听器，不增加工具、不增加提示词段，最多列出 `maxTasksListed` 个任务（默认 8）。

说明按存储顺序上报 `sessionIds` 中含本会话的任务：项目按最新在前，任务按创建顺序。每行带有任务 id、标题、状态、所属项目标题与 revision，以及它的阻塞项，因此模型在写入之前就拿到了变更必须携带的 revision。

<a id="understand-the-implementation"></a>
## 理解实现

`linkedTasks(projects, session)` 读取存储的默认列表——会话的 `header.cwd` 成为 `workspace` 过滤条件，没有工作目录的会话读取整个未关闭存储——并保留 `sessionIds` 含本会话的任务。已关闭项目被排除，与存储自身的列表默认不向读者展示它们的规则完全一致。

`renderNote(entries, maxTasksListed)` 渲染标题行、每个被列出任务一行，以及在上界截断列表时的一行 `- N further linked task(s) are not listed.`；空列表返回 undefined。

监听器以 `{ prepend: true }` 挂在 `agent/pre-step` waterfall 上：它先 `await next()`，当该决定是 `reject` 或本次调用信号已中止时原样返回该决定，否则追加一条插件来源的消息。仅当文本与本节实例上次发送的说明不同时才发送，因此看板未变时不产生任何开销。该消息携带 `source.kind === 'plugin'`、本插件名，以及 `form: 'snapshot'`，其 section 文本与发送内容一致，因此会话日志记录下模型读到的内容。

<a id="further-exploration"></a>
## 延伸阅读

- [项目子系统](../../../docs/subsystems/project.zh.md) —— 说明每一行背后的存储契约、看板视图与 revision 规则。
- [project 组映射](../README.zh.md) —— 存储、模型的写入路径、`/project` 命令与本说明。
- [change-review-context](../../context/change-review-context/README.zh.md) —— 同族的 pre-step 说明，上报的是读者决定而不是看板关联。

<a id="model-experience"></a>
## 模型体验

### 看板关联任务

#### 模型看到什么

一条追加到请求中的 user 角色消息；当会话没有关联任务，或看板渲染出的说明与上次发送的相同，则不注入任何内容：

##### 项目说明

```markdown
This session is linked to tasks on the durable project board:
- Task `task-1` "cut branch" is todo in project "Release" (revision 4).
- Task `task-2` "write notes" is todo in project "Release" (revision 4, blocked by task-1).
```

#### Token 影响

最多 `maxTasksListed` 行加一行余数，每种不同的看板状态只发送一次而不是每步发送；没有移动过的看板不会给请求增加任何内容。

#### KV Cache 影响

仅追加：该说明接在可复用前缀之后进入请求，因此它延长历史而不是改变已缓存的部分。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只上报点名本会话的任务**——说明只包含 `sessionIds` 中含本会话的任务；看板不会推送，且当会话有工作目录时，本插件不读取该目录之外的内容。
- **文本不变时不重复**——渲染结果相同的看板变化（例如重新评定，或所列出字段不承载的编辑）保持沉默，直到渲染文本发生变化。
- **是快照，绝不是写入**——说明表述请求时刻的看板并携带变更必须携带的 revision；本插件不写入任何内容，因此并发写入者仍按 revision 胜出。
- **没有工作目录的会话读取整个未关闭存储**——工作区过滤条件就是会话的 `cwd`，因此没有该字段的会话会看到每一个未关闭项目。
- **已关闭项目不上报**——它们离开了存储的默认列表，因此即使任务的 `sessionIds` 仍然点名本会话，该任务也不再出现。
- **上界不是分页**——`maxTasksListed` 截断列表并说明余数；没有游标，也没有第二页。
- **去重守卫在内存中**——重启、刷新或 fork 会重新读取同一看板并再次发送同一条说明。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。该包不拥有任何持久状态，也不拥有任何可由独立观测产生分歧的关系——它在请求时读取存储并注入一条派生消息——因此其测试规范钉住的是关联选择、渲染与注入规则。
