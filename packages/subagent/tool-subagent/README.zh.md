---
description: "面向模型的 subagent 委派工具，供用户与维护者配置、组合或排查基于 subagent 提供方的委派。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-subagent

[English](README.md) | 中文

## 概述

使用本包可为 agent 提供一个具名工具，把工作委派给已配置的子 agent 后端。`one-shot` 模式下，调用默认等待子 agent；`continuable` 模式下，调用默认在后台启动持久化子 agent，并返回可用于后续消息的 id。受支持的后端还可公开获准的子级 LLM 提供方、模型与推理等级供模型选择。每个实例均可设置子 agent 的 persona、工具权限与深度限制，失败的运行会返回错误，而非部分成功。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

每个委派目标挂载一个实例，且每个实例的 `toolName` 必须不同。工具与其提供方同时存在、同时消失，因此同级加载顺序与提供方重新加载都不会让工具悬空。

### 最小配置

先加载 subagent 服务、一个进程内或远程后端与本工具，然后指定提供方名称。此组合暴露一个委派给 `spawn` 后端的 `subagent` 工具：

```yaml
- name: '@deepseek-ai/dsh-subagent'
- name: '@deepseek-ai/dsh-subagent-spawn-in-process'
- name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | 必填 | `ctx.subagents` 上的提供方名称（如 `spawn`、`fork`、`acp`） |
| `toolName` | `subagent` | 面向模型的工具名称；每个已加载实例必须不同 |
| `modelSelectionSettings` | `false` | 为每个顶层 Session 读取宿主的精确路由授权偏好；常驻 preset 观察匹配 Session，直接 Agent setup 则显式传入其 Session；要求提供方支持 `agentOptions` |
| `enableRunInBackground` | `true` | 公开 `run_in_background`；禁用时也会拒绝强制后台调用 |
| `backgroundMode` | `one-shot` | 后台策略：`one-shot` 默认前台调用；`continuable` 默认后台调用，并要求提供方具备 `prepareContinuable` 能力 |
| `agentOptions` | — | 配置的子级 `provider`、`model`、适配器所有的 `reasoningEffort` 与正整数 `maxTokens` 默认值；要求提供方支持 `agentOptions`，并会覆盖提供方持有的路由默认值 |
| `persona` | — | 每个子 agent 独立的 persona；要求提供方具备 `persona` 能力 |
| `toolFilter` | — | 每个子 agent 独立的全局工具限制；要求提供方具备 `toolFilter` 能力 |
| `maxDepth` | Host 设置（`1`） | 绝对委派深度上限（`0` 禁止委派）；`'provider-managed'` 不向进程外提供方发送上限 |
| `agentCatalog` | `false` | 在已挂载 `ctx.agentDefinitions` 且本实例的工具注册为可见注册时，发布持久的可用 subagent 目录 |
| `catalogDescriptionMaxLength` | `500` | 每个目录条目渲染的规范化定义描述最大长度；为不小于 3 的整数 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-subagent)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 前台与后台模式

`one-shot` 策略下，省略 `run_in_background` 会在前台等待并返回子 agent 的最终文本；`run_in_background: true` 会启动一个归父级所有的普通后台任务，并返回 `started background subagent job <id>`，可用 `job_output` 收集、用 `job_kill` 停止。

`continuable` 策略下，省略或为 `true` 的 `run_in_background` 会启动一个持久化子 agent，并返回 `started subagent <childId>`，不等待结果；子 agent 的 Activation 结束时，运行时投递一条结算通知，可选的 `send_message` 工具会向它发送更多工作。把 `run_in_background` 设为 `false` 可在前台等待结果。

`maxDepth` 限制递归深度（`0` 禁止委派）；省略时，每次委派读取 Host 当前的 `subagent.maxDepth` 设置，初始值为 `1`。数值深度要求提供方具备 `depthLimit` 能力；`'provider-managed'` 把预算留给进程外提供方。当提供方支持时，`persona` 与 `toolFilter` 会配置每个子 agent；工具在达到上限时仍然可见——每次尝试启动都会检查调用 agent 的当前深度，被拒绝时返回出错的工具结果。

### 选择子级 LLM

设置 `modelSelectionSettings: true`，即可在组合每个全新顶层 Session 时读取宿主的 `subagent-model-selection` 偏好。没有已记录策略的恢复 Session 会保持禁用，包括显式为空的恢复。启用后，非空的精确 provider/model 路由列表会记录进 Session、由子 Session 继承，后续设置编辑不会改变它。工具随后公开可选的 `provider`、`model` 与 `reasoning_effort` 字段，并注册共享的 `list_subagent_models` 工具。此模式要求后端声明 `agentOptions`；两个进程内后端和 DSH SDK 支持该能力，而 ACP、Codex 与 Claude Code 会拒绝它，而不是忽略它。

一次调用需同时提供 `provider` 与 `model`；当配置值、父 agent 值或提供方持有的默认值能提供路由时，也可只提供推理等级。静态的 `provider.agentRouteDefaults` 在存在时构成提供方／模型基线；工具配置与模型字段会在路由相关强度合并和确切路由预检前覆盖它。没有这些默认值的提供方会使用父 agent 最新已记录请求中的兼容值，再使用父级首次请求前的创建选项，并保留配置的 `maxTokens`。更改路由但未显式提供推理等级时，会清除继承的路由自有等级，使所选模型解析自己的默认值。实时 LLM 适配器在创建子 agent 前校验有效路由。目录成员资格只提供建议，因此适配器接受时，模型可以使用未列出的 id。

### 选择专用 agent 定义

仅当组合已挂载 `ctx.agentDefinitions` 且委派提供方声明 `persona` 能力时，工具才会公开可选的 `agent_type` 参数；缺少任一条件时，指定定义的调用会在子 agent 存在之前失败。其值为可用 subagent 目录中的定义名称。

选中的定义会为该次调用覆盖已配置的子 agent 策略。其 persona 正文替换 `persona`，其 `tools` 允许列表替换 `toolFilter`。其 `model` 与 `reasoning_effort` 位于调用自身的 `provider`、`model`、`reasoning_effort` 参数与已配置的 `agentOptions` 之间，并要求启用模型选择且 Session 已授权该路由。其 `max_depth` 只会收紧已配置的 `maxDepth`，因此生效上限取两者中的较小值。定义中缺省的字段保持已配置行为不变。

所有拒绝都发生在子 agent 存在之前：未知或不可用的定义、定义了调用 agent 看不到的工具、提供方无法执行的 `tools` 或 `max_depth`，以及模型选择被禁用时的定义路由。定义名称不会持久化到子 agent descriptor 中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具如何镜像提供方生命周期并结算运行；可观察行为已在[使用本包](#use-this-package)中说明。

### 设计理念

一个实例就是一个提供方加一个工具名称。插件镜像提供方生命周期：具名提供方出现时注册工具，提供方离开时释放工具，因此同级加载顺序与 HMR 替换不会让工具悬空。直接 Agent setup 显式传入尚未发布的 Session，并在发布前等待安装完成。由设置控制的常驻 preset 通过 `agent/created` 接收每个匹配 Agent，从其 Session 选择策略，并等待通过其 Context 发起的安装；安装失败会拒绝创建。提供方无法执行的数值型 `maxDepth` 或已配置 LLM 选择会在挂载时失败，而不是在首次委派时失败。每个工具作用域内最多一个实例可以拥有模型选择，因为 `list_subagent_models` 使用全局名称。

### 前台结算

前台调用会等待 `run.result`，把每个非完成终止原因映射为错误标题，追加提供方诊断与任何保留下来的部分 assistant 文本，并在返回前始终等待 `run.dispose()`；当结果收集与 dispose（资源释放）都 reject 时，出错结果会保留两项失败。

### 后台路由

一次性后台模式会注册一个归父级所有的普通 Task，其 done 通道结算启动，并在 detail 中保留终止原因与可选提供方诊断。可继续后台模式调用 `ctx.subagents.startContinuable()`，该调用在 inbox 接受时结算：子 agent 自此拥有自己的轮次，因此该调用既不等待也不收集结果。

### 随上下文变化的措辞

工具描述源自 `provider.inheritsParentContext`：全新子 agent 得到「it does not see this conversation」措辞，fork 子 agent 得到「it does not see the current in-flight turn」措辞，因此模型既不会复述、也不会省略并不存在的上下文。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 工具注册、生命周期镜像、模式解析、结果结算 |
| [`src/model-selection.ts`](src/model-selection.ts) | 请求／配置合并与实时 LLM 路由预检 |
| [`src/model-selection-settings.ts`](src/model-selection-settings.ts) | 为新 Session 读取的宿主所有 opt-in 设置 |
| [`src/model-selection-state.ts`](src/model-selection-state.ts) | 记录并继承已读取决定的 Session 事件 |
| [`src/list-models.ts`](src/list-models.ts) | `list_subagent_models` 运行时发现工具 |
| [`src/agent-catalog.ts`](src/agent-catalog.ts) | 持久的可用 subagent 目录文本、消息身份与发布决策 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面；它们从工具运行时行为进入它所委派其上的 seam，以及相邻的子 agent 工具。

- [Subagent 子系统](../../../docs/subsystems/subagent.zh.md)——提供方、一次性启动请求、可继续子 agent 与 Activation。
- [dsh-tool-subagent-control](../tool-subagent-control/README.zh.md)——可继续子 agent 的消息、中断与列表工具。
- [生成工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-subagent)——默认 schema 与各模式的措辞。
- [生成配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-subagent)——每个受支持配置字段。
- [后台优先的可继续委派](../../../.agents/notes/archived/feature/2026-08-11-background-first-continuable-delegation.md)——可继续工作为何默认在后台运行。
- [模型选择 subagent 路由](../../../.agents/notes/implemented/feature/2026-08-18-model-selected-subagent-routes.zh.md)——选择策略、继承、发现与 fork 限制。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

当提供方存在时，以当前实例配置的名称公开已生成的默认 [`subagent` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-subagent)。启用的 Session 策略会添加 `provider`、`model` 与 `reasoning_effort`，以及继承和选择指引；提供方必须支持 `agentOptions`。提供方是否继承上下文会改变工具描述和提示词描述。启用后台模式会添加 `run_in_background`：可继续模式会记录其默认值为 `true`、运行时结算通知与显式前台覆盖；一次性模式会记录其默认值为 `false`，以及用 `job_output` 收集或用 `job_kill` 停止的 job id。当工具在本次组装的作用域中可见时，一个 `tool:<toolName>` 系统提示词 section 会指示模型同时启动相互独立的可继续委派、在它们运行时继续工作，并且仅当下一步动作依赖结果时选择前台；工具限制会同时移除其 schema 和这段指引。当挂载 `ctx.agentDefinitions` 且提供方声明 `persona` 时，具备可用定义的组合还会添加 `agent_type`。

#### Token 影响

每个父级请求支付固定的 schema 成本；模型选择会增加三个参数，具备可用定义的组合还会添加 `agent_type`。每个提供方实例增加一个 schema，每个可继续实例还增加一个简短的系统提示词 section。

#### KV Cache 影响

只要提供方实例及其配置不变，前缀就保持稳定。适配器目录变化不会改变定义；子级路由覆盖可能使 fork 子 agent 无法复用继承的父级前缀。

### 模型选择与发现

#### 模型看到什么

Session 携带策略的 settings 控制实例会公开子级 LLM 选择字段与 `list_subagent_models`。可选 `ctx.llm` 服务不可用时，调用会失败。发现只返回精确路由策略中的已注册提供方与已公布模型；未授权提供方会在调用其适配器目录前被拒绝，精确查询也必须先获准，才会解析模型的推理强度与默认值。执行阶段会独立强制同一策略。

#### Token 影响

启用的组合中存在一个固定发现 schema。只有模型调用工具时，目录内容才进入 transcript。

#### KV Cache 影响

适配器注册与目录变化不会改变 schema 前缀。每个发现结果都追加在可复用前缀之后。

### agent 定义目录

#### 模型看到什么

设置 `agentCatalog: true` 时，只要已挂载 `ctx.agentDefinitions`、至少存在一个定义，且本实例的工具注册为可见注册，组合就会在首次请求前发布一条持久的、来源为 `plugin`（标识 `tool-subagent/agent-catalog`）的 user 消息。后续步骤会在获胜成员或渲染出的描述变化时发布替换列表，在最后一个定义消失后把列表退化为 `- (none)`，并在发现不完整时保留上次发布的列表。渲染文本不依赖发布它的实例，因此多个具备能力的委派工具只发布一份列表；描述会规范化空白、截断到 `catalogDescriptionMaxLength` 个字符，并转义 `<`、`>` 与 `&`。

##### 目录消息

```markdown
<system-reminder>
Specialized subagents may be available for delegation. Each one runs with its own system prompt and tool access. This complete list replaces every earlier available-subagent list in this session:

