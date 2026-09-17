---
description: "The durable usage provider: canonical-log folds into one token-fact record per session, cached in the usage storage domain, so ctx.usage.query() answers from history."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-ledger

English | [中文](README.zh.md)

## Summary

Mount this package to make `ctx.usage.query()` answer from durable history. It derives one record per session from that session's canonical log and caches it in the `usage` storage domain, so totals survive restarts and deleting every record costs one re-fold. Each record folds `request/context` route changes, `step/end` steps, and assistant usage, and a settled message with no usage sample counts as an unknown-usage step. A record holds token facts only, never a price, and the canonical log stays authoritative.

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

Mount it beside `@deepseek-ai/dsh-usage` and the services it reads: the canonical logs through `ctx.sessionQuery` and `ctx.sessionPersistence`, and the derived-record store through `ctx.storageDomain`.

### Composition

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-session-query-sqlite'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
```

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `rebuildOnMount` | `false` | Delete every stored record at mount so the next query re-folds every session from its canonical log |

Use `rebuildOnMount: true` after a change to the fold itself. A normal start keeps the cache and re-folds only the sessions whose persistence revision moved.

### What one record holds

| Field | Meaning |
|---|---|
| `turns` | Distinct turns with at least one closed step |
| `steps` | Closed steps |
| `unknownUsageSteps` | Settled assistant messages whose adapter reported no usage sample |
| `firstTime` / `lastTime` | Earliest and latest contributing event time, null for an empty log |
| `throughSeq` | Highest durable event seq consumed by the fold |
| `routes` | Per-route token buckets plus that route's step and unknown-usage-step counts |

### How the fold attributes facts

Each `request/context` sets the route that following events are attributed to, so usage recorded before the log names a route lands on `unknown/unknown`. Each `step/end` closes a step, and the first `step/end` of a turn counts that turn once. Usage is read from `assistant/message` — its embedded sample or the last stream chunk carrying one — and from `assistant/attempt`: an identical sample repeated for the same turn and step is ignored, while a different sample for the same turn and step replaces the earlier one and subtracts the superseded buckets from the route they landed on. An `llm/retry-started` for the live turn and step closes that replacement slot, so the retried attempt adds to the total because both attempts were billed. A settled `assistant/message` with no sample increments `unknownUsageSteps`, because its tokens are unknown rather than zero; an `assistant/attempt` with no sample is not counted.

### When a session is re-folded

A stored record is reused while the persistence revision from `ctx.sessionPersistence.stat()` matches the revision the record folded. A moved revision re-folds the session from its canonical log. A session with no persistence revision records an empty revision, which never matches, so each query re-folds it. Because the record is derived state over the canonical log, deleting any record costs one re-fold and changes no reported total.

### Failures and recovery

The plugin registers the provider on the mounting fiber and opens the `usage` domain at mount, so unmounting removes both the provider and its table access. Without `ctx.usage` the plugin stays pending, because it injects `usage`. A query with no provider registered throws `UsageUnavailableError` from the service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how a record is produced and kept fresh; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The fold is total over one session's event list and mutates nothing outside its own state, so re-running it is always safe and a missing record is always recoverable. Route facts are accumulated into a per-route map keyed by provider and model, then sorted before they are stored, which keeps records and aggregates deterministic. Aggregation walks the selected records once, counts a session only when at least one of its route rows survives the route selection, and sums route and total counts together so `totals` always equals the sum of its route rows. The provider holds no pricing knowledge: a price is applied later by the usage service, so replacing a rate card can never invalidate a stored record.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the provider, the query loop, the revision-checked cache, and aggregation |
| [`src/fold.ts`](src/fold.ts) | Pure fold from one session's canonical events into its usage record |
| [`src/spec.ts`](src/spec.ts) | The `usage` storage domain and its record schema |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the fold's contract is not enough.

- [Usage subsystem](../../../docs/subsystems/usage.md) — the report and provider contracts this ledger satisfies.
- [Usage service package](../usage/README.md) — the service that registers a provider and prices its answers.
- [Usage pricing package](../usage-pricing/README.md) — the rate card applied to this ledger's token facts.
- [Storage domain package](../../storage/storage-domain/README.md) — the schema-validated KV domain that holds the derived records.
- [Session query package](../../session-query/session-query/README.md) — the canonical-log reads the fold consumes.
- [Usage package map](../README.md) — the three packages of this family and their repository position.

-----

<a id="model-experience"></a>
## Model Experience

### Durable token facts

#### What the model sees

Nothing. The provider answers `ctx.usage.query()` and registers no tool, prompt section, or session event of its own; it reads session logs that other packages already wrote.

#### Token effect

Zero: folding reads committed logs after the request completed, so the provider adds no tokens to any request.

#### KV Cache effect

None: the provider never assembles or sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what a query can select and where a figure comes from. They are current package constraints, not a task backlog.

- **Time filtering selects whole sessions** — `from` and `to` keep or drop a session by its event span, not by individual events, so a window overlapping a long session includes all of that session's tokens.
- **Workspace filtering is not implemented** — the filter carries no workspace field, so a caller cannot restrict a query to one workspace.
- **Live sessions are re-folded on every query** — a session whose persistence revision keeps moving never matches its cached record, so its whole log is folded again for each query.
- **Route attribution follows `request/context`** — usage that the log never attributes to a routed request is reported on `unknown/unknown`, and a route change mid-step attributes the whole step to the route in effect when the step closed.
- **Provider search APIs are not used** — the ledger lists every session and folds it locally, so a provider's own search index cannot narrow a query.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns a total fold over one session's canonical events plus a revision-checked cache over it. That cache is derived state whose only authority is the canonical log, so a stale or deleted record can cost one re-fold and cannot change a reported total; the event relations the fold relies on — one `request/context` per routed request, `step/end` closing each entered step, and usage samples carried by their assistant events — are owned and runtime-checked by dsh-agent-loop and the session surface, not here.
