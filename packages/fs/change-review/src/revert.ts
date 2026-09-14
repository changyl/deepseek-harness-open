/**
 * Reverse-apply recorded hunks: the pure half of a revert.
 *
 * A revert is exact rather than reconstructed: every hunk names the text the
 * change produced, so the file is rewritten only when it still contains that
 * text where the hunk says it is. A file edited again after the change fails
 * verification and the caller reports it instead of guessing.
 * @module @deepseek-ai/dsh-change-review/revert
 */

import type { RecordedHunk } from './types.ts'

/** Why one revert could not be computed. */
export type RevertFailureReason =
  /** The result recorded no hunk for this path, so there is nothing to undo. */
  | 'no-hunks'
  /** A hunk without a recorded line does not appear once in the file. */
  | 'unplaceable'
  /** The file no longer holds the text the recorded change produced. */
  | 'mismatch'

/** One failed revert, naming the hunk that failed when a hunk caused it. */
export interface RevertFailure {
  readonly reason: RevertFailureReason
  readonly hunkIndex?: number
}

/** A computed revert: the file's content from before the change. */
export interface RevertedText {
  readonly text: string
}

/** One hunk's verified place in the file: where it starts and what replaces it. */
interface Placement {
  readonly start: number
  readonly covered: number
  readonly replacement: readonly string[]
}

/**
 * Split a side's text into content lines. Empty text is zero lines and a single
 * trailing newline is a terminator rather than an extra empty line, matching the
 * rule the recorded hunks were built with.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/** Rejoin lines under the file's own terminator rule. */
function joinLines(lines: readonly string[], trailingNewline: boolean): string {
  if (lines.length === 0) return ''
  return `${lines.join('\n')}${trailingNewline ? '\n' : ''}`
}

/**
 * The one place a hunk's lines occupy at or after `from`, or null when they sit
 * nowhere there or in more than one place.
 * @param fileLines - the file's lines, one entry per line.
 * @param covered - the hunk's produced lines, in order.
 * @param from - the first line the search may start on.
 * @returns the 0-based start line, or null when the text is absent or ambiguous.
 */
function locateHunk(fileLines: readonly string[], covered: readonly string[], from: number): number | null {
  if (covered.length === 0) return null
  let found: number | null = null
  for (let start = from; start + covered.length <= fileLines.length; start += 1) {
    if (!covered.every((line, offset) => fileLines[start + offset] === line)) continue
    // A second occurrence makes the placement a guess, so neither is used.
    if (found !== null) return null
    found = start
  }
  return found
}

/**
 * Compute the content a file had before one recorded change.
 *
 * Every hunk is placed and verified before anything is spliced, so a failure
 * leaves the input untouched and reports which hunk failed. Hunks are spliced
 * from the last to the first, which keeps earlier positions valid.
 * @param fileText - the file's current content.
 * @param hunks - the recorded hunks of one path, in file order.
 * @returns the restored content, or the reason the change cannot be undone here.
 */
export function revertText(
  fileText: string,
  hunks: readonly RecordedHunk[],
): { ok: true; value: RevertedText } | { ok: false; failure: RevertFailure } {
  if (hunks.length === 0) return { ok: false, failure: { reason: 'no-hunks' } }
  const trailingNewline = fileText.endsWith('\n')
  const fileLines = contentLines(fileText)
  const placements: Placement[] = []
  let cursor = 0
  for (const [hunkIndex, hunk] of hunks.entries()) {
    const covered = contentLines(hunk.newText)
    const { newStart } = hunk
    const start = newStart === undefined ? locateHunk(fileLines, covered, cursor) : newStart - 1
    if (start === null) return { ok: false, failure: { reason: 'unplaceable', hunkIndex } }
    if (start < cursor || start + covered.length > fileLines.length) {
      return { ok: false, failure: { reason: 'mismatch', hunkIndex } }
    }
    if (covered.some((line, offset) => fileLines[start + offset] !== line)) {
      return { ok: false, failure: { reason: 'mismatch', hunkIndex } }
    }
    placements.push({ start, covered: covered.length, replacement: contentLines(hunk.oldText ?? '') })
    cursor = start + covered.length
  }
  const restored = [...fileLines]
  for (const placement of placements.reverse()) {
    restored.splice(placement.start, placement.covered, ...placement.replacement)
  }
  return { ok: true, value: { text: joinLines(restored, trailingNewline) } }
}

/**
 * The recorded hunks of one path, in the order they were applied.
 * @param hunks - every hunk a result recorded.
 * @param path - the path being reviewed.
 * @returns the path's hunks, or an empty list when the result recorded none for it.
 */
export function hunksForPath(hunks: readonly RecordedHunk[], path: string): RecordedHunk[] {
  return hunks.filter(hunk => hunk.path === path)
}
