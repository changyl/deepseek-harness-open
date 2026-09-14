/**
 * Unit tests for the local filesystem agent-definition provider.
 *
 * Each case builds a real temporary directory tree; `ctx.fs` is either absent
 * (native node reads) or a configurable stub backend, so both provider paths
 * are exercised.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat as statPath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentDefinitionsRegistry, {
  type AgentDefinitionCandidate,
  type AgentDefinitionProviderObservation,
} from '@deepseek-ai/dsh-agent-definitions'
import {
  FileSystem,
  FsError,
  FsVersion,
  type FsDirEntry,
  type FsEditOutcome,
  type FsEditRequest,
  type FsInfo,
  type FsPathInfo,
  type FsTarget,
  type FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import * as AgentDefinitionsFilesystem from '../src/index.ts'

type Provider = AgentDefinitionsFilesystem.FileSystemAgentDefinitionProvider

/** Every temp dir created by this file, removed after each test. */
const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-agent-definitions-${name}-`))
  tempDirs.push(dir)
  return await realpath(dir)
}

/** Render one Markdown definition file with the given frontmatter lines. */
function markdown(fields: readonly string[], body = 'Persona body.'): string {
  return `---\n${fields.join('\n')}\n---\n\n${body}\n`
}

async function writeDefinition(root: string, fileName: string, fields: readonly string[], body = 'Persona body.'): Promise<string> {
  return await writeRaw(root, fileName, markdown(fields, body))
}

async function writeRaw(root: string, fileName: string, content: string): Promise<string> {
  await mkdir(root, { recursive: true })
  const path = join(root, fileName)
  await writeFile(path, content)
  return path
}

/** Candidate list from either provider result form. */
function candidatesOf(
  result: readonly AgentDefinitionCandidate[] | AgentDefinitionProviderObservation,
): readonly AgentDefinitionCandidate[] {
  return 'definitions' in result ? result.definitions : result
}

/** First entry of a non-empty list. */
function first<T>(values: readonly T[]): T {
  const [value] = values
  if (value === undefined) throw new Error('expected at least one entry')
  return value
}

/** `ctx.fs` stub: real disk access plus per-path injected failures. */
class TestFileSystem extends FileSystem {
  resolveErrors = new Map<string, unknown>()
  listErrors = new Map<string, unknown>()
  readErrors = new Map<string, unknown>()
  resolveSignals: Array<AbortSignal | undefined> = []
  readSignals: Array<AbortSignal | undefined> = []
  readTextOverride?: (target: FsTarget, signal: AbortSignal | undefined) => Promise<string>

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    this.resolveSignals.push(opts?.signal)
    if (this.resolveErrors.has(path)) throw this.resolveErrors.get(path)
    return { targetKey: path as never, displayPath: path }
  }

  override processPath(target: FsTarget): string { return String(target.targetKey) }

  override fileUrl(target: FsTarget): string { return `file://${target.targetKey}` }

  override contains(parent: FsTarget, child: FsTarget): boolean {
    return String(child.targetKey) === String(parent.targetKey)
      || String(child.targetKey).startsWith(`${String(parent.targetKey)}/`)
  }

  override async stat(target: FsTarget, _signal?: AbortSignal): Promise<FsInfo | undefined> {
    try {
      const info = await statPath(target.displayPath)
      return {
        version: FsVersion('test'),
        type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
        size: info.size,
      }
    } catch {
      return undefined
    }
  }

  override async lstat(): Promise<FsPathInfo | undefined> { return undefined }

  override async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    this.readSignals.push(signal)
    if (this.readTextOverride !== undefined) return await this.readTextOverride(target, signal)
    if (this.readErrors.has(target.displayPath)) throw this.readErrors.get(target.displayPath)
    return await readFile(target.displayPath, 'utf8')
  }

  override async streamText(): Promise<AsyncIterable<string>> { throw new Error('not needed in definition tests') }

  override async readBytes(): Promise<Uint8Array> { throw new Error('not needed in definition tests') }

  override async readByteRange(): Promise<Uint8Array> { throw new Error('not needed in definition tests') }

  override async listDir(target: FsTarget): Promise<FsDirEntry[]> {
    if (this.listErrors.has(target.displayPath)) throw this.listErrors.get(target.displayPath)
    const entries = await readdir(target.displayPath, { withFileTypes: true, encoding: 'utf8' })
    const result: FsDirEntry[] = []
    for (const entry of entries) {
      const childPath = join(target.displayPath, entry.name)
      let type: FsInfo['type'] = 'other'
      try {
        const info = await statPath(childPath)
        type = info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other'
      } catch {
        type = 'other'
      }
      result.push({
        name: entry.name,
        type,
        target: { targetKey: childPath as never, displayPath: childPath },
        version: FsVersion('test'),
      })
    }
    return result
  }

  override async writeText(): Promise<FsWriteOutcome> { throw new Error('not needed in definition tests') }

  override async editText(_target: FsTarget, _request: FsEditRequest): Promise<FsEditOutcome> {
    throw new Error('not needed in definition tests')
  }
}

