# Agent Note: Rendering Sidebar diffs with the changed file's own grammar

Status: implemented

English | [中文](2026-09-16-language-aware-sidebar-diffs.zh.md)

## Problem

Opening a Turn change in the right Sidebar drew it as one flat block of monospace text: `DiffBlock` and `DiffSplitBlock` printed each hunk's removed and added lines in the row's own red/green tone and nothing else. The same pane renders the file itself through the code renderer, which selects a Shiki grammar from the path's extension — so a change to a `.ts` file was syntax-coloured source while the reader was reading the file and became an undifferentiated wall of red and green the moment the reader asked what had changed. The one view where the code has to be read carefully was the one view that did not colour it.

## Decision

`DiffBlock` and `DiffSplitBlock` take an optional `lang`, and the Sidebar's `text` tab passes the language its own path maps to through the existing `languageForPath`.

### The runs are built in the row model, not in the components

`diff-hunks.ts` gains `DiffHighlighter` — one function from a side's text to its per-line runs, or `undefined` — and threads it through `buildDiffRows`, `buildSplitRows`, and `buildFileSplitRows`. Each `DiffRow` and `SplitDiffCell` then carries the optional `spans` for its own text, and the two components only decide whether to draw them. Highlighting therefore lands on the rows the layouts already computed, including the unchanged lines the whole-file comparison draws from the file, and a hunk's rows cannot drift out of step with the tokens describing them while the height cap slices the body.

### Each side's whole text is tokenized once

TextMate tokenization is line-based and forward-only, so tokenizing a diff line by line would restart the grammar at every boundary and lose a comment or a string that is still open. The builders call the highlighter once per side (`oldText`, `newText`) and once for the whole file, then index the resulting per-line runs by the same line numbers `contentLines` and `fileLines` use. A grammar that reports fewer lines than a side has leaves those rows plain rather than dropping their text.

### Highlighting is lazy, viewport-gated, and additive

Both surfaces use the existing `useViewportHighlighting` gate and the `subscribeGrammarLoaded`/`grammarLoadCount` re-render, exactly as `CodeBlock` and `ReadBlock` do: an offscreen card pays nothing, and a lazy grammar's first render is the same plain text it always was until the grammar registers. `lang` is optional, so a caller that does not pass it — today the chat tool cards — builds no runs and renders what it rendered before.

### The side of the change moves to a tinted band

Shiki's runs carry inline colours, which would override the `.del`/`.add` text tones and leave a syntax-coloured line with no indication of which side it belongs to. While highlighting is active the block sets `data-diff-highlight`, removed and added rows take a tinted background (`color-mix` over the error and success tokens the text tone used), and the `- `/`+ ` prefix keeps its own colour, so the side of a change never depends on the syntax palette. A unified row is `width: max-content` with `min-width: 100%`, so its band follows a long line past the body's edge instead of stopping at the scrollport.

## Alternatives considered

**Drawing the change through the file's registered document renderer.** Rejected: the reader is looking at a change, not a file, and the renderers that own a file's presentation (Markdown, image, PDF) would replace the diff altogether rather than colour it.

**Reusing `CodeBlock` for the diff body.** Rejected: the diff body is rows with a side, a hunk anchor, a height cap, and a copy form, none of which `CodeBlock` has; wrapping it would leave the surfaces sharing a component neither owns. What they genuinely share is the grammar, and that is what they now share.

**Tokenizing one line at a time.** Rejected for the reason above: it is cheaper but wrong inside multi-line constructs, which is exactly where a change is hardest to read.

**Keeping the red/green text and adding highlighting only where a token has no colour.** Rejected: it produces a line whose colour means "changed" in one run and "keyword" in the next, with no rule a reader can learn.

**Moving the path-to-language map into `ui-primitives` so the chat diff cards highlight too.** Deferred: it would add a value export to a package whose export list needs sign-off, and the chat card's job is a bounded summary of a call inside the message flow rather than a reading surface. The primitive takes `lang`; a caller that owns a language map can pass one.

## Consequences

A changed source file now reads in the Sidebar with the same colours as the file's own preview, in both the one-column change and the two-column comparison, and an extension with no grammar is unchanged.

`DiffBlock` and `DiffSplitBlock` gained one optional prop and one rendering branch; the chat tool cards, which do not pass it, are byte-for-byte unaffected. The tint is a new visual state gated entirely on `data-diff-highlight`, so the plain diff keeps the exact tone it had.

Four suites pin the shipped path. `packages/client/ui-primitives/tests/diff-block.client.spec.tsx` and `diff-split-block.client.spec.tsx` cover the row builders with and without a highlighter — including a side the highlighter leaves partly uncovered — and both surfaces with a real grammar, with an unknown language, and with none. `packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx` pins the wiring: a change on a `.md` tab is drawn by the Markdown grammar the tab's own path selects.
