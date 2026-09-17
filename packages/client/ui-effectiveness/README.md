---
description: "Web GUI Settings section for cross-session outcome signals: one Effectiveness page reading the `effectiveness` Remote namespace, showing feedback, change decisions, and verification outcomes per category, route, and session; for users and maintainers of the effectiveness surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-effectiveness

English | [中文](README.zh.md)

## Summary

This package adds an Effectiveness page to the Web GUI Settings panel: the cross-session outcome signals already recorded in session logs, read from the `effectiveness` Remote namespace. One read answers the whole corpus — sessions, turns with signal, feedback, change decisions, and verification outcomes — and the page lists the categories, routes, and sessions those totals cover. The counts describe what happened inside sessions; they are not a model quality score, and a selection carrying no signal says so rather than showing a rate of zero.

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

Mount this plugin in a Web composition that also mounts the `effectiveness` Host namespace; the Settings panel then shows an Effectiveness page. The page is read-only: it states what the recorded logs already carry, and every judgment it counts was filed through the surfaces that own them — a rating through the feedback controls, a change decision through the change review, a verification outcome through a task report. The section owns only its own read state, so nothing it renders outlives the panel and no store, cache, or persisted value is involved.

The page reads once when the section mounts, and the Refresh button starts the next read while the previous one is in flight. Nothing is queued: a refresh that arrives during a read is the read that replaces it, because the page always shows one complete report.

### What the page shows

The page has three states: a status line while reading, a failure notice with a Refresh button when the read is refused, and otherwise the report. A ready report renders ten totals — sessions, turns with signal, positive and negative ratings, accepted, reverted, and undecided changes, and passed, failed, and unknown verification outcomes — followed by the failure notice's opposite: when the selection holds no session at all, the page says that no signal was recorded and gives no rate.

Below the totals, the categories that carry at least one judgment are listed by their localized names, then one table row per route with the route's session count, turns with signal, ratings, and verification outcomes, and then one row per session with its id, its UTC creation date, its turns with signal, and the routes its log named. A report whose per-session rows the deployment bound cut renders the truncation notice, and a report with no route row or no session row states that rather than rendering an empty table.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The plugin is a presentation surface over one Remote namespace. Its node half is an inert Loader entry; the browser half registers dictionaries and one Settings section, and the section reads through an injected `query` callback rather than reaching for a client context. The Remote call, its request validation, the corpus fold, the reporting bound, and the failure vocabulary belong to the [Host namespace](../../api/effectiveness/README.md); this package decides only how to draw the answer and what to say when there is none.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Node half: the empty `apply` that gives the package a Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | Dictionaries, the `query` Remote face, and the `settings.section` registration |
| [`src/client/EffectivenessSection.tsx`](src/client/EffectivenessSection.tsx) | The section component, its category order, and its totals, route, and session renderings |
| [`src/client/locales.ts`](src/client/locales.ts) | The `settings.effectiveness` dictionaries and their key type |
| [`src/client/EffectivenessSection.module.css`](src/client/EffectivenessSection.module.css) | Section styling over the shared theme tokens |

### Slot and registration

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.effectiveness']`, registers the `settings.effectiveness` dictionaries inside `ctx.effect(...)`, and binds them to the `t` seat. It registers into `settings.section` through `ctx.slots.inject`, so the contribution waits on the declaration, leaves with the caller's fiber, and is re-established when the declarer reloads.

The registration carries `id: 'effectiveness'`, `order: 50`, a `label` read from the dictionary's `nav` key, and `locale: 'settings.effectiveness'`, and its `inject` face supplies exactly one member: `query`, which calls `ctx.remote.effectiveness.query()` with no filter and unwraps the Remote result envelope. A refused call becomes an `Error` reading `effectiveness.query failed: <code>: <message>`; the section renders its failure notice for any rejection and classifies nothing further.

### Rendering rules

The component props are the Settings slot's runtime share, the bound locale share, and the injected face. Load state is component-local in three forms — reading, failed, and the report in hand — and a `pending` flag holds the Refresh control disabled while a read is in flight. The page reads once on mount and again on Refresh.

The category list iterates the wire's own category union, so a category the Host stops reporting disappears from the page and a rename on either side fails the build. A category with no judgment is omitted rather than printed as zero. The route table and the session rows render straight from the wire values, and the session's creation time is printed as a UTC date because the exact clock time is noise on a list of sessions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the section is not enough. They move from the browser page to the namespace it reads, then to the fold behind that namespace.

- [api/effectiveness](../../api/effectiveness/README.md) — the `effectiveness` Remote namespace: its query method, its wire types, and its failure code.
- [effectiveness query](../../feedback/effectiveness-query/README.md) — the cross-session fold the namespace answers from, and its per-session reporting bound.
- [effectiveness projection](../../feedback/effectiveness/README.md) — the per-session unit whose outcome signals the fold reuses.
- [command-effectiveness](../../feedback/command-effectiveness/README.md) — `/effectiveness`, the same report rendered as text in a session.
- [ui-settings](../ui-settings/README.md) — the Settings shell that hosts this section.
- [Slots reference](../../../docs/subsystems/slots.md) — how a client plugin declares and fills a slot.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. The section reads recorded outcome signals through `ctx.remote.effectiveness`; it adds no prompt section, no tool schema, and no session event.

#### Token effect

None directly. The page never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries; the signals it counts were recorded by events the session log already held.

#### KV Cache effect

None. Reading the report alters no request, so no cached prefix can be invalidated by opening or refreshing the page.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current page. They are current package constraints, not a metrics roadmap or a task backlog.

- **Reads only** — the section never rates a message, decides a change, or records a verification outcome; every figure it shows was filed through the surface that owns that decision.
- **One selection, no filter controls** — the Host call accepts a time window, session list, provider, and model, but the section sends none, so the page always describes the whole readable corpus on the host.
- **Not live, and no chart** — nothing streams and nothing polls; the figures are those of the last read, and the page shows one report rather than a time series, so a trend has to be read across refreshes.
- **Bounded per-session rows** — the Host cuts per-session rows at its configured `maxSessionsReported` (200 by default) and reports `truncated`; the page states the cut and offers no paging.
- **No signal is not a zero rate** — a selection whose totals hold no session states that rather than printing a percentage, because an empty corpus and a bad outcome are different facts.
- **Route rows can exceed the totals** — a session that used several routes contributes to each route row, so the route figures are per-route facts and do not sum to the corpus totals.
- **A session is an id and a date** — the session list prints the session id and its UTC creation date, not a title, because the report carries neither the title nor the workspace.
- **Mounted only where the Web bundle is** — the section exists only in a composition that mounts this plugin, which the shipped Web bundle does.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no durable state and no cross-plugin mutable state: it holds component-local read state, reads one Remote namespace on demand, and defines no store or cache. Its plugin spec covers the empty host entry, the declared injections, the dictionary pairing, the refused-call classification, and recovery across late declaration and declarer reload.
