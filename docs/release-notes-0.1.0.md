[中文](#cn-v0.1.0) | [English](#en-v0.1.0)

0.1.0 是一次「先审计、后修复」的版本：先对照官方帮助与官方 API 类型定义做了 `[[]]` / `![[]]` 支持度审计（结论与四项决策已登记），再逐条修复清扫中发现的**七处静默数据损坏 / 保真缺陷**，并把 Canvas / Bases 正式纳入文档类。核心能力（Markdown 无损往返、三类链接图标、图片与嵌入语法保真、PNG 导出、搜索、性能模式）保持兼容，且**保真度整体提高**。

<h3 id="cn-v0.1.0">新增</h3>

* **Canvas / Bases 归为文档类**：`![[画布.canvas]]` / `![[表格.base#视图]]` 与文档双链走同一通道——显示自绘文档页图标、可悬停预览、点图标打开；从文件浏览器拖入 canvas/base 同样按文档处理（`.md` 用去扩展名写法，非 Markdown 文档必须带扩展名）。指向 `.base` 的链接此前会提示「无法预览」，现在可正常在标签页打开
* **非图片嵌入的管道位原文保留**：`![[报告.pdf|300]]` 在编辑节点后不再丢 `|300`。官方未定义该位语义（PDF 用 `#height=` / `#page=`、音频无尺寸语法），故插件**不解释、只原样保存并回写**

<h3>修复</h3>

* **换文件时的保存排空可能写错文件（最严重）**：一次写盘的目标文件与其内容必须同源——排空期间切换文件（核心**不等待** `onUnloadFile`）时，树快照与 frontmatter 一律按**该次写盘的文件**取，不同文件不再并入同一批次。此前可复现「**新文件的正文写进旧文件**」或「旧文件的 YAML frontmatter 被丢掉」
* **「清除链接」对嵌入无效、链接会复活**：`![[笔记]]` / `![[报告.pdf|300]]` 在字段被清空后仍整行回写。现在只有**指向本节点图片**的嵌入才在检测中排除，文档 / 附件嵌入按链接形态处理，清除后一并剥离
* **外链 md 图片被改写成非法 wikilink**：`![截图|300](https://…)` 在拖拽调宽或编辑文本后会写成 `![[https://…|300]]`（wikilink 目标不能是 URL → 图失效、alt 丢失）。现在外链判定先于「`image` 等于解析期目标」分支，恒写 `![alt|尺寸](url)`
* **未编辑也会改动原文的两类字符**：plain 行的**行首缩进**与**行尾空格**此前被 trim —— 4 空格缩进的**代码块退化为普通段落**，「行尾两空格 = 硬换行」被抹掉。现在 `mdRaw` 保存未 trim 原文，节点显示文本仍 trim（行首缩进不进节点文本）
* **跨文件夹移动后链接悬空**：`[[folder/笔记]]` + `folder/笔记.md` → `other/笔记2.md` 此前改写为 `[[folder/笔记2]]`（目标不存在）。现在链接**形态跟用户走**（有前缀继续写路径）但路径取新位置；裸名链接保持裸名；canvas/base 的文件名保留扩展名
* **`---` 分两种身份**：整行丢弃的规则会连 CommonMark 的 **setext H2 下划线**一起吞掉（`标题\n---` 是二级标题 → 被降级为段落），而 `=====` 却保留，两者不对称。现在**空行之后**的短横线行仍是结构分隔线（丢弃，行为不变），**紧跟非空行之后**的按 setext 下划线**保留**

<h3>行为变化提示（保真度提高）</h3>

* plain 行现在**逐字保真**：行首缩进与行尾空格不再被吃掉。若你此前依赖「保存即归一缩进」，请注意行为变化（文件内容会更接近原文，这正是「无损往返」的承诺）
* 列表 / 标题之后的 `---` 现在保留为独立分隔线，序列化器会补一个空行（此前整行消失）
* 列表续行的**行首缩进**仍按树深度归一为 2 空格（内容不丢），只有行尾空格改为保真

<h3>工程</h3>

* **测试 1174 → 1200**（38 个文件），新增 `tests/constants.test.ts`（33 例，锁定扩展名清单这类「漏登记即误判」的常量契约）
* **每处修复都做负向对照**：把修复退回旧实现，新用例必须变红（实测 3 / 3 / 4 / 6 / 2 / 3 条红），随后按 SHA256 校验复原
* 把 4 条「把旧缺陷当预期锁死」的用例改写为「已修复」（外链图片「已知降级」、plain 行 trim 归一、空列表项、续行 handle）
* 文档同步：`AGENTS.md` 与 `docs/markdown-mindmap-standard.md` 登记写盘归属不变式、`---` 两种身份、行级保真规则、清除链接口径，以及 `[[]]` / `![[]]` 支持度审计结论与四项决策（均「保持现状」并写明复查触发条件）

<h3>兼容性说明</h3>

* 与 0.0.x 一致：**需要 Obsidian 1.13.0+**，**仅桌面端**（`isDesktopOnly: true`）
* `.mindmap.md` 文件格式与命令 ID 均未变更；无破坏性变更。本版的行为差异只有「保真度提高」与「`---` 不再丢行」两类

---

<h3 id="en-v0.1.0">Added</h3>

* **Canvas / Bases are now document-class targets**: `![[Board.canvas]]` / `![[Table.base#View]]` share the document-wikilink channel — the hand-drawn document icon, hover preview and click-to-open all behave like note links; dragging a canvas/base file in from the file explorer also treats it as a document (`.md` drops the extension, non-Markdown documents must keep it). Links to `.base` files used to report "cannot preview"; they now open in a tab
* **Pipe content of non-image embeds is preserved verbatim**: editing a node no longer drops `|300` from `![[report.pdf|300]]`. The official docs never define that slot (PDFs use `#height=` / `#page=`, audio has no sizing syntax), so the plugin stores it as-is and writes it back unchanged

<h3>Fixed</h3>

* **The save drain could write to the wrong file when switching files (most serious)**: a write's target file and its content must belong to the same file — during the drain, snapshots and frontmatter are now taken **for the file being written** and different files never share a drain batch (core does **not** await `onUnloadFile`). It was reproducible that the **new file's body was written into the old file**, or the old file's YAML frontmatter was dropped
* **"Clear link" did nothing for embeds, so links came back**: `![[note]]` / `![[report.pdf|300]]` were still written verbatim after the link fields were cleared. Only embeds of the **node's own image** are excluded from the check now; document/attachment embeds are treated as links and stripped
* **External markdown images were rewritten into invalid wikilinks**: after resizing or editing text, `![shot|300](https://…)` became `![[https://…|300]]` — a wikilink cannot point at a URL, so the image broke and the alt text was lost. The remote-URL check now runs before the "image equals its parsed target" branch, always writing `![alt|size](url)`
* **Two kinds of characters were changed even without editing**: leading indentation and trailing spaces of plain lines were trimmed — a 4-space **indented code block degraded into a paragraph**, and the "two trailing spaces = hard line break" was erased. `mdRaw` now keeps the untrimmed source while the node's display text stays trimmed
* **Links went stale after moving a file across folders**: `[[folder/note]]` with `folder/note.md` → `other/note2.md` was rewritten to `[[folder/note2]]` (a dangling link). The link now keeps the user's shape (path stays a path) but takes the **new** location; bare links stay bare, and canvas/base names keep their extension
* **`---` has two identities**: the drop-the-whole-line rule also swallowed CommonMark **setext H2 underlines** (`title\n---` is an H2 heading and was downgraded to a paragraph) while `=====` survived — an asymmetry. A dash line **after a blank line** is still a structural separator (dropped, unchanged); one **directly after a non-blank line** is now **kept** as a setext underline

<h3>Behaviour changes (higher fidelity)</h3>

* Plain lines are now **verbatim**: leading indentation and trailing spaces are no longer eaten. If you relied on "save normalises indentation", note the change — file content now stays closer to the source, which is what lossless round-trip promises
* A `---` after a list or heading is now kept as a standalone separator (the serializer inserts a blank line); previously the whole line disappeared
* Continuation lines inside list items still normalise their **leading** indentation to 2 spaces per tree depth (nothing is lost); only trailing spaces became verbatim

<h3>Engineering</h3>

* **Tests 1174 → 1200** (38 files), including a new `tests/constants.test.ts` (33 cases) locking down constant contracts such as the openable-extension list, where a missing entry means a wrong "cannot preview"
* **Every fix carries a negative control**: reverting the fix to the old implementation must turn the new cases red (measured 3 / 3 / 4 / 6 / 2 / 3 failures), then the file is restored and verified by SHA256
* Four tests that had locked in old defects as expected behaviour were rewritten as "fixed" (external-image "known degradation", plain-line trimming, empty list item, continuation handling)
* Documentation: `AGENTS.md` and `docs/markdown-mindmap-standard.md` now record the write-ownership invariant, the two identities of `---`, the plain-line fidelity rules, the clear-link semantics, and the `[[]]` / `![[]]` support audit with its four "keep as-is" decisions and their recheck triggers

<h3>Compatibility notes</h3>

* Unchanged from 0.0.x: **requires Obsidian 1.13.0+**, **desktop only** (`isDesktopOnly: true`)
* The `.mindmap.md` format and command IDs are unchanged; nothing is breaking. The only behaviour differences are higher fidelity and `---` no longer disappearing
