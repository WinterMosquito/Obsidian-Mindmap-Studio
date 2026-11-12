/**
 * 节点内联内容的 **DOM 装配**（2026-10-16 自 `node-inline-content.ts` 拆出）。
 *
 * 覆盖：类名与锚点属性契约、内联样式常量表（导出保真契约，K53 ⑤）、
 * 段序列 → HTML（文本段 / 锚点 / 表格 / 代码块 / **mermaid 图** / 数学 /
 * **标签 pill**）+ **任务复选框**与节点内容根（`buildInlineNodeContent`）。
 * 段序列与接管判定来自 `node-inline-tokenize`。
 *
 * 两条类名是**跨模块契约**：`span.mindmap-node-task` 供 `view-node-task` 在画布
 * capture 阶段命中，`a.tag[data-tag]` 供 `view-tag`（**刻意不写 `href`** ⇒ 不入
 * `ANCHOR_SELECTOR`，链接三通道零改动）。改任一处都要同步改消费方。
 *
 * **着色节点**（节点 data 带 `fillColor`，即 `%%#hex%%` 指令的落点）额外有一套
 * 派生样式：墨色、码块阶、网格线都从底色现算（`domain/color.nodeContentTones`），
 * 由 `readNodeTones` 读一次、经 `BuildContentParams.tones` 下传。
 *
 * **未着色节点**的链接色只有一个来源：`THEME_LINK_COLOR`——内链 / 标签 pill /
 * 任务复选框共用（2026-10-28 用户裁决「任务与标签同 Wiki 链接配色」）。三者
 * 都随主题变量即时变色，不需要重建节点：`var()` 由浏览器解析，且颜色不影响
 * 引擎的离屏测宽缓存（K114）。着色节点仍走 `tones`——与链接的 `anchorStyle`
 * 同一套规则（可读性优先，不跟主题）。
 */
import { isSafeAnchorHref } from '../domain/url';
import {
	calloutVisualOf,
	type CalloutHeader,
	type CalloutVisual,
} from '../domain/callout';
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
	isMermaidFence,
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
 * 脚注引用徽标的类名与 id 属性名（**交互契约**：`features/view-footnote` 按
 * `[data-footnote-id]` 命中点击/悬停目标，两处共用这两个常量）。
 *
 * 徽标结构与 Obsidian 阅读视图的 `sup > a.footnote-ref` 同形但**刻意不共用类名**：
 * 节点内容在画布里，宿主的 `.footnote-ref` 全局样式（阅读视图的脚注样式）会意外
 * 命中它；`a` 也**不写 href / data-href**——`view-wikilink` 的 `ANCHOR_SELECTOR`
 * 因此不会把它当链接（链接三通道零改动，与标签 pill 同一条纪律）。
 */
export const FOOTNOTE_REF_CLASS = 'mindmap-node-footnote-ref';

/** 徽标上的脚注 id 属性（点击/悬停的唯一命中依据） */
export const FOOTNOTE_ID_ATTR = 'data-footnote-id';

/**
 * 「纯定义节点」汇总 chip 的类名与 id 列表属性（**交互契约**：
 * `features/view-footnote` 按类名命中、按 `data-footnote-ids` 展开全部定义）。
 *
 * 定义行不再铺在节点里（2026-11-11）：整节点只有定义时，接管一个 chip 而不是
 * 空内容——否则引擎会回落渲染 `data.text`，隐藏静默失效。
 */
export const FOOTNOTE_SUMMARY_CLASS = 'mindmap-node-footnote-summary';

/**
 * chip 上的定义 id 列表（**换行分隔**；点击/悬停据此展开全部定义）。
 *
 * 分隔符不能是逗号：脚注 id 允许含逗号（`[^a,b]` 是**一个** id，见
 * `md-footnote.FOOTNOTE_ID_SOURCE` 的字符类），逗号分隔会把一条定义拆成两条
 * 都判「未定义」（2026-11-12 实机）。换行不在 id 字符类里，天然无歧义。
 */
export const FOOTNOTE_IDS_ATTR = 'data-footnote-ids';

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
 * **主题链接色链**：内链 / 标签 pill / 任务复选框的**唯一基色来源**。
 *
 * 为什么是一条共享常量：三者的可见口径都是「跟主题的链接色」，一旦各写一份
 * `var(--link-color, …)` 字符串，任何一处调整兜底链都会与另两处失配
 * （硬规则 5「不造第二份判定」）。链上还有两个**下级**消费者，同样复用本常量
 * 而不是手抄：`EXTERNAL_LINK_STYLES`（外链优先）与 `UNRESOLVED_LINK_STYLES`
 * （未解析色优先）。**着色节点不适用**——那里改走 `params.tones.ink`（派生
 * 墨色），与 `anchorStyle` 同一套规则。
 *
 * 后两级兜底服务导出图（导出 SVG 内没有主题变量上下文）：`--link-color`
 * 缺失退 `--text-accent`，再退 Obsidian 默认强调色 `#7f6df2`。导出侧另有
 * `platform/export-svg-postprocess` 注入宿主实际值，两者互为兜底。
 *
 * **导出注入取的是 computed value，链路两端对称**：`getComputedStyle` 对自定义
 * 属性已完成 `var()` 替换——默认主题 `--link-color: var(--text-accent)` 实测取到
 * `hsl(210, 100%, 50%)`，注入进导出 SVG 的也是这个字面量，故**不需要**把被引用
 * 的下级变量逐个收进 `CSS_VARS_TO_EXPORT`。唯一边界同样对称：引用目标未定义 ⇒
 * 该变量 computed 值为**空串**（guaranteed-invalid）⇒ 导出侧 `!value` 跳过注入、
 * `var(--link-color, …)` 落备用值，屏上同一时刻也退到 `--text-accent`（实测
 * `--link-color: var(--nope)` → computed `''`、标签色 `rgb(0, 128, 255)`）。
 */
