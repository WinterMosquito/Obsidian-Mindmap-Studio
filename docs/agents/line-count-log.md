# 文件规模与豁免 · 批次流水

> 2026-10-26 自 `AGENTS.md` 迁出（Agent 工效批）：`AGENTS.md` 只保留「文件规模与豁免」的**终值表**与口径，历次实测读数 / 回填记录 / 理由流水**逐字**迁入本文件（未改动任何字句）。
>
> **新批次记录追加到本文件末尾**（沿用既有格式 `> **日期 批次名**：…`），不再写入 `AGENTS.md`——该文件每个会话整体进 Agent 上下文，只留结论、不留过程。
>
> 行数口径 = `tests/agents-md-sync.test.ts` 的 `countSourceLines`（按 `\n` 切分、末尾换行不计行）；对账与回填跑 `npm run check:gates -- --fix-lines`（**唯一**登记表是 `AGENTS.md`，`architecture.md` 自 2026-11-09 起不再复制）。行数**终值**以 `AGENTS.md` 豁免表为准，本文件只是流水；冲突以终值表为准。

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

> **2026-10-29 布局入属性批（渲染入口重构：逐文件布局从 data.json 迁到 frontmatter）**：①**语义**：布局的持久化位从 `viewState[*].layout` 改为 frontmatter 的 `Mindmap` 值（七值枚举，值即布局；`Markdown` 为显式终止），`ViewStateStore.hydrate` 剔除旧键并返回布尔让组合根补一次写盘；`view.applyLayout` 走「先 `savePipeline.save()` 排空正文 → `processFrontMatter` 写属性 → `forgetBaseline` 作废基线 → 才回落画面」，写失败不动画面并提示 `view.layoutWriteFailed`；属性被外部改写由 `view.syncDeclaredLayout` 只跟随、不回写（值与会话相同即早退，幂等）。②**行数**：`--fix-lines` 回填两表 9 行——`features/view.ts` 1267 → **1337**、`main.ts` 511 → **531**、`core/i18n.ts` 642 → **653**、`core/constants.ts` 815 → **825**、`settings.ts` 555 → **565**、`features/view-context-menu.ts` 598 → **605**、`features/mindmap-codeblock.ts` 671 → **673**、`services/document-service.ts` 377 → **395**、`markdown/md-open.ts` 243 → **280**。③**补登记**：`services/view-state.ts` **302** 行（hydrate 增加旧布局清理后 299 → 302 越线），登记豁免 **33 → 34** 条；超限文件数仍 **33**（`markdown/md-open.ts` 已回落到 280，仍在表内但不再超限）。④**测试**：**88 文件 / 2491 例**全绿；`npm run check:gates` 全链（build / test / lint / 死代码 / `verify:visual --require-chrome` / check:release）一次通过；`baseline-metrics.md` 暂未复测（src **34,777** 行、`main.js` **665,536 B** / gzip **198,660 B** 供回填）。⑤**实机**（Obsidian + Obsidian CLI）：ⓐ `Mindmap: CatalogOrganization` 的示例图打开即 `catalogOrganization`；`applyLayout('fishbone')` 后文件**只改属性行**（正文逐字未动，diff 仅一行）；ⓑ 改布局后编辑节点 → 自动保存落盘且**属性未被回退**（`forgetBaseline` 生效，未出现「冲突后静默不落盘」）；ⓒ 外部 `processFrontMatter` 写 `Timeline` → 视图 `resolveLayout()` 跟随为 `timeline`，文件**未被回写**；ⓓ 嵌入块：`%%layout: Timeline%%` 的块渲染为单行横向链（3 节点 h=29px；默认 `logicalStructure` 同规模为纵向堆叠），`%%layout: 笔记%%` / `%%layout: Markdown%%` 各弹一条「无法识别的布局」提示，`layout:` 字样**未变成任何节点**；ⓔ 旧数据 `viewState[*].layout` 启动后被剔除、同条目 `lineStyle` 与顶层设置原样保留（合并写未丢设置）；ⓕ「切换回 Markdown」写 `Mindmap: Markdown`、正文逐字保留；`dev:errors` 全程干净。⑥**文档订正**（本轮审核）：K14 的值口径改为「值即布局（七值枚举）+ 首键优先 + `Markdown` 是显式终止值」（原文仍写「比对 `mindmap`」「`Markdown` 不是否决票」）；`README.md` / `README.zh-CN.md` 的回滚说明改正为「旧版本连 `Mindmap` 键名也不认，需同时把键名改回 `类型`/`Type`」。⑦**审后修复三条**：ⓐ`MindMapView.pendingLayoutWrite`（在途标记）——`applyLayout` 写属性期间置位、`finally` 清空，`syncDeclaredLayout` 见到「在途值」即早退，消除「`changed` 先于 `await` 恢复到达 ⇒ 同一布局应用两次（双重重排 + 竖栏连建两次）」的时序依赖（`features/view.ts` 1337 → **1364**，两表已 `--fix-lines` 回填）；ⓑ`frontmatterByPath` 在 `applyLayout` 后仍是切换前快照这件事**不改代码**，写进 `applyLayout` 的 JSDoc「已知边界」（拼 YAML 不归本层；正常写盘以磁盘现值为准，仅 `cachedRead` 读不出时才用兜底）；ⓒ`mindmapEmbed.unknownLayout` 文案 ZH/EN 改为「忽略布局指令『{value}』（不是六种布局之一）」，不再把合法终止值 `Markdown` 说成「无法识别」，标准文档补「值不可为空」（当时的写法是「`%%layout: %%` 不匹配外壳」，实测口径见 ⑨ⓑ），AGENTS.md 决策表补「`Markdown` 在嵌入里按非法值处理」的口径。⑧**优化批（同一提交内）**：ⓐ抽 `applyLayoutToEngine`——`applyLayout` 与 `syncDeclaredLayout` 原本各写一遍「会话值 → 引擎 → 竖栏 → 小地图」（四步顺序即契约），现共用一份（`view.ts` **1382**，两表已回填）；ⓑ`applyLayout` **入口归一**：`layoutIdOfPropertyValue(engineLayoutId)`，非法 id 直接忽略并 `console.warn`——此前会把默认值写进文件（冒充一次选择）且把未知布局交给引擎；ⓒ右键菜单的 `void applyLayout` 补 `.catch`（应用引擎那步不归 `applyLayout` 的 try 管，叶子关闭时会产生未处理拒绝），`view-context-menu.test.ts` 的 fake 同步对齐为返回 `Promise`（`view-context-menu.ts` **609**）；ⓓ`currentLayout` 字段注释订正（`null` 只存在于字段初始化到构造函数赋值之间；换文件由 `loadMindMapFromFile` 覆盖，不是「加载完之前一直是 null」）；ⓔ新增 `tests/view-layout.test.ts`（**4 例**，源码契约：竞态守卫三处 / 入口归一 / 单一应用点——`MindMapView` 不可在单测里实例化，与 `mindmap-codeblock.test.ts` 对 `embedLayout` 同口径）。全量 **89 文件 / 2495 例**；实机：`applyLayout('bogus')` 只留 console 警告、**文件与画面都不动**，`applyLayout('Fishbone')`（属性标准值形态）归一为 `fishbone` 并写 `Mindmap: Fishbone`，外部改写仍跟随为 `organizationStructure`，`dev:errors` 干净。

> **2026-10-29 二审修复批（同一提交内）**：ⓐ**升级的变体收敛会重置布局**：`md-open.upgradeMindMapProperty` 的收敛分支写的是 `seedValue`，而该分支的前提是 `isMindMapProperty(fm)` 为真（首个键的值已是布局）——用种子覆盖等于把用户已选的布局静默换掉（`Mindmap: Timeline` + `mindmap: Timeline` 且 MetadataCache 滞后即可复现）。改为读声明、写 `declared.value`（种子值只用于「本来就不是导图」的文件），并删掉随之不再使用的 `isMindMapProperty` 导入；`tests/md-open-trigger.test.ts` **+1 例**（`markdown/md-open.ts` 280 → **285**）。ⓑ**空值指令被当成指令**：`%%layout: %%` 其实**命中外壳**——`(.+?)` 会吃掉分隔空白那个空格（`%%layout:%%` 才不命中），于是整行被剥离并弹一条**值为空**的「忽略布局指令」提示，与标准文档「值不可为空」相反。`parseEmbedLayoutDirective` 取到值后先判空，空值等同「不是指令」（原样返回、不剥行、不提示）；标准文档与 `AGENTS.md` 决策表的措辞随之订正为「虽命中外壳，取到空值即按普通注释留在块内」；`tests/mindmap-codeblock.test.ts` **+1 例**（`%%layout: %%` / `%%layout:   %%` / `%%layout:%%` 三种写法，`features/mindmap-codeblock.ts` 673 → **680**）。ⓒ**在途标记清得太早**：`applyLayout` 的 `finally` 无条件清 `pendingLayoutWrite`，两次切换交叠（连点两个布局）时前者收尾会放走后者仍在写盘的窗口，期间 `changed` 会让跟随侧先应用一次、后者再应用一次（又一次双重重排）；改为只清**自己那一项**（`pendingLayoutWrite === layoutId` 才清），`tests/view-layout.test.ts` 的源码契约同步加一条断言（`features/view.ts` 1382 → **1387**）。ⓓ**文档口径**：`conventions.md` K121 两处仍写「无声明→补 `Mindmap: Mindmap`」（实现写的是种子布局的标准值），改正并补「收敛写文件已声明的布局」口径；`architecture.md` 的 `md-open` / `mindmap-codeblock` 条目同步（含块体首行 `%%layout: …%%` 指令与空值口径）。行数：`--fix-lines` 回填两表 3 行（`features/view.ts` 1382 → **1387**、`features/mindmap-codeblock.ts` 673 → **680**、`markdown/md-open.ts` 280 → **285**；超限文件数仍 **33**）。测试：**89 文件 / 2497 例**全绿（`tsc` / `eslint --max-warnings 0` / `vitest run` / `build` / `lint:css` / 死代码 / `check:release` 均通过；`verify:visual` 本轮未跑）。

> **2026-10-29 布局勾选态优化（同一提交内）**：①**缺陷面**（二审 #5）：`loadMindMapFromFile` 在 `await documents.load` **之前**读一次声明，MetadataCache 未就绪时落到种子值 ⇒ 勾选态与画面先停在种子值上、等 `metadataCache.changed` 才跳到真布局（期间点「已勾选」的那一项不产生任何动作）。②**修复**：读完文档**复问一次** `readDeclaredLayout`，读到就覆盖会话值——`vault.read` 给了缓存追赶的时间，窗口从「整段 load」缩到「一次 read」；复问点位于 `initMindMap`（下一帧 rAF）之前，故**引擎创建、竖栏「连线」可用性、右键勾选态**在同一次加载里一起对齐磁盘真值。③**刻意不做的三件事**：ⓐ 不改 `applyLayout` 的「会话值相等即早退」——缓存为空时它正是**唯一的安全行为**（否则点「已勾选」项会把种子值写进文件、覆盖读不到的声明）；ⓑ 不为勾选态新开一条「正文 YAML 解析」的读数源（要与 `splitFrontmatter` 的围栏 / BOM / 块标量口径再对齐一遍，等于第二处「文件头形态」知识，且与 MetadataCache 两处判断会互相打架）；ⓒ 不改 `syncDeclaredLayout`——它本来就以声明为准。④**测试**：`tests/view-layout.test.ts` **+1 例**（源码契约：复问存在且早于 `initMindMap`），全量 **89 文件 / 2498 例**。⑤**行数**：`features/view.ts` 1387 → **1399**（两表已 `--fix-lines` 回填）。⑥**发布物**：版本号 0.2.6 → **0.2.7**（`package.json` / `package-lock.json` / `manifest.json` / `versions.json` 四处同步，`minAppVersion` 保持 1.13.0），新增 `docs/release-notes-0.2.7.md`（中英双语：布局入属性 + 单键断代 + 嵌入 `%%layout: …%%` + 保存基线作废，含破坏性变更与回滚到 0.2.6 的操作指引），`markdown-mindmap-standard.md` 的「核对依据」版本号同步为 **0.2.7**。


> **2026-10-29 测量残渣批（实机噪声：离屏测量副本进无障碍树，K152）**：①**症状**（上一轮实机记为「记录但未改的既有噪声」）：画布容器 `-99999px` 处常驻一份「最后一次测量」的节点内容副本，含 4 个任务的图 `document.querySelectorAll('.mindmap-node-task')` 返回 **5**；副本里的 `span[role=checkbox]` 带 `aria-label`，而 `-99999px` **不**移出无障碍树 ⇒ 读屏用户多遇到一个孤立复选框（这才是必修理由，「查询多算一个」只是旁证）。②**成因**（vendor，非本插件）：`Node.measureCustomNodeContentSize` 每次测量**开头**自己 `innerHTML=''`、**测完不清** ⇒ 残渣恒定 1 份（不是泄漏，但永远在）。③**修法**：新增 `engine/mindmap.clearMeasureResidue`（清空内容 + 给容器戴 `aria-hidden` 与 `inert`，**幂等**：属性与内容都已到目标态时一个写操作都不做——渲染结束是高频点，不做无变化的变异；四类 no-op 防御）。**两个属性不是给「已清空的内容」用的**：清空只消灭此刻的残渣，`reRender(['custom'])` 之类不发 `node_tree_render_end` 的路径会让副本长回来、最长活到下一次整树渲染结束，属性则一直在，把那段窗口一并隔离；`inert` 补的是 `aria-hidden` 管不到的**焦点**（副本里 `a[href]` / 代码块复制按钮能被 Tab 聚焦到屏幕外）。注册点唯一——`createMindMap` 内 `mindMap.on('node_tree_render_end', () => clearMeasureResidue(mindMap))`：**时机只能是渲染结束**（容器可能早在创建期就被批量预测量建好，且渲染过程中持续填充，只有该事件才是「本轮测量都已完成」的稳定点；测量本身是同步「建 → append → 取 rect」，清空不会打断后续读取）；注册在 `createMindMap` 内 ⇒ 视图与只读嵌入两个创建点一并覆盖。④**清空安全三条**（缺一条都不足以定论）：下一次测量本就先自清再填；批量预测量用 `__preMeasuredContentMap` 持有元素本体（进容器的只是 `cloneNode`，且它末尾自己就清）；测量缓存内容寻址（键 = `xmlns` 后的 `outerHTML`）不在该元素里。`inert` 只作用于交互与无障碍、不改布局 ⇒ `getBoundingClientRect` 照常。⑤**测试**：新增 `tests/engine-measure-residue.test.ts`（**4 例**：清空 + `aria-hidden` / 幂等 / 四种 no-op / `createMindMap` 注册点源码契约）；另修两处**引擎桩缺 `on`**（`mindmap-codeblock` / `mindmap-wiki-icon` 的 FakeMindMap 只有 `addPlugin`/`resize`，真实 d.cts 有 `on`——桩补齐事件面）。全量 **95 文件 / 2553 例**。⑥**实机**（Obsidian 1.14.4，重建产物 → 复制 → `reload` → `enablePlugin`）：修复前 `boxes=5`（任务 4）；修复后 `boxes=2`（样例 2 任务）、`hostKids=0`、`hostAria=true`、`inert=true`，**切换任务触发重渲染后仍为 2 / 0 / true / true**，可见 `foreignObject` 高度 29/27/26/26/26 与既有口径一致（清空与 `inert` 均未影响测量），`dev:errors` 干净。ⓘ 复验时踩到一次**环境侧假故障**：Obsidian 窗口被遮挡 ⇒ `document.visibilityState=hidden` ⇒ 引擎初始化用的 `requestAnimationFrame` 不执行（`pendingInitRaf` 恒非空、`view.mindMap` 为 null、`dev:errors` 干净），把窗口切到前台后自愈——**别把它判成「打开导图不出引擎」的缺陷**。⑦**文档**：`AGENTS.md` 决策表新增「引擎离屏测量容器的残渣」行（含两条禁令：勿改成只在销毁时清、勿试图给副本加标记）；`conventions.md` 新增 **K152**（区间 → K1–K152）；`architecture.md` 的 tests 清单补本文件。⑧**行数**：`--fix-lines` 回填两表 1 行（`engine/mindmap.ts` 677 → **732**）；超限文件数仍 **33**。⑨**同批复核补强**：`inert` 与「幂等守卫」是在实机复验 `reRender` 边界后加的——`aria-hidden` 只管无障碍树，副本里的 `a[href]` / 代码块复制按钮仍能被 Tab 聚焦到屏幕外；而单节点重渲染不发 `node_tree_render_end`，残渣会长回来，故隔离属性必须**持久**（不能只靠清空）。测试同步改为断言「第二次调用零写操作」与 `inert` 存在。

