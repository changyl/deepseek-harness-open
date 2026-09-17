/**
 * Pure derivations and validation over stored project records. Every rule the
 * store enforces lives here so it can be exercised without a storage backend,
 * and so the store's only remaining job is durability and the compare-and-set
 * write.
 *
 * @module @deepseek-ai/dsh-project/board
 */

import { ProjectError } from './errors.ts'
import type { ProjectRecord, ProjectTaskRecord } from './spec.ts'
import type { ProjectBoard, ProjectId, ProjectView, TaskId, TaskStatus, TaskView } from './types.ts'

/** Longest accepted task or project title, in characters. */
export const MAX_TITLE_LENGTH = 200

/** Statuses that count as finished for dependency purposes. */
const FINISHED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['done', 'cancelled'])

/**
 * Whether one task is finished for dependency purposes.
 * @param status - the task's status.
 * @returns whether dependents may start.
 */
export function isFinished(status: TaskStatus): boolean {
  return FINISHED.has(status)
}

/**
 * Validate and normalize one title.
 * @param title - the raw title.
 * @returns the trimmed title.
 * @throws ProjectError `project/invalid-input` when it is empty or too long.
 */
export function normalizeTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    throw new ProjectError('project/invalid-input', 'a project or task title cannot be empty')
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new ProjectError('project/invalid-input', `a title cannot exceed ${String(MAX_TITLE_LENGTH)} characters`)
  }
  return trimmed
}

/**
 * Serve one stored task as its view.
 * @param task - the stored task.
 * @returns the detached view.
 */
export function taskView(task: ProjectTaskRecord): TaskView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    blockedBy: [...task.blockedBy],
    sessionIds: [...task.sessionIds],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

/**
 * Serve one stored project as its view.
 * @param id - stored project key.
 * @param record - the stored record.
 * @returns the detached view.
 */
export function projectView(id: string, record: ProjectRecord): ProjectView {
  return {
    id: id as ProjectId,
    title: record.title,
    status: record.status,
    ...record.workspace === undefined ? {} : { workspace: record.workspace },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    tasks: record.tasks.map(taskView),
  }
}

/**
 * Find one task in a record.
 * @param record - the stored project.
 * @param taskId - task to find.
 * @returns the stored task.
 * @throws ProjectError `project/unknown-task` when it is absent.
 */
export function requireTask(record: ProjectRecord, taskId: TaskId): ProjectTaskRecord {
  const task = record.tasks.find(candidate => candidate.id === taskId)
  if (task === undefined) {
    throw new ProjectError('project/unknown-task', `no task ${String(taskId)} exists in this project`)
  }
  return task
}

/**
 * Allocate the next task id in creation order.
 * @param tasks - the project's current tasks.
 * @returns an id that sorts after every existing one.
 */
export function allocateTaskId(tasks: readonly ProjectTaskRecord[]): TaskId {
  let highest = 0
  for (const task of tasks) {
    const match = /^task-(\d+)$/u.exec(task.id)
    if (match === null) continue
    const value = Number(match[1])
    if (Number.isSafeInteger(value) && value > highest) highest = value
  }
  return `task-${String(highest + 1)}` as TaskId
}

/**
 * Validate a dependency set against the project.
 * @param tasks - every task in the project.
 * @param owner - the task the dependencies belong to.
 * @param blockedBy - the requested dependencies.
 * @returns the deduplicated dependency list in the requested order.
 * @throws ProjectError when a dependency is unknown, is the owner itself, or would close a cycle.
 */
export function assertBlockedByUsable(
  tasks: readonly ProjectTaskRecord[],
  owner: TaskId,
  blockedBy: readonly TaskId[],
): TaskId[] {
  const seen = new Set<TaskId>()
  const ordered: TaskId[] = []
  for (const dependency of blockedBy) {
    if (String(dependency) === String(owner)) {
      throw new ProjectError('project/invalid-input', 'a task cannot depend on itself')
    }
    const target = tasks.find(candidate => candidate.id === dependency)
    if (target === undefined) {
      throw new ProjectError('project/unknown-task', `no task ${String(dependency)} exists in this project`)
    }
    if (seen.has(dependency)) continue
    seen.add(dependency)
    ordered.push(dependency)
  }
  assertNoCycle(tasks, owner, ordered)
  return ordered
}

