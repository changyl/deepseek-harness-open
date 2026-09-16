/**
 * The file-change hunks a diff surface renders, their narrowing, and the row
 * shapes the two diff layouts draw: one column of prefixed lines, or the old
 * and new sides of the same band paired into two columns.
 *
 * A surface that knows the changed file's language passes a {@link DiffHighlighter}
 * and every body row then carries the grammar's token runs for its own text, so a
 * diff reads with the same colors as the file it changes. Tokenizing a whole side
 * rather than one line at a time is what lets a change inside a block comment or
 * a template literal keep the context that colorizes it.
 *
 * The type is declared here rather than beside either surface so a pure model
 * can validate durable result metadata without importing a component module.
 * @module
 */
import type { HighlightSpan } from './markdown/highlight.ts'

/**
 * One file change in the form the diff surfaces render. It is declared here so
 * this module stays independent of the tool contract.
 */
export interface DiffHunk {
  /** The changed file's path, drawn verbatim as the hunk's header (the tool's model-facing path). */
  path: string
  /** Prior content, or `null` for a new file / an overwrite (nothing on the removed side). */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
  /**
   * 1-based line of the file's new text where `newText` begins. A producer that
   * diffed two full texts records it, which lets a surface place the change
   * among the file's unchanged lines; a call-time intended diff omits it.
   */
  newStart?: number | undefined
}

/**
 * Narrow an opaque `diffs` payload to well-formed hunks.
 *
 * The payload crosses a durable boundary (`tool/result` metadata), so every
 * member is validated and one malformed entry rejects the whole payload: a
 * partially trusted diff would misreport the change.
 * @param value - the candidate `diffs` field.
 * @returns the validated hunks, or null when the payload is empty or unusable.
 */
export function narrowDiffHunks(value: unknown): DiffHunk[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const hunks: DiffHunk[] = []
  for (const hunk of value) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText, newStart } = hunk as Record<string, unknown>
    if (typeof path !== 'string') return null
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    // Absent in a payload written before hunks carried a position, and in a
    // call-time intended diff, which has no resulting line to name.
    if (newStart !== undefined
      && (typeof newStart !== 'number' || !Number.isInteger(newStart) || newStart < 0)) return null
    hunks.push({ path, oldText, newText, ...newStart === undefined ? {} : { newStart } })
  }
  return hunks
}

/**
 * Tokenize one side's complete text into one run list per source line, in the
 * same order and with the same line count as {@link contentLines}. `undefined`
 * means that side renders plain — an unknown language, a grammar that has not
 * loaded yet, or a caller that supplies no highlighter at all.
 */
export type DiffHighlighter = (text: string) => readonly (readonly HighlightSpan[])[] | undefined

/** The runs a tokenized side holds for one line, spread onto the row that draws it. */
function spansOf(
  runs: readonly (readonly HighlightSpan[])[] | undefined,
  index: number,
): { spans?: readonly HighlightSpan[] | undefined } {
  const spans = runs?.[index]
  return spans === undefined ? {} : { spans }
}

/**
 * Split a side's text into its content lines. Empty text is zero lines (a full
 * deletion's `newText` or a create's absent `oldText` side draws nothing), and a
 * single trailing newline is a line terminator rather than an extra empty line —
 * the same terminator rule TerminalBlock applies to command output. An interior
 * blank line (a genuine `\n\n`) survives.
 * @param text - the removed or added side's text.
 * @returns the content lines, without the terminating newline.
 */
export function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Total added/removed line counts across hunks — the same numbers a footer
 * prints, exported so a summary row can show them without rebuilding a body.
 * Every old-side line counts toward `removed` and every new-side line toward
 * `added`, under {@link contentLines}'s terminator rule.
 * @param diffs - the hunks to count.
 * @returns the +/- totals.
 */
export function diffTotals(diffs: readonly DiffHunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    if (diff.oldText !== null) removed += contentLines(diff.oldText).length
    added += contentLines(diff.newText).length
  }
  return { added, removed }
}

