/**
 * 画布视口手势：与 Obsidian **Canvas** 的导航约定对齐（官方帮助
 * `en/Plugins/Canvas.md`「Navigate the canvas」）。
 *
 * **滚轮与中键拖由引擎负责**——插件不再自建一份（vendor `simple-mind-map.cjs`
 * 实测，两处重复实现都会打架）：
 * - `wheel`：引擎监听在 `mindMap.el` 上（`onMousewheel`），处理前先
 *   `stopPropagation()` → 容器级再挂 wheel 监听**根本收不到事件**（此前那版即死代码）；
 *   而引擎本就实现了官方语义：`Ctrl/Cmd + 滚轮` = 以指针为锚缩放（`:231`），否则按
 *   `mousewheelAction: 'move'` 平移（`:227`；触控板横滑的 deltaX 也在那里处理）；
 * - 中键拖拽（`:226`）：引擎 event 模块在 mousedown 置 `isMiddleMousedown` →
 *   `drag` → View 平移，监听挂在 `window` 上——拖出画布仍跟手。插件若另按 pointer
 *   事件平移，会与引擎的**绝对定位**平移互相覆盖（`pointerleave` 还会让手势半途断掉）。
 *
 * 故本模块只补引擎没有的四件事：
 * 1. 抑制浏览器**原生中键自动滚动**（滚动圆盘）：引擎 `mousedownEventPreventDefault`
 *    默认 false，不对中键 `preventDefault`。插件在**画布自身**再挂一条 mousedown
 *    （注册晚于引擎 ⇒ 排在引擎之后执行），只拦浏览器默认行为，不碰引擎已置的中键状态；
 * 2. `Shift+1` 缩放到全览 / `Shift+2` 缩放到选区（`:235 / :239`，键注册在
 *    `view-hotkeys`，实现为本文件的 `fitToScreen` / `zoomToSelection`）；
 * 3. **`Alt + 滚轮` 横向平移**（2026-10-26 用户裁决：上滚 = 视野左移 / 画面右移，
 *    下滚反之）——引擎不读 `altKey`，不接管就会照常纵向走；
 * 4. **滚轮平移的平滑化**（2026-10-26 用户裁决「滚轮移动太生硬」）：引擎对鼠标
 *    一格是「固定 100px、当帧到位、零过渡」的瞬移（`View.js` 的 `translateXY`），
 *    这里把**鼠标格**（`|deltaY| ≥ 50`）的位移累积到目标值，用逐帧指数趋近
 *    （τ≈45ms）分多帧走完；触控板/高精度滚轮的小 delta 仍原样交引擎逐事件跟手，
 *    避免给已经连续的输入再叠一层延迟。
 *
 * ## 为什么 Alt 横轴必须挂**画布祖先**的 capture
 * 引擎的 wheel 监听就在 `mindMap.el`（= 本视图的 `canvasEl`）**自身**上，且处理前先
 * `stopPropagation()`：
 * - 冒泡阶段的容器监听**根本收不到**（此前的纵向滚轮实现即死代码）；
 * - 同元素（`canvasEl`）上的 capture 也不可靠——target 阶段按**注册顺序**执行，
 *   引擎的监听先注册，会先平移一次纵向。
 * 故监听挂在 `canvas.parentElement`（视图 `containerEl`）的 capture 阶段，命中即
 * `preventDefault + stopPropagation`（页面不滚、引擎不纵向走），再经防腐入口
 * `panMindMap` **只改 x**。指针不在画布内（工具栏 / 搜索栏 / 小地图面板本体）不接管；
 * 小地图的 wheel 会转发到画布（D37），转发事件的目标即画布，故那里也生效。
 *
 * ## 刻意让位
 * - `Ctrl/Cmd + Alt + 滚轮`：缩放优先（引擎语义），Alt 不抢；
 * - **编辑中**（引擎编辑框 ∨ 插件内联编辑器）不接管：引擎的 wheel 会让编辑框
 *   `hideEditTextBox`、内联编辑器在其 `mousewheel` 事件上提交，之后才平移——输入
 *   必须先落数据；那一格因此是引擎的纵向平移（编辑已结束，仅此一次）；
 * - 只读嵌入（```mindmap 代码块）**不装配本模块**：那里的滚轮归宿主页面。
 *
 * 两条**刻意不做**的官方手势（非遗漏）：
 * - `Space + 拖拽` 平移：本视图的画布拖拽**本身即平移**（引擎 View 的
 *   mousedown+drag），按住 Space 与否行为一致，无需重复实现；
 * - `Space + 拖拽` 关闭吸附：本视图无网格吸附。
 *
 * 所有引擎内部操作经 `engine/mindmap` 的具名函数（防腐收口），本模块只做
 * 「选区 → 视口」的换算。
 */
