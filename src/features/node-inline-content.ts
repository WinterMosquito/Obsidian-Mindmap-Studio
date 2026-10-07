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
 *   返回 null 的节点走引擎默认 SVG 文本（纯文本节点零成本、可双击编辑）。
 *   接管条件 = 无图 + 原文非空且未超长 + **有链接段或轻标记段**（`hasRichSegments`）
 *   ——轻标记要求节点内混排字重/字形，单串 SVG 文本表达不了，故与链接同路；
 * - 渲染源：未编辑用 `mdRaw`（含链接语法），**已编辑用 `data.text`**（mdRaw 是
 *   解析期快照，编辑后过期；判据与回写侧 rawOk 同源：text === mdDerivedText）；
 * - 渲染**只读**节点数据：不写回、不改 `data.text`。轻标记（`**粗**` 等）与两类
 *   **隐藏语法**（`%%注释%%`、`\*` 反斜杠转义）只在渲染期处理，回写原文仍由
 *   mdRaw / `data.text` 逐字保真；
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
 * - 库内锚点的 `data-href` 是**原始 linkpath**（与 Obsidian 产物一致）；目标未解析
 *   时加 `is-unresolved` 类 + 弱化配色（解析器由调用方注入，见 InlineContentOptions
 *   ——本模块必须可在无 Obsidian 运行时打包）；带子路径的显示名口径由 view-wikilink /
 *   openHyperlink 承接，本模块不做 render-time 修正（见 AGENTS.md K12）。
 */
import {
	isRenderableImageTarget,
	isIndentedCodeLine,
	normalizeFenceLanguage,
	MATH_RENDERED_HOLDER_CLASS,
	CODE_BLOCK_MAX_HEIGHT_PX,
	CODE_RENDERED_CLASS,
} from '../core/constants';
import { t } from '../core/i18n';
import type { Language } from '../core/i18n';
import { isSafeAnchorHref, isSchemeUrl, isUrlLikeText } from '../domain/url';
import { tokenDisplay, tokenizeInline } from '../markdown/md-outline';
import type { InlineToken } from '../markdown/md-outline';
import type { NodeContentStyle } from '../engine/mindmap';
import { fontMeasureKey } from '../core/measure-cache';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';

/** 自绘节点内容的根类名（样式见 styles.css，测宽/断言按它定位） */
export const NODE_INLINE_CONTENT_CLASS = 'mindmap-node-inline-content';

/**
 * 自绘内容根元素上的「字体代际」标记属性名（K114）。
 *
 * 引擎把离屏测量结果按元素 `outerHTML` 缓存（vendor 模块级 `St`，**键不含字体
 * 状态**）。MathJax 字体渐进加载后内容自然宽会变而 `outerHTML` 不变 ⇒ 重测命中
 * 偏小的旧宽度 ⇒ `foreignObject` 装不下换行后的内容（`overflow:hidden` 裁掉底部；
 * 实测宽度差 4px 即触发、垂直溢出 17px）。把当前字体代际写进本属性后：字体状态
 * 一变键就变 ⇒ 必然重测；字体状态不变键不变 ⇒ 缓存照常命中（零额外测量）。
 *
 * 该属性只落在**屏上渲染 DOM** 上：不进文件（正文由 `mdRaw` 逐字回写，见
 * AGENTS.md 硬规则 4），导出 SVG 时只是一个不可见的 `data-*`，不影响样式或布局。
 * 取值来源见 `core/measure-cache.ts`。
 *
 * ⚠ **属性名刻意取短**（K114 审查）：它进每个自绘节点的 `outerHTML`，也就是引擎
 * 测量缓存键**与导出 SVG 的内容**。实测 `data-mmx-font-epoch`（19 字符）连同
 * 值共 **31 字节/节点**，占小节点 `outerHTML` 的 **7.5%**、10000 节点 ≈ 310 KB。
 * 缩到 `data-mmx-f`（10 字符）后降到 **22 字节/节点**（约 -29%）。改名前请先量
 * 一次体积——这里的取舍是「可读性 vs 每节点字节数」，而后者会随导图规模线性放大。
 */
const FONT_EPOCH_ATTR = 'data-mmx-f';

/**
 * 自绘内容的样式常量：**内联在元素上**，不依赖 styles.css 的类规则。
 *
 * 为什么必须内联：引擎导出 PNG/SVG 时只把 `joinCss()`（引擎自身 CSS）与
 * header/footer 的 cssText 注入导出 SVG（vendor `getSvgData`），**插件 styles.css
 * 不在其中**——类规则在导出图里整体失效（尺寸/换行/配色全丢），而 foreignObject
 * 的尺寸仍按屏上测宽固定，导出会溢出/错位。内联样式随 foreignObject 一起被
 * 序列化，屏上与导出**同一份样式来源**（WYSIWYG）。
 *
 * 数值口径：`maxWidth` 对齐引擎 textAutoWrapWidth（500）；`padding` 对齐主题
 * paddingX（mindmap-theme.NODE_PADDING_X = 16）+ 纵向留白 5；`lineHeight` 对齐
 * 引擎富文本节点行高 1.2。样式变化只需改此处（唯一来源）。
 */
const CONTENT_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'block',
	boxSizing: 'border-box',
	maxWidth: '500px',
	padding: '5px 16px',
	fontFamily: 'var(--font-interface, sans-serif)',
	lineHeight: '1.2',
	whiteSpace: 'pre-wrap',
	overflowWrap: 'anywhere',
	wordBreak: 'break-word',
};

/**
 * 库内锚点样式（主题变量 + 字面量兜底：导出图内没有主题变量上下文）。
 * 这就是**导图内链接的可见形态**：主题链接色的超链接字体（默认蓝色系）、
 * 无图标、无下划线（2026-09-28 用户实测口径）。
 */
const INTERNAL_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'var(--link-color, var(--text-accent, #7f6df2))',
	textDecoration: 'none',
	cursor: 'pointer',
};

/** 外部锚点样式（同上；外链配色优先于内链） */
const EXTERNAL_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'var(--link-external-color, var(--link-color, #7f6df2))',
	textDecoration: 'none',
	cursor: 'pointer',
};

/**
 * **未解析**的库内锚点样式（风格对齐 Obsidian 阅读视图：配色更弱 + 半透明，
 * 用户据此知道「这个目标还不存在」，点击会创建/继续失败）。
 *
 * `--link-unresolved-color` / `-opacity` 是 Obsidian 主题变量，字面量兜底用于
 * 导出图（导出 SVG 内没有主题变量上下文，理由同 CONTENT_STYLES）。
 */
const UNRESOLVED_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'var(--link-unresolved-color, var(--link-color, var(--text-accent, #7f6df2)))',
	opacity: 'var(--link-unresolved-opacity, 0.7)',
	textDecoration: 'none',
	cursor: 'pointer',
};

/** 轻标记语义元素样式（内联，理由同 CONTENT_STYLES） */
const MARKUP_STYLES: Record<InlineTextStyle, Partial<CSSStyleDeclaration>> = {
	bold: { fontWeight: '600' },
	boldItalic: { fontWeight: '600', fontStyle: 'italic' },
	italic: { fontStyle: 'italic' },
	code: {
		fontFamily: 'var(--font-monospace, monospace)',
		fontSize: '0.95em',
		padding: '0 3px',
		borderRadius: '3px',
		backgroundColor: 'var(--code-background, rgba(128, 128, 128, 0.12))',
	},
	strike: { textDecoration: 'line-through', opacity: '0.75' },
	highlight: {
		backgroundColor: 'var(--text-highlight-bg, rgba(255, 208, 0, 0.4))',
		borderRadius: '2px',
	},
	// 数学是容器（span 占位 → MathJax 产物替换），样式随 Obsidian 全局
	// `.mjx-container` 规则，本层不自定字体/行高（避免与 MathJax 输出打架）
	math: {},
};

/** 块级代码块容器类名（styles.css 的 hover/按钮规则与 verify:visual 断言共用） */
export const CODE_BLOCK_CLASS = 'tmm-codeblock';
/** 代码块复制按钮类名（视图层点击委托的选择器，见 features/node-codeblock.ts） */
export const CODE_COPY_CLASS = 'tmm-code-copy';

/**
 * 块级代码块（围栏段）的**结构样式**：内联在元素上（导出保真，理由同
 * CONTENT_STYLES——插件 styles.css 不进导出 SVG，类规则在导出图里整体失效）。
 *
 * 视觉口径＝对齐 Obsidian 阅读视图：等宽 + 代码底色（主题变量 + 字面量兜底，
 * 导出无色上下文时仍可读）+ 圆角 + 内边距；**语法高亮不在本表**——token 的
 * 颜色由 `platform/prism-code` 探测宿主主题后**内联到每个 token 元素**（导出
 * SVG 无 app.css，内联是唯一 WYSIWYG 口径）。滚动与上限见
 * CODE_BLOCK_PRE_STYLES / CODE_BLOCK_MAX_HEIGHT_PX。
 */
const CODE_BLOCK_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'relative',
	display: 'block',
	boxSizing: 'border-box',
	margin: '4px 0',
	padding: '10px 12px',
	borderRadius: '6px',
	backgroundColor: 'var(--code-background, rgba(128, 128, 128, 0.12))',
	color: 'var(--code-normal, var(--text-normal, inherit))',
	fontFamily: 'var(--font-monospace, monospace)',
	maxWidth: '100%',
};

/** 代码块内容区：保留换行/缩进（whiteSpace: pre），长行横向滚动、超高纵向滚动 */
const CODE_BLOCK_PRE_STYLES: Partial<CSSStyleDeclaration> = {
	margin: '0',
	whiteSpace: 'pre',
	overflowX: 'auto',
	overflowY: 'auto',
	maxHeight: `${CODE_BLOCK_MAX_HEIGHT_PX}px`,
	fontFamily: 'inherit',
	fontSize: '0.9em',
	lineHeight: '1.45',
};

