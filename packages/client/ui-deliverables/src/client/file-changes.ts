/**
 * In-memory change index over the preview's `sessionFileChanges` contract, and
 * the one client that posts a reader's decision to the host.
 *
 * The entries live exactly as long as the turn-tail rows that published them:
 * one Turn may change several files, and two Turns may change the same file, so
 * neither the address nor the seq keys this alone. Addresses arrive already
 * composed by the publisher, so this package never re-derives a path spelling.
 */
import type { DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangeCoordinates, ChangeReviewDecision } from '@deepseek-ai/dsh-change-review'
import type {
  SessionFileChange, SessionFileChanges, SessionFileReview,
} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'

/** The key one change is stored under: its address and its `tool/result` seq. */
function changeKey(address: string, seq: number): string {
  return `${address}#${String(seq)}`
}

/** Route the host registers for change review. */
export const CHANGE_REVIEW_PATH = '/api/change.review'

/** File address -> `tool/result` seq -> hunks. */
export class SessionFileChangeIndex implements SessionFileChanges {
  private readonly byAddress = new Map<string, Map<number, readonly DiffHunk[]>>()
  private readonly reviews = new Map<string, Map<number, ChangeReviewDecision>>()
  /** Every published change by `${address}#${seq}`, which also names its Turn. */
  private readonly changes = new Map<string, SessionFileChange>()
  /** One Turn's changes in the order its row published them. */
  private readonly byTurn = new Map<number, SessionFileChange[]>()

  publish(changes: readonly SessionFileChange[]): () => void {
    for (const change of changes) {
      let bySeq = this.byAddress.get(change.address)
      if (bySeq === undefined) {
        bySeq = new Map()
        this.byAddress.set(change.address, bySeq)
      }
      bySeq.set(change.seq, change.diffs)
      this.changes.set(changeKey(change.address, change.seq), change)
      const turn = this.byTurn.get(change.turn) ?? []
      const existing = turn.findIndex(entry => changeKey(entry.address, entry.seq) === changeKey(change.address, change.seq))
      if (existing === -1) turn.push(change)
      else turn[existing] = change
      this.byTurn.set(change.turn, turn)
    }
    return () => {
      for (const change of changes) {
        const bySeq = this.byAddress.get(change.address)
        bySeq?.delete(change.seq)
        if (bySeq?.size === 0) this.byAddress.delete(change.address)
        this.changes.delete(changeKey(change.address, change.seq))
        const turn = this.byTurn.get(change.turn)
        if (turn === undefined) continue
        const remaining = turn.filter(entry => changeKey(entry.address, entry.seq) !== changeKey(change.address, change.seq))
        if (remaining.length === 0) this.byTurn.delete(change.turn)
        else this.byTurn.set(change.turn, remaining)
      }
    }
  }

  neighbourChange(
    address: string,
    seq: number,
    direction: 'previous' | 'next',
  ): SessionFileChange | undefined {
    const change = this.changes.get(changeKey(address, seq))
    if (change === undefined) return undefined
    /* v8 ignore start -- a change and its Turn entry are published and withdrawn together */
    const turn = this.byTurn.get(change.turn) ?? []
    const index = turn.findIndex(entry => changeKey(entry.address, entry.seq) === changeKey(address, seq))
    if (index === -1) return undefined
    /* v8 ignore stop */
    return direction === 'previous' ? turn[index - 1] : turn[index + 1]
  }

  hunkRange(address: string, seq: number): { before: number; total: number } | undefined {
    const change = this.changes.get(changeKey(address, seq))
    if (change === undefined) return undefined
    /* v8 ignore start -- a change and its Turn entry are published and withdrawn together */
    const turn = this.byTurn.get(change.turn) ?? []
    const index = turn.findIndex(entry => changeKey(entry.address, entry.seq) === changeKey(address, seq))
    if (index === -1) return undefined
    /* v8 ignore stop */
    let before = 0
    for (const entry of turn.slice(0, index)) before += entry.diffs.length
    let total = 0
    for (const entry of turn) total += entry.diffs.length
    return { before, total }
  }

  hunksFor(address: string, seq: number): readonly DiffHunk[] | undefined {
    return this.byAddress.get(address)?.get(seq)
  }

  latestFor(address: string): SessionFileChange | undefined {
    const bySeq = this.byAddress.get(address)
    if (bySeq === undefined) return undefined
    // Entries are inserted in publication order, not seq order: a Turn row that
    // mounts later may have recorded an earlier change, so the last change is
    // found by comparison rather than by taking the final entry.
    let latest: SessionFileChange | undefined
    for (const seq of bySeq.keys()) {
      /* v8 ignore start -- every published hunk map has a record in the same call */
      const change = this.changes.get(changeKey(address, seq))
      if (change === undefined) continue
      /* v8 ignore stop */
      if (latest === undefined || change.seq > latest.seq) latest = change
    }
    return latest
  }

  publishReviews(reviews: readonly SessionFileReview[]): () => void {
    for (const review of reviews) {
      let bySeq = this.reviews.get(review.address)
      if (bySeq === undefined) {
        bySeq = new Map()
        this.reviews.set(review.address, bySeq)
      }
      bySeq.set(review.seq, review.decision)
    }
    return () => {
      for (const review of reviews) {
        const bySeq = this.reviews.get(review.address)
        bySeq?.delete(review.seq)
        if (bySeq?.size === 0) this.reviews.delete(review.address)
      }
    }
  }

  reviewOf(address: string, seq: number): ChangeReviewDecision | undefined {
    return this.reviews.get(address)?.get(seq)
  }

  async review(
    sessionId: string,
    action: ChangeReviewDecision,
    changes: readonly ChangeCoordinates[],
  ): Promise<string | undefined> {
    try {
      const response = await fetch(CHANGE_REVIEW_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, action, changes }),
      })
      if (response.ok) return undefined
      const body: unknown = await response.json().catch(() => undefined)
      const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
      return typeof error === 'string' && error !== ''
        ? error
        : `Change review failed with status ${String(response.status)}.`
    } catch {
      return 'Change review could not reach the host.'
    }
  }
}
