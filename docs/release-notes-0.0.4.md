[中文](#cn-v0.0.4) | [English](#en-v0.0.4)

0.0.4 是一次以「外部权威源严格检测」驱动的质量版本：用官方 API 类型定义（1.13.2）、官方 `eslint-plugin-obsidianmd`（0.4.2）规则、官方插件模板与社区目录校验工作流、官方帮助文档与 style guide 五路对照，逐项修复了 API 合规、Markdown 回写保真度、交互收尾、错误可见性、文案规范等问题，并把回归测试从 251 条扩到 430 条、新增无头渲染契约验证脚本。核心能力（Markdown 无损往返、三类链接图标、图片、PNG 导出、搜索、性能模式）保持兼容。

<h3 id="cn-v0.0.4">变更</h3>

* **Markdown 回写保真度**：编辑节点后合成回写不再丢信息——`![[图.png|300x150]]` 保留显式高度（源行仅有宽度时仍写 `|宽度`）、外链图片保留 alt（`![说明|300](url)`）、带显示文本的链接保留 `[文本](url)` 形态（不再被降级为 `文本 <url>`）、附件双链保留别名（`[[报告.pdf|说明]]`）
* **多图拖入不再丢图**：外部拖入多张图片时，首张挂到所选节点（与单图行为一致），其余各新建一个子节点承载；单张失败不再中断其余（失败经 Notice 汇总上报）
* **搜索修复**：命中为 0 时「没有匹配的节点」提示现在可达（此前依赖引擎回调，而引擎在空结果集上不回调，计数会残留上一次结果）；防抖窗口内按 Enter 先让未决搜索落地，不再作用于上一次关键词的陈旧结果集
* **弹窗修复**：新建名称弹窗空白输入时「创建」按钮置灰（不再是点了没反应的死按钮）；弹窗关闭兜底改用官方 `Modal.setCloseCallback`（不再覆写 `modal.onClose`）；链接弹窗手输 `[[笔记|别名]]` 会解析出别名并同步到节点文本
* **语言切换即时生效**：切换语言后命令面板命令名、丝带图标提示、状态栏与搜索栏文案立即刷新（此前需重载）；状态栏按单复数显示（`1 node` / `3 nodes`）；弹窗按钮按动作区分「创建」/「应用」
* **API 合规（对照官方 1.13.2 类型定义）**：库内文件查询改用官方推荐的 `getFileByPath` / `getFolderByPath`（并清掉全部源码级 eslint 抑制）；深色主题判定改用 `App.isDarkMode()`（不再读未文档化的 `body.theme-dark`）；文件浏览器菜单注入标记改用 `WeakMap`（不再往核心视图对象写自有属性）；启动恢复定时器随组件注销清理；核心视图类型字符串与悬停预览事件名集中为常量；`obsidian` 开发依赖固定为 `^1.13.1`
* **交互与错误处理**：拖拽换父 / 图片调宽的临时窗口监听在视图关闭时显式收尾（不再泄漏）；工具栏/右键菜单的异步动作自兜错误（转成用户可见提示，不产生未处理拒绝）；拖入失败由纯 console 改为 Notice；三处静默吞错降级为 `console.warn`（批量探测按次数汇总一次）
* **文案规范（对照官方 style guide）**：英文词典全面改为句子式大小写；术语统一（「主题」仅表示配色主题，节点概念统一为「节点」「中心节点」「子节点」；「库」→「仓库」；「插入」→「添加」；「文字」→「文本」）；快捷键写法规范化并补 macOS 变体；误导性提示修正（外部拖入仅支持图片、不再声称「音视频/PDF 无法写回」）；未识别文件时不再把原始拖拽数据打印给用户
* **工程**：新增 `npm run verify:visual` 无头 Chrome 渲染契约验证（三类链接图标分流、图标尺寸、画布铺满、节点测宽；已做反向验证）；`npm run lint` 收紧为 `--max-warnings 0`；源码零 `eslint-disable`；发布工作流新增 **tag 与 `manifest.json` 版本一致性校验**，并自动以 `docs/release-notes-<tag>.md` 作为 Release 说明；新增 `vendor/THIRD-PARTY-NOTICES.md` 声明打包内含的第三方依赖许可

<h3>其他变更</h3>

* **测试：**回归测试 251 → **430**（31 个文件，全绿）；新增 view-*/modal-* 与交互收尾、语言刷新等用例；覆盖率 statements 43.6% → **60.9%**，branches 86.0% → **86.6%**；`tsc -noEmit`、eslint（`--max-warnings 0`）、vitest、`verify:visual` 全通过
* **版本：**0.0.3 → 0.0.4，`manifest.json` / `versions.json` / `package.json` / `package-lock.json` 同步

<h3>兼容性说明</h3>

* 与 0.0.1–0.0.3 一致：**需要 Obsidian 1.13.0+**（声明式设置 API），**仅桌面端**（`isDesktopOnly: true`）
* 本版无破坏性变更：`.mindmap.md` 视图、无损往返、三类链接图标、图片与拖拽、搜索、导出、性能模式等行为保持兼容；既有文件中已存在的 `[文本](路径.md)` 形态仍按原样解析与回写

<h3>已知限制</h3>

* 沿用既往：图片独占节点（无文本）不参与节点文本搜索；每节点至多一条链接；非图片嵌入（如 `![[报告.pdf]]`）显示为可点击的附件图标而非内嵌渲染；行内标记随文本原样保留，导图内不做富文本渲染
* **有意偏离（本版明确文档化）：**新增链接与图片恒写 `[[双链]]` / `![[路径]]`，不跟随 Obsidian 的「使用 Wiki 链接」/「新链接格式」设置——这是为保住「文档双链 = 专属文档页图标」的视觉方案，详见 `AGENTS.md` 与 `docs/markdown-mindmap-standard.md`

---

<h3 id="en-v0.0.4">Changes</h3>

* **Markdown write-back fidelity**: synthesised write-back no longer loses information — explicit image heights are preserved (`![[img.png|300x150]]`; width-only sources still write `|300`), external image alt text is preserved (`![caption|300](url)`), links with display text keep the `[text](url)` form (no longer downgraded to `text <url>`), and attachment wikilink aliases survive (`[[report.pdf|label]]`)
* **Multi-image drop no longer loses images**: the first image goes on the selected node (unchanged single-image behaviour) and the rest become new child nodes; one failed import no longer aborts the others (failures are reported in a summary notice)
* **Search fixes**: the "no matches" state is now reachable (the engine does not invoke the callback on an empty result set, which previously left a stale count); pressing Enter inside the debounce window flushes the pending search instead of acting on the previous keyword's results
* **Dialog fixes**: the create-name dialog disables its confirm button while the name is blank (no more dead button); the close fallback now uses the official `Modal.setCloseCallback` instead of overwriting `modal.onClose`; typing `[[note|alias]]` in the link dialog resolves the alias and syncs it to the node text
* **Language switching takes effect immediately**: command palette names, ribbon tooltip, status bar and search-bar labels refresh on switch (previously needed a reload); the status bar pluralises (`1 node` / `3 nodes`); dialog buttons are action-specific (Create / Apply)
* **API compliance (audited against the official 1.13.2 typings)**: vault lookups now use the recommended `getFileByPath` / `getFolderByPath` (all source-level eslint suppressions removed); dark-mode detection uses `App.isDarkMode()` instead of the undocumented `body.theme-dark`; the file-explorer menu injection marker moved to a `WeakMap` (no more writing custom properties on core view objects); startup-restore timers are cleaned up with the component; core view-type strings and the hover-preview event name are centralised constants; the `obsidian` dev dependency is pinned to `^1.13.1`
* **Interaction and error handling**: temporary window listeners for drag-reparent and image-resize are torn down when the view closes; async toolbar/context-menu actions handle their own errors (user-visible notices, no unhandled rejections); drop failures notify instead of logging to console; three silent catches were downgraded to `console.warn` (batch probes summarised once)
* **Copy standards (per the official style guide)**: the English dictionary is sentence case throughout; terminology unified (theme vs node, "vault", "add" vs "insert", "text"); keyboard shortcuts formatted with macOS variants; misleading notices corrected; raw drag payloads are no longer shown to users
* **Engineering**: new `npm run verify:visual` headless-Chrome rendering contract check (link-icon routing, icon size, canvas fill, node measuring; reverse-verified); `npm run lint` tightened to `--max-warnings 0`; zero `eslint-disable` in source; the release workflow now verifies the tag against `manifest.json` and attaches `docs/release-notes-<tag>.md` as the release body; new `vendor/THIRD-PARTY-NOTICES.md` documents bundled third-party licences

<h3>Other changes</h3>

* **Tests:** regression grew from 251 to **430** across 31 files, all green; coverage 43.6% → **60.9%** statements, 86.0% → **86.6%** branches; `tsc --noEmit`, eslint (`--max-warnings 0`), vitest and `verify:visual` all pass
* **Version:** 0.0.3 → 0.0.4, synced across `manifest.json` / `versions.json` / `package.json` / `package-lock.json`

<h3>Compatibility notes</h3>

* Unchanged from 0.0.1–0.0.3: **requires Obsidian 1.13.0+** (declarative settings API), **desktop only** (`isDesktopOnly: true`)
* No breaking changes: the `.mindmap.md` view, lossless round-trip, the three link-icon channels, images and drag-and-drop, search, export and performance mode all remain compatible; existing `[text](path.md)` links keep parsing and writing back as before

<h3>Known limitations</h3>

* Carried over: image-exclusive nodes (no text) are not searchable; one link per node; non-image embeds such as `![[report.pdf]]` show a clickable attachment icon instead of rendering inline; inline marks are preserved as plain text — no rich-text rendering inside nodes
* **Intentional deviation (documented in this version):** new links and images are always written as `[[wikilinks]]` / `![[path]]`, ignoring Obsidian's "Use Wikilinks" / "New link format" settings, in order to keep the dedicated document-page icon; see `AGENTS.md` and `docs/markdown-mindmap-standard.md`
