# 调研报告：轻量级标记语言插件实现 Obsidian 代码块渲染

> 调研日期：2026-09-27。
> 证据源：`D:\Obsidian\obsidian-api-master`（obsidian.d.ts / publish.d.ts，官方类型定义）、
> `D:\Obsidian\obsidian-help-master\zh`（官方中文帮助）、官方开发者文档
> （docs.obsidian.md «Markdown post processing»，逐字取证）。
> 标注约定：**[官方]** = 本地 API/帮助文档可直接印证；**[社区]** = 来自知名开源插件的实现共识
> （Dataview / Admonition / PlantUML / Graphviz / D2 / Charts / Tracker 等，未逐行核对源码）；
> **[待实测]** = 官方未文档化、需在目标环境验证的点。

---

## 0. 结论速览

1. 代码块渲染的**唯一官方入口**是 `Plugin.registerMarkdownCodeBlockProcessor(language, handler, sortOrder?)`：
   核心先把围栏块渲染成 `<pre><code>`，再由这个"特殊 post processor"**移除该元素、换成空 `<div>` 交给 handler**（[官方]，obsidian.d.ts:4994-5001）。
2. 渲染转换层有三种成熟模式：**本地解析**（自研解析器 + DOM 构建）、**本地引擎/WASM**（Mermaid、Viz.js、Chart.js）、**外部服务/二进制**（PlantUML 服务器、D2 CLI，配 `requestUrl` / `child_process`）。
3. 嵌套 Markdown、事件、定时器等一切需要清理的资源必须挂 `MarkdownRenderChild` + `ctx.addChild()`——容器脱离 DOM 即自动卸载（[官方]，obsidian.d.ts:4010-4016、4107-4114）。
4. 语法高亮走 `loadPrism()`（Obsidian 内置 Prism，含主题化 token 样式）；**官方明确：实时预览与源码模式不使用 PrismJS**（[官方]，帮助《基本格式语法》"PrismJS 与编辑视图"）。
5. 实时预览的深度定制走 CodeMirror 6：`Plugin.registerEditorExtension()`（[官方]，obsidian.d.ts:5019，0.12.8+），属进阶项。
6. 兼容性四要点：语言名抢注冲突、CSS 作用域泄漏、主题切换重渲染（`workspace.on('css-change')`）、导出与 Publish 场景（publish.d.ts 提供同名注册口）。

---

## 1. 背景与调研范围

