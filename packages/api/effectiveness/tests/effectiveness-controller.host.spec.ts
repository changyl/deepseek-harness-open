import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { EffectivenessProjection } from '@deepseek-ai/dsh-effectiveness'
import type {
  EffectivenessFilter,
  EffectivenessQuery,
  EffectivenessReport,
} from '@deepseek-ai/dsh-effectiveness-query'
import EffectivenessController from '../src/index.ts'

function projection(over: Partial<EffectivenessProjection> = {}): EffectivenessProjection {
  return {
    feedback: { positive: 2, negative: 1, byCategory: { 'task-result': 2 } },
    changes: { accepted: 3, reverted: 1, undecided: 0 },
    verification: { passed: 4, failed: 1, unknown: 0 },
    turnsWithSignal: 5,
    ...over,
  }
}

function report(over: Partial<EffectivenessReport> = {}): EffectivenessReport {
  return {
    totals: { ...projection(), sessions: 2 },
    routes: [{ ...projection(), provider: 'deepseek', model: 'chat', sessions: 2 }],
    sessions: [{
      ...projection(),
      sessionId: 'session-1',
      createdAt: 1_700_000_000_000,
      routes: [{ provider: 'deepseek', model: 'chat' }],
    }],
    truncated: false,
    ...over,
  }
}

async function boot(initial: EffectivenessReport = report()) {
  const ctx = new Context()
  const seen: EffectivenessFilter[] = []
  const query = vi.fn(async (filter: EffectivenessFilter) => {
    seen.push(filter)
    return initial
  })
  ctx.provide('effectiveness', { query } as unknown as EffectivenessQuery)
  await ctx.plugin(EffectivenessController)
  return { ctx, controller: ctx.effectivenessController, query, seen }
}

describe('the effectiveness Remote namespace a statistics page calls', () => {
  it('publishes one query method under its own service key', async () => {
    const { controller } = await boot()
    expect(controller.typertRemote.serviceKey).toBe('effectivenessController')
    expect(controller.typertRemote.namespace).toBe('effectiveness')
    expect(remoteMethods(controller)).toEqual([{ method: 'query', invocation: { kind: 'direct' } }])
  })

  it('maps a report onto plain wire values, categories included', async () => {
    const { controller } = await boot(report({
      routes: [],
      sessions: [],
      totals: {
        ...projection({ feedback: { positive: 0, negative: 0, byCategory: {} } }),
        sessions: 1,
      },
      truncated: true,
    }))

    const answer = await controller.query()
    expect(answer).toEqual({
      totals: {
        feedback: { positive: 0, negative: 0, byCategory: {} },
        changes: { accepted: 3, reverted: 1, undecided: 0 },
        verification: { passed: 4, failed: 1, unknown: 0 },
        turnsWithSignal: 5,
        sessions: 1,
      },
      routes: [],
      sessions: [],
      truncated: true,
    })
  })

  it('carries every named category and each route and session field', async () => {
    const { controller } = await boot(report({
      totals: {
        ...projection({
          feedback: {
            positive: 4,
            negative: 2,
            byCategory: { 'task-result': 1, 'instruction-following': 2, 'product-interaction': 3 },
          },
        }),
        sessions: 3,
      },
    }))

    const answer = await controller.query()
    expect(answer.totals.feedback.byCategory).toEqual({
      'task-result': 1,
      'instruction-following': 2,
      'product-interaction': 3,
    })
    expect(answer.routes[0]).toMatchObject({ provider: 'deepseek', model: 'chat', sessions: 2 })
    expect(answer.sessions[0]).toMatchObject({
      sessionId: 'session-1',
      createdAt: 1_700_000_000_000,
      routes: [{ provider: 'deepseek', model: 'chat' }],
    })
  })

  it('answers an absent filter as the whole corpus and a mixed one field by field', async () => {
    const { controller, seen } = await boot()
    await controller.query()
    await controller.query({ from: 1, to: 2, sessions: ['a'], provider: 'deepseek', model: 'chat' })
    expect(seen).toEqual([
      {},
      { from: 1, to: 2, sessions: ['a'], provider: 'deepseek', model: 'chat' },
    ])
  })

  it('refuses a malformed filter at the wire boundary', async () => {
    const { controller, query } = await boot()
    await expect(controller.query({ from: 'yesterday' } as never))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(query).not.toHaveBeenCalled()
  })

  it('propagates a corpus read failure unchanged', async () => {
    const ctx = new Context()
    ctx.provide('effectiveness', {
      query: () => Promise.reject(new Error('session store exploded')),
    } as unknown as EffectivenessQuery)
    await ctx.plugin(EffectivenessController)
    await expect(ctx.effectivenessController.query()).rejects.toThrow('session store exploded')
    await expect(ctx.effectivenessController.query({ provider: 'x' })).rejects.toBeInstanceOf(Error)
  })

  it('classifies the malformed request with its codec issues', async () => {
    const { controller } = await boot()
    try {
      await controller.query({ model: 7 } as never)
      expect.unreachable('a malformed filter must not be answered')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RemoteError)
      expect(error).toHaveProperty('details.issues')
    }
  })
})
