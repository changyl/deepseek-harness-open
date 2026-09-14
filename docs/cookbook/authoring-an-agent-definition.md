# Cookbook: authoring an agent definition

English | [中文](authoring-an-agent-definition.zh.md)

An agent definition is one reusable specialized subagent that a delegation tool offers the model by name. This guide authors one and confirms the model can select it; the [filesystem provider README](../../packages/subagent/agent-definitions-filesystem/README.md) is the reference for the file format, roots, and configuration, and the [specialized-subagent Agent Note](../../.agents/notes/implemented/feature/2026-09-14-specialized-subagent-definitions.md) records why a definition narrows rather than grants.

Prerequisites: a composition that mounts `@deepseek-ai/dsh-agent-definitions`, `@deepseek-ai/dsh-agent-definitions-filesystem`, and `@deepseek-ai/dsh-tool-subagent`. The shipped `standard` and `ptc` presets mount all three and enable the catalog on their `subagent` row.

## 1. Choose the root that owns the definition

The filesystem provider scans five roots in rank order, and the lower rank wins a duplicate name inside one registry layer: the project's `.dsh/agents`, the project's `.agents/agents`, the directories configured as `customAgentDirs`, `<dshHome>/agents` (`$DSH_HOME` or `~/.dsh`), and `<agentsHome>/agents` (`$DSH_AGENTS_HOME` or `~/.agents`). The project root is the nearest ancestor containing `.git`, or the lookup's cwd when there is none, and project roots are scanned only when a cwd is supplied. Put a definition that every repository shares in a user root, and one that belongs to a single repository in a project root.

Registry layers outrank those file ranks: a definition registered by a preset's own composition layer replaces a same-name definition from the global layer. The [registry README](../../packages/subagent/agent-definitions/README.md) owns the merge and duplicate rules, and the [filesystem provider README](../../packages/subagent/agent-definitions-filesystem/README.md) owns the exact paths and the `includeDefaultRoots` behavior.

## 2. Write the definition file

Create a flat `<name>.md` file directly under one scanned root; subdirectories and non-Markdown files are ignored. YAML frontmatter sits between `---` lines, and everything after the closing `---` is the child persona.

```markdown
---
name: migration-reviewer
description: Reviews a database migration for reversibility and lock impact.
tools:
  - read
  - grep
model: <model-id>
reasoning_effort: high
max_depth: 0
---

You review one database migration and report its problems in order of severity. You never edit files and you never delegate: report what the migration alone does not let you decide.
```

The file name is a convenience; the `name` field is the identity the model passes as `agent_type` and the key a duplicate replaces.

## 3. Fill the frontmatter

- `name` (required) — the kebab-case identifier, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- `description` (required) — a short non-empty routing description that the catalog shows the model.
- `tools` (optional) — the tool names the child may call, as a list or as one comma-separated string; omit the field to inherit the child's tools, because an explicit empty list is rejected.
- `model` and `reasoning_effort` (optional) — the child's LLM route; the delegation tool instance must have model selection enabled and the Session's route policy must authorize the exact route, or the call is rejected before a child exists.
- `max_depth` (optional) — a non-negative integer cap on further delegation, which only lowers the cap the tool instance configured.
- Anything else — an unknown frontmatter key rejects the whole file with a warning instead of being ignored, because a silently dropped `tools` would run the child with the full inherited tool set.

The same warning path covers a missing frontmatter block, invalid YAML, a missing or non-kebab-case `name`, a missing `description`, and an empty body. The [filesystem provider README](../../packages/subagent/agent-definitions-filesystem/README.md) is the exhaustive field reference.

## 4. Write the body as the child persona

The body is the child persona. The tool passes it as the start request's `persona`, which an in-process backend installs as a scoped `deployment:persona-prefix` section, so it shadows the deployment persona for that child alone. It uses the same strict template as a deployment persona: every complete `{{name}}` group must resolve to a prompt variable registered for the child, and a malformed, unknown, or valueless reference fails the child's prompt render, while a `{{` that never closes stays literal prose. The [subagent subsystem](../subsystems/subagent.md) documents the accepted request fields, and the [persona preset](../../packages/preset/persona/README.md) applies the same template to a whole deployment.

## 5. Narrow, never grant

Every field narrows the composition the child would otherwise inherit. `tools` becomes the child's allow-list, each named tool must already be visible to the spawning agent, and `max_depth` can only tighten a cap. A definition grants no plugin and cannot change the composition its child joins, so it is safe to author from a source an [agent preset](../../packages/preset/agent-presets/README.md) would not be trusted to supply: a preset selects its own plugins and is trusted configuration.

A definition that names a tool the spawning agent cannot see, or that carries `tools` or `max_depth` while its provider lacks the `toolFilter` or `depthLimit` capability, is rejected before any child exists. Definitions are hosted only by providers that advertise `persona`: the in-process `spawn` and `fork` backends. The out-of-process ACP, Codex, and Claude Code providers advertise no start capability, and the SDK provider advertises `agentOptions` only, so none of them hosts definitions.

## 6. Let the model discover and select it

A delegation tool instance configured with `agentCatalog: true` publishes the available-subagents catalog on the `agent/pre-step` waterfall. It reads `ctx.agentDefinitions.snapshot()` for the calling agent's cwd and scope and appends one durable user message sourced from the released `plugin` message source, so the catalog adds no session format kind. The message presents itself as the complete list, replaces the earlier list when the winning membership or a rendered description changes, and publishes nothing while the rendered list is unchanged. Discovery is re-read on every step rather than watched, and a partial observation keeps the last published catalog instead of retiring names.

The model passes an exact listed name as `agent_type`, and the tool resolves that definition, checks it against the provider, and applies it to that one call. The parameter exists only while `ctx.agentDefinitions` is mounted and the chosen provider hosts personas, and a composition without either rejects a call that names a definition. The [tool README](../../packages/subagent/tool-subagent/README.md) owns the parameter and the published catalog wording.

## 7. Verify

- Ask the agent to delegate, then confirm the specialist is listed in the catalog message in the session transcript and that a delegation naming it runs with its persona and narrowed tools.
- Break the file on purpose: add an unknown frontmatter key and confirm the log carries `agent definition <path> ignored: frontmatter field "<key>" is unsupported` and the name never reaches the catalog.
- Run the consumer's behavior spec: `pnpm exec vitest run packages/subagent/tool-subagent/tests/agent-definitions.spec.ts`.
- Run the documentation checks after editing these pages: `pnpm run doc-sync`.