"轻量级标记语言插件"指：在普通 Markdown 笔记里，借助**围栏代码块的语言标识**承载另一种轻量标记
（` ```mermaid `、` ```plantuml `、` ```ad-note `、` ```dataview `、` ```mindmap `…），
并在阅读视图/实时预览中把代码块**就地渲染为可视化结果**的一类插件。本报告覆盖：

- 代码块语法如何被解析、如何路由到插件处理器（§3）；
- source → 可视化结果的转换架构与三种执行模式（§5）；
- 全部相关 Obsidian API（§4，含签名、版本、本地 d.ts 出处）；
- 语法高亮（Prism）与样式定制（CSS 变量/主题/代码片段）（§6）；
- 实时预览的进阶定制路径（§7）；
- 已知插件的实现方案横向对比（§8）、技术难点（§9）、兼容性（§10）；
- 推荐技术路径与分层实现思路（§11），以及面向 MindMap Studio 的应用建议（§12）。

---

## 2. 渲染管线总览：代码块在三种视图下的命运

Obsidian 有三种查看模式，代码块在其中的处理路径不同：

| 模式 | 围栏代码块的呈现 | Prism 高亮 | 代码块处理器 | 普通 post processor |
|---|---|---|---|---|
| **阅读视图** | `<pre><code>` → 处理器替换为 `<div>` | ✅（Prism token 类） | ✅ 运行 | ✅ 运行 |
| **实时预览** | 非编辑态可渲染为只读 widget（光标进入显示源码） | ❌（CM6 语言包承担高亮，[官方]帮助"PrismJS 与编辑视图"） | ✅ 运行（Mermaid/Dataview 先例）[社区] | ❌ 不运行 |
| **源码模式** | 纯文本 | ❌ | ❌ | ❌ |

[官方] 依据：帮助《基本格式语法·代码》信息标注——"源码模式和实时预览不支持 PrismJS，可能会以不同方式
渲染语法高亮"（`编辑与格式化/基本格式语法.md` 418-419 行）；d.ts 对
`registerMarkdownCodeBlockProcessor` 的定位是"阅读视图渲染后处理"（4994-5001）。
实时预览中代码块处理器的运行细节属 **[社区]** 共识（以 Mermaid/Dataview 的实测行为为准），
官方开发者文档未系统化说明——**深度依赖此行为的特性需实机验证**。

Post processor 的执行粒度：**按渲染段落（section）分块调用**，不是整篇一次（[社区]共识）；
`MarkdownPostProcessorContext.docId` 可用于区分不同文档的渲染会话（[官方]，d.ts:4000）。

---

## 3. 解析层：围栏语法 → 处理器调用

### 3.1 围栏语法（官方口径）

- 三个**及以上**反引号或波浪线包裹；闭合围栏长度 ≥ 开启围栏（嵌套代码块原则：外层用更多/不同的
  围栏字符，`基本格式语法.md` 421-449 行）——这对"在文档里示范代码块"与"生成代码块的代码"很重要。
- 开启围栏后紧跟**语言标识**（如 ` ```js `、` ```plantuml `）：该标识既是 Prism 高亮的语言键，
  也是代码块处理器的**注册键**。
- 语言标识后的剩余信息串（如 ` ```chart {"theme":"dark"} `）**不会**传给 handler——
  handler 签名只有 `(source, el, ctx)`（[官方]，d.ts:5001）。需要参数的插件要么把参数放进块体
  （Admonition/Charts 的 YAML 头做法），要么自行约定。
- 缩进 4 空格/Tab 也可形成代码块（375-395 行），但**没有语言标识**，不会路由到处理器。

### 3.2 注册与调用机制

**[官方]** d.ts 注释逐字（obsidian.d.ts:4993-5001）：

> Register a special post processor that handles fenced code given a language and a handler.
> This special post processor takes care of removing the `<pre><code>` and create a `<div>` that
> will be passed to the handler, and is expected to be filled with custom elements.

即：核心先按普通围栏块渲染出 `<pre><code>`（含 Prism 高亮尝试），注册的"特殊 post processor"
再把 `<pre><code>` **移除**、生成空 `<div>` 传给 handler，由 handler 填充自定义内容。
官方示例（docs.obsidian.md «Markdown post processing»）是一个 `csv` 块 → `<table>` 的最小实现，
全程用 Obsidian 扩展的 DOM 助手 `el.createEl()`。

### 3.3 匹配细节与边界 [待实测]

- 语言键匹配**大小写不敏感**（社区行为共识；`dataview`/`DataView` 均命中）。
- 一次注册只绑定一个语言键；别名需多次注册（Admonition 为 `ad-note`/`ad-tip`… 逐个注册；
  PlantUML 同时注册 `plantuml`/`plantuml-svg`/`plantuml-ascii`）。
- **多个插件注册同一语言键的仲裁行为官方未文档化**——实务建议：使用专属语言名（前缀化），
  避免抢注 `csv`/`json` 这类通用名。
- handler 可能被**多次调用**（源码编辑后 section 重渲染、折叠/展开、主题变更、popout 打开等），
  处理器必须幂等（先 `el.empty()` 或检查自建标记）——见 §5.4。

---

## 4. 核心 API 清单

