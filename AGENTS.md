# MindMap Studio — Obsidian 社区插件（Markdown 渲染层）

## 项目概览

- 目标：Obsidian 社区插件（TypeScript → 打包为 JavaScript）。
- 定位：**Markdown 渲染层**——`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），插件解析为思维导图、编辑后无损回写为 Markdown；无任何专有格式。
- 入口：`src/main.ts`，编译为 `main.js`，由 Obsidian 加载。
- 发布产物：`main.js`、`manifest.json`、`styles.css`。
- 插件标识：`id: mindmap-studio`（安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`）。
- 引擎：`simple-mind-map 0.14.0-fix.3`——思绪思维导图（sxmind.cn）发布的第三方修订版（fork 自 wanglin2/mind-map 0.14.0，修订清单见 `vendor/BUILD.md`），以压缩产物 vendor 于 `vendor/simple-mind-map.cjs`（按需 tree-shake 重打包，附手写类型声明 `vendor/simple-mind-map.d.cts`）。引擎 CSS vendor 于 `vendor/simple-mind-map.css`，由 `npm run sync-vendor-css` 合并进根目录 `styles.css` 的标记段。打包/升级流程见 `vendor/BUILD.md`。

## 环境与工具

- Node.js：当前 LTS（Node 18+）。
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

四层：`domain/`（纯领域逻辑）→ `services/`（视图服务）→ `features/`（UI 特性与视图控制器）→ 根（基础设施：markdown 渲染层、引擎封装、弹窗、插件核心）。

