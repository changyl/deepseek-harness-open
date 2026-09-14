---
description: "本地文件系统 agent 定义提供方，供编写 Markdown 定义或配置扫描哪些项目、自定义与用户定义根目录的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-definitions-filesystem

[English](README.md) | 中文

## 概述

agent（智能体）可以委派给由磁盘上的 Markdown 文件描述的专用子 agent：在某个被扫描的根目录下编写 `<name>.md`，委派工具即可按名称选择它。该提供方发现项目、自定义与用户根目录，把每个文件的 YAML frontmatter 解析为目录条目，并在被选中时加载 persona 正文。当定义存放在仓库或用户的 agent 配置中时选择它；注册表（`dsh-agent-definitions`）接受任意提供方，而由于本包不安装监视器，变更要到下一次读取才会出现。

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

挂载该插件即可让本地文件系统中的定义对 agent 定义注册表可用。它扫描下方根目录，把每个文件的 frontmatter 解析为目录条目，并在定义被选中时加载 persona 正文。

### 何时选择

当定义存放在磁盘上——仓库、自定义目录或用户的 agent 配置中——时，使用此提供方。当定义来自远程服务或嵌入式插件数据时，请避免使用：注册表接受任意提供方，本包只是其中一种实现。

### 定义格式

定义是被扫描根目录顶层的平铺 `<name>.md` 文件。文件以 `---` 行之间的 YAML frontmatter 开头，闭合 `---` 之后的所有内容即 persona 正文。

| 字段 | 必填 | 含义 |
|---|---|---|
| `name` | 是 | kebab-case 定义名称 |
| `description` | 是 | 供发现消费方展示的简短路由描述 |
| `tools` | 否 | 子 agent 可调用的工具名，可为列表或逗号分隔字符串 |
| `model` | 否 | 请求的子 agent 模型 |
| `reasoning_effort` | 否 | 请求的子 agent 推理强度 |
| `max_depth` | 否 | 非负整数的委派深度上限 |

未知的 frontmatter 键会让整个文件随警告被拒绝，而不是被忽略，因为被静默丢弃的 `tools` 会让子 agent 以完整的继承工具集运行。同一条警告路径还覆盖：缺少 frontmatter 块、YAML 无效、`name` 缺失或不是 kebab-case、`description` 缺失、正文为空、`tools` 既不是列表也不是字符串、`tools` 列表为空、工具名不是非空字符串，以及 `max_depth` 不是非负整数。

### 根目录与优先级

默认根按该提供方的 rank 顺序扫描：

| Rank | 来源 | 路径 |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/agents` |
| 200 | `project-agents` | `<projectRoot>/.agents/agents` |
| 300 | `custom` | `Config.customAgentDirs` |
| 400 | `user-dsh` | `<dshHome>/agents` |
| 500 | `user-agents` | `<agentsHome>/agents` |

项目根目录是包含 `.git` 的最近祖先目录；如果不存在，则使用本次查找的 cwd，且只有在提供 cwd 时才会扫描项目根。`includeDefaultRoots: false` 会移除项目根与用户根两行，使隔离提供方只看到自身配置的 `customAgentDirs`。在同一个注册表层内，较小的 rank 在重名时胜出。

### 挂载与配置

与注册表一起加载该插件；它需要 `ctx.agentDefinitions`。

```yaml
- name: '@deepseek-ai/dsh-agent-definitions'
- name: '@deepseek-ai/dsh-agent-definitions-filesystem'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `filesystem` | 注册到 `ctx.agentDefinitions` 的唯一提供方名称 |
| `includeDefaultRoots` | `true` | 在 `customAgentDirs` 周围包含项目根与用户根 |
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | Harness 配置根目录；扫描其 `agents` 子目录 |
| `agentsHome` | `$DSH_AGENTS_HOME` 或 `~/.agents` | 共享 agent 配置根目录；扫描其 `agents` 子目录 |
| `customAgentDirs` | `[]` | 其他定义根目录，位于项目根之后、用户根之前 |

[`src/index.ts`](src/index.ts) 中的 `Config` 接口连同其 JSDoc 声明了这些字段。

### 可观察的成功与失败

