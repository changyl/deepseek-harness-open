# Agent Note: 通过单一 usage 能力缝上报 token 用量与成本

Status: implemented

[English](2026-09-16-usage-statistics-seam.md) | 中文

## Problem

Harness 早已记录了成本报告所需的一切：每个终结的 Assistant 事件都带 provider 上报的 usage，`request/context` 记录是哪个 provider 与 model 服务了该请求。缺的是查询面。`sessionStats` 统计单个会话的轮次、步骤与墙钟时间，`tokenUsage` 暴露单个会话的四个 token 桶，`session-telemetry` 把事件导出到外部后端做报表。想要知道一周工作花了多少钱、哪个模型消耗了 token、哪些路由没有费率表的部署，只能自己把这些来源拼起来，而产品本身完全不认识任何价格。

两个约束塑造了这个问题。价格属于部署数据：仓库不提供任何费率表，货币各不相同，部署会重新议价而不改动 harness。并且 token 事实绝不能与价格混淆：费率一变，已存金额立即失效，而已存 token 计数始终为真。

## Decision

一条 usage 能力缝由六个包共同拥有陈述、回答、人工入口与浏览器面。

`@deepseek-ai/dsh-usage` 是 Service Definition 与查询消费者。它拥有 `ctx.usage`、报告契约（`UsageFilter`、`UsageTotals`、`UsageRouteTotals`、`UsageReport`）、桶与成本算术，以及两个注册面：一个 usage provider 与一张定价表。两者重复注册都会抛错。`query(filter)` 向 provider 取 token 事实，再与已注册的表连接。

`@deepseek-ai/dsh-usage-ledger` 是 provider。它通过 `ctx.storageDomain` 在 storage 域 `usage` 中为每个会话派生一条记录，折叠 `request/context` 的路由变化、`step/end` 的步骤、`assistant/message` 与 `assistant/attempt` 的 usage 样本，以及 `llm/retry-started` 的替换槽。记录保存 token 事实、观测时间，以及它所折叠的持久化 revision；查询只在该会话的 `sessionPersistence.stat()` 报告了不同 revision 时重新折叠，因此冷会话代价是一次读取，活动会话在稳定前每次查询一次读取。规范会话日志仍是唯一权威：删除全部派生记录的代价就是一次重新折叠。

`@deepseek-ai/dsh-usage-pricing` 是部署的费率表。它把组合的 `Config` 注册为定价表，并在挂载了 settings provider 时，在每次提交后重新读取 `usage-pricing` 设置命名空间。费率是单一货币的整数微单位／百万 token，因此总金额在客户端格式化之前始终保持精确整数。一张表里两条路由命名同一 provider 与 model 会在加载期被拒绝，因为这张表无法知道哪条才是本意。

`@deepseek-ai/dsh-api-usage` 是 Remote 面：一个 `TypertRemoteService`，发布 `ctx.remote.usage`，只有一个 `query(filter?)` 方法。它把领域报告映射为纯 wire 值，而不是把领域对象交给编解码器；在 wire 边界校验请求；并且只把调用方能够据以行动的那一个领域失败转换为 `usage/unavailable`，其余 provider 失败原样透传。

`@deepseek-ai/dsh-command-usage` 是 Consumer 角色：全局命令 `/usage [<window>] [<provider>/<model>]`，在不消耗模型轮次的前提下渲染同一份报告。它只拥有自己的参数语法与文本；金额按完整微单位精度打印，非法参数在查询之前即被拒绝，未挂载 provider 的组合报告为"不可用"而不是"空"。

`@deepseek-ai/dsh-client-ui-usage` 是浏览器消费者：`ctx.remote.usage` 之上的一个 Web 全局面板，记录于[usage 面板笔记](2026-09-16-usage-settings-section.zh.md)。它在挂载时以及按需读取时读取整个语料，渲染总计、逐路由表、未定价列表与费用提示，除当前展示的这一次读取之外不保留任何状态。

三项报告语义由这些选择推出，并属于契约本身：