```
src/
  main.ts           # 插件入口：生命周期、视图注册、command/file-menu/hover 源、
                    #   状态栏服务装配、视图切换后状态栏跟随
                    #   （vault rename/delete/create 经 VaultSyncService.attach
                    #   hooks 单入口分发，不再重复注册事件）
  domain/           # 纯领域逻辑（零依赖：lint no-restricted-imports 强制禁 obsidian/上层/vendor）
    wikilink.ts     #   双链解析/构造唯一权威（parse/format/display）
    url.ts          #   URL/地址形态谓词唯一权威（isHttpUrl/isExternalImageRef/isSchemeUrl 等）
    tree.ts         #   walkTree 先序遍历（显式栈防溢出，visit 返回 false 短路）
    md-meta.ts      #   MdNodeMeta：节点 data 上 md* 元数据的类型契约（纯契约，无引擎类型）
  services/
    document-service.ts # md 文档读取解析 + 保存管线（防抖/串行排空/卸载快照兜底，onSaveError 上报）；
                        #   解析只做图片地址解析，不做尺寸归一（视图走 aspect 校正）
    engine-controller.ts# 引擎实例生命周期 + 防腐收口（renderer 内部不外泄）
  features/
    view.ts         # Controller：Obsidian 生命周期编排、service 装配、链接跳转、标题重命名
    view-context.ts # MindMapViewContext：view-* 对视图的访问契约（结构化窄接口）
    view-*.ts       # 工具栏/拖拽/右键/搜索/导出/状态栏/图片灯箱/wikilink 交互/粘贴/节点操作/
                    #   快捷键处理器（view-hotkeys：F2 编辑当前节点）
    image-resize.ts # 节点图片拖拽调宽：hover 手柄 + 等比缩放（SET_NODE_DATA imageSize
                    #   custom:true + render），持久化走 Obsidian 官方嵌入尺寸语法——
                    #   结束时 scheduleSave，序列化合成回写 `|宽度`（不落 data.json）
    drag-target.ts  # 拖拽换父辅助：优化「拖动节点重新链接」的识别范围——引擎原生
                    #   判定要求指针精确落在目标矩形内，本模块在拖拽期间（仅拖拽中，
                    #   node_dragging 起会话、mouseup/node_dragend 收）以「节点中心为
                    #   锚点的均匀圆域」（TARGET_RADIUS_PX，与节点大小无关）取最近节点
                    #   经 setDragOverlapTarget 外借给引擎，引擎精确命中时让位；
                    #   松手走引擎原生 MOVE_NODE_TO
    file-creator.ts # 文件浏览器「新建」菜单注入（私有 API 防御式访问）
  concurrency.ts    # 并发原语唯一实现：串行队列/防抖/节流（SavePipeline/ViewStateStore/
                    #   状态栏计数等共用；节流支持 trailingResetsWindow 选项）
  persistence.ts    # data.json 写盘器（PluginDataWriter：串行队列 + 写前重读合并 + 吞错）
  open-as-restore.ts# 「以思维导图打开」偏好恢复（active-leaf-change/file-open/启动多档延时）
  system-open.ts    # 系统默认应用打开库内文件（桌面端 shell.openPath）
  errors.ts         # errorMessage(error)：面向用户的错误消息格式化唯一实现
  node-data.ts      # MdNodeData 黏合类型（引擎 MindMapNodeData + domain MdNodeMeta；
                    #   放 src 根层保持 domain 零依赖）
  status-bar.ts     # StatusBarService 契约 + 插件层实现（节点计数展示/清空，DOM 归插件层）
  md-outline.ts     # Markdown 大纲 → 导图树（frontmatter 跳过、标题/列表、行内 token；mdRaw 保真）
  md-serialize.ts   # 导图树 → Markdown（未编辑逐字回写/编辑合成；链接/图片新增检测）
  md-open.ts        # .mindmap.md 触发判定、视图切换、打开方式偏好钩子
  markdown.ts       # 新建文件默认内容/文件名、uid 修复（ensureUniqueUids）
  view-state.ts     # 按文件路径持久化布局/视口/openAs 到插件 data.json（ViewStateStore）
  images-path.ts    # 图片地址→资源地址（经统一解析入口）、外部地址判断、尺寸校正
  images-save.ts    # 图片入库（走 concurrency 串行队列）、文件名清理
  file-lookup.ts    # 全库文件查找索引原语（buildFileLookupIndex/FileLookupIndexService/
                    #   lookupIndexedFile；多种地址形态→TFile 的 O(1) 缓存查询）
  links-resolve.ts  # 统一解析入口 resolvePathToFile：按形态路由（远程拒绝/obsidian:///
                    #   资源地址→索引/路径直查/file://→官方 getFirstLinkpathDest→索引兜底）
  links-tree.ts     # 树内引用更新（重命名/清除共用同一遍历实现，mode 参数区分）
  modal-*.ts        # 链接/图片/命名弹窗（官方 AbstractInputSuggest 联想；
                    #   settle 守卫与 VaultFileSuggest 联想类收口在 modal-common.ts）
  mindmap.ts        # 引擎封装（创建/销毁/节点工具）+ 防腐收口（缩放/getRenderRoot/setNodeText/
                    #   forceRemoveNodeData/getNodeGroupEl/runWithExportScale/countTreeNodes/
                    #   exportMindMapPng/search* 系列/isEditingText/getRootText/startNodeTextEdit）
                    #   + ENGINE_COMMANDS：引擎命令名常量表（execCommand 勿再写魔法字符串）
                    #   —— 视图/特性层不直接触碰引擎 renderer/view/search/doExport 内部形态
  mindmap-theme.ts  # 主题配置（buildThemeConfig 唯一实现，视图主题参数化差异）
  event-binder.ts   # DOM/引擎事件绑定器（作用域化统一销毁）
  settings.ts       # 设置接口与设置面板（Obsidian 1.13+ 声明式）+ sanitizeSettings
                    #   （data.json 加载与设置面板写回共用同一校验）；写回经
                    #   main.scheduleSettingsPersist 防抖（滑块突发合并，内存即时生效）
  vault-sync.ts     # 库事件同步单一入口（引用更新、索引失效；插件侧补充处理经 hooks 注入）
  i18n.ts / constants.ts / creation.ts
                    # i18n：t() 取文案、tf() 占位符格式化；constants：MD_FILE_SUFFIX、
                    #   hasMindMapMarker/stripMindMapStem/withMindMapMarker（标记后缀唯一实现）
tests/
  md-roundtrip.test.ts # md 往返回归（describe/it 场景矩阵：解析结构/深度/不动点/编辑合成/rawOk 分支矩阵/uid/视图状态）
  md-inline.test.ts    # 行内 token 解析（链接/图片/embed/尖括号 URL 的边界形态）
  domain.test.ts       # domain 层单测（wikilink 契约 + walkTree 语义）
  concurrency.test.ts  # 并发原语回归（串行队列/防抖/节流：错误传播、尾随保证、重置、窗口重置）
  url.test.ts          # URL 谓词边界（各语义的协议形态与否决集）
  save-pipeline.test.ts# SavePipeline 竞态回归（写入中再触发排空、失败上报、防抖/守卫）
  view-state.test.ts   # ViewStateStore（hydrate 形状校验、防抖写盘、flushNow 排空与写盘 Promise 透传）
  settings.test.ts     # sanitizeSettings（类型/取值校验、坏值回退默认）
  settings-persist.test.ts # 设置写回防抖（滑块突发合并、内存即时生效）
  engine-controller.test.ts # EngineController（初始化代际锁、ResizeObserver 零尺寸等待、装配/销毁、引用预检、拖拽抑制、refresh/视口）
  event-binder.test.ts # EventBinder（注册即记录/销毁即清理：参数透传、监听器身份、幂等、单点抛错不阻断）
  persistence.test.ts  # PluginDataWriter（写前重读合并不丢键、串行队列、内部吞错）
  feature-helpers.test.ts # 特性纯函数（drag-target 识别范围几何、image-resize 等比缩放钳制）
  feature-teardown.test.ts # 交互会话收尾（拖拽换父/图片调宽的临时 window 监听随视图关闭清理）
  images-path.test.ts  # 图片地址/尺寸（aspect 校正、官方尺寸语法、探测失败降级）
  file-lookup.test.ts  # 全库文件索引原语（缓存/失效/多形态地址命中）
  links-resolve.test.ts # 统一解析入口（按形态路由与兜底）
  links-tree.test.ts   # 树内引用更新（重命名/清除两模式）
  find-node-by-dom.test.ts # 引擎节点 DOM → 节点实例（右键命中）
  open-as-restore.test.ts # 「以思维导图打开」偏好恢复（多档延时/代际）
  pasted-name.test.ts  # 剪贴板图片命名（Pasted image YYYYMMDDHHMMSS）
  vendor-contract.test.ts # 引擎 vendor 契约（导出面/命令名/事件名令牌）
  view-node-actions.test.ts # 节点操作编排（链接通道分流/删除兜底/剪贴板/自兜错误）
  view-context-menu.test.ts # 右键菜单条目分流（链接双通道/图片/文字，画布菜单）
  view-dnd.test.ts     # 拖入分发（图片/笔记/附件/外部导入、两分支与提示）
  view-search.test.ts  # 搜索栏（装配/防抖/回绕/零命中计数/防抖窗口内跳转）
  view-status.test.ts  # 状态栏计数（节流与尾随、销毁/抛错降级、关闭清理）
  view-wikilink.test.ts # 链接交互（点击分流/双通道取值/悬停预览去重与弹窗锚定尺寸）
  view-hotkeys.test.ts  # 视图内快捷键（F2 编辑当前节点：吞键/让位/去重）
  modal-common.test.ts # 弹窗共享件（settle 守卫/按钮变体/库内文件联想）
  modal-input.test.ts  # 命名/链接弹窗（预填与焦点、空白确认、settle 幂等、联想接线）
  setup.ts             # vitest 全局 setup：Node 环境 window 桩（fake timers 生效）
  mocks/obsidian.ts    # obsidian 最小 mock（vitest alias，包本身无运行时 JS）
docs/
  markdown-mindmap-standard.md  # Markdown ↔ 思维导图映射规则（权威标准）
```