const THEME_LINK_COLOR = 'var(--link-color, var(--text-accent, #7f6df2))';

/**
 * 库内锚点样式（主题变量 + 字面量兜底：导出图内没有主题变量上下文）。
 * 这就是**导图内链接的可见形态**：主题链接色的超链接字体（默认蓝色系）、
 * 无图标、无下划线（2026-09-28 用户实测口径）。
 */
const INTERNAL_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: THEME_LINK_COLOR,
	textDecoration: 'none',
	cursor: 'pointer',
};

/**
 * 外部锚点样式（同上；外链配色优先于内链）。
 *
 * 兜底链同样复用 `THEME_LINK_COLOR`，而不是手抄一份 `var(--link-color, #7f6df2)`
 * ——后者少一级 `--text-accent`，且一旦主题链接色的兜底链调整就会与内链分叉
 * （硬规则 5）。`UNRESOLVED_LINK_STYLES` 是同一写法。
 */
const EXTERNAL_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: `var(--link-external-color, ${THEME_LINK_COLOR})`,
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
	color: `var(--link-unresolved-color, ${THEME_LINK_COLOR})`,
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
/**
 * mermaid 图容器类名（`tmm-*` 前缀：与代码块同属「围栏块」子系统，见
 * `core/constants` 的前缀纪律）。
 *
 * 只在**渲染成功**时出现：图不可用（语法错误 / 未注册类型 / 超限）时该段回落
 * `.tmm-codeblock`，故「有没有 `.tmm-mermaid`」就是「这节点画的是图还是源码」
 * 的唯一判据（verify:visual 与调试选择器都用它）。
 */
export const MERMAID_BLOCK_CLASS = 'tmm-mermaid';
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

/**
 * mermaid 图容器：外观几乎全部来自 Pele 自己的 SVG（底色/线条/字号都是
 * `--pele-*` 变量），本表只管「盒」与「手感」：
 * - `pointerEvents: 'auto'` —— 容器**必须可悬停**：复制按钮靠 `:hover` 显形，
 *   容器若不可命中就永远悬停不到（2026-11-09 实机踩到）。让位的是图本身
 *   （`MERMAID_FIGURE_STYLE`：`<svg>` 不参与命中），只有锚点与按钮自行放行；
 * - `lineHeight: '0'` —— SVG 是行内元素，不清零会在底部留一条基线缝；
 * - `maxWidth: 100%` + `overflow: hidden` —— 宽图靠 SVG 自带的
 *   `max-width:100%;height:auto` 等比缩小，容器只负责兜住溢出；
 * - **不设高度上限**：图的高度就是它的信息量，代码块那套「限高 + 块内滚动」
 *   会把图裁掉一块（导出克隆里更明显）。
 */
const MERMAID_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'relative',
	display: 'block',
	boxSizing: 'border-box',
	margin: '4px 0',
	maxWidth: '100%',
	overflow: 'hidden',
	lineHeight: '0',
	pointerEvents: 'auto',
	// **不透明纸面**：图有自己的底色，不把节点色透上来（2026-11-09 用户裁决）。
	// 颜色只由主题（明暗）决定：宿主有 `--pele-bg` 时用它，缺失时退回
	// `--background-primary`（老版本 Obsidian / 无 Pele 的环境）。
	// 写在**内联样式**里而不是 styles.css：类规则不进导出克隆，透明纸面会让
	// 彩色节点上的图直接压在节点填充上。
	backgroundColor: 'var(--pele-bg, var(--background-primary))',
};



/**
 * 引用块盒子类名（`kind: 'quote'` 且 **无**标注头部 = 普通引用）。
 *
 * 与 `CALLOUT_BLOCK_CLASS` 分成两个类名而不是「一个类 + 修饰符」：两者的样式
 * 来源完全不同（引用 = 宿主 blockquote 变量；标注 = `--callout-*` 类型色），
 * 且 `verify:visual` 的探针按类名区分「这是引用还是标注」（同一节点里可以两者
 * 都有）。前缀 `mindmap-` 与自绘内容其余段类名同族（前缀纪律见 `core/constants`）。
 */
export const QUOTE_BLOCK_CLASS = 'mindmap-node-quote';

/**
 * 标注盒子类名（`kind: 'quote'` 且首行是 `[!type]` 头部）。
 *
 * 类名 + `data-callout="<规范类型>"` 一起是**跨模块契约**：探针按
 * `.mindmap-node-callout[data-callout="info"]` 定位；**刻意不加** Obsidian 官方的
 * `callout` 类——那会把节点内容的布局交给主题的 `.callout > *` / `mix-blend-mode`
 * 规则，而导出 SVG 里那段 CSS 并不存在（屏上与导出必须同一份样式来源）。
 */
export const CALLOUT_BLOCK_CLASS = 'mindmap-node-callout';

/**
 * 引用块的**嵌套渲染深度上限**（层）。
 *
 * `> > [!b]` 这种嵌套靠「正文重进 `buildInlineSegments`」自然成立，但每一层都是
 * 一次递归 + 一层盒子，深度由文件内容决定（不可信输入）。上限之外的层**按字面**
 * 铺开（原文含 `>` 前缀，内容不丢），与 `MAX_MARKUP_DEPTH` 同一取舍：再往下的
 * 视觉收益趋零，扫描/测量成本与回归面线性涨。
 */
const MAX_QUOTE_DEPTH = 2;

