/**
 * Assertion evaluation over the workspace one run left behind. Every check is
 * deterministic and independent of the model's own report: a case passes only
 * when the files and commands say so.
 *
 * @module @deepseek-ai/dsh-evals/assertions
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { EvalAssertion } from './types.ts'

/** What one evaluation reads. */
export interface AssertionContext {
  /** Absolute workspace the run produced. */
  readonly workspace: string
  /**
   * SHA-256 of every fixture file before the run, keyed by workspace-relative
   * path. A path the fixture did not hold is absent, so `unchanged` on a new
   * file means the run must not have created it.
   */
  readonly before: ReadonlyMap<string, string>
}

/**
 * Hash one file's bytes.
 * @param path - absolute file path.
 * @returns the lowercase hex SHA-256 digest.
 */
export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Resolve an assertion path inside the workspace, refusing escapes.
 * @param context - the evaluation context.
 * @param path - workspace-relative path.
 * @returns the absolute path.
 */
function insideWorkspace(context: AssertionContext, path: string): string {
  if (isAbsolute(path)) throw new Error(`assertion path must be workspace-relative: ${path}`)
  const resolved = resolve(context.workspace, path)
  const root = resolve(context.workspace)
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`assertion path escapes the workspace: ${path}`)
  }
  return resolved
}

/**
 * Evaluate every assertion.
 * @param context - workspace and pre-run hashes.
 * @param assertions - the case's checks, in order.
 * @returns one human-readable line per failure, empty when the case passed.
 */
export function evaluateAssertions(
  context: AssertionContext,
  assertions: readonly EvalAssertion[],
): string[] {
  const failures: string[] = []
  for (const assertion of assertions) {
    switch (assertion.kind) {
      case 'file-exists': {
        const path = insideWorkspace(context, assertion.path)
        if (!existsSync(path) || !statSync(path).isFile()) failures.push(`${assertion.path} does not exist`)
        break
      }
      case 'file-contains':
      case 'file-not-contains': {
        const path = insideWorkspace(context, assertion.path)
        if (!existsSync(path)) {
          failures.push(`${assertion.path} does not exist`)
          break
        }
        const contains = readFileSync(path, 'utf8').includes(assertion.text)
        if (assertion.kind === 'file-contains' && !contains) {
          failures.push(`${assertion.path} does not contain ${JSON.stringify(assertion.text)}`)
        }
        if (assertion.kind === 'file-not-contains' && contains) {
          failures.push(`${assertion.path} still contains ${JSON.stringify(assertion.text)}`)
        }
        break
      }
      case 'unchanged': {
        const path = insideWorkspace(context, assertion.path)
        const expected = context.before.get(assertion.path)
        if (expected === undefined) {
          if (existsSync(path)) failures.push(`${assertion.path} was created but must stay absent`)
          break
        }
        if (!existsSync(path)) {
          failures.push(`${assertion.path} was deleted but must stay unchanged`)
          break
        }
        if (hashFile(path) !== expected) failures.push(`${assertion.path} changed but must stay unchanged`)
        break
      }
      case 'command': {
        const result = spawnSync(assertion.run, {
          cwd: join(context.workspace),
          shell: true,
          encoding: 'utf8',
        })
        const status = result.status ?? -1
        if (status !== assertion.expectExit) {
          failures.push(`\`${assertion.run}\` exited ${String(status)}, expected ${String(assertion.expectExit)}`)
        }
        if (assertion.expectStdout !== undefined && (result.stdout ?? '').trim() !== assertion.expectStdout) {
          failures.push(
            `\`${assertion.run}\` printed ${JSON.stringify((result.stdout ?? '').trim())},`
            + ` expected ${JSON.stringify(assertion.expectStdout)}`,
          )
        }
        break
      }
    }
  }
  return failures
}