/**
 * 复制按钮：外观 **100% 内联**（形状 mask / 填充 currentColor / 圆角）——
 * styles.css 类规则口径在本机曾被证实不可靠，外观不得依赖它；基色取
 * `--icon-color`（Obsidian 原生图标按钮变量）→ `--text-muted` → 默认灰兜底。
 * 屏上恒显（不写 opacity）；**导出图隐身**由 `handleExportSvg` 钩子
 * （`node-codeblock.hideCopyButtonsInExportSvg`）显式置 0。
 */
const CODE_COPY_BUTTON_STYLES: Partial<CSSStyleDeclaration> & Record<string, string> = {
	position: 'absolute',
	top: '6px',
	// 逻辑属性（K115）：Obsidian 原生用 `inset-inline-end: 0`（app.css:11857），
	// 物理 `right` 在 RTL 语言下不镜像（与本轮 styles.css 的三处方向属性同类问题）。
	insetInlineEnd: '6px',
	width: '20px',
	height: '20px',
	padding: '0',
	border: 'none',
	borderRadius: '4px',
	cursor: 'pointer',
	color: 'var(--icon-color, var(--text-muted, #666666))',
	backgroundColor: 'currentColor',
	maskImage:
		`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='14' height='14' x='8' y='8' rx='2' ry='2'/%3E%3Cpath d='M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'/%3E%3C/svg%3E")`,
	maskRepeat: 'no-repeat',
	maskPosition: 'center',
	maskSize: '14px',
};

/** 行内数学段的占位类名（MathJax 替换后保留，供主题/调试定位） */
const MATH_SEGMENT_CLASS = 'mindmap-node-inline-math';

/**
 * 构建自绘内容所需的 document 最小面（**刻意不声明为整份 `Document`**）。
 *
 * 两个理由：
 * - 本模块必须能在**无 Obsidian 运行时**的页面里跑（`scripts/verify-visual.mjs`
 *   直接打包本模块做无头验证），故不走 `doc.win.createDiv()` 一族 Obsidian DOM
 *   助手——那要求验证页复刻一整套助手垫片，垫片与官方实现的分叉本身是新的风险面；
 * - 窄接口把「依赖了 document 的哪几个工厂」钉在类型上（新增依赖必须改类型），
 *   与引擎层 `mindmap.ts` 用原生 `createElementNS` 构建 SVG 的口径一致。
 *
 * 调用方（引擎钩子）传真实 `document`（画布所在文档），结构类型自动匹配。
 */
export interface InlineContentDocument {
	createElement(tag: string): HTMLElement;
	createTextNode(text: string): Node;
}

/** 行内轻标记（渲染期识别，**不改动 `data.text`**：原文仍由 mdRaw 逐字保真） */
type InlineTextStyle =
	| 'bold'
	| 'boldItalic'
	| 'italic'
	| 'code'
	| 'strike'
	| 'highlight'
	| 'math';

/**
 * 轻标记 → 语义元素（与 Obsidian 阅读视图一致）。
 * `boldItalic`（`***粗斜***`）取 `strong` + 内联斜体：Obsidian 渲染为 strong+em
 * 嵌套，节点内只需视觉等价（字重 + 字形），单元素即可。
 * `math` 是**容器**而非轻标记：`<span>` 占位（字面 `$…$` / 单行 `$$…$$`），由
 * 注入的 `renderMath` 异步替换为 MathJax 产物（见 InlineContentOptions.renderMath
 * 与 buildMathElement）。
 */
const MARKUP_TAGS: Record<InlineTextStyle, string> = {
	bold: 'strong',
	boldItalic: 'strong',
	italic: 'em',
	code: 'code',
	strike: 'del',
	highlight: 'mark',
	math: 'span',
};

/**
 * 自绘内容的**外部解析依赖**（注入式：本模块不接触 Obsidian API，
 * 以便在无运行时环境打包/单测，见 InlineContentDocument 的说明）。
 */
export interface InlineContentOptions {
	/**
	 * 所有**含文字的纯文本节点**也接管（缺省 false = 保持原型行为）。
	 *
	 * 生产经设置 `settings.selfDrawPlainNodes` 注入（默认开）。
	 * 理由（实测）：引擎对**不自绘**节点做逐字符文本测宽
	 *（`nodeCreateContents.createTextNode` 的逐字符循环 + 每字符一次强制
	 * `getBBox`，实测 ~0.13ms/字符）——这是**打开大图的成本绝对主体**；
	 * 自绘接管后引擎在 `createNodeData` 提前 return，测量全部跳过
	 * （5000 节点实测：引擎文本 8.6s → 全自绘 1.36s，6.3 倍）。
	 * 代价：该节点失去引擎内联编辑框（双击走插件弹窗，见 `view-node-actions`）。
	 * 含图 / 空文本节点不在此列（图片走引擎图片通道、空文本无内容可绘）。
	 */
	selfDrawPlain?: boolean;
	/**
	 * 库内 linkpath 是否**已解析**到文件（缺省视为已解析）。
	 *
	 * 未解析 → 锚点带 `is-unresolved` 类 + 弱化配色：对齐 Obsidian 阅读视图
	 * 「指向尚不存在的笔记的链接显示为更弱的颜色」。解析发生在**每次构建**时
	 * （不进段序列缓存——缓存按原文内容寻址，与库状态无关）。
	 */
	isResolvedLink?: (linkpath: string) => boolean;
	/**
	 * 数学（行内 `$…$` / 单行块级 `$$…$$`）的**异步渲染**注入
	 * （生产实现 = `platform/math-jax`）。
	 *
	 * 本模块保持零 Obsidian 依赖（`loadMathJax` 不可在无运行时打包），故数学
	 * 渲染作为能力注入：`buildMathElement` 先写**字面占位**（行内 `$…$` /
	 * 块级 `$$…$$`，即回退态），实现方在 MathJax 就绪后把 `holder` 内容替换为
	 * 渲染产物。失败/未注入时占位原样保留——与「未闭合标记按字面」同一条安全口径。
	 *
	 * `display` = 段模型的 display 标记（true → `tex2chtml` 的 `{ display: true }`，
	 * 渲染为独立居中公式；实现方需原样透传给 MathJax 通道）。
	 */
	renderMath?: (
		doc: InlineContentDocument,
		tex: string,
		holder: HTMLElement,
		display: boolean,
	) => void;
	/**
	 * **产物缓存查询**（可选，P4 尺寸同步）：返回已渲染产物的**克隆**，未命中 null。
	 *
	 * 命中时 `buildMathElement` **同步**放置产物、**不走** `renderMath`——引擎随后
	 * 的离屏测量直接量到**真实宽高**，消除「按字面占位测量 → 替换后溢出」的窗口；
	 * 且重建路径不再触发异步替换（无重排循环）。注入实现见
	 * `platform/math-jax.getRenderedMathNode`（本模块不 import 该层）。
	 */
	getCachedMath?: (tex: string, display: boolean) => Node | null;
	/**
	 * **代码块 Prism 高亮**的注入（同 `renderMath` 的注入式纪律：生产实现 =
	 * `platform/prism-code`，那里是唯一 import `obsidian` 的代码高亮实现）。
	 *
	 * 本模块先写**字面代码**（信息行已剥、缩进/空行逐字），实现方在`loadPrism()`
	 * 就绪后把 holder 的子节点换成 token 元素。`lang` 已规范化为语言 id（空串 =
	 * 无语言/未登记 → 实现方**跳过**并保留字面）。
	 *
	 * `onSettled`（定稿回调）由**组合根注入时绑定**（视图层拿它触发节点尺寸重测，
	 * 同 `renderMath` 的注入形态），故本形参表里不出现——避免第二条回调通道。
	 * 本模块**不自己找节点**：引擎预测量路径会给代理对象（见 math-jax 文件头）。
	 */
	renderCode?: (
		doc: InlineContentDocument,
		code: string,
		lang: string,
		holder: HTMLElement,
	) => void;
	/**
	 * **已高亮产物查询**（可选，尺寸同步）：返回 token 子节点的克隆数组，未命中 null。
	 *
	 * 命中时 `buildCodeBlockElement` **同步**放置 token、不走 `renderCode`——引擎随后的
	 * 离屏测量直接量到真实宽高（消除「按字面测量 → 替换后溢出」的窗口），且重建
	 * 路径不再触发异步替换（无重排循环）。注入实现见
	 * `platform/prism-code.getRenderedCodeNodes`（本模块不 import 该层）。
	 */
	getCachedCode?: (code: string, lang: string) => readonly Node[] | null;
}

