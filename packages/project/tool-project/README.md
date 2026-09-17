---
description: "The model-facing project tool over the durable project board: one tool with list/create/read/add_task/update_task/link_session actions, for users and maintainers choosing, configuring, or debugging it."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-project

English | [中文](README.zh.md)

## Summary

`dsh-tool-project` gives the agent one tool for work that must outlive its session: list the projects in this working directory, create one, read its lanes, add and update tasks, and link the calling session to a task. The board is durable host state owned by [`dsh-project`](../project/README.md), shared by every session in the same directory, so a plan survives restarts and hand-offs. Every mutation carries the revision the model last read, which means a stale edit is refused instead of overwriting another session's change, and every result is bounded by configuration.

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

Use this package when a deployment wants the agent to keep durable, shared task state: a plan that outlives one session and that the next session in the same directory picks up. Mount it beside the store it reads.

### When to choose it

Choose it for the board work survives in. The session's own working memory stays with [`dsh-tool-todo`](../../todo/tool-todo/README.md): `todo_write` is a whole-list replacement the agent rewrites freely, while this tool changes a durable record other sessions also read. Mount both when the agent should plan a session and track the surrounding work; mounting only this one is right when the durable board is the point.

### Minimal composition

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/data
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-project'
- name: '@deepseek-ai/dsh-tool-project'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `maxProjectsListed` | `20` | Maximum projects one `list` result carries |
| `maxTasksListed` | `50` | Maximum tasks one `read` result carries, across every lane |
| `maxTitleLength` | `120` | Maximum characters of one project or task title in a result |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-project) is the exhaustive source for the accepted fields.

### What each action does

| Action | Arguments | Result |
|---|---|---|
| `list` | `include_closed?` | Bounded project summaries; `truncated` says the bound was hit |
| `create` | `title` | The new project's `id`, `revision`, and summary |
| `read` | `project_id` | The bounded board: lanes, `ready` and `stranded` task ids, task rows, `truncated` |
| `add_task` | `project_id`, `revision`, `title`, `blocked_by?` | The project summary and the new `revision` |
| `update_task` | `project_id`, `revision`, `task_id`, `title?`, `status?`, `blocked_by?` | The project summary and the new `revision` |
| `link_session` | `project_id`, `revision`, `task_id` | The project summary and the new `revision` |

`blocked_by` is the complete dependency list for the task, not an addition to it. The workspace comes from the calling session's working directory: `create` stores it and `list` filters by it, so a session without one creates an unscoped project that no workspace-filtered listing returns.

### The revision contract

Every mutation needs the `revision` returned by the last read of that project. A mutation presented with an older revision is refused — the tool reports that the project moved — and the model re-reads and retries. Because the record is shared, a second session editing the same project produces exactly this refusal rather than a silent overwrite; the losing edit has to be re-read and re-applied.

### Failures the model sees

Missing arguments are named (`title is required for this action`, `revision is required for this action`), unknown ids are reported with the action that finds one (`no project <id> exists; use action "list" to find one`, `no task <id> exists in this project`), and the store's own rules surface as their messages: a title that is empty or too long, a dependency that is unknown, a self-dependency or a cycle, a status that contradicts the blocker state, a task bound reached, a closed project, or a stale revision.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the tool and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The tool is a thin, bounded adapter over [`ctx.projects`](../project/README.md). It owns four things the store deliberately does not: the argument grammar the model writes, the bounds applied to every result, the mapping from argument names to store calls, and the presenter card. It owns no state, so a restart changes nothing about what the board contains.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, action dispatch, result bounds, tool registration, presenter |

### Export shape

The plugin is a function/namespace plugin: it exports `name` / `inject` / `Config` / `apply` and no default export. A stray `export default` would make the Loader's `unwrapExports` collapse the module and drop `inject` (see [postmortem 0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

### Caller identity and workspace

