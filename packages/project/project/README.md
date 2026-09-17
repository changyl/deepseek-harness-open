---
description: "Durable project and task board (ctx.projects) for hosts choosing, mounting, or debugging the project storage domain, its compare-and-set revisions, and its dependency rules."
kind: "package-reference"
---

# @deepseek-ai/dsh-project

English | [中文](README.zh.md)

## Summary

`dsh-project` keeps a durable board of projects and their tasks so work outlives one agent session. Each project is one schema-validated record in the `project` storage domain holding its own tasks, and every mutation carries the revision the caller last read, so a stale edit is refused instead of silently overwriting another session's change. The store validates titles, dependency edges, and status-versus-blocker agreement before it writes. It is host-side state: it registers no tool, no prompt, and no session event, so nothing reaches a model until a consumer such as `dsh-tool-project` reads it.

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

Use this package when work must survive the session that started it: a deployment wants one board per working directory whose tasks keep their status, dependencies, and linked sessions across restarts, and several sessions in that directory share it.

### When to choose it

Choose it for durable, shared planning state. Avoid it for the working memory of one session — `todo_write` owns that — and avoid it when several processes must coordinate: this store is a single-process durable record, so a second harness instance sees a write only after it re-reads the medium.

### Minimal composition

The store opens the `project` domain through `ctx.storageDomain`, so a storage hub, a backend, and the domain form must be mounted beside it:

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/data
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-project'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxTasksPerProject` | `256` | Maximum tasks one project may hold |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-project) is the exhaustive source for the accepted field.

### What the store serves

`ctx.projects` returns detached views: a `ProjectView` carries the identity, title, status, workspace, revision, and every task in creation order, and each `TaskView` carries the task's identity, title, status, dependencies, and linked sessions. `board()` adds the layout a reader wants: `columns` groups tasks by status, `ready` lists `todo` tasks whose blockers are all finished, and `stranded` lists `doing` tasks that still have an unfinished blocker.

### Compare-and-set revisions

Every mutation takes a `ProjectRef` — the project id plus the revision the caller last observed. A mutation presented with an older revision is refused with `project/stale-version`, and the caller re-reads and retries. A request that changes nothing (re-linking the same session) keeps the stored record and does not bump the revision, so a no-op never invalidates another caller's token.

### Validation rules

- A title is trimmed and must be non-empty and at most 200 characters.
- `blockedBy` must name tasks that exist in the same project, cannot name the task itself, and cannot close a cycle between tasks.
- A task cannot become `doing` or `done` while any task it is blocked by is unfinished; it cannot become `blocked` unless at least one blocker is unfinished.
- Input and dependency validation run before the capacity check, so a caller submitting an unusable title or an unknown dependency learns that rather than that the project happens to be full.
- A closed project refuses every task operation with `project/closed`.

### Failures

| Code | Meaning |
|---|---|
| `project/not-found` | No stored project carries that identity, or the store has not initialized |
| `project/stale-version` | The presented revision is older than the stored one |
| `project/closed` | The project is closed and refuses task work |
| `project/unknown-task` | A referenced task does not exist in this project |
| `project/dependency-cycle` | The requested dependency would make a task reach itself |
| `project/invalid-input` | Empty or over-long title, or a status contradicting the blocker state |
| `project/limit-exceeded` | The project already holds `maxTasksPerProject` tasks |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the store and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

Tasks live inside their project record rather than in a table of their own. One durable write therefore carries both a task change and the revision it bumps, and the compare-and-set token can never disagree with the task list it belongs to. The domain form supplies the rest: schema validation at the durable boundary, synchronous reads from authoritative in-memory state, and one ordered write chain per domain.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `ProjectStore` service, `Config`, domain open, and the one `mutate` write path |
| [`src/board.ts`](src/board.ts) | Pure derivations and validation: titles, task ids, dependency acyclicity, status rules, board layout |
| [`src/spec.ts`](src/spec.ts) | Domain declaration: record schemas, `defineDomain` spec, version |
| [`src/errors.ts`](src/errors.ts) | `ProjectError` and the stable `ProjectErrorCode` set |
| [`src/types.ts`](src/types.ts) | Public views, the filter, and the branded `ProjectId` and `TaskId` |

### Durable shape

The domain is `project`, version 1, with one `projects` table keyed by a random uuid. A record holds `title`, `status`, optional `workspace`, `createdAt`, `updatedAt`, `revision`, and the `tasks` array; a stored task holds `id`, `title`, `status`, `blockedBy`, `sessionIds`, and its timestamps. Deleting a record deletes that project's tasks with it, which is what makes the domain the only owner of task state. Task ids are allocated as `task-<n>` past the highest numbered task the project already holds, so creation order survives a reload.

### Validation, then durability

Every rule the store enforces lives in `board.ts` as a pure function, so it can be exercised without a storage backend and the store's remaining job is durability plus the compare-and-set write. `ProjectStore.mutate` reads the stored record, refuses a missing project and a stale revision, and then re-checks the revision inside `table.update`'s chain slot, so two mutations racing on the same revision cannot both land. The transform returns `undefined` when the request changes nothing, and the store keeps the stored record in that case — no revision bump and no change event for a write that changed nothing.

### Lifecycle

`Service.init` opens the domain and keeps its table handle; the domain close is registered as an effect on the same fiber. Until that initialization completes, `ctx.projects` exists but every operation fails loud with `project/not-found` and a "not initialized" message rather than reading an absent table.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the durable domain to its consumer and the storage layer beneath it.

- [Project subsystem](../../../docs/subsystems/project.md) — the authoritative contract for the views, error codes, and generated `ctx.projects` API.
- [project group map](../README.md) — the sibling group page and its package table.
- [Storage subsystem](../../../docs/subsystems/storage.md) — the domain data form this store opens over a configured backend.
- [tool-project package](../tool-project/README.md) — the model-facing consumer of this store.

-----

<a id="model-experience"></a>
## Model Experience

### Project records and task views

#### What the model sees

Nothing. `ctx.projects` serves host-side consumers only: the package registers no tools, injects no prompts, and writes no session events, so no request field ever carries this package's data. The model sees project state only where a consumer such as [`dsh-tool-project`](../tool-project/README.md) returns it as a recorded tool result.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the store is a poor fit. They are current package constraints, not a task backlog.

- **One process owns the durable record** — there is no cross-process change push, so a second harness instance sees a write only after it re-reads the medium; the store also derives no cache of its own, so every read serves the domain's authoritative in-memory state.
- **Projects are matched by working-directory string** — a project's `workspace` is the canonical path recorded at creation and compared by string equality, not a workspace-registry id, so renaming or moving the directory makes the path stop matching.
- **`list` is newest first by creation time** — same-millisecond ties keep stable insertion order rather than a named secondary key, and the filter offers only workspace and closed-project selection.
- **No history and no attribution** — a record holds the current task state only: there is no per-task or per-change history, no multi-user attribution, and no audit trail beyond `createdAt` and `updatedAt`.
- **No external tracker sync** — nothing reads or writes GitHub, Jira, or any other issue tracker; this domain is the only owner of the board.
- **No model-visible context paragraph yet** — a `project-context` plugin that would put the linked project's state into the request is deferred; until it lands, a model learns about the board only by calling a consumer's tool.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Every rule the store enforces runs inside the process before the domain write, and the domain form already owns the durability relation it relies on — schema-validated records and one `domain/changed` per landed write — so an independent companion would re-run those writes instead of observing a relationship this package does not already check. The load-bearing rules (revision monotonicity, dependency acyclicity, and status-versus-blocker agreement) are proven by this package's spec against a real storage composition.
