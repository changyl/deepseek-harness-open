/**
 * The change index a file preview reads, declared where the read happens.
 *
 * A preview tab is keyed by the file's `dsh-resource://file/…` address, and the
 * Turn rows that derive changes live in another plugin. The contract therefore
 * belongs to the consumer — the same split `chatFileMentions` uses, where the
 * chat view owns the interface and the deliverables plugin implements it — so
 * neither package has to reference the other's project upward.
 */
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangeCoordinates, ChangeReviewDecision } from '@deepseek-ai/dsh-change-review'

/** One file change as the index records it. */
export interface SessionFileChange {
  /** The changed file's `dsh-resource://file/…` address, the preview tab's content identity. */
  readonly address: string
  /** The change's `tool/result` seq. */
  readonly seq: number
  /** The applied hunks the row rendered for this change. */
  readonly diffs: readonly DiffHunk[]
  /** The Turn that applied it; stepping crosses files only inside one Turn. */
  readonly turn: number
}

/**
 * One reader decision as the index records it.
 */
export interface SessionFileReview {
  /** The decided file's `dsh-resource://file/…` address. */
  readonly address: string
  /** The decided change's `tool/result` seq. */
  readonly seq: number
  /** What the reader decided. */
  readonly decision: ChangeReviewDecision
}

/**
 * The review surface for a file's changes: the hunks rendered Turns published,
 * the last change recorded for a file, the decisions a reader recorded, and the
 * call that records one. It belongs to the consumer — the preview reads it —
 * and the deliverables plugin implements it.
 */
export interface SessionFileChanges {
  /**
   * Record the changes one rendered Turn published.
   * @param changes - the Turn's changes, each already carrying its file address.
   * @returns disposer removing exactly the entries this call recorded.
   */
  publish(changes: readonly SessionFileChange[]): () => void
  /**
   * Read the hunks one `tool/result` recorded for a file.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the change's `tool/result` seq.
   * @returns the hunks, or undefined when no rendered Turn recorded this change.
   */
  hunksFor(address: string, seq: number): readonly DiffHunk[] | undefined
  /**
   * Read the last change recorded for a file, whichever rendered Turn recorded
   * it. A file opened from outside its changing Turn — a delivery card in a
   * later Turn — has no turn-local change to name, so its diff is addressed by
   * this reader instead.
   * @param address - the file's `dsh-resource://file/…` address.
   * @returns the recorded change with the highest `tool/result` seq, or undefined when no rendered Turn recorded one.
   */
  latestFor(address: string): SessionFileChange | undefined
  /**
   * Read the change next to one inside the same Turn.
   *
   * The order is the Turn's own produced order, so stepping follows the row
   * the reader sees rather than the session log's shape.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the current change's `tool/result` seq.
   * @param direction - the neighbour to read.
   * @returns the neighbouring change, or undefined at the end of the Turn.
   */
  neighbourChange(
    address: string,
    seq: number,
    direction: 'previous' | 'next',
  ): SessionFileChange | undefined
  /**
   * Read where one change sits among its Turn's changes, counted in regions.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the current change's `tool/result` seq.
   * @returns the regions before it and the Turn's total, or undefined when no rendered Turn published it.
   */
  hunkRange(address: string, seq: number): { readonly before: number; readonly total: number } | undefined
  /**
   * Record the decisions one rendered Turn published.
   * @param reviews - the Turn's decisions, each already carrying its file address.
   * @returns disposer removing exactly the entries this call recorded.
   */
  publishReviews(reviews: readonly SessionFileReview[]): () => void
  /**
   * Read the decision recorded for one change.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the change's `tool/result` seq.
   * @returns the decision, or undefined when the change was never decided.
   */
  reviewOf(address: string, seq: number): ChangeReviewDecision | undefined
  /**
   * Post one reader decision for the named changes.
   *
   * The host re-derives every byte it writes from the session log, so this
   * sends identities only and reports the host's refusal verbatim.
   * @param sessionId - the viewed Session whose log holds the changes.
   * @param action - keep the changes, or restore each file to its pre-change content.
   * @param changes - the changes to decide.
   * @returns the host's refusal reason, or undefined when every decision was recorded.
   */
  review(
    sessionId: string,
    action: ChangeReviewDecision,
    changes: readonly ChangeCoordinates[],
  ): Promise<string | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional index of the changes rendered Turns published; a composition without it shows files. */
    sessionFileChanges: SessionFileChanges
  }
}
