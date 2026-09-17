/**
 * 画布视口手势：与 Obsidian **Canvas** 的导航约定对齐（官方帮助
 * `en/Plugins/Canvas.md`「Navigate the canvas」）。
 *
 * **滚轮与中键拖由引擎负责**——插件不再自建一份（vendor `simple-mind-map.cjs`
 * 实测，两处重复实现都会打架）：
 * - `wheel`：引擎监听在 `mindMap.el` 上（`onMousewheel`），处理前先
 *   `stopPropagation()` → 容器级再挂 wheel 监听**根本收不到事件**（此前那版即死代码）；
 *   而引擎本就实现了官方语义：`Ctrl/Cmd + 滚轮` = 以指针为锚缩放（`:231`），否则按
 *   `mousewheelAction: 'move'` 平移（`:227`，触控板 delta 与 Shift 横向一并覆盖）；
 * - 中键拖拽（`:226`）：引擎 event 模块在 mousedown 置 `isMiddleMousedown` →
 *   `drag` → View 平移，监听挂在 `window` 上——拖出画布仍跟手。插件若另按 pointer
 *   事件平移，会与引擎的**绝对定位**平移互相覆盖（`pointerleave` 还会让手势半途断掉）。
 *
 * 故本模块只补引擎没有的两件事：
 * 1. 抑制浏览器**原生中键自动滚动**（滚动圆盘）：引擎 `mousedownEventPreventDefault`
 *    默认 false，只对中键 `preventDefault`；监听在容器上、冒泡晚于引擎 `el` 上的
 *    mousedown，不干扰引擎已置的中键状态；
 * 2. `Shift+1` 缩放到全览 / `Shift+2` 缩放到选区（`:235 / :239`，键注册在
 *    `view-hotkeys`，实现为本文件的 `fitToScreen` / `zoomToSelection`）。
 *
 * 两条**刻意不做**的官方手势（非遗漏）：
 * - `Space + 拖拽` 平移：本视图的画布拖拽**本身即平移**（引擎 View 的
 *   mousedown+drag），按住 Space 与否行为一致，无需重复实现；
 * - `Space + 拖拽` 关闭吸附：本视图无网格吸附。
 *
 * 所有引擎内部操作经 `engine/mindmap` 的具名函数（防腐收口），本模块只做
 * 「选区 → 视口」的换算。
 */
import {
	fitMindMap,
	getActiveNodes,
	getNodeGroupEl,
	panMindMap,
	zoomMindMapAt,
} from '../engine/mindmap';
import type { MindMapViewContext } from './view-context';

/**
 * 视口手势所需的视图面（引擎实例 + 事件绑定器 + 画布元素）。
 * 刻意取 `MindMapViewContext` 的**子集**：快捷键宿主等窄接口也能直接传入。
 */
export type ViewportContext = Pick<
	MindMapViewContext,
	'mindMap' | 'engineEvents' | 'canvasEl'
>;

/** 缩放到选区时留出的边距比例（0.88 ≈ 四周各留 6% 画布） */
const SELECTION_FIT_PADDING = 0.88;

/**
 * 注册画布视口手势（引擎重建时随初始化调用）。
 *
 * 只挂一条容器级监听：中键 `mousedown` 抑制原生自动滚动。滚轮与中键拖的
 * 平移/缩放**由引擎实现**（见文件头），此处若再挂一份会双重生效或成为死代码。
 */
export function setupViewportGestures(view: ViewportContext): void {
	const canvas = view.canvasEl;
	if (!canvas) {
		return;
	}
	view.engineEvents.onDom(canvas, 'mousedown', (event) => {
		if (event.button === 1) {
			// 只拦浏览器默认行为（自动滚动圆盘）；引擎的中键平移由引擎自行驱动
			event.preventDefault();
		}
	});
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

/** `Shift+1`：缩放到全览（官方 Zoom to fit；无选区概念） */
export function fitToScreen(view: ViewportContext): void {
	fitMindMap(view.mindMap);
}
