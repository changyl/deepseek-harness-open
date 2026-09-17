/**
 * Pure types of the usage domain: the four disjoint provider-reported token
 * buckets, the route-attributed totals a usage provider returns, the pricing
 * contract a deployment supplies, and the assembled report a consumer reads.
 * Host-side value imports (cordis) stay out of this file so client aggregates
 * can import the types alone.
 *
 * @module @deepseek-ai/dsh-usage/types
 */

/** One registered LLM route a usage figure is attributed to. */
export interface UsageRouteRef {
  /** Registered provider name. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/**
 * Provider-reported token buckets. The four buckets are disjoint: a cached
 * prompt token is counted once, as `cacheReadTokens` or `cacheWriteTokens`,
 * and never also as `uncachedInputTokens`.
 */
export interface UsageBuckets {
  /** Input tokens the provider billed without a cache read or write. */
  readonly uncachedInputTokens: number
  /** Completion tokens the provider produced across every step. */
  readonly outputTokens: number
  /** Input tokens the provider reported as served from its prompt cache. */
  readonly cacheReadTokens: number
  /** Input tokens the provider reported as written into its prompt cache. */
  readonly cacheWriteTokens: number
}

/** Session-scoped counts carried beside every bucket total. */
export interface UsageCounts {
  /** Distinct sessions contributing at least one foldable event. */
  readonly sessions: number
  /** Distinct turns with at least one closed step across those sessions. */
  readonly turns: number
  /** Closed steps across those sessions. */
  readonly steps: number
  /**
   * Steps whose adapter reported no usage record. Their token cost is
   * unknown, not zero: a report with a non-zero count here is missing
   * tokens rather than reporting a measured total.
   */
  readonly unknownUsageSteps: number
}

/** Aggregate token and count totals for one query, budget, or corpus. */
export interface UsageTotals extends UsageBuckets, UsageCounts {}

/**
 * Token buckets attributed to exactly one registered route.
 * `turns` is session-scoped rather than route-scoped: one turn can switch
 * routes mid-turn, so a per-route turn count would double-count it.
 */
export interface UsageRouteTotals extends UsageBuckets, UsageRouteRef {
  /** Distinct selected sessions contributing at least one observation on this route. */
  readonly sessions: number
  /** Closed steps attributed to the route in effect when each step closed. */
  readonly steps: number
  /** Steps on this route whose adapter reported no usage record. */
  readonly unknownUsageSteps: number
}

/**
 * Query selection. Absent fields do not filter; every present field narrows
 * the result. `from`/`to` bound session activity by the host-assigned epoch
 * milliseconds of the folded events.
 */
export interface UsageFilter {
  /** Inclusive lower bound on contributing event time, Unix epoch milliseconds. */
  readonly from?: number
  /** Exclusive upper bound on contributing event time, Unix epoch milliseconds. */
  readonly to?: number
  /** Restrict to these session ids when present. */
  readonly sessions?: readonly string[]
  /** Restrict to one registered provider. */
  readonly provider?: string
  /** Restrict to one provider-owned model id. */
  readonly model?: string
}

/** Provider answer for one {@link UsageFilter}: totals plus per-route totals. */
export interface UsageProviderResult {
  /** Totals across every contributing route. */
  readonly totals: UsageTotals
  /** The same totals split by route; each row's counts cover only that route. */
  readonly routes: readonly UsageRouteTotals[]
}

/**
 * Service Provider role of the usage seam: reads durable token facts and
 * answers one filter. A provider never prices anything, so a deployment can
 * replace the ledger without touching the report contract.
 */
export interface UsageProvider {
  /** Stable provider name, used in diagnostics. */
  readonly name: string
  /**
   * Answer one filter over durable usage facts.
   * @param filter - selection narrowing the corpus.
   * @returns totals and per-route totals for the selected corpus.
   */
  query(filter: UsageFilter): Promise<UsageProviderResult>
}

/**
 * One route's declared price, in integer micro-units of the pricing table's
 * currency per one million tokens. Integer micro-units keep totals exact;
 * formatting is the consumer's business.
 */
export interface UsageRoutePrice {
  /** Micro-units charged per million uncached input tokens. */
  readonly uncachedInputPerMillion: number
  /** Micro-units charged per million output tokens. */
  readonly outputPerMillion: number
  /** Micro-units charged per million cache-read input tokens. */
  readonly cacheReadPerMillion: number
  /** Micro-units charged per million cache-write input tokens. */
  readonly cacheWritePerMillion: number
}

/**
 * Pricing contract a deployment registers on `ctx.usage`. Prices are
 * deployment-owned data: the harness ships no default table, and a route the
 * table does not name is reported as unpriced rather than priced at zero.
 */
export interface UsagePricing {
  /** One currency for every price in this table; mixed tables are refused at registration. */
  readonly currency: string
  /** Deployment-owned table revision, echoed in every assembled report. */
  readonly version: string
  /**
   * Resolve one route's declared price.
   * @param provider - registered provider name.
   * @param model - provider-owned model id.
   * @returns the declared price, or `undefined` when the route is unpriced.
   */
  price(provider: string, model: string): UsageRoutePrice | undefined
  /** Every route the table declares, for validation and display. */
  routes(): readonly (UsageRouteRef & { readonly price: UsageRoutePrice })[]
}

/** One route's contribution to an assembled cost report. */
export interface UsageCostRoute extends UsageRouteRef {
  /** Micro-units this route contributed; 0 when unpriced. */
  readonly micros: number
  /** Whether the table declared a price for this route. */
  readonly priced: boolean
}

/**
 * Assembled cost over the priced subset of a query. `complete` is false when
 * at least one contributing route is unpriced, which means `totalMicros`
 * understates the true cost rather than measuring it.
 */
export interface UsageCost {
  /** Currency of every amount in this report. */
  readonly currency: string
  /** Pricing-table revision that produced these amounts. */
  readonly pricingVersion: string
  /** Integer micro-units summed over the priced routes. */
  readonly totalMicros: number
  /** Whether every contributing route was priced. */
  readonly complete: boolean
  /** Per-route breakdown, unpriced routes included with `priced: false`. */
  readonly routes: readonly UsageCostRoute[]
}

/** Assembled answer to one `ctx.usage.query()` call. */
export interface UsageReport {
  /** Token and count totals for the selected corpus. */
  readonly totals: UsageTotals
  /** The same totals split by route. */
  readonly routes: readonly UsageRouteTotals[]
  /** Contributing routes the pricing table does not name. */
  readonly unpriced: readonly UsageRouteRef[]
  /**
   * Cost over the priced subset; absent when no route was priced, so a
   * consumer that sees no cost reports unavailable rather than free.
   */
  readonly cost?: UsageCost
}
