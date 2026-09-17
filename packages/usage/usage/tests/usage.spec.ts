import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UsageService, { UsageUnavailableError, routeCostMicros } from '../src/index.ts'
import type {
  UsageFilter,
  UsagePricing,
  UsageProvider,
  UsageProviderResult,
  UsageRoutePrice,
  UsageRouteTotals,
} from '../src/index.ts'
import { addBuckets, addTotals, emptyBuckets, emptyCounts, emptyTotals, isZeroTotals } from '../src/totals.ts'

const PRICE: UsageRoutePrice = {
  uncachedInputPerMillion: 2_000_000,
  outputPerMillion: 8_000_000,
  cacheReadPerMillion: 200_000,
  cacheWritePerMillion: 2_500_000,
}

function routeTotals(
  provider: string,
  model: string,
  overrides: Partial<UsageRouteTotals> = {},
): UsageRouteTotals {
  return {
    provider,
    model,
    sessions: 1,
    steps: 3,
    uncachedInputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 500_000,
    cacheWriteTokens: 0,
    unknownUsageSteps: 0,
    ...overrides,
  }
}

function totalsOf(routes: readonly UsageRouteTotals[]): UsageProviderResult['totals'] {
  return routes.reduce(
    (sum, route) => addTotals(sum, {
      sessions: route.sessions,
      turns: 2,
      steps: route.steps,
      unknownUsageSteps: route.unknownUsageSteps,
      uncachedInputTokens: route.uncachedInputTokens,
      outputTokens: route.outputTokens,
      cacheReadTokens: route.cacheReadTokens,
      cacheWriteTokens: route.cacheWriteTokens,
    }),
    emptyTotals(),
  )
}

class ProbeProvider implements UsageProvider {
  readonly name = 'probe'
  readonly seen: UsageFilter[] = []

  constructor(private readonly routes: readonly UsageRouteTotals[]) {}

  async query(filter: UsageFilter): Promise<UsageProviderResult> {
    this.seen.push(filter)
    return { totals: totalsOf(this.routes), routes: this.routes }
  }
}

class ProbePricing implements UsagePricing {
  readonly currency = 'CNY'
  readonly version = '2026-09-16'

  constructor(private readonly table: Record<string, UsageRoutePrice>) {}

  price(provider: string, model: string): UsageRoutePrice | undefined {
    return this.table[`${provider}/${model}`]
  }

  routes(): readonly ({ provider: string; model: string; price: UsageRoutePrice })[] {
    return Object.entries(this.table).map(([key, price]) => {
      const [provider = '', model = ''] = key.split('/')
      return { provider, model, price }
    })
  }
}

async function mount(): Promise<{ ctx: Context; usage: UsageService }> {
  const ctx = new Context()
  await ctx.plugin(UsageService)
  return { ctx, usage: ctx.usage }
}

