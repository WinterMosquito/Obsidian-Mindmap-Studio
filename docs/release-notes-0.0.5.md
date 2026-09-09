[中文](#cn-v0.0.5) | [English](#en-v0.0.5)

0.0.5 是一次以「代码检查 + 实测复现」驱动的修复版本：五路并行审查（官方 API 类型定义、官方 eslint 规则、源码正确性、发布/工作流一致性、测试缺陷检测力）后，逐条修复了**三处 Markdown 往返数据丢失**、悬停预览弹窗定位、改名断链、多窗口（popout）兼容与若干生命周期问题，并删除了 28.8 KB 无用 CSS。核心能力（Markdown 无损往返、三类链接图标、图片、PNG 导出、搜索、性能模式）保持兼容。

<h3 id="cn-v0.0.5">新增</h3>

* **`F2` 编辑当前节点**：与双击等效；输入框内让位给输入，已在编辑时忽略，无激活节点时仍吞键（避免触发核心「重命名文件」）。引擎自带的 F2 因要求「事件目标为 `document.body` 且指针在画布内」而时常失效，现由视图 scope 统一接管
* **「重置缩放（100%）」按钮**（位于「适应画布」左侧）：以画布中心为锚点回到 100%，屏幕可见内容保持原位；**自动整理后同样重置缩放**（不再把大图压到文字不可读）
* **打开时的默认视口**：100% 缩放 + **整体内容包围盒居中**（不再 fit 压小，也不再只居中根节点导致偏心树偏到一侧）

<h3>修复</h3>

* **Markdown 往返不再丢内容（实测复现后修复，新增 8 例回归用例）**：
  * 图文混合 / 「图 + 链接」节点只要编辑过文本，**图片引用会被静默丢弃**（合成路径此前只输出一枚 token）；给已有链接的节点插入图片、给已有图片的节点插入链接同样丢图 —— 现按原文顺序写出全部 token
  * **移除图片后旧图会复活**（`rawOk` 在 `image` 为空时跳过图片检查，而「链接已清除」检测又排除嵌入语法）—— 现判定「image 空但 md 图片字段仍在 → 已变更」，并同步清理 `mdImageTarget/mdImageWidth/mdImageHeight/mdImageAlt`
  * 节点文本恰好含同名串时，**新插入的图片/链接不会写入文件**（特征用裸子串判断）—— 现按嵌入/双链语法边界匹配
  * `![[图.png|说明]]` 的说明文本在编辑节点后丢失 —— 现解析与回写均保留
* **悬停预览弹窗现在会翻转到节点下方**：官方 `HoverPopover.position()` 的锚定矩形是混合取值（宽高走 `targetEl.offsetWidth/offsetHeight`、位置走 `getBoundingClientRect()`），SVG 节点没有前两个属性 → `bottom/right` 为 `NaN`，官方定位函数「下方放得下就放下方」的分支恒假，且上方放不下时 `top` 被写成 `"NaNpx"`（表现为完全没有预览）。现触发前补齐只读几何，恢复「下方优先、下方不足翻上方、两侧都不足则限高滚动」
* **编辑中心节点改名不再断链**：改用 `FileManager.renameFile`（`Vault.rename` 只改文件系统、不更新库内其他笔记中指向本文件的链接/反链）
* **多窗口（popout）兼容**：拖拽换父、图片拖拽调宽会话与窗口级粘贴兜底的监听改挂画布所属窗口（此前在 popout 里图片调宽完全失效、会话悬挂到视图关闭）
* **生命周期与竞态**：引擎初始化的 rAF 可取消（关闭视图后不再建出无人销毁的引擎实例）、视图关闭后不再应用过期加载结果、首帧视口恢复定时器随销毁取消、跨 `await` 校验引擎代际（弹窗/保存图片期间换文件不再静默丢失编辑）
* **文件名清理对齐 Obsidian 约束**：补 `# ^ [ ]`（含这些字符的名字无法被双链正确引用）、结尾点/空格与 `CON/PRN/…` 保留名（此前会直接失败或写出无法引用的文件名）
* **文档纠错**：README 曾写「编辑节点文本 = 双击或按 Enter」——Enter 实际是「添加同级节点」（按下去会新建节点），现改为 **F2** 并补上「重置缩放」；同时修正若干过期注释

<h3>工程</h3>

* **删除无用代码 −28.8 KB**：`styles.css` 的 vendor 段 100% 是 Quill 富文本样式（240 条 `.ql-*` 选择器），而本插件从不注册 RichText 插件、引擎样式由 bundle 运行时注入 `document.head` —— 删除该段及 `vendor/simple-mind-map.css`、`scripts/sync-vendor-css.mjs` 与对应 npm 脚本；实测删除前后渲染契约与节点测宽逐字节相同
* **测试 430 → 472**（35 个文件）：新增默认视口真实几何（此前只断言 mock 被调用）、快捷键注册接线、popout 窗口监听归属、文件名清理、保存「卸载兜底快照」等用例；变异检验确认新用例能抓住旧缺陷
* **CI 增加 `verify:visual --require-chrome`**（浏览器缺失即失败，不再静默跳过）；发布工作流的 tag 版本校验前移到构建之前（fail-fast）
* **收敛重复实现**：「插入承载节点」4 处手写收敛为单一入口 `insertChildNodeWithData`；三处裸 `getData` 改走防腐收口 `getNodeDataString`

<h3>兼容性说明</h3>

* 与 0.0.1–0.0.4 一致：**需要 Obsidian 1.13.0+**，**仅桌面端**（`isDesktopOnly: true`）
* 本版无破坏性变更；`.mindmap.md` 文件格式与既有文件的解析/回写行为保持兼容

---

<h3 id="en-v0.0.5">Added</h3>

* **`F2` edits the active node** (same as double-click): text inputs keep F2, an in-progress edit is left alone, and the key is still swallowed with no active node (so core's "Rename file" never fires). The engine's own F2 only fires when the event target is `document.body` and the pointer is inside the canvas, which is rarely true — the view scope now owns it
* **Reset zoom (100%) button** (left of *Fit to canvas*): returns to 100% anchored at the canvas centre so the visible content stays put; **auto-arrange resets zoom too** instead of fitting the whole map down to unreadable text
* **Default viewport on open**: 100% zoom with the whole content bounding box centred (no more fit-to-canvas shrink, and no more root-only centring that pushed lopsided maps to one side)

<h3>Fixed</h3>

* **Markdown round-trip no longer loses content** (reproduced, then fixed, with 8 new regression cases):
  * editing the text of a node that has both an image and a link **silently dropped the image** (the compose path emitted a single token); adding an image to a linked node or a link to an image node lost the image the same way — all tokens are now written in source order
  * **removing an image brought it back on the next save** (`rawOk` skipped the image check when `image` was empty while the "link cleared" check excluded embeds) — a removed image is now detected, and `removeNodeImage` clears the md image fields
  * a newly inserted image/link was **not written** when the node text happened to contain the same string (bare-substring feature match) — matching is now embed/wikilink-boundary aware
  * the caption in `![[img.png|note]]` was lost after editing — now preserved on parse and write-back
* **Hover previews now flip below the node**: the official anchor rect mixes sources (`targetEl.offsetWidth/offsetHeight` for width/height, `getBoundingClientRect()` for position); SVG nodes lack the former, so `bottom/right` became `NaN`, the "place below when there is room" branch never applied, and with no room above `top` was set to `"NaNpx"` (no preview at all). The geometry is now supplied before the preview is requested
* **Renaming the central node no longer breaks links**: uses `FileManager.renameFile` (`Vault.rename` renames on disk only and leaves links/backlinks pointing at the old name)
* **Popout window support**: drag-reparent, image-resize sessions and the window paste fallback now listen on the canvas's own window (image resizing used to fail outright in a popout and the session hung until the view closed)
* **Lifecycle and races**: the engine-init rAF is cancellable (no orphan engine instance after the view closes), stale load results are never applied, the first-frame viewport timer is cancelled on destroy, and engine identity is re-checked across `await` (switching files mid-dialog no longer drops edits)
* **File-name sanitising matches Obsidian's rules**: `# ^ [ ]`, trailing dots/spaces and reserved names (`CON/PRN/…`) are handled — previously they either failed outright or produced names that cannot be linked to correctly
* **Docs**: the READMEs claimed "double-click or press Enter" to edit a node — Enter actually inserts a sibling node. They now say **F2** and also list *Reset zoom*

<h3>Engineering</h3>

* **28.8 KB of dead code removed**: the `styles.css` vendor block was 100% Quill rich-text CSS (240 `.ql-*` selectors) while the plugin never registers the RichText plugin and the engine injects its own styles at runtime — the block, `vendor/simple-mind-map.css`, `scripts/sync-vendor-css.mjs` and its npm script are gone; rendering metrics are byte-identical before and after
* **Tests 430 → 472** (35 files), including real geometry for the default viewport (the only previous "coverage" asserted that a mock was called), hotkey wiring, popout listener ownership, file-name sanitising and the save-time fallback snapshot; mutation checks confirm the new cases fail against the old code
* **CI runs `verify:visual --require-chrome`** (a missing browser now fails instead of silently skipping); the release workflow verifies the tag against `manifest.json` before building
* **Duplicate owners collapsed**: four hand-written `INSERT_CHILD_NODE` call sites became `insertChildNodeWithData`, and three raw `getData` reads now go through the `getNodeDataString` facade

<h3>Compatibility notes</h3>

* Unchanged from 0.0.1–0.0.4: **requires Obsidian 1.13.0+**, **desktop only** (`isDesktopOnly: true`)
* No breaking changes; `.mindmap.md` files and their parsing/write-back behaviour remain compatible
