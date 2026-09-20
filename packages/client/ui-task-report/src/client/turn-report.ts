/**
 * Turn-scoped task-report Definition and reader. Client-only and model-free:
 * the value comes from the Host's durable `task-report/generated` event, so a
 * reload or a paged history reconstructs the same card.
 */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TaskReportEventData } from '@deepseek-ai/dsh-task-report/types'

/** Immutable report facts published against one Turn. */
export interface TaskReportTurnData {
  /** The report the Host recorded for this Turn. */
  readonly report: TaskReportEventData
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Latest task report recorded for this Turn. */
    taskReport: TaskReportTurnData
  }
}

/** Fold state of one Turn: the number it opened and the report it recorded. */
interface TaskReportState extends Partial<TaskReportTurnData> {
  readonly turn: number
}

/** The report reader's match for one turn. */
export interface TaskReportMatch {
  readonly report: TaskReportEventData
  /** Open the written report in the session's own viewer. */
  openFile(path: string): void
}

/** The turn data key this Definition publishes. */
const KEY = 'taskReport'

/** Turn-local report accumulator; it publishes no view Node. */
export const taskReportDefinition: ConversationNodeDefinition<TaskReportState> = {
  kind: KEY,
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'task-report/generated') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('task report start requires turn/start')
    return { turn: match.event.data.turn }
  },
  update: (context, match) => {
    if (match.event.type !== 'task-report/generated') return context.state
    return { turn: context.state.turn, report: match.event.data }
  },
  buildLocationData: (context: ConversationNodeContext<TaskReportState>, scope, previous) => {
    const state = context.state
    const report = state?.report
    if (scope !== 'turn' || state === undefined || report === undefined) return null
    if (previous?.kind === 'turn' && previous.turn === state.turn && previous.key === KEY
      && previous.value.report === report) return previous
    return { kind: 'turn', turn: state.turn, key: KEY, value: { report } }
  },
}

/**
 * Select the report a completed Turn recorded.
 * @param owner - turn-tail owner currency.
 * @returns the matched report, or null when this Turn has none.
 */
export function selectTaskReport(owner: TurnTailOwnerProps): TaskReportMatch | null {
  const data = owner.turn.data.get(KEY)
  if (data === undefined) return null
  return { report: data.report, openFile: owner.openFile }
}
