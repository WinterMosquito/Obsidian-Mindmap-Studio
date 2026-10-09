/**
 * 导航历史卫生：视图切换不构成导航点（K111，2026-10-04，侧键后退修复）。
 *
 * 背景（CLI 实机实验定位）：Obsidian 的导航历史由 leaf.history（Navigation
 * 实例：backHistory / forwardHistory）承载；侧键后退/前进走官方链路
 * window mousedown(button 3/4) → window.history.back/forward（被官方 patch）
 * → activeLeaf.history.back/forward() → setViewState 恢复。而「以导图打开」会
 * 产生**两条相邻历史**：Obsidian 先以 markdown 视图完成一次 setViewState
 * （记录「同文件 markdown 中间态」），插件钩子再切到导图视图（记录导图态）。
 * 用户在导图视图按侧键后退时，第一步落在同文件 markdown 中间态上 →
 * openAsPreferenceRestorer 又把它切回导图 → recordHistory 重录 + pushState
 * 清空 forwardHistory → **回退被完全抵消**（实机观测：后退后 back/forward
 * 两个栈长度与当前视图均无变化），即用户报告的「侧键后退无反应」。
 *
 * 修复（方案 A「历史栈卫生」，2026-10-04 用户确认）：视图切换落定后，把
 * leaf 历史里「同文件、跨视图类型」的**尾部连续冗余条目**收敛掉——与官方
 * 单态视图（Canvas / PDF）一致：**视图切换不是导航点**，后退直达上一个导航点
 * （通常是上一文件）。想回本文件的其他视图用「Switch to Markdown」命令。
 *
 * 边界：
 * - leaf.history 是 Obsidian **内部结构**（非公开 API）：防御式访问 + 形态
 *   校验，失败即放弃（退化为修复前行为，不抛错）——与 file-creator.ts 同一
 *   私有 API 防御式策略；
 * - 只在「尾部连续的同文件段」内删除，遇到异文件 / 形态异常条目即停——
 *   不跨异文件，避免误删用户真实导航点（同一文件被别的文件隔开的那条保留）；
 * - forward 栈用同一规则：`Navigation.go` 对两个栈**同构**（1.13.7 实测
 *   `app.js`：`e>0 && (i=this.forwardHistory.pop())`，前进也从尾部弹），故
 *   forward 的「下一跳」同样位于尾部，清理位置无需另行判断。
 */
import type { WorkspaceLeaf } from 'obsidian';

/** 历史条目形态的最小读取契约（Obsidian 内部结构，只读判据） */
interface HistoryEntryLike {
	state: { type: string; state: { file: string } };
}

/** 条目携带「视图类型 + 文件路径」时才可判定；形态不符即保守放弃 */
function isHistoryEntryLike(entry: unknown): entry is HistoryEntryLike {
	if (typeof entry !== 'object' || entry === null) {
		return false;
	}
	const outer = (entry as { state?: unknown }).state;
	if (typeof outer !== 'object' || outer === null) {
		return false;
	}
	const type = (outer as { type?: unknown }).type;
	const inner = (outer as { state?: unknown }).state;
	if (typeof type !== 'string' || typeof inner !== 'object' || inner === null) {
		return false;
	}
	return typeof (inner as { file?: unknown }).file === 'string';
}

/**
 * 清理单个历史栈（尾=最近项）：从尾向前，只要条目属于 `filePath`，
 * 就删除「视图类型 ≠ keepViewType」的条目；遇到「异文件」或「形态异常」
 * 条目即停（不跨文件段操作）。返回删除条数。
 */
export function pruneHistoryStack(
	stack: unknown,
	filePath: string,
	keepViewType: string,
): number {
	if (!Array.isArray(stack)) {
		return 0;
	}
	const list: unknown[] = stack;
	let removed = 0;
	for (let i = list.length - 1; i >= 0; i--) {
		const entry = list[i];
		if (!isHistoryEntryLike(entry)) {
			break;
		}
		if (entry.state.state.file !== filePath) {
			break;
		}
		if (entry.state.type === keepViewType) {
			// 目标态保留；继续向前——其下仍可能有更早的中间态冗余
			continue;
		}
		list.splice(i, 1);
		removed++;
	}
	return removed;
}

/**
 * 视图切换落定后调用（组合根注入）：把 leaf 的 back/forward 历史里
 * 「同文件、非 keepViewType」的尾部冗余条目收敛掉。
 */
export function pruneViewSwitchNoise(
	leaf: WorkspaceLeaf,
	filePath: string,
	keepViewType: string,
): void {
	try {
		const history = (
			leaf as unknown as {
				history?: { backHistory?: unknown; forwardHistory?: unknown } | null;
			}
		).history;
		if (!history) {
			return;
		}
		pruneHistoryStack(history.backHistory, filePath, keepViewType);
		pruneHistoryStack(history.forwardHistory, filePath, keepViewType);
	} catch (error) {
		// 私有结构变更时静默降级（退化为修复前行为，不影响打开流程）。
		// **刻意不弹 Notice**：本探测在每次视图切换时都会跑，Obsidian 内部一改
		// 就会对用户刷屏；而症状（侧键后退残留噪声条目）本身不影响正确性。
		// 但不能留在 debug——本行是「侧键后退无反应」的唯一诊断线索，故用 warn。
		console.warn(
			'导航历史清理跳过（Obsidian 私有结构可能已变更）:',
			filePath,
			error,
		);
	}
}
