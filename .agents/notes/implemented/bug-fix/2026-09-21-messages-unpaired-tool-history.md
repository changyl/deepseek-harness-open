# Agent Note: Project unpaired tool calls out of Messages history

Status: implemented

English | [中文](2026-09-21-messages-unpaired-tool-history.zh.md)

## Problem

Messages requires every assistant `tool_use` to be answered by a `tool_result` in the immediately following user turn, and every `tool_result` to answer a call the request still contains. A durable Session log can hold neither. A tool dispatch that fails before its result is recorded leaves a `tool/call` without a `tool/result`, and a superseded history can leave a result whose call is gone. The [Messages serializer](../../../../packages/llm/llm-deepseek/src/protocols/messages/serialize.ts) rejected such a history with `INVALID_REQUEST`, so one failed dispatch made every later request of that Session fail — including the next user turn and any request that only summarizes the Session.

## Decision

Request conversion projects the wire history onto the pairings Messages can represent. An unanswered `tool_use` and an orphan `tool_result` are dropped from the outgoing request; an assistant turn left with no content is dropped; the user or assistant neighbors that a removal exposes are merged back into one turn; and a repeated call id keeps its first declaration. Each in-history system update stays its own message.

Durable messages stay unchanged, including the original blocks and their Session events, and the projection never executes the historical call again. Nothing is fabricated: the request omits the unrepresentable block instead of inventing a result, which keeps the [empty-input fallback](2026-09-16-messages-historical-tool-input.md) the only substitution for historical tool content. The [Messages adapter decision](../feature/2026-09-07-deepseek-messages-adapter.md) owns the surrounding conversion rules.

## Alternatives considered

**Synthesize an error result for the unanswered call.** The loop's cancellation path records an ordered `tool/call` plus `ABORTED_BEFORE_DISPATCH` result pair, so the wire shape exists. The provider cannot log the result it would send, and model-visible content that no Session event contains breaks log reconstruction for a case the loop leaves unpaired on purpose.

**Keep rejecting the request.** This is the reported defect: a transient tool failure ended the Session permanently, because no later request could be converted. Rejecting is only correct when the caller can repair the history, and no caller can rewrite a committed Session log.

**Repair the Session log at load.** Injecting the missing result into persistence would rewrite evidence, change what every protocol and every Session reader sees, and require a format migration for a state the loop already tolerates internally.

## Consequences

A Session whose log contains an unanswered call keeps accepting requests, so the failure that interrupted a turn stays visible as that turn's error instead of ending the Session. The trade-off is a lossy request for exactly those histories: the model does not see the dropped block, and the loss is silent, like the empty-input fallback. The request remains valid for Messages, and the durable log still carries the full evidence.

Verification covers the request-conversion table in `tests/messages/serialize.spec.ts` — orphan results, a history ending in an unanswered call, an unanswered call before later input, a partially answered parallel group, a repeated call id, and a duplicated result — with the existing cases proving valid histories are unchanged. No recorded Session reaches this path, because a call is left unpaired only by a tool-dispatch fault or a process exit, neither of which a clean replay run reproduces.
