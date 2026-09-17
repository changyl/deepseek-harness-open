# Agent Note: Render the durable project board as a Web Settings section

Status: implemented

English | [中文](2026-09-16-project-board-settings-section.zh.md)

> The Settings-section placement recorded here is superseded by [fork data panels as global panels](2026-09-17-fork-data-panels-as-global-panels.md); the Remote face, the component-local read state, and the read-only board semantics remain owned here.

## Problem

The durable board had a model-facing tool and a text command, and the browser could reach neither. [`dsh-tool-project`](../../../../packages/project/tool-project/README.md) reads and changes the board from inside an agent turn, and [`dsh-command-project`](../../../../packages/project/command-project/README.md) renders one board as text in a session transcript, but an operator who wanted to see which projects exist, what is ready, and what is stranded had to run `/project` and read the answer out of the conversation.

The Host side of the browser path already existed. [`dsh-api-project`](../../../../packages/api/project/README.md) publishes `ctx.remote.project` with two read methods, `list(filter?)` and `board(id)`, plain wire values, and a classified `project/not-found` failure, but nothing in the Web GUI called it — the namespace had a spec and no consumer.

The Settings shell is where the Web GUI puts deployment-wide, read-only panels, and a board is that kind of fact: durable, shared across sessions in one working directory, and read at the operator's request rather than the model's. The sibling usage section established the shape in [its note](2026-09-16-usage-settings-section.md).

## Decision

`@deepseek-ai/dsh-client-ui-project` ([package reference](../../../../packages/client/ui-project/README.md)) contributes one Settings section over `ctx.remote.project`. It registers through `ctx.slots.inject('settings.section', ...)`, so the contribution waits on the declaration, disappears when the declaration collapses, is re-established when the declarer reloads, and leaves with the caller's fiber. The entry carries `id: 'projects'`, `order: 40` — after the read-only deployment panels — a `label` read from its own dictionary, and `locale: 'settings.projects'`.

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.project']`, registers the `settings.projects` dictionaries inside `ctx.effect(...)`, and supplies exactly two injected members: `list`, which calls `ctx.remote.project.list(undefined)` — the declared optional filter goes explicitly, for the reason the [Settings Remote-arity note](../bug-fix/2026-09-17-settings-section-remote-arity.md) records — and unwraps the Remote result envelope, and `board`, which does the same for `ctx.remote.project.board(id)`. A refused call becomes an `Error` reading `project.list failed: <code>: <message>` or `project.board failed: <code>: <message>`; the section renders its failure notice for any rejection and classifies nothing further, because the Host already decided which failure a caller can act on.

The component's props are the Settings slot's runtime share, the bound locale share, and the injected face (`PropsRuntime<'settings.section'> & PropsLocale<typeof NS> & InjectFace<ProjectSectionInjected>`). Two independent states are component-local: the listing read (`loading`, `error`, the listing in hand) and the board view (`idle`, `loading`, `error`, the board in hand). The listing is read once on mount and re-read on Refresh, which also clears the open board; opening a project row reads that one board. A ready listing renders one row per project with its status word and its task, ready, and stranded counts, and states the deployment's `truncated` flag when the listing bound cut the answer. A ready board renders the host's title, the five status lanes in reading order with each task's dependency and session counts, the ready and stranded id lines when the Host reported any, and an empty-board notice when the project holds no task.

Four choices carry the design:

- **No store.** The read state is private to one section instance and nothing it draws survives a remount, so it stays component-local. A store declared at register would add a lifecycle, a sharing surface, and an invalidation rule for data no second entry reads.
- **Reads only.** Every mutation the store serves carries the compare-and-set revision the caller last observed, which is the model's tool contract. A browser edit surface would need its own authority decision about who may move another session's board, so this section reads and never writes.
- **No filter or paging controls.** The Host listing already bounds itself and reports `truncated`, and the store orders projects newest first. A selection model in the UI needs its own consumer evidence; shipping controls ahead of it would fix a query grammar in the presentation layer.
- **Two states, not one machine.** Opening a board must not disturb the listing already on screen, and a failed board read must not erase a good listing. Two independent states express that directly; one machine would have to encode the cross product.

