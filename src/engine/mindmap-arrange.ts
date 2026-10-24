/**
 * 「自动整理」编排：`RESET_LAYOUT`（清除自由拖拽坐标）+ 渲染根未回填时的轮询等待（K67）。
 *
 * 从 `engine/mindmap.ts` 拆出（2026-10-22，纯搬移，零行为改动）。三条路径
 * （即时执行 / 等回填后执行 / 超时只记日志）共用同一份 `execResetLayout`，
 * 拆开会让「成功路径唯一实现」这条约束失效，故三者必须同文件。
 *
 * **视口口径**（2026-10-24 用户裁决，见 K18）：整理默认**不改视口**——按下「整理」
 * 不该被夺走当前视野；`fitView: true` 只给「视口已被引擎重置」的调用方（切换布局）。
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

/** 整理选项（不导出：调用方传对象字面量，对外只留 `arrangeMindMap` 一个符号） */
interface ArrangeMindMapOptions {
	/** 整理后是否适应画布。缺省 `false` = 保留当前缩放与平移（仅切布局路径为 `true`） */
	fitView?: boolean;
}

/**
 * 自动整理：清除所有节点被自由拖拽后的自定义位置，重新按当前布局算法计算位置，
 * 使各主题以合理间距对齐摆放。**默认保留当前视口**（见文件头「视口口径」）。
 *
 * 用引擎内置的「重置布局」（`RESET_LAYOUT`）而非全量 `setData`：后者会经
 * `handleData` / `renderer.setData` 重新初始化布局、可能重排 children，打乱用户
 * 手动排好的节点顺序；`resetLayout` 只逐个节点清 `customLeft/customTop` 后重渲染。
 *
 * 渲染窗口守卫（K67）：`Renderer._render` 期间 `renderer.root` 先置 null、再由
 * 异步布局回填（分片执行，跨多个宏任务），窗口期内执行 RESET_LAYOUT 会遍历
 * null 根并抛 `TypeError: Cannot set properties of null`。故 root 缺失时按
 * `RESET_LAYOUT_ROOT_WAIT_*` 轮询等待，超上限只记日志、不抛。
 *
 * @returns true = 已受理（含延后到本轮渲染结束的情形）
 */
export function arrangeMindMap(
	mindMap: MindMap | null,
	options: ArrangeMindMapOptions = {},
): boolean {
	if (!mindMap) {
		return false;
	}
	// 归一在一处：内部两条路径只认布尔，后续加选项也不必再扩内部签名
	const fitView = options.fitView === true;
	try {
		if (typeof mindMap.execCommand !== 'function') {
			return false;
		}
		if (getRenderRoot(mindMap)) {
			execResetLayout(mindMap, fitView);
			return true;
		}
		waitRenderRootThenArrange(mindMap, fitView);
		return true;
	} catch (error) {
		console.error('自动整理失败', error);
		return false;
	}
}

/** RESET_LAYOUT +（可选）延时 fit（即时执行与等待回填两条路径共用） */
function execResetLayout(mindMap: MindMap, fitView: boolean): void {
	mindMap.execCommand(ENGINE_COMMANDS.RESET_LAYOUT);
	if (!fitView) {
		return;
	}
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
function waitRenderRootThenArrange(mindMap: MindMap, fitView: boolean): void {
	const deadline = Date.now() + RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS;
	const attempt = (): void => {
		if (getRenderRoot(mindMap)) {
			try {
				execResetLayout(mindMap, fitView);
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
