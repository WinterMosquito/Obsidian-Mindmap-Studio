/**
 * 节点图片拖拽调宽：hover 图片显示右下角手柄，拖动等比缩放。
 *
 * 持久化采用 **Obsidian 官方嵌入尺寸语法**（帮助「Embed files /
 * Basic formatting syntax」）：尺寸直接写入图片引用双链——
 * `![[图.png|300]]` / `![[图.png|300x150]]` / `![alt|300](url)`——
 * 不落 data.json。链路：拖拽改 engine data.imageSize（custom:true）→
 * 结束时 scheduleSave → 序列化 rawOk 尺寸特征不符 → 合成回写 `|宽度`；
 * 加载时解析参数（mdImageWidth/Height）→ walkImageSizeCorrections
 * 按参数定尺寸（仅宽时探测原始比例补齐高度；K97 后未设置尺寸的图不参与）。
 *
 * 设计要点：
 * - 无常驻监听：hover（node_img_mouseenter/mouseleave）驱动手柄显隐，
 *   拖拽会话期间才挂 window mousemove/mouseup（捕获阶段、手势独占），
 *   结束即移除；
 * - **帧内预览走 DOM 直写**（2026-10-02 重构）：直接改渲染中 `<image>` 的
 *   `width/height`（与引擎渲染同源属性，SVG 用户单位 = content px）——每次
 *   引擎写入都是**整树**重排，rAF 合帧只能把频率压到「每帧一次」，大图仍
 *   持续卡顿；直写仅重绘图片本身（无步长死区、逐帧跟手），节点外框/兄弟
 *   节点的重排延后到收尾的那一次引擎提交（一条历史、一次布局落地）。
 *   松手时无条件补写最终尺寸（否则会停在上一个预览值）；
 * - **只有收尾走引擎命令**（`setNodeImageSize`）：引擎命令一律 `addHistory()`
 *   ——整树 `getCopyData()` + `JSON.stringify` 比对后 `emit('data_change')`，
 *   逐帧走命令等于「每 8px 一条历史 + 每步一次自动保存调度 + 全树深拷贝开销」，
 *   用户实测表现为「拖动时保存好几次 + 卡顿」；收尾那一次即一条历史、一次
 *   保存调度，一次 Ctrl+Z 撤回整次调宽；
 * - 会话记录**所属引擎**：引擎重建（再次 setup）或视图关闭时会话被强制收尾，
 *   此时旧会话的节点已不属于当前引擎，陈旧帧回调与补写都必须据此短路。
 */
import {
	getDrawTransform,
	getNodeGroupEl,
	previewNodeImageSize,
	setNodeImageSize,
} from '../engine/mindmap';
import type { MindMap, MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MdNodeData } from '../core/node-data';
import type { MindMapViewContext } from './view-context';
import {
	startWindowDragSession,
	type WindowDragSession,
} from './drag-session';

/** 手柄像素尺寸（屏幕 px） */
const HANDLE_SIZE_PX = 12;
/** 缩放下限（content px）：低于此尺寸图片不可辨识 */
const MIN_SIZE_PX = 24;
/** 缩放上限（content px）：防止单图占满画布 */
const MAX_SIZE_PX = 2000;

