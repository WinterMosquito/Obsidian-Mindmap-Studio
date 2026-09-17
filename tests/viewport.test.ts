/**
 * 视口收口回归（src/engine/mindmap.ts 的三个防腐函数）。
 *
 * 为什么这样断言：
 * - `centerContentAtFullScale`（打开时的默认视口）：需求是「100% 缩放 + **整体内容
 *   包围盒**居中」，不是根节点居中（偏心的树会偏到一侧）、也不是 fit 全图（大图会被
 *   压到文字不可读）。实现顺序固定为「先 `setScale(1, 画布中心)` 定比例 → 再按
 *   `draw.rbox() − elRect` 得到的包围盒平移」；顺序颠倒时平移量算的是旧比例下的
 *   坐标，本文件用 invocationCallOrder 与几何不变量（平移后包围盒中心 = 画布中心）
 *   把这两点都钉住；
 * - `resetZoom`（工具栏「重置缩放」）：回到 100% 但**以画布中心为锚点**——引擎平移量
 *   相对画布原点，只 `setScale(1)`（省略锚点）会让内容绕原点跳动（表现为「视图乱飘」）。
 *   故断言 setScale 收到第二/三参，且不做任何节点居中；
 * - `arrangeMindMap`（自动整理）：只走引擎 RESET_LAYOUT（清除自由拖拽位置，不触碰
 *   children 顺序），延时后走 `fitMindMap` 适应画布（fit 全图，整理结果一览无余）。
 *   K67 起另有渲染窗口守卫：引擎渲染期 `renderer.root` 会被临时置 null（异步布局回填），
 *   此时执行 RESET_LAYOUT 会遍历 null 根并抛 TypeError（用户实测），故 root 缺失时
 *   改为等待回填后执行（超上限放弃）——本文件钉住「延后执行」与「上限放弃」两条。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import {
	RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS,
	RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS,
	RESET_LAYOUT_VIEWPORT_DELAY_MS,
} from '../src/core/constants';
import {
	arrangeMindMap,
	centerContentAtFullScale,
	isContentVisibleInCanvas,
	resetZoom,
} from '../src/engine/mindmap';

// mindmap.ts 经 import 链加载真实 vendor bundle（顶层求值触碰 document.documentElement）；
// 静态 import 先于模块体执行，故桩必须放进 vi.hoisted 才会先落地。
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

/**
 * 引擎桩：画布 800×600；内容包围盒（页面坐标）x=110 y=220 200×100，
 * 容器矩形 left=10 top=20 → 画布内包围盒 x=100 y=200 200×100。
 */
function makeMindMap(
	options: {
		openPerformance?: boolean;
		hasDraw?: boolean;
		hasElRect?: boolean;
		/** 实时容器矩形（模拟首帧后布局 settle / 工具栏重建过的容器） */
		liveRect?: { left: number; top: number; width: number; height: number };
	} = {},
) {
	const {
		openPerformance = false,
		hasDraw = true,
		hasElRect = true,
		liveRect,
	} = options;
	const setScale = vi.fn<(scale: number, cx?: number, cy?: number) => void>();
	const fit = vi.fn<() => void>();
	const moveNodeToCenter = vi.fn<() => void>();
	const translateXY = vi.fn<(x: number, y: number) => void>();
	const forceLoadNode = vi.fn<() => void>();
	const execCommand = vi.fn<(...args: unknown[]) => void>();
	const rbox = vi.fn(() => ({ x: 110, y: 220, width: 200, height: 100 }));

	const mindMap = {
		width: 800,
		height: 600,
		execCommand,
		opt: { openPerformance },
		view: { setScale, fit, translateXY },
		renderer: { root: { isRoot: true }, moveNodeToCenter, forceLoadNode },
		// 引擎中间态：draw / elRect 可能尚未就绪（measureContentBox 会返回 null）
		...(hasDraw ? { draw: { rbox } } : {}),
		...(hasElRect ? { elRect: { left: 10, top: 20 } } : {}),
		// 实时容器：首帧后容器尺寸/位置可能与引擎创建时的缓存不同
		...(liveRect ? { el: { getBoundingClientRect: () => liveRect } } : {}),
	} as unknown as MindMap;

	return {
		mindMap,
		setScale,
		fit,
		moveNodeToCenter,
		translateXY,
		forceLoadNode,
		execCommand,
	};
}

