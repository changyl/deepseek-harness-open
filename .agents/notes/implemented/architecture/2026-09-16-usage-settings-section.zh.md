# Agent Note: 在 Web 设置中渲染 Token 用量

Status: implemented

[English](2026-09-16-usage-settings-section.md) | 中文

## Problem

`usage` Remote 命名空间已经能回答一份完整报告——总量、逐路由数字、未定价路由与读取时成本——但 Web GUI 中没有任何代码调用它。唯一的人类读者是 [`dsh-command-usage`](../../../../packages/usage/command-usage/README.zh.md) 中的进程内命令 `/usage`：它把报告作为文本打印进会话，因此运维人员要看一个部署花了多少，必须先运行命令再从转录里读结果。

设置外壳正是 Web GUI 放置"部署级、只读"面板的地方：[`ui-settings-general`](../../../../packages/client/ui-settings-general/README.zh.md)、`ui-settings-models`、`ui-settings-plugins` 与 `ui-agent-preset` 各自贡献一个 `settings.section` 条目。用量属于同一类事实——部署级、只读、由 Host 在读取时计价——却没有对应条目。

这项工作没有任何阻碍。[`@deepseek-ai/dsh-api-usage`](../../../../packages/api/usage/README.zh.md) 早已发布该命名空间，带着纯 wire 类型与一个已归类的失败；设置槽位也早已接受带 locale 命名空间与注入回调的 section。缺的只是绘制这份报告的那个包。

## Decision

`@deepseek-ai/dsh-client-ui-usage` 为 `ctx.remote.usage` 贡献一个设置 section。它通过 `ctx.slots.inject('settings.section', ...)` 注册，因此该贡献会等待声明、在声明塌缩时消失、在声明方重载后重新建立，并随调用方 fiber 一起退出。条目携带 `id: 'usage'`、`order: 30`（排在塑造部署的那些 section 之后）、从自身字典读取的 `label`，以及 `locale: 'settings.usage'`。

插件声明 `inject = ['slots', 'locale', 'remote', 'remote.usage']`，在 `ctx.effect(...)` 中注册 `settings.usage` 字典，并只提供一个注入成员：`query`。它不带过滤条件调用 `ctx.remote.usage.query(undefined)`——声明的可选参数显式传入，原因见[设置页 Remote 参数个数记录](../bug-fix/2026-09-17-settings-section-remote-arity.zh.md)——并解开 Remote 结果信封。被拒绝的调用会变成一条 `Error`，内容为 `usage.query failed: <code>: <message>`；section 对任何拒绝都渲染其失败提示，不再做进一步归类，因为"哪个失败是调用方可以据以行动的"已由 Host 决定。

组件的 props 是设置槽位的 runtime 份额、绑定的 locale 份额与注入面（`PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<UsageSectionInjected>`）。加载状态是组件内部的，有三种形态——读取中、失败、已拿到报告——页面在挂载时读取一次，并在每次 Refresh 时再读一次，读取进行期间 Refresh 控件保持禁用。就绪的报告渲染为总量网格、逐路由表格、费用块，以及 Host 报告了未定价路由时的未定价列表。金额以整数微单位到达，按该单位的完整精度打印六位小数，并裁掉尾随零，因此整数金额不带小数点。

四项选择支撑了这个设计：

- **不设 store。** 加载状态只属于一个 section 实例，且它绘制的任何内容都不会跨重挂载存活，因此保持组件内部。在注册处声明 store 只会为没有第二个读者读取的数据引入一套生命周期、一个共享面与一条失效规则。
- **不做过滤控件。** Host 命名空间接受时间窗、工作区、路由与会话列表，但本页面获批的范围是整个语料。UI 中的选择模型需要自己的消费者证据；提前交付控件等于把一套查询语法固化在表现层里。
- **不做图表或时间序列。** 该命名空间每次调用只回答一份聚合报告，wire 也不携带时间维度，因此任何趋势都只能由客户端组装并保存——那会成为账本之外的第二份事实来源。
- **Refresh 是唯一的刷新机制。** 该命名空间是单次的，没有变更流。轮询会为只在记录到新请求时才会变化的数字按间隔消耗一次 Remote 读取，而流式推送需要 Host 侧该命名空间并不具备的发布机制。

