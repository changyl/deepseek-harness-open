/**
 * Run reporting. Fixed-width text keeps the lane's output diffable by eye when
 * a case flips, and the aggregate line is the number a reviewer reads first.
 *
 * @module @deepseek-ai/dsh-evals/report
 */

import { scoreRun } from './score.ts'
import type { EvalRun } from './types.ts'

/**
 * Render one run as a fixed-width table plus its aggregate line.
 * @param run - the run's outcomes.
 * @returns the lines to print.
 */
export function renderRun(run: EvalRun): string[] {
  const score = scoreRun(run)
  const lines = ['case\tstatus\tturns\ttokens\tcost(µ)\tms']
  for (const outcome of run.cases) {
    const tokens = outcome.uncachedInputTokens + outcome.outputTokens
    lines.push([
      outcome.name,
      outcome.status,
      String(outcome.turns),
      String(tokens),
      outcome.costMicros === undefined ? '-' : String(outcome.costMicros),
      String(outcome.wallMs),
    ].join('\t'))
    for (const failure of outcome.failures) lines.push(`  ! ${failure}`)
  }
  lines.push(
    `solved ${String(score.solved)}/${String(run.cases.length)}`
    + ` (pass ${(score.passRate * 100).toFixed(1)}%)`
    + ` tokens ${String(score.uncachedInputTokens + score.outputTokens)}`
    + (score.tokensPerSolved === undefined ? '' : ` tokens/solved ${score.tokensPerSolved.toFixed(0)}`)
    + (score.costPerSolved === undefined ? '' : ` cost/solved ${score.costPerSolved.toFixed(0)}µ`),
  )
  return lines
}
