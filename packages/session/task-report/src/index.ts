/**
 * Task-report plugin: at every closed turn, fold that turn's own log window into
 * a Markdown change summary plus the verification it ran, write the document
 * into the session workspace, and record `task-report/generated`. `/report`
 * regenerates the latest closed turn's report on demand.
 *
 * The work is deterministic and model-free: it reads the session log through
 * `ctx.sessionQuery`, never calls the model, and adds nothing the model sees. A
 * turn that recorded no file change and ran no matching verification command
 * produces nothing — no file and no event.
 */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-query'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { foldTaskReport, type TaskReportFoldResult } from './fold.ts'
import { renderTaskReport } from './render.ts'
import type { TaskReportEventData } from './types.ts'

/** Stable Loader identity. */
export const name = 'task-report'

/** Deployment-varying report settings. */
export interface Config {
  /** Workspace-relative directory the Markdown reports are written to. */
  directory: string
  /** Case-insensitive substrings that mark a shell command as verification. */
  verifyPatterns: string[]
  /** Maximum characters kept from the request and the closing summary. */
  maxTextLength: number
  /** Maximum changed files listed in one report. */
  maxChanges: number
  /** Maximum verification commands listed in one report. */
  maxVerifications: number
}

/** Validated settings; the defaults cover this repository's own check names. */
export const Config: z<Config> = z.object({
  directory: z.string().default('.dsh/reports'),
  verifyPatterns: z.array(z.string()).default([
    'test', 'vitest', 'pytest', 'jest', 'typecheck', 'tsc', 'lint', 'cargo test', 'go test',
  ]),
  maxTextLength: z.number().default(600),
  maxChanges: z.number().default(50),
  maxVerifications: z.number().default(20),
})

/** Services the plugin reads: the log reader, the workspace writer, and slash commands. */
export const inject = ['sessionQuery', 'fs', 'commands']

/** Settings after validation (one shape the whole plugin shares). */
interface Settings {
  readonly directory: string
  readonly verifyPatterns: readonly string[]
  readonly maxTextLength: number
  readonly maxChanges: number
  readonly maxVerifications: number
}

/**
 * Generate a report for every turn this session closes, and offer the same
 * work through `/report`.
 * @param ctx - host context carrying the log reader, filesystem, and command registry.
 * @param config - report directory, verification patterns, and bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const settings = resolveSettings(config)

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    // Fire-and-forget: the turn is already closed, and a report that cannot be
    // produced must never disturb the session it describes.
    void generate(ctx, session, event.data.turn, event.time, settings).catch((error: unknown) => {
      ctx.logger.warn(`task-report: turn ${String(event.data.turn)} failed: ${messageOf(error)}`)
    })
  })

  ctx.effect(() => ctx.commands.register({
    name: 'report',
    description: 'Write a Markdown change summary and verification report for the latest closed turn',
    handler: invocation => commandReport(ctx, invocation, settings),
  }), 'task-report: /report command')
}

/** Fold one closed turn, then write and record its report unless the turn is empty. */
async function generate(
  ctx: Context,
  session: Session,
  turn: number,
  generatedAt: number,
  settings: Settings,
): Promise<void> {
  const snapshot = await ctx.sessionQuery.readSession(session.id)
  const result = foldTaskReport(snapshot.events, Number(snapshot.inheritedEventCount), { turn, ...settings })
  if (result.changes.length === 0 && result.verification.length === 0) return
  const outcome = await writeAndRecord(ctx, session, turn, generatedAt, settings, result)
  session.append('task-report/generated', outcome.event)
}

/** The `/report` handler: regenerate the latest closed turn, even when it changed nothing. */
async function commandReport(ctx: Context, invocation: CommandInvocation, settings: Settings): Promise<CommandResult> {
  const session = invocation.agent.session
  const snapshot = await ctx.sessionQuery.readSession(session.id)
  const first = Number(snapshot.inheritedEventCount)
  const turn = latestClosedTurn(snapshot.events, first)
  if (turn === undefined) return { kind: 'error', text: 'This session has no closed turn to report on.' }
  const result = foldTaskReport(snapshot.events, first, { turn, ...settings })
  const outcome = await writeAndRecord(ctx, session, turn, Date.now(), settings, result)
  session.append('task-report/generated', outcome.event)
  if (outcome.failure !== undefined) return { kind: 'error', text: `Task report not written: ${outcome.failure}` }
  const changes = String(outcome.event.changes.length)
  const verification = String(outcome.event.verification.length)
  return {
    kind: 'success',
    text: `Wrote ${outcome.event.path} (${changes} changed file(s), ${verification} verification command(s))`,
  }
}

/** One write attempt: the event to record, plus the refusal message when nothing was written. */
interface WriteOutcome {
  readonly event: TaskReportEventData
  readonly failure?: string
}

/** Write the Markdown document and describe what happened, never throwing for a refused write. */
async function writeAndRecord(
  ctx: Context,
  session: Session,
  turn: number,
  generatedAt: number,
  settings: Settings,
  result: TaskReportFoldResult,
): Promise<WriteOutcome> {
  const path = `${settings.directory}/turn-${String(turn)}.md`
  const base = {
    turn,
    reason: result.reason,
    changes: result.changes,
    verification: result.verification,
    ...(result.request === undefined ? {} : { request: result.request }),
    ...(result.summary === undefined ? {} : { summary: result.summary }),
  }
  const cwd = session.header.cwd
  if (cwd === undefined) {
    return { event: { ...base, error: NO_WORKSPACE }, failure: NO_WORKSPACE }
  }
  try {
    const target = await ctx.fs.resolve(path, { cwd })
    const markdown = renderTaskReport({
      turn,
      reason: result.reason,
      path,
      generatedAt: new Date(generatedAt).toISOString(),
      result,
    })
    // The session's own policy is the write's fence: a read-only session keeps
    // its workspace untouched and the event says why.
    await ctx.fs.writeText(target, markdown, undefined, undefined, ctx.get('sandboxPolicy')?.resolve({ session }))
    return { event: { ...base, path } }
  } catch (error) {
    const failure = messageOf(error)
    return { event: { ...base, error: failure }, failure }
  }
}

/** Refusal reason a session without a working directory reports. */
const NO_WORKSPACE = 'the session has no working directory'

/** The turn number of the newest `turn/end` after one fork seed, or undefined. */
function latestClosedTurn(events: readonly SessionEvent[], first: number): number | undefined {
  for (let index = events.length - 1; index >= first; index -= 1) {
    const event = events[index]
    if (event !== undefined && event.type === 'turn/end') return event.data.turn
  }
  return undefined
}

/** Validate deployment settings once, failing loud rather than at the first turn. */
function resolveSettings(config: Config): Settings {
  const directory = config.directory.trim().replace(/^\.\//u, '').replace(/\/+$/u, '')
  if (directory === '' || isAbsolute(directory) || directory.split('/').includes('..')) {
    throw new Error('task-report requires a workspace-relative directory without ".." segments')
  }
  const bounds: readonly (readonly [string, number])[] = [
    ['maxTextLength', config.maxTextLength],
    ['maxChanges', config.maxChanges],
    ['maxVerifications', config.maxVerifications],
  ]
  for (const [label, value] of bounds) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`task-report requires a positive integer ${label}`)
  }
  return {
    directory,
    verifyPatterns: config.verifyPatterns.filter(pattern => pattern.trim() !== ''),
    maxTextLength: config.maxTextLength,
    maxChanges: config.maxChanges,
    maxVerifications: config.maxVerifications,
  }
}

/** One failure message, from any thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
