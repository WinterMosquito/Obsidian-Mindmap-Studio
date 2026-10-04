/**
 * findNodeByDom 回归：引擎节点 DOM 元素 → 渲染节点实例的身份匹配（右键命中）。
 *
 * 为什么这样断言：旧实现读取节点 DOM 上的 data-uid 属性，而 vendor 契约冒烟测试
 * （tests/vendor-contract.test.ts）证实引擎从不写入该属性，旧匹配恒失败——
 * 画布空白处的右键委托路径永远弹空白菜单。现实现改为「节点渲染 group 包含目标
 * 元素」的对象身份匹配（walkTree 先序遍历渲染树 + group.contains(el)），
 * 本文件锁定其语义：命中自身、命中内部子元素、短路、容错与边界。
 *
 * vendor cjs 以 vi.mock 桩替代真实模块：本文件只验 findNodeByDom 的匹配语义，
 * 不需要真实引擎（也避免 Node 下引擎顶层求值触碰 document）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import { findNodeByDom, resolveNodesByDoms } from '../src/engine/mindmap';

vi.mock('../vendor/simple-mind-map.cjs', () => ({
	MindMap: class {},
	MindMapNode: class {},
	DoExport: class {},
	Select: class {},
	TouchEvent: class {},
	AssociativeLine: class {},
	KeyboardNavigation: class {},
	Search: class {},
	Drag: class {},
}));

/** 最小元素桩：contains 沿 parent 链向上判定包含关系（对元素自身也返回 true） */
interface FakeEl {
	parent: FakeEl | null;
	/**
	 * `resolveNodesByDoms` 用的 DOM 标准属性（祖先链查表走它）。
	 * 缺省与 `parent` 同值；可单独构造成「祖先链断裂」来验证回落分支。
	 */
	parentElement: FakeEl | null;
	/** contains 被调用次数：用于断言「命中即终止整树遍历」与「批量反查不走全树 contains」 */
	containsCalls: number;
	contains(target: FakeEl): boolean;
}

function fakeEl(parent: FakeEl | null = null): FakeEl {
	const el: FakeEl = {
		parent,
		parentElement: parent,
		containsCalls: 0,
		contains(target: FakeEl): boolean {
			this.containsCalls++;
			let current: FakeEl | null = target;
			while (current) {
				if (current === this) {
					return true;
				}
				current = current.parent;
			}
			return false;
		},
	};
	return el;
}

/** 渲染节点桩：group 元素 + children 树（walkTree 与 getNodeGroupEl 只用这两者） */
interface FakeNode {
	group: { node: FakeEl } | { node?: undefined } | null;
	children: FakeNode[];
}

function fakeNode(
	groupEl: FakeEl | null,
	children: FakeNode[] = [],
	groupShape: 'normal' | 'no-node' = 'normal',
): FakeNode {
	if (!groupEl) {
		return { group: null, children };
	}
	return {
		group: groupShape === 'no-node' ? {} : { node: groupEl },
		children,
	};
}

function asMindMap(root: FakeNode | null): MindMap {
	return { renderer: { root: root as unknown as MindMapNode | null } } as unknown as MindMap;
}

const asEl = (el: FakeEl): Element => el as unknown as Element;
const asNode = (node: FakeNode): MindMapNode => node as unknown as MindMapNode;