describe('token bucket arithmetic', () => {
  it('sums buckets, totals, and reports emptiness', () => {
    expect(emptyBuckets()).toEqual({
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(emptyCounts()).toEqual({ sessions: 0, turns: 0, steps: 0, unknownUsageSteps: 0 })
    expect(isZeroTotals(emptyTotals())).toBe(true)
    expect(isZeroTotals({ ...emptyTotals(), steps: 1 })).toBe(false)
    expect(addBuckets(emptyBuckets(), { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }))
      .toEqual({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })
    expect(addTotals(emptyTotals(), { ...emptyTotals(), steps: 2, turns: 1, sessions: 1, unknownUsageSteps: 3 }))
      .toEqual({ ...emptyTotals(), steps: 2, turns: 1, sessions: 1, unknownUsageSteps: 3 })
  })
})

describe('route cost arithmetic', () => {
  it('prices each bucket and rounds once', () => {
    expect(routeCostMicros(PRICE, emptyBuckets())).toBe(0)
    // 1_000_000 input * 2_000_000/million = 2_000_000 micros.
    expect(routeCostMicros(PRICE, { ...emptyBuckets(), uncachedInputTokens: 1_000_000 })).toBe(2_000_000)
    // Every bucket together: 2_000_000 + 800_000 + 100_000 + 250_000.
    expect(routeCostMicros(PRICE, {
      uncachedInputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 100_000,
    })).toBe(3_150_000)
    // A single token rounds to the nearest micro-unit.
    expect(routeCostMicros({ ...PRICE, outputPerMillion: 1_000_000 }, { ...emptyBuckets(), outputTokens: 1 })).toBe(1)
    expect(routeCostMicros({ ...PRICE, outputPerMillion: 1_000_000 }, { ...emptyBuckets(), outputTokens: 0 })).toBe(0)
  })
})

describe('usage service', () => {
  it('fails loud when no provider is registered', async () => {
    const { usage } = await mount()
    await expect(usage.query()).rejects.toBeInstanceOf(UsageUnavailableError)
  })

  it('passes the filter through and reports no cost without a pricing table', async () => {
    const { usage } = await mount()
    const routes = [routeTotals('deepseek', 'chat')]
    const provider = new ProbeProvider(routes)
    usage.registerProvider(provider)

    const filter = { from: 1, to: 2, sessions: ['s1'], provider: 'deepseek', model: 'chat' }
    const report = await usage.query(filter)

    expect(provider.seen).toEqual([filter])
    expect(report.totals).toEqual(totalsOf(routes))
    expect(report.routes).toEqual(routes)
    expect(report.unpriced).toEqual([{ provider: 'deepseek', model: 'chat' }])
    expect(report.cost).toBeUndefined()
  })

  it('prices the named routes and marks a report incomplete when another route is unpriced', async () => {
    const { usage } = await mount()
    const priced = routeTotals('deepseek', 'chat')
    const unpriced = routeTotals('local', 'llama', { uncachedInputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
    usage.registerProvider(new ProbeProvider([priced, unpriced]))
    usage.registerPricing(new ProbePricing({ 'deepseek/chat': PRICE }))

    expect(usage.price('deepseek', 'chat')).toEqual(PRICE)
    expect(usage.price('local', 'llama')).toBeUndefined()

    const report = await usage.query()
    expect(report.unpriced).toEqual([{ provider: 'local', model: 'llama' }])
    expect(report.cost).toEqual({
      currency: 'CNY',
      pricingVersion: '2026-09-16',
      totalMicros: 2_900_000,
      complete: false,
      routes: [
        { provider: 'deepseek', model: 'chat', micros: 2_900_000, priced: true },
        { provider: 'local', model: 'llama', micros: 0, priced: false },
      ],
    })
  })

  it('reports a complete cost when every route is priced, and no cost when none is', async () => {
    const { usage } = await mount()
    const routes = [routeTotals('deepseek', 'chat'), routeTotals('deepseek', 'reasoner')]
    usage.registerProvider(new ProbeProvider(routes))
    const releaseUnrelated = usage.registerPricing(new ProbePricing({ 'nobody/nothing': PRICE }))

    const unpricedReport = await usage.query()
    expect(unpricedReport.cost).toBeUndefined()
    expect(unpricedReport.unpriced).toHaveLength(2)

    releaseUnrelated()
    usage.registerPricing(new ProbePricing({ 'deepseek/chat': PRICE, 'deepseek/reasoner': PRICE }))
    const pricedReport = await usage.query()
    expect(pricedReport.cost?.complete).toBe(true)
    expect(pricedReport.cost?.totalMicros).toBe(5_800_000)
  })

  it('registers one provider and one table, refusing duplicates and releasing on disposal', async () => {
    const { usage } = await mount()
    const first = new ProbeProvider([])
    const second = new ProbeProvider([])

    const releaseProvider = usage.registerProvider(first)
    expect(() => usage.registerProvider(second)).toThrow(/already registered/)
    releaseProvider()
    releaseProvider()
    const releaseSecond = usage.registerProvider(second)
    releaseSecond()
    expect(() => usage.registerProvider(first)).not.toThrow()

    const table = new ProbePricing({ 'deepseek/chat': PRICE })
    const releasePricing = usage.registerPricing(table)
    expect(() => usage.registerPricing(new ProbePricing({}))).toThrow(/already registered/)
    releasePricing()
    releasePricing()
    expect(usage.price('deepseek', 'chat')).toBeUndefined()
    usage.registerPricing(table)
    expect(usage.price('deepseek', 'chat')).toEqual(PRICE)
  })

  it('leaves the live provider in place when a released registration is disposed again', async () => {
    const { usage } = await mount()
    const first = new ProbeProvider([routeTotals('first', 'one')])
    const second = new ProbeProvider([routeTotals('second', 'two')])
    const releaseFirst = usage.registerProvider(first)
    releaseFirst()
    usage.registerProvider(second)
    // A second release of the superseded registration must not clear the live
    // provider: the guard compares identity, not mere emptiness.
    releaseFirst()

    const report = await usage.query()
    expect(report.routes.map(route => route.provider)).toEqual(['second'])
  })
})
