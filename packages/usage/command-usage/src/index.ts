/**
 * Human `/usage` command over the usage seam. It renders the same report a
 * client would read — totals, per-route rows, and cost when a deployment
 * mounted a rate card — without spending a model turn. The command owns only
 * its argument grammar and its text; every figure comes from `ctx.usage`.
 *
 * @module @deepseek-ai/dsh-command-usage
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { UsageUnavailableError } from '@deepseek-ai/dsh-usage'
import type { UsageFilter, UsageReport, UsageRouteRef } from '@deepseek-ai/dsh-usage'

/** Cordis plugin name. */
export const name = 'command-usage'

/** The command needs the registry to register into and the service that owns the figures. */
export const inject = ['commands', 'usage']

/** Input hint shown by discovery surfaces. */
const INPUT_HINT = '[<window>] [<provider>/<model>]'

const USAGE = `Usage: /usage ${INPUT_HINT}
Windows: 24h, 7d, 30d, or all (default). Routes: <provider>/<model>.`

/** One named time window: its duration and how the invocation spelled it. */
interface UsageWindow {
  /** Window length in milliseconds. */
  readonly ms: number
  /** Exactly how the invocation spelled the window, echoed in the heading. */
  readonly label: string
}

/** One parsed invocation. */
type UsageCommand =
  | { readonly kind: 'report'; readonly window?: UsageWindow; readonly route?: UsageRouteRef }
  | { readonly kind: 'invalid'; readonly text: string }

/** Milliseconds one hour and one day stand for when a window is parsed. */
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** A window token: `<n>h` or `<n>d`, or `all`. */
const WINDOW = /^(\d+)([hd])$/

/** A route token: two non-empty, slash-separated names. */
const ROUTE = /^(?<provider>[^/\s]+)\/(?<model>[^/\s]+)$/

/**
 * Parse one `/usage` invocation.
 * @param rawInput - text following the command name, including separator whitespace.
 * @returns the report selection, or the error text naming the offending token.
 */
