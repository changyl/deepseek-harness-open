/**
 * Pure fold over one session's canonical event log into the usage facts the
 * ledger stores. Route attribution follows `request/context`, the only
 * durable record of which provider and model served a request, and token
 * buckets follow the same replacement rule the `tokenUsage` projection uses,
 * so a retried attempt replaces its own step's sample instead of adding to it.
 *
 * @module @deepseek-ai/dsh-usage-ledger/fold
 */

import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UsageRouteRecord, UsageSessionRecord } from './spec.ts'

/** Route used before the log records any `request/context`. */
const UNKNOWN_ROUTE = { provider: 'unknown', model: 'unknown' } as const

/** One route's running totals inside the fold. */
interface RouteState extends UsageRouteRecord {}

/** The four disjoint buckets of one usage sample. */
interface Buckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** The two settlement events that can report usage for one step. */
type AssistantSettlement = Extract<
  SessionEvent,
  { type: 'assistant/message' } | { type: 'assistant/attempt' }
>

/** Fold state carried across one session's events. */
interface FoldState {
  turns: number
  lastTurn: number | null
  steps: number
  unknownUsageSteps: number
  firstTime: number | null
  lastTime: number | null
  throughSeq: number
  route: { provider: string; model: string }
  routes: Map<string, RouteState>
  last: {
    turn: number
    step: number
    key: string
    route: { provider: string; model: string }
    buckets: Buckets
  } | null
}

/**
 * Route key shared by the fold and the aggregate. The separator cannot appear
 * in a provider or model id, so two distinct routes never collide.
 * @param provider - registered provider name.
 * @param model - provider-owned model id.
 * @returns the key both the fold and the aggregate group a route by.
 */
export const routeKey = (provider: string, model: string): string => `${provider}\u0000${model}`

/**
 * Map one provider usage record onto the four disjoint buckets.
 * @param usage - provider-reported usage for one attempt.
 * @returns the four buckets.
 */
function bucketsFrom(usage: TokenUsage): Buckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/**
 * The usage one settled Assistant event reports, if any.
 * @param event - the event to read.
 * @returns the embedded or in-stream usage sample, or undefined when none exists.
 */
function usageOf(event: AssistantSettlement): TokenUsage | undefined {
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  return lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
}

/**
 * Whether two samples carry the same buckets.
 * @param left - left buckets.
 * @param right - right buckets.
 * @returns whether every bucket matches.
 */
function bucketsEqual(left: Buckets, right: Buckets): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens
}

/**
 * The mutable route row for one key, created on first use.
 * @param state - fold state owning the table.
 * @param key - route key.
 * @param route - provider and model for a newly created row.
 * @returns the existing or newly created row.
 */
function routeRow(state: FoldState, key: string, route: { provider: string; model: string }): RouteState {
  const existing = state.routes.get(key)
  if (existing !== undefined) return existing
  const created: RouteState = {
    provider: route.provider,
    model: route.model,
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    steps: 0,
    unknownUsageSteps: 0,
  }
  state.routes.set(key, created)
  return created
}

/**
 * Apply one bucket delta to a route row. `sign` is 1 for an addition and -1
 * for removing a superseded sample.
 * @param row - the route row to mutate.
 * @param buckets - the buckets to apply.
 * @param sign - 1 to add, -1 to subtract.
 */
function applyBuckets(row: RouteState, buckets: Buckets, sign: 1 | -1): void {
  row.uncachedInputTokens += sign * buckets.uncachedInputTokens
  row.outputTokens += sign * buckets.outputTokens
  row.cacheReadTokens += sign * buckets.cacheReadTokens
  row.cacheWriteTokens += sign * buckets.cacheWriteTokens
}

/**
 * Fold one session's canonical events into a usage record.
 * @param session - the session header facts the record carries.
 * @param events - the session's events in durable order.
 * @returns the derived record; deleting it is always safe because this fold is total.
 */
export function foldUsageEvents(
  session: { readonly id: string; readonly createdAt: number },
  events: readonly SessionEvent[],
): UsageSessionRecord {
  const state: FoldState = {
    turns: 0,
    lastTurn: null,
    steps: 0,
    unknownUsageSteps: 0,
    firstTime: null,
    lastTime: null,
    throughSeq: -1,
    route: { ...UNKNOWN_ROUTE },
    routes: new Map(),
    last: null,
  }

  for (const event of events) {
    state.firstTime ??= event.time
    state.lastTime = event.time
    state.throughSeq = event.seq

    switch (event.type) {
      case 'request/context':
        state.route = { provider: event.data.provider, model: event.data.model }
        continue
      case 'llm/retry-started':
        if (state.last !== null && state.last.turn === event.data.turn && state.last.step === event.data.step) {
          state.last = null
        }
        continue
      case 'step/end': {
        const key = routeKey(state.route.provider, state.route.model)
        state.steps += 1
        if (state.lastTurn !== event.data.turn) {
          state.turns += 1
          state.lastTurn = event.data.turn
        }
        routeRow(state, key, state.route).steps += 1
        continue
      }
      case 'assistant/message':
      case 'assistant/attempt': {
        const key = routeKey(state.route.provider, state.route.model)
        const sample = usageOf(event)
        if (sample === undefined) {
          if (event.type === 'assistant/message') {
            state.unknownUsageSteps += 1
            routeRow(state, key, state.route).unknownUsageSteps += 1
          }
          continue
        }
        const buckets = bucketsFrom(sample)
        const { turn, step } = event.data
        const previous = state.last !== null && state.last.turn === turn && state.last.step === step
          ? state.last
          : undefined
        if (previous !== undefined && bucketsEqual(previous.buckets, buckets) && previous.key === key) continue
        if (previous !== undefined) {
          // The superseded sample was billed by the route that produced it, and
          // that row exists because adding the sample created it.
          applyBuckets(routeRow(state, previous.key, previous.route), previous.buckets, -1)
        }
        applyBuckets(routeRow(state, key, state.route), buckets, 1)
        state.last = { turn, step, key, route: { ...state.route }, buckets }
        continue
      }
      default:
        continue
    }
  }

  return {
    sessionId: session.id,
    createdAt: session.createdAt,
    revision: '',
    throughSeq: state.throughSeq,
    turns: state.turns,
    steps: state.steps,
    unknownUsageSteps: state.unknownUsageSteps,
    firstTime: state.firstTime,
    lastTime: state.lastTime,
    routes: [...state.routes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, row]) => ({ ...row })),
  }
}
