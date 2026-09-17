/**
 * Durable shape of the usage ledger: one derived record per session, keyed by
 * session id. The record is a cache over the canonical session log, so it
 * stores the observed persistence revision and the token facts only — never a
 * price, which stays a read-time computation.
 *
 * @module @deepseek-ai/dsh-usage-ledger/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Token and step facts attributed to one route in one session. */
export const usageRouteRecord = z.object({
  provider: z.string(),
  model: z.string(),
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  unknownUsageSteps: z.number().int().nonnegative(),
})

/** One session's derived usage record. */
export const usageSessionRecord = z.object({
  sessionId: z.string(),
  /** Session creation time from the header, Unix epoch milliseconds. */
  createdAt: z.number(),
  /**
   * Persistence revision this record folded. An empty string means the
   * session had no persistence revision when folded, so the record never
   * matches and the next query re-folds it.
   */
  revision: z.string(),
  /** Highest durable event seq consumed. */
  throughSeq: z.number().int(),
  /** Distinct turns with at least one closed step. */
  turns: z.number().int().nonnegative(),
  /** Closed steps. */
  steps: z.number().int().nonnegative(),
  /** Steps whose adapter reported no usage record. */
  unknownUsageSteps: z.number().int().nonnegative(),
  /** Earliest contributing event time, or null for an empty log. */
  firstTime: z.number().nullable(),
  /** Latest contributing event time, or null for an empty log. */
  lastTime: z.number().nullable(),
  routes: z.array(usageRouteRecord),
})

/** One stored usage record, inferred from {@link usageSessionRecord}. */
export type UsageSessionRecord = z.infer<typeof usageSessionRecord>

/** Token and step facts of one route, inferred from {@link usageRouteRecord}. */
export type UsageRouteRecord = z.infer<typeof usageRouteRecord>

/**
 * The usage-ledger domain: one `sessions` table of derived per-session usage
 * records. Deleting any record is always safe — the next query re-derives it
 * from the canonical log.
 */
export const usageDomainSpec = defineDomain({
  name: 'usage',
  version: 1,
  tables: { sessions: domainTable<string, UsageSessionRecord>(usageSessionRecord) },
})
