/**
 * Durable project and task board on `ctx.projects`. The store owns one record
 * per project in the `project` storage domain, validates every dependency and
 * status rule before a write, and bumps a compare-and-set revision with every
 * material change so two callers cannot silently overwrite each other.
 *
 * The store is host-side state, not session history: nothing here reaches a
 * model until a consumer such as `dsh-tool-project` reads it and returns it as
 * a recorded tool result.
 *
 * @module @deepseek-ai/dsh-project
 */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  allocateTaskId,
  assertBlockedByUsable,
  assertStatusAllowed,
  boardOf,
  normalizeTitle,
  projectView,
  requireTask,
} from './board.ts'
import { ProjectError } from './errors.ts'
import { projectDomainSpec } from './spec.ts'
import type { ProjectRecord } from './spec.ts'
import type {
  ProjectBoard,
  ProjectFilter,
  ProjectId,
  ProjectRef,
  ProjectView,
  TaskId,
  TaskStatus,
} from './types.ts'

export type * from './types.ts'
export { ProjectError } from './errors.ts'
export type { ProjectErrorCode } from './errors.ts'
export {
  allocateTaskId,
  assertBlockedByUsable,
  assertNoCycle,
  assertStatusAllowed,
  boardOf,
  isFinished,
  MAX_TITLE_LENGTH,
  normalizeTitle,
  projectView,
  requireTask,
  taskView,
  unfinishedBlockers,
} from './board.ts'
export { projectDomainSpec, projectRecord, projectTaskRecord } from './spec.ts'
export type { ProjectRecord, ProjectTaskRecord } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    projects: ProjectStore
  }
}

/** Plugin configuration. */
export interface Config {
  /**
   * Maximum tasks one project may hold. The bound exists so a board stays a
   * readable tool result and one unbounded record cannot grow without limit.
   */
  maxTasksPerProject: number
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  maxTasksPerProject: z.number().step(1).min(1).default(256),
})

/** Input for {@link ProjectStore.create}. */
export interface CreateProjectInput {
  /** Display title. */
  title: string
  /** Canonical working directory this project belongs to. */
  workspace?: string
}

/** Input for {@link ProjectStore.addTask}. */
export interface AddTaskInput {
  /** Short imperative line stating the work. */
  title: string
  /** Tasks that must finish first. */
  blockedBy?: readonly TaskId[]
}

/** Patch for {@link ProjectStore.updateTask}; absent fields keep their value. */
export interface UpdateTaskPatch {
  /** Replacement title. */
  title?: string
  /** Replacement status. */
  status?: TaskStatus
  /** Replacement dependency set. */
  blockedBy?: readonly TaskId[]
}

/**
 * Durable project store. Opening the domain is the service's initialization:
 * until it completes, `ctx.projects` exists but every operation reports the
 * domain as unavailable.
 */
export class ProjectStore extends Service {
  /** Plugin configuration, read from the composition row. */
  static Config: z<Config> = Config
  /** The store is meaningless without the storage domain that persists it. */
  static inject = ['storageDomain']

  private table?: KvTable<string, ProjectRecord>
  private readonly maxTasksPerProject: number

  /**
   * @param ctx - context carrying `ctx.storageDomain`.
   * @param config - validated plugin configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'projects')
    this.maxTasksPerProject = config.maxTasksPerProject
  }

  /** Open the project domain and keep its table handle. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(projectDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'project.domainClose')
    this.table = domain.table('projects')
  }

  /**
   * Create one project.
   * @param input - title and optional workspace.
   * @returns the created project.
   */
  async create(input: CreateProjectInput): Promise<ProjectView> {
    const table = this.requireTable()
    const title = normalizeTitle(input.title)
    const id = randomUUID()
    const now = Date.now()
    const record: ProjectRecord = {
      title,
      status: 'active',
      ...input.workspace === undefined ? {} : { workspace: input.workspace },
      createdAt: now,
      updatedAt: now,
      revision: 0,
      tasks: [],
    }
    await table.put(id, record)
    return projectView(id, record)
  }

  /**
   * List stored projects newest first.
   * @param filter - workspace and closed-project selection.
   * @returns detached project views.
   */
  list(filter: ProjectFilter = {}): ProjectView[] {
    const views: ProjectView[] = []
    for (const [id, record] of this.requireTable().entries()) {
      if (filter.includeClosed !== true && record.status === 'closed') continue
      if (filter.workspace !== undefined && record.workspace !== filter.workspace) continue
      views.push(projectView(id, record))
    }
    // Newest first; Array.prototype.sort is stable, so projects created in
    // the same millisecond keep their insertion order.
    return views.sort((left, right) => right.createdAt - left.createdAt)
  }

  /**
   * Read one project.
   * @param id - project identity.
   * @returns the project view, or `undefined` when no record carries that id.
   */
  get(id: ProjectId): ProjectView | undefined {
    const record = this.requireTable().get(String(id))
    return record === undefined ? undefined : projectView(String(id), record)
  }

  /**
   * Read one project's board.
   * @param id - project identity.
   * @returns the board, or `undefined` when no record carries that id.
   */
  board(id: ProjectId): ProjectBoard | undefined {
    const view = this.get(id)
    return view === undefined ? undefined : boardOf(view)
  }

  /**
   * Rename one project.
   * @param ref - project and the revision the caller observed.
   * @param patch - the replacement title.
   * @returns the updated project.
   */
  update(ref: ProjectRef, patch: { title: string }): Promise<ProjectView> {
    return this.mutate(ref, record => ({ ...record, title: normalizeTitle(patch.title) }))
  }

