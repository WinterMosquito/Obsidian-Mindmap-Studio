/**
 * 命令历史的单视图内存预算策略（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 依赖 `mindmap-nodes` 的 `getRenderRoot` / `countTreeNodes`（会话内同步需计数）。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import { countTreeNodes, getRenderRoot } from './mindmap-nodes';

/**
 * 命令历史的**单视图堆内存预算**：引擎逐条保存「整树 JSON 快照」，每条堆占用
 * ≈ 节点数 × `HISTORY_SNAPSHOT_BYTES_PER_NODE`（K65 实测），固定条数上限会让
 * 单视图历史随图规模失控（旧策略：<2000 节点 500 条 ⇒ 500 节点图 ≈ 91MB/视图）。
 *
 * 为什么按预算反推、而不按节点数分档：分档在档位边界有跳变，且档内仍是
 * 「上限 × 每条字节」——旧两档里 500 节点图（≈91MB）反而比 2000 节点图（≈70MB）
 * 更重，最典型的几百节点图恰是缓冲最松的一档（K66）。
 */
export const HISTORY_BUDGET_BYTES = 30 * 1024 * 1024;
/** 单条快照的堆字节 ≈ 节点数 × 本系数（K65 实测 500 节点 ≈ 182KB ⇒ 373B/节点；上取整留字段漂移余量） */
export const HISTORY_SNAPSHOT_BYTES_PER_NODE = 384;
/** 引擎默认上限（vendor `opt.maxHistoryCount` 初值）：预算宽裕时不去抬高它 */
const HISTORY_DEFAULT_MAX_COUNT = 500;
/** 撤销深度下限：预算再紧也保底这么多步（大图上「连改两下就没得撤」不可接受） */
const HISTORY_MIN_COUNT = 30;

/**
 * 按节点数反推命令历史上限（`maxHistoryCount`）：把单视图历史内存钉在
 * `HISTORY_BUDGET_BYTES` 内（条数向下取整），并 clamp 到 [下限, 引擎默认]。
 *
 * 实测对照：500 节点 ⇒ 163 条（91MB→30MB）、2000 节点 ⇒ 40 条（70MB→30MB）；
 * ≥2731 节点落入下限 30 条（地板之上不再封顶——要完全封顶需引擎只存 diff，
 * 属 vendor 内部；见 K66）。
 *
 * 导出供 `--perf` 内存轮断言「预算确实应用」与 `tests/engine-history-limit.test.ts`
 * 使用；生产路径经 `createMindMap`（创建期）与 `syncHistoryLimit`（会话内）调用。
 */
export function resolveHistoryLimit(nodeCount: number): number {
	const perSnapshot = Math.max(1, nodeCount) * HISTORY_SNAPSHOT_BYTES_PER_NODE;
	const affordable = Math.floor(HISTORY_BUDGET_BYTES / perSnapshot);
	return Math.min(
		HISTORY_DEFAULT_MAX_COUNT,
		Math.max(HISTORY_MIN_COUNT, affordable),
	);
}

/**
 * 会话内同步命令历史上限：按**当前**渲染树节点数重算（`resolveHistoryLimit`）。
 *
 * 创建期只按「打开那一刻」的节点数反推一次——会话内长大的图（连续编辑 / 粘贴 /
 * 拖入）会让 30MB 预算逐步失效：从空图长到 1000 节点仍保留 500 条 ⇒ 最坏
 * ≈192MB（K65 口径 ≈384B/节点/条，预算本应 30MB）。反向（图变小）不重算只是
 * 撤销深度偏浅，一并覆盖。**下调上限不会立刻裁剪已存历史**（引擎只在 push
 * 时 shift 越过上限的条目），渐进收敛即可；与当前值相同则连 `updateConfig`
 * 都不发（maxHistoryCount 是 opt 活引用，直接读取比较）。
 *
 * 计数本身是一次全树遍历（`countTreeNodes`）——档位判定离不开节点数，引擎
 * 既无 O(1) 计数字段也无结构变更事件可作前置闸门（vendor 实测：无
 * nodeCount，`data_change` 不带原因），故不做「先比较后计数」。成本落在
 * 1s 节流窗口内（消费方已节流），大图实测为亚毫秒级。
 *
 * 消费方：EngineController 的 data_change 通道（已按节流窗口去重），勿逐命令调用。
 */
export function syncHistoryLimit(mindMap: MindMap): void {
	const root = getRenderRoot(mindMap);
	if (!root) {
		return;
	}
	const limit = resolveHistoryLimit(countTreeNodes(root));
	if (mindMap.opt?.maxHistoryCount === limit) {
		return;
	}
	try {
		mindMap.updateConfig({ maxHistoryCount: limit });
	} catch (error) {
		// 引擎中间态（重建窗口）可能拒绝更新：历史预算属尽力而为，不中断事件链
		console.error('同步命令历史上限失败', error);
	}
}

/**
 * **创建期**应用历史预算（`createMindMap` 的唯一入口）。
 *
 * 与 `syncHistoryLimit` 的差异：创建期只按「打开那一刻」的节点数反推一次，且
 * **不低于引擎默认时不动**——预算是「必要时下调」，宽裕时抬高没有收益（历史
 * 此时尚空、`opt` 是活引用，立即生效且无裁剪丢失）。把该判定收在本模块，使
 * 「预算怎么算、何时动上限」只有一处；`createMindMap` 因此不再需要知道引擎
 * 默认上限（`HISTORY_DEFAULT_MAX_COUNT` 保持模块私有）。
 */
export function applyHistoryLimitOnCreate(
	mindMap: MindMap,
	nodeCount: number,
): void {
	const limit = resolveHistoryLimit(nodeCount);
	if (limit < HISTORY_DEFAULT_MAX_COUNT) {
		mindMap.updateConfig({ maxHistoryCount: limit });
	}
}
