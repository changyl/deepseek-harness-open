/**
 * The change index a preview reads: entries answer at the file address the
 * preview tab is keyed by, and a withdrawn row takes back exactly its own.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { SessionFileChangeIndex } from '../src/client/file-changes.ts'

/** One published change, addressed the way the turn-tail row addresses it. */
const change = (path: string, seq: number, newText: string) => ({
  address: fileAddressFor('session', '/work', path),
  seq,
  diffs: [{ path, oldText: 'before', newText }],
  turn: 1,
})

it('answers a published change at the address its path resolves to', () => {
  const index = new SessionFileChangeIndex()
  const address = fileAddressFor('session', '/work', 'src/app.ts')
  // An absolute path inside the workspace names the same file as its relative spelling.
  index.publish([change('src/app.ts', 5, 'after'), change('/work/src/app.ts', 7, 'later')])
  expect(address).toBe('dsh-resource://file/session/session/src/app.ts')
  expect(index.hunksFor(address, 5)).toEqual([{ path: 'src/app.ts', oldText: 'before', newText: 'after' }])
  expect(index.hunksFor(address, 7)).toEqual([{ path: '/work/src/app.ts', oldText: 'before', newText: 'later' }])
  // An address or seq nothing published is not a failure: the caller shows the file.
  expect(index.hunksFor(address, 6)).toBeUndefined()
  expect(index.hunksFor('dsh-resource://file/session/session/other.ts', 5)).toBeUndefined()
})

it('withdraws exactly the entries one publication recorded', () => {
  const index = new SessionFileChangeIndex()
  const first = fileAddressFor('session', '/work', 'a.ts')
  const second = fileAddressFor('session', '/work', 'b.ts')
  index.publish([change('a.ts', 5, 'one')])
  const withdraw = index.publish([change('a.ts', 7, 'two'), change('b.ts', 7, 'two')])
  expect(index.hunksFor(second, 7)).toBeDefined()
  withdraw()
  // The earlier change to `a.ts` survives the later publication's withdrawal.
  expect(index.hunksFor(first, 7)).toBeUndefined()
  expect(index.hunksFor(first, 5)).toEqual([{ path: 'a.ts', oldText: 'before', newText: 'one' }])
  expect(index.hunksFor(second, 7)).toBeUndefined()
})

it('answers the last change recorded for a file whichever row recorded it', () => {
  const index = new SessionFileChangeIndex()
  const address = fileAddressFor('session', '/work', 'a.ts')
  expect(index.latestFor(address)).toBeUndefined()
  expect(index.latestFor(fileAddressFor('session', '/work', 'never-recorded.ts'))).toBeUndefined()
  // Publication order is not seq order: a row that mounts later can record an
  // earlier change, and the later change still wins.
  index.publish([change('a.ts', 9, 'newest')])
  index.publish([change('a.ts', 4, 'older')])
  expect(index.latestFor(address)).toEqual(change('a.ts', 9, 'newest'))
})

it('walks one Turn\'s changes in published order and stops at its ends', () => {
  const index = new SessionFileChangeIndex()
  const a = fileAddressFor('session', '/work', 'a.ts')
  const b = fileAddressFor('session', '/work', 'b.ts')
  const one = { ...change('a.ts', 5, 'one'), turn: 2 }
  const two = { ...change('b.ts', 7, 'two'), turn: 2 }
  const withdraw = index.publish([one, two])
  expect(index.neighbourChange(a, 5, 'next')).toEqual(two)
  expect(index.neighbourChange(b, 7, 'previous')).toEqual(one)
  expect(index.neighbourChange(a, 5, 'previous')).toBeUndefined()
  expect(index.neighbourChange(b, 7, 'next')).toBeUndefined()
  // Another Turn's change is not a neighbour, and a withdrawn one leaves the walk.
  index.publish([{ ...change('c.ts', 9, 'three'), turn: 3 }])
  expect(index.neighbourChange(b, 7, 'next')).toBeUndefined()
  withdraw()
  expect(index.neighbourChange(a, 5, 'next')).toBeUndefined()
})

it('replaces a republished change in its Turn, and forgets a withdrawn one', () => {
  const index = new SessionFileChangeIndex()
  const a = fileAddressFor('session', '/work', 'a.ts')
  const b = fileAddressFor('session', '/work', 'b.ts')
  const first = { ...change('a.ts', 5, 'one'), turn: 2 }
  index.publish([first, { ...change('b.ts', 7, 'two'), turn: 2 }])
  // A row that re-renders with a richer diff replaces its own entry, not a copy.
  const richer = { ...first, diffs: [{ path: 'a.ts', oldText: 'one', newText: 'ONE' }] }
  index.publish([richer])
  expect(index.neighbourChange(a, 5, 'next')?.seq).toBe(7)
  expect(index.hunkRange(a, 5)).toEqual({ before: 0, total: 2 })
  // Withdrawing one of a Turn's two changes keeps the other walkable.
  const withdrawSecond = index.publish([])
  withdrawSecond()
  expect(index.neighbourChange(a, 5, 'next')?.seq).toBe(7)
  expect(index.neighbourChange(b, 7, 'previous')?.seq).toBe(5)
  // An unknown change has no neighbours and no range.
  expect(index.neighbourChange(fileAddressFor('session', '/work', 'gone.ts'), 1, 'next')).toBeUndefined()
  expect(index.hunkRange(fileAddressFor('session', '/work', 'gone.ts'), 1)).toBeUndefined()
})

