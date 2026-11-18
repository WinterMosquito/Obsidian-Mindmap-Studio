/** 节点内容 footnote：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { FOOTNOTE_SUMMARY_CLASS, FOOTNOTE_IDS_ATTR, FOOTNOTE_SUMMARY_STYLES, FOOTNOTE_REF_CLASS, FOOTNOTE_SUP_STYLES, FOOTNOTE_ID_ATTR, FOOTNOTE_LINK_STYLES } from './content-footnote.styles';
import { t } from '../../core/i18n';

/**
 * 纯定义节点 → 汇总 chip（`span.mindmap-node-footnote-summary[data-footnote-ids]`）。
 *
 * 文案只报条数（`脚注 3`），不把定义正文或长 id 铺回节点——那正是要隐藏的东西。
 * 点击/悬停展开全部定义由 `features/content/view-footnote` 承接（本模块零监听）。
 */
export function buildFootnoteSummary(
	doc: InlineContentDocument,
	ids: readonly string[],
	params: BuildContentParams,
): HTMLElement {
	// 去重：同一 id 定义两次时索引只有「首次生效」那一条，chip 不能把同一条
	// 列两遍（实机 2026-11-11 抓到 `dup,dup` 展开后重复显示同一段正文）
	const unique = [...new Set(ids)];
	const chip = doc.createElement('span');
	chip.className = FOOTNOTE_SUMMARY_CLASS;
	chip.setAttribute(FOOTNOTE_IDS_ATTR, unique.join('\n'));
	chip.textContent = t(params.lang, 'footnote.summaryLabel');
	Object.assign(chip.style, FOOTNOTE_SUMMARY_STYLES);
	if (params.tones) {
		chip.style.color = params.tones.ink;
	}
	return chip;
}

/**
 * 脚注引用段 → 徽标（`sup.mindmap-node-footnote-ref > a[data-footnote-id]`）。
 *
 * **不在此处解析定义正文**：段序列按原文寻址缓存，正文属于文档上下文，只能在
 * 交互发生时现查（见 `InlineSegment.footnote`）。悬停预览与点击跳转都在
 * `features/content/view-footnote`，本函数只产出可命中的 DOM。
 */
export function buildFootnoteRef(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const sup = doc.createElement('sup');
	sup.className = FOOTNOTE_REF_CLASS;
	Object.assign(sup.style, FOOTNOTE_SUP_STYLES);
	const anchor = doc.createElement('a');
	const id = segment.footnote ?? segment.text;
	anchor.setAttribute(FOOTNOTE_ID_ATTR, id);
	// **刻意不写 `aria-label`、也不写 `title`**（2026-11-11 实机裁决）：Obsidian 的
	// 全局 tooltip 委托读 `[aria-label]`，鼠标停在徽标上会弹出「跳转到脚注 [^1]」
	// 黑框；`title` 又会给出浏览器原生 `[^1]` 白框。两个提示都是已知信息（数字与
	// 浮层正文），纯噪音。语义改用不触发 tooltip 的 `role`，屏幕阅读器仍能识别。
	anchor.setAttribute('role', 'doc-noteref');
	anchor.textContent = segment.text;
	Object.assign(anchor.style, FOOTNOTE_LINK_STYLES);
	if (params.tones) {
		// 着色节点：与 anchorStyle 同一规则（墨色 + 下划线形状线索，不加第五种颜色）
		sup.style.color = params.tones.ink;
		Object.assign(anchor.style, { textDecoration: 'underline' });
	}
	sup.appendChild(anchor);
	return sup;
}
