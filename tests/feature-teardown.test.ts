/**
 * 交互会话收尾回归：拖拽换父（drag-target）与图片调宽（image-resize）在会话
 * 期间**动态注册临时 window 监听**（mousemove/mouseup），松手即移除——这类监听
 * 不经 EventBinder 记录（拖拽/调宽中途关闭视图收不到 mouseup），必须由视图
 * onClose 经 teardown* 显式收尾，否则监听泄漏且继续作用于已销毁视图。
 *
 * 断言策略：window 桩维护「净挂载表」（add/remove 按 type + capture + 函数身份
 * 抵销）。因此
 * - 只比对 add/remove 调用次数不够——若移除时 capture 标志与注册不一致，
 *   removeEventListener 实际无效（图片调宽就是捕获阶段注册的），净挂载表
 *   仍非空即会失败；
 * - 「会话结束后监听数为 0」由净挂载表直接断言，而不是靠推断。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import { ENGINE_COMMANDS } from '../src/engine/mindmap';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	setupDragTargetAssist,
	teardownDragTargetAssist,
} from '../src/features/drag-target';
import {
	setupImageResize,
	teardownImageResize,
} from '../src/features/image-resize';

// 两模块经 import 链加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

interface ListenerCall {
	type: string;
	listener: unknown;
	capture: boolean | undefined;
}

/** window 桩：记录注册/移除，并维护「仍挂在 window 上」的净集合 */
function makeWindowStub() {
	const added: ListenerCall[] = [];
	const removed: ListenerCall[] = [];
	/** key = `type|capture` → 监听函数集（capture 不匹配则 remove 清不掉） */
	const active = new Map<string, Set<unknown>>();
	const frames: FrameRequestCallback[] = [];
	const keyOf = (type: string, capture: boolean | undefined): string =>
		`${type}|${capture === true ? 'capture' : 'bubble'}`;
	const win = {
		addEventListener(type: string, listener: unknown, capture?: boolean): void {
			added.push({ type, listener, capture });
			const set = active.get(keyOf(type, capture)) ?? new Set<unknown>();
			set.add(listener);
			active.set(keyOf(type, capture), set);
		},
		removeEventListener(type: string, listener: unknown, capture?: boolean): void {
			removed.push({ type, listener, capture });
			active.get(keyOf(type, capture))?.delete(listener);
		},
		requestAnimationFrame(callback: FrameRequestCallback): number {
			frames.push(callback);
			return frames.length;
		},
		cancelAnimationFrame: vi.fn<(handle: number) => void>(),
	};
	return {
		win,
		added,
		removed,
		frames,
		addedTypes: (): string[] => added.map((call) => call.type),
		removedTypes: (): string[] => removed.map((call) => call.type),
		/** 仍挂在 window 上（未被成对移除）的监听数量 */
		listenerCount: (): number =>
			[...active.values()].reduce((total, set) => total + set.size, 0),
		/** 取注册过的监听函数（capture 区分冒泡/捕获两条链） */
		listenerOf(type: string, capture?: boolean): ((event: unknown) => void) | null {
			const call = added.find(
				(entry) => entry.type === type && entry.capture === capture,
			);
			return call ? (call.listener as (event: unknown) => void) : null;
		},
		/** 手动执行某次 rAF 回调（模拟渲染帧到达） */
		runFrame(index = 0): void {
			frames[index]?.(0);
		},
	};
}
type WindowStub = ReturnType<typeof makeWindowStub>;

/** 记录 onEngine 注册的引擎监听，供测试按事件名触发 */
function makeEngineBinder() {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	return {
		listeners,
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
		events: (): string[] => [...listeners.keys()],
	};
}
type EngineBinderStub = ReturnType<typeof makeEngineBinder>;

/** 非根节点桩：collectExcludeUids（getData/children）与 isRootNode 所需最小面 */
function fakeNode(uid = '', children: MindMapNode[] = []): MindMapNode {
	return {
		isRoot: false,
		getData: (key: string) => (key === 'uid' ? uid : undefined),
		children,
	} as unknown as MindMapNode;
}

