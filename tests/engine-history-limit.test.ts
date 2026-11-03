/**
 * 命令历史上限的预算反推（`resolveHistoryLimit`）回归。
 *
 * 为什么需要：引擎命令历史逐条保存「整树 JSON 快照」，旧策略按节点数分档
 * （<2000 节点 500 条 / ≥2000 节点 100 条）时，单视图最坏水位 = 上限 × 每条字节
 * ——500 节点图 ≈ 91MB 反而重于 2000 节点图 ≈ 70MB（K65 实测，K66 改为 30MB 预算）。
 * 上限现在是 `节点数` 的连续函数，本文件锁住三条性质：① 预算兑现（非地板区
 * 条数 × 每条约 ≤ 预算）；② 单调不增（图越大条数只减不增）；③ 边界（小图保持
 * 引擎默认 500、超大图落入下限 30、永不越界）。
 *
 * vendor cjs 以 vi.mock 桩替代真实模块：本文件只验纯函数，不需要真实引擎
 * （也避免 Node 下引擎顶层求值触碰 document；桩面与 find-node-by-dom 同款）。
 */
import { describe, expect, it, vi } from 'vitest';
import {
	HISTORY_BUDGET_BYTES,
	HISTORY_SNAPSHOT_BYTES_PER_NODE,
	readHistoryAvailability,
	resolveHistoryLimit,
	seedInitialHistory,
	syncHistoryLimit,
} from '../src/engine/mindmap';
import type { MindMap } from '../vendor/simple-mind-map.cjs';

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

/** 引擎默认上限（vendor `opt.maxHistoryCount` 初值）与撤销深度下限（与源码一致） */
const ENGINE_DEFAULT_LIMIT = 500;
const MIN_LIMIT = 30;

/** 地板区上界：再大的图也保底 MIN_LIMIT 条，此时单视图内存不再被预算封顶 */
const FLOOR_BOUNDARY_NODES = Math.floor(
	HISTORY_BUDGET_BYTES / (MIN_LIMIT * HISTORY_SNAPSHOT_BYTES_PER_NODE),
);

describe('resolveHistoryLimit：命令历史上限按内存预算反推', () => {
	it('小图不干预：预算宽裕时保持引擎默认 500（不抬升）', () => {
		// 阈值来自 floor(预算 / (节点数 × 每条字节)) ≥ 500 ⇒ 节点数 ≤ 163
		expect(resolveHistoryLimit(1)).toBe(ENGINE_DEFAULT_LIMIT);
		expect(resolveHistoryLimit(163)).toBe(ENGINE_DEFAULT_LIMIT);
		expect(resolveHistoryLimit(164)).toBeLessThan(ENGINE_DEFAULT_LIMIT);
	});

	it('预算兑现：非地板区「条数 × 节点数 × 每条字节」不超预算', () => {
		for (const nodes of [164, 500, 1000, 2000, FLOOR_BOUNDARY_NODES]) {
			const limit = resolveHistoryLimit(nodes);
			expect(limit).toBeGreaterThanOrEqual(MIN_LIMIT);
			expect(limit).toBeLessThanOrEqual(ENGINE_DEFAULT_LIMIT);
			expect(limit * nodes * HISTORY_SNAPSHOT_BYTES_PER_NODE).toBeLessThanOrEqual(
				HISTORY_BUDGET_BYTES,
			);
		}
	});

	it('实测对照值：500 节点 ⇒ 163 条、2000 节点 ⇒ 40 条（文档与发布记录引用这两个数）', () => {
		expect(resolveHistoryLimit(500)).toBe(163);
		expect(resolveHistoryLimit(2000)).toBe(40);
	});

	it('单调不增：图越大条数只减不增（无分档跳变）', () => {
		const samples = [1, 100, 163, 164, 500, 1000, 2000, 5000, 100000];
		for (let i = 1; i < samples.length; i++) {
			expect(resolveHistoryLimit(samples[i]!)).toBeLessThanOrEqual(
				resolveHistoryLimit(samples[i - 1]!),
			);
		}
	});

	it('地板与上界：超大图保底 30 条，任何规模都不越界', () => {
		expect(resolveHistoryLimit(FLOOR_BOUNDARY_NODES)).toBe(MIN_LIMIT);
		expect(resolveHistoryLimit(FLOOR_BOUNDARY_NODES + 1)).toBe(MIN_LIMIT);
		expect(resolveHistoryLimit(1_000_000)).toBe(MIN_LIMIT);
		// 退化输入不产生 0 / 负数 / NaN
		expect(resolveHistoryLimit(0)).toBe(ENGINE_DEFAULT_LIMIT);
		expect(resolveHistoryLimit(-5)).toBe(ENGINE_DEFAULT_LIMIT);
	});
});