/** 行内段：渲染节点内联内容的最小单元（纯数据，可单测） */
export interface InlineSegment {
	kind: 'text' | 'link';
	/** 纯文本原样 / 链接段的**剥壳显示名**（`tokenDisplay` 口径，与节点文本一致） */
	text: string;
	/** 链接段跳转目标：wiki = 原始 linkpath；md 链接 / URL = 地址原文 */
	link?: string;
	/** true = 库内目标（`a.internal-link[data-href]`）；false = 外部地址（`a.external-link[href]`） */
	internal?: boolean;
	/** 文本段的轻标记（仅 kind = 'text'；无标记的纯文本省略） */
	style?: InlineTextStyle;
	/**
	 * 轻标记体的**一层嵌套**（仅 kind = 'text' 且 style 存在；官方「combine
	 * them」，如 `**粗 _斜_**`）。子段不会再有 children（深度上限见
	 * MAX_MARKUP_DEPTH）；无样式子段（纯文本/转义结果）不进 children——
	 * 那种情形下标记体的字面就是显示文本（text 字段已承载）。
	 */
	children?: InlineSegment[];
	/**
	 * 数学段的显示模式（仅 style === 'math'）：true = 单行 `$$…$$`（display /
	 * 块级，渲染为独立居中公式），缺省 = 行内 `$…$`。该标记同时决定占位形态
	 * 与 `renderMath` 注入面的 `display` 形参（见 buildMathElement）。
	 */
	display?: boolean;
	/**
	 * **围栏代码块**标记（仅 style === 'code' 且来自 fence 分支）：true = 块级
	 * 代码块（buildCodeBlockElement：底色盒 + 复制按钮 + Prism 高亮），缺省 =
	 * 行内码（`` ` `` 单反引号）。与 `display` 同款纪律：**重建段对象时必须保留**，
	 * 否则块级渲染会静默退化回行内码。
	 */
	block?: true;
	/**
	 * 围栏**信息行给出的语言 id**（仅 style === 'code' 且 block 标记）：已按
	 * `core/constants.normalizeFenceLanguage` 白名单规范化（小写；不合规为空串）。
	 *
	 * 空串有两种含义，**都不高亮**、都保留字面：① 无信息行（``` ``` ``` /缩进式
	 * 代码块）；② 信息行给了 Prism 未登记的语言码（用户可写任意语言码）。
	 * 该字段进 `<code class="language-…">`（宿主/主题选择器口径）并传给
	 * `platform/prism-code` 查语法。
	 */
	lang?: string;
}

/**
 * 可被反斜杠转义的字符类（**正则源码片段**，两处共用：下面的转义分支与
 * `ESCAPED_MARKUP_RE` 的接管判据——分开写会出现「解释了这组、却按另一组触发接管」）。
 *
 * 依据官方帮助「Basic formatting syntax / Escaping Markdown Syntax」列的
 * `\*` `\_` `\#` `` \` `` `\|` `\~`，外加本模块额外解释的**高亮定界符** `=`、
 * **数学定界符** `$`（`\$x\$` 在 Obsidian 里显示字面 `$x$`、不触发数学渲染）
 * 与反斜杠自身（CommonMark 允许转义任意 ASCII 标点，`\\` → `\`）。
 */
const ESCAPABLE_CLASS = /[*_~=`#|\\$]/.source;

/**
 * 数学定界符的匹配源（**单一来源**：MARKUP_RE 的数学备选分支与接管判据
 * `INLINE_MATH_RE` 共用同一字符串——分成两处维护会漂移，本文件注释曾自认该风险）。
 *
 * 两支形态（**顺序即优先级：双美元写在单美元之前**，更长定界符优先）：
 * - `mathBlock`：`$$…$$`（display / 块级数学）——内容**可跨行、可含单个 `$`**
 *   （开 `$$` 找**最近**的 `$$` 闭合，对齐 Obsidian 阅读视图实测口径，见 K89：
 *   `$$` 独占行的三行块 / 多行 vmatrix / `$$$x$$$`（tex = `$x`）都按此解析）；
 *   开定界符后的空格/制表/换行**不阻断**配对（B1：Obsidian 对
 *   `$$ x=1 $$` 照常渲染为公式，去掉此前的「紧跟空格按字面」守卫——用户实测
 *   该守卫让 `$$ f(x)=…` 整段不进数学通道，块内 `\\` 还被转义分支吃成单 `\`）；
 * - `math`：行内 `$…$`——内容不跨行、不含 `$`，开侧仍拒绝紧空白（价签口径）。
 * 两支同口径：闭后不得是数字（防 `$5 与 $6` 类价签误判）。转义 `\$` 由
 * ESCAPABLE_CLASS 先行消费（escaped 分支排在数学之前），故 `\$x\$` 显示
 * 字面 `$x$`、不触发数学。
 */
const MATH_SOURCE =
	'\\$\\$(?<mathBlock>[\\s\\S]*?\\S[\\s\\S]*?)\\$\\$(?!\\d)' +
	'|' +
	'\\$(?!\\s)(?<math>[^$\\n]*?\\S)\\$(?!\\d)';

/**
 * 行内语法的统一扫描正则（命名分组；备选顺序即优先级）。
 *
 * 1. `%%…%%` —— 注释（可跨行；未闭合不匹配 → 按字面显示）；
 * 2. 围栏代码块 —— 定界符 **3 个以上**的反引号**或波浪号**、**同字符同长度闭合**
 *    （CommonMark + Obsidian 帮助：两种定界符皆可，4+ 反引号可嵌套代码块）；
 *    排在行内码之前，否则 `` ```js `` 的首行会被行内码分支切碎。
 *    ⚠ **口径必须与解析层一致**（`markdown/md-outline.classifyLines` 的
 *    `^[ \t]{0,3}(`{3,}|~{3,})`）：此前本正则只认反引号，`~~~` 围栏的节点虽然
 *    被正确解析成"围栏整体"，渲染时却退化成普通文本（解析/渲染两侧口径裂缝）；
 * 3. 行内代码 —— 定界符为 1..n 个反引号、**同长度闭合**（CommonMark 语义：
 *    `` ``a`b`` `` 允许内容含更短的反引号串）；内容按字面，内部不解释标记/转义；
 * 4. 转义 `\<可转义字符>` —— 消费反斜杠、按字面显示该字符（字符集见 ESCAPABLE_CLASS）；
 * 5. 数学（`MATH_SOURCE`，**双美元写在单美元之前**——更长定界符优先）：
 *    5a. `$$…$$`（display / 块级，`mathBlock` 组；内容可跨行、可含单个 `$`——
 *    开 `$$` 找最近 `$$` 闭合，对齐 Obsidian 实测口径）；
 *    5b. 行内 `$…$`（`math` 组）。两支同口径：闭 `$` 前
 *    不得是空白、后不得是数字（Obsidian 数学扩展口径，防止 `$5 与 $6` 价签误判）；
 *    排在标记类之前，`$a*b*c$` 内的 `*` 不会被当斜体；
 * 6. `***粗斜***` / `___粗斜___`（组合字形，单独一支）；
 * 7. `**粗**` / `__粗__`、`~~删~~`、`==高亮==`、`*斜*` / `_斜_`。
 *
 * 两条与 CommonMark 对齐的取舍：
 * - 粗/斜/删/高亮要求定界符内首尾**非空白**（flanking 规则的最简形态）：
 *   `a * b * c` 不是斜体，按字面保留；行内代码不设此限；
 * - `_` 系列额外要求内外侧不是字母/数字（`snake_case` 里的 `_x_` 不误判为斜体）。
 *
 * 正则整体带 `u` 标志（`\p{L}` 需要）；标记体一律 `[^…\n]` 不跨行（见模块头边界）。
 */
const MARKUP_RE = new RegExp(
	[
		'(?<comment>%%[\\s\\S]*?%%)',
		'(?<fence>(?:`{3,}|~{3,}))(?<fenceCode>[\\s\\S]*?)\\k<fence>',
		'(?<ticks>`+)(?<code>(?:[^`\\n]|`(?!\\k<ticks>))+?)\\k<ticks>',
		'\\\\(?<escaped>' + ESCAPABLE_CLASS + ')',
		MATH_SOURCE,
		'\\*\\*\\*(?<boldItal>\\S(?:[^*\\n]*\\S)?)\\*\\*\\*',
		'(?<![\\p{L}\\p{N}])___(?<boldItalU>\\S(?:[^_\\n]*\\S)?)___(?![\\p{L}\\p{N}])',
		'\\*\\*(?<bold>\\S(?:[^*\\n]*\\S)?)\\*\\*',
		'(?<![\\p{L}\\p{N}])__(?<boldU>\\S(?:[^_\\n]*\\S)?)__(?![\\p{L}\\p{N}])',
		'~~(?<strike>\\S(?:[^~\\n]*\\S)?)~~',
		'==(?<mark>\\S(?:[^=\\n]*\\S)?)==',
		'\\*(?<ital>\\S(?:[^*\\n]*\\S)?)\\*',
		'(?<![\\p{L}\\p{N}])_(?<italU>\\S(?:[^_\\n]*\\S)?)_(?![\\p{L}\\p{N}])',
	].join('|'),
	'gu',
);

/**
 * 轻标记的**嵌套深度上限**：深度 0 = 顶层、1 = 标记体内再套一层标记
 * （官方「combine them」：`**粗 _斜_**`）。再深的嵌套（`**_==x==_**` 的最内层）
 * 按字面显示——渲染收益趋零，扫描/建树成本与回归面线性涨。
 */
const MAX_MARKUP_DEPTH = 2;

/**
 * 数学的**接管判据**：行内 `$…$` 与单行块级 `$$…$$` 都命中。直接由
 * `MATH_SOURCE` 构造，与 MARKUP_RE 的数学分支**同一来源**（分成两处写会漂移）。
 */
const INLINE_MATH_RE = new RegExp(MATH_SOURCE);

/**
 * 轻标记/隐藏语法的**单遍扫描**（顺序即优先级，见 MARKUP_RE）。
 *
 * 覆盖 Obsidian 帮助「Basic formatting syntax」的行内格式：
 * - `**粗**` / `__粗__`、`*斜*` / `_斜_`、`` `码` ``、`~~删~~`、`==高亮==`、
 *   `***粗斜***`；
 * - `%%注释%%` → **渲染期整段隐藏**（阅读视图口径：注释只在编辑视图可见）；
 * - 反斜杠转义（官方清单 `\*` `\_` `\#` `` \` `` `\|` `\~`，另有 `\=` 与本模块
 *   解释的标记定界符；`\\` → `\`）→ 消费反斜杠、按字面显示该字符
 *   （`\*a\*` 在 Obsidian 里显示 `*a*`，此前本模块会误渲染成斜体）。
 *
 * 边界（有意，与阅读视图的差异）：**不跨行、嵌套至多一层**（见 MAX_MARKUP_DEPTH，
 * `**_==x==_**` 的最内层按字面）；未闭合的标记/注释按字面保留。解析/回写层始终把
 * 标记当普通文本（无损往返），此处只做显示层处理。
 */
