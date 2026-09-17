# Token usage and cost

English | [中文](usage.zh.md)

`@deepseek-ai/dsh-usage` exposes one report assembled from a registered usage provider and a registered pricing table through `ctx.usage`. The service owns the report contract, the registration lifetimes, and the pricing arithmetic; a provider owns durable token facts and never prices anything; a deployment owns its prices and never reads a log. Consumers read finished reports and never price anything themselves, which is what keeps a client from having to know a route's rate card.

Source: [`packages/usage/usage/src/types.ts`](../../packages/usage/usage/src/types.ts) · [`packages/usage/usage/src/index.ts`](../../packages/usage/usage/src/index.ts)

## Report contract

`UsageReport` is the assembled answer to one `ctx.usage.query(filter)`.

| Field | Meaning |
|---|---|
| `totals` | Bucket and count totals over the whole selected corpus |
| `routes` | The same token buckets split by one provider/model route; each row's counts cover only that route |
| `unpriced` | Contributing routes the registered pricing table does not name |
| `cost` | Amounts over the priced subset; absent when no contributing route was priced |

## Token buckets

The four buckets are disjoint: a cached prompt token is counted once, as `cacheReadTokens` or `cacheWriteTokens`, and never also as `uncachedInputTokens`.

| Bucket | Meaning |
|---|---|
| `uncachedInputTokens` | Input tokens the provider billed without a cache read or write |
| `outputTokens` | Completion tokens the provider produced across every step |
| `cacheReadTokens` | Input tokens the provider reported as served from its prompt cache |
| `cacheWriteTokens` | Input tokens the provider reported as written into its prompt cache |

## Counts

| Count | Scope | Meaning |
|---|---|---|
| `sessions` | Corpus | Distinct sessions contributing at least one foldable event |
| `turns` | Session | Distinct turns with at least one closed step across the selected sessions |
| `steps` | Route and total | Closed steps |
| `unknownUsageSteps` | Route and total | Steps whose adapter reported no usage record; their tokens are unknown, not zero |

`turns` is session-scoped rather than route-scoped: one turn can switch routes mid-turn, so a per-route turn count would double-count it. `UsageRouteTotals` therefore carries `sessions`, `steps`, and `unknownUsageSteps`, but no `turns`.

## Cost

`UsageCost` describes the priced subset of one query: `currency`, `pricingVersion`, `totalMicros`, `complete`, and one `UsageCostRoute` per contributing route with `micros` and `priced`. Amounts are integer micro-units of the table's single currency; `routeCostMicros` multiplies each bucket by its per-million rate, sums the four products, and rounds once at the end. A route the table does not name is reported in `unpriced` and contributes no amount; `complete` is false when at least one contributing route is unpriced, which means `totalMicros` understates the true cost rather than measuring it. When no contributing route is priced at all, `cost` is absent rather than zero, so a consumer that sees no cost reports the amount as unavailable.

## Pricing contract

`UsagePricing` is what a deployment registers: one `currency` for every rate in the table, a deployment-owned `version` echoed into each report, `price(provider, model)` returning the declared `UsageRoutePrice` or `undefined`, and `routes()` listing every declared route. `UsageRoutePrice` carries the four per-million rates — `uncachedInputPerMillion`, `outputPerMillion`, `cacheReadPerMillion`, `cacheWritePerMillion` — as integer micro-units. Prices are deployment data: the harness ships no default table, and a rate of zero is a declared price of zero for that bucket, not an unpriced route.

## Provider contract

`UsageProvider` is the Service Provider role: a stable `name` for diagnostics and `query(filter)` returning `UsageProviderResult`, which is `totals` plus `routes` as `UsageRouteTotals[]`. A provider reads durable token facts and never prices anything, so a deployment can replace the ledger without touching the report contract.

## `ctx.usage`

The service registers `ctx.usage` and joins the two roles.

| Member | Behavior |
|---|---|
| `registerProvider(provider)` | Registers the one provider; a second registration throws; returns the exact disposer |
| `registerPricing(pricing)` | Registers the one pricing table; a second registration throws; returns the exact disposer |
| `price(provider, model)` | Resolves one route's declared price, or `undefined` when no table is registered or the route is unpriced |
| `query(filter)` | Asks the provider for `filter` and prices the routes the registered table names |

An absent filter selects everything the provider holds, and `UsageFilter` narrows by `from`, `to`, `sessions`, `provider`, and `model`. `query()` throws `UsageUnavailableError` when no provider is registered: an incomplete composition fails loud instead of returning zero totals. Cost is computed during assembly from the table registered at that moment, and no amount is ever stored.

## Packages

- [`usage/`](../../packages/usage/usage/README.md) — the service, report types, and pricing arithmetic.
- [`usage-ledger/`](../../packages/usage/usage-ledger/README.md) — the durable provider that folds canonical session logs into token facts.
- [`usage-pricing/`](../../packages/usage/usage-pricing/README.md) — the deployment-owned rate card and its settings namespace.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxusage--usageservice"></a>

### `ctx.usage` — `UsageService`

Token-usage and cost service. A composition mounts exactly one provider (the durable token source) and at most one pricing table; a query joins the two, so cost can never diverge from the tokens it prices.

```ts cordis-catalog
/**
 * Register the one usage provider that answers queries. Registering twice
 * is a composition error and throws rather than silently replacing the
 * first provider.
 * @param provider - the provider supplying durable token facts.
 * @returns the exact disposer that unregisters this provider.
 */
registerProvider(provider: UsageProvider): () => void

/**
 * Register the one pricing table that prices query results. Registering
 * twice is a composition error and throws rather than letting two rate
 * cards disagree silently.
 * @param pricing - the deployment's pricing table.
 * @returns the exact disposer that unregisters this table.
 */
registerPricing(pricing: UsagePricing): () => void

/**
 * Resolve one route's declared price.
 * @param provider - registered provider name.
 * @param model - provider-owned model id.
 * @returns the declared price, or `undefined` when no table is registered or the route is unpriced.
 */
price(provider: string, model: string): UsageRoutePrice | undefined

/**
 * Answer one usage query, pricing every route the registered table names.
 * @param filter - selection narrowing the corpus; an absent filter selects everything the provider holds.
 * @returns totals, per-route totals, the unpriced routes, and cost over the priced subset.
 * @throws UsageUnavailableError when no provider is registered.
 */
async query(filter: UsageFilter = {}): Promise<UsageReport>
```

Source: [`packages/usage/usage/src/index.ts`](../../packages/usage/usage/src/index.ts)

<a id="ctxusagecontroller--usagecontroller"></a>

### `ctx.usageController` — `UsageController`

Host service backing the generated `ctx.remote.usage` namespace. Every response is a detached plain value; the controller holds no cache, so a client always reads the service's current answer for its filter.

```ts cordis-catalog
/**
 * Answer one usage query, priced by the deployment's registered table.
 * @param filter - selection narrowing the corpus; an absent filter selects everything the provider holds.
 * @returns totals, per-route totals, the unpriced routes, and cost over the priced subset.
 * @throws RemoteError `usage/unavailable` when the composition mounts no usage provider.
 */
@Remote async query(filter?: UsageFilterWire): Promise<UsageReportWire>
```

Source: [`packages/api/usage/src/index.ts`](../../packages/api/usage/src/index.ts)
<!-- END GENERATED cordis-surface -->
