import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import ProjectStore from '@deepseek-ai/dsh-project'
import type { ProjectView, TaskId } from '@deepseek-ai/dsh-project'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as commandProject from '../src/index.ts'
import { executeProjectCommand, parseProjectCommand, renderProjectBoard, renderProjectList } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-command-project-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(ProjectStore, { maxTasksPerProject: 8 })
  return ctx
}

/** An agent stand-in carrying a real Session with the given working directory. */
function stubAgent(id: string, cwd?: string): Agent {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 1,
    isSeeded: false,
    ...cwd === undefined ? {} : { cwd },
  }
  return { id: SessionId(id), session: Session.create(SessionId(id), [], header) } as unknown as Agent
}

function invocation(agent: Agent, rawInput: string): CommandInvocation {
  return { agent, rawInput } as unknown as CommandInvocation
}

async function seedBoard(ctx: Context, workspace = '/work'): Promise<ProjectView> {
  const created = await ctx.projects.create({ title: 'Release', workspace })
  let project = await ctx.projects.addTask({ id: created.id, revision: created.revision }, { title: 'first' })
  project = await ctx.projects.addTask(
    { id: project.id, revision: project.revision },
    { title: 'second', blockedBy: ['task-1' as TaskId] },
  )
  return project
}

describe('/project argument grammar', () => {
  it('lists without an argument and names one project otherwise', () => {
    expect(parseProjectCommand('')).toEqual({ kind: 'list' })
    expect(parseProjectCommand('   ')).toEqual({ kind: 'list' })
    expect(parseProjectCommand(' p-1 ')).toEqual({ kind: 'board', id: 'p-1' })
  })

  it('refuses more than one id', () => {
    const invalid = parseProjectCommand('p-1 p-2')
    expect(invalid.kind).toBe('invalid')
    if (invalid.kind !== 'invalid') throw new Error('expected an invalid parse')
    expect(invalid.text).toContain('Name one project id')
    expect(invalid.text).toContain('Usage: /project')
  })
})

describe('/project rendering', () => {
  it('says so when the working directory has no project', () => {
    expect(renderProjectList([])).toContain('No project exists for this working directory yet.')
  })

  it('renders the list with finished counts and the usage line', () => {
    const project = {
      id: 'p-1',
      title: 'Release',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      revision: 4,
      tasks: [
        { id: 'task-1', title: 'first', status: 'done', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-2', title: 'second', status: 'todo', blockedBy: ['task-1'], sessionIds: [], createdAt: 1, updatedAt: 1 },
      ],
    } as unknown as ProjectView
    const text = renderProjectList([project])
    expect(text.split('\n')[0]).toBe('Projects (1):')
    expect(text).toContain('p-1 · Release · active · revision 4 · tasks 1/2 finished')
    expect(text).toContain('Usage: /project')
  })

  it('renders lanes, ready tasks, stranded tasks, and an empty board', () => {
    const project = {
      id: 'p-1',
      title: 'Release',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      revision: 2,
      tasks: [
        { id: 'task-1', title: 'first', status: 'doing', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-2', title: 'second', status: 'todo', blockedBy: ['task-1'], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-3', title: 'third', status: 'todo', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-4', title: 'fourth', status: 'doing', blockedBy: ['task-1'], sessionIds: [], createdAt: 1, updatedAt: 1 },
      ],
    } as unknown as ProjectView
    const lines = renderProjectBoard(project).split('\n')
    expect(lines[0]).toBe('Project p-1 · Release · active · revision 2')
    expect(lines).toContain('todo (2):')
    expect(lines).toContain('  [todo] task-2 second (blocked by task-1)')
    expect(lines).toContain('  [todo] task-3 third')
    expect(lines).toContain('  [doing] task-4 fourth (blocked by task-1)')
    expect(lines).toContain('Ready: task-3')
    expect(lines).toContain('Stranded: task-4 (a blocker is unfinished)')

    const empty = { ...project, tasks: [] } as unknown as ProjectView
    expect(renderProjectBoard(empty)).toContain('  (no tasks)')
  })
})

describe('/project execution', () => {
  it('lists the projects of the calling working directory', async () => {
    const ctx = await boot()
    await seedBoard(ctx, '/work')
    await seedBoard(ctx, '/elsewhere')

    const here = executeProjectCommand(ctx, invocation(stubAgent('a', '/work'), ''))
    expect(here.kind).toBe('success')
    expect(here.text).toContain('Projects (1):')

    const anywhere = executeProjectCommand(ctx, invocation(stubAgent('b'), ''))
    expect(anywhere.text).toContain('Projects (2):')
  })

  it('renders one board and refuses an unknown id', async () => {
    const ctx = await boot()
    const project = await seedBoard(ctx)
    const board = executeProjectCommand(ctx, invocation(stubAgent('a', '/work'), String(project.id)))
    expect(board.kind).toBe('success')
    expect(board.text).toContain('Project ')
    expect(board.text).toContain('Ready: task-1')

    const missing = executeProjectCommand(ctx, invocation(stubAgent('a', '/work'), 'nope'))
    expect(missing.kind).toBe('error')
    expect(missing.text).toContain('No project nope exists')

    const invalid = executeProjectCommand(ctx, invocation(stubAgent('a', '/work'), 'a b'))
    expect(invalid.kind).toBe('error')
  })
})

describe('@deepseek-ai/dsh-command-project registration', () => {
  it('registers one global command and disposes it with the plugin', async () => {
    const ctx = await boot()
    const plugin = await ctx.plugin(commandProject)
    const agent = stubAgent('register', '/work')
    expect(commandProject.name).toBe('command-project')
    expect(commandProject.inject).toEqual(['commands', 'projects'])
    expect('default' in commandProject).toBe(false)
    expect(ctx.commands.find(agent, 'project')).toBeDefined()

    const execution = await ctx.commands.execute(agent, '/project', [], new AbortController().signal)
    expect(execution?.result).toMatchObject({ kind: 'success' })

    await plugin.dispose()
    expect(ctx.commands.find(agent, 'project')).toBeUndefined()
  })
})
