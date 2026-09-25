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
 *   `features/view-node-actions.editNodeText` → `ui/modal-text` 弹窗；
 * - 轻标记**不跨行、嵌套一层**，覆盖 Obsidian 的行内四类 + 高亮与下划线式变体
 *   （`**粗**`/`__粗__`、`*斜*`/`_斜_`、`` `码` ``、`~~删~~`、`==高亮==`、
 *   `***粗斜***`）与官方「combine them」嵌套（`**粗 _斜_**`，见 Basic formatting
 *   syntax）；另有 `%%注释%%`（渲染期隐藏，对齐阅读视图：注释只在编辑视图可见）、
 *   反斜杠转义（`\*` → 字面 `*`）与**行内数学** `$…$`（经注入的 `renderMath` 异步
 *   MathJax 渲染，占位即字面回退；`$$…$$` 块级数学不支持、按字面显示）；未闭合的
 *   标记/注释按字面保留；含这些语法的节点同样被接管 → 编辑入口走弹窗（见上）；
 * - 库内锚点的 `data-href` 是**原始 linkpath**（与 Obsidian 产物一致）；目标未解析
 *   时加 `is-unresolved` 类 + 弱化配色（解析器由调用方注入，见 InlineContentOptions
 *   ——本模块必须可在无 Obsidian 运行时打包）；带子路径的显示名口径由 view-wikilink /
 *   openHyperlink 承接，本模块不做 render-time 修正（见 AGENTS.md K12）。
 */
import { isRenderableImageTarget } from '../core/constants';
import { t } from '../core/i18n';
import type { Language } from '../core/i18n';
import { isSchemeUrl, isUrlLikeText } from '../domain/url';
import { tokenDisplay, tokenizeInline } from '../markdown/md-outline';
import type { InlineToken } from '../markdown/md-outline';
import type { NodeContentStyle } from '../engine/mindmap';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';

/** 自绘节点内容的根类名（样式见 styles.css，测宽/断言按它定位） */
export const NODE_INLINE_CONTENT_CLASS = 'mindmap-node-inline-content';

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

/** 库内锚点样式（主题变量 + 字面量兜底：导出图内没有主题变量上下文） */
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
 * `math` 是**容器**而非轻标记：`<span>` 占位（字面 `$…$`），由注入的 `renderMath`
 * 异步替换为 MathJax 产物（见 InlineContentOptions.renderMath 与 buildMathElement）。
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
	 * 生产经设置 `settings.selfDrawPlainNodes` 注入（默认开，2026-09-25）。
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
	 * 行内数学（`$…$`）的**异步渲染**注入（生产实现 = `platform/math-jax`）。
	 *
	 * 本模块保持零 Obsidian 依赖（`loadMathJax` 不可在无运行时打包），故数学
	 * 渲染作为能力注入：`buildMathElement` 先写**字面 `$…$` 占位**（即回退态），
	 * 实现方在 MathJax 就绪后把 `holder` 内容替换为渲染产物。失败/未注入时
	 * 占位原样保留——与「未闭合标记按字面」同一条安全口径。
	 */
	renderMath?: (
		doc: InlineContentDocument,
		tex: string,
		holder: HTMLElement,
	) => void;
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
}

/**
 * 可被反斜杠转义的字符类（**正则源码片段**，两处共用：下面的转义分支与
 * `ESCAPED_MARKUP_RE` 的接管判据——分开写会出现「解释了这组、却按另一组触发接管」）。
 *
 * 依据官方帮助「Basic formatting syntax / Escaping Markdown Syntax」列的
 * `\*` `\_` `\#` `` \` `` `\|` `\~`，外加本模块额外解释的**高亮定界符** `=` 与
 * 反斜杠自身（CommonMark 允许转义任意 ASCII 标点，`\\` → `\`）。
 */
