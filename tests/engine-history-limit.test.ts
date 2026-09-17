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
	resolveHistoryLimit,
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