/** A single rendered unified body line and its role, so a height cap slices a flat list. */
export interface DiffRow {
  kind: 'path' | 'del' | 'add' | 'gap'
  text: string
  /**
   * 0-based hunk this row opens, on the header or gap row that starts one. A
   * reader jumps between changes by scrolling to these rows.
   */
  hunk?: number | undefined
  /** The grammar's runs for {@link text}, absent when the row draws its text plain. */
  spans?: readonly HighlightSpan[] | undefined
}

/** Local exhaustiveness helper — this package does not depend on `dsh-llm`. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a row kind is forged */
function assertNever(value: never): never {
  throw new Error(`unreachable diff row kind: ${String(value)}`)
}

/**
 * Walk the hunks into one row list, emitting each hunk's file boundary before
 * its body: a path header, or a `⋯` gap when the previous hunk was the same
 * file (a scattered edit). The distinct-path count is the same number both
 * bodies' footers print.
 * @param diffs - the hunks to walk.
 * @param header - the row opening a new file.
 * @param gap - the row opening a same-file second hunk.
 * @param body - the rows one hunk contributes.
 * @returns the rows and the distinct-file count.
 */
function walkHunks<Row>(
  diffs: readonly DiffHunk[],
  header: (path: string, hunk: number) => Row,
  gap: (hunk: number) => Row,
  body: (diff: DiffHunk) => Row[],
): { rows: Row[]; files: number } {
  const rows: Row[] = []
  const paths = new Set<string>()
  let prevPath: string | undefined
  for (const [hunk, diff] of diffs.entries()) {
    paths.add(diff.path)
    rows.push(diff.path !== prevPath ? header(diff.path, hunk) : gap(hunk))
    prevPath = diff.path
    rows.push(...body(diff))
  }
  return { rows, files: paths.size }
}

/**
 * Flatten the hunks into the unified body's rows plus the footer counts. A path
 * header opens each new file; a same-file second hunk (a scattered edit) opens
 * with a `⋯` gap instead of repeating the path. The +/- totals are
 * {@link diffTotals}'s. The file count is of DISTINCT paths, matching the TUI
 * diff card's footer, so two hunks in one file read as `1 file` on both front
 * ends.
 * @param diffs - the hunks to render.
 * @param highlight - tokenizes one side's complete text; absent renders every row plain.
 * @returns the body rows, the +/- totals, and the distinct-file count.
 */
export function buildDiffRows(
  diffs: readonly DiffHunk[],
  highlight?: DiffHighlighter,
): { rows: DiffRow[]; added: number; removed: number; files: number } {
  const { rows, files } = walkHunks<DiffRow>(
    diffs,
    (path, hunk): DiffRow => ({ kind: 'path', text: path, hunk }),
    (hunk): DiffRow => ({ kind: 'gap', text: '⋯', hunk }),
    (diff): DiffRow[] => {
      const oldRuns = diff.oldText === null ? undefined : highlight?.(diff.oldText)
      const newRuns = highlight?.(diff.newText)
      return [
        ...(diff.oldText === null
          ? []
          : contentLines(diff.oldText).map((text, line): DiffRow => ({ kind: 'del', text, ...spansOf(oldRuns, line) }))),
        ...contentLines(diff.newText).map((text, line): DiffRow => ({ kind: 'add', text, ...spansOf(newRuns, line) })),
      ]
    },
  )
  return { rows, ...diffTotals(diffs), files }
}

/**
 * The diff text a reader copies: each row's `-`/`+`/path/gap prefix and its
 * content, exactly what the unified body shows. The removed and added blocks
 * are the change; the path headers keep a multi-file copy attributable. A split
 * body copies this same text, so one clipboard form serves both layouts.
 * @param rows - the unified body rows.
 * @returns the diff as plain text.
 */
export function copyDiffText(rows: readonly DiffRow[]): string {
  return rows.map((row) => {
    switch (row.kind) {
      case 'del': return `- ${row.text}`
      case 'add': return `+ ${row.text}`
      case 'path': return row.text
      case 'gap': return row.text
      /* v8 ignore next -- closed-union backstop; only reached if a row kind is forged */
      default: return assertNever(row.kind)
    }
  }).join('\n')
}

