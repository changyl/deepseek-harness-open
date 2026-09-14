---
description: "Turn-tail task report card: renders the change summary and verification record the host folded from a closed turn, with the open gesture for its Markdown."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-task-report

English | [中文](README.zh.md)

## Summary

This package renders the task report of a completed turn in the chat view's turn tail: one compact row stating how many files changed, the added and removed line totals, and how many verification commands passed, failed, or reported no outcome, plus the control that opens the written Markdown. The facts come from the durable `task-report/generated` event the host plugin recorded, so a reload or a paged history reconstructs the same row. The card is presentation only: it computes nothing from the workspace and adds nothing to what the model sees.

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

Mount this plugin beside `ui-deliverables` and `ui-chat`; the row then appears above the action strip of every turn that recorded a task report. It states the report title, then the facts the report carries: the changed-file count, the line totals, and the verification tally. The trailing control opens the report file in the session's own viewer, the same way a produced-file chip does.

A turn whose report was not written shows the refusal instead of the control, so a read-only session still explains itself rather than rendering an inert button. Turns without a report render nothing at all: the chain entry declines them, and the tail stays empty.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One state-only `ConversationNodeDefinition` folds `task-report/generated` into the turn-scoped `taskReport` value: `turn/start` opens the Context, the report event replaces the value, and `buildLocationData` republishes only when the payload identity moves. A chain entry then claims any completed turn whose data carries that value and hands the card the report plus the owner's file opener; both readers live in the plugin, and the component receives everything through props.

The card has no state and no service access. It renders the title, the facts it can state, and either the open control or the refusal line; a report with neither changes nor verification renders as title and control alone. All copy lives in the `taskReport` locale namespace, so a language switch re-renders through the framework's locale revision.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-task-report](../../session/task-report/README.md) — the host plugin that folds each closed turn and records the event this card renders.
- [ui-deliverables](../ui-deliverables/README.md) — the sibling turn-tail entry for produced files and changes.
- [ui-chat](../ui-chat/README.md) — declares `conversation.chat.turnTail`, the chain this card occupies.
- [Slots reference](../../../docs/subsystems/slots.md) — slot kinds, scopes, and the props shares a registrant receives.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders a recorded report for a human and adds no prompt section, tool schema, tool result, or model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current row.

- **The row is read-only** — it states what the host recorded. There is no re-run control; regenerating is `/report` in the composer, which is where the host-side command already lives.
- **No per-file detail** — the row carries counts and totals only. The changed-file list belongs to `ui-deliverables`, and a reader who wants the hunks opens the file there or reads the report document.
- **The report opens through the session file opener** — a report written outside the session workspace, which the host never does today, would have no address this card could resolve.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no cross-plugin mutable state; its registrations — the dictionaries, the turn-scoped fold, and the chain entry — prove disposal through the HMR-safety spec.
