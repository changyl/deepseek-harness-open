import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { EffectivenessFilter, EffectivenessReport } from '@deepseek-ai/dsh-effectiveness-query'
import * as commandEffectiveness from '../src/index.ts'
import {
  executeEffectivenessCommand,
  parseEffectivenessCommand,
  renderEffectivenessReport,
  windowLabel,
} from '../src/index.ts'

const REPORT: EffectivenessReport = {
  totals: {
    feedback: { positive: 2, negative: 3, byCategory: { 'task-result': 2, 'instruction-following': 1 } },
    changes: { accepted: 5, reverted: 2, undecided: 1 },
    verification: { passed: 7, failed: 2, unknown: 1 },
    turnsWithSignal: 3,
    sessions: 4,
  },
  routes: [
    {
      provider: 'deepseek',
      model: 'chat',
      sessions: 3,
      feedback: { positive: 2, negative: 2, byCategory: {} },
      changes: { accepted: 4, reverted: 1, undecided: 0 },
      verification: { passed: 6, failed: 1, unknown: 0 },
      turnsWithSignal: 2,
    },
  ],
  sessions: [],
  truncated: true,
}

const EMPTY: EffectivenessReport = {
  totals: {
    feedback: { positive: 0, negative: 0, byCategory: {} },
    changes: { accepted: 0, reverted: 0, undecided: 0 },
    verification: { passed: 0, failed: 0, unknown: 0 },
    turnsWithSignal: 0,
    sessions: 0,
  },
  routes: [],
  sessions: [],
  truncated: false,
}

/** A query service stand-in: the corpus fold itself is covered by the query package. */
class StubEffectiveness extends Service {
  /** The instance the last mount registered, so a test can read what it saw. */
  static last: StubEffectiveness | undefined

  readonly seen: EffectivenessFilter[] = []

  constructor(ctx: Context) {
    super(ctx, 'effectiveness')
    StubEffectiveness.last = this
  }

  query(filter: EffectivenessFilter = {}): Promise<EffectivenessReport> {
    this.seen.push(filter)
    return Promise.resolve(REPORT)
  }
}

describe('/effectiveness argument grammar', () => {
  it('reports everything by default and names a window or route', () => {
    expect(parseEffectivenessCommand('')).toEqual({ kind: 'report' })
    expect(parseEffectivenessCommand('  all ')).toEqual({ kind: 'report' })
    expect(parseEffectivenessCommand('7d')).toEqual({ kind: 'report', window: { ms: 604_800_000, label: '7d' } })
    expect(parseEffectivenessCommand('deepseek/chat')).toEqual({
      kind: 'report',
      route: { provider: 'deepseek', model: 'chat' },
    })
    expect(parseEffectivenessCommand('24h local/llama')).toEqual({
      kind: 'report',
      window: { ms: 86_400_000, label: '24h' },
      route: { provider: 'local', model: 'llama' },
    })
  })

  it('rejects unknown, repeated, and impossible arguments', () => {
    expect(parseEffectivenessCommand('yesterday')).toMatchObject({ kind: 'invalid' })
    expect(parseEffectivenessCommand('7d 8d')).toMatchObject({ kind: 'invalid' })
    expect(parseEffectivenessCommand('7d all')).toMatchObject({ kind: 'invalid' })
    expect(parseEffectivenessCommand('0h')).toMatchObject({ kind: 'invalid' })
    expect(parseEffectivenessCommand('a/b c/d')).toMatchObject({ kind: 'invalid' })
    const invalid = parseEffectivenessCommand('yesterday')
    if (invalid.kind !== 'invalid') throw new Error('expected an invalid parse')
    expect(invalid.text).toContain('Unknown argument "yesterday"')
    expect(invalid.text).toContain('Usage: /effectiveness')
  })
})

