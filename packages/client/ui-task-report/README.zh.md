---
description: "回合尾部任务报告卡片：渲染宿主从已结束轮次折叠出的变更摘要与验证记录，并提供打开其 Markdown 的入口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-task-report

[English](README.md) | 中文

## 概述

本包在聊天视图的回合尾部渲染已完成轮次的任务报告：一行紧凑内容说明改动了多少文件、新增与删除的行数合计，以及多少条验证命令通过、失败或未报告结果，外加打开所写 Markdown 的控件。这些事实来自宿主插件记录的持久化 `task-report/generated` 事件，因此刷新或翻页历史都会重建同一行。卡片只做呈现：它不从工作区计算任何内容，也不向模型所见添加任何内容。

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

把本插件与 `ui-deliverables`、`ui-chat` 一起挂载；此后每个记录了任务报告的回合都会在操作行上方显示该行。它会先给出报告标题，再给出报告携带的事实：改动文件数、行数合计与验证统计。末尾的控件会像产出文件 chip 一样，在会话自己的查看器中打开报告文件。

报告未被写出的回合会显示拒绝原因而不是控件，因此 `read-only` 会话仍会说明缘由，而不是渲染一个无效按钮。没有报告的回合什么都不渲染：卡片会读取该回合的报告数据，数据缺失时不渲染，尾部保持为空。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

一个仅含状态的 `ConversationNodeDefinition` 把 `task-report/generated` 折叠为按轮次的 `taskReport` 值：`turn/start` 开启 Context，报告事件替换该值，`buildLocationData` 仅在 payload 身份变化时重新发布。卡片是回合尾部列表中的一个条目，它从所渲染的回合中读取该值，并从 props 获得宿主的文件打开器；两个读取器都位于插件内。

卡片没有状态，也不访问服务。它渲染标题、它能陈述的事实，以及打开控件或拒绝原因行二者之一；既无改动也无验证的报告只渲染标题与控件。所有文案都在 `taskReport` locale 命名空间中，因此语言切换会通过框架的 locale revision 重新渲染。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-task-report](../../session/task-report/README.zh.md)——折叠每个已结束轮次并记录本卡片所渲染事件的宿主插件。
- [ui-deliverables](../ui-deliverables/README.zh.md)——面向产出文件与改动的兄弟回合尾部条目。
- [ui-chat](../ui-chat/README.zh.md)——声明本卡片所占用的列表坑位 `conversation.chat.turnTail`。
- [Slots 参考](../../../docs/subsystems/slots.zh.md)——坑位种类、作用域，以及注册方获得的 props 份额。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包为人类渲染已记录的报告，不添加自己的提示词段落、工具 schema、工具结果或模型请求。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

以下限制界定了当前这一行。

- **该行是只读的**——它陈述宿主记录的内容。没有重新运行的控件；重新生成是在输入框中使用 `/report`，也就是宿主侧命令已经所在的位置。
- **没有逐文件细节**——该行只携带计数与合计。改动文件列表属于 `ui-deliverables`；想查看 hunk 的读者在那里打开文件，或阅读报告文档。
- **报告通过会话文件打开器打开**——若报告被写到会话工作区之外（宿主目前从不这样做），本卡片将没有可解析的地址。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：**不发布配套文件。本包不拥有任何跨插件可变状态；其注册——字典、按轮次的折叠与回合尾部条目——通过 HMR 安全测试证明可释放。