function splitMarkedText(text: string, depth = 0): InlineSegment[] {
	const out: InlineSegment[] = [];
	/**
	 * 无样式片段入队（**与上一段合并**）：「转义 / 隐藏注释」会在同一段文本里
	 * 反复切断扫描（`\*a\*` → `*`、`a`、`*`），逐片入队会产出多个相邻文本节点。
	 */
	const pushPlain = (value: string): void => {
		// prose 连续空格归一在此落地（代码/数学段不走本函数，见各分支）
		const text = normalizeSpaces(value);
		const last = out[out.length - 1];
		if (last && last.style === undefined) {
			out[out.length - 1] = { kind: 'text', text: last.text + text };
			return;
		}
		out.push({ kind: 'text', text });
	};
	let cursor = 0;
	// **按位置驱动**（每轮把 lastIndex 显式设为 cursor）：MARKUP_RE 是模块级共享
	// 正则，嵌套扫描的**子调用**会重置它的 lastIndex——若父循环依赖 lastIndex 续扫，
	// 子调用返回后父循环会从 0 重扫并再次命中同一标记 → 死循环 + 段数组无限增长
	// （**a** 在引入嵌套后即触发，见 probe 复现）。
	let match: RegExpExecArray | null;
	for (;;) {
		MARKUP_RE.lastIndex = cursor;
		match = MARKUP_RE.exec(text);
		if (match === null) {
			break;
		}
		// 防御空匹配导致的死循环（所有分支都要求至少一个字符，理论上不可达）
		if (match[0].length === 0) {
			cursor++;
			continue;
		}
		if (match.index > cursor) {
			pushPlain(text.slice(cursor, match.index));
		}
		const groups = match.groups ?? {};
		if (groups.comment !== undefined) {
			// 注释：整段不进显示（连定界符一起吞掉）
		} else if (groups.fenceCode !== undefined) {
			// 多行围栏代码块（``` *或* ~~~ 起止、3 个以上、同长度闭合，可跨行）：
			// **块级代码段**（block 标记 → buildCodeBlockElement：底色盒 + 复制按钮
			// + Prism 高亮）。首行信息行（```js）在段内剥掉——它不进显示与复制
			//（splitFenceInfo），但**语言码要留下来**（`lang` 段字段 → language-xxx
			// 类 → Prism 语法查找），否则高亮无从下手。
			// 代码原文（缩进/空行）逐字保留（归一化不作用于本分支）。
			// 同时使围栏内的 `$$` 被本分支先行消费、不被块级数学误配对（K89）
			const { lang, code } = splitFenceInfo(groups.fenceCode);
			const language = normalizeFenceLanguage(lang);
			out.push({
				kind: 'text',
				text: code,
				style: 'code',
				block: true,
				...(language ? { lang: language } : {}),
			});
		} else if (groups.code !== undefined) {
			// 行内码：逐字保留（连续空格是内容；阅读视图同为字面）
			out.push({ kind: 'text', text: groups.code, style: 'code' });
		} else if (groups.escaped !== undefined) {
			// 转义：消费反斜杠，按字面显示该字符（无样式）
			pushPlain(groups.escaped);
		} else if (groups.mathBlock !== undefined) {
			// 单行 `$$…$$`（display / 块级）：定界符不进显示文本；display 标记
			// 决定占位形态（`$$…$$`）与渲染通道（tex2chtml 的 display 选项）
			out.push({
				kind: 'text',
				text: groups.mathBlock,
				style: 'math',
				display: true,
			});
		} else if (groups.math !== undefined) {
			// 行内数学：定界符不进显示文本（buildMathElement 的回退态自行补回）
			out.push({ kind: 'text', text: groups.math, style: 'math' });
		} else {
			const style: InlineTextStyle =
				groups.boldItal !== undefined || groups.boldItalU !== undefined
					? 'boldItalic'
					: groups.bold !== undefined || groups.boldU !== undefined
						? 'bold'
						: groups.strike !== undefined
							? 'strike'
							: groups.mark !== undefined
								? 'highlight'
								: 'italic';
			// 标记体是 prose：先归一（children 在归一后的文本上递归，与旧口径
			// 一致；体**内**的代码/数学子段仍各自保原文）
			const body = normalizeSpaces(
				groups.boldItal ??
					groups.boldItalU ??
					groups.bold ??
					groups.boldU ??
					groups.strike ??
					groups.mark ??
					groups.ital ??
					groups.italU ??
					'',
			);
			// 官方「combine them」：标记体内再扫一层（代码内不进来——code 分支
			// 先行；转义/注释在子层照常生效）。子层全部无样式时不挂 children
			// ——那种情形标记体的字面就是显示文本，挂了徒增遍历。
			const children =
				depth + 1 < MAX_MARKUP_DEPTH ? splitMarkedText(body, depth + 1) : undefined;
			const nested =
				children !== undefined &&
				children.some((child) => child.style !== undefined);
			out.push({
				kind: 'text',
				text: body,
				style,
				...(nested && children ? { children } : {}),
			});
		}
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) {
		pushPlain(text.slice(cursor));
	}
	return out;
}

/**
 * 需要**消费反斜杠**的转义序列（字符集见 ESCAPABLE_CLASS）——接管判据之一：
 * 引擎默认路径会把反斜杠一起显示（`\*a\*` 原样），只有自绘能消费它。
 * 由 ESCAPABLE_CLASS 拼出，与该分支的匹配集**必须是同一组**。
 */
const ESCAPED_MARKUP_RE = new RegExp('\\\\' + ESCAPABLE_CLASS);

/** 行内注释（`%%…%%`，可跨行；未闭合不算） */
const INLINE_COMMENT_RE = /%%[\s\S]*?%%/;

/**
 * prose 的连续空格归一（HTML 折叠空白语义，原文由 mdRaw 保真）。
 *
 * **只作用于散文文本**：代码块 / 数学段的空白是内容（缩进、对齐），必须原文
 * 保留——故本归一化**下沉到 splitMarkedText 的各分支**（空白 prose 与标记体），
 * 而不是切分前对全文预归一（那是 旧序，会把代码缩进压扁）。
 */
function normalizeSpaces(value: string): string {
	return value.replace(/[ \t]{2,}/g, ' ');
}

/**
 * 围栏内容 → `{ lang, code }`：剥离首行**信息行**（```` ```js ```` 的 `js`）。
 *
 * CommonMark 口径：开围栏所在行的行终止符不属于内容——即有 `\n` 时内容一律从
 * 其**之后**开始；首个 `\n` 之前的内容是信息行（无 lang 时为空串）。两种形态
 * （**不改 fence 正则**，零回归面）：
 * - 含 `\n` → `lang = 首行 trim`（容忍 ```` ``` js ```` 写法）、`code = 余下原文`
 *   （缩进/空行原样；首尾空行由 trimEdges 裁）；
 * - 不含 `\n`（单行 ```` ```code``` ````）→ 整体即代码、无 lang（既有行为）。
 */
function splitFenceInfo(fenceCode: string): { lang: string; code: string } {
	const nl = fenceCode.indexOf('\n');
	if (nl < 0) {
		return { lang: '', code: fenceCode };
	}
	return {
		lang: fenceCode.slice(0, nl).trim(),
		code: fenceCode.slice(nl + 1),
	};
}

/**
 * 缩进式代码块的**显示文本**；不是缩进代码块则返回 null。
 *
 * 官方帮助「Basic formatting syntax §Code blocks」把Tab / 4 空格缩进块与围栏块
 * 并列为代码块，但此前只有围栏块有视觉通道：缩进块在显示层被`trimEdges` /
 * 派生 `text`剥掉前导缩进，渲染成一段普通文字（往返仍逐字正确，见
 * `docs/markdown-mindmap-standard.md` 的缩进代码块条目）。
 *
 * 判据（CommonMark）：**首个非空行起**每行都是 `constants.isIndentedCodeLine`
 * （≥4 空格或制表符）或空行，且至少有一行缩进。「首行必须缩进」对应
 * 「缩进代码块不能中断段落」——否则正文里恰好每行都缩进的段落会被误判成代码。
 *
 * 显示文本按 CommonMark **剥离每行 4 空格 / 1 个制表符**（与阅读视图一致）：
 * 只影响显示，回写仍走 `mdRaw`（AGENTS.md 硬规则 4）。
 *
 * 已知边界（**实机取证，勿当 bug 修**）：判据是**节点级**的——解析层
 * `md-outline.classifyLines` **忽略围栏外空行**，故文档里连续的段落/围栏会被合并成
 * **同一个 plain 节点**（实测：一个「标题 + 三段代码块」的文档 = 标题节点 + 一个
 * 含全部内容的 plain 子节点）。于是「正文里夹一段缩进代码」的节点**不会**被整段判为
 * 代码块，仍走普通文本渲染。要在这种情况下也支持，就得在渲染层重跑一遍围栏状态机
 * 来保护围栏内缩进行 —— 那是第二份判定（AGENTS.md 硬规则 5），代价与漂移风险都高于
 * 收益，故**明确不做**。实际覆盖到的是：**整个节点就是一段缩进代码**（把代码块粘进
 * 一个空节点、或整个文件就是一段代码），这正是缩进式代码块在本插件树模型里的常见形态。
 */
function indentedCodeText(raw: string): string | null {
	const lines = raw.split('\n');
	let seenIndented = false;
	for (const line of lines) {
		if (line.trim() === '') {
			continue;
		}
		if (!isIndentedCodeLine(line)) {
			// 首个非空行不缩进 → 段落（可能后续行缩进，但那是段落内的续行）
			return null;
		}
		seenIndented = true;
	}
	if (!seenIndented) {
		return null;
	}
	// 首尾**换行**裁掉（与围栏块 `trimEdges` 的代码块分支同口径：只裁换行、
	// 不裁行内空白——缩进是代码内容）。尾随空行来自原末尾的空行 split 产物。
	return lines
		.map(stripIndentedCodePrefix)
		.join('\n')
		.replace(/^\n+/, '')
		.replace(/\n+$/, '');
}

