/**
 * 节点内联内容的 **DOM 装配**（2026-10-16 自 `node-inline-content.ts` 拆出）。
 *
 * 覆盖：类名与锚点属性契约、内联样式常量表（导出保真契约，K53 ⑤）、
 * 段序列 → HTML（文本段 / 锚点 / 表格 / 代码块 / 数学 / **标签 pill**）+
 * **任务复选框**与节点内容根（`buildInlineNodeContent`）。段序列与接管判定来自
 * `node-inline-tokenize`。
 *
 * 两条类名是**跨模块契约**：`span.mindmap-node-task` 供 `view-node-task` 在画布
 * capture 阶段命中，`a.tag[data-tag]` 供 `view-tag`（**刻意不写 `href`** ⇒ 不入
 * `ANCHOR_SELECTOR`，链接三通道零改动）。改任一处都要同步改消费方。
 *
 * **着色节点**（节点 data 带 `fillColor`，即 `%%#hex%%` 指令的落点）额外有一套
 * 派生样式：墨色、码块阶、网格线都从底色现算（`domain/color.nodeContentTones`），
 * 由 `readNodeTones` 读一次、经 `BuildContentParams.tones` 下传。未着色节点一律
 * 走原常量表，观感与改动前逐字一致。
 */
import { isSafeAnchorHref } from '../domain/url';
import {
	normalizeHexColor,
	nodeContentTones,
	type NodeContentTones,
} from '../domain/color';
import { t } from '../core/i18n';
import type { Language } from '../core/i18n';
import {
	CODE_BLOCK_MAX_HEIGHT_PX,
	CODE_RENDERED_CLASS,
	MATH_RENDERED_HOLDER_CLASS,
} from '../core/constants';
import type { PipeTableAlign } from '../domain/pipe-table';
import type { NodeContentStyle } from '../engine/mindmap';
import { formatMathPlaceholder } from '../core/math-placeholder';
import { fontMeasureKey } from '../core/measure-cache';
import type { MindMapNode } from '../core/engine-types';
import {
	MAX_INLINE_CONTENT_CHARS,
	buildInlineSegments,
	clampSegments,
	resolveSelfDrawSource,
	taskStateOf,
	type InlineContentDocument,
	type InlineContentOptions,
	type InlineSegment,
	type InlineTextStyle,
} from './node-inline-tokenize';

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

/** 自绘节点内容的根类名（样式见 styles.css，测宽/断言按它定位） */
export const NODE_INLINE_CONTENT_CLASS = 'mindmap-node-inline-content';

/**
 * 任务复选框的类名（**交互契约**：`features/view-node-task` 用它在画布 capture
 * 阶段命中点击目标；改这里必须同步改那边，两处都不许写字面量）。
 */
export const NODE_TASK_CLASS = 'mindmap-node-task';

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

/**
 * 表格（GFM 管道表段）的**结构样式**：内联在元素上（导出保真，理由同
 * CONTENT_STYLES——插件 styles.css 不进导出 SVG，类规则在导出图里整体失效）。
 *
 * 三条口径：
 * - `maxWidth: 100%` + 单元格 `overflowWrap: anywhere` ——**表格不许撑爆节点**：
 *   表宽以内容自然宽为底、以内容盒宽（默认 500 / 拖宽后的显式宽）为顶，超出即
 *   由单元格折行吸收（用户裁决 2026-10-14）；
 * - 配色走主题变量 + 字面量兜底（导出图内没有主题变量上下文，同 CODE_BLOCK_STYLES）；
 * - **不设高度上限**（表格是数据展示面；`MAX_INLINE_CONTENT_CHARS` **不构成行数封顶**
 *   ——`clampSegments` 对「表格自身超预算」是**整张保留 + 明示截断**，故单表的行/单元格
 *   数无硬上限、只受节点 `mdRaw` 长度约束（测量缓存键随表体量增长，K114 已知取舍）；
 *   代码块那套「限高 + 块内滚动」在导出克隆里会裁掉内容，不适合表格）。
 */
