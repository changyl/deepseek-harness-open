# Agent Note: 专用 subagent 定义

Status: implemented

[English](2026-09-14-specialized-subagent-definitions.md) | 中文

## Problem

委派对每个任务都组装同一个子 agent。一次 `subagent` 调用可以选择后台模式，以及在 Session 授权时选择子 agent 的 LLM 路由，但子 agent 的 persona、工具过滤器与深度上限来自所挂载的工具实例，并作用于该实例服务的每一次委派。没有任何机制让部署或用户一次性描述一个可复用的专用 agent——例如迁移评审者、测试作者——再由模型按任务选择。

可用的变通方案都因结构原因而失败。为每个专用 agent 挂载一个 `@deepseek-ai/dsh-tool-subagent` 实例，会让父级在每次请求上支付成倍的 tool schema，也无法保持工具名列表稳定；而 agent preset 会组装整个子 agent 组合，因此它会授予其所选插件的能力，并改变子 agent 加入父级组合的方式。

## Decision

专用 agent 现在是有自己能力 seam 的可编写数据。[`@deepseek-ai/dsh-agent-definitions`](../../../../packages/subagent/agent-definitions/README.zh.md) 是 Service Definition：`ctx.agentDefinitions` 上的分层提供方注册表，负责合并提供方目录、解析重名、校验每个候选项并加载获胜定义。[`@deepseek-ai/dsh-agent-definitions-filesystem`](../../../../packages/subagent/agent-definitions-filesystem/README.zh.md) 是 Service Provider：它发现项目、自定义与用户根目录中的平铺 Markdown 文件，并解析其 YAML frontmatter 与 persona 正文。[`@deepseek-ai/dsh-tool-subagent`](../../../../packages/subagent/tool-subagent/README.zh.md) 是 Consumer：它向模型提供新的 `agent_type` 参数，并发布持久的可用 subagent 目录。该 seam 专门化于它所扩展的 [subagent 能力 seam](2026-06-21-subagent-capability-seam.zh.md)。

### 每个专用 agent 一个平铺 Markdown 文件

定义是被扫描根目录顶层的一个 `<name>.md` 文件，包含 YAML frontmatter 与 persona 正文。`name` 与 `description` 必需；`tools`、`model`、`reasoning_effort` 与 `max_depth` 可选。未知的 frontmatter 键会让整个文件随警告被拒绝，而不是被忽略，因为被静默丢弃的 `tools` 会让子 agent 以完整的继承工具集运行；同一条警告路径还覆盖：缺少 frontmatter、YAML 无效、`name` 缺失或格式错误、`description` 缺失，以及正文为空。[文件系统提供方 README](../../../../packages/subagent/agent-definitions-filesystem/README.zh.md) 负责字段表、根目录清单以及根目录之间的优先级。

### 注册表在宿主平面，preset 只贡献提供方

`@deepseek-ai/dsh-agent-definitions` 是进程级服务，其注册按调用上下文的作用域归档，因此注册表行位于宿主组合中——Web bundle 把它挂在 preset roster 旁，理由与 `@deepseek-ai/dsh-skill` 位于 base bundle 相同——而随附的 `standard` 与 `ptc` preset 只挂载 `@deepseek-ai/dsh-agent-definitions-filesystem`。提供方的调用上下文是该 preset 的常驻作用域，因此它贡献的定义落入该 preset 的层，而服务本身对委派行仍然可达。只有挂载 preset 的 profile 才需要该注册表，因此没有 agent 平面的 profile 的委派工具与记录保持一致。

若 preset 直接声明注册表行，`agentDefinitions` 会发布到 root realm，`dsh-agent-presets` 会拒绝整个挂载：`row(s) published process-global service(s) [agentDefinitions]; a preset service must sit behind an 'isolate' realm or move to the host composition`。条目的局部 `isolate` realm 并不是修复方案——挂载会成功，而 `agent_type` 会静默消失，因为委派行与文件系统提供方都位于该 realm 之外，读取不到任何注册表。

### 定义映射到既有启动请求，并且只收窄

定义解析为委派 seam 已经携带的字段：正文成为 `SubagentStartRequest.persona`，`tools` 成为 `toolFilter`，`model` 与 `reasoning_effort` 并入 `agentOptions`，`max_depth` 并入 `maxDepth`。由于只有这些字段，定义绝不会授予发起委派的 agent 所没有的工具或插件：每个工具名都必须已对该 agent 可见，所有拒绝都发生在子 agent 存在之前，且子 agent 仍加入其父级的组合。[subagent 子系统](../../../../docs/subsystems/subagent.zh.md)负责这些请求字段。

这正是与 [agent preset](../../../../packages/preset/agent-presets/README.zh.md) 的区别：preset 选择会话运行的插件，属于受信任配置；而定义是只能收窄的路由数据。

### 模型从持久目录中获知名称

配置了 `agentCatalog: true` 的委派工具实例在 `agent/pre-step` waterfall 上发布目录。它按调用 agent 的 cwd 与作用域读取注册表快照，并追加一条持久的 user 消息，列出获胜的名称与描述，并声明自己是完整列表；模型通过把目录中的确切名称作为 `agent_type` 传入来选择专用 agent。该消息复用已发布的 `plugin` 消息来源，标识为 `tool-subagent/agent-catalog`，因此目录不新增会话格式类型。发布以渲染文本为幂等键：文本不变则不发布任何内容，成员或描述变化则替换先前的消息，而注册表观测不完整时保留上次发布的目录，而不是退役其中的名称。

