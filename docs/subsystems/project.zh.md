# 项目

[English](project.md) | 中文

项目子系统为工作提供一个比单个 agent（智能体）会话活得更久的持久归宿。它是一项可选、宿主侧的能力，拆分为存储与其面向模型的消费者：[`dsh-project`](../../packages/project/project) 拥有 `ctx.projects`，即建立在 `project` 存储领域之上的持久看板；[`dsh-tool-project`](../../packages/project/tool-project) 以单个 `project` 工具把它暴露给模型。同一工作目录下的每个会话共享同一批看板，因此一个会话写下的计划就是下一个会话读到的计划。存储不注册工具、不注入提示词、不追加会话事件；只有工具触及模型，且只通过其有界结果。设计记录：[持久项目看板 Agent Note](../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.zh.md)。

Source: [`packages/project/project/src/index.ts`](../../packages/project/project/src/index.ts) · [`packages/project/project/src/spec.ts`](../../packages/project/project/src/spec.ts) · [`packages/project/project/src/board.ts`](../../packages/project/project/src/board.ts) · [`packages/project/tool-project/src/index.ts`](../../packages/project/tool-project/src/index.ts)

## 持久形态

领域是 `project`，版本 1，含一张以随机 uuid 为键的 `projects` 表。一条存储记录持有项目的 `title`、`status`（`active` 或 `closed`）、可选的 `workspace` 路径、`createdAt`、`updatedAt`、`revision` 及其 `tasks` 数组；一条存储任务持有 `id`、`title`、`status`（`todo`、`doing`、`blocked`、`done` 或 `cancelled`）、`blockedBy`、`sessionIds` 及其自身时间戳。任务存放在其项目记录内部，而不是各自独立的表中，因此一次持久写入同时携带任务变更与它递增的修订号，比较并交换令牌也绝不会描述一个与其写入时不同的任务列表。删除记录会连同该项目的任务一起删除，这正是该领域成为任务状态唯一拥有者的原因。任务 id 按项目已有编号任务的最大值之后分配为 `task-<n>`，因此创建顺序在重新加载后依然保留。

## 视图与看板

`ctx.projects` 提供分离的视图。`ProjectView` 携带身份、标题、状态、可选工作区、时间戳、修订号以及按创建顺序排列的全部任务；`TaskView` 携带任务的身份、标题、状态、依赖、已关联会话与时间戳。`get(id)` 返回单个项目或 `undefined`，而 `list(filter)` 按从新到旧返回项目，除非设置了 `includeClosed` 否则排除已关闭项目，并在给出工作区时按 `workspace` 字符串相等过滤。

`board(id)` 从同一条记录派生阅读排布：`columns` 按状态以创建顺序对任务分组，`ready` 列出阻塞者均为 `done` 或 `cancelled` 的 `todo` 任务，`stranded` 列出仍有未完成阻塞者的 `doing` 任务。已存状态是调用方断言的；`ready` 与 `stranded` 是依赖所表示的，把二者分开正是让读者看见分歧的方式——一个被标记为 `done` 但依赖被重新打开的任务，或一个阻塞者回退的 `doing` 任务。

## 比较并交换修订

每次变更都接收一个 `ProjectRef`：项目 id 加上调用方最后观察到的修订号。存储读取记录，以 `project/not-found` 拒绝缺失项目、以 `project/stale-version` 拒绝更旧的修订号，随后在领域写入链内再次检查修订号，因此两个针对同一修订号竞争的变更不可能同时落地。不改变任何内容的请求——把同一会话重复关联到同一任务——保留已存记录且不改变修订号，因此重复调用不会无端让两个调用方的修订号不一致。操作包括 `create`、`update`（改名）、`close`、`addTask`、`updateTask` 与 `linkSession`；返回的 `ProjectView` 携带调用方传给下一次变更的新修订号。

## 依赖与状态规则

- 标题会被去除首尾空白，必须非空且不超过 200 个字符。
- `blockedBy` 必须命名同一项目中的任务，不能命名任务自身，也不能形成环。环检查遍历的是写入后的图，因此它判断的是调用方即将创建的记录而不是它正在替换的记录；依赖列表按请求顺序去重。
- `doing` 与 `done` 要求每个阻塞者都是 `done` 或 `cancelled`；`blocked` 要求至少有一个未完成的阻塞者。因此已存状态与依赖状态一致，而不只是与它并列摆放。
- 输入与依赖校验先于容量检查：即使项目已持有 `maxTasksPerProject` 个任务，不可用标题或未知依赖仍按自身被报告，因为这才是调用方能据以行动的失败。
- 已关闭的项目以 `project/closed` 拒绝一切任务操作。关闭是唯一让看板停止变化的操作。

## 错误码

| 代码 | 含义 |
|---|---|
| `project/not-found` | 没有记录携带所请求的身份，或存储尚未初始化 |
| `project/stale-version` | 提交的修订号比已存修订号更旧 |
| `project/closed` | 项目已关闭并拒绝任务工作 |
| `project/unknown-task` | 引用的任务在本项目中不存在 |
| `project/dependency-cycle` | 请求的依赖会让任务到达自身 |
| `project/invalid-input` | 标题为空或过长，或状态与阻塞者状态矛盾 |
| `project/limit-exceeded` | 项目已持有 `maxTasksPerProject` 个任务 |

## 面向模型的工具

`dsh-tool-project` 注册一个名为 `project` 的工具，含必填的 `action` 参数：`list`（调用会话工作目录中的项目）、`create`、`read`（有界看板）、`add_task`、`update_task` 与 `link_session`。每次变更都携带上一次读取得到的 `revision`，过期者被拒绝，因此模型会重新读取并重试，而不是覆盖另一个会话的改动。`link_session` 从工具执行上下文记录调用会话，`create` 与 `list` 使用会话的工作目录作为工作区。结果受 `maxProjectsListed`、`maxTasksListed` 与 `maxTitleLength` 约束，且当某个上界丢弃了内容时，结果会报告 `truncated`。

## 包

- [`project/`](../../packages/project/project/README.zh.md)——`ctx.projects` 上的持久存储。
- [`tool-project/`](../../packages/project/tool-project/README.zh.md)——面向模型的 `project` 工具。
- [`project-context/`](../../packages/project/project-context/README.zh.md)——在 pre-step 阶段报告本会话关联任务的备注。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
