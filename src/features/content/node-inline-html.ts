/**
 * 节点内容渲染适配：接管/截断/节点外观读取与唯一段分派。
 * 各类 DOM 与内联样式内聚于 ui/node-content；语法解析仍在 node-inline-tokenize。
 * UI 通过窄回调递归本管线，保持段顺序、缓存、测量和导出输出（K209）。
 */
import { normalizeHexColor, nodeContentTones, type NodeContentTones } from '../../domain/color';
import { t, type Language } from '../../core/i18n';
import type { MindMapNode } from '../../core/engine-types';
import type { NodeContentStyle } from '../../engine/mindmap';
import { MAX_INLINE_CONTENT_CHARS, buildInlineSegments, clampSegments, isMermaidFence, resolveSelfDrawSource, taskStateOf } from './node-inline-tokenize';
import type { InlineContentDocument, InlineContentOptions, InlineSegment } from '../../core/node-content-types';
import { type InlineContentRenderer, type BuildContentParams } from '../../ui/node-content/content-context';
import { buildContentElement } from '../../ui/node-content/content-root';
import { buildTableElement } from '../../ui/node-content/content-table';
import { buildTagElement } from '../../ui/node-content/content-tag';
import { buildFootnoteRef } from '../../ui/node-content/content-footnote';
import { MAX_QUOTE_DEPTH } from '../../ui/node-content/content-quote.styles';
import { buildQuoteElement } from '../../ui/node-content/content-quote';
import { buildAnchor } from '../../ui/node-content/content-link';
import { buildMathElement } from '../../ui/node-content/content-math';
import { buildMermaidElement } from '../../ui/node-content/content-mermaid';
import { buildCodeBlockElement } from '../../ui/node-content/content-code';
import { buildMarkupElement } from '../../ui/node-content/content-text';

export { NODE_INLINE_CONTENT_CLASS } from '../../core/constants';
export { NODE_TASK_CLASS } from '../../ui/node-content/content-task.styles';
export { FOOTNOTE_REF_CLASS } from '../../ui/node-content/content-footnote.styles';
export { FOOTNOTE_ID_ATTR } from '../../ui/node-content/content-footnote.styles';
export { FOOTNOTE_SUMMARY_CLASS } from '../../ui/node-content/content-footnote.styles';
export { FOOTNOTE_IDS_ATTR } from '../../ui/node-content/content-footnote.styles';
export { CODE_BLOCK_CLASS } from '../../ui/node-content/content-code.styles';
export { MERMAID_BLOCK_CLASS } from '../../ui/node-content/content-mermaid.styles';
export { CODE_COPY_CLASS } from '../../ui/node-content/content-copy.styles';
export { QUOTE_BLOCK_CLASS } from '../../ui/node-content/content-quote.styles';
export { CALLOUT_BLOCK_CLASS } from '../../ui/node-content/content-quote.styles';

const contentRenderer: InlineContentRenderer = { buildInlineSegments, appendSegments, buildTextElement };

/**
 * 构建自绘内容所需的 document 最小面（**刻意不声明为整份 `Document`**）。
 *
 * 两个理由：
 * - 本模块（及其依赖的 `node-inline-tokenize`）必须能在**无 Obsidian 运行时**的
 *   页面里跑（`scripts/verify-visual.mjs` 打包入口 `features/content/node-inline-content.ts`
 *   做无头验证），故不走 `doc.win.createDiv()` 一族 Obsidian DOM
 *   助手——那要求验证页复刻一整套助手垫片，垫片与官方实现的分叉本身是新的风险面；
 * - 窄接口把「依赖了 document 的哪几个工厂」钉在类型上（新增依赖必须改类型），
 *   与引擎层 `mindmap.ts` 用原生 `createElementNS` 构建 SVG 的口径一致。
 *
 * 调用方（引擎钩子）传真实 `document`（画布所在文档），结构类型自动匹配。
 */

/**
 * 节点内联内容渲染器（引擎 `customCreateNodeContent` 钩子，返回 null 即不接管）。
 *
 * `doc` 必须是**画布所在 document**（popout 场景由引擎层传 `el.ownerDocument`）；
 * `lang` 用于截断提示文案（省略时按 zh，与插件默认语言一致）；
 * `options` 注入外部解析（未解析链接弱化，见 InlineContentOptions）；
 * `owner` = 构建该内容的引擎实例（不透明 token，见 `renderMath` 的说明——
 * 本模块只做透传，不解释；省略时为 null = 无归属）。
 */
