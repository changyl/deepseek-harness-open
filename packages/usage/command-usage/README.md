---
description: "The human /usage command: token totals, per-route rows, and read-time cost across sessions, rendered in the UI without spending a model turn."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-usage

English | [中文](README.zh.md)

## Summary

Mount this package to give people a `/usage` command that reports token totals and cost across sessions without spending a model turn. `/usage` shows all time by default and accepts a `24h`, `7d`, or `30d` window plus a `provider/model` route. The rendered text carries session, turn, and step counts, the four token buckets, a cost line, and one row per route. Cost reads as unavailable when nothing in the selection is priced and as incomplete when some routes are not. It needs an interactive deployment with a command adapter.

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

Mount it in an interactive deployment that already mounts the usage service and a command adapter; `/usage` runs in the UI command plane and never spends a model turn.

### Composition

```yaml
- name: '@deepseek-ai/dsh-commands'
- name: '@deepseek-ai/dsh-usage'
- name: '@deepseek-ai/dsh-usage-ledger'
- name: '@deepseek-ai/dsh-command-usage'
```

A deployment with no command adapter surfaces no `/usage`, so headless and automation apps do not need this package. Registering the command is an effect of the mounting fiber, and unmounting the plugin removes it.

### Command grammar

| Input | Result |
|---|---|
| `/usage` | All time, every route |
| `/usage all` | The same as a bare `/usage` |
| `/usage 24h` | The last 24 hours |
| `/usage 7d` / `/usage 30d` | The last 7 or 30 days |
| `/usage <provider>/<model>` | All time, one route |
| `/usage 30d <provider>/<model>` | A window and a route together, in either order |

The command's own usage line advertises `24h`, `7d`, `30d`, and `all`; the parser accepts any positive `<n>h` or `<n>d`.

### What the report shows

| Output | Content |
|---|---|
| Heading | `Usage (all time)`, or `Usage (last <n>, since <ISO timestamp>)` for a window, with ` · <provider>/<model>` appended when a route is selected |
| Counts | Sessions, turns, and steps, plus `steps without usage` when any step reported no usage sample |
| Tokens | The four buckets: input, output, cache read, and cache write |
| Cost | The amount, or the unavailable and incomplete wording below |
| Routes | One row per route with its session, step, and bucket figures, then its own amount or `unpriced` |

A selection that observed nothing renders the heading and `No usage recorded for this selection.` Counts carry thousands separators.

### Cost wording

- When no route in the selection is priced, the line reads `Cost: unavailable — no route in this selection is priced.` — the amount is unavailable, never zero.
- When every contributing route is priced, the line reads `Cost: <currency> <amount> (pricing <version>)`.
- When only some routes are priced, the same line carries the suffix ` (incomplete — unpriced routes: <provider>/<model>, …)`.

Amounts print at full micro-unit precision: six decimals with trailing zeros trimmed, so one micro-unit stays visible and whole amounts print without padding.

### Failures and recovery

An unknown, repeated, or non-positive argument is refused with the offending token and the usage line, without querying the provider. A composition with no usage provider answers with `Usage statistics are unavailable in this composition: no usage provider is registered.` Any other provider failure propagates, so the adapter reports a command failure instead of a plausible report.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the text is produced; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The package owns exactly two things: a parser and a renderer. The parser turns the raw invocation into at most one window and at most one route, rejecting repeated or unrecognized tokens before any query runs, and the renderer turns one `UsageReport` into the fixed line layout above. Every figure comes from `ctx.usage.query(filter)`, so the command carries no accounting logic of its own and cannot disagree with a client reading the same report. A window becomes an inclusive `from` bound computed from the current clock; a route becomes the `provider` and `model` filter fields. A `UsageUnavailableError` is translated into one direct error message, while any other failure is rethrown so dispatch reports a command failure.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: argument grammar, window and route parsing, report rendering, the command handler |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the rendered text is not enough.

- [Usage subsystem](../../../docs/subsystems/usage.md) — the report, pricing, and provider contracts behind every printed figure.
- [Usage service package](../usage/README.md) — the service the command queries.
- [Usage ledger package](../usage-ledger/README.md) — the durable provider that supplies the corpus this command aggregates.
- [Usage pricing package](../usage-pricing/README.md) — the rate card that decides whether a cost line prints.
- [Human commands service](../../interaction/commands/README.md) — the registry the command registers into and the lifecycle events it appends.
- [Usage package map](../README.md) — the packages of this family and their repository position.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/usage` command

#### What the model sees

Nothing. The command registers a human handler in `ctx.commands` and returns a direct command result; the registry's log-only `command/run` and `command/done` lifecycle events are the only records it produces, and no part of the invocation, report, or error text enters a model request.

#### Token effect

Zero: the report is rendered from stored usage facts without assembling or sending a model request.

#### KV Cache effect

None: the command never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the command reports and how it can be used. They are current package constraints, not a task backlog.

- **It aggregates across every session the ledger holds** — this command has no per-session view; a route or window narrows the corpus, but the figures always span sessions.
- **It renders text only** — the result is a fixed multi-line string, with no interactive table, paging, or chart in any adapter.
- **It re-reads the corpus per invocation** — each `/usage` runs a fresh query, so repeated invocations re-fold sessions whose persistence revision moved.
- **A window selects whole sessions** — the `from` bound drops sessions whose events all precede it, but a session that overlaps the window still contributes all of its tokens.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns an argument parser and a text renderer, both total functions of their inputs, and it reads every figure from `ctx.usage.query()` instead of computing one itself. The relations it relies on — one report per query, priced and unpriced routes disjoint, and one `command/run`/`command/done` pair per invocation — are owned and runtime-checked by the usage service and the command registry, not here.