/** 剥掉一行缩进代码的 4 空格 / 1 制表符前缀（CommonMark 缩进代码块规则） */
function stripIndentedCodePrefix(line: string): string {
	if (line.startsWith('\t')) {
		return line.slice(1);
	}
	return line.startsWith('    ') ? line.slice(4) : line;
}

/**
 * 段序列缓存条目：段序列 + **接管判定**的惰性结果。
 *
 * 为什么把判定一并缓存：`resolveSelfDrawSource`（引擎自绘钩子每次节点内容
 * 重建都会走）需要「该节点是否被自绘接管」的布尔，而 `hasRichSegments` /
 * `needsHiddenSyntax` 是**只依赖原文**的纯函数——不缓存就等于每次重建都重扫
 * 3 个正则（转义 / 行内数学 / 注释）并遍历一遍段数组。
 */
interface SegmentCacheEntry {
	segments: readonly InlineSegment[];
	/** 有链接段或轻标记段（可点 / 混合字形，SVG 单串文本表达不了） */
	rich: boolean;
	/** 含渲染期必须消费的隐藏语法（`\*` 转义 / `%%注释%%` / 行内数学 `$…$`） */
	hidden: boolean;
}

/**
 * 段序列缓存（**按原文内容寻址**，与节点/引擎实例无关）。
 *
 * 引擎在节点**内容重建**时会为每个自绘节点调用构建器（编辑提交 / 拖宽收尾 /
 * 性能模式强制加载等；纯拖动与缩放**不**重建内容——K58 的 perf 探针实测空
 * render 构建器调用 0 次），而「原文 → 段序列 + 接管判定」是纯函数：同一行
 * 反复 tokenize + 轻标记切分纯属浪费。
 * 内容寻址天然避免跨导图实例串味（同一 uid 在不同文件里也不会命中彼此的段）。
 *
 * 淘汰策略是 **LRU**（命中即提升；超限淘汰最旧的一条，而非整表清空）：
 * Map 迭代顺序即插入顺序，最近命中的键被删后重插即回到队尾。
 * 为什么不能整表清空：编辑弹窗的**实时预览**（`inlineContentPreview`）每个
 * 键入都产生一个新键（"a"、"ab"、"abc"…），几十次敲键就能把整张表连同
 * 正在渲染的热点节点一起刷掉——此后每次渲染全部重 tokenize（缓存命中率归零）。
 * 上限用于防御极端输入（大文件里大量互不相同的长行）导致无界增长。
 */
const segmentCache = new Map<string, SegmentCacheEntry>();
/** 条目数上限（防无界增长；与字符预算双重约束） */
const SEGMENT_CACHE_MAX = 512;
/**
 * 总字符预算（2026-10-02）：条目数上限对「长行键」失效——512 条 × 20k 字符
 * 最坏 ≈20MB（UTF-16）常驻，而数千节点的**顺序全量重建**让 LRU 命中率≈0
 * （--perf 实测 512/512 满仓）。加字符维度后：短行仍按条目数正常复用，
 * 长行由总预算封顶。
 */
const SEGMENT_CACHE_MAX_CHARS = 1_000_000;
/**
 * 单条缓存上限（字符）：超过不缓存——超长行的复用场景（同一行反复重建）
 * 罕见，且一条就会挤掉大量短行热点。
 */
const SEGMENT_CACHE_SINGLE_MAX_CHARS = 32_000;
/** 当前缓存键的字符总量（与 segmentCache 同步增量维护） */
let segmentCacheChars = 0;

/**
 * 取（或构建）该原文的缓存条目：段序列与接管判定**一次算出、共享同一缓存**。
 * `buildInlineSegments`（段序列）与 `resolveSelfDrawSource`（接管判定）都经此入口。
 */
function segmentEntryOf(raw: string): SegmentCacheEntry {
	const cached = segmentCache.get(raw);
	if (cached) {
		// LRU 提升：删后重插 → 回到队尾（Map 迭代顺序 = 插入顺序）
		segmentCache.delete(raw);
		segmentCache.set(raw, cached);
		return cached;
	}
	const segments = buildInlineSegmentsUncached(raw);
	const entry: SegmentCacheEntry = {
		segments,
		rich: hasRichSegments(segments),
		hidden: needsHiddenSyntax(raw, segments),
	};
	// 超长单条不入缓存（预算守卫：一条就会挤掉大量短行热点，且复用场景罕见）
	if (raw.length <= SEGMENT_CACHE_SINGLE_MAX_CHARS) {
		// 淘汰最旧的一条（而非整表清空）：热点条目已由上方命中路径持续刷新到队尾，
		// 被淘汰的只会是长期未命中的键。双重约束：条目数 + 字符总预算。
		while (
			segmentCache.size >= SEGMENT_CACHE_MAX ||
			segmentCacheChars + raw.length > SEGMENT_CACHE_MAX_CHARS
		) {
			// `IteratorResult` 已把 `.next().value` 定到 `string | undefined`，无需断言。
			const oldest = segmentCache.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			segmentCache.delete(oldest);
			segmentCacheChars -= oldest.length;
		}
		segmentCache.set(raw, entry);
		segmentCacheChars += raw.length;
	}
	return entry;
}

/**
 * ## 为什么长文本**绝不能**回落引擎默认 SVG 文本（2026-09-15 实测修订）
 * 引擎 `createTextNode` 的换行是**逐字符**迭代：每加一个字就重新拼接整行
 * （`[...line, ch].join('')`）并**重新测量一次**——单行开销随字数**二次增长**。
 * 无头 Chrome 同机实测：20k 字单行节点走引擎 ≈ **+2.8s**（整轮 1.1s → 3.9s），
 * 同内容走自绘 HTML ≈ **0**（浏览器原生排版，O(n)）。用户实测反馈的「白屏 /
 * 卡死后关闭」正是这条路径（原实现的「超长回落」把最长的行送进最贵的通道）。
 *
 * 故本模块改为：**长文本一并接管 + 截断展示**——超出部分不渲染，但文件与
 * `data.text` 一字不动（双击弹窗看/改全文）。渲染成本由此与文本长度**脱钩**
 * （每节点上界 = 本常量）。截断只影响显示：写回仍走 mdRaw / `data.text`。
 */
export const MAX_INLINE_CONTENT_CHARS = 2000;

/**
 * 行内原文 → 段序列（纯函数，带内容寻址缓存）。
 *
 * 与解析侧同一套 token 口径（`tokenizeInline` + `tokenDisplay`），故链接显示名不会
 * 与节点文本漂移；连续空格折叠为单个（HTML 折叠空白语义，原文由 `mdRaw` 保真），
 * 首尾空白段剔除（plain 行的 `mdRaw` 含前导缩进与行尾空格，不进节点显示）。
 *
 * 返回值**只读**（缓存共享同一数组）：调用方不得就地修改。
 */
export function buildInlineSegments(raw: string): readonly InlineSegment[] {
	return segmentEntryOf(raw).segments;
}

/**
 * 段序列缓存现状（条目数 + 字符总量双维度）。
 *
 * 存在的理由：缓存是**长会话内存**的一个观测点——编辑弹窗的实时预览会以
 * 「每个键入一个新键」冲刷它（见上方 LRU 注释），结构不变式是
 * 「条目数 ≤ `SEGMENT_CACHE_MAX` 且键字符总量 ≤ `SEGMENT_CACHE_MAX_CHARS`」。
 * 该不变式原本只能靠代码审查，现由单测（`tests/node-inline-content.test.ts`
 * 的「规模封顶」「字符预算封顶」例）与 `verify:visual --perf` 的负载块在
 * **真实渲染路径**上直接读。生产代码不读它。
 */
export function segmentCacheStats(): {
	size: number;
	max: number;
	chars: number;
	maxChars: number;
} {
	return {
		size: segmentCache.size,
		max: SEGMENT_CACHE_MAX,
		chars: segmentCacheChars,
		maxChars: SEGMENT_CACHE_MAX_CHARS,
	};
}

/** 段序列构建本体（无缓存；缓存包装见 buildInlineSegments） */
function buildInlineSegmentsUncached(raw: string): InlineSegment[] {
	// 缩进式代码块（CommonMark：≥4 空格 / 制表符起首）：整节点都是代码时走
	// **与围栏块同一个**块级通道（buildCodeBlockElement：底色盒 + 复制按钮 +
	// Prism 高亮——无语言码，故不高亮）。**必须在 token 化与 trimEdges 之前
	// 判定**：那两步都会剥掉前导缩进（显示文本不带缩进），而缩进恰是代码内容。
	const indented = indentedCodeText(raw);
	if (indented !== null) {
		return [{ kind: 'text', text: indented, style: 'code', block: true }];
	}
	const segments: InlineSegment[] = [];
	let cursor = 0;
	const pushText = (text: string): void => {
		if (!text) {
			return;
		}
		// 轻标记在文本段内部切分（标记符不进显示文本，原文由 mdRaw 保真）。
		// ⚠ 这里**不做**连续空格归一：归一化已下沉到 splitMarkedText 的 prose
		// 分支——预归一化会波及其中的代码块/数学段（缩进被压扁，已修）
		for (const piece of splitMarkedText(text)) {
			segments.push({
				kind: 'text',
				text: piece.text,
				...(piece.style ? { style: piece.style } : {}),
				// display/block 只在对应段型上出现（重建段对象时必须保留，
				// 否则 buildMathElement 拿到"行内形态"、块级代码退化为行内码）
				...(piece.display ? { display: true } : {}),
									...(piece.block ? { block: true } : {}),
									...(piece.lang ? { lang: piece.lang } : {}),
									...(piece.children ? { children: piece.children } : {}),
			});
		}
	};
	for (const tok of tokenizeInline(raw)) {
		pushText(raw.slice(cursor, tok.start));
		cursor = tok.end;
		const segment = linkSegmentOf(tok);
		if (segment) {
			segments.push(segment);
		} else {
			// 图片 token：图片本体走引擎图片通道，段序列只保留剥壳显示名
			pushText(tokenDisplay(tok));
		}
	}
	pushText(raw.slice(cursor));
	return trimEdges(segments);
}

