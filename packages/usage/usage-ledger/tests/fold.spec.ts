import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldUsageEvents } from '../src/fold.ts'
import type { UsageSessionRecord } from '../src/spec.ts'

function event(
  type: SessionEvent['type'],
  seq: number,
  data: unknown,
  time = seq + 1,
): SessionEvent {
  return { type, seq: SessionSeq(seq), time, data } as unknown as SessionEvent
}

const SESSION = { id: 'session-1', createdAt: 1_000 }

function requestContext(seq: number, provider = 'deepseek', model = 'chat'): SessionEvent {
  return event('request/context', seq, { provider, model })
}

function assistantMessage(seq: number, turn: number, step: number, usage?: Record<string, number>): SessionEvent {
  return event('assistant/message', seq, {
    turn,
    step,
    message: { role: 'assistant', content: [] },
    stream: [],
    ...usage === undefined ? {} : { usage },
  })
}

function stepEnd(seq: number, turn: number, step: number): SessionEvent {
  return event('step/end', seq, { turn, step })
}

function totalsOf(record: UsageSessionRecord, provider = 'deepseek', model = 'chat') {
  return record.routes.find(route => route.provider === provider && route.model === model)
}

describe('usage fold', () => {
  it('reports an empty log as no observation', () => {
    const record = foldUsageEvents(SESSION, [])
    expect(record).toEqual({
      sessionId: 'session-1',
      createdAt: 1_000,
      revision: '',
      throughSeq: -1,
      turns: 0,
      steps: 0,
      unknownUsageSteps: 0,
      firstTime: null,
      lastTime: null,
      routes: [],
    })
  })

  it('attributes steps and buckets to the route recorded before each request', () => {
    const record = foldUsageEvents(SESSION, [
      requestContext(0),
      stepEnd(1, 1, 1),
      assistantMessage(2, 2, 2, { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 1 }),
      stepEnd(3, 2, 2),
      requestContext(4, 'local', 'llama'),
      stepEnd(5, 3, 3),
    ])

    expect(record.turns).toBe(3)
    expect(record.steps).toBe(3)
    expect(record.unknownUsageSteps).toBe(0)
    expect(record.throughSeq).toBe(5)
    expect(record.firstTime).toBe(1)
    expect(record.lastTime).toBe(6)
    expect(totalsOf(record)).toEqual({
      provider: 'deepseek',
      model: 'chat',
      uncachedInputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 1,
      steps: 2,
      unknownUsageSteps: 0,
    })
    expect(totalsOf(record, 'local', 'llama')).toEqual({
      provider: 'local',
      model: 'llama',
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      steps: 1,
      unknownUsageSteps: 0,
    })
  })

  it('attributes tokens to the unknown route until the log names one', () => {
    const record = foldUsageEvents(SESSION, [
      assistantMessage(0, 1, 1, { inputTokens: 7, outputTokens: 3 }),
    ])
    expect(record.routes.map(route => `${route.provider}/${route.model}`)).toEqual(['unknown/unknown'])
    expect(totalsOf(record, 'unknown', 'unknown')?.uncachedInputTokens).toBe(7)
  })

  it('does not count a failed attempt with no usage sample as unknown', () => {
    const record = foldUsageEvents(SESSION, [
      requestContext(0),
      event('assistant/attempt', 1, { turn: 1, step: 1, stream: [] }),
      stepEnd(2, 1, 1),
    ])
    expect(record.unknownUsageSteps).toBe(0)
    expect(record.steps).toBe(1)
    expect(totalsOf(record)?.steps).toBe(1)
  })

  it('counts a settled message with no usage sample as unknown rather than zero', () => {
    const record = foldUsageEvents(SESSION, [
      requestContext(0),
      assistantMessage(1, 1, 1),
      assistantMessage(2, 2, 2, { inputTokens: 10, outputTokens: 1 }),
    ])
    expect(record.unknownUsageSteps).toBe(1)
    expect(totalsOf(record)?.unknownUsageSteps).toBe(1)
    expect(totalsOf(record)?.uncachedInputTokens).toBe(10)
  })

  it('adds a retried attempt to the total, because both attempts were billed', () => {
    const first = assistantMessage(1, 1, 1, { inputTokens: 10, outputTokens: 1 })
    const retried = foldUsageEvents(SESSION, [
      requestContext(0),
      first,
      event('llm/retry-started', 2, { turn: 1, step: 1 }),
      assistantMessage(3, 1, 1, { inputTokens: 4, outputTokens: 2 }),
    ])
    expect(totalsOf(retried)?.uncachedInputTokens).toBe(14)
    expect(totalsOf(retried)?.outputTokens).toBe(3)

    // The same step reporting an identical sample twice changes nothing, and a
    // later sample for the same step replaces the earlier one even without a
    // retry marker.
    const same = foldUsageEvents(SESSION, [requestContext(0), first, assistantMessage(2, 1, 1, { inputTokens: 10, outputTokens: 1 })])
    expect(totalsOf(same)?.uncachedInputTokens).toBe(10)

    const superseded = foldUsageEvents(SESSION, [
      requestContext(0),
      first,
      assistantMessage(2, 1, 1, { inputTokens: 11, outputTokens: 1 }),
    ])
    expect(totalsOf(superseded)?.uncachedInputTokens).toBe(11)
  })

  it('moves a replaced sample to the route that produced the replacement', () => {
    const record = foldUsageEvents(SESSION, [
      requestContext(0),
      assistantMessage(1, 1, 1, { inputTokens: 10, outputTokens: 1 }),
      requestContext(2, 'local', 'llama'),
      assistantMessage(3, 1, 1, { inputTokens: 4, outputTokens: 2 }),
    ])
    expect(totalsOf(record)?.uncachedInputTokens).toBe(0)
    expect(totalsOf(record, 'local', 'llama')?.uncachedInputTokens).toBe(4)
  })

  it('ignores a retry marker for another step and counts distinct turns once', () => {
    const record = foldUsageEvents(SESSION, [
      requestContext(0),
      event('llm/retry-started', 1, { turn: 9, step: 9 }),
      assistantMessage(2, 1, 1, { inputTokens: 3, outputTokens: 1 }),
      event('llm/retry-started', 3, { turn: 1, step: 1 }),
      assistantMessage(4, 1, 1, { inputTokens: 5, outputTokens: 1 }),
      stepEnd(5, 1, 1),
      stepEnd(6, 1, 2),
    ])
    expect(record.turns).toBe(1)
    expect(record.steps).toBe(2)
    // The marker matched the live step, so the two attempts both count.
    expect(totalsOf(record)?.uncachedInputTokens).toBe(8)
  })
})
