import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import UsageService from '@deepseek-ai/dsh-usage'
import type { UsageFilter, UsageProvider, UsageProviderResult, UsageRouteTotals } from '@deepseek-ai/dsh-usage'
import UsageController from '../src/index.ts'

function routeTotals(provider: string, model: string, overrides: Partial<UsageRouteTotals> = {}): UsageRouteTotals {
  return {
    provider,
    model,
    sessions: 1,
    steps: 2,
    uncachedInputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 5,
    cacheWriteTokens: 1,
    unknownUsageSteps: 0,
    ...overrides,
  }
}

class ProbeProvider implements UsageProvider {
  readonly name = 'probe'
  readonly seen: UsageFilter[] = []

  constructor(private readonly routes: readonly UsageRouteTotals[]) {}

  async query(filter: UsageFilter): Promise<UsageProviderResult> {
    this.seen.push(filter)
    const totals = this.routes.reduce((sum, route) => ({
      sessions: sum.sessions + route.sessions,
      turns: sum.turns + 1,
      steps: sum.steps + route.steps,
      unknownUsageSteps: sum.unknownUsageSteps + route.unknownUsageSteps,
      uncachedInputTokens: sum.uncachedInputTokens + route.uncachedInputTokens,
      outputTokens: sum.outputTokens + route.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + route.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + route.cacheWriteTokens,
    }), {
      sessions: 0,
      turns: 0,
      steps: 0,
      unknownUsageSteps: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    return { totals, routes: this.routes }
  }
}

async function boot(
  routes: readonly UsageRouteTotals[] = [routeTotals('deepseek', 'chat')],
  options: { withProvider?: boolean } = {},
): Promise<{ controller: UsageController; provider: ProbeProvider; ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(UsageService)
  const provider = new ProbeProvider(routes)
  if (options.withProvider !== false) ctx.usage.registerProvider(provider)
  await ctx.plugin(UsageController)
  return { controller: ctx.usageController, provider, ctx }
}

describe('the usage Remote namespace a statistics page calls', () => {
  it('publishes one query method under its own service key', async () => {
    const { controller } = await boot()
    expect(controller.typertRemote.serviceKey).toBe('usageController')
    expect(controller.typertRemote.namespace).toBe('usage')
    expect(remoteMethods(controller)).toEqual([{ method: 'query', invocation: { kind: 'direct' } }])
  })

  it('maps a report onto plain wire values', async () => {
    const { controller, provider, ctx } = await boot([
      routeTotals('deepseek', 'chat'),
      routeTotals('local', 'llama', { uncachedInputTokens: 7, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    ])
    ctx.usage.registerPricing({
      currency: 'CNY',
      version: 'v1',
      price: (providerName, model) => providerName === 'deepseek' && model === 'chat'
        ? {
          uncachedInputPerMillion: 2_000_000,
          outputPerMillion: 8_000_000,
          cacheReadPerMillion: 200_000,
          cacheWritePerMillion: 2_500_000,
        }
        : undefined,
      routes: () => [],
    })

    const report = await controller.query({ provider: 'deepseek', sessions: ['s1'] })
    expect(provider.seen).toEqual([{ provider: 'deepseek', sessions: ['s1'] }])
    expect(report.routes).toEqual([
      {
        provider: 'deepseek',
        model: 'chat',
        sessions: 1,
        steps: 2,
        unknownUsageSteps: 0,
        uncachedInputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 5,
        cacheWriteTokens: 1,
      },
      {
        provider: 'local',
        model: 'llama',
        sessions: 1,
        steps: 2,
        unknownUsageSteps: 0,
        uncachedInputTokens: 7,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    ])
    expect(report.totals.sessions).toBe(2)
    expect(report.unpriced).toEqual([{ provider: 'local', model: 'llama' }])
    expect(report.cost).toBeDefined()
  })

  it('answers an absent filter as the whole corpus and a mixed one field by field', async () => {
    const { controller, provider } = await boot()
    await controller.query()
    await controller.query({ from: 1, to: 2, model: 'chat' })
    expect(provider.seen).toEqual([{}, { from: 1, to: 2, model: 'chat' }])
  })

  it('reports an unavailable composition instead of zero totals', async () => {
    const { controller } = await boot([], { withProvider: false })
    await expect(controller.query()).rejects.toBeInstanceOf(RemoteError)
    await expect(controller.query()).rejects.toMatchObject({ code: 'usage/unavailable' })
  })

  it('propagates a provider failure that is not an unavailable composition', async () => {
    const { controller, ctx } = await boot([], { withProvider: false })
    ctx.usage.registerProvider({
      name: 'throwing',
      query: () => Promise.reject(new Error('ledger exploded')),
    })
    await expect(controller.query()).rejects.toThrow('ledger exploded')
  })

  it('refuses a malformed filter at the wire boundary', async () => {
    const { controller, provider } = await boot()
    await expect(controller.query({ from: 'yesterday' } as never))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(provider.seen).toEqual([])
  })
})