describe('findNodeByDom：group 身份匹配', () => {
	// 真实引擎 DOM 形态：所有 .smm-node group 是 nodeDraw 层的兄弟节点，互不嵌套；
	// 只有节点内部子元素（图标 / 图片 / foreignObject 内容）才在 group 之内。
	it('命中节点 group 本身（closest(".smm-node") 场景）', () => {
		const rootEl = fakeEl();
		const childEl = fakeEl();
		const tree = fakeNode(rootEl, [fakeNode(childEl)]);
		const child = tree.children[0]!;

		expect(findNodeByDom(asMindMap(tree), asEl(childEl))).toBe(asNode(child));
		expect(findNodeByDom(asMindMap(tree), asEl(rootEl))).toBe(asNode(tree));
	});

	it('命中节点 group 的内部子元素（图标 / 图片等冒泡目标）', () => {
		const rootEl = fakeEl();
		const iconEl = fakeEl(rootEl); // 深层子元素，parent 链最终落到 group
		const tree = fakeNode(rootEl);

		expect(findNodeByDom(asMindMap(tree), asEl(iconEl))).toBe(asNode(tree));
	});

	it('命中深层节点（先序），且父节点不误吞子节点', () => {
		const rootEl = fakeEl();
		const midEl = fakeEl();
		const leafEl = fakeEl();
		const leaf = fakeNode(leafEl);
		const mid = fakeNode(midEl, [leaf]);
		const tree = fakeNode(rootEl, [mid]);

		expect(findNodeByDom(asMindMap(tree), asEl(leafEl))).toBe(asNode(leaf));
		expect(findNodeByDom(asMindMap(tree), asEl(midEl))).toBe(asNode(mid));
	});

	it('命中根节点后立即终止整树遍历（子节点的 contains 不再被调用）', () => {
		const rootEl = fakeEl();
		const childEl = fakeEl();
		const tree = fakeNode(rootEl, [fakeNode(childEl)]);

		// 目标即根 group：先序第一个节点就命中，visit 返回 false 短路
		expect(findNodeByDom(asMindMap(tree), asEl(rootEl))).toBe(asNode(tree));
		expect(tree.children[0]!.group!.node!.containsCalls).toBe(0);
	});

	it('无匹配返回 null', () => {
		const tree = fakeNode(fakeEl());

		expect(findNodeByDom(asMindMap(tree), asEl(fakeEl()))).toBeNull();
	});

	it('group 缺失 / group.node 缺失的节点被跳过，不阻断后续遍历', () => {
		const childEl = fakeEl();
		const tree = fakeNode(fakeEl(), [
			fakeNode(null), // group 为 null
			fakeNode(childEl, [], 'no-node'), // group 存在但 node 缺失
			fakeNode(childEl),
		]);
		const hitNode = tree.children[2]!;

		expect(findNodeByDom(asMindMap(tree), asEl(childEl))).toBe(asNode(hitNode));
	});

	it('引擎 / 渲染树 / 根节点不可用时返回 null', () => {
		const el = asEl(fakeEl());

		expect(findNodeByDom(null, el)).toBeNull();
		expect(findNodeByDom({ renderer: null } as unknown as MindMap, el)).toBeNull();
		expect(findNodeByDom(asMindMap(null), el)).toBeNull();
	});
});

/**
 * `resolveNodesByDoms`（批量反查）：一次遍历 + 祖先链查表。
 *
 * 与上面 `findNodeByDom` 组的区别有两处，都是本组要锁死的契约：
 * ① **逐位置对应** —— `els[i]` 的结果在 `[i]`，不去重、不改长度。调用方
 *    （`view.flushMathRemeasure`）要靠「哪几个落空」决定是否走延后重试，
 *    一旦去重或压缩就会把落空项吞掉。
 * ② **全命中时不触达 `contains`** —— 这是复杂度改进本身的可观测证据：
 *    祖先链查表不调 `contains`，故「全部命中」时各 group 的 `containsCalls`
 *    恒为 0，而逐个 `findNodeByDom` 必然是 O(元素数 × 节点数) 次调用。
 */
