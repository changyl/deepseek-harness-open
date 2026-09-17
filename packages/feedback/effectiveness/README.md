---
description: "One session's outcome signals — current message feedback, change-review decisions, and task-report verification — served as the client-visible effectiveness projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-effectiveness

English | [中文](README.zh.md)

## Summary

This package serves one session's outcome signals as the client-visible `effectiveness` projection: current human feedback on assistant messages, reader decisions about applied file changes, and verification outcomes from task reports. Clients read one finished value instead of folding the log themselves. The counts describe what happened inside a session, not a model quality score, and a session with no signal reports zero turns with signal rather than a zero rate. Mount it wherever a client displays session outcomes.

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

Mount the unit beside the session projection registry and the packages that append the signals it folds. The unit itself needs only the registry.

### Composition

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-message-feedback'
- name: '@deepseek-ai/dsh-change-review'
- name: '@deepseek-ai/dsh-task-report'
- name: '@deepseek-ai/dsh-effectiveness'
```

The producers are optional for the unit to load: without them the log simply carries no such signals and every count stays zero. Without the projection registry the fiber stays pending and nothing registers.

### What the value carries

| Field | Meaning |
|---|---|
| `feedback.positive` / `feedback.negative` | Messages the human currently rates each way; a re-rated message counts once under its latest rating |
| `feedback.byCategory` | Current judgments filed under each category; categories no judgment names are absent |
| `changes.accepted` / `changes.reverted` | Applied changes whose current decision is accepted or reverted; a change decided twice counts once under its latest decision |
| `changes.undecided` | Applied changes with no recorded decision |
| `verification.passed` / `failed` / `unknown` | Verification commands recorded by task reports, summed across every report in the session |
| `turnsWithSignal` | Distinct turns carrying at least one signal |

A turn counts as carrying a signal when feedback names a message that turn produced, a change decision belongs to it, or its task report recorded verification outcomes.

### Where the counts come from

The unit folds only events other packages already append. `assistant/message` supplies the message-to-turn identity that lets a rating name its turn. `feedback/message-put` and `feedback/message-delete` keep the current rating per message. `change/review` records a decision, and `tool/result` hunks read through `recordedHunks` record an applied change keyed by the result's seq and the hunk's path; `undecided` is the applied changes that key no decision. `task-report/generated` adds its verification outcomes to the session total. The unit adds no prompt, tool, or event of its own.

### Zero means no data

Every count is a current value, and every one of them is a session outcome count rather than a model quality score. A session that carries no signal yet reports zero everywhere, so a consumer must read `turnsWithSignal` before presenting a rate: zero means insufficient data, not a rate of zero. A rating on a message the log never produced counts in the rating totals but invents no turn, because the log holds no `assistant/message` linking that message to one.

### Failures and recovery

The unit is inert without the projection registry: `inject` keeps the fiber pending and nothing registers, so other assemblies serve no `effectiveness` key. Unmounting the plugin removes the key, because registrations are effects on the mounting fiber. Clients render the value through the projection seam's snapshot and change feed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the fold behind the value; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The unit is a pure fold over committed session events with one replacement rule per producer. A feedback event carries the complete current judgment for one message, so the latest event wins and a delete drops the entry; a decision keyed by change keeps only its latest value; a report's verification entries add to a running total because each report observes its own run. Rating counts and turn counts are deliberately separate: the rating totals count current judgments, while `turnsWithSignal` counts only turns the log can name, which is why a rating for an unknown message changes one and not the other. Fold state is plain JSON, so the projection cache can persist it.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `inject`, unit registration on the mounting fiber |
| [`src/projection.ts`](src/projection.ts) | The fold: state shape and schema, per-event transitions, wire view |
| [`src/types.ts`](src/types.ts) | One home of the `effectiveness` projection-key declaration and its field types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the unit's contract is not enough. They move from the registry that drives units to the producers whose events it folds.

- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — the registry that drives units and serves snapshot and change-feed values.
- [Session projection registry package](../../session/session-projection/README.md) — the registry contract units register against.
- [Message feedback package](../message-feedback/README.md) — the ratings, categories, and notes the feedback counts fold.
- [Feedback subsystem](../../../docs/subsystems/feedback.md) — the message-feedback types and service contract.
- [Task report package](../../session/task-report/README.md) — the reports whose verification outcomes the counts sum.
- [Feedback package map](../README.md) — the packages of this group and their repository position.

-----

<a id="model-experience"></a>
## Model Experience

### Session outcome read model

#### What the model sees

Nothing. The unit folds events other packages already appended into the `effectiveness` projection and registers no tool, prompt section, or session event of its own.

#### Token effect

Zero: the value is derived after the fact from logged events, so it adds no tokens to any request.

#### KV Cache effect

None: the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the counts describe and where the value exists. They are current package constraints, not a task backlog.

- **No cross-session or per-model aggregation yet** — the value covers one session, and a query service that aggregates across sessions or by model is deferred.
- **A rating without a matching `assistant/message` cannot name its turn** — such a rating counts in the rating totals but adds no turn to `turnsWithSignal`, because the log holds no message-to-turn link for it.
- **Verification counts are per report, not per command** — every task report adds its own outcomes, so the same command observed in two reports counts twice.
- **Visible only where the composition mounts it** — the `dsh-web-app` bundle registers the unit; `dsh-base` does not, so compositions without it serve no `effectiveness` key.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns a single pure projection fold whose wire payload is schema-validated by the projection registry at every snapshot and change-feed emission, and the relations it relies on (one `assistant/message` per message id with its owning turn, feedback events carrying the complete current judgment for one message, `change/review` payloads carrying the result seq and path that key the change, and task reports carrying their own verification outcomes) are owned and runtime-checked by dsh-session, dsh-message-feedback, dsh-change-review, and dsh-task-report, not here.
