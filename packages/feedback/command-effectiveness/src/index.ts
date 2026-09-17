/**
 * Human `/effectiveness` command over the cross-session effectiveness query.
 * It renders the outcome signals the corpus already carries — current human
 * feedback, change-review decisions, and verification outcomes — per route,
 * without spending a model turn. Every figure comes from `ctx.effectiveness`;
 * the command owns only its argument grammar and its text.
 *
 * @module @deepseek-ai/dsh-command-effectiveness
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {
  EffectivenessFilter,
  EffectivenessReport,
  EffectivenessRouteRow,
} from '@deepseek-ai/dsh-effectiveness-query'

/** Cordis plugin name. */
export const name = 'command-effectiveness'

/** The command needs the registry to register into and the service that owns the figures. */
export const inject = ['commands', 'effectiveness']

/** Input hint shown by discovery surfaces. */
const INPUT_HINT = '[<window>] [<provider>/<model>]'

const USAGE = `Usage: /effectiveness ${INPUT_HINT}
Windows: 24h, 7d, 30d, or all (default). Routes: <provider>/<model>.`

/** One named time window: its duration and how the invocation spelled it. */
interface NamedWindow {
  /** Window length in milliseconds. */
  readonly ms: number
  /** Exactly how the invocation spelled the window. */
  readonly label: string
}

/** One parsed invocation. */
type EffectivenessCommand =
  | { readonly kind: 'report'; readonly window?: NamedWindow; readonly route?: { provider: string; model: string } }
  | { readonly kind: 'invalid'; readonly text: string }

/** Milliseconds one hour and one day stand for when a window is parsed. */
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** A window token: `<n>h` or `<n>d`. */
const WINDOW = /^(\d+)([hd])$/

/** A route token: two non-empty, slash-separated names. */
const ROUTE = /^(?<provider>[^/\s]+)\/(?<model>[^/\s]+)$/

/**
 * Parse one `/effectiveness` invocation.
 * @param rawInput - text following the command name, including separator whitespace.
 * @returns the report selection, or the error text naming the offending token.
 */
export function parseEffectivenessCommand(rawInput: string): EffectivenessCommand {
  let named: NamedWindow | undefined
  let route: { provider: string; model: string } | undefined

  for (const token of rawInput.trim().split(/\s+/).filter(part => part.length > 0)) {
    if (token === 'all') {
      if (named !== undefined) return { kind: 'invalid', text: `Name one window, not several.\n${USAGE}` }
      continue
    }
    const window = WINDOW.exec(token)
    if (window !== null) {
      if (named !== undefined) return { kind: 'invalid', text: `Name one window, not several.\n${USAGE}` }
      const amount = Number(window[1])
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return { kind: 'invalid', text: `Window "${token}" must be a positive count of hours or days.\n${USAGE}` }
      }
      named = { ms: amount * (window[2] === 'h' ? HOUR_MS : DAY_MS), label: token }
      continue
    }
    const matched = ROUTE.exec(token)?.groups
    if (matched !== undefined) {
      if (route !== undefined) return { kind: 'invalid', text: `Name one route, not several.\n${USAGE}` }
      /* v8 ignore start -- both named groups are non-optional whenever the pattern matches */
      const provider = matched['provider']
      const model = matched['model']
      if (provider === undefined || model === undefined) {
        return { kind: 'invalid', text: `Unknown argument "${token}".\n${USAGE}` }
      }
      /* v8 ignore stop */
      route = { provider, model }
      continue
    }
    return { kind: 'invalid', text: `Unknown argument "${token}".\n${USAGE}` }
  }

  return {
    kind: 'report',
    ...named === undefined ? {} : { window: named },
    ...route === undefined ? {} : { route },
  }
}

/**
 * Human label for one selection.
 * @param command - the parsed selection.
 * @param now - current epoch milliseconds, used to bound a window.
 * @returns the report heading.
 */
