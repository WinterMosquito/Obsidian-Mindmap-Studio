/**
 * EngineController 回归测试（src/services/engine-controller.ts）。
 *
 * 这个控制器把「引擎实例的生命周期」和「视图对引擎内部的访问」收口到一处，
 * 它的正确性几乎全是竞态与边界问题，且不经过真实 DOM，全部可用依赖注入取证：
 *
 * - 初始化代际锁：两代 init 同时在飞时只有最新一代真正装配，旧代（含其
 *   ResizeObserver 通知、首帧视口恢复定时器）必须静默作废且不残留监听；
 * - 零尺寸等待：容器 0 尺寸（后台叶/折叠面板）时不渲染、不轮询，改用
 *   ResizeObserver 事件驱动，尺寸恢复即创建；
 * - 装配/销毁：创建后的引擎事件注册顺序、特性装配与 onEngineReady 顺序、
 *   装配失败兜底销毁、destroyInstance 把引擎事件逐条 off（引用一致）；
 * - 引用预检：无关文件的重命名/删除必须零拷贝短路，命中才 getData+setData；
 * - 图片点击的拖拽抑制窗口（含 300ms 边界）；
 * - refresh 的深拷贝重建、persistViewport 的按路径写入，以及
 *   restoreOrFitViewport「有保存视口优先恢复，否则默认 100% + 内容包围盒居中」。
 *
 * 引擎本体（vendor bundle）不在 Node 下加载，故 vi.mock('../src/mindmap')
 * 桩掉防腐封装面；引用更新真实实现涉及 Obsidian 库 API，同样桩掉 links-tree，
 * 以便精确控制「有无变更」这一分支。真实 needle 匹配（node-data）不复刻，
 * 用真实模块，避免断言与被测逻辑同源失真。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';

// —— hoisted 桩：vi.mock 工厂与测试体共享同一组 mock 函数 ——
const mocks = vi.hoisted(() => {
	return {
		arrangeMindMap: vi.fn(),
		centerContentAtFullScale: vi.fn(),
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

// ---------------------------------------------------------------------------
// 全局桩：ResizeObserver / 容器 / 引擎
// ---------------------------------------------------------------------------

/** ResizeObserver 桩：记录 observe/disconnect，测试手动投递回调 */
class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];

	readonly observed: Element[] = [];
	disconnected = false;
	disconnectCount = 0;

	constructor(private readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}

	observe(target: Element): void {
		this.observed.push(target);
	}

	unobserve(): void {}

	disconnect(): void {
		this.disconnected = true;
		this.disconnectCount++;
	}

	/** 测试辅助：模拟容器尺寸变化触发通知（同真实 RO 的回调形态） */
	fire(): void {
		this.callback([], this);
	}
}

/** 当前测试内创建的观察器（每个用例重置） */
let observers: ResizeObserverStub[] = [];

/** 引擎挂载容器桩：尺寸/连接状态可控，empty() 被记录 */
class CanvasStub {
	connected = true;
	width = 0;
	height = 0;
	readonly empty = vi.fn();

	get isConnected(): boolean {
		return this.connected;
	}

	getBoundingClientRect(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}
}

/** 引擎实例桩（createMindMap 的返回值），覆盖控制器会触碰的全部面 */
interface EngineStub {
	opt: Record<string, unknown>;
	render: ReturnType<typeof vi.fn>;
	resize: ReturnType<typeof vi.fn>;
	setLayout: ReturnType<typeof vi.fn>;
	setThemeConfig: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	getData: ReturnType<typeof vi.fn>;
	setData: ReturnType<typeof vi.fn>;
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
		render: vi.fn(),
		resize: vi.fn(),
		setLayout: vi.fn(),
		setThemeConfig: vi.fn(),
		destroy: vi.fn(),
		getData: vi.fn(() => makeTree('Root')),
		setData: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		view: {
			getTransformData: vi.fn(() => ({
				transform: { x: 1, y: 2, scale: 1 },
				state: { a: 1 },
			})),
			setTransformData: vi.fn(),
		},
	};
}

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function makeTree(text: string, children: MindMapTreeNode[] = []): MindMapTreeNode {
	return { data: { text }, children };
}

function makeFile(path: string, name?: string): TFile {
	return Object.assign(new TFile(), {
		path,
		name: name ?? path.split('/').pop() ?? path,
	});
}

/** 渲染节点桩：walkTree 可遍历（children）+ getData 返回节点数据 */
function renderNode(data: Record<string, unknown>, children: unknown[] = []) {
	return { getData: vi.fn(() => data), children };
}

interface Harness {
	controller: EngineController;
	canvas: CanvasStub;
	file: TFile | null;
	viewState: ViewStateStore;
	/** 按创建顺序记录的引擎实例 */
	engines: EngineStub[];
	deps: {
		getSetupOptions: ReturnType<typeof vi.fn>;
		getCanvasEl: ReturnType<typeof vi.fn>;
		openHyperlink: ReturnType<typeof vi.fn>;
		onRootDataChanged: ReturnType<typeof vi.fn>;
		onNodeImageClick: ReturnType<typeof vi.fn>;
		onNodeAttachmentClick: ReturnType<typeof vi.fn>;
		setupFeatures: ReturnType<typeof vi.fn>;
		onEngineReady: ReturnType<typeof vi.fn>;
	};
}

/** 已创建的 harness（afterEach 统一销毁，取消未触发的视口恢复定时器） */
const harnesses: Harness[] = [];

