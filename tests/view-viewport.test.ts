/**
 * 画布视口手势回归（`features/view-viewport.ts`）。
 *
 * 为什么这样断言：
 * - **不得重复实现引擎已负责的手势**：滚轮与中键拖由引擎实现（vendor：
 *   `mindMap.el` 上的 `wheel` 监听先 `stopPropagation()` → 容器级 wheel 监听是死代码；
 *   中键拖走 event 模块 `isMiddleMousedown` → `drag` → View 平移，监听在 `window`）。
 *   插件在容器上再挂 pointer 系列平移会与引擎的绝对定位平移互相覆盖，且
 *   `pointerleave` 会让手势半途断掉——故本文件把「只注册 mousedown 一条」钉死；
 * - 容器级 `mousedown` 只做一件事：中键（`button === 1`）`preventDefault` 抑制
 *   浏览器原生自动滚动；左键不得拦（引擎画布拖拽/节点拖拽都靠它）；
 * - 滚轮是本插件接管的唯一输入：`Alt` 横轴 + 鼠标格纵向都走 rAF 平滑（K144），
 *   必须挂在**画布祖先的 capture**（引擎的监听在画布自身且先 `stopPropagation`；
 *   同元素 capture 会被引擎按注册顺序抢先）。让位项（`Ctrl/Cmd` 缩放优先、
 *   编辑中交引擎提交、指针不在画布内、纵向小 delta 触控板、纯横向 delta）逐条钉死；
 * - `zoomToSelection`（官方 `Shift+2`）：几何不变量——倍率取「画布留边 / 选区包围盒」
 *   的较小值，锚点 = 包围盒中心，平移量 = 两中心之差；顺序必须先缩放后平移
 *   （顺序颠倒时平移量算的是旧比例下的坐标）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import {
	altWheelPanDelta,
	fitToScreen,
	setupViewportGestures,
	zoomToSelection,
	type ViewportContext,
} from '../src/features/view-viewport';

const mocks = vi.hoisted(() => ({
	fitMindMap: vi.fn(),
	getActiveNodes: vi.fn((): unknown[] => []),
	getNodeGroupEl: vi.fn((): unknown => null),
	panMindMap: vi.fn(),
	zoomMindMapAt: vi.fn(),
	/** 平滑循环用：读到「平移后的变换」才能判定未被引擎夹住 */
	getDrawTransform: vi.fn(
		(): {
			scaleX: number;
			scaleY: number;
			translateX: number;
			translateY: number;
		} => ({ scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 }),
	),
	/** 大图 fit 的计数入口：默认 0（= 远低于阈值，走同步 fit） */
	countMindMapNodes: vi.fn((): number => 0),
	/** 编辑态判据（Alt+滚轮让位的条件之一） */
	isAnyNodeEditing: vi.fn((): boolean => false),
}));

vi.mock('../src/engine/mindmap', () => ({
	fitMindMap: mocks.fitMindMap,
	getActiveNodes: mocks.getActiveNodes,
	getDrawTransform: mocks.getDrawTransform,
	getNodeGroupEl: mocks.getNodeGroupEl,
	panMindMap: mocks.panMindMap,
	zoomMindMapAt: mocks.zoomMindMapAt,
	countMindMapNodes: mocks.countMindMapNodes,
}));

vi.mock('../src/features/node-inline-editor', () => ({
	isAnyNodeEditing: mocks.isAnyNodeEditing,
}));

interface DomRegistration {
	target: unknown;
	type: string;
	listener: (event: Event) => void;
	options?: unknown;
}

/** 事件绑定器桩：只记录注册面（destroy 语义与断言无关） */
function makeEngineEvents(): {
	onDom: ViewportContext['engineEvents']['onDom'];
	registrations: DomRegistration[];
} {
	const registrations: DomRegistration[] = [];
	return {
		registrations,
		onDom: (target: unknown, type: string, listener: unknown, options?: unknown) => {
			registrations.push({
				target,
				type,
				listener: listener as (event: Event) => void,
				options,
			});
		},
	};
}

/** 画布桩：`getBoundingClientRect` 只返回断言用得到的字段；父节点即视图容器 */
function makeCanvas(rect: {
	left: number;
	top: number;
	width: number;
	height: number;
}) {
	return {
		getBoundingClientRect: () => ({
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
		}),
		parentElement: { id: 'mindmap-view-container' },
		contains: () => false,
	} as unknown as HTMLElement;
}

