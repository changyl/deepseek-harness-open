---
description: "Reader decisions about applied file changes — accept a change, or revert the file to its pre-change content — for users and maintainers of the Web GUI's change review."
kind: "package-reference"
---

# @deepseek-ai/dsh-change-review

English | [中文](README.zh.md)

## Summary

`dsh-change-review` records what a reader decided about a file change a tool already applied, and carries out a revert. `accepted` keeps the change; `reverted` restores the file's content from before it and records that too. Both decisions are durable session events, so a reload or a fork reconstructs them. The route rides Connection's authentication fence, and a request names changes by `tool/result` seq and path only: every byte written is re-derived from the session log, so a client cannot ask it to write text of its own choosing. A file changed since the recorded change is refused, not guessed at.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin where the Web client can reach it; the shipped `dsh-web-app` bundle does. The browser posts one JSON body to `/api/change.review`:

```json
{ "sessionId": "…", "action": "reverted", "changes": [{ "seq": 41, "path": "src/app.ts" }] }
```

`action` is `accepted` or `reverted`, and `changes` lists at most 64 identities. `200` answers `{ results }` with one status per change. `409` refuses the whole request with the reason and leaves every file as it was, because every recorded hunk is verified against the file before anything is written.

### What a revert needs

A revert undoes the hunks the `tool/result` recorded in its metadata. A result that recorded no hunk for the path — a create, or a change whose metadata was malformed — cannot be reverted and is refused. So is a file whose content no longer holds what the recorded change produced: rewriting it would change the wrong lines.

<a id="understand-the-implementation"></a>
## Understand the implementation

`revertText` is the pure half. It places each hunk at its recorded `newStart`, or — for a payload written before producers named the line — at the one place the file holds that hunk's text, verifies the produced lines, and splices the pre-change lines back from the last hunk to the first. Every hunk is placed before anything is spliced, so one bad hunk fails the request without touching the file.

The route reads the recorded change through `ctx.sessionQuery.readEvent`, resolves the path against that Session's own cwd, and writes through `ctx.fs.writeText` with `replaceIfVersion` against the version it just read, so a concurrent write loses the race instead of being overwritten. The decision is appended to the attached Session as `change/review`; an unattached Session is refused rather than silently unrecorded.

## Model Experience

### Reader decisions

#### What the model sees

Nothing from this plugin directly. [`dsh-change-review-context`](../../context/change-review-context/README.md) turns the decisions recorded since its own last message into one request message:

##### Review note

```markdown
The user reviewed file changes you applied:
- Reverted: `src/app.ts` (turn 4) — the file is back to its content from before that change; re-read it before editing it again.
- Kept: `src/util.ts` (turn 4).
```

#### Token effect

One short message per batch of decisions, and only while decisions remain unreported.

#### KV Cache effect

Append-only; the note joins the request history after the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Creates are not reverted** — a create records no hunks, so removing the created file is refused rather than performed.
- **The Session must be attached** — a decision is appended to a live Session; a cold one is refused with `409`.
- **A decision is not a review workflow** — there is no per-hunk selection, no diff against the working tree, and no attribution of who decided.
- **Reverting across a later change to the same file** is refused rather than replayed; only the changes a request names, in the order given, are undone.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns no runtime-checkable relation that independent observations could diverge on; its contracts are its exported types and the Session events it records, which its specs pin.
