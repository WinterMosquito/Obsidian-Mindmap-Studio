/** 节点内容 root：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { NODE_INLINE_CONTENT_CLASS } from '../../core/constants';
import { fontMeasureKey } from '../../core/measure-cache';
import { CONTENT_STYLES } from './content-root.styles';
import { buildTaskCheckbox } from './content-task';
import { buildFootnoteSummary } from './content-footnote';

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

/** 段序列 → HTML 元素（复选框 + 文本 / 锚点 / 标签 / 表格 / 引用块） */
export function buildContentElement(
	doc: InlineContentDocument,
	segments: readonly InlineSegment[],
	style: Partial<Pick<CSSStyleDeclaration, 'fontSize' | 'color' | 'fontWeight'>>,
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
	params.renderer.appendSegments(doc, box, segments, params, 0);
	return box;
}
