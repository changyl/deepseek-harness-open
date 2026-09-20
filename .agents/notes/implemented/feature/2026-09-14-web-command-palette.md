# Agent Note: Web command palette

Status: implemented

English | [中文](2026-09-14-web-command-palette.zh.md)

## Problem

The Web GUI could reach a command only through the composer: type `/name`, or open the composer's `+` menu. Both require the conversation and its input to be in view, and neither is a keyboard gesture a user can make from anywhere. Two everyday actions had no entry point outside their own control: starting a new session existed only as the sidebar button, and stopping a running turn only as the composer's primary button in the states where it turns into Stop.

Nothing in the client owned a global key either. Keyboard handling lived in the composer keymap and in individual dialogs, so a second surface could not claim a chord without adding another document listener with its own composition, consumed-event, and ordering rules.

## Decision

One new client package, `@deepseek-ai/dsh-client-ui-command-palette`, owns the keyboard layer and the palette; `ctx.commandUi` grew the two methods a composer-less surface needs. Commands stay owned by the command surface, and the palette is a second view over the same rows.

### The command surface grows a query and a bare run

`CommandUiContract` gains `palette(session, signal)` and `run(name, session)`. `palette` is the existing candidate synthesis at a leading position with ranking removed: the rows the `/` menu shows at line start, in the section order the [composer menu decision](2026-09-08-composer-menu-sections-and-localized-rows.md) owns, without contribution icons. `run` is a menu pick without a composer token — an available contribution, then a decoration on a resolvable host row, then the host row's bare line run detached. Neither method re-derives the directory, the availability gates, or the name-collision rules: both call the private paths the composer already uses.

The palette row type deliberately omits the contribution icon. A `ComponentType` is neither JSON-compatible data nor a callback, and injected values and render state admit only those, so the overlay draws one glyph per entry kind and the composer menu keeps the component-per-command rendering.

### The palette is a view over those rows

`CommandPaletteController` holds one snapshot store and the verbs that the overlay's inject face and the shortcut bindings both call. Opening captures the current session id, publishes the actions this surface owns — New Session always, Stop while that session has a running turn — and starts one load. Typing re-ranks the loaded rows locally and issues no further query, so the wire is touched once per open. A load generation counter plus an `AbortController` keep a superseded or closed load from writing, which is what lets the shortcut toggle and the retry button share one `open()`.

Rows are a discriminated union (`new-session`, `stop`, `command`), and a pick dispatches on that discriminant: `ctx.uiWorkspace.startSession()` through an optional service read at pick time, the bound session's `cancel()`, or `ctx.commandUi.run(name, session)`. A command row carries the session id its catalog was read for, so the dispatch needs no second lookup and cannot drift from what was displayed.

### One keyboard registry, not one listener per feature

`ctx.shortcuts` owns the single document keydown listener and dispatches to registered bindings in registration order, first match wins, with exact modifier matching. Chords are parsed and validated at registration, so a malformed spec or a duplicate id fails at plugin load rather than at the first keystroke; the registration is an effect on the calling fiber, so a plugin's chords leave with it. Composition keystrokes and events another handler already consumed are left untouched, and `mod` accepts the platform command key or Control so one spec serves macOS and Windows/Linux.

The palette binds `mod+k` and `mod+shift+p` to the same toggle.

### A composer-less popup consumes nothing

`TokenSegment` gained a `palette` variant. A popup settles by consuming the segment snapshotted at open time, and a menu or enter segment names the composer token (or span) to clear. A palette pick owns no token: its segment consumes nothing, so a draft the palette never owned cannot be cleared by a popup the palette opened. `consumeVia` narrowed to the token-bearing segments, which keeps that distinction in the types rather than in a runtime check nothing exercises.

## Alternatives considered

**Build the palette inside `ui-commands`.** The palette reads the same directory, so a second package looked like indirection. Rejected because the palette is a global overlay with its own keyboard layer, its own session-independent lifetime, and its own two actions; folding it in would make `ui-commands` own a keyboard registry that has nothing to do with the command source, and the package's export discipline forbids reaching into its internals from outside.

**Drive the composer's slash pipeline through `toggleSource('command', …)`.** This returns exactly the finished candidate list, including contributions and decorations. Rejected because the composer's `MenuView` and the palette would read the same per-session menu store, so opening the palette would also open the composer dropdown — and the palette would be unusable with no composer in view.

**Read `ctx.remote.commands.list(sessionId)` directly.** One RPC and no new contract. Rejected as lossy: it drops client contributions and decorations, which are exactly the rows a palette is for — `/model`, `/permission`, `/file` — along with their availability gating, the built-in localized faces, and the Add/Commands section order.

**Let each feature package bind its own chord with its own listener.** No new service, and each feature keeps its keys local. Rejected because every listener would re-implement composition-state, consumed-event, and ordering rules, and two features could claim the same chord with no defined winner.

## Consequences

The Web GUI gains a keyboard path to every command the current session can run, plus New Session and Stop, from anywhere in the application. `scripts/verify-client-ui-i18n` owns the palette's copy through the `commandPalette` locale namespace, and the package's own suites pin chord parsing and matching, controller loading and supersession, the rendered states, and the browser half's registrations and disposal.

Three limits are deliberate and recorded in the package README: rows are read once per open, command rows share one glyph, and an argument-taking host command runs bare with its hint shown. Per-command icons need a channel that keeps component types out of shared data; live row refresh needs a subscription the controller does not hold.

The palette is browser-only. Nothing in it reaches the model, and no prompt, tool schema, or session event changed, so no recorded-session snapshot moves.
