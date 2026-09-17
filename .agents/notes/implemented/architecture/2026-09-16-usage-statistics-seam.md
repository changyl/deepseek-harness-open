# Agent Note: Report token usage and cost through one usage seam

Status: implemented

English | [中文](2026-09-16-usage-statistics-seam.zh.md)

## Problem

The harness already logged everything a cost report needs: every settled Assistant event carries provider-reported usage, and `request/context` records which provider and model served the request. What it did not have was a query surface. `sessionStats` counted turns, steps, and wall times for one session, `tokenUsage` exposed four token buckets for one session, and `session-telemetry` exported events to an external backend for reporting. A deployment that wanted to know what a week of work cost, which model spent the tokens, or which routes carry no rate card had to join those sources itself, and nothing in the product knew a price at all.

Two constraints shaped the problem. Prices are deployment data: the repository ships no rate card, currencies differ, and a deployment renegotiates rates without changing the harness. And a token fact must never be confused with a price: stored amounts go stale the moment a rate changes, while stored token counts stay true forever.

## Decision

One usage seam in six packages owns statement, answer, the human entry point, and the browser face together.

`@deepseek-ai/dsh-usage` is the Service Definition and query consumer. It owns `ctx.usage`, the report contract (`UsageFilter`, `UsageTotals`, `UsageRouteTotals`, `UsageReport`), the bucket and cost arithmetic, and two registrations: one usage provider and one pricing table. A duplicate registration of either throws. `query(filter)` asks the provider for token facts and joins them with the registered table.

`@deepseek-ai/dsh-usage-ledger` is the provider. It derives one record per session into the storage domain `usage` through `ctx.storageDomain`, folding `request/context` route changes, `step/end` steps, `assistant/message` and `assistant/attempt` usage samples, and `llm/retry-started` replacement slots. A record stores token facts, the observation times, and the persistence revision it folded; a query re-folds a session only when `sessionPersistence.stat()` reports a different revision, so a cold session costs one read and a live one costs one read per query until it settles. The canonical session log stays the only authority: deleting every derived record costs one re-fold.

`@deepseek-ai/dsh-usage-pricing` is the deployment's rate card. It registers the composed `Config` as the pricing table and, when a settings provider is mounted, re-reads the `usage-pricing` settings namespace on every commit. Rates are integer micro-units of one currency per million tokens, so totals are exact integers until the client formats them. Two routes naming the same provider and model in one table are refused at load, because the table cannot know which entry was meant.

`@deepseek-ai/dsh-api-usage` is the Remote face: a `TypertRemoteService` publishing `ctx.remote.usage` with one `query(filter?)` method. It maps the domain report onto plain wire values rather than handing the codec a domain object, validates the request at the wire boundary, and converts only the one domain failure a caller can act on into `usage/unavailable`; every other provider failure propagates unchanged.

`@deepseek-ai/dsh-command-usage` is the Consumer role: a global `/usage [<window>] [<provider>/<model>]` command that renders the same report without spending a model turn. It owns only its argument grammar and its text; amounts print at full micro-unit precision, an invalid argument is refused before any query, and a composition with no provider is reported as unavailable rather than empty.

`@deepseek-ai/dsh-client-ui-usage` is the browser consumer: one Web global panel over `ctx.remote.usage`, documented in [the usage panel note](2026-09-16-usage-settings-section.md). It reads the whole corpus on mount and on request, renders the totals, the per-route table, the unpriced list, and the cost notices, and holds no state beyond the read it is showing.

Three report semantics follow from those choices and are part of the contract:

- Cost is computed at read time from the current table and carries the table's `version`, so no report mixes an amount with a rate card that did not produce it.
- A route the table does not name is reported in `unpriced` and contributes no amount. When no route is priced, `cost` is absent rather than zero: a consumer that sees no cost reports it unavailable, never free. A settled message whose adapter reported no usage counts into `unknownUsageSteps` instead of into a zero bucket.
- `turns` is session-scoped; `steps`, `sessions`, and `unknownUsageSteps` are also reported per route. A route-selected query counts only sessions that used that route, while an unselected query counts every observed session even when it spent no tokens.

The `dsh-base` bundle mounts `usage`, `usage-ledger`, and `command-usage`, and deliberately mounts no pricing table: a rate card is deployment data, so every route stays reported unpriced until a composition adds `usage-pricing` with its own currency and rates.

## Alternatives considered

**Store cost facts beside the token facts.** The fold could have multiplied each sample by the rate in effect when it was observed and stored micro-units in the record. This makes every historical report a contest between two authorities: the stored amount and the current table. A rate correction would then require rewriting durable records rather than changing one answer, and a record restored from an old cache would report prices the deployment no longer charges. Deriving amounts at read time keeps the record a token fact and the price a deployment fact.

**Declare rates on the LLM route.** `LlmModel` already carries `contextWindow`, and `LlmImageRequestPricing` shows route-owned pricing is an accepted pattern, so monetary rates could have joined the model catalog. That widens a pre-stable public type every provider adapter consumes, and it conflates two different facts: a route's requests have visual-token prices whether or not the deployment pays money for them. Rates that a user edits at runtime belong behind the settings surface, not inside a catalog snapshot.

**Fold the corpus on every query without a derived store.** The provider could have read every session log per query. That is simpler and has one fewer durable surface, but a statistics page polls, and each poll would re-read and re-fold the entire corpus. Keeping the fold behind a revision check makes the common query proportional to what changed.

**Build the aggregate as a second SQLite index.** `session-query-sqlite` is the precedent for a derived database with an `openAt` policy. It exists to answer ranked full-text search, which a KV domain cannot; usage totals are small per-session records that the domain form already stores durably with schema validation and change events. A second database would add a schema, a rebuild policy, and a lifecycle for data whose access pattern is per-session point reads.

**Extend `sessionStats` with a cost field.** `sessionStats` folds log structure — step boundaries and wall times — and knows nothing about routes or deployment configuration. Adding a price to it would either import deployment config into a structural fold or leave the cost unknown to the client that renders the statistics strip.

## Consequences

The seam buys a report that can never silently charge the wrong rate, a cache that is always safe to delete, and a provider that can be replaced without touching the report contract. It costs the deployment an explicit rate card before any cost appears, and it leaves live sessions re-folded per query because their persistence revision keeps moving.

The reported window is session-granular: `from` and `to` select whole sessions by their event span rather than slicing events, because the record aggregates per session. Filtering by workspace is not implemented yet; the session header carries `cwd`, and no session-to-workspace reverse index exists to match a workspace id.

## Testing

The fold is tested against hand-built event logs for route attribution, replacement, retry, unknown-usage counting, and failed attempts that report no usage. Aggregation is tested for bucket sums, distinct-session counting, route selection, and the observed-but-tokenless session rule. The provider is tested with stub collaborators for the revision-hit, revision-moved, and no-revision paths. A real composition mounts the storage hub, the JSON backend, the domain form, the usage service, and the ledger with an in-memory persistence probe, proving plugin registration, the query path, provider removal on disposal, and the `rebuildOnMount` drop. The command is tested through the real command registry for its grammar, rendered report, filter construction, unavailable composition, and disposal, and every package carries per-file 100% coverage.