function buildHarness(
	options: { canvas?: CanvasStub | null; file?: TFile | null } = {},
): Harness {
	const canvas =
		options.canvas === undefined ? new CanvasStub() : options.canvas;
	const file = options.file === undefined ? makeFile('notes/f.mindmap.md') : options.file;
	const engines: EngineStub[] = [];
	const viewState = new ViewStateStore(() => {}, 600);
	const deps = {
		getCanvasEl: vi.fn(() =>
			canvas ? (canvas as unknown as HTMLElement) : null,
		),
		getSetupOptions: vi.fn(() => ({
			layout: 'logicalStructure',
			lineStyle: 'auto',
			themePref: 'default',
			enableDrag: false,
			performanceMode: false,
			performanceThreshold: 500,
		})),
		openHyperlink: vi.fn(),
		onRootDataChanged: vi.fn(),
		onNodeImageClick: vi.fn(),
		onNodeAttachmentClick: vi.fn(),
		setupFeatures: vi.fn(),
		onEngineReady: vi.fn(),
		onReferencesChanged: vi.fn(),
		isDark: vi.fn(() => false),
	};
	const controller = new EngineController({
		app: new App(),
		getCanvasEl: deps.getCanvasEl,
		getFile: () => file,
		getLang: () => 'zh',
		isDark: deps.isDark,
		getSetupOptions: deps.getSetupOptions,
		viewState,
		openHyperlink: deps.openHyperlink,
		onRootDataChanged: deps.onRootDataChanged,
		onNodeImageClick: deps.onNodeImageClick,
		onNodeAttachmentClick: deps.onNodeAttachmentClick,
		setupFeatures: deps.setupFeatures,
		onEngineReady: deps.onEngineReady,
		onReferencesChanged: deps.onReferencesChanged,
	});
	const harness: Harness = {
		controller,
		canvas: canvas as CanvasStub,
		file,
		viewState,
		engines,
		deps,
	};
	harnesses.push(harness);
	return harness;
}

/** 尺寸就绪的 harness（引擎已装配、4 个引擎事件已注册） */
function readyHarness(): Harness {
	const h = buildHarness();
	h.canvas.width = 800;
	h.canvas.height = 600;
	h.controller.initMindMap(makeTree('Root'));
	return h;
}

/** 取引擎实例上注册的某个事件的监听器（未注册即失败，避免断言落空） */
function engineListener(
	engine: EngineStub,
	event: string,
): (...args: unknown[]) => void {
	const call = engine.on.mock.calls.find((c) => c[0] === event);
	if (!call) {
		throw new Error(`引擎未注册事件：${event}`);
	}
	return call[1] as (...args: unknown[]) => void;
}

/** 取引擎实例上注册的事件名序列（用于断言注册顺序） */
function registeredEvents(engine: EngineStub): string[] {
	return engine.on.mock.calls.map((call) => String(call[0]));
}

/**
 * destroyMindMap 收到的**实际实例**。
 * 每次渲染前的防御性清理会带 null 调一次（「先销毁旧实例」的统一入口），
 * 只关心「真的销毁了哪个引擎」时应过滤掉这些空调用。
 */
function destroyedEngines(): unknown[] {
	const calls = mocks.destroyMindMap.mock.calls as unknown[][];
	return calls.map((call) => call[0]).filter((engine) => engine !== null);
}

/** mock 调用的前两个实参（逐条比对 off/on 配对与注册顺序用） */
function callPairs(mock: ReturnType<typeof vi.fn>): [unknown, unknown][] {
	const calls = mock.mock.calls as unknown[][];
	return calls.map((call): [unknown, unknown] => [call[0], call[1]]);
}

function fireEngineEvent(
	engine: EngineStub,
	event: string,
	...args: unknown[]
): void {
	engineListener(engine, event)(...args);
}

