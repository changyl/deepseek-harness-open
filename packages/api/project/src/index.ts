/**
 * Host Remote owner for the project board: `ctx.remote.project` answers the
 * views `ctx.projects` serves, mapped onto plain wire values. The controller
 * adds no domain policy — validation, dependency rules, and compare-and-set
 * live in the store — it validates the request at the wire boundary, bounds the
 * listing, and classifies an unknown project as a Remote error.
 *
 * @module @deepseek-ai/dsh-api-project
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ProjectBoard, ProjectFilter, ProjectId, ProjectView, TaskView } from '@deepseek-ai/dsh-project'
import { z as zod } from 'zod'
import type {
  ProjectBoardWire,
  ProjectFilterWire,
  ProjectListWire,
  ProjectSummaryWire,
  ProjectTaskWire,
  ProjectViewWire,
} from './types.ts'

export type * from './types.ts'

/** Wire validation of one `list` request; the only untrusted input here. */
const filterSchema = zod.object({
  workspace: zod.string().optional(),
  includeClosed: zod.boolean().optional(),
}).strict()

/** Deployment-varying bound on one listing. */
export interface Config {
  /** Maximum projects one `list` answer carries. */
  maxProjectsListed: number
}

/** Validated configuration of the project Remote namespace. */
export const Config: z<Config> = z.object({
  maxProjectsListed: z.natural().min(1).default(20),
})

/** Copy one task onto the wire. */
function taskWire(task: TaskView): ProjectTaskWire {
  return {
    id: String(task.id),
    title: task.title,
    status: task.status,
    blockedBy: task.blockedBy.map(String),
    sessionIds: [...task.sessionIds],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

/** Copy one project and its tasks onto the wire. */
function projectWire(view: ProjectView): ProjectViewWire {
  return {
    id: String(view.id),
    title: view.title,
    status: view.status,
    ...view.workspace === undefined ? {} : { workspace: view.workspace },
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    revision: view.revision,
    tasks: view.tasks.map(taskWire),
  }
}

/** Copy one board onto the wire, lane by lane. */
function boardWire(board: ProjectBoard): ProjectBoardWire {
  return {
    project: projectWire(board.project),
    columns: {
      todo: board.columns.todo.map(taskWire),
      doing: board.columns.doing.map(taskWire),
      blocked: board.columns.blocked.map(taskWire),
      done: board.columns.done.map(taskWire),
      cancelled: board.columns.cancelled.map(taskWire),
    },
    ready: board.ready.map(String),
    stranded: board.stranded.map(String),
  }
}

/** Reduce one project and its board to the counts a list row renders. */
function summaryWire(view: ProjectView, board: ProjectBoard): ProjectSummaryWire {
  return {
    id: String(view.id),
    title: view.title,
    status: view.status,
    ...view.workspace === undefined ? {} : { workspace: view.workspace },
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    revision: view.revision,
    tasks: view.tasks.length,
    ready: board.ready.length,
    stranded: board.stranded.length,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `project` Remote namespace. */
    projectController: ProjectController
  }
}

/**
 * Host service backing the generated `ctx.remote.project` namespace. Every
 * response is a detached plain value; the controller holds no cache, so a
 * client always reads the store's current state.
 */
export class ProjectController extends TypertRemoteService {
  /**
   * The controller answers only from the project store it names. The Gateway
   * discovers the namespace through `typertRemote`, so a Host composition
   * without the gateway can still mount it.
   */
  static inject = ['projects']

  /** Validated configuration, read from the composition row. */
  static Config: z<Config> = Config

  private readonly maxProjectsListed: number

  /**
   * @param ctx - Host context carrying `ctx.projects`.
   * @param config - listing bound for one answer.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'projectController', { namespace: 'project' })
    this.maxProjectsListed = config.maxProjectsListed
  }

  /**
   * List stored projects with the counts a board header renders.
   * @param filter - workspace selection and whether closed projects appear.
   * @returns the bounded listing and whether the bound cut it.
   * @throws RemoteError `gateway/bad-request` when the filter is malformed.
   */
  @Remote
  list(filter?: ProjectFilterWire): ProjectListWire {
    const parsed = filterSchema.safeParse(filter ?? {})
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', 'project.list received a malformed filter', {
        issues: parsed.error.issues,
      })
    }
    const selection: ProjectFilter = {
      ...parsed.data.workspace === undefined ? {} : { workspace: parsed.data.workspace },
      ...parsed.data.includeClosed === undefined ? {} : { includeClosed: parsed.data.includeClosed },
    }
    const views = this.ctx.projects.list(selection)
    const projects = views.slice(0, this.maxProjectsListed).map(view => summaryWire(view, this.requireBoard(view.id)))
    return { projects, truncated: views.length > projects.length }
  }

  /**
   * Read one project's board.
   * @param id - project identity as it appears on the wire.
   * @returns the project, its status lanes, and its workable and stranded tasks.
   * @throws RemoteError `gateway/bad-request` when the id is empty, `project/not-found` when no record carries it.
   */
  @Remote
  board(id: string): ProjectBoardWire {
    if (id.trim() === '') {
      throw new RemoteError('gateway/bad-request', 'project.board received an empty project id', {})
    }
    return boardWire(this.requireBoard(brandString<ProjectId>(id)))
  }

  /** Read one board, refusing an id no record carries. */
  private requireBoard(id: ProjectId): ProjectBoard {
    const board = this.ctx.projects.board(id)
    if (board === undefined) {
      throw new RemoteError('project/not-found', `project "${id}" not found`, { projectId: String(id) })
    }
    return board
  }
}

export default ProjectController
