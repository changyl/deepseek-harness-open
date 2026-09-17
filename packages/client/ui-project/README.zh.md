---
description: "Web GUI 设置面板中的持久项目看板分区：一个「项目」页面读取 `project` Remote 命名空间，列出宿主存储的项目，并渲染读者打开的那一份项目的状态泳道、可开工任务与受阻任务；面向项目表面的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-project

[English](README.md) | 中文

## 概述

本包在 Web GUI 设置面板中新增「项目」页面：展示宿主上存储的持久项目看板，数据来自 `project` Remote 命名空间。列表在页面打开时读取一次，之后由「刷新」按钮触发再次读取；打开某个项目会读取它的看板。每一行携带标题、状态词，以及任务、可开工与受阻三个计数；被部署上界截断的列表会明确说明。看板展示五条状态泳道，每条任务带其依赖与会话计数，并在宿主报告了可开工或受阻任务时给出对应的 id 行。

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

在同时挂载 `project` Host 命名空间的 Web 组合中挂载本插件，设置面板就会出现「项目」页面。该页面是只读的：它列出存储中的内容，并按需读取某一份看板。创建项目、添加任务、关联会话或更改状态仍然属于模型的 `project` 工具，因为这些写入需要它携带的 compare-and-set revision。分区只持有自己的读取状态，因此它渲染的任何内容都不会比面板本身活得更久，也不涉及 store、缓存或任何持久化值。

分区挂载时读取一次列表；「刷新」按钮会在上一次读取尚未返回时发起下一次列表读取。刷新同时会关闭已打开的看板，因此页面不会把一份看板和一份可能已不再匹配它的列表并排显示。

### 页面展示什么

列表有三种状态：读取期间显示一行状态提示；读取被拒绝时显示失败提示与「刷新」按钮；否则为每个存储的项目渲染一行。一行包含作为可选控件的项目标题、本地化状态词（进行中或已关闭），以及宿主报告的任务、可开工与受阻计数。被部署上界截断的列表会在行下方渲染截断提示。

打开一个项目会读取它的看板，渲染项目标题，然后为每种状态渲染一条泳道——待办、进行中、阻塞、已完成、已取消——每条泳道按创建顺序列出该状态下的任务，并带任务标题及其依赖与会话计数。没有任务的项目会改为渲染空看板提示。当看板报告了现在就能开工的任务，或报告了阻塞项尚未完成的「进行中」任务时，页面会追加一行可开工提示与一行受阻提示，列出这些任务 id；受阻行以警告样式渲染，因为一个标记为进行中、而其依赖尚未完成的任务，是一处值得看见的分歧。

看板在每次选择时以及每次刷新后重新读取，从不就地更新。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

本插件是覆盖在一个 Remote 命名空间之上的展示层。它的 Node 半边是一个惰性的 Loader 条目；浏览器半边注册字典与一个设置分区，分区通过注入的 `list` 与 `board` 回调读取数据，而不是去获取客户端 context。Remote 调用、其请求校验、列表上界以及失败词表都属于 [Host 命名空间](../../api/project/README.zh.md)；本包只决定如何绘制答案，以及在没有答案时说什么。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Node 半边：使包拥有 Loader 条目的空 `apply` |
| [`src/client/index.ts`](src/client/index.ts) | 字典、`list` 与 `board` Remote face，以及 `settings.section` 注册 |
| [`src/client/ProjectSection.tsx`](src/client/ProjectSection.tsx) | 分区组件、其泳道顺序与任务行 |
| [`src/client/locales.ts`](src/client/locales.ts) | `settings.projects` 字典及其键类型 |
| [`src/client/ProjectSection.module.css`](src/client/ProjectSection.module.css) | 基于共享主题 token 的分区样式 |

### Slot 与注册

插件声明 `inject = ['slots', 'locale', 'remote', 'remote.project']`，在 `ctx.effect(...)` 中注册 `settings.projects` 字典，并把它们绑定到 `t` 座位。它通过 `ctx.slots.inject` 注册到 `settings.section`，因此该贡献会等待声明出现、随调用方 fiber 一起移除，并在声明方重新加载后重新建立。

