/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: the vocabulary comes from successful first-party mutation
 * calls, never presentation data or the closing prose.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationMatch, ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { narrowDiffHunks, type DiffHunk, type MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'
import type { ChangeReviewDecision } from '@deepseek-ai/dsh-change-review'
import { basename, isPresentedData, isPresentedFile } from '../presented.ts'

/** A declared file with its authorized open coordinates. */
export interface PresentedPath extends PresentedFile {
  readonly seq: number
  readonly index: number
}

/** One file this Turn mutated, with the change its call declared or its result applied. */
interface ProducedPath {
  /** `tool/result` seq of the successful mutation. */
  readonly seq: number
  readonly path: string
  /** Applied hunks from the result's durable metadata, or the call's declared change. */
  readonly diffs: readonly DiffHunk[]
}

/** One path this Turn changed, for a surface that renders a single file's diff. */
export interface ProducedChange {
  readonly path: string
  /** `tool/result` seq of the last successful change to this path in the Turn. */
  readonly seq: number
  readonly diffs: readonly DiffHunk[]
}

/** One reader decision a rendered Turn recorded. */
export interface ProducedReview {
  readonly path: string
  /** `tool/result` seq of the decided change. */
  readonly seq: number
  readonly decision: ChangeReviewDecision
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
  readonly presented?: readonly PresentedPath[]
  readonly reviews?: readonly ProducedReview[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, MutationChange | null>
}

/** The change a mutation call declares before its result is known. */
interface MutationChange {
  readonly path: string
  readonly diffs: readonly DiffHunk[]
}

/**
 * Extract the declared change from a supported first-party mutation call.
 * Session `tool/call` events are root calls; Code Dispatch children do not
 * enter this Definition independently. These hunks are the call's own literal
 * change; a result that reports applied hunks replaces them.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns the declared change, or null when the call is not a supported mutation.
 */
function mutationChange(name: string, argsRaw: string): MutationChange | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (!isRecord(args)) return null
  switch (name) {
    case 'write':
      return typeof args.content === 'string' ? declaredChange(args.file_path, args.content) : null
    case 'edit':
      return validEditArgs(args) ? declaredChange(args.file_path, args.new_string, args.old_string) : null
    case 'str_replace_editor':
      return editorMutationChange(args)
    default:
      return null
  }
}

/** The declared change for a path, or null when the path is unusable. */
function declaredChange(filePath: unknown, newText: string, oldText: string | null = null): MutationChange | null {
  const path = pathValue(filePath)
  return path === null ? null : { path, diffs: [{ path, oldText, newText }] }
}

/** Validate the fields that an `edit` execution requires. */
function validEditArgs(
  args: Readonly<Record<string, unknown>>,
): args is Readonly<Record<string, unknown>> & { old_string: string; new_string: string } {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract the declared change only from a complete mutating editor command. */
function editorMutationChange(args: Readonly<Record<string, unknown>>): MutationChange | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string'
        ? { path, diffs: [{ path, oldText: null, newText: args.file_text }] }
        : null
    case 'str_replace': {
      const { old_str: oldText, new_str: newText } = args
      if (typeof oldText !== 'string' || oldText.length === 0) return null
      if (newText !== undefined && typeof newText !== 'string') return null
      return { path, diffs: [{ path, oldText, newText: newText ?? '' }] }
    }
    case 'insert': {
      const { insert_line: insertLine, new_str: newText } = args
      // `insert` has no diff card: the path is produced, the change has no hunks.
      return typeof insertLine === 'number'
        && Number.isInteger(insertLine)
        && insertLine >= 0
        && typeof newText === 'string'
        ? { path, diffs: [] }
        : null
    }
    default:
      return null
  }
}

/**
 * Applied hunks from a successful result's durable metadata.
 * @param meta - the `tool/result` event's metadata.
 * @returns the validated hunks, or null when the result reported none.
 */