interface TestContext {
  ctx: Context
  warnings: string[]
  fs?: TestFileSystem
}

/** Context whose logger warnings are recorded instead of printed. */
async function createContext(options: { fileSystem?: boolean } = {}): Promise<TestContext> {
  const ctx = new Context()
  const warnings: string[] = []
  ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
  let fs: TestFileSystem | undefined
  if (options.fileSystem === true) {
    await ctx.plugin(TestFileSystem)
    fs = ctx.fs as TestFileSystem
  }
  return { ctx, warnings, ...(fs === undefined ? {} : { fs }) }
}

function createProvider(ctx: Context, home: string, config: Partial<AgentDefinitionsFilesystem.Config> = {}): Provider {
  return new AgentDefinitionsFilesystem.FileSystemAgentDefinitionProvider(ctx, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    ...config,
  })
}

/** Context with the real registry plus the provider plugin registered on it. */
async function mountPlugin(
  home: string,
  config: Partial<AgentDefinitionsFilesystem.Config> = {},
  options: { fileSystem?: boolean } = {},
): Promise<TestContext> {
  const mounted = await createContext(options)
  await mounted.ctx.plugin(AgentDefinitionsRegistry)
  await mounted.ctx.plugin(AgentDefinitionsFilesystem, {
    dshHome: join(home, '.dsh'),
    agentsHome: join(home, '.agents'),
    ...config,
  })
  return mounted
}

/** Project root marker plus the definition written into it. */
async function projectWithDefinition(name: string, root: string, fields: readonly string[]): Promise<string> {
  const project = await tempDir(`project-${name}`)
  await mkdir(join(project, '.git'), { recursive: true })
  await writeDefinition(join(project, root), `${name}.md`, fields)
  return project
}

describe('plugin exports', () => {
  it('declares its plugin metadata and defaulted configuration schema', () => {
    expect(AgentDefinitionsFilesystem.name).toBe('agent-definitions-filesystem')
    expect(AgentDefinitionsFilesystem.inject).toEqual(['agentDefinitions'])
    expect(AgentDefinitionsFilesystem.Config({})).toMatchObject({
      providerName: 'filesystem',
      includeDefaultRoots: true,
      customAgentDirs: [],
    })
    expect(() => AgentDefinitionsFilesystem.Config({ providerName: '' })).toThrow()
  })

  it('registers a provider that the agentDefinitions registry lists and loads', async () => {
    const home = await tempDir('register-home')
    const project = await projectWithDefinition('alpha', '.dsh/agents', ['name: alpha', 'description: Alpha definition'])
    const { ctx, warnings } = await mountPlugin(home)

    expect(await ctx.agentDefinitions.list({ cwd: join(project, 'nested') })).toEqual([{
      name: 'alpha',
      description: 'Alpha definition',
      source: 'project-dsh',
      provider: 'filesystem',
      path: join(project, '.dsh/agents/alpha.md'),
    }])
    expect(await ctx.agentDefinitions.get('alpha', { cwd: project })).toMatchObject({
      name: 'alpha',
      source: 'project-dsh',
      provider: 'filesystem',
      instructions: 'Persona body.',
    })
    expect(warnings).toEqual([])
  })
})