/** 静默并捕获 console.error（防腐层的降级路径都只记日志、不抛） */
function spyConsoleError() {
	return vi.spyOn(console, 'error').mockImplementation(() => {});
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('resetZoom（回到 100%，以画布中心为锚点）', () => {
	it('以画布中心为锚点缩放，且不居中任何节点（屏幕可见内容保持原位）', () => {
		const { mindMap, setScale, moveNodeToCenter, translateXY, fit } = makeMindMap();

		resetZoom(mindMap);

		// 第二/三参即锚点：引擎按新比例反推平移，使锚点处画面不动
		expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 400, 300);
		// 不居中节点、不平移、不 fit——用户要求的是「不改屏幕位置」
		expect(moveNodeToCenter).not.toHaveBeenCalled();
		expect(translateXY).not.toHaveBeenCalled();
		expect(fit).not.toHaveBeenCalled();
	});

	it('引擎缺失 / view 尚未就绪时静默（工具栏在引擎未就绪时可点）', () => {
		const { mindMap } = makeMindMap();
		(mindMap as unknown as { view?: unknown }).view = undefined;

		expect(() => resetZoom(null)).not.toThrow();
		expect(() => resetZoom(mindMap)).not.toThrow();
	});

	it('引擎抛错时只记录日志，不向调用方传播', () => {
		const errorSpy = spyConsoleError();
		const { setScale, mindMap } = makeMindMap();
		setScale.mockImplementation(() => {
			throw new Error('引擎尚未就绪');
		});

		expect(() => resetZoom(mindMap)).not.toThrow();
		expect(errorSpy).toHaveBeenCalledWith('重置缩放失败', expect.anything());
	});
});

