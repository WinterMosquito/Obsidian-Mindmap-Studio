# 文件规模与豁免 · 批次流水

> 2026-10-26 自 `AGENTS.md` 迁出（Agent 工效批）：`AGENTS.md` 只保留「文件规模与豁免」的**终值表**与口径，历次实测读数 / 回填记录 / 理由流水**逐字**迁入本文件（未改动任何字句）。
>
> **新批次记录追加到本文件末尾**（沿用既有格式 `> **日期 批次名**：…`），不再写入 `AGENTS.md`——该文件每个会话整体进 Agent 上下文，只留结论、不留过程。
>
> 行数口径 = `tests/agents-md-sync.test.ts` 的 `countSourceLines`（按 `\n` 切分、末尾换行不计行）；对账与回填两表用 `npm run check:gates -- --fix-lines`。行数**终值**以 `AGENTS.md` 豁免表为准，本文件只是流水；冲突以终值表为准。

---

> **2026-10-27 清理批（死代码 / 注释 / 文档对账，节点配色批收尾）**：①**注释订正 8 处**：`engine/mindmap-colors` 的文字色算法（原写「三候选取对比度最大」，实为「首选柔和深灰蓝够 4.5 就用，否则纯黑/纯白取大」——取最大会把浅色节点全写成纯黑）；`domain/color` 的服务对象指向 `mindmap-palette.deriveCustomPalette`（原写 `mindmap-theme`），并补 `contrastTextColor`（自定义整篇配色三档）与 `nodeInkColor`（节点单色，含 4.5 达标线）**是两个判定、勿合并**；`core/constants.normalizePalette` 的渲染侧指向 `mindmap-palette.resolvePaletteTheme`，并补「新增配色还要加 `nodeColor.<id>` 的 ZH/EN 两条」（此前只写 `palette.<id>`，漏写会让节点菜单显示裸键名）；`engine/mindmap-theme` 的 `getThemeConfig` 脏值归一改述为「由 `mindmap-palette` 兜住」；`features/node-inline-html` 的「着色节点只改两处」实为三处（行内码 / 高亮 / 删除线）+ 文件头补「派生色经 `BuildContentParams.tones` 下传」；`node-inline-tokenize` 的 `MARKUP_RE` 第 1 条补「注释内容为三/六位十六进制时**同时**是配色指令」；`services/view-state` 的 `palette` 值域补自定义十六进制；`engine/mindmap.ts` 文件头子模块清单 8 → **16**（补 icons / viewport-canvas / arrange / minimap / theme / theme-presets / palette / colors），`export *` 注释补 minimap / colors。②**行为收敛（行首指令）**：`setColorDirective` 清除指令时优先带走**前一个**空白，行首没有前导空白则改带**后一个**——`%%#f00%% 标题` 此前会留下一个前导空格（写进文件即 `-  标题`），现为 `标题`；+1 例直测（`tests/color-directive.test.ts` 32 例）。③**惰性样式类收口**：`ui/modal-color` 的 `mindmap-color-invalid` 此前没有任何 CSS 规则（死钩子）→ `styles.css` 补 `color: var(--text-error)`，非法输入说明才真的显示为错误色。④**i18n 段落标题统一**：EN 段的 `Line style` / `Modal - custom colour` 改回中文标题（其余 40+ 段均为中文，只有早期两处例外）。⑤**文档对账**：`AGENTS.md` 的 K 区间 → **K1–K148**、决策表「需跨会话的视图状态」由「仅布局/视口」更正为「布局/连线/配色/边框 + 视口」（自 2026-10-21 起四项外观都按文件记，该行一直未改）；`conventions.md` **K145 ②/⑤ 与 K146 ③④ 自相矛盾**（K145 写「不覆盖边框色」「小地图仍按整篇配色」，K146 已改为「边框色同色」「小地图按节点配色」）→ 就地订正并注明被取代；`testing.md` 纯几何用例 66 → **69**；`docs/agents/README.md` 文档规模（architecture ≈480 → ≈500、conventions ≈1676 → ≈1700）；`baseline-metrics.md` 的 G-03 / S-05 / S-06 / S-07 / S-08 / S-09 / S-10 / P-01 / P-02 复测（**88 文件 / 2432 用例**、`view.ts` 1267 行 / 45 import、src 118 文件 34,319 行 / tests 90 文件 45,590 行、i18n 217/217、`main.js` **662,991 B** / gzip **197,417 B**、`styles.css` 24,223 B）。⑥两表按 `countSourceLines` 回填 **4 行**（同批执行 `--fix-lines`）：`engine/mindmap.ts` 666 → **676**、`core/constants.ts` 811 → **815**、`features/node-inline-tokenize.ts` 1192 → **1197**、`features/node-inline-html.ts` 879 → **882**；超限文件数仍 **33**（本批 5 个新文件最大 258 行，未越线）。

> **2026-10-26 批 6 清理批（门禁脚本：去第二份清单 + 直测）**：①**去第二份清单**：`main()` 原有一份硬编码的「跳过 …」五条（label + note 各写一遍），与 `buildPlan` 的 `conditionals` 重复——改门禁名或触发面要改两处。现在 `conditionals` 自带 `skipNote`，`buildPlan` 返回 `{ gates, skipped }`，main 只遍历打印。②**表行形态单一**：回填原另写一条字面正则，与 `EXEMPTION_ROW_RE` 重复；现在该正则带四个分组（前缀/路径/行数/尾），解析与回填共用 `$1…$4`。③**可选字段不混入执行面**：`plan()` 只挑 `{args,label,why}`，`--all` / 变更集不可读分支不再把 `match`/`skipNote` 带进 gates；`why` 统一为字符串（此前 baseline 是字符串、conditional 是函数，靠分支手工换形）。④**可测性**：导出 `buildPlan` / `parseExemptionRows`，`main()` 加「直接执行」守卫（`import.meta.url === pathToFileURL(realpathSync(argv[1]))`）；新增 `scripts/check-gates.d.mts`（最小声明）与 `tests/check-gates.test.ts`（**11** 例：baseline 顺序 / 五条触发面 / 不可读与 `--all` 全跑 / `skipped` 理由 / 行形态与 stale）。此前脚本**零测试**——映射错了只会让某道门禁静默不跑。⑤文档：AGENTS 的 tests 清单 88 → **89**（加 `check-gates.test.ts`）、校验链补「映射由该测试直测」；architecture 的 tests 段加一行；`process.md` 第 5 条同步。行数：`scripts/check-gates.mjs` 372 → **389**、`scripts/check-gates.d.mts` **40**（新）、`tests/check-gates.test.ts` **127**（新）。

> **2026-10-26 批 5 清理批（工具栏 / 样式：缺陷修复 + 死代码 + 文档对账）**：①**缺陷**：`createToggleRow.syncState` 回写 tooltip 时漏传 `placement`（`setTooltip(button, state.tooltip)`）——官方按**本次调用**决定展示位置，切过一次「边框 / 连线」后提示会从左侧跳回默认下方。已统一带 `HUD_TOOLTIP`，并新增 1 例锁死（`tests/mocks/obsidian.setTooltip` 改为「省略落位即清除旧值 ⇒ 漏传即红」，负向自检确认恰好该例失败）。②**死 CSS**（`styles.css` 净 −46 行 / −884 B）：四个 `*-select` 选择器（顶栏下拉已移除、源码零引用）、`.theme-dark .mindmap-toolbar` 的 `background`（`.mindmap-toolbar` 是穿透层 `inset:0`，暗色下会把整块画布盖成 `--background-secondary`）、两条与通用规则逐字重复的暗色按钮规则（其中 `:hover` 与组内 hover 同特异性、靠后出现而**压过** K143 的 `--interactive-hover`）、移动端 `.mindmap-tool-btn{width/height:28px}`（特异性低于 `.mindmap-hud-group .mindmap-tool-btn`，从未生效——改为注释登记，真缩需改组内规则）。③**注释**：`styles.css` 的「三块浮层 / 三块子容器 / 层级高于三块 HUD」改为现状（只剩右缘竖栏一组）。④**文档**：AGENTS「右缘竖栏的卡片 / 分隔线样式」与 `architecture.md` 的 view-toolbar 行补「落位在构建与状态回写两处都要带」；K143 补④（批 5 补充）与新增⑤（残留清理清单）。行数（工作区相对 HEAD）：`features/view-toolbar.ts` 256 → **270**、`tests/view-toolbar.test.ts` 593 → **627**、`styles.css` 615 → **652**（23,639 B）。

> **2026-10-26 批 4 清理批（剪贴板：注释 / 文档对账）**：①注释订正三处：`engine/mindmap-clipboard.collectSelectedSubtrees` 的「空结果交调用方走既有提示」已过时——2026-10-26 起 `copySelectedNodes` 把空结果当「无选中」**回退整图**、不再提示；`features/view-clipboard.copySelectedNodes` 补明「**只选中根**时根被过滤后集合为空，同样落整图分支（复制根 = 复制整图）」；`pasteFromClipboardEvent` 的「让位两种情形」补第三类「剪贴板无文本（图片粘贴等，提前返回）」。②测试标题同步：`engine-subtree-clipboard.test.ts` 的「只选中根节点 ⇒ 空结果（不写剪贴板；调用方走既有提示）」→「（调用方按『无选中』回退整图）」。③文档对账：`architecture.md` 的 `mindmap-clipboard.ts` 行仍写「剥 uid」（该优化 A 已删除 `cloneSubtreeWithoutUid`）→ 改为「返回引擎树上的只读 `nodeData`、不克隆不剥 uid」；AGENTS「无选中的复制」行与 conventions K142 ② 补「只选中根也落整图分支」。④`cutSelectedSubtrees` 补明「回调是**同步**的（vendor `Render.cutNode` 末尾直接 `callback(copyData)`），`captured` 在 `execCommand` 返回时已填好；引擎若改异步回调，本函数必须改 Promise，否则静默返回空数组」。行数：`engine/mindmap-clipboard.ts` 168 → **175**、`features/view-clipboard.ts` 214 → **217**（均未超 300，豁免表无变化）。