describe('roots, ranks, and provider settings', () => {
  it('assigns each scanned root its declared source and rank', async () => {
    const home = await tempDir('roots-home')
    const project = await tempDir('roots-project')
    const custom = await tempDir('roots-custom')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeDefinition(join(project, '.dsh/agents'), 'project-dsh.md', ['name: project-dsh', 'description: Project dsh'])
    await writeDefinition(join(project, '.agents/agents'), 'project-agents.md', ['name: project-agents', 'description: Project agents'])
    await writeDefinition(custom, 'custom.md', ['name: custom', 'description: Custom'])
    await writeDefinition(join(home, '.dsh/agents'), 'user-dsh.md', ['name: user-dsh', 'description: User dsh'])
    await writeDefinition(join(home, '.agents/agents'), 'user-agents.md', ['name: user-agents', 'description: User agents'])

    const { ctx } = await createContext()
    const provider = createProvider(ctx, home, { customAgentDirs: [custom] })

    expect(candidatesOf(await provider.list({ cwd: join(project, 'src') })).map(entry => [entry.name, entry.source, entry.rank]))
      .toEqual([
        ['project-dsh', 'project-dsh', 100],
        ['project-agents', 'project-agents', 200],
        ['custom', 'custom', 300],
        ['user-dsh', 'user-dsh', 400],
        ['user-agents', 'user-agents', 500],
      ])
  })

  it('prefers the lowest-rank root for a duplicate definition name', async () => {
    const home = await tempDir('precedence-home')
    const project = await tempDir('precedence-project')
    const custom = await tempDir('precedence-custom')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeDefinition(join(project, '.dsh/agents'), 'shared.md', ['name: shared', 'description: Project dsh wins'])
    await writeDefinition(join(project, '.agents/agents'), 'shared.md', ['name: shared', 'description: Project agents'])
    await writeDefinition(custom, 'shared.md', ['name: shared', 'description: Custom'])
    await writeDefinition(join(home, '.dsh/agents'), 'shared.md', ['name: shared', 'description: User dsh'])
    await writeDefinition(join(home, '.agents/agents'), 'shared.md', ['name: shared', 'description: User agents'])

    const { ctx } = await mountPlugin(home, { customAgentDirs: [custom] })
    expect(await ctx.agentDefinitions.list({ cwd: project })).toMatchObject([
      { name: 'shared', description: 'Project dsh wins', source: 'project-dsh' },
    ])
  })

  it('resolves project roots above the cwd and falls back to the cwd itself', async () => {
    const home = await tempDir('project-root-home')
    const project = await projectWithDefinition('at-root', '.dsh/agents', ['name: at-root', 'description: At root'])
    const { ctx } = await createContext()
    const provider = createProvider(ctx, home)

    expect(candidatesOf(await provider.list({ cwd: join(project, 'packages/app/src') })).map(entry => entry.name))
      .toEqual(['at-root'])

    const standalone = await tempDir('project-root-standalone')
    await writeDefinition(join(standalone, '.agents/agents'), 'standalone.md', ['name: standalone', 'description: Standalone'])
    expect(candidatesOf(await provider.list({ cwd: standalone })).map(entry => entry.name)).toEqual(['standalone'])
  })

  it('walks to the project root through the filesystem service', async () => {
    const home = await tempDir('fs-root-home')
    const project = await tempDir('fs-root-project')
    const nested = join(project, 'packages/app')
    await mkdir(join(project, '.git'), { recursive: true })
    await mkdir(nested, { recursive: true })
    await writeDefinition(join(project, '.agents/agents'), 'backend.md', ['name: backend', 'description: Backend'])

    const { ctx, fs } = await createContext({ fileSystem: true })
    // A backend that rejects or hides the nearer candidates must not stop the walk.
    fs?.resolveErrors.set(join(nested, '.git'), new Error('resolve failed'))
    fs?.resolveErrors.set(join(project, 'packages/.git'), new FsError('hidden', 'FS_NOT_FOUND'))
    const provider = createProvider(ctx, home)

    expect(candidatesOf(await provider.list({ cwd: nested })).map(entry => [entry.name, entry.source]))
      .toEqual([['backend', 'project-agents']])
  })

  it('scans only custom roots when default roots are disabled', async () => {
    const home = await tempDir('custom-only-home')
    const project = await tempDir('custom-only-project')
    const custom = await tempDir('custom-only-custom')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeDefinition(join(project, '.dsh/agents'), 'project.md', ['name: project', 'description: Project'])
    await writeDefinition(join(home, '.dsh/agents'), 'user.md', ['name: user', 'description: User'])
    await writeDefinition(custom, 'custom-only.md', ['name: custom-only', 'description: Custom only'])

    const { ctx } = await createContext()
    const provider = createProvider(ctx, home, { includeDefaultRoots: false, customAgentDirs: [custom] })

    expect(candidatesOf(await provider.list({ cwd: project })).map(entry => entry.name)).toEqual(['custom-only'])
    expect(candidatesOf(await provider.list({})).map(entry => entry.name)).toEqual(['custom-only'])
  })

  it('resolves settings from config, environment, and default fallbacks', async () => {
    const home = await tempDir('settings-home')
    const project = await projectWithDefinition('alpha', '.dsh/agents', ['name: alpha', 'description: Alpha'])
    const previousDshHome = process.env.DSH_HOME
    const previousAgentsHome = process.env.DSH_AGENTS_HOME
    try {
      process.env.DSH_HOME = join(home, 'env-dsh')
      process.env.DSH_AGENTS_HOME = join(home, 'env-agents')
      await writeDefinition(join(home, 'env-dsh/agents'), 'env-dsh-def.md', ['name: env-dsh-def', 'description: Env dsh'])
      await writeDefinition(join(home, 'env-agents/agents'), 'env-agents-def.md', ['name: env-agents-def', 'description: Env agents'])

      const { ctx } = await createContext()
      await ctx.plugin(AgentDefinitionsRegistry)
      // An omitted config must fall back to the declared empty default.
      AgentDefinitionsFilesystem.apply(ctx, undefined)
      expect((await ctx.agentDefinitions.list({ cwd: project })).map(entry => entry.name))
        .toEqual(['alpha', 'env-agents-def', 'env-dsh-def'])

      const provider = new AgentDefinitionsFilesystem.FileSystemAgentDefinitionProvider(ctx, {})
      expect(provider.name).toBe('filesystem')
      expect(candidatesOf(await provider.list({})).map(entry => [entry.name, entry.source])).toEqual([
        ['env-dsh-def', 'user-dsh'],
        ['env-agents-def', 'user-agents'],
      ])
      expect(new AgentDefinitionsFilesystem.FileSystemAgentDefinitionProvider(ctx, { providerName: 'isolated' }).name)
        .toBe('isolated')

      // Without the environment override the shared agents root falls back to the OS home.
      delete process.env.DSH_AGENTS_HOME
      expect(new AgentDefinitionsFilesystem.FileSystemAgentDefinitionProvider(ctx, { dshHome: join(home, '.dsh') }).name)
        .toBe('filesystem')
    } finally {
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
      if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = previousAgentsHome
    }
  })
})

