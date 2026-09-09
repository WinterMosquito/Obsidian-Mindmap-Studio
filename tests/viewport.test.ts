/**
 * 视口动作回归：
 * - `resetZoom`：回到 100%，**不改变平移**（屏幕位置保持；工具栏「重置缩放」按钮）；
 * - `arrangeMindMap`：执行 RESET_LAYOUT 后**重置缩放**（不再 fit 全图——
 *   大图 fit 会把比例压到文字不可读）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import {
	arrangeMindMap,
	centerContentAtFullScale,
	resetZoom,
} from '../src/mindmap';

// mindmap.ts 经 import 链加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

function makeMindMap() {
	const setScale = vi.fn<(scale: number, cx?: number, cy?: number) => void>();
	const fit = vi.fn();
	const moveNodeToCenter = vi.fn();
	const translateXY = vi.fn<(x: number, y: number) => void>();
	const forceLoadNode = vi.fn();
	const execCommand = vi.fn();
	const root = { isRoot: true };
	// 渲染内容包围盒（页面坐标）：rbox 减 elRect 得画布坐标
	const rbox = vi.fn(() => ({ x: 110, y: 220, width: 200, height: 100 }));
	const mindMap = {
		width: 800,
		height: 600,
		execCommand,
		opt: { openPerformance: false },
		view: { setScale, fit, translateXY },
		renderer: { root, moveNodeToCenter, forceLoadNode },
		draw: { rbox },
		elRect: { left: 10, top: 20 },
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

describe('resetZoom（回到 100%，以画布中心为锚点）', () => {
	it('以画布中心为锚点缩放：可见内容保持原位（不漂移、不居中节点）', () => {
		const { mindMap, setScale, moveNodeToCenter } = makeMindMap();
		resetZoom(mindMap);
		// 第二/三参即锚点：引擎按新比例反推平移，使该点画面不动
		expect(setScale).toHaveBeenCalledWith(1, 400, 300);
		// 不做任何节点居中（用户明确要求不改屏幕位置）
		expect(moveNodeToCenter).not.toHaveBeenCalled();
	});

	it('引擎缺失时静默（工具栏在引擎未就绪时可点）', () => {
		expect(() => resetZoom(null)).not.toThrow();
	});
});

/**
 * 打开时的默认视口几何（真实计算，非 mock 断言）：
 * 100% 缩放 + 内容包围盒中心落在画布中心。
 */
describe('centerContentAtFullScale（100% + 整体内容居中）', () => {
	it('先以画布中心为锚点定 100%，再按包围盒平移到画布中心', () => {
		const { mindMap, setScale, translateXY, fit } = makeMindMap();
		centerContentAtFullScale(mindMap);

		expect(setScale).toHaveBeenCalledWith(1, 400, 300);
		// 包围盒（画布坐标）：x=110-10=100, y=220-20=200, 200×100
		// 平移量 = ((800-200)/2-100, (600-100)/2-200) = (200, 50)
		expect(translateXY).toHaveBeenCalledWith(200, 50);

		// 不变量：平移后包围盒中心 = 画布中心（而非根节点居中）
		const [dx, dy] = translateXY.mock.calls[0]!;
		const boxCenterX = 100 + 200 / 2 + dx;
		const boxCenterY = 200 + 100 / 2 + dy;
		expect(boxCenterX).toBe(400);
		expect(boxCenterY).toBe(300);
		expect(fit).not.toHaveBeenCalled();
	});

	it('性能模式：先强制渲染全部节点，包围盒才可信', () => {
		const { mindMap, forceLoadNode, translateXY } = makeMindMap();
		(mindMap as unknown as { opt: { openPerformance: boolean } }).opt = {
			openPerformance: true,
		};
		centerContentAtFullScale(mindMap);
		expect(forceLoadNode).toHaveBeenCalledTimes(1);
		expect(translateXY).toHaveBeenCalledTimes(1);
	});

	it('包围盒不可得（引擎中间态）：只设比例、不平移', () => {
		const { mindMap, setScale, translateXY } = makeMindMap();
		delete (mindMap as unknown as { draw?: unknown }).draw;
		centerContentAtFullScale(mindMap);
		expect(setScale).toHaveBeenCalledWith(1, 400, 300);
		expect(translateXY).not.toHaveBeenCalled();
	});

	it('引擎缺失时静默', () => {
		expect(() => centerContentAtFullScale(null)).not.toThrow();
	});
});

describe('arrangeMindMap（整理后重置缩放，不再 fit 全图）', () => {	afterEach(() => {
		vi.useRealTimers();
	});

	it('执行 RESET_LAYOUT，延时后重置缩放且不调用 fit', () => {
		vi.useFakeTimers();
		const { mindMap, execCommand, setScale, fit } = makeMindMap();
		expect(arrangeMindMap(mindMap)).toBe(true);
		expect(execCommand).toHaveBeenCalledWith('RESET_LAYOUT');
		// 延时前不调整视口（等引擎 reflow）
		expect(setScale).not.toHaveBeenCalled();
		vi.advanceTimersByTime(80);
		expect(setScale).toHaveBeenCalledWith(1, 400, 300);
		expect(fit).not.toHaveBeenCalled();
	});

	it('引擎缺失/无 execCommand：返回 false 且不抛异常', () => {
		expect(arrangeMindMap(null)).toBe(false);
		expect(arrangeMindMap({} as unknown as MindMap)).toBe(false);
	});
});
