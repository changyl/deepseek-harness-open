/**
 * Cross-session effectiveness query on `ctx.effectiveness`. It folds the same
 * outcome signals the `effectiveness` projection serves per session, but over
 * the whole corpus the session-query service exposes, and attributes each
 * session's outcome to the routes its log named.
 *
 * The query reads canonical logs on demand and caches nothing: a report is
 * always the corpus' current state. The projection remains the per-session
 * read model; this service answers the deployment-level question — which
 * routes carry the negative judgments, the reverts, and the failed
 * verification.
 *
 * @module @deepseek-ai/dsh-effectiveness-query
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { effectivenessProjectionDefinition } from '@deepseek-ai/dsh-effectiveness'
import type { EffectivenessProjection } from '@deepseek-ai/dsh-effectiveness'
// Declaration merge for ctx.sessionQuery; the service reads the corpus through it.
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    effectiveness: EffectivenessQuery
  }
}

/** Selection over the session corpus. */
export interface EffectivenessFilter {
  /** Inclusive lower bound on a session's contributing event time, Unix epoch milliseconds. */
  readonly from?: number
  /** Exclusive upper bound on a session's contributing event time, Unix epoch milliseconds. */
  readonly to?: number
  /** Restrict to these session ids. */
  readonly sessions?: readonly string[]
  /** Restrict to sessions whose log named this provider. */
  readonly provider?: string
  /** Restrict to sessions whose log named this provider-owned model. */
  readonly model?: string
}

/** One session's outcomes, with the routes its log named. */
export interface EffectivenessSessionRow extends EffectivenessProjection {
  /** Session the row describes. */
  readonly sessionId: string
  /** Session creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Routes the session's log named, in first-seen order. */
  readonly routes: readonly { readonly provider: string; readonly model: string }[]
}

/** One route's outcomes across every session that used it. */
export interface EffectivenessRouteRow extends EffectivenessProjection {
  /** Registered provider name. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Sessions contributing to this row. */
  readonly sessions: number
}

/** Assembled answer to one `ctx.effectiveness.query()` call. */
export interface EffectivenessReport {
  /** Corpus-wide outcomes; `turnsWithSignal` counts turn-and-session pairs, not distinct turns. */
  readonly totals: EffectivenessProjection & { readonly sessions: number }
  /** The same outcomes per route; a session using several routes contributes to each. */
  readonly routes: readonly EffectivenessRouteRow[]
  /** Per-session rows, newest first, bounded by the configured maximum. */
  readonly sessions: readonly EffectivenessSessionRow[]
  /** Whether the session rows were truncated at the configured maximum. */
  readonly truncated: boolean
}

/** Plugin configuration. */
export interface Config {
  /** Maximum per-session rows one report returns. */
  maxSessionsReported: number
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  maxSessionsReported: z.number().step(1).min(1).default(200),
})

/** Mutable corpus totals used while accumulating; the served type is readonly. */
interface MutableReportTotals extends EffectivenessProjection {
  sessions: number
}

/** Mutable per-route accumulator; the served row type is readonly. */
interface MutableRouteRow extends EffectivenessProjection {
  provider: string
  model: string
  sessions: number
}

/** The all-zero outcome projection. */
function emptyProjection(): EffectivenessProjection {
  return {
    feedback: { positive: 0, negative: 0, byCategory: {} },
    changes: { accepted: 0, reverted: 0, undecided: 0 },
    verification: { passed: 0, failed: 0, unknown: 0 },
    turnsWithSignal: 0,
  }
}

/**
 * Add one projection into a mutable accumulator.
 * @param target - accumulator mutated in place.
 * @param source - projection to add.
 */
function addInto(target: EffectivenessProjection, source: EffectivenessProjection): void {
  const mutable = target as {
    feedback: { positive: number; negative: number; byCategory: Record<string, number> }
    changes: { accepted: number; reverted: number; undecided: number }
    verification: { passed: number; failed: number; unknown: number }
    turnsWithSignal: number
  }
  mutable.feedback.positive += source.feedback.positive
  mutable.feedback.negative += source.feedback.negative
  for (const [category, count] of Object.entries(source.feedback.byCategory)) {
    mutable.feedback.byCategory[category] = (mutable.feedback.byCategory[category] ?? 0) + count
  }
  mutable.changes.accepted += source.changes.accepted
  mutable.changes.reverted += source.changes.reverted
  mutable.changes.undecided += source.changes.undecided
  mutable.verification.passed += source.verification.passed
  mutable.verification.failed += source.verification.failed
  mutable.verification.unknown += source.verification.unknown
  mutable.turnsWithSignal += source.turnsWithSignal
}

