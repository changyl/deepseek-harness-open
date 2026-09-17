# Agent Note: 把跨会话结果信号发布为 Remote 命名空间

Status: implemented

[English](2026-09-16-effectiveness-remote-namespace.md) | 中文

## Problem

跨会话结果报告此前只能在一个进程内的一处触达。[`@deepseek-ai/dsh-effectiveness-query`](../../../../packages/feedback/effectiveness-query/README.zh.md) 折叠被选中的语料并回答 `ctx.effectiveness.query(filter)`，而 [`dsh-command-effectiveness`](../../../../packages/feedback/command-effectiveness/README.zh.md) 中的进程内 `/effectiveness` 命令把该答案渲染为文本。逐会话投影是客户端可见的，但语料级报告——运营者真正会就一次部署提出的那个问题——没有浏览器可调用的面，因此读取它意味着运行一条命令并阅读会话记录。

除了缺失的能力缝，没有任何东西阻碍这件事。查询服务已经在提供一份由纯领域值组成的、已分离的报告；Remote 组装已经为每个业务能力挂载一个命名空间；而 [`@deepseek-ai/dsh-api-usage`](../../../../packages/api/usage/README.zh.md) 已经确立了“查询服务的只读投影”应有的形状：在 wire 边界校验一个请求、把一份答案映射为纯值、不持有缓存。

## Decision

`@deepseek-ai/dsh-api-effectiveness` 拥有 Host Remote 命名空间 `effectiveness`：`EffectivenessController` 以服务键 `effectivenessController` 与 wire 命名空间 `effectiveness` 注册，只注入 `['effectiveness']`，并发布唯一一个读取方法 `query(filter?)`，回答语料总量、逐路由行与逐会话行。

控制器是投影，而不是拥有者。语料选择、逐会话折叠、路由归属与上报界限都留在 `ctx.effectiveness` 中；控制器校验请求、调用服务，并逐字段复制它返回的内容。它不持有缓存，因此客户端读到的始终是语料的当前状态；而折叠对“信号”“无决策变更”“样本不足”的定义是被继承的，而不是被复述的——[effectiveness 投影笔记](2026-09-16-effectiveness-projection.zh.md) 拥有那套理由。

四条性质使这个 wire 面既安全又稳定：

- **不受信任的输入在 wire 边界被校验。** 一份严格 zod schema 只接受 `from`、`to`、`sessions`、`provider` 与 `model`；畸形载荷以 `gateway/bad-request` 抛出并携带编解码器问题，且绝不会到达查询服务。这是控制器所做的唯一分类：语料读取失败原样传播，因为会话存储故障并不需要调用方以不同于其他读取失败的方式应对。
- **wire 值是纯值且自包含。** 反馈、变更、验证、投影、总量、路由、会话与报告类型都位于 `src/types.ts`，因此 Typert 生成器拿到的是无需链接查询服务即可编码的类型，而领域内重命名会在映射处成为编译错误，而不是静默的 wire 变更。
- **反馈分类联合通过迭代得到漂移保护。** `CATEGORIES` 列出 wire 声明的每个分类，映射器迭代该列表并读取领域自己的计数。任一侧重命名分类都会停止编译，而不是从明细里消失；没有判断的分类被省略，而不是以 0 发送。
- **界限不属于控制器。** `maxSessionsReported` 是查询服务的受校验配置字段，因此控制器完全不接受 `Config`，而 `truncated` 描述的是服务所做的截断。部署在语料读取发生之处设定答案大小，而不是在第二个可能与之不一致的地方。

控制器是只读的。记录评分、变更决策或任务报告，由拥有这些事件的包承担；浏览器写入面需要它自己的权限决定——谁可以给一条消息评分、拒绝如何呈现——本次改动有意不做这件事。

注册是让该命名空间可达的关键，每个面都是显式的：包清单中生成的 `./typert` 与 `./remote` 导出；`packages/api/remotes`（客户端 import、类型再导出、`$mount` 条目与三处清单段）；`dsh-web-app` 组合（`effectiveness-controller` 这一 Cordis 行与依赖）；`tsconfig.base.json` 与 `tsconfig.host.json`（别名是手写的，因为目录名 `effectiveness` 与包后缀 `api-effectiveness` 不匹配，`gen-tsconfig-paths` 无法拥有它们）；以及目录脚本（`scripts/gen-cordis-catalog.ts` 中的 `SERVICE_PAGE` 与 `linkedTypePages`、`scripts/gen-doc-graphs.ts` 中的 `SERVICE_ROLES`）。

