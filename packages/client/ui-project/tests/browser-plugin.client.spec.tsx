// @vitest-environment jsdom
/**
 * ui-project plugin halves: the browser entry's dictionary and Settings-section
 * registrations against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the failed-read classification of both Remote methods,
 * and the inert node entry.
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { ProjectBoardWire, ProjectListWire } from '@deepseek-ai/dsh-api-project/types'
import { apply, inject } from '../src/client/index.ts'
import { ProjectSection } from '../src/client/ProjectSection.tsx'
import type { ProjectSectionInjected } from '../src/client/ProjectSection.tsx'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY_LISTING: ProjectListWire = { projects: [], truncated: false }
const EMPTY_BOARD: ProjectBoardWire = {
  project: {
    id: 'project-1',
    title: 'Release',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    revision: 0,
    tasks: [],
  },
  columns: { todo: [], doing: [], blocked: [], done: [], cancelled: [] },
  ready: [],
  stranded: [],
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
  const list = vi.fn<() => Promise<Result<ProjectListWire>>>()
    .mockResolvedValue({ ok: true, value: EMPTY_LISTING })
  const board = vi.fn<(id: string) => Promise<Result<ProjectBoardWire>>>()
    .mockResolvedValue({ ok: true, value: EMPTY_BOARD })
  ctx.provide('remote.project', { list, board })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, board }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-project browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.project'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('registers a localized section without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ProjectSection)
    expect(entry.options).toMatchObject({ id: 'projects', order: 40 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('项目')
    expect(b.list).not.toHaveBeenCalled()
    expect(b.board).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => ProjectSectionInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY_LISTING)
    await expect(injected.board('project-1')).resolves.toEqual(EMPTY_BOARD)
    expect(b.list).toHaveBeenCalledOnce()
    // The Remote face checks arity against the descriptor, so the optional
    // filter goes as an explicit `undefined` rather than an omitted argument.
    expect(b.list).toHaveBeenCalledWith(undefined)
    expect(b.board).toHaveBeenCalledWith('project-1')
  })

  it('classifies a refused Remote call as a failure the section can render', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => ProjectSectionInjected)()

    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/bad-request', message: 'bad filter' } })
    await expect(injected.list()).rejects.toThrow('project.list failed: gateway/bad-request: bad filter')

    b.board.mockResolvedValueOnce({ ok: false, error: { code: 'project/not-found', message: 'gone' } })
    await expect(injected.board('project-9')).rejects.toThrow('project.board failed: project/not-found: gone')
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Projects')

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).toBe(ProjectSection)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
