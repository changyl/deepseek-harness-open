---
description: "Host Remote owner for the effectiveness namespace: one query answering cross-session outcome signals — feedback, change-review decisions, and verification outcomes — as corpus totals, per-route rows, and per-session rows."
kind: "package-reference"
---
# Effectiveness Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-effectiveness` exposes the generated `ctx.remote.effectiveness` namespace for a browser statistics surface. One `query(filter?)` call answers the same report `ctx.effectiveness` assembles — corpus totals, per-route rows, and per-session rows of human feedback, change-review decisions, and verification outcomes, each with the distinct turns that carried a signal. The controller adds no policy of its own: corpus selection, the per-session fold, and the reporting bound all live in the query service, so a call always reflects the logs readable at that moment. A session with no signal reports `turnsWithSignal: 0`, which means insufficient data rather than a zero rate.

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

Mount this package as a Loader entry in the Web application, beside the cross-session query service.

```yaml
- name: '@deepseek-ai/dsh-effectiveness'
- name: '@deepseek-ai/dsh-effectiveness-query'
- name: '@deepseek-ai/dsh-api-effectiveness'
```

The `dsh-base` bundle mounts the query service and the human `/effectiveness` command; the `dsh-web-app` layer adds the session projection and this controller. Its generated `./typert` export carries the Host descriptors into the strict Typert registry, and its generated `./remote` export is the Client contribution that `dsh-api-remotes` mounts, which is what makes `ctx.remote.effectiveness` callable from the browser. The controller requires `ctx.effectiveness`; a composition without the query service fails to load rather than answering an empty report.

`query(filter?)` is the namespace's only method. An absent filter selects every readable session on the host; a present one narrows by `from` and `to`, which bound a session's contributing event time, by `sessions`, and by the `provider` and `model` a session's log named. The request is validated with a strict schema at the wire boundary, so an unknown key or a wrongly typed field raises `gateway/bad-request` with the codec's issues and never reaches the query service. No other failure is classified: a corpus read failure propagates unchanged, so a session-store fault stays visible as itself.

The answer is one set of plain copies, never a domain object. `totals` carries the corpus-wide signals plus the contributing session count; `routes` carries the same signals for each provider and model pair, with the sessions that used it; `sessions` carries one row per selected session, newest first, with the routes its log named; and `truncated` reports that the deployment's configured bound cut the session rows.

Each projection has three parts. `feedback` is the current human judgment of individual assistant messages — positive and negative counts plus a per-category breakdown that omits every category carrying no judgment. `changes` counts the accepted, reverted, and still-undecided decisions about the file changes the sessions applied. `verification` counts the commands whose task-report results passed, failed, or reported no outcome. The per-category keys are iterated from a `CATEGORIES` list on the wire side, so a rename on either side of the mapping is a compile error rather than a silently dropped count, and the same field-by-field mapping means a domain rename is a compile error here rather than a silent wire change.

The reporting bound is not this package's: `maxSessionsReported` is a validated config field of [`dsh-effectiveness-query`](../../feedback/effectiveness-query/README.md), and this controller holds no configuration at all. A truncated answer therefore tells a client that more sessions carry signals, not where to continue — the namespace has no offset or cursor, so a surface that must show every session needs a larger configured bound on the query service.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The controller is a projection, not an owner. It injects `ctx.effectiveness`, validates the one untrusted input at the wire boundary, calls the service, and maps its answer onto wire types. It holds no cache and no state, so two calls with one filter read the corpus twice and a feedback or change decision recorded between them is visible on the second call. The fold that produces a signal stays in the query service, so what a row counts cannot drift from the rules that record it.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `EffectivenessController`: the `@Remote` method, the filter schema, the category list, and the report-to-wire mappings |
| [`src/types.ts`](src/types.ts) | The wire types the Client consumes, including the feedback-category union |

### Service and namespace

`EffectivenessController extends TypertRemoteService` registers the service key `effectivenessController` and the wire namespace `effectiveness`, which is what a Client reaches as `ctx.remote.effectiveness`. Its `static inject = ['effectiveness']` names the only service it answers from; the Gateway discovers the namespace through `typertRemote`, so a Host composition without the gateway can still mount the controller. The service takes no `Config`.

