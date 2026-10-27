[中文](#cn-v0.2.6) | [English](#en-v0.2.6)

0.2.6 是「给节点上色」的一版：右键任何节点 → **配色**，选五种预设或**自定义颜色**，写进正文的是一段 `%%#89CFF0%%` 注释指令——**导图里是颜色，Markdown 里仍是标准注释**。该节点与全部后代一起改填充 / 边框 / 连线，文字色按底色自动取深浅，子节点可再染（就近覆盖），删掉指令即回落整篇配色。右键**空白处**的「配色」也新增**自定义**：输入一个主色，自动派生整套亮暗色板。另有两处顺手修复：**重新打开导图会自动重试上次加载失败的图片**；右键菜单的二级菜单改用宿主**原生级联**（悬停展开、贴住父项）。

<h3 id="cn-v0.2.6">新增</h3>

* **节点配色（右键节点 → 配色）**：**默认 / 薄荷 / 琥珀 / 紫藤 / 森林 / 石板 / 自定义…**；预设色取各配色方案的根节点主色（写进 Markdown 后不随亮暗主题变）
  * **指令写在正文顶层**：`%%#89CFF0%%` 是 Obsidian 标准注释语法——阅读视图、大纲与其它工具里它就是一段注释，导图视图把它读成颜色指令；围栏代码 / 行内代码 / 数学里的同形态**不识别**（不会改用户的代码）
  * **落点不破坏块语法**：多行节点写在**末行**；末行是代码块或表格时**另起一行**（接在闭合围栏后面会让围栏失效，整套同级节点会被吞进代码）
  * **作用范围**：该节点 + 全部后代一起改**填充 / 边框 / 连线**色；**就近覆盖**——子节点再染色则只覆盖自己与自己的后代
  * **「默认」= 回到整篇配色**：不管父节点染了什么色，点了就恢复成整篇配色的样子（彩色子树里想让某一个分支回到主题外观，也用它）。写进文件的形式有两种、导图上完全等价：上层还在染色时写一条 `%%none%%` 注释挡住继承，上层本就没色就直接删掉指令、不留注释
  * **文字色自动对比**：首选柔和深灰蓝 `#111827`，对比度不足 4.5 时在纯黑 / 纯白里取更大者——浅色节点不会白底白字，任意自定义色都可读；**只作用于被染色的节点**
  * **多选只染最上层**：框选多个节点再点颜色，只给最上层写指令，其余靠继承
  * **不进撤销历史、不写 `data.json`**：颜色是显示层的派生状态，删掉正文指令即回落；编辑 / 撤销后在渲染落地时自动重算，颜色没变不多渲染一轮
  * **小地图跟随**：缩略图的节点块按各自颜色上色；只改颜色（几何没变）也立即换图
  * **染色节点内的轻排版从底色派生**：行内码 / 表头取同色阶（近白 / 近黑时向墨色收）、表格线与外框用 45% 墨色、链接改墨色 + 下划线（蓝字在浅色底上无法达标，改用形状线索）、高亮改实心黄 + 黑字、删除线不再叠 75% 透明度；**未染色节点的观感逐字不变**（对照组用例锁死）
  * **已知边界**：含图节点与「整行只有指令」的节点不自绘，指令按字面显示（与既有注释同口径）
* **自定义颜色弹窗**（两处「自定义…」共用）：收十六进制（`#89CFF0`）或 RGB（`137, 207, 240`），统一归一为 `#rrggbb`；**色块实时预览**，无法识别时红字提示且不落盘（节点侧预填当前色，方便从预设微调）
* **整篇配色支持自定义**：右键**空白** → 配色 → **自定义…**，输入一个主色即派生五档（根 = 原色、二级 / 三级向画布底色靠 86% / 93%、描边 50%、连线 35%，文字色按亮度现算）；按文件记在 `data.json`，与六个预设同一条读取通道
* **重新打开导图自动重试失败图片**：图片加载失败的记忆（5 分钟 TTL）原本跨打开周期也生效，瞬态失败（同步刚落地、库索引未就绪）要等 5 分钟；现在打开路径按本文件的图逐个解除，其它导图的坏图记录不受影响

<h3>变更</h3>

* **右键「配色」按落点分两义**：在**节点上** = 给该节点 / 子树染色（写正文指令）；在**空白处** = 改整篇配色（写 `data.json`）。此前只有后者，菜单项同名但落点不同
* **二级菜单改用宿主原生级联**：布局 / 配色的子菜单悬停约 250ms 展开、贴住父项、自带箭头；宿主不支持时回退「点击 → 光标处弹出」（0.2.5 的独立弹出菜单保留为兜底）
* **自动整理后小地图立即跟进**：重排是异步分片渲染，此前缩略图最长 30 秒仍是旧轮廓；现在挂「渲染落地补画」，与切换布局同一条通道

<h3>工程</h3>

* **新模块**：`domain/color.ts`（十六进制 / RGB 归一、WCAG 亮度与对比度、混色、「就近覆盖」遍历——纯逻辑零依赖）；`engine/mindmap-colors.ts`（指令 → 节点 data 的填充 / 连线 / 描边 / 文字色四键）；`engine/mindmap-palette.ts`（预设 id 与自定义十六进制的**唯一分派点**）；`features/view-node-color.ts`（菜单动作）；`ui/modal-color.ts`（弹窗）
* **指令的读 / 写只此一份**：扫描与 `%%注释%%` 的轻标记正则**同源**（保护区语义不会漂移）；写入是节点行原文的唯一改写入口（多余指令一并清掉、不留双空格）
* **应用时机**：创建引擎**前**写进 data 树（引擎会克隆数据，建好再改无效）；视图与 `mindmap` 代码块嵌入两处都染色（嵌入只读、无实时同步）
* **死代码 / 注释清理**：注释与实现相反的 8 处订正（文字色算法、配色派生归属、`MARKUP_RE` 与指令的关系等）；`conventions.md` K145 与 K146 的自相矛盾就地订正；豁免表两表按实测回填；`.mindmap-color-invalid` 补上缺失的错误色样式
* 测试全量 **88 文件 / 2450 例**；本地门禁 `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `check:release` / `verify:visual` 全绿

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* **`styles.css` 有变化**（自定义颜色弹窗的预览色块与错误提示），**请与 `main.js` 一起替换**
* **无新增设置键，也没有新命令**；`data.json` 结构不变（`viewState.palette` 的值域扩展：除六个预设 id 外可存自定义 `#rrggbb`，旧值照读）
* 正文新增的 `%%#hex%%` 指令：在阅读视图 / 大纲 / 其它编辑器里就是一段注释，不参与渲染；不合法的值（`%%备注%%`、4 / 8 位十六进制、`rgba`、`%%#none%%`）**按普通注释处理**（同样隐藏、不染色）；`%%none%%` 是唯一合法的非颜色值（＝「默认」写进文件时的形态，阻断父色继承）
* 导图文件格式、往返保真契约与命令 ID 均不变

---

0.2.6 is about colouring nodes: right-click any node → **Colour** and pick one of five presets or a **custom colour**. What lands in the file is a `%%#89CFF0%%` comment directive — **a colour in the mind map, still a plain comment in Markdown**. The node and all of its descendants change fill / border / connector colour together, the text colour is picked automatically for contrast, children can be re-coloured (nearest wins), and removing the directive falls back to the document palette. The **blank-area** colour menu also gains **Custom**: enter one hue and a full light/dark palette is derived from it. Two smaller fixes: **reopening a map now retries images that failed to load last time**, and the right-click menu's submenus switched to the host's **native cascading menus** (open on hover, anchored to the parent item).

<h3 id="en-v0.2.6">Added</h3>

* **Node colours (right-click a node → Colour)**: **Default / Mint / Amber / Wisteria / Forest / Slate / Custom…**; each preset uses that palette's root main colour (fixed once written — it does not follow the light/dark theme)
  * **The directive lives in the text**: `%%#89CFF0%%` is standard Obsidian comment syntax — reading view, outline and other tools treat it as a comment, while the mind map reads it as a colour directive; the same shape inside fenced code / inline code / maths is **not** recognised (your code is never rewritten)
  * **Never breaks block syntax**: on multi-line nodes the directive goes on the **last** line; when that line is a code fence or a table row it takes **its own line** (appending after a closing fence would break the fence and swallow every following sibling into the code block)
  * **Scope**: the node plus **all descendants** change fill / border / connector colour; **nearest wins** — colouring a child overrides only that child and its own subtree
  * **"Default" = back to the document palette**: whatever the parent is painted, picking Default restores the document palette for this node (that is also how one branch of a coloured subtree returns to the theme). Two equivalent forms may be written: a `%%none%%` comment that blocks inheritance when an ancestor is still coloured, or no directive at all when nothing is inherited
  * **Automatic text contrast**: the soft ink `#111827` is preferred, otherwise black/white — whichever contrasts more (≥ 4.5); light fills never end up with white text, and **only coloured nodes** are affected
  * **Multi-select colours the top-most nodes only**: write the directive on the top-most selected nodes and let the rest inherit
  * **No undo entry, nothing in `data.json`**: colours are a display-layer derived state; deleting the directive reverts. After edits / undo the colours are recomputed when the render lands, and unchanged maps are not re-rendered
  * **The minimap follows**: thumbnail squares take their node's colour; a colour-only change (geometry untouched) redraws immediately
  * **Inline layout inside a coloured node derives from the fill**: inline code / table headers take a same-hue tint (pulled toward the ink on near-white / near-black fills), table grid and frame use 45% ink, links switch to ink + underline (blue fails contrast on light fills — shape carries the cue), highlights become solid yellow with black text, and strikethrough no longer stacks 75% opacity; **uncoloured nodes are byte-for-byte unchanged** (locked by a control-group test)
  * **Known edge**: nodes with an image, or nodes whose whole line is just the directive, are not self-drawn — the directive shows literally (same as existing comments)
* **Custom colour dialog** (shared by both "Custom…" entries): accepts hex (`#89CFF0`) or RGB (`137, 207, 240`), normalised to `#rrggbb`; a **live swatch preview**, and unrecognised input shows a red hint without writing anything (the node side pre-fills the current colour for easy tweaking)
* **Custom document palette**: right-click **blank space** → Colour → **Custom…**; one hue derives five tiers (root = the colour, second/third levels mixed 86% / 93% toward the canvas background, border 50%, connectors 35%, text colours computed from luminance), stored per file in `data.json` and read through the same path as the six presets
* **Failed images retry on reopen**: the image-failure memory (5-minute TTL) used to survive across open cycles, so a transient failure (sync just landed, index not ready) waited out the full five minutes; opening a map now clears the memory for that map's images only

<h3>Changed</h3>

* **The Colour menu means two things by click target**: on a **node** = colour that node / subtree (writes the directive); on **blank space** = change the document palette (writes `data.json`). Previously only the latter existed, under the same menu label
* **Submenus use the host's native cascading menus**: the layout / colour submenus open after ~250ms of hover, hug their parent item and carry the native arrow; when the host lacks the API, clicking to pop up at the cursor remains as the fallback (0.2.5's standalone pop-up menu is kept as fallback)
* **The minimap follows auto-arrange immediately**: re-layout renders in async slices, so the thumbnail could stay stale for up to 30 seconds; it now redraws when the render lands, on the same path as switching layouts

