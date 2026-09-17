// @vitest-environment jsdom
/**
 * ui-effectiveness plugin halves: the browser entry's dictionary and
 * Settings-section registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the failed-read classification of the
 * Remote face, and the inert node entry.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { EffectivenessReportWire } from '@deepseek-ai/dsh-api-effectiveness/types'
import { apply, inject } from '../src/client/index.ts'
import { EffectivenessSection } from '../src/client/EffectivenessSection.tsx'
import type { EffectivenessSectionInjected } from '../src/client/EffectivenessSection.tsx'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const REPORT: EffectivenessReportWire = {
  totals: {
    feedback: { positive: 0, negative: 0, byCategory: {} },
    changes: { accepted: 0, reverted: 0, undecided: 0 },
    verification: { passed: 0, failed: 0, unknown: 0 },
    turnsWithSignal: 0,
    sessions: 0,
  },
  routes: [],
  sessions: [],
  truncated: false,
}

type Result<T> =
  | { readonly ok: true; readonly value: T }
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
  const query = vi.fn<() => Promise<Result<EffectivenessReportWire>>>()
    .mockResolvedValue({ ok: true, value: REPORT })
  ctx.provide('remote.effectiveness', { query })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, query }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-effectiveness browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.effectiveness'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('registers a localized section without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(EffectivenessSection)
    expect(entry.options).toMatchObject({ id: 'effectiveness', order: 50 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('有效性')
    expect(b.query).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => EffectivenessSectionInjected)()
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
    const injected = (entry.inject as unknown as () => EffectivenessSectionInjected)()

    b.query.mockResolvedValueOnce({
      ok: false,
      error: { code: 'gateway/bad-request', message: 'malformed filter' },
    })
    await expect(injected.query())
      .rejects.toThrow('effectiveness.query failed: gateway/bad-request: malformed filter')
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Effectiveness')

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).toBe(EffectivenessSection)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