/**
 * 普通引用块盒子：对齐宿主 `blockquote` 规则（`obsidian.asar` 实测）——
 * `border-inline-start: 2px solid var(--blockquote-border-color)` +
 * `padding-inline-start` + `color: var(--blockquote-color)`，官方默认**不斜体**
 * （`--blockquote-font-style: normal`，故不写 fontStyle）。
 *
 * 变量都带字面量兜底（导出 SVG 内没有主题变量上下文，见 CONTENT_STYLES）；
 * `--blockquote-border-color` / `--interactive-accent` 已进导出白名单。
 * 内边距取 10px 而非宿主的 `--size-4-6`（24px）：节点内是紧凑排版，24px 会把
 * 可用宽度吃掉一成（与 CONTENT_STYLES 的 padding 折算同一条取舍）。
 */
const QUOTE_BOX_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'block',
	boxSizing: 'border-box',
	margin: '4px 0',
	padding: '0 0 0 10px',
	borderInlineStart:
		'2px solid var(--blockquote-border-color, var(--interactive-accent, #7f6df2))',
	color: 'var(--blockquote-color, var(--text-normal, inherit))',
};

/**
 * 标注盒子：对齐宿主 `.callout` 的**可见形态**——圆角 + `color-mix` 10% 类型色底
 * （官方默认 `--callout-border-width: 0px`，即无边框）+ 类型色标题。
 *
 * 底色/标题色**不在这张表里**：它们随类型变（`calloutVisualOf().color`，模块
 * 初始化时派生一次），在 `buildCalloutShell` 里写到元素上。字体色不设——正文继承
 * 节点墨色（着色节点同理）。
 */
const CALLOUT_BOX_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'block',
	boxSizing: 'border-box',
	margin: '4px 0',
	padding: '6px 10px',
	borderRadius: 'var(--radius-s, 6px)',
};

/** 标注标题行：图标 + 标题 + 折叠标记的弹性一行（对齐官方 `.callout-title`） */
const CALLOUT_TITLE_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'flex',
	alignItems: 'flex-start',
	gap: '6px',
	fontWeight: '600',
	lineHeight: '1.3',
};

/**
 * 图标容器：**不设固定尺寸**——尺寸由 `platform/callout-icon` 写在 `<svg>` 的
 * 宽高上（图标来源唯一，这里再钳一次会让宽高出现第二处真相）；只负责不压缩、
 * 与首行文字对齐。
 */
const CALLOUT_ICON_STYLES: Partial<CSSStyleDeclaration> = {
	flex: '0 0 auto',
	display: 'inline-flex',
	alignItems: 'center',
};

/** 标题文字：允许换行、可压缩（长标题不撑爆节点，与 CONTENT_STYLES 同口径） */
const CALLOUT_TITLE_INNER_STYLES: Partial<CSSStyleDeclaration> = {
	flex: '1 1 auto',
	minWidth: '0',
	overflowWrap: 'anywhere',
	wordBreak: 'break-word',
};

/**
 * 折叠标记（`+` / `-`）：**纯装饰**。
 *
 * 折叠态是视图态、不进文件（官方同此），而导图节点每次重建都会丢——故本插件
 * **不实现折叠交互**，`-` 只是在这里显示一个合拢的箭头，正文照常展开（导图节点
 * 是概要面，隐藏正文会看起来像内容丢失）。
 */
const CALLOUT_FOLD_STYLES: Partial<CSSStyleDeclaration> = {
	flex: '0 0 auto',
	fontSize: '0.85em',
	lineHeight: '1.3',
	opacity: '0.7',
};

/** 标注正文容器：与标题之间留一点气口，不加左右内边距（盒子已有） */
const CALLOUT_CONTENT_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'block',
	marginTop: '2px',
};

/** 引用块正文容器：普通引用不需要标注那点气口（宿主 blockquote 本就没有） */
const QUOTE_CONTENT_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'block',
};

/**
 * 两种外壳的正文容器（类名 + 样式）：`appendQuoteBody` 按变体取**一份**。
 *
 * 摆在这里而不是挪到装配函数旁边：引用 / 标注的**全部样式表**集中在一段（从
 * `QUOTE_BOX_STYLES` 到本表），查「这个盒子内边距在哪定」时不必跨文件翻两处。
 */
const QUOTE_CONTENT_VARIANTS = {
	callout: {
		className: `${CALLOUT_BLOCK_CLASS}-content`,
		style: CALLOUT_CONTENT_STYLES,
	},
	quote: {
		className: `${QUOTE_BLOCK_CLASS}-content`,
		style: QUOTE_CONTENT_STYLES,
	},
} as const;

/** 引用块的两种外观（首行有 `[!type]` 头部 = 标注） */
type QuoteVariant = keyof typeof QUOTE_CONTENT_VARIANTS;

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
			// 纯定义节点：渲染汇总 chip（非纯定义节点为 null，定义行已被剥离）
			footnoteIds: source.footnoteIds ?? null,
			options,
			lang,
			owner,
		},
	);
}

/**
 * 任意一段行内原文 → 内容元素（**复用同一套段管线**）。
 *
 * 消费方：脚注悬浮预览（`features/view-footnote`）——预览里的粗体 / 链接 / 行内码 /
 * 表格与节点正文逐字同源，不另写一份「简易渲染」。与 `buildInlineNodeContent` 的
 * 差别只有输入形态（原文而非节点）与缺省项：不截断、无拖宽、无节点色、无任务框。
 *
 * `options` 建议只注入**同步**通道（`getCachedMath` / `getCachedCode`）：浮层不在
 * 引擎节点内，异步定稿的重测会落空（content-remeasure 按 holder 反查节点）。
 */
