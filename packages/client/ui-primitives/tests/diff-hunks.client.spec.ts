/**
 * The durable `diffs` narrowing: every member is validated, one malformed entry
 * rejects the whole payload, and a recorded line survives as the whole-file
 * comparison's placement.
 */
import { describe, expect, it } from 'vitest'
import { narrowDiffHunks } from '../src/index.ts'

describe('narrowDiffHunks', () => {
  it('keeps a well-formed hunk, with and without a recorded line', () => {
    expect(narrowDiffHunks([{ path: 'a.ts', oldText: 'a', newText: 'b' }]))
      .toEqual([{ path: 'a.ts', oldText: 'a', newText: 'b' }])
    expect(narrowDiffHunks([{ path: 'a.ts', oldText: null, newText: 'b', newStart: 3 }]))
      .toEqual([{ path: 'a.ts', oldText: null, newText: 'b', newStart: 3 }])
    // The narrowing owns the rendered fields: a member no surface draws is dropped.
    expect(narrowDiffHunks([{ path: 'a.ts', oldText: 'a', newText: 'b', extra: 1 }]))
      .toEqual([{ path: 'a.ts', oldText: 'a', newText: 'b' }])
  })

  it('rejects an absent, empty, or non-array payload', () => {
    expect(narrowDiffHunks(undefined)).toBeNull()
    expect(narrowDiffHunks([])).toBeNull()
    expect(narrowDiffHunks('nope')).toBeNull()
  })

  it.each([
    [null],
    ['x'],
    [[[]]],
    [{ path: 1, oldText: 'a', newText: 'b' }],
    [{ path: 'a', oldText: 5, newText: 'b' }],
    [{ path: 'a', oldText: null, newText: 5 }],
    [{ path: 'a', oldText: null, newText: 'b', newStart: '1' }],
    [{ path: 'a', oldText: null, newText: 'b', newStart: 1.5 }],
    [{ path: 'a', oldText: null, newText: 'b', newStart: -1 }],
  ])('rejects a malformed entry: %j', (entry) => {
    expect(narrowDiffHunks([entry])).toBeNull()
  })
})