任一被扫描根目录下的有效定义都会按名称排序出现在合并目录中，选中它即可加载当前文件正文。不存在的根目录属于有效空状态；无法列举的根目录，或无法读取的文件，会被记录并使观测变为不完整，因此消费方会保留最后一份可用目录，而不会把一次瞬时失败呈现为删除。在发现与选中之间消失的定义不会返回任何定义，也不会返回陈旧正文。

### 文件系统访问

当存在文件系统服务时，该提供方通过 `ctx.fs` 读取，优先使用其 `resolve()`、`readText()` 与 `stat()`，而非直接使用 Node I/O；没有该服务时回退到 Node 的 `readFile` 与 `realpath`。调用方的中止信号会取消读取，报告为不存在的路径被视为有效空状态，而不是失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释根目录、发现与加载如何组织；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

该提供方建立在一项职责分离之上：发现阶段把文件转为摘要，而每次加载都重新读取文件，因此正文编辑无需 hash、修订号或缓存失效。根目录按每次查找计算，因为项目根取决于调用方的 cwd。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口、提供方、根解析、frontmatter 解析、定义加载 |
| — | 不发布运行时不变式伴生入口；该提供方只把文件映射为注册表候选项，除它所满足的注册表约定外，不暴露独立事件序列或可变数据关系。 |

### 发现流程

发现过程先为查找 cwd 解析根列表，列举每个根的直接条目，并且只考虑名称以 `.md` 结尾的非目录文件，按名称顺序访问。每个文件都会被读取、解析 frontmatter、校验，并转为携带根目录来源标签、rank 与路径 locator 的候选项。存在文件系统服务时，根条目的名称取自该服务，否则取自 Node 的目录读取。所有根都成功列举时，该提供方返回普通候选项数组；有根无法列举时，则返回显式的不完整观测。

### 加载所选定义

`get()` 会再次读取候选项的路径 locator，重新解析文件，并返回带有该候选项来源与本提供方名称的定义；已消失或不再能解析的文件返回 `undefined`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从注册表约定逐步进入渲染已发现定义的消费方，以及该提供方读取所经由的服务。

- [agent-definitions 包](../agent-definitions/README.zh.md)——该提供方注册到的注册表。
- [tool-subagent 包](../tool-subagent/README.zh.md)——已发现定义如何到达模型并收窄子 agent。
- [home-paths 包](../../util/home-paths/README.zh.md)——`dshHome` 与 `agentsHome` 如何解析。
- [fs 包](../../fs/fs/README.zh.md)——该提供方在存在时优先使用的文件系统服务。
- [subagent 子系统参考](../../../docs/subsystems/subagent.zh.md)——这些定义所配置的委派服务。

-----

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-subagent` 间接影响模型；它把该提供方的定义名称与有长度上限的描述发布到 available-subagents 目录中，并把所选定义的 persona 正文与工具白名单应用到子 agent 上。

#### KV Cache 影响

无直接提示词影响。上述消费方拥有那条持久化目录消息，本提供方只提供它所渲染的摘要，而文件编辑只有经过下一次目录读取才会到达模型。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该提供方何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **发现仅限平铺的顶层**——只识别 `<root>/<name>.md`；嵌套目录、目录 bundle 与包 manifest（元数据清单）都被忽略。
- **未知的 frontmatter 键会拒绝整个文件**——拼错或不受支持的字段会让整个定义随警告一起隐藏，而不是忽略该字段。
- **`tools:` 不能为空列表**——省略该字段表示继承子 agent 的工具，显式的空列表会被拒绝，而不表示「没有工具」。
- **persona 正文是严格的提示词模板**——`{{variable}}` 引用会针对子 agent 提示词已注册的变量插值，因此正文中若含这类花括号，必须写出已注册的变量名，否则子 agent 的提示词渲染会失败。
- **无法列举的根目录会产生不完整观测**——该根目录下的定义在该次读取中缺失，消费方会保留最后一份可用目录，而不会把这些定义视为已删除。
- **没有文件系统监视器**——新增、编辑或删除的定义只有在下一次读取时才可见，因此没有任何机制自行刷新目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