| API | 签名要点 | 版本 | 出处 | 用途 |
|---|---|---|---|---|
| `Plugin.registerMarkdownCodeBlockProcessor` | `(language: string, handler: (source, el, ctx) => Promise<any> \| void, sortOrder?) => MarkdownPostProcessor` | 0.9.7 | obsidian.d.ts:5001 | **入口**：按语言注册代码块处理器 |
| `Plugin.registerMarkdownPostProcessor` | `(processor, sortOrder?) => MarkdownPostProcessor` | 0.9.7 | obsidian.d.ts:4992 | 对渲染后 DOM 做通用后处理（非代码块专用） |
| `MarkdownPostProcessor` | `(el, ctx) => Promise<any> \| void`，带 `sortOrder` 属性（越小越先） | — | obsidian.d.ts:3984-3991 | 处理器类型 |
| `MarkdownPostProcessorContext` | `docId` / `sourcePath` / `frontmatter` | — | obsidian.d.ts:3996-4007 | 渲染上下文：来源文件、frontmatter、会话标识 |
| `ctx.addChild` | `(child: MarkdownRenderChild) => void` | — | obsidian.d.ts:4010-4016 | **生命周期**：容器被移除时自动卸载 child |
| `ctx.getSectionInfo` | `(el) => MarkdownSectionInformation \| null` | — | obsidian.d.ts:4017-4023 | 反查该块在源文件中的 `lineStart/lineEnd`（**可能为 null**） |
| `MarkdownRenderChild` | `extends Component`，构造传 `containerEl` | 0.9.7 | obsidian.d.ts:4104-4115 | 渲染结果的生命周期载体（事件/定时器/子组件统一清理） |
| `MarkdownRenderer.render` | `static (app, markdown, el, sourcePath, component) => Promise<void>` | — | obsidian.d.ts:4147 | **嵌套 Markdown 渲染**（`renderMarkdown` 已 @deprecated，4134-4137） |
| `MarkdownSectionInformation` | `{ text, lineStart, lineEnd }` | — | obsidian.d.ts:4151-4158 | 源码定位（配合编辑回写） |
| `loadPrism` | `() => Promise<any>`，resolve 后亦可直接用全局 `Prism` | — | obsidian.d.ts:3872-3878 | 语法高亮（§6） |
| `Plugin.registerEditorExtension` | `(extension: CM6 Extension) => void` | 0.12.8 | obsidian.d.ts:5013-5019 | 实时预览定制（§7） |
| `requestUrl` | `(RequestUrlParam \| string) => Promise<RequestUrlResponse>`，**无 CORS 限制** | — | obsidian.d.ts:5438-5442 | 服务器渲染模式（PlantUML/Kroki 类） |
| `workspace.on('css-change')` | `() => EventRef` | 0.9.7 | obsidian.d.ts:8114-8118 | 主题/片段变更后重渲染适配 |
| `sanitizeHTMLToDom` | `(html: string) => DocumentFragment` | — | obsidian.d.ts:5524-5525 | 需要插入外来 HTML 时的官方净化入口 |
| `Publish.registerMarkdownCodeBlockProcessor` | 同上（Publish 站点版） | — | publish.d.ts:490-497 | 让代码块在 **Obsidian Publish** 上同样生效 |

另：manifest.json 的 `isDesktopOnly` 声明桌面限定（`child_process` 等桌面 API 的插件必填）。

---

## 5. 转换层：source → 可视化结果

### 5.1 三种执行模式

| 模式 | 代表 | 机制 | 取舍 |
|---|---|---|---|
| **A. 本地解析** | Admonition、官方 CSV 示例 | 自研解析器 → `createEl` DOM 构建 | 零依赖、同步快；复杂排版自担 |
| **B. 本地引擎/WASM** | Mermaid（核心）、Graphviz（Viz.js）、Charts（Chart.js）、Tracker | 引擎产出 SVG/canvas/HTML 注入 `el` | 能力强；注意引擎体积、初始化成本、内存 |
| **C. 外部服务/二进制** | PlantUML（`requestUrl` + 服务器）、D2（`child_process` 调本地 CLI） | 服务端/进程渲染 → `<img>`/SVG 回填 | 免前端集成；有网络/环境依赖，D2 类需 `isDesktopOnly` |