function appliedDiffs(meta: unknown): readonly DiffHunk[] | null {
  return isRecord(meta) ? narrowDiffHunks(meta.diffs) : null
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/** Narrow parsed JSON to an argument object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `write`, `edit`, and mutating
 * `str_replace_editor` calls, not the closing prose: a produced file must be
 * listed whether or not the model remembered to name it. Reads, unsupported
 * tools, malformed calls, and failed results contribute nothing. Paths keep
 * first-seen order and appear once, so a file written and then edited in the
 * same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Claim the turn-tail chain only when its closing turn produced files.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns Produced paths as the component's match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/** Memo for {@link changesForClosing}, per Turn `produced` array and closing seq. */
const changesByProduced = new WeakMap<readonly ProducedPath[], Map<number, readonly ProducedChange[]>>()

/**
 * The changes one Turn applied, one entry per path.
 *
 * Same source and Turn membership as {@link producedForClosing}, answering the
 * different question a diff surface asks: a produced file whose change reports
 * no hunks (a create the tool recorded as an empty diff, or a command with no
 * diff card) is listed there and absent here, so the change view falls back to
 * the file itself. A path changed more than once keeps its first-seen position
 * and its last change.
 *
 * The result is memoized on the Turn's `produced` array, which the engine keeps
 * identical while the Turn does not change: a reader publishes this list from
 * an effect, and a fresh array per call would republish an unchanged change.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns one change per path in first-seen order; empty when the turn applied none.
 */
export function changesForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly ProducedChange[] {
  if (data === undefined) return []
  let bySeq = changesByProduced.get(data.produced)
  if (bySeq === undefined) {
    bySeq = new Map()
    changesByProduced.set(data.produced, bySeq)
  }
  const cached = bySeq.get(seq)
  if (cached !== undefined) return cached
  const byPath = new Map<string, ProducedChange>()
  for (const produced of data.produced) {
    if (produced.seq > seq || produced.diffs.length === 0) continue
    byPath.set(produced.path, { path: produced.path, seq: produced.seq, diffs: produced.diffs })
  }
  const value = [...byPath.values()]
  bySeq.set(seq, value)
  return value
}

/**
 * The decisions one Turn recorded, for the surfaces that show them.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns the decisions in record order; empty when the Turn recorded none.
 */
export function selectProducedReviews(owner: TurnTailOwnerProps): readonly ProducedReview[] {
  return owner.turn.data.get('deliverables')?.reviews ?? []
}

/**
 * The closing Turn's changes, for a surface that opens one file's diff.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns the changes, or null when the Turn applied none.
 */
export function selectProducedChanges(owner: TurnTailOwnerProps): readonly ProducedChange[] | null {
  const changes = changesForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return changes.length === 0 ? null : changes
}

/** Fold one accepted Match into the Turn's accumulator. */
function applyUpdate(state: DeliverablesState, match: ConversationMatch): DeliverablesState {
  if (match.event.type === 'deliverables/presented') {
    const { files } = match.event.data
    const seq = match.event.seq
    const presented: PresentedPath[] = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      if (isPresentedFile(file)) presented.push({ ...file, seq, index })
    }
    if (presented.length === 0) return state
    return { ...state, presented: [...state.presented ?? [], ...presented] }
  }
  if (match.event.type === 'tool/call') {
    const calls = new Map(state.calls)
    calls.set(
      String(match.event.data.callId),
      mutationChange(match.event.data.name, match.event.data.arguments),
    )
    return { ...state, calls }
  }
  if (match.event.type === 'change/review') {
    const { path, seq, decision } = match.event.data
    const reviews = (state.reviews ?? []).filter(review => review.path !== path || review.seq !== seq)
    return { ...state, reviews: [...reviews, { path, seq, decision }] }
  }
  if (match.event.type !== 'tool/result') return state
  const result = match.event.data.message.content[0]
  if (result.isError === true) return state
  const callId = String(match.event.data.message.source.callId)
  const change = state.calls.get(callId)
  if (change === null || change === undefined) return state
  return {
    ...state,
    produced: [...state.produced, {
      seq: match.event.seq,
      path: change.path,
      diffs: appliedDiffs(match.event.data.meta) ?? change.diffs,
    }],
  }
}

/**
 * Rebuild the accumulator from the Matches a window cut left behind.
 *
 * The history window is bounded by surface messages, so a long Turn's
 * `turn/start` can fall outside it while the Turn's own calls and results are
 * still loaded. The Turn number rides every accepted event, so the accumulator
 * is replayable without its start — the same recovery the Tool call Definition
 * makes for the same cut.
 * @param context - the state-less Context holding the accepted Matches.
 * @returns the rebuilt accumulator, or undefined when no Match named a Turn.
 */
function fallbackState(context: ConversationNodeContext<DeliverablesState>): DeliverablesState | undefined {
  let state: DeliverablesState | undefined
  for (const match of context.matches) {
    if (state === undefined) {
      /* v8 ignore next 4 -- the engine runs `start` for a turn/start it accepts, so a recovery never begins on one */
      if (match.event.type === 'turn/start') {
        state = { turn: match.event.data.turn, calls: new Map(), produced: [] }
        continue
      }
      /* v8 ignore next -- every event this Definition accepts carries `turn` */
      if (!('turn' in match.event.data)) continue
      state = { turn: match.event.data.turn, calls: new Map(), produced: [] }
    }
    state = applyUpdate(state, match)
  }
  return state
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'deliverables/presented') return isPresentedData(event.data) ? { id: String(event.data.turn), role: 'update' } : null
    if (event.type === 'change/review') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => applyUpdate(context.state, match),
  buildLocationData: (context, scope, previous) => {
    const state = context.state ?? fallbackState(context)
    if (scope !== 'turn' || state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === state.turn
      && previous.key === 'deliverables'
      && previous.value.produced === state.produced
      && previous.value.presented === state.presented
      && previous.value.reviews === state.reviews) return previous
    return {
      kind: 'turn',
      turn: state.turn,
      key: 'deliverables',
      value: {
        produced: state.produced,
        ...state.presented === undefined ? {} : { presented: state.presented },
        ...state.reviews === undefined ? {} : { reviews: state.reviews },
      },
    }
  },
}

/**
 * Select the latest declaration of each path before the closing reply.
 * @param owner - closing turn and sequence.
 * @returns replayable deliveries in first-seen path order.
 */
export function presentedForClosing(owner: TurnTailOwnerProps): PresentedPath[] {
  const files = new Map<string, PresentedPath>()
  for (const file of owner.turn.data.get('deliverables')?.presented ?? []) {
    if (file.seq < owner.seq) files.set(file.path, file)
  }
  return [...files.values()]
}

export { basename } from '../presented.ts'

/**
 * Resolves inline-code references against one turn's produced or delivered
 * paths. Exact paths resolve directly; a basename resolves only when exactly
 * one supplied path has that basename. Ambiguous and unknown tokens stay inert.
 * @param paths - The turn's produced or delivered paths, already deduplicated.
 * @param openFile - The chat view's file opener.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** The single supplied path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
