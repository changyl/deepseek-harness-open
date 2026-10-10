/**
 * ui-command-palette browser half on a real SlotRegistry and a recording
 * shortcuts face: the plugin occupies the frame-wide `shell.overlay` seat, its
 * injected face drives the controller's verbs, its reserved open chords reach
 * the same controller, and teardown releases the slot entry, the chords, and
 * the dictionaries (HMR safety).
 */
// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { ShortcutBinding, ShortcutFixedCommand, ShortcutFixedInput, ShortcutGesture } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CommandPalette } from '../src/client/CommandPalette.tsx'
import type { CommandPaletteInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import type { PaletteShortcutFace } from '../src/client/open-shortcut.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'

const SESSION = 's-palette' as SessionId

/** Boot the browser half over a real slot tree that declares the overlay list. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'shell.overlay': { kind: 'list', scope: 'root' } },
  } as never, () => null)

  const startSession = vi.fn(async () => SESSION)
  const run = vi.fn()
  const focusComposer = vi.fn()
  ctx.provide('uiWorkspace', { startSession } as never)
  ctx.provide('commandUi', { palette: async () => [], run, focusComposer } as never)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: SESSION }) },
    binding: () => undefined,
  } as never)
  // ui-session owns the current Session selection: the palette reads its
  // `session` scope binding source at open time.
  ctx.provide('uiSession', {
    adapter: { current: { getSnapshot: () => ({ key: SESSION }) } },
  } as never)
  // The locale plugin binds the language preference form, which reads the
  // forwarded-event port and the shared configuration-form registry.
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('configForms', {
    developerTools: { enabled: createSnapshotStore(true) },
    get: () => stubConfigForm().scope,
  } as never)
  const chords = fakeShortcuts()
  ctx.provide('shortcuts', chords.face as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = ctx.slots.entries('shell.overlay')[0]
  if (entry === undefined) throw new Error('shell.overlay entry not registered')
  const injected = (entry.inject as unknown as () => CommandPaletteInjected)()
  return { ctx, fiber, entry, injected, startSession, focusComposer, run, chords }
}

/** One keydown gesture on the primary modifier plus Shift. */
function gesture(code: string, shift: boolean): ShortcutGesture {
  return { code, control: false, alt: false, shift, meta: true, repeat: false, composing: false, defaultPrevented: false }
}

/**
 * Recording shortcuts face: it keeps the reserved row and delivers fixed input
 * to the palette's listener, releasing both on the plugin's disposers.
 * @returns the face plus the recorded row, the send verb, and the release flag.
 */
function fakeShortcuts(): {
  face: PaletteShortcutFace
  command(): ShortcutFixedCommand | undefined
  send(gesture: ShortcutGesture): boolean
  released(): boolean
} {
  let command: ShortcutFixedCommand | undefined
  let listener: ((input: ShortcutFixedInput) => void) | undefined
  let released = false
  return {
    face: {
      platform: 'macos',
      describeBinding: (binding: ShortcutBinding) => ({
        binding: null, keys: binding.code === 'KeyK' ? ['⌘', 'K'] : ['⇧', '⌘', 'P'], issue: null, conflicts: [],
      }),
      registerFixed: (next: ShortcutFixedCommand) => {
        command = next
        return () => { command = undefined; released = true }
      },
      observeFixedInput: (next: (input: ShortcutFixedInput) => void) => {
        listener = next
        return () => { listener = undefined; released = true }
      },
    },
    command: () => command,
    released: () => released,
    send: (next) => {
      let consumed = false
      listener?.({ type: 'keydown', gesture: next, context: { region: 'page', modal: null, target: null },
        consume: () => { consumed = true } })
      return consumed
    },
  }
}

describe('ui-command-palette browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'commandUi', 'sessions', 'uiSession'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { applyNode() }).not.toThrow()
  })

  it('occupies the frame overlay with the palette component', async () => {
    const { entry } = await bench()
    expect(entry.component).toBe(CommandPalette)
    expect(entry.locale).toBe(NS)
  })

  it('opens and closes through the injected verbs and the reserved chords', async () => {
    const { injected, chords } = await bench()
    const palette = (): ReturnType<CommandPaletteInjected['hooks']['palette']['getSnapshot']> =>
      injected.hooks.palette.getSnapshot()

    expect(palette().open).toBe(false)
    expect(chords.send(gesture('KeyK', false))).toBe(true)
    expect(palette().open).toBe(true)
    expect(chords.send(gesture('KeyP', true))).toBe(true)
    expect(palette().open).toBe(false)

    injected.retry()
    expect(palette().open).toBe(true)
    injected.setQuery('mod')
    injected.highlight(0)
    injected.move(1)
    expect(palette().query).toBe('mod')
    injected.setQuery('')
    injected.run('action:new-session')
    expect(palette().open).toBe(false)
    injected.close()
    expect(palette().open).toBe(false)
  })

  it('starts a session, hands the caret to where it landed, and reloads commands through the injected verbs', async () => {
    const { injected, startSession, focusComposer, run } = await bench()
    injected.retry()
    injected.run('action:new-session')
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(focusComposer).toHaveBeenCalledExactlyOnceWith(SESSION) })
  })

  it('releases the slot entry, the chords, and the dictionaries with the fiber', async () => {
    const { ctx, fiber, chords } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('palette.aria')).toBe(zh['palette.aria'])

    await fiber.dispose()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    expect(chords.command()).toBeUndefined()
    expect(chords.released()).toBe(true)
    expect(chords.send(gesture('KeyK', false))).toBe(false)
    // Withdrawn dictionaries leave the key unresolved rather than translated.
    expect(translate('palette.aria')).not.toBe(zh['palette.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
