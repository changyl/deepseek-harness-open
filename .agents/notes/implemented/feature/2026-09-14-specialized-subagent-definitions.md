# Agent Note: Specialized subagent definitions

Status: implemented

English | [中文](2026-09-14-specialized-subagent-definitions.zh.md)

## Problem

Delegation composed the same child for every task. A `subagent` call could choose a background mode and, when the Session authorized it, a child LLM route, but the child's persona, tool filter, and depth cap came from the mounted tool instance and applied to every delegation that instance served. Nothing let a deployment or a user describe a reusable specialist — a migration reviewer, a test author — once and let the model pick it per task.

The available workarounds each failed structurally. One `@deepseek-ai/dsh-tool-subagent` instance per specialist multiplies the tool schema the parent pays on every request and cannot hold the tool-name list stable, and an agent preset composes a whole child composition, so it grants the capabilities of the plugins it selects and changes how a child joins its parent's composition.

## Decision

Specialists are now authored data with their own capability seam. [`@deepseek-ai/dsh-agent-definitions`](../../../../packages/subagent/agent-definitions/README.md) is the Service Definition: a layered provider registry on `ctx.agentDefinitions` that merges provider catalogs, resolves duplicate names, validates every candidate, and loads the winning definition. [`@deepseek-ai/dsh-agent-definitions-filesystem`](../../../../packages/subagent/agent-definitions-filesystem/README.md) is the Service Provider: it discovers flat Markdown files in project, custom, and user roots and parses their YAML frontmatter and persona body. [`@deepseek-ai/dsh-tool-subagent`](../../../../packages/subagent/tool-subagent/README.md) is the Consumer: it offers the model a new `agent_type` parameter and publishes the durable available-subagents catalog. The seam follows the [subagent capability seam](2026-06-21-subagent-capability-seam.md) it specializes.

### One flat Markdown file per specialist

A definition is one `<name>.md` file at the top level of a scanned root, with YAML frontmatter and a persona body. `name` and `description` are required; `tools`, `model`, `reasoning_effort`, and `max_depth` are optional. An unknown frontmatter key rejects the whole file with a warning instead of being ignored, because a silently dropped `tools` would run the child with the full inherited tool set; the same warning path covers missing frontmatter, invalid YAML, a missing or malformed name, a missing description, and an empty body. The [filesystem provider README](../../../../packages/subagent/agent-definitions-filesystem/README.md) owns the field table, the root list, and the precedence between roots.

### The registry is host-plane; a preset contributes only providers

`@deepseek-ai/dsh-agent-definitions` is a process-wide service whose registrations file into the calling context's scope, so the registry row sits in the host composition — the Web bundle mounts it beside the preset roster, for the reason `@deepseek-ai/dsh-skill` sits in the base bundle — and the shipped `standard` and `ptc` presets mount only `@deepseek-ai/dsh-agent-definitions-filesystem`. The provider's calling context is the preset's standing scope, so its definitions land in that preset's layer while the service itself stays reachable from the delegation rows. Only a profile that mounts presets needs the registry, so profiles with no agent plane keep the delegation tool exactly as recorded.

A preset that declared the registry row instead publishes `agentDefinitions` into the root realm, and `dsh-agent-presets` rejects the whole mount: `row(s) published process-global service(s) [agentDefinitions]; a preset service must sit behind an 'isolate' realm or move to the host composition`. An entry-local `isolate` realm is not the repair — the mount succeeds and `agent_type` disappears silently, because the delegation rows and the filesystem provider sit outside that realm and read no registry.

### A definition maps onto the existing start request, and only narrows

A definition resolves to fields the delegation seam already carries: the body becomes `SubagentStartRequest.persona`, `tools` becomes `toolFilter`, `model` and `reasoning_effort` join `agentOptions`, and `max_depth` joins `maxDepth`. Because those are the only fields, a definition never grants a tool or a plugin the spawning agent lacks: each named tool must already be visible to that agent, every rejection happens before a child exists, and the child still joins its parent's composition. The [subagent subsystem](../../../../docs/subsystems/subagent.md) owns those request fields.

That is the distinction from an [agent preset](../../../../packages/preset/agent-presets/README.md): a preset selects the plugins a session runs and is trusted configuration, while a definition is routing data that can only narrow.

### The model learns names from a durable catalog

