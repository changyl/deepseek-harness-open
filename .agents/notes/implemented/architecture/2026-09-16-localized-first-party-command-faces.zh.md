# Agent Note: 为最后三个一方命令提供本地化的 composer 行

Status: implemented

[English](2026-09-16-localized-first-party-command-faces.md) | 中文

## Problem

composer 的本地化行机制按定义逐项开启：[`ui-commands`](../../../../packages/client/ui-commands/src/client/presentation.ts) 只为 `definitionId` 出现在其标识映射里的描述符渲染词典中的标题、说明与图标，其余行保留宿主描述符自带的文案。有三个命令在这张映射表写成之后才注册，因而没有条目——来自 [`dsh-command-usage`](../../../../packages/usage/command-usage/README.zh.md) 的 `/usage`、来自 [`dsh-command-effectiveness`](../../../../packages/feedback/command-effectiveness/README.zh.md) 的 `/effectiveness`，以及来自 [`dsh-command-project`](../../../../packages/project/command-project/README.zh.md) 的 `/project`——所以中文界面把它们渲染成 `usage Show token usage and cost across sessions`：英文文案、没有图标，也没有用户可以键入的本地化拼写。已提交的 [`command-menu-zh.expected.md`](../../../../snapshots/web/lifecycle-chrome/command-menu-zh.expected.md) 把这些英文行与另外六个命令的本地化行并排记录在一起，因此这个缺口在记录输出里可见。

## Decision

本次改动把 [composer 菜单决策](../feature/2026-09-08-composer-menu-sections-and-localized-rows.zh.md)记录下来的规则——新增本地化一方命令需要标识映射、词典条目、图标与菜单位置——应用到这三个定义上。[`resolution.ts`](../../../../packages/client/ui-commands/src/client/resolution.ts) 把 `usage`、`effectiveness`、`project` 映射到 `@deepseek-ai/dsh-command-usage`、`@deepseek-ai/dsh-command-effectiveness` 与 `@deepseek-ai/dsh-command-project`；[`locales.ts`](../../../../packages/client/ui-commands/src/client/locales.ts) 在两种词典里为每个名字新增 `label`、`description` 与 `token` 条目；[`presentation.ts`](../../../../packages/client/ui-commands/src/client/presentation.ts) 为它们分别指定 `IconGaugeOutline16`、`IconDataOutline16` 与 `IconChecklistOutline14`。

选择仍以 `definitionId` 为键，因此某个作用域组合注册了自己的 `usage`、`effectiveness` 或 `project` 行时，该行保留自己的文案，既不继承词典外观，也不会获得内置别名；[命令标识决策](../architecture/2026-09-10-command-identities-and-composer-file-action.zh.md)负责这条规则，以及命令名为何不能承载标识。

`token` 条目为每个命令增加第二种可键入的拼写——英文名之外的 `用量`、`有效性` 与 `项目`——因为菜单选中时填入的是当前语言的 token，而别名表把两种拼写都解析回同一个定义。解析仍然先尝试精确的命令名，再尝试任何别名，因此同名覆盖项只回应自己的拼写。

这三行都不加入 `SECTION_ROWS`。该清单是按使用频次排列的「指令」小节顶部，而清单之外的行本来就排在目录顺序的末尾；新命令没有可度量的使用频次，因此在有人度量之前它就停在那里。

## Alternatives considered

**把三行排进 `SECTION_ROWS`。** 该清单的存在是为了让用户常用的命令紧邻输入框，把一行加进去就等于声明了那个位次。目录顺序的末尾本来就会渲染这些行，记录下来的菜单显示了结果。

**只本地化标题。** 标题是中文、说明仍是英文的行读起来是半翻译状态，而 `builtinRowFace` 从同一张表读取标题、说明与图标；拆开这张表会让某一行保留后续编辑漏掉的任意一半。

**在同一次改动里本地化 `/report`。** `/report` 在 [`packages/session/task-report`](../../../../packages/session/task-report/README.zh.md) 注册时没有 `definitionId`，因此客户端的任何映射都无法指向它的定义；在这里给它加外观需要按名字匹配的例外，而[命令标识决策](../architecture/2026-09-10-command-identities-and-composer-file-action.zh.md)已经否决了这种做法。那个包必须先声明一个 id。

## Consequences

中文菜单现在渲染 `有效性 effectiveness 查看跨会话的结果信号：反馈、变更决策与验证`、`项目 project 列出项目或渲染一份持久项目看板`，以及 `用量 usage 查看跨会话的 token 用量与费用`；英文菜单以图标加本地化标题与说明渲染它们。两种语言都只在标题与行名忽略大小写后不同时，才在标题与说明之间打印可键入的别名——这正是英文行省略它、中文行借此教用户键入 `/用量`、`/有效性` 与 `/项目` 的原因。

两份记录下来的菜单随文案一起更新：[`command-menu.expected.md`](../../../../snapshots/web/lifecycle-chrome/command-menu.expected.md) 及其中文对应文件新增了本地化行，回放通道可以重现它们。`/report` 在两者中都未改变，这就是下面推迟的缺口。

## Deferred

`/report` 仍在所有界面语言下渲染它的英文描述符。它由 `packages/session/task-report` 注册且没有 `definitionId`，因此 `builtinCommandName` 无法归类它，`builtinRowFace` 对它的行返回 undefined。补上这个缺口需要注册它的包声明一个 id，或者为不携带 id 的一方命令提供另一套匹配机制。

## Testing

`pnpm exec vitest run packages/client/ui-commands` 在五个 spec 文件上通过 136 个用例。菜单 spec 固定了本次改动所扩展的顺序与外观规则：空查询先列「添加」小节、再列「指令」小节并按使用频次排列，内置行携带自己的词典键与图标，未列入清单的行保留目录说明且没有图标，同名覆盖项在两种语言下都保留自己的外观与自己的键入拼写。`verify-client-ui-i18n` 接受全部 627 个客户端 UI 源文件，英文词典按中文键集做完整类型检查。

`pnpm run test:gui` 全绿：395 个文件、5668 通过、1 跳过。`pnpm --filter @deepseek-ai/dsh-client-ui-commands run bundle` 重新构建 `lib/client.js`，随后 `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/lifecycle-chrome.e2e.ts` 针对更新后的菜单通过 13/13 个用例。