> **2026-10-29 配色批审核（未提交区：`THEME_LINK_COLOR` 收口与注释订正）**：①**漏收口一处**（唯一实质改动）：`EXTERNAL_LINK_STYLES.color` 仍是手抄的 `var(--link-external-color, var(--link-color, #7f6df2))`——少一级 `--text-accent`，与同批已改成 `var(--link-unresolved-color, ${THEME_LINK_COLOR})` 的 `UNRESOLVED_LINK_STYLES` 不同构，正是硬规则 5 要拦的「第二份兜底链」；改为 `` `var(--link-external-color, ${THEME_LINK_COLOR})` ``。行为差异只出现在最深一级兜底（`--link-external-color` 与 `--link-color` 都缺失时，退 `--text-accent` 而非直接 `#7f6df2`），方向与「跟主题」一致。②**注释订正**：`THEME_LINK_COLOR` 与文件头把「跟主题的**强调色**」改为「**链接色**」（键是 `--link-color`，accent 只是兜底）；`taskMarkColor` 的文档写准两条判据（着色节点的 `ink` 出自 `domain/color.nodeInkColor`，纯白必为小写 `#ffffff`；主题分支是 CSS 变量、构建期测不到亮度）与 lint 绕行的真实机理（规则按 AST 拦「赋值右侧直接是字面量」，把 `var()` 藏进 `return` 即合规，与 `Object.assign(el.style, 表)` 同类）；`TAG_STYLES` 补「`color-mix` 按 premultiplied 插值 ⇒ 结果恰为 `rgba(<链接色>, 0.14)`」与「第三方 SVG 编辑器不支持该函数 ⇒ 底色退 transparent，是已知降级、别补第二份 rgba」。③**导出侧结论**（`THEME_LINK_COLOR` 文档；审核批原判「注入取声明值 ⇒ 会丢色」，**实机证伪并订正**）：`getComputedStyle().getPropertyValue('--x')` 对自定义属性已完成 `var()` 替换——默认主题 `--link-color: var(--text-accent)` 实测取到 `hsl(210, 100%, 50%)`、`--text-on-accent: var(--my-ink)` 取到 `#00ff00`，注入的恒是字面量，无需把依赖变量逐个登记。边界也对称：引用目标未定义 ⇒ computed 为空串 ⇒ 导出侧 `!value` 跳过、`var()` 落备用值，屏上同时退 `--text-accent`（实测 `--link-color: var(--nope)` → `''` / `rgb(0, 128, 255)`）。④**命名**：`buildTaskCheckbox` 的 `fill`（同时用于 `borderColor` 与 `backgroundColor`）改为 `accent`。⑤**测试 +2 断言**（例数不变）：外链 `color` 断言含 `var(--text-accent`（锁「复用整条链」，手抄版必红）、同源用例加 `anchors` 长度断言（避免解构失败时 `?.` 静默比较 `undefined === undefined`）。⑥**文档**：K151 ① 补两个下级消费者、③ 补注入前提、⑥ 补外链断言；K95 ① 的 `node-inline-content` 指正为 `node-inline-html`（2026-10-16 已拆出，本行长期未跟）。⑦**行数**：`--fix-lines` 回填两表 1 行（`features/node-inline-html.ts` 1087 → **1110**）；`platform/export-svg-postprocess.ts` 仍 **300**（本次只换同一行文字，不加行）。⑧门禁：全量 **94 文件 / 2549 例** 全绿、`eslint --max-warnings 0` 零输出、`check:gates --dry-run` 行数对账一致；`verify:visual` 未跑（本轮无 DOM 结构变化）。⑨**实机（Obsidian 1.14.4 / 默认主题，重建 `main.js` → 复制三件套 → `obsidian reload` → `enablePlugin` 后 `dev:errors` 干净）**：ⓐ 屏上——未着色节点的复选框描边与完成态填充 = `rgb(0,128,255)`（= `--link-color`）、勾色 `rgb(255,255,255)`（= `--text-on-accent: white`）、标签 pill 文字同色且底 `color(srgb 0 0.5 1 / 0.14)`（证实 premultiplied 14%）；着色节点（`%%#89CFF0%%` 及其子节点继承）复选框与 pill 走 `rgb(17,24,39)` / chip `rgb(151,213,242)`，不与主题混。ⓑ 跟主题——把 `--link-color` 覆盖为 `#e91e63` 后复选框描边、pill 文字与底色（`color(srgb 0.913725 0.117647 0.388235 / 0.14)`）**全部即时跟随**，无需重渲染；本轮要修的「改强调色纹丝不动」确已消失。ⓒ 导出（`doExport.export('svg')` 后解 base64）——注入段含 `--text-on-accent: white`、`--link-color: #e91e63`（跟到宿主覆盖值），`color-mix(...)` 原样保留在内联样式里；把导出 SVG 画进 canvas 取像素直方图，出现 **`219,237,255` × 1570 px**（= 白底 + 14% `rgb(0,128,255)`）与改色后的 **`220,242,234`**（= 白底 + 14% 绿），证明 pill 底色在导出产物里**真的存在**，不是回退成透明。ⓓ 交互未回归——派发 `mousedown`/`click`/`dblclick` 后该行文件由 `- [ ]` 变 `- [x]`（行首三字符之外逐字未动），DOM 复选框随之翻转。ⓔ 遗留噪声（既有、非本批引入）：画布容器 `-99999px` 处的引擎离屏测量副本会留一个不可见的 `.mindmap-node-task`，`domBoxes` 比任务节点数多 1，不影响观感与命中。⑩**本轮自我订正**：审核批写进代码/K151/本日志的「注入取声明值 ⇒ 主题把变量指向别处会丢色」经实机**证伪**（见 ③），三处措辞已一并改写——别再把「依赖变量也要进白名单」当结论。

> **2026-10-29 配色批二审（未提交区：注释与常量收敛）**：①**注释错值订正**（唯一实质错误）：`taskMarkColor` 的文档写「`#111827` 深勾」，实现是 `#1f2937`；同批把该深勾色提为 `TASK_MARK_DARK`，文档改指向常量，并写明「B 方案下填充恒浅 ⇒ 实际总走白勾，深勾分支留给 data 里出现深 fillColor（旧数据 / 外部写入），是防御而非死代码」——这个前提此前没人写下来，读者会当死代码删掉。②**测试不再复述实现**：`view-node-task` 的着色分支原断言 `ink === '#ffffff' ? '#1f2937' : '#ffffff'`（把实现的三元抄进测试，且恒走 else），改为「`ink === '#111827'` + 白勾」两条字面量断言；另 **+1 例**覆盖深 fillColor 的防御路径（`#1e3a8a` ⇒ 墨白 ⇒ 盒底白 ⇒ `#1f2937` 深勾）。③**魔法数收口**：`nodeContentTones` 的表格线比例 `0.45` 提为 `BORDER_INK_MIX`，与 `CHIP_MIN_CONTRAST` / `CHIP_SHIFT` / `CHIP_SHIFT_TOWARD_INK` 并列——该函数此前是「三个具名常量 + 一个内联数字」。④**注释精度三处**：`forest` 的色相读数按 LCh 复测订正（h 133 → **135**、与薄荷「拉开 49°」→ **47°**；ΔE 38.5 / 5.8、白字 5.00 → 5.08 三项复测无误）；`nodeColorScale` 与 `NODE_FILL_MIX` 的「L\*≈92、C\* 5–10」改为「L\*≈91–93、C\* 6–10（石板 C\*≈2 是刻意的降噪档）」——石板实测 C\* 1.7 不落在原区间；`chip` 的触发条件「已贴边（偏了也看不出）」改为真正的判据「偏 12% 后与底色对比 < `CHIP_MIN_CONTRAST`」。⑤**语义澄清两处**：`readNodeTones` 补「`fillColor` 已是主色混白的浅档，不是指令里那个 hex」（否则读者会把派生墨色当成对指令色取墨）；`mindmap-colors` 文件头漏列的 `borderColor` 补齐（实现一直是四个键）。⑥**结构**：`clearMeasureResidue` 的内联 vendor 形态提为具名 `EngineMeasureCache`，函数体只剩一行取值；**接口刻意放在函数文档之前**——两段 JSDoc 相邻会把函数文档挂到接口上（2026-10-28 清理批在 `node-inline-editor` 修过同一形态）。⑦**测试代码**：`engine-measure-residue` 的 `asMindMap(host: Element)` 放宽为 `object`，去掉调用处两处 `as unknown as Element` 双重断言。⑧**行数**：`--fix-lines` 回填两表 5 行——`domain/color.ts` 355 → **359**、`engine/mindmap.ts` 732 → **737**、`features/node-inline-html.ts` 1110 → **1121**，外加上一轮**漏回填**的两条：`core/i18n.ts` 661 → **665**、`core/constants.ts` 825 → **826**（玫瑰配色的词条与选项表，上轮只回填了改行的两个文件）。⑨门禁：全量 **95 文件 / 2558 例**、`eslint --max-warnings 0`、`knip`（files/exports/types 无输出）、`verify:visual --require-chrome`（含 scale 的「无测量垃圾」探针）全绿，`build` 通过。⑩**实机（Obsidian 1.14.x，重建产物 → 复制三件套 → `reload` → `enablePlugin`）**：B 方案与玫瑰配色全项通过——`%%#89CFF0%%` 及全部后代 data = `fill #ecf7fd` / `line`+`border #89cff0` / `color #111827`，画布 `path.smm-node-shape` 实测同值且 `stroke-width: 0`（无边框下颜色只服务小地图墨色）、连线按子树取主色（`#89cff0` / `#7c5cd6` / `#3f7c2f` 各自成套）；着色节点的内容派生实测 chip `#d6e1e8`（= `mix(#ecf7fd, #111827, 0.1)`）与实心黄高亮；节点右键与空白右键的「配色」子菜单均含「玫瑰」且 `mod-checked` 落位正确；K152 在 24 任务样张上 `domBoxes` = **24**（修复前 25）。**唯一用户可见的兼容影响**：`forest.light.rootFill` 由 `#2f7d5a` 改为 `#3f7c2f` 后，存量 `%%#2f7d5a%%` 节点**显示不受影响**（`line`/`border` 保留旧值、填充按旧主色派生），但节点右键菜单勾在**「自定义」**而非「森林」（2026-10-29 实测坐实）——勾选态与正文指令严格等值比较，这是「改预设色值」的固有代价；**不**改写存量指令（会破 `mdRaw` 逐字保真），用户重新点一次「森林」即写入新值。

> **2026-10-28 清理批（任务复选框 / 标签：死代码 / 注释 / 文档对账）**：①**死代码**：`features/node-inline-editor.RawWriteOptions.history` 从未被任何调用方传 `skip`——多选改色靠引擎 `addHistory` 自带的 100ms 防抖合并成一条，不需要「逐条跳过 + 批量补一条」这套备用面；删除该字段与对应守卫（注释同步改写，别再把它当可选项）。②**死判定**：`features/node-inline-tokenize.pushInlineText` 的合并网格里两处 `!segment.escaped` / `!last.escaped` 在 `local` 上恒为真（转义标记在重建段对象时已摘掉）——删掉，避免读者去找「谁会在这条路径上写 escaped」。③**收口一份判定**：新增 `core/event-binder.elementFromTarget`（跨 realm 的事件目标 → 元素），`view-node-task` 与 `view-tag` 原本各写一份 `typeof closest === "function"` 的能力判定 → 共用；放 core 而非 `features/view-common` 的理由写在该函数注释里（嵌入路径的模块图不该为八行能力判定拖进 vendor，`view-tag.test.ts` (实测会因 `document is not defined` 红）；同批在 `AGENTS.md` 决策表补「事件目标 → 元素（含 popout 跨 realm）」行、`conventions.md` K150 补⑧。)④**去第二份字面量**：`node-inline-html` 的 `#7f6df2` 出现两处（标签 pill 文字色 / 复选框描边）→ `NODE_ACCENT_FALLBACK` 一处。⑤**注释订正 5 处**：`node-inline-editor` 的 `applyRawNodeContent` 文档与 `RawWriteOptions` 文档**错位**（两个 JSDoc 叠在接口上方，函数文档悬空）→ 各归其位，并在函数文档补「本通道恒记一条撤销快照」；`node-inline-html` 的 `/** 段序列 → HTML 元素（文本节点 + 锚点） */` 悬在 `TAG_STYLES` 上（实指 `buildContentElement`，且已不止文本 + 锚点）→ 移回并补全形态；`TAG_STYLES` 文档把标签点击归给 `view-wikilink`（实为 `features/view-tag`）→ 订正；`InlineSegment.escaped` 文档写「值随段对象透传无副作用」（实为装配时丢弃）→ 按实现改写；`view-node-actions.hasAnyContent` 与其 `purgeLinkChannels` 的口径清单漏「任务状态」→ 补齐。⑥**测试**：`tests/event-binder.test.ts` **+2 例**（`elementFromTarget` 的能力判定与空值），全量 **94 文件 / 2545 例**。⑦**文档对账**：`architecture.md` 目录树补 `domain/md-task.ts`（判定/合成唯一实现）、`platform/tag-search.ts`（私有触点）、`features/view-node-task.ts` / `view-tag.ts`（`view-*.ts` 20 → **22**）与 `engine/mindmap-history.ts` 的 `recordHistory`，`node-inline-tokenize` / `node-inline-html` 两行补标签切分与复选框装配；tests 清单补 5 个新文件（`md-task` / `node-inline-tag` / `view-node-task` / `view-tag` / `tag-search`）。⑧两表按 `countSourceLines` 回填 **3 行**（`--fix-lines` 复验 0 漂移）：`features/node-inline-editor.ts` 438 → **439**、`features/node-inline-html.ts` 1036 → **1051**、`features/node-inline-tokenize.ts` 1419 → **1421**；登记行仍 **34**（实测 >300 行 **33** 个——`md-open.ts` 285 行保留登记；本批 4 个新源文件最大 138 行，未越线）。
> **2026-10-28 配色批（任务复选框 / 标签 pill：与 Wiki 链接同源，K151）**：①**口径**（用户裁决「A. 严格同链接」）：未着色节点的内链文字 / 标签 pill 文字 / 复选框描边与完成态填充共用唯一常量 `THEME_LINK_COLOR`（`var(--link-color, var(--text-accent, #7f6df2))`）；删除把 Obsidian 默认强调色钉死的 `NODE_ACCENT_FALLBACK`（`#7f6df2`）——此前改强调色 / 换主题时 pill 与复选框纹丝不动（硬编码字面量），是本轮唯一缺陷面。②**派生底色**：pill 底 = `color-mix(in srgb, <链> 14%, transparent)`；14% 落在兜底 `#7f6df2` 上与旧 `rgba(127, 109, 242, 0.14)` 等价 ⇒ 无主题变量环境（导出回退）观感不变。`color-mix` **首次进入导出产物**（`styles.css` 里用过，但那份 CSS 不进导出 SVG），实机导出 PNG 必验。③**勾色**：底色既为 CSS 变量，构建期测不到亮度 ⇒ 原 `ink === '#ffffff'` 判定收窄为**仅着色节点**，主题分支改 `var(--text-on-accent, #ffffff)` 并进 `CSS_VARS_TO_EXPORT`（漏登记则导出静默回退白勾）。抽 `taskMarkColor` 而非内联三元：`box.style.color = <字面量>` 会踩 `obsidianmd/no-static-styles-assignment`（本轮实测红灯）。④**不动度量**：明确不接 `--tag-size` / `--tag-weight` / `--link-weight`——会破 K114 的测量缓存键（键 = `outerHTML`，不含变量值）。⑤**测试**：`node-inline-content.test.ts` **+1 例**（三者 `color` **逐字相同**的同源断言）、`node-inline-tag.test.ts` / `view-node-task.test.ts` 断言升级（主题分支含 `var(--link-color` 与 `color-mix`；着色分支 `toBe(tones.ink/chip)`；任务侧 +2 例）、`export-svg-postprocess.test.ts` **+1 例**（`--text-on-accent` 在白名单内），全量 **94 文件 / 2549 例**。⑥**文档**：AGENTS 决策表「任务列表项」「标签 `#tag`」两行补配色口径；`conventions.md` 新增 **K151**（K 区间 → K1–K151）。⑦**行数**：`features/node-inline-html.ts` 1051 → **1087**（两表 `--fix-lines` 回填）；`platform/export-svg-postprocess.ts` 300 → **300**（加白名单一项后压回——文件头两处注释合并，不为一行越线新开豁免条目）；登记行仍 **34**。

> **2026-10-31 联系批（关系连线，K153 / K154 / K155）**：新增 7 个源文件，其中 **3 个超限并已登记**：`src/domain/relation.ts`（605，指令段判定与行内兼容形态共用一遍扫描）、`src/engine/mindmap-relations.ts`（777，引擎侧唯一收口面：映射 / 补画 / id 集合 / 引用集合 / 线色 / 画布坐标）、`src/features/view-node-relation.ts`（781，全部编辑入口）；其余 4 个在 300 行以下（`relation-anchor` 225 / `view-relation-anchor` 265 / `menu-submenu` 196 / `modal-relation-label` 71），不登记。`src/features/view-context-menu.ts` 530 → **544**：级联子菜单实现整体搬到 `ui/menu-submenu.ts`（约 −60 行）之后又加了「联系」直落条目与本批的分隔组（约 +74 行），净增故上调。**同批清理**（未提交区收口）：几何回写改为「只补 `geo`、按目标 uid 认领」，`applyRelationPlan` 的 `changed` 只在真正写键时置位（原「文件里没有 `geo=`」每轮同步都判成有变，等于每帧重画线条）；`domain/relation` 删掉只写不读的 `phase` 与不可达分支；`md-outline.flushPlain` 去掉冗余的 `firstContent`。全表按 `countSourceLines` 复测，**10 行回填**（两表同批，`npm run check:gates -- --fix-lines`）：`relation.ts` 561 → 605、`mindmap-relations.ts` 773 → 777、`view-node-relation.ts` 744 → 781、`view-context-menu.ts` 530 → 544、`i18n.ts` 681 → 689、`view.ts` 1425 → 1430、`view-node-actions.ts` 734 → 736、`md-outline.ts` 815 → 814、`constants.ts` 867 → 868、`mindmap.ts` 772 → 773。未登记超限文件数仍为 **0**。

