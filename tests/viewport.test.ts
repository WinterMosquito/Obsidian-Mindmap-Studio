/**
 * 视口动作回归：
 * - `resetZoom`：回到 100%，**不改变平移**（屏幕位置保持；工具栏「重置缩放」按钮）；
 * - `arrangeMindMap`：执行 RESET_LAYOUT 后**重置缩放**（不再 fit 全图——
 *   大图 fit 会把比例压到文字不可读）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import { arrangeMindMap, resetZoom } from '../src/mindmap';

// mindmap.ts 经 import 链加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

function makeMindMap() {
	const setScale = vi.fn<(scale: number) => void>();
	const fit = vi.fn();
	const moveNodeToCenter = vi.fn();
	const execCommand = vi.fn();
	const root = { isRoot: true };
	const mindMap = {
		execCommand,
		view: { setScale, fit },
		renderer: { root, moveNodeToCenter },
	} as unknown as MindMap;
	return { mindMap, setScale, fit, moveNodeToCenter, execCommand };
}

describe('resetZoom（回到 100%，不改动视口位置）', () => {
	it('只设置比例 1，不居中根节点（屏幕位置保持）', () => {
		const { mindMap, setScale, moveNodeToCenter } = makeMindMap();
		resetZoom(mindMap);
		expect(setScale).toHaveBeenCalledWith(1);
		// 用户明确要求：重置缩放不得改变屏幕位置（不做任何居中/平移）
		expect(moveNodeToCenter).not.toHaveBeenCalled();
	});

	it('引擎缺失时静默（工具栏在引擎未就绪时可点）', () => {
		expect(() => resetZoom(null)).not.toThrow();
	});
});

describe('arrangeMindMap（整理后重置缩放，不再 fit 全图）', () => {
	afterEach(() => {
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
		expect(setScale).toHaveBeenCalledWith(1);
		expect(fit).not.toHaveBeenCalled();
	});

	it('引擎缺失/无 execCommand：返回 false 且不抛异常', () => {
		expect(arrangeMindMap(null)).toBe(false);
		expect(arrangeMindMap({} as unknown as MindMap)).toBe(false);
	});
});
