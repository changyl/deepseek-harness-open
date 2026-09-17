---
description: "人类可用的 /effectiveness 命令：按路由渲染跨会话的结果信号——反馈、改动决定与验证——不消耗模型轮次。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-effectiveness

[English](README.md) | 中文

## 概述

挂载本包，给人一个 `/effectiveness` 命令，在不消耗模型轮次的前提下报告会话语料所反映的结果。`/effectiveness` 默认显示全部时间，并接受 `24h`、`7d`、`30d` 窗口以及 `provider/model` 路由。渲染出的文本携带会话数、带信号的轮次数、含分类计数的反馈行、改动决定行、验证行，以及每个路由一行。它需要一个挂载了命令适配器与 `ctx.effectiveness` 查询服务的交互式部署。

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

在已经挂载了 effectiveness 查询与命令适配器的交互式部署中挂载它；`/effectiveness` 在 UI 命令面运行，绝不消耗模型轮次。`dsh-base` 组合同时挂载本包与 `@deepseek-ai/dsh-effectiveness-query`，因此每个已发布组合都提供该命令。

### Composition

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence'
- name: '@deepseek-ai/dsh-session-query'
- name: '@deepseek-ai/dsh-effectiveness-query'
- name: '@deepseek-ai/dsh-command-effectiveness'
```

没有命令适配器的部署不会暴露 `/effectiveness`，因此 headless 与自动化应用不需要本包。注册命令是挂载 fiber 上的 effect，卸载插件即移除命令。缺少 `ctx.effectiveness` 时 fiber 保持 pending，不会注册任何命令。

### 命令语法

| 输入 | 结果 |
|---|---|
| `/effectiveness` | 全部时间、所有路由 |
| `/effectiveness all` | 与裸 `/effectiveness` 相同 |
| `/effectiveness 24h` | 事件落在最近 24 小时内的会话 |
| `/effectiveness 7d` / `/effectiveness 30d` | 最近 7 或 30 天 |
| `/effectiveness <provider>/<model>` | 全部时间、单个路由 |
| `/effectiveness 30d <provider>/<model>` | 同时指定窗口与路由，顺序不限 |

命令自带的用法行声明 `24h`、`7d`、`30d` 与 `all`；解析器接受任何正的 `<n>h` 或 `<n>d`。写在窗口之前的 `all` 是无操作；指定第二个窗口（`7d 8d`、`7d all`）或第二条路由会被拒绝；`0h` 作为不可能的窗口被拒绝。未知 token 在任何查询发生之前即被拒绝。

### 报告内容

| 输出 | 内容 |
|---|---|
| 标题 | `Effectiveness (all time)`；带窗口时为 `Effectiveness (last <n>, since <ISO timestamp>)`；选定路由时追加 ` · <provider>/<model>` |
| 会话 | 会话数，以及至少带一个信号的轮次数 |
| 反馈 | 当前的正/负评价，以及分类计数——没有任何评价归入某分类时显示 `none` |
| 改动 | 改动评审决定：accepted、reverted、undecided |
| 验证 | 任务报告结果：passed、failed、unknown |
| 路由 | 每个路由一行（缩进）：会话数、反馈、改动决定、验证、带信号的轮次 |
| 截断 | 当查询限制了逐会话行数时显示 `(Session rows were truncated; totals cover the whole selection.)`；总计与路由行仍覆盖全部选择范围 |

没有任何被观测会话的选择会在标题下渲染 `No session signal recorded for this selection.`，且没有任何路由贡献时省略 `Routes:` 区块。

### 失败与恢复

不可用的参数返回携带用法行的错误结果，且绝不查询服务，因此一个笔误不会付出语料读取的代价。命令本身没有其他失败模式：查询服务对空语料回答零计数，而没有该服务的组合根本不会注册这个命令。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本节解释命令背后的形态；可观测行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计概念

该命令是一层薄适配：解析自己的参数语法、向 `ctx.effectiveness.query()` 索取所选语料、把报告渲染为文本。它不持有状态、不缓存、也不自行计算任何数字，因此读者看到的数值正是查询服务所提供的——与按会话投影相同的"信号""被重新决定的改动""未决定的已应用改动"的定义。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 参数解析、文本渲染与命令注册 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。

- [Effectiveness 查询包](../effectiveness-query/README.zh.md)——拥有这些数字与语料读取的服务。
- [Effectiveness 投影包](../effectiveness/README.zh.md)——查询所复用的按会话折叠单元。
- [反馈子系统](../../../docs/subsystems/feedback.zh.md)——报告所统计的反馈事件。
- [命令子系统](../../../docs/subsystems/commands.zh.md)——接纳调用并记录其生命周期的注册表。

-----

<a id="model-experience"></a>
## 模型体验

### 人类 `/effectiveness` 命令

#### 模型看到什么

什么都没有。该命令在 `ctx.commands` 中注册人类处理器并返回直接命令结果；注册表仅日志的 `command/run` 与 `command/done` 生命周期事件是它产生的唯一记录，调用、报告或错误文本的任何部分都不会进入模型请求。

#### Token 影响

零：报告由会话日志本就承载的结果信号渲染而成，不组装也不发送任何模型请求。

#### KV Cache 影响

无：该命令从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了报告能说什么、以及它如何到达读者。它们是当前包约束，不是任务清单。

- **纯文本，除参数外没有分页或过滤** —— 整份报告一次渲染，没有交互面、没有按天拆分、也没有成本行。
- **路由行之和可能高于总计** —— 使用多个路由的会话会把自己的整份投影贡献给其中每一行，因为报告没有按轮次的路由归属。
- **窗口是会话粒度的** —— `24h`、`7d`、`30d` 按事件跨度整体选择会话，因此被选中的会话可能有一部分落在窗口之外。
- **报告的新鲜度取决于它所读的日志** —— 查询服务不缓存，因此每次调用都会重读所选语料，语料很大时命令会明显变慢。
- **命令只存在于组合了查询服务的地方** —— 没有 `ctx.effectiveness` 的组合根本不会提供 `/effectiveness`，而不是提供空报告。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随包。该包拥有一个参数解析器与一个文本渲染器，二者都是其输入的全函数，并且它从 `ctx.effectiveness.query()` 读取每一个数字，而不自行计算。它所依赖的关系——每次查询一份报告、路由行由会话行派生、每次调用一对 `command/run`/`command/done`——由查询服务与命令注册表拥有并在运行时检查，而不是在这里。
