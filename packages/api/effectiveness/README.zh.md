---
description: "effectiveness 命名空间的 Host Remote 拥有者：单个 query 回答跨会话的结果信号——反馈、变更评审决策与验证结果——给出语料总量、逐路由行与逐会话行。"
kind: "package-reference"
---
# Effectiveness Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-effectiveness` 暴露面向浏览器统计面的生成式 `ctx.remote.effectiveness` 命名空间。单个 `query(filter?)` 调用回答 `ctx.effectiveness` 组装的同一份报告——语料总量、逐路由行与逐会话行，涵盖人工反馈、变更评审决策与验证结果，各自带上携带信号的去重轮次数。控制器不添加任何自己的策略：语料选择、逐会话折叠与上报界限都位于查询服务中，因此每次调用都反映当时可读取的日志。没有信号的会话报告 `turnsWithSignal: 0`，其含义是数据不足，而不是零比率。

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

在 Web 应用中把本包作为 Loader 条目挂载，与跨会话查询服务并列。

```yaml
- name: '@deepseek-ai/dsh-effectiveness'
- name: '@deepseek-ai/dsh-effectiveness-query'
- name: '@deepseek-ai/dsh-api-effectiveness'
```

`dsh-base` 组合挂载查询服务与人工使用的 `/effectiveness` 命令；`dsh-web-app` 层再加上会话投影与本控制器。它生成的 `./typert` 导出把 Host 描述符送入严格的 Typert 注册表，生成的 `./remote` 导出则是 `dsh-api-remotes` 所挂载的 Client 贡献，正是它让浏览器可以调用 `ctx.remote.effectiveness`。控制器要求 `ctx.effectiveness`；未挂载查询服务的组合加载失败，而不是回答一份空报告。

`query(filter?)` 是该命名空间唯一的方法。缺省 filter 选择主机上每个可读取的会话；给出 filter 时按 `from` 与 `to`（限定会话的贡献事件时间）、`sessions`，以及会话日志曾命名的 `provider` 与 `model` 收窄。请求在 wire 边界以严格 schema 校验，因此未知键或类型错误的字段会以 `gateway/bad-request` 抛出并携带编解码器的问题，且绝不会到达查询服务。除此之外没有别的失败分类：语料读取失败原样传播，因此会话存储的问题仍以自身面目可见。

答案是一组纯副本，而绝不是领域对象。`totals` 携带语料级信号与贡献会话数；`routes` 携带每个 provider 与 model 组合的同样信号，以及使用它的会话数；`sessions` 为每个被选中的会话给出一行，最新在前，并带上其日志曾命名的路由；`truncated` 报告部署配置的界限切断了会话行。

每份投影都有三部分。`feedback` 是人工对单条助手消息的当前判断——正面与负面计数，以及省略了所有无判断类别的分类明细。`changes` 统计会话所应用文件变更中被接受、被回滚与仍无决策的决策数。`verification` 统计任务报告结果中通过、失败与未上报结果的命令数。分类键在 wire 侧由一份 `CATEGORIES` 列表迭代得出，因此在映射的任何一侧重命名都会成为编译错误，而不是被静默丢弃的计数；同样的逐字段映射意味着领域内重命名在这里是编译错误，而不是静默的 wire 变更。

上报界限不属于本包：`maxSessionsReported` 是 [`dsh-effectiveness-query`](../../feedback/effectiveness-query/README.zh.md) 的受校验配置字段，而本控制器完全不持有配置。因此被截断的答案告诉客户端还有更多会话携带信号，而不是从哪里继续——该命名空间没有 offset 或游标，想展示每个会话的界面需要在查询服务上配置更大的界限。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

### 设计理念

控制器是投影，而不是拥有者。它注入 `ctx.effectiveness`，在 wire 边界校验唯一不受信任的输入，调用服务，并把服务答案映射到 wire 类型。它不持有缓存与状态，因此用同一 filter 的两次调用会两次读取语料，而两次调用之间记录的反馈或变更决策会在第二次调用中可见。产生信号的折叠留在查询服务中，因此一行所统计的内容不会与记录它的规则发生偏离。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | `EffectivenessController`：`@Remote` 方法、filter schema、分类列表，以及报告到 wire 的映射 |
| [`src/types.ts`](src/types.ts) | Client 消费的 wire 类型，含反馈分类联合 |

### 服务与命名空间

`EffectivenessController extends TypertRemoteService` 注册服务键 `effectivenessController` 与 wire 命名空间 `effectiveness`，这就是 Client 以 `ctx.remote.effectiveness` 触达的东西。它的 `static inject = ['effectiveness']` 命名了它唯一据以回答的服务；Gateway 通过 `typertRemote` 发现该命名空间，因此没有 gateway 的 Host 组合仍可挂载该控制器。该服务不接收 `Config`。

