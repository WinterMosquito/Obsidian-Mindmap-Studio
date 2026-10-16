/**
 * 节点内联内容渲染（**方案 B 原型**）：把行内链接渲染为节点内**可点链接**。
 *
 * 背景（见 docs/markdown-mindmap-standard §3.5 与 §5 选项 1、7）：引擎节点正文是
 * SVG 文本（`data.text`），无法承载「文中内联链接」——URL 只能退化为「仅图标」、
 * 多链接只有首个可点。本模块按行内 token 重建**段序列**并生成 HTML 片段，交给
 * 引擎的 `customCreateNodeContent` 通道（`engine/mindmap.ts` 注入）：引擎把元素
 * 包进 foreignObject，并按「离屏克隆 + getBoundingClientRect」测宽。
 *
 * ## 为什么点击/悬停「零改造」
 * 锚点沿用 Obsidian MarkdownRenderer 的产物形态（`a.internal-link[data-href]` /
 * `a.external-link[href]`），而 `features/view-wikilink.ts` 早已按这套形态实现
 * 节点内锚点识别（`findAnchorInNode` → `resolveAnchorLink` → `openHyperlink`）
 * ——此前正文是 SVG 文本、锚点永不被命中，本模块只是把该路径真正激活。
 *
 * ## 职责边界
 * - 只做「节点 data → HTML 元素」；**是否接管**由引擎钩子按返回值决定：
 *   返回 null 的节点走引擎默认 SVG 文本。
 *   接管条件 = 无图 + **段序列非空**（链接 / 轻标记 / 代码 / 数学 / 纯文本）或超长
 *   ——2026-10-09 起**纯文本节点也常开接管**（原设置 `selfDrawPlainNodes` 已移除），
 *   理由与代价见 `resolveSelfDrawSource` 的判据①；
 * - 渲染源：未编辑用 `mdRaw`（含链接语法），**已编辑用 `data.text`**（mdRaw 是
 *   解析期快照，编辑后过期；判据与回写侧 rawOk 同源：text === mdDerivedText）；
 * - 渲染**只读**节点数据：不写回、不改 `data.text`。轻标记（`**粗**` 等）与两类
 *   **隐藏语法**（`%%注释%%`、`\*` 反斜杠转义）只在渲染期处理，回写原文仍由
 *   mdRaw / `data.text` 逐字保真；
 * - **块级切分**：GFM 管道表（表头行 + 分隔行成对）独立成段（`kind: 'table'`，
 *   见 `scanTableBlocks` / `buildTableElement`）——样式全内联、宽度不撑爆节点、
 *   不设高度上限；识别与单元格模型在 `domain/pipe-table`（纯逻辑）。围栏代码块与
 *   块级数学**内**的表格行不识别（保护区复用 `MARKUP_RE`，见 `protectedRanges`）；
 * - **超长文本截断展示**（> `MAX_INLINE_CONTENT_CHARS`）：只影响显示（尾部 `…` +
 *   `title` 提示），文件与 `data.text` 一字不动，双击弹窗可见/可编辑全文；
 * - 段序列是**渲染期重建**（现场 token 化）：与回写侧的 `mdSegments` 对齐表
 *   （domain/md-meta，编辑后合成**原位**写回用）是两件事，勿混用——本模块不读
 *   `mdSegments`，也不必与它同步（各自从同一份原文重建，口径由 md-outline 保证）；
 * - 样式（字号/颜色）由引擎按节点合并后传入（`NodeContentStyle`）——自绘节点跳过
 *   默认文本渲染，必须自带样式。
 *
 * ## 已知边界
 * - **含图节点不接管**（`image` 非空即返回 null）：图片由引擎图片通道渲染；
 * - 接管后引擎跳过 text/image/icon/hyperlink/tag/note/prefix/postfix 全部默认内容
 *   ——**双链文档页图标不再出现**（有意：内联锚点已承担「可点 + 目标名」语义，
 *   对齐 Obsidian 阅读视图；三类图标体系仍服务未接管的节点）；
 * - 自绘节点无 `_textData`，引擎编辑框对其静默 no-op（`isUseCustomNodeContent()`
 *   守卫）→ 编辑入口由插件兜底：双击 / 右键「编辑文本」/ F2 走
 *   `features/view-node-actions.editNodeText` → **内联编辑器**
 *   （`features/node-inline-editor`，见 K92）；弹窗（`ui/modal-text`）为备选入口；
 * - 轻标记**不跨行、嵌套一层**，覆盖 Obsidian 的行内四类 + 高亮与下划线式变体
 *   （`**粗**`/`__粗__`、`*斜*`/`_斜_`、`` `码` ``、`~~删~~`、`==高亮==`、
 *   `***粗斜***`）与官方「combine them」嵌套（`**粗 _斜_**`，见 Basic formatting
 *   syntax）；另有 `%%注释%%`（渲染期隐藏，对齐阅读视图：注释只在编辑视图可见）、
 *   反斜杠转义（`\*` → 字面 `*`，含 `\$` 数学定界符）与**数学**——行内 `$…$`
 *   与 `$$…$$`（display / 块级，**内容可跨行、可含单个 `$`**——`$$` 独占行的
 *   多行块与 `$$$x$$$` 均按此解析，对齐 Obsidian 阅读视图实测口径，见 K89；
 *   经注入的 `renderMath` 异步 MathJax 渲染，占位即字面回退）；未闭合的
 *   标记/注释按字面保留；含这些语法的节点同样被接管 → 编辑入口走弹窗（见上）；
 * - **表格**（2026-10-14）：只识别「表头行 + 分隔行」成对的 GFM 管道表；单元格内
 *   的 `\|` 还原为字面 `|`（显示口径，帮助「Vertical bars in tables」）。有意边界：
 *   单列表必须写外框管道（`| a |` + `| --- |`；裸 `---` 属 setext H2，绝不当表）；
 *   单元格内**不支持图片嵌入渲染**（`image` 非空的节点整体不接管）与表格嵌表格；
 *   数据行遇空行、或不含未转义 `|` 的行即结束（不吞后续段落）；
 * - 库内锚点的 `data-href` 是**原始 linkpath**（与 Obsidian 产物一致）；目标未解析
 *   时加 `is-unresolved` 类 + 弱化配色（解析器由调用方注入，见 InlineContentOptions
 *   ——本模块必须可在无 Obsidian 运行时打包）；带子路径的显示名口径由 view-wikilink /
 *   openHyperlink 承接，本模块不做 render-time 修正（见 AGENTS.md K12）。
 *
 * ## 模块结构（2026-10-16 拆分）
 * 本文件是**对外 barrel**（调用方 `import ... from './node-inline-content'` 不变）：
 * - `node-inline-tokenize`：段序列切分 / 缓存 / 接管判定 / 截断 / 预览（纯逻辑，无 DOM）
 * - `node-inline-html`    ：段序列 → HTML + 内联样式常量 + 锚点契约（DOM 装配）
 */
export {
	buildInlineNodeContent,
	NODE_INLINE_CONTENT_CLASS,
	CODE_BLOCK_CLASS,
	CODE_COPY_CLASS,
} from './node-inline-html';
export {
	MAX_INLINE_CONTENT_CHARS,
	buildInlineSegments,
	segmentCacheStats,
	inlineContentPreview,
} from './node-inline-tokenize';
export type {
	InlineContentDocument,
	InlineContentOptions,
	InlineSegment,
} from './node-inline-tokenize';
