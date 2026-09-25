[中文](#cn-v0.1.4) | [English](#en-v0.1.4)

0.1.4 是一次**性能**版本：对「打开大图」与「编辑流畅度」两条主路径做系统性提速——所有含文字的节点改由插件自绘渲染，跳过引擎成本为「0.13ms/字符」的逐字符文本测宽（含长文本的大图打开从数十秒降到秒级）；打开过程改为分片渲染，界面全程不冻结；另以五处引擎自有补丁收敛编辑与渲染帧成本（一次编辑 47.6 → 5.3ms、空渲染落地 28.1 → 3.0ms）。同时向内收敛两项工程基建：引擎补丁体系（vendored 源入仓 + 可复现重打包）与社区目录校验对照。无破坏性变更（`.mindmap.md` 格式、命令 ID 均未变），新增一个默认开启的设置项。

<h3 id="cn-v0.1.4">性能</h3>

* **所有含文字的节点改用自绘渲染（新设置「文本节点快速渲染」，默认开启）**：打开大图的成本主体是引擎的逐字符文本测宽（每字符一次离屏测量，0.13ms/字符），字符越多越慢——含长文本段落的大图尤其显著。现改为**全部含文字节点由插件自绘**（跳过测宽，尺寸走内容寻址缓存），实测 5000 节点：**含长文本节点约 59 秒 → 约 1.4 秒**，纯短文本 8.6 秒 → 约 1.4 秒。边界：空文本 / 含图 / 整行注释等节点不接管；**双击节点改为打开编辑弹窗**（引擎内联编辑框对自绘节点不可用）；该设置**仅对之后打开的文件生效**（切换时不重建当前大图，避免卡顿）；关闭即恢复引擎原生文本渲染与原位编辑
* **打开大图时界面不再冻结**：整树渲染改为**分片执行**（每个节点一个宏任务，浏览器可在其间响应输入与绘制），主线程单块阻塞从约 1.1 秒降到每块约 0.2 毫秒——打开全程可交互；总时长代价经同批对照仅约 +2.4%（5000 节点 1137 → 1164ms）
* **打开成本的三处继续收敛（5000 节点实测）**：① 拖宽手柄的全局监听器由「每个节点 3 个」改为**拖拽会话内惰性注册**（15000 → 0，打开 **-13%**；同时修复「节点销毁后监听器永久持有」的内存泄漏）；② 布局的兄弟子树平移消除二次复杂度（实测 293 万次节点位移 → O(n)，打开 **-6%**）；③ 自绘尺寸按内容寻址缓存 + 首帧前预测量（一遍内容构建、重复打开与首次打开都免重复测宽）
* **编辑与渲染帧成本（500 节点实测）**：**一次编辑 47.6 → 5.3ms（-89%）**、**空渲染落地 28.1 → 3.0ms（-89%）**——三处引擎修复：兄弟节点查找 O(n) → O(1)（原先每节点每轮把全部兄弟拷进新数组线性查找）、数据快照比较去掉 JSON 序列化、SVG 属性同值写短路（不再触发无谓的样式重算与重绘）

<h3>工程</h3>

* **引擎自有补丁体系**：fix.3 引擎源码入仓（`vendor/upstream/`）＋ 9 处自有补丁（`vendor/patches/` 与 upstream 内），经 `npm run build:vendor` **可复现重打包**，产物 sha256 由契约测试钉住——升级与审计链路完全可查（清单见 `vendor/BUILD.md`）
* **测试**：全量 **49 文件 / 1578 例**；`npm run verify:visual` 现有 **26+ 断言探针**，并新增三组 opt-in 测量通道（打开基准 `--bench-open`、编辑帧分解 `--perf --perf-ops`、布局计数 `--bench-open` + `BENCH_VARIANT=count-layout`）——本版全部性能数据均由这些通道的真实墙钟差分测得
* **社区目录校验对照**：新增 `npm run lint:scanner`（用社区目录 scanner 的**固定版本依赖集**与官方规则面本地预检），接入 CI 与发布门禁；scanner 工作流、官方模板、开发者指南三条对照线均 0 缺口

<h3>设置与交互变化</h3>

* 新增设置「**文本节点快速渲染**」（默认开启，可关闭）——见上方性能段；变更仅对之后打开的文件生效
* 自绘节点的文本编辑统一走**编辑弹窗**（双击 / 右键「编辑文本」/ F2），宽度拖拽手柄只在自绘节点上显示

<h3>兼容性说明</h3>

* 与 0.1.3 一致：**需要 Obsidian 1.13.0+**，**仅桌面端**（`isDesktopOnly: true`）
* `.mindmap.md` 格式、既有命令 ID、快捷键与其余设置项均未变更；本版为纯性能 / 稳定性改动，无需任何迁移

---

<h3 id="en-v0.1.4">Performance</h3>

* **All text-bearing nodes are now rendered by the plugin (new setting "Fast text node rendering", on by default)**: the dominant cost of opening a large map was the engine's per-character text measurement (one off-screen measurement per character, 0.13 ms/char) — the more text, the slower the open, with long paragraphs being the worst case. Every text-bearing node is now drawn by the plugin (measurement skipped; sizes come from a content-addressed cache). Measured with 5,000 nodes: **a map with long-text nodes went from ~59 s to ~1.4 s**; short-text-only from 8.6 s to ~1.4 s. Boundaries: empty-text / image-bearing / fully-commented nodes are not taken over; **double-clicking a node now opens the edit dialog** (the engine's inline editor does not work on self-drawn nodes); the setting **applies to maps opened afterwards** (switching it does not rebuild the current large map, avoiding a stutter); turning it off restores the engine's native text rendering and inline editing
* **The UI no longer freezes while a large map opens**: full-tree rendering is now **sliced** (one macrotask per node, so the browser can respond to input and paint in between) — the worst single main-thread block drops from ~1.1 s to ~0.2 ms per slice, so the app stays responsive throughout the open; the total-time cost measured in a same-batch comparison is only about +2.4% (5,000 nodes: 1137 → 1164 ms)
* **Three further reductions in open cost (measured with 5,000 nodes)**: ① the width-handle global listeners went from "3 per node" to **lazy registration inside a drag session** (15,000 → 0; **-13%** open time; also fixes a memory leak where destroyed nodes were kept alive by window listeners); ② the layout's sibling-subtree shifting lost its quadratic complexity (2.93M node moves → O(n); **-6%** open time); ③ self-drawn sizes are cached by content and pre-measured before the first frame (one content build only; no repeated measurement on first or repeat opens)
* **Edit and render frame cost (measured with 500 nodes)**: **one edit 47.6 → 5.3 ms (-89%)**, **an empty render pass 28.1 → 3.0 ms (-89%)** — three engine fixes: sibling lookup O(n) → O(1) (previously copying all siblings into a new array for a linear scan on every node every pass), data-snapshot comparison without JSON serialization, and same-value SVG attribute writes are short-circuited (no more pointless style recalculation and repaint)

