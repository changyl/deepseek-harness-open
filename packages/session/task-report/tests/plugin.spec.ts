/**
 * The plugin body against programmable faces: which turns produce a report,
 * what the event records when the write succeeds or is refused, the `/report`
 * command's outcomes, and the load-time settings validation.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'
import type { TaskReportEventData } from '../src/types.ts'

/** A session whose header, appends, and identity the test owns. */
interface SessionStub {
  readonly session: Session
  readonly appended: Array<{ type: string; data: unknown }>
}

/**
 * Build one session stub.
 * @param cwd - header working directory, or undefined for a session without one.
 * @returns the session and the events it recorded.
 */
function sessionStub(cwd: string | undefined): SessionStub {
  const appended: Array<{ type: string; data: unknown }> = []
  const session = {
    id: SessionId('s-report'),
    header: cwd === undefined ? {} : { cwd },
    append: (type: string, data: unknown) => {
      appended.push({ type, data })
      return { type, seq: SessionSeq(appended.length), time: 0, data }
    },
  } as unknown as Session
  return { session, appended }
}

/** One turn window: start, request, one edit result, one test run, closing text, end. */
function turnLog(options: { changes?: boolean; verification?: boolean; closed?: boolean } = {}): SessionEvent[] {
  const events: SessionEvent[] = [
    event('turn/start', { turn: 1 }, 0),
    event('user/message', { role: 'user', id: 'm1', source: { kind: 'user' }, content: [{ type: 'text', text: 'Fix the parser' }] }, 1),
  ]
  if (options.changes ?? true) {
    events.push(event('tool/result', {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        id: 'r1',
        source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }], isError: false }],
      },
      meta: { diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'a\nb' }] },
    }, 2))
  }
  if (options.verification ?? true) {
    events.push(event('tool/call', { turn: 1, step: 1, callId: 'c2', name: 'bash', arguments: '{"command":"pnpm run test"}' }, 3))
    events.push(event('tool/result', {
      turn: 1,
      step: 1,
      message: {
        role: 'user',
        id: 'r2',
        source: { kind: 'tool', callId: 'c2' },
        content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: '[exit code: 0]' }], isError: false }],
      },
    }, 4))
  }
  if (options.closed ?? true) events.push(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
  return events
}

/** One hand-built session event. */
function event(type: SessionEvent['type'], data: unknown, seq: number): SessionEvent {
  return { type, seq: SessionSeq(seq), time: 1_700_000_000_000, data } as SessionEvent
}

/** The deployment settings the tests drive. */
const CONFIG: Config = {
  directory: '.dsh/reports',
  verifyPatterns: ['test'],
  maxTextLength: 600,
  maxChanges: 50,
  maxVerifications: 20,
}

/** Programmable plugin faces plus the captured listeners and writes. */
function bench(options: {
  /** The turn log to serve, or the value the read rejects with. */
  events?: SessionEvent[] | { reject: unknown }
  writeError?: unknown
  policy?: unknown
  config?: Partial<Config>
} = {}) {
  const listeners: Array<(session: Session, event: SessionEvent) => void> = []
  const definitions: CommandDefinition[] = []
  const writes: Array<{ path: string; content: string }> = []
  const warn = vi.fn()
  const readSession = vi.fn(() => {
    const events = options.events ?? turnLog()
    if (!Array.isArray(events)) return Promise.reject(events.reject)
    return Promise.resolve({ session: { id: SessionId('s-report'), cwd: '/workspace' }, inheritedEventCount: SessionSeq(0), events })
  })
  const ctx = {
    on: (name: string, listener: (session: Session, event: SessionEvent) => void) => {
      if (name === 'session/event') listeners.push(listener)
      return () => {}
    },
    effect: (callback: () => unknown) => {
      callback()
      return () => {}
    },
    commands: {
      register: (definition: CommandDefinition) => {
        definitions.push(definition)
        return () => {}
      },
    },
    sessionQuery: { readSession },
    fs: {
      resolve: (path: string, opts: { cwd: string }) => Promise.resolve({ displayPath: `${opts.cwd}/${path}` }),
      writeText: (target: { displayPath?: string }, content: string) => {
        if (options.writeError !== undefined) return Promise.reject(options.writeError)
        writes.push({ path: target.displayPath ?? '', content })
        return Promise.resolve({ operation: 'create', version: 'v1', before: null, after: content })
      },
    },
    get: (name: string) => (name === 'sandboxPolicy' ? options.policy : undefined),
    logger: { warn },
  } as unknown as Context
  apply(ctx, { ...CONFIG, ...options.config })
  return { listeners, definitions, writes, warn, readSession }
}