const TABLE_STYLES: Partial<CSSStyleDeclaration> = {
	borderCollapse: 'collapse',
	maxWidth: '100%',
	margin: '4px 0',
};

/** 表格单元格（td / th 共用底）：边框 + 内边距 + 长内容折行 */
const TABLE_CELL_STYLES: Partial<CSSStyleDeclaration> = {
	border: '1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.35))',
	padding: '2px 8px',
	verticalAlign: 'top',
	overflowWrap: 'anywhere',
	wordBreak: 'break-word',
};

/**
 * 表头单元格 = 单元格底 + 底色与字重。
 *
 * 底色**不是**抄自阅读视图（官方样式包里表格没有底色规则，实测零命中），而是画布
 * 的可读性取舍：节点是空间对象，表头需要一眼可辨；配色走主题变量 + 字面量兜底。
 */
const TABLE_HEADER_STYLES: Partial<CSSStyleDeclaration> = {
	...TABLE_CELL_STYLES,
	backgroundColor: 'var(--background-secondary, rgba(128, 128, 128, 0.1))',
	fontWeight: '600',
};

/**
 * 着色节点上的高亮：**实心黄 + 黑字**（12.8:1）。
 *
 * 主题的 40% 透明黄是按白底设计的：在深色节点上叠加后只有 3.3–4.5，且看起来像
 * 一块脏色。实心黄在任何底色上都是「荧光笔」语义，字色也随之定死为黑。
 */
const COLOR_HIGHLIGHT_BG = '#ffd000';
const COLOR_HIGHLIGHT_INK = '#000000';

/**
 * 轻标记样式：**无节点色走原常量**（未着色节点的观感与改动前逐字一致）；
 * 着色节点改三处——行内码换派生色阶（不再取主题近白）、高亮换实心黄、删除线
 * 去掉 75% 透明度。其余标记（粗/斜/粗斜）只继承墨色，不需要覆盖。
 */
function markupStyle(
	style: InlineTextStyle,
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	if (!tones) {
		return MARKUP_STYLES[style];
	}
	if (style === 'code') {
		return { ...MARKUP_STYLES.code, backgroundColor: tones.chip };
	}
	if (style === 'highlight') {
		return {
			backgroundColor: COLOR_HIGHLIGHT_BG,
			color: COLOR_HIGHLIGHT_INK,
			borderRadius: '2px',
		};
	}
	if (style === 'strike') {
		// 删除线在着色节点上**不再叠 75% 透明度**：正文墨色本已贴着可读线
		// （薄荷 5.41 / 紫藤 4.82），再乘 0.75 会掉到 3.5–4.2，像「快看不见」。
		// 弱化语义由那条横线本身承担。
		return { textDecoration: 'line-through' };
	}
	return MARKUP_STYLES[style];
}

/**
 * 锚点样式：着色节点改用**正文墨色 + 下划线**。
 *
 * 为什么不是第五种颜色：实测薄荷/琥珀上没有任何蓝色能到 4.5（最好的深蓝 4.46 /
 * 4.11），紫藤上蓝字只有 1.27。下划线给的是**形状线索**，不依赖色相；未着色节点
 * 仍保持 Obsidian 的蓝色链接与无下划线。
 */
function anchorStyle(
	base: Partial<CSSStyleDeclaration>,
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	if (!tones) {
		return base;
	}
	return {
		...base,
		color: tones.ink,
		textDecoration: 'underline',
		textUnderlineOffset: '2px',
	};
}

/**
 * 「外框类」容器（表格 / 围栏代码块）：着色节点把主题的浅灰外框换成派生色
 * ——主题 `#e4e4e4` 在彩色底上对比仅 1.2，等于没有框。
 */
function withDerivedBorder(
	base: Partial<CSSStyleDeclaration>,
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	return tones ? { ...base, border: `1px solid ${tones.border}` } : base;
}