describe('discovery shape', () => {
  it('lists only top-level markdown files, in name order', async () => {
    const home = await tempDir('shape-home')
    const root = join(home, '.dsh/agents')
    await writeDefinition(root, 'gamma.md', ['name: gamma', 'description: Gamma'])
    await writeDefinition(root, 'alpha.md', ['name: alpha', 'description: Alpha'])
    await writeDefinition(root, 'beta.md', ['name: beta', 'description: Beta'])
    await writeDefinition(join(root, 'nested'), 'deep.md', ['name: deep', 'description: Deep'])
    await mkdir(join(root, 'folder.md'), { recursive: true })
    await writeRaw(root, 'notes.txt', 'not a definition')
    await symlink(join(root, 'missing-target.md'), join(root, 'dangling.md'))

    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home)

    expect(candidatesOf(await provider.list({})).map(entry => entry.name)).toEqual(['alpha', 'beta', 'gamma'])
    expect(warnings).toEqual([])
  })

  it('loads a symlinked markdown definition through its target', async () => {
    const home = await tempDir('symlink-home')
    const external = await tempDir('symlink-external')
    const target = await writeDefinition(external, 'linked.md', ['name: linked', 'description: Linked'])
    const root = join(home, '.dsh/agents')
    await mkdir(root, { recursive: true })
    await symlink(target, join(root, 'linked.md'))

    const { ctx } = await createContext()
    const provider = createProvider(ctx, home)
    const candidate = first(candidatesOf(await provider.list({})))

    expect(candidate).toMatchObject({ name: 'linked', path: target })
    expect(await provider.get(candidate, {})).toMatchObject({ name: 'linked', instructions: 'Persona body.' })
  })
})

