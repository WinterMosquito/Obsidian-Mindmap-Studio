# 代码结构与文件规模（详录）

> 本文件由 AGENTS.md 迁出（2026-10-04 瘦身）。AGENTS.md 只保留硬规则、决策表、命令与索引；
> 本文是**详录**，改代码前按需查阅，改约定时**同步更新 AGENTS.md 索引**。

## 代码结构

**分组与分层（依赖单向；许可集由 lint + 静态依赖图测试机械强制，见 K51）**：

| 层 | 组 | 定位 |
|---|---|---|
| L0 | `domain/` | 纯领域逻辑（零依赖，lint 强制） |
| L1 | `core/` `links/` `markdown/` `media/` `engine/` `platform/` | 基础模块组（组间许可：`links→core`；`markdown→links/core`；`media→links/core`；`engine→core`；`platform→links/markdown/core`；`domain` 对每层恒许，故不逐条列） |
| L2 | `ui/` `services/` | 弹窗与视图服务（`ui→links/media/core`；`services→core/links/markdown/media/engine/platform`） |
| L3 | `features/` | UI 特性与视图控制器 |
| 根 | `main.ts` `commands.ts` `settings.ts` `creation.ts` | 组合根（唯一可依赖全图） |

> **模块化是硬约束**：单一职责 / 分层单向 / 收口唯一 / 窄接口四条边界见 K50；依赖矩阵与机械强制见 K51；文件规模与拆分判定见「文件规模与豁免」。