### 方法

| 方法 | 请求 | 答案 |
|---|---|---|
| `query` | `filter?`：`from`、`to`、`sessions`、`provider`、`model`，都可选 | `EffectivenessReportWire`：语料总量、逐路由行、逐会话行与截断标志 |

### 失败

| 错误码 | 抛出条件 |
|---|---|
| `gateway/bad-request` | filter 未通过严格的 wire schema；details 携带编解码器问题 |

### Wire 值

| 类型 | 含义 |
|---|---|
| `EffectivenessFilterWire` | 一次 `query` 调用携带的选择条件 |
| `FeedbackCategoryWire` | 反馈明细所依据的分类联合 |
| `EffectivenessFeedbackWire` | 当前正面与负面判断，以及逐分类计数 |
| `EffectivenessChangesWire` | 被接受、被回滚与无决策的变更评审决策 |
| `EffectivenessVerificationWire` | 通过、失败与未知的验证结果 |
| `EffectivenessProjectionWire` | 单个会话或路由的信号，以及其携带信号的轮次数 |
| `EffectivenessTotalsWire` | 语料级的同样信号，外加贡献会话数 |
| `EffectivenessRouteRefWire` | 会话日志曾命名的一个路由 |
| `EffectivenessRouteRowWire` | 单个路由的信号，以及使用它的会话数 |
| `EffectivenessSessionRowWire` | 单个会话的信号、创建时间与其日志曾命名的路由 |
| `EffectivenessReportWire` | 一份组装好的答案 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从 wire 命名空间走向其背后的折叠，再到承载调用的 Remote 模型。

- [feedback 子系统](../../../docs/subsystems/feedback.zh.md)——投影契约、信号来源，以及每一行背后的结果语义。
- [feedback 组地图](../../feedback/README.zh.md)——投影单元、跨会话查询服务与人工使用的 `/effectiveness` 命令。
- [api 组地图](../README.zh.md)——其他 Remote 命名空间及其组装方式。
- [API Gateway 参考](../../../docs/api-gateway.zh.md)——Typert 编程模型、生成流水线与运行时调用。
- [Typert 子系统参考](../../../docs/subsystems/typert.zh.md)——protocol、Gateway 与消费者组装共享的契约。

-----

<a id="model-experience"></a>
## 模型体验

### 不添加任何模型可见内容

#### 模型看到什么

什么都没有。`effectiveness.query` 用已经运行过的会话的计数回答浏览器界面；`ctx.remote.effectiveness` 不添加提示词段落、工具 schema 或会话事件。

#### Token 影响

无。该命名空间从不组装或发送 provider 请求，因此无法改变模型读到什么，也无法改变请求携带多少 token。

#### KV Cache 影响

无。读取结果信号不会改动请求，因此它不可能使任何缓存前缀失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该命名空间当前能回答什么。它们是当下的包约束。

- **只读**——该命名空间不暴露任何写入或变更；记录评分、变更决策或任务报告，仍由拥有这些事件的包承担。
- **无缓存**——每次调用都会重新折叠被选中的会话，因此语料越宽，每会话一次日志读取的成本越高；客户端与其读取一份物化报告，不如自担成本地轮询。
- **无分页与游标**——逐会话行被查询服务的 `maxSessionsReported` 切断，并由答案报告 `truncated`；需要其余部分的客户端无法请求后续页。
- **`turnsWithSignal: 0` 不是比率**——它说明该会话或路由还没有记录任何结果信号，因此界面必须渲染为数据不足，而不是零质量。
- **路由行之和可以超过总量**——使用多个路由的一个会话会分别计入这些行，因此把某个信号的路由行相加，可能把该会话重复计数。
- **语料是全主机范围**——缺省 filter 会读取主机能读取的每个会话；按工作区或按 agent 收窄不属于本契约。
- **无流式与变更推送**——唯一的方法是单次调用，因此统计页面靠轮询，数字的新鲜度就是客户端的轮询间隔。
- **只在挂载 Web 组合处存在**——没有这一行的 Host 组合没有 `ctx.remote.effectiveness`，`dsh-api-remotes` 中的 Client 贡献也随之缺席。
- **未发布客户端界面**——本包是统计页面的 Host 一半；`packages/client/ui-effectiveness` 尚不存在，因此表现层由消费者拥有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。控制器不拥有持久状态，也没有自己的、可由独立观测产生分歧的关系；它校验一个请求、映射一份查询答案，并对调用方唯一能据以行动的那一种失败分类，而其测试规范钉住上述每一项行为。
