/**
 * The turn fold and reader: which events open and update a turn's report, the
 * published turn-scoped value (including identity preservation), and the
 * selector a completed turn resolves through.
 */
import { describe, expect, it, vi } from 'vitest'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationMatch, ConversationNodeContext, ConversationStartMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskReportEventData } from '@deepseek-ai/dsh-task-report/types'
import { selectTaskReport, taskReportDefinition, type TaskReportTurnData } from '../src/client/turn-report.ts'

/** One event shape the Definition matches on. */
function like(type: string, data: unknown): SessionEventLike {
  return { type, data } as unknown as SessionEventLike
}

/** One match as the engine would compute it. */
function match(type: string, data: unknown): ConversationMatch {
  const result = taskReportDefinition.match(like(type, data))
  if (result === null) throw new Error(`unmatched event ${type}`)
  return { event: like(type, data), ...result } as unknown as ConversationMatch
}

/** The same match as the start phase receives it (the engine passes a start match). */
function startMatch(type: string, data: unknown): ConversationStartMatch {
  return match(type, data) as unknown as ConversationStartMatch
}

/** The strictly-backward reader the start phase receives (unused here). */
const reader = {} as Parameters<NonNullable<typeof taskReportDefinition.start>>[2]

/** One report payload as the Host records it. */
function report(over: Partial<TaskReportEventData> = {}): TaskReportEventData {
  return {
    turn: 1,
    reason: 'completed',
    changes: [],
    verification: [],
    ...over,
  }
}

type FoldState = { turn: number; report?: TaskReportEventData }

/** A context carrying the supplied fold state. */
function context(state?: FoldState): ConversationNodeContext<FoldState> {
  return { state } as ConversationNodeContext<{ turn: number; report?: TaskReportEventData }>
}

/** A turn-tail owner whose turn data answers the taskReport key. */
function owner(data: TaskReportTurnData | undefined): { owner: TurnTailOwnerProps; openFile: ReturnType<typeof vi.fn> } {
  const openFile = vi.fn()
  const value = {
    turn: { turn: 1, data: { get: (key: string) => (key === 'taskReport' ? data : undefined) } },
    seq: 9,
    openFile,
  } as unknown as TurnTailOwnerProps
  return { owner: value, openFile }
}

describe('taskReportDefinition', () => {
  it('opens on turn/start and updates on a generated report', () => {
    expect(taskReportDefinition.match(like('turn/start', { turn: 2 }))).toEqual({ id: '2', role: 'start' })
    expect(taskReportDefinition.match(like('task-report/generated', { turn: 3 }))).toEqual({ id: '3', role: 'update' })
    expect(taskReportDefinition.match(like('tool/call', { turn: 3 }))).toBeNull()
  })

  it('requires turn/start to open a turn', () => {
    expect(() => taskReportDefinition.start(context(), startMatch('task-report/generated', { turn: 1 }), reader))
      .toThrow('task report start requires turn/start')
    expect(taskReportDefinition.start(context(), startMatch('turn/start', { turn: 4 }), reader)).toEqual({ turn: 4 })
  })

  it('keeps unrelated updates and folds a report into the turn state', () => {
    const state = { turn: 1 }
    expect(taskReportDefinition.update({ state } as never, match('turn/start', { turn: 1 }))).toBe(state)
    const folded = taskReportDefinition.update({ state } as never, match('task-report/generated', report()))
    expect(folded).toEqual({ turn: 1, report: report() })
  })

  it('publishes nothing outside the turn phase, before start, or without a report', () => {
    expect(taskReportDefinition.buildLocationData!(context({ turn: 1, report: report() }), 'step', null)).toBeNull()
    expect(taskReportDefinition.buildLocationData!(context(undefined), 'turn', null)).toBeNull()
    expect(taskReportDefinition.buildLocationData!(context({ turn: 1 }), 'turn', null)).toBeNull()
  })

  it('publishes the turn value and preserves identity while the report is unchanged', () => {
    const state = { turn: 1, report: report() }
    const published = taskReportDefinition.buildLocationData!(context(state), 'turn', null)
    expect(published).toEqual({ kind: 'turn', turn: 1, key: 'taskReport', value: { report: state.report } })

    const again = taskReportDefinition.buildLocationData!(context(state), 'turn', published)
    expect(again).toBe(published)

    const moved = taskReportDefinition.buildLocationData!(
      context({ turn: 2, report: state.report }),
      'turn',
      published,
    )
    expect(moved).not.toBe(published)
    expect(moved).toMatchObject({ turn: 2 })

    const updated = taskReportDefinition.buildLocationData!(
      context({ turn: 1, report: report({ reason: 'aborted' }) }),
      'turn',
      published,
    )
    expect(updated).not.toBe(published)
  })
})

describe('selectTaskReport', () => {
  it('claims a turn whose data carries a report and hands over its opener', () => {
    const data = { report: report({ path: '.dsh/reports/turn-1.md' }) }
    const { owner: value, openFile } = owner(data)
    const selected = selectTaskReport(value)
    expect(selected?.report).toBe(data.report)
    selected?.openFile('.dsh/reports/turn-1.md')
    expect(openFile).toHaveBeenCalledWith('.dsh/reports/turn-1.md')
  })

  it('declines a turn with no report data', () => {
    expect(selectTaskReport(owner(undefined).owner)).toBeNull()
  })
})