import { Notice } from 'obsidian';
import { tf } from '../core/i18n';
import {
	countMindMapNodes,
	fitMindMap,
	getActiveNodes,
	getDrawTransform,
	getNodeGroupEl,
	panMindMap,
	zoomMindMapAt,
} from '../engine/mindmap';
import { isAnyNodeEditing } from './node-inline-editor';
import type { MindMapViewContext } from './view-context';

/**
 * 视口手势所需的视图面（引擎实例 + 事件绑定器 + 画布元素 + 语言）。
 * 刻意取 `MindMapViewContext` 的**子集**：快捷键宿主等窄接口也能直接传入。
 * `lang` 仅为大图 fit 的一次性提示（见 `fitToScreen`）。
 */
export type ViewportContext = Pick<
	MindMapViewContext,
	'mindMap' | 'engineEvents' | 'canvasEl' | 'lang'
>;

/** 缩放到选区时留出的边距比例（0.88 ≈ 四周各留 6% 画布） */
const SELECTION_FIT_PADDING = 0.88;

/**
 * 鼠标滚轮**一格**的行程（屏幕像素）＝引擎 `mousewheelMoveStep: 100`。
 *
 * 纵横向共用同一档：纵向一格就平移这么多（平滑只改时长、不改总行程），横向取
 * `min(|deltaY|, 本值)` ⇒「鼠标一格恒一档，触控板按实际幅度跟手」。两处若各写
 * 一个数，改引擎默认值时会只改到一半。
 */
const WHEEL_NOTCH_STEP_PX = 100;

/**
 * `Alt + 滚轮` 的纵向滚动量 → 横向位移（屏幕像素；**正 = 内容右移 / 视野左移**）。
 *
 * - 方向：上滚（`deltaY < 0`）为正——与「上滚 = 往上看」同构 ⇒「上滚 = 往左看」
 *   （2026-10-26 用户裁决）；
 * - 幅度：`min(|deltaY|, WHEEL_NOTCH_STEP_PX)`。鼠标一格（100/120）恒为一档；
 *   触控板的小 delta 按实际像素跟手，**不另做「是否触控板」判定**（引擎
 *   `customCheckIsTouchPad` 是私有启发式，插件不复刻——见 AGENTS「不造第二份判定」）。
 * - 2026-10-26 起与纵向鼠标格共用 rAF 指数平滑（K144）：总行程不变，到达时间
 *   被拉到 ~100ms 级；`Alt` 小 delta 也因此不再逐事件瞬移。
 */
export function altWheelPanDelta(deltaY: number): number {
	if (!Number.isFinite(deltaY) || deltaY === 0) {
		return 0;
	}
	const magnitude = Math.min(Math.abs(deltaY), WHEEL_NOTCH_STEP_PX);
	return deltaY < 0 ? magnitude : -magnitude;
}

/**
 * 小于该 `|deltaY|` 的滚动视为**连续输入**（触控板 / 高精度滚轮）——原样交引擎，
 * 它本来就按事件 delta 跟手；只有鼠标格（100/120）才进平滑通道。
 *
 * 50 的取法：鼠标一格最小 100（Chromium/Electron 实测），触控板单事件通常 < 30；
 * 不用引擎私有的 `customCheckIsTouchPad`（deltaY < 10 的启发式），那会把「慢速
 * 鼠标滚轮」误判成触控板（口径见 K144；K138 同款「不另做触控板判定」）。
 */
