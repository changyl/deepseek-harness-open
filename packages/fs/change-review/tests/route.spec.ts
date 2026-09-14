/**
 * The change-review route: a decision is recorded for the Session it names, and
 * a revert rewrites the file only while that file still holds the recorded
 * change.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { SessionEventReadRequest } from '@deepseek-ai/dsh-session-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, CHANGE_REVIEW_PATH } from '../src/index.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

const BEFORE = 'one\ntwo\nthree\nFOUR\nfive\nsix\nseven\n'
const AFTER = 'one\ntwo\nthree\nCHANGED\nfive\nsix\nseven\n'

/** The recorded change of `AFTER` against `BEFORE`, as `tool/result` metadata carries it. */
const RECORDED_META = {
  diffs: [{
    path: 'notes.txt',
    oldText: 'two\nthree\nFOUR\nfive\nsix',
    newText: 'two\nthree\nCHANGED\nfive\nsix',
    newStart: 2,
  }],
}

async function fixture(options: {
  readonly fileText?: string
  readonly meta?: unknown
  readonly eventType?: string
  /** Record the path as a directory instead of a file. */
  readonly directory?: boolean
  /** Session header cwd; absent resolves against the deployment workspace root. */
  readonly sessionCwd?: string | undefined
  /** Make the log read throw this instead of answering. */
  readonly readError?: unknown
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-change-review-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  if (options.directory === true) await mkdir(join(cwd, 'notes.txt'))
  else await writeFile(join(cwd, 'notes.txt'), options.fileText ?? AFTER)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalFileSystem, { cwd })
  ctx.provide('sandboxPolicy', { workspaceRoot: cwd } as never)
  const session = { cwd: 'sessionCwd' in options ? options.sessionCwd : cwd, append: vi.fn() }
  ctx.provide('sessions', { get: (id: string) => id === 'owner' ? session : undefined } as never)
  const readEvent = vi.fn(async (request: SessionEventReadRequest) => {
    if (options.readError !== undefined) throw options.readError
    if (request.sessionId !== 'owner') throw new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')
    if (request.seq !== 7) throw new SessionQueryError('missing', 'SESSION_QUERY_EVENT_NOT_FOUND')
    return {
      session,
      target: {
        type: options.eventType ?? 'tool/result',
        data: {
          turn: 3,
          step: 1,
          message: { role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [] },
          meta: options.meta === undefined ? RECORDED_META : options.meta,
        },
      } as unknown as SessionEvent,
    }
  })
  ctx.provide('sessionQuery', { readEvent } as never)
  const connection = new HostConnectionService(ctx, [], {} as never)
  const fiber = ctx.plugin({ inject: ['connection', 'sessionQuery', 'fs', 'sessions', 'sandboxPolicy'], apply })
  await fiber
  const handler = connection.createSharedFetchHandler('/api')
  const review = (body: unknown, signal?: AbortSignal) => handler.fetch(new Request(
    `http://localhost${CHANGE_REVIEW_PATH}`,
    { method: 'POST', body: JSON.stringify(body), signal: signal ?? null },
  ))
  const reviewRaw = (body: string) => handler.fetch(new Request(
    `http://localhost${CHANGE_REVIEW_PATH}`, { method: 'POST', body },
  ))
  return { ctx, cwd, session, review, reviewRaw, readEvent }
}

const changes = [{ seq: 7, path: 'notes.txt' }]