> **2026-10-26 批 3 清理批（滚轮手势：注释 / 代码收敛 / 文档对账）**：①`features/view-viewport.ts` 的 `tickSmoothPan` 把「剩余量不足 epsilon 就一次补完 + 单帧限幅」在两轴各写一遍收敛为局部 `stepOf`（同一套口径只留一份）。②注释订正三处：文件头「中键监听在容器上、冒泡晚于引擎 `el`」与实际不符（实为挂在**画布自身**、注册晚于引擎 ⇒ 排在引擎之后）；`WHEEL_SMOOTH_STALL_LIMIT` 原写「同一帧连续调用 `panMindMap` 的停顿判定」，实为「**连续帧**走不动（引擎夹住）即弃剩余量」；`WHEEL_SMOOTH_MIN_DELTA` 的「不另做触控板判定」引用 K138 → K144（K138 讲 Alt 横轴，K144 才是平滑）。③让位项注释补「触控板纯横向滑动的 `deltaY ≈ 0` 也落进小 delta 分支交引擎」，与 AGENTS/K138 的「纯横向 delta 交引擎」对上。④`SmoothPanState.y` 补符号说明（正 y = 内容下移）；AGENTS 滚轮行把「`mousedown` 与缩放会取消未走完的平滑」补全为「`mousedown`、`Ctrl/Cmd` 缩放与**引擎重建**」。两表按 `countSourceLines` 回填：`features/view-viewport.ts` 409 → **413**。

> **2026-10-26 批 1 清理批（默认边框：死代码 / 注释 / 文档对账）**：①类型收紧：`ThemeStylePreset` 取消 `export`（无外部消费者）、`ThemeNodeOverride` 删除从未被赋值/读取的 `borderColor` 键——「不描边」只由 `borderWidth: 0` 表达，描边色必须留色板真色（小地图墨色），现在由**类型层面**禁止覆盖。②注释订正：`services/view-state.getThemeStyle` 的「未设置时回落 `DEFAULT_THEME_STYLE`」与实现不符（返回 `undefined`，缺省值由 `resolveFilePreferences` 取 `settings.defaultThemeStyle`——写死常量正是 K127 ⑨ 的实机缺陷）；`BORDERLESS_NODE` 的 `Object.freeze` 说明改为「两级共用一份浅冻结声明，要差异须新建对象」；预设条目注释与实现对齐（`default` ＝有边框、**不是**出厂默认）；术语「主题 → 边框」统一（`constants` / `mindmap` / `view` / `view-state` / 测试）。③文档：AGENTS 边框行（右缘竖栏、预设键面、新增一套口径）、README 双语功能段补「新建默认无边框」、`i18n` 设置项描述补「存量不受影响」（中英）；两表同批回填 `core/constants.ts` 784 → **790**、`settings.ts` 553 → **555**、`engine/mindmap.ts` 627 → **628**。

> **2026-10-26 批 2 清理批（小地图：死代码 / 注释 / 文档对账）**：①`core/minimap-geometry.ts` 收敛重复：新增 `extentOf` 取代 6 处 `Math.min/max(...kids.map(…))`（星形布局一级可达数千，展开成实参表既慢又有上限风险）；新增 `pushVerticalRail` 合并目录组织图深层与时间轴深层的「竖轨 + 横档」（两处只有轨道 x 算法不同）；`UNKNOWN_DEPTH` 统一「未知深度」三处判定（过滤 / 分档 / tier，此前各写 `99` / `2`）；SVG 兜底色改引 `MINIMAP_FALLBACK_COLORS.background`（删第二份 `#888888` 字面量）。②注释订正：`MiniMapCadence` 补齐 `enabled/ready/visible/dirty` 字段说明、`computeMiniMapSize` 补「默认 280 只服务裸调用」的口径、`MiniMapMarksResult.total` 的旧词「全画 / 骨干」→「≤ 阈值全画 / > 阈值只画前 7 层」、`MiniMapLink.tier` 说明补「根」、`root` 字段补消费面、`nextMiniMapDeadline` 的 `!ready` 重试入口写全（渲染落地**或**用户动图）。③`engine/mindmap-minimap.ts`：文件头「只做三件事」实列四件，改为四件事；`resolveLinkMode` 参数类型收紧为 `MiniMapMeasure`。④`features/view-minimap.ts`：`drawWhenLanded` 的「这是用户动作的落地时刻」与 K137「渲染落地不算用户手势」自相矛盾，改为「只在原本可见时续期」。⑤文档：`architecture.md` 目录树 `minimap-geometry` 列举八项却写「六者」→「八者」；`tests/minimap-geometry.test.ts` 补两条 tier 断言（目录/时间轴的轨道恒为浅色，锁定 `pushVerticalRail` 的 tier 语义）。两表按 `countSourceLines` 回填：`core/minimap-geometry.ts` 1351 → **1413**、`features/view-minimap.ts` 771 → **772**。

> **2026-10-26 第四清理批（死代码 / 注释 / 文档对账）**：①`features/view-minimap.ts` 的 `MiniMapContext` 去掉无人读的 `'lang'`（面板无文案、无提示，取语言进来是空依赖）；②`engine/mindmap-clipboard.rankByDocumentOrder` 改走防腐面 `getRenderRoot`（原先直读 `mindMap.renderer.root`，与同批的两级判空修正分了家）；③`features/view-viewport.ts` 把同值同源的 `WHEEL_HORIZONTAL_STEP` / `WHEEL_PAN_STEP` 合并为 `WHEEL_NOTCH_STEP_PX`（改引擎 `mousewheelMoveStep` 时不必再记得改两处）；④注释订正三处：`view-clipboard` 的「三条裁决」实为四条、`mindmap-clipboard` 的「剥激活态」与下文「不碰激活态」自相矛盾、`polyline` 形态下 `from`/`to` 只是首末顶点镜像（`minimap-geometry`）；⑤文档对账：K 区间（`AGENTS.md` 与 `conventions.md` 标题）→ **K1–K144**、`conventions.md` K26c「插件只做两件事」补到四件（Alt 横轴 K138 / 滚轮平滑 K144）、K144 用例数 27 → **28**、K6 用例数 21 → **22**（存量漏更）、`testing.md` 的 21 → **22** 与「见下方」→「见本文件前段」、`architecture.md` 测试清单补 `minimap-geometry.test.ts` / `engine-minimap-capture.test.ts` 两行、`baseline-metrics.md` 的 G-03 / S-05 / S-06 / S-09 / P-01 / P-02 复测、`docs/agents/README.md` 的两处文档规模；⑥**补登记** `features/view-viewport.ts`（409 行——2026-10-26 滚轮接管后越线却漏登，硬规则 10 的「未登记超限文件数只允许递减」因此从 0 变 1 又被压回 0）⇒ 超限文件数 **32 → 33**。本批按 `countSourceLines` 全表复测，**4 行回填**：`engine/mindmap.ts` 625 → **627**、`core/minimap-geometry.ts` 1302 → **1351**、`core/i18n.ts` 613 → **607**（删 `minimap.label` 时未回填）、`features/view-minimap.ts` 756 → **771**。
>
> **2026-10-26 审核修复批（会话副作用收尾，K137）**：①`onUnloadFile` 在 `await savePipeline.save(...)` **之前**补 `teardownMiniMap`——放在 await 之后的 `destroyInstance()` 旁会误拆新会话，漏掉则旧面板跨文件残留（加载失败路径无人收尾）；②小地图唤醒按「用户手势 / 渲染落地」分流：`noteChange` 只在面板可见时 `wake`、`resize` 显式 `wake`、`drawWhenLanded` 淡出态只换图不 `show`（后台重渲染不得让刚淡出的缩略图复活）。两表按 `countSourceLines` 复测 **2 行回填**：`features/view-minimap.ts` 730 → **756**、`features/view.ts` 1249 → **1254**。
>
> **2026-10-25 第三清理批（死代码 / 注释 / 文档对账）**：`core/minimap-geometry.ts` 删除无人消费的 `MiniMapMeasure.firstLevel`（全量一级节点计数：算了、传了，生产侧没有任何读取方），并订正三处与实现不符的注释（`contentExceedsCanvas` 的「rbox 容差」、`MiniMapMark.parent` 的「画线区间不抽样 ⇒ 父必在」、`buildMiniMapSvg` 里旧的「按两盒相对位置猜主轴」叙述）；`features/drag-session.ts` 的「仅剩一个调用方」改为两个——小地图拖拽是 `capture: false` 的第一个真实用例（此前只有图像调宽传 `true`）。本批按 `countSourceLines` 全表复测，**4 行回填**（两表同批）：`core/minimap-geometry.ts` 1301 → **1302**（删字段 −6 行、注释订正 +7 行）、`core/constants.ts` 763 → **784**、`engine/mindmap-viewport.ts` 936 → **939**、`settings.ts` 552 → **553**（后两行与 `constants` 是上一批只改叙述、未回填表格的存量漂移）。
>
> **2026-10-24/25 实测**：超限文件数 **32**。F12-M 小地图批新增两条**已登记**：`src/core/minimap-geometry.ts`（纯几何/绘制模型：全量包围盒 + 帧等价判定 + 按布局五态的连线几何）、`src/features/view-minimap.ts`（浮层状态机与 DOM：`drawAfterRender` 补画点 + 百分比视口框 + 会话测试）；既有文件随本批增长：`src/engine/mindmap-viewport.ts`（新增「内容原尺寸」与「100% 下是否装不下」两出口，并把 `measureContentFitToWidth` 的原尺寸口径收敛）、`src/core/constants.ts`（小地图常量段）、`src/engine/mindmap-nodes.ts`（`getRenderRoot` 两级判空）。两个新文件都是**单一关注点**（纯几何/绘制模型；浮层状态机与 DOM），拆开会把同一套「内容盒 → 面板坐标」换算与 30s 节拍判定摊到跨文件。当日内多轮迭代（四轮修 + 连线五态复刻 + 清理批）后**终值以下方豁免表为准**，中间轮次读数不再留档。
>
> **2026-10-23 实测**：超限文件数 **30**（此前文字记 28）。两行为本批新增并**已登记**：`features/view-context-menu.ts` 380 行（布局/配色改官方级联菜单后超线）、`markdown/md-open.ts` 303 行（语言切换迁移补值守卫后越线）。口径仍为 `countSourceLines`；`npx vitest run tests/agents-md-sync.test.ts` 4 passed 且无漂移告警——注意该用例只守「登记值 vs 实测」的漂移阈值，**不校验超限文件总数**，故计数差不会转红，只能靠人工对账。

> **2026-10-21 全表复测（第二批·配色维度）**：28 行再逐行重测，**7 行**回填（`core/constants.ts` 635 → 678、`core/i18n.ts` 576 → 593、`settings.ts` 528 → 554、`engine/mindmap.ts` 746 → 759、`services/engine-controller.ts` 818 → 822、`features/view.ts` 1149 → 1155、`features/mindmap-codeblock.ts` 553 → 558），两表同批复验 0 差异。

