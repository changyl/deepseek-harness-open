# Agent Note: 命令面板选择后的输入框焦点

Status: implemented

[English](2026-09-16-composer-focus-after-palette-pick.md) | 中文

## Problem

Web 命令面板在打开时取得焦点——搜索输入框正是读者输入以筛选行的位置——而它渲染在输入框并不拥有的跨框架 overlay 里。一次选择关闭了 overlay 并派发了命令，光标随卡片一起消失：哪里都不在。要接着输入消息，只能再点一次输入框。

命令面其实早已具备这套交还：`CommandUiRuntime` 维护按会话的焦点钩子，`PopupSelectController` 在弹窗落实或用 Escape 关闭时会调用它。但生产代码从未绑定过任何钩子，因此该调用是死代码，而选择路径——动作、裸宿主命令、停止——也从未调用它。同一缺口也影响输入框自己的 `/` 菜单：从 `/model` 打开弹窗再用 Escape 离开，同样会丢掉光标。

## Decision

输入框拥有自己的焦点，并把它注册给命令面。`SessionInputShell.focus()` 把 DOM 焦点放到编辑器根节点上，并由 Lexical 恢复选区；会话作用域物化时，`InputHub.shellFor` 通过声明式读取把它绑定进 `ctx.commandUi`，绑定随该作用域存亡。

命令面在每一次不打开弹窗的无输入框选择之后交还光标：动作贡献项或装饰在派发时交还，裸宿主命令在派发时交还而不等待远程结果，行已解析不到的选择同样交还，因为面板已经放手。弹窗持有焦点直到落实，届时再交还——无论来自面板还是 `/` 菜单。`focusComposer(sessionId)` 就是同一套交还的公开动词，面板自己的「停止」行用的正是它。New Session 不调用它：它启动的会话由输入框自身的解锁流程聚焦。

## Alternatives considered

**恢复面板打开前持有焦点的元素。** 通用对话框规则，且无需跨插件 API。否决原因：对会打开弹窗的选择，该恢复与弹窗自身的聚焦 effect 竞争；而从别处打开面板的读者会被送回那里，而不是命令所属的输入框。

**在会话输入契约上新增 `focus()`，每次调用时解析。** ui-commands 已为其分离执行的提示解析 `conversation.input`，该调用可照此办理。否决原因：它会扩宽一个被记为「冻结的输入机契约」的接口面，并取代弹窗控制器本就在消费的交还接缝。

**只为命令交还光标，不管「停止」。** 改动更小。否决原因：「停止」是同一张卡片上的选择、结局相同，漏掉它等于把报告的缺陷原样留在一行之隔处。

**等待远程结果后再聚焦。** 否决原因：命令执行期间输入框本就可用；若读者在结果落地前已经去做别的事，光标会被硬拉回来。

## Consequences

一次面板选择、以及在 `/` 菜单里落实的弹窗，都以光标回到输入框结束；原本是死代码的 Escape 路径也随之生效。没有会话事件、提示词、工具 schema 或 wire 格式变化，因此录制会话快照不发生移动。

覆盖：[命令面规格](../../../../packages/client/ui-commands/tests/service.client.spec.ts) 钉住动作、宿主行、落空与弹窗落实后的交还，以及未绑定会话的 no-op；[会话 apply 规格](../../../../packages/client/ui-conversation/tests/apply-inject.client.spec.tsx) 钉住按会话的绑定、它执行的聚焦与解绑；[面板规格](../../../../packages/client/ui-command-palette/tests/palette.client.spec.ts) 钉住「停止」、未绑定时的「停止」，以及命令行把光标交给命令面。
