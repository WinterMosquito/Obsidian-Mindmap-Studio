# MindMap Studio — Obsidian 社区插件（Markdown 渲染层）

## 项目概览

- 目标：Obsidian 社区插件（TypeScript → 打包为 JavaScript）。
- 定位：**Markdown 渲染层**——`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），插件解析为思维导图、编辑后无损回写为 Markdown；无任何专有格式。
- 入口：`src/main.ts`，编译为 `main.js`，由 Obsidian 加载。
- 发布产物：`main.js`、`manifest.json`、`styles.css`。
- 插件标识：`id: mindmap-studio`（安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`）。
- 引擎：`simple-mind-map 0.14.0-fix.3`——思绪思维导图（sxmind.cn）发布的第三方修订版（fork 自 wanglin2/mind-map 0.14.0，修订清单见 `vendor/BUILD.md`），以压缩产物 vendor 于 `vendor/simple-mind-map.cjs`（按需 tree-shake 重打包，附手写类型声明 `vendor/simple-mind-map.d.cts`）。**不 vendor 引擎 CSS**：上游 dist CSS 100% 是 Quill 富文本样式（本插件不注册 RichText），引擎样式由 bundle 运行时注入 `document.head`（详见 `vendor/BUILD.md`）。打包/升级流程见 `vendor/BUILD.md`。

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
    document-service.ts # md 文档读取解析 + 保存管线（防抖/串行排空/卸载快照兜底，onSaveError 上报；
                        #   写盘前 cachedRead 比对，内容一致跳过 modify）；
                        #   解析只做图片地址解析，不做尺寸归一（视图走 aspect 校正）；写盘归属：树快照与 frontmatter 按**该次写盘的文件**取（getSnapshotFor/getFrontmatterFor），不同文件不并入同一批次——core 不 await onUnloadFile，换文件期间的排空必须同源
    engine-controller.ts# 引擎实例生命周期 + 防腐收口（renderer 内部不外泄）
  features/
    view.ts         # Controller：Obsidian 生命周期编排、service 装配、链接跳转、标题重命名
    view-context.ts # MindMapViewContext：view-* 对视图的访问契约（结构化窄接口）
    view-*.ts       # 工具栏/拖拽/右键/搜索/导出/状态栏/图片灯箱/图片动作与全屏/wikilink 交互与
                    #   链接跳转（view-link-navigator）/粘贴/节点操作/标题重命名（view-title-renamer）/
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
  commands.ts       # 命令注册与命令面板入口（COMMAND_IDS 为命令 ID 唯一表，发布后永不变更）
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
  view-state.ts     # 按文件路径持久化布局/连线样式/视口/openAs 到插件 data.json（ViewStateStore）
  images-path.ts    # 图片地址→资源地址（经统一解析入口）、外部地址判断、尺寸校正
  images-save.ts    # 图片入库（走 concurrency 串行队列）、文件名清理
  file-lookup.ts    # 全库文件查找索引原语（buildFileLookupIndex/FileLookupIndexService/
                    #   lookupIndexedFile；多种地址形态→TFile 的 O(1) 缓存查询）
  links-resolve.ts  # 统一解析入口 resolvePathToFile：按形态路由（远程拒绝/obsidian:///
                    #   资源地址→索引/路径直查/file://→官方 getFirstLinkpathDest→索引兜底）
  links-tree.ts     # 树内引用更新（重命名/清除共用同一遍历实现，mode 参数区分）；改写形态跟用户走（有前缀继续写路径）但路径取**新位置**（跨文件夹移动只换 basename 会悬空）；非 .md 文档（canvas/base）必须带扩展名
  modal-*.ts        # 链接/图片/命名弹窗（官方 AbstractInputSuggest 联想；
                    #   settle 守卫与 VaultFileSuggest 联想类收口在 modal-common.ts）
  mindmap.ts        # 引擎封装（创建/销毁/节点工具）+ 防腐收口（缩放/getRenderRoot/setNodeText/
                    #   forceRemoveNodeData/getNodeGroupEl/runWithExportScale/countTreeNodes/
                    #   exportMindMapPng/search* 系列/isEditingText/getRootText/startNodeTextEdit）
                    #   + ENGINE_COMMANDS：引擎命令名常量表（execCommand 勿再写魔法字符串）
                    #   —— 视图/特性层不直接触碰引擎 renderer/view/search/doExport 内部形态
  mindmap-theme.ts  # 主题配置（buildThemeConfig 唯一实现，视图主题参数化差异：
                    #   亮/暗 + 连线样式；lineStyleForLayout 布局默认、resolveLineStyle 偏好解析）
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
  save-pipeline.test.ts# SavePipeline 竞态回归（写入中再触发排空、失败上报、防抖/守卫、无差异写盘跳过）
  view-state.test.ts   # ViewStateStore（hydrate 形状校验、布局/连线样式/视口按文件存取、防抖写盘、flushNow）
  settings.test.ts     # sanitizeSettings（类型/取值校验、坏值回退默认）
  settings-persist.test.ts # 设置写回防抖（滑块突发合并、内存即时生效）
  engine-controller.test.ts # EngineController（初始化代际锁、ResizeObserver 零尺寸等待、装配/销毁、引用预检、拖拽抑制、refresh/视口）
  event-binder.test.ts # EventBinder（注册即记录/销毁即清理：参数透传、监听器身份、幂等、单点抛错不阻断）
  persistence.test.ts  # PluginDataWriter（写前重读合并不丢键、串行队列、内部吞错）
  feature-helpers.test.ts # 特性纯函数（drag-target 识别范围几何、image-resize 等比缩放钳制）
  mindmap-theme.test.ts # 主题配置（布局→连线样式映射、切换判定 supportsLineStyleSwitch、偏好解析与透传）
  feature-teardown.test.ts # 交互会话收尾（拖拽换父/图片调宽的临时 window 监听随视图关闭清理）
  images-path.test.ts  # 图片地址/尺寸（aspect 校正、官方尺寸语法、探测失败降级）
  file-lookup.test.ts  # 全库文件索引原语（缓存/失效/多形态地址命中）
  links-resolve.test.ts # 统一解析入口（按形态路由与兜底）
  links-tree.test.ts   # 树内引用更新（重命名/清除两模式）
  find-node-by-dom.test.ts # 引擎节点 DOM → 节点实例（右键命中）
  node-text-edit.test.ts # 右键「编辑文本」入口（延后一宏任务 emit node_dblclick、isInserting=false）
  viewport.test.ts     # 视口几何（resetZoom 画布中心锚点 / 内容包围盒居中 / 自动整理后重置缩放）
  open-as-restore.test.ts # 「以思维导图打开」偏好恢复（多档延时/代际）
  pasted-name.test.ts  # 剪贴板图片命名（Pasted image YYYYMMDDHHMMSS）
  vendor-contract.test.ts # 引擎 vendor 契约（导出面/命令名/事件名令牌）
  view-node-actions.test.ts # 节点操作编排（链接通道分流/删除兜底/剪贴板/自兜错误）
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
  setup.ts             # vitest 全局 setup：Node 环境 window 桩（fake timers 生效）
  mocks/obsidian.ts    # obsidian 最小 mock（vitest alias，包本身无运行时 JS）