> **2026-11-02 实机验证批（纯浏览不写盘 K156 / 导出进度提示 K157）**：①**问题来自实机走查**（Obsidian 1.14.4，库 `Mindmap Studio`）：纯打开再关闭会重写文件（`mtime 13:10:27.577 → 13:10:28.693`，**未关闭视图**）、首次含公式导出 24 025 ms 无任何提示、大图 fit 后 1 388 个节点常驻 DOM 不再回收（后者**未修**，记入待办）。②**修法一**（K156）：`SavePipeline.loadedContent` + `markLoaded(file, tree)`——加载完成、引擎建好后记下该文件的序列化结果，`save()` 与本轮序列化逐字相同即跳过写盘；跳过时仍按磁盘当前内容建立 `lastWritten`（P1a 不失效），且**只在加载路径记录**（引擎重建不记）。③**修法二**（K157）：`features/view-export.ts` 的 `showExportProgress`——超 400ms 才弹常驻 `Notice`，`finally` 撤；新增双语 key `export.exporting`；`tests/mocks/obsidian.ts` 的 `Notice` 补 `hide()`。④**实机**：松散列表 + 连续双空行的文件打开 3s 再关闭，内容与 `mtime` 逐字不变；改一个节点 → `- 一改` 正常落盘；编辑后 120ms 内关闭也不丢；阈值临时置 0 复验通知路径（131ms 出现、结束归 0），恢复 400ms 后快速导出不弹；`dev:errors` 干净。⑤**测试 +8 例**（`save-pipeline.test.ts` +5：未编辑不写盘 / 编辑照写 / 跳过仍建基线 / 重新 markLoaded / 未记基线照旧；`view-export.test.ts` +3：慢路径弹并撤 / 快路径不弹 / 失败也撤），全量 **99 文件 / 2673 例**。⑥行数：`services/document-service.ts` 396 → **445**、`features/view.ts` 1429 → **1436**、`features/view-export.ts` 82 → **116**、`core/i18n.ts` 689 → **692**、`tests/save-pipeline.test.ts` 883 → **952**、`tests/view-export.test.ts` 428 → **488**；超限文件数不变（`document-service.ts` 早已登记）。⑦`baseline-metrics.md` 复测：G-03 **2673**、P-01 `main.js` **686 948 B** / gzip **209 197 B**。

> **2026-11-02 实机走查第二批（收尾一致性自检 K158 / 两态开关无障碍 K159；撤回一条误报）**：①**P3 撤回**：上一批报告的「大图 fit 后离屏节点不再回收」**不是缺陷**——实机用官方 `view.enlarge()/narrow()` 与真实拖拽平移复测：`view.fit()` 后 1382 → 放大到 1.229 后 **52** → 缩到 0.2 后 307 → 平移到空白处 **1**，引擎裁剪全程正常。此前的「1388 常驻」是探测假象：直接赋值 `mm.view.scale` 绕过了引擎的 `scale` 事件，节流裁剪自然不触发；「总览」把全树物化是**必要**的（要看全图就得渲染全图），下一次缩放/平移即回收。②**P4**（K158）：勾选未落盘只见过一次且未复现，根因未定位（陈旧快照 / 重入 `pendingTree` 两类都可能），故按**不变式 + 自愈**落地：排空收尾用同一 `serialize` 再算一次活快照，与刚写出的不同即 `schedule()` 补排，每路径最多 3 次（超限只 `console.warn` 一次）；**冲突跳过与写盘异常两种收场不补排**（预期态，补排会把冲突刷成重试风暴）。③**P5**（K159）：竖栏「边框 / 连线」补 `aria-pressed`（构建一次 + 每次 `syncState()` 重挂，因 `setTooltip` 会重写 `aria-label`）；口径＝图标所示那一档；置灰态不写。④**实机**（Obsidian 1.14.4）：`aria-pressed` 初始 `[true, false]` → 各点一次 `[false, true]`，`aria-label` 仍为纯名字；勾选任务后文件写出 `- [x] 乙`、DOM 与文件一致、`dev:errors` 干净（未见补排告警）。⑤**测试 +7 例**（`save-pipeline` +4：陈旧快照补排并追平 / 一致时空转 / 冲突收场不补排 / 每轮都变时 4 次封顶；`view-toolbar` +3：初始按下态 / 切换翻转且 label 未被抹掉 / 置灰不报），全量 **99 文件 / 2680 例**。⑥行数：`services/document-service.ts` 445 → **519**、`features/view-toolbar.ts` **296**（裁注释回到 300 以内，未新增豁免）、`tests/save-pipeline.test.ts` 952 → **1023**、`tests/view-toolbar.test.ts` 641 → **680**；超限文件数仍 **37**（未登记数 0）。⑦`baseline-metrics.md` 复测：G-03 **2680**、P-01 `main.js` **687 687 B** / gzip **209 469 B**。

> **2026-11-02 同批自审（拣出三处自己的坑，均当场修）**：①**中**：收尾一致性自检原本对**所有** save 生效——卸载路径的 `cancelTimer()` 在 `save()` 之前，若在此补排就产生新定时器，它会活过视图拆卸、落在刚加载的下一个文件上（那时 `loadedBody` 还没记录 ⇒ 一次补排 = 打开即重写，正好是本批要消灭的行为）。改为**只对自动保存**（`checkExternal`）；显式保存的调用方本来就在同一 tick 抓新鲜快照，没有「陈旧」可言。②**中**：纯浏览守卫原先把**文件头**算进判据——用户在属性面板改 frontmatter / 切布局（管线从不改文件头、恒回贴磁盘值）会让正文被规范化一遍。拆出 `buildBody` / `wrapBase`，判据只比正文；新增 2 例锁定（只改属性不写盘 / 纯浏览跳过不补排）。③**低**：自检原用 `serialize`（正文+头），与守卫的判据不同源；统一为 `buildBody` 后删掉已无调用点的 `serialize`。④**反证（防线未被削弱）**：实机用 `processFrontMatter` **绕过插件**改布局后再编辑节点，P1a 正确拦下（`externalConflictNotified` 含该路径、文件未被覆盖）——证明「跳过写盘时仍建 `lastWritten`」没有把外部改动检测做废。⑤**实机末验**（最终构建）：松散列表文件打开 3s 再关闭 **逐字不变**（`diff` 空）；改节点 → `- 甲改了` 落盘；`aria-pressed` 初始/切换正确；`dev:errors` 干净。⑥行数：`services/document-service.ts` 445 → **531**（豁免表已回填、「逐行一致」绿灯）、`tests/save-pipeline.test.ts` 952 → **1066**、`tests/view-toolbar.test.ts` 641 → **680**；全量 **99 文件 / 2683 例**。⑦`baseline-metrics.md` 复测：G-03 **2683**、P-01 `main.js` **687 669 B** / gzip **209 466 B**。

> **2026-11-02 撤销链与写盘守卫批（实机走查定位）**：①**P0-1**（K160）：引擎创建后命令历史为空，`addHistory` 只在命令收尾调用 ⇒ 第一条快照永远是「第一次改动之后」的状态，`Ctrl+Z` 因 `index - 1 < 0` 静默空转（实机：打开后 `history 0/idx 0`，勾选复选框 → `1/idx 0` → `BACK` 无反应）。修法：`mindmap-history.seedInitialHistory` 在 `createMindMap` 挂一次性 `node_tree_render_end`，**首帧渲染落地**时用**非防抖**的 `originAddHistory` 播种（创建瞬间的树还没被规范化，`expand` 等字段渲染期才补 ⇒ 那时播种会多出一条按了没反应的历史）。②**P0-2**（K160）：K156 的纯浏览守卫只看「本轮序列化 == 加载时序列化」，不看磁盘现状 ⇒ 本会话写过盘之后「撤销回加载态」被整轮跳过，屏上原样、文件改后、关闭重开又跳回改后。修法：守卫加 `wroteSinceLoad`（`markLoaded` 复位、`vault.modify` 成功置位），成立时写回**加载时的原样正文** `loadedRawBody`（`MdParseResult` 新增 `body`，`DocumentService.load` 透传），避免把没编辑过的行规范化。③**P1**（K161）：5000 节点首帧实测**单个长任务 2043–2393 ms**（插件处理链仅 5.1 ms，其余全在引擎 `_render`）；新增 `.mindmap-render-hint` 大图提示（阈值 1000，rAF 内创建 ⇒ 长任务前上屏，首帧结束摘除，15 s 兜底）。④**未做**：卸载路径覆盖外部改动（既有裁决，缺留痕）、切布局后 `forgetBaseline` 使 P1a 基线作废（窗口内他处改动会被覆盖）——均记入待办，未改行为。⑤**实机**（Obsidian 1.14.4，按真实手势复演）：首个动作即勾选 → `2/idx 1` → `BACK` 文件**逐字**回到原样；点节点改字 → Enter（落盘）→ `BACK` → 关闭 → 重开显示原样；纯浏览 2 s `mtime` 不变；切布局正文逐字不变；502 节点无提示、5002 节点提示出现并在首帧后消失；`dev:errors` 干净、无提示残留。⑥**测试 +9 例**（`engine-history-limit` +4：优先非防抖入口 / 缺失回落 `addHistory` / 引擎面缺失安全 no-op / 抛错只留痕；`save-pipeline` +5：撤销回加载态写回原样正文 / 卸载路径同样落盘 / 外部改写后显式保存照常写回 / 重新 `markLoaded` 复位写盘标记 / 未传 `rawBody` 回落序列化结果），全量 **99 文件 / 2692 例**。⑦行数：`services/document-service.ts` 531 → **589**、`features/view.ts` 1436 → **1513**、`engine/mindmap.ts` 782 → **794**、`engine/mindmap-history.ts` 128 → **172**、`markdown/md-outline.ts` 814 → **822**、`core/constants.ts` 866 → **882**、`tests/save-pipeline.test.ts` 1066 → **1174**、`tests/engine-history-limit.test.ts` 147 → **197**；超限文件数仍 **37**（未登记数 0）。⑧本批实测（未回填 `baseline-metrics.md`，G-03 **2692**、P-01 `main.js` **689 054 B** / gzip **209 862 B**）。

> **2026-11-02 优化批（实机验证后的收口）**：①**注释订正**：`engine/mindmap-history.seedInitialHistory` 原写「只在 `createMindMap` 内、**插件绑定事件之前**调用，`data_change` 没有任何监听者」——实为挂在 `node_tree_render_end` 上（引擎首帧渲染排在 `setTimeout(0)`），彼时 `engine-controller.renderMindMap` 早已绑好 `data_change`，播种会正常走一遍 `onRootDataChanged`（排一次自动保存 + 标题改名调度）与 `onDataChanged`（拆链检查 + 联系线几何写回）。实测三者都无事发生（保存被纯浏览守卫跳过、根文本=文件名、候选集空），但注释方向相反，按实测改写并点明「这是只读打开时唯一一次派发 `data_change` 的路径」。②**加载基线与大图提示改为「引擎就绪时消费」**：`initMindMap` 在容器 0 尺寸（后台标签/折叠面板）时只挂 ResizeObserver 等待、`getDataSnapshot()` 为 null ⇒ 原先在 rAF 里直接 `markLoaded` 会被其空守卫**静默吞掉**（该文件此后每轮自动保存都不再算「纯浏览」，打开即重排全文）；`showLargeMapRenderHint` 同理绑不上 `node_tree_render_end`，提示只能等 15 s 兜底（不透明遮罩盖住画布）。故新增 `features/view.recordLoadedBaseline` + `LoadSession.pendingBaseline` / `pendingRenderHint`，由 `onEngineReady` 补记/补建（常规路径在加载回调里即消费，时序与原实现等价；设置刷新重建不写 pending，不会把未落盘编辑误标成基线），`onUnloadFile` / `onClose` 丢弃未消费的 pending。③**自检只对写过盘的轮次**：`SavePipeline` 收尾一致性自检加 `wroteDisk` 前置——没写盘的轮次只有「纯浏览跳过」与「磁盘已等价」，磁盘本就等于本轮序列化结果，活快照若再变只可能是新编辑（它自己会排下一轮），省掉大图每轮一次全树序列化。④**测试 +1**（`save-pipeline`：「纯浏览跳过写盘的一轮不做自检」——`markLoaded` 后跳过写盘、活快照再变也不得补排），全量 **99 文件 / 2693 例**。⑤行数：`features/view.ts` 1513 → **1565**、`features/view-load-session.ts` 66 → **94**、`services/document-service.ts` 589 → **600**、`engine/mindmap-history.ts` 172 → **183**、`tests/save-pipeline.test.ts` 1174 → **1193**；两表同批 `--fix-lines` 回填，超限文件数与未登记数不变（0）。

> **2026-11-04 性能/体验批（P0 三项 + U1 保存状态）**：①**P0-1 派生色阶缓存**：`domain/color.nodeContentTones` 加内容寻址 `Map`（上限 64、LRU 提升、键为归一 `#rrggbb`），返回值字段改 `readonly` 供共享；实测单次 2.359 → **0.129 µs**（20 万次同值调用），5000 节点全着色打开预期省 **≈22 ms**（预测量 + 正式构建各一次）。②**P0-2**：`view-dnd` 的 `dragover` 去掉每事件 `Array.from(types)`，改下标循环；行为表驱动用例不变。③**P0-3**：`vitest.config.ts` 全局 `testTimeout` 30 s → **5 s**，5 万级深树用例改挂用例级 `{ timeout: 30_000 }`。④**U1 保存状态**：`StatusBarService` 增加 `showSaveState`（`idle/saving/saved/unsaved`），服务内部持 `count` + `state` 组合渲染（`N 个节点 · 已保存`）；`SavePipeline.schedule()` 返回「是否真的排上」，`SavePipelineDeps` 增加 `onSaved`（排空成功、含无差异跳过才回调；冲突/异常不回调），视图按 `getActiveViewOfType` 只在前台写入，换文件复位 `idle`。ZH/EN 各 +3 键。⑤**实机**：`scheduleSave()` 同步显示 `22 个节点 · 保存中…`，2 s 后 `22 个节点 · 已保存`（`saveState="saved"`），`dev:errors` 干净；配色夹具 22 节点 / 22 自绘内容 / 10 个着色内容与改动前一致，码块派生色仍为实色。⑥**门禁**：全量 **102 文件 / 2775 例**、lint 0 warning、死代码通过、`verify:visual` 15 场景全通过；打开基准同轮 530/820/1188 ms（DOM 与内部节点计数逐列与 §2 一致，不作回归判定）。⑦行数：`features/view.ts` 1645 → **1688**、`services/document-service.ts` 600 → **619**、`services/status-bar.ts` → **115**、`domain/color.ts` → **393**、`features/view-dnd.ts` → **600**、`features/view-context.ts` → **195**、`features/view-status.ts` → **81**、`main.ts` → **537**、`core/i18n.ts` → **747**；tests：`color-directive` → **639**、`view-status` → **439**、`save-pipeline` → **1266**、`md-roundtrip` → **2512**。未新增 >300 行文件。

> **2026-11-04 P1-1/P1-2（小地图缓存 · 选区几何）**：①**P1-1**：`view-minimap` 会话新增 `canvasSize`（画布尺寸缓存），刷新点只有引擎 `resize` 事件（vendor `resize()` 无条件派发）与 `refresh`/`applyFrame` 取样；`updateBox` 不再每帧 `getCanvasSize`（`getBoundingClientRect` 强制布局）。实机计数：连续 5 次平移的画布矩形读取 **0 次**，框仍跟手（25.8% → 22.7%）；模拟画布 883 → 500 后框宽 27.9% → 15.8%，还原后回到 27.9%。②**P1-2**：`zoomToSelection` 改布局几何，新增 `engine/mindmap-viewport.measureNodesCanvasBox`（节点 `left/top/width/height` × 当前变换；与 `projectViewportBox` 同口径），修复性能模式摘 DOM 后大选区只覆盖可见部分的缺陷；逐节点 DOM 包围盒读取随之移除。实机合成 `Shift+2`：`scale 0.7989 → 4`（钳制），节点中心落到画布中心 (441.6, 420.0)，`dev:errors` 干净。③**测试**：`viewport` +5 例（并集 / 缩放平移投影 / 视口外节点 / 逐条跳过与全空 / 变换读不到）、`view-viewport` 改写 6 例为几何口径、`view-minimap` +1 例（缓存只在 resize 刷新），全量 **102 文件 / 2782 例**。④行数：`engine/mindmap-viewport.ts` 939 → **1012**、`features/view-minimap.ts` 772 → **797**、`features/view-viewport.ts` 413 → **406**；tests：`viewport` → **800**、`view-viewport` → **693**、`view-minimap` → **792**。两表已 `--fix-lines` 回填，超限文件数与未登记数不变（0）。

> **2026-11-04 P1-3（大图拖窗 resize 尾随合并）**：①**实测**（5000 节点夹具，24 次宽度变化 / 50ms = 1.2s 拖动）：改前 100ms 节流排 **5 轮** `render()`、长任务 **4 个 / 合计 1583ms**（最长 409ms）、卡顿帧 4；改后尾随合并只 **1 轮**、长任务 **1 个 / 416ms**、卡顿帧 1。剩余单次长任务来自引擎同步布局（vendor `renderAsync` 只分片内容渲染），插件侧不可再拆。②**策略**：`onResize` 在节点数 ≥ `LARGE_MAP_RENDER_HINT_NODES`（1000）时只重置 180ms 尾随定时器，停止拖动后一次 `engine.resize()`；小图仍走 100ms 节流。`scheduleDeferredResize` 同时取消小图节流器，小图路径也取消遗留尾随；`onUnloadFile` / `onClose` 取消。③**测试**：新增 `tests/view-resize.test.ts` 6 例（小图节流 / 999↔1000 边界 / 拖动期不重排 / 窗口重置 / 取消 / 大图切小图），全量 **103 文件 / 2788 例**。④行数：`features/view.ts` 1688 → **1752**；`tests/view-resize.test.ts` **159**；AGENTS.md 测试清单 103 → **104**（新增文件名已登记）。两表已 `--fix-lines` 回填。

> **2026-11-04 U2（只读嵌入角标）**：嵌入与文件视图外观一致但没有任何编辑入口，此前没有可见标识（用户会反复尝试双击/拖拽）。在**挂引擎路径**（空态 / 超限大纲 / 失败提示之后）创建 `span.tmm-embed-readonly`：文案 `mindmapEmbed.readonly`（只读 / Read-only，ZH/EN 各 +1 键），`createSpan`（官方 API，lint `prefer-create-el` 强制），绝对定位在 `.tmm-embed` 右上角、`pointer-events: none`、不参与布局。实机（`示例/测试/嵌入示例.md`）：1 个可见角标、`只读`、36×19 px、距上 7 / 右 9 px、`opacity 0.85`、`dev:errors` 干净。视觉探针同步加断言（`.tmm-embed-readonly` 恰好一个且文案 `只读`），无头页补 `createSpan` 垫片。②测试：`mindmap-codeblock` +1 例（双语词条），CSS 契约表 4 → **5** 个类名（含角标），全量 **103 文件 / 2789 例**。③行数：`features/mindmap-codeblock.ts` 691 → **702**、`core/i18n.ts` 747 → **750**、`tests/mindmap-codeblock.test.ts` → **484**；`styles.css` **26,493 B**。两表已 `--fix-lines` 回填。