## 测试与 CI

```bash
npm test            # vitest run（CI 在 build 后、lint 前执行）
npm run test:coverage  # vitest run --coverage（v8 provider，报告出 coverage/；CI 主矩阵版本执行并归档产物）
npm run verify:visual  # 无头 Chrome 渲染契约验证（scripts/verify-visual.mjs）
```

CI（`.github/workflows/lint.yml`）执行顺序：build → test → coverage（主矩阵版本）→ lint →
`verify:visual -- --require-chrome`（主矩阵版本；浏览器缺失即失败，不静默跳过）。

- `verify:visual`：把 `src/mindmap.ts`（纯模块）esbuild 成浏览器 IIFE，配仓库真实
  `styles.css` 在无头 Chrome 里渲染 5 个场景并断言 `--dump-dom`——三类链接图标分流与
  图标尺寸（18×18）、回形针标题、画布铺满容器、节点测宽随文本（不被容器拉平），
  外加两个探针：viewport（20 层深链大图必须 100% 缩放、整体内容居中，且重置缩放漂移
  ≤1px）与 anchor（SVG 节点补齐 `offsetWidth/offsetHeight`，弹窗锚定矩形
  `bottom/right` 必须为有限数，否则预览只会出现在上方）。
  这类「引擎运行时 DOM 装配」行为单测覆盖不到（单测只能验证数据字段）。
  无 Chrome 时跳过（`--require-chrome` 改为失败；`--keep` 保留临时目录；
  `CHROME_PATH` 指定浏览器）。
