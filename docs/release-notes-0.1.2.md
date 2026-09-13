[中文](#cn-v0.1.2) | [English](#en-v0.1.2)

0.1.2 是一次「结构整理 + 图片增强 + 回写保真」的版本：新增**混排双链拆分**（选中节点命令、编辑后自动、全文批量三种入口），段落（文本）节点支持**首行图片渲染**；图片链路做了成体系的修复与性能优化（加载期尺寸不回写、调宽写入合并、缓存 LRU / 跨会话）；回写层集中修复了一批**编辑后数据降级**问题（一行多图的嵌入语法、一行多链接 / 多 URL 的非首个 token、链接引用定义行），并再次调整「纯双链化」写入语义。底层 Markdown 无损往返、三类链接图标、官方尺寸语法、PNG 导出、搜索、性能模式均保持兼容。

<h3 id="cn-v0.1.2">新增</h3>

* **混排双链拆分**：与描述文字混排的文档 / 附件双链（如 `关于 [[冬天]] 和 [[秋天]] 的相关问题`）可抽离为子节点——父节点保留描述文字（链接处替换为可见名），每条链接一个子节点（各自拥有图标 / 悬停 / 点击）。三种入口：① 命令「拆分节点内双链为子节点」；② 编辑此类节点后**自动拆分**（设置项「自动拆分混排双链」，**默认开启**，可关闭；检查对象为编辑期捕获的节点，编辑提交后即使快速切换选中节点也不会漏拆）；③ 命令「拆分文档内全部混排双链」批量处理整篇（含未编辑的存量节点）。图片与外链不拆分、链接引用定义行不拆分、同一目标去重、重复执行幂等
* **段落节点首行图片**：段落（文本）节点首行的 `![[图.png]]` 现在会渲染为节点图片（可更换 / 移除）；段落中的链接语法仍按原文逐字保真

<h3>修复</h3>

* **回写保真：一行多张库内图片**：`![[a.png]] 与 ![[b.png]]` 此前**任何保存**都会把第二张图的嵌入语法降级为纯文件名文本（被误判为「残留链接」）；现按目标类型区分，图片类嵌入完整保留
* **回写保真：一行多链接 / 多 URL / 多图**：编辑此类节点后，非首个 token 此前会降级为文本（多裸 URL 连内容都会整体丢失）；现按原文完整保留——内容与语法不丢，为保持行结构稳定，额外 token 统一附于行尾，**所在位置可能与原文不同**
* **回写保真：链接引用定义行**（参考式 `[ref]: …` / 脚注 `[^1]: …`）：此前编辑含裸 URL 的定义行会把 URL 挪到行尾、`[ref]` 引用全部失效；现定义行整体按纯文本保真，拆分命令同样跳过定义行
* **frontmatter 写盘取磁盘现值**（数据安全）：写盘前重读文件，文件头以**磁盘当前内容**为准——视图打开期间在属性面板 / 其它窗格 / 其它设备（同步）改动的属性，不再被加载时的旧快照覆盖（此前偶有「笔记属性丢失」）
* **frontmatter 解析边界对齐 Obsidian**：空属性块（`---` 与 `---` 相邻、属性被删光）不再被并进正文；YAML 块标量（`|` / `>`）内部的 `---` 不再截断属性；开头 BOM 计入文件头原样保留（此前会导致首个标题降级为段落、首个列表项多出假缩进）
* **图片：加载期自动尺寸不再回写**：按原始比例自动算出的显示尺寸（非用户意图）不再写出 `|宽度`——此前从未编辑过的行可能在保存后凭空多出尺寸参数
* **图片：右键「移除图片」后不再复活**：此前在列表 / 标题节点移除图片，下一次保存会把原图写回（图片回写元数据被清理后，「图片已移除」判定失效、整行被逐字写回）；现判定不再依赖字段残留——`image` 为空且行内仍有图片语法（行内 `![[…]]` / `![…](…)`）即按移除处理，与段落节点同口径
* **拆分：运行期资源地址不再污染笔记**：此前图片节点的混排拆分会把运行期资源地址（`app://…#图.png?时间戳`）当作附件抽成子节点、URL 编码片段被写进父文本；现与序列化同入口携带 `app`，行内出现 `app://` 一律放弃拆分

<h3>性能</h3>

* **图片调宽写入合并**：拖拽按最小步长（8px）合并写入、松手补写最终尺寸——整树重排开销降一个量级；陈旧帧按会话所属引擎校验，不写进新引擎
* **图片尺寸缓存真 LRU**：命中提升，热点图不再被冷图挤出后重复解码
* **跨会话尺寸缓存**：经官方 `App#saveLocalStorage` 按库隔离——第二次打开同一库的图片尺寸零解码探测（外链与探测失败不落盘、数据损坏静默降级）
* **图片弹窗**：预览按解析结果去重，输入中间态不再逐键重建 DOM

<h3>行为变化提示</h3>

* **链接写入语义再修订**（0.1.1「无条件覆盖」→ 本版**仅「完全空白」节点覆盖**）：把链接（文档 / 附件 / URL）挂到节点时——**已有任何内容的节点**（文字 / 原链接 / 图片 / 行内额外 token）一律**建为子节点**，节点原内容完全不动（行内多链接不再被覆盖牵动）；只有**完全空白**节点才覆盖为链接节点。URL 链接仍保持「仅图标」（子节点文本为空）。注意：「一键改链」入口随之取消——改链请先「清除链接」再添加，或直接编辑节点文本

<h3>工程</h3>

* **测试**（全量 42 个文件 / 1327 例）：新增 `tests/view-split-links.test.ts`（自动拆分：设置开关 / 未编辑 / 编辑中与候选集语义）、`tests/agents-md-sync.test.ts`（**文档-代码同步契约**：`src/**` 与 `tests/**` 每个文件必须登记在 AGENTS.md，漏登记即红灯）；`tests/links-split.test.ts` 扩为全规则矩阵（含链接引用定义行跳过、拆分后多 token 重建）；`tests/md-roundtrip.test.ts` 补回写保真用例组（一行多图、多链接 / 多 URL / 多图编辑后保真、定义行 4 形态 + 不误伤对照）；frontmatter（CRLF / 空块 / 块标量 / BOM）、图片尺寸与缓存、自动拆分候选、引擎事件转发契约等回归补强
* **文档**：AGENTS.md 重构为 **K 编号分组体系**（K1–K49 稳定引用 ID + 「新增功能检查清单」+ 「本文件维护规则」）；标准文档同步（拆分规则、回写保真与已知降级表）；README 修正链接写入语义
* **校验**：类型检查 0 错误、eslint 0 警告、全量测试全绿

<h3>兼容性说明</h3>

* 与 0.1.1 一致：**需要 Obsidian 1.13.0+**，**仅桌面端**（`isDesktopOnly: true`）
* 新增两条命令（`mindmap-split-links` / `mindmap-split-links-all`）与一个设置项「自动拆分混排双链」（默认开启）；既有命令 ID 与 `.mindmap.md` 格式均未变更
* 链接写入语义修订见上——依赖 0.1.1「无条件覆盖」或旧「纯双链节点改链」行为的用户请留意；回写保真的「额外 token 附于行尾」说明见修复条目

---

<h3 id="en-v0.1.2">Added</h3>

* **Mixed wikilink splitting**: document / attachment wikilinks mixed with descriptive text (e.g. `about [[winter]] and [[autumn]]`) can be extracted into child nodes — the parent keeps its text (each link replaced by its display name) and every link becomes its own child node (with icon / hover / click). Three entry points: ① command "Split links into child nodes"; ② **automatic splitting** after editing such a node (setting "Auto-split mixed links", **on by default**; the check runs against nodes captured while editing, so switching selection right after committing an edit never misses a split); ③ command "Split all mixed links in document" for the whole note (including untouched nodes). Images and external URLs are never split, link reference definition lines are skipped, identical targets are deduplicated, and repeated runs are no-ops
* **Paragraph-node first-line images**: an inline `![[img.png]]` on the first line of a paragraph (text) node now renders as the node image (replaceable / removable); link syntax inside paragraphs is still preserved verbatim

<h3>Fixed</h3>

* **Write-back fidelity: two inline images on one line**: `![[a.png]] and ![[b.png]]` used to have its second embed downgraded to plain filename text on **any save** (misdetected as a "leftover link"); image embeds are now recognised by target type and preserved
* **Write-back fidelity: multiple links / URLs / images on one line**: editing such a node used to downgrade the non-first tokens to text (a second bare URL even lost its content entirely); all tokens are now preserved verbatim — nothing is lost, but to keep the line structure stable the extra tokens are appended at the end of the line, so their **position may differ from the original**
* **Write-back fidelity: link reference definition lines** (`[ref]: …` / `[^1]: …`): editing a definition line containing a bare URL used to move the URL to the end and break every `[ref]` reference; definition lines are now kept as plain text, and the splitting command skips them as well
* **frontmatter is saved from the current on-disk value** (data safety): before writing, the file is re-read and the header is taken from the **current disk content** — properties changed in the properties panel / other panes / other devices (sync) while the view is open are no longer overwritten by the load-time snapshot (previously an occasional "lost note properties")
* **frontmatter parsing boundaries aligned with Obsidian**: an empty property block (`---` directly followed by `---`) is no longer merged into the body; a `---` inside a YAML block scalar (`|` / `>`) no longer truncates the properties; a leading BOM is kept in the header (previously it could demote the first heading to a paragraph and add a phantom indent to the first list item)
* **Images: load-time auto sizing is no longer written back**: display sizes computed from the natural aspect ratio (not a user intent) no longer produce `|width` — previously an untouched line could gain a size parameter after saving
* **Images: "Remove image" no longer brings the image back on save**: removing an image from a list / heading node used to write it back on the next save (once the image write-back metadata was cleared, the "image removed" detection no longer triggered and the line was written verbatim); detection no longer relies on leftover fields — an empty `image` with inline image syntax still present (`![[…]]` / `![…](…)`) is treated as removed, matching paragraph nodes
* **Splitting: runtime resource addresses no longer leak into notes**: image-node splitting used to treat runtime resource addresses (`app://…#img.png?timestamp`) as attachments and write URL-encoded fragments into the parent text; splitting now shares the serializer's `app` context and bails out entirely when `app://` appears

<h3>Performance</h3>

* **Image resize write coalescing**: drag updates are merged by a minimum step (8px) with a final write on release — re-layout cost drops by an order of magnitude; stale frames are validated against the session's engine and never written into a new one
* **True LRU image-size cache**: hits are promoted, so hot images are no longer evicted by cold ones and re-decoded
* **Cross-session size cache**: via the official `App#saveLocalStorage`, isolated per vault — reopening the same vault re-decodes nothing (external URLs and failures are not persisted; corrupted data degrades silently)
* **Image dialog**: previews are deduplicated by parse result; intermediate input no longer rebuilds the DOM on every keystroke

<h3>Behaviour changes</h3>

* **Link write semantics revised again** (0.1.1 "unconditional overwrite" → now **overwrite only for a completely blank node**): attaching a link (document / attachment / URL) to a node that **already has any content** (text / an existing link / an image / inline tokens) now always creates a **child node** and leaves the node untouched — inline multi-link lines are no longer disturbed by overwrites; only a **completely blank** node is replaced by the link node. URL links stay icon-only (the child node has no text). Note: the one-step "re-link" entry is gone — to change a link, clear it first and add the new one, or edit the node text directly

<h3>Engineering</h3>

* **Tests** (full suite: 42 files / 1327 cases): added `tests/view-split-links.test.ts` (auto-split: setting toggle / untouched / editing state and candidate-set semantics) and `tests/agents-md-sync.test.ts` (**docs-code sync contract**: every file under `src/**` and `tests/**` must be registered in AGENTS.md — an omission turns a test red); `tests/links-split.test.ts` expanded into a full rule matrix (including definition-line skip and post-split multi-token rebuild); `tests/md-roundtrip.test.ts` gained the write-back fidelity group (two inline images, multi-link / multi-URL / multi-image fidelity after editing, definition lines in 4 forms plus non-regression controls); further coverage for frontmatter (CRLF / empty block / block scalar / BOM), image sizing and caching, auto-split candidates and engine-event forwarding contracts
* **Docs**: AGENTS.md restructured into a **K-numbered, grouped system** (stable reference IDs K1–K49 + "new-feature checklist" + "maintenance rules for this file"); mapping standard refreshed (splitting rules, write-back fidelity and the known-degradation table); README link-write semantics corrected
* **Checks**: type-check 0 errors, eslint 0 warnings, full test suite green

<h3>Compatibility notes</h3>

* Unchanged from 0.1.1: **requires Obsidian 1.13.0+**, **desktop only** (`isDesktopOnly: true`)
* Two new commands (`mindmap-split-links` / `mindmap-split-links-all`) and one setting ("Auto-split mixed links", on by default); existing command IDs and the `.mindmap.md` format are unchanged
* The link write-semantics revision is described above — users relying on 0.1.1's unconditional overwrite or the previous "re-link a pure-wikilink node" behaviour should take note; see the Fixed section for the "extra tokens appended at line end" note on write-back fidelity
