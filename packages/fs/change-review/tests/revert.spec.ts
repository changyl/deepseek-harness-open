/**
 * The pure half of a revert: a recorded hunk is undone only where the file
 * still holds the text the change produced, and a file that moved on is
 * reported rather than rewritten.
 */
import { describe, expect, it } from 'vitest'
import { hunksForPath, revertText, type RecordedHunk } from '../src/index.ts'

const file = (lines: readonly string[], trailing = true): string =>
  `${lines.join('\n')}${trailing ? '\n' : ''}`

describe('revertText', () => {
  it('restores the lines a recorded hunk replaced', () => {
    const hunks: RecordedHunk[] = [{
      path: 'a.ts',
      oldText: 'b\nc\nOLD',
      newText: 'b\nc\nNEW',
      newStart: 2,
    }]
    const reverted = revertText(file(['a', 'b', 'c', 'NEW', 'e']), hunks)
    expect(reverted).toEqual({ ok: true, value: { text: file(['a', 'b', 'c', 'OLD', 'e']) } })
  })

  it('undoes scattered hunks from the last to the first', () => {
    const hunks: RecordedHunk[] = [
      { path: 'a.ts', oldText: 'one', newText: 'ONE', newStart: 1 },
      { path: 'a.ts', oldText: 'nine', newText: 'NINE', newStart: 9 },
    ]
    const reverted = revertText(
      file(['ONE', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'NINE', 'ten']),
      hunks,
    )
    expect(reverted).toEqual({
      ok: true,
      value: { text: file(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']) },
    })
  })

  it('places a hunk that records no line by its own unique text', () => {
    const hunks: RecordedHunk[] = [{ path: 'a.ts', oldText: 'b\nc\nOLD', newText: 'b\nc\nNEW' }]
    const reverted = revertText(file(['a', 'b', 'c', 'NEW', 'e']), hunks)
    expect(reverted).toEqual({ ok: true, value: { text: file(['a', 'b', 'c', 'OLD', 'e']) } })
  })

  it('puts a deleted region back at its recorded line', () => {
    const hunks: RecordedHunk[] = [{ path: 'a.ts', oldText: 'gone', newText: '', newStart: 2 }]
    const reverted = revertText(file(['a', 'b']), hunks)
    expect(reverted).toEqual({ ok: true, value: { text: file(['a', 'gone', 'b']) } })
  })

  it('keeps a file that never ended with a newline that way', () => {
    const hunks: RecordedHunk[] = [{ path: 'a.ts', oldText: 'OLD', newText: 'NEW', newStart: 2 }]
    const reverted = revertText(file(['a', 'NEW'], false), hunks)
    expect(reverted).toEqual({ ok: true, value: { text: 'a\nOLD' } })
  })

  it('refuses a change the file no longer holds', () => {
    const hunks: RecordedHunk[] = [{ path: 'a.ts', oldText: 'OLD', newText: 'NEW', newStart: 2 }]
    expect(revertText(file(['a', 'edited']), hunks))
      .toEqual({ ok: false, failure: { reason: 'mismatch', hunkIndex: 0 } })
  })

  it('refuses a hunk whose text is absent or appears twice', () => {
    expect(revertText(file(['a']), [{ path: 'a.ts', oldText: 'x', newText: 'NOWHERE' }]))
      .toEqual({ ok: false, failure: { reason: 'unplaceable', hunkIndex: 0 } })
    expect(revertText(file(['dup', 'mid', 'dup']), [{ path: 'a.ts', oldText: 'x', newText: 'dup' }]))
      .toEqual({ ok: false, failure: { reason: 'unplaceable', hunkIndex: 0 } })
    expect(revertText(file(['a']), [{ path: 'a.ts', oldText: 'gone', newText: '' }]))
      .toEqual({ ok: false, failure: { reason: 'unplaceable', hunkIndex: 0 } })
  })

  it('restores an emptied file when the change added every line it has', () => {
    const hunks: RecordedHunk[] = [{ path: 'a.ts', oldText: null, newText: 'fresh', newStart: 1 }]
    expect(revertText(file(['fresh']), hunks)).toEqual({ ok: true, value: { text: '' } })
    expect(revertText('', hunks)).toEqual({ ok: false, failure: { reason: 'mismatch', hunkIndex: 0 } })
  })

  it('refuses hunks whose recorded lines are out of order', () => {
    const hunks: RecordedHunk[] = [
      { path: 'a.ts', oldText: 'one', newText: 'ONE', newStart: 3 },
      { path: 'a.ts', oldText: 'two', newText: 'TWO', newStart: 1 },
    ]
    expect(revertText(file(['TWO', 'two', 'ONE']), hunks))
      .toEqual({ ok: false, failure: { reason: 'mismatch', hunkIndex: 1 } })
  })

  it('refuses a result that recorded no hunk for the path', () => {
    expect(revertText(file(['a']), []))
      .toEqual({ ok: false, failure: { reason: 'no-hunks' } })
  })
})

describe('hunksForPath', () => {
  it('keeps only the named path, in recorded order', () => {
    const hunks: RecordedHunk[] = [
      { path: 'a.ts', oldText: 'a', newText: 'A' },
      { path: 'b.ts', oldText: 'b', newText: 'B' },
      { path: 'a.ts', oldText: 'c', newText: 'C' },
    ]
    expect(hunksForPath(hunks, 'a.ts').map(hunk => hunk.newText)).toEqual(['A', 'C'])
    expect(hunksForPath(hunks, 'missing.ts')).toEqual([])
  })
})
