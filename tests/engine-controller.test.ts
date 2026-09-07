/**
 * EngineController 回归测试（services/engine-controller.ts）。
 *
 * 覆盖竞态防御最密集的引擎生命周期逻辑（UI/DOM 不经此路径，纯依赖注入可测）：
 * - 初始化代际锁：invalidateInit / 新请求作废旧等待；容器替换/脱离 DOM 守卫；
 * - 零尺寸等待：ResizeObserver 事件驱动（0 尺寸不渲染、尺寸恢复即创建、
 *   无轮询定时器）；
 * - 装配：创建后注册引擎事件/特性/onEngineReady，创建失败兜底销毁；
 * - 引用更新预检：无关文件重命名/删除零拷贝跳过，命中才走 getData+setData；
 * - 图片点击的拖拽抑制窗口；
 * - refresh 深拷贝重建 / persistViewport 视口写入 / 首帧视口恢复。
 *
 * 引擎本体经 vi.mock('../src/mindmap') 桩替（真实 vendor bundle 仅在
 * vendor-contract.test.ts 加载验证），links-tree 同理桩替以控制更新结果。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';

// —— hoisted 桩：vi.mock 工厂与测试体共享同一组 mock 函数 ——
const mocks = vi.hoisted(() => {
	return {
		createMindMap: vi.fn(),
		destroyMindMap: vi.fn(),
		fitMindMap: vi.fn(),
		getRenderRoot: vi.fn(),
		getRootText: vi.fn(),
		getThemeConfig: vi.fn(),
		isDarkTheme: vi.fn(),
		isEditingText: vi.fn(),
		updateReferencesOnRename: vi.fn(),
		removeReferencesOnDelete: vi.fn(),
	};
});

vi.mock('../src/mindmap', () => mocks);
vi.mock('../src/links-tree', () => ({
	updateReferencesOnRename: mocks.updateReferencesOnRename,
	removeReferencesOnDelete: mocks.removeReferencesOnDelete,
}));

import { EngineController } from '../src/services/engine-controller';
import { ViewStateStore } from '../src/view-state';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

// —— ResizeObserver 桩：记录 observe/disconnect，手动触发回调 ——

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	callback: ResizeObserverCallback;
	observed: Element[] = [];
	disconnected = false;

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		ResizeObserverStub.instances.push(this);
	}
	observe(el: Element): void {
		this.observed.push(el);
	}
	unobserve(): void {}
	disconnect(): void {
		this.disconnected = true;
	}
	/** 测试辅助：模拟容器尺寸变化触发回调 */
	fire(): void {
		this.callback([], this);
	}
}

/** 当前激活的观察器实例（每个测试重置） */
let observers: ResizeObserverStub[];
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// —— 引擎实例桩（createMindMap 每次调用的返回值） ——

interface EngineStub {
	opt: Record<string, unknown>;
	addPlugin: ReturnType<typeof vi.fn>;
	updateConfig: ReturnType<typeof vi.fn>;
	resize: ReturnType<typeof vi.fn>;
	render: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	getData: ReturnType<typeof vi.fn>;
	setData: ReturnType<typeof vi.fn>;
	execCommand: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	off: ReturnType<typeof vi.fn>;
	view: {
		getTransformData: ReturnType<typeof vi.fn>;
		setTransformData: ReturnType<typeof vi.fn>;
	};
}

function makeEngineStub(): EngineStub {
	return {
		opt: {},
		addPlugin: vi.fn(),
		updateConfig: vi.fn(),
		resize: vi.fn(),
		render: vi.fn(),
		destroy: vi.fn(),
		getData: vi.fn(() => ({ data: { text: 'Root' }, children: [] })),
		setData: vi.fn(),
		execCommand: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		view: {
			getTransformData: vi.fn(() => ({ transform: { x: 1 }, state: {} })),
			setTransformData: vi.fn(),
		},
	};
}

/** 最近一次 createMindMap 返回的引擎桩 */
let lastEngine: EngineStub;

// —— 容器与依赖桩 ——

class CanvasStub {
	connected = true;
	width = 0;
	height = 0;
	emptied = 0;
	get isConnected(): boolean {
		return this.connected;
	}
	empty(): void {
		this.emptied++;
	}
	getBoundingClientRect(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}
}

interface Harness {
	controller: EngineController;
	canvas: CanvasStub;
	file: TFile;
	deps: {
		getFile: ReturnType<typeof vi.fn>;
		onNodeImageClick: ReturnType<typeof vi.fn>;
		setupFeatures: ReturnType<typeof vi.fn>;
		onEngineReady: ReturnType<typeof vi.fn>;
		openHyperlink: ReturnType<typeof vi.fn>;
		onRootDataChanged: ReturnType<typeof vi.fn>;
		onReferencesChanged: ReturnType<typeof vi.fn>;
	};
	viewState: ViewStateStore;
}