beforeEach(() => {
	observers = [];
	ResizeObserverStub.instances = observers;
	vi.stubGlobal('ResizeObserver', ResizeObserverStub);
	mocks.arrangeMindMap.mockReset();
	mocks.centerContentAtFullScale.mockReset();
	mocks.destroyMindMap.mockReset();
	mocks.fitMindMap.mockReset();
	mocks.getRenderRoot.mockReset();
	mocks.getRenderRoot.mockReturnValue(null);
	mocks.getRootText.mockReset();
	mocks.getRootText.mockReturnValue(null);
	mocks.getThemeConfig.mockReset();
	mocks.getThemeConfig.mockReturnValue({ theme: 'stub' });
	mocks.isDarkTheme.mockReset();
	mocks.isDarkTheme.mockReturnValue(false);
	mocks.isEditingText.mockReset();
	mocks.isEditingText.mockReturnValue(false);
	mocks.updateReferencesOnRename.mockReset();
	mocks.updateReferencesOnRename.mockReturnValue(true);
	mocks.removeReferencesOnDelete.mockReset();
	mocks.removeReferencesOnDelete.mockReturnValue(true);
	mocks.createMindMap.mockReset();
	mocks.createMindMap.mockImplementation(() => {
		const engine = makeEngineStub();
		harnesses[harnesses.length - 1]?.engines.push(engine);
		return engine;
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	// 先销毁再还原定时器：取消尚未触发的 150ms 视口恢复，避免跨用例污染
	for (const harness of harnesses) {
		harness.controller.destroyInstance();
	}
	harnesses.length = 0;
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 初始化：尺寸就绪路径与零尺寸等待
// ---------------------------------------------------------------------------

describe('EngineController.initMindMap（初始化入口与零尺寸等待）', () => {
	it('尺寸就绪即同步创建引擎：装配选项透传、不挂观察器', () => {
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		const tree = makeTree('Root');
		h.controller.initMindMap(tree);

		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
		const createOptions = mocks.createMindMap.mock.calls[0]![2] as Record<
			string,
			unknown
		>;
		expect(mocks.createMindMap.mock.calls[0]![0]).toBe(h.canvas);
		expect(mocks.createMindMap.mock.calls[0]![1]).toBe(tree);
		expect(createOptions).toMatchObject({
			layout: 'logicalStructure',
			themePref: 'default',
			isDark: false,
			enableDrag: false,
			performanceMode: false,
			performanceThreshold: 500,
			lang: 'zh',
		});
		expect(typeof createOptions.onHyperlinkJump).toBe('function');
		// 创建前先清空容器：渲染前的防御性清理（destroyInstance）与随后的
		// empty() 各一次，确保不会叠加上一次渲染的残余 DOM
		expect(h.canvas.empty).toHaveBeenCalledTimes(2);
		// 尺寸就绪路径完全同步：不产生等待中的观察器
		expect(observers).toHaveLength(0);
		expect(h.controller.mindMap).toBe(h.engines[0]);
		expect(h.deps.onEngineReady).toHaveBeenCalledWith(
			'logicalStructure',
			'auto',
		);
	});

	it('超链接跳转回调转发给视图（onHyperlinkJump 闭包绑定 deps）', () => {
		const h = readyHarness();
		const options = mocks.createMindMap.mock.calls[0]![2] as {
			onHyperlinkJump: (link: string) => void;
		};

		options.onHyperlinkJump('https://example.com');
		expect(h.deps.openHyperlink).toHaveBeenCalledWith('https://example.com');
	});

	it('挂载容器不存在（getCanvasEl 为 null）时静默返回，不创建引擎', () => {
		const h = buildHarness({ canvas: null });
		h.controller.initMindMap(makeTree('Root'));

		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers).toHaveLength(0);
		expect(h.controller.mindMap).toBeNull();
	});

	it('0 尺寸（后台叶）不创建引擎：挂 ResizeObserver 等待且不留轮询定时器', () => {
		vi.useFakeTimers();
		const h = buildHarness();
		h.controller.initMindMap(makeTree('Root'));

		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers).toHaveLength(1);
		expect(observers[0]!.observed[0]).toBe(h.canvas);
		// 关键回归：等待期间没有任何定时器在跑（旧实现是 200ms 轮询常驻）
		expect(vi.getTimerCount()).toBe(0);

		// 尺寸仍为 0：通知到达也不渲染、不断开（继续等待下一次尺寸变化）
		observers[0]!.fire();
		observers[0]!.fire();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers[0]!.disconnected).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('尺寸恢复（叶被激活）即事件驱动创建，装配后断开观察器', () => {
		const h = buildHarness();
		const tree = makeTree('Root');
		h.controller.initMindMap(tree);
		expect(observers).toHaveLength(1);

		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();

		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
		expect(mocks.createMindMap.mock.calls[0]![1]).toBe(tree);
		expect(observers[0]!.disconnected).toBe(true);
	});

	it('只有单边尺寸为 0 时同样等待（宽或高任一为 0 引擎都会抛错）', () => {
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 0;
		h.controller.initMindMap(makeTree('Root'));

		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers).toHaveLength(1);
		h.canvas.height = 600;
		observers[0]!.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
	});

	it('容器脱离 DOM 时不创建引擎（观察器等待重连），重连后尺寸达标才渲染', () => {
		const h = buildHarness();
		h.canvas.connected = false;
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(makeTree('Root'));

		// isConnected 守卫在同步路径就拦下（避免对已脱离的容器建引擎）
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers).toHaveLength(1);

		h.canvas.connected = true;
		observers[0]!.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
	});

	it('等待期间容器被判定脱离：观察器回调作废本次请求并断开', () => {
		const h = buildHarness();
		h.controller.initMindMap(makeTree('Root'));

		h.canvas.connected = false;
		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();

		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(observers[0]!.disconnected).toBe(true);
	});

	it('invalidateInit 作废在飞等待：尺寸恢复也不再渲染，观察器已断开', () => {
		const h = buildHarness();
		h.controller.initMindMap(makeTree('Root'));

		h.controller.invalidateInit();
		expect(observers[0]!.disconnected).toBe(true);

		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(h.controller.mindMap).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// 初始化代际锁：真正并发在飞的两代
// ---------------------------------------------------------------------------

describe('EngineController 初始化代际锁（并发 init 只有一代胜出）', () => {
	it('两代 init 同时在飞（均 0 尺寸等待）：只有最新一代装配，旧代回调被丢弃且不残留监听', () => {
		const h = buildHarness();
		const oldTree = makeTree('旧文件');
		const newTree = makeTree('新文件');

		// 第一代进入等待（容器过渡为 0 尺寸），随后文件切换发起第二代
		h.controller.initMindMap(oldTree);
		const oldObserver = observers[0]!;
		h.controller.initMindMap(newTree);
		const newObserver = observers[1]!;
		expect(observers).toHaveLength(2);

		// 新请求接管：旧代的等待立即断开，且此时代际尚未装配任何引擎
		expect(oldObserver.disconnected).toBe(true);
		expect(newObserver.disconnected).toBe(false);
		expect(mocks.createMindMap).not.toHaveBeenCalled();

		// 尺寸就绪：旧代已排队的 RO 通知必须被代际锁挡下（否则过期 tree 会被渲染）
		h.canvas.width = 800;
		h.canvas.height = 600;
		oldObserver.fire();
		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(h.deps.setupFeatures).not.toHaveBeenCalled();
		expect(h.deps.onEngineReady).not.toHaveBeenCalled();

		// 最新一代胜出，且只装配一次
		newObserver.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);
		expect(mocks.createMindMap.mock.calls[0]![1]).toBe(newTree);
		expect(newObserver.disconnected).toBe(true);

		// 旧代再次投递通知也不会产生第二次装配
		oldObserver.fire();
		expect(mocks.createMindMap).toHaveBeenCalledTimes(1);

		// 不残留监听：引擎作用域只有胜出那一代的 4 条，销毁时逐条 off
		const engine = h.engines[0]!;
		expect(registeredEvents(engine)).toHaveLength(4);
		h.controller.destroyInstance();
		expect(
			callPairs(engine.off),
		).toEqual(callPairs(engine.on));
	});

	it('新代等待期间旧引擎仍在使用；新代真正装配时才销毁旧实例并清空其监听', () => {
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(makeTree('A'));
		const oldEngine = h.engines[0]!;

		// 切换文件时容器瞬时 0 尺寸：新代进入等待，旧引擎此刻还不能销毁
		// （渲染尚未完成，提前销毁会让界面空白）
		h.canvas.width = 0;
		h.controller.initMindMap(makeTree('B'));
		expect(destroyedEngines()).toEqual([]);
		expect(h.controller.mindMap).toBe(oldEngine);

		h.canvas.width = 800;
		observers[0]!.fire();

		expect(destroyedEngines()).toEqual([oldEngine]);
		// 旧引擎的 DOM/引擎事件一并清理，不跨实例残留
		expect(oldEngine.off).toHaveBeenCalledTimes(4);
		expect(h.engines).toHaveLength(2);
		expect(h.controller.mindMap).toBe(h.engines[1]);
	});

	it('两代均已装配时，只有最新一代的首帧视口恢复生效（旧定时器被取消）', () => {
		vi.useFakeTimers();
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;

		h.controller.initMindMap(makeTree('A'));
		h.controller.initMindMap(makeTree('B'));
		expect(mocks.createMindMap).toHaveBeenCalledTimes(2);
		// 第一代的引擎在第二代装配时被销毁，其视口恢复定时器必须作废
		vi.advanceTimersByTime(150);

		expect(mocks.centerContentAtFullScale).toHaveBeenCalledTimes(1);
		expect(mocks.centerContentAtFullScale).toHaveBeenCalledWith(h.engines[1]);
		expect(h.engines[0]!.view.setTransformData).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 装配与销毁
// ---------------------------------------------------------------------------

describe('EngineController 装配与销毁', () => {
	it('创建后按固定顺序注册引擎事件、渲染、装配特性并回调 onEngineReady', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;

		// 事件名与顺序都是契约（顺序变化会让「先渲染再装配」的假设失效）
		expect(registeredEvents(engine)).toEqual([
			'data_change',
			'node_img_click',
			'node_dragend',
			'node_attachmentClick',
		]);
		expect(engine.render).toHaveBeenCalledTimes(1);
		expect(h.deps.setupFeatures).toHaveBeenCalledTimes(1);
		expect(h.deps.onEngineReady).toHaveBeenCalledTimes(1);

		// 顺序：创建 → 渲染 → 装配特性 → 通知视图就绪
		const createOrder = mocks.createMindMap.mock.invocationCallOrder[0]!;
		const renderOrder = engine.render.mock.invocationCallOrder[0]!;
		const setupOrder = h.deps.setupFeatures.mock.invocationCallOrder[0]!;
		const readyOrder = h.deps.onEngineReady.mock.invocationCallOrder[0]!;
		expect(createOrder).toBeLessThan(renderOrder);
		expect(renderOrder).toBeLessThan(setupOrder);
		expect(setupOrder).toBeLessThan(readyOrder);
	});

	it('装配选项每次渲染都重新读取（设置变更后 refresh 能拿到新值）', () => {
		const h = readyHarness();
		expect(h.deps.getSetupOptions).toHaveBeenCalledTimes(1);

		h.deps.getSetupOptions.mockReturnValue({
			layout: 'mindMap',
			lineStyle: 'curve',
			themePref: 'dark',
			enableDrag: true,
			performanceMode: true,
			performanceThreshold: 100,
		});
		h.controller.refresh();

		expect(mocks.createMindMap.mock.calls[1]![2]).toMatchObject({
			layout: 'mindMap',
			themePref: 'dark',
			enableDrag: true,
			performanceMode: true,
			performanceThreshold: 100,
		});
		// 视图侧收尾按本次布局/连线样式回调（工具栏同步依赖它）
		expect(h.deps.onEngineReady).toHaveBeenLastCalledWith('mindMap', 'curve');
	});

	it('createMindMap 抛错：兜底销毁、清空容器、不外抛，视图保持可用', () => {
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		mocks.createMindMap.mockImplementation(() => {
			throw new Error('boom');
		});

		expect(() => h.controller.initMindMap(makeTree('Root'))).not.toThrow();

		expect(console.error).toHaveBeenCalled();
		expect(h.controller.mindMap).toBeNull();
		// 创建前清空一次、兜底再清空一次（不留半成品 DOM）
		expect(h.canvas.empty.mock.calls.length).toBeGreaterThanOrEqual(2);
		// 失败路径不再往下走装配（否则会拿到 null 引擎）
		expect(h.deps.setupFeatures).not.toHaveBeenCalled();
		expect(h.deps.onEngineReady).not.toHaveBeenCalled();
	});

	it('装配阶段抛错（setupFeatures）同样兜底销毁已建实例并清空监听', () => {
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.deps.setupFeatures.mockImplementation(() => {
			throw new Error('setup failed');
		});

		expect(() => h.controller.initMindMap(makeTree('Root'))).not.toThrow();

		const engine = h.engines[0]!;
		expect(mocks.destroyMindMap).toHaveBeenCalledWith(engine);
		expect(engine.off).toHaveBeenCalledTimes(4);
		expect(h.controller.mindMap).toBeNull();
	});

	it('destroyInstance：销毁实例、清空容器、置空引用，并把引擎事件逐条 off（引用一致）', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;
		const emptyBefore = h.canvas.empty.mock.calls.length;

		h.controller.destroyInstance();

		expect(mocks.destroyMindMap).toHaveBeenCalledWith(engine);
		expect(h.controller.mindMap).toBeNull();
		expect(h.canvas.empty.mock.calls.length).toBe(emptyBefore + 1);
		// off 的 (事件名, 监听器) 与注册时完全一致：引擎按引用摘除，包一层即泄漏
		expect(callPairs(engine.off)).toEqual(callPairs(engine.on));
	});

	it('destroyInstance 幂等：重复销毁不再触发第二次 off/destroy', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;

		h.controller.destroyInstance();
		h.controller.destroyInstance();

		// 只有第一次销毁真的带实例（首帧前的那次防御性清理传的是 null）
		expect(destroyedEngines()).toEqual([engine]);
		expect(engine.off).toHaveBeenCalledTimes(4);
	});

	it('destroyInstance 断开零尺寸等待中的观察器（不留跨生命周期的观察）', () => {
		const h = buildHarness();
		h.controller.initMindMap(makeTree('Root'));
		expect(observers).toHaveLength(1);

		h.controller.destroyInstance();

		expect(observers[0]!.disconnected).toBe(true);
	});

	it('视图关闭/切文件的实际顺序（invalidateInit → destroyInstance）：过期回调不再装配', () => {
		const h = buildHarness();
		h.controller.initMindMap(makeTree('Root'));
		// 代际作废负责「已排队的通知」，销毁负责「观察器与实例」，
		// 视图两处都是先 invalidateInit 再 destroyInstance（view.ts 卸载/关闭路径）
		h.controller.invalidateInit();
		h.controller.destroyInstance();

		h.canvas.width = 800;
		h.canvas.height = 600;
		observers[0]!.fire();

		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(h.controller.mindMap).toBeNull();
	});

	it('未初始化时 destroyInstance 安全（视图未挂载即关闭的路径）', () => {
		const h = buildHarness();
		expect(() => h.controller.destroyInstance()).not.toThrow();
		expect(mocks.destroyMindMap).toHaveBeenCalledWith(null);
		expect(h.canvas.empty).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// 引擎事件的业务转发
// ---------------------------------------------------------------------------

describe('EngineController 引擎事件转发', () => {
	it('data_change → onRootDataChanged（每次派发都转发）', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;

		fireEngineEvent(engine, 'data_change');
		fireEngineEvent(engine, 'data_change');

		expect(h.deps.onRootDataChanged).toHaveBeenCalledTimes(2);
	});

	it('node_attachmentClick 带节点参数转发；缺参时静默忽略', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;
		const node = { getData: () => ({ attachmentUrl: 'a.pdf' }) };

		fireEngineEvent(engine, 'node_attachmentClick', node);
		expect(h.deps.onNodeAttachmentClick).toHaveBeenCalledWith(node);

		fireEngineEvent(engine, 'node_attachmentClick');
		expect(h.deps.onNodeAttachmentClick).toHaveBeenCalledTimes(1);
	});

	it('未拖拽时点击节点图片立即回调（灯箱）', () => {
		const h = readyHarness();
		const node = { getData: () => ({ image: 'a.png' }) };

		fireEngineEvent(h.engines[0]!, 'node_img_click', node);

		expect(h.deps.onNodeImageClick).toHaveBeenCalledWith(node);
	});

	it('node_img_click 缺参时静默忽略（引擎边界形态防御）', () => {
		const h = readyHarness();

		fireEngineEvent(h.engines[0]!, 'node_img_click');

		expect(h.deps.onNodeImageClick).not.toHaveBeenCalled();
	});

	it('node_dragend 后 300ms 内的图片点击被抑制，窗口到期即恢复（含边界）', () => {
		vi.useFakeTimers();
		const h = readyHarness();
		const engine = h.engines[0]!;
		const node = { getData: () => ({ image: 'a.png' }) };
		const clickImage = (): void => {
			fireEngineEvent(engine, 'node_img_click', node);
		};

		// 拖拽前：点击照常打开灯箱
		clickImage();
		expect(h.deps.onNodeImageClick).toHaveBeenCalledTimes(1);
		h.deps.onNodeImageClick.mockClear();

		fireEngineEvent(engine, 'node_dragend');
		clickImage();
		expect(h.deps.onNodeImageClick).not.toHaveBeenCalled();

		// 边界：抑制窗口是严格小于 300ms（299ms 仍抑制，300ms 起恢复）
		vi.advanceTimersByTime(299);
		clickImage();
		expect(h.deps.onNodeImageClick).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		clickImage();
		expect(h.deps.onNodeImageClick).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// 引用更新预检
// ---------------------------------------------------------------------------

describe('EngineController 引用更新预检（零拷贝短路）', () => {
	it('引擎不存在时直接返回 false，不触碰渲染树', () => {
		const h = buildHarness();
		const file = makeFile('notes/target.png');

		expect(h.controller.updateReferencesOnRename(file, 'notes/old.png')).toBe(
			false,
		);
		expect(h.controller.removeReferencesOnDelete(file)).toBe(false);
		expect(mocks.getRenderRoot).not.toHaveBeenCalled();
	});

	it('渲染树未就绪（getRenderRoot 为 null）时不深拷贝，返回 false', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(null);

		expect(h.controller.updateReferencesOnRename(h.file!, 'notes/old.png')).toBe(
			false,
		);
		expect(mocks.updateReferencesOnRename).not.toHaveBeenCalled();
		expect(h.engines[0]!.getData).not.toHaveBeenCalled();
	});

	it('无关文件的重命名：零拷贝跳过（不 getData / 不 setData）', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ text: '无关节点', image: 'notes/other.png' }),
		);

		const changed = h.controller.updateReferencesOnRename(
			makeFile('notes/new.png'),
			'notes/old.png',
		);

		expect(changed).toBe(false);
		// 预检确实执行过（遍历渲染树取过数据），只是未命中
		expect(mocks.getRenderRoot).toHaveBeenCalledTimes(1);
		expect(mocks.updateReferencesOnRename).not.toHaveBeenCalled();
		expect(h.engines[0]!.getData).not.toHaveBeenCalled();
		expect(h.engines[0]!.setData).not.toHaveBeenCalled();
	});

	it('预检命中：走 getData + 精确更新，成功则 setData 并返回 true', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;
		const tree = makeTree('Root');
		engine.getData.mockReturnValue(tree);
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ image: 'notes/old.png' }),
		);
		const file = makeFile('notes/new.png');

		expect(h.controller.updateReferencesOnRename(file, 'notes/old.png')).toBe(
			true,
		);

		expect(mocks.updateReferencesOnRename).toHaveBeenCalledWith(
			tree,
			file,
			'notes/old.png',
			expect.any(App),
		);
		// setData 收到的是刚取出的那一份树（不是再取一次）
		expect(engine.getData).toHaveBeenCalledTimes(1);
		expect(engine.setData).toHaveBeenCalledTimes(1);
		expect(engine.setData).toHaveBeenCalledWith(tree);
	});

	it('预检命中但更新无实际变更：不 setData，返回 false', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ hyperlink: '[[notes/old]]' }),
		);
		mocks.updateReferencesOnRename.mockReturnValue(false);

		const changed = h.controller.updateReferencesOnRename(
			makeFile('notes/new.md'),
			'notes/old.md',
		);

		expect(changed).toBe(false);
		expect(mocks.updateReferencesOnRename).toHaveBeenCalledTimes(1);
		expect(h.engines[0]!.setData).not.toHaveBeenCalled();
	});

	it('预检 needle 覆盖名称 / 完整路径 / 去扩展名 basename / URL 编码四种形态', () => {
		const h = readyHarness();
		const file = makeFile('notes/a b.png', 'a b.png');
		const cases = [
			'notes/a b.png', // file.name 命中
			'notes/old note.md', // oldPath 命中
			'notes/old note', // 去扩展名的 basename 命中
			'notes/a%20b.png', // encodeURIComponent(file.name) 命中
		];

		for (const ref of cases) {
			mocks.getRenderRoot.mockReturnValue(renderNode({ image: ref }));
			mocks.updateReferencesOnRename.mockClear();
			expect(
				h.controller.updateReferencesOnRename(file, 'notes/old note.md'),
			).toBe(true);
			expect(mocks.updateReferencesOnRename).toHaveBeenCalledTimes(1);
		}
	});

	it('预检命中即终止整树遍历（未访问的兄弟节点不取数据）', () => {
		const h = readyHarness();
		const third = renderNode({ image: 'notes/other.png' });
		const first = renderNode({ image: 'notes/target.png' });
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ text: 'root' }, [first, renderNode({ text: 'b' }), third]),
		);

		expect(h.controller.removeReferencesOnDelete(makeFile('notes/target.png'))).toBe(
			true,
		);

		expect(first.getData).toHaveBeenCalledTimes(1);
		expect(third.getData).not.toHaveBeenCalled();
	});

	it('删除引用同样经预检：无关文件零拷贝跳过', () => {
		const h = readyHarness();
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ hyperlink: '[[其它笔记]]' }),
		);

		expect(h.controller.removeReferencesOnDelete(makeFile('notes/other.png'))).toBe(
			false,
		);

		expect(mocks.getRenderRoot).toHaveBeenCalledTimes(1);
		expect(mocks.removeReferencesOnDelete).not.toHaveBeenCalled();
		expect(h.engines[0]!.getData).not.toHaveBeenCalled();
	});

	it('删除引用预检命中：清除成功则 setData 并返回 true', () => {
		const h = readyHarness();
		const engine = h.engines[0]!;
		const tree = makeTree('Root');
		engine.getData.mockReturnValue(tree);
		mocks.getRenderRoot.mockReturnValue(
			renderNode({ attachmentUrl: 'notes/del.pdf' }),
		);
		const file = makeFile('notes/del.pdf');

		expect(h.controller.removeReferencesOnDelete(file)).toBe(true);

		// 删除路径的比对串用 file.path 作为「旧路径」
		expect(mocks.removeReferencesOnDelete).toHaveBeenCalledWith(
			tree,
			file,
			expect.any(App),
		);
		expect(engine.setData).toHaveBeenCalledWith(tree);
	});
});

