/**
 * 拖拽换父辅助：优化「拖动节点重新链接」的落点识别范围。
 *
 * 引擎原生判定要求指针精确落在目标节点矩形内（Drag.checkOverlapNode 的
 * 闭区间命中），狭小节点、快速拖动或缩放视图下极易脱靶——用户须把指针
 * 摆到极其苛刻的位置才能完成换父。
 *
 * 本模块在拖拽期间以「节点中心为锚点的均匀圆形识别域」（半径
 * TARGET_RADIUS_PX，与节点大小无关）为识别范围，并提供视觉高亮。识别标准
 * 刻意与节点形状解耦（均以节点中央为准）。锚点分两类、统一按指针距离
 * 最近仲裁：
 * - 节点中心 → 外借 overlapNode（挂为该节点子级，引擎 MOVE_NODE_TO）；
 * - 相邻兄弟间隙中点 → 外借 prevNode（插到该兄弟之后，引擎 INSERT_AFTER）——
 *   「落在两条划分线之间 = 插到中间」直觉的语义正确形态，间隙锚点唯一
 *   归属一对兄弟，无边→节点歧义。
 * 引擎自身的精确判定优先——只有引擎本轮三态（overlap/prev/next）全部
 * 未命中时才外借。松手后由引擎原生命令完成挂接，语义与原生一致。
 *
 * 生命周期（只在节点被拖动时启用，其余时刻零开销）：
 * - node_dragging（引擎每次拖拽移动发出）→ 首次触发时挂 window 监听；
 * - window mousemove（仅拖拽会话中存在）→ rAF 合帧（每渲染帧至多一次）→
 *   判定 + 高亮 + 外借；
 * - window mouseup / node_dragend（均晚于引擎消费落点）→ 清理；
 * - engineEvents 随引擎实例销毁，无跨实例泄漏。
 */
import { walkTree } from '../domain/tree';
import {
	getDragDropState,
	getDrawTransform,
	getNodeGroupEl,
	getNodeLayoutRect,
	getRenderRoot,
	isRootNode,
	setDragOverlapTarget,
	setDragPrevTarget,
	toCanvasPoint,
} from '../mindmap';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/**
 * 识别范围：以节点中心为圆心的均匀半径（画布视口 px，缩放一致）。
 * 与节点大小无关——大小节点捕获域一致；半径覆盖典型兄弟间距 1~2 个节点。
 */
export const TARGET_RADIUS_PX = 120;

/** 画布视口空间坐标（toPos 空间，与缩放/平移后的节点位置同系） */
interface ViewPoint {
	x: number;
	y: number;
}

interface AssistSession {
	draggedNode: MindMapNode;
	/** 被拖节点及其子孙的 uid 集（候选排除集） */
	excludeUids: Set<string>;
	/** 当前高亮/外借的节点（跨 move 跟踪，变更时切换类名） */
	lentNode: MindMapNode | null;
	/** 待判定指针事件（rAF 合帧期间被后续 move 覆盖，只保留最新） */
	pendingEvent: MouseEvent | null;
	rafId: number | null;
	moveListener: (event: MouseEvent) => void;
	upListener: (event: MouseEvent) => void;
}

/** 每视图的会话状态（WeakMap：不进 context 契约） */
const sessions = new WeakMap<MindMapViewContext, AssistSession | null>();

/** 节点中心（画布视口空间）：识别锚点与节点形状/大小解耦 */
export function nodeViewportCenter(
	node: MindMapNode,
	transform: { scaleX: number; scaleY: number; translateX: number; translateY: number },
): ViewPoint {
	const rect = getNodeLayoutRect(node);
	return {
		x: (rect.left + rect.width / 2) * transform.scaleX + transform.translateX,
		y: (rect.top + rect.height / 2) * transform.scaleY + transform.translateY,
	};
}