export function buildInlineTextContent(
	doc: InlineContentDocument,
	raw: string,
	lang: Language = 'zh',
	options: InlineContentOptions = {},
): HTMLElement {
	return buildContentElement(doc, buildInlineSegments(raw), {}, {
		truncationTitle: null,
		explicitWidth: null,
		tones: null,
		task: null,
		// 预览喂的是**定义正文**（已剥标记），不可能再有纯定义节点
		footnoteIds: null,
		options,
		lang,
		owner: null,
	});
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
	/**
	 * **纯定义节点**的定义 id（非空 ⇒ 本节点没有可见正文，只画一枚汇总 chip）。
	 *
	 * 与 `task` 同款定位：它是内容本身，不是段。定义行已在
	 * `resolveSelfDrawSource` 里被剥离（`splitFootnoteDefinitions`），此处只剩
	 * 「有几条、分别是哪些 id」这个事实。
	 */
	footnoteIds: readonly string[] | null;
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
 * 派生填充）。未着色节点（无 fillColor / 非合法 hex）返回 null ⇒ 沿用原主题样式。
 *
 * B 方案（2026-10-29）下 `fillColor` 已是**主色混白的浅档**，不是指令里那个 hex
 * ——因此这里派生出的墨色 / chip / 网格线都按「浅底」算，与节点实际的显示底色一致。
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
 * 标签 pill 的内联样式（**导出保真**：导出图不含 styles.css）。
 *
 * 配色与内链**同源**（`THEME_LINK_COLOR`）：文字直接取链接色，底色取同色
 * 14% 混合——14% 落在 `#7f6df2` 兜底上时与改造前的 `rgba(127, 109, 242, 0.14)`
 * 等价，无主题变量的环境观感不变。底色走 `color-mix` 而不是写死的 rgba：
 * 它必须跟着主题链接色走（2026-10-28 用户裁决「标签/任务同 Wiki 链接配色」）。
 * `color-mix` 按 **premultiplied** 插值，`transparent` 只贡献 alpha ⇒ 结果恰为
 * `rgba(<链接色>, 0.14)`，不是「往黑色里混」。`color-mix` 需 Chromium 111+
 * （Obsidian 1.13 的 Electron 远高于此），导出 `<img>` 解码由同一渲染引擎完成，
 * 故屏上与导出是同一份值；**第三方 SVG 编辑器**（不支持该函数）会把底色退成
 * transparent——已知且可接受的降级，别当缺陷去补第二份 rgba。
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
	color: THEME_LINK_COLOR,
	backgroundColor: `color-mix(in srgb, ${THEME_LINK_COLOR} 14%, transparent)`,
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
 * 脚注引用徽标的样式（**内联**：导出 SVG 不含 styles.css，理由同 CONTENT_STYLES）。
 *
 * 上标由 `<sup>` 承担（HTML 在 foreignObject 里按 UA 样式表渲染），这里只钉住
 * 字号与基线：不写 `vertical-align` 的话不同主题的行高会把它压进正文行内，
 * 看起来像「1 贴在字上」。颜色走链接色（阅读视图同款），**着色节点**改用派生
 * 墨色 + 下划线（与 `anchorStyle` 同一规则：彩色底上不给第五种颜色）。
 */
const FOOTNOTE_SUP_STYLES: Partial<CSSStyleDeclaration> = {
	// **固定宽度**（2026-11-11 实机复现）：引擎在**字体就绪前**测宽，而数字宽度
	// 随字体变化——窄节点上字体到位后第二枚徽标被挤到第二行（内容盒 31→51、引擎
	// 节点框仍是 31 ⇒ 溢出压住下方节点）。`inline-block + min-width` 让徽标宽度
	// 不随字体漂移（测量值 = 渲染值），负边距之类"缩宽度"的手段无效：测量宽会
	// 跟着缩，换行点不变。
	display: 'inline-block',
	minWidth: '0.9em',
	textAlign: 'center',
	fontSize: '0.75em',
	lineHeight: '1',
	verticalAlign: 'super',
	whiteSpace: 'nowrap',
	color: THEME_LINK_COLOR,
};

/**
 * 徽标内层 `<a>` 的样式（无 href：只作点击目标与光标提示）。
 *
 * ⚠ **不要给内边距**（2026-11-11 实机复现）：`padding: 0 1px` 让每枚徽标多占 2px，
 * 一行两枚就是 4px——节点内宽恰好卡在临界时，第二个徽标会被挤到**第二行**，内容盒
 * 高度从 31 变 51，而引擎的节点框仍是测量时的 31 ⇒ 文字溢出节点、压住下方节点
 * （`脚注-05-嵌入.md` 的「引用₁ 与 ₂」）。宽度预算归零后单行复原。
 */
const FOOTNOTE_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'inherit',
	textDecoration: 'none',
	cursor: 'pointer',
};

/**
 * 脚注汇总 chip 的样式（**内联**：导出 SVG 不含 styles.css，理由同 CONTENT_STYLES）。
 *
 * `user-select: none` + `cursor: pointer`：它是一个「打开入口」，不是可读内容
 * （正文在浮层里，那里可选择复制）。
 */
const FOOTNOTE_SUMMARY_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'inline-block',
	padding: '1px 7px',
	borderRadius: '10px',
	fontSize: '0.82em',
	lineHeight: '1.6',
	whiteSpace: 'nowrap',
	backgroundColor: 'var(--background-secondary, rgba(128, 128, 128, 0.12))',
	color: 'var(--text-muted, #888)',
	cursor: 'pointer',
	userSelect: 'none',
};

/**
 * 纯定义节点 → 汇总 chip（`span.mindmap-node-footnote-summary[data-footnote-ids]`）。
 *
 * 文案只报条数（`脚注 3`），不把定义正文或长 id 铺回节点——那正是要隐藏的东西。
 * 点击/悬停展开全部定义由 `features/view-footnote` 承接（本模块零监听）。
 */
