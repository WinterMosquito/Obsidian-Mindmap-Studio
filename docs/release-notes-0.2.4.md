[中文](#cn-v0.2.4) | [English](#en-v0.2.4)

0.2.4 把导图控件从「一条顶栏」搬到**画布右缘的竖排图标栈**，并按「开关」与「选值」把外观入口拆成两处：**连线 / 边框**成了点一下即切的开关，**布局 / 配色**收进右键级联菜单，屏上不再有任何下拉选择器；新增**整理**按钮。同时修两处实机缺陷——**切换界面语言会把用户同名的 `类型`/`Type` 属性一起改名**（现在只迁移插件自己写过的声明值），**导出的 PNG/SVG 里矩阵竖线 / 根号 / 分式线 / cases 大括号整片消失**（MathJax 自制字体按需内联，失败自动回退）；设置面板改为四段分组、说明改用「一句做什么 + 一句代价」两行显示。工程侧 26 个纯重构提交继续把 `view` / `engine-controller` / 引擎与 Markdown 两侧的主文件收薄，并去掉热路径上的逐次分配。

<h3 id="cn-v0.2.4">新增</h3>

* **控件搬到画布右缘（四组竖排图标）**：撤销原 40px 顶栏。四组自上而下＝**文档**（返回 Markdown / 导出图片）→ **外观**（边框 / 连线开关）→ **视图**（放大 / 重置 / 总览 / 整理 / 缩小）→ **历史**（撤销 / 重做）。组间 8px、组内 32×32，外层只是 `pointer-events: none` 的**穿透层**，画布的拖拽与滚轮完全不受影响；DOM 顺序即键盘 Tab 序。排布对齐 Obsidian Canvas 的右栏控件组（缩放四件 → 撤销 → 重做），鼠标行程可以复用肌肉记忆
* **新增「整理」按钮**：位于「总览」与「缩小」之间，与右键菜单的**自动整理**是同一动作——同一实现、同一枚图标，两处入口不会给出不同结果
* **连线 / 边框改为一点即切的开关**：图标本身表达当前值（直线 / 曲线、有边框 / 无边框），点一下切到另一个值并立即写入 `data.json`。外观变更**不重建工具栏**，所以开关按钮在 `toggle()` 之后自己重算图标与提示——否则会出现「数据换了、按钮还显示旧值」。固定直线布局（目录组织图 / 时间轴 / 鱼骨图）下连线开关**置灰**（不挂点击），不给假交互
* **布局 / 配色收进右键级联菜单**：右键画布空白或节点 → **布局** / **配色**，级联菜单里当前项打勾；空白右键与节点右键**共用同一份实现**。级联只用官方声明过的 `Menu` / `onClick` / `showAtMouseEvent`（`MenuItem.setSubmenu` 不在 `obsidian.d.ts` 里，挂上会被宿主加类但悬停与点击都不展开）
* **设置面板分四段**：基础（语言）/ 外观（默认布局、默认连线样式、默认边框样式、主题）/ 文件与保存（保存位置、指定文件夹、自动保存、自动拆分混排双链）/ 交互与导出（拖拽、导出倍率、导出格式）。每条说明改成「一句做什么 / 一句代价」**两行显示**（官方描述是单文本节点 + `white-space: normal`，`\n` 会被折叠成空格；样式只作用于本插件设置页）
* **导出图里的数学结构不再消失**：矩阵竖线、根号横线、分式线、cases 大括号都由 MathJax 自制字体（stretchy）拼装，而导出 SVG 在 `<img>` 解码的独立文档里渲染、**外部 `app://` 字体被禁**，此前只剩系统 fallback ⇒ 这些结构整片不见（屏上正常）。现在导出前按克隆里**实际出现的字体族**把 woff2 取字节转 base64，以 `data:` URI 内联（探针图 42,789 B → 277,868 B，按需内联 5 族；单行公式通常只增加 10 KB 量级）。预取失败 / 读取失败一律回退旧行为（剥离 `@font-face` + 放宽字形裁切），不比现状差；失败**按样式表内容**缓存，同内容不再重复发请求

<h3>修复</h3>

* **切换界面语言不再改写你的同名属性**（用户报告）：语言切换会按语言迁移 frontmatter 键名（`类型` ⇄ `Type`），此前按键名**全库改名**，把 `类型: wiki` 这类同名但语义无关的属性一并改成 `Type: wiki`（本机测试库 10 页笔记被改）。现在只迁移**插件自己写过的声明值**（`Mindmap` / `Markdown`）；目标键已被非声明值占用时**整文件跳过**——否则键名收敛会把那条无关属性覆盖掉
* **导出 PNG / SVG 里公式的下半被裁掉**：MathJax 4 的逐字符 `clip-path` 纵向只留 ±2px，导出侧换用 fallback 字体后字形更高，根号、分式线、大括号的下半被切掉（位图与矢量两条路径同因）。导出侧把纵向余量放宽到 **±0.6em**（横向仍留 1em 防斜体左右悬垂）——实测「完全移除裁切」与「纵向 ±0.6em」的光栅化结果逐字节相同，故放宽不会引入新的错位

<h3>工程</h3>

* **26 个纯重构提交（行为零变化）**：`engine/mindmap.ts` 759 → 623 行（抽出 `mindmap-icons` / `mindmap-arrange`）、`mindmap-viewport` 1058 → 890（`mindmap-viewport-canvas`）、`md-outline` 941 → 702（`md-outline-lines` / `md-outline-inline`）、`md-serialize` 经 `md-serialize-anchors` / `md-serialize-inline` 两次切分降至 915 行、`math-jax` 1090 → 868（`math-jax-char-rules`）、`prism-code` 444 → 393（`prism-code-color-probe`）、`engine-controller` 822 → 631（`engine-controller-deps` / `-viewport` / `-options`）、`view` 1255 → 1235（`LoadSession`）、`view-node-actions` 862 → 719（`view-node-link-plan`）
* **热路径去分配**：URL 谓词正则预编译、`wikilink` 去掉 `[[…]]` 往返、显示名只解析一次（删除无消费方的 `withWikilinkAlias`）、管道表行切分改游标切片、`file-lookup` 的后缀回退改逐级拼接、`mapWithConcurrency` 收尾判定只留一处、`protectedRanges` 复用模块级扫描器（基准无差异，只去分配）
* **偏好读写对称**：读取侧的四个 `resolve*()` 收敛为 `resolvePreference(key)`，与写入侧 `commitPreference` 以同一个键为中心对称；`ViewDomContext` 删掉 4 个 `*Select` 字段，改由只读方法现算（菜单勾选态不再缓存第二份状态）
* **新增两个单文件收口**：`platform/math-jax-fonts.ts`（导出字体内联）与 `math-jax-export-clip.ts`（字形裁切放宽）——各自只做一件事、纯函数可直测；`verify:visual` 的 obsidian 替身补上 `requestUrl` 具名导出
* 测试全量 **83 文件 / 2236 例**；本地门禁 `build` / `test` / `lint` / `lint:css` / `check:release` / `check:dead-code` / `verify:visual` 全绿

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* **`styles.css` 有变化**（右缘竖栏、右键级联菜单、设置页说明分行），**请与 `main.js` 一起替换**
* **无新增设置键**，`data.json` 结构不变（`viewState` 里四项按文件偏好的键名与口径照旧）
* ⚠ **行为变化：屏上不再有顶栏下拉**——布局 / 配色在**右键菜单**的级联菜单里，连线 / 边框在右缘竖栏当开关。原顶栏的「适应画布」「自动整理」「撤销 / 重做」都还在，位置改为右缘竖栏（自动整理另有一枚「整理」按钮）
* ⚠ **导出的图片体积会变大**（仅当图里含数学公式；字体按需内联）。纯文本导图不受影响
* 命令 ID、导图文件格式与往返保真契约均不变

---

<h3 id="en-v0.2.4">Added</h3>

* **Controls moved onto the canvas (a right-edge rail of four groups)**: the 40px top bar is gone. Top to bottom: **document** (back to Markdown / export image) → **appearance** (border / line style toggles) → **view** (zoom in / reset / fit / arrange / zoom out) → **history** (undo / redo). 8px between groups, 32×32 inside them; the outer element is only a `pointer-events: none` **pass-through layer**, so canvas dragging and the wheel are untouched. DOM order is the Tab order. The arrangement follows Obsidian Canvas' right-hand control groups (zoom set → undo → redo) so muscle memory carries over
* **New "Tidy" button**: sits between "Fit" and "Zoom out" and is the *same* action as **Arrange mind map** in the context menu — one implementation, one icon, so the two entries can never disagree
* **Border / line style are now one-click toggles**: the icon *is* the current value (straight / curve, bordered / borderless); clicking switches to the other value and writes it to `data.json` immediately. Appearance changes **do not rebuild the rail**, so a toggle recomputes its own icon and tooltip after `toggle()` — otherwise you get "the value changed, the button still shows the old one". On fixed-straight layouts (Catalog organization / Timeline / Fishbone) the line-style toggle is **disabled** (no click handler attached) instead of pretending to be interactive
* **Layout / palette moved into right-click cascading submenus**: right-click the canvas or a node → **Layout** / **Palette**, with the current choice ticked; the empty-canvas and node menus **share one implementation**. The cascade uses only declared API (`Menu` / `onClick` / `showAtMouseEvent`) — `MenuItem.setSubmenu` is not in `obsidian.d.ts`; attaching it makes the host add a class but the submenu never opens, on hover or on click
* **Settings panel split into four groups**: General (language) / Appearance (default layout, default line style, default border style, theme) / Files and saving (save location, folder, auto-save, auto-split mixed links) / Interaction and export (drag, export scale, export format). Every description now reads as "one line what it does / one line what it costs" — the official description is a single text node with `white-space: normal`, so `\n` collapses into a space; the style is scoped to this plugin's settings page
* **Maths structures no longer vanish in exported images**: matrix rules, radical bars, fraction lines and `cases` braces are assembled from MathJax' own (stretchy) fonts, while an exported SVG renders in an isolated `<img>` document where **external `app://` fonts are blocked** — so only the system fallback remained and those structures disappeared entirely (they look fine on screen). Export now inlines the woff2 faces that the cloned SVG **actually uses**, fetched as bytes and embedded as `data:` URIs (probe map: 42,789 B → 277,868 B, five families inlined; a single-line formula usually adds ~10 KB). Any failure (prefetch, read) falls back to the previous behaviour (strip `@font-face` + relax glyph clipping), never worse; failures are cached **per stylesheet content**, so the same content is not re-requested

<h3>Fixed</h3>

* **Switching UI language no longer rewrites same-named user properties** (user-reported): the language switch migrates frontmatter keys (`类型` ⇄ `Type`), and it used to rename them **vault-wide by key name** — turning an unrelated `类型: wiki` into `Type: wiki` (10 notes in the local test vault were rewritten). Only values this plugin wrote (`Mindmap` / `Markdown`) are migrated now, and a file is **skipped entirely** when the target key already holds a non-declaration value — otherwise key convergence would overwrite that unrelated property
* **The lower half of formulas in exported PNG / SVG was clipped**: MathJax 4 sets a per-glyph `clip-path` with only ±2px of vertical slack, and the fallback font used during export is taller, so radical bars, fraction lines and braces lost their bottom half (raster and vector alike). The export side now relaxes the vertical slack to **±0.6em** (horizontal stays at 1em so italic glyphs can overhang) — removing the clip entirely and relaxing to ±0.6em produce byte-identical rasterisation, so the relaxation cannot introduce a new offset

<h3>Engineering</h3>

* **26 behaviour-neutral refactor commits**: `engine/mindmap.ts` 759 → 623 lines (`mindmap-icons` / `mindmap-arrange` extracted), `mindmap-viewport` 1058 → 890 (`mindmap-viewport-canvas`), `md-outline` 941 → 702 (`md-outline-lines` / `md-outline-inline`), `md-serialize` down to 915 lines through `md-serialize-anchors` and `md-serialize-inline`, `math-jax` 1090 → 868 (`math-jax-char-rules`), `prism-code` 444 → 393 (`prism-code-color-probe`), `engine-controller` 822 → 631 (`engine-controller-deps` / `-viewport` / `-options`), `view` 1255 → 1235 (`LoadSession`), `view-node-actions` 862 → 719 (`view-node-link-plan`)
* **Less allocation on hot paths**: precompiled URL predicates, no `[[…]]` round-trip in `wikilink`, display names parsed once (unused `withWikilinkAlias` removed), pipe-table row splitting by cursor, `file-lookup` suffix fallback built step by step, a single completion check in `mapWithConcurrency`, and `protectedRanges` reusing a module-level scanner (benchmarks unchanged, allocation only)
* **Symmetric preference read/write**: the four `resolve*()` readers collapsed into `resolvePreference(key)`, mirroring `commitPreference` on the write side around the same key; the four `*Select` fields are gone from `ViewDomContext` and are computed on demand by read-only methods (no second copy of menu check state)
* **Two new single-purpose modules**: `platform/math-jax-fonts.ts` (export font inlining) and `math-jax-export-clip.ts` (glyph clip relaxation) — one job each, pure functions, directly tested; the `verify:visual` obsidian shim gained the `requestUrl` named export
* Full test suite: **83 files / 2236 cases**; local gates `build` / `test` / `lint` / `lint:css` / `check:release` / `check:dead-code` / `verify:visual` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* **`styles.css` changed** (right-edge rail, context-menu cascade, settings description line breaks) — **replace it together with `main.js`**
* **No new settings keys**; `data.json` keeps its shape (the four per-file preference keys under `viewState` are unchanged)
* ⚠ **Behaviour change: no more toolbar dropdowns on screen** — layout / palette live in the **context menu** cascade, border / line style are toggles on the right-edge rail. Fit to canvas, auto arrange and undo / redo are all still there, now as rail buttons (auto arrange also has a "Tidy" button)
* ⚠ **Exported images get larger** (only when the map contains maths; fonts are inlined on demand). Text-only maps are unaffected
* All command IDs, the mind map file format and the lossless round-trip contract are unchanged