- vitest 配置 `vitest.config.ts`：`obsidian` → `tests/mocks/obsidian.ts` alias（包仅有类型声明，无运行时 JS）。
  coverage 含 `src/**`（排除 i18n/constants 纯文案与常量表），vendor 为预打包产物不纳入。
- `tsconfig.json` 同时纳入 `src/` 与 `tests/`；`npm run build` 会先 `tsc -noEmit` 类型检查两者。
- Lint 基线：`eslint-plugin-obsidianmd ^0.4.2`（与官方 eslint-plugin 仓库同版）。其
  `configs.recommended` 自包含（ESLint core + tseslint recommendedTypeChecked +
  全部 obsidianmd 规则 + sdl/import/depend/no-unsanitized 等三方插件 + package.json
  检查），**勿再展开 `tseslint.configs.recommended`**（plugin 重定义冲突）。
  项目自有覆盖：domain 零依赖边界、统一解析入口强制（features/modal/services/src 根层
  直调 getAbstractFileByPath 拦截，links-resolve/file-lookup 收口点豁免，存在性检查
  特例 eslint-disable 注明理由）、system-open 的 require 全局、modal/tests 豁免、
  manifest.json 与 LICENSE 显式纳入 lint（官方 recommended 不自动拾取两者：
  validate-manifest 自挂 files 块 + ts parser；validate-license 依赖官方内置未导出的
  plain-text parser，等价实现在 scripts/plain-text-parser.mjs）。

## 关键约定

- 链接/图片引用格式：新增链接与图片**恒写 wikilink**（`[[笔记]]` / `[[附件.pdf]]` / `![[图.png]]`），
  不遵循 Obsidian 的 `Use [[Wikilinks]]` / `New link format` 设置——三类图标方案依赖文档双链走
  `mdWikiLinkpath` 通道（自绘文档页图标）；若改为遵循偏好，md 形态笔记链接会落到引擎 hyperlink
  通道并显示原生链接图标，与既定视觉冲突。属**有意偏离**（详见 `docs/external-audit-2026-09-08.md` §5.2/§7.4）。
