# Agent Note: 将项目看板发布为 Remote 命名空间

Status: implemented

[English](2026-09-16-project-board-remote-namespace.md) | 中文

## Problem

持久项目看板原本只能在一个进程内的两处触达，进程外则无处可达。模型通过 [`dsh-tool-project`](../../../../packages/project/tool-project/README.zh.md) 中的 `project` 工具读取与修改它，人通过 [`dsh-command-project`](../../../../packages/project/command-project/README.zh.md) 中的进程内命令 `/project` 查看它，而两者都直接与 `ctx.projects` 对话。Web GUI 本是最容易阅读看板的地方，却完全没有可供浏览器调用的面，因此项目能力止步于进程边界，每一份看板视图都只能渲染为命令文本。

除了缺失的能力缝，没有任何东西阻碍这项工作。store 本已提供分离的视图（`list`、`get`、`board`）并派生泳道、可执行集合与搁浅集合；Remote 装配本已按业务能力各挂载一个命名空间；并且 [`@deepseek-ai/dsh-api-usage`](../../../../packages/api/usage/README.zh.md) 已经确立了"查询服务的只读投影"应有的形态。

## Decision

`@deepseek-ai/dsh-api-project` 拥有 Host Remote 命名空间 `project`：`ProjectController` 以服务键 `projectController` 注册，wire 命名空间为 `project`，只注入 `['projects']`，并发布两个读方法。`list(filter?)` 回答看板页渲染为行所需的、有上界的清单，`board(id)` 回答单个项目及其状态泳道、可执行任务与搁浅任务。

该 controller 是投影而非所有者。看板遵循的每条规则——workspace 与已关闭项目的筛选、清单顺序、泳道分组、依赖算术——都留在 `ctx.projects` 中；controller 调用 `list` 与 `board` 并复制它们返回的内容。它不持有任何缓存，因此客户端读到的始终是 store 的当前状态。

四项性质使这个 wire 面既安全又稳定：

- **不可信输入在 wire 边界被校验。** 一个 strict zod schema 只接受 `workspace` 与 `includeClosed`，别的一概拒绝；畸形载荷抛出 `gateway/bad-request` 并带上编解码问题，空的项目 id 也抛出同一错误码，而不会抵达 store。
- **答案在能确知完整答案的地方被加上界。** `maxProjectsListed` 是服务上经过校验的 `Config` 字段（schemastery，`.natural().min(1).default(20)`），清单按它切片并上报 `truncated`，因此部署可以决定答案规模，客户端也能说明清单被截断，而不是暗示它已完整。
- **wire 值是纯值且自包含。** `ProjectViewWire`、`ProjectTaskWire`、`ProjectSummaryWire`、`ProjectListWire`、`ProjectBoardWire` 与 `ProjectFilterWire` 位于 `src/types.ts`，品牌身份被放宽为字符串，controller 逐字段把 store 视图映射到它们之上。因此领域中的一次重命名或一个新字段都会在映射处成为编译错误，而 Typert 生成器拿到的是无需链接 store 即可编码的类型。
- **状态联合靠赋值防漂移。** `TaskStatus` 与 `ProjectStatus` 在 `src/types.ts` 中本地声明，映射器把领域值赋给这些字段。任一联合增加或减少成员，赋值即停止编译；wire 副本无法悄悄落后于领域。

未知项目是 `project/not-found`，details 中带 `projectId`，这是客户端唯一会据以刷新清单的失败；关于缺失记录的其他一切仍是 store 的职责。

controller 是只读的。变更仍留在 `tool-project`，那里每次调用都携带模型最后读到的 compare-and-set revision，因此过期编辑会被拒绝而不是被合并。浏览器变更端点需要它自己的权限决策——哪个会话可以改动哪块看板，以及拒绝如何呈现——本次改动刻意不做这件事。

注册才是让命名空间可达的东西，而每个面都是显式的：包的 manifest 生成 `./typert` 与 `./remote` 导出，`packages/api/remotes`（客户端 import、类型 re-export、`$mount` 条目与三处 manifest 段），`dsh-web-app` 组合（`project-controller` 的 Cordis 行与依赖），`tsconfig.base.json` 与 `tsconfig.host.json`（别名是手写的，因为目录名 `project` 与包后缀 `api-project` 不一致，`gen-tsconfig-paths` 无法拥有它们），以及目录脚本（`scripts/gen-cordis-catalog.ts` 中的 `SERVICE_PAGE` 与 `linkedTypePages`，`scripts/gen-doc-graphs.ts` 中的 `SERVICE_ROLES`）。

