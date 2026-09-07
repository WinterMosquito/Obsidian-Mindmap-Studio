[中文](#cn-v0.0.1) | [English](#en-v0.0.1)

作为 mindmap-studio 的首个公开发布版本，本版本交付完整的核心能力闭环：把 `.mindmap.md` 当作思维导图编辑、以 100% 标准 Markdown 存储、无损往返；同时完成 API 合规（对照 obsidian.d.ts 1.13.2）、lint 基线（eslint-plugin-obsidianmd 0.4.2）与 75 条回归测试的工程底座。

<h3 id="cn-v0.0.1">新增功能</h3>

* **Markdown 渲染层**：`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），无任何专有格式；解析为导图编辑后无损回写，未编辑的行（含 `[[双链]]`、`![[图片]]`、行内标记、代码围栏）逐字保留
* **Obsidian 原生集成**：双链（含 `#区块` 与 `|别名`）、图片/附件嵌入、悬停页面预览、Ctrl/Cmd+点击新标签打开、附件粘贴与拖入遵循系统「附件存放位置」设置
* **视图与编辑**：`.mindmap.md` 以导图视图打开（文件右键 / 命令面板 / 文件浏览器「新建」菜单），可随时切回 Markdown 编辑并自动记忆打开方式偏好（重启后恢复）
* **节点操作**：添加子级/同级、删除（uid 异常兜底）、复制/粘贴、编辑链接与图片、全屏查看图片；工具栏与右键菜单双入口
* **链接与附件**：插入链接弹窗联想库内笔记与附件（官方 AbstractInputSuggest），同名笔记自动按路径消歧；插入图片支持本地选择 / 剪贴板粘贴 / 外部 URL
* **布局与外观**：逻辑结构图 / 思维导图 / 组织结构图 / 目录组织图 / 时间轴 / 鱼骨图六种布局；主题跟随 Obsidian 亮暗色，可强制亮色或暗色
* **搜索与导出**：节点搜索（`Mod+F`，带计数与上下跳转）；PNG 导出（倍率 1–4 可调，超大画布自动按轴适配不裁切）
* **```mindmap 代码块**：任意笔记中渲染只读思维导图（主题与布局可配置）
* **性能模式**：节点数超过阈值（默认 500，可调 100–2000）自动启用虚拟渲染，仅渲染可视区域；超大导图自动压缩命令历史，控制内存
* **状态栏**：实时节点计数（当前视图关闭后自动让位其他导图视图）

<h3>体验优化</h3>

* 编辑快捷键对齐官方约定：`Mod+Z` 撤销、`Mod+Shift+Z` / `Mod+Y` 重做（视图内生效）；`Mod+F` 搜索；`Esc` 关闭搜索
* 设置面板采用 Obsidian 1.13+ 声明式设置，支持设置搜索；界面语言中文 / English 可切换
* 新建文件默认名「思维导图 + 日期」，重名自动追加序号（序号插在 `.mindmap.md` 之前）；粘贴图片按 Obsidian 核心约定命名 `Pasted image YYYYMMDDHHMMSS`，外部拖入保留原名并按比例设置节点图
* 库内文件重命名 / 删除 / 移入回收站时，打开中的导图同步更新树内图片与 `[[链接]]` 引用
* 视图状态（布局 / 视口 / 打开偏好）按文件路径持久化到插件 `data.json`，不写入笔记正文

<h3>其他变更</h3>

* **工程底座：**对照官方 obsidian.d.ts 1.13.2 审计，仅存 3 处无官方等价私有 API 触点（均防御式实现并文档化），零废弃 API；lint 基线采用 eslint-plugin-obsidianmd 0.4.2
* **测试与 CI：**75 条回归测试（Markdown 往返 / domain / 并发原语 / URL 谓词 / 保存管线 / 视图状态 / 设置校验），CI 在 build 后、lint 前执行；`tsc -noEmit` 同时校验 `src/` 与 `tests/`
* **引擎 vendor：**simple-mind-map 0.14.0-fix.3（思绪思维导图发布的第三方修订版，fork 自 wanglin2/mind-map 0.14.0），按需 tree-shake 重打包，修订清单与升级流程见 `vendor/BUILD.md`

<h3>兼容性说明</h3>

* **需要 Obsidian 1.13.0+**：设置面板使用 1.13 引入的声明式设置 API
* **仅桌面端**（`isDesktopOnly: true`）：系统默认应用打开附件、部分拖拽能力依赖桌面环境

<h3>已知限制</h3>

* 每个节点至多承载一条超链接（引擎单链语义）；需要多条链接时可拆分为子节点
* 对 Markdown 笔记的嵌入（`![[笔记]]`）以 `[[链接]]` 形式承载，不渲染嵌套笔记内容；图片 / 音视频 / PDF 等附件嵌入行为正常（图片渲染为节点图，其余以链接打开）
* 布局 / 视口 / 打开偏好存于插件 `data.json`（按文件路径），不含敏感内容，不写入笔记正文
* 节点内行内代码、粗体等轻标记随文本原样保留，导图内不做富文本渲染

---

<h3 id="en-v0.0.1">New Features</h3>

* **Markdown rendering layer**: a `.mindmap.md` file is 100% standard Markdown (frontmatter + headings + lists) with no proprietary format; edited as a mind map and written back losslessly — untouched lines (including `[[wikilinks]]`, `![[embeds]]`, inline marks, and code fences) are preserved verbatim
* **Native Obsidian integration**: wikilinks (with `#blocks` and `|aliases`), image/attachment embeds, hover page preview, Ctrl/Cmd+click to open in a new tab, and attachment pasting/dragging that follows the system "Attachment folder location" setting
* **View & editing**: open a `.mindmap.md` in the mind map view (file context menu / command palette / file-explorer "New" menu), switch back to Markdown editing at any time; the open-as preference is remembered and restored across restarts
* **Node operations**: insert child/sibling nodes, delete (with uid-anomaly fallback), copy/paste, edit link & image, fullscreen image preview; available from both the toolbar and context menus
* **Links & attachments**: the link modal suggests vault notes and attachments (official AbstractInputSuggest) with automatic path disambiguation for same-name notes; insert images from local files / clipboard paste / external URLs
* **Layouts & appearance**: six layouts — logical structure / mind map / organization chart / catalog organization / timeline / fishbone; theme follows Obsidian light/dark with forced options
* **Search & export**: node search (`Mod+F`, with match counter and prev/next navigation); PNG export (scale 1–4, oversized canvases are per-axis scaled instead of clipped)
* **```mindmap code block**: render read-only mind maps inside any note (configurable theme and layout)
* **Performance mode**: automatically enables virtual rendering above a node threshold (default 500, adjustable 100–2000); large maps compress command history to bound memory
* **Status bar**: live node count, handed off between open mind map views

<h3>Experience improvements</h3>

* Editing shortcuts aligned with official conventions: `Mod+Z` undo, `Mod+Shift+Z` / `Mod+Y` redo (inside the view); `Mod+F` search; `Esc` closes search
* Declarative settings (Obsidian 1.13+) with settings-search support; UI language switches between 中文 and English
* New files default to "思维导图 + date" with automatic ordinal suffixes for duplicates (inserted before the `.mindmap.md` suffix); pasted images follow the Obsidian core naming convention `Pasted image YYYYMMDDHHMMSS`, dropped images keep their original names and are sized by aspect ratio
* Renaming / deleting / trashing vault files updates image and `[[link]]` references inside open mind maps
* Per-file layout / viewport / open-as are persisted to the plugin `data.json`, never into note bodies

<h3>Other changes</h3>

* **Engineering baseline**: audited against official obsidian.d.ts 1.13.2 — only 3 private API touchpoints with no official equivalent (all defensive and documented), zero deprecated API usage; lint baseline uses eslint-plugin-obsidianmd 0.4.2
* **Tests & CI**: 75 regression tests (Markdown round-trip / domain / concurrency / URL predicates / save pipeline / view state / settings), run in CI after build and before lint; `tsc --noEmit` checks both `src/` and `tests/`
* **Engine vendor**: simple-mind-map 0.14.0-fix.3 (a third-party patched distribution, forked from wanglin2/mind-map 0.14.0), re-bundled with tree-shaking; the fix list and upgrade workflow are documented in `vendor/BUILD.md`

<h3>Compatibility notes</h3>

* **Requires Obsidian 1.13.0+**: the settings panel uses the declarative settings API introduced in 1.13
* **Desktop only** (`isDesktopOnly: true`): opening attachments with system apps and some drag capabilities rely on desktop features

<h3>Known limitations</h3>

* Each node carries at most one hyperlink (engine single-link semantics); split multiple links into child nodes
* Markdown-note embeds (`![[note]]`) are carried as `[[links]]` and do not render nested note content; image/audio/video/PDF embeds behave normally (images render as node images, others open as links)
* Layout / viewport / open-as preferences live in the plugin `data.json` (keyed by file path) — no sensitive content, never written into note bodies
* Inline marks (code, bold, etc.) are preserved as plain text inside nodes; the map does not render rich text
