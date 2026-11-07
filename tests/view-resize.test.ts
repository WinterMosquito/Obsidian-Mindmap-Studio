/**
 * 大图 resize 策略回归（`MindMapView.onResize`，2026-11-04）。
 *
 * 背景（实机实测）：5000 节点图单轮 `engine.resize()` → 整树 `render()` 的同步
 * 长任务 ≈0.4 s；100 ms 节流在 1.2 s 拖动里仍排 5 轮（长任务合计 1.58 s、4 个
 * >50 ms 卡顿帧）。故 ≥ `LARGE_MAP_RENDER_HINT_NODES` 时改用**尾随合并**：
 * 拖动期间只重置计时器，停止 `RESIZE_DEFER_MS` 后做一次；小图仍走 100 ms 节流
 * （实时跟手）。
 *
 * 为什么用原型实例：构造函数会建引擎控制器 / 保存管线 / 文档服务（真实 App 与
 * DOM 不在断言面内）；`onResize` 只读少量字段与两个私有方法，原型实例 + 铺字段
 * 与真实实例在该路径上等价（同 `view-md-back-mode.test.ts` 的口径）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindMapView } from '../src/features/view';

const mocks = vi.hoisted(() => ({
	countMindMapNodes: vi.fn<(mindMap: unknown) => number>(),
}));

// 引擎面整体桩掉（vendor bundle 顶层访问 document；本文件只关心调度决策）。
// 只提供本路径用到的计数入口，其余导出缺失不影响（同 view-md-back-mode 口径）。
vi.mock('../src/engine/mindmap', () => ({
	countMindMapNodes: mocks.countMindMapNodes,
}));

interface Harness {
	view: MindMapView;
	engine: { resize: ReturnType<typeof vi.fn> };
	remeasure: { syncVisibility: ReturnType<typeof vi.fn> };
	throttler: {
		run: ReturnType<typeof vi.fn>;
		cancel: ReturnType<typeof vi.fn>;
	};
}

/**
 * 建「只关心 resize 调度」的视图实例。
 *
 * `resizeThrottler.run` 桩成立即执行（与真实节流器的首调用语义一致）；
 * `containerEl.win` 用全局定时器，`vi.useFakeTimers()` 可直接推进。
 */
function createView(nodeCount: number): Harness {
	// `MindMapView.mindMap` 是只读 getter（返回 this.engine.mindMap）：给引擎桩
	// 一个 mindMap 字段即可，不要试图给视图直接赋值。
	const engine = { resize: vi.fn(), mindMap: {} };
	const remeasure = { syncVisibility: vi.fn() };
	const throttler = {
		run: vi.fn((fn: () => void) => fn()),
		cancel: vi.fn(),
	};
	const view = Object.create(MindMapView.prototype) as MindMapView;
	Object.assign(view, {
		engine,
		contentRemeasure: remeasure,
		resizeThrottler: throttler,
		containerEl: { win: globalThis },
		resizeDeferTimer: null,
	});
	mocks.countMindMapNodes.mockReturnValue(nodeCount);
	return { view, engine, remeasure, throttler };
}

beforeEach(() => {
	vi.useFakeTimers();
	mocks.countMindMapNodes.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('onResize：小图（< 1000 节点）走 100ms 节流', () => {
	it('立即执行一次 resize + 可见性采样（实时跟手）', () => {
		const { view, engine, remeasure, throttler } = createView(500);

		view.onResize();

		expect(throttler.run).toHaveBeenCalledTimes(1);
		expect(throttler.cancel).not.toHaveBeenCalled();
		expect(engine.resize).toHaveBeenCalledTimes(1);
		expect(remeasure.syncVisibility).toHaveBeenCalledTimes(1);
	});

	it('阈值边界：999 走节流，1000 走尾随', () => {
		const small = createView(999);
		small.view.onResize();
		expect(small.engine.resize).toHaveBeenCalledTimes(1);

		const large = createView(1000);
		large.view.onResize();
		expect(large.engine.resize).not.toHaveBeenCalled();
	});
});

describe('onResize：大图（>= 1000 节点）尾随合并', () => {
	it('拖动期间不重排；停止 180ms 后只重排一次', () => {
		const { view, engine, remeasure, throttler } = createView(5000);

		// 1.2s 拖动：每 50ms 一次尺寸变化（模拟 24 个 resize 事件）
		for (let i = 0; i < 24; i++) {
			view.onResize();
			vi.advanceTimersByTime(50);
			expect(engine.resize).not.toHaveBeenCalled();
		}
		// 每次尺寸变化都取消小图节流器（避免旧节拍多排一轮）
		expect(throttler.cancel).toHaveBeenCalledTimes(24);

		// 停止未满窗口：仍不重排（最后一次 onResize 后已过 50ms，再走 129ms = 179）
		vi.advanceTimersByTime(129);
		expect(engine.resize).not.toHaveBeenCalled();

		// 窗口到期（180ms）：恰好一次
		vi.advanceTimersByTime(1);
		expect(engine.resize).toHaveBeenCalledTimes(1);
		expect(remeasure.syncVisibility).toHaveBeenCalledTimes(1);
	});

	it('拖动中连续触发只保留最后一个计时器（不累积多轮）', () => {
		const { view, engine } = createView(5000);

		view.onResize();
		vi.advanceTimersByTime(100);
		view.onResize(); // 重置窗口
		vi.advanceTimersByTime(100);
		view.onResize();
		vi.advanceTimersByTime(179);
		expect(engine.resize).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(engine.resize).toHaveBeenCalledTimes(1);
	});

	it('cancelDeferredResize：关闭 / 换文件后不再落到已销毁的引擎', () => {
		const { view, engine } = createView(5000);

		view.onResize();
		// 私有方法：与 onClose / onUnloadFile 的调用点同一实现
		(view as unknown as { cancelDeferredResize(): void }).cancelDeferredResize();
		vi.advanceTimersByTime(1000);

		expect(engine.resize).not.toHaveBeenCalled();
	});

	it('从大图切到小图：新尺寸走节流（旧尾随已取消）', () => {
		const { view, engine, throttler } = createView(5000);
		view.onResize();
		expect(engine.resize).not.toHaveBeenCalled();

		// 换到小图（文件切换后同一视图实例）
		mocks.countMindMapNodes.mockReturnValue(300);
		view.onResize();

		expect(throttler.run).toHaveBeenCalledTimes(1);
		expect(engine.resize).toHaveBeenCalledTimes(1);
		// 旧尾随已被新策略取消：再推进也不会有第二轮
		vi.advanceTimersByTime(1000);
		expect(engine.resize).toHaveBeenCalledTimes(1);
	});
});
