---
description: "project 组地图：每个工作目录一份由项目与任务构成的持久看板，以及拥有它的存储与面向模型的工具，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/project

[English](README.md) | 中文

## 概述

project 组保存比单个 agent（智能体）会话活得更久的工作。`project` 拥有持久看板——每个项目一条记录，内含其任务、比较并交换修订号，以及决定什么可以开始的依赖规则——`tool-project` 是列出、创建、读取并修改它的面向模型适配器，`command-project` 则通过 `/project` 为人们渲染同一块看板，且不消耗模型轮次。看板由同一工作目录下的每个会话共享，且三个包都是宿主侧的：存储本身不触及模型，工具只通过其有界结果触及模型，命令则完全不到达模型。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`project`](project/README.zh.md) | 持久项目与任务：比较并交换修订、依赖规则与状态校验 | `ctx.projects` |
| [`tool-project`](tool-project/README.zh.md) | 模型工具 `project`，含 `list`、`create`、`read`、`add_task`、`update_task`、`link_session` | 注册到 `ctx.tools` |
| [`project-context`](project-context/README.zh.md) | 每次看板状态变化向模型报告本会话关联的任务 | 监听 `agent/pre-step` |
| [`command-project`](command-project/README.zh.md) | 人工 `/project` 命令：列出本目录的项目并渲染某一块看板，只读 | 注册到 `ctx.commands` |

-----

<a id="related-documentation"></a>
## 相关文档

- [项目子系统](../../docs/subsystems/project.zh.md)——权威契约：记录形状、视图、错误码与生成的 `ctx.projects` API。
- [存储子系统](../../docs/subsystems/storage.zh.md)——存储在配置后端之上打开的领域数据形式。
- [生成的工具目录](../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-project)——模型收到的 `project` 工具 schema。
- [生成的配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-project)——该存储受支持的配置及其默认值。
- [持久项目看板 Agent Note](../../.agents/notes/implemented/feature/2026-09-16-durable-project-board.zh.md)——为什么项目工作是一个独立的持久领域，而不是持久化的 `todo_write`。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