/** 视图桩：会话窗口经 containerEl.win 注入（popout 窗口语义） */
function makeView(binder: EngineBinderStub, win: unknown, mindMap = {} as MindMap) {
	const scheduleSave = vi.fn<() => void>();
	const view = {
		mindMap,
		engineEvents: binder,
		lang: 'zh',
		canvasEl: null,
		containerEl: { win },
		scheduleSave,
	} as unknown as MindMapViewContext;
	return { view, scheduleSave };
}

describe('drag-target 会话收尾（拖拽中途关闭视图）', () => {
	let mainWindow: WindowStub;
	let canvasWindow: WindowStub;

	beforeEach(() => {
		mainWindow = makeWindowStub();
		canvasWindow = makeWindowStub();
		// 主窗口也桩掉：用于证明会话监听没有落到主窗口（popout 兼容）
		vi.stubGlobal('window', mainWindow.win);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('会话进行中收尾：临时 window 监听成对移除且净挂载归零', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);
		expect(binder.events()).toEqual(['node_dragging', 'node_dragend']);

		// 引擎首次拖拽移动 → 建立会话并挂临时监听
		binder.fire('node_dragging', fakeNode('u1'));
		expect(canvasWindow.addedTypes()).toEqual(['mousemove', 'mouseup']);
		expect(canvasWindow.listenerCount()).toBe(2);
		// 主窗口收不到任何监听（popout 窗口里鼠标事件不落在主窗口）
		expect(mainWindow.addedTypes()).toEqual([]);

		// 视图在拖拽中被关闭：收不到 mouseup / node_dragend，必须显式收尾
		teardownDragTargetAssist(view);
		expect(canvasWindow.removedTypes()).toEqual(['mousemove', 'mouseup']);
		// 移除的必须是注册时的同一函数引用、同一 capture 标志（否则移除无效）
		expect(canvasWindow.removed.map((call) => call.listener)).toEqual(
			canvasWindow.added.map((call) => call.listener),
		);
		expect(canvasWindow.removed.map((call) => call.capture)).toEqual([
			undefined,
			undefined,
		]);
		expect(canvasWindow.listenerCount()).toBe(0);
	});

	it('mouseup / node_dragend 各自收尾：无需视图关闭即监听归零', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);

		// 松手（window 层）
		binder.fire('node_dragging', fakeNode('u1'));
		const up = canvasWindow.listenerOf('mouseup');
		expect(up).not.toBeNull();
		up?.({});
		expect(canvasWindow.listenerCount()).toBe(0);

		// 引擎在消费落点后发出 node_dragend
		binder.fire('node_dragging', fakeNode('u1'));
		expect(canvasWindow.listenerCount()).toBe(2);
		binder.fire('node_dragend');
		expect(canvasWindow.listenerCount()).toBe(0);
		expect(canvasWindow.removedTypes()).toEqual([
			'mousemove',
			'mouseup',
			'mousemove',
			'mouseup',
		]);
	});

	it('重复收尾幂等：无会话时不再移除任何监听、不抛异常', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);

		// 从未建立会话
		expect(() => teardownDragTargetAssist(view)).not.toThrow();
		expect(canvasWindow.removed).toHaveLength(0);

		binder.fire('node_dragging', fakeNode('u1'));
		teardownDragTargetAssist(view);
		expect(canvasWindow.removed).toHaveLength(2);
		// 第二次收尾：会话已清空，不重复移除
		teardownDragTargetAssist(view);
		expect(canvasWindow.removed).toHaveLength(2);
	});

	it('收尾后会话状态已清空：新拖拽可重新建立会话（无残留守卫阻塞）', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);

		binder.fire('node_dragging', fakeNode('u1'));
		// 同一会话内重复事件不重复挂监听
		binder.fire('node_dragging', fakeNode('u1'));
		expect(canvasWindow.added).toHaveLength(2);

		teardownDragTargetAssist(view);
		binder.fire('node_dragging', fakeNode('u1'));
		expect(canvasWindow.added).toHaveLength(4);
		expect(canvasWindow.listenerCount()).toBe(2);
	});

	it('根节点拖拽不建立会话（中心主题不可换父，零监听零开销）', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);

		binder.fire('node_dragging', { isRoot: true });
		// 引擎未给出节点（事件参数缺失）
		binder.fire('node_dragging');
		expect(canvasWindow.added).toHaveLength(0);
	});

	it('收尾取消未决的合帧回调；陈旧帧回调不再对已销毁会话求值', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);
		binder.fire('node_dragging', fakeNode('u1'));

		const move = canvasWindow.listenerOf('mousemove');
		move?.({ clientX: 10, clientY: 10 });
		move?.({ clientX: 20, clientY: 20 });
		// rAF 合帧：一帧内多次 mousemove 只排一次判定（大图按帧计价）
		expect(canvasWindow.frames).toHaveLength(1);

		teardownDragTargetAssist(view);
		expect(canvasWindow.win.cancelAnimationFrame).toHaveBeenCalledWith(1);
		// 视图已销毁：陈旧帧回调即使到达也不再判定（会话身份校验），且不抛异常
		expect(() => canvasWindow.runFrame(0)).not.toThrow();
		expect(canvasWindow.listenerCount()).toBe(0);
	});

	it('引擎重建（再次 setup）先收尾旧会话：旧监听不残留到新引擎实例', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		setupDragTargetAssist(view);
		binder.fire('node_dragging', fakeNode('u1'));
		expect(canvasWindow.listenerCount()).toBe(2);

		// 引擎重建可能发生在拖拽会话进行中
		setupDragTargetAssist(view);
		expect(canvasWindow.listenerCount()).toBe(0);
	});

	it('会话中借到落点并高亮 → 收尾清高亮、撤监听', () => {
		// 引擎桩：拖拽三态 + 渲染树（根 + 一个目标节点）+ 画布变换
		const classList = { add: vi.fn(), remove: vi.fn() };
		const target = {
			isRoot: false,
			getData: (key: string) => (key === 'uid' ? 'u9' : undefined),
			children: [],
			left: 300,
			top: 100,
			width: 80,
			height: 40,
			group: { node: { classList } },
		} as unknown as MindMapNode;
		const root = {
			isRoot: true,
			getData: () => undefined,
			children: [target],
			left: 0,
			top: 0,
			width: 100,
			height: 40,
		} as unknown as MindMapNode;
		const drag = {
			overlapNode: null as MindMapNode | null,
			prevNode: null as MindMapNode | null,
			nextNode: null as MindMapNode | null,
		};
		const mindMap = {
			drag,
			renderer: { root },
			view: {
				getTransformData: () => ({
					transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
				}),
			},
			toPos: (x: number, y: number) => ({ x, y }),
		} as unknown as MindMap;

		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win, mindMap);
		setupDragTargetAssist(view);

		binder.fire('node_dragging', fakeNode('u1'));
		// 指针压到目标节点中心 (340, 120)：外借 overlapNode（挂为该节点子级）
		canvasWindow.listenerOf('mousemove')?.({ clientX: 340, clientY: 120 });
		canvasWindow.runFrame(0);
		expect(drag.overlapNode).toBe(target);
		expect(classList.add).toHaveBeenCalledWith('mindmap-drag-target');

		teardownDragTargetAssist(view);
		// 会话收尾必须撤掉高亮（类名留在 DOM 上会让节点永久显示为落点）
		expect(classList.remove).toHaveBeenCalledWith('mindmap-drag-target');
		expect(canvasWindow.listenerCount()).toBe(0);
	});
});

