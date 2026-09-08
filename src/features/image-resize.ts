/**
 * 节点图片拖拽调宽：hover 图片显示右下角手柄，拖动等比缩放。
 *
 * 持久化采用 **Obsidian 官方嵌入尺寸语法**（帮助「Embed files /
 * Basic formatting syntax」）：尺寸直接写入图片引用双链——
 * `![[图.png|300]]` / `![[图.png|300x150]]` / `![alt|300](url)`——
 * 不落 data.json。链路：拖拽改 engine data.imageSize（custom:true）→
 * 结束时 scheduleSave → 序列化 rawOk 尺寸特征不符 → 合成回写 `|宽度`；
 * 加载时解析参数（mdImageWidth/Height）→ walkCorrectImageSizesByAspect
 * 按原始比例补齐高度。
 *
 * 设计要点：
 * - 无常驻监听：hover（node_img_mouseenter/mouseleave）驱动手柄显隐，
 *   拖拽会话期间才挂 window mousemove/mouseup（捕获阶段、手势独占），
 *   结束即移除；
 * - 尺寸写入走 SET_NODE_DATA + render；渲染会重建图片元素，因此每帧
 *   重新查询当前 image 元素。
 */
import {
	getDrawTransform,
	getNodeGroupEl,
	setNodeImageSize,
} from '../mindmap';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/** 手柄像素尺寸（屏幕 px） */
const HANDLE_SIZE_PX = 12;
/** 缩放下限（content px）：低于此尺寸图片不可辨识 */
const MIN_SIZE_PX = 24;
/** 缩放上限（content px）：防止单图占满画布 */
const MAX_SIZE_PX = 2000;

/** 拖拽会话（悬停态 → mousedown 建立 → mouseup 结束并调度保存） */
interface ResizeSession {
	node: MindMapNode;
	startClientX: number;
	startWidth: number;
	startHeight: number;
	/** 当前画布缩放（屏幕 px → content px 换算） */
	scale: number;
	/** 待应用尺寸（rAF 合帧期间被后续 move 覆盖） */
	pending: { width: number; height: number } | null;
	/** 最近一次实际写入引擎的尺寸（相同则跳过重渲染） */
	applied: { width: number; height: number } | null;
	rafId: number | null;
	moveListener: (event: MouseEvent) => void;
	upListener: (event: MouseEvent) => void;
}

/** 每视图的模块状态（WeakMap：状态不进 context 契约） */
interface ImageResizeState {
	handleEl: HTMLDivElement | null;
	/** 手柄当前对应的节点（hover 目标；也是拖拽会话目标） */
	hoverNode: MindMapNode | null;
	session: ResizeSession | null;
}

const states = new WeakMap<MindMapViewContext, ImageResizeState>();

function getState(view: MindMapViewContext): ImageResizeState {
	let s = states.get(view);
	if (!s) {
		s = { handleEl: null, hoverNode: null, session: null };
		states.set(view, s);
	}
	return s;
}

/** 引擎图片事件的第 2 参：SVG.js <image> 包装（.node 为原生 DOM 元素） */
function imageElOf(imageLike: unknown): SVGImageElement | null {
	const raw = (imageLike as { node?: unknown } | null | undefined)?.node;
	return raw instanceof SVGImageElement ? raw : null;
}

/** 查询节点当前渲染的图片元素（引擎重渲染会重建元素，需实时取） */
function currentNodeImageEl(node: MindMapNode): SVGImageElement | null {
	const group = getNodeGroupEl(node);
	if (!group) {
		return null;
	}
	const el = group.querySelector('image');
	return el instanceof SVGImageElement ? el : null;
}

/** 手柄定位到图片右下角内侧（内嵌避免指针移向手柄时先触发图片 mouseleave） */
function positionHandle(view: MindMapViewContext, imageEl: SVGImageElement): void {
	const handle = getState(view).handleEl;
	const canvasRect = view.canvasEl?.getBoundingClientRect();
	if (!handle || !canvasRect) {
		return;
	}
	const imgRect = imageEl.getBoundingClientRect();
	const inset = HANDLE_SIZE_PX * 1.25;
	handle.style.left = `${imgRect.right - canvasRect.left - inset}px`;
	handle.style.top = `${imgRect.bottom - canvasRect.top - inset}px`;
}

