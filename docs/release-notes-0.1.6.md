[中文](#cn-v0.1.6) | [English](#en-v0.1.6)

0.1.6 是一次**保真与性能**版本：修复「拖入文件后节点不显示为链接」「文件重命名后节点仍指向旧目标」「附件嵌入编辑后出现重复文本」「md 尖括号路径往返漂移」四类缺陷；同时完成一轮量化驱动的性能收紧——图片拖宽不再逐帧整树重排（大图拖动卡顿消除）、行内解析入口短路（病态长行秒级阻塞消除）、「适应画布」在快速渲染模式下不再全树装配、段缓存内存封顶。无破坏性变更（`.mindmap.md` 格式、命令 ID 与设置项均未变）。

<h3 id="cn-v0.1.6">修复</h3>

* **拖入文件后节点不显示为链接**：从文件浏览器拖入库内文档 / 附件创建的节点此前没有超链接样式、点击无效（须重开文件才恢复）——新建节点现即时补齐行级元数据（`mdRaw`/`mdDerivedText`），拖入、粘贴、新建链接节点一次到位，保存逐字回写
* **文件重命名后节点仍指向旧目标**：重命名被引用的文档或附件后，节点上屏的链接锚点保持旧目标直到重开文件——现在字段与渲染源一并更新（同一扫描器 + 同一改写规则），重命名即刻生效
* **附件嵌入节点编辑后保存出现重复文本**：`![[附件.pdf]]` 节点被改写为「文本 + 附件嵌入」时，保存会写出多余的目标名（如 `测试附件.pdf ![[测试附件.pdf]]`）；已修
* **「移除引用」后的残留字段**：覆盖写入分支的链接类字段清理统一收口——回写不再凭空多出旧引用
* **md 链接 / 图片的尖括号目标（含空格路径）**：`[名](<路径 带空格>)`、`![](<路径 带空格>)` 未编辑时此前被误判「需合成」而尾插漂移；现按 token 判定逐字回写（带自定义尺寸、尺寸未变的 md 图片同样不再漂移）
* **图片引用的等价形态**：子文件夹图片的裸名引用（加载期已转资源地址）解析等价视为未编辑、逐字回写；换图后新图不再被旧原文覆盖；图片重命名后按新路径合成

<h3>性能</h3>

* **图片拖宽不再卡顿（大图尤为明显）**：帧内直写渲染中 `<image>` 宽度，不再逐帧走引擎命令与整树重排；收尾一次提交——一条撤销历史、一次保存调度，一次 `Ctrl+Z` 撤回整次拖动；拖回原尺寸不写入
* **病态长行解析提速**：行内 token 解析入口短路（此前「大量 `[` 起点但无闭合」的长行单行最坏 O(n²)，可秒级阻塞打开 / 保存）——实测 21000 字符病态行 0.13ms、20000 字符 / 2000 token 密集行 0.37ms
* **「适应画布」不再阻塞一段**：快速渲染模式下改为按数据层几何计算（不再全树同步装配；5000 节点口径下该步约 1.1s）
* **保存视口幂等短路**：重启视图时已在保存视口上则零调用，消除二次整树渲染
* **长行节点内存封顶**：自绘段缓存加字符预算（条目上限对长行键失效，最坏约 20MB 常驻 → 1M 字符总预算）
* **其它**：节点内容构建选项改为实例级复用（5000 节点此前约 2 万临时闭包）；序列化的「跟随列表」判定按层惰性（同层 O(k²) → O(k)）；引擎重建少一次全树深拷贝

<h3>工程</h3>

* 测试全量 **58 文件 / 1765 例**（0.1.5 为 57 / 1739）；`verify:visual` 的 history 探针改为 DOM 直写口径、perf-box 探针扩「适应画布」断言
* 移除 4 个过期设计文档（代码块方案与引擎补丁提案，结论已沉淀入库）；`.gitignore` 排除 vitest 失败快照

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`.mindmap.md` 格式、命令 ID 与设置项均未变更——纯修复 / 性能版本，无需迁移
* 本轮 `styles.css` 无变化，更新 `main.js` 即可

---

<h3 id="en-v0.1.6">Fixed</h3>

* **Dropped files no longer render as plain text**: nodes created by dragging a vault document/attachment onto the canvas had no hyperlink styling and were unclickable until the file was reopened — new nodes now get their line-level metadata (`mdRaw`/`mdDerivedText`) immediately (drag-in, paste and new link nodes alike), so anchors render at once and saves write back verbatim
* **Renaming a referenced file now updates the node instantly**: after renaming a referenced document or attachment, the on-screen anchor kept pointing at the old target until reopen — the field layer and the rendering source are now updated together (same scanner, same rewrite rules)
* **No more duplicated text after editing an embedded attachment**: rewriting a `![[file.pdf]]` node into "text + embedded attachment" could save an extra copy of the target name (e.g. `file.pdf ![[file.pdf]]`) — fixed
* **Leftover fields after "Remove link"**: link-channel cleanup in overwrite branches is now a single shared sweep — saves no longer resurrect stale references
* **Angle-bracketed targets in md links/images (paths with spaces)**: unedited `[name](<path with spaces>)` / `![](<path with spaces>)` lines were misjudged as "needs compose" and drifted on save; now matched by token and written back verbatim (same for md images with unchanged custom sizes)
* **Equivalent forms of image references**: bare-name references in subfolders (resolved to resource paths at load) count as unedited and round-trip verbatim; after replacing an image the new one is no longer overwritten by the old raw line; after renaming an image the new path is composed

<h3>Performance</h3>

* **Image width dragging no longer stutters (large maps especially)**: each frame writes the rendered `<image>` width directly instead of running an engine command and a full-tree re-layout; a single commit at the end yields one undo entry, one save schedule, and one `Ctrl+Z` reverts the whole drag; dragging back to the original size writes nothing
* **Pathological long lines**: an entry short-circuit in inline token parsing (previously a worst case of O(n²) per line could block open/save for seconds) — measured 0.13 ms for a 21,000-char pathological line and 0.37 ms for a 20,000-char line with 2,000 tokens
* **"Fit to canvas" no longer blocks**: in fast-rendering mode it now computes from layout geometry instead of synchronously materialising the whole tree (~1.1 s at 5,000 nodes)
* **Idempotent viewport restore**: zero calls when the saved viewport is already applied, eliminating a second full-tree render
* **Memory cap for long-line nodes**: the self-drawn segment cache gained a character budget (its entry cap was ineffective for long keys — worst case ~20 MB resident — now capped at 1M chars in total)
* **Also**: node-content options are now instantiated once per view (previously ~20k temporary closures at 5,000 nodes); the serializer's "follow list" check is computed lazily per level (O(k²) → O(k)); one redundant full-tree clone removed from engine rebuilds

<h3>Engineering</h3>

* Full suite: **58 files / 1765 cases** (0.1.5: 57/1739); the `verify:visual` history probe now follows the DOM-write channel and the perf-box probe gained "fit to canvas" assertions
* Removed 4 stale design documents (code-block plans and an engine patch proposal — conclusions already live in the code); `.gitignore` now excludes vitest failure snapshots

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; the `.mindmap.md` format, command IDs and settings are unchanged — a fix/performance release with no migration needed
* `styles.css` is unchanged in this release; updating `main.js` is enough
