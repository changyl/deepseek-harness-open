/**
 * Usage Service Definition: `ctx.usage` assembles token-usage totals from one
 * registered usage provider and prices them through one registered pricing
 * table. The definition owns the report contract, the registration lifetimes,
 * and the pricing arithmetic; the provider owns durable token facts and the
 * deployment owns its prices, so neither side knows the other.
 *
 * Consumers read `ctx.usage.query()` and never price anything themselves;
 * carrying cost with the report is what keeps a client from having to know a
 * route's rate card.
 *
 * @module @deepseek-ai/dsh-usage
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { routeCostMicros } from './cost.ts'
import type {
  UsageCost,
  UsageCostRoute,
  UsageFilter,
  UsagePricing,
  UsageProvider,
  UsageProviderResult,
  UsageReport,
  UsageRoutePrice,
  UsageRouteRef,
} from './types.ts'

export type * from './types.ts'
export { routeCostMicros } from './cost.ts'
export { addBuckets, addTotals, emptyBuckets, emptyCounts, emptyTotals, isZeroTotals } from './totals.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usage: UsageService
  }
}

/**
 * Raised when a consumer queries usage in a composition with no usage
 * provider. The composition is incomplete rather than the query empty, so the
 * caller sees a failure instead of zero totals.
 */
export class UsageUnavailableError extends Error {
  /**
   * @param message - operator-facing reason naming the missing registration.
   */
  constructor(message: string) {
    super(message)
    this.name = 'UsageUnavailableError'
  }
}

/**
 * Token-usage and cost service. A composition mounts exactly one provider
 * (the durable token source) and at most one pricing table; a query joins the
 * two, so cost can never diverge from the tokens it prices.
 */
export class UsageService extends Service {
  private provider: UsageProvider | undefined
  private pricing: UsagePricing | undefined

  /**
   * @param ctx - Context this service registers `ctx.usage` on.
   */
  constructor(ctx: Context) {
    super(ctx, 'usage')
  }

  /**
   * Register the one usage provider that answers queries. Registering twice
   * is a composition error and throws rather than silently replacing the
   * first provider.
   * @param provider - the provider supplying durable token facts.
   * @returns the exact disposer that unregisters this provider.
   */
  registerProvider(provider: UsageProvider): () => void {
    if (this.provider !== undefined) {
      throw new Error(`a usage provider is already registered (${this.provider.name}); cannot register ${provider.name}`)
    }
    this.provider = provider
    return () => {
      if (this.provider === provider) this.provider = undefined
    }
  }

  /**
   * Register the one pricing table that prices query results. Registering
   * twice is a composition error and throws rather than letting two rate
   * cards disagree silently.
   * @param pricing - the deployment's pricing table.
   * @returns the exact disposer that unregisters this table.
   */
  registerPricing(pricing: UsagePricing): () => void {
    if (this.pricing !== undefined) {
      throw new Error(`a usage pricing table is already registered (${this.pricing.currency} ${this.pricing.version}); cannot register ${pricing.currency} ${pricing.version}`)
    }
    this.pricing = pricing
    return () => {
      if (this.pricing === pricing) this.pricing = undefined
    }
  }

  /**
   * Resolve one route's declared price.
   * @param provider - registered provider name.
   * @param model - provider-owned model id.
   * @returns the declared price, or `undefined` when no table is registered or the route is unpriced.
   */
  price(provider: string, model: string): UsageRoutePrice | undefined {
    return this.pricing?.price(provider, model)
  }

  /**
   * Answer one usage query, pricing every route the registered table names.
   * @param filter - selection narrowing the corpus; an absent filter selects everything the provider holds.
   * @returns totals, per-route totals, the unpriced routes, and cost over the priced subset.
   * @throws UsageUnavailableError when no provider is registered.
   */
  async query(filter: UsageFilter = {}): Promise<UsageReport> {
    const provider = this.provider
    if (provider === undefined) {
      throw new UsageUnavailableError('no usage provider is registered; mount @deepseek-ai/dsh-usage-ledger beside this service')
    }
    return this.assemble(await provider.query(filter))
  }

  /**
   * Join one provider answer with the registered pricing table. A route the
   * table does not name is reported unpriced and contributes no amount; when
   * no route is priced at all the report carries no cost rather than zero.
   * @param result - the provider's answer for the query.
   * @returns the assembled report.
   */
  private assemble(result: UsageProviderResult): UsageReport {
    const pricing = this.pricing
    const unpriced: UsageRouteRef[] = []
    const costRoutes: UsageCostRoute[] = []
    let totalMicros = 0
    let pricedRoutes = 0

    for (const route of result.routes) {
      const price = pricing?.price(route.provider, route.model)
      if (price === undefined) {
        unpriced.push({ provider: route.provider, model: route.model })
        costRoutes.push({ provider: route.provider, model: route.model, micros: 0, priced: false })
        continue
      }
      const micros = routeCostMicros(price, route)
      pricedRoutes += 1
      totalMicros += micros
      costRoutes.push({ provider: route.provider, model: route.model, micros, priced: true })
    }

    const cost: UsageCost | undefined = pricing === undefined || pricedRoutes === 0
      ? undefined
      : {
        currency: pricing.currency,
        pricingVersion: pricing.version,
        totalMicros,
        complete: unpriced.length === 0,
        routes: costRoutes,
      }

    return {
      totals: result.totals,
      routes: result.routes,
      unpriced,
      ...cost === undefined ? {} : { cost },
    }
  }
}

export default UsageService
