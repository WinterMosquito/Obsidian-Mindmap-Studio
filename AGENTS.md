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
    export-css-vars.ts # 导出 SVG 的 Obsidian CSS 变量注入（K99）：取宿主实际生效值以
                    #   <style> 注入克隆 SVG 根——修复「导出环境变量缺失 → 字体回退
                    #   → 度量漂移 → foreignObject 固定高度裁切」（多行节点/LaTeX 节点）
    export-foreign-object-padding.ts # 导出 SVG 的 foreignObject 几何余量（K106）：宽 +12/高 +20——
                    #   兜底 `<img>` 解码环境与主文档的 ~2px 文本度量偏差（临界节点换行被裁）
    math-jax.ts     #   行内数学渲染（官方 loadMathJax 通道；**实机 1.13.7 的 MathJax 3.2.2
                    #   仅有 tex2chtml**，见 K85）；**就绪判据＝mjx-c 宽全 > 0（零宽而
                    #   ::before content 为空串的不可见操作符豁免，见 K90 ①）+ 自驱官方
                    #   flush（按批合并、完成后放行重试）**：未就绪同步撤回字面、塌缩产物
                    #   不入缓存（见 K87）；占位即回退 + API 面缺失告警一次 + 未挂载入队补
                    #   替换（K85 ②）；产物缓存/定稿回调（K86）；注入 node-inline-content）
  ui/               # L2 弹窗
   modal-common.ts / modal-image.ts / modal-link.ts / modal-name.ts / modal-text.ts
                    # 链接/图片/命名/节点文本弹窗（官方 AbstractInputSuggest 联想；settle 守卫与
                    #   VaultFileSuggest 联想类收口在 modal-common.ts）；modal-text 是
                    #   自绘（富）节点的**备选**文本编辑入口（2026-09-28 起主入口＝
                    #   node-inline-editor 内联编辑器，见 K92）——引擎编辑框对其静默
                    #   no-op（textEdit.show 的 isUseCustomNodeContent 守卫），故由插件兜底
  services/         # L2 视图服务
    document-service.ts # md 文档读取解析 + 保存管线（防抖/串行排空/卸载快照兜底，onSaveError 上报；
                        #   写盘前 cachedRead 比对，内容一致跳过 modify）；
                        #   解析只做图片地址解析，不做尺寸归一（视图走 aspect 校正）；写盘归属：树快照与 frontmatter 按**该次写盘的文件**取（getSnapshotFor/getFrontmatterFor），不同文件不并入同一批次——core 不 await onUnloadFile，换文件期间的排空必须同源
    engine-controller.ts# 引擎实例生命周期 + 防腐收口（renderer 内部不外泄）；
                        #   导出 SVG 后处理链经 deps.exportSvgTransforms 由组合根注入（K51）
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
                    #   经 engine 的 createNodeContent 钩子注入，含行内链接 / 轻标记 /
                    #   **围栏代码块**（块级轻量渲染 + 复制按钮，见 K91）/ 超长文本且无图的节点被
                    #   完全接管（其余返回 null 回落引擎 SVG 文本）；点击/悬停复用
                    #   view-wikilink 既有锚点分流（零改造）。边界见文件头契约：
                    #   自绘节点无 `_textData`，引擎编辑框有 isUseCustomNodeContent
                    #   守卫 → 双击静默 no-op；由 view-node-actions.setupNodeTextEditFallback
                    #   订阅 node_dblclick 兜底转内联编辑器（K92）
    node-codeblock.ts # 代码块复制交互（视图层）：复制按钮（屏上恒显，外观全内联、
                    #   不依赖 styles.css）的点击语义——经引擎 node_click 委托命中
                    #   选择器（与 view-wikilink 锚点同款模式，view.ts 同段注册）；
                    #   写剪贴板 + ✓ 反馈；导出图隐身为 hideCopyButtonsInExportSvg；
                    #   DOM 结构构建留在 node-inline-content.buildCodeBlockElement
    node-inline-editor.ts # 节点内联编辑（自绘/富节点的**原文**编辑器，2026-09-28，见 K92）：
                    #   覆盖层 textarea 编辑文件里那一行（mdRaw 语义），提交走
                    #   applyRawToNode（与弹窗原文模式同一写回入口）；双击 / F2 /
                    #   右键「编辑文本」共用入口；弹窗（ui/modal-text）收编为备选入口；
                    #   isAnyNodeEditing 为统一编辑态判据（热键/自动拆分/标题重命名让位）
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
  md-roundtrip-property.test.ts # 往返生成式验证（fast-check：P1 不动点 T∘T=T / P2 canonical 行守恒——与 docs §3.6 白名单一一对应 / P3 不抛错 / P4 自建语料 fixtures/roundtrip/*.md + CRLF 程序生成 + 变异冒烟；生成空间按 §3.6 #10 收窄）
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
                        #   锚点属性契约（internal-link[data-href] / external-link[href]）、
                        #   代码块（block 标记/信息行剥离/缩进保真/复制按钮结构，见 K91）
  node-codeblock.test.ts # 代码块复制目标解析（resolveCodeCopyTarget 四态：命中/
                        #   非按钮/非元素/按钮在而 code 缺失）
  node-inline-editor.test.ts # 节点内联编辑器（features/node-inline-editor，见 K92）：
                        #   按键判定表（Enter/Mod+Enter/Tab/Esc 提交、Shift+Enter 换行、
                        #   Alt+Enter 让位）、会话生命周期（打开/有改动才写回/未改动
                        #   不写盘/点击外部与 mousewheel 提交/closeInlineEditor 幂等/
                        #   引擎重建守卫/重复打开先提交）、isAnyNodeEditing 统一判据
  math-jax.test.ts     # 行内数学渲染（platform/math-jax）：实机通道优先级（tex2chtml→tex2svg）、
                       #   **就绪判据（mjx-c 宽全 > 0）/ 未就绪同步撤回 / flush 合并与放行
                       #   重试 / 预算耗尽保留字面 + 告警 / 容器盒回退判定**（见 K87）；
                       #   API 面缺失告警一次 / 抛错不上抛 / 未连接入队补替换 / 字体等待与拒绝
                       #   不阻塞；P4 面：塌缩不入缓存、定稿回调恰好一次（见 K86）
  viewport.test.ts     # 视口几何（resetZoom 画布中心锚点 / 内容包围盒居中 / 自动整理后重置缩放）；
                       #   自动整理的渲染窗口守卫（root 暂缺延后执行 / 超上限放弃，K67）
  open-as-restore.test.ts # 「以思维导图打开」偏好恢复（多档延时/代际）
  engine-refresh-nodes.test.ts # 批量自绘重建（refreshNodesCustomContent，P4 尺寸同步）：
                       #   逐节点 reRender(['custom']) + **恰好一次**全树 render；空态 no-op；
                       #   单节点抛错不中断其它节点（见 K86）
  pasted-name.test.ts  # 剪贴板图片命名（Pasted image YYYYMMDDHHMMSS）
  vendor-contract.test.ts # 引擎 vendor 契约（导出面/命令名/事件名令牌）
  view-node-actions.test.ts # 节点操作编排（链接通道分流/删除兜底/剪贴板/自兜错误）
  view-split-links.test.ts # 混排双链自动拆分（候选捕获：设置关/未编辑/编辑中 no-op；候选集检查、编辑中保留、引擎换代丢弃）
  view-context-menu.test.ts # 右键菜单条目分流（链接双通道/图片/文字，画布菜单）
  view-dnd.test.ts     # 拖入分发（图片/笔记/附件/外部导入、两分支与提示）
  view-search.test.ts  # 搜索栏（装配/防抖/回绕/零命中计数/防抖窗口内跳转）
  view-status.test.ts  # 状态栏计数（节流与尾随、销毁/抛错降级、关闭清理）
  view-toolbar.test.ts # 工具栏装配（分组/图标/命令接线、布局与连线样式选择器（固定布局收窄为单项）、自动整理分支、重建）
  view-paste.test.ts   # 粘贴分发（容器监听与窗口兜底两入口、三道豁免（已消费/容器内/输入框）、
                       #   图片识别与接管、命名约定保存（覆盖系统临时名）、无节点提示、
                       #   保存 null 与「保存期间引擎换代」守卫、失败转用户提示）
  view-export.test.ts  # PNG 导出（结果三态分流：Blob → 延迟回收对象 URL / data URL 直下 /
                       #   null 不下载；倍率与文件名（basename，缺省 mindmap）透传；失败转提示）
  export-fo-padding.test.ts # 导出 foreignObject 几何余量（K106：全 FO 宽 +12/高 +20、原样返回、
                       #   非法尺寸跳过、无 FO / 形态不符 no-op）
  math-jax-export-pin.test.ts # 导出数学容器高度钉扎（K107：数量一致时逐钉 height（画布缩放归一 /
                       #   2 位小数 / !important）、域优先与全文退回、数量不符与形态不符 no-op、单元素不可测跳过）
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
  engine-upstream-patch-proposal.md # 引擎上游补丁建议（打开大图瓶颈：逐字符文本测量；实测数据 + 根因 + 补丁方案，见 K72）
  release-notes-<tag>.md        # 各版本发布说明（中英双语；release.yml 按 tag 取用，缺失回退自动生成）
```

### 文件规模与豁免（超限须登记）

官方社区模板建议单文件控制在 200–300 行。本项目**不做机械拆分**——按「拆分会不会把已有收口职责摊开」判定，而不是按行数判定：行数是症状，收口点被拆散才是病。故引入一条硬规则：

> **超过 300 行的源文件必须在下方表格登记豁免理由；未登记者一律视为待偿还债务。**

（豁免是「已知并接受」，不是「没看见」。债务指标：**未登记的超限文件数，只允许递减**。）

| 文件 | 行数 | 豁免理由 |
|---|---|---|
| `src/engine/mindmap.ts` | 1878 | 引擎防腐层**唯一收口点**：vendor 内部形态（`node.group`、`renderer.*`、DoExport、Search 插件状态…）只允许在此出现。拆开等于把私有访问面摊到多个文件，耦合面反而变大——**这一条是必须豁免的，拆分即违约** |
| `src/markdown/md-serialize.ts` | 893 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。（链接「生效显示名」的纯判定已下沉 `domain/wiki-display.ts` 供 `mindmap.ts` 复用——那是**跨模块复用**，不是本文件内聚被拆） |
| `src/markdown/md-outline.ts` | 1024 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则，拆开会让两侧规则漂移 |
| `src/core/i18n.ts` | 504 | 纯词条表（无逻辑分支），拆分只增加 import 噪音，无内聚收益 |
| `src/features/view.ts` | 996 | 视图 Controller：**第 6 步拆分后的纯编排壳**（见文件头契约）。只做「生命周期事件 → 装配 services 与 view-* 交互特性」；业务已全部外置（DocumentService/EngineController/TitleRenamer/openHyperlink…）。再拆会把「生命周期编排顺序集中可见」这一收口点摊到多文件 |
| `src/services/engine-controller.ts` | 763 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法；导出 SVG 后处理链经 `deps.exportSvgTransforms` 由组合根注入（K51：services 不依赖 features）。与 `mindmap.ts` **同性质**——拆开即把私有访问面摊开，故同样必须豁免 |
| `src/media/images-path.ts` | 555 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一），**从 images.ts 拆出**的产物；导出函数共享同一套路径与尺寸不变式，再拆会摊成跨文件的隐式协议 |
| `src/features/image-resize.ts` | 445 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链（无常驻监听、按帧重建元素、手势独占），拆开会让状态机与 DOM 手柄跨文件失配 |
| `src/features/drag-target.ts` | 382 | 单一算法收口（拖拽落点仲裁）：两类锚点（节点中心／兄弟间隙中点）必须共用同一套「按指针距离最近仲裁 + 引擎三态让位」规则，拆开会让锚点判定与视觉高亮口径漂移 |
| `src/features/view-node-actions.ts` | 728 | 节点操作（链接/文本/剪贴板/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export，此处是剩余语义相关操作集，再拆会让两个菜单的调用面分叉 |
| `src/features/view-dnd.ts` | 575 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配 |
| `src/main.ts` | 351 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。业务逻辑已全部外置（见文件头），拆开 onload 会破坏「装配顺序集中可见」的可读性收益；当前超线 51 行 |
| `src/markdown/links-split.ts` | 479 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。与 `md-outline` / `md-serialize` 同性质 |
| `src/core/constants.ts` | 432 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件，互有基表派生；「可链接附件」「系统媒体」两份白名单已于 2026-09-15 删除——附件口径收敛到 `domain/wikilink.wikilinkTargetIsAttachment`）；K28 要求「扩展名清单集中在 `constants.ts`，勿复制」——拆分即打断该收口，同 `i18n` 性质，只增加 import 噪音 |
| `src/settings.ts` | 375 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。`sanitizeSettings` 被 data.json 加载与面板写回共用（已在「代码结构」清单登记） |
| `src/features/node-inline-content.ts` | 1282 | 自绘节点内容的**单一关注点**闭环：行内原文 → 段序列（含轻标记切分）→ HTML（锚点契约 + **内联样式常量**）。三份东西互为契约——样式常量即导出保真契约（K53 ⑤，引擎导出不注入插件 CSS）、锚点属性即 `view-wikilink` 的识别契约（K53 ③）——拆开会让「显示名口径 / 样式来源 / 锚点形态」跨文件漂移；文件的复杂度全部来自这三个契约的**取值表**（段类型 × 标记 × 样式），不是职责堆叠 |
| `src/features/view-wikilink.ts` | 411 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。两条预览路径**都不预检目标是否存在**（交核心判断，见 K21） |
| `src/platform/math-jax.ts` | 661 | 数学渲染通道**单一落点**（全插件唯一 import `obsidian` 的数学实现）：产品形态是「字面占位 → 异步替换 → 就绪判据（全部 `mjx-c` 宽 > 0 + 不可见操作符 U+2061 豁免，K90）→ flush 合并调度 → 产物缓存 / 重排通知 → 失败退字面」，再加导出 SVG 样式注入——屏上渲染与导出注入共享同一套就绪口径；拆开会让该口径跨文件漂移（它正是 K90 三轮实机实测的产物） |
| `src/links/links-tree.ts` | 437 | 树内引用更新**单一遍历实现**：rename / clear 两模式共享待匹配形态派生（资源地址 + [[链接]] 双载体、回收站退化、跨文件夹移动取新位置、非 .md 文档带扩展名）与写回规则；拆开会让「重命名改写」与「删除清理」两条路径的匹配口径漂移 |
| `src/links/links-resolve.ts` | 351 | 「任意地址形态 → TFile」的**统一解析入口**：远程拒绝 → `obsidian://` → 资源地址 → 路径直查 → `file://` 剥离 → 官方 `getFirstLinkpathDest` → 索引兜底——形态路由的**分支顺序本身即契约**（新增规则只改这一处）；拆开会重新引入本文件当初拆出要收敛的「双轨并存、覆盖形态互有盲区」问题 |
| `src/features/node-inline-editor.ts` | 364 | 节点内联编辑的**单一会话收口**（K92）：覆盖层定位与跟随（`scale` / `node_tree_render_end` 重定位）、键盘语义表、点击外部与 `mousewheel` 提交、会话所属引擎守卫、提交写回（`applyRawNodeContent`）共享同一套「会话 → 值 → 落数据」不变式；拆开会让定位跟随与提交守卫跨文件失配 |

行数为 **2026-09-28 快照**（死代码审计、lint 合规化、K92/K93 与「函数内纯移动拆分」轮后按 `Get-Content` 行数重测：`mindmap.ts` 1878、`node-inline-content.ts` 1282、`md-outline.ts` 1024、`view.ts` 996、`md-serialize.ts` 893、`engine-controller.ts` 763、`view-node-actions.ts` 728、`math-jax.ts` 661、`view-dnd.ts` 575、`images-path.ts` 555、`i18n.ts` 504、`links-split.ts` 479、`image-resize.ts` 445、`links-tree.ts` 437、`constants.ts` 432、`view-wikilink.ts` 411、`drag-target.ts` 382、`settings.ts` 375、`node-inline-editor.ts` 364、`main.ts` 351、`links-resolve.ts` 351；全部 **21 个超限文件均已登记理由**，其中 `math-jax.ts` / `links-tree.ts` / `links-resolve.ts` / `node-inline-editor.ts` 分属此前各批补登记），仅供参考；判定以「是否已在表内登记理由」为准，不以数字为准。

**函数内拆分口径（2026-09-28「批次 2」逐行评估裁决）**：超长函数（>90 行）能否拆，判据同文件级——「拆会不会把契约摊开」，而非行数。① **不拆**（判定/优先级链形态：分支**顺序即契约**、注释与状态流集中可见；拆分需 `continue`→`return` 转换或引入 ctx/闭包状态，属机械改写而非提取）——`md-outline.buildInlineData`（220 行）/ `md-outline.classifyLines`（174）/ `node-inline-content.splitMarkedText`（111）/ `drag-target.handleMove`（105）。② **拆**（纯移动：块间独立、签名统一、零共享可变状态）——2026-09-28 已完成：`view-wikilink.registerWikilinkInteractions`（137 → 编排壳 + 点击/悬停/画布锚点悬停/中键四个注册函数）、`view-toolbar.buildToolbar`（114 → 编排壳 + 左/中/右三组构建）、`commands.registerCommands`（145 → 编排壳 + 创建/视图/导出与文档三组）。**重跑函数级评估前先读本节**，避免重复论证。

## 测试与 CI

