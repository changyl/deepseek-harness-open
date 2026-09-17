# 本 fork 新增的功能

[English](fork-features.md) | 中文

`deepseek-harness-open` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork，在上游应用之外附带下列能力。每项能力都是本仓库中的一个插件或客户端包，由 `cordis.yml` 层决定挂载或省略；下文各节说明读者可见的行为、负责实现的包，以及这些包记录的限制。

## 评审已应用的文件改动

右侧 Sidebar 会把 agent（智能体）工具写入或编辑的文件绘制为 diff 卡片，chat 视图的「本轮文件改动」一行也能在对应轮次应用的改动处打开同一个文件。卡片提供 **Accept this change** 与 **Revert this change**：接受即保留文件，回滚则重放 `tool/result` 记录的 hunk，把文件恢复到该改动之前的内容。两种决定都会作为持久化的 `change/review` 事件追加到会话，因此刷新或 fork 都能重建。

[`dsh-change-review`](../packages/fs/change-review/README.zh.md) 记录决定并执行回滚；[`dsh-change-review-context`](../packages/context/change-review-context/README.zh.md) 把模型上次消息之后产生的决定汇报给模型，使模型重新读取已被回滚的文件，而不是继续相信自己先前的改动。Web 界面位于 [`dsh-client-ui-sidebar-documentpreview`](../packages/client/ui-sidebar-documentpreview/README.zh.md) 与 [`dsh-client-ui-deliverables`](../packages/client/ui-deliverables/README.zh.md)。

- 接受会记录决定，磁盘上的文件保持不变；回滚会写回改动前的内容，并记录 `reverted`。
- 写入任何内容之前，每个已记录的 hunk 都会与当前文件核对，且一个请求内的全部改动都会先完成定位再做第一次拼接，因此只要有一个 hunk 陈旧就以 `409` 拒绝整个请求，所有文件保持原样。
- 新建不会记录 hunk，因此无法回滚；改动记录之后文件内容已被推进的，一律拒绝而不是被覆盖。
- 决定只会追加到处于活动状态的会话，且给模型的提示最多列出十二项决定；同一改动被决定两次时只列一次，取其最后一次决定。
- 评审的单位是一处改动而非一个 hunk：没有逐 hunk 选择，也没有与工作区的 diff。

## 打开命令面板

Cmd/Ctrl+K 与 Cmd/Ctrl+Shift+P 可以在 Web GUI 的任意位置打开覆盖整个框架的命令面板。面板列出当前会话可运行的每条命令，外加本界面自己拥有的两个操作——新建会话，以及在有轮次运行时停止该轮次——并在读者输入时对已加载的行做本地过滤与排序。选中一项会运行该命令，不触碰输入框草稿，也不打开输入框下拉菜单。

[`dsh-client-ui-command-palette`](../packages/client/ui-command-palette/README.zh.md) 同时拥有该 overlay 与 `ctx.shortcuts`——其他客户端插件用于绑定组合键的唯一 document keydown 注册表：绑定是调用方 fiber 上的 effect，因此插件的组合键随插件一起释放；组合键在注册时即被解析与校验，因此格式错误的 spec 或重复的 id 会在插件加载时失败，而不是在第一次按键时失败。`ctx.commandUi` 提供 `palette(session, signal)` 与 `run(name, session)`，供没有输入框在视图内的界面使用。

- 每次打开面板只读取一次行数据，输入时仅对已加载的行重新排序，不再发起查询。
- 行的分组顺序沿用输入框 `/` 菜单的顺序，包含客户端贡献与装饰项。
- 逐命令图标、行数据实时刷新与参数输入不属于面板：命令行共用一个字形，带参数的命令以裸形式运行并显示其提示。
- 选择结束后光标回到输入框：动作、裸宿主命令以及界面自己的「停止」在派发时即回到，会打开弹窗的命令则在弹窗落实时回到。
- 面板中的任何内容都不会到达模型，面板也不新增任何提示词、工具 schema 或会话事件。

## 查看轮次结束时的任务报告

轮次结束时，[`dsh-task-report`](../packages/session/task-report/README.zh.md) 把该轮次自身的日志窗口折叠为一份 Markdown 报告，写入会话工作区的 `.dsh/reports/`，并记录一条持久化的 `task-report/generated` 事件。[`dsh-client-ui-task-report`](../packages/client/ui-task-report/README.zh.md) 把该事件渲染为轮次动作条上方的一行紧凑信息，给出改动文件数、新增与删除行数，以及验证命令通过、失败或无结果的数量，并提供一个打开已写入 Markdown 的控件。`/report` 命令可按需重新生成最近一个已结束的轮次。

- 该链路是确定性的且不依赖模型：报告引用该轮次的请求与收尾文本，改动取自第一方 `write` 与 `edit` 工具附加在结果上的 `meta.diffs`，验证结果则读取 shell 渲染所用的同一批 `[exit code: N]` 标记。
- 事件携带的是结论而不是文件本身；无论写入是否成功都会追加，因此只读会话也会记录其工作区为何未被改动。
- 只有 `write` 与 `edit` 会产生改动证据，因此由 shell 命令创建的文件不会出现在报告中。
- 验证结果来自解析而非结构化数据，所以既没有退出码、也没有超时、信号或错误标记的命令会被记为未知。
- 每个轮次一份报告，以轮次编号为键存放在共享目录命名空间中；负载数组有上限（默认 50 个改动文件、20 条验证命令），且该插件只随 `dsh-web-app` bundle 发布。

## 委派给专用子 agent

