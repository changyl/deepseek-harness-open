# Agent Note: Settings sections pass every declared Remote parameter

Status: implemented

English | [中文](2026-09-17-settings-section-remote-arity.zh.md)

## Problem

The three client Settings sections this fork adds — the token-usage panel, the durable project board, and the outcome-signal panel — each read their Remote namespace with a short argument list: `ctx.remote.usage.query()`, `ctx.remote.project.list()`, `ctx.remote.effectiveness.query()`. Every one of those descriptors declares one optional filter parameter, and the generated Client face types it as `filter?: UsageFilterWire`, so the call sites type-check.

The Client gateway does not accept an omitted parameter. `TypertGatewayClient.prepareInvocation` computes `expected = descriptor.parameters.length`, without excluding an absent optional parameter, and throws `client api: usage/query expected 1 argument(s), got 0` before `connection.rpc.call` runs. The sections fold any rejection into their `error` state, so all three panels drew `暂时无法读取…，请重试。` and sent no HTTP request at all, while the Host controllers answered the same methods correctly over direct RPC.

`acceptsUndefined` is a wire-level marker that an absent *value* is allowed — the Host skips a missing field for it — not a licence to omit the argument on the way out. The established call convention is already the explicit one: `ui-agent-preset`'s settings store passes `undefined` for the optional `expectedRevision` and documents why.

## Decision

Each of the three sections passes the declared parameter explicitly: `query(undefined)`, `list(undefined)`, `query(undefined)`. The Client gateway keeps its exact-arity contract, the descriptors keep the optional filter, and the Host's absent-filter behaviour is unchanged.

## Alternatives considered

**Teach the Client gateway to accept omitted trailing optional parameters.** One change instead of three, and it would match the generated `filter?:` type. Rejected: that gateway is shared transport, and arity checking is what makes a descriptor mismatch fail at the call rather than at a mis-decoded Host argument. Every existing caller of an optional parameter passes it explicitly, so relaxing the rule here would widen a contract to hide three call sites.

**Make the filter required on the wire.** Rejected: the Host treats an absent filter as "the whole corpus", and the `/usage`, `/project`, and `/effectiveness` commands and the `project` tool read the same services without naming one.

**Drop the filter parameter from these three descriptors.** Rejected: it is the seam the panels would need for a scoped read, and removing it is a Host API change for a Client call-site defect.

## Consequences

The three panels read their namespaces and render. No session event, prompt, tool schema, or wire format changed, so recorded-session snapshots do not move.

Coverage: each section's browser-plugin spec asserts the injected read calls its namespace method with the declared argument (`toHaveBeenCalledWith(undefined)`), which fails against the omitted-argument form; [the fork Settings scenario](../../../../apps/web/tests/fork-settings-sections.e2e.ts) boots the shipped Web composition and asserts every panel reaches its ready heading with no failure notice and no page error.
