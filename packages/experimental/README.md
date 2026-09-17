---
description: "The experimental group map: pre-stable prototypes that are private by default."
kind: "package-group"
---

# packages/experimental

English | [中文](README.zh.md)

## Summary

The experimental group contains prototype capabilities whose contracts can change and carry no support promise. Every package here uses the `@deepseek-ai/dsh-experimental-*` npm prefix and is private by default. The group holds the private cross-realm Inspector, CPython subprocess backend, and browser-worker preview packages. Released products outside this group must not depend on experimental packages.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`code-runtime-python`](code-runtime-python/README.md) | CPython subprocess backend for the code-execution seam | `ctx.codeRuntime` |
| [`inspector`](inspector/README.md) | Cross-realm CDP hub for Host debugging, Client Runtime inspection, network capture, and Cordis trees | `ctx.inspector` |
| [`webworker-packer`](webworker-packer/README.md) | Builds the gzip-compressed VFS image consumed by the browser worker preview | library and CLI — no ctx key |
| [`webworker-runtime`](webworker-runtime/README.md) | Runs the harness plugin tree inside a dedicated browser worker | library and worker entry — no ctx key |

-----

<a id="related-documentation"></a>
## Related documentation

- [Experimental package decision](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.md) — the superseded decision that published the Agent Teams packages from this group; they are now release members in product-role groups.
- [Agent Teams subsystem](../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [Experimental subtree rules](AGENTS.md) — what experimental status does and does not relax.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
