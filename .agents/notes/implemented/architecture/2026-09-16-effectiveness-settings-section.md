# Agent Note: Render cross-session outcome signals as a Web Settings section

Status: implemented

English | [中文](2026-09-16-effectiveness-settings-section.zh.md)

## Problem

Outcome signals were recorded in every session log and readable in two places, neither of them a browser. [`dsh-command-effectiveness`](../../../../packages/feedback/command-effectiveness/README.md) renders the report as text through `/effectiveness`, which spends a session to read, and [`dsh-api-effectiveness`](../../../../packages/api/effectiveness/README.md) publishes `ctx.remote.effectiveness` with one read method, but nothing in the Web GUI called it — the namespace shipped with a spec and no consumer.

An operator asking "is this deployment's work going well?" reads facts the logs already hold: how many turns carried a signal, how the human rated messages, which changes were accepted or reverted, and which verification commands passed. That is the same kind of fact as the deployment-wide panels the Settings shell already hosts, and the two sibling sections established the shape in [their notes](2026-09-16-usage-settings-section.md) and [this one](2026-09-16-project-board-settings-section.md).

## Decision

`@deepseek-ai/dsh-client-ui-effectiveness` ([package reference](../../../../packages/client/ui-effectiveness/README.md)) contributes one Settings section over `ctx.remote.effectiveness`. It registers through `ctx.slots.inject('settings.section', ...)`, so the contribution waits on the declaration, disappears when the declaration collapses, is re-established when the declarer reloads, and leaves with the caller's fiber. The entry carries `id: 'effectiveness'`, `order: 50` — after the other read-only panels — a `label` read from its own dictionary, and `locale: 'settings.effectiveness'`.

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.effectiveness']`, registers the `settings.effectiveness` dictionaries inside `ctx.effect(...)`, and supplies exactly one injected member: `query`, which calls `ctx.remote.effectiveness.query(undefined)` with no filter — the declared optional parameter goes explicitly, for the reason the [Settings Remote-arity note](../bug-fix/2026-09-17-settings-section-remote-arity.md) records — and unwraps the Remote result envelope. A refused call becomes an `Error` reading `effectiveness.query failed: <code>: <message>`; the section renders its failure notice for any rejection and classifies nothing further, because the Host already decided which failure a caller can act on.

The component's props are the Settings slot's runtime share, the bound locale share, and the injected face (`PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<EffectivenessSectionInjected>`). Load state is component-local in three forms — reading, failed, and the report in hand — with a `pending` flag that holds the Refresh control disabled while a read is in flight. The page reads once on mount and again on Refresh.

A ready report renders ten totals, then the categories that carry at least one judgment, then one row per route, then one row per session, and the truncation notice when the Host cut the session rows. Three rendering rules are deliberate:

- **The category list iterates the wire's own union.** A category the Host stops reporting leaves the page, and a rename on either side fails the build. A category with no judgment is omitted rather than printed as a zero, because "nobody filed this category" and "this category scored zero" are different facts.
- **No signal is stated, not scored.** When the totals hold no session, the page says that no signal was recorded instead of printing 0%: an empty corpus is not a bad outcome, and a rate would invent a denominator the logs never had.
- **A session prints its id and a UTC date.** The report carries no title and no workspace, and a list of sessions reads better with the day than with the millisecond.

Four choices carry the design:

- **No store.** The read state is private to one section instance and nothing it draws survives a remount, so it stays component-local. A store declared at register would add a lifecycle, a sharing surface, and an invalidation rule for data no second entry reads.
- **No filter controls.** The Host call accepts a time window, a session list, a provider, and a model, but the scope approved for this page is the whole corpus. A selection model in the UI needs its own consumer evidence; shipping controls ahead of it would fix a query grammar in the presentation layer.
- **No chart or time series.** One read answers one aggregate report, and the wire carries no time dimension, so a trend would have to be accumulated and kept by the client — a second source of truth beside the fold.
- **Reads only.** Every count was filed through the surface that owns the decision: a rating through the feedback controls, a change decision through the change review, a verification outcome through a task report. A browser editor here would need its own authority decision and would duplicate those surfaces.

