/** 节点内容 code.styles：DOM/样式内聚，保持原输出与导出保真。 */
import { CODE_BLOCK_MAX_HEIGHT_PX } from '../../core/constants';
import { type NodeContentTones } from '../../domain/color';
import { withDerivedBorder } from './content-common.styles';

/** 块级代码块容器类名（styles.css 的 hover/按钮规则与 verify:visual 断言共用） */
export const CODE_BLOCK_CLASS = 'tmm-codeblock';

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
export const CODE_BLOCK_PRE_STYLES: Partial<CSSStyleDeclaration> = {
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
 * 围栏代码块的外框：**纸面不换**（Prism token 颜色是按纸面探测的，换底会让
 * 关键字变暗/变亮），只加一条从节点底色派生的边框——深色节点上纸卡不再「浮」，
 * 浅色节点上也能一眼看出边界。
 */
export function codeBlockStyle(
	tones: NodeContentTones | null,
): Partial<CSSStyleDeclaration> {
	return withDerivedBorder(CODE_BLOCK_STYLES, tones);
}
