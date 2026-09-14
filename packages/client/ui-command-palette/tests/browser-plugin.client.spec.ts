/**
 * ui-command-palette browser half on a real SlotRegistry and ShortcutRegistry:
 * the plugin occupies the frame-wide `shell.overlay` seat, its injected face
 * drives the controller's verbs, the registry's open chords reach the same
 * controller, and teardown releases the slot entry, the bindings, and the
 * dictionaries (HMR safety).
 */
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CommandPalette } from '../src/client/CommandPalette.tsx'
import type { CommandPaletteInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { ShortcutRegistry } from '../src/client/shortcuts.ts'
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

  const startSession = vi.fn()
  const run = vi.fn()
  ctx.provide('uiWorkspace', { startSession } as never)
  ctx.provide('commandUi', { palette: async () => [], run } as never)
  ctx.provide('sessions', {
    list: { getSnapshot: () => ({ current: SESSION }) },
    binding: () => undefined,
  } as never)
  // The locale plugin binds a settings scope, which reads the connection handle
  // and the forwarded-event port.
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = ctx.slots.entries('shell.overlay')[0]
  if (entry === undefined) throw new Error('shell.overlay entry not registered')
  const injected = (entry.inject as unknown as () => CommandPaletteInjected)()
  return { ctx, fiber, entry, injected, startSession, run }
}

/** Build one keydown for the registry's own dispatch. */
function keydown(key: string, over: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...over })
}

describe('ui-command-palette browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'commandUi', 'sessions'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { applyNode() }).not.toThrow()
  })

  it('occupies the frame overlay with the palette component', async () => {
    const { entry } = await bench()
    expect(entry.component).toBe(CommandPalette)
    expect(entry.locale).toBe(NS)
  })

  it('opens and closes through the injected verbs and the registry chords', async () => {
    const { ctx, injected } = await bench()
    const registry = ctx.get('shortcuts') as unknown as ShortcutRegistry
    const palette = (): ReturnType<CommandPaletteInjected['hooks']['palette']['getSnapshot']> =>
      injected.hooks.palette.getSnapshot()

    expect(palette().open).toBe(false)
    expect(registry.handle(keydown('k', { metaKey: true }))).toBe(true)
    expect(palette().open).toBe(true)
    expect(registry.handle(keydown('p', { metaKey: true, shiftKey: true }))).toBe(true)
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

  it('starts a session and reloads commands through the injected verbs', async () => {
    const { injected, startSession, run } = await bench()
    injected.retry()
    injected.run('action:new-session')
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })

  it('releases the slot entry, the chords, and the dictionaries with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const registry = ctx.get('shortcuts') as unknown as ShortcutRegistry
    const translate = ctx.locale.bind(NS)
    expect(translate('palette.aria')).toBe(zh['palette.aria'])

    await fiber.dispose()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    expect(registry.handle(keydown('k', { metaKey: true }))).toBe(false)
    // Withdrawn dictionaries leave the key unresolved rather than translated.
    expect(translate('palette.aria')).not.toBe(zh['palette.aria'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
