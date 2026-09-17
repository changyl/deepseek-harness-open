# Agent Note: 把持久项目看板渲染为 Web 设置页

Status: implemented

[English](2026-09-16-project-board-settings-section.md) | 中文

## Problem

持久看板已经有了面向模型的工具和一条文本命令，而浏览器两者都触达不到。[`dsh-tool-project`](../../../../packages/project/tool-project/README.zh.md) 在 agent 轮次内部读取和修改看板，[`dsh-command-project`](../../../../packages/project/command-project/README.zh.md) 把一份看板作为文本渲染进会话记录；但想看清有哪些项目、哪些可开工、哪些受阻的人，必须运行 `/project` 再从对话里读答案。

浏览器通路的 Host 侧其实已经存在。[`dsh-api-project`](../../../../packages/api/project/README.zh.md) 发布了 `ctx.remote.project`，带两个只读方法 `list(filter?)` 与 `board(id)`、纯 wire 值，以及已分类的 `project/not-found` 失败；但 Web GUI 中没有任何调用方——该命名空间只有规格，没有消费者。

设置外壳正是 Web GUI 放置部署级只读面板的地方，而看板正属于这类事实：持久、在同一工作目录的多个会话之间共享，并且是按操作者的请求而不是模型的请求读取。同族的用量设置页在[它的笔记](2026-09-16-usage-settings-section.zh.md)中确立了这个形态。

## Decision

`@deepseek-ai/dsh-client-ui-project`（[包参考](../../../../packages/client/ui-project/README.zh.md)）贡献一个基于 `ctx.remote.project` 的设置页。它通过 `ctx.slots.inject('settings.section', ...)` 注册，因此该贡献会等待声明出现、在声明塌缩时消失、在声明方重载后重新建立，并随调用方 fiber 一起离开。条目携带 `id: 'projects'`、`order: 40`——排在只读部署面板之后——一个从自身词典读取的 `label`，以及 `locale: 'settings.projects'`。

插件声明 `inject = ['slots', 'locale', 'remote', 'remote.project']`，在 `ctx.effect(...)` 内注册 `settings.projects` 词典，并且只提供两个注入成员：`list` 调用 `ctx.remote.project.list(undefined)`——声明的可选过滤条件显式传入，原因见[设置页 Remote 参数个数记录](../bug-fix/2026-09-17-settings-section-remote-arity.zh.md)——并解包 Remote 结果信封，`board` 对 `ctx.remote.project.board(id)` 做同样的事。被拒绝的调用会成为一条 `Error`，文本为 `project.list failed: <code>: <message>` 或 `project.board failed: <code>: <message>`；设置页对任何 rejection 渲染失败提示，不再做进一步分类，因为 Host 已经决定哪一个失败是调用方可以据以行动的。

组件的 props 是设置槽的 runtime share、绑定的 locale share，以及注入面（`PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<ProjectSectionInjected>`）。两个彼此独立的状态保存在组件内部：列表读取（`loading`、`error`、已到手的列表）与看板视图（`idle`、`loading`、`error`、已到手的看板）。列表在挂载时读取一次，并在 Refresh 时重读，Refresh 同时清空已打开的看板；打开某个项目行只读取那一份看板。就绪的列表为每个项目渲染一行，带它的状态词以及任务、可开工、受阻三个计数，并在部署的列表上界截断了答案时呈现 `truncated` 标记。就绪的看板渲染 Host 给出的标题、按阅读顺序排列的五条状态泳道（每项任务带依赖与会话计数）、Host 报告了内容时的可开工与受阻 id 行，以及项目没有任何任务时的空看板提示。

有四个选择支撑这套设计：

- **不声明 store。** 读取状态只属于这一个设置页实例，它绘制的内容也不会在重新挂载后留存，因此留在组件内部。若在注册处声明 store，就要为一个没有第二个条目的数据加上生命周期、共享面与失效规则。
- **只读。** 存储提供的每一次变更都携带调用方上次观察到的 compare-and-set revision，那是模型工具的契约。浏览器的编辑面需要自己关于"谁可以移动另一个会话的看板"的授权决定，因此本设置页只读、从不写入。
- **没有筛选或分页控件。** Host 列表本身已经施加上界并报告 `truncated`，存储也按最新优先排序项目。UI 里的选择模型需要自己的消费者证据；提前发布控件会把一套查询语法固化在展示层。
- **两个状态，而不是一台状态机。** 打开一份看板不得打扰屏幕上已有的列表，看板读取失败也不得抹掉良好的列表。两个独立状态直接表达这一点；单台状态机则必须编码它们的叉积。

