---
description: "The human /project command over the durable project board: list this working directory's projects or render one board, for users reading a board without spending a model turn."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-project

English | [中文](README.zh.md)

## Summary

`dsh-command-project` puts the durable project board on the human's side of the composer. `/project` lists this working directory's projects with their revision and finished-task counts; `/project <id>` renders one board — its lanes, the tasks ready to start, and the ones stranded behind an unfinished dependency — without spending a model turn. The board is durable host state owned by [`dsh-project`](../project/README.md) and shared by every session in the same directory. The command is read-only by design: changes belong to the model's [`project` tool](../tool-project/README.md).

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

Use this package when a person should be able to read the board directly: which projects exist here, what state each one is in, and what work can start now. Mount it beside the store it reads and the command registry that dispatches it.

### When to choose it

Choose it for reading, not for changing. A mutation needs the revision the caller last read, which the model's tool carries between calls and a bare command invocation cannot; giving the command write verbs would either bypass the compare-and-set contract or ask a person to type a revision by hand. The shipped `dsh-base` bundle mounts this command beside [`dsh-project`](../project/README.md) and [`dsh-tool-project`](../tool-project/README.md), so both the person and the model read one board.

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/data
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-project'
- name: '@deepseek-ai/dsh-command-project'
```

### Command grammar

| Invocation | Result |
|---|---|
| `/project` | The projects of the calling session's working directory, newest first |
| `/project <project-id>` | That project's board |
| `/project <id> <id>` | Refused: `Name one project id, not several.` followed by the usage line |
| `/project <unknown-id>` | Refused: `No project <id> exists. Run /project to list the projects of this working directory.` |

### What the list shows

An empty working directory renders `No project exists for this working directory yet. Ask the model to create one, then run /project again.` Otherwise the first line is `Projects (N):` and each following line carries the project's id, title, status, revision, and finished-task count over its total:

```text
Projects (2):
  8f1c… · Release · active · revision 4 · tasks 3/7 finished
  2b90… · Migration · closed · revision 11 · tasks 11/11 finished
```

The usage line closes the list, so a reader who wants one board learns the argument from the output.

### What the board shows

The header names the project, its status, and the revision a mutation would have to carry. Then one block per non-empty lane, in the order `todo`, `doing`, `blocked`, `done`, `cancelled`, with one line per task:

```text
Project 8f1c… · Release · active · revision 4
todo (2):
  [todo] task-2 second (blocked by task-1)
  [todo] task-3 third
doing (1):
  [doing] task-4 fourth (blocked by task-1)
Ready: task-3
Stranded: task-4 (a blocker is unfinished)
```

A task line appends `(blocked by …)` only for dependencies that are neither done nor cancelled, so the suffix names what is actually holding the task up. A project with no tasks renders `  (no tasks)`. `Ready:` lists the `todo` tasks whose blockers are all finished and `Stranded:` the `doing` tasks that still have an unfinished blocker; either line is absent when its set is empty, which is what makes the disagreement between a stored status and the dependency graph visible at a glance.

### Failures the reader sees

A second id is refused before the store is read, naming the grammar (`Name one project id, not several.`). An id the store does not hold produces the actionable sentence that names the listing command. A store that cannot answer at all — an uninitialized domain, an unreadable medium — surfaces its own failure rather than an empty list.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the command and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The command is a thin, read-only renderer over [`ctx.projects`](../project/README.md) and the board derivation that package already exports. It owns three things the store does not: the argument grammar, the text a person reads, and the workspace scope — the calling session's working directory. It owns no state, so running it cannot change what the board contains, and a restart changes nothing about what it prints.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: argument grammar, list and board renderers, caller workspace scope, command registration |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `apply` and no default export, and it has no `Config` because it has no tunable of its own. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Caller identity and workspace

The command reads the calling agent from the invocation: `agent.session.header.cwd` becomes the workspace filter for the listing. A session with no working directory lists every project instead of none, which is the reading a reader can act on: an unfiltered list shows what exists and lets the reader pass an id explicitly.

### Read-only by design

Every mutation route in this tree carries a revision. The command has no argument for one, so it has no way to satisfy the compare-and-set contract; adding a write verb would mean either an unguarded write or a revision typed by hand. The model's [`project` tool](../tool-project/README.md) already owns mutation with the revision contract intact, and a board UI would own the interactive case.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the command to the store it reads and to the surfaces that change it.

- [Project subsystem](../../../docs/subsystems/project.md) — the store contract behind the listing and the board, including the error codes.
- [project group map](../README.md) — the sibling group page and its package table.
- [project store package](../project/README.md) — the durable store, its dependency rules, and the board derivation this command renders.
- [Model-facing project tool](../tool-project/README.md) — the mutation surface that carries the compare-and-set revision.
- [Durable project board Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.md) — the design behind the store and its rules.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/project` command

#### What the model sees

Nothing. The command is dispatched by the human's UI and never reaches the model: it contributes no prompt section, no tool schema, and no derived history, so the request a model sees is identical whether or not it was run. The only events it writes are the runtime's `command/run` and `command/done` pair.

#### Token effect

None on the model. The rendered list or board is returned to the command surface that dispatched it.

#### KV Cache effect

None; the command assembles or sends no provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the command does not do. They are current package constraints, not a task backlog.

- **Read-only** — the command cannot add a task, change a status, or close a project; every mutation belongs to the model's `project` tool or to a future board UI.
- **The list follows the session's working directory** — it filters by `agent.session.header.cwd`, so a project created from another spelling of the same directory does not appear; a session with no working directory lists every project instead.
- **No paging** — a board renders in full, so a project with hundreds of tasks prints every lane; the store's task bound is the only ceiling.
- **Titles are printed whole** — the command has no `maxTitleLength` equivalent, so a stored title is rendered exactly as recorded.
- **No Remote surface or board UI** — nothing renders the board in the Web client yet, so the command and the model tool are the only readers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The command owns no state and derives every line from `ctx.projects` and that package's `boardOf`; an invariant here could only re-read the same records the store just served. The behavior worth pinning — the argument grammar, both renderers, the caller's workspace scope, the refusal texts, and the registration lifetime — is proven by this package's spec against a real store composition.
