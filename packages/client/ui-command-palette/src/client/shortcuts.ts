/**
 * Global keyboard-shortcut registry (`ctx.shortcuts`): one document keydown
 * listener over the registered bindings, first match in registration order
 * wins. Chord specs are parsed and validated at registration, so a malformed
 * spec fails at plugin load rather than at the first keystroke.
 *
 * Bindings match on the modifier set exactly: a `mod+k` binding does not fire
 * for `mod+shift+k`. `mod` accepts the platform command key or Control, which
 * keeps one spec valid on macOS and Windows/Linux. Composition keystrokes and
 * already-consumed events are left alone, so an IME candidate pick or a
 * handler that called `preventDefault()` never reaches a binding.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ShortcutBinding, ShortcutContract } from './contract.ts'

/** Parsed chord: one key plus the modifier set a keydown must match exactly. */
export interface ShortcutChord {
  /** Lowercase `KeyboardEvent.key` value. */
  readonly key: string
  /** Whether the platform command key or Control must be held. */
  readonly mod: boolean
  /** Whether Shift must be held. */
  readonly shift: boolean
  /** Whether Alt must be held. */
  readonly alt: boolean
}

const MODIFIERS = ['mod', 'shift', 'alt'] as const

/**
 * Parse one chord spec into its key and modifier set.
 * @param spec - `+`-joined modifiers followed by one key, e.g. `mod+shift+p`.
 * @returns the parsed chord.
 */
export function parseChord(spec: string): ShortcutChord {
  const normalized = spec.toLowerCase()
  const separator = normalized.lastIndexOf('+')
  const key = normalized.slice(separator + 1)
  if (key === '') throw new Error(`shortcuts: chord "${spec}" names no key`)
  const modifiers = separator === -1 ? [] : normalized.slice(0, separator).split('+')
  const chord = { key, mod: false, shift: false, alt: false }
  for (const part of modifiers) {
    if (!(MODIFIERS as readonly string[]).includes(part)) {
      throw new Error(`shortcuts: chord "${spec}" has unknown modifier "${part}"`)
    }
    if (part === 'mod') chord.mod = true
    if (part === 'shift') chord.shift = true
    if (part === 'alt') chord.alt = true
  }
  return chord
}

/**
 * Whether one keydown matches a parsed chord exactly.
 * @param chord - parsed chord spec.
 * @param event - the keydown to test.
 * @returns true when every modifier and the key match.
 */
export function chordMatches(chord: ShortcutChord, event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === chord.key
    && (event.metaKey || event.ctrlKey) === chord.mod
    && event.shiftKey === chord.shift
    && event.altKey === chord.alt
}

/** One registered binding with its parsed chord. */
interface BindingRecord {
  readonly binding: ShortcutBinding
  readonly chord: ShortcutChord
}

/**
 * Global keyboard-shortcut registry. The document listener is installed with
 * the service and removed with its fiber; the registry owns no global
 * shortcuts of its own, so an installation with no registrations is inert.
 */
export class ShortcutRegistry extends Service implements ShortcutContract {
  private readonly bindings = new Map<string, BindingRecord>()

  /**
   * @param ctx - owning root context (the service registers itself as
   * `shortcuts` and follows that fiber's lifetime).
   */
  constructor(ctx: Context) {
    super(ctx, 'shortcuts')
    ctx.effect(() => this.listen(), 'command-palette: shortcut keydown')
  }

  /**
   * Install the document keydown listener.
   * @returns the disposer removing it.
   */
  private listen(): () => void {
    // Node boots (unit tests, SSR-shaped hosts) have no document; the
    // registry then never fires, which is the whole of its behavior there.
    if (typeof document === 'undefined') return () => {}
    const onKeyDown = (event: KeyboardEvent): void => { this.handle(event) }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }

  /**
   * Register one global binding; effect disposer (rides the caller's fiber).
   * @param binding - chord spec and the behavior it runs.
   * @returns the disposer removing the registration.
   */
  register(binding: ShortcutBinding): () => void {
    const chord = parseChord(binding.keys)
    const dispose = this.ctx.effect(() => {
      if (this.bindings.has(binding.id)) {
        throw new Error(`shortcuts: duplicate binding "${binding.id}"`)
      }
      this.bindings.set(binding.id, { binding, chord })
      return () => { this.bindings.delete(binding.id) }
    }, 'shortcuts.register()')
    return () => { void dispose() }
  }

  /**
   * Dispatch one keydown to the first matching binding.
   * @param event - the keydown to test.
   * @returns whether a binding consumed the event.
   */
  handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing) return false
    for (const record of [...this.bindings.values()]) {
      if (!chordMatches(record.chord, event)) continue
      event.preventDefault()
      record.binding.run()
      return true
    }
    return false
  }
}