export function buildInlineNodeContent(
	node: MindMapNode,
	doc: InlineContentDocument,
	style: NodeContentStyle = {},
	lang: Language = 'zh',
	options: InlineContentOptions = {},
	owner: object | null = null,
): HTMLElement | null {
	const source = resolveSelfDrawSource(node);
	if (!source) {
		return null;
	}
	const { segments, overlong } = source;
	// 超限判定按原文长度，标记按**实际丢弃**（clamped.truncated）——两者可能不同
	// （见 clampSegments）
	const clamped = overlong
		? clampSegments(segments, MAX_INLINE_CONTENT_CHARS)
		: { segments, truncated: false };
	return buildContentElement(
		doc,
		clamped.segments,
		style,
		{
			renderer: contentRenderer,
		truncationTitle: clamped.truncated
				? t(lang, 'nodeTextTruncated')
				: null,
			// 用户拖过左右边框时按引擎写入的宽度渲染（未拖过 → null → 500 折行上限）
			explicitWidth: customTextWidthOf(node),
			// 节点级配色（`%%#hex%%`）：着色节点内所有「轻渲染」都从这份派生色取，
			// 未着色节点为 null（样式与改动前逐字一致）
			tones: readNodeTones(node),
			// 任务状态：图片节点在 resolveSelfDrawSource 已被挡掉（裁决 4）
			task: taskStateOf(node.getData?.() as Record<string, unknown> | null),
			// 纯定义节点：渲染汇总 chip（非纯定义节点为 null，定义行已被剥离）
			footnoteIds: source.footnoteIds ?? null,
			options,
			lang,
			owner,
		},
	);
}

/**
 * 任意一段行内原文 → 内容元素（**复用同一套段管线**）。
 *
 * 消费方：脚注悬浮预览（`features/content/view-footnote`）——预览里的粗体 / 链接 / 行内码 /
 * 表格与节点正文逐字同源，不另写一份「简易渲染」。与 `buildInlineNodeContent` 的
 * 差别只有输入形态（原文而非节点）与缺省项：不截断、无拖宽、无节点色、无任务框。
 *
 * `options` 建议只注入**同步**通道（`getCachedMath` / `getCachedCode`）：浮层不在
 * 引擎节点内，异步定稿的重测会落空（content-remeasure 按 holder 反查节点）。
 */
export function buildInlineTextContent(
	doc: InlineContentDocument,
	raw: string,
	lang: Language = 'zh',
	options: InlineContentOptions = {},
): HTMLElement {
	return buildContentElement(doc, buildInlineSegments(raw), {}, {
		renderer: contentRenderer,
		truncationTitle: null,
		explicitWidth: null,
		tones: null,
		task: null,
		// 预览喂的是**定义正文**（已剥标记），不可能再有纯定义节点
		footnoteIds: null,
		options,
		lang,
		owner: null,
	});
}

/**
 * 引擎「拖动左右边框改节点宽度」写入的换行宽度（content px），未拖过时为 null。
 *
 * 引擎侧事实（vendor `simple-mind-map.cjs` 实测）：
 * - 只有 `isUseCustomNodeContent && customCreateNodeContent`（= 本插件自绘节点）
 *   才会出现这两个 `ew-resize` 手柄（`checkEnableDragModifyNodeWidth`）——正是本
 *   模块要响应的那个「边框」；
 * - 拖拽中每帧写 **节点实例字段** `node.customTextWidth` 后调
 *   `node.reRender([], { ignoreUpdateCustomTextWidth: true })`；松手时才
 *   `setData({ customTextWidth })` 落进 data（引擎自己的富文本节点据此把宽度
 *   写到元素上：`c.style.maxWidth = 宽; c.style.width = 宽 + "px"`）。
 * 故两处都要读：拖拽中靠活值、重渲染后靠 data。
 *
 * 口径＝**节点框总宽**（自绘元素的 border-box 宽）：引擎给自绘节点取的拖拽起点
 * 正是 `node.width`（元素实测总宽，`dragHandleMousedownCustomTextWidth`），按总宽
 * 映射才能让拖动与光标 1:1、起手不跳变；文字可用宽 = 该值 − 左右 padding。
 */
