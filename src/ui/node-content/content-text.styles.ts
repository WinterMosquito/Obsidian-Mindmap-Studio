/** 节点内容 text.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineTextStyle } from '../../core/node-content-types';
import { type NodeContentTones } from '../../domain/color';

/**
 * 轻标记 → 语义元素（与 Obsidian 阅读视图一致）。
 * `boldItalic`（`***粗斜***`）取 `strong` + 内联斜体：Obsidian 渲染为 strong+em
 * 嵌套，节点内只需视觉等价（字重 + 字形），单元素即可。
 * `math` 是**容器**而非轻标记：`<span>` 占位（字面 `$…$` / 单行 `$$…$$`），由
 * 注入的 `renderMath` 异步替换为 MathJax 产物（见 InlineContentOptions.renderMath
 * 与 buildMathElement）。
 */
export const MARKUP_TAGS: Record<InlineTextStyle, string> = {
	bold: 'strong',
	boldItalic: 'strong',
	italic: 'em',
	code: 'code',
	strike: 'del',
	highlight: 'mark',
	math: 'span',
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
export function markupStyle(
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