/** 显示手柄（hover 目标 + 当前图片元素） */
function showHandle(view: MindMapViewContext, node: MindMapNode, imageEl: SVGImageElement): void {
	const state = getState(view);
	if (!state.handleEl) {
		return;
	}
	state.hoverNode = node;
	positionHandle(view, imageEl);
	state.handleEl.classList.add('is-visible');
}

/** 隐藏手柄（拖拽会话期间保持显示） */
function hideHandle(view: MindMapViewContext): void {
	const state = getState(view);
	if (state.session) {
		return;
	}
	state.hoverNode = null;
	state.handleEl?.classList.remove('is-visible');
}

/** 计算等比缩放后的尺寸（以水平拖动为主导；上下限按比例联动钳制，宽高比恒定） */
export function computeResizedSize(
	session: Pick<ResizeSession, 'startClientX' | 'startWidth' | 'startHeight' | 'scale'>,
	clientX: number,
): { width: number; height: number } {
	const dw = (clientX - session.startClientX) / session.scale;
	const ratio = session.startHeight / session.startWidth;
	// 比例保持的钳制：宽被钳制时高同步落回界内（minW/maxW 由高度界反推）
	const minW = Math.max(MIN_SIZE_PX, MIN_SIZE_PX / ratio);
	const maxW = Math.min(MAX_SIZE_PX, MAX_SIZE_PX / ratio);
	const width = Math.max(minW, Math.min(maxW, session.startWidth + dw));
	return { width: Math.round(width), height: Math.round(width * ratio) };
}

/** 应用待应用尺寸（rAF 回调）：写引擎数据并跟随重定位手柄 */
function applyPending(view: MindMapViewContext, session: ResizeSession): void {
	session.rafId = null;
	const pending = session.pending;
	session.pending = null;
	if (!pending || !view.mindMap) {
		return;
	}
	// 尺寸未变 → 跳过整树重渲染：SET_NODE_DATA + render 是引擎全量重排，
	// 慢速拖动/钳制平台期时多数帧落在同一取整尺寸，白白重排
	if (
		session.applied &&
		session.applied.width === pending.width &&
		session.applied.height === pending.height
	) {
		const imageEl = currentNodeImageEl(session.node);
		if (imageEl) {
			positionHandle(view, imageEl);
		}
		return;
	}
	session.applied = pending;
	setNodeImageSize(view.mindMap, session.node, pending.width, pending.height);
	const imageEl = currentNodeImageEl(session.node);
	if (imageEl) {
		positionHandle(view, imageEl);
	}
}

/** 结束拖拽会话：调度保存（尺寸回写嵌入语法）并清理临时监听 */
function endSession(view: MindMapViewContext): void {
	const state = getState(view);
	const session = state.session;
	state.session = null;
	if (!session) {
		return;
	}
	if (session.rafId !== null) {
		cancelAnimationFrame(session.rafId);
		session.rafId = null;
	}
	// 移除时带同款 capture 标志（与注册匹配）
	window.removeEventListener('mousemove', session.moveListener, true);
	window.removeEventListener('mouseup', session.upListener, true);
	// 官方嵌入语法持久化：engine data.imageSize 已随拖拽更新，
	// scheduleSave → 序列化 rawOk 尺寸特征不符 → 合成回写 `|宽度`
	view.scheduleSave();
	hideHandle(view);
}

/** 建立拖拽会话（手柄 mousedown）：记录起点尺寸并挂临时监听 */
function startSession(
	view: MindMapViewContext,
	node: MindMapNode,
	event: MouseEvent,
): void {
	const state = getState(view);
	if (state.session || !view.mindMap) {
		return;
	}
	const imageEl = currentNodeImageEl(node);
	if (!imageEl) {
		return;
	}
	const rect = imageEl.getBoundingClientRect();
	const scale = getDrawTransform(view.mindMap).scaleX;
	if (rect.width <= 0 || rect.height <= 0 || scale <= 0) {
		return;
	}
	const session: ResizeSession = {
		node,
		startClientX: event.clientX,
		startWidth: rect.width / scale,
		startHeight: rect.height / scale,
		scale,
		pending: null,
		applied: null,
		rafId: null,
		moveListener: (moveEvent: MouseEvent) => {
			const current = getState(view).session;
			if (!current) {
				return;
			}
			// 捕获阶段阻断传播：调宽手势独占鼠标移动——引擎的容器级
			// mousemove（Drag.onMousemove 等）在会话期间收不到事件，
			// 杜绝缩放拖拽被节点拖拽逻辑串扰
			moveEvent.stopPropagation();
			current.pending = computeResizedSize(current, moveEvent.clientX);
			if (current.rafId === null) {
				current.rafId = window.requestAnimationFrame(() =>
					applyPending(view, current),
				);
			}
		},
		upListener: () => {
			endSession(view);
		},
	};
	state.session = session;
	// 捕获阶段注册（先于引擎容器级监听执行，配合上方 stopPropagation
	// 形成手势独占；移除时须带同款 capture 标志）
	window.addEventListener('mousemove', session.moveListener, true);
	window.addEventListener('mouseup', session.upListener, true);
}