/** Key one route is grouped by. */
const routeKey = (provider: string, model: string): string => `${provider}\u0000${model}`

/**
 * Durable-free cross-session effectiveness query.
 */
export class EffectivenessQuery extends Service {
  /** Plugin configuration, read from the composition row. */
  static Config: z<Config> = Config
  /** The query reads canonical logs through the session-query service. */
  static inject = ['sessionQuery']

  private readonly maxSessionsReported: number

  /**
   * @param ctx - context carrying `ctx.sessionQuery`.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'effectiveness')
    this.maxSessionsReported = config.maxSessionsReported
  }

  /**
   * Fold the selected corpus into one report.
   * @param filter - selection narrowing the corpus.
   * @returns corpus-wide totals, per-route totals, and bounded per-session rows.
   */
  async query(filter: EffectivenessFilter = {}): Promise<EffectivenessReport> {
    const wanted = filter.sessions === undefined ? undefined : new Set(filter.sessions)
    const sessions: EffectivenessSessionRow[] = []
    const routes = new Map<string, MutableRouteRow>()
    const totals: MutableReportTotals = { ...emptyProjection(), sessions: 0 }

    for (const listed of await this.ctx.sessionQuery.listSessions()) {
      const id = listed.header.id
      if (wanted !== undefined && !wanted.has(String(id))) continue
      const snapshot = await this.ctx.sessionQuery.readSession(id)
      const folded = this.fold(snapshot.events)
      if (!this.inWindow(folded, filter)) continue
      const matched = folded.routes.filter(route =>
        (filter.provider === undefined || route.provider === filter.provider)
        && (filter.model === undefined || route.model === filter.model))
      const routeFiltered = filter.provider !== undefined || filter.model !== undefined
      if (routeFiltered && matched.length === 0) continue
      if (!routeFiltered && folded.firstTime === null) continue

      sessions.push({
        ...folded.projection,
        sessionId: String(id),
        createdAt: snapshot.session.createdAt,
        routes: folded.routes,
      })
      totals.sessions += 1
      addInto(totals, folded.projection)
      // Route rows use the routes the log named; a session with several routes
      // contributes its whole projection to each of them, which is why the
      // route rows may sum above the corpus totals.
      for (const route of (routeFiltered ? matched : folded.routes)) {
        const key = routeKey(route.provider, route.model)
        const row = routes.get(key) ?? {
          ...emptyProjection(),
          provider: route.provider,
          model: route.model,
          sessions: 0,
        }
        row.sessions += 1
        addInto(row, folded.projection)
        routes.set(key, { ...row })
      }
    }

    return {
      totals,
      routes: [...routes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, row]) => row),
      sessions: sessions
        .sort((left, right) => right.createdAt - left.createdAt || left.sessionId.localeCompare(right.sessionId))
        .slice(0, this.maxSessionsReported),
      truncated: sessions.length > this.maxSessionsReported,
    }
  }

  /**
   * Fold one session's events through the shared effectiveness unit.
   * @param events - the session's canonical events.
   * @returns the projection, the routes the log named, and the observation window.
   */
  private fold(events: readonly import('@deepseek-ai/dsh-session').SessionEvent[]): {
    projection: EffectivenessProjection
    routes: { provider: string; model: string }[]
    firstTime: number | null
    lastTime: number | null
  } {
    const definition = effectivenessProjectionDefinition
    let state = definition.init()
    const routes: { provider: string; model: string }[] = []
    const seen = new Set<string>()
    let firstTime: number | null = null
    let lastTime: number | null = null

    for (const event of events) {
      state = definition.apply(state, event)
      firstTime ??= event.time
      lastTime = event.time
      if (event.type !== 'request/context') continue
      const key = routeKey(event.data.provider, event.data.model)
      if (seen.has(key)) continue
      seen.add(key)
      routes.push({ provider: event.data.provider, model: event.data.model })
    }

    const { viewSchema, view } = definition.wire
    return { projection: viewSchema.parse(view(state)), routes, firstTime, lastTime }
  }

  /**
   * Whether a folded session overlaps the requested window.
   * @param folded - the folded session.
   * @param filter - the query selection.
   * @returns whether the session is inside the window.
   */
  private inWindow(
    folded: { firstTime: number | null; lastTime: number | null },
    filter: EffectivenessFilter,
  ): boolean {
    if (filter.from !== undefined && (folded.lastTime === null || folded.lastTime < filter.from)) return false
    if (filter.to !== undefined && (folded.firstTime === null || folded.firstTime >= filter.to)) return false
    return true
  }
}

export type { SessionId }

export default EffectivenessQuery
