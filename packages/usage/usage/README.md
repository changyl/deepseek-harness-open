---
description: "Token-usage and cost queries for a deployment: bucket and route totals, read-time pricing, and the ctx.usage report contract."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage

English | [中文](README.zh.md)

## Summary

Mount this package when a deployment must report token usage and cost from one place. Consumers call `ctx.usage.query(filter)` and receive token totals by bucket and route, the routes the pricing table does not name, and cost when a price exists. Amounts are integer micro-units of one currency, computed at read time from a registered pricing table, so no stored figure carries a stale rate. A composition with no provider fails the query instead of returning zero totals.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service beside one usage provider — normally `@deepseek-ai/dsh-usage-ledger` — and, when cost matters, one pricing table such as `@deepseek-ai/dsh-usage-pricing`.

### Composition

```yaml
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
- name: '@deepseek-ai/dsh-usage-pricing'
```

### What a report carries

| Field | Meaning |
|---|---|
| `totals` | Token buckets plus session, turn, step, and unknown-usage-step counts over the whole selected corpus |
| `routes` | The same token buckets split by provider and model; each row counts only its own route |
| `unpriced` | Contributing routes the registered pricing table does not name |
| `cost` | Amounts over the priced subset, absent when no contributing route was priced |

The four token buckets are disjoint: a cached prompt token lands in `cacheReadTokens` or `cacheWriteTokens` and never also in `uncachedInputTokens`. `turns` is session-scoped rather than route-scoped, so route rows carry no turn count; one turn can switch routes mid-turn and a per-route count would double-count it.

### Registering a provider and a table

`registerProvider` and `registerPricing` each accept exactly one registration, and a second call throws rather than replacing or merging. Both return the disposer that releases the registration on the mounting fiber. `price(provider, model)` resolves one route from the registered table. Cost is computed at read time and never stored, so a table change reaches the next query without rewriting any token fact.

### Filtering a query

| Field | Meaning |
|---|---|
| `from` / `to` | Inclusive lower and exclusive upper bound on contributing event time, Unix epoch milliseconds |
| `sessions` | Restrict to these session ids when present |
| `provider` / `model` | Restrict to one registered route |

An absent field does not filter; every present field narrows the result. The registered provider decides what selection means over its own facts.

### Failures and recovery

`query()` throws `UsageUnavailableError` when the composition mounts no provider, so an incomplete composition is visible rather than reported as zero totals. A route the table does not name appears in `unpriced` and contributes no amount; when no contributing route is priced, `cost` is absent rather than zero, and `cost.complete` is false whenever any contributing route is unpriced.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the join behind a report; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The service is the only place where token facts and prices meet. A provider answers a filter with totals and per-route totals and never prices anything; the deployment's table resolves a route to integer per-million rates and never reads a log. `assemble()` walks the provider's route rows once, prices the routes the table names through `routeCostMicros`, collects the rest into `unpriced`, and omits `cost` entirely when nothing was priced. Because prices are applied at query time, replacing a rate card cannot disagree with the tokens it prices, and a caller cannot accidentally persist an amount that a later rate change would invalidate.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service class: registration, the provider-plus-pricing join, and `UsageUnavailableError` |
| [`src/types.ts`](src/types.ts) | Report, bucket, count, filter, and pricing types |
| [`src/cost.ts`](src/cost.ts) | `routeCostMicros`: integer micro-units per million tokens, rounded once |
| [`src/totals.ts`](src/totals.ts) | Pure bucket and count arithmetic shared by providers and consumers |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the report contract is not enough. They move from the subsystem reference to the two packages that complete a composition.

- [Usage subsystem](../../../docs/subsystems/usage.md) — the report, pricing, and provider contracts with their exact fields.
- [Usage ledger package](../usage-ledger/README.md) — the durable provider that folds canonical session logs into token facts.
- [Usage pricing package](../usage-pricing/README.md) — the deployment-owned rate card, including its runtime-editable settings namespace.
- [Usage package map](../README.md) — the three packages of this family and their repository position.

-----

<a id="model-experience"></a>
## Model Experience

### Token accounting service

#### What the model sees

Nothing. The service answers `ctx.usage.query()` for host-side consumers and registers no tool, prompt section, or session event of its own; a value it returns reaches a model only if a consumer renders it through that consumer's surface.

#### Token effect

Zero: every figure is read from already-logged facts after the request completed, so the service adds no tokens to any request.

#### KV Cache effect

None: the service never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a report describes and when its cost is absent. They are current package constraints, not a task backlog.

- **No rate card ships with the harness** — prices are deployment data, so a composition that mounts no pricing table reports every route as unpriced and carries no `cost`.
- **A report prices only the routes the table names** — `cost.complete: false` means `totalMicros` understates the true cost rather than measuring it, and an unnamed route contributes no amount even though its tokens are counted.
- **One provider and one pricing table per composition** — a second `registerProvider` or `registerPricing` throws instead of merging, so a deployment with several sources must aggregate them before registering.
- **`turns` is session-scoped** — route rows carry no turn count, and `totals.turns` counts distinct turns across the selected sessions, not turns per route.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns one registration pair and one pure arithmetic function whose result is a total function of its arguments. The relationships it relies on — a single provider and a single pricing table per composition, and rates expressed as non-negative integer micro-units per million tokens — are contracts of the registering provider and pricing table, enforced at their own entry points rather than by an independent observation this package could check.
