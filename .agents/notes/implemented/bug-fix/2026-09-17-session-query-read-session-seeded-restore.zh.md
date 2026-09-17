# Agent Note：readSession 按恢复契约校验种子化日志

Status: implemented

[English](2026-09-17-session-query-read-session-seeded-restore.md) | 中文

## Problem

`SessionQueryEngine.readSession(id)` 是统计界面的规范日志读取器：用量账本通过它重新折叠一个会话，有效性报告通过它折叠整个语料库，轮次任务报告通过它读取自己的会话。它通过 `Session.create` 重构存储日志以复用恢复的回放校验，而 `Session.create` 运行在 snapshot 模式，其种子契约只有被继承前缀：种子化头部要求 `inheritedEventCount === seed.length`，否则构造器抛出 "seeded session constructor seed must equal its inherited prefix"。

语料库提供的是完整存储日志加上从带标记的 `session/end-seed {inherited: true}` 推导出的切点——即标记自身的 seq，正如[end-seed 日志边界](../architecture/2026-07-30-session-end-seed-log-boundary.zh.md)所定义。因此对任何在切点之后写入过事件的种子化会话，该断言永远不成立，而每个 subagent 会话恰恰如此：活跃子会话在自己的切点追加标记，随后写入自己的事件。在任何运行过 subagent 的部署上，第一个冷的种子化会话就会让重构失败并拖垮整次聚合查询——`/usage`、设置页的用量与有效性区块、subagent 会话的任务报告全部以同一个内部错误失败，而同一批会话经观察路径读取完全正常，因为那条路径通过 `sessions.prepare` 携带日志的别名状态做恢复。

来自本机（发布此修复的机器）的证据：74 份存储日志中，19 份种子化日志全部违反 snapshot 契约，55 份非种子化日志全部读取正常。

## Decision

`LogicalSession` 携带冷读的 `eventState`，`readSession` 改用 `Session.fromRestore(id, events, header, inheritedEventCount, eventState)` 校验——即观察路径已在用的恢复契约。校验内容不变（事件信封、连续 seq、表层迁移、头部字段）；改变的是种子按「完整日志加继承切点」判定，而非创建时的前缀——这才是存储日志的实情。`load()` 在交付前克隆每个事件，因此实时快照与持久两条路径上逻辑会话的别名状态都是 `detached`。

## Alternatives considered

**在 `readSession` 里把 seed 截切到继承切点。** 种子前缀契约就能成立。否决：折叠消费方需要整个日志，截切会让用量与有效性报告静默丢失每个切点后的事件，且返回快照不再与存储日志一致。

**放宽 `Session` 的 snapshot 断言。** 否决：创建时契约对其自身的调用方是正确的——fork 或回放的种子必须是新生命周期继承的前缀——且核心测试已钉住它。缺陷在于查询引擎对存储日志用错了构造入口。

**不重构 Session、直接折叠存储事件。** 回放校验的存在意义就是拒绝任何活跃会话都无法恢复的日志；丢掉它会让存储损坏变成静默错误的统计。

## Consequences

种子化存储会话经 `readSession` 完整读回，用量与有效性报告重新折叠完整语料库，subagent 会话的任务报告也能读取自己的日志。非种子化会话以零切点走同一路径，行为不变。事件词汇、头部字段与线上格式均未改变，录制会话快照不会移动。

覆盖：[session-query 规格](../../../../packages/session-query/session-query/tests/session-query.spec.ts)钉住「种子化且切点后仍有事件」的读取——切点、标记与切点后事件——并保留损坏种子拒绝与非种子化分离日志契约；语料库测试替身现在按真实后端扫描的方式，从存储日志的带标记事件推导继承切点。
