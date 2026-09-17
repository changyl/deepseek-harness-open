---
description: "The project group map: one durable board of projects and tasks per working directory, with the store that owns it and the model-facing tool, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/project

English | [中文](README.zh.md)

## Summary

The project group keeps work that outlives a single agent session. `project` owns the durable board — one record per project holding its tasks, its compare-and-set revision, and the dependency rules that decide what can start — `tool-project` is the model-facing adapter that lists, creates, reads, and changes it, and `command-project` renders the same board for people through `/project` without spending a model turn. Boards are shared by every session in the same working directory, and both packages are host-side: the store reaches no model by itself, and the tool reaches one only through its bounded results.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`project`](project/README.md) | Durable projects and tasks: compare-and-set revisions, dependency rules, and status validation | `ctx.projects` |
| [`tool-project`](tool-project/README.md) | Model tool `project` with `list`, `create`, `read`, `add_task`, `update_task`, and `link_session` | registers on `ctx.tools` |
| [`project-context`](project-context/README.md) | Reports this session's linked board tasks to the model once per board state | listens on `agent/pre-step` |
| [`command-project`](command-project/README.md) | Human `/project` command listing this directory's projects and rendering one board, read-only | registers on `ctx.commands` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Project subsystem](../../docs/subsystems/project.md) — the authoritative contract: the record shapes, views, error codes, and generated `ctx.projects` API.
- [Storage subsystem](../../docs/subsystems/storage.md) — the domain data form the store opens over a configured backend.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-project) — the `project` tool schema the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-project) — the store's accepted configuration and its default.
- [Durable project board Agent Note](../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.md) — why project work is a separate durable domain rather than a durable `todo_write`.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
