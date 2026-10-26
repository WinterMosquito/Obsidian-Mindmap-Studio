/**
 * 小地图会话级回归（`features/view-minimap`）：状态机 + DOM 副作用的唯一测试面。
 *
 * 为什么要有这一层：`core/minimap-geometry` 的纯几何已被直测，但「何时画、何时
 * 藏、切布局为什么推迟、拖拽会不会动框、销毁是否清干净」全在会话状态机里——
 * 它此前只有实机手工作证。
 *
 * 环境说明：仓库是 Node 环境（无 jsdom，新增即触发依赖审批），故这里用
 * **最小 fake DOM + fake window** 跑真实模块：元素的 Obsidian 扩展方法
 * （`createDiv` / `addClass` / `style` / `remove`）与 `containerEl.win` 的
 * 定时器、rAF、监听器都只实现模块实际调用的子集。
 *
 * 引擎侧整体 `vi.mock`（`engine/mindmap` 的五个读取函数）：本测试断言的是
 * **会话决策**，不是引擎取样——取样正确性由 `tests/minimap-geometry.test.ts`
 * 与实机验收覆盖。
 *
 * 一条易回归的契约：窗口缩放时视口框**只重投影、不重画**，且投影必须用
 * `getCanvasSize` 的**实时画布**——绘制快照 `geometry.canvas` 到下一次 30s
 * 节拍前都是旧值（K140，2026-10-26 实机 29.7s 才更新的根因）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiniMapContext } from '../src/features/view-minimap';
import {
	refreshMiniMap,
	refreshMiniMapAfterRender,
	setupMiniMap,
	teardownMiniMap,
} from '../src/features/view-minimap';

const mocks = vi.hoisted(() => ({
	captureMiniMap: vi.fn<
		(mindMap: unknown, measured?: unknown, canvasSize?: unknown) => unknown
	>(),
	contentExceedsCanvasAtFullScale: vi.fn<() => unknown>(),
	getCanvasSize: vi.fn<() => unknown>(),
	getDrawTransform: vi.fn<() => unknown>(),
	measureMiniMapContent: vi.fn<() => unknown>(),
	panMindMap: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../src/engine/mindmap', () => ({
	captureMiniMap: mocks.captureMiniMap,
	contentExceedsCanvasAtFullScale: mocks.contentExceedsCanvasAtFullScale,
	getCanvasSize: mocks.getCanvasSize,
	getDrawTransform: mocks.getDrawTransform,
	measureMiniMapContent: mocks.measureMiniMapContent,
	panMindMap: mocks.panMindMap,
}));

/** fake timers 的起点：真实纪元毫秒（节流器 `lastRunAt = 0` 的首调用语义不变） */
const EPOCH_MS = 1_700_000_000_000;
/** 缩略比例：面板 220 / 内容 1000 */
const MINI_SCALE = 0.22;

/** 一帧缩略图（内容 1000×500 → 面板 220×110） */
const FRAME_A = {
	content: { x: 0, y: 0, width: 1000, height: 500 },
	canvas: { width: 800, height: 600 },
	panel: { width: 220, height: 110 },
	signature: 111,
	image: 'data:image/svg+xml;charset=utf-8,A',
};

/** 同面板、不同内容几何（模拟「切布局后渲染落地」） */
const FRAME_B = {
	...FRAME_A,
	content: { x: 0, y: 0, width: 2000, height: 1000 },
	image: 'data:image/svg+xml;charset=utf-8,B',
};

// ---------------------------------------------------------------------------
// 最小 fake DOM / window / 事件绑定器
// ---------------------------------------------------------------------------

type StyleBag = Record<string, string> & { removeProperty(name: string): void };

function createStyle(): StyleBag {
	const bag: Record<string, string> = {};
	Object.defineProperty(bag, 'removeProperty', {
		value: (name: string): void => {
			delete bag[name];
		},
		enumerable: false,
	});
	return bag as StyleBag;
}

class FakeEl {
	readonly tagName: string;
	classes = new Set<string>();
	attrs = new Map<string, string>();
	children: FakeEl[] = [];
	style = createStyle();
	parent: FakeEl | null = null;
	removed = false;
	/** `<img>` 的 src：模块以**属性写法**赋值（`image.src = …`） */
	src = '';

	constructor(tagName: string) {
		this.tagName = tagName;
	}

	get className(): string {
		return [...this.classes].join(' ');
	}

