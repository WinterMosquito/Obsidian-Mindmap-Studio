[中文](#cn-v0.3.0) | [English](#en-v0.3.0)

0.3.0 增加「联系」：在导图上画出**有向**的关系连线，而文件仍是 100% 标准 Markdown——`%%id:xxxxxx%%` 给被指向的节点发一个文件内身份，`%%rel:xxxxxx | 标签 | geo=… | color=…%%` 在源节点上声明一条指向它的边。走法不靠算法猜：选完目标后由你在画布上点放起点与终点两个手柄，曲线怎么绕由你定；拖动端点或控制点的那一刻，几何就写回正文（只存相对量，换布局、移动节点仍然成立）。线可以配色、可以改标签、可以右键删除——改完的文件用任何编辑器打开，仍然只是一段列表和几行注释。

<h3 id="cn-v0.3.0">新增</h3>

* **联系（关系连线）**：右键节点 →「联系」→ 点目标节点 → 依次点放起点与终点手柄
  * 导出的线**恒有箭头**（引擎 `drawLine` 在终点画箭头），方向就是「谁指向谁」
  * 整条建边流程合成**一次提交、一条撤销**：写 `%%rel%%` + 给目标**懒加** `%%id%%`（只有被指向的节点才需要 id）
  * 端点落在节点的哪条边（`dir`）与偏移（`range`）由指针射线投射决定，指针位置即控制点
  * **为什么不是自动选路**：引擎按八象限选点 + 默认控制点算法，上下相邻而横向略错位的节点会选「右→上」，实机采样一条边的 21 个点里有 11 个落在源节点框内。走法既然要好读，就由人说了算
  * 出口三个：点画布空白、`Esc`、换文件（会话随引擎重建回滚，落定前不产生任何文件改动）
* **拖动即保存**：拖端点或控制点后 200ms 防抖写回 `geo=`——8 个数依次是 起端 `dir,range` → 末端 `dir,range` → 控制点1 `dx,dy` → 控制点2 `dx,dy`
  * 只存**相对量**：换布局、拖节点、缩放都不用重算；没拖过的边不写 `geo=`，交给引擎默认曲线
* **线色**：右键线 →「联系配色」（跟随主题 / 与节点配色同一套色族 / 自定义…），写 `color=#rrggbb`
  * 同一个「薄荷」在节点上与在连线上是同一个 hex——一支子树和它的出边看起来才像一家
  * 宽度、虚线、标签字号仍只由主题表达（线色是唯一的按边覆盖项）
* **标签**：右键线 →「编辑联系标签」；禁 `%%` 与 `[[ ]]`（前者会撕碎指令行，后者会被当成链接）
* **删线两个入口**：右键线本身；或点线激活后 `Delete` / `Backspace`
  * 删线摘掉源节点那一条 ref；**该 id 已无任何入边时**，目标那一行 `%%id%%` 一并回收（两行合成一次提交、一次撤销），不留画布上看不见的注释
* **只读嵌入照常画线**：`mindmap` 围栏块里也看得见关系，且不抢宿主的按键与手势

<h3>变更</h3>

* **连线沉到节点下方**（`associativeLineIsAlwaysAboveNode = false`）：两点贝塞尔不做避让，画在上层必然横穿中间列的文字
* **观感压轻**：同主题线色的 1.5px 虚线；标签 12px + 画布底色描边光晕（压在任何元素上都读得出）
* **标签不叠字**：位置从「路径 50%」改到 `min(0.75, 0.35 + 0.12 × 同源边序号)`，并移到独立顶层图层（随重绘重建，不随线沉底一起被遮住）
* **没有 `geo=` 的边**（例如你手写的 `%%rel%%`）：控制点沿**锚点外法线**伸出 `clamp(距离/4, 20, 40)`，曲线恒先离开节点再弯向目标——原式跨度越大鼓包越大，实机同图里「贴边小半圆」与「甩到天边的弹簧」并存
* **菜单结构**：布局 / 配色（整篇与节点）/ 联系配色统一走级联子菜单（同一个实现）；「联系」是节点菜单里**独立一组的直落条目**——它是结构编辑，不与外观两项同组
* **边数上限 500**（文档序截断，只影响画多少条；`ids` 索引与悬空 / 自环判定不受影响）

<h3>修复</h3>

* **拖完的几何不会被自动值盖掉**：回写只补 `geo=`，边的集合、标签、顺序一律以正文为准（引擎在渲染时也会改写那两个数组，不设闸门会把自动值也写进文件）
* **正文里刚删掉的边不会在下一轮同步里复活**
* **几何按目标认领**：删掉一条边或插入一条新边后，旧的走法不会错配到另一条边上——错配会经回写把错误的 `geo=` 写进文件
* **稳态不再每帧重画线条**：原先「文件里没写 `geo=`」这一档每轮同步都判成有变化，等于每次渲染都顺手清掉线的激活态
* **空内容节点**（空标题 / 空列表项）：指令严格独占末行，不再变成节点正文显示出来
* **中途关视图**不再泄漏点选会话（会话挂的是原生 `window` 监听，不经引擎事件表）

<h3>工程</h3>

* 分层：`domain/relation`（语法判定 / 剥离 / 改写 / 树级图）、`domain/relation-anchor`（锚定几何）、`engine/mindmap-relations`（防腐面）、`features/view-node-relation` + `features/view-relation-anchor`（交互）、`ui/menu-submenu`（级联子菜单唯一实现）、`ui/modal-relation-label`
* vendor 三个补丁：13 只读态不绑交互事件；14 标签光晕与独立图层；15 默认控制点沿锚点外法线
* 语法写进 `docs/markdown-mindmap-standard.md`（`id` / `rel` / `geo` / `color` 四段的读写规范），行为口径写进 `AGENTS.md` 决策表与 `docs/agents/conventions.md`（K153 / K154）
* 测试：新增 `relation-directive` / `relation-anchor` / `engine-relations` / `view-node-relation` 四个文件；全量 **99 文件 / 2665 例**；门禁 `build` / `test` / `lint` / `lint:css` / `check:release` 均通过

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖；**`styles.css` 无变化**（替换 `main.js` 即可，`manifest.json` 请一并更新）
* **没有联系指令的文件完全不受影响**：打开、编辑、保存都不产生新行——`%%id%%` 只在你**新建联系**时懒加
* **没有新增命令、没有新增设置键**：命令 ID 与 `data.json` 结构不变；联系只有右键入口（节点 / 线），不占用快捷键
* **已知边界**：中心主题不能作端点（虚拟节点没有正文行）；自环忽略；重复 id 按文档序首个生效；跨文件联系不支持；目标 id 不存在的悬空边不画线但**原样保留**（那行没被编辑，静默清理会破坏逐字保真）
* **回滚到 0.2.9 及更早**：`%%id%%` / `%%rel%%` 行会被当成普通段落节点，注释语法照旧隐藏 ⇒ 显示为空节点。**文件不会被改写**，重新升级即恢复；要彻底清理，删掉以 `%%id:` / `%%rel:` 开头的整行即可

---

0.3.0 adds **relationships**: directed connector lines between nodes, while the file stays 100% standard Markdown — `%%id:xxxxxx%%` gives the target node a file-local identity, and `%%rel:xxxxxx | label | geo=… | color=…%%` declares a directed edge on the source node. The route is not guessed by an algorithm: after picking the target you place a start and an end handle on the canvas, so the curve goes where you say; the geometry is written back the moment you let go of a handle (relative values only, so moving nodes or switching layouts keeps working). Lines can be coloured, labelled and deleted from their own context menu — and the file still opens in any editor as a plain list plus a few comment lines.

<h3 id="en-v0.3.0">Added</h3>

* **Relationships**: right-click a node → "Relationship" → click the target node → place the start handle, then the end handle
  * Every drawn line **has an arrowhead** (the engine draws it at the endpoint), so the direction is "who points at whom"
  * The whole flow lands as **one commit and one undo step**: write `%%rel%%` and **lazily** add `%%id%%` to the target (only nodes that are pointed at need an id)
  * Which edge of the node the endpoint sits on (`dir`) and its offset (`range`) come from pointer ray-casting; the pointer position is the control point
  * **Why not automatic routing**: the engine picks sides by eight quadrants and computes default control points, so two nodes stacked vertically with a slight horizontal offset get "right → top", and on device 11 of 21 sampled points of one line fell inside the source node's box. If the route is to read well, the user decides it
  * Three exits: click empty canvas, `Esc`, or switch files (the session rolls back with the engine rebuild; nothing is written before both handles land)
* **Drag and it is saved**: 200 ms after you drag an endpoint or control point, `geo=` is rewritten — eight numbers: start `dir,range` → end `dir,range` → control point 1 `dx,dy` → control point 2 `dx,dy`
  * **Relative values only**: moving nodes, switching layouts or zooming needs no recomputation; edges you never dragged carry no `geo=` and use the engine's default curve
* **Line colour**: right-click a line → "Relationship color" (follow theme / the same colour families as node colours / custom…), written as `color=#rrggbb`
  * "Mint" is the same hex on a node and on its outgoing lines — that is what makes a branch and its edges look like one family
  * Width, dash pattern and label size still come from the theme alone; per-edge colour is the only override
* **Labels**: right-click a line → "Edit relationship label"; `%%` and `[[ ]]` are rejected (the first would tear the directive line apart, the second would be parsed as a link)
* **Two ways to delete a line**: right-click the line itself, or click it to activate and press `Delete` / `Backspace`
  * Deletion removes that one ref from the source node; when the id **has no incoming edges left**, the target's `%%id%%` line is reclaimed too (both lines in one commit and one undo step), so no invisible comment is left behind
* **Read-only embeds draw lines too**: relationships are visible inside `mindmap` fenced blocks, and the embed still grabs none of the host's keys or gestures

<h3>Changed</h3>

* **Lines sit below nodes** (`associativeLineIsAlwaysAboveNode = false`): a two-point Bézier does no avoidance, so on top it would cut straight through the middle column's text
* **Lighter look**: 1.5 px dashed lines in the theme's line colour; 12 px labels with a canvas-coloured stroke halo (readable on top of anything)
* **Labels no longer collide**: the position moved from "50% of the path" to `min(0.75, 0.35 + 0.12 × sibling index)`, and labels live on their own top layer (rebuilt with each re-render, so sinking the lines does not hide them)
* **Edges without `geo=`** (a hand-written `%%rel%%`, for example): control points extend along the **anchor's outward normal** by `clamp(distance/4, 20, 40)`, so the curve always leaves the node before bending toward the target — the old formula inflated with distance, and one map showed both "a tight half-circle" and "a spring flung into the distance"
* **Menu structure**: layout / palette (map and node) / relationship colour all use the same cascading submenu implementation; "Relationship" is a **stand-alone direct entry** in the node menu — it is a structural edit, not an appearance tweak
* **Edge cap 500** (truncated in document order; it only limits how many are drawn — the id index and the dangling/self-loop checks are unaffected)

<h3>Fixed</h3>

* **Dragged geometry is no longer overwritten by computed values**: the write-back only patches `geo=`; the edge set, labels and order always come from the file (the engine rewrites those two arrays while rendering, so without a gate the computed values would land in the file as well)
* **An edge deleted from the file no longer comes back on the next sync**
* **Geometry is claimed by target, not by index**: after removing one edge or inserting a new one, an old route cannot be reassigned to a different edge — such a mix-up would write the wrong `geo=` into the file
* **No more redraw on every frame in the steady state**: the "file has no `geo=`" case used to count as "changed" on every sync, which meant every render also cleared the line's active state
* **Empty-content nodes** (an empty heading or list item): the directive strictly owns the last line and no longer turns into the node's text
* **Closing the view mid-gesture** no longer leaks the picking session (it binds native `window` listeners, outside the engine's event bookkeeping)

<h3>Engineering</h3>

* Layers: `domain/relation` (syntax detection / stripping / rewriting / tree-level graph), `domain/relation-anchor` (anchor geometry), `engine/mindmap-relations` (the anti-corruption surface), `features/view-node-relation` + `features/view-relation-anchor` (interaction), `ui/menu-submenu` (the single cascading-submenu implementation), `ui/modal-relation-label`
* Three vendor patches: 13 — no interaction bindings in read-only mode; 14 — label halo and a dedicated top layer; 15 — default control points along the anchor's outward normal
* The syntax is documented in `docs/markdown-mindmap-standard.md` (read/write rules for the `id` / `rel` / `geo` / `color` segments) and the behaviour in the `AGENTS.md` decision table plus K153 / K154 in `docs/agents/conventions.md`
* Tests: four new files — `relation-directive` / `relation-anchor` / `engine-relations` / `view-node-relation`; full suite **99 files / 2665 cases**; gates `build` / `test` / `lint` / `lint:css` / `check:release` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies; **`styles.css` is unchanged** (replacing `main.js` is enough, but update `manifest.json` too)
* **Files without relationship directives are untouched**: opening, editing and saving produce no new lines — `%%id%%` is added only when **you create a relationship**
* **No new commands and no new settings keys**: command IDs and the `data.json` shape are unchanged; relationships live only in context menus (node / line) and claim no shortcut
* **Known limits**: the central topic cannot be an endpoint (a virtual node has no source line); self-loops are ignored; a duplicated id resolves to the first in document order; cross-file relationships are not supported; a dangling edge (target id missing) is not drawn but **kept verbatim** (that line was never edited, and silently cleaning it would break the lossless contract)
* **Rolling back to 0.2.9 or earlier**: `%%id%%` / `%%rel%%` lines become ordinary paragraph nodes, and since comment syntax is still hidden they show up as empty nodes. **No file is rewritten**, and re-upgrading restores everything; to clean up for good, delete the whole lines starting with `%%id:` / `%%rel:`
