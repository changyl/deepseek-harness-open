// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import {
  DiffSplitBlock as LocalizedDiffSplitBlock, buildFileSplitRows, buildSplitRows,
  type DiffHighlighter, type DiffHunk, type SplitDiffRow,
} from '../src/index.ts'
import { diffBlockLabels } from './labels.client.ts'

/**
 * A highlighter that makes every line one run of its own text, so a spec can
 * see which line of which side a cell's runs came from without depending on a
 * grammar's tokenization.
 */
const oneRunPerLine: DiffHighlighter = text => text.split('\n').map(line => [{ text: line, style: { color: line } }])

function DiffSplitBlock(props: Omit<ComponentProps<typeof LocalizedDiffSplitBlock>, 'labels'>) {
  return <LocalizedDiffSplitBlock {...props} labels={diffBlockLabels} />
}

afterEach(cleanup)

beforeEach(() => {
  vi.useRealTimers()
})

/** The two cells of every paired row, as `[old, new]`. */
function pairs(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll('[data-split-row="pair"]')].map((row) => {
    const cells = row.querySelectorAll('[data-split-side]')
    return [cells[0]?.textContent ?? '', cells[1]?.textContent ?? '']
  })
}

/** The same two cells, read off a row list instead of a rendered container. */
function rowPairs(rows: readonly SplitDiffRow[]): [string, string][] {
  return rows.flatMap(row => row.kind === 'pair'
    ? [[row.left.kind === 'empty' ? '' : row.left.text, row.right.kind === 'empty' ? '' : row.right.text] as [string, string]]
    : [])
}

describe('buildSplitRows', () => {
  it('pairs an edit line by line, keeping the shared context on both sides', () => {
    const { rows, added, removed, files } = buildSplitRows([
      { path: 'a.ts', oldText: 'a\nold\nz', newText: 'a\nnew\nz' },
    ])
    expect(rows).toEqual<SplitDiffRow[]>([
      { kind: 'path', text: 'a.ts', hunk: 0 },
      { kind: 'pair', left: { kind: 'context', text: 'a' }, right: { kind: 'context', text: 'a' } },
      { kind: 'pair', left: { kind: 'del', text: 'old' }, right: { kind: 'add', text: 'new' } },
      { kind: 'pair', left: { kind: 'context', text: 'z' }, right: { kind: 'context', text: 'z' } },
    ])
    expect({ added, removed, files }).toEqual({ added: 3, removed: 3, files: 1 })
  })

  it('pads the side a one-sided change has no line for', () => {
    // An insert has nothing on the old side; the delete that follows has nothing on the new one.
    const insert = buildSplitRows([{ path: 'a.ts', oldText: 'a\nz', newText: 'a\nnew\nz' }]).rows
    expect(insert.filter(row => row.kind === 'pair').map(row => row.kind === 'pair' ? [row.left.kind, row.right.kind] : []))
      .toEqual([['context', 'context'], ['empty', 'add'], ['context', 'context']])
    const remove = buildSplitRows([{ path: 'a.ts', oldText: 'a\nold\nz', newText: 'a\nz' }]).rows
    expect(remove.filter(row => row.kind === 'pair').map(row => row.kind === 'pair' ? [row.left.kind, row.right.kind] : []))
      .toEqual([['context', 'context'], ['del', 'empty'], ['context', 'context']])
  })

  it('draws a create as new-side lines opposite empty cells, and a same-file hunk behind a gap', () => {
    const create = buildSplitRows([{ path: 'notes/new.txt', oldText: null, newText: 'hello\nworld' }])
    expect(create.rows[0]).toEqual({ kind: 'path', text: 'notes/new.txt', hunk: 0 })
    expect(create.rows.slice(1).every(row => row.kind === 'pair'
      && row.left.kind === 'empty' && row.right.kind === 'add')).toBe(true)
    const scattered = buildSplitRows([
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ])
    expect(scattered.rows.filter(row => row.kind === 'gap')).toHaveLength(1)
    expect(scattered.rows.filter(row => row.kind === 'path')).toHaveLength(1)
  })

  it('never pairs a line with itself across the change: a repeated line inside the band still pairs by position', () => {
    const { rows } = buildSplitRows([{ path: 'a.ts', oldText: 'a\nx\nx\nb', newText: 'a\nx\nb' }])
    expect(rows.filter(row => row.kind === 'pair').map(row => row.kind === 'pair' ? row.left.kind : null))
      .toEqual(['context', 'context', 'del', 'context'])
  })
})

