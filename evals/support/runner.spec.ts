import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EvalCaseError, loadCase } from './case.ts'
import { runSuite } from './runner.ts'
import type { CaseExecution, CaseExecutor } from './runner.ts'
import type { EvalCase } from './types.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Build one throwaway case directory with a fixture and a single assertion. */
function caseDir(assertions: string, fixture: Record<string, string> = { 'input.txt': 'before' }): EvalCase {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eval-runner-'))
  roots.push(root)
  writeFileSync(join(root, 'task.md'), 'Do the thing.\n')
  writeFileSync(join(root, 'eval.yml'), `profile: headless\nassertions:\n${assertions}`)
  if (Object.keys(fixture).length > 0) {
    mkdirSync(join(root, 'workspace'), { recursive: true })
    for (const [path, content] of Object.entries(fixture)) {
      writeFileSync(join(root, 'workspace', path), content)
    }
  }
  return loadCase(root)
}

const EXECUTION: CaseExecution = { turns: 2, uncachedInputTokens: 10, outputTokens: 5, wallMs: 42 }

/** An executor that edits the workspace the way a successful run would. */
function editor(mutate: (workspace: string) => void): CaseExecutor {
  return {
    execute: async (_evalCase, workspace) => {
      mutate(workspace)
      return EXECUTION
    },
  }
}

describe('eval suite runner', () => {
  it('passes a case whose executor left the expected workspace', async () => {
    const evalCase = caseDir('  - kind: unchanged\n    path: input.txt\n  - kind: file-exists\n    path: input.txt\n')
    const seen: string[] = []
    const { run } = await runSuite([evalCase], editor(() => {}), {
      onCase: event => seen.push(`${event.phase}:${event.name}`),
    })
    expect(run.cases).toHaveLength(1)
    expect(run.cases[0]).toMatchObject({ status: 'passed', failures: [], turns: 2, wallMs: 42 })
    expect(seen).toEqual(['start:' + evalCase.name, 'done:' + evalCase.name])
    // The workspace is removed unless the caller keeps it.
    expect(existsSync(join(tmpdir(), `dsh-eval-${evalCase.name}-`))).toBe(false)
  })

  it('fails a case whose assertions do not hold and keeps the workspace on request', async () => {
    const evalCase = caseDir('  - kind: file-exists\n    path: made.txt\n')
    const { run, workspaces } = await runSuite([evalCase], editor(() => {}), { keepWorkspaces: true })
    expect(run.cases[0]?.status).toBe('failed')
    expect(run.cases[0]?.failures).toEqual(['made.txt does not exist'])
    const workspace = workspaces.get(evalCase.name)
    expect(workspace !== undefined && existsSync(workspace)).toBe(true)
  })

  it('copies the fixture in and starts each case from the original bytes', async () => {
    const evalCase = caseDir('  - kind: unchanged\n    path: input.txt\n', { 'input.txt': 'original' })
    const { run, workspaces } = await runSuite([evalCase], editor((workspace) => {
      expect(readFileSync(join(workspace, 'input.txt'), 'utf8')).toBe('original')
      writeFileSync(join(workspace, 'input.txt'), 'edited')
    }), { keepWorkspaces: true })
    expect(run.cases[0]?.failures).toEqual(['input.txt changed but must stay unchanged'])
    // The committed fixture is untouched by a run.
    expect(readFileSync(join(evalCase.dir, 'workspace', 'input.txt'), 'utf8')).toBe('original')
    rmSync(workspaces.get(evalCase.name)!, { recursive: true, force: true })
  })

  it('reports a crashed executor as a failed case with zero figures', async () => {
    const evalCase = caseDir('  - kind: file-exists\n    path: input.txt\n')
    const failing: CaseExecutor = { execute: () => Promise.reject(new EvalCaseError('model run failed')) }
    const { run } = await runSuite([evalCase], failing)
    expect(run.cases[0]).toMatchObject({
      status: 'failed',
      failures: ['model run failed'],
      turns: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      wallMs: 0,
    })
  })

  it('runs every case in its own workspace', async () => {
    const first = caseDir('  - kind: file-exists\n    path: a.txt\n', { 'input.txt': 'a' })
    const second = caseDir('  - kind: file-exists\n    path: b.txt\n', { 'input.txt': 'b' })
    const workspaces: string[] = []
    const { run } = await runSuite([first, second], editor((workspace) => {
      workspaces.push(workspace)
      writeFileSync(join(workspace, 'marker.txt'), workspace)
    }), { keepWorkspaces: true })
    expect(run.cases.map(entry => entry.status)).toEqual(['failed', 'failed'])
    expect(new Set(workspaces).size).toBe(2)
    for (const workspace of workspaces) rmSync(workspace, { recursive: true, force: true })
  })
})
