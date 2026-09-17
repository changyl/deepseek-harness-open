---
description: "Cross-session effectiveness query on ctx.effectiveness: whole-corpus outcome counts per session and per route, folded from canonical session logs on demand."
kind: "package-reference"
---

# @deepseek-ai/dsh-effectiveness-query

English | [中文](README.zh.md)

## Summary

This package answers the deployment-level question the per-session `effectiveness` projection cannot: which routes carry the negative judgments, the reverts, and the failed verification. `ctx.effectiveness.query()` folds the selected session corpus through the same unit the projection serves and returns corpus-wide totals, one row per route, and bounded per-session rows. It reads canonical logs on demand through the session-query service and caches nothing, so a report is the corpus' current state rather than a snapshot someone has to remember to refresh. The `dsh-base` bundle mounts it, and [`command-effectiveness`](../command-effectiveness/README.md) renders the report as the human `/effectiveness` command.

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

The `dsh-base` bundle mounts this service, so a shipped composition already serves `ctx.effectiveness`; the block below is the minimal shape a deployment adds it to by hand. It needs no projection registry and no producer packages of its own: it reads whatever the logs already hold.

### Composition

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-session-query'
- name: '@deepseek-ai/dsh-effectiveness-query'
  config:
    maxSessionsReported: 200
```

Without the session-query service the fiber stays pending, so an assembly that never composes it serves no `ctx.effectiveness` key. The producer packages are not dependencies: a log that carries no feedback, no change decision, and no task report simply folds to zero counts.

### What the report carries

| Field | Meaning |
|---|---|
| `totals` | The outcome projection summed over every selected session, plus `sessions` |
| `totals.turnsWithSignal` | Per-session turn counts added up, so one turn in two sessions counts twice |
| `routes` | One row per route the selected logs named, each carrying the same outcome fields plus `sessions` |
| `sessions` | Per-session rows, newest first, each carrying its own `routes` list and `createdAt` |
| `truncated` | Whether the per-session rows were cut at `maxSessionsReported` |

The outcome fields are the ones the [`effectiveness` projection](../effectiveness/README.md) serves: `feedback.positive`, `feedback.negative`, `feedback.byCategory`, `changes.accepted`, `changes.reverted`, `changes.undecided`, and `verification.passed`, `verification.failed`, `verification.unknown`.

### Window and route selection

`from` and `to` bound the session by the time span of the events it contributed: a session is selected whole when its span overlaps the window, never sliced event by event. `sessions` restricts the corpus to the named ids. `provider` and `model` select the sessions whose log named that route, and restrict the route rows to it; a route filter therefore drops a session that never used the route, while an unfiltered query keeps every session whose log observed at least one event.

### Where the counts come from

Each selected session's canonical events are folded through `effectivenessProjectionDefinition`, the same unit the per-session projection registers, so a signal, a re-rated message, a re-decided change, and an undecided applied change all mean exactly what they mean in the projection. The route a session is attributed to comes from its `request/context` events, in first-seen order, deduplicated by provider and model. A session whose log named several routes contributes its whole projection to each route row, which is why the route rows may sum above the totals.

### Failures and recovery

Every query re-reads the corpus through `ctx.sessionQuery`, so a session whose persisted log is unreadable rejects the call rather than being skipped silently; the caller sees the failure and can retry. Nothing is cached, so no stored report can go stale, and there is no recovery state to reconcile after a crash.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the fold behind the report; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The service is a stateless fold over the corpus: it lists the sessions the query service exposes, reads each one's canonical log, folds it with the shared effectiveness unit, attributes the result to the routes the log named, and assembles the report. The one deliberate asymmetry is attribution — a session's counts are added to the corpus totals once and to every route row it used — because a per-route answer has to be readable on its own; the report states the consequence rather than hiding it.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service, its filter and report types, the corpus walk, and the route attribution |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the service's contract is not enough. They move from the corpus it reads to the per-session unit it reuses.

- [Effectiveness projection package](../effectiveness/README.md) — the per-session unit this query folds each log through, and the definitions of a signal, an undecided change, and an insufficient sample.
- [Session query package](../../session-query/session-query/README.md) — the live-preferred corpus and log reads the query walks.
- [Session query subsystem](../../../docs/subsystems/session-query.md) — the query service's contract, filters, and relationship traces.
- [Session persistence package](../../session/session-persistence/README.md) — the durable store the corpus is listed from.
- [Feedback subsystem](../../../docs/subsystems/feedback.md) — the feedback types whose signals the counts sum.
- [Feedback package map](../README.md) — the packages of this group and their repository position.

-----

<a id="model-experience"></a>
## Model Experience

### Cross-session outcome read model

#### What the model sees

Nothing. The service reads canonical session logs through `ctx.sessionQuery` and returns a report to its caller; it registers no tool, prompt section, or session event, and the report reaches a person only through the `/effectiveness` command, which is itself log-only.

#### Token effect

Zero: the report is derived after the fact from logged events, so it adds no tokens to any request.

#### KV Cache effect

None: the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a report can say and what it costs to produce. They are current package constraints, not a task backlog.

- **No durable index and no cache** — every query lists the corpus and reads each selected session's canonical log, so a report over a large corpus is expensive and repeated calls pay the whole cost again.
- **No Remote surface or Web UI** — the shipped consumer is the `/effectiveness` command, which renders text; a browser surface would need a Remote namespace that does not exist yet.
- **A per-route row double-counts a multi-route session** — a session that used several routes adds its whole projection to each of those rows, so the route rows may sum above `totals`; only a session that used exactly one route divides cleanly.
- **`from` and `to` are session-granular** — the window selects whole sessions by their event-span overlap, so a report cannot isolate the part of a session that falls inside it.
- **No per-turn route attribution** — a session's counts are attributed to every route it named, not to the route that served the turn a signal belongs to.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns a single stateless fold whose per-session results come from the shared `effectivenessProjectionDefinition` unit, whose payload that unit's own schema validates, and the corpus relations it relies on (a session listing that names every readable log, a `readSession` that returns that session's canonical events in order, and `request/context` events carrying the provider and model a log named) are owned and runtime-checked by dsh-session-query and dsh-session, not here.
