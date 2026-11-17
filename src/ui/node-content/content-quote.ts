/** 节点内容 quote：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams, type InlineContentRenderer } from './content-context';
import { type CalloutHeader, calloutVisualOf, type CalloutVisual } from '../../domain/callout';
import { CALLOUT_BLOCK_CLASS, CALLOUT_BOX_STYLES, QUOTE_BLOCK_CLASS, QUOTE_BOX_STYLES, type QuoteVariant, QUOTE_CONTENT_VARIANTS, CALLOUT_TITLE_STYLES, CALLOUT_ICON_STYLES, CALLOUT_TITLE_INNER_STYLES, CALLOUT_FOLD_STYLES } from './content-quote.styles';
import { withDerivedBorder } from './content-common.styles';

/**
 * 引用块段 → 盒子（`kind: 'quote'`）：首行是 `[!type]` 头部时画**标注**，否则画
 * **普通引用**。两者共用一个段型与一次扫描（`scanQuoteBlocks`），差别只在装饰，
 * 故这里只做**分派**——外观在两条 shell 里、正文在 `appendQuoteBody` 里。
 *
 * 结构（标注）：
 * ```
 * div.mindmap-node-callout[data-callout=info][data-callout-type=info][data-callout-fold=-]
 *   └ div.mindmap-node-callout-title      ← 行内样式，颜色 = 类型色
 *       ├ span.mindmap-node-callout-icon  ← 注入的宿主图标（缺失则整段省略）
 *       ├ span.mindmap-node-callout-title-inner
 *       └ span.mindmap-node-callout-fold  ← 纯装饰，不绑事件
 *   └ div.mindmap-node-callout-content    ← 正文：递归同一套段管线
 * ```
 *
 * 两条跨函数口径：
 * - **正文递归**：`params.renderer.buildInlineSegments(body)` 再跑一遍本模块，围栏块 / 表格 /
 *   数学 / 链接 / 更深的引用块因此自动成立（段序列缓存按内层原文寻址，命中即复用）；
 * - **空正文不建容器**（title-only 标注）：连元素都不建，不留空盒子。
 */
export function buildQuoteElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
	depth: number,
): HTMLElement {
	const quote = segment.quote;
	const header = quote?.header ?? null;
	const body = quote?.body ?? '';
	if (header === null) {
		const box = buildPlainQuoteShell(doc);
		appendQuoteBody(doc, box, body, params, depth, 'quote');
		return box;
	}
	const box = buildCalloutShell(doc, params, header, depth);
	appendQuoteBody(doc, box, body, params, depth, 'callout');
	return box;
}

/**
 * 标注外壳：盒 + 标题行（正文由 `appendQuoteBody` 追加）。
 *
 * 颜色 / 图标**只查一次表**（`calloutVisualOf`）后往下传：标题行与底色同用一份
 * `visual.color`，不再各自回查类型表。
 *
 * 着色节点（`params.tones`）只加一条**派生边框**：类型色 10% 的底在彩色节点上
 * 几乎看不出来，而主题灰框在彩色底上对比仅 1.2（与代码块 / 表格同一条修复）。
 * 标题色仍是类型色——不换成墨色，否则标注的类型语义就丢了；正文继承节点墨色，
 * 可读性不受影响。
 */
function buildCalloutShell(
	doc: InlineContentDocument,
	params: BuildContentParams,
	header: CalloutHeader,
	depth: number,
): HTMLElement {
	const box = doc.createElement('div');
	box.className = CALLOUT_BLOCK_CLASS;
	// `data-callout` 是官方 `.callout[data-callout=…]` 的键（探针与调试选择器按它定位，
	// 值 = 规范类型）；`data-callout-type` 保留**归一后的原文**（`custom-question-type`
	// 之类）——两个属性合起来才能区分"别名写法"与"自定义类型"，这也是调试时唯一能
	// 从 DOM 直接读到原文的地方（`text` / `mdRaw` 不在 DOM 里）
	box.setAttribute('data-callout', header.canonical);
	box.setAttribute('data-callout-type', header.type);
	if (header.fold) {
		box.setAttribute('data-callout-fold', header.fold);
	}
	const visual = calloutVisualOf(header.canonical);
	Object.assign(box.style, withDerivedBorder(CALLOUT_BOX_STYLES, params.tones));
	// 与宿主 `.callout` 同款：`color-mix(in oklch, 类型色 10%, transparent)`
	box.style.backgroundColor = `color-mix(in oklch, ${visual.color} 10%, transparent)`;
	box.appendChild(buildCalloutTitle(doc, params, header, visual, depth));
	return box;
}

/**
 * 普通引用外壳：只有左竖线与弱化文字（宿主 blockquote 的观感，无标题行）。
 *
 * 颜色走 `--blockquote-*`（宿主默认 `--blockquote-color: inherit`、
 * `--blockquote-font-style: normal`，故显式写的这两条只是把宿主的**缺省**固化进
 * 内联样式，屏上与导出图取到同一份值）。
 */
