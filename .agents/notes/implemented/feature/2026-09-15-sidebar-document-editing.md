# Agent Note: Editing text documents from the right Sidebar

Status: implemented

English | [中文](2026-09-15-sidebar-document-editing.zh.md)

## Problem

The right Sidebar previewed files and could not change them. A Markdown file the Agent had just written — or one the reader wanted the Agent to work from — could be read, searched, and compared against a Turn's change, but the smallest correction meant leaving the product for an external editor and coming back. The preview's own change review could revert a whole Turn change; nothing could edit a line.

The preview was also the wrong shape for editing in one specific way that had to be settled before anything else. Its content arrives as pages of lines, and a page is a lossy view: `cutPage` joins the lines it kept back together, so a file ending in a newline and one that does not produce identical text. Any editor seeded from the pages would write back a file whose final newline had quietly vanished — a silent data loss on the first save, in the exact workflow the feature exists to serve.

## Decision

The `text` tab type now carries an editing session, and the file service grew the one mutation that backs it.

[`@deepseek-ai/dsh-api-workspace-files`](../../../../packages/api/workspace-files/README.md) exposes `workspaceFiles.write`: a whole-file replacement with an optional version guard, returning the new version, whether it created or updated the file, and the content it replaced. [`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`](../../../../packages/client/ui-sidebar-documentpreview/README.md) gains `TextEditor`, an `editable` capability on document renderer definitions, and an edit session in its store and face.

### The draft is read whole, never assembled from the pages

`openDraft` reads the file through `workspaceFiles.readAll` and decodes it with `TextDecoder('utf-8', { ignoreBOM: true })`. The whole-file read is what makes a save non-destructive: the draft is the file, so a reader who types one character and saves writes back the same bytes plus that character. `ignoreBOM` is deliberate — the default decoder strips a leading byte-order mark, which would delete it on the first save. CRLF endings survive for the same reason: nothing normalizes the text on the way through.

The paged read is untouched. The editor and the preview read the same file along two different paths, and the `pages` the preview holds never seed the draft.

### The save is guarded by the version the draft came from

The draft carries the `version` the whole-file read reported, and a save sends it as `expectedVersion`. The Host brands it back onto the filesystem's opaque token and refuses a file that moved on with `workspace-file/stale-version`; nothing is written and no merge is attempted. The editor reports that refusal as a **conflict** — the one failure with a decision attached — and offers exactly two ways out: **overwrite**, which saves with the guard omitted, and **discard and reload**, which reads the file whole again and adopts the other writer's version.

Only the conflict path travels without a guard. Every other refusal — a read-only Session, a Session that has gone cold, a backend failure — is reported as a plain failure with the draft and its baseline untouched, because retrying it unchanged is the only sensible next step.

A save does not close the session and does not write the draft back on settlement. A reader who keeps typing while the write is in flight holds newer text than the file does, so the accepted write becomes the clean *baseline* and the newer keystrokes correctly leave the tab dirty again.

### The Host gates the write on a live Session and a writable policy

`write` is the service's only mutation, and it is gated twice beyond the read gates. The Session must be **live** — a cold Session has no policy override to resolve, and the service fails closed rather than falling back to a deployment default. The resolved sandbox policy must then permit writing at all; `read-only` refuses. Neither check consults the Client, and the escalation vocabulary the Agent's own write tools carry has no counterpart on the wire, so a browser cannot ask for a wider mode than its Session already has.

The capability gate runs **before** the path gates, so a refusal resolves nothing and the endpoint cannot be used as a path oracle by a caller it is about to refuse. The read gates then apply unchanged: the path has to exist, be a regular file, and pass the service's ordinary containment and symlink handling. A successful write emits the same `fs/observed` observation a tool write does, so every open `changes` generation learns of it.

### Editing is declared by the renderer, not inferred from its loading mode

`DocumentPreviewDefinition` gains `editable`, and the plain-text, Markdown, and code renderers set it. It is stated rather than derived from `loading: 'text-pages'`, because a paged renderer is not automatically a text one and only an implementation that knows its file is UTF-8 text should offer to write it back. The HTML, image, and PDF renderers load complete bytes and offer no editing.

