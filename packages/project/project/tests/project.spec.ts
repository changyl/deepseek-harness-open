import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ProjectStore, { ProjectError } from '../src/index.ts'
import type { ProjectId, ProjectView, TaskId } from '../src/index.ts'
import {
  allocateTaskId,
  assertNoCycle,
  boardOf,
  isFinished,
  MAX_TITLE_LENGTH,
  normalizeTitle,
  requireTask,
  unfinishedBlockers,
} from '../src/board.ts'
import { projectTaskRecord } from '../src/spec.ts'
import type { ProjectRecord, ProjectTaskRecord } from '../src/spec.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(maxTasksPerProject = 8): Promise<{ ctx: Context; projects: ProjectStore }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-project-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(ProjectStore, { maxTasksPerProject })
  return { ctx, projects: ctx.projects }
}

function ref(project: ProjectView): { id: ProjectId; revision: number } {
  return { id: project.id, revision: project.revision }
}

describe('project title and id helpers', () => {
  it('normalizes titles and refuses unusable ones', () => {
    expect(normalizeTitle('  ship it  ')).toBe('ship it')
    expect(() => normalizeTitle('   ')).toThrow(ProjectError)
    expect(() => normalizeTitle('x'.repeat(MAX_TITLE_LENGTH + 1))).toThrow(/cannot exceed/)
    expect(() => normalizeTitle('')).toThrow(/cannot be empty/)
  })

  it('allocates the next task id past every numbered task', () => {
    expect(String(allocateTaskId([]))).toBe('task-1')
    const tasks = [
      projectTaskRecord.parse({ id: 'task-5', title: 'a', status: 'todo', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 }),
      projectTaskRecord.parse({ id: 'task-2', title: 'b', status: 'todo', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 }),
      projectTaskRecord.parse({ id: 'legacy', title: 'c', status: 'todo', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 }),
    ]
    expect(String(allocateTaskId(tasks))).toBe('task-6')
  })

  it('ignores a dependency edge that names no stored task when walking for cycles', () => {
    // The store rejects unknown dependencies before this walk; the pure helper
    // must still terminate when one reaches it.
    expect(() => {
      assertNoCycle([], 'task-1' as TaskId, ['task-9' as TaskId])
    }).not.toThrow()
  })

  it('classifies finished statuses', () => {
    expect(isFinished('done')).toBe(true)
    expect(isFinished('cancelled')).toBe(true)
    expect(isFinished('doing')).toBe(false)
    expect(isFinished('blocked')).toBe(false)
    expect(isFinished('todo')).toBe(false)
  })

  it('reports unfinished blockers and refuses an unknown task', () => {
    const record: ProjectRecord = {
      title: 'p',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
      revision: 0,
      tasks: [
        projectTaskRecord.parse({ id: 'task-1', title: 'a', status: 'done', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 }),
        projectTaskRecord.parse({ id: 'task-2', title: 'b', status: 'doing', blockedBy: ['task-1'], sessionIds: [], createdAt: 1, updatedAt: 1 }),
      ],
    }
    const second = record.tasks[1]!
    expect(unfinishedBlockers(record.tasks, second)).toEqual([])
    expect(unfinishedBlockers(record.tasks, { ...second, status: 'done' })).toEqual([])
    const first = record.tasks[0]!
    expect(unfinishedBlockers(record.tasks, { ...first, blockedBy: ['task-2' as TaskId] }).map(task => String(task.id))).toEqual(['task-2'])
    expect(() => requireTask(record, 'task-9' as TaskId)).toThrow(/no task task-9/)
  })

  it('lays out lanes, ready tasks, and stranded tasks', () => {
    const tasks: ProjectTaskRecord[] = [
      projectTaskRecord.parse({ id: 'task-1', title: 'a', status: 'doing', blockedBy: [], sessionIds: [], createdAt: 1, updatedAt: 1 }),
      projectTaskRecord.parse({ id: 'task-2', title: 'b', status: 'todo', blockedBy: ['task-1'], sessionIds: [], createdAt: 2, updatedAt: 2 }),
      projectTaskRecord.parse({ id: 'task-3', title: 'c', status: 'todo', blockedBy: [], sessionIds: [], createdAt: 3, updatedAt: 3 }),
      projectTaskRecord.parse({ id: 'task-4', title: 'd', status: 'doing', blockedBy: ['task-1'], sessionIds: [], createdAt: 4, updatedAt: 4 }),
    ]
    const project = { id: 'p' as ProjectId, title: 'p', status: 'active' as const, createdAt: 1, updatedAt: 1, revision: 1, tasks }
    const board = boardOf(project)
    expect(board.columns.todo.map(task => String(task.id))).toEqual(['task-2', 'task-3'])
    expect(board.columns.doing.map(task => String(task.id))).toEqual(['task-1', 'task-4'])
    expect(board.ready.map(String)).toEqual(['task-3'])
    expect(board.stranded.map(String)).toEqual(['task-4'])
  })
})

