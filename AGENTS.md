# AGENTS.md

## 项目速览

Obsidian 社区插件（TypeScript → esbuild → `main.js`）。把 `.mindmap.md`（**100% 标准 Markdown**：frontmatter + 标题 + 列表）解析为思维导图，编辑后**无损回写**为 Markdown。

- 标识 `mindmap-studio`，安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`
- 发布产物三件套：`main.js` / `manifest.json` / `styles.css`（`main.js` **不入库**，CI 构建）
- 入口 `src/main.ts`；命令 ID 表 `src/commands.ts`（**发布后永不变更**）；设置 `src/settings.ts`
- 引擎 `vendor/simple-mind-map.cjs` = `simple-mind-map 0.14.0-fix.3`，思绪（sxmind.cn）发布的第三方修订版（fork 自 wanglin2/mind-map 0.14.0）。**不 vendor 其 CSS**——上游 dist CSS 100% 是 Quill 富文本样式（本插件不注册 RichText），引擎样式由 bundle 运行时注入 `document.head`；修订与打包流程见 `vendor/BUILD.md`
- 依赖单向 `domain → core → {links,markdown,media,engine,platform} → {ui,services} → features → 组合根`，由 eslint 强制

## 环境与安装

- Node `>=20`（以 `package.json` 的 `engines` 为准），包管理器 npm，打包器 esbuild
- 装依赖 `npm install`｜开发 watch `npm run dev`｜生产构建 `npm run build`
- **实机验证**：把 `main.js` + `manifest.json` + `styles.css` 复制到 `<vault>/.obsidian/plugins/mindmap-studio/`，重启 Obsidian 后在「设置 → 第三方插件」启用；改完代码用 `obsidian plugin:reload id=mindmap-studio` → `obsidian dev:errors`
- ⚠ 同一 `.mindmap.md` **只允许一个导图实例**：在第二个 leaf 打开会提示并让位（两个实例＝两套引擎 + 两条保存管线，交错写会丢编辑）。自动化脚本连续测多个文件前须先 detach 已有的导图 leaf，否则会拿到空视图而误判为功能缺陷


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
| 访问引擎内部形态 | `engine/mindmap.ts` 具名函数 | 防腐收口 |
| 库内文件解析 | `links/links-resolve.resolvePathToFile` | **形态路由顺序即契约** |
| 节点自绘内容 | `features/node-inline-content.ts` | 段序列 + 锚点属性契约 |
| DOM 事件监听 | `Component.register*` 或 `core/event-binder.ts` | 随生命周期自动摘除 |
| 局部 UI 状态 | 视图实例字段 | 不持久化 |
| 需跨会话的视图状态 | `data.json`（经 `core/persistence.ts`） | 布局/视口/打开方式按文件记 |
| 图片尺寸缓存 | 官方 `App.loadLocalStorage` | 按库隔离；**禁**全局 `localStorage`（跨库串味） |
| 错误呈现 | 用户可感 → `notifyError`；内部 → `console.error/warn` | 静默跳过会让问题无痕退化 |

## 标准工作流

### 新增特性
1. **落层**：查决策表；新逻辑并入最贴近的已有模块，勿造第二份收口
2. **官方优先**：`obsidian.d.ts` + 官方帮助；缺口才允许私有触点
3. **实现**：只触碰决策表指定的收口点
4. **测试**：纯逻辑直测；渲染契约交 `verify:visual`
5. **同步**：更新下方「代码结构索引」；超 300 行则登记豁免表
6. **校验**（顺序执行，全绿才提交）：`npm run build` → `npm test` → `npm run lint` → 改过 `styles.css` 加 `npm run lint:css` → 新增/删除导出或文件加 `npm run check:dead-code` → 改过 `vendor/` 加 `npm run build:vendor`

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
| 发布元数据 | `npm run check:release` |
| 实机验证 | `obsidian plugin:reload id=mindmap-studio` → `obsidian dev:errors` |

> Lint 必须在**插件根目录**执行（cwd 依赖，见 `docs/agents/conventions.md`）。

## 代码结构索引

**组合根**（4）：`commands.ts` `creation.ts` `main.ts` `settings.ts`
**domain/**（5）：`md-meta.ts` `tree.ts` `url.ts` `wiki-display.ts` `wikilink.ts`
**core/**（7）：`concurrency.ts` `constants.ts` `errors.ts` `event-binder.ts` `i18n.ts` `node-data.ts` `persistence.ts`
**links/**（3）：`file-lookup.ts` `links-resolve.ts` `links-tree.ts`
**markdown/**（7）：`links-rename.ts` `links-split.ts` `markdown.ts` `md-line-write.ts` `md-open.ts` `md-outline.ts` `md-serialize.ts`
**media/**（2）：`images-path.ts` `images-save.ts`
**engine/**（2）：`mindmap-theme.ts` `mindmap.ts`
**platform/**（8）：`export-css-vars.ts` `export-foreign-object-padding.ts` `math-jax.ts` `nav-history.ts` `open-as-restore.ts` `system-open.ts` `vault-prefs.ts` `vault-sync.ts`
**ui/**（5）：`modal-common.ts` `modal-image.ts` `modal-link.ts` `modal-name.ts` `modal-text.ts`
**services/**（4）：`document-service.ts` `engine-controller.ts` `status-bar.ts` `view-state.ts`
**features/**（27）：`drag-target.ts` `file-creator.ts` `image-resize.ts` `node-codeblock.ts` `node-inline-content.ts` `node-inline-editor.ts` `view-common.ts` `view-context-menu.ts` `view-context.ts` `view-dnd.ts` `view-drag-duplicate.ts` `view-export.ts` `view-hotkeys.ts` `view-image-actions.ts` `view-image-fullscreen.ts` `view-link-navigator.ts` `view-node-actions.ts` `view-node-width.ts` `view-paste.ts` `view-search.ts` `view-split-links.ts` `view-status.ts` `view-title-renamer.ts` `view-toolbar.ts` `view-viewport.ts` `view-wikilink.ts` `view.ts`
**tests/**（62）：`agents-md-sync.test.ts` `concurrency.test.ts` `constants.test.ts` `domain.test.ts` `engine-controller.test.ts` `engine-history-limit.test.ts` `engine-image-size.test.ts` `engine-refresh-nodes.test.ts` `event-binder.test.ts` `export-fo-padding.test.ts` `feature-helpers.test.ts` `feature-teardown.test.ts` `file-lookup.test.ts` `find-node-by-dom.test.ts` `images-path.test.ts` `language-refresh.test.ts` `links-rename.test.ts` `links-resolve.test.ts` `links-split.test.ts` `links-tree.test.ts` `math-jax-export-pin.test.ts` `math-jax.test.ts` `md-inline.test.ts` `md-line-write.test.ts` `md-roundtrip-property.test.ts` `md-roundtrip.test.ts` `mindmap-theme.test.ts` `mindmap-wiki-icon.test.ts` `modal-common.test.ts` `modal-input.test.ts` `nav-history.test.ts` `node-codeblock.test.ts` `node-inline-content.test.ts` `node-inline-editor.test.ts` `node-text-edit.test.ts` `obsidian.ts` `open-as-restore.test.ts` `pasted-name.test.ts` `persistence.test.ts` `plain-text-parser.test.ts` `save-pipeline.test.ts` `settings-persist.test.ts` `settings.test.ts` `setup.ts` `url.test.ts` `vendor-contract.test.ts` `view-context-menu.test.ts` `view-dnd.test.ts` `view-export.test.ts` `view-hotkeys.test.ts` `view-node-actions.test.ts` `view-node-width.test.ts` `view-paste.test.ts` `view-search.test.ts` `view-split-links.test.ts` `view-state.test.ts` `view-status.test.ts` `view-toolbar.test.ts` `view-viewport.test.ts` `view-wikilink.test.ts` `viewport.test.ts` `wiki-display.test.ts`

### 文件规模与豁免（超 300 行须登记；完整理由见 docs/agents/architecture.md）

> 行数基准 2026-10-04；**唯一口径** = 	ests/agents-md-sync.test.ts 的 countSourceLines
>（按 \\n 切分、末尾换行不计行）。**不要**用 PowerShell 的 Measure-Object -Line——
> 口径不同会使登记值与实测对不上。改动任一豁免文件后若 gents-md-sync 转红，
> 必须回来更新本表的行数列。

| 文件 | 行数 | 豁免理由（完整理由见 docs/agents/architecture.md） |
|---|---|---|
| `src/engine/mindmap.ts` | 2115 | 引擎防腐层**唯一收口点**：vendor 内部形态（`node.group`、`renderer.*`、DoExport、Search 插件状态…）只允许在此出现。 |
| `src/markdown/md-serialize.ts` | 1054 | 逐字回写 与 合成回写 的判定/合成必须共享同一份「节点是否被编辑」上下文（`rawOk` 一族谓词），拆分会把它切成跨文件的隐式协议。 |
| `src/markdown/md-outline.ts` | 1046 | 大纲 ↔ 节点树 的单一往返实现：解析与生成共用同一套层级/标记规则。 |
| `src/core/i18n.ts` | 517 | 纯词条表（无逻辑分支）。 |
| `src/features/view.ts` | 1210 | 视图 Controller：**第 6 步拆分后的编排壳**（见文件头契约）。 |
| `src/services/engine-controller.ts` | 815 | **第 4 步从 view.ts 拆出**的引擎防腐收口：引擎实例生命周期（初始化代际锁/零尺寸等待）+ 全部引擎内部访问（`renderer.*`/`view.*`/`opt`）封装为显式方法；导出 SVG 后处理链经 `deps.exportSvgTransforms` 由组合根注入（K51：services 不依赖 features）。 |
| `src/media/images-path.ts` | 618 | 图片引用处理的单一关注点（外部地址判定／路径解析与序列化／尺寸归一）。 |
| `src/features/image-resize.ts` | 411 | 单一交互特性（图片拖拽调宽）：hover 手柄 → 拖拽会话 → 尺寸回写是一条不可分割的状态链（无常驻监听、帧内 DOM 直写、手势独占）。 |
| `src/features/drag-target.ts` | 382 | 单一算法收口（拖拽落点仲裁）：两类锚点（节点中心／兄弟间隙中点）必须共用同一套「按指针距离最近仲裁 + 引擎三态让位」规则。 |
| `src/features/view-node-actions.ts` | 756 | 节点操作（链接/文本/剪贴板/删除）的**共用入口**——工具栏与右键菜单同调；图片操作已拆至 `view-image-actions.ts` 并由本文件 re-export。 |
| `src/features/view-dnd.ts` | 575 | **从 view.ts 拆出**的画布拖入分发（库内文件／外部图片导入）：单一关注点＝拖入内容的类型分发与落点装配 |
| `src/main.ts` | 360 | 官方模板规定的插件入口类（`Plugin`）：`onload`/`onunload` 的装配与生命周期编排。 |
| `src/markdown/links-split.ts` | 486 | 混排双链拆分（规则/计划/写回）的单一往返实现：`SplitLinkPlan` 是计划生成（`planSplitLinks`）与视图层写回（`applySplitLinkPlan` / `splitAllLinksInTree`）共用的内部协议，两侧共享同一套「适用节点／待抽 token／空白归并」不变式（文件头契约，含幂等与资源地址兜底）；拆开会让拆分规则与写回定位漂移。 |
| `src/core/constants.ts` | 452 | 纯清单集中表：标记函数唯一实现 + 布局/连线/主题选项表 + **渲染能力**清单（可渲染标签页 / 可渲染图片 / 可嵌入附件。 |
| `src/settings.ts` | 379 | 设置字段的「接口 → 默认值 → `sanitizeSettings` 校验 → 声明式面板项」四者一一对应、单文件闭环：新增设置项＝单文件同步四处即闭合；拆开（如面板独立）会让四份清单跨文件漂移。 |
| `src/features/node-inline-content.ts` | 1327 | 自绘节点内容的**单一关注点**闭环：行内原文 → 段序列（含轻标记切分）→ HTML（锚点契约 + **内联样式常量**）。 |
| `src/features/view-wikilink.ts` | 411 | 链接交互**单一关注点**：**点击路径**的锚点识别（`findAnchorInNode` / `resolveAnchorLink`）与**悬停预览**（两级：锚点优先 + 节点级 `nodeLink` 三通道 + `hover-link` 事件）同在一处，还有中键 `auxclick`；把悬停拆出去会让「链接怎么取、锚点取哪个目标」出现第二份实现——正是本文件当初拆出（原在 view.ts）要消除的问题。 |
| `src/platform/math-jax.ts` | 813 | 数学渲染通道**单一落点**（全插件唯一 import `obsidian` 的数学实现）：产品形态是「字面占位 → 异步替换 → 就绪判据（全部 `mjx-c` 宽 > 0 + 不可见操作符 U+2061 豁免。 |
| `src/links/links-tree.ts` | 464 | 树内引用更新**单一遍历实现**：rename / clear 两模式共享待匹配形态派生（资源地址 + [[链接]] 双载体、回收站退化、跨文件夹移动取新位置、非 .md 文档带扩展名）与写回规则；拆开会让「重命名改写」与「删除清理」两条路径的匹配口径漂移 |
| `src/links/links-resolve.ts` | 351 | 「任意地址形态 → TFile」的**统一解析入口**：远程拒绝 → `obsidian://` → 资源地址 → 路径直查 → `file://` 剥离 → 官方 `getFirstLinkpathDest` → 索引兜底——形态路由的**分支顺序本身即契约**（新增规则只改这一处）；拆开会重新引入本文件当初拆出要收敛的「双轨并存、覆盖形态互有盲区」问题 |
| `src/features/node-inline-editor.ts` | 384 | 节点内联编辑的**单一会话收口**（K92）：覆盖层定位与跟随（`scale` / `node_tree_render_end` 重定位）、键盘语义表、点击外部与 `mousewheel` 提交、会话所属引擎守卫、提交写回（`applyRawNodeContent`）共享同一套「会话 → 值 → 落数据」不变式；拆开会让定位跟随与提交守卫跨文件失配 |
| `src/services/document-service.ts` | 365 | md 文档读写数据面：**读**（`DocumentService.load` → `parseMdOutline` + `walkResolveImagePaths`）与**写**（`SavePipeline` → 防抖调度 + 串行排空 + 卸载快照兜底 + 无差异跳过 + P1a 外部改动检测 / P1b 连续失败挂起）成对。 |

## 参考文档

`docs/` 清单（`agents-md-sync` 校验前两项真实存在）：

```
docs/
  markdown-mindmap-standard.md   # Markdown ↔ 思维导图映射规则（**权威标准**，改往返格式须同步）
  agents/architecture.md         # 模块职责、数据流、依赖矩阵、豁免理由详录
  agents/conventions.md          # 关键约定 K1–K112 全文（含实测账本与踩坑记录）
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
