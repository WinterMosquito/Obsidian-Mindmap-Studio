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
- **终端一律 Git Bash（须写全路径）**：常规命令经 Git Bash 执行，形式为 `& 'C:\Program Files\Git\bin\bash.exe' -lc '…'`（Bash 5.3.15 / MINGW64）。**裸 `bash -lc` 不可用**——本机 PATH 里的 Git 只有 `Git\cmd`（无 `bash.exe`），`bash` 实际命中 `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe`（WSL 别名，实测 `$HOME=/home/legion`）。仅当任务确需 Windows 专属能力（注册表、PowerShell 专有 cmdlet）才切 **PowerShell 7+**，并在输出中说明原因（口径与理由见 K125）
- 装依赖 `npm install`｜开发 watch `npm run dev`｜生产构建 `npm run build`
- **实机验证**：把 `main.js` + `manifest.json` + `styles.css` 复制到 `<vault>/.obsidian/plugins/mindmap-studio/`，重启 Obsidian 后在「设置 → 第三方插件」启用；改完代码用 `obsidian plugin:reload id=mindmap-studio` → `obsidian dev:errors`
- ⚠ 同一导图文件 **只允许一个导图实例**：在第二个 leaf 打开会提示并让位（两个实例＝两套引擎 + 两条保存管线，交错写会丢编辑）。自动化脚本连续测多个文件前须先 detach 已有的导图 leaf，否则会拿到空视图而误判为功能缺陷


## 硬规则（Don't / Do 配对）

