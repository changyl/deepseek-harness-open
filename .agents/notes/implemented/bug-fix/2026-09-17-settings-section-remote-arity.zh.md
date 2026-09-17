# Agent Note: Fork 数据面板显式传入每个已声明的 Remote 参数

Status: implemented

[English](2026-09-17-settings-section-remote-arity.md) | 中文

## Problem

本 fork 新增的三个客户端全局面板——Token 用量面板、持久项目看板、结果信号面板——都以偏短的实参列表读取各自的 Remote 命名空间：`ctx.remote.usage.query()`、`ctx.remote.project.list()`、`ctx.remote.effectiveness.query()`。这三个描述符各自声明了一个可选过滤参数，而生成的 Client 面把它标成 `filter?: UsageFilterWire`，因此这些调用点能通过类型检查。

Client 网关不接受省略参数。`TypertGatewayClient.prepareInvocation` 计算 `expected = descriptor.parameters.length`，并不会排除缺席的可选参数，于是在 `connection.rpc.call` 执行之前抛出 `client api: usage/query expected 1 argument(s), got 0`。三个面板把任何拒绝都折进各自的 `error` 状态，因此三个面板都显示 `暂时无法读取…，请重试。`，并且完全没有发出任何 HTTP 请求；与此同时，Host 控制器对同样这些方法的直接 RPC 调用是正常应答的。

`acceptsUndefined` 是 wire 层面的标记，表示允许某个*值*缺席——Host 会因此跳过缺失字段——而不是允许在发出时省略该实参。既有的调用约定本就是显式的那一种：`ui-agent-preset` 的设置存储为可选的 `expectedRevision` 传入 `undefined`，并写明了原因。

## Decision

三个面板各自显式传入已声明的参数：`query(undefined)`、`list(undefined)`、`query(undefined)`。Client 网关保留其精确参数个数约定，描述符保留可选过滤条件，Host 对「过滤条件缺席」的行为不变。

## Alternatives considered

**让 Client 网关接受省略末尾的可选参数。** 一处修改而非三处，而且与生成的 `filter?:` 类型一致。否决原因：该网关是共享传输层，而参数个数检查正是让描述符错配在调用处失败、而不是在 Host 实参解码错误时才暴露的机制。既有的可选参数调用方全都显式传入，因此在此放宽约定，等于为了掩盖三个调用点而扩宽一份契约。

**在 wire 上把过滤条件改为必填。** 否决原因：Host 把过滤条件缺席视为「整个语料」，而 `/usage`、`/project`、`/effectiveness` 三条命令与 `project` 工具在读取同一批服务时都不指定它。

**从这三个描述符中删掉过滤参数。** 否决原因：它是这些面板将来做范围化读取所需要的接缝，而为客户端调用点缺陷去改 Host API 是小题大做。

## Consequences

三个面板都能读取各自的命名空间并完成渲染。没有会话事件、提示词、工具 schema 或 wire 格式发生变化，因此录制会话快照不发生移动。

覆盖：每个面板的 browser-plugin 规格断言注入的读取以已声明的实参调用其命名空间方法（`toHaveBeenCalledWith(undefined)`），该断言在省略实参的写法下失败；[fork 全局面板场景](../../../../apps/web/tests/fork-global-panels.e2e.ts) 启动随包发布的 Web 组合，断言每个面板都到达其就绪标题，且没有失败提示、没有页面错误。