Registration is what makes the section load, and each surface is explicit: the `tsconfig.client.json` aggregate reference, the `ui-project` row plus the `packages/bundle/web-app/package.json` dependency (a row whose package no manifest declares fails to import), hand-written `tsconfig.base.json` aliases — the `client-ui-*` package name does not match its `ui-project` directory, so the path generator cannot own them — the regenerated client slot catalog, which now lists the new occupant, and the client package map row that records what the package is for. One existing expectation moved with the change: the shipped-section roster in `packages/client/ui-settings-general/tests/shell.client.spec.ts` boots the real web-app roster and asserts the product sections in navigation order, so it now ends `agent-presets, usage, projects`, and the recorded settings-dialog goldens gained the navigation entry.

## Alternatives considered

**Render the board in the conversation through a tool card.** The `project` tool's results already appear there, but a card shows what one turn asked for. A Settings panel shows what the deployment holds, for a reader who is not driving a session.

**Add a dedicated route for boards.** The Settings shell already owns navigation, the locale seat, and the list scope. A new surface would need its own slot and its own place in the shell's navigation for one read-only page.

**Publish a client store so several surfaces could share one board.** Nothing else reads a board, and a store exists for state shared across entries or surviving a remount. Here it would be a cache with no second reader and no invalidation source.

**Move mutations into the browser.** The store's revision contract exists so two writers cannot silently overwrite each other. Handing a browser a revision it did not read, or minting one on its behalf, would move the decision of who owns a board out of the tool that documents it.

**Read every board up front.** The listing carries counts per project, so the panel answers "what is ready" without opening anything. Reading every board would multiply the cost of opening the page by the number of stored projects for data the reader has not asked to see.

## Consequences

An operator can see the deployment's projects, their workable and stranded counts, and any one board's lanes in the Web GUI, and the `project` Remote namespace has its first shipped browser consumer. The store, the tool, and the `/project` command are untouched, because this package reads the namespace and adds no Host behavior.

The section follows the same read-time discipline as the rest of the stack: it renders what the last read answered, so two operators on one deployment see the same board, and a change is visible only after a Refresh or a re-open. The board is never partially applied — the view holds one complete `ProjectBoardWire` or a failure.

The copy is locale-owned: the navigation label, headings, status words, count templates, ready and stranded lines, and every notice come from `settings.projects`, so the page follows the shell's locale and the component carries no product string.

The cost is a read per interaction: one listing read on mount and on Refresh, and one board read per opened project, with no cache between them. That is deliberate for a page whose numbers move when a model writes, and it keeps the panel's figures attributable to one query each.

## Deferred

No filter or paging control in the UI, even though the Host listing accepts a workspace selection and reports its own truncation; the section sends no filter. The board is not live: nothing streams, so freshness is the Refresh gesture. A project row shows counts rather than task titles until the reader opens it. No per-task history, author, or external tracker link appears, because neither the store nor the wire carries one. A recorded session fixture was not added because recording needs a model key, so the assembled page is covered by component specs and the replayed settings-chrome scenario rather than a fresh recording. No `./invariant` companion is published, because the package owns no durable state and no relation on which independent observations could diverge — its specs pin the registration, the dictionary parity, both Remote failure classifications, and the rendering rules instead.

## Testing

Twelve cases across two specs. The plugin spec runs the real `SlotRegistry` and `LocaleRuntime` with a provided `remote.project`: it keeps the host Loader entry inert, pins the exact injection list, checks the English dictionary against the Chinese key set, registers the section without reading the Remote eagerly, classifies a refused listing call and a refused board call as the failures the section can render, and proves the contribution follows a locale change and recovers across a late declaration and a declarer reload. The section spec renders the component over scripted reads: the listing read followed by the rows a reader opens, one board's lanes with its ready and stranded sets and per-task counts, an empty host with a truncated listing and an empty board, a project whose board holds no task, a failed listing with its retry, and a failed board read with the Refresh control held while the next listing read is in flight. `src/client/*` carries per-file 100% coverage.

The shipped registration surfaces are exercised together: `pnpm run test:gui` is green across the client and host GUI suites, both aggregate TypeScript faces build, and the replayed `apps/web/tests/settings-chrome.e2e.ts` scenario passes with the rebuilt client bundle, which is what proves the row loads in the real web profile rather than only in a hand-built context.
