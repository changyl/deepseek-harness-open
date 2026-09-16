/**
 * The text preview's body: a file's content, or the reason it is not showing.
 *
 * Two sources meet here. The standard `useResource` hook gives the file's
 * metadata — its version — and this type's
 * own store holds the content it read through its face. A Host-reported change is
 * announced, not applied: reloading under a reader would lose their place, so
 * the bar waits for a click. A failed metadata frame — the file gone, its
 * workspace unknown — takes the same bar's place over the pages already loaded,
 * with the same reload. The type's controls, viewer choice, wrap and reload, sit at the end of
 * the path row; the Sidebar's strip carries none of them.
 *
 * A renderer that declares itself editable also gets an editing session, which
 * is the only place this type writes anything. The draft is read whole rather
 * than assembled from the pages on screen, because a page is a lossy view of the
 * file; the save is guarded by the version the draft came from, so a file that
 * moved on is refused instead of overwritten. While the pane is narrow the
 * session replaces the preview — there is no room for both — and once it is
 * fullscreen the two share the column.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DiffBlock, DiffSplitBlock, FileTypeIcon, IconRefreshOutline16, Menu, Tooltip, classifyFileType, contentLines,
  type DiffHunk,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { pathPartsOf } from '@deepseek-ai/dsh-util-workspace-path'
import type { TextInjected } from './face.ts'
import type { ChangeReviewDecision } from '@deepseek-ai/dsh-change-review'
import type { SessionFileChange } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { ReviewTarget } from './review-target.ts'
import { languageForPath } from './code/languages.ts'
import { diffBlockLabels } from './diff-labels.ts'
import { failureLine } from './failure-line.ts'
import { IconNowrapFill16, IconWrapFill16 } from './icons.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { TextEditor } from './TextEditor.tsx'
import { hostFileOf } from './rpc.ts'
import type { TextStore } from './store.ts'
import type { DocumentContent } from './document/contract.ts'
import { matchingDocumentPreviews } from './document/registry.ts'
import type { DocumentPreviewDefinition } from './document/registry.ts'
import { PLAIN_BODY_ID } from './text/index.ts'
import { loadedPages, lastLineLoaded, scrollToLine } from './text/lines.ts'
import css from './TextPreview.module.css'

export { linesOf, loadedPages, lastLineLoaded, scrollToLine } from './text/lines.ts'
export type { LoadedPage } from './text/lines.ts'

/** Keep the path fade in sync with whether its full text fits the header row. */
function usePathClipped(
  box: RefObject<HTMLDivElement | null>,
  text: RefObject<HTMLSpanElement | null>,
  path: string,
  shown: boolean,
): void {
  useLayoutEffect(() => {
    const outer = box.current
    const inner = text.current
    if (outer === null || inner === null) return undefined
    const apply = (): void => {
      if (inner.offsetWidth > outer.clientWidth) outer.dataset.textpreviewPathClipped = ''
      else delete outer.dataset.textpreviewPathClipped
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(apply)
    observer?.observe(outer)
    observer?.observe(inner)
    return () => { observer?.disconnect() }
  }, [box, text, path, shown])
}

/** What the body draws: the Turn change in one column, the same change in two, or the file itself. */
type ChangeView = 'change' | 'split' | 'file'

/** Private registration inputs; the framework binds the registry source to useDocumentPreviews. */
export interface TextPreviewInjected extends TextInjected {
  readonly hooks: { readonly documentPreviews: ObservableSnapshot<readonly DocumentPreviewDefinition[]> }
  /**
   * Read the hunks one Turn change recorded for a file.
   * @param address - the file's resource address, this tab's content identity.
   * @param seq - the change's `tool/result` seq.
   * @returns the hunks, or undefined when no rendered Turn indexed this change.
   */
  readonly readFileChange: (address: string, seq: number) => readonly DiffHunk[] | undefined
  /**
   * Record the reader's decision about the change this tab shows.
   * @param action - keep the change, or restore the file to its pre-change content.
   * @param change - the change to decide.
   * @returns the host's refusal reason, or undefined when the decision was recorded.
   */
  readonly reviewChange: (action: 'accepted' | 'reverted', change: ReviewTarget) => Promise<string | undefined>
  /**
   * Read the decision a previous look already recorded for one change.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the change's `tool/result` seq.
   * @returns the recorded decision, or undefined when the change was never decided.
   */
  readonly readReview: (address: string, seq: number) => ChangeReviewDecision | undefined
  /**
   * Read the change next to this one inside its Turn.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the change's `tool/result` seq.
   * @param direction - the neighbour to read.
   * @returns the neighbouring change, or undefined at the end of the Turn.
   */
  readonly readNeighbourChange: (
    address: string,
    seq: number,
    direction: 'previous' | 'next',
  ) => SessionFileChange | undefined
  /**
   * Read where this change sits among its Turn's changes, counted in regions.
   * @param address - the file's `dsh-resource://file/…` address.
   * @param seq - the change's `tool/result` seq.
   * @returns the regions before it and the Turn's total, or undefined without one.
   */
  readonly readHunkRange: (address: string, seq: number) => { readonly before: number; readonly total: number } | undefined
}

/** The body's composed props: the tab, its navigation, the shared store and face, and copy. */
export type TextPreviewProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.tab.document'>
  & PropsStore<TextStore>
  & InjectFace<TextPreviewInjected>
  & PropsLocale<'sidebarDocumentPreview'>

/**
 * The text type's body, registered under `sidebar.right.pane.tab` as `text`.
 * @param props - composed slot props.
 * @returns the content read so far with its controls, or a progress line.
 */
export function TextPreview({
  useTabInfo, useResource, useStore, actions, loadPage, reloadPages,
  loadAll, reloadAll, useDocumentPreviews, readFileChange, reviewChange, readReview,
  readNeighbourChange, readHunkRange, renderSlot, t, openDraft, closeDraft, saveDraft,
}: TextPreviewProps): ReactNode {
  const { tab, sidebar } = useTabInfo()
  const { navigation, signal } = tab
  const meta = useResource<'file'>(tab.contentId)
  const canRead = meta.status !== 'none'
  const file = useMemo(() => hostFileOf(tab.contentId), [tab.contentId])
  const state = useStore(s => s.byTab[tab.id])
  const definitions = useDocumentPreviews(value => value)
  const candidates = useMemo(() => {
    const matched = matchingDocumentPreviews(definitions, file.path)
    const fallback = definitions.find(definition => definition.id === PLAIN_BODY_ID)
    return fallback === undefined ? matched : [...matched, fallback]
  }, [definitions, file.path])
  const selected = candidates.find(candidate => candidate.id === state?.rendererId) ?? candidates[0]
  const mode = selected?.loading
  const current = (state?.mode ?? 'text-pages') === mode ? state : undefined
  // Whether an editing session is open, or opening. Read here rather than beside
  // the other edit derivations because the paging effects below ask it too: a
  // fullscreen split keeps filling the preview half while the reader types.
  const editing = current?.editLoading === true || current?.edit !== undefined
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollportRef = useRef<HTMLElement | null>(null)
  const storedScrollTopRef = useRef(0)
  // The change the comparison last landed on, so it lands once per entry into
  // that layout rather than on every render of the file it draws.
  const landedChangeRef = useRef<number | undefined>(undefined)
  const pathRef = useRef<HTMLDivElement | null>(null)
  const pathTextRef = useRef<HTMLSpanElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The comparison layout the session reads changes in, chosen by the header's
  // second control. It belongs to the session rather than to one change, so a
  // navigation to the next change keeps drawing it that way.
  const layout = useStore(s => s.changeLayout)
  // Whether this change was swapped for the whole file instead; a new
  // navigation carries a new seq, so the default returns on its own without an
  // effect.
  const [fileLook, setFileLook] = useState<{ seq: number | undefined } | null>(null)
  // The decision this tab already made, keyed by the change it belongs to: a
  // navigation to another change starts undecided without an effect.
  // The change the reader stepped to, keyed by the change it belongs to: a
  // navigation to another change starts at its first one without an effect.
  const [stepped, setStepped] = useState<{ key: string; index: number } | null>(null)
  const [review, setReview] = useState<
    { key: string; phase: 'pending' | 'accepted' | 'reverted' } | { key: string; phase: 'failed'; reason: string } | null
  >(null)
  const diffLabels = useMemo(() => diffBlockLabels(t), [t])
  const displayPath = meta.value?.absolutePath ?? current?.complete?.absolutePath ?? file.path
  usePathClipped(pathRef, pathTextRef, displayPath, state !== undefined)
  // Every tab of this type is a `file` resource address, so its params are the
  // `file` type's; the union is narrowed on the field read, not validated.
  const line = navigation.params !== undefined && 'line' in navigation.params ? navigation.params.line : undefined
  const changeSeq = navigation.params !== undefined && 'changeSeq' in navigation.params
    ? navigation.params.changeSeq
    : undefined
  const landingHunk = navigation.params !== undefined && 'hunk' in navigation.params
    ? navigation.params.hunk
    : undefined
  const change = changeSeq === undefined ? undefined : readFileChange(tab.contentId, changeSeq)
  const changeHunks = change !== undefined && change.length > 0 ? change : undefined
  const viewMode: ChangeView = changeHunks === undefined
    ? 'file'
    : fileLook !== null && fileLook.seq === changeSeq ? 'file' : layout
  const pages = current?.pages
  const loaded = useMemo(() => loadedPages(pages ?? {}), [pages])
  const loadedThrough = lastLineLoaded(loaded)
  const hasContent = loaded.length > 0 || current?.complete !== undefined
  storedScrollTopRef.current = state?.scrollTop ?? 0
  const bindBody = useCallback((body: HTMLDivElement | null): void => {
    const previous = bodyRef.current
    bodyRef.current = body
    if (scrollportRef.current === null || scrollportRef.current === previous) scrollportRef.current = body
  }, [])
  const bindScrollport = useCallback((scrollport: HTMLElement | null): void => {
    const next = scrollport ?? bodyRef.current
    scrollportRef.current = next
    if (next !== null) next.scrollTop = storedScrollTopRef.current
  }, [])

  // First mount reads the first page; a body coming back to a tab with content
  // reads nothing, because the store outlives the body.
  const started = current !== undefined
  useEffect(() => {
    if (started || !canRead || mode === undefined) return
    if (mode === 'text-pages') loadPage(tab.id, file, 1, signal, meta.value?.version)
    else loadAll(tab.id, file, signal, meta.value?.version)
  }, [started, tab.id, file, signal, loadPage, loadAll, canRead, mode, meta.value?.version])

  // The two-column layout draws the change among the file's own lines, so its
  // reader needs the whole file and pages keep loading while it is selected —
  // the walk scrolling the file body would make, without the scrolling. The
  // comparison stays change-only until the file is complete. The fullscreen
  // editing split asks the same thing of the preview half: it is on screen the
  // whole time the reader types, so it fills in behind them.
  const previewVisible = viewMode === 'split' || (editing && sidebar.fullscreen)
  useEffect(() => {
    if (!previewVisible || !canRead || mode !== 'text-pages' || current === undefined) return
    if (current.eof || current.loading || current.failure !== undefined || loaded.length === 0) return
    loadPage(tab.id, file, loadedThrough + 1, signal, meta.value?.version)
  }, [
    previewVisible, canRead, mode, current, loaded.length, loadedThrough, tab.id, file, signal, loadPage, meta.value?.version,
  ])

  // Come back where the reader was once there is content to scroll: on a remount,
  // after a reload rebuilt the content, or after the selected renderer changed.
  // Scroll writes preserve both identities, so they never re-land.
  useEffect(() => {
    const body = scrollportRef.current
    if (hasContent && body !== null && state !== undefined) body.scrollTop = state.scrollTop
  }, [hasContent, selected?.id])

  // Answer a navigation once: a line the pages do not reach yet loads the next
  // page (again, until the pages cover it or the file ends); a line they hold
  // is scrolled to and marked. The store remembers the answer, so a remount
  // restores the reader's place instead.
  useEffect(() => {
    const body = scrollportRef.current
    if (current === undefined || body === null || current.revision === navigation.revision) return
    if (line === undefined || mode !== 'text-pages') {
      actions.navigated(tab.id, navigation.revision)
      return
    }
    if (line > loadedThrough && !current.eof) {
      if (!current.loading && current.failure === undefined && canRead) {
        loadPage(tab.id, file, loadedThrough + 1, signal, meta.value?.version)
      }
      return
    }
    const landed = scrollToLine(body, line)
    if (!landed && line <= loadedThrough) return
    actions.navigated(tab.id, navigation.revision)
    // Recorded here as well as by the scroll event, so the store holds the
    // landing before any later navigation reads it.
    actions.scrolled(tab.id, body.scrollTop)
  }, [
    navigation.revision, line, loadedThrough, current?.eof, current?.loading, current?.failure, started,
    selected?.id, mode, file, canRead, meta.value?.version,
  ])

  const content = useMemo((): DocumentContent | undefined => {
    if (mode === 'bytes-complete') {
      return current?.complete === undefined ? undefined : { kind: 'bytes', data: current.complete.data }
    }
    if (current === undefined || loaded.length === 0) return undefined
    return { kind: 'text', pages: loaded, text: loaded.filter(page => page.lines > 0).map(page => page.text).join('\n'), eof: current.eof }
  }, [mode, loaded, current?.complete, current?.eof])

  // The whole-file comparison draws the file's own lines; a read that is still
  // paging, or one the byte renderers own, leaves the change unplaced. The split
  // is memoized because this body re-renders on every scroll of the file.
  const changedFileLines = useMemo(
    () => content?.kind === 'text' && content.eof ? contentLines(content.text) : undefined,
    [content],
  )
  // The change is the file's own code, so it reads with the same grammar the
  // file's own renderer picks for this path.
  const changeLang = languageForPath(file.path)
  const diffSurface = changeHunks === undefined || viewMode === 'file'
    ? undefined
    : viewMode === 'split'
      ? <DiffSplitBlock diffs={changeHunks} labels={diffLabels} maxLines={Infinity} fileLines={changedFileLines} lang={changeLang} />
      : <DiffBlock diffs={changeHunks} labels={diffLabels} maxLines={Infinity} lang={changeLang} />

  // The comparison draws the change among the file's own lines, so selecting it
  // lands on the change rather than on the file's first line. The mark names
  // where the change sits in the drawn file and exists only there: a body that
  // could not place its hunks is the change alone and already opens on it. The
  // whole-file body arrives in the render that finishes reading the file, which
  // is what `changedFileLines` tracks. Entering the layout again lands again; a
  // reload inside it does not, so the reader keeps the place they were reading.
  useEffect(() => {
    const body = scrollportRef.current
    if (viewMode !== 'split') {
      landedChangeRef.current = undefined
      return
    }
    if (body === null || changeSeq === undefined || changedFileLines === undefined
      || landedChangeRef.current === changeSeq) return
    const anchor = body.querySelector('[data-split-change-start]')
    if (!(anchor instanceof HTMLElement)) return
    landedChangeRef.current = changeSeq
    body.scrollTop = Math.max(0, anchor.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop)
  }, [viewMode, changeSeq, changedFileLines])

  if (state === undefined || selected === undefined) {
    return (
      <div className={css.status} data-textpreview-state="loading">
        {meta.status === 'none'
          ? <p className={css.statusLine}>{t('resourceUnavailable')}</p>
          : <LoadingIndicator className={css.statusLine} label={t('loading')} />}
      </div>
    )
  }
  const next = loadedThrough + 1
  const { directory, name } = pathPartsOf(displayPath)
  const observedVersion = meta.value?.version
  const changed = current?.version !== undefined && observedVersion !== undefined
    && observedVersion !== current.version && observedVersion !== current.observedVersion
  const loadNext = (): void => {
    if (!canRead || current?.loading || current?.eof) return
    loadPage(tab.id, file, next, signal, meta.value?.version)
  }
  const reload = (): void => {
    if (!canRead) return
    if (mode === 'text-pages') reloadPages(tab.id, file, signal, meta.value?.version)
    else reloadAll(tab.id, file, signal, meta.value?.version)
  }
  // An editing session replaces two sources at once: the pages, and the change
  // view. Both are answers to "show me this file", and the editor is a third.
  const edit = current?.edit
  const editable = current !== undefined && selected.editable === true && viewMode === 'file' && canRead
  const dirty = edit !== undefined && edit.text !== edit.saved
  // Fullscreen is the one layout with room for the file and the draft at once;
  // narrow shows whichever the reader is working in.
  const splitEdit = sidebar.fullscreen && edit !== undefined
  const reviewKey = `${String(changeSeq)}:${file.path}`
  // This look's own decision wins; a decision an earlier look recorded is the
  // state the controls start on, so a reload does not offer the same choice twice.
  const reviewPhase = review !== null && review.key === reviewKey
    ? review.phase
    : changeSeq === undefined ? undefined : readReview(tab.contentId, changeSeq)
  /** The control's tooltip: a refusal explains itself, every other state names the action. */
  const reviewLabel = (fallback: string): string =>
    review !== null && review.key === reviewKey && review.phase === 'failed' ? review.reason : fallback
  const hunkCount = changeHunks?.length ?? 0
  const currentHunk = stepped !== null && stepped.key === reviewKey
    ? stepped.index
    : Math.min(landingHunk ?? 0, Math.max(0, hunkCount - 1))
  // Stepping runs through the Turn's changes, not just this file's: the range
  // and the neighbours come from the Turn the change index published them under.
  const range = changeSeq === undefined ? undefined : readHunkRange(tab.contentId, changeSeq)
  const previousChange = changeSeq === undefined ? undefined : readNeighbourChange(tab.contentId, changeSeq, 'previous')
  const nextChange = changeSeq === undefined ? undefined : readNeighbourChange(tab.contentId, changeSeq, 'next')
  const hunkTotal = range?.total ?? hunkCount
  const hunkPosition = (range?.before ?? 0) + currentHunk + 1
  /**
   * Scroll the body to one change region, or open the neighbouring change when
   * the reader steps past either end of this file. A file entered backwards
   * lands on its last region.
   * @param index - 0-based region to land on.
   */
  const jumpToHunk = (index: number): void => {
    if (index < 0 || index >= hunkCount) {
      const target = index < 0 ? previousChange : nextChange
      /* v8 ignore next -- the controls disable at an end the Turn has nothing beyond */
      if (target === undefined) return
      tab.actions.openResource(target.address, {
        params: { changeSeq: target.seq, hunk: index < 0 ? Math.max(0, target.diffs.length - 1) : 0 },
      })
      return
    }
    const body = scrollportRef.current
    /* v8 ignore next -- the body binds before the controls render */
    if (body === null) return
    const anchor = body.querySelector(`[data-diff-hunk="${String(index)}"]`)
    /* v8 ignore next -- the anchors are rendered from the same change list this counts */
    if (!(anchor instanceof HTMLElement)) return
    setStepped({ key: reviewKey, index })
    body.scrollTop = Math.max(0, anchor.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop)
  }
  const decide = async (action: 'accepted' | 'reverted'): Promise<void> => {
    // The controls render only where the tab resolved a change and its seq.
    /* v8 ignore next -- defensive: the header's review controls require a resolved changeSeq */
    if (changeSeq === undefined || reviewPhase === 'pending') return
    setReview({ key: reviewKey, phase: 'pending' })
    const reason = await reviewChange(action, { seq: changeSeq, path: file.path })
    if (reason !== undefined) {
      setReview({ key: reviewKey, phase: 'failed', reason })
      return
    }
    setReview({ key: reviewKey, phase: action === 'accepted' ? 'accepted' : 'reverted' })
    if (action === 'reverted') {
      // The file the tab drew is gone: show the restored content instead of a
      // change view whose hunks no longer describe the file.
      setFileLook({ seq: changeSeq })
      reload()
    }
  }
  return (
    <div
      className={css.preview}
      data-textpreview-state="text"
      data-textpreview-url={tab.contentId}
      data-document-preview={selected.id}
      data-textpreview-editing={editing ? '' : undefined}
    >
      {/* A failed save takes the banner slot outright: it is the newest thing
          that happened to this file, and the one with a decision attached. */}
      {edit?.failure !== undefined && (
        <p className={css.changed} data-textpreview-save-failed={edit.failure.code}>
          <span>{failureLine(t, edit.failure)}</span>
          {edit.conflict && (
            // The two ways out of a conflict, and the only place a save travels
            // without its guard: the reader is choosing to lose the other side.
            <>
              <button
                type="button"
                className={css.action}
                data-textpreview-overwrite
                onClick={() => { saveDraft(tab.id, file, edit.text, undefined, signal) }}
              >
                {t('edit.overwrite')}
              </button>
              <button
                type="button"
                className={css.action}
                data-textpreview-reopen
                onClick={() => { openDraft(tab.id, file, signal) }}
              >
                {t('edit.reload')}
              </button>
            </>
          )}
        </p>
      )}
      {/* The change view is history, not a file read: a stale-metadata banner
          would report a version the diff does not depend on. An open editing
          session speaks for the file instead: its save is the one that can
          refuse a changed file, and it says so when it does. */}
      {!editing && viewMode === 'file' && (meta.failure !== undefined && hasContent
        ? (
          // The file's metadata failed — gone, or its workspace unknown — which
          // outranks a pending change; the pages already read stay under it.
          // With nothing read the body's own failure already says it, so the
          // bar would only repeat the same line.
          <p className={css.changed} data-textpreview-meta-failed={meta.failure.code}>
            <span>{failureLine(t, meta.failure)}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        )
        : changed && (
          <p className={css.changed} data-textpreview-changed>
            <span>{t('changed')}</span>
            <button
              type="button"
              className={css.action}
              data-textpreview-reload-now
              onClick={reload}
            >
              {t('reloadNow')}
            </button>
          </p>
        ))}
      <div className={css.header}>
        <div ref={pathRef} className={css.path} title={displayPath} data-textpreview-path>
          <span ref={pathTextRef} className={css.pathText}>
            {directory !== '' && <span className={css.pathDirectory}>{directory}</span>}
            <span className={css.pathName}>{name}</span>
          </span>
        </div>
        {changeHunks !== undefined && (
          // Two controls over one subject: the first says whether the change is
          // showing at all, the second how it is drawn. Each pressed state is
          // its own fact: the whole-file look is recorded for the change it was
          // chosen on, while the layout belongs to the session.
          <>
            <Tooltip label={t(viewMode === 'file' ? 'change.show' : 'change.toFile')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={clsx(css.tool, css.changeTool)}
                aria-pressed={viewMode !== 'file'}
                aria-label={t('change.aria')}
                data-textpreview-tool="change"
                onClick={() => {
                  if (viewMode === 'file') setFileLook(null)
                  else setFileLook({ seq: changeSeq })
                }}
              >
                {t('change.show')}
              </button>
            </Tooltip>
            <Tooltip label={t('split.show')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={clsx(css.tool, css.changeTool)}
                aria-pressed={viewMode === 'split'}
                aria-label={t('split.aria')}
                data-textpreview-tool="split"
                onClick={() => {
                  // A comparison always shows the change: the whole-file look
                  // gives way to the layout this control selects.
                  setFileLook(null)
                  actions.laidOut(viewMode === 'split' ? 'change' : 'split')
                }}
              >
                {t('split.label')}
              </button>
            </Tooltip>
            {hunkTotal > 1 && (
              <>
                <Tooltip label={t('hunk.prev')} side="bottom" delayMs={500}>
                  <button
                    type="button"
                    className={clsx(css.tool, css.changeTool)}
                    aria-label={t('hunk.prev')}
                    disabled={currentHunk === 0 && previousChange === undefined}
                    data-textpreview-tool="prev-hunk"
                    onClick={() => { jumpToHunk(currentHunk - 1) }}
                  >
                    {t('hunk.prev')}
                  </button>
                </Tooltip>
                <span className={css.hunkPosition} data-textpreview-hunk-position>
                  {t('hunk.position', { index: String(hunkPosition), count: String(hunkTotal) })}
                </span>
                <Tooltip label={t('hunk.next')} side="bottom" delayMs={500}>
                  <button
                    type="button"
                    className={clsx(css.tool, css.changeTool)}
                    aria-label={t('hunk.next')}
                    disabled={currentHunk >= hunkCount - 1 && nextChange === undefined}
                    data-textpreview-tool="next-hunk"
                    onClick={() => { jumpToHunk(currentHunk + 1) }}
                  >
                    {t('hunk.next')}
                  </button>
                </Tooltip>
              </>
            )}
            <Tooltip label={reviewLabel(t('review.accept'))} side="bottom" delayMs={500}>
              <button
                type="button"
                className={clsx(css.tool, css.changeTool)}
                aria-label={t('review.accept')}
                disabled={reviewPhase === 'pending'}
                data-textpreview-tool="accept"
                onClick={() => { void decide('accepted') }}
              >
                {reviewPhase === 'accepted' ? t('review.accepted') : t('review.accept')}
              </button>
            </Tooltip>
            <Tooltip label={reviewLabel(t('review.revert'))} side="bottom" delayMs={500}>
              <button
                type="button"
                className={clsx(css.tool, css.changeTool)}
                aria-label={t('review.revert')}
                disabled={reviewPhase === 'pending'}
                data-textpreview-tool="revert"
                onClick={() => { void decide('reverted') }}
              >
                {reviewPhase === 'reverted'
                  ? t('review.reverted')
                  : reviewPhase === 'pending' ? t('review.pending') : reviewPhase === 'failed' ? t('review.failed') : t('review.revert')}
              </button>
            </Tooltip>
          </>
        )}
        {editable && !editing && (
          <Tooltip label={t('edit.start')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={clsx(css.tool, css.changeTool)}
              aria-label={t('edit.startAria')}
              data-textpreview-tool="edit"
              onClick={() => { openDraft(tab.id, file, signal) }}
            >
              {t('edit.start')}
            </button>
          </Tooltip>
        )}
        {edit !== undefined && (
          <>
            {/* Narrow has room for one of the two views, so leaving the editor
                is a control. A dirty draft is not thrown away by it: the reader
                saves or discards first, and both have their own button. */}
            {!splitEdit && (
              <Tooltip label={t('edit.preview')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  className={clsx(css.tool, css.changeTool)}
                  aria-label={t('edit.previewAria')}
                  disabled={dirty}
                  data-textpreview-tool="preview"
                  onClick={() => { closeDraft(tab.id) }}
                >
                  {t('edit.preview')}
                </button>
              </Tooltip>
            )}
            <Tooltip label={t('edit.save')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={clsx(css.tool, css.changeTool)}
                aria-label={t('edit.save')}
                disabled={!dirty || edit.saving}
                data-textpreview-tool="save"
                onClick={() => { saveDraft(tab.id, file, edit.text, edit.version, signal) }}
              >
                {edit.saving ? t('edit.saving') : t('edit.save')}
              </button>
            </Tooltip>
            {dirty && (
              <Tooltip label={t('edit.discard')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  className={clsx(css.tool, css.changeTool)}
                  aria-label={t('edit.discard')}
                  data-textpreview-tool="discard"
                  onClick={() => { closeDraft(tab.id) }}
                >
                  {t('edit.discard')}
                </button>
              </Tooltip>
            )}
            {dirty && <span className={css.dirtyMark} data-textpreview-dirty>{t('edit.dirty')}</span>}
          </>
        )}
        <Menu
          open={menuOpen}
          anchor={(
            <button type="button" className={clsx(css.tool, css.viewerTool)} aria-label={t('openWith')} title={selected.title()} data-document-viewer-menu onClick={() => { setMenuOpen(value => !value) }}>
              {selected.title()}
            </button>
          )}
          items={candidates.map(candidate => ({ id: candidate.id, label: candidate.title() }))}
          selectedId={selected.id}
          onSelect={(id) => { actions.selected(tab.id, id); setMenuOpen(false) }}
          onClose={() => { setMenuOpen(false) }}
          align="end"
          portal
          dense
        />
        {selected.wrap === true && (
          // The tooltip names the action while the stable aria name and
          // `aria-pressed` expose the control and its current state.
          <Tooltip label={t(state.wrap ? 'wrap.disable' : 'wrap.enable')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.tool}
              aria-pressed={state.wrap}
              aria-label={t('wrap.aria')}
              data-textpreview-tool="wrap"
              onClick={() => { actions.toggledWrap(tab.id) }}
            >
              {state.wrap ? <IconNowrapFill16 /> : <IconWrapFill16 />}
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('reload')} side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.tool}
            aria-label={t('reload')}
            data-textpreview-tool="reload"
            onClick={reload}
          >
            <IconRefreshOutline16 />
          </button>
        </Tooltip>
      </div>
      {/* One surface holds both views. The preview stays mounted while the
          reader edits — the editor is drawn above it and the preview is hidden
          rather than unmounted — so its scroller keeps the reader's place, and
          a fullscreen pane simply shows both side by side. */}
      <div
        className={css.editSurface}
        data-textpreview-edit={editing ? '' : undefined}
        data-textpreview-split={splitEdit ? '' : undefined}
      >
        {editing && (edit === undefined
          // The draft is being read whole, which is the one moment a session
          // exists with nothing to put in it.
          ? (
            <div className={css.status} data-textpreview-state="draft-loading">
              <LoadingIndicator className={css.statusLine} label={t('loading')} />
            </div>
          )
          : (
            <TextEditor
              value={edit.text}
              onChange={(text) => { actions.drafted(tab.id, text) }}
              wrap={state.wrap}
              label={t('edit.editorAria')}
            />
          ))}
        <div
          ref={bindBody}
          className={clsx(css.body, state.wrap && css.wrap)}
          data-textpreview-body
          data-textpreview-wrap={state.wrap ? '' : undefined}
          onScrollCapture={(event) => {
            const body = scrollportRef.current
            /* v8 ignore next -- callback refs bind the scrollport during commit, before user input. */
            if (body === null) return
            if (event.target !== body) return
            actions.scrolled(tab.id, body.scrollTop)
            // The change view is one finite surface: reaching its bottom must not
            // page the file the reader is not looking at.
            if (viewMode === 'file' && mode === 'text-pages' && current?.failure === undefined && body.clientHeight > 0
              && body.scrollTop + body.clientHeight >= body.scrollHeight - 1) loadNext()
          }}
        >
          {diffSurface !== undefined
            ? (
              <div className={css.change} data-textpreview-change data-change-mode={viewMode}>
                {diffSurface}
              </div>
            )
            : (
              <>
                {!hasContent && current?.failure === undefined && (
                  <LoadingIndicator className={css.statusLine} label={t('loading')} />
                )}
                {content !== undefined && renderSlot('sidebar.right.tab.document', {
                  resourceAddress: tab.contentId, content, wrap: state.wrap, scrollportRef: bindScrollport,
                }, {
                  entryKey: selected.id, hookContext: useTabInfo,
                  fallback: <p className={css.statusLine}>{t('rendererUnavailable', { name: selected.title() })}</p>,
                })}
                {current?.failure !== undefined && (hasContent
                  ? (
                    <p className={css.statusLine} data-textpreview-failed={current.failure.code}>
                      <span>{failureLine(t, current.failure)}</span>
                      <button
                        type="button"
                        className={css.action}
                        data-textpreview-retry
                        onClick={loadNext}
                      >
                        {t('retry')}
                      </button>
                    </p>
                  )
                  : (
                    // With no content, retry the selected renderer's read; metadata
                    // observation remains owned by the resource provider.
                    <div className={css.empty} data-textpreview-failed={current.failure.code}>
                      <FileTypeIcon kind={classifyFileType(name)} size={36} className={css.emptyIcon} />
                      <p className={css.emptyLine}>{failureLine(t, current.failure)}</p>
                      <button
                        type="button"
                        className={css.retry}
                        data-textpreview-retry
                        onClick={reload}
                      >
                        <IconRefreshOutline16 size={14} />
                        {t('retry')}
                      </button>
                    </div>
                  ))}
                {mode === 'text-pages' && current !== undefined && loaded.length > 0 && !current.eof && current.failure === undefined && (
                  <button
                    type="button"
                    className={css.more}
                    disabled={current.loading}
                    data-textpreview-more
                    onClick={loadNext}
                  >
                    {current.loading ? <LoadingIndicator label={t('loading')} /> : t('loadMore')}
                  </button>
                )}
              </>
            )}
        </div>
      </div>
    </div>
  )
}
