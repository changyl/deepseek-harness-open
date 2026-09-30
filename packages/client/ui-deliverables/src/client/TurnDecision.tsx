/**
 * The finished turn's decision row: the two controls that accept or revert the
 * changes the turn's file tools applied. The changed-files card owns the turn's
 * file list; this row names no file and appears only where a recorded change
 * carries the hunks a revert needs.
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './TurnDecision.module.css'

/** The row's own progress and the decision it posts. */
export interface TurnDecisionControls {
  /** This row's own progress; `idle` before the reader acts. */
  readonly phase: 'idle' | 'pending' | 'done' | 'failed'
  /** The host's refusal reason when the decision failed. */
  readonly reason?: string
  /** Decide every change the turn applied. */
  readonly decide: (action: 'accepted' | 'reverted') => void
}

/** The decision state, its controls, and the locale seat. */
export type TurnDecisionProps = TurnDecisionControls & PropsLocale<typeof NS>

/**
 * Render the turn-level accept-or-revert decision controls. The row states the
 * scope it decides — the changes file tools applied — because the turn's
 * changed-files card lists every file the turn changed, including files a revert
 * cannot restore.
 * @param props - decision phase, the host's refusal reason, the post, and the locale seat.
 * @returns The decision row.
 */
export function TurnDecision({ phase, reason, decide, t }: TurnDecisionProps) {
  return (
    <div className={css.root} data-turn-decision={phase}>
      <span className={css.scope}>{t('review.scope')}</span>
      <button
        type="button"
        className={css.action}
        disabled={phase === 'pending'}
        aria-label={t('review.acceptTurn')}
        data-turn-decision-action="accepted"
        onClick={() => { decide('accepted') }}
      >
        {t('review.acceptTurn')}
      </button>
      <button
        type="button"
        className={css.action}
        disabled={phase === 'pending'}
        aria-label={t('review.revertTurn')}
        data-turn-decision-action="reverted"
        onClick={() => { decide('reverted') }}
      >
        {phase === 'pending' ? t('review.pending') : t('review.revertTurn')}
      </button>
      {/* A failed phase always carries the host's reason; the label covers a host that sent none. */}
      {phase === 'done' && <span className={css.status}>{t('review.done')}</span>}
      {phase === 'failed' && <span className={css.status}>{reason ?? t('review.failed')}</span>}
    </div>
  )
}