/**
 * 在候选中取指针最近且落在识别半径（节点中心均匀圆域）内的节点；
 * 并列时取先出现者（与引擎自上而下的树序一致）。纯函数，可单测。
 * 用平方距离比较（单调等价），免去每候选一次 Math.hypot 的开方开销——
 * 本函数在大图拖拽期间按帧调用、候选可达数千。
 */
export function pickNearestNode<T>(
	candidates: T[],
	point: ViewPoint,
	radius: number,
	centerOf: (item: T) => ViewPoint,
): T | null {
	let best: T | null = null;
	let bestDistSq = radius * radius;
	for (const item of candidates) {
		const center = centerOf(item);
		const dx = point.x - center.x;
		const dy = point.y - center.y;
		const distSq = dx * dx + dy * dy;
		if (distSq <= bestDistSq) {
			best = item;
			bestDistSq = distSq;
		}
	}
	return best;
}

/** 收集被拖节点及其子孙的 uid（候选排除集） */
function collectExcludeUids(dragged: MindMapNode): Set<string> {
	const uids = new Set<string>();
	walkTree(dragged, (node) => {
		const uid = (node.getData?.('uid') as string | undefined) ?? '';
		if (uid) {
			uids.add(uid);
		}
	});
	return uids;
}

/** 高亮/取消高亮节点（引擎重渲染会重建 group，类名随帧维护） */
function setHighlight(view: MindMapViewContext, session: AssistSession, node: MindMapNode | null): void {
	if (session.lentNode && session.lentNode !== node) {
		getNodeGroupEl(session.lentNode)?.classList.remove('mindmap-drag-target');
	}
	session.lentNode = node;
	// 幂等补类：引擎中途重渲染会重建 group，逐帧补回高亮不丢
	if (node) {
		getNodeGroupEl(node)?.classList.add('mindmap-drag-target');
	}
}

/** 收尾：清高亮、撤监听（引擎 reset 已自行清落点三态） */
function endSession(view: MindMapViewContext): void {
	const session = sessions.get(view);
	if (!session) {
		return;
	}
	sessions.set(view, null);
	if (session.rafId !== null) {
		window.cancelAnimationFrame(session.rafId);
		session.rafId = null;
	}
	session.pendingEvent = null;
	setHighlight(view, session, null);
	window.removeEventListener('mousemove', session.moveListener);
	window.removeEventListener('mouseup', session.upListener);
}

/**
 * 识别锚点（两类，统一按「指针距离最近」仲裁）：
 * - child：候选节点中心 → 外借 overlapNode（挂为该节点子级）；
 * - after：相邻兄弟间隙中点 → 外借 prevNode（插到该兄弟之后，
 *   引擎松手走原生 INSERT_AFTER）。间隙锚点唯一归属一对兄弟，
 *   是「插到两者中间」直觉的语义正确形态。
 */
export interface DropAnchor {
	kind: 'child' | 'after';
	node: MindMapNode;
	point: ViewPoint;
}

