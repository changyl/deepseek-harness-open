/** Existing changed-file chips and explicitly declared files for a closing turn. */
import { useEffect, useMemo, useState } from 'react'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { Button, IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GlobalStandardProps, InjectFace, PropsLocale, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionFileChange, SessionFileReview } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { ChangeCoordinates, ChangeReviewDecision } from '@deepseek-ai/dsh-change-review'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { PresentedOpenController } from './present-open.ts'
import { ProducedFiles } from './ProducedFiles.tsx'
import {
  presentedForClosing, selectProducedChanges, selectProducedFiles, selectProducedReviews,
  type PresentedPath, type ProducedChange, type ProducedReview,
} from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import { presentedFileUrl } from '../presented.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'
import css from './Deliverables.module.css'

interface DeliverablesMatch {
  /** The Turn these changes belong to; stepping crosses files only inside it. */
  turn: number
  /** Every path the Turn produced, whether or not its change reported hunks. */
  produced: readonly string[]
  /** The changes that same source applied, for the open gesture. */
  changes: readonly ProducedChange[]
  presented: readonly PresentedPath[]
  /** The decisions this Turn already recorded, oldest first; absent = none recorded. */
  reviews?: readonly ProducedReview[] | undefined
}

const COLLAPSED_PRESENTED_COUNT = 4

/** Native-open callbacks and shared gesture status supplied by the plugin. */
export interface DeliverablesInjected {
  hooks: {
    presentedOpen: ObservableSnapshot<ReturnType<PresentedOpenController['state']['getSnapshot']>>
    presentedHost: ObservableSnapshot<ReturnType<PresentedOpenController['host']['getSnapshot']>>
  }
  reloadPresentedHost: PresentedOpenController['loadHost']
  openPresented: PresentedOpenController['open']
  /** Record this Turn's changes where a preview opened from its rows reads them. */
  publishChanges: (changes: readonly SessionFileChange[]) => () => void
  /** Read the last change any rendered Turn recorded for one file address. */
  latestChange: (address: string) => SessionFileChange | undefined
  /** Record the decisions a rendered Turn published. */
  publishReviews: (reviews: readonly SessionFileReview[]) => () => void
  /** Post one decision for the changes a row lists. */
  reviewChanges: (
    sessionId: string,
    action: ChangeReviewDecision,
    changes: readonly ChangeCoordinates[],
  ) => Promise<string | undefined>
}

/**
 * Claim turns containing modified paths or declared files.
 * @param owner - closing turn.
 * @returns matched files, or null for an empty turn.
 */
export function selectDeliverables(owner: TurnTailOwnerProps): DeliverablesMatch | null {
  const produced = selectProducedFiles(owner) ?? []
  const changes = selectProducedChanges(owner) ?? []
  const presented = presentedForClosing(owner)
  const reviews = selectProducedReviews(owner)
  return produced.length + presented.length === 0
    ? null
    : { turn: owner.turn.turn, produced, changes, presented, reviews }
}

/**
 * Render workspace file actions and default-application buttons for declared files.
 * @param props - matched files, workspace opener, and localized copy.
 * @returns the closing turn's file rows.
 */
