---
description: "Host Remote owner for the project namespace: one bounded listing and one board read answering a stored project's tasks, status lanes, ready tasks, and stranded tasks over the project store."
kind: "package-reference"
---
# Project Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-project` exposes the generated `ctx.remote.project` namespace for a browser project board. `list(filter?)` answers a bounded listing of stored projects with the task, ready, and stranded counts a board header renders, and `board(id)` answers one project's complete task list, its five status lanes, and the ids of its ready and stranded tasks. The controller adds no domain policy of its own: validation, dependency rules, and compare-and-set revisions all live in the project store, so a call always reflects what is stored at that moment. An unknown project answers `project/not-found` rather than an empty board.

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

Mount this package as a Loader entry in the Web application, beside the project store.

```yaml
- name: '@deepseek-ai/dsh-project'
- name: '@deepseek-ai/dsh-tool-project'
- name: '@deepseek-ai/dsh-api-project'
```

The `dsh-web-app` bundle mounts exactly that arrangement: `project` and `tool-project` come from the base layer, and this controller is the only thing the Web layer adds. Its generated `./typert` export carries the Host descriptors into the strict Typert registry, and its generated `./remote` export is the Client contribution that `dsh-api-remotes` mounts, which is what makes `ctx.remote.project` callable from the browser. The controller requires `ctx.projects`; a composition without the store fails to load rather than answering empty listings.

`list(filter?)` answers the rows a board header renders. An absent filter selects every open project; a present one narrows by `workspace`, which matches the stored canonical path by string equality, and by `includeClosed`. The request is validated with a strict schema at the wire boundary, so an unknown key or a wrongly typed field raises `gateway/bad-request` with the codec's issues and never reaches the store. Every row is a summary rather than a project: identity, title, status, optional workspace, timestamps, the compare-and-set revision, and the counts `tasks`, `ready`, and `stranded`. Rows keep the store's listing order, newest created first, and `truncated` reports that the deployment's bound cut the answer.

The bound is `maxProjectsListed`, and it applies to the complete result rather than to a page. A truncated answer therefore tells a client that more projects exist, not where to continue: the namespace has no offset or cursor, so a board that must show every project needs a larger configured bound.

`board(id)` answers one project in full. `project` carries every task in creation order, each with its identity, title, status, dependencies, linked sessions, and timestamps; `columns` groups the same tasks by status into the five lanes `todo`, `doing`, `blocked`, `done`, and `cancelled`, preserving creation order inside each lane; `ready` names the `todo` tasks whose blockers are all finished and `stranded` names the `doing` tasks whose blockers are not, both as ids in creation order. The two lists are derived from the same dependency edges the lanes carry, so a client renders lane membership and workability from one answer.

Both mappings are written field by field, so renaming a field in the project domain is a compile error here rather than a silent wire change. Branded identities widen to strings, arrays are copied, and `workspace` is omitted entirely when the project was not created from a working directory.

Expected failures reach the caller as stable Remote codes. A filter that fails the strict schema and an id that is empty or only whitespace both raise `gateway/bad-request`; an id no stored project carries raises `project/not-found` with the offending `projectId` in its details. A store failure propagates unchanged, so a storage fault stays visible as itself.

The generated [configuration catalog](../../../docs/config-catalog.md) lists every plugin config in the repository; this package accepts one field:

| Field | Default | Meaning |
|---|---|---|
| `maxProjectsListed` | `20` | Maximum projects one `list` answer carries. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The controller is a projection, not an owner. It injects `ctx.projects`, validates the one untrusted input at the wire boundary, bounds the listing, classifies an unknown id, and maps store views onto wire types. It holds no cache and no state, so two calls read the store twice and a task change between them is visible on the second call. The board is computed by the store's own board derivation, so lane membership and workability cannot drift from the rules that accept or refuse a task change.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `ProjectController`: the `@Remote` methods, the filter schema, the listing bound, and the view-to-wire mappings |
| [`src/types.ts`](src/types.ts) | The wire types the Client consumes plus the `project/not-found` code declaration |

### Service and namespace

`ProjectController extends TypertRemoteService` registers the service key `projectController` and the wire namespace `project`, which is what a Client reaches as `ctx.remote.project`. Its `static inject = ['projects']` names the only service it answers from; the Gateway discovers the namespace through `typertRemote`, so a Host composition without the gateway can still mount the controller. Its `Config` carries `maxProjectsListed`.

### Methods

| Method | Request | Answer |
|---|---|---|
| `list` | `filter?`: `workspace`, `includeClosed`, both optional | `ProjectListWire`: bounded summaries in listing order plus the truncation flag |
| `board` | `id`: project identity as it appears on the wire | `ProjectBoardWire`: the project, its status lanes, its ready ids, and its stranded ids |

### Failures

| Code | Raised when |
|---|---|
| `gateway/bad-request` | The filter fails the strict wire schema, with the codec issues in the details, or the id is empty or only whitespace |
| `project/not-found` | No stored project carries the id; the details carry `projectId` |

### Wire values

| Type | Meaning |
|---|---|
| `ProjectFilterWire` | Selection one `list` call carries |
| `ProjectSummaryWire` | One listing row: identity, title, status, optional workspace, timestamps, revision, and the three counts |
| `ProjectListWire` | One bounded listing plus whether the bound cut it |
| `ProjectViewWire` | One project with every task in creation order |
| `ProjectTaskWire` | One task: identity, title, status, dependencies, linked sessions, and timestamps |
| `ProjectBoardWire` | One board: the project, the five lanes, the ready ids, and the stranded ids |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the wire namespace to the store behind it, then to the Remote model that carries the call.

- [Project subsystem](../../../docs/subsystems/project.md) — the authoritative record and view contracts, the dependency rules, the store error codes, and the generated `ctx.projects` API.
- [project group map](../../project/README.md) — the store, the model-facing `project` tool, and the human `/project` command.
- [api group map](../README.md) — the other Remote namespaces and how they are assembled.
- [API Gateway reference](../../../docs/api-gateway.md) — the Typert programming model, generation pipeline, and runtime invocation.
- [Typert subsystem reference](../../../docs/subsystems/typert.md) — the contracts shared by protocol, Gateway, and consumer assemblies.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. `project.list` and `project.board` answer a browser board with records the model-facing `project` tool already read or wrote; the namespace adds no prompt section, no tool schema, and no session event.

#### Token effect

None. The namespace never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries.

#### KV Cache effect

None. Reading a project does not alter a request, so no cached prefix can be invalidated by it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what this namespace can answer today. They are current package constraints.

- **Reads only** — the namespace exposes no write or mutation; creating, renaming, closing, and changing a project's tasks stay with the model-facing `project` tool and the `ctx.projects` store API.
- **No streaming or change feed** — both methods are unary, so a board page polls, and the freshness of a lane is the client's polling interval.
- **No paging or cursor** — a listing is cut by `maxProjectsListed` and reports `truncated`; a client that needs the rest cannot ask for a later page, because the request carries no offset.
- **`stranded` is a reading, not a refused write** — the store validates the task a request changes rather than the tasks that depend on it, so reopening a finished blocker can leave a `doing` dependent in `stranded` until a later board read shows it.
- **Mounted only where the Web bundle is** — a Host composition without this row has no `ctx.remote.project`, and the Client contribution in `dsh-api-remotes` is absent with it.
- **No client board surface is shipped** — this package is the Host half of a board page; no `packages/client/ui-project` exists yet, so a consumer owns the presentation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The controller owns no durable state and no diverging observation of its own; it validates one request, bounds one listing, and classifies an unknown project, and its spec pins each of those behaviors.
