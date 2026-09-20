# Agent Note: Composer focus after a command-palette pick

Status: implemented

English | [中文](2026-09-16-composer-focus-after-palette-pick.zh.md)

## Problem

The Web command palette takes focus when it opens — its search input is where the reader types to filter rows — and renders in a frame-wide overlay the composer does not own. A pick closed the overlay and dispatched the command, and the caret went with the card: nowhere. Typing a message meant clicking the composer again.

The command surface already had the hand-back. `CommandUiRuntime` keeps a per-session focus hook, and `PopupSelectController` calls it when a popup settles or is dismissed with Escape. No production code ever bound one, so that call was dead, and the pick paths — an action, a bare host command, Stop — never called it at all. The same gap hit the composer's own `/` menu: a popup opened from `/model` and left with Escape dropped the caret too.

## Decision

The composer owns its focus and registers it with the command surface. `SessionInputShell.focus()` places the DOM focus on the editor's root element and lets Lexical restore the selection; `InputHub.shellFor` binds it into `ctx.commandUi` through a declared read when the session scope materializes, and the binding rides that scope.

The command surface hands the caret back after every composer-less pick that does not open a popup: an action contribution or decoration returns it as it dispatches, a bare host command returns it as it dispatches without waiting for the remote result, and a pick whose row no longer resolves returns it too, because the palette already let go. A popup keeps focus until it settles and hands it back then, from the palette or from the `/` menu. `focusComposer(sessionId)` is that same hand-back as a public verb, which is also what the palette's own Stop row uses. New Session was left out here on the claim that the started session's composer takes the caret through its own unlock; that holds only for a session created fresh, so [New Session from the command palette](2026-09-20-palette-new-session-focus.md) supersedes this clause and hands the caret to the destination the flow reports.

## Alternatives considered

**Restore the element that had focus before the palette opened.** The generic dialog rule, with no cross-plugin API. Rejected: for a pick that opens a popup the restore races the popup's own focus effect, and a reader who opened the palette from another surface would be sent back there rather than to the composer the command belongs to.

**Add `focus()` to the conversation input face and resolve it per call.** ui-commands already resolves `conversation.input` for its detached-run notices, so the call would mirror that. Rejected: it widens a face documented as the frozen input-machine contract, and it replaces a hand-back seam the popup controller already consumes.

**Hand the caret back only for commands, leaving Stop alone.** The smaller diff. Rejected: Stop is a pick from the same card and ends the same way, so leaving it out reproduces the reported defect one row away.

**Wait for the remote result before focusing.** Rejected: the composer is free while a command runs, and a reader who moved on before the result landed would have the caret pulled back under them.

## Consequences

A palette pick, and a popup settled from the `/` menu, end with the caret in the composer, and the Escape path that was dead code now works. No session event, prompt, tool schema, or wire format changed, so recorded-session snapshots do not move.

Coverage: [the command-surface spec](../../../../packages/client/ui-commands/tests/service.client.spec.ts) pins the action, host-row, miss, and popup-settle hand-backs plus the unbound-session no-op; [the conversation apply spec](../../../../packages/client/ui-conversation/tests/apply-inject.client.spec.tsx) pins the per-session binding, the focus it performs, and its release; [the palette spec](../../../../packages/client/ui-command-palette/tests/palette.client.spec.ts) pins Stop, the unbound stop, and that a command row leaves the caret to the command surface.
