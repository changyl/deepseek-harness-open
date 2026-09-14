import { useMemo } from 'react'
import { LinkIcon, classifyLinkPath } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { basename, type ProducedChange } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

/** Maximum number of file chips rendered before the remainder counter. */
const SHOWN_LIMIT = 6

/** The row's turn-level decision controls, or absent where the row offers none. */
export interface ProducedReviewControls {
  /** This row's own progress; `idle` before the reader acts. */
  readonly phase: 'idle' | 'pending' | 'done' | 'failed'
  /** The host's refusal reason when the decision failed. */
  readonly reason?: string
  /** Decide every change the row lists. */
  readonly decide: (action: 'accepted' | 'reverted') => void
}

/** Matched paths, their changes, the opener, the decision controls, and the locale seat. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
  /** The Turn's changes by path; a path without one opens as the file itself. */
  changes: readonly ProducedChange[]
  /** Turn-level accept/revert controls; absent = this row is read-only. */
  review?: ProducedReviewControls | undefined
} & PropsLocale<typeof NS>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Render one turn's produced files as openable chips. A changed file opens on
 * the change this Turn applied; a file the Turn only created, or changed
 * through a command with no diff card, opens as the file. The Turn's own
 * accept/revert controls sit under the chips, so the chip row keeps the width
 * its container bands measure.
 * @param props - selector-matched paths and changes, the chat view's file opener, the decision controls, and the locale seat.
 * @returns The produced-files row.
 */
export function ProducedFiles({ matched: paths, changes, openFile, review, t }: ProducedFilesProps) {
  const shown = paths.slice(0, SHOWN_LIMIT)
  const changeByPath = useMemo(
    () => new Map(changes.map(change => [change.path, change])),
    [changes],
  )
  return (
    <div className={css.root}>
      <span className={css.label}>{t('produced.label')}</span>
      <div className={css.lane}>
        <div className={css.row} data-produced-files-row>
          {shown.map(path => (
            <button
              key={path}
              type="button"
              className={css.file}
              // The full path is the disambiguator when two turns produce files
              // that share a basename; the chip itself stays short.
              title={path}
              aria-label={t('produced.open', { name: path })}
              onClick={() => {
                const change = changeByPath.get(path)
                if (change === undefined) openFile(path)
                else openFile(path, { changeSeq: change.seq })
              }}
            >
              <LinkIcon kind={classifyLinkPath(path)} className={css.fileIcon} />
              <span className={css.fileName}>{basename(path)}</span>
            </button>
          ))}
          {shown.map((_, index) => {
            const shownCount = index + 1
            const remainder = paths.length - shownCount
            if (remainder <= 0) return null
            return (
              <span key={shownCount} className={css.more} data-shown={shownCount}>
                {moreLabel(t, remainder)}
              </span>
            )
          })}
        </div>
        {review !== undefined && (
          <span className={css.review} data-produced-review={review.phase}>
            <button
              type="button"
              className={css.reviewAction}
              disabled={review.phase === 'pending'}
              aria-label={t('review.acceptTurn')}
              data-produced-review-action="accepted"
              onClick={() => { review.decide('accepted') }}
            >
              {t('review.acceptTurn')}
            </button>
            <button
              type="button"
              className={css.reviewAction}
              disabled={review.phase === 'pending'}
              aria-label={t('review.revertTurn')}
              data-produced-review-action="reverted"
              onClick={() => { review.decide('reverted') }}
            >
              {review.phase === 'pending' ? t('review.pending') : t('review.revertTurn')}
            </button>
            {/* A failed phase always carries the host's reason; the label covers a host that sent none. */}
            {review.phase === 'done' && <span className={css.reviewStatus}>{t('review.done')}</span>}
            {review.phase === 'failed' && <span className={css.reviewStatus}>{review.reason ?? t('review.failed')}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
