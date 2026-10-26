[中文](#cn-v0.2.5) | [English](#en-v0.2.5)

0.2.5 的四个新能力都落在「看全图」与「走视口」上：**左下角自动浮出的小地图**（100% 装不下时出现，拖方框或面板空白处导航，视口框逐帧跟手，空闲 30 秒淡出，滚轮转发给画布）；**滚轮平移改为平滑**，并新增 **`Alt` + 滚轮横轴**；**无选中时 `Ctrl/Cmd+C` 直接复制整张图**。两处口径调整：**自动整理不再夺走视口**（只重排）、**新建导图默认无边框**；右缘竖栏换成官方 Canvas 同款卡片（组内刷平、条目自带分隔线、提示统一向左）。工程侧新增 `npm run check:gates` 门禁编排脚本（此前零测试）并补齐直测，AGENTS.md 的豁免表流水外迁独立文档。

<h3 id="cn-v0.2.5">新增</h3>

* **小地图（左下角自动浮层）**：**100% 缩放下内容装不进画布**时才出现，装得下立即消失——**无按钮 / 命令 / 设置项**，也不写 `data.json`；画布宽度不足 320px 时同样不显示
  * **面板按内容比例**：宽收在 160–220、高度随内容比例、上限为**画布高 × 0.6**，**底边钉住、只向上长**；常态半透明（会盖住节点边缘），指针移上去转实心
  * **缩略图按原图输出**：节点是带描边的小方块、按层级分浓淡，配色跟随当前色板；连线**按当前布局复刻画布的形状**（逻辑结构图 / 思维导图为水平折线，组织结构图为向下母线，目录组织图为左侧竖轨，时间轴族带一级兄弟横链，鱼骨图为「水平骨干 + 每骨一截 45° 短骨 + 斜脊」）
  * **连线按节点数分档**（不配额、不抽样）：≤ 500 节点画**全部**父子连线；> 500 节点只画**前 7 层**的父子边，更深的一条不画。**节点方块永远全画**（超过 2000 个才按步长抽样，控制 SVG 体积）
  * **视口框逐帧本地投影**：走当前变换、不重算缩略图，平移 / 缩放时框不迟于主图；窗口缩放后按**实时画布尺寸**投影，不会等到下一次换图（最长 30s）才纠正
  * **拖拽导航**：在**方框**上拖 = 视口跟着指针走（内容反向），在**面板空白**拖 = 内容跟着指针走（等同拖动画布）；两种方向共用同一换算比例（当前缩放 / 缩略比例）
  * **滚轮转发给画布**：指针压在小地图上时，普通滚轮平移、`Ctrl`/`Cmd`+滚轮缩放、`Alt`+滚轮横轴照常生效（事件转发目标即画布）
  * **省电**：启用瞬间立即画（首屏不等节拍），此后每 30s 最多换一次且只在有改动时换；空闲 30s 淡出，**隐藏期间零重绘、零定时器**；指针在面板上时到点也不淡出，离开后重新给满一个空闲窗口
  * **刷新时机分两类**：连线 / 配色 / 边框**立即重画**（同步动作，等节拍会被当成没跟着切）；**布局等渲染落地再画**（引擎重排是异步分片，当场取样只能拿到上一套几何）
  * **后台重渲染不会叫醒它**：淡出后只有用户动作（编辑、平移缩放、窗口改尺寸、四项外观偏好）能点亮；图片回灌 / 字体加载 / 内容重测这类渲染落地只续期**已显示**的面板
* **滚轮平移平滑化**：引擎对鼠标一格是「固定 100px、当帧到位、零过渡」的瞬移，现在把鼠标格（`|deltaY| ≥ 50`）的位移累积到目标值，**逐帧指数趋近**（τ ≈ 45ms，约 3τ 走完 95%）分多帧走完，单帧限幅 120px；**总行程不变**。触控板 / 高精度滚轮的小 delta 仍原样交引擎逐事件跟手，不给已经连续的输入再叠一层延迟
* **`Alt` + 滚轮横轴平移**：上滚 = 视野左移（内容右移）、下滚反之；幅度 `min(|deltaY|, 100)`——鼠标一格恒一档，触控板按实际像素跟手。与纵向鼠标格共用同一套平滑。**让位**：`Ctrl/Cmd`（缩放优先）、编辑中（输入先落数据）、指针不在画布内不接管、纯横向 delta 交引擎
* **无选中时复制整张图**：`Ctrl`/`Cmd`+`C` 在**没有选中节点**时复制**整张图的大纲**（中心主题作首行，与选中子树同一序列化口径：标题降为 `-`、层级用缩进），不再只弹「请先选择一个节点」；**只选中中心主题**时同样落整图分支（根被过滤后集合为空）。剪贴板不会再留着上一次的旧内容
* **右缘竖栏的卡片与提示**：四组按钮逐项对齐官方 Canvas 的 `.canvas-control-group`——组内**没有缝隙**（`gap: 0`），分隔线画在**条目自身**的 1px 底边（末项去掉），组圆角 `var(--radius-s)`、阴影 `--input-shadow`、**无整组透明度**；悬停取 `--interactive-hover` + `--text-normal`，置灰**只淡化图标**（外框与分隔线保持原样）。tooltip 统一**向左**弹出（竖栏贴右缘，向左不越界、不压住按钮）

<h3>变更</h3>

* **自动整理保留视口**：按下「整理」只重排节点、**不再自动适应画布**——不该被夺走当前视野；想看全图按「总览」。**切换布局**仍会自动整理并适应画布（那条路径的视口本来就被引擎重置）
* **新建导图默认无边框**：出厂默认由「有边框」改为「无边框」，设置项「默认边框样式」的初始值同步（`mindmap` 围栏块跟随这个全局默认）。**存量文件不受影响**——每篇导图的边框有自己的按文件值；已有安装若 `data.json` 里已存过 `defaultThemeStyle`（例如 `"default"`），继续沿用该值
* **提示落位修正**：右缘竖栏的「边框 / 连线」开关曾在切换一次状态后，tooltip 从左侧跳回默认下方（官方按**本次调用**决定展示位置，状态回写时漏传落位）——现在构建与每次回写都带同一落位

<h3>工程</h3>

* **新增 `npm run check:gates`**：按 git 变更集自动算出附加门禁并**顺序执行**（首败即停），顺带静态核对「未登记超限文件数」（硬规则 10 的机器核对）。`scripts/check-gates.mjs` 此前**零测试**（映射错了只会让某道门禁静默不跑），现由 `tests/check-gates.test.ts` 直测 11 例：基线顺序、五条触发面、变更集不可读与 `--all`、跳过理由、豁免行形态与 stale
* **AGENTS.md 瘦身**：豁免表的历次行数读数与批次流水外迁 [`docs/agents/line-count-log.md`](agents/line-count-log.md)，AGENTS.md 只留终值；关键约定补到 K144（小地图几何 / 刷新 / 视口框、滚轮两条、剪贴板整图复制、竖栏样式）
* **小地图的两块收口**：`core/minimap-geometry.ts`（纯几何与绘制模型，无 DOM / 无引擎依赖：面板尺寸、SVG、连线、视口框投影、开关节拍）与 `engine/mindmap-minimap.ts`（引擎侧取样）；渲染层只负责取数据与装配 DOM，同一套「内容盒 → 面板坐标」换算不出现第二份
* 测试全量 **87 文件 / 2377 例**；本地门禁 `build` / `test` / `lint` / `lint:css` / `check:release` 全绿

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖
* **`styles.css` 有变化**（小地图面板、右缘竖栏卡片），**请与 `main.js` 一起替换**
* **无新增设置键，也没有新命令**；`data.json` 结构不变（`viewState` 里四项按文件偏好的键名与口径照旧）；小地图不写 `data.json`
* ⚠ **默认边框改为「无边框」，只影响新建导图**；存量导图按各自的按文件值显示
* ⚠ **自动整理不再自动适应画布**（想看全图请按「总览」）；右键菜单的「自动整理」与竖栏「整理」按钮行为一致
* ⚠ **小地图只在内容装不下时出现**，没有开关可强制常显；大图（> 500 节点）的缩略连线只画前 7 层
* 导图文件格式、往返保真契约与命令 ID 均不变

---

<h3 id="en-v0.2.5">Added</h3>

* **Minimap (an automatic overlay in the bottom-left corner)**: it appears only when the map **does not fit the canvas at 100%** and disappears the moment it fits — **no button, command or setting**, and nothing is written to `data.json`; it also stays hidden on canvases narrower than 320px
  * **Sized to the content**: width between 160 and 220, height follows the content up to **60% of the canvas height**, with the **bottom edge pinned** (it only grows upwards); translucent by default (it does cover node edges), turning solid under the pointer
  * **The thumbnail mirrors the map**: nodes are small outlined squares shaded by depth, colours follow the current palette, and connectors **follow the current layout's shape** (Logical structure / Mind map: horizontal elbows; Organization chart: downward bus; Catalog organization: left rail; Timeline family: sibling chain; Fishbone: horizontal spine + one 45° rib per bone + angled ridge)
  * **Connectors are budgeted by node count** (no quota, no sampling): at ≤ 500 nodes **all** parent-child links are drawn; above 500 only the **first 7 levels** are drawn and nothing deeper. **Node squares are always drawn in full** (sampling only kicks in past 2000 marks, to keep the SVG small)
  * **The viewport box is projected locally every frame**: it reads the current transform instead of redrawing the thumbnail, so it never lags the map; after a window resize it projects against the **live canvas size**, not the last draw's snapshot (which could be up to 30s old)
  * **Drag to navigate**: dragging the **box** moves the viewport with the pointer (content moves the other way); dragging the **empty panel area** moves the content with the pointer (like dragging the canvas). Both directions use one conversion (current zoom / thumbnail scale)
  * **The wheel is forwarded to the canvas**: with the pointer over the minimap, a plain wheel pans, `Ctrl`/`Cmd`+wheel zooms and `Alt`+wheel pans horizontally, exactly as on the map
  * **Cheap by design**: the first frame is drawn immediately (no waiting for the tick), afterwards at most one redraw per 30s and only when something changed; it fades after 30s of inactivity with **zero redraws and zero timers while hidden**; hovering keeps it alive and restarts a full idle window on leave
  * **Two refresh paths**: line style / palette / border redraw **immediately** (they are synchronous actions and waiting for the tick feels broken); **layout changes wait for the render to land** (the engine re-lays out in async slices, so sampling on the spot would capture the previous geometry)
  * **Background re-renders do not wake it**: after fading out, only user actions (editing, pan/zoom, window resize, the four appearance preferences) bring it back; render landings triggered by image remeasure, font loading or content re-measurement only extend a panel that is **already visible**
* **Smooth wheel panning**: the engine moves a mouse notch by a fixed 100px in a single frame with no easing; mouse notches (`|deltaY| ≥ 50`) are now accumulated into a target and approached **exponentially per frame** (τ ≈ 45ms, ~3τ for 95%), capped at 120px per frame, with the **same total travel**. Trackpad / high-resolution deltas are still handed to the engine event by event, so already-continuous input does not gain extra latency
* **`Alt` + wheel pans horizontally**: scrolling up moves the view left (content right) and vice versa; the step is `min(|deltaY|, 100)` — one notch is always one step, trackpads follow their real amplitude. It uses the same smoothing as vertical notches. **Yields** to `Ctrl`/`Cmd` (zoom wins), to an active edit (input lands first), to pointers outside the canvas, and leaves pure horizontal deltas to the engine
* **Copy the whole map when nothing is selected**: `Ctrl`/`Cmd`+`C` with **no node selected** now copies the **whole outline** (central topic as the first line, same serialisation as selected subtrees: headings flatten to `-`, indentation encodes levels) instead of only telling you to select a node; **selecting just the central topic** takes the same path (the root is filtered out, leaving an empty set). The clipboard no longer keeps stale text
* **Right-edge rail cards and tooltips**: each group now matches the official Canvas `.canvas-control-group` — **no gaps** inside a group (`gap: 0`), the divider is the item's own 1px bottom border (removed on the last item), group radius `var(--radius-s)`, `--input-shadow`, and **no opacity on the group**; hover uses `--interactive-hover` + `--text-normal`, and a disabled button only tints its **icon** (frame and dividers stay). Tooltips are anchored **left** (the rail hugs the right edge, so a left placement neither overflows nor covers the button)

<h3>Changed</h3>

* **Auto arrange keeps the viewport**: the "Tidy" button only re-lays out the nodes and **no longer fits the canvas** — pressing it should not take your view away; use **Fit to canvas** to see everything. **Switching layouts** still auto-arranges and fits (the engine resets the viewport on that path anyway)
* **New maps default to borderless**: the factory default changed from bordered to borderless, and so did the initial value of the **Default border style** setting (`mindmap` fenced blocks follow this global default). **Existing maps are unaffected** — each map keeps its own per-file border; installs whose `data.json` already stores `defaultThemeStyle` (e.g. `"default"`) keep that value
* **Tooltip placement fix**: the border / line-style toggles on the rail used to drop their tooltip from the left back to the default bottom after the first state change (Obsidian decides placement **per call**, and the state write-back omitted it) — both construction and every write-back now pass the same placement

<h3>Engineering</h3>

* **New `npm run check:gates`**: derives the extra gates from the git change set and runs them **in order** (stops at the first failure), plus a static check that no over-limit file is unregistered (the machine check for rule 10). `scripts/check-gates.mjs` had **zero tests** (a wrong mapping would silently skip a gate); it is now covered by 11 cases in `tests/check-gates.test.ts`: baseline order, the five trigger surfaces, unreadable change set, `--all`, skip reasons, and exemption-row shape / staleness
* **AGENTS.md slimmed down**: the exemption table's historical line counts and batch log moved to [`docs/agents/line-count-log.md`](agents/line-count-log.md) (AGENTS.md keeps the final values); conventions extended through K144 (minimap geometry / refresh / viewport box, the two wheel decisions, whole-map copy, rail styling)
* **Two single-purpose minimap modules**: `core/minimap-geometry.ts` (pure geometry and drawing model, no DOM and no engine dependency: panel sizing, SVG, connectors, viewport projection, timing) and `engine/mindmap-minimap.ts` (engine-side sampling); the view layer only fetches data and assembles DOM, so the "content box → panel coordinates" conversion exists once
* Full test suite: **87 files / 2377 cases**; local gates `build` / `test` / `lint` / `lint:css` / `check:release` all green

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies
* **`styles.css` changed** (minimap panel, rail cards) — **replace it together with `main.js`**
* **No new settings keys and no new commands**; `data.json` keeps its shape (the four per-file preference keys under `viewState` are unchanged); the minimap writes nothing to `data.json`
* ⚠ **The default border is now Borderless and only affects new maps**; existing maps keep their own per-file value
* ⚠ **Auto arrange no longer fits the canvas** (use **Fit to canvas** to see everything); the context-menu entry and the rail's "Tidy" button behave identically
* ⚠ **The minimap only appears when the map does not fit**, with no switch to force it; for large maps (> 500 nodes) the thumbnail draws connectors only down to level 7
* The mind map file format, the lossless round-trip contract and all command IDs are unchanged
