# Agent Note: 命令面板中的新建会话

Status: implemented

[English](2026-09-20-palette-new-session-focus.md) | 中文

## Problem

在随包交付的 Web 组合中，从 Web 命令面板选择**新建会话**没有任何效果，且光标停在 document body 而不是输入框。面板的其他行都正常，这正是该缺陷看起来像是「某些行」的原因。

同一个行上叠了两个彼此独立的原因。

面板在 `inject` 回调运行时就读取了一次可选的工作区导航：`ctx.inject(['slots', 'shortcuts', 'commandUi', 'sessions', 'locale'], scope => { workspace: scope.get('uiWorkspace') })`。面板等待的是命令面与会话控制器；工作区 UI 还要额外等待它的目录选择 Remote。当选择器 Remote 更晚挂载时，`ui-workspace` 在该回调之后才 apply，被捕获的字段便永远是 `undefined`。于是 `this.deps.workspace?.startSession()` 静默地什么都不做——把一个只解析一次的可选依赖误当成了可选依赖。

焦点丢失在同一个字段解析成功之后仍然独立存在。[命令面板选择后的输入框焦点](2026-09-16-composer-focus-after-palette-pick.zh.md)为动作、裸宿主命令、停止与已落实的弹窗交还了光标，并有意把新建会话排除在外，理由是「它启动的会话由输入框自身的解锁流程聚焦」。该理由只对全新创建的会话成立。`UiWorkspace.connectWorkspace` 会复用当前工作区已有的空白会话，而面板通常正是从这个空白会话的 hero 打开的：输入框不会重新挂载，它的解锁 effect 不会再次运行，面板取走的光标无处可去。

## Decision

工作区导航在每次选择时读取，而不是在注册时捕获。`CommandPaletteDeps.workspace` 是一个解析函数，`index.ts` 传入 `() => scope.get('uiWorkspace')`，选择时调用它。`ctx.get` 读取全局服务存储，因此在本插件激活之后才注册的服务仍能被找到。

`UiWorkspace.startSession(workspaceId?)` 以流程最终落到的 Session 兑现，未解析出工作区或请求被后续导航替代时兑现 `undefined`。落点只在该流程内部可观察：`openWorkspace` 通过既有的 `beforeOpen` 回调报告它，被替代的请求永远不会走到该回调，因此 `startSession` 在那里捕获它，而不去扩大 `openWorkspace` 自身的契约。

面板的「新建会话」行通过 `ctx.commandUi.focusComposer(sessionId)` 聚焦该落点。全新创建的会话会在流程兑现之后才挂载输入框，因此这次交还找不到绑定，由输入框的解锁 effect 取得光标；被复用的空白会话则已有挂载的输入框，这正是此前完全没有归属的情形。本条取代了上一份记录中的新建会话条款；它记录的其余交还路径保持不变。

## Alternatives considered

**在面板的 `inject` 中声明 `uiWorkspace`。** 它让顺序变得显式，也是改动最小的方案。否决原因：等待一个不存在的服务的 Cordis fiber 会永远停在 PENDING，而工作区 UI 对本插件而言明确是可选的——没有挂载工作区 UI 的部署会连命令面板、快捷键注册表和所有命令行一起失去，而不只是新建会话。

**通过嵌套的 `scope.inject(['uiWorkspace'], …)` 绑定并发布给控制器。** 注册时机因此显式。否决原因：它为一个每次选择至多读取一次的值引入可变字段和第二条生命周期，而且控制器还必须在绑定与释放之间始终保持正确。

**在 `UiWorkspace.startSession` 内部聚焦。** 少一个调用点。否决原因：交还光标属于取走光标的那个界面。侧边栏的新建会话按钮也调用 `startSession`，它的点击本来就把焦点留在按钮上；agent preset 的创建入口则是从设置页发起的；让导航动作自带焦点策略会同时作用于它们。

**导航落实后聚焦「当前会话」，不引入落点。** 完全不需要改契约。否决原因：`current` 取决于中途插入的导航恰好选中了什么，读者在流程中途转移后，光标会被拉到一段无关的对话里。

**让输入框在每次 hero 渲染时取焦点。** 无需触碰工作区导航即可覆盖被复用会话的情形。否决原因：该情形下没有任何变更事件触发，这条规则会退化为在无关渲染时聚焦，并从读者刚刚移到的控件上抢走光标。

## Consequences

在 Workspace UI 晚于命令面板激活的 Web 组合中，**新建会话**会真正导航，并在选择结束后把光标落在它所落到会话的输入框里。命令行、停止、动作与弹窗保持上一份记录所记的行为。

`UiWorkspace.startSession` 的返回类型从 `void` 变为 `Promise<SessionId | undefined>`。忽略该结果的调用方——侧边栏的注入面与工作区浏览行——不受影响；这个 promise 是无输入框调用方拿到该流程复用或新建会话的唯一途径。

覆盖：[面板规格](../../../../packages/client/ui-command-palette/tests/palette.client.spec.ts)固定落点交还、未报告落点的被替代流程，以及没有工作区导航的部署；[面板浏览器插件规格](../../../../packages/client/ui-command-palette/tests/browser-plugin.client.spec.ts)经真实注入面固定同一次交还；[工作区服务规格](../../../../packages/client/ui-workspace/tests/workspaces-service.client.spec.ts)固定 `startSession` 兑现的落点、解析为 undefined 的无目标与失败流程，以及不报告落点的被替代流程；[工作区 apply 规格](../../../../packages/client/ui-workspace/tests/apply.client.spec.ts)跟进新的返回类型。没有会话事件、提示词、工具 schema 或线上格式发生变化，因此录制的会话快照不会移动。