```bash
npm test            # vitest run（CI 在 build 后、lint 前执行）
npm run test:coverage  # vitest run --coverage（v8 provider，报告出 coverage/；CI 主矩阵版本执行并归档产物）
npm run lint:css    # stylelint：styles.css 的 CSS 检查（规则面照抄官方 scanner，见下方「CSS 检查」）
npm run check:release # 发布元数据护栏（versions.json 形状 / 当前版本与 minAppVersion 一致 / README 非空 / License：缺失 error、非 OSI warn，见 K109）
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
  外加**十六个**探针：viewport（20 层深链大图必须 100% 缩放、整体内容居中，且重置缩放漂移
  ≤1px）、perf-box（121 节点性能模式大图 + 800×300 视口：`centerContentAtFullScale` 前后
  `.smm-node` 数均 < 总数 50%＝不装配全量 DOM、内容中心 = 画布中心 ±2px、数据层几何并集与
  DOM 全量盒尺寸差 ≤8px——钉住 K70 的打开路径性能契约；探针规模须取「刚过阈值的最小量」，
  641 节点版本会因分片渲染任务链推后其余探针的读取窗口而连锁失败）、anchor（SVG 节点补齐 `offsetWidth/offsetHeight`，弹窗锚定矩形
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
  **运行注意（2026-09-20 实测，排查「打开卡顿」时踩到）**：① **不要与 CPU 密集任务并行跑**——
  同机并行 `npm test`（48 文件）时 perf / image / count / layout 探针出现 14 项假失败，
  单独复跑即全绿；虚拟时间只在**空闲**时推进，真实 CPU 被抢占会让「固定延时后读取」的探针
  读到未渲染完的中间态（`renderer.root` 为 null）。② **`--perf` 对环境负载敏感**：同一份
  代码曾连续 3 次失败、机器空闲后 1 次通过；失败归因务必先做「同页旧行为对照实验」（临时
  恢复旧实现跑同一命令），不要直接怀疑改动。③ 四个固定延时型探针（perf / image / count /
  layout）已于 **2026-09-21 复查完成同款加固**（`whenMapReady`：`node_tree_render_end` 事件 +
  `.smm-node` / `renderer.root` 轮询，上限 1200ms；image 回灌后的读取改为「轮询到目标宽或超时」）
  ——它们在负载机上曾**稳定**假失败（探针读到 `renderer.root` 为 null 的中间态），加固后同一
  环境全绿。失败时仍先按 ①② 排除环境（本轮已用「同页旧行为对照 + 加固后转绿」双重确证根因）。
  ④ 加固过程中的两个衍生修复（2026-09-21，同轮）：a) 读 DOM 结构 / 计数的探针必须用
  `whenMapReady` 的 **strict 模式**（只认 `node_tree_render_end`）——`.smm-node` / `renderer.root`
  兜底在「首个节点已创建」时就为真，此时调 `render()` 会把部分渲染变成全量重建（实测「空 render
  构建器调用 500 次」vs 期望 0）；b) perf 探针的构建器计数器**不得装在共享 options 上**（页内
  所有图共用同一 options 对象，邻图首帧会把 151 次调用记进本探针的空 render 窗口）——现装在本
  探针两张图的 options 浅拷贝上。**附**：本轮两次踩到「模板字符串内注释不得出现反引号」（K69 已
  记录该坑）——在 `buildEntrySource` 模板段内新增/修改注释后应立即扫描确认（解析模板段、找
  注释行中的反引号），不要等运行报 `SyntaxError` / `ReferenceError: node is not defined`。
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
- [K7] 混排双链拆分（links-split）：节点行内与描述文字混排的双链可抽离为**子节点**（父节点保留描述文字、链接处替换为可见名）。全部规则与产品决策（适用节点/待抽链接/空白处理/幂等/资源地址兜底）定义在 `src/markdown/links-split.ts` 文件头契约，本文件不复述；视图侧执行在 `features/view-split-links.ts`：**批量命令 `mindmap-split-links-all`**（全文，含未编辑存量）与**自动触发**（受设置 `autoSplitMixedLinks` 约束且只处理**被编辑过**的节点，判据 `text !== mdDerivedText`；**K108 例外**：插件侧编辑通道（内联编辑器 / 弹窗原文模式）提交时会同步刷新 `mdDerivedText`，该判据恒不成立，故凭 `{ force: true }` 放行）——单节点手动命令 `mindmap-split-links` 已于 2026-09-14 删除、ID 不复用（单节点场景由自动拆分覆盖）。自动检查的对象是**编辑期捕获的候选集**（引擎 `node_text_edit_change` 带节点、经 `captureAutoSplitCandidate` 累积；**K108 起**插件侧编辑通道另经视图 `notifyNodeContentCommitted` 以 `{ pluginChannel: true }` 入集——该通道不走引擎命令、不派发此事件，缺这条会让默认自绘渲染下永不拆分）——**不是检查时刻的激活节点**：编辑提交后快速切换激活不漏拆；编辑中被检查则保留候选等下次；引擎换代（换文件/重载）整体丢弃。回归见 `tests/view-split-links.test.ts`。
- [K8] 图片自定义尺寸（Obsidian 官方嵌入语法，不落 data.json）：`![[图.png|300]]`（仅宽、等比）/ `![[图.png|300x150]]`（宽高）/ `![alt|300](url)`（外链 md 图，尺寸在标签尾部）。解析进 `mdImageWidth/mdImageHeight`（domain/md-meta 契约）；`walkImageSizeCorrections` 对带参节点按参数定尺寸（仅宽时探测原始比例补高；**2026-09-28 K97 起未设置尺寸的图按图片原始大小展示**）；拖拽调宽改 engine `imageSize custom:true`，保存时 rawOk 尺寸特征（`目标|宽度`，终界 `]`/`x` 防前缀误匹配）不符 → 合成回写 `|宽度`。**加载期自动校正的尺寸绝不回写**（`mdImageAutoSize` 标记；`md-serialize.ts customImageSize` 是取尺寸后缀的唯一出口）：它只是显示用尺寸（`imageSize custom:true`），回写会让用户从未动过的行凭空多出 `|宽度`；标记在**用户拖拽调宽 / 插入或更换图片 / 移除图片**三处清除（前两者属用户意图、尺寸照旧回写；移除图片时清标记同时防止「该节点后续新图也不回写」）。
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
- [K54] **节点编辑弹窗的两种模式（2026-09-15，用户实测反馈修订）**：编辑框此前一律编辑 `data.text`（**显示文本**）——双链只剩剥壳名、外链（icon-only）连影子都没有，用户既看不到也改不了语法。现按节点类型分流（`view-node-actions.editNodeText`；**2026-09-28 K92 起该分流移至 `editNodeTextInModal`**——`editNodeText` 改走「引擎编辑框 / 内联编辑器」二选一，模式判定逻辑不变）：① **纯链接节点**（`md-serialize.isPureLinkNode`：整行一个链接/图片、文本即其显示名）→ **别名模式**：编辑 `data.text`，提交经 `setNodeText`（K6 不变）；② **其余富节点** → **原文模式**：编辑**文件里的那一行**（`[[双链]]` / URL / 轻标记全可见可改），预填 `md-serialize.composeNodeContent`（= 下次写盘会写出的内容，与序列化 `nodeLines` 同一实现），**实时预览** `node-inline-content.inlineContentPreview`（**渲染器口径**：URL 显示为地址——与引擎侧 `buildInlineData().text` 的 icon-only 口径**不同**，预览必须用前者，否则用户会以为 URL 又没了），提交经 `markdown/md-line-write.applyRawToNode` **重解析**写回：先清空再回填全部行内字段（链接通道 + 图片通道 + `mdSegments` + `mdImageAutoSize`，清单取自解析侧常量 `md-outline.INLINE_LINK_FIELDS` / `PLAIN_IMAGE_FIELDS`）+ 三个文本字段由解析结果写就 ⇒ `text === mdDerivedText`（**未编辑**）⇒ 保存**逐字写回用户输入**（等价于「改文件再重载」）。多行：首行承载链接语法，续行按纯文本并入（行首按解析侧口径 `trimStart`，缩进由序列化器补）；结构字段（`mdType`/`mdLevel`）不动；取消或未改动不写盘。原文新增/更换图片时：`resolveImagePath` 换资源地址 + `walkImageSizeCorrections` 异步校正尺寸后补一次渲染。回归：`tests/md-line-write.test.ts`（7 例：整体重建 / 未编辑往返锁 / 多行 / 未闭合语法 / 结构字段）、`tests/view-hotkeys.test.ts`（两模式分流 + 预览口径）。
- [K53] **自绘（富）节点的渲染与编辑入口（方案 B Phase 1）**：含行内链接 / 轻标记 / **超长文本**（见⑦，引擎逐字符换行会对长行二次爆炸）且**无图**的节点由 `features/node-inline-content.ts` 生成 HTML（`a.internal-link[data-href]` / `a.external-link[href]`，与 Obsidian 锚点形态一致），经 `engine/mindmap.ts` 的 `createNodeContent` 钩子注入引擎 `isUseCustomNodeContent` + `customCreateNodeContent`（两键未入 d.cts，`Object.assign` 防腐透传；返回 null 的节点走默认 SVG 文本），点击复用 `view-wikilink` 既有节点内锚点分流（**零改造**）；悬停走**节点级预览**（不按锚点判定，见 K21/回撤说明）。八条边界：① **渲染源随编辑切换**——未编辑读 `mdRaw`，已编辑读 `data.text`（mdRaw 是解析期快照，判据与 rawOk 同源：`text === mdDerivedText`）；② 接管后引擎跳过 text/image/icon/hyperlink/tag/note/**prefix**，故**双链文档页图标在富节点上不再出现**（有意：内联锚点已承担「可点 + 目标名」，对齐阅读视图；三类图标体系仍服务未接管节点），含图节点整体不接管；③ 自绘节点无 `_textData`，引擎编辑框对其**静默 no-op**（`textEdit.show()` 的 `isUseCustomNodeContent()` 守卫）→ 编辑入口统一走 `features/view-node-actions.editNodeText`（默认节点→引擎编辑框、富节点→`ui/modal-text` 弹窗〔2026-09-28 K92 起：富节点主入口＝内联编辑器，弹窗收编为右键备选，分流入口自 `editNodeText` 移至 `editNodeTextInModal`〕；弹窗**两种模式**——纯链接节点别名、其余原文，见 K54），三处入口（双击 / 右键「编辑文本」/ F2）共用；④ **行内语法的显示层**（2026-09-15 扩至官方完整清单）：轻标记 `**粗**`/`__粗__`、`*斜*`/`_斜_`（下划线式要求两侧非字母数字，`snake_case` 不误判）、`` `码` ``（含双反引号跨度）、`~~删~~`、`==高亮==`、`***粗斜***` 只在渲染期剥成语义元素（`strong`/`em`/`code`/`del`/`mark`）；另有 `%%注释%%` **渲染期整段隐藏**（阅读视图口径）与反斜杠转义 `\*`（消费反斜杠、按字面显示——此前会被误渲染成斜体）。两类**隐藏语法**同样触发接管（转义恒触发；注释仅在**去掉后仍有可见内容**时触发，否则会渲染出一个空节点）；全部单层、不跨行、不嵌套、定界符内首尾须非空白，`data.text` 与文件原文一律保真；**含轻标记的节点同样被接管**（2026-09-15 修订：此前只按「含链接」接管，`**粗**` 在无链接节点里原样显示——用户实测发现），代价与含链接节点同款（编辑入口走弹窗，见③）；⑤ **导出保真**：自绘内容的布局/排版/配色/轻标记样式**全部内联在元素上**（`node-inline-content.ts` 的 `CONTENT_STYLES` / `INTERNAL_LINK_STYLES` / `EXTERNAL_LINK_STYLES` / `MARKUP_STYLES` 为唯一来源，`styles.css` 只留纯屏幕装饰）——引擎导出（vendor `getSvgData`）只注入 `joinCss()`（引擎自身 CSS）与 header/footer 的 cssText，**插件 styles.css 不在导出图里生效**，样式一旦只写在类规则里，导出 PNG 就会掉排版（foreignObject 尺寸仍按屏上测宽固定 → 溢出/错位）；⑥ **锚点级悬停预览**：富节点内每枚锚点各自预览**自己**的目标（节点级 `nodeLink` 取「首链」会与所见错位）——指针直接进入锚点走 `node_mouseenter` 的锚点分支，节点**内部**在锚点间移动不会重新触发引擎事件，故另有画布 `mouseover` 委托补齐；节点非锚点区域悬停不再预览；⑦ **性能收口**（2026-09-14，2026-09-15 修订）：段序列按**原文内容寻址**缓存（`segmentCache`，上限 512 满则整表清空——渲染期缓存，重建成本远低于内存风险；内容寻址天然避免跨导图串味）。**超长文本必须接管并截断展示**（原文 > `MAX_INLINE_CONTENT_CHARS`=2000 → 一并接管，尾部 `…` + `data-truncated` + `title` 提示，显示 ≤2000 字；文件与 `data.text` 一字不动，双击弹窗看/改全文）——**原「超长回落引擎」是陷阱**：引擎 `createTextNode` 的换行是**逐字符**迭代（每加一字重新拼接整行 + 重新测量一次），单行开销**二次增长**，用户实测「白屏 / 卡死后关闭」即由此而来；无头 Chrome 同机实测 20k 字单行：引擎 ≈ **+2.8s**（整轮 1.1s→3.9s）vs 自绘 HTML ≈ **0**。渲染成本由此与文本长度**脱钩**（每节点上界 = 2000 字）。**残留边界**：**含图 + 超长文本**的节点无法接管（图片走引擎图片通道），其长行仍由引擎换行承担——建议把该节点拆短（这类节点在方案 B 前也是同样代价）。⑧ **未解析链接弱化（注入式解析）**：库内锚点在目标**未解析**时加 `is-unresolved` 类 + 弱化配色（`--link-unresolved-color`/`-opacity`，字面量兜底供导出图用）——对齐 Obsidian 阅读视图「指向尚不存在的笔记的链接显示为更弱的颜色」，用户据此知道点击会新建/打不开。解析器由调用方注入（`InlineContentOptions.isResolvedLink`，生产在 `view.ts` 经 `view-link-navigator.isResolvedWikiLinkpath` 注入 `metadataCache.getFirstLinkpathDest`）——`node-inline-content` 必须能在无 Obsidian 运行时的页面里打包（`verify:visual` 直接打包它），故**不得**自己 import Obsidian；解析**每次构建实时求值**，不进段序列缓存（缓存按原文寻址，与库状态无关）。判据：`#区块`/`|别名` 不参与解析，`[[#标题]]` 这类同笔记内区块链接按「当前文件存在即已解析」处理。回归：`tests/node-inline-content.test.ts`（接管判定含「仅轻标记」「未闭合标记」「转义/注释」「超长回落」边界、轻标记扩展与转义/注释段序列、未解析标记 5 例、缓存命中、内联样式契约）、`tests/view-wikilink.test.ts`（锚点级悬停 6 例 + 未解析不预览 + 区块链接按目标解析 + 修饰键矩阵）、`tests/view-hotkeys.test.ts`（富节点分支）、`npm run verify:visual` 的 inline / markup / syntax / paragraph / hugeline 场景 + inline / export / scale 三个探针（foreignObject 装配、离屏测宽同源、合成点击命中锚点、`<strong>`/`<code>`/`<mark>` 渲染、仅轻标记节点也接管且无锚点、`\*转义\*` 消费反斜杠、`%%注释%%` 不进显示、未解析链接带 `is-unresolved`（对照组已解析链接不加标记）、超长节点接管 + 显示 ≤2000 字 + `…` + `data-truncated` + `title`、导出 SVG 内联样式、30 富节点全渲染且离屏测宽元素恒为 1；负向自检：关掉 `isUseCustomNodeContent` 报 7 项、去掉内联样式报 1 项、**解析桩改为恒真报「未解析链接未标记 is-unresolved（实得 0）」1 项、注释分支改为不隐藏报「%%注释%% 未被隐藏」1 项**——后两条用于证明新断言非空转，复查时实测过。**注**：该脚本跑在 `--virtual-time-budget` 下（时钟被虚拟化），**不做耗时断言**——性能基线需在真实时钟环境另设。

- [K71] **往返幂等与空结构零丢失（2026-09-25，R1/R2/R8/R9）**：① **块首空行不输出**——`md-serialize.pushBlock` 剥块首空行：围栏相邻 flush 会把空行并入 plain 块 mdRaw（以 `\n` 开头），与补的分隔空行叠加曾致「`# 标题`+空行+围栏」每趟往返多一枚、无不动点；**只剥块首不剥块尾**——列表行不经 pushBlock（直接输出、无分隔逻辑），尾空行从不累积，剥除反而丢用户有意空行（`md-roundtrip.test.ts` 围栏黄金用例锁定）。② **空标题（`#`/`# `）保留为空文本 heading 节点**（此前丢弃＝保存后该行消失，与「空列表项退化 plain」口径对齐）：`classifyLines` 不再按 text 过滤；`#` 首趟归一为 `# `（序列化前缀携带尾随空格），第二趟起不动点；编辑合成走既有 heading 路径（`## 新文字`）。③ **等价性分级与规范化白名单成文**于 `docs/markdown-mindmap-standard.md` §3.6（L0 字节级 / L1 内容级两级定义，白名单 10 条）——**canonical 化函数与白名单一一对应，文档与测试不得漂移**。④ **生成式验证** `tests/md-roundtrip-property.test.ts`（fast-check，devDependency）：P1 不动点 T∘T=T（300 runs）/ P2 canonical 行序列守恒 / P3 任意输入不抛错 / P4 自建语料 `tests/fixtures/roundtrip/*.md`（8 份，正文-only，CRLF 程序生成防 autocrlf 检出漂移）+ 字符级变异冒烟；**生成空间按 #10 收窄**（空列表项钉 0 层缩进——text 为 null 与 `''` 都要覆盖）。⑤ **属性测试发现的既有缺陷已登记**（§3.6 #10）：根层缩进列表保存后缩进按树深度重排，紧随其后的缩进行被二次解析并作续行（内容不丢、第二趟收敛）——彻底修复需 `mdIndent` 类字段（解析/序列化/拆分三处联动），未实施。回归：`md-roundtrip.test.ts`「幂等修复（R1）」3 例 +「空标题保留」例；property 6 例。

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
  零废弃 API 使用。仅存**四处**无官方等价的私有触点，均防御式实现并文档化：
  ① `features/file-creator.ts` file-explorer「新建」菜单注入（官方仅有 file-menu，
  无 fileCreator 公共 API）；② `links/links-resolve.ts` 拖拽兜底 `dragManager`；
  ③ `system-open.ts` 桌面端 `require('electron').shell.openPath`（d.ts 无系统打开 API）；
  ④ `platform/math-jax.ts` 数学渲染面（d.ts 无等价）：`window.MathJax.tex2chtml/tex2svg`
  直调 + `#MJX-CHTML-styles` 样式表读写（导出注入与就绪判定需要）——其中
  `loadMathJax` / `finishRenderMath` 为官方 @public，渲染调用与 flush 均收口在本模块
  （见 K85 / K87）。
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

- [K68] **性能轮（2026-09-18）：四处「重复付出的成本」收敛——索引增量补建与校验节流、拖拽帧内预筛、自绘判定缓存**：
  ① **`create` 事件由整体失效改增量补建**（`file-lookup.FileLookupIndexService.noteCreated`，与全量重建共用
  `writeFileEntries` 键形态表，勿各写一份）：`create` 是最高频的一类库事件（批量导入 / 外部同步 / 图片入库后
  立即解析路径即高频路径），原「invalidate 即整体失效 + 下次查询全量重建」会让风暴期内的每次查询都付一遍
  O(文件数 × 路径深度 + getResourcePath)（注释自述大库数百毫秒）。rename / delete **仍整体失效**——旧形态键
  无法安全地增量摘除（后缀键可被多个文件共享，摘错会误删别人的键）；文件夹 create 不进索引（只收录 TFile）。
  ② **`validate` 数量比对加时间窗节流**（`VALIDATE_MIN_INTERVAL_MS`，构造函数可注入时钟供测试推进）：
  「索引未命中」的自愈查询在一次保存序列化里可能逐节点发生（每个解析不出的图片/附件各触发一次），逐次
  `getFiles` 全量数组拷贝是纯浪费。窗口内直接复用缓存；`invalidate` 重置窗口；`lastValidateAt === null`
  （首次校验）不受节流——事件遗漏的自愈只被推迟到窗口外，本就是 best-effort。
  ③ **basename 同名冲突查询走索引计数**（`hasBasenameConflict`，`view-node-actions.newDocLinkpath` 消费）：
  替代每次新建文档链接的 `getFiles` + `some` 全量扫描；索引未建立时回落原扫描（fail-open 语义不变）。
  ④ **拖拽落点识别域帧内预筛**（`drag-target.handleMove`）：先以平方距离就地判定（`engine/mindmap.readNodeViewportCenter`
  零分配读取中心；与 `drag-target.nodeViewportCenter` 同字段表 + 同公式，有逐例一致性测试），**命中识别半径
  才创建锚点对象**——大图拖拽从每帧 O(n) 次对象分配降到 O(命中数)。**顺序与仲裁语义严格不变**：先全部
  「挂子」再全部「兄弟间隙」、并列由 `pickNearestNode` 的 `<=` 承担（其单测与 `nodeViewportCenter` 单测未动）。
  ⑤ **自绘接管判定随段序列缓存**（`node-inline-content.segmentEntryOf`）：`hasRichSegments` / `needsHiddenSyntax`
  是只依赖原文的纯函数，原每次节点内容重建都重扫 3 个正则 + 段遍历，现与段序列同条目（LRU 512 与
  `segmentCacheStats` 口径不变；`isResolvedLink` 仍在每次构建时求值、不进缓存——它依赖库状态）。
  **明确不改**：「拖宽每 8px 提交一次全树 `render()`」（P5，`previewNodeImageSize`）维持现状——浪费在 vendor
  渲染器内部（K58/K61 已量化），插件侧改动的 ROI 判据是「能否减少 render 次数」而非单次更快。
  回归锁定：`tests/file-lookup.test.ts`（增量补建 / 幂等 / 无缓存 no-op / 节流窗口 / basename 计数与回落）、
  `tests/feature-helpers.test.ts`（就地版与返回值版逐例一致）。

- [K69] **性能轮（2026-09-18，第二轮）：资源地址直解免全库建索引、引用预检零分配、解析纯文本快路径**：
  ① **资源地址（app://）直解**（`domain/url.resourceUrlPathCandidates` + `links-resolve.resolveResourceUrlDirect`）：
  索引是**惰性全库构建**（10 万文件实测 **303.8ms** 同步阻塞，而「打开含图文档」的首个图片解析
  ——`resolvePathToFile('app://…')`——就会触发它）。直解把该分支改为「提取 host 后的路径候选
  （原样 + decode）→ `getFileByPath` 直查 → **`getResourcePath(file) === url` 全等校验**」，
  实测 **1.9µs**（10 万文件库，getFiles 调用 0 次）；校验不通过（含 mtime 缓存串过期）回退索引
  ——历史/非标准形态的兜底能力与行为不变（唯一有意差异：文件被外部修改后，陈旧索引对**新地址**
  会 miss 返回 null，直解按当前地址校验可命中——方向为「更正确」）。**全等校验不可省**：只按路径
  直查会让手工构造的伪地址（`app://x/笔记.md`）命中「路径巧合」的真实文件。
  ② **引用预检零分配**（`core/node-data.nodeReferenceMatches` 取代原 `nodeReferenceHaystack`，
  消费方 `engine-controller.rendererTreeHasMatchingRef`）：预检按**全树**调用、无关文件的命中率
  通常为 0，原「拼接比对串 + includes」每节点一次数组 + join；新实现只对非空字符串字段做子串
  比较，2000 节点实测 **0.68ms → 0.51ms**（1.3×；无引用节点零分配，含链接的图收益较小）。
  原比对串的「跨字段误命中」（needle 含 `|` 横跨两字段）不再发生——更严格只减误报，真实引用都在
  单字段内。另一处差异：**空 needle 不再恒命中**（旧 `haystack.includes('')` 恒真，而 `oldBasename`
  对 `.gitignore` 这类「点开头且无其他点」的文件名去扩展名后为空 ⇒ 旧实现每次重命名/删除这类文件
  都会白走一遍整树深拷贝精确路径）。
  ③ **解析无 token 快路径**（`md-outline.buildInlineData`）：纯文本行不再经 pieces 数组 + 切片 +
  join（归一化口径不变：连续空格折叠 + trim）；2000 节点（80% 纯文本行）parse **2.0ms**。
  ④ **`--perf` 复测**：真实墙钟 300 次编辑 ≈ 48.5ms/次（与上一轮 48.0 同量级，无回归）；内存轮
  4 条硬断言全绿（离屏测量 1 / 历史 163 == 上限 / 上限 == `resolveHistoryLimit(500)` / 段缓存 ≤512）。
  ⑤ **verify:visual 的 viewport / anchor 探针就绪判定改为「`node_tree_render_end` 事件 + 轮询
  （上限 600ms）」**：原固定 150ms 在冷启动/高负载下偶发**假失败**（2026-09-18 实测两次：容器尚无
  `.smm-node` → 锚定探针读 null 尺寸、视口探针包围盒为空 → 字段缺失；同代码复跑即过，与代码无关）。
  **注意 `buildEntrySource` 返回模板字符串**——页内注释里不得出现反引号（会提前终止字符串，实测
  踩坑：`ReferenceError: node is not defined`）。
  回归锁定：`tests/links-resolve.test.ts`（直解命中不建索引 / 回退索引 / 编码与 mtime 形态 /
  校验失败回退 / 无路径段 / `getResourcePath` 抛错兜底）、`tests/url.test.ts`（路径候选提取的
  11 条边界）、`tests/engine-controller.test.ts`（空 needle 不再触发恒命中的零拷贝短路）。
  **未改**：拖宽全树 `render()`（P5，维持 K68 结论——渲染非编辑手感大头）。

