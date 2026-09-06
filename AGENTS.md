# MindMap Studio — Obsidian 社区插件（Markdown 渲染层）

## 项目概览

- 目标：Obsidian 社区插件（TypeScript → 打包为 JavaScript）。
- 定位：**Markdown 渲染层**——`.mindmap.md` 是 100% 标准 Markdown（frontmatter + 标题 + 列表），插件解析为思维导图、编辑后无损回写为 Markdown；无任何专有格式。
- 入口：`src/main.ts`，编译为 `main.js`，由 Obsidian 加载。
- 发布产物：`main.js`、`manifest.json`、`styles.css`。
- 插件标识：`id: mindmap-studio`（安装目录 `<vault>/.obsidian/plugins/mindmap-studio/`）。
- 引擎：`simple-mind-map 0.14.0-fix.3`，以压缩产物 vendor 于 `vendor/simple-mind-map.cjs`（附手写类型声明 `vendor/simple-mind-map.d.cts`）。引擎 CSS vendor 于 `vendor/simple-mind-map.css`，已合并进根目录 `styles.css`。

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
  main.ts           # 插件入口：生命周期、视图注册、command/file-menu/hover 源、文件事件同步
  domain/           # 纯领域逻辑（无 Obsidian/引擎依赖）
    wikilink.ts     #   双链解析/构造唯一权威（parse/format/display）
    url.ts          #   URL/地址形态谓词唯一权威（isHttpUrl/isExternalImageRef/isSchemeUrl 等）
    tree.ts         #   walkTree 先序遍历（显式栈防溢出，visit 返回 false 短路）
    md-meta.ts      #   MdNodeMeta：节点 data 上 md* 元数据的类型契约
  services/
    document-service.ts # md 文档读取解析 + 保存管线（防抖/串行排空/卸载快照兜底，onSaveError 上报）
    engine-controller.ts# 引擎实例生命周期 + 防腐收口（renderer 内部不外泄）
  features/
    view.ts         # Controller：Obsidian 生命周期编排、service 装配、链接跳转、标题重命名
    view-context.ts # MindMapViewContext：view-* 对视图的访问契约（结构化窄接口）
    view-*.ts       # 工具栏/拖拽/右键/搜索/导出/状态栏/图片灯箱/wikilink 交互/粘贴/节点操作
    file-creator.ts # 文件浏览器「新建」菜单注入（私有 API 防御式访问）
  concurrency.ts    # 并发原语唯一实现：串行队列/防抖/节流（SavePipeline/ViewStateStore 等共用）
  persistence.ts    # data.json 写盘器（PluginDataWriter：串行队列 + 写前重读合并 + 吞错）
  open-as-restore.ts# 「以思维导图打开」偏好恢复（active-leaf-change/file-open/启动多档延时）
  system-open.ts    # 系统默认应用打开库内文件（桌面端 shell.openPath）
  errors.ts         # errorMessage(error)：面向用户的错误消息格式化唯一实现
  md-outline.ts     # Markdown 大纲 → 导图树（frontmatter 跳过、标题/列表、行内 token；mdRaw 保真）
  md-serialize.ts   # 导图树 → Markdown（未编辑逐字回写/编辑合成；链接/图片新增检测）
  md-open.ts        # .mindmap.md 触发判定、视图切换、打开方式偏好钩子
  markdown.ts       # 新建文件默认内容/文件名、uid 修复（ensureUniqueUids）
  view-state.ts     # 按文件路径持久化布局/视口/openAs 到插件 data.json（ViewStateStore）
  images-path.ts    # 图片地址解析、全库查找索引（FileLookupIndexService 单例）、尺寸校正
  images-save.ts    # 图片入库（走 concurrency 串行队列）、文件名清理
  links-resolve.ts  # 库内文件解析（路径/拖拽落点）
  links-tree.ts     # 树内引用更新（重命名/删除）
  modal-*.ts        # 链接/图片/命名弹窗（官方 AbstractInputSuggest 联想）
  mindmap.ts        # 引擎封装（创建/销毁/节点工具）+ 防腐收口（缩放/getRenderRoot/setNodeText/
                    #   forceRemoveNodeData/getNodeGroupEl/runWithExportScale/countTreeNodes）
  mindmap-theme.ts  # 主题配置（buildThemeConfig 唯一实现，视图/代码块主题参数化差异）
  event-binder.ts   # DOM/引擎事件绑定器（作用域化统一销毁）
  settings.ts       # 设置接口与设置面板（Obsidian 1.13+ 声明式）+ sanitizeSettings（data.json 校验归一化）
  vault-sync.ts     # 库事件同步（引用更新、索引失效）
  codeblock.ts      # ```mindmap 代码块渲染（Markdown 大纲）
  i18n.ts / constants.ts / creation.ts
