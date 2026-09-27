# 实现方案：`mindmap` 代码块嵌入渲染（MindMap Studio）

> 2026-09-28。依据《调研报告：轻量级标记语言插件实现 Obsidian 代码块渲染》
> （`docs/codeblock-rendering-research.md` §11/§12）细化。
> 范围裁决（用户 2026-09-28）：Prism 高亮、CM6 实时预览 widget、编辑回写、Publish **不做**；
> 实现其余官方 API 功能。**本方案确认后才编码。**

---

## 0. 目标与范围

在普通 Markdown 笔记中写 ` ```mindmap ` 围栏块，阅读视图/实时预览将其**就地渲染为只读导图**：

````md
```mindmap
# 中心主题
## 分支 A
- 叶子 1
- 叶子 2
## 分支 B
```
````

- **做**：代码块处理器注册、块体大纲解析、引擎只读渲染、自绘节点内容（数学/链接/轻标记与
  主视图同源）、生命周期与幂等、主题联动、尺寸自适应、性能降级、错误兜底、popout。
- **不做**（P2+，另行裁决）：Prism 高亮、CM6 编辑器扩展、渲染态编辑回写、Publish、新增设置项。

## 1. 架构落位（分层符合 zone 规则）

| 位置 | 内容 |
|---|---|
| `src/main.ts`（组合根） | `this.registerMarkdownCodeBlockProcessor('mindmap', handler)`（官方 d.ts:5001） |
| `src/features/codeblock-mindmap.ts`（新） | handler + `MindmapEmbedRenderChild`（MarkdownRenderChild）+ 降级/错误卡片 |
| `src/features/node-content-factory.ts`（新，小重构） | 从 `view.ts:395-418` 抽取 `createNodeContent` 闭包为共享工厂（view 与 codeblock 共用；K88 remeasure 回调参数化注入） |
| `src/markdown/md-outline.ts` | 复用 `parseMdOutline(content, rootName)`（:819）——块体大纲 → 树，不改 |
| `src/engine/mindmap.ts` | 复用 `createMindMap`（:294）/`destroyMindMap`/`centerContentAtFullScale`/`cancelEngineTimers`/`countTreeNodes`/`findNodeByDom`/`refreshNodeCustomContent`，不改 |
| `styles.css` | `.mindmap-embed` 前缀规则（尺寸/边框/主题变量） |
| `core/i18n` | 降级/错误文案键 |

分层面检查：features → engine/markdown/platform/core 均在许可集内；组合根只做注册与装配。

## 2. 数据流

```
source(块体)
  → parseMdOutline(source, rootName) → { tree }
  → normalizeEmbedTree(tree)【新逻辑：见 §3.2】
  → createMindMap(el, tree, options)【只读取值，见 §3.3】
  → 引擎 'node_tree_render_end' → centerContentAtFullScale
重渲染：源码编辑 → section 重建 → handler 重跑（幂等：el.empty()）
主题：workspace.on('css-change') → isDark 重算 → setThemeConfig（§3.6）
尺寸：ResizeObserver → mindMap.resize()
卸载：RenderChild.onunload → cancelEngineTimers + destroyMindMap
```

## 3. 关键实现点

### 3.1 注册与 handler 形态（main.ts + feature 模块）

```ts
this.registerMarkdownCodeBlockProcessor('mindmap', (source, el, ctx) =>
  renderMindmapEmbed({ plugin, source, el, sourcePath: ctx.sourcePath, addChild: (c) => ctx.addChild(c) }),
);
```

handler 幂等：首行 `el.empty()` → `el.createDiv('mindmap-embed')` 前缀容器；解析/渲染全程
try/catch，失败渲染统一错误卡片（类名 + 消息 + console.warn），不抛穿渲染管线。

### 3.2 块体解析与树归一（新逻辑，可单测）

- `parseMdOutline(source, rootName)` 会造一个虚拟文档根（text=rootName）。
- **归一规则**：若虚拟根只有 1 个子节点 → 以该子节点为展示根（块体 `# 主题` 时根显示"主题"
  而非无意义的 rootName）；多个一级标题 → 保留虚拟根，rootName 取块体首个 `#` 行文本，
  无标题时回退 `'mindmap'`。
- 空块体（无有效行）→ 空态卡片提示。

### 3.3 引擎取值（只读预览口径）

`CreateMindMapOptions`：

| 项 | 取值 | 理由 |
|---|---|---|
| `layout` / `lineStyle` / `themePref` | 复用现有设置（defaultLayout / defaultLineStyle / defaultTheme） | 与主视图口径一致 |
| `isDark` | `app.isDarkMode()`（官方 @since 1.10.0，view.ts:352 同款） | 勿用未文档化 body class |
| `enableDrag` | **false** | 只读预览禁拖拽 |
| `performanceMode` / `performanceThreshold` | 复用设置 | 大块复用分片渲染 |
| `lang` | i18n 当前语言 | 引擎内置文案 |
| `createNodeContent` | 共享工厂产出（§3.4） | 数学/链接/轻标记与主视图同源；**顺带获得「双击编辑对自绘节点静默 no-op」守卫** |
| `onHyperlinkJump` | 复用 view-link-navigator 跳转收口，`sourcePath = ctx.sourcePath`（相对链接按宿主笔记解析） | 预览内点击链接可用 |
| `renderAsync` | 不传（走生产阈值判据） | 与主视图一致 |

