/**
 * 图片尺寸校正**回灌引擎**的回归（`applyImageSizeCorrectionsToEngine`）。
 *
 * 为什么单独立文件：这是「加载期探测不再挡首帧」的另一半——探测在首帧前起步、
 * 结果在引擎就绪后回灌。回灌必须满足三条硬约束，本文件逐条断言：
 * ① **对象身份匹配**（`node.getData() === correction.data`）：加载期 uid 可能尚未
 *    分配（`ensureUniqueUids` 在引擎创建时才跑），按 uid 找会写空；
 * ② **image 地址比对**：用户已换过图片时旧尺寸不得盖上去；
 * ③ **值相同不写、有改动才 render 一次**：避免无谓重绘（这是本项优化的收益来源，
 *    回灌本身不能变成新的卡顿源）。
 *
 * vendor cjs 以 vi.mock 桩替代（只验防腐层的匹配与写入，不需要真实引擎）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import { applyImageSizeCorrectionsToEngine } from '../src/engine/mindmap';

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
});
