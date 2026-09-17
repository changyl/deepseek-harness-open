import { describe, expect, it } from 'vitest'
import { baselineFrom, caseDigest, compareTasks, compareToBaseline, scoreRun, taskDigests } from './score.ts'
import { renderRun } from './report.ts'
import type { CaseOutcome, EvalCase, EvalRun } from './types.ts'

function outcome(name: string, overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    name,
    status: 'passed',
    failures: [],
    turns: 2,
    uncachedInputTokens: 100,
    outputTokens: 40,
    wallMs: 1_000,
    ...overrides,
  }
}

function one(name: string, overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    name,
    dir: `/cases/${name}`,
    task: `task ${name}`,
    profile: 'headless',
    timeoutMs: 120_000,
    maxTurns: 8,
    files: ['a.js'],
    assertions: [],
    ...overrides,
  }
}

function run(...cases: CaseOutcome[]): EvalRun {
  return { cases }
}

describe('eval scoring', () => {
  it('aggregates pass counts, tokens, cost, and the per-solved ratios', () => {
    const score = scoreRun(run(
      outcome('a', { costMicros: 1_000 }),
      outcome('b', { status: 'failed', failures: ['x'], uncachedInputTokens: 200, outputTokens: 0, costMicros: 3_000 }),
    ))
    expect(score).toEqual({
      solved: 1,
      failed: 1,
      passRate: 0.5,
      uncachedInputTokens: 300,
      outputTokens: 40,
      costMicros: 4_000,
      tokensPerSolved: 340,
      costPerSolved: 4_000,
    })
  })

  it('omits the ratios when nothing was solved or priced', () => {
    expect(scoreRun(run()).passRate).toBe(0)
    const failed = scoreRun(run(outcome('a', { status: 'failed', failures: ['x'], costMicros: 10 })))
    expect(failed.tokensPerSolved).toBeUndefined()
    expect(failed.costPerSolved).toBeUndefined()
    const unpriced = scoreRun(run(outcome('a')))
    expect(unpriced.costPerSolved).toBeUndefined()
    expect(unpriced.costMicros).toBe(0)
  })

  it('records a baseline and reports regressions, additions, and uncovered cases', () => {
    const first = run(outcome('a'), outcome('b', { status: 'failed', failures: ['x'] }))
    const baseline = baselineFrom(first)
    expect(baseline).toEqual({ version: 1, cases: { a: 'passed', b: 'failed' } })

    expect(compareToBaseline(first, baseline)).toEqual({ regressions: [], added: [], uncovered: [] })
    // A case that was recorded as failing may still fail or pass without a regression.
    expect(compareToBaseline(run(outcome('a'), outcome('b')), baseline).regressions).toEqual([])
    expect(compareToBaseline(run(outcome('a', { status: 'failed', failures: ['x'] }), outcome('b')), baseline).regressions)
      .toEqual(['a'])
    expect(compareToBaseline(run(outcome('a'), outcome('b'), outcome('c')), baseline).added).toEqual(['c'])
    expect(compareToBaseline(run(outcome('a')), baseline).uncovered).toEqual(['b'])
    expect(compareToBaseline(run(outcome('c')), undefined)).toEqual({ regressions: [], added: [], uncovered: [] })
  })

  it('digests each golden task over its prompt, bounds, fixtures, and assertions', () => {
    const evalCase = one('a')
    expect(caseDigest(evalCase)).toBe(caseDigest(one('a')))
    expect(caseDigest(one('a', { task: 'different' }))).not.toBe(caseDigest(evalCase))
    expect(caseDigest(one('a', { maxTurns: 3 }))).not.toBe(caseDigest(evalCase))
    expect(caseDigest(one('a', { files: ['b.js', 'a.js'] }))).toBe(caseDigest(one('a', { files: ['a.js', 'b.js'] })))
    expect(caseDigest(one('a', { profile: 'other' }))).not.toBe(caseDigest(evalCase))
    expect(taskDigests([one('a'), one('b')])).toEqual({ a: caseDigest(one('a')), b: caseDigest(one('b')) })
  })

  it('reports task drift, additions, and uncovered baseline digests without a model run', () => {
    const recorded = { version: 1 as const, cases: {}, tasks: taskDigests([one('a'), one('b')]) }
    expect(compareTasks([one('a'), one('b')], recorded)).toEqual({ added: [], changed: [], removed: [] })
    expect(compareTasks([one('a', { task: 'edited' }), one('b')], recorded).changed).toEqual(['a'])
    expect(compareTasks([one('a'), one('b'), one('c')], recorded).added).toEqual(['c'])
    expect(compareTasks([one('a')], recorded).removed).toEqual(['b'])
    // A baseline recorded before task digests existed enforces nothing keylessly.
    expect(compareTasks([one('a')], { version: 1, cases: {} })).toEqual({ added: [], changed: [], removed: [] })
  })

  it('renders one line per case plus the aggregate line', () => {
    const lines = renderRun(run(
      outcome('a', { costMicros: 1_500 }),
      outcome('b', { status: 'failed', failures: ['boom'], turns: 3 }),
    ))
    expect(lines[0]).toBe('case\tstatus\tturns\ttokens\tcost(µ)\tms')
    expect(lines[1]).toBe('a\tpassed\t2\t140\t1500\t1000')
    expect(lines[2]).toBe('b\tfailed\t3\t140\t-\t1000')
    expect(lines[3]).toBe('  ! boom')
    expect(lines[4]).toBe('solved 1/2 (pass 50.0%) tokens 280 tokens/solved 280 cost/solved 1500µ')
  })
})