<h3>Engineering</h3>

* **New modules**: `domain/color.ts` (hex / RGB normalisation, WCAG luminance and contrast, mixing, the nearest-ancestor walk — pure logic, zero dependencies); `engine/mindmap-colors.ts` (directive → the node's fill / line / border / text colour keys); `engine/mindmap-palette.ts` (the **single dispatch point** for preset ids and custom hex); `features/view-node-color.ts` (menu actions); `ui/modal-color.ts` (dialog)
* **One reader and one writer for the directive**: scanning shares its regular expression with the `%%comment%%` markup rule (protected-region semantics cannot drift); writing is the single entry point that rewrites a node's raw line (extra directives are cleaned up, no double spaces)
* **Application timing**: written into the data tree **before** the engine is created (the engine clones data, so later edits to that tree are ignored); both the view and the `mindmap` code-block embed are coloured (the embed is read-only, no live sync)
* **Dead-code / comment cleanup**: eight comments that contradicted the implementation were corrected (text-colour algorithm, palette derivation ownership, the `MARKUP_RE` / directive relationship, …); the K145 ↔ K146 contradictions in `conventions.md` were fixed in place; both exemption tables were re-filled from measurements; `.mindmap-color-invalid` got its missing error-colour style
* Full test suite: **88 files / 2450 cases**; local gates `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `check:release` / `verify:visual` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* **`styles.css` changed** (the colour dialog's preview swatch and error hint) — **replace it together with `main.js`**
* **No new settings keys and no new commands**; `data.json` keeps its shape (the `viewState.palette` value domain is extended: a custom `#rrggbb` is now allowed besides the six preset ids; existing values read as before)
* The new `%%#hex%%` directives are plain comments in reading view / the outline / other editors; invalid values (`%%note%%`, 4- or 8-digit hex, `rgba`, `%%#none%%`) are **treated as ordinary comments** (hidden, no colouring); `%%none%%` is the only valid non-colour value (= how "Default" is written into the file, blocking an inherited colour)
* The mind map file format, the lossless round-trip contract and all command IDs are unchanged