docs/
  markdown-mindmap-standard.md  # Markdown ↔ 思维导图映射规则（权威标准）
  release-notes-0.0.*.md        # 各版本发布说明（中英双语；release.yml 作 Release 说明取用）
```

### 文件规模与豁免（超限须登记）

官方社区模板建议单文件控制在 200–300 行。本项目**不做机械拆分**——按「拆分会不会把已有收口职责摊开」判定，而不是按行数判定：行数是症状，收口点被拆散才是病。故引入一条硬规则：

> **超过 300 行的源文件必须在下方表格登记豁免理由；未登记者一律视为待偿还债务。**

（豁免是「已知并接受」，不是「没看见」。债务指标：**未登记的超限文件数，只允许递减**。）

| 文件 | 行数 | 豁免理由 |
|---|---|---|
| `src/mindmap.ts` | 820 | 引擎防腐层**唯一收口点**：vendor 内部形态（`node.group`、`renderer.*`、DoExport、Search 插件状态…）只允许在此出现。拆开等于把私有访问面摊到多个文件，耦合面反而变大——**这一条是必须豁免的，拆分即违约** |
| `src/md-serialize.ts` | 656 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。（链接「生效显示名」的纯判定已下沉 `domain/wiki-display.ts` 供 `mindmap.ts` 复用——那是**跨模块复用**，不是本文件内聚被拆） |
| `src/md-outline.ts` | 708 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则，拆开会让两侧规则漂移 |
| `src/i18n.ts` | 419 | 纯词条表（无逻辑分支），拆分只增加 import 噪音，无内聚收益 |
| `src/features/view.ts` | 529 | 视图 Controller：**第 6 步拆分后的纯编排壳**（见文件头契约）。只做「生命周期事件 → 装配 services 与 view-* 交互特性」；业务已全部外置（DocumentService/EngineController/TitleRenamer/openHyperlink…）。再拆会把「生命周期编排顺序集中可见」这一收口点摊到多文件 |
| `src/services/engine-controller.ts` | 438 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法。与 `mindmap.ts` **同性质**——拆开即把私有访问面摊开，故同样必须豁免 |
| `src/images-path.ts` | 334 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一），**从 images.ts 拆出**的产物；导出函数共享同一套路径与尺寸不变式，再拆会摊成跨文件的隐式协议 |
| `src/features/image-resize.ts` | 323 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链（无常驻监听、按帧重建元素、手势独占），拆开会让状态机与 DOM 手柄跨文件失配 |
| `src/features/drag-target.ts` | 322 | 单一算法收口（拖拽落点仲裁）：两类锚点（节点中心／兄弟间隙中点）必须共用同一套「按指针距离最近仲裁 + 引擎三态让位」规则，拆开会让锚点判定与视觉高亮口径漂移 |
| `src/features/view-node-actions.ts` | 324 | 节点操作（链接/文本/剪贴板/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export，此处是剩余语义相关操作集，再拆会让两个菜单的调用面分叉 |
| `src/features/view-dnd.ts` | 324 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配 |
| `src/main.ts` | 302 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。业务逻辑已全部外置（见文件头），拆开 onload 会破坏「装配顺序集中可见」的可读性收益；当前仅超线 2 行 |

行数为 2026-09-10 快照（2026-09-10 复核：全部 12 个超限文件均已登记理由），仅供参考；判定以「是否已在表内登记理由」为准，不以数字为准。

## 测试与 CI

```bash
npm test            # vitest run（CI 在 build 后、lint 前执行）
npm run test:coverage  # vitest run --coverage（v8 provider，报告出 coverage/；CI 主矩阵版本执行并归档产物）
npm run verify:visual  # 无头 Chrome 渲染契约验证（scripts/verify-visual.mjs）
```

CI（`.github/workflows/lint.yml`）执行顺序：build → `npm test -- --reporter=verbose --bail=1` →
coverage（主矩阵版本，并上传 coverage 产物）→ lint →
`verify:visual -- --require-chrome --keep --log-dir verify-visual-logs`（主矩阵版本）。

`verify:visual` 这一步标了 `continue-on-error: true`（**非阻断**），因为它曾在 Linux 无头
环境偶发失败，而当时既读不到失败日志、又无 token 调 API 定位，最终被回退（见 commit
`7930d62`）。重新接入的前提就是「失败必须留下证据」，故同时加了 `--log-dir`：日志与
`--dump-dom` 快照经 `if: always()` 步骤归档成 artifact，失败时可直接下载定位。
浏览器缺失仍然直接失败（`--require-chrome`），不静默跳过。

- `verify:visual`：把 `src/mindmap.ts`（纯模块）esbuild 成浏览器 IIFE，配仓库真实
  `styles.css` 在无头 Chrome 里渲染 5 个场景并断言 `--dump-dom`——三类链接图标分流与
  图标尺寸（18×18）、回形针标题、画布铺满容器、节点测宽随文本（不被容器拉平），
  外加三个探针：viewport（20 层深链大图必须 100% 缩放、整体内容居中，且重置缩放漂移
  ≤1px）、anchor（SVG 节点补齐 `offsetWidth/offsetHeight`，弹窗锚定矩形
  `bottom/right` 必须为有限数，否则预览只会出现在上方）与 layout（六种布局各渲一遍：
  节点数、连线样式分派——曲线布局的连线必须全含 C/Q、四种直线布局必须零曲线——
  以及**根节点连线起点必须落在节点边缘**（从中心起画＝「斜戳」衔接回归）；
  连线路径统计须排除 `class="smm-node-shape"` 的节点形状路径，否则圆角命令会被
  误判成曲线；并断言引擎快捷键表非空且**不含 `Control+l`**——自动整理不得留默认热键）。
  **负向自检已做**：`rootLineStartPositionKeepSameInCurve` 改回 false 报出 4 项失败；
  临时停用 `removeEngineShortcut` 报出「Ctrl+L 仍注册」1 项失败。
  这类「引擎运行时 DOM 装配」行为单测覆盖不到（单测只能验证数据字段）。
  无 Chrome 时跳过（`--require-chrome` 改为失败；`--keep` 保留临时目录；
  `--log-dir <dir>` 把环境信息、每次 Chrome 尝试的退出码与 stderr、完整 `--dump-dom`
  以及逐场景失败片段写进该目录——CI 靠它归档失败证据；
  `CHROME_PATH` 指定浏览器，路径不存在时自动回落到平台默认安装位置）。
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
  plain-text parser，等价实现在 scripts/plain-text-parser.mjs——该实现的唯一有意差异是
  **剥离行尾 `\r`**：官方只按 `\n` 切分，CRLF 检出（`core.autocrlf=true`）下残留的 `\r`
  会让版权行正则 `(.+)$` 匹配失败、规则静默失效，故加固之，勿改回逐字一致）。
- **lint 依赖 manifest 且是 cwd 相对的**：`eslint-plugin-obsidianmd` 的 `getManifest()`
  用 `fs.readFileSync("manifest.json")`，**相对 `process.cwd()`**——故必须在**插件根**
  跑 `npm run lint`。cwd 不对（如从仓库根/父目录跑）时 manifest 读成 `null`，会让
  ① `no-nodejs-modules`（`isDesktopOnly` 为 true 时 `off`）、② `regex-lookbehind`
  （仅 `isDesktopOnly !== true` 才 report）、③ `globals.node` 注入 三者**同时翻到
  「非桌面」分支**，产生假告警与假 `no-undef`。即：上一节 `isDesktopOnly` 豁免的
  「lint 通过」是 **cwd 相关**的结论，不是无条件事实。
- **`no-unsupported-api` 的两条静默失效路径**（都不报错，而是规则整条 `return {}`）：
  ① 阈值取 `options.minAppVersion ?? getManifest()?.minAppVersion`，manifest 读不到即关闭；
  ② 版本信息取自**项目实际安装的 typings**（`findObsidianDtsPath(program)` 在 TS program
  里找 `.../obsidian/obsidian.d.ts`，`@since` 映射缓存于
  `node_modules/.cache/eslint-plugin-obsidianmd/since-map.json`，按 obsidian 包版本为 key）——
  故**lint 的可见版本上沿＝安装的 typings 版本**，既不是插件自带的 obsidian 版本，也不是
  官方最新发布版本。升级/降级 `obsidian` 依赖都会改变这条规则的判定基准（缓存自动重建）。

## 关键约定

- 链接/图片引用格式：新增链接与图片**恒写 wikilink**（`[[笔记]]` / `[[附件.pdf]]` / `![[图.png]]`），
  不遵循 Obsidian 的 `Use [[Wikilinks]]` / `New link format` 设置——三类图标方案依赖文档双链走
  `mdWikiLinkpath` 通道（自绘文档页图标）；若改为遵循偏好，md 形态笔记链接会落到引擎 hyperlink
  通道并显示原生链接图标，与既定视觉冲突。属**有意偏离**（依据：审计文档 `docs/external-audit-2026-09-08.md` §5.2/§7.4；该文档已从工作树移除，需要时用 `git log --diff-filter=D -- docs/external-audit-2026-09-08.md` 从历史取回）。
- 渲染层定位：正文保持纯 Markdown；布局/视口/打开偏好存 `data.json`（`viewState`，按文件路径），不写入文件。
- 打开时的默认视口：**100% 缩放 + 整体内容居中**（按渲染内容包围盒居中，不按根节点——根节点居中会让偏心的树偏向一侧；`mindmap.ts centerContentAtFullScale`：先 `setScale(1, 画布中心)` 再按 `draw.rbox()` 包围盒平移；`createMindMap` 传 `fit: false`，引擎首帧后由 `EngineController.restoreOrFitViewport` 在无保存视口时调用）——大图不再被 fit 压到文字不可读，「适应画布」是工具栏/命令的手动动作；有保存视口时优先恢复。回归由 `npm run verify:visual` 的 viewport 探针覆盖。工具栏另有「重置缩放」（`resetZoom` = **以画布中心为锚点回到 100%**，屏幕可见内容保持原位、不居中节点——只 `setScale(1)` 会绕画布原点跳动），**自动整理后走「适应画布」**（`arrangeMindMap` 的 RESET_LAYOUT 延时回调 → `fitMindMap`：性能模式下先 `forceLoadNode` 再 `fit`，按全图包围盒适配）。
- **连线样式（偏好 + 布局联动）**：六种布局中**四种为直线**——组织结构图经 `lineStyle: 'straight'`
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
- **根节点连线衔接**：主题配置设 `rootLineStartPositionKeepSameInCurve: true`——引擎**默认从节点
  中心起画**，根节点→首层子节点的曲线在节点内部就已偏出、从上/下边缘**斜穿而出**（衔接呈
  「斜戳」观感）；其余层级本就以边缘为起点。开启后根节点与其它层级一致：右缘水平出发再展开。
  回归锁定在 `tests/mindmap-theme.test.ts`。
- **切换布局后自动整理一次**：`EngineController.setLayout` 末尾调 `arrangeMindMap`（`RESET_LAYOUT`
  清除自由拖拽坐标 + 延时 `fitMindMap`）——否则旧布局下手动拖过的节点会带着 `customLeft/customTop`
  留在新布局里；且引擎 `setLayout` 内部会把视口变换归零，不 fit 画面会停在左上角。故**切换布局后
  的视口恒为「适应画布」状态**（这也是布局切换与「打开时 100% + 内容居中」两套视口语义的分界）。
  回归见 `tests/engine-controller.test.ts`。
- **无差异写盘跳过**：`SavePipeline.save` 在 `vault.modify` 前用 `vault.cachedRead` 比对
  **文件当前内容**，一致则跳过写盘（`vault.modify` 即使内容一字未变也会刷新 mtime、惊动元数据
  缓存与同步；典型场景是「自动整理」——只清引擎内部拖拽坐标，Markdown 文本没变）。
  只跳过「要写的正是文件里已有的内容」，绝不吞掉真实差异；`cachedRead` 缺失（测试桩/老运行时）
  或读取抛错时回退为照常写盘（fail-open，绝不因读失败丢写）。回归见 `tests/save-pipeline.test.ts`。
- **默认热键归零**：引擎 `KeyboardNavigation` 插件自带 **Ctrl+L = RESET_LAYOUT**（只重排、
  不含「适应画布」），与「自动整理」命令口径冲突，已在 `createMindMap` 末段经
  `keyCommand.removeShortcut` 移除——自动整理统一走 `mindmap-arrange` 命令（用户自行绑热键，
  绑到 Ctrl+L 时同样以「适应画布」收尾）。回归由 `verify:visual` 的 layout 探针锁定
  （`engineShortcuts` 不得含 `Control+l`，并带"快捷键表非空"前提断言）。
- 悬停预览（`hover-link`）：`hoverParent` 必须是官方 `HoverParent`——传本视图的 `leaf`（`WorkspaceLeaf` 实现该接口），**勿传裸 HTMLElement**。弹窗上下翻转由核心按 `targetEl` 的矩形决定，而官方 `HoverPopover.position()` 的锚定矩形是**混合取值**：宽高走 `targetEl.offsetWidth/offsetHeight`、位置走 `getBoundingClientRect()`；SVG 节点 group 没有前两个属性（HTMLElement 专有）→ `bottom/right` 为 `NaN` → 官方定位函数「下方放得下就放下方」的分支恒假（预览只出现在上方），上方也放不下时 `top` 被写成 `"NaNpx"`（等于不显示）。故触发前必须调 `view-wikilink.ts ensureOffsetSize(targetEl)` 补上按实时矩形取值的只读几何（`in` 判断，HTMLElement 不覆盖）；指针坐标不参与定位，勿再改写上报的鼠标事件。**触发面**（`view-wikilink.nodeLink`）：只有库内链接触发，三类等价——文档双链/文档嵌入（`mdWikiLinkpath`）、双链附件/嵌入附件/拖入附件（**门控 `attachmentUrl`**：`mdAttachmentLinkpath` 在「移除引用」后会残留，光看它会留下"幽灵引用"；linktext 取原始 linkpath，`attachmentUrl` 可能已被视图层重写成资源地址）、URL 外链**不触发**（核心只服务库内目标，与阅读视图一致）；`event.buttons !== 0`（拖拽节点滑过其它节点 / 框选扫过）同样不触发——引擎只在"被拖的那个节点"上抑制 `node_mouseenter`。
- 右键「编辑文本」：`mindmap.ts startNodeTextEdit` 必须**延后一个宏任务**再 emit `node_dblclick`——菜单项 click 会继续冒泡到 `document.body`，引擎 `body_click`（`isEndNodeTextEditOnClickOuter` 默认 true）会立刻关闭刚打开的编辑框；`isInserting` 传 false。
- 图片自定义尺寸（Obsidian 官方嵌入语法，不落 data.json）：`![[图.png|300]]`（仅宽、等比）/ `![[图.png|300x150]]`（宽高）/ `![alt|300](url)`（外链 md 图，尺寸在标签尾部）。解析进 `mdImageWidth/mdImageHeight`（domain/md-meta 契约）；`walkCorrectImageSizesByAspect` 对带参节点按参数定尺寸（仅宽时探测原始比例补高）；拖拽调宽改 engine `imageSize custom:true`，保存时 rawOk 尺寸特征（`目标|宽度`，终界 `]`/`x` 防前缀误匹配）不符 → 合成回写 `|宽度`。
- 图片独占节点（渲染层语义）：纯图行（`- ![[x.png]]`）解析为**无文本节点**（不回退文件名占位），图片节点删除文字（右键「移除文字」/双击清空）后即被图片独占，往返保持；代价是纯图节点不参与文本搜索。「链接已清除」检测**只排除指向本节点图片的嵌入**（非嵌入语法仍是负向断言 `(?<!!)\[\[`），图文混合行可逐字往返；**文档/附件嵌入按链接形态处理**——字段被清空后一并剥离（`rawHasForeignEmbed`），不再整行回写导致链接复活。
- **行级保真与 `---` 的两种身份**：plain 行的 `mdRaw` 存**未 trim 原文**（`text` 才是 trim 后的显示文本）——缩进代码块（4 空格起）与「行尾两空格 = 硬换行」都是 Markdown 语义，trim 掉即等于改动文件；**列表续行**只保留行尾原文，行首缩进由序列化器按树深度补 `restIndent`（避免双份）。`---`/`-----` 纯短横线行**必须分两种身份**（`md-outline.ts` 的 `isDashLine` 判定）：**空行之后** = 结构分隔线 → 按既定行为整行丢弃；**紧跟非空行之后** = CommonMark 的 **setext H2 下划线 → 保留**（`标题\n---` 是二级标题，丢弃会把标题静默降级为段落）；列表/标题之后的短横线行同样保留为独立分隔线（由序列化器的块分隔补空行）。`=====`（setext H1）一直保留，两条 setext 形态已对齐。
- 文档嵌入 `![[笔记]]` / `![[笔记.md]]`（目标末段为文档类扩展名 `.md` / `.canvas` / `.base`，或无扩展名）与文档双链**同通道**（`mdWikiLinkpath` + `mdLinkStyle: 'wiki'` + `mdEmbed: true`）：显示同一枚自绘文档页图标，节点文本 = 别名‖去 `.md` 的目标名，悬停/点图标行为与文档双链一致。**管道位是别名**（`![[笔记|300]]` 的 `300` 是别名，**不是**宽 300）——故解析侧**不得**沿用 `tokenizeInline` 已按图片尺寸剥过的 `tok.label`，必须从原始切片 `parseWikilink` 重解（见 `md-outline.ts` 非图片嵌入分支）。非文档类嵌入（`![[报告.pdf]]` / `![[录音.mp3]]`）才走附件通道（回形针）；其管道位官方**无明文**（PDF 用 `#height=` / `#page=`、音频无尺寸语法），故不解释、原文存 `mdEmbedPipe`，编辑节点后原样回写（不再丢参数）。两类都记 `mdEmbed`，`md-serialize.renderHyperlink` 据此补回 `!`（文档通道即 `effectiveDocWikiLink` 结果前加 `!`）。「是否文档」统一走 `domain/wikilink.isDocumentExtension`（md / canvas / base），「是否附件」统一走 `domain/wikilink.wikilinkTargetIsAttachment`——**勿**再手写 `extension === 'md'`（拖入、链接弹窗、插入链接三处曾各写一份，Canvas/Bases 被判成附件）；点击可打开性走 `constants.canOpenInObsidian`，其清单必须含 `base`（漏登记会把指向 base 的链接误判「无法预览」，回归 `tests/constants.test.ts`）。悬停预览与 `Ctrl/Cmd+点击`走**同一分流**（`view-wikilink.nodeLink`），故附件节点与文档节点等价可预览/可打开（此前只读 `mdWikiLinkpath`/`hyperlink`，附件节点两处都是静默无响应）。回归见 `tests/md-roundtrip.test.ts` 的「文档嵌入」6 例（已验证负向对照：把分流改回「非图片＝附件」即 6 例全红）。
- **`[[]]` / `![[]]` 支持度审计结论（对照官方帮助 + `obsidian.d.ts`，四项决策均为「保持现状」）**：① 笔记嵌入的管道位按**别名**处理（`![[笔记|300]]` 的 `300` 是别名，节点文本即显示 `300`）——官方**无明文**，依据 API `Reference.displayText`（`[[page|display name]] → display name`）口径推断，属**有意取舍**；若官方日后改为尺寸/忽略，整改方向是「管道位原文保留」（同 `mdEmbedPipe`），届时再动。② 空 `[[]]` 保持字面文本（Obsidian 亦不视为链接，官方未记载）。③ 一行多链接只有首个可点/可悬停（引擎单链接槽位；官方阅读视图每枚均可点）——未编辑逐字保真、编辑后降级为单链接，已登记。④ **不采用**官方 `parseLinktext` / `getLinkpath` 替换自研 `parseWikilink`：官方那两个函数只给 `path` / `subpath`、**不给别名**，换过去不减代码且会破 domain 零依赖边界；导航已用官方 `getFirstLinkpathDest` + `openLinkText(inner)`，标题/块子路径交核心处理。
- **`isDesktopOnly` 是承重配置，不是发布元数据**：上一行的负向断言 `(?<!!)\[\[` 属**正则后行断言**（lookbehind），而官方规则 `obsidianmd/regex-lookbehind` **仅在 `isDesktopOnly !== true` 时报告**——其实现为 `options.isDesktopOnly ?? getManifest()?.isDesktopOnly`（`eslint-plugin-obsidianmd/dist/lib/rules/regexLookbehind.js`），`true` 时整个 `Literal` 分支直接不报。即：**这行 lint 通过完全依赖 `manifest.json` 的 `isDesktopOnly: true`**，不是因为它本身合规。改 `isDesktopOnly`、或要加移动端支持之前，**必须先把该正则改写为不带 lookbehind 的等价式**（如 `(^|[^!])\[\[`），否则 ① `npm run lint --max-warnings 0` 立刻失败；② iOS < 16.4（Safari 16.4 才支持 lookbehind）会**真实抛异常**，`md-serialize` 整条保存管线随之失效。
- 拖拽换父辅助：引擎落点判定（指针须精确落在目标矩形内）之外，拖拽期间由 `drag-target.ts` 以两类锚点统一按指针距离最近仲裁后外借（引擎每帧重置三态、精确命中时让位）：**节点中心**（均匀圆域 `TARGET_RADIUS_PX`，与节点大小无关）→ 外借 `overlapNode`（挂子，`MOVE_NODE_TO`）；**相邻兄弟间隙中点** → 外借 `prevNode`（插到该兄弟之后，`INSERT_AFTER`）。引擎拖拽内部形态（三态/命令）访问收口在 `mindmap.ts` 的 `getDragDropState`/`setDragOverlapTarget`/`setDragPrevTarget`/`getNodeLayoutRect`/`toCanvasPoint`。
- 新建承载节点（拖入图片/笔记/附件、粘贴、图片子节点）一律走 `view-common.ts insertChildNodeWithData`：统一 `appointNodes=[parent]`（空数组会被引擎静默忽略）与 `isActive:false`，勿再各写一份 `execCommand(INSERT_CHILD_NODE, …)`。
- 中心主题 ⇄ 文件名：编辑根节点文本会重命名 `.mindmap.md`（Obsidian 原生更新链接/反链）；外部改名后视图重载中心随新名。**重命名必须走 `FileManager.renameFile`**（`view-title-renamer.ts`），`Vault.rename` 只改文件系统、不更新库内其他笔记中指向本文件的链接/反链（官方 d.ts 明确要求用前者，核心文件浏览器/内联标题/CLI 均走前者）。
- 图片/链接对齐 Obsidian：`![[路径]]`/`[[笔记]]` 往返；插入弹窗联想库内文件；悬停预览用 `registerHoverLinkSource` + `hover-link`。合成路径下**外链图片恒写 `![alt|尺寸](url)`**（外链判定先于 `image === mdImageTarget`；`mdImageTarget` 是解析期快照、换图后会过期，地址取当前 `image`）。
- 双链节点别名语义（**节点内只显示别名，编辑节点即改别名**）：纯双链节点（整行只有一个双链，节点内显示的就是该链接的可见名＝别名优先）里节点内容等价于别名，故编辑节点后把新文本写成别名回写 `[[目标|新别名]]`（纯判定在 `domain/wiki-display.ts`：`editedWikilinkAlias` + `effectiveDocWikiLink` + `docWikiLinkDisplay`；链接改写走 `domain/wikilink.ts withWikilinkAlias`），不再产出「新文本 + 行尾链接」。边界：① 混合文本节点（`说明 [[链接]]`）不适用——把整段文本当别名会静默吞掉说明文字；② 多行文本不适用（无唯一别名语义，回落旧合成）；③ **附件**嵌入 `![[报告.pdf]]` 不适用（管道位是尺寸参数，不是别名）——但**文档嵌入** `![[笔记]]` 适用（管道位是别名，见下条）；④ URL / md 链接无别名概念，不适用；⑤ 新别名含 `[` / `]`（用户手输 `[[新目标]]`）→ 不写（Obsidian 不允许方括号出现在 `[[..]]` 内，写进别名位会把整条链接写坏），回落旧合成＝语义上更接近「换链」。新文本与「无别名时的默认显示名」相同（或清空）→ 不写 `|别名` 段（避免 `[[目标|目标]]`），清空文本 = 去别名、链接保留。回写（`renderHyperlink`）与可见名（`nodeLinkDisplay`）必须经同一入口 `effectiveDocWikiLink`，两处口径不一致会让「纯 token 节点」判定失配、合成写出「新文本 + 链接」重复一次。**文档页图标的 tooltip 也走同一入口**（`mindmap.ts` 经 `docWikiLinkDisplay`）——图标 `<title>` 只在节点前缀创建时写一次，若改读解析快照 `mdLinkText`，编辑改别名后 tooltip 会停留在旧别名直到重载；契约已由 `tests/mindmap-wiki-icon.test.ts` 锁定（含负向自检）。注意：`mdLinkText` 存的是**解析时的原显示名**，是「该节点是否被编辑」的判据之一（见 `editedWikilinkAlias` 闸门 4），**不可**在编辑后把它同步成新别名——那会让判据失效、别名回写整条失效。
- **渲染层不修解析层遗留**（渲染/解析解耦）：显示名一律取解析层产物（`domain/wikilink.linkDisplayText` 一族），渲染层**只读不改**。典型遗留：`[[folder/笔记.md#标题]]` 这类带子路径的双链，显示名保留 `.md`（`笔记.md#标题`）——文档双链与文档嵌入**口径一致**，属解析期历史包袱；**勿**在 `mindmap.ts` / `view-*` / 悬停预览里补「剥 `.md`」的 render-time 修正分支（会牵动 rawOk 逐字回写与「纯 token 节点」判定，牵一发动全身）。
- **节点状态与附件元数据隔离**（新的静态渲染只走视图层）：悬停预览 / 图标 / tooltip 等新的静态渲染手段一律在**视图层**拦截处理（`features/view-wikilink.ts` + `main.ts` 的 `registerHoverLinkSource`、`mindmap.ts` 的前缀渲染钩子），渲染层只**读**解析结果、不回写节点 state；**勿**为此新增或改写 `mdEmbed`——它是「原文带 `!`」的**语法事实位**，读取面仅 `md-serialize`（补 `!` 两处 + 非图片附件的管道位原文一处 `mdEmbedPipe`）与 `wiki-display` 一处排除附件别名，且各自先被 `attachmentUrl` / `mdWikiLinkpath` 闸住；要动这条通道字段（更名 / 拆位）须先评估附件通道副作用，不擅自改。
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
- Obsidian API 合规（已对照官方 `obsidian.d.ts` **1.13.2** 与项目安装的 **1.13.1** 双层审计）：
  所用 API 全部为官方面
  （含 `FileSystemAdapter.getBasePath`、`getAvailablePathForAttachment`、
  `getFirstLinkpathDest`、`registerHoverLinkSource`、`SettingDefinitionItem` 等），
  零废弃 API 使用。仅存三处**无官方等价**的私有触点，均防御式实现并文档化：
  ① `features/file-creator.ts` file-explorer「新建」菜单注入（官方仅有 file-menu，
  无 fileCreator 公共 API）；② `links-resolve.ts` 拖拽兜底 `dragManager`；
  ③ `system-open.ts` 桌面端 `require('electron').shell.openPath`（d.ts 无系统打开 API）。
  勿新增私有 API 触点；官方补齐后优先替换。
  **版本基线**：`manifest.minAppVersion: 1.13.0`（比较基准）< 安装 typings `1.13.1`（`tsc`/lint
  的真实类型来源）< 官方最新 `1.13.2`（仅参照物）三者自洽。声明式设置的锚点
  （`PluginSettingTab.getSettingDefinitions`、`SettingTab.setControlValue`、
  `SettingDefinitionItem`、`SettingDefinition`）**全部 `@since 1.13.0`**；全插件
  `from 'obsidian'` 的导入面（22 个符号）**没有一处 `@since > 1.13.0`**。故 1.13.0 是
  「恰好覆盖、零盈余」的最小值：**不可下调**（低于 1.13.0 无声明式设置 API），**也不必上调**。
  **声明式设置的「键」是 lint 盲区（重要）**：`no-unsupported-api` 只访问
  `MemberExpression` / `NewExpression` / 类 `superClass` / `CallExpression`，**对象字面量的键
  永不检查**。若在 `getSettingDefinitions()` 返回的对象里写了比 `minAppVersion` 更新的字段
  （1.13.1：`SettingDefinitionGroup.search`、`SettingDefinitionPage.displayValue` / `.status`、
  `SettingSliderControl.displayFormat`；1.13.2：`SettingSecretControl.type:'secret'`），
  **不会有任何 lint 或 `tsc` 报警**（该成员确实存在于已安装的 typings 里）。因此
  **升 `minAppVersion`、或给声明式设置新增键时，必须人工核对对应 `@since`**，不能指望工具兜底。
- 引擎 vendor 文件不可手工编辑；升级时用官方源码重新打包并替换（流程见 `vendor/BUILD.md`）；
  `styles.css` 只含本插件样式——**不再有 vendor 段**（引擎 dist CSS 全是 Quill 富文本样式，
  本插件不注册 RichText，样式由引擎运行时注入；详见 `vendor/BUILD.md`）。
- 库内文件解析只走 `links-resolve.resolvePathToFile` 统一入口（勿自建 getAbstractFileByPath/索引/线性扫描组合）；索引原语在 `file-lookup.ts`。features/ 与 modal-*.ts 由 eslint `no-restricted-syntax` 机械强制（存在性检查等特例须 disable 并注明理由）。
- view-* 模块经 `ViewPluginContext` 访问插件能力（settings 活引用/viewState/statusBar 服务），不接触插件实例与状态栏 DOM；节点/悬停等视图态用模块级 WeakMap 内聚，不加到 `MindMapViewContext`。
- view-* 模块按需依赖子上下文（R4 上下文瘦身）：只碰 UI 元素的拿 `ViewDomContext`，只碰引擎的拿 `ViewEngineContext`，再与 `Pick<MindMapViewContext, 'lang' | …>` 组合成模块内最窄面（示范：view-search/view-status）；勿默认依赖整个 `MindMapViewContext` 装配面，新成员先落到对应子面。

## 发布流程

1. 更新 `manifest.json` 版本号 → `npm version patch|minor|major`（同步 `versions.json`）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`（`.github/workflows/release.yml` 自动构建并创建草稿 Release）。
4. 新增版本补 `docs/release-notes-<tag>.md`（中英双语）——`release.yml` 取该文件作 Release 说明，缺失则回退自动生成。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
  **该 `true` 是承重的**（豁免了 `md-serialize.ts` 的 lookbehind 正则），改动前先读「关键约定」中的对应条目。
