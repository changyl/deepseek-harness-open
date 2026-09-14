# Agent Note: Turn-end task report

Status: implemented

English | [中文](2026-09-14-turn-end-task-report.zh.md)

## Problem

A session log records how work happened — every message, tool call, and result — but nothing in the product packages that record the way a team consumes it: what changed, what was verified, and how the turn ended. A reviewer had to reconstruct all of it from the transcript. The only artifact the harness could hand over was the session-log ZIP from `/export`, which is canonical JSONL rather than a summary, and the `present` tool's declared files, which are paths the model chose and carry no change or verification data.

Nothing models a change or a test outcome either. A workspace diff has no capability: there is no `ctx.git`, no diff service, and the only structured change record is the `meta.diffs` payload that the first-party `write` and `edit` tools attach to their `tool/result` events. Shell results are one model-facing text block, so an exit status exists only as the `[exit code: N]` marker the shell renderer writes.

## Decision

A new host plugin, [`dsh-task-report`](../../../../packages/session/task-report/README.md), folds each turn's own log window at `turn/end` into a Markdown report, writes it into the session workspace, and records one durable `task-report/generated` event. A new client plugin, [`dsh-client-ui-task-report`](../../../../packages/client/ui-task-report/README.md), renders that event as a row in the chat view's turn tail. `/report` regenerates the latest closed turn on demand. The whole path is deterministic and model-free.

### The evidence is the turn's own window

Generation triggers on the durable `turn/end` session event rather than on `agent/turn-stopping`. The stopping point is awaited before the boundary commits, and the natural evidence sources are still mid-turn there — `present`'s open-turn check, the turn-outline response draft — so acting there would describe a turn that had not finished. Reading `ctx.sessionQuery.readSession()` after the commit also keeps the plugin on the async reader the synchronous-read decision requires, and slicing the event list between that turn's `turn/start` and `turn/end` gives the request, the tool calls, and the closing text without any positional guessing. Events before `inheritedEventCount` are excluded, so a forked session never reports its parent's turns.

Changes come from `meta.diffs`, not from git. That is the only structured change record in the log, and it is the agent's own contribution rather than the workspace's total state, which is what a reviewer wants to see attributed to a turn. It also costs nothing: no subprocess, no repository requirement, and no failure mode in a directory that is not a working tree. The cost is stated in the package README: a file a shell command created has no recorded hunks and never appears.

Verification outcomes are parsed from the same markers the shell renders. There is no test-run model to consume, so the plugin reads `[exit code: N]`, the timeout and signal markers, and the result's error flag; a command that reported none of them is `unknown` rather than a guess.

### One event, log-only and bounded

`task-report/generated` carries the outcome rather than the file: the turn, its end reason, the written path or the refusal reason, the bounded request and closing text, and the change and verification lists. It is log-only — it never enters the model surface or derived history — so the "model-visible ⟺ logged" rule is satisfied by construction rather than by remembering to log something. Payload arrays are bounded (50 changed files, 20 verification commands by default) because the event is durable and a runaway turn must not bloat the log.

The event is appended after the write attempt, and it is appended whether the write succeeded or not. A read-only session therefore records why its workspace was left untouched, and the client can state that instead of rendering an inert control.

### The card is a turn-scoped fold, not a new surface

The client reuses the mechanism `ui-deliverables` established for per-turn artifacts: a state-only `ConversationNodeDefinition` folds the event into a `ConversationTurnDataMap` key, and a pure `select(owner)` on the `conversation.chat.turnTail` chain claims the completed turn whose data carries it. No new slot, no new view target.

That choice also decides the replay story for free: the card renders from the durable event, so a reload reconstructs it, and `buildLocationData` preserves value identity while the payload is unchanged.

### Enabled in the Web bundle only

The host plugin ships in `dsh-web-app`, not in `dsh-base`. Recorded-session snapshots replay through the headless, SDK, and ACP profiles, and an automatic log-appending plugin in the base layer would rewrite every fixture in that suite. Keeping it in the Web layer is also honest about the surface it serves: the report exists for the Web review loop, and a deployment that wants it in another profile moves one row.

## Alternatives considered

**Author the summary with the model at turn end.** The canonical way to get model-authored text at a boundary is `agent/turn-stopping` plus `agent.steer()`, which reopens a step. Rejected: it spends a model call on every turn, makes the artifact non-reproducible from the log, and turns a bookkeeping feature into a latency and cost liability. The closing assistant message already is the model's own account of the turn, and the report quotes it.

**Shell out to git for the authoritative workspace diff.** `scripts/change-scope.ts` shows the shape a diff report takes, and a git diff would capture files created by shell commands. Rejected for this revision: the harness has no git capability to consume, the read would need a subprocess inside a sandbox, and a non-repository workspace would need a silent fallback. The recorded hunks are the agent's contribution, which is the part a reviewer attributes to a turn; adding a workspace-wide diff is a separate decision about that boundary.

**Make the report a model-facing tool the model calls.** A `task_report` tool would let the model choose what to emphasize. Rejected: the request was for automatic output at task end, a tool call occupies model context on every turn, and the tool's own result would enter the transcript as another node the reviewer has to read.

**Reuse `deliverables/presented` instead of a new event.** That event already drives a turn-tail row in the client. Rejected: it carries `{ path, description }` only — no change summary, no verification, no prose — and its producer is the model-owned `present` tool, so a plugin appending it would be attaching a report to a declaration the model did not make.

**Write the report into the transcript as a message.** A visible message would put the report in the conversation. Rejected: any model-visible input must be a logged session event, and a log-only artifact event that a client surface renders is exactly the arrangement the deliverables row already uses.

## Consequences

A turn that recorded a change or ran a matching verification command now leaves two things behind: a Markdown document under `.dsh/reports/` in the session workspace, and one `task-report/generated` event that the Web client renders above the turn's action strip. `/report` regenerates the latest closed turn.

The plugin is deterministic, so its behavior is pinned by a pure fold suite and a pure render suite, and the shipped YAML shape is proven by a real Loader composition that writes a report, records the event, and settles `/report`. The client card is pinned by a definition/selector suite, a component suite, and an HMR-safety registration suite.

Four limits are deliberate and recorded in the package README: only `write` and `edit` produce change evidence, verification outcomes are parsed rather than structured, one report per turn is keyed by turn number in a shared directory namespace, and the report is not a `present` deliverable. No session event, prompt, or tool schema the model sees changed, so the recorded-session fixtures do not move; the browser lane's assembled output gains one row for turns that recorded a report.
