# Agent Note: Reach the tool scheduler through the symbol registry

Status: implemented

[English](2026-09-21-tool-scheduler-registry-symbol.md) | 中文

## Problem

`@deepseek-ai/dsh-tools` 在它的服务上以内部符号发布唯一的分阶段调度器视图，[agent loop](../../../../packages/core/agent-loop/src/tool-calls.ts) 通过查找该符号来 prepare、dispatch、finalize 与 finish 每次调用。该符号原本是模块局部的 `Symbol('@deepseek-ai/dsh-tools.scheduler')`，因此只有在本包只加载一份时查找才成立。

CLI 源码启动会加载两份。profile Loader 把本包的构建产物注册为 `tools` 插件并由此创建服务，而 TypeScript 的路径映射把该产物*内部*的 import 解析到本包源码。两份都会求值，各自持有自己的符号，于是 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 为 `undefined`，每次工具分发都以 `Cannot read properties of undefined (reading 'prepare')` 结束轮次。打包安装只加载一份，因此不受影响，只有 `pnpm dsh` 运行失败。

## Decision

调度器键取自全局符号注册表：`Symbol.for('@deepseek-ai/dsh-tools.scheduler')`。两份随后命名同一个属性，服务安装的分阶段视图可从任意一份访问。这与既有的、跨包副本状态的注册表键控交接一致（[`dsh.subagent.*`](../../../../packages/subagent/subagent/src/internal.ts)、[`dsh.typert.owned-value`](../../../../packages/typert/protocol/src/owned-value.ts)、`cordis.shadow`）。

该属性仍不出现在生成式具名服务 API 中，`ToolRuntime` 仍是唯一生产者，agent loop 仍是唯一消费者。

## Alternatives considered

**修复源码启动的平面混用。** 缺陷在于本应只有一份模块的地方出现了两份实例；让 Loader 与产物内部 import 解析到同一平面可以从根本上消除它。但这会改变每个 profile 插件的启动方式——比出问题的交接面宽得多——而注册表键无需此举即可让源码启动可用。

**保留 `Symbol()` 并要求单实例。** 一种受支持的启动模式会继续在每次工具调用时失败，而该失败（`undefined.prepare`）完全没有说明原因。

**以结构方式解析调度器。** 探测服务上具有 `prepare`/`dispatch`/`finalize`/`finish` 的对象会掩盖重复的包，而不是让它们互通，并且会接受任何具有这些方法名的对象。

## Consequences

源码启动重新能够分发工具：注册的构建产物与源码副本就同一个键达成一致，因此 loop 能访问服务发布的视图。重复副本本身仍然存在，这就是已记录的缺口：`markAgentLoopRequest` 背后的模块局部 `WeakSet` 仍按副本划分，因此在源码启动中 agent-loop 请求不变量会静默跳过 loop 构造的请求，而不是失败。本包未来任何跨副本交接都需要同样使用注册表。

验证在 `packages/core/tools/tests/tools.spec.ts` 中固定该键及其可达性，并通过 `pnpm dsh headless` 重放一次真实工具调用——该调用在本次改动前失败。