function makeHarness(): Harness {
	const canvas = new CanvasStub();
	const file = Object.assign(new TFile(), {
		path: 'notes/f.mindmap.md',
		basename: 'f.mindmap',
		name: 'f.mindmap.md',
	});
	const viewState = new ViewStateStore(() => {}, 600);
	const deps = {
		getFile: vi.fn(() => file),
		onNodeImageClick: vi.fn(),
		setupFeatures: vi.fn(),
		onEngineReady: vi.fn(),
		openHyperlink: vi.fn(),
		onRootDataChanged: vi.fn(),
		onReferencesChanged: vi.fn(),
	};
	const controller = new EngineController({
		app: new App(),
		getCanvasEl: () => canvas as unknown as HTMLElement,
		getFile: deps.getFile,
		getLang: () => 'zh',
		isDark: () => false,
		getSetupOptions: () => ({
			layout: 'logicalStructure',
			themePref: 'default',
			enableDrag: false,
			performanceMode: false,
			performanceThreshold: 500,
		}),
		viewState,
		openHyperlink: deps.openHyperlink,
		onRootDataChanged: deps.onRootDataChanged,
		onNodeImageClick: deps.onNodeImageClick,
		setupFeatures: deps.setupFeatures,
		onEngineReady: deps.onEngineReady,
		onReferencesChanged: deps.onReferencesChanged,
	});
	return { controller, canvas, file, deps, viewState };
}

function tree(text: string): MindMapTreeNode {
	return { data: { text }, children: [] };
}

/** 渲染器树桩：walkTree 可遍历（children）+ getData 返回节点数据 */
function renderNode(data: Record<string, unknown>, children: unknown[] = []) {
	return {
		getData: () => data,
		children,
	};
}

beforeEach(() => {
	observers = [];
	ResizeObserverStub.instances = observers;
	lastEngine = makeEngineStub();
	mocks.createMindMap.mockReset();
	mocks.createMindMap.mockImplementation(() => {
		lastEngine = makeEngineStub();
		return lastEngine;
	});
	mocks.destroyMindMap.mockReset();
	mocks.fitMindMap.mockReset();
	mocks.getRenderRoot.mockReset();
	mocks.getRootText.mockReset();
	mocks.getRootText.mockReturnValue(null);
	mocks.isEditingText.mockReset();
	mocks.isEditingText.mockReturnValue(false);
	mocks.updateReferencesOnRename.mockReset();
	mocks.updateReferencesOnRename.mockReturnValue(true);
	mocks.removeReferencesOnDelete.mockReset();
	mocks.removeReferencesOnDelete.mockReturnValue(true);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('EngineController.initMindMap（代际锁与零尺寸等待）', () => {
	it('尺寸就绪时同步创建引擎，恰好一次', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
		expect(mocks.createMindMap.mock.calls[0]![1]).toMatchObject({
			data: { text: 'Root' },
		});
		expect(h.deps.onEngineReady).toHaveBeenCalledWith('logicalStructure');
		// 尺寸就绪路径不挂观察器
		expect(observers).toHaveLength(0);
	});

	it('容器未挂载（getCanvasEl 为 null）时静默返回', () => {
		const controller = new EngineController({
			app: new App(),
			getCanvasEl: () => null,
			getFile: () => null,
			getLang: () => 'zh',
			isDark: () => false,
			getSetupOptions: () => ({
				layout: 'logicalStructure',
				themePref: 'default',
				enableDrag: false,
				performanceMode: false,
				performanceThreshold: 500,
			}),
			viewState: new ViewStateStore(() => {}, 600),
			openHyperlink: vi.fn(),
			onRootDataChanged: vi.fn(),
			onNodeImageClick: vi.fn(),
			setupFeatures: vi.fn(),
			onEngineReady: vi.fn(),
			onReferencesChanged: vi.fn(),
		});
		controller.initMindMap(tree('Root'));
		expect(mocks.createMindMap).not.toHaveBeenCalled();
	});

	it('0 尺寸时不创建引擎、不轮询，挂 ResizeObserver 等待', () => {
		const h = makeHarness();
		h.controller.initMindMap(tree('Root'));
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers).toHaveLength(1);
		expect(observers[0]!.observed).toHaveLength(1);
		// 尺寸仍为 0：触发回调不渲染、不断开（继续等待，无轮询定时器）
		observers[0]!.fire();
		observers[0]!.fire();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers[0]!.disconnected).toBe(false);
	});

	it('尺寸恢复（叶被激活）后经观察器事件驱动创建，恰好一次', () => {
		const h = makeHarness();
		h.controller.initMindMap(tree('Root'));
		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
		// 渲染完成即断开观察器
		expect(observers[0]!.disconnected).toBe(true);
	});

	it('invalidateInit 作废零尺寸等待：后续尺寸变化不再渲染', () => {
		const h = makeHarness();
		h.controller.initMindMap(tree('Root'));
		h.controller.invalidateInit();
		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		// 代际作废时观察器已断开
		expect(observers[0]!.disconnected).toBe(true);
	});

	it('新的 initMindMap 请求作废旧等待：只渲染最新树', () => {
		const h = makeHarness();
		const t1 = tree('Old');
		const t2 = tree('New');
		h.controller.initMindMap(t1);
		h.controller.initMindMap(t2);
		// 旧等待被接管断开
		expect(observers[0]!.disconnected).toBe(true);
		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[1]!.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
		expect(mocks.createMindMap.mock.calls[0]![1]).toBe(t2);
		// 旧观察器此时再触发也无效
		observers[0]!.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
	});

	it('容器脱离 DOM 时观察器回调作废本次请求', () => {
		const h = makeHarness();
		h.controller.initMindMap(tree('Root'));
		h.canvas.connected = false;
		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers[0]!.disconnected).toBe(true);
	});

	it('destroyInstance 销毁引擎并清空容器', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		const engine = lastEngine;
		h.controller.destroyInstance();
		expect(mocks.destroyMindMap).toHaveBeenCalledWith(engine);
		expect(h.controller.mindMap).toBeNull();
		expect(h.canvas.emptied).toBeGreaterThan(0);
	});

	it('零尺寸等待中 destroyInstance：断开挂起的观察器', () => {
		const h = makeHarness();
		h.controller.initMindMap(tree('Root'));
		expect(observers).toHaveLength(1);
		h.controller.destroyInstance();
		expect(observers[0]!.disconnected).toBe(true);
	});
});

