/**
 * The client's one way to colour a code surface the shared highlighter would
 * block on: tokenize one or more code blocks off the render path, a bounded
 * number of lines per turn of the event loop, and report each block's per-line
 * runs once its own pass has covered it.
 *
 * The shared highlighter is synchronous and costs roughly half a millisecond a
 * source line, so tokenizing a whole file in the render that first shows it
 * would freeze the surface for as long as the file is long. This hook waits for
 * {@link HIGHLIGHT_PAUSE_MS} after the blocks last changed, then yields between
 * {@link HIGHLIGHT_CHUNK_LINES}-line chunks; a block longer than
 * {@link MAX_HIGHLIGHT_LINES} is left out of the pass entirely. Every block gets
 * its own highlighter session, so a seam between two blocks never carries one
 * block's open comment or string into the next.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  StreamingHighlightSession, grammarLoadCount, subscribeGrammarLoaded, type HighlightSpan,
} from './highlight.ts'

/**
 * Longest block, in source lines, this hook colours. A longer one is drawn
 * plain: the pass is bounded per turn, but its total still grows with the block,
 * and a block this long belongs to a view that draws plain text anyway.
 */
const MAX_HIGHLIGHT_LINES = 2000

/** Lines tokenized per turn of the event loop; roughly 20 ms of the shared highlighter. */
const HIGHLIGHT_CHUNK_LINES = 40

/** How long the blocks must stay unchanged before the pass starts. */
const HIGHLIGHT_PAUSE_MS = 120

/** One block's per-line runs, or undefined while that block draws plain. */
export type HighlightedBlock = readonly (readonly HighlightSpan[])[] | undefined

/** Returned while nothing is drawn, so a caller's memos keep one identity. */
const NOTHING: readonly HighlightedBlock[] = []

/**
 * Whether a block is longer than the hook's line budget. Counted rather than
 * split, so a block far over the budget costs its first lines only.
 * @param text - the block.
 * @returns whether colouring the block would overrun the hook's budget.
 */
function overHighlightBudget(text: string): boolean {
  let lines = 1
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    lines += 1
    if (lines > MAX_HIGHLIGHT_LINES) return true
  }
  return false
}

/**
 * Whether two block lists describe the same code. Values are compared, not just
 * identities, so a caller that rebuilds its array every render still gets its
 * runs; a caller that memoizes hits the identity check.
 * @param left - one list of blocks.
 * @param right - the other.
 * @returns whether every block matches by position.
 */
function sameBlocks(left: readonly string[], right: readonly string[]): boolean {
  return left === right || (left.length === right.length && left.every((block, index) => block === right[index]))
}

/**
 * Colour one or more code blocks with the shared highlighter.
 * @param blocks - the code blocks, one run list per line being produced for each.
 * @param lang - grammar hint for every block; absent or unknown draws plain.
 * @returns one entry per block: its per-line runs, or undefined while that block
 * is plain — before the pass reaches it, past the budget, or without a grammar.
 */
export function useHighlightedCode(blocks: readonly string[], lang: string | undefined): readonly HighlightedBlock[] {
  // Re-render when a lazy grammar finishes loading, so a block that drew plain
  // while its grammar imported is tokenized again. The snapshot value is opaque;
  // only its change across renders drives the pass below.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const [drawn, setDrawn] = useState<{ source: readonly string[]; runs: readonly HighlightedBlock[] } | undefined>(undefined)
  useEffect(() => {
    // A block past the budget never enters the pass; it keeps its plain entry.
    const plan = blocks.flatMap((block, index) => overHighlightBudget(block) ? [] : [{ index, lines: block.split('\n') }])
    if (plan.length === 0) return
    const runs: HighlightedBlock[] = blocks.map(() => undefined)
    const pending = plan[Symbol.iterator]()
    let current = pending.next()
    let covered = 0
    let session = new StreamingHighlightSession()
    let timer = 0
    const step = (): void => {
      if (current.done) return
      const { index, lines } = current.value
      covered = Math.min(lines.length, covered + HIGHLIGHT_CHUNK_LINES)
      const spans = session.update(lines.slice(0, covered).join('\n'), lang)
      // A grammar still importing reports nothing; its load re-runs this pass.
      if (spans === undefined) return
      if (covered < lines.length) {
        timer = window.setTimeout(step, 0)
        return
      }
      runs[index] = [...spans]
      covered = 0
      session = new StreamingHighlightSession()
      // Publish the block that just finished, so a long list colours from its
      // top instead of waiting for the whole pass.
      setDrawn({ source: blocks, runs: [...runs] })
      current = pending.next()
      // The next turn either takes the next block or finds the plan spent.
      timer = window.setTimeout(step, 0)
    }
    timer = window.setTimeout(step, HIGHLIGHT_PAUSE_MS)
    return () => { window.clearTimeout(timer) }
  }, [blocks, lang, loaded])
  return drawn !== undefined && sameBlocks(drawn.source, blocks) ? drawn.runs : NOTHING
}
