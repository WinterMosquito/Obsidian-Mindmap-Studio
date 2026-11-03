/**
 * 概要的**数据落地**回归（`engine/mindmap-summaries`）。
 *
 * 四条契约：
 * 1. Markdown 是唯一真相：父节点的 `generalization` 数组一律由子节点的 `%%sum%%`
 *    重算，`range` 是**兄弟下标闭区间**；
 * 2. `uid` 按文档序分配（`sum-1`…）：同一棵树两次同步得到同一组 uid，不抖动；
 * 3. 没有概要时**删除该键**（不留空数组），没变化时返回 false（调用方据此避免
 *    无意义的补渲染）；
 * 4. 规划（越界夹取 / 重叠丢弃）完全由 `domain/summary` 决定，本模块不另判。
 */
import { describe, expect, it, vi } from 'vitest';
import {
	applySummariesToTree,
	applySummaryPlan,
	generalizationsOf,
	syncLiveSummaries,
} from '../src/engine/mindmap-summaries';
import type { MindMapTreeNode } from '../src/core/engine-types';

/** 渲染根（`getRenderRoot` 是唯一入口：本文件只验证读取面，不碰真实引擎） */
const roots = vi.hoisted((): { current: unknown } => ({ current: null }));
vi.mock('../src/engine/mindmap-nodes', () => ({
	getRenderRoot: () => roots.current,
}));

const KEY = 'generalization';

/** 节点：`sum` 是它自己声明的概要（写在正文里的那一段） */
function node(
	text: string,
	sum?: { count: number; text: string }[],
): MindMapTreeNode {
	const data: Record<string, unknown> = { text, mdRaw: text };
	if (sum?.length) {
		data.mdRaw = `${text}\n${sum
			.map((entry) => `%%sum:${entry.count} | ${entry.text}%%`)
			.join('\n')}`;
	}
	return { data, children: [] };
}

/** 父节点 + 它的子节点 */
function parent(children: MindMapTreeNode[]): MindMapTreeNode {
	return { data: { text: '父', mdRaw: '父' }, children };
}

/** 引擎节点桩：`getData()` 返回活引用，`children` 即子树 */
function engineNode(data: Record<string, unknown>, children: unknown[] = []): unknown {
	return {
		getData: (key?: string) => (key ? data[key] : data),
		children,
		parent: null,
		isRoot: false,
		setData: () => undefined,
		active: () => undefined,
		uid: `u${Math.random()}`,
	};
}

describe('规划 → 引擎条目', () => {
	it('range 是闭区间，uid 按序分配', () => {
		expect(
			generalizationsOf(
				[
					{ start: 0, end: 1, text: '甲' },
					{ start: 3, end: 3, text: '乙' },
				],
				1,
			),
		).toEqual([
			{ uid: 'sum-1', text: '甲', range: [0, 1] },
			{ uid: 'sum-2', text: '乙', range: [3, 3] },
		]);
		// 起编号可续着上一位父节点的分配往下排（文档内唯一）
		expect(generalizationsOf([{ start: 2, end: 2, text: '丙' }], 7)[0]?.uid).toBe(
			'sum-7',
		);
	});
});

describe('applySummaryPlan', () => {
	it('写入 / 等价不重写 / 空删除键', () => {
		const data: Record<string, unknown> = {};
		expect(
			applySummaryPlan(data, [{ uid: 'sum-1', text: '甲', range: [0, 1] }]),
		).toBe(true);
		expect(data[KEY]).toEqual([{ uid: 'sum-1', text: '甲', range: [0, 1] }]);

		// 同样的内容再来一次：不重写（调用方据此不补渲染）
		expect(
			applySummaryPlan(data, [{ uid: 'sum-1', text: '甲', range: [0, 1] }]),
		).toBe(false);

		// 空规划 = 删除该键（不留空数组：引擎对两者的处理等价，留着只是多一份状态）
		expect(applySummaryPlan(data, [])).toBe(true);
		expect(KEY in data).toBe(false);
		expect(applySummaryPlan(data, [])).toBe(false);
	});

	it('内容变了才是变（文字 / 范围 / uid）', () => {
		const data: Record<string, unknown> = {
			[KEY]: [{ uid: 'sum-1', text: '甲', range: [0, 1] }],
		};
		expect(
			applySummaryPlan(data, [{ uid: 'sum-1', text: '乙', range: [0, 1] }]),
		).toBe(true);
		expect(
			applySummaryPlan(data, [{ uid: 'sum-1', text: '乙', range: [0, 2] }]),
		).toBe(true);
		expect(
			applySummaryPlan(data, [{ uid: 'sum-2', text: '乙', range: [0, 2] }]),
		).toBe(true);
	});
});

describe('applySummariesToTree（建引擎前）', () => {
	it('父节点按子节点的 sum 段生成 generalization', () => {
		const tree = parent([node('甲', [{ count: 2, text: '核心' }]), node('乙'), node('丙')]);
		applySummariesToTree(tree);
		expect((tree.data as Record<string, unknown>)[KEY]).toEqual([
			{ uid: 'sum-1', text: '核心', range: [0, 1] },
		]);
		// 声明者自己（甲）不写 generalization：概要在引擎里挂在**父节点**上
		expect((tree.children[0]!.data as Record<string, unknown>)[KEY]).toBeUndefined();
	});

	it('多个父节点：uid 文档内唯一且不重复', () => {
		const tree = parent([
			parent([node('甲', [{ count: 2, text: 'a' }]), node('乙')]),
			parent([node('丙', [{ count: 2, text: 'b' }]), node('丁')]),
		]);
		applySummariesToTree(tree);
		const first = (tree.children[0]!.data as Record<string, unknown>)[KEY] as {
			uid: string;
		}[];
		const second = (tree.children[1]!.data as Record<string, unknown>)[KEY] as {
			uid: string;
		}[];
		expect(first[0]?.uid).not.toBe(second[0]?.uid);
	});

	it('没有概要时不产生该键（普通文档零改动）', () => {
		const tree = parent([node('甲'), node('乙')]);
		applySummariesToTree(tree);
		expect(KEY in (tree.data as Record<string, unknown>)).toBe(false);
	});

	it('叶节点上的 generalization 会被清掉（正文删掉概要之后）', () => {
		const leaf = node('甲');
		(leaf.data as Record<string, unknown>)[KEY] = [
			{ uid: 'sum-1', text: '旧', range: [0, 0] },
		];
		applySummariesToTree(parent([leaf]));
		expect(KEY in (leaf.data as Record<string, unknown>)).toBe(false);
	});
});

describe('syncLiveSummaries（渲染后）', () => {
	it('从引擎树重算；没变化返回 false', () => {
		const child = engineNode({
			text: '甲',
			mdRaw: '甲\n%%sum:2 | 核心%%',
		});
		const sibling = engineNode({ text: '乙', mdRaw: '乙' });
		const parentData: Record<string, unknown> = { text: '父', mdRaw: '父' };
		const root = engineNode(parentData, [child, sibling]);
		roots.current = root;

		expect(syncLiveSummaries({} as never)).toBe(true);
		expect(parentData[KEY]).toEqual([
			{ uid: 'sum-1', text: '核心', range: [0, 1] },
		]);

		// 第二轮：树没变 ⇒ 不再判为变过（补渲染到此为止，不会自激）
		expect(syncLiveSummaries({} as never)).toBe(false);
	});

	it('根节点没有渲染根时安全返回 false', () => {
		roots.current = null;
		expect(syncLiveSummaries({} as never)).toBe(false);
	});
});
