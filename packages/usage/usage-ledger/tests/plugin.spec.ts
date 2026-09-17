import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import UsageService from '@deepseek-ai/dsh-usage'
import * as usageLedger from '../src/index.ts'
import { UsageLedgerProvider, aggregateUsage } from '../src/index.ts'
import type { UsageSessionRecord } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One stored probe session: header plus its complete event log. */
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
    return entry === undefined ? undefined : this.snapshot(entry)
  }

  override async list(): Promise<SessionPersistenceSnapshot[]> {
    return [...this.stored.values()].map(entry => this.snapshot(entry))
  }

  private snapshot(entry: StoredSession): SessionPersistenceSnapshot {
    return {
      header: entry.header,
      revision: SessionPersistenceRevision(`probe-${String(entry.header.id)}-${entry.events.length}`),
      eventCount: entry.events.length,
    }
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

async function boot(ledgerConfig?: usageLedger.Config): Promise<{ ctx: Context; persistence: ProbePersistence }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-usage-ledger-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SessionStore)
  await ctx.plugin(ProbePersistence)
  await ctx.plugin(ProbeQuery)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(UsageService)
  if (ledgerConfig !== undefined) await ctx.plugin(usageLedger, ledgerConfig)
  return { ctx, persistence: ctx.get('sessionPersistence') as ProbePersistence }
}

function header(id: string, createdAt = 1_000): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt, isSeeded: false }
}

function userMessage(seq: number, time: number, text = 'hello'): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time,
    data: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    surfaceOp: 'append',
  }
}

async function seed(persistence: ProbePersistence, id: string, createdAt = 1_000): Promise<void> {
  const handle = await persistence.create(header(id, createdAt))
  await handle.append([userMessage(0, createdAt)])
}

function record(overrides: Partial<UsageSessionRecord> = {}): UsageSessionRecord {
  return {
    sessionId: 'session-1',
    createdAt: 1_000,
    revision: 'r1',
    throughSeq: 3,
    turns: 1,
    steps: 1,
    unknownUsageSteps: 0,
    firstTime: 1_000,
    lastTime: 1_200,
    routes: [
      {
        provider: 'deepseek',
        model: 'chat',
        uncachedInputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 5,
        cacheWriteTokens: 1,
        steps: 1,
        unknownUsageSteps: 0,
      },
    ],
    ...overrides,
  }
}

describe('usage aggregation', () => {
  it('sums records, counts one session per record, and keeps route totals sorted', () => {
    const other = record({
      sessionId: 'session-2',
      turns: 2,
      steps: 3,
      routes: [
        {
          provider: 'local',
          model: 'llama',
          uncachedInputTokens: 1,
          outputTokens: 2,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          steps: 3,
          unknownUsageSteps: 1,
        },
        {
          provider: 'deepseek',
          model: 'chat',
          uncachedInputTokens: 7,
          outputTokens: 8,
          cacheReadTokens: 9,
          cacheWriteTokens: 10,
          steps: 0,
          unknownUsageSteps: 0,
        },
      ],
    })

    const result = aggregateUsage([record(), other], {})
    expect(result.totals).toEqual({
      sessions: 2,
      turns: 3,
      steps: 4,
      unknownUsageSteps: 1,
      uncachedInputTokens: 108,
      outputTokens: 20,
      cacheReadTokens: 17,
      cacheWriteTokens: 15,
    })
    expect(result.routes.map(route => `${route.provider}/${route.model}`)).toEqual(['deepseek/chat', 'local/llama'])
    expect(result.routes[0]).toMatchObject({ sessions: 2, steps: 1, uncachedInputTokens: 107 })
    expect(result.routes[1]).toMatchObject({ sessions: 1, steps: 3, unknownUsageSteps: 1 })
  })

  it('selects routes and drops records with no selected route', () => {
    const result = aggregateUsage([record(), record({ sessionId: 'session-2' })], { model: 'chat' })
    expect(result.routes).toHaveLength(1)
    expect(result.totals.sessions).toBe(2)

    const none = aggregateUsage([record()], { provider: 'local' })
    expect(none.routes).toEqual([])
    expect(none.totals.sessions).toBe(0)

    const wrongModel = aggregateUsage([record()], { model: 'reasoner' })
    expect(wrongModel.routes).toEqual([])
    expect(wrongModel.totals.sessions).toBe(0)

    const matchingModel = aggregateUsage([record()], { model: 'chat' })
    expect(matchingModel.routes).toHaveLength(1)
    expect(matchingModel.totals.sessions).toBe(1)
  })
})

