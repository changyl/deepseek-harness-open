---
description: "基于 ctx.effectiveness 的跨会话成效查询：按会话与按路由的全会话语料成效计数，按需从规范会话日志折叠得出。"
kind: "package-reference"
---

# @deepseek-ai/dsh-effectiveness-query

[English](README.md) | 中文

## 概述

本包回答按会话的 `effectiveness` 投影无法回答的部署级问题：哪些路由承载了负评、回退与失败的验证。`ctx.effectiveness.query()` 用该投影所服务的同一个单元折叠被选中的会话语料，返回全语料合计、每条路由一行，以及有界的逐会话行。它通过 session-query 服务按需读取规范日志且不做任何缓存，因此一份报告就是语料的当前状态，而不是某个人必须记得去刷新的快照。`dsh-base` 组合挂载它，而 [`command-effectiveness`](../command-effectiveness/README.zh.md) 把这份报告渲染为人类可用的 `/effectiveness` 命令。

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

`dsh-base` 组合已挂载该服务，因此已发布组合本就提供 `ctx.effectiveness`；下面的区块是部署手动加入它时的最小形态。它不需要投影注册表，也不需要自带的生产方包：它读取日志中已有的内容。

### 组合

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-session-query'
- name: '@deepseek-ai/dsh-effectiveness-query'
  config:
    maxSessionsReported: 200
```

缺少 session-query 服务时该 fiber 保持 pending，因此从未组合它的装配不会提供 `ctx.effectiveness` 键。生产方包并不是依赖：一份既无反馈、又无变更决定、也无任务报告的日志，折叠出来就是全零计数。

### 报告携带什么

| 字段 | 含义 |
|---|---|
| `totals` | 在全部被选会话上求和后的成效投影，外加 `sessions` |
| `totals.turnsWithSignal` | 逐会话轮次计数相加，因此同一个轮次出现在两个会话中就计两次 |
| `routes` | 被选日志命名过的每条路由一行，各行携带同样的成效字段外加 `sessions` |
| `sessions` | 逐会话行，最新的在前，每行携带自己的 `routes` 列表与 `createdAt` |
| `truncated` | 逐会话行是否在 `maxSessionsReported` 处被截断 |

成效字段就是 [`effectiveness` 投影](../effectiveness/README.zh.md)所服务的那一组：`feedback.positive`、`feedback.negative`、`feedback.byCategory`、`changes.accepted`、`changes.reverted`、`changes.undecided`，以及 `verification.passed`、`verification.failed`、`verification.unknown`。

### 窗口与路由筛选

`from` 与 `to` 按会话所贡献事件的时间跨度界定会话：当一个会话的跨度与窗口相交，就整体选中该会话，而不会逐事件切分。`sessions` 把语料限定为具名 id。`provider` 与 `model` 选择日志命名过该路由的会话，并把路由行限定为该路由；因此路由筛选会丢弃从未使用该路由的会话，而未筛选的查询会保留日志至少观测到一个事件的每个会话。

### 计数来自哪里

每个被选会话的规范事件都通过 `effectivenessProjectionDefinition` 折叠，这正是按会话投影所注册的同一个单元，因此"信号""被重新评价的消息""被重新决定的变更"与"未决定的已应用变更"的含义与投影完全一致。会话被归属到的路由来自其 `request/context` 事件，按首次出现顺序、按 provider 与 model 去重。日志命名了多条路由的会话，会把整份投影加入它用到的每一行路由，这正是路由行之和可能高于合计的原因。

### 失败与恢复

每次查询都通过 `ctx.sessionQuery` 重新读取语料，因此某个会话的持久日志不可读时，调用会被拒绝而不是被静默跳过；调用方看到失败并可以重试。没有任何缓存，因此不存在会过期的已存报告，崩溃后也没有需要调和的状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释报告背后的折叠；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计思路

该服务是对语料的无状态折叠：它列出查询服务暴露的会话，读取每个会话的规范日志，用共享的成效单元折叠它，把结果归属到日志命名过的路由，并装配出报告。唯一的刻意不对称是归属方式——一个会话的计数只加入语料合计一次，却加入它用到的每一行路由——因为按路由的答案必须能独立阅读；报告把这一后果直接写明，而不是把它藏起来。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务本身、筛选与报告类型、语料遍历，以及路由归属 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当本服务的契约不够用时阅读这些页面。它们从它所读取的语料走向它所复用的按会话单元。

- [成效投影包](../effectiveness/README.zh.md)——本查询用来折叠每份日志的按会话单元，以及"信号""未决定变更""样本不足"的定义。
- [会话查询包](../../session-query/session-query/README.zh.md)——本查询所遍历的、优先使用活动会话的语料与日志读取。
- [会话查询子系统](../../../docs/subsystems/session-query.zh.md)——查询服务的契约、筛选器与关系追溯。
- [会话持久化包](../../session/session-persistence/README.zh.md)——语料列出所依据的持久存储。
- [反馈子系统](../../../docs/subsystems/feedback.zh.md)——计数所累加其信号的反馈类型。
- [反馈包映射](../README.zh.md)——本组各包及其仓库位置。

-----

<a id="model-experience"></a>
## 模型体验

### 跨会话成效读模型

#### 模型看到的内容

无。该服务通过 `ctx.sessionQuery` 读取规范会话日志并把报告返回给调用方；它不注册任何工具、提示词片段或会话事件，报告只通过 `/effectiveness` 命令到达人，而该命令本身也只写日志。

#### Token 影响

零：报告在事后从已写入日志的事件推导，因此不会给任何请求增加 token。

#### KV Cache 影响

无：本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明一份报告能表达什么、产出它的代价是什么。它们是当前包约束，而非任务清单。

- **没有持久索引，也没有缓存**——每次查询都列出语料并读取每个被选会话的规范日志，因此在大语料上生成一份报告代价很高，重复调用要再付一遍全部成本。
- **没有 Remote 面与 Web UI**——已发布的消费方是渲染文本的 `/effectiveness` 命令；浏览器面还需要一个尚不存在的 Remote 命名空间。
- **按路由的行会重复计算多路由会话**——使用了多条路由的会话会把整份投影加入这些行的每一行，因此路由行之和可能高于 `totals`；只有恰好使用一条路由的会话才能干净地分摊。
- **`from` 与 `to` 是会话粒度的**——窗口按事件跨度相交来整体选择会话，因此报告无法隔离某个会话落在窗口内的那部分。
- **没有按轮次的路由归属**——一个会话的计数被归属到它命名过的每条路由，而不是归属到服务该信号所属轮次的那条路由。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只拥有一个无状态折叠，其逐会话结果来自共享的 `effectivenessProjectionDefinition` 单元，payload 由该单元自身的 schema 校验；它所依赖的语料关系（会话列举会命名每一份可读日志、`readSession` 按顺序返回该会话的规范事件，以及 `request/context` 事件携带日志命名过的 provider 与 model）由 dsh-session-query 与 dsh-session 拥有并在运行时检查，而不由本包拥有。