> **2026-11-05 未提交区审核（门禁 / 注释对账 / 热路径缓存）**：①**门禁红灯（唯一硬失败）**：`engine/mindmap-theme-presets.ts` 由 191 行增至 **369**（新增 `NODE_COLORS` 十套 × 填充/深线 + `nodeLineColorOf`），越过 300 行且未登记 ⇒ `check-gates` 的 line-budget 报「未登记超限 1」。按硬规则 10 登记（AGENTS.md 与 `docs/agents/architecture.md` 两表同批，豁免 35 → **36** 条、未登记超限仍 **0**）；理由：它是外观预设的**唯一数据表**（零分支），节点级填充/线条成对表与整篇色板必须同处一文件（两处共用 `domain/color` 的 HSL 阶梯），拆开就逼出第二份色板。②**死导出**：`markdown/md-outline-lines.leadingIndent` 只被同文件 `classifyLines` 消费，导出面无人引用（`check:dead-code` 属 `check-gates` 一环，会红灯）⇒ 去掉 `export`，行为不变（Tab 缩进用例在 `md-roundtrip` 已覆盖）。③**注释与实现矛盾两处**：`features/view-node-color` 的 `NodeColorOption.color` 与 `nodeColorOptions` 仍写「`PALETTES[id].light.rootFill`」，实现早已改为 `NODE_COLORS[id].fill`（节点色与整篇根色 2026-11-05 分流）⇒ 就地订正，并补「配套线条由 `nodeLineColorOf` 反查」。④**热路径（两处，与同批 `nodeContentTones` 缓存同源）**：`nodeLineColorOf` 原为每次 `Object.values(NODE_COLORS)` 新建 10 项数组后线性比较，改为模块加载期建一条 `Map` 反查表；`engine/mindmap-colors.nodeColorStyle` 补齐 64 条 LRU（键 = 指令原文 trim + 小写）——它在 `node_tree_render_end` 里逐节点调用，每次都要正则归一 + 两次对比度 + 一次色表反查，而同一支子树共用同一个指令色 ⇒ 命中率接近 100%。返回值共享只读（只经 `applyColorStyle` 逐键比较）。⑤**边界修正**：`main.refreshLanguageUi` 在活动导图存在时调 `updateStatusBar`，但引擎未建好（`mindMap === null`）时该函数走 `clear()` 分支，会把刚写上的静态标签一并抹掉 ⇒ 加 `active?.mindMap` 守卫。⑥`hasBranchLayer` 的 `> 1` 收敛为 `> 0`（`branchLayerOf` 只返回 0 或 ≥2），并把「子树里的 `%%none%%` 不被自动上色删除」写进 `applyBranchColors` 的文档（与 `orphanSentinels` 的「重新染色的分支整支保留」同口径，防后人当缺陷「修」掉）。⑦行数：`engine/mindmap-theme-presets.ts` **369**、`engine/mindmap-colors.ts` **191**、`features/view-node-color.ts` **246**、`markdown/md-outline-lines.ts` **262**；`--fix-lines` 顺带回填前批漏记的 5 行（`mindmap-nodes` 845 / `i18n` 764 / `view-context-menu` 797 / `main` 539 / `constants` 918）。⑧门禁：`check-gates` 全绿（build / 103 文件 **2805 例** / eslint / stylelint / knip / build:vendor 幂等 / `verify:visual --require-chrome`）。⑨**CI 余量**：`vitest.config.ts` 把全局超时从 30s 收到 **5s**（只为 `md-roundtrip` 的 5 万级深树留了用例级 30s），但同批有两个用例实测 2.1–2.7s（`view-dnd` 的可链接附件表驱动例、`prism-code` 的 FIFO 封顶例），慢机上约 2× 就触顶 ⇒ 这两例补用例级 `{ timeout: 15_000 }`（与深树例同一手法：**压力用例自己声明超时**，不放宽全局）。⑩**补漏两项**：a) `applyNodeColor` 的「只清哨兵那轮不刷小地图」经复核**不是缺陷**——`orphans` 在 `next === content` 早退之后、主改动落地时才收集，故「`orphans` 非空 ⇒ `colored` 为真」，`if (colored)` 一处已覆盖；试图改成 `colored || orphans.length > 0` 得到的是**不可达分支**（且「节点本无指令、只是后代挂着无意义 `%%none%%`」应走早退、**故意不动**——那一轮什么都没变，顺手改写用户没选中的子节点属越权）。已把该不变量写进注释，避免后人再加一次死分支。b) 两套色板（`NODE_COLORS.fill/line` 与 `PALETTES.rootFill`）此前只有「两者不是同一个值」的断言，色相靠人眼对齐 ⇒ `mindmap-theme.test.ts` 新增 1 例：同 id 色相差 ≤ 8°（实测最大 3.6°）、`lum(root) < lum(fill)` 与 `lum(line) < lum(fill)`，遍历 `PALETTE_IDS`（新增配色自动纳入）。全量 **103 文件 / 2806 例**。

> **2026-11-06 未提交区审核（矛盾项按代码最优解收敛，不保兼容）**：①**删死字段**：`domain/color.NodeColorScale.line` 只有测试在读，生产侧（`engine/mindmap-colors.nodeColorStyle`）走 `nodeLineColorOf`（预设配对 / 自定义按同色相深一档）。留着它就是第二份「线是什么」的定义，且与画布实际取色相反 ⇒ 删；`nodeColorScale` 收为「原色 → 填充 / 文字」，`tests/color-directive.test.ts` 的三处断言改用 `.fill`。②**决策表与预设表注释订正（同一错、两处）**：`AGENTS.md` 节点色行与 `engine/mindmap-theme-presets` 的 `NODE_COLORS` 块注释仍写「自定义 hex 无配对时线就用它本身」，实现在同批后半段已改为按 `S×0.9 / L×0.6 / 下限 22` 现算深档（release notes 写的本来就是现算）⇒ 两处改为指向现算规则与理由（浅填充配同色线在 fit 缩放下等于没有结构线）。③**「存量不受影响」订正**：边框的按文件值只存在于用户**显式切过**竖栏开关时（`services/view-state.getThemeStyle` 未记过即 undefined），从没切过的文件会跟着新默认由无边框变有边框 ⇒ `AGENTS.md` 边框行与 release notes 同步改为「显式切过才保持原值，其余跟新默认」。④**K97 收口**：`docs/agents/conventions.md` 的 ③④⑤ 仍写 `IMAGE_MAX_SIDE_PX = 480`（① 已改 320，同一条 K 自相矛盾）⇒ 三处改 320；顺带把用例数按实测更到 **51**（原写 47），并写明断言已从常量派生（上限再调不碎测试）。⑤**release notes 补漏**：首段「另修三处静默问题」实为**四处**——补上「缩进单位随文档走，改一个节点不再把全文缩进重排成 2 空格」（2026-11-06 实机，`mdIndentUnit`），ZH/EN 两侧各加一条；用例数 2806 → **2809**。⑥**索引对账**：`AGENTS.md` 与 `docs/agents/architecture.md` 的 `color.ts` 行补「删 `line`」；`--fix-lines` 顺带回填两表 15 行（前批漏记：`view.ts` **1751**、`i18n` **764**、`constants` **918**、`mindmap-codeblock` **702**、`minimap-geometry` **1503** 等），豁免表与实测逐行一致、未登记超限仍 **0**。⑦**行数**：`domain/color.ts` 504 → **509**、`engine/mindmap-colors.ts` → **193**、`engine/mindmap-theme-presets.ts` → **375**、`tests/color-directive.test.ts` → **754**、`docs/release-notes-0.3.2.md` → **163**。⑧门禁：`tsc` / vitest **103 文件 / 2809 例** / eslint / stylelint / knip / `check:release` / `check:gates`（含 `build`、`build:vendor` 幂等、`verify:visual --require-chrome`）全绿。

> **2026-11-06 未提交区审核 · 第二轮（上一轮遗留的 4 项）**：①**撤色不再两轮重渲**：`domain/color.orphanSentinels` 新增第三参 `rootDirective`（本节点**即将写入**的指令），于是「先落地主改动、再读回自己写的数据」这一步消失，主改动与无主哨兵清理合并成**同一次** `applyRawNodeContents`——渲染 / 存盘 / 历史各一次，且不再依赖 `addHistory` 的 100ms 防抖去合并两批（判据仍只有一份：十六进制 ⇒ 直接返回空，`none` / 删指令 ⇒ 照常下探）。`features/view-node-color.applyNodeColor` 相应改为「先算齐 entries 再一次性落地」。实机（`zz-审核-撤色.md`：父 `%%#c8e0e5%%` + 两个 `%%none%%`）：点「默认」→ 引擎 `command.history` **1 → 2**（一条快照）、落盘内容父指令与两支哨兵**同批消失**；`Ctrl+Z` 一次即逐字还原（含缩进与哨兵）。②**autoSave 关闭时的「未保存」**：`SavePipeline.schedule()` 的返回值由 boolean 改为 `ScheduleOutcome`（`scheduled` / `off` / `suspended` / `noFile`），`off` 分支另开一条同样防抖的**只判定**通道 `checkDirty`（取活快照 → `buildBody` → 与 `loadedBody` 逐字比较），判决经新增的 `SavePipelineDeps.onDirty(dirty, file)` 交给状态栏；`isAtLoadedState` 抽成一处，纯浏览守卫与它同源（不造第二份「内容变没变」）。视图侧 `scheduleSave()`：`scheduled` ⇒ 保存中、`suspended` ⇒ 未保存（上次写盘确实失败）、`off` 不猜（由 `onDirty` 定）。实机：关掉自动保存打开夹具 ⇒ `6 个节点 · 已保存`（没有误报）；加子节点 ⇒ `7 个节点 · 未保存` 且**磁盘未变**；`Ctrl+Z` 回加载态 ⇒ `6 个节点 · 已保存`；再编辑后切走文件 ⇒ 卸载路径照常写盘（新行落盘）。③**混合缩进保真**：`md-outline-lines.noteIndent` 不再「含 Tab 就折成单个 `\t`」，改为**原样**记录 1–8 个空格 / 制表符的任意组合；`md-serialize.readIndentUnit` 同步放宽为 `/^[ \t]{1,8}$/`（此前会把 `' \t'` 判成脏值回落 2 空格）。实机（`zz-审核-混合缩进.md`，一层为 `空格+Tab`、二层为 `空格+Tab+Tab`）：解析出正确层级；加一个子节点并落盘后既有三行**逐字未变**、新行按 `空格+Tab` ×2 写出；`Ctrl+Z` 后文件与原文**字节一致**。④**vendor 单轴自定义位置的等价性**：复核 `applyOffsets` 与原 `updateChildren` 的截断点差异，确认「无自定义」「两轴都自定义」两种情形**结果相同**（后者原实现的位移量因 getter 遮蔽恒为 0），只有**单轴自定义**（`customTop` 有、`customLeft` 无）不同；判定为**修正**（与 `updateBrothers*` 各路径一致），不改代码，`vendor/BUILD.md` 增「已知差异」段并把 A/B 用例覆盖范围写明（原「0 差异」只覆盖两轴同设）。⑤**测试**：`save-pipeline` +5（去向下沉到 `scheduled`/`off`/`noFile`、`suspended` 补断言；`onDirty` 的 5 例：基线相同 / 偏离 / 撤销回退 / 无基线不表态 / `cancelTimer` 一并取消）、`color-directive` +1（`rootDirective` 为十六进制时一律返回空）、`view-context-menu` 2 例改为「一次批量」、`md-roundtrip` +1（`' \t'` 混合缩进往返）。全量 **103 文件 / 2816 例**。⑥行数：`services/document-service.ts` 624 → **691**、`features/view-node-color.ts` → **263**、`domain/color.ts` → **519**、`markdown/md-outline-lines.ts` → **296**、`markdown/md-serialize.ts` → **963**、`features/view.ts` → **1764**；tests：`save-pipeline` → **1355**、`view-context-menu` → **2023**、`color-directive` → **776**、`md-roundtrip` → **2599**。两表 `--fix-lines` 已回填、未登记超限仍 **0**。⑦门禁：`check:gates` 全绿（build / 2816 例 / eslint / stylelint / knip / `build:vendor` 幂等 / `verify:visual --require-chrome` / `check:release`）；实机三场景 `dev:errors` **无条目**，截图 `00-开发支撑/tmp-shot-audit-2026-11-06.png`。

> **2026-11-06 开发文档优化（把「必漂的手写计数」改成机械契约）**：①**K 区间手写漂移根治**：`K1–K<n>` 在 AGENTS.md 的 docs 清单与 `conventions.md` 标题各写一次，历史上靠人工追（日志里连改过 3 次：K148 / K152 / K159）。现补两条契约测试（`tests/agents-md-sync.test.ts`）：a) 两处声明的区间必须等于 `conventions.md` 实际最大编号；b) **全仓**（src / tests / docs / AGENTS / README / `vendor/BUILD.md`）引用的 `K<n>` 都必须有 `[- [K<n>]]` 条目（防悬空）。两条均做**负向对照**：把标题改成 K1–K165 → 红灯并报「实际最大 K166」；在 `README.md` 临时加一句**悬空引用**（编号取一个尚未分配的 `K` + 199，本文不复写该字面量——否则日志自己就成了悬空引用）→ 红灯并报出文件与编号。当前实况：**163 → 166 条**、无编号缺口、无悬空引用。②**补三条决策 + K 条目**（前两轮审核只记了「不是矛盾所以不动」，这轮补齐入口）：`AGENTS.md` 决策表新增「列表缩进单位」（`mdIndentUnit`；两把尺子 `leadingIndent` / `leadingSpaces` 不可互换）、「画布几何与大图 resize 调度」（`readNodeLayoutBox` / `measureNodesCanvasBox` / `RESIZE_DEFER_MS`，两调度互斥）、「状态栏的保存状态」（`isAtLoadedState` 一份判据 / `ScheduleOutcome` 四态 / 只由活动视图写）；对应 `conventions.md` 新增 **K164**（链接与 Markdown 保真组）、**K165**（引擎/视口组）、**K166**（架构边界组），结论先行 + 依据 + 回归三件齐。③**规模数字不再逐批回填**：`docs/agents/README.md` 的规模列改为**量级**（<100 / ≈200 / ≈500 / ≈2000 行）并注明精确值现算——此前「≈1700 → ≈1700」这类无意义回填在日志里出现过两次。④**「改了什么 → 更新哪份文档」有了唯一清单**：`process.md` 新增 12 行「变更 → 文档义务」表（★ 标出由 `agents-md-sync` 机械强制的三类），硬规则 6 只留指针；同时修掉该文第 4 步「同步**本文件**『代码结构』」的歧义（实指 AGENTS.md）。⑤**查找命令写进 conventions 抬头**：`grep -n "^- \[K"` / `grep -n "\[K156\]"`，并注明区间已机械校验、不必手工数。⑥**表格渲染缺陷（既有，非本批引入）**：审计全仓 Markdown 表发现 **6 行 / 13 个**未转义的 `|` 落在单元格的**行内代码**里——`%%rel:id | 标签 | geo=…`（3 处）、`|deltaY| < 50`、任务列表正则 `(?=[ \t]|$)`、索引行的「带前导 `|`」「含 `|`/`#` 的目标」、标准文档的 `![[图.png|164]]`（2 处）。GFM 把它们当列分隔符 ⇒ 该行凭空多出几列、内容被截断（决策表最密的一行被拆成 14 列）。全部按仓库既有写法（`Del\|Backspace`）转义为 `\|`，并新增**契约五**（`tests/agents-md-sync.test.ts`：同一段连续 `|` 行视为一张表，数据行与表头列数必须一致；围栏代码块内的行跳过）——负向对照：在 README 的表里加一行 `` `a|b` `` ⇒ 红灯并报「列数 5 ≠ 表头 4」。⑦行数：`conventions.md` 1846 → **1856**、`AGENTS.md` 262 → **265**（3 行决策）、`docs/agents/process.md` 53 → **73**、`docs/agents/README.md` 41 → **52**、`docs/agents/testing.md` 206 → **230**、`tests/agents-md-sync.test.ts` 215 → **415**。⑧门禁：`tsc` / vitest **103 文件 / 2819 例**（+3 契约）/ eslint / stylelint 全绿；`--fix-lines` 无待回填项（src 未变）。