describe('frontmatter acceptance', () => {
  it('accepts every declared field and trims the persona body', async () => {
    const home = await tempDir('accept-home')
    const root = join(home, '.dsh/agents')
    const path = await writeDefinition(root, 'full.md', [
      'name: full',
      'description: Full definition',
      'tools:',
      '  - read',
      '  - write',
      'model: deepseek-chat',
      'reasoning_effort: high',
      'max_depth: 3',
    ], '  Persona body.  ')

    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home)
    const candidate = first(candidatesOf(await provider.list({})))

    expect(candidate).toEqual({
      name: 'full',
      description: 'Full definition',
      path,
      tools: ['read', 'write'],
      model: 'deepseek-chat',
      reasoningEffort: 'high',
      maxDepth: 3,
      provider: 'filesystem',
      source: 'user-dsh',
      rank: 400,
      locator: { path },
    })
    expect(await provider.get(candidate, {})).toEqual({
      name: 'full',
      description: 'Full definition',
      path,
      tools: ['read', 'write'],
      model: 'deepseek-chat',
      reasoningEffort: 'high',
      maxDepth: 3,
      provider: 'filesystem',
      source: 'user-dsh',
      instructions: 'Persona body.',
    })
    expect(warnings).toEqual([])
  })

  it('accepts comma-separated tools, CRLF frontmatter, and omitted optional fields', async () => {
    const home = await tempDir('accept-variants-home')
    const root = join(home, '.dsh/agents')
    await writeDefinition(root, 'comma.md', ['name: comma', 'description: Comma tools', 'tools: read, write , edit'])
    await writeRaw(root, 'crlf.md', '---\r\nname: crlf\r\ndescription: CRLF definition\r\n---\r\n\r\nCRLF body.\r\n')
    await writeDefinition(root, 'plain.md', ['name: plain', 'description: Plain definition'])

    const { ctx } = await createContext()
    const provider = createProvider(ctx, home)
    const listed = candidatesOf(await provider.list({}))

    expect(listed.find(entry => entry.name === 'comma')).toMatchObject({ tools: ['read', 'write', 'edit'] })
    expect(await provider.get(first(listed.filter(entry => entry.name === 'crlf')), {}))
      .toMatchObject({ description: 'CRLF definition', instructions: 'CRLF body.' })
    expect(listed.find(entry => entry.name === 'plain')).toEqual({
      name: 'plain',
      description: 'Plain definition',
      path: join(root, 'plain.md'),
      provider: 'filesystem',
      source: 'user-dsh',
      rank: 400,
      locator: { path: join(root, 'plain.md') },
    })
  })

  it('rejects every unsupported frontmatter case with a warning', async () => {
    const home = await tempDir('reject-home')
    const root = join(home, '.dsh/agents')
    await writeDefinition(root, 'valid.md', ['name: valid', 'description: Valid'])
    const rejected: ReadonlyArray<readonly [string, string]> = [
      ['no-newline.md', 'No frontmatter at all.'],
      ['plain-text.md', 'plain text\nsecond line'],
      ['unclosed-frontmatter.md', '---\nname: unclosed-frontmatter\ndescription: Unclosed\n'],
      ['unclosed-body.md', '---\nname: unclosed-body\ndescription: Unclosed body\npersona without a closing delimiter'],
      ['scalar-frontmatter.md', '---\njust a scalar\n---\n\nBody.'],
      ['null-frontmatter.md', '---\nnull\n---\n\nBody.'],
      ['array-frontmatter.md', '---\n[]\n---\n\nBody.'],
      ['malformed-yaml.md', '---\nname: malformed-yaml\ndescription: [unclosed\n---\n\nBody.'],
      ['unknown-field.md', '---\nname: unknown-field\ndescription: Unknown field\nowner: tests\n---\n\nBody.'],
      ['missing-name.md', '---\ndescription: Missing name\n---\n\nBody.'],
      ['number-name.md', '---\nname: 12\ndescription: Number name\n---\n\nBody.'],
      ['empty-name.md', '---\nname: ""\ndescription: Empty name\n---\n\nBody.'],
      ['invalid-name.md', '---\nname: Invalid_Name\ndescription: Invalid name\n---\n\nBody.'],
      ['missing-description.md', '---\nname: missing-description\n---\n\nBody.'],
      ['empty-description.md', '---\nname: empty-description\ndescription: ""\n---\n\nBody.'],
      ['empty-body.md', '---\nname: empty-body\ndescription: Empty body\n---\n\n   \n'],
      ['no-trailing-body.md', '---\nname: no-trailing-body\ndescription: No trailing body\n---'],
      ['tools-number.md', '---\nname: tools-number\ndescription: Tools number\ntools: 42\n---\n\nBody.'],
      ['tools-empty-list.md', '---\nname: tools-empty-list\ndescription: Tools empty list\ntools: []\n---\n\nBody.'],
      ['tools-non-string.md', '---\nname: tools-non-string\ndescription: Tools non string\ntools:\n  - 7\n---\n\nBody.'],
      ['tools-empty-entry.md', '---\nname: tools-empty-entry\ndescription: Tools empty entry\ntools:\n  - ""\n---\n\nBody.'],
      ['tools-trailing-comma.md', '---\nname: tools-trailing-comma\ndescription: Tools trailing comma\ntools: "read,"\n---\n\nBody.'],
      ['max-depth-negative.md', '---\nname: max-depth-negative\ndescription: Max depth negative\nmax_depth: -1\n---\n\nBody.'],
      ['max-depth-fractional.md', '---\nname: max-depth-fractional\ndescription: Max depth fractional\nmax_depth: 1.5\n---\n\nBody.'],
      ['max-depth-string.md', '---\nname: max-depth-string\ndescription: Max depth string\nmax_depth: "2"\n---\n\nBody.'],
    ]
    for (const [fileName, content] of rejected) await writeRaw(root, fileName, content)

    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home)

    expect(candidatesOf(await provider.list({})).map(entry => entry.name)).toEqual(['valid'])
    expect(warnings).toHaveLength(rejected.length)
    expect(warnings.every(message => message.includes('ignored'))).toBe(true)
    expect(warnings.some(message => message.includes('invalid YAML frontmatter'))).toBe(true)
    expect(warnings.some(message => message.includes('missing YAML frontmatter'))).toBe(true)
    expect(warnings.some(message => message.includes('is unsupported'))).toBe(true)
  })
})

