// @vitest-environment jsdom
/**
 * The shared colouring pass: when it starts, how it is bounded, what it reports
 * per block, and what a caller sees while a grammar is missing or still loading.
 *
 * The pass is driven by timers, so every assertion advances them explicitly; the
 * token runs themselves are compared against the shared highlighter's own output
 * for the same text, which is what "the block's grammar, from a clean state"
 * means.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { highlightLines } from '../src/markdown/highlight.ts'
import type { HighlightSpan } from '../src/markdown/highlight.ts'
import { useHighlightedCode, type HighlightedBlock } from '../src/markdown/useHighlightedCode.ts'

/** The hook's own pause before the pass starts, mirrored from the module. */
const PAUSE_MS = 120

/** The hook's per-block line budget, mirrored from the module. */
const LINE_BUDGET = 2000

/** The hook's per-turn chunk, mirrored to size a block that needs several turns. */
const CHUNK_LINES = 40

/** What the last render read, so a spec can assert the hook's return value. */
let latest: readonly HighlightedBlock[] = []

/** A renderless probe: the hook's value is all this spec asserts. */
function Probe({ blocks, lang }: { blocks: readonly string[]; lang: string | undefined }) {
  latest = useHighlightedCode(blocks, lang)
  return null
}

/** One block of `lines` distinct TypeScript lines. */
function blockOf(lines: number): string {
  return Array.from({ length: lines }, (_value, index) => `const value${index} = ${index}`).join('\n')
}

/** Let the hook's pause elapse, then every turn of the pass it starts. */
function settle(): void {
  act(() => {
    vi.advanceTimersByTime(PAUSE_MS)
    vi.runAllTimers()
  })
}

/** The text one run list reconstructs, which is the code the caller handed over. */
function textOf(runs: readonly (readonly HighlightSpan[])[] | undefined): string {
  return (runs ?? []).map(line => line.map(span => span.text).join('')).join('\n')
}

/**
 * The colour of every run that carries ink, as one string. The two highlighter
 * arms fold whitespace runs differently, so comparing the ink-bearing runs — not
 * every span — is what makes "the same grammar coloured the same code" exact.
 */
function inkOf(runs: readonly (readonly HighlightSpan[])[] | undefined): string {
  return (runs ?? []).map(line => line
    .filter(span => /\S/u.test(span.text))
    .map(span => String(span.style.color))
    .join('|')).join('\n')
}

beforeEach(() => {
  latest = []
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useHighlightedCode', () => {
  it('reports nothing until the pause elapses, then the block in its own grammar', () => {
    render(<Probe blocks={['const a = 1']} lang="typescript" />)
    expect(latest).toEqual([])
    settle()
    expect(textOf(latest[0])).toBe('const a = 1')
    expect(inkOf(latest[0])).toBe(inkOf(highlightLines('const a = 1', 'typescript')))
  })

  it('starts every block from a clean grammar state', () => {
    // A block left open inside a comment, then a block of plain code: the second
    // must colour as code, not as the first block's continued comment.
    const open = '/* a comment that never closes'
    const code = 'const b = 2'
    render(<Probe blocks={[open, code]} lang="typescript" />)
    settle()
    expect(inkOf(latest[0])).toBe(inkOf(highlightLines(open, 'typescript')))
    expect(inkOf(latest[1])).toBe(inkOf(highlightLines(code, 'typescript')))
  })

  it('colours a block longer than one turn', () => {
    const long = blockOf(CHUNK_LINES * 3)
    render(<Probe blocks={[long]} lang="typescript" />)
    settle()
    expect(latest[0]).toHaveLength(CHUNK_LINES * 3)
    expect(inkOf(latest[0])).toBe(inkOf(highlightLines(long, 'typescript')))
  })

  it('leaves a block past the line budget plain while its neighbour still colours', () => {
    render(<Probe blocks={[blockOf(LINE_BUDGET + 1), 'const b = 2']} lang="typescript" />)
    settle()
    expect(latest[0]).toBeUndefined()
    expect(inkOf(latest[1])).toBe(inkOf(highlightLines('const b = 2', 'typescript')))
  })

  it('runs no pass at all when every block is past the line budget', () => {
    render(<Probe blocks={[blockOf(LINE_BUDGET + 1)]} lang="typescript" />)
    settle()
    // No entry at all: every block of the list stays plain.
    expect(latest).toEqual([])
  })

  it('leaves a block plain when its language has no grammar', () => {
    render(<Probe blocks={['const a = 1']} lang={undefined} />)
    settle()
    expect(latest[0]).toBeUndefined()
  })

  it('reports nothing once the blocks change, until the new pass reaches them', () => {
    const view = render(<Probe blocks={['const a = 1']} lang="typescript" />)
    settle()
    expect(inkOf(latest[0])).toBe(inkOf(highlightLines('const a = 1', 'typescript')))
    view.rerender(<Probe blocks={['const b = 2']} lang="typescript" />)
    // The runs describe text the caller has left, so they are withheld.
    expect(latest).toEqual([])
    settle()
    expect(inkOf(latest[0])).toBe(inkOf(highlightLines('const b = 2', 'typescript')))
  })

  it('withholds the runs of a list that gained a block', () => {
    const view = render(<Probe blocks={['const a = 1']} lang="typescript" />)
    settle()
    view.rerender(<Probe blocks={['const a = 1', 'const b = 2']} lang="typescript" />)
    expect(latest).toEqual([])
    settle()
    expect(inkOf(latest[1])).toBe(inkOf(highlightLines('const b = 2', 'typescript')))
  })

  it('keeps the runs of an equal but rebuilt block list', () => {
    const view = render(<Probe blocks={['const a = 1']} lang="typescript" />)
    settle()
    const runs = latest[0]
    view.rerender(<Probe blocks={['const a = 1']} lang="typescript" />)
    // A caller that rebuilds its array still gets the runs it already has.
    expect(latest[0]).toBe(runs)
  })
})
