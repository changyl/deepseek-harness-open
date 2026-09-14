/**
 * Local filesystem agent-definition provider.
 *
 * This package is one implementation of the `ctx.agentDefinitions` provider
 * registry. It discovers flat Markdown definition files from project, custom,
 * and user roots, parses their YAML frontmatter, and loads persona bodies
 * through `ctx.fs` when a filesystem service is present.
 *
 * @module @deepseek-ai/dsh-agent-definitions-filesystem
 */

import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import type { FileSystem, FsDirEntry } from '@deepseek-ai/dsh-fs'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  isAgentDefinitionName,
  type AgentDefinition,
  type AgentDefinitionCandidate,
  type AgentDefinitionLookupOptions,
  type AgentDefinitionProvider,
  type AgentDefinitionProviderObservation,
  type AgentDefinitionSource,
} from '@deepseek-ai/dsh-agent-definitions'

const PROJECT_DSH_RANK = 100
const PROJECT_AGENTS_RANK = 200
const CUSTOM_RANK = 300
const USER_DSH_RANK = 400
const USER_AGENTS_RANK = 500

const DEFINITION_FIELDS = new Set([
  'name',
  'description',
  'tools',
  'model',
  'reasoning_effort',
  'max_depth',
])

export const name = 'agent-definitions-filesystem'
export const inject = ['agentDefinitions']

/** Local filesystem agent-definition provider configuration. */
export interface Config {
  /** Unique provider name. Defaults to `filesystem`. */
  providerName?: string
  /** Whether project and user roots are included around custom roots. */
  includeDefaultRoots?: boolean
  /** DeepSeek Harness config root. Defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root. Defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
  /** Additional definition roots scanned after project roots and before user roots. */
  customAgentDirs?: string[]
}

/* jscpd:ignore-start -- sibling local providers keep the same root-selection configuration shape. */
export const Config: Schema<Config> = z.object({
  providerName: z.string().min(1).default('filesystem'),
  includeDefaultRoots: z.boolean().default(true),
  dshHome: z.string(),
  agentsHome: z.string(),
  customAgentDirs: z.array(z.string()).default([]),
})
/* jscpd:ignore-end */

interface DefinitionRoot {
  path: string
  source: AgentDefinitionSource
  rank: number
}

interface RootEntry {
  name: string
  path: string
  directory: boolean
}

interface ParsedDefinition {
  name: string
  description: string
  tools?: readonly string[]
  model?: string
  reasoningEffort?: string
  maxDepth?: number
  instructions: string
  path: string
}

/**
 * Register the local filesystem provider on the agent-definition registry.
 * @param ctx - the plugin context; `agentDefinitions` is an injected service.
 * @param config - provider name and the roots to scan.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.agentDefinitions.registerProvider(() => new FileSystemAgentDefinitionProvider(ctx, config))
}

/** Provider that maps local project, custom, and user definition roots into `ctx.agentDefinitions`. */
export class FileSystemAgentDefinitionProvider implements AgentDefinitionProvider {
  readonly name: string
  private readonly includeDefaultRoots: boolean
  private readonly dshHome: string
  private readonly agentsHome: string
  private readonly customAgentDirs: string[]

  constructor(
    private readonly ctx: Context,
    config: Config = {},
  ) {
    /* jscpd:ignore-start -- sibling local providers resolve the same project, custom, and user roots. */
    this.name = config.providerName ?? 'filesystem'
    this.includeDefaultRoots = config.includeDefaultRoots ?? true
    this.dshHome = resolveDshHome(config.dshHome)
    this.agentsHome = resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'))
    this.customAgentDirs = (config.customAgentDirs ?? []).map(root => resolve(root))
  /* jscpd:ignore-end */
  }

  /**
   * Discover local definition summaries for a cwd-sensitive workspace.
   * @param options - lookup options; `cwd` selects the project roots to scan.
   * @returns provider candidates, or an incomplete observation when one root could not be listed.
   */
  async list(
    options: AgentDefinitionLookupOptions,
  ): Promise<readonly AgentDefinitionCandidate[] | AgentDefinitionProviderObservation> {
    const roots = await this.roots(options.cwd)
    const definitions: AgentDefinitionCandidate[] = []
    let complete = true
    for (const root of roots) {
      try {
        for (const definition of await discoverRoot(root, this.ctx, this.name)) definitions.push(definition)
      } catch (error) {
        options.signal?.throwIfAborted()
        // A root that cannot be listed hides every definition it owns, so the
        // observation is incomplete: consumers keep last-good instead of
        // presenting a transient failure as removal.
        complete = false
        this.ctx.logger.warn(`agent-definition root ${root.path} skipped: ${errorMessage(error)}`)
      }
    }
    return complete ? definitions : { definitions, complete }
  }

