# Project

English | [中文](project.zh.md)

The project subsystem gives work a durable home that outlives one agent session. It is one optional, host-side capability split into a store and its model-facing consumer: [`dsh-project`](../../packages/project/project) owns `ctx.projects`, a durable board over the `project` storage domain, and [`dsh-tool-project`](../../packages/project/tool-project) exposes it to a model as one `project` tool. Every session in one working directory shares the same boards, so a plan one session writes is the plan the next session reads. The store registers no tool, injects no prompt, and appends no session event; the tool is what reaches a model, and only through its bounded results. Design record: [durable project board Agent Note](../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.md).

Source: [`packages/project/project/src/index.ts`](../../packages/project/project/src/index.ts) · [`packages/project/project/src/spec.ts`](../../packages/project/project/src/spec.ts) · [`packages/project/project/src/board.ts`](../../packages/project/project/src/board.ts) · [`packages/project/tool-project/src/index.ts`](../../packages/project/tool-project/src/index.ts)

## Durable shape

The domain is `project`, version 1, with one `projects` table keyed by a random uuid. A stored record holds the project's `title`, `status` (`active` or `closed`), optional `workspace` path, `createdAt`, `updatedAt`, `revision`, and its `tasks` array; a stored task holds `id`, `title`, `status` (`todo`, `doing`, `blocked`, `done`, or `cancelled`), `blockedBy`, `sessionIds`, and its own timestamps. Tasks live inside their project's record rather than in a table of their own, so one durable write carries both a task change and the revision it bumps, and the compare-and-set token can never describe a task list other than the one it was written with. Deleting a record deletes that project's tasks with it, which is what makes the domain the only owner of task state. Task ids are allocated as `task-<n>` past the highest numbered task the project already holds, so creation order survives a reload.

## Views and the board

`ctx.projects` serves detached views. `ProjectView` carries the identity, title, status, optional workspace, timestamps, revision, and every task in creation order; `TaskView` carries a task's identity, title, status, dependencies, linked sessions, and timestamps. `get(id)` returns one project or `undefined`, and `list(filter)` returns projects newest first, excluding closed ones unless `includeClosed` is set and filtering by `workspace` string equality when a workspace is given.

`board(id)` derives the reading layout from the same record: `columns` groups tasks by status in creation order, `ready` lists the `todo` tasks whose blockers are all `done` or `cancelled`, and `stranded` lists the `doing` tasks that still have an unfinished blocker. A stored status is what a caller asserted; `ready` and `stranded` are what the dependencies say, and keeping them separate is what lets a reader see the disagreement — a task marked `done` whose dependency was reopened, or a `doing` task whose blocker regressed.

## Compare-and-set revisions

Every mutation takes a `ProjectRef`: the project id plus the revision the caller last observed. The store reads the record, refuses a missing project with `project/not-found` and an older revision with `project/stale-version`, then re-checks the revision inside the domain write chain so two mutations racing on the same revision cannot both land. A request that changes nothing — re-linking the same session to the same task — keeps the stored record and leaves the revision alone, so a repeated call cannot make two callers' revisions disagree for no reason. The operations are `create`, `update` (rename), `close`, `addTask`, `updateTask`, and `linkSession`; the returned `ProjectView` carries the new revision a caller passes to its next mutation.

## Dependency and status rules

- A title is trimmed, must be non-empty, and is at most 200 characters.
- `blockedBy` must name tasks in the same project, cannot name the task itself, and cannot close a cycle. The cycle check walks the post-write graph, so it judges the record the caller is about to create rather than the one it is replacing, and a dependency list is deduplicated in the requested order.
- `doing` and `done` require every blocker to be `done` or `cancelled`; `blocked` requires at least one unfinished blocker. The stored status therefore agrees with the dependency state instead of merely sitting next to it.
- Input and dependency validation precede the capacity check: an unusable title or an unknown dependency is reported as such even when the project already holds `maxTasksPerProject` tasks, because that is the failure the caller can act on.
- A closed project refuses every task operation with `project/closed`. Closing is the one operation that stops a board from changing.

## Error codes

| Code | Meaning |
|---|---|
| `project/not-found` | No stored project carries the requested identity, or the store has not initialized |
| `project/stale-version` | The presented revision is older than the stored one |
| `project/closed` | The project is closed and refuses task work |
| `project/unknown-task` | A referenced task does not exist in this project |
| `project/dependency-cycle` | The requested dependency would make a task reach itself |
| `project/invalid-input` | Empty or over-long title, or a status contradicting the blocker state |
| `project/limit-exceeded` | The project already holds `maxTasksPerProject` tasks |