[`dsh-agent-definitions`](../packages/subagent/agent-definitions/README.zh.md) 是 `ctx.agentDefinitions` 上的提供方注册表，负责合并各提供方目录、解析重名并校验每个候选项；[`dsh-agent-definitions-filesystem`](../packages/subagent/agent-definitions-filesystem/README.zh.md) 在项目、自定义与用户根目录中发现扁平的 `<name>.md` 文件，解析其 YAML frontmatter 与 persona 正文；[`dsh-tool-subagent`](../packages/subagent/tool-subagent/README.zh.md) 向模型提供 `agent_type` 参数，并把可用名称作为一条持久化目录消息发布，模型据此按列表中确切的名称选择专用者。

一份定义就是某个被扫描根目录顶层的一个 `<name>.md` 文件。`name` 与 `description` 必填；`tools`、`model`、`reasoning_effort` 与 `max_depth` 可选；出现未知 frontmatter 键会连同警告拒绝整个文件，而不是被忽略。

- 定义映射到委派 seam 已有的字段——persona 正文、工具过滤器、Agent 路由与深度上限——且只能收窄：每个列出的工具都必须已经对该 agent 可见，所有拒绝都发生在子 agent 存在之前，子 agent 仍然加入其父级的组合。
- 进程内的 `spawn` 与 `fork` 后端支持定义；进程外的 ACP、Codex、Claude Code 与 SDK 提供方不声明任何启动时能力，也不提供 `agent_type`。
- 该注册表是挂载在宿主组合中的进程级服务，随包发布的 `standard` 与 `ptc` preset 只挂载文件系统提供方，因此 `agent_type` 只出现在真正能解析它的组合中。
- 每次读取注册表都会重新列出所有提供方，且文件系统提供方不安装监视器，因此新增、修改或删除的定义要到下一次读取才出现。
- 被选中的定义名称刻意不持久化，因此之后的注册表变更只会影响新的委派，无法回溯归因到更早会话所用的定义。

## 在右侧 Sidebar 中编辑文本文档

[`dsh-client-ui-sidebar-documentpreview`](../packages/client/ui-sidebar-documentpreview/README.zh.md) 的纯文本、Markdown 与代码渲染器声明自己可编辑，tab 在预览之外还持有一个编辑会话。保存通过 [`dsh-api-workspace-files`](../packages/api/workspace-files/README.zh.md) 的 `workspaceFiles.write` 整文件写入；这是该服务唯一的变更操作，只有会话处于活动状态且其沙箱策略允许写入时才会执行。

- 草稿是整文件一次读取并以保留字节序标记的方式解码的，因此保存会逐字节往返读者未触碰的内容，包括结尾换行与 CRLF 换行。
- 保存会把草稿的来源版本作为守卫一并发送；已被推进的文件以 `workspace-file/stale-version` 拒绝，不写入任何内容。
- 该拒绝被报告为冲突，且恰好有两种解决方式：覆盖保存（省略守卫）与放弃并重新载入（重新整文件读取并采用另一位写入者留下的版本）。
- 其余每一种拒绝——只读会话、冷会话、后端失败——都会让草稿与其基线保持不变，因为原样重试是唯一合理的下一步。
- 编辑是整文件、UTF-8、基于朴素 `<textarea>` 的：没有语法高亮、行号与多光标；`maxFileBytes` 默认上限为 32 MiB；草稿能跨 tab 切换保留，但不能跨页面重新载入。

## 用被改动文件自己的语法读取 diff

右侧 Sidebar 会用其自身预览按文件路径选择的同一套 Shiki 语法来绘制改动，无论单栏改动还是两栏整文件对比，包括对比从文件中取出的未改动行。[`dsh-client-ui-primitives`](../packages/client/ui-primitives/README.zh.md) 的行构建器提供 `DiffHighlighter`，`DiffBlock` 与 `DiffSplitBlock` 接受可选的 `lang`；Sidebar 的 `text` tab 传入其路径映射到的语言。

- 每一侧的完整文本只分词一次，因此块注释或未闭合模板字符串内部的改动仍保留使其着色的上下文；分词结果按行构建器使用的同一套行号索引，语法报告的行数少于该侧行数时，多出的行保持纯文本而不是丢弃文本。
- 高亮是惰性且按视口触发的：屏幕外的卡片不付出任何代价，尚未加载语法时渲染的正是该行原本持有的纯文本。
- 高亮生效时，删除行与新增行使用带底色的行带，`- ` / `+ ` 前缀保持自己的颜色，因此一行属于哪一侧永远不依赖语法配色。
- 未传入语言的调用方不做分词、每一行都按纯文本绘制，chat 工具卡片正是如此。

## 把写入句柄冲突识别为可处理的状态

共享同一个会话根目录的两个 harness 实例会争用同一份跨进程写入租约。[`dsh-api-session-controller`](../packages/api/session-controller/README.zh.md) 把这种争用归类为 `session/agent-busy`，并附带原因「关闭另一个打开了该会话的 harness 实例，或等它的打开操作结算后重试」，而不是折叠为未分类的 `gateway/internal` 失败。该拒绝是调用方可以据以行动的状态，而不是内部故障。

## 延伸阅读

- [架构](architecture.zh.md) 给出这些包所加入的插件组合地图。
- [能力服务](capability-seams.zh.md) 定义上述 seam 遵循的 Service Definition、Service Provider 与 Consumer 三种角色。
- [开发](development.zh.md) 介绍检出、测试通道，以及改动这些包要经过的门禁。
- [配置目录](config-catalog.zh.md) 列出每个已挂载插件的受校验配置字段。
