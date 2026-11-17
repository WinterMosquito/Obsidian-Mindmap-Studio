/** 节点内容 table：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { withDerivedBorder } from './content-common.styles';
import { TABLE_STYLES, headerStyle, cellStyle } from './content-table.styles';
import { type PipeTableAlign } from '../../domain/pipe-table';
import { buildAnchor } from './content-link';
import { buildFootnoteRef } from './content-footnote';

/**
 * 表格段（GFM 管道表，`kind: 'table'`）：`table > thead/tbody > tr > th/td`，
 * 样式全内联（见 TABLE_* 三表），单元格内容**复用**行内段管线。
 *
 * 三条与模块其余部分共享的纪律：
 * - **同步纯 DOM**：没有「占位 → 产物」两段式，也就没有数学/代码块那套定稿重排；
 * - **零监听**：单元格里的链接仍是普通锚点，点击由 `view-wikilink` 经引擎
 *   `node_click` 命中（与节点其余部分的锚点同一契约）；
 * - **只读显示**：模型来自 `domain/pipe-table`（`\|` 已还原、列数已归一），原文
 *   仍由 `mdRaw` 逐字保真——回写路径一个字都不经过这里。
 *
 * 单元格内容走同一套段管线（`buildInlineSegments` → 文本段 / 锚点）：单元格是
 * **单行**文本 ⇒ 其中不可能再切出表格段（表格至少两行），递归在此天然终止。
 */
export function buildTableElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const table = doc.createElement('table');
	Object.assign(table.style, withDerivedBorder(TABLE_STYLES, params.tones));
	const model = segment.table;
	if (!model) {
		// 表格段的构造点唯一（必带模型）；真出现空壳时按字面兜底，不渲染空白
		table.appendChild(doc.createTextNode(segment.text));
		return table;
	}
	const head = doc.createElement('thead');
	const headRow = doc.createElement('tr');
	head.appendChild(headRow);
	table.appendChild(head);
	model.header.forEach((cell, column) => {
		const th = doc.createElement('th');
		Object.assign(th.style, headerStyle(params.tones));
		applyCellAlign(th, model.align[column] ?? null);
		appendCellContent(doc, th, cell, params);
		headRow.appendChild(th);
	});
	if (model.rows.length > 0) {
		const body = doc.createElement('tbody');
		table.appendChild(body);
		for (const row of model.rows) {
			const tr = doc.createElement('tr');
			body.appendChild(tr);
			row.forEach((cell, column) => {
				const td = doc.createElement('td');
				Object.assign(td.style, cellStyle(params.tones));
				applyCellAlign(td, model.align[column] ?? null);
				appendCellContent(doc, td, cell, params);
				tr.appendChild(td);
			});
		}
	}
	return table;
}

/**
 * 列对齐 → 内联样式；`null`（分隔行未指定）**不写**，交给宿主与浏览器默认。
 *
 * 为什么 `null` 保持沉默：官方样式包里没有 `th { text-align }` 规则（`resources/*.asar`
 * 实测零命中），阅读视图的表头因此走浏览器 UA 默认（**居中**）——写死 `left` 反而
 * 会与阅读视图分叉。指定了对齐（`:---` / `---:` / `:---:`）才写内联样式。
 */
function applyCellAlign(cell: HTMLElement, align: PipeTableAlign | null): void {
	if (align !== null) {
		cell.style.textAlign = align;
	}
}

/**
 * 单元格内容 → 行内段（轻标记 / 链接 / 数学 / 行内码），与节点其余部分同一套
 * token 口径（`tokenizeInline` + `tokenDisplay`），故单元格里的双链同样可点。
 */
function appendCellContent(
	doc: InlineContentDocument,
	cell: HTMLElement,
	text: string,
	params: BuildContentParams,
): void {
	for (const segment of params.renderer.buildInlineSegments(text)) {
		if (segment.kind === 'link') {
			cell.appendChild(buildAnchor(doc, segment, params));
			continue;
		}
		if (segment.kind === 'text') {
			cell.appendChild(params.renderer.buildTextElement(doc, segment, params));
			continue;
		}
		if (segment.kind === 'footnote') {
			// 单元格里同样是可命中徽标（`[data-footnote-id]`），与节点正文同权
			cell.appendChild(buildFootnoteRef(doc, segment, params));
			continue;
		}
		// 引用块段**可达**（单元格文本以 `>` 起首时）：单元格内不建盒子（单行引用
		// 没有块结构可言），按**字面**铺开而不是丢弃——丢弃会让那个单元格凭空少字
		if (segment.kind === 'quote') {
			cell.appendChild(doc.createTextNode(segment.text));
			continue;
		}
		// 其余段（代码 / 数学 / 表格）在单元格里**不可达**：单元格文本恒单行
		//（`splitPipeRow` 按行切）且单元格内刻意不做块级内容——此处的 `continue`
		// 是显式不变式声明（模型若放宽，孤段被跳过而不是渲染出半个单元格）
	}
}