A delegation tool instance configured with `agentCatalog: true` publishes the catalog on the `agent/pre-step` waterfall. It reads the registry snapshot for the calling agent's cwd and scope and appends one durable user message that lists the winning names and descriptions and asserts it is the complete list; the model selects a specialist by passing an exact listed name as `agent_type`. The message reuses the released `plugin` message source, identified as `tool-subagent/agent-catalog`, so the catalog adds no session-format kind. Publication is idempotent by rendered text: an unchanged list publishes nothing, a changed membership or description replaces the earlier message, and an incomplete registry observation leaves the last published catalog in place instead of retiring names.

### Only in-process backends host definitions

The tool exposes `agent_type` only while `ctx.agentDefinitions` is mounted and the chosen provider advertises `persona`, and a definition that names `tools` or `max_depth` additionally requires that provider's `toolFilter` or `depthLimit` capability. The in-process `spawn` and `fork` backends advertise all three. The out-of-process ACP, Codex, and Claude Code providers advertise no start-time capability, and the SDK provider advertises `agentOptions` only, so none of them hosts definitions.

## Alternatives considered

**A specialist as an agent preset.** A preset could describe a reviewer, and a child could join that preset's composition instead of its parent's. Rejected: a preset grants the capabilities of the plugins it selects, which would make every definition a trusted artifact; it needs one whole composition per specialist; and a child joining a different composition changes the child-joins-parent's-composition lifecycle that delegation, prompt sections, and scope traversal rely on.

**Agent-specific metadata in skill frontmatter.** Skill files already carry frontmatter and are authored per repository. Rejected: it would let one consumer dictate the [skill Service Definition](../../../../packages/skill/skill/README.md). A skill is a different capability with its own provider and consumer roles, and a specialist that narrows a child's tools and route is not a skill.

**One delegation tool instance per definition.** The shipped tool already accepts a per-instance persona, tool filter, and depth cap. Rejected: each instance adds a tool schema the parent pays on every request, registering and unregistering tools as definition files appear and disappear is registration churn on the live tool registry, and a changing tool list prevents the stable prefix that KV Cache reuse needs.

**A new session message source kind for the catalog.** Rejected: adding a source kind is a structural session-log change that requires a `SESSION_FORMAT_VERSION` bump, a version-named [migration package](../architecture/2026-08-10-session-log-version-mechanism.md), and updates to both SDK expected outputs ([session format status](../../../../docs/session-format-status.md), [testing policy](../../../../docs/testing.md)). The released `plugin` message source already carries sourced context messages, so the catalog reuses it.

**Persisting the definition name in the subagent descriptor.** Rejected: it carries the same format-change cost, and the descriptor already records the resolved persona, tool filter, and Agent route, which is what a cold resume restores. A name would only say which file produced those effects, and no current consumer needs that attribution.

**Runtime definition registration on the registry.** `registerProvider()` could accept one-off definitions from a plugin instead of loading them from a source. Rejected: no current producer needs it; the filesystem provider owns discovery, and an in-registry definition would need its own lifetime, validation, and change notification beside the provider that already owns them. The [registry README](../../../../packages/subagent/agent-definitions/README.md) records the resulting limitation.

## Consequences

A deployment or a user now authors `<name>.md` under a scanned root, the model sees the winning names in a durable catalog, and a delegation naming one runs with that definition's persona, tool allow-list, and depth cap. The catalog adds no session format kind, so no version bump, migration package, or SDK expected-output change accompanies it. The delegation tool schema gains `agent_type` only in compositions that mount the registry and a persona-capable provider, which the shipped `standard` and `ptc` presets do on their `subagent` row.

The costs are recorded in the package READMEs. Every registry read re-lists every provider, so discovery pays its cost on each catalog read and each selection; the filesystem provider installs no watcher, so a new, edited, or deleted definition appears only on the next read; an incomplete discovery observation keeps the last published catalog instead of presenting a transient failure as removal; and the selected definition name is deliberately not persisted, so a later registry change affects new delegations and cannot be attributed back to the definition an earlier session used. Out-of-process ACP, Codex, and Claude Code children and SDK children host no definitions at all.

Three behavior suites pin the shipped path: `packages/subagent/agent-definitions/tests/agent-definitions.spec.ts` covers merge, layer precedence, and candidate validation; `packages/subagent/agent-definitions-filesystem/tests/agent-definitions-filesystem.spec.ts` covers root discovery and file parsing; and `packages/subagent/tool-subagent/tests/agent-definitions.spec.ts` covers `agent_type`, the narrowing rejections, and catalog publication, replacement, retirement, and last-good behavior on incomplete discovery. `apps/cli/tests/web-agent-presets.e2e.ts` boots the shipped Web composition, composes `standard`, and asserts the `subagent` tool exposes `agent_type` — the assertion that separates host-plane placement from a mount-clean composition whose realm hides the registry.