### 5.2 DOM 构建约定

- 用 Obsidian 扩展的 DOM 助手：`el.createEl/createDiv/createSpan`（官方示例即用 `el.createEl('table')`）。
- **不要用 `innerHTML` 直插含用户数据的字符串**（XSS 面 + 与净化口径冲突）；确需插入外来 HTML
  时走 `sanitizeHTMLToDom()`（[官方]，d.ts:5524-5525）。
- 生成内容包一层**插件前缀类名**容器（如 `mv-block`），既是样式作用域也是幂等标记。

### 5.3 异步与失败安全

- handler 可返回 `Promise`，核心会等待；长任务（WASM 初始化、网络）先放占位元素再异步回填，
  避免长阻塞与"空白块"。
- 解析失败**不要抛出未捕获异常**：渲染错误卡片（类名 + 消息 + 原文摘要）到 `el`，
  保持"宁可见的错误，不要无痕空白"（与本项目 math-jax 的回退哲学一致）。

### 5.4 生命周期与幂等（最易踩坑处）

**[官方]** 两条注释构成完整语义链：

- `ctx.addChild`："Adds a child component that will have its lifecycle managed by the renderer…
  if the containerEl of the child is ever removed, the component's unload will be called"
  （obsidian.d.ts:4010-4016）。
- `MarkdownRenderChild`："when it's no longer attached (for example, when it is replaced with a
  new version because the user edited the Markdown source code), this component will be unloaded"
  （obsidian.d.ts:4107-4114）。

实务约定（[社区]共识 + 与本项目经验同构）：

1. handler 首行 `el.empty()`（或检查 `el.querySelector('.<prefix>-block')` 防重复），保证多次调用幂等；
2. 需要事件/定时器/子引擎实例的块：`ctx.addChild(new MyRenderChild(el))`，在 child 的
   `onunload`/`onClose` 里销毁引擎实例、解除监听——容器被替换时自动触发；
3. 嵌套 Markdown 用 `MarkdownRenderer.render(app, md, el, ctx.sourcePath, child)`，
   `component` 参数传该 child（生命周期随容器走）；
4. 局部重渲染：源码变更 → section 重建 → handler 重跑，是**常态**而非异常；
   重量级渲染（图表/图形引擎）应做"内容 hash → 产物缓存"（可对照本项目 `renderedMathCache`
   的按 TeX 内容寻址复用模式）。

### 5.5 编辑回写（可选能力）

`ctx.getSectionInfo(el)` 拿到 `lineStart/lineEnd` 后可配合 `vault.process()` /
`editor.replaceRange()` 做"渲染结果→源码"的编辑回写（Dataview 类插件的编辑入口、Admonition 的
callout 互转）。注意 d.ts 明示**可能返回 null**（4018-4023），必须判空降级。

---

## 6. 语法高亮与样式定制

### 6.1 语法高亮（Prism）

- Obsidian 内置 Prism，官方入口 `loadPrism(): Promise<any>`（d.ts:3872-3878，resolve 后全局 `Prism`
  同引用）。高亮调用：`Prism.highlight(code, Prism.languages[lang], lang)`。
- **自定义语言**：Obsidian 的 Prism 内置常见语言；轻量标记语言需自行注册 grammar——
  `Prism.languages['my-lang'] = { … }`（Admonition 为块内参数语法注册自定义 grammar 是先例 [社区]）。
- **只渲染源码形态时才需要高亮**：块体被整体可视化的（Mermaid/D2/Charts）通常不高亮块体；
  "保留可编辑源码 + 提供高亮"的场景（Admonition 块内 Markdown、代码演示类）才用。
