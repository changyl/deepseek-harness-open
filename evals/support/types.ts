/**
 * Types of the golden-task evaluation lane: one case, the assertions that
 * decide it, and the outcome and score the lane reports. The lane measures
 * whether a model solved a task end to end; it deliberately shares nothing
 * with `benchmarks/`, which measures the harness's own performance.
 *
 * @module @deepseek-ai/dsh-evals/types
 */

/** One deterministic check over the workspace a run left behind. */
export type EvalAssertion =
  | { readonly kind: 'file-exists'; readonly path: string }
  | { readonly kind: 'file-contains'; readonly path: string; readonly text: string }
  | { readonly kind: 'file-not-contains'; readonly path: string; readonly text: string }
  | { readonly kind: 'unchanged'; readonly path: string }
  | { readonly kind: 'command'; readonly run: string; readonly expectExit: number; readonly expectStdout?: string }

/** One loadable case: its prompt, its fixture workspace, and its assertions. */
export interface EvalCase {
  /** Directory name under `evals/cases/`. */
  readonly name: string
  /** Absolute case directory. */
  readonly dir: string
  /** The prompt handed to the profile. */
  readonly task: string
  /** Profile the run launches. */
  readonly profile: string
  /** Wall-clock ceiling for one run. */
  readonly timeoutMs: number
  /** Turn ceiling for one run. */
  readonly maxTurns: number
  /** Fixture files copied into the run's workspace, workspace-relative. */
  readonly files: readonly string[]
  /** Checks evaluated against the workspace after the run. */
  readonly assertions: readonly EvalAssertion[]
}

/** One case's outcome. */
export interface CaseOutcome {
  /** Case name. */
  readonly name: string
  /** `passed` when every assertion held; `failed` otherwise. */
  readonly status: 'passed' | 'failed'
  /** Human-readable assertion failures, empty on a pass. */
  readonly failures: readonly string[]
  /** Turns the run closed. */
  readonly turns: number
  /** Provider-reported uncached input tokens across the run. */
  readonly uncachedInputTokens: number
  /** Provider-reported output tokens across the run. */
  readonly outputTokens: number
  /** Cost in integer micro-units when a rate card priced the run. */
  readonly costMicros?: number
  /** Wall-clock milliseconds the run took. */
  readonly wallMs: number
}

/** Every case's outcome for one run. */
export interface EvalRun {
  /** Outcomes in case order. */
  readonly cases: readonly CaseOutcome[]
}

/** Aggregate figures over one run. */
export interface EvalScore {
  /** Cases that passed. */
  readonly solved: number
  /** Cases that failed. */
  readonly failed: number
  /** Solved / total, or 0 for an empty run. */
  readonly passRate: number
  /** Summed uncached input tokens. */
  readonly uncachedInputTokens: number
  /** Summed output tokens. */
  readonly outputTokens: number
  /** Summed cost micro-units over the cases a rate card priced. */
  readonly costMicros: number
  /** Uncached input tokens per solved case, absent when nothing was solved. */
  readonly tokensPerSolved?: number
  /** Cost micro-units per solved case, absent when nothing was solved or priced. */
  readonly costPerSolved?: number
}
