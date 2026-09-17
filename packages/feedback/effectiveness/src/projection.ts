/**
 * The `effectiveness` projection unit: a pure fold over the outcome signals a
 * session log already carries. It reads human feedback on messages, reader
 * decisions about applied file changes, and the verification outcomes task
 * reports recorded; it adds nothing to the log and reaches no model.
 *
 * Replacement semantics follow the producers. A feedback event carries the
 * complete current value for one message, so a re-rating replaces the earlier
 * one; a change decided twice keeps its latest decision; a report adds its
 * verification counts to the session's total.
 *
 * @module @deepseek-ai/dsh-effectiveness/projection
 */

import { z } from 'zod'
import { recordedHunks } from '@deepseek-ai/dsh-change-review'
import type {} from '@deepseek-ai/dsh-message-feedback/types'
import type {} from '@deepseek-ai/dsh-task-report/types'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { EffectivenessProjection } from './types.ts'

const feedbackSchema = z.object({
  rating: z.union([z.literal('positive'), z.literal('negative')]),
  category: z.string().nullable(),
}).strict()

const effectivenessStateSchema = z.object({
  feedback: z.record(z.string(), feedbackSchema),
  messageTurns: z.record(z.string(), z.number().int().nonnegative()),
  decisions: z.record(z.string(), z.union([z.literal('accepted'), z.literal('reverted')])),
  applied: z.record(z.string(), z.literal(true)),
  changeTurns: z.array(z.number().int().nonnegative()),
  reportTurns: z.array(z.number().int().nonnegative()),
  verification: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }).strict(),
}).strict()

/**
 * Fold state. Every member is plain JSON because the projection cache
 * persists state rows.
 */
type EffectivenessState = z.infer<typeof effectivenessStateSchema>

const viewSchema: z.ZodType<EffectivenessProjection> = z.object({
  feedback: z.object({
    positive: z.number().int().nonnegative(),
    negative: z.number().int().nonnegative(),
    byCategory: z.record(z.string(), z.number().int().nonnegative()),
  }).strict(),
  changes: z.object({
    accepted: z.number().int().nonnegative(),
    reverted: z.number().int().nonnegative(),
    undecided: z.number().int().nonnegative(),
  }).strict(),
  verification: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }).strict(),
  turnsWithSignal: z.number().int().nonnegative(),
}).strict()

/** Change key shared by the applied-change and decision records. */
const changeKey = (seq: number, path: string): string => `${seq}\u0000${path}`

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    effectiveness: EffectivenessState
  }
}

/**
 * The `effectiveness` unit registered on `ctx.sessionProjections`.
 *
 * A layer counts as a signal for the turn only where the turn is known: a
 * message with recorded feedback but no matching `assistant/message` in the
 * session contributes to the rating counts and not to `turnsWithSignal`.
 */
export const effectivenessProjectionDefinition = {
  key: 'effectiveness',
  stateVersion: 1,
  stateSchema: effectivenessStateSchema,
  init: (): EffectivenessState => ({
    feedback: {},
    messageTurns: {},
    decisions: {},
    applied: {},
    changeTurns: [],
    reportTurns: [],
    verification: { passed: 0, failed: 0, unknown: 0 },
  }),
  apply: (state, event) => {
    switch (event.type) {
      case 'assistant/message':
        return {
          ...state,
          messageTurns: { ...state.messageTurns, [String(event.data.message.id)]: event.data.turn },
        }
      case 'feedback/message-put': {
        const item = event.data.item
        return {
          ...state,
          feedback: {
            ...state.feedback,
            [String(item.messageId)]: {
              rating: item.rating,
              category: item.category ?? null,
            },
          },
        }
      }
      case 'feedback/message-delete': {
        const messageId = String(event.data.messageId)
        if (!Object.hasOwn(state.feedback, messageId)) return state
        const { [messageId]: _removed, ...remaining } = state.feedback
        return { ...state, feedback: remaining }
      }
      case 'change/review': {
        const key = changeKey(event.data.seq, event.data.path)
        const decided = Object.hasOwn(state.decisions, key)
        return {
          ...state,
          decisions: { ...state.decisions, [key]: event.data.decision },
          changeTurns: decided || state.changeTurns.includes(event.data.turn)
            ? state.changeTurns
            : [...state.changeTurns, event.data.turn],
        }
      }
      case 'tool/result': {
        const hunks = recordedHunks(event.data.meta)
        if (hunks === null) return state
        const applied = { ...state.applied }
        let changed = false
        for (const hunk of hunks) {
          const key = changeKey(event.seq, hunk.path)
          if (Object.hasOwn(applied, key)) continue
          applied[key] = true
          changed = true
        }
        return changed ? { ...state, applied } : state
      }
      case 'task-report/generated': {
        let { passed, failed, unknown } = state.verification
        for (const entry of event.data.verification) {
          if (entry.status === 'passed') passed += 1
          else if (entry.status === 'failed') failed += 1
          else unknown += 1
        }
        return {
          ...state,
          verification: { passed, failed, unknown },
          reportTurns: state.reportTurns.includes(event.data.turn)
            ? state.reportTurns
            : [...state.reportTurns, event.data.turn],
        }
      }
      default:
        return state
    }
  },
  wire: {
    viewSchema,
    view: (state) => {
      let positive = 0
      let negative = 0
      const byCategory: Record<string, number> = {}
      const turns = new Set<number>()

      for (const [messageId, item] of Object.entries(state.feedback)) {
        if (item.rating === 'positive') positive += 1
        else negative += 1
        if (item.category !== null) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1
        const turn = state.messageTurns[messageId]
        if (turn !== undefined) turns.add(turn)
      }

      let accepted = 0
      let reverted = 0
      for (const decision of Object.values(state.decisions)) {
        if (decision === 'accepted') accepted += 1
        else reverted += 1
      }
      const undecided = Object.keys(state.applied)
        .filter(key => !Object.hasOwn(state.decisions, key))
        .length
      for (const turn of state.changeTurns) turns.add(turn)
      for (const turn of state.reportTurns) turns.add(turn)

      return {
        feedback: { positive, negative, byCategory },
        changes: { accepted, reverted, undecided },
        verification: { ...state.verification },
        turnsWithSignal: turns.size,
      }
    },
  },
} satisfies ProjectionDefinition<'effectiveness', EffectivenessState>