describe('buildFileSplitRows', () => {
  const base = Array.from({ length: 12 }, (_v, i) => `l${i + 1}`)
  /** The file's new text, with the changed line already applied. */
  const changed = (...indexes: number[]): string[] => base.map((line, i) => indexes.includes(i) ? 'NEW' : line)
  // A change on line 6 carries three context lines a side, so it covers lines 3..9.
  const hunk: DiffHunk = {
    path: 'a.ts',
    oldText: 'l3\nl4\nl5\nOLD\nl7\nl8\nl9',
    newText: 'l3\nl4\nl5\nNEW\nl7\nl8\nl9',
    newStart: 3,
  }

  it("draws the change in place among the file's own lines", () => {
    const rows = buildFileSplitRows([hunk], changed(5))!
    expect(rows.filter(row => row.kind === 'path')).toEqual([{ kind: 'path', text: 'a.ts' }])
    expect(rowPairs(rows)).toEqual([
      ['l1', 'l1'], ['l2', 'l2'],
      ['l3', 'l3'], ['l4', 'l4'], ['l5', 'l5'], ['OLD', 'NEW'], ['l7', 'l7'], ['l8', 'l8'], ['l9', 'l9'],
      ['l10', 'l10'], ['l11', 'l11'], ['l12', 'l12'],
    ])
    // Only the file's one changed line carries a change; every other line is shared context.
    expect(rows.filter(row => row.kind === 'pair' && row.left.kind !== 'context')).toHaveLength(1)
  })

  it('places a second hunk after the first without repeating the path', () => {
    const rows = buildFileSplitRows([
      { path: 'a.ts', oldText: 'l1\nOLD', newText: 'l1\nNEW', newStart: 1 },
      { path: 'a.ts', oldText: 'l11\nOLD', newText: 'l11\nNEW', newStart: 11 },
    ], changed(1, 11))!
    expect(rows.filter(row => row.kind === 'path')).toHaveLength(1)
    // Every line of the file is drawn once: two hunk bands and the eight lines between them.
    expect(rowPairs(rows)).toHaveLength(12)
    expect(rowPairs(rows)[1]).toEqual(['OLD', 'NEW'])
    expect(rowPairs(rows)[11]).toEqual(['OLD', 'NEW'])
  })

  it('places a hunk that records no line by its own unique text', () => {
    const rows = buildFileSplitRows([
      { path: 'a.ts', oldText: 'b\nc\nOLD', newText: 'b\nc\nNEW' },
    ], ['a', 'b', 'c', 'NEW', 'e'])
    expect(rowPairs(rows!)).toEqual([
      ['a', 'a'], ['b', 'b'], ['c', 'c'], ['OLD', 'NEW'], ['e', 'e'],
    ])
  })

  it('prefers a recorded line over the text search, so a repeated line never moves the change', () => {
    const rows = buildFileSplitRows([
      { path: 'a.ts', oldText: 'OLD', newText: 'NEW', newStart: 4 },
    ], ['NEW', 'b', 'c', 'NEW'])
    expect(rowPairs(rows!)).toEqual([['NEW', 'NEW'], ['b', 'b'], ['c', 'c'], ['OLD', 'NEW']])
  })

  it('refuses a text-placed hunk whose text is absent, repeated, or empty', () => {
    // Absent from the file.
    expect(buildFileSplitRows([{ path: 'a.ts', oldText: 'x', newText: 'NOWHERE' }], ['a', 'b'])).toBeNull()
    // Twice in the file: either placement would be a guess.
    expect(buildFileSplitRows([{ path: 'a.ts', oldText: 'x', newText: 'dup' }], ['dup', 'mid', 'dup'])).toBeNull()
    // A new side with no lines names no place to find.
    expect(buildFileSplitRows([{ path: 'a.ts', oldText: 'gone', newText: '' }], ['a'])).toBeNull()
  })

  it('draws a hunk that recorded no lines at all as no rows', () => {
    const rows = buildFileSplitRows([{ path: 'a.ts', oldText: null, newText: '', newStart: 1 }], ['a', 'b'])
    expect(rowPairs(rows!)).toEqual([['a', 'a'], ['b', 'b']])
  })

  it('refuses a hunk the file cannot account for, so the caller keeps the change-only body', () => {
    const file = changed(5)
    expect(buildFileSplitRows([], file)).toBeNull()
    // No recorded position, and a position the file cannot start at.
    expect(buildFileSplitRows([{ path: 'a.ts', oldText: 'x', newText: 'y' }], file)).toBeNull()
    expect(buildFileSplitRows([{ ...hunk, newStart: 0 }], file)).toBeNull()
    expect(buildFileSplitRows([{ ...hunk, newStart: 10 }], file)).toBeNull()
    // A read that no longer matches the recorded change.
    expect(buildFileSplitRows([{ path: 'a.ts', oldText: 'x', newText: 'y', newStart: 2 }], ['l1', 'changed'])).toBeNull()
    // Two files cannot share one whole-file body, and hunks cannot overlap.
    expect(buildFileSplitRows([hunk, { ...hunk, path: 'b.ts' }], file)).toBeNull()
    expect(buildFileSplitRows([
      { path: 'a.ts', oldText: 'x', newText: 'l1\nl2', newStart: 1 },
      { path: 'a.ts', oldText: 'x', newText: 'l2', newStart: 2 },
    ], file)).toBeNull()
  })
})

