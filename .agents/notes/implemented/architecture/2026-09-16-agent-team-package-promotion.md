# Agent Note: Promote Agent Teams to release packages

Status: implemented

English | [中文](2026-09-16-agent-team-package-promotion.zh.md)

## Problem

Five Agent Teams packages shipped from `packages/experimental/` under `@deepseek-ai/dsh-experimental-*` names through an explicit publication exception. The exception let users install them from npm while their contracts kept changing, and the [2026-08-18 note](2026-08-18-experimental-agent-teams-packages.md) owns that decision.

The exception had run its course. Release packages and apps outside the experimental group may not name experimental packages in their dependency sections, so the shipped `dsh-base` and `dsh-web-app` compositions could not mount the Team service, the Team tools, or the Team panel. The capability existed, was tested, and was unreachable from every product surface a user actually runs — the profiles that could mount it were themselves experimental.

## Decision

All five packages are ordinary release members in product-role groups, under stable names with no `experimental-` prefix:

- `packages/subagent/agent-team` — `@deepseek-ai/dsh-agent-team`
- `packages/subagent/tool-agent-team` — `@deepseek-ai/dsh-tool-agent-team`
- `packages/client/ui-agent-team` — `@deepseek-ai/dsh-client-ui-agent-team`
- `packages/bundle/agent-team-profile` — `@deepseek-ai/dsh-agent-team-profile`
- `packages/bundle/agent-team-web-profile` — `@deepseek-ai/dsh-agent-team-web-profile`

The browser layer has since retired. Its single `ui-agent-team` row is mounted by the shipped [`dsh-web-app`](../../../../packages/bundle/web-app/README.md) bundle, so `agent-team-profile` is the only Team bundle left as separate opt-in, and the panel no longer needs a composition of its own.

The promotion deleted the exception rather than leaving it unused. `scripts/experimental-package-policy.ts` is gone; the workspace-constraints checker now requires every experimental package to be private with no publication metadata, with no public branch left; the release family and the npm-baseline publisher reach these packages through the ordinary `packages/!(experimental)/*/package.json` pattern; and the `dsh-release` family spec asserts that the experimental subset is empty and that the five names are members.

Every reference moved atomically with the packages: npm names, `git mv`ed directories, package manifests and their repository directories, `peerDependencies`/`devDependencies`, Cordis configuration rows, `tsconfig` project references and path aliases, generated catalogs, and the documentation that named them. The Host profile layer keeps its existing job — it is the composition that enables the Team service and disables the global continuable-child control rows whose `list_agents`, `send_message`, and `interrupt_agent` names the Team tools also claim; the browser panel is mounted by `dsh-web-app` directly. The promoted client panel declares `@deepseek-ai/cordis` as its only peer and every other workspace package as a development dependency, because the Web build bundles them.

## Alternatives considered

**Keep the experimental names and mount them anyway.** The dependency-isolation rule exists so a stable surface cannot break when an incubating package changes shape. Weakening it for five packages that the shipped Web bundle would then depend on would trade a real guarantee for one composition, and it would leave every future promotion argument to be re-litigated case by case.

**Promote the packages but keep the exception list as a record.** An exception list with no entries is a policy that cannot be tested and a reader trap: the checker's public branch would be dead code, and the next author would have to rediscover that nothing in the group is public. Deleting it is what makes the rule true again.

**Promote the three code packages and leave the two profile layers experimental.** The profiles are the only reason a user can turn the capability on; leaving them experimental would keep the feature unreachable from shipped compositions and would split one decision across two lifecycles.

**Promote without touching the generated catalogs.** The catalogs, the module graph, and the capability-seam graph are the map other authors read. A rename that leaves them stale makes the repository describe packages that no longer exist, and the freshness gates would have caught it on the next check anyway.

## Consequences

The Team capability is now reachable from product compositions under the same stability expectation as every other release package: its service, tool, and panel contracts can no longer change freely, and a breaking change needs the ordinary deprecation path. The experimental group is private-only again, which makes its rule simple and testable.

The cost is that the promotion is a wide, mechanical change: five directories moved, and every reference to them had to move in the same commit. It also retires the reason the 2026-08-18 note existed; that note stays as the record of why the exception was granted and is superseded here on the naming decision only.

## Testing

Both TypeScript aggregates type-check after the move (`tsconfig.host.json` and `tsconfig.client.json`), which is what proves the Cordis rows, project references, and path aliases all resolve. The five packages' own specs run unchanged, the workspace-constraints and release-family specs cover the deleted exception, and every generated artifact is regenerated and freshness-checked: the Cordis catalog, the module graph, the capability seams and composition graphs, the tool catalog, the configuration catalog, and the persistence catalog. The documentation pairs are re-recorded and the link, wrap, and subsystem-page gates pass.