describe('root listing failures', () => {
  it('returns an empty result without warning when every root is missing', async () => {
    const home = await tempDir('missing-roots-home')
    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home)

    expect(candidatesOf(await provider.list({ cwd: join(home, 'absent') }))).toEqual([])
    expect(warnings).toEqual([])
  })

  it('treats absent filesystem-service paths as missing roots', async () => {
    const home = await tempDir('fs-absent-home')
    const custom = await tempDir('fs-absent-custom')
    await writeDefinition(custom, 'present.md', ['name: present', 'description: Present'])
    const blocker = await writeRaw(home, 'blocker', 'not a directory')

    const { ctx, fs, warnings } = await createContext({ fileSystem: true })
    fs?.resolveErrors.set(join(custom, 'gone'), new FsError('gone', 'FS_NOT_FOUND'))
    fs?.listErrors.set(join(custom, 'not-a-directory'), new FsError('not a directory', 'FS_NOT_DIRECTORY'))
    const provider = createProvider(ctx, home, {
      customAgentDirs: [join(custom, 'gone'), join(custom, 'not-a-directory'), join(blocker, 'agents'), custom],
    })

    expect(candidatesOf(await provider.list({})).map(entry => entry.name)).toEqual(['present'])
    expect(warnings).toEqual([])
  })

  it('treats absent native paths as missing roots', async () => {
    const home = await tempDir('native-absent-home')
    const custom = await tempDir('native-absent-custom')
    await writeDefinition(custom, 'present.md', ['name: present', 'description: Present'])
    const blocker = await writeRaw(home, 'blocker', 'not a directory')

    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home, {
      customAgentDirs: [join(blocker, 'agents'), join(custom, 'missing'), custom],
    })

    expect(candidatesOf(await provider.list({})).map(entry => entry.name)).toEqual(['present'])
    expect(warnings).toEqual([])
  })

  it('reports an incomplete observation when a root cannot be listed', async () => {
    const home = await tempDir('incomplete-home')
    const broken = await tempDir('incomplete-broken')
    await writeDefinition(join(home, '.dsh/agents'), 'stable.md', ['name: stable', 'description: Stable'])

    const { ctx, fs, warnings } = await createContext({ fileSystem: true })
    fs?.listErrors.set(broken, new Error('list temporarily failed'))
    const provider = createProvider(ctx, home, { customAgentDirs: [broken] })

    const observation = await provider.list({})
    expect(Array.isArray(observation)).toBe(false)
    expect(observation).toMatchObject({ complete: false })
    expect(candidatesOf(observation).map(entry => entry.name)).toEqual(['stable'])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('skipped')
    expect(warnings[0]).toContain('list temporarily failed')
  })

  it('reports every non-absence root failure as an incomplete observation', async () => {
    const home = await tempDir('non-absence-home')
    const custom = await tempDir('non-absence-custom')
    await writeDefinition(custom, 'present.md', ['name: present', 'description: Present'])
    const failures: ReadonlyArray<readonly [string, unknown]> = [
      ['plain-error', new Error('native list failed')],
      ['string-error', 'string list failure'],
      ['null-error', null],
      ['wrong-code', new FsError('denied', 'FS_IO_ERROR')],
    ]

    for (const [name, failure] of failures) {
      const broken = join(custom, name)
      await mkdir(broken, { recursive: true })
      const { ctx, fs, warnings } = await createContext({ fileSystem: true })
      fs?.listErrors.set(broken, failure)
      const provider = createProvider(ctx, home, { includeDefaultRoots: false, customAgentDirs: [broken, custom] })

      const observation = await provider.list({})
      expect(observation).toMatchObject({ complete: false })
      expect(candidatesOf(observation).map(entry => entry.name)).toEqual(['present'])
      expect(warnings).toHaveLength(1)
    }
  })

  it('reports an unexpected native listing failure as an incomplete observation', async () => {
    const home = await tempDir('native-failure-home')
    const custom = await tempDir('native-failure-custom')
    await writeDefinition(custom, 'present.md', ['name: present', 'description: Present'])

    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home, {
      includeDefaultRoots: false,
      customAgentDirs: ['\0invalid-root', custom],
    })

    const observation = await provider.list({})
    expect(observation).toMatchObject({ complete: false })
    expect(candidatesOf(observation).map(entry => entry.name)).toEqual(['present'])
    expect(warnings).toHaveLength(1)
  })

  it('surfaces an aborted signal raised while listing a failing root', async () => {
    const home = await tempDir('abort-list-home')
    const broken = await tempDir('abort-list-broken')
    const { ctx, fs } = await createContext({ fileSystem: true })
    fs?.listErrors.set(broken, new Error('list failed'))
    const provider = createProvider(ctx, home, { includeDefaultRoots: false, customAgentDirs: [broken] })

    const controller = new AbortController()
    const reason = new Error('listing cancelled')
    controller.abort(reason)
    await expect(provider.list({ signal: controller.signal })).rejects.toBe(reason)
  })
})

