/**
 * Case loading and validation. A case directory holds `eval.yml` (the run
 * configuration, the assertion list, and the fixture file list) and `task.md`
 * (the prompt). Loading fails loud on anything a run cannot honour, so a
 * malformed case is a red lane rather than a silent pass.
 *
 * @module @deepseek-ai/dsh-evals/case
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import * as yaml from 'js-yaml'
import type { EvalAssertion, EvalCase } from './types.ts'

/** Assertion kinds the loader accepts. */
const ASSERTION_KINDS = new Set(['file-exists', 'file-contains', 'file-not-contains', 'unchanged', 'command'])

/** Raised when a case directory cannot be loaded as a runnable case. */
export class EvalCaseError extends Error {
  /**
   * @param message - what is wrong with the case.
   */
  constructor(message: string) {
    super(message)
    this.name = 'EvalCaseError'
  }
}

/**
 * List every workspace-relative file under a fixture directory.
 * @param dir - absolute fixture directory.
 * @returns sorted workspace-relative paths.
 */
export function listFixtureFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join('/'))
      else throw new EvalCaseError(`unsupported fixture entry: ${full}`)
    }
  }
  walk(dir)
  return out
}

/**
 * Parse and validate one assertion entry.
 * @param value - the raw YAML value.
 * @param name - case name, used in diagnostics.
 * @returns the typed assertion.
 */
function parseAssertion(value: unknown, name: string): EvalAssertion {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvalCaseError(`${name}: every assertion must be a mapping`)
  }
  const entry = value as Record<string, unknown>
  const kind = entry['kind']
  if (typeof kind !== 'string' || !ASSERTION_KINDS.has(kind)) {
    throw new EvalCaseError(`${name}: unknown assertion kind ${JSON.stringify(kind)}`)
  }
  const text = (key: string): string => {
    const found = entry[key]
    if (typeof found !== 'string' || found.length === 0) {
      throw new EvalCaseError(`${name}: assertion ${kind} requires a non-empty ${key}`)
    }
    return found
  }
  switch (kind) {
    case 'file-exists':
    case 'unchanged':
      return { kind, path: text('path') }
    case 'file-contains':
    case 'file-not-contains':
      return { kind, path: text('path'), text: text('text') }
    case 'command': {
      const expectExit = entry['expectExit']
      if (typeof expectExit !== 'number' || !Number.isInteger(expectExit)) {
        throw new EvalCaseError(`${name}: assertion command requires an integer expectExit`)
      }
      const expectStdout = entry['expectStdout']
      if (expectStdout !== undefined && typeof expectStdout !== 'string') {
        throw new EvalCaseError(`${name}: assertion command expectStdout must be a string`)
      }
      return {
        kind,
        run: text('run'),
        expectExit,
        ...expectStdout === undefined ? {} : { expectStdout },
      }
    }
    /* v8 ignore next 2 -- the kind guard above admits exactly these members */
    default:
      throw new EvalCaseError(`${name}: unknown assertion kind ${String(kind)}`)
  }
}

/**
 * Load one case directory.
 * @param dir - absolute case directory.
 * @returns the runnable case.
 * @throws EvalCaseError when a required file is missing or malformed.
 */
export function loadCase(dir: string): EvalCase {
  const name = dir.split(sep).pop() ?? dir
  const configPath = join(dir, 'eval.yml')
  const taskPath = join(dir, 'task.md')
  const fixtureDir = join(dir, 'workspace')

  const config = yaml.load(readFileSync(configPath, 'utf8'))
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new EvalCaseError(`${name}: eval.yml must be a mapping`)
  }
  const record = config as Record<string, unknown>
  const profile = record['profile']
  if (typeof profile !== 'string' || profile.length === 0) throw new EvalCaseError(`${name}: eval.yml requires a profile`)
  const timeoutMs = record['timeoutMs'] ?? 600_000
  const maxTurns = record['maxTurns'] ?? 24
  if (typeof timeoutMs !== 'number' || timeoutMs <= 0) throw new EvalCaseError(`${name}: timeoutMs must be positive`)
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns <= 0) {
    throw new EvalCaseError(`${name}: maxTurns must be a positive integer`)
  }
  const assertions = record['assertions']
  if (!Array.isArray(assertions) || assertions.length === 0) {
    throw new EvalCaseError(`${name}: eval.yml requires at least one assertion`)
  }
  const task = readFileSync(taskPath, 'utf8').trim()
  if (task.length === 0) throw new EvalCaseError(`${name}: task.md is empty`)

  let files: string[] = []
  try {
    if (statSync(fixtureDir).isDirectory()) files = listFixtureFiles(fixtureDir)
  } catch {
    files = []
  }

  return {
    name,
    dir,
    task,
    profile,
    timeoutMs,
    maxTurns,
    files,
    assertions: assertions.map(assertion => parseAssertion(assertion, name)),
  }
}

/**
 * Load every case under a cases root, sorted by name.
 * @param casesRoot - absolute `evals/cases` directory.
 * @param filter - case names to keep; an absent filter keeps every case.
 * @returns the runnable cases.
 * @throws EvalCaseError when the root holds no case or a filter names an unknown case.
 */
export function loadCases(casesRoot: string, filter?: readonly string[]): EvalCase[] {
  const entries = readdirSync(casesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
  const selected = filter === undefined ? entries : entries.filter(name => filter.includes(name))
  if (filter !== undefined) {
    const unknown = filter.filter(name => !entries.includes(name))
    if (unknown.length > 0) throw new EvalCaseError(`unknown case(s): ${unknown.join(', ')}`)
  }
  if (selected.length === 0) throw new EvalCaseError(`no cases under ${resolve(casesRoot)}`)
  return selected.map(name => loadCase(join(casesRoot, name)))
}
