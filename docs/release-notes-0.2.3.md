[中文](#cn-v0.2.3) | [English](#en-v0.2.3)

0.2.3 把「这篇导图长什么样」交还给每一篇导图：新增**配色**（六套）与**边框**（有边框 / 无边框）两个外观维度，连同布局、连线一起由导图顶栏**按文件记忆**；连线样式收敛为**折线 / 曲线**两态。同时解决大图的「适应画布」卡死——引擎异步分片改为批量消费后，5000 节点的全树可见从 27.5 秒降到 820 毫秒、适应画布从 27.5 秒降到 52 毫秒，并给出可读比例下限；另修**图片调宽回写会把引用改写成完整路径**、**新窗口里调宽手柄不出现**、**同段多枚粗体被吞**等实机缺陷。

<h3 id="cn-v0.2.3">新增</h3>

* **配色（六套，按文件记）**：导图顶栏新增「配色」下拉——**默认 / 薄荷 / 琥珀 / 紫藤 / 森林 / 石板**。每套只给 5 个填充与线色，文字色不随配色变（只按明暗定，避免「浅底配错深字」这类不可读组合）。切换**原地换肤、不重建引擎**，记在 `data.json` 的 `viewState[<路径>].palette`——与布局 / 连线样式同一种「按文件记忆」形态，**不进全局设置**（配色是「这篇导图长什么样」）。笔记里的 `mindmap` 围栏嵌入恒用「默认」配色，不随单篇导图染色
* **边框（有边框 / 无边框，按文件记）**：顶栏新增「边框」下拉。无边框把节点的**填充与描边一起**归零（只去描边时，亮色下第二层节点的浅灰底与画布仅差 2%，仍是一层肉眼可见的色块），中心节点保留主题色填充作视觉锚点。设置面板新增「默认边框样式」——只决定**新建**导图的初始值，之后每篇可在顶栏随时切换；`mindmap` 围栏嵌入跟随这个**全局默认**（与布局 / 连线同性质，嵌入没有「当前文件」身份）
* **连线样式收敛为两态：折线 / 曲线**：`自动`（随布局）与`直连`下线——默认值固定为折线，「跟随布局」不再有信息量，直连与折线的差异不足以再占一个选项。固定直线布局（目录组织图 / 时间轴 / 鱼骨图）的下拉只显示一项「**直线**」，语义是「连线由布局自身绘制、不可切换」（旧文案「自动」会让人误以为可选）；这是**纯显示收窄**，文件里的偏好既不写入也不丢失
* **设置项文案与命名整理**：「默认主题」改为「**主题**」（跟随 Obsidian / 强制亮色 / 强制暗色），选项「默认（跟随 Obsidian 配色）」简化为「跟随 Obsidian」——它管明暗，与新增的「边框」（管节点形态）、「配色」（管色相）三维各管一件事，此时起名必须能一眼分清
* **大图「适应画布」改为可读下限 + 一句提示**：节点数 > 2000 **且**真 fit 比例低于 10% 时，比例抬到 10% 居中（此前 5000 节点的 fit 比例约 0.03，文字不到 1px，看到等于没看到），并提示「不会一次显示全部节点」。是否钳制**只问引擎返回值**，不在 UI 侧按节点数另算——否则「节点很多但内容本来就适配」时会说出与事实相反的提示。引擎侧同批把异步分片渲染从「每节点一个 `setTimeout(0)`」改为「队列 + MessageChannel 批量消费」（每批 8ms 预算）：5000 节点「剪枝 → 全树可见」**27.5s / 38.0s → 820ms**，「适应画布」**27.5s（DOM 5000）→ 52ms（DOM 393）**，`node_tree_render_end` 仍只发一次

<h3>修复</h3>

* **调宽保存不再把图片引用扩写**（用户报告）：把 `![[sample-icon.svg]]` 拖宽后，引用曾被改写成 `![[fixtures/assets/sample-icon.svg|190]]`（合成回写按解析出的库内路径写）。现在优先保留原引用文本（仍指向同一文件时），仅当目标失效 / 指向别的文件才回落真实路径
* **新建图片的路径形态跟随官方 `New link format`**：此前一律写完整库内路径、无视设置。现在库内唯一时写 `![[图.svg|160]]`，存在**同名文件**时才写完整路径；同名口径随引用形态——省略 `.md` 的文档链接按去扩展名 basename，带扩展名的图片 / 附件 / `.canvas` 按**文件名**（`a.png` 与 `a.md`、`a.jpg` 不构成歧义，此前按 basename 计数会把它误判成冲突、把引用无谓拉长）。**存量引用不因后来出现同名文件而改写**（Obsidian 只在重命名 / 移动时更新链接；改写未编辑行会破坏逐字保真）
* **新窗口（popout）里图片调宽手柄不出现**：判据原用 `instanceof SVGImageElement`，在另一 realm 的窗口里恒为 false ⇒ 手柄永不出现、帧内预览静默失效。改为按 `tagName === 'image'` + 取矩形能力判定，帧内预览与 hover 手柄共用这一份判据
* **同一段里多枚粗体被吞、下划线粗体嵌套外露**：`**粗一** 与 **粗二**` 曾被整行吞成一段粗体并外露裸 `**`（标记体只在首字符后判定一次，随后贪婪回溯到行内最后一个定界符）；`__粗 _斜_ 粗__` 同理外露。标记体现改为逐字符 temper，不越过下一对定界符
* **「文件已创建但打开失败」不再报「创建失败」**：两段流程此前共用一个提示，打开失败时会让用户以为没建成、重试一次就多出一个重复文件。现在创建失败与打开失败分开提示，后者明示文件已在库中

<h3>工程</h3>

* **引擎防腐层拆分**：`engine/mindmap.ts` 从 2911 行收成 759 行的 barrel，实现按职责拆进 `mindmap-nodes` / `mindmap-viewport` / `mindmap-clipboard` / `mindmap-commands` / `mindmap-export` / `mindmap-history` / `mindmap-search` / `mindmap-timers` / `mindmap-theme-presets`；`features/` 仍只经具名函数访问引擎，跨出边从 28 处收拢到 10 处
* **节点自绘内容拆为三段**：`node-inline-tokenize`（标记切分与接管判定，`MARKUP_RE` 的唯一实现）、`node-inline-html`（DOM 装配与全内联样式）、`node-inline-content`（对外门面）——后者从 1834 行降到 87 行，只做编排
* **导出后处理合并**：`export-css-vars` / `export-foreign-object-padding` / `export-svg-style` 三份合入 `platform/export-svg-postprocess`，MathJax 导出侧从 `math-jax` 拆出 `platform/math-jax-export`
* **「按文件偏好」四维收成三处唯一实现**（行为零变化）：`core/constants.pickOption`（回退逻辑一份）、`services/view-state.getPreference/setPreference`（键类型 `PreferenceKey`）、`features/view.commitPreference`（归一 → 会话字段 → 引擎通道 → 持久化只写一次）；顺带修掉「默认边框样式对新建导图无效」——根因是四项偏好各写了一遍，其中 `themeStyle` 回落的是硬编码 `default`，现已抽成纯函数 `resolveFilePreferences` 并直测
* **模块依赖矩阵单一来源**：新增 `scripts/module-boundaries.mjs`，eslint 的 9 个边界块与 `tests/module-boundaries.test.ts` 都从它生成；后者解析真实依赖图（组内成环 / 深层路径 / 新组未登记），不再允许在配置或测试里另抄一份矩阵。同时修复 knip 报出的无用类型再导出
* **文档结构**：标准文档只留**现况规则**，历次事实修正外迁 `docs/markdown-mindmap-history.md`；新增文档一致性门禁 `tests/docs-standard.test.ts`（目录 / 章节摘要 / 指针 / 版本 / 白名单映射），新增 `docs/agents/README.md`（规模、权威边界、`conventions.md` 怎么找）
* **门禁**：`verify:visual` 的探针清点补登为 **15 场景 / 19 探针**（`viewport-geometry` / `inline-edit` 此前已在跑、只是没计入清点）；`layout` 探针改为**显式指定连线偏好**（不再依赖已下线的 `auto` 隐式取布局默认），导出探针的后处理链改走 `platform/export-svg-postprocess` 单入口（与生产同链同序）
* 测试全量 **82 文件 / 2219 例**

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* **`styles.css` 有变化**（新增的两个下拉与布局 / 连线下拉共用样式），**请与 `main.js` 一起替换**；`main.js` 内含重打包的 `vendor/simple-mind-map.cjs`（补丁 12）
* **设置新增一个键** `defaultThemeStyle`（默认 `default` = 有边框，旧 `data.json` 自动取默认）；「默认主题」改名「主题」但**键名 `defaultTheme` 不变**——改的只是显示文案，你已有的设置照旧生效
* **`data.json` 的 `viewState` 新增两个可选按键**（`palette` / `themeStyle`）：缺省即默认观感（基准蓝 + 有边框），升级后已打开的导图外观与之前一致
* ⚠ **行为变化：连线样式只剩折线 / 曲线**——存量 `auto` / `direct` 在**读取侧**归一为折线（不批量改写你的 `data.json`，下次切换样式时自然落盘）；新建导图默认折线
* ⚠ **行为变化：> 2000 节点的图「适应画布」不再承诺一屏装下全部节点**（比例抬到 10% 并给一句提示）；节点数在此之下的图不受影响
* 命令 ID、导图文件格式与往返保真契约均不变

---

<h3 id="en-v0.2.3">Added</h3>

* **Six colour palettes (remembered per file)**: the map toolbar gains a **Palette** dropdown — **Default / Mint / Amber / Wisteria / Forest / Slate**. Each palette supplies only five fills and a line colour; text colours never change with the palette (they follow light/dark only, so a light fill can never end up with an unreadable dark text pairing). Switching re-skins **in place without rebuilding the engine** and is stored in `data.json` under `viewState[<path>].palette` — the same "remembered per file" shape as layout and line style, and **not** a global setting (a palette is "what this map looks like"). `mindmap` code-block embeds always use the Default palette and are never tinted by a single map's choice
* **Borders (bordered / borderless, remembered per file)**: a new **Border** dropdown in the toolbar. Borderless zeroes both the **fill and the stroke** (dropping only the stroke still leaves a visible pale block: on light themes the second-level fill differs from the canvas by just 2%), while the central node keeps its theme fill as a visual anchor. A new setting — **Default border style** — only decides the starting value for **new** maps; each map can switch it from the toolbar at any time. `mindmap` embeds follow that **global default** (same nature as layout / line style: an embed has no current-file identity)
* **Line styles collapse to Elbow / Curve**: `Auto` (follow the layout) and `Direct` are gone — the default is now Elbow, "follow the layout" carried no information, and the difference between direct and elbow did not deserve a third option. Fixed-straight layouts (Catalog organization / Timeline / Fishbone) show a single **Straight** entry, meaning "the layout itself draws the connectors, this is not switchable" (the old "Auto" label implied a choice). This is a **display-only narrowing**: the value stored in your file is neither written nor lost
* **Setting labels tidied**: "Default theme" is now **Theme** (Follow Obsidian / Force light / Force dark), and the option "Default (use Obsidian color scheme)" is now simply "Follow Obsidian" — with the new Border and Palette dimensions, the names have to be distinguishable at a glance
* **"Fit to canvas" on large maps: readable floor + one notice**: when a map has more than 2000 nodes **and** the true fit scale would be below 10%, the scale is raised to 10% and centred (a 5000-node fit lands around 0.03 — text under 1px, which is the same as not seeing it), with a notice that not all nodes are shown. Whether clamping happened is **asked from the engine's return value**, never re-derived from a node count in the UI — otherwise a map that is large but already fits would get a notice that contradicts reality. The engine side also batches its async sharded rendering ("queue + MessageChannel", 8ms budget per batch) instead of one `setTimeout(0)` per node: 5000 nodes, prune → full tree visible went from **27.5s / 38.0s to 820ms**, and Fit to canvas from **27.5s (DOM 5000) to 52ms (DOM 393)**, while `node_tree_render_end` still fires exactly once

<h3>Fixed</h3>

* **Resizing an image no longer rewrites its reference** (user-reported): dragging `![[sample-icon.svg]]` wider used to write `![[fixtures/assets/sample-icon.svg|190]]` back into the note (the synthesised line used the resolved in-vault path). The original reference text is now kept whenever it still points at the same file; the real path is only used when the target is gone or points elsewhere
* **New image references follow the official `New link format`**: they used to always write the full in-vault path, ignoring the setting. Now a unique file writes `![[image.svg|160]]`, and the full path appears only when a **same-name file** exists; the name comparison follows the reference shape — document links that omit `.md` compare extension-less basenames, while images / attachments / `.canvas` compare **file names** (`a.png` is not ambiguous with `a.md` or `a.jpg`; the old basename count wrongly treated it as a conflict and needlessly lengthened the reference). **Existing references are not rewritten when a same-name file appears later** (Obsidian only updates links on rename / move, and rewriting untouched lines would break the byte-for-byte round trip)
* **The image resize handle no longer disappears in popout windows**: the predicate used `instanceof SVGImageElement`, which is always false across realms ⇒ no handle, and the in-frame preview silently did nothing. It now uses `tagName === 'image'` plus rect-reading ability, shared by the preview and the hover handle
* **Several bold spans in one line were swallowed; underscore bold leaked its nesting**: `**one** and **two**` used to become one bold run with bare `**` left showing (the markup body was only checked once after its first character and then greedily matched the last delimiter on the line); `__bold _italic_ bold__` leaked the same way. The markup body is now tempered character by character and never crosses the next delimiter pair
* **"File created but could not be opened" no longer reports "creation failed"**: both steps shared one message, so a failed open looked like a failed create — retrying produced a duplicate file. Creation and opening now report separately, and the latter states that the file is already in the vault

<h3>Engineering</h3>

* **Anti-corruption layer split**: `engine/mindmap.ts` shrank from 2911 lines to a 759-line barrel, with the implementation split into `mindmap-nodes` / `mindmap-viewport` / `mindmap-clipboard` / `mindmap-commands` / `mindmap-export` / `mindmap-history` / `mindmap-search` / `mindmap-timers` / `mindmap-theme-presets`; `features/` still only calls named functions, and outgoing vendor edges dropped from 28 to 10
* **Node inline content split into three parts**: `node-inline-tokenize` (markup segmentation and the take-over predicate, the single `MARKUP_RE` implementation), `node-inline-html` (DOM assembly with fully inlined styles) and `node-inline-content` (the facade) — the last one went from 1834 lines to 87 lines of pure orchestration
* **Export post-processing consolidated**: `export-css-vars` / `export-foreign-object-padding` / `export-svg-style` merged into `platform/export-svg-postprocess`; the MathJax export side moved out of `math-jax` into `platform/math-jax-export`
* **The four per-file preferences now have three single implementations** (behaviour-neutral): `core/constants.pickOption` (one fallback path), `services/view-state.getPreference/setPreference` (`PreferenceKey`), and `features/view.commitPreference` (normalise → session field → engine channel → persistence written once). This also fixes "Default border style has no effect on new maps" — the root cause was four hand-written copies, one of which fell back to a hard-coded `default`; the four are now resolved by the pure function `resolveFilePreferences`, covered directly by tests
* **One source for the module dependency matrix**: new `scripts/module-boundaries.mjs` generates both the 9 eslint boundary blocks and `tests/module-boundaries.test.ts`; the latter walks the real dependency graph (intra-group cycles / deep paths / unregistered groups), so the matrix can no longer be copied by hand. Also fixed the unused type re-exports reported by knip
* **Docs**: the standard document keeps **current rules only** and its fact-correction history moved to `docs/markdown-mindmap-history.md`; new consistency gate `tests/docs-standard.test.ts` (TOC / section summaries / pointers / version / whitelist mapping), plus `docs/agents/README.md` (sizes, authority boundaries, how to find things in `conventions.md`)
* **Gates**: the `verify:visual` probe inventory is now recorded as **15 scenarios / 19 probes** (`viewport-geometry` and `inline-edit` were already running, they were just not counted); the `layout` probe now passes its line-style preference **explicitly** (it no longer relies on the retired `auto` implicitly following the layout), and the export probe drives the single `platform/export-svg-postprocess` entry point (same chain, same order as production)
* Full test suite: **82 files / 2219 cases**

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* **`styles.css` changed** (the two new dropdowns share styles with layout / line style) — **replace it together with `main.js`**; `main.js` bundles the rebuilt `vendor/simple-mind-map.cjs` (patch 12)
* **One new settings key** `defaultThemeStyle` (defaults to `default` = bordered; older `data.json` picks the default up); "Default theme" was renamed to "Theme" but its **key name `defaultTheme` is unchanged**, so your existing settings keep working
* **`data.json`'s `viewState` gains two optional keys** (`palette` / `themeStyle`): absent means the previous look (baseline blue + bordered), so maps you already opened look exactly as before after upgrading
* ⚠ **Behaviour change: line styles are Elbow / Curve only** — existing `auto` / `direct` values normalise to Elbow **on read** (your `data.json` is not batch-rewritten; the value lands on disk the next time you switch the style); new maps default to Elbow
* ⚠ **Behaviour change: "Fit to canvas" on maps with more than 2000 nodes no longer promises every node on one screen** (the scale is raised to 10% with a notice); maps below that size are unaffected
* All command IDs, the mind map file format and the lossless round-trip contract are unchanged