## The model-facing tool

`dsh-tool-project` registers one tool named `project` with a required `action` argument: `list` (projects in the calling session's working directory), `create`, `read` (the bounded board), `add_task`, `update_task`, and `link_session`. Every mutation carries the `revision` from the last read, and a stale one is refused so the model re-reads and retries instead of overwriting another session's change. `link_session` records the calling session from the tool execution context, and `create` and `list` use the session's working directory as the workspace. Results are bounded by `maxProjectsListed`, `maxTasksListed`, and `maxTitleLength`, and each result reports `truncated` when a bound dropped anything.

## Packages

- [`project/`](../../packages/project/project/README.md) — the durable store on `ctx.projects`.
- [`tool-project/`](../../packages/project/tool-project/README.md) — the model-facing `project` tool.
- [`project-context/`](../../packages/project/project-context/README.md) — the pre-step note that reports this session's linked tasks.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxprojectcontroller--projectcontroller"></a>

### `ctx.projectController` — `ProjectController`

Host service backing the generated `ctx.remote.project` namespace. Every response is a detached plain value; the controller holds no cache, so a client always reads the store's current state.

```ts cordis-catalog
/**
 * List stored projects with the counts a board header renders.
 * @param filter - workspace selection and whether closed projects appear.
 * @returns the bounded listing and whether the bound cut it.
 * @throws RemoteError `gateway/bad-request` when the filter is malformed.
 */
@Remote list(filter?: ProjectFilterWire): ProjectListWire

/**
 * Read one project's board.
 * @param id - project identity as it appears on the wire.
 * @returns the project, its status lanes, and its workable and stranded tasks.
 * @throws RemoteError `gateway/bad-request` when the id is empty, `project/not-found` when no record carries it.
 */
@Remote board(id: string): ProjectBoardWire
```

Source: [`packages/api/project/src/index.ts`](../../packages/api/project/src/index.ts)

<a id="ctxprojects--projectstore"></a>

### `ctx.projects` — `ProjectStore`

Durable project store. Opening the domain is the service's initialization: until it completes, `ctx.projects` exists but every operation reports the domain as unavailable.

```ts cordis-catalog
/**
 * Create one project.
 * @param input - title and optional workspace.
 * @returns the created project.
 */
async create(input: CreateProjectInput): Promise<ProjectView>

/**
 * List stored projects newest first.
 * @param filter - workspace and closed-project selection.
 * @returns detached project views.
 */
list(filter: ProjectFilter = {}): ProjectView[]

/**
 * Read one project.
 * @param id - project identity.
 * @returns the project view, or `undefined` when no record carries that id.
 */
get(id: ProjectId): ProjectView | undefined

/**
 * Read one project's board.
 * @param id - project identity.
 * @returns the board, or `undefined` when no record carries that id.
 */
board(id: ProjectId): ProjectBoard | undefined

/**
 * Rename one project.
 * @param ref - project and the revision the caller observed.
 * @param patch - the replacement title.
 * @returns the updated project.
 */
update(ref: ProjectRef, patch: { title: string }): Promise<ProjectView>

/**
 * Close one project. A closed project refuses further task work.
 * @param ref - project and the revision the caller observed.
 * @returns the updated project.
 */
close(ref: ProjectRef): Promise<ProjectView>

/**
 * Add one task to a project.
 * @param ref - project and the revision the caller observed.
 * @param input - title and optional dependencies.
 * @returns the updated project.
 * @throws ProjectError `project/closed` when the project is closed, or `project/limit-exceeded` at the task bound.
 */
addTask(ref: ProjectRef, input: AddTaskInput): Promise<ProjectView>

/**
 * Change one task's title, status, or dependencies.
 * @param ref - project and the revision the caller observed.
 * @param taskId - task to change.
 * @param patch - the fields to replace.
 * @returns the updated project.
 * @throws ProjectError when the project is closed, the task is unknown, or the change violates a dependency rule.
 */
updateTask(ref: ProjectRef, taskId: TaskId, patch: UpdateTaskPatch): Promise<ProjectView>

/**
 * Link one session to a task. Linking the same session twice is a no-op.
 * @param ref - project and the revision the caller observed.
 * @param taskId - task to link.
 * @param sessionId - session to record.
 * @returns the updated project.
 */
linkSession(ref: ProjectRef, taskId: TaskId, sessionId: string): Promise<ProjectView>
```

Source: [`packages/project/project/src/index.ts`](../../packages/project/project/src/index.ts)
<!-- END GENERATED cordis-surface -->