	addClass(...names: string[]): void {
		for (const name of names) {
			this.classes.add(name);
		}
	}

	removeClass(...names: string[]): void {
		for (const name of names) {
			this.classes.delete(name);
		}
	}

	setAttribute(name: string, value: string): void {
		this.attrs.set(name, value);
		if (name === 'src') {
			this.src = value;
		}
	}

	getAttribute(name: string): string | null {
		if (name === 'style') {
			const bag: Record<string, string> = this.style;
			return Object.entries(bag)
				.map(([key, value]) => `${key}: ${value}`)
				.join('; ');
		}
		return this.attrs.get(name) ?? null;
	}

	removeAttribute(name: string): void {
		this.attrs.delete(name);
		if (name === 'src') {
			this.src = '';
		}
		if (name === 'style') {
			this.style = createStyle();
		}
	}

	createDiv(options?: string | { cls?: string }): FakeEl {
		return this.appendChild('div', options);
	}

	createEl(tag: string, options?: string | { cls?: string }): FakeEl {
		return this.appendChild(tag, options);
	}

	contains(node: unknown): boolean {
		if (node === this) {
			return true;
		}
		return this.children.some((child) => child.contains(node));
	}

	/** 滚轮转发会往画布上重派发事件：只记录，不做冒泡 */
	dispatched: Array<{ type: string; event: Record<string, unknown> }> = [];

	dispatchEvent(event: Record<string, unknown>): boolean {
		this.dispatched.push({ type: String(event.type), event });
		return true;
	}

	remove(): void {
		this.removed = true;
		if (this.parent) {
			this.parent.children = this.parent.children.filter(
				(child) => child !== this,
			);
			this.parent = null;
		}
	}

	private appendChild(tag: string, options?: string | { cls?: string }): FakeEl {
		const el = new FakeEl(tag);
		const cls = typeof options === 'string' ? options : options?.cls;
		if (cls) {
			el.addClass(...cls.split(/\s+/).filter(Boolean));
		}
		el.parent = this;
		this.children.push(el);
		return el;
	}
}

/** 轮子事件替身（`forwardWheel` 只用构造器 + 属性透传） */
class FakeWheelEvent {
	readonly type: string;

	constructor(type: string, init: Record<string, unknown> = {}) {
		this.type = type;
		Object.assign(this, init);
	}
}

class FakeWin {
	/** 面板所属窗口的 WheelEvent 构造器（`forwardWheel` 从窗口取，popout 跨 realm 同款） */
	readonly WheelEvent = FakeWheelEvent;
	private timers = new Map<number, () => void>();
	private frames = new Map<number, () => void>();
	private listeners = new Map<string, Set<(event: unknown) => void>>();
	private seq = 1;

	setTimeout(callback: () => void, ms: number): number {
		const id = this.seq++;
		// tests/setup.ts 把 window 指向 globalThis ⇒ 这里即受 vi.useFakeTimers 控制
		const handle = window.setTimeout(() => {
			this.timers.delete(id);
			callback();
		}, ms);
		this.timers.set(id, () => window.clearTimeout(handle));
		return id;
	}

	clearTimeout(id: number): void {
		this.timers.get(id)?.();
		this.timers.delete(id);
	}

	requestAnimationFrame(callback: () => void): number {
		const id = this.seq++;
		this.frames.set(id, callback);
		return id;
	}

	cancelAnimationFrame(id: number): void {
		this.frames.delete(id);
	}

	/** 跑完当前排队的帧（模块只在 rAF 里更新视口框） */
	runFrames(): void {
		const pending = [...this.frames.values()];
		this.frames.clear();
		for (const callback of pending) {
			callback();
		}
	}

	addEventListener(type: string, callback: (event: unknown) => void): void {
		const bucket = this.listeners.get(type);
		if (bucket) {
			bucket.add(callback);
		} else {
			this.listeners.set(type, new Set([callback]));
		}
	}

	removeEventListener(type: string, callback: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(callback);
	}

	dispatch(type: string, event: unknown): void {
		for (const callback of [...(this.listeners.get(type) ?? [])]) {
			callback(event);
		}
	}

	get listenerCount(): number {
		let total = 0;
		for (const bucket of this.listeners.values()) {
			total += bucket.size;
		}
		return total;
	}
}

