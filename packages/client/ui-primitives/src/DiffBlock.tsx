import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { FoldToggle } from './FoldToggle.tsx'
import { writeClipboard } from './clipboard.ts'
import { buildDiffRows, copyDiffText, type DiffHunk, type DiffRow } from './diff-hunks.ts'
import { grammarLoadCount, highlightLines, subscribeGrammarLoaded, type HighlightSpan } from './markdown/highlight.ts'
import { useViewportHighlighting } from './markdown/useViewportHighlighting.ts'
import css from './DiffBlock.module.css'

/** Output lines shown before the height cap collapses the middle. */
export const DEFAULT_DIFF_MAX_LINES = 16

export interface DiffBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: readonly DiffHunk[]
  /** Localized chrome supplied by the owning render site. */
  labels: DiffBlockLabels
  /** Height cap in body lines before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /**
   * Grammar hint for the changed file, as the owning render site derives it
   * from the path. Absent, unknown, or not-yet-loaded renders the plain body.
   */
  lang?: string | undefined
}

/** Localized chrome for {@link DiffBlock} and {@link DiffSplitBlock}. */
export interface DiffBlockLabels {
  copy: string
  copied: string
  collapseAria: string
  expandAria: (hidden: number) => string
  collapse: string
  expand: (hidden: number) => string
  files: (count: number) => string
}

/** The dim class per row kind (path/gap chrome vs the diff's own +/- colors). */
const ROW_CLASS: Record<DiffRow['kind'], string | undefined> = {
  path: css.path,
  del: css.del,
  add: css.add,
  context: css.context,
  gap: css.gap,
}

/**
 * One row's own text: the grammar's runs when the row carries them, bare text
 * otherwise. A row with no runs draws exactly what it drew before a language
 * was available, so an unsupported or still-loading grammar degrades to plain
 * instead of to nothing.
 * @param props - the row's text and its optional runs.
 * @returns the row's text content.
 */
export function DiffLineText({ text, spans }: { text: string; spans?: readonly HighlightSpan[] | undefined }): ReactNode {
  if (spans === undefined) return text
  return spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)
}

/**
 * Render a file mutation as an inline diff surface.
 * @param props - see {@link DiffBlockProps}.
 * @returns the diff block element.
 */
export function DiffBlock({ diffs, labels, maxLines = DEFAULT_DIFF_MAX_LINES, className, lang }: DiffBlockProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const highlighting = useViewportHighlighting(rootRef, lang)
  // Re-render when a lazy grammar finishes loading, so a diff that drew plain
  // while its language's grammar imported picks up highlighting. The snapshot
  // value is opaque; only its change across renders drives the memo.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const { rows, added, removed, files } = useMemo(
    () => buildDiffRows(diffs, highlighting ? text => highlightLines(text, lang) : undefined),
    [diffs, highlighting, lang, loaded],
  )
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyDiffText(rows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, rows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  if (rows.length === 0) return null

  const hidden = rows.length - maxLines
  const capped = hidden > 0 && !expanded
  // Same split arithmetic as TerminalBlock and the TUI transcript's collapsed
  // card, so a body's head and tail slices agree across the front ends.
  const headLines = Math.ceil(maxLines / 2)
  const tailLines = maxLines - headLines
  const head = capped ? rows.slice(0, headLines) : rows
  const tail = capped ? rows.slice(rows.length - tailLines) : []

  const row = (entry: DiffRow, index: number): ReactNode => (
    <div key={index} className={clsx(css.line, ROW_CLASS[entry.kind])} data-diff-hunk={entry.hunk}>
      <DiffLineText text={entry.text} spans={entry.spans} />
    </div>
  )

  return (
    <div
      ref={rootRef}
      className={clsx(css.block, className)}
      data-diff=""
      data-diff-highlight={highlighting ? '' : undefined}
    >
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      <div className={css.body}>
        {head.map(row)}
        {hidden > 0 && (
          <FoldToggle
            className={css.expand}
            expanded={expanded}
            hidden={hidden}
            labels={labels}
            onToggle={onToggle}
          />
        )}
        {tail.map(row)}
      </div>
      <div className={css.footer}>└ +{added} -{removed} · {labels.files(files)}</div>
    </div>
  )
}
