[中文](#cn-v0.1.3) | [English](#en-v0.1.3)

0.1.3 是一次**性能与验证基建**版本：修复「多节点导图打开时卡顿严重、加载很久」（打开时的默认视口居中不再把整棵树临时装配进 DOM），并收敛三处重复付出的高频成本（打开含图笔记不再为解析一个图片地址构建全库索引、文件重命名/删除的引用预检与拖拽落点识别的每帧/整树开销下降）。同时把 `verify:visual` 的四个固定延时型探针改为「渲染事件 + 轮询」的就绪判定，消除负载机器上的探针假失败。无破坏性变更（`.mindmap.md` 格式、命令 ID、设置项均未变；最低支持版本仍为 Obsidian 1.13.0）。

<h3 id="cn-v0.1.3">性能</h3>

* **打开大图不再为「整体居中」把整棵树临时装配进 DOM**（用户实测反馈「多节点打开卡顿严重、加载很久」）：性能模式下视口外节点会被引擎回收出 DOM，而打开时的「100% + 整体内容居中」需要**全图包围盒**——旧实现先把整棵树**同步**装配进 DOM 再测量，且该动作在打开窗口内被重复触发多轮（首帧渲染结束、其自身事件重入、150ms 兜底、图片尺寸回灌后的补居中），节点越多每轮越重。现改为**直接遍历渲染树的布局几何求包围盒**（与引擎裁剪判定同源，零 DOM 装配、纯计算），并在「比例已是 100% 且内容已居中」时**整体跳过**（不再触发多余重绘）——「适应画布」仍是引擎的全量通道，行为不变
* **解析一个图片地址不再构建全库索引**：打开含图笔记时，首个 `app://…` 地址的解析此前会在惰性索引未建时**同步构建全库索引**（10 万文件库实测 300ms+ 的同步阻塞）；现优先「从地址提取路径 → 直查文件 → 校验地址全等」（实测 ~2µs），未命中才回退索引——历史形态的兜底行为不变
* **库事件与高频查询的成本收敛**：`create` 事件由「整体失效 + 下次全量重建」改为**增量补建**（批量导入 / 外部同步风暴期不再反复付全库成本）；索引未命中自愈的数量比对加**时间窗节流**；同名冲突查询走共享索引计数（新建文档链接不再逐次全库扫描）；拖拽辅助线每帧不再为全树节点分配临时坐标对象（先做平方距离预筛）；文件重命名 / 删除的引用预检不再为每个节点拼接比对串（2000 节点实测 0.68ms → 0.51ms，「空 needle」也不再恒命中）；纯文本行的解析少一次数组分配

<h3>工程</h3>

* **测试**：全量 **48 文件 / 1567 例**（三轮新增 / 改写覆盖索引增量与校验节流、资源地址直解与异常兜底、引用预检零拷贝、拖拽几何一致性、数据层包围盒与幂等短路等契约）；`npm run verify:visual` 现有 **16 个断言探针**（新增 perf-box：大图居中不装配全量 DOM + 数据层盒与 DOM 盒口径一致）
* **验证基建加固**：`verify:visual` 的四个固定延时型探针（perf / image / count / layout）改为「`node_tree_render_end` 事件 + 轮询」的就绪判定（读 DOM 结构 / 计数的探针用严格模式），并修复构建器计数器被邻图渲染污染的问题——负载机器上的稳定假失败（探针读到 `renderer.root` 为 null 的中间态）就此消除

<h3>兼容性说明</h3>

* 与 0.1.2 一致：**需要 Obsidian 1.13.0+**，**仅桌面端**（`isDesktopOnly: true`）
* `.mindmap.md` 格式、既有命令 ID、设置项与快捷键均未变更；本版为纯性能 / 稳定性改动，无需任何迁移

---

<h3 id="en-v0.1.3">Performance</h3>

* **Opening a large map no longer attaches the whole tree to the DOM just to centre it** (user feedback: "opening a multi-node map stutters badly and takes a long time"): in performance mode off-viewport nodes are reclaimed out of the DOM, while the opening "100% + centre all content" needs the **full-map bounding box** — the old implementation first attached the entire tree to the DOM **synchronously** to measure it, and that step was repeated several times during the opening window (first frame, its own event re-entry, the 150 ms fallback, and the re-centring after image-size corrections); the more nodes, the heavier each round. The box is now computed **directly from the render tree's layout geometry** (the same source the engine's culling check uses — zero DOM attachment, pure computation), and the whole step is **skipped** when the view is already at "100% and centred" (no redundant redraw triggers). "Fit canvas" still uses the engine's full-load path, unchanged
* **Resolving one image address no longer builds the whole-vault index**: opening a note with images used to synchronously build the lazy whole-vault index for the first `app://…` address (measured 300 ms+ on a 100k-file vault); it now tries "extract the path → look the file up → verify the address matches" first (~2 µs) and falls back to the index only on a miss — historical-format fallback behaviour is unchanged
* **Lower cost for vault events and hot lookups**: `create` events now **incrementally** add their entries instead of invalidating the whole index (bulk imports / external sync no longer pay the full-vault cost over and over); the self-healing count comparison on an index miss is throttled by a time window; the same-name conflict check reads shared index counts (creating a document link no longer scans the whole vault per call); drag guides no longer allocate a temporary coordinate object per node per frame (squared-distance pre-filter first); rename / delete reference pre-checks no longer concatenate a comparison string per node (2000 nodes: 0.68 ms → 0.51 ms, and an empty needle no longer matches everything); plain-text Markdown lines skip one array allocation

<h3>Engineering</h3>

* **Tests**: the full suite is **48 files / 1567 cases** (new / rewritten across the rounds: index increment and validation throttling, resource-address direct resolution and exception paths, zero-copy reference pre-checks, drag geometry parity, the data-layer bounding box and idempotent centring); `verify:visual` now has **16 assertion probes** (the new perf-box probe: centring a large map attaches no whole-tree DOM, and the data-layer box matches the DOM box)
* **Verification hardening**: the four fixed-delay probes (perf / image / count / layout) now use an "engine render event + polling" readiness check (strict mode for probes that read DOM structure or counts), and the builder counter is no longer installed on the shared options object (neighbouring maps' first frames used to leak calls into its idle-render window) — the stable false failures on loaded machines (probes reading `renderer.root` while it was still null) are gone

<h3>Compatibility notes</h3>

* Unchanged from 0.1.2: **requires Obsidian 1.13.0+**, **desktop only** (`isDesktopOnly: true`)
* No changes to the `.mindmap.md` format, command IDs, settings or hotkeys; this release is performance / stability-only and needs no migration