/** SVG <image> 桩：currentNodeImageEl 用 instanceof SVGImageElement 判定真伪 */
class FakeSvgImageElement {
	constructor(private readonly box: { width: number; height: number }) {}
	getBoundingClientRect(): {
		left: number;
		top: number;
		right: number;
		bottom: number;
		width: number;
		height: number;
	} {
		return {
			left: 0,
			top: 0,
			right: this.box.width,
			bottom: this.box.height,
			width: this.box.width,
			height: this.box.height,
		};
	}
}

describe('image-resize 会话收尾（调宽中途关闭视图）', () => {
	let mainWindow: WindowStub;
	let canvasWindow: WindowStub;

	beforeEach(() => {
		mainWindow = makeWindowStub();
		canvasWindow = makeWindowStub();
		vi.stubGlobal('window', mainWindow.win);
		// Node 环境没有 SVGImageElement 全局：补齐后才能构造「真图片元素」
		vi.stubGlobal('SVGImageElement', FakeSvgImageElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	/**
	 * 调宽视图桩：画布容器 + 手柄 + 图片节点 + 引擎桩。
	 * @param imageSize 图片当前渲染尺寸（startSession 以它换算起点宽高）
	 * @param scale 画布缩放（屏幕 px → content px）
	 */
	function makeResizeView(imageSize = { width: 200, height: 100 }, scale = 1) {
		const imageEl = new FakeSvgImageElement(imageSize);
		const handlers = new Map<string, (event: unknown) => void>();
		const handleEl = {
			addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
				handlers.set(type, listener);
			}),
			remove: vi.fn<() => void>(),
			classList: { add: vi.fn<(name: string) => void>(), remove: vi.fn<(name: string) => void>() },
			style: {} as CSSStyleDeclaration,
		};
		const canvasRect = vi.fn(() => ({
			left: 0,
			top: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
		}));
		const canvasEl = {
			createDiv: (_cls?: string) => handleEl,
			// 画布矩形读取次数是本文件一条断言的观测面（帧内不得再读）
			getBoundingClientRect: canvasRect,
		};
		/** 节点 data：调宽提交会就地清 `mdImageAutoSize`（加载期自动校正标记） */
		const data: Record<string, unknown> = {};
		const node = {
			isRoot: false,
			getData: () => data,
			children: [],
			group: {
				node: { querySelector: (selector: string) => (selector === 'image' ? imageEl : null) },
			},
		} as unknown as MindMapNode;
		const execCommand = vi.fn<(...args: unknown[]) => void>();
		const render = vi.fn<() => void>();
		const mindMap = {
			execCommand,
			render,
			view: {
				getTransformData: () => ({
					transform: { scaleX: scale, scaleY: scale, translateX: 0, translateY: 0 },
				}),
			},
		} as unknown as MindMap;

		const binder = makeEngineBinder();
		const scheduleSave = vi.fn<() => void>();
		const view = {
			mindMap,
			engineEvents: binder,
			lang: 'zh',
			canvasEl: canvasEl as unknown as HTMLElement,
			containerEl: { win: canvasWindow.win },
			scheduleSave,
		} as unknown as MindMapViewContext;

		return {
			view,
			scheduleSave,
			binder,
			handleEl,
			canvasEl,
			canvasRect,
			imageEl,
			node,
			data,
			execCommand,
			render,
			/** 引擎图片 hover → 显示手柄（hoverNode 就位，为 mousedown 建立会话铺路） */
			hoverImage(): void {
				binder.fire('node_img_mouseenter', node, { node: imageEl }, {});
			},
			/** 按下手柄 → 建立调宽会话 */
			pressHandle(clientX: number): void {
				handlers.get('mousedown')?.({
					preventDefault: vi.fn(),
					stopPropagation: vi.fn(),
					clientX,
				});
			},
		};
	}

	it('会话进行中收尾：捕获阶段监听成对移除（含 capture 标志）且净挂载归零', () => {
		const harness = makeResizeView();
		setupImageResize(harness.view);
		expect(harness.binder.events()).toEqual([
			'node_img_mouseenter',
			'node_img_mouseleave',
			'node_dragging',
		]);

		harness.hoverImage();
		expect(harness.handleEl.classList.add).toHaveBeenCalledWith('is-visible');
		harness.pressHandle(500);
		// 调宽监听在捕获阶段注册（配合 stopPropagation 形成手势独占）
		expect(canvasWindow.added.map((call) => [call.type, call.capture])).toEqual([
			['mousemove', true],
			['mouseup', true],
		]);
		expect(canvasWindow.listenerCount()).toBe(2);
		expect(mainWindow.addedTypes()).toEqual([]);

		teardownImageResize(harness.view);
		// 移除必须带同款 capture 标志：否则净挂载表仍非空（removeEventListener 无效）
		expect(canvasWindow.removed.map((call) => [call.type, call.capture])).toEqual([
			['mousemove', true],
			['mouseup', true],
		]);
		expect(canvasWindow.removed.map((call) => call.listener)).toEqual(
			canvasWindow.added.map((call) => call.listener),
		);
		expect(canvasWindow.listenerCount()).toBe(0);
		// 手柄 DOM 随之移除，且会话中已应用的尺寸仍被调度保存（改动不丢）
		expect(harness.handleEl.remove).toHaveBeenCalledTimes(1);
		expect(harness.scheduleSave).toHaveBeenCalledTimes(1);
		expect(harness.handleEl.classList.remove).toHaveBeenCalledWith('is-visible');
	});

	it('mouseup 收尾：监听归零、调度保存、手柄隐藏', () => {
		const harness = makeResizeView();
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		const up = canvasWindow.listenerOf('mouseup', true);
		expect(up).not.toBeNull();
		up?.({});

		expect(canvasWindow.listenerCount()).toBe(0);
		expect(harness.scheduleSave).toHaveBeenCalledTimes(1);
		expect(harness.handleEl.classList.remove).toHaveBeenCalledWith('is-visible');
	});

	it('帧内只做「预览」写入（不 execCommand），收尾走一次命令（一条历史 + 一次保存调度）', () => {
		// 用户实测缺陷（2026-09-16）：「图片拖动大小时保存好几次 + 卡顿」。
		// 根因：引擎 Command.exec 对非白名单命令一律 addHistory()（整树 getCopyData +
		// JSON.stringify 比对）并 emit('data_change') ⇒ 视图层 scheduleSave / 状态栏 /
		// 标题重算全被逐帧触发。现帧内走 previewNodeImageSize（同款数据写入，不上
		// 历史），只有收尾那一次走命令。
		const harness = makeResizeView({ width: 200, height: 100 });
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		// 拖 40 content px（缩放 1）：建立一帧
		canvasWindow.listenerOf('mousemove', true)?.({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			clientX: 540,
		});
		canvasWindow.runFrame();

		// 帧内：数据已更新、画面已重绘，但**没有命令**（= 不上历史、不触发保存调度）
		expect(harness.data.imageSize).toEqual({
			width: 240,
			height: 120,
			custom: true,
		});
		expect(harness.render).toHaveBeenCalled();
		expect(harness.execCommand).not.toHaveBeenCalled();

		// 收尾：一次命令把整次调宽记为一条历史（一次 Ctrl+Z 撤回整次），并调度一次保存
		canvasWindow.listenerOf('mouseup', true)?.({});
		expect(harness.execCommand).toHaveBeenCalledTimes(1);
		expect(harness.execCommand.mock.calls[0]).toEqual([
			'SET_NODE_DATA',
			harness.node,
			{ imageSize: { width: 240, height: 120, custom: true } },
		]);
		expect(harness.scheduleSave).toHaveBeenCalledTimes(1);
	});

	it('收尾时最终尺寸与最后一帧预览值相同：仍要走一次命令（否则整次调宽进不了历史）', () => {
		const harness = makeResizeView({ width: 200, height: 100 });
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		canvasWindow.listenerOf('mousemove', true)?.({
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			clientX: 540,
		});
		canvasWindow.runFrame();
		expect(harness.execCommand, '前置：帧内未走命令').not.toHaveBeenCalled();

		// 松手时 applied === latest（最后一帧就是最终值）——判据是「与起始尺寸有净变化」，
		// 不是「与最后一帧相同」，否则一次调宽完全不留历史
		canvasWindow.listenerOf('mouseup', true)?.({});
		expect(harness.execCommand).toHaveBeenCalledTimes(1);
	});

	it('拖回原尺寸（净变化为 0）：收尾不提交（不产生空历史）', () => {
		const harness = makeResizeView({ width: 200, height: 100 });
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		// 拖出去再拖回来：最终尺寸 = 起始尺寸
		for (const clientX of [560, 500]) {
			canvasWindow.listenerOf('mousemove', true)?.({
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				clientX,
			});
			canvasWindow.runFrame();
		}
		canvasWindow.listenerOf('mouseup', true)?.({});

		expect(harness.execCommand).not.toHaveBeenCalled();
		expect(harness.scheduleSave).toHaveBeenCalledTimes(1);
	});

	it('画布矩形每会话只读一次：帧内手柄定位不再触发额外强制布局', () => {
		const harness = makeResizeView({ width: 200, height: 100 });
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);
		// 会话建立后（hover 的首次定位 1 次 + startSession 快照 1 次）不再读画布矩形
		const afterStart = harness.canvasRect.mock.calls.length;

		for (const clientX of [540, 580]) {
			canvasWindow.listenerOf('mousemove', true)?.({
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				clientX,
			});
			canvasWindow.runFrame();
		}

		expect(
			harness.canvasRect.mock.calls.length,
			'帧内读画布矩形 = 每帧一次强制布局',
		).toBe(afterStart);
		// 手柄确实被定位过（不是「因为不读矩形所以什么都没做」）
		expect(harness.handleEl.style.left).toBeTruthy();
		expect(harness.handleEl.style.top).toBeTruthy();
	});

	it('重复收尾幂等：无会话时不重复移除手柄、不触发保存', () => {
		const harness = makeResizeView();
		setupImageResize(harness.view);

		teardownImageResize(harness.view);
		expect(harness.handleEl.remove).toHaveBeenCalledTimes(1);
		expect(harness.scheduleSave).not.toHaveBeenCalled();
		// 第二次收尾：手柄引用已置空
		teardownImageResize(harness.view);
		expect(harness.handleEl.remove).toHaveBeenCalledTimes(1);
	});

	it('会话结束后再收尾：监听不重复移除', () => {
		const harness = makeResizeView();
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		canvasWindow.listenerOf('mouseup', true)?.({});
		expect(canvasWindow.removed).toHaveLength(2);
		teardownImageResize(harness.view);
		expect(canvasWindow.removed).toHaveLength(2);
		expect(canvasWindow.listenerCount()).toBe(0);
	});

	it('会话中图片 mouseleave 不隐藏手柄（避免显隐闪烁），收尾才隐藏', () => {
		const harness = makeResizeView();
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		// 指针在图片与手柄之间移动：图片发出 mouseleave（relatedTarget 为空）
		harness.binder.fire('node_img_mouseleave', harness.node, { node: harness.imageEl }, {});
		expect(harness.handleEl.classList.remove).not.toHaveBeenCalled();

		teardownImageResize(harness.view);
		expect(harness.handleEl.classList.remove).toHaveBeenCalledWith('is-visible');
	});

	it('会话中拖动：阻断传播（手势独占）+ rAF 合帧后按缩放写入引擎尺寸', () => {
		const harness = makeResizeView({ width: 200, height: 100 }, 1);
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		const move = canvasWindow.listenerOf('mousemove', true);
		const stopPropagation = vi.fn<() => void>();
		const event = {
			clientX: 600,
			clientY: 0,
			stopPropagation,
		} as unknown as MouseEvent;
		move?.(event);
		move?.(event);
		move?.(event);
		// 引擎容器级 mousemove 收不到事件（调宽不被节点拖拽逻辑串扰）
		expect(stopPropagation).toHaveBeenCalledTimes(3);
		// 三次移动只排一次帧判定
		expect(canvasWindow.frames).toHaveLength(1);

		canvasWindow.runFrame(0);
		// 起点 200×100、右拖 100（scale 1）→ 300×150：帧内**只做预览写入**
		// （数据落上 + 重绘），**不走命令**——命令一律 addHistory + data_change，
		// 逐帧走等于每步一条历史 + 每步一次自动保存调度（保存好几次 + 卡顿）
		expect(harness.data.imageSize).toEqual({
			width: 300,
			height: 150,
			custom: true,
		});
		expect(harness.render).toHaveBeenCalled();
		expect(harness.execCommand).not.toHaveBeenCalled();
	});

	it('拖动中的写入按步长合并：小位移不写引擎，松手补写最终尺寸', () => {
		const harness = makeResizeView({ width: 200, height: 100 }, 1);
		// 加载期自动校正留下的标记：用户拖过即为用户意图，提交时必须清除
		harness.data.mdImageAutoSize = true;
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);
		const move = canvasWindow.listenerOf('mousemove', true);
		const fire = (clientX: number): void => {
			move?.({ clientX, stopPropagation: vi.fn() });
		};

		// 首次移动立即写入（拖动无死区）：起点 200×100，+2px → 202×101
		fire(502);
		canvasWindow.runFrame(0);
		expect(harness.data.imageSize).toEqual({
			width: 202,
			height: 101,
			custom: true,
		});
		expect(
			harness.data.mdImageAutoSize,
			'拖拽提交即用户意图：自动校正标记被清除（否则尺寸不会回写文件）',
		).toBeUndefined();
		expect(harness.execCommand, '帧内不上历史').not.toHaveBeenCalled();

		// 距上次写入仅 6px（不足最小步长 8px）→ 连数据都不写（每次写入都是整树重排）
		fire(508);
		canvasWindow.runFrame(1);
		expect(harness.data.imageSize).toEqual({
			width: 202,
			height: 101,
			custom: true,
		});

		// 距上次写入 10px → 写入 212×106
		fire(512);
		canvasWindow.runFrame(2);
		expect(harness.data.imageSize).toEqual({
			width: 212,
			height: 106,
			custom: true,
		});

		// 松手：最终 214×107 距上次写入仅 2px（帧回调里被跳过）→ 收尾必须补写，
		// 否则图片会回弹到上一个写入值 212×106；且整次调宽只记**一条**历史
		fire(514);
		canvasWindow.runFrame(3);
		expect(harness.data.imageSize).toEqual({
			width: 212,
			height: 106,
			custom: true,
		});
		canvasWindow.listenerOf('mouseup', true)?.({});
		expect(harness.execCommand).toHaveBeenCalledExactlyOnceWith(
			ENGINE_COMMANDS.SET_NODE_DATA,
			harness.node,
			{ imageSize: { width: 214, height: 107, custom: true } },
		);
	});

	it('画布缩放 2x：渲染尺寸与拖动位移都按缩放折回 content px', () => {
		const harness = makeResizeView({ width: 200, height: 100 }, 2);
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);

		canvasWindow.listenerOf('mousemove', true)?.({
			clientX: 600,
			clientY: 0,
			stopPropagation: vi.fn(),
		});
		canvasWindow.runFrame(0);
		// 2x 下渲染 200×100 屏幕 px ⇒ content 起点 100×50；右拖 100 屏幕 px = 50 content px
		// ⇒ 150×75（若漏了 scale 折算会写成 250×125）
		expect(harness.data.imageSize).toEqual({
			width: 150,
			height: 75,
			custom: true,
		});
	});

	it('引擎重建（再次 setup）先收尾旧会话并移除旧手柄', () => {
		const harness = makeResizeView();
		setupImageResize(harness.view);
		harness.hoverImage();
		harness.pressHandle(500);
		expect(canvasWindow.listenerCount()).toBe(2);

		setupImageResize(harness.view);
		expect(canvasWindow.listenerCount()).toBe(0);
		expect(harness.handleEl.remove).toHaveBeenCalledTimes(1);
	});

	it('未装配手柄/画布（视图未初始化）时收尾安全，不抛异常', () => {
		const binder = makeEngineBinder();
		const { view } = makeView(binder, canvasWindow.win);
		expect(() => teardownImageResize(view)).not.toThrow();
		expect(canvasWindow.listenerCount()).toBe(0);
	});
});