/** 选区几何：画布 400×300，单节点盒 100×50 位于 (100,50)-(200,100) */
const CANVAS_RECT = { left: 0, top: 0, width: 400, height: 300 };
const NODE_RECT = {
	left: 100,
	top: 50,
	width: 100,
	height: 50,
	right: 200,
	bottom: 100,
};

function makeView(overrides: { nodes?: unknown[] } = {}) {
	const engineEvents = makeEngineEvents();
	const canvasEl = makeCanvas(CANVAS_RECT);
	const mindMap = { id: 'mm' } as unknown as MindMap;
	mocks.getActiveNodes.mockReturnValue(overrides.nodes ?? []);
	mocks.getNodeGroupEl.mockReturnValue({
		getBoundingClientRect: () => NODE_RECT,
	});
	const view = {
		mindMap,
		canvasEl,
		engineEvents: engineEvents as unknown,
	} as unknown as ViewportContext;
	return { view, mindMap, canvasEl, engineEvents };
}

/** `view-engineEvents` 的记录面（类型面与桩面互不重叠，故分开持有） */
const registrationsOf = (engineEvents: { registrations: DomRegistration[] }) =>
	engineEvents.registrations;

/** 假 rAF：按 16ms 推进并只跑当前队列，便于断言「分多帧走完」 */
interface RafHarness {
	win: Window;
	run(frames: number, stepMs?: number): void;
	pending(): number;
}

function makeRaf(): RafHarness {
	let seq = 1;
	let now = 0;
	const frames = new Map<number, FrameRequestCallback>();
	return {
		win: {
			requestAnimationFrame: (callback: FrameRequestCallback): number => {
				const id = seq++;
				frames.set(id, callback);
				return id;
			},
			cancelAnimationFrame: (id: number): void => {
				frames.delete(id);
			},
		} as unknown as Window,
		run(framesToRun: number, stepMs = 16): void {
			for (let i = 0; i < framesToRun && frames.size > 0; i++) {
				now += stepMs;
				const pending = [...frames.entries()];
				frames.clear();
				for (const [, callback] of pending) {
					callback(now);
				}
			}
		},
		pending: () => frames.size,
	};
}

/** 滚轮手势用的视图桩：画布有祖先（容器）、`contains` 与可驱动的 rAF 窗口 */
function makeWheelView(options: { editing?: boolean } = {}) {
	const engineEvents = makeEngineEvents();
	const inside = { id: 'canvas-child' };
	const outside = { id: 'toolbar-or-minimap-panel' };
	const raf = makeRaf();
	const pan = { x: 0, y: 0 };
	const canvasEl = makeCanvas(CANVAS_RECT);
	Object.assign(canvasEl as unknown as Record<string, unknown>, {
		contains: (node: unknown) => node === inside,
		ownerDocument: { defaultView: raf.win },
	});
	const mindMap = { id: 'mm' } as unknown as MindMap;
	mocks.isAnyNodeEditing.mockReturnValue(options.editing ?? false);
	// 平移桩与变换桩联表：`panMindMap` 改状态，`getDrawTransform` 读状态 ⇒
	// 平滑循环的「有没有真的动」判定在测试里也成立
	mocks.panMindMap.mockImplementation((_mindMap, dx: number, dy: number) => {
		pan.x += dx;
		pan.y += dy;
	});
	mocks.getDrawTransform.mockImplementation(() => ({
		scaleX: 1,
		scaleY: 1,
		translateX: pan.x,
		translateY: pan.y,
	}));
	const view = {
		mindMap,
		canvasEl,
		engineEvents: engineEvents as unknown,
	} as unknown as ViewportContext;
	setupViewportGestures(view);
	const wheel = registrationsOf(engineEvents).find(
		(entry) => entry.type === 'wheel',
	)!;
	return {
		view,
		mindMap,
		canvasEl,
		inside,
		outside,
		wheel,
		raf,
		engineEvents,
	};
}

/** 平滑过程中累计的位移（各帧 `panMindMap` 之和） */
function panTotal(): { x: number; y: number } {
	return mocks.panMindMap.mock.calls.reduce(
		(acc: { x: number; y: number }, call: unknown[]) => ({
			x: acc.x + (call[1] as number),
			y: acc.y + (call[2] as number),
		}),
		{ x: 0, y: 0 },
	);
}