/** 拖拽会话（悬停态 → mousedown 建立 → mouseup 结束并调度保存） */
interface ResizeSession {
	node: MindMapNode;
	/** 会话所属引擎：引擎重建后旧会话不得再写入（节点不属于新引擎） */
	engine: MindMap;
	startClientX: number;
	startWidth: number;
	startHeight: number;
	/** 当前画布缩放（屏幕 px → content px 换算） */
	scale: number;
	/** 待应用尺寸（rAF 合帧期间被后续 move 覆盖） */
	pending: { width: number; height: number } | null;
	/** 最近一次算出的尺寸（不论是否已写入；松手时据此补写最终值） */
	latest: { width: number; height: number } | null;
	/** 最近一次实际写入引擎的尺寸（相同/不足步长则跳过重渲染） */
	applied: { width: number; height: number } | null;
	/** 窗口级拖拽会话（监听 + rAF 合帧 + 幂等收尾，见 features/drag-session） */
	drag: WindowDragSession;
	/**
	 * 会话建立时的画布视口矩形（手柄定位的坐标系原点）。
	 *
	 * 缓存而非每帧读：帧内先写 `handle.style.left/top` 再读 `imageEl` 矩形已是
	 * 「写→读」交替，再多一次画布矩形读取会额外触发一次强制布局（拖拽调宽是
	 * 帧率敏感路径）。拖动期间画布元素自身不移动（内容变化不影响容器矩形），
	 * 会话内视作常量。
	 */
	canvasRect: DOMRect | null;
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

/**
 * 手柄定位到图片右下角内侧（内嵌避免指针移向手柄时先触发图片 mouseleave）。
 *
 * `cachedCanvasRect` 由拖拽会话传入（会话内画布矩形恒定，见 ResizeSession）；
 * 悬停态（无会话）传空，此时读一次 DOM 即可——每次 hover 只发生一次。
 */
function positionHandle(
	view: MindMapViewContext,
	imageEl: SVGImageElement,
	cachedCanvasRect?: DOMRect | null,
): void {
	const handle = getState(view).handleEl;
	const canvasRect = cachedCanvasRect ?? view.canvasEl?.getBoundingClientRect();
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

/** 同一尺寸按值比较（applied / latest / pending 是不同对象，引用比较永远不等） */
function sameSize(
	a: { width: number; height: number } | null,
	b: { width: number; height: number } | null,
): boolean {
	return (
		a !== null && b !== null && a.width === b.width && a.height === b.height
	);
}

/**
 * 收尾提交：把最终尺寸写入引擎数据并**记成一条历史**（一次 Ctrl+Z 撤回整次
 * 调宽），由 `data_change` 触发一次保存调度。同时清除「加载期自动校正」标记：
 * 用户拖过即为用户意图，序列化须把尺寸回写成 `|宽度`（否则拖拽结果不落盘）。
 *
 * 只在**净变化非 0** 时由调用方触发（拖回原尺寸不提交、标记保留，见 endSession）。
 * 引擎取 `session.engine`：调用点已校验它等于当前引擎，陈旧会话不会误写。
 */
function commitFinalSize(
	session: ResizeSession,
	size: { width: number; height: number },
): void {
	// md 字段引擎不识别，仅序列化用：就地删标记即可（尺寸本身走引擎命令）。
	// getData() 取不到时跳过——清标记是尽力而为，不能连累尺寸写入
	const data = session.node.getData() as MdNodeData | undefined;
	if (data) {
		delete data.mdImageAutoSize;
	}
	session.applied = size;
	setNodeImageSize(session.engine, session.node, size.width, size.height);
}

/** 应用待应用尺寸（rAF 回调）：写引擎数据并跟随重定位手柄 */
function applyPending(view: MindMapViewContext, session: ResizeSession): void {
	const pending = session.pending;
	session.pending = null;
	const mindMap = view.mindMap;
	// 陈旧帧（引擎已重建/会话已收尾）不得写入：节点不属于当前引擎
	if (!pending || !mindMap || mindMap !== session.engine) {
		return;
	}
	session.applied = pending;
	// 帧内：DOM 直写预览（不动数据、不进历史、不触发整树重排，见
	// engine/mindmap.previewNodeImageSize）；直写后元素尺寸即时生效，
	// 同一元素即可用于手柄定位
	previewNodeImageSize(session.node, pending.width, pending.height);
	const imageEl = currentNodeImageEl(session.node);
	if (imageEl) {
		positionHandle(view, imageEl, session.canvasRect);
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
	// 撤监听 + 取消在途帧（幂等；capture 标志由原语按注册同款摘除）
	session.drag.end();
	// 补写最终尺寸并**把整次调宽记成一条历史**：
	// - 帧内只做 DOM 直写预览（不动数据、不进历史、不派发 data_change）；
	// - 收尾统一走一次引擎命令 → 一条历史（一次 Ctrl+Z 撤回整次调宽）+ 一次
	//   保存调度 + 一次布局归位（帧内未重排的节点外框在此校正）。
	// 注意判据是「本次拖动作过预览 + 与起始尺寸有净变化」，**不是**与最后一帧
	// 预览值是否相同：最后一帧往往恰好就是最终值，若按「值相同则不提交」处理，
	// 整次调宽将**完全进不了历史**（撤销无从回退）。
	// 净变化为 0（拖回原尺寸）时不提交：DOM 直写值与起始一致、无遗留偏差。
	// 引擎已重建时跳过：旧会话的节点不属于当前引擎。
	const mindMap = view.mindMap;
	const finalSize = session.latest ?? session.applied;
	if (
		session.applied !== null &&
		finalSize &&
		!sameSize(
			{ width: session.startWidth, height: session.startHeight },
			finalSize,
		) &&
		mindMap &&
		mindMap === session.engine
	) {
		commitFinalSize(session, finalSize);
	}
	// 官方嵌入语法持久化：engine data.imageSize 已随收尾提交更新，
	// scheduleSave → 序列化 rawOk 尺寸特征不符 → 合成回写 `|宽度`
	// （收尾提交已由 data_change 调度过一次，此处兜底「只预览未提交」的情形）
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
		engine: view.mindMap,
		startClientX: event.clientX,
		startWidth: rect.width / scale,
		startHeight: rect.height / scale,
		scale,
		pending: null,
		latest: null,
		applied: null,
		// 会话内画布矩形恒定（见 ResizeSession 注释）：只在这里读一次
		canvasRect: view.canvasEl?.getBoundingClientRect() ?? null,
		// 会话句柄在字面量内一次性创建 ⇒ `drag` 不存在「未赋值」状态（不用占位断言）。
		// 回调一律重新读 `getState(view).session`（不闭包捕获 session）⇒ 也不存在
		// 「回调早于赋值」的窗口。
		//
		// 捕获阶段注册（先于引擎容器级监听执行，配合 onMove 内的 stopPropagation
		// 形成手势独占；移除时由原语带同款 capture 标志）。挂在画布所属窗口上：
		// popout 窗口里鼠标事件不落在主窗口，用全局 window 会完全收不到。
		drag: startWindowDragSession({
			win: view.containerEl.win,
			capture: true,
			onMove: (moveEvent: MouseEvent) => {
				const current = getState(view).session;
				if (!current) {
					return;
				}
				moveEvent.stopPropagation();
				current.pending = computeResizedSize(current, moveEvent.clientX);
				current.latest = current.pending;
				current.drag.scheduleFrame();
			},
			onFrame: () => {
				const current = getState(view).session;
				if (current) {
					applyPending(view, current);
				}
			},
			onUp: () => {
				endSession(view);
			},
		}),
	};
	state.session = session;
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