/** 链接类 token → 链接段；图片/无链接 token 返回 null */
function linkSegmentOf(tok: InlineToken): InlineSegment | null {
	if (tok.kind === 'wiki' || isLinkEmbed(tok)) {
		// 双链（含指向附件）与**非图片**嵌入（文档 `![[笔记]]` / 附件 `![[报告.pdf]]`）
		// 都是库内链接：target 是**原始 linkpath**（无 [[ ]] 包裹），交给
		// view-wikilink 的 resolveAnchorLink 包回 wikilink 形态。
		// 图片嵌入不进这里（含图节点整体不接管；非首图按显示名占位为文本）
		return {
			kind: 'link',
			text: tokenDisplay(tok),
			link: tok.target,
			internal: true,
		};
	}
	if (tok.kind === 'mdLink') {
		return {
			kind: 'link',
			// 显示名：常规走 tokenDisplay（label 优先，否则目标末段）；label 本身是
			// URL 的形态（`[https://…](https://…)`，复制粘贴常见）显示整个地址
			// ——它在节点文本里本是 icon-only（不显示），方案 B 下还原为可点文本
			text: isUrlLikeText(tok.label) ? tok.label : tokenDisplay(tok),
			link: tok.target,
			// scheme:// 形态（http/obsidian/file/自定义协议）→ 外部锚点；其余按库内
			// 路径处理——与 openHyperlink 的路由口径一致（无 scheme 即走库内解析）
			internal: !isSchemeUrl(tok.target),
		};
	}
	if (tok.kind === 'autolink' || tok.kind === 'bareUrl') {
		// 尖括号 URL / 裸 URL：一律外部地址，显示名即 URL 本体。注意**不能**用
		// tokenDisplay——它对裸 URL 走「目标末段」分支（`https://a.com/x` → `x`），
		// 那是 icon-only 时代「URL 不进节点文本」的剥离口径，不是可读显示名；
		// 还原为可点文本正是方案 B 的目标（长 URL 由 CSS max-width 折行兜底）
		return {
			kind: 'link',
			text: tok.target,
			link: tok.target,
			internal: false,
		};
	}
	return null;
}

/**
 * 嵌入 token 是否为**链接**（而非图片）：`![[…]]` 的目标不是可渲染图片——
 * 文档嵌入 `![[笔记]]` 与附件嵌入 `![[报告.pdf]]` 都按链接处理（与解析侧
 * 「文档/附件嵌入走链接通道、图片嵌入走 image 字段」同口径）。
 */
function isLinkEmbed(tok: InlineToken): boolean {
	return tok.kind === 'wikiImg' && !isRenderableImageTarget(tok.target);
}

/**
 * 剔除首尾空白段（并 trim 首尾文本段的边缘空白），不修改中间内容。
 *
 * **代码块段（block）例外**：只裁边缘**空行**（`\n`），不裁空格/制表——首行前
 * 的缩进与行内对齐是代码内容（```` ```js ```` 块首行常以缩进开头；`^\s+` 会
 * 把 4 空格缩进连同换行一起吞掉，已修）。
 */
function trimEdges(segments: InlineSegment[]): InlineSegment[] {
	const leadingPattern = (segment: InlineSegment): RegExp =>
		segment.style === 'code' && segment.block === true ? /^\n+/ : /^\s+/;
	const trailingPattern = (segment: InlineSegment): RegExp =>
		segment.style === 'code' && segment.block === true ? /\n+$/ : /\s+$/;
	while (segments.length > 0) {
		const first = segments[0]!;
		if (first.kind !== 'text') {
			break;
		}
		const trimmed = first.text.replace(leadingPattern(first), '');
		if (trimmed) {
			segments[0] = { ...first, text: trimmed };
			break;
		}
		segments.shift();
	}
	while (segments.length > 0) {
		const last = segments[segments.length - 1]!;
		if (last.kind !== 'text') {
			break;
		}
		const trimmed = last.text.replace(trailingPattern(last), '');
		if (trimmed) {
			segments[segments.length - 1] = { ...last, text: trimmed };
			break;
		}
		segments.pop();
	}
	return segments;
}

/**
 * 节点内联内容渲染器（引擎 `customCreateNodeContent` 钩子，返回 null 即不接管）。
 *
 * `doc` 必须是**画布所在 document**（popout 场景由引擎层传 `el.ownerDocument`）；
 * `lang` 用于截断提示文案（省略时按 zh，与插件默认语言一致）；
 * `options` 注入外部解析（未解析链接弱化，见 InlineContentOptions）。
 */
export function buildInlineNodeContent(
	node: MindMapNode,
	doc: InlineContentDocument,
	style: NodeContentStyle = {},
	lang: Language = 'zh',
	options: InlineContentOptions = {},
): HTMLElement | null {
	const source = resolveSelfDrawSource(node, options.selfDrawPlain === true);
	if (!source) {
		return null;
	}
	const { segments, overlong } = source;
	return buildContentElement(
		doc,
		overlong ? clampSegments(segments, MAX_INLINE_CONTENT_CHARS) : segments,
		style,
		{
			truncationTitle: overlong ? t(lang, 'nodeTextTruncated') : null,
			// 用户拖过左右边框时按引擎写入的宽度渲染（未拖过 → null → 500 折行上限）
			explicitWidth: customTextWidthOf(node),
			options,
			lang,
		},
	);
}

/** 自绘接管的判定输入（`buildInlineNodeContent` 与 `shouldSelfDrawNode` 共用） */
interface SelfDrawSource {
	/** 渲染源原文（未编辑 → mdRaw；已编辑 → text） */
	raw: string;
	segments: readonly InlineSegment[];
	/** 超过展示上限（必须接管，见 MAX_INLINE_CONTENT_CHARS） */
	overlong: boolean;
}

/**
 * 解析节点的**接管判定与渲染源**：返回 null = 不接管（走引擎默认渲染）。
 *
 * 单一来源：`buildInlineNodeContent`（真的建元素）与 `shouldSelfDrawNode`
 * （引擎侧「宽度手柄只在能生效的节点上显示」的门禁）必须同一判据——两处各写
 * 一份判定迟早漂移（手柄留在不接管的节点上＝死手柄，用户实测 2026-09-16）。
 */
function resolveSelfDrawSource(
	node: MindMapNode,
	selfDrawPlain = false,
): SelfDrawSource | null {
	const data = node.getData?.() as Record<string, unknown> | null | undefined;
	if (!data) {
		return null;
	}
	// 含图节点不接管：图片由引擎图片通道渲染，自绘会丢图
	if (readString(data, 'image')) {
		return null;
	}
	// 渲染源：未编辑 → mdRaw（含链接语法）；**已编辑 → data.text**——mdRaw 是解析期
	// 快照，用户编辑（引擎编辑框或插件弹窗）后已过期，再按它渲染会显示旧内容
	//（与回写侧 rawOk 的「未编辑」判据同源：text === mdDerivedText）
	const text = readString(data, 'text');
	const edited = text !== readString(data, 'mdDerivedText');
	const raw = edited ? text : readString(data, 'mdRaw') || text;
	if (!raw) {
		return null;
	}
	// 注意：**没有**「超长就不接管」这条——超长必须接管（见 MAX_INLINE_CONTENT_CHARS：
	// 引擎逐字符换行是二次复杂度，长行交给它正是白屏/卡死的成因）
	const entry = segmentEntryOf(raw);
	const overlong = raw.length > MAX_INLINE_CONTENT_CHARS;
	// 接管判据（满足其一）：
	// ① 有链接/轻标记段（可点 / 混合字形，SVG 单串文本表达不了）；
	// ② 文本超过展示上限（**绝不能**交给引擎：其换行是逐字符二次复杂度，见
	//    MAX_INLINE_CONTENT_CHARS 的实测）；
	// ③ 有**隐藏/异步语法**需消费（`\*` 转义、`%%注释%%`、数学 `$…$` / `$$…$$`）——
	//    它们的正确显示同样只有自绘能做到（数学要挂 MathJax 产物）。注释仅在
	//    **去掉后仍有可见内容**时才算（否则会渲染出空节点，比原样显示注释更糟，
	//    故让引擎按字面显示）；数学以字面占位、异步替换，无该风险。
	// ④ `selfDrawPlain` 开启时**任意含文字的纯文本节点**也接管：
	//    引擎对不自绘节点做逐字符文本测宽（~0.13ms/字符），是打开大图的成本
	//    绝对主体；接管后引擎在 createNodeData 提前 return、测量全跳过
	//    （5000 节点实测 8.6s → 1.36s）。代价见 InlineContentOptions.selfDrawPlain。
	//    边界：**渲染后必须仍有可见内容**（段序列非空）——纯空白 / 整行只有
	//    注释的节点不接管（否则渲染出空节点，比让引擎按字面显示更糟）。
	// 都不满足的纯短文本走引擎 SVG 文本（测宽廉价、可双击**原位**编辑）。
	// 判定结果（rich/hidden）与段序列同源、随条目缓存——纯函数不重复扫描。
	const plain = selfDrawPlain && entry.segments.length > 0;
	if (!overlong && !entry.rich && !entry.hidden && !plain) {
		return null;
	}
	return { raw, segments: entry.segments, overlong };
}

