# Agent Note: 跨改动步进保留对比布局

Status: implemented

[English](2026-09-16-change-layout-across-navigation.md) | 中文

## Problem

右侧 Sidebar 的文本预览用单栏或两栏（横向对比）绘制某一处改动。读者选了横向对比后再用「上一处 / 下一处」遍历本轮改动，只要步进落到另一处改动就会退回单栏：正文把布局记成 `{ seq, mode }`，只有在导航仍指向同一个 `changeSeq` 时才读回它，因此步进按构造即重置。

步进不只改变正文绘制的内容。在某个文件区域的两端继续步进会打开相邻改动，而那处改动可能属于另一个文件；Sidebar 按内容身份去重打开：同一文件只在同一个 tab 内重新导航，另一个文件则在同一个 pane 里新建 tab。因此需要跨越整轮遍历保留的布局，既不能放在正文组件里，也不能放在某一个 tab 里。

## Decision

`TextState.changeLayout`（`'change' | 'split'`，默认 `'change'`）保存一个会话的对比布局，只由 store 的 `laidOut` 这一个 action 写入。pane-tab 槽是会话作用域的，因此步进打开的每个文件 tab 读取的都是同一个字段：读者的选择跨改动、跨文件、跨 tab、跨正文重挂载与渲染器切换保留，另一个会话仍从单栏开始。

整文件视图仍按改动保存。正文用一条 `{ seq }` 记录被换成整文件的那一处改动，因此「上一处 / 下一处」依然落在改动上——只是按会话布局绘制——而「本次改动 / 显示完整文件」控件的语义不变。两个头部控件的文案、按下状态与处理都保持不变；只有栏数被持久化。

## Alternatives considered

**把布局按 tab 存进 store，与 wrap、滚动偏移并列。** 改动最小且对称。否决原因：步进到另一个文件的那一处改动会新建 tab，读者恰好在离开选定布局的那个文件时丢掉它。

**把布局放在正文组件里但不带 seq 键。** 完全不用改 store。否决原因：某个 tab 不再是聚焦 tab 时其正文会卸载，因此第一次步进到另一文件的 tab、以及每次切换 tab 都会丢掉选择。

**通过导航参数把布局传给下一处改动。** 步进可把当前布局交给它落到的下一处。否决原因：它为一处尚未显示的改动写入布局，仍然到不了另一文件已打开的 tab，而且把视图偏好放进了改动索引的线上词汇。

**把整文件视图也持久化，作为第三种布局取值。** 否决原因：「上一处 / 下一处」的意义就是遍历改动：落在整文件、改动不被绘制的那一步读起来像没反应，因此整文件视图按设计重置，而对比布局不重置。

## Consequences

读者在整轮改动的审阅期间一直保持两栏，包括步进为其他文件打开的 tab；重新载入或切换渲染器也不再丢失该选择。代价是：选中两栏后，步进到的每一处改动都要把整份文件分页读完才能定位改动——这正是当初显式选择对比的那一处已经付出的读取。

[Sidebar 预览 README](../../../../packages/client/ui-sidebar-documentpreview/README.zh.md) 记录了被持久化的布局，[预览规格](../../../../packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx) 钉住该行为：导航到另一处改动仍保持 `data-change-mode="split"`，从整文件视图步进会回到改动并按会话布局绘制，同一会话的第二个 tab 也绘制对比。[store 规格](../../../../packages/client/ui-sidebar-documentpreview/tests/store.client.spec.ts) 钉住该字段不属于 tab 桶，并在 `forget` 后保留。
