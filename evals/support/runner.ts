/**
 * Suite orchestration. Each case runs in its own temporary workspace copied
 * from its fixture, so one case cannot observe or damage another, and the
 * executor is injected: the lane's logic — materialize, run, assert, score —
 * is testable without a model.
 *
 * @module @deepseek-ai/dsh-evals/runner
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateAssertions, hashFile } from './assertions.ts'
import { listFixtureFiles } from './case.ts'
import type { CaseOutcome, EvalCase, EvalRun } from './types.ts'

/** What one case's execution reported, before assertions run. */
export interface CaseExecution {
  /** Turns the run closed. */
  readonly turns: number
  /** Provider-reported uncached input tokens. */
  readonly uncachedInputTokens: number
  /** Provider-reported output tokens. */
  readonly outputTokens: number
  /** Cost in integer micro-units when a rate card priced the run. */
  readonly costMicros?: number
  /** Wall-clock milliseconds the run took. */
  readonly wallMs: number
}

/** Runs one case in a prepared workspace. */
export interface CaseExecutor {
  /**
   * Execute one case against its workspace.
   * @param evalCase - the loaded case.
   * @param workspace - absolute workspace directory to run in.
   * @returns the run's figures; assertion evaluation happens in the suite.
   */
  execute(evalCase: EvalCase, workspace: string): Promise<CaseExecution>
}

/** Options for one suite run. */
export interface RunSuiteOptions {
  /** Keep each case's temporary workspace on disk (for inspection). */
  readonly keepWorkspaces?: boolean
  /** Report progress as cases start and finish. */
  readonly onCase?: (event: { readonly name: string; readonly phase: 'start' | 'done'; readonly outcome?: CaseOutcome }) => void
}

/**
 * Run every case through the executor and evaluate its assertions.
 * @param cases - the loaded cases, in run order.
 * @param executor - the injected runner.
 * @param options - workspace retention and progress reporting.
 * @returns the run's outcomes and the workspace each case used.
 */
export async function runSuite(
  cases: readonly EvalCase[],
  executor: CaseExecutor,
  options: RunSuiteOptions = {},
): Promise<{ run: EvalRun; workspaces: ReadonlyMap<string, string> }> {
  const outcomes: CaseOutcome[] = []
  const workspaces = new Map<string, string>()

  for (const evalCase of cases) {
    options.onCase?.({ name: evalCase.name, phase: 'start' })
    const workspace = mkdtempSync(join(tmpdir(), `dsh-eval-${evalCase.name}-`))
    workspaces.set(evalCase.name, workspace)
    const fixture = join(evalCase.dir, 'workspace')
    if (existsSync(fixture)) cpSync(fixture, workspace, { recursive: true })

    const before = new Map<string, string>()
    if (existsSync(fixture)) {
      for (const file of listFixtureFiles(fixture)) before.set(file, hashFile(join(fixture, file)))
    }

    // A crashed executor reports zero figures: the case fails on the thrown
    // message rather than on a fabricated measurement.
    let execution: CaseExecution = { turns: 0, uncachedInputTokens: 0, outputTokens: 0, wallMs: 0 }
    let failures: string[] = []
    try {
      execution = await executor.execute(evalCase, workspace)
      failures = evaluateAssertions({ workspace, before }, evalCase.assertions)
    } catch (error: unknown) {
      failures = [error instanceof Error ? error.message : String(error)]
    }

    const outcome: CaseOutcome = {
      name: evalCase.name,
      status: failures.length === 0 ? 'passed' : 'failed',
      failures,
      ...execution,
    }
    outcomes.push(outcome)
    options.onCase?.({ name: evalCase.name, phase: 'done', outcome })
    if (options.keepWorkspaces !== true) rmSync(workspace, { recursive: true, force: true })
  }

  return { run: { cases: outcomes }, workspaces }
}

/**
 * Read the per-file fixture hashes a case would start from.
 * @param evalCase - the loaded case.
 * @returns SHA-256 by workspace-relative path.
 */
export function fixtureHashes(evalCase: EvalCase): Map<string, string> {
  const fixture = join(evalCase.dir, 'workspace')
  const hashes = new Map<string, string>()
  if (!existsSync(fixture)) return hashes
  for (const file of listFixtureFiles(fixture)) hashes.set(file, hashFile(join(fixture, file)))
  return hashes
}

/**
 * Read a file as UTF-8 text, for diagnostics.
 * @param path - absolute path.
 * @returns the file's text.
 */
export function readText(path: string): string {
  return readFileSync(path, 'utf8')
}
