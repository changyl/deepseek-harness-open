/**
 * Change-review vocabulary: the decisions a reader records about a change a
 * tool already applied, and the wire shape the Web client sends and receives.
 *
 * The decision is durable session data, not a tool result: a reader decides
 * between turns, so the record must outlive the turn that produced the change
 * and must reconstruct on reload and fork.
 * @module @deepseek-ai/dsh-change-review/types
 */

/** What a reader decided about one applied change. */
export type ChangeReviewDecision = 'accepted' | 'reverted'

/**
 * One applied change as both sides name it: the `tool/result` sequence that
 * recorded it and the path inside that result. Content never crosses this
 * boundary — the host re-reads the recorded hunks from the session log.
 */
export interface ChangeCoordinates {
  /** `tool/result` sequence number of the call that applied the change. */
  readonly seq: number
  /** Path exactly as the tool recorded it in that result. */
  readonly path: string
}

/** One review request: a decision, and the changes it applies to. */
export interface ChangeReviewRequest {
  /** Viewed Session whose log holds the changes. */
  readonly sessionId: string
  /** Decision recorded for every requested change. */
  readonly action: ChangeReviewDecision
  /** Changes to decide, in the order the reader sees them. */
  readonly changes: readonly ChangeCoordinates[]
}

/** What one requested change resolved to. */
export interface ChangeReviewResult {
  /** The requested change's `tool/result` seq. */
  readonly seq: number
  /** The requested change's path. */
  readonly path: string
  /** `accepted` or `reverted` commit the decision; `skipped` reports why nothing was recorded. */
  readonly status: ChangeReviewDecision | 'skipped'
  /** Why a change was skipped; absent for a committed decision. */
  readonly reason?: string
}

/** The route's success body. */
export interface ChangeReviewResponse {
  readonly results: readonly ChangeReviewResult[]
}

/** One recorded hunk of an applied change, as the `tool/result` metadata carries it. */
export interface RecordedHunk {
  /** The changed file's path. */
  readonly path: string
  /** Prior content of the hunk, or null when it added lines to an empty side. */
  readonly oldText: string | null
  /** Content after the change. */
  readonly newText: string
  /** 1-based line of the new text this hunk starts on, when the producer recorded it. */
  readonly newStart?: number | undefined
}

/**
 * Narrow opaque `tool/result` metadata to the recorded hunks.
 *
 * The payload crosses the durable log, so every member is validated and one
 * malformed entry rejects the whole payload: a partially trusted diff would
 * rewrite the wrong lines.
 * @param meta - the result event's metadata.
 * @returns the validated hunks, or null when the payload is absent or unusable.
 */
export function recordedHunks(meta: unknown): RecordedHunk[] | null {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return null
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const hunks: RecordedHunk[] = []
  for (const entry of diffs) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
    const { path, oldText, newText, newStart } = entry as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    if (newStart !== undefined
      && (typeof newStart !== 'number' || !Number.isInteger(newStart) || newStart < 0)) return null
    hunks.push({ path, oldText, newText, ...newStart === undefined ? {} : { newStart } })
  }
  return hunks
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One reader decision about an applied file change — log-only record (like
     * `approval/asked`; NOT a surface event, carries no `surfaceOp`). `seq` and
     * `path` name the change by the `tool/result` that recorded it, `turn` the
     * turn that result belongs to. A `reverted` decision also means the file was
     * restored to its pre-change content.
     */
    'change/review': {
      turn: number
      seq: number
      path: string
      decision: ChangeReviewDecision
    }
  }
}