it('takes a withdrawn publication twice without touching another Turn', () => {
  const index = new SessionFileChangeIndex()
  const a = fileAddressFor('session', '/work', 'a.ts')
  const b = fileAddressFor('session', '/work', 'b.ts')
  index.publish([{ ...change('b.ts', 9, 'three'), turn: 3 }])
  const withdraw = index.publish([{ ...change('a.ts', 5, 'one'), turn: 2 }])
  withdraw()
  // Disposing again finds neither the change nor its Turn entry.
  withdraw()
  expect(index.hunkRange(a, 5)).toBeUndefined()
  // The other Turn still walks.
  expect(index.hunkRange(b, 9)).toEqual({ before: 0, total: 1 })
})

it('counts the regions before a change and the whole Turn', () => {
  const index = new SessionFileChangeIndex()
  const a = fileAddressFor('session', '/work', 'a.ts')
  const b = fileAddressFor('session', '/work', 'b.ts')
  const scattered = {
    ...change('a.ts', 5, 'one'),
    turn: 2,
    diffs: [
      { path: 'a.ts', oldText: 'x', newText: 'X' },
      { path: 'a.ts', oldText: 'y', newText: 'Y' },
    ],
  }
  const withdraw = index.publish([scattered, { ...change('b.ts', 7, 'two'), turn: 2 }])
  expect(index.hunkRange(a, 5)).toEqual({ before: 0, total: 3 })
  expect(index.hunkRange(b, 7)).toEqual({ before: 2, total: 3 })
  expect(index.hunkRange(a, 9)).toBeUndefined()
  withdraw()
  expect(index.hunkRange(a, 5)).toBeUndefined()
})

/** Script the review route's answer. */
function respond(response: Response | Error): ReturnType<typeof vi.fn> {
  const mock = vi.fn(() => response instanceof Error ? Promise.reject(response) : Promise.resolve(response))
  vi.stubGlobal('fetch', mock)
  return mock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('records the decisions a rendered Turn published, and withdraws exactly its own', () => {
  const index = new SessionFileChangeIndex()
  const address = fileAddressFor('session', '/work', 'a.ts')
  expect(index.reviewOf(address, 5)).toBeUndefined()
  index.publishReviews([{ address, seq: 5, decision: 'reverted' }])
  const withdraw = index.publishReviews([
    { address, seq: 7, decision: 'accepted' },
    { address: fileAddressFor('session', '/work', 'b.ts'), seq: 7, decision: 'accepted' },
  ])
  expect(index.reviewOf(address, 5)).toBe('reverted')
  expect(index.reviewOf(address, 7)).toBe('accepted')
  withdraw()
  expect(index.reviewOf(address, 7)).toBeUndefined()
  expect(index.reviewOf(address, 5)).toBe('reverted')
})

it('posts one decision and reports what the host answered', async () => {
  const index = new SessionFileChangeIndex()
  const changes = [{ seq: 5, path: 'a.ts' }]
  const ok = respond(Response.json({ results: [] }))
  await expect(index.review('session', 'reverted', changes)).resolves.toBeUndefined()
  expect(ok).toHaveBeenCalledWith('/api/change.review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session', action: 'reverted', changes }),
  })
  respond(Response.json({ error: 'a.ts changed after seq 5.' }, { status: 409 }))
  await expect(index.review('session', 'reverted', changes)).resolves.toBe('a.ts changed after seq 5.')
  respond(new Response('nope', { status: 500 }))
  await expect(index.review('session', 'reverted', changes)).resolves.toBe('Change review failed with status 500.')
  respond(Response.json({ error: '' }, { status: 409 }))
  await expect(index.review('session', 'accepted', changes)).resolves.toBe('Change review failed with status 409.')
  respond(new Error('offline'))
  await expect(index.review('session', 'accepted', changes)).resolves.toBe('Change review could not reach the host.')
})

it('falls back to the earlier change once the last one is withdrawn', () => {
  const index = new SessionFileChangeIndex()
  const address = fileAddressFor('session', '/work', 'a.ts')
  index.publish([change('a.ts', 5, 'one')])
  const withdraw = index.publish([change('a.ts', 7, 'two')])
  expect(index.latestFor(address)).toEqual(change('a.ts', 7, 'two'))
  withdraw()
  expect(index.latestFor(address)).toEqual(change('a.ts', 5, 'one'))
})
