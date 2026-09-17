/**
 * Command-line entry for the golden-task evaluation lane. It runs every case
 * under `evals/cases/` through the shipped headless profile, scores the run,
 * and compares it with the checked-in baseline: a case that passed when the
 * baseline was recorded and fails now makes the lane exit non-zero.
 *
 * Live model calls make this an owner-run lane. Without `DEEPSEEK_API_KEY` it
 * reports the skip and exits zero, exactly like the e2e lane, so CI can run it
 * unconditionally without pretending to have measured anything.
 *
 * @module @deepseek-ai/dsh-evals/run
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadCases } from './support/case.ts'
import { createHeadlessExecutor } from './support/headless.ts'
import type { EvalRates } from './support/headless.ts'
import { compareTasks, compareToBaseline, baselineFrom, taskDigests } from './support/score.ts'
import { renderRun } from './support/report.ts'
import type { EvalBaseline } from './support/score.ts'
import { runSuite } from './support/runner.ts'

const root = resolve(import.meta.dirname, '..')
const casesRoot = join(root, 'evals/cases')
const baselinePath = join(root, 'evals/baseline.json')
const ratesPath = join(root, 'evals/rates.json')

/**
 * Load the optional deployment rate card.
 * @returns the parsed card, or `undefined` when the file is absent.
 */
function loadRates(): EvalRates | undefined {
  if (!existsSync(ratesPath)) return undefined
  return JSON.parse(readFileSync(ratesPath, 'utf8')) as EvalRates
}

/**
 * Load the checked-in baseline.
 * @returns the baseline, or `undefined` when none is committed yet.
 */
function loadBaseline(): EvalBaseline | undefined {
  if (!existsSync(baselinePath)) return undefined
  return JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalBaseline
}

/**
 * Run the lane.
 * @returns the process exit code.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'update-baseline': { type: 'boolean', default: false },
      'case': { type: 'string', multiple: true },
      'keep': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  })

  const cases = loadCases(casesRoot, values.case)
  const baseline = loadBaseline()
  const digests = taskDigests(cases)

  if (process.env['DEEPSEEK_API_KEY'] === undefined || process.env['DEEPSEEK_API_KEY'].length === 0) {
    // Model results need a key; the task digests do not. This is what still
    // turns the lane red when a golden task, its assertions, or its fixture
    // inventory changed without re-recording the baseline.
    const drift = compareTasks(cases, baseline)
    if (values['update-baseline']) {
      writeFileSync(baselinePath, `${JSON.stringify({ version: 1, tasks: digests, cases: baseline?.cases ?? {} }, null, 2)}\n`)
      console.log(`test:eval: baseline tasks updated at ${baselinePath}`)
      return 0
    }
    if (drift.changed.length > 0 || drift.removed.length > 0) {
      console.error('test:eval: golden task(s) differ from the baseline: '
        + [...drift.changed, ...drift.removed].join(', '))
      return 1
    }
    if (drift.added.length > 0) console.log(`test:eval: new golden task(s) not in the baseline: ${drift.added.join(', ')}`)
    console.log('test:eval: skipped — DEEPSEEK_API_KEY is not set, so no model run could produce evidence.')
    return 0
  }

  const rates = loadRates()
  const { run } = await runSuite(cases, createHeadlessExecutor({ root, ...rates === undefined ? {} : { rates } }), {
    keepWorkspaces: values.keep,
    onCase: ({ name, phase }) => { if (phase === 'start') console.log(`test:eval: running ${name}`) },
  })

  for (const line of renderRun(run)) console.log(line)

  if (values['update-baseline']) {
    writeFileSync(baselinePath, `${JSON.stringify({ ...baselineFrom(run), tasks: digests }, null, 2)}\n`)
    console.log(`test:eval: baseline updated at ${baselinePath}`)
    return 0
  }

  const comparison = compareToBaseline(run, baseline)
  if (comparison.added.length > 0) console.log(`test:eval: new case(s) not in the baseline: ${comparison.added.join(', ')}`)
  if (comparison.uncovered.length > 0) console.log(`test:eval: baseline case(s) not run: ${comparison.uncovered.join(', ')}`)
  if (comparison.regressions.length > 0) {
    console.error(`test:eval: regression(s) against the baseline: ${comparison.regressions.join(', ')}`)
    return 1
  }
  return 0
}

process.exitCode = await main()
