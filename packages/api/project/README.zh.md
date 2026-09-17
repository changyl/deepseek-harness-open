---
description: "project 命名空间的 Host Remote 拥有者：一个受限列表与一次看板读取，在 project 存储之上回答一个已存项目的任务、状态泳道、可开始任务与搁浅任务。"
kind: "package-reference"
---
# Project Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-project` 暴露面向浏览器项目看板的生成式 `ctx.remote.project` 命名空间。`list(filter?)` 回答看板表头要渲染的受限项目列表，携带任务数、可开始数与搁浅数；`board(id)` 回答一个项目的完整任务列表、五条状态泳道，以及可开始与搁浅任务的 id。控制器不添加任何自己的领域策略：校验、依赖规则与 compare-and-set 修订都位于 project 存储中，因此每次调用都反映当时已存的内容。未知项目回答 `project/not-found`，而不是一个空看板。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 应用中把本包作为 Loader 条目挂载，与 project 存储并列。

```yaml
- name: '@deepseek-ai/dsh-project'
- name: '@deepseek-ai/dsh-tool-project'
- name: '@deepseek-ai/dsh-api-project'
```

`dsh-web-app` 组合挂载的正是这一组合：`project` 与 `tool-project` 来自 base 层，而本控制器是 Web 层唯一新增的东西。它生成的 `./typert` 导出把 Host 描述符送入严格的 Typert 注册表，生成的 `./remote` 导出则是 `dsh-api-remotes` 所挂载的 Client 贡献，正是它让浏览器可以调用 `ctx.remote.project`。控制器要求 `ctx.projects`；未挂载存储的组合加载失败，而不是回答空列表。

`list(filter?)` 回答看板表头要渲染的行。缺省 filter 选择全部未关闭项目；给出 filter 时按 `workspace`（与已存规范路径做字符串相等匹配）与 `includeClosed` 收窄。请求在 wire 边界以严格 schema 校验，因此未知键或类型错误的字段会以 `gateway/bad-request` 抛出并携带编解码器的问题，且绝不会到达存储。每一行是摘要而非整个项目：身份、标题、状态、可选 workspace、时间戳、compare-and-set 修订，以及 `tasks`、`ready`、`stranded` 三个计数。行保持存储的列表顺序，最新创建的在前，而 `truncated` 报告部署的界限切断了答案。

界限是 `maxProjectsListed`，它作用于完整结果而不是某一页。因此被截断的答案告诉客户端存在更多项目，而不是从哪里继续：该命名空间没有 offset 或游标，想展示每个项目的看板需要配置更大的界限。

`board(id)` 完整回答一个项目。`project` 按创建顺序携带每个任务，含身份、标题、状态、依赖、已链接会话与时间戳；`columns` 把同样的任务按状态分入 `todo`、`doing`、`blocked`、`done`、`cancelled` 五条泳道，并保持泳道内的创建顺序；`ready` 给出阻断项全部完成的 `todo` 任务，`stranded` 给出阻断项尚未全部完成的 `doing` 任务，两者都是按创建顺序排列的 id。这两个列表与泳道由同一组依赖边推导，因此客户端用一份答案即可渲染泳道归属与可工作性。

两处映射都逐字段书写，因此在 project 领域重命名字段会在这里成为编译错误，而不是静默的 wire 变更。带 brand 的身份会放宽为字符串，数组会被复制，而项目不是从工作目录创建时 `workspace` 会被整体省略。

预期失败以稳定的 Remote 错误码到达调用方。未通过严格 schema 的 filter，以及为空或只有空白的 id，都会抛出 `gateway/bad-request`；没有任何已存项目携带的 id 抛出 `project/not-found`，并在 details 中带上出错的 `projectId`。存储故障原样传播，因此存储问题仍以自身面目可见。

