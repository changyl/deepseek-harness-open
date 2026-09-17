/**
 * Wire types of the usage Remote namespace and the failure codes it can raise.
 * The Host never hands a domain object to the codec: it maps `ctx.usage`
 * results onto these plain values, so a domain-side field rename is a compile
 * error here rather than a silent wire change.
 *
 * @module @deepseek-ai/dsh-api-usage/types
 */

/** Selection one `usage.query` call carries. */
export interface UsageFilterWire {
  /** Inclusive lower bound on contributing event time, Unix epoch milliseconds. */
  from?: number
  /** Exclusive upper bound on contributing event time, Unix epoch milliseconds. */
  to?: number
  /** Restrict to these session ids. */
  sessions?: string[]
  /** Restrict to one registered provider. */
  provider?: string
  /** Restrict to one provider-owned model id. */
  model?: string
}

/** The four disjoint token buckets on the wire. */
export interface UsageTotalsWire {
  /** Sessions contributing at least one observation. */
  sessions: number
  /** Distinct turns with at least one closed step. */
  turns: number
  /** Closed steps. */
  steps: number
  /** Steps whose adapter reported no usage record. */
  unknownUsageSteps: number
  /** Input tokens billed without a cache read or write. */
  uncachedInputTokens: number
  /** Completion tokens. */
  outputTokens: number
  /** Input tokens served from the provider's prompt cache. */
  cacheReadTokens: number
  /** Input tokens written into the provider's prompt cache. */
  cacheWriteTokens: number
}

/**
 * One route's totals on the wire. `turns` is deliberately absent: a turn can
 * switch routes, so a per-route turn count would double-count it.
 */
export interface UsageRouteTotalsWire {
  /** Distinct selected sessions contributing on this route. */
  sessions: number
  /** Closed steps attributed to the route in effect when each step closed. */
  steps: number
  /** Steps on this route whose adapter reported no usage record. */
  unknownUsageSteps: number
  /** Input tokens billed without a cache read or write. */
  uncachedInputTokens: number
  /** Completion tokens. */
  outputTokens: number
  /** Input tokens served from the provider's prompt cache. */
  cacheReadTokens: number
  /** Input tokens written into the provider's prompt cache. */
  cacheWriteTokens: number
  /** Registered provider name. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** One route in the unpriced list. */
export interface UsageRouteRefWire {
  /** Registered provider name. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** One route's share of an assembled cost. */
export interface UsageCostRouteWire extends UsageRouteRefWire {
  /** Micro-units this route contributed; 0 when unpriced. */
  micros: number
  /** Whether the table declared a price for this route. */
  priced: boolean
}

/**
 * Cost over the priced subset. `complete` is false when a contributing route
 * is unpriced, which means `totalMicros` understates rather than measures.
 */
export interface UsageCostWire {
  /** Currency of every amount. */
  currency: string
  /** Pricing-table revision that produced these amounts. */
  pricingVersion: string
  /** Integer micro-units summed over the priced routes. */
  totalMicros: number
  /** Whether every contributing route was priced. */
  complete: boolean
  /** Per-route breakdown, unpriced routes included with `priced: false`. */
  routes: UsageCostRouteWire[]
}

/** One assembled usage answer. */
export interface UsageReportWire {
  /** Token and count totals for the selected corpus. */
  totals: UsageTotalsWire
  /** The same totals split by route. */
  routes: UsageRouteTotalsWire[]
  /** Contributing routes the pricing table does not name. */
  unpriced: UsageRouteRefWire[]
  /** Cost over the priced subset; absent when no route was priced. */
  cost?: UsageCostWire
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The composition mounts no usage provider, so no figure can be answered. */
    'usage/unavailable': {}
  }
}
