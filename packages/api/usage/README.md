---
description: "Host Remote owner for the usage namespace: one query method answering token totals, per-route totals, unpriced routes, and read-time cost over the usage seam."
kind: "package-reference"
---
# Usage Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-usage` exposes the generated `ctx.remote.usage` namespace for a browser statistics surface. One `query(filter?)` call returns the same report `ctx.usage` assembles — token totals, per-route totals, the routes no rate card names, and cost over the priced subset — mapped onto plain wire values. The controller adds no policy of its own: provider selection, pricing, and unpriced reporting all live in the usage service, so a call always reflects the pricing table registered at that moment. A composition that mounts no usage provider answers `usage/unavailable` rather than zero totals.

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

Mount this package as a Loader entry in the Web application, beside the usage service and one provider.

```yaml
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
- name: '@deepseek-ai/dsh-api-usage'
```

The `dsh-web-app` bundle mounts exactly that arrangement: `usage` and `usage-ledger` come from the base layer, and this controller is the only thing the Web layer adds. Its generated `./typert` export carries the Host descriptors into the strict Typert registry, and its generated `./remote` export is the Client contribution that `dsh-api-remotes` mounts, which is what makes `ctx.remote.usage` callable from the browser.

`query(filter?)` is the namespace's only method. An absent filter selects everything the provider holds; a present one narrows by `from`, `to`, `sessions`, `provider`, and `model`. The request is validated with a strict schema at the wire boundary, so an unknown key or a wrongly typed field raises `gateway/bad-request` with the codec's issues and never reaches the provider.

The answer is a set of plain copies, never a domain object: `totals` carries the four disjoint token buckets plus session, turn, step, and unknown-usage counts; `routes` carries the same buckets and counts per route; `unpriced` names the contributing routes the pricing table does not declare; and `cost` is present only when at least one route was priced. The mapping is written field by field, so renaming a field in the usage domain is a compile error here rather than a silent wire change. `UsageRouteTotalsWire` deliberately has no `turns` field, because one turn can switch routes and a per-route turn count would double-count it.

Cost keeps the service's read-time semantics. Amounts are integer micro-units of the table's currency, `pricingVersion` names the revision that produced them, and `complete: false` marks a total that omits an unpriced route's share — so a client renders an incomplete amount as a floor, never as a measurement. A composition with no pricing table mounted therefore answers tokens with no `cost` at all.

Expected failures reach the caller as stable Remote codes. A composition without a usage provider raises `usage/unavailable` carrying the service's own message, because an incomplete composition is not an empty corpus. Any other provider failure propagates unchanged, so a ledger fault stays visible as itself.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The controller is a projection, not an owner. It injects `ctx.usage`, validates the one untrusted input at the wire boundary, calls the service, and maps the answer onto wire types. It holds no cache and no state, so two calls with one filter read the service twice and a rate-card change between them is visible on the second call.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `UsageController`: the `@Remote` method, the request schema, and the report-to-wire mapping |
| [`src/types.ts`](src/types.ts) | The wire types the Client consumes plus the `usage/unavailable` code declaration |

### Service and namespace

`UsageController extends TypertRemoteService` registers the service key `usageController` and the wire namespace `usage`, which is what a Client reaches as `ctx.remote.usage`. Its `static inject = ['usage']` names the only service it answers from; the Gateway discovers the namespace through `typertRemote`, so a Host composition without the gateway can still mount the controller.

### Methods

| Method | Request | Answer |
|---|---|---|
| `query` | `filter?`: `from`, `to`, `sessions`, `provider`, `model`, all optional | `UsageReportWire`: totals, per-route totals, unpriced routes, and optional cost |

### Failures

| Code | Raised when |
|---|---|
| `gateway/bad-request` | The filter fails the strict wire schema; the details carry the codec issues |
| `usage/unavailable` | The composition mounts no usage provider; the details carry the service's message |

### Wire values

| Type | Meaning |
|---|---|
| `UsageFilterWire` | Selection one call carries |
| `UsageTotalsWire` | Counts plus the four disjoint token buckets |
| `UsageRouteTotalsWire` | The same figures for one route, without `turns` |
| `UsageRouteRefWire` | One route in the unpriced list |
| `UsageCostWire` | Currency, pricing version, integer micro-unit total, completeness, and per-route shares |
| `UsageReportWire` | One assembled answer |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the wire namespace to the seam behind it, then to the Remote model that carries the call.

- [Usage subsystem](../../../docs/subsystems/usage.md) — the report contract, the token buckets, and the provider and pricing roles behind every answer.
- [usage group map](../../usage/README.md) — the service, the ledger, the rate card, and the `/usage` command.
- [api group map](../README.md) — the other Remote namespaces and how they are assembled.
- [API Gateway reference](../../../docs/api-gateway.md) — the Typert programming model, generation pipeline, and runtime invocation.
- [Typert subsystem reference](../../../docs/subsystems/typert.md) — the contracts shared by protocol, Gateway, and consumer assemblies.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. `usage.query` answers a browser surface with figures about requests that already happened; it adds no prompt section, no tool schema, and no session event.

#### Token effect

None. The namespace never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries.

#### KV Cache effect

None. Reading usage does not alter a request, so no cached prefix can be invalidated by it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what this namespace can answer today. They are current package constraints.

- **Reads only** — the namespace exposes no write or mutation; a client cannot change a project, a price, or a stored figure through it.
- **No streaming or change feed** — the only method is unary, so a statistics page polls, and the freshness of a figure is the client's polling interval.
- **No breakdown beyond the provider's** — per-session and per-turn figures appear only where the usage provider itself reports them; the controller neither groups nor recomputes.
- **Mounted only where the Web bundle is** — a Host composition without this row has no `ctx.remote.usage`, and the Client contribution is absent with it.
- **No effectiveness aggregation endpoint** — outcome signals remain a session projection, so a client reading them does not go through this namespace.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The controller owns no durable state and no diverging observation of its own; it validates one request and maps one service answer, and its spec pins both the mapping and each failure classification.
