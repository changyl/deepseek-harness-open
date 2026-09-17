# Agent Note: Publish cross-session outcome signals as a Remote namespace

Status: implemented

English | [中文](2026-09-16-effectiveness-remote-namespace.zh.md)

## Problem

The cross-session outcome report was reachable from one place inside one process. [`@deepseek-ai/dsh-effectiveness-query`](../../../../packages/feedback/effectiveness-query/README.md) folds the selected corpus and answers `ctx.effectiveness.query(filter)`, and the in-process `/effectiveness` command in [`dsh-command-effectiveness`](../../../../packages/feedback/command-effectiveness/README.md) renders that answer as text. The per-session projection is client-visible, but the corpus-level report — the question an operator actually asks about a deployment — had no browser-callable surface, so reading it meant running a command and reading a session transcript.

Nothing blocked the work except the missing seam. The query service already served a detached report of plain domain values, the Remote assembly already mounted one namespace per business capability, and [`@deepseek-ai/dsh-api-usage`](../../../../packages/api/usage/README.md) had established the shape a read-only projection of a query service takes: validate one request at the wire boundary, map one answer onto plain values, hold no cache.

## Decision

`@deepseek-ai/dsh-api-effectiveness` owns the Host Remote namespace `effectiveness`: `EffectivenessController` registers under the service key `effectivenessController` with the wire namespace `effectiveness`, injects only `['effectiveness']`, and publishes one read method, `query(filter?)`, answering corpus totals, per-route rows, and per-session rows.

The controller is a projection, not an owner. Corpus selection, the per-session fold, the route attribution, and the reporting bound all stay in `ctx.effectiveness`; the controller validates the request, calls the service, and copies what it returns field by field. It holds no cache, so a client always reads the corpus' current state, and the fold's definitions of a signal, an undecided change, and an insufficient sample are inherited rather than restated — [the effectiveness projection note](2026-09-16-effectiveness-projection.md) owns that rationale.

Four properties make the wire face safe and stable:

- **The untrusted input is validated at the wire boundary.** A strict zod schema accepts `from`, `to`, `sessions`, `provider`, and `model` and nothing else; a malformed payload raises `gateway/bad-request` with the codec issues and never reaches the query service. It is the only classification the controller makes: a corpus read failure propagates unchanged, because a session-store fault is not something a caller acts on differently from any other read failure.
- **The wire values are plain and self-contained.** The feedback, changes, verification, projection, totals, route, session, and report types live in `src/types.ts`, so the Typert generator receives types it can encode without linking the query service, and a domain rename is a compile error at the mapper rather than a silent wire change.
- **The feedback-category union is drift-protected by iteration.** `CATEGORIES` lists every category the wire declares and the mapper iterates that list, reading the domain's own counts. A category renamed on either side stops compiling instead of dropping out of the breakdown, and a category carrying no judgment is omitted rather than sent as zero.
- **The bound is not the controller's.** `maxSessionsReported` is a validated config field of the query service, so the controller accepts no `Config` at all and `truncated` describes the cut the service made. A deployment sizes the answer where the corpus read happens rather than in a second place that could disagree.

The controller is read-only. Recording a rating, a change decision, or a task report happens through the packages that own those events, and a browser write surface would need its own authority decision — who may rate a message, and how a refusal is presented — which this change deliberately does not make.

Registration is what makes the namespace reachable, and each surface is explicit: the package manifest's generated `./typert` and `./remote` exports, `packages/api/remotes` (the client import, the type re-export, the `$mount` entry, and the three manifest sections), the `dsh-web-app` bundle (the `effectiveness-controller` Cordis row and the dependency), `tsconfig.base.json` and `tsconfig.host.json` (the aliases are hand-written because the directory name `effectiveness` does not match the package suffix `api-effectiveness`, so `gen-tsconfig-paths` cannot own them), and the catalog scripts (`SERVICE_PAGE` and `linkedTypePages` in `scripts/gen-cordis-catalog.ts`, `SERVICE_ROLES` in `scripts/gen-doc-graphs.ts`).

## Alternatives considered

**Extend the existing `effectiveness` projection entry instead of adding a namespace.** The projection is per-session state the browser already reads through the session projection registry, and it is keyed by the session being viewed. The cross-session report is not session state: it is a corpus read whose cost and bounds belong to a query, not to a session's projection, and folding it into the projection would have made every session carry a host-wide number.

**Add the corpus query to the usage namespace.** Both answer deployment-wide figures, but they read different seams and obey different bounds, and a combined namespace would have made one package depend on the other's service for a call that does not use it. One namespace per query service is the rule the Remote assembly already follows.

**Derive the wire types from the domain report.** Re-exporting `EffectivenessReport` and its projection would put domain-only types in front of the codec and move the wire contract whenever the domain moves. The usage and project Remote faces made the same call for the same reason: a plain copy is where a rename becomes a compile error instead of a silent wire change.

**Classify a missing query service as its own failure code.** The usage namespace answers `usage/unavailable` because a composition may mount the service without a provider, and the absence is a run-time state a client must handle. Here the controller injects `ctx.effectiveness` itself: a composition without the query service never loads the controller, so there is no run-time absence to classify.

**Cache the report.** The query service reads canonical logs on demand, and a cache would need an invalidation source for every signal producer — feedback, change review, and task reports all append to logs the controller never sees. The controller stays stateless and the answer stays current.

## Consequences

The outcome report now has a browser-callable surface under the same wire rules as every other namespace: a validated request, plain values, an answer bounded where the whole answer is known, and one failure a client can act on. A statistics surface can be built without touching the query service or the command, and both existing consumers keep working unchanged because the query service's contract did not move.

The cost is that the namespace currently has no in-repo consumer: `packages/client/ui-effectiveness` does not exist, so nothing in the shipped Web bundle calls `ctx.remote.effectiveness` yet. The registration surfaces therefore mount a namespace ahead of its client, which is why they are enumerated above rather than discovered by a caller.

The report keeps its corpus semantics on the wire. Route rows can sum above the totals because a session using several routes contributes to each, `turnsWithSignal: 0` means insufficient data rather than a zero rate, and `truncated` distinguishes "no more sessions carry signals" from "the service's bound was reached" — all three are inherited from the fold and none is smoothed over by the mapping.

## Deferred

A client package for the report (`packages/client/ui-effectiveness`) is not implemented, so the namespace ships without a browser caller. A recorded-session snapshot for the namespace is not included either: recording needs a model key, and `evals/baseline.json` and the recorded snapshots stay untouched for that reason. No `./invariant` companion is published, because the controller owns no durable state and no relation that independent observations could diverge on — it copies what the query service serves, and the projection's own invariant companion owns the signal relations.

## Testing

Seven cases over a provided query service: the published method and its service key, a mapping with an empty category breakdown and a truncated flag, one that carries every named category and each route and session field, an absent filter passed as the whole corpus beside a fully specified one, a malformed filter refused at the wire boundary without reaching the service, a corpus read failure propagated unchanged, and the malformed request classified with its codec issues. `src/index.ts` carries per-file 100% coverage.

The build emitted both Typert faces and the remote client for the package, and the catalog generators were re-run so the namespace and its wire types are classified: `gen-cordis-catalog` records the service page and the two linked types, `gen-doc-graphs` records the service role, and `gen-config-catalog` and `gen-module-graph` report their artifacts current.
