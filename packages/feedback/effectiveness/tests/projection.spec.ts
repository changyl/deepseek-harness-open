import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { EffectivenessProjection } from '@deepseek-ai/dsh-effectiveness/types'
import * as effectiveness from '../src/index.ts'
import { effectivenessProjectionDefinition } from '../src/projection.ts'

/** Build one synthetic event for the fold, bypassing the append path. */
function event(type: SessionEvent['type'], seq: number, data: unknown): SessionEvent {
  return { type, seq: SessionSeq(seq), time: seq + 1, data } as unknown as SessionEvent
}

const EMPTY: EffectivenessProjection = {
  feedback: { positive: 0, negative: 0, byCategory: {} },
  changes: { accepted: 0, reverted: 0, undecided: 0 },
  verification: { passed: 0, failed: 0, unknown: 0 },
  turnsWithSignal: 0,
}

/** Fold state the unit's own schema declares. */
type FoldState = ReturnType<typeof effectivenessProjectionDefinition.init>

/** Fold a whole synthetic log through the unit's own apply. */
function fold(events: readonly SessionEvent[]): EffectivenessProjection {
  let state: FoldState = effectivenessProjectionDefinition.init()
  for (const item of events) state = effectivenessProjectionDefinition.apply(state, item)
  const { viewSchema, view } = effectivenessProjectionDefinition.wire
  return viewSchema.parse(view(state))
}

function assistant(seq: number, turn: number, messageId: string): SessionEvent {
  return event('assistant/message', seq, {
    turn,
    step: 1,
    stream: [],
    // The fold reads only the identity, and createMessage mints its own, so a
    // synthetic event names the id directly.
    message: { id: messageId, role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } },
  })
}

function feedbackPut(seq: number, messageId: string, rating: 'positive' | 'negative', category?: string): SessionEvent {
  return event('feedback/message-put', seq, {
    sessionId: 'session-1',
    item: {
      messageId,
      rating,
      ...category === undefined ? {} : { category },
      version: 'v1',
      createdAt: 1,
      updatedAt: 1,
    },
  })
}

