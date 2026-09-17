/**
 * Host Remote owner for the effectiveness surface: `ctx.remote.effectiveness`
 * answers the same report `ctx.effectiveness` assembles, mapped onto plain wire
 * values. The controller adds no policy of its own — corpus selection, the
 * per-session fold, and the reporting bound all live in the query service — it
 * only validates the request at the wire boundary and maps the answer.
 *
 * @module @deepseek-ai/dsh-api-effectiveness
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { EffectivenessProjection } from '@deepseek-ai/dsh-effectiveness'
import type { EffectivenessFilter, EffectivenessReport } from '@deepseek-ai/dsh-effectiveness-query'
import { z as zod } from 'zod'
import type {
  EffectivenessChangesWire,
  EffectivenessFeedbackWire,
  EffectivenessFilterWire,
  EffectivenessProjectionWire,
  EffectivenessReportWire,
  EffectivenessRouteRefWire,
  EffectivenessRouteRowWire,
  EffectivenessSessionRowWire,
  EffectivenessTotalsWire,
  EffectivenessVerificationWire,
  FeedbackCategoryWire,
} from './types.ts'

export type * from './types.ts'

/** Wire validation of one `query` request; the only untrusted input here. */
const filterSchema = zod.object({
  from: zod.number().optional(),
  to: zod.number().optional(),
  sessions: zod.array(zod.string()).optional(),
  provider: zod.string().optional(),
  model: zod.string().optional(),
}).strict()

/**
 * Every category the wire declares. Iterating this list, rather than the
 * domain's own keys, is what makes a rename on either side a compile error.
 */
const CATEGORIES: readonly FeedbackCategoryWire[] = ['task-result', 'instruction-following', 'product-interaction']

/** Copy the current feedback counts onto the wire. */
function feedbackWire(feedback: EffectivenessProjection['feedback']): EffectivenessFeedbackWire {
  const byCategory: Partial<Record<FeedbackCategoryWire, number>> = {}
  for (const category of CATEGORIES) {
    const count = feedback.byCategory[category]
    if (count !== undefined) byCategory[category] = count
  }
  return { positive: feedback.positive, negative: feedback.negative, byCategory }
}

/** Copy the change-review counts onto the wire. */
function changesWire(changes: EffectivenessProjection['changes']): EffectivenessChangesWire {
  return { accepted: changes.accepted, reverted: changes.reverted, undecided: changes.undecided }
}

/** Copy the verification counts onto the wire. */
function verificationWire(verification: EffectivenessProjection['verification']): EffectivenessVerificationWire {
  return { passed: verification.passed, failed: verification.failed, unknown: verification.unknown }
}

/** Copy one session's or route's outcome signals onto the wire. */
function projectionWire(view: EffectivenessProjection): EffectivenessProjectionWire {
  return {
    feedback: feedbackWire(view.feedback),
    changes: changesWire(view.changes),
    verification: verificationWire(view.verification),
    turnsWithSignal: view.turnsWithSignal,
  }
}

/** Copy the map onto the wire, dropping nothing a client renders. */
function reportWire(report: EffectivenessReport): EffectivenessReportWire {
  const totals: EffectivenessTotalsWire = { ...projectionWire(report.totals), sessions: report.totals.sessions }
  const routes: EffectivenessRouteRowWire[] = report.routes.map(route => ({
    ...projectionWire(route),
    provider: route.provider,
    model: route.model,
    sessions: route.sessions,
  }))
  const sessions: EffectivenessSessionRowWire[] = report.sessions.map(row => ({
    ...projectionWire(row),
    sessionId: row.sessionId,
    createdAt: row.createdAt,
    routes: row.routes.map((route): EffectivenessRouteRefWire => ({ provider: route.provider, model: route.model })),
  }))
  return { totals, routes, sessions, truncated: report.truncated }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `effectiveness` Remote namespace. */
    effectivenessController: EffectivenessController
  }
}

/**
 * Host service backing the generated `ctx.remote.effectiveness` namespace.
 * Every response is a detached plain value; the controller holds no cache, so a
 * client always reads the service's current answer for its filter.
 */
export class EffectivenessController extends TypertRemoteService {
  /**
   * The controller answers only from the effectiveness query service it names.
   * The Gateway discovers the namespace through `typertRemote`, so a Host
   * composition without the gateway can still mount it.
   */
  static inject = ['effectiveness']

  /**
   * @param ctx - Host context carrying `ctx.effectiveness`.
   */
  constructor(ctx: Context) {
    super(ctx, 'effectivenessController', { namespace: 'effectiveness' })
  }

  /**
   * Answer one effectiveness query over the selected corpus.
   * @param filter - selection narrowing the corpus; an absent filter selects every readable session.
   * @returns totals, per-route rows, per-session rows, and whether the row bound cut them.
   * @throws RemoteError `gateway/bad-request` when the filter is malformed.
   */
  @Remote
  async query(filter?: EffectivenessFilterWire): Promise<EffectivenessReportWire> {
    const parsed = filterSchema.safeParse(filter ?? {})
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', 'effectiveness.query received a malformed filter', {
        issues: parsed.error.issues,
      })
    }
    const selection: EffectivenessFilter = {
      ...parsed.data.from === undefined ? {} : { from: parsed.data.from },
      ...parsed.data.to === undefined ? {} : { to: parsed.data.to },
      ...parsed.data.sessions === undefined ? {} : { sessions: parsed.data.sessions },
      ...parsed.data.provider === undefined ? {} : { provider: parsed.data.provider },
      ...parsed.data.model === undefined ? {} : { model: parsed.data.model },
    }
    return reportWire(await this.ctx.effectiveness.query(selection))
  }
}

export default EffectivenessController