export function Deliverables({ matched, openFile, t, sessionId, useSessions, openPresented, usePresentedOpen, usePresentedHost, reloadPresentedHost, publishChanges, latestChange, publishReviews, reviewChanges }: Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: DeliverablesMatch
} & PropsLocale<typeof NS> & Pick<SessionStandardProps, 'sessionId'> & Pick<GlobalStandardProps, 'useSessions'> & InjectFace<DeliverablesInjected>) {
  const [expanded, setExpanded] = useState(false)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const states = usePresentedOpen(value => value)
  const host = usePresentedHost(value => value)
  const collapsible = matched.presented.length > COLLAPSED_PRESENTED_COUNT
  const presented = collapsible && !expanded
    ? matched.presented.slice(0, COLLAPSED_PRESENTED_COUNT)
    : matched.presented
  const changeByPath = useMemo(
    () => new Map(matched.changes.map(change => [change.path, change])),
    [matched.changes],
  )
  // The chip's reader is a different package, so the row publishes the changes
  // it derived — addressed the same way the tab that reads them is — and keeps
  // them published for as long as it is mounted.
  const published = useMemo<readonly SessionFileChange[]>(
    () => matched.changes.map(change => ({
      address: fileAddressFor(sessionId, cwd, change.path),
      seq: change.seq,
      diffs: change.diffs,
      turn: matched.turn,
    })),
    [matched.changes, matched.turn, sessionId, cwd],
  )
  useEffect(() => publishChanges(published), [publishChanges, published])
  const publishedReviews = useMemo<readonly SessionFileReview[]>(
    () => (matched.reviews ?? []).map(review => ({
      address: fileAddressFor(sessionId, cwd, review.path),
      seq: review.seq,
      decision: review.decision,
    })),
    [matched.reviews, sessionId, cwd],
  )
  useEffect(() => publishReviews(publishedReviews), [publishReviews, publishedReviews])
  const [decision, setDecision] = useState<{ phase: 'pending' | 'done' | 'failed'; reason?: string } | null>(null)
  const decideTurn = (action: ChangeReviewDecision): void => {
    /* v8 ignore next -- the controls exist only where the Turn changed something, and disable while pending */
    if (decision?.phase === 'pending' || matched.changes.length === 0) return
    setDecision({ phase: 'pending' })
    void reviewChanges(sessionId, action, matched.changes.map(change => ({ seq: change.seq, path: change.path })))
      .then((reason) => {
        setDecision(reason === undefined ? { phase: 'done' } : { phase: 'failed', reason })
      })
  }
  const reviewControls = matched.changes.length === 0 ? undefined : {
    phase: decision?.phase ?? 'idle' as const,
    ...decision?.reason === undefined ? {} : { reason: decision.reason },
    decide: decideTurn,
  }
  useEffect(() => {
    if (matched.presented.length > 0 && host === null) void reloadPresentedHost()
  }, [matched.presented.length, host, reloadPresentedHost])
  const openPath = (path: string): void => {
    const change = changeByPath.get(path)
    if (change !== undefined) {
      openFile(path, { changeSeq: change.seq })
      return
    }
    // A delivered file may have been changed in any earlier Turn, and the
    // delivery card names no change of its own. Falling back to the file's last
    // recorded change keeps a preview of a delivered file on its diff instead
    // of dropping to whole-file reading.
    const latest = latestChange(fileAddressFor(sessionId, cwd, path))
    if (latest === undefined) openFile(path)
    else openFile(path, { changeSeq: latest.seq })
  }
  return <>
    {matched.produced.length > 0 && <ProducedFiles matched={matched.produced} changes={matched.changes} openFile={openFile} t={t}
      {...reviewControls === undefined ? {} : { review: reviewControls }} />}
    {matched.presented.length > 0 && <div
      className={css.root}
      data-after-produced-files={matched.produced.length > 0 || undefined}
    >
      {host === 'error' && <div className={css.hostStatus}>
        <span>{t('presented.hostError')}</span>
        <Button size="sm" onClick={() => { void reloadPresentedHost() }}>{t('presented.retry')}</Button>
      </div>}
      {host !== null && host !== 'error' && !host.available && <span className={css.hostStatus}>{t('presented.unavailable')}</span>}
      <div className={css.presented} data-presented-files-row data-single={matched.presented.length === 1 ? true : undefined}>
        {presented.map(file => <PresentedFileCard key={`${file.seq}:${file.index}`} file={file} cwd={cwd}
          phase={states[presentedFileUrl(sessionId, file.seq, file.index)]}
          host={host === 'error' ? null : host} t={t}
          onPreview={() => { openPath(file.path) }}
          onAction={(action) => { void openPresented(sessionId, file.seq, file.index, action) }} />)}
      </div>
      {collapsible && <button type="button" className={css.toggle}
        aria-expanded={expanded}
        aria-label={t(expanded ? 'presented.collapseAria' : 'presented.expandAria', { count: matched.presented.length })}
        onClick={() => { setExpanded(value => !value) }}>
        <span>{t(expanded ? 'presented.collapse' : 'presented.all', { count: matched.presented.length })}</span>
        {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
      </button>}
    </div>}
  </>
}
