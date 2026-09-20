# Agent Note: New Session from the command palette

Status: implemented

English | [中文](2026-09-20-palette-new-session-focus.zh.md)

## Problem

Picking **New Session** from the Web command palette did nothing in a shipped Web composition, and the caret ended on the document body instead of the composer. Every other palette row worked, which is what made the defect look row-specific.

Two independent causes were stacked on one row.

The palette read its optional Workspace navigation once, while its `inject` callback ran: `ctx.inject(['slots', 'shortcuts', 'commandUi', 'sessions', 'locale'], scope => { workspace: scope.get('uiWorkspace') })`. The palette waits on the command surface and the Session Controller; the Workspace UI additionally waits on its directory-picker Remote. When the picker Remote mounted later, `ui-workspace` applied after that callback and the captured field stayed `undefined` forever. `this.deps.workspace?.startSession()` then silently did nothing — an optional dependency was mistaken for a read that resolves once.

The focus loss followed from the same field once it resolved, and survived independently. [Composer focus after a command-palette pick](2026-09-16-composer-focus-after-palette-pick.md) handed the caret back for an action, a bare host command, Stop, and a settled popup, and deliberately left New Session out on the claim that "the session it started focuses its composer through the composer's own unlock". That claim holds only for a session created fresh. `UiWorkspace.connectWorkspace` reuses the current Workspace's existing blank Session, and the palette is normally opened from exactly that blank Session's hero: the composer never remounts, its unlock effect never re-runs, and the caret the palette took goes nowhere.

## Decision

Workspace navigation is read per pick, not captured at registration. `CommandPaletteDeps.workspace` is a resolver, `index.ts` passes `() => scope.get('uiWorkspace')`, and the pick calls it. `ctx.get` reads the global service store, so a service that registers after this plugin activates is still found.

`UiWorkspace.startSession(workspaceId?)` resolves with the Session the flow landed on, or `undefined` when no Workspace could be resolved or a later navigation superseded the request. The destination is observable only inside the flow: `openWorkspace` reports it through the existing `beforeOpen` callback, which a superseded request never reaches, so `startSession` captures it there instead of widening `openWorkspace`'s own contract.

The palette's New Session row focuses that destination through `ctx.commandUi.focusComposer(sessionId)`. A session created fresh mounts its composer after the flow resolves, so the hand-back finds no binding and its unlock effect takes the caret; a reused blank session has a mounted composer, which is the case that had no owner at all. This supersedes the New Session clause of the earlier note; the other hand-backs it records are unchanged.

## Alternatives considered

**Declare `uiWorkspace` in the palette's `inject`.** It makes the ordering explicit and is the smallest diff. Rejected: a Cordis fiber that waits on an absent service stays PENDING forever, and Workspace UI is explicitly optional for this plugin — a deployment that mounts no Workspace UI would lose the palette, the shortcut registry, and every command row, not just New Session.

**Bind `uiWorkspace` through a nested `scope.inject(['uiWorkspace'], …)` and publish it to the controller.** The registration timing is then explicit. Rejected: it adds a mutable field and a second lifetime to a value that is read at most once per pick, and the controller would have to stay correct across the bind and its release.

**Focus inside `UiWorkspace.startSession`.** One call site fewer. Rejected: the hand-back belongs to the surface that took the caret. `startSession` is also called by the sidebar's New Session button, whose click already leaves focus on the button, and by the agent-preset creator, which was started from a settings screen; giving the navigation action its own focus policy would apply to all of them.

**Focus the current Session after the navigation settles, without a destination.** No contract change at all. Rejected: `current` is whatever a superseding navigation happened to select, so a reader who moved on mid-flow would have the caret pulled into an unrelated conversation.

**Make the composer take focus on every hero render.** Would cover the reused-session case without touching workspace navigation. Rejected: no change event fires in that case, so the rule degenerates into focusing on unrelated renders and stealing the caret from controls the reader moved to.

## Consequences

**New Session** navigates in a Web composition whose Workspace UI activates after the palette, and the pick ends with the caret in the composer of the Session it landed on. Command rows, Stop, actions, and popups keep the behavior recorded by the earlier note.

`UiWorkspace.startSession` changes from `void` to `Promise<SessionId | undefined>`. Callers that ignore the result — the sidebar's injected face and the Workspace browser rows — are unaffected; the returned promise is the only way a composer-less caller can address the Session the flow reused or created.

Coverage: [the palette spec](../../../../packages/client/ui-command-palette/tests/palette.client.spec.ts) pins the destination hand-back, the superseded flow that reports no destination, and the deployment without Workspace navigation; [the palette browser-plugin spec](../../../../packages/client/ui-command-palette/tests/browser-plugin.client.spec.ts) pins the same hand-back through the real injected face; [the workspace service spec](../../../../packages/client/ui-workspace/tests/workspaces-service.client.spec.ts) pins the destination `startSession` resolves with, the untargetable and failed flows that resolve undefined, and the superseded flow that reports none; [the workspace apply spec](../../../../packages/client/ui-workspace/tests/apply.client.spec.ts) tracks the new return type. No session event, prompt, tool schema, or wire format changed, so recorded-session snapshots do not move.