## Alternatives considered

**用一个 `read` 方法同时返回清单与看板。** 单个方法要么把每个项目的每个任务都送出——无上界，且其中大部分在发起请求的页面上根本不可见——要么需要一个判别参数，使结果成为客户端必须收窄的联合。两个方法让每个答案保有自己的上界与自己的 wire 类型，而这正是清单行与看板各自所需。

**在读旁边暴露变更动词。** `addTask`、`updateTask`、`linkSession`、`update` 与 `close` 都接受 compare-and-set revision，浏览器端点必须决定谁可以出示它、拒绝在 UI 中长什么样。这是关于产品的权限决策，而不是关于看板的序列化决策，把它塞进只读投影会让它藏在某个 wire 方法背后。

**从领域类型派生 wire 类型。** 重新导出 `ProjectView` 及其同类会把品牌 id 与仅属于领域的字段摆到编解码器面前，并使 wire 契约随领域一同漂移。usage 的 Remote 面对 `UsageReportWire` 做的是同一个取舍，其理由在此同样成立：纯副本是"领域重命名成为编译错误、而不是成为静默的 wire 变更"的地方。

**让 store 的类型承载校验。** `ctx.projects` 信任其带类型的调用方——这正是它廉价的原因——而它唯一不能信任的调用方是浏览器。在 store 中校验会给每次内部调用都加上一个已解析分支；在 controller 中校验则把检查留在不可信值进入的边界上。

**缓存清单。** store 在内存中且是同步的，一份清单就是对一张表的一次遍历，因此缓存只会为一个无法测量的收益增加过期窗口与失效规则。controller 保持无状态。

## Consequences

看板现在拥有可被浏览器调用的面，并遵循与其他命名空间相同的 wire 规则：请求经校验、答案有上界、值为纯值、且客户端必须据以行动的那一种情况有单一分类失败。Web 看板面板可以在不触碰 store、工具或命令的前提下构建，而三个既有消费者保持不变地继续工作，因为 store 的契约没有移动。

代价是该命名空间目前没有仓库内消费者：`packages/client/ui-project` 不存在，因此已发布的 Web 组合中还没有任何东西调用 `ctx.remote.project`。注册面因此是在其客户端之前就挂载了命名空间，这也是上面逐一列举它们、而不是由调用方发现它们的原因。只读意味着日后到来的面板可以展示看板，但在变更权限被决定之前不能改动看板。

清单上界按设计随部署而变，因此两个部署可以对同一调用给出不同长度；`truncated` 正是让客户端区分"没有更多项目"与"已达上界"的东西。

## Deferred

看板的客户端包（`packages/client/ui-project`）与浏览器编辑所需的变更权限均未实现。该命名空间的 recorded-session 快照也未实现：录制需要模型密钥，`evals/baseline.json` 与 recorded 快照因此保持未改动。没有发布 `./invariant` 伴随包，因为 controller 不拥有持久状态，也不拥有独立观测可能产生分歧的关系——它复制 store 所提供的内容，而看板的关系由 store 自己的 invariant 伴随包拥有。

## Testing

controller 通过真实组合——storage hub、JSON 后端、领域形式、项目 store，以及临时根目录之上的 controller——在七个用例中被测试：两个已发布方法及其服务键，带任务数与可执行数的清单，逐字段传递的 workspace 与已关闭项目筛选，被配置上界截断的清单，在 wire 边界被拒绝的畸形筛选，映射到泳道及可执行任务与其依赖的看板，以及以客户端据以行动的错误码被拒绝的空 id 或未知 id。`src/index.ts` 达到逐文件 100% 覆盖率。

构建为该包产出了两个 Typert 面与 remote client，包括五泳道的 `columns` 记录；目录生成器被重新运行，命名空间及其类型因此被归类：`gen-cordis-catalog`、`gen-doc-graphs`、`gen-config-catalog` 与 `gen-module-graph` 均报告其产物为最新。