tests/
  md-roundtrip.test.ts # md 往返回归（78 断言：解析结构/深度/不动点/编辑合成/uid/视图状态）
  domain.test.ts       # domain 层单测（wikilink 契约 + walkTree 语义）
  concurrency.test.ts  # 并发原语回归（串行队列/防抖/节流：错误传播、尾随保证、重置）
  url.test.ts          # URL 谓词边界（各语义的协议形态与否决集）
  save-pipeline.test.ts# SavePipeline 竞态回归（写入中再触发排空、失败上报、防抖/守卫）
  view-state.test.ts   # ViewStateStore（hydrate 形状校验、防抖写盘、flushNow）
  settings.test.ts     # sanitizeSettings（类型/取值校验、坏值回退默认）
  setup.ts             # vitest 全局 setup：Node 环境 window 桩（fake timers 生效）
  mocks/obsidian.ts    # obsidian 最小 mock（vitest alias，包本身无运行时 JS）
docs/
  markdown-mindmap-standard.md  # Markdown ↔ 思维导图映射规则（权威标准）
```

## 测试与 CI

```bash
npm test        # vitest run（CI 在 build 后、lint 前执行）
```

- vitest 配置 `vitest.config.ts`：`obsidian` → `tests/mocks/obsidian.ts` alias（包仅有类型声明，无运行时 JS）。
- `tsconfig.json` 同时纳入 `src/` 与 `tests/`；`npm run build` 会先 `tsc -noEmit` 类型检查两者。
- eslint 启用 `typescript-eslint` recommended + `no-floating-promises`（`tests/` 豁免 obsidianmd 的 console 规则）。

## 关键约定

- 渲染层定位：正文保持纯 Markdown；布局/视口/打开偏好存 `data.json`（`viewState`，按文件路径），不写入文件。
- 中心主题 ⇄ 文件名：编辑根节点文本会重命名 `.mindmap.md`（Obsidian 原生更新链接/反链）；外部改名后视图重载中心随新名。
- 图片/链接对齐 Obsidian：`![[路径]]`/`[[笔记]]` 往返；插入弹窗联想库内文件；悬停预览用 `registerHoverLinkSource` + `hover-link`。
- 所有 DOM/事件/定时器监听使用 `this.register*` 助手注册，保证卸载清理；引擎实例事件经 `EventBinder` 记录统一销毁。
- URL/地址形态判断只允许引用 `domain/url.ts` 的谓词（勿手写 startsWith 前缀链）；防抖/节流/串行队列一律用 `concurrency.ts` 原语（勿手写 timer/chain 字段）；扩展名清单集中在 `constants.ts`（基表派生，勿复制）。
- 引擎内部形态（`node.group`、导出倍率 `opt` 等）的访问只出现在 `mindmap.ts` 防腐收口函数中，视图层经具名函数使用。
- 引擎 vendor 文件不可手工编辑；升级时用官方源码重新打包并替换。

## 发布流程

1. 更新 `manifest.json` 版本号 → `npm version patch|minor|major`（同步 `versions.json`）。
2. 创建与版本号完全一致的 GitHub Release tag（不带 `v` 前缀）。
3. 附加 `main.js`、`manifest.json`、`styles.css`（`.github/workflows/release.yml` 自动构建并创建草稿 Release）。

## 安全与合规

- 默认本地/离线运行；无遥测、不上传 vault 内容。
- 遵循 Obsidian 开发者政策与插件指南（`isDesktopOnly: true`，minAppVersion 1.13.0）。
