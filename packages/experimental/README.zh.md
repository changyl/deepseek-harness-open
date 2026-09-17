---
description: "实验组地图：默认私有的预稳定原型。"
kind: "package-group"
---

# packages/experimental

[English](README.md) | 中文

## 概述

实验组包含约定可能变更且不提供支持承诺的原型能力。本组的每个包都使用 `@deepseek-ai/dsh-experimental-*` npm 前缀，并且默认私有。本组包含私有的跨 realm Inspector、CPython 子进程后端与浏览器 worker 预览包。组外已发布产品不得依赖实验性包。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`code-runtime-python`](code-runtime-python/README.zh.md) | 代码执行 seam 的 CPython 子进程后端 | `ctx.codeRuntime` |
| [`inspector`](inspector/README.zh.md) | 用于 Host 调试、Client Runtime 检查、网络采集与 Cordis 树的跨 realm CDP hub | `ctx.inspector` |
| [`webworker-packer`](webworker-packer/README.zh.md) | 构建浏览器 worker 预览所消费的 gzip 压缩虚拟文件系统（VFS）镜像 | 库与 CLI（命令行界面），不使用 ctx key |
| [`webworker-runtime`](webworker-runtime/README.zh.md) | 在专用浏览器 worker 中运行 harness 插件树 | 库与 worker 入口，不使用 ctx key |

-----

<a id="related-documentation"></a>
## 相关文档

- [实验包决策](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)——已废止的决策：它曾把 Agent Teams 包从本组公开发布；这些包现在是产品角色组中的正式发布成员。
- [Agent Teams 子系统](../../docs/subsystems/agent-team.zh.md)——持久 Team 类型与 `ctx.agentTeams` 服务 API。
- [实验子树规则](AGENTS.md)——实验状态放宽了什么、不放宽什么。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