<h3>Engineering</h3>

* **A first-party engine patch system**: the fix.3 engine source is vendored (`vendor/upstream/`) with 9 in-house patches (`vendor/patches/` plus in-tree ones), rebuilt reproducibly via `npm run build:vendor`, with the artifact sha256 pinned by a contract test — upgrade and audit trails are fully inspectable (see `vendor/BUILD.md`)
* **Tests**: the full suite is **49 files / 1578 cases**; `npm run verify:visual` now has **26+ assertion probes**, plus three opt-in measurement channels (open benchmark `--bench-open`, edit-frame breakdown `--perf --perf-ops`, layout counters via `BENCH_VARIANT=count-layout`) — every performance figure in this release was measured through these real-wall-clock channels
* **Community-catalog parity checks**: new `npm run lint:scanner` runs the community catalog scanner's **pinned dependency set** and rule set locally, wired into CI and the release gate; the scanner-workflow, sample-plugin and developer-guideline audits all found zero gaps

<h3>Settings and interaction changes</h3>

* New setting "**Fast text node rendering**" (on by default, can be turned off) — see Performance above; the change applies to maps opened afterwards
* Text editing on self-drawn nodes goes through the **edit dialog** (double-click / context menu "Edit text" / F2); the width-drag handles appear only on self-drawn nodes

<h3>Compatibility notes</h3>

* Unchanged from 0.1.3: **requires Obsidian 1.13.0+**, **desktop only** (`isDesktopOnly: true`)
* No changes to the `.mindmap.md` format, existing command IDs, hotkeys or other settings; this release is performance / stability-only and needs no migration