describe('project store', () => {
  it('creates, lists, reads, and renames projects', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Release 2', workspace: '/w' })
    expect(created.status).toBe('active')
    expect(created.revision).toBe(0)
    expect(created.workspace).toBe('/w')
    expect(String(created.id).length).toBeGreaterThan(0)

    const other = await projects.create({ title: 'Other', workspace: '/other' })
    expect(projects.list().map(project => project.title)).toEqual(['Other', 'Release 2'])
    expect(projects.list({ workspace: '/w' }).map(project => project.title)).toEqual(['Release 2'])
    expect(projects.list({ workspace: '/missing' })).toEqual([])

    const renamed = await projects.update(ref(created), { title: '  Release 3 ' })
    expect(renamed.title).toBe('Release 3')
    expect(renamed.revision).toBe(1)
    expect(String(projects.get(other.id)?.title)).toBe('Other')
    expect(projects.get('missing' as ProjectId)).toBeUndefined()
    expect(projects.board('missing' as ProjectId)).toBeUndefined()
    expect(projects.board(created.id)?.project.title).toBe('Release 3')
  })

  it('refuses a stale revision and a closed project', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Board' })
    const stale = { id: created.id, revision: created.revision }
    await projects.close(stale)

    await expect(projects.update(stale, { title: 'again' })).rejects.toMatchObject({ code: 'project/stale-version' })
    await expect(projects.addTask(stale, { title: 'work' })).rejects.toMatchObject({ code: 'project/stale-version' })

    const closed = projects.get(created.id)!
    expect(closed.status).toBe('closed')
    expect(projects.list()).toEqual([])
    expect(projects.list({ includeClosed: true }).map(project => project.title)).toEqual(['Board'])
    await expect(projects.addTask(ref(closed), { title: 'work' })).rejects.toMatchObject({ code: 'project/closed' })
    await expect(projects.updateTask(ref(closed), 'task-1' as TaskId, { status: 'doing' }))
      .rejects.toMatchObject({ code: 'project/closed' })
    await expect(projects.linkSession(ref(closed), 'task-1' as TaskId, 's1'))
      .rejects.toMatchObject({ code: 'project/closed' })
  })

  it('adds tasks, validates dependencies, and enforces the task bound', async () => {
    const { projects } = await boot(2)
    const created = await projects.create({ title: 'Board' })
    let current = await projects.addTask(ref(created), { title: 'first' })
    expect(current.tasks.map(task => String(task.id))).toEqual(['task-1'])
    current = await projects.addTask(ref(current), { title: 'second', blockedBy: ['task-1' as TaskId, 'task-1' as TaskId] })
    expect(current.tasks[1]?.blockedBy.map(String)).toEqual(['task-1'])

    await expect(projects.addTask(ref(current), { title: '   ' })).rejects.toMatchObject({ code: 'project/invalid-input' })
    await expect(projects.addTask(ref(current), { title: 'third', blockedBy: ['task-9' as TaskId] }))
      .rejects.toMatchObject({ code: 'project/unknown-task' })
    await expect(projects.addTask(ref(current), { title: 'third', blockedBy: ['task-1' as TaskId] }))
      .rejects.toMatchObject({ code: 'project/limit-exceeded' })
  })

  it('refuses a self-dependency and any dependency cycle', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Board' })
    const one = await projects.addTask(ref(created), { title: 'one' })
    const two = await projects.addTask(ref(one), { title: 'two', blockedBy: ['task-1' as TaskId] })

    await expect(projects.updateTask(ref(two), 'task-1' as TaskId, { blockedBy: ['task-1' as TaskId] }))
      .rejects.toMatchObject({ code: 'project/invalid-input' })
    await expect(projects.updateTask(ref(two), 'task-1' as TaskId, { blockedBy: ['task-2' as TaskId] }))
      .rejects.toMatchObject({ code: 'project/dependency-cycle' })
    await expect(projects.updateTask(ref(two), 'task-9' as TaskId, { status: 'done' }))
      .rejects.toMatchObject({ code: 'project/unknown-task' })
  })

  it('ties status to the dependency state', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Board' })
    const one = await projects.addTask(ref(created), { title: 'one' })
    const two = await projects.addTask(ref(one), { title: 'two', blockedBy: ['task-1' as TaskId] })

    await expect(projects.updateTask(ref(two), 'task-2' as TaskId, { status: 'doing' }))
      .rejects.toMatchObject({ code: 'project/invalid-input' })
    await expect(projects.updateTask(ref(two), 'task-2' as TaskId, { status: 'done' }))
      .rejects.toMatchObject({ code: 'project/invalid-input' })
    const blocked = await projects.updateTask(ref(two), 'task-2' as TaskId, { status: 'blocked' })
    expect(blocked.tasks[1]?.status).toBe('blocked')
    await expect(projects.updateTask(ref(blocked), 'task-1' as TaskId, { status: 'blocked' }))
      .rejects.toMatchObject({ code: 'project/invalid-input' })

    const oneDone = await projects.updateTask(ref(blocked), 'task-1' as TaskId, { status: 'done' })
    const twoDone = await projects.updateTask(ref(oneDone), 'task-2' as TaskId, { title: 'two!', status: 'doing' })
    expect(twoDone.tasks[1]?.title).toBe('two!')
    expect(twoDone.tasks[1]?.status).toBe('doing')
    // The board now reports the doing task as work that can proceed.
    expect(projects.board(created.id)?.ready).toEqual([])
  })

  it('keeps a task status when the patch only renames it', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Board' })
    const one = await projects.addTask(ref(created), { title: 'one' })
    const done = await projects.updateTask(ref(one), 'task-1' as TaskId, { status: 'done' })
    const renamed = await projects.updateTask(ref(done), 'task-1' as TaskId, { title: 'one!' })
    expect(renamed.tasks[0]?.title).toBe('one!')
    expect(renamed.tasks[0]?.status).toBe('done')
  })

  it('refuses a mutation whose revision moved between the read and the write', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Board' })
    const same = ref(created)
    const results = await Promise.allSettled([
      projects.update(same, { title: 'first' }),
      projects.update(same, { title: 'second' }),
    ])
    const rejected = results.filter(result => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'project/stale-version' })
    expect(projects.get(created.id)?.revision).toBe(1)
  })

  it('links a session once and leaves the revision alone on a repeated link', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Board' })
    const one = await projects.addTask(ref(created), { title: 'one' })
    const two = await projects.addTask(ref(one), { title: 'two' })
    const linked = await projects.linkSession(ref(two), 'task-2' as TaskId, 'session-a')
    expect(linked.tasks[1]?.sessionIds).toEqual(['session-a'])
    expect(linked.tasks[0]?.sessionIds).toEqual([])
    expect(linked.revision).toBe(3)

    const linkedAgain = await projects.linkSession(ref(linked), 'task-2' as TaskId, 'session-a')
    expect(linkedAgain.revision).toBe(3)
    expect(linkedAgain.tasks[1]?.sessionIds).toEqual(['session-a'])
  })

  it('keeps projects across a store restart', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Durable' })
    await projects.addTask(ref(created), { title: 'first' })
    if (context === undefined) throw new Error('missing context')
    await context.fiber.dispose()

    const reopened = new Context()
    context = reopened
    await reopened.plugin(Storage)
    await reopened.plugin(StorageJson, { root: root! })
    await reopened.plugin(StorageDomain, { backend: 'json' })
    await reopened.plugin(ProjectStore, { maxTasksPerProject: 8 })
    const stored = reopened.projects.get(created.id)
    expect(stored?.title).toBe('Durable')
    expect(stored?.tasks.map(task => task.title)).toEqual(['first'])
  })

  it('refuses operations before the domain is open', async () => {
    const ctx = new Context()
    context = ctx
    const store = new ProjectStore(ctx, { maxTasksPerProject: 4 })
    expect(() => store.list()).toThrow(/not initialized/)
    await expect(store.create({ title: 'x' })).rejects.toThrow(/not initialized/)
    await expect(store.update({ id: 'p' as ProjectId, revision: 0 }, { title: 'x' })).rejects.toThrow(/not initialized/)
  })

  it('reports a missing project for a mutation', async () => {
    const { projects } = await boot()
    await expect(projects.update({ id: 'missing' as ProjectId, revision: 0 }, { title: 'x' }))
      .rejects.toMatchObject({ code: 'project/not-found' })
  })
})