- **编辑视图高亮断层**：官方明示实时预览/源码模式不用 PrismJS（帮助 418-419），LP 下围栏块
  高亮由 CM6 语言包承担——同一语言在阅读视图与 LP 的配色可能不同，属官方已知差异。

### 6.2 样式定制

1. **作用域**：所有规则挂在插件前缀类下（`.mylang-block …`），必要时用 `:where()` 降低优先级，
   避免污染与被覆盖。
2. **主题适配**：颜色一律取 Obsidian CSS 变量（`--background-primary`、`--code-background`、
   `--code-normal`、`--font-monospace`…），dark/light 用 `body.theme-dark / .theme-light` 分支，
   不写死色值——这是与任意主题兼容的关键（[社区]共识；主题机制见帮助《主题》《CSS 代码片段》）。
3. **主题变更响应**：`workspace.on('css-change')`（d.ts:8114-8118）后对已渲染块重跑引擎
   （Mermaid 类对主题敏感）；配合缓存时按"内容 hash + 主题指纹"双键。
4. **Prism token 样式**：token 类的颜色由官方主题提供，插件一般**不要**覆盖 `.token.*` 全局规则；
   要定制就在自己的前缀作用域内。
5. **代码片段**：用户可用 CSS 片段覆盖插件样式——插件应保证类名稳定并在文档中公布可定制点。

---

## 7. 实时预览（进阶路径）

- **无需额外工作**的部分：LP 中非编辑态的围栏块会走代码块处理器渲染（Mermaid/Dataview 的
  实机行为 [社区]）；光标进入块内则回显源码供编辑——LP 的默认交互已经可用。
- **需要 CM6 的部分**：想在 LP 中改变代码块的呈现/交互（如行内 mini 预览、诊断标注、折叠），
  用 `Plugin.registerEditorExtension()`（0.12.8+）挂 CM6 扩展：
  `ViewPlugin` / `StateField` + `Decoration.replace({ widget })` 把块区间替换为 `WidgetType`，
  光标命中区间时 `EditorSelection` 变化即回显源码。成本高（CM6 学习曲线 + 与核心编辑行为协调），
  建议列为 P2，P0/P1 阶段接受"LP 块体源码形态、阅读视图可视化"的默认行为。
- 风险：CM6 扩展与其他编辑器类插件（各种 LP 增强插件）的装饰冲突，需用 `precise/extend` 装饰
  优先级与独立 side effect 管控 [社区]。

---

## 8. 现有插件方案对比

> 基于各开源插件公开实现的机制层对比 [社区]；版本演进较快，逐项以当前源码为准。

| 插件 | 语言键 | 执行位置 | 依赖 | 嵌套 Markdown | 高亮 | LP | 缓存/更新 |
|---|---|---|---|---|---|---|---|
| **Mermaid**（核心） | `mermaid` | 本地引擎 | 内置 mermaid | ❌ | ❌（整块可视化） | ✅（官方先例） | 主题变更重渲染 |
| **Admonition** | `ad-note` 等 | 本地解析 + MarkdownRenderer | 无 | ✅（块体渲染 md） | ✅ 自定义 Prism grammar | ✅ | callout 互转、设置热更 |
| **Dataview** | `dataview` / `dataviewjs` | 本地查询引擎 | 自研引擎 | ✅（结果渲染） | ❌ | ✅（含 CM6 行内扩展） | `metadataCache` 订阅 + 局部重渲；`dataviewjs` 走 iframe 沙箱 |
| **PlantUML** | `plantuml*` | **服务器**渲染 | `requestUrl` | ❌ | ❌ | ✅ | 服务端出图，`<img>` 回填 |
| **Graphviz** | `graphviz` / `dot` | 本地 WASM（Viz.js） | viz.js 打包 | ❌ | ❌ | ✅ | 同步渲染，体积大 |
| **D2** | `d2` | **本地二进制**（CLI） | `child_process`，`isDesktopOnly` | ❌ | ❌ | ✅ | 进程渲染 + 文件监听 |
| **Charts** | `chart` | 本地库（Chart.js） | chart.js 打包 | ❌（块体 YAML 参数） | ❌ | ✅ | 主题变量取色 |
| **Tracker** | `tracker` | 本地 JS 引擎 | 自研 | ✅（图表输出） | ❌ | ✅ | 月度查询 + 图表 |

