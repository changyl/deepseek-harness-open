/**
 * CommandPaletteController: the open/close store, per-open row loading with
 * supersession and failure, local ranking, highlight movement, and the
 * dispatch behind every entry kind.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CommandPaletteRow, CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CommandPaletteController, filterEntries, type PaletteEntry } from '../src/client/palette.ts'
import type { CommandPaletteTranslate } from '../src/client/locales.ts'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId

/** Translator over the real Chinese dictionaries (assertions read product copy). */
const t: CommandPaletteTranslate = makeTranslate(zh, commonZh)

/** Fields the controller reads from one session binding. */
interface FakeSession {
  getSnapshot(): { running: boolean }
  cancel(): Promise<unknown>
}

/** One bound session, idle unless stated otherwise. */
function fakeSession(running: boolean, cancel: () => Promise<unknown> = async () => ({ ok: true })): FakeSession {
  return { getSnapshot: () => ({ running }), cancel }
}

/** Bench options; every default is the happy path for one live idle session. */
interface BenchOptions {
  current?: SessionId | undefined
  session?: FakeSession | undefined
  workspace?: { startSession(): Promise<SessionId | undefined> } | undefined
  /** Destination the new-session flow reports; undefined models a superseded flow. */
  startSessionResult?: SessionId | undefined
  rows?: readonly CommandPaletteRow[] | Error
  palette?: (signal: AbortSignal) => Promise<readonly CommandPaletteRow[]>
}

/** Build one controller over fake session, command, and workspace faces. */
function bench(options: BenchOptions = {}) {
  const run = vi.fn()
  const palette = vi.fn((_session: unknown, signal: AbortSignal) => {
    if (options.palette !== undefined) return options.palette(signal)
    const rows = options.rows ?? []
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)
  })
  const current = 'current' in options ? options.current : SESSION
  const session = 'session' in options ? options.session : fakeSession(false)
  const binding = vi.fn((id: SessionId) => (session === undefined || id !== SESSION ? undefined : { session }))
  const sessions = {
    list: { getSnapshot: () => ({ current }) },
    binding,
  } as unknown as ISessions
  const currentSession = { getSnapshot: () => ({ key: current }) } as never
  const destination = options.startSessionResult
  const startSession = vi.fn(() => Promise.resolve(destination))
  const workspace = 'workspace' in options ? options.workspace : { startSession }
  const focusComposer = vi.fn()
  const controller = new CommandPaletteController({
    commands: { palette, run, focusComposer } as unknown as CommandUiContract,
    sessions,
    currentSession,
    workspace: () => workspace,
    t,
  })
  return { controller, palette, run, focusComposer, binding, startSession }
}

/** Wait for the open palette to settle out of its loading state. */
async function settle(controller: CommandPaletteController): Promise<void> {
  await vi.waitFor(() => { expect(controller.state.getSnapshot().status).not.toBe('loading') })
}

const ROWS: CommandPaletteRow[] = [
  { name: 'compact', label: 'Compact', section: 'Commands' },
  { name: 'model', label: 'Model', description: 'Pick a model', hint: '<name>', section: 'Commands' },
]

describe('filterEntries', () => {
  const entries = [
    { id: 'command:model', kind: 'command', sessionId: SESSION, name: 'model', label: 'Model' },
    { id: 'command:compact', kind: 'command', sessionId: SESSION, name: 'compact', label: 'Compact' },
  ] satisfies PaletteEntry[]

  it('returns every row for a blank query', () => {
    expect(filterEntries(entries, '   ')).toEqual(entries)
  })

  it('ranks by name and by localized label', () => {
    expect(filterEntries(entries, 'comp').map(entry => entry.id)).toEqual(['command:compact'])
    expect(filterEntries(entries, 'Mod').map(entry => entry.id)).toEqual(['command:model'])
    expect(filterEntries(entries, 'zzz')).toEqual([])
  })
})