// ---------------------------------------------------------------------------
// refresh 与视口
// ---------------------------------------------------------------------------

describe('EngineController.refresh（引擎重建）', () => {
	it('深拷贝当前树后重建：新数据对象（含嵌套节点不复用引用）', () => {
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		const tree = makeTree('Root', [makeTree('Child')]);
		h.controller.initMindMap(tree);
		const firstEngine = h.engines[0]!;
		firstEngine.getData.mockReturnValue(tree);

		h.controller.refresh();

		expect(mocks.createMindMap).toHaveBeenCalledTimes(2);
		const rebuilt = mocks.createMindMap.mock.calls[1]![1] as MindMapTreeNode;
		expect(rebuilt).not.toBe(tree);
		expect(rebuilt.children[0]).not.toBe(tree.children[0]);
		expect(rebuilt).toEqual(tree);
		// 旧实例先销毁再建新的（同一挂载容器不能有两个引擎）
		expect(mocks.destroyMindMap).toHaveBeenCalledWith(firstEngine);
		expect(h.deps.setupFeatures).toHaveBeenCalledTimes(2);
	});

	it('引擎不存在时无操作（未初始化的视图收到设置变更）', () => {
		const h = buildHarness();

		h.controller.refresh();

		expect(mocks.createMindMap).not.toHaveBeenCalled();
		expect(h.deps.getSetupOptions).not.toHaveBeenCalled();
	});
});

