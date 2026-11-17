/** 节点内容 mermaid：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment, type InlineContentOptions } from '../../core/node-content-types';
import { type Language, t } from '../../core/i18n';
import { MERMAID_BLOCK_CLASS, MERMAID_STYLES, MERMAID_FIGURE_STYLE, MERMAID_ANCHOR_STYLE, MERMAID_COPY_HIT_STYLE } from './content-mermaid.styles';
import { CODE_COPY_CLASS, CODE_COPY_BUTTON_STYLES } from './content-copy.styles';

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
export function buildMermaidElement(
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
