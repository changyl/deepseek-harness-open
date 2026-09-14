---
description: "The agent-definition provider registry for users and maintainers choosing, configuring, or debugging how specialized child-agent definitions from any source are merged, resolved, and loaded."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-definitions

English | [中文](README.zh.md)

## Summary

Use this package to give a composition one catalog of specialized child-agent definitions collected from project files, plugins, or remote services. It merges every provider's definitions, resolves duplicate names predictably, validates each candidate, and loads the winning definition's persona and narrowing fields on demand. Mount it when definitions should come from more than one source, or from something other than the local filesystem; pair it with `dsh-agent-definitions-filesystem` for file-authored definitions and `dsh-tool-subagent` for model access, because this package ships no definitions itself.

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

Mount the plugin to give a composition one agent-definition registry. Definition sources (providers) and consumers (the model-facing delegation tool, or your own code) all reach it through `ctx.agentDefinitions`; a lookup merges everything every provider reports for the current workspace and viewing scope.

### When to choose it

Use `dsh-agent-definitions` when specialized child-agent definitions should come from more than one source through one interface, or when their source is not the local filesystem. Avoid it when no composition needs specialized child agents: the plugin adds a service and a per-lookup discovery cost. The shipped local provider (`dsh-agent-definitions-filesystem`) and the model-facing consumer (`dsh-tool-subagent`) are separate packages; mount them alongside when a deployment wants file-authored definitions and model access.

### Mount and configure

The plugin is a Cordis service and accepts no configuration; registering a provider needs nothing beyond the service.

```yaml
- name: '@deepseek-ai/dsh-agent-definitions'
```

### What the registry gives you

- **One merged catalog.** A consumer asks for the definitions visible to a workspace and viewing scope and receives every winning summary, sorted by name, with no provider-specific ordering or deduplication to do.
- **Full definition on demand.** `get(name, options)` returns the winning definition including its persona prose, re-validating the provider's response before returning it.
- **Complete-or-partial observation.** `snapshot(options)` returns the summaries plus a `complete` flag that is `false` while any provider reported an incomplete source listing, so a consumer can keep its last-good state instead of presenting a transient failure as removal.
- **Provider registration.** A provider plugin registers synchronously during its `apply()` through `registerProvider(create)`, into the calling context's scope layer; the call returns the Cordis effect disposer that unregisters it, and duplicate provider names within one layer throw.
- **Change notification.** A provider can call its registration-scoped `invalidate()` while that exact registration is active; the registry then emits `agent-definitions/change`, an unfiltered notification whose listeners refetch with their own lookup options.

A registration files into the layer of its calling context's scope: host rows and repository plugins land in the global layer, while a plugin mounted by an agent preset's standing composition lands in that preset's layer. A read merges the global layer with the viewing scope's chain, and the nearest layer wins a duplicate name outright.

| Duplicate within one layer | Decided by |
|---|---|
| First | Lowest numeric `rank` |
| Second | Provider registration order |
| Third | The provider's own list order |
| Log | Every later duplicate is ignored with a warning naming its source |

### Validation rules

A provider's `list()` must return either an array of candidates or a `{ definitions, complete }` observation. Every candidate is validated before it can win:

- `name` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `description`, `provider`, and `source` are non-empty strings.
- `rank` is an integer.
- `tools`, when present, is a non-empty array of non-empty tool names.
- `model` and `reasoningEffort`, when present, are non-empty strings, and `maxDepth`, when present, is a non-negative integer.
- A loaded definition repeats those fields and adds non-empty `instructions`, and its `name` must still equal the candidate name selected during the same read.

A definition only narrows a child. `tools` replaces the child's inherited tool set with the named allow-list, and an omitted field inherits what the child would otherwise receive, so no definition can grant a tool the spawning agent lacks.

### Observable success and failures