### 3.4 自绘节点共享工厂（唯一重构点）

把 `view.ts:395-418` 的 `createNodeContent` 闭包抽为：

```ts
// features/node-content-factory.ts
createNodeContentFactory({
  selfDrawPlain: () => settings.selfDrawPlainNodes,
  isResolvedLink: (linkpath) => boolean,        // view 注 view 解析器；codeblock 注 metadataCache 解析器
  onMathSettled: (holder) => void,             // view= scheduleMathRemeasure；codeblock= 本块局部重排
})  // → CreateMindMapOptions['createNodeContent']
```

内部注入面不变：`gateNodeWidthHandles`、`renderMathWithMathJax`（P4 定稿回调）、
`getRenderedMathNode`（缓存同步放置）。**语义等价重构**，view 行为零变化（K88 契约保持）。
codeblock 侧 `onMathSettled`：`findNodeByDom` 反查真实节点 → `refreshNodeCustomContent`
（复用 view 的批次重排模式，去抖合并）。

### 3.5 视口与尺寸

- 容器 CSS：`.mindmap-embed { height: 360px; resize: vertical; overflow: hidden; }`
  （用户可拖高；P0 不加设置项）。
- `ResizeObserver` 监听容器 → `mindMap.resize()`（Observer 在 RenderChild 注册、`onunload` 断开）。
- 首次渲染完成（`node_tree_render_end`）→ `centerContentAtFullScale`（100% 缩放 + 内容居中，
  与主视图打开口径一致，可读性优于 fit）。

### 3.6 主题联动

插件级（main.ts）`registerEvent(workspace.on('css-change'))` → 遍历**活动 embed 注册表**
（`Set<MindmapEmbedRenderChild>`，unload 时自删）→ 重算 `isDark` → `setThemeConfig`。
不在每个 child 各挂一条 workspace 事件（资源与去重更好管）。

### 3.7 性能降级

- `countTreeNodes(tree) > CODEBLOCK_MAX_NODES`（常量 **500**，常量进 core/constants 并入
  设置钳制口径注释）→ **不建引擎**，渲染只读缩进大纲 HTML（树 → 嵌套 `<ul>`）+ 顶部提示
  「节点 N 超出嵌入上限 M，仅显示大纲」。
- 理由：笔记内多块 × 重引擎的打开成本主体；大纲形态零成本且信息不丢。

### 3.8 popout / 多窗口

- DOM 一律用 `el` 属主文档口径（项目既有规则）；`css-change` 后重算 `app.isDarkMode()`
  对主窗口主题成立，popout 跟随（与主视图同口径）。
- 渲染产物/定时器全部随 RenderChild 生命周期销毁，popout 关闭即回收。

## 4. 改动面清单

| 文件 | 改动 |
|---|---|
| `src/features/codeblock-mindmap.ts` | **新增**（~230 行：handler/RenderChild/归一/降级/错误卡片） |
| `src/features/node-content-factory.ts` | **新增**（~40 行，等价抽取） |
| `src/features/view.ts` | `createNodeContent` 闭包 → 工厂调用（等价重构，~10 行净删） |
| `src/main.ts` | 注册处理器 + css-change 分发（~15 行） |
| `src/core/constants.ts` | `CODEBLOCK_MAX_NODES = 500` |
| `styles.css` | `.mindmap-embed` 规则（~25 行） |
| `core/i18n` | 降级/空态/错误文案键（zh/en） |
| `tests/codeblock-mindmap.test.ts` | **新增**：树归一 / 降级判定 / 幂等 / 错误兜底（引擎 mock） |

## 5. 测试与验收

- **单测**（新增 4 组）：归一规则（单根折叠/多根保留/空体）、降级阈值判定、handler 幂等
  （同一 el 重跑两次 DOM 结构一致）、解析异常错误卡片。
- **全链**：build → test → lint（zone 规则自动校验新文件分层）→ verify:visual（回归）。
- **手动验收清单**：普通笔记单块渲染；编辑块体后重渲染；同笔记两块共存；主题明暗切换；
  数学节点渲染（`$E=mc^2$`）；块内链接点击跳转；popout 打开宿主笔记；500+ 节点降级；
  拖动 `resize: vertical` 改高。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 引擎离屏测宽在流式布局 0 尺寸 | 容器固定高度先行确立尺寸；ResizeObserver 就绪后再建引擎 |
| 语言键 `mindmap` 被旧插件（如 Enhancing Mindmap）抢注 [待实测] | 文档提示冲突；行为未文档化，实测后必要时换 `mindmap-embed` 键 |
| 预览内引擎编辑框 | 自绘节点自带 `isUseCustomNodeContent` 守卫静默 no-op；纯文本节点引擎编辑改的是预览内存态、重渲染即还原（可接受，P1 再评估禁用） |
| 多块 × MathJax flush 排程 | platform/math-jax 已按批合并（单飞），天然复用 |
