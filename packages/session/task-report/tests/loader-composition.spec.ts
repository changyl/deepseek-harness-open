/**
 * REAL-composition proof: the shipped YAML shape (session + session query +
 * commands + local filesystem + task-report) boots through the vendored Loader,
 * and a closed turn writes its Markdown report into the session workspace and
 * records `task-report/generated`; `/report` regenerates it on demand.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import * as TaskReportPlugin from '../src/index.ts'

/** Workspace-relative path the default configuration writes to. */
const REPORT_PATH = '.dsh/reports/turn-1.md'

let root: string | undefined
let workspace: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const dir of [root, workspace]) {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
  root = undefined
  workspace = undefined
})

/** Boot one Loader composition over a temporary config file. */
async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-task-report-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-query', SessionQueryEngine],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-fs-local', LocalFileSystem],
    ['@deepseek-ai/dsh-task-report', TaskReportPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

interface Bench {
  readonly ctx: Context
  readonly session: Session
  readonly sessionQuery: SessionQueryEngine
  readonly commands: CommandRuntime
  readonly workspace: string
}

/** Boot the shipped composition with one temp workspace. */
async function bench(): Promise<Bench> {
  const ctx = await loadYaml([
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-query'",
    "- name: '@deepseek-ai/dsh-commands'",
    "- name: '@deepseek-ai/dsh-fs-local'",
    "- name: '@deepseek-ai/dsh-task-report'",
  ])
  workspace = await mkdtemp(join(tmpdir(), 'dsh-task-report-workspace-'))
  const session = ctx.sessions.create(SessionId('composed'), { meta: { cwd: workspace } })
  return {
    ctx,
    session,
    sessionQuery: ctx.sessionQuery,
    commands: ctx.commands,
    workspace,
  }
}

/** Append one log-only event of a hand-built shape to a session. */
function append(session: Session, type: string, data: unknown): void {
  session.append(type as 'turn/start', data as never)
}

/** Append one surface event (a tool result) with its surface marker. */
function appendSurface(session: Session, type: string, data: unknown): void {
  const call = session.append as unknown as (t: string, d: unknown, o: unknown) => unknown
  call.call(session, type, data, { surfaceOp: 'append' })
}

/** Append the turn this suite reports on: a request, one edit, one test run, a closing line. */
function appendChangedTurn(session: Session): void {
  append(session, 'turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Fix the parser' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  appendSurface(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'user',
      id: 'r1',
      source: { kind: 'tool', callId: 'c1' },
      content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'applied' }], isError: false }],
    },
    meta: { diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'a\nb' }] },
  })
  session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'c2',
    name: 'bash',
    arguments: '{"command":"pnpm run test"}',
  } as never)
  appendSurface(session, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'user',
      id: 'r2',
      source: { kind: 'tool', callId: 'c2' },
      content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: '[exit code: 0]' }], isError: false }],
    },
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: 'Fixed; tests pass.' }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  } as never, { surfaceOp: 'append' })
  append(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
}

/** The recorded task-report events of one session. */
async function reportEvents(sessionQuery: SessionQueryEngine, session: Session): Promise<SessionEvent[]> {
  const snapshot = await sessionQuery.readSession(session.id)
  return snapshot.events.filter(event => event.type === 'task-report/generated')
}

describe('real Loader composition', () => {
  it('loads the shipped YAML shape, writes the report, and records the event', async () => {
    const loaded = await bench()
    const unloaded = [...loaded.ctx.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    appendChangedTurn(loaded.session)
    await vi.waitFor(async () => {
      expect(await reportEvents(loaded.sessionQuery, loaded.session)).toHaveLength(1)
    })

    const markdown = await readFile(join(loaded.workspace, REPORT_PATH), 'utf8')
    expect(markdown).toContain('# Task report — turn 1')
    expect(markdown).toContain('Fix the parser')
    expect(markdown).toContain('Fixed; tests pass.')
    expect(markdown).toContain('| `src/a.ts` | update | +2 / -1 |')
    expect(markdown).toContain('| `pnpm run test` | passed (exit 0) |')

    const event = (await reportEvents(loaded.sessionQuery, loaded.session))[0]
    expect(event?.data).toMatchObject({
      turn: 1,
      reason: 'completed',
      path: REPORT_PATH,
      changes: [{ path: 'src/a.ts', kind: 'update', added: 2, removed: 1 }],
      verification: [{ command: 'pnpm run test', status: 'passed', exitCode: 0 }],
    })
  })

  it('records nothing for a turn that changed nothing', async () => {
    const loaded = await bench()
    append(loaded.session, 'turn/start', { turn: 1 })
    loaded.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Just a question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    append(loaded.session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

    // The generation is fire-and-forget, so the only bound on "nothing
    // happened" is letting the microtask queue drain.
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(await reportEvents(loaded.sessionQuery, loaded.session)).toEqual([])
    await expect(readFile(join(loaded.workspace, REPORT_PATH), 'utf8')).rejects.toThrow()
  })

  it('regenerates the latest closed turn through /report', async () => {
    const loaded = await bench()
    appendChangedTurn(loaded.session)
    await vi.waitFor(async () => {
      expect(await reportEvents(loaded.sessionQuery, loaded.session)).toHaveLength(1)
    })

    const execution = await loaded.commands.execute(
      { session: loaded.session } as unknown as Agent,
      '/report',
      [],
      new AbortController().signal,
    )
    expect(execution?.result).toEqual({
      kind: 'success',
      text: `Wrote ${REPORT_PATH} (1 changed file(s), 1 verification command(s))`,
    })
    await vi.waitFor(async () => {
      expect(await reportEvents(loaded.sessionQuery, loaded.session)).toHaveLength(2)
    })
  })

  it('answers an error result when no turn has closed yet', async () => {
    const loaded = await bench()
    const execution = await loaded.commands.execute(
      { session: loaded.session } as unknown as Agent,
      '/report',
      [],
      new AbortController().signal,
    )
    expect(execution?.result).toEqual({ kind: 'error', text: 'This session has no closed turn to report on.' })
    expect(await reportEvents(loaded.sessionQuery, loaded.session)).toEqual([])
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    // A default export beside the named form makes the Loader discard the
    // namespace (postmortem 0001) — pin its absence.
    expect('default' in TaskReportPlugin).toBe(false)
    expect(TaskReportPlugin.name).toBe('task-report')
    expect(TaskReportPlugin.inject).toEqual(['sessionQuery', 'fs', 'commands'])
  })

  it('rejects the report directory escaping the workspace', () => {
    expect(() => { TaskReportPlugin.apply({} as Context, {
      directory: '../elsewhere',
      verifyPatterns: [],
      maxTextLength: 1,
      maxChanges: 1,
      maxVerifications: 1,
    }) }).toThrow('workspace-relative directory')
  })
})
