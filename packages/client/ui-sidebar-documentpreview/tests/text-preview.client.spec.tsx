// @vitest-environment jsdom
/**
 * What the body draws from its pages and the file's metadata, and what it does
 * with a navigation: load until the asked line is held, jump to it once, then
 * keep the reader's place.
 *
 * jsdom lays nothing out, so three geometry facts are supplied here: a line's
 * offset is its number times one line height, a comparison band's offset is its
 * band index times one line height, and `scrollTop` holds what it is set to.
 * All three are the browser's job; the specs assert the body's arithmetic over
 * them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import { TextPreview } from '../src/client/TextPreview.tsx'
import type { TextPreviewProps } from '../src/client/TextPreview.tsx'
import { CodeBody } from '../src/client/code/CodeBody.tsx'
import type { DocumentPreviewDefinition } from '../src/client/document/registry.ts'
import { TextBody } from '../src/client/text/TextBody.tsx'
import { PLAIN_BODY_ID } from '../src/client/text/index.ts'
import { ABSOLUTE_PATH, ADDRESS, PATH, SESSION, TAB_ID, failure, harness, page, settle } from './fixtures.client.ts'

const LINE_HEIGHT = 20

const originals = {
  offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'),
  getBoundingClientRect: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect'),
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const line = this.getAttribute('data-textpreview-line')
      if (line !== null) return (Number(line) - 1) * LINE_HEIGHT
      if (!this.matches('[data-code-preview] pre .line')) return 0
      const rows = this.closest('[data-code-preview]')?.querySelectorAll('pre .line') ?? []
      return Array.from(rows).indexOf(this) * LINE_HEIGHT
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement): DOMRect {
      // Only the comparison's landing anchor is positioned; everything else sits
      // at the scroller's origin, as it does in jsdom already.
      const band = this.hasAttribute('data-split-change-start') ? this.closest('[data-split-row]') : null
      const bands = band === null ? [] : Array.from(this.closest('[data-diff]')?.querySelectorAll('[data-split-row]') ?? [])
      const anchor = this.hasAttribute('data-diff-hunk') ? this : null
      const anchors = anchor === null ? [] : Array.from(this.closest('[data-diff]')?.querySelectorAll('[data-diff-hunk]') ?? [])
      const top = anchor !== null
        ? anchors.indexOf(anchor) * LINE_HEIGHT
        : band === null ? 0 : bands.indexOf(band) * LINE_HEIGHT
      return { top, bottom: top, height: 0, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement & { __scrollTop?: number }) { return this.__scrollTop ?? 0 },
    set(this: HTMLElement & { __scrollTop?: number }, value: number) { this.__scrollTop = value },
  })
})

afterAll(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, name)
    else Object.defineProperty(HTMLElement.prototype, name, descriptor)
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

class PendingIntersectionObserver {
  static instances: PendingIntersectionObserver[] = []
  readonly observed = new Set<Element>()

  constructor(private readonly callback: IntersectionObserverCallback) {
    PendingIntersectionObserver.instances.push(this)
  }

  observe(element: Element): void { this.observed.add(element) }
  unobserve(element: Element): void { this.observed.delete(element) }
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return [] }

  intersect(element: Element): void {
    this.callback(
      [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

function codeProps(h: ReturnType<typeof harness>, navigation: { params?: unknown; revision: number }): TextPreviewProps {
  const props = h.props(navigation)
  const definition: DocumentPreviewDefinition = {
    id: 'code', extensions: ['md'], title: () => 'Code', loading: 'text-pages', wrap: true,
  }
  return {
    ...props,
    useDocumentPreviews: selector => selector([definition]),
    renderSlot: (_key, owner) => <CodeBody {...props} {...owner as unknown as OwnerOf<'sidebar.right.tab.document'>} t={key => key} />,
  }
}

function body(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-textpreview-body]')
  if (element === null) throw new Error('expected the file body')
  return element
}

function scrollport(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-code-block-content]') ?? body(container)
}

function lines(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-textpreview-line]'), row => row.textContent ?? '')
}

function target(container: HTMLElement): string | null {
  return container.querySelector('[data-textpreview-target]')?.getAttribute('data-textpreview-target') ?? null
}

function click(container: HTMLElement, selector: string): void {
  const button = container.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`expected ${selector}`)
  fireEvent.click(button)
}

describe('TextPreview — pages', () => {
  it.each([ABSOLUTE_PATH, 'C:\\work\\project\\notes.md', '\\\\host\\share\\notes.md'])(
    'shows the Host path %s in the header and tooltip even when text cannot be read',
    async (absolutePath) => {
      const h = harness({ 1: failure('workspace-file/not-text', { path: PATH }) })
      h.useResource.mockReturnValue({
        status: 'live', value: { absolutePath, version: 'v1', bytes: 100 }, failure: undefined,
      })
      const view = render(<TextPreview {...h.props()} />)
      await settle()
      const path = view.container.querySelector('[data-textpreview-path]')
      expect(path?.textContent).toBe(absolutePath)
      expect(path?.getAttribute('title')).toBe(absolutePath)
      expect(h.read).toHaveBeenCalledWith(SESSION, PATH, 1, h.controller.signal)
    },
  )

  it('shows the requested path until Host metadata supplies its absolute path', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    const metadata = h.useResource()
    h.useResource.mockReturnValue({ status: 'loading', value: undefined, failure: undefined })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-path]')?.textContent).toBe(PATH)
    h.useResource.mockReturnValue(metadata)
    view.rerender(<TextPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-path]')?.textContent).toBe(ABSOLUTE_PATH)
    expect(view.container.querySelector('[data-textpreview-path]')?.getAttribute('title')).toBe(ABSOLUTE_PATH)
  })

  it('marks the path clipped while its text is wider than its box, re-reading on resize', async () => {
    class FakeResizeObserver implements ResizeObserver {
      static latest: FakeResizeObserver | undefined
      readonly observe = vi.fn()
      readonly unobserve = vi.fn()
      readonly disconnect = vi.fn()
      constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.latest = this
      }

      fire(): void {
        this.callback([], this)
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    let boxWidth = 300
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => boxWidth })
    try {
      const h = harness({ 1: page(1, ['one'], true) })
      const view = render(<TextPreview {...h.props()} />)
      await settle()
      const path = view.container.querySelector<HTMLElement>('[data-textpreview-path]')
      const text = path?.firstElementChild
      expect(path?.hasAttribute('data-textpreview-path-clipped')).toBe(false)
      const observer = FakeResizeObserver.latest
      if (observer === undefined) throw new Error('expected the path to observe its size')
      expect(observer.observe).toHaveBeenCalledWith(path)
      expect(observer.observe).toHaveBeenCalledWith(text)

      boxWidth = 120
      act(() => { observer.fire() })
      expect(path?.hasAttribute('data-textpreview-path-clipped')).toBe(true)

      boxWidth = 300
      act(() => { observer.fire() })
      expect(path?.hasAttribute('data-textpreview-path-clipped')).toBe(false)
      view.unmount()
      expect(observer.disconnect).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
      for (const [name, descriptor] of [['offsetWidth', offsetWidth], ['clientWidth', clientWidth]] as const) {
        if (descriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, name)
        else Object.defineProperty(HTMLElement.prototype, name, descriptor)
      }
    }
  })

  it('reads the first page on first mount and draws its lines, offering the next', async () => {
    const h = harness({ 1: page(1, ['one', 'two', 'three'], false) })
    const view = render(<TextPreview {...h.props()} />)
    // The first read has no document body or next-page control to displace its status.
    expect(view.container.querySelector('[data-textpreview-more]')).toBeNull()
    expect(view.getByRole('status').hasAttribute('data-document-loading')).toBe(true)
    expect(body(view.container).firstElementChild).toBe(view.getByRole('status'))
    expect(lines(view.container)).toEqual([])
    await settle()
    expect(view.queryByRole('status')).toBeNull()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.read).toHaveBeenCalledWith(SESSION, PATH, 1, h.controller.signal)
    expect(lines(view.container)).toEqual(['one\n', 'two\n', 'three\n'])
    expect(view.container.querySelector('[data-textpreview-url]')?.getAttribute('data-textpreview-url')).toBe(ADDRESS)
    expect(view.container.textContent).toContain(PATH)
    expect(view.container.querySelector('[data-textpreview-more]')).not.toBeNull()
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
  })

  it('reads nothing on a remount while the store holds the pages', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    const first = render(<TextPreview {...h.props()} />)
    await settle()
    first.unmount()
    const second = render(<TextPreview {...h.props()} />)
    await settle()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(lines(second.container)).toEqual(['one\n'])
  })

  it('loads the next page where the loaded text ends, until the file ends', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], false), 4: page(4, ['d', 'e'], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    click(view.container, '[data-textpreview-more]')
    await settle()
    expect(h.read).toHaveBeenLastCalledWith(SESSION, PATH, 4, h.controller.signal)
    expect(lines(view.container)).toEqual(['a\n', 'b\n', 'c\n', 'd\n', 'e\n'])
    expect(view.container.querySelectorAll('[data-textpreview-page]').length).toBe(2)
    expect(view.container.querySelector('[data-textpreview-more]')).toBeNull()
  })

  it('keeps loaded lines visible while the next page shows the shared loading indicator', async () => {
    const h = harness({ 1: page(1, ['held'], false) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    const next = Promise.withResolvers<Awaited<ReturnType<typeof h.read>>>()
    h.read.mockReturnValueOnce(next.promise)
    click(view.container, '[data-textpreview-more]')
    expect(view.getByRole('status').textContent).toBe('loading')
    expect(lines(view.container)).toEqual(['held\n'])
    await act(async () => { next.resolve(page(2, ['tail'], true)); await next.promise })
    expect(view.queryByRole('status')).toBeNull()
    expect(lines(view.container)).toEqual(['held\n', 'tail\n'])
  })

  it('says why a page failed and retries the same page', async () => {
    const h = harness({ 1: failure('workspace-file/not-text', { path: PATH }) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    const failed = view.container.querySelector('[data-textpreview-failed]')
    expect(failed?.getAttribute('data-textpreview-failed')).toBe('workspace-file/not-text')
    expect(view.container.textContent).toContain('error.notText')
    // Nothing read yet: the failure stands as the body, under the file's type sheet.
    expect(failed?.querySelector('svg')).not.toBeNull()
    expect(view.container.querySelector('[data-textpreview-more]')).toBeNull()
    h.script(1, page(1, ['one'], true))
    click(view.container, '[data-textpreview-retry]')
    await settle()
    expect(h.read).toHaveBeenLastCalledWith(SESSION, PATH, 1, h.controller.signal)
    expect(lines(view.container)).toEqual(['one\n'])
    expect(view.container.querySelector('[data-textpreview-failed]')).toBeNull()
  })

  it('says why a later page failed on a line under the pages already read', async () => {
    const h = harness({ 1: page(1, ['a'], false), 2: failure('workspace-file/too-large', { path: PATH, limit: 1024 }) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    click(view.container, '[data-textpreview-more]')
    await settle()
    const failed = view.container.querySelector('[data-textpreview-failed]')
    expect(failed?.getAttribute('data-textpreview-failed')).toBe('workspace-file/too-large')
    expect(failed?.querySelector('svg')).toBeNull()
    expect(lines(view.container)).toEqual(['a\n'])
    h.script(2, page(2, ['b'], true))
    click(view.container, '[data-textpreview-retry]')
    await settle()
    expect(lines(view.container)).toEqual(['a\n', 'b\n'])
    expect(view.container.querySelector('[data-textpreview-failed]')).toBeNull()
  })

  it('announces a change and, on request, re-reads the pages keeping the reader\'s place', async () => {
    const h = harness({ 1: page(1, ['a', 'b'], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    fireEvent.scroll(body(view.container), { target: { scrollTop: 50 } })
    h.setVersion('v2')
    view.rerender(<TextPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-changed]')?.textContent).toContain('changed')
    expect(lines(view.container)).toEqual(['a\n', 'b\n'])
    h.script(1, page(1, ['A', 'B', 'C'], true, 'v2'))
    click(view.container, '[data-textpreview-reload-now]')
    expect(h.read).toHaveBeenCalledTimes(2)
    await settle()
    expect(h.read).toHaveBeenLastCalledWith(SESSION, PATH, 1, h.controller.signal)
    expect(lines(view.container)).toEqual(['A\n', 'B\n', 'C\n'])
    expect(body(view.container).scrollTop).toBe(50)
  })
})

describe('TextPreview — the file\'s metadata', () => {
  it('does not treat the observation present at read start as a later file change', async () => {
    const h = harness({ 1: page(1, ['newer read'], true, 'v2') })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toMatchObject({ version: 'v2', observedVersion: 'v1' })
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
    h.setVersion('v3')
    view.rerender(<TextPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
    h.script(1, page(1, ['refreshed'], true, 'v4'))
    click(view.container, '[data-textpreview-reload-now]')
    await settle()
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toMatchObject({ version: 'v4', observedVersion: 'v3' })
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
    h.setVersion('v5')
    view.rerender(<TextPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
  })

  it('announces metadata that changes while the first content read is still pending', async () => {
    const h = harness()
    const pending = Promise.withResolvers<ReturnType<typeof page>>()
    h.read.mockReturnValueOnce(pending.promise)
    const view = render(<TextPreview {...h.props()} />)
    h.setVersion('v2')
    view.rerender(<TextPreview {...h.props()} />)
    await act(async () => { pending.resolve(page(1, ['read v1'], true)); await pending.promise })
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toMatchObject({ version: 'v1', observedVersion: 'v1' })
    expect(view.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
  })

  it('refreshes one tab without acknowledging another tab on the same file and store', async () => {
    const h = harness({ 1: page(1, ['old'], true) })
    const otherId = 'tab-2' as TabId
    const other = harness({}, otherId)
    const firstProps = h.props()
    const secondProps = { ...firstProps, useTabInfo: other.props().useTabInfo }
    const first = render(<TextPreview {...firstProps} />)
    const second = render(<TextPreview {...secondProps} />)
    await settle()
    h.setVersion('v2')
    first.rerender(<TextPreview {...firstProps} />)
    second.rerender(<TextPreview {...secondProps} />)
    expect(first.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
    expect(second.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
    h.script(1, page(1, ['new'], true, 'v2'))
    click(first.container, '[data-textpreview-reload-now]')
    await settle()
    expect(first.container.querySelector('[data-textpreview-changed]')).toBeNull()
    expect(second.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
    expect(lines(first.container)).toEqual(['new\n'])
    expect(lines(second.container)).toEqual(['old\n'])
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toMatchObject({ version: 'v2', observedVersion: 'v2' })
    expect(h.instance.getSnapshot().byTab[otherId]).toMatchObject({ version: 'v1', observedVersion: 'v1' })
    expect(h.file?.version).toBe('v2')
  })

  it('keeps metadata failure separate from per-tab content refresh', async () => {
    const h = harness({ 1: page(1, ['a', 'b'], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    h.setVersion('v2')
    h.setFailure(new RemoteError('workspace-file/not-found', 'gone', { path: PATH }))
    view.rerender(<TextPreview {...h.props()} />)
    const bar = view.container.querySelector('[data-textpreview-meta-failed]')
    expect(bar?.getAttribute('data-textpreview-meta-failed')).toBe('workspace-file/not-found')
    expect(bar?.textContent).toContain('error.notFound')
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
    expect(lines(view.container)).toEqual(['a\n', 'b\n'])
    // Retrying content does not acknowledge or mutate the shared metadata failure.
    h.script(1, page(1, ['A'], true, 'v2'))
    click(view.container, '[data-textpreview-reload-now]')
    expect(h.read).toHaveBeenCalledTimes(2)
    await settle()
    expect(lines(view.container)).toEqual(['A\n'])
    // A later provider frame independently clears the metadata failure.
    h.setVersion('v2')
    h.setFailure(undefined)
    view.rerender(<TextPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-meta-failed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
  })

  it('says a metadata-and-read failure once and retries the content read', async () => {
    const h = harness({ 1: failure('workspace-file/outside-workspace', { path: PATH }) })
    h.setFailure(new RemoteError('workspace-file/outside-workspace', 'outside', { path: PATH }))
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    // With nothing read the body's failure is the whole story: a metadata bar
    // above it would repeat the same line.
    expect(view.container.querySelector('[data-textpreview-meta-failed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-failed]')?.getAttribute('data-textpreview-failed'))
      .toBe('workspace-file/outside-workspace')
    h.script(1, page(1, ['a'], true))
    click(view.container, '[data-textpreview-retry]')
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(lines(view.container)).toEqual(['a\n'])
    h.setFailure(undefined)
    view.rerender(<TextPreview {...h.props()} />)
    expect(view.container.querySelector('[data-textpreview-meta-failed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-failed]')).toBeNull()
  })

  it('draws a page holding one empty line as one line, and nothing for a page past the end', async () => {
    const h = harness({ 1: page(1, [''], false), 2: page(2, [], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    expect(lines(view.container)).toEqual(['\n'])
    click(view.container, '[data-textpreview-more]')
    await settle()
    expect(h.read).toHaveBeenLastCalledWith(SESSION, PATH, 2, h.controller.signal)
    expect(lines(view.container)).toEqual(['\n'])
    expect(view.container.querySelector('[data-textpreview-more]')).toBeNull()
  })
})

describe('TextPreview — navigation and view', () => {
  it('rebinds scrolling when the selected Slot body is replaced without changing the renderer id', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], true) })
    const code = codeProps(h, { revision: 1 })
    const fallback: TextPreviewProps = { ...code, renderSlot: () => <div data-late-renderer /> }
    const view = render(<TextPreview {...fallback} />)
    await settle()
    const outer = body(view.container)
    fireEvent.scroll(outer, { target: { scrollTop: 120 } })
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(120)

    view.rerender(<TextPreview {...code} />)
    const inner = scrollport(view.container)
    expect(inner).not.toBe(outer)
    expect(inner.scrollTop).toBe(120)
    fireEvent.scroll(inner, { target: { scrollTop: 240 } })
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(240)

    view.rerender(<TextPreview {...fallback} />)
    expect(outer.scrollTop).toBe(240)
    fireEvent.scroll(outer, { target: { scrollTop: 360 } })
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(360)
  })

  it.each([
    ['Code', 'code', 2 * LINE_HEIGHT],
    ['Plain text', PLAIN_BODY_ID, 2 * LINE_HEIGHT],
  ])('retries a Markdown line navigation after switching to %s', async (_name, rendererId, expectedScrollTop) => {
    PendingIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', PendingIntersectionObserver)
    const h = harness({ 1: page(1, ['a', 'b', 'c'], true) })
    const definitions: DocumentPreviewDefinition[] = [
      { id: 'markdown', extensions: ['md'], title: () => 'Markdown', loading: 'text-pages', wrap: false },
      { id: 'code', extensions: ['md'], title: () => 'Code', loading: 'text-pages', wrap: true },
      { id: PLAIN_BODY_ID, extensions: [], title: () => 'Plain text', loading: 'text-pages', wrap: true },
    ]
    const base = h.props({ params: { line: 3 }, revision: 1 })
    const props: TextPreviewProps = {
      ...base,
      useDocumentPreviews: selector => selector(definitions),
      renderSlot: (_key, owner, opts) => {
        const documentOwner = owner as unknown as OwnerOf<'sidebar.right.tab.document'>
        if (opts.entryKey === 'code') return <CodeBody {...base} {...documentOwner} t={key => key} />
        if (opts.entryKey === PLAIN_BODY_ID) return <TextBody {...base} {...documentOwner} />
        return <div data-test-no-lines />
      },
    }
    const view = render(<TextPreview {...props} />)
    await settle()
    expect(body(view.container).scrollTop).toBe(0)
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBeUndefined()
    act(() => { h.instance.actions.selected(TAB_ID, rendererId) })
    await waitFor(() => { expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(1) })
    expect(scrollport(view.container).scrollTop).toBe(expectedScrollTop)
  })

  it('lands on code lines before and after syntax highlighting is ready', async () => {
    PendingIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', PendingIntersectionObserver)
    const h = harness({ 1: page(1, ['const a = 1', 'const b = 2', 'const c = 3'], true) })
    const view = render(<TextPreview {...codeProps(h, { params: { line: 2 }, revision: 1 })} />)
    await settle()
    expect(view.container.querySelector('[data-code-preview] pre.shiki')).toBeNull()
    expect(view.container.querySelectorAll('[data-code-preview] pre .line')).toHaveLength(3)
    expect(body(view.container).scrollTop).toBe(0)
    const codeScrollport = scrollport(view.container)
    expect(codeScrollport.scrollTop).toBe(LINE_HEIGHT)
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(1)
    fireEvent.scroll(body(view.container), { target: { scrollTop: 300 } })
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(LINE_HEIGHT)
    fireEvent.scroll(codeScrollport, { target: { scrollTop: 300 } })
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(300)

    const block = view.container.querySelector('[data-code-preview] .md-code-block')!
    act(() => { PendingIntersectionObserver.instances[0]!.intersect(block) })
    await waitFor(() => { expect(view.container.querySelector('[data-code-preview] pre.shiki')).not.toBeNull() })
    expect(scrollport(view.container)).toBe(codeScrollport)
    view.rerender(<TextPreview {...codeProps(h, { params: { line: 3 }, revision: 2 })} />)
    expect(codeScrollport.scrollTop).toBe(2 * LINE_HEIGHT)
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(2)
  })

  it('loads until the navigated line is held, then jumps to it once and marks it', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], false), 4: page(4, ['d', 'e', 'f'], true) })
    const view = render(<TextPreview {...h.props({ params: { line: 5 }, revision: 1 })} />)
    await settle()
    // The first page does not reach line 5, so the body asks for the next on its own.
    await settle()
    expect(h.read).toHaveBeenCalledTimes(2)
    expect(h.read).toHaveBeenLastCalledWith(SESSION, PATH, 4, h.controller.signal)
    expect(body(view.container).scrollTop).toBe(4 * LINE_HEIGHT)
    expect(target(view.container)).toBe('5')
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(1)
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.scrollTop).toBe(4 * LINE_HEIGHT)
  })

  it('comes back where the reader was on a remount, instead of jumping again', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], true) })
    const first = render(<TextPreview {...h.props({ params: { line: 3 }, revision: 1 })} />)
    await settle()
    expect(body(first.container).scrollTop).toBe(2 * LINE_HEIGHT)
    fireEvent.scroll(body(first.container), { target: { scrollTop: 300 } })
    first.unmount()
    const second = render(<TextPreview {...h.props({ params: { line: 3 }, revision: 1 })} />)
    await settle()
    expect(body(second.container).scrollTop).toBe(300)
  })

  it('jumps again for a new navigation to the same tab', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], true) })
    const view = render(<TextPreview {...h.props({ params: { line: 3 }, revision: 1 })} />)
    await settle()
    fireEvent.scroll(body(view.container), { target: { scrollTop: 300 } })
    view.rerender(<TextPreview {...h.props({ params: { line: 2 }, revision: 2 })} />)
    expect(body(view.container).scrollTop).toBe(1 * LINE_HEIGHT)
    expect(target(view.container)).toBe('2')
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(2)
  })

  it('stops at the end of the file for a line past it, and answers a navigation without a line', async () => {
    const h = harness({ 1: page(1, ['a', 'b'], true) })
    const view = render(<TextPreview {...h.props({ params: { line: 99 }, revision: 1 })} />)
    await settle()
    expect(h.read).toHaveBeenCalledTimes(1)
    expect(target(view.container)).toBeNull()
    expect(body(view.container).scrollTop).toBe(0)
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(1)
    view.rerender(<TextPreview {...h.props({ params: {}, revision: 2 })} />)
    expect(target(view.container)).toBeNull()
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.revision).toBe(2)
  })

  it('wraps by default and stops when the shared store says so', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    expect(body(view.container).hasAttribute('data-textpreview-wrap')).toBe(true)
    act(() => { h.instance.actions.toggledWrap(TAB_ID) })
    expect(body(view.container).hasAttribute('data-textpreview-wrap')).toBe(false)
  })
})

describe('TextPreview — header controls', () => {
  it('toggles wrap off from the header, reporting the pressed state', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    const wrap = view.container.querySelector<HTMLButtonElement>('[data-textpreview-tool="wrap"]')
    if (wrap === null) throw new Error('expected the wrap control')
    expect(wrap.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(wrap)
    expect(h.instance.getSnapshot().byTab[TAB_ID]?.wrap).toBe(false)
    expect(wrap.getAttribute('aria-pressed')).toBe('false')
    expect(body(view.container).hasAttribute('data-textpreview-wrap')).toBe(false)
  })

  it('reloads only this tab from the header without a change announced', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    const view = render(<TextPreview {...h.props()} />)
    await settle()
    expect(h.useResource).toHaveBeenCalledWith(ADDRESS)
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
    h.script(1, page(1, ['uno'], true, 'v2'))
    click(view.container, '[data-textpreview-tool="reload"]')
    expect(h.read).toHaveBeenCalledTimes(2)
    await settle()
    expect(h.read).toHaveBeenLastCalledWith(SESSION, PATH, 1, h.controller.signal)
    expect(lines(view.container)).toEqual(['uno\n'])
  })

  it('forgets at once when mounted for a record that has already ended', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    h.controller.abort()
    render(<TextPreview {...h.props()} />)
    await settle()
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
  })

  it('forgets its state when the record ends, even with the body unmounted, through one listener however often it mounted', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    const armed = vi.spyOn(h.controller.signal, 'addEventListener')
    const first = render(<TextPreview {...h.props()} />)
    await settle()
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toBeDefined()
    // Switched away and back: the store outlives the body, so nothing re-arms.
    first.unmount()
    const second = render(<TextPreview {...h.props()} />)
    await settle()
    second.unmount()
    expect(armed.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(1)
    h.controller.abort()
    expect(h.instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
  })
})

describe('TextPreview — the Turn change', () => {
  const change = (oldText: string, newText: string) => [{ path: PATH, oldText, newText }]

  it('opens on the Turn change and returns to the file through the toggle', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    const drawn = view.container.querySelector('[data-textpreview-change]')
    expect(drawn?.textContent).toContain('after')
    expect(drawn?.textContent).toContain('before')
    const toggle = view.container.querySelector<HTMLButtonElement>('[data-textpreview-tool="change"]')
    if (toggle === null) throw new Error('expected the change toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(toggle.textContent).toBe('change.show')
    expect(toggle.getAttribute('aria-label')).toBe('change.aria')
    fireEvent.scroll(body(view.container))
    fireEvent.click(toggle)
    expect(view.container.querySelector('[data-textpreview-change]')).toBeNull()
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(lines(view.container)).toEqual(['one\n'])
    fireEvent.click(toggle)
    expect(view.container.querySelector('[data-textpreview-change]')).not.toBeNull()
  })

  it('shows the file and no toggle when no Turn indexed the change', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-change]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-tool="change"]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-tool="split"]')).toBeNull()
    expect(lines(view.container)).toEqual(['one\n'])
  })

  it('starts on the change again when the tab is navigated to another one', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    h.setChange(ADDRESS, 9, change('after', 'later'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="change"]')
    expect(view.container.querySelector('[data-textpreview-change]')).toBeNull()
    view.rerender(<TextPreview {...h.props({ params: { changeSeq: 9 }, revision: 3 })} />)
    expect(view.container.querySelector('[data-textpreview-change]')?.textContent).toContain('later')
  })

  it('reports no stale file and offers no further pages under a change', async () => {
    const h = harness({ 1: page(1, ['one'], false) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    h.setVersion('v2')
    view.rerender(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-meta-failed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-more]')).toBeNull()
    h.setChange(ADDRESS, 5, undefined)
    view.rerender(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 3 })} />)
    expect(view.container.querySelector('[data-textpreview-changed]')).not.toBeNull()
    expect(view.container.querySelector('[data-textpreview-more]')).not.toBeNull()
  })
})

describe('TextPreview — the side-by-side comparison', () => {
  const change = (oldText: string, newText: string) => [{ path: PATH, oldText, newText }]

  /** The two cells of every paired row, as `[old, new]`. */
  const pairs = (container: HTMLElement): [string, string][] =>
    [...container.querySelectorAll('[data-split-row="pair"]')].map((row) => {
      const cells = row.querySelectorAll('[data-split-side]')
      return [cells[0]?.textContent ?? '', cells[1]?.textContent ?? '']
    })

  it("draws the change in place among the file's own lines", async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c', 'NEW', 'e', 'f', 'g'], true) })
    h.setChange(ADDRESS, 5, [{ path: PATH, oldText: 'b\nc\nOLD', newText: 'b\nc\nNEW', newStart: 2 }])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="split"]')
    // The unchanged lines around the change are drawn too: the comparison is the whole file.
    expect(pairs(view.container)).toEqual([
      ['a', 'a'], ['b', 'b'], ['c', 'c'], ['OLD', 'NEW'], ['e', 'e'], ['f', 'f'], ['g', 'g'],
    ])
  })

  it('reads the whole file while the comparison is selected', async () => {
    // Offsets are line numbers: lines 1-2 arrive first, the walk asks for line 3 next.
    const h = harness({ 1: page(1, ['a', 'NEW'], false), 3: page(3, ['c', 'd'], true) })
    h.setChange(ADDRESS, 5, [{ path: PATH, oldText: 'a\nOLD', newText: 'a\nNEW', newStart: 1 }])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    // The one-column change is a closed surface: it does not page the file.
    expect(h.read).toHaveBeenCalledTimes(1)
    click(view.container, '[data-textpreview-tool="split"]')
    await settle()
    await settle()
    expect(h.read).toHaveBeenCalledWith(SESSION, PATH, 3, expect.anything())
    expect(pairs(view.container)).toEqual([['a', 'a'], ['OLD', 'NEW'], ['c', 'c'], ['d', 'd']])
  })

  it('records the reader\'s decision and shows it on the controls', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    const accept = view.container.querySelector<HTMLButtonElement>('[data-textpreview-tool="accept"]')
    const revert = view.container.querySelector<HTMLButtonElement>('[data-textpreview-tool="revert"]')
    expect(accept?.textContent).toBe('review.accept')
    expect(revert?.textContent).toBe('review.revert')
    fireEvent.click(accept as HTMLButtonElement)
    await settle()
    expect(h.review).toHaveBeenCalledWith('accepted', { seq: 5, path: PATH })
    expect(view.container.querySelector('[data-textpreview-tool="accept"]')?.textContent).toBe('review.accepted')
    // The change stays on screen: accepting keeps the file as the change left it.
    expect(view.container.querySelector('[data-textpreview-change]')).not.toBeNull()
  })

  it('reverts the change, then shows the restored file', async () => {
    const h = harness({ 1: page(1, ['before'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    fireEvent.click(view.container.querySelector('[data-textpreview-tool="revert"]') as HTMLButtonElement)
    await settle()
    expect(h.review).toHaveBeenCalledWith('reverted', { seq: 5, path: PATH })
    // The change view is left behind and the file is read again.
    expect(view.container.querySelector('[data-textpreview-change]')).toBeNull()
    expect(h.read).toHaveBeenCalledTimes(2)
  })

  it('steps between the changes of one Turn, stopping at both ends', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    h.setChange(ADDRESS, 5, [
      { path: PATH, oldText: 'one', newText: 'ONE' },
      { path: PATH, oldText: 'two', newText: 'TWO' },
      { path: PATH, oldText: 'three', newText: 'THREE' },
    ])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    const position = (): string | null | undefined =>
      view.container.querySelector('[data-textpreview-hunk-position]')?.textContent
    const button = (tool: string): HTMLButtonElement =>
      view.container.querySelector<HTMLButtonElement>(`[data-textpreview-tool="${tool}"]`) as HTMLButtonElement
    expect(position()).toBe('hunk.position(index=1,count=3)')
    expect(button('prev-hunk').disabled).toBe(true)
    fireEvent.click(button('next-hunk'))
    expect(position()).toBe('hunk.position(index=2,count=3)')
    // The body lands on that change: one line height per anchor.
    expect(body(view.container).scrollTop).toBe(20)
    fireEvent.click(button('next-hunk'))
    expect(position()).toBe('hunk.position(index=3,count=3)')
    expect(button('next-hunk').disabled).toBe(true)
    fireEvent.click(button('prev-hunk'))
    expect(position()).toBe('hunk.position(index=2,count=3)')
  })

  it('steps between the changes of a whole-file comparison too', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'ONE', 'c', 'd', 'TWO', 'e'], true) })
    h.setChange(ADDRESS, 5, [
      { path: PATH, oldText: 'b\none', newText: 'b\nONE', newStart: 2 },
      { path: PATH, oldText: 'd\ntwo', newText: 'd\nTWO', newStart: 5 },
    ])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="split"]')
    expect(view.container.querySelectorAll('[data-diff-hunk]')).toHaveLength(2)
    click(view.container, '[data-textpreview-tool="next-hunk"]')
    expect(view.container.querySelector('[data-textpreview-hunk-position]')?.textContent)
      .toBe('hunk.position(index=2,count=2)')
    expect(view.container.querySelector('[data-textpreview-tool="next-hunk"]')?.hasAttribute('disabled')).toBe(true)
  })

  it('steps into the next file of the Turn, and back into the previous one', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    h.setChange(ADDRESS, 5, [
      { path: PATH, oldText: 'one', newText: 'ONE' },
      { path: PATH, oldText: 'two', newText: 'TWO' },
    ])
    const other = 'dsh-resource://file/session/s-1/work/other.md'
    const neighbour = { address: other, seq: 9, diffs: [{ path: PATH, oldText: 'x', newText: 'X' }], turn: 1 }
    h.setNeighbour(ADDRESS, 5, 'next', neighbour)
    h.setNeighbour(ADDRESS, 5, 'previous', neighbour)
    // Two regions of the Turn precede this change, of five in it.
    h.setHunkRange(ADDRESS, 5, { before: 2, total: 5 })
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    const position = (): string | null | undefined =>
      view.container.querySelector('[data-textpreview-hunk-position]')?.textContent
    const button = (tool: string): HTMLButtonElement =>
      view.container.querySelector<HTMLButtonElement>(`[data-textpreview-tool="${tool}"]`) as HTMLButtonElement
    expect(position()).toBe('hunk.position(index=3,count=5)')
    // Past the last region of this file, the next step opens the next change's
    // first region.
    fireEvent.click(button('next-hunk'))
    expect(position()).toBe('hunk.position(index=4,count=5)')
    fireEvent.click(button('next-hunk'))
    expect(h.tabActions.openResource).toHaveBeenCalledWith(other, { params: { changeSeq: 9, hunk: 0 } })
    // Before the first region, the previous step opens the previous change's last.
    fireEvent.click(button('prev-hunk'))
    fireEvent.click(button('prev-hunk'))
    expect(h.tabActions.openResource).toHaveBeenLastCalledWith(other, { params: { changeSeq: 9, hunk: 0 } })
  })

  it('lands on the region the navigation asked for', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    h.setChange(ADDRESS, 5, [
      { path: PATH, oldText: 'one', newText: 'ONE' },
      { path: PATH, oldText: 'two', newText: 'TWO' },
      { path: PATH, oldText: 'three', newText: 'THREE' },
    ])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5, hunk: 1 }, revision: 2 })} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-hunk-position]')?.textContent)
      .toBe('hunk.position(index=2,count=3)')
  })

  it('offers no stepper for a change that is a single region', async () => {
    const h = harness({ 1: page(1, ['a'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-hunk-position]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-tool="prev-hunk"]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-tool="next-hunk"]')).toBeNull()
  })

  it('starts on the decision an earlier look already recorded', async () => {
    const h = harness({ 1: page(1, ['after'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    h.setReview(ADDRESS, 5, 'reverted')
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    expect(view.container.querySelector('[data-textpreview-tool="revert"]')?.textContent).toBe('review.reverted')
    expect(view.container.querySelector('[data-textpreview-tool="accept"]')?.textContent).toBe('review.accept')
    // A navigation to another change starts undecided again.
    h.setReview(ADDRESS, 9, undefined)
    h.setChange(ADDRESS, 9, change('after', 'later'))
    view.rerender(<TextPreview {...h.props({ params: { changeSeq: 9 }, revision: 3 })} />)
    expect(view.container.querySelector('[data-textpreview-tool="revert"]')?.textContent).toBe('review.revert')
  })

  it('reports a refused decision on the control that made it', async () => {
    const h = harness({ 1: page(1, ['after'], true) })
    h.review.mockResolvedValueOnce('notes.md changed after seq 5 (mismatch), so reverting it here would rewrite the wrong lines.')
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    fireEvent.click(view.container.querySelector('[data-textpreview-tool="revert"]') as HTMLButtonElement)
    await settle()
    expect(view.container.querySelector('[data-textpreview-tool="revert"]')?.textContent).toBe('review.failed')
    expect(view.container.querySelector('[data-textpreview-change]')).not.toBeNull()
  })

  it('keeps the change-only body when the hunks cannot be placed in the file', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c'], true) })
    h.setChange(ADDRESS, 5, change('OLD', 'NEW'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="split"]')
    expect(pairs(view.container)).toEqual([['OLD', 'NEW']])
  })

  it('lands on the first change when the comparison draws the whole file', async () => {
    const h = harness({ 1: page(1, ['a', 'b', 'c', 'NEW', 'e', 'f', 'g'], true) })
    h.setChange(ADDRESS, 5, [{ path: PATH, oldText: 'b\nc\nOLD', newText: 'b\nc\nNEW', newStart: 2 }])
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="split"]')
    // The bands are the path header and then the file's lines, so the change on
    // the file's fourth line opens on the fourth band, not on the first.
    expect(body(view.container).scrollTop).toBe(4 * LINE_HEIGHT)
    // A second entry into the layout lands there again.
    click(view.container, '[data-textpreview-tool="split"]')
    fireEvent.scroll(body(view.container), { target: { scrollTop: 0 } })
    click(view.container, '[data-textpreview-tool="split"]')
    expect(body(view.container).scrollTop).toBe(4 * LINE_HEIGHT)
    // Staying in the layout leaves the reader where they scrolled to.
    fireEvent.scroll(body(view.container), { target: { scrollTop: 0 } })
    view.rerender(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    expect(body(view.container).scrollTop).toBe(0)
  })

  it('does not scroll when the comparison has no placed change to land on', async () => {
    // The one-column body is the change itself, so selecting two columns keeps
    // the reader at the top of a body that already opens on the change.
    const h = harness({ 1: page(1, ['a', 'b', 'c'] , true) })
    h.setChange(ADDRESS, 5, change('OLD', 'NEW'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="split"]')
    expect(body(view.container).scrollTop).toBe(0)
  })

  it('swaps the change between one column and two without leaving the change', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    const split = view.container.querySelector('[data-textpreview-tool="split"]')
    expect(split?.getAttribute('aria-pressed')).toBe('false')
    expect(split?.textContent).toBe('split.label')
    expect(view.container.querySelector('[data-change-mode="change"]')).toBeTruthy()
    expect(view.container.querySelector('[data-diff-layout="split"]')).toBeNull()
    click(view.container, '[data-textpreview-tool="split"]')
    expect(view.container.querySelector('[data-change-mode="split"]')).toBeTruthy()
    expect(view.container.querySelector('[data-diff-layout="split"]')).toBeTruthy()
    // Both controls keep reporting their own fact: the change still shows.
    expect(view.container.querySelector('[data-textpreview-tool="change"]')?.getAttribute('aria-pressed')).toBe('true')
    click(view.container, '[data-textpreview-tool="split"]')
    expect(view.container.querySelector('[data-change-mode="change"]')).toBeTruthy()
    expect(view.container.querySelector('[data-diff-layout="split"]')).toBeNull()
  })

  it('reaches the comparison from the file view and leaves it through the change toggle', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="change"]')
    expect(view.container.querySelector('[data-textpreview-change]')).toBeNull()
    click(view.container, '[data-textpreview-tool="split"]')
    expect(view.container.querySelector('[data-change-mode="split"]')).toBeTruthy()
    click(view.container, '[data-textpreview-tool="change"]')
    expect(view.container.querySelector('[data-textpreview-change]')).toBeNull()
    expect(lines(view.container)).toEqual(['one\n'])
  })

  it('starts on the one-column change again after navigating to another one', async () => {
    const h = harness({ 1: page(1, ['one'], true) })
    h.setChange(ADDRESS, 5, change('before', 'after'))
    h.setChange(ADDRESS, 9, change('after', 'later'))
    const view = render(<TextPreview {...h.props({ params: { changeSeq: 5 }, revision: 2 })} />)
    await settle()
    click(view.container, '[data-textpreview-tool="split"]')
    expect(view.container.querySelector('[data-change-mode="split"]')).toBeTruthy()
    view.rerender(<TextPreview {...h.props({ params: { changeSeq: 9 }, revision: 3 })} />)
    expect(view.container.querySelector('[data-change-mode="change"]')).toBeTruthy()
    expect(view.container.querySelector('[data-textpreview-change]')?.textContent).toContain('later')
  })
})