describe('loading candidate definitions', () => {
  it('returns undefined when the candidate file disappeared or became a directory', async () => {
    const home = await tempDir('gone-home')
    const root = join(home, '.dsh/agents')
    const path = await writeDefinition(root, 'gone.md', ['name: gone', 'description: Gone'])
    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home)
    const candidate = first(candidatesOf(await provider.list({})))
    const signal = new AbortController().signal

    await rm(path)
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect(await provider.get(candidate, { signal })).toBeUndefined()

    await mkdir(path, { recursive: true })
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect(warnings).toEqual([])
  })

  it('returns undefined when the candidate file no longer parses', async () => {
    const home = await tempDir('reparse-home')
    const root = join(home, '.dsh/agents')
    const path = await writeDefinition(root, 'changed.md', ['name: changed', 'description: Changed'])
    const { ctx, warnings } = await createContext()
    const provider = createProvider(ctx, home)
    const candidate = first(candidatesOf(await provider.list({})))

    await writeRaw(root, 'changed.md', '---\ndescription: No name anymore\n---\n\nBody.')
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(path)
  })

  it('propagates an unexpected native read failure', async () => {
    const home = await tempDir('native-read-failure-home')
    const root = join(home, '.dsh/agents')
    await writeDefinition(root, 'read-failure.md', ['name: read-failure', 'description: Read failure'])
    const { ctx } = await createContext()
    const provider = createProvider(ctx, home)
    const candidate = first(candidatesOf(await provider.list({})))

    await expect(provider.get({ ...candidate, locator: { path: `${join(root, 'read')}\0failure.md` } }, {}))
      .rejects.toThrow()
  })

  it('classifies filesystem-service read failures and propagates unexpected ones', async () => {
    const home = await tempDir('fs-read-home')
    const root = join(home, '.dsh/agents')
    const path = await writeDefinition(root, 'fs-read.md', ['name: fs-read', 'description: Fs read'])
    const { ctx, fs } = await createContext({ fileSystem: true })
    const provider = createProvider(ctx, home)
    const candidate = first(candidatesOf(await provider.list({})))
    const signal = new AbortController().signal

    fs?.readErrors.set(path, new FsError('gone', 'FS_NOT_FOUND'))
    expect(await provider.get(candidate, { signal })).toBeUndefined()

    fs?.readErrors.set(path, new Error('read failed'))
    await expect(provider.get(candidate, {})).rejects.toThrow('read failed')
  })

  it('preserves the candidate source when loading from a custom root', async () => {
    const home = await tempDir('source-home')
    const custom = await tempDir('source-custom')
    await writeDefinition(custom, 'from-custom.md', ['name: from-custom', 'description: From custom'])
    const { ctx } = await createContext()
    const provider = createProvider(ctx, home, { includeDefaultRoots: false, customAgentDirs: [custom] })
    const candidate = first(candidatesOf(await provider.list({})))

    expect(candidate.source).toBe('custom')
    expect(await provider.get(candidate, {})).toMatchObject({ source: 'custom', provider: 'filesystem' })
  })
})

