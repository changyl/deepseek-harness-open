# Agent Note: Render token usage as a Web Settings section

Status: implemented

English | [中文](2026-09-16-usage-settings-section.zh.md)

> The Settings-section placement recorded here is superseded by [fork data panels as global panels](2026-09-17-fork-data-panels-as-global-panels.md); the Remote face, the component-local read state, the unfiltered whole-corpus selection, and the read-time cost semantics remain owned here.

## Problem

The `usage` Remote namespace answered a complete report — totals, per-route figures, unpriced routes, and read-time cost — and nothing in the Web GUI called it. The only human reader was the in-process `/usage` command in [`dsh-command-usage`](../../../../packages/usage/command-usage/README.md), which prints the report as text into a session, so an operator had to run a command and read the answer out of a transcript to see what a deployment had spent.

The Settings shell is where the Web GUI already puts deployment-wide, read-only panels: [`ui-settings-general`](../../../../packages/client/ui-settings-general/README.md), `ui-settings-models`, `ui-settings-plugins`, and `ui-agent-preset` each contribute one `settings.section` entry. Usage is the same kind of fact — deployment-wide, read-only, and priced by the Host at read time — and it had no entry.

Nothing blocked the work. [`@deepseek-ai/dsh-api-usage`](../../../../packages/api/usage/README.md) already published the namespace with plain wire types and one classified failure, and the Settings slot already accepted a section with a locale namespace and an injected callback. The missing piece was the package that draws the report.

## Decision

`@deepseek-ai/dsh-client-ui-usage` contributes one Settings section over `ctx.remote.usage`. It registers through `ctx.slots.inject('settings.section', ...)`, so the contribution waits on the declaration, disappears when the declaration collapses, is re-established when the declarer reloads, and leaves with the caller's fiber. The entry carries `id: 'usage'`, `order: 30` — after the sections that shape a deployment — a `label` read from its own dictionary, and `locale: 'settings.usage'`.

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.usage']`, registers the `settings.usage` dictionaries inside `ctx.effect(...)`, and supplies exactly one injected member: `query`, which calls `ctx.remote.usage.query(undefined)` with no filter — the declared optional parameter goes explicitly, for the reason the [Settings Remote-arity note](../bug-fix/2026-09-17-settings-section-remote-arity.md) records — and unwraps the Remote result envelope. A refused call becomes an `Error` reading `usage.query failed: <code>: <message>`; the section renders its failure notice for any rejection and classifies nothing further, because the Host already decided which failure a caller can act on.

The component's props are the Settings slot's runtime share, the bound locale share, and the injected face (`PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<UsageSectionInjected>`). Load state is component-local in three forms — reading, failed, and the report in hand — and the page reads once on mount and again on each Refresh, holding the Refresh control disabled while a read is in flight. A ready report renders as a totals grid, a per-route table, the cost block, and the unpriced list when the Host reported one. Amounts arrive as integer micro-units and print six fraction digits as the full resolution of that unit, with trailing zeros trimmed so a whole amount carries no decimal point.

Four choices carry the design:

- **No store.** The load state is private to one section instance and nothing it draws survives a remount, so it stays component-local. A store declared at register would add a lifecycle, a sharing surface, and an invalidation rule for data no second entry reads.
- **No filter controls.** The Host namespace accepts a window, a workspace, a route, and a session list, but the scope approved for this page is the whole corpus. A selection model in the UI needs its own consumer evidence; shipping controls ahead of it would fix a query grammar in the presentation layer.
- **No chart or time series.** The namespace answers one aggregate report per call and the wire carries no time dimension, so a trend would have to be assembled and kept by the client — a second source of truth beside the ledger.
- **Refresh is the only freshness mechanism.** The namespace is unary with no change feed. Polling would spend a Remote read per interval on a figure that moves only when new requests are recorded, and a stream would need a Host-side publication the namespace does not have.

Registration is what makes the section load, and each surface is explicit: the `tsconfig.client.json` aggregate reference, the `ui-usage` row plus the `packages/bundle/web-app/package.json` dependency (a row whose package no manifest declares fails to import), hand-written `tsconfig.base.json` aliases — the `client-ui-*` package name does not match its `ui-usage` directory, so the path generator cannot own them — and the regenerated client slot catalog, which now lists the new occupant. One existing test moved with the change: the shell spec in `packages/client/ui-settings-general` boots the shipped Web roster and asserts the product sections in navigation order, so its roster ends with `usage`.

## Alternatives considered

**Fold usage into the existing session statistics strip.** That strip folds log structure for one session. The figures a deployment operator asks for — the whole corpus, priced by the rate card in effect — are neither per-session nor structural, and the seam's own design kept cost out of that fold for the same reason.

**Read the namespace from a dedicated route or the conversation.** A Settings section reuses the shell's existing navigation, its locale seat, and its list scope. A new surface would need its own slot and its own place in the shell's navigation for one read-only page.

**Publish a client store so several surfaces could share one report.** Nothing else reads the report, and a store exists for state that is shared across entries or survives a remount. Here it would be a cache with no second reader and no invalidation source.

**Format amounts on the Host.** The wire carries integer micro-units and the table's currency. Formatting is presentation, and keeping it in the component leaves the Host free of locale and display concerns while its arithmetic stays exact.

**Price the report in the client.** Rates are deployment data registered on the Host and read at query time, so a client copy would drift from the table that produced the amount, and an unpriced route would stop being attributable.

## Consequences

Operators can read totals, per-route figures, unpriced routes, and cost in the Web GUI, and the `usage` namespace now has a shipped browser consumer. The three existing usage consumers — the service, the ledger, and the command — are untouched, because this package reads the namespace and adds no Host behavior.

Cost keeps its read-time semantics in the UI: an absent `cost` renders the no-rate-card notice rather than a zero amount, and `complete: false` renders the floor notice, so an incomplete total is never presented as a measurement. No floating-point value enters the path; the amount is an integer scaled and printed at fixed resolution.

The copy is locale-owned: the nav label, headings, table headers, status lines, and notices all come from `settings.usage`, so the page follows the shell's locale and the component carries no product string.

The cost is freshness. The page shows what the last read answered and never a selection, so two operators on one deployment see the same figure, and any change is visible only after a Refresh.

## Deferred

No window, workspace, route, or session filter in the UI, even though the Host namespace accepts one; no chart or time series; no streaming or polling. A browser snapshot fixture and the top-level `snapshots/` tree are untouched because recording needs a model key, so the assembled page is covered by component specs rather than a recorded scenario. No `./invariant` companion is published, because the package owns no durable state and no relation on which independent observations could diverge — its spec pins the registration, the dictionary parity, and the rendering rules instead.

## Testing

Eleven cases across two specs. The plugin spec runs the real `SlotRegistry` and `LocaleRuntime` with a provided `remote.usage`: it keeps the host Loader entry inert, pins the exact injection list, checks the English dictionary against the Chinese key set, registers the section without reading the Remote eagerly, classifies a refused call as the failure the section can render, and proves the contribution follows a locale change and recovers across a late declaration and a declarer reload. The section spec renders the component over a scripted query: the reading state followed by the totals and route rows, a whole-unit amount, the empty-selection and no-rate-card notices, the failed read with its retry, and the Refresh control held while the next read is in flight. `src/client/*` carries per-file 100% coverage.

`pnpm run test:gui` is green across the client and host GUI suites; `verify-client-packages`, `verify-client-ui-i18n`, and `verify-client-catalog` pass, and both aggregate TypeScript faces build.