  /**
   * Close one project. A closed project refuses further task work.
   * @param ref - project and the revision the caller observed.
   * @returns the updated project.
   */
  close(ref: ProjectRef): Promise<ProjectView> {
    return this.mutate(ref, record => ({ ...record, status: 'closed' }))
  }

  /**
   * Add one task to a project.
   * @param ref - project and the revision the caller observed.
   * @param input - title and optional dependencies.
   * @returns the updated project.
   * @throws ProjectError `project/closed` when the project is closed, or `project/limit-exceeded` at the task bound.
   */
  addTask(ref: ProjectRef, input: AddTaskInput): Promise<ProjectView> {
    return this.mutate(ref, (record) => {
      this.assertOpen(record)
      // Input and dependency validation precede the capacity check: a caller
      // submitting an unusable title or an unknown dependency learns that,
      // not that the project happens to be full.
      const id = allocateTaskId(record.tasks)
      const title = normalizeTitle(input.title)
      const blockedBy = assertBlockedByUsable(record.tasks, id, input.blockedBy ?? [])
      if (record.tasks.length >= this.maxTasksPerProject) {
        throw new ProjectError(
          'project/limit-exceeded',
          `this project already holds the maximum of ${String(this.maxTasksPerProject)} tasks`,
        )
      }
      const now = Date.now()
      return {
        ...record,
        tasks: [...record.tasks, {
          id,
          title,
          status: 'todo',
          blockedBy,
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        }],
      }
    })
  }

  /**
   * Change one task's title, status, or dependencies.
   * @param ref - project and the revision the caller observed.
   * @param taskId - task to change.
   * @param patch - the fields to replace.
   * @returns the updated project.
   * @throws ProjectError when the project is closed, the task is unknown, or the change violates a dependency rule.
   */
  updateTask(ref: ProjectRef, taskId: TaskId, patch: UpdateTaskPatch): Promise<ProjectView> {
    return this.mutate(ref, (record) => {
      this.assertOpen(record)
      const task = requireTask(record, taskId)
      const blockedBy = patch.blockedBy === undefined
        ? [...task.blockedBy]
        : assertBlockedByUsable(record.tasks, taskId, patch.blockedBy)
      const status = patch.status ?? task.status
      assertStatusAllowed(record.tasks, { ...task, blockedBy }, status)
      const updated = {
        ...task,
        title: patch.title === undefined ? task.title : normalizeTitle(patch.title),
        status,
        blockedBy,
        updatedAt: Date.now(),
      }
      return { ...record, tasks: record.tasks.map(candidate => candidate.id === taskId ? updated : candidate) }
    })
  }

  /**
   * Link one session to a task. Linking the same session twice is a no-op.
   * @param ref - project and the revision the caller observed.
   * @param taskId - task to link.
   * @param sessionId - session to record.
   * @returns the updated project.
   */
  linkSession(ref: ProjectRef, taskId: TaskId, sessionId: string): Promise<ProjectView> {
    return this.mutate(ref, (record) => {
      this.assertOpen(record)
      const task = requireTask(record, taskId)
      if (task.sessionIds.includes(sessionId)) return undefined
      const updated = { ...task, sessionIds: [...task.sessionIds, sessionId], updatedAt: Date.now() }
      return { ...record, tasks: record.tasks.map(candidate => candidate.id === taskId ? updated : candidate) }
    })
  }

  /**
   * Apply one validated change under the project's compare-and-set revision.
   * @param ref - project and the revision the caller observed.
   * @param apply - synchronous transform from the stored record to the next
   *   one, or `undefined` when the request changes nothing.
   * @returns the updated project view.
   * @throws ProjectError `project/not-found` or `project/stale-version`.
   */
  private async mutate(
    ref: ProjectRef,
    apply: (record: ProjectRecord) => ProjectRecord | undefined,
  ): Promise<ProjectView> {
    const table = this.requireTable()
    const key = String(ref.id)
    const stored = table.get(key)
    if (stored === undefined) {
      throw new ProjectError('project/not-found', `no project ${key} exists`)
    }
    if (stored.revision !== ref.revision) {
      throw new ProjectError(
        'project/stale-version',
        `project ${key} moved to revision ${String(stored.revision)}`,
      )
    }
    const next = await table.update(key, (target) => {
      if (target.revision !== ref.revision) {
        throw new ProjectError(
          'project/stale-version',
          `project ${key} moved to revision ${String(target.revision)}`,
        )
      }
      const updated = apply(target)
      // An unchanged request keeps the stored record: no revision bump, and no
      // change event for a write that changed nothing.
      return updated === undefined ? target : { ...updated, updatedAt: Date.now(), revision: target.revision + 1 }
    })
    return projectView(key, next)
  }

  /**
   * Reject task work on a closed project.
   * @param record - the stored project.
   */
  private assertOpen(record: ProjectRecord): void {
    if (record.status === 'closed') {
      throw new ProjectError('project/closed', 'this project is closed; reopen it before changing its tasks')
    }
  }

  /**
   * The open domain's table, or a loud failure before initialization.
   * @returns the project table handle.
   */
  private requireTable(): KvTable<string, ProjectRecord> {
    if (this.table === undefined) {
      throw new ProjectError('project/not-found', 'the project store is not initialized yet')
    }
    return this.table
  }
}

export default ProjectStore
