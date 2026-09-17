/**
 * Human `/project` command over the durable project store. It lists the
 * projects of the calling session's working directory and renders one board —
 * its lanes, the tasks ready to start, and the ones stranded behind an
 * unfinished dependency — without spending a model turn.
 *
 * The command is read-only on purpose: state changes belong to the model's
 * `project` tool and to a future board UI, both of which carry the
 * compare-and-set revision a mutation needs.
 *
 * @module @deepseek-ai/dsh-command-project
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { boardOf } from '@deepseek-ai/dsh-project'
import type { ProjectView, TaskStatus } from '@deepseek-ai/dsh-project'

/** Cordis plugin name. */
export const name = 'command-project'

/** The command needs the registry to register into and the store that owns the board. */
export const inject = ['commands', 'projects']

/** Input hint shown by discovery surfaces. */
const INPUT_HINT = '[<project-id>]'

const USAGE = `Usage: /project ${INPUT_HINT}
Without an id it lists the projects of this working directory; with one it renders that board.`

/** One parsed invocation. */
type ProjectCommand =
  | { readonly kind: 'list' }
  | { readonly kind: 'board'; readonly id: string }
  | { readonly kind: 'invalid'; readonly text: string }

/**
 * Parse one `/project` invocation.
 * @param rawInput - text following the command name, including separator whitespace.
 * @returns the selection, or the error text naming the offending token.
 */
export function parseProjectCommand(rawInput: string): ProjectCommand {
  const [first, ...rest] = rawInput.trim().split(/\s+/).filter(part => part.length > 0)
  if (first === undefined) return { kind: 'list' }
  if (rest.length > 0) return { kind: 'invalid', text: `Name one project id, not several.\n${USAGE}` }
  return { kind: 'board', id: first }
}

/**
 * Render one task line.
 * @param id - task id.
 * @param title - task title.
 * @param status - task status.
 * @param blockers - unfinished blocker ids.
 * @returns the rendered line.
 */
function taskLine(id: string, title: string, status: TaskStatus, blockers: readonly string[]): string {
  const suffix = blockers.length === 0 ? '' : ` (blocked by ${blockers.join(', ')})`
  return `  [${status}] ${id} ${title}${suffix}`
}

/**
 * Render the project list.
 * @param projects - the projects to render, newest first.
 * @returns the rendered text.
 */
export function renderProjectList(projects: readonly ProjectView[]): string {
  if (projects.length === 0) {
    return 'No project exists for this working directory yet. Ask the model to create one, then run /project again.'
  }
  const lines = [`Projects (${String(projects.length)}):`]
  for (const project of projects) {
    const done = project.tasks.filter(task => task.status === 'done' || task.status === 'cancelled').length
    lines.push(
      `  ${String(project.id)} · ${project.title} · ${project.status}`
      + ` · revision ${String(project.revision)} · tasks ${String(done)}/${String(project.tasks.length)} finished`,
    )
  }
  lines.push(USAGE)
  return lines.join('\n')
}

/**
 * Render one project's board.
 * @param project - the project to render.
 * @returns the rendered text.
 */
export function renderProjectBoard(project: ProjectView): string {
  const board = boardOf(project)
  const unfinished = new Set(
    project.tasks
      .filter(task => task.status !== 'done' && task.status !== 'cancelled')
      .map(task => String(task.id)),
  )
  const lines = [
    `Project ${String(project.id)} · ${project.title} · ${project.status} · revision ${String(project.revision)}`,
  ]
  const statuses: readonly TaskStatus[] = ['todo', 'doing', 'blocked', 'done', 'cancelled']
  for (const status of statuses) {
    const tasks = board.columns[status]
    if (tasks.length === 0) continue
    lines.push(`${status} (${String(tasks.length)}):`)
    for (const task of tasks) {
      lines.push(taskLine(
        String(task.id),
        task.title,
        task.status,
        task.blockedBy.filter(id => unfinished.has(String(id))),
      ))
    }
  }
  if (project.tasks.length === 0) lines.push('  (no tasks)')
  if (board.ready.length > 0) lines.push(`Ready: ${board.ready.join(', ')}`)
  if (board.stranded.length > 0) lines.push(`Stranded: ${board.stranded.join(', ')} (a blocker is unfinished)`)
  return lines.join('\n')
}

/**
 * Execute one `/project` invocation against the store.
 * @param ctx - host context carrying `ctx.projects`.
 * @param invocation - the admitted command invocation.
 * @returns the rendered list or board, or the error text for an unknown id.
 */
export function executeProjectCommand(ctx: Context, invocation: CommandInvocation): CommandResult {
  const command = parseProjectCommand(invocation.rawInput)
  if (command.kind === 'invalid') return { kind: 'error', text: command.text }

  if (command.kind === 'list') {
    const workspace = invocation.agent.session.header.cwd
    return {
      kind: 'success',
      text: renderProjectList(ctx.projects.list(workspace === undefined ? {} : { workspace })),
    }
  }

  const project = ctx.projects.get(command.id as ProjectView['id'])
  if (project === undefined) {
    return { kind: 'error', text: `No project ${command.id} exists. Run /project to list the projects of this working directory.` }
  }
  return { kind: 'success', text: renderProjectBoard(project) }
}

/**
 * Register the global `/project` command.
 * @param ctx - host context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-project'),
    name: 'project',
    description: 'List projects or render one durable project board',
    input: { hint: INPUT_HINT },
    handler: invocation => executeProjectCommand(ctx, invocation),
  })
}