- [K70] **性能轮（2026-09-20，第三轮）：打开多节点图的默认视口居中不再装配全量 DOM**（用户实测
  「多节点打开卡顿严重、加载很久」）：
  ① **主因**：性能模式下视口外节点被引擎回收，`draw.rbox()` 只覆盖可见子集 ⇒ 旧实现
  `centerContentAtFullScale` 先 `forceLoadNode()` 把整树**同步**装配进 DOM 再测包围盒（vendor 的
  forceLoadNode 是同步递归 render），且该动作在打开窗口内被**多轮**触发：首帧渲染结束 →（forceLoadNode
  结束时 emit `node_tree_render_end` → **同步重入**同一处理器，重算预算 2 被连耗）→ 150ms 兜底预算 +1
  → 图片回灌后的补居中（不受预算限制）。按已有实测口径（500 节点 ≈ 3759 DOM 元素，见 K58），
  2000 节点图每轮约 1.5 万元素的同步装配 × 4 轮 ⇒ 打开窗口内的主线程长任务。
  ② **修复**（`engine/mindmap.measureContentBoxFromData`）：性能模式改用**数据层几何并集**——遍历
  `renderer.root` 全树读 `left/top/width/height`（与引擎裁剪判定 `checkIsInClient` 同源；vendor 实读
  `get left() { return this.customLeft || this._left }`，拖拽调整过位置的节点与渲染读同一字段），
  零 DOM 装配、O(n) 纯计算；平移量 = 画布中心 −（布局中心 × scale + translate）（引擎
  `getNodePosInClient` 同口径）。数据层几何不可得（`renderer.root` 缺失等中间态）回退原 DOM 测量路径，
  **不补 forceLoadNode**（此时 rbox 多半同样不可得，静默降级）。常规模式（非性能）行为不变（rbox 精确）。
  **`fitMindMap` 仍 forceLoadNode**：引擎 `view.fit()` 内部基于 rbox，替换需复刻 fit 的 padding/边界
  语义（风险大于收益），且它是用户主动动作（适应画布/自动整理）而非常驻打开路径。
  ③ **探针**（`verify:visual` 的 `perf-box`，121 节点 > 阈值 100 + 800×300 视口）：钉住「节点 DOM 数
  在居中前后均 < 总数 50%（不装配全量）」「内容中心 = 画布中心 ±2px」「数据层盒与 DOM
  全量盒尺寸差 ≤ 8px」。**规模刻意取刚过阈值的最小量**：探针在共享页面里跑，图越大其分片渲染任务链
  （`view_data_change` 后每子节点一个 setTimeout）越长——2026-09-20 实测 641 节点版本把其余探针的读取
  窗口推后，连锁失败 **43 项**（dump 里场景已渲染、探针读取时尚未：自绘内容是探针之后才创建的）。
  ④ **打开窗口内的重复调用幂等短路**（承 ① 的「多轮触发」）：`centerContentAtFullScale` 现于
  「比例已是 1 且内容已在画布中心（< 0.5px）」时**完全不动 view**——vendor 的 `setScale` **无条件**
  emit `view_data_change`（`scaleInCenter` 在 Δ=0 时也 `transform() + emit`），性能模式下经 200ms
  节流器触发**分片整树渲染**（每轮 = 整树布局 + 属性空写，K58 口径）；打开窗口内本函数被调 3 次
  （首帧渲染结束 / 150ms 兜底 / 图片回灌补居中），其中「几何未变」的兜底轮此前每轮白渲染一次，
  现为 O(n) 纯计算后直接返回。比例已是 1 时也跳过 `setScale`（同源 emit 浪费；通常与
  `translateXY` 的 emit 落同一节流窗口、收益较小，但避免「仅有 setScale 的调用」白开一个窗口）。
  ⑤ **回归锁定**：`tests/viewport.test.ts`（性能模式走数据层几何并集、**不** forceLoadNode、平移量与
  几何不变量；数据层几何不可得回退 DOM 测量且仍不 forceLoadNode；**已在目标态零调用**、
  **比例 1 跳过 setScale**）。

- [K72] **打开大图的成本主体：引擎逐字符文本测量；插件侧以自绘接管规避（2026-09-25，性能轮实测）**：
  ① **实测定位**（`verify:visual --bench-open`，真实墙钟）：打开成本 ≈ 1.8s 固定 + Σ(节点字符数 × **0.13ms**)
  （5000 与 10000 节点独立拟合一致）；5000 节点含 5% 长文本（1540 字）= 58.8s、去长文本 8.6s、
  **全节点自绘 1.36s**（6.3 倍）；折叠 3 层反而 34.9s（引擎给每个折叠节点渲染展开按钮 ≈ +26s，
  **净负，勿采用**）。
  ② **根因**（vendor 内部，插件不可改）：`nodeCreateContents.createTextNode` 逐字符换行循环
  （每字符一次 `measureText` + O(L²) 字符串重建）+ `measureText` 每字符一次「克隆 → 挂 body →
  `getBBox()` 强制布局 → 移除」（svg.js retry 路径）；发生在**渲染期节点构造**，早于
  `MindMapNode.render` 的性能模式门——`openPerformance` 裁剪不掉它。上游补丁建议（快路径 +
  canvas measureText + 缓存）见 `docs/engine-upstream-patch-proposal.md`。
  ③ **插件侧规避（已实施）**：`settings.selfDrawPlainNodes`（默认开）——所有含文字节点经
  `node-inline-content` 自绘接管，引擎 `createNodeData` 提前 return、测量全跳过；**边界**：空文本 /
  含图 / 隐藏后无可见内容（纯空白、整行注释）不接管（否则渲染空节点或丢图片/图标）；
  自绘节点双击走插件侧编辑器（`editNodeText` 经 `isCustomNodeContent` 运行时事实分流，零改动自动
  适配；2026-09-28 K92 起＝内联编辑器，弹窗收编为右键备选入口）；**宽度手柄门禁**改为消费同一
  运行时事实（`engine/mindmap.isCustomNodeContent`），
  替代原静态判定 `shouldSelfDrawNode`（零引用，已删）。
  ④ **设置路由（K62 同族）**：`selfDrawPlainNodes` **不在** LIVE_REFRESH 集合——仅对**之后打开**的
  文件生效（避免切换设置时大图重建卡顿）；`selfDrawPlain` 经 `InlineContentOptions` 每次构建
  实时读取（回调持有 settings 活引用），重开文件即生效。
  ⑤ **回归**：`node-inline-content.test.ts`（selfDrawPlain 接管 + 边界 4 例）、
  `view-node-width.test.ts`（运行时事实门禁 + 自绘纯文本形态）、`settings.test.ts`（布尔校验）；
  性能基线 `npm run verify:visual -- --bench-open`（opt-in，同 `--perf`）。
- [K73] **编辑帧成本的真实构成：引擎 `nodeDraw.has()` 的 O(n) 兄弟查找独占 27ms；三处引擎补丁把空 render 落地 26.1→2.7ms、一次编辑 47.6→21.4ms（2026-09-25，性能轮实测 + vendor 自有补丁）**：
  ① **实测分解**（`verify:visual --perf --perf-ops=<变体>` 真实墙钟差分，A/B/B/A 取最小；
  变体全表与口径见 `vendor/BUILD.md`「补丁清单」节）：500 节点 / 非性能模式 ——
  `copy`（getCopyData 整树深拷贝）0.2ms、`stringify`（JSON.stringify 整树）0.55ms、
  `compare` ≈0、`history`（originAddHistory 全流程）**0.8ms**、`editnohist` 46.1ms vs
  `edit` 47.6ms（**addHistory 真实增量仅 1.5ms**）、`idle`/`rafonly`/`layoutonly`/`themetick` ≈0、
  `rendertick`（一次空 render 落地）**26.1ms**、`rendernocb` 26.2ms、`rootrender` 27.1ms、
  `nodeupdate`（全子节点 update 总量）0.8ms、`noderenderline` ≈0。
  ② **修正 K65 的归因**：K65 推断「编辑手感大头在 addHistory 的整树深拷贝 + JSON 比对」——
  实测为**误**（0.8ms，占 3%）；K58 的「2495 条同值空写」在绝对时间上也可忽略（约 1.4ms，
  与 K63 的旧判断一致）。真凶是 `MindMapNode.render` 复用分支的 `this.nodeDraw.has(this.group)`：
  svg.js `has → index` = `[].slice.call(childNodes).indexOf(node)` —— **每节点每轮把全部兄弟
  节点拷进新数组再线性查找**，500 节点即 25 万次操作 + 500 次数组分配/轮 ≈ **27ms**。
  ③ **三处自有补丁（已入 vendor，改动面与维护流程见 BUILD.md「补丁清单」）**：a) 上述 has →
  `parentNode` 直接父判断（O(1)，语义等价：has 只判直接子且节点 group 在 nodeDraw 下平铺）
  ——**空 render 落地 26.1→2.7ms、一次编辑 47.6→21.4ms**；b) 节点数据快照去 JSON 化
  （`cloneNodeData` 值级深拷贝 + `isNodeDataChanged` 深比较，替代每节点每轮 1 parse + 3
  stringify；保留因**零写点依赖**——任何数据变化都反映在值上——且消除整树序列化分配，≈1.4ms）；
  c) svg.js `attr` 同值短路（`vendor/patches/`，经打包 entry 注入；空 render 2495 次同值
  setAttribute → 0 mutation，编辑路径同值空写 1997→0，≈1.4ms，大图/低端设备边际更大）。
  ④ **方法论与契约**：页内时钟在 `--virtual-time-budget` 下虚拟化（同步代码期间时钟不动），
  耗时只能用「同页两次调用的进程墙钟差」；`mutation` 变体采集 DOM 变更分布（补丁后空 render
  mutation = 0；edit 探针同值空写 0 为机械判据）。**新快照为值级对象（非字符串）**：生产面
  `MindMapNode.update` 与 `Base` lru 分支，消费面 `Base.checkIsNodeDataChange` 唯一，异常
  形态按「已变化」处理（安全方向）。
  ⑤ **生产口径 vs 负载旧口径（2026-09-25 追加实测，重要）**：`--perf` 负载原未接
  `selfDrawPlain: true`（生产自 K72 起默认开）——编辑后 text 不含链接段 ⇒ 不接管 ⇒
  切回引擎 SVG 渲染 + 逐字符测量，**此前测得的 47.6ms 是旧口径人造成本**；负载改接
  生产默认后（编辑保持自绘，DOM 变化 -0.5 元素/次），**一次编辑 = 5.3ms**（render 落地
  3.0 + addHistory ≈1.5 + 编辑同步 <1）。以 git HEAD 旧产物在生产口径下同测对照：
  **一次编辑 29.4→5.3ms（-82%）、空 render 落地 28.1→3.0ms（-89%）**。
  ⑥ **回归**：1578 测试全绿（含 vendor sha256 契约更新为 `e02e796a…` / 408,032 B）；
  全部视觉探针；lint；打开基准不劣化（5000 节点 1298ms）。
- [K74] **打开路径测量缓存：自绘内容尺寸按 `outerHTML` 内容寻址；重复打开 5000 节点 1276→≈810ms（-37%）（2026-09-25，性能轮续，补丁 4）**：
  ① **背景**：`measureCustomNodeContentSize` = 清空离屏容器 + appendChild +
  getBoundingClientRect（每节点一次强制 reflow），测量段占打开成本 ≈0.15ms/节点（K72）。
  ② **补丁 4**（改动面与实测见 BUILD.md「补丁清单」）：自绘内容全内联样式（K53 ⑤）
  ⇒ `outerHTML` 即完整尺寸 key；模块级缓存（跨引擎实例存活）⇒ 同文件重复打开
  （生产高频：切回/重开）命中率 ≈100%；命中时连 `cloneNode` 一并省（调用方改传源元素）；
  **字体未就绪（`document.fonts.status !== 'loaded'`）不写缓存**（防 fallback 度量污染）。
  ③ **容量须 ≥ 工作集（实测教训）**：4096 容量下「顺序重扫 + 淘汰」击穿命中率，
  收益仅 20%（省 261ms）；放大到 ≥工作集（定 16384，最坏 ≈16MB）后省 466–518ms。
  ④ **验证通道**：`BENCH_TWICE=1`（`--bench-open`）同页建图→首帧→销毁→重建，与单次
  运行墙钟差 = 第二次打开成本；`--perf-ops=clockcheck` 定论**页内时钟不可用**（3e7 次
  sqrt 忙等页内读数 = 0.0ms，K58 旧结论成立）。⑤ **边界**：首次打开不变（缓存冷）；
  本补丁只消测量段——内容构建 / 节点对象 / 布局为引擎固有成本。**当前 sha 以 BUILD.md
  登记为准**（补丁 4 后 `09718fde…` / 408,449 B）。回归：全量测试 + 视觉探针
  （尺寸类断言即缓存正确性验证）。

- [K75] **首帧前预测量 + 元素复用：打开 5000 节点再降 8%；并修正「测量段 700ms」的高估（2026-09-25，性能轮续，补丁 5）**：
  ① **机制**（改动面与实测见 BUILD.md「补丁清单」补丁 5）：`new MindMap` 之后、首帧前
  经 `MindMap.preMeasureCustomContents(mindMap, buildContent)`（engine/mindmap.ts 绑定
  doc/style/lang 注入，与 `customCreateNodeContent` 同一条构建链）walk 数据树、以轻量
  代理节点预生成自绘内容 → clone 集中挂载（`width: max-content` wrapper 保持块级宽度
  语义）一次 reflow → 尺寸写补丁 4 缓存；构建出的元素按 uid 存入
  `__preMeasuredContentMap`、正式内容创建点优先复用（取用即删）⇒ 首帧只剩一遍构建。
  配套把 `checkEnableDragModifyNodeWidth` 从 opt 开关改为**实例事实**
  （`isUseCustomNodeContent()`）——复用后内容可不经构建回调创建，opt 口径会给死手柄
  （实例口径与拖宽内部三重检查对齐）。
  ② **两段实验的负→正结论**：A1（只预测量、不保留元素）实测**净零**（100% 命中
  4750/4750 但总时长无变化）——预测量构建 + 正式构建构成**两遍构建**，抵消测量节省；
  A2（元素复用）省掉第二遍构建后 **1258→1151ms（-8%）**。
  ③ **对 K72/K74 的修正**：「测量段 ≈700ms / 0.15ms/节点」**高估约 5 倍**——A2 净收益
  仅 102ms ⇒ 4501 次测量的真实成本 ≈100–150ms；`twice` 通道（K74）的「重复打开
  -37%」中**主体是同页第二张图的整体热页红利**（同页对照不纯），缓存独占收益远小于此。
  ④ **诊断常驻**：`__PREMEASURE_STATS__`（预测量构建/命中/写入）与
  `__MEASURE_STATS__`（正式测量命中/未命中）页面全局、`--bench-open` 打印——
  测量缓存健康度的长期观测。
  ⑤ **边界**：预测量在 `createMindMap` 同步段完成（处于 Obsidian 加载态内）；构建/
  数据/样式任何不一致只会导致缓存 miss 或复用失效（回退原路径，零副作用）；单节点
  构建抛错即跳过该节点。

- [K76] **打开分片渲染（激活引擎既有 async 通道）：主线程阻塞从「整树单块」降为「单节点块」，代价 +1.4%~+3.4%；专项审计结论入册（2026-09-25，性能轮方案 B，补丁 6）**：
  ① **动机**：打开 5000 节点的 1.14s 是**单个同步宏任务**（UI 全程冻结）——K72 把测宽
  成本换到自绘路径、K75 把测量段做薄之后，这是打开路径最后一处体感缺口。
  ② **机制**（改动面与实测见 BUILD.md「补丁清单」补丁 6）：`_render` 整树渲染原传
  `root.render(cb)`；改为 `opt.renderAsync` 为真时传 `root.render(cb, false, true)`——
  激活 `MindMapNode.render` **既有** async 通道（每子节点一个宏任务，回调计数链完整）。
  **非新机制**：性能模式视口变化路径（`onViewDataChange`，Render.js bindEvent）一直
  以 async=true 运行；本次只是把 `_render` 主路径接上。插件侧按
  `RENDER_ASYNC_NODE_THRESHOLD`（1000）注入，显式覆盖通道
  `CreateMindMapOptions.renderAsync`（对照实验用）。
  ③ **实测对照**（`--bench-open` + `BENCH_RENDER_ASYNC=0/1`，同 bundle 仅页内全局变量
  不同）：500 节点 473→489ms（+3.4%）｜5000 节点 1137→1164ms（**+2.4%**）｜10000 节点
  2255→2287ms（+1.4%）——相对代价随规模**下降**（绝对 +16~32ms）；正确性指标
  （DOM .smm-node / 自绘锚点 / 截断数）三规模全一致；生产默认路径（不设变量、5000 ≥
  阈值）实测 1168ms 与强制分片一致（阈值判据生效）。
  ④ **专项审计结论（两窗口模型）**：布局窗口（`root=null`、doLayout 分片期间）是
  **既有**窗口（K67 守卫覆盖）；渲染窗口（`root` 已回填、`isRendering=true`）为本轮
  新增面，逐项核实——重入由 `hasWaitRendering` 排队兜底（多次 render() 合并重跑）；
  `node_tree_render_end` 仍在整树完成时 emit（插件侧视口恢复零改动）；引擎 12 处
  `renderer.root` 消费点全为交互触发且 root 已回填、部分自带判空；未渲染节点
  （group=null）与性能模式视口外**同构**（既有容忍覆盖：点击落空不崩，拖拽/框选/
  键盘导航正常）；`highlightNode` 的 `isRendering` 跳过语义自洽（登记）。**唯一新增
  守卫**：async 派发前检查 `mindMap.el`（destroy 断链，避免销毁后在游离 DOM 上白跑）。
  ⑤ **边界**：分片序 = 树序（根→子逐步长出），非视口优先；`forceLoadNode`（配置切换
  路径）未接分片（低频，登记）；「UI 不冻结」是机制性结论（主线程最坏阻塞 ≈ 单节点
  渲染 0.2ms），无头探针验证的是总时长与正确性。
  ⑥ **回归**：1578 测试全绿（含 vendor sha256 契约更新）；全部视觉探针；lint；打开
  基准三规模正确性一致（`8c0a6d83…` / 410,276 B）。

- [K77] **打开成本的精确构成：「内容构建」仅 ≈60–110ms（不是 800–950ms）——「构建加速」方向负结论（2026-09-25，性能轮调研）**：
  ① **实验**（`--bench-open` + 新增 `BENCH_VARIANT=no-content` / `BENCH_STOP_AT=start`
  探针）：no-content = `createNodeContent` 返回带尺寸空 span（`cssText` 定 180×60）
  ——变量只有 `buildInlineNodeContent` 的构建与测量。5000 节点实测：full **1137ms**
  vs no-content **924ms** → 构建+测量 ≈ **213ms**；减测量段 ≈100–150ms（K75 独立实测）
  ⇒ **构建段 ≈60–110ms**——与 K75 的 A2 净收益 107ms（= 一遍构建）交叉吻合。
  ② **两个方法论教训**：空元素**必须带尺寸**——无尺寸节点塌缩 ⇒ 树变矮 ⇒ 651 组
  （vs 15 组）挤进视口被装配，差值完全不可归因（首轮实验 +47ms 的假象）；**跨进程
  分段差分（`BENCH_STOP_AT=start` vs end）信噪比不足**——固定开销漂移 ±100–260ms
  淹没段成本（100–200ms 级），full@stop(1401) 反而 > full@end(1137)。变量隔离必须
  走「同口径 end、单变量替换」矩阵。两探针保留（`verify:visual` 脚本内，默认不激活）。
  ③ **构成修正**（推翻 K72 时代的「构建 ≈800–950ms」推算）：打开 1137ms ≈ 构建
  60–110 + 测量 100–150 + **引擎固有 ≈880–980**（5000 × 节点对象构造/getSize/
  事件绑定、布局 4 task、foreignObject/连线、首帧装配；**后经 K78 修正：其中
  ≈174ms 是 initDragHandle 的监听器泛滥，固有余量 ≈710–810ms**）。**大头在
  引擎固有成本**，插件侧不可及；cssText 批量化/cloneNode 模板等手段的上限 =
  构建段的 30–50%（≈20–50ms，打开 -2~4%）——**负 ROI，不投入**。
  ④ **后续若再探**：唯一量级项 = 引擎固有段的「节点对象轻量化 / 布局算法」——
  vendor 上游贡献方向（成本高，见 K76 审计模式）；插件侧打开路径**就此收官**
  （K72 自绘换路径 → K74/K75 测量做薄 → K76 冻结消除 → K77 构成定论）。

- [K78] **vendor 上游贡献首战：拖宽监听器惰性注册——打开 5000 节点再降 13%（-174ms），并修复潜伏泄漏（2026-09-25，性能轮，补丁 7）**：
  ① **发现路径**（「补丁即探针」方法论）：K77 把 ≈880–980ms 归入「引擎固有」后，
  逐个审计 constructor 每节点调用链（`getSize` 已做薄 / `updateGeneralization`
  守卫早退 ≈5–10ms 非热点 / **`initDragHandle`**——补丁 5 ③ 的实例口径门禁让
  5000 自绘节点全部通过，每节点 3 个监听器（window mousemove/mouseup +
  mindMap node_mouseup）= **15000 个**，且全库无解绑）。
  ② **三重代价**：打开期注册实测 ≈174ms（**A/B/B/A 交替对照**：手工回滚基线
  min 1327ms vs 补丁 min 1153ms，哈希双向校验 `8c0a6d83↔1e335f8f`——跨时段
  漂移 ±100–260ms 再次被同批交替消掉，K77 教训的第二次应用）；此后每次鼠标
  移动 10000 个 window 监听器被调用后早退（运行期长尾）；**节点销毁后实例被
  window 监听器永久持有**（每开一次大图 +10000 监听器 + 实例滞留——K65 长会话
  探针测 DOM 增删未覆盖此形态，登记为 vendor 上游 bug 的本仓库修复）。
  ③ **补丁 7**（改动面与机制见 BUILD.md「补丁清单」）：`initDragHandle` 只 bind；
  手柄 `mousedown` 开会话才注册、`mouseup` 收尾（新增
  `unbindDragHandleGlobalEvents`）即解——常态零全局监听；收尾补 `!this.group`
  守卫（会话中节点被删除时安全）。同引用重复 `addEventListener` 浏览器天然去重。
  ④ **回归**：1578 测试（含 sha256 契约 `1e335f8f…` / 410,692 B）/ 全部视觉探针
  （`history` 拖宽全流程、`handle` 手柄显隐覆盖惰性注册路径）/ lint。
  ⑤ **方向定调**：这是「vendor 上游贡献（节点对象轻量化）」的第一个实锤——
  「固有」成本必须逐点审计而非整体放弃；其余固有段（节点构造/布局 4 task/
  foreignObject/装配）尚有 ~700–800ms，逐点审计的边际成本递增，**按需再战**
  （下一个候选：布局 4 task 的 walk 分布与 `getSize` 重复调用分布）。