const WHEEL_SMOOTH_MIN_DELTA = 50;

/** 指数趋近的时间常数（ms）：约 3τ（135ms）走完 95% */
const WHEEL_SMOOTH_TAU_MS = 45;

/** 单帧最大位移（px）：滚轮狂滚时目标会累积很大，限幅避免「一帧几百像素」的突变 */
const WHEEL_SMOOTH_MAX_STEP = 120;

/** 目标剩余量小于此值就一次补完（px） */
const WHEEL_SMOOTH_EPSILON = 0.5;

/**
 * 「走不动」的容忍帧数：连续这么多帧 `panMindMap` 都没改变平移量，判定已到画布
 * 边界（引擎 `limitMindMapInCanvas` 夹住），丢弃剩余目标——否则会空转到目标耗尽。
 */
const WHEEL_SMOOTH_STALL_LIMIT = 2;

/** 一次平滑会话（每个视图一份；换引擎/换窗口即整体重建） */
interface SmoothPanState {
	/** 待走的横向位移（屏幕像素；正 x = 内容右移） */
	x: number;
	/** 待走的纵向位移（屏幕像素；正 y = 内容下移，与「上滚 = 往上看」同向） */
	y: number;
	frame: number | null;
	win: Window;
	mindMap: NonNullable<ViewportContext['mindMap']>;
	lastTs: number;
	stalled: number;
}

const smoothPans = new WeakMap<ViewportContext, SmoothPanState>();

/** 注册画布视口手势（引擎重建时随初始化调用）。 */
export function setupViewportGestures(view: ViewportContext): void {
	const canvas = view.canvasEl;
	if (!canvas) {
		return;
	}
	// 引擎换代：旧会话的 rAF 闭包持着旧引擎引用，先收尾
	cancelSmoothPan(view);
	view.engineEvents.onDom(canvas, 'mousedown', (event) => {
		// 用户开始拖拽 = 新的视口输入：先停掉未走完的滚轮惯性，避免两边抢平移
		cancelSmoothPan(view);
		if (event.button === 1) {
			// 只拦浏览器默认行为（自动滚动圆盘）；引擎的中键平移由引擎自行驱动
			event.preventDefault();
		}
	});
	// capture 必须挂在祖先：引擎的 wheel 监听在画布自身且先 stopPropagation，
	// 同元素上后注册的 capture 会被引擎按注册顺序抢先（理由见文件头）。
	const host = canvas.parentElement;
	if (!host) {
		return;
	}
	view.engineEvents.onDom(host, 'wheel', (event) => handleWheelGesture(view, event), {
		capture: true,
		// preventDefault 需要非 passive（显式声明，勿依赖浏览器默认值）
		passive: false,
	});
}

/**
 * 滚轮手势入口（唯一）：`Alt` 横轴 + 鼠标格纵向。
 *
 * 让位项逐条固定：`Ctrl/Cmd`（缩放优先，并取消未走完的平滑）、指针不在画布内、
 * 编辑中（引擎的 wheel 负责提交编辑）、连续输入的小 delta（交引擎逐事件跟手；
 * 触控板纯横向滑动的 `deltaY ≈ 0` 也落在这里）。
 */
