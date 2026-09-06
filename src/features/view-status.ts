/**
 * 状态栏：节点计数展示（带节流与尾随刷新）。从 view.ts 拆出。
 *
 * 节流状态内聚在本模块（WeakMap 按视图持有），视图类不再暴露
 * 节流字段；视图关闭时调用 cancelStatusBarUpdate 取消尾随刷新。
 */
import { t } from '../i18n';
import { countTreeNodes, getRenderRoot } from '../mindmap';
import type { MindMapViewContext } from './view-context';

/** 节点计数节流窗口（data_change 高频事件下避免每次全树遍历） */
const STATUS_BAR_THROTTLE_MS = 300;

/** 按视图持有的节流状态（WeakMap：视图关闭后可回收） */
interface StatusBarThrottleState {
	lastUpdate: number;
	trailingTimer: number | null;
}

const throttleStates = new WeakMap<MindMapViewContext, StatusBarThrottleState>();

function stateOf(view: MindMapViewContext): StatusBarThrottleState {
	let state = throttleStates.get(view);
	if (!state) {
		state = { lastUpdate: 0, trailingTimer: null };
		throttleStates.set(view, state);
	}
	return state;
}

/** 更新状态栏节点计数（高频事件下节流，尾随定时器保证最终显示最新值） */
export function updateStatusBar(view: MindMapViewContext): void {
	if (!view.plugin.statusBarEl) {
		return;
	}
	if (!view.mindMap) {
		view.plugin.statusBarEl.setText('');
		return;
	}
	const state = stateOf(view);
	const now = Date.now();
	if (now - state.lastUpdate < STATUS_BAR_THROTTLE_MS) {
		if (state.trailingTimer === null) {
			state.trailingTimer = window.setTimeout(() => {
				state.trailingTimer = null;
				state.lastUpdate = 0;
				updateStatusBar(view);
			}, STATUS_BAR_THROTTLE_MS);
		}
		return;
	}
	state.lastUpdate = now;
	try {
		const count = countTreeNodes(getRenderRoot(view.mindMap));
		view.plugin.statusBarEl.setText(`${count} ${t(view.lang, 'common.nodes')}`);
	} catch {
		view.plugin.statusBarEl.setText('');
	}
}

/** 取消未决的尾随刷新（视图关闭时调用） */
export function cancelStatusBarUpdate(view: MindMapViewContext): void {
	const state = throttleStates.get(view);
	if (state && state.trailingTimer !== null) {
		window.clearTimeout(state.trailingTimer);
		state.trailingTimer = null;
	}
}