interface FakeBinder {
	onEngine: (mindMap: unknown, event: string, callback: () => void) => void;
	onDom: (el: unknown, type: string, callback: (event: unknown) => void) => void;
	emitEngine: (event: string) => void;
	emitDom: (el: FakeEl, type: string, event: unknown) => void;
}

function createBinder(): FakeBinder {
	const engine = new Map<string, Array<() => void>>();
	const dom: Array<{
		el: FakeEl;
		type: string;
		callback: (event: unknown) => void;
	}> = [];
	return {
		onEngine(_mindMap, event, callback) {
			const bucket = engine.get(event);
			if (bucket) {
				bucket.push(callback);
			} else {
				engine.set(event, [callback]);
			}
		},
		onDom(el, type, callback) {
			dom.push({ el: el as FakeEl, type, callback });
		},
		emitEngine(event) {
			for (const callback of [...(engine.get(event) ?? [])]) {
				callback();
			}
		},
		emitDom(el, type, event) {
			for (const entry of dom) {
				if (entry.el === el && entry.type === type) {
					entry.callback(event);
				}
			}
		},
	};
}

interface Harness {
	view: MiniMapContext;
	win: FakeWin;
	container: FakeEl;
	binder: FakeBinder;
}

function createHarness(): Harness {
	const win = new FakeWin();
	const container = new FakeEl('div');
	// 视图容器带 `win`（Obsidian 的跨窗口支持）
	(container as unknown as { win: FakeWin }).win = win;
	const binder = createBinder();
	const view = {
		mindMap: { fake: 'engine' },
		engineEvents: binder,
		canvasEl: new FakeEl('div'),
		containerEl: container,
	} as unknown as MiniMapContext;
	return { view, win, container, binder };
}

function panelOf(harness: Harness): FakeEl {
	const panel = harness.container.children.find((child) =>
		child.classes.has('mindmap-minimap'),
	);
	if (!panel) {
		throw new Error('面板未装配');
	}
	return panel;
}

function childOf(panel: FakeEl, cls: string): FakeEl {
	const el = panel.children.find((child) => child.classes.has(cls));
	if (!el) {
		throw new Error(`缺少子元素 ${cls}`);
	}
	return el;
}

let active: Harness | null = null;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(EPOCH_MS));
	mocks.captureMiniMap.mockReset();
	mocks.contentExceedsCanvasAtFullScale.mockReset();
	mocks.getCanvasSize.mockReset();
	mocks.getDrawTransform.mockReset();
	mocks.measureMiniMapContent.mockReset();
	mocks.panMindMap.mockReset();
	mocks.getCanvasSize.mockReturnValue({ width: 800, height: 600 });
	mocks.contentExceedsCanvasAtFullScale.mockReturnValue(true);
	mocks.measureMiniMapContent.mockReturnValue({
		bounds: { x: 0, y: 0, width: 1000, height: 500 },
		total: 3,
	});
	mocks.captureMiniMap.mockReturnValue(FRAME_A);
	mocks.getDrawTransform.mockReturnValue({
		scaleX: 1,
		scaleY: 1,
		translateX: 0,
		translateY: 0,
	});
});

afterEach(() => {
	if (active) {
		teardownMiniMap(active.view);
		active = null;
	}
	vi.useRealTimers();
});