function buildPlainQuoteShell(doc: InlineContentDocument): HTMLElement {
	const box = doc.createElement('div');
	box.className = QUOTE_BLOCK_CLASS;
	Object.assign(box.style, QUOTE_BOX_STYLES);
	return box;
}

/**
 * 正文容器（标注 / 引用共用）：**空正文连元素都不建**，有正文才递归段管线。
 *
 * 类名与样式按变体取表（`QUOTE_CONTENT_VARIANTS`）——不在这里按 `header` 写分支：
 * 两种外观的差异是"数据"，交给表最不容易随改动漂移。
 */
function appendQuoteBody(
	doc: InlineContentDocument,
	box: HTMLElement,
	body: string,
	params: BuildContentParams,
	depth: number,
	variant: QuoteVariant,
): void {
	if (!body) {
		return;
	}
	const spec = QUOTE_CONTENT_VARIANTS[variant];
	const content = doc.createElement('div');
	content.className = spec.className;
	Object.assign(content.style, spec.style);
	params.renderer.appendSegments(doc, content, params.renderer.buildInlineSegments(body), params, depth + 1);
	box.appendChild(content);
}

/**
 * 标注标题的段序列：宿主把标题当**行内内容**，`>` / 围栏起首只是字面字符。
 *
 * `buildInlineSegments` 是块级管线（先切引用块 / 围栏 / 表格），单行文本里唯一可能
 * 误判成块的就是**行首**的 `>` 与围栏定界符（表格要表头 + 分隔两行）。命中这两者
 * 就整段按纯文本（`textContent` 语义），与宿主一致；其余照常走段管线，链接 / 粗体 /
 * 徽标因此都能渲染（2026-11-12 实机：`> [!info] > 嵌套` 曾在标题里长出一个引用盒子）。
 */
function titleSegmentsOf(title: string, renderer: InlineContentRenderer): readonly InlineSegment[] | null {
	if (/^[ \t]{0,3}(?:>|`{3,}|~{3,})/.test(title)) {
		return null;
	}
	return renderer.buildInlineSegments(title);
}

/**
 * 标注标题行（图标 + 标题 + 折叠标记）。
 *
 * 标题文字取 `header.title`（解析期已定稿：显式标题或类型标识的 Title Case），
 * 但**仍走一遍段管线**：宿主在标题里照样渲染 `[[双链]]` / 粗体 / 行内码
 * （2026-11-12 实机对照：阅读视图是链接 + `<strong>`，节点上曾全是字面字符）。
 * 递归深度与正文同档（标题里的轻标记只有一层，不会触发引用块递归）。
 */
function buildCalloutTitle(
	doc: InlineContentDocument,
	params: BuildContentParams,
	header: CalloutHeader,
	visual: CalloutVisual,
	depth: number,
): HTMLElement {
	const titleRow = doc.createElement('div');
	titleRow.className = `${CALLOUT_BLOCK_CLASS}-title`;
	Object.assign(titleRow.style, CALLOUT_TITLE_STYLES);
	titleRow.style.color = visual.color;
	// 图标的注入面可能缺失（无头验证 / 未接线）：`?.` + `?? null` 一步到位，
	// 缺失即整段省略，不留空 span（否则标题行多出一份 gap 间距）
	const icon = params.options.resolveCalloutIcon?.(visual.icon) ?? null;
	if (icon) {
		const iconBox = doc.createElement('span');
		iconBox.className = `${CALLOUT_BLOCK_CLASS}-icon`;
		// 图标与标题同词义（读屏重复朗读一遍没有价值），且装饰性
		iconBox.setAttribute('aria-hidden', 'true');
		Object.assign(iconBox.style, CALLOUT_ICON_STYLES);
		iconBox.appendChild(icon);
		titleRow.appendChild(iconBox);
	}
	const titleText = doc.createElement('span');
	titleText.className = `${CALLOUT_BLOCK_CLASS}-title-inner`;
	Object.assign(titleText.style, CALLOUT_TITLE_INNER_STYLES);
	// 与正文同一套段管线（title 为纯文本时产出一段纯文本，等价于 textContent）
	const titleSegments = titleSegmentsOf(header.title, params.renderer);
	if (titleSegments) {
		params.renderer.appendSegments(doc, titleText, titleSegments, params, depth + 1);
	} else {
		titleText.textContent = header.title;
	}
	titleRow.appendChild(titleText);
	if (header.fold) {
		const fold = doc.createElement('span');
		fold.className = `${CALLOUT_BLOCK_CLASS}-fold`;
		fold.setAttribute('aria-hidden', 'true');
		Object.assign(fold.style, CALLOUT_FOLD_STYLES);
		// `+` 默认展开 / `-` 默认折叠：正文一律展开渲染，标记只表达"可折叠"
		fold.textContent = header.fold === '+' ? '▾' : '▸';
		titleRow.appendChild(fold);
	}
	return titleRow;
}