> **2026-11-06 节点配色作用范围批（K167）**：①新增全局设置 `nodeColorScope`（`subtree` 出厂＝引入前行为 / `node`），选项表 `core/constants.NODE_COLOR_SCOPE_OPTIONS` + `settings.ts` 白名单 + i18n 双语；**只在写入侧落笔**（`features/view-node-color.ts`）：`node` 档再给直接子节点补 `%%none%%` 挡住继承，渲染侧一行未改——颜色是正文内容，换库 / 换机必须同一个样子。`domain/color.scopeSentinels` 与 `orphanSentinels` 互为对偶（上色补、撤色收），父子同选时 `node` 档不折叠最上层。②**实机**（Obsidian 1.15.0；`obsidian reload` 后确认新构建 `settings.nodeColorScope === "subtree"` 已生效，窗口 `visibilityState === "visible"`、引擎 `mindMap` 非 null）：`subtree` 档给「甲」上青碧 ⇒ 甲 / 甲一 / 甲二 的引擎 `fillColor` 全为 `#c8e0e5`、文件只多一条指令；`node` 档 ⇒ **只有**甲为 `#c8e0e5`，文件多 `甲一 %%none%%` / `甲二 %%none%%`，`.smm-node` 文本仍是「甲」「甲一」「甲二」（注释不显形）；「默认」撤色把两条哨兵一并清掉、逐字回到原文；空白右键「按分支自动上色」同样跟档（甲 `#c8e0e5` / 乙 `#c5d2e8`，三个子节点各一条哨兵）；设置面板「外观」组出现「配色作用范围」（含子节点 / 仅本节点，英文 Color scope / With children / Node only），写非法值回退 `subtree` 且留痕；`dev:errors` **无条目**。顺带记录一条**既有**观感（非本批引入）：任何一次真实改色都会走序列化 ⇒ 空行归一（`# 根` 与列表之间的空行消失），而撤色回到加载态时又恢复原样，口径见 K156。③**测试 +11 例**：`color-directive` +4（`scopeSentinels`）、`view-context-menu` +6（两档 / 已有指令不改写 / 父子同选 / 按分支自动上色）、`settings` +1（白名单 + 脏值留痕）；全量 **103 文件 / 2830 例**。④**行数**：`core/constants.ts` 918 → **954**、`core/i18n.ts` 764 → **774**、`settings.ts` 565 → **596**、`domain/color.ts` 519 → **572**、`features/view-node-color.ts` 263 → **309**（越线，两处豁免表已补登记理由）；tests：`color-directive` 776 → **853**、`view-context-menu` 2023 → **2154**、`settings` → **526**；`AGENTS.md` 265 → **266**、`conventions.md` 1856 → **1864**、`architecture.md` → **559**。⑤**全表复测**：`src/` 超限文件 **42** 个与 `AGENTS.md` 豁免表 42 行一一对应（原「36 条」读数陈旧，本批订正），未登记数仍 **0**；`--fix-lines` 两表同批回填、`--dry-run` 报「行数逐行一致」。⑥**门禁**：`tsc` + esbuild / 2830 例 / eslint / `check:gates --dry-run` 全绿；`main.js` **712 342 B**、gzip **216 976 B**，`styles.css` **26 493 B** 未变。

> **2026-11-06 节点配色连线着色批（K167 订正）**：①用户追加：作用范围「仅本节点」时，颜色**不渲染到前后的连接线**。落地 `engine/mindmap-colors.applyColorStyle` 在 `colorLine === false` 时不写 `lineColor`（`fillColor` / `borderColor` / `color` 三键照旧——描边是小地图墨色来源，不能删）。引擎 `styleLine(line, childNode)` 读的是**子节点**的 `lineColor`：不写覆盖 ⇒ 「父 → 本节点」回落整篇配色；「本节点 → 子节点」归子节点 data，哨兵已让它回落 ⇒ 两条线都不带节点色。②判定唯一在 `core/constants.isNodeOnlyColorScope`（写入侧补哨兵与渲染侧跳过 `lineColor` 共用），由 `features/view.colorLine()` 传给创建前 `applyColorDirectivesToTree` / 渲染落地 `syncNodeColorDirectives`；只读嵌入经 `MindmapEmbedConfig.colorLine` 由组合根注入（跟全局默认，同 `themeStyle`）。③**切换即时生效**：`nodeColorScope` 进 `LIVE_REFRESH_SETTING_KEYS` + `IN_PLACE_REFRESH_KEYS`，`applySettingsChange` 只重算一次颜色（有变化才 render），不重建引擎；i18n 双语说明补上连线口径。④**口径订正**：K167 原先「渲染侧一个字都不改」改为「颜色内容（填充 / 描边 / 文字）仍完全由正文决定、继承遍历不改；随 `data.json` 走的只有连接线是否跟节点色这层派生显示态（与 `defaultTheme` 决定连线明暗色同性质）」。⑤**实机**（Obsidian **1.15.0** / Electron 43.8.4；版本取自 `navigator.userAgent` 的 `obsidian/1.15.0`，勿沿用旧文档的 1.14.4 读数。`reload` 后确认 `view.colorLine` 已生效、`visibilityState === "visible"`）：含子节点档给「甲」上青碧 ⇒ 甲 / 甲一 / 甲二 `lineColor=#44a7bb`、6 条连线中 3 条 `#44a7bb` / 3 条整篇 `#94a3b8`；切到仅本节点 ⇒ **6 条全为 `#94a3b8`**、三个节点 `lineColor` 全删、填充 `#c8e0e5` 不变；切回 ⇒ 3 条恢复 `#44a7bb` 且 `view.mindMap === 切换前引用`（原地刷新，未重建）；仅本节点档重新上暖橙 ⇒ 文件写 `甲 %%#edd6c0%%` + 两条 `%%none%%`，甲 `fillColor=#edd6c0` / `borderColor=#d98026` / 无 `lineColor`，甲一 / 甲二无颜色键，6 条连线仍全 `#94a3b8`；`dev:errors` 无条目。（首次设置写回因 `appliedSettingsSnapshot === null` 走 K59 的「首次全量刷新」会重建一次，是既有保守口径，非本批引入。）⑥**测试 +5 例**：`color-directive` +3（仅本节点档不写 `lineColor` / 切档只增删覆盖且幂等 / 每次切换各渲染一次）、`settings` +1（切换进差集；另在既有用例里补唯一判定断言）、`mindmap-codeblock` +1（组合根注入契约）；全量 **103 文件 / 2835 例**。⑦**行数**：`core/constants.ts` 954 → **969**、`settings.ts` 596 → **599**、`engine/mindmap.ts` 806 → **810**、`features/view.ts` 1764 → **1787**、`features/view-node-color.ts` 309 → **313**、`features/mindmap-codeblock.ts` 702 → **706**、`main.ts` 539 → **543**；`engine/mindmap-colors.ts` → **213**（未超限）、`core/i18n.ts` **774** 不变；tests：`color-directive` 853 → **923**、`settings` 526 → **540**、`mindmap-codeblock` → **501**；`conventions.md` 1864 → **1865**、`AGENTS.md` **266** 不变。两表 `--fix-lines` 已同批回填、未登记超限仍 **0**。⑧**门禁**：`tsc` + esbuild / 2835 例 / eslint / `check:gates --dry-run` 全绿；`main.js` **712 807 B**、gzip **217 150 B**，`styles.css` **26 493 B** 未变。

> **2026-11-07 0.3.2 发布收尾（注释 / 判据整理 + 行数回填）**：①**批 2（vendor 补丁 16/17）**：`Base` 账本实现整理（`applyOffsets` 内层 `forEach` → 显式下标循环、`matTop` 单次取值、账本字段构造函数定形）；各布局接入处 `const` 化、`fishboneUtils` 的 `_top` / `_left` 改 `topOffset` / `prevLeft`，注释压缩为「补丁编号 + 等价前提」。重打包 sha256 `2d5c69e3…` / **415 727 B**（原 415 674 B）。②**批 3（Markdown 缩进）**：`md-outline-lines.isValidIndentUnit` 收口「1–8 空格 / Tab」判据（解析 `noteIndent` 与写入 `readIndentUnit` 共用，删两份判断）；`md-outline` 去掉 `as MdNodeData` 断言；`md-roundtrip` 新增边界 1 例（全量 **103 文件 / 2836 例**）。③**批 4（外观 / 状态栏）**：注释订正 6 处——边框出厂默认 `default`（有边框）、`nodeColorScope` 在 `LIVE_REFRESH_SETTING_KEYS` 且渲染侧只影响连接线、`defaultLineStyle` 两态、`ThemeConfigInput.palette` 现行 id / 自定义 hex、`view-node-color` 作用范围、`view.ts` 的 `IN_PLACE_REFRESH_KEYS` 说明归位并补 `defaultThemeStyle`；`core/constants.normalizeCustomPaletteColor` 收口自定义配色识别（`mindmap-palette` 删私有副本）。④**行数**（`--fix-lines` 两表同批回填）：`core/constants.ts` 969 → **983**、`settings.ts` 599 → **603**、`features/view.ts` 1787 → **1788**、`features/view-node-color.ts` 313 → **314**、`markdown/md-outline.ts` 827 → **828**、`markdown/md-serialize.ts` 963 → **960**；未登记超限仍 **0**。⑤**门禁**：`check:gates` 全绿（build / 2836 例 / eslint / stylelint / knip / `verify:visual --require-chrome` / `check:release`）；`main.js` **712 869 B**、gzip **217 149 B**、sha256 `0ad4339d…`，`styles.css` **26 493 B** 未变。

> **2026-11-08 未提交区审核（属性双键契约 + 保存策略照搬 TextFileView）**：①**契约**：`Mindmap` 收窄为纯启用信号（值严格 `Mindmap`），布局移到 `Mindmap Layout`（六种 kebab），读侧唯一实现留在 `domain/mindmap-property`；新增一次性迁移 `platform/legacy-mindmap-migration.ts`（【0.4.0 删除】，启动后 1.5s 扫全库，幂等闸＝已有合法布局键即不命中）。②**保存**：删自动保存开关 / P1a 外部改动检测 / P1b 连续失败挂起 / `forgetBaseline`，`AUTO_SAVE_DEBOUNCE_MS` 800 → 2000（官方 `requestSave` 固定值），写入改 `Vault.process`。③**同文件多视图**：删 K102 互斥（标已废止），改为「无编辑侧随 `vault.modify` 从磁盘重载 + 有编辑侧关闭时再写」，组合根新增 `vault.on(modify)` → `view.onExternalModify`。④**本轮审核修复**：`lastWrittenBody` 改存序列化正文（此前存原样正文，撤销回加载态后被 `hasUnsavedChanges` 永久判脏）；重载前 `persistViewport`（否则视口被弹回）；重载在途期间的 `modify` 记 `pendingExternalModify` 并在收尾后补比一轮（否则永久停在上一版）；`syncDeclaredLayout` 对「布局键缺失」改回早退（原实现让 `defaultLayout` 变成隐式实时生效，与本文件头的 LIVE_REFRESH 口径矛盾）；迁移补 `Mindmap`（旧契约里＝思维导图布局，不迁会静默回落到默认布局）；嵌入指令与升级入口的旧 PascalCase 值由 `legacyLayoutIdOfPropertyValue` / `readLegacyLayout` 接住（正文指令无人代迁）；迁移模块不再自带归一与值表（复用 domain 唯一表）。⑤**行数**：`features/view.ts` → **1801**、`services/document-service.ts` → **607**、`domain/mindmap-property.ts` → **395**（新登记豁免，理由见 architecture）、`markdown/md-open.ts` → **345**、`features/mindmap-codeblock.ts` → **708**、`platform/legacy-mindmap-migration.ts` **106**；tests：`save-pipeline` → **1076**、`legacy-mindmap-migration` **205**、`md-frontmatter-trigger` → **397**、`md-open-trigger` → **369**、`mindmap-codeblock` → **516**；两表 `--fix-lines` 已回填、未登记超限 **0**。⑥**门禁**：`tsc --noEmit` / 全量 **104 文件 2862 例** / `eslint --max-warnings 0` / `knip` 全绿；`verify:visual` 与 `check:release` 未跑（本批未动 `styles.css` 与发布元数据）。⑦**实机未复验**：本批为代码审核与静态修复，导图打开 / 双标签互写 / 迁移命中三类场景需按 AGENTS.md「实机验证三步」补测。
> **2026-11-08 层级语法批（K168，标题 / 无序列表）**：①**交付**：新增 `markdown/md-heading-syntax.ts`（200，起始级别 / 可转判据 / 整支升降）、`md-heading-normalize.ts`（152，编辑期归一 + 粘贴换算）、`md-heading-format.ts`（150，整篇重排）、`features/view-syntax.ts`（182，挂引擎 / 提示 / `BACK` 兜底）；改 `md-outline.ts`（记 `mdHeadingStart` = 顶层标题最小级别）、`md-serialize.ts`（967，起始级别参数）、`markdown.ts`（三档种子正文）、`settings.ts`（622，`newMapSyntax`）、`view-context-menu.ts`（「层级语法」级联）、`view-clipboard.ts`（插入前换算）、`view.ts`（1842，守卫接线 / 空文档种子 / 级联方法）。②**门禁**：tsc / eslint（0 警告）/ knip / build（`main.js` 703.7 kb）/ 全量 106 文件 **2904** 用例 / `check:gates`（含 `verify:visual`）全绿；三个新文件均 < 300 行（按职责拆分，不按行数切）。③**实机**（Obsidian 1.15；`obsidian reload` 后确认 `settings.newMapSyntax` 已注册）：`##` 起头的文件顶层新建 → 落盘 `## 新根`（修复前写 `#`）；空导图 + 设置 `h2` → `mdHeadingStart=2`、新节点落盘 `## 空图新节点`；级联 `applyDocumentSyntax(1)` 把 `- 甲 / - 甲一 / - 乙` 整篇转为 `# 甲 / ## 甲一 / # 乙`，再 `applyDocumentSyntax('list')` 逐字回到列表（`resolveDocumentSyntax` 依次 `list` → `1` → `list`）；人为把 `# 乙` 改成 list（1:1 混排）后触发 `data_change`，守卫就地升回 `# 乙` 且文件保持标题语法；空白右键菜单出现「层级语法」（配色与撤销之间）；全程 `dev:errors` 无条目。④**取舍 / 教训**：守卫只升不降（降级会删标题，只能显式发起）、归一直接改 data 不进撤销栈（`Ctrl+Z` 一步撤掉「拖拽 + 换算」）；判据认独立指令行（`%%id%%` / `%%rel%%` / `%%sum%%` 随行保留）；**空文档种子必须写在引擎创建前**——首版写在 `onEngineReady`，实机无效（该时机 `renderer.root` 仍为 null，且引擎会克隆数据），已移到 `loadMindMapFromFile` 的 data 树上。

> **2026-11-08 体验审核修复（K168 订正：合法混排不再被改写）**：①**两个 P0（实机审核发现）**：a) 打开「先列表分支、后标题分支」的手写文件会被守卫**静默改写并落盘**（违反「存量不改动」）；b) `- 甲 / - 乙 / # 丙` 这类文件打开时连发 **17 条**重复提示并反复 `BACK`（`BACK` 自身又发 `data_change` ⇒ 空转）。根因是旧判据「同一兄弟组语法必须一致」把**本来就无损往返**的排布判成错误。②**修法**：判据收窄为「只判四种会改结构的排布」——列表排在标题之后（升同级标题，转不了则 `BACK`）、组内标题级别递增 / 子标题不深于父级（`relevelHeadingBranch` 重定级）、标题挂在列表/段落之下（撤回）；**合法的「列表在前」一律不动**，故**加载期天然无动作**；`view-syntax` 加 `suppress` 闩锁（撤回后跳过下一轮判定）；整支升级前必须过新增的 `findHeadingBlocker`（子孙藏围栏/任务项时硬转会丢勾选语义，围栏还会在重解析时裂成多个节点）；重定级只动已是标题的节点（不再顺手把列表子节点转标题——「标题·二级」不会把任务项改坏）。③**实机复验**：`- 组 / - 子 / # 标题甲` 打开后 **md5 逐字不变**、零提示；`- 甲 / - 乙 / # 丙` 零提示、md5 不变；列表拖到标题同级仍升级并提示；「带任务子节点」的分支拖到标题同级 → 撤回并点名「任务」、文件 md5 不变（未硬转）。④**门禁**：tsc / eslint 0 警告 / knip / build（`main.js` 704.3 kb）/ 全量 106 文件 **2912** 用例（+8）/ `check:gates` 全绿。⑤**教训**：把「能往返」的形态误判成「非法」，代价是改写用户文件；判定要贴着解析器的**真实约束**（顺序 + 级别），不要自造更严的不变性；`BACK` 这类会再发事件的补偿动作必须有闩锁。

> **2026-11-08 第 7 层降级修复（K168 追加）**：①**缺陷**：把六级标题分支拖成另一个六级标题的子节点（需要第 7 级）时，守卫判成 `downgrade` 并 `BACK` 撤回，还弹「该层是无序列表，而「X」是标题」——与事实相反（该层是标题层），且用户**做不到**把分支挂到最深层；同一需求在级联「标题·二级」里却能自动降为列表（两套口径）。②**修法**：`md-heading-normalize` 把 `minChildLevel > MAX_HEADING_LEVEL` 从 `blocked` 改成 `convertBranchToList`（整支降级，只动 md 字段、随这次拖拽的历史一步撤销）；结果新增 `firstDemoted`，独立提示 `syntax.guardDemoted`（中英：「第 6 级之下写不了标题，已改为无序列表（Ctrl+Z 可撤销）」）；**其它降级路径仍撤回**——只有层级超限是「结构上必然」的降级。③**实机**：`###### L6` 下拖入 `###### M6` → 落盘 `###### L6 / - L7 / - M6`、提示正确、无撤回；`BACK` 一步复原（`###### M6` 回到 `##### M5` 下）、`FORWARD` 重做后仍为列表（守卫再归一）；重开后树形完全一致。④**门禁**：tsc / eslint 0 警告 / knip / build（`main.js` 704.6 kb）/ 全量 106 文件 **2914** 用例（+2）/ `check:gates`（含 verify:visual）全绿；文档同步 `AGENTS.md` 决策行、`conventions.md` K168 ⑤、标准文档 §3.7。⑤**教训**：「只升不降」是策略不是物理定律——遇到「不降就无法表达」的位置必须开例外，且例外要用自己的提示说清代价，不能复用另一类失败文案。

