import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SessionPersistence, { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleReadResult,
  SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import type { SessionEventSearchPage, SessionSearchHit, SessionSearchPage } from '@deepseek-ai/dsh-session-query'
import EffectivenessQuery from '../src/index.ts'

/** One stored probe session. */
interface StoredSession {
  header: SessionHeader
  events: SessionEvent[]
}

/** In-memory persistence: enough of the handle contract for canonical log reads. */
class ProbePersistence extends SessionPersistence {
  readonly stored = new Map<string, StoredSession>()

  override async create(header: SessionHeader): Promise<SessionHandle> {
    const entry: StoredSession = { header, events: [] }
    this.stored.set(String(header.id), entry)
    return this.handle(entry, 'write')
  }

  override async open(id: SessionId, access: SessionAccess): Promise<SessionHandle> {
    const entry = this.stored.get(String(id))
    if (entry === undefined) throw new Error(`unknown session ${String(id)}`)
    return this.handle(entry, access)
  }

  override async flush(): Promise<void> {}

  override async stat(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
    const entry = this.stored.get(String(id))
    return entry === undefined
      ? undefined
      : { header: entry.header, revision: SessionPersistenceRevision(`probe-${String(id)}`), eventCount: entry.events.length }
  }

  override async list(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.stored.values()].map(entry => ({
      header: entry.header,
      revision: SessionPersistenceRevision(`probe-${String(entry.header.id)}`),
      eventCount: entry.events.length,
    }))
  }

  private handle(entry: StoredSession, access: SessionAccess): SessionHandle {
    return {
      id: entry.header.id,
      header: entry.header,
      inheritedEventCount: SessionLogOffset(0),
      access,
      read: async (offset = 0, length = Number.MAX_SAFE_INTEGER): Promise<SessionHandleReadResult> => ({
        eventState: 'detached',
        events: structuredClone(entry.events.slice(offset, offset + length)),
      }),
      append: async (events: readonly SessionEvent[], _options?: SessionHandleAppendOptions) => {
        entry.events.push(...structuredClone(events))
      },
      flush: async () => {},
      close: async () => {},
      [Symbol.asyncDispose]: async () => {},
    }
  }
}

/** Concrete query engine over {@link ProbePersistence}; search is not under test. */
class ProbeQuery extends SessionQueryEngine {
  override async searchSessions(): Promise<SessionSearchPage<SessionSearchHit>> {
    return { items: [] }
  }

  override async searchEvents(request: { sessionId: SessionId }): Promise<SessionEventSearchPage> {
    return { session: (await this.readSurface(request.sessionId)).session, items: [] }
  }
}

async function boot(maxSessionsReported = 200): Promise<{ ctx: Context; persistence: ProbePersistence }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(ProbePersistence)
  await ctx.plugin(ProbeQuery)
  await ctx.plugin(EffectivenessQuery, { maxSessionsReported })
  return { ctx, persistence: ctx.get('sessionPersistence') as ProbePersistence }
}

function header(id: string, createdAt: number): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, isSeeded: false }
}

function userMessage(seq: number, time: number): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time,
    data: createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }),
    surfaceOp: 'append',
  }
}

function requestContext(seq: number, time: number, provider: string, model: string): SessionEvent {
  return { type: 'request/context', seq: SessionSeq(seq), time, data: { provider, model } } as unknown as SessionEvent
}

function feedback(seq: number, time: number, messageId: string, rating: 'positive' | 'negative', category?: string): SessionEvent {
  return {
    type: 'feedback/message-put',
    seq: SessionSeq(seq),
    time,
    data: {
      sessionId: 'session',
      item: {
        messageId,
        rating,
        ...category === undefined ? {} : { category },
        version: 'v1',
        createdAt: time,
        updatedAt: time,
      },
    },
  } as unknown as SessionEvent
}

function review(seq: number, time: number, decision: 'accepted' | 'reverted'): SessionEvent {
  return {
    type: 'change/review',
    seq: SessionSeq(seq),
    time,
    data: { turn: 1, seq: 0, path: 'a.ts', decision },
  } as unknown as SessionEvent
}

function taskReport(seq: number, time: number, statuses: readonly ('passed' | 'failed' | 'unknown')[]): SessionEvent {
  return {
    type: 'task-report/generated',
    seq: SessionSeq(seq),
    time,
    data: {
      turn: 1,
      reason: 'completed',
      changes: [],
      verification: statuses.map(status => ({ command: 'pnpm test', status })),
    },
  } as unknown as SessionEvent
}

async function seed(persistence: ProbePersistence, header0: SessionHeader, events: readonly SessionEvent[]): Promise<void> {
  const handle = await persistence.create(header0)
  await handle.append(events)
}

