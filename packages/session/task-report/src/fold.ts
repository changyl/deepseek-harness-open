/**
 * Pure fold behind one task report: given a session log and one closed turn, it
 * extracts the request that opened the turn, the closing assistant text, the
 * files the turn changed (from the hunks `write`/`edit` recorded on their
 * results), and the verification commands the turn ran with the outcome their
 * rendered results reported.
 *
 * Nothing here reads the filesystem, the workspace, or the model: the fold is a
 * function of the log window only, so the same log always yields the same
 * report.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TaskReportChange, TaskReportVerification } from './types.ts'

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

/** One content block as far as this fold reads it. */
interface ReadableBlock {
  readonly type?: unknown
  readonly text?: unknown
  readonly content?: unknown
  readonly isError?: unknown
  readonly toolCallId?: unknown
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
  const calls = new Map<string, string>()
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
        const command = bashCommand(event)
        if (command !== undefined) calls.set(event.data.callId, command)
        break
      }
      case 'tool/result': {
        recordChanges(changes, event, options.maxChanges)
        const command = calls.get(resultCallId(event) ?? '')
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
function messageText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const parts: string[] = []
  for (const block of content as readonly ReadableBlock[]) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  const text = parts.join('\n').trim()
  return text === '' ? undefined : text
}

/** Bound one already-trimmed, non-empty text value. */
function bound(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** The command line of one bash tool call, or undefined for any other call. */
function bashCommand(event: SessionEvent<'tool/call'>): string | undefined {
  if (event.data.name !== 'bash') return undefined
  try {
    const args: unknown = JSON.parse(event.data.arguments)
    if (!isRecord(args) || typeof args.command !== 'string') return undefined
    const command = args.command.trim()
    return command === '' ? undefined : command
  } catch {
    // Swallows a non-JSON argument string only: the loop logs the model's raw
    // text, so a malformed call describes no command and contributes nothing.
    return undefined
  }
}

/** Record the hunks one tool result applied, keeping first-seen path order. */
function recordChanges(changes: Map<string, TaskReportChange>, event: SessionEvent<'tool/result'>, limit: number): void {
  for (const hunk of recordedHunks(event.data.meta)) {
    if (!changes.has(hunk.path) && changes.size >= limit) continue
    changes.set(hunk.path, {
      path: hunk.path,
      kind: hunk.oldText === null ? 'create' : 'update',
      added: lineCount(hunk.newText),
      removed: hunk.oldText === null ? 0 : lineCount(hunk.oldText),
    })
  }
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
  const blocks = toolResultBlocks(event)
  const text = blocks
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
  if (text.includes('[timed out') || text.includes('[killed by signal')) {
    return { command, status: 'failed' }
  }
  const match = /\[exit code: (-?\d+)\]/u.exec(text)
  if (match !== null) {
    const exitCode = Number(match[1])
    return { command, status: exitCode === 0 ? 'passed' : 'failed', exitCode }
  }
  return { command, status: blocks.some(block => block.isError === true) ? 'failed' : 'unknown' }
}

/** The tool call whose result this event carries, from its own result blocks. */
function resultCallId(event: SessionEvent<'tool/result'>): string | undefined {
  for (const block of toolResultBlocks(event)) {
    const callId = block.toolCallId
    if (block.type === 'tool-result' && typeof callId === 'string') return callId
  }
  return undefined
}

/** Every text block of one tool result message, nested results included. */
function toolResultBlocks(event: SessionEvent<'tool/result'>): readonly ReadableBlock[] {
  const content = event.data.message.content
  if (!Array.isArray(content)) return []
  const blocks: ReadableBlock[] = []
  for (const block of content as readonly ReadableBlock[]) {
    if (!isRecord(block)) continue
    blocks.push(block)
    if (Array.isArray(block.content)) {
      for (const nested of block.content as readonly ReadableBlock[]) {
        if (isRecord(nested)) blocks.push(nested)
      }
    }
  }
  return blocks
}

/** Line count of one text value; the empty string counts as zero lines. */
function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

/** Narrow an unknown JSON value to a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
