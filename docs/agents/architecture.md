# 代码结构与文件规模（详录）

> 本文件由 AGENTS.md 迁出（2026-10-04 瘦身）。AGENTS.md 只保留硬规则、决策表、命令与索引；
> 本文是**详录**，改代码前按需查阅，改约定时**同步更新 AGENTS.md 索引**。

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
    links-rename.ts #   文件重命名后的引用更新（**字段 + 渲染源**双层）：links-tree 字段改写之后，
                    #   对未编辑且 mdRaw 仍含旧目标的节点，按解析侧同一扫描器定位旧链接 token
                    #   并以同一改写规则重写，经 buildInlineData 重建 text/mdRaw/mdDerivedText/
                    #   mdSegments——通道字段保留字段层结果（attachmentUrl 资源地址不照搬解析态）
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
    nav-history.ts  #   导航历史卫生（K111）：视图切换不是导航点——清理 leaf 历史里
                    #   「尾部连续同文件段」内跨视图类型的冗余条目（侧键后退修复）；
                    #   私有结构防御式访问，失败退化为修复前行为
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
    image-resize.ts # 节点图片拖拽调宽：hover 手柄 + 等比缩放；帧内直写渲染中
                    #   <image> 宽度（DOM 通道，不动引擎数据/不进历史），收尾一次走
                    #   SET_NODE_DATA（一条历史 + 布局归位），持久化走 Obsidian 官方
                    #   嵌入尺寸语法——结束时 scheduleSave，序列化合成回写 `|宽度`
                    #   （不落 data.json）
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
  wiki-display.test.ts # 链接「生效显示名」纯判定（K6：六道闸门逐条 + 冗余省略 + 别名优先/回落默认名）
                       #   ——回写/可见名/tooltip 三消费方共用口径的直接回归（此前只靠端到端往返间接覆盖）
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
  links-rename.test.ts # 重命名渲染源重建（字段+mdRaw 双层；别名/区块/嵌入附件/md 形态/幂等/回收站）
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
                       #   引擎重建守卫/重复打开先提交）、isAnyNodeEditing 统一判据、
                       #   applyRawNodeContent 原文写回编排（2026-10-04 审查补齐：写回→
                       #   重排→渲染→保存→K108 通知的次数与顺序、图片面仅在有 image
                       #   时探测、探测 reject 降级 console.warn 且不影响写回）
  math-jax.test.ts     # 行内数学渲染（platform/math-jax）：实机通道优先级（tex2chtml→tex2svg）、
                       #   **就绪判据（mjx-c 宽全 > 0）/ 未就绪同步撤回 / flush 合并与放行
                       #   重试 / 预算耗尽保留字面 + 告警 / 容器盒回退判定**（见 K87）；
                       #   API 面缺失告警一次 / 抛错不上抛 / 未连接入队补替换 / 字体等待与拒绝
                       #   不阻塞；P4 面：塌缩不入缓存、定稿回调恰好一次（见 K86）
  viewport.test.ts     # 视口几何（resetZoom 画布中心锚点 / 内容包围盒居中 / 自动整理后重置缩放）；
                       #   自动整理的渲染窗口守卫（root 暂缺延后执行 / 超上限放弃，K67）
  open-as-restore.test.ts # 「以思维导图打开」偏好恢复（多档延时/代际）
  nav-history.test.ts  # 导航历史卫生（K111）：尾部连续同文件段内删除跨视图冗余 /
                       #   目标态保留 / 跨段保护 / 形态异常降级（私有结构防御式）
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
  release-notes-<tag>.md        # 各版本发布说明（中英双语；release.yml 按 tag 取用，缺失回退自动生成）