> **2026-11-08 拖拽自动降级（K169，放开守卫）**：①**缺陷 / 裁决**：实机复现「七级拖到标题组可 `- → #`，标题拖到列表组却整次 `BACK` 撤回并要求改用右键级联」；用户选择放开守卫，接受静默丢大纲条目与 `[[#标题]]` 锚点。②**修法**：`md-heading-normalize` 拆 `parentIsList` / `parentIsPlain`，列表父下 heading 子由 `convertBranchToList` 整支降级（`continue` 不设 `lastHeadingLevel`，避免同组列表兄弟被误升），段落父仍 `blocked` 撤回；结果新增 `firstDowngraded`，i18n 双语新增 `syntax.guardDowngraded`、`guardBlockedDowngrade` 文案改指段落。③**行数**：`md-heading-normalize.ts` **200**、`view-syntax.ts` **209**、`i18n.ts` **803**、`tests/md-heading-syntax.test.ts` **538**、`tests/view-syntax.test.ts` **289**、`conventions.md` **1883**；未新增 / 删除源文件，K 区间 **168 → 169**（`AGENTS.md` 决策行 + docs 清单、`conventions.md` 标题 + K168 ⑤⑧、标准文档 §3.7、`architecture.md` 同步）。④**门禁**：`npm run build`（tsc + `main.js` **705.0 kb**）/ 全量 **106 文件 2916 用例（+2）** / `eslint --max-warnings 0` / `check:gates`（含 `verify:visual --require-chrome`）全绿；定向 `md-heading-syntax` + `view-syntax` **51 例**。⑤**实机**（0.3.2；复制三件套 → `obsidian reload` → `enablePlugin` → 等 3s；`visible`、`dev:errors` 干净）：`### 另支三级` 拖到 `- 七级` 下 → **不撤回**、Notice「已按该层语法把「另支三级」改为无序列表（Ctrl+Z 可撤销）」、落盘 `  - 另支三级`；重开后树形一致、零提示；`BACK` 把结构与 md 字段一起复原（正文逐字回到 `### 另支三级`）；正向回归 `- 八级` 拖到 `# 一级` 下仍升为 `## 八级` 并提示；临时文件已删、用户 `测试.md` 未改。⑥**教训**：「不降就表达不了」的落点不只是第 7 层，列表父同样成立；两类降级各有文案，别复用另一类失败提示。

> **2026-11-08 层级语法切换数据保真（K170，三项漏洞修复）**：①**漏洞（实机确认）**：a) `plain` 段落序列化无前缀，整篇转列表后重开掉层（段落第 4 层 → 第 1 层），后续兄弟被提升到根级；b) 转标题 `delete mdMarker`，`*` / `+` 往返后退化成 `-`；c) 有序编号按兄弟序号重算（`1./5.` → `1./2.`）。②**修法**：`convertBranchToList` 同时处理 `plain`（`mdType='list'` + 补 `-`），`planDocumentSyntax('list')` 与守卫 `parentIsList` 分支同步；转标题两处**保留 `mdMarker`**；`MdNodeMeta` 新增 `mdOrderedNumber`（`md-outline-lines` 记录原编号、`md-outline.attachList` 落 data、`md-serialize` 优先用它，新建项回落前一项 + 1）。③**行数**：`md-outline-lines.ts` **308**（新登记豁免：逐行分类唯一实现，理由见两处豁免表）、`md-heading-syntax.ts` **292**、`md-heading-format.ts` **161**、`md-heading-normalize.ts` **214**、`md-serialize.ts` **975**、`md-outline.ts` **844**、`tests/md-heading-syntax.test.ts` **587**、`tests/md-roundtrip.test.ts` **2700**。④**门禁**：`npm run build`（`main.js` **705.4 kb**）/ 全量 **106 文件 2920 用例（+4）** / `eslint --max-warnings 0` / `check:gates`（含 `verify:visual`）全绿；`check:gates` 的 line-budget 曾报 `md-outline-lines.ts` 未登记，已在 `AGENTS.md` + `architecture.md` 两处豁免表登记。⑤**实机**（0.3.2；三件套 → `reload` → `enablePlugin`；`visible`、`dev:errors` 干净）：含段落 / 任务 / 多行 / `*` / `+` / `1./5.` 的文件转列表 → 段落落盘 `- 普通段落第一行 / 续行`、`*` / `+` / `1.` / `5.` 原样；**重开后树形与写盘前完全一致**（段落与后续兄弟不再掉层 / 被提升）；`*` / `+` 转标题再转列表恢复原标记；跨会话（转标题写盘后重开再转列表）只能补 `-`（K170 ③ 已登记）。⑥**教训**：`mdRaw` 保真只覆盖「行内容」，**行前缀（段落无前缀、标记、有序编号）也是数据**——凡由序列化器重算的前缀都要有解析侧的字段兜底。

> **2026-11-08 层级语法审核（K171，注释与可达性沉淀）**：①**代码 / 注释完善**（零行为改动）：`md-heading-normalize` 文件头订正「段落排标题之后是 blocked 而非升级」、补段落父 / 段落加子节点的不可达与边界说明；`md-heading-syntax` 订正「这四种 → 这几种」「三条 → 四条口径」，标注 `HeadingBlockReason` 只对非标题求值（K170 保留 marker 不影响判据）、`ordered` 只可能是 list；`md-heading-format` 标注转列表时删除 `mdHeadingStart` 只作用于调用方深拷贝、plain 父分支生产不可达；`md-serialize` 标注 plain 子级缩进沿用本层的已知边界；`view-syntax` 标注 `converted === 0` 时丢弃深拷贝。②**文档沉淀**：新增 K171「层级语法的可达性边界」——判定标准（解析器产物 / UI 入口 / 守卫拦截）、7 条不修的防御分支、4 条已接受取舍、1 条待评估（段落加子节点）；同步 `AGENTS.md` 决策行 + docs 清单（K1–K171）、标准文档 §3.7 指针、`conventions.md` 标题。③**行数**：`md-heading-syntax.ts` **299**（压缩注释控制在 300 内，未新增豁免）、`md-heading-normalize.ts` **225**、`md-heading-format.ts` **166**、`view-syntax.ts` **211**、`md-serialize.ts` **977**（登记 960，偏差 17 ≤ 50）、`md-outline-lines.ts` **308**（已登记）。④**门禁**：`npm run build`（`main.js` 705.4 kb）/ 全量 **106 文件 2920 用例** / `eslint --max-warnings 0` / `check:gates`（含 `verify:visual`）全绿。⑤**实机**：本批只改注释与文档，未改变行为，沿用上一批（K170 三项修复）的实机读数；`main.js` 与上一批相同（705.4 kb），未重新发版。

> **2026-11-08 未提交区审核（第三轮：逻辑 / 功能 / 注释完善 + 实机验收，K172）**：①**修 5 处真实缺陷**（不是注释）：a）`md-serialize` 的「跟随兄弟风格」原本只看**整层**有无列表型兄弟，混排组（`- 甲` + `# 乙`）里新建节点写出 `- 新`、重开被读成「乙 的子节点」（一次保存静默改结构；单测先复现红灯再修）⇒ 改为按**位置**判（`SerializeFrame.lastWasList`，层首仍看整层）；b）守卫不再换算**空的**新建节点（`md-heading-normalize`）——每次在标题上按 Enter 都会弹一条「已改为标题」而屏上无变化；带子节点时仍换算（否则子标题失去相对层级、重开逃到外层）；c）`domain/mindmap-property` 三张以用户数据为键的查表改**无原型**（`createLookup`）——`normalizeLayoutId` 传 `toString` 曾返回函数（fail-closed 契约被原型链击穿）；d）有序编号只收**非负安全整数**（`0.` 不再被改成 `1.`；≥16 位编号不再写出指数形式让整行退化成段落）；e）启动迁移不再拿「思维导图」覆盖认不出的布局值（实机：`Mindmap Layout: toString` 在启动 1.5s 后被静默改成 `mindmap`）——布局键存在时只把旧写法迁成 kebab。②**同类加固**：`view-syntax.setupSyntaxGuard` 在每代引擎复位 `dragging` / `suppress` 并取消未决去抖（旧引擎在拖拽中途被重建时，残值会让此后每轮守卫静默跳过）；`labelOf` 对空文本节点回落原文（提示里不再出现空引号）；`SavePipeline.reconcileAfterSave` 的超限告警只发一次（此前每轮写盘都重发）；`buildMindMapFrontmatter` / `layoutPropertyValue` 收敛成一次归一（属性值 `logical` 不再被当成未知 id 退回默认布局）；提示「已撤回这次拖拽」→「这次改动」（粘贴 / 撤销落回也会走到）。③**文档**：新增 K172（判定 / 边界 / 回归），`AGENTS.md` 决策行同步（跟随兄弟按位置、空新建节点不换算），标准文档「list 回写」与「新节点回写」两行改写，顺手修掉 §3.1 里被截断的 `md-serialize.ts` 行内代码；两表 `--fix-lines` 回填。④**行数**：`mindmap-property.ts` 427、`md-serialize.ts` 997、`md-heading-syntax.ts` **300**（压回未超限，未新增豁免）、`md-heading-normalize.ts` 246、`md-outline-lines.ts` 322、`md-outline.ts` 846、`view-syntax.ts` 217、`document-service.ts` 610、`legacy-mindmap-migration.ts` 121。⑤**门禁**：`npm run check:gates` 全绿（build `main.js` 705.9 kb / 全量 **106 文件 2928 用例** / eslint / knip / `verify:visual --require-chrome`）；新增 8 例（混排组新建、纯列表新建、`0.`、超长编号、空新建节点、带子节点换算、原型键、迁移闸）。⑥**实机**（`obsidian reload` 后逐个夹具，`dev:errors` 无条目）：混排文件打开 0 提示、正文**逐字不变**（画布 3 个 `.smm-node`）；根下新建 → 落盘 `# `（标题）且无提示，Ctrl+Z 回退后文件回到原样（加载态逐字还原）；`Mindmap Layout: toString` **不再被改写**、视图回落设置默认布局 `logicalStructure`，`OrganizationStructure` 被迁成 `organization`；`0. 零` / `5. 五` 打开不改写、新建节点跟随列表写 `- ` 且原编号保真；右键「层级语法 · 无序列表」整篇 `# → -`（一条历史、缩进正确）、Ctrl+Z 逐字还原；守卫降级（模拟「标题拖到列表父下」）：就地转 `- 乙` 并落盘；正控（列表排到标题之后）弹出「已按该层语法把「甲」改为标题」且落盘 `# 甲`。⑦**已知（未修、非本批引入）**：编辑落盘会吃掉 frontmatter 与正文之间的空行（撤销回加载态时逐字还原）——属 body 序列化的既有规范化，与「未编辑行逐字回写」的张力留待单独立项。

> **2026-11-09 文档治理批（豁免表收归一处 / 行数回填 / lint 债清理）**：①**单一登记处**：`docs/agents/architecture.md` 的豁免表与行数流水整体删除，改为指向 `AGENTS.md`「文件规模与豁免」——两张表并行时只有一张受门禁，另一张已漂移（同一文件曾有 1121 / 1280 / 1532 三个读数）；`scripts/check-gates.mjs` 的 `--fix-lines` 与 line-budget 核对改为只读 `AGENTS.md`（`ARCHITECTURE_REL` 删除）。②**补登记与回填**：`src/platform/export-svg-postprocess.ts`（**338** 行：FO 几何余量 + CSS 变量注入 + `--pele-*` 白名单的唯一收口）补入豁免表；`md-outline-lines` **322 → 348**、`i18n` **804 → 807**、`node-inline-html` **1294 → 1280**、`view-wikilink` **411 → 445**；现状 **45 条 / 未登记 0**。③**过期描述订正**（`architecture.md`）：`mindmap-property` 单键 → 双键、`md-open` 的 `setMindMapProperty` → 三个 setter、`PALETTES` 6 套 → 10 套、`document-service` 的 P1a/P1b 与 `cachedRead` 比对 → `Vault.process` + 加载基线。④**lint 债**：撤销 `file-lookup.ts` 的陈旧 `getAbstractFileByPath` 豁免；`system-open.ts` 的 `require` 改为 eslint 显式 globals（不再依赖 `isDesktopOnly` 间接带进 `globals.node`）；K42 补记「lookbehind 不止一处（`md-serialize` 1 + `node-inline-tokenize` 4）」——移动端支持不能按一条正则估算。⑤**测试同步**：`md-roundtrip.test.ts` 三例按现行契约更新（双键 frontmatter、K170 有序编号保真）。⑥**门禁**：`npm run build`（`main.js` ≈1.4 mb）/ 全量 **107 文件 2940 用例** / `eslint --max-warnings 0` / `lint:css` / `knip` / `check:release` / `check:gates --dry-run`（line-budget 45/45、行数逐行一致）全绿。⑦**未做**：节点配色指令在标题行尾插仍会污染 heading 缓存（K168 ⑥ 已登记）——改独立行要同时扩展解析器的指令行归属与序列化缩进，并与「标题转列表」交叉，属格式决策，留待单独立项。

> **2026-11-09 标题配色独立行（K174，选项 ①）**：①**改法**：`setColorDirective` 增 `{ ownLine }`（删除语义收敛为 `rewriteColorDirectives` 一份），标题节点把指令写在最后一行之后、清除时整行删；`view-node-color` 按 `mdType === 'heading'` 传入。②**解析**：`domain/color.isColorDirectiveLine` 认整行形态，`md-outline` 在「列表续行合并」之前把该行归属上一节点（只写 `mdRaw`，不进 `mdDirectiveTail`）；`classifyLines` 新增 `fenced`，围栏里的 `%%rel:%%` / `%%#hex%%` 不再被抽走（顺带修掉的既有缺陷）。③**序列化兜底**：写成标题时 `hoistColorDirective` 把行尾指令上提（覆盖新建节点先上色、存量行内形态），第二次往返即不动点。④**回归**：`color-directive`（+2 例）、`md-roundtrip`（+3 例：标题 / 列表 / 围栏 / 旧行内）、`view-context-menu`（+1 例：标题写独立行）。⑤**门禁**：`npm run build` / 全量 **107 文件 2946 用例** / `eslint --max-warnings 0` / `lint:css` / `knip` / `check:release` / `check:gates --dry-run` 全绿；K 区间 **173 → 174**，`AGENTS.md` 决策行 + docs 清单、标准文档 §2.2、`conventions.md` 标题同批。⑥**边界**：手动写的行尾形态照读，下次改色时迁移；行内代码 / 数学里的同形态仍不识别。

> **2026-11-09 作用范围回退时清理旧哨兵（K175，用户裁决 B）**：①**问题**：`nodeColorScope` 只决定下一次上色怎么写；切回「含子节点」后正文里旧的 `%%none%%` 仍挡着继承（设置像是没生效）。②**做法**：设置面板在 `node → subtree` 时问一次「是否清理已打开导图里旧的 `%%none%%`」；确认后每棵树重新扫描、核对文件未切走，再一次 `applyRawNodeContents`（`afterCommit:false`，一条撤销）批量删除；整行只剩指令的节点不清（会清空内容），关闭的文件不动。③**新增**：`features/view-node-color` 的 `collectColorSentinelSessions` / `applyColorSentinelCleanup` / `offerColorSentinelCleanup`；`settings.shouldOfferColorScopeCleanup` 是触发面唯一判据；`main.offerColorSentinelCleanup` 遍历打开的 leaf。④**i18n**：`modal.colorScopeCleanup.*` 4 键 + `colorScope.cleanupDone`，ZH/EN 同批；设置项描述补一句提示。⑤**门禁**：`npm run build` / 全量 **107 文件 2951 用例** / `eslint --max-warnings 0` / `check:gates --dry-run` 全绿；K 区间 **174 → 175**。⑥**实机**（0.3.2，库 `Mindmap Studio`；三件套 → `obsidian reload` → `visible`、`dev:errors` 干净）：夹具 `# 父` + 独立行 `%%#89cff0%%` + `- 子甲 %%none%%`，打开后引擎 4 节点、标题文本 `父`、`fillColor #89cff0`、heading 缓存 `父`（**K174 同批验证**）；设置面板 `setControlValue('nodeColorScope','node')` 再切 `subtree` → 弹窗「清理旧的『不继承』标记？」/「1 个导图 / 1 处」/「保留 · 清理」两键（已截图）；点「清理」→ 正文 `%%none%%` 消失、Notice「已清理 1 处 `%%none%%`」、随后 `BACK` 撤销把哨兵与 frontmatter 后空行一起复原；点「保留」→ mtime 与内容均不变；再次往返（文件已无哨兵）不再弹窗；收尾无 `dev:errors`、夹具已移入回收站。⑦**遗留观察**：清理触发一次真实写盘，frontmatter 与正文之间的空行被吃掉（K172 ⑦ 已知项，非本批引入）；撤销回加载态时逐字复原。

> **2026-11-09 frontmatter 空行保留（K176）**：①**缺陷**：`splitFrontmatter` 把空行留在 body、序列化器按「块首空白」丢弃 ⇒ 任何真实编辑写盘都会吃掉 `---` 与正文之间的空行（K175 实机：清理 `%%none%%` 后 `---` 直接接 `# 父`，Git diff 白多一行删除）。②**改法**：`splitFrontmatter` 增 `gap`（frontmatter 后、正文前的原样空白行：0/1/多行、CRLF、仅空格行），`body` 从首个非空行开始；`writeBody.build(current)` 从磁盘同时取文件头与 gap，`wrapBase(body, header, gap)` 原样拼回；`loadedRawBody` 不含 gap，撤销路径不会双份。③**回归**：`tests/md-inline.test.ts` +1 例（gap 切分）、`tests/save-pipeline.test.ts` +3 例（保留 / 不凭空补 / 多行与 CRLF）。④**门禁**：`npm run build` / 全量 **107 文件 2955 用例** / `eslint --max-warnings 0` / `check:gates --dry-run`（45/45、行数逐行一致）全绿；K 区间 **175 → 176**。⑤**实机**（0.3.2，库 `Mindmap Studio`；三件套 → `obsidian reload` → 窗口置前 `visible`）：夹具 A（`---` 后一空行）改标题文本 → 写盘后 `---\n\n# 子改`，空行保留；夹具 B（`---` 后无空行）改子节点 → 写盘后 `---\n# 父`，**没有凭空补空行**；`dev:errors` 干净、夹具已移入回收站。⑥**边界**：读不到磁盘内容（`cachedRead` 缺失/抛错）时 gap 记空串（fail-open，不猜）；gap 不参与 `loadedBody` / `hasUnsavedChanges` 的正文判据。

