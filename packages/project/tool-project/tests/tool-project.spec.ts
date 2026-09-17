import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import ProjectStore from '@deepseek-ai/dsh-project'
import type { ProjectView, TaskId } from '@deepseek-ai/dsh-project'
import * as toolProject from '../src/index.ts'
import { boundBoard, shorten, summarize, taskRow } from '../src/index.ts'
import type { BoardResult, Config, ProjectSummary, TaskRow } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const CONFIG: Config = { maxProjectsListed: 2, maxTasksListed: 2, maxTitleLength: 10 }

/**
 * Agent stand-in carrying a real Session: the tool reads `agent.session` for
 * the calling session id and working directory, and nothing else.
 */
function stubAgent(id: string, cwd?: string): Agent {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    isSeeded: false,
    ...cwd === undefined ? {} : { cwd },
  }
  const session = Session.create(SessionId(id), [], header)
  return { id: session.id, session } as unknown as Agent
}

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly projects: ProjectStore
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
}

async function boot(config: Config = CONFIG, cwd?: string): Promise<Harness> {
  root = await mkdtemp(join(tmpdir(), 'dsh-tool-project-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(ProjectStore, { maxTasksPerProject: 8 })
  const plugin = await ctx.plugin(toolProject, config)
  return { ctx, agent: stubAgent(`tool-project-${String(Math.random())}`, cwd), projects: ctx.projects, plugin }
}

let callCounter = 0

async function call(
  test: Harness,
  args: Record<string, unknown>,
  agent: Agent | null = test.agent,
): Promise<{ isError: boolean; value?: unknown; message?: string }> {
  callCounter += 1
  const result = await test.ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`project-call-${String(callCounter)}`),
    name: 'project',
    arguments: args,
    ...agent === null ? {} : { agent },
  })
  return result.isError
    ? { isError: true, message: result.error.message }
    : { isError: false, value: result.value }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected an object result')
  return value as Record<string, unknown>
}

async function createProject(test: Harness, title = 'Board'): Promise<{ id: string; revision: number }> {
  const result = await call(test, { action: 'create', title })
  expect(result.isError).toBe(false)
  const value = asRecord(result.value)
  return { id: String(value.id), revision: Number(value.revision) }
}

describe('project tool bounds', () => {
  it('shortens long titles and summarizes projects', () => {
    expect(shorten('short', 10)).toBe('short')
    expect(shorten('a very long title', 6)).toBe('a ver…')
    expect(shorten('abcdef', 1)).toBe('…')

    const view = {
      id: 'p',
      title: 'a very long project title',
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
      revision: 3,
      tasks: [
        { id: 'task-1', title: 'one', status: 'done', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-2', title: 'two', status: 'todo', blockedBy: ['task-1'], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-3', title: 'three', status: 'todo', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-4', title: 'four', status: 'todo', blockedBy: ['task-9'], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-5', title: 'five', status: 'todo', blockedBy: ['task-6'], sessionIds: [], createdAt: 1, updatedAt: 1 },
        { id: 'task-6', title: 'six', status: 'cancelled', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 },
      ],
    } as unknown as ProjectView
    const summary = summarize(view, 10)
    expect(summary).toMatchObject({ id: 'p', title: 'a very lo…', status: 'active', revision: 3, tasks: 6, ready: 3, updatedAt: 2 })

    const row = taskRow(view.tasks[1]!, 10)
    expect(row).toEqual({ id: 'task-2', title: 'two', status: 'todo', blockedBy: ['task-1'], sessionIds: [] })

    const board = boundBoard({
      project: view,
      columns: { todo: [], doing: [], blocked: [], done: [], cancelled: [] },
      ready: ['task-2' as TaskId],
      stranded: [],
    }, CONFIG)
    expect(board.tasks.map(task => task.id)).toEqual(['task-1', 'task-2'])
    expect(board.truncated).toBe(true)
    expect(board.ready).toEqual(['task-2'])
  })

  it('exposes the bounded types the render reads', () => {
    const summary: ProjectSummary | undefined = undefined
    const row: TaskRow | undefined = undefined
    const board: BoardResult | undefined = undefined
    expect([summary, row, board]).toEqual([undefined, undefined, undefined])
  })
})

