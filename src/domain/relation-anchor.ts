/**
 * 联系线的**手绘锚定**（纯几何、零 DOM）：建边不自动选路，由用户依次点放
 * 两个手柄（端点 + 控制点一次给全）。
 *
 * ## 会话（session）
 * 1. `start`：指针决定**起点手柄**（控制点 1），同时按指针相对节点盒的射线
 *    投射决定端点锚点（`dir` + `range`）；
 * 2. `end`：起点冻结，指针决定**终点手柄**（控制点 2）与终点锚点；
 * 3. 两次落定后产出 {@link RelationGeometry}（8 个字段），由调用方写进
 *    `%%rel:… | geo=…%%`。
 *
 * ## 为什么是射线投射
 * 引擎 `calcPoint` 的锚点语义就是「节点中心 → 指针的射线与四条边的交点」，
 * 这里按同一口径实现（不是"取最近边"）：指针在节点内部时也给出朝向指针那
 * 一侧的边，且 `range` 的符号与 `getNodePoint` 一致（左右用 `centerY - y`，
 * 上下用 `centerX - x`），引擎读取 `geo` 时不会镜像。
 *
 * 纯函数 + 显式参数 ⇒ 可在 `vitest` 里直接构造节点盒验证（硬规则 7）。
 */

import type {
	RelationAnchorDir,
	RelationGeometry,
	RelationPoint2D,
	RelationRect,
} from './relation';

/** 一次落定的锚点（内容坐标） */
export interface AnchorPoint {
	dir: RelationAnchorDir;
	/** 沿该边的位移（与引擎 `getNodePoint` 同符号） */
	range: number;
	x: number;
	y: number;
}

/**
 * 锚定会话（可变对象；DOM 层持有、纯逻辑层推进）。
 *
 * 阶段由两个手柄的**存在性**表达（`start` → 等终点，`start` + `end` → 已完成），
 * 不另存 `phase` 字段：那是同一件事的第二份记录，多一处可漂移的状态。
 */
export interface RelationAnchorSession {
	from: RelationRect;
	to: RelationRect;
	/** 当前指针（内容坐标） */
	pointer: RelationPoint2D;
	/** 已落定的手柄：指针位置 = 控制点位置 */
	start?: { pointer: RelationPoint2D; anchor: AnchorPoint };
	end?: { pointer: RelationPoint2D; anchor: AnchorPoint };
}

/** 预览：路径 + 两个手柄的位置（`end` 为 null 时只显示起点柄） */
export interface AnchorPreview {
	path: string;
	startHandle: RelationPoint2D;
	endHandle: RelationPoint2D | null;
	/** 起点锚点（画控制线用；第一阶段是节点边上的锚点） */
	startAnchor: RelationPoint2D;
}

/** 射线没有方向（指针恰在盒中心）时的退化锚点：右侧中点（与引擎默认 `right` 一致） */
function rightAnchor(rect: RelationRect): AnchorPoint {
	const centerY = rect.top + rect.height / 2;
	return {
		dir: 'right',
		range: 0,
		x: rect.left + rect.width,
		y: centerY,
	};
}

/**
 * 指针 → 节点边上的锚点（射线投射，与引擎 `calcPoint` 同口径）。
 *
 * 本函数挂在 `pointermove` 上（每次移动都算），故只保留「当前最小 t」而不建
 * 数组、不排序——两个候选交点里总有一个在远侧，取近的那个即穿出点。
 */
export function anchorAtPointer(
	rect: RelationRect,
	pointer: RelationPoint2D,
): AnchorPoint {
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;
	const dx = pointer.x - centerX;
	const dy = pointer.y - centerY;
	if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
		return rightAnchor(rect);
	}
	const halfWidth = rect.width / 2;
	const halfHeight = rect.height / 2;
	let bestDir: RelationAnchorDir | null = null;
	let bestT = Number.POSITIVE_INFINITY;
	const consider = (dir: RelationAnchorDir, t: number): void => {
		if (t > 0 && t < bestT) {
			bestDir = dir;
			bestT = t;
		}
	};
	if (Math.abs(dx) > 1e-6) {
		consider('right', halfWidth / dx);
		consider('left', -halfWidth / dx);
	}
	if (Math.abs(dy) > 1e-6) {
		consider('bottom', halfHeight / dy);
		consider('top', -halfHeight / dy);
	}
	if (bestDir === null) {
		return rightAnchor(rect);
	}
	const x = centerX + dx * bestT;
	const y = centerY + dy * bestT;
	// `getNodePoint` 的符号：左右边 y = centerY - range；上下边 x = centerX - range
	const range = bestDir === 'right' || bestDir === 'left' ? centerY - y : centerX - x;
	return { dir: bestDir, range, x, y };
}