/** 单元格：着色节点用派生网格线（主题 `#e4e4e4` 在彩色底上对比仅 1.2） */
function cellStyle(
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	return tones
		? { ...TABLE_CELL_STYLES, borderColor: tones.border }
		: TABLE_CELL_STYLES;
}

/**
 * 表头：着色节点用**码块同一份色阶** + 墨色文字。
 * 主题表头底色（近白）在深色节点上是「白底白字 1.08」，这条是修复的核心之一。
 */
function headerStyle(
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	if (!tones) {
		return TABLE_HEADER_STYLES;
	}
	return {
		...TABLE_CELL_STYLES,
		borderColor: tones.border,
		backgroundColor: tones.chip,
		color: tones.ink,
		fontWeight: '600',
	};
}

/**
 * 围栏代码块的外框：**纸面不换**（Prism token 颜色是按纸面探测的，换底会让
 * 关键字变暗/变亮），只加一条从节点底色派生的边框——深色节点上纸卡不再「浮」，
 * 浅色节点上也能一眼看出边界。
 */
function codeBlockStyle(
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	return withDerivedBorder(CODE_BLOCK_STYLES, tones);
}

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
 * - 本模块（及其依赖的 `node-inline-tokenize`）必须能在**无 Obsidian 运行时**的
 *   页面里跑（`scripts/verify-visual.mjs` 打包入口 `features/node-inline-content.ts`
 *   做无头验证），故不走 `doc.win.createDiv()` 一族 Obsidian DOM
 *   助手——那要求验证页复刻一整套助手垫片，垫片与官方实现的分叉本身是新的风险面；
 * - 窄接口把「依赖了 document 的哪几个工厂」钉在类型上（新增依赖必须改类型），
 *   与引擎层 `mindmap.ts` 用原生 `createElementNS` 构建 SVG 的口径一致。
 *
 * 调用方（引擎钩子）传真实 `document`（画布所在文档），结构类型自动匹配。
 */

/**
 * 节点内联内容渲染器（引擎 `customCreateNodeContent` 钩子，返回 null 即不接管）。
 *
 * `doc` 必须是**画布所在 document**（popout 场景由引擎层传 `el.ownerDocument`）；
 * `lang` 用于截断提示文案（省略时按 zh，与插件默认语言一致）；
 * `options` 注入外部解析（未解析链接弱化，见 InlineContentOptions）；
 * `owner` = 构建该内容的引擎实例（不透明 token，见 `renderMath` 的说明——
 * 本模块只做透传，不解释；省略时为 null = 无归属）。
 */
export function buildInlineNodeContent(
	node: MindMapNode,
	doc: InlineContentDocument,
	style: NodeContentStyle = {},
	lang: Language = 'zh',
	options: InlineContentOptions = {},
	owner: object | null = null,
): HTMLElement | null {
	const source = resolveSelfDrawSource(node);
	if (!source) {
		return null;
	}
	const { segments, overlong } = source;
	// 超限判定按原文长度，标记按**实际丢弃**（clamped.truncated）——两者可能不同
	// （见 clampSegments）
	const clamped = overlong
		? clampSegments(segments, MAX_INLINE_CONTENT_CHARS)
		: { segments, truncated: false };
	return buildContentElement(
		doc,
		clamped.segments,
		style,
		{
			truncationTitle: clamped.truncated
				? t(lang, 'nodeTextTruncated')
				: null,
			// 用户拖过左右边框时按引擎写入的宽度渲染（未拖过 → null → 500 折行上限）
			explicitWidth: customTextWidthOf(node),
			// 节点级配色（`%%#hex%%`）：着色节点内所有「轻渲染」都从这份派生色取，
			// 未着色节点为 null（样式与改动前逐字一致）
			tones: readNodeTones(node),
			// 任务状态：图片节点在 resolveSelfDrawSource 已被挡掉（裁决 4）
			task: taskStateOf(node.getData?.() as Record<string, unknown> | null),
			options,
			lang,
			owner,
		},
	);
}

