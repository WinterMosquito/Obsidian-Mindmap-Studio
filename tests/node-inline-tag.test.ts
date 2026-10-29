/**
 * 标签段（`#tag`）回归：切分口径 + pill 元素契约。
 *
 * 判定口径（唯一实现在 `node-inline-tokenize.pushTagSegments`）：
 * - 只认**顶层 prose**；代码 / 数学 / 注释 / 链接 / 轻标记内部不算；
 * - `#` 前必须是「非词字符」（`foo#bar` 不是标签）；
 * - 全数字不是标签（`#123`）；`/` 分层允许但不得结尾。
 *
 * 渲染契约：`a.tag[data-tag]`，**无 href**（不能落进链接三通道），内联样式。
 */
import { describe, expect, it } from 'vitest';
import {
	buildInlineNodeContent,
	buildInlineSegments,
} from '../src/features/node-inline-content';
import { nodeContentTones } from '../src/domain/color';
import type { MindMapNode } from '../src/core/engine-types';

// ---------------------------------------------------------------------------
// 最小 DOM 桩（只实现 node-inline-html 用到的面）
// ---------------------------------------------------------------------------

class FakeTextNode {
	constructor(readonly text: string) {}
}

class FakeElement {
	className = '';
	textContent = '';
	tagName = '';
	readonly style: Record<string, string> = {};
	readonly children: unknown[] = [];
	readonly attributes = new Map<string, string>();

	appendChild(child: unknown): unknown {
		this.children.push(child);
		return child;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
}

class FakeDocument {
	createElement(tag = ''): FakeElement {
		const el = new FakeElement();
		el.tagName = tag;
		return el;
	}

	createTextNode(text: string): FakeTextNode {
		return new FakeTextNode(text);
	}
}

describe('标签段：切分口径', () => {
	it('普通标签与分层标签', () => {
		expect(buildInlineSegments('见 #项目/子项目 与 #tag-')).toEqual([
			{ kind: 'text', text: '见 ' },
			{ kind: 'tag', text: '#项目/子项目', tag: '项目/子项目' },
			{ kind: 'text', text: ' 与 ' },
			{ kind: 'tag', text: '#tag-', tag: 'tag-' },
		]);
	});

	it('紧邻词字符不是标签', () => {
		expect(buildInlineSegments('foo#bar')).toEqual([
			{ kind: 'text', text: 'foo#bar' },
		]);
		expect(buildInlineSegments('a/#tag')).toEqual([{ kind: 'text', text: 'a/#tag' }]);
	});

	it('全数字不是标签', () => {
		expect(buildInlineSegments('#123')).toEqual([{ kind: 'text', text: '#123' }]);
		// 含非数字则成立（年份区间）
		expect(buildInlineSegments('#2024-01')).toEqual([
			{ kind: 'tag', text: '#2024-01', tag: '2024-01' },
		]);
	});

	it('括号 / 标点之后是标签', () => {
		expect(buildInlineSegments('(#tag)')).toEqual([
			{ kind: 'text', text: '(' },
			{ kind: 'tag', text: '#tag', tag: 'tag' },
			{ kind: 'text', text: ')' },
		]);
	});

	it('保护区内的 # 不算：行内码 / 链接 / 注释', () => {
		expect(buildInlineSegments('`#tag`')).toEqual([
			{ kind: 'text', text: '#tag', style: 'code' },
		]);
		// 子路径保留在显示名里（`笔记#标题`），整段是一个链接段、不是标签
		expect(buildInlineSegments('[[笔记#标题]]')).toEqual([
			{ kind: 'link', text: '笔记#标题', link: '笔记#标题', internal: true },
		]);
		// 注释整段隐藏（含配色指令同族语法）
		expect(buildInlineSegments('%%#tag%%')).toEqual([]);
	});

	it('轻标记内部不识别（有意，与配色指令同口径）', () => {
		expect(buildInlineSegments('**#tag**')).toEqual([
			{ kind: 'text', text: '#tag', style: 'bold' },
		]);
	});

	it('同一行多枚标签按序切分', () => {
		expect(buildInlineSegments('#a #b')).toEqual([
			{ kind: 'tag', text: '#a', tag: 'a' },
			{ kind: 'text', text: ' ' },
			{ kind: 'tag', text: '#b', tag: 'b' },
		]);
	});
});

describe('标签段：pill 渲染契约', () => {
	it('产出 a.tag[data-tag]，文本带 #，且没有 href', () => {
		const node = {
			getData: () => ({
				text: '见 #项目',
				mdRaw: '见 #项目',
				mdDerivedText: '见 #项目',
			}),
		} as unknown as MindMapNode;
		const el = buildInlineNodeContent(
			node,
			new FakeDocument() as unknown as Document,
			{},
			'zh',
		)! as unknown as FakeElement;
		const tag = el.children.find(
			(child) => (child as FakeElement).tagName === 'a',
		) as FakeElement;
		expect(tag).toBeDefined();
		expect(tag.className).toBe('tag');
		expect(tag.getAttribute('data-tag')).toBe('项目');
		expect(tag.textContent).toBe('#项目');
		// 无 href：既有 ANCHOR_SELECTOR（含 a[href]）不会命中它
		expect(tag.getAttribute('href')).toBeNull();
		// 内联样式（导出图不含 styles.css）；配色与内链同源（2026-10-28 裁决）
		expect(tag.style.color).toContain('var(--link-color');
		expect(tag.style.backgroundColor).toContain('color-mix');
		expect(tag.style.backgroundColor).toContain('var(--link-color');
	});

	it('着色节点：pill 用派生墨色 / chip（不跟主题链接色）', () => {
		const node = {
			getData: () => ({
				text: '#项目',
				mdRaw: '#项目',
				mdDerivedText: '#项目',
				fillColor: '#89CFF0',
			}),
		} as unknown as MindMapNode;
		const el = buildInlineNodeContent(
			node,
			new FakeDocument() as unknown as Document,
			{},
			'zh',
		)! as unknown as FakeElement;
		const tag = el.children.find(
			(child) => (child as FakeElement).tagName === 'a',
		) as FakeElement;
		const tones = nodeContentTones('#89CFF0');
		expect(tag.style.color).toBe(tones.ink);
		expect(tag.style.backgroundColor).toBe(tones.chip);
	});
});