### Narrow shows one view; fullscreen shows both

While the pane is narrow the editor takes the column and the preview is **hidden, not unmounted**, so the body's scroller keeps the reader's place and a return to the preview is instant. Once the pane is fullscreen the two share the column at a fixed half each — no divider to drag, so neither side can be left in a size the reader cannot undo. The preview half keeps paging to the end of the file behind the editor, through the same effect the side-by-side change comparison already used.

Leaving the editor is a control, and a dirty draft guards it: the preview toggle is disabled until the reader has saved or explicitly discarded. The unsaved mark sits beside the controls.

## Alternatives considered

**Seeding the draft from the loaded pages.** Rejected, and this is the decision the whole feature turns on: the paged text is lossy at the file's end, so the first save would strip a trailing newline that the reader never touched. Appending a newline when the file "looked like" it had one is not recoverable from the page data, because the page carries no such bit.

**A browser-side CodeMirror 6 editor.** Rejected, amending the plan that proposed it. CodeMirror is not a dependency of this repository, so adopting it means new packages in the browser bundle and a `pnpm-lock.yaml` change; it buys syntax colouring, line numbers, and bracket matching, none of which the editing contract needs, and it adds a second document model to keep in sync with the store. A plain `<textarea>` delivers the whole contract — a scrolling text surface whose value the owner keeps and whose every keystroke the owner hears — for no dependency at all. The upgrade stays cheap: `TextEditor` is a leaf behind a three-prop interface, so swapping the surface touches one file and neither the store nor the face.

**A patch or single-hunk edit instead of whole-file replacement.** Rejected: the editor's unit of work is the reader's buffer, so a whole-file write is what it actually holds, and `@deepseek-ai/dsh-fs` already exposes `editText` for callers that genuinely have a literal replacement.

**Letting the browser request a sandbox mode.** Rejected: the sandbox policy is resolved from the Session on the Host. A Client that could name a mode would be granting itself a capability, which is the one thing the seam exists to prevent.

**Autosave.** Rejected: the preview also watches the file for external change, so an autosaving editor would fight the Agent over the same file with no moment at which the reader chose a side. An explicit save is what makes the version guard meaningful and the conflict resolvable.

**A draggable split divider.** Rejected for now: it is a remembered layout preference per tab with its own persistence and reset affordance, and a fixed half satisfies the case the split exists for. The split is a CSS attribute on one element, so making it draggable later adds state rather than restructuring the layout.

## Consequences

A reader can now correct a Markdown file — or any text, code, or plain-text file — in the pane they were already reading, and see the result in the preview beside it, without leaving the product. The Agent's own writes and the reader's are ordered by one version token: whichever writes second is refused and asked, rather than silently winning.

The costs are recorded in the package READMEs. Editing is whole-file only, so a very large file is bounded by the service's `maxFileBytes` cap (32 MiB by default) and by what a `<textarea>` can hold comfortably — the paged preview keeps working for files the editor will not open. There is no syntax highlighting, no line numbers, and no multi-cursor. The draft lives in the tab's store, so it survives switching tabs but not reloading the page, and closing the tab discards it without asking. The editor writes UTF-8: a file the paged read accepted as text is round-tripped byte-for-byte, but the browser has no way to write a different encoding back.

Four suites pin the shipped path. `packages/api/workspace-files/tests/write.spec.ts` covers the Host method: the version guard, the forced overwrite, the read-only and cold-Session refusals, the gate ordering, the unchanged read gates, and the observation a write emits. `packages/client/ui-sidebar-documentpreview/tests/text-edit.client.spec.tsx` covers the reader's path through the real store and face: entering the editor, the dirty mark, the guard a save carries, both conflict resolutions, and the narrow and fullscreen layouts. `tests/face.client.spec.ts` covers the session's retirement rules — a draft read or a save that settles after the reader left writes nothing — and `tests/rpc.client.spec.ts` pins the whole-file decode, including the byte-order mark and CRLF endings a page read would have cost.