describe('centerContentAtFullScale（100% + 整体内容居中）', () => {
	it('先以画布中心定 100%，再按包围盒平移到画布中心（不 fit 全图）', () => {
		const { mindMap, setScale, translateXY, fit } = makeMindMap();

		centerContentAtFullScale(mindMap);

		expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 400, 300);
		// 包围盒（画布坐标）= (110−10, 220−20, 200, 100) = (100, 200, 200, 100)
		// 平移量 = ((800−200)/2 − 100, (600−100)/2 − 200) = (200, 50)
		expect(translateXY).toHaveBeenCalledExactlyOnceWith(200, 50);
		expect(fit).not.toHaveBeenCalled();

		// 几何不变量：平移后包围盒中心恰好落在画布中心（而非根节点居中）
		const [dx, dy] = translateXY.mock.calls[0]!;
		expect(100 + 200 / 2 + dx).toBe(400);
		expect(200 + 100 / 2 + dy).toBe(300);
	});

	it('顺序：先定比例再平移（平移量须与新比例同一坐标系）', () => {
		const { mindMap, setScale, translateXY } = makeMindMap();

		centerContentAtFullScale(mindMap);

		expect(setScale.mock.invocationCallOrder[0]!).toBeLessThan(
			translateXY.mock.invocationCallOrder[0]!,
		);
	});

	it('性能模式：先强制渲染全部节点，包围盒才反映全图而非可见子集', () => {
		const { mindMap, forceLoadNode, setScale, translateXY } = makeMindMap({
			openPerformance: true,
		});

		centerContentAtFullScale(mindMap);

		expect(forceLoadNode).toHaveBeenCalledTimes(1);
		// forceLoadNode 必须早于 setScale（视口外节点被回收时包围盒会失真）
		expect(forceLoadNode.mock.invocationCallOrder[0]!).toBeLessThan(
			setScale.mock.invocationCallOrder[0]!,
		);
		expect(translateXY).toHaveBeenCalledTimes(1);
	});

	it('包围盒不可得（draw 缺失）：只设比例、不平移', () => {
		const { mindMap, setScale, translateXY } = makeMindMap({ hasDraw: false });

		centerContentAtFullScale(mindMap);

		expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 400, 300);
		expect(translateXY).not.toHaveBeenCalled();
	});

	it('容器矩形不可得（elRect 缺失）：同样只设比例、不平移', () => {
		const { mindMap, setScale, translateXY } = makeMindMap({ hasElRect: false });

		centerContentAtFullScale(mindMap);

		expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 400, 300);
		expect(translateXY).not.toHaveBeenCalled();
	});

	it('引擎抛错时降级为 fit 全图（至少让内容可见）', () => {
		const errorSpy = spyConsoleError();
		const { mindMap, setScale, translateXY, fit } = makeMindMap();
		setScale.mockImplementation(() => {
			throw new Error('引擎尚未就绪');
		});

		expect(() => centerContentAtFullScale(mindMap)).not.toThrow();

		expect(errorSpy).toHaveBeenCalledWith('设置默认视口失败', expect.anything());
		expect(translateXY).not.toHaveBeenCalled();
		expect(fit).toHaveBeenCalledTimes(1);
	});

	it('引擎缺失时静默', () => {
		expect(() => centerContentAtFullScale(null)).not.toThrow();
	});

	it('容器几何已变（首帧后布局 settle）：以实时容器为准，不用缓存 width/height', () => {
		// 引擎创建时缓存 800×600 / 原点(10,20)；首帧后容器变为 800×520 且上移
		const { mindMap, setScale, translateXY } = makeMindMap({
			liveRect: { left: 0, top: 40, width: 800, height: 520 },
		});

		centerContentAtFullScale(mindMap);

		// 缩放锚点 = 实时画布中心（缓存的 300 会让内容纵向偏移）
		expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 400, 260);
		// 包围盒原点换算也走实时容器：y = 220−40 = 180
		// 平移量 = ((800−200)/2 − 110, (520−100)/2 − 180) = (190, 30)
		expect(translateXY).toHaveBeenCalledExactlyOnceWith(190, 30);
	});

	it('容器几何可得时先同步引擎几何（resize），再算视口', () => {
		const resize = vi.fn<() => void>();
		const { mindMap, setScale } = makeMindMap({
			liveRect: { left: 0, top: 0, width: 800, height: 600 },
		});
		(mindMap as unknown as { resize?: () => void }).resize = resize;

		centerContentAtFullScale(mindMap);

		expect(resize).toHaveBeenCalledTimes(1);
		// 必须先同步（重读容器、更新 SVG 尺寸），后写视口
		expect(resize.mock.invocationCallOrder[0]!).toBeLessThan(
			setScale.mock.invocationCallOrder[0]!,
		);
	});
});

describe('isContentVisibleInCanvas（保存视口恢复后的落界校验）', () => {
	it('内容在画布内 → true；被保存视口推出画布 → false', () => {
		const visible = makeMindMap({
			liveRect: { left: 0, top: 0, width: 800, height: 600 },
		});
		expect(isContentVisibleInCanvas(visible.mindMap)).toBe(true);

		const outside = makeMindMap({
			liveRect: { left: 0, top: 0, width: 800, height: 600 },
		});
		(outside.mindMap as unknown as { draw: { rbox: unknown } }).draw.rbox = () => ({
			x: 5000,
			y: 5000,
			width: 200,
			height: 100,
		});
		expect(isContentVisibleInCanvas(outside.mindMap)).toBe(false);
	});

	it('NaN 包围盒（保存视口损坏）→ false（回退居中）', () => {
		const broken = makeMindMap({
			liveRect: { left: 0, top: 0, width: 800, height: 600 },
		});
		(broken.mindMap as unknown as { draw: { rbox: unknown } }).draw.rbox = () => ({
			x: NaN,
			y: NaN,
			width: NaN,
			height: NaN,
		});
		expect(isContentVisibleInCanvas(broken.mindMap)).toBe(false);
	});

	it('性能模式 / 引擎结构不可得 → null（fail-open，不误伤合法视口恢复）', () => {
		// 性能模式：视口外节点被回收，rbox 只覆盖已加载子集，判定不可靠
		expect(
			isContentVisibleInCanvas(makeMindMap({ openPerformance: true }).mindMap),
		).toBeNull();
		expect(isContentVisibleInCanvas(makeMindMap({ hasDraw: false }).mindMap)).toBeNull();
		expect(isContentVisibleInCanvas(null)).toBeNull();
	});
});