- 渲染层定位：正文保持纯 Markdown；布局/视口/打开偏好存 `data.json`（`viewState`，按文件路径），不写入文件。
- 打开时的默认视口：**100% 缩放 + 整体内容居中**（按渲染内容包围盒居中，不按根节点——根节点居中会让偏心的树偏向一侧；`mindmap.ts centerContentAtFullScale`：先 `setScale(1, 画布中心)` 再按 `draw.rbox()` 包围盒平移；`createMindMap` 传 `fit: false`，引擎首帧后由 `EngineController.restoreOrFitViewport` 在无保存视口时调用）——大图不再被 fit 压到文字不可读，「适应画布」是工具栏/命令的手动动作；有保存视口时优先恢复。回归由 `npm run verify:visual` 的 viewport 探针覆盖。工具栏另有「重置缩放」（`resetZoom` = **以画布中心为锚点回到 100%**，屏幕可见内容保持原位、不居中节点——只 `setScale(1)` 会绕画布原点跳动），**自动整理后也走 `resetZoom`**（`arrangeMindMap` 的 RESET_LAYOUT 延时回调，不再 fit 全图）。
- 悬停预览（`hover-link`）：`hoverParent` 必须是官方 `HoverParent`——传本视图的 `leaf`（`WorkspaceLeaf` 实现该接口），**勿传裸 HTMLElement**。弹窗上下翻转由核心按 `targetEl` 的矩形决定，而官方 `HoverPopover.position()` 的锚定矩形是**混合取值**：宽高走 `targetEl.offsetWidth/offsetHeight`、位置走 `getBoundingClientRect()`；SVG 节点 group 没有前两个属性（HTMLElement 专有）→ `bottom/right` 为 `NaN` → 官方定位函数「下方放得下就放下方」的分支恒假（预览只出现在上方），上方也放不下时 `top` 被写成 `"NaNpx"`（等于不显示）。故触发前必须调 `view-wikilink.ts ensureOffsetSize(targetEl)` 补上按实时矩形取值的只读几何（`in` 判断，HTMLElement 不覆盖）；指针坐标不参与定位，勿再改写上报的鼠标事件。
- 右键「编辑文本」：`mindmap.ts startNodeTextEdit` 必须**延后一个宏任务**再 emit `node_dblclick`——菜单项 click 会继续冒泡到 `document.body`，引擎 `body_click`（`isEndNodeTextEditOnClickOuter` 默认 true）会立刻关闭刚打开的编辑框；`isInserting` 传 false。
- 图片自定义尺寸（Obsidian 官方嵌入语法，不落 data.json）：`![[图.png|300]]`（仅宽、等比）/ `![[图.png|300x150]]`（宽高）/ `![alt|300](url)`（外链 md 图，尺寸在标签尾部）。解析进 `mdImageWidth/mdImageHeight`（domain/md-meta 契约）；`walkCorrectImageSizesByAspect` 对带参节点按参数定尺寸（仅宽时探测原始比例补高）；拖拽调宽改 engine `imageSize custom:true`，保存时 rawOk 尺寸特征（`目标|宽度`，终界 `]`/`x` 防前缀误匹配）不符 → 合成回写 `|宽度`。
- 图片独占节点（渲染层语义）：纯图行（`- ![[x.png]]`）解析为**无文本节点**（不回退文件名占位），图片节点删除文字（右键「移除文字」/双击清空）后即被图片独占，往返保持；代价是纯图节点不参与文本搜索。图片嵌入语法（`![[..]]`/`![]()`）在 rawOk 的「链接已清除」检测中以负向断言排除（`(?<!!)\[\[`），图文混合行可逐字往返。
- 拖拽换父辅助：引擎落点判定（指针须精确落在目标矩形内）之外，拖拽期间由 `drag-target.ts` 以两类锚点统一按指针距离最近仲裁后外借（引擎每帧重置三态、精确命中时让位）：**节点中心**（均匀圆域 `TARGET_RADIUS_PX`，与节点大小无关）→ 外借 `overlapNode`（挂子，`MOVE_NODE_TO`）；**相邻兄弟间隙中点** → 外借 `prevNode`（插到该兄弟之后，`INSERT_AFTER`）。引擎拖拽内部形态（三态/命令）访问收口在 `mindmap.ts` 的 `getDragDropState`/`setDragOverlapTarget`/`setDragPrevTarget`/`getNodeLayoutRect`/`toCanvasPoint`。
- 新建承载节点（拖入图片/笔记/附件、粘贴、图片子节点）一律走 `view-common.ts insertChildNodeWithData`：统一 `appointNodes=[parent]`（空数组会被引擎静默忽略）与 `isActive:false`，勿再各写一份 `execCommand(INSERT_CHILD_NODE, …)`。
- 中心主题 ⇄ 文件名：编辑根节点文本会重命名 `.mindmap.md`（Obsidian 原生更新链接/反链）；外部改名后视图重载中心随新名。**重命名必须走 `FileManager.renameFile`**（`view-title-renamer.ts`），`Vault.rename` 只改文件系统、不更新库内其他笔记中指向本文件的链接/反链（官方 d.ts 明确要求用前者，核心文件浏览器/内联标题/CLI 均走前者）。
- 图片/链接对齐 Obsidian：`![[路径]]`/`[[笔记]]` 往返；插入弹窗联想库内文件；悬停预览用 `registerHoverLinkSource` + `hover-link`。
- 所有 DOM/事件/定时器监听使用 `this.register*` 助手注册，保证卸载清理；引擎实例事件经 `EventBinder` 记录统一销毁。
- URL/地址形态判断只允许引用 `domain/url.ts` 的谓词（勿手写 startsWith 前缀链）；防抖/节流/串行队列/有界并发映射一律用 `concurrency.ts` 原语（勿手写 timer/chain 字段；批量异步任务勿用无界 Promise.all，用 `mapWithConcurrency`）；扩展名清单集中在 `constants.ts`（基表派生，勿复制）。
- `.mindmap.md` 标记的判定/剥离/拼接一律用 `constants.ts` 的 `hasMindMapMarker` / `stripMindMapStem` / `withMindMapMarker`（勿手写同名正则或 replace）。
- 引擎 `execCommand` 的命令名一律引用 `mindmap.ts` 的 `ENGINE_COMMANDS` 常量（勿写字符串字面量，拼错编译期即报错）。
- 弹窗 Promise 的 settle 守卫用 `modal-common.createModalSettle`（关闭兜底经官方 `Modal.setCloseCallback` 注册，**勿覆写 `modal.onClose`**）；库内文件输入联想用 `modal-common.VaultFileSuggest`（勿再各写一份 AbstractInputSuggest 子类）。
- i18n 含 `{name}` 占位符的文案用 `tf(lang, key, params)` 格式化（勿手写 .replace 链）。
- vault rename/delete/create 事件只在 `VaultSyncService.attach` 注册一次，插件侧补充处理经 hooks 注入（勿再 registerEvent 第二份订阅）。
- 命名对照：类名 `MindMapStudioPlugin/MindMapStudioSettings/MindMapStudioSettingTab`（历史上曾以插件旧名 TheMindMap 命名，已随品牌更名统一）。
- 引擎内部形态（`node.group`、导出倍率 `opt`、Search 插件状态、DoExport、
  `renderer.textEdit` 等）的访问只出现在 `mindmap.ts` 防腐收口函数中（`services/engine-controller.ts`
  为同类防腐层），视图层经具名函数使用。
