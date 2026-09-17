import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UsageService from '@deepseek-ai/dsh-usage'
import type { UsageFilter, UsageProvider, UsageProviderResult, UsageRouteTotals } from '@deepseek-ai/dsh-usage'
import * as commandUsage from '../src/index.ts'
import { formatAmount, parseUsageCommand, renderUsageReport, windowLabel } from '../src/index.ts'

function routeTotals(provider: string, model: string, overrides: Partial<UsageRouteTotals> = {}): UsageRouteTotals {
  return {
    provider,
    model,
    sessions: 1,
    steps: 2,
    uncachedInputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 5,
    cacheWriteTokens: 1,
    unknownUsageSteps: 0,
    ...overrides,
  }
}

class ProbeProvider implements UsageProvider {
  readonly name = 'probe'
  readonly seen: UsageFilter[] = []

  constructor(private readonly result: UsageProviderResult) {}

  async query(filter: UsageFilter): Promise<UsageProviderResult> {
    this.seen.push(filter)
    return this.result
  }
}

describe('/usage argument grammar', () => {
  it('reports everything by default and names a window or route', () => {
    expect(parseUsageCommand('')).toEqual({ kind: 'report' })
    expect(parseUsageCommand('  all  ')).toEqual({ kind: 'report' })
    expect(parseUsageCommand('7d')).toEqual({ kind: 'report', window: { ms: 604_800_000, label: '7d' } })
    expect(parseUsageCommand('24h')).toEqual({ kind: 'report', window: { ms: 86_400_000, label: '24h' } })
    expect(parseUsageCommand('deepseek/chat')).toEqual({
      kind: 'report',
      route: { provider: 'deepseek', model: 'chat' },
    })
    expect(parseUsageCommand('30d local/llama')).toEqual({
      kind: 'report',
      window: { ms: 2_592_000_000, label: '30d' },
      route: { provider: 'local', model: 'llama' },
    })
  })

  it('rejects unknown, repeated, and impossible arguments', () => {
    expect(parseUsageCommand('yesterday')).toMatchObject({ kind: 'invalid' })
    expect(parseUsageCommand('7d 8d')).toMatchObject({ kind: 'invalid' })
    expect(parseUsageCommand('7d all')).toMatchObject({ kind: 'invalid' })
    expect(parseUsageCommand('0d')).toMatchObject({ kind: 'invalid' })
    expect(parseUsageCommand('a/b c/d')).toMatchObject({ kind: 'invalid' })
    const invalid = parseUsageCommand('yesterday')
    if (invalid.kind !== 'invalid') throw new Error('expected an invalid parse')
    expect(invalid.text).toContain('Unknown argument "yesterday"')
    expect(invalid.text).toContain('Usage: /usage')
  })
})

