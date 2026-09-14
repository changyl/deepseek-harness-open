/**
 * ShortcutRegistry: chord parsing and validation, exact modifier matching,
 * first-match dispatch against the document listener, duplicate-id failure,
 * per-binding disposers, and listener ownership across the plugin fiber.
 */
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { ShortcutRegistry, chordMatches, parseChord } from '../src/client/shortcuts.ts'

/** Build one keydown with the modifier flags a chord matches against. */
function keydown(key: string, over: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, cancelable: true, ...over })
}

/** Boot the registry on a real cordis Context, released with the test. */
async function bench(): Promise<{ ctx: Context; registry: ShortcutRegistry; dispose: () => Promise<void> }> {
  const ctx = new Context()
  const fiber = ctx.plugin(ShortcutRegistry)
  await fiber.await()
  // One document per file: a leaked registry would consume the next test's
  // keydown before its own listener sees the event.
  onTestFinished(() => fiber.dispose())
  return { ctx, registry: ctx.get('shortcuts') as ShortcutRegistry, dispose: () => fiber.dispose() }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('chord specs', () => {
  it('parses modifiers and the trailing key', () => {
    expect(parseChord('mod+shift+p')).toEqual({ key: 'p', mod: true, shift: true, alt: false })
    expect(parseChord('mod+alt+K')).toEqual({ key: 'k', mod: true, shift: false, alt: true })
    expect(parseChord('shift+alt+k')).toEqual({ key: 'k', mod: false, shift: true, alt: true })
    expect(parseChord('k')).toEqual({ key: 'k', mod: false, shift: false, alt: false })
  })

  it('rejects a spec with an unknown modifier', () => {
    expect(() => parseChord('meta+k')).toThrow('unknown modifier "meta"')
  })

  it('rejects a spec that names no key', () => {
    expect(() => parseChord('mod+')).toThrow('names no key')
  })

  it('rejects an empty modifier segment', () => {
    expect(() => parseChord('mod++k')).toThrow('unknown modifier ""')
  })
})

describe('chord matching', () => {
  const chord = parseChord('mod+shift+p')

  it('matches the key and every modifier exactly', () => {
    expect(chordMatches(chord, keydown('P', { metaKey: true, shiftKey: true }))).toBe(true)
    expect(chordMatches(chord, keydown('p', { ctrlKey: true, shiftKey: true }))).toBe(true)
  })

  it('refuses a different key, a missing modifier, and an extra one', () => {
    expect(chordMatches(chord, keydown('k', { metaKey: true, shiftKey: true }))).toBe(false)
    expect(chordMatches(chord, keydown('p', { metaKey: true }))).toBe(false)
    expect(chordMatches(chord, keydown('p', { metaKey: true, shiftKey: true, altKey: true }))).toBe(false)
  })

  it('refuses a bare modifier chord when the modifier is held alone', () => {
    const bare = parseChord('mod+k')
    expect(chordMatches(bare, keydown('k', { ctrlKey: true }))).toBe(true)
    expect(chordMatches(bare, keydown('k'))).toBe(false)
  })
})

describe('ShortcutRegistry', () => {
  it('runs the first matching binding and consumes the event', async () => {
    const { registry } = await bench()
    const first = vi.fn()
    const second = vi.fn()
    registry.register({ id: 'one', keys: 'mod+k', run: first })
    registry.register({ id: 'two', keys: 'mod+k', run: second })

    const event = keydown('k', { metaKey: true })
    expect(registry.handle(event)).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('reports no handler for an unmatched, consumed, or composing keydown', async () => {
    const { registry } = await bench()
    const run = vi.fn()
    registry.register({ id: 'one', keys: 'mod+k', run })

    expect(registry.handle(keydown('j', { metaKey: true }))).toBe(false)
    const consumed = keydown('k', { metaKey: true })
    consumed.preventDefault()
    expect(registry.handle(consumed)).toBe(false)
    // jsdom ignores `isComposing` in the constructor, so state it directly.
    const composing = keydown('k', { metaKey: true })
    Object.defineProperty(composing, 'isComposing', { value: true })
    expect(registry.handle(composing)).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('fails loud on a duplicate id and on a malformed spec', async () => {
    const { registry } = await bench()
    const disposer = registry.register({ id: 'one', keys: 'mod+k', run: () => {} })
    expect(() => registry.register({ id: 'one', keys: 'mod+j', run: () => {} })).toThrow('duplicate binding "one"')
    expect(() => registry.register({ id: 'two', keys: 'hyper+k', run: () => {} })).toThrow('unknown modifier')
    disposer()
    expect(() => registry.register({ id: 'one', keys: 'mod+k', run: () => {} })).not.toThrow()
  })

  it('drops one binding through its disposer', async () => {
    const { registry } = await bench()
    const run = vi.fn()
    const dispose = registry.register({ id: 'one', keys: 'mod+k', run })
    dispose()
    expect(registry.handle(keydown('k', { metaKey: true }))).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('listens on the document and releases the listener with the fiber', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { registry, dispose } = await bench()
    const run = vi.fn()
    registry.register({ id: 'one', keys: 'mod+k', run })

    expect(add).toHaveBeenCalledWith('keydown', expect.any(Function))
    document.dispatchEvent(keydown('k', { ctrlKey: true }))
    expect(run).toHaveBeenCalledTimes(1)

    await dispose()
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
    document.dispatchEvent(keydown('k', { ctrlKey: true }))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('installs no listener where the host has no document', async () => {
    vi.stubGlobal('document', undefined)
    const ctx = new Context()
    const fiber = ctx.plugin(ShortcutRegistry)
    await fiber.await()
    const registry = ctx.get('shortcuts') as ShortcutRegistry
    expect(registry.handle(keydown('k', { metaKey: true }))).toBe(false)
    await fiber.dispose()
  })
})