function makeWheelEvent(
	init: {
		deltaY?: number;
		altKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
		target?: unknown;
	} = {},
) {
	return {
		deltaY: init.deltaY ?? 0,
		altKey: init.altKey ?? true,
		ctrlKey: init.ctrlKey ?? false,
		metaKey: init.metaKey ?? false,
		target: init.target,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getActiveNodes.mockReturnValue([]);
	mocks.getNodeGroupEl.mockReturnValue(null);
	mocks.panMindMap.mockReset();
	mocks.getDrawTransform.mockReset();
	mocks.getDrawTransform.mockReturnValue({
		scaleX: 1,
		scaleY: 1,
		translateX: 0,
		translateY: 0,
	});
});

describe('setupViewportGestures：只补引擎没有的手势', () => {
	it('只注册两条：mousedown（画布）+ 滚轮（画布祖先 capture）', () => {
		const { view, canvasEl, engineEvents } = makeView();

		setupViewportGestures(view);

		// 关键回归：曾在此注册 pointerdown / pointermove / pointerup / pointerleave
		// ——pointer 平移与引擎中键 drag 平移互相覆盖（pointerleave 令手势半途断掉）；
		// 纵向滚轮与 Ctrl+滚轮缩放仍**全部交给引擎**，插件只接 Alt 横轴。
		const registrations = registrationsOf(engineEvents);
		expect(registrations.map((entry) => entry.type)).toEqual(['mousedown', 'wheel']);
		expect(registrations[0]!.target).toBe(canvasEl);
		// capture 必须在祖先：引擎的 wheel 监听就在画布自身且先 stopPropagation
		const canvasHost = (canvasEl as unknown as { parentElement: unknown }).parentElement;
		expect(registrations[1]!.target).toBe(canvasHost);
		expect(registrations[1]!.options).toMatchObject({ capture: true, passive: false });
	});

	it('中键 mousedown → 抑制原生自动滚动；左键不拦', () => {
		const { view, engineEvents } = makeView();
		setupViewportGestures(view);
		const listener = registrationsOf(engineEvents)[0]!.listener;

		// spy 单独持有：把方法从对象上摘下断言会触发 unbound-method
		const middlePrevent = vi.fn();
		listener({ button: 1, preventDefault: middlePrevent } as unknown as MouseEvent);
		expect(middlePrevent).toHaveBeenCalledTimes(1);

		// 左键是引擎画布拖拽/节点拖拽的入口，拦掉会让拖拽整体失效
		const leftPrevent = vi.fn();
		listener({ button: 0, preventDefault: leftPrevent } as unknown as MouseEvent);
		expect(leftPrevent).not.toHaveBeenCalled();
	});

	it('canvasEl 缺席：不注册（引擎未就绪时不抛异常）', () => {
		const engineEvents = makeEngineEvents();
		const view = {
			mindMap: null,
			canvasEl: null,
			engineEvents: engineEvents as unknown,
		} as unknown as ViewportContext;

		expect(() => setupViewportGestures(view)).not.toThrow();
		expect(engineEvents.registrations).toHaveLength(0);
	});

	it('画布无父节点：不注册 wheel（无祖先则无法保证先于引擎）', () => {
		const engineEvents = makeEngineEvents();
		const canvasEl = makeCanvas(CANVAS_RECT);
		Object.assign(canvasEl as unknown as Record<string, unknown>, {
			parentElement: null,
		});
		const view = {
			mindMap: {} as MindMap,
			canvasEl,
			engineEvents: engineEvents as unknown,
		} as unknown as ViewportContext;

		setupViewportGestures(view);

		expect(engineEvents.registrations.map((entry) => entry.type)).toEqual([
			'mousedown',
		]);
	});
});

/**
 * 滚轮平移：`Alt` 横轴 + 鼠标格纵向，均走平滑（2026-10-26 用户裁决「太生硬」）。
 *
 * 断言口径：
 * - 事件里**不同步平移**：启动 rAF，多帧走完总行程（否则仍是瞬移）；
 * - 总行程与引擎一致：一格 100px（`deltaY=120` 也只一档），连滚累加；
 * - `Alt` 只改 x、无 `Alt` 只改 y（不「斜着走」）；
 * - 让位项：`Ctrl/Cmd`（缩放优先）、编辑中（引擎提交编辑）、指针不在画布内、
 *   纵向小 delta（触控板交引擎逐事件跟手）、纯横向 delta。
 */
