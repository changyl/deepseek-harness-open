/**
 * Pure types of the effectiveness projection: the outcome signals one session
 * log already carries, in the shape a client reads them. The counts describe
 * what happened inside a session — they are not a model quality score, and a
 * session with no signal reports that rather than a zero rate.
 *
 * @module @deepseek-ai/dsh-effectiveness/types
 */

import type {} from '@deepseek-ai/dsh-session-projection/types'
import type { FeedbackCategory } from '@deepseek-ai/dsh-command-feedback/types'

/** Current human judgments of individual assistant messages. */
export interface EffectivenessFeedback {
  /** Messages the human currently rates positive. */
  readonly positive: number
  /** Messages the human currently rates negative. */
  readonly negative: number
  /** Current judgments filed under each category; categories no judgment names are absent. */
  readonly byCategory: Readonly<Partial<Record<FeedbackCategory, number>>>
}

/** Reader decisions about the file changes the session applied. */
export interface EffectivenessChanges {
  /** Changes whose current decision is accepted. */
  readonly accepted: number
  /** Changes whose current decision is reverted. */
  readonly reverted: number
  /** Applied changes with no recorded decision. */
  readonly undecided: number
}

/** Outcomes of the verification commands the session's task reports recorded. */
export interface EffectivenessVerification {
  /** Commands whose result reported exit code 0. */
  readonly passed: number
  /** Commands whose result reported a non-zero exit or an error. */
  readonly failed: number
  /** Commands whose result reported no outcome. */
  readonly unknown: number
}

/**
 * One session's outcome signals. Every count is a current value: a re-rated
 * message counts once under its latest rating, and a change decided twice
 * counts once under its latest decision.
 */
export interface EffectivenessProjection {
  /** Current human feedback. */
  readonly feedback: EffectivenessFeedback
  /** Current change-review decisions. */
  readonly changes: EffectivenessChanges
  /** Verification outcomes over every task report in the session. */
  readonly verification: EffectivenessVerification
  /**
   * Distinct turns carrying at least one signal — feedback on a message that
   * turn produced, a change decision for that turn, or that turn's report.
   * Zero means the session carries no signal yet, so a consumer reports
   * insufficient data rather than a rate of zero.
   */
  readonly turnsWithSignal: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Session outcome signals; see {@link EffectivenessProjection}. */
    effectiveness: EffectivenessProjection
  }
}