describe('setupMiniMap：装配即画首帧', () => {
	it('判据通过就取样一次、定尺寸、上图并显示', () => {
		active = createHarness();
		setupMiniMap(active.view);

		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(1);
		const panel = panelOf(active);
		expect(panel.className).toContain('is-visible');
		expect(panel.style.width).toBe('220px');
		expect(panel.style.height).toBe('110px');
		expect(childOf(panel, 'mindmap-minimap-img').src).toBe(FRAME_A.image);
	});

	it('判据与首帧取图共用同一份全树测量（省一遍遍历，且口径必然一致）', () => {
		active = createHarness();
		const measured = {
			bounds: { x: 0, y: 0, width: 1000, height: 500 },
			total: 3,
		};
		mocks.measureMiniMapContent.mockReturnValue(measured);
		setupMiniMap(active.view);

		expect(mocks.measureMiniMapContent).toHaveBeenCalledTimes(1);
		// 判据也用同一次画布读数（不再自己读实时矩形）
		expect(mocks.contentExceedsCanvasAtFullScale).toHaveBeenCalledWith(
			expect.anything(),
			measured,
			{ width: 800, height: 600 },
		);
		// 同一份对象原样传进取图（不是再测一遍）
		expect(mocks.captureMiniMap.mock.calls[0]?.[1]).toBe(measured);
		expect(mocks.captureMiniMap.mock.calls[0]?.[2]).toEqual({
			width: 800,
			height: 600,
		});
	});

	it('视口框在 rAF 里按百分比落位（内容 1000 宽 / 画布 800 → 占 80%）', () => {
		active = createHarness();
		setupMiniMap(active.view);
		active.win.runFrames();

		const box = childOf(panelOf(active), 'mindmap-minimap-view');
		// 框贴面板边（不内缩）：left/top 均为 0%
		expect(box.style.left).toBe('0%');
		expect(box.style.top).toBe('0%');
		expect(box.style.width).toBe('80%');
		expect(box.className).not.toContain('is-hidden');
	});

	it('窗口缩放：视口框按**实时画布**重投影（不等 30s 换图，也不读绘制快照）', () => {
		active = createHarness();
		setupMiniMap(active.view);
		active.win.runFrames();
		const box = childOf(panelOf(active), 'mindmap-minimap-view');
		expect(box.style.width).toBe('80%'); // 画布 800 / 内容 1000

		// 窗口放大：画布 1600 ⇒ 可视内容超过整张内容，框铺满面板
		mocks.getCanvasSize.mockReturnValue({ width: 1600, height: 600 });
		active.binder.emitEngine('resize');
		active.win.runFrames();
		expect(box.style.width).toBe('100%');
		// 关键：只重投影，没有走 30s 节拍重画缩略图（`captureMiniMap` 仍只有装配那次）
		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(1);

		// 窗口缩小：画布 400 ⇒ 可视内容 400/1000
		mocks.getCanvasSize.mockReturnValue({ width: 400, height: 600 });
		active.binder.emitEngine('resize');
		active.win.runFrames();
		expect(box.style.width).toBe('40%');
	});

	it('视口整个在右下外侧 → 框退到面板内沿，四边都不会被裁', () => {
		active = createHarness();
		mocks.getDrawTransform.mockReturnValue({
			scaleX: 1,
			scaleY: 1,
			translateX: -10_000,
			translateY: -10_000,
		});
		setupMiniMap(active.view);
		active.win.runFrames();

		const box = childOf(panelOf(active), 'mindmap-minimap-view');
		// 4px 外框贴在右/下**内沿**（216/220、106/110）：若仍写 100%，
		// border-box 那 4px 会甩到面板外被 overflow:hidden 裁掉（实机症状）
		expect(box.style.left).toBe('98.2%');
		expect(box.style.top).toBe('96.4%');
		expect(box.style.width).toBe('1.8%');
		expect(box.style.height).toBe('3.6%');
	});

	it('画布太窄（< 320px）→ 不取样、不显示', () => {
		active = createHarness();
		mocks.getCanvasSize.mockReturnValue({ width: 200, height: 600 });
		setupMiniMap(active.view);

		expect(mocks.captureMiniMap).not.toHaveBeenCalled();
		expect(panelOf(active).className).not.toContain('is-visible');
	});

	it('画布尺寸不可得 → 直接停用，且不测全树（省一遍 O(n) 遍历）', () => {
		active = createHarness();
		mocks.getCanvasSize.mockReturnValue(null);
		setupMiniMap(active.view);

		// 尺寸都没拿到时判据必然为 null：先测全树等于白遍历
		expect(mocks.measureMiniMapContent).not.toHaveBeenCalled();
		expect(mocks.contentExceedsCanvasAtFullScale).not.toHaveBeenCalled();
		expect(mocks.captureMiniMap).not.toHaveBeenCalled();
		expect(panelOf(active).className).not.toContain('is-visible');
	});
});

describe('判据失效：停用并清掉面板尺寸', () => {
	it('内容装得下 → 隐藏、摘图、清尺寸与框坐标', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);
		expect(panel.className).toContain('is-visible');

		mocks.contentExceedsCanvasAtFullScale.mockReturnValue(false);
		active.binder.emitEngine('node_tree_render_end');

		expect(panel.className).not.toContain('is-visible');
		expect(panel.style.width).toBeUndefined();
		expect(panel.style.height).toBeUndefined();
		expect(childOf(panel, 'mindmap-minimap-img').src).toBe('');
		expect(childOf(panel, 'mindmap-minimap-view').getAttribute('style')).toBe('');
	});
});