- 成本在读取时按当前表计算，并携带该表的 `version`，因此没有任何报告会把金额与一个并非其来源的费率表混在一起。
- 表中没有命名的路由会出现在 `unpriced` 中且不贡献金额。当没有任何路由被定价时，`cost` 缺失而不是 0：看到没有成本的消费者报告"不可用"，绝不报告"免费"。适配器未上报 usage 的已终结消息计入 `unknownUsageSteps`，而不是计入零桶。
- `turns` 是会话级作用域；`steps`、`sessions` 与 `unknownUsageSteps` 同时按路由上报。按路由筛选的查询只统计使用该路由的会话，而未筛选的查询统计每个被观测到的会话，即使它没有消耗 token。

`dsh-base` 组合挂载 `usage`、`usage-ledger` 与 `command-usage`，并刻意不挂载任何定价表：费率表属于部署数据，因此在某个组合自带货币与费率加入 `usage-pricing` 之前，所有路由都上报为未定价。

## Alternatives considered

**把成本事实与 token 事实一起存起来。** 折叠本可以在观测时按当时生效的费率相乘，并把微单位存入记录。这会让每一份历史报告变成两个权威之间的争执：已存金额与当前费率表。费率修正将需要重写持久记录，而不是改一个回答；从旧缓存恢复的记录会上报部署已不再收取的价格。在读取时派生金额，使记录保持为 token 事实、价格保持为部署事实。

**在 LLM 路由上声明费率。** `LlmModel` 已经带有 `contextWindow`，`LlmImageRequestPricing` 也表明路由自有的定价是被接受的模式，因此货币费率本可以并入模型目录。那会扩大一个由所有 provider 适配器消费的 pre-stable 公共类型，并且混淆两个不同的事实：一条路由的请求是否具有视觉 token 价格，与部署是否为它付钱无关。用户可在运行时编辑的费率属于设置面，而属于目录快照。

**每次查询都折叠全部语料，不要派生存储。** provider 本可以每次查询读取每个会话日志。这更简单，且少一个持久面，但统计页会轮询，每次轮询都会重读并重折整个语料。把折叠放在 revision 检查之后，使常见查询的开销与"变化了多少"成正比。

**把聚合做成第二个 SQLite 索引。** `session-query-sqlite` 是派生数据库带 `openAt` 策略的先例。它存在是为了回答排序全文检索，那是 KV 域做不到的；usage 总计是每会话的小记录，domain form 已经以 schema 校验与变更事件的方式持久保存它们。第二个数据库会为一个访问模式是"按会话点读"的数据再加一套 schema、重建策略与生命周期。

**给 `sessionStats` 加一个成本字段。** `sessionStats` 折叠的是日志结构——步骤边界与墙钟时间——它不认识路由，也不认识部署配置。给它加价格，要么把部署配置引入结构折叠，要么让渲染统计条的客户端拿不到成本。

## Consequences

这条能力缝换来一份绝不会静默按错误费率计费的报告、一个永远可以安全删除的缓存，以及一个可以在不触碰报告契约的前提下替换的 provider。代价是：在部署显式提供费率表之前不会出现任何成本；活动会话因持久化 revision 持续变化而每次查询都要重新折叠。

上报窗口是会话粒度的：`from` 与 `to` 按事件跨度选择整个会话，而不是切分事件，因为记录是按会话聚合的。按工作区筛选尚未实现；会话头带有 `cwd`，而不存在可用于匹配 workspace id 的"会话→工作区"反向索引。

## Testing

折叠针对手工构造的事件日志做测试，覆盖路由归属、替换、重试、未知 usage 计数，以及未上报 usage 的失败尝试。聚合针对桶求和、去重会话计数、路由筛选，以及"被观测到但无 token 的会话"规则做测试。provider 用桩协作者覆盖 revision 命中、revision 变化与无 revision 三条路径。一个真实组合挂载 storage hub、JSON 后端、domain form、usage 服务与 ledger，并配以内存持久化探针，验证插件注册、查询路径、卸载时 provider 移除，以及 `rebuildOnMount` 丢弃。命令通过真实命令注册表测试其语法、渲染文本、过滤条件构造、不可用组合与卸载；每个包都达到逐文件 100% 覆盖率。
