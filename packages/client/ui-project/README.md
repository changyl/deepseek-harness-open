---
description: "Web GUI global panel for durable project boards: one Projects panel reading the `project` Remote namespace, listing the host's stored projects and rendering the status lanes, ready tasks, and stranded tasks of the one the reader opens; for users and maintainers of the project surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-project

English | [中文](README.zh.md)

## Summary

This package adds a Projects panel to the Web GUI's global sidebar panels: the durable project boards stored on the host, read from the `project` Remote namespace. The listing reads once when the panel opens and again on Refresh; opening one project reads that project's board. Each row carries the title, the status word, and the task, ready, and stranded counts, and a listing the deployment bound cut says so. The board shows the five status lanes with each task's dependency and session counts, plus the ready and stranded id lines when the host reported any.

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

Mount this plugin in a Web composition that also mounts the `project` Host namespace; the sidebar's global panel row then opens this panel in the centre column. The panel is read-only: it lists what the store holds and reads one board on request. Creating a project, adding a task, linking a session, or changing a status stays with the model's `project` tool, which carries the compare-and-set revision those writes require. The panel owns only its own read state, so nothing it renders outlives the panel and no store, cache, or persisted value is involved.

The panel reads the listing once when it mounts, and the Refresh button starts the next listing read while the previous one is in flight. Refresh also closes the open board, so the panel never shows a board beside a listing that may no longer match it. Selecting a Session or starting a New Session returns the centre column to the Conversation.

### What the panel shows

The listing has three states: a status line while reading, a failure notice with a Refresh button when the read is refused, and otherwise one row per stored project. A row carries the project title as its selectable control, the localized status word (`Active` or `Closed`), and the task, ready, and stranded counts the Host reported. A listing the deployment's bound cut renders the truncation notice under the rows.

Opening a project reads its board and renders the project title, then one lane per status — To do, In progress, Blocked, Done, and Cancelled — each holding that status's tasks in creation order with the task title and its dependency and session counts. A project with no tasks renders an empty-board notice instead of the lanes. When the board reports tasks that can start now or `doing` tasks whose blockers are unfinished, the panel adds a ready line and a stranded line naming those task ids; the stranded line is rendered as a warning, because a task marked in progress whose dependency is unfinished is a disagreement worth seeing.

The board is re-read on each selection and after a Refresh, and never updated in place.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The plugin is a presentation surface over one Remote namespace. Its node half is an inert Loader entry; the browser half registers dictionaries, one global panel, and the sidebar row that opens it, and the panel reads through injected `list` and `board` callbacks rather than reaching for a client context. The Remote call, its request validation, the listing bound, and the failure vocabulary belong to the [Host namespace](../../api/project/README.md); this package decides only how to draw the answer and what to say when there is none.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Node half: the empty `apply` that gives the package a Loader entry |
| [`src/client/index.ts`](src/client/index.ts) | Dictionaries, the `list` and `board` Remote face, and the `main` + `sidebar.panellist` registrations |
| [`src/client/ProjectPanel.tsx`](src/client/ProjectPanel.tsx) | The panel component, its lane order, and its task row |
| [`src/client/ProjectPanelIcon.tsx`](src/client/ProjectPanelIcon.tsx) | The sidebar row glyph |
| [`src/client/locales.ts`](src/client/locales.ts) | The `projects` dictionaries and their key type |
| [`src/client/ProjectPanel.module.css`](src/client/ProjectPanel.module.css) | Panel styling over the shared theme tokens |

### Slot and registration

The plugin declares `inject = ['slots', 'locale', 'remote', 'remote.project']`, registers the `projects` dictionaries inside `ctx.effect(...)`, and binds them to the `t` seat. It registers into the layout's `main` keyed slot and the sidebar's `sidebar.panellist` list through `ctx.slots.inject`, so each contribution waits on its declaration, leaves with the caller's fiber, and is re-established when the declarer reloads.

Both registrations carry the same panel id, `project`: the sidebar row takes it as its list `id` and `order: 10`, and the centre column takes it as the `main` key. The row's `label` reads the dictionary's `nav` key, and the panel carries `locale: 'projects'`, and its `inject` face supplies exactly two members: `list`, which calls `ctx.remote.project.list()` with no filter, and `board`, which calls `ctx.remote.project.board(id)`. A refused call becomes an `Error` reading `project.list failed: <code>: <message>` or `project.board failed: <code>: <message>`; the panel renders its failure notice for any rejection and classifies nothing further.

### Rendering rules

The component props are the main slot's runtime share, the bound locale share, and the injected face. Two pieces of load state are component-local: the listing (reading, failed, or the listing in hand) and the board view (idle, reading, failed, or the board in hand). The Refresh control is disabled while a listing read is in flight, and opening a project replaces the board view with its reading state. Rendering is a straight reading of the wire values: one row per listed project, then the open board's five lanes, its empty-board notice, or its ready and stranded lines. Every state renders inside the panel's own scrolling surface, because the centre column clips overflow.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the panel is not enough. They move from the browser page to the namespace it reads and the store behind that namespace.

- [api/project](../../api/project/README.md) — the `project` Remote namespace: its listing and board methods, its wire types, and its failure codes.
- [project store](../../project/project/README.md) — the durable board, its compare-and-set revisions, and its dependency rules.
- [project tool](../../project/tool-project/README.md) — the model-facing consumer that owns every write to a board.
- [ui-sidebar](../ui-sidebar/README.md) — the global panel row that selects this panel.
- [ui-layout](../ui-layout/README.md) — the `main` keyed slot the panel occupies, and `ctx.layout.selectPanel`.
- [Slots reference](../../../docs/subsystems/slots.md) — how a client plugin declares and fills a slot.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. The panel reads stored board state through `ctx.remote.project`; it adds no prompt section, no tool schema, and no session event.

#### Token effect

None directly. The page never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries; the boards it displays were written by the model's own tool calls elsewhere.

#### KV Cache effect

None. Reading a board alters no request, so no cached prefix can be invalidated by opening or refreshing the page.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current page. They are current package constraints, not a board roadmap or a task backlog.

- **Reads only** — the panel lists projects and reads boards. It never creates, renames, or closes a project and never adds, edits, links, or re-statuses a task; those writes need the compare-and-set revision the model's `project` tool carries.
- **No selection and no paging** — the listing sends no workspace filter and always hides closed projects except as the Host includes them, and it has no cursor or offset. A listing the deployment bound cut is reported as truncated, not paged.
- **Not live** — nothing streams and nothing polls. The listing is read on mount and on Refresh, the board on selection and after a Refresh, and a read that arrives while another is in flight is not queued.
- **A board is a snapshot** — the view shows the board the last read answered. If the model changes a task in that project, the page shows it only after another selection or Refresh.
- **Counts, not history** — a task row carries its title, dependency count, and linked-session count. There is no per-task history, no author, and no external issue link, because the board keeps none.
- **Selection is not persisted** — the selected panel lives in the in-memory layout state, so a page reload returns the centre column to the Conversation.
- **Mounted only where the Web bundle is** — the panel exists only in a composition that mounts this plugin, which the shipped Web bundle does.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no durable state and no cross-plugin mutable state: it holds component-local read state, reads one Remote namespace on demand, and defines no store or cache. Its plugin spec covers the empty host entry, the declared injections, the dictionary pairing, the refused-call classification, and recovery across late declaration and declarer reload.
