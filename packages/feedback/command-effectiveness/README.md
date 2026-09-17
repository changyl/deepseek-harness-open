---
description: "The human /effectiveness command: cross-session outcome signals — feedback, change decisions, and verification — rendered per route without spending a model turn."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-effectiveness

English | [中文](README.zh.md)

## Summary

Mount this package to give people an `/effectiveness` command that reports what the session corpus says about outcomes without spending a model turn. `/effectiveness` shows all time by default and accepts a `24h`, `7d`, or `30d` window plus a `provider/model` route. The rendered text carries the session count, the turns carrying a signal, a feedback line with its category counts, a change-decision line, a verification line, and one row per route. It needs an interactive deployment with a command adapter and the `ctx.effectiveness` query service.

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

Mount it in an interactive deployment that already mounts the effectiveness query and a command adapter; `/effectiveness` runs in the UI command plane and never spends a model turn. The `dsh-base` bundle mounts this package and `@deepseek-ai/dsh-effectiveness-query` together, so every shipped composition serves the command.

### Composition

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence'
- name: '@deepseek-ai/dsh-session-query'
- name: '@deepseek-ai/dsh-effectiveness-query'
- name: '@deepseek-ai/dsh-command-effectiveness'
```

A deployment with no command adapter surfaces no `/effectiveness`, so headless and automation apps do not need this package. Registering the command is an effect of the mounting fiber, and unmounting the plugin removes it. Without `ctx.effectiveness` the fiber stays pending and no command registers.

### Command grammar

| Input | Result |
|---|---|
| `/effectiveness` | All time, every route |
| `/effectiveness all` | The same as a bare `/effectiveness` |
| `/effectiveness 24h` | Sessions whose events fall in the last 24 hours |
| `/effectiveness 7d` / `/effectiveness 30d` | The last 7 or 30 days |
| `/effectiveness <provider>/<model>` | All time, one route |
| `/effectiveness 30d <provider>/<model>` | A window and a route together, in either order |

The command's own usage line advertises `24h`, `7d`, `30d`, and `all`; the parser accepts any positive `<n>h` or `<n>d`. `all` written before a window is a no-op, naming a second window (`7d 8d`, `7d all`) or a second route is refused, and `0h` is refused as an impossible window. An unknown token is refused before any query runs.

### What the report shows

| Output | Content |
|---|---|
| Heading | `Effectiveness (all time)`, or `Effectiveness (last <n>, since <ISO timestamp>)` for a window, with ` · <provider>/<model>` appended when a route is selected |
| Sessions | The session count and the turns carrying at least one signal |
| Feedback | Current positive and negative judgments, plus the category counts — `none` when no judgment was filed under a category |
| Changes | Change-review decisions as accepted, reverted, and undecided |
| Verification | Task-report outcomes as passed, failed, and unknown |
| Routes | One indented row per route: session count, feedback, change decisions, verification, and turns with signal |
| Truncation | `(Session rows were truncated; totals cover the whole selection.)` when the query bounded its per-session rows; the totals and route rows still cover everything |

A selection with no observed session renders `No session signal recorded for this selection.` under the heading, and the `Routes:` block is omitted when no route contributed.

### Failures and recovery

An unusable argument returns an error result carrying the usage line and never queries the service, so a typo cannot spend the corpus read. The command itself has no other failure mode: the query service answers an empty corpus with zero counts, and a composition without it never registers the command.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the shape behind the command; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The command is a thin adapter: it parses its own argument grammar, asks `ctx.effectiveness.query()` for the selected corpus, and renders the report as text. It holds no state, caches nothing, and computes no figure of its own, so the numbers a reader sees are exactly the ones the query service serves — the same definitions of a signal, of a re-decided change, and of an undecided applied change that the per-session projection uses.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Argument parser, text renderer, and command registration |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Effectiveness query package](../effectiveness-query/README.md) — the service that owns the figures and the corpus read.
- [Effectiveness projection package](../effectiveness/README.md) — the per-session unit whose fold the query reuses.
- [Feedback subsystem](../../../docs/subsystems/feedback.md) — the feedback events the report counts.
- [Commands subsystem](../../../docs/subsystems/commands.md) — the registry that admits the invocation and logs its lifecycle.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/effectiveness` command

#### What the model sees

Nothing. The command registers a human handler in `ctx.commands` and returns a direct command result; the registry's log-only `command/run` and `command/done` lifecycle events are the only records it produces, and no part of the invocation, report, or error text enters a model request.

#### Token effect

Zero: the report is rendered from the outcome signals the session logs already carry, without assembling or sending a model request.

#### KV Cache effect

None: the command never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the report can say and how it reaches a reader. They are current package constraints, not a task backlog.

- **Text only, with no paging or filtering beyond the arguments** — the whole report is rendered at once, and there is no interactive surface, no per-day breakdown, and no cost line.
- **Route rows may sum above the totals** — a session that used several routes contributes its whole projection to each of those rows, because the report has no per-turn route attribution.
- **Windows are session-granular** — `24h`, `7d`, and `30d` select whole sessions by their event-span overlap, so part of a selected session may fall outside the window.
- **The report is only as current as the logs it reads** — the query service caches nothing, so every invocation re-reads the selected corpus and a large corpus makes the command visibly slow.
- **The command exists only where the query service is composed** — an assembly without `ctx.effectiveness` serves no `/effectiveness` at all rather than an empty report.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns an argument parser and a text renderer, both total functions of their inputs, and it reads every figure from `ctx.effectiveness.query()` instead of computing one itself. The relations it relies on — one report per query, route rows derived from the session rows, and one `command/run`/`command/done` pair per invocation — are owned and runtime-checked by the query service and the command registry, not here.
