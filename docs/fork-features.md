# Features this fork adds

English | [中文](fork-features.zh.md)

`deepseek-harness-open` is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that ships the upstream application together with the capabilities below. Each capability is a plugin or a client package in this repository, mounted or omitted by a `cordis.yml` layer, and each section names the behavior a user sees, the packages that own it, and the limits those packages record.

## Review applied file changes

The right Sidebar draws a file an agent tool wrote or edited as a diff card, and the chat view's "Files changed" row opens the same file on the change that turn applied. A card offers **Accept this change** and **Revert this change**: accepting keeps the file, and reverting restores the content from before that change by replaying the hunks the `tool/result` recorded. Either decision is appended to the session as a durable `change/review` event, so a reload or a fork reconstructs it.

[`dsh-change-review`](../packages/fs/change-review/README.md) records the decisions and performs the revert; [`dsh-change-review-context`](../packages/context/change-review-context/README.md) reports the decisions made since its own last message to the model, so the model re-reads a reverted file instead of trusting its own earlier change. The Web surfaces live in [`dsh-client-ui-sidebar-documentpreview`](../packages/client/ui-sidebar-documentpreview/README.md) and [`dsh-client-ui-deliverables`](../packages/client/ui-deliverables/README.md).

- Accepting records the decision and leaves the file as it is; reverting writes the pre-change content and records `reverted`.
- Every recorded hunk is verified against the current file before anything is written, and every change in one request is placed before the first splice, so one stale hunk refuses the whole request with `409` and leaves all files untouched.
- A create records no hunks, so it cannot be reverted; a file whose content moved on since the recorded change is refused rather than overwritten.
- A decision is appended to a live session only, and the model note reports at most twelve decisions, listing a change decided twice once with its last decision.
- The unit of review is one change, not one hunk: there is no per-hunk selection and no diff against the working tree.

## Open the command palette

Cmd/Ctrl+K and Cmd/Ctrl+Shift+P open a frame-wide command palette from anywhere in the Web GUI. The overlay lists every command the current session can run plus the two actions the surface owns — start a new session, and stop the running turn while one is in flight — and it filters and ranks the loaded rows locally as the reader types. A pick runs the command without touching the composer draft or the composer dropdown.

[`dsh-client-ui-command-palette`](../packages/client/ui-command-palette/README.md) owns both the overlay and `ctx.shortcuts`, the single document keydown registry other client plugins bind chords to: a binding is an effect on the calling fiber, so a plugin's chords leave with it, and chords are parsed and validated at registration, so a malformed spec or a duplicate id fails at plugin load rather than at the first keystroke. `ctx.commandUi` exposes `palette(session, signal)` and `run(name, session)` for surfaces with no composer in view.

- Rows are read once per palette open, and typing re-ranks them without another query.
- The rows keep the section order of the composer's `/` menu, including client contributions and decorations.
- Per-command icons, live row refresh, and argument entry are not part of the palette: command rows share one glyph, and a command that takes arguments runs bare with its hint shown.
- A pick ends with the caret back in the composer: as the row dispatches for an action, a bare host command, and the surface's own Stop, and when the popup settles for a command that opens one.
- Nothing in the palette reaches the model, and the palette adds no prompt, tool schema, or session event.

## Read the turn-end task report

When a turn closes, [`dsh-task-report`](../packages/session/task-report/README.md) folds that turn's own log window into a Markdown report under `.dsh/reports/` in the session workspace and records one durable `task-report/generated` event. [`dsh-client-ui-task-report`](../packages/client/ui-task-report/README.md) renders that event as a compact row above the turn's action strip, stating the changed-file count, the added and removed totals, and how many verification commands passed, failed, or reported no outcome, with a control that opens the written Markdown. The `/report` command regenerates the latest closed turn on demand.

- The path is deterministic and model-free: the report quotes the turn's request and closing text, takes changes from the `meta.diffs` the first-party `write` and `edit` tools attach to their results, and reads verification outcomes from the same `[exit code: N]` markers the shell renders.
- The event carries the outcome rather than the file, and it is appended whether the write succeeded or not, so a read-only session records why its workspace was left untouched.
- Only `write` and `edit` produce change evidence, so a file a shell command created never appears in the report.
- Verification outcomes are parsed rather than structured, so a command that reported neither an exit code nor a timeout, signal, or error marker is reported as unknown.
- One report per turn is keyed by turn number in a shared directory namespace, payload arrays are bounded at fifty changed files and twenty verification commands, and the plugin ships in the `dsh-web-app` bundle only.