```

### 文件规模与豁免（超限须登记）

官方社区模板建议单文件控制在 200–300 行。本项目**不做机械拆分**——按「拆分会不会把已有收口职责摊开」判定，而不是按行数判定：行数是症状，收口点被拆散才是病。故引入一条硬规则：

> **超过 300 行的源文件必须在下方表格登记豁免理由；未登记者一律视为待偿还债务。**

（豁免是「已知并接受」，不是「没看见」。债务指标：**未登记的超限文件数，只允许递减**。）

| 文件 | 行数 | 豁免理由 |
|---|---|---|
| `src/engine/mindmap.ts` | 2115 | 引擎防腐层**唯一收口点**：vendor 内部形态（`node.group`、`renderer.*`、DoExport、Search 插件状态…）只允许在此出现。拆开等于把私有访问面摊到多个文件，耦合面反而变大——**这一条是必须豁免的，拆分即违约** |
| `src/markdown/md-serialize.ts` | 1054 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。（链接「生效显示名」的纯判定已下沉 `domain/wiki-display.ts` 供 `mindmap.ts` 复用——那是**跨模块复用**，不是本文件内聚被拆） |
| `src/markdown/md-outline.ts` | 1046 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则，拆开会让两侧规则漂移 |
| `src/core/i18n.ts` | 517 | 纯词条表（无逻辑分支），拆分只增加 import 噪音，无内聚收益 |
| `src/features/view.ts` | 1210 | 视图 Controller：**第 6 步拆分后的编排壳**（见文件头契约）。只做「生命周期事件 → 装配 services 与 view-* 交互特性」；**主**业务已外置（DocumentService/EngineController/TitleRenamer/openHyperlink…）。⚠ **已知偏离：数学校准会话（L264–452，6 字段 + 5 方法 ≈189 行）仍留在视图层**——它按 holder 反查真实节点（`findNodeByDom`/`findNodesByMathProducts`）并触发批量重排，依赖 engine 访问面，而 platform 按 K51 不得依赖 engine（`eslint.config.mts` boundary），故只能落在 features。抽出需配套 `onunload` 生命周期与会话单测，**尚未排期**（原 SF-04 已解析出方案漏洞，见开放项）。再拆会把「生命周期编排顺序集中可见」这一收口点摊到多文件 |
| `src/services/engine-controller.ts` | 815 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法；导出 SVG 后处理链经 `deps.exportSvgTransforms` 由组合根注入（K51：services 不依赖 features）。与 `mindmap.ts` **同性质**——拆开即把私有访问面摊开，故同样必须豁免 |
| `src/media/images-path.ts` | 618 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一），**从 images.ts 拆出**的产物；导出函数共享同一套路径与尺寸不变式，再拆会摊成跨文件的隐式协议 |
| `src/features/image-resize.ts` | 411 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链（无常驻监听、帧内 DOM 直写、手势独占），拆开会让状态机与 DOM 手柄跨文件失配 |
| `src/features/drag-target.ts` | 382 | 单一算法收口（拖拽落点仲裁）：两类锚点（节点中心／兄弟间隙中点）必须共用同一套「按指针距离最近仲裁 + 引擎三态让位」规则，拆开会让锚点判定与视觉高亮口径漂移 |
| `src/features/view-node-actions.ts` | 756 | 节点操作（链接/文本/剪贴板/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export，此处是剩余语义相关操作集，再拆会让两个菜单的调用面分叉 |
| `src/features/view-dnd.ts` | 575 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配 |
| `src/main.ts` | 360 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。业务逻辑已全部外置（见文件头），拆开 onload 会破坏「装配顺序集中可见」的可读性收益；当前超线 51 行 |
| `src/markdown/links-split.ts` | 486 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。与 `md-outline` / `md-serialize` 同性质 |
| `src/core/constants.ts` | 452 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件，互有基表派生；「可链接附件」「系统媒体」两份白名单已于 2026-09-15 删除——附件口径收敛到 `domain/wikilink.wikilinkTargetIsAttachment`）；K28 要求「扩展名清单集中在 `constants.ts`，勿复制」——拆分即打断该收口，同 `i18n` 性质，只增加 import 噪音 |
| `src/settings.ts` | 379 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。`sanitizeSettings` 被 data.json 加载与面板写回共用（已在「代码结构」清单登记） |
| `src/features/node-inline-content.ts` | 1327 | 自绘节点内容的**单一关注点**闭环：行内原文 → 段序列（含轻标记切分）→ HTML（锚点契约 + **内联样式常量**）。三份东西互为契约——样式常量即导出保真契约（K53 ⑤，引擎导出不注入插件 CSS）、锚点属性即 `view-wikilink` 的识别契约（K53 ③）——拆开会让「显示名口径 / 样式来源 / 锚点形态」跨文件漂移；文件的复杂度全部来自这三个契约的**取值表**（段类型 × 标记 × 样式），不是职责堆叠 |
| `src/features/view-wikilink.ts` | 411 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。两条预览路径**都不预检目标是否存在**（交核心判断，见 K21） |
| `src/platform/math-jax.ts` | 813 | 数学渲染通道**单一落点**（全插件唯一 import `obsidian` 的数学实现）：产品形态是「字面占位 → 异步替换 → 就绪判据（全部 `mjx-c` 宽 > 0 + 不可见操作符 U+2061 豁免，K90）→ flush 合并调度 → 产物缓存 / 重排通知 → 失败退字面」，再加导出 SVG 样式注入——屏上渲染与导出注入共享同一套就绪口径；拆开会让该口径跨文件漂移（它正是 K90 三轮实机实测的产物） |
| `src/links/links-tree.ts` | 464 | 树内引用更新**单一遍历实现**：rename / clear 两模式共享待匹配形态派生（资源地址 + [[链接]] 双载体、回收站退化、跨文件夹移动取新位置、非 .md 文档带扩展名）与写回规则；拆开会让「重命名改写」与「删除清理」两条路径的匹配口径漂移 |
| `src/links/links-resolve.ts` | 351 | 「任意地址形态 → TFile」的**统一解析入口**：远程拒绝 → `obsidian://` → 资源地址 → 路径直查 → `file://` 剥离 → 官方 `getFirstLinkpathDest` → 索引兜底——形态路由的**分支顺序本身即契约**（新增规则只改这一处）；拆开会重新引入本文件当初拆出要收敛的「双轨并存、覆盖形态互有盲区」问题 |
| `src/features/node-inline-editor.ts` | 384 | 节点内联编辑的**单一会话收口**（K92）：覆盖层定位与跟随（`scale` / `node_tree_render_end` 重定位）、键盘语义表、点击外部与 `mousewheel` 提交、会话所属引擎守卫、提交写回（`applyRawNodeContent`）共享同一套「会话 → 值 → 落数据」不变式；拆开会让定位跟随与提交守卫跨文件失配 |
| `src/services/document-service.ts` | 365 | md 文档读写数据面：**读**（`DocumentService.load` → `parseMdOutline` + `walkResolveImagePaths`）与**写**（`SavePipeline` → 防抖调度 + 串行排空 + 卸载快照兜底 + 无差异跳过 + P1a 外部改动检测 / P1b 连续失败挂起）成对。二者共享文件头声明的**归属不变式**（一次写盘的目标文件与其内容必须属于同一个文件：`getSnapshotFor(file)`/`getFrontmatterFor(file)` 按文件取、排空期不读活引用、`drainFile` 锁定本轮归属）——拆开会把这条跨对象不变式切成跨文件隐式协议，代价高于行数收益（K50 收口唯一） |

