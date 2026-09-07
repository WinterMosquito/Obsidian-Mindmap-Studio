/**
 * findNodeByDom 回归：DOM 元素 → 渲染节点的身份匹配。
 *
 * 背景：旧实现读取节点 DOM 上的 data-uid 属性——vendor 契约冒烟测试
 * （tests/vendor-contract.test.ts）证实引擎从不写入该属性，旧匹配恒失败
 * （画布空白右键委托路径永远弹空白菜单）。现改为「节点渲染 group 包含
 * 目标元素」的对象身份匹配，本文件锁定其语义。
 *
 * vendor cjs 以 vi.mock 桩替代真实模块（避免 Node 下引擎顶层求值触碰 document）。
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

/** 最小元素桩：contains 沿 parent 链向上判定包含关系（含自身） */
interface FakeEl {
	parent: FakeEl | null;
	contains(target: FakeEl): boolean;
}

function fakeEl(parent: FakeEl | null = null): FakeEl {
	return {
		parent,
		contains(target: FakeEl): boolean {
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

/** 渲染节点桩：group 元素 + children 树（walkTree 只用这两者） */
interface FakeNode {
	group: { node: FakeEl } | null;
	children: FakeNode[];
}

function fakeNode(groupEl: FakeEl | null, children: FakeNode[] = []): FakeNode {
	return {
		group: groupEl ? { node: groupEl } : null,
		children,
	};
}

function asMindMap(root: FakeNode | null): MindMap {
	return {
		renderer: { root: root as unknown as MindMapNode | null },
	} as unknown as MindMap;
}

describe('findNodeByDom：group 身份匹配', () => {
	// 真实引擎 DOM 形态：所有 .smm-node group 是 nodeDraw 层的兄弟节点，
	// 互不嵌套；节点内部子元素（图标/图片/foreignObject 内容）才在 group 内。
	it('命中节点 group 本身（closest(".smm-node") 场景）', () => {
		const rootEl = fakeEl();
		const childEl = fakeEl(); // 与 root group 互不包含
		const tree = fakeNode(rootEl, [fakeNode(childEl)]);
		const child = tree.children[0]!;

		expect(findNodeByDom(asMindMap(tree), childEl as unknown as Element)).toBe(
			child as unknown as MindMapNode,
		);
		expect(findNodeByDom(asMindMap(tree), rootEl as unknown as Element)).toBe(
			tree as unknown as MindMapNode,
		);
	});

	it('命中节点 group 的内部子元素（图标/图片等冒泡目标）', () => {
		const rootEl = fakeEl();
		const iconEl = fakeEl(rootEl); // group 内部的深层元素
		const tree = fakeNode(rootEl);

		expect(findNodeByDom(asMindMap(tree), iconEl as unknown as Element)).toBe(
			tree as unknown as MindMapNode,
		);
	});

	it('无匹配返回 null', () => {
		const tree = fakeNode(fakeEl());
		const stranger = fakeEl();

		expect(findNodeByDom(asMindMap(tree), stranger as unknown as Element)).toBeNull();
	});

	it('group 缺失的节点被跳过，不阻断遍历', () => {
		const rootEl = fakeEl();
		const childEl = fakeEl();
		const tree = fakeNode(rootEl, [
			{ group: null, children: [] },
			fakeNode(childEl),
		]);
		const child = tree.children[1]!;

		expect(findNodeByDom(asMindMap(tree), childEl as unknown as Element)).toBe(
			child as unknown as MindMapNode,
		);
	});

	it('引擎/渲染树不可用时返回 null', () => {
		const el = fakeEl();
		expect(findNodeByDom(null, el as unknown as Element)).toBeNull();
		expect(
			findNodeByDom({ renderer: null } as unknown as MindMap, el as unknown as Element),
		).toBeNull();
		expect(
			findNodeByDom(asMindMap(null), el as unknown as Element),
		).toBeNull();
	});
});