export function parseUsageCommand(rawInput: string): UsageCommand {
  let named: UsageWindow | undefined
  let route: UsageRouteRef | undefined

  for (const token of rawInput.trim().split(/\s+/).filter(part => part.length > 0)) {
    if (token === 'all') {
      if (named !== undefined) {
        return { kind: 'invalid', text: `Name one window, not several.\n${USAGE}` }
      }
      continue
    }
    const window = WINDOW.exec(token)
    if (window !== null) {
      if (named !== undefined) {
        return { kind: 'invalid', text: `Name one window, not several.\n${USAGE}` }
      }
      const amount = Number(window[1])
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        return { kind: 'invalid', text: `Window "${token}" must be a positive count of hours or days.\n${USAGE}` }
      }
      named = { ms: amount * (window[2] === 'h' ? HOUR_MS : DAY_MS), label: token }
      continue
    }
    const matched = ROUTE.exec(token)?.groups
    if (matched !== undefined) {
      if (route !== undefined) {
        return { kind: 'invalid', text: `Name one route, not several.\n${USAGE}` }
      }
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
export function windowLabel(command: Extract<UsageCommand, { kind: 'report' }>, now: number): string {
  const scope = command.route === undefined ? '' : ` · ${command.route.provider}/${command.route.model}`
  if (command.window === undefined) return `Usage (all time)${scope}`
  return `Usage (last ${command.window.label}, since ${new Date(now - command.window.ms).toISOString()})${scope}`
}

/**
 * Group digits for readability.
 * @param value - non-negative integer to render.
 * @returns the value with thousands separators.
 */
function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * Render integer micro-units as currency units, trimming trailing zeros. Six
 * decimals is the full micro-unit precision, so no recorded amount is rounded
 * away in the text.
 * @param micros - amount in micro-units.
 * @returns the amount with at most six decimals and no trailing zeros.
 */
export function formatAmount(micros: number): string {
  const fixed = (micros / 1_000_000).toFixed(6)
  return fixed.replace(/0+$/u, '').replace(/\.$/u, '')
}

/**
 * One route's line in the report.
 * @param route - the route totals row.
 * @param report - the assembled report carrying cost.
 * @returns the rendered line, unpriced routes included with the reason.
 */
function routeLine(route: UsageReport['routes'][number], report: UsageReport): string {
  const parts = [
    `${route.provider}/${route.model}`,
    `sessions ${formatCount(route.sessions)}`,
    `steps ${formatCount(route.steps)}`,
    `input ${formatCount(route.uncachedInputTokens)}`,
    `output ${formatCount(route.outputTokens)}`,
    `cache read ${formatCount(route.cacheReadTokens)}`,
    `cache write ${formatCount(route.cacheWriteTokens)}`,
  ]
  if (route.unknownUsageSteps > 0) parts.push(`steps without usage ${formatCount(route.unknownUsageSteps)}`)
  const table = report.cost
  const cost = table?.routes.find(entry => entry.provider === route.provider && entry.model === route.model)
  if (table === undefined || cost === undefined) return `  ${parts.join(' · ')}`
  parts.push(cost.priced ? `${table.currency} ${formatAmount(cost.micros)}` : 'unpriced')
  return `  ${parts.join(' · ')}`
}

/**
 * Render one assembled report as command text.
 * @param report - the assembled usage report.
 * @param heading - heading naming the selected window and route.
 * @returns the complete command text.
 */
export function renderUsageReport(report: UsageReport, heading: string): string {
  if (report.totals.sessions === 0) return `${heading}\nNo usage recorded for this selection.`

  const { totals } = report
  const lines = [
    heading,
    `Sessions ${formatCount(totals.sessions)} · turns ${formatCount(totals.turns)} · steps ${formatCount(totals.steps)}`
      + (totals.unknownUsageSteps === 0 ? '' : ` · steps without usage ${formatCount(totals.unknownUsageSteps)}`),
    `Tokens: input ${formatCount(totals.uncachedInputTokens)} · output ${formatCount(totals.outputTokens)}`
      + ` · cache read ${formatCount(totals.cacheReadTokens)} · cache write ${formatCount(totals.cacheWriteTokens)}`,
  ]

  if (report.cost === undefined) {
    lines.push('Cost: unavailable — no route in this selection is priced.')
  } else {
    const incomplete = report.cost.complete
      ? ''
      : ` (incomplete — unpriced routes: ${report.unpriced.map(route => `${route.provider}/${route.model}`).join(', ')})`
    lines.push(`Cost: ${report.cost.currency} ${formatAmount(report.cost.totalMicros)} (pricing ${report.cost.pricingVersion})${incomplete}`)
  }

  if (report.routes.length > 0) {
    lines.push('Routes:')
    for (const route of report.routes) lines.push(routeLine(route, report))
  }

  return lines.join('\n')
}

/**
 * Execute one `/usage` invocation against the usage service.
 * @param ctx - host context carrying `ctx.usage`.
 * @param invocation - the admitted command invocation.
 * @returns the rendered report, or the error text for an unusable composition.
 */
export async function executeUsageCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const command = parseUsageCommand(invocation.rawInput)
  if (command.kind === 'invalid') return { kind: 'error', text: command.text }

  const now = Date.now()
  const filter: UsageFilter = {
    ...command.window === undefined ? {} : { from: now - command.window.ms },
    ...command.route === undefined ? {} : command.route,
  }

  try {
    const report = await ctx.usage.query(filter)
    return { kind: 'success', text: renderUsageReport(report, windowLabel(command, now)) }
  } catch (error: unknown) {
    if (error instanceof UsageUnavailableError) {
      return {
        kind: 'error',
        text: 'Usage statistics are unavailable in this composition: no usage provider is registered.',
      }
    }
    throw error
  }
}

/**
 * Register the global `/usage` command.
 * @param ctx - host context carrying the command registry.
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-usage'),
    name: 'usage',
    description: 'Show token usage and cost across sessions',
    input: { hint: INPUT_HINT },
    handler: invocation => executeUsageCommand(ctx, invocation),
  })
}
