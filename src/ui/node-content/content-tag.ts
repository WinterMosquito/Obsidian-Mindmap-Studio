/** 节点内容 tag：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { TAG_STYLES } from './content-tag.styles';

/** 标签段 → pill 元素（`text` 带 `#`，`data-tag` 是不带 `#` 的名称） */
export function buildTagElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): HTMLElement {
	const el = doc.createElement('a');
	el.className = 'tag';
	el.setAttribute('data-tag', segment.tag ?? '');
	el.textContent = segment.text;
	Object.assign(el.style, TAG_STYLES);
	if (params.tones) {
		// 着色节点：pill 与行内码同族（墨色文字 + 从底色派生的 chip）
		el.style.color = params.tones.ink;
		el.style.backgroundColor = params.tones.chip;
	}
	return el;
}
