/**
 * 「自动整理」编排：`RESET_LAYOUT` + 延时 fit，以及渲染根未回填时的轮询等待（K67）。
 *
 * 从 `engine/mindmap.ts` 拆出（2026-10-22，纯搬移，零行为改动）。三条路径
 * （即时执行 / 等回填后执行 / 超时只记日志）共用同一份 `execResetLayoutAndFit`，
 * 拆开会让「成功路径唯一实现」这条约束失效，故三者必须同文件。
 */
import {
	RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS,
	RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS,
	RESET_LAYOUT_VIEWPORT_DELAY_MS,
} from '../core/constants';
import type { MindMap } from '../core/engine-types';
import { ENGINE_COMMANDS } from './mindmap-commands';
import { getRenderRoot } from './mindmap-nodes';
import { scheduleEngineTimer } from './mindmap-timers';
import { fitMindMap } from './mindmap-viewport';

/**
 * 自动整理：清除所有节点被自由拖拽后的自定义位置，
 * 重新按当前布局算法计算位置，使各主题以合理间距对齐摆放，
 * 最后适应画布（fit 全图：整体缩放居中，整理结果一览无余）。
 *
 * 注意：使用引擎内置的「重置布局」（RESET_LAYOUT 命令）而非全量 setData。
 * 旧实现 getData()+delete+setData 会经 handleData / renderer.setData 重新初始化
 * 布局，可能重排 children 从而打乱用户手动排好的节点顺序；
 * resetLayout 只逐个节点清除 customLeft/customTop 后重渲染，不触碰 children 顺序，
 * 因此不会打乱手动排好的顺序。
 *
 * 渲染窗口守卫（K67）：引擎 `Renderer._render` 渲染期会**先把 `renderer.root` 置 null**、
 * 再由异步布局回填（分片执行，跨多个宏任务，见 `RESET_LAYOUT_ROOT_WAIT_*` 注释）。
 * 窗口期内执行 RESET_LAYOUT 会遍历 null 根并在回调首行抛
 * `TypeError: Cannot set properties of null (setting 'customLeft')`（用户实测）。
 * 故 root 缺失时不是立即执行，而是等回填后再执行（超上限只记日志、不抛）。
 * 返回 true = 已受理（含延后到本轮渲染结束的情形）。
 */
export function arrangeMindMap(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	try {
		if (typeof mindMap.execCommand !== 'function') {
			return false;
		}
		if (getRenderRoot(mindMap)) {
			execResetLayoutAndFit(mindMap);
			return true;
		}
		waitRenderRootThenArrange(mindMap);
		return true;
	} catch (error) {
		console.error('自动整理失败', error);
		return false;
	}
}

/** RESET_LAYOUT + 延时 fit（成功路径唯一实现：即时执行与等待回填两条路径共用） */
function execResetLayoutAndFit(mindMap: MindMap): void {
	mindMap.execCommand(ENGINE_COMMANDS.RESET_LAYOUT);
	scheduleEngineTimer(
		mindMap,
		() => fitMindMap(mindMap),
		RESET_LAYOUT_VIEWPORT_DELAY_MS,
	);
}

/**
 * 渲染窗口期内（root 暂缺）轮询等待回填后再整理（K67）。
 * 超时（渲染链中断等异常态）只记日志：与既有的 catch 口径一致，
 * 不向调用方抛错、不打断视图交互。
 */
function waitRenderRootThenArrange(mindMap: MindMap): void {
	const deadline = Date.now() + RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS;
	const attempt = (): void => {
		if (getRenderRoot(mindMap)) {
			try {
				execResetLayoutAndFit(mindMap);
			} catch (error) {
				console.error('自动整理失败', error);
			}
			return;
		}
		if (Date.now() >= deadline) {
			console.error('自动整理失败：渲染根在等待上限内未回填');
			return;
		}
		scheduleEngineTimer(mindMap, attempt, RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS);
	};
	scheduleEngineTimer(mindMap, attempt, RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS);
}
