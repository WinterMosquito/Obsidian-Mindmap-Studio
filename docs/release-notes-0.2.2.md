[中文](#cn-v0.2.2) | [English](#en-v0.2.2)

0.2.2 让**节点成为可搬运的编辑对象**，并把大图与公式的几处显示退化修到位：节点复制 / 剪切 / 粘贴改走**系统剪贴板**（内容为纯 Markdown 大纲，可在导图与任意编辑器之间搬运），新增**节点上移 / 下移**、**新建导图的默认位置**四档设置与 **GFM 管道表渲染**；同时修复 MathJax 4 下公式退为「回退字体 + 无间距」、大图「适应画布 → 重置缩放」偏移、公式「永久字面」与节点隐藏后塌陷等实机缺陷；另含**自动保存数据安全、删除节点竞态、画布快捷键失效、超大表格消失**等多项可靠性修复。

<h3 id="cn-v0.2.2">新增</h3>

* **节点剪贴板：复制 / 剪切 / 粘贴走系统剪贴板**：`Ctrl`/`Cmd`+`C` / `X` / `V` 把选中子树序列化为**纯 Markdown 大纲文本**（缩进表层级、标题降为 `-` 项、有序项保留 `1.`）写入**系统剪贴板**——可粘进任意编辑器，也可把任意大纲粘回导图（成为选中节点的子节点）。剪切**正常不弹提示**，仅选中中心节点时静默且不动剪贴板；剪贴板为空与无法访问分开提示。此前剪贴板是引擎内部 JSON（内容不离开插件），此版起**内容进入系统剪贴板**（见兼容性说明）
* **节点上移 / 下移**：节点右键菜单新增**「上移节点」/「下移节点」**——与相邻兄弟交换、走正常自动保存（一步 `Ctrl`/`Cmd`+`Z` 可撤销）；中心节点与首/末位给出提示而非移动
* **新建导图的默认位置（四档）**：设置新增「新建导图的默认位置」——**跟随 Obsidian 设置**（默认，即官方「新建笔记的默认位置」）／仓库根目录／当前文件所在文件夹／指定的文件夹（第四档另有「目标文件夹」输入，切档即时生效）。后两档无法解析时静默回落仓库根目录（不自动创建文件夹）。顺带修掉「当前文件夹」档此前**永不生效**的缺陷（内部 `sourcePath` 恒为空串）
* **GFM 管道表在节点内渲染为真表格**：表头行 + 分隔行成对才成立；**只以内容盒为宽顶**（单元格折行、不撑爆节点、不设高度上限——表格不允许超宽）；表格**要么整张显示、要么整张不显示**（沿用链接段的截断口径）；单元格转义 `\|` 还原、列数不足补空；围栏代码块与块级数学**内**的表格行不识别；**导出 SVG 同样带表格**（结构与边框内联，导出图保真）

<h3>修复</h3>

* **MathJax 4 下公式退为「回退字体 + 无 TeX 间距」（本版最重要的显示修复）**：升级到 MathJax 4 后，公式渲染为系统回退字体、加号 / 等号两侧的间距塌缩，且**关闭再打开文件也不自愈**。根因：v4 把字符改为真实文本节点后，插件的「就绪判据」恒为真 ⇒ 官方 `finishRenderMath` 从未被驱动 ⇒ 样式表从未挂进文档。现在冷态打开导图即自动挂载样式表，间距与字体恢复正常
* **大图「适应画布 → 重置缩放」视图偏右（用户报告）**：性能模式（>500 节点）下 fit 后 reset 会被 100% 缩放放大残差；现在两步之后位移为 0，并补正「大图全新打开时首帧几何未收敛」（1000 节点图此前 8 秒后仍偏 24.97px）
* **公式不再「永久字面」**：字体未就绪 + 等待预算耗尽后，节点重进视口仍显示 `$…$` 的问题已修（未定稿段可被症状修复）；多视图 / 代码块嵌入并存时不再误清其他宿主的未定稿段
* **数学 / 代码内容节点在隐藏后不再永久塌陷**：在隐藏叶子里被量测为 0×0 的节点，现由隐藏→可见的四路自愈恢复（含「重试到期前宿主又被切走」的竞态）
* **焦点在编辑区时画布不再抢粘贴**：窗口级粘贴此前会劫持别处 contenteditable 编辑区的粘贴；现在只在本视图持有焦点并选中节点时接管
* **阅读视图进入导图后，「以 Markdown 打开」/「切换回 Markdown」恒落编辑视图**：进入前的编辑/阅读模式此前**从未被读回**（视图状态未覆写 `getState` ⇒ `mdBackMode` 不随状态保存，读点又依赖它）；现在模式随视图状态**跨会话保留**，三个入口都恢复进入前模式；文件右键入口在导图位于后台标签时改为**把它带到前台**（此前会顶掉当前标签页）
* **自动保存的两条数据安全缺陷**：「不同文件重入」分支曾漏传外部改动检测 ⇒ 跨文件自动保存时不再提示外部修改；冲突提示标记只增不删 ⇒ 同一文件二次冲突被静默扣住、不再写盘。两者都已修复——跨文件重入仍检测外部改动，冲突解除后自动保存恢复写盘（不再覆盖你在别处的编辑）
* **切换 UI 语言后命令面板残留旧语言命令**：命令 ID 表改为**单一来源**（注册点与「语言变更先移除再重注册」共用同一份），切换语言不再留下旧语言的重复命令项
* **删除节点偶尔删错**：显式摘除引擎侧绑定的 `Delete`/`Backspace`（此前插件与引擎两条删除通道并存，顺序竞态下引擎先删会自动激活兄弟节点，插件随后删掉的可能不再是原节点）
* **节点内点击代码块复制按钮 / 外链后，画布快捷键失效**：新增**快捷键前置闸门**——自绘内容里的可聚焦元素（代码块复制 `<button>`、外链 `<a>`）不再吞掉 `Ctrl`/`Cmd`+`C`/`X`/`V` 与 `Delete` 等画布快捷键
* **超大表格整张不显示**：纯表格节点超过预算时此前只剩一个 `…`（1999 字显示整表、2000 字什么都不显示）；现在表格自身在预算内时整张保留并明示截断（与 GFM 表格渲染配套）
* **「指定文件夹」档的反斜杠路径不生效**：新建导图默认位置的「指定文件夹」输入经路径归一化，粘贴 `笔记\导图` 这类形态不再静默回落库根
* **大图（性能模式 ≥500 节点）视口恢复更可靠**：可见性判定改用数据层盒，保存视口落界的护栏在大图上重新可达；畸形视口状态只丢弃该字段而非整条，不再每次打开都走 fit（日志也不再误导为「恢复视图状态失败」）

<h3>工程</h3>

* **剪贴板收口**：视图级 WeakMap 剪贴板整体删除，复制 / 剪切 / 粘贴收口到 `features/view-clipboard.ts` + `platform/clipboard.ts`（系统剪贴板访问只此一处）；大纲的序列化 / 解析复用往返实现（`serializeSubtreesToOutline` / `parseMdOutlineFragment`），复制的子树按**文档序**排名、剥 uid 深拷贝（与主文档互不干扰）
* **保存位置落点解析收口**：默认档经官方 `FileManager.getNewFileParent` 完整跟随「新建笔记的默认位置」，与 Obsidian Canvas 同口径
* **数学就绪判据换锚**与**判定序收紧**（行为等价）：判据从「字符宽度 > 0」改为「本段字符的规则已落盘（v4）+ 宽度 > 0」；规则索引三态化、缓存键 =（样式表元素, 规则条数）——外部通道挂载样式表时同样同步；判定序为「规则（免布局）→ 宽度（可见字符零样式查询）→ 仅零宽字符查 `::before`」，并新增性能契约用例锁定该开销面
* **GFM 表格纯逻辑落 `domain/pipe-table.ts`**（识别唯一实现，零依赖）；DOM 装配在 `node-inline-content`（样式全内联，导出 SVG 不含插件 CSS 仍然保真）
* **视口几何修复的机制**：`syncCanvasGeometry` 报告尺寸变化并**提前启动**待跑渲染（零额外渲染），渲染落地后由 `scheduleCenteringCorrection` 补正居中（3 秒窗口跟随渲染、几何指纹收敛即停）；居中判定收口 `centerContentByDataBox`（fit / 打开视口 / 补正三处共用）；`resetZoom` 锚点改为**实时容器中心**
* **移动节点走防腐层**：`moveNodeInSiblings` 下沉 `engine/mindmap` 具名入口，并以 `tests/engine-node-move.test.ts` 直测
* **进入前模式的读入/写回收口**：读入点 = `MindMapView.setState` 覆写（官方 `setViewState` 把传入 state 原样交给 `view.setState`——唯一权威来源），写回点 = `MindMapView.getState` 覆写（官方 `leaf.getViewState()` 的 state 只取自 `view.getState()`，基类只回 `file`）；新增 `tests/view-md-back-mode.test.ts` 5 例钉住链路两端（含键名一致）
* **门禁与回归**：`verify:visual` 新增 `table` 与 `viewport-geometry` 探针（后者含 red 验证：临时禁用补正即报 `(100, 0)px` 超阈）；新增 `pipe-table` / `clipboard-outline` / `engine-node-move` 直测；数学新增「v4 未 flush：宽 > 0 也判未就绪」回归用例
* **发版前实机复核**：真冷态（页面重载，等同全新会话）打开 2000 节点图——数学样式表由修复路径自动挂载（11862 字节）、节点 997 形态正确、0 处字面残留；大图 fit→reset 位移 0（500 / 1000 节点双图实测）；全程 `obsidian dev:errors` 无条目
* **多处判定与读写面收口**：命令 ID 表改为单一来源（`commands.ts`，修复语言切换残留旧命令）；视口读写收口进引擎层（`readViewportState` / `applyViewportState` / `getViewportSignature`，services 不再触碰引擎内部形态）；「取节点 data 字符串」「文件名的 URL 编码形态」「文本是否被编辑」三处判定分别收口到 `core/node-data.readNodeDataString` / `domain/url.encodedNameForm` / `domain/md-meta.isNodeTextEdited`；剪贴板写入面（`platform/clipboard`）加属主文档参数，popout 副窗口的复制链接 / 复制代码块恢复可用
* 测试全量 **80 文件 / 2146 例**

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* **`styles.css` 无变化**（本版未改样式表）；仍建议与 `main.js` 一起替换以保持版本一致
* **设置新增两个键**（`saveLocation` / `saveFolder`，带默认值，旧 `data.json` 自动取默认）；命令 ID、导图文件格式、往返保真契约均不变
* **复制中心节点不再把整篇导图嵌进自己**：复制路径此前不过滤根节点（引擎 `copyNode` 与 `cutNode` 的口径差异），右键中心节点「复制节点」后粘贴会把整棵树作为子节点插入、反复操作指数级膨胀；现与剪切同口径过滤根节点（只选中根时提示先选节点）
* **启动恢复的后台标签首次切回时，公式 / 代码块的自绘尺寸自愈不再落空**：视图打开时补一次可见性采样——此前「从未在隐藏态被采样过」的叶子在首次可见时自愈分支零成本早退，隐藏态量到的 0×0 内容可能永久塌陷
* **永远不就绪的数学段不再烧 CPU**：未定稿段的修复路径每次重入都会重建整份重试预算，现累计若干次后放弃并留一条告警，该段保持可见字面
* ⚠ **行为变化：`Ctrl+C/X/V` 走系统剪贴板**——复制 / 剪切的内容成为**纯 Markdown 文本**，会进入系统剪贴板历史 / 跨设备同步（视你的系统设置）；此前的引擎内部剪贴板（内容不离开插件）不再使用

---

<h3 id="en-v0.2.2">Added</h3>

* **Node clipboard: copy / cut / paste via the system clipboard**: `Ctrl`/`Cmd`+`C` / `X` / `V` serialise the selected subtree into plain **Markdown outline text** on the **system clipboard** (indentation = levels; headings flatten to `-` items; ordered items keep `1.`) — paste it into any editor, or paste any outline back into the map as child nodes of the selection. A normal cut shows no notice; cutting the central node is silent and leaves the clipboard untouched; an empty and an inaccessible clipboard are reported separately. The clipboard used to be the engine's internal JSON (content never left the plugin) — it is now the **system clipboard** (see Compatibility notes)
* **Move node up / down**: the node context menu gains **Move node up** / **Move node down** — swaps a node with the adjacent sibling and goes through the normal auto-save (one `Ctrl`/`Cmd`+`Z` undoes it); the central node and the first/last position show a notice instead of moving
* **Default location for new mind maps (four modes)**: a new setting — **Follow Obsidian setting** (default, i.e. Obsidian's own "Default location for new notes") / vault root / same folder as the current file / a fixed folder (the last mode reveals a **Target folder** field; switching modes applies immediately). The last two fall back to the vault root when unresolvable (no folders are auto-created). This also fixes the "current folder" mode that **never took effect** (the internal `sourcePath` was always an empty string)
* **GFM pipe tables render as real tables inside nodes**: a header row + a separator row are required; the table is **capped by the content box** (cells wrap, the node is never stretched, no height limit — a table may not overflow); a table renders **all or nothing** (matching the link-segment truncation rule); `\|` escapes are restored and short rows are padded; table rows inside fenced code or block math are **not** recognised; **SVG export includes the table** (structure and borders are inlined, so the exported image stays faithful)

<h3>Fixed</h3>

* **Formulas fell back to a system font with no TeX spacing under MathJax 4 (the most visible fix in this release)**: after MathJax 4, formulas rendered in a fallback font with the spacing around `+` / `=` collapsed, and **reopening the file did not help**. Root cause: with v4 characters becoming real text nodes, the plugin's "product ready" predicate was always true, so the official stylesheet flush was never driven. Now the stylesheet is mounted automatically on a cold open and both spacing and fonts are correct
* **Large-map "Fit to canvas → Reset zoom" offset (user-reported)**: in performance mode (500+ nodes) resetting the zoom after a fit amplified the layout residual; both steps now leave the view at exactly 0 offset, and the "first-frame geometry not settled" case (a 1000-node map stayed 24.97px off even after 8 seconds) is corrected as well
* **Formulas no longer get stuck as literal text**: after the font-wait budget expired, a node re-entering the viewport kept showing `$…$`; unsettled segments can now be repaired in place, and multi-view / code-block-embed coexistence no longer clears other hosts' unsettled segments
* **Math / code content nodes no longer stay collapsed after being hidden**: nodes measured 0×0 inside a hidden leaf recover through four hidden→visible self-heal paths (including the race where the host is switched away again before the retry)
* **The canvas no longer steals pastes from an editor holding focus**: window-level paste handling no longer hijacks pastes in other contenteditable editors; it only takes over while this view has focus and a node is selected
* **Copying the central node no longer nests the whole map inside itself**: the copy path did not filter the root node (the engine filters it in `cutNode` but not in `copyNode`), so copying the central node and pasting inserted the entire tree as a child — repeated pastes grew the document exponentially; the root is now filtered exactly like in cut (with only the root selected, the plugin tells you to select a node first)
* **Math / code self-healing now also covers a leaf revealed later**: a view takes one visibility sample when it opens, so leaves that were never sampled while hidden no longer skip the recovery branch on their first reveal
* **A permanently unready math segment no longer burns CPU**: the repair path for unsettled segments (which rebuilds its full retry budget on every re-entry) now stops after a small number of attempts and leaves one warning; the segment keeps its visible literal
* **After entering a map from the reading view, "Open as Markdown" / "Back to Markdown" always landed in the editing view**: the pre-entry edit/reading mode was never read back (the view state did not override `getState`, so `mdBackMode` was not carried by the state, while the read path depended on it); the mode is now kept in the view state **across sessions** and all three entry points restore it; the file-menu entry now **brings the map tab to the front** when it sits in a background tab (it used to replace the active tab instead)
* **Two auto-save data-safety defects**: the "different file" re-entrancy branch used to drop the external-change check, so cross-file auto-save no longer warned about external edits; and the conflict flag was only ever added (never cleared), so a second conflict on the same file was silently suppressed and the file stopped being written. Both are fixed — cross-file re-entrancy still checks for external edits, and once a conflict clears, auto-save resumes writing (it no longer overwrites your edits made elsewhere)
* **Switching the UI language left stale commands in the command palette**: the command-ID table is now a **single source of truth** (registration and "remove-then-re-register on language change" share it), so switching languages no longer leaves duplicate commands from the old language
* **Deleting a node occasionally deleted the wrong one**: the engine's own `Delete`/`Backspace` binding is now explicitly removed (the plugin and the engine used to run two delete paths in parallel, and an ordering race could let the engine delete and auto-activate a sibling first, after which the plugin deleted a different node)
* **Canvas shortcuts died after clicking a code-block copy button / external link inside a node**: a new **shortcut pre-gate** stops focusable elements in the inline content (the code-block "Copy code" `<button>`, external `<a>`) from swallowing `Ctrl`/`Cmd`+`C`/`X`/`V` and `Delete` and the other canvas shortcuts
* **Huge tables vanished entirely**: a table-only node over budget used to show nothing but a lone `…` (1999 chars showed the whole table, 2000 chars showed nothing); now a table within budget is kept whole and truncation is explicit (matching the GFM table rendering)
* **Backslash paths in the "specified folder" mode did nothing**: the "Default location for new mind maps" → "Target folder" input is now path-normalised, so pasting a shape like `Notes\Maps` no longer silently falls back to the vault root
* **Large-map viewport restore is more reliable**: the visibility check now uses the data-layer box, so the "save viewport bounds" guard is reachable on large maps (performance mode, 500+ nodes) again; a malformed viewport state now drops only that field instead of the whole record, and no longer forces a fit on every open (with a misleading "failed to restore view state" log)

<h3>Engineering</h3>

* **Clipboard consolidation**: the view-level WeakMap clipboard is gone entirely; copy / cut / paste live in `features/view-clipboard.ts` + `platform/clipboard.ts` (the single system-clipboard access point); serialisation / parsing reuses the round-trip implementation (`serializeSubtreesToOutline` / `parseMdOutlineFragment`), and copies are ranked in **document order** with uid-stripped deep clones (independent of the live document)
* **Save-location resolution consolidated**: the default mode follows "Default location for new notes" through the official `FileManager.getNewFileParent`, matching Obsidian Canvas
* **Math readiness predicate re-anchored** and its **decision order tightened** (behaviour-equivalent): readiness is now "this segment's character rules have landed (v4) + width > 0"; the rule index is three-state with a (stylesheet element, rule count) cache key, so an externally mounted stylesheet is picked up as well; the order is "rules (no layout) → width (zero style queries for visible characters) → `::before` lookup for zero-width characters only", locked by a performance-contract case
* **GFM table recognition lives in `domain/pipe-table.ts`** (the single zero-dependency implementation); the DOM assembly sits in `node-inline-content` with all styles inlined, so exported SVG stays faithful without the plugin CSS
* **Viewport-geometry mechanics**: `syncCanvasGeometry` reports size changes and **starts the pending render early** (zero extra renders); once the render lands, `scheduleCenteringCorrection` re-centres (a 3-second window following renders, stopping when the geometry fingerprint converges); centre-keeping is consolidated into `centerContentByDataBox` (shared by fit / open / correction); `resetZoom` now anchors to the **live container centre**
* **Node moving goes through the anti-corruption layer**: `moveNodeInSiblings` moved down into a named `engine/mindmap` entry, covered directly by `tests/engine-node-move.test.ts`
* **Pre-entry mode read/write consolidation**: the read-in point is the `MindMapView.setState` override (the official `setViewState` hands the incoming state to `view.setState` verbatim — the single authoritative source), and the write-back point is the `MindMapView.getState` override (the official `leaf.getViewState()` takes its state solely from `view.getState()`, whose base only returns `file`); new `tests/view-md-back-mode.test.ts` with 5 cases pinning both ends of the chain (including key-name consistency)
* **Gates and regressions**: `verify:visual` gains `table` and `viewport-geometry` probes (the latter carries a red test — disabling the correction reports `(100, 0)px` over the threshold); new direct tests for `pipe-table` / `clipboard-outline` / `engine-node-move`; a "v4 not flushed: width > 0 is still not ready" regression case for math
* **Pre-release pass on a real vault**: a true cold start (page reload, i.e. a fresh session) on a 2000-node map — the math stylesheet is mounted by the repair path itself (11862 bytes), node 997 is shaped correctly, and no literal residue remains; fit→reset displacement is 0 on both 500- and 1000-node maps; no `obsidian dev:errors` entries throughout
* **Several judgement and read/write surfaces consolidated**: the command-ID table is now a single source of truth (in `commands.ts`, fixing the stale-language commands in the palette); viewport read/write moved into the engine layer (`readViewportState` / `applyViewportState` / `getViewportSignature`, so services no longer touch engine internals); the "read node data string", "URL-encoded name form" and "is node text edited" checks now each have one home (`core/node-data.readNodeDataString` / `domain/url.encodedNameForm` / `domain/md-meta.isNodeTextEdited`); the clipboard write surface (`platform/clipboard`) takes an owning document, so copy-link / copy-code inside a popout window works again
* Full test suite: **80 files / 2146 cases**

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* **`styles.css` unchanged** (no stylesheet edits in this release); replacing it together with `main.js` is still recommended to keep the version consistent
* **Two new settings keys** (`saveLocation` / `saveFolder`, defaulted — older `data.json` picks the defaults up); all command IDs, the mind map file format and the lossless round-trip contract are unchanged
* ⚠ **Behaviour change: `Ctrl+C/X/V` now goes through the system clipboard** — copied / cut content becomes **plain Markdown text** and may enter your system clipboard history / cross-device sync (depending on your OS settings); the engine's internal clipboard (content never leaving the plugin) is no longer used
