/**
 * 图片尺寸校正**回灌引擎**的回归（`applyImageSizeCorrectionsToEngine`）。
 *
 * 为什么单独立文件：这是「加载期探测不再挡首帧」的另一半——探测在首帧前起步、
 * 结果在引擎就绪后回灌。回灌必须满足四条硬约束，本文件逐条断言：
 * ① **匹配双通道**：对象身份（`node.getData() === correction.data`）优先、
 *    **uid 回退**兜底——真实引擎对树 data 做**包装/拷贝**（2026-09-28 探针实测
 *    `identitySame=false`），身份通道在真实路径落空，靠 uid 命中；uid 在回灌时
 *    必然已分配（`ensureUniqueUids` 在引擎创建前同步跑完）；
 * ② **image 地址比对**：用户已换过图片时旧尺寸不得盖上去（两通道都要过）；
 * ③ **值相同不写、有改动才 render 一次**：避免无谓重绘（这是本项优化的收益来源，
 *    回灌本身不能变成新的卡顿源）。
 *
 * vendor cjs 以 vi.mock 桩替代（只验防腐层的匹配与写入，不需要真实引擎；
 * 「引擎节点 data 可独立于树 data」的桩形态见 uid 用例——这正是真实引擎行为）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import {
	applyImageSizeCorrectionsToEngine,
	findNodesByMathProducts,
} from '../src/engine/mindmap';

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

/** 引擎节点桩：只实现回灌路径用到的面（children 遍历 + getData 活引用） */
function fakeNode(
	data: Record<string, unknown>,
	children: MindMapNode[] = [],
): MindMapNode {
	return {
		getData: (key?: string) => (key === undefined ? data : data[key]),
		children,
	} as unknown as MindMapNode;
}

/** 引擎桩：renderer.root 提供渲染树，render 记录调用 */
function fakeEngine(root: MindMapNode | null) {
	const render = vi.fn<() => void>();
	const mindMap = {
		render,
		renderer: { root },
	} as unknown as MindMap;
	return { mindMap, render };
}

describe('applyImageSizeCorrectionsToEngine（首帧后回灌）', () => {
	it('按 data 对象身份匹配：写入尺寸 + 自动校正标记，并只 render 一次', () => {
		const targetData: Record<string, unknown> = {
			text: '',
			image: 'app://img/a.png',
		};
		const otherData: Record<string, unknown> = {
			text: '',
			image: 'app://img/b.png',
		};
		const root = fakeNode({ text: 'root' }, [
			fakeNode(targetData),
			fakeNode(otherData),
		]);
		const { mindMap, render } = fakeEngine(root);

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data: targetData,
				image: 'app://img/a.png',
				width: 120,
				height: 40,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied).toBe(1);
		expect(targetData.imageSize).toEqual({
			width: 120,
			height: 40,
			custom: true,
		});
		expect(targetData.mdImageAutoSize).toBe(true);
		// 未命中条目不得影响其它节点
		expect(otherData.imageSize).toBeUndefined();
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('image 地址已变（用户换图）：丢弃该条，不写尺寸也不 render', () => {
		const data: Record<string, unknown> = {
			text: '',
			image: 'app://img/new.png',
		};
		const { mindMap, render } = fakeEngine(fakeNode({ text: 'root' }, [fakeNode(data)]));

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data,
				image: 'app://img/old.png',
				width: 120,
				height: 40,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied).toBe(0);
		expect(data.imageSize).toBeUndefined();
		expect(render).not.toHaveBeenCalled();
	});

	it('值相同（已是该尺寸）：不写、不 render（避免回灌变成新的重绘源）', () => {
		const data: Record<string, unknown> = {
			text: '',
			image: 'app://img/same.png',
			imageSize: { width: 120, height: 40, custom: true },
		};
		const { mindMap, render } = fakeEngine(fakeNode({ text: 'root' }, [fakeNode(data)]));

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data,
				image: 'app://img/same.png',
				width: 120,
				height: 40,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied).toBe(0);
		expect(render).not.toHaveBeenCalled();
	});

	it('陈旧条目（引擎重建后 data 不再是树里的那个）：静默丢弃', () => {
		const staleData: Record<string, unknown> = {
			text: '',
			image: 'app://img/stale.png',
		};
		// 引擎里的节点 data 是**另一个对象**（重建后即如此）
		const liveData: Record<string, unknown> = {
			text: '',
			image: 'app://img/stale.png',
		};
		const { mindMap, render } = fakeEngine(
			fakeNode({ text: 'root' }, [fakeNode(liveData)]),
		);

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data: staleData,
				image: 'app://img/stale.png',
				width: 120,
				height: 40,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied).toBe(0);
		expect(liveData.imageSize).toBeUndefined();
		expect(render).not.toHaveBeenCalled();
	});

	it('引擎缺失/空结果：零开销短路（不抛异常）', () => {
		const { mindMap, render } = fakeEngine(null);
		expect(applyImageSizeCorrectionsToEngine(null, [])).toBe(0);
		expect(
			applyImageSizeCorrectionsToEngine(mindMap, [
				{
					data: {},
					image: 'x',
					width: 1,
					height: 1,
					custom: true,
					autoSize: false,
				},
			]),
		).toBe(0);
		expect(render).not.toHaveBeenCalled();
	});

	it('引擎包装数据（与树 data 非同一对象、同 uid）：按 uid 回退通道命中', () => {
		// 真实引擎对树 data 做包装/拷贝（2026-09-28 探针实测 identitySame=false）：
		// 引擎节点持有的对象 ≠ 树 data，但 uid 一致——生产路径靠这条通道命中
		const treeData: Record<string, unknown> = {
			uid: 'img-wrap-1',
			text: '',
			image: 'app://img/wrap.png',
		};
		const engineData: Record<string, unknown> = { ...treeData };
		expect(engineData).not.toBe(treeData);
		const { mindMap, render } = fakeEngine(
			fakeNode({ text: 'root' }, [fakeNode(engineData)]),
		);

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data: treeData,
				image: 'app://img/wrap.png',
				width: 600,
				height: 120,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied, '身份不成立 → 应靠 uid 命中').toBe(1);
		expect(engineData.imageSize).toEqual({
			width: 600,
			height: 120,
			custom: true,
		});
		expect(engineData.mdImageAutoSize).toBe(true);
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('uid 相同但 image 已换：uid 通道同样过 image 守卫、丢弃不写', () => {
		const treeData: Record<string, unknown> = {
			uid: 'img-wrap-2',
			text: '',
			image: 'app://img/old.png',
		};
		const engineData: Record<string, unknown> = {
			uid: 'img-wrap-2',
			text: '',
			image: 'app://img/new.png',
		};
		const { mindMap, render } = fakeEngine(
			fakeNode({ text: 'root' }, [fakeNode(engineData)]),
		);

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data: treeData,
				image: 'app://img/old.png',
				width: 600,
				height: 120,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied).toBe(0);
		expect(engineData.imageSize).toBeUndefined();
		expect(render).not.toHaveBeenCalled();
	});

	it('双通道均落空（无 uid 且非同一对象）：静默丢弃', () => {
		const staleTreeData: Record<string, unknown> = {
			text: '',
			image: 'app://img/legacy.png',
		};
		const liveData: Record<string, unknown> = {
			text: '',
			image: 'app://img/legacy.png',
		};
		const { mindMap } = fakeEngine(
			fakeNode({ text: 'root' }, [fakeNode(liveData)]),
		);

		const applied = applyImageSizeCorrectionsToEngine(mindMap, [
			{
				data: staleTreeData,
				image: 'app://img/legacy.png',
				width: 120,
				height: 40,
				custom: true,
				autoSize: true,
			},
		]);

		expect(applied).toBe(0);
		expect(liveData.imageSize).toBeUndefined();
	});
});