describe('buildSplitRows highlighting', () => {
  it("carries each side's own runs on the changed cells and on the context both sides share", () => {
    const { rows } = buildSplitRows([{ path: 'a.ts', oldText: 'a\nold\nz', newText: 'a\nnew\nz' }], oneRunPerLine)
    expect(rows.slice(1)).toEqual([
      {
        kind: 'pair',
        left: { kind: 'context', text: 'a', spans: [{ text: 'a', style: { color: 'a' } }] },
        right: { kind: 'context', text: 'a', spans: [{ text: 'a', style: { color: 'a' } }] },
      },
      {
        kind: 'pair',
        left: { kind: 'del', text: 'old', spans: [{ text: 'old', style: { color: 'old' } }] },
        right: { kind: 'add', text: 'new', spans: [{ text: 'new', style: { color: 'new' } }] },
      },
      {
        kind: 'pair',
        left: { kind: 'context', text: 'z', spans: [{ text: 'z', style: { color: 'z' } }] },
        right: { kind: 'context', text: 'z', spans: [{ text: 'z', style: { color: 'z' } }] },
      },
    ])
  })

  it('draws a cell the highlighter left uncovered as plain text', () => {
    const { rows } = buildSplitRows([{ path: 'a.ts', oldText: 'old', newText: 'new' }], () => [])
    expect(rows.slice(1)).toEqual([
      { kind: 'pair', left: { kind: 'del', text: 'old' }, right: { kind: 'add', text: 'new' } },
    ])
  })
})

