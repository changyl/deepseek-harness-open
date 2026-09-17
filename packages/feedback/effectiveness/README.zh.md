---
description: "单个会话的成效信号——当前消息反馈、变更评审决定与任务报告验证——以客户端可见的 effectiveness 投影提供。"
kind: "package-reference"
---

# @deepseek-ai/dsh-effectiveness

[English](README.md) | 中文

## 概述

本包把单个会话的成效信号作为客户端可见的 `effectiveness` 投影提供：assistant 消息上的当前人工反馈、读者对已应用文件变更的决定，以及任务报告中的验证结果。客户端读取一份成品值，而不必自行折叠日志。这些计数描述会话内发生了什么，而不是模型质量评分；没有信号的会话报告零个带信号轮次，而不是零比率。在客户端展示会话成效的地方挂载它。

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

把该单元挂在会话投影注册表，以及追加它所折叠信号的各包旁。单元自身只需要注册表。

### 组合

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-message-feedback'
- name: '@deepseek-ai/dsh-change-review'
- name: '@deepseek-ai/dsh-task-report'
- name: '@deepseek-ai/dsh-effectiveness'
```

各生产者对单元加载是可选的：缺少它们时日志只是不携带这类信号，所有计数保持为零。没有投影注册表时 fiber 保持挂起，不注册任何内容。

### 值包含什么

| 字段 | 含义 |
|---|---|
| `feedback.positive` / `feedback.negative` | 人工当前分别评为两类的消息；被重新评分的消息只按最新评分计一次 |
| `feedback.byCategory` | 当前归入各类别的判断；没有任何判断命名的类别缺失 |
| `changes.accepted` / `changes.reverted` | 当前决定为接受或回退的已应用变更；被两次决定的变更只按最新决定计一次 |
| `changes.undecided` | 没有记录决定的已应用变更 |
| `verification.passed` / `failed` / `unknown` | 任务报告记录的验证命令，跨会话中每份报告累加 |
| `turnsWithSignal` | 携带至少一个信号的不同轮次 |

当反馈命名了该轮产生的消息、变更决定属于该轮，或该轮的任务报告记录了验证结果时，该轮计为携带信号。

### 计数来自哪里

该单元只折叠其他包已经追加的事件。`assistant/message` 提供消息到轮次的对应关系，让评分能够命名其轮次。`feedback/message-put` 与 `feedback/message-delete` 维护每条消息的当前评分。`change/review` 记录决定，而经 `recordedHunks` 读取的 `tool/result` 变更块记录一条已应用变更，键为结果的 seq 与该块的路径；`undecided` 是未被任何决定作为键的已应用变更。`task-report/generated` 把其验证结果加入会话总计。该单元不添加任何提示词、工具或事件。

### 零意味着没有数据

每个计数都是当前值，且都是会话成效计数，而不是模型质量评分。尚不携带信号的会话在各处都报告零，因此消费者必须先读取 `turnsWithSignal` 再呈现比率：零意味着数据不足，而不是零比率。日志从未产生的消息上的评分会计入评分合计，但不会凭空造出轮次，因为日志中没有把该消息与轮次关联起来的 `assistant/message`。

### 失败与恢复

没有投影注册表时该单元是惰性的：`inject` 使 fiber 保持挂起，不注册任何内容，因此其他装配不提供 `effectiveness` 键。卸载插件会移除该键，因为注册是挂载 fiber 上的 effect。客户端通过投影 seam 的快照与变更流渲染该值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该值背后的折叠；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该单元是对已提交会话事件的纯折叠，每个生产者各有一条替换规则。反馈事件携带某条消息完整的当前判断，因此最新事件获胜，删除则移除该条目；以变更为键的决定只保留最新值；报告中的验证条目累加进运行总计，因为每份报告观察的是自己那次运行。评分计数与轮次计数被有意分开：评分合计统计当前判断，而 `turnsWithSignal` 只统计日志能够命名的轮次，这正是未知消息上的评分只改变前者而不改变后者的原因。折叠状态是纯 JSON，因此投影缓存可以持久化它。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`inject`、在挂载 fiber 上注册单元 |
| [`src/projection.ts`](src/projection.ts) | 折叠：状态形状与 schema、逐事件转换、wire 视图 |
| [`src/types.ts`](src/types.ts) | `effectiveness` 投影键声明与字段类型的唯一归属 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当单元契约不够用时阅读以下页面。它们从驱动单元的注册表进入它所折叠事件的生产者。

- [会话投影子系统](../../../docs/subsystems/session-projection.zh.md)——驱动单元并提供快照与变更流值的注册表。
- [会话投影注册表包](../../session/session-projection/README.zh.md)——单元注册所依据的注册表约定。
- [消息反馈包](../message-feedback/README.zh.md)——反馈计数所折叠的评分、类别与备注。
- [反馈子系统](../../../docs/subsystems/feedback.zh.md)——消息反馈类型与服务契约。
- [任务报告包](../../session/task-report/README.zh.md)——计数所累加其验证结果的报告。
- [反馈包映射](../README.zh.md)——本组各包及其仓库位置。

-----

<a id="model-experience"></a>
## 模型体验

### 会话成效读模型

#### 模型看到的内容

无。该单元把其他包已经追加的事件折叠为 `effectiveness` 投影，自身不注册任何工具、提示词片段或会话事件。

#### Token 影响

零：该值在事后从已写入日志的事件推导，因此不会给任何请求增加 token。

#### KV Cache 影响

无：本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明计数描述什么、值在何处存在。它们是当前包约束，而非任务清单。

- **尚无跨会话或按模型的聚合**——该值只覆盖单个会话；跨会话或按模型聚合的查询服务尚在延期。
- **没有匹配 `assistant/message` 的评分无法命名其轮次**——这类评分计入评分合计，但不向 `turnsWithSignal` 增加轮次，因为日志中没有它的消息到轮次关联。
- **验证计数按报告而非按命令**——每份任务报告都加入自己的结果，因此同一条命令出现在两份报告中就计两次。
- **仅在挂载它的组合中可见**——`dsh-web-app` bundle 注册该单元；`dsh-base` 不注册，因此未挂载的组合不提供 `effectiveness` 键。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只拥有一个纯投影折叠区，其 wire payload 在每次快照和变更流发射时都由投影注册表进行 schema 校验。该折叠区依赖的关系（每个消息 id 恰有一条携带其所属轮次的 `assistant/message`、反馈事件携带某条消息完整的当前判断、`change/review` payload 携带作为变更键的结果 seq 与路径，以及任务报告携带自己的验证结果）由 dsh-session、dsh-message-feedback、dsh-change-review 与 dsh-task-report 拥有并在运行时检查，而不由本包拥有。