> **2026-11-09 未完成项第二批（K177 / K178 / K179 + 自愈诊断 + 规模观察）**：①**K177 多视图覆盖提示**：`SavePipeline` 增 `lastSeenDiskBody`（加载 / 写盘后更新），写盘时比磁盘正文，不同则本轮 `onSaveConflict` 回调一次；视图弹 Notice「已保存，但覆盖了另一处对本文件的修改」。仍后写者胜，不阻塞、不合并、不写冲突副本；只比正文（改文件头不算），无基线不猜。回归 `save-pipeline`（+3 例）。②**K178 降级提示**：`SyntaxNormalizeResult.demotedHeadings` 在降级前数整支标题，视图改报「N 个标题失去锚点，`[[#标题]]` 将失效」；回归 `md-heading-syntax`（计数）+ `view-syntax`（文案 / 多标题）。③**K179 plain 父带子节点**：`md-serialize` 的 plain 分支见子节点改按列表项输出（`- 段` + 缩进 1 单位），子级不再掉层（K171④ 已修）；回归 `md-roundtrip`（+1 例）。④**自愈诊断**：`reconcileAfterSave` 失配时 `warnOnce` 打出首处差异（下标 + 两侧片段），K158② 的「根因未定位」至少可追。⑤**规模观察**：`check:gates` 打印「超限 N 个 / 合计行数 / 最大 5」，**不设红灯**（机械拆分不是目标）。⑥**门禁**：build / 全量 **107 文件 2960 用例** / eslint / `check:gates --dry-run`（45/45、行数逐行一致）全绿；K 区间 **176 → 179**。⑦**未做**：⑨ root 色对比度（会改九套色板的观感，需先看截图裁决）、⑦ 小地图 `verify:visual` 契约、⑩(b) 把豁免表搬出 `AGENTS.md`（下一轮单独做）。⑧**实机**（0.3.2，库 `Mindmap Studio`；`visible`、`dev:errors` 干净）：同一文件开两个导图视图（`getLeaf('split')` + `openFile`），A 改「甲→甲改A」并取消定时器保持脏，B 改「乙→乙改B」并立即写盘（磁盘＝甲 / 乙改B），A 再写盘 → 落盘＝甲改A / 乙（后写者胜）、Notice「已保存，但覆盖了另一处对本文件的修改（该修改未合并）」、console.warn 同步留痕；随后 B 在无人改动时再写一次 → **不弹提示**（无误报）；收尾无 `dev:errors`、夹具已移入回收站。

> **2026-11-09 Level B 文档会话（K180–K184）**：①**架构**：新增 `services/document-session.ts`（会话本体：权威树 + 单游标历史 + 唯一 `SavePipeline` + `SessionViewPort` 集合 + 外部写入重载）、`document-session-history.ts`（纯逻辑栈）、`document-session-registry.ts`（按路径键 acquire/rename/onModify/release）、`engine/mindmap-snapshot.ts`（跨视图应用通道 = `updateData` 去掉 `addHistory`）。视图接入：加载经 `registry.acquire`（首个读盘、后续不读）、编辑 `commit(snapshot, this)`、撤销/重做 `undoSession/redoSession`、关闭 `detach`（每次 flush）、`vault.on("modify")` 改会话单点分发、rename 只迁移键。**替换 K177**：`onSaveConflict`→`onExternalAbort`，`save.overwroteExternal`→`save.externalReloaded`（中英）。②**实机（Obsidian 1.15.0 / `visible`）**：两视图同会话（`views=2`、`version=1`）；A 改「甲→甲改A」后 B 约 **550 ms** 同步、两侧引擎探针未变（**不重建**）、会话 `version=2`/`canUndo=true`；B 撤销 → 两侧回「甲」，重做 → 「甲改A」；外部改写（A 有草稿）→ 两侧载入外部版 + Notice「本文件已被外部修改，已载入最新版本；你的未保存修改可按 Ctrl+Z 找回」，Ctrl+Z 两侧回草稿、2 s 后磁盘写回草稿；无草稿的外部改写 → 静默跟随、**无 Notice**；关闭 A（脏）立即写盘、会话保留 1 视图，关闭 B 会话销毁；会话有未保存改动时新开视图显示会话内容（不读盘）；重命名后键迁移、历史保留；广播时 B 的 `scale/x/y` 与选中 uid 不变；`dev:errors` 无条目。③**实测性能（5000 节点）**：`getData` 5.5 ms、单节点局部编辑整树渲染 79–103 ms、快照应用 90–141 ms、`updateData` 91–108 ms、整引擎 `setData` 重建 5422 ms；广播合并窗口 80 ms。④**行数**：`src/services/document-session.ts` **582**（新增豁免）、history 104、registry 100、`engine/mindmap-snapshot.ts` 79；`features/view.ts` 1851 → **1888**；tests 新增 `document-session.test.ts` 353 / `document-session-history.test.ts` 115 / `engine-session-snapshot.test.ts` 123。⑤**门禁**：`npm run build`（tsc + esbuild）/ 全量 **110 文件 2982 用例**（新增 22：会话 10 + 栈 7 + 通道 5）/ `eslint --max-warnings 0` / `check:gates --dry-run`（豁免表 +1）。⑥**已知差异/未做**：不做树级合并（恒定走官方「不可合并 → 替换 + 撤销找回」分支）；不做跨进程/跨窗口；后台视图延后应用未做（当前直接应用，5000 节点 2 视图 ≈2×120 ms）。

> **2026-11-09 同步延迟优化（K185）**：①**依据**：官方 Markdown 双视图编辑即推送（`setViewData` ≈12 ms）；本插件旧链路 `data_change` 被 `Command.addHistory` 的 **100 ms** 延时节流拖后，再叠 80 ms 广播窗口，实测另一侧可见 **≈550–900 ms**。②**改法**：`engine/mindmap.ts` 注入 `addHistoryTime: 16`（`HISTORY_ADD_THROTTLE_MS`，上游默认 100；不能设 0，否则同帧多命令各记一条历史）；`services/document-session.ts` 广播窗口按图规模分级（≤600 节点 0 ms、>600 节点 60 ms，`computeBroadcastDelayMs`）；隐藏窗口只置 `pendingHiddenBroadcast`，`visibilitychange` 恢复时 `handleVisibilityChange()` 补一次（对齐官方后台不重绘），监听随会话销毁移除。③**实机**（Obsidian 1.15.0，双视图，`visible`）：会话 `version` 更新 **20 ms**（原 ≈100 ms）、B 侧可见 **86 ms**（原 ≈550–900 ms）、B 撤销 / 重做广播 **5–7 ms**、两侧引擎探针未变（不重建）、`dev:errors` 无条目。④**顺带省两处整树拷贝**：`history.push(..., knownDistinct=true)` 不再重复序列化判等；广播不再逐视图 `structuredClone`（`handleData` 本就深拷贝）。5000 节点实测 clone ≈7 ms、双份 JSON 判等 ≈1.8 ms。⑤**行数**：`src/services/document-session.ts` 582 → **672**（豁免行同步）、`src/services/document-session-history.ts` 104 → **110**、`src/engine/mindmap.ts` 811 → **829**、`tests/document-session.test.ts` 353 → **396**（+2 例：分级阈值 / 隐藏推迟与恢复）、`tests/document-session-history.test.ts` 115 → **125**（+1 例：knownDistinct）。⑥**门禁**：`npm run build` / 全量 **110 文件 2985 用例** / `eslint --max-warnings 0` / `check:dead-code` / `verify:visual -- --require-chrome` / `check:gates --dry-run`（豁免表行数回填）。⑦**未做**：引擎历史旁路写入仍在（省内存需改提交信号）；后台视图（窗口可见、非活动）不延后应用。


> **2026-11-09 广播边界修正 + 推迟渲染回滚（K186）**：①**修正一（正确性）**：`commit` 记下的 `pendingOrigin` 会在合并窗口内被撤销/重做/外部重载沿用，导致发起视图停在旧内容。实机（700 节点）复现：编辑后 25 ms 撤销，A `n0X` / B `n0` / 会话树 `n0`；改为 `broadcastNow(forceAll)`（撤销/重做/重载传 true，先清 `pendingOrigin`），修复后四视图全为 `n0`。②**修正二**：补应用路径先 `beforeApplySnapshot` 再置 `applying`，否则应用期 `commit` 被守卫拒绝 → 丢内联编辑。③**修正三**：应用结束 `cancel` 排队广播——`beforeApplySnapshot` 的提交会排一次，外层已应用最新树，再执行就是第二次整树渲染（大图 ≈120 ms）。④**回滚**：曾用官方 `HTMLElement.isShown()` 跳过被盖住标签的渲染；实测切回时补渲染 700 节点 **428.8 ms**（更脏 924.6 ms）才可见，而后台渲染是 8 ms 批量异步、不阻塞输入 ⇒ 推迟更差，**所有视图保持同步渲染**（K186 ④）。⑤**行数**：`src/services/document-session.ts` 672 → **687**（豁免行同步）、`src/services/document-session-registry.ts` 112 → **100**、`src/main.ts` 622 → **609**、`src/features/view.ts` 1899 → **1889**、`tests/document-session.test.ts` 440 → **444**（+2 例：合并窗口内撤销 / 应用前提交不丢且只渲染一次）。⑥**门禁**：`npm run build` / 全量 **110 文件 2987 用例** / `eslint --max-warnings 0` / `check:dead-code` / `verify:visual -- --require-chrome` / `check:gates --dry-run`（豁免表回填）。⑦**环境提醒**：`obsidian reload` 后本机库偶尔未自动加载社区插件，需 `app.plugins.enablePlugin("mindmap-studio")` 再测；`obsidian dev:cdp method="Page.bringToFront"` 可把隐藏窗口恢复为 `visible`（rAF 暂停时引擎不建）。

> **2026-11-09 B1 批（属性契约 + 一次性迁移）实机复核与订正（K187）**：①**两个真缺陷**：a) 迁移无条件 `setMindMapEnabled`——「只剩一个布局键」的普通笔记与用户主动「切换为 Markdown」的文件会在启动 1.5 s 后被静默变成导图；b) 「以导图打开」升级只接启用键里的旧值，布局键是旧写法（`Mindmap Layout: LogicalStructure`）时会被种子值覆盖（迁移窗口内先手动打开即丢用户选择）。②**改法**：`legacyLayoutValueOf` → `legacyMigrationPlanOf`（`{ layout, enable }`：启用键存在且是旧布局值才改写启用键；`Markdown` / 未知值 / 无启用键一律返回 null）；旧启用值优先于布局键（旧契约不看布局键，脏值不算用户选择）；新增 `domain/mindmap-property.readLegacyMindMapLayout`（布局键旧写法 → 引擎 id），迁移与升级共用。③**实机**（Obsidian 1.15.0，库 `Mindmap Studio`，15 个夹具）：旧五值 / 旧 `Mindmap` / 大小写变体全部迁对；`Markdown`、普通笔记、只有布局键、`Markdown`+旧布局写法、`Mindmap`+`toString` 五类**哈希逐字未变**；`Timeline`+`toString` 按旧启用值迁成 `timeline`；二次 `reload` 零改写（幂等）；手动升级普通笔记 → `Mindmap` + 种子 `logical`，手动升级 `Markdown`+`OrganizationStructure` → `organization`（引擎 `opt.layout=organizationStructure`，非种子）；降级命令 → `Markdown` + 布局保留；`dev:errors` 无条目。④**行数**：`mindmap-property.ts` 427 → **459**、`md-open.ts` 345 → **352**（豁免表已回填）；`legacy-mindmap-migration.ts` 121 → **152**、`tests/legacy-mindmap-migration.test.ts` 233 → **298**。⑤**门禁**：`npm run build` / 全量 **110 文件 2992 用例** / `eslint --max-warnings 0`（改动文件）。⑥**环境**：`obsidian reload` 后本库 `community-plugins.json` 为 `[]`（自动化须写回启用列表），`obsidian plugin:enable` 在本机返回 127（不可用）。

> **2026-11-09 B2 批（层级语法）实机复核与订正（K188–K189）**：①**两个真缺陷 + 一处接线**：a) Level B 之后守卫的「就地归一」不落盘——守卫改引擎**活数据**、不发 `data_change`，而会话保存自己的权威树（实机：`- 列表乙` 升成 `# 列表乙`，屏上正确、文件没写、重开又变回列表项）；b) 会话撤销从未接线（视图实现 `undoSession` / `redoSession`，而 `MindMapViewContext.undo?` 与热键 / 竖栏 / 右键按 `view.undo` 判定，实机 `typeof view.undo === 'undefined'`）；c) 纯重定级（`##` 拖成 `#`）提示为「已按该层语法把「」改为标题」。②**修法**：`DocumentSession.updateCurrent` + `SessionHistory.replaceCurrent`（替换当前快照、**不新增历史**，Ctrl+Z 仍一步撤掉「拖拽 + 换算」）、视图 `commitDerivedTree()`、`undo` / `redo` 改名、`firstReleveled` + `syntax.guardReleveled`（中英）。③**实机**（Obsidian 1.15.0，库 `Mindmap Studio`，11 个夹具）：列表 ⇄ 标题一级 / 二级、六层到底（第 7 级回落列表）、任务项 / 多行组原子阻挡（保留列表且重开树形不变）、合法混排 `- 组A` + `# 标题乙` 打开零改写（哈希逐字不变）；用引擎 `MOVE_NODE_TO` 模拟拖拽的升级 / 降级 / 多行阻挡撤回三条守卫路径；**修复后**升级与降级都落盘、双视图同步、`v.undo()` 回一步、纯重定级提示为「已按该层语法调整「乙」的标题级别」；`dev:errors` 无条目。④**行数**：`i18n.ts` 831 → **835**、`view.ts` 1889 → **1912**、`document-session.ts` 687 → **723**（豁免表回填）；`view-context.ts` 230、`view-syntax.ts` 240、`md-heading-format.ts` 167、`md-heading-normalize.ts` 288、`document-session-history.ts` 129；tests `document-session.test.ts` 487 / `document-session-history.test.ts` 149 / `view-syntax.test.ts` 332 / `md-heading-syntax.test.ts` 626。⑤**门禁**：`npm run build` / 全量 **110 文件 2997 用例** / `eslint --max-warnings 0` / `check:dead-code` / `check:gates --dry-run`（豁免表一致）。⑥**注释订正**：`md-heading-format` 组原子的「同组语法必须一致」改为「重排后的层要么全标题、要么全列表」；「本层不转列表子节点」改为「本层只重定级、子层下一轮按组原子处理」。

> **2026-11-09 B3 批（文档会话 Level B）实机复核与订正（K190）**：①**两项无用功**：a) 首帧前的 `data_change`（`seedInitialHistory` 播种）被无条件当成编辑 ⇒ 每次打开都显示「保存中…」两秒并空跑一轮无差异保存（实机：刚打开 `saveState=saving`、状态栏「0 个节点 · 保存中…」）；改为 `commitSession()` 返回布尔、只在真提交进会话时排保存。b) 视图 `attach` 后用 `cloneTree()` 建引擎，`appliedVersions` 未预置 ⇒ `onViewReady` 判「落后」重放一次整树（大图 90–141 ms）；改为 `attach` 预置当前版本。②**健壮性**：`updateCurrent` 先换历史再换权威树（`replaceCurrent` 失败时不留半更新态）。③**实机**（Obsidian 1.15.0）：双视图同会话（`viewCount=2`、`version=1`）→ A 编辑后 B 同步、两侧引擎探针未变、`version=2`；B 撤销 → 两侧回退（`canUndo=false` / `canRedo=true`）→ 重做 → 两侧前进；关闭 B `viewCount=1` 会话存活、关闭 A 会话销毁且注册表移除；**草稿期新开视图**看到会话内容（磁盘尚未含草稿）；广播后 A 的 `scale/x/y`（1.4 / -136 / -19）不变；**有草稿的外部写入** → 载入外部版 + 一条 Notice「本文件已被外部修改…」+ `canUndo=true`，Ctrl+Z 回草稿并在 2 s 后写回（磁盘 `甲稿`）；**无草稿的外部写入** → 静默（0 条 Notice）且可撤销；**重命名** → 视图仍是 `mindmap-view`、引擎未重建、注册表键迁移、历史保留、撤销正常；**禁用插件**（脏状态）→ 草稿已落盘；打开 `saveState=idle`（不再空报「保存中」）、编辑后 `saving → saved`。④**行数**：`view.ts` 1912 → **1916**、`document-session.ts` 723 → **736**（豁免表回填）；`document-session-history.ts` 129、`view-context.ts` 230；tests `document-session.test.ts` 524 / `view-layout.test.ts` 94。⑤**门禁**：`npm run build` / 全量 **110 文件 3000 用例** / `eslint --max-warnings 0` / `check:dead-code` / `check:gates --fix-lines`（一致）。⑥**未跑**：`verify:visual --require-chrome`、`check:release`（由工作区 B4 / README 触发，不属本批）。

> **2026-11-09 B4 批（节点内 mermaid）实机复核与订正（K191）**：①**两条通道补齐**：a) 中键落在图内链上没有任何接管（画布 auxclick 只认 `HTMLAnchorElement`，而 Pele 把 `click A "…"` 渲染成 SVG `<a href>`）⇒ 裸 `<a href>` 被 Electron 默认行为处理（另开窗口 / 外部浏览器），与左键「新标签」语义分叉；auxclick 在普通锚点落空后改走同一个 `mermaidAnchorLink`。b) `view-wikilink` 三处 `instanceof Element` / `HTMLAnchorElement`（点击锚点识别 / 画布悬停 / 中键）在 popout 里恒 false ⇒ 独立窗口的锚点交互全部静默失效；统一改用 `core/event-binder.elementFromTarget`，`resolveAnchorLink` / `anchorLinktext` 形参放宽为 `Element`（只读 `getAttribute`）。②**注释订正**：`platform/mermaid` 头注释原写「不含交互 / 图内链接不启用」，与 P2（复制源码）/ P3（图内链接）矛盾——改为「图不参与命中，只有复制按钮与图内锚点放行；缩放仍不启用」。③**实机**（Obsidian 1.15.0，`00-开发支撑/zz-b4` 5 个夹具）：流程图渲染为真 SVG（`pele-nodes` / `aria-roledescription=flowchart`，`data-code` 可复制源码、非悬停时按钮 `display:none`）；语法错误回落 `.tmm-codeblock`（图 0 / 块 1）；图内 `[[05-空转]]` 左键当前标签、**中键新标签**（`mindmap-view` 9 → 10、活动 leaf 变更）；明暗切换 `--pele-bg` `#ffffff → #1C1C1C`、**同一 `<svg>` 不重渲染**；彩色节点（`fill #ff0000`）里的图纸面仍为 `--pele-bg`（白），不吃节点红；文字 + 图同节点正常；`%%{init:%%}` 原样进 `data-code`；`dev:errors` 无条目。④**行数**：`view-wikilink.ts` **445**（净变化 0）、`platform/mermaid.ts` 171、`tests/view-wikilink.test.ts` 1531（+2 例：图内中键 / 跨 realm 目标）。⑤**门禁**：`npm run build` / 全量 **110 文件 3002 用例** / `eslint --max-warnings 0` / `check:dead-code` / `verify:visual --require-chrome`（9 个探针全过）/ `check-gates --dry-run`（豁免表一致）。⑥**未跑**：导出落盘（需文件对话框；`--pele-*` 注入与隐藏按钮由 `tests/view-export.test.ts` 锁定）、`check:release`（README 段属文档批）。

