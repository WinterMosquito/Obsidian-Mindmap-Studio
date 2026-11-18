/** 节点内容 quote.styles：DOM/样式内聚，保持原输出与导出保真。 */


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
export const MAX_QUOTE_DEPTH = 2;

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
export const QUOTE_BOX_STYLES: Partial<CSSStyleDeclaration> = {
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
export const CALLOUT_BOX_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'block',
	boxSizing: 'border-box',
	margin: '4px 0',
	padding: '6px 10px',
	borderRadius: 'var(--radius-s, 6px)',
};

/** 标注标题行：图标 + 标题 + 折叠标记的弹性一行（对齐官方 `.callout-title`） */
export const CALLOUT_TITLE_STYLES: Partial<CSSStyleDeclaration> = {
	display: 'flex',
	alignItems: 'flex-start',
	gap: '6px',
	fontWeight: '600',
	lineHeight: '1.3',
};

/**
 * 图标容器：**不设固定尺寸**——尺寸由 `platform/rendering/callout-icon` 写在 `<svg>` 的
 * 宽高上（图标来源唯一，这里再钳一次会让宽高出现第二处真相）；只负责不压缩、
 * 与首行文字对齐。
 */
export const CALLOUT_ICON_STYLES: Partial<CSSStyleDeclaration> = {
	flex: '0 0 auto',
	display: 'inline-flex',
	alignItems: 'center',
};

/** 标题文字：允许换行、可压缩（长标题不撑爆节点，与 CONTENT_STYLES 同口径） */
export const CALLOUT_TITLE_INNER_STYLES: Partial<CSSStyleDeclaration> = {
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
export const CALLOUT_FOLD_STYLES: Partial<CSSStyleDeclaration> = {
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
export const QUOTE_CONTENT_VARIANTS = {
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
export type QuoteVariant = keyof typeof QUOTE_CONTENT_VARIANTS;
