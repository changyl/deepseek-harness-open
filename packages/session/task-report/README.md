---
description: "Turn-end task reports: a Markdown change summary and verification record folded from each closed turn's own log window and written into the session workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-report

English | [中文](README.zh.md)

## Summary

When a turn closes, this plugin folds that turn's own log window into a Markdown task report: the request it answered, the files it changed, the verification commands it ran with their outcomes, and the turn's closing text. It writes the document into the session workspace and records one durable `task-report/generated` event, which the Web client renders as a card in the turn tail. Nothing about the work is model-authored or model-visible: the report is derived from the log the turn already wrote, and no prompt, request, or tool schema changes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a profile and every closed turn that recorded a file change or ran a matching verification command produces one report. The default configuration writes `.dsh/reports/turn-<n>.md` relative to the session working directory; both the directory and the verification patterns are deployment settings:

```yaml
- name: '@deepseek-ai/dsh-task-report'
  config:
    directory: .dsh/reports
    verifyPatterns: [test, vitest, typecheck, lint]
```

A report states the turn number and how it ended, the user request that opened it, the closing assistant text, a table of changed files with added and removed line counts, and a table of verification commands with their parsed outcomes.

### When a report is produced

A turn produces a report when it recorded at least one applied change (the hunks `write` and `edit` attach to their results) or ran at least one shell command whose line matches a configured pattern. A turn that only conversed records nothing — no file and no event — so a chat-only session leaves no residue. A `read-only` session records the refusal instead of a path, and the event says why.

### Regenerating one

`/report` folds the session's latest closed turn again and rewrites that turn's document, even when the turn recorded nothing. The command settles with the written path, or with the refusal reason when the write was not permitted. Regenerating appends another `task-report/generated` event for the same turn; both the file and the card state the latest one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin listens on the session event stream and acts on `turn/end`, so a report always describes a committed turn rather than an in-flight one. Generation is fire-and-forget: a failure is logged and never disturbs the session. The turn's evidence comes from `ctx.sessionQuery.readSession()`, whose event list is sliced to the window between that turn's `turn/start` and `turn/end`; events before `inheritedEventCount` belong to a fork seed and are excluded, so a forked session never reports its parent's turns.

The fold is pure. The request is the turn's first user-sourced message, the closing text its last non-empty assistant message, and both are trimmed and bounded. Changes come from `meta.diffs` on the turn's `tool/result` events — the hunks the first-party `write` and `edit` tools record — deduplicated by path in first-seen order, with `create` derived from an absent previous text and line counts taken from each side. Verification comes from `bash` tool calls whose command matches a configured pattern, paired by call id with the result that reported the outcome; the outcome is read from the same markers the shell renders (`[exit code: N]`, timeouts, signals) and from the result's error flag when no marker exists.

Writing happens before recording: the document is rendered, resolved against `session.header.cwd`, and written through `ctx.fs.writeText` with the session's sandbox policy, so a read-only session fences the write. Only then does the plugin append `task-report/generated`, whose payload carries the outcome — path or refusal, request, summary, changes, and verification. The event is log-only and bounded to 50 changed files and 20 verification commands by default.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the report's own behavior is not the question.

- [tool-present](../../fs/tool-present/README.md) — the model-owned delivery declaration whose `write`/`edit` results supply this plugin's change evidence.
- [change-review](../../fs/change-review/README.md) — the accept/revert decisions a reader records over those same changes.
- [session-query](../../session-query/session-query/README.md) — the log reader this plugin folds.
- [ui-task-report](../../client/ui-task-report/README.md) — the Web card that renders the recorded report in the turn tail.
- [Turn-end task report Agent Note](../../../.agents/notes/implemented/feature/2026-09-14-turn-end-task-report.md) — why the report is deterministic, where it is written, and what it deliberately leaves out.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package folds the session log after each turn closes and records a log-only report event, adding no prompt section, tool schema, tool result, or model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current report. They are current constraints of the mechanism, not a backlog.

- **Only `write` and `edit` produce change evidence** — a file created by a shell command, by a code-execution dispatch, or by another tool has no recorded hunks and therefore never appears in the report, even though the turn changed it. The authoritative workspace diff would have to come from git, which this plugin does not consult.
- **Verification outcomes are parsed, not structured** — the shell capability renders stdout, stderr, and the exit status into one model-facing text block, so this plugin reads the same markers a human does. A command whose output omits the marker reports `unknown` rather than guessing, and a truncated spill hides whatever the marker would have said.
- **One report per turn, keyed by turn number** — regenerating overwrites `turn-<n>.md` in place, and the previous document is not archived. Two sessions sharing one working directory therefore contend for the same file names.
- **The report is not a deliverable** — `present` is a model-owned declaration, so this plugin writes a file and records an event without adding it to the session's presented-file row. A future revision that wants the report to appear there must decide who owns that declaration.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package owns no cross-plugin mutable state; its two registrations — the `session/event` listener and the `/report` command — prove disposal through the real-composition suite, which boots the shipped YAML shape and unloads it.