describe('/usage rendering', () => {
  it('renders headings and amounts', () => {
    expect(windowLabel({ kind: 'report' }, 0)).toBe('Usage (all time)')
    expect(windowLabel({ kind: 'report', window: { ms: 86_400_000, label: '24h' } }, 86_400_000))
      .toBe('Usage (last 24h, since 1970-01-01T00:00:00.000Z)')
    expect(windowLabel({ kind: 'report', route: { provider: 'a', model: 'b' } }, 0)).toBe('Usage (all time) · a/b')

    expect(formatAmount(0)).toBe('0')
    expect(formatAmount(1)).toBe('0.000001')
    expect(formatAmount(1_500_000)).toBe('1.5')
    expect(formatAmount(12_345_678)).toBe('12.345678')
  })

  it('says so when the selection observed nothing', () => {
    const text = renderUsageReport({
      totals: {
        sessions: 0,
        turns: 0,
        steps: 0,
        unknownUsageSteps: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      routes: [],
      unpriced: [],
    }, 'Usage (all time)')
    expect(text).toBe('Usage (all time)\nNo usage recorded for this selection.')
  })

  it('renders totals, an incomplete cost, and per-route rows', () => {
    const priced = routeTotals('deepseek', 'chat', { sessions: 2, steps: 3, unknownUsageSteps: 1 })
    const unpriced = routeTotals('local', 'llama', { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })
    const report = {
      totals: {
        sessions: 2,
        turns: 4,
        steps: 5,
        unknownUsageSteps: 1,
        uncachedInputTokens: 101,
        outputTokens: 12,
        cacheReadTokens: 8,
        cacheWriteTokens: 5,
      },
      routes: [priced, unpriced],
      unpriced: [{ provider: 'local', model: 'llama' }],
      cost: {
        currency: 'CNY',
        pricingVersion: '2026-09-16',
        totalMicros: 1_500_000,
        complete: false,
        routes: [
          { provider: 'deepseek', model: 'chat', micros: 1_500_000, priced: true },
          { provider: 'local', model: 'llama', micros: 0, priced: false },
        ],
      },
    }

    const text = renderUsageReport(report, 'Usage (all time)')
    expect(text.split('\n')).toEqual([
      'Usage (all time)',
      'Sessions 2 · turns 4 · steps 5 · steps without usage 1',
      'Tokens: input 101 · output 12 · cache read 8 · cache write 5',
      'Cost: CNY 1.5 (pricing 2026-09-16) (incomplete — unpriced routes: local/llama)',
      'Routes:',
      '  deepseek/chat · sessions 2 · steps 3 · input 100 · output 10 · cache read 5 · cache write 1 · steps without usage 1 · CNY 1.5',
      '  local/llama · sessions 1 · steps 2 · input 1 · output 2 · cache read 3 · cache write 4 · unpriced',
    ])
  })

  it('reports cost as unavailable when nothing is priced', () => {
    const report = {
      totals: {
        sessions: 1,
        turns: 1,
        steps: 1,
        unknownUsageSteps: 0,
        uncachedInputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      routes: [routeTotals('local', 'llama')],
      unpriced: [{ provider: 'local', model: 'llama' }],
    }
    const text = renderUsageReport(report, 'Usage (all time)')
    expect(text).toContain('Cost: unavailable — no route in this selection is priced.')
    expect(text).toContain('  local/llama · sessions 1 · steps 2 · input 100 · output 10 · cache read 5 · cache write 1')
    expect(text).not.toContain('steps without usage')
  })

  it('renders a complete cost without the incomplete suffix', () => {
    const report = {
      totals: {
        sessions: 1,
        turns: 1,
        steps: 1,
        unknownUsageSteps: 0,
        uncachedInputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      routes: [routeTotals('deepseek', 'chat')],
      unpriced: [],
      cost: {
        currency: 'USD',
        pricingVersion: 'v1',
        totalMicros: 0,
        complete: true,
        routes: [{ provider: 'deepseek', model: 'chat', micros: 0, priced: true }],
      },
    }
    const text = renderUsageReport(report, 'Usage (all time)')
    expect(text).toContain('Cost: USD 0 (pricing v1)')
    expect(text).not.toContain('incomplete')
  })
})

/** Register a provider whose query fails for a reason the command must not swallow. */
function ctx_usage_throwing(test: { ctx: Context }): void {
  test.ctx.usage.registerProvider({
    name: 'throwing',
    query: () => Promise.reject(new Error('ledger exploded')),
  })
}

/** Live idle agent the command executor accepts. */
function stubAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return agent
}

async function harness(options: { withProvider?: boolean } = {}): Promise<{
  ctx: Context
  agent: Agent
  provider: ProbeProvider
  plugin: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UsageService)
  const provider = new ProbeProvider({
    totals: {
      sessions: 1,
      turns: 2,
      steps: 3,
      unknownUsageSteps: 0,
      uncachedInputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
    },
    routes: [routeTotals('deepseek', 'chat')],
  })
  if (options.withProvider !== false) ctx.usage.registerProvider(provider)
  const plugin = await ctx.plugin(commandUsage)
  const agent = stubAgent(ctx, `command-usage-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, provider, plugin }
}

async function run(test: Awaited<ReturnType<typeof harness>>, suffix = ''): Promise<{ kind: string; text: string }> {
  const line = suffix.length === 0 ? '/usage' : `/usage ${suffix}`
  const execution = await test.ctx.commands.execute(test.agent, line, [], new AbortController().signal)
  if (execution === undefined) throw new Error('usage command was not registered')
  const result = execution.result
  if (result === undefined) throw new Error('usage command produced no result')
  return result as { kind: string; text: string }
}

describe('@deepseek-ai/dsh-command-usage registration', () => {
  it('registers one global command and disposes it with the plugin', async () => {
    const test = await harness()
    expect(commandUsage.name).toBe('command-usage')
    expect(commandUsage.inject).toEqual(['commands', 'usage'])
    expect('default' in commandUsage).toBe(false)
    expect(test.ctx.commands.find(test.agent, 'usage')).toBeDefined()

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'usage')).toBeUndefined()
  })
})

describe('/usage command execution', () => {
  it('renders the report for an unfiltered invocation', async () => {
    const test = await harness()
    const result = await run(test)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Usage (all time)')
    expect(result.text).toContain('Sessions 1 · turns 2 · steps 3')
    expect(test.provider.seen).toEqual([{}])
  })

  it('bounds a named window and selects a route', async () => {
    const test = await harness()
    const before = Date.now()
    const result = await run(test, '7d deepseek/chat')
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Usage (last 7d,')
    expect(result.text).toContain('· deepseek/chat')

    const filter = test.provider.seen[0]
    expect(filter?.provider).toBe('deepseek')
    expect(filter?.model).toBe('chat')
    expect(filter?.from).toBeGreaterThanOrEqual(before - 604_800_000)
    expect(filter?.from).toBeLessThanOrEqual(Date.now() - 604_800_000)
  })

  it('rejects an unusable argument without querying', async () => {
    const test = await harness()
    const result = await run(test, 'yesterday')
    expect(result.kind).toBe('error')
    expect(result.text).toContain('Unknown argument "yesterday"')
    expect(test.provider.seen).toEqual([])
  })

  it('omits the route block when a selection observed no route', () => {
    const report = {
      totals: {
        sessions: 1,
        turns: 1,
        steps: 0,
        unknownUsageSteps: 0,
        uncachedInputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      routes: [],
      unpriced: [],
    }
    const text = renderUsageReport(report, 'Usage (all time)')
    expect(text).toContain('Sessions 1')
    expect(text).not.toContain('Routes:')
    expect(text).toContain('Cost: unavailable')
  })

  it('propagates an unexpected provider failure', async () => {
    const test = await harness({ withProvider: false })
    ctx_usage_throwing(test)
    await expect(run(test)).rejects.toThrow('ledger exploded')
  })

  it('reports a composition without a provider as unavailable', async () => {
    const test = await harness({ withProvider: false })
    const result = await run(test)
    expect(result.kind).toBe('error')
    expect(result.text).toContain('no usage provider is registered')
  })
})