注册携带 `id: 'projects'`、`order: 40`、从字典 `nav` 键读取的 `label`，以及 `locale: 'settings.projects'`；其 `inject` face 只提供两个成员：`list`，它不带过滤条件地调用 `ctx.remote.project.list()`；以及 `board`，它调用 `ctx.remote.project.board(id)`。被拒绝的调用会变成一条 `project.list failed: <code>: <message>` 或 `project.board failed: <code>: <message>` 的 `Error`；分区对任何拒绝都渲染失败提示，不再做进一步归类。

### 渲染规则

组件 props 由设置 slot 的 runtime share、绑定的 locale share 与注入 face 组成。两份加载状态都是组件局部的：列表（读取中、失败、已拿到列表）与看板视图（空闲、读取中、失败、已拿到看板）。列表读取进行期间「刷新」控件被禁用，打开项目会把看板视图替换为它的读取状态。渲染是对 wire 值的直接读取：每个列出的项目一行，然后是已打开看板的五条泳道、空看板提示，或它的可开工与受阻行。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当本分区的说明不够用时，请阅读以下页面。它们从浏览器页面走向它所读取的命名空间，再到该命名空间背后的存储。

- [api/project](../../api/project/README.zh.md) —— `project` Remote 命名空间：它的列表与看板方法、wire 类型与失败码。
- [project 存储](../../project/project/README.zh.md) —— 持久看板、它的 compare-and-set revision 与依赖规则。
- [project 工具](../../project/tool-project/README.zh.md) —— 拥有看板全部写入的模型侧消费者。
- [ui-settings](../ui-settings/README.zh.md) —— 承载本分区的设置外壳。
- [Slots 参考](../../../docs/subsystems/slots.zh.md) —— 客户端插件如何声明并填充一个 slot。
- [客户端包地图](../README.zh.md) —— 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

### 不新增任何模型可见内容

#### 模型看到什么

没有。该分区通过 `ctx.remote.project` 读取已存储的看板状态；它不新增提示词分区、工具 schema 或会话事件。

#### Token 影响

没有直接影响。页面从不组装或发送提供方请求，因此无法改变模型读到什么、也无法改变一次请求携带多少 token；它所展示的这些看板是模型自身在别处的工具调用写入的。

#### KV Cache 影响

没有。读取看板不会改变任何请求，因此打开或刷新页面不会使任何已缓存前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了当前页面。它们是当前包约束，不是看板路线图或任务积压。

- **只读**——分区列出项目并读取看板。它从不创建、改名或关闭项目，也从不新增、编辑、关联任务或更改任务状态；这些写入需要模型 `project` 工具携带的 compare-and-set revision。
- **没有筛选，也没有分页**——列表不发送工作区过滤条件，并且除宿主自行包含之外始终隐藏已关闭项目，也没有游标或偏移。被部署上界截断的列表只会报告为已截断，而不是分页。
- **不是实时的**——没有流式推送，也没有轮询。列表在挂载时与刷新时读取，看板在选择时与刷新后读取，且在上一次读取尚未返回时到达的读取不会被排队。
- **看板是一份快照**——视图展示的是上一次读取返回的看板。若模型改动了该项目中的某个任务，页面只有在再次选择或刷新后才会显示出来。
- **只有计数，没有历史**——任务行携带标题、依赖计数与已关联会话计数。没有逐任务历史、作者或外部 issue 链接，因为看板本身不保留这些。
- **仅在 Web bundle 所在处挂载**——只有当组合挂载了本插件时该分区才存在，而随包发布的 Web bundle 正是这样做的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包不持有持久状态，也不持有跨插件可变状态：它只保留组件局部的读取状态，按需读取一个 Remote 命名空间，且不定义 store 或缓存。其插件规格覆盖了空的 host 条目、声明的注入、字典配对、被拒绝调用的归类，以及在声明迟到与声明方重载后的恢复。