/** One side of a split row: a removed, added, or shared line, or the padding opposite a one-sided change. */
export type SplitDiffCell =
  | { readonly kind: 'del'; readonly text: string; readonly spans?: readonly HighlightSpan[] | undefined }
  | { readonly kind: 'add'; readonly text: string; readonly spans?: readonly HighlightSpan[] | undefined }
  | { readonly kind: 'context'; readonly text: string; readonly spans?: readonly HighlightSpan[] | undefined }
  | { readonly kind: 'empty' }

/** One split row: a file header, a same-file gap, or the old and new sides of one line band. */
export type SplitDiffRow =
  | { readonly kind: 'path'; readonly text: string; readonly hunk?: number | undefined }
  | { readonly kind: 'gap'; readonly hunk?: number | undefined }
  | { readonly kind: 'pair'; readonly left: SplitDiffCell; readonly right: SplitDiffCell; readonly hunk?: number | undefined }

/**
 * Pair one hunk's two sides line by line.
 *
 * The shared prefix and suffix are the context both sides carry; what remains
 * between them is the change, paired by position so the old column and the new
 * column describe the same band. A one-sided remainder — an insert or a delete —
 * is padded with an empty cell opposite it, which keeps every following row
 * aligned. A hunk is one contiguous change region, so this decomposition is
 * exact rather than an approximation of a larger alignment.
 * @param oldText - the removed side, or null for a create.
 * @param newText - the added side.
 * @param highlight - tokenizes one side's complete text; absent renders every cell plain.
 * @returns the hunk's paired rows in reading order.
 */
function pairSides(oldText: string | null, newText: string, highlight?: DiffHighlighter): SplitDiffRow[] {
  const oldLines = oldText === null ? [] : contentLines(oldText)
  const newLines = contentLines(newText)
  // Tokenizing the whole side is what keeps a shared line's own context — a
  // comment still open, a string still running — colored on both columns.
  const oldRuns = oldText === null ? undefined : highlight?.(oldText)
  const newRuns = highlight?.(newText)
  let prefix = 0
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const rows: SplitDiffRow[] = []
  for (const [line, text] of oldLines.slice(0, prefix).entries()) {
    rows.push({
      kind: 'pair',
      left: { kind: 'context', text, ...spansOf(oldRuns, line) },
      right: { kind: 'context', text, ...spansOf(newRuns, line) },
    })
  }
  const removed = oldLines.slice(prefix, oldLines.length - suffix)
  const added = newLines.slice(prefix, newLines.length - suffix)
  for (let index = 0; index < Math.max(removed.length, added.length); index += 1) {
    const removedLine = removed[index]
    const addedLine = added[index]
    rows.push({
      kind: 'pair',
      left: removedLine === undefined
        ? { kind: 'empty' }
        : { kind: 'del', text: removedLine, ...spansOf(oldRuns, prefix + index) },
      right: addedLine === undefined
        ? { kind: 'empty' }
        : { kind: 'add', text: addedLine, ...spansOf(newRuns, prefix + index) },
    })
  }
  for (let index = suffix; index > 0; index -= 1) {
    /* v8 ignore next 4 -- both sides are at least `suffix` lines long, so neither read is out of range */
    rows.push({
      kind: 'pair',
      left: { kind: 'context', text: oldLines[oldLines.length - index] ?? '', ...spansOf(oldRuns, oldLines.length - index) },
      right: { kind: 'context', text: newLines[newLines.length - index] ?? '', ...spansOf(newRuns, newLines.length - index) },
    })
  }
  return rows
}

/**
 * Flatten the hunks into the split body's rows plus the footer counts: the same
 * headers, gaps, and totals {@link buildDiffRows} produces, with each hunk's
 * sides paired instead of stacked.
 * @param diffs - the hunks to render.
 * @param highlight - tokenizes one side's complete text; absent renders every cell plain.
 * @returns the paired rows, the +/- totals, and the distinct-file count.
 */
export function buildSplitRows(
  diffs: readonly DiffHunk[],
  highlight?: DiffHighlighter,
): { rows: SplitDiffRow[]; added: number; removed: number; files: number } {
  const { rows, files } = walkHunks<SplitDiffRow>(
    diffs,
    (path, hunk): SplitDiffRow => ({ kind: 'path', text: path, hunk }),
    (hunk): SplitDiffRow => ({ kind: 'gap', hunk }),
    diff => pairSides(diff.oldText, diff.newText, highlight),
  )
  return { rows, ...diffTotals(diffs), files }
}