function handleWheelGesture(view: ViewportContext, event: WheelEvent): void {
	const mindMap = view.mindMap;
	const canvas = view.canvasEl;
	if (!mindMap || !canvas) {
		return;
	}
	if (event.ctrlKey || event.metaKey) {
		// 缩放优先：若滚轮平滑还在跑，先停下（否则缩放后画面继续漂移）
		cancelSmoothPan(view);
		return;
	}
	const target = event.target as Node | null;
	if (!target || !canvas.contains(target)) {
		return;
	}
	// 编辑中让位：引擎的 wheel 负责提交编辑（引擎编辑框 hide / 内联编辑器
	// mousewheel 提交），那一格走引擎的纵向平移——输入必须先落数据。
	if (isAnyNodeEditing(mindMap)) {
		return;
	}
	// Alt：横轴（任意 delta 都归插件，触控板小 delta 也按 1:1 横向走）
	if (event.altKey) {
		const dx = altWheelPanDelta(event.deltaY);
		if (dx === 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		enqueueSmoothPan(view, dx, 0);
		return;
	}
	// 纵向：只接管鼠标格；小 delta 交引擎（它本来就按事件跟手，不再叠延迟）
	if (Math.abs(event.deltaY) < WHEEL_SMOOTH_MIN_DELTA) {
		return;
	}
	event.preventDefault();
	// capture 阶段拦在画布之前 ⇒ 引擎的 wheel 监听收不到，不会再多走一格
	event.stopPropagation();
	enqueueSmoothPan(
		view,
		0,
		event.deltaY < 0 ? WHEEL_NOTCH_STEP_PX : -WHEEL_NOTCH_STEP_PX,
	);
}

/** 把一次滚轮位移并入目标值，必要时启动 rAF 循环 */
function enqueueSmoothPan(
	view: ViewportContext,
	dx: number,
	dy: number,
): void {
	const canvas = view.canvasEl;
	const mindMap = view.mindMap;
	const win = canvas?.ownerDocument?.defaultView ?? null;
	if (!canvas || !mindMap || !win) {
		return;
	}
	let state = smoothPans.get(view);
	if (!state || state.mindMap !== mindMap || state.win !== win) {
		cancelSmoothPan(view);
		state = {
			x: 0,
			y: 0,
			frame: null,
			win,
			mindMap,
			lastTs: 0,
			stalled: 0,
		};
		smoothPans.set(view, state);
	}
	state.x += dx;
	state.y += dy;
	state.stalled = 0;
	if (state.frame === null) {
		state.lastTs = 0;
		state.frame = win.requestAnimationFrame((ts) => tickSmoothPan(view, ts));
	}
}

/** 每帧按指数趋近目标值；到界（引擎夹住）连续两帧走不动就丢弃剩余量 */
function tickSmoothPan(view: ViewportContext, ts: number): void {
	const state = smoothPans.get(view);
	if (!state) {
		return;
	}
	const mindMap = view.mindMap;
	if (!mindMap || mindMap !== state.mindMap) {
		cancelSmoothPan(view);
		return;
	}
	const dt = state.lastTs > 0 ? Math.min(ts - state.lastTs, 64) : 16;
	state.lastTs = ts;
	const factor = 1 - Math.exp(-dt / WHEEL_SMOOTH_TAU_MS);
	/**
	 * 本帧要走的量：按指数趋近取份额；剩余已不足 `WHEEL_SMOOTH_EPSILON` 就一次
	 * 补完（否则永远逼近不全），再按单帧上限限幅（狂滚时目标可累积上千）。
	 */
	const stepOf = (remaining: number): number => {
		const share =
			Math.abs(remaining) < WHEEL_SMOOTH_EPSILON
				? remaining
				: remaining * factor;
		return Math.max(
			-WHEEL_SMOOTH_MAX_STEP,
			Math.min(WHEEL_SMOOTH_MAX_STEP, share),
		);
	};
	const stepX = stepOf(state.x);
	const stepY = stepOf(state.y);
	state.x -= stepX;
	state.y -= stepY;
	const before = getDrawTransform(mindMap);
	panMindMap(mindMap, stepX, stepY);
	const after = getDrawTransform(mindMap);
	const moved =
		Math.abs(after.translateX - before.translateX) > 0.01 ||
		Math.abs(after.translateY - before.translateY) > 0.01;
	if (moved) {
		state.stalled = 0;
	} else {
		state.stalled += 1;
		if (state.stalled >= WHEEL_SMOOTH_STALL_LIMIT) {
			state.x = 0;
			state.y = 0;
		}
	}
	if (Math.abs(state.x) < 0.01 && Math.abs(state.y) < 0.01) {
		cancelSmoothPan(view);
		return;
	}
	state.frame = state.win.requestAnimationFrame((next) =>
		tickSmoothPan(view, next),
	);
}

/** 停掉并遗忘平滑会话（幂等） */
function cancelSmoothPan(view: ViewportContext): void {
	const state = smoothPans.get(view);
	if (!state) {
		return;
	}
	if (state.frame !== null) {
		state.win.cancelAnimationFrame(state.frame);
	}
	smoothPans.delete(view);
}

/**
 * 缩放到选区（官方 `Shift+2` / 右键「Zoom to selection」）。
 *
 * 实现口径：取**激活节点**的 DOM 包围盒（已含当前缩放），按画布留边算出倍率，
 * 以包围盒中心为锚点缩放，再平移使该中心落到画布中心。
 *
 * @returns 是否完成；无选中节点（或拿不到包围盒）返回 false，由调用方回落到
 *   「适应画布」（官方 `Shift+2` 在空选区下无意义，回退更友好）。
 */
export function zoomToSelection(view: ViewportContext): boolean {
	const mindMap = view.mindMap;
	const canvas = view.canvasEl;
	if (!mindMap || !canvas) {
		return false;
	}
	const nodes = getActiveNodes(mindMap);
	if (nodes.length === 0) {
		return false;
	}
	const canvasRect = canvas.getBoundingClientRect();
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const node of nodes) {
		const el = getNodeGroupEl(node);
		if (!el) {
			continue;
		}
		const rect = el.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			continue;
		}
		minX = Math.min(minX, rect.left - canvasRect.left);
		minY = Math.min(minY, rect.top - canvasRect.top);
		maxX = Math.max(maxX, rect.right - canvasRect.left);
		maxY = Math.max(maxY, rect.bottom - canvasRect.top);
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		return false;
	}
	const width = maxX - minX;
	const height = maxY - minY;
	if (width <= 0 || height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0) {
		return false;
	}
	const factor = Math.min(
		(canvasRect.width * SELECTION_FIT_PADDING) / width,
		(canvasRect.height * SELECTION_FIT_PADDING) / height,
	);
	const centerX = (minX + maxX) / 2;
	const centerY = (minY + maxY) / 2;
	// 锚定包围盒中心缩放 → 该点不动；再平移到画布中心
	zoomMindMapAt(mindMap, factor, centerX, centerY);
	panMindMap(mindMap, canvasRect.width / 2 - centerX, canvasRect.height / 2 - centerY);
	return true;
}

