---
description: "Document previews and text editing in the right Sidebar: shared file loading and controls, selectable Markdown, code, image, PDF and HTML renderers, plain-text fallback, and an editor for the renderers that declare themselves editable."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-documentpreview

English | [中文](README.zh.md)

## Summary

Preview readable files in the right Sidebar and choose among registered renderers without opening another tab. Markdown and code receive accumulated text pages; PDF, HTML, and common images receive complete bytes; unknown file extensions use plain text. Renderers declaring `editable` add an editing session: the draft is read whole, saves carry the version it came from, and a file that moved on is reported as a conflict instead of overwritten. The tab owns loading, file status, renderer selection, wrap, reload, and that session; document bodies register through the same metadata registry and child slot. The Sidebar tab kind is `text`.

## Table of Contents

- [What it registers](#what-it-registers)
- [Addresses](#addresses)
- [How it reads](#how-it-reads)
- [Editing](#editing)
- [Navigation](#navigation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="what-it-registers"></a>
## What it registers

- **The type** — `ctx.sidebarRightTabs.register(...)` with id `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` (this implementation's identity in the tab system, and the key its body registers under), kind `text`, pattern `dsh-resource://file/**`, band `fallback`. `canOpen` accepts only Session addresses, whose paths may be relative or absolute; bare `absolute` addresses are not claimed. A type registered at the `extension` or `builtin` band for a narrower pattern (say `*.png`) takes those addresses; other supported files land here. The whole address is the content identity, so two files with one name in different directories, or one path under two sessions, are two tabs; the decoded basename is the tab title, and the keyed `sidebar.right.pane.tab.title` seat places its extension-specific `FileTypeIcon` before that title.
- **The body** — the keyed `sidebar.right.pane.tab` seat under the type's id. Its fixed header shows the Host's absolute path when available, otherwise the requested path; directories use tertiary label colour, the name uses primary label colour, and a clipped path retains and fades toward its final segment while its tooltip exposes the full value. A dropdown selects among matching renderers and plain text. A wrap toggle appears only when the selected renderer declares `wrap: true`; its glyph describes the mode the click selects, and the per-tab preference starts on. When the tab's `file` navigation carries a `changeSeq` the change index answers for, two controls appear in this header and the body opens on that Turn change instead of the file. The first swaps between the change and the whole file; the second draws the change as a two-column comparison of the old and the new side, which is the layout a fullscreen pane has the width for. Both layouts draw the change with the grammar of the file's own extension — the same mapping the code renderer uses — so a changed source file reads with its syntax colours; an extension with no grammar keeps the plain body. The comparison shows the file's own lines once the read is complete and keeps paging it while it is selected, so the change appears where it sits in the file; a hunk the read cannot place keeps the change alone. A previous/next pair with the reader's position (`3/17`) steps through every region of the Turn's changes, not just this file's: at either end of a file it opens the neighbouring change — the previous file's last region stepping backwards — and it stops at the Turn's first and last region. Both layout controls are available in every pane size; a navigation to another change returns to the change, drawn in the layout the reader chose, which this session keeps for every change and for the tabs a step opens in another file. An unindexed or absent seq leaves the tab on the file, so the toggle is absent rather than disabled. Reload stays in this header, not the Sidebar's tab strip. The body reaches every pane edge; each renderer owns its content inset and may own an inner scrollport. This intentionally differs from the Files tab's 2px right-side scrollbar offset: previews keep the full pane width so edge-to-edge HTML and code scrollports end at the pane edge.
- **Shared loading and view state**, session-scoped and bucketed by tab id. The store holds accumulated pages or complete bytes, read and observed versions, loading/failure state, renderer choice, scroll offset, wrap, the answered navigation revision, and the one-column/two-column change layout the session keeps. The ordinary inject face calls Remote readers and writes through declared store actions. Reloads and loading-mode changes retire older requests; the tab's abort signal forgets its state.

Document implementations register metadata with `ctx.documentPreviews.register({ id, extensions, priority, title, loading, wrap? })` and a body under the same `id` in the keyed, Session-scoped `sidebar.right.tab.document` child slot. Own both registrations with effects and wait for the child slot through `ctx.slots.inject`. Bodies receive `resourceAddress`, prepared `content`, `wrap`, `scrollportRef`, and the standard `useTabInfo`/`useResource` hooks; they do not receive a custom resource loader. A renderer that owns an inner scrolling element attaches `scrollportRef` to it, and the owner returns to the shared body when that element unmounts. Metadata declares `loading: 'text-pages'` or `'bytes-complete'` and may declare `editable: true`; editing is stated rather than inferred from the loading mode, because a paged renderer is not automatically a text one. The registry retains all matching alternatives: `extension` (the default) ranks above `builtin`, then longer suffixes rank first, then registration order. The dropdown preserves a selected implementation while it remains available; removing it selects the next candidate. Builtin bodies use these same registrations.

<a id="addresses"></a>
## Addresses

A tab uses the Session address built by `fileAddressFor`, carrying a relative or absolute path. `hostFileOf(address)` takes the Session only from that address, with no external Session argument; neither current nor Tab Session is borrowed. The Host resolves file and related paths through the Session filesystem, whose backend controls read authority. Metadata for the same complete address is shared by every UI, including Global components. The [Workspace Files README](../../api/workspace-files/README.md) owns these rules; renderer selection does not change the navigation address.

<a id="how-it-reads"></a>
## How it reads

The body reads its record, navigation and lifetime through `useTabInfo().tab`. `useResource<'file'>(tab.contentId)` supplies metadata; ordinary inject callbacks supply content reads:

- The resource snapshot contains only `status`, `value`, and `failure`; `value` is `WorkspaceFileStat` metadata. Content reads do not wait for the first metadata frame once the provider is available. Observation failures take precedence over Preview's change notice; neither automatically replaces loaded content.
- **Text pages** — plain text, Markdown, and code read through an inject callback to `remote.workspaceFiles.read(sessionId, path, { offset }, signal)`. The first mount reads page one; scrolling to the body end or **Load more** requests the next page until `eof`. The owner delivers the accumulated prefix as `{ kind: 'text', text, pages, eof }`, including source offsets and line counts. Markdown and code render that prefix incrementally; they do not render each page as a separate document. A newer-version page past page one restarts from the beginning rather than mixing versions. A failure before any content fills the body with the file-type icon, explanation, and retry; a later failure retains loaded content and adds the retry below it.
- **Complete bytes** — PDF, HTML, and common images use an inject callback to `remote.workspaceFiles.readAll(sessionId, path, signal)`. `rpc.ts` decodes the wire base64 into `data: Uint8Array<ArrayBuffer>` for `{ kind: 'bytes', data }`. The Host's `maxFileBytes` cap rejects oversized files rather than truncating them. PDF copies retained bytes before worker transfer, keeping the Preview buffer usable. Bytes stay in transient view state, never persisted layouts or Session JSONL. Loading-mode changes retire previous results.
- **Editing** — a renderer that declares `editable` offers an **Edit** control in the header, subject to the [Editing](#editing) rules below.
- **Reload** — only the current Preview tab rereads through its Remote callbacks, preserving its scroll preference and retiring older requests. Its change notice compares the read version and the observation captured at read start with later `resource.value.version`; an already observed version does not become a new change after refresh. Reads neither refresh shared metadata nor clear another tab's notice.

HTML fills the body edge to edge in a Blob iframe with exactly `sandbox="allow-scripts"`, without `allow-same-origin`; scripts cannot access the parent application's origin or file reader. The renderer loads directly declared relative `.js` classic scripts and `.css` stylesheets through its ordinary inject callback to `remote.workspaceFiles.readRelated`, with fixed safety limits of 4 MiB per asset, 32 MiB total, and 64 distinct assets. Host code resolves the related path; `rpc.ts` decodes the returned bytes. Inside the renderer, base64 is used only to embed the iframe bootstrap payload in script text. A `<base href>` leaves dependency resolution to the browser, as do HTTPS resources. Local module imports, CSS `url()`/`@import`, and dynamic `fetch` do not use Host file access. Read failures, invalid UTF-8, or exceeded limits fail the preview rather than publishing a partial asset package. Replacing or unmounting the document releases its Blob URL.

PNG, JPEG, GIF, WebP, BMP, ICO, and SVG render through Blob URLs in an `<img>` static-image context. The image keeps its intrinsic CSS-pixel dimensions; a smaller image centres in the shared scroller, and larger dimensions scroll on either axis. The renderer provides neither zoom nor drag-to-pan. SVG markup never enters the application DOM or an iframe, so its scripts cannot execute or reach the parent page. Replacing or unmounting the image revokes its Blob URL.

Shared copy comes from `sidebarDocumentPreview`; each builtin renderer owns its localized labels.

Initial reads, additional pages, and HTML/PDF/image preparation share a loading indicator that respects reduced-motion preferences. Loaded pages stay visible while another page loads. PDF pages form one vertical, width-fitted sequence and render lazily near the viewport. Code previews show source line numbers by default without including them in copied text; plain text uses the same font size and line height as code. Code sits on the pane's own background rather than the chat card's fill; its banner is adjacent to a full-height inner scrollport, so both scrollbars begin below the copy control.

<a id="editing"></a>
## Editing

The plain-text, Markdown, and code renderers declare `editable: true`; the complete-byte renderers do not, so the control is absent rather than disabled. Editing is offered only for a Session file address while the tab shows the whole file, and only once the paged read has accepted the file as text.

Entering the editor reads the file a second way. `openDraft` calls `remote.workspaceFiles.readAll(sessionId, path, signal)` and decodes it with `TextDecoder('utf-8', { ignoreBOM: true })`, because a page is a lossy view of the file: the paged `text` is its lines joined back together, so a file ending in a newline and one that does not arrive identical. Seeding an editor from the pages would strip that newline on the first save. The whole-file read keeps the draft byte-faithful, including a leading byte-order mark and CRLF endings, neither of which any step normalizes. The paged preview keeps its own read path and its own state; the draft never feeds it and it never feeds the draft.

The session is one object per tab holding the draft, the baseline it is compared against, the version it was read from, and its saving, failure, and conflict state. A tab is dirty while the draft differs from that baseline, and the **Save** control is enabled only then. Saving calls `remote.workspaceFiles.write(sessionId, path, { text, expectedVersion }, signal)` with the version the draft came from. The Host refuses a file that moved on with `workspace-file/stale-version` and writes nothing; the editor reports that as a conflict and offers exactly two resolutions: **Overwrite**, which saves with `expectedVersion` omitted, and **Discard and reload**, which re-reads the file whole and adopts what the other writer left. Every other refusal — `workspace-file/read-only`, `workspace-file/session-not-live`, a backend failure — is reported as a plain failure with the draft and its baseline intact. An accepted save makes the written text the new baseline and the returned version the next guard, and leaves the session open; it deliberately does not write the draft back, so keystrokes typed while the save was in flight leave the tab dirty again rather than being discarded. A save also reloads the preview behind the editor, which still describes the file as it was.

While the pane is narrow the editor takes the column and the preview is hidden rather than unmounted, so the body's scroller keeps the reader's place. Once the pane is fullscreen the two share the column at a fixed half each, and the preview half keeps paging to the end of the file. The preview control that leaves the editor is disabled while the draft is dirty, so leaving cannot silently discard it; **Discard changes** is the control that says so.

The editor's surface is a plain `<textarea>`: it holds no document model of its own, so the store stays the single source of the draft. It writes UTF-8 only, and its draft lives in the tab's store, so switching tabs keeps it and reloading the page does not.

<a id="navigation"></a>
## Navigation

`ctx.sidebarRight.openResource(address, { params: { line, changeSeq } })` carries a 1-based source line and a Turn change's `tool/result` seq through the `file` parameters. The change reads through the optional `sessionFileChanges` service the deliverables plugin provides; a composition without it answers no change and every tab stays on the file. In `text-pages` mode, the owner loads sequential pages until that line or EOF. Plain-text and code renderers expose source-line anchors; Markdown does not. A navigation remains pending while its selected renderer has no anchor and runs if the user switches to plain text or code. Code navigation scrolls the inner source viewport directly. Byte-mode renderers do not consume source-line navigation. Each completed navigation revision is answered once. Opening the same file without `revealIfOpened: false` focuses its existing tab and delivers a new revision.

<a id="model-experience"></a>
## Model Experience

None, as the preview is a browser-only viewer that registers no tool, prompt section, or session event.

#### KV Cache effect

No direct effect; what the user reads here never enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>
- **No shared search interface.** A directory address fails with `not-regular-file`, and unknown extensions use the plain-text reader and remain subject to its UTF-8/NUL checks.
- **Editing is whole-file, plain, and UTF-8.** Only the renderers that declare `editable` offer it, a file must be a regular Session file the paged read already accepted as text, and the whole file must fit the Host's `maxFileBytes` cap. The surface is a plain `<textarea>`: no syntax highlighting, line numbers, or multi-cursor. A file in another encoding is not round-tripped, because the browser writes UTF-8 back.
- **A draft is not durable.** It lives in the tab's store, so it survives switching tabs and a renderer change, but not a page reload, and closing the tab discards it without asking. There is no autosave: the version guard and the conflict prompt depend on the reader choosing when to write.
- **Sequential text and bounded complete files.** Deep source lines require the preceding pages; PDF, HTML, and images require a complete result within the Host's `maxFileBytes` cap.
- **Byte-view scroll state is not restored.** PDF, HTML, and images can return to the top when their renderer remounts or reloads; image horizontal position is never restored, and HTML iframe scrolling belongs to its opaque browsing context.
- **Finite local HTML dependencies.** Only direct classic `.js` and stylesheet `.css` references are packed. Browser-resolved resources retain browser origin and network restrictions; no runtime file-read bridge is exposed to the iframe.
- **Package-local wrap glyphs.** `IconWrapFill16` and `IconNowrapFill16` live in `src/client/icons.tsx` until the shared icon set carries them; their props already match the shared icon contract.
- **Scroll writes are unthrottled.** Every scroll event records its offset in the store; the line blocks are memoized so the resulting re-render hands React the same elements back.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Renderer metadata, document loading, and view state belong to the local registry and declared Slot stores, with no independent runtime source to compare against; registration disposal and tab lifetimes are covered by behavior tests.
