# Agent Note: 把 Agent Teams 提升为正式发布包

Status: implemented

[English](2026-09-16-agent-team-package-promotion.md) | 中文

## Problem

五个 Agent Teams 包以 `@deepseek-ai/dsh-experimental-*` 之名从 `packages/experimental/` 发布，依据的是一条显式的发布例外。[2026-08-18 的 Note](2026-08-18-experimental-agent-teams-packages.zh.md)拥有该决定：这条例外让用户能从 npm 安装它们，同时它们的契约仍在变化。

这条例外已经完成了它的使命。实验组之外的发布包与应用不得在依赖区段中引用实验性包，因此已发布的 `dsh-base` 与 `dsh-web-app` 组合无法挂载 Team 服务、Team 工具或 Team 面板。该能力存在、有测试，却无法从用户实际运行的任何产品界面触达——能够挂载它的那些 profile 本身也是实验性的。

## Decision

五个包现在都是产品角色组中的普通发布成员，使用去掉 `experimental-` 前缀的稳定名称：

- `packages/subagent/agent-team` — `@deepseek-ai/dsh-agent-team`
- `packages/subagent/tool-agent-team` — `@deepseek-ai/dsh-tool-agent-team`
- `packages/client/ui-agent-team` — `@deepseek-ai/dsh-client-ui-agent-team`
- `packages/bundle/agent-team-profile` — `@deepseek-ai/dsh-agent-team-profile`
- `packages/bundle/agent-team-web-profile` — `@deepseek-ai/dsh-agent-team-web-profile`

浏览器层此后已退役。它唯一的那条 `ui-agent-team` 行由随包发布的 [`dsh-web-app`](../../../../packages/bundle/web-app/README.zh.md) 组合包挂载，因此 `agent-team-profile` 成为唯一仍作为独立可选层保留的 Team 组合包，面板也不再需要自己的组合。

这次提升删除了该例外，而不是把它留在那里不用。`scripts/experimental-package-policy.ts` 已删除；workspace 约束检查器现在要求每个实验性包都必须是私有的且不带任何发布元数据，不再保留 public 分支；发布族与 npm baseline 发布器通过常规的 `packages/!(experimental)/*/package.json` 模式纳入这些包；而 `dsh-release` 家族规范断言实验性子集为空，且这五个名称是其中的成员。

每一处引用都与这些包一起原子迁移：npm 名称、经 `git mv` 的目录、包清单及其 repository 目录、`peerDependencies`/`devDependencies`、Cordis 配置行、`tsconfig` 项目引用与路径别名、生成目录，以及提及它们的文档。宿主 profile 层保留原有职责——它正是启用 Team 服务、并禁用全局可续跑子级控制行的组合，因为 Team 工具同样占用了那些行所声明的 `list_agents`、`send_message` 与 `interrupt_agent` 名称；浏览器面板则由 `dsh-web-app` 直接挂载。晋升后的客户端面板只把 `@deepseek-ai/cordis` 声明为 peer，其余工作区包一律声明为开发依赖，因为 Web 构建会把它们打包进去。

## Alternatives considered

**保留实验性名称但照样挂载它们。** 依赖隔离规则的存在，是为了让稳定面不会在孵化中的包改变形状时被破坏。为了五个包而放宽它——何况已发布的 Web bundle 之后会依赖它们——等于用一项真实的保证换取一个组合，并且会让未来每一次提升都要逐案重新争论。

**提升这些包，但把例外清单作为记录保留。** 一份没有任何条目的例外清单，是一条无法被测试的策略，也是一个读者陷阱：检查器的 public 分支会成为死代码，而下一位作者还得重新发现这个组里没有任何包是公开的。删掉它，这条规则才重新成立。

**提升三个代码包，把两个 profile 层留在实验状态。** profile 是用户能够开启该能力的唯一途径；把它们留在实验状态会让该特性无法从已发布组合触达，并把一个决定拆到两条生命周期上。

**提升但不改生成目录。** 目录、模块图与能力缝图是其他作者阅读的地图。一次留下陈旧内容的改名，会让仓库描述已经不存在的包，而新鲜度门禁无论如何都会在下一次检查时抓到它。

## Consequences

Team 能力现在可以从产品组合触达，并与其他所有发布包承担同样的稳定性预期：它的服务、工具与面板契约不再能随意变化，破坏性变更需要走常规弃用路径。实验组重新变为仅私有，这使它的规则简单且可测试。

代价是这次提升是一次范围广、机械性的改动：五个目录被移动，对它们的每一处引用都必须在同一个提交里一起移动。它还让 2026-08-18 那篇 Note 存在的理由退休了；那篇 Note 作为"当初为何授予该例外"的记录保留，并在此处仅在命名决策上被取代。

## Testing

移动之后两个 TypeScript 聚合体都能通过类型检查（`tsconfig.host.json` 与 `tsconfig.client.json`），这正是 Cordis 行、项目引用与路径别名全部可解析的证明。五个包自身的测试规范原样运行，workspace 约束与发布族规范覆盖了被删除的例外，并且每个生成产物都重新生成并校验新鲜度：Cordis 目录、模块图、能力缝图与组合图、工具目录、配置目录以及持久化目录。文档配对重新录制，链接、换行与子系统页门禁均通过。
