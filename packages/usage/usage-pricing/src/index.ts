/**
 * Deployment-owned pricing table for the usage seam. The plugin registers one
 * `UsagePricing` on `ctx.usage` from its composed configuration. Prices are
 * deployment data: the harness ships no default rate card, and a route this
 * table does not name stays unpriced.
 *
 * @module @deepseek-ai/dsh-usage-pricing
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { UsagePricing, UsageRoutePrice, UsageRouteRef } from '@deepseek-ai/dsh-usage'

/** Cordis plugin name. */
export const name = 'usage-pricing'

/** The pricing table is meaningless without the usage service that assembles reports. */
export const inject = ['usage']

/**
 * One priced route. Rates are integer micro-units of the table's currency per
 * one million tokens; a bucket rate of 0 means the provider does not charge
 * for that bucket, not that the route is unpriced.
 */
export interface UsagePricingRouteConfig {
  /** Registered provider name. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Micro-units per million uncached input tokens. */
  uncachedInputPerMillion: number
  /** Micro-units per million output tokens. */
  outputPerMillion: number
  /** Micro-units per million cache-read input tokens. */
  cacheReadPerMillion: number
  /** Micro-units per million cache-write input tokens. */
  cacheWritePerMillion: number
}

/** Plugin configuration: one currency, one revision label, and the priced routes. */
export interface Config {
  /** Currency of every rate in this table. */
  currency: string
  /** Deployment-owned revision label echoed into every assembled report. */
  version: string
  /** Priced routes; a route absent here is reported unpriced. */
  routes: UsagePricingRouteConfig[]
}

const routeConfig = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  uncachedInputPerMillion: z.number().min(0).required(),
  outputPerMillion: z.number().min(0).required(),
  cacheReadPerMillion: z.number().min(0).required(),
  cacheWritePerMillion: z.number().min(0).required(),
})

/** Validated plugin configuration, also the settings namespace schema. */
export const Config: z<Config> = z.object({
  currency: z.string().required(),
  version: z.string().required(),
  routes: z.array(routeConfig).default([]),
})

/** Key one route's price is looked up by. */
const routeKey = (provider: string, model: string): string => `${provider}\u0000${model}`

/**
 * Validate one configuration table before it prices anything: a route named
 * twice would make the rate card ambiguous, so the table refuses rather than
 * keeping whichever entry happened to be last.
 * @param config - the configuration or settings value to validate.
 * @returns the same configuration when valid.
 * @throws Error when a route is named twice.
 */
function assertDistinctRoutes(config: Config): Config {
  const seen = new Set<string>()
  for (const route of config.routes) {
    const key = routeKey(route.provider, route.model)
    if (seen.has(key)) {
      throw new Error(`usage pricing table names route ${route.provider}/${route.model} more than once`)
    }
    seen.add(key)
  }
  return config
}

/**
 * The registered pricing table. One instance lives for the plugin's lifetime
 * and adopts each committed settings value, so a runtime edit reaches
 * consumers without re-registering the table.
 */
export class UsagePricingTable implements UsagePricing {
  private current: Config

  /**
   * @param config - the validated composed pricing table.
   */
  constructor(config: Config) {
    this.current = assertDistinctRoutes(config)
  }

  /** Currency of the current table. */
  get currency(): string {
    return this.current.currency
  }

  /** Revision label of the current table. */
  get version(): string {
    return this.current.version
  }

  /**
   * Adopt one committed table value.
   * @param config - the next validated table.
   */
  adopt(config: Config): void {
    this.current = assertDistinctRoutes(config)
  }

  /**
   * Resolve one route's declared price.
   * @param provider - registered provider name.
   * @param model - provider-owned model id.
   * @returns the declared price, or `undefined` when the route is unpriced.
   */
  price(provider: string, model: string): UsageRoutePrice | undefined {
    const route = this.current.routes.find(
      candidate => candidate.provider === provider && candidate.model === model,
    )
    if (route === undefined) return undefined
    return {
      uncachedInputPerMillion: route.uncachedInputPerMillion,
      outputPerMillion: route.outputPerMillion,
      cacheReadPerMillion: route.cacheReadPerMillion,
      cacheWritePerMillion: route.cacheWritePerMillion,
    }
  }

  /** Every route the current table declares. */
  routes(): readonly (UsageRouteRef & { readonly price: UsageRoutePrice })[] {
    return this.current.routes.map(route => ({
      provider: route.provider,
      model: route.model,
      price: {
        uncachedInputPerMillion: route.uncachedInputPerMillion,
        outputPerMillion: route.outputPerMillion,
        cacheReadPerMillion: route.cacheReadPerMillion,
        cacheWritePerMillion: route.cacheWritePerMillion,
      },
    }))
  }
}

/**
 * Register the composed table on the usage service. The composed `Config` is
 * the deployment's rate card: the settings UI edits that plugin configuration
 * in the profile patch, and the Loader re-applies this plugin, so no separate
 * runtime override exists.
 * @param ctx - host context carrying the usage service.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const table = new UsagePricingTable(config)
  ctx.effect(() => ctx.usage.registerPricing(table), 'usage-pricing.register')
}
