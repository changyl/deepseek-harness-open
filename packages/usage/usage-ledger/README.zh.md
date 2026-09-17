---
description: "持久用量提供方：把规范日志折叠为每会话一条 token 事实记录并缓存进 usage 存储域，使 ctx.usage.query() 能从历史作答。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-ledger

[English](README.md) | 中文

## 概述

挂载本包即可让 `ctx.usage.query()` 从持久历史作答。它从每个会话的规范日志推导出一条记录，并缓存进 `usage` 存储域，因此合计在重启后依然存在，删除全部记录也只付出一次重折叠的代价。每条记录折叠 `request/context` 路由变化、`step/end` 步骤与 assistant 用量；已定稿但没有任何用量样本的消息计为用量未知步骤。记录只保存 token 事实，从不保存价格，规范日志始终是权威。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把它挂在 `@deepseek-ai/dsh-usage` 旁，以及它所读取的服务旁：通过 `ctx.sessionQuery` 与 `ctx.sessionPersistence` 读取规范日志，通过 `ctx.storageDomain` 读写派生记录存储。

### 组合

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-session-query-sqlite'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `rebuildOnMount` | `false` | 挂载时删除全部已存记录，使下一次查询从规范日志重折叠每个会话 |

在折叠逻辑本身发生变化后使用 `rebuildOnMount: true`。正常启动保留缓存，只重折叠持久化修订号已变化的会话。

### 一条记录保存什么

| 字段 | 含义 |
|---|---|
| `turns` | 含至少一个已关闭步的不同轮次 |
| `steps` | 已关闭的步 |
| `unknownUsageSteps` | 适配器未上报用量样本的已定稿 assistant 消息 |
| `firstTime` / `lastTime` | 最早与最晚的贡献事件时间，空日志为 null |
| `throughSeq` | 折叠已消费的最大持久事件 seq |
| `routes` | 按路由的 token 桶，以及该路由的步骤与用量未知步骤计数 |

### 折叠如何归属事实

每个 `request/context` 设定其后事件的归属路由，因此日志尚未命名路由时记录的用量落在 `unknown/unknown` 上。每个 `step/end` 关闭一个步，一轮中的第一个 `step/end` 让该轮计为一次。用量取自 `assistant/message`——其内嵌样本或最后一个携带样本的流式分片——以及 `assistant/attempt`：同一轮同一步重复出现的相同样本被忽略，而同一轮同一步的不同样本会替换先前样本，并把被替换的桶从它们原先落到的路由上减去。针对当前轮与步的 `llm/retry-started` 会关闭该替换槽，因此重试后的尝试累加到合计上，因为两次尝试都被计费。已定稿且没有样本的 `assistant/message` 让 `unknownUsageSteps` 加一，因为它的 token 是未知而非零；没有样本的 `assistant/attempt` 不计入。

### 会话何时被重折叠

只要 `ctx.sessionPersistence.stat()` 给出的持久化修订号与该记录折叠时的一致，就会复用已存记录。修订号变化会从规范日志重折叠该会话。没有持久化修订号的会话会记录空修订号，它永不匹配，因此每次查询都会重折叠它。由于记录只是规范日志之上的派生状态，删除任何记录只付出一次重折叠的代价，且不改变任何上报合计。

### 失败与恢复

插件在挂载 fiber 上注册提供方，并在挂载时打开 `usage` 域，因此卸载会同时移除提供方与其表访问。没有 `ctx.usage` 时插件保持挂起，因为它注入了 `usage`。没有注册提供方时的查询会由服务抛出 `UsageUnavailableError`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释记录如何产生并保持新鲜；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

折叠对一个会话的事件列表是全函数，且不修改自身状态之外的任何东西，因此重复运行总是安全的，缺失的记录也总是可恢复的。路由事实累加进以 provider 与 model 为键的按路由映射，存储前再排序，从而让记录与聚合保持确定性。聚合只遍历一次所选记录，仅当某会话至少有一个路由行通过路由选择时才把它计为一个会话，并把路由计数与总计数一起累加，因此 `totals` 恒等于其路由行之和。提供方不持有任何定价知识：价格稍后由用量服务施加，因此替换费率卡绝不会让已存记录失效。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：提供方、查询循环、按修订号校验的缓存与聚合 |
| [`src/fold.ts`](src/fold.ts) | 从单个会话的规范事件到其用量记录的纯折叠 |
| [`src/spec.ts`](src/spec.ts) | `usage` 存储域及其记录 schema |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当折叠契约不够用时阅读以下页面。

- [用量子系统](../../../docs/subsystems/usage.zh.md)——本账本所满足的报告与提供方契约。
- [用量服务包](../usage/README.zh.md)——注册提供方并为其答案定价的服务。
- [用量定价包](../usage-pricing/README.zh.md)——施加到本账本 token 事实上的费率卡。
- [存储域包](../../storage/storage-domain/README.zh.md)——保存派生记录的、经 schema 校验的 KV 域。
- [会话查询包](../../session-query/session-query/README.zh.md)——折叠所消费的规范日志读取。
- [用量包映射](../README.zh.md)——本族三个包及其仓库位置。

-----

<a id="model-experience"></a>
## 模型体验

### 持久 token 事实

#### 模型看到的内容

无。提供方为 `ctx.usage.query()` 作答，自身不注册任何工具、提示词片段或会话事件；它读取的是其他包已经写入的会话日志。

#### Token 影响

零：折叠在请求完成后读取已提交日志，因此提供方不会给任何请求增加 token。

#### KV Cache 影响

无：提供方从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明查询能选择什么、数字来自何处。它们是当前包约束，而非任务清单。

- **时间过滤选择整个会话**——`from` 与 `to` 按会话的事件跨度保留或丢弃该会话，而不是按单个事件；与长会话重叠的窗口会包含该会话的全部 token。
- **工作区过滤尚未实现**——过滤器不携带工作区字段，调用方无法把查询限定到某个工作区。
- **活跃会话每次查询都会重折叠**——持久化修订号持续变化的会话永远匹配不上缓存记录，因此每次查询都会重新折叠它的整份日志。
- **路由归属依据 `request/context`**——日志从未归属到某个已路由请求的用量会报告在 `unknown/unknown` 上；步中途切换路由会让整个步归属到该步关闭时生效的路由。
- **不使用提供方的搜索 API**——账本列出每个会话并在本地折叠，因此提供方自己的搜索索引无法收窄查询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包拥有对单个会话规范事件的完全折叠，以及其上的按修订号校验的缓存。该缓存是派生状态，唯一权威是规范日志，因此过期或被删除的记录最多只付出一次重折叠，绝不会改变上报合计；折叠所依赖的事件关系——每个已路由请求恰有一个 `request/context`、`step/end` 关闭每个已进入的步，以及用量样本由其 assistant 事件携带——由 dsh-agent-loop 与 Session surface 拥有并在运行时检查，而不由本包拥有。
