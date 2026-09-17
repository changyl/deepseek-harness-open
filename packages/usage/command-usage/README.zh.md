---
description: "人类 /usage 命令：跨会话的 token 合计、按路由行与读取时成本，在界面中渲染且不消耗模型轮次。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-usage

[English](README.md) | 中文

## 概述

挂载本包即可为人们提供 `/usage` 命令，在不消耗模型轮次的情况下报告跨会话的 token 合计与成本。`/usage` 默认显示全部时间，并接受 `24h`、`7d` 或 `30d` 时间窗以及 `provider/model` 路由。渲染出的文本携带会话、轮次与步骤计数、四个 token 桶、一行成本，以及每个路由一行。当所选范围内没有任何路由被定价时，成本显示为不可用；当只有部分路由被定价时，显示为不完整。它需要有命令适配器的交互式部署。

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

在已经挂载用量服务与命令适配器的交互式部署中挂载它；`/usage` 在界面命令平面中运行，从不消耗模型轮次。

### 组合

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
- name: '@deepseek-ai/dsh-command-usage'
```

没有命令适配器的部署不会呈现 `/usage`，因此无头与自动化应用不需要本包。注册命令是挂载 fiber 上的 effect，卸载插件即移除它。

### 命令语法

| 输入 | 结果 |
|---|---|
| `/usage` | 全部时间，所有路由 |
| `/usage all` | 与裸 `/usage` 相同 |
| `/usage 24h` | 最近 24 小时 |
| `/usage 7d` / `/usage 30d` | 最近 7 天或 30 天 |
| `/usage <provider>/<model>` | 全部时间，单个路由 |
| `/usage 30d <provider>/<model>` | 时间窗与路由同时给出，顺序任意 |

命令自身的用法行只宣传 `24h`、`7d`、`30d` 与 `all`；解析器接受任何正的 `<n>h` 或 `<n>d`。

### 报告显示什么

| 输出 | 内容 |
|---|---|
| 标题 | `Usage (all time)`，时间窗则为 `Usage (last <n>, since <ISO 时间戳>)`；选中路由时追加 ` · <provider>/<model>` |
| 计数 | 会话、轮次与步骤；任一步未上报用量样本时附加 `steps without usage` |
| Token | 四个桶：input、output、cache read 与 cache write |
| 成本 | 金额，或下面的不可用与不完整措辞 |
| 路由 | 每个路由一行，含其会话、步骤与桶数字，随后是自身金额或 `unpriced` |

所选范围未观察到任何内容时，只渲染标题与 `No usage recorded for this selection.`。计数带千位分隔符。

### 成本措辞

- 所选范围内没有任何路由被定价时，该行是 `Cost: unavailable — no route in this selection is priced.`——金额为不可用，绝不为零。
- 每个贡献路由都被定价时，该行是 `Cost: <currency> <amount> (pricing <version>)`。
- 只有部分路由被定价时，同一行附加后缀 ` (incomplete — unpriced routes: <provider>/<model>, …)`。

金额以完整微单位精度打印：六位小数并去掉末尾零，因此一微单位仍然可见，整数金额也不带填充。

### 失败与恢复

未知、重复或非正的参数会被拒绝，并给出问题 token 与用法行，且不查询提供方。未挂载用量提供方的组合回答 `Usage statistics are unavailable in this composition: no usage provider is registered.` 其他任何提供方失败都会向上传播，使适配器报告命令失败，而不是给出一份看似合理的报告。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释文本如何生成；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包只拥有两样东西：一个解析器与一个渲染器。解析器把原始调用转换为至多一个时间窗与至多一个路由，并在任何查询运行前拒绝重复或无法识别的 token；渲染器把一份 `UsageReport` 转成上文的固定行式布局。每个数字都来自 `ctx.usage.query(filter)`，因此命令自身不携带记账逻辑，也不会与读取同一份报告的客户端产生分歧。时间窗由当前时钟换算为闭下界 `from`；路由转换为 `provider` 与 `model` 过滤字段。`UsageUnavailableError` 被翻译成一条直接错误消息，其他任何失败都会重新抛出，使分发层报告命令失败。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：参数语法、时间窗与路由解析、报告渲染、命令处理函数 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当渲染文本不够用时阅读以下页面。

- [用量子系统](../../../docs/subsystems/usage.zh.md)——每个打印数字背后的报告、定价与提供方契约。
- [用量服务包](../usage/README.zh.md)——命令所查询的服务。
- [用量账本包](../usage-ledger/README.zh.md)——提供本命令所聚合语料的持久提供方。
- [用量定价包](../usage-pricing/README.zh.md)——决定是否打印成本行的费率卡。
- [人类命令服务](../../interaction/commands/README.zh.md)——命令注册进的注册表及其追加的生命周期事件。
- [用量包映射](../README.zh.md)——本族各包及其仓库位置。

-----

<a id="model-experience"></a>
## 模型体验

### 人类 `/usage` 命令

#### 模型看到的内容

无。命令在 `ctx.commands` 中注册人类处理函数并返回直接的命令结果；注册表的 `command/run` 与 `command/done` 仅写入日志的生命周期事件是它产生的唯一记录，调用、报告或错误文本的任何部分都不进入模型请求。

#### Token 影响

零：报告从已存用量事实渲染，不组装也不发送模型请求。

#### KV Cache 影响

无：命令从不触碰请求前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明命令报告什么、可以如何使用。它们是当前包约束，而非任务清单。

- **它跨账本持有的所有会话聚合**——本命令没有按会话的视图；路由或时间窗会收窄语料，但数字始终跨会话。
- **它只渲染文本**——结果是固定的多行字符串，任何适配器中都没有交互式表格、分页或图表。
- **它每次调用都重新读取语料**——每次 `/usage` 都运行一次新查询，因此重复调用会重新折叠持久化修订号已变化的会话。
- **时间窗选择整个会话**——`from` 下界会丢弃事件全部早于它的会话，但与窗口重叠的会话仍贡献其全部 token。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包拥有一个参数解析器与一个文本渲染器，二者都是入参的全函数，并且它从 `ctx.usage.query()` 读取每个数字而非自行计算。它所依赖的关系——每次查询一份报告、已定价与未定价路由互不重叠、每次调用一对 `command/run`/`command/done`——由用量服务与命令注册表拥有并在运行时检查，而不由本包拥有。