/** `buildContentElement` 的构建参数（一次装配读一次的取值，随段递归下传） */
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
	/**
	 * 构建该内容的引擎实例（不透明 token；只透传给 `renderMath`，见其说明）。
	 * 内层递归（`buildTextElement` 的 children）同样携带——归属与嵌套深度无关。
	 */
	owner: object | null;
	/**
	 * 节点级配色派生出的内容色（`null` = 未着色节点，走原主题样式）。
	 *
	 * 只由 `data.fillColor` 决定（指令的唯一落点），**不跟随明暗主题**：
	 * 写进文件的实色不随主题变，内容色也应保持一致。
	 */
	tones: NodeContentTones | null;
	/**
	 * 任务状态（`null` = 非任务）：复选框是自绘内容的**第一个子元素**，与文本
	 * 同处一个 `foreignObject`，导出 SVG 时随内容一起序列化。
	 */
	task: 'todo' | 'done' | null;
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

/**
 * 节点的派生内容色：**只认 `data.fillColor`**（`engine/mindmap-colors` 写入的
 * 指令落点）。未着色节点（无 fillColor / 非合法 hex）返回 null ⇒ 沿用原主题样式。
 *
 * 注意不读 `data.color`：那是引擎要用的文字色，和这里的墨色同源但用途不同；
 * 内容层需要的是整套（墨色 + 码块阶 + 网格线）。
 */
function readNodeTones(node: MindMapNode): NodeContentTones | null {
	const data = node.getData?.() as Record<string, unknown> | null | undefined;
	const fill = typeof data?.['fillColor'] === 'string' ? data['fillColor'] : '';
	const hex = normalizeHexColor(fill);
	return hex ? nodeContentTones(hex) : null;
}

/**
 * 缺省强调色（`#7f6df2`＝Obsidian 默认 `--text-accent`）。
 *
 * 标签 pill 与任务复选框共用：两者的内联样式要进导出 SVG（**不注入 styles.css**，
 * 见文件头的导出保真契约），故不能只写 `var(--text-accent)` 一条。
 */
const NODE_ACCENT_FALLBACK = '#7f6df2';

/**
 * 标签 pill 的内联样式（**导出保真**：导出图不含 styles.css）。
 *
 * 用 `<a>` 但**不写 href**：既有 `ANCHOR_SELECTOR`
 * （`a.internal-link, a.external-link, a[href]`）因此不会命中它，链接的三条
 * 通道（点击 / 悬停预览 / 中键）零改动；标签点击由 `features/view-tag` 的
 * `a.tag[data-tag]` 分支单独接管（唯一入口，文件视图与只读嵌入共用）。
 */
const TAG_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'inline',
	padding: '0 4px',
	borderRadius: '4px',
	textDecoration: 'none',
	cursor: 'pointer',
	color: NODE_ACCENT_FALLBACK,
	backgroundColor: 'rgba(127, 109, 242, 0.14)',
};

/** 标签段 → pill 元素（`text` 带 `#`，`data-tag` 是不带 `#` 的名称） */
function buildTagElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const el = doc.createElement('a');
	el.className = 'tag';
	el.setAttribute('data-tag', segment.tag ?? '');
	el.textContent = segment.text;
	Object.assign(el.style, TAG_STYLES);
	if (params.tones) {
		// 着色节点：pill 与行内码同族（墨色文字 + 从底色派生的 chip）
		el.style.color = params.tones.ink;
		el.style.backgroundColor = params.tones.chip;
	}
	return el;
}

