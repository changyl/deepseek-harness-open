# 实操手册：编写 agent 定义

[English](authoring-an-agent-definition.md) | 中文

agent 定义是一个可复用的专用 subagent，由委派工具按名称提供给模型选择。本指南编写一个这样的定义，并确认模型能够选中它；[文件系统提供方 README](../../packages/subagent/agent-definitions-filesystem/README.zh.md) 是文件格式、根目录与配置的参考，[专用 subagent Agent Note](../../.agents/notes/implemented/feature/2026-09-14-specialized-subagent-definitions.zh.md) 记录了定义为何只能收窄而不能授予。

前置条件：组合中挂载 `@deepseek-ai/dsh-agent-definitions`、`@deepseek-ai/dsh-agent-definitions-filesystem` 与 `@deepseek-ai/dsh-tool-subagent`。随附的 `standard` 与 `ptc` preset 三者皆已挂载，并在其 `subagent` 行上启用目录。

## 1. 选择定义所在的根目录

文件系统提供方按 rank 顺序扫描五个根目录，在同一注册表层内，rank 较小的定义在重名时胜出：项目的 `.dsh/agents`、项目的 `.agents/agents`、配置为 `customAgentDirs` 的目录、`<dshHome>/agents`（`$DSH_HOME` 或 `~/.dsh`），以及 `<agentsHome>/agents`（`$DSH_AGENTS_HOME` 或 `~/.agents`）。项目根目录是包含 `.git` 的最近祖先目录，不存在时使用本次查找的 cwd，且只有在提供 cwd 时才会扫描项目根。把每个仓库共享的定义放在用户根目录，把只属于单个仓库的定义放在项目根目录。

注册表层优先于这些文件 rank：由 preset 自身组装层注册的定义会替换全局层中的同名定义。[注册表 README](../../packages/subagent/agent-definitions/README.zh.md) 负责合并与重名规则，[文件系统提供方 README](../../packages/subagent/agent-definitions-filesystem/README.zh.md) 负责确切路径与 `includeDefaultRoots` 行为。

## 2. 编写定义文件

在被扫描根目录下直接创建平铺的 `<name>.md` 文件；子目录与非 Markdown 文件会被忽略。YAML frontmatter 位于两行 `---` 之间，闭合 `---` 之后的所有内容即子 agent 的 persona。

```markdown
---
name: migration-reviewer
description: Reviews a database migration for reversibility and lock impact.
tools:
  - read
  - grep
model: <model-id>
reasoning_effort: high
max_depth: 0
---

You review one database migration and report its problems in order of severity. You never edit files and you never delegate: report what the migration alone does not let you decide.
```

文件名只是便利；`name` 字段才是模型以 `agent_type` 传入的身份，也是重名时被替换的键。

## 3. 填写 frontmatter

- `name`（必需）——kebab-case 标识符，匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- `description`（必需）——目录展示给模型的简短非空路由描述。
- `tools`（可选）——子 agent 可调用的工具名，可为列表或一个逗号分隔的字符串；省略该字段即继承子 agent 的工具，因为显式空列表会被拒绝。
- `model` 与 `reasoning_effort`（可选）——子 agent 的 LLM 路由；委派工具实例必须已启用模型选择，且 Session 的路由策略必须授权该确切路由，否则调用会在子 agent 存在之前被拒绝。
- `max_depth`（可选）——限制继续委派的非负整数上限，只会降低工具实例已配置的上限。
- 其他任何键——未知的 frontmatter 键会让整个文件随警告被拒绝，而不是被忽略，因为被静默丢弃的 `tools` 会让子 agent 以完整的继承工具集运行。

同一条警告路径还覆盖：缺少 frontmatter 块、YAML 无效、`name` 缺失或不是 kebab-case、`description` 缺失，以及正文为空。[文件系统提供方 README](../../packages/subagent/agent-definitions-filesystem/README.zh.md) 是字段的穷尽式参考。

## 4. 把正文写成子 agent 的 persona

正文即子 agent 的 persona。工具会把它作为启动请求的 `persona` 传入，进程内后端将其安装为该子 agent 作用域内的 `deployment:persona-prefix` 段落，因此只对该子 agent 遮蔽部署 persona。它使用与部署 persona 相同的严格模板：每个完整的 `{{name}}` 组都必须解析为子 agent 提示词已注册的变量，格式错误、未知或取不到值的引用都会让该子 agent 的提示词渲染失败，而永不闭合的 `{{` 则保持为字面文本。[subagent 子系统](../subsystems/subagent.zh.md)记录了可接受的请求字段，[persona preset](../../packages/preset/persona/README.zh.md)把同一模板应用到整个部署。

## 5. 只收窄，不授予

每个字段都收窄子 agent 本会继承的组装。`tools` 成为子 agent 的允许列表，其中每个工具名都必须已对发起委派的 agent 可见，而 `max_depth` 只收紧上限。定义不授予任何插件，也不能改变子 agent 加入的组装，因此可以安全地取自 [agent preset](../../packages/preset/agent-presets/README.zh.md) 不会被信任的来源：preset 会选择自己的插件，属于受信任配置。

定义了发起委派 agent 看不到的工具名，或在提供方缺少 `toolFilter` 或 `depthLimit` 能力时携带 `tools` 或 `max_depth`，都会在任何子 agent 存在之前被拒绝。只有声明 `persona` 的提供方承载定义：进程内的 `spawn` 与 `fork` 后端。进程外 ACP、Codex 与 Claude Code 提供方不声明任何启动能力，SDK 提供方只声明 `agentOptions`，因此它们都不承载定义。

## 6. 让模型发现并选中它

配置了 `agentCatalog: true` 的委派工具实例在 `agent/pre-step` waterfall 上发布可用 subagent 目录。它按调用 agent 的 cwd 与作用域读取 `ctx.agentDefinitions.snapshot()`，并追加一条持久的 user 消息，其来源是已发布的 `plugin` 消息来源，因此该目录不新增会话格式类型。该消息自称完整列表，在获胜成员或渲染出的描述变化时替换先前列表，而在渲染文本不变时不发布任何内容。发现是每一步重新读取而非监视，且不完整的观测会保留上次发布的目录，而不是退役其中的名称。

模型把目录中的确切名称作为 `agent_type` 传入，工具据此解析该定义、对照提供方校验，并只对这一次调用生效。仅当已挂载 `ctx.agentDefinitions` 且所选提供方承载 persona 时该参数才存在，缺少任一条件的组合会拒绝指定定义的调用。[工具 README](../../packages/subagent/tool-subagent/README.zh.md)负责该参数与发布目录的措辞。

## 7. 验证

- 让 agent 执行一次委派，确认专用 agent 出现在会话 transcript 的目录消息中，并且指定它的委派以其 persona 与收窄后的工具运行。
- 故意破坏该文件：添加一个未知的 frontmatter 键，确认日志中出现 `agent definition <path> ignored: frontmatter field "<key>" is unsupported`，且该名称从不进入目录。
- 运行消费方的行为 spec：`pnpm exec vitest run packages/subagent/tool-subagent/tests/agent-definitions.spec.ts`。
- 编辑这些页面后运行文档检查：`pnpm run doc-sync`。
