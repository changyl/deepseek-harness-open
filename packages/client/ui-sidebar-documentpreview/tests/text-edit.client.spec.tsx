// @vitest-environment jsdom
/**
 * The editing session as the reader meets it: where the control is, what the
 * draft is seeded from, what makes the tab dirty, what a save carries, and what
 * the conflict bar offers when the Host refuses one.
 *
 * The store and the face are real here, so every assertion is about the wiring
 * between them and the body rather than about a stubbed reaction. jsdom applies
 * no stylesheet, so the narrow and fullscreen layouts are asserted through the
 * attributes the stylesheet reads, not through computed geometry.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { TextPreview } from '../src/client/TextPreview.tsx'
import { ADDRESS, FILE, PATH, harness, page, settle, wholeFailure, wholeText, writeRefused, written } from './fixtures.client.ts'

afterEach(() => { cleanup() })

const EDIT = '[data-textpreview-tool="edit"]'
const PREVIEW = '[data-textpreview-tool="preview"]'
const SAVE = '[data-textpreview-tool="save"]'
const DISCARD = '[data-textpreview-tool="discard"]'
const EDITOR = '[data-textpreview-editor]'
const DIRTY = '[data-textpreview-dirty]'

/** Find one required element, or fail the spec with the selector that was missing. */
function need(container: HTMLElement, selector: string): Element {
  const element = container.querySelector(selector)
  if (element === null) throw new Error(`expected ${selector}`)
  return element
}

/** Find one required control, so a spec can read whether it is disabled. */
function needButton(container: HTMLElement, selector: string): HTMLButtonElement {
  const element = need(container, selector)
  if (!(element instanceof HTMLButtonElement)) throw new Error(`expected ${selector} to be a button`)
  return element
}

/** Find the editor's surface, the one element a draft is read from. */
function needArea(container: HTMLElement, selector: string): HTMLTextAreaElement {
  const element = need(container, selector)
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`expected ${selector} to be a textarea`)
  return element
}

/** Open the editor over a file whose whole text is `text`, and return the textarea. */
async function editing(text: string, pane: { fullscreen?: boolean } = {}): Promise<{
  view: ReturnType<typeof render>
  h: ReturnType<typeof harness>
  area: HTMLTextAreaElement
}> {
  const h = harness({ 1: page(1, text.split('\n').filter(Boolean), true) })
  h.bytes.mockResolvedValue(wholeText(text, 'v1'))
  const view = render(<TextPreview {...h.props({ revision: 1 }, pane)} />)
  await settle()
  fireEvent.click(need(view.container, EDIT))
  await settle()
  return { view, h, area: needArea(view.container, `${EDITOR} textarea`) }
}

describe('TextPreview — entering the editor', () => {
  it('seeds the draft from the whole file, keeping the newline the pages dropped', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    // The paged view is lossy; the draft must not be built from it.
    h.bytes.mockResolvedValue(wholeText('one\n', 'v1'))
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector(EDITOR)).toBeNull()
    expect(needButton(view.container, EDIT).textContent).toBe('edit.start')
    fireEvent.click(need(view.container, EDIT))
    expect(view.container.querySelector('[data-textpreview-state="draft-loading"]')).not.toBeNull()
    await settle()
    expect(needArea(view.container, `${EDITOR} textarea`).value).toBe('one\n')
    expect(h.bytes).toHaveBeenCalledExactlyOnceWith(FILE, h.controller.signal)
    // The paged reader is untouched by the draft's whole-file read.
    expect(h.read).toHaveBeenCalledTimes(1)
  })

  it('offers no editing while a Turn change is on screen', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, [{ path: PATH, oldText: 'before', newText: 'after' }])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-change]')).not.toBeNull()
    expect(view.container.querySelector(EDIT)).toBeNull()
  })

  it('reports a draft the Host refused and puts the preview back', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.bytes.mockResolvedValue(wholeFailure('workspace-file/too-large', { path: PATH, limit: 10 }))
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    fireEvent.click(need(view.container, EDIT))
    await settle()
    expect(view.container.querySelector(EDITOR)).toBeNull()
    expect(need(view.container, '[data-textpreview-failed]').textContent).toContain('error.tooLarge')
  })
})

