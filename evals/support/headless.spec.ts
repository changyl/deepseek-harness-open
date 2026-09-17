import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { priceRun, readRunUsage } from './headless.ts'
import type { EvalRates } from './headless.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function log(lines: readonly unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eval-log-'))
  roots.push(root)
  const path = join(root, 'session.jsonl')
  writeFileSync(path, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'))
  return path
}

const RATES: EvalRates = {
  currency: 'CNY',
  routes: [{
    provider: 'deepseek',
    model: 'chat',
    uncachedInputPerMillion: 2_000_000,
    outputPerMillion: 8_000_000,
    cacheReadPerMillion: 200_000,
    cacheWritePerMillion: 2_500_000,
  }],
}

describe('headless run measurement', () => {
  it('folds turns, buckets, and the newest route out of the session log', () => {
    const usage = readRunUsage(log([
      { type: 'request/context', data: { provider: 'deepseek', model: 'chat' } },
      { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 } } },
      { type: 'turn/end', data: {} },
      { type: 'assistant/attempt', data: { usage: { inputTokens: 10, outputTokens: 2, cacheWriteTokens: 7 } } },
      { type: 'request/context', data: { provider: 'local', model: 'llama' } },
      { type: 'turn/end', data: {} },
    ]))
    expect(usage).toEqual({
      turns: 2,
      uncachedInputTokens: 110,
      outputTokens: 22,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      route: { provider: 'local', model: 'llama' },
    })
  })

  it('ignores malformed lines, absent usage, and invalid numbers', () => {
    const usage = readRunUsage(log([
      '{ this is not json',
      '',
      { type: 'assistant/message', data: {} },
      { type: 'assistant/message', data: { usage: { inputTokens: -5, outputTokens: 'many' } } },
      { type: 'request/context', data: { provider: 7, model: 'chat' } },
    ]))
    expect(usage).toEqual({
      turns: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('prices a routed run and leaves an unpriced or unrouted one without a cost', () => {
    const routed = {
      turns: 1,
      uncachedInputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      route: { provider: 'deepseek', model: 'chat' },
    }
    expect(priceRun(routed, RATES)).toBe(2_800_000)
    expect(priceRun({ ...routed, route: { provider: 'local', model: 'llama' } }, RATES)).toBeUndefined()
    const { route: _route, ...unrouted } = routed
    expect(priceRun(unrouted, RATES)).toBeUndefined()
  })
})
