/** 节点内容 root.styles：DOM/样式内聚，保持原输出与导出保真。 */


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
export const CONTENT_STYLES: Partial<CSSStyleDeclaration> = {
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
