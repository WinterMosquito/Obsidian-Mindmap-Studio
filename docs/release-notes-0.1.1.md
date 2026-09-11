[中文](#cn-v0.1.1) | [English](#en-v0.1.1)

0.1.1 是一次「体验增强 + 链路修正」的版本：新增**连线样式切换**（工具栏 + 设置，按文件持久化）、右键菜单**重置缩放**、**维基链接悬停预览扩展到三类节点**，并修正了悬停预览的链路判定与「干净双链化」语义。底层 Markdown 无损往返、三类链接图标、图片与嵌入语法保真、PNG 导出、搜索、性能模式均保持兼容，且行为口径更清晰。

<h3 id="cn-v0.1.1">新增</h3>

* **连线样式切换（工具栏 + 设置）**：工具栏新增「连线」下拉，可在 `自动` / `曲线` / `直连` / `折线` 间切换，偏好**按文件**持久化到视图状态存储（不写入正文）。设置面板新增「默认连线样式」。`目录组织图` / `时间轴` / `鱼骨图` 为布局类原生直线、不可切换，控件只显示「自动」
* **右键菜单「重置缩放」**：右键菜单新增「重置缩放」项（rotate-ccw 图标），将视口恢复为 100%
* **维基链接悬停预览扩展到三类节点**：文档双链 / 文档嵌入（`mdWikiLinkpath`）、双链附件 / 嵌入附件 / 拖入的库内附件（`attachmentUrl` 回形针通道）现均可悬停触发 Obsidian 原生页面预览 / 附件预览；**外链节点不触发**（core 只服务库内目标）；拖拽节点 / 框选 / 平移时按住鼠标键不弹预览（避免噪声）
* **根节点连线起点改在节点右缘**（`rootLineStartPositionKeepSameInCurve`）：与子层级一致、从右缘水平出发，消除此前「斜戳出来」的观感

<h3>修复</h3>

* **维基链接悬停预览链路修正**：节点承载的链接读取顺序与图标分流**同源**——文档双链 / 嵌入走 `mdWikiLinkpath`、附件走 `attachmentUrl`（并以 `mdAttachmentLinkpath` 为门控，避免已「移除引用」的残留字段让附件继续可悬停 / 可打开）；`hyperlink` 仅双链形态有效，裸 URL / 协议地址 / 畸形串一律不预览，与 Obsidian 阅读视图一致

<h3>行为变化提示</h3>

* **「纯双链化」**：把文档 / 附件链接挂到节点时，节点文字**无条件覆盖**为链接显示名（别名优先），不再保留用户已有的手写正文；底层 md 行也只剩 `[[目标|显示名]]`。如果你此前依赖「正文节点只附加链接、保留手写正文」，请注意此行为变化
* **移除引擎自带 Ctrl+L 快捷键**（仅 `RESET_LAYOUT`，不含「适应画布」、无提示）：自动整理统一走 `mindmap-arrange` 命令——你把它绑到 Ctrl+L 时同样以「适应画布」收尾，口径统一

<h3>工程</h3>

* **新增 `scripts/verify-visual.mjs` 可视化校验脚本**（202 行），配合 CI 归档诊断日志（`verify-visual-logs/`，不入库）
* **测试补强**：新增 `tests/mindmap-theme.test.ts`，并对工具栏、维基链接、视图状态、保存管线、设置、节点操作、视口等大量用例扩充
* **对齐官方校验**：obsidian-api（1.13.2 类型校验 0 错误）、eslint-plugin-obsidianmd（0.4.2，0 警告）
* **文档同步**：README / AGENTS.md / 双语说明更新连线样式、「纯双链化」口径、悬停预览语义

<h3>兼容性说明</h3>

* 与 0.1.0 一致：**需要 Obsidian 1.13.0+**，**仅桌面端**（`isDesktopOnly: true`）
* 视图状态存储新增 `lineStyle` 字段（按文件持久化连线偏好）；旧版 `data.json` 无该字段时回落全局默认，向后兼容
* `.mindmap.md` 文件格式与命令 ID 均未变更；无破坏性格式变更

---

<h3 id="en-v0.1.1">Added</h3>

* **Connector style switching (toolbar + settings)**: the toolbar gains a "Line style" dropdown with `Auto` / `Curve` / `Direct` / `Elbow`; the preference is persisted **per file** in the view-state store (never written into the note body). Settings adds "Default line style". `Catalog` / `Timeline` / `Fishbone` are natively straight layouts and cannot switch, so the control shows only "Auto"
* **Right-click menu "Reset zoom"**: a new "Reset zoom" item (rotate-ccw icon) restores the viewport to 100%
* **Wikilink hover preview extended to three node kinds**: document wikilinks / embeds (`mdWikiLinkpath`) and dual-link / embedded / dragged vault attachments (`attachmentUrl` paperclip channel) now trigger Obsidian's native page / attachment preview on hover; **external-link nodes do not** (core only serves vault targets); holding the mouse button during drag / box-select / pan suppresses the preview (avoids noise)
* **Root node connector now starts at the node's right edge** (`rootLineStartPositionKeepSameInCurve`): consistent with child levels and emits horizontally, removing the previous "skewed out" look

<h3>Fixed</h3>

* **Wikilink hover-preview link resolution corrected**: the node's link is now read in the **same order as icon routing** — document wikilink / embed via `mdWikiLinkpath`, attachment via `attachmentUrl` (gated on `mdAttachmentLinkpath` so a "removed reference"'s leftover field can't keep the attachment hoverable / openable); `hyperlink` is only valid as a wikilink shape — bare URLs / protocol addresses / malformed strings never preview, matching Obsidian's reading view

<h3>Behaviour changes</h3>

* **Pure-wikilink conversion**: when a document / attachment link is attached to a node, the node text is **unconditionally overwritten** with the link's display name (alias first); user-authored body text is no longer preserved, and the underlying md line becomes only `[[target|display]]`. If you previously relied on "body nodes only append a link and keep the hand-written text", note this change
* **Removed the engine's built-in Ctrl+L shortcut** (only `RESET_LAYOUT`, no "fit canvas", no notice): auto-arrange now goes solely through the `mindmap-arrange` command — binding it to Ctrl+L still ends with "fit canvas", keeping one consistent behavior

<h3>Engineering</h3>

* **New `scripts/verify-visual.mjs` visual-verification script** (202 lines), with CI archiving its diagnostic logs (`verify-visual-logs/`, excluded from the repo)
* **Test hardening**: added `tests/mindmap-theme.test.ts` and expanded coverage for the toolbar, wikilinks, view state, save pipeline, settings, node actions and viewport
* **Aligned with official checks**: obsidian-api (1.13.2 type-check, 0 errors), eslint-plugin-obsidianmd (0.4.2, 0 warnings)
* **Docs synced**: README / AGENTS.md / bilingual notes updated for line style, pure-wikilink semantics and hover-preview behavior

<h3>Compatibility notes</h3>

* Unchanged from 0.1.0: **requires Obsidian 1.13.0+**, **desktop only** (`isDesktopOnly: true`)
* The view-state store gains a `lineStyle` field (per-file connector preference); older `data.json` without it falls back to the global default, so it is backward compatible
* The `.mindmap.md` format and command IDs are unchanged; no breaking format changes
