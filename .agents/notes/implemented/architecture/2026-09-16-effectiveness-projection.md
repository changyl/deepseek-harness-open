# Agent Note: Read session outcomes as an effectiveness projection

Status: implemented

English | [中文](2026-09-16-effectiveness-projection.zh.md)

## Problem

Three packages already append outcome signals to a session log. `dsh-message-feedback` records a human's current positive or negative judgment of individual assistant messages, `dsh-change-review` records whether a reader accepted or reverted an applied file change, and `dsh-task-report` records the verification commands a closed turn ran and how they ended. Nothing joined them. A reader asking whether a session went well had to walk the log, re-implement the replacement rules each producer already owns, and reconcile three different shapes.

The signals also invite a specific mistake. A reader who sees two negative ratings out of three turns is one step from calling that a model quality score, when it is a small sample of human judgment about one session. A surface that presents the number must not imply more than the log supports.

## Decision

`@deepseek-ai/dsh-effectiveness` registers the client-visible `effectiveness` projection unit, folding only events other packages already append.

The unit reads `assistant/message` for message-to-turn identity, `feedback/message-put` and `feedback/message-delete` for current judgments, `change/review` for decisions, `tool/result` hunks through `recordedHunks` for the applied changes, and `task-report/generated` for verification outcomes. It appends no event, adds no prompt, and offers no tool.

Four semantics are part of the value it serves:

- **Current, not historical.** A feedback event carries the complete current value for one message, so a re-rated message counts once under its latest rating; a change decided twice counts once under its latest decision.
- **`undecided` means recorded and not decided.** The unit keys applied changes by `(tool/result seq, path)` and subtracts the keys a `change/review` decision names. Applied changes come from the `tool/result` hunks themselves, so the count is right whether or not `dsh-change-review` is mounted.
- **`turnsWithSignal` bounds the sample.** It counts distinct turns carrying any signal: a message that turn produced and someone rated, a change decision for that turn, or that turn's own task report. A rating for a message the log never produced counts in the rating totals and invents no turn.
- **Zero means insufficient data.** A consumer reports that the session carries no signal rather than a zero rate, because a rate over no observations is not zero — it is absent.

The package is mounted by the `dsh-web-app` bundle and not by `dsh-base`: its value is client-visible, and the compositions that render it are the ones that mount it.

`@deepseek-ai/dsh-effectiveness-query` is the corpus-level consumer of that same fold, and `@deepseek-ai/dsh-command-effectiveness` is the human entry point: `ctx.effectiveness.query(filter)` folds every selected session through the unit and attributes each session's outcomes to the routes its log named, and `/effectiveness [<window>] [<provider>/<model>]` renders the report without a model turn. The query reads canonical logs on demand and caches nothing, so a report is the corpus' current state and a large corpus costs a full re-read; a session that used several routes contributes its whole projection to each of them, which is why route rows may sum above the totals.

## Alternatives considered

**Read the signals through a query service over the session corpus.** This is the shape that eventually shipped, in `@deepseek-ai/dsh-effectiveness-query`, but not at the same time or in the same package. The per-session unit came first because the fold, the replacement rules, and the definition of a signal had to be agreed before a corpus read could be written against them; the query service reuses that unit's fold rather than restating it. A Remote surface over the report now exists: [`@deepseek-ai/dsh-api-effectiveness`](../../../../packages/api/effectiveness/README.md) publishes the corpus report as the `effectiveness` namespace, recorded in [the effectiveness Remote namespace note](2026-09-16-effectiveness-remote-namespace.md).

**Keep a durable derived ledger, as the usage seam does.** A ledger earns its domain when a query must answer for sessions the process has not opened, and when the fold is expensive enough to cache. These signals are per-session, small, and already reach the client through the projection seam, whose registry drives every unit over committed events. A second durable surface would add a rebuild policy for data no consumer currently reads cold.

**Read `dsh-change-review`'s own state instead of folding the log.** A projection cannot read another projection: units are independent folds over the same log, which is exactly what keeps the registry's change feed consistent. Reaching into the change-review service would also make the count depend on that plugin being mounted, and would put a host service call inside a synchronous fold. Folding the same `tool/result` payloads through the same exported validator keeps one owner for the recorded-hunk format.

**Serve a rate instead of counts.** A single `positive / total` number is easier to display and easier to overread. The counts are what the log supports; a rate is derivable by any consumer that also decides what the denominator means for its own question.

## Consequences

The unit gives a session a truthful, current summary of the outcomes its log already carries, and it costs one fold over events the registry drives anyway. `@deepseek-ai/dsh-effectiveness-query` answers the corpus-level question on top of the same fold, attributing each session's outcomes to the routes its log named; it reads canonical logs on demand and caches nothing, so a report is always the corpus' current state. It also fixes the vocabulary early: anything that later aggregates these counts inherits the same definitions of a signal, an undecided change, and an insufficient sample.

The limits are real. The unit is per-session and mounted only where a composition asks for it, so a client in another composition sees no `effectiveness` key at all — the projection table is process-wide, so a client reads the value rather than testing for the key. Verification counts exist only where `dsh-task-report` runs. A rating cast on a message outside the session cannot name its turn. And the metric is a description of outcomes, never a model score; the package README states that in the same terms.

## Testing

The fold is tested directly against synthetic logs for re-rating, deletion, a rated message the log never produced, a change decided twice, an undecided remainder after a decision, repeated and hunk-less tool results, and verification totals across reports. A registry-driven test proves the unit serves the empty value without the plugin, the folded value with it, and disappears when the plugin unloads. The package carries per-file 100% coverage.
