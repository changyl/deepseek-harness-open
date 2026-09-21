# Agent Note: Project unpaired tool calls out of Messages history

Status: implemented

[English](2026-09-21-messages-unpaired-tool-history.md) | 中文

## Problem

Messages 要求每个 assistant 的 `tool_use` 都由紧随其后的 user 轮次中的 `tool_result` 应答，并且每个 `tool_result` 都对应请求中仍然存在的调用。持久 Session 日志可能两者都不满足：在结果被记录之前失败的工具分发会留下没有 `tool/result` 的 `tool/call`，被取代的历史也可能留下其调用已不存在的工具结果。[Messages 序列化器](../../../../packages/llm/llm-deepseek/src/protocols/messages/serialize.ts)会以 `INVALID_REQUEST` 拒绝这样的历史，因此一次工具分发失败就会让该 Session 之后的所有请求失败——包括下一个用户轮次，以及任何只是对该 Session 做摘要的请求。

## Decision

请求转换会把 wire 历史投影为 Messages 能够表示的配对关系。未获应答的 `tool_use` 与孤立的 `tool_result` 会从发出的请求中移除；内容被清空的 assistant 轮次会被丢弃；移除后暴露出的相同角色 user 或 assistant 邻居会重新合并为一个轮次；重复的调用 id 保留首次声明。每条 in-history system 更新仍保持为独立消息。

持久消息保持不变，包括原始内容块及其 Session 事件，该投影也绝不会重新执行历史调用。这里不虚构任何内容：请求省略无法表示的块，而不是发明一个结果，因此[空输入兜底](2026-09-16-messages-historical-tool-input.zh.md)仍是历史工具内容唯一的替换。[Messages 适配器决策](../feature/2026-09-07-deepseek-messages-adapter.zh.md)拥有周围的转换规则。

## Alternatives considered

**为未获应答的调用合成错误结果。** loop 的取消路径会记录有序的 `tool/call` 加 `ABORTED_BEFORE_DISPATCH` 结果对，因此 wire 形态是现成的。适配器无法为它将要发送的结果写日志，而任何 Session 事件都不包含的模型可见内容会破坏日志重建，何况 loop 是刻意让这种情况不配对的。

**继续拒绝请求。** 这正是被报告的缺陷：一次瞬时工具失败会永久终止该 Session，因为之后没有任何请求能够完成转换。只有当调用方能够修复历史时，拒绝才是正确的，而没有任何调用方可以改写已提交的 Session 日志。

**在加载时修复 Session 日志。** 把缺失的结果注入持久化会改写证据、改变每个协议与每个 Session 读取方看到的内容，并为 loop 内部已经容忍的状态引入格式迁移。

## Consequences

日志中包含未获应答调用的 Session 会继续接受请求，因此中断该轮次的失败只作为该轮次的错误可见，而不会终结 Session。代价是恰好针对这些历史的请求会有损：模型看不到被移除的块，且这种损失与空输入兜底一样是静默的。请求对 Messages 仍然有效，持久日志依然保留完整证据。

验证覆盖 `tests/messages/serialize.spec.ts` 中的请求转换用例表——孤立结果、以未获应答调用结尾的历史、后续仍有输入前的未获应答调用、部分应答的并行组、重复的调用 id，以及重复的结果——既有用例同时证明有效历史不受影响。没有录制 Session 会走到这条路径，因为调用只有在工具分发故障或进程退出时才会保持未配对，而两者都不是干净的 replay 运行能够重现的。
