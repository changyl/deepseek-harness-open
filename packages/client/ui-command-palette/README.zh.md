---
description: "Web 命令面板与全局快捷键注册表：面向命令面板使用者，以及需要绑定按键的功能作者，提供覆盖命令目录与当前对话操作的 Cmd/Ctrl+K 界面。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-command-palette

[English](README.md) | 中文

## 概述

本包拥有 Web GUI 的键盘界面：`ctx.shortcuts`——其他客户端插件用于绑定组合键的全局 keydown 注册表——以及一个跨整个框架的 overlay 条目，渲染 Cmd/Ctrl+K 背后的命令面板。打开面板时，它会通过 `ctx.commandUi.palette` 一次性读取当前会话的命令，在其前面加上本界面自己拥有的两个操作——新建会话、停止正在运行的轮次——在你输入时对已加载的行做本地排序，并在不触碰输入框草稿的情况下派发选择。它不改变模型看到的任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟的工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载本插件后，面板在应用任何位置都可以呼出：Cmd/Ctrl+K 打开它，Cmd/Ctrl+Shift+P 同样可以打开，同一个组合键再次按下即关闭。

行来自两个来源。「操作」分区是本界面自己拥有的内容：始终有「新会话」，当前会话有正在运行的轮次时有「停止生成」。其下的命令与输入框 `/` 菜单在行首展示的行完全相同，分区顺序也相同——先是 `file`、`goal`、`plan`、`feedback`，再是 `compact`、`permission`、`model`、`export`，随后是目录顺序中的其他命令。需要参数的行会在描述旁展示其参数提示。输入时按名称与本地化标题排序；留空则展示分区顺序。

上箭头与下箭头移动高亮，Enter 运行高亮行，Escape 与点击外部关闭面板。鼠标同样可用：悬停即高亮，点击即运行。

### 选择会做什么

客户端命令贡献项或被装饰的宿主命令会打开自己的弹窗或运行自己的动作，与从菜单选择该行完全一致。其他宿主命令以裸命令行分离执行，因此 `/plan` 会进入计划模式，`/compact` 会立即压缩。命令面板不会向输入框插入任何内容，也不会从中删除任何内容——命令面板的选择不拥有任何命令 token，所以你输入的草稿会留在原处——并且选择完成后光标回到输入框：动作、裸宿主命令与「停止」在派发时立即回到，新建会话则在新会话流程报告其落到的会话后回到（该流程复用的当前空白会话不会重新挂载输入框，因此不会自行取得焦点）。会打开弹窗的命令则把光标留在弹窗，弹窗落实时再交还。

没有当前会话时，面板只列出「新会话」并给出说明，因为命令是按会话解析的。

### 绑定其他快捷键

`ctx.shortcuts.register({ id, keys, run })` 添加一个全局绑定并返回 disposer；注册是调用方 fiber 上的 effect，因此插件的组合键会随它一起离开。`keys` 是以 `+` 连接的修饰键加一个按键（`mod+k`、`mod+shift+p`），其中 `mod` 接受平台命令键或 Control。匹配是精确的：`mod+k` 不会因 `mod+shift+k` 触发。重复的 id、未知修饰键或缺少按键会在注册时抛错，而不是等到第一次按键。按注册顺序第一个匹配的绑定会运行，事件随即被消费；正在输入法组字的事件，或已被其他处理函数消费的事件，不会被触碰。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`CommandPaletteController` 就是全部行为：一个 overlay 渲染的快照 store，以及一组动词（`open`/`close`/`toggle`、`setQuery`、`move`、`highlight`、`run`），注入面与快捷键绑定都调用它们。`open()` 记录当前会话 id，立即发布操作行，并启动一次加载；`load()` 读取 `ctx.commandUi.palette(session, signal)` 并追加命令行。加载代数计数器加上 `AbortController` 使已关闭或被取代的面板不写入任何内容，因此缓慢的目录不会重新打开已被关闭的界面。

行只有数据。`PaletteEntry` 是判别联合——`new-session`、`stop` 与 `command`（后者携带读取其目录时所针对的会话 id）——选择按该判别字段派发：`ctx.uiWorkspace.startSession()`、所绑定会话的 `cancel()`，或 `ctx.commandUi.run(name, session)`。工作区导航在每次选择时读取，绝不在注册时捕获：命令面板等待的是命令界面与会话控制器，而工作区 UI 还需要它的目录选择 Remote，因此可能更晚注册。新建会话聚焦 `startSession()` 兑现的那个会话的输入框；全新创建的会话则会自行挂载输入框，由其解锁 effect 取得光标。贡献项的图标不会进入行：`ComponentType` 既不是 JSON 兼容值也不是回调，而 UI 域只共享这两类值，因此 overlay 按条目类型各画一个字形。

overlay 注册进跨框架的 `shell.overlay` 列表坑位，并通过共享的 `Modal` 原子组件渲染；后者把卡片 portal 到 body、模糊页面，并拥有遮罩点击与 Escape 键。命令面板自身只处理上箭头、下箭头与 Enter；搜索输入框在打开时取得焦点并保持焦点，高亮是虚拟的，由卡片滚动到可见位置。

命令界面上的 `run(name, session)` 是无输入框的派发路径：它优先使用可用的贡献项，其次是对可解析宿主行生效的装饰，最后是宿主行的裸命令行。贡献项或装饰的弹窗以命令面板 token 段打开，该段不会从草稿中消费任何内容；宿主命令分离执行，准入失败与其他分离执行一样被路由到输入框提示通道。

文案位于 `commandPalette` locale 命名空间，并在每次打开时重新读取，因此语言切换会作用于下一次打开的面板。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当问题不在命令面板自身行为时，阅读这些页面。

- [ui-commands](../ui-commands/README.zh.md)——本包消费的命令目录与 `palette()`/`run()` 组合。
- [ui-layout](../ui-layout/README.zh.md)——声明 `shell.overlay`，即命令面板占用的跨框架层。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md)——浏览器插件行如何加载并注册坑位。
- [Slots 参考](../../../docs/subsystems/slots.zh.md)——坑位种类、作用域，以及注册方获得的 props 份额。
- [Web 命令面板 Agent Note](../../../.agents/notes/implemented/feature/2026-09-14-web-command-palette.zh.md)——为什么命令面板是独立包，以及为什么它是命令目录之上的客户端界面。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只列出当前会话的命令，并通过宿主已有的命令通道落实选择，不添加自己的提示词段落、工具 schema、工具结果或模型请求。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下是命令面板当前的限制，而不是待办清单。

- **行在每次打开时只读取一次**——可用性、停止操作背后的运行状态与命令目录都在面板打开时读取。面板打开期间开始或结束的轮次不会改变其行；重新打开就是刷新。
- **行不展示各命令的图标**——贡献项的图标组件无法随渲染状态传递，因此每个命令行共用一个字形。恢复逐命令图标需要一条不把组件类型放进共享数据的通道。
- **需要参数的宿主命令以裸形式运行**——选择会执行 `/name`；提供参数仍需在输入框中输入该行。行会展示命令的参数提示，使这一缺口可见。
- **组合键由组合固定**——没有面向用户的按键设置；部署方通过编辑绑定它们的 bundle 行来更改按键。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：**不发布配套文件。本包不发出任何 Cordis 事件，不拥有任何跨插件可变状态，其两处注册——快捷键绑定与单一 overlay 条目——通过 HMR 安全测试证明可释放。