```
src/
  main.ts           # 插件入口：生命周期、视图注册、command/file-menu/hover 源、
                    #   状态栏服务装配、视图切换后状态栏跟随
                    #   （vault rename/delete/create 经 VaultSyncService.attach
                    #   hooks 单入口分发，不再重复注册事件）
  commands.ts       # 命令注册与命令面板入口（COMMAND_IDS 为命令 ID 唯一表，发布后永不变更）
  settings.ts       # 设置接口与设置面板（Obsidian 1.13+ 声明式）+ sanitizeSettings
                    #   （data.json 加载与设置面板写回共用同一校验）；写回经
                    #   main.scheduleSettingsPersist 防抖（滑块突发合并，内存即时生效）
  creation.ts       # 新建文件默认内容/文件名与命名弹窗衔接（创建流程编排）
  domain/           # L0 纯领域逻辑（零依赖：lint no-restricted-imports 强制禁 obsidian/上层/vendor）
    wikilink.ts     #   双链解析/构造唯一权威（parse/format/display）
    wiki-display.ts #   链接「生效显示名」纯判定（editedWikilinkAlias/effectiveDocWikiLink/docWikiLinkDisplay）
    url.ts          #   URL/地址形态谓词唯一权威（isHttpUrl/isExternalImageRef/isSchemeUrl 等）
                    #   + tryDecodeUri：URL 解码的唯一安全入口（失败返回 null，调用方选
                    #   回落原样或跳过候选；2026-10-11 从 4 文件 8 处 try/catch 收口）
    tree.ts         #   walkTree 先序遍历（显式栈防溢出，visit 返回 false 短路）
    color.ts        #   颜色纯计算：十六进制/RGB 归一（parseColorInput 是「自定义」输入口）、
                    #   混色 mixHex、WCAG 亮度与对比度、nodeInkColor（柔和墨色三候选取大）、
                    #   nodeContentTones（着色节点的码块/网格线派生色）+ 配色继承遍历
                    #   walkColorDirectives（就近覆盖的唯一实现）
    md-meta.ts      #   MdNodeMeta：节点 data 上 md* 元数据的类型契约（纯契约，无引擎类型）
    md-task.ts      #   任务列表项（GFM task）的**判定/合成唯一实现**：parseTaskPrefix（行首
                    #   `[ ]`/`[x]`/`[X]` + 其后必须是空白或行尾）/ stripTaskPrefix（显示文本
                    #   剥离）/ toggleTaskToken（切换，`[X]` 原样不归一）/ withTaskPrefix
                    #   （合成首行拼回）/ setTaskTokenInRaw（就地换首行 token）。token 属**正文
                    #   前缀**：mdRaw 保留、text 与 mdDerivedText 必须一起剥（见 K150 ②）
    mindmap-property.ts # 「本文件是导图、用哪种布局」的 frontmatter 判据唯一实现
                    #   （**双键**：启用信号 `Mindmap` + 布局 `Mindmap Layout`；读侧归一、
                    #   读写对称、旧值兼容读口共用同一份表）。2026-10-12 起取代文件名
                    #   后缀判据；2026-10-28 旧键 Type/类型 完全不认（不读/不写/不删/
                    #   不迁移）；2026-11-07 双键化——启用值恒 `Mindmap`、布局写 kebab，
                    #   旧六种布局值经 legacyLayout 兼容读，不再充当启用信号
  core/             # L1 基座：通用机制与共享词汇
    constants.ts    #   全局常量：扩展名分流清单、布局/连线/主题色/主题/配色选项（后者按文件记）、渲染能力清单
                    #   （.mindmap.md 后缀判定三函数已于 2026-10-12 退役，判据见
                    #   domain/mindmap-property.ts）
    i18n.ts         #   t() 取文案、tf() 占位符格式化
    errors.ts       #   errorMessage(error)：面向用户的错误消息格式化唯一实现；
                    #   createWarnOnce()：内部告警「同一根因只告警一次」的唯一实现
                    #   （2026-10-11 从 prism-code / math-jax×2 / view 四处同构实现收口）
    concurrency.ts  #   并发原语唯一实现：串行队列/防抖/节流（SavePipeline/ViewStateStore/
                    #   状态栏计数等共用；节流支持 trailingResetsWindow 选项）
    event-binder.ts #   DOM/引擎事件绑定器（作用域化统一销毁）
    persistence.ts  #   data.json 写盘器（PluginDataWriter：串行队列 + 写前重读合并 + 吞错）
    node-data.ts    #   MdNodeData 黏合类型（引擎 MindMapNodeData + domain MdNodeMeta；
                    #   放 core 保持 domain 零依赖）
    measure-cache.ts #   离屏测量缓存键：fontMeasureKey() 把字体代际编进自绘元素 outerHTML，
                    #   使引擎按 outerHTML 缓存的测量结果在字体状态变化时必然 miss（K114）
    minimap-geometry.ts # 小地图的**纯几何与绘制模型**（零 DOM / 零引擎依赖）：面板尺寸
                    #   （等比装入 220、宽 160–220、高上限=画布高×0.6）、启用判据、全量节点盒
                    #   （measureMiniMapBounds，判据与映射共用）、标记提取（纯 DFS 步长抽样，
                    #   标记数 ≤MINIMAP_MAX_MARKS）、SVG 拼装（方块分档 + 按布局五态的连线 +
                    #   配色清洗）、视口框投影、30s 节拍判定、帧等价（sameMiniMapFrame）。八者
                    #   共用同一套「内容盒 → 面板坐标」换算，拆开会让图与框各持一份变换
  links/            # L1 链接与文件解析
    links-resolve.ts #   统一解析入口 resolvePathToFile：按形态路由（远程拒绝/obsidian:///
                    #   资源地址→索引/路径直查/file://→官方 getFirstLinkpathDest→索引兜底）
    file-lookup.ts  #   全库文件查找索引原语（buildFileLookupIndex/FileLookupIndexService/
                    #   lookupIndexedFile；多种地址形态→TFile 的 O(1) 缓存查询）
    links-tree.ts   #   树内引用更新（重命名/清除共用同一遍历实现，mode 参数区分）；改写形态跟用户走（有前缀继续写路径）但路径取**新位置**（跨文件夹移动只换 basename 会悬空）；非 .md 文档（canvas/base）必须带扩展名
  markdown/         # L1 Markdown 语义（解析/序列化/打开路由/拆分）
    md-outline.ts   #   Markdown 大纲 → 导图树（frontmatter 跳过、标题/列表、行内 token；mdRaw 保真）
    md-serialize.ts #   导图树 → Markdown（未编辑逐字回写/编辑合成；链接/图片新增检测）
    markdown.ts     #   新建文件默认内容/文件名、uid 修复（ensureUniqueUids）
    md-open.ts      #   声明判据（经 MetadataCache 同步读）、视图切换、以导图打开 / 切回
                    #   Markdown 的属性写入（processFrontMatter + setMindMapEnabled /
                    #   setMindMapLayout / setMindMapDisabled，三入口同语义；键名恒为
                    #   `Mindmap` + `Mindmap Layout`，与语言无关）。升级时布局取值顺序为
                    #   「启用键里的旧值（readLegacyLayout）→ 布局键里的旧写法
                    #   （readLegacyMindMapLayout）→ 种子值」，已有合法布局原样保留
                    #   （readDeclaredLayout 是视图侧同步入口）；迁移窗口内先手动打开
                    #   不会丢用户旧选择（K187）
    md-line-write.ts #  节点行内容**原文写入**（编辑弹窗原文模式的提交）：重解析 → 整体
                    #   重建行内字段（链接/图片/台账）⇒ 未编辑态 ⇒ 保存逐字写回用户输入
    links-split.ts  #   混排双链拆分纯逻辑（方案生成/批量改写/写回字段）；规则与产品决策
                    #   见文件头契约；视图侧执行在 features/view-split-links.ts
    links-rename.ts #   文件重命名后的引用更新（**字段 + 渲染源**双层）：links-tree 字段改写之后，
                    #   对未编辑且 mdRaw 仍含旧目标的节点，按解析侧同一扫描器定位旧链接 token
                    #   并以同一改写规则重写，经 buildInlineData 重建 text/mdRaw/mdDerivedText/
                    #   mdSegments——通道字段保留字段层结果（attachmentUrl 资源地址不照搬解析态）
    md-outline-lines.ts #   逐行分类（围栏状态机 / 自闭合围栏 / setext 与分隔线 / 空列表项）+ leadingSpaces
                    #   （2026-10-22 自 md-outline 抽出，纯提取；零依赖）
    md-outline-inline.ts # 行内 token 族（tokenizeInline / tokenDisplay / tokenAnchors / 图片尺寸后缀），
                    #   由 md-outline **转出**（既有引用方零改 import 路径）
    md-footnote.ts  #   脚注定义行语法的**唯一判定**（`[^id]: 内容`；md-outline 的
                    #   `^` 分支委托 `isFootnoteDefinition`，不另写「以 `[^` 开头」）+
                    #   索引 `collectFootnoteDefinitions`（入参 = 引擎
                    #   `collectRenderNodeData` 展平的文档序 data：**只有引擎树有
                    #   uid**；读 nodeInlineSource、逐行扫，围栏 / 缩进代码保守跳过，
                    #   同 id 首个生效）+ `splitFootnoteDefinitions`（**渲染期剥离**：
                    #   正文与定义 id 分离，围栏 / 缩进代码 / 续行判定与索引同源；
                    #   纯定义节点由调用方渲染汇总 chip）。只服务渲染与交互，不写
                    #   任何 data（K197）
    md-serialize-anchors.ts # 行内锚点三件套（inLinkSyntax / anchorInsertPoint / insertionForm）：
                    #   插入位置与写法判定（padLead/padTrail 只有 insertionForm 消费）
    md-serialize-inline.ts # 图片族（尺寸参数 / 嵌入标签 /「是否已在 mdRaw」特征 / renderImage /
                    #   imageVaultPath / imageSelfText）；stripAngleBrackets 与链接族共用
    md-heading-syntax.ts # 层级语法基础面：mdHeadingStart 读取、单节点可转判据（认独立指令行）、
                    #   整支升/降；liveNodeTree 把渲染节点包装成数据树（活引用，就地改、不进历史）
    md-heading-normalize.ts # 编辑期归一（拖拽/粘贴/撤销后按落点升标题 / 降列表）+ 粘贴插入前换算
    md-heading-format.ts # 右键「层级语法」的整篇重排（双向、组原子）+ 当前语法判定
  media/            # L1 图片与附件
    images-path.ts  #   图片地址→资源地址（经统一解析入口）、外部地址判断、尺寸校正
                    #   （含尺寸/失败两套缓存：失败记忆 TTL 5 min，打开文件时由
                    #   document-service 经 forgetImageFail 按 URL 解除，见 K148）
    images-save.ts  #   图片入库（走 concurrency 串行队列）、文件名清理
  engine/           # L1 引擎封装（纯模块，无 obsidian 依赖）；2026-10-16 起由单文件
                    #   拆为**层内多文件**（收口点是「层」而非「文件」；vendor 私有形态
                    #   仍只允许出现在 engine/ 内），mindmap.ts 为对外 barrel
    mindmap.ts      #   实例创建/销毁/主题应用/自动整理/性能模式切换 + barrel re-export
                    #   （createMindMap + CreateMindMapOptions/NodeContentStyle、
                    #   resolveNodeContentStyle/normalizeFontSize/buildWikiDocIcon、
                    #   arrangeMindMap、applyThemeConfig、applyPerformanceMode；
                    #   视图/特性层只 import 本 barrel，`import ... from '../engine/mindmap'` 不变）
    mindmap-commands.ts  # 引擎命令名常量表 ENGINE_COMMANDS + 快捷键闸门 shortcutGateAllows /
                    #   摘除 removeEngineShortcut（**叶子**，无 engine/ 内依赖）
    mindmap-timers.ts    # 引擎延时任务登记表 engineTimers + scheduleEngineTimer /
                    #   cancelEngineTimers（**叶子**；销毁路径统一取消）
    mindmap-history.ts   # 命令历史内存预算策略：resolveHistoryLimit（预算反推）+
                    #   syncHistoryLimit（会话内按当前节点数同步）+
                    #   recordHistory（插件**原文写回**通道的撤销快照入口：引擎命令之外
                    #   的唯一历史入口，防御式读 command.addHistory，缺失只留痕）
    mindmap-snapshot.ts  # **跨视图应用会话快照的唯一通道**（Level B，K181）：
                    #   `applySessionSnapshot` = `updateData` 去掉 `addHistory`
                    #   （handleData → before_update_data → renderer.setData → render →
                    #   update_data）。不进引擎历史、不发 `data_change`（编辑期该事件
                    #   唯一发源），故接收视图不会重复排保存 / 跑守卫；实测 5000 节点
                    #   90–141 ms、视口与选中不变、不重建引擎
    mindmap-viewport.ts  # 画布几何/视口：实时容器几何同步、数据层/DOM 双口径内容盒测量、
                    #   fitMindMap、居中与「渲染落地后居中补正」（scheduleCenteringCorrection）、
                    #   缩放/平移、视口状态读写与签名（readViewportState/applyViewportState/
                    #   getViewportSignature/viewStateSignature/getDrawTransform）；
                    #   measureNodesCanvasBox（2026-11-04：选区包围盒改布局几何，
                    #   性能模式摘 DOM 后仍完整；与 projectViewportBox 同一变换口径）
    mindmap-nodes.ts     # 节点/DOM 反查、节点文本与图片尺寸、自绘内容重建、兄弟上/下移、
                    #   renderer.textEdit / node_dblclick 收口
    mindmap-clipboard.ts # 选中子树的复制/剪切/粘贴（顶层去重 + 文档序 + 过滤根节点；返回**引擎树上的
                    #   只读 nodeData**、不克隆不剥 uid——uid 不进 Markdown，克隆是纯开销，见文件头）
    mindmap-search.ts    # 搜索子系统收口（searchMindMap 等 6 函数）
    mindmap-export.ts    # 导出 PNG/SVG（doExport 内部形态收口）
    mindmap-theme-presets.ts # 外观预设**数据表**（只放数据、零分支）：THEME_STYLE_PRESETS（节点外观，
                    #   由 Record<ThemeStyleId, …> 绑死 core/constants.THEME_STYLE_OPTIONS）
                    #   + PALETTES（10 套色相方案，Record<PaletteId, …> 绑死 PALETTE_OPTIONS；每套
                    #   只给 5 个填充/线色，文字色仍按明暗定）；主题只能覆盖节点填充/描边——
                    #   字号/间距/连线各有单一来源，不得越权
    mindmap-colors.ts #  节点级配色（`%%#hex%%`）落地：颜色 → 节点 data 的 fillColor /
                    #   lineColor / borderColor / color 四键；创建**前**写 data 树
                    #   （handleData 会克隆，建好再改无效）与创建**后**按实时树同步
                    #   （无变化不重渲染、不进命令历史）
    mindmap-palette.ts #  配色解析与派生（**预设 id / 自定义十六进制两形态的唯一分派点**）：
                    #   resolvePaletteTheme → 画布底色 + 五档填充/线色 + 三档文字色（自定义值由
                    #   deriveCustomPalette 从一个主色派生、文字色按亮度现算）；另有
                    #   getDocIconColor / paletteNodeColor 两个「配色 → 单色」查询
    mindmap-theme.ts #  主题管线（buildThemeConfig 唯一实现：色板 + 主题覆盖合并；参数化差异：
                    #   亮/暗 + 连线样式 + 主题；resolveLineStyle 两态偏好解析〔折线/曲线，
                    #   固定直线布局恒折线〕，归一在 core/constants.normalizeLineStylePreference；
                    #   色值来自 mindmap-palette，本文件不解析配色）
    mindmap-icons.ts #   文档页 SVG 图标（WIKI_DOC_ICON_SIZE / buildWikiDocIcon；2026-10-22 自 mindmap.ts 抽出）
    mindmap-arrange.ts # 自动整理：RESET_LAYOUT（默认**保留视口**；`fitView: true` 才延时 fit，
                    #   目前只有「切布局」路径用它）→ 根未回填轮询（成功路径唯一实现，
                    #   三者必须同文件；barrel 转出 arrangeMindMap）
    mindmap-viewport-canvas.ts # 画布几何（实时 rect / 尺寸 / 原点 / syncCanvasGeometry /
                    #   flushPendingLayoutRender）：引擎几何与实时容器的唯一同步点
    mindmap-minimap.ts # 缩略图取样的引擎侧读取面（captureMiniMap）：取画布尺寸 → 渲染树
                    #   全量包围盒 + 标记 → 交 core 拼 SVG；外观三项（配色 / 连线样式 / 布局
                    #   连线形态）由 `readAppearance` **一次读完**（同一份 themeConfig 只 cast
                    #   一次），画布尺寸/全树几何可由调用方透传（同一次 refresh 共用一份读数）；
                    #   不碰 renderer 私有形态，也不走 vendor 的 MiniMap 插件——后者要克隆
                    #   整棵 SVG，500 节点实测 128.8ms/775KB。取样失败只脏帧不抛错
  platform/         # L1 Obsidian 平台集成
    vault-sync.ts   #   库事件同步单一入口（引用更新、索引失效；插件侧补充处理经 hooks 注入）
    mindmap-auto-open.ts # 声明驱动自动打开（active-leaf-change/file-open/metadataCache
                    #   changed 补判/启动多档延时）；判据由组合根注入，打开方式不存 data.json
    nav-history.ts  #   导航历史卫生（K111）：视图切换不是导航点——清理 leaf 历史里
                    #   「尾部连续同文件段」内跨视图类型的冗余条目（侧键后退修复）；
                    #   私有结构防御式访问，失败退化为修复前行为
    system-open.ts  #   系统默认应用打开库内文件（桌面端 shell.openPath）
    tag-search.ts   #   标签点击 → 官方**搜索**核心插件（私有触点，规则 9）：
                    #   `internalPlugins.getPluginById('global-search').instance
                    #   .openGlobalSearch('tag:#名')`；internalPlugins 与实例方法都不在
                    #   obsidian.d.ts ⇒ 任一层缺失/抛错降级为**一次** Notice + 一条 warn
                    #   （不许每次点击都弹、也不许静默空转，见 K150 ④）
    vault-prefs.ts  #   官方库级偏好读取（useMarkdownLinks / newLinkFormat；getConfig 内部接口）
    export-svg-postprocess.ts # 导出 SVG 后处理收口（2026-10-17 合并原 export-svg-style /
                    #   export-css-vars / export-foreign-object-padding）：platform 单入口
                    #   postProcessExportSvg ＝ foreignObject 几何余量（K106，宽 +12 **左右各半**
                    #   / 高 +20，兜底 `<img>` 解码环境的文本度量偏差；单侧加宽会压窄右内边距，
                    #   2026-11-11 实拍修正）→ Obsidian CSS 变量注入
                    #   （K99/K105，取宿主实际生效值，修复字体回退导致的裁切）；共用
                    #   `<style>` 注入原语 appendSvgStyle（数学导出链亦引用）；
                    #   白名单含引用 / 标注的 --blockquote-* 与 13 个 --callout-*（K196）
    callout-icon.ts #   标注图标的宿主解析：getIcon 收口（缺失返回 null = 省略图标）、
                    #   按 id 缓存模板 + cloneNode（同一节点被多个标注复用会互相搬父）、
                    #   尺寸/配色内联（属性给导出、样式压过 .svg-icon 的类规则，K196）
    math-jax.ts     #   行内数学渲染（官方 loadMathJax 通道；**实机 1.13.7 的 MathJax 3.2.2
                    #   仅有 tex2chtml**，见 K85；**1.14+ 为 MathJax 4.1.3，tex2chtml
                    #   仍在、tex2svg 仍缺，见 K113**）；**就绪判据＝本段字符的规则已
                    #   落盘 + 宽度 > 0**（2026-10-15 v4 修正：v4 字符为真实文本节点
                    #   ⇒ 旧「宽全 > 0」恒假阳 ⇒ flush 从不调度 ⇒ 官方样式表从未挂载；
                    #   索引三态：元素不存在 = 明确未 flush ⇒ 判未就绪／CSSOM 不可读
                    #   ⇒ 退回宽度兜底）+ 零宽豁免双形态（v3::before 空 content／v4
                    #   逐字符规则 padding 全 0，按字符码查 #MJX-CHTML-styles 的
                    #   CSSOM 索引、缓存键 =（样式表元素, 规则条数）；规则缺失=塌缩
                    #   不放行），见 K90 ① / K113** + 自驱官方
                    #   flush（按批合并、完成后放行重试）**：未就绪同步撤回字面、塌缩产物
                    #   不入缓存（见 K87）；占位即回退 + API 面缺失告警一次 + 未挂载入队补
                    #   替换（K85 ②）；产物缓存/定稿回调（K86）；注入 node-inline-content）
                    #   **未定稿登记面**（2026-10-14）：`unsettledMath`（holder → TeX +
                    #   引擎归属）+ 症状修复 `repairUnsettledMath`（缓存命中同步修复 /
                    #   未命中且已挂载才重新入队）；清理按**归属**（引擎销毁
                    #   `pruneUnsettledMathOwnedBy`）或**画布根**（视图卸载
                    #   `clearUnsettledMath`，只清 root 内——按 `isConnected` 判归属会误清
                    #   其他宿主未挂载的段）
    math-jax-export.ts # 导出 SVG 的数学后处理链（2026-10-16 自 math-jax.ts 拆出）：
                    #   样式表 CSS 注入（injectMathStylesIntoExportSvg/stripFontFaceRules）
                    #   + mjx-container 高度钉定（pinMathContainerHeightsInExportSvg）。
                    #   **纯 DOM/CSSOM**——不依赖渲染态（缓存/登记面/pending/flush 代际
                    #   全不碰），故可干净抽出；唯一隐式前提是 CHTML 样式表已挂入文档
    math-jax-export-clip.ts # 导出 SVG 的 mjx-c 字形裁切放宽（2026-10-23 自上一文件拆出）：
                    #   MathJax 4 的 clip-path 纵向 ±2px 在 fallback 字体下会把公式下半
                    #   裁掉（PNG/SVG 同因）；relaxMathGlyphClipPaths 纯字符串改写、可直测
    math-jax-fonts.ts # 导出 SVG 的 MathJax 字体按需内联（2026-10-23，A 方案）：
                    #   私有触点 app:// 取 woff2 → base64；按克隆里 TEX-* class 裁剪
                    #   只内联实际用到的族（否则矩阵竖线/根号/分式线/大括号整片消失）；
                    #   primeExportMathFonts 由导出入口 await（同步钩子读缓存），失败回退
    mermaid.ts      # 节点内 mermaid 的**唯一** Pele 入口（内嵌 `pele@1.13.0`，npm 依赖不进
                    #   vendor）：renderMermaidSvg（缓存键只含源码）+ renderMermaidNode
                    #   （DOMParser 取根、消毒 script/on*/不安全 href）；同步产物的前提是
                    #   宿主 loadMermaid 为 async、window.pele 又按窗口懒加载（K173）
    legacy-mindmap-migration.ts # 【0.4.0 删除】一次性迁移：旧六种 `Mindmap` 布局值 →
                    #   `Mindmap: Mindmap` + `Mindmap Layout: <kebab>`。只换写法、不造声明
                    #   （无启用键 / 值已是 Markdown 或未知的文件不碰），幂等、无「已迁移」标记（K187）
  ui/               # L2 弹窗
   modal-common.ts / modal-color.ts / modal-image.ts / modal-link.ts / modal-name.ts / modal-text.ts
                    # 颜色/链接/图片/命名/节点文本弹窗（官方 AbstractInputSuggest 联想；settle 守卫与
                    #   VaultFileSuggest 联想类收口在 modal-common.ts）；modal-color 收十六进制/RGB
                    #   → 恒返回归一 `#rrggbb`（解析在 domain/color.parseColorInput，非法值置灰确认键）；modal-text 是
                    #   自绘（富）节点的**备选**文本编辑入口（2026-09-28 起主入口＝
                    #   node-inline-editor 内联编辑器，见 K92）——引擎编辑框对其静默
                    #   no-op（textEdit.show 的 isUseCustomNodeContent 守卫），故由插件兜底
    math-jax-char-rules.ts # 逐字符规则索引与判定（缓存键=样式表元素+规则条数；usable 三态；
                    #   零宽字符豁免判据）：isProductReady 的就绪判据依赖它
    prism-code-color-probe.ts # token 颜色**真探测**（浅克隆挂进已挂载宿主，连读两次计算色；
                    #   「父链在且已连接」才可进共享缓存）
   menu-submenu.ts / modal-relation-label.ts / modal-summary-text.ts
                    # 宿主原生级联封装 + 「自定义…」条目（setSubmenu 私有触点单点隔离，K129 ③）/
                    # 联系标签弹窗 / 概要文字弹窗（同走 modal-common）
  services/         # L2 视图服务
    document-service.ts # md 文档读取解析 + 保存管线（2s 防抖 / 串行排空 / 卸载快照兜底 /
                        #   无差异跳过 / 收尾一致性自检，onSaveError 上报）。写盘走
                        #   `Vault.process`（原子读改写；运行时缺失时回退 cachedRead + modify）：
                        #   文件头恒取磁盘当前值、正文取本视图序列化结果；纯浏览由
                        #   `markLoaded` 的加载基线拦住（K156）。解析只做图片地址解析，
                        #   不做尺寸归一（视图走 aspect 校正）；写盘归属：树快照与 frontmatter
                        #   按**该次写盘的文件**取（getSnapshotFor/getFrontmatterFor），
                        #   不同文件不并入同一批次——core 不 await onUnloadFile，换文件
                        #   期间的排空必须同源
    document-session.ts # **Level B 文档会话**（K180）：一个文件的权威树 + 单游标历史 +
                        #   唯一 SavePipeline + 视图端口集合；commit / undo / redo /
                        #   外部写入重载 / 广播（跳过 origin）。视图引擎只是只读投影
    document-session-history.ts # 会话撤销栈（纯逻辑）：入栈截断 redo / 同状态不入栈 /
                        #   超上限丢最旧；单游标（对官方每视图镜像的有意改进，K180）
    document-session-registry.ts # 会话注册表：按路径键 acquire / rename / onModify /
                        #   release（最后一个视图解绑即销毁），组合根持有
    engine-controller.ts# 引擎实例生命周期 + 防腐收口（renderer 内部不外泄）；
                        #   导出 SVG 后处理链经 deps.exportSvgTransforms 由组合根注入（K51）
    view-state.ts   #   按文件路径持久化连线样式/配色/边框/视口到插件 data.json（ViewStateStore；
                    #   三项偏好共用 getPreference/setPreference，缺省值由 resolveFilePreferences
                    #   统一给；**布局自 2026-10-29 不在 data.json**——只存文件属性，hydrate 剔除
                    #   旧键并报告调用方补一次写盘；openAs 已于 2026-10-12 退役：打开方式同由文件属性承载）
    status-bar.ts   #   StatusBarService 契约 + 插件层实现（节点计数 + 保存状态三段式
                    #   保存中/已保存/未保存 的组合展示与清空；DOM 归插件层，2026-11-04）
    engine-controller-deps.ts # 控制器依赖契约（EngineSetupOptions + EngineControllerDeps，**纯类型**）；
                    #   控制器转出 EngineControllerDeps，既有 import 路径不变
    engine-controller-viewport.ts # 视口会话状态（restoreTimer / recenterTimer / defaultSignature /
                    #   recalcBudget / restoredSaved / 节点拖拽时戳）+ reset / beginInitialWindow / canRecalcOnRender
    engine-controller-options.ts # createMindMap 入参拼装（buildCreateOptions：deps 回调包箭头避免
                    #   unbound-method；与 createNodeContent / handleExportSvg 的惰性装配同点）
  features/         # L3 UI 特性与视图控制器
    view.ts         # Controller：Obsidian 生命周期编排、service 装配、链接跳转、标题重命名
    view-context.ts # MindMapViewContext：view-* 对视图的访问契约（结构化窄接口）
    content-remeasure.ts # 自绘内容「定稿 → 尺寸同步」会话（P4/K88/K104/K116，2026-10-11 自 view.ts 外置）：
                    #   holder 反查真实节点 → 批量合并重排 + 字体分批再同步 + 渲染窗口重试一次
                    #   ④ 可见性不变式（2026-10-14）：隐藏态不测量（量测容器在隐藏子树里
                    #   恒 0×0）、由隐藏转可见四路自愈（挂起 holders 重新入批 / 暂存重试补做 /
                    #   字体批次补做 / 塌陷节点症状重测）；自愈拍到期时若又隐藏则保留脏标记
                    #   ⑤ 未定稿修复（弃段症状修复 + 登记面清理，见 platform/math-jax）
    view-minimap.ts # 左下角小地图浮层（F12-M）：**状态链单文件**（启用判据 → 30s 节拍 →
                    #   无操作淡出 → 视口框本地投影 → 拖拽导航），纯判定与几何外置在
                    #   core/minimap-geometry，本文件只留副作用。视口框的画布尺寸走
                    #   **会话缓存**（2026-11-04：resize 事件刷新；每帧不再
                    #   getBoundingClientRect，避免「写样式 → 强制布局」抖动）。两个刷新入口不可合并：
                    #   refreshMiniMap（连线/配色/边框，同步 setThemeConfig）与
                    #   refreshMiniMapAfterRender（布局，等 node_tree_render_end 落地补画）；
                    #   何时用哪个由 view.commitPreference 的 miniMap 字段声明
    view-*.ts       # 31 个交互特性各占一文件（下列为主要入口，其余按名称即职责）：工具栏（view-toolbar.ts：右缘竖栏四组，
                    #   见 conventions K129；tooltip 统一 placement: 'left'，构建与状态
                    #   回写两处都带，K143；「自动整理」受理后挂
                    #   refreshMiniMapAfterRender，见 K147）/ 拖拽（view-dnd.ts）/
                    #   右键（view-context-menu.ts）/ 搜索（view-search.ts）/ 导出（view-export.ts）/
                    #   状态栏（view-status.ts）/ 图片灯箱（view-image-fullscreen.ts）/
                    #   图片动作（view-image-actions.ts）/ wikilink 交互（view-wikilink.ts）/
                    #   链接跳转（view-link-navigator.ts）/ 粘贴（view-paste.ts）/
                    #   剪贴板（view-clipboard.ts：子树复制/剪切/粘贴以**纯 Markdown 大纲**走
                    #   系统剪贴板，序列化/解析复用往返实现）/
                    #   节点操作（view-node-actions.ts）/ 节点配色（view-node-color.ts：
                    #   右键「配色」→ 把 `%%#hex%%` 写进节点原文，多选只写最上层、
                    #   清除＝删指令；改完挂 `refreshMiniMapAfterRender`，见 K147）/ 标题重命名（view-title-renamer.ts）/
                    #   快捷键（view-hotkeys.ts：F2 编辑当前节点 / Delete 删除节点 / Shift+1/2 缩放）/
                    #   节点宽度（view-node-width.ts：拖宽结束 → 重建自绘内容；手柄门禁
                    #   gateNodeWidthHandles：只让自绘节点出现拖宽手柄）/
                    #   节点任务（view-node-task.ts：画布 capture 拦 mousedown/click/dblclick，
                    #   点复选框即改首行三字符、跳过提交后编排；无右键/键盘/多选入口，
                    #   图片节点不画，见 K150）/ 标签点击（view-tag.ts：`a.tag[data-tag]`
                    #   → 官方标签搜索；文件视图与只读嵌入共用，见 K150 ④）/ 脚注徽标
                    #   （view-footnote.ts：capture 命中**外层** `sup.mindmap-node-footnote-ref`
                    #   → 点击 `revealNodeByUid` 定位（只展开 + 居中，**不选中、不闪烁**）、悬停画布内
                    #   **可交互**浮层（内部链接可点、文字可选、超长内滚动）；编号 /
                    #   未定义弱化由 `applyFootnoteLabels` **后置**写入；索引按引擎渲染树
                    #   现算、两宿主共用，见 K197）/

                    #   层级语法（view-syntax.ts：编辑期守卫 + 空白右键「层级语法」整篇重排，
                    #   与 markdown/md-heading-* 三件套分工见该文件头）/ 联系（view-node-relation.ts
                    #   建边 / 删边 / 改标签 / 线色 + view-relation-anchor.ts 手绘锚定）/
                    #   概要（view-node-summary.ts：两条建入口 + 改文字 + 删）/ 混排双链拆分（view-split-links.ts）/ 视口（view-viewport.ts：
                    #   Shift+1/2 的缩放实现 + 抑制中键自动滚动；**滚轮与中键拖由引擎负责**）/
                    #   共用件（view-common.ts：insertChildNodeWithData 等）
    view-load-session.ts # 加载会话状态（whenReady / 加载去重路径 / 首帧 rAF / 挂起的图片校正）：
                    #   被 onOpen 与 onLoadFile 两个入口读写，时序契约见其文件头
    view-node-link-plan.ts # 「把节点变成链接」的**规划**（目标名 → 链接串 → 载荷/提示，纯计算）：
                    #   与 view-node-actions 的 apply* 族分界；planDocLink / planAttachmentLink 由原文件转出
    node-inline-content.ts # 节点内联内容的**对外 barrel**（2026-10-16 拆分）：契约文档 +
                    #   re-export；实现见下两文件（**方案 B 原型**）。边界见本文件头契约：
                    #   自绘节点无 `_textData`，引擎编辑框有 isUseCustomNodeContent
                    #   守卫 → 双击静默 no-op；由 view-node-actions.setupNodeTextEditFallback
                    #   订阅 node_dblclick 兜底转内联编辑器（K92）
    node-inline-tokenize.ts # 段序列切分（**纯逻辑，无 DOM**）：行内 token → 段序列
                    #   （轻标记切分 / 围栏代码块判定 / 缩进代码 / 语言码规范化 / 数学 /
                    #   链接 / **表格块切分** / **标签切分** `pushTagSegments`：顶层 prose、
                    #   `#` 前须非词字符、全数字不算、转义产物（`\#`）单独成段不合并）
                    #   + 段缓存（`segmentEntryOf` / `segmentCacheStats`）
                    #   + 接管判定 `resolveSelfDrawSource`（任务节点剥前缀后仍接管）
                    #   + 任务状态读取 `taskStateOf`（`mdType==='list'` 且 `mdTask` 合法）
                    #   + **引用块 / 标注**切分 `scanQuoteBlocks`（`kind:'quote'`，
                    #   块级顺序「引用 → 围栏 → 表格 → 行内」写在文件头，K196）
                    #   + **脚注引用** `kind:'footnote'`（`MARKUP_RE` 一支，`(?!:)` 让
                    #   定义行保持字面；段里只有 id，正文由交互层现查，K197）
                    #   + **定义行剥离** `splitFootnoteDefinitions`（只在渲染源上做；
                    #   整节点只有定义 ⇒ 返回 `footnoteIds`，由 `node-inline-html`
                    #   画汇总 chip——不接管会回落引擎 `data.text`，隐藏静默失效）
                    #   + 展示截断 `clampSegments`（原子段 `isAtomicBlock` = 表格 + 引用）
                    #   + 预览 `inlineContentPreview`
    node-inline-html.ts # 段序列 → HTML **装配**：类名与锚点属性契约
                    #   （`a.internal-link[data-href]` / `a.external-link[href]`）+
                    #   内联样式常量表（导出保真契约 K53 ⑤）+ 文本段/锚点/表格/代码块
                    #   （K91）/数学元素/标签 pill（`a.tag[data-tag]`，**刻意无 href**
                    #   ⇒ 不落进 ANCHOR_SELECTOR）+ 任务复选框（`span.mindmap-node-task`，
                    #   对勾在绝对定位层，K150 ⑦）+ **标注 / 引用盒子**
                    #   （`.mindmap-node-callout` / `.mindmap-node-quote`：`buildQuoteElement`
                    #   只做分派 → `buildCalloutShell` / `buildPlainQuoteShell` +
                    #   `appendQuoteBody`（正文容器按变体取表）；标题行 `buildCalloutTitle`
                    #   取 `calloutVisualOf` 的一份元数据；段循环抽成 `appendSegments` 供正文递归，
                    #   嵌套上限 `MAX_QUOTE_DEPTH`，K196）+ **脚注徽标**
                    #   （`buildFootnoteRef`：`sup.mindmap-node-footnote-ref > a[data-footnote-id]`，
                    #   无 href ⇒ 不进链接三通道；正文不进段，交互层现查，K197）；入口
                    #   `buildInlineNodeContent`（经 engine 的 createNodeContent 钩子注入）
                    #   与 `buildInlineTextContent`（脚注预览复用同一段管线）；点击/悬停复用
                    #   view-wikilink 既有锚点分流（零改造）
    node-codeblock.ts # 代码块复制交互（视图层）：复制按钮（屏上恒显，外观全内联、
                    #   不依赖 styles.css）的点击语义——经引擎 node_click 委托命中
                    #   选择器（与 view-wikilink 锚点同款模式，view.ts 同段注册）；
                    #   写剪贴板 + ✓ 反馈；导出图隐身为 hideCopyButtonsInExportSvg；
                    #   DOM 结构构建留在 node-inline-html.buildCodeBlockElement（2026-10-16 随拆分改指）。
                    #   入参面 `CodeBlockInteractionHost { mindMap, engineEvents }`
                    #   （2026-10-13 收窄）：代码块嵌入是第二个宿主，共用同一实现
    node-content-factory.ts # 自绘内容的**装配收口**（视图与代码块嵌入共用）：把
                    #   平台实现（官方 MathJax / Prism 通道 + 两个产物缓存读取）单向
                    #   绑定成 InlineContentOptions；宿主相关的只有 isResolvedLink 与
                    #   onSettled 两项（各传自己的 ContentRemeasureSession）。两处各写
                    #   一遍 ⇒ 新增渲染通道时会单边漂移（K122）
    mindmap-codeblock.ts # Markdown 代码块**只读嵌入**（K122，2026-10-13 恢复；该能力
                    #   0.0.1 存在、0.0.3 移除）：组合根 registerMarkdownCodeBlockProcessor
                    #   （语言键 mindmap，core/constants）→ 块体走 parseMdOutline（与
                    #   .mindmap.md 同一份大纲语法）→ createMindMap({ readonly: true,
                    #   enableViewDrag: false }) → **容器高度随内容**（按宽度适配量测
                    #   measureContentFitToWidth + centerContentAtScale；只缩不放）；
                    #   形态对齐 Obsidian 里的 Mermaid（无固定高度框、无 resize 手柄、
                    #   无平移）；**不写 data.json**、不回写文件；超
                    #   CODE_BLOCK_MAX_NODES 降级只读大纲（可见提示）；滚轮归宿主页面
                    #   （capture 拦截，引擎 onMousewheel 无条件 preventDefault）；
                    #   卸载即清 DOM（onunload：切模式时 Obsidian 保留的另一套
                    #   视图子树不残留 .tmm-embed-canvas 空壳）；
                    #   块体首行 %%layout: <值>%% 指令：parseEmbedLayoutDirective 在
                    #   parseMdOutline 之前剥离（值走 layoutIdOfPropertyValue；空值 / 外壳
                    #   不匹配按普通注释原样留在块内；Markdown 与未知值剥离 + 块内提示）
    node-inline-editor.ts # 节点内联编辑（自绘/富节点的**原文**编辑器，2026-09-28，见 K92）：
                    #   覆盖层 textarea 编辑文件里那一行（mdRaw 语义），提交走
                    #   applyRawToNode（与弹窗原文模式同一写回入口）；双击 / F2 /
                    #   右键「编辑文本」共用入口；弹窗（ui/modal-text）收编为备选入口；
                    #   isAnyNodeEditing 为统一编辑态判据（热键/自动拆分/标题重命名让位）
    image-resize.ts # 节点图片拖拽调宽：hover 手柄 + 等比缩放；帧内直写渲染中
                    #   <image> 宽度（DOM 通道，不动引擎数据/不进历史），收尾一次走
                    #   SET_NODE_DATA（一条历史 + 布局归位），持久化走 Obsidian 官方
                    #   嵌入尺寸语法——结束时 scheduleSave，序列化合成回写 `|宽度`
                    #   （不落 data.json）
tests/
  md-roundtrip.test.ts # md 往返回归（describe/it 场景矩阵：解析结构/深度/不动点/编辑合成/rawOk 分支矩阵/uid/视图状态）
  md-roundtrip-property.test.ts # 往返生成式验证（fast-check：P1 不动点 T∘T=T / P2 canonical 行守恒——与 docs §3.6 白名单一一对应 / P3 不抛错 / P4 自建语料 fixtures/roundtrip/*.md + CRLF 程序生成 + 变异冒烟；生成空间按 §3.6 #10 收窄）
  md-inline.test.ts    # 行内 token 解析（链接/图片/embed/尖括号 URL 的边界形态）
  md-task.test.ts      # 任务前缀（domain/md-task）：`[ ]`/`[x]`/`[X]` 识别与「其后必须空白或
                       #   行尾」/ 显示文本剥离 / 切换不归一大小写 / 合成首行（空正文不留尾空）/
                       #   多行原文只换首行 token
  md-line-write.test.ts # 节点原文写入（整体重建行内字段 / 未编辑往返锁 / 多行 / 未闭合语法）
  domain.test.ts       # domain 层单测（wikilink 契约 + walkTree 语义）
  wiki-display.test.ts # 链接「生效显示名」纯判定（K6：六道闸门逐条 + 冗余省略 + 别名优先/回落默认名）
                       #   ——回写/可见名/tooltip 三消费方共用口径的直接回归（此前只靠端到端往返间接覆盖）
  constants.test.ts    # 扩展名清单边界（文档类 / 可渲染两份分流 —— 拖入与联想的「附件」口径已收敛到 domain/wikilink；`.base` 漏登记事故的防回退）
  content-remeasure.test.ts # 自绘内容定稿→尺寸同步会话（批量合并恰一次重排 / 两条回退顺序 / 渲染窗口重试一次后告警 / 字体分批再同步 / dispose 生命周期）
  concurrency.test.ts  # 并发原语回归（串行队列/防抖/节流：错误传播、尾随保证、重置、窗口重置）
  url.test.ts          # URL 谓词边界（各语义的协议形态与否决集）
  save-pipeline.test.ts# SavePipeline 竞态回归（写入中再触发排空、失败上报、防抖/守卫、无差异写盘跳过、
                       #   纯浏览守卫与撤销回加载态、收尾一致性自检、onSaved/onSaveError、
                       #   hasUnsavedChanges 的同源基准——多视图重载的判据）
  view-state.test.ts   # ViewStateStore（hydrate 形状校验、连线样式/配色/边框/视口按文件存取、防抖写盘、flushNow）
                      #   + 逐文件布局的清理（旧 viewState[*].layout 被剔除、空壳条目整条丢弃）
                      #   + resolveFilePreferences（三维缺省值同源，themeStyle 不许回落硬编码 default）
  settings.test.ts     # sanitizeSettings（类型/取值校验、坏值回退默认）
  settings-persist.test.ts # 设置写回防抖（滑块突发合并、内存即时生效）
  engine-controller.test.ts # EngineController（初始化代际锁、ResizeObserver 零尺寸等待、装配/销毁、引用预检、拖拽抑制、refresh/视口）
  errors.test.ts       # 错误处理共享件（createWarnOnce 幂等留痕：实例级去重/前缀/detail 透传；notifyError 文案拼接）
  event-binder.test.ts # EventBinder（注册即记录/销毁即清理：参数透传、监听器身份、幂等、单点抛错不阻断）
  persistence.test.ts  # PluginDataWriter（写前重读合并不丢键、串行队列、内部吞错）
  feature-helpers.test.ts # 特性纯函数（image-resize 等比缩放钳制）
  mindmap-theme.test.ts # 主题与配色（两态偏好解析与旧词汇归一、supportsLineStyleSwitch、无边框填充/描边归零、根节点保留锚点、不得越权改字体度量、配色六套×亮暗九键、文字色不随配色变、配色与主题正交、两个维度各自脏值回退）
  mindmap-wiki-icon.test.ts # 文档页图标 tooltip 与别名同口径（`docWikiLinkDisplay`，含负向自检）
  engine-history-limit.test.ts # 命令历史上限按 30MB 预算反推（500 节点⇒163 条 / 2000 节点⇒40 条、单调不增、地板 30、上限引擎默认 500）
  feature-teardown.test.ts # 交互会话收尾（图片调宽的临时 window 监听随视图关闭清理）
  images-path.test.ts  # 图片地址/尺寸（aspect 校正、官方尺寸语法、探测失败降级）
  file-lookup.test.ts  # 全库文件索引原语（缓存/失效/多形态地址命中）
  links-resolve.test.ts # 统一解析入口（按形态路由与兜底）
  links-tree.test.ts   # 树内引用更新（重命名/清除两模式）
  links-rename.test.ts # 重命名渲染源重建（字段+mdRaw 双层；别名/区块/嵌入附件/md 形态/幂等/回收站）
  links-split.test.ts  # 混排双链拆分（真实解析→方案→真实序列化；图片/外链保留、去重、幂等、未编辑不动）
  find-node-by-dom.test.ts # 引擎节点 DOM → 节点实例（右键命中）
  node-text-edit.test.ts # 右键「编辑文本」入口（延后一宏任务 emit node_dblclick、isInserting=false）
  node-inline-content.test.ts # 节点内联内容（方案 B 原型）：段序列切分与显示名口径
                        #   （多链接/URL/图片 token 边界）、接管判定（**段序列非空且无图**——
                        #   2026-10-09 起含文字节点恒自绘；空文本 / 整行注释返回 null、
                        #   **URL 承载节点恒接管**，2026-10-15 复核订正）、
                        #   锚点属性契约（internal-link[data-href] / external-link[href]）、
                        #   代码块（block 标记/信息行剥离/缩进保真/复制按钮结构，见 K91）、
                        #   引用块 / 标注段（切分顺序 / 正文递归 / 嵌套深度 / 原子截断，K196）
  callout.test.ts       # 标注判定（domain/callout，纯逻辑）：头部解析（`|` 元数据 / 折叠标记 /
                        #   `[!info]标题` 不算）、别名归一与原型键加固、四处「类型 id ≠ 变量名」、
                        #   标题 Title Case、前缀剥离（K196）
  node-inline-tag.test.ts # 标签切分（`kind:'tag'`）：顶层 prose 才认、`foo#bar`/`#2024` 不算、
                       #   `/` 分层与不允许结尾 `/`、代码/数学/注释/链接内不识别、`**#tag**` 不识别、
                       #   转义产物（`\#标题`）不成标签且仍是单个文本段（K150 ③）
  view-node-task.test.ts # 任务复选框：渲染契约（首个子元素 + role/aria-checked/data-task、
                       #   token 不进文字、含图节点不接管）与交互（mousedown/click/dblclick
                       #   capture 拦截、点击走原文写回且 `afterCommit: false`）
  view-tag.test.ts     # 标签点击接管（`a.tag[data-tag]` 命中才拦 → openTagSearch；
                       #   未命中放行；跨 realm 目标无 closest 时安全跳过）
  footnote.test.ts     # 脚注：定义行语法单源（与 md-outline 的豁免判定一致）、文档序索引
                       #   （多行续行 / 相邻两条 / 重复 id 首个生效 / 围栏与缩进代码不算 /
                       #   编辑跟随 / null 树）（K197）
  view-footnote.test.ts # 脚注交互调度（DOM / 事件桩直测）：sup 命中、同 id 多枚间移动、
                       #   渲染窗口不清未决 show、移出又移回、未定义悬停反馈、点击定位（K197 ⑧）
  tag-search.test.ts   # 标签搜索私有触点（platform/tag-search）：`tag:#名` 查询拼装 /
                       #   缺失或抛错降级为**一次** Notice + warn（不重复弹、不静默空转）
  color-directive.test.ts # 节点配色指令（`%%#hex%%` / 哨兵 `%%none%%`，K145/K149）：
                        #   注释段解析（围栏/行内码/数学内不识别）、就近覆盖继承 +
                        #   哨兵阻断、填充/连线/文字对比色落地、删指令清样式键、
                        #   写·换·清哨兵、有变化才重渲染（「默认」入口见
                        #   view-context-menu.test.ts）
  node-codeblock.test.ts # 代码块复制目标解析（resolveCodeCopyTarget 四态：命中/
                        #   非按钮/非元素/按钮在而 code 缺失）
  node-inline-editor.test.ts # 节点内联编辑器（features/node-inline-editor，见 K92）：
                       #   按键判定表（Enter/Mod+Enter/Tab/Esc 提交、Shift+Enter 换行、
                       #   Alt+Enter 让位）、会话生命周期（打开/有改动才写回/未改动
                       #   不写盘/点击外部与 mousewheel 提交/closeInlineEditor 幂等/
                       #   引擎重建守卫/重复打开先提交）、isAnyNodeEditing 统一判据、
                       #   applyRawNodeContent 原文写回编排（2026-10-04 审查补齐：写回→
                       #   重排→渲染→保存→K108 通知的次数与顺序、图片面仅在有 image
                       #   时探测、探测 reject 降级 console.warn 且不影响写回）
  math-jax.test.ts     # 行内数学渲染（platform/math-jax）：实机通道优先级（tex2chtml→tex2svg）、
                       #   **就绪判据（2026-10-15 v4 修正：规则落盘 + 宽度 > 0；元素不存在
                       #   = 未 flush ⇒ 判未就绪 + 驱动 flush）/ 未就绪同步撤回 / flush 合并与
                       #   放行重试 / 预算耗尽保留字面 + 告警 / 容器盒回退判定**（见 K87）；
                       #   **零宽豁免双形态（v3 空 content／v4 零 padding 规则、字体类后缀
                       #   容忍、padding 非全零与规则缺失仍不放行、索引随样式表内容失效）**
                       #   见 K113；
                        #   API 面缺失告警一次 / 抛错不上抛 / 未连接入队补替换 / 字体等待与拒绝
                        #   不阻塞；P4 面：塌缩不入缓存、定稿回调恰好一次（见 K86）
  viewport.test.ts     # 视口几何（resetZoom 画布中心锚点 / 内容包围盒居中 / 自动整理默认保留视口、
                       #   `fitView: true` 才延时 fit）；
                       #   自动整理的渲染窗口守卫（root 暂缺延后执行 / 超上限放弃，K67）
  mindmap-auto-open.test.ts # 声明驱动自动打开（多档延时/事件接线/陈旧档位不覆盖新状态/
                        #   全量扫描 50ms 防抖（突发合并，`core/concurrency` 的 `createDebouncer`）
                        #   与卸载取消，2026-10-15）
  nav-history.test.ts  # 导航历史卫生（K111）：尾部连续同文件段内删除跨视图冗余 /
                       #   目标态保留 / 跨段保护 / 形态异常降级（私有结构防御式）
  engine-refresh-nodes.test.ts # 批量自绘重建（refreshNodesCustomContent，P4 尺寸同步）：
                       #   逐节点 reRender(['custom']) + **恰好一次**全树 render；空态 no-op；
                       #   单节点抛错不中断其它节点（见 K86）
  pasted-name.test.ts  # 剪贴板图片命名（Pasted image YYYYMMDDHHMMSS）
  vendor-contract.test.ts # 引擎 vendor 契约（导出面/命令名/事件名令牌）
  view-node-actions.test.ts # 节点操作编排（链接通道分流/删除兜底/剪贴板/自兜错误）
  view-minimap.test.ts # 小地图**会话级**回归（fake DOM + fake window，引擎侧整体 vi.mock）：装配即画首帧 / 画布过窄不启用 /
                      #   判据失效的清场（尺寸与框坐标一并清）/ 30s 淡出与动图唤醒 / 样式类立即画 vs 布局类等渲染落地 /
                      #   落地但几何未变不换图（保留标记）/ 拖拽换算与帧内重投影、松手摘监听 / teardown 回收定时器与 DOM /
                      #   **唤醒分流**（淡出后渲染落地不复活、`resize` 算用户手势）/ **视口框按实时画布投影**（K137 / K140）
  minimap-geometry.test.ts # 小地图**纯几何与绘制模型**（零 DOM）：面板尺寸与开放高度 / 启用判据容差 / 全量包围盒与
                      #   DFS 步长抽样 / 三形态连线的逐坐标断言（busV·railLeft·chainRail）/ 鱼骨骨干+短骨+斜脊 /
                      #   SVG 分档与配色清洗 / 帧等价与指纹 / 30s 节拍（K131–K136 的直测面）
  engine-minimap-capture.test.ts # 缩略图取样（引擎侧读取面）：配色与墨色回落链 / 连线样式与布局分派 / 面板高度上限 /
                      #   取样异常只告警一次 / 传入测量与画布尺寸时不再重读 / 按节点数分档（K133 / K134）
  engine-measure-residue.test.ts # 引擎**离屏测量容器**的残渣清理（`clearMeasureResidue` 直测：清空 + `aria-hidden` +
                      #   幂等 + 四种 no-op；`createMindMap` 内 `node_tree_render_end` 注册点的源码契约，K152）
  view-split-links.test.ts # 混排双链自动拆分（候选捕获：设置关/未编辑/编辑中 no-op；候选集检查、编辑中保留、引擎换代丢弃）
  view-context-menu.test.ts # 右键菜单条目分流（链接双通道/图片/文字，画布菜单）
  view-dnd.test.ts     # 拖入分发（图片/笔记/附件/外部导入、两分支与提示）
  view-search.test.ts  # 搜索栏（装配/防抖/回绕/零命中计数/防抖窗口内跳转）
  view-status.test.ts  # 状态栏计数 + 保存状态（节流与尾随、状态不随计数节流延迟、
                      #   销毁/抛错降级、关闭清理、计数+状态组合文案）
  view-toolbar.test.ts # 右缘竖栏装配（四组/图标接线、连线与边框开关互切、固定布局下连线开关置灰、自动整理分支、重建）
  view-paste.test.ts   # 粘贴分发（容器监听与窗口兜底两入口、三道豁免（已消费/容器内/输入框）、
                      #   图片识别与接管、命名约定保存（覆盖系统临时名）、无节点提示、
                      #   保存 null 与「保存期间引擎换代」守卫、失败转用户提示）
  view-resize.test.ts  # 大图 resize 尾随合并（<1000 走 100ms 节流；≥1000 拖动期不重排、
                      #   停止 180ms 后一次；阈值边界 / 取消 / 大图切小图）
  view-export.test.ts  # PNG 导出（结果三态分流：Blob → 延迟回收对象 URL / data URL 直下 /
                       #   null 不下载；倍率与文件名（basename，缺省 mindmap）透传；失败转提示）
  export-svg-postprocess.test.ts # 导出 SVG 后处理（K106 几何余量——横向余量**左右各半**、
                        #   x 缺省按 0 算；+ platform 单入口）：
                      #   全 FO 宽 +12/高 +20、原样返回、非法尺寸跳过、无 FO / 形态不符 no-op；
                      #   单入口一次完成「几何 → CSS 变量注入」
  math-jax-export-pin.test.ts # 导出数学容器高度钉扎（K107：数量一致时逐钉 height（画布缩放归一 /
                       #   2 位小数 / !important）、域优先与全文退回、数量不符与形态不符 no-op、单元素不可测跳过）
  language-refresh.test.ts # 语言切换刷新（t/tf、语言下拉项、状态栏文案、命令标签刷新）
  view-wikilink.test.ts # 链接交互（点击分流/三通道取值（文档·附件·外链）/悬停预览去重、触发面与弹窗锚定尺寸）
  view-hotkeys.test.ts  # 视图内快捷键（F2 编辑当前节点：吞键/让位/去重）
  modal-common.test.ts # 弹窗共享件（settle 守卫/按钮变体/库内文件联想）
  modal-input.test.ts  # 命名/链接弹窗（预填与焦点、空白确认、settle 幂等、联想接线）
  plain-text-parser.test.ts # LICENSE parser（LF/CRLF 行 token、剥离 \r 的有意差异、防回退护栏）
  agents-md-sync.test.ts # 文档同步契约：src/** 与 tests/** 每个文件都必须登记在 AGENTS.md（漏登记即红灯）
  check-gates.test.ts  # 变更驱动门禁的**映射**直测（`scripts/check-gates.mjs` 的 buildPlan：baseline 顺序 /
                       #   各 conditionals 的触发面与跳过理由 / 变更集不可读时保守全跑；parseExemptionRows 的行
                       #   形态与 stale 判定）。脚本主体有 import 守卫，import 本测试不会真跑 npm 链
  module-boundaries.test.ts # 模块依赖图性质：按**解析后的真实路径**判层（组内成环 / 深层路径 /
                       #   新一级目录未登记——lint 结构上表达不了的三类）+ 组合根禁令；矩阵唯一定义在
                       #   `scripts/module-boundaries.mjs`，与 eslint zone 块同源
  docs-standard.test.ts # 标准文档一致性：目录 = 标题序列 / 每节「> 规则：」摘要 / `path#符号` 指针存在 /
                       #   附录版本 = `manifest.json` / 退役术语 / 白名单 ↔ 映射表对齐
  setup.ts             # vitest 全局 setup：Node 环境 window 桩（fake timers 生效）
  mocks/obsidian.ts    # obsidian 最小 mock（vitest alias，包本身无运行时 JS）
docs/
  markdown-mindmap-standard.md  # Markdown ↔ 思维导图映射规则（权威标准）
  release-notes-<tag>.md        # 各版本发布说明（中英双语；release.yml 按 tag 取用）。
                    #   **缺失即硬失败**（2026-10-13 起 tag 门禁校验存在性，不再回退自动生成）
```

### 文件规模与豁免（超限须登记）

官方社区模板建议单文件控制在 200–300 行。本项目**不做机械拆分**——按「拆分会不会把已有收口职责摊开」判定，而不是按行数判定：行数是症状，收口点被拆散才是病。故引入一条硬规则：

> **超过 300 行的源文件必须在 `AGENTS.md`「文件规模与豁免」表登记豁免理由；未登记者一律视为待偿还债务。**

（豁免是「已知并接受」，不是「没看见」。债务指标：**未登记的超限文件数，只允许递减**。）

> **登记表只在 `AGENTS.md`「文件规模与豁免」一处维护**（2026-11-09 起）：逐文件行数、
> 豁免理由、行数回填（`npm run check:gates -- --fix-lines`）与两道机械门禁
> （`agents-md-sync` 的漂移阈值、`check:gates` 的「未登记超限」核对）都读那一张表。
> 本文件**不再复制**——两张表并行时只有一张受门禁，另一张必然漂移（实测同一文件曾
> 同时出现 1121 / 1280 两个读数，而另一处已涨到 1532）。读行数请直接看 `AGENTS.md`
> 或跑 `npm run check:gates -- --dry-run`。

行数快照与历次回填流水见 `docs/agents/line-count-log.md`（只追加、不改旧条目）；
本文件不保留任何行数数字——同一个可漂移的量只允许有一处权威。

**判定分两层**：
1. **是否已登记理由**（文档层）—— 未登记者一律视为待偿还债务，`npm run check:gates`
   的 line-budget 静态核对会红灯。
2. **登记值与实测的漂移**（机械层）—— `tests/agents-md-sync.test.ts` 的「豁免表登记
   行数与实测无超阈值漂移」用例守门，阈值 `±min(+15%, +50 行)`（**双向**）。
   改动任一豁免文件后若该用例转红，必须回填 `AGENTS.md` 的行数列
   （`npm run check:gates -- --fix-lines`）。

**函数内拆分口径（2026-09-28「批次 2」逐行评估裁决）**：超长函数（>90 行）能否拆，判据同文件级——「拆会不会把契约摊开」，而非行数。① **不拆**（判定/优先级链形态：分支**顺序即契约**、注释与状态流集中可见；拆分需 `continue`→`return` 转换或引入 ctx/闭包状态，属机械改写而非提取）——`md-outline.buildInlineData`（220 行）/ `md-outline.classifyLines`（174）/ `node-inline-content.splitMarkedText`（111）。② **拆**（纯移动：块间独立、签名统一、零共享可变状态）——2026-09-28 已完成：`view-wikilink.registerWikilinkInteractions`（137 → 编排壳 + 点击/悬停/画布锚点悬停/中键四个注册函数）、`view-toolbar.buildToolbar`（114 → 编排壳 + 右缘四组构建；2026-10-22 重排为浮层后仍是编排壳形态）、`commands.registerCommands`（145 → 编排壳 + 创建/视图/导出与文档三组）。**重跑函数级评估前先读本节**，避免重复论证。
