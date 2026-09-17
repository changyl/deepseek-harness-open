# Token 用量与成本

[English](usage.md) | 中文

`@deepseek-ai/dsh-usage` 通过 `ctx.usage` 暴露一份由已注册用量提供方与已注册定价表组装而成的报告。服务拥有报告契约、注册生命周期与定价算术；提供方拥有持久 token 事实且从不定价；部署拥有自己的价格且从不读取日志。消费者读取成品报告，自身从不定价，这使客户端无需了解路由的费率卡。

Source: [`packages/usage/usage/src/types.ts`](../../packages/usage/usage/src/types.ts) · [`packages/usage/usage/src/index.ts`](../../packages/usage/usage/src/index.ts)

## 报告契约

`UsageReport` 是一次 `ctx.usage.query(filter)` 的已组装答案。

| 字段 | 含义 |
|---|---|
| `totals` | 整个所选语料上的桶与计数合计 |
| `routes` | 同样的 token 桶按单个 provider/model 路由拆分；每行的计数只覆盖该路由 |
| `unpriced` | 已注册定价表未命名的贡献路由 |
| `cost` | 已定价子集上的金额；没有任何贡献路由被定价时缺失 |

## Token 桶

四个桶互不重叠：被缓存的提示词 token 只计一次，计入 `cacheReadTokens` 或 `cacheWriteTokens`，绝不会同时计入 `uncachedInputTokens`。

| 桶 | 含义 |
|---|---|
| `uncachedInputTokens` | 提供方按无缓存读取或写入计费的输入 token |
| `outputTokens` | 提供方在所有步中产生的补全 token |
| `cacheReadTokens` | 提供方上报为从其提示词缓存读取的输入 token |
| `cacheWriteTokens` | 提供方上报为写入其提示词缓存的输入 token |

## 计数

| 计数 | 口径 | 含义 |
|---|---|---|
| `sessions` | 语料 | 至少贡献一个可折叠事件的不同会话 |
| `turns` | 会话 | 所选会话中含至少一个已关闭步的不同轮次 |
| `steps` | 路由与总计 | 已关闭的步 |
| `unknownUsageSteps` | 路由与总计 | 适配器未上报用量记录的步；其 token 未知而非零 |

`turns` 以会话为口径而非以路由为口径：一轮可以在中途切换路由，按路由计数会重复计算。因此 `UsageRouteTotals` 携带 `sessions`、`steps` 与 `unknownUsageSteps`，但不携带 `turns`。

## 成本

`UsageCost` 描述一次查询中已定价的子集：`currency`、`pricingVersion`、`totalMicros`、`complete`，以及每个贡献路由的一条 `UsageCostRoute`，含 `micros` 与 `priced`。金额是定价表单一货币的整数微单位；`routeCostMicros` 用每个桶乘以其每百万费率，把四个乘积相加，最后统一舍入一次。定价表未命名的路由被报告在 `unpriced` 中且不贡献金额；只要存在未定价的贡献路由，`complete` 即为 false，这意味着 `totalMicros` 低估了真实成本而非测量它。当没有任何贡献路由被定价时，`cost` 缺失而非为零，因此看到无成本的消费者会把该金额报告为不可用。

## 定价契约

`UsagePricing` 是部署注册的内容：表中每个费率共用的一个 `currency`、回显进每份报告的部署自有 `version`、返回已声明 `UsageRoutePrice` 或 `undefined` 的 `price(provider, model)`，以及列出每个已声明路由的 `routes()`。`UsageRoutePrice` 携带四个每百万费率——`uncachedInputPerMillion`、`outputPerMillion`、`cacheReadPerMillion`、`cacheWritePerMillion`——均为整数微单位。价格是部署数据：本仓库不附带默认表，费率为零是对该桶声明的零价格，而不是未定价的路由。

## 提供方契约

`UsageProvider` 是 Service Provider 角色：用于诊断的稳定 `name`，以及返回 `UsageProviderResult` 的 `query(filter)`，后者是 `totals` 加 `UsageRouteTotals[]` 形式的 `routes`。提供方读取持久 token 事实且从不定价，因此部署可以替换账本而不触碰报告契约。

## `ctx.usage`

服务注册 `ctx.usage` 并连接两种角色。

| 成员 | 行为 |
|---|---|
| `registerProvider(provider)` | 注册唯一的提供方；第二次注册会抛错；返回精确的清理函数 |
| `registerPricing(pricing)` | 注册唯一的定价表；第二次注册会抛错；返回精确的清理函数 |
| `price(provider, model)` | 解析单个路由的已声明价格；未注册表或路由未定价时为 `undefined` |
| `query(filter)` | 以 `filter` 询问提供方，并对已注册表命名的路由定价 |

过滤器缺失即选中提供方持有的全部内容，`UsageFilter` 通过 `from`、`to`、`sessions`、`provider` 与 `model` 收窄范围。未注册提供方时 `query()` 抛出 `UsageUnavailableError`：不完整的组合显式失败，而不是返回全零合计。成本在组装期间依据当时注册的表计算，任何金额都不会被存储。

## 包

- [`usage/`](../../packages/usage/usage/README.zh.md)——服务、报告类型与定价算术。
- [`usage-ledger/`](../../packages/usage/usage-ledger/README.zh.md)——把规范会话日志折叠成 token 事实的持久提供方。
- [`usage-pricing/`](../../packages/usage/usage-pricing/README.zh.md)——部署自有的费率卡及其设置命名空间。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