describe('滚轮平移：平滑（Alt 横轴 + 鼠标格纵向）', () => {
	it('Alt 上滚：只改 x，多帧走完 ≈100px', () => {
		const { wheel, inside, raf } = makeWheelView();
		const event = makeWheelEvent({ deltaY: -100, target: inside });

		wheel.listener(event as unknown as Event);

		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		// 事件内不同步平移：交给 rAF
		expect(mocks.panMindMap).not.toHaveBeenCalled();

		raf.run(40);
		const total = panTotal();
		expect(total.x).toBeCloseTo(100, 0);
		expect(total.y).toBe(0);
		// 分多帧：不是一帧跳完
		expect(mocks.panMindMap.mock.calls.length).toBeGreaterThan(3);
	});

	it('Alt 下滚 / deltaY=120：都只走一档（≈ -100）', () => {
		const { wheel, inside, raf } = makeWheelView();

		wheel.listener(
			makeWheelEvent({ deltaY: 100, target: inside }) as unknown as Event,
		);
		raf.run(40);
		expect(panTotal().x).toBeCloseTo(-100, 0);

		mocks.panMindMap.mockClear();
		wheel.listener(
			makeWheelEvent({ deltaY: 120, target: inside }) as unknown as Event,
		);
		raf.run(40);
		expect(panTotal().x).toBeCloseTo(-100, 0);
	});

	it('Alt 小 delta（触控板横滑）：按实际幅度跟手（≈3px）', () => {
		const { wheel, inside, raf } = makeWheelView();

		wheel.listener(
			makeWheelEvent({ deltaY: -3, target: inside }) as unknown as Event,
		);
		raf.run(40);

		expect(panTotal().x).toBeCloseTo(3, 1);
		expect(panTotal().y).toBe(0);
	});

	it('无 Alt 上滚：纵向平滑 100px，并在 capture 拦下引擎', () => {
		const { wheel, inside, raf } = makeWheelView();
		const event = makeWheelEvent({ deltaY: -100, altKey: false, target: inside });

		wheel.listener(event as unknown as Event);

		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		raf.run(40);
		const total = panTotal();
		expect(total.x).toBe(0);
		expect(total.y).toBeCloseTo(100, 0);
	});

	it('无 Alt 下滚：纵向 ≈ -100', () => {
		const { wheel, inside, raf } = makeWheelView();

		wheel.listener(
			makeWheelEvent({
				deltaY: 100,
				altKey: false,
				target: inside,
			}) as unknown as Event,
		);
		raf.run(40);

		expect(panTotal().y).toBeCloseTo(-100, 0);
	});

	it('连滚两格：目标累加，多帧走完 ≈200px', () => {
		const { wheel, inside, raf } = makeWheelView();

		wheel.listener(
			makeWheelEvent({
				deltaY: 100,
				altKey: false,
				target: inside,
			}) as unknown as Event,
		);
		wheel.listener(
			makeWheelEvent({
				deltaY: 100,
				altKey: false,
				target: inside,
			}) as unknown as Event,
		);
		raf.run(80);

		expect(panTotal().y).toBeCloseTo(-200, 0);
	});

	it('同帧十格：首帧位移限幅（≤120px，不瞬移）', () => {
		const { wheel, inside, raf } = makeWheelView();

		for (let i = 0; i < 10; i++) {
			wheel.listener(
				makeWheelEvent({
					deltaY: 100,
					altKey: false,
					target: inside,
				}) as unknown as Event,
			);
		}
		raf.run(1);

		expect(Math.abs(panTotal().y)).toBeLessThanOrEqual(120);
	});

	it('纵向小 delta（触控板）：让位给引擎（不拦、不平移）', () => {
		const { wheel, inside } = makeWheelView();
		const event = makeWheelEvent({ deltaY: -7, altKey: false, target: inside });

		wheel.listener(event as unknown as Event);

		expect(mocks.panMindMap).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it('Ctrl/Cmd：缩放优先，插件不抢', () => {
		const { wheel, inside } = makeWheelView();
		const events = [
			makeWheelEvent({ deltaY: -100, target: inside, ctrlKey: true }),
			makeWheelEvent({ deltaY: -100, target: inside, metaKey: true }),
		];

		for (const event of events) {
			wheel.listener(event as unknown as Event);
			expect(event.preventDefault).not.toHaveBeenCalled();
		}
		expect(mocks.panMindMap).not.toHaveBeenCalled();
	});

	it('指针不在画布内（工具栏 / 搜索栏 / 小地图面板本体）：不拦', () => {
		const { wheel, outside } = makeWheelView();
		const event = makeWheelEvent({ deltaY: -100, target: outside });

		wheel.listener(event as unknown as Event);

		expect(mocks.panMindMap).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('编辑中让位：引擎的 wheel 负责提交编辑', () => {
		const { wheel, inside } = makeWheelView({ editing: true });
		const event = makeWheelEvent({ deltaY: -100, target: inside });

		wheel.listener(event as unknown as Event);

		expect(mocks.panMindMap).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('纯横向 delta（触控板横滑）：不拦，交引擎原生处理', () => {
		const { wheel, inside } = makeWheelView();
		const event = makeWheelEvent({ deltaY: 0, target: inside });

		wheel.listener(event as unknown as Event);

		expect(mocks.panMindMap).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('拖拽开始（mousedown）会取消未走完的平滑', () => {
		const { wheel, inside, raf, engineEvents } = makeWheelView();

		wheel.listener(
			makeWheelEvent({
				deltaY: 100,
				altKey: false,
				target: inside,
			}) as unknown as Event,
		);
		raf.run(1);
		const afterFirstFrame = panTotal();
		expect(afterFirstFrame.y).toBeLessThan(0);

		const mousedown = registrationsOf(engineEvents).find(
			(entry) => entry.type === 'mousedown',
		)!;
		mousedown.listener({
			button: 0,
			preventDefault: vi.fn(),
		} as unknown as MouseEvent);
		raf.run(20);

		expect(panTotal()).toEqual(afterFirstFrame);
	});
});

describe('altWheelPanDelta（纯映射）', () => {
	it('上滚为正 / 下滚为负，幅度封顶一档', () => {
		expect(altWheelPanDelta(-100)).toBe(100);
		expect(altWheelPanDelta(100)).toBe(-100);
		expect(altWheelPanDelta(-120)).toBe(100);
		expect(altWheelPanDelta(-7)).toBe(7);
	});

	it('0 / 非有限值 → 0（不平移）', () => {
		expect(altWheelPanDelta(0)).toBe(0);
		expect(altWheelPanDelta(Number.NaN)).toBe(0);
		expect(altWheelPanDelta(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('zoomToSelection（官方 Shift+2）', () => {
	it('单节点选区：按留边倍率缩放 → 再平移到画布中心（顺序固定）', () => {
		const { view, mindMap } = makeView({ nodes: [{}] });

		expect(zoomToSelection(view)).toBe(true);

		// 倍率 = min(400×0.88/100, 300×0.88/50) = 3.52；锚点 = 包围盒中心
		expect(mocks.zoomMindMapAt).toHaveBeenCalledWith(mindMap, 3.52, 150, 75);
		// 平移 = 画布中心 − 包围盒中心
		expect(mocks.panMindMap).toHaveBeenCalledWith(mindMap, 50, 75);
		// 顺序：先缩放（新比例下包围盒中心才落到锚点处）→ 再平移
		const zoomOrder = mocks.zoomMindMapAt.mock.invocationCallOrder[0]!;
		const panOrder = mocks.panMindMap.mock.invocationCallOrder[0]!;
		expect(zoomOrder).toBeLessThan(panOrder);
	});

	it('多节点：取并集包围盒（跨节点整体可见）', () => {
		const { view, mindMap } = makeView({
			nodes: [{}, {}],
		});
		mocks.getNodeGroupEl
			.mockReturnValueOnce({ getBoundingClientRect: () => NODE_RECT })
			.mockReturnValueOnce({
				getBoundingClientRect: () => ({
					left: 300,
					top: 150,
					width: 100,
					height: 50,
					right: 400,
					bottom: 200,
				}),
			});

		expect(zoomToSelection(view)).toBe(true);

		// 并集 = (100,50)-(400,200)：面积 300×150，中心 (250,125)
		expect(mocks.zoomMindMapAt).toHaveBeenCalledWith(
			mindMap,
			Math.min((400 * 0.88) / 300, (300 * 0.88) / 150),
			250,
			125,
		);
	});

	it('无激活节点 → false 且不触碰视口（调用方回落「适应画布」）', () => {
		const { view } = makeView();

		expect(zoomToSelection(view)).toBe(false);
		expect(mocks.zoomMindMapAt).not.toHaveBeenCalled();
		expect(mocks.panMindMap).not.toHaveBeenCalled();
	});

	it('拿不到包围盒（未渲染/0 尺寸）→ false，不做除零平移', () => {
		const { view } = makeView({ nodes: [{}] });
		mocks.getNodeGroupEl.mockReturnValue(null);

		expect(zoomToSelection(view)).toBe(false);
		expect(mocks.zoomMindMapAt).not.toHaveBeenCalled();

		// 有元素但尺寸为 0（引擎折叠/离屏）同样回落
		mocks.getNodeGroupEl.mockReturnValue({
			getBoundingClientRect: () => ({
				left: 0,
				top: 0,
				width: 0,
				height: 0,
				right: 0,
				bottom: 0,
			}),
		});
		expect(zoomToSelection(view)).toBe(false);
		expect(mocks.zoomMindMapAt).not.toHaveBeenCalled();
	});

	it('画布尺寸为 0（初始化中）→ false，不出 Infinity 倍率', () => {
		const engineEvents = makeEngineEvents();
		const view = {
			mindMap: {} as MindMap,
			canvasEl: makeCanvas({ left: 0, top: 0, width: 0, height: 0 }),
			engineEvents: engineEvents as unknown,
		} as unknown as ViewportContext;
		mocks.getActiveNodes.mockReturnValue([{}]);
		mocks.getNodeGroupEl.mockReturnValue({
			getBoundingClientRect: () => NODE_RECT,
		});

		expect(zoomToSelection(view)).toBe(false);
		expect(mocks.zoomMindMapAt).not.toHaveBeenCalled();
	});
});

describe('fitToScreen（官方 Shift+1）', () => {
	it('转发引擎「适应画布」（引擎缺失时静默）', () => {
		const mindMap = {} as MindMap;
		const view = { mindMap } as unknown as ViewportContext;

		fitToScreen(view);

		expect(mocks.fitMindMap).toHaveBeenCalledWith(mindMap);
	});
});

/**
 * 大图提示的判据来源：**只信引擎返回值**（`fitMindMap` 的 `clamped`）。
 *
 * 为什么不在 UI 侧按节点数判断：节点多但内容本就适配（fit 比例 ≥ 可读下限）时，
 * 按节点数判断会说「已按最小可读比例居中」——与事实相反。而节点计数是 O(n)，
 * 只在真正钳制（罕见）时才需要，故断言 `countMindMapNodes` 的调用次数即可
 * 证明分支走对（Notice 在测试环境是空实现，不作为断言对象）。
 */
describe('fitToScreen 大图提示', () => {
	beforeEach(() => {
		mocks.fitMindMap.mockClear();
		mocks.fitMindMap.mockReturnValue('fit');
		mocks.countMindMapNodes.mockClear();
		mocks.countMindMapNodes.mockReturnValue(5000);
	});

	it('引擎返回 fit：不提示、不取节点数（常规路径零额外遍历）', () => {
		const mindMap = {} as MindMap;

		fitToScreen({ mindMap } as unknown as ViewportContext);

		expect(mocks.fitMindMap).toHaveBeenCalledWith(mindMap);
		expect(mocks.countMindMapNodes).not.toHaveBeenCalled();
	});

	it('引擎返回 clamped：提示里带一次节点数（只数一次）', () => {
		mocks.fitMindMap.mockReturnValue('clamped');
		const mindMap = {} as MindMap;

		fitToScreen({ mindMap } as unknown as ViewportContext);

		expect(mocks.fitMindMap).toHaveBeenCalledTimes(1);
		expect(mocks.countMindMapNodes).toHaveBeenCalledTimes(1);
	});

	it('引擎缺失：既不 fit 也不计数、不抛', () => {
		fitToScreen({ mindMap: null } as unknown as ViewportContext);

		expect(mocks.fitMindMap).not.toHaveBeenCalled();
		expect(mocks.countMindMapNodes).not.toHaveBeenCalled();
	});
});
