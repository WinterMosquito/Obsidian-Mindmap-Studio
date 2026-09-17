# MindMap Studio — Obsidian 社区插件（Markdown 渲染层）

## 项目概览

- 目标：Obsidian 社区插件（TypeScript → 打包为 JavaScript）。
- 定位：**Markdown 渲染层**——`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），插件解析为思维导图、编辑后无损回写为 Markdown；无任何专有格式。
- 入口：`src/main.ts`，编译为 `main.js`，由 Obsidian 加载。
- 发布产物：`main.js`、`manifest.json`、`styles.css`。
- 插件标识：`id: mindmap-studio`（安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`）。
- 引擎：`simple-mind-map 0.14.0-fix.3`——思绪思维导图（sxmind.cn）发布的第三方修订版（fork 自 wanglin2/mind-map 0.14.0，修订清单见 `vendor/BUILD.md`），以压缩产物 vendor 于 `vendor/simple-mind-map.cjs`（按需 tree-shake 重打包，附手写类型声明 `vendor/simple-mind-map.d.cts`）。**不 vendor 引擎 CSS**：上游 dist CSS 100% 是 Quill 富文本样式（本插件不注册 RichText），引擎样式由 bundle 运行时注入 `document.head`（详见 `vendor/BUILD.md`）。打包/升级流程见 `vendor/BUILD.md`。

## 环境与工具

- Node.js：`>=18`（以 `package.json` 的 `engines` 字段为准；开发建议当前 LTS）。
- 包管理器：npm。
- 打包器：esbuild（`esbuild.config.mjs`）。
- 类型：`obsidian` 类型定义。

### 安装

```bash
npm install
```

### 开发（watch）

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

### 手工安装（测试）

将 `main.js`、`manifest.json`、`styles.css` 复制到：

```
<Vault>/.obsidian/plugins/mindmap-studio/
```

重载 Obsidian，在「设置 → 第三方插件」启用。

## 代码结构

**分组与分层（依赖单向；许可集与 lint 机械强制见 K51）**：

| 层 | 组 | 定位 |
|---|---|---|
| L0 | `domain/` | 纯领域逻辑（零依赖，lint 强制） |
| L1 | `core/` `links/` `markdown/` `media/` `engine/` `platform/` | 基础模块组（组间许可：`links→core`；`markdown→links/core`；`media→links/core`；`engine→core`；`platform→links/markdown/core`） |
| L2 | `ui/` `services/` | 弹窗与视图服务 |
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
    tree.ts         #   walkTree 先序遍历（显式栈防溢出，visit 返回 false 短路）
    md-meta.ts      #   MdNodeMeta：节点 data 上 md* 元数据的类型契约（纯契约，无引擎类型）
  core/             # L1 基座：通用机制与共享词汇
    constants.ts    #   全局常量：MD_FILE_SUFFIX、扩展名分流清单、布局/连线/主题选项、
                    #   hasMindMapMarker/stripMindMapStem/withMindMapMarker（标记后缀唯一实现）
    i18n.ts         #   t() 取文案、tf() 占位符格式化
    errors.ts       #   errorMessage(error)：面向用户的错误消息格式化唯一实现
    concurrency.ts  #   并发原语唯一实现：串行队列/防抖/节流（SavePipeline/ViewStateStore/
                    #   状态栏计数等共用；节流支持 trailingResetsWindow 选项）
    event-binder.ts #   DOM/引擎事件绑定器（作用域化统一销毁）
    persistence.ts  #   data.json 写盘器（PluginDataWriter：串行队列 + 写前重读合并 + 吞错）
    node-data.ts    #   MdNodeData 黏合类型（引擎 MindMapNodeData + domain MdNodeMeta；
                    #   放 core 保持 domain 零依赖）
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
    md-open.ts      #   .mindmap.md 触发判定、视图切换、打开方式偏好钩子
    md-line-write.ts #  节点行内容**原文写入**（编辑弹窗原文模式的提交）：重解析 → 整体
                    #   重建行内字段（链接/图片/台账）⇒ 未编辑态 ⇒ 保存逐字写回用户输入
    links-split.ts  #   混排双链拆分纯逻辑（方案生成/批量改写/写回字段）；规则与产品决策
                    #   见文件头契约；视图侧执行在 features/view-split-links.ts
  media/            # L1 图片与附件
    images-path.ts  #   图片地址→资源地址（经统一解析入口）、外部地址判断、尺寸校正
    images-save.ts  #   图片入库（走 concurrency 串行队列）、文件名清理
  engine/           # L1 引擎封装（纯模块，无 obsidian 依赖）
    mindmap.ts      #   引擎封装（创建/销毁/节点工具）+ 防腐收口（缩放/getRenderRoot/setNodeText/
                    #   forceRemoveNodeData/getNodeGroupEl/runWithExportScale/countTreeNodes/
                    #   exportMindMapPng/搜索 6 函数（searchMindMap/searchNextInMindMap/endMindMapSearch/
                    #   getSearchMatchCount/getSearchCurrentIndex/jumpToSearchIndex）/
                    #   isEditingText/getRootText/startNodeTextEdit/isCustomNodeContent）
                    #   + createNodeContent 钩子（节点内联内容，方案 B：注入
                    #   isUseCustomNodeContent/customCreateNodeContent + NodeContentStyle 解析）
                    #   + ENGINE_COMMANDS：引擎命令名常量表（execCommand 勿再写魔法字符串）
                    #   —— 视图/特性层不直接触碰引擎 renderer/view/search/doExport 内部形态
    mindmap-theme.ts #  主题配置（buildThemeConfig 唯一实现，视图主题参数化差异：
                    #   亮/暗 + 连线样式；lineStyleForLayout 布局默认、resolveLineStyle 偏好解析）
  platform/         # L1 Obsidian 平台集成
    vault-sync.ts   #   库事件同步单一入口（引用更新、索引失效；插件侧补充处理经 hooks 注入）
    open-as-restore.ts # 「以思维导图打开」偏好恢复（active-leaf-change/file-open/启动多档延时）
    system-open.ts  #   系统默认应用打开库内文件（桌面端 shell.openPath）
    vault-prefs.ts  #   官方库级偏好读取（useMarkdownLinks / newLinkFormat；getConfig 内部接口）
    math-jax.ts     #   行内数学渲染（官方 loadMathJax 通道；占位即回退，注入 node-inline-content）
  ui/               # L2 弹窗
   modal-common.ts / modal-image.ts / modal-link.ts / modal-name.ts / modal-text.ts
                    # 链接/图片/命名/节点文本弹窗（官方 AbstractInputSuggest 联想；settle 守卫与
                    #   VaultFileSuggest 联想类收口在 modal-common.ts）；modal-text 是
                    #   **自绘（富）节点**的文本编辑入口——引擎编辑框对其静默 no-op
                    #   （textEdit.show 的 isUseCustomNodeContent 守卫），故由插件兜底
  services/         # L2 视图服务
    document-service.ts # md 文档读取解析 + 保存管线（防抖/串行排空/卸载快照兜底，onSaveError 上报；
                        #   写盘前 cachedRead 比对，内容一致跳过 modify）；
                        #   解析只做图片地址解析，不做尺寸归一（视图走 aspect 校正）；写盘归属：树快照与 frontmatter 按**该次写盘的文件**取（getSnapshotFor/getFrontmatterFor），不同文件不并入同一批次——core 不 await onUnloadFile，换文件期间的排空必须同源
    engine-controller.ts# 引擎实例生命周期 + 防腐收口（renderer 内部不外泄）
    view-state.ts   #   按文件路径持久化布局/连线样式/视口/openAs 到插件 data.json（ViewStateStore）
    status-bar.ts   #   StatusBarService 契约 + 插件层实现（节点计数展示/清空，DOM 归插件层）
  features/         # L3 UI 特性与视图控制器
    view.ts         # Controller：Obsidian 生命周期编排、service 装配、链接跳转、标题重命名
    view-context.ts # MindMapViewContext：view-* 对视图的访问契约（结构化窄接口）
    view-*.ts       # 18 个交互特性各自一文件：工具栏（view-toolbar.ts）/ 拖拽（view-dnd.ts）/
                    #   右键（view-context-menu.ts）/ 搜索（view-search.ts）/ 导出（view-export.ts）/
                    #   状态栏（view-status.ts）/ 图片灯箱（view-image-fullscreen.ts）/
                    #   图片动作（view-image-actions.ts）/ wikilink 交互（view-wikilink.ts）/
                    #   链接跳转（view-link-navigator.ts）/ 粘贴（view-paste.ts）/
                    #   节点操作（view-node-actions.ts）/ 标题重命名（view-title-renamer.ts）/
                    #   快捷键（view-hotkeys.ts：F2 编辑当前节点 / Delete 删除节点 / Shift+1/2 缩放）/
                    #   节点宽度（view-node-width.ts：拖宽结束 → 重建自绘内容；手柄门禁
                    #   gateNodeWidthHandles：只让自绘节点出现拖宽手柄）/

                    #   混排双链拆分（view-split-links.ts）/ 视口（view-viewport.ts：
                    #   Shift+1/2 的缩放实现 + 抑制中键自动滚动；**滚轮与中键拖由引擎负责**）/
                    #   Alt 拖拽复制（view-drag-duplicate.ts）/
                    #   共用件（view-common.ts：insertChildNodeWithData 等）
    node-inline-content.ts # 节点内联内容（**方案 B 原型**）：行内 token → 段序列 →
                    #   自绘 HTML（`a.internal-link[data-href]` / `a.external-link[href]`）；
                    #   经 engine 的 createNodeContent 钩子注入，含行内链接 / 轻标记 / 超长文本且无图的节点被
                    #   完全接管（其余返回 null 回落引擎 SVG 文本）；点击/悬停复用
                    #   view-wikilink 既有锚点分流（零改造）。边界见文件头契约：
                    #   自绘节点无 `_textData`，引擎编辑框有 isUseCustomNodeContent
                    #   守卫 → 双击不进入编辑（富节点编辑入口待后续方案）
    image-resize.ts # 节点图片拖拽调宽：hover 手柄 + 等比缩放（SET_NODE_DATA imageSize
                    #   custom:true + render），持久化走 Obsidian 官方嵌入尺寸语法——
                    #   结束时 scheduleSave，序列化合成回写 `|宽度`（不落 data.json）
    drag-target.ts  # 拖拽换父辅助：优化「拖动节点重新链接」的识别范围——引擎原生
                    #   判定要求指针精确落在目标矩形内，本模块在拖拽期间（仅拖拽中，
                    #   node_dragging 起会话、mouseup/node_dragend 收）以「节点中心为
                    #   锚点的均匀圆域」（DRAG_TARGET_RADIUS_PX，与节点大小无关）取最近节点
                    #   经 setDragOverlapTarget 外借给引擎，引擎精确命中时让位；
                    #   松手走引擎原生 MOVE_NODE_TO
    file-creator.ts # 文件浏览器「新建」菜单注入（私有 API 防御式访问）
tests/
  md-roundtrip.test.ts # md 往返回归（describe/it 场景矩阵：解析结构/深度/不动点/编辑合成/rawOk 分支矩阵/uid/视图状态）
  md-inline.test.ts    # 行内 token 解析（链接/图片/embed/尖括号 URL 的边界形态）
  md-line-write.test.ts # 节点原文写入（整体重建行内字段 / 未编辑往返锁 / 多行 / 未闭合语法）
  domain.test.ts       # domain 层单测（wikilink 契约 + walkTree 语义）
  constants.test.ts    # 扩展名清单边界（文档类 / 可渲染两份分流 —— 拖入与联想的「附件」口径已收敛到 domain/wikilink；`.base` 漏登记事故的防回退）
  concurrency.test.ts  # 并发原语回归（串行队列/防抖/节流：错误传播、尾随保证、重置、窗口重置）
  url.test.ts          # URL 谓词边界（各语义的协议形态与否决集）
  save-pipeline.test.ts# SavePipeline 竞态回归（写入中再触发排空、失败上报、防抖/守卫、无差异写盘跳过）
  view-state.test.ts   # ViewStateStore（hydrate 形状校验、布局/连线样式/视口按文件存取、防抖写盘、flushNow）
  settings.test.ts     # sanitizeSettings（类型/取值校验、坏值回退默认）
  settings-persist.test.ts # 设置写回防抖（滑块突发合并、内存即时生效）
  engine-controller.test.ts # EngineController（初始化代际锁、ResizeObserver 零尺寸等待、装配/销毁、引用预检、拖拽抑制、refresh/视口）
  event-binder.test.ts # EventBinder（注册即记录/销毁即清理：参数透传、监听器身份、幂等、单点抛错不阻断）
  persistence.test.ts  # PluginDataWriter（写前重读合并不丢键、串行队列、内部吞错）
  feature-helpers.test.ts # 特性纯函数（drag-target 识别范围几何、image-resize 等比缩放钳制）
  mindmap-theme.test.ts # 主题配置（布局→连线样式映射、切换判定 supportsLineStyleSwitch、偏好解析与透传）
  mindmap-wiki-icon.test.ts # 文档页图标 tooltip 与别名同口径（`docWikiLinkDisplay`，含负向自检）
  engine-history-limit.test.ts # 命令历史上限按 30MB 预算反推（500 节点⇒163 条 / 2000 节点⇒40 条、单调不增、地板 30、上限引擎默认 500）
  feature-teardown.test.ts # 交互会话收尾（拖拽换父/图片调宽的临时 window 监听随视图关闭清理）
  images-path.test.ts  # 图片地址/尺寸（aspect 校正、官方尺寸语法、探测失败降级）
  file-lookup.test.ts  # 全库文件索引原语（缓存/失效/多形态地址命中）
  links-resolve.test.ts # 统一解析入口（按形态路由与兜底）
  links-tree.test.ts   # 树内引用更新（重命名/清除两模式）
  links-split.test.ts  # 混排双链拆分（真实解析→方案→真实序列化；图片/外链保留、去重、幂等、未编辑不动）
  find-node-by-dom.test.ts # 引擎节点 DOM → 节点实例（右键命中）
  node-text-edit.test.ts # 右键「编辑文本」入口（延后一宏任务 emit node_dblclick、isInserting=false）
  node-inline-content.test.ts # 节点内联内容（方案 B 原型）：段序列切分与显示名口径
                        #   （多链接/URL/图片 token 边界）、接管判定（无链接/含图返回 null）、
                        #   锚点属性契约（internal-link[data-href] / external-link[href]）
  viewport.test.ts     # 视口几何（resetZoom 画布中心锚点 / 内容包围盒居中 / 自动整理后重置缩放）；
                       #   自动整理的渲染窗口守卫（root 暂缺延后执行 / 超上限放弃，K67）
  open-as-restore.test.ts # 「以思维导图打开」偏好恢复（多档延时/代际）
  pasted-name.test.ts  # 剪贴板图片命名（Pasted image YYYYMMDDHHMMSS）
  vendor-contract.test.ts # 引擎 vendor 契约（导出面/命令名/事件名令牌）
  view-node-actions.test.ts # 节点操作编排（链接通道分流/删除兜底/剪贴板/自兜错误）
  view-split-links.test.ts # 混排双链自动拆分（候选捕获：设置关/未编辑/编辑中 no-op；候选集检查、编辑中保留、引擎换代丢弃）
  view-context-menu.test.ts # 右键菜单条目分流（链接双通道/图片/文字，画布菜单）
  view-dnd.test.ts     # 拖入分发（图片/笔记/附件/外部导入、两分支与提示）
  view-search.test.ts  # 搜索栏（装配/防抖/回绕/零命中计数/防抖窗口内跳转）
  view-status.test.ts  # 状态栏计数（节流与尾随、销毁/抛错降级、关闭清理）
  view-toolbar.test.ts # 工具栏装配（分组/图标/命令接线、布局与连线样式选择器（固定布局收窄为单项）、自动整理分支、重建）
  language-refresh.test.ts # 语言切换刷新（t/tf、语言下拉项、状态栏文案、命令标签刷新）
  view-wikilink.test.ts # 链接交互（点击分流/三通道取值（文档·附件·外链）/悬停预览去重、触发面与弹窗锚定尺寸）
  view-hotkeys.test.ts  # 视图内快捷键（F2 编辑当前节点：吞键/让位/去重）
  modal-common.test.ts # 弹窗共享件（settle 守卫/按钮变体/库内文件联想）
  modal-input.test.ts  # 命名/链接弹窗（预填与焦点、空白确认、settle 幂等、联想接线）
  plain-text-parser.test.ts # LICENSE parser（LF/CRLF 行 token、剥离 \r 的有意差异、防回退护栏）
  agents-md-sync.test.ts # 文档同步契约：src/** 与 tests/** 每个文件都必须登记在 AGENTS.md（漏登记即红灯）
  setup.ts             # vitest 全局 setup：Node 环境 window 桩（fake timers 生效）
  mocks/obsidian.ts    # obsidian 最小 mock（vitest alias，包本身无运行时 JS）
docs/
  markdown-mindmap-standard.md  # Markdown ↔ 思维导图映射规则（权威标准）
  release-notes-<tag>.md        # 各版本发布说明（中英双语；release.yml 按 tag 取用，缺失回退自动生成）
