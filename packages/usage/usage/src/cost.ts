/**
 * Pricing arithmetic for one route's token buckets. Prices are declared in
 * integer micro-units per one million tokens, so a bucket cost stays exact
 * until the single division and rounding at the end.
 *
 * @module @deepseek-ai/dsh-usage/cost
 */

import type { UsageBuckets, UsageRoutePrice } from './types.ts'

/** Tokens one declared rate is expressed per. */
const TOKENS_PER_RATE_UNIT = 1_000_000

/**
 * Cost of one route's token buckets.
 * @param price - the route's declared per-million rates in micro-units.
 * @param buckets - the buckets to price.
 * @returns integer micro-units, rounded once at the end.
 */
export function routeCostMicros(price: UsageRoutePrice, buckets: UsageBuckets): number {
  const micros = buckets.uncachedInputTokens * price.uncachedInputPerMillion
    + buckets.outputTokens * price.outputPerMillion
    + buckets.cacheReadTokens * price.cacheReadPerMillion
    + buckets.cacheWriteTokens * price.cacheWritePerMillion
  return Math.round(micros / TOKENS_PER_RATE_UNIT)
}