/**
 * The shared row both columns draw for one line the change left alone, carrying
 * that line's own runs from the file the two sides are drawn over.
 * @param text - the unchanged line.
 * @param line - its 0-based index in the file.
 * @param fileRuns - the file's tokenized lines, or undefined for a plain body.
 * @returns the paired context row.
 */
function contextPair(text: string, line: number, fileRuns: readonly (readonly HighlightSpan[])[] | undefined): SplitDiffRow {
  return {
    kind: 'pair',
    left: { kind: 'context', text, ...spansOf(fileRuns, line) },
    right: { kind: 'context', text, ...spansOf(fileRuns, line) },
  }
}

/**
 * The one place a hunk's lines occupy in the file at or after `from`, or null
 * when they sit nowhere there or in more than one place.
 * @param fileLines - the file's new text, one entry per line.
 * @param covered - the hunk's new-side lines, in order.
 * @param from - the first line the search may start on.
 * @returns the 0-based start line, or null when the text is absent or ambiguous.
 */
function locateHunk(fileLines: readonly string[], covered: readonly string[], from: number): number | null {
  // A new side with no lines names no place: any start would be a guess.
  if (covered.length === 0) return null
  let found: number | null = null
  for (let start = from; start + covered.length <= fileLines.length; start += 1) {
    if (!covered.every((line, offset) => fileLines[start + offset] === line)) continue
    // A second occurrence makes the placement a guess, so neither is used.
    if (found !== null) return null
    found = start
  }
  return found
}

/**
 * Draw one file's hunks in place among the file's own lines: every line of the
 * new text appears in both columns — unchanged lines shared, each change region
 * paired as {@link buildSplitRows} pairs it.
 *
 * A hunk is placed at its recorded `newStart`; a hunk that records none — one
 * from a `tool/result` written before hunks carried a line, or a call-time
 * intended change — is placed by its own text when the file holds that text
 * exactly once. A hunk from another file, one whose text is absent or
 * ambiguous, or one the file no longer accounts for yields null instead of a
 * misplaced body; the caller then keeps the change-only comparison.
 * @param diffs - one file's hunks, in file order.
 * @param fileLines - the file's new text, one entry per line.
 * @param highlight - tokenizes the file's own text; absent renders every context cell plain.
 * @returns the whole-file rows, or null when the hunks cannot be placed in it.
 */
export function buildFileSplitRows(
  diffs: readonly DiffHunk[],
  fileLines: readonly string[],
  highlight?: DiffHighlighter,
): SplitDiffRow[] | null {
  const path = diffs[0]?.path
  if (path === undefined) return null
  const fileRuns = highlight?.(fileLines.join('\n'))
  const rows: SplitDiffRow[] = [{ kind: 'path', text: path }]
  // The next line of the file no row has drawn yet, as a 0-based index.
  let cursor = 0
  for (const [hunk, diff] of diffs.entries()) {
    if (diff.path !== path) return null
    const covered = contentLines(diff.newText)
    const { newStart } = diff
    if (newStart !== undefined && newStart < 1) return null
    const start = newStart === undefined ? locateHunk(fileLines, covered, cursor) : newStart - 1
    if (start === null || start < cursor || start + covered.length > fileLines.length) return null
    if (covered.some((line, offset) => fileLines[start + offset] !== line)) return null
    for (const [offset, text] of fileLines.slice(cursor, start).entries()) {
      rows.push(contextPair(text, cursor + offset, fileRuns))
    }
    const changed = pairSides(diff.oldText, diff.newText, highlight)
    // The change's first row is where a reader jumps to; the rest carry no marker.
    if (changed.length > 0) changed[0] = { ...changed[0] as SplitDiffRow, hunk }
    rows.push(...changed)
    cursor = start + covered.length
  }
  for (const [offset, text] of fileLines.slice(cursor).entries()) {
    rows.push(contextPair(text, cursor + offset, fileRuns))
  }
  return rows
}