## Alternatives considered

**扩展现有的 `effectiveness` 投影条目，而不是新增命名空间。** 投影是浏览器已经通过会话投影注册表读取的逐会话状态，并以正在查看的会话为键。跨会话报告不是会话状态：它是一次语料读取，其成本与界限属于一次查询，而不属于某个会话的投影；把它折进投影会让每个会话都携带一个全主机范围的数字。

**把语料查询加进 usage 命名空间。** 两者都回答部署级数字，但它们读取不同的能力缝、遵守不同的界限，而合并后的命名空间会让一个包为一次并不使用它的调用依赖另一个包的服务。每个查询服务一个命名空间，正是 Remote 组装既有的规则。

**从领域报告派生 wire 类型。** 再导出 `EffectivenessReport` 及其投影，会把仅属领域的类型送到编解码器面前，并让 wire 契约随领域一起移动。usage 与 project 的 Remote 面出于同样的理由做了同样的选择：纯副本正是让重命名成为编译错误、而不是静默 wire 变更的地方。

**把缺少查询服务归类为它自己的失败码。** usage 命名空间回答 `usage/unavailable`，是因为组合可以挂载服务而不挂载 provider，而这种缺席是客户端必须处理的运行时状态。这里控制器注入的就是 `ctx.effectiveness`：没有查询服务的组合根本不会加载该控制器，因此不存在需要分类的运行时缺席。

**缓存报告。** 查询服务按需读取规范日志，而缓存需要为每个信号生产者提供失效来源——反馈、变更评审与任务报告都会向控制器从未见过的日志追加。控制器保持无状态，答案保持当前。

## Consequences

结果报告现在有了浏览器可调用的面，并遵守与其他每个命名空间相同的 wire 规则：受校验的请求、纯值、在整个答案已知之处施加界限，以及一个调用方可据以行动的失败。统计界面无需触碰查询服务或命令即可构建，而两个既有消费者继续原样工作，因为查询服务的契约没有移动。

代价是该命名空间目前没有仓库内消费者：`packages/client/ui-effectiveness` 尚不存在，因此已发布的 Web 组合中没有任何东西调用 `ctx.remote.effectiveness`。注册面因此先于其客户端挂载了命名空间，这也正是上面逐一列出它们、而不是由调用方发现它们的原因。

报告在 wire 上保留其语料语义。路由行之和可以超过总量，因为使用多个路由的一个会话会分别计入这些行；`turnsWithSignal: 0` 的含义是数据不足，而不是零比率；`truncated` 区分“没有更多会话携带信号”与“服务的界限被触及”——三者都继承自折叠，映射没有把其中任何一个抹平。

## Deferred

该报告的客户端包（`packages/client/ui-effectiveness`）尚未实现，因此该命名空间先于浏览器调用方发布。该命名空间的录制会话快照同样未包含：录制需要模型密钥，`evals/baseline.json` 与已录制快照出于这一原因保持未动。不发布 `./invariant` 伴随包，因为控制器不拥有持久状态，也没有任何独立观测可能产生分歧的关系——它复制查询服务所提供的内容，而投影自己的不变式伴随包拥有信号关系。

## Testing

在提供查询服务的前提下共七个用例：发布的方法与其服务键；一次携带空分类明细与截断标志的映射；一次携带每个已命名分类以及路由与会话各字段的映射；缺省 filter 作为整个语料与一份完整指定的 filter 并列传递；畸形 filter 在 wire 边界被拒绝且不触及服务；语料读取失败原样传播；以及畸形请求按其编解码器问题被分类。`src/index.ts` 保持逐文件 100% 覆盖。

构建为该包发射了两套 Typert 面与 remote 客户端，并重新运行了目录生成器，使该命名空间与其 wire 类型得到归类：`gen-cordis-catalog` 记录了服务页与两个被链接的类型，`gen-doc-graphs` 记录了服务角色，`gen-config-catalog` 与 `gen-module-graph` 报告其产物已是最新。