function customTextWidthOf(node: MindMapNode): number | null {
	const live = (node as unknown as { customTextWidth?: unknown })
		.customTextWidth;
	const data = node.getData?.() as Record<string, unknown> | null | undefined;
	for (const value of [live, data?.['customTextWidth']]) {
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return null;
}

/**
 * 节点的派生内容色：**只认 `data.fillColor`**（`engine/mindmap-colors` 写入的
 * 派生填充）。未着色节点（无 fillColor / 非合法 hex）返回 null ⇒ 沿用原主题样式。
 *
 * B 方案（2026-10-29）下 `fillColor` 已是**主色混白的浅档**，不是指令里那个 hex
 * ——因此这里派生出的墨色 / chip / 网格线都按「浅底」算，与节点实际的显示底色一致。
 *
 * 注意不读 `data.color`：那是引擎要用的文字色，和这里的墨色同源但用途不同；
 * 内容层需要的是整套（墨色 + 码块阶 + 网格线）。
 */
function readNodeTones(node: MindMapNode): NodeContentTones | null {
	const data = node.getData?.() as Record<string, unknown> | null | undefined;
	const fill = typeof data?.['fillColor'] === 'string' ? data['fillColor'] : '';
	const hex = normalizeHexColor(fill);
	return hex ? nodeContentTones(hex) : null;
}

/**
 * 段序列 → **已有容器的子节点**（文本 / 锚点 / 标签 / 表格 / 引用块）。
 *
 * 从 `buildContentElement` 的循环里抽出来（2026-11-11）：标注正文、引用块正文
 * 都要把**同一套段管线**再跑一遍（`buildInlineSegments(body)` → 本函数），抽出来
 * 才能复用——否则「标注里的表格 / 代码块 / 链接」就得各写一份。
 *
 * `depth` = 当前所处的引用块层级（最外层 0）。超过 `MAX_QUOTE_DEPTH` 的嵌套不再
 * 建盒子、按字面铺开（见该常量）。
 */
function appendSegments(
	doc: InlineContentDocument,
	parent: HTMLElement,
	segments: readonly InlineSegment[],
	params: BuildContentParams,
	depth: number,
): void {
	for (const segment of segments) {
		if (segment.kind === 'table') {
			parent.appendChild(buildTableElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'text') {
			parent.appendChild(buildTextElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'tag') {
			parent.appendChild(buildTagElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'footnote') {
			parent.appendChild(buildFootnoteRef(doc, segment, params));
			continue;
		}
		if (segment.kind === 'quote') {
			parent.appendChild(
				depth < MAX_QUOTE_DEPTH
					? buildQuoteElement(doc, segment, params, depth)
					: // 超深嵌套：原文（含 `>` 前缀）按字面铺开，内容不丢
						doc.createTextNode(segment.text),
			);
			continue;
		}
		parent.appendChild(buildAnchor(doc, segment, params));
	}
}

// 注：引用 / 标注的样式表与正文容器变体表集中在上方常量区（`QUOTE_CONTENT_VARIANTS`），
// 装配函数区只留构建逻辑。

/**
 * 文本段 → 节点：无样式 = 纯文本；带轻标记时包一层语义元素（视觉增强，
 * 不影响回写）。`children` 存在时递归构建内层（一层嵌套，见 MAX_MARKUP_DEPTH）；
 * `math` 样式走 `buildMathElement`（字面占位 + 注入的异步 MathJax 渲染）；
 * `code + block` 走 `buildCodeBlockElement`（块级代码块 + 复制按钮 + Prism 高亮）。
 */
function buildTextElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): Node {
	if (segment.style === 'math') {
		return buildMathElement(doc, segment, params.options, params.owner);
	}
	if (segment.style === 'code' && segment.block === true) {
		// mermaid 围栏优先走图通道；画不了（语法错误 / 未注册类型 / 超限）时
		// **静默回落**到下面的代码块——源码仍然完整可见可编辑
		if (isMermaidFence(segment)) {
			const mermaid = buildMermaidElement(
				doc,
				segment,
				params.options,
				params.lang,
			);
			if (mermaid) {
				return mermaid;
			}
		}
		return buildCodeBlockElement(
			doc,
			segment,
			params.lang,
			params.options,
			params.tones,
		);
	}
	return buildMarkupElement(doc, segment, params);
}