describe('resolveNodesByDoms：批量反查（逐位置 + 祖先链查表）', () => {
	/** 树：root → mid → leaf，各自有 group；返回节点与 group 便于断言 */
	function tree3() {
		const leafEl = fakeEl();
		const midEl = fakeEl();
		const rootEl = fakeEl();
		const leaf = fakeNode(leafEl);
		const mid = fakeNode(midEl, [leaf]);
		const tree = fakeNode(rootEl, [mid]);
		return { tree, rootEl, midEl, leafEl, leafNode: leaf, midNode: mid };
	}

	it('逐位置对应：同批不同节点的元素各自命中，顺序稳定', () => {
		const { tree, rootEl, midEl, leafEl, leafNode, midNode } = tree3();

		expect(
			resolveNodesByDoms(asMindMap(tree), [
				asEl(leafEl),
				asEl(rootEl),
				asEl(midEl),
			]),
		).toEqual([asNode(leafNode), asNode(tree), asNode(midNode)]);
	});

	it('重复元素不产生重复输出位（逐位置语义 ≠ 去重语义）', () => {
		const { tree, leafEl, leafNode } = tree3();

		// 两个位置都命中同一节点——结果数组仍是 2 项（不是 1 项）
		expect(
			resolveNodesByDoms(asMindMap(tree), [asEl(leafEl), asEl(leafEl)]),
		).toEqual([asNode(leafNode), asNode(leafNode)]);
	});

	it('命中 group 自身与深层子元素（祖先链含自身）', () => {
		const { tree, rootEl, leafEl, leafNode } = tree3();
		// 深层子元素：parentElement 链一路向上到 rootEl
		const deep = fakeEl(fakeEl(fakeEl(rootEl)));

		expect(resolveNodesByDoms(asMindMap(tree), [asEl(rootEl)])[0]).toBe(
			asNode(tree),
		);
		expect(resolveNodesByDoms(asMindMap(tree), [asEl(leafEl)])[0]).toBe(
			asNode(leafNode),
		);
		expect(resolveNodesByDoms(asMindMap(tree), [asEl(deep)])[0]).toBe(
			asNode(tree),
		);
	});

	it('未命中的元素给出 null，且不阻断同批其它元素', () => {
		const { tree, leafEl, leafNode } = tree3();
		const orphan = fakeEl(); // 不在任何 group 祖先链上

		const out = resolveNodesByDoms(asMindMap(tree), [
			asEl(orphan),
			asEl(leafEl),
		]);
		expect(out).toEqual([null, asNode(leafNode)]);
	});

	it('祖先链断裂但 group.contains 命中 → 回落 findNodeByDom 仍能反查（建表后树变动的兜底）', () => {
		const { tree, leafEl, leafNode } = tree3();
		// 模拟「group 元素被引擎换掉 / parentElement 链与 contains 语义脱钩」：
		// 目标**不是** group 自身（否则查表第一步就命中，测不到回落），而是
		// group 的后代——它的 `parentElement` 链在根处断裂，但 `parent` 链仍连通
		// （contains 仍认它是后代）⇒ 只能靠回落分支捞回来。
		const sub = fakeEl(leafEl);
		sub.parentElement = null;

		const out = resolveNodesByDoms(asMindMap(tree), [asEl(sub)]);
		expect(out).toEqual([asNode(leafNode)]);
		expect(leafEl.containsCalls, '确实走了 contains 回落').toBeGreaterThan(0);
	});

	it('全部命中时零 contains 调用（复杂度改进的可观测证据）', () => {
		const { tree, rootEl, midEl, leafEl } = tree3();

		resolveNodesByDoms(asMindMap(tree), [
			asEl(rootEl),
			asEl(midEl),
			asEl(leafEl),
		]);

		// 逐个 findNodeByDom 至少会调 3 次（每元素至少一次 contains）
		expect(rootEl.containsCalls).toBe(0);
		expect(midEl.containsCalls).toBe(0);
		expect(leafEl.containsCalls).toBe(0);
	});

	it('规模收益：元素数远大于节点数时，contains 调用不随元素数线性增长', () => {
		// 3 个节点、300 个待反查元素（全部落在最深节点的 group 内）
		const { tree, leafEl, midEl } = tree3();
		const deep = fakeEl(fakeEl(leafEl)); // 挂在最深 group 内
		const many = Array.from({ length: 300 }, () => asEl(deep));
		// 混两个必然落空的元素，验证回落次数是常数级而非线性级
		const withMisses = [...many, asEl(fakeEl()), asEl(fakeEl())];

		resolveNodesByDoms(asMindMap(tree), withMisses);

		// 回落只发生在两个落空元素上：每次 findNodeByDom 至多扫 3 个 group
		expect(leafEl.containsCalls).toBeLessThanOrEqual(2 * 3);
		expect(midEl.containsCalls).toBeLessThanOrEqual(2 * 3);
	});

	it('引擎 / 渲染树 / 根节点不可用时返回等长全 null（不改变长度契约）', () => {
		const els = [asEl(fakeEl()), asEl(fakeEl())];

		expect(resolveNodesByDoms(null, els)).toEqual([null, null]);
		expect(
			resolveNodesByDoms({ renderer: null } as unknown as MindMap, els),
		).toEqual([null, null]);
		expect(resolveNodesByDoms(asMindMap(null), els)).toEqual([null, null]);
	});

	it('空输入返回空数组', () => {
		const { tree } = tree3();

		expect(resolveNodesByDoms(asMindMap(tree), [])).toEqual([]);
	});

	it('group 缺失 / group.node 缺失的节点被跳过，不阻断其它元素', () => {
		const childEl = fakeEl();
		const tree = fakeNode(fakeEl(), [
			fakeNode(null),
			fakeNode(childEl, [], 'no-node'),
			fakeNode(childEl),
		]);
		const hitNode = tree.children[2]!;

		expect(resolveNodesByDoms(asMindMap(tree), [asEl(childEl)])).toEqual([
			asNode(hitNode),
		]);
	});
});
