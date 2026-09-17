---
description: "Web GUI 全局面板中的 token 用量与费用面板：一个「用量」面板读取 `usage` Remote 命名空间，展示总计、按路由表格、已定价子集的费用，以及未定价路由；面向用量表面的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

[English](README.md) | 中文

## 概述

本包在 Web GUI 的全局面板中新增「用量」面板：展示整个语料库已记录的 token 用量与读取时计算的费用，数据来自 `usage` Remote 命名空间。面板在打开时读取一次，之后由「刷新」按钮触发再次读取。总计包含会话、轮次、步骤与四个 token 桶；按路由表格把同样的数字按 provider 与 model 拆分；当部署挂载了价目表时才会出现费用，而遗漏了未定价路由的总额会被标记为下限，而不是实测值。

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

在同时挂载 `usage` Host 命名空间的 Web 组合中挂载本插件，侧边栏的「全局面板」行就会在中央列打开本面板，与会话并列。面板每次读取渲染一份报告：挂载时读取一次，「刷新」按钮会在上一次读取尚未返回时发起下一次读取。面板只持有这份加载状态，因此它渲染的任何内容都不会比面板本身活得更久，也不涉及 store、缓存或任何持久化值。选中会话或新建会话会把中央列交还给会话。

面板有三种状态。读取期间显示一行状态提示；读取失败时显示失败提示、其下方原样附上的拒绝信息与「刷新」按钮，因为查询被拒绝是该面板唯一加以归类的失败路径；否则渲染报告：总计网格、按路由表格（当没有任何路由贡献用量时改为空选择提示）、费用区块，以及宿主报告了未定价路由时的未定价路由列表。

### 单次读取展示什么

总计网格包含八个数字：会话、轮次、步骤、未上报用量的步骤、未缓存输入 token、输出 token、缓存读取 token 与缓存写入 token。路由表按每条 `provider/model` 路由重复会话、步骤与四个 token 数字，顺序与宿主报告的一致。费用由宿主在读取时按当时生效的价目表计算：面板打印整数金额及其币种，并附上产出该金额的价目表版本；当至少一条贡献路由没有价格时，金额会被标记为不完整。价目表未命名的路由会单独列出，因此缺失的数字是可归因的，而不是无声消失。

金额是价目表币种的整数微单位。面板按该单位的完整精度打印六位小数，去掉末尾的零，整数金额不带小数点。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计理念

本插件是覆盖在一个 Remote 命名空间之上的展示层。它的 Node 半边是一个惰性的 Loader 条目；浏览器半边注册字典、一个全局面板，以及打开它的侧边栏行，面板通过注入的 `query` 回调读取数据，而不是去获取客户端 context。Remote 调用、其校验以及失败词表都属于 [Host 命名空间](../../api/usage/README.zh.md)；本包只决定如何绘制答案，以及在没有答案时说什么。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Node 半边：使包拥有 Loader 条目的空 `apply` |
| [`src/client/index.ts`](src/client/index.ts) | 字典、`query` Remote face，以及 `main` 与 `sidebar.panellist` 注册 |
| [`src/client/UsagePanel.tsx`](src/client/UsagePanel.tsx) | 面板组件及其金额格式化函数 |
| [`src/client/UsagePanelIcon.tsx`](src/client/UsagePanelIcon.tsx) | 侧边栏行图标 |
| [`src/client/locales.ts`](src/client/locales.ts) | `usage` 字典及其键类型 |
| [`src/client/UsagePanel.module.css`](src/client/UsagePanel.module.css) | 基于共享主题 token 的面板样式 |

### Slot 与注册

插件声明 `inject = ['slots', 'locale', 'remote', 'remote.usage']`，在 `ctx.effect(...)` 中注册 `usage` 字典，并把它们绑定到 `t` 座位。它通过 `ctx.slots.inject` 分别注册到布局的 `main` keyed slot 与侧边栏的 `sidebar.panellist` list，因此每个贡献都会等待各自的声明出现、随调用方 fiber 一起移除，并在声明方重新加载后重新建立。