describe('节拍：30s 无操作淡出，动图后回来', () => {
	it('淡出只摘可见类；view_data_change 唤醒后重新出现', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);

		vi.advanceTimersByTime(30_000);
		expect(panel.className).not.toContain('is-visible');

		active.binder.emitEngine('view_data_change');
		expect(panel.className).toContain('is-visible');
	});

	it('淡出后后台重渲染不会把它重新点亮（渲染落地不是用户手势）', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);

		vi.advanceTimersByTime(30_000);
		expect(panel.className).not.toContain('is-visible');

		// 图片回灌 / 字体加载 / 内容重测都会走这条事件，它们不是用户动作
		active.binder.emitEngine('node_tree_render_end');
		expect(panel.className).not.toContain('is-visible');
		// 淡出态也不该白跑取样：判据重判过、取图没发生
		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(1);
	});

	it('窗口尺寸变化算用户手势：淡出后重新亮起并补一帧', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);

		vi.advanceTimersByTime(30_000);
		expect(panel.className).not.toContain('is-visible');

		active.binder.emitEngine('resize');
		expect(panel.className).toContain('is-visible');
		// 间隔已够刷新窗口 ⇒ 顺手换一张新图（不是先露旧图等 30s）
		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(2);
	});
});

describe('刷新入口：样式立即画 / 布局等渲染落地', () => {
	it('refreshMiniMap 立即换图', () => {
		active = createHarness();
		setupMiniMap(active.view);
		mocks.captureMiniMap.mockReturnValue(FRAME_B);

		refreshMiniMap(active.view);

		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(2);
		expect(childOf(panelOf(active), 'mindmap-minimap-img').src).toBe(FRAME_B.image);
	});

	it('refreshMiniMapAfterRender 不在当场取样，等 node_tree_render_end', () => {
		active = createHarness();
		setupMiniMap(active.view);
		mocks.captureMiniMap.mockReturnValue(FRAME_B);

		refreshMiniMapAfterRender(active.view);
		// 只有装配那次：切布局的当口绝不能拿旧几何画上去
		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(1);
		expect(childOf(panelOf(active), 'mindmap-minimap-img').src).toBe(FRAME_A.image);

		active.binder.emitEngine('node_tree_render_end');
		expect(mocks.captureMiniMap).toHaveBeenCalledTimes(2);
		expect(childOf(panelOf(active), 'mindmap-minimap-img').src).toBe(FRAME_B.image);
	});

	it('落地事件仍拿到旧几何（同内容盒）→ 不换图且保留标记，下一轮才换', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const img = childOf(panelOf(active), 'mindmap-minimap-img');
		refreshMiniMapAfterRender(active.view);

		// 同几何、不同图：典型的「渲染落地但位置还没回填」
		mocks.captureMiniMap.mockReturnValue({ ...FRAME_A, image: 'data:,stale' });
		active.binder.emitEngine('node_tree_render_end');
		expect(img.src).toBe(FRAME_A.image);

		mocks.captureMiniMap.mockReturnValue(FRAME_B);
		active.binder.emitEngine('node_tree_render_end');
		expect(img.src).toBe(FRAME_B.image);
	});
});

describe('拖拽导航：换算、帧内更新、松手清理', () => {
	function start(harness: Harness): FakeEl {
		setupMiniMap(harness.view);
		harness.win.runFrames();
		const panel = panelOf(harness);
		harness.binder.emitDom(panel, 'mousedown', {
			button: 0,
			target: panel,
			clientX: 10,
			clientY: 10,
			preventDefault: () => undefined,
		});
		return panel;
	}

	it('面板空白处拖动 → 按「缩放 / 缩略比例」换算平移量', () => {
		active = createHarness();
		const panel = start(active);
		expect(panel.className).toContain('is-dragging');

		active.win.dispatch('mousemove', { clientX: 50, clientY: 10 });

		expect(mocks.panMindMap).toHaveBeenCalledTimes(1);
		const [, dx, dy] = mocks.panMindMap.mock.calls[0] ?? [];
		expect(dx).toBeCloseTo(40 / MINI_SCALE, 6);
		expect(dy).toBeCloseTo(0, 6);
	});

	it('平移后视口框在帧内重投影（不依赖引擎事件）', () => {
		active = createHarness();
		const panel = start(active);
		const box = childOf(panel, 'mindmap-minimap-view');
		expect(box.style.left).toBe('0%');

		mocks.getDrawTransform.mockReturnValue({
			scaleX: 1,
			scaleY: 1,
			translateX: -100,
			translateY: 0,
		});
		active.win.dispatch('mousemove', { clientX: 50, clientY: 10 });
		active.win.runFrames();

		// viewX = 100 → left = 100 × 0.22 = 22px = 10%
		expect(box.style.left).toBe('10%');
	});

	it('松手：摘 is-dragging、窗口监听归零', () => {
		active = createHarness();
		const panel = start(active);
		expect(active.win.listenerCount).toBe(2);

		active.win.dispatch('mouseup', {});

		expect(panel.className).not.toContain('is-dragging');
		expect(active.win.listenerCount).toBe(0);
	});
});

