---
description: "Deployment-owned route pricing for ctx.usage: per-million integer micro-unit rates, a runtime-editable settings namespace, and loud refusal of duplicate routes."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-pricing

English | [中文](README.zh.md)

## Summary

Mount this package to give `ctx.usage` a rate card. It registers one pricing table from the composition configuration and, when a settings provider is mounted, re-reads the `usage-pricing` settings namespace on every commit so rates can change without remounting. Rates are integer micro-units of one currency per million tokens, and a route the table does not name stays unpriced. A table that names one route twice is refused at load rather than resolved by whichever entry came last.

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

Mount it beside `@deepseek-ai/dsh-usage` when a deployment must report cost, and give it every route the deployment wants priced. Rates are deployment data: the values below are an example, not a shipped rate card.

### Composition

```yaml
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-pricing'
  config:
    currency: CNY
    version: '2026-09-16'
    routes:
      - provider: deepseek
        model: chat
        uncachedInputPerMillion: 2000000
        outputPerMillion: 8000000
        cacheReadPerMillion: 200000
        cacheWritePerMillion: 2500000
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `currency` | required | Currency of every rate in this table |
| `version` | required | Deployment-owned revision label echoed into every assembled report |
| `routes` | `[]` | Priced routes; a route absent here is reported unpriced |

### Route rates

| Field | Meaning |
|---|---|
| `provider` / `model` | The registered route these rates price |
| `uncachedInputPerMillion` | Micro-units charged per million uncached input tokens |
| `outputPerMillion` | Micro-units charged per million output tokens |
| `cacheReadPerMillion` | Micro-units charged per million cache-read input tokens |
| `cacheWritePerMillion` | Micro-units charged per million cache-write input tokens |

A rate of `0` declares that the provider does not charge for that bucket; it does not make the route unpriced.

### Runtime rate changes

When a settings provider is mounted, the plugin registers the `usage-pricing` namespace with the composition configuration as its base, then adopts every committed value wholesale. A committed value replaces currency, version, and routes together; nothing merges into the composed table. The namespace grammar admits lowercase words and single hyphens only, so the published namespace spells the dotted service name without its dot.

### Failures and recovery

A table naming one route twice is refused at load, and every adopted settings value is validated the same way, so an ambiguous rate card never prices a report. A missing `currency` or `version`, a negative rate, or a malformed `routes` entry fails configuration validation before the table reaches `ctx.usage`. Without the usage service the plugin stays pending, because it injects `usage`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how a table stays current; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

One `UsagePricingTable` instance lives for the plugin's lifetime and holds the current validated configuration, so a runtime edit reaches consumers without re-registering anything on `ctx.usage`. `registerPricing` is called once through `ctx.effect`, and the settings scope is registered only inside an `inject(['settings'])` callback, which is why a composition without a settings provider keeps the composed table unchanged. Route lookup keys a route by provider and model joined with a delimiter that cannot appear in either name, and `assertDistinctRoutes` runs both at construction and at every adoption, so a duplicate can neither load nor be introduced later.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, `UsagePricingTable`, duplicate-route validation, settings namespace wiring |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the configuration surface is not enough.

- [Usage subsystem](../../../docs/subsystems/usage.md) — the pricing and report contracts this table satisfies.
- [Usage service package](../usage/README.md) — the service that registers a table and prices reports with it.
- [Usage ledger package](../usage-ledger/README.md) — the durable provider whose route rows this table prices.
- [User settings subsystem](../../../docs/subsystems/settings.md) — namespace registration, layered resolution, and hot commits.
- [Usage package map](../README.md) — the three packages of this family and their repository position.

-----

<a id="model-experience"></a>
## Model Experience

### Deployment rate card

#### What the model sees

Nothing. The plugin registers a pricing table on `ctx.usage` and registers no tool, prompt section, or session event; a rate reaches a model only if a consumer renders a report through that consumer's surface.

#### Token effect

Zero: rates are read while a report is assembled, after the requests they price have completed, so the plugin adds no tokens to any request.

#### KV Cache effect

None: the plugin never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a rate card can express and how a runtime edit applies. They are current package constraints, not a task backlog.

- **The settings namespace is not the dotted service name** — the namespace grammar admits lowercase words and single hyphens only, so the published namespace is `usage-pricing` while other usage surfaces use the dotted name.
- **A committed settings value replaces the whole table** — currency, version, and routes are adopted together; a partial edit is not merged into the composed table.
- **An unpriced route is not a free route** — a route absent from `routes` contributes no amount and is reported as unpriced, whereas a rate of `0` is a declared price of zero for that bucket.
- **One table per composition** — `ctx.usage.registerPricing` refuses a second table, and this plugin registers exactly one, so several rate sources must be combined before configuration.
- **Rates cannot be finer than one micro-unit per million tokens** — rates are integers, so a smaller unit price is not representable and must be expressed by the currency's unit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin owns a validated configuration table and one registered `UsagePricing`. Its one checkable relation — that a table names each route at most once — is enforced by the same validation at construction and at every adopted settings value, and a duplicate registration surfaces through `ctx.usage.registerPricing` itself, so no independent observation remains for a companion to make.
