/**
 * Model-facing project board tool. One tool named `project` exposes the
 * durable board a session shares with every other session in the same
 * workspace: list projects, create one, read its lanes, add and update tasks,
 * and link the calling session to a task.
 *
 * `todo_write` remains the session's working memory; this tool is the durable
 * board work survives in. Every result is bounded, and every mutation carries
 * the revision the model last read so a stale edit is refused instead of
 * overwriting another session's change.
 *
 * @module @deepseek-ai/dsh-tool-project
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  ProjectBoard,
  ProjectView,
  TaskId,
  TaskStatus,
  TaskView,
} from '@deepseek-ai/dsh-project'

/** Cordis plugin name. */
export const name = 'tool-project'

/** The tool needs its registry and the store it reads. */
export const inject = ['tools', 'projects']

/** Plugin configuration: every bound the tool applies to what it returns. */
export interface Config {
  /** Maximum projects a `list` action returns. */
  maxProjectsListed: number
  /** Maximum tasks a `read` action returns across all lanes. */
  maxTasksListed: number
  /** Maximum characters of one project or task title in a result. */
  maxTitleLength: number
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  maxProjectsListed: z.number().step(1).min(1).default(20),
  maxTasksListed: z.number().step(1).min(1).default(50),
  maxTitleLength: z.number().step(1).min(1).default(120),
})

/** Actions the model may request. */
const ACTIONS = ['list', 'create', 'read', 'add_task', 'update_task', 'link_session'] as const

/** Task statuses the model may set. */
const TASK_STATUSES = ['todo', 'doing', 'blocked', 'done', 'cancelled'] as const

/** One model-supplied call. */
type ProjectToolArgs = {
  readonly action: (typeof ACTIONS)[number]
  readonly project_id?: string
  readonly revision?: number
  readonly title?: string
  readonly task_id?: string
  readonly status?: (typeof TASK_STATUSES)[number]
  readonly blocked_by?: readonly string[]
  readonly include_closed?: boolean
}

/** The bounded project summary a `list` action returns. */
export interface ProjectSummary {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly revision: number
  readonly tasks: number
  readonly ready: number
  readonly updatedAt: number
}

/** One bounded task row. */
export interface TaskRow {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly blockedBy: readonly string[]
  readonly sessionIds: readonly string[]
}

/** The bounded board a `read` action returns. */
export interface BoardResult {
  readonly id: string
  readonly title: string
  readonly status: string
  readonly revision: number
  readonly ready: readonly string[]
  readonly stranded: readonly string[]
  readonly tasks: readonly TaskRow[]
  readonly truncated: boolean
}

/**
 * Shorten one title to the configured bound.
 * @param title - the stored title.
 * @param limit - maximum characters to keep.
 * @returns the title, truncated with an ellipsis when it exceeded the bound.
 */
export function shorten(title: string, limit: number): string {
  return title.length <= limit ? title : `${title.slice(0, Math.max(0, limit - 1))}…`
}

/**
 * Summarize one project for a list result.
 * @param project - the stored project view.
 * @param limit - title character bound.
 * @returns the bounded summary.
 */
export function summarize(project: ProjectView, limit: number): ProjectSummary {
  const ready = project.tasks.filter(task => task.status === 'todo'
    && task.blockedBy.every((id) => {
      const dependency = project.tasks.find(candidate => candidate.id === id)
      return dependency !== undefined && (dependency.status === 'done' || dependency.status === 'cancelled')
    })).length
  return {
    id: String(project.id),
    title: shorten(project.title, limit),
    status: project.status,
    revision: project.revision,
    tasks: project.tasks.length,
    ready,
    updatedAt: project.updatedAt,
  }
}

/**
 * Render one task row.
 * @param task - the stored task view.
 * @param limit - title character bound.
 * @returns the bounded row.
 */
export function taskRow(task: TaskView, limit: number): TaskRow {
  return {
    id: String(task.id),
    title: shorten(task.title, limit),
    status: task.status,
    blockedBy: task.blockedBy.map(String),
    sessionIds: [...task.sessionIds],
  }
}