describe('CommandPaletteController', () => {
  it('opens on the current session, offers the owned actions, then loads command rows', async () => {
    const { controller, palette } = bench({ rows: ROWS })
    controller.open()

    const opening = controller.state.getSnapshot()
    expect(opening.open).toBe(true)
    expect(opening.status).toBe('loading')
    expect(opening.entries.map(entry => entry.id)).toEqual(['action:new-session'])
    expect(opening.entries[0]?.section).toBe(zh['palette.section.actions'])

    await settle(controller)
    const loaded = controller.state.getSnapshot()
    expect(loaded.status).toBe('ready')
    expect(loaded.entries.map(entry => entry.id)).toEqual(['action:new-session', 'command:compact', 'command:model'])
    expect(loaded.entries[2]).toMatchObject({ description: 'Pick a model', hint: '<name>', section: 'Commands' })
    expect(palette).toHaveBeenCalledWith({ sessionId: SESSION }, expect.any(AbortSignal))
  })

  it('offers Stop only while the current session is running', async () => {
    const cancel = vi.fn(async () => ({ ok: true }))
    const { controller, focusComposer } = bench({ session: fakeSession(true, cancel), rows: ROWS })
    controller.open()
    expect(controller.state.getSnapshot().entries.map(entry => entry.id)).toEqual(['action:new-session', 'action:stop'])

    await settle(controller)
    controller.run('action:stop')
    expect(cancel).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => { expect(controller.state.getSnapshot().open).toBe(false) })
    // The pick took the caret with the palette: the composer it belongs to gets it back.
    expect(focusComposer).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('offers no commands and says so when no session is current', async () => {
    const { controller, palette } = bench({ current: undefined })
    controller.open()
    const state = controller.state.getSnapshot()
    expect(state.status).toBe('no-session')
    expect(state.entries.map(entry => entry.id)).toEqual(['action:new-session'])
    expect(palette).not.toHaveBeenCalled()
  })

  it('reports a failed load, and a retry starts a fresh one', async () => {
    const failure = new Error('catalog down')
    const { controller } = bench({ rows: failure })
    controller.open()
    await settle(controller)
    expect(controller.state.getSnapshot()).toMatchObject({ status: 'failed', error: 'catalog down' })

    controller.open()
    expect(controller.state.getSnapshot().status).toBe('loading')
    await settle(controller)
    expect(controller.state.getSnapshot().status).toBe('failed')
  })

  it('reports a non-Error rejection through its string form', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the scenario under test
    const { controller } = bench({ palette: () => Promise.reject('offline') })
    controller.open()
    await settle(controller)
    expect(controller.state.getSnapshot()).toMatchObject({ status: 'failed', error: 'offline' })
  })

  it('drops a superseded load when the palette opens again', async () => {
    const releases: Array<(rows: readonly CommandPaletteRow[]) => void> = []
    const { controller } = bench({
      palette: () => new Promise((resolve) => { releases.push(resolve) }),
    })
    controller.open()
    controller.open()
    releases[0]?.(ROWS)
    await Promise.resolve()
    expect(controller.state.getSnapshot().status).toBe('loading')

    releases[1]?.([])
    await settle(controller)
    expect(controller.state.getSnapshot().entries).toEqual([
      expect.objectContaining({ id: 'action:new-session' }),
    ])
  })

  it('closes, cancels the in-flight load, and forgets the rows', async () => {
    const signals: AbortSignal[] = []
    const { controller } = bench({ palette: (signal) => { signals.push(signal); return Promise.resolve(ROWS) } })
    controller.open()
    controller.toggle()
    expect(signals[0]?.aborted).toBe(true)
    expect(controller.state.getSnapshot()).toMatchObject({ open: false, status: 'idle', entries: [], error: null })
  })

  it('toggles from closed to open', () => {
    const { controller } = bench({})
    expect(controller.state.getSnapshot().open).toBe(false)
    controller.toggle()
    expect(controller.state.getSnapshot().open).toBe(true)
  })

  it('filters locally, wraps the highlight, and ignores an out-of-range highlight', async () => {
    const { controller } = bench({ rows: ROWS })
    controller.open()
    await settle(controller)

    controller.setQuery('model')
    expect(controller.state.getSnapshot()).toMatchObject({ query: 'model', active: 0 })
    controller.move(1)
    expect(controller.state.getSnapshot().active).toBe(0)
    controller.move(-1)
    expect(controller.state.getSnapshot().active).toBe(0)

    controller.setQuery('')
    controller.move(1)
    expect(controller.state.getSnapshot().active).toBe(1)
    controller.highlight(2)
    expect(controller.state.getSnapshot().active).toBe(2)
    controller.highlight(-1)
    controller.highlight(99)
    expect(controller.state.getSnapshot().active).toBe(2)
  })

  it('ignores highlight movement while no row is visible', async () => {
    const { controller } = bench({ rows: [] })
    controller.open()
    await settle(controller)
    controller.setQuery('zzz')
    controller.move(1)
    controller.highlight(0)
    expect(controller.state.getSnapshot().active).toBe(0)
  })

  it('dispatches a command pick against the session it was loaded for', async () => {
    const { controller, run, focusComposer } = bench({ rows: ROWS })
    controller.open()
    await settle(controller)
    controller.run('command:model')
    expect(run).toHaveBeenCalledWith('model', { sessionId: SESSION })
    expect(controller.state.getSnapshot().open).toBe(false)
    // The command surface owns the caret for a command row: it knows whether
    // the pick opened a popup that keeps focus.
    expect(focusComposer).not.toHaveBeenCalled()
  })

  it('starts a new session, hands the caret to the session it landed on, and survives no Workspace navigation', async () => {
    const DESTINATION = 'session-destination' as SessionId
    const withWorkspace = bench({ startSessionResult: DESTINATION })
    withWorkspace.controller.open()
    withWorkspace.controller.run('action:new-session')
    expect(withWorkspace.startSession).toHaveBeenCalledTimes(1)
    // The flow reuses a current blank session, so no composer remounts to take
    // the caret; the pick hands it to the destination the flow reports.
    await vi.waitFor(() => { expect(withWorkspace.focusComposer).toHaveBeenCalledExactlyOnceWith(DESTINATION) })

    // A superseded flow reports no destination, so nothing takes the caret.
    const superseded = bench({ startSessionResult: undefined })
    superseded.controller.open()
    superseded.controller.run('action:new-session')
    await Promise.resolve()
    expect(superseded.focusComposer).not.toHaveBeenCalled()

    const withoutWorkspace = bench({ workspace: undefined })
    withoutWorkspace.controller.open()
    expect(() => { withoutWorkspace.controller.run('action:new-session') }).not.toThrow()
  })

  it('defaults a row label to its command name and omits absent optional fields', async () => {
    const { controller } = bench({ rows: [{ name: 'echo' }] })
    controller.open()
    await settle(controller)
    expect(controller.state.getSnapshot().entries).toEqual([
      expect.objectContaining({ id: 'action:new-session' }),
      { id: 'command:echo', kind: 'command', sessionId: SESSION, name: 'echo', label: 'echo' },
    ])
  })

  it('ignores a failure that arrives after a later open superseded it', async () => {
    const rejectors: Array<(error: unknown) => void> = []
    const { controller } = bench({
      palette: () => new Promise((_resolve, reject) => { rejectors.push(reject) }),
    })
    controller.open()
    controller.open()
    rejectors[0]?.(new Error('stale'))
    await Promise.resolve()
    expect(controller.state.getSnapshot().status).toBe('loading')

    rejectors[1]?.(new Error('current'))
    await settle(controller)
    expect(controller.state.getSnapshot()).toMatchObject({ status: 'failed', error: 'current' })
  })

  it('drops a stop whose session is no longer bound, and reports a transport rejection', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('socket gone')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { controller, focusComposer, binding } = bench({ session: fakeSession(true, cancel), rows: ROWS })
    controller.open()
    await settle(controller)

    binding.mockReturnValue(undefined)
    controller.run('action:stop')
    expect(cancel).not.toHaveBeenCalled()
    // No bound composer to hand the caret to.
    expect(focusComposer).not.toHaveBeenCalled()

    binding.mockImplementation((id: SessionId) => (id === SESSION ? { session: fakeSession(true, cancel) } : undefined))
    controller.open()
    await settle(controller)
    controller.run('action:stop')
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith('command palette: stop failed:', expect.any(Error)) })
    expect(focusComposer).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('ignores a pick whose row is gone', async () => {
    const { controller, run, startSession } = bench({ rows: ROWS })
    controller.open()
    await settle(controller)
    controller.run('command:missing')
    expect(run).not.toHaveBeenCalled()
    expect(startSession).not.toHaveBeenCalled()
    expect(controller.state.getSnapshot().open).toBe(true)
  })
})
