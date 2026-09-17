# Agent Note：把跨会话结果信号渲染为 Web 设置分区

Status: implemented

[English](2026-09-16-effectiveness-settings-section.md) | 中文

## 问题

结果信号记录在每一份会话日志里，却只有两个可读入口，且都不是浏览器。[`dsh-command-effectiveness`](../../../../packages/feedback/command-effectiveness/README.zh.md) 通过 `/effectiveness` 把报告渲染为文本，代价是占用一个会话；[`dsh-api-effectiveness`](../../../../packages/api/effectiveness/README.zh.md) 发布了带单个读取方法的 `ctx.remote.effectiveness`，但 Web GUI 里没有任何调用者——该命名空间带着规格发布，却没有消费者。

操作者想知道「这个部署的产出顺利吗」，读的是日志本就持有的事实：多少轮次带有信号、人对消息如何评价、哪些变更被接受或回退、哪些验证命令通过。这与设置外壳已经承载的部署级面板属于同一类事实，两个同族分区已在[各自的笔记](2026-09-16-usage-settings-section.zh.md)与[这一篇](2026-09-16-project-board-settings-section.zh.md)中确立了形状。

## 决策

`@deepseek-ai/dsh-client-ui-effectiveness`（[包参考](../../../../packages/client/ui-effectiveness/README.zh.md)）为 `ctx.remote.effectiveness` 贡献一个设置分区。它通过 `ctx.slots.inject('settings.section', ...)` 注册，因此该贡献会等待声明出现、在声明塌缩时消失、在声明方重载后重新建立，并随调用方的 fiber 一起离开。条目携带 `id: 'effectiveness'`、`order: 50`（排在其余只读面板之后）、从自身词典读取的 `label`，以及 `locale: 'settings.effectiveness'`。

插件声明 `inject = ['slots', 'locale', 'remote', 'remote.effectiveness']`，在 `ctx.effect(...)` 内注册 `settings.effectiveness` 词典，且只提供一个注入成员：`query`，它以不带过滤条件的方式调用 `ctx.remote.effectiveness.query(undefined)`——声明的可选参数显式传入，原因见[设置页 Remote 参数个数记录](../bug-fix/2026-09-17-settings-section-remote-arity.zh.md)——并解包 Remote 结果信封。被拒绝的调用会变成内容为 `effectiveness.query failed: <code>: <message>` 的 `Error`；分区对任何拒绝都渲染失败提示，不再做进一步归类，因为 Host 已经决定了哪个失败是调用方能处置的。

组件 props 是设置 slot 的运行时份额、绑定后的本地化份额，以及注入面（`PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<EffectivenessSectionInjected>`）。读取状态是组件局部的，有三种形态——读取中、失败、已拿到报告——另有一个 `pending` 标志在读取进行期间禁用「刷新」控件。页面在挂载时读取一次，并在每次刷新时再读取一次。

就绪的报告渲染十项总量，然后是至少携带一条判定的分类，再往下每个路由一行、每个会话一行，并在 Host 截断逐会话行时给出截断提示。有三条渲染规则是刻意为之：

- **分类列表遍历 wire 自身的联合。** Host 不再上报的分类会从页面消失，而任一侧的改名都会使构建失败。没有判定的分类会被省略，而不是打印为 0，因为「没有人提交这个分类」与「这个分类得分为零」是不同的事实。
- **没有信号会被陈述，而不是被打分。** 当总量不含任何会话时，页面说明没有记录到信号，而不是打印 0%：空语料不是坏结果，比率会凭空造出日志从未有过的分母。
- **会话打印 id 与 UTC 日期。** 报告不带标题也不带工作区，而一份会话清单读起来是日期比毫秒更有用。

四条选择构成设计：

- **不要 store。** 读取状态只属于单个分区实例，它绘制的内容也不会在重挂载后存活，因此保持组件局部。在 register 处声明的 store 会为一个没有第二个读者读取的数据引入生命周期、共享面与失效规则。
- **不要过滤控件。** Host 调用接受时间窗、会话列表、provider 与 model，但本页获批的范围是整个语料。UI 中的选择模型需要自己的消费者证据；提前交付控件等于把查询语法固化在表现层。
- **不要图表或时间序列。** 一次读取回答一份聚合报告，wire 不带时间维度，因此趋势只能由客户端累积并保存——那会成为折叠逻辑之外的第二份事实来源。
- **只读。** 每个计数都来自拥有该判定的表面：评价来自反馈控件，变更决策来自变更评审，验证结果来自任务报告。在浏览器里做编辑器需要自己的权限决策，并且会与那些表面重复。

