import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EvalCaseError, listFixtureFiles, loadCase, loadCases } from './case.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempCase(config: string, task = 'Do the thing.\n', fixture: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eval-case-'))
  roots.push(root)
  writeFileSync(join(root, 'eval.yml'), config)
  writeFileSync(join(root, 'task.md'), task)
  for (const [path, content] of Object.entries(fixture)) {
    const full = join(root, 'workspace', path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

const VALID = [
  'profile: headless',
  'assertions:',
  '  - kind: file-exists',
  '    path: out.txt',
  '',
].join('\n')

describe('eval case loading', () => {
  it('loads the three committed cases with their fixtures and assertions', () => {
    const cases = loadCases(join(import.meta.dirname, '..', 'cases'))
    expect(cases.map(evalCase => evalCase.name)).toEqual([
      'fix-off-by-one',
      'refactor-extract-helper',
      'repair-config-loader',
    ])
    const refactor = cases.find(evalCase => evalCase.name === 'refactor-extract-helper')!
    expect(refactor.profile).toBe('headless')
    expect(refactor.timeoutMs).toBe(600_000)
    expect(refactor.maxTurns).toBe(24)
    expect(refactor.task).toContain('helpers.js')
    expect(refactor.files).toEqual(['calculator.js', 'package.json', 'test.js'])
    expect(refactor.assertions.map(assertion => assertion.kind)).toEqual([
      'file-exists',
      'file-contains',
      'file-contains',
      'unchanged',
      'command',
    ])
    expect(refactor.assertions.at(-1)).toMatchObject({ run: 'node test.js', expectExit: 0 })

    const loader = cases.find(evalCase => evalCase.name === 'repair-config-loader')!
    expect(loader.assertions.at(-1)).toMatchObject({ expectStdout: 'port: 9090' })
  })

  it('filters to named cases and refuses an unknown name', () => {
    const casesRoot = join(import.meta.dirname, '..', 'cases')
    expect(loadCases(casesRoot, ['fix-off-by-one']).map(evalCase => evalCase.name)).toEqual(['fix-off-by-one'])
    expect(() => loadCases(casesRoot, ['nope'])).toThrow(EvalCaseError)
  })

  it('rejects a case that cannot run', () => {
    const missingProfile = tempCase('assertions:\n  - kind: file-exists\n    path: out.txt\n')
    expect(() => loadCase(missingProfile)).toThrow(/requires a profile/)

    const emptyAssertions = tempCase('profile: headless\nassertions: []\n')
    expect(() => loadCase(emptyAssertions)).toThrow(/at least one assertion/)

    const unknownKind = tempCase('profile: headless\nassertions:\n  - kind: whatever\n    path: x\n')
    expect(() => loadCase(unknownKind)).toThrow(/unknown assertion kind/)

    const missingPath = tempCase('profile: headless\nassertions:\n  - kind: file-contains\n    text: x\n')
    expect(() => loadCase(missingPath)).toThrow(/requires a non-empty path/)

    const badExit = tempCase('profile: headless\nassertions:\n  - kind: command\n    run: true\n    expectExit: yes\n')
    expect(() => loadCase(badExit)).toThrow(/integer expectExit/)

    const emptyTask = tempCase(VALID, '   \n')
    expect(() => loadCase(emptyTask)).toThrow(/task.md is empty/)

    const badTurns = tempCase('profile: headless\nmaxTurns: 0\nassertions:\n  - kind: file-exists\n    path: x\n')
    expect(() => loadCase(badTurns)).toThrow(/positive integer/)

    const badTimeout = tempCase('profile: headless\ntimeoutMs: -1\nassertions:\n  - kind: file-exists\n    path: x\n')
    expect(() => loadCase(badTimeout)).toThrow(/timeoutMs must be positive/)

    const notAMapping = tempCase('- one\n- two\n')
    expect(() => loadCase(notAMapping)).toThrow(/must be a mapping/)

    const badAssertion = tempCase('profile: headless\nassertions:\n  - just-a-string\n')
    expect(() => loadCase(badAssertion)).toThrow(/must be a mapping/)

    const badExpectStdout = tempCase('profile: headless\nassertions:\n  - kind: command\n    run: true\n    expectExit: 0\n    expectStdout: 3\n')
    expect(() => loadCase(badExpectStdout)).toThrow(/expectStdout must be a string/)
  })

  it('treats a case without a fixture directory as an empty workspace', () => {
    const root = tempCase(VALID)
    const loaded = loadCase(root)
    expect(loaded.files).toEqual([])
  })

  it('lists nested fixture files in sorted order and refuses other entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-fixture-'))
    roots.push(root)
    mkdirSync(join(root, 'b'))
    writeFileSync(join(root, 'b', 'two.txt'), 'two')
    writeFileSync(join(root, 'a.txt'), 'a')
    expect(listFixtureFiles(root)).toEqual(['a.txt', 'b/two.txt'])
  })

  it('refuses a cases root with no cases', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-empty-'))
    roots.push(root)
    expect(() => loadCases(root)).toThrow(/no cases under/)
  })
})
