/**
 * Palette open chords on the shared shortcuts service: one reserved
 * Application row carrying both keycap pairs, exact modifier matching,
 * consumption before the editable dispatch, and release through the returned
 * disposer.
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  ShortcutBinding, ShortcutFixedCommand, ShortcutFixedInput, ShortcutGesture, ShortcutPlatform,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import { installPaletteOpenShortcut } from '../src/client/open-shortcut.ts'
import type { PaletteShortcutFace } from '../src/client/open-shortcut.ts'
import type { CommandPaletteTranslate } from '../src/client/locales.ts'

/** One held modifier flag of a built gesture. */
type Held = 'control' | 'alt' | 'shift' | 'meta'

/** Keycap pairs the real service presents for the two chords. */
const KEYCAPS: Record<ShortcutPlatform, readonly (readonly string[])[]> = {
  macos: [['⌘', 'K'], ['⇧', '⌘', 'P']],
  windows: [['Ctrl', '+', 'K'], ['Ctrl', '+', 'Shift', '+', 'P']],
  linux: [['Ctrl', 'K'], ['Ctrl', 'Shift', 'P']],
}

/**
 * Shortcuts double: records the fixed row and the fixed-input listener, and
 * presents the platform's keycaps for both chords.
 * @param platform - device platform the chords resolve against.
 * @returns the narrow face plus the recorded row, listener, and release flags.
 */
function bench(platform: ShortcutPlatform = 'macos'): {
  shortcuts: PaletteShortcutFace
  command(): ShortcutFixedCommand | undefined
  send(gesture: ShortcutGesture): { consumed: boolean }
  released(): boolean
} {
  let command: ShortcutFixedCommand | undefined
  let listener: ((input: ShortcutFixedInput) => void) | undefined
  let released = false
  const shortcuts = {
    platform,
    describeBinding: (binding: ShortcutBinding) => ({
      binding: null,
      keys: KEYCAPS[platform][binding.code === 'KeyK' ? 0 : 1] ?? [],
      issue: null,
      conflicts: [],
    }),
    registerFixed: (next: ShortcutFixedCommand) => {
      command = next
      return () => {
        command = undefined
        released = true
      }
    },
    observeFixedInput: (next: (input: ShortcutFixedInput) => void) => {
      listener = next
      return () => {
        listener = undefined
        released = true
      }
    },
  } satisfies PaletteShortcutFace
  return {
    shortcuts,
    command: () => command,
    released: () => released,
    send: (gesture) => {
      let consumed = false
      listener?.({ type: 'keydown', gesture, context: { region: 'page', modal: null, target: null },
        consume: () => { consumed = true } })
      return { consumed }
    },
  }
}

/**
 * Build one keydown gesture.
 * @param code - physical key code.
 * @param held - modifier flags the gesture holds.
 * @param over - gesture facts to override (repeat, composing, defaultPrevented).
 * @returns the gesture.
 */
function gesture(code: string, held: readonly Held[], over: Partial<ShortcutGesture> = {}): ShortcutGesture {
  return {
    code,
    control: held.includes('control'),
    alt: held.includes('alt'),
    shift: held.includes('shift'),
    meta: held.includes('meta'),
    repeat: false,
    composing: false,
    defaultPrevented: false,
    ...over,
  }
}

/** Palette-namespace copy standing in for the bound translator. */
const t = ((key: string) => `t:${key}`) as CommandPaletteTranslate

describe('palette open chords', () => {
  it('reserves one Application row for both chords with the platform keycaps', () => {
    const { shortcuts, command } = bench()
    installPaletteOpenShortcut(shortcuts, t, () => {})
    const row = command()
    expect(row?.id).toBe('commandPalette.open')
    expect(row?.group).toBe('application')
    expect(row?.label()).toBe('t:palette.shortcut.open')
    expect(row?.keys).toEqual(['⌘K', '⇧⌘P'])
    expect(row?.bindings).toEqual([
      { code: 'KeyK', modifiers: ['primary'] },
      { code: 'KeyP', modifiers: ['primary', 'shift'] },
    ])
  })

  it('presents Windows keycaps including the separator', () => {
    const { shortcuts, command } = bench('windows')
    installPaletteOpenShortcut(shortcuts, t, () => {})
    expect(command()?.keys).toEqual(['Ctrl+K', 'Ctrl+Shift+P'])
  })

  it('toggles on either chord and consumes the input', () => {
    const { shortcuts, send } = bench()
    const toggle = vi.fn()
    installPaletteOpenShortcut(shortcuts, t, toggle)

    expect(send(gesture('KeyK', ['meta']))).toEqual({ consumed: true })
    expect(send(gesture('KeyP', ['meta', 'shift']))).toEqual({ consumed: true })
    expect(toggle).toHaveBeenCalledTimes(2)
  })

  it('resolves primary to Control off macOS', () => {
    const { shortcuts, send } = bench('linux')
    const toggle = vi.fn()
    installPaletteOpenShortcut(shortcuts, t, toggle)

    expect(send(gesture('KeyK', ['control']))).toEqual({ consumed: true })
    expect(send(gesture('KeyK', ['meta']))).toEqual({ consumed: false })
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('ignores another key, another modifier set, and input it must not steal', () => {
    const { shortcuts, send } = bench()
    const toggle = vi.fn()
    installPaletteOpenShortcut(shortcuts, t, toggle)

    expect(send(gesture('KeyJ', ['meta']))).toEqual({ consumed: false })
    expect(send(gesture('KeyK', ['meta', 'shift']))).toEqual({ consumed: false })
    expect(send(gesture('KeyK', []))).toEqual({ consumed: false })
    expect(send(gesture('KeyK', ['meta'], { repeat: true }))).toEqual({ consumed: false })
    expect(send(gesture('KeyK', ['meta'], { composing: true }))).toEqual({ consumed: false })
    expect(send(gesture('KeyK', ['meta'], { defaultPrevented: true }))).toEqual({ consumed: false })
    expect(toggle).not.toHaveBeenCalled()
  })

  it('releases the reserved row and the input subscription with the disposer', () => {
    const { shortcuts, send, command, released } = bench()
    const toggle = vi.fn()
    const dispose = installPaletteOpenShortcut(shortcuts, t, toggle)

    dispose()
    expect(command()).toBeUndefined()
    expect(released()).toBe(true)
    expect(send(gesture('KeyK', ['meta']))).toEqual({ consumed: false })
    expect(toggle).not.toHaveBeenCalled()
  })
})
