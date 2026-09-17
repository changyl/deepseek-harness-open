---
description: "Web GUI 全局面板中的跨会话结果信号面板：一个「有效性」面板读取 `effectiveness` Remote 命名空间，按分类、路由与会话呈现反馈、变更决策与验证结果；面向有效性表面的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-effectiveness

[English](README.md) | 中文

## 概述

本包在 Web GUI 的全局面板中新增「有效性」面板：展示会话日志中已经记录的跨会话结果信号，数据来自 `effectiveness` Remote 命名空间。一次读取即回答整个语料——会话数、有信号的轮次、反馈、变更决策与验证结果——面板再列出这些总量所覆盖的分类、路由与会话。这些计数描述会话里发生了什么，不是模型质量评分；当所选范围没有任何信号时，面板会如实说明，而不是给出 0 比率。

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

在同时挂载 `effectiveness` Host 命名空间的 Web 组合中挂载本插件，侧边栏的「全局面板」行就会在中央列打开本面板。该面板是只读的：它陈述日志中已经记录的内容，而它统计的每一项判定都来自拥有该判定的表面——评价来自反馈控件，变更决策来自变更评审，验证结果来自任务报告。面板只持有自己的读取状态，因此它渲染的任何内容都不会比面板本身活得更久，也不涉及 store、缓存或任何持久化值。

面板挂载时读取一次；「刷新」按钮会在上一次读取尚未返回时发起下一次读取。没有排队：读取期间到达的刷新就是取代它的那次读取，因为面板始终只展示一份完整报告。选中会话或新建会话会把中央列交还给会话。

### 面板展示什么

面板有三种状态：读取期间显示一行状态提示；读取被拒绝时显示失败提示与「刷新」按钮；否则显示报告。就绪的报告渲染十项总量——会话、有信号的轮次、好评与差评、已接受/已回退/未决定的变更，以及通过/失败/无结果的验证——随后给出与失败提示相反的一条说明：当所选范围不含任何会话时，面板明确说明没有记录到信号，并且不给出比率。

在总量之下，先是至少携带一条判定的分类（按本地化名称列出），然后每个路由一行，包含该路由的会话数、有信号的轮次、评价与验证结果；再往下每个会话一行，包含会话 id、UTC 创建日期、有信号的轮次，以及其日志点名过的路由。若报告的逐会话行被部署上界截断，会渲染截断提示；若报告没有路由行或没有会话行，会直接说明，而不是渲染空表。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

本插件是一个 Remote 命名空间之上的呈现表面。它的 node 半边是惰性的 Loader 条目；浏览器半边注册词典、一个全局面板，以及打开它的侧边栏行，面板的数据来自注入的 `query` 回调，而不是去够取客户端上下文。Remote 调用、请求校验、语料折叠、上报上界与失败词汇都属于 [Host 命名空间](../../api/effectiveness/README.zh.md)；本包只决定如何绘制答案，以及没有答案时说什么。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Node 半边：让本包拥有 Loader 条目的空 `apply` |
| [`src/client/index.ts`](src/client/index.ts) | 词典、`query` Remote 面，以及 `main` 与 `sidebar.panellist` 注册 |
| [`src/client/EffectivenessPanel.tsx`](src/client/EffectivenessPanel.tsx) | 面板组件、它的分类顺序，以及总量、路由与会话的渲染 |
| [`src/client/EffectivenessPanelIcon.tsx`](src/client/EffectivenessPanelIcon.tsx) | 侧边栏行图标 |
| [`src/client/locales.ts`](src/client/locales.ts) | `effectiveness` 词典与键类型 |
| [`src/client/EffectivenessPanel.module.css`](src/client/EffectivenessPanel.module.css) | 基于共享主题 token 的面板样式 |

### Slot 与注册

本插件声明 `inject = ['slots', 'locale', 'remote', 'remote.effectiveness']`，在 `ctx.effect(...)` 内注册 `effectiveness` 词典，并把它们绑定到 `t` 席位。它通过 `ctx.slots.inject` 分别注册进布局的 `main` keyed slot 与侧边栏的 `sidebar.panellist` list，因此每个贡献都会等待各自的声明出现，随调用方的 fiber 一起离开，并在声明方重载后重新建立。

两处注册携带同一个面板 id `effectiveness`：侧边栏行把它当作列表 `id` 并声明 `order: 30`，中央列把它当作 `main` 键。行的 `label` 读取词典 `nav` 键，面板携带 `locale: 'effectiveness'`；它的 `inject` 面只提供一个成员：`query`，它以不带过滤条件的方式调用 `ctx.remote.effectiveness.query()`，并解包 Remote 结果信封。被拒绝的调用会变成内容为 `effectiveness.query failed: <code>: <message>` 的 `Error`；面板对任何拒绝都渲染失败提示，不再做进一步归类。

