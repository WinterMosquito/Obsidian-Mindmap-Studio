/**
 * 交互会话收尾回归：拖拽换父（drag-target）与图片调宽（image-resize）在
 * 拖拽会话期间动态注册临时 window 监听，松手即移除——这类监听不经
 * EventBinder 记录（拖拽中途关闭视图收不到 mouseup），必须由视图 onClose
 * 经 teardown* 显式收尾，否则监听泄漏并继续作用于已销毁视图。
 *
 * 本测试用 window 桩记录注册/移除，覆盖「会话进行中 → 视图关闭 → 监听清零」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	setupDragTargetAssist,
	teardownDragTargetAssist,
} from '../src/features/drag-target';
import {
	setupImageResize,
	teardownImageResize,
} from '../src/features/image-resize';

// 两个模块经 import 链加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

/** 记录 onEngine 注册的监听，供测试按事件名触发 */
function makeEngineBinder() {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	return {
		onEngine(
			_emitter: unknown,
			event: string,
			listener: (...args: unknown[]) => void,
		): void {
			listeners.set(event, listener);
		},
		fire(event: string, ...args: unknown[]): void {
			listeners.get(event)?.(...args);
		},
		has(event: string): boolean {
			return listeners.has(event);
		},
	};
}

/** 非根节点桩（collectExcludeUids 只读 getData('uid') 与 children） */
function fakeNode(): MindMapNode {
	return {
		isRoot: false,
		getData: () => undefined,
		children: [],
	} as unknown as MindMapNode;
}

function makeView(engineEvents: unknown): MindMapViewContext {
	return {
		mindMap: {} as MindMap,
		engineEvents,
		lang: 'zh',
		canvasEl: null,
		scheduleSave: vi.fn(),
	} as unknown as MindMapViewContext;
}

describe('drag-target 会话收尾（拖拽中途关闭视图）', () => {
	let addListener: ReturnType<typeof vi.fn<(type: string, listener: unknown) => void>>;
	let removeListener: ReturnType<typeof vi.fn<(type: string, listener: unknown) => void>>;

	beforeEach(() => {
		addListener = vi.fn<(type: string, listener: unknown) => void>();
		removeListener = vi.fn<(type: string, listener: unknown) => void>();
		vi.stubGlobal('window', {
			addEventListener: addListener,
			removeEventListener: removeListener,
			requestAnimationFrame: vi.fn(() => 1),
			cancelAnimationFrame: vi.fn(),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('会话进行中收尾：mousemove / mouseup 临时监听全部移除', () => {
		const binder = makeEngineBinder();
		const view = makeView(binder);
		setupDragTargetAssist(view);
		expect(binder.has('node_dragging')).toBe(true);
		expect(binder.has('node_dragend')).toBe(true);

		// 引擎首次拖拽移动 → 建立会话并挂 window 监听
		binder.fire('node_dragging', fakeNode());
		const added = addListener.mock.calls.map((call) => call[0]);
		expect(added).toEqual(['mousemove', 'mouseup']);

		// 视图在拖拽中被关闭：无 mouseup / node_dragend 可依赖，须显式收尾
		teardownDragTargetAssist(view);
		expect(removeListener.mock.calls.map((call) => call[0])).toEqual([
			'mousemove',
			'mouseup',
		]);
		// 移除的监听器与注册的完全同源（否则 removeEventListener 无效）
		expect(removeListener.mock.calls.map((call) => call[1])).toEqual(
			addListener.mock.calls.map((call) => call[1]),
		);
	});

	it('收尾后会话已清空：可重新建立会话；无会话时收尾安全（幂等）', () => {
		const binder = makeEngineBinder();
		const view = makeView(binder);
		setupDragTargetAssist(view);

		// 无会话时收尾：不抛异常、不移除任何监听
		teardownDragTargetAssist(view);
		expect(removeListener).not.toHaveBeenCalled();

		binder.fire('node_dragging', fakeNode());
		expect(addListener).toHaveBeenCalledTimes(2);
		teardownDragTargetAssist(view);
		// 收尾后新拖拽可再次建立会话（会话状态未残留）
		binder.fire('node_dragging', fakeNode());
		expect(addListener).toHaveBeenCalledTimes(4);
	});

	it('根节点拖拽不建立会话（中心主题不可换父）', () => {
		const binder = makeEngineBinder();
		const view = makeView(binder);
		setupDragTargetAssist(view);
		binder.fire('node_dragging', { isRoot: true });
		expect(addListener).not.toHaveBeenCalled();
	});
});

describe('image-resize 会话收尾（调宽中途关闭视图）', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('收尾移除手柄 DOM 并清空会话（视图关闭后不留悬空手柄）', () => {
		const remove = vi.fn();
		const handleEl = {
			addEventListener: vi.fn(),
			remove,
		} as unknown as HTMLDivElement;
		const binder = makeEngineBinder();
		const view = {
			...makeView(binder),
			canvasEl: { createDiv: () => handleEl } as unknown as HTMLElement,
		} as unknown as MindMapViewContext;

		setupImageResize(view);
		// 手柄已挂到画布容器（会话未建立）
		expect(binder.has('node_img_mouseenter')).toBe(true);

		teardownImageResize(view);
		expect(remove).toHaveBeenCalledTimes(1);
		// 幂等：重复收尾不重复移除
		teardownImageResize(view);
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it('无手柄/无会话时收尾安全（onClose 路径不抛异常）', () => {
		const binder = makeEngineBinder();
		const view = makeView(binder);
		expect(() => teardownImageResize(view)).not.toThrow();
	});
});
