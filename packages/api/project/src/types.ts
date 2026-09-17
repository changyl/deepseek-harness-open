/**
 * Plain values the `project` Remote namespace carries. They mirror the views
 * `ctx.projects` serves, with branded identities widened to strings and no
 * behavior of their own, so a client can render a board without linking the
 * project store.
 *
 * @module @deepseek-ai/dsh-api-project/types
 */

/**
 * Wire copy of the domain's task status union. The controller assigns store
 * values into these fields, so a change to either union fails the build.
 */
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled'

/** Wire copy of the domain's project status union, checked the same way. */
export type ProjectStatus = 'active' | 'closed'

/** One task on the wire. */
export interface ProjectTaskWire {
  /** Task identity, unique within its project. */
  readonly id: string
  /** Short imperative line stating the work. */
  readonly title: string
  /** Current state. */
  readonly status: TaskStatus
  /** Tasks that must finish before this one can be worked or finished. */
  readonly blockedBy: readonly string[]
  /** Sessions linked to this task, in link order. */
  readonly sessionIds: readonly string[]
  /** Host-assigned creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the last material change. */
  readonly updatedAt: number
}

/** One project with its complete task list, on the wire. */
export interface ProjectViewWire {
  /** Project identity. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Whether the project accepts task work. */
  readonly status: ProjectStatus
  /** Canonical working directory this project belongs to, when it was created from one. */
  readonly workspace?: string
  /** Host-assigned creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the last material change. */
  readonly updatedAt: number
  /** Compare-and-set revision a later mutation must present. */
  readonly revision: number
  /** Tasks in creation order. */
  readonly tasks: readonly ProjectTaskWire[]
}

/**
 * One row of the project list. Carries the counts a board header renders
 * without shipping every task of every project.
 */
export interface ProjectSummaryWire {
  /** Project identity. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Whether the project accepts task work. */
  readonly status: ProjectStatus
  /** Canonical working directory this project belongs to, when it was created from one. */
  readonly workspace?: string
  /** Host-assigned creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the last material change. */
  readonly updatedAt: number
  /** Compare-and-set revision a later mutation must present. */
  readonly revision: number
  /** Number of tasks the project holds. */
  readonly tasks: number
  /** `todo` tasks whose blockers are all finished. */
  readonly ready: number
  /** `doing` tasks whose blockers are not all finished. */
  readonly stranded: number
}

/** Answer to one list request. */
export interface ProjectListWire {
  /** Matching projects in the store's listing order, newest created first. */
  readonly projects: readonly ProjectSummaryWire[]
  /** Whether the deployment's listing bound cut the result. */
  readonly truncated: boolean
}

/** The board a client renders: the project, its lanes, and its workable tasks. */
export interface ProjectBoardWire {
  /** The complete project view. */
  readonly project: ProjectViewWire
  /** Tasks grouped by status, each lane in creation order. */
  readonly columns: Readonly<Record<TaskStatus, readonly ProjectTaskWire[]>>
  /** `todo` tasks whose blockers are all finished, in creation order. */
  readonly ready: readonly string[]
  /** `doing` tasks whose blockers are not all finished, in creation order. */
  readonly stranded: readonly string[]
}

/** Selection over the stored projects; the only untrusted request field. */
export interface ProjectFilterWire {
  /** Restrict to projects whose `workspace` equals this canonical path. */
  readonly workspace?: string
  /** Include closed projects; default false. */
  readonly includeClosed?: boolean
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No stored project carries the requested identity. */
    'project/not-found': { readonly projectId: string }
  }
}
