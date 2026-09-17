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
 * - `zoomToSelection`（官方 `Shift+2`）：几何不变量——倍率取「画布留边 / 选区包围盒」
 *   的较小值，锚点 = 包围盒中心，平移量 = 两中心之差；顺序必须先缩放后平移
 *   （顺序颠倒时平移量算的是旧比例下的坐标）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import {
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
}));

vi.mock('../src/engine/mindmap', () => ({
	fitMindMap: mocks.fitMindMap,
	getActiveNodes: mocks.getActiveNodes,
	getNodeGroupEl: mocks.getNodeGroupEl,
	panMindMap: mocks.panMindMap,
	zoomMindMapAt: mocks.zoomMindMapAt,
}));

interface DomRegistration {
	target: unknown;
	type: string;
	listener: (event: MouseEvent) => void;
}

/** 事件绑定器桩：只记录注册面（destroy 语义与断言无关） */
function makeEngineEvents(): {
	onDom: ViewportContext['engineEvents']['onDom'];
	registrations: DomRegistration[];
} {
	const registrations: DomRegistration[] = [];
	return {
		registrations,
		onDom: (target: unknown, type: string, listener: unknown) => {
			registrations.push({
				target,
				type,
				listener: listener as (event: MouseEvent) => void,
			});
		},
	};
}

/** 画布桩：`getBoundingClientRect` 只返回断言用得到的字段 */
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

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getActiveNodes.mockReturnValue([]);
	mocks.getNodeGroupEl.mockReturnValue(null);
});

describe('setupViewportGestures：只补引擎没有的手势', () => {
	it('容器上只注册 mousedown 一条（滚轮/中键拖不许重复实现）', () => {
		const { view, canvasEl, engineEvents } = makeView();

		setupViewportGestures(view);

		// 关键回归：曾在此注册 wheel / pointerdown / pointermove / pointerup /
		// pointerleave——wheel 被引擎 stopPropagation 后是死代码，pointer 平移与
		// 引擎中键 drag 平移互相覆盖（且 pointerleave 令手势半途断掉）
		const registrations = registrationsOf(engineEvents);
		expect(registrations.map((entry) => entry.type)).toEqual(['mousedown']);
		expect(registrations[0]!.target).toBe(canvasEl);
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
