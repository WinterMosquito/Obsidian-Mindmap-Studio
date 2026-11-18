/** 节点内容 table.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { type NodeContentTones } from '../../domain/color';

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
export const TABLE_STYLES: Partial<CSSStyleDeclaration> = {
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

/** 单元格：着色节点用派生网格线（主题 `#e4e4e4` 在彩色底上对比仅 1.2） */
export function cellStyle(
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
export function headerStyle(
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
