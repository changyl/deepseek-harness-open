/**
 * CommandPalette component: rendered states (closed, loading, no session,
 * failed with retry, empty, loaded), local filtering, keyboard movement and
 * dispatch, pointer pick, focus ownership, and Escape through the Modal shell.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CommandPalette, type CommandPaletteProps } from '../src/client/CommandPalette.tsx'
import type { PaletteEntry, PaletteState } from '../src/client/palette.ts'
import { zh } from '../src/client/locales.ts'

// jsdom has no scrollIntoView; the card calls it on the highlighted row.
const scrollIntoView = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SESSION = 'session' as SessionId
const t: CommandPaletteProps['t'] = makeTranslate(zh, commonZh)

const ENTRIES: readonly PaletteEntry[] = [
  { id: 'action:new-session', kind: 'new-session', name: 'new session', label: '新会话', description: '开始一个新的对话', section: '操作' },
  { id: 'action:stop', kind: 'stop', sessionId: SESSION, name: 'stop generating', label: '停止生成', section: '操作' },
  { id: 'command:compact', kind: 'command', sessionId: SESSION, name: 'compact', label: 'Compact', section: 'Commands' },
  { id: 'command:model', kind: 'command', sessionId: SESSION, name: 'model', label: 'Model', description: 'Pick a model', hint: '<name>', section: 'Commands' },
  { id: 'command:plan', kind: 'command', sessionId: SESSION, name: 'plan', label: 'Plan' },
]

const CLOSED: PaletteState = { open: false, status: 'idle', query: '', entries: [], active: 0, error: null }

/** Render props over one store-backed state source plus spies for the verbs. */
function bench(state: PaletteState) {
  const store = createSnapshotStore<PaletteState>(state)
  const close = vi.fn()
  const setQuery = vi.fn()
  const move = vi.fn()
  const highlight = vi.fn()
  const run = vi.fn()
  const retry = vi.fn()
  function usePalette<S>(select: (snapshot: PaletteState) => S): S {
    return select(store.getSnapshot())
  }
  const props = { usePalette, close, setQuery, move, highlight, run, retry, t } as unknown as CommandPaletteProps
  return { props, store, close, setQuery, move, highlight, run, retry }
}

/** Render one open palette in a given state. */
function open(over: Partial<PaletteState> = {}) {
  const benchResult = bench({ open: true, status: 'ready', query: '', entries: ENTRIES, active: 0, error: null, ...over })
  const view = render(<CommandPalette {...benchResult.props} />)
  return { ...benchResult, view }
}

describe('CommandPalette', () => {
  it('renders nothing while closed', () => {
    const { view } = open({ ...CLOSED })
    expect(view.container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists the owned actions and the command rows, grouped by section', () => {
    open()
    expect(screen.getByRole('dialog', { name: zh['palette.aria'] })).toBeDefined()
    const options = screen.getAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual([
      '新会话开始一个新的对话',
      '停止生成',
      'Compact',
      'ModelPick a model<name>',
      'Plan',
    ])
    // Two headings for the two sections; the second `操作` row adds none.
    const list = within(screen.getByRole('listbox'))
    expect(list.getAllByRole('presentation').map(node => node.textContent)).toEqual(['操作', 'Commands'])
  })

  it('shows the loading, no-session, empty, and failure states', () => {
    const loading = open({ status: 'loading', entries: [] })
    expect(screen.getByText(zh['palette.status.loading'])).toBeDefined()
    loading.view.unmount()

    const noSession = open({ status: 'no-session', entries: [] })
    expect(screen.getByText(zh['palette.status.noSession'])).toBeDefined()
    noSession.view.unmount()

    const empty = open({ entries: [] })
    expect(screen.getByText(zh['palette.status.empty'])).toBeDefined()
    // No visible row means no active descendant.
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBeNull()
    empty.view.unmount()

    const failed = open({ status: 'failed', entries: [], error: 'catalog down' })
    expect(screen.getByRole('alert').textContent).toContain('catalog down')
    fireEvent.click(screen.getByRole('button', { name: commonZh['retry'] }))
    expect(failed.retry).toHaveBeenCalledTimes(1)
  })

  it('falls back to its own failure copy when the load reported no message', () => {
    open({ status: 'failed', entries: [], error: null })
    expect(screen.getByRole('alert').textContent).toContain(zh['palette.status.failed'])
  })

  it('filters through the injected query verb', () => {
    const { setQuery } = open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mod' } })
    expect(setQuery).toHaveBeenCalledWith('mod')
  })

  it('moves the highlight with the arrow keys and runs the active row on Enter', () => {
    const { move, run } = open({ active: 1 })
    // The card handles keys that bubble from the focused search input.
    const search = screen.getByRole('combobox')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(move).toHaveBeenCalledWith(1)
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(move).toHaveBeenCalledWith(-1)
    fireEvent.keyDown(search, { key: 'a' })
    expect(move).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(search, { key: 'Enter' })
    expect(run).toHaveBeenCalledWith('action:stop')
    expect(screen.getByRole('combobox').getAttribute('aria-activedescendant')).toBe('command-palette-option-1')
  })

  it('does nothing on Enter while no row is visible', () => {
    const { run } = open({ entries: [] })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(run).not.toHaveBeenCalled()
  })

  it('closes on Escape through the modal shell', () => {
    const { close } = open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('runs a clicked row and highlights a hovered one', () => {
    const { run, highlight } = open()
    const options = screen.getAllByRole('option')
    fireEvent.mouseEnter(options[3] as HTMLElement)
    expect(highlight).toHaveBeenCalledWith(3)
    fireEvent.click(options[3] as HTMLElement)
    expect(run).toHaveBeenCalledWith('command:model')
  })

  it('holds focus in the search input and follows the highlight', async () => {
    const { store } = open()
    expect(document.activeElement).toBe(screen.getByRole('combobox'))

    await act(async () => { store.update((draft) => { draft.active = 2 }) })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