/** 相邻兄弟间隙的锚点（两点几何中心） */
export function gapCenter(a: ViewPoint, b: ViewPoint): ViewPoint {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 拖拽期间的 mousemove：引擎命中则让位，未命中则外借最近锚点（挂子/插兄弟） */
function handleMove(view: MindMapViewContext, session: AssistSession, event: MouseEvent): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	const drag = getDragDropState(mindMap);
	if (!drag) {
		return;
	}
	// 引擎本轮已有精确命中（挂子/前后插兄弟）：让位并撤高亮
	if (drag.overlapNode || drag.prevNode || drag.nextNode) {
		setHighlight(view, session, null);
		return;
	}
	const point = toCanvasPoint(mindMap, event.clientX, event.clientY);
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
		return;
	}
	// 候选：渲染树中除「被拖节点及子孙」与根节点外的全部节点
	const root = getRenderRoot(mindMap);
	if (!root) {
		return;
	}
	const transform = getDrawTransform(mindMap);
	const anchors: DropAnchor[] = [];
	/** 按父节点收集的子节点（已过滤被拖子树），用于构造兄弟间隙锚点 */
	const childrenByParent = new Map<MindMapNode, MindMapNode[]>();
	walkTree(root, (node) => {
		const uid = (node.getData?.('uid') as string | undefined) ?? '';
		const inDraggedSubtree = uid !== '' && session.excludeUids.has(uid);
		if (!inDraggedSubtree && !isRootNode(node)) {
			// 挂子锚点：节点中心
			anchors.push({
				kind: 'child',
				node,
				point: nodeViewportCenter(node, transform),
			});
		}
		// 兄弟间隙锚点的父节点：不在被拖子树内（往自身子树里插兄弟非法）
		if (!inDraggedSubtree) {
			const children = (node.children ?? []).filter((child) => {
				const childUid = (child.getData?.('uid') as string | undefined) ?? '';
				return childUid === '' || !session.excludeUids.has(childUid);
			});
			if (children.length >= 2) {
				childrenByParent.set(node, children);
			}
		}
		return undefined;
	});
	// 挂子锚点 + 兄弟间隙锚点统一按距离仲裁（间隙锚点唯一归属一对兄弟）
	for (const [, children] of childrenByParent) {
		for (let i = 0; i < children.length - 1; i++) {
			const a = children[i]!;
			const b = children[i + 1]!;
			anchors.push({
				kind: 'after',
				node: a,
				point: gapCenter(
					nodeViewportCenter(a, transform),
					nodeViewportCenter(b, transform),
				),
			});
		}
	}
	const nearest = pickNearestNode(anchors, point, TARGET_RADIUS_PX, (anchor) => anchor.point);
	if (!nearest) {
		setHighlight(view, session, null);
		return;
	}
	setHighlight(view, session, nearest.node);
	if (nearest.kind === 'after') {
		setDragOverlapTarget(mindMap, null);
		setDragPrevTarget(mindMap, nearest.node);
	} else {
		setDragPrevTarget(mindMap, null);
		setDragOverlapTarget(mindMap, nearest.node);
	}
}

/** 注册拖拽换父辅助（引擎就绪后随 setupFeatures 调用） */
export function setupDragTargetAssist(view: MindMapViewContext): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	sessions.set(view, null);
	view.engineEvents.onEngine(mindMap, 'node_dragging', (...args: unknown[]) => {
		// 引擎在拖拽每次 mousemove 发出；首帧建立会话并挂临时监听
		if (sessions.get(view)) {
			return;
		}
		const draggedNode = args[0] as MindMapNode | undefined;
		if (!draggedNode || isRootNode(draggedNode)) {
			return;
		}
		const session: AssistSession = {
			draggedNode,
			excludeUids: collectExcludeUids(draggedNode),
			lentNode: null,
			pendingEvent: null,
			rafId: null,
			moveListener: (event: MouseEvent) => {
				// rAF 合帧：两次渲染帧之间的高频 move 只保留最新一次判定——
				// 判定是全树锚点重建（O(n)），按帧率而非事件频率计价
				//（大图 + 高回报率鼠标下事件频率可达帧率的数倍）
				session.pendingEvent = event;
				if (session.rafId === null) {
					session.rafId = window.requestAnimationFrame(() => {
						session.rafId = null;
						const pending = session.pendingEvent;
						session.pendingEvent = null;
						if (pending && sessions.get(view) === session) {
							handleMove(view, session, pending);
						}
					});
				}
			},
			upListener: () => {
				endSession(view);
			},
		};
		sessions.set(view, session);
		window.addEventListener('mousemove', session.moveListener);
		window.addEventListener('mouseup', session.upListener);
	});
	// 引擎在 onMouseup 消费落点之后发出 node_dragend → 此处收尾安全
	view.engineEvents.onEngine(mindMap, 'node_dragend', () => {
		endSession(view);
	});
}
