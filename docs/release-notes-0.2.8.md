[中文](#cn-v0.2.8) | [English](#en-v0.2.8)

0.2.8 把两种最常见的 Markdown 行内写法变成了画布上的**可交互元素**：列表项里的任务（`- [ ]` / `- [x]` / `- [X]`）在节点上画出复选框，点一下即切换；正文里的 `#标签`（含 `#项目/子项` 这类分层形态）渲染成可点的 pill，点开就是 Obsidian 自带的标签搜索。两者都**只做显示层**——token 与标签原样留在正文里，未编辑的行逐字回写；任务切换只改行首三个字符，标签**零写回**。同时修掉了「勾选后节点变高、整列下沉」，并让插件的「原文写回」通道（内联编辑 / 节点配色 / 任务勾选）真正进入撤销历史。

<h3 id="cn-v0.2.8">新增</h3>

* **任务复选框**：列表项首行的 `[ ]` / `[x]` / `[X]` 变成节点内的复选框（完成态带对勾，`role="checkbox"` + `aria-checked` 同步），**点一下即切换**，不必先进入编辑
  * 画布在 **capture** 阶段拦 `mousedown` / `click` / `dblclick`：引擎在节点上是「mousedown 起拖」，不拦会把勾选变成拖节点
  * 只认**列表项首行**且 `[ ]` 后必须是空白或行尾（`[ ]foo` 不是任务）；**空正文**（整行只有 `- [ ]`）同样画出复选框
  * **写回最小**：只改首行行首三个字符，其余逐字不变；`[X]` 保持原样大小写，不归一
  * 切换**跳过提交后编排**：只改状态，不触发自动拆链这类结构变更
  * 含图节点（图片节点）**不画复选框**，也不提供任何勾选入口——避免「看不见却能改」
  * 无右键菜单、无键盘入口、无多选批量（与点击交互同一批裁决）
* **标签**：`#标签` 渲染为 pill（默认主题紫；着色节点取底色派生的 chip 色），**点击打开 Obsidian 全局搜索**（查询即 `tag:#名`）
  * 只认**顶层正文**：行内码、围栏代码块、数学、注释、链接内部都不识别；轻标记内部也不算（`**#tag**` 不是标签）
  * 判据：`#` 前必须是非词字符（`foo#bar` 不算）、纯数字不算（`#2024` 不算）、`/` 分层允许但不得以 `/` 结尾
  * 只读嵌入（`mindmap` 代码块）里**同样可点**，与链接同权
  * **零写回**：标签留在显示文本与原文中，点击不改任何文件
* **撤销覆盖「原文写回」通道**：内联编辑、节点级配色、任务勾选此前直接改数据后重渲染，**不留历史**（引擎只在命令收尾 `addHistory`），导致一次 `Ctrl+Z` 会连带回退更早的编辑。现在该通道收尾会记一条快照；连续勾选或批量改色由引擎自身的 100ms 防抖合并成一条，不会刷出一串「撤销一步只退一个节点」

<h3>修复</h3>

* **勾选后节点「下沉」**：完成态的对勾原先作为复选框内部的文本节点，把 inline-block 的基线从「底边」改成「字形基线」，所在行盒被撑高 2px——实测节点高度 26 → 28、下方兄弟节点整列下移 1px、复选框相对文字下沉约 3px，取消勾选再抖一次。现在对勾画在**绝对定位层**（不参与行盒），勾选前后节点高度、位置、兄弟节点位置全部不变

<h3>工程</h3>

* **任务判定只有一份**：`domain/md-task`（`parseTaskPrefix` 解析 / `stripTaskPrefix` 剥离显示文本 / `toggleTaskToken` 切换 / `setTaskTokenInRaw` 就地换 token）+ `md-serialize.composeNodeFirstLine`（合成一行时把 token 拼回）；`mdTask` 与 `mdTaskToken` 是派生元数据，`mdRaw` 仍保留 token（未编辑行逐字回写的依据）
* **三条合成路径统一重新剥离**：解析、拆链重建父行（`links-split`）、原文写回（`node-inline-editor`）——漏一处就会让父行多出一个 `[ ]`
* **标签链路各一层**：`node-inline-tokenize.pushTagSegments`（切段，保护区先吃掉代码/数学/注释/链接）→ `node-inline-html`（`a.tag[data-tag]`，**刻意不写 `href`**，因此不落进链接的三条通道）→ `view-tag`（画布 capture 与只读嵌入共用一份实现）→ `platform/tag-search`（`global-search` 私有触点：缺失或抛错只提示一次，不静默空转）
* **撤销收口**：`engine/mindmap-history.recordHistory`（引擎面未在 `d.cts` 声明，防御式读取，缺失只留痕）
* 行为口径写进 `AGENTS.md` 决策表与 `docs/agents/conventions.md` K150（含「对勾不能进复选框文本节点」的实机取证）
* 全量测试 **94 文件 / 2545 例**；门禁 `build` / `test` / `lint` / `check:dead-code` / `verify:visual` / `check:release` 均通过
* 发布元数据：`manifest.json` 的 `description` 改写为符合官方提交要求的文案（旧文案含 `/`、`(`、`)`、`:`，触发 `obsidianmd/validate-manifest`，`npm run lint` 因此在 `--max-warnings 0` 下红灯并连带挡住后续门禁）

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖；**`styles.css` 无变化**（复选框与标签 pill 全部使用内联样式，替换 `main.js` 即可，`manifest.json` 请一并更新）
* **文件格式不变**：任务 token 与 `#标签` 本来就是正文的一部分，插件没有引入新语法、不重排、不合成未编辑的行；标签点击不写盘，任务切换只动三个字符
* **回滚到 0.2.7 及更早**：任务节点会显示成 `[ ] 文本`（token 变成可见文字）、标签回到普通文本——**数据无损**，重新升级即恢复交互；本版写过的文件没有「新格式」依赖
* **没有新增命令、没有新增设置键**：命令 ID、文件格式与逐字保真契约均不变

---

0.2.8 turns two everyday Markdown inline forms into **interactive elements on the canvas**. A task in a list item (`- [ ]` / `- [x]` / `- [X]`) now shows a checkbox inside the node and toggles on a single click; a `#tag` in the body (including nested forms like `#project/sub`) renders as a clickable pill that opens Obsidian's own tag search. Both are **display-only**: the token and the tag stay in the Markdown, untouched lines round-trip verbatim, a toggle rewrites exactly three characters and a tag click **writes nothing**. This release also fixes "the node gets taller and the column sinks after checking a box", and puts the plugin's raw-text write-back channel (inline editor / node colour / task toggle) into the undo history where it belongs.

<h3 id="en-v0.2.8">Added</h3>

* **Task checkboxes**: a leading `[ ]` / `[x]` / `[X]` in a list item becomes a checkbox inside the node (with a check mark when done, `role="checkbox"` and `aria-checked` kept in sync) that toggles on **a single click** — no need to enter edit mode first
  * The canvas intercepts `mousedown` / `click` / `dblclick` in the **capture** phase: the engine starts a node drag on `mousedown`, so without it a "check" would turn into a drag
  * Only the **first line of a list item** counts, and the `[ ]` must be followed by whitespace or end of line (`[ ]foo` is not a task); a **body-less** task (`- [ ]` alone) still gets its checkbox
  * **Minimal write-back**: only the three leading characters of the first line change, everything else stays byte-for-byte; `[X]` keeps its case (it is not normalised)
  * A toggle **skips post-commit orchestration**, so it never triggers structural changes such as automatic link splitting
  * Nodes that contain an image get **no checkbox and no toggle entry** — nothing is editable that cannot be seen
  * No context-menu item, no keyboard entry, no multi-select batch (same ruling as the click behaviour)
* **Tags**: `#tag` renders as a pill (theme purple, or a chip derived from the node fill on coloured nodes) and **opens Obsidian's global search** on click, with the query `tag:#name`
  * Only **top-level prose** counts: inline code, fenced code, math, comments and link internals are excluded; light markup hides them too (`**#tag**` is not a tag)
  * Rules: the `#` must follow a non-word character (`foo#bar` is not a tag), all-digit names are not tags (`#2024`), `/` nesting is allowed but a trailing `/` is not
  * Tags are clickable **inside the read-only `mindmap` code block** as well, with the same rights as links
  * **Zero write-back**: the tag stays in the display text and in the source, so clicking never modifies a file
* **Undo now covers the raw write-back channel**: the inline editor, node-level colours and task toggles used to mutate data and re-render without recording history (the engine only calls `addHistory` when a command finishes), so a single `Ctrl+Z` could roll back earlier edits as well. The channel now records one snapshot per commit; consecutive toggles or a batch recolour are merged by the engine's own 100 ms debounce, so undo does not degrade into "one node per step"

<h3>Fixed</h3>

* **The node "sinks" after checking a box**: the check mark used to be a text child of the checkbox, which switched the inline-block's baseline from the bottom margin edge to the glyph baseline and made the line box 2 px taller — measured as node height 26 → 28, every sibling below shifting down 1 px, and the checkbox sitting ~3 px lower than the text, then jittering back on uncheck. The check mark is now painted in an **absolutely positioned layer** (outside the line box), so height, position and sibling positions are identical in both states

<h3>Engineering</h3>

* **One task predicate**: `domain/md-task` (`parseTaskPrefix`, `stripTaskPrefix` for the display text, `toggleTaskToken`, `setTaskTokenInRaw` to swap the token in place) plus `md-serialize.composeNodeFirstLine`, which puts the token back when a line is composed; `mdTask` and `mdTaskToken` are derived metadata while `mdRaw` keeps the token as the verbatim round-trip source
* **All three composition paths strip the token again**: parsing, link-split parent rebuild (`links-split`) and raw write-back (`node-inline-editor`) — missing one leaves a stray `[ ]` on the parent line
* **Layered tag pipeline**: `node-inline-tokenize.pushTagSegments` (segmentation, after the protected regions eat code/math/comments/links) → `node-inline-html` (`a.tag[data-tag]`, **deliberately without `href`**, so it never falls into the three link channels) → `view-tag` (one implementation shared by the canvas and the read-only embed) → `platform/tag-search` (the `global-search` private touchpoint: a missing API or a throw is reported once, never silently ignored)
* **Undo collected in one place**: `engine/mindmap-history.recordHistory` (the engine surface is not declared in `d.cts`, so it is read defensively and a missing method only leaves a warning)
* Behaviour contracts recorded in the `AGENTS.md` decision table and K150 in `docs/agents/conventions.md` (including the on-device evidence for "the check mark must not be a text child")
* Full suite: **94 files / 2545 cases**; gates `build` / `test` / `lint` / `check:dead-code` / `verify:visual` / `check:release` all green
* Release metadata: the `manifest.json` `description` was rewritten to satisfy the official submission requirements (the old one contained `/`, `(`, `)` and `:`, which tripped `obsidianmd/validate-manifest` and made `npm run lint` fail under `--max-warnings 0`, blocking the remaining gates)

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies; **`styles.css` is unchanged** (the checkbox and the tag pill are inline-styled — replacing `main.js` is enough, but update `manifest.json` too)
* **The file format is unchanged**: task tokens and `#tags` were always part of the body, so no new syntax, no reordering and no synthesised lines; a tag click writes nothing and a toggle touches three characters
* **Rolling back to 0.2.7 or earlier**: task nodes show as `[ ] text` (the token becomes visible text) and tags turn back into plain text — **no data is lost**, and re-upgrading restores the interactions; files written by this version have no "new format" dependency
* **No new commands and no new settings keys**: command IDs, the file format and the lossless round-trip contract are unchanged