Registration is what makes the section load, and each surface is explicit: the `tsconfig.client.json` aggregate reference, the `ui-effectiveness` row plus the `packages/bundle/web-app/package.json` dependency (a row whose package no manifest declares fails to import), hand-written `tsconfig.base.json` aliases — the `client-ui-*` package name does not match its `ui-effectiveness` directory, so the path generator cannot own them — the regenerated client slot catalog, which now lists the new occupant, and the client package map row that records what the package is for. One existing expectation moved with the change: the shipped-section roster in `packages/client/ui-settings-general/tests/shell.client.spec.ts` boots the real web-app roster and asserts the product sections in navigation order, so it now ends `agent-presets, usage, projects, effectiveness`, and the recorded settings-dialog goldens gained the navigation entry.

## Alternatives considered

**Add the report to the conversation as a tool card or command output.** `/effectiveness` already renders it there, but a transcript row belongs to one turn in one session. The Settings panel answers for the whole host, for a reader who is not driving a session.

**Publish a client store so several surfaces could share one report.** Nothing else reads it, and a store exists for state shared across entries or surviving a remount. Here it would be a cache with no second reader and no invalidation source.

**Chart the report over time.** The namespace is unary and each answer is one aggregate. A trend needs a time dimension the wire does not carry, and building one in the browser would make the page's numbers unreconcilable with the fold's.

**Compute the counts in the browser.** The signals exist only as session events; the fold that turns them into counts, the category vocabulary, and the per-route attribution all live behind the projection. A browser copy would drift from the definition every other consumer reads.

**Show a rate.** A percentage is the first thing a reader wants and the last thing this data can support: sessions carry different numbers of turns, most turns carry no signal, and a deployment with no feedback yet would render a perfect or a catastrophic score from an empty denominator.

## Consequences

An operator can see a deployment's recorded outcome signals — totals, categories, routes, and sessions — in the Web GUI, and the `effectiveness` Remote namespace has its first shipped browser consumer. The projection, the query service, and the `/effectiveness` command are untouched, because this package reads the namespace and adds no Host behavior.

The page keeps the reporting semantics of the fold it reads: `turnsWithSignal` counts turn-and-session pairs rather than distinct turns, route rows can sum above the totals because one session may use several routes, and a selection with no signal is stated rather than scored. The copy is locale-owned: the navigation label, headings, category names, figure labels, date template, and every notice come from `settings.effectiveness`, so the page follows the shell's locale and the component carries no product string.

The cost is freshness and scope: the page shows what the last read answered for the whole host, so two operators see the same figures, a change appears only after a Refresh, and there is no way to ask the page about one workspace or one week.

## Deferred

No filter, window, or provider control in the UI, even though the Host call accepts one; no chart or time series; no live update. The session list shows an id and a date rather than a title or workspace, because the report carries neither. A recorded session fixture was not added because recording needs a model key, so the assembled page is covered by component specs and the replayed settings-chrome scenario rather than a fresh recording. No `./invariant` companion is published, because the package owns no durable state and no relation on which independent observations could diverge — its spec pins the registration, the dictionary parity, the refused-call classification, and the rendering rules instead.

## Testing

Twelve cases across two specs. The plugin spec runs the real `SlotRegistry` and `LocaleRuntime` with a provided `remote.effectiveness`: it keeps the host Loader entry inert, pins the exact injection list, checks the English dictionary against the Chinese key set, registers the section without reading the Remote eagerly, classifies a refused call as the failure the section can render, and proves the contribution follows a locale change and recovers across a late declaration and a declarer reload. The section spec renders the component over a scripted query: the reading state followed by the ten totals, the category list rendered only for categories that carry a judgment, an empty corpus with an empty route table and an empty session list, a report carrying route rows, session rows, and the truncation notice, a failed read with its retry, and the Refresh control held while the next read is in flight. `src/client/*` carries per-file 100% coverage.

The shipped registration surfaces are exercised together: `pnpm run test:gui` is green across the client and host GUI suites, both aggregate TypeScript faces build, and the replayed `apps/web/tests/settings-chrome.e2e.ts` scenario passes with the rebuilt client bundle, which is what proves the row loads in the real web profile rather than only in a hand-built context.