模式归纳：**轻量语法包装（A）** 选 Admonition 路线；**图形/图表（B）** 选 Mermaid/Charts 路线；
**重型渲染（C）** 按目标环境选 PlantUML（跨端、有网）或 D2（桌面、离线）路线。
移动端可用性排序大致为 A > B > C。

---

## 9. 关键技术难点

1. **重渲染幂等**：handler 在源码编辑/主题变更/视图切换后反复执行；残留 DOM、重复监听、
   重复引擎实例是最常见缺陷源（官方未文档化重跑时机，需按 §5.4 约定防御）。
2. **生命周期挂钩**：不用 `ctx.addChild` 时，事件/定时器/WASM 实例随 section 重建而泄漏；
   `MarkdownRenderChild.containerEl` 脱离 DOM 的自动卸载语义必须吃透。
3. **嵌套 Markdown 的异步时序**：`MarkdownRenderer.render` 返回 Promise；多条嵌套渲染的
   完成顺序不确定，依赖"渲染完成高度"的后续逻辑要等 Promise 并防抖。
4. **双管线差异**：Prism 与 post processor 仅阅读视图；LP 的高亮/交互行为不同；
   源码模式全部失效——功能承诺必须按视图分层。
5. **性能**：长文档多代码块 × 重引擎（WASM/网络）= 打开卡顿；需要 hash 缓存、占位 +
   异步回填、必要时视口懒渲染。
6. **错误呈现**：语法错误/引擎失败不能静默空白也不能抛穿渲染管线；统一错误卡片 +
   `console.warn` 可诊断信息。
7. **安全**：`dataviewjs` 类动态执行需 iframe 沙箱隔离；外来 HTML 必须 `sanitizeHTMLToDom`；
   服务器渲染的响应不可直接 `innerHTML`。
8. **语言键冲突**：同语言多插件仲裁未文档化 [待实测]；语言名前缀化是唯一稳妥策略。
9. **导出与 Publish**：PDF 导出走阅读视图渲染（可用），但外部服务/WASM 在导出上下文的
   可用性要验证；Publish 站点需 publish.d.ts 的独立注册口。
10. **移动端**：`child_process` 不可用（D2 类需 `isDesktopOnly` 或双实现）；WASM 与大图
    渲染的性能预算更紧。

---

## 10. 兼容性考量

- **主题**：只消费 CSS 变量与 `.theme-dark/.theme-light`，不假定具体配色；`css-change` 重渲染。
- **其他插件**：语言键前缀化防抢注；post processor `sortOrder` 控制先后（默认 0，越小越先）；
  不要清理/覆盖不属于自己创建的兄弟节点。
- **官方净化**：笔记内用户 HTML 会被官方净化（帮助《HTML 内容》：`<script>` 等被剥除）——
  插件生成的 DOM 不经该净化（插件代码本身受信任），但输出应保持同等卫生水平，
  以兼容未来收紧的净化策略与导出链路。
- **导出（PDF/图片）**：阅读视图渲染链路决定导出保真；异步块未完成时导出可能截取占位态
  （本项目导图导出已处理过同类时序）。
- **Publish**：如需发布站生效，注册口在 `Publish` 类（publish.d.ts:490-497），
  与插件端逻辑可共享同一 handler。
- **popout 窗口**：多窗口下 DOM 助手/定时器要用元素属主文档的 `activeWindow/activeDocument`
  口径（本项目已有同款经验：obsidianmd/prefer-window-timers 规则）。

---

## 11. 推荐技术路径（分层）