// 注：曾导出 `shouldSelfDrawNode`（静态判定「将被自绘接管」）供
// 宽度手柄门禁消费；`selfDrawPlain` 引入后判定依赖**调用期选项**，且门禁改用
// 更直接的运行时事实（`engine/mindmap.isCustomNodeContent` = 节点是否真的有
// 自绘内容），该静态判定不再有生产消费方，已删除。自绘/不接管的判据单一来源
// 仍是 `resolveSelfDrawSource`（本文件内部）。

/**
 * 是否存在**渲染期必须消费**的隐藏语法（转义 / 注释）。
 *
 * 转义：`\*a\*` 在 Obsidian 里显示 `*a*`——只有自绘能消费反斜杠（引擎会把
 * 反斜杠一起显示，或更糟：把 `*` 当字面量而丢失用户意图）。
 * 注释：`%%…%%` 在阅读视图里整段隐藏；但**去掉后若无任何可见内容**则不接管
 * （见 buildInlineNodeContent 的判据③），避免渲染出一个空节点。
 */
function needsHiddenSyntax(
	raw: string,
	segments: readonly InlineSegment[],
): boolean {
	if (ESCAPED_MARKUP_RE.test(raw)) {
		return true;
	}
	// 数学（行内 `$…$` / 单行块级 `$$…$$`）：只有自绘能挂 MathJax 产物
	//（引擎 SVG 文本恒为字面 `$…$`）。接管后仍以字面占位（见 buildMathElement），
	// 渲染失败也安全回落。
	if (INLINE_MATH_RE.test(raw)) {
		return true;
	}
	// 代码块（fence 段）：只有自绘能渲染为块级盒子 + 复制按钮（引擎 SVG 文本
	// 恒为字面围栏）。纯同步构建零依赖，接管成本仅一次 DOM 装配。
	if (segments.some((segment) => segment.style === 'code' && segment.block === true)) {
		return true;
	}
	if (!INLINE_COMMENT_RE.test(raw)) {
		return false;
	}
	return segments.some((segment) => segment.text.trim() !== '');
}

/**
 * 展示截断：按段累加到上限即停（超出部分不渲染）。
 *
 * 两条口径：
 * - **链接段要么整枚显示、要么整枚不显示**——半个 `[[目标` 比不显示更糟
 *   （会误导用户以为文件里就是这么写的）；
 * - 命中上限的文本段**就地切短**（文本本身无语法，切一半是安全的）。
 * `…` 标记由调用方在尾部追加（见 buildContentElement）。
 */
function clampSegments(
	segments: readonly InlineSegment[],
	max: number,
): readonly InlineSegment[] {
	const out: InlineSegment[] = [];
	let used = 0;
	for (const segment of segments) {
		const length = segment.text.length;
		if (used + length <= max) {
			out.push(segment);
			used += length;
			continue;
		}
		if (segment.kind === 'text') {
			const keep = max - used;
			if (keep > 0) {
				// 就地切短的段丢掉嵌套子段（children 的文本 ⊆ text，截尾后子段
				// 定位失真）——截断视图退化为外层样式的平文本，可接受
				const { children: _children, ...rest } = segment;
				out.push({ ...rest, text: segment.text.slice(0, keep) });
			}
		}
		break;
	}
	// 尾部省略标记：显示为「…」，不参与回写（写回只读 mdRaw / data.text）
	out.push({ kind: 'text', text: '…' });
	return out;
}

/**
 * 接管判定的内容条件：**有链接段**（可点）或**有轻标记段**（混合字形）。
 *
 * 轻标记必须走同一条接管路径：`**粗**` / `` `码` `` 要求节点内混排字重与字形，
 * 而引擎默认正文是**单串 SVG `<text>`**（一个 font-weight 用到底），做不到
 * ——只有自绘 HTML 能表达。代价与含链接节点同款：这类节点不再有引擎编辑框，
 * 编辑入口走插件弹窗（`view-node-actions.editNodeText` → `ui/modal-text`）。
 * 2026-09-15 修订：此前只按「含链接」接管，导致 `**粗**` 在无链接节点里
 * 原样显示（用户实测发现）。
 */
function hasRichSegments(segments: readonly InlineSegment[]): boolean {
	return segments.some(
		(segment) => segment.kind === 'link' || segment.style !== undefined,
	);
}

/**
 * 节点内联内容的**显示文本**（编辑弹窗的「节点将显示为」预览用）。
 *
 * 与自绘渲染同一口径：URL 显示为地址、轻标记剥壳、超长按展示上限截断（含尾部
 * `…`），多行照原样保留。**不要**改用 `buildInlineData(...).text`——那是引擎侧
 * 口径（URL icon-only 不进文本），用它做预览会让用户以为「URL 又消失了」。
 */
export function inlineContentPreview(raw: string): string {
	const segments = buildInlineSegments(raw);
	const shown =
		raw.length > MAX_INLINE_CONTENT_CHARS
			? clampSegments(segments, MAX_INLINE_CONTENT_CHARS)
			: segments;
	return shown.map((segment) => segment.text).join('');
}

/** 段序列 → HTML 元素（文本节点 + 锚点）的构建参数 */
interface BuildContentParams {
	/**
	 * 非空表示「只显示了开头」（超长截断，见 MAX_INLINE_CONTENT_CHARS）：除尾部 `…`
	 * 外再挂 `title` 悬停提示与 `data-truncated` 标记，避免用户误以为文件里也只有
	 * 这么点内容（完整文本始终在文件与 `data.text` 中）。
	 */
	truncationTitle: string | null;
	/**
	 * 引擎「拖动节点左右边框改宽」写入的**显式宽度**（content px；null = 未拖过，
	 * 走 CONTENT_STYLES 的 500 折行上限）。见 customTextWidthOf。
	 */
	explicitWidth: number | null;
	/** 外部解析依赖（未解析链接弱化，见 InlineContentOptions） */
	options: InlineContentOptions;
	/** 界面语言：代码块复制按钮的 aria-label 等构建期文案（见 buildCodeBlockElement） */
	lang: Language;
}

/**
 * 引擎「拖动左右边框改节点宽度」写入的换行宽度（content px），未拖过时为 null。
 *
 * 引擎侧事实（vendor `simple-mind-map.cjs` 实测）：
 * - 只有 `isUseCustomNodeContent && customCreateNodeContent`（= 本插件自绘节点）
 *   才会出现这两个 `ew-resize` 手柄（`checkEnableDragModifyNodeWidth`）——正是本
 *   模块要响应的那个「边框」；
 * - 拖拽中每帧写 **节点实例字段** `node.customTextWidth` 后调
 *   `node.reRender([], { ignoreUpdateCustomTextWidth: true })`；松手时才
 *   `setData({ customTextWidth })` 落进 data（引擎自己的富文本节点据此把宽度
 *   写到元素上：`c.style.maxWidth = 宽; c.style.width = 宽 + "px"`）。
 * 故两处都要读：拖拽中靠活值、重渲染后靠 data。
 *
 * 口径＝**节点框总宽**（自绘元素的 border-box 宽）：引擎给自绘节点取的拖拽起点
 * 正是 `node.width`（元素实测总宽，`dragHandleMousedownCustomTextWidth`），按总宽
 * 映射才能让拖动与光标 1:1、起手不跳变；文字可用宽 = 该值 − 左右 padding。
 */
function customTextWidthOf(node: MindMapNode): number | null {
	const live = (node as unknown as { customTextWidth?: unknown })
		.customTextWidth;
	const data = node.getData?.() as Record<string, unknown> | null | undefined;
	for (const value of [live, data?.['customTextWidth']]) {
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return null;
}

/** 段序列 → HTML 元素（文本节点 + 锚点） */
function buildContentElement(
	doc: InlineContentDocument,
	segments: readonly InlineSegment[],
	style: NodeContentStyle,
	params: BuildContentParams,
): HTMLElement {
	const box = doc.createElement('div');
	box.className = NODE_INLINE_CONTENT_CLASS;
	// K114：把字体状态编进 outerHTML —— 引擎的离屏测量缓存以 outerHTML 为键，
	// 而 MathJax 字体渐进加载会让同一段公式的自然宽变化。写入当前字体代际后，
	// 「字体状态变了」必然 cache miss ⇒ 引擎按当前真实字体重新测宽测高；
	// 字体状态不变时键不变 ⇒ 缓存照常命中（零额外测量）。详见 core/measure-cache。
	box.setAttribute(FONT_EPOCH_ATTR, fontMeasureKey());
	// 结构/排版样式一律内联（导出保真，见 CONTENT_STYLES）
	Object.assign(box.style, CONTENT_STYLES);
	// 引擎拖宽后必须把宽度写到元素上（引擎自己的富文本节点同款写法）：
	// 引擎只负责把 customTextWidth 放到节点上再回调本钩子，元素尺寸不变时离屏
	// 克隆测出来的仍是 500 上限 → 拖多宽都是同一套换行，节点高度自然不跟着变
	// （2026-09-16 用户实测）。maxWidth 必须同步放开——CONTENT_STYLES 的 500
	// 会把更宽的拖拽钳回 500。
	if (params.explicitWidth !== null) {
		box.style.width = `${params.explicitWidth}px`;
		box.style.maxWidth = `${params.explicitWidth}px`;
	}
	if (params.truncationTitle) {
		box.setAttribute('data-truncated', 'true');
		box.setAttribute('title', params.truncationTitle);
	}
	if (style.fontSize) {
		box.style.fontSize = style.fontSize;
	}
	if (style.color) {
		box.style.color = style.color;
	}
	if (style.fontWeight) {
		box.style.fontWeight = style.fontWeight;
	}
	for (const segment of segments) {
		if (segment.kind === 'text') {
			box.appendChild(buildTextElement(doc, segment, params));
			continue;
		}
		box.appendChild(buildAnchor(doc, segment, params.options));
	}
	return box;
}

/**
 * 文本段 → 节点：无样式 = 纯文本；带轻标记时包一层语义元素（视觉增强，
 * 不影响回写）。`children` 存在时递归构建内层（一层嵌套，见 MAX_MARKUP_DEPTH）；
 * `math` 样式走 `buildMathElement`（字面占位 + 注入的异步 MathJax 渲染）；
 * `code + block` 走 `buildCodeBlockElement`（块级代码块 + 复制按钮 + Prism 高亮）。
 */
function buildTextElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): Node {
	if (segment.style === 'math') {
		return buildMathElement(doc, segment, params.options);
	}
	if (segment.style === 'code' && segment.block === true) {
		return buildCodeBlockElement(doc, segment, params.lang, params.options);
	}
	if (!segment.style) {
		return doc.createTextNode(segment.text);
	}
	const wrapper = doc.createElement(MARKUP_TAGS[segment.style]);
	Object.assign(wrapper.style, MARKUP_STYLES[segment.style]);
	if (segment.children && segment.children.length > 0) {
		for (const child of segment.children) {
			wrapper.appendChild(buildTextElement(doc, child, params));
		}
		return wrapper;
	}
	wrapper.appendChild(doc.createTextNode(segment.text));
	return wrapper;
}