describe('TextPreview — the draft and the save', () => {
  it('marks the tab dirty on the first keystroke and clears it when the write is accepted', async () => {
    const { view, h, area } = await editing('one\n')
    expect(view.container.querySelector(DIRTY)).toBeNull()
    expect(needButton(view.container, SAVE).disabled).toBe(true)
    fireEvent.change(area, { target: { value: 'two\n' } })
    expect(need(view.container, DIRTY).textContent).toBe('edit.dirty')
    expect(needButton(view.container, SAVE).disabled).toBe(false)
    h.write.mockResolvedValue(written('two\n', 'v2'))
    fireEvent.click(need(view.container, SAVE))
    await settle()
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'two\n', 'v1', h.controller.signal)
    expect(view.container.querySelector(DIRTY)).toBeNull()
    expect(needButton(view.container, SAVE).disabled).toBe(true)
    // The pages behind the editor describe the file as it was, so they are re-read.
    expect(h.read).toHaveBeenLastCalledWith(FILE.sessionId, FILE.path, 1, h.controller.signal)
  })

  it('keeps the editor open across a save and lets the reader carry on', async () => {
    const { view, h, area } = await editing('one\n')
    h.write.mockResolvedValue(written('two\n', 'v2'))
    fireEvent.change(area, { target: { value: 'two\n' } })
    fireEvent.click(need(view.container, SAVE))
    await settle()
    expect(view.container.querySelector(EDITOR)).not.toBeNull()
    expect(needArea(view.container, `${EDITOR} textarea`).value).toBe('two\n')
    fireEvent.change(area, { target: { value: 'three\n' } })
    expect(need(view.container, DIRTY)).not.toBeNull()
  })

  it('discards the draft without writing anything', async () => {
    const { view, h, area } = await editing('one\n')
    fireEvent.change(area, { target: { value: 'two\n' } })
    fireEvent.click(need(view.container, DISCARD))
    expect(view.container.querySelector(EDITOR)).toBeNull()
    expect(view.container.querySelector(DIRTY)).toBeNull()
    expect(h.write).not.toHaveBeenCalled()
    expect(need(view.container, EDIT)).not.toBeNull()
  })

  it('reports a save the Host refused for a reason with no decision attached', async () => {
    const { view, h, area } = await editing('one\n')
    h.write.mockResolvedValue(writeRefused('workspace-file/read-only', { path: PATH, mode: 'read-only' }))
    fireEvent.change(area, { target: { value: 'two\n' } })
    fireEvent.click(need(view.container, SAVE))
    await settle()
    const bar = need(view.container, '[data-textpreview-save-failed="workspace-file/read-only"]')
    expect(bar.textContent).toContain('error.readOnly')
    // Nothing to choose between: the refusal is the whole story.
    expect(view.container.querySelector('[data-textpreview-overwrite]')).toBeNull()
    expect(need(view.container, DIRTY)).not.toBeNull()
  })
})

describe('TextPreview — resolving a conflict', () => {
  const stale = () => writeRefused('workspace-file/stale-version', { path: PATH, expectedVersion: 'v1' })

  it('offers the two ways out and overwrites without a guard when that is the choice', async () => {
    const { view, h, area } = await editing('one\n')
    h.write.mockResolvedValueOnce(stale())
    fireEvent.change(area, { target: { value: 'mine\n' } })
    fireEvent.click(need(view.container, SAVE))
    await settle()
    expect(need(view.container, '[data-textpreview-save-failed="workspace-file/stale-version"]').textContent)
      .toContain('error.staleVersion')
    h.write.mockResolvedValueOnce(written('mine\n', 'v3'))
    fireEvent.click(need(view.container, '[data-textpreview-overwrite]'))
    await settle()
    expect(h.write).toHaveBeenLastCalledWith(FILE, 'mine\n', undefined, h.controller.signal)
    expect(view.container.querySelector(DIRTY)).toBeNull()
  })

  it('re-reads the file whole when the reader gives way instead', async () => {
    const { view, h, area } = await editing('one\n')
    h.write.mockResolvedValueOnce(stale())
    fireEvent.change(area, { target: { value: 'mine\n' } })
    fireEvent.click(need(view.container, SAVE))
    await settle()
    h.bytes.mockResolvedValueOnce(wholeText('theirs\n', 'v9'))
    fireEvent.click(need(view.container, '[data-textpreview-reopen]'))
    await settle()
    expect(needArea(view.container, `${EDITOR} textarea`).value).toBe('theirs\n')
    expect(view.container.querySelector(DIRTY)).toBeNull()
    expect(view.container.querySelector('[data-textpreview-save-failed]')).toBeNull()
  })
})

describe('TextPreview — the pane the editor draws in', () => {
  it('replaces the preview while narrow, and guards the way back on an unsaved draft', async () => {
    const { view, area } = await editing('one\n')
    expect(need(view.container, '[data-textpreview-edit]').hasAttribute('data-textpreview-split')).toBe(false)
    const back = needButton(view.container, PREVIEW)
    expect(back.disabled).toBe(false)
    fireEvent.change(area, { target: { value: 'two\n' } })
    // Leaving would throw the draft away, so the control that does it waits.
    expect(needButton(view.container, PREVIEW).disabled).toBe(true)
  })

  it('shows the editor and the preview together once the pane is fullscreen', async () => {
    const { view } = await editing('one\n', { fullscreen: true })
    expect(need(view.container, '[data-textpreview-edit]').hasAttribute('data-textpreview-split')).toBe(true)
    // Both halves are mounted: the preview is beside the editor, not behind it.
    expect(view.container.querySelector(EDITOR)).not.toBeNull()
    expect(view.container.querySelector('[data-textpreview-body]')).not.toBeNull()
    // There is nothing to switch to, so the control that switches is gone.
    expect(view.container.querySelector(PREVIEW)).toBeNull()
  })

  it('keeps the preview mounted while narrow editing, so its place survives', async () => {
    const { view } = await editing('one\n')
    const body = need(view.container, '[data-textpreview-body]')
    fireEvent.scroll(body)
    // Hidden by the stylesheet rather than unmounted; jsdom has no stylesheet,
    // so the assertion is that the element the scroller lives on is still here.
    expect(view.container.querySelector('[data-textpreview-body]')).toBe(body)
  })
})

describe('TextPreview — leaving the editor', () => {
  it('returns to the preview from the header when the draft is clean', async () => {
    const { view } = await editing('one\n')
    fireEvent.click(need(view.container, PREVIEW))
    expect(view.container.querySelector(EDITOR)).toBeNull()
    expect(need(view.container, EDIT)).not.toBeNull()
    // The file it returns to is the one it left, not a blank surface.
    expect(view.container.querySelectorAll('[data-textpreview-line]').length).toBeGreaterThan(0)
  })
})
