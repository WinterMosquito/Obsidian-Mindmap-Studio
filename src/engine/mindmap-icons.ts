/**
 * 节点自绘用的内联 SVG 图标：文档页图标（`[[笔记]]` 节点的自绘内容用）。
 *
 * 从 `engine/mindmap.ts` 拆出（2026-10-22，纯搬移，零行为改动）：只做
 * `createElementNS` 拼装，不接触引擎实例、不读任何引擎内部字段，故可与防腐
 * barrel 分离。`doc` 必须是**画布所在的 document**（popout 场景下全局
 * `document` 与画布文档不同，见下方函数注释）。
 */

export const WIKI_DOC_ICON_SIZE = 18;
/** 图标 viewBox 边长（路径按 24 网格绘制，缩放到 WIKI_DOC_ICON_SIZE 显示） */
const WIKI_DOC_ICON_VIEWBOX = 24;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 文档页图标（折角页 + 页脚线，feather file-text 风格） */
const WIKI_DOC_ICON_PATH =
	'M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 0v5h5M9 13h6M9 17h6';

/**
 * 构造文档页图标（`<svg>` 根元素，见上方契约说明）。
 *
 * `doc` 必须是**画布所在的 document**（调用点传 `el.ownerDocument`），
 * 不能用全局 `document`：同一视图可被拖入 popout 窗口，此时全局 document
 * 与画布所在文档并非同一个；跨文档创建再挂载的 SVG 在 popout 中不渲染、
 * 也不响应事件。元素级 API 的 `ownerDocument` 永远指向元素自己的文档，
 * 是 popout 场景下的正确来源。
 */
export function buildWikiDocIcon(
	doc: Document,
	link: string,
	title: string,
	color: string,
	onOpen: (link: string) => void,
): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('xmlns', SVG_NS);
	svg.setAttribute('width', String(WIKI_DOC_ICON_SIZE));
	svg.setAttribute('height', String(WIKI_DOC_ICON_SIZE));
	svg.setAttribute(
		'viewBox',
		`0 0 ${WIKI_DOC_ICON_VIEWBOX} ${WIKI_DOC_ICON_VIEWBOX}`,
	);
	svg.classList.add('mindmap-wiki-doc-icon');
	const path = doc.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', WIKI_DOC_ICON_PATH);
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', color);
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(path);
	// 透明命中区：扩大可点范围至整个图标方块（细线难点中）
	const hit = doc.createElementNS(SVG_NS, 'rect');
	hit.setAttribute('width', String(WIKI_DOC_ICON_VIEWBOX));
	hit.setAttribute('height', String(WIKI_DOC_ICON_VIEWBOX));
	hit.setAttribute('fill', 'transparent');
	svg.appendChild(hit);
	const tip = doc.createElementNS(SVG_NS, 'title');
	tip.textContent = title || link;
	svg.appendChild(tip);
	svg.addEventListener('click', (event) => {
		// 阻断节点选中语义：图标点击 = 打开目标
		event.stopPropagation();
		onOpen(link);
	});
	return svg;
}