const ESCAPABLE_CLASS = /[*_~=`#|\\]/.source;

/**
 * 行内语法的统一扫描正则（命名分组；备选顺序即优先级）。
 *
 * 1. `%%…%%` —— 注释（可跨行；未闭合不匹配 → 按字面显示）；
 * 2. 行内代码 —— 定界符为 1..n 个反引号、**同长度闭合**（CommonMark 语义：
 *    `` ``a`b`` `` 允许内容含更短的反引号串）；内容按字面，内部不解释标记/转义；
 * 3. 转义 `\<可转义字符>` —— 消费反斜杠、按字面显示该字符（字符集见 ESCAPABLE_CLASS）；
 * 4. 行内数学 `$…$` —— 开 `$` 后不得紧跟空白、闭 `$` 前不得是空白、后不得是数字
 *    （Obsidian 数学扩展口径，防止 `$5 与 $6` 这类价签误判）；排在标记类之前，
 *    `$a*b*c$` 内的 `*` 不会被当斜体；
 * 5. `***粗斜***` / `___粗斜___`（组合字形，单独一支）；
 * 6. `**粗**` / `__粗__`、`~~删~~`、`==高亮==`、`*斜*` / `_斜_`。
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
		'(?<ticks>`+)(?<code>(?:[^`\\n]|`(?!\\k<ticks>))+?)\\k<ticks>',
		'\\\\(?<escaped>' + ESCAPABLE_CLASS + ')',
		'\\$(?!\\s)(?<math>[^$\\n]*?\\S)\\$(?!\\d)',
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

/** 行内数学的**接管判据**（与 MARKUP_RE 的 math 分支同一形态，分开写会漂移） */
const INLINE_MATH_RE = /\$(?!\s)[^$\n]*?\S\$(?!\d)/;

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
		const last = out[out.length - 1];
		if (last && last.style === undefined) {
			out[out.length - 1] = { kind: 'text', text: last.text + value };
			return;
		}
		out.push({ kind: 'text', text: value });
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
		} else if (groups.code !== undefined) {
			out.push({ kind: 'text', text: groups.code, style: 'code' });
		} else if (groups.escaped !== undefined) {
			// 转义：消费反斜杠，按字面显示该字符（无样式）
			pushPlain(groups.escaped);
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
			const body =
				groups.boldItal ??
				groups.boldItalU ??
				groups.bold ??
				groups.boldU ??
				groups.strike ??
				groups.mark ??
				groups.ital ??
				groups.italU ??
				'';
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
const SEGMENT_CACHE_MAX = 512;

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
	// 淘汰最旧的一条（而非整表清空）：热点条目已由上方命中路径持续刷新到队尾，
	// 被淘汰的只会是长期未命中的键
	if (segmentCache.size >= SEGMENT_CACHE_MAX) {
		// `IteratorResult` 已把 `.next().value` 定到 `string | undefined`，无需断言。
		// （原此处有 `as string | undefined`，理由是旧的「被推定为 any」判断，已失效。）
		const oldest = segmentCache.keys().next().value;
		if (oldest !== undefined) {
			segmentCache.delete(oldest);
		}
	}
	segmentCache.set(raw, entry);
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
 * 段序列缓存现状（`{ size, max }`）。
 *
 * 存在的理由：缓存是**长会话内存**的一个观测点——编辑弹窗的实时预览会以
 * 「每个键入一个新键」冲刷它（见上方 LRU 注释），而它唯一的结构不变式是
 * 「规模不超过 `SEGMENT_CACHE_MAX`」。该不变式原本只能靠代码审查，现由单测
 * （`tests/node-inline-content.test.ts` 的「规模封顶」例）与 `verify:visual --perf`
 * 的负载块在**真实渲染路径**上直接读。生产代码不读它。
 */
export function segmentCacheStats(): { size: number; max: number } {
	return { size: segmentCache.size, max: SEGMENT_CACHE_MAX };
}

/** 段序列构建本体（无缓存；缓存包装见 buildInlineSegments） */
function buildInlineSegmentsUncached(raw: string): InlineSegment[] {
	const segments: InlineSegment[] = [];
	let cursor = 0;
	const pushText = (text: string): void => {
		const normalized = text.replace(/[ \t]{2,}/g, ' ');
		if (!normalized) {
			return;
		}
		// 轻标记在文本段内部切分（标记符不进显示文本，原文由 mdRaw 保真）
		for (const piece of splitMarkedText(normalized)) {
			segments.push({
				kind: 'text',
				text: piece.text,
				...(piece.style ? { style: piece.style } : {}),
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

/** 剔除首尾空白段（并 trim 首尾文本段的边缘空白），不修改中间内容 */
function trimEdges(segments: InlineSegment[]): InlineSegment[] {
	while (segments.length > 0) {
		const first = segments[0]!;
		if (first.kind !== 'text') {
			break;
		}
		const trimmed = first.text.replace(/^\s+/, '');
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
		const trimmed = last.text.replace(/\s+$/, '');
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
	// ③ 有**隐藏/异步语法**需消费（`\*` 转义、`%%注释%%`、行内数学 `$…$`）——
	//    它们的正确显示同样只有自绘能做到（数学要挂 MathJax 产物）。注释仅在
	//    **去掉后仍有可见内容**时才算（否则会渲染出空节点，比原样显示注释更糟，
	//    故让引擎按字面显示）；数学以字面占位、异步替换，无该风险。
	// ④ （2026-09-25）`selfDrawPlain` 开启时**任意含文字的纯文本节点**也接管：
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

// 注（2026-09-25）：曾导出 `shouldSelfDrawNode`（静态判定「将被自绘接管」）供
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
	// 行内数学：只有自绘能挂 MathJax 产物（引擎 SVG 文本恒为字面 `$…$`）。
	// 接管后仍以字面占位（见 buildMathElement），渲染失败也安全回落。
	if (INLINE_MATH_RE.test(raw)) {
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
			box.appendChild(buildTextElement(doc, segment, params.options));
			continue;
		}
		box.appendChild(buildAnchor(doc, segment, params.options));
	}
	return box;
}

/**
 * 文本段 → 节点：无样式 = 纯文本；带轻标记时包一层语义元素（视觉增强，
 * 不影响回写）。`children` 存在时递归构建内层（一层嵌套，见 MAX_MARKUP_DEPTH）；
 * `math` 样式走 `buildMathElement`（字面占位 + 注入的异步 MathJax 渲染）。
 */
function buildTextElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	options: InlineContentOptions,
): Node {
	if (segment.style === 'math') {
		return buildMathElement(doc, segment, options);
	}
	if (!segment.style) {
		return doc.createTextNode(segment.text);
	}
	const wrapper = doc.createElement(MARKUP_TAGS[segment.style]);
	Object.assign(wrapper.style, MARKUP_STYLES[segment.style]);
	if (segment.children && segment.children.length > 0) {
		for (const child of segment.children) {
			wrapper.appendChild(buildTextElement(doc, child, options));
		}
		return wrapper;
	}
	wrapper.appendChild(doc.createTextNode(segment.text));
	return wrapper;
}

/**
 * 行内数学段（`$…$`）：先写**字面 `$…$` 占位**——占位即回退态，MathJax 不可用、
 * 渲染抛错、导出快照（离屏文档）时都停在这份字面显示，与「未闭合标记按字面」
 * 同一条安全口径。渲染由注入的 `options.renderMath` 异步完成（生产实现见
 * `platform/math-jax`；本模块不 import Obsidian，保持无运行时可打包/可单测）。
 */
function buildMathElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	options: InlineContentOptions,
): HTMLElement {
	const holder = doc.createElement(MARKUP_TAGS.math);
	holder.className = MATH_SEGMENT_CLASS;
	holder.textContent = `$${segment.text}$`;
	options.renderMath?.(doc, segment.text, holder);
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
		anchor.setAttribute('href', link);
	}
	return anchor;
}

/** 读取节点 data 的字符串字段（非字符串/缺失归一为空串） */
function readString(data: Record<string, unknown>, key: string): string {
	const value = data[key];
	return typeof value === 'string' ? value : '';
}