describe('/effectiveness rendering', () => {
  it('renders the heading for each selection', () => {
    expect(windowLabel({ kind: 'report' }, 0)).toBe('Effectiveness (all time)')
    expect(windowLabel({ kind: 'report', window: { ms: 604_800_000, label: '7d' } }, 604_800_000))
      .toBe('Effectiveness (last 7d, since 1970-01-01T00:00:00.000Z)')
    expect(windowLabel({ kind: 'report', route: { provider: 'a', model: 'b' } }, 0)).toBe('Effectiveness (all time) · a/b')
  })

  it('says so when the selection carried no signal', () => {
    expect(renderEffectivenessReport(EMPTY, 'Effectiveness (all time)'))
      .toBe('Effectiveness (all time)\nNo session signal recorded for this selection.')
  })

  it('renders totals, categories, routes, and the truncation note', () => {
    expect(renderEffectivenessReport(REPORT, 'Effectiveness (all time)').split('\n')).toEqual([
      'Effectiveness (all time)',
      'Sessions 4 · turns with signal 3',
      'Feedback: positive 2 · negative 3 · categories: instruction-following 1 · task-result 2',
      'Changes: accepted 5 · reverted 2 · undecided 1',
      'Verification: passed 7 · failed 2 · unknown 1',
      'Routes:',
      '  deepseek/chat · sessions 3 · feedback +2/-2 · changes 4/1/0 · verification 6/1/0 · turns with signal 2',
      '(Session rows were truncated; totals cover the whole selection.)',
    ])
  })

  it('renders an empty category list without a trailing separator', () => {
    const report: EffectivenessReport = {
      ...EMPTY,
      totals: { ...EMPTY.totals, sessions: 1 },
    }
    expect(renderEffectivenessReport(report, 'h')).toContain('categories: none')
    expect(renderEffectivenessReport(report, 'h')).not.toContain('Routes:')
  })
})

describe('/effectiveness execution', () => {
  it('passes the parsed filter and renders the report', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEffectiveness)
    const invocation = { rawInput: '7d deepseek/chat' } as unknown as CommandInvocation
    const result = await executeEffectivenessCommand(ctx, invocation)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Effectiveness (last 7d,')
    expect(result.text).toContain('· deepseek/chat')
    expect(StubEffectiveness.last?.seen[0]?.provider).toBe('deepseek')
    expect(StubEffectiveness.last?.seen[0]?.model).toBe('chat')
    expect(StubEffectiveness.last?.seen[0]?.from).toBeGreaterThan(0)
  })

  it('refuses an unusable argument without querying', async () => {
    const ctx = new Context()
    await ctx.plugin(StubEffectiveness)
    const invocation = { rawInput: 'yesterday' } as unknown as CommandInvocation
    const result = await executeEffectivenessCommand(ctx, invocation)
    expect(result.kind).toBe('error')
    expect(StubEffectiveness.last?.seen).toEqual([])
  })
})

/** Live idle agent the command executor accepts. */
function stubAgent(id: string): Agent {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1, isSeeded: false }
  const session = Session.create(SessionId(id), [], header)
  return { id: session.id, session } as unknown as Agent
}

describe('@deepseek-ai/dsh-command-effectiveness registration', () => {
  it('registers one global command and disposes it with the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(StubEffectiveness)
    const plugin = await ctx.plugin(commandEffectiveness)
    const agent = stubAgent('effectiveness-command')

    expect(commandEffectiveness.name).toBe('command-effectiveness')
    expect(commandEffectiveness.inject).toEqual(['commands', 'effectiveness'])
    expect('default' in commandEffectiveness).toBe(false)
    expect(ctx.commands.find(agent, 'effectiveness')).toBeDefined()

    const execution = await ctx.commands.execute(agent, '/effectiveness', [], new AbortController().signal)
    expect(execution?.result).toMatchObject({ kind: 'success' })

    await plugin.dispose()
    expect(ctx.commands.find(agent, 'effectiveness')).toBeUndefined()
    vi.restoreAllMocks()
  })
})
