/** 节点内容 math：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment, type InlineContentOptions } from '../../core/node-content-types';
import { MARKUP_TAGS } from './content-text.styles';
import { formatMathPlaceholder } from '../../core/math-placeholder';
import { MATH_RENDERED_HOLDER_CLASS } from '../../core/constants';

/** 行内数学段的占位类名（MathJax 替换后保留，供主题/调试定位） */
const MATH_SEGMENT_CLASS = 'mindmap-node-inline-math';

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
export function buildMathElement(
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
