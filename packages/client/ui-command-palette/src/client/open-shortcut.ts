/**
 * The palette's two open chords on the shared shortcuts service. They are
 * fixed actions rather than editable bindings: the palette owns its keys, the
 * shortcuts reference lists them under Application, and the keys are reserved
 * against every editable command.
 *
 * A chord matches exactly, so `mod+k` does not fire for `mod+shift+k`; `mod`
 * accepts the platform command key or Control, which keeps one declaration
 * valid on macOS and Windows/Linux. Composing input, input another handler
 * already consumed, and auto-repeat are left alone.
 */
import type { ShortcutBinding, ShortcutCommandId, ShortcutGesture, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { CommandPaletteTranslate } from './locales.ts'

/** Physical combination that toggles the palette (primary+K). */
const OPEN_KEY: ShortcutBinding = { code: 'KeyK', modifiers: ['primary'] }

/** Second physical combination for the same toggle (primary+Shift+P). */
const OPEN_ALT_KEY: ShortcutBinding = { code: 'KeyP', modifiers: ['primary', 'shift'] }

/** The shortcuts face these chords read and contribute through. */
export type PaletteShortcutFace =
  Pick<Shortcuts, 'platform' | 'describeBinding' | 'registerFixed' | 'observeFixedInput'>

/** Modifier flags a chord compares against, in the registry's own order. */
const HELD = ['control', 'alt', 'shift', 'meta'] as const

/** One held modifier of {@link HELD}. */
type HeldModifier = (typeof HELD)[number]

/** One toggle chord: the physical combination and its visible keycaps. */
interface Chord {
  readonly code: string
  /** Modifier set the gesture must hold exactly. */
  readonly modifiers: readonly HeldModifier[]
  /** Visible keycaps, for the shortcuts reference row. */
  readonly keys: string
}

/**
 * Resolve the two chords for the receiving platform.
 * @param shortcuts - the window's shortcuts service (platform and keycap rules).
 * @returns the chords in display order.
 */
function chordsFor(shortcuts: PaletteShortcutFace): readonly Chord[] {
  const primary: HeldModifier = shortcuts.platform === 'macos' ? 'meta' : 'control'
  return [
    { code: OPEN_KEY.code, modifiers: [primary], keys: shortcuts.describeBinding(OPEN_KEY).keys.join('') },
    { code: OPEN_ALT_KEY.code, modifiers: [primary, 'shift'], keys: shortcuts.describeBinding(OPEN_ALT_KEY).keys.join('') },
  ]
}

/**
 * Whether one gesture holds exactly the chord's keys and modifiers.
 * @param chord - resolved toggle chord.
 * @param gesture - normalized DOM input facts.
 * @returns true when the combination matches.
 */
function chordMatches(chord: Chord, gesture: ShortcutGesture): boolean {
  const held = HELD.filter(value => gesture[value])
  return gesture.code === chord.code && held.length === chord.modifiers.length
    && chord.modifiers.every(value => held.includes(value))
}

/**
 * Reserve the palette's open chords and toggle the palette from their input.
 * @param shortcuts - the window's shortcuts service.
 * @param t - palette-namespace copy (the reference row's label).
 * @param toggle - open the palette, or close it when it is already open.
 * @returns the disposer releasing the reference row and the input subscription.
 */
export function installPaletteOpenShortcut(
  shortcuts: PaletteShortcutFace,
  t: CommandPaletteTranslate,
  toggle: () => void,
): () => void {
  const chords = chordsFor(shortcuts)
  const offReference = shortcuts.registerFixed({
    id: 'commandPalette.open' as ShortcutCommandId,
    label: () => t('palette.shortcut.open'),
    keys: chords.map(chord => chord.keys),
    bindings: [OPEN_KEY, OPEN_ALT_KEY],
    group: 'application',
  })
  const offInput = shortcuts.observeFixedInput((input) => {
    if (input.type === 'reset') return
    const { gesture } = input
    if (gesture.repeat || gesture.composing || gesture.defaultPrevented) return
    if (!chords.some(chord => chordMatches(chord, gesture))) return
    input.consume()
    toggle()
  })
  return () => {
    offInput()
    offReference()
  }
}