/**
 * Bound one board to the configured task limit.
 * @param board - the derived board.
 * @param config - the tool's bounds.
 * @returns the bounded board result.
 */
export function boundBoard(board: ProjectBoard, config: Config): BoardResult {
  const tasks = board.project.tasks.slice(0, config.maxTasksListed)
  return {
    id: String(board.project.id),
    title: shorten(board.project.title, config.maxTitleLength),
    status: board.project.status,
    revision: board.project.revision,
    ready: board.ready.map(String),
    stranded: board.stranded.map(String),
    tasks: tasks.map(task => taskRow(task, config.maxTitleLength)),
    truncated: board.project.tasks.length > tasks.length,
  }
}

/**
 * Require one argument, naming the action that needs it.
 * @param value - the supplied value.
 * @param field - argument name, used in the error.
 * @returns the value.
 * @throws Error naming the missing argument.
 */
function requireArg<T>(value: T | undefined, field: string): T {
  if (value === undefined) throw new Error(`${field} is required for this action`)
  return value
}

/** The revision-bearing reference one mutation needs. */
interface MutationTarget {
  readonly id: ProjectView['id']
  readonly revision: number
}

/**
 * Resolve the project a mutation targets, from the model's own arguments.
 * @param store - the project store.
 * @param args - the model's call.
 * @returns the project id and the revision the model last read.
 * @throws Error when either argument is absent or the project is unknown.
 */
function mutationTarget(store: Context['projects'], args: ProjectToolArgs): MutationTarget {
  const id = requireArg(args.project_id, 'project_id') as ProjectView['id']
  const revision = requireArg(args.revision, 'revision')
  const project = store.get(id)
  if (project === undefined) throw new Error(`no project ${String(id)} exists; use action "list" to find one`)
  return { id, revision }
}

/**
 * Run one tool call against the store.
 * @param ctx - host context carrying the project store.
 * @param config - the tool's bounds.
 * @param args - the model's call.
 * @param sessionId - calling session, when the tool has one.
 * @param workspace - the calling session's working directory, when it has one.
 * @returns the bounded result for the requested action.
 */
async function executeProject(
  ctx: Context,
  config: Config,
  args: ProjectToolArgs,
  sessionId: string | undefined,
  workspace: string | undefined,
): Promise<Record<string, unknown>> {
  const store = ctx.projects
  switch (args.action) {
    case 'list': {
      const listed = store.list({
        ...workspace === undefined ? {} : { workspace },
        ...args.include_closed === undefined ? {} : { includeClosed: args.include_closed },
      })
      const projects = listed.slice(0, config.maxProjectsListed)
      return {
        projects: projects.map(project => summarize(project, config.maxTitleLength)),
        truncated: listed.length > projects.length,
      }
    }
    case 'create': {
      const project = await store.create({
        title: requireArg(args.title, 'title'),
        ...workspace === undefined ? {} : { workspace },
      })
      return { project: summarize(project, config.maxTitleLength), revision: project.revision, id: String(project.id) }
    }
    case 'read': {
      const id = requireArg(args.project_id, 'project_id') as ProjectView['id']
      const board = store.board(id)
      if (board === undefined) throw new Error(`no project ${String(id)} exists; use action "list" to find one`)
      return { board: boundBoard(board, config) }
    }
    case 'add_task': {
      const target = mutationTarget(store, args)
      const project = await store.addTask(target, {
        title: requireArg(args.title, 'title'),
        ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by as readonly TaskId[] },
      })
      return { project: summarize(project, config.maxTitleLength), revision: project.revision }
    }
    case 'update_task': {
      const target = mutationTarget(store, args)
      const project = await store.updateTask(target, requireArg(args.task_id, 'task_id') as TaskId, {
        ...args.title === undefined ? {} : { title: args.title },
        ...args.status === undefined ? {} : { status: args.status },
        ...args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by as readonly TaskId[] },
      })
      return { project: summarize(project, config.maxTitleLength), revision: project.revision }
    }
    case 'link_session': {
      const session = requireArg(sessionId, 'a calling session')
      const target = mutationTarget(store, args)
      const project = await store.linkSession(target, requireArg(args.task_id, 'task_id') as TaskId, session)
      return { project: summarize(project, config.maxTitleLength), revision: project.revision }
    }
  }
}

