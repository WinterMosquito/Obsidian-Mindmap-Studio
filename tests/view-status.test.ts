/**
 * view-status 回归：状态栏节点计数的节流语义与生命周期清理。
 *
 * 关注点（都不是 mock 行为，而是模块自身的调度决策）：
 * - 关闭状态栏设置时零开销（不计数、不节流）；
 * - 引擎缺失/计数抛错 → 清空而非崩溃；
 * - 高频事件只算一次 + 尾随刷新拿最新值；
 * - 视图关闭（cancelStatusBarUpdate）后不再有尾随刷新落到已销毁视图。
 *
 * 计数与渲染根经 mindmap.ts 防腐层提供，此处 stub 替换（本测试不验证引擎）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	cancelStatusBarUpdate,
	updateStatusBar,
} from '../src/features/view-status';

const { countTreeNodesMock, getRenderRootMock } = vi.hoisted(() => ({
	countTreeNodesMock: vi.fn<(root: unknown) => number>(),
	getRenderRootMock: vi.fn<(mindMap: unknown) => unknown>(),
}));

vi.mock('../src/mindmap', () => ({
	countTreeNodes: countTreeNodesMock,
	getRenderRoot: getRenderRootMock,
}));

/** 状态栏展示面所需的最窄视图桩（每次新建视图对象：节流器按视图 WeakMap 持有） */
function makeView(options: { mindMap?: MindMap | null; available?: boolean } = {}) {
	const statusBar = {
		available: options.available ?? true,
		clear: vi.fn(),
		showNodeCount: vi.fn(),
	};
	const view = {
		mindMap:
			options.mindMap === undefined ? ({} as MindMap) : options.mindMap,
		plugin: { statusBar },
	} as unknown as MindMapViewContext;
	return { view, statusBar };
}

/** 节流窗口（与模块常量一致：STATUS_BAR_THROTTLE_MS） */
const THROTTLE_MS = 300;

describe('updateStatusBar（计数节流与降级）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		countTreeNodesMock.mockReset();
		getRenderRootMock.mockReset();
		getRenderRootMock.mockReturnValue({});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('状态栏不可用（设置关闭）：不计数、不节流', () => {
		const { view, statusBar } = makeView({ available: false });
		updateStatusBar(view);
		vi.advanceTimersByTime(THROTTLE_MS * 3);
		expect(getRenderRootMock).not.toHaveBeenCalled();
		expect(countTreeNodesMock).not.toHaveBeenCalled();
		expect(statusBar.showNodeCount).not.toHaveBeenCalled();
	});

	it('引擎实例缺失：清空状态栏而不计数', () => {
		const { view, statusBar } = makeView({ mindMap: null });
		updateStatusBar(view);
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(countTreeNodesMock).not.toHaveBeenCalled();
	});

	it('首次调用立即计数并展示', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(7);
		updateStatusBar(view);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledWith(7);
	});

	it('窗口内高频调用只排一次尾随，尾随取最新值（非缓存值）', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValueOnce(1).mockReturnValueOnce(42);
		updateStatusBar(view); // 立即执行 → 1
		updateStatusBar(view); // 窗口内 → 排尾随
		updateStatusBar(view); // 窗口内 → 合并进同一尾随
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(THROTTLE_MS);
		// 尾随执行重新读取引擎状态（不是复用第一次的结果）
		expect(countTreeNodesMock).toHaveBeenCalledTimes(2);
		expect(statusBar.showNodeCount).toHaveBeenNthCalledWith(1, 1);
		expect(statusBar.showNodeCount).toHaveBeenNthCalledWith(2, 42);
	});

	it('尾随执行后窗口重置：下一次调用立即生效（不必再等一个窗口）', () => {
		const { view } = makeView();
		countTreeNodesMock.mockReturnValue(1);
		updateStatusBar(view); // 立即
		updateStatusBar(view); // 尾随
		vi.advanceTimersByTime(THROTTLE_MS);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(2);
		// trailingResetsWindow：尾随执行已展示最新状态 → 下次立即执行
		updateStatusBar(view);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(3);
	});

	it('尾随触发时引擎已被销毁：清空状态栏（不触碰已销毁实例）', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(3);
		updateStatusBar(view);
		updateStatusBar(view); // 排尾随
		(view as { mindMap: MindMap | null }).mindMap = null;
		vi.advanceTimersByTime(THROTTLE_MS);
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
	});

	it('计数抛错：清空状态栏，异常不外抛', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockImplementation(() => {
			throw new Error('引擎内部状态异常');
		});
		expect(() => updateStatusBar(view)).not.toThrow();
		expect(statusBar.clear).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).not.toHaveBeenCalled();
	});
});

describe('cancelStatusBarUpdate（视图关闭清理）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		countTreeNodesMock.mockReset();
		getRenderRootMock.mockReset();
		getRenderRootMock.mockReturnValue({});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('取消未决尾随刷新：关闭后不再落到已销毁视图', () => {
		const { view, statusBar } = makeView();
		countTreeNodesMock.mockReturnValue(5);
		updateStatusBar(view); // 立即执行
		updateStatusBar(view); // 排尾随
		cancelStatusBarUpdate(view);
		vi.advanceTimersByTime(THROTTLE_MS * 2);
		expect(countTreeNodesMock).toHaveBeenCalledTimes(1);
		expect(statusBar.showNodeCount).toHaveBeenCalledTimes(1);
	});

	it('无节流器时取消安全（onClose 路径不抛异常）', () => {
		const { view } = makeView();
		expect(() => cancelStatusBarUpdate(view)).not.toThrow();
	});
});