describe('change review route', () => {
  it('reverts the file to its pre-change content and records the decision', async () => {
    const { cwd, session, review } = await fixture()
    const response = await review({ sessionId: 'owner', action: 'reverted', changes })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ results: [{ seq: 7, path: 'notes.txt', status: 'reverted' }] })
    await expect(readFile(join(cwd, 'notes.txt'), 'utf8')).resolves.toBe(BEFORE)
    expect(session.append).toHaveBeenCalledWith('change/review', {
      turn: 3, seq: 7, path: 'notes.txt', decision: 'reverted',
    })
  })

  it('accepts a change without touching the file', async () => {
    const { cwd, session, review } = await fixture()
    const response = await review({ sessionId: 'owner', action: 'accepted', changes })
    expect(response.status).toBe(200)
    await expect(readFile(join(cwd, 'notes.txt'), 'utf8')).resolves.toBe(AFTER)
    expect(session.append).toHaveBeenCalledWith('change/review', {
      turn: 3, seq: 7, path: 'notes.txt', decision: 'accepted',
    })
  })

  it('refuses a change the file moved past, writing nothing', async () => {
    const { cwd, session, review } = await fixture({ fileText: 'one\ntwo\nthree\nEDITED\nfive\nsix\nseven\n' })
    const response = await review({ sessionId: 'owner', action: 'reverted', changes })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('mismatch') as string })
    await expect(readFile(join(cwd, 'notes.txt'), 'utf8')).resolves.toBe('one\ntwo\nthree\nEDITED\nfive\nsix\nseven\n')
    expect(session.append).not.toHaveBeenCalled()
  })

  it('refuses a revert when the result recorded no change for the path', async () => {
    const { review } = await fixture({ meta: { diffs: [] } })
    const response = await review({ sessionId: 'owner', action: 'reverted', changes })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('recorded no change') as string })
  })

  it('rejects a malformed body and a path that is not a regular file', async () => {
    const h = await fixture()
    expect((await h.reviewRaw('[]')).status).toBe(400)
    expect((await h.review({
      sessionId: 'owner',
      action: 'accepted',
      changes: Array.from({ length: 65 }, (_value, index) => ({ seq: index, path: 'notes.txt' })),
    })).status).toBe(400)
    expect((await h.review({ sessionId: 'owner', action: 'accepted', changes: [[]] })).status).toBe(400)
    expect((await h.review({ sessionId: 'owner', action: 'accepted', changes: [null] })).status).toBe(400)
    expect((await h.review({ sessionId: 'owner', action: 'accepted', changes: [{ seq: 7, path: '' }] })).status).toBe(400)
    expect((await h.review({ sessionId: 'owner', action: 'accepted', changes: [{ seq: 7.5, path: 'notes.txt' }] })).status).toBe(400)
    const directory = await fixture({ directory: true })
    expect((await directory.review({ sessionId: 'owner', action: 'reverted', changes })).status).toBe(409)
    // A header without cwd resolves the path against the deployment root.
    const noCwd = await fixture({ sessionCwd: undefined })
    expect((await noCwd.review({ sessionId: 'owner', action: 'reverted', changes })).status).toBe(200)
  })

  it('answers a change the log no longer holds, and an errored read, as missing', async () => {
    const h = await fixture()
    expect((await h.review({ sessionId: 'owner', action: 'reverted', changes: [{ seq: 9, path: 'notes.txt' }] })).status).toBe(404)
    const enoent = await fixture({ readError: Object.assign(new Error('gone'), { code: 'ENOENT' }) })
    expect((await enoent.review({ sessionId: 'owner', action: 'reverted', changes })).status).toBe(404)
    const other = await fixture({ readError: new Error('boom') })
    expect((await other.review({ sessionId: 'owner', action: 'reverted', changes })).status).toBe(500)
    const thrown = await fixture({ readError: 'not an error' })
    expect((await thrown.review({ sessionId: 'owner', action: 'reverted', changes })).status).toBe(500)
  })

  it('reports a concurrent write as a stale file rather than overwriting it', async () => {
    // Two changes to one file: the first write moves the version the second
    // change was resolved against, which is exactly the race the CAS loses.
    const h = await fixture()
    const response = await h.review({
      sessionId: 'owner',
      action: 'reverted',
      changes: [{ seq: 7, path: 'notes.txt' }, { seq: 7, path: 'notes.txt' }],
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'A file changed while the request was being applied.',
    })
  })

  it('refuses a seq that is not a tool result, an unattached Session, and a malformed body', async () => {
    const { review } = await fixture({ eventType: 'turn/end' })
    expect((await review({ sessionId: 'owner', action: 'reverted', changes })).status).toBe(409)
    const other = await fixture()
    expect((await other.review({ sessionId: 'someone-else', action: 'reverted', changes })).status).toBe(409)
    expect((await other.review({ sessionId: 'owner', action: 'maybe', changes })).status).toBe(400)
    expect((await other.review({ sessionId: '', action: 'reverted', changes })).status).toBe(400)
    expect((await other.review({ sessionId: 'owner', action: 'reverted', changes: [] })).status).toBe(400)
    expect((await other.review({ sessionId: 'owner', action: 'reverted', changes: [{ seq: -1, path: 'notes.txt' }] })).status).toBe(400)
    expect((await other.reviewRaw('not json')).status).toBe(400)
  })
})
