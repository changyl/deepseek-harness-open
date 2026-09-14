---
description: "Web command palette and global keyboard-shortcut registry: the Cmd/Ctrl+K surface over the command directory and the current conversation's actions, for users of the palette and for feature authors binding keys."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-command-palette

English | [中文](README.zh.md)

## Summary

This package owns the Web GUI's keyboard surface: `ctx.shortcuts`, the global keydown registry that other client plugins bind chords to, and one frame-wide overlay entry rendering the command palette behind Cmd/Ctrl+K. Opening the palette loads the current session's commands from `ctx.commandUi.palette` once, prepends the two actions this surface owns — start a new session, stop the running turn — ranks the loaded rows locally as you type, and dispatches a pick without touching the composer draft. It changes nothing the model sees.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin and the palette is reachable from anywhere in the application: Cmd/Ctrl+K opens it, Cmd/Ctrl+Shift+P opens it too, and the same chord closes it again.

Rows come from two sources. The Actions section holds what this surface owns: New Session always, and Stop generating while the current session has a running turn. The commands below it are the same rows the composer's `/` menu shows at line start, in the same Add/Commands section order — `file`, `goal`, `plan`, `feedback`, then `compact`, `permission`, `model`, `export`, then any other command in catalog order. A row that takes arguments shows its hint next to the description. Typing ranks name and localized title; blank shows the section order.

Arrow Up and Arrow Down move the highlight, Enter runs it, Escape and a click outside close the palette. Row pointers work too: hovering highlights, clicking runs.

### What a pick does

A client command contribution or a decorated host command opens its own popup or runs its own action, exactly as that row would from the menu. Any other host command runs detached as its bare line, so `/plan` enters plan mode and `/compact` compacts now. Nothing is inserted into the composer and nothing is removed from it — a palette pick owns no command token, so a draft you typed stays where it was.

With no current session the palette lists New Session alone and says so, because commands resolve per session.

### Binding another shortcut

`ctx.shortcuts.register({ id, keys, run })` adds one global binding and returns the disposer; the registration is an effect on the calling fiber, so a plugin's chords leave with it. `keys` is `+`-joined modifiers followed by one key (`mod+k`, `mod+shift+p`), where `mod` accepts the platform command key or Control. Matching is exact: `mod+k` does not fire for `mod+shift+k`. A duplicate id, an unknown modifier, or a missing key throws at registration rather than at the first keystroke. The first matching binding in registration order runs, and the event is consumed; a composing keystroke or an event another handler already consumed is left alone.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`CommandPaletteController` is the whole behavior: a snapshot store the overlay renders, and verbs (`open`/`close`/`toggle`, `setQuery`, `move`, `highlight`, `run`) that the inject face and the shortcut bindings both call. `open()` captures the current session id, publishes the action rows immediately, and starts one load; `load()` reads `ctx.commandUi.palette(session, signal)` and appends the command rows. A load generation counter plus an `AbortController` make a closed or superseded palette write nothing, so a slow catalog cannot reopen a dismissed surface.

Rows are data only. `PaletteEntry` is a discriminated union — `new-session`, `stop`, and `command` (which carries the session id its catalog was read for) — and a pick dispatches on that discriminant: `ctx.uiWorkspace.startSession()`, the bound session's `cancel()`, or `ctx.commandUi.run(name, session)`. Contribution icons stay out of the row: a `ComponentType` is neither JSON-compatible nor a callback, and UI domains share only those, so the overlay draws one glyph per entry kind instead.

The overlay registers into the frame-wide `shell.overlay` list slot and renders through the shared `Modal` primitive, which portals the card to the body, blurs the page, and owns the mask click and the Escape key. The palette itself handles only Arrow Up, Arrow Down, and Enter; the search input takes focus on open and keeps it, with a virtual highlight that the card scrolls into view.

`run(name, session)` on the command surface is the composer-less dispatch path: it prefers an available contribution, then a decoration on a resolvable host row, then the host row's bare line. A contribution or decoration popup opens with a palette token segment, which consumes nothing from the draft; a host command runs detached, with admission failures routed to the composer notice channel like any other detached run.

Copy lives in the `commandPalette` locale namespace and is re-read on every open, so a language switch reaches the next palette.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the palette's own behavior is not the question.

- [ui-commands](../ui-commands/README.md) — the command directory and the `palette()`/`run()` pair this package consumes.
- [ui-layout](../ui-layout/README.md) — declares `shell.overlay`, the frame-wide layer the palette occupies.
- [Web Client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.
- [Slots reference](../../../docs/subsystems/slots.md) — slot kinds, scopes, and the props shares a registrant receives.
- [Web command palette Agent Note](../../../.agents/notes/implemented/feature/2026-09-14-web-command-palette.md) — why the palette is a separate package and a client surface over the command directory.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package only lists the current session's commands and settles a pick through the host's existing command channel, adding no prompt section, tool schema, tool result, or model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are the current limits of the palette, not a backlog.

- **Rows are read once per open** — availability, the running-turn state behind Stop, and the command catalog are all read when the palette opens. A turn that starts or finishes while the palette is open does not change its rows; reopening is the refresh.
- **Rows show no per-command icons** — a contribution's icon component cannot ride render state, so every command row shares one glyph. Restoring per-command icons needs a channel that keeps component types out of shared data.
- **An argument-taking host command runs bare** — a pick executes `/name`; supplying arguments still means typing the line in the composer. The row shows the command's hint so the gap is visible.
- **Chords are fixed by the composition** — there is no user-facing keybinding setting; a deployment changes keys by editing the bundle row that binds them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package emits no Cordis events, owns no cross-plugin mutable state, and its two registrations — the shortcut bindings and the single overlay entry — prove disposal through the HMR-safety spec.
