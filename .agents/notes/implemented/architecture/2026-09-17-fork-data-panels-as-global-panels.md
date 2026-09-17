# Agent Note: Fork data panels open as global panels, not Settings sections

Status: implemented

English | [中文](2026-09-17-fork-data-panels-as-global-panels.zh.md)

## Problem

The three data surfaces this fork adds — the token-usage report, the durable project board, and the outcome-signal report — were contributed as `settings.section` entries, so a reader reached them only by opening Settings and picking a nav row. They are not preferences: each reads a Host-side corpus and renders it, they own no setting the user can change, and the Settings dialog is where a reader goes to change behaviour, not to read a report.

The Web client already has the seat this shape fits. `ui-layout` declares the root-scoped `main` keyed slot (`packages/client/ui-layout/src/client/index.ts:153`) and the AppFrame renders the selected key in the centre column, with `null` showing the Conversation; `ui-sidebar` declares the root-scoped `sidebar.panellist` list (`packages/client/ui-sidebar/src/client/contract/slots.ts:32`), renders one labelled row per entry, and selects the matching `main` key through `ctx.layout.selectPanel`. Both shipped READMEs stated the obvious gap: "The shipped composition registers no example panel" and "No global panel is registered by the shipped composition". Panels are session-independent, so a report stays readable with no Session open, and `ui-workspace` already returns to the Conversation by calling `ctx.layout.selectPanel(null)` on session open and on New Session.

## Decision

Each of the three plugins contributes one global panel and its sidebar row instead of a Settings section, and drops its `settings.section` contribution.

| Plugin | panel id (`main` key and row `id`) | row `order` | row glyph | locale namespace | component |
|---|---|---|---|---|---|
| `ui-project` | `project` | 10 | `IconProjectAddOutline16` | `projects` | `ProjectPanel` |
| `ui-usage` | `usage` | 20 | `IconGaugeOutline16` | `usage` | `UsagePanel` |
| `ui-effectiveness` | `effectiveness` | 30 | `IconLikeOutline16` | `effectiveness` | `EffectivenessPanel` |

Each plugin registers twice through `ctx.slots.inject`, once into `main` (`{ name: 'main', key: PANEL_ID, locale: NS }`) and once into `sidebar.panellist` (`{ name: 'sidebar.panellist', id: PANEL_ID, order, label: () => t('nav') }`). Both registrations share one module-level `PANEL_ID` constant, because the two identities must match exactly: `ctx.layout.selectPanel` throws when the selected key has no `main` registration, so a drifting pair would leave a sidebar row that fails on click. The id is a compile-time brand built with a type assertion (`'usage' as MainPanelId`), not `brandString`: `@deepseek-ai/dsh-brand` is not a platform module, and a browser half may not add a non-baseline workspace value request for a cast that erases.

The three packages drop their `@deepseek-ai/dsh-client-ui-settings` type dependency and add `@deepseek-ai/dsh-client-ui-layout` and `@deepseek-ai/dsh-client-ui-sidebar` as development dependencies, in both `devDependencies` and the informational `dsh.client.inject` edges, with matching `tsconfig.json` references. `settings.*` locale namespaces become the panel's own domain names (`usage`, `projects`, `effectiveness`), and each component file, symbol, and CSS root class moves from `*Section` to `*Panel`; the sidebar row carries its own tiny `*PanelIcon` component, which is what the panellist contract renders with the row's requested size.

Every panel state renders inside one pane surface — `flex: 1; min-height: 0; overflow-y: auto` with its own padding — because the centre column is `overflow: hidden` and no longer supplies a settings content column. The loading and failed states, which previously returned a bare paragraph, now render inside that same surface.

Coverage moves with the surfaces: each plugin spec declares `main` and `sidebar.panellist` on its fake root entry, asserts both registrations exist with the same id, asserts the glyph renders at the requested size, and asserts both seats clear on fiber disposal and re-establish on a late declaration. The browser scenario is `apps/web/tests/fork-global-panels.e2e.ts` (renamed from `fork-settings-sections.e2e.ts`): it asserts the `全局面板` navigation lists the three rows in order, opens each panel to its ready heading with no failure notice, asserts the Settings dialog no longer offers the three names, and asserts a New Session clears the selection back to the Conversation.

## Alternatives considered

**Keep them as Settings sections and regroup the nav.** The complaint is semantic, not positional: a read-only report is not a preference, and no grouping inside Settings changes that. It would also keep the reports behind a modal that closes when a Session is opened.

**Register one global panel with three tabs.** The three read different namespaces, own different copy, and already ship as three independent plugins. A tabbed host would need one owner for the other two panels' content, which the client layering forbids: a feature plugin cannot import another feature plugin.

**Widen `MainPanelId` handling by importing `dsh-brand` at runtime.** Rejected above: the module graph has no baseline entry for it, and the brand is compile-time only.

**Make the sidebar row toggle back to the Conversation.** `ui-sidebar` and `ui-layout` are upstream packages, and the existing path back is already two gestures the user knows: click a Session or start a New Session, both of which call `selectPanel(null)`. Changing shared navigation behaviour for a fork placement is not warranted; the panels' READMEs record the reload limitation instead.

**Persist the selected panel.** The layout store is root-scoped in-memory state, and persisting a view selection needs a durable owner this change does not create. A reload returns to the Conversation, which is recorded as a known limitation.

## Consequences

The three reports are readable without opening Settings and without a selected Session, and the Settings dialog lists only pages that hold preferences. The placement decisions recorded in the three `2026-09-16-*-settings-section` notes are superseded by this note; those notes keep their rationale for the Remote faces, the component-local read state, the unfiltered selection, and the read-time cost and outcome semantics.

No Host API, wire type, Remote method, session event, or prompt changed. The Remote faces keep their exact-arity call convention, so the [Settings Remote-arity note](../bug-fix/2026-09-17-settings-section-remote-arity.md) stays authoritative for its decision and only its scenario path moved.

The regenerated client slot catalog (`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`) now lists the three panels under `main` and their glyphs under `sidebar.panellist`, which is what `cordis_inspect what:"client"` serves to a model inspecting its own UI seats.

The cost is one duplicated pane-surface CSS block per package. A shared surface primitive was rejected: `ui-primitives` is the only place a control may be shared, and three fork-local panels with different content do not yet justify promoting one.