describe('buildFileSplitRows highlighting', () => {
  it("carries the file's own runs on the unchanged lines it draws", () => {
    const rows = buildFileSplitRows(
      [{ path: 'a.ts', oldText: 'l1\nOLD', newText: 'l1\nNEW', newStart: 1 }],
      ['l1', 'NEW'],
      oneRunPerLine,
    )!
    // The band that opens the change carries the jump marker, so it is the
    // hunk's own first row — here the context line the two sides share.
    expect(rows).toEqual([
      { kind: 'path', text: 'a.ts' },
      {
        kind: 'pair',
        left: { kind: 'context', text: 'l1', spans: [{ text: 'l1', style: { color: 'l1' } }] },
        right: { kind: 'context', text: 'l1', spans: [{ text: 'l1', style: { color: 'l1' } }] },
        hunk: 0,
      },
      {
        kind: 'pair',
        left: { kind: 'del', text: 'OLD', spans: [{ text: 'OLD', style: { color: 'OLD' } }] },
        right: { kind: 'add', text: 'NEW', spans: [{ text: 'NEW', style: { color: 'NEW' } }] },
      },
    ])
  })
})

describe('DiffSplitBlock structure', () => {
  it('renders one two-cell row per band under a path header, with the shared footer', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nold', newText: 'a\nnew' }]
    const { container } = render(<DiffSplitBlock diffs={diffs} />)
    expect(container.querySelector('[data-diff-layout="split"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-split-row="path"]')).toHaveLength(1)
    expect(pairs(container)).toEqual([['a', 'a'], ['old', 'new']])
    expect(screen.getByText('└ +2 -2 · 1 file')).toBeTruthy()
  })

  it('marks the row that opens each change, so a reader can jump between them', () => {
    const { container } = render(<DiffSplitBlock diffs={[
      { path: 'a.ts', oldText: 'one', newText: 'ONE', newStart: 1 },
      { path: 'a.ts', oldText: 'nine', newText: 'NINE', newStart: 9 },
    ]} fileLines={['ONE', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'NINE']} maxLines={Infinity} />)
    const anchors = [...container.querySelectorAll('[data-diff-hunk]')]
      .map(row => row.getAttribute('data-diff-hunk'))
    // One anchor per change, in file order.
    expect(anchors).toEqual(['0', '1'])
  })

  it('renders nothing for empty hunks', () => {
    const { container } = render(<DiffSplitBlock diffs={[]} />)
    expect(container.querySelector('[data-diff]')).toBeNull()
  })

  it("draws both columns as the changed file type's grammar runs", () => {
    const { container } = render(
      <DiffSplitBlock diffs={[{ path: 'a.ts', oldText: 'const a = 1', newText: 'const b = 2' }]} lang="ts" />,
    )
    expect(container.querySelector('[data-diff]')?.hasAttribute('data-diff-highlight')).toBe(true)
    const cells = container.querySelectorAll('[data-split-row="pair"] [data-split-side]')
    expect(cells[0]?.textContent).toBe('const a = 1')
    expect(cells[1]?.textContent).toBe('const b = 2')
    expect(cells[0]?.querySelectorAll('span[style]').length).toBeGreaterThan(1)
    expect(cells[1]?.querySelectorAll('span[style]').length).toBeGreaterThan(1)
  })

  it('draws bare cells and marks nothing for a language that cannot be highlighted', () => {
    const absent = render(<DiffSplitBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} />)
    expect(absent.container.querySelector('[data-diff]')?.hasAttribute('data-diff-highlight')).toBe(false)
    expect(absent.container.querySelectorAll('span[style]').length).toBe(0)
    cleanup()
    const unknown = render(
      <DiffSplitBlock diffs={[{ path: 'a.cob', oldText: null, newText: 'MOVE X' }]} lang="cobol" />,
    )
    expect(unknown.container.querySelector('[data-diff]')?.hasAttribute('data-diff-highlight')).toBe(false)
    expect(pairs(unknown.container)).toEqual([['', 'MOVE X']])
  })

  it('collapses the middle past the cap and expands on demand', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: Array.from({ length: 20 }, (_v, i) => `line ${i + 1}`).join('\n') }]
    const { container } = render(<DiffSplitBlock diffs={diffs} maxLines={8} />)
    // The cap counts every row, so the path header takes one of the eight slots.
    expect(container.querySelectorAll('[data-split-row]')).toHaveLength(8)
    expect(pairs(container)).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: /展开其余 13 行差异/ }))
    expect(pairs(container)).toHaveLength(20)
  })

  it('draws the whole file when the caller supplies its lines, and the change alone otherwise', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'l1\nold', newText: 'l1\nnew', newStart: 1 }]
    const withFile = render(<DiffSplitBlock diffs={diffs} fileLines={['l1', 'new', 'tail']} />)
    expect(pairs(withFile.container)).toEqual([['l1', 'l1'], ['old', 'new'], ['tail', 'tail']])
    // The footer still reports the change, not the file.
    expect(screen.getByText('└ +2 -2 · 1 file')).toBeTruthy()
    cleanup()
    const changeOnly = render(<DiffSplitBlock diffs={diffs} />)
    expect(pairs(changeOnly.container)).toEqual([['l1', 'l1'], ['old', 'new']])
  })

  it('keeps the change-only body when the supplied lines cannot place the hunks', () => {
    const { container } = render(
      <DiffSplitBlock diffs={[{ path: 'a.ts', oldText: 'old', newText: 'new' }]} fileLines={['something', 'else']} />,
    )
    expect(pairs(container)).toEqual([['old', 'new']])
  })

  it('copies the unified diff text, so both layouts share one clipboard form', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffSplitBlock diffs={[
      { path: 'a.ts', oldText: 'old', newText: 'new' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制' })) })
    expect(writeText).toHaveBeenCalledWith('a.ts\n- old\n+ new\n⋯\n- p\n+ q')
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
  })

  it('draws the empty cell opposite a one-sided change', () => {
    const insert = render(<DiffSplitBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'added' }]} />)
    expect(pairs(insert.container)).toEqual([['', 'added']])
    cleanup()
    const remove = render(<DiffSplitBlock diffs={[{ path: 'a.ts', oldText: 'gone', newText: '' }]} />)
    expect(pairs(remove.container)).toEqual([['gone', '']])
  })

  it('marks where the change sits in a drawn file, so a whole-file reader can land on it', () => {
    const hunks: DiffHunk[] = [{ path: 'a.ts', oldText: 'b\nc\nOLD', newText: 'b\nc\nNEW', newStart: 2 }]
    const withFile = render(<DiffSplitBlock diffs={hunks} fileLines={['a', 'b', 'c', 'NEW', 'e']} />)
    const marked = withFile.container.querySelectorAll('[data-split-change-start]')
    // One band, not one per changed line: the band holding the removed line.
    expect(marked).toHaveLength(1)
    expect(marked[0]?.textContent).toBe('OLD')
    cleanup()
    // A change-only body opens on the change, so it marks nothing.
    const changeOnly = render(<DiffSplitBlock diffs={hunks} />)
    expect(changeOnly.container.querySelector('[data-split-change-start]')).toBeNull()
    cleanup()
    // A second change further down does not move the mark.
    const scattered = render(<DiffSplitBlock diffs={[
      { path: 'a.ts', oldText: 'A', newText: 'B', newStart: 1 },
      { path: 'a.ts', oldText: 'E', newText: 'F', newStart: 5 },
    ]} fileLines={['B', 'c', 'd', 'e', 'F']} />)
    expect(scattered.container.querySelectorAll('[data-split-change-start]')).toHaveLength(1)
    expect(scattered.container.querySelector('[data-split-change-start]')?.textContent).toBe('A')
  })

  it('keeps the copied label while it is shown, then clears it', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffSplitBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制' })) })
    // A second click while the label already says copied copies nothing more.
    fireEvent.click(screen.getByRole('button', { name: '复制成功' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('keeps the copy label when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<DiffSplitBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制' })) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })
})