让设置页得以加载的是注册，而每一处表面都是显式的：`tsconfig.client.json` 聚合引用；`ui-project` 行以及 `packages/bundle/web-app/package.json` 依赖（没有任何清单声明的行会导入失败）；手写的 `tsconfig.base.json` 别名——`client-ui-*` 包名与其 `ui-project` 目录不一致，因此路径生成器无法拥有它们；重新生成的客户端 slot 目录，其中现在列出了这个新的占位者；以及记录该包用途的客户端包映射行。有一处既有期望随之改动：`packages/client/ui-settings-general/tests/shell.client.spec.ts` 中的已发布设置页名册会启动真实的 web-app 名册并按导航顺序断言产品设置页，因此它现在以 `agent-presets, usage, projects` 结尾；已录制的设置对话框 golden 也获得了这条导航项。

## Alternatives considered

**在对话里通过工具卡片渲染看板。** `project` 工具的结果本来就会出现在那里，但卡片只展示某一轮所请求的内容。设置面板展示的是部署所持有的内容，面向并不在驱动会话的读者。

**为看板增加一条专用路由。** 设置外壳已经拥有导航、locale 座位与列表作用域。新表面需要自己的槽，并为这一个只读页面在外壳导航中占据位置。

**发布一个客户端 store，让多个表面共享同一份看板。** 没有别的表面读取看板，而 store 是为跨条目共享或跨重新挂载存活的状态而存在的。这里它只会是一个没有第二个读者、也没有失效来源的缓存。

**把变更搬进浏览器。** 存储的 revision 契约存在，是为了让两个写入者无法静默互相覆盖。把一个浏览器并未读取过的 revision 交给它、或替它铸造一个，等于把"谁拥有这份看板"的决定挪出记录它的那个工具。

**预先读取每一份看板。** 列表已经按项目携带计数，因此面板无需打开任何东西就能回答"哪些可开工"。读取每一份看板会把打开页面的成本乘以已存储项目的数量，只为读者并未要求查看的数据。

## Consequences

操作者可以在 Web GUI 中看到部署的项目、它们的可开工与受阻计数，以及任意一份看板的泳道；`project` Remote 命名空间也有了它的第一个随包发布的浏览器消费者。存储、工具与 `/project` 命令都不受影响，因为本包只读取该命名空间，不添加任何 Host 行为。

设置页遵循这套技术栈其余的读取时纪律：它渲染上一次读取所回答的内容，因此同一部署上的两位操作者看到同一份看板，而变更只有在 Refresh 或重新打开之后才可见。看板永远不会被部分应用——视图要么持有一份完整的 `ProjectBoardWire`，要么持有一次失败。

文案由 locale 拥有：导航标签、标题、状态词、计数模板、可开工与受阻两行，以及每一条提示都来自 `settings.projects`，因此页面跟随外壳语言，组件本身不携带任何产品字符串。

代价是每次交互一次读取：挂载时与 Refresh 时各一次列表读取，每打开一个项目一次看板读取，两者之间没有缓存。对一个数字会随模型写入而变动的页面来说这是刻意的，也让面板的每个数字都可归因到各自那一次查询。

## Deferred

UI 中没有筛选或分页控件，尽管 Host 列表接受工作区选择并报告自身的截断；本设置页不发送任何筛选。看板不是实时的：没有任何流，因此新鲜度就是 Refresh 手势。项目行在读者打开之前展示的是计数而不是任务标题。没有逐任务历史、作者或外部 tracker 链接，因为存储与 wire 都不携带它们。没有新增录制的会话夹具，因为录制需要模型 key，因此组装后的页面由组件规格与回放的 settings-chrome 场景覆盖，而不是一份新的录制。没有发布 `./invariant` 伴随文件，因为本包不拥有持久状态，也不拥有任何独立观察可能产生分歧的关系——它的规格改为固定注册、词典键一致、两处 Remote 失败分类以及渲染规则。

## Testing

两个规格共十二个用例。插件规格在提供了 `remote.project` 的真实 `SlotRegistry` 与 `LocaleRuntime` 上运行：它保持 host Loader 条目惰性、固定精确的注入列表、对照中文键集校验英汉词典、在不急切读取 Remote 的前提下注册设置页、把被拒绝的列表调用与被拒绝的看板调用归类为该设置页可以渲染的失败，并证明该贡献会跟随语言切换、且在晚声明与声明方重载后恢复。设置页规格用脚本化的读取渲染组件：列表读取以及读者打开后的行、某份看板的泳道及其可开工与受阻集合与逐任务计数、空 Host 加上被截断的列表与空看板、一份没有任何任务的看板、失败的列表及其重试，以及失败的看板读取与下一次列表读取在途时被禁用的 Refresh 控件。`src/client/*` 保持逐文件 100% 覆盖。

已发布的注册面被一起验证：`pnpm run test:gui` 在客户端与 host GUI 套件上全绿，两个聚合 TypeScript face 均能构建，回放的 `apps/web/tests/settings-chrome.e2e.ts` 场景在重建客户端 bundle 后通过——这正是"该行在真实 web profile 中加载"而不是只在手工搭的上下文里加载的证据。