function buildFootnoteSummary(
	doc: InlineContentDocument,
	ids: readonly string[],
	params: BuildContentParams,
): HTMLElement {
	// 去重：同一 id 定义两次时索引只有「首次生效」那一条，chip 不能把同一条
	// 列两遍（实机 2026-11-11 抓到 `dup,dup` 展开后重复显示同一段正文）
	const unique = [...new Set(ids)];
	const chip = doc.createElement('span');
	chip.className = FOOTNOTE_SUMMARY_CLASS;
	chip.setAttribute(FOOTNOTE_IDS_ATTR, unique.join('\n'));
	chip.textContent = t(params.lang, 'footnote.summaryLabel');
	Object.assign(chip.style, FOOTNOTE_SUMMARY_STYLES);
	if (params.tones) {
		chip.style.color = params.tones.ink;
	}
	return chip;
}

/**
 * 脚注引用段 → 徽标（`sup.mindmap-node-footnote-ref > a[data-footnote-id]`）。
 *
 * **不在此处解析定义正文**：段序列按原文寻址缓存，正文属于文档上下文，只能在
 * 交互发生时现查（见 `InlineSegment.footnote`）。悬停预览与点击跳转都在
 * `features/view-footnote`，本函数只产出可命中的 DOM。
 */
function buildFootnoteRef(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const sup = doc.createElement('sup');
	sup.className = FOOTNOTE_REF_CLASS;
	Object.assign(sup.style, FOOTNOTE_SUP_STYLES);
	const anchor = doc.createElement('a');
	const id = segment.footnote ?? segment.text;
	anchor.setAttribute(FOOTNOTE_ID_ATTR, id);
	// **刻意不写 `aria-label`、也不写 `title`**（2026-11-11 实机裁决）：Obsidian 的
	// 全局 tooltip 委托读 `[aria-label]`，鼠标停在徽标上会弹出「跳转到脚注 [^1]」
	// 黑框；`title` 又会给出浏览器原生 `[^1]` 白框。两个提示都是已知信息（数字与
	// 浮层正文），纯噪音。语义改用不触发 tooltip 的 `role`，屏幕阅读器仍能识别。
	anchor.setAttribute('role', 'doc-noteref');
	anchor.textContent = segment.text;
	Object.assign(anchor.style, FOOTNOTE_LINK_STYLES);
	if (params.tones) {
		// 着色节点：与 anchorStyle 同一规则（墨色 + 下划线形状线索，不加第五种颜色）
		sup.style.color = params.tones.ink;
		Object.assign(anchor.style, { textDecoration: 'underline' });
	}
	sup.appendChild(anchor);
	return sup;
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
 * 深勾色：完成态盒底为纯白（`ink === '#ffffff'`，即底色过深的着色节点）时用。
 * 取柔和深灰蓝而非纯黑，与节点墨色（`#111827`）同族。
 */
const TASK_MARK_DARK = '#1f2937';

/**
 * 完成态的勾色：两条分支的判据**不同源**，故不能合并成一个三元。
 *
 * - **着色节点**：完成态盒底 = `ink`（构建期已知的十六进制）⇒ 勾色按盒底反推：
 *   深墨配白勾，纯白盒底配 `TASK_MARK_DARK`。纯白必为小写：`ink` 出自
 *   `domain/color.nodeInkColor`，它只在底色过深时返回字面量 `'#ffffff'`，
 *   其余情况一律返回深色。B 方案下填充恒为浅档 ⇒ 实际总走白勾，深勾分支留给
 *   **data 里出现深 fillColor**（旧数据 / 外部写入）的场合，是防御而非死代码。
 * - **主题节点**：底色是 CSS 变量，构建期拿不到亮度 ⇒ 交主题的语义色
 *   `--text-on-accent`（强调底色上的文字色），变量缺失时回退白勾（与原生
 *   `input[type=checkbox]` 同观感）。代价是浅色链接色配白勾对比不足——接受，
 *   「与主题自洽」优先（K151 ③）。
 *
 * 单独成函数而非内联三元：`obsidianmd/no-static-styles-assignment` 按 AST 拦
 * 「赋值右侧直接是字面量」，把 `var(--…)` 藏在 `return` 里即可合规——与
 * `Object.assign(el.style, 表)` 是同一类绕行手法（K91 ⑩），别改成直赋字面量。
 */
function taskMarkColor(ink: string | undefined): string {
	if (ink === undefined) {
		return 'var(--text-on-accent, #ffffff)';
	}
	return ink === '#ffffff' ? TASK_MARK_DARK : '#ffffff';
}

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
	// 着色节点：描边/填充取派生墨色（与行内码、表格线同源）；未着色走主题
	// 链接色——与内链、标签 pill 共用同一个基色常量（2026-10-28 用户裁决）
	const ink = params.tones?.ink;
	const accent = ink ?? THEME_LINK_COLOR;
	box.style.borderColor = accent;
	// 对勾层两态都建（未勾选留空）：结构恒定，避免「有没有子节点」再引出
	// 任何尺寸差异（基线/层叠上下文以外的第二份变量）
	const mark = doc.createElement('span');
	Object.assign(mark.style, TASK_GLYPH_STYLES);
	mark.textContent = state === 'done' ? '✓' : '';
	if (state === 'done') {
		box.style.backgroundColor = accent;
		// 对勾层继承盒色，故只在这里定一次（判据见 taskMarkColor）
		box.style.color = taskMarkColor(ink);
	}
	box.appendChild(mark);
	return box;
}

