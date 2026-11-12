/**
 * 跨视图应用会话快照的**唯一通道**（`engine/mindmap-snapshot.ts`）直测。
 *
 * 这条通道是 Level B「无回声」的结构性保证，必须钉死三件事：
 * 1. **不进引擎历史**（不调 `command.addHistory`）；
 * 2. **不发 `data_change`**（编辑期该事件唯一发源是 `addHistory`）；
 * 3. 仍然发 `before_update_data` / `update_data`（引擎插件依赖的生命周期事件）。
 *
 * 负向自检思路：把实现换回 `updateData`，本文件前两条断言即红灯。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import { applySessionSnapshot } from '../src/engine/mindmap-snapshot';

interface FakeEngine {
	mindMap: MindMap;
	events: string[];
	setData: ReturnType<typeof vi.fn>;
	render: ReturnType<typeof vi.fn>;
	updateData: ReturnType<typeof vi.fn>;
	handleDataCalls: number;
}

function makeEngine(
	overrides: { handleData?: boolean; renderer?: boolean } = {},
): FakeEngine {
	const events: string[] = [];
	const setData = vi.fn();
	const render = vi.fn();
	const updateData = vi.fn();
	const state = { handleDataCalls: 0 };
	const mindMap = {
		emit: (name: string) => {
			events.push(name);
		},
		render,
		updateData,
		renderer: overrides.renderer === false ? {} : { setData },
		...(overrides.handleData === false
			? {}
			: {
					handleData: (data: MindMapTreeNode): MindMapTreeNode => {
						state.handleDataCalls++;
						return JSON.parse(JSON.stringify(data)) as MindMapTreeNode;
					},
				}),
	} as unknown as MindMap;
	return {
		mindMap,
		events,
		setData,
		render,
		updateData,
		get handleDataCalls() {
			return state.handleDataCalls;
		},
	};
}

const tree: MindMapTreeNode = {
	data: { text: 'Root' },
	children: [{ data: { text: 'A' }, children: [] }],
};

describe('applySessionSnapshot', () => {
	it('走 handleData + renderer.setData + render：不进历史、不发 data_change', () => {
		const engine = makeEngine();

		expect(applySessionSnapshot(engine.mindMap, tree)).toBe(true);

		expect(engine.handleDataCalls).toBe(1);
		expect(engine.setData).toHaveBeenCalledTimes(1);
		expect(engine.render).toHaveBeenCalledTimes(1);
		expect(engine.events, '只发生命周期事件，不发 data_change').toEqual([
			'before_update_data',
			'update_data',
		]);
		// 防御式断言：引擎历史入口（addHistory）一次都没被调用
		expect(engine.updateData, '不得退回 updateData（那会进历史）').not.toHaveBeenCalled();
	});

	it('传入的树被深拷贝（引擎侧改动不回灌会话）', () => {
		const engine = makeEngine();
		const source: MindMapTreeNode = {
			data: { text: 'Root' },
			children: [{ data: { text: 'A' }, children: [] }],
		};

		applySessionSnapshot(engine.mindMap, source);

		const applied = engine.setData.mock.calls[0]?.[0] as MindMapTreeNode;
		expect(applied).not.toBe(source);
		expect(applied.children?.[0]?.data?.text).toBe('A');
	});

	it('无引擎 / 无树：返回 false，不抛错', () => {
		expect(applySessionSnapshot(null, tree)).toBe(false);
		const engine = makeEngine();
		expect(applySessionSnapshot(engine.mindMap, null)).toBe(false);
		expect(engine.setData).not.toHaveBeenCalled();
	});

	it('引擎接口缺失（版本差异）：返回 false，交调用方整树替换（不退回 updateData）', () => {
		const engine = makeEngine({ handleData: false });

		expect(applySessionSnapshot(engine.mindMap, tree)).toBe(false);
		// `updateData` 自身也依赖 handleData/setData，失败时再调它必然抛错；
		// 调用方（视图）据此走整树替换通道。
		expect(engine.updateData).not.toHaveBeenCalled();
		expect(engine.setData).not.toHaveBeenCalled();
	});

	it('handleData 返回空（畸形树）：返回 false，不渲染、不发事件', () => {
		const engine = makeEngine();
		(
			engine.mindMap as unknown as {
				handleData: () => null;
			}
		).handleData = () => null;

		expect(applySessionSnapshot(engine.mindMap, tree)).toBe(false);
		expect(engine.setData).not.toHaveBeenCalled();
		expect(engine.events).toEqual([]);
	});
});
