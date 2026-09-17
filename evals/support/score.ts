/**
 * Run aggregation and the checked-in baseline. The score answers "how often
 * did the model solve a task, and what did each solved task cost"; the
 * baseline turns a run into a regression gate: a case that passed when the
 * baseline was recorded and fails now is a red lane.
 *
 * @module @deepseek-ai/dsh-evals/score
 */

import { createHash } from 'node:crypto'
import type { EvalCase, EvalRun, EvalScore } from './types.ts'

/** The checked-in baseline shape. */
export interface EvalBaseline {
  /** Baseline format version. */
  readonly version: 1
  /** Per-case status at the last accepted run. */
  readonly cases: Readonly<Record<string, 'passed' | 'failed'>>
  /**
   * Digest of each golden task at the last accepted run. Model results need a
   * key; this digest is what the lane still enforces without one, so editing a
   * task, its assertions, or its fixture inventory without re-recording turns
   * the lane red.
   */
  readonly tasks?: Readonly<Record<string, string>>
}

/**
 * Aggregate one run.
 * @param run - the run's outcomes.
 * @returns pass counts, tokens, cost, and the per-solved-case ratios.
 */
export function scoreRun(run: EvalRun): EvalScore {
  let solved = 0
  let failed = 0
  let uncachedInputTokens = 0
  let outputTokens = 0
  let costMicros = 0
  let priced = false

  for (const outcome of run.cases) {
    if (outcome.status === 'passed') solved += 1
    else failed += 1
    uncachedInputTokens += outcome.uncachedInputTokens
    outputTokens += outcome.outputTokens
    if (outcome.costMicros !== undefined) {
      costMicros += outcome.costMicros
      priced = true
    }
  }

  const total = run.cases.length
  return {
    solved,
    failed,
    passRate: total === 0 ? 0 : solved / total,
    uncachedInputTokens,
    outputTokens,
    costMicros,
    ...solved === 0 ? {} : { tokensPerSolved: (uncachedInputTokens + outputTokens) / solved },
    ...solved === 0 || !priced ? {} : { costPerSolved: costMicros / solved },
  }
}

/**
 * Build the baseline a run would record.
 * @param run - the run's outcomes.
 * @returns the baseline document.
 */
export function baselineFrom(run: EvalRun): EvalBaseline {
  const cases: Record<string, 'passed' | 'failed'> = {}
  for (const outcome of run.cases) cases[outcome.name] = outcome.status
  return { version: 1, cases }
}

/**
 * Digest one golden task: the prompt, the profile and bounds it runs under, its
 * fixture inventory, and its assertions. Contents of fixture files are not
 * covered — the assertions are what judge the resulting workspace.
 * @param one - the loaded case.
 * @returns a stable hex digest.
 */
export function caseDigest(one: EvalCase): string {
  const canonical = JSON.stringify({
    task: one.task,
    profile: one.profile,
    timeoutMs: one.timeoutMs,
    maxTurns: one.maxTurns,
    files: [...one.files].sort(),
    assertions: one.assertions,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Digest every loaded case.
 * @param cases - the loaded cases.
 * @returns case name to digest.
 */
export function taskDigests(cases: readonly EvalCase[]): Record<string, string> {
  const digests: Record<string, string> = {}
  for (const one of cases) digests[one.name] = caseDigest(one)
  return digests
}

/**
 * Compare the loaded cases with the digests the baseline recorded.
 * @param cases - the loaded cases.
 * @param baseline - the recorded baseline, or `undefined` when none is committed yet.
 * @returns names the baseline did not know, names whose task changed, and baseline names this load did not cover.
 */
export function compareTasks(
  cases: readonly EvalCase[],
  baseline: EvalBaseline | undefined,
): { added: readonly string[]; changed: readonly string[]; removed: readonly string[] } {
  const recorded = baseline?.tasks
  if (recorded === undefined) return { added: [], changed: [], removed: [] }
  const added: string[] = []
  const changed: string[] = []
  const seen = new Set<string>()
  for (const one of cases) {
    seen.add(one.name)
    const digest = recorded[one.name]
    if (digest === undefined) added.push(one.name)
    else if (digest !== caseDigest(one)) changed.push(one.name)
  }
  return { added, changed, removed: Object.keys(recorded).filter(name => !seen.has(name)).sort() }
}

/**
 * Compare one run against the recorded baseline.
 * @param run - the run's outcomes.
 * @param baseline - the recorded baseline, or `undefined` when none is committed yet.
 * @returns the regressions, the cases the baseline did not know, and the baseline cases this run did not cover.
 */
export function compareToBaseline(
  run: EvalRun,
  baseline: EvalBaseline | undefined,
): { regressions: readonly string[]; added: readonly string[]; uncovered: readonly string[] } {
  if (baseline === undefined) return { regressions: [], added: [], uncovered: [] }
  const regressions: string[] = []
  const added: string[] = []
  const seen = new Set<string>()
  for (const outcome of run.cases) {
    seen.add(outcome.name)
    const recorded = baseline.cases[outcome.name]
    if (recorded === undefined) added.push(outcome.name)
    else if (recorded === 'passed' && outcome.status === 'failed') regressions.push(outcome.name)
  }
  const uncovered = Object.keys(baseline.cases).filter(name => !seen.has(name)).sort()
  return { regressions, added, uncovered }
}