/** Emit one event through the registered `session/event` listener. */
function emit(listeners: Array<(session: Session, event: SessionEvent) => void>, session: Session, event: SessionEvent): void {
  for (const listener of listeners) listener(session, event)
}

/** Wait for the fire-and-forget generation to settle. */
async function settle(): Promise<void> {
  await new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('task-report apply', () => {
  it('declares the services it reads', async () => {
    const module = await import('../src/index.ts')
    expect(module.inject).toEqual(['sessionQuery', 'fs', 'commands'])
    expect('default' in module).toBe(false)
  })

  it('ignores every event that is not a closed turn', async () => {
    const { listeners, writes } = bench()
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('step/end', { turn: 1, step: 1 }, 0))
    await settle()
    expect(writes).toEqual([])
    expect(appended).toEqual([])
  })

  it('writes the report and records the event for a turn that changed something', async () => {
    const { listeners, writes } = bench()
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()

    expect(writes).toHaveLength(1)
    expect(writes[0]?.path).toBe('/workspace/.dsh/reports/turn-1.md')
    expect(writes[0]?.content).toContain('Fix the parser')
    expect(writes[0]?.content).toContain('| `src/a.ts` | update | +2 / -1 |')
    expect(appended).toHaveLength(1)
    expect(appended[0]?.type).toBe('task-report/generated')
    expect(appended[0]?.data).toMatchObject({
      turn: 1,
      reason: 'completed',
      path: '.dsh/reports/turn-1.md',
      request: 'Fix the parser',
      changes: [{ path: 'src/a.ts', kind: 'update', added: 2, removed: 1 }],
      verification: [{ command: 'pnpm run test', status: 'passed', exitCode: 0 }],
    } satisfies Partial<TaskReportEventData>)
  })

  it('records a turn that changed files without a recorded user request', async () => {
    const events = turnLog().filter(entry => entry.type !== 'user/message')
    const { listeners } = bench({ events })
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(appended[0]?.data).toMatchObject({ changes: [{ path: 'src/a.ts' }] })
    expect((appended[0]?.data as TaskReportEventData).request).toBeUndefined()
  })

  it('records nothing for a turn that neither changed a file nor verified anything', async () => {
    const { listeners, writes } = bench({ events: turnLog({ changes: false, verification: false }) })
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(writes).toEqual([])
    expect(appended).toEqual([])
  })

  it('records why it could not write when the session has no working directory', async () => {
    const { listeners, writes } = bench()
    const { session, appended } = sessionStub(undefined)
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(writes).toEqual([])
    expect(appended[0]?.data).toMatchObject({ error: 'the session has no working directory' })
    expect((appended[0]?.data as TaskReportEventData).path).toBeUndefined()
  })

  it('records the write failure and still publishes the fold', async () => {
    const { listeners, writes } = bench({ writeError: new Error('FS_SANDBOX_DENIED: read-only') })
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(writes).toEqual([])
    expect(appended[0]?.data).toMatchObject({
      error: 'FS_SANDBOX_DENIED: read-only',
      changes: [{ path: 'src/a.ts', kind: 'update', added: 2, removed: 1 }],
    })
  })

  it('reports a non-Error write failure through its string form', async () => {
    const { listeners } = bench({ writeError: 'denied' })
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(appended[0]?.data).toMatchObject({ error: 'denied' })
  })

  it('passes the session policy to the write when one is composed', async () => {
    const resolve = vi.fn(() => ({ mode: 'workspace-write', workspaceRoot: '/workspace' }))
    const { listeners } = bench({ policy: { resolve } })
    const { session } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(resolve).toHaveBeenCalledWith({ session })
  })

  it('logs and keeps going when the log read fails', async () => {
    const { listeners, warn, writes } = bench({ events: { reject: new Error('session gone') } })
    const { session, appended } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(warn).toHaveBeenCalledWith('task-report: turn 1 failed: session gone')
    expect(writes).toEqual([])
    expect(appended).toEqual([])
  })

  it('logs a non-Error read failure through its string form', async () => {
    const { listeners, warn } = bench({ events: { reject: 'gone' } })
    const { session } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(warn).toHaveBeenCalledWith('task-report: turn 1 failed: gone')
  })
})