describe('EngineController 视口持久化与恢复', () => {
	it('persistViewport 把引擎视口写入按文件路径的视图状态', () => {
		const h = readyHarness();
		const transform = { transform: { x: 3, y: 4, scale: 2 }, state: { b: 2 } };
		h.engines[0]!.view.getTransformData.mockReturnValue(transform);

		h.controller.persistViewport();

		expect(h.viewState.getView(h.file!.path)).toEqual(transform);
	});

	it('persistViewport：无文件或无引擎时静默跳过', () => {
		const noFile = buildHarness({ file: null });
		noFile.canvas.width = 800;
		noFile.canvas.height = 600;
		noFile.controller.initMindMap(makeTree('Root'));
		const setView = vi.spyOn(noFile.viewState, 'setView');

		noFile.controller.persistViewport();
		expect(setView).not.toHaveBeenCalled();
		expect(noFile.engines[0]!.view.getTransformData).not.toHaveBeenCalled();

		const noEngine = buildHarness();
		noEngine.controller.persistViewport();
		expect(noEngine.viewState.getView(noEngine.file!.path)).toBeUndefined();
	});

	it('persistViewport：引擎未就绪抛错时不外抛（下次打开退回默认视口）', () => {
		const h = readyHarness();
		h.engines[0]!.view.getTransformData.mockImplementation(() => {
			throw new Error('view not ready');
		});

		expect(() => h.controller.persistViewport()).not.toThrow();

		expect(console.warn).toHaveBeenCalled();
		expect(h.viewState.getView(h.file!.path)).toBeUndefined();
	});

	it('首帧后（150ms）无保存视口：默认 100% + 整体内容包围盒居中，不 fit', () => {
		vi.useFakeTimers();
		const h = readyHarness();

		// 首帧未到：不做任何视口动作（引擎还没完成首次布局）
		vi.advanceTimersByTime(149);
		expect(mocks.centerContentAtFullScale).not.toHaveBeenCalled();
		expect(h.engines[0]!.view.setTransformData).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(mocks.centerContentAtFullScale).toHaveBeenCalledTimes(1);
		expect(mocks.centerContentAtFullScale).toHaveBeenCalledWith(h.engines[0]);
		// 默认视口不再是 fit 全图：大图不被压到文字不可读
		expect(mocks.fitMindMap).not.toHaveBeenCalled();
		expect(h.engines[0]!.view.setTransformData).not.toHaveBeenCalled();
	});

	it('有保存视口时优先恢复，不重设默认视口、不 fit', () => {
		vi.useFakeTimers();
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		const saved = { transform: { x: 9, y: 8, scale: 1.5 }, state: { c: 3 } };
		h.viewState.hydrate({
			viewState: { [h.file!.path]: { layout: 'mindMap', view: saved } },
		});

		h.controller.initMindMap(makeTree('Root'));
		vi.advanceTimersByTime(150);

		expect(h.engines[0]!.view.setTransformData).toHaveBeenCalledTimes(1);
		expect(h.engines[0]!.view.setTransformData).toHaveBeenCalledWith(saved);
		expect(mocks.centerContentAtFullScale).not.toHaveBeenCalled();
		expect(mocks.fitMindMap).not.toHaveBeenCalled();
	});

	it('保存视口的键按文件路径隔离（换文件后不回退到其它文件的视口）', () => {
		vi.useFakeTimers();
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.viewState.hydrate({
			viewState: { 'notes/other.mindmap.md': { view: { transform: { x: 7 } } } },
		});

		h.controller.initMindMap(makeTree('Root'));
		vi.advanceTimersByTime(150);

		expect(h.engines[0]!.view.setTransformData).not.toHaveBeenCalled();
		expect(mocks.centerContentAtFullScale).toHaveBeenCalledTimes(1);
	});

	it('无文件时视口恢复整体跳过（不入库、不居中）', () => {
		vi.useFakeTimers();
		const h = buildHarness({ file: null });
		h.canvas.width = 800;
		h.canvas.height = 600;

		h.controller.initMindMap(makeTree('Root'));
		vi.advanceTimersByTime(150);

		expect(mocks.centerContentAtFullScale).not.toHaveBeenCalled();
		expect(mocks.fitMindMap).not.toHaveBeenCalled();
	});

	it('恢复视口抛错时回退 fit 全图（坏视口数据不让内容不可见）', () => {
		vi.useFakeTimers();
		const h = buildHarness();
		h.canvas.width = 800;
		h.canvas.height = 600;
		h.viewState.hydrate({
			viewState: { [h.file!.path]: { view: { transform: { x: 'bad' } } } },
		});
		h.controller.initMindMap(makeTree('Root'));
		const engine = h.engines[0]!;
		engine.view.setTransformData.mockImplementation(() => {
			throw new Error('bad transform');
		});

		vi.advanceTimersByTime(150);

		expect(console.error).toHaveBeenCalled();
		expect(mocks.fitMindMap).toHaveBeenCalledWith(engine);
	});

	it('默认视口设置抛错时同样回退 fit 全图', () => {
		vi.useFakeTimers();
		const h = readyHarness();
		mocks.centerContentAtFullScale.mockImplementation(() => {
			throw new Error('engine not ready');
		});

		vi.advanceTimersByTime(150);

		expect(mocks.fitMindMap).toHaveBeenCalledWith(h.engines[0]);
	});

	it('视口恢复定时器随实例销毁取消：不对已销毁引擎求值', () => {
		vi.useFakeTimers();
		const h = readyHarness();

		h.controller.destroyInstance();
		vi.advanceTimersByTime(150);

		expect(mocks.centerContentAtFullScale).not.toHaveBeenCalled();
		expect(h.engines[0]!.view.setTransformData).not.toHaveBeenCalled();
		expect(mocks.fitMindMap).not.toHaveBeenCalled();
	});

	it('invalidateInit 作废未触发的视口恢复（文件切换/视图关闭）', () => {
		vi.useFakeTimers();
		const h = readyHarness();

		h.controller.invalidateInit();
		vi.advanceTimersByTime(150);

		expect(mocks.centerContentAtFullScale).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 防腐收口的方法转发
// ---------------------------------------------------------------------------

describe('EngineController 防腐收口（引擎内部形态不外泄）', () => {
	it('isEditingText / getRootText 转发到 mindmap.ts 收口函数（无引擎时传 null）', () => {
		const h = buildHarness();
		mocks.isEditingText.mockReturnValue(true);
		mocks.getRootText.mockReturnValue('中心主题');

		expect(h.controller.isEditingText()).toBe(true);
		expect(h.controller.getRootText()).toBe('中心主题');
		expect(mocks.isEditingText).toHaveBeenCalledWith(null);
		expect(mocks.getRootText).toHaveBeenCalledWith(null);

		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(makeTree('Root'));
		const engine = h.engines[0]!;

		h.controller.isEditingText();
		h.controller.getRootText();
		expect(mocks.isEditingText).toHaveBeenCalledWith(engine);
		expect(mocks.getRootText).toHaveBeenCalledWith(engine);
	});

	it('getDataSnapshot 返回引擎树快照，无引擎时为 null', () => {
		const h = buildHarness();
		expect(h.controller.getDataSnapshot()).toBeNull();

		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(makeTree('Root'));
		const tree = makeTree('快照');
		h.engines[0]!.getData.mockReturnValue(tree);

		expect(h.controller.getDataSnapshot()).toBe(tree);
	});

	it('setLayout / resize 直接作用于当前引擎，无引擎时静默', () => {
		const h = buildHarness();

		expect(() => {
			h.controller.setLayout('mindMap');
			h.controller.resize();
		}).not.toThrow();

		h.canvas.width = 800;
		h.canvas.height = 600;
		h.controller.initMindMap(makeTree('Root'));
		h.controller.setLayout('mindMap');
		h.controller.resize();

		expect(h.engines[0]!.setLayout).toHaveBeenCalledWith('mindMap');
		expect(h.engines[0]!.resize).toHaveBeenCalledTimes(1);
		// 连线样式随布局联动：主题配置按本次布局（而非视图会话字段）重算并写入
		expect(mocks.getThemeConfig).toHaveBeenCalledWith(false, 'mindMap', 'auto');
		expect(h.engines[0]!.setThemeConfig).toHaveBeenCalledTimes(1);
		// 切换布局后自动整理一次（无引擎的那次早退不算）
		expect(mocks.arrangeMindMap).toHaveBeenCalledTimes(1);
		expect(mocks.arrangeMindMap).toHaveBeenCalledWith(h.engines[0]);
	});

	it('setLineStyle 按当前会话布局重算主题配置（偏好即时生效、无引擎时静默）', () => {
		const empty = buildHarness();
		expect(() => empty.controller.setLineStyle('direct')).not.toThrow();
		expect(mocks.getThemeConfig).not.toHaveBeenCalled();

		const h = readyHarness();
		h.controller.setLineStyle('direct');

		expect(mocks.getThemeConfig).toHaveBeenCalledWith(
			false,
			'logicalStructure',
			'direct',
		);
		expect(h.engines[0]!.setThemeConfig).toHaveBeenCalledTimes(1);
	});

	it('applyTheme 按当前主题偏好与布局重算深色判定并写入主题配置', () => {
		const h = readyHarness();
		const themeConfig = { theme: 'dark-stub' };
		mocks.getThemeConfig.mockReturnValue(themeConfig);

		h.controller.applyTheme();

		expect(mocks.isDarkTheme).toHaveBeenCalledWith('default', false);
		expect(mocks.getThemeConfig).toHaveBeenCalledWith(
			false,
			'logicalStructure',
			'auto',
		);
		expect(h.engines[0]!.setThemeConfig).toHaveBeenCalledWith(themeConfig);
	});

	it('applyTheme 无引擎时不读取设置项（避免无谓的主题计算）', () => {
		const h = buildHarness();

		h.controller.applyTheme();

		expect(mocks.isDarkTheme).not.toHaveBeenCalled();
		expect(h.deps.getSetupOptions).not.toHaveBeenCalled();
	});
});