describe('effectiveness fold', () => {
  it('reports no signal on an empty log and ignores unrelated events', () => {
    const state = effectivenessProjectionDefinition.init()
    const unrelated = event('user/message', 0, {})
    expect(effectivenessProjectionDefinition.apply(state, unrelated)).toBe(state)
    expect(fold([unrelated])).toEqual(EMPTY)
  })

  it('counts current feedback, its categories, and the turns that produced the messages', () => {
    expect(fold([
      assistant(0, 1, 'm1'),
      assistant(1, 2, 'm2'),
      feedbackPut(2, 'm1', 'positive', 'task-result'),
      feedbackPut(3, 'm2', 'negative', 'instruction-following'),
    ])).toEqual({
      ...EMPTY,
      feedback: { positive: 1, negative: 1, byCategory: { 'task-result': 1, 'instruction-following': 1 } },
      turnsWithSignal: 2,
    })
  })

  it('replaces a re-rated message and drops a deleted one', () => {
    const reRated = fold([
      assistant(0, 1, 'm1'),
      feedbackPut(1, 'm1', 'positive'),
      feedbackPut(2, 'm1', 'negative'),
    ])
    expect(reRated.feedback).toEqual({ positive: 0, negative: 1, byCategory: {} })
    expect(reRated.turnsWithSignal).toBe(1)

    const deleted = fold([
      assistant(0, 1, 'm1'),
      feedbackPut(1, 'm1', 'positive'),
      event('feedback/message-delete', 2, { sessionId: 'session-1', messageId: 'm1' }),
    ])
    expect(deleted).toEqual(EMPTY)

    // Deleting a message that carries no current feedback is a no-op.
    const state = effectivenessProjectionDefinition.init()
    const withUnknownDelete = effectivenessProjectionDefinition.apply(
      state,
      event('feedback/message-delete', 0, { sessionId: 'session-1', messageId: 'absent' }),
    )
    expect(withUnknownDelete).toBe(state)
  })

  it('counts feedback on a message the log never produced without inventing a turn', () => {
    expect(fold([feedbackPut(0, 'ghost', 'positive')])).toEqual({
      ...EMPTY,
      feedback: { positive: 1, negative: 0, byCategory: {} },
      turnsWithSignal: 0,
    })
  })

  it('counts each change decision once under its latest value', () => {
    const decided = fold([
      event('change/review', 0, { turn: 4, seq: 9, path: 'a.ts', decision: 'accepted' }),
      event('change/review', 1, { turn: 4, seq: 9, path: 'a.ts', decision: 'reverted' }),
      event('change/review', 2, { turn: 5, seq: 9, path: 'b.ts', decision: 'accepted' }),
    ])
    expect(decided.changes).toEqual({ accepted: 1, reverted: 1, undecided: 0 })
    expect(decided.turnsWithSignal).toBe(2)
  })

  it('counts applied changes from tool-result hunks and reports the undecided remainder', () => {
    const applied = event('tool/result', 7, {
      meta: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }, { path: 'b.ts', oldText: null, newText: 'z' }] },
    })
    const report = fold([
      applied,
      event('change/review', 8, { turn: 1, seq: 7, path: 'a.ts', decision: 'accepted' }),
    ])
    expect(report.changes).toEqual({ accepted: 1, reverted: 0, undecided: 1 })
    expect(report.turnsWithSignal).toBe(1)

    // A result without hunks, and one that repeats an already-recorded change,
    // both leave the state untouched.
    const state = effectivenessProjectionDefinition.init()
    expect(effectivenessProjectionDefinition.apply(state, event('tool/result', 1, {}))).toBe(state)
    let once = effectivenessProjectionDefinition.apply(state, applied)
    const again = effectivenessProjectionDefinition.apply(once, applied)
    expect(again).toBe(once)
    once = effectivenessProjectionDefinition.apply(once, event('tool/result', 9, {
      meta: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
    }))
    expect(fold([applied, event('tool/result', 9, {
      meta: { diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
    })])).toMatchObject({ changes: { undecided: 3 } })
  })

  it('accumulates verification outcomes and counts each reporting turn once', () => {
    const report = (seq: number, turn: number, statuses: readonly ('passed' | 'failed' | 'unknown')[]): SessionEvent =>
      event('task-report/generated', seq, {
        turn,
        reason: 'completed',
        changes: [],
        verification: statuses.map(status => ({ command: 'pnpm test', status })),
      })

    const folded = fold([
      report(0, 1, ['passed', 'failed', 'unknown']),
      report(1, 1, ['passed']),
      report(2, 2, ['passed']),
    ])
    expect(folded.verification).toEqual({ passed: 3, failed: 1, unknown: 1 })
    expect(folded.turnsWithSignal).toBe(2)
  })
})

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlugin) await ctx.plugin(effectiveness)
  return { ctx, session: ctx.sessions.create(SessionId('effectiveness')) }
}

describe('effectiveness projection unit (registry drive)', () => {
  it('serves the empty value without the plugin and the folded value with it', async () => {
    const without = await harness(false)
    expect(without.ctx.sessionProjections.snapshot(without.session).values.effectiveness).toBeUndefined()

    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.effectiveness).toEqual(EMPTY)

    const message = createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    })
    session.append('assistant/message', { stream: [], turn: 1, step: 1, message }, { surfaceOp: 'append' })
    session.append('feedback/message-put', {
      sessionId: session.id,
      item: {
        messageId: message.id,
        rating: 'negative',
        category: 'task-result',
        version: 'v1' as never,
        createdAt: 1,
        updatedAt: 1,
      },
    })
    session.append('change/review', { turn: 1, seq: 0, path: 'a.ts', decision: 'reverted' })
    session.append('task-report/generated', {
      turn: 1,
      reason: 'completed',
      changes: [],
      verification: [{ command: 'pnpm test', status: 'passed' }],
    })

    expect(ctx.sessionProjections.snapshot(session).values.effectiveness).toEqual({
      feedback: { positive: 0, negative: 1, byCategory: { 'task-result': 1 } },
      changes: { accepted: 0, reverted: 1, undecided: 0 },
      verification: { passed: 1, failed: 0, unknown: 0 },
      turnsWithSignal: 1,
    })
  })

  it('removes the key when the plugin unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(effectiveness)
    expect(effectiveness.name).toBe('effectiveness')
    expect(effectiveness.inject).toEqual(['sessionProjections'])
    expect('default' in effectiveness).toBe(false)

    const session = ctx.sessions.create(SessionId('disposed'))
    expect(ctx.sessionProjections.snapshot(session).values.effectiveness).toEqual(EMPTY)
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values.effectiveness).toBeUndefined()
  })
})
