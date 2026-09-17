# Agent Note: Tell the model which board tasks its session is linked to

Status: implemented

English | [中文](2026-09-16-project-context-note.zh.md)

## Problem

A durable board outlives the session that created it, and a task carries the sessions linked to it in its own `sessionIds`. That makes a link a fact about the board, not about the session's log: another session can link this one to a task between two of its turns, and nothing in the session's own history changes. The model therefore had no way to learn the link — [the durable project board note](../feature/2026-09-16-durable-project-board.md) recorded the gap in the sentence that said no prompt paragraph yet carried the current task into a request.

The `project` tool was the only path to the board, and a tool only answers when the model chooses to call it. A model with no reason to believe a board links it will not call one, so the link stayed invisible exactly when it mattered: at the start of a session another operator had already assigned work to.

## Decision

`@deepseek-ai/dsh-project-context` registers one `agent/pre-step` listener and contributes the session's linked tasks to the request that step is about to send. It is a function plugin (`name`, `inject`, `Config`, `apply`) named `project-context`, injecting only `['agents', 'projects']`, with one validated config field: `maxTasksListed`, a natural number of at least 1 that defaults to 8.

The note is derived, not stored. `linkedTasks(projects, session)` reads the store's default listing — the session's `header.cwd` becomes the `workspace` filter, and a session without one reads the whole open store — and keeps the tasks whose `sessionIds` include the session, in store order: projects newest first, tasks in creation order within each project. Closed projects stay out, exactly as the store's own default listing keeps them out of what a reader sees. `renderNote(entries, maxTasksListed)` then renders one heading, one line per listed task carrying the task id, title, status, its project's title and revision, and its blockers, and a single `- N further linked task(s) are not listed.` line when the bound cut the list; an empty list renders undefined.

The listener registers with `{ prepend: true }`, awaits `next()` first, and returns that decision unchanged when it is a `reject` or the call's signal is aborted — an aborted or refused step is not the place to add context. Otherwise it appends one plugin-sourced user message, and only when the text differs from the last note this instance sent. The message carries `source.kind === 'plugin'`, this plugin's name, and `form: 'snapshot'` with the same text as its section, so the session log records what the model read.

Four properties justify the shape:

- **Derived from the store rather than pushed into the session.** The store owns the board, and a link lives inside a project record; the note is recomputed at request time, so it needs no event, no subscription, and no second source of truth that could drift from the board.
- **The revision travels with the note.** Each line states the project revision the model last saw, which is exactly the compare-and-set token a mutation must present, so the first write after a link is well formed rather than a stale-version retry.
- **Bounded where the whole list is known.** `maxTasksListed` truncates the rendered list and states the remainder, so a session linked to fifty tasks spends a bounded number of tokens on the fact.
- **Silent when the board has not moved.** The diff guard makes the note once per distinct board state; a step that repeats an unchanged board adds nothing to the request, and a reload or fork that re-reads the same board reads the same note again.

## Alternatives considered

**Record a session event when a link changes.** A link is written inside a project record by whoever calls `linkSession`, and the store has no change feed; a push would need a subscription, a lifecycle, and a durable event to keep replay honest, and the note would still read the revision at request time. Deriving the note from the authority it describes is smaller and cannot disagree with the board.

**Inject the note on every step.** The board usually has not moved between two steps, so repeating it would spend tokens on a fact the model already read. The guard keeps the model's view identical while making the unchanged case free.

**Put the note in the system prompt.** The system prompt is the cached prefix; editing it invalidates cache and would put a board whose revision changes on every task edit ahead of the reusable history. The note is a user message appended after that prefix instead.

**Report the whole board.** A board belongs to a working directory and is shared by every session in it, so most of it is not this session's work. The linked set is the part the session must act on, and the `project` tool remains the way to read more.

**Let the model discover the link by calling the tool.** Nothing prompts it to; the link is created by another session, and the model's own history is unchanged. A tool the model has no reason to call cannot deliver a fact the model does not know it needs.

## Consequences

A session now learns that a board links it to a task without spending a call, and it learns the revision that makes its first mutation land. The note is a snapshot of the board as of the request; a concurrent writer can still move the board afterwards, and the revision in the note is what makes the stale write visible instead of lossy — the same compare-and-set authority [the durable board note](../feature/2026-09-16-durable-project-board.md) already owns.

The cost is that the note can be stale in a way the model cannot detect on its own: it states a revision, and a refused mutation is what reveals that the board moved. Because the guard lives in memory, a restart, reload, or fork re-sends the same note; that is the conservative direction — one repeated note rather than a missed link — and it keeps the plugin free of durable state.

The plugin adds nothing to a tool catalog or a prompt section, so a session linked to no task is untouched by it: `renderNote` returns undefined and the pre-step decision is returned unchanged. That is what lets the shipped `dsh-base` bundle mount one instance for every profile, alongside [`dsh-project`](../../../../packages/project/project/README.md) and the [`project` tool](../../../../packages/project/tool-project/README.md).

## Deferred

No paging beyond `maxTasksListed`; no reporting of closed projects; no per-task history, attribution, or external issue-tracker link — all inherited from the store. The model-visible text has no recorded snapshot scenario yet: the recorded sessions link no board task, so the note renders nothing in them, and a scenario that links a session to a task is the way to record the text. No `./invariant` companion is published, because the package owns no durable state and no relation independent observations could diverge on — it reads the store and injects a derived message.

## Testing

Eight cases over a real `dsh-project` store beside the plugin's own helpers: the linked-only selection in store order with a workspace-scoped and an elsewhere session, a session without a working directory reading the whole open store and dropping a closed board, the rendered revision, status, and blocker lines, the bound with its omitted summary beside an empty render, the once-per-board-state injection with re-injection after the board links another task, the silent, rejecting, and aborted paths, the declared services with the default bound, and one rendered entry list pinned verbatim. `src/index.ts` carries per-file 100% coverage.

[`change-review-context`](../../../../packages/context/change-review-context/README.md) is the sibling precedent for the registration shape: one `agent/pre-step` listener, `{ prepend: true }`, one plugin-sourced user message, no store of its own.