### Methods

| Method | Request | Answer |
|---|---|---|
| `query` | `filter?`: `from`, `to`, `sessions`, `provider`, `model`, all optional | `EffectivenessReportWire`: corpus totals, per-route rows, per-session rows, and the truncation flag |

### Failures

| Code | Raised when |
|---|---|
| `gateway/bad-request` | The filter fails the strict wire schema; the details carry the codec issues |

### Wire values

| Type | Meaning |
|---|---|
| `EffectivenessFilterWire` | Selection one `query` call carries |
| `FeedbackCategoryWire` | The category union the feedback breakdown is keyed by |
| `EffectivenessFeedbackWire` | Current positive and negative judgments plus the per-category counts |
| `EffectivenessChangesWire` | Accepted, reverted, and undecided change-review decisions |
| `EffectivenessVerificationWire` | Passed, failed, and unknown verification outcomes |
| `EffectivenessProjectionWire` | One session's or route's signals plus its signal-carrying turn count |
| `EffectivenessTotalsWire` | The same signals corpus-wide, plus the contributing session count |
| `EffectivenessRouteRefWire` | One route named by a session's log |
| `EffectivenessRouteRowWire` | One route's signals plus the sessions that used it |
| `EffectivenessSessionRowWire` | One session's signals, its creation time, and the routes its log named |
| `EffectivenessReportWire` | One assembled answer |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the wire namespace to the fold behind it, then to the Remote model that carries the call.

- [feedback subsystem](../../../docs/subsystems/feedback.md) — the projection contract, the signal sources, and the outcome semantics behind every row.
- [feedback group map](../../feedback/README.md) — the projection unit, the cross-session query service, and the human `/effectiveness` command.
- [api group map](../README.md) — the other Remote namespaces and how they are assembled.
- [API Gateway reference](../../../docs/api-gateway.md) — the Typert programming model, generation pipeline, and runtime invocation.
- [Typert subsystem reference](../../../docs/subsystems/typert.md) — the contracts shared by protocol, Gateway, and consumer assemblies.

-----

<a id="model-experience"></a>
## Model Experience

### Nothing model-visible is added

#### What the model sees

Nothing. `effectiveness.query` answers a browser surface with counts about sessions that already ran; `ctx.remote.effectiveness` adds no prompt section, no tool schema, and no session event.

#### Token effect

None. The namespace never assembles or sends a provider request, so it cannot change what a model reads or how many tokens a request carries.

#### KV Cache effect

None. Reading outcome signals does not alter a request, so no cached prefix can be invalidated by it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what this namespace can answer today. They are current package constraints.

- **Reads only** — the namespace exposes no write or mutation; recording a rating, a change decision, or a task report happens through the packages that own those events.
- **No cache** — every call re-folds the selected sessions, so a wide corpus costs one log read per session and a client polls at its own expense rather than reading a materialized report.
- **No paging or cursor** — the per-session rows are cut at the query service's `maxSessionsReported` and the answer reports `truncated`; a client that needs the rest cannot ask for a later page.
- **`turnsWithSignal: 0` is not a rate** — it states that no outcome signal was recorded for that session or route yet, so a surface must render it as insufficient data rather than as zero quality.
- **Route rows can exceed the totals** — one session using several routes contributes to each of those rows, so summing the route rows of a signal can count that session more than once.
- **The corpus is host-wide** — an absent filter reads every session the host can read; narrowing to one workspace or one agent is not part of the contract.
- **No streaming or change feed** — the only method is unary, so a statistics page polls, and the freshness of a figure is the client's polling interval.
- **Mounted only where the Web bundle is** — a Host composition without this row has no `ctx.remote.effectiveness`, and the Client contribution in `dsh-api-remotes` is absent with it.
- **No client surface is shipped** — this package is the Host half of a statistics page; no `packages/client/ui-effectiveness` exists yet, so a consumer owns the presentation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The controller owns no durable state and no diverging observation of its own; it validates one request, maps one query answer, and classifies the one failure a caller can act on, and its spec pins each of those behaviors.