describe('/report command', () => {
  /** Run the registered definition against one stub session. */
  async function run(options: Parameters<typeof bench>[0], session: Session): Promise<unknown> {
    const { definitions } = bench(options)
    const definition = definitions[0]
    if (definition === undefined) throw new Error('report command not registered')
    return await definition.handler({
      commandId: 'c1',
      agent: { session } as unknown as Agent,
      rawInput: '',
      attachments: [],
      signal: new AbortController().signal,
    } as never)
  }

  it('regenerates the latest closed turn', async () => {
    const { session, appended } = sessionStub('/workspace')
    const result = await run({}, session)
    expect(result).toEqual({
      kind: 'success',
      text: 'Wrote .dsh/reports/turn-1.md (1 changed file(s), 1 verification command(s))',
    })
    expect(appended).toHaveLength(1)
    expect(appended[0]?.type).toBe('task-report/generated')
  })

  it('reports a turn that recorded nothing instead of refusing it', async () => {
    const { session, appended } = sessionStub('/workspace')
    const result = await run({ events: turnLog({ changes: false, verification: false }) }, session)
    expect(result).toMatchObject({ kind: 'success' })
    expect(appended).toHaveLength(1)
  })

  it('fails loud when the session has no closed turn', async () => {
    const { session, appended } = sessionStub('/workspace')
    const result = await run({ events: turnLog({ closed: false }) }, session)
    expect(result).toEqual({ kind: 'error', text: 'This session has no closed turn to report on.' })
    expect(appended).toEqual([])
  })

  it('reports a refused write as an error result', async () => {
    const { session } = sessionStub('/workspace')
    const result = await run({ writeError: new Error('denied') }, session)
    expect(result).toEqual({ kind: 'error', text: 'Task report not written: denied' })
  })

  it('names an unknown failure when the write reported none', async () => {
    const { session } = sessionStub(undefined)
    const result = await run({}, session)
    expect(result).toEqual({ kind: 'error', text: 'Task report not written: the session has no working directory' })
  })
})

describe('settings validation', () => {
  /** Call apply with one config override and no other faces. */
  function bad(over: Partial<Config>): () => void {
    return () => { apply({} as Context, { ...CONFIG, ...over }) }
  }

  it('rejects an absolute, escaping, or empty report directory', () => {
    expect(bad({ directory: '/tmp/reports' })).toThrow('workspace-relative directory')
    expect(bad({ directory: '../reports' })).toThrow('workspace-relative directory')
    expect(bad({ directory: '   ' })).toThrow('workspace-relative directory')
  })

  it('rejects non-positive bounds', () => {
    expect(bad({ maxTextLength: 0 })).toThrow('positive integer maxTextLength')
    expect(bad({ maxChanges: 1.5 })).toThrow('positive integer maxChanges')
    expect(bad({ maxVerifications: -1 })).toThrow('positive integer maxVerifications')
  })

  it('drops blank verification patterns and trims the report directory', async () => {
    const { listeners, writes } = bench({ config: { directory: './reports/out/', verifyPatterns: [' ', 'test'] } })
    const { session } = sessionStub('/workspace')
    emit(listeners, session, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5))
    await settle()
    expect(writes[0]?.path).toBe('/workspace/reports/out/turn-1.md')
  })
})
