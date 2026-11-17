/** 节点内容 text：DOM/样式内聚，保持原输出与导出保真。 */
import { type InlineContentDocument, type InlineSegment } from '../../core/node-content-types';
import { type BuildContentParams } from './content-context';
import { MARKUP_TAGS, markupStyle } from './content-text.styles';

/** 纯文本与轻标记 DOM；内层段经注入的同一装配器递归，不访问解析器。 */
export function buildMarkupElement(
	doc: InlineContentDocument,
	segment: InlineSegment,
	params: BuildContentParams,
): Node {
	if (!segment.style) {
		return doc.createTextNode(segment.text);
	}
	const wrapper = doc.createElement(MARKUP_TAGS[segment.style]);
	Object.assign(wrapper.style, markupStyle(segment.style, params.tones));
	if (segment.children && segment.children.length > 0) {
		// 标记体里的子段走**同一套段管线**：脚注徽标（`**粗[^1]**`）、链接、标签
		// 都要按各自类型装配。此前一律 `buildTextElement` ⇒ 徽标退化成纯文本
		// `"1"`、点击/悬停/编号全部失效（2026-11-12 实机复现）。
		params.renderer.appendSegments(doc, wrapper, segment.children, params, 0);
		return wrapper;
	}
	wrapper.appendChild(doc.createTextNode(segment.text));
	return wrapper;
}
