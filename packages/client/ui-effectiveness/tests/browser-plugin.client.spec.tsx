// @vitest-environment jsdom
/**
 * ui-effectiveness plugin halves: the browser entry's dictionary and
 * global-panel registrations against the real SlotRegistry (with fiber
 * teardown proving removal — HMR safety), the failed-read classification of the
 * Remote face, and the inert node entry.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel, type PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { EffectivenessReportWire } from '@deepseek-ai/dsh-api-effectiveness/types'
import { apply, inject } from '../src/client/index.ts'
import { EffectivenessPanel } from '../src/client/EffectivenessPanel.tsx'
import type { EffectivenessPanelInjected } from '../src/client/EffectivenessPanel.tsx'
import { EffectivenessPanelIcon } from '../src/client/EffectivenessPanelIcon.tsx'
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
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

/** Props of one panellist row glyph, narrowed for a direct render. */
function iconProps(size: number): PropsRuntime<'sidebar.panellist'> {
  return { size, active: false } as unknown as PropsRuntime<'sidebar.panellist'>
}

describe('ui-effectiveness browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the panel contributions', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.effectiveness'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('draws the sidebar row glyph at the size the row requests', () => {
    const { container } = render(<EffectivenessPanelIcon {...iconProps(18)} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('18')
  })

  it('registers one panel and its matching sidebar row without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const panel = b.slots.entries('main')[0]!
    const row = b.slots.entries('sidebar.panellist')[0]!
    expect(panel.component).toBe(EffectivenessPanel)
    expect(panel.options).toMatchObject({ key: 'effectiveness' })
    expect(panel.locale).toBe(NS)
    expect(row.component).toBe(EffectivenessPanelIcon)
    // The row id and the main key are the same identity: a mismatch would
    // select a main panel that is not registered.
    expect(row.options).toMatchObject({ id: 'effectiveness', order: 30 })
    expect(resolveSlotLabel(row.options.label)).toBe('有效性')
    expect(b.query).not.toHaveBeenCalled()

    const injected = (panel.inject as unknown as () => EffectivenessPanelInjected)()
    await expect(injected.query()).resolves.toEqual(REPORT)
    expect(b.query).toHaveBeenCalledOnce()
    // The Remote face checks arity against the descriptor, so the optional
    // filter goes as an explicit `undefined` rather than an omitted argument.
    expect(b.query).toHaveBeenCalledWith(undefined)
  })

  it('classifies a refused Remote call as a failure the panel can render', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const panel = b.slots.entries('main')[0]!
    const injected = (panel.inject as unknown as () => EffectivenessPanelInjected)()

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
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('main')).toHaveLength(1) })
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(1)
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('sidebar.panellist')[0]!.options.label)).toBe('Effectiveness')

    stop()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('main')[0]?.component).toBe(EffectivenessPanel)
    })

    await fiber.dispose()
    expect(b.slots.entries('main')).toHaveLength(0)
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
