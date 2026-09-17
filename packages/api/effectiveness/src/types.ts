/**
 * Plain values the `effectiveness` Remote namespace carries. They mirror the
 * report `ctx.effectiveness` assembles, with no behavior of their own, so a
 * client can render outcome signals without linking the query service.
 *
 * @module @deepseek-ai/dsh-api-effectiveness/types
 */

/**
 * Wire copy of the domain's feedback-category union. The controller assigns
 * store values into these fields, so a change to either union fails the build.
 */
export type FeedbackCategoryWire = 'task-result' | 'instruction-following' | 'product-interaction'

/** Current human judgments of individual assistant messages. */
export interface EffectivenessFeedbackWire {
  /** Messages the human currently rates positive. */
  readonly positive: number
  /** Messages the human currently rates negative. */
  readonly negative: number
  /** Current judgments filed under each named category; absent categories carry no judgment. */
  readonly byCategory: Readonly<Partial<Record<FeedbackCategoryWire, number>>>
}

/** Reader decisions about the file changes a session applied. */
export interface EffectivenessChangesWire {
  /** Changes whose current decision is accepted. */
  readonly accepted: number
  /** Changes whose current decision is reverted. */
  readonly reverted: number
  /** Applied changes with no recorded decision. */
  readonly undecided: number
}

/** Outcomes of the verification commands a session's task reports recorded. */
export interface EffectivenessVerificationWire {
  /** Commands whose result reported exit code 0. */
  readonly passed: number
  /** Commands whose result reported a non-zero exit or an error. */
  readonly failed: number
  /** Commands whose result reported no outcome. */
  readonly unknown: number
}

/** One session's outcome signals, or one route's totals, on the wire. */
export interface EffectivenessProjectionWire {
  /** Current human feedback. */
  readonly feedback: EffectivenessFeedbackWire
  /** Current change-review decisions. */
  readonly changes: EffectivenessChangesWire
  /** Verification outcomes over every task report in the session. */
  readonly verification: EffectivenessVerificationWire
  /** Distinct turns carrying at least one signal; zero means no signal yet, not a zero rate. */
  readonly turnsWithSignal: number
}

/** Corpus-wide outcomes. */
export interface EffectivenessTotalsWire extends EffectivenessProjectionWire {
  /** Sessions contributing at least one observation. */
  readonly sessions: number
}

/** One route in a session's route list. */
export interface EffectivenessRouteRefWire {
  /** Registered provider name. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** One route's outcomes across every session that used it. */
export interface EffectivenessRouteRowWire extends EffectivenessProjectionWire {
  /** Registered provider name. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Sessions contributing to this row. */
  readonly sessions: number
}

/** One session's outcomes, with the routes its log named. */
export interface EffectivenessSessionRowWire extends EffectivenessProjectionWire {
  /** Session the row describes. */
  readonly sessionId: string
  /** Session creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Routes the session's log named, in first-seen order. */
  readonly routes: readonly EffectivenessRouteRefWire[]
}

/** One assembled answer. */
export interface EffectivenessReportWire {
  /** Corpus-wide outcomes. */
  readonly totals: EffectivenessTotalsWire
  /** The same outcomes per route; a session using several routes contributes to each. */
  readonly routes: readonly EffectivenessRouteRowWire[]
  /** Per-session rows, newest first, bounded by the deployment's configured maximum. */
  readonly sessions: readonly EffectivenessSessionRowWire[]
  /** Whether the session rows were cut at that maximum. */
  readonly truncated: boolean
}

/** Selection over the session corpus; the only untrusted request field. */
export interface EffectivenessFilterWire {
  /** Inclusive lower bound on a session's contributing event time, Unix epoch milliseconds. */
  readonly from?: number
  /** Exclusive upper bound on a session's contributing event time, Unix epoch milliseconds. */
  readonly to?: number
  /** Restrict to these session ids. */
  readonly sessions?: readonly string[]
  /** Restrict to sessions whose log named this provider. */
  readonly provider?: string
  /** Restrict to sessions whose log named this provider-owned model. */
  readonly model?: string
}
