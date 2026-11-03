/**
 * 命令历史的单视图内存预算策略（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 依赖 `mindmap-nodes` 的 `getRenderRoot` / `countTreeNodes`（会话内同步需计数）。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import { countTreeNodes, getRenderRoot } from './mindmap-nodes';

/**
 * 把**当前整树**记为一条撤销快照。
 *
 * ## 为什么需要它
 * 引擎只在命令收尾自动 `addHistory()`（`Command.exec` 对非白名单命令，见 K26b）；
 * 插件侧的「原文写回」通道（`features/node-inline-editor.applyRawNodeContent`：
 * 内联编辑 / 节点配色 / 任务勾选）直接改 data 后 `render()`，**不产生历史**——
 * 撤销会跳过这些改动、直接回到更早的快照（用户感知为「一次撤销丢一堆编辑」）。
 * 故该通道收尾必须显式记一条。
 *
 * ## 口径
 * - **先改数据、后记历史**：`addHistory` 推的是「此刻」快照，前一条仍在序列里；
 * - 引擎内部自带 100ms 防抖（K26e）：同一批连续写入合并成一条，正是批量配色
 *   与连续勾选需要的行为；
 * - 引擎面未在 d.cts 声明（`mindMap.command`），故按防御式读取——缺失只留痕，
 *   不让一次编辑失败。
 */
export function recordHistory(mindMap: MindMap | null | undefined): void {
	const command = (
		mindMap as unknown as { command?: { addHistory?: () => void } } | null | undefined
	)?.command;
	if (typeof command?.addHistory !== 'function') {
		return;
	}
	try {
		command.addHistory();
	} catch (error) {
		console.warn('记录撤销历史失败', error);
	}
}

/**
 * 播种**初始快照**：让撤销链的第 0 步是「打开这一刻的样子」。
 *
 * ## 为什么必须有
 * 引擎的历史在创建后是**空的**，`addHistory` 只在命令收尾被调用（见
 * `recordHistory` 的说明）⇒ 第一条快照永远是**第一次改动之后**的状态。
 * 于是：
 * - `Ctrl+Z` 要求 `activeHistoryIndex - 1 >= 0`，index 停在 0 ⇒ **本次会话的
 *   第一次编辑完全撤不掉**（2026-11-02 实机：勾选复选框、内联改字均无反应）；
 * - 即便后续有快照，也永远**回不到打开时的原样**（只能退到「第一次被记录的
 *   那个状态」）。
 *
 * ## 为什么用 `originAddHistory`
 * 引擎把 `addHistory` 用 `addHistoryTime`（100ms）**防抖包装**过（`recordHistory`
 * 正是靠这层合并连续勾选）；播种必须**立刻**生效——否则用户在 100ms 内编辑，
 * 这次 addHistory 会与编辑那次合并成一条，第 0 步又变成「编辑后」。
 * `originAddHistory` 是包装前绑定的原函数（vendor `Command.recovery` 同源）。
 *
 * ## 时机与副作用
 * 由 `createMindMap` 挂在**一次性**的 `node_tree_render_end` 上（渲染结束即摘，
 * 见该处调用点）：创建瞬间的树还没被引擎规范化（`expand` 等字段渲染期才补），
 * 此刻播种会与渲染后那条快照内容不同 ⇒ 多出一条「按 Ctrl+Z 毫无反应」的历史
 * （2026-11-02 实测：打开后 `2 条 / idx 1`，第一次撤销只翻了个看不见的字段）。
 *
 * 播种时**插件的监听已经绑好**（`engine-controller.renderMindMap` 在
 * `createMindMap` 返回后同步绑 `data_change`，而首帧渲染排在 `setTimeout(0)`
 * ⇒ 播种必在其后），故 `addHistory` 发出的 `data_change` 会正常走一遍视图编排：
 * `onRootDataChanged`（排一次自动保存 + 标题改名调度）与 `onDataChanged`
 * （自动拆链检查 + 联系线几何写回）。三者实测都无事发生——保存被「纯浏览守卫」
 * 跳过（正文与加载基线逐字相同，2026-11-02 实机：打开 4 s 后 mtime 未变）、
 * 根节点文本本就等于文件名、拆链候选集为空——但**别据此以为播种是静默的**：
 * 它是这条链路上唯一一次「只读打开却派发 data_change」的事件。
 *
 * 只读嵌入不播种（引擎对 readonly 本就早退，且它没有撤销入口）。
 */
export function seedInitialHistory(mindMap: MindMap | null | undefined): void {
	const command = (
		mindMap as unknown as
			| { command?: { originAddHistory?: () => void; addHistory?: () => void } }
			| null
			| undefined
	)?.command;
	// 优先非防抖原函数；旧版/裁剪构建缺失时退回普通入口（仍是「编辑前」的
	// 快照，只是可能被随后的编辑合并掉）
	const seed = command?.originAddHistory ?? command?.addHistory;
	if (typeof seed !== 'function') {
		return;
	}
	try {
		seed.call(command);
	} catch (error) {
		console.warn('播种撤销历史失败', error);
	}
}

/** 撤销 / 重做此刻是否可用（竖栏按钮的置灰依据） */
export interface HistoryAvailability {
	canUndo: boolean;
	canRedo: boolean;
}

/**
 * 读取命令历史的可用性（只读，不改任何状态）。
 *
 * 为什么需要：竖栏的撤销/重做按钮此前恒为可点态，`activeHistoryIndex` 停在 0
 * 时点击毫无反应，用户会以为「撤销坏了」（2026-11-03 实机）。
 *
 * 判据与引擎 `UNDO`/`REDO` 自身的早退条件一致（vendor：`index - 1 >= 0` /
 * `index + 1 < history.length`）——在这里另写一套「能不能撤」会与引擎漂移，
 * 故直接读同一组字段。引擎面未在 d.cts 声明，按防御式读取：缺失时回
 * `false/false`（按钮置灰，键盘快捷键仍是用户的后备通道）。
 */
export function readHistoryAvailability(
	mindMap: MindMap | null | undefined,
): HistoryAvailability {
	const command = (
		mindMap as unknown as
			| { command?: { history?: unknown[]; activeHistoryIndex?: number } }
			| null
			| undefined
	)?.command;
	const history = command?.history;
	if (!Array.isArray(history)) {
		return { canUndo: false, canRedo: false };
	}
	const index =
		typeof command?.activeHistoryIndex === 'number'
			? command.activeHistoryIndex
			: 0;
	return {
		canUndo: index > 0,
		canRedo: index + 1 < history.length,
	};
}

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
