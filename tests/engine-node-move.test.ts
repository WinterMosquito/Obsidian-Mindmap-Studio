/**
 * `moveNodeInSiblings`（兄弟间上/下移的防腐入口）回归。
 *
 * 为什么这段逻辑的单测在引擎层：它读的是引擎节点内部形态——`parent.children`
 * 的顺序、`customLeft`/`customTop` 实例字段（节点有效坐标 getter 为
 * `customLeft || _left`）。features 层不得直接触碰这些（AGENTS「引擎访问只走
 * 防腐层」），视图侧只验「结果 → 提示」映射（tests/view-node-actions.test.ts）。
 *
 * 覆盖：
 * - 命令序列：清「交换对象」坐标 → 清「被移动节点」坐标 → UP_NODE / DOWN_NODE
 *   （上移取前一个兄弟，下移取后一个）；
 * - 清坐标的形态：实例字段与 `SET_NODE_DATA` 写入值**二者都**是 undefined
 *   （只清一处会在 `customLeft || _left` 下残留）；
 * - 四个拒绝分支的返回值（root / atTop / atBottom / detached）且不触碰引擎。
 *
 * 画面跟随（清坐标后布局重排）不在此断言：那需要真实引擎与 DOM，属实机验证面。
 *
 * vendor cjs 以 vi.mock 桩替代真实模块（与 engine-history-limit 同款）：
 * 本文件只验纯逻辑，不需要真实引擎（也避免 Node 下引擎顶层求值触碰 document）。
 */
import { describe, expect, it, vi } from 'vitest';
import { ENGINE_COMMANDS, moveNodeInSiblings } from '../src/engine/mindmap';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';

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

/** 取第 n 次调用的完整入参（避免 noUncheckedIndexedAccess 噪声与静默 undefined） */
function callArgs(spy: { mock: { calls: unknown[][] } }, index = 0): unknown[] {
	const call = spy.mock.calls[index];
	if (!call) {
		throw new Error(`第 ${index + 1} 次调用不存在`);
	}
	return call;
}

/** 引擎桩：只记录 execCommand 调用（本入口唯一的引擎交互面） */
function makeEngine() {
	const execCommand = vi.fn<(...args: unknown[]) => void>();
	return { engine: { execCommand } as unknown as MindMap, execCommand };
}

/**
 * 兄弟链条：count 个同级节点（`parent.children` 即引擎判定的兄弟数组）。
 * 默认都带自由拖拽坐标（`customLeft`/`customTop`），以便断言清除行为。
 */
function makeSiblings(count = 3): MindMapNode[] {
	const parent: { nodeData: { children: unknown[] }; children: unknown[] } = {
		nodeData: { children: [] },
		children: [],
	};
	const nodes = Array.from({ length: count }, (_, i) => ({
		isRoot: false,
		parent,
		nodeData: { children: [] },
		getData: () => ({ text: `n${i}` }),
		customLeft: 100 + i,
		customTop: 200 + i,
	}));
	parent.children = nodes;
	return nodes as unknown as MindMapNode[];
}

/** 节点上的自定义坐标（引擎内部形态：仅测试侧读取用于断言） */
function customPos(node: MindMapNode): { left?: number; top?: number } {
	const inst = node as unknown as { customLeft?: number; customTop?: number };
	return { left: inst.customLeft, top: inst.customTop };
}

describe('moveNodeInSiblings：交换顺序并清自定义坐标', () => {
	it('上移：先清前一个兄弟、再清被移动节点，最后发 UP_NODE', () => {
		const [first, middle] = makeSiblings();
		const { engine, execCommand } = makeEngine();

		expect(moveNodeInSiblings(engine, middle!, -1)).toBe('moved');

		expect(callArgs(execCommand, 0)).toEqual([
			ENGINE_COMMANDS.SET_NODE_DATA,
			first,
			{ customLeft: undefined, customTop: undefined },
		]);
		expect(callArgs(execCommand, 1)).toEqual([
			ENGINE_COMMANDS.SET_NODE_DATA,
			middle,
			{ customLeft: undefined, customTop: undefined },
		]);
		expect(callArgs(execCommand, 2)).toEqual([ENGINE_COMMANDS.UP_NODE, middle]);
	});

	it('下移：交换对象取后一个兄弟', () => {
		const [, middle, last] = makeSiblings();
		const { engine, execCommand } = makeEngine();

		expect(moveNodeInSiblings(engine, middle!, 1)).toBe('moved');

		expect(callArgs(execCommand, 0)).toEqual([
			ENGINE_COMMANDS.SET_NODE_DATA,
			last,
			{ customLeft: undefined, customTop: undefined },
		]);
		expect(callArgs(execCommand, 1)).toEqual([
			ENGINE_COMMANDS.SET_NODE_DATA,
			middle,
			{ customLeft: undefined, customTop: undefined },
		]);
		expect(callArgs(execCommand, 2)).toEqual([ENGINE_COMMANDS.DOWN_NODE, middle]);
	});

	it('清坐标落到实例字段：参与交换的两个节点 customLeft/customTop 都置 undefined', () => {
		const [first, middle] = makeSiblings();
		const { engine } = makeEngine();

		moveNodeInSiblings(engine, middle!, -1);

		expect(customPos(middle!)).toEqual({ left: undefined, top: undefined });
		expect(customPos(first!)).toEqual({ left: undefined, top: undefined });
	});
});

describe('moveNodeInSiblings：拒绝分支（引擎会静默 no-op，返回值表达原因）', () => {
	it('中心节点：返回 root 且不触碰引擎', () => {
		const { engine, execCommand } = makeEngine();
		const root = {
			isRoot: true,
			parent: null,
			nodeData: { children: [] },
		} as unknown as MindMapNode;

		expect(moveNodeInSiblings(engine, root, -1)).toBe('root');
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('已在首位再上移 / 已在末位再下移：atTop / atBottom 且不触碰引擎', () => {
		const [first, , last] = makeSiblings();
		const firstEngine = makeEngine();
		expect(moveNodeInSiblings(firstEngine.engine, first!, -1)).toBe('atTop');
		expect(firstEngine.execCommand).not.toHaveBeenCalled();

		const lastEngine = makeEngine();
		expect(moveNodeInSiblings(lastEngine.engine, last!, 1)).toBe('atBottom');
		expect(lastEngine.execCommand).not.toHaveBeenCalled();
	});

	it('独生子节点：两个方向都无可交换对象', () => {
		const [only] = makeSiblings(1);
		const upEngine = makeEngine();
		expect(moveNodeInSiblings(upEngine.engine, only!, -1)).toBe('atTop');

		const downEngine = makeEngine();
		expect(moveNodeInSiblings(downEngine.engine, only!, 1)).toBe('atBottom');
		expect(downEngine.execCommand).not.toHaveBeenCalled();
	});

	it('无父 / 不在兄弟数组中：detached 且不触碰引擎', () => {
		const orphan = {
			isRoot: false,
			parent: null,
			nodeData: { children: [] },
		} as unknown as MindMapNode;
		const { engine, execCommand } = makeEngine();

		expect(moveNodeInSiblings(engine, orphan, -1)).toBe('detached');
		expect(execCommand).not.toHaveBeenCalled();

		// 有父但不在其 children 中（坏形态）：同一 detached 出口
		const [, middle] = makeSiblings();
		(middle as unknown as { parent: unknown }).parent = {
			children: [],
			nodeData: { children: [] },
		};
		expect(moveNodeInSiblings(engine, middle!, 1)).toBe('detached');
		expect(execCommand).not.toHaveBeenCalled();
	});
});