## Delegate to a specialized subagent

[`dsh-agent-definitions`](../packages/subagent/agent-definitions/README.md) is a provider registry on `ctx.agentDefinitions` that merges provider catalogs, resolves duplicate names, and validates every candidate; [`dsh-agent-definitions-filesystem`](../packages/subagent/agent-definitions-filesystem/README.md) discovers flat `<name>.md` files in project, custom, and user roots and parses their YAML frontmatter and persona body. [`dsh-tool-subagent`](../packages/subagent/tool-subagent/README.md) offers the model an `agent_type` parameter and publishes the available names as a durable catalog message, so the model selects a specialist by an exact listed name.

A definition is one `<name>.md` file at the top level of a scanned root. `name` and `description` are required; `tools`, `model`, `reasoning_effort`, and `max_depth` are optional, and an unknown frontmatter key rejects the whole file with a warning rather than being ignored.

- A definition maps onto fields the delegation seam already carries — persona body, tool filter, Agent route, and depth cap — and can only narrow: each named tool must already be visible to the spawning agent, every rejection happens before a child exists, and the child still joins its parent's composition.
- The in-process `spawn` and `fork` backends host definitions; the out-of-process ACP, Codex, Claude Code, and SDK providers advertise no start-time capability and offer no `agent_type`.
- The registry is a process-wide service mounted in the host composition, and the shipped `standard` and `ptc` presets mount only the filesystem provider, so `agent_type` appears in exactly the compositions that can resolve it.
- Every registry read re-lists every provider and the filesystem provider installs no watcher, so a new, edited, or deleted definition appears on the next read.
- The selected definition name is deliberately not persisted, so a later registry change affects new delegations and cannot be attributed back to the definition an earlier session used.

## Edit text documents in the right Sidebar

The plain-text, Markdown, and code renderers of [`dsh-client-ui-sidebar-documentpreview`](../packages/client/ui-sidebar-documentpreview/README.md) declare themselves editable, and the tab carries an editing session beside its preview. Save writes the whole file through `workspaceFiles.write` in [`dsh-api-workspace-files`](../packages/api/workspace-files/README.md), which is the service's only mutation and is refused unless the session is live and its sandbox policy permits writing.

- The draft is the whole file read at once and decoded with the byte-order mark preserved, so a save round-trips the bytes the reader did not touch, including a trailing newline and CRLF endings.
- A save sends the version the draft was read from as a guard; a file that moved on is refused with `workspace-file/stale-version` and nothing is written.
- That refusal is reported as a conflict with exactly two resolutions: overwrite, which saves with the guard omitted, and discard and reload, which re-reads the file whole and adopts the other writer's version.
- Every other refusal — a read-only session, a cold session, a backend failure — leaves the draft and its baseline untouched, because retrying it unchanged is the only sensible next step.
- Editing is whole-file UTF-8 through a plain `<textarea>`: no syntax highlighting, no line numbers, no multi-cursor, a `maxFileBytes` cap of 32 MiB by default, and a draft that survives a tab switch but not a page reload.

## Read diffs in the changed file's own grammar

The right Sidebar draws a change with the same Shiki grammar its own preview selects from the file path, in both the one-column change and the two-column whole-file comparison, including the unchanged lines the comparison draws from the file. [`dsh-client-ui-primitives`](../packages/client/ui-primitives/README.md) exposes a `DiffHighlighter` in its row builders and an optional `lang` on `DiffBlock` and `DiffSplitBlock`; the Sidebar's `text` tab passes the language its path maps to.

- Each side's complete text is tokenized once, so a change inside a block comment or an open template literal keeps the context that colorizes it; the runs are indexed by the same line numbers the row builders use, and a grammar that reports fewer lines leaves those rows plain rather than dropping text.
- Highlighting is lazy and viewport-gated: an offscreen card pays nothing, and a grammar that has not loaded yet renders the plain text the row already held.
- While highlighting is active, removed and added rows take a tinted band and the `- ` / `+ ` prefix keeps its own color, so which side a line belongs to never depends on the syntax palette.
- A caller that passes no language tokenizes nothing and draws every row plain, which is what the chat tool cards do.

## Further exploration

- [Architecture](architecture.md) maps the plugin composition these packages join.
- [Capability services](capability-seams.md) defines the Service Definition, Service Provider, and Consumer roles the seams above follow.
- [Development](development.md) covers the checkout, test lanes, and gates a change to these packages runs through.
- [Configuration catalog](config-catalog.md) lists the validated configuration fields of every mounted plugin.
