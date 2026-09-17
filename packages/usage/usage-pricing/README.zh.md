---
description: "面向 ctx.usage 的部署自有路由定价：每百万 token 的整数微单位费率、可在运行时编辑的设置命名空间，以及对重复路由的显式拒绝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-pricing

[English](README.md) | 中文

## 概述

挂载本包以为 `ctx.usage` 提供费率卡。它依据组合配置注册一个定价表；当挂载了设置提供方时，每次提交都会重新读取 `usage-pricing` 设置命名空间，因此费率无需重新挂载即可变化。费率是单一货币每百万 token 的整数微单位，定价表未命名的路由保持未定价。同一路由在一个表中出现两次会在加载时被拒绝，而不是由最后一条决定。

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

当部署需要报告成本时，把它挂在 `@deepseek-ai/dsh-usage` 旁，并给出部署希望定价的每个路由。费率是部署数据：下面的数值只是示例，不是随仓库发布的费率卡。

### 组合

```yaml
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-pricing'
  config:
    currency: CNY
    version: '2026-09-16'
    routes:
      - provider: deepseek
        model: chat
        uncachedInputPerMillion: 2000000
        outputPerMillion: 8000000
        cacheReadPerMillion: 200000
        cacheWritePerMillion: 2500000
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `currency` | 必填 | 本表中每个费率的货币 |
| `version` | 必填 | 部署自有的版本标签，回显进每个已组装报告 |
| `routes` | `[]` | 已定价路由；此处缺失的路由会被报告为未定价 |

### 路由费率

| 字段 | 含义 |
|---|---|
| `provider` / `model` | 这些费率所定价的已注册路由 |
| `uncachedInputPerMillion` | 每百万未缓存输入 token 收取的微单位 |
| `outputPerMillion` | 每百万输出 token 收取的微单位 |
| `cacheReadPerMillion` | 每百万缓存读取输入 token 收取的微单位 |
| `cacheWritePerMillion` | 每百万缓存写入输入 token 收取的微单位 |

费率为 `0` 表示提供方不对该桶收费；它不会让路由变成未定价。

### 运行时费率变更

当挂载了设置提供方时，插件以组合配置为基值注册 `usage-pricing` 命名空间，随后整体采纳每个已提交的值。一次提交会同时替换货币、版本与路由；没有任何内容合并进组合表。命名空间语法只允许小写单词与单个连字符，因此发布出的命名空间把带点的服务名写成不带点的形式。

### 失败与恢复

同一路由出现两次的定价表会在加载时被拒绝，每个被采纳的设置值也按同样规则校验，因此有歧义的费率卡绝不会参与定价。缺失的 `currency` 或 `version`、负费率或畸形的 `routes` 条目都会在定价表到达 `ctx.usage` 之前以配置校验失败告终。没有用量服务时插件保持挂起，因为它注入了 `usage`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释定价表如何保持最新；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

一个 `UsagePricingTable` 实例存活于插件的整个生命周期并持有当前已校验配置，因此运行时编辑无需在 `ctx.usage` 上重新注册任何东西即可到达消费者。`registerPricing` 通过 `ctx.effect` 只调用一次，设置作用域只在 `inject(['settings'])` 回调内注册，这就是未挂载设置提供方的组合保持组合表不变的原因。路由查找以不会出现在两个名称中的分隔符连接 provider 与 model 作为键，`assertDistinctRoutes` 在构造时与每次采纳时都运行，因此重复项既无法加载，也无法在之后被引入。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、`UsagePricingTable`、重复路由校验、设置命名空间接线 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当配置界面不够用时阅读以下页面。

- [用量子系统](../../../docs/subsystems/usage.zh.md)——本定价表所满足的定价与报告契约。
- [用量服务包](../usage/README.zh.md)——注册定价表并用它定价报告的服务。
- [用量账本包](../usage-ledger/README.zh.md)——本定价表所定价的持久提供方。
- [用户设置子系统](../../../docs/subsystems/settings.zh.md)——命名空间注册、分层解析与热提交。
- [用量包映射](../README.zh.md)——本族三个包及其仓库位置。

-----

<a id="model-experience"></a>
## 模型体验

### 部署费率卡

#### 模型看到的内容

无。插件在 `ctx.usage` 上注册定价表，不注册任何工具、提示词片段或会话事件；费率只有在某个消费者通过自己的界面渲染报告时才会到达模型。

#### Token 影响

零：费率在组装报告时读取，此时被定价的请求已经完成，因此插件不会给任何请求增加 token。

#### KV Cache 影响

无：插件从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明费率卡能表达什么、运行时编辑如何生效。它们是当前包约束，而非任务清单。

- **设置命名空间不是带点的服务名**——命名空间语法只允许小写单词与单个连字符，因此发布的命名空间是 `usage-pricing`，而其他用量界面使用带点的名称。
- **一次提交会替换整张表**——货币、版本与路由被一起采纳；部分编辑不会合并进组合表。
- **未定价的路由不等于免费路由**——`routes` 中缺失的路由不贡献金额并被报告为未定价，而费率为 `0` 是对该桶声明的零价格。
- **每个组合只有一张表**——`ctx.usage.registerPricing` 拒绝第二张表，本插件只注册一张，因此多个费率来源必须在配置前先合并。
- **费率不能细于每百万 token 一微单位**——费率是整数，更小的单位价格无法表示，必须用该货币的单位表达。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本插件持有一张已校验配置表与一个已注册的 `UsagePricing`。它唯一可检查的关系——一张表对每个路由至多命名一次——由构造时与每次采纳设置值时的同一校验强制，而重复注册会通过 `ctx.usage.registerPricing` 本身显现，因此没有留给伴生入口的独立观察。
