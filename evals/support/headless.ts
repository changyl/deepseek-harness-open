/**
 * The shipped-profile executor: launch the CLI's headless profile in the
 * case's workspace, then read the run's own session log for its route, turns,
 * and provider-reported tokens. Nothing here parses the model's prose — the
 * figures come from the durable log the run produced.
 *
 * @module @deepseek-ai/dsh-evals/headless
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { routeCostMicros } from '@deepseek-ai/dsh-usage'
import type { UsageRoutePrice } from '@deepseek-ai/dsh-usage'
import { EvalCaseError } from './case.ts'
import type { CaseExecution, CaseExecutor } from './runner.ts'
import type { EvalCase } from './types.ts'

/** One route's rate, in integer micro-units per million tokens. */
export interface EvalRate extends UsageRoutePrice {
  /** Registered provider name. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** Deployment-owned rate card, loaded from `evals/rates.json` when present. */
export interface EvalRates {
  /** Currency of every rate. */
  readonly currency: string
  /** Priced routes. */
  readonly routes: readonly EvalRate[]
}

/** What one run's session log reported. */
export interface RunUsage {
  /** Closed turns. */
  readonly turns: number
  /** Provider-reported uncached input tokens. */
  readonly uncachedInputTokens: number
  /** Provider-reported output tokens. */
  readonly outputTokens: number
  /** Cache-read input tokens. */
  readonly cacheReadTokens: number
  /** Cache-write input tokens. */
  readonly cacheWriteTokens: number
  /** Newest route the log named, when it named one. */
  readonly route?: { readonly provider: string; readonly model: string }
}

/**
 * Read one session JSONL log's usage and newest route.
 * @param logPath - absolute path to the session's JSONL file.
 * @returns the folded figures.
 */
export function readRunUsage(logPath: string): RunUsage {
  let turns = 0
  let uncachedInputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let route: { provider: string; model: string } | undefined

  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue
    let event: { type?: unknown; data?: unknown }
    try {
      event = JSON.parse(line) as { type?: unknown; data?: unknown }
    } catch {
      // A torn final line is possible while the log is still being written;
      // the lane reads after the process exits, so a torn line is skipped.
      continue
    }
    if (event.type === 'turn/end') turns += 1
    if (event.type === 'request/context') {
      const data = event.data as { provider?: unknown; model?: unknown } | undefined
      if (typeof data?.provider === 'string' && typeof data.model === 'string') {
        route = { provider: data.provider, model: data.model }
      }
    }
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      const usage = (event.data as { usage?: Record<string, unknown> } | undefined)?.usage
      const number = (key: string): number => {
        const value = usage?.[key]
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
      }
      uncachedInputTokens += number('inputTokens')
      outputTokens += number('outputTokens')
      cacheReadTokens += number('cacheReadTokens')
      cacheWriteTokens += number('cacheWriteTokens')
    }
  }

  return {
    turns,
    uncachedInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    ...route === undefined ? {} : { route },
  }
}

/**
 * Price one run with the deployment's rate card.
 * @param usage - the run's folded figures.
 * @param rates - the loaded rate card.
 * @returns integer micro-units, or `undefined` when the route is unpriced.
 */
export function priceRun(usage: RunUsage, rates: EvalRates): number | undefined {
  if (usage.route === undefined) return undefined
  const rate = rates.routes.find(entry => entry.provider === usage.route?.provider && entry.model === usage.route.model)
  if (rate === undefined) return undefined
  return routeCostMicros(rate, usage)
}

/** Newest session log under one DSH home, or `undefined` when the run wrote none. */
function newestSessionLog(home: string): string | undefined {
  const sessionsRoot = join(home, 'sessions')
  let newest: { path: string; mtime: number } | undefined
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.jsonl')) continue
      const mtime = statSync(full).mtimeMs
      if (newest === undefined || mtime > newest.mtime) newest = { path: full, mtime }
    }
  }
  try {
    walk(sessionsRoot)
  } catch {
    return undefined
  }
  return newest?.path
}

/** Options for the shipped-profile executor. */
export interface HeadlessExecutorOptions {
  /** Repository root, used for the default launcher paths. */
  readonly root: string
  /** CLI entry to launch; defaults to the source launcher. */
  readonly bin?: string
  /** Rate card, when the deployment keeps one. */
  readonly rates?: EvalRates
}

/**
 * Create the executor that launches the shipped headless profile.
 * @param options - launcher paths and the optional rate card.
 * @returns an executor for {@link import('./runner.ts').runSuite}.
 */
export function createHeadlessExecutor(options: HeadlessExecutorOptions): CaseExecutor {
  const bin = options.bin ?? join(options.root, 'apps/cli/src/bin.ts')
  return {
    async execute(evalCase: EvalCase, workspace: string): Promise<CaseExecution> {
      const home = mkdtempSync(join(tmpdir(), `dsh-eval-home-${evalCase.name}-`))
      const started = Date.now()
      try {
        const result = spawnSync(process.execPath, ['--import', 'tsx/esm', bin, '--profile', evalCase.profile, evalCase.task], {
          cwd: workspace,
          encoding: 'utf8',
          timeout: evalCase.timeoutMs,
          env: { ...process.env, DSH_HOME: home },
        })
        const wallMs = Date.now() - started
        if (result.error !== undefined) throw result.error
        const log = newestSessionLog(home)
        if (log === undefined) {
          throw new EvalCaseError(`${evalCase.name}: the run wrote no session log; stderr: ${(result.stderr ?? '').slice(-2000)}`)
        }
        const usage = readRunUsage(log)
        if (usage.turns > evalCase.maxTurns) {
          throw new EvalCaseError(`${evalCase.name}: the run used ${String(usage.turns)} turns, over the ${String(evalCase.maxTurns)} ceiling`)
        }
        const costMicros = options.rates === undefined ? undefined : priceRun(usage, options.rates)
        return {
          turns: usage.turns,
          uncachedInputTokens: usage.uncachedInputTokens,
          outputTokens: usage.outputTokens,
          wallMs,
          ...costMicros === undefined ? {} : { costMicros },
        }
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
  }
}
