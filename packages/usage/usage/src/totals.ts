/**
 * Pure token-bucket arithmetic shared by the usage Service Definition, the
 * ledger provider, and their consumers. Every helper returns a new value and
 * mutates nothing.
 *
 * @module @deepseek-ai/dsh-usage/totals
 */

import type { UsageBuckets, UsageCounts, UsageTotals } from './types.ts'

/**
 * The all-zero bucket set.
 * @returns four zero buckets.
 */
export function emptyBuckets(): UsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/**
 * The all-zero count set.
 * @returns zero sessions, turns, steps, and unknown-usage steps.
 */
export function emptyCounts(): UsageCounts {
  return { sessions: 0, turns: 0, steps: 0, unknownUsageSteps: 0 }
}

/**
 * The all-zero totals.
 * @returns zero buckets and zero counts.
 */
export function emptyTotals(): UsageTotals {
  return { ...emptyBuckets(), ...emptyCounts() }
}

/**
 * Sum two bucket sets.
 * @param left - left operand.
 * @param right - right operand.
 * @returns the component-wise sum.
 */
export function addBuckets(left: UsageBuckets, right: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
  }
}

/**
 * Sum two totals, buckets and counts alike.
 * @param left - left operand.
 * @param right - right operand.
 * @returns the component-wise sum.
 */
export function addTotals(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    ...addBuckets(left, right),
    sessions: left.sessions + right.sessions,
    turns: left.turns + right.turns,
    steps: left.steps + right.steps,
    unknownUsageSteps: left.unknownUsageSteps + right.unknownUsageSteps,
  }
}

/**
 * Whether every bucket and count is zero.
 * @param totals - totals to test.
 * @returns whether the totals carry no observation.
 */
export function isZeroTotals(totals: UsageTotals): boolean {
  return totals.uncachedInputTokens === 0
    && totals.outputTokens === 0
    && totals.cacheReadTokens === 0
    && totals.cacheWriteTokens === 0
    && totals.sessions === 0
    && totals.turns === 0
    && totals.steps === 0
    && totals.unknownUsageSteps === 0
}