  /**
   * Load a complete definition body from the candidate's file locator.
   * @param candidate - the winning candidate returned by this provider.
   * @param options - lookup options whose signal cancels filesystem reads.
   * @returns the full definition, or `undefined` if the file disappeared or no longer parses.
   */
  async get(
    candidate: AgentDefinitionCandidate,
    options: AgentDefinitionLookupOptions,
  ): Promise<AgentDefinition | undefined> {
    const parsed = await parseDefinitionFile(locatorPath(candidate), this.ctx, options.signal)
    if (parsed === undefined) return undefined
    return {
      ...summaryOf(parsed),
      source: candidate.source,
      provider: this.name,
      instructions: parsed.instructions,
    }
  }

  private async roots(cwd: string | undefined): Promise<DefinitionRoot[]> {
    const roots: DefinitionRoot[] = []
    if (this.includeDefaultRoots && cwd !== undefined) {
      const projectRoot = await findProjectRoot(resolve(cwd), this.ctx.get('fs'))
      roots.push(
        { path: join(projectRoot, '.dsh/agents'), source: 'project-dsh', rank: PROJECT_DSH_RANK },
        { path: join(projectRoot, '.agents/agents'), source: 'project-agents', rank: PROJECT_AGENTS_RANK },
      )
    }
    roots.push(...this.customAgentDirs.map(path => ({ path, source: 'custom' as const, rank: CUSTOM_RANK })))
    if (this.includeDefaultRoots) {
      roots.push(
        { path: join(this.dshHome, 'agents'), source: 'user-dsh', rank: USER_DSH_RANK },
        { path: join(this.agentsHome, 'agents'), source: 'user-agents', rank: USER_AGENTS_RANK },
      )
    }
    return roots
  }
}

function locatorPath(candidate: AgentDefinitionCandidate): string {
  return (candidate.locator as { path: string }).path
}

async function discoverRoot(root: DefinitionRoot, ctx: Context, provider: string): Promise<AgentDefinitionCandidate[]> {
  const definitions: AgentDefinitionCandidate[] = []
  const entries = (await listRootEntries(root, ctx)).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (entry.directory || !entry.name.endsWith('.md')) continue
    const parsed = await parseDefinitionFile(entry.path, ctx, undefined)
    if (parsed === undefined) continue
    definitions.push({
      ...summaryOf(parsed),
      provider,
      source: root.source,
      rank: root.rank,
      locator: { path: parsed.path },
    })
  }
  return definitions
}

function summaryOf(parsed: ParsedDefinition): {
  name: string
  description: string
  path: string
  tools?: readonly string[]
  model?: string
  reasoningEffort?: string
  maxDepth?: number
} {
  return {
    name: parsed.name,
    description: parsed.description,
    path: parsed.path,
    ...parsed.tools === undefined ? {} : { tools: parsed.tools },
    ...parsed.model === undefined ? {} : { model: parsed.model },
    ...parsed.reasoningEffort === undefined ? {} : { reasoningEffort: parsed.reasoningEffort },
    ...parsed.maxDepth === undefined ? {} : { maxDepth: parsed.maxDepth },
  }
}

async function listRootEntries(root: DefinitionRoot, ctx: Context): Promise<RootEntry[]> {
  const fs = ctx.get('fs')
  if (fs !== undefined) return await listRootEntriesFromFileSystem(root, fs)
  return await listRootEntriesFromNode(root)
}

async function listRootEntriesFromFileSystem(root: DefinitionRoot, fs: FileSystem): Promise<RootEntry[]> {
  let entries: FsDirEntry[]
  try {
    const target = await fs.resolve(root.path)
    entries = await fs.listDir(target)
  } catch (error) {
    if (isAbsentPathError(error)) return []
    throw error
  }
  return entries.map(entry => ({
    name: entry.name,
    path: entry.target.displayPath,
    // A symlinked definition resolves to its target, so only a listed
    // directory is excluded here; every other entry is probed by reading it.
    directory: entry.type === 'directory',
  }))
}

async function listRootEntriesFromNode(root: DefinitionRoot): Promise<RootEntry[]> {
  let entries
  try {
    entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    if (isAbsentPathError(error)) return []
    throw error
  }
  return entries.map(entry => ({
    name: entry.name,
    path: join(root.path, entry.name),
    directory: entry.isDirectory(),
  }))
}

async function parseDefinitionFile(path: string, ctx: Context, signal?: AbortSignal): Promise<ParsedDefinition | undefined> {
  const raw = await readDefinitionText(ctx, path, signal)
  signal?.throwIfAborted()
  if (raw === undefined) return undefined
  let parsed
  try {
    parsed = parseFrontmatter(raw.content)
  } catch (error) {
    ctx.logger.warn(`agent definition ${path} ignored: invalid YAML frontmatter: ${errorMessage(error)}`)
    return undefined
  }
  if (parsed === undefined) {
    ctx.logger.warn(`agent definition ${path} ignored: missing YAML frontmatter`)
    return undefined
  }
  try {
    return parseDefinition(parsed.data, parsed.body, raw.path)
  } catch (error) {
    ctx.logger.warn(`agent definition ${path} ignored: ${errorMessage(error)}`)
    return undefined
  }
}