注册是让该 section 加载的关键，且每个面都是显式的：`tsconfig.client.json` 的聚合引用、`ui-usage` 行与 `packages/bundle/web-app/package.json` 依赖（没有清单声明其包的 row 会导入失败）、手写的 `tsconfig.base.json` 别名——`client-ui-*` 包名与其 `ui-usage` 目录不匹配，因此路径生成器无法持有它们——以及重新生成的客户端槽位目录，它现在列出了新的占用者。有一个既有测试随之改动：`packages/client/ui-settings-general` 中的外壳规格会启动实际发布的 Web 名单，并按导航顺序断言产品 section，因此其名单以 `usage` 结尾。

## Alternatives considered

**把用量并入已有的会话统计条。** 那条统计条折叠的是单个会话的日志结构。部署运维人员要问的数字——整个语料、按生效价目表计价——既不是按会话的，也不是结构性的；该能力缝自身的设计也出于同样理由把费用挡在那次折叠之外。

**用独立路由或对话区读取该命名空间。** 设置 section 复用了外壳既有的导航、locale 席位与列表作用域。新面则要为一个只读页面自建槽位并在外壳导航中占据自己的位置。

**发布客户端 store，让多个面共享同一份报告。** 没有别的读者读这份报告，而 store 的存在意义是跨条目共享或跨重挂载存活的状态。放在这里它就是一个没有第二读者、也没有失效来源的缓存。

**在 Host 侧格式化金额。** wire 携带整数微单位与价目表的货币。格式化属于表现层；把它留在组件里，Host 就不必关心 locale 与显示，而它的算术保持精确。

**在客户端为报告计价。** 费率是注册在 Host 上、在查询时读取的部署数据，客户端副本会与产生该金额的价目表脱节，未定价路由也不再可归因。

## Consequences

运维人员可以在 Web GUI 中读到总量、逐路由数字、未定价路由与费用，`usage` 命名空间从此有了实际发布的浏览器消费者。既有的三个用量消费者——服务、账本与命令——不受影响，因为本包只读取命名空间，不添加任何 Host 行为。

费用在 UI 中保持其读取时语义：`cost` 缺失时渲染"未挂载价目表"提示而不是零金额，`complete: false` 时渲染下限提示，因此不完整的总额永远不会被呈现为实测值。这条路径上不引入任何浮点值：金额是整数，经缩放后按固定精度打印。

文案由 locale 拥有：导航标签、标题、表头、状态行与各类提示都来自 `settings.usage`，因此页面跟随外壳的 locale，组件本身不携带产品文案。

代价是新鲜度。页面展示的是上一次读取回答的内容，且从不携带选择条件，因此同一部署上的两位运维人员看到同一个数字，任何变化都要等到一次 Refresh 之后才可见。

## Deferred

UI 中没有时间窗、工作区、路由或会话过滤，尽管 Host 命名空间接受这些条件；没有图表或时间序列；没有流式推送或轮询。浏览器快照夹具与顶层 `snapshots/` 树未被触碰，因为录制需要模型密钥，因此组装后的页面由组件规格覆盖，而不是录制场景。不发布 `./invariant` 伴随包，因为本包不持有持久状态，也不存在独立观测可能产生分歧的关系——其规格改为钉住注册、字典一致性与渲染规则。

## Testing

两个规格共十一个用例。插件规格在真实 `SlotRegistry` 与 `LocaleRuntime` 上运行，并提供 `remote.usage`：它验证 host Loader 条目保持惰性、钉住确切的注入列表、用中文键集校验英文字典、在不急切读取 Remote 的情况下注册 section、把被拒绝的调用归类为 section 可渲染的失败，并证明该贡献会跟随 locale 变化，且在迟到的声明与声明方重载后恢复。section 规格在脚本化的 query 上渲染组件：先读取中状态、随后是总量与逐路由行、整数金额、空选择与未挂载价目表提示、失败读取及其重试，以及下一次读取进行期间被禁用的 Refresh 控件。`src/client/*` 具备逐文件 100% 覆盖率。

`pnpm run test:gui` 在客户端与 host GUI 套件上均为绿色；`verify-client-packages`、`verify-client-ui-i18n` 与 `verify-client-catalog` 通过，两个聚合 TypeScript face 均可构建。