/** 开一个锚定会话（`pointer` 是进入时的指针位置，内容坐标） */
export function createAnchorSession(
	from: RelationRect,
	to: RelationRect,
	pointer: RelationPoint2D,
): RelationAnchorSession {
	return {
		from: { ...from },
		to: { ...to },
		pointer: { ...pointer },
	};
}

/** 指针移动（只改指针；几何在 render/commit 时现算） */
export function moveAnchorSession(
	session: RelationAnchorSession,
	pointer: RelationPoint2D,
): void {
	session.pointer = { ...pointer };
}

/**
 * 落定一次。
 *
 * @returns 第一次返回 null（起点已定，等待终点）；第二次返回完整几何
 */
export function commitAnchorSession(
	session: RelationAnchorSession,
): RelationGeometry | null {
	if (!session.start) {
		session.start = {
			pointer: { ...session.pointer },
			anchor: anchorAtPointer(session.from, session.pointer),
		};
		return null;
	}
	session.end = {
		pointer: { ...session.pointer },
		anchor: anchorAtPointer(session.to, session.pointer),
	};
	return relationGeometryOf(session);
}

/** 会话 → 持久化几何（要求两次落定都已完成） */
function relationGeometryOf(
	session: RelationAnchorSession,
): RelationGeometry {
	if (!session.start || !session.end) {
		throw new Error('relation anchor: geometry requested before both commits');
	}
	const { start, end } = session;
	return {
		fromDir: start.anchor.dir,
		fromRange: start.anchor.range,
		toDir: end.anchor.dir,
		toRange: end.anchor.range,
		ctl1: {
			x: start.pointer.x - start.anchor.x,
			y: start.pointer.y - start.anchor.y,
		},
		ctl2: {
			x: end.pointer.x - end.anchor.x,
			y: end.pointer.y - end.anchor.y,
		},
	};
}

/** 三次贝塞尔路径（内容坐标；与 `geo` 的落地形状一致） */
export function cubicCurvePath(
	start: RelationPoint2D,
	control1: RelationPoint2D,
	control2: RelationPoint2D,
	end: RelationPoint2D,
): string {
	return (
		`M ${start.x},${start.y} ` +
		`C ${control1.x},${control1.y} ${control2.x},${control2.y} ` +
		`${end.x},${end.y}`
	);
}

/**
 * 预览（不落盘）：第一阶段画「节点 → 指针」的直线；第二阶段画
 * 「起点锚点 → 控制点1 → 指针（控制点2）→ 终点锚点」的三次贝塞尔。
 */
export function previewOf(session: RelationAnchorSession): AnchorPreview {
	if (!session.start) {
		const startAnchor = anchorAtPointer(session.from, session.pointer);
		return {
			path: `M ${startAnchor.x},${startAnchor.y} L ${session.pointer.x},${session.pointer.y}`,
			startHandle: { ...session.pointer },
			endHandle: null,
			startAnchor: { x: startAnchor.x, y: startAnchor.y },
		};
	}
	const endAnchor = anchorAtPointer(session.to, session.pointer);
	return {
		path: cubicCurvePath(
			{ x: session.start.anchor.x, y: session.start.anchor.y },
			{ ...session.start.pointer },
			{ ...session.pointer },
			{ x: endAnchor.x, y: endAnchor.y },
		),
		startHandle: { ...session.start.pointer },
		endHandle: { ...session.pointer },
		startAnchor: { x: session.start.anchor.x, y: session.start.anchor.y },
	};
}
