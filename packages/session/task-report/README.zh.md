---
description: "任务结束报告：把每个已结束轮次自身的日志窗口折叠为 Markdown 变更摘要与验证记录，并写入会话工作区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-report

[English](README.md) | 中文

## 概述

当轮次结束时，本插件把该轮次自身的日志窗口折叠为一份 Markdown 任务报告：它回答了哪个请求、改动了哪些文件、运行了哪些验证命令及其结果，以及该轮次的收尾文本。它会把文档写入会话工作区，并记录一条持久化的 `task-report/generated` 事件，Web 客户端据此在回合尾部渲染一张卡片。整项工作既不由模型撰写，也不对模型可见：报告完全派生自该轮次已经写入的日志，不改变任何提示词、请求或工具 schema。

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

在某个 profile 中挂载本插件后，每个记录了文件改动或运行了匹配的验证命令的已结束轮次都会产出一份报告。默认配置会把 `.dsh/reports/turn-<n>.md` 写到会话工作目录之下；目录与验证模式都是部署设置：

```yaml
- name: '@deepseek-ai/dsh-task-report'
  config:
    directory: .dsh/reports
    verifyPatterns: [test, vitest, typecheck, lint]
```

一份报告会写明轮次编号及其结束方式、开启该轮次的用户请求、收尾的 assistant 文本、带新增与删除行数的改动文件表，以及带解析结果的验证命令表。

### 什么时候会产出报告

当某个轮次至少记录了一处已应用的改动（`write` 与 `edit` 附加到其结果上的 hunk），或至少运行了一条匹配配置模式的 shell 命令时，它就会产出报告。仅仅对话的轮次不记录任何内容——没有文件也没有事件——因此纯聊天会话不会留下痕迹。`read-only` 会话记录的是拒绝原因而不是路径，事件会说明原因。

### 重新生成

`/report` 会重新折叠该会话最新的已结束轮次并重写该轮次的文档，即使该轮次没有记录任何内容。命令以写入路径结算，或在写入不被允许时以拒绝原因结算。重新生成会为同一轮次追加另一条 `task-report/generated` 事件；文件与卡片都呈现最新的一条。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

插件监听会话事件流，并对 `turn/end` 作出反应，因此报告描述的始终是已提交的轮次，而不是进行中的轮次。生成是即发即忘的：失败只会被记录，绝不打扰会话。该轮次的证据来自 `ctx.sessionQuery.readSession()`，其事件列表会被切到该轮次 `turn/start` 与 `turn/end` 之间的窗口；`inheritedEventCount` 之前的事件属于 fork 初始内容并被排除，因此 fork 出来的会话绝不会报告父级的轮次。

折叠是纯函数。请求是该轮次第一条来源为用户的消息，收尾文本是最后一条非空 assistant 消息，两者都会被裁剪并设上限。改动来自该轮次 `tool/result` 事件上的 `meta.diffs`——即第一方 `write` 与 `edit` 工具记录的 hunk——按路径去重并保持首次出现顺序，`create` 由缺失的前一文本推导，行数取自两侧。验证来自命令匹配配置模式的 `bash` 工具调用，按调用 id 与报告结果的那条结果配对；结果读取自 shell 渲染时使用的同一批标记（`[exit code: N]`、超时、信号），在没有标记时读取结果的错误标志。

写入发生在记录之前：先渲染文档，按 `session.header.cwd` 解析，并通过 `ctx.fs.writeText` 连同会话的沙箱策略写入，因此 `read-only` 会话会拦截这次写入。此后插件才追加 `task-report/generated`，其 payload 携带结果——路径或拒绝原因、请求、摘要、改动与验证。该事件仅记日志，默认上限为 50 个改动文件与 20 条验证命令。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当问题不在报告自身行为时，阅读这些页面。

- [tool-present](../../fs/tool-present/README.zh.md)——模型拥有的交付声明，其 `write`/`edit` 结果为本插件提供改动证据。
- [change-review](../../fs/change-review/README.zh.md)——读者针对同一批改动记录接受／回滚决定的地方。
- [session-query](../../session-query/session-query/README.zh.md)——本插件所折叠的日志读取器。
- [ui-task-report](../../client/ui-task-report/README.zh.md)——在回合尾部渲染所记录报告的 Web 卡片。
- [任务结束报告 Agent Note](../../../.agents/notes/implemented/feature/2026-09-14-turn-end-task-report.zh.md)——为什么报告是确定性的、写在哪里，以及它有意省略了什么。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包在每个轮次结束后折叠会话日志并记录一条仅记日志的报告事件，不添加自己的提示词段落、工具 schema、工具结果或模型请求。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制界定了当前的报告。它们是该机制当前的约束，而不是待办清单。

- **只有 `write` 与 `edit` 产生改动证据**——由 shell 命令、代码执行分发或其他工具创建的文件没有记录的 hunk，因此即使该轮次改动了它，它也绝不会出现在报告里。权威的工作区 diff 必须来自 git，而本插件并不查询 git。
- **验证结果是被解析的，而不是结构化的**——shell 能力把 stdout、stderr 与退出状态渲染成一个面向模型的文本块，因此本插件读取的是与人相同的标记。输出中没有该标记的命令报告 `unknown`，而不是猜测；被截断的 spill 会隐藏标记本应说明的内容。
- **每个轮次一份报告，以轮次编号为键**——重新生成会原地覆盖 `turn-<n>.md`，之前的文档不会归档。因此共享同一工作目录的两个会话会在文件名上相互竞争。
- **报告不是交付物**——`present` 是模型拥有的声明，因此本插件写出文件并记录事件，却不把它加入会话的已提交文件行。未来若希望报告出现在那里，必须先决定该声明的归属。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：**不发布配套文件。本包不拥有任何跨插件可变状态；其两处注册——`session/event` 监听器与 `/report` 命令——通过真实组合测试套件证明可释放，该套件会启动随包交付的 YAML 形态并将其卸载。
