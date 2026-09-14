---
description: "Reader decisions about applied file changes — accept a change, or revert the file to its pre-change content — for users and maintainers of the Web GUI's change review."
kind: "package-reference"
---

# @deepseek-ai/dsh-change-review

[English](README.md) | 中文

## 概述

`dsh-change-review` 记录读者对工具已应用的某次文件改动做出的决定，并执行回滚。`accepted` 表示保留改动；`reverted` 会把文件恢复到该改动之前的内容，并同样记录这一决定。两种决定都是持久化会话事件，因此刷新或 fork 都能重建。路由位于 Connection 的认证围栏之内，请求只以 `tool/result` 的 seq 与路径来指认改动：写出的每一个字节都从会话日志重新推导，客户端无法让它写入自选文本。改动之后文件再被修改过时，一律拒绝，不做猜测。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 客户端可达的位置挂载本插件；正式提供的 `dsh-web-app` bundle 已经挂载。浏览器向 `/api/change.review` POST 一个 JSON 体：

```json
{ "sessionId": "…", "action": "reverted", "changes": [{ "seq": 41, "path": "src/app.ts" }] }
```

`action` 取 `accepted` 或 `reverted`，`changes` 最多 64 项。`200` 返回 `{ results }`，每项一个状态。`409` 会带原因拒绝整个请求，并让所有文件保持原样——因为写入之前会先用文件校验每一个记录的 hunk。

### 回滚需要什么

回滚会撤销 `tool/result` 在元数据中记录的 hunk。没有为该路径记录任何 hunk 的结果——例如新建文件、或元数据格式错误的改动——无法回滚，会被拒绝。文件内容已不再是该改动所产生的内容时同样拒绝：否则会改到错误的行。

<a id="understand-the-implementation"></a>
## 理解实现

`revertText` 是纯函数的一半。它把每个 hunk 放在其记录的 `newStart` 处；对于生产方尚未记录行号的载荷，则放在文件中唯一包含该 hunk 文本的位置；校验产生的行之后，从最后一个 hunk 到第一个依次把改动前的行接回。所有 hunk 先完成定位，才开始拼接，因此一个 hunk 失败就不会改动文件。

路由通过 `ctx.sessionQuery.readEvent` 读取记录的改动，按该会话自己的 cwd 解析路径，并用 `ctx.fs.writeText` 配合 `replaceIfVersion` 对它刚读到的版本写入，因此并发写入会竞争失败而不是被覆盖。决定以 `change/review` 事件追加到已挂载的会话；未挂载的会话会被拒绝，而不是静默不记录。

<a id="model-experience"></a>
## 模型体验

### 读者决定

#### 模型看到什么

本插件本身不产生任何模型可见内容。[`dsh-change-review-context`](../../context/change-review-context/README.zh.md) 会把它上次发言之后记录的决定汇总成一条请求消息：

##### 评审说明

```markdown
The user reviewed file changes you applied:
- Reverted: `src/app.ts` (turn 4) — the file is back to its content from before that change; re-read it before editing it again.
- Kept: `src/util.ts` (turn 4).
```

#### Token 影响

每批决定一条短消息，且仅在存在未上报决定时出现。

#### KV Cache 影响

只追加；该说明接在可复用请求前缀之后加入请求历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不处理新建文件**——新建不记录任何 hunk，因此删除该文件会被拒绝，而不是执行。
- **会话必须处于挂载状态**——决定追加到活动会话；冷会话会被以 `409` 拒绝。
- **决定不等于评审工作流**——没有逐 hunk 选择、没有与工作区的差异比较、也不记录决定者。
- **同一文件后续又被改动时跨改动回滚**会被拒绝而不是重放；只有请求列出的改动会按给定顺序撤销。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