### 渲染规则

组件 props 是 main slot 的运行时份额、绑定后的本地化份额，以及注入面。读取状态是组件局部的，有三种形态——读取中、失败、已拿到报告——另有一个 `pending` 标志在读取进行期间禁用「刷新」控件。面板在挂载时读取一次，并在每次刷新时再读取一次。所有状态都渲染在面板自身的滚动区域里，因为中央列会裁剪溢出。

分类列表遍历 wire 自身的分类联合，因此 Host 不再上报的分类会从面板消失，而任一侧的改名都会使构建失败。没有判定的分类会被省略，而不是打印为 0。路由表与会话行直接按 wire 值渲染，会话创建时间打印为 UTC 日期，因为精确时刻在一份会话清单里只是噪声。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当本面板的说明不够用时，请阅读以下页面。它们从浏览器页面走向它所读取的命名空间，再到该命名空间背后的折叠逻辑。

- [api/effectiveness](../../api/effectiveness/README.zh.md) —— `effectiveness` Remote 命名空间：它的查询方法、wire 类型与失败码。
- [effectiveness 查询](../../feedback/effectiveness-query/README.zh.md) —— 命名空间据以作答的跨会话折叠，以及它的逐会话上报上界。
- [effectiveness 投影](../../feedback/effectiveness/README.zh.md) —— 折叠复用的逐会话单元，其结果是信号的来源。
- [command-effectiveness](../../feedback/command-effectiveness/README.zh.md) —— `/effectiveness`，同一份报告在会话中以文本呈现。
- [ui-sidebar](../ui-sidebar/README.zh.md) —— 选中本面板的全局面板行。
- [ui-layout](../ui-layout/README.zh.md) —— 面板占用的 `main` keyed slot 与 `ctx.layout.selectPanel`。
- [Slots 参考](../../../docs/subsystems/slots.zh.md) —— 客户端插件如何声明并填充一个 slot。
- [客户端包地图](../README.zh.md) —— 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

### 不新增任何模型可见内容

#### 模型看到什么

没有。该面板通过 `ctx.remote.effectiveness` 读取已记录的结果信号；它不新增提示词分区、工具 schema 或会话事件。

#### Token 影响

没有直接影响。页面从不组装或发送 provider 请求，因此无法改变模型读到什么或一次请求携带多少 token；它统计的信号来自会话日志本已持有的事件。

#### KV Cache 影响

没有。读取报告不改变任何请求，因此打开或刷新页面不会使任何缓存前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定当前页面的范围。它们是当前的包约束，不是指标路线图或任务清单。

- **只读**——面板从不评价消息、裁决变更或记录验证结果；它展示的每个数字都来自拥有该判定的表面。
- **单一范围，无过滤控件**——Host 调用接受时间窗、会话列表、provider 与 model，但面板一概不发送，因此页面始终描述宿主上整个可读语料。
- **非实时，也没有图表**——既不流式推送也不轮询；数字来自最近一次读取，且页面只展示一份报告而非时间序列，趋势只能跨多次刷新去读。
- **逐会话行有上界**——Host 按配置的 `maxSessionsReported`（默认 200）截断逐会话行并报告 `truncated`；面板说明这一截断，且不提供分页。
- **没有信号不等于 0 比率**——所选范围的总量不含任何会话时，面板会明确说明，而不是打印百分比，因为空语料与坏结果是两件不同的事实。
- **路由行之和可能超过总量**——使用多条路由的会话会分别计入每个路由行，因此路由数字是逐路由事实，不等于语料总量。
- **会话就是 id 与日期**——会话清单打印会话 id 与其 UTC 创建日期，而不是标题，因为报告既不带标题也不带工作区。
- **选择不持久化**——选中的面板只存在于内存中的布局状态里，因此刷新页面会把中央列交还给会话。
- **仅在挂载 Web bundle 处存在**——只有当组合挂载了本插件时该面板才存在，随包发布的 Web bundle 正是如此。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包不持有持久状态，也不持有跨插件可变状态：它只保留组件局部的读取状态，按需读取一个 Remote 命名空间，且不定义 store 或缓存。其插件规格覆盖了空的 host 条目、声明的注入、字典配对、被拒绝调用的归类，以及在声明迟到与声明方重载后的恢复。
