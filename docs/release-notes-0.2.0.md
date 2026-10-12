[中文](#cn-v0.2.0) | [English](#en-v0.2.0)

0.2.0 是**导图身份与设置面的一轮收敛**：判据从文件名后缀（`.mindmap.md`）改为 frontmatter 声明（`类型: Mindmap` / `Type: Mindmap`），任意笔记都能一键开为导图；设置项由 12 项收敛为 9 项；新增 **SVG 导出**；并修复两处用户可见缺陷（编辑含图节点会把图片挪到行尾、星号粗体/斜体不能嵌套）。**含破坏性变更**：`.mindmap.md` 后缀退役，存量文件需一次性迁移（见下）。

<h3 id="cn-v0.2.0">⚠️ 升级须知（破坏性变更）</h3>

* **`.mindmap.md` 后缀退役，零兼容**：判据只看 frontmatter 的 `类型` / `Type` 是否为 `Mindmap`（两个键**都认**、大小写不敏感），**文件名不再参与判定**。存量 `.mindmap.md` 之后按普通 Markdown 打开，**内容零改动、不会损坏**。**迁移（二选一，逐文件即可）**：① 文件右键 → **「以思维导图打开」**——会自动把声明写进 frontmatter，此后双击即进导图视图；② 手动在文件头加 `类型: Mindmap`（英文库 `Type: Mindmap`）。批量迁移工具属后续版本
* **四项设置项被移除**（`data.json` 里的旧值会被忽略）：
  * **性能模式 / 性能模式阈值** → 收成内部常开（节点数 ≥ 500 时只绘制视野内节点）
  * **文本节点快速渲染** → 收成内部常开（含文字节点全部由插件渲染，双击走弹窗编辑）
  * **自动更新内部链接** → **跟随官方设置**（本插件不再另设开关；官方关掉后本插件也不改写，且不再重复提示，只留控制台痕迹）
  * **自动拆分混排双链** → 仍在，但**默认改为关**（拆分＝改写你的文件结构，须显式开启；存量 `data.json` 里已存 `true` 的保持开启）。整篇处理仍用命令「拆分文档内全部混排双链」
* **「拖拽换父辅助」移除**：拖到节点中心附近即挂为其子节点、拖到两兄弟之间即插入其间的**外扩识别域**不再有。**引擎原生拖拽照旧**（指针落在目标节点内＝挂为子节点，落在两兄弟之间＝插入其间）；同时退役的还有未文档化的 `Alt` 拖拽复制节点
* **「以 Markdown 打开」有持久副作用**：它不再是「打开方式」偏好，而是**持久降级**——把属性改写为 `Markdown`，此后不再自动进导图视图（文件右键 / 工具栏「切换回 Markdown」/ 命令三处同语义）。代价是**没有「临时看一眼源码再切回」的轻量入口**
* **切换界面语言会改写全库导图属性键**（`类型` ⇄ `Type`；只改键名、值不动、已是目标键的文件免写）——否则属性面板里会同时出现两把键

<h3>新增</h3>

* **由 frontmatter 声明触发**：在任意笔记写 `类型: Mindmap`（英文库 `Type: Mindmap`），它打开时自动进入导图视图（双击 / 链接 / 重启恢复均生效）；改回 `Markdown` 或删掉该属性就不再自动进导图。**不必改名、不必新建、不必转换格式**
* **任意笔记秒变导图**：「以思维导图打开」命令与文件右键对**任意 `.md`** 开放（右键项按声明互斥显示）——**首次打开会把声明写入 frontmatter**，打开一次即正式成为导图；已声明的文件不会被重写 YAML。临时开为导图的普通笔记**可编辑并回写**，但**不参与中心主题 ⇄ 文件名同步**（不会被静默改名）
* **状态只剩一份**：「是不是导图」由**文件自己的属性**承载，不再记在插件 `data.json`（布局 / 视口仍按文件记）；删掉声明不会把正在编辑的导图视图抽走
* **SVG 导出**：新增设置「**导出格式**」（PNG 位图 / SVG 矢量，默认 PNG）。**导出 SVG 为矢量、不受导出倍率影响**；命令与工具栏按钮随之由「导出 PNG」更名为「**导出图片**」（命令 ID 保持不变，快捷键/脚本不受影响）
* **新建导图不再有专用扩展名**：生成 `思维导图2026-10-12.md`，文件头带声明；命名时连 `.md` 一起输入也不会产生 `x.md.md`

<h3>修复</h3>

* **编辑含图节点不再把图片挪到行尾**：此前**任何**让节点进入「已编辑」态的操作（双击内联编辑、引擎编辑框、**拖动图片调宽**）都会把行内图片搬到行尾并凭空多出一个空格——`- 前后文：前 ![[图|200]] 后` 编辑后变成 `- 前后文：前 后改 ![[图|260]]`；一行两图更糟（首图被摘出原位）。根因是「首图与纯图标 URL 不向显示文本贡献任何字符」，合成侧靠显示名反查位置必然落空、只能尾插。现在这两类 token 也登记**上下文锚点**（左/右紧邻文字与空白形态），原位插入；锚点在新文本里不成立时**回落尾插**，不会塞错位置
* **星号粗体/斜体可以嵌套了**：`**外层 *内层* 尾**` 此前整段退化为字面（露出裸 `**`），而同样语法的 `**外层 _内层_ 尾**` 正常——因为星号分支的标记体把自己那个字符排除了。现星号版与下划线版语义对齐（内层斜体、`*斜 **粗** 尾*`），且仍不会越过下一对 `**` 乱配对
* **文档修正：自绘节点不产生引擎图标**（既有行为，本版只是把「逃生口」删掉）：含文字的节点由插件自绘，故**不再出现**指向文档时的文档页图标与附件回形针（URL 单独成节点时仍为图标形态、附件仍可点）。此前只有**关闭**「文本节点快速渲染」才能看到这些图标，该设置项已移除；标准文档与 README 中「双链指向文档 = 自绘文档页图标」的不实表述同步订正
* 引用更新读取官方设置时补齐退化面（官方设置项不存在 / 方法缺失 / 抛错时**读作开启**，不让升级后引用更新静默失效）；文件名含 `%` 的链接解析统一走同一套 URL 解码（失败按场景显式回落或跳过，不再各处各写一份 try/catch）；设置项取值非法时的回退/钳制会**汇总留痕**，不再静默改配置

<h3>工程</h3>

* **数学校准会话外置为 `features/content-remeasure.ts`**：此前只靠渲染契约间接覆盖的「定稿 → 尺寸同步」会话（同帧合批重排、按 holder 反查真实节点、渲染窗口失败只重试一次）**首次获得直测**（`view.ts` 1249 → 1086 行）
* **三处收口**：导出 SVG 的 `<style>` 注入原语（`platform/export-svg-style.ts`，此前 CSS 变量链与数学链各内联一份）；内部告警的幂等留痕（`core/errors.createWarnOnce`，前缀与去重范围由其统一保证）；URL 解码（`domain/url.tryDecodeUri`，此前散落在 7 处）
* **门禁修正**：`verify:visual` 的图标场景改用「空文本」形态（唯一可达通道），新增 `docnode` 场景**反向锁定**「自绘 + 无引擎图标」；场景探针改为**按子节点 group 定位**（否则会读到同样自绘的根节点）；`--bench-open` 场景不再传已删除的自绘开关
* 测试全量 **70 文件 / 1968 例**

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* **⚠ `styles.css` 有变化**：删除一条已随「拖拽换父辅助」一起退役的规则（`.mindmap-drag-target`）。该规则不再被任何元素引用，**旧 CSS 留着也不会产生可见问题**，但仍建议与 `main.js` 一并替换
* ⚠ **过期设置项会被静默忽略**：`performanceMode` / `performanceThreshold` / `selfDrawPlainNodes` / `autoUpdateLinks` 四个键不再被读取，可留在 `data.json` 里（无副作用）
* **已知取舍**：没有「临时看一眼源码再切回」的轻量入口（「以 Markdown 打开」是持久降级）；`.mindmap.md` → `命名.md` + 属性的一次性批量迁移工具尚未提供
* `.mindmap.md` 格式本身（frontmatter + 标题 + 列表）与命令 ID 均未变更，往返保真契约不变

---

<h3 id="en-v0.2.0">⚠️ Upgrade notes (breaking changes)</h3>

* **The `.mindmap.md` suffix is retired, with zero compatibility**: the trigger is now the frontmatter key `类型` / `Type` set to `Mindmap` (both keys are recognized, case-insensitive) and **the file name no longer takes part in the decision**. Existing `.mindmap.md` files open as ordinary Markdown afterwards — **their content is untouched and nothing is corrupted**. **Migration (either way, one file at a time)**: ① right-click the file → **"Open as mind map"**, which writes the declaration into the frontmatter so that double-clicking enters the mind map from then on; ② add `类型: Mindmap` (or `Type: Mindmap` in English vaults) to the file header. A bulk migration tool is planned for a later release
* **Four settings are gone** (old values in `data.json` are ignored): **Performance mode / threshold** → always on internally (only nodes in view are drawn once the map has 500+ nodes); **Fast text node rendering** → always on internally (every text-bearing node is rendered by the plugin, double-click opens the edit dialog); **Automatically update internal links** → now **follows the official setting** (no separate switch, no duplicate notice — only a console trace); **Auto-split mixed links** → still present but now **off by default** (splitting rewrites your file structure, so it must be enabled explicitly; an existing `true` in `data.json` stays on). Whole-file processing still uses the "Split all mixed links in document" command
* **"Drag-to-reparent assist" removed**: the enlarged drop zone (drop near a node's centre to reparent, between two siblings to insert) is gone. **Native engine dragging is unchanged** (pointer inside the target node reparents, between two siblings inserts); the undocumented `Alt`-drag node duplication is retired with it
* **"Open as Markdown" now has a lasting side effect**: it is no longer an "open as" preference but a **permanent downgrade** — it rewrites the property to `Markdown`, after which the file never auto-opens as a mind map again (the file context menu, the toolbar "Switch back to Markdown" and the command all share this meaning). The cost is that there is **no lightweight "peek at the source and switch back" entry point**
* **Switching the UI language rewrites mind-map property keys vault-wide** (`类型` ⇄ `Type`; only the key name changes, values stay, files already using the target key are skipped) — otherwise both keys would show up in the property panel

<h3>Added</h3>

* **Triggered by a frontmatter declaration**: write `类型: Mindmap` (`Type: Mindmap` in English vaults) in any note and it opens as a mind map (double-click, links and restarts all work); change it back to `Markdown` — or remove the property — and it stops auto-opening. **No renaming, no new file, no format conversion**
* **Any note becomes a mind map in one action**: the "Open as mind map" command and file context menu are available for **any `.md`** (the menu item is shown exclusively per declaration). **The first such open writes the declaration into the frontmatter**, so opening once makes the note a mind map; files already declaring it are never re-serialized. A note opened this way **can be edited and written back**, but **does not participate in the central-node ⇄ file-name sync** (it is never silently renamed)
* **A single source of truth**: "is this a mind map?" lives in the **file's own property** and is no longer recorded in the plugin's `data.json` (layout and viewport are still stored per file); removing the declaration does not yank a mind map view out from under you
* **SVG export**: new **"Export format"** setting (PNG raster / SVG vector, default PNG). **SVG output is vector and unaffected by the export scale**; the command and toolbar button are renamed from "Export as PNG" to "**Export image**" (the command ID is unchanged, so hotkeys and scripts keep working)
* **New mind maps no longer use a dedicated extension**: they are created as `MindMap2026-10-12.md` with the declaration in the header; typing `.md` yourself no longer produces `x.md.md`

<h3>Fixed</h3>

* **Editing an image-bearing node no longer moves the image to the end of the line**: any action that put a node into its "edited" state (inline double-click editing, the engine's edit box, **dragging the image resize handle**) used to relocate the inline image to the end of the line and add a stray space — `- text: before ![[img|200]] after` became `- text: before after ![[img|260]]`, and with two images on one line the first was pulled out of position. The root cause was that the first image and icon-only URLs contribute **no characters** to the displayed text, so the composer's lookup by display name could never match and fell back to appending. Both token kinds now record **context anchors** (the immediately adjacent text runs and whether whitespace separated them) and are inserted in place; when the anchors no longer hold in the new text the composer falls back to appending rather than inserting in the wrong spot
* **Asterisk bold/italic can nest now**: `**outer *inner* end**` used to degrade to literal text (showing bare `**`), while the same syntax with `_inner_` rendered fine — the asterisk branch excluded its own delimiter from the marker body. Both flavours now behave the same (inner italics, `*ital **bold** end*`), and bold still refuses to run past the next `**` pair
* **Docs correction: self-drawn nodes produce no engine icons** (pre-existing behavior; this release only removes the escape hatch): nodes containing text are drawn by the plugin, so the **document-page icon and the paperclip are not shown** for links to documents/attachments (a URL alone on a node still uses the icon form, and attachments remain clickable). Previously these icons were only visible with **Fast text node rendering turned off**, a setting that no longer exists; the standard document and README claim "a link to a document = self-drawn document-page icon" has been corrected
* Reference updates now read the official setting with its degradation paths covered (missing key / missing method / throwing method all read as **enabled**, so link updates never silently stop after an upgrade); links whose file names contain `%` all go through one URL-decoding helper (failures fall back or skip explicitly per call site instead of eight hand-written try/catch blocks); invalid settings values that get reverted or clamped are now **summarized in the console** rather than silently rewritten

<h3>Engineering</h3>

* **The math recalibration session moved to `features/content-remeasure.ts`**: the "finalize → size sync" session (same-frame batched re-layout, resolving real nodes by holder, one retry inside the render window) is now **covered by direct unit tests** for the first time (`view.ts` 1249 → 1086 lines)
* **Three consolidations**: the export-SVG `<style>` injection primitive (`platform/export-svg-style.ts`, previously inlined once in the CSS-variable chain and once in the math chain); idempotent internal warnings (`core/errors.createWarnOnce`, which now owns both the prefix and the dedup scope); URL decoding (`domain/url.tryDecodeUri`, previously scattered across 8 sites)
* **Gate fixes**: `verify:visual` icon scenarios now use the empty-text form (the only reachable channel), a new `docnode` scenario **locks in** "self-drawn + no engine icon", scenario probes locate nodes **by child group** (otherwise the equally self-drawn root node is matched first), and the `--bench-open` scenario no longer passes the removed self-draw flag
* Full test suite: **70 files / 1968 cases**

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* ⚠ **`styles.css` changed**: one rule tied to the removed drag-to-reparent assist was deleted (`.mindmap-drag-target`). Nothing references it any more, so **leaving the old CSS in place causes no visible problem**, but replacing it together with `main.js` is still recommended
* ⚠ **Stale settings keys are ignored silently**: `performanceMode` / `performanceThreshold` / `selfDrawPlainNodes` / `autoUpdateLinks` are no longer read and may stay in `data.json` (harmless)
* **Known trade-offs**: no lightweight "peek at the source and switch back" entry point ("Open as Markdown" is a permanent downgrade); a one-time bulk migration from `.mindmap.md` to `name.md` + declaration is not provided yet
* The `.mindmap.md` format itself (frontmatter + headings + lists) and all command IDs are unchanged, as is the lossless round-trip contract