<available_subagents>
- `code-reviewer`: Reviews a change against this repository's standards.
</available_subagents>

When a task clearly matches a listed specialist, delegate to it with a delegation tool that offers `agent_type` and pass the exact listed name.
</system-reminder>
```

#### Token 影响

只要目录处于发布状态，每个 Session 一条简短固定的 user 消息；每个定义增加一行，其描述上限为 `catalogDescriptionMaxLength` 个字符。

#### KV Cache 影响

仅追加：未变化的列表不会被重新发布，变化的列表会在可复用前缀之后追加一条消息，而不会使更早的条目失效。

### 系统提示词

#### 模型看到什么

当 `enableRunInBackground` 与 `backgroundMode: continuable` 同时设置时，模型还会读到 `tool:<toolName>` 系统提示词 section，指示它把相互独立的可继续委派一起启动，并在它们运行时继续工作。使用默认工具名 `subagent` 时，section 文本为：

##### 工具指导 section

```markdown
Use subagent in the background by default. Start independent delegations together in one assistant message and continue useful work while they run. Set `run_in_background: false` only when your next action depends on that subagent's result. When a background run settles, the runtime sends you a notice containing its outcome and any final assistant message.
```

#### Token 影响

每个可继续实例一个简短固定 section，只要工具在作用域内，就由每个父级请求支付。

#### KV Cache 影响

只要 section 文本与工具存在性不变，前缀就保持稳定；移除工具或更改 section 会建立不同的父级前缀。

### 前台结果

#### 模型看到什么

调用会保留描述与提示词。成功时只包含子 agent 的最终文本；其他结果变为 `Error: <stop reason>`，随后在存在时附上安全的提供方诊断，再附上任何部分 assistant 文本。子 agent 中间步骤不会进入父级。

#### Token 影响

提示词与结果保留在父级历史中，直到上下文压缩（context compaction）；子 agent 工作上下文留在子 agent 中。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 后台结果

#### 模型看到什么

在配置的可继续模式下，启动时返回内容恰为 `started subagent <childId>`；在配置的一次性模式下，则返回 `started background subagent job <id>`。一次性模式下，通用 Task 接口提供后续状态、最终输出、取消响应与通知；若结果携带提供方诊断，失败状态的 detail 会包含它。可继续模式下，本工具不返回自己的结果：子 agent 的结算以服务负责的通知到达父级，独立加载的 `send_message` 工具投递后续消息，而通过其 id 查看子 agent 的 transcript（文本记录）即是其详细输出来源。

#### Token 影响

确认消息会被保留；一次性最终输出只在收集或注入时进入父级历史，而可继续子 agent 的输出绝不会通过本工具返回——其结算通知独立于任何工具结果到达。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本工具不返回或不强制执行什么；它们是当前包约束。

- **后台运行不通过本工具公开结果**——一次性任务的最终输出通过通用 Task 接口收集，可继续子 agent 的输出留在其自身会话中，按其 subagent id 读取。结算通知会说明该子 agent 如何结束，并携带其最终 assistant 输出中的非空文本，但它不是本次调用的返回值，也无法在此等待。
- **等待中的一次性实例较晚才发现重复名称**（`TODO(subagent-dup-toolname)`）——可继续实例会在插件应用期间预留提示词 section 名称，但若要阻止等待中的一次性实例回滚提供方注册，仍需要一份预期名称注册表。
- **随附 fork 工具不能选择子级 LLM 路由**——它们继承父级提供方与模型，使复制的对话前缀仍有资格复用 KV Cache。仅当路由变更能保留复用或公开有界重算成本时，才重新启用选择。
- **已配置的子 agent 策略按实例固定**——`persona`、`toolFilter`、`maxDepth` 与 `agentOptions` 来自所挂载实例的配置，通过 `agent_type` 选中的定义只能为单次调用收紧它们。未挂载 `ctx.agentDefinitions` 的组合，或缺少 `persona` 能力的提供方，无法选择任何定义。LLM 选择要求启用逐 Session 偏好，且提供方必须声明 `agentOptions`；两个进程内提供方和 DSH SDK 会声明该能力，而 ACP、Codex 与 Claude Code 会拒绝它，而不是忽略它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