A definition any provider reports appears in the merged catalog, and `get()` by its exact kebab-case name returns the full definition; an invalid or unknown name returns `undefined` instead of throwing. A provider whose `list()` throws is logged and skipped, and that read's observation becomes incomplete; an explicit incomplete observation still contributes the candidates it did return. A malformed candidate or observation fails the read instead of being silently skipped. `agent-definitions/change` is emitted on every provider registration, disposal, and `invalidate()`, and a listener that throws or rejects is logged without affecting the registry mutation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the registry collects, merges, and loads provider catalogs; the observable behavior is covered in [Use this package](#use-this-package).

### Design concept

The package is built on one separation: the registry owns layer merging, duplicate resolution, and validation, while providers own where definitions come from. A provider is a borrowed same-process object with a `list()` that returns candidates and a `get()` that loads one full definition; the registry never inspects definition content beyond validating its fields.

Registrations are layered per scope through `@deepseek-ai/dsh-scope`, the arrangement the tools registry established. Each layer keeps its own provider table, and a read walks the global layer first and then the viewing scope's chain from the farthest ancestor to the exact scope.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service class, provider registration, layered collection, candidate and definition validation, change notification |
| — | No runtime invariant companion is published; the registry validates every provider observation inside the read that consumes it, so no second conflicting observation exists to cross-check. |

### Catalog collection

Inside each layer, providers are awaited one at a time; a rejection is logged, marks the read incomplete, and continues with the next provider. Candidates are validated, sorted, deduplicated first-wins within the layer, and then written into the merged map, where a nearer layer replaces a farther entry of the same name. Summaries drop the provider-owned locator and rank and sort by name code points.

### Loading and staleness

`get()` rejects a name that fails the kebab-case grammar before any provider work, re-collects the catalog, and passes the winning candidate's opaque locator back to its owning provider. Definitions are never cached: every load asks the provider for the current body, and a definition whose `name` no longer matches the selected candidate returns `undefined` rather than a mismatched body.

### Cancellation and invalidation

`options.signal` is checked before collection, around each provider await, and after collection; an abort rejects the read with the signal's reason, while a provider that throws after an abort propagates the abort instead of being skipped. Provider disposal aborts the registration-scoped lifecycle signal and emits the change event. Listener failures are contained with a warning, so no observer can veto a registry mutation.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the registry contract to the shipped provider, the model-facing consumer, and the scope mechanism behind layer merging.

- [agent-definitions-filesystem package](../agent-definitions-filesystem/README.md) — the shipped provider that discovers definitions in project, custom, and user roots.
- [tool-subagent package](../tool-subagent/README.md) — the consumer that publishes the available-subagent catalog and resolves `agent_type`.
- [subagent package](../subagent/README.md) — where a selected definition's persona, tool allow-list, and depth cap reach the child.
- [Subagent subsystem reference](../../../docs/subsystems/subagent.md) — the delegation service these definitions configure.
- [Scope package](../../core/scope/README.md) — the layered registration and scope-chain mechanism the registry reuses.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-subagent`, which renders the winning definition summaries into a durable available-subagents catalog message and applies a selected definition's persona and narrowing fields to the child it starts.

#### KV Cache effect

No direct prompt effect. The named consumer owns the durable catalog message: an unchanged rendered list publishes nothing, and a changed list appends a replacement after the existing request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the registry is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **No runtime definition registration** — a definition exists only through a registered provider, so a one-off in-memory definition needs a provider that serves it rather than a direct registry call.
- **Every read re-lists every provider** — the registry keeps no cache and offers no watch or TTL, so each read pays every provider's discovery cost and a mutable provider must call `invalidate()` before consumers can notice a change.
- **A definition can only narrow a child** — `tools`, `model`, `reasoningEffort`, and `maxDepth` restrict the composition the child would otherwise inherit; no field grants a capability the spawning agent lacks.
- **The selected definition name is not persisted** — only its resolved effects reach the child, so a later registry change affects new delegations and cannot be attributed back to the definition an earlier session used.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the code. An open question is whether the registry should cache completed provider catalogs or expose per-provider diagnostics for failed providers, or whether consumers should own that state; the no-cache limitation and the `complete` flag record the current answer.

</details>