> **2026-10-21 全表复测**：28 行按 `countSourceLines` 逐行重测并按实测回填（与 `docs/agents/architecture.md` 同表同步；超限文件数 28）。本轮共 **16 处**校准（本表 9 处 + 架构详录 7 处），其中 8 行系「节点外观主题」批次增大，1 行（`features/view-node-actions.ts` 882 → 862）系存量陈旧值纠正。以下为历次刷新记录。

> 行数基准 2026-10-04（**2026-10-09 复测刷新了 8 行**：`engine/mindmap.ts` / `core/i18n.ts` /
> `core/constants.ts` / `settings.ts` / `features/view.ts` / `features/node-inline-content.ts` /
> `services/engine-controller.ts` / `main.ts`——全部为减法批次〔K117〕的读数；**2026-10-11 又刷新 3 行**
> （`engine/mindmap.ts` 2143 → 2012、`core/constants.ts` 501 → 494、`features/view.ts` 1252 → 1249，
> 系移除拖拽换父辅助〔含引擎落点判定防腐面与识别域常量〕的减法读数；**2026-10-11 再刷新 2 行**：
> `node-inline-content.ts` 1428 → 1430、`main.ts` 352 → 353，系门禁修复批的注释订正；**同日第三次刷新**：
> `features/view.ts` 1249 → 1086，系数学校准会话外置为 `features/content-remeasure.ts`（R3 批））；其余条目仍是 10-04 读数，
> 另 2026-10-08 复测过 `image-resize.ts` 一行）；**唯一口径** = `tests/agents-md-sync.test.ts` 的 countSourceLines
>（按 `\n` 切分、末尾换行不计行）。**不要**用 PowerShell 的 Measure-Object -Line——
> 口径不同会使登记值与实测对不上。**2026-10-13 刷新 3 行**（`core/i18n.ts` 494 → 510、
> `features/view-node-actions.ts` 756 → 758、`features/view-dnd.ts` 584 → 599，系「图片建节点入口
> 收口到 `view-image-actions.createImageChildNode` + 未选中节点时图片（粘贴／系统拖入／库内拖入）
> 贴入导图」批的读数）。**2026-10-13 第二批**（```mindmap 代码块只读嵌入，含当日的「形态对齐
> Mermaid」追加）刷新 6 行：`engine/mindmap.ts` 2023 → 2177（`readonly` / `enableViewDrag` 两个
> 引擎原生通道 + `applyThemeConfig` / `resizeMindMap` / `measureContentFitToWidth` /
> `centerContentAtScale` 四个防腐入口）、`main.ts` 353 → 426（`registerMarkdownCodeBlockProcessor`
> 注册与窄化装配）、`core/i18n.ts` 510 → 525（嵌入 4 条文案）、`core/constants.ts` 494 → 501
> （`CODE_BLOCK_LANGUAGE` / `CODE_BLOCK_MAX_NODES`）；同批两处**减法**读数：`features/view.ts`
> 1086 → 1047（自绘内容装配外置为 `features/node-content-factory.ts`）、
> `services/engine-controller.ts` 783 → 780（主题写入与 resize 改走防腐入口）。
> 新增豁免条目：`features/mindmap-codeblock.ts`（476 行）。
> **2026-10-13 第三批**（自查修复 + 冗余收敛）刷新 2 行：`engine/mindmap.ts` 2177 → 2178
> （`measureContentFitToWidth` 不再回吐无人消费的输入宽度）、`features/mindmap-codeblock.ts`
> 476 → 510（观察器改为**先建且常驻**：首帧同步挂载成功也注册 ⇒ 容器变窄/变宽按新宽度重排，
> 失败终态摘观察器；**并**把「重建布局 + 重算高度」推到下一帧（`deferFit`）——在 RO 回调里
> 同步写高度会让 Chrome 记 `ResizeObserver loop completed with undelivered notifications`，
> 实机 `obsidian dev:errors` 每个尺寸变化各一条，实测已消除）。
> **2026-10-13 第四批**（系统性优化：潜在错误修复 + 重复逻辑收口 + 冗余清理）刷新 7 行：
> `core/i18n.ts` 525 → 529（订正与实现不符的「EN 缺失回退 ZH」说明、删除 `EN[key] ?? ZH[key]`
> 死分支、`rename.titleFailed` 补提示分隔符）、`features/view.ts` 1047 → 1046（编辑态判据收敛到
> `isAnyNodeEditing`）、`platform/math-jax.ts` 919 → 904（删被顶替的孤立 JSDoc〔与
> `stripFontFaceRules` 文档逐字重复〕、删同值别名 `MATH_CONTAINER_CLASS`、字符规则读取失败改走
> `createWarnOnce`）、`media/images-path.ts` 633 → 637（订正 `isExternalUrl` 与实现自相矛盾的
> 文档注释）、`links/links-tree.ts` 470 → 452 与 `links/links-resolve.ts` 351 → 353
> （「原样 + 解码」候选构造收口到 `domain/url.urlComparisonForms`；`resolveDroppedFile` 的全库
> `getFiles()` 下沉到真正使用的分支）、`markdown/md-serialize.ts` 1189 → 1191
> （`serializeMdBody` 内 `nodeLines` 去掉遮蔽外层入参的冗余 `app` 形参）。
> **2026-10-13 第五批**（剪贴板改建：系统剪贴板 + Markdown 文本；`Ctrl+C/X/V`
> 经 `beforeShortcutRun` 从引擎的内部 JSON 剪贴板收回）刷新 7 行：
> `src/engine/mindmap.ts` 2178 → 2356（命令白名单补 `CUT_NODE` /
> `INSERT_MULTI_CHILD_NODE`、`CreateMindMapOptions.beforeShortcutRun` 透传，
> 复制/剪切/粘贴三个防腐出入口 `collectSelectedSubtrees` / `cutSelectedSubtrees` /
> `insertSubtreesAsChildren` 与「文档序排名」「剥 uid 深拷贝」两个私有工具）、
> `src/features/view-node-actions.ts` 758 → 735（**减法**：视图级 WeakMap 剪贴板
> 与 `copyNode` / `pasteNodeAsChild` 整体删除，第二份剪贴板不复存在）、
> `src/markdown/md-serialize.ts` 1191 → 1229（`serializeMdBody` 抽出共用 walker，
> 新增剪贴板形态入口 `serializeSubtreesToOutline`）、
> `src/markdown/md-outline.ts` 1108 → 1145（新增 `parseMdOutlineFragment`：
> 标题不论几级 → 无序节点、有序项保留）、`src/services/engine-controller.ts`
> 780 → 797（`deps.beforeShortcutRun` 注入口）、`src/features/view.ts` 1046 → 1051、
> `src/core/i18n.ts` 529 → 530（`common.nodeCopied` 文案改为「复制」）。
> 本批新增文件均在 300 行阈值内（`features/view-clipboard.ts` 200、
> `platform/clipboard.ts` 41），故豁免表无新增条目。
> **2026-10-14 第六批**（**可见性自愈**：数学/代码内容节点在隐藏叶子里被量测为
> 0×0 后不再永久塌陷）刷新 3 行并新增 1 条：`src/engine/mindmap.ts` 2356 → 2373
> （新增零尺寸判定防腐入口 `isNodeCollapsed`）、`src/features/view.ts`
> 1051 → 1068（会话注入 `isVisible`；`onResize` 与 `active-leaf-change` 两处
> 可见性采样）、`src/features/mindmap-codeblock.ts` 510 → 517（同一注入 +
> `deferFit` 帧回调里自愈）。新增豁免条目 `src/features/content-remeasure.ts`
> （400 行）：跨过 300 行阈值，理由见下表。
> **2026-10-14 第七批**（切模式「双 canvas」实机归属分析的收口，刷新 1 行）：
> `src/features/mindmap-codeblock.ts` 517 → 524（`onunload` **卸载即清 DOM**——
> 切模式时 Obsidian 保留另一套视图子树（隐藏的 `.cm-editor` /
> `.markdown-preview-view`），已卸载实例的 `.tmm-embed-canvas` 骨架会让文档级
> 计数出现「空壳」第二份；同批 `verify:visual` 嵌入探针新增契约 ⑤ 钉住）。
> **2026-10-14 第八批**（**新建导图保存位置**：学 Obsidian Canvas 的四档设置——
> `obsidian`〔默认，经官方 `FileManager.getNewFileParent` 完整跟随「新建笔记的默认位置」，
> 顺带修掉此前 sourcePath 恒为空串⇒「当前文件夹」永不生效的缺陷〕/ `root` / `current` /
> `folder`，后三档与 Canvas 同口径；`current` 与 `folder` 不可解析时静默回落库根，
> 对齐 Canvas 的「不自动创建文件夹」）刷新 4 行：`src/settings.ts` 421 → 475
> （`saveLocation` / `saveFolder` 两键的「接口 → 默认值 → sanitize → 面板项」闭环，
> 含 1.13 声明式 `type: 'folder'` 控件与 `visible` 条件项）、`src/core/i18n.ts` 530 → 552 与
> `src/core/constants.ts` 501 → 529（双语词条 9 条 + `SaveLocation` 类型与
> `SAVE_LOCATION_OPTIONS` 选项表）、`src/main.ts` 426 → 422（文件夹右键调用点改传
> settings，**减法**读数）。`src/creation.ts` 157 行（未超阈值）：`resolveNewMindMapFolder`
> 四档解析 + `folderPathOf` 把库根 `'/'` 归一为空串（消除对 `normalizePath` 剥离前导
> 斜杠这一未承诺行为的依赖）；`src/commands.ts` 237 行（未超阈值）。
> **2026-10-14 第九批**（**节点上/下移**：节点右键菜单新增「上移节点 / 下移节点」——
> 引擎既有的 `UP_NODE` / `DOWN_NODE` 命令经白名单放出，与相邻兄弟交换后自动
> `addHistory` + `data_change`（回写 Markdown 与 Ctrl+Z 撤销都走既有链路，
> 动作层不调度保存））刷新 3 行：`src/engine/mindmap.ts` 2373 → 2383（命令白名单
> 补两项）、`src/features/view-node-actions.ts` 735 → 836（`moveNodeUp` /
> `moveNodeDown` 出口：显式节点入参 + 中心节点/首末位可见提示）、
> `src/core/i18n.ts` 552 → 563（双语词条 5 条）。**同日重构**（自查）：兄弟顺序
> 判定与清自由拖拽坐标属引擎内部形态，已从 `features/view-node-actions.ts`
> 下沉为防腐入口 `moveNodeInSiblings`（`src/engine/mindmap.ts` 2383 → 2453），
> 视图层只留「结果 → 提示」映射；新增直测 `tests/engine-node-move.test.ts`
> （7 例，vendor 以桩替代）；两文件读数相应刷新为
> `view-node-actions.ts` 836 → 788。
> **2026-10-14 第十批**（**数学公式「永久字面」缺陷修复**，实机排查 + 取证）：
> 缺陷链——字体未就绪时构建 → 节点随剪枝摘除（出视口）→ 异步替换的挂载等待
> 预算耗尽被放弃 → 字体就绪的既有重建只覆盖「已定稿（有产物）节点」→ 节点
> 重进视口时引擎复用旧 group 与内容、不重建 ⇒ 字面 `$…$` 永久留在屏上（500
> 节点导图实机复现：15 个节点平移往返后仍为字面，且无任何路径自愈）。修复 =
> `platform/math-jax` 新增**未定稿登记面**（`unsettledMath`：渲染入口登记、
> 定稿即注销、放弃保留）+ 症状修复 `repairUnsettledMath`（缓存命中**同步**
> 修复〔不依赖挂载，出视口节点就地修好〕／未命中且已挂载且无在途才重新入队）
> 与 `clearUnsettledMath`（视图销毁按画布根清理）/ `pruneDetachedUnsettledMath`
> （引擎换代**只清「已脱离文档」**——换代与首次渲染可能交叠，「root 内全清」会
> 误清新登记的 holder、字面从此无人修，实机抓出）；触发挂在两个既有钩子上
> （`node_tree_render_end` / `loadingdone`，**修复本身不做可见性守卫**——热路径
> 不得依赖 `isShown()` 这类宿主面缺口，探针抓出），会话层经**新增**的
> `ContentRemeasureHost.getContentRoot`（画布根，
> 文件视图与代码块嵌入各自注入）。刷新 5 行：`src/platform/math-jax.ts`
> 904 → 1031、`src/features/content-remeasure.ts` 400 → 472、
> `src/features/node-inline-content.ts` 1442 → 1444（占位串改走单一来源）、
> `src/features/view.ts` 1068 → 1071、`src/features/mindmap-codeblock.ts`
> 524 → 527（各注入 `getContentRoot`）。**新增** `src/core/math-placeholder.ts`
> （27 行，未超阈值）：`formatMathPlaceholder` 是占位串形态的唯一来源（构建
> 与撤回两处此前各写一份字面模板，两处断链即「撤回后与构建形态不一致」）。
> 改动任一豁免文件后若 agents-md-sync 转红，必须回来更新本表的行数列。
>
> **2026-10-14 第十一批**（**懒加载区数学公式「永久字面」修复**：第十批的
> `pruneDetachedUnsettledMath` 口径在实机定案中仍不成立，改为**按引擎归属清理**）：
> 实机取证链（500 节点图、公式缓存冷）——预测量构建的 holder **本体从不挂载**
> （vendor 补丁 5 A2 明文「元素本体不挂载、不测量」），而 `onEngineReady` →
> `resetNodes` 跑在**首帧渲染之前** ⇒ 按 `!isConnected` 清会把新引擎**全部懒加载
> 段**从登记面误删；泵预算（200×16ms≈3.2s）耗尽后节点进视口时 `repairUnsettledMath`
> 无事可做 ⇒ 字面永久（探针实测：推进视口 13s+ 不恢复、`dev:errors` 干净、手动
> `reRender` 立即**同步**放产物 ⇒ 缓存/渲染正常、只缺触发通道；重开后 3.2s 内推进
> 则正常定稿——失效只在预算耗尽后）。修复 = 登记面条目携带 **owner（引擎实例，
> 不透明 token）**：`renderMathWithMathJax` 第 5 参由 `createMindMap` 注入并沿构建链
> 透传（`node-inline-content` → `node-content-factory` → `view` / `mindmap-codeblock`
> → `engine-controller`）；**新增** `pruneUnsettledMathOwnedBy(owner)` 取代
> `pruneDetachedUnsettledMath`（按身份精确清），清理时机移到**引擎销毁点**
> （`engine-controller.destroyInstance` 经新 deps 回调 `onEngineDisposed` →
> `content-remeasure.forgetEngine`）；`resetNodes` **不动登记面**（它跑在首帧前，
> 正是误清高危时刻）。实机回归：同一探针连续 5 轮推进视口 `onLit` 恒 0、`settled`
> 逐轮增长（19→57→76→95→114→133）；用户 500/1000 节点性能图与**多视图隔离**
> （leaf2 引擎创建 + 销毁后 leaf1 的未定稿段照常修复）全部通过。刷新 7 行：
> `src/platform/math-jax.ts` 1031 → 1062、`src/features/content-remeasure.ts`
> 472 → 492、`src/engine/mindmap.ts` 2453 → 2468、`src/services/engine-controller.ts`
> 797 → 819、`src/features/view.ts` 1071 → 1079、`src/features/mindmap-codeblock.ts`
> 527 → 535、`src/features/node-inline-content.ts` 1444 → 1463（构建链透传 owner）。
> **2026-10-14 第十二批**（**系统性优化：潜在错误修复 + 判定收口 + 文档与实现对齐**）：
> ① **自愈拍竞态**（`content-remeasure.recoverHidden`）——采样到「可见」与自愈拍
> 到期之间宿主可能又被切走（快速切标签 / 正在关闭的叶子）：原来照做会**在隐藏态
> 写 0×0** 并顺手清掉 `wasHidden` ⇒ 该叶子此后不再自愈、节点永久塌陷。补可见性
> 守卫（与其余三条路径同一纪律）并新增直测钉住「拍到期前又隐藏」的时序。
> ② **清理口径回到归属**（`math-jax.clearUnsettledMath`）——原「root 内 + 已脱离
> 文档（`!isConnected`）」的判定与第十一批否决的判据同族：多视图 / 嵌入并存时，
> 关闭 A 视图会把 **B 视图**预测量构建的、**本体从不挂载**的懒加载段一并清掉
> （正是刚修完的「永久字面」缺陷）。去掉该分支，只清 `root.contains`；root 外的
> 残留由紧随的引擎销毁按归属清（两个宿主均为 `dispose()` → `destroyInstance()`，
> 无残留窗口），测试改为钉住「另一宿主销毁不得动本段」。
> ③ **第三份「输入类目标」判定收口**（`view-paste.handleWindowPaste` 原来自己
> `instanceof HTMLInputElement || HTMLTextAreaElement`）——改走
> `view-common.isTextEntryTarget`（快捷键 / 剪贴板已用），顺带修掉窗口兜底路径
> 把 **contenteditable**（焦点在别处编辑区）的粘贴劫持进导图的缺陷；测试按取形
> （`tagName` / `isContentEditable`）构造目标，不再需要 DOM 类全局桩。
> ④ **裸布尔语义化**（`view-clipboard.writeOutline` 的 `announce` → `noticeKey  
> null`）：调用点自明「复制提示 vs 剪切静默」。
> ⑤ **文档与实现对齐**：`repairUnsettled` 的「探针页没有 `isShown()`」论证订正
> （探针页**已有垫片**，理由改回「热路径不得依赖宿主面缺口」）、`verify-visual`
> 垫片注释点明真正的调用方（会话四条可见性守卫 + 嵌入注入）、`clearUnsettledMath`
> 契约在 math-jax 文件头 / content-remeasure ⑤ / 测试头三处同步；
> `tests/content-remeasure.test.ts` 的 ⑤ 段落**缩进重排**（114 行纯空白：此前整块
> 与 ④ 的 `it` 同级、`it` 体与 `it` 头同级）。
> 刷新 2 行（第十一批只改了叙述、**漏改表格单元**，本批一并补齐）：
> `src/features/content-remeasure.ts` 472 → 502、`src/platform/math-jax.ts`
> 1062 → 1065；`src/features/view-clipboard.ts` 200、`src/features/view-paste.ts`
> 114 均在 300 行阈值内，豁免表无新增条目。
> **2026-10-14 第十三批**（**GFM 管道表在节点内渲染为真表格**）：此前的表格行在
> 解析层就并入 plain 多行节点（`mdType: 'plain'`），显示层只按一个含 `\n` 的文本
> 节点折行 ⇒ 节点里永远是一串裸 `|`。本批在**渲染侧**补一条块级通道：纯逻辑识别
> 落在新模块 `domain/pipe-table.ts`（表头行 + 分隔行成对才成立；分隔行必含未转义
> `|` ⇒ setext `标题\n---` 与 `---` 分隔线天然排除；`\|` 还原为字面 `|`；列数不足
> 补空、超出截断），装配落在 `node-inline-content.buildTableElement`（`table >
> thead/tbody`，结构/边框/内边距/表头底色/列对齐**全内联**——导出 SVG 不含
> `styles.css` 与 `app.css`）。三条纪律：① 表格段**要么整张显示、要么整张不显示**
> （半张表比不显示更糟，沿用链接段的截断口径）；② 表宽以内容盒为顶（`max-width:
> 100%` + 单元格折行）——用户裁决「不允许表格超宽撑爆节点」，**不设高度上限**；
> ③ 边界换行归表格段（段序列 `text` 拼接 = 原文 ⇒ 编辑弹窗预览里表格独占行）。
> 围栏代码块与块级数学**内**的表格行、缩进代码行不识别（保护区复用 `MARKUP_RE`）。
> 官方口径实测：`resources/*.asar` 里**没有** `th { text-align }` 与阅读视图的
> `border-collapse` 规则 ⇒ 未指定对齐的列**不写** `text-align`（与阅读视图同走
> 宿主默认），`border-collapse: collapse` 与表头底色是本插件的画布取舍（已在代码
> 注释登记理由）。刷新 1 行：`src/features/node-inline-content.ts` 1463 → 1774
> （块扫描 + 表格装配 + 三张样式表 + 文件头/契约注释）；**新增**两条登记：
> `src/domain/pipe-table.ts` 190、`tests/pipe-table.test.ts` 132（均在 300 行阈值内，
> 豁免表无新增条目）。门禁：`pipe-table` 17 例 + `node-inline-content` 新增 9 例
> （1 例契约定名从「仅两种 kind」更新为三种）；`verify:visual` 新增 `table` 场景
> （`th/td` 文本、`tr` 数、计算出的边框/内边距/对齐、表宽不溢出内容盒）与导出
> 产物断言（`<table>` + 单元格内联边框/内边距 + `text-align: right` 落进 SVG）。
> **2026-10-14 第十四批**（**视口几何落地：修「适应画布 → 重置缩放」在性能模式
> 大图上的偏移**）：实机症状（用户报告）：>500 节点（性能模式）导图，「适应画布」
> 后「重置缩放」，视图偏右。根因（实机 + 无头双侧实证）：vendor 的
> `Renderer.render()` 只做 `setTimeout(() => this._render(), 0)` 编排，且
> `_render()` 内 `layout.doLayout(callback)` 的回调是**异步**触发的（无头探针
> 实测：`_render()` 返回后 `renderer.root` 仍为 null）；而 `MindMap.resize()`
> 在「尺寸变化」分支只调这一次 `render()`。于是存在窗口：
> `mindMap.width/height` 已是实时容器尺寸、渲染树 left/top 仍是旧尺寸基准——
> 性能模式的数据层居中/fit 在该窗口内测量＝旧布局中心，而目标画布中心是新值
> ⇒ 平移残差 (W新−W旧)/2（屏幕上被 ×scale 压小、肉眼难辨）；`resetZoom` 随即
> 按 1/scale 缩放回 100%，把残差**放大回屏幕**（实机 scale 0.0699 ⇒ 14.3 倍）。
> 实机实测三条：① 新建视图打开 500 节点图，默认视口即偏 15.91px（tx −887.74，
> 正确值 −871.83）；② 错配注入（基准 1050 / 实时 1357.33）复现用户链路——
> fit 后偏 10.75px（=Δ×scale），reset 后偏 153.67px（=Δ = 宽度变化的一半）；
> ③ 稳定容器下 3 轮 fit→reset 残差 ≡1e-13（修复不得改变名义行为）。
> 修法：① `syncCanvasGeometry` 改为返回「尺寸是否变化」，变化时
> `flushPendingLayoutRender` 把 `resize()` 编排的渲染**提前启动**（取消待跑
> 编排 + 直接调 `_render()`；**零额外渲染**——那次渲染本来就会跑），并让调用方
> 登记「渲染落地后居中补正」`scheduleCenteringCorrection`（`node_tree_render_end`
> 后执行 + 3 秒窗口内跟随渲染、几何指纹连续两轮一致即停手）——**fit / 打开
> 视口一律登记**（第二类触发：首帧几何未收敛——实机 1000 节点图全新打开 8s
> 采样点仍偏 24.97px、20s 才自愈，属竞态）；补正**只补平移**（缩放由
> 内容尺寸决定、与布局基准无关，无需重算）；② 居中判定抽出共享实现
> `centerContentByDataBox`（fit 数据层路径 / 打开视口 / 补正三处共用一份，
> 含 ε 零调用短路）；③ `resetZoom` 锚点从缓存 `mindMap.width/2` 改为实时容器
> 中心（`getCanvasSize` 优先），并如实登记边界：「容器刚变化、布局未落地时
> 直接点重置缩放（未经 fit）」仍会平移 (W新−W旧)/2，再点一次「适应画布」即恢复。
> 回归网：`verify:visual` 新增 `viewport-geometry` 探针（容器 800→1000 变宽后
> 「打开视口 → 适应画布 → 重置缩放」三步各自等「内容居中或超时」再断言 ≤2px；
> red 测试——临时禁用补正后实测报 `(100, 0)px 超 2px` = Δ 精确值）。
> 刷新 2 行：`src/engine/mindmap.ts` 2532 → 2617 → **2657**（第二轮补正升级）。
> **实机验收（2026-10-14，vault=Mindmap，500/1000 节点性能图，插件重载后）**：
> 500 节点图 fit→reset 全链 dx = 0（reset 后 tx 取正确居中值 −871.83；修复前
> −15.91px）；错配注入链 fit 后 dx = 0、reset 后 dx = 0（修复前 +10.75 / +153.67）；
> 1000 节点图**全新打开** 8s 采样 dx = 0（补正升级前同点位 −24.97）、首次 fit
> dx = 0（前一版 −1.11）、reset 后 tx = −1119.19（正确值）dx = 0；
> `obsidian dev:errors` 无新增。
> **2026-10-15 第十五批**（**就绪判据 v4 修正**——MathJax 4.1.3 下导图内公式退为
> 「回退字体 + 无 TeX 间距」的实机缺陷收口，症状见用户截图 `x² +y² =r²`：加号/
> 等号两侧的 TeX 间距塌缩、字形回退到系统字体）：根因链（1.14.4 + MathJax 4.1.3
> 实机取证）——v4 把 CHTML 字符改为**真实文本节点**（v3 字形在 `::before`）⇒
> 未 flush 的产物也有非零字符宽度（实测 8/8 字符 6.19–7.42px）⇒ 旧判据
> 「全部 `mjx-c` 宽 > 0」**恒假阳** ⇒ 产物直接定稿、`scheduleFlush` 永不触发
> （它只在判定失败时调用）⇒ 官方 `finishRenderMath()` 从未执行 ⇒
> `chtmlStylesheet()` 生成的 `STYLE#MJX-CHTML-styles`（11862 字节：逐字符
> padding 规则 + @font-face）**从未挂进 document**（同刻实测 `inDoc:false`）⇒
> 间距规则与 MathJax 字体整体缺席，「关闭再打开文件」也不自愈。修复 = ① 就绪
> 判据换锚「**本段字符的规则已落盘** +（可见字符）宽度 > 0」；② 索引三态——
> **元素不存在 = 明确未 flush ⇒ 判未就绪**（修复核心）／CSSOM 不可读 ⇒ 退回旧
> 宽度判据 + 留痕；③ 缓存键从 flush 代际改为（样式表元素, 规则条数）——外部
> 通道（阅读视图等）挂载/补齐样式表时本模块代际不前进，旧键会把空索引钉住；
> ④ `charRuleKey` 类名优先（v3 字符元素文本为空、字形在 `::before`，类名是唯一
> 键源）；规则选择器正则补充 `::before` 后缀容忍。实机复验（vault=Mindmap，
> 插件重载后**冷态**：样式表不在 document 时打开自建 4 节点数学副本）：
> `styleInDoc` false → 3.5s 后 true 且 **12352 字节**（含本批新字符 α/β/γ/sin/cos
> 的规则——只可能来自一次覆盖本批字符的 `finishRenderMath`，旧版永不调用）；
> 5 产物 / 0 字面、字符样式 `MJX-TEX-ZERO, MJX-TEX-N` + padding 非零
> （`6.188px 8.008px …`）；用户 2000 节点图节点 997 恢复
> （`5.746px 7.436px 0.143px 0px`）；`obsidian dev:errors` 无新增。
> 刷新 1 行：`src/platform/math-jax.ts` 1065 → **1204**；`tests/math-jax.test.ts`
> 1333（新增「v4 未 flush：宽 > 0 也判未就绪 + 驱动 flush」回归用例；两处 v4 桩
> 的清理补可见字符规则——可见字符的规则同样是在就绪必要条件，只改宽度不会放行，
> 会把耗尽告警泄漏到后续用例）。
> **2026-10-15 第十六批**（**第十五批自查优化**——判据开销面收紧与局部收口，
> 行为等价）：① `isProductReady` 判定序改为「规则落盘（快速失败、**不读 rect**）
> → 宽度（**仅宽度为 0 的字符才做 `::before` 伪元素查询**）→ 豁免双形态」——
> 此前对每个字符先调 `isInvisibleCharByDesign`，可见字符也白付一次
> `getComputedStyle`；可见字符路径样式查询恒 0 次，新增性能契约用例锁定；
> ② 抽 `hasCharRule` 具名判定（「键取不到」与「规则缺失」同后果收拢）；
> ③ `isInvisibleCharByDesign` 显式接收索引（去掉函数内隐式再取）；④ 共享
> `EMPTY_CHAR_RULE_INDEX`（元素不存在路径不再每次新建 Map）；⑤ 索引失败告警
> 文案抽常量（两处 catch 同一句）；⑥ 缓存 `sheet` 字段由 `unknown` 收窄为
> `CSSStyleSheet | null`。**实机复验（真冷态）**：页面重载（清空 MathJax 全部
> 状态，等同全新会话）→ 用户导图自动重开 → 修复路径驱动 flush、样式表自动挂载
> （11862 字节）；40 内容块 7 产物 / **0 字面**、节点 997 `MJX-TEX-*` + padding
> 非零；`obsidian dev:errors` 无新增。⚠ 方法学（本轮实测）：**人为从 DOM 删除**
> `#MJX-CHTML-styles` 制造的是「MathJax 内部记录仍在、DOM 不在」的半态——官方
> flush **不会**重挂（3.5s 后仍缺），该半态真实不可达（样式表一旦挂载不会被外力
> 移除）；**真冷态验证请用页面重载**。**再刷新 1 行**：`src/platform/math-jax.ts`
> 1204 → **1227**；`tests/math-jax.test.ts` 1333 → **1361**。
> **2026-10-15 第十七批**（**「以 Markdown 打开」丢失进入前模式修复**——阅读视图
> 进入导图后切回恒落编辑视图）：实机定位（2026-10-15）读回链路两处断裂。
> ① `mdBackMode` 写进 `setViewState` 的 state 后**永远读不回**——官方
> `WorkspaceLeaf.getViewState()` 的 state 完全取自 `view.getState()`，基类
> `FileView.getState()` 只回 `file`（`View.getState()` 恒 `{}`），而旧读点在
> `onLoadFile` 里经 `leaf.getViewState()` 取（恒 undefined ⇒ 恒回退 `'source'`；
> 布局保存 / 重启恢复同样丢失）。修法：视图覆写 **`setState` 读入**（官方
> `setViewState` 把传入 state 原样交给 `view.setState`——唯一权威来源，先于
> super 的 `loadFile → onLoadFile` 装载落字段；白名单沿用 `readMdBackMode`）+
> **`getState` 写回**（`{...super.getState(), mdBackMode}`——官方字段不重复手写、
> 未来新增字段自动跟随），`onLoadFile` 旧读点删除（来源唯一）。② 文件右键
> 「以 Markdown 打开」在组合根**硬编码 `'source'`**——改为「活跃 leaf 已是该
> 文件的导图视图 → 复用 `view.backToMarkdown()`（恢复进入前模式，与工具栏/命令
> 同语义；路径守卫防止把别的文件的导图 leaf 错切）」，否则回落原路径。回归：
> 新增 `tests/view-md-back-mode.test.ts` 5 例（原型自有 getState / getState
> 回显 file+mdBackMode / 写入键 ⊆ 读回键 / setState 读入点 / 白名单回退），
> mock `FileView` 补 `getState` + `setState` 官方契约最小面。刷新 2 行：
> `src/features/view.ts` 1079 → **1114**、`src/main.ts` 422 → **428**。
> 同日**系统性优化**（聚焦本批触达面）复测 2 行：`src/features/view.ts` 1114 → **1122**、
> `src/main.ts` 428 → **443**——① `readMdBackMode` 收口「从 state 取值 + 白名单」
> （setState 调用点单行化；字段注释补读入/写回点指引）；② 文件菜单入口从「活跃
> leaf」改为「**全库**查找该文件的导图视图 + `setActiveLeaf` 带到前台」——导图在
> 后台标签时也命中，不再顶掉无关标签页；③ 测试提取 `FILE_PATH` 常量、防御用例
> 表驱动（失败信息带 state 上下文）、engine mock 面精简为空面（15 键 → 0 键，
> 仅切断 vendor 加载链）。

> **2026-10-15 第十八批**（**未提交面的系统性优化**：聚焦第五批 → 第十七批触达的
> 代码，在四条门禁全绿的基线上逐项收口「潜在错误 / 性能 / 冗余 / 注释与实现一致」。
> ① **保存管线两处数据安全缺陷**：`SavePipeline.save` 的「不同文件」重入分支漏传
> `opts.checkExternal`（排队即降级为「不检测外部改动」——P1a 唯一防线失效）、
> `externalConflictNotified` 只 add 不 delete（同一文件的第二次冲突**静默**扣住不
> 写盘，用户以为自动保存正常）；两处各补判别性回归用例（还原修复即红：
> `expected 2 times, got 1` / `expected 1 times, got 0`）。
> ② **引擎**：`scheduleCenteringCorrection` 改「同实例单例」（此前 fit 与「居中到
> 全尺度」各登记一份，窗口内叠加多份 listener）+ 兜底定时器走 `scheduleEngineTimer`
> （此前裸 `setTimeout` 逃出 `cancelEngineTimers`，销毁后仍持有引擎引用）；每轮补正
> 由 2 次全树采样收敛为 1 次（`measureCenteringGeometry` 供居中与收敛指纹共用）。
> ③ **渲染**：`clampSegments` 改返回 `{ segments, truncated }`——超限判定按原文长度、
> 可见文本可能并未超限（空格归一 / `%%注释%%` / 链接显示名），此前会追加**假 `…`**
> 并挂 `data-truncated`；`scanTableBlocks` 补 `!raw.includes('|')` 快路径（无表节点
> 不再付按行切片 + 保护区扫描 + MARKUP 扫描正则克隆）；`md-outline.selfClosed` 由
> 每围栏行 `new RegExp` 改纯字符串扫描。
> ④ **交互**：容器粘贴的**图片分支**补 `isTextEntryTarget` 闸门（此前在搜索框里粘贴
> 图片会被劫持成「导入图片」）；菜单粘贴补「会话所属引擎」守卫（跨 await 换文件时
> 旧落点已不在新树上）。
> ⑤ **设置**：`saveFolder` 过官方 `normalizePath`（粘贴 `笔记\导图` 这类反斜杠形态
> 此前令 `getFolderByPath` 恒 null ⇒ 静默回落库根）。
> ⑥ **注释与实现一致**（四处原注释与事实相反）：`creation` 的「normalizePath 是否
> 剥离前导斜杠官方未承诺」与 `obsidian.d.ts` 正相反（d.ts 明写 *removes leading and
> trailing slashes* 并给示例）、`view-hotkeys` 的「引擎未绑定 Del|Backspace」与 vendor
> 正相反（上游 `Render.js` 确实绑定 `REMOVE_NODE`）、`node-inline-content` 的「段序列
> text 拼接 = 原文」实为 ≈（文本段经空格归一与首尾剔除）、`verify-visual` 的「桩失败
> 降级跳过」实为真值断言失败。
> 刷新 5 行：`src/engine/mindmap.ts` 2657 → **2702**、
> `src/features/node-inline-content.ts` 1774 → **1803**、
> `src/markdown/md-outline.ts` 1145 → **1159**、`src/settings.ts` 475 → **487**、
> `src/services/document-service.ts` 365 → **367**。

> **2026-10-15 第十九批**（**未提交面收口**：第十八批未做的「冗余收口」7 条，逐条
> 先取官方 API / vendor 事实再落地）：
> ① **剪贴板写入面**：`platform/clipboard.writeClipboardText` 加**属主文档**参数
> （popout 里按钮/菜单挂副窗口文档，取属主 `navigator` 才在焦点判定下可用），
> `node-codeblock`（代码块复制）与 `view-context-menu`（复制链接）两条旁路改走它
> ——此前三套失败呈现（平台留痕 / 就地 catch + Notice / 静默），而 `view-context-menu`
> 文件头本来就写着「勿另开剪贴板通道」。
> ② **「文本是否被编辑」收口到 `domain/md-meta.isNodeTextEdited`**（域内互引既有
> 先例：`wiki-display` 已引 `./md-meta` / `./wikilink`）：`md-serialize`（rawOk）、
> `links-rename`、`view-split-links`、`wiki-display`、`node-inline-content` 五处改为
> 同一判据；**快照缺失按「未编辑」**（保留各站点原语义），并已核实 `mdRaw` 与快照
> **恒同源写入**（md-outline / links-split / links-rename / md-line-write 四处处处成对）
> ——故两侧口径在真实数据上等价。
> ③ **「取节点 data 字符串」收口到 `core/node-data.readNodeDataString`**（放 core
> 以便全层复用）：防腐层 `getNodeDataString` 改为委托，features / links / markdown
> 共 10 处手写 `typeof x === 'string' ? x : ''` 与 `node-inline-content` 的私有
> `readString` 一并删除。
> ④ **命令 id 表单一来源**：`commands.ts` 由「9 处字面量 + 另抄一份数组」改为具名
> 记录（`COMMAND_IDS.createNew` …）+ 派生的 `ALL_COMMAND_IDS`，注册点与「语言变更
> 先移除再注册」共用同一份——此前漏登记无门禁可发现（命令面板残留旧语言重复项）。
> ⑤ 单节点自绘重建 `refreshNodeCustomContent` 改为批量入口的薄封装：`reRender`
> 缺失时的告警（K88 教训）与「N 节点只 render 一次」的收敛不再有两份实现。
> ⑥ **视口读写面收口进引擎层**：新增 `readViewportState` / `applyViewportState` /
> `getViewportSignature` / `viewStateSignature`，`engine-controller` 的三处
> `mindMap.view.getTransformData/setTransformData` 直读与自持的
> `transformSignatureOf` 全部删除（services 不再触碰引擎内部形态；`applyViewportState`
> 刻意**不吞异常**——畸形 state 的抛错回退 fit 是既有契约）。
> ⑦ 「文件名的 URL 编码形态」收口到 `domain/url.encodedNameForm`：编码侧此前在
> file-lookup（索引键）/ links-tree（末段比较）/ engine-controller（预检 needle）
> 各写一遍，与解码侧 `tryDecodeUri` / `urlComparisonForms` 对称。
> 刷新 7 行：`src/engine/mindmap.ts` 2702 → **2764**、
> `src/services/engine-controller.ts` 819 → **803**、`src/markdown/md-serialize.ts`
> 1229 → **1232**、`src/features/view.ts` 1122 → **1124**、
> `src/features/view-node-actions.ts` 881 → **882**、`src/markdown/links-split.ts`
> 486 → **487**、`src/links/links-tree.ts` 452 → **451**。

> **2026-10-15 第二十批**（**测试补齐**：审计里「有实现、无直测/无覆盖」的三处，按
> 硬规则 7 补齐——新增 `tests/math-placeholder.test.ts` / `tests/clipboard.test.ts` /
> `tests/file-menu-back-to-md.test.ts`，共 15 例）：
> ① `core/math-placeholder`：两种占位形态（行内 `$…$` / 块级 `$$…$$`、tex 原样、
> 与原文定界符同形）+ **源码级契约**（构建 `node-inline-content` 与撤回 `math-jax`
> 都必须引用本模块——重新内联字面模板即红灯；该模块的存在理由正是「两处各写一份
> 模板会静默分叉」）。
> ② `platform/clipboard`：成功 / 宿主拒绝（留痕一次 + 回 `false`）/ `clipboard`
> 整体缺失 / **属主文档**（popout 取副窗口 navigator、不碰主窗口）/ 属主文档无窗口
> 时回落全局，以及读取侧「空串 ≠ 失败」——此前唯一消费方把它整模块 mock 掉，三条
> 失败语义只验证了 mock 自己。
> ③ `main.ts` 文件菜单「以 Markdown 打开」的分支选择：命中该文件的导图视图（含
> 后台标签）→ `setActiveLeaf` + `backToMarkdown`；未命中 → 回落
> `openAsMarkdown(…, 'source')` **且不顶掉无关标签**；同路径非导图 leaf 被
> `instanceof` 守卫拦下；判据为假时走「以思维导图打开」一支（同一动作**互斥一项**）。
> `Menu` 桩自建——官方 `Menu` 与 `tests/mocks/obsidian.ts` 的桩都不保留 `addItem`
> 回调，无法断言菜单项与点击行为。

> **2026-10-15 第二十一批**（**待裁决总账「按推荐执行」·波一（小成本 9 项）**）：
> ① `D5` 引擎另绑的 `Del|Backspace` → `REMOVE_NODE`（上游 `core/render/Render.js`）
> 在 `createMindMap` 里**显式摘除**（与 `Control+l` 同处同因）：此前插件 scope 与引擎
> window 两条删除通道并存，只靠「scope 先到」的顺序假设避免双删（引擎先删会自动激活
> 兄弟节点，随后插件删掉的就不再是原节点）。AssociativeLine / OuterFrame 的同键绑定
> 不受影响——本插件不注册那两个插件。
> ② `D9` 嵌入侧零尺寸等待入口改名与 `services/engine-controller` 对齐：
> `renderOrWait` → `initMindMap`、`tryMount` → `tryRender`、`disconnectObserver` →
> `disconnectInitObserver`（同一职责两个名字，检索时找不到一起）。
> ③ `A8` `ViewStateStore.hydrate` 对 `view` 增设**可用性校验**
> （`isUsableSavedView`：`state` 为对象且 scale/x/y 为有限 number）：畸形视口**只丢该
> 字段**（同条目的 layout/lineStyle 保留），整条再无已知字段才丢弃——此前畸形 `state`
> 会让引擎 `Object.keys(undefined)` 抛错、每次打开都落 catch 走 fit，日志却写「恢复视图
> 状态失败」（排查方向是错的）。回归：`view-state.test.ts` 增 2 例；`md-roundtrip` 与
> `engine-controller` 的视口 fixture 同步为引擎真实形态（`{transform, state{scale,x,y}}`），
> 并新增「畸形视口被丢弃 ⇒ 走默认居中而非 fit」一例。
> ④ `A9` `runWithExportScale` 恢复失败的裸 `catch` 改**留痕告警**（残留会把临时倍率
> 带到后续导出）。
> ⑤ `B14` `TitleRenamer` 去掉「编辑中」的每 1.5s **无限自递归轮询**：改为**至多重排
> 一次**兜底——两条编辑通道的提交点本来都会重新 `schedule()`（事件才是正常路径，时间
> 不是）。
> ⑥ `C12` 引擎实例 token 命名统一（`content-remeasure.forgetEngine(owner)`）+ 在
> `core/constants` 登记两套类名前缀的分工规则（`mindmap-*` 自绘内容 / `tmm-*` 代码块与
> 嵌入；同系统内一致、不整体迁移——迁移会同时动 styles.css / 导出后处理链 / 探针）。
> ⑦ 相邻同款归一并入：`md-serialize`（`data.image`）与 `links-tree`
> （`data.attachmentName`）改走 `readNodeDataString`（`data.mdRaw` 那处**保留**——它兼作
> 类型守卫）；`ui/modal-image` 的 `navigator.clipboard.read()`（读**图片**）就地登记为
> 文本写面之外的唯一豁免。
> ⚠ **偏离登记（D6）**：审计判「画布委托里命中节点那一支不可达」经复核**不成立**——
> 上游节点的 contextmenu 处理器在 `readonly` 或 `e.ctrlKey` 时**直接 return、不
> stopPropagation**（macOS 的 Ctrl+左键走这条路径），删掉该支会让它落到空白菜单。故
> **保留分支**并订正注释为真实依据；是否仍要删（接受 macOS 行为变化）待裁。
> 刷新 3 行：`src/engine/mindmap.ts` 2764 → **2774**、`src/core/constants.ts`
> 529 → **539**、`src/features/mindmap-codeblock.ts` 535 → **537**。

> **2026-10-15 第二十二批**（**待裁决总账「按推荐执行」·波二（行为口径 3 项）**）：
> ① `D4`（改按选项 A）新增**快捷键前置闸门** `shortcutGateAllows` 并经
> `customCheckEnableShortcut` 注入（引擎该项**整份替换**其默认判定，见 vendor
> `KeyCommand.onKeydown`)：默认只在 `body` / 编辑类元素放行，而自绘内容里的可聚焦
> 元素（代码块复制 `<button>`、外链 `<a>`）会让三键与其余画布快捷键**静默失效**。
> 放行集合 = 引擎默认（含编辑类元素——编辑框挂 `body`/`customInnerElsAppendTo` 下、
> 不一定在画布内）∪ **本引擎画布内**（`canvasEl.contains`）。用 `nodeType ===
> ELEMENT_NODE` 而非 `instanceof Element`（popout 跨窗口 + 本文件必须可脱离 obsidian
> 打包，官方的 `instanceOf` 助手不可用）。原推荐（视图 scope 接管三键）因**双通道
> 风险**（引擎粘贴未被取消会插两份；非画布目标拿不到 clipboardData）改选 A。
> ② `D2` `isContentVisibleInCanvas` 在**性能模式**改用数据层盒
> （`contentBoxForVisibility`：`measureContentBoxFromData` + draw 变换换算到画布坐标，
> 与 `centerContentByDataBox` 同一换算）：性能模式 ≥500 节点必开，此前直接 fail-open
> 等于「保存视口落界」这条护栏**在大图上不可达**；变换不可得时仍回 null（fail-open）。
> ③ `D3` `clampSegments`：**表格自身超预算**时整张保留 + 明示截断（纯表格节点此前
> 屏上只剩一个 `…`：1999 字显示整表、2000 字什么都不显示）；表格自身在预算内、只是
> 被前面的内容挤掉时**仍按预算省略**——那是正常截断点（前面文本 + `…` 已可读），预算
> 约束照旧。既有用例「不截半张表」的语义因此保留。
> ⏸ **`D8` 未做**：让保护区覆盖「未闭合围栏到文末」需要**先**由 `markdown/md-outline`
> 导出「受保护区间」入口（解析层的围栏状态机是唯一权威）；否则渲染层要自写第二份
> fence 判定，直接违反硬规则 5。该入口涉及 markdown 层公开面，待你确认后再做。
> 刷新 2 行：`src/engine/mindmap.ts` 2774 → **2851**、
> `src/features/node-inline-content.ts` 1803 → **1813**。

> **2026-10-15 审查修复批**（复制根节点、监听回收、可见性自愈起点、数学重试上限、
> 表格保护区、`refreshDomState` 等）：**全表按 `countSourceLines` 复测并刷新 9 行**
> —— `src/engine/mindmap.ts` 2851 → **2883**（复制路径过滤 `isRoot`〔与剪切同口径〕+
> 快捷键闸门导出与放宽副作用登记 + 居中补正轮次只对真实布局变化计费 + flush 注释改
> 「提前 vs 兜底」两态）、`src/platform/math-jax.ts` 1227 → **1268**（`unsettledMath`
> 增 `repairAttempts` + 重入上限与留痕：修掉「永不就绪的段在渲染钩子上无界重跑」）、
> `src/features/node-inline-content.ts` 1813 → **1832**（注释块纳入表格保护区、
> 相邻表格块边界换行不重叠、单元格未知段不变式）、`src/features/view.ts` 1124 → **1137**
> （`activeLeafRef` 对称回收 + onOpen 初始可见性采样：修掉「启动恢复的后台 leaf
> 首次可见时自愈落空」）、`src/core/constants.ts` 539 → **547**
> （`AUTO_OPEN_SCAN_DEBOUNCE_MS` 收口，实现与测试同源）、`src/settings.ts` 487 → **491**
> （切档改官方 `refreshDomState()`）、`src/features/mindmap-codeblock.ts` 537 → **540**
> （渲染失败终态一并 `dispose` 尺寸会话）、`src/core/i18n.ts` 563 → **561**、
> `src/platform/prism-code.ts` 448 → **444**（复测/减法读数）。
> 新增直测 `tests/engine-subtree-clipboard.test.ts`（17 例）盖住引擎防腐层四个新入口
> 与快捷键闸门；文档侧同时订正 `docs/agents/architecture.md` 的第二张豁免表
> （14 行漂移 + 一处与表格事实不符的「全表重测」声明）与 `vendor/BUILD.md`
> （缓存键口径失真、svg.js 第三方增量未登记）。
>
> **同日第二批（第二轮修复）**再刷新 4 行：`src/engine/mindmap.ts` 2883 → **2909**
> （`cloneSubtreeWithoutUid` 的顶层字段与 vendor `copyNodeTree` 对齐〔含 `_` 前缀跳过〕
> + `measureContentBoxFromData` 的错位 JSDoc 归位）、`src/platform/math-jax.ts`
> 1268 → **1277**（`repairUnsettledMath` 的在途判据收成「每次调用局部 `Set`」，
> 消掉 O(未定稿数 × 在途数)；缓存命中路径**有意**不查在途集合的裁决写在函数内）、
> `src/services/engine-controller.ts` 803 → **806**、`src/links/links-tree.ts`
> 451 → **454**——后两处同属 `encodedNameForm` 收口：**不可编码（孤立代理对等非法
> 序列）返回 `null`**，此前比较侧（links-tree 末段比较 / engine-controller 预检
> needle）是裸调用，对含此类文件名的文件做重命名 / 删除会在引用更新**中途抛
> `URIError`**（`src/domain/url.ts` 的旧注释「比较场景不会抛」与实现不符，一并订正）。
> 另：`scripts/verify-visual.mjs` 的嵌入契约 ④ 由固定 400ms 单点采样改为**几何稳定
> 轮询**（连续两拍高度一致或 1.5s 上限），补齐本文件既有的「就绪等待」纪律。

> **2026-10-27 审后修复批（节点配色：指令落点 / 勾选态）**：实机复核发现两处必修，改了三处源码、两处测试。①**落点不再破坏块语法**：`setColorDirective` 无指令时原本一律尾插到原文末尾——末行是**闭合围栏**时会写出 ```` ``` %%#2e9e8f%% ````，CommonMark 要求闭合围栏后只有空白（`classifyLines` 同口径）⇒ 围栏不闭合、其后的同级节点整段被吞进代码块（实机：3 个同级节点塌成 2 个，再存盘结构真的变了）；末行是**表格行**时会写成 `| 1 | 2 | %%#7c5cd6%%`（GFM 多出一列）。改为 `appendColorDirective` 分流：末行是闭合围栏定界行（`fenceMarker` + 其后只剩空白，围栏口径仍只此一份）或收尾块是表格（复用 `scanTableBlocks`）时**另起一行**，其余仍尾插。②**菜单勾选态取生效色**：新增 `effectiveNodeColorOf`（自身 → 最近祖先），修掉「继承父色的子节点在菜单里勾着『默认』、屏上却是彩色」的错报；已知边界（「默认」对继承色节点是空操作）写进 AGENTS.md 决策表与函数注释。③**test**：+4 例（多行尾插 / 闭合围栏另起一行 / 表格行另起一行 / 继承色勾选态），全量 **88 文件 / 2436 例**。④`--fix-lines` 回填两表 **2 行**：`features/node-inline-tokenize.ts` 1197 → **1255**、`features/view-context-menu.ts` 592 → **595**；超限文件数仍 **33**。⑤`baseline-metrics.md` 复测：G-03 **2436**、S-06 `node-inline-tokenize` **1255** / `view-node-color` **143**、S-09 src **34,406** / tests **45,635**、P-01 `main.js` **663,381 B** / gzip **197,255 B**。

> **2026-10-27 哨兵批（`%%none%%`＝显式「不跟随上层」，用户裁决引入）**：①**语法**：注释段内容恰为裸 `none`（外壳空白 / 大小写宽容，`%%#none%%` 不算）⇒ 该节点**显式无节点色**且**阻断祖先色下传**；判定与十六进制同处 `node-inline-tokenize.colorDirectiveRanges`（读 / 写共用），常量 `domain/color.COLOR_DIRECTIVE_NONE`。②**语义落地只有一行**：`walkColorDirectives` 里 `own === NONE ? null : (own ?? inherited)`——折 null 兼「自己回落主题」与「不再往下传」；`engine/mindmap-colors` 不重判（它看到的已是「颜色或 null」）。③**入口**：节点右键「配色」第二项「无颜色」（`menu.color.none`，紧随「默认」），`applyNodeColor(view, targets, COLOR_DIRECTIVE_NONE)` → 正文写哨兵；勾选态仍取生效色（`effectiveNodeColorOf`，哨兵为真值即答案），自定义弹窗不预填哨兵。两处「配色」菜单自此**只差这一项**（整篇侧无继承语义），`tests/view-context-menu.test.ts` 改为锁定「该差异外逐项相同 + 分隔线数相等」。④**测试 +7 例**（全量 **88 文件 / 2443 例**）：解析口径与 `#none` 拒绝 / 阻断继承遍历 / 写·换·清哨兵 / 渲染期子树不挂色 / 菜单勾选态 / 点「无颜色」写 `%%none%%` / 哨兵换色。⑤`--fix-lines` 回填两表 **3 行**：`core/i18n.ts` 642 → **649**、`features/view-context-menu.ts` 595 → **610**、`features/node-inline-tokenize.ts` 1255 → **1276**；超限文件数仍 **33**（`domain/color.ts` 275 / `engine/mindmap-colors.ts` 154 / `features/view-node-color.ts` 154 均未越线）。⑥`baseline-metrics.md` 复测：G-03 **2443**、S-06 `node-inline-tokenize` **1276** / `view-node-color` **154**、S-09 src **34,488** / tests **45,761**、S-10 i18n **218/218**、P-01 `main.js` **663,668 B** / gzip **197,329 B**。⑦**实机**（Obsidian 1.14.4）：父 `%%#c2761a%%` → 子一「无颜色」→ 文件写 `  - 子一 %%none%%`、该节点 `fill` 转 `transparent` 而父 / 兄弟仍 `#c2761a`；子二（有子）同样处理后**孙二一并回落**；重开文件颜色不变；子二菜单勾在「无颜色」、点「默认」即删哨兵回到继承。

> **2026-10-27 默认合并批（把「无颜色」并回「默认」并撤掉该项，用户裁决）**：①**语义**：首项「默认」改为＝**回到整篇配色**（不再看祖先的节点色），哨兵降级为它的**落地形态**而非独立入口；菜单回到「默认 + 五个颜色 + 自定义」，与空白右键的整篇配色**逐项相同**（`tests/view-context-menu.test.ts` 恢复严格相等的断言）。②**落地按节点分流**（`view-node-color.applyNodeColor`）：`color ?? (inheritedColorOf(node) ? COLOR_DIRECTIVE_NONE : null)`——上层还在染色 ⇒ 写 `%%none%%` 挡住继承；上层本就没色或已被更上面的哨兵挡住 ⇒ **直接删自身指令**（不给文件添注释）。新增私有 `inheritedColorOf`：沿父链取最近一条指令，哨兵折 null 并**终止**查找（与 `walkColorDirectives` 同口径，勿另写一份）。**不能一律删指令**——那正是被取代的旧语义（删完照旧继承父色）。③**勾选态**：`isDefault = current === null || current === COLOR_DIRECTIVE_NONE`（哨兵与「没写指令」共用「默认」这一个勾，屏上都是整篇配色的样子）；自定义项排除这两态。④**i18n**：撤 `menu.color.none`（ZH/EN 同撤，回到 217/217）。⑤**测试**：净 **+2 例**（全量 **88 文件 / 2445 例**）＝「默认」三条分流（写哨兵 / 只删指令 / 删冗余哨兵）+1（哨兵与未写指令同勾「默认」），撤掉原「无颜色」的勾选态与点击两例。⑥`--fix-lines` 回填两表 **2 行**：`core/i18n.ts` 649 → **642**、`features/view-context-menu.ts` 610 → **602**（`features/node-inline-tokenize.ts` **1276** 不变）；超限文件数仍 **33**。⑦`baseline-metrics.md` 复测：G-03 **2445**、S-06 `view-node-color` **180**、S-09 src **34,499** / tests **45,775**、S-10 i18n **217/217**、P-01 `main.js` **663,629 B** / gzip **197,345 B**。⑧**实机**（Obsidian 1.14.4）：父 `%%#c2761a%%` → 子一点「默认」→ 文件写 `  - 子一 %%none%%`、该节点转 `transparent` 而父 / 兄弟仍 `#c2761a`；父节点点「默认」→ **直接删指令**（无哨兵残留）；再对已冗余的子一哨兵点「默认」→ 哨兵被删；菜单条目 7 项、与整篇配色一致。

> **2026-10-27 优化批（本批改动的代码与注释收敛）**：①**父链遍历上移**：`inheritedColorOf` 从 `features/view-node-color` 移进 `domain/color`（泛型 `{ parent }` + 注入 reader，纯逻辑可直测），`effectiveNodeColorOf` 收成一行 `nodeColorOf(node) ?? inheritedColorOf(node, nodeColorOf)`——原先两份几乎相同的父链循环只剩一份。②**哨兵折算唯一化**：`effectiveDirective(own)` 成为全仓唯一的「`none` → null」点，`walkColorDirectives` 与 `inheritedColorOf` 都经它。③**写入侧简化**：`lastLineClosesFence(raw)` 改成 `isClosingFenceLine(line)`（纯函数、单行入参，自己不再切末行），`lastLineTakesInlineAppend` 并入 `appendColorDirective`。④**注释收紧**：`domain/color` 头、`node-inline-tokenize` 的 `colorDirectiveRanges` / `setColorDirective` / `appendColorDirective`、`view-node-color` 头与 `applyNodeColor`、`view-context-menu.addNodeColorMenu`、`mindmap-colors` 的优先级段——删掉重复解释，保留事故与口径（K145/K149 已在 `conventions.md` 详录）。⑤**重构中抓到一处真回归**（当场判红）：`effectiveDirective(own) ?? inherited` 会把哨兵折出的 null 又落回继承 ⇒ 哨兵失效；改为 `own === null ? inherited : effectiveDirective(own)`，由「哨兵阻断继承」用例锁死。⑥**测试 +3 例**（`inheritedColorOf` 直测：最近一条 / 哨兵终止 / 无父链），全量 **88 文件 / 2448 例**。⑦行数：`domain/color.ts` 275 → **298**（仍在 300 内、无需登记豁免）、`features/view-node-color.ts` 180 → **134**、`features/node-inline-tokenize.ts` 1276 → **1253**、`features/view-context-menu.ts` 602 → **598**；`--fix-lines` 回填两表 **2 行**，超限文件数仍 **33**。⑧`baseline-metrics.md` 复测：G-03 **2448**、S-09 src **34,442** / tests **45,809**、P-01 `main.js` **663,593 B** / gzip **197,363 B**。⑨**实机**（Obsidian 1.14.4）：父 `%%#c2761a%%` 的子 / 孙继承正常；子一「默认」仍写出 `%%none%%` 且只把该子树转 `transparent`；重开文件颜色不变，`dev:errors` 干净。⑩**同一轮的文档整理**（无源码行数变化）：`README.md` / `README.zh-CN.md` 修正「默认」的过时描述（原文写「＝删掉指令」，与本批语义不符）、补 `%%none%%` 是唯一非颜色值、语法速览标注「注释里的十六进制即配色指令」、快速上手第 3 条把「正文写回笔记」与「外观记 `data.json`」分开说；`AGENTS.md` 拆开「实机验证」超长条目（复制 → reload → enablePlugin 三步 + 两条 ⚠）、把「新增特性」第 6 步的门禁链改成 `check:gates` 一句 + 7 条条件项清单（原为单个 800 字长句）、决策表「节点级颜色」行去掉两处重复表述、清掉多余空行（236 → 244 行；结论与文件名全部保留，仅合并重复表述与日期旁注）；`docs/agents/README.md` 的 `conventions.md` 规模引用 1676 → **1700**（实测 1714）。

> **2026-10-27 审后复修批（发布前审核：清除独占一行的配色指令留下空行）**：①**缺陷**：`setColorDirective` 清除时只吞相邻**水平**空白。指令按 `appendColorDirective` 的落点另起一行（末行是闭合围栏 / 表格行）时，删完残留一个换行 ⇒ 原文末尾多一个空行、`applyRawToNode` 把它写进 `mdRaw`、`serializeMdBody` 的空行规则（`nodeLines` 不给空行加续行缩进）再把它原样写盘——文件凭空多一行、紧列表变松散列表（端到端复现：`- 标题` + 围栏 + `- 兄弟` → 上色 → 「默认」→ 多出一空行）。②**修复**：新增 `ownLineSpan(raw, range, cursor)`——指令前后到换行为止只剩空白即判「独占一行」，删除时连同**分行的换行**一起吞（非首行吞前一个、保留本行末尾换行；首行没有前导换行可吞则改吞末尾那个）；区间下界按 `cursor` 回夹，多处连续清除不反向切片。③**测试**：`tests/color-directive.test.ts` **+2 例**＝「清除独占一行的指令：整行连换行一起删〔围栏 / 表格 / 中间行 / 首行〕」+「上色 → 默认往返回到原文」；全量 **88 文件 / 2450 例**。④**文档**：`AGENTS.md` 决策表「节点级颜色」行补清除侧口径（含 `ownLineSpan` 指向）；`release-notes-0.2.6.md` 订正两处「右缘竖栏的二级菜单」→「右键菜单的二级菜单」（级联在 `view-context-menu`，竖栏只有两态开关），用例数 2448 → **2450**。⑤行数：`features/node-inline-tokenize.ts` 1253 → **1293**（`--fix-lines` 回填两表 1 行，超限文件数仍 **33**）。⑥`baseline-metrics.md` 复测：G-03 **2450**、S-09 src **34,483** / tests **45,840**、P-01 `main.js` **663,923 B** / gzip **197,827 B**。⑦门禁：`check:gates` 全链（build / test / lint / lint:css / 死代码 / `verify:visual --require-chrome` / check:release）一次通过。

