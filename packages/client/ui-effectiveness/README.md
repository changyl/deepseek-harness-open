---
description: "Web GUI global panel for cross-session outcome signals: one Effectiveness panel reading the `effectiveness` Remote namespace, showing feedback, change decisions, and verification outcomes per category, route, and session; for users and maintainers of the effectiveness surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-effectiveness

English | [中文](README.zh.md)

## Summary

This package adds an Effectiveness panel to the Web GUI's global sidebar panels: the cross-session outcome signals already recorded in session logs, read from the `effectiveness` Remote namespace. One read answers the whole corpus — sessions, turns with signal, feedback, change decisions, and verification outcomes — and the panel lists the categories, routes, and sessions those totals cover. The counts describe what happened inside sessions; they are not a model quality score, and a selection carrying no signal says so rather than showing a rate of zero.

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

Mount this plugin in a Web composition that also mounts the `effectiveness` Host namespace; the sidebar's global panel row then opens this panel in the centre column. The panel is read-only: it states what the recorded logs already carry, and every judgment it counts was filed through the surfaces that own them — a rating through the feedback controls, a change decision through the change review, a verification outcome through a task report. The panel owns only its own read state, so nothing it renders outlives the panel and no store, cache, or persisted value is involved.

The panel reads once when it mounts, and the Refresh button starts the next read while the previous one is in flight. Nothing is queued: a refresh that arrives during a read is the read that replaces it, because the panel always shows one complete report. Selecting a Session or starting a New Session returns the centre column to the Conversation.

### What the panel shows

The panel has three states: a status line while reading, a failure notice with a Refresh button when the read is refused, and otherwise the report. A ready report renders ten totals — sessions, turns with signal, positive and negative ratings, accepted, reverted, and undecided changes, and passed, failed, and unknown verification outcomes — followed by the failure notice's opposite: when the selection holds no session at all, the panel says that no signal was recorded and gives no rate.

Below the totals, the categories that carry at least one judgment are listed by their localized names, then one table row per route with the route's session count, turns with signal, ratings, and verification outcomes, and then one row per session with its id, its UTC creation date, its turns with signal, and the routes its log named. A report whose per-session rows the deployment bound cut renders the truncation notice, and a report with no route row or no session row states that rather than rendering an empty table.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The plugin is a presentation surface over one Remote namespace. Its node half is an inert Loader entry; the browser half registers dictionaries, one global panel, and the sidebar row that opens it, and the panel reads through an injected `query` callback rather than reaching for a client context. The Remote call, its request validation, the corpus fold, the reporting bound, and the failure vocabulary belong to the [Host namespace](../../api/effectiveness/README.md); this package decides only how to draw the answer and what to say when there is none.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Node half: the empty `apply` that gives the package a Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | Dictionaries, the `query` Remote face, and the `main` + `sidebar.panellist` registrations |
| [`src/client/EffectivenessPanel.tsx`](src/client/EffectivenessPanel.tsx) | The panel component, its category order, and its totals, route, and session renderings |
| [`src/client/EffectivenessPanelIcon.tsx`](src/client/EffectivenessPanelIcon.tsx) | The sidebar row glyph |
| [`src/client/locales.ts`](src/client/locales.ts) | The `effectiveness` dictionaries and their key type |
| [`src/client/EffectivenessPanel.module.css`](src/client/EffectivenessPanel.module.css) | Panel styling over the shared theme tokens |

### Slot and registration

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.effectiveness']`, registers the `effectiveness` dictionaries inside `ctx.effect(...)`, and binds them to the `t` seat. It registers into the layout's `main` keyed slot and the sidebar's `sidebar.panellist` list through `ctx.slots.inject`, so each contribution waits on its declaration, leaves with the caller's fiber, and is re-established when the declarer reloads.