describe('EngineController.renderMindMap（装配与失败兜底）', () => {
	it('创建后注册引擎事件、装配特性并回调 onEngineReady', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		const engine = lastEngine;
		expect(engine.render).toHaveBeenCalled();
		expect(h.deps.setupFeatures).toHaveBeenCalledTimes(1);
		expect(h.deps.onEngineReady).toHaveBeenCalledTimes(1);
		const events = engine.on.mock.calls.map((c) => c[0] as string);
		expect(events).toContain('data_change');
		expect(events).toContain('node_img_click');
		expect(events).toContain('node_dragend');
	});

	it('createMindMap 抛错：兜底销毁清空容器、提示用户、不向调用方抛出', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		mocks.createMindMap.mockImplementation(() => {
			throw new Error('boom');
		});
		expect(() => h.controller.initMindMap(tree('Root'))).not.toThrow();
		expect(mocks.destroyMindMap).toHaveBeenCalled();
		expect(h.canvas.emptied).toBeGreaterThan(0);
		expect(h.controller.mindMap).toBeNull();
	});
});

describe('EngineController 引用更新预检（零拷贝跳过）', () => {
	/** 引擎就绪（尺寸先于初始化设置）的 harness */
	function readyHarness(): Harness {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		return h;
	}

	it('渲染树无相关引用：不做深拷贝更新，返回 false', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ text: '无关节点' }),
		);
		const changed = h.controller.updateReferencesOnRename(
			h.file,
			'notes/old.mindmap.md',
		);
		expect(changed).toBe(false);
		// 预检确实执行过（getRenderRoot 被调用），只是未命中
		expect(mocks.getRenderRoot).toHaveBeenCalled();
		expect(mocks.updateReferencesOnRename).not.toHaveBeenCalled();
		expect(lastEngine.setData).not.toHaveBeenCalled();
	});

	it('预检命中（图片引用旧路径）：更新成功则 setData 并返回 true', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ image: 'notes/old.png' }),
		);
		const file = Object.assign(new TFile(), { path: 'notes/new.png', name: 'new.png' });
		const changed = h.controller.updateReferencesOnRename(
			file,
			'notes/old.png',
		);
		expect(changed).toBe(true);
		expect(mocks.updateReferencesOnRename).toHaveBeenCalledTimes(1);
		expect(lastEngine.setData).toHaveBeenCalledTimes(1);
	});

	it('预检命中但更新无变更：返回 false 且不 setData', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ image: 'notes/old.png' }),
		);
		mocks.updateReferencesOnRename.mockReturnValue(false);
		const file = Object.assign(new TFile(), { path: 'notes/new.png', name: 'new.png' });
		expect(
			h.controller.updateReferencesOnRename(file, 'notes/old.png'),
		).toBe(false);
		expect(lastEngine.setData).not.toHaveBeenCalled();
	});

	it('删除引用同样经预检：未命中直接跳过', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ hyperlink: '[[其它笔记]]' }),
		);
		expect(h.controller.removeReferencesOnDelete(h.file)).toBe(false);
		expect(mocks.getRenderRoot).toHaveBeenCalled();
		expect(mocks.removeReferencesOnDelete).not.toHaveBeenCalled();
	});
});

