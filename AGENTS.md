# AGENTS.md

## 项目速览

Obsidian 社区插件（TypeScript → esbuild → `main.js`）。把「声明为导图」的 `.md`（**100% 标准 Markdown**：frontmatter 的 `类型`/`Type: Mindmap` + 标题 + 列表）解析为思维导图，编辑后**无损回写**为 Markdown。

- 标识 `mindmap-studio`，安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`
- 发布产物三件套：`main.js` / `manifest.json` / `styles.css`（`main.js` **不入库**，CI 构建）
- 入口 `src/main.ts`；命令 ID 表 `src/commands.ts`（**发布后永不变更**）；设置 `src/settings.ts`
- 引擎 `vendor/simple-mind-map.cjs` = `simple-mind-map 0.14.0-fix.3`，思绪（sxmind.cn）发布的第三方修订版（fork 自 wanglin2/mind-map 0.14.0）。**不 vendor 其 CSS**——上游 dist CSS 100% 是 Quill 富文本样式（本插件不注册 RichText），引擎样式由 bundle 运行时注入 `document.head`；修订与打包流程见 `vendor/BUILD.md`
- 依赖单向 `domain → core → {links,markdown,media,engine,platform} → {ui,services} → features → 组合根`，由 eslint 强制

## 环境与安装

- Node `>=20`（以 `package.json` 的 `engines` 为准），包管理器 npm，打包器 esbuild
- 装依赖 `npm install`｜开发 watch `npm run dev`｜生产构建 `npm run build`
- **实机验证**：把 `main.js` + `manifest.json` + `styles.css` 复制到 `<vault>/.obsidian/plugins/mindmap-studio/`，重启 Obsidian 后在「设置 → 第三方插件」启用；改完代码用 `obsidian plugin:reload id=mindmap-studio` → `obsidian dev:errors`
- ⚠ 同一导图文件 **只允许一个导图实例**：在第二个 leaf 打开会提示并让位（两个实例＝两套引擎 + 两条保存管线，交错写会丢编辑）。自动化脚本连续测多个文件前须先 detach 已有的导图 leaf，否则会拿到空视图而误判为功能缺陷


## 硬规则（Don't / Do 配对）

**1. 分层单向**
- Don't：跨组 import（例：`features/` 直引引擎内部形态）
- Do：按许可集；`eslint.config.mts` 的 9 个边界块 + 组合根禁令机械强制（`npm run lint`）

**2. 引擎访问只走防腐层**
- Don't：在 `features/` 直读 `renderer.*` / `node.group` / `view_data_change` / `doExport`
- Do：经 `engine/mindmap.ts` 的具名函数（该文件是唯一收口面）

**3. vendor 只读**
- Don't：直接编辑 `vendor/simple-mind-map.cjs`
- Do：改 `vendor/patches/` → `npm run build:vendor` → 同步 `vendor/BUILD.md` 与 `tests/vendor-contract.test.ts` 的两处 sha256

**4. Markdown 保真是硬契约**
- Don't：trim 行内空白、丢弃 `---`、合成未编辑行
- Do：未编辑行**逐字回写**（`mdRaw` 存**未 trim 原文**，`text` 才是 trim 后的显示文本）

**5. 不造第二份判定**
- Don't：另写一份 URL 形态判断 / 双链解析 / 并发原语 / 错误消息格式化
- Do：经 `domain/url.ts`、`domain/wikilink.ts`、`core/concurrency.ts`、`core/errors.ts`

**6. 源文件变更必须同步本文档**
- Don't：新增 / 重命名 / 删除 `src/`、`tests/` 文件而不改「代码结构索引」
- Do：同步索引；漏登记时 `npx vitest run tests/agents-md-sync.test.ts` 红灯并列出文件名

**7. 纯逻辑必须直测**
- Don't：只改实现不补测试
- Do：纯逻辑 → `tests/*.test.ts` 直测；DOM 装配 / 渲染 → `npm run verify:visual`

**8. i18n 双语强制对齐**
- Don't：只加中文词条
- Do：`ZH` 与 `EN` 同时加（`EN: Record<TranslationKey, string>` 在编译期强制）

**9. 官方 API 优先**
- Don't：自研 Obsidian 已有能力
- Do：先查 `obsidian.d.ts` 与官方帮助文档；官方缺口才允许私有触点，且必须防御式实现 + 登记

**10. 文件规模只允许收敛**
- Don't：新增超 300 行文件而不登记
- Do：登记到下方豁免表；**未登记的超限文件数只允许递减**

## 决策表

| 场景 | 选择 | 说明 |
|---|---|---|
| 纯逻辑（无 obsidian / 引擎依赖） | `domain/` | lint 强制零依赖 |
| 通用机制（常量/文案/错误/并发/事件/持久化） | `core/` | 各一份，不分模块重复 |
| Obsidian 平台集成 | `platform/` | — |
| 「本文件是导图」的判据 | `domain/mindmap-property.ts` | frontmatter `Type`/`类型` = `Mindmap`（读侧双键都认，写侧按语言选键）——**唯一实现**，勿另写 |
| 访问引擎内部形态 | `engine/mindmap.ts` 具名函数 | 防腐收口 |
| 库内文件解析 | `links/links-resolve.resolvePathToFile` | **形态路由顺序即契约** |
| 弹窗骨架 | `ui/modal-common.openFormModal` | 只收Promise + Modal + settle 守卫 + 标题 + 内容根；**「先 settle 再 close」的顺序由 helper 保证**。按钮行与快捷键**刻意不收口**（四者按钮集合/行class/提交键语义各异，硬抽即泄漏抽象） |
| 窗口级拖拽会话 | `features/drag-session.startWindowDragSession` | 收口 mousemove/mouseup 临时监听 + rAF 合帧 + 幂等收尾。`capture` 显式表达「手势独占（调宽，`true`）」vs「只观察（`false`，不夺事件）」——现存调用方只有图像调宽（`true`）；该语义曾由两处（调宽 / 换父辅助）真实分叉过，换父辅助已于 2026-10-11 移除。`onMove` **逐事件**、`onFrame` **每帧至多一次**，两条合约勿混用 |
| 节点自绘内容 | `features/node-inline-content.ts` | 段序列 + 锚点属性契约 |
| 节点自绘内容的**装配** | `features/node-content-factory.ts` | 平台实现 → `InlineContentOptions` 单向绑定（视图与代码块嵌入共用；新增渲染通道只改这一处） |
| Markdown 代码块只读嵌入 | `features/mindmap-codeblock.ts` | 语言键 `mindmap`（`core/constants.CODE_BLOCK_LANGUAGE`＝存量笔记的接口）；只读＝引擎原生 `readonly` + `enableViewDrag: false`（不可拖动）+ 不注册交互插件；**高度随内容、只缩不放**（对齐 Mermaid：`measureContentFitToWidth` + `centerContentAtScale`）；**容器变窄即按新宽度重算**（观察器**常驻**）；**滚轮归宿主页面**（capture 拦截）；超 `CODE_BLOCK_MAX_NODES` 降级大纲；**不写 `data.json`** |
| 节点内代码块 / 数学的**宿主侧渲染** | `platform/prism-code.ts` / `platform/math-jax.ts`（官方 `loadPrism` / `loadMathJax`） | 注入式：`node-inline-content` 只写字面占位 + 传参；**观感一律内联**（导出 SVG 不含 `styles.css`） |
| DOM 事件监听 | `Component.register*` 或 `core/event-binder.ts` | 随生命周期自动摘除 |
| 局部 UI 状态 | 视图实例字段 | 不持久化 |
| 需跨会话的视图状态 | `data.json`（经 `core/persistence.ts`） | **仅**布局/视口按文件记；打开方式由文件属性声明承载（`类型`/`Type`），不存 data.json |
| 图片尺寸缓存 | 官方 `App.loadLocalStorage` | 按库隔离；**禁**全局 `localStorage`（跨库串味） |
| 错误呈现 | 用户可感→ `notifyError`；内部 → `console.error/warn` | 静默跳过会让问题无痕退化。**失败已由被调方提示过的，调用方不得二次提示**（`return null` 约定见 `media/images-save`，否则弹两条且正文为 `String(null)`，见 `features/view-dnd.ts`） |

## 标准工作流

### 新增特性
1. **落层**：查决策表；新逻辑并入最贴近的已有模块，勿造第二份收口
2. **官方优先**：`obsidian.d.ts` + 官方帮助；缺口才允许私有触点
3. **实现**：只触碰决策表指定的收口点
4. **测试**：纯逻辑直测；渲染契约交 `verify:visual`
5. **同步**：更新下方「代码结构索引」；超 300 行则登记豁免表
6. **校验**（顺序执行，全绿才提交）：`npm run build` → `npm test` → `npm run lint` → 改过 `styles.css` 加 `npm run lint:css` → 新增/删除导出或文件加 `npm run check:dead-code` → 改过 `vendor/` 加 `npm run build:vendor` → **改过自绘判据 / 节点渲染 / `scripts/verify-visual.mjs` 加 `npm run verify:visual -- --require-chrome`**（2026-10-11 补：本批曾把判据从「有链接段才接管」收敛为「段序列非空即接管」，门禁整片转红而没在提交前跑到）

### 修改 Markdown 往返格式
1. 解析改 `src/markdown/md-outline.ts`，序列化改 `src/markdown/md-serialize.ts`
2. 同步 `docs/markdown-mindmap-standard.md`（权威标准）
3. `npx vitest run tests/md-roundtrip-property.test.ts`（fast-check 四条性质，含 `T∘T` 不动点）
4. `npx vitest run tests/md-roundtrip.test.ts`

### 发布
见 `docs/agents/process.md`（tag 触发、门禁顺序、发布资产清单、安全合规）

## 常用命令

| 用途 | 命令 |
|---|---|
| 迭代单测 | `npx vitest run tests/<file>.test.ts` |
| 往返生成式验证 | `npx vitest run tests/md-roundtrip-property.test.ts` |
| 文档同步契约 | `npx vitest run tests/agents-md-sync.test.ts` |
| 全量测试 | `npm test` |
| 类型 + 构建 | `npm run build` |
| Lint（**含依赖矩阵 + domain 零依赖 + 组合根禁令**） | `npm run lint` |
| CSS（发布资产） | `npm run lint:css` |
| 死代码 | `npm run check:dead-code` |
| 渲染契约（无头 Chrome） | `npm run verify:visual -- --require-chrome` |
| 打开性能基线（500/5000/10000） | `npm run verify:visual -- --require-chrome --bench-open` |
| 发布元数据 | `npm run check:release` |
| 实机验证 | `obsidian plugin:reload id=mindmap-studio` → `obsidian dev:errors` |

> Lint 必须在**插件根目录**执行（cwd 依赖，见 `docs/agents/conventions.md`）。

## 代码结构索引

**组合根**（4）：`commands.ts` `creation.ts` `main.ts` `settings.ts`
**domain/**（6）：`md-meta.ts` `mindmap-property.ts` `tree.ts` `url.ts` `wiki-display.ts` `wikilink.ts`
**core/**（8）：`concurrency.ts` `constants.ts` `errors.ts` `event-binder.ts` `i18n.ts` `measure-cache.ts` `node-data.ts` `persistence.ts`
**links/**（3）：`file-lookup.ts` `links-resolve.ts` `links-tree.ts`
**markdown/**（7）：`links-rename.ts` `links-split.ts` `markdown.ts` `md-line-write.ts` `md-open.ts` `md-outline.ts` `md-serialize.ts`
**media/**（2）：`images-path.ts` `images-save.ts`
**engine/**（2）：`mindmap-theme.ts` `mindmap.ts`
**platform/**（10）：`export-css-vars.ts` `export-foreign-object-padding.ts` `export-svg-style.ts` `math-jax.ts` `mindmap-auto-open.ts` `nav-history.ts` `prism-code.ts` `system-open.ts` `vault-prefs.ts` `vault-sync.ts`
**ui/**（5）：`modal-common.ts` `modal-image.ts` `modal-link.ts` `modal-name.ts` `modal-text.ts`
**services/**（4）：`document-service.ts` `engine-controller.ts` `status-bar.ts` `view-state.ts`
**features/**（28）：`content-remeasure.ts` `drag-session.ts` `image-resize.ts` `mindmap-codeblock.ts` `node-codeblock.ts` `node-content-factory.ts` `node-inline-content.ts` `node-inline-editor.ts` `view-common.ts` `view-context-menu.ts` `view-context.ts` `view-dnd.ts` `view-export.ts` `view-hotkeys.ts` `view-image-actions.ts` `view-image-fullscreen.ts` `view-link-navigator.ts` `view-node-actions.ts` `view-node-width.ts` `view-paste.ts` `view-search.ts` `view-split-links.ts` `view-status.ts` `view-title-renamer.ts` `view-toolbar.ts` `view-viewport.ts` `view-wikilink.ts` `view.ts`
**tests/**（73）：`agents-md-sync.test.ts` `concurrency.test.ts` `constants.test.ts` `content-remeasure.test.ts` `creation-folder.test.ts` `domain.test.ts` `drag-session.test.ts` `engine-controller.test.ts` `engine-history-limit.test.ts` `engine-image-size.test.ts` `engine-refresh-nodes.test.ts` `errors.test.ts` `event-binder.test.ts` `export-fo-padding.test.ts` `feature-helpers.test.ts` `feature-teardown.test.ts` `file-lookup.test.ts` `find-node-by-dom.test.ts` `images-path.test.ts` `language-refresh.test.ts` `links-rename.test.ts` `links-resolve.test.ts` `links-split.test.ts` `links-tree.test.ts` `math-jax-export-pin.test.ts` `math-jax.test.ts` `md-frontmatter-trigger.test.ts` `md-inline.test.ts` `md-line-write.test.ts` `md-open-trigger.test.ts` `md-roundtrip-property.test.ts` `md-roundtrip.test.ts` `measure-cache.test.ts` `mindmap-auto-open.test.ts` `mindmap-codeblock.test.ts` `mindmap-theme.test.ts` `mindmap-wiki-icon.test.ts` `modal-common.test.ts` `modal-input.test.ts` `nav-history.test.ts` `node-codeblock.test.ts` `node-inline-content.test.ts` `node-inline-editor.test.ts` `node-text-edit.test.ts` `obsidian.ts` `pasted-name.test.ts` `persistence.test.ts` `plain-text-parser.test.ts` `prism-code.test.ts` `save-pipeline.test.ts` `settings-persist.test.ts` `settings.test.ts` `setup.ts` `system-open.test.ts` `url.test.ts` `vault-prefs.test.ts` `vendor-contract.test.ts` `view-context-menu.test.ts` `view-dnd.test.ts` `view-export.test.ts` `view-hotkeys.test.ts` `view-node-actions.test.ts` `view-node-width.test.ts` `view-paste.test.ts` `view-search.test.ts` `view-split-links.test.ts` `view-state.test.ts` `view-status.test.ts` `view-toolbar.test.ts` `view-viewport.test.ts` `view-wikilink.test.ts` `viewport.test.ts` `wiki-display.test.ts`

### 文件规模与豁免（超 300 行须登记；完整理由见 docs/agents/architecture.md）

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
> 改动任一豁免文件后若 agents-md-sync 转红，必须回来更新本表的行数列。

| 文件 | 行数 | 豁免理由（完整理由见 docs/agents/architecture.md） |
|---|---|---|
| `src/engine/mindmap.ts` | 2178 | 引擎防腐层**唯一收口点**：vendor 内部形态（`node.group`、`renderer.*`、DoExport、Search 插件状态…）只允许在此出现。2026-10-12 增至 2023：导出收口 `exportMindMapPng` 泛化为 `exportMindMapImage`（PNG/SVG 双格式），格式类型引用 `core/constants` 的 `ExportImageFormat`。2026-10-13 增至 2178：`CreateMindMapOptions.readonly`（只读嵌入：引擎原生 readonly + 不注册交互插件）与 `enableViewDrag`（原生 `isDisableDrag`，关画布拖动），主题/resize 防腐入口 `applyThemeConfig` / `resizeMindMap`，以及嵌入「按宽度适配」量测与居中 `measureContentFitToWidth` / `centerContentAtScale`（后者由 `centerContentAtFullScale` 泛化而来）；同批自查把 `measureContentFitToWidth` 的返回值收敛为 `{ height, scale }`（不再回吐输入宽度——挂载点宽度由 CSS `width: 100%` 决定，回吐属无人消费的第二份真值）。 |
| `src/features/mindmap-codeblock.ts` | 510 | Markdown 代码块只读嵌入（语言键 `mindmap`）的**单一关注点**：块体解析 → 只读引擎装配（`readonly: true` + `enableViewDrag: false`）→ **容器高度随内容**（按宽度适配量测 + 写内联高度 + 请引擎重排）→ **容器宽度变化即重排**（观察器**先建且常驻**：首帧同步挂载成功也注册，否则高度口径锁死在首帧、内容被 `overflow: hidden` 裁掉；重排在**下一帧**落（`deferFit`），在 RO 回调里写布局会被 Chrome 记 `ResizeObserver loop…` 实机可见）→ 滚轮归宿主页面（capture 拦截；引擎 `onMousewheel` 无条件 preventDefault）→ 超限降级只读大纲 → 生命周期收尾（观察器/事件/尺寸会话/引擎）是一条不可分割的链；拆开会让「解析口径、零尺寸等待、尺寸反馈环、销毁顺序」四处漂移。**不写 data.json**（用户裁决 2026-10-13）。 |
| `src/markdown/md-serialize.ts` | 1191 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。嵌入拼写走 `domain/wikilink.formatEmbedWikilink`，注意 `embedLabelSuffix` 返回值**带前导 `|`** 需去前缀。2026-10-12 增至 1189：无显示名段（首图 / icon-only URL）的**锚点插入点**反查（`anchorInsertPoint` / `insertionForm`）与替换型 slot 共用同一遍行内拼装，拆开会让「文本定位」与「锚点定位」各持一份区间占用判定。2026-10-13 到 1191：`serializeMdBody` 内的 `nodeLines` 去掉遮蔽外层入参的冗余 `app` 形参 |
| `src/markdown/md-outline.ts` | 1108 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则。2026-10-12 增至 1108：首图与 icon-only URL 也登记台账段并附**上下文锚点**（`tokenAnchors`）——不登记则合成只能尾插，图片被搬到行尾 |
| `src/core/i18n.ts` | 529 | 纯词条表（无逻辑分支）。 |
| `src/features/view.ts` | 1046 | 视图 Controller：**第 6 步拆分后的编排壳**（见文件头契约）。数学校准会话已外置为 `features/content-remeasure.ts`（2026-10-11）；自绘内容装配（`InlineContentOptions` 的五项绑定）外置为 `features/node-content-factory.ts`（2026-10-13，与代码块嵌入共用同一份装配）。 |
| `src/services/engine-controller.ts` | 780 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法；导出 SVG 后处理链经 `deps.exportSvgTransforms` 由组合根注入（K51：services 不依赖 features）。2026-10-13：主题写入与 resize 改走 `engine/mindmap` 的 `applyThemeConfig` / `resizeMindMap`（视图与代码块嵌入共用同一入口）。 |
| `src/media/images-path.ts` | 637 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一）。`schedulePersistSizeCache` 是**第三种调度语义**（纯延迟落盘、窗口不重置、首调不立即执行），刻意不用 `createDebouncer`/`createThrottler`。 |
| `src/features/image-resize.ts` | 409 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链。窗口级会话（监听 + rAF 合帧 + 幂等收尾）已收口到 `drag-session`，本文件只留业务回调；`capture: true` 是「手势独占」的显式参数 |
| `src/features/view-node-actions.ts` | 758 | 节点操作（链接/文本/剪贴板/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export（含 2026-10-13 收口的建图入口 `createImageChildNode`）。 |
| `src/features/view-dnd.ts` | 599 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配；2026-10-13 起未选中节点时的**图片**（库内拖入、以及「载荷全是图片」的系统拖入）在渲染根下新建图片节点（建图数据形态收口到 `view-image-actions.createImageChildNode`；含非图片的系统载荷仍要求先选中）。入库失败**不由本层二次提示**——入库通道（images-save）已逐条提示并返回 null，只留控制台计数痕迹。 |
| `src/main.ts` | 426 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。2026-10-13 增至 426：`registerMarkdownCodeBlockProcessor` 注册 + 把设置窄化成 `MindmapEmbedConfig` 传 getter（features 不引 `settings`）。 |
| `src/markdown/links-split.ts` | 486 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。 |
| `src/core/constants.ts` | 501 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件）+ 代码块判定（缩进行 / 围栏语言码白名单 / 已渲染标记类）。2026-10-12 复测 480：新增导出格式选项表与唯一的 `ExportImageFormat` 类型。2026-10-13 增至 501：`CODE_BLOCK_LANGUAGE`（存量笔记的接口）与 `CODE_BLOCK_MAX_NODES`（嵌入上限，与 `PERFORMANCE_NODE_THRESHOLD` 语义不同故不复用）。 |
| `src/settings.ts` | 421 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。2026-10-11 增至 398：校验器加「被回退/钳制键」的诊断出参 + `reportDroppedSettings` 汇总留痕（无痕退化治理，K33 同族）。2026-10-12 增至 422：新增「导出格式」设置项（`exportImageFormat`，类型引用 `ExportImageFormat`），并令 `pickFrom` 泛型化以返回选项 value 的联合类型。 |
| `src/features/node-inline-content.ts` | 1442 | 自绘节点内容的**单一关注点**闭环：行内原文 → 段序列（含轻标记切分 + 围栏/缩进代码块判定 + 语言码规范化）→ HTML（锚点契约 + **内联样式常量** + 代码块 token 的异步注入面）。2026-10-09 减法（K117）：纯文本节点恒接管，接管判据＝段序列非空 ∨ 超长（删掉 `rich`/`hidden` 附带判定与三个正则）；**含文本节点一律自绘 ⇒ 引擎 prefix/hyperlink/attachment 图标通道只剩空文本/含图节点可达（K118）**。2026-10-12 增至 1442：`MARKUP_RE` 的 bold/ital 分支支持标记体内嵌套（星号版此前与下划线版不对称，见 K120）。 |
| `src/features/view-wikilink.ts` | 411 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。 |
| `src/platform/prism-code.ts` | 448 | 代码块语法高亮通道**单一落点**（全插件唯一 import `obsidian` 的代码高亮实现，`loadPrism`）：产品形态是「字面代码 → 异步 `Prism.tokenize` → token 元素（**不经 innerHTML**）→ 定稿（入产物缓存 + 通知重排）」；与数学通道的四点差异（tokenize 是同步纯函数，故**不搬**字体/flush/就绪判据/挂载补替换队列）必须成对阅读；token 颜色**探测宿主计算色后内联**（导出 SVG 无 app.css，K91/K99 口径）；主题切换走 `refreshPrismTokenColors`（清缓存 + 就地改色，不重建节点）。未登记语言 / `tokenize` 抛错 / 空产物一律保留字面（占位即回退）。 |
| `src/platform/math-jax.ts` | 904 | 数学渲染通道**单一落点**（全插件唯一 import `obsidian` 的数学实现）：产品形态是「字面占位 → 异步替换 → 就绪判据（全部 `mjx-c` 宽 > 0 + **零宽豁免双形态**：v3 空 `content` 规则／v4 零 `padding` 规则，按字符码查 `#MJX-CHTML-styles` 的 CSSOM 索引、**按 flush 代际缓存**）→ 撤回字面 → 定稿（入缓存 + 通知重排）；**字体**（私有区码点，渐进渲染故不设重试）；**导出 SVG 后处理链**（样式注入 + `mjx-container` 高度钉定）。MathJax 3/4 两代规则形态均需兼容（K85 / K113）。读CHTML 规则表失败会**留痕告警**（留空索引 = K113 豁免整体失效，属无痕退化）。**刻意不加会话/代际守卫**——A2 元素按 uid 取用即删，旧 holder 写入不可见（结论见文件头）。 |
| `src/links/links-tree.ts` | 452 | 树内引用更新**单一遍历实现**：rename / clear 两模式共享待匹配形态派生（资源地址 + [[链接]] 双载体、回收站退化、跨文件夹移动取新位置、非 .md 文档带扩展名）与写回规则；拆开会让「重命名改写」与「删除清理」两条路径的匹配口径漂移。`renamedMdLinkDest` 把 md 目标绕回 `parseWikilink` 是**安全**的（上游 `mdTargetRenamed` 已排除空串与含 `|`/`#` 的目标），勿误改为「直接构造 parts」 |
| `src/links/links-resolve.ts` | 353 | 「任意地址形态 → TFile」的**统一解析入口**：远程拒绝 → `obsidian://` → 资源地址 → 路径直查 → `file://` 剥离 → 官方 `getFirstLinkpathDest` → 索引兜底——形态路由的**分支顺序本身即契约**（新增规则只改这一处）；拆开会重新引入本文件当初拆出要收敛的「双轨并存、覆盖形态互有盲区」问题 |
| `src/features/node-inline-editor.ts` | 384 | 节点内联编辑的**单一会话收口**（K92）：覆盖层定位与跟随（`scale` / `node_tree_render_end` 重定位）、键盘语义表、点击外部与 `mousewheel` 提交、会话所属引擎守卫、提交写回（`applyRawNodeContent`）共享同一套「会话 → 值 → 落数据」不变式；拆开会让定位跟随与提交守卫跨文件失配 |
| `src/services/document-service.ts` | 365 | md 文档读写数据面：**读**（`DocumentService.load` → `parseMdOutline` + `walkResolveImagePaths`）与**写**（`SavePipeline` → 防抖调度 + 串行排空 + 卸载快照兜底 + 无差异跳过 + P1a 外部改动检测 / P1b 连续失败挂起）成对。 |

## 参考文档

`docs/` 清单（`agents-md-sync` 校验前两项真实存在）：

```
docs/
  markdown-mindmap-standard.md   # Markdown ↔ 思维导图映射规则（**权威标准**，改往返格式须同步）
  agents/architecture.md         # 模块职责、数据流、依赖矩阵、豁免理由详录
  agents/baseline-metrics.md     # 可复现基线（门禁/打开性能/体积归因/静态指标/核销台账）
  agents/conventions.md          # 关键约定 K1–K120 全文（含实测账本与踩坑记录）
  agents/testing.md              # 测试分层、CI 矩阵、CSS 检查、发布元数据护栏
  agents/process.md              # 新增功能检查清单、发布流程、安全合规
  release-notes-<tag>.md         # 各版本发布说明（中英双语；release.yml 按 tag 取用）
```

| 我要查 | 去哪 |
|---|---|
| 某个模块归哪层、能依赖什么 | `docs/agents/architecture.md` |
| 「为什么这里要这么写」（含历史踩坑） | `docs/agents/conventions.md`（按 K 编号搜） |
| 某个测试该加在哪一层、CI 怎么跑 | `docs/agents/testing.md` |
| 改 Markdown 映射规则的权威定义 | `docs/markdown-mindmap-standard.md` |
| 发布流程、版本号、资产清单 | `docs/agents/process.md` |
