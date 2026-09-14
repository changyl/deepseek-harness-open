/**
 * Frozen contract of the global keyboard-shortcut registry. Types only. The
 * ShortcutRegistry (`ctx.shortcuts`) implements this face; feature packages
 * consume `register` alone.
 */

/** One global keyboard binding contributed by a client plugin. */
export interface ShortcutBinding {
  /** Stable identity, unique across registrations; a duplicate throws. */
  readonly id: string
  /**
   * Chord spec: `+`-joined modifiers followed by one key, lowercase, e.g.
   * `mod+k` or `mod+shift+p`. `mod` accepts either the platform command key
   * or Control, so one binding serves macOS and Windows/Linux.
   */
  readonly keys: string
  /** Run when this chord matches an unconsumed keydown. */
  run(): void
}

/** The `ctx.shortcuts` service face visible to business packages. */
export interface ShortcutContract {
  /**
   * Register one global binding; effect disposer. A duplicate id throws.
   * @param binding - chord spec and the behavior it runs.
   * @returns the disposer removing the registration.
   */
  register(binding: ShortcutBinding): () => void
}