function parseDefinition(
  data: Record<string, unknown>,
  body: string,
  resolvedPath: string,
): ParsedDefinition {
  // An unknown key is rejected rather than ignored: a silently dropped `tools`
  // would run the child with the full inherited tool set.
  const unknown = Object.keys(data).find(key => !DEFINITION_FIELDS.has(key))
  if (unknown !== undefined) {
    throw new Error(`frontmatter field "${unknown}" is unsupported`)
  }
  const definitionName = stringField(data, 'name')
  if (definitionName === undefined) throw new Error('frontmatter requires a name')
  if (!isAgentDefinitionName(definitionName)) {
    throw new Error(`invalid agent-definition name "${definitionName}"`)
  }
  const description = stringField(data, 'description')
  if (description === undefined) throw new Error('frontmatter requires a description')
  const instructions = body.trim()
  if (instructions.length === 0) throw new Error('the definition body is the child persona and must not be empty')
  const tools = parseTools(data)
  const model = stringField(data, 'model')
  const reasoningEffort = stringField(data, 'reasoning_effort')
  const maxDepth = parseMaxDepth(data)
  return {
    name: definitionName,
    description,
    ...tools === undefined ? {} : { tools },
    ...model === undefined ? {} : { model },
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
    ...maxDepth === undefined ? {} : { maxDepth },
    instructions,
    path: resolvedPath,
  }
}

function parseTools(data: Record<string, unknown>): readonly string[] | undefined {
  if (!Object.hasOwn(data, 'tools')) return undefined
  const value = data['tools']
  const tools = typeof value === 'string'
    // A comma-separated string is accepted for familiarity with agent
    // definition files authored for other harnesses.
    ? value.split(',').map(tool => tool.trim())
    : Array.isArray(value) ? value : undefined
  if (tools === undefined) throw new Error('frontmatter field "tools" must be a list of tool names')
  if (tools.length === 0) throw new Error('frontmatter field "tools" must name at least one tool; omit it to inherit the child\'s tools')
  for (const tool of tools) {
    if (typeof tool !== 'string' || tool.length === 0) {
      throw new Error('frontmatter field "tools" must contain non-empty tool names')
    }
  }
  return tools as readonly string[]
}

function parseMaxDepth(data: Record<string, unknown>): number | undefined {
  if (!Object.hasOwn(data, 'max_depth')) return undefined
  const value = data['max_depth']
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('frontmatter field "max_depth" must be a non-negative integer')
  }
  return value
}

interface DefinitionText {
  path: string
  content: string
}

async function readDefinitionText(ctx: Context, path: string, signal?: AbortSignal): Promise<DefinitionText | undefined> {
  signal?.throwIfAborted()
  const fs = ctx.get('fs')
  if (fs !== undefined) {
    try {
      const target = await fs.resolve(path, signal === undefined ? undefined : { signal })
      signal?.throwIfAborted()
      return { path: target.displayPath, content: await fs.readText(target, signal) }
    } catch (error) {
      signal?.throwIfAborted()
      if (isAbsentPathError(error)) return undefined
      throw error
    }
  }
  try {
    const resolvedPath = await realpath(path)
    return { path: resolvedPath, content: await readFile(resolvedPath, { encoding: 'utf8', signal }) }
  } catch (error) {
    signal?.throwIfAborted()
    if (isAbsentPathError(error)) return undefined
    throw error
  }
}

/* jscpd:ignore-start -- both local Markdown providers read the same YAML frontmatter block. */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const yaml = raw.slice(start, closing.start)
  const parsed = parseYaml(yaml) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
}
/* jscpd:ignore-end */

/* jscpd:ignore-start -- both local Markdown providers locate the nearest project root the same way. */
async function findProjectRoot(cwd: string, fs: FileSystem | undefined): Promise<string> {
  let current = cwd
  for (;;) {
    if (await pathExists(join(current, '.git'), fs)) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

async function pathExists(path: string, fs: FileSystem | undefined): Promise<boolean> {
  if (fs !== undefined) {
    try {
      const target = await fs.resolve(path)
      return await fs.stat(target) !== undefined
    } catch {
      // A backend may reject or hide this candidate; continue walking upward.
      return false
    }
  }
  try {
    await access(path)
    return true
  } catch {
    // Missing host paths are expected while walking toward the filesystem root.
    return false
  }
}
/* jscpd:ignore-end */

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isAbsentPathError(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT')
    || hasErrorCode(error, 'ENOTDIR')
    || hasErrorCode(error, 'EISDIR')
    || hasErrorCode(error, 'FS_NOT_FOUND')
    || hasErrorCode(error, 'FS_NOT_DIRECTORY')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function errorMessage(error: unknown): string {
  return String(error)
}
