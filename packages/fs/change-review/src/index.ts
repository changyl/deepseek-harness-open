/**
 * Change review: a reader's decision about a change a tool already applied.
 *
 * `accepted` records that the change stays; `reverted` restores the file's
 * content from before that change and records that too. Both decisions are
 * durable session events, so a reload or a fork reconstructs them. A revert is
 * verified against the file before anything is written: a hunk whose text is no
 * longer where the change put it fails the whole request instead of rewriting
 * the wrong lines.
 *
 * The route rides Connection's authentication fence, like `present.open`. A
 * request names changes by `tool/result` seq and path only — every byte written
 * is re-derived from the session log, so a client cannot ask this plugin to
 * write text of its own choosing.
 * @module @deepseek-ai/dsh-change-review
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { hunksForPath, revertText } from './revert.ts'
import {
  recordedHunks, type ChangeCoordinates, type ChangeReviewDecision, type ChangeReviewRequest,
  type ChangeReviewResult,
} from './types.ts'

export type {
  ChangeCoordinates, ChangeReviewDecision, ChangeReviewRequest, ChangeReviewResponse,
  ChangeReviewResult, RecordedHunk,
} from './types.ts'
export { recordedHunks } from './types.ts'
export { hunksForPath, revertText, type RevertFailure, type RevertFailureReason, type RevertedText } from './revert.ts'

/** Route the Web client posts a review decision to. */
export const CHANGE_REVIEW_PATH = '/api/change.review'

/** Most changes one request may decide, so one gesture cannot fan out without bound. */
const MAX_CHANGES = 64

/** Services this plugin reads. */
export const inject = ['connection', 'sessionQuery', 'fs', 'sessions', 'sandboxPolicy']

/** One requested change resolved from the log: its turn, and its verified revert when there is one. */
interface ResolvedChange {
  readonly change: ChangeCoordinates
  readonly turn: number
  readonly plan?: {
    readonly target: FsTarget
    readonly version: FsVersion
    readonly text: string
  }
}

/**
 * Register the review route for the lifetime of `ctx`.
 * @param ctx - connection, session, and filesystem services.
 */
export function apply(ctx: Context): void {
  ctx.connection.fetch.register({
    path: CHANGE_REVIEW_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleReview(ctx, request),
  })
}

/** One refusal body: the reason plus whatever the request had already resolved. */
function refusal(reason: string, status: number, results: readonly ChangeReviewResult[]): Response {
  return Response.json({ error: reason, results }, { status, headers: { 'cache-control': 'no-store' } })
}

/** Narrow an untrusted body to a review request, or null when it is not one. */
function parseRequest(body: unknown): ChangeReviewRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const { sessionId, action, changes } = body as Record<string, unknown>
  if (typeof sessionId !== 'string' || sessionId === '') return null
  if (action !== 'accepted' && action !== 'reverted') return null
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) return null
  const parsed: ChangeCoordinates[] = []
  for (const change of changes) {
    if (typeof change !== 'object' || change === null || Array.isArray(change)) return null
    const { seq, path } = change as Record<string, unknown>
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null
    if (typeof path !== 'string' || path === '') return null
    parsed.push({ seq, path })
  }
  return { sessionId, action, changes: parsed }
}

/**
 * Resolve one change: the turn it belongs to, and its verified revert text when
 * the decision restores the file.
 * @param ctx - filesystem and session services.
 * @param request - the reviewed request, already parsed.
 * @param change - the change to resolve.
 * @param signal - request cancellation.
 * @returns the resolved change, or the reason it cannot be decided here.
 */
async function resolveChange(
  ctx: Context,
  request: ChangeReviewRequest,
  change: ChangeCoordinates,
  signal: AbortSignal,
): Promise<ResolvedChange | string> {
  const { target: event, session } = await ctx.sessionQuery.readEvent({
    sessionId: request.sessionId as SessionId,
    seq: change.seq as SessionSeq,
    before: 0,
    after: 0,
  }, signal)
  if (event.type !== 'tool/result') return `Seq ${String(change.seq)} is not a tool result.`
  const turn = event.data.turn
  if (request.action === 'accepted') return { change, turn }
  const hunks = hunksForPath(recordedHunks(event.data.meta) ?? [], change.path)
  if (hunks.length === 0) return `Seq ${String(change.seq)} recorded no change to ${change.path}.`
  const target = await ctx.fs.resolve(change.path, {
    cwd: session.cwd ?? ctx.sandboxPolicy.workspaceRoot,
    signal,
  })
  const info = await ctx.fs.stat(target, signal)
  if (info === undefined || info.type !== 'file') return `${change.path} is no longer a regular file.`
  const reverted = revertText(await ctx.fs.readText(target, signal), hunks)
  if (!reverted.ok) {
    return `${change.path} changed after seq ${String(change.seq)} (${reverted.failure.reason}), `
      + 'so reverting it here would rewrite the wrong lines.'
  }
  return { change, turn, plan: { target, version: info.version, text: reverted.value.text } }
}

/** Record one decision on the session it belongs to. */
function record(session: Session, resolved: ResolvedChange, decision: ChangeReviewDecision): void {
  session.append('change/review', {
    turn: resolved.turn,
    seq: resolved.change.seq,
    path: resolved.change.path,
    decision,
  })
}

async function handleReview(ctx: Context, request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return refusal('Change-review requests must be JSON.', 400, [])
  }
  const parsed = parseRequest(body)
  if (parsed === null) return refusal('Invalid change-review request.', 400, [])

  const session = ctx.sessions.get(parsed.sessionId as SessionId)
  if (session === undefined) {
    return refusal('This Session is not attached, so a decision cannot be recorded in it.', 409, [])
  }

  const results: ChangeReviewResult[] = []
  try {
    // Resolve and verify every change before writing anything, so a request the
    // file no longer allows leaves the workspace exactly as it was.
    const resolved: ResolvedChange[] = []
    for (const change of parsed.changes) {
      request.signal.throwIfAborted()
      const outcome = await resolveChange(ctx, parsed, change, request.signal)
      if (typeof outcome === 'string') return refusal(outcome, 409, results)
      resolved.push(outcome)
    }
    for (const item of resolved) {
      request.signal.throwIfAborted()
      if (item.plan !== undefined) {
        await ctx.fs.writeText(
          item.plan.target,
          item.plan.text,
          { kind: 'replaceIfVersion', version: item.plan.version },
          request.signal,
        )
      }
      record(session, item, parsed.action)
      results.push({
        seq: item.change.seq,
        path: item.change.path,
        status: parsed.action,
      })
    }
    return Response.json({ results }, { headers: { 'cache-control': 'no-store' } })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    const remote = remoteErrorOf(error)
    const missing = remote?.code === 'session/not-found'
      || error instanceof Error && 'code' in error
      && (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || error.code === 'SESSION_QUERY_EVENT_NOT_FOUND'
        || error.code === 'ENOENT')
    if (missing) return refusal('The recorded change is no longer available.', 404, results)
    const stale = error instanceof Error && 'code' in error && error.code === 'FS_STALE_VERSION'
    if (stale) return refusal('A file changed while the request was being applied.', 409, results)
    return refusal(error instanceof Error ? error.message : 'Change review failed.', 500, results)
  }
}