describe('syncHistoryLimit：会话内按当前节点数同步上限（图长大 ⇒ 预算不失效）', () => {
	/** 宽树构造：root + (nodeCount-1) 个子节点（countTreeNodes 计全部） */
	function treeOf(nodeCount: number): { children: { children: never[] }[] } {
		return {
			children: Array.from({ length: Math.max(0, nodeCount - 1) }, () => ({
				children: [] as never[],
			})),
		};
	}

	/** 极简引擎桩：只铺 syncHistoryLimit 触达的面（renderer.root / opt / updateConfig） */
	function engineOf(nodeCount: number, currentLimit: number) {
		const updateConfig = vi.fn<(config: Record<string, unknown>) => void>();
		const engine = {
			renderer: { root: treeOf(nodeCount) },
			opt: { maxHistoryCount: currentLimit },
			updateConfig,
		} as unknown as MindMap;
		return { engine, updateConfig };
	}

	it('图在会话内长大：上限按当前节点数下调（创建期的 500 条 → 1000 节点的预算值）', () => {
		const { engine, updateConfig } = engineOf(1000, ENGINE_DEFAULT_LIMIT);
		syncHistoryLimit(engine);
		expect(updateConfig).toHaveBeenCalledExactlyOnceWith({
			maxHistoryCount: resolveHistoryLimit(1000),
		});
	});

	it('已在目标值：不触碰 updateConfig（maxHistoryCount 是 opt 活引用，直接比较）', () => {
		const target = resolveHistoryLimit(1000);
		const { engine, updateConfig } = engineOf(1000, target);
		syncHistoryLimit(engine);
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it('渲染根缺失（引擎中间态/未就绪）：静默跳过', () => {
		const updateConfig = vi.fn();
		const engine = {
			renderer: { root: null },
			opt: {},
			updateConfig,
		} as unknown as MindMap;
		syncHistoryLimit(engine);
		expect(updateConfig).not.toHaveBeenCalled();
	});

	it('updateConfig 抛错（引擎中间态）：吞错不中断 data_change 事件链', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const engine = {
			renderer: { root: treeOf(1000) },
			opt: { maxHistoryCount: ENGINE_DEFAULT_LIMIT },
			updateConfig: vi.fn(() => {
				throw new Error('中间态');
			}),
		} as unknown as MindMap;
		expect(() => syncHistoryLimit(engine)).not.toThrow();
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});

/**
 * 初始快照播种（`seedInitialHistory`）。
 *
 * 为什么需要：引擎创建后历史为空，`addHistory` 只在命令收尾被调用 ⇒ 第一条
 * 快照永远是「第一次改动之后」的状态，`Ctrl+Z` 因 `activeHistoryIndex - 1 < 0`
 * 直接空转（2026-11-02 实机：勾复选框 / 内联改字后撤销无反应，且永远回不到
 * 打开时的原样）。播种必须走**非防抖**的 `originAddHistory`：`addHistory` 被
 * `addHistoryTime`（100ms）包装过，播种若被防抖，会与紧随其后的编辑合并成一条，
 * 第 0 步又变成「编辑后」。
 */
describe('seedInitialHistory（播种初始撤销快照）', () => {
	function engineWith(command: unknown): MindMap {
		return { command } as unknown as MindMap;
	}

	it('优先调用非防抖 originAddHistory，且只调用一次', () => {
		const originAddHistory = vi.fn();
		const addHistory = vi.fn();
		seedInitialHistory(engineWith({ originAddHistory, addHistory }));
		expect(originAddHistory).toHaveBeenCalledTimes(1);
		expect(addHistory).not.toHaveBeenCalled();
	});

	it('缺失 originAddHistory（裁剪构建）：回落到 addHistory', () => {
		const addHistory = vi.fn();
		seedInitialHistory(engineWith({ addHistory }));
		expect(addHistory).toHaveBeenCalledTimes(1);
	});

	it('引擎面缺失（null / 无 command / 无任何历史入口）：安全 no-op', () => {
		expect(() => seedInitialHistory(null)).not.toThrow();
		expect(() => seedInitialHistory(undefined)).not.toThrow();
		expect(() => seedInitialHistory(engineWith(undefined))).not.toThrow();
		expect(() => seedInitialHistory(engineWith({}))).not.toThrow();
	});

	it('播种抛错（引擎中间态）：只留痕，不向上抛', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const engine = engineWith({
			originAddHistory: () => {
				throw new Error('未就绪');
			},
		});
		expect(() => seedInitialHistory(engine)).not.toThrow();
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});

/**
 * 撤销/重做可用性（`readHistoryAvailability`）。
 *
 * 为什么需要：竖栏的撤销/重做按钮此前恒为可点态，`activeHistoryIndex` 停在 0
 * 时点击毫无反应（2026-11-03 实机：用户以为「撤销坏了」）。判据必须与引擎
 * `UNDO`/`REDO` 自身的早退条件一致（`index - 1 >= 0` / `index + 1 < length`），
 * 否则按钮亮着却什么都不做。
 */
describe('readHistoryAvailability（撤销/重做按钮的置灰依据）', () => {
	function engineWith(command: unknown): MindMap {
		return { command } as unknown as MindMap;
	}

	it('刚打开（只有种子快照 / idx 0）：可重做不可撤销', () => {
		expect(
			readHistoryAvailability(engineWith({ history: [{}], activeHistoryIndex: 0 })),
		).toEqual({ canUndo: false, canRedo: false });
	});

	it('编辑一步后：可撤销不可重做', () => {
		expect(
			readHistoryAvailability(
				engineWith({ history: [{}, {}], activeHistoryIndex: 1 }),
			),
		).toEqual({ canUndo: true, canRedo: false });
	});

	it('撤销回中间态：两侧都可用', () => {
		expect(
			readHistoryAvailability(
				engineWith({ history: [{}, {}, {}], activeHistoryIndex: 1 }),
			),
		).toEqual({ canUndo: true, canRedo: true });
	});

	it('引擎面缺失（裁剪构建 / 未就绪 / 无 command）：两侧都不可用', () => {
		expect(readHistoryAvailability(null)).toEqual({
			canUndo: false,
			canRedo: false,
		});
		expect(readHistoryAvailability(undefined)).toEqual({
			canUndo: false,
			canRedo: false,
		});
		expect(readHistoryAvailability(engineWith({}))).toEqual({
			canUndo: false,
			canRedo: false,
		});
		// history 不是数组（引擎中间态）同样按不可用处理，不能抛
		expect(readHistoryAvailability(engineWith({ history: null }))).toEqual({
			canUndo: false,
			canRedo: false,
		});
	});
});
