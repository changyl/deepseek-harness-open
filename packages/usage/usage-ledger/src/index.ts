/**
 * Usage ledger: the durable Service Provider behind `ctx.usage`. It folds
 * each session's canonical log into token facts attributed to the route that
 * served them, caches one derived record per session in a storage domain, and
 * re-folds a session only when its persistence revision moved. The ledger
 * stores token facts and never a price, and the canonical log stays the only
 * authority: deleting every stored record costs one re-fold and changes no
 * reported total.
 *
 * @module @deepseek-ai/dsh-usage-ledger
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  UsageBuckets,
  UsageFilter,
  UsageProvider,
  UsageProviderResult,
  UsageRouteTotals,
} from '@deepseek-ai/dsh-usage'
import { emptyTotals } from '@deepseek-ai/dsh-usage'
import { foldUsageEvents, routeKey } from './fold.ts'
import { usageDomainSpec } from './spec.ts'
import type { UsageSessionRecord } from './spec.ts'

export type { UsageRouteRecord, UsageSessionRecord } from './spec.ts'
export { usageDomainSpec, usageRouteRecord, usageSessionRecord } from './spec.ts'
export { foldUsageEvents, routeKey } from './fold.ts'

/** Cordis plugin name. */
export const name = 'usage-ledger'

/** The ledger reads canonical logs through the query service and derives cost facts from the usage service. */
export const inject = ['usage', 'storageDomain', 'sessionQuery', 'sessionPersistence']

/** Ledger configuration. */
export interface Config {
  /**
   * Delete every stored record at mount, so the next query re-derives all of
   * them from the canonical logs. Use after a fold change; a normal start
   * keeps the cache and re-folds only sessions whose revision moved.
   */
  rebuildOnMount: boolean
}

/** Validated ledger configuration. */
export const Config: z<Config> = z.object({
  rebuildOnMount: z.boolean().default(false),
})

/** Dependencies the provider reads. */
export interface UsageLedgerDeps {
  /** Derived-record table, authoritative in memory and durable through the backend. */
  readonly table: KvTable<string, UsageSessionRecord>
  /** Live-preferred canonical log reads. */
  readonly sessionQuery: SessionQueryEngine
  /** Cheap change tokens deciding whether a stored record is still fresh. */
  readonly persistence: SessionPersistence
}

/**
 * Whether one stored record can contribute to a time-bounded query.
 * @param record - the derived session record.
 * @param filter - the query selection.
 * @returns whether the record's event span overlaps the window.
 */
function overlapsWindow(record: UsageSessionRecord, filter: UsageFilter): boolean {
  if (filter.from !== undefined && (record.lastTime === null || record.lastTime < filter.from)) return false
  if (filter.to !== undefined && (record.firstTime === null || record.firstTime >= filter.to)) return false
  return true
}

/**
 * Whether one route row survives the query's route selection.
 * @param route - the derived route row.
 * @param filter - the query selection.
 * @returns whether the row is selected.
 */
function selectsRoute(route: UsageSessionRecord['routes'][number], filter: UsageFilter): boolean {
  if (filter.provider !== undefined && route.provider !== filter.provider) return false
  if (filter.model !== undefined && route.model !== filter.model) return false
  return true
}

/** Mutable token buckets used while accumulating; the served types are readonly. */
interface MutableBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One accumulating route row during aggregation. */
interface RouteAccumulator extends MutableBuckets {
  provider: string
  model: string
  sessions: number
  steps: number
  unknownUsageSteps: number
}

/** Mutable totals used while accumulating. */
interface MutableTotals extends MutableBuckets {
  sessions: number
  turns: number
  steps: number
  unknownUsageSteps: number
}

/**
 * Sum one token delta into a bucket accumulator.
 * @param target - the accumulator to mutate.
 * @param source - the buckets to add.
 */
function addInto(target: MutableBuckets, source: UsageBuckets): void {
  target.uncachedInputTokens += source.uncachedInputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
}

/**
 * Aggregate stored records into one provider answer.
 * @param records - the selected session records, already windowed.
 * @param filter - the query selection, applied to route rows here.
 * @returns totals and per-route totals.
 */
