// @vitest-environment jsdom
/**
 * The editing surface's own behaviour: what it draws behind the reader's text,
 * when that layer may appear at all, and what it does with the surface's scroll
 * offsets. The draft, the store, and the save path belong to the body and are
 * asserted in text-edit.client.spec.tsx.
 *
 * jsdom lays nothing out, so the specs assert the offsets the elements hold:
 * `scrollTop`/`scrollLeft` keep what they are set to, which is the arithmetic
 * both surfaces share.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { TextEditor } from '../src/client/TextEditor.tsx'
import type { TextEditorProps } from '../src/client/TextEditor.tsx'

/** The editor's own pause before it tokenizes a draft. */
const PAUSE_MS = 120

/** The editor's line budget, mirrored here as the boundary the specs probe. */
const LINE_BUDGET = 2000

/** Draft lines the editor tokenizes per turn of the event loop, mirrored to size a multi-pass draft. */
const CHUNK_LINES = 40

const DRAFT = 'const a = 1\nconst b = 2'

const EDITOR = '[data-textpreview-editor]'
const LAYER = '[data-textpreview-highlight]'

function need(container: HTMLElement, selector: string): Element {
  const element = container.querySelector(selector)
  if (element === null) throw new Error(`expected ${selector}`)
  return element
}

/** Find one required element that must be an HTMLElement, so a spec can read its offsets. */
function needHtml(container: HTMLElement, selector: string): HTMLElement {
  const element = need(container, selector)
  if (!(element instanceof HTMLElement)) throw new Error(`expected ${selector} to be an element`)
  return element
}

/** A draft of `lines` source lines, all different, so a spec can tell them apart. */
function draftOf(lines: number): string {
  return Array.from({ length: lines }, (_value, index) => `const value${index} = ${index}`).join('\n')
}

/** Let the editor's pause elapse, then every turn of the pass it starts. */
function pause(): void {
  act(() => {
    vi.advanceTimersByTime(PAUSE_MS)
    vi.runAllTimers()
  })
}

interface Drawn {
  readonly view: ReturnType<typeof render>
  readonly props: TextEditorProps
  /** The editing surface itself. */
  readonly area: HTMLTextAreaElement
  readonly onChange: ReturnType<typeof vi.fn>
  readonly scrollRef: ReturnType<typeof vi.fn>
  readonly onScroll: ReturnType<typeof vi.fn>
}

/** Draw one editor over `overrides`, with every input the body supplies. */
function editor(overrides: Partial<TextEditorProps> = {}): Drawn {
  const onChange = vi.fn()
  const scrollRef = vi.fn()
  const onScroll = vi.fn()
  const props: TextEditorProps = {
    value: DRAFT, onChange, wrap: true, label: 'editor', lang: 'typescript', scrollRef, onScroll, ...overrides,
  }
  const view = render(<TextEditor {...props} />)
  const area = need(view.container, 'textarea')
  if (!(area instanceof HTMLTextAreaElement)) throw new Error('expected the editing surface to be a textarea')
  return { view, props, area, onChange, scrollRef, onScroll }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('TextEditor — the grammar layer', () => {
  it('leaves the draft plain until the reader pauses, then draws it in the file grammar', () => {
    const { view, scrollRef } = editor()
    expect(scrollRef).toHaveBeenCalledWith(expect.any(HTMLTextAreaElement))
    expect(view.container.querySelector(LAYER)).toBeNull()
    pause()
    const layer = needHtml(view.container, LAYER)
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.textContent).toBe(DRAFT)
    // The grammar's own runs, not the plain text one node would give.
    expect(layer.querySelectorAll('span[style]').length).toBeGreaterThan(0)
  })

  it('takes the layer away while the draft changes and redraws it on the next pause', () => {
    const { view, props } = editor()
    pause()
    expect(view.container.querySelector(LAYER)).not.toBeNull()
    const changed = `${DRAFT}\nconst c = 3`
    view.rerender(<TextEditor {...props} value={changed} />)
    // The layer is stale the moment it describes text the reader has left.
    expect(view.container.querySelector(LAYER)).toBeNull()
    pause()
    expect(needHtml(view.container, LAYER).textContent).toBe(changed)
  })

  it('colours a draft longer than one turn, one bounded pass at a time', () => {
    const draft = draftOf(CHUNK_LINES * 8)
    const { view } = editor({ value: draft })
    pause()
    const layer = needHtml(view.container, LAYER)
    // Every line of the draft is drawn, and the grammar's runs, not plain text.
    expect(layer.textContent).toBe(draft)
    expect(layer.querySelectorAll('span[style]').length).toBeGreaterThan(CHUNK_LINES)
  })

  it('draws a draft inside the line budget and leaves a longer one plain', () => {
    const boundary = editor({ value: draftOf(CHUNK_LINES * 2) })
    pause()
    expect(boundary.view.container.querySelector(LAYER)).not.toBeNull()
    cleanup()
    // One line past the budget: colouring it would cost more than a sidebar
    // draft is worth, so the surface stays plain and editable.
    const over = editor({ value: draftOf(LINE_BUDGET + 1) })
    pause()
    expect(over.view.container.querySelector(LAYER)).toBeNull()
  })

  it('leaves a draft whose language the highlighter does not know plain', () => {
    const { view } = editor({ lang: undefined })
    pause()
    expect(view.container.querySelector(LAYER)).toBeNull()
  })

  it('follows the wrap preference on the surface, and on the layer drawn under it', () => {
    const wrapped = editor()
    expect(wrapped.area.getAttribute('wrap')).toBe('soft')
    pause()
    expect(need(wrapped.view.container, EDITOR).hasAttribute('data-textpreview-wrap')).toBe(true)
    cleanup()
    const unwrapped = editor({ wrap: false })
    expect(unwrapped.area.getAttribute('wrap')).toBe('off')
    pause()
    expect(need(unwrapped.view.container, EDITOR).hasAttribute('data-textpreview-wrap')).toBe(false)
  })
})

describe('TextEditor — the surface and its layer', () => {
  it('keeps the layer on the same offsets as the surface and reports every scroll', () => {
    const { view, area, onScroll } = editor()
    // Nothing to move yet, so the scroll is the owner's to act on.
    area.scrollTop = 12
    fireEvent.scroll(area)
    expect(onScroll).toHaveBeenLastCalledWith(area)
    pause()
    const layer = needHtml(view.container, LAYER)
    area.scrollTop = 42
    area.scrollLeft = 7
    fireEvent.scroll(area)
    expect(layer.scrollTop).toBe(42)
    expect(layer.scrollLeft).toBe(7)
    expect(onScroll).toHaveBeenCalledTimes(2)
  })

  it('opens a layer drawn after the reader already scrolled at the surface offsets', () => {
    const { view, area } = editor()
    area.scrollTop = 33
    fireEvent.scroll(area)
    pause()
    expect(needHtml(view.container, LAYER).scrollTop).toBe(33)
  })

  it('hands the surface to the owner on mount and gives it back on unmount', () => {
    const { view, area, scrollRef } = editor()
    expect(scrollRef).toHaveBeenLastCalledWith(area)
    view.unmount()
    expect(scrollRef).toHaveBeenLastCalledWith(null)
  })

  it('reports the reader keystrokes and puts the caret in the surface', () => {
    const { area, onChange } = editor()
    expect(document.activeElement).toBe(area)
    fireEvent.change(area, { target: { value: 'next' } })
    expect(onChange).toHaveBeenCalledExactlyOnceWith('next')
  })
})