`execute` reads the calling agent from the tool execution context: `exec.agent.session.id` becomes the session a `link_session` call records, and `session.header.cwd` becomes the workspace `create` stores and `list` filters by. A call with no owning agent session has no session to link and no working directory: `link_session` refuses, `create` stores a project with no workspace, and the remaining actions still work.

### Result bounds

Every list and board result is sliced to the configured bound and reports `truncated: true` when it dropped anything; titles are shortened with an ellipsis at `maxTitleLength`. The bounds exist so one tool result cannot grow with the board: a project with hundreds of tasks still returns a result the model can read, and it can re-read to see later slices.

### Bounded result types

`ProjectSummary`, `TaskRow`, and `BoardResult` are the only shapes the render and the output schema read; each is a plain record of primitives, so the model-facing output stays stable across store changes.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the tool to the store it reads and the catalogs that pin what the model receives.

- [Project subsystem](../../../docs/subsystems/project.md) — the store contract behind every action, including the error codes.
- [project group map](../README.md) — the sibling group page and its package table.
- [project store package](../project/README.md) — the durable store and its dependency rules.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-project) — the exact `project` schema the model receives.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-project) — every accepted bound and its default.
- [Durable project board Agent Note](../../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.md) — the design behind the store and its rules.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees one generated [`project` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-project): a required `action` enum of `list`, `create`, `read`, `add_task`, `update_task`, and `link_session`, plus the optional `project_id`, `revision`, `title`, `task_id`, `status`, `blocked_by`, and `include_closed` arguments those actions use. The description states the revision contract — every mutation needs the revision returned by the last read, and a stale revision must be re-read and retried — and that `todo_write` holds this session's work while this board holds work that must survive the session.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable for a given configuration.

#### KV Cache effect

None beyond the tool schema sitting in the request header: the definition is prefix-stable while its visibility and configuration are unchanged, and the tool appends no prompt content of its own.

### Tool-call history and result

#### What the model sees

Each call's arguments stay in the assistant history as the model wrote them, and each result is a bounded record: project summaries for `list` and `create`, the board for `read`, and the updated summary plus the new `revision` for a mutation. A failure returns the store's message, so the model learns which rule refused it. The tool writes no session events of its own beyond the ordinary tool call and result pair: the board lives in the storage domain, not in the log, so a board change appears in the session only as the call that made it.

#### Token effect

Result size is bounded by `maxProjectsListed`, `maxTasksListed`, and `maxTitleLength`, so growth scales with the configuration rather than with the board. Call arguments and results remain until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Truncation, not paging** — a bound-hit result reports `truncated: true` and stops; there is no cursor or offset argument, so a model that needs the omitted rows re-reads and gets the same first slice.
- **No project rename or close action** — the store can rename and close a project, but the tool exposes neither, so a model cannot retire a board; a human or another consumer must do it.
- **Workspace scoping follows the session** — `create` records the calling session's working directory and `list` filters by it; a session without one creates a project no workspace-filtered listing returns, and a project created from another directory is invisible to this session's `list`.
- **A concurrent editor causes refusals, not merges** — the revision contract means two sessions editing one project take turns: the loser re-reads and re-applies, and nothing merges fields automatically.
- **The prompt note is a snapshot, not a subscription** — [`dsh-project-context`](../project-context/README.md) reports the session's linked tasks once per board state, so a board that changes while a request is in flight is visible only on the next request.
- **No task history or attribution** — a `read` shows current task state; the board keeps no per-task history, no author, and no external issue-tracker link.
- **Model-facing rows are per-profile** — `dsh-base` mounts this tool globally for the headless profiles, while the Web profile withdraws that row and mounts it from its agent presets, so a session's catalog is a function of the preset it joined.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The tool owns no durable state and derives every result from `ctx.projects`, whose own rules the store validates before its write; an invariant here could only re-read the same records the store just served. The behavior worth pinning — bounded results, the revision carried between calls, and the caller's session and workspace reaching `link_session` and `create` — is proven by this package's spec against a real store composition.
