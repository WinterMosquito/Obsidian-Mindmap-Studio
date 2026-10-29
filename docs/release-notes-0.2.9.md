[中文](#cn-v0.2.9) | [English](#en-v0.2.9)

0.2.9 重做「节点级配色」的落地方式：`%%#89CFF0%%` 里的十六进制从**填充色**改为**主色（色相锚）**——画布上是大面积的浅底（主色向画布白混 84%）、保留主色的连线与描边、以及浅底上的深字，饱和只留给细线。改的原因是面积：指令色取自整篇配色的根节点色（中深色、设计上承载反白字），一旦沿子树下传就是几十个中深实色块，白字/黑字都被迫贴着 4.5 的底线。配色方案同时增至**七套**（新增「玫瑰」，「森林」从墨绿调到草绿），并修掉引擎在离屏测量容器里留下的残渣——读屏会多遇到一个孤立复选框、Tab 能把焦点送到屏幕外、`querySelectorAll` 会多算一个节点。

<h3 id="cn-v0.2.9">新增</h3>

* **「玫瑰」配色**（第 7 套）：暖红，补上「琥珀 → 紫藤」之间 120° 的色相空档
  * 节点级配色下五支彩色（薄荷 / 琥珀 / 玫瑰 / 紫藤 / 森林）的主色两两 ΔE ≥ 25，连线在整图缩放下也分得清；石板保持中性降噪档，不参与彩度比较
  * 节点右键与空白右键的「配色」子菜单同时多一项，当前项照常打勾
* **节点级配色改为「主色 → 三档」**：指令里的 hex 是**主色**，渲染时由 `domain/color.nodeColorScale` 唯一派生
  * **填充** = 主色向画布白混 84%：L\* ≈ 91–93、C\* 6–10（石板那支 2 是刻意的降噪档），深字对比 ≥ 13；比整篇配色的二级填充再深一档，整图缩放下才看得出「这是哪一支」
  * **连线与描边** = **保留主色**：细线面积小、贯穿全图，由它承担分支辨识度，也是小地图节点块的墨色来源（缩略图因此比旧观感更清楚）
  * **文字** = 该浅底上的柔和深灰蓝 `#111827`——不再出现同一屏里白字/黑字混用
  * 原理是面积-强度反比（Itten）：大色块留浅、饱和只给细线。旧做法把中深色铺满整支子树，白字与黑字都被压到 4.82–5.41，且丢掉「深字浅底」的阅读优势
* **标签 pill 与任务复选框跟随主题链接色**：未着色节点的内链 / 标签文字 / 复选框描边与完成态填充共用一条链 `var(--link-color, var(--text-accent, #7f6df2))`
  * 改强调色、换主题即时生效（原来是写死的 `#7f6df2`，只有导出图碰巧正确）；标签底色是同色的 14% `color-mix`
  * 勾色交主题的 `var(--text-on-accent, #ffffff)`（强调底色上的文字色），并进导出白名单——导出图里同样是主题色，不再静默回退白勾
  * **不动度量**：明确不接 `--tag-size` / `--tag-weight` / `--link-weight`，字体度量一变会命中引擎离屏测宽的旧缓存而裁字

<h3>变更</h3>

* **指令语义**：`%%#89CFF0%%` 表示**主色**，不是填充色。存量文件里的指令值**不需要改写**（仍是 `%%#hex%%` / `%%none%%`），画布按新规则重算；写进文件的实色依旧不随明暗变
* **「森林」预设换色相**：`#2f7d5a`（h160）→ `#3f7c2f`（h133）
  * 原因：旧值与薄荷 `#2e9e8f`（h182）只差 18°，节点级配色下两者主色 ΔE 仅 **18**、派生填充 ΔE **2.7**——同一张图上两支几乎分不开。改后拉开 47°：主色 ΔE **38.5**、填充 ΔE **5.8**，白字对比 5.00 → 5.08
  * **已知代价**：存量 `%%#2f7d5a%%` 节点显示不受影响（连线与描边保留旧值、填充按旧主色派生），但节点右键菜单会勾在**「自定义」**而不是「森林」——勾选态与正文指令做严格等值比较。再点一次「森林」即写入新值；插件**不会**自动改写存量指令（那会破坏逐字保真）
* **着色节点的行内码 / 表头阶差判据换了**：原判「亮度差 < 0.04 就反向兜底」，改为**实际达成的对比度** < 1.12 时朝墨色偏 10%
  * 色阶落地后填充恒在 L\* ≈ 92，朝白偏 12% 只有 1.01–1.05，等于没偏——码块会与底色糊在一起；判据改为量「偏完到底看不看得出」，而不是量亮度阈值

<h3>修复</h3>

* **引擎离屏测量容器的残渣**（画布容器 `-99999px` 处常驻一份「最后一次测量」的节点内容副本）
  * 成因在 vendor：每次测量**开头**自己清空、**测完不清**（不是泄漏，但永远在）；`-99999px` 既不把它移出无障碍树，也不移出焦点顺序
  * 后果：读屏用户多遇到一个带 `aria-label` 的**孤立复选框**；副本里的外链 `a[href]` 与代码块复制按钮能被 Tab 聚焦到屏幕外；任何「批量查询 + 绑定」的新代码会命中幽灵——实机 4 个任务、`querySelectorAll('.mindmap-node-task')` 返回 5
  * 修法：渲染结束清空内容，并给容器戴 `aria-hidden` 与 `inert`。属性不是给「已清空的内容」用的——单节点重渲染（`reRender(['custom'])` 之类）不发 `node_tree_render_end`，残渣会长回来，属性则一直在，把那段窗口一并隔离；`inert` 补的是 `aria-hidden` 管不到的焦点
  * 清空安全：下一次测量本就先自清再填、首帧前批量预测量持有元素本体（进容器的只是 `cloneNode`）、测量缓存内容寻址且不在该元素里；`inert` 不改布局 ⇒ 测量照常（实机 `foreignObject` 高度与既有口径一致）
  * **切换任务触发重渲染后仍无残渣**（实机：任务数 2 → DOM 2，容器子节点 0）

<h3>工程</h3>

* **派生唯一点**：`domain/color.nodeColorScale`（填充 / 线条 / 文字），`engine/mindmap-colors.nodeColorStyle` 只做「主色 → 四个样式键」的映射，不再自行混色或判墨色；色阶常量集中（`NODE_FILL_MIX` 0.84 / 混色基准画布白 `#ffffff` / `CHIP_MIN_CONTRAST` 1.12 / `CHIP_SHIFT` / `BORDER_INK_MIX` 45%）
* **链接色收口**：`features/node-inline-html.THEME_LINK_COLOR` 是内链 / 标签 / 复选框的唯一定义，外链与未解析色两级也复用它；删掉把 Obsidian 默认强调色钉死的 `NODE_ACCENT_FALLBACK`
* **测量残渣收口**：`engine/mindmap.clearMeasureResidue`，注册点唯一（`createMindMap` 内 `node_tree_render_end`）⇒ 视图与只读嵌入两个创建点一并覆盖；**幂等**（属性与内容都到目标态时一个写操作都不做，渲染结束是高频点），四类 no-op 防御
* **测试**：新增 `tests/engine-measure-residue.test.ts`；`color-directive` / `mindmap-theme` / `node-inline-content` / `node-inline-tag` / `view-node-task` / `view-context-menu` / `export-svg-postprocess` 断言随新口径升级；两个引擎桩（`mindmap-codeblock` / `mindmap-wiki-icon`）补齐 `on`，与真实 `d.cts` 对齐
* 行为口径写进 `AGENTS.md` 决策表与 `docs/agents/conventions.md` 的 K151 / K152
* 全量测试 **95 文件 / 2558 例**；门禁 `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `check:release` / `verify:visual` 均通过

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖；**`styles.css` 无变化**（替换 `main.js` 即可，`manifest.json` 请一并更新）
* **文件格式不变**：指令仍是注释语法里的 `%%#hex%%` / `%%none%%`，没有新语法、不重排、不合成未编辑的行；本版**不改写任何存量文件**
* **观感会变（仅节点级配色）**：给节点写过的 `%%#hex%%` 从「整支中深实色」变成「浅底 + 同色连线 + 深字」——这是本版的目的，文件里的值一个都没动
* **观感会变（标签与复选框）**：0.2.8 固定用 Obsidian 默认强调色 `#7f6df2`，本版改跟当前主题的链接色；导出图同步
* **回滚到 0.2.8 及更早**：节点回到「填充 / 边框 / 连线同色 + 深浅字」的旧观感，玫瑰配色写下的 `%%#b8455f%%` 显示为普通自定义色——**数据无损**，重新升级即恢复；本版写过的文件没有「新格式」依赖
* **没有新增命令、没有新增设置键**：命令 ID、`data.json` 结构与逐字保真契约均不变

---

0.2.9 reworks how **per-node colours** land on the canvas: the hex inside `%%#89CFF0%%` is no longer the **fill** but the **base colour** (a hue anchor). What you see is a large light fill (the base mixed 84% toward canvas white), connectors and borders that **keep the base colour**, and dark ink on that light fill — saturation is spent on thin lines only. The reason is area: the directive value comes from a palette's root colour (a mid-dark tone designed to carry white text), and inheriting it down a subtree paints dozens of mid-dark solid blocks, forcing both white and black text down to the 4.5 floor. The palette set also grows to **seven** (new "Rose", and "Forest" moved from dark to grass green), and the engine's leftover off-screen measurement copy is gone — it used to add a stray checkbox to the accessibility tree, put focusable elements off-screen, and make `querySelectorAll` count one node too many.

<h3 id="en-v0.2.9">Added</h3>

* **"Rose" palette** (the seventh): a warm red that fills the 120° hue gap between Amber and Wisteria
  * With per-node colours the five chromatic palettes (Mint / Amber / Rose / Wisteria / Forest) sit ≥ 25 ΔE apart in base colour, so branches stay distinguishable even when zoomed out; Slate stays the neutral, low-noise option and is excluded from the chroma comparison
  * It shows up in both Palette menus (node and canvas) with the current choice ticked, as usual
* **Per-node colours now derive three tiers from one base colour** (`domain/color.nodeColorScale`, the single implementation)
  * **Fill** = the base mixed 84% toward canvas white: L\* ≈ 91–93, C\* 6–10 (Slate's 2 is a deliberate low-noise tier), dark-text contrast ≥ 13 — one step deeper than a map palette's second-level fill, so the colour family is visible in a fitted view
  * **Connectors and borders** = **the base colour itself**: thin lines carry small area but run across the whole map, so they carry "which branch is this", and they are also the ink of the minimap's node blocks (the thumbnail is clearer than before)
  * **Text** = `#111827`, the soft dark slate used on light fills — no more white and black text mixed on one screen
  * The principle is Itten's area-to-intensity contrast: large areas stay light, saturation goes to thin lines. The old behaviour spread a mid-dark tone over a whole subtree, pinning both white and black text to 4.82–5.41 and giving up the "dark ink on light ground" advantage
* **Tag pills and task checkboxes follow the theme's link colour**: on uncoloured nodes, inline links, tag text, and the checkbox outline and checked fill all share one chain, `var(--link-color, var(--text-accent, #7f6df2))`
  * Changing the accent colour or the theme now takes effect immediately (0.2.8 hard-coded `#7f6df2`, which only happened to be right in exports); the pill background is that colour at 14% via `color-mix`
  * The check mark uses the theme's `var(--text-on-accent, #ffffff)` and that variable joined the export allowlist — exported images now match the theme instead of silently falling back to a white mark
  * **Metrics stay untouched**: `--tag-size` / `--tag-weight` / `--link-weight` are deliberately not adopted — changing font metrics would hit the engine's off-screen width cache and clip text

<h3>Changed</h3>

* **Directive semantics**: `%%#89CFF0%%` means the **base colour**, not the fill. Existing directives **need no rewriting** (still `%%#hex%%` / `%%none%%`) — the canvas simply renders them under the new rules, and the colour written into the file still does not change with light/dark mode
* **The "Forest" preset changed hue**: `#2f7d5a` (h160) → `#3f7c2f` (h133)
  * Why: the old value sat only 18° from Mint `#2e9e8f` (h182) — under per-node colours the two bases were **18 ΔE** apart and the derived fills only **2.7**, i.e. two branches of the same map looked identical. The new value opens 47°: base ΔE **38.5**, fill ΔE **5.8**, white-text contrast 5.00 → 5.08
  * **Known cost**: existing `%%#2f7d5a%%` nodes look unchanged (connectors and borders keep the old value, the fill is derived from the old base), but the node palette menu ticks **"Custom"** instead of "Forest" — the tick is a strict equality check against the directive. Clicking "Forest" once writes the new value; the plugin **never** rewrites existing directives (that would break verbatim round-trip)
* **The contrast rule for inline code / table headers on coloured nodes changed**: instead of "reverse the shift when the luminance gap is below 0.04", it now checks the **contrast actually achieved** and, when that is below 1.12, shifts 10% toward the ink
  * With the new light fills, shifting 12% toward white yields only 1.01–1.05 — effectively no shift, so code blocks would melt into the background. The rule now measures "can you see a block afterwards" rather than a luminance threshold

<h3>Fixed</h3>

* **Leftovers in the engine's off-screen measurement container** (a permanent copy of the last measured node content, parked at `-99999px` under the canvas)
  * The cause is in the vendored engine: it clears the container at the **start** of each measurement but never afterwards (not a leak — it is simply always there), and `-99999px` removes it from neither the accessibility tree nor the focus order
  * Symptoms: screen-reader users meet one extra **stray checkbox** carrying an `aria-label`; external `a[href]` links and the code block's copy button can be focused off-screen by Tab; any new "query all, then bind" code hits a ghost — on device, 4 tasks but `querySelectorAll('.mindmap-node-task')` returned 5
  * Fix: clear the content when rendering ends and give the container `aria-hidden` plus `inert`. The attributes are not for "the content we just cleared" — a single-node re-render (`reRender(['custom'])` and friends) emits no `node_tree_render_end`, so the copy grows back, while the attributes stay and isolate that window too; `inert` covers the focus side that `aria-hidden` does not
  * Clearing is safe: the next measurement clears the container itself first, the pre-first-frame batch measurement holds the real elements (only `cloneNode`s enter the container), and the measurement cache is content-addressed and lives elsewhere; `inert` does not affect layout, so measurement is unaffected (on device the `foreignObject` heights match the existing numbers)
  * **Toggling a task (which re-renders) leaves no residue** (on device: 2 tasks → 2 in the DOM, container has 0 children)

<h3>Engineering</h3>

* **One derivation point**: `domain/color.nodeColorScale` (fill / line / ink); `engine/mindmap-colors.nodeColorStyle` only maps the base colour onto the four style keys and no longer mixes colours or picks ink itself. The tier constants are collected in one place (`NODE_FILL_MIX` 0.84, canvas-white base `#ffffff`, `CHIP_MIN_CONTRAST` 1.12, `CHIP_SHIFT`, `BORDER_INK_MIX` 45%)
* **Link colour collected**: `features/node-inline-html.THEME_LINK_COLOR` is the single definition shared by inline links, tags and checkboxes; the external and unresolved variants reuse it too. `NODE_ACCENT_FALLBACK`, which pinned Obsidian's default accent, is gone
* **Residue collected**: `engine/mindmap.clearMeasureResidue`, registered in exactly one place (`node_tree_render_end` inside `createMindMap`), so the view and the read-only embed are both covered; it is **idempotent** (no writes at all once the attributes and content are already in the target state — render end is a hot path) and defensive against four no-op shapes
* **Tests**: new `tests/engine-measure-residue.test.ts`; assertions in `color-directive` / `mindmap-theme` / `node-inline-content` / `node-inline-tag` / `view-node-task` / `view-context-menu` / `export-svg-postprocess` moved to the new contract; the two engine stubs (`mindmap-codeblock` / `mindmap-wiki-icon`) gained `on`, matching the real `d.cts`
* Contracts recorded in the `AGENTS.md` decision table and as K151 / K152 in `docs/agents/conventions.md`
* Full suite: **95 files / 2558 cases**; gates `build` / `test` / `lint` / `lint:css` / `check:dead-code` / `check:release` / `verify:visual` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies; **`styles.css` is unchanged** (replacing `main.js` is enough, but update `manifest.json` too)
* **The file format is unchanged**: directives are still `%%#hex%%` / `%%none%%` comments — no new syntax, no reordering, no synthesised lines. This release **rewrites no existing file**
* **The look changes (per-node colours only)**: a `%%#hex%%` written on a node turns from "one mid-dark solid block for the whole branch" into "light fill + same-hue connectors + dark ink" — that is the point of this release, and not a single value in your files moved
* **The look changes (tags and checkboxes)**: 0.2.8 pinned Obsidian's default accent `#7f6df2`; this version follows the theme's link colour, exports included
* **Rolling back to 0.2.8 or earlier**: nodes return to the old "fill / border / connector in one colour, text flips light or dark" look, and a node coloured with Rose (`%%#b8455f%%`) shows as an ordinary custom colour — **no data is lost**, and re-upgrading restores it; files written by this version have no "new format" dependency
* **No new commands and no new settings keys**: command IDs, the `data.json` shape and the lossless round-trip contract are unchanged
