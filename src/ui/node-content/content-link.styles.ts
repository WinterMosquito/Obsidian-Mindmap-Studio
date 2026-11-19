/** 节点内容 link.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { THEME_LINK_COLOR } from './content-common.styles';
import { type NodeContentTones } from '../../domain/color';

/**
 * 库内锚点样式（主题变量 + 字面量兜底：导出图内没有主题变量上下文）。
 * 这就是**导图内链接的可见形态**：主题链接色的超链接字体（默认蓝色系）、
 * 无图标、无下划线（2026-09-28 用户实测口径）。
 */
export const INTERNAL_LINK_STYLES: Partial<CSSStyleDeclaration> = {
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
export const EXTERNAL_LINK_STYLES: Partial<CSSStyleDeclaration> = {
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
export const UNRESOLVED_LINK_STYLES: Partial<CSSStyleDeclaration> = {
	color: `var(--link-unresolved-color, ${THEME_LINK_COLOR})`,
	opacity: 'var(--link-unresolved-opacity, 0.7)',
	textDecoration: 'none',
	cursor: 'pointer',
};

/**
 * 锚点样式：着色节点改用**正文墨色 + 下划线**。
 *
 * 为什么不是第五种颜色：实测薄荷/琥珀上没有任何蓝色能到 4.5（最好的深蓝 4.46 /
 * 4.11），紫藤上蓝字只有 1.27。下划线给的是**形状线索**，不依赖色相；未着色节点
 * 仍保持 Obsidian 的蓝色链接与无下划线。
 */
export function anchorStyle(
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