**1. 分层单向**
- Don't：跨组 import（例：`features/` 直引引擎内部形态）；Don't 在测试或 lint 配置里另抄一份依赖矩阵
- Do：按许可集；矩阵唯一定义在 `scripts/module-boundaries.mjs`，`eslint.config.mts` 的 9 个边界块 + 组合根禁令（`npm run lint`）与 `tests/module-boundaries.test.ts`（解析后的真实依赖图：组内成环 / 深层路径 / 新组未登记）都从它生成

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
| 引擎类型导入（`MindMap` / `MindMapNode` / `MindMapTreeNode` / `MindMapNodeData` / `SetNodeImageOptions`） | `core/engine-types.ts` | engine 之外**唯一**来源（type-only）；`engine/` 自身仍可直连 vendor |
| 模块依赖矩阵（谁可依赖谁） | `scripts/module-boundaries.mjs` | **唯一定义**（eslint 边界块与 `tests/module-boundaries.test.ts` 共同消费）；勿在 `eslint.config.mts` 或测试里另写一份 |
| 库内文件解析 | `links/links-resolve.resolvePathToFile` | **形态路由顺序即契约** |
| 新建引用的**路径形态**（文档链接 / 图片引用） | `links/file-lookup.newReferencePath` | 官方 `New link format` 三档 + 同名消歧，**唯一定义**（同名口径**随引用形态**：省略 `.md` 的文档链接按去扩展名 basename；带扩展名的图片 / 附件 / `.canvas` 按文件名——`a.png` 与 `a.md` 不歧义，见 `hasNameConflict`。`omitMarkdownExtension` 只给文档链接；md 形态图片仍写完整库内路径）。**只在写引用时消歧**——存量引用不因后来出现同名文件而改写（Obsidian 实测同此；改写未编辑行会破 `mdRaw` 逐字保真，见 K126④） |
| 节点图片元素判定（含 popout 跨 realm） | `engine/mindmap-nodes.isNodeImageElement` | 按 `tagName === 'image'` + 取矩形能力；**禁** `instanceof SVGImageElement`（跨窗口恒 false ⇒ 手柄不出现 + 帧内预览静默失效）。帧内预览与 hover 手柄共用这一份 |
| 行内轻标记 / 段序列切分 | `features/node-inline-tokenize.ts`（`MARKUP_RE`） | **唯一实现**：粗体标记体逐字符 temper（不越过下一对定界符）、`__` 版对称；接管判定 `resolveSelfDrawSource`。勿在渲染层另写标记判定（见 K126①） |
| 弹窗骨架 | `ui/modal-common.openFormModal` | 只收Promise + Modal + settle 守卫 + 标题 + 内容根；**「先 settle 再 close」的顺序由 helper 保证**。按钮行与快捷键**刻意不收口**（四者按钮集合/行class/提交键语义各异，硬抽即泄漏抽象） |
| 窗口级拖拽会话 | `features/drag-session.startWindowDragSession` | 收口 mousemove/mouseup 临时监听 + rAF 合帧 + 幂等收尾。`capture` 显式表达「手势独占（调宽，`true`）」vs「只观察（`false`，不夺事件）」——现存调用方只有图像调宽（`true`）；该语义曾由两处（调宽 / 换父辅助）真实分叉过，换父辅助已于 2026-10-11 移除。`onMove` **逐事件**、`onFrame` **每帧至多一次**，两条合约勿混用 |
| GFM 管道表的**识别**（表块 / 单元格 / 对齐 / `\ ` 还原） | `domain/pipe-table.ts` | 纯逻辑零依赖，**唯一实现**（勿另写一份表格判定）；围栏代码块与块级数学**内**的表格行不识别（保护区复用渲染层 `MARKUP_RE`，不造第二份 fence 判定）。单元格内不做块级内容 |
| 节点自绘内容 | `features/node-inline-content.ts` | 段序列 + 锚点属性契约（表格段 `kind:'table'` 的 DOM 装配与全内联样式也在此） |
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
1. **落层**：查决策表；新逻辑并入最贴近的已有模块，勿造第二份收口（**新模块组**＝`src/` 下新一级目录，须先在 `scripts/module-boundaries.mjs` 的 `MODULE_GROUPS` + `MODULE_DEPENDENCIES` 定层，否则 `tests/module-boundaries.test.ts` 红灯）
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
| 模块边界（依赖图 / 成环 / 组合根） | `npx vitest run tests/module-boundaries.test.ts` |
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
**domain/**（7）：`md-meta.ts` `mindmap-property.ts` `pipe-table.ts` `tree.ts` `url.ts` `wiki-display.ts` `wikilink.ts`
**core/**（10）：`concurrency.ts` `constants.ts` `engine-types.ts` `errors.ts` `event-binder.ts` `i18n.ts` `math-placeholder.ts` `measure-cache.ts` `node-data.ts` `persistence.ts`
**links/**（3）：`file-lookup.ts` `links-resolve.ts` `links-tree.ts`
**markdown/**（7）：`links-rename.ts` `links-split.ts` `markdown.ts` `md-line-write.ts` `md-open.ts` `md-outline.ts` `md-serialize.ts`
**media/**（2）：`images-path.ts` `images-save.ts`
**engine/**（10）：`mindmap-clipboard.ts` `mindmap-commands.ts` `mindmap-export.ts` `mindmap-history.ts` `mindmap-nodes.ts` `mindmap-search.ts` `mindmap-theme.ts` `mindmap-timers.ts` `mindmap-viewport.ts` `mindmap.ts`
**platform/**（10）：`clipboard.ts` `export-svg-postprocess.ts` `math-jax-export.ts` `math-jax.ts` `mindmap-auto-open.ts` `nav-history.ts` `prism-code.ts` `system-open.ts` `vault-prefs.ts` `vault-sync.ts`
**ui/**（5）：`modal-common.ts` `modal-image.ts` `modal-link.ts` `modal-name.ts` `modal-text.ts`
**services/**（4）：`document-service.ts` `engine-controller.ts` `status-bar.ts` `view-state.ts`
**features/**（31）：`content-remeasure.ts` `drag-session.ts` `image-resize.ts` `mindmap-codeblock.ts` `node-codeblock.ts` `node-content-factory.ts` `node-inline-content.ts` `node-inline-editor.ts` `node-inline-html.ts` `node-inline-tokenize.ts` `view-clipboard.ts` `view-common.ts` `view-context-menu.ts` `view-context.ts` `view-dnd.ts` `view-export.ts` `view-hotkeys.ts` `view-image-actions.ts` `view-image-fullscreen.ts` `view-link-navigator.ts` `view-node-actions.ts` `view-node-width.ts` `view-paste.ts` `view-search.ts` `view-split-links.ts` `view-status.ts` `view-title-renamer.ts` `view-toolbar.ts` `view-viewport.ts` `view-wikilink.ts` `view.ts`
**tests/**（83）：`agents-md-sync.test.ts` `clipboard-outline.test.ts` `clipboard.test.ts` `concurrency.test.ts` `constants.test.ts` `content-remeasure.test.ts` `creation-folder.test.ts` `domain.test.ts` `drag-session.test.ts` `engine-controller.test.ts` `engine-history-limit.test.ts` `engine-image-size.test.ts` `engine-node-move.test.ts` `engine-refresh-nodes.test.ts` `engine-subtree-clipboard.test.ts` `errors.test.ts` `event-binder.test.ts` `export-svg-postprocess.test.ts` `feature-helpers.test.ts` `feature-teardown.test.ts` `file-lookup.test.ts` `file-menu-back-to-md.test.ts` `find-node-by-dom.test.ts` `images-path.test.ts` `language-refresh.test.ts` `links-rename.test.ts` `links-resolve.test.ts` `links-split.test.ts` `links-tree.test.ts` `math-jax-export-pin.test.ts` `math-jax.test.ts` `math-placeholder.test.ts` `md-frontmatter-trigger.test.ts` `md-inline.test.ts` `md-line-write.test.ts` `md-open-trigger.test.ts` `md-roundtrip-property.test.ts` `md-roundtrip.test.ts` `measure-cache.test.ts` `mindmap-auto-open.test.ts` `mindmap-codeblock.test.ts` `mindmap-theme.test.ts` `mindmap-wiki-icon.test.ts` `modal-common.test.ts` `modal-input.test.ts` `module-boundaries.test.ts` `nav-history.test.ts` `node-codeblock.test.ts` `node-inline-content.test.ts` `node-inline-editor.test.ts` `node-text-edit.test.ts` `obsidian.ts` `pasted-name.test.ts` `persistence.test.ts` `pipe-table.test.ts` `plain-text-parser.test.ts` `prism-code.test.ts` `save-pipeline.test.ts` `settings-persist.test.ts` `settings.test.ts` `setup.ts` `system-open.test.ts` `url.test.ts` `vault-prefs.test.ts` `vendor-contract.test.ts` `view-clipboard.test.ts` `view-context-menu.test.ts` `view-dnd.test.ts` `view-export.test.ts` `view-hotkeys.test.ts` `view-md-back-mode.test.ts` `view-node-actions.test.ts` `view-node-width.test.ts` `view-paste.test.ts` `view-search.test.ts` `view-split-links.test.ts` `view-state.test.ts` `view-status.test.ts` `view-toolbar.test.ts` `view-viewport.test.ts` `view-wikilink.test.ts` `viewport.test.ts` `wiki-display.test.ts`

### 文件规模与豁免（超 300 行须登记；完整理由见 docs/agents/architecture.md）

> **2026-10-20 全表复测**：27 行按 `countSourceLines` 逐行重测并按实测回填（与 `docs/agents/architecture.md` 同表同步；超限文件数仍为 27）。以下为历次刷新记录。

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

| 文件 | 行数 | 豁免理由（完整理由见 docs/agents/architecture.md） |
|---|---|---|
| `src/engine/mindmap.ts` | 714 | 引擎防腐层**入口（barrel）**（2026-10-16 拆为 engine/ 层内 8 个子模块；收口点是**层**而非文件，vendor 私有形态仍只允许出现在 engine/ 层内）。以下为拆分前的单文件增长史：2026-10-12 增至 2023：导出收口 `exportMindMapPng` 泛化为 `exportMindMapImage`（PNG/SVG 双格式），格式类型引用 `core/constants` 的 `ExportImageFormat`。2026-10-13 增至 2178：`CreateMindMapOptions.readonly`（只读嵌入：引擎原生 readonly + 不注册交互插件）与 `enableViewDrag`（原生 `isDisableDrag`，关画布拖动），主题/resize 防腐入口 `applyThemeConfig` / `resizeMindMap`，以及嵌入「按宽度适配」量测与居中 `measureContentFitToWidth` / `centerContentAtScale`（后者由 `centerContentAtFullScale` 泛化而来）；同批自查把 `measureContentFitToWidth` 的返回值收敛为 `{ height, scale }`（不再回吐输入宽度——挂载点宽度由 CSS `width: 100%` 决定，回吐属无人消费的第二份真值）。**2026-10-14 增至 2657**：视口几何落地（`syncCanvasGeometry` + `flushPendingLayoutRender` 把 resize 编排的渲染提前启动 + `scheduleCenteringCorrection` 渲染落地后居中补正〔3 秒窗口内跟随、几何指纹收敛判据〕+ `centerContentByDataBox` 共享居中判定 + `resetZoom` 锚点改实时容器中心；见第十四批）。 |
| `src/engine/mindmap-viewport.ts` | 1058 | 画布几何与视口防腐面（2026-10-16 自 `mindmap.ts` 拆出）：实时容器几何同步、数据层/DOM 双口径内容盒测量、fit、居中与「渲染落地后居中补正」、缩放/平移、视口状态读写与签名。与 `math-jax` 同性质——就绪/几何口径只此一处，拆开会让该口径跨文件漂移。 |
| `src/engine/mindmap-nodes.ts` | 748 | 节点查询与工具 + 文本编辑防腐面（2026-10-16 自 `mindmap.ts` 拆出）：节点/DOM 反查、节点文本与图片尺寸、自绘内容重建、兄弟上/下移、`renderer.textEdit`/`node_dblclick` 收口。 |
| `src/features/content-remeasure.ts` | 502 | 「自绘内容定稿 → 尺寸同步」会话：三条不变式（同帧合批 `setTimeout(0)` / 按 holder 反查真实节点 / 渲染窗口只重试一次）**加第四条可见性不变式**（2026-10-14）——「隐藏态不测量」与「由隐藏转可见的四路自愈」必须与前三者共享同一份回退链（holders → 产物反查 → 暂存重试），拆开会让 `flush` / `retryDeferred` / 字体批次各自维护一份可见性判定，必然漂移；文件头 ④ 记录实机证据与官方判据（`Element.isShown()`）。2026-10-14 增至 460：新增 ⑤ 未定稿修复（三钩子触发 + 宿主画布根作用域，见第十批）。**2026-10-14 十一批增至 492**：清理点改 `forgetEngine`（按引擎身份清，`pruneUnsettledMathOwnedBy`）；`resetNodes` **不再动登记面**（它跑在首帧渲染前，正是误清高危时刻）。**2026-10-14 十二批增至 502**：`recoverHidden` 补可见性守卫（自愈拍到期前又隐藏时不测量、脏标记保留——否则 0×0 写回且此后不再自愈）。 |
| `src/features/mindmap-codeblock.ts` | 549 | Markdown 代码块只读嵌入（语言键 `mindmap`）的**单一关注点**：块体解析 → 只读引擎装配（`readonly: true` + `enableViewDrag: false`）→ **容器高度随内容**（按宽度适配量测 + 写内联高度 + 请引擎重排）→ **容器宽度变化即重排**（观察器**先建且常驻**：首帧同步挂载成功也注册，否则高度口径锁死在首帧、内容被 `overflow: hidden` 裁掉；重排在**下一帧**落（`deferFit`），在 RO 回调里写布局会被 Chrome 记 `ResizeObserver loop…` 实机可见）→ 滚轮归宿主页面（capture 拦截；引擎 `onMousewheel` 无条件 preventDefault）→ 超限降级只读大纲 → 生命周期收尾（观察器/事件/尺寸会话/引擎/卸载即清 DOM）是一条不可分割的链；拆开会让「解析口径、零尺寸等待、尺寸反馈环、销毁顺序」四处漂移。**不写 data.json**（用户裁决 2026-10-13）。 |
| `src/markdown/md-serialize.ts` | 1248 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。嵌入拼写走 `domain/wikilink.formatEmbedWikilink`，注意 `embedLabelSuffix` 返回值**带前导 `|`** 需去前缀。2026-10-12 增至 1189：无显示名段（首图 / icon-only URL）的**锚点插入点**反查（`anchorInsertPoint` / `insertionForm`）与替换型 slot 共用同一遍行内拼装，拆开会让「文本定位」与「锚点定位」各持一份区间占用判定。2026-10-13 到 1191：`serializeMdBody` 内的 `nodeLines` 去掉遮蔽外层入参的冗余 `app` 形参 |
| `src/markdown/md-outline.ts` | 1159 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则。2026-10-12 增至 1108：首图与 icon-only URL 也登记台账段并附**上下文锚点**（`tokenAnchors`）——不登记则合成只能尾插，图片被搬到行尾 |
| `src/core/i18n.ts` | 565 | 纯词条表（无逻辑分支）。2026-10-14 增至 563：节点上/下移 5 条（双语），含中心节点与首/末位拒绝提示。 |
| `src/features/view.ts` | 1131 | 视图 Controller：**第 6 步拆分后的编排壳**（见文件头契约）。数学校准会话已外置为 `features/content-remeasure.ts`（2026-10-11）；自绘内容装配（`InlineContentOptions` 的五项绑定）外置为 `features/node-content-factory.ts`（2026-10-13，与代码块嵌入共用同一份装配）。 |
| `src/services/engine-controller.ts` | 806 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法；导出 SVG 后处理链经 `deps.exportSvgTransforms` 由组合根注入（K51：services 不依赖 features）。2026-10-13：主题写入与 resize 改走 `engine/mindmap` 的 `applyThemeConfig` / `resizeMindMap`（视图与代码块嵌入共用同一入口）。 |
| `src/media/images-path.ts` | 637 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一）。`schedulePersistSizeCache` 是**第三种调度语义**（纯延迟落盘、窗口不重置、首调不立即执行），刻意不用 `createDebouncer`/`createThrottler`。 |
| `src/features/image-resize.ts` | 432 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链。窗口级会话（监听 + rAF 合帧 + 幂等收尾）已收口到 `drag-session`，本文件只留业务回调；`capture: true` 是「手势独占」的显式参数 |
| `src/features/view-node-actions.ts` | 882 | 节点操作（链接/文本/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export（含 2026-10-13 收口的建图入口 `createImageChildNode`）。剪贴板（复制/剪切/粘贴）已于 2026-10-13 收口到 `features/view-clipboard.ts`，此前的视图级 WeakMap 剪贴板（`copyNode`/`pasteNodeAsChild`）整体删除——勿在此重建第二份。2026-10-15 复测 881：新增 `planDocLink` / `planAttachmentLink`——**拖入文档 / 附件的载荷与提示唯一判定点**（一次判定给出 `{ target, link, data, notice }`，载荷与提示**结构上同源**），附件字段集另收口为私有 `attachmentFields`；此前文档**五处**、附件**三处**各写一份载荷或提示写法，且「未选中 / 文件夹拖入」两路**不查官方设置**（违反硬规则 5）。 |
| `src/features/view-dnd.ts` | 553 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配；2026-10-13 起未选中节点时的**图片**（库内拖入、以及「载荷全是图片」的系统拖入）在渲染根下新建图片节点（建图数据形态收口到 `view-image-actions.createImageChildNode`；含非图片的系统载荷仍要求先选中）。入库失败**不由本层二次提示**——入库通道（images-save）已逐条提示并返回 null，只留控制台计数痕迹。 |
| `src/main.ts` | 523 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。2026-10-13 增至 426：`registerMarkdownCodeBlockProcessor` 注册 + 把设置窄化成 `MindmapEmbedConfig` 传 getter（features 不引 `settings`）。2026-10-14 复测 422（**减法**）：文件夹右键新建导图的调用点改传 settings（落点解析移入 `creation.ts`）。 |
| `src/markdown/links-split.ts` | 487 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。 |
| `src/core/constants.ts` | 568 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件）+ 代码块判定（缩进行 / 围栏语言码白名单 / 已渲染标记类）。2026-10-12 复测 480：新增导出格式选项表与唯一的 `ExportImageFormat` 类型。2026-10-13 增至 501：`CODE_BLOCK_LANGUAGE`（存量笔记的接口）与 `CODE_BLOCK_MAX_NODES`（嵌入上限，与 `PERFORMANCE_NODE_THRESHOLD` 语义不同故不复用）。2026-10-14 增至 529：新增 `SaveLocation` 类型与 `SAVE_LOCATION_OPTIONS`（设置面板下拉与 `sanitizeSettings` 白名单共用）。 |
| `src/settings.ts` | 501 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。2026-10-11 增至 398：校验器加「被回退/钳制键」的诊断出参 + `reportDroppedSettings` 汇总留痕（无痕退化治理，K33 同族）。2026-10-12 增至 422：新增「导出格式」设置项（`exportImageFormat`，类型引用 `ExportImageFormat`），并令 `pickFrom` 泛型化以返回选项 value 的联合类型。2026-10-14 增至 475：新增「新建导图的默认位置」四档设置（`saveLocation` / `saveFolder`，含 1.13 声明式 `type: 'folder'` 控件与 `visible` 条件项——切档后经 `refreshDomState()` 重算可见性〔2026-10-15 改：该官方入口（d.ts:9290，1.13.0 起）专为 `visible`/`disabled` 谓词变化而设、原地切 CSS 状态不重渲染；`update()` 只留给定义**结构**变化（语言切换属此类）〕）。 |
| `src/features/node-inline-tokenize.ts` | 1081 | 段序列切分（**纯逻辑，无 DOM**，2026-10-16 自 `node-inline-content.ts` 拆出）：行内 token → 段序列（轻标记 / 围栏代码块 / 缩进代码 / 语言码规范化 / 数学 / 链接 / **表格块**）+ 段缓存 + 接管判定 `resolveSelfDrawSource` + 截断 `clampSegments` + 预览 `inlineContentPreview`。 |
| `src/features/node-inline-html.ts` | 723 | 段序列 → HTML **装配**（2026-10-16 自 `node-inline-content.ts` 拆出）：类名与锚点属性契约 + 内联样式常量表（**导出保真契约** K53 ⑤，引擎导出不注入插件 CSS）+ 文本段/锚点/表格/代码块/数学元素。 |
| `src/features/view-wikilink.ts` | 411 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。 |
| `src/platform/prism-code.ts` | 444 | 代码块语法高亮通道**单一落点**（全插件唯一 import `obsidian` 的代码高亮实现，`loadPrism`）：产品形态是「字面代码 → 异步 `Prism.tokenize` → token 元素（**不经 innerHTML**）→ 定稿（入产物缓存 + 通知重排）」；与数学通道的四点差异（tokenize 是同步纯函数，故**不搬**字体/flush/就绪判据/挂载补替换队列）必须成对阅读；token 颜色**探测宿主计算色后内联**（导出 SVG 无 app.css，K91/K99 口径）；主题切换走 `refreshPrismTokenColors`（清缓存 + 就地改色，不重建节点）。未登记语言 / `tokenize` 抛错 / 空产物一律保留字面（占位即回退）。 |
| `src/platform/math-jax.ts` | 1090 | 数学渲染通道**单一落点**（2026-10-16：导出 SVG 后处理链拆至 `math-jax-export.ts`——纯 DOM/CSSOM、不依赖渲染态；本文件保留渲染/就绪判据/登记面/缓存，三者因**环 + 共享可变态**不可分。全插件唯一 import `obsidian` 的数学实现）：产品形态是「字面占位 → 异步替换 → 就绪判据（**2026-10-15 v4 修正：本段字符的规则已落盘 +（可见字符）宽度 > 0**；索引三态——元素不存在 = 明确未 flush ⇒ 判未就绪／CSSOM 不可读 ⇒ 退回旧宽度判据 + 留痕；**零宽豁免双形态**：v3 空 `content` 规则／v4 零 `padding` 规则，按字符码查 `#MJX-CHTML-styles` 的 CSSOM 索引、**缓存键 =（样式表元素, 规则条数）**；判定序为「规则（免布局）→ 宽度（**可见字符零样式查询**）→ 仅零宽字符做 `::before` 查询」，见第十六批）→ 撤回字面 → 定稿（入缓存 + 通知重排）；**字体**（私有区码点，渐进渲染故不设重试）；**导出 SVG 后处理链**（样式注入 + `mjx-container` 高度钉定）。MathJax 3/4 两代规则形态均需兼容（K85 / K113）。读CHTML 规则表失败会**留痕告警**（留空索引 = K113 豁免整体失效，属无痕退化）。**刻意不加会话/代际守卫**——A2 元素按 uid 取用即删，旧 holder 写入不可见（结论见文件头）。2026-10-14 增至 1031：新增未定稿登记面（`unsettledMath`）与 `repairUnsettledMath` / `clearUnsettledMath` / `pruneDetachedUnsettledMath`——「放弃段」（挂载预算耗尽）可被症状修复，不再永久字面（第十批）。**2026-10-14 十一批增至 1062**：登记面条目携带 **owner（引擎实例）**，`pruneUnsettledMathOwnedBy` 取代 `pruneDetachedUnsettledMath`——按 `!isConnected` 判归属会误删新引擎**全部懒加载段**（预测量本体从不挂载，实机定案）。**2026-10-14 十二批增至 1065**：`clearUnsettledMath` 同族口径一并收敛为 `root.contains`（去掉「已脱离文档也算本视图」——多视图并存时会误清**其他宿主**的未挂载段），root 外的残留交给紧随的引擎销毁按归属清。**2026-10-15 增至 1204**：就绪判据 v4 修正（v4 字符为真实文本节点 ⇒「宽度 > 0」恒假阳 ⇒ flush 从不调度 ⇒ 官方样式表从未挂载；判据换锚「规则落盘 + 宽度」、索引三态、`charRuleKey` 类名优先兼收 v3 空文本形态，见第十五批）。**同日增至 1227**：判定序重构（可见字符零样式查询）+ `hasCharRule` + 共享 `EMPTY_CHAR_RULE_INDEX` + 告警文案常量 + `sheet` 类型收窄（第十六批，行为等价）。 |
| `src/links/links-tree.ts` | 454 | 树内引用更新**单一遍历实现**：rename / clear 两模式共享待匹配形态派生（资源地址 + [[链接]] 双载体、回收站退化、跨文件夹移动取新位置、非 .md 文档带扩展名）与写回规则；拆开会让「重命名改写」与「删除清理」两条路径的匹配口径漂移。`renamedMdLinkDest` 把 md 目标绕回 `parseWikilink` 是**安全**的（上游 `mdTargetRenamed` 已排除空串与含 `|`/`#` 的目标），勿误改为「直接构造 parts」 |
| `src/links/file-lookup.ts` | 363 | 全库文件索引（键形态 / 缓存新鲜度 / 增量补建）与**「新建引用路径形态」的唯一组合判定**（官方 `New link format` 三档 + basename 同名消歧 + `domain/wikilink.formatLinkPath` 拼接）。后者 2026-10-20 从 `features/view-node-actions` 上收：文档链接与图片引用共用同一份——拆开会让「读设置 / 判同名 / 拼路径」在两处各写一遍（图片侧此前正是直接写 `file.path`，无视设置）。 |
| `src/links/links-resolve.ts` | 353 | 「任意地址形态 → TFile」的**统一解析入口**：远程拒绝 → `obsidian://` → 资源地址 → 路径直查 → `file://` 剥离 → 官方 `getFirstLinkpathDest` → 索引兜底——形态路由的**分支顺序本身即契约**（新增规则只改这一处）；拆开会重新引入本文件当初拆出要收敛的「双轨并存、覆盖形态互有盲区」问题 |
| `src/features/node-inline-editor.ts` | 384 | 节点内联编辑的**单一会话收口**（K92）：覆盖层定位与跟随（`scale` / `node_tree_render_end` 重定位）、键盘语义表、点击外部与 `mousewheel` 提交、会话所属引擎守卫、提交写回（`applyRawNodeContent`）共享同一套「会话 → 值 → 落数据」不变式；拆开会让定位跟随与提交守卫跨文件失配 |
| `src/services/document-service.ts` | 367 | md 文档读写数据面：**读**（`DocumentService.load` → `parseMdOutline` + `walkResolveImagePaths`）与**写**（`SavePipeline` → 防抖调度 + 串行排空 + 卸载快照兜底 + 无差异跳过 + P1a 外部改动检测 / P1b 连续失败挂起）成对。 |

## 参考文档

`docs/` 清单（`agents-md-sync` 校验前两项真实存在）：

```
docs/
  markdown-mindmap-standard.md   # Markdown ↔ 思维导图映射规则（**权威标准**，改往返格式须同步）
  agents/architecture.md         # 模块职责、数据流、依赖矩阵、豁免理由详录
  agents/baseline-metrics.md     # 可复现基线（门禁/打开性能/体积归因/静态指标/核销台账）
  agents/conventions.md          # 关键约定 K1–K125 全文（含实测账本与踩坑记录）
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
