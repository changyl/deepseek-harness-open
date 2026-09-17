/**
 * The board note the model reads: only the tasks that link this session, stated
 * once per board state, with the project revision a mutation would need.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import ProjectStore from '@deepseek-ai/dsh-project'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { apply, Config, inject, linkedTasks, name, renderNote } from '../src/index.ts'
import type { LinkedTask } from '../src/index.ts'
import type { ProjectId, TaskId } from '@deepseek-ai/dsh-project'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<{ ctx: Context; projects: ProjectStore }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-project-context-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(ProjectStore, { maxTasksPerProject: 8 })
  return { ctx, projects: ctx.projects }
}

/** A session stub carrying only what the note reads. */
function session(cwd: string | undefined, id = 'session-1'): Session {
  return { id: SessionId(id), header: cwd === undefined ? {} : { cwd } } as unknown as Session
}

/** Drive the pre-step waterfall through the real listener. */
async function preStep(ctx: Context, stub: Session): Promise<readonly { content: readonly { text: string }[] }[]> {
  const decision = await ctx.waterfall(
    'agent/pre-step',
    { agent: { session: stub }, turn: 1, step: 1, signal: new AbortController().signal } as never,
    (async () => ({ kind: 'continue' as const, messages: [] })) as never,
  ) as { messages: readonly { content: readonly { text: string }[] }[] }
  return decision.messages
}

describe('linkedTasks', () => {
  it('reports only the tasks whose sessionIds name this session, in the store order', async () => {
    const { projects } = await boot()
    const first = await projects.create({ title: 'Release', workspace: '/repo' })
    let view = await projects.addTask({ id: first.id, revision: first.revision }, { title: 'cut branch' })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[0]!.id, 'session-1')
    view = await projects.addTask({ id: view.id, revision: view.revision }, { title: 'write notes' })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[1]!.id, 'session-9')

    const linked = linkedTasks(projects, session('/repo'))
    expect(linked.map(entry => entry.task.title)).toEqual(['cut branch'])
    expect(linked[0]!.project.title).toBe('Release')
    expect(linkedTasks(projects, session('/elsewhere'))).toEqual([])
  })

  it('reads the whole open store for a session without a working directory', async () => {
    const { projects } = await boot()
    const plain = await projects.create({ title: 'Chores' })
    let view = await projects.addTask({ id: plain.id, revision: plain.revision }, { title: 'sweep' })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[0]!.id, 'session-1')
    expect(linkedTasks(projects, session(undefined)).map(entry => entry.task.title)).toEqual(['sweep'])
    await projects.close({ id: view.id, revision: view.revision })
    expect(linkedTasks(projects, session(undefined))).toEqual([])
  })
})

describe('renderNote', () => {
  it('states the project revision, the status, and the blockers of each linked task', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Release', workspace: '/repo' })
    let view = await projects.addTask({ id: created.id, revision: created.revision }, { title: 'cut branch' })
    const first = view.tasks[0]!.id
    view = await projects.addTask({ id: view.id, revision: view.revision }, { title: 'write notes', blockedBy: [first] })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, first, 'session-1')
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[1]!.id, 'session-1')

    const note = renderNote(linkedTasks(projects, session('/repo')), 8)
    expect(note).toContain('This session is linked to tasks on the durable project board:')
    expect(note).toContain('- Task `task-1` "cut branch" is todo in project "Release" (revision 4).')
    expect(note).toContain(', blocked by task-1).')
  })

  it('summarizes the entries past the bound and states nothing for an unlinked session', async () => {
    const { projects } = await boot()
    const created = await projects.create({ title: 'Release', workspace: '/repo' })
    let view = await projects.addTask({ id: created.id, revision: created.revision }, { title: 'one' })
    view = await projects.addTask({ id: view.id, revision: view.revision }, { title: 'two' })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[0]!.id, 'session-1')
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[1]!.id, 'session-1')

    const note = renderNote(linkedTasks(projects, session('/repo')), 1)
    expect(note).toContain('"one"')
    expect(note).not.toContain('"two"')
    expect(note).toContain('- 1 further linked task(s) are not listed.')
    expect(renderNote([], 8)).toBeUndefined()
  })
})

describe('apply', () => {
  it('injects the note once per board state and again after the board links another task', async () => {
    const { ctx, projects } = await boot()
    ctx.provide('agents', {} as never)
    await ctx.plugin({ inject: [...inject], apply }, { maxTasksListed: 8 })

    const created = await projects.create({ title: 'Release', workspace: '/repo' })
    let view = await projects.addTask({ id: created.id, revision: created.revision }, { title: 'cut branch' })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[0]!.id, 'session-1')

    const first = await preStep(ctx, session('/repo'))
    expect(first).toHaveLength(1)
    expect(first[0]!.content[0]!.text).toContain('"cut branch"')
    expect(await preStep(ctx, session('/repo'))).toHaveLength(0)

    view = await projects.addTask({ id: view.id, revision: view.revision }, { title: 'write notes' })
    view = await projects.linkSession({ id: view.id, revision: view.revision }, view.tasks[1]!.id, 'session-1')
    const afterChange = await preStep(ctx, session('/repo'))
    expect(afterChange).toHaveLength(1)
    expect(afterChange[0]!.content[0]!.text).toContain('"write notes"')
  })

  it('stays quiet for an unlinked session and leaves a rejection and an aborted call alone', async () => {
    const { ctx } = await boot()
    ctx.provide('agents', {} as never)
    await ctx.plugin({ inject: [...inject], apply }, { maxTasksListed: 8 })

    expect(await preStep(ctx, session('/repo'))).toHaveLength(0)

    const rejecting = await ctx.waterfall(
      'agent/pre-step',
      { agent: { session: session('/repo') }, turn: 1, step: 1, signal: new AbortController().signal } as never,
      (async () => ({ kind: 'reject' as const, reason: 'no' })) as never,
    ) as { kind: string }
    expect(rejecting.kind).toBe('reject')

    const controller = new AbortController()
    controller.abort()
    const aborted = await ctx.waterfall(
      'agent/pre-step',
      { agent: { session: session('/repo') }, turn: 1, step: 1, signal: controller.signal } as never,
      (async () => ({ kind: 'continue' as const, messages: [] })) as never,
    ) as { messages: readonly unknown[] }
    expect(aborted.messages).toHaveLength(0)
  })

  it('declares the store it reads and the default bound its configuration carries', () => {
    expect(name).toBe('project-context')
    expect(inject).toEqual(['agents', 'projects'])
    const withDefaults = Config as unknown as (input: Record<string, unknown>) => { maxTasksListed: number }
    expect(withDefaults({}).maxTasksListed).toBe(8)
  })

  it('renders an entry list into one plugin-sourced message', async () => {
    const entry: LinkedTask = {
      project: { id: 'p' as ProjectId, title: 'Release', status: 'active', createdAt: 0, updatedAt: 0, revision: 2, tasks: [] },
      task: { id: 'task-1' as TaskId, title: 'cut branch', status: 'todo', blockedBy: [], sessionIds: ['session-1'], createdAt: 0, updatedAt: 0 },
    }
    const note = renderNote([entry], 8)
    expect(note).toBe([
      'This session is linked to tasks on the durable project board:',
      '- Task `task-1` "cut branch" is todo in project "Release" (revision 2).',
    ].join('\n'))
  })
})
