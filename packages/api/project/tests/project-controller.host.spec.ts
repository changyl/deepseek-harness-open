import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ProjectStore from '@deepseek-ai/dsh-project'
import type { ProjectRef, ProjectView, TaskId } from '@deepseek-ai/dsh-project'
import ProjectController from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(maxProjectsListed = 20): Promise<{ ctx: Context; projects: ProjectStore }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-api-project-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(ProjectStore, { maxTasksPerProject: 8 })
  await ctx.plugin(ProjectController, { maxProjectsListed })
  return { ctx, projects: ctx.projects }
}

/** Revision reference for the next mutation of one view. */
function ref(view: ProjectView): ProjectRef {
  return { id: view.id, revision: view.revision }
}

/** Identity of the task at one position, failing loudly when the project is shorter. */
function taskId(view: ProjectView, index: number): TaskId {
  const task = view.tasks[index]
  if (task === undefined) throw new Error(`project holds no task at index ${String(index)}`)
  return task.id
}

describe('the project Remote namespace a board page calls', () => {
  it('publishes its two read methods under its own service key', async () => {
    const { ctx } = await boot()
    const controller = ctx.projectController
    expect(controller.typertRemote.serviceKey).toBe('projectController')
    expect(controller.typertRemote.namespace).toBe('project')
    expect(remoteMethods(controller).map(entry => entry.method).sort()).toEqual(['board', 'list'])
  })

  it('lists open projects with their task and workable counts', async () => {
    const { ctx, projects } = await boot()
    const release = await projects.create({ title: 'Release', workspace: '/repo' })
    let view = await projects.addTask(ref(release), { title: 'cut branch' })
    view = await projects.linkSession(ref(view), taskId(view, 0), 'session-1')
    view = await projects.addTask(ref(view), { title: 'write notes' })
    await projects.create({ title: 'Chores' })
    const retired = await projects.create({ title: 'Retired' })
    await projects.close(ref(retired))

    const listing = ctx.projectController.list()
    expect(listing.truncated).toBe(false)
    expect(listing.projects.map(project => project.title).sort()).toEqual(['Chores', 'Release'])
    const row = listing.projects.find(project => project.title === 'Release')
    expect(row).toMatchObject({
      id: String(release.id),
      title: 'Release',
      status: 'active',
      workspace: '/repo',
      revision: 3,
      tasks: 2,
      ready: 2,
      stranded: 0,
    })
    expect(typeof row?.createdAt).toBe('number')
    expect(typeof row?.updatedAt).toBe('number')
    expect(listing.projects.find(project => project.title === 'Chores'))
      .toMatchObject({ revision: 0, tasks: 0, ready: 0, stranded: 0 })
  })

  it('answers a workspace and closed-project selection field by field', async () => {
    const { ctx, projects } = await boot()
    await projects.create({ title: 'Release', workspace: '/repo' })
    await projects.create({ title: 'Chores', workspace: '/other' })
    const retired = await projects.create({ title: 'Retired', workspace: '/repo' })
    await projects.close(ref(retired))

    const both = ctx.projectController.list({ workspace: '/repo', includeClosed: true })
    expect(both.projects.map(project => project.title).sort()).toEqual(['Release', 'Retired'])
    expect(both.projects.every(project => project.workspace === '/repo')).toBe(true)

    expect(ctx.projectController.list({ includeClosed: true }).projects).toHaveLength(3)
    expect(ctx.projectController.list({ workspace: '/repo' }).projects.map(project => project.title))
      .toEqual(['Release'])
    expect(ctx.projectController.list({ workspace: '/absent' }).projects).toEqual([])
  })

  it('reports a listing the deployment bound cut', async () => {
    const { ctx, projects } = await boot(1)
    await projects.create({ title: 'Older' })
    await projects.create({ title: 'Newer' })

    const listing = ctx.projectController.list()
    expect(listing.truncated).toBe(true)
    expect(listing.projects).toHaveLength(1)
  })

  it('refuses a malformed filter at the wire boundary', async () => {
    const { ctx } = await boot()
    expect(() => ctx.projectController.list({ includeClosed: 'yes' } as never)).toThrow(RemoteError)
    expect(() => ctx.projectController.list({ limit: 3 } as never)).toThrow(/malformed filter/)
    try {
      ctx.projectController.list({ workspace: 7 } as never)
      expect.unreachable('a malformed filter must not be answered')
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'gateway/bad-request' })
      expect(error).toHaveProperty('details.issues')
    }
  })

  it('maps a board onto lanes, workable tasks, and their dependencies', async () => {
    const { ctx, projects } = await boot()
    let view = await projects.create({ title: 'Release', workspace: '/repo' })
    view = await projects.addTask(ref(view), { title: 'cut branch' })
    const first = taskId(view, 0)
    view = await projects.addTask(ref(view), { title: 'write notes', blockedBy: [first] })
    view = await projects.addTask(ref(view), { title: 'announce' })
    view = await projects.linkSession(ref(view), first, 'session-1')
    view = await projects.updateTask(ref(view), first, { status: 'done' })

    const board = ctx.projectController.board(String(view.id))
    expect(board.project.id).toBe(String(view.id))
    expect(board.project.revision).toBe(5)
    expect(board.project.tasks.map(task => [task.id, task.status, task.blockedBy, task.sessionIds])).toEqual([
      ['task-1', 'done', [], ['session-1']],
      ['task-2', 'todo', ['task-1'], []],
      ['task-3', 'todo', [], []],
    ])
    expect(board.columns.todo.map(task => task.id)).toEqual(['task-2', 'task-3'])
    expect(board.columns.done.map(task => task.id)).toEqual(['task-1'])
    expect(board.columns.doing).toEqual([])
    expect(board.columns.blocked).toEqual([])
    expect(board.columns.cancelled).toEqual([])
    expect(board.ready).toEqual(['task-2', 'task-3'])
    expect(board.stranded).toEqual([])

    const plain = await projects.create({ title: 'Chores' })
    expect(ctx.projectController.board(String(plain.id)).project).not.toHaveProperty('workspace')
  })

  it('refuses an empty or unknown project id', async () => {
    const { ctx } = await boot()
    expect(() => ctx.projectController.board('   ')).toThrow(/empty project id/)
    try {
      ctx.projectController.board('project-404')
      expect.unreachable('an unknown project must not be answered')
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RemoteError)
      expect(error).toMatchObject({ code: 'project/not-found', details: { projectId: 'project-404' } })
    }
  })
})