/**
 * 块级代码块段（围栏，`block` 标记）：轻量渲染 + Obsidian 同款复制按钮。
 *
 * 结构：`div.tmm-codeblock`（底色盒）>`button.tmm-code-copy`（绝对定位）+ `pre > code`
 * （原文：换行/缩进逐字）。
 *
 * **三处分工，勿混**（K115）：本模块只产 DOM、**零监听**——显隐（悬停才出现）在
 * `styles.css` 的 `@media (hover:hover){ .tmm-codeblock:not(:hover) > .tmm-code-copy }`；
 * 点击（经引擎 `node_click` 委托）在 `features/node-codeblock.ts`；本表只管外观。
 * 此前此处的「悬停显隐」注释指向 `CODE_COPY_BUTTON_STYLES`，而该表并无任何 hover
 * 属性，属**悬空注释**（设计过但从未实现，K115 落地）。
 *
 * 「轻量」= **纯同步 DOM**：底色/等宽/滚动（样式见 CODE_BLOCK_*），**高亮不在
 * 本函数**——先写与原文同形的字面代码（占位即回退态），token 元素由注入的
 * `renderCode` 异步替换（同 buildMathElement 的字面占位纪律），生产实现见
 * `platform/prism-code`。**点击行为也不在本函数**——视图层经引擎 `node_click`
 * 委托命中选择器（features/node-codeblock.ts），本模块保持零 Obsidian 依赖、
 * 零监听、可单测。
 * 复制内容 = `segment.text`（信息行已在 splitFenceInfo 剥离）。
 */
function buildCodeBlockElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	lang: Language,
	options: InlineContentOptions,
): HTMLElement {
	const block = doc.createElement('div');
	block.className = CODE_BLOCK_CLASS;
	Object.assign(block.style, CODE_BLOCK_STYLES);
	const button = doc.createElement('button');
	button.className = CODE_COPY_CLASS;
	button.setAttribute('aria-label', t(lang, 'codeBlock.copy'));
	// 原生悬停提示（Obsidian 用自家 tooltip 体系；foreignObject 内取不到，
	// title 是零依赖近似——与 aria-label 同文案）
	button.setAttribute('title', t(lang, 'codeBlock.copy'));
	// **复制内容在构建期定死**（data-code）：视图层点击处理直接读它，不依赖
	// closest/querySelector 的 DOM 链——「复制到第一行」这类 DOM 读取脆弱性
	// 从根上消除；文本 = 已剥信息行的代码原文（与显示一致）
	button.setAttribute('data-code', segment.text);
	Object.assign(button.style, CODE_COPY_BUTTON_STYLES);
	const pre = doc.createElement('pre');
	Object.assign(pre.style, CODE_BLOCK_PRE_STYLES);
	const code = doc.createElement('code');
	// 语言类（宿主/主题与 Prism 的选择器口径，如 `.language-js`）：无语言码时
	// 省略——不写空类，避免留下 `language-` 这种无意义钩子
	const codeLang = segment.lang ?? '';
	if (codeLang) {
		code.className = `language-${codeLang}`;
	}
	code.appendChild(doc.createTextNode(segment.text));
	placeCodeTokens(doc, code, segment.text, codeLang, options);
	pre.appendChild(code);
	block.appendChild(button);
	block.appendChild(pre);
	return block;
}

/**
 * `<code>` 的 **token 元素放置**：产物缓存命中 → **同步**放置；未命中且有语言码
 * → 交给注入的 `renderCode` 异步高亮（生产实现 `platform/prism-code`）。
 *
 * 与 `buildMathElement` 的缓存命中路径同款纪律（理由见其注释）：引擎的离屏测量
 * 是**同步**的、缓存键是 `outerHTML`，同步放置 token 才能让引擎量到真实宽高，
 * 且重建路径不再触发异步替换（无重排循环）。
 *
 * **无语言码直接返回**（保留字面）：无信息行的围栏块与缩进式代码块都没有语法可查，
 * 空跑一次异步通道没有意义，也省掉每个缩进块一次 `loadPrism` 往返。
 */
function placeCodeTokens(
	doc: InlineContentDocument,
	code: HTMLElement,
	codeText: string,
	codeLang: string,
	options: InlineContentOptions,
): void {
	const cached = options.getCachedCode?.(codeText, codeLang) ?? null;
	if (cached && cached.length > 0) {
		code.replaceChildren(...cached);
		code.classList.add(CODE_RENDERED_CLASS);
		return;
	}
	if (!codeLang) {
		return;
	}
	options.renderCode?.(doc, codeText, codeLang, code);
}

/**
 * 数学段（行内 `$…$` / 单行块级 `$$…$$`）：先写**与原文同形的字面占位**——
 * 占位即回退态，MathJax 不可用、渲染抛错、导出快照（离屏文档）时都停在这份
 * 字面显示，与「未闭合标记按字面」同一条安全口径。渲染由注入的
 * `options.renderMath` 异步完成（生产实现见 `platform/math-jax`；本模块不
 * import Obsidian，保持无运行时可打包/可单测）。
 */
function buildMathElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	options: InlineContentOptions,
): HTMLElement {
	const holder = doc.createElement(MARKUP_TAGS.math);
	holder.className = MATH_SEGMENT_CLASS;
	const display = segment.display === true;
	// 占位与原文定界符同形：行内 `$…$` / 单行块级 `$$…$$`
	holder.textContent = display ? `$$${segment.text}$$` : `$${segment.text}$`;
	// 产物缓存命中（同一 TeX 已渲染过）：**同步**放入克隆产物——引擎随后的
	// 离屏测量直接量到真实宽高（不存在「按占位测量 → 替换后溢出」的窗口），
	// 且不触发异步替换 ⇒ 由重排引发的重建不会再次触发重排（无循环）
	const cached = options.getCachedMath?.(segment.text, display);
	if (cached) {
		holder.replaceChildren(cached);
		holder.classList.add(MATH_RENDERED_HOLDER_CLASS);
		return holder;
	}
	options.renderMath?.(doc, segment.text, holder, display);
	return holder;
}

/**
 * 锚点形态与 Obsidian MarkdownRenderer 产物一致（这是点击「零改造」的前提）：
 * 库内 = `a.internal-link[data-href]`（原始 linkpath，无 [[ ]] 包裹）；
 * 外部 = `a.external-link[href]`。view-wikilink 的 `findAnchorInNode` /
 * `resolveAnchorLink` 按此分流，本模块不得改变这两个属性名。
 *
 * 库内锚点另有**未解析**形态（`is-unresolved` + 弱化配色）：与 Obsidian 阅读视图
 * 一致，用户据此知道目标尚不存在。判定由调用方注入（`options.isResolvedLink`），
 * 每次构建实时求值——不进段序列缓存（缓存按原文寻址，与库状态无关）。
 */
function buildAnchor(
	doc: InlineContentDocument,
	segment: InlineSegment,
	options: InlineContentOptions,
): HTMLElement {
	const anchor = doc.createElement('a');
	anchor.textContent = segment.text;
	const link = segment.link ?? '';
	if (segment.internal) {
		const unresolved = options.isResolvedLink
			? !options.isResolvedLink(link)
			: false;
		Object.assign(
			anchor.style,
			unresolved ? UNRESOLVED_LINK_STYLES : INTERNAL_LINK_STYLES,
		);
		// 类名是锚点识别的契约（findAnchorInNode 用 `a.internal-link` 前缀匹配），
		// 故未解析形态必须是「internal-link 之上加 is-unresolved」，不能替换为别的名
		anchor.className = unresolved
			? 'internal-link is-unresolved'
			: 'internal-link';
		anchor.setAttribute('data-href', link);
	} else {
		Object.assign(anchor.style, EXTERNAL_LINK_STYLES);
		anchor.className = 'external-link';
		// 安全（K101 防御纵深）：链接原文来自 Markdown，可能是
		// `[点我](javascript:…)` / `data:` 这类危险协议——直接写进 href 后，一旦
		// 宿主按链接打开（中键/右键新标签/Obsidian 外链委托）即成脚本执行面
		//（Obsidian 运行在 Electron 上）。非安全协议仍按外链样式呈现，只是不设
		// href：点击走 data-href 分流，插件侧已有协议过滤，功能不受影响。
		if (isSafeAnchorHref(link)) {
			anchor.setAttribute('href', link);
		}
	}
	return anchor;
}

/** 读取节点 data 的字符串字段（非字符串/缺失归一为空串） */
function readString(data: Record<string, unknown>, key: string): string {
	const value = data[key];
	return typeof value === 'string' ? value : '';
}
