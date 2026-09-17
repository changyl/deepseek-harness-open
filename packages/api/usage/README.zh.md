---
description: "usage 命名空间的 Host Remote 拥有者：单个 query 方法，在 usage 能力缝之上回答 token 总量、逐路由总量、未定价路由与读取时成本。"
kind: "package-reference"
---
# Usage Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-usage` 暴露面向浏览器统计页面的生成式 `ctx.remote.usage` 命名空间。一次 `query(filter?)` 调用返回与 `ctx.usage` 组装结果相同的报告——token 总量、逐路由总量、费率表未命名的路由，以及已定价子集上的成本——并映射为纯 wire 值。控制器不添加任何自己的策略：provider 选择、计价与未定价上报都位于 usage 服务中，因此每次调用都反映当时注册的费率表。未挂载 usage provider 的组合会回答 `usage/unavailable`，而不是零总量。

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

在 Web 应用中把本包作为 Loader 条目挂载，与 usage 服务及一个 provider 并列。

```yaml
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
- name: '@deepseek-ai/dsh-api-usage'
```

`dsh-web-app` 组合挂载的正是这一组合：`usage` 与 `usage-ledger` 来自 base 层，而本控制器是 Web 层唯一新增的东西。它生成的 `./typert` 导出把 Host 描述符送入严格的 Typert 注册表，生成的 `./remote` 导出则是 `dsh-api-remotes` 所挂载的 Client 贡献，正是它让浏览器可以调用 `ctx.remote.usage`。

`query(filter?)` 是该命名空间唯一的方法。缺省 filter 选择 provider 持有的全部数据；给出 filter 时按 `from`、`to`、`sessions`、`provider`、`model` 收窄。请求在 wire 边界以严格 schema 校验，因此未知键或类型错误的字段会以 `gateway/bad-request` 抛出并携带编解码器的问题，且绝不会到达 provider。

答案是纯副本的集合，而非领域对象：`totals` 携带四个互不重叠的 token 桶，以及会话、轮次、步骤与未知 usage 计数；`routes` 按路由携带同样的桶与计数；`unpriced` 命名费率表未声明的贡献路由；`cost` 仅在至少有一条路由被定价时出现。映射逐字段书写，因此在 usage 领域重命名字段会在这里成为编译错误，而不是静默的 wire 变更。`UsageRouteTotalsWire` 刻意不含 `turns` 字段，因为一个轮次可能切换路由，逐路由的轮次计数会重复计算。

成本保持服务的读取时语义。金额是表货币的整数微单位，`pricingVersion` 命名产生它们的修订，`complete: false` 标记省略了未定价路由份额的总量——因此客户端应把不完整金额渲染为下限，而绝不是测量值。未挂载费率表的组合因此只回答 token，完全没有 `cost`。

预期失败以稳定的 Remote 错误码到达调用方。没有 usage provider 的组合抛出 `usage/unavailable` 并携带服务自己的消息，因为不完整的组合不等于空语料。其他任何 provider 失败都原样传播，因此账本故障仍以自身面目可见。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

控制器是投影，而不是拥有者。它注入 `ctx.usage`，在 wire 边界校验唯一不受信任的输入，调用服务，并把答案映射到 wire 类型。它不持有缓存与状态，因此用同一 filter 的两次调用会两次读取服务，而两次调用之间发生的费率表变化会在第二次调用中可见。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `UsageController`：`@Remote` 方法、请求 schema 与报告到 wire 的映射 |
| [`src/types.ts`](src/types.ts) | Client 消费的 wire 类型，以及 `usage/unavailable` 错误码声明 |

### 服务与命名空间

`UsageController extends TypertRemoteService` 注册服务键 `usageController` 与 wire 命名空间 `usage`，这就是 Client 以 `ctx.remote.usage` 触达的东西。它的 `static inject = ['usage']` 命名了它唯一据以回答的服务；Gateway 通过 `typertRemote` 发现该命名空间，因此没有 gateway 的 Host 组合仍可挂载该控制器。

### 方法

| 方法 | 请求 | 答案 |
|---|---|---|
| `query` | `filter?`：`from`、`to`、`sessions`、`provider`、`model`，全部可选 | `UsageReportWire`：总量、逐路由总量、未定价路由与可选成本 |

### 失败

| 错误码 | 抛出条件 |
|---|---|
| `gateway/bad-request` | filter 未通过严格的 wire schema；details 携带编解码器问题 |
| `usage/unavailable` | 组合未挂载 usage provider；details 携带服务的消息 |

### Wire 值

| 类型 | 含义 |
|---|---|
| `UsageFilterWire` | 一次调用携带的选择条件 |
| `UsageTotalsWire` | 计数加上四个互不重叠的 token 桶 |
| `UsageRouteTotalsWire` | 同一组数字按路由拆分，不含 `turns` |
| `UsageRouteRefWire` | 未定价列表中的一条路由 |
| `UsageCostWire` | 货币、定价版本、整数微单位总量、完整性，以及逐路由份额 |
| `UsageReportWire` | 一份组装好的答案 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从 wire 命名空间走向其背后的能力缝，再到承载调用的 Remote 模型。

- [Usage 子系统](../../../docs/subsystems/usage.zh.md)——报告契约、token 桶，以及每个答案背后的 provider 与定价角色。
- [usage 组地图](../../usage/README.zh.md)——服务、账本、费率表与 `/usage` 命令。
- [api 组地图](../README.zh.md)——其他 Remote 命名空间及其组装方式。
- [API Gateway 参考](../../../docs/api-gateway.zh.md)——Typert 编程模型、生成流水线与运行时调用。
- [Typert 子系统参考](../../../docs/subsystems/typert.zh.md)——protocol、Gateway 与消费者组装共享的契约。

-----

<a id="model-experience"></a>
## 模型体验

### 不添加任何模型可见内容

#### 模型看到什么

什么都没有。`usage.query` 用已经发生过的请求的数字回答浏览器界面；它不添加提示词段落、工具 schema 或会话事件。

#### Token 影响

无。该命名空间从不组装或发送 provider 请求，因此无法改变模型读到什么，也无法改变请求携带多少 token。

#### KV Cache 影响

无。读取 usage 不会改动请求，因此它不可能使任何缓存前缀失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该命名空间当前能回答什么。它们是当下的包约束。

- **只读**——该命名空间不暴露任何写入或变更；客户端无法通过它改动项目、价格或已存数字。
- **无流式与变更推送**——唯一方法是单次调用，因此统计页面靠轮询，数字的新鲜度就是客户端的轮询间隔。
- **没有超出 provider 的拆分**——按会话、按轮次的数字只在 usage provider 自己上报的地方出现；控制器既不分组也不重算。
- **只在挂载 Web 组合处存在**——没有这一行的 Host 组合没有 `ctx.remote.usage`，Client 贡献也随之缺席。
- **没有 effectiveness 聚合端点**——结果信号仍是会话投影，因此读取它们的客户端不经过本命名空间。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。控制器不拥有持久状态，也没有自己的、可由独立观测产生分歧的关系；它校验一个请求并映射一份服务答案，其测试规范同时钉住该映射与每一次失败分类。