- `errors.ts`：`errorMessage` 提取消息；用户可见错误提示统一用 `notifyError(lang, key, error)`
  （勿再手写 Notice 拼接）。
- 交互对齐 Obsidian 官方帮助（`Editing shortcuts` / `Attachments` / `Drag and drop`）：
  - 视图内 `Mod+Z` / `Mod+Shift+Z` / `Mod+Y` = 引擎撤销/重做（属系统级编辑快捷键，
    非命令默认热键，不违反 no-default-hotkeys；引擎自身未绑定，由视图 scope 接管）；
  - 视图内 `F2` = 编辑当前激活节点文本（`features/view-hotkeys.handleEditNodeHotkey`，
    同由视图 scope 接管）：引擎自己也绑了 F2，但其 `onKeydown` 要求事件目标为
    `document.body` 且指针在画布内（`enableShortcutOnlyWhenMouseInSvg` 默认 true），
    点击节点后常不触发；处理器接管后即阻断冒泡（否则引擎的 window 级监听会再
    hide+show 一次，编辑框闪烁），并在输入框/编辑框内让位、正在编辑时忽略——
    本视图内核心 F2「重命名文件」因此不再触发（根节点文本仍同步文件名）；
  - 剪贴板粘贴图片按核心约定命名 `Pasted image YYYYMMDDHHMMSS`
    （`images-save.buildPastedImageName`；`SaveImageOptions.filename` 显式命名
    优先于 File.name 与 preferredName，仅粘贴路径使用）；
  - 外部拖入图片=导入附件目录并挂到节点（与官方拖入行为一致，保留原文件名）；
  - 命令一律不定义默认热键（用户经 Hotkeys 设置自行分配）。
- Obsidian API 合规（已对照官方 obsidian.d.ts 1.13.2 审计）：所用 API 全部为官方面
  （含 `FileSystemAdapter.getBasePath`、`getAvailablePathForAttachment`、
  `getFirstLinkpathDest`、`registerHoverLinkSource`、`SettingDefinitionItem` 等），
  零废弃 API 使用。仅存三处**无官方等价**的私有触点，均防御式实现并文档化：
  ① `features/file-creator.ts` file-explorer「新建」菜单注入（官方仅有 file-menu，
  无 fileCreator 公共 API）；② `links-resolve.ts` 拖拽兜底 `dragManager`；
  ③ `system-open.ts` 桌面端 `require('electron').shell.openPath`（d.ts 无系统打开 API）。
  勿新增私有 API 触点；官方补齐后优先替换。
- 引擎 vendor 文件不可手工编辑；升级时用官方源码重新打包并替换（流程见 `vendor/BUILD.md`）；
  `styles.css` 的 vendor 段由 `npm run sync-vendor-css` 重建，勿手工编辑标记之间内容。
- 库内文件解析只走 `links-resolve.resolvePathToFile` 统一入口（勿自建 getAbstractFileByPath/索引/线性扫描组合）；索引原语在 `file-lookup.ts`。features/ 与 modal-*.ts 由 eslint `no-restricted-syntax` 机械强制（存在性检查等特例须 disable 并注明理由）。
- view-* 模块经 `ViewPluginContext` 访问插件能力（settings 活引用/viewState/statusBar 服务），不接触插件实例与状态栏 DOM；节点/悬停等视图态用模块级 WeakMap 内聚，不加到 `MindMapViewContext`。
- view-* 模块按需依赖子上下文（R4 上下文瘦身）：只碰 UI 元素的拿 `ViewDomContext`，只碰引擎的拿 `ViewEngineContext`，再与 `Pick<MindMapViewContext, 'lang' | …>` 组合成模块内最窄面（示范：view-search/view-status）；勿默认依赖整个 `MindMapViewContext` 装配面，新成员先落到对应子面。

## 发布流程

1. 更新 `manifest.json` 版本号 → `npm version patch|minor|major`（同步 `versions.json`）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`（`.github/workflows/release.yml` 自动构建并创建草稿 Release）。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