describe('cross-session effectiveness query', () => {
  it('answers an empty corpus with nothing', async () => {
    const { ctx } = await boot()
    const report = await ctx.effectiveness.query()
    expect(report.totals).toEqual({
      feedback: { positive: 0, negative: 0, byCategory: {} },
      changes: { accepted: 0, reverted: 0, undecided: 0 },
      verification: { passed: 0, failed: 0, unknown: 0 },
      turnsWithSignal: 0,
      sessions: 0,
    })
    expect(report.routes).toEqual([])
    expect(report.sessions).toEqual([])
    expect(report.truncated).toBe(false)
  })

  it('folds each session and attributes it to the routes its log named', async () => {
    const { ctx, persistence } = await boot()
    await seed(persistence, header('s1', 1_000), [
      userMessage(0, 1_000),
      requestContext(1, 1_100, 'deepseek', 'chat'),
      feedback(2, 1_200, 'm1', 'negative', 'task-result'),
      review(3, 1_300, 'reverted'),
      taskReport(4, 1_400, ['passed', 'failed']),
    ])
    await seed(persistence, header('s2', 2_000), [
      userMessage(0, 2_000),
      requestContext(1, 2_100, 'deepseek', 'chat'),
      feedback(2, 2_200, 'm1', 'positive'),
    ])

    const report = await ctx.effectiveness.query()
    expect(report.totals.sessions).toBe(2)
    expect(report.totals.feedback).toEqual({ positive: 1, negative: 1, byCategory: { 'task-result': 1 } })
    expect(report.totals.changes).toEqual({ accepted: 0, reverted: 1, undecided: 0 })
    expect(report.totals.verification).toEqual({ passed: 1, failed: 1, unknown: 0 })
    // Only the change decision names a turn whose signal the fold can place;
    // the feedback ratings attach to messages this log never produced.
    expect(report.totals.turnsWithSignal).toBe(1)

    expect(report.routes).toHaveLength(1)
    expect(report.routes[0]).toMatchObject({
      provider: 'deepseek',
      model: 'chat',
      sessions: 2,
      feedback: { positive: 1, negative: 1 },
    })

    // Newest session first, each carrying the route its log named.
    expect(report.sessions.map(row => row.sessionId)).toEqual(['s2', 's1'])
    expect(report.sessions[1]?.routes).toEqual([{ provider: 'deepseek', model: 'chat' }])
    expect(report.sessions[1]?.createdAt).toBe(1_000)
  })

  it('filters by route, by session id, and by time window', async () => {
    const { ctx, persistence } = await boot()
    await seed(persistence, header('s1', 1_000), [
      userMessage(0, 1_000),
      requestContext(1, 1_100, 'deepseek', 'chat'),
      requestContext(2, 1_150, 'local', 'llama'),
      feedback(3, 1_200, 'm1', 'negative'),
    ])
    await seed(persistence, header('s2', 5_000), [
      userMessage(0, 5_000),
      requestContext(1, 5_100, 'local', 'llama'),
      feedback(2, 5_200, 'm1', 'positive'),
    ])

    const byModel = await ctx.effectiveness.query({ model: 'chat' })
    expect(byModel.totals.sessions).toBe(1)
    expect(byModel.routes.map(route => route.model)).toEqual(['chat'])

    const byProvider = await ctx.effectiveness.query({ provider: 'local' })
    expect(byProvider.totals.sessions).toBe(2)
    expect(byProvider.routes[0]?.sessions).toBe(2)

    expect((await ctx.effectiveness.query({ sessions: ['s2'] })).totals.feedback.positive).toBe(1)
    expect((await ctx.effectiveness.query({ sessions: ['absent'] })).totals.sessions).toBe(0)
    expect((await ctx.effectiveness.query({ to: 4_000 })).totals.sessions).toBe(1)
    expect((await ctx.effectiveness.query({ from: 4_000 })).totals.sessions).toBe(1)
    expect((await ctx.effectiveness.query({ from: 4_000 })).totals.feedback.positive).toBe(1)
  })

  it('skips a session whose log observed nothing', async () => {
    const { ctx, persistence } = await boot()
    await seed(persistence, header('empty', 1_000), [])
    await seed(persistence, header('s1', 2_000), [
      userMessage(0, 2_000),
      requestContext(1, 2_100, 'deepseek', 'chat'),
    ])

    // The corpus is what the query reads; an empty log must still be listed for
    // the fold to be the thing that skips it.
    expect((await ctx.sessionQuery.listSessions()).map(record => String(record.header.id)).sort()).toEqual(['empty', 's1'])
    const report = await ctx.effectiveness.query()
    expect(report.totals.sessions).toBe(1)
    expect(report.sessions.map(row => row.sessionId)).toEqual(['s1'])
    // A window still excludes the empty session, which has no event time to compare.
    expect((await ctx.effectiveness.query({ to: 10_000 })).totals.sessions).toBe(1)
    expect((await ctx.effectiveness.query({ from: 0 })).totals.sessions).toBe(1)
  })

  it('bounds the session rows and reports truncation', async () => {
    const { ctx, persistence } = await boot(1)
    // One creation time for both sessions exercises the id tiebreak.
    for (const id of ['s1', 's2']) {
      await seed(persistence, header(id, 1_000), [
        userMessage(0, 1_000),
        requestContext(1, 1_010, 'deepseek', 'chat'),
      ])
    }
    const report = await ctx.effectiveness.query()
    expect(report.sessions).toHaveLength(1)
    // Equal creation times order by session id, so s1 is the row kept.
    expect(report.sessions[0]?.sessionId).toBe('s1')
    expect(report.truncated).toBe(true)
    // Totals still cover the whole corpus.
    expect(report.totals.sessions).toBe(2)
  })

  it('attributes a multi-route session to every route it used', async () => {
    const { ctx, persistence } = await boot()
    await seed(persistence, header('s1', 1_000), [
      userMessage(0, 1_000),
      requestContext(1, 1_100, 'deepseek', 'chat'),
      requestContext(2, 1_150, 'deepseek', 'chat'),
      requestContext(3, 1_200, 'deepseek', 'reasoner'),
      feedback(4, 1_300, 'm1', 'negative'),
    ])
    const report = await ctx.effectiveness.query()
    // A route the log named twice is one row.
    expect(report.routes.map(route => route.model)).toEqual(['chat', 'reasoner'])
    expect(report.routes.every(route => route.sessions === 1 && route.feedback.negative === 1)).toBe(true)
  })
})
