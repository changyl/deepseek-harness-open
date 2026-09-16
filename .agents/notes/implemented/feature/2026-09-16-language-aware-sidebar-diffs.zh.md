# Agent Note: 用被改文件自身的语法渲染 Sidebar 差异

Status: implemented

[English](2026-09-16-language-aware-sidebar-diffs.md) | 中文

## Problem

在右侧 Sidebar 打开某一轮的改动时，整份改动被画成一块扁平等宽文本：`DiffBlock` 与 `DiffSplitBlock` 只按行自身的红/绿配色打印每个 hunk 的删除行与新增行，别无其他。同一面板在渲染文件本身时走代码渲染器，会按路径扩展名选择 Shiki 语法——于是一个 `.ts` 文件的改动，在读者阅读文件时是带语法配色的源码，一旦读者想看「改了什么」就变成一片无从分辨的红绿。最需要仔细阅读代码的那个视图，恰恰是唯一不给代码着色的视图。

## Decision

`DiffBlock` 与 `DiffSplitBlock` 接受可选的 `lang`，Sidebar 的 `text` tab 则通过既有的 `languageForPath` 传入自身路径映射到的语言。

### run 在行模型里构建，而不是在组件里

`diff-hunks.ts` 新增 `DiffHighlighter`——一个把某一侧文本映射为其逐行 run（或 `undefined`）的函数——并把它贯穿 `buildDiffRows`、`buildSplitRows` 与 `buildFileSplitRows`。此后每个 `DiffRow` 与 `SplitDiffCell` 都携带自身文本的可选 `spans`，两个组件只决定是否绘制它们。因此高亮落在各布局本就计算好的那些行上，包括整文件对比从文件中画出的未改动行；并且在高度上限裁剪正文时，hunk 的行不会与描述它们的 token 错位。

### 每一侧的整段文本只 tokenize 一次

TextMate 的分词是按行、单向推进的，逐行 tokenize 会在每个行边界重新开始语法，从而丢掉仍未闭合的注释或字符串。构建器对每一侧（`oldText`、`newText`）各调用一次高亮器，整文件对比再对整份文件调用一次，然后按 `contentLines` 与 `fileLines` 使用的同一套行号索引所得的逐行 run。若语法返回的行数少于该侧实际行数，这些行按纯文本绘制，而不是丢掉文本。

### 高亮是惰性的、受视口门控的、且可叠加的

两个表面都使用既有的 `useViewportHighlighting` 门控与 `subscribeGrammarLoaded`/`grammarLoadCount` 重渲染，与 `CodeBlock`、`ReadBlock` 完全一致：不在视口内的卡片不付出任何代价，惰性语法首次渲染时仍是它一贯的纯文本，直到语法注册完成才出现高亮。`lang` 是可选参数，因此不传它的调用方——目前是聊天中的工具卡片——不构建任何 run，渲染结果与之前一致。

### 改动方向移到着色底带上

Shiki 的 run 带内联颜色，会覆盖 `.del`/`.add` 的文本色调，使一行虽有语法配色却看不出属于哪一侧。高亮生效时整块设置 `data-diff-highlight`，删除行与新增行改为着色底（在原先文本色调所用的 error/success token 上做 `color-mix`），而 `- `/`+ ` 前缀保留自身颜色，因此改动方向从不依赖语法配色。统一布局的行使用 `width: max-content` 配合 `min-width: 100%`，使长行的底带在正文边缘之外仍随行延伸，而不是停在滚动区处。

## Alternatives considered

**用文件已注册的文档渲染器来画改动。** 否决：读者看的是改动而不是文件，而拥有文件呈现方式的渲染器（Markdown、图片、PDF）会直接替换掉 diff，而不是给它着色。

**让 diff 正文复用 `CodeBlock`。** 否决：diff 正文是由「带侧别的行、hunk 锚点、高度上限、复制形式」构成的，`CodeBlock` 一概没有；包一层会让两个表面共用一个谁也不拥有的组件。二者真正共享的是语法，而现在共享的正是它。

**逐行 tokenize。** 否决，理由同上：更便宜，但在多行结构内部是错的，而那里恰恰是改动最难读的地方。

**保留红/绿文本，只给没有颜色的 token 加高亮。** 否决：这会产出一行中某个 run 的颜色表示「被改动」、下一个 run 表示「关键字」的结果，读者学不到任何规则。

**把「路径到语言」的映射移入 `ui-primitives`，让聊天里的 diff 卡片也高亮。** 暂缓：这会为导出清单需要签核的包新增一个值导出；而且聊天卡片是消息流中一次调用的有界摘要，不是阅读表面。primitive 接受 `lang`；拥有语言映射的调用方自行传入即可。

## Consequences

被改动的源码文件现在在 Sidebar 中与文件自身的预览使用同一套配色，单栏改动与两栏对比皆然；没有对应语法的扩展名则保持不变。

`DiffBlock` 与 `DiffSplitBlock` 各多出一个可选 prop 与一个渲染分支；不传它的聊天工具卡片逐字节不受影响。底带是一个全新的视觉状态，完全由 `data-diff-highlight` 门控，因此纯文本 diff 保持原有的精确色调。

四组测试锁定已发布路径。`packages/client/ui-primitives/tests/diff-block.client.spec.tsx` 与 `diff-split-block.client.spec.tsx` 覆盖「有高亮器 / 无高亮器」两种情形下的行构建器——包括高亮器只覆盖部分行的一侧——以及两个表面在真实语法、未知语言、无语言下的渲染。`packages/client/ui-sidebar-documentpreview/tests/text-preview.client.spec.tsx` 锁定接线：`.md` tab 上的改动由该 tab 自身路径选出的 Markdown 语法绘制。
