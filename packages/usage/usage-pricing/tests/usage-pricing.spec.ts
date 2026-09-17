import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UsageService from '@deepseek-ai/dsh-usage'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import * as pricingPlugin from '../src/index.ts'
import { UsagePricingTable } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const CHAT: Config = {
  currency: 'CNY',
  version: '2026-09-16',
  routes: [
    {
      provider: 'deepseek',
      model: 'chat',
      uncachedInputPerMillion: 2_000_000,
      outputPerMillion: 8_000_000,
      cacheReadPerMillion: 200_000,
      cacheWritePerMillion: 2_500_000,
    },
  ],
}

describe('usage pricing table', () => {
  it('resolves declared routes and reports the rest unpriced', () => {
    const table = new UsagePricingTable(CHAT)
    expect(table.currency).toBe('CNY')
    expect(table.version).toBe('2026-09-16')
    expect(table.price('deepseek', 'chat')).toEqual({
      uncachedInputPerMillion: 2_000_000,
      outputPerMillion: 8_000_000,
      cacheReadPerMillion: 200_000,
      cacheWritePerMillion: 2_500_000,
    })
    expect(table.price('deepseek', 'reasoner')).toBeUndefined()
    expect(table.routes()).toEqual([{ provider: 'deepseek', model: 'chat', price: table.price('deepseek', 'chat') }])
  })

  it('adopts a later table wholesale', () => {
    const table = new UsagePricingTable(CHAT)
    table.adopt({ currency: 'USD', version: 'v2', routes: [] })
    expect(table.currency).toBe('USD')
    expect(table.version).toBe('v2')
    expect(table.price('deepseek', 'chat')).toBeUndefined()
    expect(table.routes()).toEqual([])
  })

  it('refuses a table naming one route twice', () => {
    const duplicated: Config = {
      currency: CHAT.currency,
      version: CHAT.version,
      routes: [CHAT.routes[0]!, CHAT.routes[0]!],
    }
    expect(() => new UsagePricingTable(duplicated)).toThrow(/more than once/)
    const table = new UsagePricingTable(CHAT)
    expect(() => {
      table.adopt(duplicated)
    }).toThrow(/more than once/)
    expect(table.price('deepseek', 'chat')).toBeDefined()
  })
})

async function mountUsage(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(UsageService)
  return ctx
}

describe('usage pricing plugin', () => {
  it('registers the composed table on the usage service and removes it on disposal', async () => {
    const ctx = await mountUsage()
    const fiber = await ctx.plugin(pricingPlugin, CHAT)

    expect(ctx.usage.price('deepseek', 'chat')).toEqual({
      uncachedInputPerMillion: 2_000_000,
      outputPerMillion: 8_000_000,
      cacheReadPerMillion: 200_000,
      cacheWritePerMillion: 2_500_000,
    })

    await fiber.dispose()
    expect(ctx.usage.price('deepseek', 'chat')).toBeUndefined()
  })

  it('registers without a settings provider and keeps the composed table', async () => {
    const ctx = await mountUsage()
    await ctx.plugin(pricingPlugin, { currency: CHAT.currency, version: CHAT.version, routes: [] })
    expect(ctx.usage.price('deepseek', 'chat')).toBeUndefined()
    expect(ctx.get('settings')).toBeUndefined()
  })

  it('adopts committed settings values when a provider is mounted', async () => {
    const ctx = await mountUsage()
    await ctx.plugin(MemorySettings)

    const scopes: SettingsScope<Config>[] = []
    const original = ctx.settings.register.bind(ctx.settings)
    vi.spyOn(ctx.settings, 'register').mockImplementation((ns, schema, options) => {
      const scope = original(ns, schema, options) as SettingsScope<Config>
      scopes.push(scope)
      return scope
    })

    await ctx.plugin(pricingPlugin, CHAT)
    await vi.waitFor(() => {
      expect(scopes).toHaveLength(1)
    })

    await scopes[0]!.update({ version: 'v2', currency: 'USD', routes: [] })
    await vi.waitFor(() => {
      expect(ctx.usage.price('deepseek', 'chat')).toBeUndefined()
    })
    expect(scopes[0]!.get().currency).toBe('USD')
  })
})