Both registrations carry the same panel id, `effectiveness`: the sidebar row takes it as its list `id` and `order: 30`, and the centre column takes it as the `main` key. The row's `label` reads the dictionary's `nav` key, and the panel carries `locale: 'effectiveness'`, and its `inject` face supplies exactly one member: `query`, which calls `ctx.remote.effectiveness.query()` with no filter and unwraps the Remote result envelope. A refused call becomes an `Error` reading `effectiveness.query failed: <code>: <message>`; the panel renders its failure notice for any rejection and classifies nothing further.

### Rendering rules

The component props are the main slot's runtime share, the bound locale share, and the injected face. Load state is component-local in three forms — reading, failed, and the report in hand — and a `pending` flag holds the Refresh control disabled while a read is in flight. The panel reads once on mount and again on Refresh. Every state renders inside the panel's own scrolling surface, because the centre column clips overflow.

The category list iterates the wire's own category union, so a category the Host stops reporting disappears from the panel and a rename on either side fails the build. A category with no judgment is omitted rather than printed as zero. The route table and the session rows render straight from the wire values, and the session's creation time is printed as a UTC date because the exact clock time is noise on a list of sessions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the panel is not enough. They move from the browser page to the namespace it reads, then to the fold behind that namespace.

- [api/effectiveness](../../api/effectiveness/README.md) — the `effectiveness` Remote namespace: its query method, its wire types, and its failure code.
- [effectiveness query](../../feedback/effectiveness-query/README.md) — the cross-session fold the namespace answers from, and its per-session reporting bound.
- [effectiveness projection](../../feedback/effectiveness/README.md) — the per-session unit whose outcome signals the fold reuses.
- [command-effectiveness](../../feedback/command-effectiveness/README.md) — `/effectiveness`, the same report rendered as text in a session.
- [ui-sidebar](../ui-sidebar/README.md) — the global panel row that selects this panel.
- [ui-layout](../ui-layout/README.md) — the `main` keyed slot the panel occupies, and `ctx.layout.selectPanel`.
- [Slots reference](../../../docs/subsystems/slots.md) — how a client plugin declares and fills a slot.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. The panel reads recorded outcome signals through `ctx.remote.effectiveness`; it adds no prompt section, no tool schema, and no session event.

#### Token effect

None directly. The page never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries; the signals it counts were recorded by events the session log already held.

#### KV Cache effect

None. Reading the report alters no request, so no cached prefix can be invalidated by opening or refreshing the page.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current page. They are current package constraints, not a metrics roadmap or a task backlog.

- **Reads only** — the panel never rates a message, decides a change, or records a verification outcome; every figure it shows was filed through the surface that owns that decision.
- **One selection, no filter controls** — the Host call accepts a time window, session list, provider, and model, but the panel sends none, so the page always describes the whole readable corpus on the host.
- **Not live, and no chart** — nothing streams and nothing polls; the figures are those of the last read, and the page shows one report rather than a time series, so a trend has to be read across refreshes.
- **Bounded per-session rows** — the Host cuts per-session rows at its configured `maxSessionsReported` (200 by default) and reports `truncated`; the panel states the cut and offers no paging.
- **No signal is not a zero rate** — a selection whose totals hold no session states that rather than printing a percentage, because an empty corpus and a bad outcome are different facts.
- **Route rows can exceed the totals** — a session that used several routes contributes to each route row, so the route figures are per-route facts and do not sum to the corpus totals.
- **A session is an id and a date** — the session list prints the session id and its UTC creation date, not a title, because the report carries neither the title nor the workspace.
- **Selection is not persisted** — the selected panel lives in the in-memory layout state, so a page reload returns the centre column to the Conversation.
- **Mounted only where the Web bundle is** — the panel exists only in a composition that mounts this plugin, which the shipped Web bundle does.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no durable state and no cross-plugin mutable state: it holds component-local read state, reads one Remote namespace on demand, and defines no store or cache. Its plugin spec covers the empty host entry, the declared injections, the dictionary pairing, the refused-call classification, and recovery across late declaration and declarer reload.