describe('@deepseek-ai/dsh-tool-project registration', () => {
  it('registers one global tool and disposes it with the plugin', async () => {
    const test = await boot()
    expect(toolProject.name).toBe('tool-project')
    expect(toolProject.inject).toEqual(['tools', 'projects'])
    expect('default' in toolProject).toBe(false)
    expect(test.ctx.tools.get('project')?.name).toBe('project')

    await test.plugin.dispose()
    expect(test.ctx.tools.get('project')).toBeUndefined()
  })
})

describe('project tool actions', () => {
  it('lists nothing on an empty store and creates a project', async () => {
    const test = await boot()
    const empty = await call(test, { action: 'list' })
    expect(empty.isError).toBe(false)
    expect(asRecord(empty.value)).toEqual({ projects: [], truncated: false })

    const created = await createProject(test, 'Release')
    const listed = await call(test, { action: 'list' })
    expect(asRecord(listed.value)).toMatchObject({
      projects: [{ id: created.id, title: 'Release', revision: 0, tasks: 0, ready: 0 }],
      truncated: false,
    })
  })

  it('creates, reads, and bounds the board', async () => {
    const test = await boot()
    const created = await createProject(test)
    let revision = created.revision
    for (const title of ['one', 'two', 'three']) {
      const added = await call(test, { action: 'add_task', project_id: created.id, revision, title })
      expect(added.isError).toBe(false)
      revision = Number(asRecord(added.value).revision)
    }

    const read = await call(test, { action: 'read', project_id: created.id })
    const board = asRecord(asRecord(read.value).board) as unknown as BoardResult
    expect(board.tasks).toHaveLength(2)
    expect(board.truncated).toBe(true)
    expect(board.ready).toEqual(['task-1', 'task-2', 'task-3'])
    expect(board.revision).toBe(3)
  })

  it('lists projects with a bound and includes closed ones on request', async () => {
    const test = await boot()
    await createProject(test, 'one')
    await createProject(test, 'two')
    await createProject(test, 'three')
    const listed = await call(test, { action: 'list' })
    expect(asRecord(listed.value).truncated).toBe(true)
    expect((asRecord(listed.value).projects as readonly unknown[]).length).toBe(2)
  })

  it('includes closed projects on request', async () => {
    const test = await boot()
    const created = await createProject(test)
    const closed = await call(test, {
      action: 'update_task',
      project_id: created.id,
      revision: created.revision,
      task_id: 'task-1',
      status: 'done',
    })
    expect(closed.isError).toBe(true)

    const listed = await call(test, { action: 'list', include_closed: true })
    expect((asRecord(listed.value).projects as readonly unknown[])).toHaveLength(1)
  })

  it('updates one field at a time and reports the action in the call card', async () => {
    const test = await boot()
    const created = await createProject(test)
    const first = await call(test, { action: 'add_task', project_id: created.id, revision: created.revision, title: 'one' })
    let revision = Number(asRecord(first.value).revision)
    const second = await call(test, {
      action: 'add_task',
      project_id: created.id,
      revision,
      title: 'two',
      blocked_by: ['task-1'],
    })
    revision = Number(asRecord(second.value).revision)

    const renamed = await call(test, {
      action: 'update_task',
      project_id: created.id,
      revision,
      task_id: 'task-1',
      title: 'one!',
    })
    revision = Number(asRecord(renamed.value).revision)
    const reblocked = await call(test, {
      action: 'update_task',
      project_id: created.id,
      revision,
      task_id: 'task-2',
      blocked_by: ['task-1'],
    })
    expect(reblocked.isError).toBe(false)

    const call_ = test.ctx.tools.get('project')?.presentCall?.({ action: 'read', project_id: created.id })
    expect(call_).toMatchObject({ card: 'generic', title: 'Project read', kind: 'other' })
  })

  it('creates and lists without a workspace when the session has none', async () => {
    const test = await boot(CONFIG, undefined)
    const created = await createProject(test)
    expect(test.projects.get(created.id as ProjectView['id'])?.workspace).toBeUndefined()
    const listed = await call(test, { action: 'list' })
    expect((asRecord(listed.value).projects as readonly unknown[])).toHaveLength(1)
  })

  it('links the calling session to a task', async () => {
    const test = await boot()
    const created = await createProject(test)
    const added = await call(test, { action: 'add_task', project_id: created.id, revision: created.revision, title: 'one' })
    const revision = Number(asRecord(added.value).revision)

    const linked = await call(test, {
      action: 'link_session',
      project_id: created.id,
      revision,
      task_id: 'task-1',
    })
    expect(linked.isError).toBe(false)
    const stored = test.projects.get(created.id as ProjectView['id'])
    expect(stored?.tasks[0]?.sessionIds).toEqual([String(test.agent.session.id)])
  })

  it('carries the caller workspace into create and list', async () => {
    const test = await boot(CONFIG, '/work')
    await createProject(test)
    const stored = test.projects.list({ workspace: '/work' })
    expect(stored).toHaveLength(1)
    const listed = await call(test, { action: 'list' })
    expect((asRecord(listed.value).projects as readonly unknown[])).toHaveLength(1)

    const other = await bootWorkspaceOther()
    const empty = await call(other, { action: 'list' })
    expect(asRecord(empty.value)).toEqual({ projects: [], truncated: false })
  })

  it('refuses a stale revision, a bad status, and unknown ids', async () => {
    const test = await boot()
    const created = await createProject(test)
    const added = await call(test, { action: 'add_task', project_id: created.id, revision: created.revision, title: 'one' })
    const revision = Number(asRecord(added.value).revision)

    const stale = await call(test, { action: 'add_task', project_id: created.id, revision: created.revision, title: 'two' })
    expect(stale.message).toMatch(/moved to revision/)
    const badStatus = await call(test, {
      action: 'update_task',
      project_id: created.id,
      revision,
      task_id: 'task-1',
      status: 'doing',
      blocked_by: ['task-1'],
    })
    expect(badStatus.isError).toBe(true)
    const unknownProject = await call(test, { action: 'read', project_id: 'missing' })
    expect(unknownProject.message).toMatch(/no project missing exists/)
    const unknownMutation = await call(test, { action: 'add_task', project_id: 'missing', revision: 0, title: 'x' })
    expect(unknownMutation.message).toMatch(/no project missing exists/)
    const unknownTask = await call(test, {
      action: 'update_task',
      project_id: created.id,
      revision,
      task_id: 'task-9',
      status: 'done',
    })
    expect(unknownTask.message).toMatch(/no task task-9/)
  })

  it('names the missing argument for an incomplete action', async () => {
    const test = await boot()
    const missingProject = await call(test, { action: 'add_task', revision: 0, title: 'x' })
    expect(missingProject.message).toMatch(/project_id is required/)
    const created = await createProject(test)
    const missingRevision = await call(test, { action: 'add_task', project_id: created.id, title: 'x' })
    expect(missingRevision.message).toMatch(/revision is required/)
    const missingTitle = await call(test, { action: 'add_task', project_id: created.id, revision: 0 })
    expect(missingTitle.message).toMatch(/title is required/)
    const missingTask = await call(test, { action: 'update_task', project_id: created.id, revision: 0, status: 'done' })
    expect(missingTask.message).toMatch(/task_id is required/)
  })

  it('refuses link_session without a calling session', async () => {
    const test = await boot()
    const created = await createProject(test)
    const result = await call(
      test,
      { action: 'link_session', project_id: created.id, revision: created.revision, task_id: 'task-1' },
      null,
    )
    expect(result.message).toMatch(/a calling session is required/)
  })
})

/** Boot a second store whose sessions carry a different working directory. */
async function bootWorkspaceOther(): Promise<Harness> {
  await context?.fiber.dispose()
  return boot(CONFIG, '/elsewhere')
}