生成的[配置目录](../../../docs/config-catalog.zh.md)列出仓库中每个插件配置；本包接受一个字段：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxProjectsListed` | `20` | 一次 `list` 答案携带的最大项目数。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

控制器是投影，而不是拥有者。它注入 `ctx.projects`，在 wire 边界校验唯一不受信任的输入，限制列表长度，对未知 id 分类，并把存储视图映射到 wire 类型。它不持有缓存与状态，因此两次调用会两次读取存储，而两次调用之间发生的任务变化会在第二次调用中可见。看板由存储自己的看板推导计算，因此泳道归属与可工作性不会与接受或拒绝任务变更的规则发生偏离。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `ProjectController`：`@Remote` 方法、filter schema、列表界限，以及视图到 wire 的映射 |
| [`src/types.ts`](src/types.ts) | Client 消费的 wire 类型，以及 `project/not-found` 错误码声明 |

### 服务与命名空间

`ProjectController extends TypertRemoteService` 注册服务键 `projectController` 与 wire 命名空间 `project`，这就是 Client 以 `ctx.remote.project` 触达的东西。它的 `static inject = ['projects']` 命名了它唯一据以回答的服务；Gateway 通过 `typertRemote` 发现该命名空间，因此没有 gateway 的 Host 组合仍可挂载该控制器。它的 `Config` 携带 `maxProjectsListed`。

### 方法

| 方法 | 请求 | 答案 |
|---|---|---|
| `list` | `filter?`：`workspace`、`includeClosed`，都可选 | `ProjectListWire`：按列表顺序排列的受限摘要，以及截断标志 |
| `board` | `id`：项目在 wire 上的身份 | `ProjectBoardWire`：项目、状态泳道、可开始 id 与搁浅 id |

### 失败

| 错误码 | 抛出条件 |
|---|---|
| `gateway/bad-request` | filter 未通过严格的 wire schema（details 携带编解码器问题），或 id 为空或只有空白 |
| `project/not-found` | 没有任何已存项目携带该 id；details 携带 `projectId` |

### Wire 值

| 类型 | 含义 |
|---|---|
| `ProjectFilterWire` | 一次 `list` 调用携带的选择条件 |
| `ProjectSummaryWire` | 一行列表项：身份、标题、状态、可选 workspace、时间戳、修订与三个计数 |
| `ProjectListWire` | 一份受限列表，以及界限是否切断了它 |
| `ProjectViewWire` | 一个项目及其按创建顺序排列的全部任务 |
| `ProjectTaskWire` | 一个任务：身份、标题、状态、依赖、已链接会话与时间戳 |
| `ProjectBoardWire` | 一块看板：项目、五条泳道、可开始 id 与搁浅 id |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从 wire 命名空间走向其背后的存储，再到承载调用的 Remote 模型。

- [Project 子系统](../../../docs/subsystems/project.zh.md)——权威的记录与视图契约、依赖规则、存储错误码，以及生成的 `ctx.projects` API。
- [project 组地图](../../project/README.zh.md)——存储、面向模型的 `project` 工具，以及人工使用的 `/project` 命令。
- [api 组地图](../README.zh.md)——其他 Remote 命名空间及其组装方式。
- [API Gateway 参考](../../../docs/api-gateway.zh.md)——Typert 编程模型、生成流水线与运行时调用。
- [Typert 子系统参考](../../../docs/subsystems/typert.zh.md)——protocol、Gateway 与消费者组装共享的契约。

-----

<a id="model-experience"></a>
## 模型体验

### 不添加任何模型可见内容

#### 模型看到什么

什么都没有。`project.list` 与 `project.board` 用面向模型的 `project` 工具已经读过或写过的记录回答浏览器看板；该命名空间不添加提示词段落、工具 schema 或会话事件。

#### Token 影响

无。该命名空间从不组装或发送 provider 请求，因此无法改变模型读到什么，也无法改变请求携带多少 token。

#### KV Cache 影响

无。读取项目不会改动请求，因此它不可能使任何缓存前缀失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该命名空间当前能回答什么。它们是当下的包约束。

- **只读**——该命名空间不暴露任何写入或变更；创建、改名、关闭项目以及改动其任务，仍由面向模型的 `project` 工具与 `ctx.projects` 存储 API 承担。
- **无流式与变更推送**——两个方法都是单次调用，因此看板页面靠轮询，泳道的新鲜度就是客户端的轮询间隔。
- **无分页与游标**——列表被 `maxProjectsListed` 切断并报告 `truncated`；需要其余部分的客户端无法请求后续页，因为请求不携带 offset。
- **`stranded` 是一种读取结果，而不是被拒绝的写入**——存储校验的是请求所改动的任务，而不是依赖它的任务，因此重新打开一个已完成的阻断项，会让处于 `doing` 的依赖方留在 `stranded` 中，直到之后的看板读取才显示出来。
- **只在挂载 Web 组合处存在**——没有这一行的 Host 组合没有 `ctx.remote.project`，`dsh-api-remotes` 中的 Client 贡献也随之缺席。
- **未发布客户端看板界面**——本包是看板页面的 Host 一半；`packages/client/ui-project` 尚不存在，因此表现层由消费者拥有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。控制器不拥有持久状态，也没有自己的、可由独立观测产生分歧的关系；它校验一个请求、限制一次列表并对未知项目分类，而其测试规范钉住上述每一项行为。
