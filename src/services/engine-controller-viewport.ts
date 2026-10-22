/**
 * 「视口会话」：引擎控制器里那组**跨时机**的视口状态。
 *
 * 从 `services/engine-controller.ts` 拆出（2026-10-22，**只搬状态、不改控制流**）。
 *
 * 为什么单独立一个类：这六个字段过去散在控制器身上，被三个不同时机读写——
 * 创建期（`renderMindMap` 绑 `node_tree_render_end`、排 150ms 兜底）、
 * 销毁期（`destroyInstance` / `invalidateInit` 清空）、交互期
 * （`scheduleViewportRecenter` 的 200ms 补正、节点拖拽后的灯箱抑制）。
 * 三个时机各改一半，谁负责清空全靠读代码。收进这里后**清空只有一处**
 * （`reset()`），控制器只保留算法（`restoreOrFitViewport` 等）对这些状态的读写。
 *
 * 刻意**不放**任何引擎调用（`getViewportSignature` / `applyViewportState` /
 * `centerContentAtFullScale`）：它们要 `MindMap` 实例与 deps，留在控制器里；
 * 本类只做「值 + 值的转换」，因而无需 `MindMap` 类型、也无从制造循环依赖。
 *
 * 时序契约（搬动时逐字保留，勿合并或改序）：
 * - 首帧恢复延时 `VIEWPORT_RESTORE_DELAY_MS`(150ms)；
 * - 补居中延时 `VIEWPORT_RECENTER_DELAY_MS`(200ms)，必须**大于**首帧恢复，
 *   否则补正中会在默认视口设置之前判定签名；
 * - 首帧重算预算初值 2（见 `beginInitialWindow`）。
 */
export class ViewportSession {
	/** 首帧后的视口恢复定时器（销毁/作废时取消，避免对已销毁引擎求值） */
	restoreTimer: number | null = null;

	/**
	 * 补居中定时器（图片尺寸回灌等首帧后才落定的几何变化）。
	 * 仅当打开时设置的是默认视口（未恢复保存视口、用户未移动）时才生效。
	 */
	recenterTimer: number | null = null;

	/**
	 * 默认视口签名（scale|x|y；null＝无默认视口：已恢复保存视口、用户已移动
	 * 或读取失败）。补居中据此判定「当前视口是否仍是打开时自动设置的那个」。
	 */
	defaultSignature: string | null = null;

	/**
	 * 首帧窗口剩余的「默认视口重算」次数：引擎首次布局与 resize 触发的再布局
	 * 都会让内容整体位移——窗口内每次布局落地都重算，用尽即停手（之后的
	 * 重渲染不再抢视口）。
	 */
	recalcBudget = 0;

	/** 本会话打开时恢复了用户保存的视口：停用一切自动化视口干预 */
	restoredSaved = false;

	/** 上次节点拖拽结束时间（拖拽落点仍在图片上时浏览器仍派发 click → 抑制灯箱） */
	lastNodeDragEndAt = 0;

	/** 取消首帧后的视口恢复（幂等） */
	cancelRestore(): void {
		if (this.restoreTimer !== null) {
			window.clearTimeout(this.restoreTimer);
			this.restoreTimer = null;
		}
	}

	/** 取消挂起的补居中（幂等） */
	cancelRecenter(): void {
		if (this.recenterTimer !== null) {
			window.clearTimeout(this.recenterTimer);
			this.recenterTimer = null;
		}
	}

	/**
	 * 引擎销毁 / 初始化作废：清空全部视口状态。
	 *
	 * 两处调用点（`destroyInstance` / `invalidateInit`）此前各抄一份「取消两个
	 * 定时器 + 清三个标记」，正是硬规则「不造第二份判定」的典型残留。
	 */
	reset(): void {
		this.cancelRestore();
		this.cancelRecenter();
		this.defaultSignature = null;
		this.recalcBudget = 0;
		this.restoredSaved = false;
	}

	/**
	 * 新引擎创建时开启「首帧重算窗口」：预算固定 2 次
	 * （首次布局 + resize 触发的那次再布局）。
	 */
	beginInitialWindow(): void {
		this.recalcBudget = 2;
	}

	/**
	 * 布局落地时是否还能重算一次：预算用尽、或用户已移动视口（与打开时自动
	 * 设的签名不一致）即停手。
	 *
	 * 返回 true = 调用方应执行一次 `restoreOrFitViewport()`（并在成功后
	 * 自行 `defaultSignature` 更新）；本方法只负责**判定与扣减**。
	 */
	canRecalcOnRender(currentSignature: string | null): boolean {
		if (this.restoredSaved || this.recalcBudget <= 0) {
			return false;
		}
		const applied = this.defaultSignature;
		if (applied !== null && currentSignature !== applied) {
			// 视口已不是打开时自动设置的那个（用户平移/缩放）：停手
			this.recalcBudget = 0;
			return false;
		}
		this.recalcBudget--;
		return true;
	}
}