/**
 * 段序列 → **已有容器的子节点**（文本 / 锚点 / 标签 / 表格 / 引用块）。
 *
 * 从 `buildContentElement` 的循环里抽出来（2026-11-11）：标注正文、引用块正文
 * 都要把**同一套段管线**再跑一遍（`buildInlineSegments(body)` → 本函数），抽出来
 * 才能复用——否则「标注里的表格 / 代码块 / 链接」就得各写一份。
 *
 * `depth` = 当前所处的引用块层级（最外层 0）。超过 `MAX_QUOTE_DEPTH` 的嵌套不再
 * 建盒子、按字面铺开（见该常量）。
 */
function appendSegments(
	doc: InlineContentDocument,
	parent: HTMLElement,
	segments: readonly InlineSegment[],
	params: BuildContentParams,
	depth: number,
): void {
	for (const segment of segments) {
		if (segment.kind === 'table') {
			parent.appendChild(buildTableElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'text') {
			parent.appendChild(buildTextElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'tag') {
			parent.appendChild(buildTagElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'footnote') {
			parent.appendChild(buildFootnoteRef(doc, segment, params));
			continue;
		}
		if (segment.kind === 'quote') {
			parent.appendChild(
				depth < MAX_QUOTE_DEPTH
					? buildQuoteElement(doc, segment, params, depth)
					: // 超深嵌套：原文（含 `>` 前缀）按字面铺开，内容不丢
						doc.createTextNode(segment.text),
			);
			continue;
		}
		parent.appendChild(buildAnchor(doc, segment, params));
	}
}

/** 段序列 → HTML 元素（复选框 + 文本 / 锚点 / 标签 / 表格 / 引用块） */
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
	// 纯定义节点：只有 chip，没有段（定义行已在渲染源里剥离）
	if (params.footnoteIds && params.footnoteIds.length > 0) {
		box.appendChild(buildFootnoteSummary(doc, params.footnoteIds, params));
		return box;
	}
	appendSegments(doc, box, segments, params, 0);
	return box;
}

/**
 * 引用块段 → 盒子（`kind: 'quote'`）：首行是 `[!type]` 头部时画**标注**，否则画
 * **普通引用**。两者共用一个段型与一次扫描（`scanQuoteBlocks`），差别只在装饰，
 * 故这里只做**分派**——外观在两条 shell 里、正文在 `appendQuoteBody` 里。
 *
 * 结构（标注）：
 * ```
 * div.mindmap-node-callout[data-callout=info][data-callout-type=info][data-callout-fold=-]
 *   └ div.mindmap-node-callout-title      ← 行内样式，颜色 = 类型色
 *       ├ span.mindmap-node-callout-icon  ← 注入的宿主图标（缺失则整段省略）
 *       ├ span.mindmap-node-callout-title-inner
 *       └ span.mindmap-node-callout-fold  ← 纯装饰，不绑事件
 *   └ div.mindmap-node-callout-content    ← 正文：递归同一套段管线
 * ```
 *
 * 两条跨函数口径：
 * - **正文递归**：`buildInlineSegments(body)` 再跑一遍本模块，围栏块 / 表格 /
 *   数学 / 链接 / 更深的引用块因此自动成立（段序列缓存按内层原文寻址，命中即复用）；
 * - **空正文不建容器**（title-only 标注）：连元素都不建，不留空盒子。
 */
function buildQuoteElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
	depth: number,
): HTMLElement {
	const quote = segment.quote;
	const header = quote?.header ?? null;
	const body = quote?.body ?? '';
	if (header === null) {
		const box = buildPlainQuoteShell(doc);
		appendQuoteBody(doc, box, body, params, depth, 'quote');
		return box;
	}
	const box = buildCalloutShell(doc, params, header, depth);
	appendQuoteBody(doc, box, body, params, depth, 'callout');
	return box;
}

/**
 * 标注外壳：盒 + 标题行（正文由 `appendQuoteBody` 追加）。
 *
 * 颜色 / 图标**只查一次表**（`calloutVisualOf`）后往下传：标题行与底色同用一份
 * `visual.color`，不再各自回查类型表。
 *
 * 着色节点（`params.tones`）只加一条**派生边框**：类型色 10% 的底在彩色节点上
 * 几乎看不出来，而主题灰框在彩色底上对比仅 1.2（与代码块 / 表格同一条修复）。
 * 标题色仍是类型色——不换成墨色，否则标注的类型语义就丢了；正文继承节点墨色，
 * 可读性不受影响。
 */
function buildCalloutShell(
	doc: InlineContentDocument,
	params: BuildContentParams,
	header: CalloutHeader,
	depth: number,
): HTMLElement {
	const box = doc.createElement('div');
	box.className = CALLOUT_BLOCK_CLASS;
	// `data-callout` 是官方 `.callout[data-callout=…]` 的键（探针与调试选择器按它定位，
	// 值 = 规范类型）；`data-callout-type` 保留**归一后的原文**（`custom-question-type`
	// 之类）——两个属性合起来才能区分"别名写法"与"自定义类型"，这也是调试时唯一能
	// 从 DOM 直接读到原文的地方（`text` / `mdRaw` 不在 DOM 里）
	box.setAttribute('data-callout', header.canonical);
	box.setAttribute('data-callout-type', header.type);
	if (header.fold) {
		box.setAttribute('data-callout-fold', header.fold);
	}
	const visual = calloutVisualOf(header.canonical);
	Object.assign(box.style, withDerivedBorder(CALLOUT_BOX_STYLES, params.tones));
	// 与宿主 `.callout` 同款：`color-mix(in oklch, 类型色 10%, transparent)`
	box.style.backgroundColor = `color-mix(in oklch, ${visual.color} 10%, transparent)`;
	box.appendChild(buildCalloutTitle(doc, params, header, visual, depth));
	return box;
}

/**
 * 普通引用外壳：只有左竖线与弱化文字（宿主 blockquote 的观感，无标题行）。
 *
 * 颜色走 `--blockquote-*`（宿主默认 `--blockquote-color: inherit`、
 * `--blockquote-font-style: normal`，故显式写的这两条只是把宿主的**缺省**固化进
 * 内联样式，屏上与导出图取到同一份值）。
 */
function buildPlainQuoteShell(doc: InlineContentDocument): HTMLElement {
	const box = doc.createElement('div');
	box.className = QUOTE_BLOCK_CLASS;
	Object.assign(box.style, QUOTE_BOX_STYLES);
	return box;
}

/**
 * 正文容器（标注 / 引用共用）：**空正文连元素都不建**，有正文才递归段管线。
 *
 * 类名与样式按变体取表（`QUOTE_CONTENT_VARIANTS`）——不在这里按 `header` 写分支：
 * 两种外观的差异是"数据"，交给表最不容易随改动漂移。
 */
function appendQuoteBody(
	doc: InlineContentDocument,
	box: HTMLElement,
	body: string,
	params: BuildContentParams,
	depth: number,
	variant: QuoteVariant,
): void {
	if (!body) {
		return;
	}
	const spec = QUOTE_CONTENT_VARIANTS[variant];
	const content = doc.createElement('div');
	content.className = spec.className;
	Object.assign(content.style, spec.style);
	appendSegments(doc, content, buildInlineSegments(body), params, depth + 1);
	box.appendChild(content);
}

/**
 * 标注标题的段序列：宿主把标题当**行内内容**，`>` / 围栏起首只是字面字符。
 *
 * `buildInlineSegments` 是块级管线（先切引用块 / 围栏 / 表格），单行文本里唯一可能
 * 误判成块的就是**行首**的 `>` 与围栏定界符（表格要表头 + 分隔两行）。命中这两者
 * 就整段按纯文本（`textContent` 语义），与宿主一致；其余照常走段管线，链接 / 粗体 /
 * 徽标因此都能渲染（2026-11-12 实机：`> [!info] > 嵌套` 曾在标题里长出一个引用盒子）。
 */
function titleSegmentsOf(title: string): readonly InlineSegment[] | null {
	if (/^[ \t]{0,3}(?:>|`{3,}|~{3,})/.test(title)) {
		return null;
	}
	return buildInlineSegments(title);
}

/**
 * 标注标题行（图标 + 标题 + 折叠标记）。
 *
 * 标题文字取 `header.title`（解析期已定稿：显式标题或类型标识的 Title Case），
 * 但**仍走一遍段管线**：宿主在标题里照样渲染 `[[双链]]` / 粗体 / 行内码
 * （2026-11-12 实机对照：阅读视图是链接 + `<strong>`，节点上曾全是字面字符）。
 * 递归深度与正文同档（标题里的轻标记只有一层，不会触发引用块递归）。
 */
function buildCalloutTitle(
	doc: InlineContentDocument,
	params: BuildContentParams,
	header: CalloutHeader,
	visual: CalloutVisual,
	depth: number,
): HTMLElement {
	const titleRow = doc.createElement('div');
	titleRow.className = `${CALLOUT_BLOCK_CLASS}-title`;
	Object.assign(titleRow.style, CALLOUT_TITLE_STYLES);
	titleRow.style.color = visual.color;
	// 图标的注入面可能缺失（无头验证 / 未接线）：`?.` + `?? null` 一步到位，
	// 缺失即整段省略，不留空 span（否则标题行多出一份 gap 间距）
	const icon = params.options.resolveCalloutIcon?.(visual.icon) ?? null;
	if (icon) {
		const iconBox = doc.createElement('span');
		iconBox.className = `${CALLOUT_BLOCK_CLASS}-icon`;
		// 图标与标题同词义（读屏重复朗读一遍没有价值），且装饰性
		iconBox.setAttribute('aria-hidden', 'true');
		Object.assign(iconBox.style, CALLOUT_ICON_STYLES);
		iconBox.appendChild(icon);
		titleRow.appendChild(iconBox);
	}
	const titleText = doc.createElement('span');
	titleText.className = `${CALLOUT_BLOCK_CLASS}-title-inner`;
	Object.assign(titleText.style, CALLOUT_TITLE_INNER_STYLES);
	// 与正文同一套段管线（title 为纯文本时产出一段纯文本，等价于 textContent）
	const titleSegments = titleSegmentsOf(header.title);
	if (titleSegments) {
		appendSegments(doc, titleText, titleSegments, params, depth + 1);
	} else {
		titleText.textContent = header.title;
	}
	titleRow.appendChild(titleText);
	if (header.fold) {
		const fold = doc.createElement('span');
		fold.className = `${CALLOUT_BLOCK_CLASS}-fold`;
		fold.setAttribute('aria-hidden', 'true');
		Object.assign(fold.style, CALLOUT_FOLD_STYLES);
		// `+` 默认展开 / `-` 默认折叠：正文一律展开渲染，标记只表达"可折叠"
		fold.textContent = header.fold === '+' ? '▾' : '▸';
		titleRow.appendChild(fold);
	}
	return titleRow;
}

// 注：引用 / 标注的样式表与正文容器变体表集中在上方常量区（`QUOTE_CONTENT_VARIANTS`），
// 装配函数区只留构建逻辑。

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
		// mermaid 围栏优先走图通道；画不了（语法错误 / 未注册类型 / 超限）时
		// **静默回落**到下面的代码块——源码仍然完整可见可编辑
		if (isMermaidFence(segment)) {
			const mermaid = buildMermaidElement(
				doc,
				segment,
				params.options,
				params.lang,
			);
			if (mermaid) {
				return mermaid;
			}
		}
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
		// 标记体里的子段走**同一套段管线**：脚注徽标（`**粗[^1]**`）、链接、标签
		// 都要按各自类型装配。此前一律 `buildTextElement` ⇒ 徽标退化成纯文本
		// `"1"`、点击/悬停/编号全部失效（2026-11-12 实机复现）。
		appendSegments(doc, wrapper, segment.children, params, 0);
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
		if (segment.kind === 'footnote') {
			// 单元格里同样是可命中徽标（`[data-footnote-id]`），与节点正文同权
			cell.appendChild(buildFootnoteRef(doc, segment, params));
			continue;
		}
		// 引用块段**可达**（单元格文本以 `>` 起首时）：单元格内不建盒子（单行引用
		// 没有块结构可言），按**字面**铺开而不是丢弃——丢弃会让那个单元格凭空少字
		if (segment.kind === 'quote') {
			cell.appendChild(doc.createTextNode(segment.text));
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
 * mermaid 图段（块级围栏 + 语言码 `mermaid`）：**同步**取 SVG 字符串并直接落进
 * 容器；返回 null 表示本段画不了，交调用方回落块级代码块。
 *
 * 为什么同步就能定稿：Pele 是纯字符串渲染（不等字体、不挂载），产物在引擎的
 * **同步离屏测宽**之前就已就位——不存在 math / 代码块那种「先占位、后替换」的
 * 窗口，也就不需要定稿回调与重排会话（这是相对宿主 `loadMermaid()` 的核心收益，
 * 后者是 async）。
 *
 * 产物形态：注入面给的是**已解析好的 `<svg>` 根元素**（解析在平台层，见
 * `platform/mermaid.renderMermaidNode`——本模块不碰字符串→DOM，也就不存在
 * `innerHTML` 注入面）。跨文档 append 由 DOM 自动 adopt，故 popout 的
 * `doc` 与主窗口解析出的元素可以直接混用。
 */
function buildMermaidElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	options: InlineContentOptions,
	lang: Language,
): HTMLElement | null {
	const svg = options.renderMermaid?.(segment.text) ?? null;
	if (svg === null) {
		return null;
	}
	enableMermaidLinks(svg);
	const box = doc.createElement('div');
	box.className = MERMAID_BLOCK_CLASS;
	Object.assign(box.style, MERMAID_STYLES);
	box.appendChild(svg);
	box.appendChild(buildMermaidCopyButton(doc, segment.text, lang));
	return box;
}

/**
 * 图本身**不参与命中**：容器必须可悬停（复制按钮靠 `:hover` 显形，容器若是
 * `pointer-events:none` 就永远悬停不到），但图若也命中就会抢走拖拽 / 双击 / 文字
 * 选择——故让 `<svg>` 让位、点击落在容器上（事件照常冒泡到引擎的节点监听）。
 */
const MERMAID_FIGURE_STYLE: Partial<CSSStyleDeclaration> = {
	pointerEvents: 'none',
};

/** 图内锚点的内联样式：图让位后，锚点是唯一需要命中能力的子元素 */
const MERMAID_ANCHOR_STYLE: Partial<CSSStyleDeclaration> = {
	pointerEvents: 'auto',
	cursor: 'pointer',
};

/** 复制按钮的命中回收（与锚点同因：容器不可命中，子元素必须显式放行） */
const MERMAID_COPY_HIT_STYLE: Partial<CSSStyleDeclaration> = {
	pointerEvents: 'auto',
};

/**
 * 让图内**锚点可点**（P3，2026-11-09）：Pele 把 mermaid 的 `click A "url"` 渲染成
 * SVG `<a href rel="noopener">`。只给锚点放行命中，图其余部分仍是
 * `pointer-events:none`（拖拽 / 双击交回引擎）。
 *
 * 点击的**接管**不在本模块：`features/view-wikilink` 在引擎 `node_click` 上识别
 * `.tmm-mermaid a[href]` 并走 `openHyperlink`（阻止默认导航——裸 `<a href>` 在
 * Electron 里会把整个窗口导航走）。
 */
function enableMermaidLinks(svg: Node): void {
	const figure = svg as unknown as SGElementLike;
	if (figure.style) {
		Object.assign(figure.style, MERMAID_FIGURE_STYLE);
	}
	const probe = svg as { querySelectorAll?: (selector: string) => ArrayLike<Element> };
	if (typeof probe.querySelectorAll !== 'function') {
		return;
	}
	for (const anchor of Array.from(probe.querySelectorAll('a[href]'))) {
		Object.assign(
			(anchor as unknown as SGElementLike).style,
			MERMAID_ANCHOR_STYLE,
		);
	}
}

/** 锚点样式的窄操作面（SVG 元素的 `style` 是只读的 `CSSStyleDeclaration`） */
type SGElementLike = { style: Partial<CSSStyleDeclaration> };

/**
 * 图容器的**复制源码**按钮（P2，2026-11-09）：复用代码块的按钮类名与
 * `data-code` 契约——点击委托（`features/node-codeblock`）因此**零改动**即可命中，
 * 导出隐身（`hideCopyButtonsInExportSvg`）与 ✓ 反馈也一并复用。
 *
 * 文案单独一条 i18n（复制的是**源码**，不是渲染产物）。
 */
function buildMermaidCopyButton(
	doc: InlineContentDocument,
	source: string,
	lang: Language,
): HTMLElement {
	const button = doc.createElement('button');
	button.className = CODE_COPY_CLASS;
	button.setAttribute('aria-label', t(lang, 'mermaid.copy'));
	button.setAttribute('title', t(lang, 'mermaid.copy'));
	button.setAttribute('data-code', source);
	Object.assign(button.style, CODE_COPY_BUTTON_STYLES);
	// 容器是 pointer-events:none：按钮必须自己拿回命中能力（否则点击穿透到画布）
	Object.assign(button.style, MERMAID_COPY_HIT_STYLE);
	return button;
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