export function windowLabel(command: Extract<EffectivenessCommand, { kind: 'report' }>, now: number): string {
  const scope = command.route === undefined ? '' : ` · ${command.route.provider}/${command.route.model}`
  if (command.window === undefined) return `Effectiveness (all time)${scope}`
  return `Effectiveness (last ${command.window.label}, since ${new Date(now - command.window.ms).toISOString()})${scope}`
}

/**
 * Render the category counts, or `none`.
 * @param byCategory - category counts.
 * @returns the rendered categories.
 */
function categories(byCategory: Readonly<Record<string, number>>): string {
  const entries = Object.entries(byCategory).sort(([left], [right]) => left.localeCompare(right))
  return entries.length === 0 ? 'none' : entries.map(([category, count]) => `${category} ${String(count)}`).join(' · ')
}

/**
 * Render one route's line.
 * @param route - the route row.
 * @returns the rendered line.
 */
function routeLine(route: EffectivenessRouteRow): string {
  return [
    `  ${route.provider}/${route.model}`,
    `sessions ${String(route.sessions)}`,
    `feedback +${String(route.feedback.positive)}/-${String(route.feedback.negative)}`,
    `changes ${String(route.changes.accepted)}/${String(route.changes.reverted)}/${String(route.changes.undecided)}`,
    `verification ${String(route.verification.passed)}/${String(route.verification.failed)}/${String(route.verification.unknown)}`,
    `turns with signal ${String(route.turnsWithSignal)}`,
  ].join(' · ')
}

/**
 * Render one assembled report as command text.
 * @param report - the assembled effectiveness report.
 * @param heading - heading naming the selected window and route.
 * @returns the complete command text.
 */
export function renderEffectivenessReport(report: EffectivenessReport, heading: string): string {
  if (report.totals.sessions === 0) return `${heading}\nNo session signal recorded for this selection.`

  const { totals } = report
  const lines = [
    heading,
    `Sessions ${String(totals.sessions)} · turns with signal ${String(totals.turnsWithSignal)}`,
    `Feedback: positive ${String(totals.feedback.positive)} · negative ${String(totals.feedback.negative)} · categories: ${categories(totals.feedback.byCategory)}`,
    `Changes: accepted ${String(totals.changes.accepted)} · reverted ${String(totals.changes.reverted)} · undecided ${String(totals.changes.undecided)}`,
    `Verification: passed ${String(totals.verification.passed)} · failed ${String(totals.verification.failed)} · unknown ${String(totals.verification.unknown)}`,
  ]
  if (report.routes.length > 0) {
    lines.push('Routes:')
    for (const route of report.routes) lines.push(routeLine(route))
  }
  if (report.truncated) lines.push('(Session rows were truncated; totals cover the whole selection.)')
  return lines.join('\n')
}

/**
 * Execute one `/effectiveness` invocation against the query service.
 * @param ctx - host context carrying `ctx.effectiveness`.
 * @param invocation - the admitted command invocation.
 * @returns the rendered report, or the error text for an unusable argument.
 */
export async function executeEffectivenessCommand(
  ctx: Context,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const command = parseEffectivenessCommand(invocation.rawInput)
  if (command.kind === 'invalid') return { kind: 'error', text: command.text }

  const now = Date.now()
  const filter: EffectivenessFilter = {
    ...command.window === undefined ? {} : { from: now - command.window.ms },
    ...command.route === undefined ? {} : command.route,
  }
  return { kind: 'success', text: renderEffectivenessReport(await ctx.effectiveness.query(filter), windowLabel(command, now)) }
}

/**
 * Register the global `/effectiveness` command.
 * @param ctx - host context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-effectiveness'),
    name: 'effectiveness',
    description: 'Show cross-session outcome signals: feedback, change decisions, and verification',
    input: { hint: INPUT_HINT },
    handler: invocation => executeEffectivenessCommand(ctx, invocation),
  })
}
