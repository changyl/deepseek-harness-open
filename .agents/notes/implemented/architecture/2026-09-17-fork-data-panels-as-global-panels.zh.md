# Agent Note: Fork 数据面板作为全局面板打开，而不是设置分区

Status: implemented

[English](2026-09-17-fork-data-panels-as-global-panels.md) | 中文

## Problem

本 fork 新增的三个数据表面——token 用量报告、持久项目看板、结果信号报告——都以 `settings.section` 条目贡献，读者只能先打开设置、再点一行导航才能看到它们。它们不是偏好设置：每个都读取 Host 侧的一份语料并渲染，不持有任何用户可改的设置，而设置对话框是读者去改行为的地方，不是读报告的地方。

Web 客户端本来就有契合这种形态的座位。`ui-layout` 声明了 root 作用域的 `main` keyed slot（`packages/client/ui-layout/src/client/index.ts:153`），AppFrame 在中央列渲染被选中的键，`null` 显示会话；`ui-sidebar` 声明了 root 作用域的 `sidebar.panellist` list（`packages/client/ui-sidebar/src/client/contract/slots.ts:32`），为每个条目渲染一行带标签的行，并通过 `ctx.layout.selectPanel` 选中与之匹配的 `main` 键。两份随包发布的 README 都已写明这个空缺：「shipped composition registers no example panel」「No global panel is registered by the shipped composition」。面板与会话无关，因此没有选中会话时报告依然可读；而 `ui-workspace` 早已在开会话与新建会话时调用 `ctx.layout.selectPanel(null)` 返回会话。

## Decision

三个插件各自贡献一个全局面板及其侧边栏行，不再贡献设置分区。

| 插件 | 面板 id（`main` 键与行 `id`） | 行 `order` | 行图标 | locale 命名空间 | 组件 |
|---|---|---|---|---|---|
| `ui-project` | `project` | 10 | `IconProjectAddOutline16` | `projects` | `ProjectPanel` |
| `ui-usage` | `usage` | 20 | `IconGaugeOutline16` | `usage` | `UsagePanel` |
| `ui-effectiveness` | `effectiveness` | 30 | `IconLikeOutline16` | `effectiveness` | `EffectivenessPanel` |

每个插件通过 `ctx.slots.inject` 注册两次：一次进 `main`（`{ name: 'main', key: PANEL_ID, locale: NS }`），一次进 `sidebar.panellist`（`{ name: 'sidebar.panellist', id: PANEL_ID, order, label: () => t('nav') }`）。两处注册共用一个模块级 `PANEL_ID` 常量，因为这两个身份必须完全一致：`ctx.layout.selectPanel` 在所选键没有 `main` 注册时抛错，因此两者一旦漂移，侧边栏就会留下一行点击即失败的行。该 id 是编译期品牌，用类型断言构造（`'usage' as MainPanelId`）而不是 `brandString`：`@deepseek-ai/dsh-brand` 不是平台模块，浏览器半边不应为一个会被抹掉的转换新增非基线的 workspace 值请求。

三个包去掉 `@deepseek-ai/dsh-client-ui-settings` 类型依赖，改为把 `@deepseek-ai/dsh-client-ui-layout` 与 `@deepseek-ai/dsh-client-ui-sidebar` 作为开发依赖，`devDependencies` 与信息性的 `dsh.client.inject` 边同步，并更新对应的 `tsconfig.json` references。`settings.*` locale 命名空间改为面板自身的领域名（`usage`、`projects`、`effectiveness`），每个组件文件、符号与 CSS 根类由 `*Section` 改为 `*Panel`；侧边栏行各自携带一个很小的 `*PanelIcon` 组件，因为 panellist 契约渲染的正是以该行请求尺寸绘制的图标组件。

面板的每一种状态都渲染在同一个面板表面里——`flex: 1; min-height: 0; overflow-y: auto` 并自带内边距——因为中央列是 `overflow: hidden`，且不再提供设置内容列。此前返回裸段落的读取中与失败状态，现在也渲染在同一个表面内。

测试随表面一起迁移：每个插件规格在它的假 root 条目上声明 `main` 与 `sidebar.panellist`，断言两处注册存在且 id 相同、断言图标以请求尺寸渲染、并断言 fiber 释放后两个座位都清空且在迟到的声明后重新建立。浏览器场景是 `apps/web/tests/fork-global-panels.e2e.ts`（由 `fork-settings-sections.e2e.ts` 改名）：它断言「全局面板」导航按顺序列出三行、逐个打开面板到达就绪标题且没有失败提示、断言设置对话框不再提供这三个名字，并断言新建会话会把选择清回会话。

## Alternatives considered

**保留为设置分区，只调整导航分组。** 问题在语义而不在位置：只读报告不是偏好设置，任何分组都改变不了这一点；它还会让报告继续留在「开会话就关闭」的模态框后面。

**注册一个带三个标签页的全局面板。** 三者读取不同命名空间、拥有各自的文案，且本就作为三个独立插件发布。带标签页的宿主需要一个所有者去持有另外两个面板的内容，而客户端分层禁止这样做：功能插件不能导入另一个功能插件的值。

**运行时导入 `dsh-brand` 来处理 `MainPanelId`。** 理由同上：模块图没有它的基线条目，而且该品牌只是编译期的。

**让侧边栏行可以再点一次回到会话。** `ui-sidebar` 与 `ui-layout` 是上游包，而返回路径已经存在且为用户所熟悉：点一个会话行或新建会话，两者都会调用 `selectPanel(null)`。为 fork 的位置调整去改共享导航行为并不值得；面板 README 改为记录刷新不保留选择这一限制。

**持久化被选中的面板。** layout store 是 root 作用域的内存状态，持久化视图选择需要一个本次改动并不创建的有主状态。刷新会回到会话，这被记录为已知限制。

## Consequences

三个报告无需打开设置、也无需选中会话即可阅读，设置对话框只列出真正持有偏好设置的页面。三篇 `2026-09-16-*-settings-section` 笔记记录的位置决定被本笔记取代；那些笔记继续持有它们关于 Remote 面、组件局部读取状态、不发送过滤条件的选择，以及读取时费用与结果信号语义的论证。

Host API、wire 类型、Remote 方法、会话事件与提示词都没有变化。Remote 面保持精确参数个数的调用约定，因此[设置页 Remote 参数个数笔记](../bug-fix/2026-09-17-settings-section-remote-arity.zh.md)的决定仍然有效，只有它的场景路径发生了移动。

重新生成的客户端 slot 目录（`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`）现在把三个面板列在 `main` 之下、把它们的图标列在 `sidebar.panellist` 之下，这正是 `cordis_inspect what:"client"` 提供给检查自身 UI 座位的模型的内容。

代价是每个包各自重复一段面板表面 CSS。没有把它提升为共享原语：`ui-primitives` 是唯一允许共享控件的地方，而三个 fork 本地、内容各异的面板还不足以支撑一次提升。