describe('findNodesByMathProducts（按产物元素反查节点，K100）', () => {
	/**
	 * 节点桩：带 group 元素（提供 contains/closest 两个 API 面）。
	 * @param owned 该节点的 group「包含」的 DOM 元素集合（模拟真实 contains）
	 */
	function nodeWithGroup(
		data: Record<string, unknown>,
		owned: readonly Element[],
		svg?: { querySelectorAll: (selector: string) => Element[] },
		children: MindMapNode[] = [],
	): MindMapNode {
		const groupEl = {
			contains: (el: Element) => owned.includes(el),
			closest: (selector: string) =>
				selector === 'svg' ? (svg ?? null) : null,
		};
		return {
			getData: (key?: string) => (key === undefined ? data : data[key]),
			children,
			group: { node: groupEl },
		} as unknown as MindMapNode;
	}

	it('按产物元素反查：命中的节点归一返回（同节点多产物去重）', () => {
		const productA = {} as Element;
		const productB = {} as Element;
		const svg = {
			querySelectorAll: () => [productA, productB],
		};
		const mathNode = nodeWithGroup({ text: 'math' }, [productA, productB]);
		const plainNode = nodeWithGroup({ text: 'plain' }, []);
		const root = nodeWithGroup({ text: 'root' }, [], svg, [
			mathNode,
			plainNode,
		]);
		const { mindMap } = fakeEngine(root);

		expect(findNodesByMathProducts(mindMap)).toEqual([mathNode]);
	});

	it('产物选择器同时覆盖我方 holder 类与 CHTML 容器（K104 回归位）', () => {
		// MathJax 走 tex2svg 的环境产物是 <svg>、没有 .mjx-container：
		// 若选择器只认容器类，产物反查必然 0 命中（用户实测告警「未能定位
		// 归属节点」，首帧公式尺寸不同步）。holder 类名不受替换影响，必须带上。
		const seen: string[] = [];
		const product = {} as Element;
		const svg = {
			querySelectorAll: (selector: string) => {
				seen.push(selector);
				return [product];
			},
		};
		const root = nodeWithGroup({ text: 'root' }, [], svg, [
			nodeWithGroup({ text: 'math' }, [product]),
		]);
		const { mindMap } = fakeEngine(root);

		expect(findNodesByMathProducts(mindMap)).toHaveLength(1);
		expect(seen[0], '选择器须含我方 holder 类').toContain(
			'.mindmap-node-inline-math',
		);
	});

	it('产物不属于任何节点 group（已脱离）：返回空数组、不抛错', () => {
		const orphan = {} as Element;
		const svg = { querySelectorAll: () => [orphan] };
		const root = nodeWithGroup({ text: 'root' }, [], svg, [
			nodeWithGroup({ text: 'a' }, []),
		]);
		const { mindMap } = fakeEngine(root);

		expect(findNodesByMathProducts(mindMap)).toEqual([]);
	});

	it('渲染根缺失 / 根 group 无 svg 祖先：安全返回空数组', () => {
		expect(findNodesByMathProducts(fakeEngine(null).mindMap)).toEqual([]);
		// 根节点无 svg 祖先（closest 返回 null）
		const noSvgRoot = nodeWithGroup({ text: 'root' }, []);
		expect(findNodesByMathProducts(fakeEngine(noSvgRoot).mindMap)).toEqual([]);
		expect(findNodesByMathProducts(null)).toEqual([]);
	});
});