**选型决策树**：语法能否纯前端计算？→ 能：模式 A/B；不能且需外部引擎 → 有网？服务器（C1）；
需离线且桌面限定 → 本地二进制（C2）；需跨端离线 → WASM。

- **P0（最小可用，全部 [官方] API）**
  1. `registerMarkdownCodeBlockProcessor` + 专属语言键（多个别名多次注册）；
  2. handler：`el.empty()` → 前缀容器 → 解析 → DOM/引擎注入；错误卡片兜底；
  3. 需要 cleanup 的块：`ctx.addChild(new MarkdownRenderChild(el))`；
  4. 参数约定放块体（YAML 头），不依赖信息串；
  5. 样式：前缀类 + CSS 变量 + theme 分支；`css-change` 重渲染。
- **P1（体验与性能）**
  6. 嵌套 Markdown：`MarkdownRenderer.render`（新静态 API）；
  7. 内容 hash 产物缓存 + `metadataCache.on('changed')` 局部重渲（防抖）；
  8. Prism 自定义 grammar（仅当需要源码高亮）；错误与空态的统一组件。
- **P2（进阶）**
  9. LP 深度定制：`registerEditorExtension` + CM6 widget；
  10. 编辑回写：`getSectionInfo` + `vault.process`（判空降级）；
  11. Publish / 导出适配。

---

## 12. 应用于 MindMap Studio 的建议（待确认的路径规划）

若为目标场景（在普通笔记中用 ` ```mindmap ` 代码块嵌入只读导图），建议路径：

1. **定位**：代码块 = **只读嵌入形态**（预览），不回写；编辑仍走 `.mindmap.md` 主线
   （与 §5.5 的回写能力区分开，先不做）。
2. **复用现有防腐层**：`src/engine/mindmap.ts` 是无 obsidian 依赖的纯模块，处理器内直接
   `createMindMap` 渲染进 `el`；不新起第二份引擎通道。
3. **生命周期**：`ctx.addChild` 的 RenderChild 在 `onunload` 中销毁引擎实例（对应本项目
   engine-controller 的销毁路径），防 popout/重渲染泄漏。
4. **输入语法**：块体直接复用 `.mindmap.md` 的标题/列表大纲子集（md-outline 解析可复用），
   保证两种形态语义一致。
5. **性能与边界**：节点数超阈值（可复用 PERFORMANCE_THRESHOLD 口径）时降级为"点击打开完整
   视图"的占位卡，避免长笔记多块全量渲染。
6. **阶段**：P0 阅读视图渲染 → P1 缓存与降级策略 → P2 LP widget（是否做看需求）。
7. **风险**：引擎当前假定画布容器有确定尺寸；在笔记流式布局中需 `ResizeObserver` 或
   固定高度策略，防 0 尺寸测量（与项目内导出/离屏测量的历史经验同源）。

> 按工作区规则：此节为路径规划，**未经确认不实施**。

---

## 13. 参考索引

- `obsidian-api-master/obsidian.d.ts`：4992-5001（注册口）、3984-4025（处理器与上下文）、
  4104-4115（MarkdownRenderChild）、4117-4148（MarkdownRenderer）、3872-3878（loadPrism）、
  5013-5019（编辑器扩展）、5438-5442（requestUrl）、8114-8118（css-change）、5524-5525（净化）。
- `obsidian-api-master/publish.d.ts`：490-497（Publish 端注册口）。
- `obsidian-help-master/zh/编辑与格式化/基本格式语法.md`：358-449（代码/围栏/嵌套/Prism 与编辑视图差异）。
- `obsidian-help-master/zh/编辑与格式化/高级格式语法.md`：70-109（Mermaid 核心先例）。
- `obsidian-help-master/zh/编辑与格式化/HTML 内容.md`（官方净化口径）。
- 官方开发者文档：docs.obsidian.md → Plugins/Editor/Markdown post processing（含 CSV 官方示例）。



