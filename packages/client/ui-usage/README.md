---
description: "Web GUI Settings section for token usage and cost: one Usage page reading the `usage` Remote namespace, with totals, a per-route table, the cost of the priced subset, and the unpriced routes; for users and maintainers of the usage surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-usage

English | [中文](README.zh.md)

## Summary

This package adds a Usage page to the Web GUI Settings panel: recorded token usage and read-time cost for the whole corpus, rendered from the `usage` Remote namespace. The page reads once when it opens and again on the Refresh button. Totals cover sessions, turns, steps, and the four token buckets; a per-route table splits the same figures by provider and model; cost appears when the deployment mounts a rate card, and a total that omits an unpriced route is marked as a floor rather than a measurement.

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

Mount this plugin in a Web composition that also mounts the `usage` Host namespace; the Settings panel then shows a Usage page. The page renders one report per read: it reads once when the section mounts, and the Refresh button starts the next read while the previous one is still in flight. The section owns only that load state, so nothing it renders outlives the panel and no store, cache, or persisted value is involved.

The page has three states. While reading it shows a status line. If the read fails it shows the failure notice and a Refresh button, because a failed query is the only failure path the section classifies. Otherwise it renders the report: a totals grid, the per-route table or an empty-selection notice when no route contributed, the cost block, and the unpriced-route list when the host reported any.

### What one read shows

The totals grid carries eight figures: sessions, turns, steps, steps without a usage record, uncached input tokens, output tokens, cache-read tokens, and cache-write tokens. The route table repeats the session, step, and four token figures for each `provider/model` route, ordered as the Host reported them. Cost is computed by the Host at read time from the rate card in effect: the section prints the integer amount with its currency and the rate-card version that produced it, and marks the amount incomplete when at least one contributing route has no price. Routes the rate card does not name are listed separately, so an absent figure is attributable rather than silent.

Amounts are integer micro-units of the card's currency. The section prints six fraction digits as the full resolution of that unit, trims trailing zeros, and prints a whole amount with no decimal point.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The plugin is a presentation surface over one Remote namespace. Its node half is an inert Loader entry; the browser half registers dictionaries and one Settings section, and the section reads through an injected `query` callback rather than reaching for a client context. The Remote call, its validation, and the failure vocabulary belong to the [Host namespace](../../api/usage/README.md); this package decides only how to draw the answer and what to say when there is none.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Node half: the empty `apply` that gives the package a Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | Dictionaries, the `query` Remote face, and the `settings.section` registration |
| [`src/client/UsageSection.tsx`](src/client/UsageSection.tsx) | The section component and its amount formatter |
| [`src/client/locales.ts`](src/client/locales.ts) | The `settings.usage` dictionaries and their key type |
| [`src/client/UsageSection.module.css`](src/client/UsageSection.module.css) | Section styling over the shared theme tokens |

### Slot and registration

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.usage']`, registers the `settings.usage` dictionaries inside `ctx.effect(...)`, and binds them to the `t` seat. It registers into `settings.section` through `ctx.slots.inject`, so the contribution waits on the declaration, leaves with the caller's fiber, and is re-established when the declarer reloads.

The registration carries `id: 'usage'`, `order: 30`, a `label` read from the dictionary's `nav` key, and `locale: 'settings.usage'`, and its `inject` face supplies exactly one member: `query`, which calls `ctx.remote.usage.query()` with no filter. A refused call becomes an `Error` reading `usage.query failed: <code>: <message>`; the section renders its failure notice for any rejection and classifies nothing further.

### Rendering rules

The component props are the Settings slot's runtime share, the bound locale share, and the injected face. Load state is component-local and has three forms — reading, failed, and the report in hand — and the Refresh control is disabled while a read is in flight. Rendering is a straight reading of the wire report: eight totals, one table row per route, the cost block, and the unpriced list only when it is non-empty.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the section is not enough. They move from the browser page to the namespace it reads and the seam behind that namespace.

- [api/usage](../../api/usage/README.md) — the `usage` Remote namespace: its one query method, its wire types, and its failure codes.
- [usage service](../../usage/usage/README.md) — the seam that assembles the report, and the provider and pricing roles that shape it.
- [ui-settings](../ui-settings/README.md) — the Settings shell that hosts this section.
- [Slots reference](../../../docs/subsystems/slots.md) — how a client plugin declares and fills a slot.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. The section reads figures about requests that already happened through `ctx.remote.usage`; it adds no prompt section, no tool schema, and no session event.

#### Token effect

None directly. The page never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries; the requests whose figures it displays were shaped elsewhere.

#### KV Cache effect

None. Reading usage alters no request, so no cached prefix can be invalidated by opening or refreshing the page.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current page. They are current package constraints, not a general statistics comparison or a task backlog.

- **One selection only** — the page reads the whole corpus. The Host namespace accepts a window, a workspace, a route, and a session list, but the section sends no filter, so there is no way to narrow a report from the browser.
- **One shape of answer** — the page renders one table and a totals grid per read. It draws no chart and keeps no time series, so it cannot show a trend, a rate, or a comparison between two selections.
- **Not live** — nothing streams and nothing polls. Freshness equals the refresh gesture, and a read that arrives while another is in flight is not queued.
- **No per-route turn count** — the route table shows sessions, steps, and the four token buckets; the wire type deliberately carries no per-route turns, because one turn can switch routes and a per-route turn count would double-count it.
- **Cost depends on the deployment** — a composition that mounts no rate card reports no cost at all, and a card that names only some routes marks the amount incomplete; the page cannot price anything itself.
- **Mounted only where the Web bundle is** — the section exists only in a composition that mounts this plugin, which the shipped Web bundle does.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no durable state and no cross-plugin mutable state: it holds component-local load state, reads one Remote namespace on demand, and defines no store or cache. Its plugin spec covers the empty host entry, the declared injections, the dictionary pairing, the refused-call classification, and recovery across late declaration and declarer reload.