### 只有进程内后端承载定义

仅当已挂载 `ctx.agentDefinitions` 且所选提供方声明 `persona` 时，工具才公开 `agent_type`；携带 `tools` 或 `max_depth` 的定义还要求该提供方具备 `toolFilter` 或 `depthLimit` 能力。进程内的 `spawn` 与 `fork` 后端声明这三项能力。进程外 ACP、Codex 与 Claude Code 提供方不声明任何启动时能力，SDK 提供方只声明 `agentOptions`，因此它们都不承载定义。

## Alternatives considered

**把专用 agent 表示为 agent preset。** preset 可以描述一个评审者，子 agent 可以加入该 preset 的组合而非父级的组合。拒绝原因：preset 会授予其所选插件的能力，这会让每个定义都成为受信任产物；每个专用 agent 都需要一整套组合；并且子 agent 加入不同组合会改变委派、提示词段落与作用域遍历所依赖的「子 agent 加入父级组合」生命周期。

**把 agent 专属元数据放进 skill frontmatter。** skill 文件本身已带 frontmatter 且按仓库编写。拒绝原因：这会让一个消费方支配 [skill Service Definition](../../../../packages/skill/skill/README.zh.md)。skill 是另一项能力，有自己的提供方与消费方角色，而收窄子 agent 工具与路由的专用 agent 并不是 skill。

**为每个定义注册一个委派工具实例。** 现有工具已接受按实例配置的 persona、工具过滤器与深度上限。拒绝原因：每个实例都会增加一份父级在每次请求上都要支付的 tool schema；随着定义文件出现与消失而注册、注销工具，会对在线工具注册表造成注册抖动；不断变化的工具列表也会破坏 KV Cache 复用所需的前缀稳定性。

**为目录新增一种会话消息来源类型。** 拒绝原因：新增来源类型是对会话日志的结构性改动，需要提升 `SESSION_FORMAT_VERSION`、新增以版本命名的[迁移包](../architecture/2026-08-10-session-log-version-mechanism.zh.md)，并更新两个 SDK 的期望输出（[会话格式状态](../../../../docs/session-format-status.zh.md)、[测试政策](../../../../docs/testing.zh.md)）。已发布的 `plugin` 消息来源本就承载带来源的上下文消息，因此目录复用它。

**把定义名称持久化到子 agent descriptor 中。** 拒绝原因：它承担同样的格式变更成本，而 descriptor 已记录解析后的 persona、工具过滤器与 Agent 路由，正是冷恢复所重建的内容。名称只能说明是哪个文件产生了这些效果，而当前没有任何消费方需要这种归属。

**在注册表上做运行时定义注册。** `registerProvider()` 可以接受插件提供的一次性定义，而不是从来源加载。拒绝原因：当前没有任何生产者需要它；文件系统提供方拥有发现职责，注册表内的定义会在已经拥有这些职责的提供方之外，再需要自己的生命周期、校验与变更通知。[注册表 README](../../../../packages/subagent/agent-definitions/README.zh.md) 记录了由此产生的限制。

## Consequences

部署或用户现在在被扫描根目录下编写 `<name>.md`，模型在持久目录中看到获胜名称，指定其中一个的委派会以该定义的 persona、工具允许列表与深度上限运行。目录不新增会话格式类型，因此没有随之而来的版本提升、迁移包或 SDK 期望输出变更。只有当组合挂载注册表与声明 persona 能力的提供方时，委派工具 schema 才增加 `agent_type`；随附的 `standard` 与 `ptc` preset 在其 `subagent` 行上正是如此。

代价记录在包 README 中。注册表的每次读取都会重新列举每个提供方，因此发现成本按每次目录读取与每次选择支付；文件系统提供方不安装监视器，因此新增、编辑或删除的定义要到下一次读取才会出现；不完整的发现观测会保留上次发布的目录，而不是把瞬时失败呈现为删除；定义名称被刻意不持久化，因此后续注册表变更只影响新的委派，无法回溯归属于更早会话使用过的定义。进程外 ACP、Codex 与 Claude Code 子 agent 以及 SDK 子 agent 完全不承载定义。

三个行为 spec 固定了已交付路径：`packages/subagent/agent-definitions/tests/agent-definitions.spec.ts` 覆盖合并、层优先级与候选项校验；`packages/subagent/agent-definitions-filesystem/tests/agent-definitions-filesystem.spec.ts` 覆盖根目录发现与文件解析；`packages/subagent/tool-subagent/tests/agent-definitions.spec.ts` 覆盖 `agent_type`、收窄拒绝，以及目录的发布、替换、退役与发现不完整时的保留上次可用行为。`apps/cli/tests/web-agent-presets.e2e.ts` 启动随附 Web 组合、组装 `standard`，并断言 `subagent` 工具暴露 `agent_type`——这条断言区分宿主平面放置与挂载成功但 realm 隐藏注册表的组合。