/**
 * Reject a dependency set that would make `owner` reachable from itself. The
 * owner's stored edges are replaced by `blockedBy` before the walk, so this
 * checks the post-write graph.
 * @param tasks - every task in the project.
 * @param owner - the task whose dependencies are being set.
 * @param blockedBy - the requested dependencies.
 * @throws ProjectError `project/dependency-cycle` when the graph would gain a cycle.
 */
export function assertNoCycle(
  tasks: readonly ProjectTaskRecord[],
  owner: TaskId,
  blockedBy: readonly TaskId[],
): void {
  const edges = new Map<string, readonly TaskId[]>()
  for (const task of tasks) {
    edges.set(String(task.id), String(task.id) === String(owner) ? blockedBy : task.blockedBy)
  }
  if (!edges.has(String(owner))) edges.set(String(owner), blockedBy)

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of edges.get(id) ?? []) {
      if (walk(String(next))) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  for (const id of edges.keys()) {
    if (walk(id)) {
      throw new ProjectError('project/dependency-cycle', 'that dependency would create a cycle between tasks')
    }
  }
}

/**
 * Unfinished dependencies of one task.
 * @param tasks - every task in the project.
 * @param task - the task to inspect.
 * @returns its blockers that are neither done nor cancelled.
 */
export function unfinishedBlockers(
  tasks: readonly ProjectTaskRecord[],
  task: ProjectTaskRecord,
): ProjectTaskRecord[] {
  const byId = new Map(tasks.map(candidate => [String(candidate.id), candidate]))
  return task.blockedBy
    .map(id => byId.get(String(id)))
    .filter((candidate): candidate is ProjectTaskRecord => candidate !== undefined && !isFinished(candidate.status))
}

/**
 * Validate one status change against the task's dependencies.
 * @param tasks - every task in the project.
 * @param task - the task being changed.
 * @param next - the requested status.
 * @throws ProjectError when the status contradicts the dependency state.
 */
export function assertStatusAllowed(
  tasks: readonly ProjectTaskRecord[],
  task: ProjectTaskRecord,
  next: TaskStatus,
): void {
  if (next === 'doing' || next === 'done') {
    const blockers = unfinishedBlockers(tasks, task)
    if (blockers.length > 0) {
      throw new ProjectError(
        'project/invalid-input',
        `${String(task.id)} cannot be ${next} while blocked by ${blockers.map(blocker => String(blocker.id)).join(', ')}`,
      )
    }
  }
  if (next === 'blocked' && unfinishedBlockers(tasks, task).length === 0) {
    throw new ProjectError(
      'project/invalid-input',
      `${String(task.id)} has no unfinished dependency, so it cannot be blocked`,
    )
  }
}

/**
 * Derive the board a client or a model reads.
 * @param project - the project view to lay out.
 * @returns status lanes, the tasks ready to start, and the stranded ones.
 */
export function boardOf(project: ProjectView): ProjectBoard {
  const byId = new Map(project.tasks.map(task => [String(task.id), task]))
  const columns: Record<TaskStatus, TaskView[]> = {
    todo: [], doing: [], blocked: [], done: [], cancelled: [],
  }
  const ready: TaskId[] = []
  const stranded: TaskId[] = []

  for (const task of project.tasks) {
    columns[task.status].push(task)
    const blocked = task.blockedBy.some((id) => {
      const dependency = byId.get(String(id))
      return dependency !== undefined && !isFinished(dependency.status)
    })
    if (task.status === 'todo' && !blocked) ready.push(task.id)
    if (task.status === 'doing' && blocked) stranded.push(task.id)
  }

  return { project, columns, ready, stranded }
}
