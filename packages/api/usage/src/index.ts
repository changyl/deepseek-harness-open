/**
 * Host Remote owner for the usage surface: `ctx.remote.usage` answers the same
 * report `ctx.usage` assembles, mapped onto plain wire values. The controller
 * adds no policy of its own — pricing, provider selection, and unpriced
 * reporting all live in the service — it only validates the request at the
 * wire boundary and classifies the one domain failure a caller can act on.
 *
 * @module @deepseek-ai/dsh-api-usage
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { UsageUnavailableError } from '@deepseek-ai/dsh-usage'
import type { UsageFilter, UsageReport } from '@deepseek-ai/dsh-usage'
import { z } from 'zod'
import type {
  UsageCostWire,
  UsageFilterWire,
  UsageReportWire,
  UsageRouteTotalsWire,
  UsageTotalsWire,
} from './types.ts'

export type * from './types.ts'

/** Wire validation of one `query` request; the only untrusted input here. */
const filterSchema = z.object({
  from: z.number().optional(),
  to: z.number().optional(),
  sessions: z.array(z.string()).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
}).strict()

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `usage` Remote namespace. */
    usageController: UsageController
  }
}

/** Copy the count and bucket totals onto the wire shape. */
function totals(report: UsageReport['totals']): UsageTotalsWire {
  return {
    sessions: report.sessions,
    turns: report.turns,
    steps: report.steps,
    unknownUsageSteps: report.unknownUsageSteps,
    uncachedInputTokens: report.uncachedInputTokens,
    outputTokens: report.outputTokens,
    cacheReadTokens: report.cacheReadTokens,
    cacheWriteTokens: report.cacheWriteTokens,
  }
}

/** Map one report onto the wire, dropping nothing a client renders. */
function wireReport(report: UsageReport): UsageReportWire {
  const routes: UsageRouteTotalsWire[] = report.routes.map(route => ({
    sessions: route.sessions,
    steps: route.steps,
    unknownUsageSteps: route.unknownUsageSteps,
    uncachedInputTokens: route.uncachedInputTokens,
    outputTokens: route.outputTokens,
    cacheReadTokens: route.cacheReadTokens,
    cacheWriteTokens: route.cacheWriteTokens,
    provider: route.provider,
    model: route.model,
  }))
  const cost: UsageCostWire | undefined = report.cost === undefined
    ? undefined
    : {
      currency: report.cost.currency,
      pricingVersion: report.cost.pricingVersion,
      totalMicros: report.cost.totalMicros,
      complete: report.cost.complete,
      routes: report.cost.routes.map(route => ({
        provider: route.provider,
        model: route.model,
        micros: route.micros,
        priced: route.priced,
      })),
    }
  return {
    totals: totals(report.totals),
    routes,
    unpriced: report.unpriced.map(route => ({ provider: route.provider, model: route.model })),
    ...cost === undefined ? {} : { cost },
  }
}

/**
 * Host service backing the generated `ctx.remote.usage` namespace. Every
 * response is a detached plain value; the controller holds no cache, so a
 * client always reads the service's current answer for its filter.
 */
export class UsageController extends TypertRemoteService {
  /**
   * The controller answers only from the usage service it names. The Gateway
   * discovers the namespace through `typertRemote`, so a Host composition
   * without the gateway can still mount it.
   */
  static inject = ['usage']

  /**
   * @param ctx - Host context carrying `ctx.usage`.
   */
  constructor(ctx: Context) {
    super(ctx, 'usageController', { namespace: 'usage' })
  }

  /**
   * Answer one usage query, priced by the deployment's registered table.
   * @param filter - selection narrowing the corpus; an absent filter selects everything the provider holds.
   * @returns totals, per-route totals, the unpriced routes, and cost over the priced subset.
   * @throws RemoteError `usage/unavailable` when the composition mounts no usage provider.
   */
  @Remote
  async query(filter?: UsageFilterWire): Promise<UsageReportWire> {
    const parsed = filterSchema.safeParse(filter ?? {})
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', 'usage.query received a malformed filter', {
        issues: parsed.error.issues,
      })
    }
    const selection: UsageFilter = {
      ...parsed.data.from === undefined ? {} : { from: parsed.data.from },
      ...parsed.data.to === undefined ? {} : { to: parsed.data.to },
      ...parsed.data.sessions === undefined ? {} : { sessions: parsed.data.sessions },
      ...parsed.data.provider === undefined ? {} : { provider: parsed.data.provider },
      ...parsed.data.model === undefined ? {} : { model: parsed.data.model },
    }
    try {
      return wireReport(await this.ctx.usage.query(selection))
    } catch (error: unknown) {
      if (error instanceof UsageUnavailableError) {
        throw new RemoteError('usage/unavailable', error.message, {})
      }
      throw error
    }
  }
}

export default UsageController
