/**
 * Project context: tell the model which durable board tasks this session is
 * linked to.
 *
 * A board outlives the session that created it, so a task another session
 * links this one to would otherwise be invisible to the model. The note is
 * derived from `ctx.projects` at request time and injected once per board
 * state: an unchanged board stays silent, and a reload or fork that re-reads
 * the same board reads the same note again.
 * @module @deepseek-ai/dsh-project-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ProjectStore, ProjectView, TaskView } from '@deepseek-ai/dsh-project'
import type { Session } from '@deepseek-ai/dsh-session'

/** Plugin name, which also marks this plugin's own injected messages. */
export const name = 'project-context'

/** The agent registry that owns pre-step processing, and the board it is read from. */
export const inject = ['agents', 'projects']

/** Deployment-varying bound on one note. */
export interface Config {
  /** Maximum linked tasks one note lists. */
  maxTasksListed: number
}

/** Validated plugin configuration, read from the composition row. */
export const Config: z<Config> = z.object({
  maxTasksListed: z.natural().min(1).default(8),
})

/** One task this session is linked to, with the project that holds it. */
export interface LinkedTask {
  /** The project holding the task. */
  readonly project: ProjectView
  /** The task whose `sessionIds` name this session. */
  readonly task: TaskView
}

/**
 * The tasks linking one session, in listing order: projects newest first as the
 * store returns them, tasks in creation order within each project. Closed
 * projects stay out, exactly as the store's own listing keeps them out of what a
 * reader sees by default.
 * @param projects - the durable board store.
 * @param session - the session whose links are read.
 * @returns one entry per linked task; empty when the session links none.
 */
export function linkedTasks(projects: ProjectStore, session: Session): LinkedTask[] {
  const workspace = session.header.cwd
  const sessionId = String(session.id)
  const found: LinkedTask[] = []
  for (const project of projects.list(workspace === undefined ? {} : { workspace })) {
    for (const task of project.tasks) {
      if (task.sessionIds.includes(sessionId)) found.push({ project, task })
    }
  }
  return found
}

/**
 * Render the note, or undefined when there is nothing to report.
 * @param entries - the linked tasks to report.
 * @param maxTasksListed - how many entries one note lists before it summarizes the rest.
 * @returns the model-facing text, or undefined for an empty list.
 */
export function renderNote(entries: readonly LinkedTask[], maxTasksListed: number): string | undefined {
  if (entries.length === 0) return undefined
  const shown = entries.slice(0, maxTasksListed)
  const lines = shown.map(({ project, task }) => {
    const blockers = task.blockedBy.length === 0 ? '' : `, blocked by ${task.blockedBy.join(', ')}`
    return `- Task \`${String(task.id)}\` "${task.title}" is ${task.status} in project "${project.title}" (revision ${String(project.revision)}${blockers}).`
  })
  const omitted = entries.length - shown.length
  return [
    'This session is linked to tasks on the durable project board:',
    ...lines,
    ...omitted > 0 ? [`- ${String(omitted)} further linked task(s) are not listed.`] : [],
  ].join('\n')
}

/**
 * Register the pre-step listener for the lifetime of `ctx`.
 * @param ctx - plugin context carrying the board store; the listener is disposed with it.
 * @param config - validated configuration read from the composition row.
 */
export function apply(ctx: Context, config: Config): void {
  let lastNote: string | undefined
  ctx.on('agent/pre-step', async (
    { agent, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const text = renderNote(linkedTasks(ctx.projects, agent.session), config.maxTasksListed)
    // An unchanged board stays silent: the model read the same state once
    // already, and repeating it every step would spend tokens on no new fact.
    if (text === undefined || text === lastNote) return decision
    lastNote = text
    return {
      ...decision,
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
