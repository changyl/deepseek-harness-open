# Agent Note: Reach the tool scheduler through the symbol registry

Status: implemented

English | [中文](2026-09-21-tool-scheduler-registry-symbol.zh.md)

## Problem

`@deepseek-ai/dsh-tools` publishes one staged scheduler view on its service under an internal symbol, and the [agent loop](../../../../packages/core/agent-loop/src/tool-calls.ts) looks it up to prepare, dispatch, finalize, and finish each call. The symbol was a module-local `Symbol('@deepseek-ai/dsh-tools.scheduler')`, so the lookup only worked while one copy of the package was loaded.

A CLI source launch loads two. The profile Loader registers the package's built artifact as the `tools` plugin, which creates the service, while the TypeScript path mappings resolve the imports *inside* that artifact to the package's source. Both copies evaluate, each with its own symbol, so `ctx.tools[TOOL_RUNTIME_SCHEDULER]` was `undefined` and every tool dispatch ended the turn with `Cannot read properties of undefined (reading 'prepare')`. The packaged installation loads one copy and was unaffected, so only `pnpm dsh` runs failed.

## Decision

The scheduler key comes from the global symbol registry: `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`. Both copies then name the same property, and the staged view the service installed is reached from either. This matches the existing registry-keyed handshakes for state that crosses package copies ([`dsh.subagent.*`](../../../../packages/subagent/subagent/src/internal.ts), [`dsh.typert.owned-value`](../../../../packages/typert/protocol/src/owned-value.ts), `cordis.shadow`).

The property stays omitted from the generated named service API, and `ToolRuntime` remains the only producer and the agent loop the only consumer.

## Alternatives considered

**Fix the source launch's plane mixing.** The defect is two module instances where the repository requires one; making the Loader resolve plugins through the same plane as the imports inside them would remove it at the root. That changes how every profile plugin boots — a much wider surface than the failing handshake — and the registry key keeps the source launch working without it.

**Keep `Symbol()` and require a single instance.** A supported launch mode would remain broken for every tool call, and the failure (`undefined.prepare`) names nothing about its cause.

**Resolve the scheduler structurally.** Probing the service for an object with `prepare`/`dispatch`/`finalize`/`finish` would hide a duplicate package rather than let it interoperate, and would accept any object with those method names.

## Consequences

Source launches dispatch tools again: the registered built artifact and the source copy agree on one key, so the loop reaches the view the service published. The duplicate copies themselves remain, which is the named gap: the module-local `WeakSet` behind `markAgentLoopRequest` is still per copy, so the agent-loop request invariant silently skips loop-built requests in a source launch instead of failing. Any future cross-copy handshake in this package needs the registry too.

Verification pins the key and its reachability in `packages/core/tools/tests/tools.spec.ts` and replays a real tool call through `pnpm dsh headless`, which failed before this change.
