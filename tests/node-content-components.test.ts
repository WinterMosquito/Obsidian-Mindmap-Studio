/** 内容组件直测：注入窄渲染回调，验证 DOM 契约、缓存同步和递归复用。 */
import { describe, expect, it, vi } from 'vitest';
import { buildCodeBlockElement } from '../src/ui/node-content/content-code';
import { buildMathElement } from '../src/ui/node-content/content-math';
import { buildQuoteElement } from '../src/ui/node-content/content-quote';
import { buildMarkupElement } from '../src/ui/node-content/content-text';
import { buildTaskCheckbox } from '../src/ui/node-content/content-task';
import { buildFootnoteRef, buildFootnoteSummary } from '../src/ui/node-content/content-footnote';
import { buildAnchor } from '../src/ui/node-content/content-link';
import type { BuildContentParams } from '../src/ui/node-content/content-context';
import { nodeContentTones } from '../src/domain/color';
import { parseCalloutHeader } from '../src/domain/callout';
import { CODE_RENDERED_CLASS } from '../src/core/constants';
import { FakeDocument, FakeElement, asDocument } from './helpers/node-content-dom';

function fixture() {
	const fakeDoc = new FakeDocument();
	const doc = asDocument(fakeDoc);
	const append = vi.fn();
	const parse = vi.fn((raw: string) => [{ kind: 'text' as const, text: raw }]);
	const text = vi.fn((_doc: unknown, segment: { text: string }) => doc.createTextNode(segment.text));
	const params: BuildContentParams = {
		truncationTitle: null, explicitWidth: null, options: {}, lang: 'zh', owner: {}, tones: null,
		task: null, footnoteIds: null,
		renderer: { buildInlineSegments: parse, appendSegments: append, buildTextElement: text },
	};
	return { fakeDoc, doc, params, append, parse };
}

function fake(el: HTMLElement): FakeElement { return el as unknown as FakeElement; }

describe('内容组件', () => {
	it('引用和 callout 正文复用注入管线并推进同一深度；空正文不制造容器', () => {
		const h = fixture();
		const quote = fake(buildQuoteElement(h.doc, { kind: 'quote', text: '> 正文', quote: { header: null, body: '正文' } }, h.params, 1));
		expect(quote.className).toBe('mindmap-node-quote');
		expect(h.parse).toHaveBeenCalledWith('正文');
		expect(h.append.mock.calls[0]?.[4]).toBe(2);
		const header = parseCalloutHeader('[!info]- 标题');
		expect(header).not.toBeNull();
		const callout = fake(buildQuoteElement(h.doc, { kind: 'quote', text: '', quote: { header, body: '' } }, h.params, 0));
		expect(callout.className).toBe('mindmap-node-callout');
		expect(callout.getAttribute('data-callout-fold')).toBe('-');
		expect(callout.children).toHaveLength(1);
	});

	it('轻标记里的脚注等子段仍委托统一装配器，不退化成普通文本', () => {
		const h = fixture();
		const children = [{ kind: 'footnote' as const, text: '1', footnote: '1' }];
		const el = fake(buildMarkupElement(h.doc, { kind: 'text', style: 'bold', text: '正文', children }, h.params) as HTMLElement);
		expect(el.tagName).toBe('strong');
		expect(h.append).toHaveBeenCalledWith(h.doc, el, children, h.params, 0);
	});

	it('代码缓存命中同步放置 token，复制内容逐字保存，不重复发起高亮', () => {
		const h = fixture();
		const token = h.fakeDoc.createElement('span');
		const render = vi.fn();
		const raw = '  const a = 1;\n\n  return a;';
		const options = { getCachedCode: vi.fn(() => [token as unknown as Node]), renderCode: render };
		const block = fake(buildCodeBlockElement(h.doc, { kind: 'text', style: 'code', block: true, text: raw, lang: 'js' }, 'zh', options, null));
		const button = block.children[0] as FakeElement;
		const code = (block.children[1] as FakeElement).children[0] as FakeElement;
		expect(button.getAttribute('data-code')).toBe(raw);
		expect(code.children).toEqual([token]);
		expect(code.classTokens.has(CODE_RENDERED_CLASS)).toBe(true);
		expect(render).not.toHaveBeenCalled();
	});

	it('数学未命中保留同形占位并透传归属；命中缓存不启动异步渲染', () => {
		const h = fixture();
		const render = vi.fn();
		const segment = { kind: 'text' as const, style: 'math' as const, display: true, text: 'x^2' };
		const el = fake(buildMathElement(h.doc, segment, { renderMath: render }, h.params.owner));
		expect(el.textContent).toBe('$$x^2$$');
		expect(render).toHaveBeenCalledWith(h.doc, 'x^2', el, true, h.params.owner);
		const cached = h.fakeDoc.createElement('span');
		buildMathElement(h.doc, segment, { getCachedMath: () => cached as unknown as Node, renderMath: render }, h.params.owner);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('任务勾层不参与行盒，深色节点保持可读勾色且不绑定逐元素事件', () => {
		const h = fixture();
		h.params.tones = nodeContentTones('#111827');
		const el = fake(buildTaskCheckbox(h.doc, 'done', h.params));
		expect(el.getAttribute('aria-checked')).toBe('true');
		expect(el.style.color).toBe('#1f2937');
		const mark = el.children[0] as FakeElement;
		expect(mark.textContent).toBe('✓');
		expect(mark.style.position).toBe('absolute');
		expect(mark.style.pointerEvents).toBe('none');
	});

	it('脚注 id 的逗号不分割，汇总去重用换行分隔，徽标不引入 tooltip/href', () => {
		const h = fixture();
		const summary = fake(buildFootnoteSummary(h.doc, ['a,b', 'a,b', '2'], h.params));
		expect(summary.getAttribute('data-footnote-ids')).toBe('a,b\n2');
		const ref = fake(buildFootnoteRef(h.doc, { kind: 'footnote', text: 'a,b', footnote: 'a,b' }, h.params));
		const anchor = ref.children[0] as FakeElement;
		expect(anchor.getAttribute('data-footnote-id')).toBe('a,b');
		expect(anchor.getAttribute('role')).toBe('doc-noteref');
		for (const key of ['href', 'title', 'aria-label']) expect(anchor.getAttribute(key)).toBeNull();
	});

	it('锚点安全规则与未解析类名保持，着色节点使用墨色和下划线', () => {
		const h = fixture();
		h.params.tones = nodeContentTones('#89cfff');
		h.params.options.isResolvedLink = () => false;
		const internal = fake(buildAnchor(h.doc, { kind: 'link', text: '名称', link: '目录/笔记', internal: true }, h.params));
		expect(internal.className).toBe('internal-link is-unresolved');
		expect(internal.getAttribute('data-href')).toBe('目录/笔记');
		expect(internal.style.textDecoration).toBe('underline');
		const external = fake(buildAnchor(h.doc, { kind: 'link', text: '危险', link: 'javascript:alert(1)', internal: false }, h.params));
		expect(external.getAttribute('href')).toBeNull();
	});
});