/** 注册图片拖拽调宽（引擎就绪后随 setupFeatures 调用；随 engineEvents 销毁清理） */
export function setupImageResize(view: MindMapViewContext): void {
	const mindMap = view.mindMap;
	if (!mindMap || !view.canvasEl) {
		return;
	}
	const state = getState(view);
	// 引擎重建可能发生在调宽会话进行中：先收尾旧会话、移除旧手柄，
	// 避免残留的 window 监听与悬空手柄作用于新引擎实例。
	endSession(view);
	state.handleEl?.remove();
	state.handleEl = null;
	state.hoverNode = null;

	// 手柄 DOM：画布容器内绝对定位（容器 position:relative）
	const handle = view.canvasEl.createDiv('mindmap-img-resize-handle');
	state.handleEl = handle;

	// 指针在图片与手柄间移动时保持手柄可见
	handle.addEventListener('mouseenter', () => {
		const s = getState(view);
		if (!s.session && s.hoverNode) {
			const imageEl = currentNodeImageEl(s.hoverNode);
			if (imageEl) {
				showHandle(view, s.hoverNode, imageEl);
			}
		}
	});
	handle.addEventListener('mouseleave', () => hideHandle(view));
	handle.addEventListener('mousedown', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const s = getState(view);
		if (s.hoverNode) {
			startSession(view, s.hoverNode, event);
		}
	});

	// hover 显隐（引擎图片元素事件；args: [node, imageEl, event]）
	view.engineEvents.onEngine(mindMap, 'node_img_mouseenter', (...args: unknown[]) => {
		const node = args[0] as MindMapNode | undefined;
		const imageEl = imageElOf(args[1]);
		if (node && imageEl && !getState(view).session) {
			showHandle(view, node, imageEl);
		}
	});
	view.engineEvents.onEngine(mindMap, 'node_img_mouseleave', (...args: unknown[]) => {
		// 关键：指针从图片移到手柄上时，图片按命中测试判定「已离开」发出
		// mouseleave——此时若隐藏手柄，命中会回落到图片并再次 mouseenter，
		// 形成显示/隐藏闪烁循环；用户按下瞬间若恰逢隐藏态，mousedown 会
		// 穿透到下层节点 group 触发引擎拖拽（表现为移动节点而非调宽）。
		// relatedTarget 指向手柄（或会话进行中）时保持显示。
		const event = args[2] as MouseEvent | undefined;
		const state = getState(view);
		const related = event?.relatedTarget as Node | null | undefined;
		if (state.handleEl && related && state.handleEl.contains(related)) {
			return;
		}
		hideHandle(view);
	});
	// 节点拖拽/缩放/重渲染期间隐藏（位置失效，避免手柄漂移）
	view.engineEvents.onEngine(mindMap, 'node_dragging', () => {
		hideHandle(view);
	});
}

/**
 * 视图关闭时的收尾：结束进行中的调宽会话并移除手柄 DOM。
 *
 * 会话的 window mousemove/mouseup（捕获阶段）为临时监听，不经
 * engineEvents/viewEvents 记录——调宽中途关闭视图时收不到 mouseup，
 * 必须由视图 onClose 显式清理，否则监听泄漏且继续作用于已销毁视图
 * （endSession 同时把已应用的尺寸调度保存，避免尺寸改动丢失）。
 */
export function teardownImageResize(view: MindMapViewContext): void {
	endSession(view);
	const state = getState(view);
	state.handleEl?.remove();
	state.handleEl = null;
	state.hoverNode = null;
}
