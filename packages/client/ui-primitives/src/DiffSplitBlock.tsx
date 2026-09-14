/**
 * The same file mutation as {@link DiffBlock}, drawn as a two-column
 * comparison: the old side on the left, the new side on the right, one row per
 * line band so removals and additions facing each other describe the same
 * place in the file.
 *
 * A one-sided change pads the opposite column, which is what keeps the rows
 * aligned after it. Given the file's own lines, it draws the change in place
 * among them instead of only the changed regions. The surface copies the
 * unified diff text, so the clipboard form does not depend on which layout the
 * reader was looking at.
 */
import { useCallback, useMemo, useState } from 'react'
import clsx from 'clsx'
import { FoldToggle } from './FoldToggle.tsx'
import { writeClipboard } from './clipboard.ts'
import {
  buildDiffRows, buildFileSplitRows, buildSplitRows, copyDiffText, type DiffHunk, type SplitDiffCell, type SplitDiffRow,
} from './diff-hunks.ts'
import { DEFAULT_DIFF_MAX_LINES, type DiffBlockLabels } from './DiffBlock.tsx'
import css from './DiffSplitBlock.module.css'

export interface DiffSplitBlockProps {
  /** One entry per applied hunk, in file order; empty renders nothing. */
  diffs: readonly DiffHunk[]
  /** Localized chrome supplied by the owning render site. */
  labels: DiffBlockLabels
  /** Height cap in body rows before the middle collapses (default {@link DEFAULT_DIFF_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /**
   * The file's whole new text, one entry per line, when the reader asked for the
   * change drawn in place among the file's unchanged lines. Hunks that cannot be
   * placed in it keep the change-only body, so a stale read degrades instead of
   * misplacing the change.
   */
  fileLines?: readonly string[] | undefined
}

/** The class per cell kind, so a shared line stays unmarked while a change carries its side's colour. */
const CELL_CLASS: Record<SplitDiffCell['kind'], string | undefined> = {
  del: css.del,
  add: css.add,
  context: css.context,
  empty: css.empty,
}

/** Local exhaustiveness helper for the closed row union. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable split diff row kind: ${String(value)}`)
}

/** One row of the comparison: a header spanning both columns, or the two sides of one band. */
function SplitRow({ row, anchor }: { row: SplitDiffRow; anchor: boolean }) {
  switch (row.kind) {
    case 'path':
      return <div className={clsx(css.row, css.path)} data-split-row="path" data-diff-hunk={row.hunk}>{row.text}</div>
    case 'gap':
      return <div className={clsx(css.row, css.gap)} data-split-row="gap" data-diff-hunk={row.hunk}>⋯</div>
    case 'pair':
      return (
        // The band itself has no box to measure (`display: contents`), so the
        // cell that starts it carries the mark a whole-file reader lands on.
        <div className={css.row} data-split-row="pair" data-diff-hunk={row.hunk}>
          <div
            className={clsx(css.cell, CELL_CLASS[row.left.kind])}
            data-split-side="old"
            data-split-change-start={anchor ? '' : undefined}
          >
            {row.left.kind === 'empty' ? '' : row.left.text}
          </div>
          <div className={clsx(css.cell, CELL_CLASS[row.right.kind])} data-split-side="new">
            {row.right.kind === 'empty' ? '' : row.right.text}
          </div>
        </div>
      )
    /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
    default: return assertNever(row)
  }
}

/**
 * Render a file mutation as an inline two-column comparison.
 * @param props - see {@link DiffSplitBlockProps}.
 * @returns the comparison element.
 */
export function DiffSplitBlock({ diffs, labels, maxLines = DEFAULT_DIFF_MAX_LINES, className, fileLines }: DiffSplitBlockProps) {
  const { rows, added, removed, files } = useMemo(() => buildSplitRows(diffs), [diffs])
  // The reader may ask for the change inside the file it landed in; a hunk the
  // file cannot account for keeps the change-only body.
  const wholeFile = useMemo(
    () => fileLines === undefined ? null : buildFileSplitRows(diffs, fileLines),
    [diffs, fileLines],
  )
  const body = wholeFile ?? rows
  // Copying keeps the unified form: one clipboard text for both layouts, and
  // the form a patch reader expects.
  const copyRows = useMemo(() => buildDiffRows(diffs).rows, [diffs])
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyDiffText(copyRows)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, copyRows])

  const onToggle = useCallback(() => { setExpanded(value => !value) }, [])

  if (body.length === 0) return null

  const hidden = body.length - maxLines
  const capped = hidden > 0 && !expanded
  const headRows = Math.ceil(maxLines / 2)
  const tailRows = maxLines - headRows
  const head = capped ? body.slice(0, headRows) : body
  const tail = capped ? body.slice(body.length - tailRows) : []
  // The band a whole-file reader lands on: the first one carrying a change. A
  // change-only body needs no mark, because it opens on the change. Compared by
  // row identity, so the mark follows the band into either end of a capped body.
  const anchor = wholeFile === null
    ? undefined
    : wholeFile.find(row => row.kind === 'pair' && (row.left.kind === 'del' || row.right.kind === 'add'))

  return (
    <div className={clsx(css.block, className)} data-diff="" data-diff-layout="split">
      <button type="button" className={css.copyButton} onClick={onCopy}>
        {copied ? labels.copied : labels.copy}
      </button>
      <div className={css.body}>
        {head.map((row, index) => <SplitRow key={index} row={row} anchor={row === anchor} />)}
        {hidden > 0 && (
          <FoldToggle
            className={css.expand}
            expanded={expanded}
            hidden={hidden}
            labels={labels}
            onToggle={onToggle}
          />
        )}
        {tail.map((row, index) => <SplitRow key={index} row={row} anchor={row === anchor} />)}
      </div>
      <div className={css.footer}>└ +{added} -{removed} · {labels.files(files)}</div>
    </div>
  )
}
