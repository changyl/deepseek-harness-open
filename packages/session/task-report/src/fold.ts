/**
 * Pure fold behind one task report: given a session log and one closed turn, it
 * extracts the request that opened the turn, the closing assistant text, the
 * files the turn changed (from the hunks `write`/`edit` record on their
 * results, plus the create a `write` result reports without hunks), and the
 * verification commands the turn ran with the outcome their rendered results
 * reported.
 *
 * Nothing here reads the filesystem, the workspace, or the model: the fold is a
 * function of the log window only, so the same log always yields the same
 * report.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TaskReportChange, TaskReportVerification } from './types.ts'

/** One model-visible content block, as the Session's own message types declare it. */
type ContentBlock = SessionEvent<'tool/result'>['data']['message']['content'][number]

/** Bounds and matching rules one fold run applies. */
export interface TaskReportFoldOptions {
  /** The closed turn to report on. */
  readonly turn: number
  /** Case-insensitive substrings that mark a shell command as verification. */
  readonly verifyPatterns: readonly string[]
  /** Maximum characters kept from the request and the closing summary. */
  readonly maxTextLength: number
  /** Maximum changed files kept, in first-seen order. */
  readonly maxChanges: number
  /** Maximum verification commands kept, in the order they ran. */
  readonly maxVerifications: number
}

/** What one turn's log window contributes to a report. */
export interface TaskReportFoldResult {
  /** How the turn ended, as `turn/end` recorded it. */
  readonly reason: string
  /** The turn's opening user request, bounded. */
  readonly request?: string
  /** The turn's closing assistant text, bounded. */
  readonly summary?: string
  readonly changes: readonly TaskReportChange[]
  readonly verification: readonly TaskReportVerification[]
}

/**
 * What one recorded tool call contributes: the shell command line a `bash` call
 * prepared, or the text a `write` call supplied as its whole file.
 */
interface RecordedCall {
  /** The command line of a `bash` call. */
  readonly command?: string
  /** The `content` argument of a `write` call: the whole text of a create. */
  readonly newText?: string
}

/** One recorded applied hunk, as `write`/`edit` persist it on a tool result. */
interface RecordedHunk {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

/**
 * Fold one turn's log window into its report contribution.
 * @param events - the session's complete event list, ascending by seq.
 * @param inheritedEventCount - events before this offset belong to a fork seed
 * and never describe a turn this session ran.
 * @param options - turn number, verification patterns, and bounds.
 * @returns the fold result; empty change and verification lists mean the turn
 * has nothing to report.
 */
export function foldTaskReport(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  options: TaskReportFoldOptions,
): TaskReportFoldResult {
  const window = turnWindow(events, inheritedEventCount, options.turn)
  const calls = new Map<string, RecordedCall>()
  const changes = new Map<string, TaskReportChange>()
  const verification: TaskReportVerification[] = []
  let reason = 'completed'
  let request: string | undefined

  for (const event of window) {
    switch (event.type) {
      case 'turn/end':
        reason = event.data.reason.kind
        break
      case 'user/message':
        if (request === undefined && event.data.source.kind === 'user') {
          const text = messageText(event.data.content)
          if (text !== undefined) request = bound(text, options.maxTextLength)
        }
        break
      case 'tool/call': {
        const call = recordedCall(event)
        if (call !== undefined) calls.set(event.data.callId, call)
        break
      }
      case 'tool/result': {
        recordChanges(changes, event, calls, options.maxChanges)
        const command = calls.get(event.data.message.toolCallId)?.command
        if (command !== undefined && matchesVerifyPattern(command, options.verifyPatterns)) {
          if (verification.length < options.maxVerifications) {
            verification.push(verificationOf(command, event))
          }
        }
        break
      }
      default:
        break
    }
  }

  const summary = closingText(window, options.maxTextLength)

  return {
    reason,
    ...(request === undefined ? {} : { request }),
    ...(summary === undefined ? {} : { summary }),
    changes: [...changes.values()],
    verification,
  }
}

/** The events of one turn: from its `turn/start` through its `turn/end`, inclusive. */
function turnWindow(
  events: readonly SessionEvent[],
  inheritedEventCount: number,
  turn: number,
): readonly SessionEvent[] {
  const start = events.findIndex((event, index) => index >= inheritedEventCount
    && event.type === 'turn/start'
    && event.data.turn === turn)
  if (start === -1) return []
  const end = events.findIndex((event, index) => index >= start
    && event.type === 'turn/end'
    && event.data.turn === turn)
  return end === -1 ? [] : events.slice(start, end + 1)
}

/** The turn's closing assistant text: its last non-empty assistant message. */
function closingText(window: readonly SessionEvent[], limit: number): string | undefined {
  for (const event of [...window].reverse()) {
    if (event.type !== 'assistant/message') continue
    const text = messageText(event.data.message.content)
    if (text !== undefined) return bound(text, limit)
  }
  return undefined
}

/** Join the text blocks of one message, ignoring every other block kind. */
function messageText(content: readonly ContentBlock[]): string | undefined {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
  }
  const text = parts.join('\n').trim()
  return text === '' ? undefined : text
}

