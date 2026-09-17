import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateAssertions, hashFile } from './assertions.ts'
import type { AssertionContext } from './assertions.ts'
import type { EvalAssertion } from './types.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-eval-assert-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

function context(root: string, before: Record<string, string> = {}): AssertionContext {
  const hashes = new Map<string, string>()
  for (const path of Object.keys(before)) hashes.set(path, hashFile(join(root, path)))
  return { workspace: root, before: hashes }
}

function check(root: string, assertions: readonly EvalAssertion[], before: Record<string, string> = {}): string[] {
  return evaluateAssertions(context(root, before), assertions)
}

describe('assertion evaluation', () => {
  it('checks file presence, content, and absence', () => {
    const root = workspace({ 'src/out.txt': 'hello world' })
    expect(check(root, [{ kind: 'file-exists', path: 'src/out.txt' }])).toEqual([])
    expect(check(root, [{ kind: 'file-exists', path: 'src/missing.txt' }]))
      .toEqual(['src/missing.txt does not exist'])
    expect(check(root, [{ kind: 'file-exists', path: 'src' }])).toEqual(['src does not exist'])
    expect(check(root, [{ kind: 'file-contains', path: 'src/out.txt', text: 'world' }])).toEqual([])
    expect(check(root, [{ kind: 'file-contains', path: 'src/out.txt', text: 'mars' }]))
      .toEqual(['src/out.txt does not contain "mars"'])
    expect(check(root, [{ kind: 'file-contains', path: 'src/gone.txt', text: 'x' }]))
      .toEqual(['src/gone.txt does not exist'])
    expect(check(root, [{ kind: 'file-not-contains', path: 'src/out.txt', text: 'hello' }]))
      .toEqual(['src/out.txt still contains "hello"'])
    expect(check(root, [{ kind: 'file-not-contains', path: 'src/out.txt', text: 'mars' }])).toEqual([])
  })

  it('compares a file against its pre-run hash, including absence', () => {
    const root = workspace({ 'kept.txt': 'same', 'other.txt': 'edited' })
    // The context is captured before the run mutates anything, which is what
    // the suite does; hashing at assertion time would compare a file to itself.
    const before = context(root, { 'kept.txt': 'same', 'other.txt': 'edited' })
    expect(evaluateAssertions(before, [{ kind: 'unchanged', path: 'kept.txt' }])).toEqual([])
    writeFileSync(join(root, 'other.txt'), 'changed')
    expect(evaluateAssertions(before, [{ kind: 'unchanged', path: 'other.txt' }]))
      .toEqual(['other.txt changed but must stay unchanged'])
    rmSync(join(root, 'kept.txt'))
    expect(evaluateAssertions(before, [{ kind: 'unchanged', path: 'kept.txt' }]))
      .toEqual(['kept.txt was deleted but must stay unchanged'])
    writeFileSync(join(root, 'new.txt'), 'created')
    expect(evaluateAssertions(before, [{ kind: 'unchanged', path: 'new.txt' }]))
      .toEqual(['new.txt was created but must stay absent'])
    expect(evaluateAssertions(before, [{ kind: 'unchanged', path: 'never.txt' }])).toEqual([])
  })

  it('runs a command and checks its exit code and stdout', () => {
    const root = workspace({ 'ok.js': "console.log('port: 9090')\n", 'bad.js': "process.exit(2)\n" })
    expect(check(root, [{ kind: 'command', run: 'node ok.js', expectExit: 0 }])).toEqual([])
    expect(check(root, [{ kind: 'command', run: 'node ok.js', expectExit: 0, expectStdout: 'port: 9090' }])).toEqual([])
    expect(check(root, [{ kind: 'command', run: 'node ok.js', expectExit: 0, expectStdout: 'port: 8080' }]))
      .toEqual(['`node ok.js` printed "port: 9090", expected "port: 8080"'])
    expect(check(root, [{ kind: 'command', run: 'node bad.js', expectExit: 0 }]))
      .toEqual(['`node bad.js` exited 2, expected 0'])
    const missing = check(root, [{ kind: 'command', run: 'definitely-not-a-command', expectExit: 0 }])
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatch(/exited \d+, expected 0/)
  })

  it('refuses an assertion path outside the workspace', () => {
    const root = workspace({ 'inside.txt': 'x' })
    expect(() => check(root, [{ kind: 'file-exists', path: '/etc/passwd' }]))
      .toThrow(/must be workspace-relative/)
    expect(() => check(root, [{ kind: 'file-exists', path: '../escape.txt' }]))
      .toThrow(/escapes the workspace/)
  })
})
