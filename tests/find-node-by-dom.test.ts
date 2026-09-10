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
import { findNodeByDom } from '../src/mindmap';

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
	/** contains 被调用次数：用于断言「命中即终止整树遍历」 */
	containsCalls: number;
	contains(target: FakeEl): boolean;
}

function fakeEl(parent: FakeEl | null = null): FakeEl {
	return {
		parent,
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