describe('filesystem-service and native paths', () => {
  it.each([false, true])('lists and loads identical definitions (filesystem service: %s)', async (withFileSystem) => {
    const home = await tempDir('dual-home')
    const project = await tempDir('dual-project')
    const custom = await tempDir('dual-custom')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeDefinition(join(project, '.dsh/agents'), 'project.md', ['name: project', 'description: Project', 'tools: read'])
    await writeDefinition(custom, 'custom.md', ['name: custom', 'description: Custom'])

    const { ctx, fs, warnings } = await createContext({ fileSystem: withFileSystem })
    const provider = createProvider(ctx, home, { customAgentDirs: [custom] })
    const listed = candidatesOf(await provider.list({ cwd: join(project, 'nested') }))

    expect(listed.map(entry => [entry.name, entry.source, entry.rank])).toEqual([
      ['project', 'project-dsh', 100],
      ['custom', 'custom', 300],
    ])
    expect(await provider.get(first(listed), {})).toMatchObject({
      name: 'project',
      source: 'project-dsh',
      provider: 'filesystem',
      instructions: 'Persona body.',
      tools: ['read'],
    })
    expect(warnings).toEqual([])
    if (withFileSystem) expect(fs?.resolveSignals.length).toBeGreaterThan(0)
  })

  it('forwards the lookup signal while loading and stops when it aborts', async () => {
    const home = await tempDir('abort-read-home')
    const custom = await tempDir('abort-read-custom')
    await writeDefinition(custom, 'slow.md', ['name: slow', 'description: Slow'])
    const { ctx, fs } = await createContext({ fileSystem: true })
    const provider = createProvider(ctx, home, { includeDefaultRoots: false, customAgentDirs: [custom] })
    const candidate = first(candidatesOf(await provider.list({})))
    if (fs === undefined) throw new Error('expected the stub filesystem')
    fs.resolveSignals = []
    fs.readSignals = []

    const started = Promise.withResolvers<undefined>()
    fs.readTextOverride = async (_target, signal) => {
      if (signal === undefined) throw new Error('expected the lookup signal')
      started.resolve(undefined)
      return await new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error(String(signal.reason))) }, { once: true })
      })
    }
    const controller = new AbortController()
    const reason = new Error('turn cancelled')
    const loading = provider.get(candidate, { signal: controller.signal })
    await started.promise
    controller.abort(reason)

    await expect(loading).rejects.toBe(reason)
    expect(fs.resolveSignals).toEqual([controller.signal])
    expect(fs.readSignals).toEqual([controller.signal])
  })
})