- [K79] **布局平移的二次复杂度实锤：adjustTopValue 293 万次子树平移 → 延迟物化 O(n)，5000 节点再降 6%（2026-09-25，性能轮，补丁 8/9）**：
  ① **发现**（K78 后的下一个候选：布局 task 的 walk 分布）：新增 `BENCH_VARIANT=
  count-layout` 页内包裹计数探针（零 upstream 改动）——5000 节点逻辑结构图首帧：
  `adjustTopValue` 1 次、`updateBrothers` **2101 次**（含递归）、`updateChildren`
  **平移 292 万节点次**（≈节点数 × 584——同一子树被多级祖先的 updateBrothers
  反复全量平移，``updateChildren`` 为递归子树遍历）。
  ② **短路实验的失败与教训**：`skip-adjust`（页内 patch `adjustTopValue=noop`）
  读数 +570ms 且 DOM 629 组（vs 15）——**几何塌缩污染视口裁剪**，同 K77 空元素
  教训的第三次出现：**后置处理的短路必改几何 ⇒ 短路法不适用于布局**。正确路径 =
  「等价优化本身即探针」（几何正确的补丁，收益即份额）。
  ③ **补丁 8**（字段快路径）：`item[prop] += offset` 走 getter/setter（`customTop
  || _top` 读 + 写 `_top`）；核实 `_top`/`_left` 唯一读点在 getter 内部，「分量
  自定义位置 undefined」时字段直写严格等价——单独收益仅 ≈23ms（V8 访问器内联
  良好）——**排除「访问器是大头」假设**。
  ④ **补丁 9**（延迟物化，量级项）：可延迟性前提逐条核实——difference 判定不读
  top（只读 childrenAreaHeight2/height/margin）、adjustTopValue 同 task 内无外部
  观察者 ⇒ `updateBrothers` 只记账（子树根 + 累计 offset）、末尾自顶向下一次物化
  （O(n)）。**等价性边界**（实施中推演修正）：物化的「继承」在 hasCustomPosition
  截断（对齐原 updateChildren 递归守卫）、「遍历」不截断（记账根可位于自定义位置
  祖先之下）——几何逐字节等价的验证 = `layout` 探针（六布局 × 连线 × 根连线起点）
  + 全部视觉探针 + 1578 测试全绿。
  ⑤ **实测**（同批 A/B）：5000 节点 **1161→1091ms（-70ms / -6%）**；10000 节点
  **2255→1741ms**（含补丁 7 复合）。相对 293 万次的操作量，-70ms 说明**单次
  遍历/回调成本很低**（JIT 友好），二次复杂度在**更大图**才会进一步放大——
  本补丁的真正价值 = 把 O(传播×子树) 降为 **O(n)** 的结构性改善。
  ⑥ **回归**：1578 测试（含 sha256 `ce3bbadd…` / 411,297 B）/ 全部视觉探针 /
  lint；`count-layout` 计数探针常驻供后续布局调研复用。

- [K80] **「outerHTML 镜像序列化」负结论：估算 25–70ms 的候选实测 < 噪声（≈30ms）——已回滚；节点构造段审计收口（2026-09-25，性能轮）**：
  ① **候选**：`measureCustomNodeContentSize` 以 `outerHTML` 作内容寻址 key——预测量
  与正式测量对**同一元素**各序列化一次（5000 节点打开 ≈9500 次「镜像序列化」），
  按 5–15μs/次估算 25–70ms，看似诱人。
  ② **补丁 10（零行为差异版）**：预测量阶段把 key 附着为元素 **JS 属性**
  （`__smmMeasureKey`，不参与 HTML 序列化），正式测量优先取用。正确性前提已核实：
  `addXmlns` 幂等（重复 setAttribute 同值无变化）、元素在「预测量 → 正式测量」
  之间无任何修改路径（MathJax 异步注入是唯一的构建后修改，但它发生在**首次测量
  之后**且无重测机制；本方案不改「测量回写附着」，故「元素修改后重测」的既有
  语义完全不变——当时的保守取舍，事后被证明选对了）。
  ③ **实测与决策**：补丁组 1117/1137/1153ms vs 基线组 1091/1098/1123ms——**两组
  区间完全重叠**（回滚后复测 1131/1191 亦重叠）⇒ 收益 < 组内噪声 ≈30ms，**序列化
  单次成本远低于估算**（~1–2μs，DOM 序列化为 native 快速路径）。**回滚**（哈希
  机械校验 `ce3bbadd` 精确还原）——不为无实测支撑的优化增加代码面。
  ④ **方法论**：本轮第三次「估算被实测否定」（K77 构建段、K79 访问器、K80 序列化）
  ——**微优化的估算必须先过同批 A/B 的噪声检验**；K78 起的「同批交替对照」是唯一
  可信判据（跨时段漂移 ±100–260ms ≫ 噪声 ≫ 多数单项优化收益）。
  ⑤ **节点构造段审计收口**：剩余已知候选（`checkIsInClient` 的 `draw.transform()`
  每节点读取、`createNodeData` 的 `typeList/createTypes` 每节点数组构建、
  `updateGeneralization` 的 removeGeneralization 细节、首帧 renderLine 遍历）
  预估单项均 <30ms——**逐点审计的收益已低于测量噪声**，打开路径的插件侧+vendor
  自有补丁优化**就此收口**（累计：K72 自绘换路径 → K74/K75 测量做薄 → K76 分片
  冻结消除 → K77 构成定论 → K78 监听器 -13% → K79 布局平移 -6% → K80 收口）。
  ⑥ **若未来仍要动**：剩余量级项只在「节点对象构造 / 首帧装配遍历」的**结构性
  重写**（如延迟构造视口外节点——改动引擎核心生命周期，风险等级 = 补丁 9 之上），
  或接入真实时间性能通道（longtask）另立靶点——两者的共同前提是**先有 ≥50ms 的
  可复现单项收益证据**。

- [K94] **性能复核（2026-09-28，批次 3 基准审计；只测量、不断言）**：三条主线读数列为后续对照基线——
  ① **打开**（`--bench-open`，真实墙钟，各规模 2 次取最小）：500 / 5000 / 10000 节点 = **441 / 960 / 1562ms**
  （对照 2026-09-25 性能轮 473 / 1137〔K76〕/ 2255〔K76〕ms；5000 与 10000 降 16% / 31%，跨日期对比仅供趋势参考）；
  测量缓存健康（5000 节点：预测量构建 4750 → 全部写入，正式测量命中 4750 / 未命中 0）；视口裁剪生效
  （DOM `.smm-node`：500 节点图 24、5000/10000 图 15，均 ≪ 总数）。
  ② **编辑帧**（`--perf`，500 节点 / 非性能模式 / 300 次编辑，A/B/B/A 取最小）：**4.0ms/次**（每次 = 一次整树渲染；
  对照 K73 补丁后基线 5.3ms，-25%）。
  ③ **长会话内存**（同轮）：每次编辑堆 +0.1MB；历史满仓 163 条投影 29.6MB ≤ 30.0MB 预算（K66 上限生效）；
  段缓存 LRU 512/512（容量上限内）；DOM 净变化 -0.5 元素/次（无泄漏增长）。
  ④ **复查后复测（同日，批次 2【函数拆分】/批次 4【测试】落地后）**：编辑帧仍 4.0ms/次（与 ② 一致）；
  打开 420–432 / 952–979 / 1540–1760ms——10000 节点首测 1760ms 属**运行间噪声**（复测回落 1540ms），
  跨次波动幅度：500 节点 ±5%、5000 节点 ±3%、10000 节点 ±13%（复测即回归）；**无回归**。
  结论：**无劣化、无需优化**；后续性能轮以此为对照读数（测量通道：`verify:visual --bench-open / --perf`，opt-in 不断言）。

- [K81] **社区目录对照通道：本地工作流已 ⊇ scanner 校验面（探针双向验证，0 实质缺口）；`lint:scanner` 常驻为「防收窄护栏」（2026-09-25，社区目录工作流优化轮）**：
  ① **范围**：以官方 `obsidianmd/obsidian-workflows` v1.0.0 源码（`src/manifest.ts`
  / `repo-checks.ts` / `lint.ts` / `release.ts` / `main.ts`）为**校验面权威定义**，
  逐面审计本仓库工作流。**结论：0 实质缺口，多处更严**——
  · scanner stylelint：`stylelint.config.mjs` 已照抄官方 ruleset + electron 版本
  推导（`minAppVersion 1.13.0 → electron 39`）✓；
  · scanner ESLint：`eslint.config.mts` 已接入 `eslint-plugin-obsidianmd ^0.4.2`
  recommended（比 scanner 固定的 0.4.1 新）+ 项目更严边界，`--max-warnings 0`
  ——**探针双向对照**（同一违规样本两侧跑）：问题集完全一致，scanner 经
  `toWarns` 把 recommended 降级而**本地保持 error**（no-implied-eval /
  no-unsafe-call / rule-custom-message 均为 error），即**本地 ⊇ 且更严**；
  · manifest/versions/readme/license：`check:release`（versions 逐条 semver +
  一致性 + README + License 缺失/非 OSI 分级，见 K109）比 scanner 更严（scanner 的
  semver 违规仅 warning）＋
  `obsidianmd/validate-manifest` / `validate-license` 规则双通道 ✓；
  · release 面：tag 一致性本地**硬失败**（scanner 仅 warning）、attestation
  等价、draft release 额外携带 LICENSE/THIRD-PARTY-NOTICES 与发布说明 ✓。
  ② **交付**：`scripts/scanner-lint.mjs`（`npm run lint:scanner`）——用 scanner
  **固定版本集**（官方 `SCANNER_ESLINT_DEPS`，刻意不用项目 0.4.2）＋**逐字照抄**
  的 `buildScannerEslintConfig(true)` 配置＋**隔离安装**（专属缓存目录，空
  userconfig 隔离开发机 npm 配置，node 直跑 npm/npx CLI 入口；**2026-09-29 K109
  补强**：配置隔离不止 userconfig——子进程 env 亦须净化 `npm_config_allow_scripts`，
  安装目录 `package.json` 声明 `allowScripts: {}`——npm 11.9+ 的 project-scoped
  策略会拒 CLI/env 层来源）实跑——输出
  「假如现在提交社区目录，JS/TS 面会扫出什么」。**定位不是补本地缺的检查**
  （本地已覆盖），而是把对照关系机械化：a) 可直接作发布门禁；b) **防收窄
  护栏**——未来本地配置被无意改窄时「本地绿 + 本通道红」即暴露缺口。
  已接入 `lint.yml`（Node 24 主矩阵）与 `release.yml`（发布门禁）。
  ③ **边界（登记）**：· `vendor/**` 不在对照范围（第三方源码入仓，其 .js 不入
  tsconfig，官方配置的 projectService 会报 78 条 "not found by the project
  service" 解析错误淹没结论）——**若服务端确实扫描 vendored 源码，以服务端
  报告为准**；应对预案：把 `vendor/upstream/` 移出版本库（保留 `vendor/patches/`
  + 文档化 `npm install simple-mind-map@0.14.0-fix.3 --no-save` 拉取流程，
  重打包脚本对 upstream 缺失给出明确报错）；· 官方配置显式声明的
  `obsidianmd/regex-lookbehind` 在 0.4.1/0.4.2 上实测均未触发（探针
  `/(?<=a)b/` 两侧不报）——照抄配置，以服务端为准。
  ④ **附**：审计中确认 scanner ESLint 对本仓库 `src/`（69 文件）扫描 **0 违规
  0 警告**——社区目录的 JS/TS 检查面天然通过；探针（`src/__scanner_probe__.ts`）
  已删除，对照证据即上述双向对照表。
  ⑤ **CI 接入的实证修正（同日，#57/#58 两次红的根因）**：`lint:scanner` 入 CI 后
  24.x 矩阵连续失败（22.x 与 release.yml 均绿）。排除法 + 本地按 CI 同序列复现
  （`npm run test:coverage` → `npm run lint:scanner`）：根因 = **`test:coverage`
  （24.x 独有步骤）生成的 `coverage/lcov-report/*.js`（6 个自带 JS）被 type-aware
  扫描**、报「not found by the project service」；官方 IGNORES 列表**不含
  `coverage`**（官方 CI 流程不先生成它），release.yml 因无 coverage 步骤而幸免，
  本地因从未跑过 coverage 而绿。**修复**：IGNORES 的「本项目特有适配区」补
  `coverage` / `verify-visual-logs`（本地复现序列验证通过）。**同批加固**（防
  同型环境差异）：依赖安装重试 ×3（网络抖动自愈）、Linux npm-cli 路径候选
  （runner 的 `lib/node_modules` 布局）、eslint 由 npx 改为**直连 CLI 入口**
  （消除 npx「项目 node_modules 优先」的解析歧义——本地与 CI 走不同代码路径的
  根源）。**教训**：本地预检的「绿」必须以**与 CI 相同的目录状态**验证（生成物
  目录是第一类差异源，与 K72 的「空元素几何污染」同属「环境不对齐」家族）。

- [K82] **官方模板对照审计：0 缺口（构建配置逐字节同源），开发最佳实践全面满足或超越（2026-09-25，社区目录工作流优化轮续）**：
  ① **范围**：以官方 `obsidianmd/obsidian-sample-plugin`（master，含其 AGENTS.md
  的 18 类最佳实践清单）逐条对照本仓库。**结论：0 缺口**——
  · 构建配置：`esbuild.config.mjs` 与模板**逐字节同源**（banner / external 列表
  / prod 判定 / sourcemap 策略 / treeShaking / minify 全一致），`package.json`
  build 脚本与 `tsconfig.json`（strict + noUncheckedIndexedAccess 等）逐字段
  对齐且多两项（`noImplicitOverride` / `allowJs`）；
  · 工程实践：**不提交构建产物**（`main.js` 在 .gitignore 且未被 git 跟踪）、
  **tags 无 v 前缀**（0.0.5/0.1.0…0.1.3，与「Do not use a leading v」一致）、
  `register*` 守卫 27 处覆盖（外加引擎事件的 `EventBinder` 统一销毁，K36）、
  manifest 全字段（含 `isDesktopOnly: true` 与稳定 id）、`onload` 轻量装配
  （引擎懒创建于视图打开时）；
  · **超越面**：ESLint 版本更新（obsidianmd 0.4.2 vs 模板 0.4.0）+ scanner
  对照通道（K81）；分层架构 + 依赖矩阵机械强制（K50/K51，模板仅「多文件」建议）；
  1578 测试 + 视觉探针 + CI 矩阵（模板仅手动测试）；AGENTS.md 数千行工程记录
  （模板 270 行速查）；`main.ts` 330 行超线但已登记豁免（模板建议「最小化」=
  生命周期编排，实际职责即此）。
  ② **可反向吸收项**：无（模板的全部实践本仓库均已满足）。
  ③ **边界**：本审计为静态对照（文档 + 配置 + 工程文件），未逐条重放模板的
  「Troubleshooting」清单（其条目均为环境类问题，本仓库 CI 与本地构建长期绿）；
  引擎升级与发布流程的对照见 vendor/BUILD.md 与 release.yml。

- [K83] **官方开发者指南规则对照（eslint-plugin-obsidianmd 源码全量）：0 缺口；locale 规则探针实测全为误报，不接入（2026-09-25，社区目录工作流优化轮续）**：
  ① **范围**：以官方 `eslint-plugin`（master，版本 **0.4.2**——与本仓库
  devDependency 同版本，无新规则可升）的**完整规则表（40 条）+ 配置构成**
  （`recommended` / `recommendedWithLocalesEn` 增量块，`lib/index.ts:351-394`）
  逐条对照。
  ② **`recommendedWithLocalesEn` 增量评估（2 条 locale 规则）**：官方文件模式为
  `**/en.json` / `**/en*.ts` / `**/en-*.ts` / `**/en/*.ts` 等——本仓库英文文案在
  **`src/core/i18n.ts`（basename `i18n` 不匹配）**，且规则内部有硬编码文件名判定
  （`isEnglishLocaleModule`，无法经配置绕过）。**探针实测**（把 EN 字典原文复制为
  `src/en-probe.ts` 匹配 `**/en-*.ts`，启用规则 + `allowAutoFix` 跑
  `--fix`）：13 条警告**全部为引用类误报**——键盘键名（`(Tab)`→建议`(tab)`、
  `press F2`→`f2`）、引用 Obsidian 官方设置名/选项显示名（`"Default location for
  new attachments"`、`"Auto"`、`Logical structure`）、数量拼接片段
  （`'node'/'nodes'`）、Markdown 语法占位符（`[links](url)`→建议`URL`）。
  **裁决：不接入、文案不改**（规则无法豁免引用类场景，此即其 warn 级 + 默认
  不自动修的原因）；探针与临时配置已删除。
  ③ **`prefer-active-doc`（官方默认禁用，🚫）评估**：本仓库 5 处「裸 document」
  引用经逐一核对**全部为注释文本或循环变量名**（`for (const document of
  documents)` 的 TFile 命名）——**0 真实违规**；官方亦禁用（标识符名误报），
  不启用。
  ④ **结论**：开发者指南规则面对本仓库 **0 缺口**——`recommended` 全表已启用
  （上轮 scanner 审计已验证 src 69 文件 0 违规），增量规则经探针实测不适用，
  禁用规则无真实违规。与 K81（scanner 校验面）、K82（模板最佳实践面）合流：
  社区目录三线对照（校验 / 实践 / 指南）**全部闭环**。

- [K84] **许可声明合规：`LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md` 必须随 release 资产分发——「插件」不是豁免形态；内联注释实测仅存 1 段，本文件是逐库声明的主载体（2026-09-25，发布合规口径修正）**：
  ① **义务判定（为什么不豁免）**：`main.js` 中约 **72%** 是 vendored 的 MIT / BSD 代码
  （引擎 + svg.js / katex / quill(BSD-3-Clause) / deepmerge / eventemitter3 / xml-js /
  uuid 等）——MIT 要求声明「包含在所有副本或实质性部分中」；BSD-3 要求以 **binary
  form** 再分发时在「随分发提供的文档和/或其他材料」中复现声明。条款触发于「分发了
  副本 / 实质性部分」这一事实（release 下载 / BRAT 自动更新 / 用户 vault 内的
  `main.js` 都是副本），**发布物叫「插件」还是「软件」与判定无关**；Obsidian
  目录/市场不做第三方声明检查 ≠ 无义务（请求权人是各库版权持有人）。
  ② **实测口径（本轮修正）**：`--legal-comments=inline`（`build:vendor` 配方）只保留
  带 `@license` / `@preserve` / `/*!` 标记的注释——`vendor/simple-mind-map.cjs` 与
  `main.js` 中均**仅存 1 段**（svg.js 的 `@license MIT` 横幅），其余依赖均无内联
  声明。故 **`vendor/THIRD-PARTY-NOTICES.md` 是逐库声明的主载体**（§3），内联注释仅
  为补充佐证——**不得因「产物已有内联注释」删减发布资产**。检测覆盖面必须同时用
  `@license` / `@preserve` / `/*!` 三标记（只测 `@license` 会漏判 `/*!` 形态）。
  ③ **机制与落点**：`release.yml` 的 `gh release create` 携带
  `LICENSE vendor/THIRD-PARTY-NOTICES.md`（与 `main.js` / `manifest.json` /
  `styles.css` 并列）；Obsidian 目录解析只读三件套，**多带文件不影响目录校验**。
  本轮同步修正：`THIRD-PARTY-NOTICES.md` §3 与 `BUILD.md` 改实测口径、`release.yml`
  注释（原「0 命中」为 2026-09-17 审计时点口径）、`stylelint.config.mjs` 悬空审计
  文档引用清理。
  ④ **政策边界**：已发布版本的 `docs/release-notes-<tag>.md` 是**历史快照**——时点
  口径与失效引用**不改**（保持发布记录原样）；现行文档/配置内的悬空引用按「移除或
  改指现行记录」处理（范例见 K1：保留引用并标注 `git log --diff-filter=D` 取回路径）。