/** Output schema of one bounded task row. */
const TASK_ROW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    blockedBy: { type: 'array', required: true, items: { type: 'string' } },
    sessionIds: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** Output schema of one bounded project summary. */
const PROJECT_SUMMARY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    tasks: { type: 'integer', required: true },
    ready: { type: 'integer', required: true },
    updatedAt: { type: 'integer', required: true },
  },
} as const

/** Output schema of one bounded board. */
const BOARD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    status: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    ready: { type: 'array', required: true, items: { type: 'string' } },
    stranded: { type: 'array', required: true, items: { type: 'string' } },
    tasks: { type: 'array', required: true, items: TASK_ROW },
    truncated: { type: 'boolean', required: true },
  },
} as const

/** Model-facing description of the actions and the revision contract. */
const DESCRIPTION = [
  'Read and change the durable project board shared by every session in this working directory.',
  'Actions: list (projects), create (title), read (project_id), add_task (project_id, revision, title, blocked_by?),',
  'update_task (project_id, revision, task_id, title?/status?/blocked_by?), link_session (project_id, revision, task_id).',
  'Every mutation needs the revision returned by the last read of that project: a stale revision is refused, so re-read and retry.',
  'A task cannot start or finish while a task it is blocked_by is unfinished, and dependencies may not form a cycle.',
  'Use todo_write for the work of this session; use this board for work that must survive the session.',
].join(' ')

/**
 * Register the `project` tool.
 * @param ctx - host context carrying the tool registry and project store.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'project',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: [...ACTIONS],
        description: 'list | create | read | add_task | update_task | link_session.',
      },
      project_id: { type: 'string', description: 'Target project id, from list or create.' },
      revision: { type: 'integer', description: 'Revision returned by the last read of this project.' },
      title: { type: 'string', description: 'Project title for create, or task title for add_task/update_task.' },
      task_id: { type: 'string', description: 'Target task id, from read.' },
      status: { type: 'string', enum: [...TASK_STATUSES], description: 'Task status for update_task.' },
      blocked_by: {
        type: 'array',
        items: { type: 'string' },
        description: 'Complete dependency list for the task; tasks that must finish first.',
      },
      include_closed: { type: 'boolean', description: 'Include closed projects in list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projects: {
            type: 'array',
            items: PROJECT_SUMMARY,
            description: 'Bounded project summaries from list.',
          },
          project: { ...PROJECT_SUMMARY, description: 'Summary of the project a mutation or create returned.' },
          board: { ...BOARD, description: 'The bounded board a read returned.' },
          id: { type: 'string', description: 'Id of a created project.' },
          revision: { type: 'integer', description: 'Revision after a mutation; carry it into the next call.' },
          truncated: { type: 'boolean', description: 'Whether the result omitted projects or tasks.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.board !== undefined
          ? `Read project ${value.board.id}: ${String(value.board.tasks.length)} task(s).`
          : value.projects !== undefined
            ? `Listed ${String(value.projects.length)} project(s).`
            : value.id !== undefined
              ? `Created project ${value.id}.`
              : 'Updated the project board.',
      }],
    },
    execute(args, exec) {
      const call = args as ProjectToolArgs
      const session = exec.agent?.session
      return executeProject(
        ctx,
        config,
        call,
        session === undefined ? undefined : String(session.id),
        session?.header.cwd,
      )
    },
    presentCall: args => ({
      card: 'generic',
      title: `Project ${args.action}`,
      kind: 'other',
      rawInput: args,
    }),
  }))
}
