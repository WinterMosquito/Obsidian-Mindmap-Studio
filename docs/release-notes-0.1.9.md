[中文](#cn-v0.1.9) | [English](#en-v0.1.9)

0.1.9 是一次**代码块原生化 + Obsidian 1.14 兼容**版本：节点内代码块改接官方 `loadPrism`，与阅读视图同源高亮，并补齐围栏 / 缩进块三处渲染缺口；同时修复宿主升级到 MathJax 4.1.3 之后**行内数学全量退回字面 `$…$`**、以及**节点内容底部被裁切**两处缺陷。无破坏性变更（`.mindmap.md` 格式、命令 ID 与设置项均未变）。

<h3 id="cn-v0.1.9">新增</h3>

* **代码块语法高亮（接官方 Prism）**：节点内围栏代码块现在与阅读视图同源高亮。语言取自围栏信息行的首个词并按白名单校验（未登记的语言一律保留字面；`__proto__` / `constructor` 一类不会被当成语法键）；token 产物走 `Prism.tokenize` 逐字 `createTextNode` 落地，**全程不经 `innerHTML`**。配色**不写死**——探测宿主主题下 `.token.<类型>` 规则的计算色后**内联**到每个 token 元素，故屏上与**导出 PNG 同色**（导出 SVG 不含 `app.css`）；换主题（含明暗未变的主题切换）只就地改色，不重建节点
* **代码块渲染补齐三处缺口**：`~~~` 波浪号围栏此前只有解析层识别、渲染层按普通文本显示；围栏语言码此前在渲染侧被丢弃（现贯通到 `<code class="language-…">`）；缩进式代码块（4 空格 / Tab）此前在显示层被剥掉缩进、退化成普通文字，现按 CommonMark 走同一块级通道

<h3>修复</h3>

* **Obsidian 1.14 下行内数学不再全量退回字面 `$…$`**：1.14 把宿主 MathJax 从 3.2.2 换到 4.1.3，逐字符样式规则由「空 `content`」改成「零 `padding`」，而本插件的「就绪判据」只认前者 ⇒ 含不可见操作符（U+2061 / U+2062，MathJax 为隐式乘法与函数应用自动插入，`E=mc^2`、`\sin x` 实测均含）的公式**恒被判为未就绪**，重试耗尽后保留字面并误告警「数学产物不可见」。判据现为**双形态**：先查 v3 形态（空 `content`），未命中再按字符码查该字符的规则是否「`padding` 各分量全为 0」，两代宿主都正确（几何实测完全正常，问题只在判据）
* **节点内容不再被裁掉底部**：MathJax 字体是渐进加载的，字体到位后同一段公式的自然宽会变，而引擎的离屏测量缓存以元素 `outerHTML` 为键（不含字体状态）⇒ 重测命中偏小的旧宽度 ⇒ 一旦 `foreignObject` 宽度小于内容自然宽，内容被迫换行而框高不变、底部被 `overflow:hidden` 裁掉。实测宽度只差 **4px** 即触发（`\sqrt{}` 缺 13.96px、`E=mc^2` 缺 11.72px，而 `\sin` / `\cos` 恰好不缺——富余掩盖了缺陷，故并非所有公式都出现可见症状）。修法是把**字体代际**编进测量缓存键：同一字体状态下缓存照常命中（零额外测量），字体状态一变则必然重测
* **在库根目录「新建思维导图」不再建到别的目录**：库根的路径是**空串**（不是 `/`），旧代码用 `||` 判空，会把「显式指定库根」误判成「未指定」并回落到默认新建目录。改用 `??`（只有未指定才回落），并统一路径拼接以免产出前导斜杠
* **失败不再静默**：用系统默认应用打开文件失败、Alt 拖拽复制节点失败、应用设置后重建引擎失败，此前都只写控制台——用户看到的是「点了没反应」「设置没生效」，现在都给出明确提示
* **拖入多个文件失败时不再弹两条提示**：入库通道对每个失败已弹过一次，汇总层会再弹一次、且第二条正文是字面量 `null`。现只有「抛异常」这一路径由汇总层提示，其余仅留控制台计数
* **图片尺寸参数不再回写成双管道**：`![[图片||250]]` 这类畸形写法修正为 `![[图片|250]]`
* **RTL 语言下工具栏右侧分组与候选列表不再错位**：`margin-left` / `margin-right` 改为逻辑属性（`margin-inline-start` / `margin-inline-end`），随宿主工作区翻转（Obsidian 1.14 起工作区整体随 RTL 翻转，物理属性不跟随）；代码块复制按钮的定位同步改为 `inset-inline-end`，修 RTL 下不镜像

<h3>工程</h3>

* **弹窗骨架收口**：name / link / image / text 四个弹窗逐字重复的「Promise + Modal + settle 守卫 + 标题 + 内容根 + `open()`」合一为 `ui/modal-common.openFormModal`，**「先 settle 再 close」的顺序由 helper 保证**（顺序反了会把用户输入当成取消——该坑此前在四个文件里各被注释一次）。按钮行与快捷键仍各自实现（四者按钮集合与提交键语义各异，硬抽即泄漏抽象）
* **窗口级拖拽会话收口**：图片拖宽与拖拽换父两处**逐行同构**的会话原语（临时监听 + rAF 合帧 + 幂等收尾，约 40 行 × 2）合一为 `features/drag-session.startWindowDragSession`；两处唯一的语义差异（**手势独占** vs **只观察**）显式化为 `capture` 参数——该差异此前已真实分叉过一次
* **新增 `core/measure-cache.ts`**：字体代际缓存键的实现（见上「修复」），文件头登记「只改键、不重建元素、不触发重排」的耦合契约——**重建时机由既有 `loadingdone` 钩子提供，该钩子若被移除本修复会静默退化为 no-op**
* **导航历史清理的降级留痕提级**：`console.debug` → `console.warn`——该行是「侧键后退无反应」的唯一诊断线索，留在 debug 级等于无痕退化；仍不弹 Notice（每次视图切换都会跑，否则会刷屏）
* **渲染契约新增可判定不变式**：`verify:visual` 现断言代码块的语言类已就位、且「无 Obsidian 运行时时必须停在字面、不得渲染空白」；以及自绘内容盒**必须带字体代际标记**、**内容底边不得超出 `foreignObject` 底边 >0.5px**（实测取数非空：37 个内容盒、溢出量全为 0，并以翻转阈值的方式验过断言不是空过）
* **新增可复现基线文档 `docs/agents/baseline-metrics.md`**：门禁基线、打开性能（500 / 5000 / 10000 节点）、体积归因与静态指标的读数均附复现命令与构建指纹；`verify:visual` 新增 `--bench-open` 打开性能基线模式
* 测试全量 **65 文件 / 1906 例**

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**——数学判据的双形态让 MathJax 3（1.13）与 MathJax 4（1.14）两代宿主都正确，不必抬高门槛
* `.mindmap.md` 格式、命令 ID 与设置项均未变更；代码块的**显示层**口径已登记进 `docs/markdown-mindmap-standard.md`，解析与序列化对围栏块仍**逐字往返**
* ⚠ **本轮 `styles.css` 有变化**（工具栏 / 候选列表改用逻辑属性；代码块复制按钮悬停显隐），更新时**需同时替换 `main.js` 与 `styles.css`**
* ⚠ **已知行为变化（与 Obsidian 原生一致）**：代码块复制按钮改为**悬停才显形**（此前常态显示并压住首行约 2 个字符），触屏 / 无 hover 环境仍常显；附带效应是复制成功的 ✓ 反馈持续 1.2s，若指针在 1.2s 内移出代码块，反馈随即不可见
* **已知取舍**：第三方语言处理器（如 dataviewjs 一类）在导图节点内不生效——官方的代码块注册接口只作用于阅读视图管线，整段交回宿主管线会让导出离屏克隆退回字面，并破坏本模块「同步纯 DOM、零监听、可单测」的契约
* 无新增设置项、无新增第三方依赖（Prism 与 MathJax 均来自 Obsidian 自带运行时）

---

<h3 id="en-v0.1.9">Added</h3>

* **Code-block syntax highlighting (official Prism)**: fenced code blocks inside nodes are now highlighted from the same source as reading view. The language is taken from the first word of the fence info string and validated against a whitelist (unregistered languages stay literal; names such as `__proto__` / `constructor` are never used as grammar keys). Tokens are produced by `Prism.tokenize` and placed character by character via `createTextNode` — **no `innerHTML` anywhere**. Colors are **not hard-coded**: the computed color of the host theme's `.token.<type>` rules is probed and **inlined** onto each token element, so on-screen and **exported PNG** colors match (exported SVG carries no `app.css`). Theme changes (including ones that do not switch light/dark) recolor in place without rebuilding nodes
* **Three code-block rendering gaps closed**: `~~~` tilde fences were recognized by the parser but rendered as plain text by the display layer; the fence language code was dropped on the render side (it now reaches `<code class="language-…">`); indented code blocks (4 spaces / Tab) had their indentation stripped on display and degraded into ordinary text — they now go through the same block-level channel per CommonMark

<h3>Fixed</h3>

* **Inline math no longer falls back to literal `$…$` across the board on Obsidian 1.14**: 1.14 moved the host MathJax from 3.2.2 to 4.1.3, and the per-character style rules changed from "empty `content`" to "zero `padding`", while this plugin's readiness check only recognized the former — so formulas containing invisible operators (U+2061 / U+2062, inserted automatically by MathJax for implicit multiplication and function application; both `E=mc^2` and `\sin x` contain them in practice) were **permanently judged not ready**, and after the retries were exhausted the literal text was kept along with a false "math output invisible" warning. The check is now **two-form**: it first tests the v3 form (empty `content`), and if that misses, looks up that character's rule by code point and treats "all `padding` components are 0" as invisible. Both host generations are now correct (measured geometry was fine all along — only the check was wrong)
* **Node content is no longer clipped at the bottom**: MathJax fonts load progressively, and a formula's natural width changes once its fonts arrive, while the engine's off-screen measurement cache is keyed by element `outerHTML` (which carries no font state) — so a re-measure would hit the smaller stale width, and as soon as the `foreignObject` is narrower than the content's natural width the content wraps while the box height stays the same and `overflow:hidden` clips the bottom. A width shortfall of just **4px** is enough to trigger it (`\sqrt{}` was short by 13.96px, `E=mc^2` by 11.72px, while `\sin` / `\cos` happened to be fine — headroom masked the defect, which is why not every formula showed visible symptoms). The fix folds the **font generation** into the measurement cache key: within one font state the cache still hits (zero extra measurement), and any font-state change forces a real re-measure
* **"New mind map" on a vault root no longer lands in another folder**: a vault root's path is the **empty string** (not `/`), and the old code tested it with `||`, so "explicitly the vault root" was misread as "unspecified" and fell back to the default new-file folder. It now uses `??` (fall back only when unspecified) and builds the path through a helper so no leading slash is produced
* **Failures are no longer silent**: opening a file with the system default app, Alt-drag duplication, and engine rebuild after applying settings all used to only write to the console — users saw "nothing happened" or "the setting had no effect". All three now raise an explicit notice
* **Dropping several files no longer produces two notices per failure**: the import channel already notifies for each failure, and the aggregation layer notified again with a literal `null` as the message body. Only the "threw an exception" path is aggregated now; the rest leave a console count
* **Image size parameters are no longer written back with a double pipe**: malformed output such as `![[image||250]]` is fixed to `![[image|250]]`
* **Toolbar right group and suggestion list no longer misplace under RTL languages**: `margin-left` / `margin-right` became logical properties (`margin-inline-start` / `margin-inline-end`) that follow the host workspace (since Obsidian 1.14 the workspace flips as a whole under RTL, physical properties do not); the code-block copy button's positioning moved to `inset-inline-end` so it mirrors correctly under RTL

<h3>Engineering</h3>

* **Modal scaffolding consolidated**: the verbatim-duplicated "Promise + Modal + settle guard + title + content root + `open()`" block of the name / link / image / text modals is now `ui/modal-common.openFormModal`, with the **"settle before close" order guaranteed by the helper** (getting it backwards turns user input into a cancellation — a pitfall previously explained in a comment in all four files). Button rows and hotkeys stay per-modal (the four differ in button sets and submit-key semantics; extracting them would leak an abstraction)
* **Window-level drag session consolidated**: the two line-for-line identical session primitives (temporary listeners + rAF coalescing + idempotent teardown, ~40 lines each) behind image resizing and drag-to-reparent are now `features/drag-session.startWindowDragSession`. Their only semantic difference — **exclusive gesture** vs **observe only** — is an explicit `capture` parameter, a difference that had already diverged once in practice
* **New `core/measure-cache.ts`**: the font-generation cache key described under "Fixed". Its header records the coupling contract — it **only changes the key, never rebuilds elements or triggers reflow**; the rebuild timing comes from the existing `loadingdone` hook, so **removing that hook silently degrades this fix to a no-op**
* **Navigation-history fallback is no longer logged at debug level**: `console.debug` → `console.warn` — that line is the only diagnostic trace for "side-button Back does nothing", and leaving it at debug level was effectively traceless. It still does not raise a notice (it runs on every view switch, which would spam)
* **New decidable invariants in the render contract**: `verify:visual` now asserts that the code block's language class is in place and that, with no Obsidian runtime available, code must stay literal rather than render blank; plus that self-drawn content boxes **must carry the font-generation marker** and that **their bottom edge must not exceed the `foreignObject` bottom by more than 0.5px** (measured data was non-empty: 37 content boxes, all overflow values 0, and the assertions were verified non-vacuous by flipping the threshold)
* **New reproducible baseline document `docs/agents/baseline-metrics.md`**: gate baselines, open performance (500 / 5000 / 10000 nodes), bundle-size attribution and static metrics all come with their reproduction commands and build fingerprints; `verify:visual` gained a `--bench-open` open-performance baseline mode
* Full test suite: **65 files / 1906 cases**

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0** — the two-form math check is correct on both MathJax 3 (1.13) and MathJax 4 (1.14), so the floor does not need to move
* The `.mindmap.md` format, command IDs and settings are unchanged; the code-block **display-layer** rules are recorded in `docs/markdown-mindmap-standard.md`, and parsing/serialization still round-trips fenced blocks **character for character**
* ⚠ **`styles.css` changed in this release** (toolbar / suggestion list moved to logical properties; code-block copy button now shows on hover) — updating requires replacing **both `main.js` and `styles.css`**
* ⚠ **Known behavior change (matching Obsidian's own)**: the code-block copy button now **appears on hover** (it used to be always visible, covering about two characters of the first line); on touch / no-hover environments it stays visible. A side effect is that the ✓ feedback lasts 1.2s, so moving the pointer out of the code block within that window hides the confirmation early
* **Known trade-off**: third-party language processors (dataviewjs and the like) do not take effect inside mind-map nodes — the official code-block registration API only affects the reading-view pipeline, and handing the whole block back to the host pipeline would make the off-screen export clone fall back to literal text and break this module's "synchronous, pure DOM, no listeners, unit-testable" contract
* No new settings, no new third-party dependencies (both Prism and MathJax come from Obsidian's own runtime)