- [K85] **行内数学渲染的 API 面假设错误（2026-09-27 实机取证修复）：Obsidian 1.13.7 经 `loadMathJax()` 注入的 MathJax 3.2.2 是 CHTML 组件——只有 `tex2chtml` / `tex2chtmlPromise`，没有 `tex2svg`；而 `math-jax.ts` 旧实现唯一调用的就是 `tex2svg`（实机恒为 undefined）→ 产物恒 null → 数学永久停在字面占位 `$…$`，且被「占位即回退」静默吞掉（单测注入假 MathJax 未覆盖该 API 面、verify:visual 无真 MathJax，两处盲区叠加）。**
  ① **取证**（隔离实机实例 + CDP，用户 0.1.4 构建 / Obsidian 1.13.7）：`typeof window.MathJax === 'object'`（v3.2.2）、`typeof MathJax.tex2svg === 'undefined'`、`typeof MathJax.tex2chtml === 'function'`；`tex2chtml('E=mc^2')` 返回 `<mjx-container class="MathJax" jax="CHTML">`（与阅读视图产物同源）；导图三节点 `.mindmap-node-inline-math` 均 `isConnected=true` 且子节点仅 `#text`（字面占位）——同时排除「时序/挂载」假设（曾据性能轮 preMeasure 元素复用推断的 `isConnected` 守卫拦截不成立）。
  ② **修复（两层，实机复验后补齐第二层）**：**第一层（API 面）**——渲染优先级改为 `tex2chtml`（实机通道）→ `tex2svg`（兼容回退）；API 面全缺时 `console.warn` **一次**（模块级去重 `warnRenderApiMissing`），不再静默。**第二层（替换时机）**——引擎「首帧前预测量 + 元素复用」（补丁 5 / A2）在**未挂载**状态下走构建链；MathJax 热加载时 `await loadMathJax()` 立即返回，替换时 `holder.isConnected === false` → 若只尝试一次就放弃，「关闭再打开文件」必现字面（冷加载时因 await 期间元素已挂载而侥幸成功——两条路径都必须正确）。故未连接时产物**入队**（`pendingMath`）、随后帧经 0ms 定时器重试（`schedulePump`/`pumpPending`，预算 30 帧；不用 rAF 因后台/隐藏窗口会被节流），耗尽即放弃（导出快照/离屏克隆的安全回退）。`isConnected` 守卫语义保留（仅决定"立即替换"还是"入队"），`display` 形参通道为 `$$…$$` 支持预留；落点仍是 `math-jax.ts` 单文件，`node-inline-content` 注入面不变，vendor 零改动。
  ③ **回归防线 + 实机证据**：`tests/math-jax.test.ts`（9 例：通道优先级 / 兼容回退 / 返回 null 回退 / 告警去重 / 抛错不上抛 / 未挂载暂不替换且帧预算耗尽后放弃 / **挂载后补替换命中** / loadMathJax 拒绝）+ `verify:visual` 新增 `math` 场景（占位 span 必须落 foreignObject、定界符回填占位文本，锁定「识别 → 占位 → 接管」三段）。实机（隔离实例 CDP，Obsidian 1.13.7）：首次打开 / 关闭重开（原失败路径）/ 编辑重建三条路径均 `.mindmap-node-inline-math` ×3 全部替换、字面残留 0，截图确认节点显示排版后的 `E = mc²`。**断言选择器注意**：产物是 `<mjx-container class="MathJax" jax="CHTML">`——按**标签名** `mjx-container` 查（`.mjx-container` 类选择器恒 0 命中，排查中曾因它误判"未渲染"）。
  ④ **教训**：① 对外部注入对象的方法假设（即便走的是"官方通道"）必须**实机验证**，且"方法缺失"要显式告警——静默回退会把 API 假设错误变成不可见的功能缺失；② **同步构建 + 异步替换**的组合在「先构建、后挂载」路径下必有时序缺口，正确写法是"未就绪就暂存、挂载后再应用"，而不是一次性判断即放弃；③ 排查"没渲染"类问题要同时怀疑**断言工具**（选择器/取数口径）本身。
  ⑤ **同轮扩展（G4，用户确认后落地）：单行 `$$…$$` 渲染为 display（块级）+ `\$` 转义 + 判据单一来源**——① **`MATH_SOURCE` 单一来源**：MARKUP_RE 的数学备选分支与接管判据 `INLINE_MATH_RE` 改为同源构造（`new RegExp(MATH_SOURCE)`），消除「分成两处写会漂移」；**双美元写在单美元之前**（更长定界符优先），`$$E=mc^2$$` 整段命中——修复前它会撕裂成「孤立 `$` + 行内数学 + 孤立 `$`」（注释声称的"按字面"实际不成立）。② **`InlineSegment.display` 标记**决定占位形态（`$…$` / `$$…$$`）与渲染通道（`tex2chtml({ display })`，`renderMath` 注入面加形参透传）；该字段必须经 `pushText` 重建段对象、`trimEdges`、`clampSegments` **全链保留**——首版遗漏 `pushText` 导致 display 丢失（单测红灯即拦下，已补）。③ **`ESCAPABLE_CLASS` 加 `$`**：`\$x\$` 显示字面 `$x$` 不触发数学、`价格 \$5 与 \$6.50 元` 不再残留反斜杠（修复前 `\$` 既不被消费、又会被当作数学定界符误判）。④ **边界**：**多行**块级数学（`$$` 独占行、内容跨行）不匹配、逐行字面——`[^$\n]` 不跨行，且解析层本就按行拆节点（能力缺口，非匹配缺陷）；未纳入本轮。⑤ **实机复验**（隔离实例 CDP）：4 段数学（3 行内 + 1 display）全部替换、`mjx-container[display="true"]` 恰 1、转义组无反斜杠/无 `$` 残留；单测 100 例（node-inline-content 90 + math-jax 10）与全量 1594 例、lint、verify:visual（math 场景含 `$$y^2$$` 三段占位断言）全绿。
  ⑥ **第三层：样式表 + 字体 + 可见性三层保底（2026-09-27 二轮实机，用户「数学段消失」截图为证）**：CHTML 字形由 `<style id="MJX-CHTML-styles">` 的**逐字符规则**承载（`mjx-c.mjx-c1D438.TEX-I::before { content: "E" }` + `font-family: MJXZERO, MJXTEX-I`），**字体数据未就绪时字符宽度为 0**——此时替换产物 = 用户看到的「空白」（既非数学也非字面；用户控制台 22 条 Chromium「Slow network … Fallback font」即 MathJax 字体在慢速加载）。三层保底：① **替换前** `ensureMathFonts()` 显式加载 MJX 字体、带 **2.5s 超时**（超时照常替换，不阻塞打开）；② **替换后 60ms 自检**改判 **宽与高皆 > 0**（旧实现只查宽度，漏掉高为 0 的场景）→ 任一为 0 即**回退字面占位**并告警一次（宁可见的字面，不要看不出原因的空白）；③ **字体就绪自动重试**——回退段登记 `deferredMath`，监听 `document.fonts` 的 `loadingdone` 事件与 `ready` 承诺，字体一就绪即自动换回产物（`retryDeferredMath`；每段只做一轮，仍失败保留可见字面，无重试风暴）。**实机证据**：用户环境诊断 `replaced 24/24`、产物 `49×17`、字体 `MJXTEX / MJXTEX-I / MJXZERO = loaded`、样式表 15380 → 全部可见；隔离实例同字符「字体未加载 0 宽 / 已加载 8×11」（规则与字体族名不变，**唯一变量是字体数据是否就绪**）。**单测**新增 4 例（高度自检 / `loadingdone` 自动换回 / 重试失败保留可见字面 / 字体加载拒绝不阻塞）+ 全量 1603 例绿。
- [K86] **数学渲染的「测量—替换时序」缺口（P4，2026-09-27 实机复验修复）：引擎对自绘内容按「离屏克隆 + getBoundingClientRect」**同步**测量（vendor `measureCustomNodeContentSize`），而 MathJax 替换是**异步**的——首次渲染必然「按字面占位测量」；替换后**没有任何重测机制**，节点尺寸停在占位高度（块级 `$$…$$` 尤甚：实测 655px 内容 / 512px 外框，内容被裁）。**
  ① **修复三件套**：**产物缓存 + 同步复用**（`platform/math-jax.getRenderedMathNode`：`I:`/`B:` + TeX → 产物模板，复用时 `cloneNode`；`node-inline-content.buildMathElement` 命中即**同步**放置产物 → 引擎量到真实宽高；且因不再触发异步替换而**无重排循环**）；**定稿回调 → 合并批量重排**（`renderMathWithMathJax(tex, holder, display, onSettled)`，定稿＝产物保留 **或** 回退字面；holder→回调登记走 **WeakMap**（`settleCallbacks`）以贯穿「立即替换 / 挂载后补替换 / 字体就绪重试」三条路径而不污染各处签名；视图层 `scheduleMathRemeasure` 收集 Set + `window.setTimeout(0)` 合并 → `engine.refreshNodesCustomContent`（逐节点 `reRender(['custom'])` + **恰好一次**全树 `render()`））；**字体分批就绪再同步**（`document.fonts` 的 `loadingdone` 会多次触发——首批测量可能偏小；`view.installMathFontsHook` 每批把登记过的节点再同步一次，随 `register` 注销）。
  ② **实机验收**（隔离实例 + 用户样式表 dump 复现环境 + B1–B7 语料）：24/24 替换、holder 与产物高度全一致、**17 个自绘节点「外框高度 == 内容高度」（溢出节点 0）**（修复前 655/512）；导出 SVG 最大 `foreignObject` 高度 **655**（与屏上一致）+ MathJax 逐字符规则 **24 条**注入 + `@font-face` 已剥离。
  ③ **教训**：**「能渲染」≠「渲染对」**——前几轮的验证断言停留在「元素存在 / 尺寸非零」，而用户一眼看出的是「高度只给一行、内容被裁」。凡涉及**异步替换**的改动，验收断言**必须包含「容器尺寸 ≥ 内容尺寸」**；且**时序缺口要在最初的问题清单里闭环**（P4 早在首份报告列出，却连续多轮未修，最终以用户截图形式回归）。

- [K87] **数学样式就绪的「flush 依赖」缺口（B′，2026-09-27 实测定稿并实施）：CHTML 逐字符规则只在样式表 flush 时写入——不驱动 flush 时产物「非零但塌缩」（`mjx-c` 全 0 宽），「容器宽高 > 0」判据无法识别，会把错误尺寸送进产物缓存与 P4 重排。**
  ① **取证（多探针，本机 + 隔离实例双环境）**：`renderMath` / `finishRenderMath` / `loadMathJax` 均为官方 @public；**flush 前** `14×20` 且 11 个 `mjx-c` 全 0 宽，**flush 后** `130×20` 且全 > 0（高度 114 vs 171 同证）；`finishRenderMath` 单次 ≈**1s**（本机 1006ms / 隔离 981–1046ms 的固定成本，故**只按批调用**）；**只增不减**——S0.5 本机实测（138 规则 / 13 字形规则 / 11461 字节）调用前后零丢失、二次调用幂等，与历史事故源头 `startup.document.updateDocument()`（会把用户 15380 字节样式表重写为 6858 内部快照、抹掉字形）**行为不同**，故弃 `updateDocument`、统一走官方 flush。
  ② **设计（B′：保留 `tex2chtml` 直调 + 自驱 flush 生命周期；`renderMath` 换道经逐字节等价验证后由用户裁决不做）**：**就绪判据**＝产物内**全部 `mjx-c` 宽 > 0**（无 `mjx-c` 退回「宽高皆 > 0」）；渲染后**同步**尝试放置，未就绪则**同一同步块内撤回字面**（浏览器不绘制中间态，消灭「先空白后出现」窗口）并登记待定；**按批合并调度 `finishRenderMath`**（100ms 合并窗口、单飞不并发），完成后放行重试；重试只做「放置与判定」，**产物恒为同一实例**（不重复渲染，无风暴）；预算＝挂载等待 200 泵 × 16ms、规则重试 3 轮（耗尽保留可见字面 + 告警一次）。**移除**旧 `ensureChtmlStyles`（`updateDocument` 路径）与字体就绪 hook（字体为渐进渲染，DOM 到位即随数据到达显形；`ensureMathFonts` 前置等待保留）；**缓存与 `onSettled` 门禁**：仅成功放置后写入/通知——塌缩产物绝不入缓存。
  ③ **验收（隔离实例冷启动 + 视觉 + 导出，全绿）**：冷启动仅开导图（无阅读视图预热）**24/24 就绪、零字面残留、零告警**（修复前此场景必塌缩/空白）；截图确认 `前 $$E=mc^2$$ 后` 渲染为**居中块级公式**、行内 `5x²` / `abcx`、C 组转义按字面（无反斜杠）；导出 data URL 解码后 **74 个 `mjx-container` + 15 条逐字符规则注入 + `@font-face` 零残留**；单测 31 例（math-jax 套件重写）+ 全量 1618 例 / lint 0 警告 / build 全绿。
  ④ **验收教训（本轮探针自身两处缺陷，均已修正）**：① 全局 `querySelectorAll` 取样命中了**隐藏 tab 的旧视图容器**（0×0）→ 误报「全部塌缩」；断言必须限定**可见容器**（`.mindmap-view-container` 宽高 > 0）并核对 `activeLeaf` 归属。② `doExport.export('svg')` 返回 **data URL**，直接正则统计的是 base64 文本 → 必须先解码再断言。

- [K88] **数学尺寸同步的静默失效（2026-09-27 用户复验「首次渲染框小于内容」实机复现修复）：定稿回调闭包捕获的是 vendor **预测量轻量代理对象**（只有 `nodeData`/`getData`，无 `reRender`）——`refreshNodesCustomContent` 的可选链 `reRender?.()` 静默 no-op，节点外框停在字面占位测量值（实测 B 节点 512px 外框 / 655px 内容，29 次回调全部无痕，8s 内永不自愈）。**
  ① **定位链（全部实机取证）**：注入计数器确认 `scheduleMathRemeasure` 被调 29 次（通知链正常）；记录入参形态 = `ctor:"Object"` + keys `[nodeData, mindMap, layerIndex, isGeneralization, customTextWidth, effectiveStyles, getData, style]` —— 与 vendor `preMeasure.js` 的代理对象逐字吻合；`__MEASURE_STATS__: hit 17 / miss 0`（重排若真跑过必有 miss）；手动对 `renderTree → data._node`（真实 MindMapNode，`Base.js: data._node = newNode`）调 `reRender(['custom'])` → **512 → 655 立即修复**（机制有效，喂进去的对象错）。
  ② **修复**：`math-jax` 的定稿回调**改为携带 holder**（`onSettled(holder)`）→ 视图层 `scheduleMathRemeasure(holder)` **批次执行时**经既有 `findNodeByDom` 反查真实 MindMapNode 再重排；字体分批再同步同样只对**已解析的真实节点**执行；解析失败**显式告警一次**（不再静默）。`refreshNodesCustomContent` 对 `reRender` 缺失同样**显式告警**（消灭静默 no-op，K85 ① 教训）。**验收**：冷启动 `clipped: []`、B 节点 655/655、`miss 29`（重排真实发生）。
  ③ **教训**：① **异步回调闭包捕获的对象可能在语义上"过期"**（构建期代理 vs 运行期真实实例）——跨模块传递"谁"时应传递**可反查的锚点**（DOM holder）而非构建期对象；② 「可选链 + 静默跳过」把功能失效变成无痕退化，任何 `?.()` 兜底都要配**首次告警**；③ 尺寸类断言必须包含 **「容器 ≥ 内容」**（K86 已记录，本轮验收首次真正纳入探针）。

- [K89] **块级数学定界符对齐官方阅读视图（2026-09-27 用户 B 组复验修复）：`$$…$$` 内容**可跨行、可含单个 `$`**——开 `$$` 找**最近**的 `$$` 闭合。B3（`$$` 独占行的三行块）/ B4（多行 vmatrix）/ B6（`$$$x$$$` → tex = `$x` + 末尾字面 `$`）三者均由同一条正则修复覆盖。**
  ① **官方基准（隔离实例阅读视图实测）**：B3/B4 → `math-block` + `display="true"`（跨行块级数学）；B6 → display 数学，内容 `$x`（`$` 作普通字符渲染）+ 末尾 `$` 按字面保留——与「开 `$$` 取最近闭合」完全一致。修复即 `MATH_SOURCE` 的 mathBlock 支：`\\$\\$(?!\\s)` → `\\$\\$(?![ \\t])`（允许紧随换行、仍拒绝空格防 `$$ 5` 价签——**其中开侧空格守卫已于 K90 ② 移除，以对齐 Obsidian 宽松口径**）+ 内容 `[^$\\n]*?\\S` → `[\\s\\S]*?\\S[\\s\\S]*?`（允许跨行与内容含 `$`，首尾空白由段流水线 `trimEdges` 裁掉，MathJax 空白不敏感）。
  ② **附带修复：多行围栏代码块**（` ```+ … ``` ` 同长度闭合）新增独立分支，排在内联代码之前——否则跨行块级会让**围栏内的 `$$` 误配对**成数学；同时围栏内容按 `code` 段渲染，更贴近 Obsidian（阅读视图围栏为代码块）。F 组语料经核查无跨行配对风险（节点内仅一个裸 `$$`）。
  ③ **回归**：`node-inline-content.test.ts` 新增/改写 5 例（三行块 / 多行 vmatrix / 三美元两段形态 / 围栏不误配对 / `$$ 5` 价签防护不回归）+ 全量 1623 例 / lint 0 警告 / `verify:visual` 通过；实机（隔离实例冷启动）：B3/B4/B6 全部 display 渲染、围栏为代码、**`clipped: []`**、24/24 就绪。

