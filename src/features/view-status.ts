/**
 * 状态栏：节点计数展示（带节流与尾随刷新）。从 view.ts 拆出。
 *
 * 节流经 concurrency.createThrottler 原语（trailingResetsWindow：尾随执行后
 * 重置窗口——高频编辑停止后最终计数立即可见，下一次事件不被上一窗口再推迟）。
 * 节流器按视图 WeakMap 持有，视图关闭时调用 cancelStatusBarUpdate 取消尾随刷新。
 * 状态栏 DOM 归插件层 StatusBarService 所有，本模块只广播计数/清空。
 */
import { countTreeNodes, getRenderRoot } from '../mindmap';
import { createThrottler, type Throttler } from '../concurrency';
import type { MindMapViewContext } from './view-context';

/** 节点计数节流窗口（data_change 高频事件下避免每次全树遍历） */
const STATUS_BAR_THROTTLE_MS = 300;

/** 按视图持有的节流器（WeakMap：视图关闭后可回收） */
const throttlers = new WeakMap<MindMapViewContext, Throttler>();

function throttlerOf(view: MindMapViewContext): Throttler {
	let throttler = throttlers.get(view);
	if (!throttler) {
		throttler = createThrottler(STATUS_BAR_THROTTLE_MS, {
			trailingResetsWindow: true,
		});
		throttlers.set(view, throttler);
	}
	return throttler;
}

/** 更新状态栏节点计数（高频事件下节流，尾随刷新保证最终显示最新值） */
export function updateStatusBar(view: MindMapViewContext): void {
	// 无状态栏（插件设置关闭）时零开销：不节流、不遍历计数
	if (!view.plugin.statusBar.available) {
		return;
	}
	if (!view.mindMap) {
		view.plugin.statusBar.clear();
		return;
	}
	// 引擎可能在调度与尾随触发之间被销毁（刷新/关闭），回调内重查
	throttlerOf(view).run(() => {
		if (!view.mindMap) {
			view.plugin.statusBar.clear();
			return;
		}
		try {
			const count = countTreeNodes(getRenderRoot(view.mindMap));
			view.plugin.statusBar.showNodeCount(count);
		} catch {
			view.plugin.statusBar.clear();
		}
	});
}

/** 取消未决的尾随刷新（视图关闭时调用） */
export function cancelStatusBarUpdate(view: MindMapViewContext): void {
	throttlers.get(view)?.cancel();
}