export function aggregateUsage(
  records: readonly UsageSessionRecord[],
  filter: UsageFilter,
): UsageProviderResult {
  const routes = new Map<string, RouteAccumulator>()
  const totals: MutableTotals = { ...emptyTotals() }
  const routeFiltered = filter.provider !== undefined || filter.model !== undefined

  for (const record of records) {
    const selected = record.routes.filter(route => selectsRoute(route, filter))
    // A route selection answers "who used this route", so a session with no
    // selected route is excluded entirely. Without one, every observed session
    // counts even when it produced no tokens, so a window can report how many
    // sessions ran alongside the tokens they spent.
    if (routeFiltered && selected.length === 0) continue
    if (!routeFiltered && record.throughSeq < 0) continue
    totals.sessions += 1
    totals.turns += record.turns
    for (const route of selected) {
      const key = routeKey(route.provider, route.model)
      let row = routes.get(key)
      if (row === undefined) {
        row = {
          provider: route.provider,
          model: route.model,
          sessions: 0,
          steps: 0,
          unknownUsageSteps: 0,
          uncachedInputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        routes.set(key, row)
      }
      row.sessions += 1
      row.steps += route.steps
      row.unknownUsageSteps += route.unknownUsageSteps
      addInto(row, route)
      totals.steps += route.steps
      totals.unknownUsageSteps += route.unknownUsageSteps
      addInto(totals, route)
    }
  }

  const routeTotals: UsageRouteTotals[] = [...routes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => ({
      provider: row.provider,
      model: row.model,
      sessions: row.sessions,
      steps: row.steps,
      unknownUsageSteps: row.unknownUsageSteps,
      uncachedInputTokens: row.uncachedInputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
    }))

  return {
    totals: { ...totals },
    routes: routeTotals,
  }
}

/**
 * The ledger provider: canonical-log folds with a revision-checked derived
 * cache in front of them.
 */
export class UsageLedgerProvider implements UsageProvider {
  /** Stable provider name used in diagnostics. */
  readonly name = 'usage-ledger'

  /**
   * @param deps - the record table and the log services the fold reads.
   */
  constructor(private readonly deps: UsageLedgerDeps) {}

  /**
   * Answer one filter over the durable corpus.
   * @param filter - selection narrowing the corpus.
   * @returns totals and per-route totals for the selected sessions.
   */
  async query(filter: UsageFilter): Promise<UsageProviderResult> {
    const wanted = filter.sessions === undefined ? undefined : new Set(filter.sessions)
    const selected: UsageSessionRecord[] = []

    for (const listed of await this.deps.sessionQuery.listSessions()) {
      const id = listed.header.id
      if (wanted !== undefined && !wanted.has(String(id))) continue
      const record = await this.refresh(id)
      if (!overlapsWindow(record, filter)) continue
      selected.push(record)
    }

    return aggregateUsage(selected, filter)
  }

  /**
   * Read the current derived record for one session, re-folding its log when
   * the persistence revision moved or no revision is available.
   * @param id - session to read.
   * @returns the fresh record.
   * @throws when the canonical log cannot be read.
   */
  private async refresh(id: SessionId): Promise<UsageSessionRecord> {
    const key = String(id)
    const stat = await this.deps.persistence.stat(id)
    const revision = stat === undefined ? '' : String(stat.revision)
    const stored = this.deps.table.get(key)
    if (stored !== undefined && revision !== '' && stored.revision === revision) return stored

    const snapshot = await this.deps.sessionQuery.readSession(id)
    const record: UsageSessionRecord = {
      ...foldUsageEvents({ id: key, createdAt: snapshot.session.createdAt }, snapshot.events),
      revision,
    }
    await this.deps.table.put(key, record)
    return record
  }
}

/**
 * Open the ledger domain, optionally drop the cache, and register the
 * provider on the usage service.
 * @param ctx - host context carrying the usage service and log readers.
 * @param config - validated ledger configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(usageDomainSpec)
  ctx.effect(() => () => domain.close(), 'usage-ledger.domainClose')
  const table = domain.table('sessions')

  if (config.rebuildOnMount) {
    for (const key of [...table.keys()]) await table.delete(key)
  }

  const provider = new UsageLedgerProvider({
    table,
    sessionQuery: ctx.sessionQuery,
    persistence: ctx.sessionPersistence,
  })
  ctx.effect(() => ctx.usage.registerProvider(provider), 'usage-ledger.register')
}
