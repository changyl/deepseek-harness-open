---
description: "One request-context message telling the model which applied file changes the reader accepted or reverted, for users and maintainers of the change-review loop."
kind: "package-reference"
---

# @deepseek-ai/dsh-change-review-context

English | [中文](README.zh.md)

## Summary

`dsh-change-review-context` tells the model what the reader decided about changes it already applied. A revert happens between turns, so without this note the model keeps reasoning from content its change no longer produced. The decisions are durable `change/review` events recorded by [`dsh-change-review`](../../fs/change-review/README.md); this plugin renders the ones recorded since its own last message into a single request message, so each decision is reported exactly once and a reload or a fork reconstructs the same note.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside `dsh-change-review` in any composition where the reader can decide on a change; the shipped `dsh-web-app` bundle mounts both. It needs no configuration, adds no prompt section and no tool, and injects nothing while no decision is unreported.

The note lists each change with the reader's decision, oldest first, and caps the list at twelve entries with a remainder line. A change that was decided twice is reported once, with its last decision.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin registers one `agent/pre-step` listener. After the step's own decision resolves, it walks the session log backwards collecting `change/review` events, stopping at this plugin's own last message — which is what makes each decision reported exactly once — and at a `session/end-seed` boundary, which keeps a fork from re-reporting its parent's reviews. A typed user message does not end the window, so a reader who reverts and then types still reaches the model in one note.

The injected message carries `source.kind === 'plugin'` and this plugin's name, the same shape `dsh-time-context` uses, so the walk can recognize its own output.

## Model Experience

### Reader decisions

#### What the model sees

One user-role message appended to the request, or nothing when every decision has already been reported:

##### Review note

```markdown
The user reviewed file changes you applied:
- Reverted: `src/app.ts` (turn 4) — the file is back to its content from before that change; re-read it before editing it again.
- Kept: `src/util.ts` (turn 4).
```

#### Token effect

One short message per batch of decisions; a batch larger than twelve entries ends with a remainder line instead of growing without bound.

#### KV Cache effect

Append-only; the note joins the request history after the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Decisions are reported, not enforced** — the note tells the model a file moved back; the filesystem observation policy is still what makes a stale edit fail.
- **No per-turn digest** — the note lists changes; it does not summarize how much of a turn survived review.
- **A declined change is not a correction** — the model is not told what to do instead, only what the file now contains.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