describe('EngineController 图片点击的拖拽抑制', () => {
	function fireEngineEvent(h: Harness, event: string, ...args: unknown[]): void {
		const call = lastEngine.on.mock.calls.find((c) => c[0] === event);
		(call?.[1] as (...a: unknown[]) => void)(...args);
	}

	it('未拖拽时点击图片立即回调 onNodeImageClick', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		const node = { getData: () => ({}) };
		fireEngineEvent(h, 'node_img_click', node);
		expect(h.deps.onNodeImageClick).toHaveBeenCalledWith(node);
	});

	it('拖拽结束后抑制窗口内的点击被忽略，窗口后恢复', () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			h.canvas.width = 800;
			h.canvas.height = 600;
			h.controller.initMindMap(tree('Root'));
			const node = { getData: () => ({}) };
			fireEngineEvent(h, 'node_dragend');
			fireEngineEvent(h, 'node_img_click', node);
			expect(h.deps.onNodeImageClick).not.toHaveBeenCalled();
			// 超过抑制窗口后恢复
			vi.advanceTimersByTime(301);
			fireEngineEvent(h, 'node_img_click', node);
			expect(h.deps.onNodeImageClick).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('data_change 事件回调转发 onRootDataChanged', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		const call = lastEngine.on.mock.calls.find((c) => c[0] === 'data_change');
		(call?.[1] as (...a: unknown[]) => void)();
		expect(h.deps.onRootDataChanged).toHaveBeenCalledTimes(1);
	});
});

describe('EngineController.refresh 与视口', () => {
	it('refresh：深拷贝当前树后重建实例（新数据对象）', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		const t = tree('Root');
		h.controller.initMindMap(t);
		// 让引擎桩 getData 返回当前树（含渲染时 ensureUniqueUids 补的 uid）
		lastEngine.getData = vi.fn(() => t);
		h.controller.refresh();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(2);
		const secondCallData = mocks.createMindMap.mock.calls[1]![1] as MindMapTreeNode;
		expect(secondCallData).toEqual(t);
		// 重建用的是克隆对象，不是传入引擎的活引用
		expect(secondCallData).not.toBe(t);
	});

	it('refresh：引擎不存在时无操作', () => {
		const h = makeHarness();
		h.controller.refresh();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
	});

	it('persistViewport：把引擎视口写入按路径的视图状态存储', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		h.controller.persistViewport();
		expect(h.viewState.getView(h.file.path)).toEqual({
			transform: { x: 1 },
			state: {},
		});
	});

	it('persistViewport：getTransformData 抛错时静默（引擎未就绪场景）', () => {
		const h = makeHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(tree('Root'));
		lastEngine.view.getTransformData.mockImplementation(() => {
			throw new Error('not ready');
		});
		expect(() => h.controller.persistViewport()).not.toThrow();
	});

	it('首帧延迟后：无保存视口则 fit 全图', () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			h.canvas.width = 800;
			h.canvas.height = 600;
			h.controller.initMindMap(tree('Root'));
			expect(mocks.fitMindMap).not.toHaveBeenCalled();
			vi.advanceTimersByTime(150);
			expect(mocks.fitMindMap).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('首帧延迟后：有保存视口则恢复而不 fit', () => {
		vi.useFakeTimers();
		try {
			const h = makeHarness();
			h.canvas.width = 800;
			h.canvas.height = 600;
			h.viewState.setView(h.file.path, { transform: { x: 9 }, state: {} });
			h.controller.initMindMap(tree('Root'));
			vi.advanceTimersByTime(150);
			expect(lastEngine.view.setTransformData).toHaveBeenCalledWith({
				transform: { x: 9 },
				state: {},
			});
			expect(mocks.fitMindMap).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
