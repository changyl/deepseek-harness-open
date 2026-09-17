# Agent Note: Keep project work on a durable board

Status: implemented

English | [中文](2026-09-16-durable-project-board.zh.md)

## Problem

Every durable unit the harness had was session-shaped. `todo_write` replaces a list inside one session, `goal` holds one objective per session, `schedule` fires a prompt later, and `task-report` summarizes one closed turn. Work that spans several sessions in one working directory — a review, a fix, the checks that follow, each in its own session — had no home, so the only record of what remained was a transcript a later session had to re-read and interpret.

Two properties were missing. Work needed to survive the session that created it, and two sessions touching the same work needed a way to notice each other instead of overwriting one another.

## Decision

`@deepseek-ai/dsh-project` owns `ctx.projects`, a durable store over the `project` storage domain: one record per project keyed by a generated identity, holding that project's tasks, its creation and update times, and a compare-and-set revision. Tasks live inside their project's record so a task change and the revision it bumps are one durable write, and the compare-and-set token can never describe a task list other than the one it was written with.

`@deepseek-ai/dsh-tool-project` is the model-facing consumer: one tool named `project` with the actions `list`, `create`, `read`, `add_task`, `update_task`, and `link_session`. Every mutation takes the revision the model last read, and a stale revision is refused with `project/stale-version` rather than applied.

`@deepseek-ai/dsh-command-project` is the human entry point: `/project` lists the boards of the session's working directory and `/project <id>` renders one board. It is read-only on purpose — a state change needs the compare-and-set revision, which belongs to the model's tool and to a future board UI.

Five rules are the store's contract, and each one exists because a caller cannot check it for itself:

- **Input and dependency validation precede the capacity check.** An unusable title or an unknown dependency is reported as such even when the project is full, because that is the failure the caller can act on.
- **A dependency must name a task in the same project, cannot name its own task, and cannot close a cycle.** The cycle check walks the post-write graph, so it judges the record the caller is about to create rather than the one it is replacing.
- **`doing` and `done` require every blocker to be finished; `blocked` requires at least one unfinished blocker.** The stored status therefore agrees with the dependency state instead of merely being asserted next to it.
- **A closed project refuses all task work.** Closing is the one operation that stops a board from changing.
- **A no-op request changes nothing.** Re-linking the same session keeps the stored record and leaves the revision alone, so a repeated call cannot make two sessions' revisions disagree for no reason.

The board a caller reads is derived, not stored: `boardOf` groups tasks into status lanes, reports `ready` as the `todo` tasks whose blockers are all finished, and `stranded` as the `doing` tasks that still have an unfinished blocker. A stored status is what a model or a human asserted; `ready` and `stranded` are what the dependencies say, and keeping them separate is what lets a reader see the disagreement.

The `dsh-base` bundle mounts the store and the tool, so every shipped composition can read the board; the tool's results are bounded by `maxProjectsListed`, `maxTasksListed`, and `maxTitleLength`, and each result reports `truncated` when a bound was hit.

## Alternatives considered

**Make `todo_write` durable.** The todo list is the model's working memory: it is replaced wholesale on every call, logged as one session event, and rendered from the log. Giving it durable host state would change its replacement contract, put two owners on one list, and make a cheap session write depend on a storage backend. The board is a different thing with a different lifetime, so it is a different tool.

**Store tasks in their own table.** A second table would let a query address one task directly, but a task change would then be two durable writes — the task row and the project's revision — and the revision could land without the task. One record per project makes the compare-and-set token and the task list the same fact.

**Scope each project to the session that created it.** That is what `goal` already does, and it is exactly the lifetime the board exists to escape. The store is instead global with an optional `workspace` field, so every session in one working directory sees one board.

**Key projects by workspace registry id.** `ctx.workspaceRegistry` knows the canonical path of every workspace, and a session's header carries its working directory. Resolving one from the other needs a session-to-workspace reverse lookup that does not exist, so the store matches on the canonical path string the tool can actually read, and the cost is that two spellings of one directory are two boards until a caller canonicalizes.

**Derive `blocked` and `doing` from dependencies instead of storing them.** Automatic derivation would make the stored status redundant and would remove the ability to record a disagreement — a task someone marked `done` whose dependency reopened, or a `doing` task whose blocker regressed. The board reports both, which is more useful than silently rewriting what a caller said.

## Consequences

Project work now has a durable home that outlives the session, a revision that makes concurrent edits visible instead of lossy, and a validation layer that keeps the dependency graph acyclic and status-consistent without asking the model to check any of it.

The costs are real. The store is single-process durable: a second harness instance sees a write only after re-reading, and there is no cross-process change push. Projects are matched by the canonical path string, so an un-canonicalized path creates a second board. There is no per-task history, no multi-user attribution, and no external issue-tracker synchronization. The model reaches the board through the tool and through [`dsh-project-context`](../architecture/2026-09-16-project-context-note.md), which reports this session's linked tasks once per board state. The composition places that tool by profile: `dsh-base` mounts it globally, which is the headless catalog, while the Web bundle withdraws that row and each agent preset mounts it, so a browser session's catalog is a function of the preset it joined. The recorded system-prompt and tool-schema fixtures carry the tool, which is why mounting it required refreshing them in the same change.

## Deferred

Remote methods for browser edits are not implemented; the board itself reaches the browser through [`dsh-client-ui-project`](../../../../packages/client/ui-project/README.md). The store's consumers are the model tool, the read-only `/project` command, the read-only [`project` Remote namespace](../architecture/2026-09-16-project-board-remote-namespace.md), and that settings section.

## Testing

The store is tested through a real composition — the storage hub, the JSON backend, the domain form, and the store over a temporary root — for creation, listing and workspace filtering, compare-and-set refusal, closed-project refusal, dependency validation, cycle refusal, status rules, session linking, restart durability, and operations attempted before the domain opens. The pure board helpers are tested directly for id allocation, title normalization, blocker classification, lanes, `ready`, and `stranded`. The tool is tested through the real tool runtime for registration and disposal, every action, the bounds and their `truncated` flag, workspace propagation, argument and dependency errors, and a call with no owning session. Both packages carry per-file 100% coverage.