/**
 * 复选框盒模型（**内联**：导出 SVG 不含 styles.css，见文件头的导出保真契约）。
 *
 * 尺寸取 13px：与 14/15px 正文的首行基线对齐后不顶高节点；对勾用普通文本
 * （`✓`）而非表单控件——`<input type=checkbox>` 在 foreignObject 的序列化 /
 * 光栅化路径上表现不一致，且无法内联主题色。
 *
 * **盒子本体不能有直接文本子节点**（`position: relative` 只服务于对勾层）：
 * 空 inline-block 的基线取底边 margin edge，一旦盒内出现 `✓`，基线改为字形
 * 基线 ⇒ 所在行盒被撑高 2px ⇒ 引擎重测出「勾选后节点高 26→28」，画布上节点
 * 上下各长 1px、**下方兄弟节点整列下移**、复选框相对文字下沉（2026-10-28 实机：
 * 未勾选 26 / 已勾选 28；内容盒高度对照 空=26、放 `✓`=28、清空=26、
 * `✓` 放绝对定位子元素=26）。故对勾一律走 `TASK_GLYPH_STYLES` 的绝对定位层，
 * 两层都渲染（未勾选层留空）以保证两态结构一致。
 */
const TASK_BOX_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'relative',
	display: 'inline-block',
	boxSizing: 'border-box',
	width: '13px',
	height: '13px',
	lineHeight: '10px',
	textAlign: 'center',
	borderStyle: 'solid',
	borderWidth: '1.5px',
	borderRadius: '3px',
	marginRight: '6px',
	verticalAlign: '-2px',
	fontSize: '10px',
	fontWeight: '700',
	cursor: 'pointer',
	userSelect: 'none',
};

/**
 * 对勾层：**绝对定位**（不参与行盒 ⇒ 有没有 `✓` 都不改变盒子基线，见
 * `TASK_BOX_STYLES`）。`inset: 0` 铺满边框内的内容区，flex 居中抵消
 * `line-height`/字体度量差异；`pointerEvents: none` 让命中判定统一落在复选框
 * 本体上（`view-node-task` 的 `closest('.mindmap-node-task')` 之外不该有目标）。
 */
const TASK_GLYPH_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'absolute',
	top: '0',
	left: '0',
	right: '0',
	bottom: '0',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	lineHeight: '1',
	fontSize: '10px',
	fontWeight: '700',
	pointerEvents: 'none',
};

/**
 * 任务复选框：状态由 `data.mdTask` 决定，点击切换由 `features/view-node-task`
 * 在画布 capture 阶段接管（本函数只负责画，不绑事件——节点会随渲染重建，
 * 逐元素绑监听必然泄漏）。
 */
function buildTaskCheckbox(
	doc: InlineContentDocument,
	state: 'todo' | 'done',
	params: BuildContentParams,
): HTMLElement {
	const box = doc.createElement('span');
	box.className = NODE_TASK_CLASS;
	box.setAttribute('data-task', state);
	box.setAttribute('role', 'checkbox');
	box.setAttribute('aria-checked', state === 'done' ? 'true' : 'false');
	box.setAttribute(
		'aria-label',
		t(
			params.lang,
			state === 'done' ? 'node.task.markUndone' : 'node.task.markDone',
		),
	);
	Object.assign(box.style, TASK_BOX_STYLES);
	// 着色节点：描边/填充取派生墨色（与行内码、表格线同源），未着色走缺省强调色
	const ink = params.tones?.ink;
	const accent = ink ?? NODE_ACCENT_FALLBACK;
	box.style.borderColor = accent;
	// 对勾层两态都建（未勾选留空）：结构恒定，避免「有没有子节点」再引出
	// 任何尺寸差异（基线/层叠上下文以外的第二份变量）
	const mark = doc.createElement('span');
	Object.assign(mark.style, TASK_GLYPH_STYLES);
	mark.textContent = state === 'done' ? '✓' : '';
	if (state === 'done') {
		box.style.backgroundColor = accent;
		// 对勾与底色必须对比：墨色是白（底色偏深）⇒ 深色勾，其余（墨色深）⇒ 白勾。
		// 对勾层继承盒色，故只在这里定一次。
		box.style.color = ink === '#ffffff' ? '#1f2937' : '#ffffff';
	}
	box.appendChild(mark);
	return box;
}

