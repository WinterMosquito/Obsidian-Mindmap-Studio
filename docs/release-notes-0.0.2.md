[中文](#cn-v0.0.2) | [English](#en-v0.0.2)

作为 mindmap-studio 的第二个发布版本，0.0.2 汇总自 0.0.1 以来的主要用户与开发者相关变更：三类节点级新交互（拖拽换父辅助、节点图片拖宽、图片独占节点），一组可感知的性能与写盘优化，一个画布右键菜单的 bug 修复，以及工程底座扩充——回归测试由 75 条增至 252 条。

<h3 id="cn-v0.0.2">新增功能</h3>

* **拖拽换父辅助**：引擎原生判定要求指针精确落在目标节点矩形内；现拖到**节点中心附近**（与节点大小无关的均匀圆域）即挂为其子节点，拖到**相邻兄弟间隙**即插入该位置；两类候选统一按指针距离最近仲裁，拖拽期间实时高亮目标，松手仍走引擎原生命令（`MOVE_NODE_TO` / `INSERT_AFTER`），引擎精确命中时辅助让位
* **节点图片拖宽**：悬停图片右下角出现手柄，拖拽等比调宽（宽高联动钳制，防止比例破坏）；松手后以 Obsidian 官方嵌入尺寸语法写回 Markdown——`![[图.png|300]]` 仅宽等比、`![[图.png|300x150]]` 指定宽高、`![alt|300](url)` 外链图尺寸在标签尾部；持久化进笔记本体而非 `data.json`
* **图片独占节点**：纯图行（`- ![[x.png]]`）解析为无文本节点，不回退文件名占位；右键「移除文字」或双击清空文字后，节点即被图片独占，Markdown 往返保持

<h3>体验优化</h3>

* **性能：**保存热路径的库内文件解析改为索引缓存快命中（原先每次保存对每图片节点全量扫描文件列表，现 O(1) 命中，新鲜度由库事件失效保证）；拖拽期间的 `mousemove` 经 `requestAnimationFrame` 合帧；图片拖宽在相同取整尺寸下跳过引擎全量重渲染
* **性能：**引擎初始化的画布零尺寸等待由 200ms 轮询改为 `ResizeObserver` 事件驱动；外部图片比例探测限流有界并发（上限 6），超大图打开不再触发解码风暴
* **写盘：**设置面板变更 400ms 防抖合并落盘（滑块连续拖动由逐档重写合并为一次），写盘载荷不再携带视图状态全量快照（由写前重读合并保证 `viewState` 不丢失）
* 库内文件解析收敛到统一入口 `resolvePathToFile`：远程地址拒绝 / `obsidian://` / 资源地址 / 路径直查 / `file://`（官方 `getFirstLinkpathDest`）/ 索引兜底按形态路由，并以 eslint 规则机械禁止绕行

<h3>问题修复</h3>

* 修复画布右键菜单在部分节点上恒为空白的问题：引擎不在节点 DOM 写入 uid，旧实现读取 `data-uid` 属性恒为 `null`；改为按「节点渲染 group 包含目标元素」做身份匹配，并以 vendor 契约测试锁定

<h3>其他变更</h3>

* **测试与 CI：**回归测试 75 → **252**（21 个文件，全绿；新增 engine-controller / event-binder / persistence / file-lookup / links-resolve / images-path / vendor 契约冒烟等）；v8 覆盖率语句 43.21% / 分支 86.71%；CI 矩阵移除已 EOL 的 Node 20.x（保留 22.x / 24.x），`actions/upload-artifact` 升至 v7（Node 24 运行时）
* **Lint：**`manifest.json` 与 `LICENSE` 显式纳入 eslint（官方 recommended 配置不会自动拾取这两类文件；`validate-license` 所需的行级 parser 内置于 `scripts/plain-text-parser.mjs`）；`manifest.json` 描述文案微调以符合提交规范
* **文档：**新增代码质量审计报告与审计指南（`docs/`）

<h3>兼容性说明</h3>

* 与 0.0.1 一致：**需要 Obsidian 1.13.0+**（声明式设置 API），**仅桌面端**（`isDesktopOnly: true`）
* 视图状态与打开偏好仍存于插件 `data.json`（按文件路径），节点图片尺寸改存笔记本体的官方嵌入语法，不含敏感内容

<h3>已知限制</h3>

* 新增：图片独占节点（无文本）不参与节点文本搜索
* 其余沿用 0.0.1：每节点至多一条超链接；`![[笔记]]` 嵌入以 `[[链接]]` 形式承载不渲染嵌套内容；行内标记随文本原样保留，导图内不做富文本渲染

---

<h3 id="en-v0.0.2">New Features</h3>

* **Assisted drag reparenting**: the engine's native hit test requires the pointer to land exactly inside the target node's rectangle; now dropping near a **node's center** (a uniform circular zone, size-independent) attaches the node as its child, and dropping in a **sibling gap** inserts between the two neighbors. Candidates are arbitrated by pointer distance with live highlighting; release still goes through native engine commands (`MOVE_NODE_TO` / `INSERT_AFTER`), and the assist yields whenever the engine gets an exact hit
* **Node image resizing**: a handle appears at the hovered image's bottom-right corner; dragging resizes width with the aspect ratio preserved (width/height linked clamping). On release the size is written back in Obsidian's official embed sizing syntax — `![[img.png|300]]` width-only, `![[img.png|300x150]]` explicit width & height, `![alt|300](url)` external images sized at the label tail — persisted into the note body, not `data.json`
* **Image-exclusive nodes**: pure image lines (`- ![[x.png]]`) parse as textless nodes instead of falling back to a filename placeholder; after "Remove text" from the context menu (or clearing text by double-click) the node becomes image-exclusive and survives Markdown round-trips

<h3>Improvements</h3>

* **Performance:** vault file lookups on the save hot path now hit an index cache (previously a full file-list scan per image node per save, now O(1) with freshness maintained by vault events); drag-time `mousemove` is coalesced with `requestAnimationFrame`; image resizing skips full engine re-renders when the rounded size is unchanged
* **Performance:** the engine's zero-size canvas wait replaced 200 ms polling with an event-driven `ResizeObserver`; external image aspect probing runs under bounded concurrency (max 6), avoiding decode storms on oversized images
* **Disk writes:** settings changes are debounced into a single write (400 ms) instead of per-step rewrites while dragging sliders; the write payload no longer carries a full `viewState` snapshot (write-before-read merging keeps `viewState` intact)
* Vault file resolution is funneled through the single entry `resolvePathToFile` — remote rejection / `obsidian://` / app-resource URLs / plain paths / `file://` (official `getFirstLinkpathDest`) / index fallback are routed by form, with an eslint rule mechanically blocking bypasses

<h3>Bug Fixes</h3>

* Fixed the canvas context menu appearing empty on some nodes: the engine never writes node uids into the DOM, so the old `data-uid` lookup always resolved to `null`; matching now uses "target element contained by the node's rendered group", locked in by a vendor contract test

<h3>Other changes</h3>

* **Tests & CI:** regression tests grew from 75 to **252** (21 files, all green; new suites for engine-controller / event-binder / persistence / file-lookup / links-resolve / images-path / vendor contract smoke); v8 coverage: 43.21% statements / 86.71% branches; CI matrix drops the EOL Node 20.x (keeps 22.x / 24.x) and bumps `actions/upload-artifact` to v7 (Node 24 runtime)
* **Lint:** `manifest.json` and `LICENSE` are now explicitly linted (the official recommended config never picks them up; the line-level parser required by `validate-license` lives in `scripts/plain-text-parser.mjs`); the `manifest.json` description was reworded to satisfy submission guidelines
* **Docs:** added code-quality audit reports and the audit guide under `docs/`

<h3>Compatibility notes</h3>

* Unchanged from 0.0.1: **requires Obsidian 1.13.0+** (declarative settings API), **desktop only** (`isDesktopOnly: true`)
* View state and open-as preferences still live in the plugin `data.json` (keyed by file path); node image sizes now live in the note body as official embed syntax — no sensitive content either way

<h3>Known limitations</h3>

* New: image-exclusive nodes (no text) are not searchable via node text search
* Carried over from 0.0.1: one hyperlink per node; `![[note]]` embeds are carried as `[[links]]` without rendering nested content; inline marks are preserved as plain text — no rich-text rendering inside nodes
