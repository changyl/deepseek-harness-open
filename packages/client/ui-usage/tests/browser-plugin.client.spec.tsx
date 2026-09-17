// @vitest-environment jsdom
/**
 * ui-usage plugin halves: the browser entry's dictionary and Settings-section
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the failed-read classification of the Remote face,
 * and the inert node entry.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { UsageReportWire } from '@deepseek-ai/dsh-api-usage/types'
import { apply, inject } from '../src/client/index.ts'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionInjected } from '../src/client/UsageSection.tsx'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const REPORT: UsageReportWire = {
  totals: {
    sessions: 1,
    turns: 1,
    steps: 2,
    unknownUsageSteps: 0,
    uncachedInputTokens: 10,
    outputTokens: 4,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  routes: [],
  unpriced: [],
}

type QueryResult =
  | { readonly ok: true; readonly value: UsageReportWire }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const query = vi.fn<() => Promise<QueryResult>>().mockResolvedValue({ ok: true, value: REPORT })
  ctx.provide('remote.usage', { query })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, query }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-usage browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.usage'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('registers a localized section without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(UsageSection)
    expect(entry.options).toMatchObject({ id: 'usage', order: 30 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('用量')
    expect(b.query).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => UsageSectionInjected)()
    await expect(injected.query()).resolves.toEqual(REPORT)
    expect(b.query).toHaveBeenCalledOnce()
    // The Remote face checks arity against the descriptor, so the optional
    // filter goes as an explicit `undefined` rather than an omitted argument.
    expect(b.query).toHaveBeenCalledWith(undefined)
  })

  it('classifies a refused Remote call as a failure the section can render', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => UsageSectionInjected)()

    b.query.mockResolvedValueOnce({
      ok: false,
      error: { code: 'usage/unavailable', message: 'no provider' },
    })
    await expect(injected.query()).rejects.toThrow('usage.query failed: usage/unavailable: no provider')
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Usage')

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).toBe(UsageSection)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
