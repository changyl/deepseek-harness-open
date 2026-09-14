---
description: "The local filesystem agent-definition provider for users and maintainers authoring Markdown definitions or configuring which project, custom, and user definition roots are scanned."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-definitions-filesystem

English | [中文](README.zh.md)

## Summary

Agents can delegate to specialized child agents described by Markdown files on disk: author `<name>.md` under a scanned root and the delegation tool can select it by name. The provider discovers the project, custom, and user roots, parses each file's YAML frontmatter into a catalog entry, and loads the persona body on selection. Choose it when definitions live in the repository or the user's agent configuration; the registry (`dsh-agent-definitions`) accepts any provider, and changes appear on the next read because this package installs no watcher.

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

Mount the plugin to make definitions from the local filesystem available to the agent-definition registry. It scans the roots below, parses each file's frontmatter into a catalog entry, and loads the persona body when a definition is selected.

### When to choose it

Use this provider when definitions live on disk — in the repository, a custom directory, or the user's agent configuration. Avoid it when definitions come from a remote service or embedded plugin data: the registry accepts any provider, and this package is one implementation.

### Definition format

A definition is a flat `<name>.md` file at the top level of a scanned root. The file starts with YAML frontmatter between `---` lines, and everything after the closing `---` is the persona body.

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Kebab-case definition name |
| `description` | yes | Short routing description shown by discovery consumers |
| `tools` | no | Tool names the child may call, as a list or a comma-separated string |
| `model` | no | Requested child model |
| `reasoning_effort` | no | Requested child reasoning effort |
| `max_depth` | no | Non-negative integer delegation-depth cap |

An unknown frontmatter key rejects the whole file with a warning instead of being ignored, because a silently dropped `tools` would run the child with the full inherited tool set. The same warning path covers a missing frontmatter block, invalid YAML, a missing or non-kebab-case `name`, a missing `description`, an empty body, a `tools` value that is neither a list nor a string, an empty `tools` list, a tool name that is not a non-empty string, and a `max_depth` that is not a non-negative integer.

### Roots and priority

Default roots are scanned in this provider's rank order:

| Rank | Source | Path |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/agents` |
| 200 | `project-agents` | `<projectRoot>/.agents/agents` |
| 300 | `custom` | `Config.customAgentDirs` |
| 400 | `user-dsh` | `<dshHome>/agents` |
| 500 | `user-agents` | `<agentsHome>/agents` |

The project root is the nearest ancestor containing `.git`; without one, the lookup's cwd is used, and project roots are scanned only when a cwd is supplied. `includeDefaultRoots: false` removes the project and user rows, so an isolated provider sees only its configured `customAgentDirs`. Lower ranks win duplicate names inside one registry layer.

### Mount and configure

Load the plugin alongside the registry; it requires `ctx.agentDefinitions`.

```yaml
- name: '@deepseek-ai/dsh-agent-definitions'
- name: '@deepseek-ai/dsh-agent-definitions-filesystem'
```

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `filesystem` | Unique provider name registered on `ctx.agentDefinitions` |
| `includeDefaultRoots` | `true` | Include the project and user roots around `customAgentDirs` |
| `dshHome` | `$DSH_HOME` or `~/.dsh` | Harness config root; its `agents` subdirectory is scanned |
| `agentsHome` | `$DSH_AGENTS_HOME` or `~/.agents` | Shared agent config root; its `agents` subdirectory is scanned |
| `customAgentDirs` | `[]` | Additional definition roots scanned after project roots and before user roots |

The `Config` interface in [`src/index.ts`](src/index.ts) declares these fields with their JSDoc.

### Observable success and failures

A valid definition under any scanned root appears in the merged catalog sorted by name, and selecting it loads the current file body. A root that does not exist is valid empty state; a root that cannot be listed, or a file that cannot be read, is logged and makes the observation incomplete, so consumers keep their last-good catalog instead of presenting a transient failure as removal. A definition that disappears between discovery and selection returns no definition rather than a stale body.

### Filesystem access

The provider reads through `ctx.fs` when a filesystem service is present, preferring its `resolve()`, `readText()`, and `stat()` over direct Node I/O; without one it falls back to Node `readFile` and `realpath`. A caller's abort signal cancels reads, and a path that reports as absent is treated as valid empty state rather than a failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how roots, discovery, and loading are organized; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The provider is built on one separation: discovery turns files into summaries, while every load re-reads the file, so a body edit needs no hash, revision, or cache invalidation. Roots are computed per lookup because the project root depends on the calling cwd.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, provider, root resolution, frontmatter parsing, definition loading |
| — | No runtime invariant companion is published; the provider maps files into registry candidates and exposes no independent event sequence or mutable data relation beyond the registry contracts it satisfies. |

### Discovery flow

Discovery resolves the root list for the lookup cwd, lists each root's direct entries, and considers only non-directory files whose name ends in `.md`, visited in name order. Each file is read, parsed for frontmatter, validated, and turned into a candidate carrying the root's source label and rank plus a path locator. Root entry names come from the filesystem service when present and from Node directory reads otherwise. The provider returns a plain candidate array when every root was listed, or an explicit incomplete observation when one was not.

### Loading a selected definition

`get()` reads the candidate's path locator again, re-parses the file, and returns the definition with the candidate's source and this provider's name; a file that disappeared or no longer parses yields `undefined`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the registry contract to the consumer that renders discovered definitions and the services the provider reads through.

- [agent-definitions package](../agent-definitions/README.md) — the registry this provider registers on.
- [tool-subagent package](../tool-subagent/README.md) — how discovered definitions reach the model and narrow a child.
- [home-paths package](../../util/home-paths/README.md) — how `dshHome` and `agentsHome` resolve.
- [fs package](../../fs/fs/README.md) — the filesystem service the provider prefers when it is present.
- [Subagent subsystem reference](../../../docs/subsystems/subagent.md) — the delegation service these definitions configure.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-subagent`, which publishes this provider's definition names and capped descriptions in the available-subagents catalog and applies the selected definition's persona body and tool allow-list to the child.

#### KV Cache effect

No direct prompt effect. The named consumer owns the durable catalog message, this provider only supplies the summaries it renders, and a file edit reaches the model only through the next catalog read.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Discovery is a flat top level only** — only `<root>/<name>.md` is recognized; nested directories, directory bundles, and package manifests are ignored.
- **An unknown frontmatter key rejects the file** — a misspelled or unsupported field hides the whole definition with a warning instead of ignoring that field.
- **`tools:` cannot be an empty list** — omitting the field inherits the child's tools, while an explicit empty list is rejected instead of meaning "no tools".
- **A persona body is a strict prompt template** — `{{variable}}` references interpolate against the variables registered for the child prompt, so body prose containing those braces must name registered variables or the child's prompt render fails.
- **A root that cannot be listed yields an incomplete observation** — its definitions are missing from that read, and consumers keep their last-good catalog instead of treating the definitions as removed.
- **There is no filesystem watcher** — a new, edited, or deleted definition is visible only to a later read, so nothing refreshes the catalog on its own.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