```

### 文件规模与豁免（超限须登记）

官方社区模板建议单文件控制在 200–300 行。本项目**不做机械拆分**——按「拆分会不会把已有收口职责摊开」判定，而不是按行数判定：行数是症状，收口点被拆散才是病。故引入一条硬规则：

> **超过 300 行的源文件必须在下方表格登记豁免理由；未登记者一律视为待偿还债务。**

（豁免是「已知并接受」，不是「没看见」。债务指标：**未登记的超限文件数，只允许递减**。）

| 文件 | 行数 | 豁免理由 |
|---|---|---|
| `src/engine/mindmap.ts` | 942 | 引擎防腐层**唯一收口点**：vendor 内部形态（`node.group`、`renderer.*`、DoExport、Search 插件状态…）只允许在此出现。拆开等于把私有访问面摊到多个文件，耦合面反而变大——**这一条是必须豁免的，拆分即违约** |
| `src/markdown/md-serialize.ts` | 858 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。（链接「生效显示名」的纯判定已下沉 `domain/wiki-display.ts` 供 `mindmap.ts` 复用——那是**跨模块复用**，不是本文件内聚被拆） |
| `src/markdown/md-outline.ts` | 943 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则，拆开会让两侧规则漂移 |
| `src/core/i18n.ts` | 470 | 纯词条表（无逻辑分支），拆分只增加 import 噪音，无内聚收益 |
| `src/features/view.ts` | 643 | 视图 Controller：**第 6 步拆分后的纯编排壳**（见文件头契约）。只做「生命周期事件 → 装配 services 与 view-* 交互特性」；业务已全部外置（DocumentService/EngineController/TitleRenamer/openHyperlink…）。再拆会把「生命周期编排顺序集中可见」这一收口点摊到多文件 |
| `src/services/engine-controller.ts` | 530 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法。与 `mindmap.ts` **同性质**——拆开即把私有访问面摊开，故同样必须豁免 |
| `src/media/images-path.ts` | 462 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一），**从 images.ts 拆出**的产物；导出函数共享同一套路径与尺寸不变式，再拆会摊成跨文件的隐式协议 |
| `src/features/image-resize.ts` | 394 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链（无常驻监听、按帧重建元素、手势独占），拆开会让状态机与 DOM 手柄跨文件失配 |
| `src/features/drag-target.ts` | 322 | 单一算法收口（拖拽落点仲裁）：两类锚点（节点中心／兄弟间隙中点）必须共用同一套「按指针距离最近仲裁 + 引擎三态让位」规则，拆开会让锚点判定与视觉高亮口径漂移 |
| `src/features/view-node-actions.ts` | 581 | 节点操作（链接/文本/剪贴板/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export，此处是剩余语义相关操作集，再拆会让两个菜单的调用面分叉 |
| `src/features/view-dnd.ts` | 484 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配 |
| `src/main.ts` | 316 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。业务逻辑已全部外置（见文件头），拆开 onload 会破坏「装配顺序集中可见」的可读性收益；当前仅超线 16 行 |
| `src/markdown/links-split.ts` | 476 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。与 `md-outline` / `md-serialize` 同性质 |
| `src/core/constants.ts` | 357 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件，互有基表派生；「可链接附件」「系统媒体」两份白名单已于 2026-09-15 删除——附件口径收敛到 `domain/wikilink.wikilinkTargetIsAttachment`）；K28 要求「扩展名清单集中在 `constants.ts`，勿复制」——拆分即打断该收口，同 `i18n` 性质，只增加 import 噪音 |
| `src/settings.ts` | 313 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。`sanitizeSettings` 被 data.json 加载与面板写回共用（已在「代码结构」清单登记） |
| `src/features/node-inline-content.ts` | 750 | 自绘节点内容的**单一关注点**闭环：行内原文 → 段序列（含轻标记切分）→ HTML（锚点契约 + **内联样式常量**）。三份东西互为契约——样式常量即导出保真契约（K53 ⑤，引擎导出不注入插件 CSS）、锚点属性即 `view-wikilink` 的识别契约（K53 ③）——拆开会让「显示名口径 / 样式来源 / 锚点形态」跨文件漂移；文件的复杂度全部来自这三个契约的**取值表**（段类型 × 标记 × 样式），不是职责堆叠 |
| `src/features/view-wikilink.ts` | 348 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。两条预览路径**都不预检目标是否存在**（交核心判断，见 K21） |

行数为 2026-09-15 快照（**取消拖入白名单并同步文档后**按 `Get-Content` 行数重测：`md-outline.ts` 943、`md-serialize.ts` 858、`mindmap.ts` 942、`node-inline-content.ts` 750、`view.ts` 643、`view-node-actions.ts` 581、`engine-controller.ts` 530、`view-dnd.ts` 484、`i18n.ts` 470、`links-split.ts` 476、`images-path.ts` 462、`image-resize.ts` 394、`constants.ts` 357、`view-wikilink.ts` 348、`drag-target.ts` 322、`main.ts` 316、`settings.ts` 313；2026-09-15 复核：全部 17 个超限文件均已登记理由），仅供参考；判定以「是否已在表内登记理由」为准，不以数字为准。

## 测试与 CI

```bash
npm test            # vitest run（CI 在 build 后、lint 前执行）
npm run test:coverage  # vitest run --coverage（v8 provider，报告出 coverage/；CI 主矩阵版本执行并归档产物）
npm run lint:css    # stylelint：styles.css 的 CSS 检查（规则面照抄官方 scanner，见下方「CSS 检查」）
npm run check:release # 发布元数据护栏（versions.json 形状 / 当前版本与 minAppVersion 一致 / README 非空）
npm run check:dead-code # knip 死代码检查（未使用文件/导出/类型；见 K57）
npm run verify:visual  # 无头 Chrome 渲染契约验证（scripts/verify-visual.mjs）
```

CI（`.github/workflows/lint.yml`）执行顺序：`check:release` → build → `npm test -- --reporter=verbose --bail=1` →
coverage（主矩阵版本，并上传 coverage 产物）→ lint → `lint:css` → `check:dead-code`（knip，见 K57）→
`verify:visual -- --require-chrome --keep --log-dir verify-visual-logs`（主矩阵版本）。

发布流程（`.github/workflows/release.yml`）**自带门禁**：tag push **不会**触发 `lint.yml`
（其 `on.push` 只匹配 branches，不匹配 tag），故 `release.yml` 在构建前先跑
`check:release` + `npm test` + `npm run lint` + `npm run lint:css`——任一失败即不产出 release。
（官方 `obsidianmd/obsidian-workflows` 的 release 模式同样在 tag 上强制跑一遍校验；
本项目用自有脚本等价承接，不引入 scanner 那套被钉死的依赖版本。）

**CSS 检查（stylelint）**：`styles.css` 是发布资产，而官方目录 scanner 在 release 模式
**强制**对该文件跑 stylelint（`obsidian-workflows/src/lint.ts:246-329`、`:565`，目标 `**/*.css`）。
本地配置在 `stylelint.config.mjs`，规则面照抄官方 `SCANNER_STYLELINT_CONFIG`
（`src/lint.ts:10-123`），其中**唯一 error 级**规则是 `function-url-scheme-disallowed-list`
（禁止 `url()` 里出现 `http`/`https`/`file`，只允许 `data:`）——这是「主题/插件不得从网络
加载资源」的机械落点。三条维护要点：
① `browsers: ['electron >= 39']` 由 `minAppVersion: 1.13.0` 经官方 `ELECTRON_VERSIONS`
映射表推得（`src/lint.ts:126-160`）——**改 `minAppVersion` 时必须同步该值**；
② `ignoreFiles` 必须排除 `coverage/**`（lcov 报告里的 `base.css` / `prettify.css` 是生成物，
不属插件资产，纳入即误报）；
③ 该配置是**独立配置、无 `extends`**（与官方那份一致），故未被列出的规则一律不启用，
检查面与 scanner 相同。

**发布元数据护栏（`scripts/check-release-metadata.mjs`）**：本仓库 eslint 把 `versions.json`
放进 `globalIgnores`，而官方对它有 **error 级**形状校验（JSON 非法或非对象即阻断其 release）
⇒ 此前没有任何替代检查。脚本校验四项：`versions.json` 形状与 semver、`manifest.version`
在表内、**当前版本**的值 == `manifest.minAppVersion`、README 有有效内容。
**不要**把它改成「所有版本的值都等于 `minAppVersion`」——历史版本可以合法地要求更低的
app 版本，唯一正确的不变式是「当前版本」那一条。

`verify:visual` 这一步标了 `continue-on-error: true`（**非阻断**），因为它曾在 Linux 无头
环境偶发失败，而当时既读不到失败日志、又无 token 调 API 定位，最终被回退（见 commit
`7930d62`）。重新接入的前提就是「失败必须留下证据」，故同时加了 `--log-dir`：日志与
`--dump-dom` 快照经 `if: always()` 步骤归档成 artifact，失败时可直接下载定位。
浏览器缺失仍然直接失败（`--require-chrome`），不静默跳过。

- `verify:visual`：把 `src/engine/mindmap.ts`（纯模块）esbuild 成浏览器 IIFE，配仓库真实
  `styles.css` 在无头 Chrome 里渲染 10 个场景并断言 `--dump-dom`——三类链接图标分流与
  图标尺寸（18×18）、回形针标题、画布铺满容器、节点测宽随文本（不被容器拉平）、
  仅轻标记（无链接）节点也走自绘（`markup` 场景）、**轻标记扩展与隐藏语法**（`syntax`
  场景：`==高亮==`→`<mark>`、`__粗__`→`<strong>`、`\*转义\*` 消费反斜杠、
  `%%注释%%` 不进显示、未解析链接带 `is-unresolved` 且对照组不加标记）、段落（多行）
  节点里的链接同样可点且多行结构保留（`paragraph` 场景，对应 README 的对外承诺）、
  超长单行 20k 字必须接管并截断（`hugeline` 场景；若回归成「回落引擎」，该场景既会
  断言失败，也会因吃掉 `--virtual-time-budget` 而让后续探针集体失败），
  外加**十二个**探针：viewport（20 层深链大图必须 100% 缩放、整体内容居中，且重置缩放漂移
  ≤1px）、anchor（SVG 节点补齐 `offsetWidth/offsetHeight`，弹窗锚定矩形
  `bottom/right` 必须为有限数，否则预览只会出现在上方）、inline（**方案 B**：
  自绘节点内容必须落在 foreignObject 内、引擎离屏克隆测宽与渲染宽度同源、`**重点**`
  渲染为 `<strong>`，且合成 click 后 `node_click` 的 `event.target` 就是锚点本体、
  `data-href` 为原始 linkpath——即 `view-wikilink.findAnchorInNode` 的前置判据；
  纯文本节点不得出现自绘锚点）、history（调宽写入通道：帧内 0 历史 / 0 保存调度、
  收尾各 1，等过 `addHistoryTime=100ms` 防抖窗口再读数）、handle（宽度手柄只留在
  自绘节点上）、undo（插入 → BACK 的 DOM 精确还原 × 节点实例同一性）、export（导出
  SVG `svgHTML` 里自绘根元素 / 锚点 / 轻标记元素必须带**内联样式**——引擎导出不注入
  插件 CSS，见 K53 ⑤）、scale（30 个自绘节点的大图：全部渲染、节点总数 67、离屏
  测宽元素恒为 1＝无测量垃圾累积）、perf（DOM 规模：同形状两棵 30 子节点地图，
  自绘侧 foreignObject 必须 30、引擎文本侧 0，**每节点元素预算**≤12（引擎文本）
  /≤20（自绘）；实测 8.2 vs 7.5/节点 ⇒ **自绘不比引擎文本更重**；另断言空 render
  构建器调用 0、改文本恰好 1——自绘成本模型按编辑数线性而非按帧，及
  `countTreeNodes` 对数据树可用=1000 节点）、image（图片尺寸回灌：生产同款流程
  「解析器不产 imageSize → ensureDefaultImageSizes 填默认 → 首帧 → 回灌」后渲染
  尺寸确实从默认值变到校正值，且对照组「不填默认值」整图不渲染）、count（性能
  模式阈值 1 强制开启的 151 节点地图：渲染树计数仍 151 / DOM 仅 11 组——
  `removeNodeWhenOutCanvas` 只摘 DOM、渲染树结构完整，状态栏计数不漏计）、edit（编辑成本基线：
  500 节点非性能模式图走生产路径 `setNodeText`，断言**布局落地恰好 1 次**；并记录 DOM 变更的类型
  拆分——空 render 对照实测「真变化 0 + 同值空写 2495」，证明引擎整树渲染无脏值比对，见 K58）、
  perf-switch（性能模式运行时切换：151 节点图 DOM 组数 **151 → 开启 11 → 关闭 151**，渲染树恒 151，
  见 K60）、render-eco（渲染经济：8 条动作的布局落地次数，包装函数恰好 1 次、开启性能模式 2 次为有意，
  见 K61）与 layout（六种布局各渲一遍：
  节点数、连线样式分派——曲线布局的连线必须全含 C/Q、四种直线布局必须零曲线——
  以及**根节点连线起点必须落在节点边缘**（从中心起画＝「斜戳」衔接回归）；
  连线路径统计须排除 `class="smm-node-shape"` 的节点形状路径，否则圆角命令会被
  误判成曲线；并断言引擎快捷键表非空且**不含 `Control+l`**——自动整理不得留默认热键）。
  **所有探针不做耗时断言**——脚本跑在 `--virtual-time-budget` 下，时钟被虚拟化；
  且引擎 `render()` 经 rAF 调度 ⇒ **计数类测量必须等 settle 再读**（同步读恒为 0
  是异步假象，不是「没发生」）。
  **真实耗时走另一通道（opt-in）**：`npm run verify:visual -- --perf [--perf-edits N]`——同一页跑
  「空跑 / 负载」两种入口、按**进程墙钟差**给真实成本（虚拟时钟下页内计时不可用，见 K63）。
  **负向自检已做**：`rootLineStartPositionKeepSameInCurve` 改回 false 报出 4 项失败；
  临时停用 `removeEngineShortcut` 报出「Ctrl+L 仍注册」1 项失败。
  这类「引擎运行时 DOM 装配」行为单测覆盖不到（单测只能验证数据字段）。
  无 Chrome 时跳过（`--require-chrome` 改为失败；`--keep` 保留临时目录；
  `--log-dir <dir>` 把环境信息、每次 Chrome 尝试的退出码与 stderr、完整 `--dump-dom`
  以及逐场景失败片段写进该目录——CI 靠它归档失败证据；
  `CHROME_PATH` 指定浏览器，路径不存在时自动回落到平台默认安装位置）。
- vitest 配置 `vitest.config.ts`：`obsidian` → `tests/mocks/obsidian.ts` alias（包仅有类型声明，无运行时 JS）。
  coverage 含 `src/**`（排除 `core/i18n`、`core/constants` 纯文案与常量表），vendor 为预打包产物不纳入。
- `tsconfig.json` 同时纳入 `src/` 与 `tests/`；`npm run build` 会先 `tsc -noEmit` 类型检查两者。
- Lint 基线：`eslint-plugin-obsidianmd ^0.4.2`（与官方 eslint-plugin 仓库同版）。其
  `configs.recommended` 自包含（ESLint core + tseslint recommendedTypeChecked +
  全部 obsidianmd 规则 + sdl/import/depend/no-unsanitized 等三方插件 + package.json
  检查），**勿再展开 `tseslint.configs.recommended`**（plugin 重定义冲突）。
  项目自有覆盖：domain 零依赖边界（含「裸说明符」闭包，2026-09-17 加；用 `regex` 而非
  `group: ['*']`——后者按 `allowRelativePaths: true` 匹配，会误伤 `./md-meta` 这类组内相对引用）、
  统一解析入口强制（全部插件代码直调
  getAbstractFileByPath 拦截；豁免清单 = `src/links/links-resolve.ts`（**唯一真实收口点**）
  + `src/links/file-lookup.ts`（**陈旧豁免**，该文件已无此调用，待清理——见审计报告 V18），
  存在性检查特例 eslint-disable 注明理由）、模块依赖矩阵 zone（K51）、
  **官方 7 条依赖禁令**（axios / superagent / got / ofetch / ky / node-fetch / moment；
  2026-09-17 补回——模块边界块用的是 `{ patterns }` 形式，会**替换**而非合并官方那份
  legacy 数组形式的禁令，故必须自带）、`tests/**` 仅关两条 obsidianmd 规则
  （`no-global-this` 与 `rule-custom-message`）、
  system-open 的裸 `require` **未声明 globals**——它能通过只是因为 `isDesktopOnly: true`
  带进了 `globals.node`（**cwd 相关**，见 K43；属待补的 V18）……
  manifest.json 与 LICENSE 显式纳入 lint（官方 recommended 不自动拾取两者：
  validate-manifest 自挂 files 块 + ts parser；validate-license 依赖官方内置未导出的
  plain-text parser，等价实现在 scripts/plain-text-parser.mjs——该实现的唯一有意差异是
  **剥离行尾 `\r`**：官方只按 `\n` 切分，CRLF 检出（`core.autocrlf=true`）下残留的 `\r`
  会让版权行正则 `(.+)$` 匹配失败、规则静默失效，故加固之，勿改回逐字一致）。
- lint 的 cwd 依赖（manifest 读取）与 `no-unsupported-api` 的静默失效路径已上收至
  「关键约定」K43 / K44（工具链行为与其它承重配置同处维护，避免两处副本漂移）。

## 关键约定

条目编号（形如 `[K16]`）是**稳定引用 ID**：一经分配永不复用、不重编号，新增条目追加到所属组末尾；交叉引用统一写「见 K n」。编号只用于导航与引用，条目间无优先级含义。

### 链接、图片与 Markdown 保真

- [K1] 链接/图片引用格式：新增链接与图片**恒写 wikilink**（`[[笔记]]` / `[[附件.pdf]]` / `![[图.png]]`），
  不遵循 Obsidian 的 `Use [[Wikilinks]]` / `New link format` 设置——三类图标方案依赖文档双链走
  `mdWikiLinkpath` 通道（自绘文档页图标）；若改为遵循偏好，md 形态笔记链接会落到引擎 hyperlink
  通道并显示原生链接图标，与既定视觉冲突。**2026-09-15 收敛为「跟随官方偏好 + 默认不变」**：
  官方 `Use \[\[Wikilinks\]\]` 为**开**（官方默认，绝大多数用户）→ 恒写 `[[双链]]`（视觉不变）；
  用户**关掉**该设置时 → 新文档链接写 md 形态 `[显示名](路径.md)`（走 hyperlink 通道、显示原生链接
  图标——这是跟随官方设置的代价，由用户显式选择）。设置经 `vault.getConfig('useMarkdownLinks')`
  读取（**未进官方 d.ts 的内部接口**），读取失败/不存在按官方默认处理；重命名改写同样支持 md 形态
  （`links-tree.mdTargetRenamed`，否则这类链接改名后失效）。`New link format` 的最短路径偏好已天然
  满足（新建链接用 basename），改写时沿用用户原有前缀（见 `renamedWikilink`）。历史依据：审计文档
  `docs/external-audit-2026-09-08.md` §5.2/§7.4（该文档已从工作树移除，需要时用
  `git log --diff-filter=D -- docs/external-audit-2026-09-08.md` 从历史取回）。
- [K2] 渲染层定位：正文保持纯 Markdown；布局/视口/打开偏好存 `data.json`（`viewState`，按文件路径），不写入文件。
- [K3] **行级保真与 `---` 的两种身份**：plain 行的 `mdRaw` 存**未 trim 原文**（`text` 才是 trim 后的显示文本）——缩进代码块（4 空格起）与「行尾两空格 = 硬换行」都是 Markdown 语义，trim 掉即等于改动文件；**列表续行**只保留行尾原文，行首缩进由序列化器按树深度补 `restIndent`（避免双份）。`---`/`-----` 纯短横线行**必须分两种身份**（`md-outline.ts` 的 `isDashLine` 判定）：**空行之后** = 结构分隔线 → 按既定行为整行丢弃；**紧跟非空行之后** = CommonMark 的 **setext H2 下划线 → 保留**（`标题\n---` 是二级标题，丢弃会把标题静默降级为段落）；列表/标题之后的短横线行同样保留为独立分隔线（由序列化器的块分隔补空行）。`=====`（setext H1）一直保留，两条 setext 形态已对齐。
- [K4] 文档嵌入 `![[笔记]]` / `![[笔记.md]]`（目标末段为文档类扩展名 `.md` / `.canvas` / `.base`，或无扩展名）与文档双链**同通道**（`mdWikiLinkpath` + `mdLinkStyle: 'wiki'` + `mdEmbed: true`）：显示同一枚自绘文档页图标，节点文本 = 别名‖去 `.md` 的目标名，悬停/点图标行为与文档双链一致。**管道位是别名**（`![[笔记|300]]` 的 `300` 是别名，**不是**宽 300）——故解析侧**不得**沿用 `tokenizeInline` 已按图片尺寸剥过的 `tok.label`，必须从原始切片 `parseWikilink` 重解（见 `md-outline.ts` 非图片嵌入分支）。非文档类嵌入（`![[报告.pdf]]` / `![[录音.mp3]]`）才走附件通道（回形针）；其管道位官方**无明文**（PDF 用 `#height=` / `#page=`、音频无尺寸语法），故不解释、原文存 `mdEmbedPipe`，编辑节点后原样回写（不再丢参数）。两类都记 `mdEmbed`，`md-serialize.renderHyperlink` 据此补回 `!`（文档通道即 `effectiveDocWikiLink` 结果前加 `!`）。「是否文档」统一走 `domain/wikilink.isDocumentExtension`（md / canvas / base），「是否附件」统一走 `domain/wikilink.wikilinkTargetIsAttachment`——**勿**再手写 `extension === 'md'`（拖入、链接弹窗、插入链接三处曾各写一份，Canvas/Bases 被判成附件）；点击可打开性走 `constants.canOpenInObsidian`，其清单必须含 `base`（漏登记会把指向 base 的链接误判「无法预览」，回归 `tests/constants.test.ts`）。悬停预览与 `Ctrl/Cmd+点击`走**同一分流**（`view-wikilink.nodeLink`），故附件节点与文档节点等价可预览/可打开（此前只读 `mdWikiLinkpath`/`hyperlink`，附件节点两处都是静默无响应）。回归见 `tests/md-roundtrip.test.ts` 的「文档嵌入」6 例（已验证负向对照：把分流改回「非图片＝附件」即 6 例全红）。
- [K5] **`[[]]` / `![[]]` 支持度审计结论（对照官方帮助 + `obsidian.d.ts`，四项决策均为「保持现状」）**：① 笔记嵌入的管道位按**别名**处理（`![[笔记|300]]` 的 `300` 是别名，节点文本即显示 `300`）——官方**无明文**，依据 API `Reference.displayText`（`[[page|display name]] → display name`）口径推断，属**有意取舍**；若官方日后改为尺寸/忽略，整改方向是「管道位原文保留」（同 `mdEmbedPipe`），届时再动。② 空 `[[]]` 保持字面文本（Obsidian 亦不视为链接，官方未记载）。③ 一行多链接只有首个可点/可悬停（引擎单链接槽位；官方阅读视图每枚均可点）——未编辑逐字保真、编辑后降级为单链接，已登记。④ **不采用**官方 `parseLinktext` / `getLinkpath` 替换自研 `parseWikilink`：官方那两个函数只给 `path` / `subpath`、**不给别名**，换过去不减代码且会破 domain 零依赖边界；导航已用官方 `getFirstLinkpathDest` + `openLinkText(inner)`，标题/块子路径交核心处理。
- [K6] 双链节点别名语义（**节点内只显示别名，编辑节点即改别名**）：纯双链节点（整行只有一个双链，节点内显示的就是该链接的可见名＝别名优先）里节点内容等价于别名，故编辑节点后把新文本写成别名回写 `[[目标|新别名]]`（纯判定在 `domain/wiki-display.ts`：`editedWikilinkAlias` + `effectiveDocWikiLink` + `docWikiLinkDisplay`；链接改写走 `domain/wikilink.ts withWikilinkAlias`），不再产出「新文本 + 行尾链接」。边界：① 混合文本节点（`说明 [[链接]]`）不适用——把整段文本当别名会静默吞掉说明文字；② 多行文本不适用（无唯一别名语义，回落旧合成）；③ **附件**嵌入 `![[报告.pdf]]` 不适用（管道位是尺寸参数，不是别名）——但**文档嵌入** `![[笔记]]` 适用（管道位是别名，见 K4）；④ URL / md 链接无别名概念，不适用；⑤ 新别名含 `[` / `]`（用户手输 `[[新目标]]`）→ 不写（Obsidian 不允许方括号出现在 `[[..]]` 内，写进别名位会把整条链接写坏），回落旧合成＝语义上更接近「换链」。新文本与「无别名时的默认显示名」相同（或清空）→ 不写 `|别名` 段（避免 `[[目标|目标]]`），清空文本 = 去别名、链接保留。回写（`renderHyperlink`）与可见名（`nodeLinkDisplay`）必须经同一入口 `effectiveDocWikiLink`，两处口径不一致会让「纯 token 节点」判定失配、合成写出「新文本 + 链接」重复一次。**文档页图标的 tooltip 也走同一入口**（`mindmap.ts` 经 `docWikiLinkDisplay`）——图标 `<title>` 只在节点前缀创建时写一次，若改读解析快照 `mdLinkText`，编辑改别名后 tooltip 会停留在旧别名直到重载；契约已由 `tests/mindmap-wiki-icon.test.ts` 锁定（含负向自检）。注意：`mdLinkText` 存的是**解析时的原显示名**，是「该节点是否被编辑」的判据之一（见 `editedWikilinkAlias` 闸门 4），**不可**在编辑后把它同步成新别名——那会让判据失效、别名回写整条失效。
- [K7] 混排双链拆分（links-split）：节点行内与描述文字混排的双链可抽离为**子节点**（父节点保留描述文字、链接处替换为可见名）。全部规则与产品决策（适用节点/待抽链接/空白处理/幂等/资源地址兜底）定义在 `src/markdown/links-split.ts` 文件头契约，本文件不复述；视图侧执行在 `features/view-split-links.ts`：**批量命令 `mindmap-split-links-all`**（全文，含未编辑存量）与**自动触发**（受设置 `autoSplitMixedLinks` 约束且只处理**被编辑过**的节点，判据 `text !== mdDerivedText`）——单节点手动命令 `mindmap-split-links` 已于 2026-09-14 删除、ID 不复用（单节点场景由自动拆分覆盖）。自动检查的对象是**编辑期捕获的候选集**（引擎 `node_text_edit_change` 带节点、经 `captureAutoSplitCandidate` 累积）——**不是检查时刻的激活节点**：编辑提交后快速切换激活不漏拆；编辑中被检查则保留候选等下次；引擎换代（换文件/重载）整体丢弃。回归见 `tests/view-split-links.test.ts`。
- [K8] 图片自定义尺寸（Obsidian 官方嵌入语法，不落 data.json）：`![[图.png|300]]`（仅宽、等比）/ `![[图.png|300x150]]`（宽高）/ `![alt|300](url)`（外链 md 图，尺寸在标签尾部）。解析进 `mdImageWidth/mdImageHeight`（domain/md-meta 契约）；`walkCorrectImageSizesByAspect` 对带参节点按参数定尺寸（仅宽时探测原始比例补高）；拖拽调宽改 engine `imageSize custom:true`，保存时 rawOk 尺寸特征（`目标|宽度`，终界 `]`/`x` 防前缀误匹配）不符 → 合成回写 `|宽度`。**加载期自动校正的尺寸绝不回写**（`mdImageAutoSize` 标记；`md-serialize.ts customImageSize` 是取尺寸后缀的唯一出口）：它只是显示用尺寸（`imageSize custom:true`），回写会让用户从未动过的行凭空多出 `|宽度`；标记在**用户拖拽调宽 / 插入或更换图片 / 移除图片**三处清除（前两者属用户意图、尺寸照旧回写；移除图片时清标记同时防止「该节点后续新图也不回写」）。
- [K9] 图片独占节点（渲染层语义）：纯图行（`- ![[x.png]]`）解析为**无文本节点**（不回退文件名占位），图片节点删除文字（右键「移除文字」/双击清空）后即被图片独占，往返保持；代价是纯图节点不参与文本搜索。「链接已清除」检测**只排除指向本节点图片的嵌入**（非嵌入语法仍是负向断言 `(?<!!)\[\[`），图文混合行可逐字往返；**文档/附件嵌入按链接形态处理**——字段被清空后一并剥离（`rawHasForeignEmbed`），不再整行回写导致链接复活；但**图片类嵌入不是链接**（按目标扩展名判定，收口在 `constants.isRenderableImageTarget`）：同行多余图片（如 `![[a.png]] 与 ![[b.png]]`）不触发该检测——否则**任何保存**都会把非首图的嵌入语法降级为剥壳文本（2026-09-13 修复，回归见 `tests/md-roundtrip.test.ts` 的「同行两张库内图片」）。**「移除图片」的防复活判定不依赖 md 字段残留**：`removeNodeImage` 会清空 `image` 与全部 md 图片字段，故 `rawOk` 以「`image` 为空 + mdRaw 首行仍含图片语法（`![[…]]` 按扩展名 / `![…](…)`，排除缩进代码块）」剥离——只靠 `hasImageMeta` 会因字段全清而失效、图片在保存后复活（2026-09-13 修复，回归见 `tests/md-roundtrip.test.ts` 的「移除图片」用例组）。
- [K10] 图片/链接对齐 Obsidian：`![[路径]]`/`[[笔记]]` 往返；插入弹窗联想库内文件；悬停预览用 `registerHoverLinkSource` + `hover-link`。合成路径下**外链图片恒写 `![alt|尺寸](url)`**（外链判定先于 `image === mdImageTarget`；`mdImageTarget` 是解析期快照、换图后会过期，地址取当前 `image`）。
- [K11] 中心主题 ⇄ 文件名：编辑根节点文本会重命名 `.mindmap.md`（Obsidian 原生更新链接/反链）；外部改名后视图重载中心随新名。**重命名必须走 `FileManager.renameFile`**（`view-title-renamer.ts`），`Vault.rename` 只改文件系统、不更新库内其他笔记中指向本文件的链接/反链（官方 d.ts 明确要求用前者，核心文件浏览器/内联标题/CLI 均走前者）。
- [K12] **渲染层不修解析层遗留**（渲染/解析解耦）：显示名一律取解析层产物（`domain/wikilink.linkDisplayText` 一族），渲染层**只读不改**。典型遗留：`[[folder/笔记.md#标题]]` 这类带子路径的双链，显示名保留 `.md`（`笔记.md#标题`）——文档双链与文档嵌入**口径一致**，属解析期历史包袱；**勿**在 `mindmap.ts` / `view-*` / 悬停预览里补「剥 `.md`」的 render-time 修正分支（会牵动 rawOk 逐字回写与「纯 token 节点」判定，牵一发动全身）。
- [K13] **节点状态与附件元数据隔离**（新的静态渲染只走视图层）：悬停预览 / 图标 / tooltip 等新的静态渲染手段一律在**视图层**拦截处理（`features/view-wikilink.ts` + `main.ts` 的 `registerHoverLinkSource`、`mindmap.ts` 的前缀渲染钩子），渲染层只**读**解析结果、不回写节点 state；**勿**为此新增或改写 `mdEmbed`——它是「原文带 `!`」的**语法事实位**，读取面仅 `md-serialize`（补 `!` 两处 + 非图片附件的管道位原文一处 `mdEmbedPipe`）与 `wiki-display` 一处排除附件别名，且各自先被 `attachmentUrl` / `mdWikiLinkpath` 闸住；要动这条通道字段（更名 / 拆位）须先评估附件通道副作用，不擅自改。
- [K14] `.mindmap.md` 标记的判定/剥离/拼接一律用 `constants.ts` 的 `hasMindMapMarker` / `stripMindMapStem` / `withMindMapMarker`（勿手写同名正则或 replace）。
- [K45] **frontmatter 写盘取磁盘现值**（防「偶有笔记属性丢失」）：`SavePipeline.save` 在序列化前重读目标文件当前内容，文件头取 `splitFrontmatter(磁盘内容).frontmatter`；只有读不到磁盘内容（读取失败或 `cachedRead` 缺失）才回落到按文件存的加载快照（fail-open，不因读失败丢文件头）。视图打开期间用户在属性面板 / 其它窗格 / 其它设备（同步）改的属性不会被加载时的旧快照覆盖；回写只重写正文，文件头原样回贴。
- [K46] **frontmatter 解析边界（向 Obsidian 属性解析对齐）**：`md-outline.splitFrontmatter` 三条口径——① 空属性块 `---\n---` 也是合法 frontmatter（不得并进正文，否则保存后整块消失）；② 结束围栏取第一个 `---` 行但**跳过 YAML 块标量（`|` / `>`）内部的 `---`**（硬切会截断属性、残余落进正文）；③ 开头 BOM 计入文件头并在序列化时原样带回（不处理会让首个标题降级为段落、首个列表项多出假缩进）。frontmatter 逐字保留换行形态（CRLF 不归一）。回归见 `tests/md-roundtrip.test.ts`（含 CRLF / 空块 / 块标量 / BOM 用例）。
- [K47] **「添加链接」写入语义（决策 R4 修订，2026-09-13）**：**仅「完全空白」节点**（无文字、无任何链接通道、无图片、无行内额外 token〔K49〕——含「移除首图后 extra 孤存」形态，判定见 `hasAnyContent`）→ 覆盖（纯双链化：节点文字覆盖为链接显示名 / 附件名，别名优先）；**其余任何情况 → 链接一律建为子节点**，节点原文字、原链接、行内其它 token（K49）、图片全部不动——行内多 token 尾插保真后，拖入 / 添加链接只是「再挂一个链接」，不得覆盖节点已有内容。弹窗（`performAddLink`）与拖拽（`applyDocWikiLink` / `applyNodeAttachment` / `applyAttachmentLink`）同口径；URL / 协议链接同样建子节点（子节点文本为空、保持「仅图标」，`<url>` 由 hyperlink 通道回写）。**副作用**：一键改链入口取消（改链 = 先「清除链接」再添加，或直接编辑节点文本）。回归见 `tests/view-node-actions.test.ts`。
- [K48] **链接引用定义行整体按纯文本**（参考式 `[label]: destination` / 脚注 `[^id]: 内容`）：这类行是**语法基础设施、不是链接**，但行内 destination 若为裸 URL，会被行内解析的「URL icon-only」通道摘出文本——编辑节点时 URL 被挪到行尾（合成路径），`[label]` 引用全部失效（2026-09-13 规划实测）。故解析侧命中 `md-outline.ts isLinkReferenceDefinition` 即**不提取任何链接字段**（URL 留在文本、节点显示完整定义文本、无链接图标）。判定口径：脚注 `[^id]:` 后内容任意；参考式 `[label]:` 后须是合法 destination（`<…>` 或非空白串，对齐 CommonMark link reference definition），`[X]:` 后无 destination 不豁免。回归见 `tests/md-roundtrip.test.ts`（4 形态 + 2 条不误伤对照）。`[text][ref]` **引用行**本就整体进文本、无需特判；**拆分侧同守卫**（`planSplitLinks` 命中定义行即返回 null——否则 destination 会被抽为子节点、父行退化成 `[ref]:笔记`）；多 token 编辑后保真见 K49。
- [K49] **多 token 回写（台账里的额外 token，`first: false`）**：一行内有多个链接 / 多 URL / 多图时，只有首个（图、链接各一枚）进 `image` / `hyperlink` / `mdWikiLinkpath` 字段；其余 token 在**编辑后合成**时此前会降级或丢失（多 URL 连内容都丢）。现解析侧把未被首字段承载的 token **原文切片**记入台账（收集点：非首个文档/附件嵌入、非首图、非首个双链、非首个 URL、非首个 md 链接），合成路径（`md-serialize.inlineTokens`）在首图/首链之外**按序尾插**——**内容与语法不丢**；**位置**自 2026-09-14 起由同一台账里**有显示名**的项写回**原位**（见 K52），对不上才回落尾插。未编辑时仍走 `mdRaw` 逐字回写，台账不参与。**单一台账（2026-09-14 归并）**：此前额外 token 单存 `mdExtraTokens`、与对齐表 `mdSegments` 两表并存、需在解析/拆分/清除三处人工同步；现合并为 `mdSegments`（`first` 区分「首 token 字段承载」与「额外 token 原文」），三处各只有一处实现。配套：①「清除链接」只清 `link` 类的**额外**段、保留 `image` 类段与首链段（图片嵌入不是链接，见 K9）；② 拆分命令重写父行时按**新行解析结果**整体重建台账（`links-split.parentSegments`——被抽走的不残留，否则下次合成会写回原位或重复追加；未抽出的多枚不丢失）。**尾插不影响后续整理**：行内多 token（含尾插形态）的双链仍可被**拆分**剥离为**子节点链接**（父行保留为纯文本、无链接语法），或经「清除链接」整体降级为**纯文本**——两条通道均覆盖额外 token（拆分见 K7，清除见 `view-node-actions.clearNodeHyperlink`）。回归见 `tests/md-roundtrip.test.ts`（尾插回落组 + 原位组）、`tests/md-inline.test.ts`（台账登记边界 6 例）、`tests/links-split.test.ts`（拆分重建）、`tests/view-node-actions.test.ts`（清除链接过滤 2 例）。

- [K52] **多 token 编辑后「原位」保真（`mdSegments` 对齐表）**：K49 的尾插只是「内容与语法不丢」，编辑过的行里 token 会被挪到行尾。现解析侧把**在显示文本中可见**的 token 登记为对齐表 `mdSegments`（`{kind, text: 剥壳显示名, raw, first}`，见 `domain/md-meta.MdTokenSegment`），合成路径 `composeFirstLineSegmented`（md-serialize）按段序在新文本里定位显示名，命中即把该 token 的**实时渲染形态**（首链/首图取当前别名与尺寸；额外 token 用 `raw`）写回原位置。边界三条：① **无显示名的 token 分两种**——**首枚**不登记（首图 / 首 URL / 非图片附件嵌入：由字段实时渲染 + 尾插，绝不会写出过期原文），**额外枚**登记为 `text: ''`（只保原文、不参与定位，仍尾插）；② 定位失败（显示名被改写 / 已删）→ 该 token 尾插，不做猜测性替换；③ 命中落在**用户手输的链接语法内部**（`[[…]]`/`[text](…)`，`inLinkSyntax` 判据）也回落尾插——否则会写出 `[[新[[目标]]]]` 这类畸形嵌套。配套不变式：`links-split` 重写父行时按**新行解析结果**重建 `mdSegments`（否则被抽走的 token 会凭旧对齐表复活）；「清除链接」过滤 `link` 类额外段（保留首链段与图片类段，见 `view-node-actions.clearNodeHyperlink`）；二次解析后 `text === mdDerivedText` ⇒ 回到逐字回写（不动点）。台账**同时是 K49 的唯一台账**（2026-09-14 归并，见 K49）。回归：`tests/md-roundtrip.test.ts` 的「多 token 原位保真（mdSegments）」8 例 + 尾插回落组。
- [K55] **删除笔记**不改写**链接引用**（2026-09-15，用户实测反馈修订）：`links-tree.updateReferences` 此前在 clear 模式（删除笔记 / 移入 `.trash`）把 `hyperlink` 与 `mdWikiLinkpath` 一并清空，却**不动 `text` 与 `mdSegments`**——于是下一次保存的合成路径里首链「无形态可写」被跳过、显示名留在文本中，**`[[笔记A]]` 被静默降级为纯文本 `笔记A`**（用户实测：文件里两处 `[[笔记A]]` 同时失去语法，而同行其它链接因台账仍在而保留语法，形状即「首个链接降级」）。现改为**链接只改不删**：删除/回收站场景保留未解析链接（与 Obsidian 一致——删笔记不改写别处 `[[链接]]`，同名笔记重建即恢复），**重命名**仍照旧改写（`renamedWikilink`）；`changed` 对「仅链接引用」的树返回 false，不触发无意义保存。**附件例外：整条删除**（2026-09-15 第三轮，用户明确要求「附件不纳入，删除后整个删除，文字也删除」）：删除/回收站时清空 `attachmentUrl` / `attachmentName` / `mdAttachmentLinkpath`，**并去掉 `data.text` 里那段可见名**（只清字段的话，名字会在下次保存的合成里变成普通文本残留），随后 `text !== mdDerivedText` ⇒ 走合成 ⇒ 引用语法与名字一起从行里消失；**删空且无子节点的叶子节点连节点一并摘除**（`pruneNodes`，否则留下空列表项 `- `，重新解析会变成一个 `-` 文本节点）；**带子节点的节点不动**（整条删会连带子树，退化为保留未解析引用）。**内嵌图片 `image` 仍按删除即清除**（节点内媒体，目标缺失会留下坏死图块；插件另有显式「移除图片」流程）。回归：`tests/links-tree.test.ts`（链接保留 / 附件整条删除 / 空叶子摘除 / 表驱动 / rename 三形态匹配 / 两处 E2E：用户原文含两处 `[[笔记A]]` 删除后逐字不变、附件行与纯附件节点删除后引用与文字一并消失）。
- [K56] **交互对齐 Obsidian 官方口径（2026-09-15，批次 1+2）**：以官方帮助库（`obsidian-help-master`，见 K56 附录清单）为唯一依据，把「打开链接 / 悬停预览 / 未解析链接 / 拖放 / 附件嵌入」逐条对齐。① **打开链接的落点**按官方 `User interface / Tabs` 的修饰键表分流：无修饰＝当前标签、`Ctrl/Cmd`＝新标签、`Ctrl/Cmd+Alt`＝新标签组、`Ctrl/Cmd+Alt+Shift`＝新窗口（`view-context.HyperlinkOpenMode` → `view-wikilink.hyperlinkOpenMode` → `view-link-navigator.openHyperlink` → 官方 `openLinkText(..., PaneType)`；`current` 即官方 `false` 的命名）；`Shift`/`Alt` **单独**按下不接管（官方表只在 Source 模式下让 Shift 参与「新标签」，本视图无 Source 模式，节点选择语义交回引擎）——`Ctrl+Alt`/`+Shift` 两档此前**未实现**，本次补齐。**2026-09-17（官方 API 对照审计 · 方案 A）**：修饰键判定改用官方 `Keymap.isModEvent`（与官方表逐条一致；官方对中键返回 'tab'，中键仍走独立 `auxclick` 通道，`node_click` 路径以 `button === 0` 前置判定隔离）；工具栏按钮与丝带提示改用官方 `setTooltip`（不再手写 `title`/`aria-label`）；**同类收尾（同日第二批）**：搜索栏 3 按钮（构建 + 语言刷新）与图片弹窗「选择本地图片」按钮一并迁移——后者走官方 `ButtonComponent.setTooltip`（组件级 API，`@since 1.1.0`）；`node-inline-content` 的截断 `title` 属性与引擎 SVG `<title>` **有意保留**（零运行时依赖 / 导出保真，见 K53⑤）。② **未解析链接**：阅读视图里配色更弱（`is-unresolved`，见 K53 ⑧），且**悬停不预览**（目标文件不存在）；`[[#标题]]` 按当前文件解析。③ **拖入系统文件**（官方 `Drag and drop` / `Attachments`）：**任意文件都可导入**（2026-09-15 取消类型白名单，与 Obsidian 一致——它把文件复制进「附件默认位置」再插链接）入库后按 `wikilinkTargetIsAttachment` 分流挂载（图片首张挂所选节点、其余各占子节点；文档走文档双链；其余走回形针）；**按住 `Ctrl`（Win/Linux）/`Option`（mac）则完全不导入**，改为插入指向原位置的绝对链接 `[文件名](<file:///…>)`（`view-dnd.shouldInsertAbsoluteLink` → `applyExternalLink` → 回写由 `md-serialize.renderHyperlink` 的 scheme 分支写 md 链接；点击经 `openHyperlink` 的 `file://` 分支交系统默认应用 `platform/system-open.openAbsolutePathWithSystemApp`）。绝对路径 ↔ URL 的互逆转换收口在 `domain/url.fileUrlFromAbsolutePath` / `absolutePathFromFileUrl`（盘符 / POSIX / UNC 三形态，空格 `%20`，含未编码 `%` 不抛错）。④ **拖入附件默认写嵌入语法**：可嵌入扩展（PDF + 音频/视频，`isEmbeddableAttachmentExtension`）置 `mdEmbed: true` → 回写 `![[报告.pdf]]`（与 Obsidian 拖放一致），zip/epub 等不可嵌入者写 `[[归档.zip]]`。⑤ **残留差异（有意登记）**：`F2` 在导图视图内用于「编辑节点文本」而非 Obsidian 的「重命名文件」（视图 scope 内吞键，见 `view-hotkeys`）；重命名「自动更新链接」无设置开关（总是自动改写）；链接语法固定 Wikilink（不读用户的 Markdown 链接偏好 / 最短路径偏好）；无 `[[` 自动补全与反向链接面板（导图本身即链接可视化）；**2026-09-15 按本条要求逐项对齐**（原「有意差异」现只剩最后一条）：① **`F2`**——未选中节点时
   **让位**（返回 true，不阻断）→ Obsidian 核心接管＝**重命名当前文件**（官方语义）；选中节点时编辑该节点
   （导图/画布惯例；中心节点被选中时同理，而中心节点文本即文件名，结果与官方 F2 一致）。此前无条件吞键，
   等于在导图视图里用不了官方 F2。② **重命名「自动更新链接」**——新增设置项 `autoUpdateLinks`
   （**默认开启**，与官方「Automatically update internal links」一致）；关闭后重命名不改写链接（变未解析）、
   删除不清理引用与附件（与官方关掉该设置的表现一致）。③ **链接语法**——现跟随官方
   `Use \[\[Wikilinks\]\]` 偏好（详见 K1；官方默认 ⇒ 行为与之前完全相同）。④ **仍存差异（有据）**：
   原文弹窗（`ui/modal-text`）是纯文本框，**输入 `[[` 无候选**——无编辑器集成就做不到官方那样的
   行内补全；替代入口是「添加链接」弹窗的库内文件联想（已具备）。「反向链接 / 出链 / 未链接提及面板」
   **不算差异**：Obsidian 自带的核心面板作用于当前文件，导图视图打开时同样可用，插件不重复实现。**拖入类型白名单已于 2026-09-15 取消**（原登记为「两侧口径不同」的边界）：库内拖入、系统文件导入、链接弹窗联想三处统一走 `wikilinkTargetIsAttachment`（非文档扩展名即附件，无扩展名视为文档）——`[[说明.txt]]` 手写能显示、拖入也同样能挂上；随之删除三份失效白名单（`constants.isLinkAttachmentExtension` / `isImportableExtension` / `isSystemMediaExtension`）与两条失效文案（`common.onlySupportedFiles` / `common.cannotPreview`），并把「不可渲染的库内文件」点击行为统一为**交系统默认应用**（此前只有音视频外跳、其余弹「无法预览」——白名单取消后任意扩展名都可能入库，弹提示等于「链了打不开」）。回归：`tests/view-dnd.test.ts`（PDF 走附件通道 / 笔记走文档通道 / **任意类型走附件通道** / `Ctrl` 绝对链接 / 拿不到原路径不写不提示 / 载荷无文件才提示 `noFilesDropped`）、`tests/url.test.ts`（file URL 往返三形态 + 解码边界）、`tests/view-node-actions.test.ts`（可嵌入 → `mdEmbed`、zip → 无）、`tests/view-wikilink.test.ts`（修饰键矩阵 5 例 + 中键守卫 1 例、未解析不预览）、`tests/node-inline-content.test.ts`（轻标记扩展 / 转义 / 注释 / 未解析标记）、`npm run verify:visual` 的 `syntax` 场景与 `OBSIDIAN_SHIM_SOURCE` 垫片（本页模块图经 `view-wikilink` → `view-link-navigator` 触达 `obsidian` 运行时导出，故 esbuild 加 `alias` 指向最小垫片——**不是** `external`，否则浏览器里留下无法解析的裸导入；垫片自 2026-09-17 起同步导出 `Keymap` 桩（修饰键判定改用官方 API 的具名导入，见本条 ①）。
- [K54] **节点编辑弹窗的两种模式（2026-09-15，用户实测反馈修订）**：编辑框此前一律编辑 `data.text`（**显示文本**）——双链只剩剥壳名、外链（icon-only）连影子都没有，用户既看不到也改不了语法。现按节点类型分流（`view-node-actions.editNodeText`）：① **纯链接节点**（`md-serialize.isPureLinkNode`：整行一个链接/图片、文本即其显示名）→ **别名模式**：编辑 `data.text`，提交经 `setNodeText`（K6 不变）；② **其余富节点** → **原文模式**：编辑**文件里的那一行**（`[[双链]]` / URL / 轻标记全可见可改），预填 `md-serialize.composeNodeContent`（= 下次写盘会写出的内容，与序列化 `nodeLines` 同一实现），**实时预览** `node-inline-content.inlineContentPreview`（**渲染器口径**：URL 显示为地址——与引擎侧 `buildInlineData().text` 的 icon-only 口径**不同**，预览必须用前者，否则用户会以为 URL 又没了），提交经 `markdown/md-line-write.applyRawToNode` **重解析**写回：先清空再回填全部行内字段（链接通道 + 图片通道 + `mdSegments` + `mdImageAutoSize`，清单取自解析侧常量 `md-outline.INLINE_LINK_FIELDS` / `PLAIN_IMAGE_FIELDS`）+ 三个文本字段由解析结果写就 ⇒ `text === mdDerivedText`（**未编辑**）⇒ 保存**逐字写回用户输入**（等价于「改文件再重载」）。多行：首行承载链接语法，续行按纯文本并入（行首按解析侧口径 `trimStart`，缩进由序列化器补）；结构字段（`mdType`/`mdLevel`）不动；取消或未改动不写盘。原文新增/更换图片时：`resolveImagePath` 换资源地址 + `walkCorrectImageSizesByAspect` 异步校正尺寸后补一次渲染。回归：`tests/md-line-write.test.ts`（7 例：整体重建 / 未编辑往返锁 / 多行 / 未闭合语法 / 结构字段）、`tests/view-hotkeys.test.ts`（两模式分流 + 预览口径）。
- [K53] **自绘（富）节点的渲染与编辑入口（方案 B Phase 1）**：含行内链接 / 轻标记 / **超长文本**（见⑦，引擎逐字符换行会对长行二次爆炸）且**无图**的节点由 `features/node-inline-content.ts` 生成 HTML（`a.internal-link[data-href]` / `a.external-link[href]`，与 Obsidian 锚点形态一致），经 `engine/mindmap.ts` 的 `createNodeContent` 钩子注入引擎 `isUseCustomNodeContent` + `customCreateNodeContent`（两键未入 d.cts，`Object.assign` 防腐透传；返回 null 的节点走默认 SVG 文本），点击复用 `view-wikilink` 既有节点内锚点分流（**零改造**）；悬停走**节点级预览**（不按锚点判定，见 K21/回撤说明）。八条边界：① **渲染源随编辑切换**——未编辑读 `mdRaw`，已编辑读 `data.text`（mdRaw 是解析期快照，判据与 rawOk 同源：`text === mdDerivedText`）；② 接管后引擎跳过 text/image/icon/hyperlink/tag/note/**prefix**，故**双链文档页图标在富节点上不再出现**（有意：内联锚点已承担「可点 + 目标名」，对齐阅读视图；三类图标体系仍服务未接管节点），含图节点整体不接管；③ 自绘节点无 `_textData`，引擎编辑框对其**静默 no-op**（`textEdit.show()` 的 `isUseCustomNodeContent()` 守卫）→ 编辑入口统一走 `features/view-node-actions.editNodeText`（默认节点→引擎编辑框、富节点→`ui/modal-text` 弹窗；弹窗**两种模式**——纯链接节点别名、其余原文，见 K54），三处入口（双击 / 右键「编辑文本」/ F2）共用；④ **行内语法的显示层**（2026-09-15 扩至官方完整清单）：轻标记 `**粗**`/`__粗__`、`*斜*`/`_斜_`（下划线式要求两侧非字母数字，`snake_case` 不误判）、`` `码` ``（含双反引号跨度）、`~~删~~`、`==高亮==`、`***粗斜***` 只在渲染期剥成语义元素（`strong`/`em`/`code`/`del`/`mark`）；另有 `%%注释%%` **渲染期整段隐藏**（阅读视图口径）与反斜杠转义 `\*`（消费反斜杠、按字面显示——此前会被误渲染成斜体）。两类**隐藏语法**同样触发接管（转义恒触发；注释仅在**去掉后仍有可见内容**时触发，否则会渲染出一个空节点）；全部单层、不跨行、不嵌套、定界符内首尾须非空白，`data.text` 与文件原文一律保真；**含轻标记的节点同样被接管**（2026-09-15 修订：此前只按「含链接」接管，`**粗**` 在无链接节点里原样显示——用户实测发现），代价与含链接节点同款（编辑入口走弹窗，见③）；⑤ **导出保真**：自绘内容的布局/排版/配色/轻标记样式**全部内联在元素上**（`node-inline-content.ts` 的 `CONTENT_STYLES` / `INTERNAL_LINK_STYLES` / `EXTERNAL_LINK_STYLES` / `MARKUP_STYLES` 为唯一来源，`styles.css` 只留纯屏幕装饰）——引擎导出（vendor `getSvgData`）只注入 `joinCss()`（引擎自身 CSS）与 header/footer 的 cssText，**插件 styles.css 不在导出图里生效**，样式一旦只写在类规则里，导出 PNG 就会掉排版（foreignObject 尺寸仍按屏上测宽固定 → 溢出/错位）；⑥ **锚点级悬停预览**：富节点内每枚锚点各自预览**自己**的目标（节点级 `nodeLink` 取「首链」会与所见错位）——指针直接进入锚点走 `node_mouseenter` 的锚点分支，节点**内部**在锚点间移动不会重新触发引擎事件，故另有画布 `mouseover` 委托补齐；节点非锚点区域悬停不再预览；⑦ **性能收口**（2026-09-14，2026-09-15 修订）：段序列按**原文内容寻址**缓存（`segmentCache`，上限 512 满则整表清空——渲染期缓存，重建成本远低于内存风险；内容寻址天然避免跨导图串味）。**超长文本必须接管并截断展示**（原文 > `MAX_INLINE_CONTENT_CHARS`=2000 → 一并接管，尾部 `…` + `data-truncated` + `title` 提示，显示 ≤2000 字；文件与 `data.text` 一字不动，双击弹窗看/改全文）——**原「超长回落引擎」是陷阱**：引擎 `createTextNode` 的换行是**逐字符**迭代（每加一字重新拼接整行 + 重新测量一次），单行开销**二次增长**，用户实测「白屏 / 卡死后关闭」即由此而来；无头 Chrome 同机实测 20k 字单行：引擎 ≈ **+2.8s**（整轮 1.1s→3.9s）vs 自绘 HTML ≈ **0**。渲染成本由此与文本长度**脱钩**（每节点上界 = 2000 字）。**残留边界**：**含图 + 超长文本**的节点无法接管（图片走引擎图片通道），其长行仍由引擎换行承担——建议把该节点拆短（这类节点在方案 B 前也是同样代价）。⑧ **未解析链接弱化（注入式解析）**：库内锚点在目标**未解析**时加 `is-unresolved` 类 + 弱化配色（`--link-unresolved-color`/`-opacity`，字面量兜底供导出图用）——对齐 Obsidian 阅读视图「指向尚不存在的笔记的链接显示为更弱的颜色」，用户据此知道点击会新建/打不开。解析器由调用方注入（`InlineContentOptions.isResolvedLink`，生产在 `view.ts` 经 `view-link-navigator.isResolvedWikiLinkpath` 注入 `metadataCache.getFirstLinkpathDest`）——`node-inline-content` 必须能在无 Obsidian 运行时的页面里打包（`verify:visual` 直接打包它），故**不得**自己 import Obsidian；解析**每次构建实时求值**，不进段序列缓存（缓存按原文寻址，与库状态无关）。判据：`#区块`/`|别名` 不参与解析，`[[#标题]]` 这类同笔记内区块链接按「当前文件存在即已解析」处理。回归：`tests/node-inline-content.test.ts`（接管判定含「仅轻标记」「未闭合标记」「转义/注释」「超长回落」边界、轻标记扩展与转义/注释段序列、未解析标记 5 例、缓存命中、内联样式契约）、`tests/view-wikilink.test.ts`（锚点级悬停 6 例 + 未解析不预览 + 区块链接按目标解析 + 修饰键矩阵）、`tests/view-hotkeys.test.ts`（富节点分支）、`npm run verify:visual` 的 inline / markup / syntax / paragraph / hugeline 场景 + inline / export / scale 三个探针（foreignObject 装配、离屏测宽同源、合成点击命中锚点、`<strong>`/`<code>`/`<mark>` 渲染、仅轻标记节点也接管且无锚点、`\*转义\*` 消费反斜杠、`%%注释%%` 不进显示、未解析链接带 `is-unresolved`（对照组已解析链接不加标记）、超长节点接管 + 显示 ≤2000 字 + `…` + `data-truncated` + `title`、导出 SVG 内联样式、30 富节点全渲染且离屏测宽元素恒为 1；负向自检：关掉 `isUseCustomNodeContent` 报 7 项、去掉内联样式报 1 项、**解析桩改为恒真报「未解析链接未标记 is-unresolved（实得 0）」1 项、注释分支改为不隐藏报「%%注释%% 未被隐藏」1 项**——后两条用于证明新断言非空转，复查时实测过。**注**：该脚本跑在 `--virtual-time-budget` 下（时钟被虚拟化），**不做耗时断言**——性能基线需在真实时钟环境另设。

### 引擎行为、视口与布局

- [K15] 打开时的默认视口：**100% 缩放 + 整体内容居中**（按渲染内容包围盒居中，不按根节点——根节点居中会让偏心的树偏向一侧；`mindmap.ts centerContentAtFullScale`：先 `setScale(1, 画布中心)` 再按 `draw.rbox()` 包围盒平移；`createMindMap` 传 `fit: false`，引擎首帧后由 `EngineController.restoreOrFitViewport` 在无保存视口时调用）——大图不再被 fit 压到文字不可读，「适应画布」是工具栏/命令的手动动作；有保存视口时优先恢复。回归由 `npm run verify:visual` 的 viewport 探针覆盖。工具栏另有「重置缩放」（`resetZoom` = **以画布中心为锚点回到 100%**，屏幕可见内容保持原位、不居中节点——只 `setScale(1)` 会绕画布原点跳动），**自动整理后走「适应画布」**（`arrangeMindMap` 的 RESET_LAYOUT 延时回调 → `fitMindMap`：性能模式下先 `forceLoadNode` 再 `fit`，按全图包围盒适配）。首帧窗口内的三个坑（陈旧容器几何 / 根节点居中中间态 / 图片回灌改动包围盒）见 K64。
- [K16] **连线样式（偏好 + 布局联动）**：六种布局中**四种为直线**——组织结构图经 `lineStyle: 'straight'`
  生效（引擎为该布局实现三态 `renderLine` 分派：curve 曲线 / direct 直连 / straight 正交折线，
  三态仅对逻辑结构图/思维导图/组织结构图可见效果）；目录组织图/时间轴/鱼骨图**布局类本身即直线
  绘制**（只输出 M/L 路径、不接受 `lineStyle`，登记在 `lineStyleForLayout` 清单里仅作如实声明，
  **勿**误以为「只有组织结构图是直线」）；逻辑结构图/思维导图为圆滑曲线。
  偏好在 `constants.LINE_STYLE_OPTIONS`（auto/curve/direct/straight），解析唯一实现在
  `mindmap-theme.resolveLineStyle`（auto 与坏值回落布局默认）；生效链路＝设置 `defaultLineStyle`
  → 按文件 `viewState.lineStyle` 覆盖 → 工具栏连线下拉 `view.applyLineStyle`
  → `EngineController.setLineStyle` 重算主题配置（`setThemeConfig` 的「仅连线类属性」差异走
  轻量重绘）。**工具栏选项面随布局收窄**：`supportsLineStyleSwitch` 为假的固定直线布局，
  下拉只显示单项「自动」（`lineStyle.auto`，语义＝连线由布局决定）——这是**纯显示收窄**，
  文件里的偏好既不写入也不丢失，切回支持三态的布局后恢复；选项面重建统一走
  `view-toolbar.syncLineStyleOptions`（buildToolbar / applyLayout / onEngineReady 三处调用）。
  **勿**在别处硬编码 `lineStyle` 或各自拼选项。
- [K17] **根节点连线衔接**：主题配置设 `rootLineStartPositionKeepSameInCurve: true`——引擎**默认从节点
  中心起画**，根节点→首层子节点的曲线在节点内部就已偏出、从上/下边缘**斜穿而出**（衔接呈
  「斜戳」观感）；其余层级本就以边缘为起点。开启后根节点与其它层级一致：右缘水平出发再展开。
  回归锁定在 `tests/mindmap-theme.test.ts`。
- [K18] **切换布局后自动整理一次**：`EngineController.setLayout` 末尾调 `arrangeMindMap`（`RESET_LAYOUT`
  清除自由拖拽坐标 + 延时 `fitMindMap`）——否则旧布局下手动拖过的节点会带着 `customLeft/customTop`
  留在新布局里；且引擎 `setLayout` 内部会把视口变换归零，不 fit 画面会停在左上角。故**切换布局后
  的视口恒为「适应画布」状态**（这也是布局切换与「打开时 100% + 内容居中」两套视口语义的分界）。
  回归见 `tests/engine-controller.test.ts`。
- [K19] **默认热键归零**：引擎 `KeyboardNavigation` 插件自带 **Ctrl+L = RESET_LAYOUT**（只重排、
  不含「适应画布」），与「自动整理」命令口径冲突，已在 `createMindMap` 末段经
  `keyCommand.removeShortcut` 移除——自动整理统一走 `mindmap-arrange` 命令（用户自行绑热键，
  绑到 Ctrl+L 时同样以「适应画布」收尾）。回归由 `verify:visual` 的 layout 探针锁定
  （`engineShortcuts` 不得含 `Control+l`，并带"快捷键表非空"前提断言）。
- [K20] **无差异写盘跳过**：`SavePipeline.save` 在 `vault.modify` 前用 `vault.cachedRead` 比对
  **文件当前内容**，一致则跳过写盘（`vault.modify` 即使内容一字未变也会刷新 mtime、惊动元数据
  缓存与同步；典型场景是「自动整理」——只清引擎内部拖拽坐标，Markdown 文本没变）。
  只跳过「要写的正是文件里已有的内容」，绝不吞掉真实差异；`cachedRead` 缺失（测试桩/老运行时）
  或读取抛错时回退为照常写盘（fail-open，绝不因读失败丢写）。回归见 `tests/save-pipeline.test.ts`。
- [K21] 悬停预览（`hover-link`）：`hoverParent` 必须是官方 `HoverParent`——传本视图的 `leaf`（`WorkspaceLeaf` 实现该接口），**勿传裸 HTMLElement**。弹窗上下翻转由核心按 `targetEl` 的矩形决定，而官方 `HoverPopover.position()` 的锚定矩形是**混合取值**：宽高走 `targetEl.offsetWidth/offsetHeight`、位置走 `getBoundingClientRect()`；SVG 节点 group 没有前两个属性（HTMLElement 专有）→ `bottom/right` 为 `NaN` → 官方定位函数「下方放得下就放下方」的分支恒假（预览只出现在上方），上方也放不下时 `top` 被写成 `"NaNpx"`（等于不显示）。故触发前必须调 `view-wikilink.ts ensureOffsetSize(targetEl)` 补上按实时矩形取值的只读几何（`in` 判断，HTMLElement 不覆盖）；指针坐标不参与定位，勿再改写上报的鼠标事件。**触发面**（`view-wikilink.nodeLink`）：只有库内链接触发，三类等价——文档双链/文档嵌入（`mdWikiLinkpath`）、双链附件/嵌入附件/拖入附件（**门控 `attachmentUrl`**：`mdAttachmentLinkpath` 在「移除引用」后会残留，光看它会留下"幽灵引用"；linktext 取原始 linkpath，`attachmentUrl` 可能已被视图层重写成资源地址）、URL 外链**不触发**（核心只服务库内目标，与阅读视图一致）；`event.buttons !== 0`（拖拽节点滑过其它节点 / 框选扫过）同样不触发——引擎只在"被拖的那个节点"上抑制 `node_mouseenter`。**2026-09-16 定稿为「锚点优先 + 节点级兜底」两级触发面**（两次实测反馈的合成结论）：① 指针在某枚锚点上（`node_mouseenter` 的 `event.target` 命中，或画布 `mouseover` 委托命中——节点体→锚点、锚点→锚点的内部移动只有委托能看到）→ 预览**那一枚**（`anchorLinktext` = `resolveAnchorLink` → `wikilinkLinkpath`）；锚点不是库内目标（外链/畸形）时**继续下滑**而不是放弃；② 否则 → 节点级 `nodeLink` 三通道（文档双链/嵌入 → 附件 → hyperlink）。历史教训：只做锚点级会让「悬在节点上」静默无反应（自绘节点普遍接管，几乎全中）；只做节点级则一行多链接只认首链，**首链是外链时行内库内链接（md 链接指向 `.md`）完全无法预览**（用户实测 `[站点](https://…) 与 [文档](笔记D.md)`）。**两条路径都不得加解析预检**（曾用 `isResolvedWikiLinkpath` 预检「未解析不预览」，目标存在性交核心判断；该函数只服务自绘渲染的未解析弱化配色，经 InlineContentOptions 注入，勿接回预览）。`ensureOffsetSize` 与 400ms 去重（按目标元素，跨两条路径共用）保持不变。
- [K22] 右键「编辑文本」：`mindmap.ts startNodeTextEdit` 必须**延后一个宏任务**再 emit `node_dblclick`——菜单项 click 会继续冒泡到 `document.body`，引擎 `body_click`（`isEndNodeTextEditOnClickOuter` 默认 true）会立刻关闭刚打开的编辑框；`isInserting` 传 false。
- [K23] 拖拽换父辅助：引擎落点判定（指针须精确落在目标矩形内）之外，拖拽期间由 `drag-target.ts` 以两类锚点统一按指针距离最近仲裁后外借（引擎每帧重置三态、精确命中时让位）：**节点中心**（均匀圆域 `DRAG_TARGET_RADIUS_PX`，与节点大小无关）→ 外借 `overlapNode`（挂子，`MOVE_NODE_TO`）；**相邻兄弟间隙中点** → 外借 `prevNode`（插到该兄弟之后，`INSERT_AFTER`）。引擎拖拽内部形态（三态/命令）访问收口在 `mindmap.ts` 的 `getDragDropState`/`setDragOverlapTarget`/`setDragPrevTarget`/`getNodeLayoutRect`/`toCanvasPoint`。
- [K24] 新建承载节点（拖入图片/笔记/附件、粘贴、图片子节点）一律走 `view-common.ts insertChildNodeWithData`：统一 `appointNodes=[parent]`（空数组会被引擎静默忽略）与 `isActive:false`，勿再各写一份 `execCommand(INSERT_CHILD_NODE, …)`。
- [K25] 引擎内部形态（`node.group`、导出倍率 `opt`、Search 插件状态、DoExport、
  `renderer.textEdit` 等）的访问只出现在 `mindmap.ts` 防腐收口函数中（`services/engine-controller.ts`
  为同类防腐层），视图层经具名函数使用。
- [K26] 引擎 `execCommand` 的命令名一律引用 `mindmap.ts` 的 `ENGINE_COMMANDS` 常量（勿写字符串字面量，拼错编译期即报错）。
- [K26b] **整树替换必须走 `engine/mindmap.replaceMindMapData`（保留撤销历史），勿直调引擎 `setData`**。两者在 vendor 里的差别（0.14.0-fix.3 实测）：`setData` = `CLEAR_ACTIVE_NODE` → **`command.clearHistory()`** → `addHistory()` → `renderer.setData()`，历史被清成「只剩新状态一条」，此后 `BACK`/`FORWARD` **永远无事发生**（用户实测：「拆分双链后 Ctrl+Z 失效」）；`updateData` = `renderer.setData()` → `render()` → `addHistory()`，只把新状态**追加**为一条历史（快照取自 `renderer.renderTree`），且一次 `Ctrl+Z` 即回到替换前。回归锁定：`tests/view-split-links.test.ts`（批量拆分走该入口）、`tests/engine-controller.test.ts`（引用更新走该入口）、`tests/vendor-contract.test.ts`（`updateData` 必须在引擎原型上、`CLEAR_ACTIVE_NODE` 必须在命令表）。单节点/自动拆分别走引擎命令（`SET_NODE_DATA` + `INSERT_CHILD_NODE`，每条各记一条历史 → 逐步回退），故无需整树替换。
- [K26d] **自绘（富）节点的「拖左右边框改宽」必须由插件收尾**：引擎只对 `isUseCustomNodeContent` 节点给出 `ew-resize` 边框手柄（`checkEnableDragModifyNodeWidth`）——自绘节点都能拖；但引擎**不会把宽度传给自绘内容**：拖拽中每帧只写节点字段 `node.customTextWidth` + `reRender([], { ignoreUpdateCustomTextWidth: true })`（keys 为空 ⇒ `h.custom` 为假 ⇒ **不重建**自绘内容），松手只 `setData({ customTextWidth })` + `render()`（整树 render / `needLayout` 同样不重建，无头实测：内容元素 inline width 仍为空、节点高度不变）。而自绘节点的宽高**全部来自内容元素的离屏测宽**，故必须两处配合：① 自绘内容读 `customTextWidth` 落到元素 `width`/`maxWidth`（`node-inline-content.customTextWidthOf`，口径＝节点框总宽，与引擎给自绘节点的拖拽起点 `node.width` 同尺度，拖动 1:1 不跳变；`maxWidth` 必须同步放开，否则 CONTENT_STYLES 的 500 会把更宽的拖拽钳回 500）；② 松手后**重建**该节点自绘内容（`engine/mindmap.refreshNodeCustomContent`：`node.reRender(['custom'], { ignoreUpdateCustomTextWidth: true })` + `render()`），订阅点 `dragModifyNodeWidthEnd` 在 `features/view-node-width.ts`。缺任一环节即用户实测缺陷「拖宽后节点上下高度不变」（2026-09-16）。**已知引擎边界**：拖拽过程中高度滞后一拍（引擎每帧不重建自绘内容），松手时校正；宽度本身实时跟随。**宽度不落文件**（正文保持纯 Markdown，`customTextWidth` 是引擎数据字段）⇒ 重开文件回落 500 折行上限。回归锁定：`tests/node-inline-content.test.ts`（宽度落元素 + 非法值忽略）、`tests/view-node-width.test.ts`（事件订阅与传参）、`npm run verify:visual` 的 inline 探针（拖宽 500→240 后节点宽 240、元素实测 240、高度变大）。**手柄门禁（2026-09-16 追加）**：引擎的手柄门禁 `checkEnableDragModifyNodeWidth()` 只看**全局开关**（`enableDragModifyNodeWidth && (richText || (isUseCustomNodeContent && customCreateNodeContent))`，本插件恒为真）⇒ **每个节点**都拿到左右边框手柄；但宽度只有自绘节点认（纯文本走 `textAutoWrapWidth` 的 SVG 文本路径，**完全不读 `customTextWidth`**）⇒ 纯文本/含图节点上的手柄是**死手柄**（拖了毫无反应，用户实测）。修法：`view-node-width.gateNodeWidthHandles(node)` 给 Node 原型该方法加一层「且会被自绘接管」（判据与 `buildInlineNodeContent` 同源：`node-inline-content.shouldSelfDrawNode` + `resolveSelfDrawSource`），在**首个内容回调**里安装（回调早于同一节点的 `initDragHandle`；手柄本身又是激活时懒创建，故无漏网），幂等且失败静默（退回旧行为）。**坑**：引擎该方法返回的是 `... && customCreateNodeContent`——**函数本身**（真值非 `true`），包装时只能按真值判断（曾写 `=== true` 导致全节点判成无手柄、拖宽整体失效，无头实测抓到）。回归：`tests/view-node-width.test.ts`（含真值非布尔的桩）、`verify:visual` 的 handle 探针（纯文本节点 0 个 `ew-resize` 手柄、自绘节点 2 个）。
- [K26f] **引擎两种 `getData()` 语义相反，改动前先认准是哪一侧**（vendor 0.14.0-fix.3 实测，契约在 `tests/vendor-contract.test.ts`）：`Node.getData()` = **活引用**（`getData(t){return t?this.nodeData.data[t]:this.nodeData.data}`）——就地改写即改引擎数据，帧内图片尺寸预览与「清标记」（`delete data.mdImageAutoSize`）都靠它，**不可当快照**；`MindMap.getData()`（整树）= **深拷贝**（走 `command.getCopyData()`）——批量拆分「先改树再整树回灌」靠它，改动可安全就地做。两者写错方向都不会报错，只会静默失效（预览不跟手 / 绕过渲染与历史）。
- [K26g] **性能三条硬规则**（2026-09-16 优化轮）：① **缓存淘汰用 LRU，禁止「满了整表清空」**——`node-inline-content` 的段序列缓存曾被编辑弹窗的实时预览（每个键入都是新键）整表刷空，此后每次渲染全部重 tokenize（命中率归零）；改 LRU（命中删后重插 → 队尾；超限淘汰最旧一条）后热点条目在洪水下仍命中（回归：`tests/node-inline-content.test.ts` 的 LRU 用例）。② **同一行原文只解析一次**：`md-outline.flushPlain` 曾对 plain 块首行解析两遍（一遍取显示文本、一遍取图片字段），现复用首行结果。③ **设置变更应用到视图必须防抖**（`SETTINGS_APPLY_DEBOUNCE_MS = 250`）：需要重建的键一轮 = 每个打开的视图**销毁并重建引擎 + 全量重渲染 + 工具栏重建**（2026-09-17 起按键差集分流——主题原地生效、默认布局/默认连线样式跳过，见 K59），而 `LIVE_REFRESH_SETTING_KEYS` 含滑块（性能阈值 step 100）——不防抖拖一次滑块重建几十轮（回归：`tests/settings-persist.test.ts` 的「19 档只应用一次」+ `onunload` 丢弃挂起）。
- [K26h] **引擎图片节点必须有 `imageSize`，任何「先渲染后校正」的路径都要先 `ensureDefaultImageSizes`**（vendor 0.14.0-fix.3 实测）：`createImgNode → getImgShowSize` 直接解构 `data.imageSize`（`let {custom,width,height} = getData('imageSize')`），缺字段即 TypeError、**该节点的渲染链中断**（无头实测：一图缺失 ⇒ 整图 `renderer.root` 为空，对照组在 verify:visual 的 image 探针）。解析器**不产** `imageSize`（`md-outline.PLAIN_IMAGE_FIELDS` 只含 image/mdImage*），旧流程靠「加载期探测在引擎创建前完成」隐式兜底；2026-09-16 起加载路径改为「探测**不**挡首帧」（`collectImageSizeCorrections` 起步于首帧前、`applyImageSizeCorrectionsToEngine` 首帧后按 **data 对象身份 + image 地址**回灌并重渲染一次），以及「把文本节点编辑成图片」（`applyRawNodeContent`）同样属于先渲染后校正——两处都必须先同步填默认值（O(n) 指针遍历，不探测不等加载）。**为什么不能用 uid 回灌**：加载期 uid 尚未分配（`ensureUniqueUids` 在引擎创建时才跑）。回归：`tests/images-path.test.ts`（默认填充幂等）、`tests/engine-image-size.test.ts`（身份/换图/同值/陈旧守卫）、image 探针（渲染尺寸确实随回灌变化）。
- [K26i] **自绘接管面不回收——其成本模型已被探针钉死**（2026-09-17 量化轮）：两棵同形状 31 节点地图实测 ⇒ ① DOM 元素 8.2（引擎文本）vs 7.5（自绘）/节点，**自绘更轻**（接管后引擎跳过 text/image/icon/hyperlink/tag/note/prefix/postfix 全部默认内容）；② **空 render 构建器调用 0 次**——拖动/缩放期间引擎只改 transform，**不重建节点内容**；③ 改一个节点文本 ⇒ **恰好 1 次**构建器调用。故真实成本是「每次内容重建 ≈ 每节点 1 次构建器 + 引擎 1 次离屏测宽」，**按编辑数线性、不按帧**；收窄接管面（纯单链接节点交回引擎 SVG 文本）换不来帧级收益，却要吃图标体系 / 编辑入口 / 锚点契约的用户可见回退 ⇒ **不回收**。剩余的自绘专属开销只有引擎对 custom content 的离屏测宽（vendor 内部，外部不可跳过）。⚠️ 测不到的坑：`--virtual-time-budget` 虚拟化时钟（耗时断言恒无意义），且 `render()` 经 rAF 调度 ⇒ 计数类测量必须等 settle 再读（同步读恒为 0 是**异步假象**——别拿它当「没发生」的证据）。回归锁定：perf 探针断言（idle 构建器 0 / 改文本恰好 1 / DOM 预算）。
- [K26e] **高频拖拽类写入不得逐帧走 `execCommand`**（vendor 0.14.0-fix.3 实测）：引擎 `Command.exec` 末尾是 `if (['BACK','FORWARD','SET_NODE_ACTIVE','CLEAR_ACTIVE_NODE'].includes(cmd)) return; this.addHistory()`，而 `addHistory()`（被 `addHistoryTime` 默认 **100ms 防抖**包装）会 `getCopyData()`（**整树深拷贝**）+ `JSON.stringify` 比对后 `emit('data_change')` ⇒ 逐帧走命令 = ① 拖动被切成多条历史（撤销要按很多次）；② 每次变动都触发视图的 `scheduleSave`（800ms 防抖被反复重启 ⇒ 用户实测「保存好几次」）、状态栏与标题重算；③ 全树深拷贝 + 序列化比对正是「拖动卡顿」的主要开销。修法（图片调宽为例）：**帧内只改数据 + 重绘**（`engine/mindmap.previewNodeImageSize`——与命令本体等价：引擎 `setNodeData` 就是 `Object.keys(e).forEach(k => node.nodeData.data[k] = e[k])`），**收尾一次**走命令（一条历史、一次保存调度，一次 Ctrl+Z 撤回整次拖动）。收尾判据必须是「**与起始值有净变化**」而非「与最后一帧值不同」——最后一帧往往就是最终值，按后者处理整次拖动将完全进不了历史。回归：`tests/feature-teardown.test.ts`（帧内不 execCommand / 收尾恰好一次 / 拖回原尺寸不提交）+ `verify:visual` 的 history 探针（真实引擎：帧内 0 历史 0 data_change、收尾各 1；负向自检可复现旧行为）。
- [K26c] **画布滚轮与中键拖由引擎实现，插件不得再注册同名手势**（vendor 0.14.0-fix.3 实测）：滚轮监听在 `mindMap.el` 上且**先 `stopPropagation()`** → 容器级 wheel 监听收不到事件（重复实现＝死代码）；中键拖走 event 模块 `which===2 → isMiddleMousedown` → `drag` → View 平移，mousemove/mouseup 挂在 `window`（拖出画布仍跟手），插件若另按 pointer 事件平移会与引擎的**绝对定位**平移互相覆盖、且 `pointerleave` 让手势半途断掉。官方 Canvas 语义即引擎默认值 + `createMindMap` 显式钉住：`mousewheelAction: 'move'`（滚轮平移）、`disableMouseWheelZoom: false`（`Ctrl/Cmd+滚轮` 以指针为锚缩放）。插件只做引擎没有的两件事：抑制浏览器原生**中键自动滚动**（容器 `mousedown` button===1 → preventDefault，冒泡晚于引擎 el 上的 mousedown，不干扰引擎中键状态）、`Shift+1`/`Shift+2`（键在 view-hotkeys，实现 `fitToScreen`/`zoomToSelection`）。回归锁定：`tests/view-viewport.test.ts`（只注册一条 mousedown）+ `tests/vendor-contract.test.ts`（引擎必须保住 stopPropagation/Ctrl 缩放/middle-drag 三处形态）+ `tests/view-hotkeys.test.ts`（Shift+1/2 在输入框内让位，避免打 `!`/`@` 触发缩放）。
- [K27] 引擎 vendor 文件不可手工编辑；升级时用官方源码重新打包并替换（流程见 `vendor/BUILD.md`）；
  `styles.css` 只含本插件样式——**不再有 vendor 段**（引擎 dist CSS 全是 Quill 富文本样式，
  本插件不注册 RichText，样式由引擎运行时注入；详见 `vendor/BUILD.md`）。
- [K64] **打开时的首帧视口三坑：陈旧几何 / 中间态跳变 / 图片回灌改动包围盒（2026-09-17，承 K15/K26h）**：
  用户实测三轮才收敛，三条都是「首帧窗口内几何还会变」的不同侧面，修法各自独立，勿合并简化。① **陈旧几何**：
  引擎只在创建与 `resize()` 时把容器矩形缓存进 `elRect`/`width`/`height`（vendor `getElRectInfo`），而首帧之后
  工作区布局 settle、文档模式 `refreshToolbar()` 重建都会改容器尺寸/位置且**不触发 `view.onResize`**——
  `centerContentAtFullScale` 的缩放锚点（`mindMap.width/height`）与 `measureContentBox` 的原点（缓存 `elRect`）
  便同时按旧画布算 ⇒ 打开即偏移、点「适应画布」才拉回（`fit` 基于实时 `rbox()`，故看起来「内容没问题」）。
  现取视口前先 `syncCanvasGeometry`（等价走一遍 `resize()`）且换算一律读**实时容器**（`getLiveCanvasRect`；
  `getCanvasSize` / `getCanvasOrigin` 分别回退缓存 `width/height` 与 `elRect`，保住「容器不可得也先 setScale、
  只跳过平移」的旧契约）。② **中间态跳变**：引擎默认 `initRootNodePosition=[center,center]`，首次布局把
  **根节点**摆在画布中心，而视口原先只在 150ms 兜底定时器里设置 ⇒ 用户先看到「根居中」再跳到「整体居中」。
  现于 **`node_tree_render_end`（引擎布局任务内发出）同帧应用视口**，浏览器不绘制中间态；首帧窗口内给
  `initialViewportRecalcBudget = 2` 次重算（`resize` 触发的再布局、图片回灌都会改根节点位置与包围盒），
  用尽即停手、不抢用户之后的视口。③ **图片回灌后包围盒变化**：探测不挡首帧（K26h）⇒ 真实尺寸稍后落定，
  `scheduleViewportRecenter()`（`VIEWPORT_RECENTER_DELAY_MS=200`，须 > 恢复延迟 150）补一次居中，
  **仅当视口签名仍是打开时自动设置的那个**（已恢复保存视口、或用户已平移/缩放 ⇒ 不打扰）。
  两条配套：**保存视口落界校验** `isContentVisibleInCanvas`（恢复后明确判定不可见 ⇒ 放弃恢复、回退默认居中；
  性能模式与引擎结构不可得 ⇒ `null`＝**fail-open** 保持原状，不误伤合法视口）；`fitMindMap` 同样先同步几何再 fit。
  回归：`tests/viewport.test.ts`（实时容器优先 / `resize` 早于写视口 / 可见性三态）、`tests/engine-controller.test.ts`
  （保存视口被判定不可见则回退居中且不 fit）、`verify:visual` 的 viewport 探针。

### 架构边界与单一来源

- [K28] URL/地址形态判断只允许引用 `domain/url.ts` 的谓词（勿手写 startsWith 前缀链）；防抖/节流/串行队列/有界并发映射一律用 `concurrency.ts` 原语（勿手写 timer/chain 字段；批量异步任务勿用无界 Promise.all，用 `mapWithConcurrency`）；扩展名清单集中在 `constants.ts`（基表派生，勿复制）。
- [K28b] **节点链接的「文件写法」只有一个来源：`md-serialize.renderHyperlink`**（wiki 双链 / 附件嵌入 `![[…]]` / md 链接 `[显示名](…)` / autolink `<url>`）。序列化回写与视图侧「复制链接」共用它——复制到剪贴板必须是**粘回笔记即可用的那一串**，此前直接复制通道原文，md 形态只拿到裸路径（粘回去是纯文本）。另：文件夹拖入的选文件口径统一走 `links-resolve.filesUnderFolder`（库根 `'/'` 特判——直拼 `'//'` 前缀会让整库拖入被当成空文件夹）；跨 await 的批量写入一律按「会话所属引擎」守卫（`view.mindMap !== engine` 即放弃，不能只判 `null`：重建后的新实例 ≠ null）。
- [K29] 库内文件解析只走 `links-resolve.resolvePathToFile` 统一入口（勿自建 getAbstractFileByPath/索引/线性扫描组合）；索引原语在 `links/file-lookup.ts`。全部插件代码由 eslint `no-restricted-syntax` 机械强制（收口点 `links/links-resolve.ts`、`links/file-lookup.ts` 豁免；存在性检查等特例须 disable 并注明理由）；模块依赖矩阵另由 zone 规则强制（见 K51）。
- [K30] vault rename/delete/create 事件只在 `VaultSyncService.attach` 注册一次，插件侧补充处理经 hooks 注入（勿再 registerEvent 第二份订阅）。
- [K31] view-* 模块经 `ViewPluginContext` 访问插件能力（settings 活引用/viewState/statusBar 服务），不接触插件实例与状态栏 DOM；节点/悬停等视图态用模块级 WeakMap 内聚，不加到 `MindMapViewContext`。
- [K32] view-* 模块按需依赖子上下文（R4 上下文瘦身）：只碰 UI 元素的拿 `ViewDomContext`，只碰引擎的拿 `ViewEngineContext`，再与 `Pick<MindMapViewContext, 'lang' | …>` 组合成模块内最窄面（示范：view-search/view-status）；勿默认依赖整个 `MindMapViewContext` 装配面，新成员先落到对应子面。
- [K33] `errors.ts`：`errorMessage` 提取消息；用户可见错误提示统一用 `notifyError(lang, key, error)`
  （勿再手写 Notice 拼接）。
- [K34] i18n 含 `{name}` 占位符的文案用 `tf(lang, key, params)` 格式化（勿手写 .replace 链）。
- [K35] 弹窗 Promise 的 settle 守卫用 `modal-common.createModalSettle`（关闭兜底经官方 `Modal.setCloseCallback` 注册，**勿覆写 `modal.onClose`**）；库内文件输入联想用 `modal-common.VaultFileSuggest`（勿再各写一份 AbstractInputSuggest 子类）。
- [K36] 所有 DOM/事件/定时器监听使用 `this.register*` 助手注册，保证卸载清理；引擎实例事件经 `EventBinder` 记录统一销毁。
- [K37] 命名对照：类名 `MindMapStudioPlugin/MindMapStudioSettings/MindMapStudioSettingTab`（历史上曾以插件旧名 TheMindMap 命名，已随品牌更名统一）。
- [K50] **模块化设计是硬约束（不是可选项）**：写新逻辑前先回答「它属于哪个已有模块」——答不上来才允许新建文件，且新文件必须只承载一个可命名的关注点。四条强制边界：① **单一职责**——禁止把新职责「顺带」追加进已承担职责的文件，新职责要么进对应模块、要么成独立文件；② **分层单向**——依赖方向恒为 `domain → services → features → 根基础设施`（后者可依赖前者，反向禁止；domain 零依赖由 lint 机械强制，见 K28）；③ **收口唯一**——跨模块能力只允许一份实现（收口点清单见 K25 / K28 / K29），复用优先，严禁造第二份；④ **窄接口**——模块间以最窄契约交互（K31 / K32 的 `ViewDomContext` / `ViewEngineContext` 为示范），不得把整块装配面传给只需要一角的模块。超限文件的拆分判定见「文件规模与豁免」，新增特性落层自检见「新增功能检查清单」第 1 步。
- [K51] **模块组与依赖矩阵（机械强制）**：src 按模块组组织（组成员见「代码结构」），依赖只能是矩阵许可集的子集——`domain`（L0 零依赖）← `core`（仅 domain）← `links`（core/domain）← `markdown`（core/links/domain）、`media`（core/links/domain）、`engine`（core/domain）、`platform`（core/links/markdown/domain）、`ui`（core/links/media/domain）、`services`（全部 L1 + domain）、`features`（全部下层）。**组合根（`main.ts`/`commands.ts`/`settings.ts`/`creation.ts`）只能被组合根本身引用**——下层引入口即违约；唯一豁免是**类型引用**（视图上下文契约需要 settings 的类型，编译期擦除无运行时耦合）。强制手段：`eslint.config.mts` 为每组生成 zone 块（`@typescript-eslint/no-restricted-imports` + `allowTypeImports`），违规即 lint 红灯（编辑器即时可见）。组内相对引用（`./x`）不受矩阵限制，但组内不得成环；新增文件先定组再导入，依赖矩阵由 lint 自动校验。

### 交互对齐 Obsidian 官方

- [K38] 交互对齐 Obsidian 官方帮助（`Editing shortcuts` / `Attachments` / `Drag and drop`）：
  - 视图内 `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` = 引擎撤销/重做（属系统级编辑快捷键，
    非命令默认热键，不违反 no-default-hotkeys；引擎自身未绑定，由视图 scope 接管）；
  - 视图内 `F2` = 编辑当前激活节点文本（`features/view-hotkeys.handleEditNodeHotkey`，
    同由视图 scope 接管）：引擎自己也绑了 F2，但其 `onKeydown` 要求事件目标为
    `document.body` 且指针在画布内（`enableShortcutOnlyWhenMouseInSvg` 默认 true），
    点击节点后常不触发；处理器接管后即阻断冒泡（否则引擎的 window 级监听会再
    hide+show 一次，编辑框闪烁），并在输入框/编辑框内让位、正在编辑时忽略——
    本视图内核心 F2「重命名文件」因此不再触发（根节点文本仍同步文件名）；
  - **视图作用域必须自行创建**：`View.scope` 在 Obsidian 1.5.7+ **默认为 null**
    （核心 View 构造函数不赋值；官方文档要求 `this.scope = new Scope(this.app.scope)`，
    核心文件浏览器亦如此），不创建时 `scope?.register(...)` 静默失效、视图内所有
    快捷键全废。故快捷键注册统一走 `view-hotkeys.registerViewHotkeys(view)`——
    它内部 `ensureViewScope` 保证作用域存在，调用方勿再自己传 scope；
  - 剪贴板粘贴图片按核心约定命名 `Pasted image YYYYMMDDHHMMSS`
    （`images-save.buildPastedImageName`；`SaveImageOptions.filename` 显式命名
    优先于 File.name 与 preferredName，仅粘贴路径使用）；
  - 外部拖入图片=导入附件目录并挂到节点（与官方拖入行为一致，保留原文件名）；
  - 命令一律不定义默认热键（用户经 Hotkeys 设置自行分配）；引擎插件自带的 Ctrl+L
    （KeyboardNavigation 的 RESET_LAYOUT）已在 `createMindMap` 末段移除，自动整理统一走
    `mindmap-arrange` 命令。

### Obsidian API 合规与工具链

- [K39] Obsidian API 合规（已对照官方 `obsidian.d.ts` **1.13.2** 与项目安装的 **1.13.1** 双层审计）：
  所用 API 全部为官方面
  （含 `FileSystemAdapter.getBasePath`、`getAvailablePathForAttachment`、
  `getFirstLinkpathDest`、`registerHoverLinkSource`、`SettingDefinitionItem`、
  `Keymap.isModEvent`、`setTooltip` 等），
  零废弃 API 使用。仅存三处**无官方等价**的私有触点，均防御式实现并文档化：
  ① `features/file-creator.ts` file-explorer「新建」菜单注入（官方仅有 file-menu，
  无 fileCreator 公共 API）；② `links/links-resolve.ts` 拖拽兜底 `dragManager`；
  ③ `system-open.ts` 桌面端 `require('electron').shell.openPath`（d.ts 无系统打开 API）。
  勿新增私有 API 触点；官方补齐后优先替换。
- [K40] **版本基线**：`manifest.minAppVersion: 1.13.0`（比较基准）< 安装 typings `1.13.1`（`tsc`/lint
  的真实类型来源）< 官方最新 `1.13.2`（仅参照物）三者自洽。声明式设置的锚点
  （`PluginSettingTab.getSettingDefinitions`、`SettingTab.setControlValue`、
  `SettingDefinitionItem`、`SettingDefinition`）**全部 `@since 1.13.0`**；全插件
  `from 'obsidian'` 的导入面（22 个符号）**没有一处 `@since > 1.13.0`**。故 1.13.0 是
  「恰好覆盖、零盈余」的最小值：**不可下调**（低于 1.13.0 无声明式设置 API），**也不必上调**。
- [K41] **声明式设置的「键」是 lint 盲区（重要）**：`no-unsupported-api` 只访问
  `MemberExpression` / `NewExpression` / 类 `superClass` / `CallExpression`，**对象字面量的键
  永不检查**。若在 `getSettingDefinitions()` 返回的对象里写了比 `minAppVersion` 更新的字段
  （1.13.1：`SettingDefinitionGroup.search`、`SettingDefinitionPage.displayValue` / `.status`、
  `SettingSliderControl.displayFormat`；1.13.2：`SettingSecretControl.type:'secret'`），
  **不会有任何 lint 或 `tsc` 报警**（该成员确实存在于已安装的 typings 里）。因此
  **升 `minAppVersion`、或给声明式设置新增键时，必须人工核对对应 `@since`**，不能指望工具兜底。
- [K42] **`isDesktopOnly` 是承重配置，不是发布元数据**：K5 的负向断言 `(?<!!)\[\[` 属**正则后行断言**（lookbehind），而官方规则 `obsidianmd/regex-lookbehind` **仅在 `isDesktopOnly !== true` 时报告**——其实现为 `options.isDesktopOnly ?? getManifest()?.isDesktopOnly`（`eslint-plugin-obsidianmd/dist/lib/rules/regexLookbehind.js`），`true` 时整个 `Literal` 分支直接不报。即：**这行 lint 通过完全依赖 `manifest.json` 的 `isDesktopOnly: true`**，不是因为它本身合规。改 `isDesktopOnly`、或要加移动端支持之前，**必须先把该正则改写为不带 lookbehind 的等价式**（如 `(^|[^!])\[\[`），否则 ① `npm run lint --max-warnings 0` 立刻失败；② iOS < 16.4（Safari 16.4 才支持 lookbehind）会**真实抛异常**，`md-serialize` 整条保存管线随之失效。
- [K43] **lint 依赖 manifest 且是 cwd 相对的**：`eslint-plugin-obsidianmd` 的 `getManifest()`
  用 `fs.readFileSync("manifest.json")`，**相对 `process.cwd()`**——故必须在**插件根**
  跑 `npm run lint`。cwd 不对（如从仓库根/父目录跑）时 manifest 读成 `null`，会让
  ① `no-nodejs-modules`（`isDesktopOnly` 为 true 时 `off`）、② `regex-lookbehind`
  （仅 `isDesktopOnly !== true` 才 report）、③ `globals.node` 注入 三者**同时翻到
  「非桌面」分支**，产生假告警与假 `no-undef`。即：K42 的 `isDesktopOnly` 豁免下的
  「lint 通过」是 **cwd 相关**的结论，不是无条件事实。
- [K44] **`no-unsupported-api` 的两条静默失效路径**（都不报错，而是规则整条 `return {}`）：
  ① 阈值取 `options.minAppVersion ?? getManifest()?.minAppVersion`，manifest 读不到即关闭
  ——**2026-09-17 已从配置侧封堵**：`eslint.config.mts` 对 `src/**/*.ts` 显式传
  `minAppVersion`（值读自 `manifest.json`，不重复字面量），options 优先于 manifest，
  故本条**不再随 cwd 漂移**（K43 的其余两条耦合——`no-nodejs-modules` 与 `globals.node`
  ——仍依赖 cwd，未封堵）；
  ② 版本信息取自**项目实际安装的 typings**（`findObsidianDtsPath(program)` 在 TS program
  里找 `.../obsidian/obsidian.d.ts`，`@since` 映射缓存于
  `node_modules/.cache/eslint-plugin-obsidianmd/since-map.json`，按 obsidian 包版本为 key）——
  故**lint 的可见版本上沿＝安装的 typings 版本**，既不是插件自带的 obsidian 版本，也不是
  官方最新发布版本。升级/降级 `obsidian` 依赖都会改变这条规则的判定基准（缓存自动重建）。
- [K57] **死代码检查（knip）与导出面基线（2026-09-17 审计，同日常态化）**：`npm run check:dead-code`
  （knip v6，devDependency + `knip.json`；CI 在 lint 后执行）覆盖**未使用文件 / 导出 / 类型**，当前**基线零残留**。
  两条口径：① **「仅测试引用」的导出有意保留**——31 项（`DEFAULT_SETTINGS`、`closeSearchBar`/`searchNext`/`searchPrev`/
  `doSearch`/`updateSearchCount`、`computeResizedSize`、`nodeViewportCenter`/`pickNearestNode`/`gapCenter`、
  `applyImageSizeCorrectionsToTree` 一族等）被 13 个测试文件直接 `import`，是「纯逻辑直测」（检查清单 #4）的测试入口；
  去导出即测试编译失败、且无生产收益（生产侧零跨模块引用已核）——`knip.json` 以 tests 为入口，故此类不产生告警；
  **复核口径**：另以 `vitest: false` + 排除 tests 的对照配置运行可复现该清单，勿机械删除。
  ② **零引用导出/类型一律去除 `export`**（本次已清理 17 个符号去导出 + 1 条死再导出 + 死接口 `TreeNodeLike`，
  `tsc --noUnusedLocals` 同步归零；mock / 垫片删去未引用的 `MarkdownRenderChild`，`plain-text-parser.mjs` 删去未引用的默认导出）——
  新增模块报出零引用导出时按同口径处理（仍内部使用 → 去导出；确无用途 → 删除）。knip 需 Node `^20.19.0 || >=22.12.0`
  （CI 矩阵 22/24 满足；插件本体 `engines: >=18` 不受影响）。

- [K58] **编辑成本基线：引擎整树渲染「无脏值比对」（2026-09-17 量化，`verify:visual` 新增 `edit` 探针）**：
  探针规模 500 节点 / **非性能模式**（全部节点在 DOM）/ DOM 3759 元素，动作走**生产路径** `setNodeText`；
  口径为**时钟无关计数**（CI 跑在 `--virtual-time-budget` 下，耗时不可测）。三条实测结论：
  ① **单次编辑 = 布局落地恰好 1 次**：`setNodeText` = `SET_NODE_DATA`（vendor 实测**只写数据、不渲染**
  ——`setNodeData(t,e){Object.keys(e).forEach(n=>{t.nodeData.data[n]=e[n]})}`）+ 显式 `render()` ⇒ 一次入口、
  一次布局，**编辑路径无冗余渲染**（勿再把它当性能项）。引擎另有「`node.reRender()` 为假即跳过整树 render」
  的局部路径（`setNodeDataRender(t,e,n)`，`n=true` 时跳过、仅补发 `node_tree_render_end`），但文本编辑会改
  节点宽度 ⇒ 必须重排 ⇒ 走整树 render 是当前唯一正确选择（禁用该捷径换取的只是错误布局）。
  ② **内容重建 O(1)**：编辑一个节点只调用 1 次自绘构建器（500 节点规模下依然成立，与 30 节点 perf 探针同结论）。
  ③ **属性写入 O(n) 且几乎全是空写**：空 render 对照（数据一字未改）实测 **2495 条属性变更 = 真变化 0 + 同值空写 2495**；
  真实编辑只在此之上叠加少量真变化（自绘节点编辑 998、纯文本节点编辑 1）⇒ 引擎整树渲染**无条件重写每个节点与
  连线的属性、无脏值比对**，单次编辑的 DOM 写入约 83%~99.96% 是纯浪费。
  **推论与边界**：a) 该浪费位于 vendor 渲染器内部，插件侧**无法直接消除**（`node.reRender` 只重建内容、不替代
  全局布局，而布局必是全局的）；插件能做的只有「不为无谓原因调用 `render()`」（每次 = 2495 次空写）并让
  `render()` 的 `setTimeout(0)` 合并窗口持续生效；b) **性能模式是现成缓解**——视口外节点被摘出 DOM
  （count 探针：151 节点 → DOM 11 组）⇒ 空写只落在可见子集，故 >500 节点（默认阈值）已被保护，
  **100–500 节点区间**才是全量承受者；c) 绝对值仍未知（虚拟时钟测不到 ms）⇒ **后续「局部重绘」类改造的 ROI
  判据是「能否减少 render 次数」，而非让单次 render 更快**；真实耗时需在应用内或不带 `--virtual-time-budget`
  的通道另测。探针自身成本 ≈ +1s 虚拟时间；测量完即 `holder.remove()`，DOM dump 维持 ~343KB（不摘会到 ~992KB）。

- [K59] **设置变更按键差集分流：不再一律重建引擎（2026-09-17，承 K58 量化）**：`applySettingsToViewsNow`
  此前对每个打开的视图一律 `refreshMindMap()`（= 整树 `structuredClone` + 销毁重建引擎 + 全量重渲染 +
  工具栏重建）。现改为：`main.ts` 记「上次已应用快照」→ `settings.diffLiveRefreshKeys(previous, next)`
  算出**真正变化的即时刷新键**（首次应用返回全部键，保守走完整路径）→ 视图 `applySettingsChange(keys)`
  按键路由：① **defaultTheme** → `engine.applyTheme()`（`setThemeConfig` 原地生效，与 css-change 同款）；
  ② **defaultLayout / defaultLineStyle** → **跳过**；③ 其余（enableDrag / language）→ 仍
  `engine.refresh()`（performanceMode / performanceThreshold 同日改为原地切换，见 K60）。**为什么 ② 可以跳过**：会话字段
  `currentLayout`/`currentLineStyle` 在 `loadMindMapFromFile` 就按「文件显式选择 ?? 默认值」定值，
  之后 `resolveLayout/resolveLineStyle` 读的都是会话字段 ⇒ **改默认值对已打开的图本就不生效**
  （重建一轮也不会改变任何渲染），与「默认值只对新打开的文件生效」的产品语义一致——旧路径在这两个键上
  是**纯浪费**。**边界**：默认值变更**不写入** viewState（那是「本文件的显式选择」，仅工具栏切换时写）；
  `changedKeys` 为空集时视图什么都不做；防抖（250ms）保留——滑块档位仍会反复触发应用。
  **主题路径的收益边界（勿夸大）**：`setThemeConfig(themeConfig)` 内部仍会走一次整树 `render()`
  （vendor 实测：`ma(n)` 为真时以空 source 渲染、否则 `CHANGE_THEME`），故省掉的是**整树
  `structuredClone` + 引擎销毁重建**（整套 SVG DOM、插件注册、引擎事件、视口重设、工具栏重建）；
  要连那次重渲染也省掉需要引擎侧支持，插件不改 vendor。回归：`tests/settings.test.ts` 的
  `diffLiveRefreshKeys` 4 例（首应用全集 / 空集 / falsy 边界与无关键 / 并集）。

- [K60] **性能模式运行时切换：`updateConfig` 原地生效，不重建引擎（2026-09-17，承 K59）**：设置面板的
  **性能阈值是唯一的滑块类高频控件**，此前每次应用都重建引擎。引擎**显式支持**运行时切换（vendor
  0.14.0-fix.3 实测）：`updateConfig` 只合并 opt 并派发事件（**自身不渲染**），Renderer 的
  `after_update_config` 分支在 `openPerformance` 变化时**绑定/解绑 `view_data_change` 处理器**并
  `forceLoadNode()`；裁剪本身每次渲染现取活值（`Node.render` 解构 `opt.openPerformance` /
  `opt.performanceConfig` 后按 `checkIsInClient(padding)` 判定，视口外 `removeSelf()`）。唯一不随运行时
  切换生效的是节流窗口 `performanceConfig.time`（`bindEvent` 创建时捕获；只影响视口变化后的重渲染节流，
  不影响正确性）。实现：`engine/mindmap.applyPerformanceMode(mindMap, enabled)` = `updateConfig`，
  **且只在开启方向补一次整树 `render()`**——`forceLoadNode` 自带的那次渲染走「强制加载」分支**不裁剪**，
  实测两个方向不对称：**关闭**方向只 `updateConfig` 即达目标态（DOM 全量，1 次落地）；**开启**方向若不补
  `render()` 会停在「全部节点仍在 DOM」直到下一次视口变化才裁剪（DOM 151→**151**），补一次即立刻收敛到
  裁剪态（DOM 151→**11**，代价 2 次落地，见 render-eco 探针）。阈值判据与创建期同源
  （`core/constants.shouldEnablePerformanceMode`：创建按数据树、运行期按**渲染树**，两口径同构——性能
  模式下渲染树结构仍完整，见 count 探针）；控制器 `applyPerformance` 取渲染树计数并与引擎配置共用
  `PERFORMANCE_CONFIG`（创建与切换不再各写一份）；视图把两个性能键路由到它（**不重建**）。
  回归：`verify:visual` 的 **perf-switch 探针**（151 节点图、创建时关闭：DOM 组数 **151 → 开启 11 →
  关闭 151**，渲染树恒 151）+ `tests/constants.test.ts` 判据 3 例 + `tests/engine-controller.test.ts`
  的 `applyPerformance` 2 例（阈值分支 / 无引擎静默，并断言引擎实例未换）。

- [K61] **渲染经济审计：一次动作至多一次布局落地（2026-09-17，承 K58/K60）**：K58 已证明「一次整树渲染」
  本身按节点数写属性（无脏值比对、无短路），故插件侧唯一能省的就是**别让一个动作产生多次布局落地**——
  引擎 `render()` 有 `setTimeout(0)` 合并窗口 ⇒ **同一任务内的重复入口免费**，跨任务才是真多一轮。
  审计两步：① **静态**：逐个核对插件侧 `mindMap.render()` 调用点（`features/view-node-actions.ts` 的
  「有文本时由 `setNodeText` 内部渲染、无文本才自行重绘」三处 + 异步图片校正 `.then` 里的补渲染 +
  `SET_NODE_HYPERLINK` 后的一次、`services/engine-controller.ts` 首帧一次、`engine/mindmap.ts` 各包装
  函数内部一次）——**未发现跨任务的重复渲染**；② **动态**：`verify:visual` 新增 **render-eco 探针**，
  对 8 条代表性动作（图尺寸写入 / 帧内预览 / 自绘重建 / 整树替换 / 性能模式开与关 / 两条引擎命令 /
  裸 `updateConfig` 对照）逐条数 `node_tree_render_end`，并钉成回归闸门：包装函数恰好 1 次、开启性能模式
  2 次（有意，见 K60）、引擎命令单独调用 ≤1。**审计查出并修掉一处**：`applyPerformanceMode` 曾无条件补
  一次 `render()`，实测在**关闭**方向与 `forceLoadNode` 自带的那次重复（2 次落地、DOM 结果相同）⇒ 现只
  在开启方向补，省掉每次「关闭性能模式」的一整轮全树渲染。

- [K62] **设置按键分流的收敛结论：只剩 `enableDrag` / `language` 两个键重建（2026-09-17，承 K59/K60）**：
  逐键核对「有没有运行时通道」后定为终局，勿再重复试探。① **`enableDrag` 保持重建**：节点拖拽由引擎的
  Drag 插件承担，而插件是**创建期注册**的（`createMindMap` 里 `if (options.enableDrag) addPlugin(Drag)`）；
  引擎侧没有对应开关可切（Drag 的启动只受 `opt.readonly` 拦，`enableFreeDrag` 仅决定拖拽结束行为且是
  opt 活值），运行时要切换只能 `removePlugin(Drag)` / `addPlugin(Drag)`——前者**未入 d.cts**（需再加一处
  防腐透传），且属**插件生命周期操作**（插件在构造期绑定 `node_mousedown`/`mousemove`/`node_mouseup`/`mouseup`，
  是否完整解绑需逐个核对，另有 window 级监听）；收益只是「一个很少切换的布尔设置少重建一轮」，
  **风险/收益不划算**。② **`language` 保持重建**：d.cts 无 `lang` 选项，语言在创建期被**闭包捕获**两处
  ——`defaultInsertSecondLevelNodeText` / `defaultInsertBelowSecondLevelNodeText`（引擎新建节点时的默认文案）
  与自绘钩子的 `lang` 实参（超长截断提示等）；不重建则二者与新语言不一致。UI 侧文案另有
  `refreshLanguageUi()` + `refreshToolbar()` 全量刷新。
  **终局路由表**（`features/view.applySettingsChange`）：**原地** = `defaultTheme`（`setThemeConfig`）、
  `performanceMode` / `performanceThreshold`（`updateConfig`，K60）、`defaultLayout` / `defaultLineStyle`
  （对已打开的图本就不生效，跳过，K59）；**重建** = `enableDrag` / `language`。

- [K63] **真实墙钟通道（`--perf`）与「整树渲染 ≲0.6ms」的结论（2026-09-17，承 K58/K61）**：页内计时在
  `--virtual-time-budget` 下不可用（`Date`/`performance` 被虚拟化），但**进程墙钟差**可用——虚拟时间只在
  **空闲**时瞬时推进，而布局与 DOM 写入消耗的是真实 CPU ⇒ 同一页跑「空跑 / 负载」两种入口，两次
  Chrome 调用的墙钟差 ≈ 负载的真实成本（口径同 release notes 的「同页 1.1s → 3.9s」）。实现：
  `npm run verify:visual -- --perf [--perf-edits N]`（默认 300，opt-in，CI 不受影响；默认值自 K66 起由 100 上调）：负载块
  （`buildEntrySource({ workloadEdits })` 注入的 `perf-load-probe`）在 500 节点 / 非性能模式 / DOM 3759
  元素图上做 N 次 `setNodeText`（每次恰好一次整树渲染，见 edit / render-eco 探针），空跑 = 同页同图但不编辑；
  **打包与写盘移出计时窗口**（否则 esbuild 的百毫秒级耗时会算进差值），A/B/B/A 交替各取**最小值**——
  单次 A→B 实测出过 **−233ms** 的负差值（第二次运行因 profile / 文件缓存而更快），交替取最小可抵掉这类
  单调漂移。**实测**：100 次编辑 ≈ **58ms**、300 次 ≈ **89ms** ⇒ 每次整树渲染 **≲0.6ms，且与运行间噪声
  （±100ms）同量级**；即 K58 量到的「每节点数条同值空写」在绝对时间上**可忽略**。该口径**不含**历史快照
  （编辑间隔未越历史防抖 ⇒ 连打被并成一条）；含历史后（K65 的 150ms 间隔、默认 300 次）实测 ≈ **13.1s**
  ⇒ **43.6ms/次** = 渲染 ≲0.6ms + `addHistory` 的整树深拷贝与 JSON 比对（见 K65）。
  **结论**：引擎侧属性重写再优化（局部重绘等）ROI 很低；插件侧「不产生多余渲染」（K60/K61）已是正确收尾。
  要更紧的界需要应用内专用计时通道（当前口径只能给上界）。
- [K65] **长会话内存基线：唯一的大头是引擎命令历史快照，上限确实生效（2026-09-17，承 K58/K63；`--perf` 的内存轮）**：
  `--perf` 的负载块在**强制 GC 后**采样堆 / DOM / 命令历史 / 段缓存。两个前置：① 内存轮给 Chrome 加
  `--js-flags=--expose-gc` + `--enable-precise-memory-info`（不回收的堆读数是「分配水位」，看不出泄漏）；
  ② **编辑间隔取 150ms**（> 引擎 `addHistoryTime` 的 100ms 防抖）——否则虚拟时钟下 100 次连打被并成
  **一条**历史（实测「编辑后：历史 1」），历史与内存增长读数全部失去意义；间隔靠虚拟时间等待，不污染
  墙钟，代价是虚拟预算要随编辑数放大（`budgetMs`）。**实测（500 节点 / 非性能模式 / DOM 3759 元素）**：
  ① **历史是唯一大头**：每条快照 ≈ **91KB 字符串**（堆内 ≈ 183KB/条）⇒ 100 次编辑 +18.3MB；520 次编辑
  到**上限 500 条**时堆 **106.3MB（+91MB）**，即「单视图最坏水位 ≈ 上限 × 每条字节」——旧两档策略
  （<2000 节点 500 条 / ≥2000 节点 100 条）里 500 节点图（≈91MB）反而重于 2000 节点图（≈70MB）；
  上限现已改为按 30MB 预算反推，见 K66。② **单次编辑真实成本 ≈ 43ms**，而渲染
  只占 ~0.5ms ⇒ 编辑手感的大头在 `addHistory` 的**整树深拷贝 + JSON 比对**，不在渲染——进一步支持
  K63「渲染侧优化到此为止」的结论（要找手感收益，得从历史/快照下手，且那在 vendor 内部）。
  ③ **无结构泄漏**：`g.smm-node` 增量 0、离屏测量元素恒 1、段缓存 ≤512（LRU 有界）；DOM 的少量增量
  可**完整归因**于「负载用引擎级 `setNodeText`（不同步行内字段）⇒ 富节点判为非接管、切回引擎 SVG
  渲染（div −1 与 g/path/rect/text/tspan 各 +1）」，生产走原文写回不发生（见 K54）。
  硬断言（测量元素 ≤1 / 历史条数 ≤ 上限 / 段缓存 size ≤ max；K66 起另有「上限 = 预算反推值 / 满仓精确
  裁剪 / 快照堆 ≤ 预算」三条）只随 `--perf` 跑，CI 不受影响；默认编辑数自 K66 起为 300。
- [K66] **命令历史上限改为按 30MB/视图的预算反推，撤销深度随图规模收敛（2026-09-17，承 K65）**：
  旧策略按节点数分档（`HISTORY_LIMIT_NODE_COUNT` / `HISTORY_LIMIT_MAX_COUNT`）在档内仍是最坏水位的
  「上限 × 每条字节」，且档位边界有跳变。现 `engine/mindmap` 导出 `resolveHistoryLimit(nodeCount)`：
  `floor(HISTORY_BUDGET_BYTES / (节点数 × HISTORY_SNAPSHOT_BYTES_PER_NODE))`，再 clamp 到 **[30, 500]**
  （下限＝可用性保底「连改两下还有得撤」；上限＝引擎默认 `maxHistoryCount`，**只降不升**——等于默认值时
  不动 `opt`）。实测对照：**500 节点 ⇒ 163 条（91MB→30MB）**、**2000 节点 ⇒ 40 条（70MB→30MB）**、
  ≥2731 节点落入地板 30 条（地板区不再被预算封顶——完全封顶需引擎只存 diff，属 vendor 内部）。
  384B/节点 由 K65 实测（500 节点 ≈182KB 堆/条 ⇒ 373B）上取整，给 vendor 快照字段漂移留余量，真膨胀
  由预算断言兜底报警。**断言升级**（`--perf` 内存轮 `checkLongSessionMemory`；默认编辑数 100 → **300**
  以使 500 节点图满仓）：① `historyCap === resolveHistoryLimit(节点数)`（预算确实应用，而非引擎默认
  500）；② 编辑数 > 上限 ⇒ `historyCount === 上限`（满仓逐条裁剪，不多不少）；③ 此时快照堆 ≈
  `historyBytes × 2`（UTF-16 确定性换算，无平台噪声）≤ 预算。回归：`tests/engine-history-limit.test.ts`
  （预算兑现 / 单调不增 / 边界与地板 / 实测对照值 163 与 40）。
- [K67] **「自动整理」的渲染窗口竞态：RESET_LAYOUT 落在 root 暂缺的异步布局窗口内必抛错（2026-09-17，用户实测；承 K26h）**：
  实测 `自动整理失败 TypeError: Cannot set properties of null (setting 'customLeft')`，栈为
  `Renderer.resetLayout → 树遍历 → 回调首行`。根因是三段拼合：① `Renderer.render` 把 `_render` 排进
  `setTimeout(0)`（合并连续请求）；② `_render` **先 `this.root = null`**，再由 `layout.doLayout(cb)` 回填，
  而布局 `doLayout` 经分片执行器逐步跑（每步之间 `setTimeout(0)`，见 vendor 的 `It`）⇒ root 缺失**跨越
  多个宏任务**；③ `resetLayout` 遍历前**不校验 root**（同层 `expandToLevel` 有 `this.renderTree &&` 守卫、
  `forceLoadNode` 有 `t &&` 守卫，唯它没有）⇒ 窗口期内遍历把 null 交给回调，首行赋值即抛。**大图
  （性能模式 / 数百节点）单次渲染跨的宏任务更多、窗口更宽**，越容易撞上；与 K26h「渲染链中断 ⇒
  `renderer.root` 恒空」是同一根因的两种时长（瞬时 vs 永久），本条目只管瞬时态。修法（插件侧；
  vendor 不可手工编辑，见 K27 / `vendor/BUILD.md`）：`engine/mindmap.arrangeMindMap` 先查
  `getRenderRoot`，缺失则按 `RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS` 轮询等回填，上限
  `RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS`（超限只记日志、不抛）；回填后仍走原「RESET_LAYOUT → 80ms 后
  fit」路径。回归：`tests/viewport.test.ts`（窗口期延后执行 / 上限放弃两条）。

## 新增功能检查清单

按以下顺序自检（先官方 API，再自研；先收口，再实现）：

1. **落层与模块粒度**：纯逻辑（无 obsidian / 引擎依赖）→ `domain/`；通用机制与共享词汇（常量/文案/错误/并发/事件/持久化/黏合类型）→ `core/`；链接与文件解析 → `links/`；Markdown 解析/序列化/打开/拆分 → `markdown/`；图片与附件 → `media/`；引擎封装与主题 → `engine/`；Obsidian 平台集成 → `platform/`；弹窗 → `ui/`；视图服务 → `services/`；UI 特性与视图控制器 → `features/`；入口与装配 → 组合根（`main.ts`/`commands.ts`/`settings.ts`/`creation.ts`）。新逻辑优先并入最贴近的已有模块；跨组复用先查许可集与已有收口点，勿造第二份；确需新建文件时按模块化四边界自检（单一职责 / 分层单向 / 收口唯一 / 窄接口，见 K50），依赖矩阵由 eslint zone 强制（见 K51）。
2. **收口**：是否触碰引擎内部形态？只允许经 `mindmap.ts` / `services/engine-controller.ts` 具名函数；库内文件解析走 `links-resolve.resolvePathToFile`；并发原语走 `concurrency.ts`；DOM/事件监听走 `this.register*` / `EventBinder`；URL 形态判断走 `domain/url.ts`（背景见 K25 / K28 / K29）。
3. **官方优先**：面向 Obsidian 的能力先对照官方 `obsidian.d.ts` 与帮助文档；官方缺口才允许私有触点，且必须防御式实现并在本文件登记（见 K39）。
4. **测试**：新增 `tests/*.test.ts`（纯逻辑直测；引擎运行时 DOM 装配类行为交 `verify:visual`）；同步本文件「代码结构」两份清单——`agents-md-sync` 测试会强制。
5. **校验链**（顺序执行，全绿才提交）：`npm run build`（tsc 检查 src+tests）→ `npm test` → `npm run lint`（须在插件根 cwd，见 K43）→ `npm run lint:css`（改过 `styles.css` 必跑，见「测试与 CI」的 CSS 检查段）→ `npm run check:release`（改过 `manifest.json` / `versions.json` / README 时必跑）→ 新增/删除导出或文件时加 `npm run check:dead-code`（见 K57）→ 涉及渲染/DOM 装配时加 `npm run verify:visual`。
6. **超限登记**：新增文件超 300 行 → 在「文件规模与豁免」表登记理由。
7. **声明式设置/版本**：改 `minAppVersion` 或给声明式设置新增键 → 人工核对对应 `@since`（lint 盲区，见 K41）。

## AGENTS.md 维护规则（本文件）

- **同步义务**：新增/删除/重命名 `src/**/*.ts`、`tests/**/*.ts` 文件时，必须同步「代码结构」两份清单——`tests/agents-md-sync.test.ts` 会强制（漏登记即红灯）。
- **编号规则**：K 编号一经分配**永不复用、不重编号**（删除条目时编号留空；新增条目追加到所属组末尾）；交叉引用一律写「见 K n」，勿用「见下条」这类相对指代。
- **写法约定**：条目结论先行（一句可独立理解的话打头），再展开依据与边界；跨文件规则留在本文件，**文件级实现细节写进源码文件头契约**（范例：`src/markdown/links-split.ts`），本文件只留指针。
- **去重**：同一事实只在最权威的一处展开，其余位置改为「见 K n」引用（反面教材：`isDesktopOnly` 的复述曾散落两处）。
- **事实陈述**：涉及官方行为 / 工具链行为的断言写明依据（官方 d.ts 版本、帮助文档路径、规则实现文件、负向自检结果），便于日后复核与失效检测。

## 发布流程

1. 更新 `manifest.json` 版本号 → `npm version patch|minor|major`（同步 `versions.json`）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`（`.github/workflows/release.yml` 自动构建并创建草稿 Release）。
4. 新增版本补 `docs/release-notes-<tag>.md`（中英双语）——`release.yml` 取该文件作 Release 说明，缺失则回退自动生成。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
  **该 `true` 是承重的**（豁免了 `md-serialize.ts` 的 lookbehind 正则，见 K42）——改动前必读该条目。