describe('usage ledger provider', () => {
  /** Map-backed table handle; the provider never requires the storage machinery. */
  function table() {
    const records = new Map<string, UsageSessionRecord>()
    return {
      records,
      handle: {
        get: (key: string) => records.get(key),
        entries: () => records.entries(),
        keys: () => records.keys(),
        get size() { return records.size },
        put: async (key: string, value: UsageSessionRecord) => { records.set(key, value) },
        delete: async (key: string) => records.delete(key),
        update: async (key: string, fn: (current: UsageSessionRecord) => UsageSessionRecord) => {
          const next = fn(records.get(key)!)
          records.set(key, next)
          return next
        },
      },
    }
  }

  function deps(options: {
    readonly listed: readonly { header: SessionHeader; events: readonly SessionEvent[] }[]
    readonly revisionOf?: (id: SessionId, events: readonly SessionEvent[]) => string | undefined
  }) {
    const persistence = {
      async stat(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
        const found = options.listed.find(entry => String(entry.header.id) === String(id))
        if (found === undefined) return undefined
        const revision = options.revisionOf?.(id, found.events) ?? `rev-${String(found.events.length)}`
        if (revision === '') return undefined
        return {
          header: found.header,
          revision: SessionPersistenceRevision(revision),
          eventCount: found.events.length,
        }
      },
    }
    const sessionQuery = {
      async listSessions() {
        return options.listed.map(entry => ({ header: entry.header, live: false, persisted: true }))
      },
      async readSession(id: SessionId) {
        const found = options.listed.find(entry => String(entry.header.id) === String(id))
        if (found === undefined) throw new Error(`unknown session ${String(id)}`)
        return { session: found.header, inheritedEventCount: SessionLogOffset(0), events: [...found.events] }
      },
    }
    return { persistence, sessionQuery } as unknown as usageLedger.UsageLedgerDeps
  }

  it('folds once and reuses the cached record while the revision stands still', async () => {
    const store = table()
    const listed = [{ header: header('session-1', 1_000), events: [userMessage(0, 1_000)] }]
    // A constant revision proves the cached record is what the second query
    // served: the log underneath changed and the totals did not.
    const provider = new UsageLedgerProvider({ ...deps({ listed, revisionOf: () => 'constant' }), table: store.handle })

    const first = await provider.query({})
    expect(first.totals.sessions).toBe(1)
    expect(store.records.size).toBe(1)

    // Swap the readable log without moving the revision: the cached record is
    // served, proving the second query did not re-fold.
    listed[0] = { header: header('session-1', 1_000), events: [] }
    const second = await provider.query({})
    expect(second.totals.sessions).toBe(1)
  })

  it('re-folds when the revision moved and when no revision exists', async () => {
    const store = table()
    const listed = [{ header: header('session-1', 1_000), events: [userMessage(0, 1_000)] }]
    let revision = 'r1'
    const provider = new UsageLedgerProvider({ ...deps({ listed, revisionOf: () => revision }), table: store.handle })

    await provider.query({})
    listed[0] = { header: header('session-1', 1_000), events: [] }
    revision = 'r2'
    const stale = await provider.query({})
    expect(stale.totals.sessions).toBe(0)

    // A session with no persistence revision never produces a matching cache
    // key, so every query re-derives it.
    revision = ''
    listed[0] = { header: header('session-1', 1_000), events: [userMessage(0, 1_000)] }
    expect((await provider.query({})).totals.sessions).toBe(1)
    expect(store.records.get('session-1')?.revision).toBe('')
  })

  it('applies the session, window, and route selections', async () => {
    const store = table()
    const listed = [
      { header: header('session-1', 1_000), events: [userMessage(0, 1_000)] },
      { header: header('session-2', 5_000), events: [userMessage(0, 5_000)] },
    ]
    const provider = new UsageLedgerProvider({ ...deps({ listed }), table: store.handle })

    expect((await provider.query({ sessions: ['session-2'] })).totals.sessions).toBe(1)
    expect((await provider.query({ sessions: ['absent'] })).totals.sessions).toBe(0)
    // session-2's only event is at 5_000: a window ending before it excludes the session.
    expect((await provider.query({ to: 4_000 })).totals.sessions).toBe(1)
    expect((await provider.query({ from: 4_000 })).totals.sessions).toBe(1)
    // The fixture logs carry no assistant usage, so every route row is unknown.
    const routed = await provider.query({ provider: 'deepseek' })
    expect(routed.routes).toEqual([])
  })
})

describe('usage ledger composition', () => {
  it('registers the provider, answers queries, and unregisters on disposal', async () => {
    const { ctx, persistence } = await boot()
    await seed(persistence, 'session-1')

    const fiber = await ctx.plugin(usageLedger)
    const report = await ctx.usage.query()
    expect(report.totals.sessions).toBe(1)
    // The seeded log carries a user message only, so it observes a session and
    // attributes no tokens to any route.
    expect(report.routes).toEqual([])
    expect(report.cost).toBeUndefined()

    await fiber.dispose()
    await expect(ctx.usage.query()).rejects.toThrow(/no usage provider/)
  })

  it('rebuilds the derived cache on mount when asked', async () => {
    const { ctx, persistence } = await boot()
    await seed(persistence, 'session-1')
    const first = await ctx.plugin(usageLedger)
    expect((await ctx.usage.query()).totals.sessions).toBe(1)
    await first.dispose()

    const rebuilt = await ctx.plugin(usageLedger, { rebuildOnMount: true })
    expect((await ctx.usage.query()).totals.sessions).toBe(1)
    await rebuilt.dispose()

    await ctx.plugin(usageLedger)
    expect((await ctx.usage.query()).totals.sessions).toBe(1)
  })
})