行数基准为 **2026-09-28 快照**，其后按实测逐批更新（**2026-10-02 全量重测**并补登记 `document-service.ts`；死代码审计、lint 合规化、K92/K93与「函数内纯移动拆分」轮后重测；**2026-10-04 再全量重测**，本轮因批量反查等改动更新了 6 个文件）。

**口径（2026-10-04 统一）**：以 `tests/agents-md-sync.test.ts` 的 `countSourceLines` 为**唯一口径** —— `readFileSync(path,'utf8').split('\n')`，末尾换行不计行。⚠ **不要用 PowerShell `(Get-Content … | Measure-Object -Line).Lines`**：该 cmdlet 统计的是「非空行」以外的另一套计数，与本口径在多数文件上差 1–4%，会让登记值与实测对不上（实测曾因此误判「登记值整体失真」）。重测命令见下。

全部 **22 个超限文件均已登记理由**（其中 `math-jax.ts` / `links-tree.ts` / `links-resolve.ts` / `node-inline-editor.ts` / `document-service.ts` 分属各批补登记）。

**判定分两层**（勿再写成「不以数字为准」——那样与下述测试契约自相矛盾）：
1. **是否已登记理由**（人工/文档层）—— 未登记者一律视为待偿还债务。
2. **登记值与实测的漂移**（机械层）—— `tests/agents-md-sync.test.ts` 的「豁免表登记行数与实测无超阈值漂移」用例守门，阈值 `min(+15%, +50 行)`，超阈即红灯并列出 `文件：登记 N 行，实测 M 行`。**改动任一豁免文件后若该用例转红，必须回来更新本表的行数列**（本轮 `mindmap.ts` 因新增 `resolveNodesByDoms` +69 行触发过一次）。

**函数内拆分口径（2026-09-28「批次 2」逐行评估裁决）**：超长函数（>90 行）能否拆，判据同文件级——「拆会不会把契约摊开」，而非行数。① **不拆**（判定/优先级链形态：分支**顺序即契约**、注释与状态流集中可见；拆分需 `continue`→`return` 转换或引入 ctx/闭包状态，属机械改写而非提取）——`md-outline.buildInlineData`（220 行）/ `md-outline.classifyLines`（174）/ `node-inline-content.splitMarkedText`（111）/ `drag-target.handleMove`（105）。② **拆**（纯移动：块间独立、签名统一、零共享可变状态）——2026-09-28 已完成：`view-wikilink.registerWikilinkInteractions`（137 → 编排壳 + 点击/悬停/画布锚点悬停/中键四个注册函数）、`view-toolbar.buildToolbar`（114 → 编排壳 + 左/中/右三组构建）、`commands.registerCommands`（145 → 编排壳 + 创建/视图/导出与文档三组）。**重跑函数级评估前先读本节**，避免重复论证。
