/**
 * 剪贴板文本形态回归（纯逻辑直测，2026-10-13 剪贴板裁决）。
 *
 * 覆盖两侧形态契约：
 * - 粘贴侧 `parseMdOutlineFragment`：`#`（不论几级）→ 无序节点、有序项保留
 *   `ordered`、`*`/`+`/段落归一为 `-`、缩进层级照旧、frontmatter 剥除；
 * - 复制侧 `serializeSubtreesToOutline`：标题降级为 `-` 并用 2 空格缩进表达
 *   层级、有序项保留编号并按层重排、`*`/`+` 归一；
 * - **文档序列化不受影响**：`serializeMdBody` 仍按 K98 写 `#`（剪贴板形态开关
 *   必须只作用于剪贴板，否则整篇回写会被改形）；
 * - 往返：`serialize → parse` 与首次解析结构等价（复制粘贴幂等）。
 *
 * 依据：src/markdown/md-outline.ts、src/markdown/md-serialize.ts。
 */
import { describe, expect, it } from 'vitest';
import { parseMdOutlineFragment } from '../src/markdown/md-outline';
import {
	serializeMdBody,
	serializeSubtreesToOutline,
} from '../src/markdown/md-serialize';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/** 节点 data 的字符串字段（引擎 data 的索引签名是 any，取值前先收窄） */
function stringField(node: MindMapTreeNode, key: string): string {
	const value = (node.data as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : '';
}

/** 结构快照：[每层 2 空格缩进][标记][文本]，先序展开（输入树浅，直接递归） */
function outline(nodes: readonly MindMapTreeNode[], depth = 0): string[] {
	const out: string[] = [];
	for (const node of nodes) {
		out.push(
			`${'  '.repeat(depth)}${stringField(node, 'mdMarker')} ${stringField(node, 'text')}`,
		);
		out.push(...outline(node.children ?? [], depth + 1));
	}
	return out;
}

/** 列表型节点桩（mdRaw/mdDerivedText 齐备 ⇒ 序列化走逐字回写，断言只反映形态） */
function listNode(
	text: string,
	options: { marker?: string; children?: MindMapTreeNode[] } = {},
): MindMapTreeNode {
	const data: Record<string, unknown> = {
		text,
		mdRaw: text,
		mdDerivedText: text,
		mdType: 'list',
		mdMarker: options.marker ?? '-',
	};
	return { data, children: options.children ?? [] };
}

/** 标题型节点桩（解析产物形态：mdRaw 不含 `#`，前缀由序列化器补） */
function headingNode(
	text: string,
	level: number,
	children: MindMapTreeNode[] = [],
): MindMapTreeNode {
	const data: Record<string, unknown> = {
		text,
		mdRaw: text,
		mdDerivedText: text,
		mdType: 'heading',
		mdLevel: level,
	};
	return { data, children };
}

describe('parseMdOutlineFragment（粘贴进导图的解析）', () => {
	it('标题不论几级都成为无序节点，层级由标题深度给出', () => {
		const nodes = parseMdOutlineFragment('# 一\n## 二\n### 三');
		expect(nodes).toHaveLength(1);
		const first = nodes[0]!;
		const second = first.children[0]!;
		const third = second.children[0]!;
		expect([first.data.text, second.data.text, third.data.text]).toEqual([
			'一',
			'二',
			'三',
		]);
		for (const node of [first, second, third]) {
			expect(node.data.mdType).toBeUndefined();
			expect(node.data.mdLevel).toBeUndefined();
			expect(node.data.mdMarker).toBe('-');
		}
	});

	it('有序项保留 ordered 标记（编号交回序列化侧按层重排）', () => {
		const nodes = parseMdOutlineFragment('1. 甲\n2. 乙');
		expect(nodes.map((node) => stringField(node, 'mdMarker'))).toEqual([
			'ordered',
			'ordered',
		]);
	});

	it('无序标记归一：`*` / `+` 与段落都成为 `-`', () => {
		const nodes = parseMdOutlineFragment('* 星\n+ 加\n\n段落');
		expect(outline(nodes)).toEqual(['- 星', '- 加', '- 段落']);
	});

	it('缩进层级照旧（列表嵌套 → 树层级）', () => {
		const nodes = parseMdOutlineFragment('- 父\n  - 子');
		expect(nodes[0]!.children[0]!.data.text).toBe('子');
	});

	it('frontmatter 被剥掉（从笔记整篇复制时只取大纲）', () => {
		const nodes = parseMdOutlineFragment('---\nMindmap: Mindmap\n---\n- 甲');
		expect(nodes).toHaveLength(1);
		expect(nodes[0]!.data.text).toBe('甲');
	});
});

describe('serializeSubtreesToOutline（复制出去的形态）', () => {
	it('标题降级为 `-`，层级用 2 空格缩进表达', () => {
		const out = serializeSubtreesToOutline([
			headingNode('一', 1, [headingNode('二', 2)]),
		]);
		expect(out).toBe('- 一\n  - 二');
	});

	it('有序项保留编号并按层重排', () => {
		expect(
			serializeSubtreesToOutline([listNode('甲', { marker: 'ordered' }), listNode('乙', { marker: 'ordered' })]),
		).toBe('1. 甲\n2. 乙');
		expect(
			serializeSubtreesToOutline([
				listNode('甲', {
					marker: 'ordered',
					children: [listNode('甲一', { marker: 'ordered' })],
				}),
			]),
		).toBe('1. 甲\n  1. 甲一');
	});

	it('`*` / `+` 归一为 `-`', () => {
		expect(serializeSubtreesToOutline([listNode('星', { marker: '*' })])).toBe(
			'- 星',
		);
		expect(serializeSubtreesToOutline([listNode('加', { marker: '+' })])).toBe(
			'- 加',
		);
	});

	it('多行段落（plain）也写成列表项，续行按 2 空格缩进', () => {
		const paragraph: MindMapTreeNode = {
			data: {
				text: '首行\n次行',
				mdRaw: '首行\n次行',
				mdDerivedText: '首行\n次行',
				mdType: 'plain',
			},
			children: [],
		};
		expect(serializeSubtreesToOutline([paragraph])).toBe('- 首行\n  次行');
	});

	it('折叠（收起）状态不参与序列化：父节点 expand=false 仍写出整棵子树', () => {
		// 用户裁决 A（2026-10-15）：折叠只是**渲染态**，复制/剪切/落盘一律按数据树写入
		const parent = headingNode('一', 1, [headingNode('二', 2)]);
		(parent.data as Record<string, unknown>).expand = false;
		expect(serializeSubtreesToOutline([parent])).toBe('- 一\n  - 二');
	});

	it('文档序列化不受影响：serializeMdBody 仍按 K98 写 `#`', () => {
		const root = {
			data: { text: '文档' },
			children: [headingNode('一', 1, [headingNode('二', 2)])],
		} as MindMapTreeNode;
		expect(serializeMdBody(root)).toBe('# 一\n\n## 二');
	});

	it('落盘形态同样忽略折叠：serializeMdBody 写出被收起节点的后代', () => {
		const collapsed = headingNode('一', 1, [headingNode('二', 2)]);
		(collapsed.data as Record<string, unknown>).expand = false;
		const root = {
			data: { text: '文档' },
			children: [collapsed],
		} as MindMapTreeNode;
		expect(serializeMdBody(root)).toBe('# 一\n\n## 二');
	});

	it('往返：serialize → parse 与首次解析结构等价（复制粘贴幂等）', () => {
		const source = '# 一\n## 一·一\n1. 一·二\n  - 缩进子';
		const first = parseMdOutlineFragment(source);
		const second = parseMdOutlineFragment(serializeSubtreesToOutline(first));
		expect(outline(second)).toEqual(outline(first));
		// 形态也确定：标题 → `-`，有序项保留编号
		expect(outline(first)).toEqual([
			'- 一',
			'  - 一·一',
			'    ordered 一·二',
			'      - 缩进子',
		]);
	});
});
