[中文](#cn-v0.3.2) | [English](#en-v0.3.2)

0.3.2 是一版**外观与手感**的整理：配色从 7 套重做为 10 套（默认 + 九套色相，统一明度阶梯）、节点颜色改为「写的颜色就是屏上的颜色」、节点配色多了「作用范围」（含子节点 / 仅本节点）、整体排版（字号 / 内边距 / 圆角 / 连线粗细）重调，出厂默认边框回到「有边框」。同时补上两处一直缺的可见信息：空白右键新增「按分支自动上色」，状态栏开始常驻显示「保存中… / 已保存 / 未保存」。

大图在这一版也不再卡。拖动窗口时，5000 节点的图原本每秒要重排数次（1.2 s 的拖动里排 5 轮、长任务合计 1.58 s）；现在大图改成「停手后再排一次」。引擎侧把布局里的**逐次立即平移**换成「记账 + 收尾一次物化」，10000 节点打开 **8.89 s → 0.32 s**、单次编辑 **1.5–9.5 s → 131 ms**，时间轴 / 鱼骨图的单次重排 **7.3 s / 7.0 s → 37 ms / 36 ms**。

另修四处静默问题：用 Tab 缩进的笔记加载即被拆平（保存后分支整层错位）、Tab / 4 空格缩进的笔记改一个节点就把全文缩进重排成 2 空格、「缩放到选区」在性能模式下只盖住可见的那部分、小地图视口框每帧强制布局。

<h3 id="cn-v0.3.2">新增</h3>

* **按分支自动上色**：空白处右键 →「配色」→「按分支自动上色」，给每个分支依次写一个主色
  * 「分支层」＝从根往下**第一层有多个兄弟**的节点：`# 标题` + `- 列表` 与 `# 项目` + `## 模块` 两种常见结构的分支分别落在第 1 / 2 层（根是文件名，比文档标题多占一层），固定深度取不到。一路单链的文档没有可分配的对象，菜单里就不出现这一项
  * 颜色依次取节点配色表里的九个填充色循环分配；写入的仍是既有的 `%%#hex%%` 注释指令，**文件格式没有新增元素**。一次批量提交（一次渲染 / 一次保存 / 一条撤销），`Ctrl+Z` 可整体回退
  * 已有指令的分支会被**覆盖**（这是显式动作）；联系指令行原样贴回，`%%rel%%` 的语义不会丢
  * 子树里的哨兵 `%%none%%` **保留**：那是用户先前显式点的「默认」，它现在挡的是新色源，删掉会让那些子孙反而吃到颜色
* **配色作用范围**（设置 →「配色作用范围」）：右键给节点上色时，颜色是否一并套到子节点
  * 出厂「含子节点」＝本设置引入前的行为（只给被选中的节点写指令、后代靠继承），升级观感零变化；「仅本节点」＝只有被选中的节点变色
  * 「仅本节点」的落地写法是给**直接子节点**的行补 `%%none%%` 挡住继承（父节点自己也染着时同样如此），同时**不把节点色写进连接线**——线是「这一支往哪延伸」的线索，范围只到本节点，前后两段就不该再带它的色；填充 / 描边 / 文字仍完全由正文决定
  * 所以两台机器设置不同时，同一份文件的**连接线颜色可能不同，节点填充不会**（与「主题」决定连线明暗同性质）；`mindmap` 只读嵌入同样跟这一档全局设置
  * 多选时「仅本节点」**不折叠**到最上层（每个被选中的节点都要有自己的指令），「含子节点」仍只写最上层
* **状态栏保存状态**：节点数右侧常驻显示 `保存中…` / `已保存` / `未保存`，与计数合成一行
  * 写盘失败、外部改动冲突跳过、连续失败挂起自动保存这三种收场此前只有一次性 Notice——用户关掉提示后没有任何「未保存」线索；现在 `未保存` 一直留到下一次成功写入
  * 只有**真的排上了**才报「保存中」：已挂起时报「未保存」（上一次写盘失败，内容确实没落盘）；**自动保存关闭**时不报「保存中」，改为同样防抖的**只判定**轮次——与加载基线逐字比较，有改动报「未保存」、回到加载态报「已保存」，全程不写盘（判据与「纯浏览不写盘」同源，不另立一套）。一轮排空成功即切「已保存」，含「无差异跳过写盘」那一轮
  * 只在**本视图是活动视图**时写共享状态栏：后台标签的写盘结果不会盖掉前台那张图的状态，切回来时按视图自己的状态重推
  * 切语言时按当前状态**重推一次**（否则会退回静态的「思维导图」占位，状态段消失）
* **只读角标**：`mindmap` 围栏块与文件视图外观一致，但没有任何编辑入口——右上角补一个「只读 / Read-only」角标，纯装饰（不占布局、不吃指针），免得用户反复尝试双击与拖拽。空态 / 超限大纲 / 渲染失败三种降级路径不加（它们各有自己的可见文案）

<h3>变更</h3>

* **配色重做：10 套，命名统一为颜色词**
  * 选项按色相环排列：默认 / 青碧 / 湛蓝 / 紫棠 / 绯红 / 暖橙 / 麦黄 / 翠绿 / 银灰 / 雾白；上一版的薄荷 / 琥珀 / 玫瑰 / 紫藤 / 森林 / 石板整组退役
  * 九套不再各自手调，改用**同一套明度阶梯 + 分色相饱和度**：亮色 `L` 46 / 90 / 96 / 82 / 55（根 / 二级 / 三级 / 描边 / 连线），暗色 `L` 30 / 16 / 12 / 26 / 45；饱和度按色相收放（绿压到 42、黄 82、橙 78）。此前按 Tailwind 固定档位取值，各套明度其实并不相同（teal-600 比 amber-600 暗一截），**单独看没毛病、并排就显得脏**
  * 默认套**回撤到 2026-10-29 的基准值**（`#4a90d9` + 近白）：读者已习惯「一张安静的蓝图」，其余九套换色板时它不动
  * 麦黄的根色单独压到 `L` 36：黄色最亮，`L` 46 时白字只有 2.11，压到 36 才够 3:1
  * **旧 id 只做读兼容**：`data.json` 里的 `palette` 仍认 `mint / amber / rose / wisteria / forest / slate`，打开即按对应新配色渲染（`mint → 青碧`、`amber → 暖橙`、`rose → 绯红`、`wisteria → 紫棠`、`forest → 翠绿`、`slate → 银灰`）；任何一次显式切换都把新 id 写回去。不带这层映射，老文件会静默回落成默认（用户以为配色丢了）
* **自定义整篇配色改按 HSL 派生**：从一个主色按**同一套明度阶梯**算出五档，只缩放饱和度、不再与画布混白——混白会把饱和度一起冲掉，整篇发灰。二级 / 三级文字色沿用预设那组固定值（浅档上的深字，观感一致），只有**根节点**文字色按对比度现算（用户可能给任意色，浅底上白字会看不见）
* **节点颜色＝填充色**（反转 2026-10-29 的「色相锚」方案）
  * 指令里的 `#rrggbb` **就是画布上的填充色**：此前把它当色相锚、洗成 16% 的浅色，选 `#2e9e8f` 得到 `#deefed`，看着像没生效——「写的和显示的对不上」
  * 连线 / 描边取**同色相深一档**（预设色有配对表，自定义 hex 按同一比例现算——浅填充配浅线在 fit 缩放下会整片消失）；文字色按填充亮度现算（深底自动白字、浅底柔和深灰蓝 `#111827`，最差退纯黑 / 纯白）
  * `borderWidth` 仍由「边框」开关决定，节点级颜色不改描边粗细
  * **代价要认**：中深色铺满整支会吃掉「深字浅底」的阅读优势——白字对比大多落在 3:1–6:1（AA 要求 4.5），偏浅的色相更低。观感不舒服应当换色板，而不是在渲染期把颜色加工掉
* **整体排版重调**
  * 字号梯度 24 / 16 / 13（原 16 / 14 / 13）：fit 到 0.6 倍时原梯度只剩 9.6 / 8.4 / 7.8px，三层只差 1px，层级读不出来
  * 内边距分级：中心 30×14、一级 18×9、其余 12×7（原统一 16×5）——12–14px 的字配 5px 垂直内边距，文字上下几乎贴边，一行字看起来像「一条线」而不是「一个节点」
  * 圆角中心 8、其余 6（原统一 5）；一级加粗一档（600），缩放后仍与三级分得开
  * 父子线 2px（原 1.5）：fit 到 0.6 倍时 1.5px 只剩 0.9px，整棵树的结构线几乎消失；联系 / 概要括号等辅助线仍 1.5，视觉重量继续随层级递减
* **出厂默认边框回到「有边框」**：字号与内边距调整之后，无边框档（填充也透明）实机退化成「大纲 + 一条线」，层级只剩缩进；浅底 + 1px 描边才托得住每一级。**按文件值只在用户显式切过竖栏开关时才有**，所以：显式切过的文件保持原值，**从没切过的（含新建文档与 `mindmap` 嵌入）会跟着新默认变成有边框**——上一版默认是无边框，对多数存量导图这是一次真实的观感变化
* **图片自然尺寸上限 480 → 320**：32 节点的验收图上，一张 200×200 的图就吃掉约三分之一高度，fit 后整图被迫缩到 0.6–0.7；真实截图按 480 缩仍有 480×300，同一屏放不下两支。带**显式尺寸参数**的图片（`![[图|2000]]`）不受此限
* **撤色顺手清掉无主哨兵**：撤销一个节点的颜色（删掉自身指令，或改写成 `%%none%%`）之后，后代里当初**只为挡这一支**的 `%%none%%` 已无对象可挡，现在批量删除（与主改动同在一条撤销快照里），文件不再白留一行注释。**后代重新染色的分支整支保留**——那支的哨兵挡的是新色源，删掉会让它的子孙反而吃到颜色

<h3>修复</h3>

* **Tab 缩进的笔记不再被拆平**
  * 症状：用制表符缩进的文档一打开列表层级就散了，项内围栏代码块被拆成同级节点；保存后 4 个分支整层错位
  * 成因：列表项的缩进按 `(\s*)` 计（Tab 算 1），而续行 / 围栏块的 `indent` 只数空格（Tab 文件里恒为 0）⇒「续行缩进大于列表项」永不成立
  * 修法：续行与围栏块改用与列表项同一把尺子（空格与制表符各计 1）；frontmatter 块标量的缩进判定仍只认空格，两条口径分开表达
* **缩进单位随文档走，改一个节点不再重排全文缩进**
  * 症状：用 Tab 或 4 空格缩进的笔记，改一个节点的文字并保存后，**整篇缩进被重排成 2 空格**——Git / 同步盘平白多一个全文 diff
  * 成因：序列化按树深度硬写「每层 2 空格」，与原文风格无关
  * 修法：解析期实测「一层有多宽」（第一处有缩进的列表行的前导空白，**原样**记在虚拟根 data 的 `mdIndentUnit`——空格与 Tab 混用也照抄，不折算成单个 Tab），序列化按它输出；测不出单位时（全文无缩进列表 / 新建文件）仍回落 2 空格
* **大图拖动窗口不再每秒冻结数次**：≥1000 节点改用**尾随合并**——拖动中只重置计时器，停手 180 ms 后做一次整树 resize；小图仍走 100 ms 节流（实时跟手）。实测 5000 节点单轮 `render()` ≈0.4 s，原策略在 1.2 s 拖动里排 5 轮（长任务合计 1.58 s、4 个 >50 ms 卡顿帧）。代价是拖动期间画布仍是旧尺寸（≤180 ms）
* **「缩放到选区」改用布局几何**：性能模式把视口外节点 `removeSelf()` 摘出 DOM，旧的 DOM 包围盒对这些节点返回空 ⇒ 大选区只盖住可见那部分，缩放落到错误范围；另外逐节点 `getBoundingClientRect` 在一次同步块里是 N 次几何查询。布局几何（`left/top/width/height`）剪枝后仍完整，一次变换即可，离屏节点自然参与
* **小地图视口框不再每帧强制布局**：画布尺寸原先每帧读实时的 `getBoundingClientRect`，而视口框每次更新都在写 `style.left/top/…` ⇒ 平移 / 缩放期间「写样式 → 读矩形」逐帧抖动。现在缓存画布尺寸，只在引擎 `resize` 事件、取图与 `refresh` 三处刷新（缓存缺失才退回实时读）；面板尺寸仍用绘制快照——它必须与面板 DOM 当前值一致
* **拖入文件时不再每次事件建数组**：`dragover` 约 60 Hz，此前 `Array.from(types)` 每个事件分配一次；改为直接下标遍历 `DOMStringList`

<h3>工程</h3>

* **vendor 补丁 16**（`Base.js` + `MindMap.js` + `OrganizationStructure.js` + `CatalogOrganization.js`，并收敛 `LogicalStructure.js`）：补丁 9 的「记账 + 末尾一次 O(n) 物化」此前只落在逻辑结构图，其余布局仍逐次立即平移（`updateChildren` 递归平移兄弟子树）。计数探针实测 10000 节点 `Mindmap` 布局：`updateChildren` 调用 **88,103 次**、平移 **1.32 亿节点次**，同一棵树切到逻辑结构布局为 **0 次**；CDP 采样显示它占打开耗时 ~99%
  * 实现抽到 `Base`（`beginOffsets` / `recordTopOffset` / `recordLeftOffset` / `applyOffsets`，单 / 双轴通用），`LogicalStructure` 改为复用，不留第二份
  * 实测：打开 10000 节点 **8.89 s → 0.32 s**（最长长任务 8.65 s → 170 ms）、单次编辑 **1.5–9.5 s → 131 ms**、5000 节点布局重排（三布局）**2.1–2.6 s → 0.12–0.23 s**、自动整理最长长任务 **2220 ms → 88 ms**；几何 A/B（6 布局 × 800 节点 + 4 布局 × 5000 节点，逐节点 `_top` / `_left`）**0 差异**
* **vendor 补丁 17**（`Timeline.js` / `Fishbone.js` / `fishboneUtils.js`）：两布局的 `updateBrothersTop` 递归同一个形状——10000 节点 **84,856 次调用 / 9962 万节点次 / 单次编辑 6.8 s**。难点是镜像收尾要在同一 task 内读绝对 `top`，故新增 `Base.matTop`（祖先链求和，O(层数)）代替「前移 `applyOffsets`」；`left` 轴保持立即应用
  * 实测：timeline / fishbone 单次重排 **7.3 s / 7.0 s → 37 ms / 36 ms**、单次编辑 **6841 ms → 123 ms**；几何 A/B（8 组场景：普通 / 自定义位置 / 概要 / 折叠 × 两布局，1000–1202 节点）**0 差异**
* 产物字节身份更新（`vendor/simple-mind-map.cjs` 415,727 B，sha256 已同步进 `vendor/BUILD.md` 与 `tests/vendor-contract.test.ts`）
* `SavePipeline.schedule()` 改为返回**是否真的排上了**（自动保存关闭 / 已挂起时不排），`SavePipelineDeps` 新增 `onSaved(file)`（一轮排空成功时回调，冲突跳过与写盘异常不调）；状态栏服务新增 `showSaveState`，内部持有计数与状态两个字段统一渲染并去重
* 新增 `engine/mindmap-nodes.branchLayerOf`（分支层判定）、`engine/mindmap-viewport.measureNodesCanvasBox`（选区包围盒）、`domain/color.hexToHsl` / `hslToHex` / `orphanSentinels` / `scopeSentinels`；`features/view-node-color` 新增 `hasBranchLayer` / `applyBranchColors`
* 设置新增 `nodeColorScope`（`core/constants.NODE_COLOR_SCOPE_OPTIONS` 选项表 + `isNodeOnlyColorScope` 唯一判定，出厂 `subtree`）；`MindmapEmbedConfig` 增 `colorLine`，引擎侧 `applyLiveColorDirectives` / `syncNodeColorDirectives` / `applyColorDirectivesToTree` 透传该开关
* 测试：新增 `tests/view-resize.test.ts`（大图 resize 的两种调度策略与互斥取消）；全量 **103 文件 / 2836 例**；门禁 `build` / `test` / `lint` / `lint:css` / `check:release` 均通过
* 文档：`AGENTS.md` 决策表同步（配色重做与旧 id 兼容、节点颜色的「填充色」语义与代价、配色作用范围、默认边框改回有边框、状态栏保存状态、图片上限 320）；标准文档与 `docs/agents/conventions.md` 的 K97 / K128 口径同步

<h3>兼容性说明</h3>

* 需要 Obsidian 1.13.0+，仅桌面端；`minAppVersion` **保持 1.13.0**；无新增第三方依赖；**`styles.css` 有变化**（只读角标）——三件套（`main.js` / `manifest.json` / `styles.css`）请一起替换
* **`data.json` 不需要手改**：旧配色 id 自动映射到新 id；未知 / 脏值仍回落默认。新 id 只在用户显式切换配色时写入
* **新增设置项「配色作用范围」，默认「含子节点」**：行为与 0.3.1 完全一致；只有显式切到「仅本节点」才会在子节点行上写 `%%none%%`（该指令旧版已存在，回滚后仍按「挡住父色」解释，只是连接线会重新着色）
* **文件格式零新增元素**：分支上色写的是既有的 `%%#hex%%` 注释指令，节点正文一个字符都不加，未编辑行仍逐字回写
* **外观会变，这是本版主诉求**：默认边框从无边框恢复为有边框、字号 / 内边距 / 圆角 / 连线同步调整、节点指令色直接铺满。若更喜欢旧观感：右缘竖栏切「无边框」，或把节点色指令删掉回落整篇配色
* **回滚到 0.3.1**：文件不会被改写；但新配色 id（`teal` / `blue` / `purple` / `crimson` / `orange` / `gold` / `green` / `grey` / `mist`）在旧版会被当成未知值**回落默认配色**（重装 0.3.2 即恢复，因为文件里存的是新 id）；节点色在旧版会重新被洗淡
* **已知边界**：单链文档没有分支层，菜单不出现「按分支自动上色」；该动作**覆盖**分支上已有指令（`Ctrl+Z` 整体回退），且不清理子树里的 `%%none%%`；节点色铺满整支后，白字对比大多只有 3:1–6:1（要更清楚请换色板）；「配色作用范围」切到「仅本节点」后，每个直接子节点行上会多一条 `%%none%%`（随撤色一并清理），连接线也不再带节点色；大图拖动窗口期间画布保持旧尺寸，最多 180 ms

---

0.3.2 is a pass over **look and feel**: the palette set was rebuilt from 7 to 10 (default plus nine hues on one shared lightness ladder), node colours became "the colour you write is the colour you see", node colours gained a **scope** ("with children" / "node only"), typography (sizes / padding / corner radii / connector weight) was retuned, and the factory default border is back to "bordered". Two pieces of missing information also landed: "Colour by branch" on the blank-canvas menu, and a persistent `Saving… / Saved / Unsaved` segment in the status bar.

Large maps no longer stall either. Resizing the window used to re-render a 5000-node map several times a second (5 rounds in a 1.2 s drag, 1.58 s of long tasks in total); large maps now re-render once after you stop. On the engine side, layout shifts went from "shift immediately, every time" to "record the offsets, materialise once at the end": opening 10000 nodes **8.89 s → 0.32 s**, a single edit **1.5–9.5 s → 131 ms**, and one re-layout of timeline / fishbone **7.3 s / 7.0 s → 37 ms / 36 ms**.

Four silent problems were also fixed: tab-indented notes were flattened on open (saving then shifted whole branches), tab- or 4-space-indented notes had their whole indentation rewritten to 2 spaces after editing a single node, "zoom to selection" only covered the visible part in performance mode, and the minimap viewport box forced a layout every frame.

<h3 id="en-v0.3.2">Added</h3>

* **Colour by branch**: right-click empty canvas → "Palette" → "Colour by branch" writes one main colour per branch
  * The "branch layer" is the **first level, from the root down, that has more than one sibling**: for both common shapes (`# Title` + `- list` and `# Project` + `## Module`) the branches sit at level 1 or 2 (the root is the file name, one level above the document title), so a fixed depth would miss them. A single-chain document has nothing to distribute and does not get the entry at all
  * Colours cycle through the nine node fills of the palette table; what is written is the existing `%%#hex%%` comment directive, so **the file format gains no new element**. One batch commit (one render / one save / one undo), and `Ctrl+Z` rolls the whole thing back
  * Existing directives on those branches are **overwritten** (this is an explicit action); relationship directive lines are pasted back verbatim, so `%%rel%%` keeps its meaning
  * Sentinel `%%none%%` markers in the subtree are **kept**: they are the user's earlier explicit "Default", and they now block the new colour source — deleting them would let those descendants pick up the colour instead
* **Color scope** (Settings → "Color scope"): whether a node colour also applies to its children
  * Factory "With children" is the behaviour before this setting existed (a directive on the selected node only, descendants inherit it), so upgrading changes nothing; "Node only" colours just the selected nodes
  * "Node only" writes a `%%none%%` marker on each **direct child's** line to stop the inheritance (even when the parent is coloured itself), and the render side **keeps the node colour off the connectors** — a connector says "this branch continues here", so a scope that ends at the node should not tint the segments around it; fill / border / text still come entirely from the note
  * So with two machines on different settings the same file can show **different connector colours but never different fills** (the same nature as "Theme" deciding connector shading); `mindmap` read-only embeds follow this global setting too
  * With a multi-selection, "Node only" does **not** collapse to the top-most nodes (each selected node needs its own directive), while "With children" still writes only the top-most
* **Save state in the status bar**: `Saving…` / `Saved` / `Unsaved` now sits next to the node count, on the same line
  * Write failures, external-change conflict skips and the auto-save suspension used to produce a one-off Notice only — nothing remained once the user dismissed it. `Unsaved` now stays until the next successful write
  * "Saving" is only reported when a round was **actually scheduled**; a suspended pipeline reports "Unsaved" (the last write failed, so the content really is not on disk), and with **auto-save off** nothing is scheduled — instead an equally debounced **check-only** round compares the live body against the load baseline: a difference reports "Unsaved", returning to the loaded state reports "Saved", and nothing is written (the same judgement the browse-only guard uses, not a second one). A successful drain switches to "Saved", including the round that skipped the write because nothing changed
  * The shared status bar is only written when **this view is the active one**: a background tab's write result must not overwrite the state of the map in front, and switching back re-pushes this view's own state
  * Changing the language **re-pushes** the current state (otherwise it fell back to the static "Mind map" placeholder and the save segment disappeared)
* **Read-only badge**: a `mindmap` fenced block looks exactly like the file view but has no editing entries at all — a small "Read-only" badge in the top-right corner (decoration only: no layout, no pointer events) stops users from repeatedly trying to double-click and drag. The three fallback paths (empty / above the embed limit / render failure) do not get it — each already shows its own message

<h3>Changed</h3>

* **Palettes rebuilt: 10 sets, all named after colours**
  * Ordered around the hue circle: Default / Teal / Azure / Purple / Crimson / Orange / Gold / Green / Grey / Mist. The previous Mint / Amber / Rose / Wisteria / Forest / Slate set is retired as a group
  * The nine are no longer hand-tuned one by one but share **one lightness ladder with per-hue saturation**: light `L` 46 / 90 / 96 / 82 / 55 (root / second / node / border / line), dark `L` 30 / 16 / 12 / 26 / 45, with saturation tuned per hue (green held to 42, yellow 82, orange 78). The previous Tailwind steps gave each set a different lightness (teal-600 is darker than amber-600): fine alone, muddy side by side
  * The default set **reverts to the 2026-10-29 baseline values** (`#4a90d9` plus near-white): readers are used to "a quiet blue map", and it stays put while the other nine change
  * Gold's root fill is pressed to `L` 36: yellow is the brightest hue, and at `L` 46 white text only reaches 2.11, while 36 clears 3:1
  * **Old ids are read-only compatible**: `palette` values `mint / amber / rose / wisteria / forest / slate` in `data.json` still resolve to the matching new scheme (`mint → Teal`, `amber → Orange`, `rose → Crimson`, `wisteria → Purple`, `forest → Green`, `slate → Grey`), and any explicit switch writes the new id back. Without that mapping old files would silently fall back to the default and look like the palette was lost
* **Custom whole-map palettes derive in HSL**: five steps computed from one main colour on the **same lightness ladder**, scaling saturation instead of mixing with the canvas — mixing with white also washes out saturation and leaves the map grey. Second- and third-level text colours reuse the fixed preset pair (dark text on light steps, so the look is consistent); only the **root** text colour is computed from contrast, because the user may pick any colour and white text on a light fill would disappear
* **Node colour is the fill colour** (reversing the 2026-10-29 "hue anchor" scheme)
  * The `#rrggbb` in the directive **is the fill on the canvas**: it used to be treated as a hue anchor and washed to 16%, so picking `#2e9e8f` produced `#deefed` and looked like nothing happened — what you wrote was not what you saw
  * Connectors and borders take the **same hue one step darker** (preset colours have a paired line colour; a custom hex derives it at the same ratio — a pale fill with a pale line vanishes when fitted); text colour comes from the fill's luminance (white on dark fills, a soft dark slate `#111827` on light ones, falling back to pure black or white at worst)
  * `borderWidth` is still decided by the "Border" toggle; node-level colour never changes stroke weight
  * **The trade-off is real**: a mid-dark colour across a whole branch gives up the "dark text on light fill" reading comfort — white text mostly lands between 3:1 and 6:1 (AA asks for 4.5), lower on the paler hues. If it feels wrong, change the palette rather than expect the renderer to process the colour
* **Typography retuned**
  * Font sizes 24 / 16 / 13 (was 16 / 14 / 13): at a 0.6 fit the old ladder left 9.6 / 8.4 / 7.8 px, one pixel apart, and the hierarchy could not be read
  * Padding by level: root 30×14, second 18×9, rest 12×7 (was a flat 16×5) — 12–14 px text with 5 px vertical padding sits flush against the edges, so a line of text looked like "a line" rather than "a node"
  * Corner radius 8 on the root, 6 elsewhere (was a flat 5); the second level is one weight heavier (600) so it still separates from the third when zoomed out
  * Parent-child connectors 2 px (was 1.5): at a 0.6 fit, 1.5 px becomes 0.9 px and the structure nearly disappears. Relationship and summary brackets stay at 1.5, so visual weight still decreases with depth
* **Factory default border is "bordered" again**: after the type and padding changes, the borderless tier (with a transparent fill) degraded into "an outline plus one line" on device — the hierarchy was carried by indentation alone; a light fill with a 1 px stroke holds each level up. A per-file value only exists **once the user has explicitly used the right-edge toggle**, so maps that were switched keep their value while **everything that never was — new documents and `mindmap` embeds included — follows the new default and becomes bordered**; the previous default was borderless, so for most existing maps this is a real change in look
* **Natural image cap 480 → 320**: on a 32-node acceptance map a single 200×200 image ate about a third of the height and forced the whole map down to 0.6–0.7 on fit; a real 1440×900 screenshot still measured 480×300 and two of them did not fit on one screen. Images with an **explicit size** (`![[img|2000]]`) are unaffected
* **Removing a colour now cleans up orphaned sentinels**: after a node's colour is withdrawn (its own directive deleted, or rewritten as `%%none%%`), descendants whose `%%none%%` existed **only to block that one source** no longer block anything, so they are deleted in a batch (inside the same undo snapshot) instead of leaving a stray comment line. **A branch recoloured further down is kept whole** — that sentinel blocks the new source, and deleting it would let its descendants pick up the colour

<h3>Fixed</h3>

* **Tab-indented notes are no longer flattened**
  * Symptom: a document indented with tabs lost its list hierarchy the moment it opened, and a fenced block inside an item was split into a sibling node; after saving, four branches sat one level off
  * Cause: list items measure indentation with `(\s*)` (a tab counts as 1), while continuation lines and fenced blocks counted spaces only (always 0 in a tab-indented file), so "continuation is indented deeper than the item" never held
  * Fix: continuation lines and fenced blocks now use the same ruler (space and tab each count as 1); frontmatter block scalars still count spaces only, and the two rules stay separately expressed
* **The indent unit follows the document, so editing one node no longer re-indents the whole file**
  * Symptom: in a note indented with tabs or four spaces, editing a single node's text and saving **rewrote the indentation of the entire file to two spaces** — a full-file diff in Git or a sync folder for nothing
  * Cause: serialisation hard-coded "two spaces per level" regardless of the source style
  * Fix: the parser measures "how wide one level is" (the leading whitespace of the first indented list line, stored **verbatim** as `mdIndentUnit` on the virtual root data — mixtures of spaces and tabs are copied as-is, not folded into a single tab) and serialisation emits that; when no unit can be measured (no nested list at all / a new file) it still falls back to two spaces
* **Resizing the window no longer freezes a large map several times a second**: at ≥1000 nodes the view switches to **trailing coalescing** — the timer is only reset during the drag, and one full resize runs 180 ms after you stop; small maps keep the 100 ms throttle (which stays responsive). Measured: one full `render()` of 5000 nodes is ≈0.4 s, and the old policy queued 5 rounds in a 1.2 s drag (1.58 s of long tasks, four frames over 50 ms). The cost is that the canvas keeps the old size during the drag (≤180 ms)
* **"Zoom to selection" now measures layout geometry**: performance mode removes off-screen nodes from the DOM, so the old DOM boxes came back empty for them and a large selection covered only its visible part, zooming to the wrong range; on top of that, per-node `getBoundingClientRect` meant N geometry queries in one synchronous block. Layout geometry (`left/top/width/height`) survives pruning, needs one transform, and includes off-screen nodes naturally
* **The minimap viewport box no longer forces a layout every frame**: the canvas size used to be read live with `getBoundingClientRect` on every update, while each update writes `style.left/top/…`, producing a write-style-then-read-rect thrash during pan and zoom. The size is now cached and refreshed on the engine's `resize` event, on capture and on `refresh` (falling back to a live read only when the cache is empty); the panel size still comes from the draw snapshot, because it must match the panel DOM
* **Dropping a file no longer allocates an array per event**: `dragover` fires around 60 times a second and `Array.from(types)` allocated each time; it now walks the `DOMStringList` by index

<h3>Engineering</h3>

* **Vendored patch 16** (`Base.js` + `MindMap.js` + `OrganizationStructure.js` + `CatalogOrganization.js`, consolidating `LogicalStructure.js`): patch 9's "record offsets, materialise once in O(n)" only covered the logical-structure layout; every other layout still shifted immediately every time (`updateChildren` recursively shifting sibling subtrees). A counting probe on a 10000-node `Mindmap` layout measured **88,103 calls** to `updateChildren` and **132 million node-shifts**, versus **0** for the same tree in logical structure; CDP sampling showed it taking ~99% of open time
  * The implementation moved into `Base` (`beginOffsets` / `recordTopOffset` / `recordLeftOffset` / `applyOffsets`, single- and dual-axis), and `LogicalStructure` now reuses it — no second copy
  * Measured: opening 10000 nodes **8.89 s → 0.32 s** (longest task 8.65 s → 170 ms), one edit **1.5–9.5 s → 131 ms**, re-layout of 5000 nodes across three layouts **2.1–2.6 s → 0.12–0.23 s**, longest auto-arrange task **2220 ms → 88 ms**; geometry A/B (six layouts × 800 nodes plus four layouts × 5000 nodes, per-node `_top` / `_left`) showed **zero difference**
* **Vendored patch 17** (`Timeline.js` / `Fishbone.js` / `fishboneUtils.js`): both layouts' `updateBrothersTop` recursion has the same shape — on 10000 nodes, **84,856 calls / 99.6 million node-shifts / 6.8 s per edit**. The difficulty is that the mirroring step reads absolute `top` inside the same task, so `Base.matTop` (summing along the ancestor chain, O(depth)) was added instead of moving `applyOffsets` earlier; the `left` axis still applies immediately
  * Measured: one re-layout of timeline / fishbone **7.3 s / 7.0 s → 37 ms / 36 ms**, one edit **6841 ms → 123 ms**; geometry A/B (eight scenarios: plain / custom position / summaries / collapsed × both layouts, 1000–1202 nodes) showed **zero difference**
* Bundle identity updated (`vendor/simple-mind-map.cjs`, 415,727 B, sha256 synced into `vendor/BUILD.md` and `tests/vendor-contract.test.ts`)
* `SavePipeline.schedule()` now returns **whether a round was actually scheduled** (nothing is scheduled with auto-save off or suspended), `SavePipelineDeps` gained `onSaved(file)` (called when a drain succeeds; conflict skips and write errors do not call it), and the status-bar service gained `showSaveState`, holding count and state in one renderer with de-duplication
* New: `engine/mindmap-nodes.branchLayerOf` (branch-layer detection), `engine/mindmap-viewport.measureNodesCanvasBox` (selection box), `domain/color.hexToHsl` / `hslToHex` / `orphanSentinels` / `scopeSentinels`, plus `hasBranchLayer` / `applyBranchColors` in `features/view-node-color`
* New setting `nodeColorScope` (`core/constants.NODE_COLOR_SCOPE_OPTIONS` plus the single test `isNodeOnlyColorScope`, factory value `subtree`); `MindmapEmbedConfig` gained `colorLine`, and `applyLiveColorDirectives` / `syncNodeColorDirectives` / `applyColorDirectivesToTree` pass it through
* Tests: new `tests/view-resize.test.ts` (both resize scheduling strategies and their mutual cancellation); full suite **103 files / 2836 cases**; gates `build` / `test` / `lint` / `lint:css` / `check:release` all green
* Docs: the `AGENTS.md` decision table was brought in line (palette rebuild and old-id compatibility, the fill-colour meaning and cost of node colours, the colour scope, the default border flip, save state in the status bar, the 320 px image cap); K97 / K128 in the standard doc and `docs/agents/conventions.md` were updated to match

<h3>Compatibility notes</h3>

* Requires Obsidian 1.13.0+, desktop only; `minAppVersion` **stays at 1.13.0**; no new third-party dependencies; **`styles.css` changed** (the read-only badge) — replace all three files (`main.js` / `manifest.json` / `styles.css`) together
* **`data.json` needs no hand editing**: old palette ids map to the new ones automatically, and unknown or dirty values still fall back to the default. New ids are only written when the user switches palettes explicitly
* **New setting "Color scope", default "With children"**: behaviour is exactly 0.3.1's; only switching to "Node only" writes `%%none%%` onto child lines (the directive already existed in older builds — after a rollback it still means "block the parent colour", but the connectors are tinted again)
* **The file format gains no element**: colour by branch writes the existing `%%#hex%%` comment directive, the node body gains no characters, and untouched lines still round-trip verbatim
* **The look changes — that is the point of this release**: the default border returns from borderless to bordered, type / padding / radii / connectors follow, and node directive colours now fill the node directly. Prefer the old look? Switch "Borderless" in the right-edge rail, or delete the node colour directives to fall back to the whole-map palette
* **Rolling back to 0.3.1**: no file is rewritten; but the new palette ids (`teal` / `blue` / `purple` / `crimson` / `orange` / `gold` / `green` / `grey` / `mist`) are unknown there and **fall back to the default palette** (reinstalling 0.3.2 restores them, since the file keeps the new id), and node colours are washed out again
* **Known limits**: a single-chain document has no branch layer, so "Colour by branch" is absent; that action **overwrites** existing directives on the branches (`Ctrl+Z` rolls it back as a whole) and leaves `%%none%%` markers in the subtree alone; a mid-dark fill across a branch leaves white text at only 3:1–6:1 (change the palette for more clarity); with "Color scope" set to "Node only", every direct child gains a `%%none%%` marker (cleaned up when the colour is withdrawn) and connectors no longer carry the node colour; while a large map is being resized the canvas keeps its old size for up to 180 ms
