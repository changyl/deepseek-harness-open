/**
 * Change-review context: tell the model what the reader decided about changes
 * it already applied.
 *
 * A revert happens between turns, so the model would otherwise keep reasoning
 * from content its change no longer produced. The decisions are durable session
 * events; this plugin renders the ones recorded since its own last injection
 * into one message, so each decision is reported exactly once and a reload or
 * fork reconstructs the same note.
 * @module @deepseek-ai/dsh-change-review-context
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-change-review'

/** Plugin name, which also marks this plugin's own injected messages. */
export const name = 'change-review-context'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/** One decision as the note reports it. */
interface ReportedDecision {
  readonly path: string
  readonly turn: number
  readonly decision: 'accepted' | 'reverted'
}

/** Most decisions one note lists before it summarizes the rest. */
const MAX_REPORTED = 12

/**
 * The decisions recorded since this plugin last spoke, oldest first.
 *
 * The walk stops at this plugin's own last message, which is what makes each
 * decision reported exactly once, and at a seed boundary, which keeps a fork
 * from re-reporting its parent's reviews.
 * @param session - the session whose log is read.
 * @returns one entry per change, with the last decision that change received.
 */
export function unreportedDecisions(session: Session): ReportedDecision[] {
  const collected: ReportedDecision[] = []
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) continue
    if (event.type === 'session/end-seed') break
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'plugin' && event.data.source.plugin === name) break
      continue
    }
    if (event.type !== 'change/review') continue
    collected.push({ path: event.data.path, turn: event.data.turn, decision: event.data.decision })
  }
  // Newest first from the walk; the last decision a change received wins.
  const byChange = new Map<string, ReportedDecision>()
  for (const decision of collected) {
    const key = `${String(decision.turn)}:${decision.path}`
    if (!byChange.has(key)) byChange.set(key, decision)
  }
  return [...byChange.values()].reverse()
}

/**
 * Render the note, or undefined when there is nothing to report.
 * @param decisions - the decisions to report, oldest first.
 * @returns the model-facing text, or undefined for an empty list.
 */
export function renderNote(decisions: readonly ReportedDecision[]): string | undefined {
  if (decisions.length === 0) return undefined
  const shown = decisions.slice(0, MAX_REPORTED)
  const lines = shown.map(({ path, turn, decision }) => decision === 'reverted'
    ? `- Reverted: \`${path}\` (turn ${String(turn)}) — the file is back to its content from before that change; re-read it before editing it again.`
    : `- Kept: \`${path}\` (turn ${String(turn)}).`)
  const omitted = decisions.length - shown.length
  return [
    'The user reviewed file changes you applied:',
    ...lines,
    ...omitted > 0 ? [`- ${String(omitted)} more decision(s) not listed.`] : [],
  ].join('\n')
}

/**
 * Register the pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const text = renderNote(unreportedDecisions(agent.session))
    if (text === undefined) return decision
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }) as UserMessage,
      ],
    }
  }, { prepend: true })
}
