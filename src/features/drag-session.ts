/**
 * 窗口级拖拽会话原语（mousemove/mouseup 临时监听 + rAF 合帧 + 幂等收尾）。
 *
 * 收口缘由（2026-10-07）：`image-resize`（拖宽手势）与 `drag-target`（拖拽换父
 * 辅助）各自实现了一份**逐行同构**的会话原语——同样的
 * 「win.addEventListener ×2 → move 里 `if (rafId === null) requestAnimationFrame`
 * → 收尾 `cancelAnimationFrame` + `removeEventListener ×2」，约 40 行。
 * 两者唯一的语义差异是**注册是否带捕获标志**，而该差异此前只能靠两处代码各自
 * 注释说明，已经实际分叉过一次（见下方 `capture` 参数）。
 *
 * 归入 features 层而非 core：`core/` 是零依赖纯逻辑层（禁 DOM），而本原语
 * 直接操作 `Window` 事件与 `requestAnimationFrame`。
 *
 * 事件语义（两条**不同**的合约，勿混用）：
 * - `onMove` **逐事件**触发、不合并——调用方需要每个 mousemove 都算状态
 *   （调宽要按 clientX 递推尺寸并记 latest）。
 * - `onFrame` 至多每帧一次，由调用方显式 `scheduleFrame()` 排期——判定是全树
 *   O(n) 的活，按帧率而非事件频率计价（大图 + 高回报率鼠标下事件频率可达帧率
 *   数倍）。调用方通常在 `onMove` 里只写「待处理」状态、在 `onFrame` 里消费它。
 */

/** 窗口级拖拽会话句柄：合帧排期 + 幂等收尾 */
export interface WindowDragSession {
	/**
	 * 请求一次合帧回调。同一帧内多次调用只执行一次 `onFrame`（rAF 合帧）；
	 * 会话已 `end()` 时为空操作（陈旧帧不得再落地，见 `end` 说明）。
	 */
	scheduleFrame(): void;
	/**
	 * 结束会话：取消在途帧 + 摘除两个监听。**幂等**（重复调用无副作用）。
	 *
	 * 收尾后已排期的帧会被取消且不再执行 `onFrame` —— 这是「引擎重建 /
	 * 会话被换掉后陈旧帧不得写入」的实现点。
	 */
	end(): void;
}

/** {@link startWindowDragSession} 的参数 */
export interface WindowDragSessionOptions {
	/**
	 * 事件源窗口（**必须**传 `view.containerEl.win`，不能用全局 `window`）。
	 *
	 * 理由：本插件支持 popout 窗口，鼠标事件不落在主窗口，用全局 window 会
	 * 完全收不到事件。
	 */
	win: Window;
	/** 鼠标移动（逐事件触发，不做合帧） */
	onMove: (event: MouseEvent) => void;
	/**
	 * 鼠标松开。调用时本原语**已**撤除监听并取消在途帧（顺序固定，见下）。
	 *
	 * 为何「先撤后回调」：回调里要提交最终状态（如调宽的收尾尺寸写回），
	 * 此时不应再有残留监听把新输入算进旧会话。
	 */
	onUp: () => void;
	/** 帧回调：至多每帧一次，由 `scheduleFrame()` 排期 */
	onFrame: () => void;
	/**
	 * 捕获阶段注册（默认 false）。
	 *
	 * - `true`：**手势独占**。注册先于引擎容器级监听执行，配合 `onMove` 内的
	 *   `stopPropagation()` 让引擎收不到事件（调宽用，避免缩放拖拽被节点拖拽
	 *   逻辑串扰）。移除时必须带**同款**标志，否则监听摘不掉。
	 * - `false`：与引擎监听并存（换父辅助用，它只观察事件、不夺）。
	 */
	capture?: boolean;
}

/**
 * 建立窗口级拖拽会话：挂上 mousemove/mouseup 临时监听，返回合帧排期与幂等收尾句柄。
 *
 * 典型用法（调宽/ 换父辅助同款形状）：
 * ```ts
 * const session = startWindowDragSession({
 *   win: view.containerEl.win,
 *   capture: true,
 *   onMove: (event) => { pending = event; session.scheduleFrame(); },
 *   onFrame: () => { const p = pending; pending = null; if (p) handle(p); },
 *   onUp: () => commitFinal(),
 * });
 * ```
 */
export function startWindowDragSession(
	options: WindowDragSessionOptions,
): WindowDragSession {
	const { win, onMove, onUp, onFrame, capture = false } = options;
	let rafId: number | null = null;
	let ended = false;

	const moveListener = (event: MouseEvent): void => {
		onMove(event);
	};
	const upListener = (): void => {
		// 先撤后回调（顺序契约见 WindowDragSessionOptions.onUp）
		session.end();
		onUp();
	};
	const session: WindowDragSession = {
		scheduleFrame(): void {
			if (rafId !== null || ended) {
				return;
			}
			rafId = win.requestAnimationFrame(() => {
				rafId = null;
				if (!ended) {
					onFrame();
				}
			});
		},
		end(): void {
			if (ended) {
				return;
			}
			ended = true;
			if (rafId !== null) {
				win.cancelAnimationFrame(rafId);
				rafId = null;
			}
			// 摘除须带与注册**同款**的 capture 标志（见 options.capture 说明）
			win.removeEventListener('mousemove', moveListener, capture);
			win.removeEventListener('mouseup', upListener, capture);
		},
	};
	win.addEventListener('mousemove', moveListener, capture);
	win.addEventListener('mouseup', upListener, capture);
	return session;
}