/** 段序列 → HTML 元素（复选框 + 文本 / 锚点 / 标签 / 表格） */
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
	// 着色节点：墨色以派生值为准（与 data.color 同源，但这里保证内容层拿到的是
	// 「三候选取大」的结果，避免引擎侧与内容层各持一份文字色）
	if (params.tones) {
		box.style.color = params.tones.ink;
	}
	// 复选框在所有段之前（与 GFM 列表项 `- [ ] 文本` 的阅读顺序一致）
	if (params.task) {
		box.appendChild(buildTaskCheckbox(doc, params.task, params));
	}
	for (const segment of segments) {
		if (segment.kind === 'table') {
			box.appendChild(buildTableElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'text') {
			box.appendChild(buildTextElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'tag') {
			box.appendChild(buildTagElement(doc, segment, params));
			continue;
		}
		box.appendChild(buildAnchor(doc, segment, params));
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
		return buildMathElement(doc, segment, params.options, params.owner);
	}
	if (segment.style === 'code' && segment.block === true) {
		return buildCodeBlockElement(
			doc,
			segment,
			params.lang,
			params.options,
			params.tones,
		);
	}
	if (!segment.style) {
		return doc.createTextNode(segment.text);
	}
	const wrapper = doc.createElement(MARKUP_TAGS[segment.style]);
	Object.assign(wrapper.style, markupStyle(segment.style, params.tones));
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
 * 表格段（GFM 管道表，`kind: 'table'`）：`table > thead/tbody > tr > th/td`，
 * 样式全内联（见 TABLE_* 三表），单元格内容**复用**行内段管线。
 *
 * 三条与模块其余部分共享的纪律：
 * - **同步纯 DOM**：没有「占位 → 产物」两段式，也就没有数学/代码块那套定稿重排；
 * - **零监听**：单元格里的链接仍是普通锚点，点击由 `view-wikilink` 经引擎
 *   `node_click` 命中（与节点其余部分的锚点同一契约）；
 * - **只读显示**：模型来自 `domain/pipe-table`（`\|` 已还原、列数已归一），原文
 *   仍由 `mdRaw` 逐字保真——回写路径一个字都不经过这里。
 *
 * 单元格内容走同一套段管线（`buildInlineSegments` → 文本段 / 锚点）：单元格是
 * **单行**文本 ⇒ 其中不可能再切出表格段（表格至少两行），递归在此天然终止。
 */
function buildTableElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const table = doc.createElement('table');
	Object.assign(table.style, withDerivedBorder(TABLE_STYLES, params.tones));
	const model = segment.table;
	if (!model) {
		// 表格段的构造点唯一（必带模型）；真出现空壳时按字面兜底，不渲染空白
		table.appendChild(doc.createTextNode(segment.text));
		return table;
	}
	const head = doc.createElement('thead');
	const headRow = doc.createElement('tr');
	head.appendChild(headRow);
	table.appendChild(head);
	model.header.forEach((cell, column) => {
		const th = doc.createElement('th');
		Object.assign(th.style, headerStyle(params.tones));
		applyCellAlign(th, model.align[column] ?? null);
		appendCellContent(doc, th, cell, params);
		headRow.appendChild(th);
	});
	if (model.rows.length > 0) {
		const body = doc.createElement('tbody');
		table.appendChild(body);
		for (const row of model.rows) {
			const tr = doc.createElement('tr');
			body.appendChild(tr);
			row.forEach((cell, column) => {
				const td = doc.createElement('td');
				Object.assign(td.style, cellStyle(params.tones));
				applyCellAlign(td, model.align[column] ?? null);
				appendCellContent(doc, td, cell, params);
				tr.appendChild(td);
			});
		}
	}
	return table;
}

/**
 * 列对齐 → 内联样式；`null`（分隔行未指定）**不写**，交给宿主与浏览器默认。
 *
 * 为什么 `null` 保持沉默：官方样式包里没有 `th { text-align }` 规则（`resources/*.asar`
 * 实测零命中），阅读视图的表头因此走浏览器 UA 默认（**居中**）——写死 `left` 反而
 * 会与阅读视图分叉。指定了对齐（`:---` / `---:` / `:---:`）才写内联样式。
 */
function applyCellAlign(cell: HTMLElement, align: PipeTableAlign | null): void {
	if (align !== null) {
		cell.style.textAlign = align;
	}
}

/**
 * 单元格内容 → 行内段（轻标记 / 链接 / 数学 / 行内码），与节点其余部分同一套
 * token 口径（`tokenizeInline` + `tokenDisplay`），故单元格里的双链同样可点。
 */
function appendCellContent(
	doc: InlineContentDocument,
	cell: HTMLElement,
	text: string,
	params: BuildContentParams,
): void {
	for (const segment of buildInlineSegments(text)) {
		if (segment.kind === 'link') {
			cell.appendChild(buildAnchor(doc, segment, params));
			continue;
		}
		if (segment.kind === 'text') {
			cell.appendChild(buildTextElement(doc, segment, params));
			continue;
		}
		// 其余段（代码 / 数学 / 表格）在单元格里**不可达**：单元格文本恒单行
		//（`splitPipeRow` 按行切）且单元格内刻意不做块级内容——此处的 `continue`
		// 是显式不变式声明（模型若放宽，孤段被跳过而不是渲染出半个单元格）
	}
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
	tones: NodeContentTones | null,
): HTMLElement {
	const block = doc.createElement('div');
	block.className = CODE_BLOCK_CLASS;
	Object.assign(block.style, codeBlockStyle(tones));
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
 *
 * `owner` = 构建该段的引擎实例（不透明 token；只透传给 `renderMath` 供平台侧
 * 登记归属，本模块不解释）——见 `InlineContentOptions.renderMath` 的说明。
 */
function buildMathElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	options: InlineContentOptions,
	owner: object | null,
): HTMLElement {
	const holder = doc.createElement(MARKUP_TAGS.math);
	holder.className = MATH_SEGMENT_CLASS;
	const display = segment.display === true;
	// 占位与原文定界符同形（形态**单一来源**：core/math-placeholder——异步
	// 撤回路径用同一函数，两处断链即「撤回后与构建形态不一致」的静默分叉）
	holder.textContent = formatMathPlaceholder(segment.text, display);
	// 产物缓存命中（同一 TeX 已渲染过）：**同步**放入克隆产物——引擎随后的
	// 离屏测量直接量到真实宽高（不存在「按占位测量 → 替换后溢出」的窗口），
	// 且不触发异步替换 ⇒ 由重排引发的重建不会再次触发重排（无循环）
	const cached = options.getCachedMath?.(segment.text, display);
	if (cached) {
		holder.replaceChildren(cached);
		holder.classList.add(MATH_RENDERED_HOLDER_CLASS);
		return holder;
	}
	options.renderMath?.(doc, segment.text, holder, display, owner);
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
	params: BuildContentParams,
): HTMLElement {
	const anchor = doc.createElement('a');
	anchor.textContent = segment.text;
	const link = segment.link ?? '';
	if (segment.internal) {
		const unresolved = params.options.isResolvedLink
			? !params.options.isResolvedLink(link)
			: false;
		Object.assign(
			anchor.style,
			anchorStyle(
				unresolved ? UNRESOLVED_LINK_STYLES : INTERNAL_LINK_STYLES,
				params.tones,
			),
		);
		// 类名是锚点识别的契约（findAnchorInNode 用 `a.internal-link` 前缀匹配），
		// 故未解析形态必须是「internal-link 之上加 is-unresolved」，不能替换为别的名
		anchor.className = unresolved
			? 'internal-link is-unresolved'
			: 'internal-link';
		anchor.setAttribute('data-href', link);
	} else {
		Object.assign(anchor.style, anchorStyle(EXTERNAL_LINK_STYLES, params.tones));
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
