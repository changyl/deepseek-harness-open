/**
 * Pure types of the project domain: the durable record shapes the store
 * persists, the views it serves, and the compare-and-set reference a caller
 * carries between mutations. Nothing here reaches the model by itself — a
 * consumer such as `dsh-tool-project` decides what the model sees.
 *
 * @module @deepseek-ai/dsh-project/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque project identity. */
export type ProjectId = Branded<'ProjectId'>

/** Opaque task identity, unique within its project. */
export type TaskId = Branded<'TaskId'>

/**
 * Where one task stands. `blocked` is a statement about its dependencies, not
 * a separate lane a task may sit in while its blockers are done.
 */
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done' | 'cancelled'

/** Whether a project accepts task work. */
export type ProjectStatus = 'active' | 'closed'

/** One task as the store serves it. */
export interface TaskView {
  /** Task identity, unique within the project. */
  readonly id: TaskId
  /** Short imperative line stating the work. */
  readonly title: string
  /** Current state. */
  readonly status: TaskStatus
  /** Tasks that must finish before this one can be worked or finished. */
  readonly blockedBy: readonly TaskId[]
  /** Sessions linked to this task, in link order. */
  readonly sessionIds: readonly string[]
  /** Host-assigned creation time, Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the last material change. */
  readonly updatedAt: number
}

/** One project as the store serves it. */
export interface ProjectView {
  /** Project identity. */
  readonly id: ProjectId
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
  /**
   * Compare-and-set revision. Every material mutation increments it, and a
   * mutation presented with an older revision is refused.
   */
  readonly revision: number
  /** Tasks in creation order. */
  readonly tasks: readonly TaskView[]
}

/** Exact project revision a mutation acts on. */
export interface ProjectRef {
  /** Project identity. */
  readonly id: ProjectId
  /** Revision the caller last observed. */
  readonly revision: number
}

/**
 * The board a client or a model reads: the project plus the per-status lanes
 * and the tasks that are ready to start.
 */
export interface ProjectBoard {
  /** The complete project view. */
  readonly project: ProjectView
  /** Tasks grouped by status, each lane in creation order. */
  readonly columns: Readonly<Record<TaskStatus, readonly TaskView[]>>
  /**
   * `todo` tasks whose blockers are all `done` or `cancelled`, in creation
   * order: the work that can start now.
   */
  readonly ready: readonly TaskId[]
  /** `doing` tasks whose blockers are not all finished, in creation order. */
  readonly stranded: readonly TaskId[]
}

/** Selection over the stored projects. */
export interface ProjectFilter {
  /** Restrict to projects whose `workspace` equals this canonical path. */
  readonly workspace?: string
  /** Include closed projects; default false. */
  readonly includeClosed?: boolean
}
