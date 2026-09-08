[中文](#cn-v0.0.3) | [English](#en-v0.0.3)

作为 mindmap-studio 的第三个发布版本，0.0.3 合并了 0.0.2 以来的一处主动精简：移除 `Markdown 代码块` 渲染路径，统一以 `.mindmap.md` 作为唯一入口；同时清理了 0.0.2 期间的代码质量审计一次性产物。核心能力（Markdown 无损往返、双链与图片、PNG 导出、搜索、性能模式）保持不变，回归测试维持 21 个文件、251 条全绿。

<h3 id="cn-v0.0.3">变更</h3>

* **移除 ```mindmap 代码块渲染**：`src/codeblock.ts`（95 行）及其在 `main`（`registerMarkdownCodeBlockProcessor` / `CODE_BLOCK_LANGUAGE`）、`constants`、设置面板（`codeBlockDefaultLayout`「代码块默认布局」下拉）与主题 / 图片尺寸归一（`mindmap-theme.ts`、`images-path.ts` 的 `normalizeImageSizes`）中的代码块分支一并删除；今后思维导图统一以 `.mindmap.md` 文件打开（文件右键 / 命令面板 / 文件浏览器「新建」菜单），普通笔记中的 ```mindmap 代码块不再渲染为导图
* **文档清理**：移除已过期的代码质量 / eslint 一次性审计报告（`docs/code-quality-report.html`、`docs/eslint-audit-report.html`）与审计指南（`docs/code-quality-audit-guide.md`），同步删除 `AGENTS.md` 中对被删报告的过期引用，并移除 gitignore 的可再生 `coverage/` 产物；权威标准 `docs/markdown-mindmap-standard.md` 保留

<h3>其他变更</h3>

* **测试：**回归测试 252 → **251**（21 个文件，全绿；随 `normalizeImageSizes` 与 `codeBlockDefaultLayout` 下线的用例移除）；`tsc -noEmit`、eslint、vitest 全通过
* **版本：**0.0.2 → 0.0.3，`manifest.json` / `versions.json` / `package.json` / `package-lock.json` 同步

<h3>兼容性说明</h3>

* 与 0.0.1 / 0.0.2 一致：**需要 Obsidian 1.13.0+**（声明式设置 API），**仅桌面端**（`isDesktopOnly: true`）
* 本版移除的多为一次性 / 只读路径（代码块渲染与「代码块默认布局」设置）；`.mindmap.md` 视图、无损往返、图片 / 链接 / 搜索 / 导出 / 性能模式等核心能力不变

<h3>已知限制</h3>

* **新增：**移除 ```mindmap 代码块后，普通笔记不再能以代码块形式呈现导图；如需导图请使用 `.mindmap.md` 文件
* 沿用 0.0.2：图片独占节点（无文本）不参与节点文本搜索；每节点至多一条超链接；`![[笔记]]` 嵌入以 `[[链接]]` 形式承载不渲染嵌套内容；行内标记随文本原样保留，导图内不做富文本渲染

---

<h3 id="en-v0.0.3">Changes</h3>

* **Removed ```mindmap code-block rendering**: `src/codeblock.ts` (95 lines) plus its code-block branches in `main` (`registerMarkdownCodeBlockProcessor` / `CODE_BLOCK_LANGUAGE`), `constants`, the settings panel (`codeBlockDefaultLayout` dropdown), and theme / image-size normalization (`mindmap-theme.ts`, `images-path.ts` `normalizeImageSizes`) are removed. Mind maps now open exclusively from `.mindmap.md` files (context menu / command palette / file-explorer "New" menu); ```mindmap code blocks in ordinary notes no longer render as a map
* **Docs cleanup**: removed the superseded one-time code-quality/eslint audit reports (`docs/code-quality-report.html`, `docs/eslint-audit-report.html`) and the audit guide (`docs/code-quality-audit-guide.md`), dropped the stale `AGENTS.md` reference, and removed the gitignored regenerable `coverage/` output; the authoritative `docs/markdown-mindmap-standard.md` stays

<h3>Other changes</h3>

* **Tests:** regression grew down from 252 to **251** across 21 files, all green (the cases for `normalizeImageSizes` and `codeBlockDefaultLayout` were removed with the feature); `tsc --noEmit`, eslint, and vitest all pass
* **Version:** 0.0.2 → 0.0.3, synced across `manifest.json` / `versions.json` / `package.json` / `package-lock.json`

<h3>Compatibility notes</h3>

* Unchanged from 0.0.1/0.0.2: **requires Obsidian 1.13.0+** (declarative settings API), **desktop only** (`isDesktopOnly: true`)
* What was removed this version is one-time/read-only paths (code-block rendering and the "code block default layout" setting); the `.mindmap.md` view, lossless round-trip, images/links/search/export, and performance-mode capabilities are unchanged

<h3>Known limitations</h3>

* **New:** after dropping ```mindmap code blocks, ordinary notes can no longer present a map as a code block; use a `.mindmap.md` file instead
* Carried over from 0.0.2: image-exclusive nodes (no text) are not searchable via node text search; one hyperlink per node; `![[note]]` embeds are carried as `[[links]]` without rendering nested content; inline marks are preserved as plain text — no rich-text rendering inside nodes