两处注册携带同一个面板 id `usage`：侧边栏行把它当作列表 `id` 并声明 `order: 20`，中央列把它当作 `main` 键。行的 `label` 读取字典的 `nav` 键，面板携带 `locale: 'usage'`，其 `inject` face 只提供一个成员：`query`，它不带过滤条件地调用 `ctx.remote.usage.query()`。被拒绝的调用会变成一条 `usage.query failed: <code>: <message>` 的 `Error`；对任何拒绝，面板都渲染失败提示并原样附上该 message，不再做进一步归类。

### 渲染规则

组件 props 由 main slot 的 runtime share、绑定的 locale share 与注入 face 组成。加载状态是组件局部的，有三种形态——读取中、携带拒绝信息的失败、已拿到报告——读取进行期间「刷新」控件被禁用。渲染是对 wire 报告的直接读取：八个总计数字、每条路由一行表格、费用区块，以及仅在非空时才出现的未定价列表。所有状态都渲染在面板自身的滚动区域里，因为中央列会裁剪溢出。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当本面板的说明不够用时，请阅读以下页面。它们从浏览器页面走向它所读取的命名空间，再到该命名空间背后的 seam。

- [api/usage](../../api/usage/README.zh.md) —— `usage` Remote 命名空间：它唯一的查询方法、wire 类型与失败码。
- [usage 服务](../../usage/usage/README.zh.md) —— 组装报告的能力缝，以及塑造它的 provider 与定价角色。
- [ui-sidebar](../ui-sidebar/README.zh.md) —— 选中本面板的全局面板行。
- [ui-layout](../ui-layout/README.zh.md) —— 面板占用的 `main` keyed slot 与 `ctx.layout.selectPanel`。
- [Slots 参考](../../../docs/subsystems/slots.zh.md) —— 客户端插件如何声明并填充一个 slot。
- [客户端包地图](../README.zh.md) —— 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

### 不新增任何模型可见内容

#### 模型看到什么

没有。该面板通过 `ctx.remote.usage` 读取已经发生过的请求的数字；它不新增提示词分区、工具 schema 或会话事件。

#### Token 影响

没有直接影响。页面从不组装或发送提供方请求，因此无法改变模型读到什么、也无法改变一次请求携带多少 token；它所展示的这些请求是在别处成形的。

#### KV Cache 影响

没有。读取用量不会改变任何请求，因此打开或刷新页面不会使任何已缓存前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了当前页面。它们是当前包约束，不是通用统计对比或任务积压。

- **只有一种选择范围**——页面读取整个语料库。Host 命名空间接受时间窗口、工作区、路由与会话列表，但本面板不发送任何过滤条件，因此无法从浏览器收窄报告范围。
- **只有一种答案形态**——每次读取只渲染一张表格与一个总计网格。它不绘制图表，也不保留时间序列，因此无法展示趋势、速率或两种选择之间的对比。
- **不是实时的**——没有流式推送，也没有轮询。新鲜度等同于刷新动作，且在上一次读取尚未返回时到达的读取不会被排队。
- **没有逐路由轮次计数**——路由表展示会话、步骤与四个 token 桶；wire 类型刻意不携带逐路由轮次，因为一次轮次可能切换路由，逐路由轮次数会重复计算。
- **费用取决于部署**——未挂载价目表的组合完全不报告费用，而只命名了部分路由的价目表会把金额标记为不完整；页面自身无法为任何内容定价。
- **选择不持久化**——选中的面板只存在于内存中的布局状态里，因此刷新页面会把中央列交还给会话。
- **仅在 Web bundle 所在处挂载**——只有当组合挂载了本插件时该面板才存在，而随包发布的 Web bundle 正是这样做的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包不持有持久状态，也不持有跨插件可变状态：它只保留组件局部的加载状态，按需读取一个 Remote 命名空间，且不定义 store 或缓存。其插件规格覆盖了空的 host 条目、声明的注入、字典配对、被拒绝调用的归类，以及在声明迟到与声明方重载后的恢复。