/**
 * `Shift+1` / 工具栏 / 右键 / 命令面板：适应画布（官方 Zoom to fit；无选区概念）。
 *
 * **用户触发的 fit 唯一入口**：此前四处各自直调 `fitMindMap`，大图口径无处安放。
 * 引擎自动路径（首帧默认视口、恢复失败回退、整理后 fit）仍直调 `fitMindMap`——
 * 那些是后台行为，不该弹提示。
 *
 * 大图（> `HEAVY_FIT_NODE_THRESHOLD`）由引擎侧抬**最小可读比例**
 * （`engine/mindmap-viewport.LARGE_MAP_MIN_FIT_SCALE`），此时「适应画布」不再承诺
 * 一屏装下全部节点，故补一句提示。是否钳制**只问引擎**（`fitMindMap` 的返回值）：
 * 在 UI 侧按节点数另算阈值，会在「节点很多但内容本来就适配」时说出与事实相反的
 * 提示；节点计数也只在这条罕见的钳制分支里做，常规 fit 零额外遍历。
 */
export function fitToScreen(view: ViewportContext): void {
	const mindMap = view.mindMap;
	if (!mindMap || fitMindMap(mindMap) !== 'clamped') {
		return;
	}
	new Notice(
		tf(view.lang, 'common.fitClamped', { count: countMindMapNodes(mindMap) }),
	);
}
