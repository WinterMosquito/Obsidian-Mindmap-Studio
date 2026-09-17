/**
 * 状态栏：节点计数展示（带节流与尾随刷新）。从 view.ts 拆出。
 *
 * 节流经 concurrency.createThrottler 原语（trailingResetsWindow：尾随执行后
 * 重置窗口——高频编辑停止后最终计数立即可见，下一次事件不被上一窗口再推迟）。
 * 节流器按视图 WeakMap 持有，视图关闭时调用 cancelStatusBarUpdate 取消尾随刷新。
 * 状态栏 DOM 归插件层 StatusBarService 所有，本模块只广播计数/清空。
 *
 * ## 为什么走**渲染树**是正确且划算的（2026-09-16 实证，勿再「优化」成增量维护）
 * 性能模式（`removeNodeWhenOutCanvas`）**只把视口外节点摘出 DOM**
 * ——vendor 实测 `node.removeSelf()` = `this.group.remove()` + 移除泛化连线，
 * **不碰 `parent.children`** ⇒ 渲染树结构始终完整、节点实例齐全
 * （`verify:visual` 的 **count 探针**：阈值 1 强制开启性能模式的 151 节点地图，
 * 渲染树计数 151 / DOM 仅 11 组）。故：
 * - 计数正确性：不会漏计（早期注释「移出渲染树会漏计」是错的）；
 * - 成本：纯指针遍历、零分配、300ms 节流（每次数据变更最多 ~3 次/秒）；
 * - 反例代价：增量维护要覆盖引擎**自带快捷键**（Tab/Enter/Shift+Tab/Del/Backspace
 *   直接 execCommand 插入删除，绕过插件包装）与整树替换路径，漏一处即长期漂移。
 */
import { countTreeNodes, getRenderRoot } from '../engine/mindmap';
import { createThrottler, type Throttler } from '../core/concurrency';
import type { MindMapViewContext } from './view-context';

/**
 * 状态栏子系统所需的最窄访问面：引擎实例 + 插件服务（状态栏展示）。
 * R4 上下文瘦身示范：不依赖整个装配面（MindMapView 结构化实现，传入即兼容）。
 */
type StatusViewContext = Pick<MindMapViewContext, 'mindMap' | 'plugin'>;

/** 节点计数节流窗口（data_change 高频事件下避免每次全树遍历） */
const STATUS_BAR_THROTTLE_MS = 300;

/** 按视图持有的节流器（WeakMap：视图关闭后可回收） */
const throttlers = new WeakMap<StatusViewContext, Throttler>();

function throttlerOf(view: StatusViewContext): Throttler {
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
export function updateStatusBar(view: StatusViewContext): void {
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
export function cancelStatusBarUpdate(view: StatusViewContext): void {
	throttlers.get(view)?.cancel();
}
