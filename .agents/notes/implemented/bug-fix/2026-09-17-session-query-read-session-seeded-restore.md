# Agent Note: readSession validates a seeded log through the restore contract

Status: implemented

English | [中文](2026-09-17-session-query-read-session-seeded-restore.zh.md)

## Problem

`SessionQueryEngine.readSession(id)` is the canonical-log reader for the statistics surfaces: the usage ledger re-folds a session through it, the effectiveness report folds the whole corpus through it, and a turn's task report reads its own session through it. It reconstructs the stored log through `Session.create` to reuse resume's replay validation, and `Session.create` runs in snapshot mode, whose seed contract is the inherited prefix alone: a seeded header requires `inheritedEventCount === seed.length` or the constructor throws "seeded session constructor seed must equal its inherited prefix".

The corpus supplies the complete stored log plus the cut derived from the tagged `session/end-seed {inherited: true}` marker — the marker's own seq, as the [end-seed log boundary](../architecture/2026-07-30-session-end-seed-log-boundary.md) defines it. The assertion therefore can never hold for a seeded session that wrote anything after its cut, and every subagent session does exactly that: the live child appends the marker at its cut and then its own events. On any deployment that has run a subagent, the first cold seeded session fails reconstruction and kills the whole aggregate query — `/usage`, the settings usage and effectiveness sections, and a subagent session's task report all fail with the same internal error, while the same sessions read fine through the observation path, which restores through `sessions.prepare` with the log's aliasing state instead.

Evidence on the machine this shipped from: of 74 stored logs, all 19 seeded logs fail the snapshot contract and all 55 unseeded logs read fine.

## Decision

`LogicalSession` carries the cold read's `eventState`, and `readSession` validates through `Session.fromRestore(id, events, header, inheritedEventCount, eventState)` — the restore contract the observation path already uses. Validation is unchanged (event envelopes, contiguous seqs, surface transitions, header fields); what changes is that the seed is judged as the complete log plus its inherited cut rather than a create-time prefix, which is what a stored log is. `load()` clones every event before handing them over, so the logical session's aliasing state is `detached` on both the live-snapshot and the persisted path.

## Alternatives considered

**Slice the seed to the inherited cut in `readSession`.** The seed-prefix contract would then hold. Rejected: the fold consumers need the whole log, so slicing would silently drop every post-cut event from usage and effectiveness reports, and the returned snapshot would no longer match the stored log.

**Relax the snapshot-mode assertion in `Session`.** Rejected: the create-time contract is correct for its own callers — a fork or replay seed must be the prefix the new lifecycle inherits — and core tests pin it. The defect was the query engine using the wrong constructor for a stored log.

**Fold the stored events without reconstructing a Session.** The replay validation exists to refuse a log no live session could restore; losing it would turn stored corruption into silently wrong statistics.

## Consequences

Seeded stored sessions read back whole through `readSession`, so usage and effectiveness reports fold the complete corpus again, and a subagent session's task report can read its own log. Unseeded sessions take the same path with a zero cut and behave identically. No event vocabulary, header field, or wire format changed, so recorded-session snapshots do not move.

Coverage: [the session-query spec](../../../../packages/session-query/session-query/tests/session-query.spec.ts) pins the seeded-with-live-events read — the cut, the marker, and the post-cut events — and keeps the corrupt-seed rejection and the unseeded detached-log contract; the corpus fake now derives the inherited cut from the stored log's tagged marker the way the real backend scan does.
