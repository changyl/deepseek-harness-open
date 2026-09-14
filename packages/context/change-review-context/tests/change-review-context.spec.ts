/**
 * The review note the model reads: decisions recorded since the plugin last
 * spoke, reported once each, with a revert stated as a fact about the file.
 */
import { Context } from '@deepseek-ai/cordis'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { apply, name, renderNote, unreportedDecisions } from '../src/index.ts'

/** A session whose log is the supplied events, tail first. */
function sessionOf(events: readonly SessionEvent[]): Parameters<typeof unreportedDecisions>[0] {
  return {
    seq: events.length,
    eventAt: (seq: SessionSeq) => events[Number(seq)],
  } as unknown as Parameters<typeof unreportedDecisions>[0]
}

function reviewEvent(turn: number, path: string, decision: 'accepted' | 'reverted', seq?: number): SessionEvent {
  return {
    type: 'change/review',
    seq: SessionSeq(seq ?? 0),
    time: 0,
    data: { turn, path, decision },
  } as SessionEvent
}

function injectedEvent(): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(0),
    time: 0,
    data: { role: 'user', content: [], source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [] } },
  } as unknown as SessionEvent
}

function userEvent(): SessionEvent {
  return {
    type: 'user/message',
    seq: SessionSeq(0),
    time: 0,
    data: { role: 'user', content: [], source: { kind: 'user' } },
  } as unknown as SessionEvent
}

describe('unreportedDecisions', () => {
  it('reports decisions recorded since this plugin last spoke, oldest first', () => {
    // The injection ends the window: a.ts and b.ts were reported by it.
    expect(unreportedDecisions(sessionOf([
      reviewEvent(1, 'a.ts', 'reverted'), reviewEvent(1, 'b.ts', 'accepted'),
      userEvent(), injectedEvent(), reviewEvent(2, 'c.ts', 'accepted'),
    ]))).toEqual([{ turn: 2, path: 'c.ts', decision: 'accepted' }])
    // A typed user message does not end it, so nothing is lost when the reader
    // reverts and then types before the next request.
    expect(unreportedDecisions(sessionOf([
      reviewEvent(1, 'a.ts', 'reverted'), reviewEvent(1, 'b.ts', 'accepted'), userEvent(),
    ]))).toEqual([
      { turn: 1, path: 'a.ts', decision: 'reverted' },
      { turn: 1, path: 'b.ts', decision: 'accepted' },
    ])
  })

  it('skips an event it does not fold, and a seq the log does not hold', () => {
    const events: (SessionEvent | undefined)[] = [
      reviewEvent(1, 'a.ts', 'reverted'),
      undefined,
      { type: 'tool/call', seq: SessionSeq(0), time: 0, data: {} } as unknown as SessionEvent,
    ]
    const session = {
      seq: events.length,
      eventAt: (seq: SessionSeq) => events[Number(seq)],
    } as unknown as Parameters<typeof unreportedDecisions>[0]
    expect(unreportedDecisions(session)).toEqual([{ turn: 1, path: 'a.ts', decision: 'reverted' }])
  })

  it('keeps the last decision a change received', () => {
    const session = sessionOf([reviewEvent(1, 'a.ts', 'reverted'), reviewEvent(1, 'a.ts', 'accepted')])
    expect(unreportedDecisions(session)).toEqual([{ turn: 1, path: 'a.ts', decision: 'accepted' }])
  })

  it('reports nothing after its own injection, and stops at a seed boundary', () => {
    expect(unreportedDecisions(sessionOf([injectedEvent()]))).toEqual([])
    expect(unreportedDecisions(sessionOf([reviewEvent(1, 'a.ts', 'reverted'), {
      type: 'session/end-seed', seq: SessionSeq(0), time: 0, data: {},
    } as unknown as SessionEvent]))).toEqual([])
  })
})

describe('renderNote', () => {
  it('names the file and what the reader did, and summarizes a long list', () => {
    expect(renderNote([])).toBeUndefined()
    const note = renderNote([{ turn: 2, path: 'a.ts', decision: 'reverted' }, { turn: 2, path: 'b.ts', decision: 'accepted' }])
    expect(note).toContain('The user reviewed file changes you applied:')
    expect(note).toContain('- Reverted: `a.ts` (turn 2)')
    expect(note).toContain('re-read it before editing it again')
    expect(note).toContain('- Kept: `b.ts` (turn 2).')
    const many = Array.from({ length: 13 }, (_value, index) => ({ turn: 1, path: `f${String(index)}.ts`, decision: 'accepted' as const }))
    expect(renderNote(many)).toContain('- 1 more decision(s) not listed.')
  })
})

describe('the pre-step listener', () => {
  it('appends one plugin-sourced message while decisions are unreported', async () => {
    const ctx = new Context()
    ctx.provide('agents', {} as never)
    await ctx.plugin({ inject: ['agents'], apply })
    const session = sessionOf([reviewEvent(1, 'a.ts', 'reverted')])
    const next = vi.fn(async () => ({ kind: 'continue' as const, messages: [] }))
    const decision = await ctx.waterfall(
      'agent/pre-step',
      { agent: { session }, turn: 1, step: 1, signal: new AbortController().signal } as never,
      next as never,
    ) as { messages: readonly { content: readonly { text: string }[] }[] }
    expect(decision.messages).toHaveLength(1)
    expect(decision.messages[0]?.content[0]?.text).toContain('- Reverted: `a.ts` (turn 1)')
    await ctx.fiber.dispose()
  })

  it('leaves a request with nothing to report, a rejection, and an aborted call alone', async () => {
    const ctx = new Context()
    ctx.provide('agents', {} as never)
    await ctx.plugin({ inject: ['agents'], apply })
    const session = sessionOf([injectedEvent()])
    const quiet = await ctx.waterfall(
      'agent/pre-step',
      { agent: { session }, turn: 1, step: 1, signal: new AbortController().signal } as never,
      (async () => ({ kind: 'continue' as const, messages: [] })) as never,
    ) as { messages: readonly unknown[] }
    expect(quiet.messages).toHaveLength(0)
    const rejecting = await ctx.waterfall(
      'agent/pre-step',
      { agent: { session }, turn: 1, step: 1, signal: new AbortController().signal } as never,
      (async () => ({ kind: 'reject' as const, reason: 'no' })) as never,
    ) as { kind: string }
    expect(rejecting.kind).toBe('reject')
    const controller = new AbortController()
    controller.abort()
    const aborted = await ctx.waterfall(
      'agent/pre-step',
      { agent: { session }, turn: 1, step: 1, signal: controller.signal } as never,
      (async () => ({ kind: 'continue' as const, messages: [] })) as never,
    ) as { messages: readonly unknown[] }
    expect(aborted.messages).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