/** Bound one already-trimmed, non-empty text value. */
function bound(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/**
 * What one tool call contributes to the fold: a `bash` command line that may
 * count as verification, or the whole text a `write` supplied.
 * @param event - one logged tool call.
 * @returns the call's contribution, or undefined for a call this fold does not read.
 */
function recordedCall(event: SessionEvent<'tool/call'>): RecordedCall | undefined {
  const args = callArguments(event)
  if (args === undefined) return undefined
  if (event.data.name === 'bash') {
    if (typeof args.command !== 'string') return undefined
    const command = args.command.trim()
    return command === '' ? undefined : { command }
  }
  if (event.data.name === 'write') {
    return typeof args.content === 'string' ? { newText: args.content } : undefined
  }
  return undefined
}

/** One call's raw argument JSON as a plain object, or undefined when it is not one. */
function callArguments(event: SessionEvent<'tool/call'>): Record<string, unknown> | undefined {
  try {
    const args: unknown = JSON.parse(event.data.arguments)
    return isRecord(args) ? args : undefined
  } catch {
    // Swallows a non-JSON argument string only: the loop logs the model's raw
    // text, so a malformed call describes no command and contributes nothing.
    return undefined
  }
}

/**
 * Record the file changes one tool result reported, keeping first-seen path order.
 * @param changes - accumulated changes, keyed by path.
 * @param event - the logged tool result.
 * @param calls - calls recorded before this result, keyed by call id.
 * @param limit - maximum distinct paths kept.
 */
function recordChanges(
  changes: Map<string, TaskReportChange>,
  event: SessionEvent<'tool/result'>,
  calls: ReadonlyMap<string, RecordedCall>,
  limit: number,
): void {
  const meta = event.data.meta
  const operation = recordedOperation(meta)
  const hunks = recordedHunks(meta)
  for (const hunk of hunks) {
    record(changes, {
      path: hunk.path,
      // The producer's own operation wins; without one, a hunk with no previous
      // text is how a whole-file create reaches the fold.
      kind: operation ?? (hunk.oldText === null ? 'create' : 'update'),
      added: lineCount(hunk.newText),
      removed: hunk.oldText === null ? 0 : lineCount(hunk.oldText),
    }, limit)
  }
  if (hunks.length > 0) return
  // A create carries no hunk of its own: `write` reports the operation and the
  // canonical path while the written text stays in its call arguments.
  if (operation !== 'create') return
  const path = recordedPath(meta)
  if (path === undefined) return
  const written = calls.get(event.data.message.toolCallId)?.newText
  record(changes, {
    path,
    kind: 'create',
    added: written === undefined ? 0 : lineCount(written),
    removed: 0,
  }, limit)
}

/**
 * Record one change under its path.
 *
 * A repeated path keeps its first position and its latest values; a new path
 * past the limit is dropped.
 * @param changes - accumulated changes, keyed by path.
 * @param change - the change to record.
 * @param limit - maximum distinct paths kept.
 */
function record(changes: Map<string, TaskReportChange>, change: TaskReportChange, limit: number): void {
  if (!changes.has(change.path) && changes.size >= limit) return
  changes.set(change.path, change)
}

/**
 * The applied hunks a tool result recorded.
 * @param meta - the result's opaque presentation metadata.
 * @returns the valid hunks; a malformed payload contributes nothing.
 */
function recordedHunks(meta: unknown): readonly RecordedHunk[] {
  if (!isRecord(meta) || !Array.isArray(meta.diffs)) return []
  const hunks: RecordedHunk[] = []
  for (const entry of meta.diffs as readonly unknown[]) {
    if (!isRecord(entry)) continue
    if (typeof entry.path !== 'string' || typeof entry.newText !== 'string') continue
    if (entry.oldText !== null && typeof entry.oldText !== 'string') continue
    hunks.push({ path: entry.path, oldText: entry.oldText, newText: entry.newText })
  }
  return hunks
}

/** The mutation operation one result's metadata reported, when it is a known one. */
function recordedOperation(meta: unknown): 'create' | 'update' | undefined {
  if (!isRecord(meta)) return undefined
  const operation = meta.operation
  return operation === 'create' || operation === 'update' ? operation : undefined
}

/** The path one result's metadata reported, for a change that has no hunk of its own. */
function recordedPath(meta: unknown): string | undefined {
  if (!isRecord(meta)) return undefined
  const path = meta.path
  return typeof path === 'string' && path !== '' ? path : undefined
}

/** Whether one command line matches the configured verification patterns. */
function matchesVerifyPattern(command: string, patterns: readonly string[]): boolean {
  const lowered = command.toLowerCase()
  return patterns.some(pattern => lowered.includes(pattern.toLowerCase()))
}

/**
 * The outcome one verification result reported, mirroring the renderer that
 * produced its model-facing text (`[exit code: N]`, timeouts, signals).
 */
function verificationOf(command: string, event: SessionEvent<'tool/result'>): TaskReportVerification {
  const text = resultText(event)
  if (text.includes('[timed out') || text.includes('[killed by signal')) {
    return { command, status: 'failed' }
  }
  const match = /\[exit code: (-?\d+)\]/u.exec(text)
  if (match !== null) {
    const exitCode = Number(match[1])
    return { command, status: exitCode === 0 ? 'passed' : 'failed', exitCode }
  }
  return { command, status: event.data.message.isError === true ? 'failed' : 'unknown' }
}

/** The text blocks of one tool result message, joined as the model read them. */
function resultText(event: SessionEvent<'tool/result'>): string {
  const parts: string[] = []
  for (const block of event.data.message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

/** Line count of one text value; the empty string counts as zero lines. */
function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

/** Narrow an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
