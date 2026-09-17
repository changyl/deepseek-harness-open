/**
 * Durable shape of the project domain: one record per project holding its
 * tasks. Tasks live inside their project record so a task change and the
 * revision it bumps are one durable write, and the compare-and-set token can
 * never disagree with the task list it belongs to.
 *
 * @module @deepseek-ai/dsh-project/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { TaskId } from './types.ts'

/** Task statuses the durable record accepts. */
const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done', 'cancelled'] as const

/** Project statuses the durable record accepts. */
const PROJECT_STATUSES = ['active', 'closed'] as const

const taskId = z.string().min(1).transform(value => brandString<TaskId>(value))

/** One stored task. */
export const projectTaskRecord = z.object({
  id: taskId,
  title: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  blockedBy: z.array(taskId),
  sessionIds: z.array(z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
})

/** One stored project. */
export const projectRecord = z.object({
  title: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  workspace: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  revision: z.number().int().nonnegative(),
  tasks: z.array(projectTaskRecord),
})

/** One stored project, inferred from {@link projectRecord}. */
export type ProjectRecord = z.infer<typeof projectRecord>

/** One stored task, inferred from {@link projectTaskRecord}. */
export type ProjectTaskRecord = z.infer<typeof projectTaskRecord>

/**
 * The project domain: one `projects` table keyed by project id. Deleting a
 * record deletes that project's tasks with it, which is what makes the domain
 * the only owner of task state.
 */
export const projectDomainSpec = defineDomain({
  name: 'project',
  version: 1,
  tables: { projects: domainTable<string, ProjectRecord>(projectRecord) },
})
