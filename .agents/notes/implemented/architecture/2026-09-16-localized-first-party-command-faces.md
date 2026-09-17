# Agent Note: Localized composer faces for the last three first-party commands

Status: implemented

English | [中文](2026-09-16-localized-first-party-command-faces.zh.md)

## Problem

The composer's localized-row mechanism is opt-in per definition: [`ui-commands`](../../../../packages/client/ui-commands/src/client/presentation.ts) renders its dictionary title, description, and glyph only for a descriptor whose `definitionId` appears in its identity map, and every other row keeps the Host descriptor's own text. Three commands registered after that map was written had no entry — `/usage` from [`dsh-command-usage`](../../../../packages/usage/command-usage/README.md), `/effectiveness` from [`dsh-command-effectiveness`](../../../../packages/feedback/command-effectiveness/README.md), and `/project` from [`dsh-command-project`](../../../../packages/project/command-project/README.md) — so a Chinese interface rendered them as `usage Show token usage and cost across sessions`: English copy, no glyph, and no localized spelling a user could type. The committed menu in [`command-menu-zh.expected.md`](../../../../snapshots/web/lifecycle-chrome/command-menu-zh.expected.md) carried those English rows beside localized rows for the six older commands, so the gap was visible in recorded output.

## Decision

This change applies the rule the [composer menu decision](../feature/2026-09-08-composer-menu-sections-and-localized-rows.md) recorded — a localized first-party command needs its identity mapping, dictionary entries, glyph, and menu position — to those three definitions. [`resolution.ts`](../../../../packages/client/ui-commands/src/client/resolution.ts) maps `usage`, `effectiveness`, and `project` to `@deepseek-ai/dsh-command-usage`, `@deepseek-ai/dsh-command-effectiveness`, and `@deepseek-ai/dsh-command-project`; [`locales.ts`](../../../../packages/client/ui-commands/src/client/locales.ts) gains `label`, `description`, and `token` entries for each in both dictionaries; and [`presentation.ts`](../../../../packages/client/ui-commands/src/client/presentation.ts) gives them `IconGaugeOutline16`, `IconDataOutline16`, and `IconChecklistOutline14`.

Selection stays keyed by `definitionId`, so a scoped composition that registers its own `usage`, `effectiveness`, or `project` row keeps its own copy and inherits neither the dictionary face nor a built-in alias; the [command identity decision](../architecture/2026-09-10-command-identities-and-composer-file-action.md) owns that rule and the reason a command name cannot carry identity.

The `token` entries add a second typed spelling per command — `用量`, `有效性`, and `项目` beside the English names — because a menu pick inserts the locale's token and the alias table resolves either spelling back to the same definition. Resolution still tries an exact name match before any alias, so a same-named override answers to its own spelling.

None of the three rows joins `SECTION_ROWS`. That list is the top of the Commands section in usage order, and a row outside it already lands in the catalog-order tail; a new command has no measured usage rank, so the tail is where it sits until something measures one.

## Alternatives considered

**Rank the three rows inside `SECTION_ROWS`.** The list exists to keep the commands people reach for adjacent to the input, and adding a row there claims that rank. The catalog-order tail already renders these rows, and the recorded menus show the result.

**Localize the titles only.** A row with a Chinese title and an English description reads as half-translated, and `builtinRowFace` reads the title, description, and glyph from one table; splitting that table would let a row keep whichever part a later edit forgot.

**Localize `/report` in the same change.** `/report` registers in [`packages/session/task-report`](../../../../packages/session/task-report/README.md) with no `definitionId`, so no client mapping can name its definition; giving it a face here would need a name-keyed exception, which the [command identity decision](../architecture/2026-09-10-command-identities-and-composer-file-action.md) rejected. That package has to declare an id first.

## Consequences

A Chinese menu now renders `有效性 effectiveness 查看跨会话的结果信号：反馈、变更决策与验证`, `项目 project 列出项目或渲染一份持久项目看板`, and `用量 usage 查看跨会话的 token 用量与费用`, and the English menu renders the localized titles and descriptions with glyphs. Both languages print the typed alias between title and description exactly when the label differs from the row name ignoring case, which is why the English rows omit it and the Chinese rows teach `/用量`, `/有效性`, and `/项目`.

The two recorded menus moved with the copy: [`command-menu.expected.md`](../../../../snapshots/web/lifecycle-chrome/command-menu.expected.md) and its Chinese counterpart gained the localized rows, and the replay lane reproduces them. `/report` is unchanged in both, which is the gap deferred below.

## Deferred

`/report` still renders its English descriptor in every locale. It is registered by `packages/session/task-report` without a `definitionId`, so `builtinCommandName` cannot classify it and `builtinRowFace` returns undefined for its row. Closing that gap needs an id declared by the registering package, or a matching mechanism for first-party rows that carry none.

## Testing

`pnpm exec vitest run packages/client/ui-commands` passes 136 cases over five spec files. The menu spec pins the ordering and face rules this change extends: an empty query lists the Add section then the Commands section in usage order, a built-in row carries its dictionary keys and glyph, an unlisted row keeps its catalog description and gets no glyph, and a same-name override keeps its own presentation and its own typed spelling under both locales. `verify-client-ui-i18n` accepts all 627 client UI source files, and the English dictionary is typed complete against the Chinese key set.

`pnpm run test:gui` is green at 395 files, 5668 passed, and 1 skipped. `pnpm --filter @deepseek-ai/dsh-client-ui-commands run bundle` rebuilds `lib/client.js`, after which `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/lifecycle-chrome.e2e.ts` passes 13 of 13 cases against the refreshed menus.
