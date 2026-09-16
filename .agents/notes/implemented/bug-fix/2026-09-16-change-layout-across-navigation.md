# Agent Note: Change layout across Sidebar change navigation

Status: implemented

English | [中文](2026-09-16-change-layout-across-navigation.zh.md)

## Problem

The right Sidebar's text preview draws a Turn change in one column or in two. A reader who chose the two-column comparison and then walked the Turn with the previous/next controls fell back to one column at the first step that landed on another change: the body recorded the layout as `{ seq, mode }` and read it back only while the navigation still named the same `changeSeq`, so a step reset it by construction.

A step does more than change what the body draws. At either end of a file's regions it opens the neighbouring change, which may belong to another file, and the Sidebar de-duplicates an open by content identity: the same file re-navigates one tab, another file mints a new tab in the pane. A layout that has to survive the walk therefore cannot be held by the body component or by one tab.

## Decision

`TextState.changeLayout` (`'change' | 'split'`, default `'change'`) holds one session's comparison layout, written by the single store action `laidOut`. The pane-tab slot is session-scoped, so every file tab the walk opens reads that one field: the choice follows the reader across changes, files, tabs, body remounts, and renderer switches, and another session starts at one column.

The whole-file look stays per change. The body keeps a `{ seq }` record of the change that was swapped for the file, so a previous/next step still lands on a change — drawn in the session's layout — and the change/whole-file control keeps its meaning. Both header controls keep their labels, their pressed state, and their handling; only the column count persists.

## Alternatives considered

**Keep the layout per tab in the store, beside wrap and the scroll offset.** The smallest symmetrical change. Rejected because the step that opens the next change in another file mints a new tab, so the reader loses the comparison exactly where the walk leaves the file they chose it in.

**Keep the layout in the body component without the seq key.** No store change at all. Rejected because the body unmounts when its tab is not the focused one, so the choice dies on the first step into another file's tab and on every tab switch.

**Carry the layout through the navigation parameters.** The step would hand the next change the layout it was taken from. Rejected because it writes the layout of a change that is not on screen yet, it still cannot reach an already-open tab for another file, and it puts a view preference on the change index's wire vocabulary.

**Persist the whole-file look too, as a third layout value.** Rejected because the previous/next controls exist to walk changes: a step that lands on a whole file the change is not drawn in reads as a no-op, so the file look resets by design while the comparison does not.

## Consequences

The reader keeps two columns for the whole review of a Turn, including the tabs a step opens for another file, and a reload or a renderer switch no longer costs them the choice. The cost is that with two columns selected every change stepped into pages its whole file to completion before it can place the change — the read the explicitly selected comparison already paid for that change.

The [Sidebar preview README](../../../../packages/client/ui-sidebar-documentpreview/README.md) states the persisted layout, and the [preview spec](../../../../packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx) pins the behavior: a navigation to another change keeps `data-change-mode="split"`, a step taken from the whole-file look returns to the change in the session's layout, and a second tab of the same session renders the comparison. The [store spec](../../../../packages/client/ui-sidebar-documentpreview/tests/store.client.spec.ts) pins that the field is not part of a tab bucket and survives `forget`.
