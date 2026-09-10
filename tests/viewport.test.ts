/**
 * 视口收口回归（src/mindmap.ts 的三个防腐函数）。
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
 *   children 顺序），延时后走 `resetZoom` 而非 fit 全图。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import { RESET_LAYOUT_VIEWPORT_DELAY_MS } from '../src/constants';
import {
	arrangeMindMap,
	centerContentAtFullScale,
	resetZoom,
} from '../src/mindmap';

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
	options: { openPerformance?: boolean; hasDraw?: boolean; hasElRect?: boolean } = {},
) {
	const { openPerformance = false, hasDraw = true, hasElRect = true } = options;
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
});

describe('arrangeMindMap（执行 RESET_LAYOUT 后重置缩放，不再 fit 全图）', () => {
	it('走引擎 RESET_LAYOUT 命令，延时后以画布中心回到 100%', () => {
		vi.useFakeTimers();
		const { mindMap, execCommand, setScale, fit, translateXY } = makeMindMap();

		expect(arrangeMindMap(mindMap)).toBe(true);
		// 断言字面量：常量表键名与引擎命令名必须一致（拼错时此处即刻失败）
		expect(execCommand).toHaveBeenCalledExactlyOnceWith('RESET_LAYOUT');

		// 延时结束前不调整视口：等引擎完成 reflow，否则按旧布局算锚点
		expect(setScale).not.toHaveBeenCalled();

		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS);

		expect(setScale).toHaveBeenCalledExactlyOnceWith(1, 400, 300);
		// 不再 fit 全图（大图会被压到文字不可读），也不平移（resetZoom 不改屏幕位置）
		expect(fit).not.toHaveBeenCalled();
		expect(translateXY).not.toHaveBeenCalled();
	});

	it('延时边界：不足 RESET_LAYOUT_VIEWPORT_DELAY_MS 时不触发', () => {
		vi.useFakeTimers();
		const { mindMap, setScale } = makeMindMap();

		arrangeMindMap(mindMap);
		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS - 1);
		expect(setScale).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(setScale).toHaveBeenCalledTimes(1);
	});

	it('命令抛错时返回 false、不排定时器、不抛异常', () => {
		vi.useFakeTimers();
		const errorSpy = spyConsoleError();
		const { mindMap, execCommand, setScale } = makeMindMap();
		execCommand.mockImplementation(() => {
			throw new Error('命令未注册');
		});

		expect(arrangeMindMap(mindMap)).toBe(false);
		expect(errorSpy).toHaveBeenCalledWith('自动整理失败', expect.anything());
		expect(vi.getTimerCount()).toBe(0);

		vi.advanceTimersByTime(RESET_LAYOUT_VIEWPORT_DELAY_MS);
		expect(setScale).not.toHaveBeenCalled();
	});

	it('引擎缺失 / 无 execCommand 时返回 false', () => {
		expect(arrangeMindMap(null)).toBe(false);
		expect(arrangeMindMap({} as unknown as MindMap)).toBe(false);
	});
});