注册是分区得以加载的原因，每个注册面都是显式的：`tsconfig.client.json` 聚合引用、`ui-effectiveness` 行与 `packages/bundle/web-app/package.json` 依赖（没有清单声明的行会导入失败）、手写的 `tsconfig.base.json` 别名（`client-ui-*` 包名与其 `ui-effectiveness` 目录不匹配，路径生成器无法拥有它们）、重新生成的 client slot 目录（现已列出新的占用者），以及记录该包用途的客户端包地图行。有一处既有预期随改动移动：`packages/client/ui-settings-general/tests/shell.client.spec.ts` 中的已发布设置页名册会启动真实 web-app roster 并按导航顺序断言产品分区，因此它现在以 `agent-presets, usage, projects, effectiveness` 结尾，而记录下来的设置对话框 golden 也增加了该导航项。

## 考虑过的替代方案

**把报告加进对话，作为工具卡片或命令输出。** `/effectiveness` 已经把它渲染在那里，但一条 transcript 行属于某个会话中的某一轮。设置面板为整个宿主作答，面向的不是正在驱动会话的读者。

**发布一个客户端 store，让多个表面共享同一份报告。** 没有别的读者，而 store 是为跨条目共享或重挂载后存活的状体准备的。在这里它只会是一个没有第二读者、也没有失效来源的缓存。

**把报告画成随时间变化的图表。** 命名空间是一元的，每次答案都是一份聚合。趋势需要 wire 不携带的时间维度，而在浏览器里造一个时间维度，会让页面的数字与折叠逻辑对不上。

**在浏览器里计算计数。** 信号只以会话事件形式存在；把它们变成计数的折叠、分类词汇，以及逐路由归属，都在投影之后。浏览器里的副本会与所有其他消费者读到的定义逐渐分叉。

**展示比率。** 百分比是读者最先想要的，也是这份数据最无法支撑的：各会话的轮次数不同，多数轮次不带信号，而一个尚未收到反馈的部署会用一个空分母渲染出满分或灾难性的分数。

## 后果

操作者可以在 Web GUI 中查看一个部署已记录的结果信号——总量、分类、路由与会话——而 `effectiveness` Remote 命名空间有了第一个随包发布的浏览器消费者。投影、查询服务与 `/effectiveness` 命令均未被改动，因为本包只读该命名空间，不新增任何 Host 行为。

页面保留它所读取的折叠的汇报语义：`turnsWithSignal` 计的是「轮次与会话」对，而不是不同的轮次；路由行之和可能高于总量，因为一个会话可能使用多条路由；没有信号的范围会被陈述，而不是被打分。文案由 locale 拥有：导航标签、标题、分类名、数字标签、日期模板与所有提示都来自 `settings.effectiveness`，因此页面跟随外壳语言，组件本身不携带任何产品文案。

代价是新鲜度与范围：页面展示最近一次读取对整个宿主的答案，因此两个操作者看到同样的数字，变化只在刷新后出现，也无法让页面只回答某个工作区或某一周。

## 延期

UI 中没有过滤、时间窗或 provider 控件，尽管 Host 调用接受它们；没有图表或时间序列；没有实时更新。会话清单显示 id 与日期而不是标题或工作区，因为报告两者都不带。没有新增录制会话夹具，因为录制需要模型 key，因此组装后的页面由组件规格与 replay 的 settings-chrome 场景覆盖，而不是一份新的录制。没有发布 `./invariant` 伴生入口，因为本包不持有持久状态，也不持有任何独立观测可能产生分歧的关系——其规格改为固定注册、字典配对、被拒绝调用的归类与渲染规则。

## 测试

两份规格共十二个用例。插件规格在真实 `SlotRegistry` 与 `LocaleRuntime` 之上运行，并提供 `remote.effectiveness`：保持 host Loader 条目惰性、固定确切的注入清单、用中文键集校验英文字典、在不预先读取 Remote 的前提下完成注册、把被拒绝的调用归类为分区可渲染的失败，并证明该贡献跟随语言切换，且在声明迟到与声明方重载后恢复。分区规格以脚本化的 query 渲染组件：读取状态之后是十项总量、仅为有判定的分类渲染的分类列表、空语料配合空路由表与空会话清单、带路由行/会话行/截断提示的报告、失败读取与重试，以及下一次读取进行期间被占用的「刷新」控件。`src/client/*` 保持逐文件 100% 覆盖。

随包发布的注册面被一起验证：`pnpm run test:gui` 在客户端与 host GUI 套件上全绿，两个聚合 TypeScript 面均构建通过，且重建客户端 bundle 后 replay 的 `apps/web/tests/settings-chrome.e2e.ts` 场景通过——这正是该行在真实 web profile 中加载、而不只是在手工搭起的上下文中加载的证明。
