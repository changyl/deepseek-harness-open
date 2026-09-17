---
description: "Request-context note telling the model which durable project-board tasks this session is linked to, for users and maintainers of the project board."
kind: "package-reference"
---

# @deepseek-ai/dsh-project-context

English | [中文](README.zh.md)

## Summary

`dsh-project-context` tells the model which durable board tasks the current session is linked to. A board outlives the session that created it, so a task another session links this one to is otherwise invisible until the model calls the [`project` tool](../tool-project/README.md). The note is derived from `ctx.projects` at request time, bounded by a configured maximum, and injected once per board state: an unchanged board stays silent, while a reload or fork that re-reads the same board reads the same note again.

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

Mount it beside [`dsh-project`](../project/README.md) in any composition where a session should learn its board links without spending a call; the shipped `dsh-base` bundle mounts both. It registers one `agent/pre-step` listener, adds no tool and no prompt section, and lists at most `maxTasksListed` tasks (default 8).

The note reports the tasks whose `sessionIds` name this session, in store order: projects newest first, tasks in creation order. Each line carries the task id, title, status, its project's title and revision, and its blockers, so the revision a mutation must present is in front of the model before it writes.

<a id="understand-the-implementation"></a>
## Understand the implementation

`linkedTasks(projects, session)` reads the store's default listing — the session's `header.cwd` becomes the `workspace` filter, and a session without one reads the whole open store — and keeps the tasks whose `sessionIds` include this session. Closed projects stay out, exactly as the store's own listing keeps them out of what a reader sees by default.

`renderNote(entries, maxTasksListed)` renders the heading, one line per listed task, and a `- N further linked task(s) are not listed.` line when the bound cut the list; it returns undefined for an empty list.

The listener runs `{ prepend: true }` on the `agent/pre-step` waterfall: it awaits `next()` first, returns that decision unchanged when it is a `reject` or the call's signal is aborted, and otherwise appends one plugin-sourced message. The message is sent only when its text differs from the last note this instance sent, so an unchanged board costs nothing. It carries `source.kind === 'plugin'`, this plugin's name, and `form: 'snapshot'` with the same text as its section, so the session log records what the model read.

<a id="further-exploration"></a>
## Further Exploration

- [Project subsystem](../../../docs/subsystems/project.md) — the store contract, the board views, and the revision rules behind every line of the note.
- [project group map](../README.md) — the store, the model's write path, the `/project` command, and this note.
- [change-review-context](../../context/change-review-context/README.md) — the sibling pre-step note, which reports reader decisions instead of board links.

<a id="model-experience"></a>
## Model Experience

### Linked board tasks

#### What the model sees

One user-role message appended to the request, or nothing when the session links no task or the board renders the same note it last sent:

##### Project note

```markdown
This session is linked to tasks on the durable project board:
- Task `task-1` "cut branch" is todo in project "Release" (revision 4).
- Task `task-2` "write notes" is todo in project "Release" (revision 4, blocked by task-1).
```

#### Token effect

At most `maxTasksListed` lines plus a one-line remainder, sent once per distinct board state rather than every step; a board that has not moved adds nothing to the request.

#### KV Cache effect

Append-only: the note joins the request after the reusable prefix, so it extends the history instead of changing the cached part.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only tasks that name the session** — the note reports the tasks whose `sessionIds` include this session; the board does not push, and the plugin reads nothing outside the session's workspace when the session has a working directory.
- **A note repeats only when its text changes** — a board change that renders identically, such as a re-rating or an edit the listed fields do not carry, stays silent until the rendered text moves.
- **A snapshot, never a write** — the note states the board as of the request and carries the revision a mutation must present; the plugin writes nothing, so a concurrent writer still wins by revision.
- **A session without a working directory reads the whole open store** — the workspace filter is the session's `cwd`, so such a session sees every open project.
- **Closed projects are not reported** — they leave the store's default listing, so a task in one stops appearing even while its `sessionIds` still name the session.
- **The bound is not paging** — `maxTasksListed` truncates the list and states the remainder; there is no cursor and no second page.
- **The diff guard lives in memory** — a restart, reload, or fork re-reads the same board and sends the same note again.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no durable state and no relation that independent observations could diverge on — it reads the store at request time and injects a derived message — so its spec pins the link selection, the rendering, and the injection rules instead.