> **2026-11-09 B5 批（节点配色作用域 + 哨兵清理）实机复核与订正（K192）**：①**一个真缺陷（Level B 交互）**：「清理旧 `%%none%%`」按**视图**扫描，而 Level B 之后同文件多视图共享一棵树 ⇒ 同一处哨兵被算成 N 处（实机 4 个视图 → 弹窗「4 个已打开的导图 / 4 处」，实际 1 个文件 1 处），落地还会对同一棵树重复 `applyRawNodeContents` N 次（N 次重渲 + N 条撤销）。修法：`collectColorSentinelSessions` 按 `view.file.path` 去重。②**实机**（Obsidian 1.15.0，`zz-b5` 3 个夹具）：含子节点上色 → 父/子/孙同色（fill `#c8e0e5`、border/line `#44a7bb`、ink `#111827`），另一支不变；「仅本节点」→ 父 `%%#c5d2e8%%` + 直接子节点 `%%none%%`（孙不写）；改回「默认」→ 父指令与无主哨兵**同一批**删除、`Ctrl+Z` 一步把两者一起还原；清理弹窗在 4 视图下报「1 个 / 1 处」、清理后 Notice「已清理 1 处 `%%none%%`」；**标题节点**的指令独立成行（`# 甲` 下一行）、**围栏末行**另起一行（围栏闭合后 `  %%#c5d2e8%%`，重开仍归属该节点且带色）；`dev:errors` 无条目。③**行数**：`view-node-color.ts` 468 → **475**（豁免表回填）。④**门禁**：`npm run build` / 全量 **110 文件 3003 用例**（+1：同路径三视图只算一个会话）/ `eslint --max-warnings 0` / `check:dead-code` / `check-gates --dry-run` 静态核对一致。⑤**未跑**：`verify:visual --require-chrome` 与 `check:release` 由其它批文件触发；本批只改配色扫描的计数口径（DOM 装配未变），故未重跑。

> **2026-11-09 B6 批（文档契约 / 门禁 / 行数记录）实机核对与订正（K193）**：①**三处文档漂移**：a) `architecture.md` 的 md-open 段仍写「旧值 → 种子值」，漏了 B1（K187）新增的「布局键旧写法（`readLegacyMindMapLayout`）」中间一步；b) `AGENTS.md` 的 mermaid 决策行写「容器 `pointer-events:none`」「点击在 `node_click` 分支」——实现是容器可命中、让位的是 `<svg>`，且点击有 `node_click`（左键 / 修饰键）+ 画布 `auxclick`（中键）三条通道（K191）；c) `line-count-log.md` 头部仍说「对账与回填**两表**」。②**门禁可用性（`--all` 的前置条件）**：本机 `check:gates -- --all` 在 `build:vendor` 0.4 s 失败（`Could not resolve "@svgdotjs/svg.js"`）——该依赖**有意**不在 `package.json` 声明（`vendor/BUILD.md`「打包面依赖」，版本由 `vendor/upstream/package.json` 决定）；`--help` 与 `testing.md` 补写「只改普通源文件不要加 `--all`」。③**整链实机**（不加 `--all`）：**7 步全过** —— build / test（110 文件 **3003** 用例）/ lint（15.5 s）/ lint:css / check:dead-code / `verify:visual --require-chrome`（15 场景逐项 ✓）/ check:release；`--dry-run` 报「未登记超限 0、豁免表逐行一致」；`--fix-lines` 复跑「无需回填」。④**契约对账**：目录清单（platform 17 / features 42 / domain 13 / engine 20 / services 10 / core 11 / markdown 14 / links 3 / ui 9 / tests 111）与 `AGENTS.md` 索引逐项一致；`testing.md` 的「15 个场景」与 `scripts/verify-visual.mjs` 的 `SCENARIOS` 一致；`src/links/file-lookup.ts` 的 `getAbstractFileByPath` 计数 0（撤销 lint 豁免的依据），`src/platform/system-open.ts` 2 处裸 `require`（已显式声明 `globals.require`）；K 区间 K1–K193 三处一致。⑤**行数**：源码零改动；`architecture.md` **552**、`testing.md` **239**、`conventions.md` **2093**（+K193）、`check-gates.mjs` **406**、`docs/agents/README.md` **52**（规模表同步 ≈550 / ≈600）。⑥**实机**：库内 `main.js` 与仓库逐字节一致（本批无源码改动），`dev:errors` 无条目。

> **2026-11-09 Level B 四缺陷修复（K194）**：①**实机确认（修前）**：a) 63 节点会话 `delayOpt=60`（`computeBroadcastDelayMs` 在装配处被注册表默认值短路）；b) 内存模拟改名后 `atLoaded=null / dirty=false`，外部正文变化判不出；c) 隔离会话 A 提交 `A-edit`、20 ms 后 B 基于旧树提交 `B-edit` ⇒ 会话树只剩 `B-edit`、A 也被刷成 B；d) 广播应用期间 `commit` 返回 false 且 `C-during-apply` 无痕消失。②**修法**：注册表第二参改可选（生产不传 ⇒ 会话按节点数分级）；`SavePipeline.rename` 迁移六张路径键表（`DocumentSession.rename` → `registry.rename`）；`commit` / `updateCurrent` 对 `appliedVersions < versionValue` 的过期提交拒绝 + `notifyStaleCommit()` 提示，由广播刷回权威树；`notifyNodeContentCommitted` 只在 `commitSession()` 为真时排保存。③**实机复验（修后）**：63 节点 `delayOpt=undefined`、调度窗口 `0`；改名后 `loadedKeys` 迁到新路径、`atLoaded=true`、`detectsExternal=true`；双视图并发提交 `commitB=false / bStale=1 / sessionChild=A-edit / bApplied=[A-edit]`；`dev:errors` 无条目。④**门禁**：build（`main.js` 1.4 mb）/ 全量 **110 文件 3008 用例**（+5）/ lint / check:dead-code / `agents-md-sync`（豁免表回填：`document-session.ts` 791、`document-service.ts` 797、`view.ts` 1924、`i18n.ts` 839）。⑤**补充门禁**：`lint:css` / `verify:visual --require-chrome`（9 个探针全过）/ `check:release` 全过（变更集含既有渲染与发布文件，非本次源码改动）。

> **2026-11-09 设置文案与菜单文案（无 K 变更）**：①**设置**：四组标题改为「常规 / 外观 / 文件与保存 / 交互与导出」，主题项更名为「明暗主题」；重写 12 条描述——去掉 `%%none%%` 等实现术语、统一「导图」口径、明确「只影响新建 / 已有文件保留自身写法」的作用范围，并把「＝」改成更易读的冒号句式。②**菜单**：文件夹右键标题改用新键 `fileMenu.createMindMap`（「新建导图」/「New mind map」）；命令面板、丝带图标与命名弹窗仍保留「新建思维导图」全称。③**实机**：设置页 `activeTab.containerEl` 读到 17 项新文案（含分组标题）；`file-menu` 事件触发得到 `["收藏","新建导图"]`（前项来自其它插件）；`dev:errors` 无条目。④**门禁**：build / 全量 **110 文件 3008 用例** / lint / `agents-md-sync`；豁免表回填 `i18n.ts` 846。

> **2026-11-11 标注 / 引用块渲染（K196）**：①**新增文件**：`src/domain/callout.ts` **306**（判定唯一面：13 类型元数据表 + 别名查表 + 头部解析 + 前缀剥离；行数来自数据表与取证注释——**新登记豁免**）、`src/platform/callout-icon.ts` **74**（`getIcon` 收口，未超限不登记）、`tests/callout.test.ts` **新**（24 例）。②**既有超限文件增长**（均已按 `npm run check:gates -- --fix-lines` 回填）：`src/features/node-inline-tokenize.ts` 1542 → **1737**（`kind:'quote'` 段、`scanQuoteBlocks` 最外层块切分、`isAtomicBlock`、`resolveCalloutIcon` 注入面）、`src/features/node-inline-html.ts` 1280 → **1552**（两套盒子 + 7 张内联样式表 + `appendSegments` 抽取 + `MAX_QUOTE_DEPTH`）、`src/platform/export-svg-postprocess.ts` 338 → **363**（`--blockquote-*` 与 13 个 `--callout-*` 进导出白名单）。③**豁免表**：登记 **45** → **47** 条（「现状」行此前停在 2026-11-09 的 45，而 `check:gates` 实测超限文件已是 47，本次一并订正）。④**验证**：`tests/node-inline-content.test.ts` 149 → **170** 例（新增「引用块 / 标注段」组 21 例）；`npm run verify:visual` 新增 `callout` 场景，并给无头垫片补 `getIcon` → null（锁住「图标缺失仍成立」的降级路径）；全量用例、lint、`check:gates` 全绿。⑤**实机（Obsidian 1.15.0，库 `Mindmap Studio`）抓到一个单测漏掉的缺陷**：解析层把段落之间的空行归一掉，两个空格分隔的标注到达渲染层时是一整段连续 `>` 行 ⇒ 第二个标注的 `[!type]` 变成前一个的正文文字（实机 `abstract` / `failure` / `danger` / `faq-` 四个中招，而单测全绿——单测喂的 raw 保留了空行）。修法：`scanQuoteBlocks` 在**本层剥完前缀后**成立的 `[!type]` 处断块（嵌套 `> > [!x]` 剥一层以 `>` 开头，不进该分支）。修后 `node-inline-tokenize.ts` 1737 → **1751**（已回填），并补 2 例（空行分隔两标注 / 嵌套头部不断块）。⑥**实机核对（修后）**：12 个标注全成盒、12 枚图标由宿主 `getIcon` 给出、标题色与宿主 `--callout-{tip,summary,default,fail,…}` 逐一相等、`+`/`-` 折叠标记显示 `▾`/`▸`、嵌套内层在外层内容区内、普通引用左竖线 2px + accent 色、标注内表格 / 代码块 / 数学 / 链接 / 标签各 1 处正常、文件未被改写、`dev:errors` 干净。`callout-icon.ts` 74 → **99**（加一次性降级告警，未超限）。

> **2026-11-11 标注重构批（K196 ⑨，**无行为变更**）**：①**逻辑**：标题在解析期定稿（`CalloutHeader.title` = 显式标题或类型标识 Title Case），渲染期不再算；`calloutVisualOf` 把「颜色 `var()` 链 + 图标 id」在模块初始化时派生**一次**（同一类型返回同一对象），取代 `calloutColorValue` / `calloutIconId` 两个访问器；新增 `isCalloutHeaderLine` 廉价谓词（与解析同一条正则与"类型段非空"规则，但不造对象）供块扫描的续行循环按行调用；`stripQuotePrefix` 改单趟 `exec` + `slice`。②**性能**：`scanQuoteBlocks` 加两级快路径（`includes('>')` → `QUOTE_LINE_START_RE`），后者省掉 `protectedRanges` 的整段 `MARKUP_RE` 扫描——「含 `>` 但无一行以 `>` 起首」的节点（`a > b`、`<div>`、箭头）不再付这份成本；`platform/callout-icon` 的图标内联样式表提到模块级（原每次调用现造对象）。③**结构**：`buildQuoteElement` 只做分派，外观拆 `buildCalloutShell` / `buildPlainQuoteShell`，正文容器按变体取表（`QUOTE_CONTENT_VARIANTS`），标注的取色 / 取图标一次查表后下传（原同一个 `canonical` 查两次、底色靠字符串形参传递）。④**行数**（`--fix-lines` 回填）：`src/domain/callout.ts` 306 → **354**（+解析期标题、谓词、元数据表与取证注释）、`src/features/node-inline-tokenize.ts` 1751 → **1768**（两级快路径 + 谓词用法）、`src/features/node-inline-html.ts` 1552 → **1613**（两条 shell + 变体表，净增的是职责拆分与注释）、`src/platform/callout-icon.ts` 99 → **108**（样式表外提）。⑤**验证**：`tests/callout.test.ts` 24 → **33** 例（标题定稿 / 谓词正反例成对 / 元数据同一对象）；全量 **111 文件 3066 例** + build + lint + lint:css + knip + `verify:visual` + `check:release` 全绿。⑥**实机复验（Obsidian 1.15.0，同一测试文件）**：13 个标注的标题文本与类型色逐项与重构前一致（含 `abstract`/`failure`/`danger` 四个命名偏差类型与 `+`/`-` 折叠标记）、13 枚图标、1 个普通引用、1 张标注内表格、`dev:errors` 干净。

> **2026-11-12 K198 会话快照补齐图片默认尺寸（P0 修复）**：①**缺陷（实机取证）**：0.3.3 发布前验收发现，含 `![[图]]` 的导图只要发生一次外部写入，外部分支 `reloadFromDisk → broadcastNow → applySessionSnapshot` 用「重新解析」的树（解析器不产 `imageSize`）覆盖引擎 ⇒ vendor `getImgShowSize` 解构抛 TypeError、`renderer.root` 变 null、DOM 停在旧画面、后续命令静默 no-op；全新实例 3 次复现，无图片导图同样操作正常。②**修法**：`media/images-path.withDefaultImageSizes`（缺尺寸才 `domain/tree.cloneTree` 深拷贝后补、热路径零拷贝、派生字段不回灌会话树）挂在 `DocumentSession.applyToPort` 这个唯一出口；`view.applySnapshot` 保持薄通道。顺带把会话里的私有拷贝实现收敛到 `domain/tree.cloneTree`。③**回归**：`tests/images-path.test.ts` +2（零拷贝 / 副本补齐且原树不改）、`tests/document-session.test.ts` +1（外部重载后 port 树带尺寸、会话树不带）、`scripts/verify-visual.mjs` 的 image 探针 +4 断言（快照通道 root / 2 节点 / `<image>` / 应用返回值）。④**门禁**：`check:gates` 全绿（build `main.js` 1.4 mb / 全量 **113 文件 3144 例** / lint / knip / `verify:visual --require-chrome`；探针读数「快照通道 root=true 节点=2 image=true」）；行数回填 `view.ts` 1955→**1960**、`images-path.ts` 652→**689**、`document-session.ts` 807→**805**。⑤**实机复验（修后，Obsidian 1.13 / 库 `Mindmap Studio`）**：`示例/测试/功能验收.md`（2 张无尺寸图）外部写入后 `root=true / 32 节点`、外部文本上屏、会话树两个 `imageSize` 仍为 null、`dev:errors` 干净；「有草稿 + 外部写入」不覆盖外部版本、撤销精确回到草稿且不崩；`示例/思维导图.md`（`![[…|147]]`）同样 `root=true / 7 节点`、外部文本上屏、无错误。⑥**收尾**：两份样本哈希恢复到验收前（`FBE5C101…` / `1E1C9F51…`），`data.json` 21 B，插件错误日志干净。

> **2026-11-12 K198 ⑤ 外部写入后图片尺寸回退（P2 修复）**：①**复验发现**：P0 修好后外部写入不再崩，但 `功能验收.md` 的 160×160（自然尺寸）/ 200×200（`|200`）与 `思维导图.md` 的 147×147（`|147`）全部退回 200×120 默认盒——加载期 `collectImageSizeCorrections → node_tree_render_end` 异步回灌只在建引擎时跑，快照应用不重跑。不改文件、重开标签即恢复，属观感回退。②**修法**：不重跑探测（异步 / uid 匹配 / 每次广播重复解码），而是复用接收视图应用前已有的定稿尺寸——`features/view.knownImageSizes()` 从 `getRenderRoot()` 收 `imageSize.custom:true`，`media/images-path.imageSizeKey` 以「地址 + `mdImageWidth/Height`」为键（同一张图的 `![[a.png]]` 与 `![[a.png|300]]` 不共用尺寸），`reuseKnownImageSizes` 命中才深拷贝搬进新树；只认 `custom:true`，外部换图 / 新增图片仍停在默认盒这一安全终态。③**回归**：`tests/images-path.test.ts` +3（零拷贝 / 命中复用且原树不改 / 同图不同参数与已有 custom 不动）；`scripts/verify-visual.mjs` image 探针 +3 断言，读数「定稿尺寸=1 引擎={\"width\":120,\"height\":40,\"custom\":true} DOM宽=120」。④**门禁**：`check:gates` 全绿（build / 全量 **113 文件 3147 例** / lint / knip / `verify:visual --require-chrome`）；行数回填 `view.ts` 1960→**1995**、`images-path.ts` 689→**758**。⑤**实机 A/B（修后，Obsidian 1.13 / 库 `Mindmap Studio`）**：`功能验收.md` 全新打开 160×160 & 200×200 → 外部写入后**仍是 160×160 & 200×200**（DOM 同值），`root=true / 32 节点`、外部文本上屏、会话树 `imageSize` 仍 `[null,null]`；`思维导图.md` 147×147 → 第一次、连续第二次外部写入后均保持 147×147；双视图同时在场时外部写入，两侧 `root=true / 32 节点`、两侧尺寸均为 160×160 & 200×200、两侧都显示外部内容。全程 `dev:errors` 干净。⑥**收尾**：样本哈希还原（`FBE5C101…` / `1E1C9F51…`）、`data.json` 21 B、无临时文件。