- [K90] **数学通道两处实证缺陷修复（2026-09-27 用户 LaTeX 样张全量复验）：① 就绪判据对「设计上零宽字符」永久误判——含 `\sin` 一族命名函数的公式 3 轮 flush 重试耗尽后退字面，并误告警「数学产物不可见（字体/样式未就绪）」；② `$$` 开侧空格守卫让 `$$ f(x)=… $$` **整段不进数学通道**，块内 `\\` 还被转义分支吃成单 `\`（字面显示失真，与 MathJax 无关）。**
  ① **A1 取证与修复（就绪判定）**：用户样张 `$\lim_{x\to 0}\frac{\sin x}{x}=1$` 停在字面 + 控制台告警。无头 Chrome + MathJax 3.2.2 CHTML（tex-chtml 组合件，与 `loadMathJax` 注入同版本同输出形态）逐字符取证：**flush 后**该产物唯一零宽字符是 `mjx-c2061`——`\sin x` 之间 MathJax 自动插入的 U+2061 函数应用符，`::before` computed content 为**空串**、设计上恒零宽（对照 `\sin x` 最小编译同现；未 flush 时全字符 content 为 `none`，该差分同时钉住 flush 前后两态）。**修复**：`isProductReady` 内零宽字符按 content 分流——`""` = 显式空内容规则（不可见操作符，U+2062/2063 同理）→ 视为就绪；`none`（规则未落盘）与非空字形规则 → 仍判未就绪（**「塌缩态」检测力不变**，不放行部分塌缩）；判定环境无 `getComputedStyle` 时防御式回退旧口径（单测桩/异常宿主）。
  ② **B1 取证与修复（块级开侧守卫）**：用户样张 cases 节点字面显示为**单 `\`**（源文 `\\`，截图取证）——定性链：mathBlock 开侧 `(?![ \t])` 拒绝空格 → 不命中 → 块内 `\\` 落入 escaped 分支（`ESCAPABLE_CLASS` 含 `\\`）被消费成转义反斜杠。对照取证：同 tex 原样喂 MathJax，flush 后 cases 全部 15 字符宽 > 0（可正常渲染，此前只是从未到达）。**修复**：去掉开侧空格/制表守卫（对齐 Obsidian 宽松口径——`$$ x=1 $$` 照常渲染为公式，用户确认）；闭侧数字排除与内容非空约束保留；行内 `$` 价签口径不变。**边界（2026-09-27 阅读视图实测裁决为「与官方一致」，非缺陷，见 ④）**：单遍扫描器按**最早匹配位置**定优先，行内孤立的 `$` 会与更靠后的反引号内 `$` 配对成数学；样张该行已改写为无歧义形态。
  ③ **回归**：`math-jax.test.ts` 新增 4 例（不可见字符视为就绪 / `none` 仍撤回 / 非空 content 仍撤回 / 无 `getComputedStyle` 回退）+ `node-inline-content.test.ts` 改写「`$$ 5` 价签防护」为「未配对仍字面」并新增 3 例（开侧带空格进 display / 配对优先 + 尾部字面 / cases 全等钉住 `\\` 保真）；全量 **1630 例** / lint 0 警告 / `verify:visual` 通过；样张逐行 tokenizer 审计 26 行（20 数学 + 6 字面）：25 行符合预期，唯一偏差为上述边界行（样张已改写）；部署 vault `main.js` 哈希 `3E5EDA9A…F9E`（待用户实机复验）。
  ④ **配对边界实测与官方逐条比对（2026-09-27 用户执行，阅读视图）**：验证样张 `LaTeX边界验证.md` 8 例（V0 正常公式 / V1 孤立在前+反引号在后 / V2 反引号在前+孤立在后 / V3–V4 价签 / V5 公式+代码+公式 / V6 单个孤立 / V7 纯代码），插件侧分类经 tokenizer 审计先行钉死、用户逐条回填——**8/8 与 Obsidian 阅读视图一致**：V1 官方**同样配成公式**（闭定界符取反引号内 `$`、一个反引号进入 tex，用户截图取证；「删掉括号内反引号 `$` 即恢复字面」）⇒ 单遍扫描器的最早位置优先语义**与官方同口径**；V3/V4 官方亦**全字面** ⇒ 插件行内价签防护（开侧拒空白 + 内容以 `\S` 收尾 + 闭侧拒数字）为**官方口径的实证对齐**，非保守偏离；阅读视图与实时预览无差异。**结论：该边界为官方同款行为，不修。**

- [K91] **节点内代码块轻量渲染 + Obsidian 同款复制（2026-09-28 用户确认方案后实施）：围栏块从「行内码样式」升级为块级盒子（等宽 + `--code-background` + 保留换行/缩进 + 双轴滚动 + 右上角悬停复制按钮，点击复制去围栏/去信息行的代码并短暂 ✓），不做 Prism 高亮（「轻量」裁决）。**
  ① **数据与保真**：fence 段新增 `block: true` 标记（与 `display` 同款「重建段必须保留」纪律）；`splitFenceInfo` **展示时**剥离首行信息行（```` ```js ```` 的 `js`，CommonMark 口径；不改 fence 正则 ⇒ 零回归面）；**prose 连续空格归一化下沉**到 `splitMarkedText` 各 prose 分支（`pushPlain`/标记体），代码与数学段原文保真——此前全文预归一化会把 4 空格缩进压成 1 空格（渲染盒是 pre-wrap，观感直接被毁）；`trimEdges` 对 block 段**只裁边缘空行**（`\n`）、不裁缩进；`needsHiddenSyntax` 增加 fence 判定（`selfDrawPlain` 关闭时纯代码节点也与数学同级强制自绘）。
  ② **样式与导出隐身**：结构/配色全内联（导出保真口径同 CONTENT_STYLES）；复制按钮可见性走**变量间接层**——内联 `opacity: var(--tmm-code-copy-opacity, 0)`，屏上由 styles.css 在 `.tmm-codeblock:hover / :focus-within` 置 1（变量可穿透内联声明，绕开「内联样式压过类规则」的层叠死结，**无需 `!important`**）；导出 SVG 不带 styles.css ⇒ 兜底 0 ⇒ 按钮天然隐身。图标用 mask + `currentColor`（随主题取色，data-URI 不写死颜色）；`CODE_BLOCK_MAX_HEIGHT_PX = 360` 封顶防长块炸版面。
  ③ **交互接线（方案 A）**：构建器保持**零 Obsidian 依赖、零监听**（`buildCodeBlockElement` 只产出 `.tmm-codeblock > button.tmm-code-copy + pre > code`）；点击语义在 `features/node-codeblock.ts` 经引擎 `node_click` 委托（与 view-wikilink 锚点同款，view.ts 同段注册），`resolveCodeCopyTarget` 纯函数解析目标 → 属主窗口 `navigator.clipboard.writeText` → ✓ 反馈 1.2s（重复点击重置计时）。**待实测风险项实测关闭**：verify:visual 合成点击证实 `node_click` 的 `event.target` 就是按钮本体（非锚点元素穿透到真实 target）——委托选择器成立，无需备用方案 B。
  ④ **回归**：`node-inline-content.test.ts` 新增 7 例（block 标记+信息行剥离 / 缩进空行保真 / 行内码空格保真 / 预览口径 / DOM 结构契约 / aria-label 随 lang / 纯代码节点接管）+ `node-codeblock.test.ts` 新增 4 例（解析四态）+ verify:visual 新增 `codeblock` 场景与 inline 探针断言（原文/按钮/变量间接层/点击契约）；全量 **1641 例 / 52 文件** / lint 0 警告 / lint:css 通过 / `verify:visual` 全绿。
  ⑤ **解析层配套修复（md-outline / md-serialize，功能可用的前提，样张全文解析审计发现）**：`classifyLines` 的围栏状态此前**不感知列表项**——项内代码块的**闭合围栏**（缩进 ≤3 仍匹配 `fenceMarker`）被误判为**新围栏的开始**，后续标题/节点被整段吞进代码内容（一个文件里第二个代码块起结构即坏）。修复三件：① 列表项文本以围栏开始时置围栏状态（同行自闭合 ```` ```code``` ```` 除外，`selfClosed` 判定——顺带修掉顶层一行式围栏的同类吞行）；② 围栏闭合后的分隔空行**并入前项 mdRaw**（此前产空文本节点；并入后结束列表区，后续同级项不嵌套、文件空行逐字保留）；③ 序列化器 `nodeLines` 对空续行**不加 restIndent**（缩进空行 = 尾随空格污染文件）。**已知边界**：列表项内代码的深层缩进仍被续行 `trimStart` 归一（序列化器按树深度补 restIndent 的既有设计）——需要缩进保真的代码块用**段落式写法**（无列表标记，mdRaw 逐字）。回归：`md-roundtrip.test.ts` 新增「列表项围栏」2 例（结构不吞 + 往返不动点）；全量 **1643 例**。
  ⑥ **交互对齐 v2（2026-09-28 用户复验反馈：「只能复制第一行 + 不明显」）**：① **复制源改构建期 dataset**——`buildCodeBlockElement` 把段文本写入 `button[data-code]`，`resolveCodeCopyTarget` **优先读 dataset**（缺失才回落 `pre > code` 的 textContent）——点击路径不再依赖 closest/querySelector 的 DOM 链（用户实测「复制到第一行」时渲染层 `<code>` 已实测含完整两行，DOM 读取链是唯一未锁定变量，dataset 从根上消除该类脆弱性）；② **按钮常显**（对齐 Obsidian 阅读视图：复制按钮一直在，悬停增强）——styles.css 基础 `--tmm-code-copy-opacity: 0.55`、hover/聚焦 1（内联兜底 0 = 导出图隐身不变）；③ 原生 `title` 提示（Obsidian 自家 tooltip 在 foreignObject 内不可用，零依赖近似）；④ **端到端复制回归**：verify:visual 桩剪贴板 + 真实视图层处理器（node-codeblock 注册，与生产 view.ts 同入口）——点击按钮后 `writeText` 实参断言 = 完整两行（`const a = 1;\n  echo hi`），复制链路被无头实测锁定。全量 **1645 例**。
  ⑦ **部署勘误（2026-09-28「按钮看不到」根因）**：历次部署只拷 `main.js`、**从未同步 `styles.css`**——vault 内 styles.css 停在 9/14，`.tmm-codeblock { --tmm-code-copy-opacity: 0.55 }` 常显规则整体缺失 ⇒ 按钮内联兜底 0 ⇒ 永不可见（v1 的 hover 显形同样依赖该文件，一并失效）。已同步 styles.css（期间一次凭记忆误写的内容已被仓库真实文件覆盖修复）。**部署口径勘正：`main.js` 与 `styles.css` 两件都必须拷贝 vault 插件目录**；导出保真不受影响（导出图本就不带 styles.css，按钮在导出图里仍隐身）。
  ⑧ **配色校准（2026-09-28 用户截图反馈「图标白色」，两轮）**：第一轮 `--text-faint`→`--text-muted` **实测无效（用户复验仍浅色）** ⇒ 定性：该 CSS 变量在画布 foreignObject 子树内取不到值（未定义时 color 回退到**继承值**=节点文字色，浅色节点文字→观感近白；与两版都是浅色吻合）。第二轮改**兜底方案**：`color: var(--text-muted, #666666) !important`（取到变量=跟随主题；取不到=官方默认灰）+ `.theme-dark` 分支兜底 `#999999`、hover `--text-normal` 兜底 `#1f1f1f/#ececec`；`is-copied` 同步 `!important`（否则被基态压住）；!important 仅限屏显层按钮图标色（导出图不带 styles.css 不受影响）。已部署 vault 并读回验证。**第三轮（用户贴出按钮 DOM 后定性）**：用户按钮 DOM 显示 v2 特征齐全（data-code/title/opacity 变量）且常显生效 ⇒ 其 Obsidian 加载的是 **v2 时代的 styles.css**（图标色仍是旧 `--text-faint`），**后两轮 styles.css 更新从未被重载**（opacity 变量继承正常也排除「变量在画布子树取不到」假说）——问题本质是 styles.css 加载时机不可控。**根治：图标基色内联进构建器**（`CODE_COPY_BUTTON_STYLES` 加 `color: var(--text-muted, #666666)`，内联优先级高于非 !important 类规则 ⇒ 只依赖 main.js 重载；导出不受影响——按钮在导出图本就 opacity 兜底 0 隐身），styles.css 的 color/hover/is-copied 规则保留（新鲜加载时提供 hover 增强与 is-copied 态）；契约测试补 `styleOf(button).color` 断言；部署核验=仓库与 vault 的 main.js 各含内联色串 1 处。**第四轮（用户仍报浅色 ⇒ 外观全内联）**：① 基色变量升级为 `var(--icon-color, var(--text-muted, #666666))`——`--icon-color` 是 Obsidian 原生图标按钮的取色变量，主题可独立于 `--text-muted` 定义（前三轮取错变量层的嫌疑）；② **图标形状/填充全部内联**（`maskImage` data-URI + `backgroundColor: currentColor` 进 `CODE_COPY_BUTTON_STYLES`，类型放宽为 `& Record<string, string>` 容纳 mask 键）⇒ 按钮外观**零 styles.css 依赖**；③ ✓ 反馈态内联直改（`showCopiedFeedback` 快照 `style` 属性原文 → setProperty 撤 mask/底色 + 成功色/字号 → 到点逐字还原），不依赖类规则新鲜度；④ styles.css 的图标类规则**保留未删**（旧版下内联全胜、新版下同意图不打架，删除反而引入大段精确匹配风险）；⑤ 教训记录：本轮一次三连并行编辑因凭记忆拼凑内容几乎污染三个文件（实检仅一处注释乱码，已修）——**多文件联动改动必须逐个「读回→编辑」串行执行**。verify:visual 全绿；部署核验=两边 main.js 各含 `mask-image` 与 `--icon-color` 串 1 处。
  ⑨ **图标 CSS 规则删除 + 导出隐身显式化（2026-09-28 第五轮，用户裁决「删去 styles.css 图标规则，加强内联样式」后选 A 方案）**：① 构建器撤 `opacity: var(--tmm-code-copy-opacity, 0)`——「CSS 变量间接层」退役，屏上**恒显**（默认 1，对齐 Obsidian 原生按钮），补 `borderRadius: '4px'` 内联；② **导出图隐身改显式**：`features/node-codeblock.hideCopyButtonsInExportSvg`（克隆 SVG 内按钮置 opacity 0，形态不符安全 no-op；`NodeListOf` 须 `Array.from`，tsconfig 无 DOM.Iterable）与 `injectMathStylesIntoExportSvg` 组合挂 `handleExportSvg`（engine-controller）——不再依赖「styles.css 缺席」这种隐式机制；③ styles.css 53 行图标规则整块删除（容器 opacity 变量 + 按钮全部类规则 + is-copied），仅留指路注释——本文件不再持有任何按钮规则；④ 契约测试改口径（opacity → undefined + `borderRadius` '4px'）+ 隐藏函数单测 2 例（置 0/原样返回 + 形态不符 no-op）+ verify:visual 探针换 `codeInlineMask`（data-URI 断言）；⑤ 过程教训：第五轮一度凭记忆拼 old_str 且回执不可信而停手——**grep 二次确认后发现删除实际已落盘**，教训固化：任何「记忆 vs 回显」冲突一律以 grep/read 复核为准，绝不凭记忆构造长锚点。构建/1646 测试/verify:visual 全绿；部署核验=vault main.js 含 mask-image、styles.css 规则清零 + 指路注释在。
  ⑩ **lint 存量清零 + 导出链组合根注入（2026-09-28 第六轮，方案 A 经用户确认）**：① 存量违规三类——`obsidianmd/no-static-styles-assignment`（内联样式字面量直赋：`showCopiedFeedback` 6 处 + 导出隐身 `setProperty` 1 处）、`@typescript-eslint/no-deprecated`（`typeof root.querySelectorAll !== 'function'` 方法引用命中 DOM lib 的 deprecated 重载签名）、`no-restricted-imports`（engine-controller 直 import features 违反 K51）。其中 6 处字面量直赋在 0.1.5 提交即存在（疑为 eslint-plugin-obsidianmd 升 0.4.2 后新规则暴露——「全链全绿」的核对须以实际跑 lint 为准）。② 修复（外观**保持 100% 内联**，不改为 CSS 类）：写法改 `Object.assign(el.style, 表)`（`COPIED_FEEDBACK_STYLES` / `HIDDEN_BUTTON_STYLE`）——规则只拦字面量直赋，且 `eslint-comments/no-restricted-disable` 禁止 disable obsidianmd/* 规则，而 Object.assign 是 `node-inline-content` 构建期样式的既有合规写法；查询改直接调用 + try/catch 兜底（勿写方法引用）；导出链改 `EngineControllerDeps.exportSvgTransforms` 由组合根（view.ts）注入 `[injectMathStylesIntoExportSvg, hideCopyButtonsInExportSvg]`，engine-controller 只按序 reduce（services 不再依赖 features）。③ 验证：build / 1646 测试 / lint（`--max-warnings 0` 零输出）/ lint:css / check:dead-code / verify:visual 全绿。④ 附：豁免表补登记 `platform/math-jax.ts`（661）/ `links/links-tree.ts`（437）/ `links/links-resolve.ts`（351），全表行数快照更新为 2026-09-28（该批 20 个超限文件全登记；`node-inline-editor.ts` 随 K92 一并登记，共 21）。
- [K92] **节点内联编辑（2026-09-28 用户确认方案 A 后实施）：自绘（富）节点的双击 / F2 / 右键「编辑文本」不再弹窗，改为节点位置上的覆盖层 textarea 编辑**文件里那一行原文**——不改 vendor（零补丁），交互对齐官方 Canvas（help: Plugins/Canvas「Edit a card」：双击进入、点击外部停止、Esc 停止编辑）。**七项裁决**：① 触发 = 双击 / F2 / 右键「编辑文本」（**单击选中后直接键入不启用**）；② 编辑范围 = 统一原文、无别名分流（`composeNodeContent` 预填 → `applyRawToNode` 提交，与弹窗原文模式同一写回入口；**K108 约束**：该收口 `applyRawNodeContent` 末尾必须调 `view.notifyNodeContentCommitted(node)`——此通道不走引擎命令、不派发 `data_change` / `node_text_edit_change`，缺调用会让「中心主题改名文件」与「混排双链自动拆分」静默失效）；③ `Escape` = **「停止并保留」（＝提交，对齐官方措辞；与弹窗的 Esc=取消有意不同）**；④ 点击编辑器外 = 提交（document mousedown capture；另对齐引擎：画布滚轮 `mousewheel` 也提交）；⑤ `Shift+Enter` = 换行（`Enter` / `Mod+Enter` / `Tab` 提交；IME 组合态短路，中文选词回车不误提交）；⑥ 弹窗保留为**备选入口**（右键「在弹窗中编辑」→ `editNodeTextInModal`：别名模式与实时预览仍只在弹窗）；⑦ 不新增设置项。**实现**（`features/node-inline-editor.ts`，364 行已登记豁免）：`Object.assign(el.style, 表)` 全内联样式（同 K91 ⑩ 合规口径）、`doc.body.createEl`（prefer-create-el）、会话按**引擎实例**登记（WeakMap：多视图独立；重复打开先提交，对齐引擎 `show()`）、`scale` / `node_tree_render_end` 重定位（节点不在树 → 提交关闭）、**会话所属引擎守卫**（引擎重建的残留会话不写回）、视图 `onClose` 与**引擎重建前**（view.ts 三处）主动提交——用户输入不丢。**统一编辑态判据 `isAnyNodeEditing`**（引擎编辑框 ∨ 内联）替换 F2/Delete 守卫、自动拆分检查、标题重命名的 `isEditingText` 调用点（`engine-controller.isEditingText` 保留引擎语义）。回归：`tests/node-inline-editor.test.ts`（14 例：按键表 / 会话生命周期 / 重建守卫 / 重复打开）、`tests/view-hotkeys.test.ts`（自绘→内联、纯链接→内联、编辑中吞键 3 例改写）、`tests/view-context-menu.test.ts`（条目序列 + 备选入口点击）。**取代 K53 ③ / K54 中「富节点 → 弹窗」的入口描述**（弹窗机制与两种模式本身仍有效，仅入口降级为备选）。
- [K93] **新建节点「空文本 + 立即编辑」与空列表项解析口径（2026-09-28 方案 B 经用户确认）**：① **交互**——所有新建节点入口（引擎 `Tab`/`Enter`、工具栏/右键「添加子/同级」、双击画布空白与空白右键「新建节点」）的初始文本改为**空**（此前为 i18n「节点」/「子节点」/「新建节点」占位文字），并**立即进入引擎编辑框**（新建即可直接输入，无需先删占位文字）。实现：`engine/mindmap.createMindMap` 的两个 `defaultInsert*NodeText` 选项置空串；`view-common.insertChildNodeWithData` 新增 `options.openEdit`（缺省 false）——**新建路径**传 true，引擎走 `inserting` 路径（渲染后**强制激活**新节点并 emit `node_dblclick(..., isInserting=true)` → 编辑框）；拖入/粘贴/拆分/Alt 拖复制等路径保持 false（不抢激活、不打断当前操作）。② **解析口径**——空列表项（`- `）**保留为空 list 节点**（此前退化为显示 `-` 的 plain 段落，即 K55 注释所称「脏数据」）。判据必须用 **trimEnd 前的 rawLine**（`classifyLines` 早先把行尾空白 trim 掉，`line` 里的 `- ` 只剩裸 `-`、不满足 `LIST_RE`；**裸 `-` 仍落 plain**，与 CommonMark「marker 后无空白不是列表项」一致），序列化按 marker + 空内容输出 `- ` ⇒ **往返不动点**、`-` 脏节点消失。③ 回归：`tests/md-roundtrip.test.ts`（空列表项保留 / 裸 `-` 落 plain / 两趟不动点）、`tests/md-roundtrip-property.test.ts`（生成器空间不变：空项仍钉 0 层缩进；P1 不动点保持）、`docs/markdown-mindmap-standard.md` §3.6 白名单 #6 与映射表同步。④ 附带清理：i18n `default.secondLevel` / `default.belowSecondLevel` 删除（成死键）；`menu.newNode` 仍用于菜单标题。⑤ 边界：空节点由引擎渲染为空框（2026-09-28 实测 30×31px——内容仅零宽占位字符 `\ufeff`，尺寸由节点内边距与一行行高撑出）、图内可见可点可双击编辑、可持久化（`- `）；K55 的「删空叶子即摘除」行为保留（删除流程仍不留空节点，零残留口径不变）。

- [K95] **导图内链接呈现口径（2026-09-28 用户实测确立）：自绘（富）节点内链接一律以「主题链接色的超链接字体」呈现、无图标；URL 显示为地址文本而非图标。**
  ① **自绘节点**（绝大多数含文字节点）：`node-inline-content` 的 `INTERNAL_LINK_STYLES`（`--link-color`，默认蓝色系）/ `EXTERNAL_LINK_STYLES`（`--link-external-color`）渲染 `<a>` 文本锚点、`textDecoration: none`；未解析目标用 `--link-unresolved-color` + 半透明（`is-unresolved` 类名契约不变）。
  ② **URL 不做 icon-only（渲染层）**：`linkSegmentOf` 把 autolink / bareUrl / mdLink 一律还原为**可点文本**（URL 显示为地址）——与**解析层** `buildInlineData` 的 icon-only（URL 不进 `data.text`）**并存不矛盾**：前者是渲染口径、后者是数据口径（与 K54 的「渲染器口径」同源，指同一事实的前后两处记录）。
  ③ **图标体系只在未接管节点**：文档页图标（`mindmap.ts` createNodePrefixContent）/ 回形针（attachmentUrl）/ 引擎链接图标（hyperlink）——自绘节点整体跳过引擎 icon/prefix/hyperlink 渲染（K53 ②）；两处图标映射注释已补分层说明（`view-node-actions` 的 mdWikiLinkpath 注释 / `md-outline` 的 wiki 分支注释）。
  ④ **文档同步**：vault 验收样张「三、链接」组按本口径改写（原「文档页图标 / 回形针图标 / URL icon-only」表述订正为「蓝色超链接字体、无图标、URL 显示为地址」，并新增「未解析链接」观察项）。
  ⑤ 回归：`tests/node-inline-content.test.ts`（锚点样式与显示名）、`tests/view-wikilink.test.ts`（锚点分流与修饰键表）。

- [K96] **修复「图片尺寸校正从未生效」：匹配改双通道（身份 + uid）+ 回灌改「root 未就绪不消费 + 首帧补灌」（2026-09-28，用户截图实测发现）**
  ① **症状**：含图节点外框全部停在默认 200×120——图片在框内等比留白（`preserveAspectRatio="meet"`，不变形），但**宽度不随图片原始比例变化**（实测附件：左/右栏顶部排列 300×60 应 600×120、主题色 350×377 应 111×120，实际同为 200×120 框）。
  ② **根因（两缺陷叠加，探针实测分离）**：**(a) 主因——匹配通道失效**：回灌按**对象身份**匹配（`node.getData() === correction.data`），但真实引擎对树 data 做**包装/拷贝**——verify 探针实测 `identitySame=false`（引擎节点 data ≠ 树 data），身份永远落空 ⇒ 校正写入 0 条 ⇒ 图片从未按比例。**单测用桩掩盖**（桩的 `getData()` 直接返回传入对象）；此前主组探针又用「引擎自己的 data」回灌（自匹配）同样掩盖。**(b) 次因——时序竞态**：`view.applyPendingImageCorrections` 原实现「先清空 pending 再回灌」，而 `onEngineReady` 时首帧渲染未完成（`renderer.root` 为 null，实测 `preReadyApplied=0`）→ 即便匹配修好，这批 pending 也会永久丢失且无重试。
  ③ **修复**：① `engine/mindmap.ts` 的 `applyImageSizeCorrectionsToEngine` 改**双通道**——对象身份优先、**uid 回退**（`data.uid === correction.data.uid`，非空才用；uid 在回灌时必然已分配，`ensureUniqueUids` 在引擎创建前同步跑完），两通道都要过 `image` 地址守卫；② `src/features/view.ts` 两处——`applyPendingImageCorrections` 加 `getRenderRoot` 就绪判定（**未就绪不消费**、保留 pending），`onEngineReady` 挂 `node_tree_render_end`（首帧渲染完成）幂等监听补灌；三条触发路径（探测 `.then` / 引擎就绪 / 首帧渲染完成）互补。
  ④ **验证**：`verify:visual` image 探针——主组改用**树 data**（生产同款）必须命中 1 条（uid 通道生效），端到端链路实证 `preApplied=0 → onReadyApplied=1 → 终值宽=120`，并记录 `身份同一=false / uid同一=true` 两个事实；`engine-image-size.test.ts` 补 3 例（包装数据按 uid 命中 / uid 命中仍过 image 守卫 / 双通道均落空丢弃）→ 55 文件 **1691** 用例 + lint 全绿；已部署 vault 并双哈希核对。
  ⑤ **不变式**：自动校正仍**不回写文件**（`mdImageAutoSize` 标记）；官方参数 `![[图|300]]` 的优先级与语义不变；`ensureDefaultImageSizes` 先填默认尺寸的引擎硬要求不变（`getImgShowSize` 对缺失 imageSize 直接抛错）。**教训**：桩测试会掩盖「引擎是否持同一 data」这类**跨边界集成事实**——跨结构边界（我方树 ↔ 引擎内部）的契约必须用**真实引擎探针**验证，不能只靠单测。
  ⑥ **后续**：K97（同日用户两轮澄清定稿）把未设置尺寸的图从「按比例自适应」改为「**按图片原始大小展示**」；K96 的两个修复（uid 双通道、首帧补灌）与 `ensureDefaultImageSizes` 全部保留。

- [K97] **图片尺寸口径（用户裁决终版）：未设置尺寸＝按图片原始大小展示，设置尺寸＝按参数展示（2026-09-28，两轮澄清后定稿）**
  ① **口径**（**最终语义，勿再改**）：**未设置尺寸的图（`![[图]]`）按图片自身原始大小（1:1 自然尺寸）展示**——多大就多大，不统一高度、不比例缩放；**长边超过 `IMAGE_MAX_SIDE_PX`（480px）时等比缩小**（只缩不放：一张 2000px 截图否则会把画布版面压扁——节点是空间对象，与 `CODE_BLOCK_MAX_HEIGHT_PX` 同一理由）；**设置了官方尺寸参数**（`![[图|300]]` / `![[图|300x150]]` / `![alt|300](url)`）则按参数展示（仅宽时探测原始比例补高），**显式参数不受 480 上限约束**（用户意图优先，写 `|2000` 也照做）；**插入/拖入的图片等同未设置尺寸**（走自然尺寸路径、同上限）。探测失败（外链图离线等）→ 保持/回退默认盒 200×120（`custom:false`，引擎按 imgMax 约束、框内等比留白）。
  ② **澄清过程**（防误改）：K96 修复让「高度统一 120、宽度按比例」的自适应首次生效（300×60 → 600×120 / 350×377 → 111×120）；用户先表述为「未设置按默认大小」→ 曾被实现为**统一 200×120**（错解），用户再澄清「按图片大小加载」＝**图片原始大小**；第三轮敲定长边 **480px** 封顶（推荐值：默认盒宽 200 的 2.4 倍 ≈ Obsidian 分栏半宽；用户既有样张 300×60、350×377 均不受影响）。三轮差异要记牢：**不是**统一盒、**不是**统一高度比例，而是**自然尺寸 1:1 + 长边封顶**。
  ③ **实现**：`core/constants.IMAGE_MAX_SIDE_PX = 480` + `media/images-path.fitImageWithinMaxSide(w,h)`（纯函数：长边超限时等比收窄、只缩不放、最小 1px）——两条自然尺寸路径共用（`collectImageSizeCorrections` 无参数分支、`createNaturalSizeSetNodeImageOptions`）。`collectImageSizeCorrections` 无参数分支＝探测自然尺寸 → 套上限 → `{width, height, custom:true}` + `autoSize:true`（写树标 `mdImageAutoSize` → 序列化**跳过回写**：显示口径不写文件）；已有 `imageSize.custom`（用户拖宽）不覆盖；参数分支不变（不经 `fitImageWithinMaxSide`、`autoSize:false`）。`walkImageSizeCorrections`（去 Aspect 命名）；`computeAspectImageSize` 已删。`mindmap-theme.ts` 的 `imgMaxWidth/imgMaxHeight`（=200×120）**保留**：只约束 `custom:false` 兜底路径（首帧/探测失败），`getImgShowSize` 对 `custom:false` 必然读取、删之行为未定义（注释已写明防误删）。K96 的两个修复（uid 双通道回灌、首帧补灌）与 `ensureDefaultImageSizes`（首帧兜底）全部保留。
  ④ **不变式**：自然尺寸（含 480 封顶后的尺寸）是**显示口径**、绝不回写（`mdImageAutoSize` 标记）；**插入/拖入**与**用户拖拽调宽**属用户意图、照旧回写 `|宽度`；**显式尺寸参数不受 480 上限约束**。
  ⑤ **验证**：`tests/images-path.test.ts` **47** 例（`fitImageWithinMaxSide` 5 例含「用户样张 300×60 / 350×377 不受影响」与极端比例、自然尺寸校正+自动标记、超长边缩到 480、显式参数 2000 不受限、参数路径各形态、并发与缓存、失败回退）；全量用例 + lint + verify:visual 全绿；已部署 vault 并双哈希核对。

- [K98] **新建节点按层级回写为 Markdown 标题（用户需求：「严格回写前六级子节点为六级标题」，2026-09-28）**
  ① **需求与背景**：解析侧 `#`~`######` ⇄ 第 1~6 层节点（既有，见 md-outline 文件头）；回写侧此前**未标注（新建）节点一律写 `-` 列表项**——用户在导图里画出的层级结构保存后会「塌成一层列表」。现改为**按层级回写**：第 1~6 层 → `#`~`######`（与解析侧严格对称）；第 7 层起 → 列表（缩进降级法，Markdown 只有 6 级标题）。
  ② **边界（保护既有语义，三条）**：**已有 mdType 的节点按其原类型回写**（列表内容不会被强行改成标题——「无损回写」底线）；**列表/段落上下文中的新建节点仍写列表**（标题写进列表或段落中间会撕裂文档结构）；**显式选了列表标记（mdMarker）的新节点**尊重用户选择、同样走列表。
  ③ **实现**（`markdown/md-serialize.ts`）：`SerializeFrame` 增 `headingLevel: number | null`（`0` = 根、`1..6` = 当前标题级别、`null` = 不可标题化）；heading 分支传 `level < 6 ? level : null`、plain/list 分支传 `null`；新增分支「未标注 + 无 mdMarker + `headingLevel !== null`」→ `pushBlock('#'.repeat(level + 1) + ' ')`（6 级之下自然落入列表分支）。空标题往返由「前缀携带尾随空格」保证（`## ` → 空 heading 节点、不动点）。
  ④ **连带修复**：`markdown/links-split.ts` 的 `buildChildren` 显式标 `mdType:'list'` + `mdMarker:'-'`——拆出的链接子节点语义是「其下的列表项」，不标则会在标题上下文被 K98 升级成下一级标题（把「说明 + 链接」的父子关系写成标题并列）。
  ⑤ **验证**：`md-roundtrip.test.ts` 更新/新增 6 例（层级严格递进 `#`→`##`→`###`→`####`；边界＝6 级之下与列表内回落列表；空节点闭环；URL/双链合成；**纯标题兄弟→标题**、**含列表兄弟→跟随列表**、**纯列表文档不冒标题**）；`save-pipeline.test.ts` 约 20 处期望更新（`- A` → `# A`、根的直接子 → `#`、其子 → `##`）；全量 55 文件 **1700** 用例 + lint 全绿。
  ⑥ **补充（用户批准的设计改进，同日）**：**新建节点跟随兄弟风格**——同层存在**列表型兄弟**（`mdType:'list'`，或未标注但选了列表标记）时写列表；否则按层级写标题。动机：**纯列表文档**（无标题、通篇列表）里新建原本会冒出 `# 一级标题`、与既有风格违和；补充后这类文档新建 → 继续列表，标题树里新建 → 照旧 `#`/`##`（K98 主规则不变）。实现：`siblingsFollowList(frame.children)` 加进标题分支条件（当前待写节点自身不命中判定——无 mdMarker，无需排除）。

- [K99] **修复「导出 PNG 部分节点内容被裁」：导出 SVG 注入 Obsidian CSS 变量（2026-09-28，用户截图实测）**
  ① **症状**：导出 PNG 中**多行文字节点第二行被切半**、LaTeX 节点文字不全；屏上渲染正常。
  ② **根因**：自绘节点内容用文档级 CSS 变量定字体（`var(--font-interface, sans-serif)` / `--font-monospace` / `--code-background` / 链接三态色等，`node-inline-content.ts` CONTENT_STYLES 为唯一来源）；**导出时克隆 SVG 处于独立渲染环境（data URL → img），文档级样式表不在其中 → 变量未定义 → 回退内联兜底值 `sans-serif`**——字体度量与屏上不同 → 换行点漂移、行高变化 → 内容超出 foreignObject 固定高度被裁。
  ③ **修复**（新文件 `platform/export-css-vars.ts`）：`injectObsidianCssVarsIntoExportSvg`——导出时从 `getComputedStyle(document.body)` 取**宿主实际生效值**（白名单 15 个：字体三件 / mono / code 背景+正文 / 链接四态 + accent / text-normal/muted/highlight-bg/icon-color），以 `<style>svg { --x: y; }</style>` 注入克隆 SVG 根（自定义属性沿后代继承，foreignObject 内 HTML 生效）；空值跳过、全部为空/环境不可用/形态不符时安全 no-op。与 `injectMathStylesIntoExportSvg` 同模式（只改克隆 SVG），接入组合根 `exportSvgTransforms` 链首。
  ④ **验证**：`tests/view-export.test.ts` +6 例（注入格式/空白跳过/全空 no-op/环境不可用/形态不符矩阵）；全量 55 文件 **1705** 用例；lint 0 警告。
  ⑤ **安全加固（2026-09-28 复核发现并修复）**：变量值来自**宿主主题**（用户可安装第三方主题与 CSS 片段，内容不受控），原实现把 `getPropertyValue` 的值**原样拼进** `svg { … }` → 形如 `Inter} svg{opacity:0` 的值会**闭合规则块并注入任意 CSS 规则**，篡改导出图（内容隐藏/错位）。`textContent` 不会被解析为 HTML，故**无脚本执行面**，但样式注入成立。修复：新增 `SAFE_CSS_VALUE` 字符白名单（放行 `[\w\s#'"(),.:/%!-]`，拒绝 `{}<>;` 等），不合法则**跳过该变量**（回退内联兜底值、导出仍可用）；`tests/view-export.test.ts` +1 例（含 `}` 闭合与 `<script>` 两种可疑值均被丢弃、安全值照常注入）。

- [K100] **修复「含公式节点外框与内容不符」：数学重排回退到「按产物元素反查节点」（2026-09-28，用户控制台告警 `flushMathRemeasure` 定位失败）**
  ① **症状**：含行内 `$…$` / 单行 `$$…$$` 公式的节点**外框与内容不符**（用户实测：自动整理后才恢复）；控制台告警「数学节点尺寸同步未命中归属节点，内容可能被裁剪」（`flushMathRemeasure`）。
  ② **根因**：重排只按**占位 holder** 反查节点（`findNodeByDom`）；而「替换定稿 → 批量重排」之间隔着 `setTimeout(0)`，**该窗口内引擎若发生全树重渲染**（典型即 **K96 图片尺寸回灌的补灌 `render()`**，含图文档首帧后必然发生）→ 节点 DOM 重建 → **旧 holder 随重建被丢弃** → 反查落空 → 跳过并告警 → 这些节点的尺寸停留在「字面期」测量。（内容是对的——重建时缓存命中、产物同步放——但尺寸不是，故表现为框与内容不符；字体钩子也因此一并失效。）
  ③ **修复**：① `engine/mindmap.ts` 新增 `findNodesByMathProducts(mindMap)`——从渲染树根节点的 group 上溯所属 `<svg>`（天然限定本视图、不受同页其它导图干扰），一次查询全部 `.mjx-container`（**MathJax 产物就在活 DOM 里**，占位 holder 不在），逐个 `findNodeByDom` 归一去重；② `features/view.ts` 的 `flushMathRemeasure`：holder 解析失败时改用该回退重测，**仅当回退也未命中**才保留一次性告警（避免静默退化，K85 教训）。
  ④ **验证**：`tests/engine-image-size.test.ts` 新增 3 例（产物反查命中并去重 / 产物已脱离任何 group → 空 / 渲染根缺失与无 svg 祖先 → 安全空）；全量 55 文件 **1708** 用例 + lint + `verify:visual` 全绿。
  ⑤ **不变式**：数学三态链路与「禁止全树重排」（K88）语义不变；回退命中的节点同样写入 `mathRemeasureNodes`，故字体分批就绪时 `remeasureSettledMathNodes` 仍会二次修正（K87 的 3 次上限不变）。**教训**：以「可重建的 DOM 元素」作长周期定位锚点是脆弱的——跨 `setTimeout` 的编排要锚定**不会随重建失效的对象**（此处：产物元素 / 节点本身）。
  ⑥ **生命周期加固（同日复核）**：`mathRemeasureNodes` 此前**只增不减**（4 处引用全为定义/添加/读取）→ 引擎重建（换文件/设置刷新/文档模式切换）后旧节点被长期持有（**内存累积**），且字体钩子会对**已销毁**节点调重测。修复：在 `onEngineReady`（引擎新建即换新）、`onUnloadFile`、`onClose` 三处 `clear()`（只清集合、不触发任何重排，K88 约束不变）。另：`flushMathRemeasure` 增加「`this.mindMap` 已空则静默返回」早退——批量窗口（`setTimeout`）内视图可能已关闭，否则会走回退并对空引擎打**误导告警**。相邻项已复核无需改：`refreshNodesCustomContent` 已具 null/空数组/`reRender` 缺失/异常四重防护；导出 Blob 已 `revokeObjectURL`（延迟回收）；图片尺寸缓存已有 LRU 上限（失败 200 / 落盘 1000）+ TTL + 磁盘值正整数校验。
  ⑦ **资源回收加固（同日第二轮）**：`probeImageNaturalSize` 的**失败/超时路径增加中止在途下载**（`img.removeAttribute('src')`）——此前结算后浏览器仍会把整张大图拉完，白占带宽与内存（图片多/外链大图时明显）。用 `removeAttribute` 而非 `src=''`：后者在部分浏览器会以**当前页面 URL 再发一次请求**，反成额外开销；成功路径不动（已解码完成）。回归：`tests/images-path.test.ts` +2 例（失败须移除 src / 成功须保留），桩 `FakeImage` 补 `removeAttribute` 面。同轮已复核**无需改**：数学产物模板缓存已有上限 200 + FIFO 淘汰；导出文件名取自 `TFile.basename`（Obsidian 保证合法），无路径穿越面；探测结果 `.then` 已有文件代际校验（`loadingFilePath !== file.path` 即丢弃，旧文件尺寸不会灌进新引擎）。
  ⑧ **异常逃逸防护（同日第三轮）**：`EngineController.refresh()`（设置变更 → 重建引擎）原**无异常保护**，`structuredClone` 遇不可克隆值抛 `DataCloneError` 会逃逸出设置应用路径（中断后续键的应用）。现按 `initMindMap` 既有风格包 try/catch：记录错误并**保留现有引擎可用**（重建失败远好过中断设置应用）；`initMindMap` 自身失败仍由它内部销毁 + 提示，外层不重复兜底。同轮已复核**无需改**：`walkTree` 与 `parseMdOutline` 均为**迭代实现**（显式栈 headingStack/listStack），深嵌套无爆栈面；整树拷贝走原生 `structuredClone`（非 JS 递归）；节点级拷贝（`copyNode` / `cloneNodeData`）只拷节点 data、不含子树，无深递归面。
  ⑨ **第四轮审计：四处候选面已达标，未做改动（避免为凑数引入回归）**——① `exportScale` / `performanceThreshold` 均经 `pickClampedInt` 边界校验（手改 `data.json` 的极大值不会导致导出 OOM）；② `SavePipeline.save()` 已有 try/catch + `finally` 复位 + 删除守卫（`getFileByPath` 存在性检查，防「删除后重建」）+ 无差异跳过 + frontmatter **以磁盘当前内容为准**（不抹外部属性改动）+ 失败立即复位排空状态（不沿错误链续写）；③ `FileLookupIndexService` 以 `cache = null` 整体失效（无逐条残留、可被 GC 回收），配库事件失效 + 数量比对自愈 + 500ms 节流，`encodeURIComponent`/`getResourcePath` 各有 try；④ 深嵌套无爆栈面（见 ⑧）。**已知但不改的权衡**：`writeFileEntries` 为每文件按路径段数写多个后缀键（兼容历史/绝对路径形态），深目录库下索引条目 = 文件数 × 平均深度——加段数上限会破坏路径后缀兼容，故维持现状、在此备案。

- [K101] **自绘节点外链 `href` 协议白名单（防御纵深，2026-09-28 第五轮加固发现）**
  ① **发现**：`node-inline-content` 生成外部锚点时把**链接原文直接写进 `<a href>`**，未做协议过滤；节点文本来自 Markdown，可写 `[点我](javascript:…)`。Obsidian 运行在 Electron 上，`javascript:` / `data:` 一旦被宿主按链接打开（中键、右键新标签、Obsidian 外链委托）即成**脚本执行面**。
  ② **风险实测修正**：不带 `//` 的 `javascript:alert(1)` 会被 `tokenizeInline` 判为**库内** linkpath（走 internal 分支，只写 `data-href`、**本就不写 href**）——故常规形态本已安全；**真正的 external 分支只收 `scheme://` 形态**（`isSchemeUrl`），风险面比初判小，但 `javascript://…` 确实会走进来（已实测确认，用例即据此构造）。
  ③ **修复**：`domain/url.isSafeAnchorHref`（安全协议白名单 http/https/mailto/ftp(s)/obsidian/file；无 scheme 的相对地址与库内路径放行；大小写不敏感，`data:` / `vbscript:` 一律拒绝）；`node-inline-content` 的 external 分支经它守卫——非安全协议**仍按外链样式呈现、只是不设 `href`**（点击走 `data-href` 分流，插件侧 `isHttpUrl` / `isHyperlinkProtocolUrl` 已有过滤，功能不受影响；本项是第二道闸）。
  ④ **验证**：`tests/url.test.ts` +3 例（安全协议放行含大小写 / `javascript:`·`JavaScript:`·前导空白·`data:`·`vbscript:` 拒绝 / 无 scheme 放行）；`tests/node-inline-content.test.ts` +1 例端到端（`[点我](javascript://alert(1))` 确为 external-link 且无 href）；全量 55 文件 **1716** 用例 + lint + knip 全绿。
  ⑤ **教训**：评审「用户输入 → DOM 属性」链路时，**先看解析分类再判断注入面**——本案 `javascript:` 无 `//` 反而被判库内（初判风险偏高），但**边界形态 `scheme://` 确实可达**，防御纵深仍值得加；用例必须按**实际可达的分类**构造，否则会写出断言错误形态的假用例（本轮首个版本即因此失败）。

- [K102] **同文件多 leaf 互斥（P0 加固，2026-09-28 多轮健壮性审计产出）**
  ① **缺口**：同一 `.mindmap.md` 可被多个 leaf 打开（Obsidian 允许同文件多标签：Ctrl+点击新开、重启后布局恢复），而每个 MindMapView 持有**独立引擎 + 独立 SavePipeline** → 两实例的防抖保存交错时**后写覆盖先写**（丢编辑），且各自的挂起状态（图片回灌、数学重排）互相不知道对方。
  ② **实现**：`view.ts` 的 `onLoadFile` 开头做互斥——扫描 `getLeavesOfType(VIEW_TYPE)` 中同路径既有实例（判定用 `other.loadingFilePath ?? other.file?.path`，覆盖对方仍在装载中的窗口），命中则：`Notice`（新键 `common.mindMapAlreadyOpen`，中英）+ `revealLeaf` 激活既有 leaf + **本 leaf 延迟 `detach()`**（onLoadFile 内同步 detach 会与 Obsidian 装载流程竞争，故 `setTimeout(0)` 且 try/catch 兜底）。
  ③ **空实例安全性**：跳过初始化即被摘除的 leaf，其 `onClose` 各步均有空守卫——`getDataSnapshot()` 返回 `?? null`、`persistViewport()` 双条件（`file && mindMap?.view`）、`destroyInstance()` 幂等、`savePipeline.save()` 对无文件直接返回。
  ④ **验证**：build / lint / 全量 1716 用例 / `verify:visual` 全绿；**多 leaf 场景需实机复验**——双标签打开同一文件应提示并切换到既有标签、DevTools 中不出现第二个引擎实例。
  ⑤ **教训**：文件视图类插件的「全局唯一资源」（此处=文件写权限）必须在**装载入口**做实例互斥，不能依赖用户不这么操作；`FileView` 生命周期里 detach 必须**异步**且带兜底。

- [K103] **保存管线两项 P1 加固（2026-09-28 多轮健壮性方案落地）**
  ① **P1a 外部改动检测**：自动保存写盘前比对「磁盘当前内容（`cachedRead`）」与「上次写盘基线（`lastWritten`，按路径）」——不一致即文件被外部修改（同步盘/其它窗口/手动编辑），自动保存**绝不覆盖他人改动**：跳过本轮写盘（同失败路径复位），每路径**只提示一次**（`externalConflictNotified`，防告警疲劳）；**显式保存（命令/卸载路径）不带检测**——卸载时哪怕外部改过也必须落盘（丢编辑比覆盖更糟），显式成功后基线随之更新、自动保存恢复正常。`schedule()` 是唯一开启检测的入口（`{checkExternal: true}`）。
  ② **P1b 连续失败降级**：写盘失败计数连续累加（成功一次即清零），达 `SAVE_FAILURE_SUSPEND_THRESHOLD=3` 挂起自动保存（`schedule()` 不再排程，防告警疲劳），一次性 Notice（`save.autoSuspended`）；显式保存不受影响，任何一次成功即解除挂起。
  ③ **实现**：`SavePipelineDeps` 增可选回调 `onExternalChange(file)` / `onAutoSaveSuspended()`（view.ts 接 `notifyError`，新 i18n 键 `save.externalChangeSkipped` / `save.autoSuspended` 中英）；`save(file?, treeHint?, opts?)` 增 `checkExternal`。
  ④ **验证**：`tests/save-pipeline.test.ts` +4 例（外部改动跳过且只提示一次 / 显式保存不检测且基线更新 / 连续失败挂起→显式成功解除 / 成功清零计数），全量 55 文件 **1720** 用例 + lint + knip 全绿。
  ⑤ **教训**：①测试桩的 `cachedRead` 必须随 `modify` **联动更新**——否则「写盘后磁盘内容」不变，外部改动检测会被自己的写入误触发（真实 vault 语义：写入即更新读取缓存）；②`gate/fail` 按**索引**操作累积 gates 数组，串行队列下多轮 gate 必须逐个 await 后再操作，否则索引错位直接挂起——多轮写盘失败场景用 `mockRejectedValueOnce` 按次序消耗更稳。

- [K104] **修复「首帧公式节点尺寸不同步」：产物反查选择器补我方 holder 类（2026-09-28 用户实测 + 控制台探针定位）**
  ① **症状**：含「文字 + `$$…$$` 同行」数学的节点**首帧渲染时公式区域缺失**（行内 `$…$` 与独占行 `$$…$$` 正常），**重开文档恢复正常**；控制台告警「数学节点尺寸同步未能定位归属节点，内容可能被裁剪」。
  ② **诊断**（用户按指引执行控制台探针，7 个 holder 全部命中）：`已渲染=true`（替换确实发生）、**`有产物`（`.mjx-container`）= false**、`字形`（`mjx-c`）= 50/112/20/100/70/20/120（非零）、**`零宽字形 = 0`**（规则已 flush、度量正常）、holder 尺寸正常。
  ③ **根因**：该环境 MathJax 走 **`tex2svg`**（产物为 `<svg>`，**没有 `.mjx-container` 容器类**），而 K100 的产物反查**只匹配 `.mjx-container`** → 首帧 holder 随引擎重渲染脱离（K96 图片回灌）后，`findNodeByDom(holder)` 与产物反查**双双失败** → 重排被跳过 + 告警 → 尺寸不同步。「仅首次失败」的机制：重开时产物缓存命中、**构建期同步放置**，完全不走异步替换与重排链。
  ④ **修复**：`engine/mindmap.findNodesByMathProducts` 选择器改**双通道** `.mindmap-node-inline-math, .mjx-container`——前者是**我方 holder 类**（替换后仍保留、与 MathJax 输出形态无关，稳定锚点），后者兼容 CHTML 环境。
  ⑤ **验证**：`tests/engine-image-size.test.ts` +1 例（**断言选择器含 holder 类**，防止被改回只认容器类）；全量 55 文件 **1721** 用例 + lint 全绿。
  ⑥ **教训**：反查/定位类逻辑**不要依赖第三方输出的 DOM 形态**（MathJax 有 CHTML/SVG 两条输出路径，DOM 形态不同）——必须锚定**自己写入的类名/属性**；「仅首次失败、重开恢复」是**异步链路 vs 缓存同步路径**差异的强信号，优先查「缓存命中时会跳过哪一步」。
  ⑦ **第二层修复（同日追加，用户 `innerHTML` 诊断驱动）**：产物经查**完全正常**（`<mjx-container class="MathJax" jax="CHTML">`、宽 49.9px、`mindmap-inline-math` 类齐全）而告警仍在 → 真因是**引擎渲染窗口**：`Renderer._render` 期间 `renderer.root` 被**置 null**（K67 已记录该中间态），此时 `findNodeByDom` 与产物反查**必然双双落空**——此前被误判为「定位失败」：告警 + **永久跳过**该批重排。修复：`flushMathRemeasure` 在「全部落空且尚未重试」时**暂存 holders**（`deferredMathHolders`）且**不告警**，由 `node_tree_render_end`（root 已回填）调 `retryDeferredMathRemeasure` **重试一次**；重试仍失败才告警（防静默退化），成功后清暂存与标记（防「重排→渲染→再重排」循环）。**教训**：解析失败要先区分「**目标真失效**」与「**引擎处于中间态**」——后者应延迟重试而非告警。

- [K105] **修复「导出 PNG 字体回退默认字体、多行节点被裁（残余）」：K99 值校验从 ASCII 白名单重写为结构性字符拒绝（2026-09-29 用户截图 + 控制台诊断）**
  ① **症状**：导出 PNG 中部分多行节点文字被裁（第二行只露上半截），**导出图字体与屏上不一致、回退为默认字体**（用户实机比对确认）；屏上渲染正常。
  ② **根因**：K99 的值校验为正向字符白名单 `/^[\w\s#'"(),.:/%!-]+$/`，其中 `\w` 只匹配 ASCII——**中文环境字体栈含非 ASCII 字体名**（控制台诊断实据：`--font-interface` = `"HarmonyOS Sans", "HarmonyOS Sans SC", '??', …`，`'??'` 为非 ASCII 字符的控制台降级显示；`--font-text` / `--font-monospace` 同形态，三者白名单校验均 `false`）→ **三个字体变量全部被静默跳过** → 导出环境变量未定义 → 回退 `sans-serif` → 换行点漂移、内容超出 foreignObject 被裁（与 K99 修复前同症状，成因在过滤层而非注入层）。字符枚举白名单对「合法但非 ASCII」的值天然漏杀。
  ③ **修复**：`platform/export-css-vars.ts` 校验改为**拒绝结构性字符**（CSS 注入的唯一载体）——`UNSAFE_CSS_VALUE_CHARS = /[{};\\<>&@]/`（`{}` 闭合/开启规则块、`;` 结束声明、`\` 转义重构如 `\7d` 生成 `}`、`<>&` 标记构造、`@` at-规则）＋控制字符（码点 `< 0x20` / `0x7F`，含换行/制表）＋长度上限 1000（防超长值放大注入体积）；其余（中文 / PUA / emoji / 任意 Unicode）**全部放行**。控制字符不用正则表达（字符类控制字符范围触发 `no-control-regex`，该规则意图拦截编码事故、此处是有意过滤；项目不引入 eslint-disable，故以码点判断落实现）。
  ④ **验证**：`tests/view-export.test.ts` +3 例（Unicode 字体名中文/PUA 放行 / 控制字符与反斜杠拒绝且同批安全值照常注入 / 超长拒 + 恰好 1000 通过），既有「`}` 闭合与 `<script>` 拒绝」用例保持通过；全量 55 文件 **1724** 用例 + build + lint(0 警告) + knip 全绿。
  ⑤ **待实机复验**：重载后导出对比——若字体与屏上一致即闭环；**若仍不一致但已变化**（如回退 Segoe UI / 系统字体而非此前默认形态）→ 屏上生效字体为 @font-face 本体（诊断第 2 项：文档注册 `Inter` / `"Source Code Pro"` / `'??'` 等），`<img>` 解码的 SVG 独立文档访问不到主文档 @font-face，需第二阶段修复（font-face 规则注入，可行性待探针；本项不预设方案）。

- [K106] **修复「导出 PNG 临界节点仍被裁（K105 残余）」：导出侧 foreignObject 几何余量（2026-09-29 CLI 实机全链路定位）**
  ① **症状**：K105 后重载导出仍有个别节点文字被裁（"6.1 块级公式（`$$` 独占行、三行形态）"第二行"态）"只露上沿）；**字体已与屏上一致**；屏上渲染正常。
  ② **定位（CLI `obsidian eval` 实机）**：a) **变体扫描**（同内容 + 同变量注入、`<img>` 解码后数墨迹带）：`--font-monospace` 长栈=2 行，去掉或替换为 `monospace`=1 行，`--font-interface` 无关；b) **环境对照**：同内容在主文档真实 foreignObject 渲染 **1 行**、在 `<img>` 解码路径渲染 **2 行**——**跨环境文本度量偏差 ~2px 实锤**（内容/变量/字体全相同）；c) **排除**：@font-face 注入（`'??'` 是**空壳 @font-face 无 src**、屏上实际命中系统字体 Cascadia Mono）、`text-spacing-trim` 等文档级属性注入、UI 关键字剔除/替换（`"Cascadia Mono"` 单独注入亦 2 行）；d) **修复验证**：FO 宽 +2/+4/+6/+8px 均恢复 1 行。
  ③ **修复**（新文件 `platform/export-foreign-object-padding.ts`）：`padForeignObjectsForExport`——遍历克隆 SVG 全部 `foreignObject`，**宽 +12px**（覆盖实测偏差分布上界——轻量节点 ~2px、标点密集长文本行可达 ~12px，同日二次实机修订自初版 +4）+ **高 +20px**（≈1 行行高，"换行也不裁"兜底）；只改尺寸不动 x/y；尺寸非法跳过、无 FO/形态不符安全 no-op、原样返回同一对象；接线组合根 `exportSvgTransforms` **链首**。DOM 遍历遵循项目既有纪律（`Array.from` + try/catch，勿用方法引用形态——会命中 DOM lib deprecated 重载、触发 no-deprecated，同 `node-codeblock.ts` 注释）。
  ④ **取舍**：加宽后内容右端 < 节点形状右缘（余量在形状内部消耗）→ 不溢出形状；不换行时零视觉差异；屏上恰好临界换行的极少数节点导出可能少一行（罕见，优于缺字）；极端节点"多一行但完整"（优于"缺半行"）。
  ⑤ **验证**：`tests/export-fo-padding.test.ts` +4 例（加量+原样返回 / 非法尺寸跳过且其余照常 / 无 FO no-op / 形态不符矩阵）；**CLI 实机复验**：构建部署到 vault → `obsidian vault="O" plugin:reload` → 重建视图 → 导出目标节点图 → **"6.1"节点恢复完整单行** ✓；全量 56 文件 **1728** 用例 + build + lint(0 警告) + knip 全绿。
  ⑥ **教训**：①「屏上正常、导出异常」的终极定位器是**同内容跨环境对照**（主文档真实 FR vs `<img>` 解码），而非逐属性猜测；②凡"依赖屏上测量固定尺寸 + 导出重建布局"的架构都需评估**几何余量兜底**；③**CLI 命令的目标 vault 默认是"最近聚焦"**——多 vault 环境必须 `vault=<名>` 显式定向（本次曾误发到另一 vault）；④`obsidian eval` 传参用 `code='…'`（PowerShell 单引号）+ JS 双引号，`\"` 组合会静默破坏传参。

- [K107] **修复「导出 PNG 数学节点末行文字压到节点底边框线（K106 残余）」：导出侧数学容器高度钉扎（2026-09-29 CLI 实机像素取证）**
  ① **症状**：K106 后导出仍有个别节点异常——长数学节点（块级公式 + 说明文字）**末行文字下缘被节点底部边框线穿过**（用户实拍"（无裁切、无空洞）"；屏上渲染正常）。像素扫描实据：导出图中文字墨迹底部 = 底边框线位置（间隙 0），屏上同节点底部余量 +5px；K106 后**横向**已达标（"）"右间隙 24.5px），异常全在**纵向**。
  ② **机制（导出环境对照实验锁定）**：导出渲染环境（`<img>` 解码独立文档）里 MJX 字体不可用，回退字体度量把 `mjx-container` 盒子撑大（实测屏上 31.24px → 导出 ~56.3px，≈1.8 倍）→ 数学所在行行盒变高 → **下方文字整体下移 ~8px**（同图左侧纯文本节点无此现象 ⇒ 漂移源自数学块）。7 变体扫描：`line-height:0` / `display:inline-block` / `vertical-align: top|bottom` 覆盖均无效或过头，**仅"钉 height = 屏上实测值"命中**（文字带 [87.3, 100.3] → [78.3, 91.3]）。
  ③ **修复**（`platform/math-jax.ts` 新增 `pinMathContainerHeightsInExportSvg`，接入 `exportSvgTransforms` 链紧随 `injectMathStylesIntoExportSvg`）：克隆内 `mjx-container` 与主文档同名元素**按文档序一一配对**，把实测高度（屏幕像素 ÷ 画布缩放 = 布局像素，元素自身 `rect.width/offsetWidth` 归一）以内联 `height: Npx !important` 钉入克隆；数学字形仍可能越过自身盒底 ~5px——落在数学与文字之间的行间隙内（实测 23.5px），无碰撞。
  ④ **配对守卫（含一次实机误判）**：候选**限定 `<svg>` 内**——引擎的离屏测量容器挂在画布容器下（svg 外）且内含内容克隆（带 mjx-container），首版未过滤导致「实机 8 vs 克隆 7」计数不符 → 全链 no-op（导出字节与修复前完全一致，一度误判"修复无效"）；过滤后 7 vs 7 配对成功。单元素实测不可用跳过、数量不符/形态不符/无 mjx 一律 no-op；属主文档取克隆 `ownerDocument`（popout 兼容）；查询域优先 `.mindmap-canvas-container` 退回全文。
  ⑤ **验证**：`tests/math-jax-export-pin.test.ts` +8 例（配对钉扎与缩放归一 / 域优先与全文退回 / svg 外候选排除 / 数量不符零写入 / 单元素不可测跳过 / 无 mjx no-op / 形态不符矩阵 / style 缺失兜底）；全量 57 文件 **1736** 用例 + build + lint(0 警告) + knip 全绿；**CLI 实机复验**（部署 → `plugin:reload` → 重建视图 → 导出目标子树）：文字带 **[87..97.5] → [78..91]**（与屏上位置重合）、与底边框间隙 **6.5px**、越界 0、数学形状位置不变；导出 PNG 字节 42824 → 46053（证明钉扎确实进入导出链路）。
  ⑥ **教训**：①「屏上正常、导出异常」类问题的度量必须在**导出环境**内做（同节点多变体对照），屏上/主文档内测量不能替代；②几何余量（K106）解决"被裁"，**"纵向流漂移"必须钉住参与布局的盒子尺寸**——环境级字体缺失会让尺寸自洽的布局整体漂移；③**配对类实现要先枚举"同名元素的所有宿主"**（引擎离屏测量容器即典型暗桩）；计数守卫会静默 no-op，"输出未变化（字节/hash 完全一致）"应作为修复未生效的第一判据。

- [K108] **修复「默认自绘渲染下：编辑中心主题不重命名文件 + 编辑混排节点不自动拆分双链」：插件侧编辑通道补齐"提交后编排"（2026-09-29 CLI 实机功能验收定位）**
  ① **症状**：CLI 建图逐个功能验收时发现两项 README 承诺功能**静默失效**——a) 双击中心主题改名（如改为 `K108-已改名`），节点文本已变但**文件不重命名**；b) 编辑混排节点 `- 说明文字 [[校验]] 尾巴`，**不自动拆出链接子节点**，而批量命令「拆分全文混合链接」正常。两者均无报错（控制台 `dev:errors` 为空）。
  ② **机制（两层根因，实机取证）**：视图的全部后续编排挂在**引擎事件**上——`data_change` → `onRootDataChanged`（scheduleSave + 节点计数 + `TitleRenamer.schedule`）、`onDataChanged` → `scheduleAutoSplitCheck`、`node_text_edit_change` → `captureAutoSplitCandidate`。而自绘（富）节点的编辑走**插件侧内联编辑器**（K92 起为主入口，弹窗原文模式同一收口 `applyRawNodeContent`）：它**直接改 data + `render()`，不走引擎命令**，故两个事件都不派发 → a) 改名永不调度（对照实验：手动 `setData` 触发一次 `data_change` 后文件**立即**改名，证明 TitleRenamer 本身可用）；b) 候选集为空 → 拆分 no-op。**第二层**：即使补上通知仍不拆分——`autoSplitNode` 的判据 `text !== mdDerivedText` 在原文提交路径下**恒不成立**（`applyRawToNode` 重解析原文时会同步刷新 `mdDerivedText`；引擎编辑框只改 `text`，快照才留在解析期）。
  ③ **修复**（方案对比后取"经视图回调补齐"，拒绝"features 直发引擎事件"以免破坏 `engine/mindmap.ts` 唯一防腐收口）：a) `ViewNodeEditContext` 新增 `notifyNodeContentCommitted(node)`（`MindMapViewContext` 同步具备），`view.ts` 实现为「scheduleSave + 计数刷新 + `titleRenamer.schedule()` + 捕获拆分候选 + 调度拆分检查」，由 `applyRawNodeContent` 在 render 后调用（一次覆盖内联与弹窗两条通道）；b) `captureAutoSplitCandidate(view, node, { pluginChannel: true })` 记入候选集的 `forced` 子集，`autoSplitNode(view, node, { force })` 对该子集**放行 `mdDerivedText` 判据**。
  ④ **验证**：`tests/node-inline-editor.test.ts` +2 例（提交后通知视图且携带节点 / 无改动提交不通知）、`tests/view-split-links.test.ts` +1 例（force 下 `text === mdDerivedText` 也拆分）；全量 57 文件 **1739** 用例 + build + lint(0 警告) + knip 全绿；**CLI 实机复验**（部署 → `plugin:reload` → 重建视图）：中心主题改名 → 文件重命名为 `K108-已改名.mindmap.md`、混排节点编辑 → 自动拆出子节点 `校验` 且落盘 `  - [[校验]]`、普通编辑保存与批量命令（幂等提示"没有可拆分的混排双链"）与状态栏计数回归正常。
  ⑤ **教训**：①**窄接口新增成员必须同步到 `MindMapViewContext`**——装配面多处把 context 透传给编辑入口（`editNodeText` 等），只加子接口会让整片调用点 TS2345；②测试桩用 `as unknown as` **断言不补运行时成员**，新增"必调方法"会让桩报 `is not a function`（本次 5 例同时失败），补桩要与改接口同步；③**"引擎事件驱动编排"架构下，任何绕过引擎命令的新通道都必须显式复刻编排回调**，否则功能静默失效（无异常、无日志）；④判据类守卫（如"是否编辑过"）要按**通道**复核：不同通道对元数据快照的影响不同（原文重解析会刷新快照，纯 text 写入不会）。

- [K109] **0.1.5 发布准备：`lint:scanner` 解除 npm 11.9+ 阻断、`check:release` 补 License 校验、发布说明补齐（2026-09-29）**
  ① **背景**：0.1.5 未推送（远端最新 tag 0.1.4），本轮把 K99–K108 的修复并入 0.1.5 一起发布；本地按 CI 门禁自证时发现 `npm run lint:scanner` 在开发机失败、`check:release` 缺 License 面。
  ② **`lint:scanner` 阻断（EALLOWSCRIPTS）根因**：`npm run` 会把**当前 npm 配置**以 `npm_config_*` 环境变量注入脚本进程——开发机用户级 `~/.npmrc` 的 `allow-scripts=<白名单>` 因此经 **env 层**进入再启动的子 npm；npm 11.9+ 的 `resolveAllowScripts` 对「CLI/env 层提供的 `allow-scripts`」在 project-scoped install 中**直接判错**（`--userconfig` 只能隔离配置文件、隔离不掉 env；实测复现：手动执行成功、`npm run` 下失败，唯一差异即该 env 变量）。
  ③ **修复**（`scripts/scanner-lint.mjs`）：a) 新增 `stripNpmAllowScriptsEnv()`，**所有 npm/npx 子进程与 eslint 直连路径统一净化环境**；b) 安装目录 `package.json` 显式声明 `allowScripts: {}`（npm 官方要求的合法落点，空对象＝不允许任何依赖运行安装脚本）；c) `ignore-scripts=true` 写入 `.npmrc`（命令行 `--ignore-scripts` 在 project-scoped install 中同样被 npm 11.9+ 拒绝）；d) `--userconfig` 的配置隔离语义保留不变。
  ④ **`check:release` 补 License**（`scripts/check-release-metadata.mjs`）：缺失/空 = **error**（退出 1）、识别不出 OSI 许可 = **warning**（不阻断），分级对齐官方 `obsidian-workflows` 的 repo-checks「error if missing, warn if non-OSI」；候选名 `LICENSE` / `LICENSE.md` / `LICENSE.txt` / `COPYING`，判据只看文件头 2000 字符并做宽松关键词匹配（避免措辞差异误报）。
  ⑤ **发布说明**（`docs/release-notes-0.1.5.md`）：补入本轮用户可见变化（导出 PNG 保真四类裁切/压线、中心主题改名、混排双链自动拆分、重复打开让位、外部修改保护、首帧公式尺寸、外链协议白名单），测试基线 55 文件/1700 例 → 57 文件/1739 例，兼容性说明补「同一 `.mindmap.md` 仅保留一个编辑实例」。
  ⑥ **验证**：清缓存后 `lint:scanner` 全新安装 352 包并**通过**；`check:release` 三场景（MIT / 非 OSI / 缺失）行为正确且仓库 `LICENSE` 按原样恢复；`build` + 57 文件 1739 用例 + `lint`(0 警告) + `lint:css` + `check:dead-code` + `verify:visual` 全绿。
  ⑦ **教训**：①**`npm run` 注入的 `npm_config_*` 环境变量是「配置隔离」的暗桩**——只清 userconfig 文件不够，子进程 env 也要净化；②npm 11.9+ 把 `allow-scripts` 的**来源层**写进了语义（CLI/env 一律拒绝、project 层才合法），跨 npm 版本的脚本必须按「落点合规」而非「结果等价」来写；③发布元数据护栏按官方 repo-checks 的**分级**补齐（error/warn 分明），别把 warn 面升成 error 面。

## 新增功能检查清单

按以下顺序自检（先官方 API，再自研；先收口，再实现）：

1. **落层与模块粒度**：纯逻辑（无 obsidian / 引擎依赖）→ `domain/`；通用机制与共享词汇（常量/文案/错误/并发/事件/持久化/黏合类型）→ `core/`；链接与文件解析 → `links/`；Markdown 解析/序列化/打开/拆分 → `markdown/`；图片与附件 → `media/`；引擎封装与主题 → `engine/`；Obsidian 平台集成 → `platform/`；弹窗 → `ui/`；视图服务 → `services/`；UI 特性与视图控制器 → `features/`；入口与装配 → 组合根（`main.ts`/`commands.ts`/`settings.ts`/`creation.ts`）。新逻辑优先并入最贴近的已有模块；跨组复用先查许可集与已有收口点，勿造第二份；确需新建文件时按模块化四边界自检（单一职责 / 分层单向 / 收口唯一 / 窄接口，见 K50），依赖矩阵由 eslint zone 强制（见 K51）。
2. **收口**：是否触碰引擎内部形态？只允许经 `mindmap.ts` / `services/engine-controller.ts` 具名函数；库内文件解析走 `links-resolve.resolvePathToFile`；并发原语走 `concurrency.ts`；DOM/事件监听走 `this.register*` / `EventBinder`；URL 形态判断走 `domain/url.ts`（背景见 K25 / K28 / K29）。
3. **官方优先**：面向 Obsidian 的能力先对照官方 `obsidian.d.ts` 与帮助文档；官方缺口才允许私有触点，且必须防御式实现并在本文件登记（见 K39）。
4. **测试**：新增 `tests/*.test.ts`（纯逻辑直测；引擎运行时 DOM 装配类行为交 `verify:visual`）；同步本文件「代码结构」两份清单——`agents-md-sync` 测试会强制。
5. **校验链**（顺序执行，全绿才提交）：`npm run build`（tsc 检查 src+tests）→ `npm test` → `npm run lint`（须在插件根 cwd，见 K43）→ `npm run lint:css`（改过 `styles.css` 必跑，见「测试与 CI」的 CSS 检查段）→ `npm run check:release`（改过 `manifest.json` / `versions.json` / README / `LICENSE*` 时必跑；含 License 缺失=error、非 OSI=warn，见 K109）→ 新增/删除导出或文件时加 `npm run check:dead-code`（见 K57）→ 涉及渲染/DOM 装配时加 `npm run verify:visual` → **改过 `vendor/upstream/` 或 `vendor/patches/` 时加 `npm run build:vendor` 重打包，并同步 `vendor/BUILD.md` 与 `tests/vendor-contract.test.ts` 两处 sha256 常量（见 K73）**。
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
3. 附加 `main.js`、`manifest.json`、`styles.css`，以及 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md`（`.github/workflows/release.yml` 自动构建并创建草稿 Release；许可声明必须随副本分发，见 K84）。
4. 新增版本补 `docs/release-notes-<tag>.md`（中英双语）——`release.yml` 取该文件作 Release 说明，缺失则回退自动生成。

### 提交信息与 Actions 命名约定

GitHub 的提交列表与 Actions 列表**只显示提交标题 / run 名称**（正文在列表里不展示），故：

- **提交标题极简**，一眼可辨，不留长描述：
  - 发布提交 = **纯版本号**（如 `0.1.5`）；
  - 功能 / 修复 / 加固 = **`K<编号>`**（可跟极短辨识名，如 `K108 编辑通道提交后编排`）；
  - 文档 / 工程 = `docs K109` / `chore K109`。
- 详细说明写在标题下、空行之后的**正文**里；正文可长（列表不显示），标题必须短。
- **Actions 运行名称**由 workflow 的 `run-name` 决定：`release.yml` → 版本号（`${{ github.ref_name }}`），`lint.yml` → 分支名（同表达式）——不再显示提交信息。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
  **该 `true` 是承重的**（豁免了 `md-serialize.ts` 的 lookbehind 正则，见 K42）——改动前必读该条目。
- 分发（release 资产 / BRAT 更新）必须携带 `LICENSE` 与 `vendor/THIRD-PARTY-NOTICES.md`——vendored 代码（约 72%）的许可声明载体，内联注释不可替代（见 K84）。