describe('teardownMiniMap：定时器与 DOM 一并回收', () => {
	it('拆掉后不再取样，面板从容器移除', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);
		const drawn = mocks.captureMiniMap.mock.calls.length;

		teardownMiniMap(active.view);

		expect(panel.removed).toBe(true);
		expect(active.container.children).toHaveLength(0);
		vi.advanceTimersByTime(120_000);
		expect(mocks.captureMiniMap.mock.calls.length).toBe(drawn);
	});
});

describe('悬停与滚轮（2026-10-25 两条用户裁决）', () => {
	it('悬停不淡出：指针在面板上越过 30s 也不藏，离开后重新给满一个窗口', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);
		expect(panel.className).toContain('is-visible');

		active.binder.emitDom(panel, 'mouseenter', {});
		vi.advanceTimersByTime(31_000);
		expect(panel.className).toContain('is-visible');

		active.binder.emitDom(panel, 'mouseleave', {});
		vi.advanceTimersByTime(31_000);
		expect(panel.className).not.toContain('is-visible');
	});

	it('停用会复位悬停态：重新启用后照常淡出（隐藏期间收不到 mouseleave）', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);
		active.binder.emitDom(panel, 'mouseenter', {});

		// 判据失效 → 停用（此时面板隐藏，浏览器不会再派发 mouseleave）
		mocks.contentExceedsCanvasAtFullScale.mockReturnValue(false);
		active.binder.emitEngine('node_tree_render_end');
		expect(panel.className).not.toContain('is-visible');

		// 让重判节流窗口过去，再满足条件 → 重新启用
		vi.advanceTimersByTime(1_000);
		mocks.contentExceedsCanvasAtFullScale.mockReturnValue(true);
		active.binder.emitEngine('node_tree_render_end');
		expect(panel.className).toContain('is-visible');

		vi.advanceTimersByTime(31_000);
		expect(panel.className).not.toContain('is-visible');
	});

	it('滚轮转发到画布：delta/修饰键/坐标原样带走，并掐掉自身默认行为', () => {
		active = createHarness();
		setupMiniMap(active.view);
		const panel = panelOf(active);
		const preventDefault = vi.fn();
		const stopPropagation = vi.fn();
		active.binder.emitDom(panel, 'wheel', {
			deltaY: -120,
			deltaX: 0,
			deltaMode: 0,
			ctrlKey: true,
			shiftKey: false,
			altKey: false,
			metaKey: false,
			clientX: 40,
			clientY: 60,
			preventDefault,
			stopPropagation,
		});

		const canvas = active.view.canvasEl as unknown as FakeEl;
		expect(canvas.dispatched).toHaveLength(1);
		expect(canvas.dispatched[0]?.type).toBe('wheel');
		const forwarded = canvas.dispatched[0]?.event ?? {};
		expect(forwarded.deltaY).toBe(-120);
		expect(forwarded.ctrlKey).toBe(true);
		expect(forwarded.clientX).toBe(40);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('面板未显示时滚轮不转发（此时 pointer-events:none，事件本不该到达）', () => {
		active = createHarness();
		mocks.contentExceedsCanvasAtFullScale.mockReturnValue(false);
		setupMiniMap(active.view);
		const panel = panelOf(active);
		expect(panel.className).not.toContain('is-visible');

		active.binder.emitDom(panel, 'wheel', {
			deltaY: -120,
			clientX: 0,
			clientY: 0,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		});
		const canvas = active.view.canvasEl as unknown as FakeEl;
		expect(canvas.dispatched).toHaveLength(0);
	});
});
