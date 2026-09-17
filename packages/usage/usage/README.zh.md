---
description: "面向部署的 token 用量与成本查询：按桶与路由的合计、读取时定价，以及 ctx.usage 报告契约。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage

[English](README.md) | 中文

## 概述

当部署需要在一处报告 token 用量与成本时，挂载本包。消费者调用 `ctx.usage.query(filter)`，得到按桶与路由划分的 token 合计、定价表未命名的路由，以及存在价格时的成本。金额是单一货币的整数微单位，在读取时依据已注册定价表计算，因此任何已存储的数字都不会带有过期费率。未挂载提供方的装配会让查询失败，而不是返回全零合计。

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

在服务旁挂载一个用量提供方——通常是 `@deepseek-ai/dsh-usage-ledger`——并在需要成本时挂载一个定价表，例如 `@deepseek-ai/dsh-usage-pricing`。

### 组合

```yaml
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
- name: '@deepseek-ai/dsh-usage-pricing'
```

### 报告包含的内容

| 字段 | 含义 |
|---|---|
| `totals` | 整个所选语料的 token 桶，以及会话、轮次、步骤与用量未知步骤计数 |
| `routes` | 同样的 token 桶按 provider 与 model 拆分；每行只统计自身路由 |
| `unpriced` | 已注册定价表未命名的贡献路由 |
| `cost` | 已定价子集上的金额；没有任何贡献路由被定价时缺失 |

四个 token 桶互不重叠：被缓存的提示词 token 计入 `cacheReadTokens` 或 `cacheWriteTokens`，绝不会同时计入 `uncachedInputTokens`。`turns` 以会话为口径而非以路由为口径，因此路由行不携带轮次数；一轮可以在中途切换路由，按路由计数会重复计算。

### 注册提供方与定价表

`registerProvider` 与 `registerPricing` 各自只接受一次注册，第二次调用会抛错，而不是替换或合并。两者都返回在挂载 fiber 上释放该注册的清理函数。`price(provider, model)` 从已注册表中解析单个路由的价格。成本在读取时计算且从不存储，因此定价表的变化会直接作用于下一次查询，而不会改写任何 token 事实。

### 过滤查询

| 字段 | 含义 |
|---|---|
| `from` / `to` | 贡献事件时间的闭下界与开上界，Unix 纪元毫秒 |
| `sessions` | 存在时限定为这些会话 id |
| `provider` / `model` | 限定为某个已注册路由 |

字段缺失即不过滤；每个存在的字段都会收窄结果。已注册提供方决定该选择在自身事实上意味着什么。

### 失败与恢复

组合未挂载提供方时，`query()` 抛出 `UsageUnavailableError`，因此不完整的组合会显现出来，而不是被报告成全零合计。定价表未命名的路由出现在 `unpriced` 中且不贡献金额；当没有任何贡献路由被定价时，`cost` 缺失而非为零；只要存在未定价的贡献路由，`cost.complete` 即为 false。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释报告背后的连接过程；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该服务是 token 事实与价格相遇的唯一位置。提供方按过滤器给出合计与按路由合计，自身从不定价；部署的定价表把路由解析为每百万 token 的整数费率，自身从不读取日志。`assemble()` 遍历提供方的路由行一次，对定价表命名的路由用 `routeCostMicros` 定价，把其余路由收集进 `unpriced`，并在没有任何路由被定价时完全省略 `cost`。由于价格在查询时应用，替换费率卡不会与它所定价的 token 产生分歧，调用方也无法持久化一个会被后续费率变化作废的金额。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务类：注册、提供方与定价表的连接，以及 `UsageUnavailableError` |
| [`src/types.ts`](src/types.ts) | 报告、桶、计数、过滤器与定价类型 |
| [`src/cost.ts`](src/cost.ts) | `routeCostMicros`：每百万 token 的整数微单位，最后统一舍入一次 |
| [`src/totals.ts`](src/totals.ts) | 提供方与消费者共用的纯桶与计数算术 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当报告契约不够用时阅读以下页面。它们从子系统参考进入补全组合的两个包。

- [用量子系统](../../../docs/subsystems/usage.zh.md)——报告、定价与提供方契约及其确切字段。
- [用量账本包](../usage-ledger/README.zh.md)——把规范会话日志折叠成 token 事实的持久提供方。
- [用量定价包](../usage-pricing/README.zh.md)——部署自有的费率卡，含可在运行时编辑的设置命名空间。
- [用量包映射](../README.zh.md)——本族三个包及其仓库位置。

-----

<a id="model-experience"></a>
## 模型体验

### Token 记账服务

#### 模型看到的内容

无。该服务为宿主侧消费者回答 `ctx.usage.query()`，自身不注册任何工具、提示词片段或会话事件；其返回值只有在某个消费者通过自己的界面渲染时才会到达模型。

#### Token 影响

零：每个数字都在请求完成后从已写入日志的事实读取，因此该服务不会给任何请求增加 token。

#### KV Cache 影响

无：该服务从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明报告描述什么、成本何时缺失。它们是当前包约束，而非任务清单。

- **本仓库不附带费率卡**——价格是部署数据，因此未挂载定价表的组合会把每个路由报告为未定价，且不携带 `cost`。
- **报告只为定价表命名的路由定价**——`cost.complete: false` 意味着 `totalMicros` 低估了真实成本而非测量它；未命名的路由即使 token 被计入也不贡献金额。
- **每个组合只有一个提供方与一个定价表**——第二次 `registerProvider` 或 `registerPricing` 会抛错而非合并，因此拥有多个来源的部署必须在注册前先聚合。
- **`turns` 以会话为口径**——路由行不携带轮次数，`totals.turns` 统计所选会话中的不同轮次，而非每个路由的轮次。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只拥有一对注册与一个纯算术函数，其结果完全由入参决定。它所依赖的关系——每个组合只有一个提供方与一个定价表，以及费率以每百万 token 的非负整数微单位表示——是注册提供方与定价表的契约，在各自的入口处强制，而不是本包能够检查的独立观察。
