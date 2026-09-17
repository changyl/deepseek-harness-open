---
description: "One request-context message telling the model which applied file changes the reader accepted or reverted, for users and maintainers of the change-review loop."
kind: "package-reference"
---

# @deepseek-ai/dsh-change-review-context

[English](README.md) | 中文

## 概述

`dsh-change-review-context` 把读者对已应用改动做出的决定告诉模型。回滚发生在轮次之间，没有这条说明，模型会继续基于它的改动已不再产生的内容进行推理。这些决定是由 [`dsh-change-review`](../../fs/change-review/README.zh.md) 记录的持久化 `change/review` 事件；本插件把它自己上次发言之后记录的决定渲染成一条请求消息，因此每个决定只上报一次，刷新或 fork 都能重建同样的说明。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在任何读者可以决定改动的组合里，把它与 `dsh-change-review` 一起挂载；正式提供的 `dsh-web-app` bundle 两者都挂载。它不需要配置，不增加提示词段、不增加工具，并且在没有未上报决定时不注入任何内容。

说明按从旧到新的顺序列出每个改动及其决定，最多列十二条，超出部分以余数行收尾。同一个改动被决定两次时只上报一次，取其最后一次决定。

<a id="understand-the-implementation"></a>
## 理解实现

本插件注册一个 `agent/pre-step` 监听器。在该步骤自身的决定落定之后，它从会话日志尾部向前收集 `change/review` 事件，遇到本插件自己发出的最后一条消息即停止——这正是每个决定只上报一次的原因——遇到 `session/end-seed` 边界同样停止，从而避免 fork 重复上报父会话的评审。用户手工输入的消息不会终止该窗口，因此读者先回滚再输入时，仍能在同一条说明里到达模型。

注入的消息携带 `source.kind === 'plugin'` 与本插件名，与 `dsh-time-context` 的形状一致，因此回扫能识别自己的输出。

<a id="model-experience"></a>
## 模型体验

### 读者决定

#### 模型看到什么

向请求追加一条 user 角色消息；当所有决定都已上报时什么都不追加：

##### 评审说明

```markdown
The user reviewed file changes you applied:
- Reverted: `src/app.ts` (turn 4) — the file is back to its content from before that change; re-read it before editing it again.
- Kept: `src/util.ts` (turn 4).
```

#### Token 影响

每批决定一条短消息；超过十二条的批次以余数行收尾，而不会无界增长。

#### KV Cache 影响

只追加；该说明接在可复用请求前缀之后加入请求历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只上报，不强制**——说明告诉模型文件已回退；真正让过期编辑失败的是文件系统观察策略。
- **没有按轮次摘要**——说明逐条列出改动，不总结一轮中有多少内容通过了评审。
- **被拒绝不等于给出修正**——模型只会知道文件现在的内容，不会被告知应当改成什么。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。该包不拥有任何可由独立观测产生分歧的、可在运行时检查的关系；它的契约就是其导出的类型与它所记录的 Session 事件，并由其测试规范钉住。
