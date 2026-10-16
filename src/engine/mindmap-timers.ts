/**
 * 引擎延时任务登记表（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 本模块是**叶子**：`mindmap-viewport` / `mindmap-nodes` / `mindmap.ts`（整理）
 * 共用 `scheduleEngineTimer`——留在 `mindmap.ts` 会与拆分后的子模块构成环。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';

/**
 * 引擎侧延时任务登记表（`execResetLayoutAndFit` 的延时 fit、
 * `waitRenderRootThenArrange` 的轮询链、`startNodeTextEdit` 的宏任务延后）。
 *
 * 存在的理由：这些 `setTimeout` 的闭包会触碰引擎实例，而视图关闭会在它们到期前
 * 销毁引擎（`EngineController.destroyInstance`）——没有登记表就只能等定时器自然到期，
 * 在已销毁的实例上白跑一趟（轮询链还会因此再排下一次）。
 *
 * 用 `WeakMap` 而非模块级 `Map`：引擎实例被回收后条目随之消失，不构成长期驻留。
 */
const engineTimers = new WeakMap<MindMap, Set<number>>();

/** 排一个可被 `cancelEngineTimers` 取消的引擎延时任务（回调执行后自动摘除登记） */
export function scheduleEngineTimer(
	mindMap: MindMap,
	callback: () => void,
	delay: number,
): void {
	const id = window.setTimeout(() => {
		engineTimers.get(mindMap)?.delete(id);
		callback();
	}, delay);
	let pending = engineTimers.get(mindMap);
	if (!pending) {
		pending = new Set<number>();
		engineTimers.set(mindMap, pending);
	}
	pending.add(id);
}

/** 取消该引擎实例的全部在途延时任务（销毁路径调用；幂等） */
export function cancelEngineTimers(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	const pending = engineTimers.get(mindMap);
	if (!pending) {
		return;
	}
	for (const id of pending) {
		window.clearTimeout(id);
	}
	pending.clear();
}