describe('arrangeMindMap（执行 RESET_LAYOUT 后适应画布）', () => {
	it('走引擎 RESET_LAYOUT 命令，延时后 fit 全图', () => {
		vi.useFakeTimers();
		const { mindMap, execCommand, setScale, fit, translateXY } = makeMindMap();

		expect(arrangeMindMap(mindMap)).toBe(true);
		// 断言字面量：常量表键名与引擎命令名必须一致（拼错时此处即刻失败）
		expect(execCommand).toHaveBeenCalledExactlyOnceWith('RESET_LAYOUT');

		// 延时结束前不调整视口：等引擎完成 reflow，否则按旧布局算缩放
		expect(fit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS);

		expect(fit).toHaveBeenCalledTimes(1);
		// 适应画布即引擎 fit：不单独设比例、不平移
		expect(setScale).not.toHaveBeenCalled();
		expect(translateXY).not.toHaveBeenCalled();
	});

	it('延时边界：不足 RESET_LAYOUT_VIEWPORT_DELAY_MS 时不触发', () => {
		vi.useFakeTimers();
		const { mindMap, fit } = makeMindMap();

		arrangeMindMap(mindMap);
		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS - 1);
		expect(fit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(fit).toHaveBeenCalledTimes(1);
	});

	it('渲染窗口期（root 暂缺）：延后到回填后再执行 RESET_LAYOUT', () => {
		vi.useFakeTimers();
		const { mindMap, execCommand, fit } = makeMindMap();
		const renderer = (mindMap as unknown as { renderer: { root: unknown } })
			.renderer;
		renderer.root = null;

		expect(arrangeMindMap(mindMap)).toBe(true);
		// 窗口期内立即执行会遍历 null 根并在回调首行抛 TypeError（见 K67）
		expect(execCommand).not.toHaveBeenCalled();

		// 仍缺失：持续等待（未到上限既不执行也不放弃）
		vi.advanceTimersByTime(RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS * 3);
		expect(execCommand).not.toHaveBeenCalled();

		// 渲染结束、root 回填 → 下一个轮询点执行命令
		renderer.root = { isRoot: true };
		vi.advanceTimersByTime(RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS);
		expect(execCommand).toHaveBeenCalledExactlyOnceWith('RESET_LAYOUT');

		// fit 仍按原延时（等引擎 reflow）
		expect(fit).not.toHaveBeenCalled();
		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS);
		expect(fit).toHaveBeenCalledTimes(1);
	});

	it('渲染根在等待上限内未回填：放弃、只记日志、不执行命令', () => {
		vi.useFakeTimers();
		const errorSpy = spyConsoleError();
		const { mindMap, execCommand, fit } = makeMindMap();
		(mindMap as unknown as { renderer: { root: unknown } }).renderer.root = null;

		expect(arrangeMindMap(mindMap)).toBe(true);

		vi.advanceTimersByTime(
			RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS + RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS,
		);

		expect(execCommand).not.toHaveBeenCalled();
		expect(fit).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledWith(
			'自动整理失败：渲染根在等待上限内未回填',
		);
		// 等待链已终止：不再排定时器
		expect(vi.getTimerCount()).toBe(0);
	});

	it('命令抛错时返回 false、不排定时器、不抛异常', () => {
		vi.useFakeTimers();
		const errorSpy = spyConsoleError();
		const { mindMap, execCommand, fit } = makeMindMap();
		execCommand.mockImplementation(() => {
			throw new Error('命令未注册');
		});

		expect(arrangeMindMap(mindMap)).toBe(false);
		expect(errorSpy).toHaveBeenCalledWith('自动整理失败', expect.anything());
		expect(vi.getTimerCount()).toBe(0);

		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS);
		expect(fit).not.toHaveBeenCalled();
	});

	it('引擎缺失 / 无 execCommand 时返回 false', () => {
		expect(arrangeMindMap(null)).toBe(false);
		expect(arrangeMindMap({} as unknown as MindMap)).toBe(false);
	});
});
