/**
 * 联系（关系连线）：把 `domain/relation` 解析出的边落到引擎节点数据上。
 *
 * ## 数据落点（全部写在**源节点** data）
 * 引擎 `AssociativeLine` 的模型就是「源节点持有目标列表」：
 * - `associativeLineTargets: string[]` —— 目标节点的 **uid**（画线的唯一依据）；
 * - `associativeLineText: Record<uid, string>` —— 该线的标签（缺省时引擎会画
 *   `opt.defaultAssociativeLineText`，本插件在创建引擎时把它置空）；
 * - `associativeLinePoint` / `associativeLineTargetControlOffsets` —— 端点与控制点，
 *   只存**相对量**（dir+range / 相对端点的差值），节点移动、换布局后仍成立；
 * - `associativeLineStyle: Record<uid, { associativeLineColor }>` —— 每条边的线色
 *   （由正文的 `color=` 派生；没着色的边**不占键** ⇒ 回落主题）。只写颜色，
 *   宽度 / 虚线 / 标签字号仍由主题单一表达。
 *
 * ## 几何只有一个来源：用户手绘（2026-10-30 裁决）
 * 本插件**不做**系统自动选路。写进 data 的几何一律来自 Markdown 的 `geo=` 段
 * （也就是用户在画布上依次点放的那两个手柄）；文件里没有 `geo=` 的边交给引擎
 * 按当前节点几何自动计算端点（引擎的默认行为，不是我们的选路）。
 * `waypoint`（折点）随之删除——它是自动选路的产物，引擎侧从未有写入方。
 *
 * ## 两个时机（与 `engine/mindmap-colors` 逐条对齐）
 * - **创建引擎前**（`applyRelationsToTree`）：引擎 `handleData` 会克隆数据，建好
 *   后再改这份树不再生效 ⇒ 首帧即有线，不额外渲染一次；
 * - **创建引擎后**（`syncLiveRelations`）：挂 `node_tree_render_end`（不是
 *   `data_change`——插件内联编辑根本不发它，且撤销时它先于新树落地）。
 *
 * ## 单向数据流
 * Markdown 是唯一真相，data 只是派生显示状态：本模块**只写 data、不走命令**
 * （不进历史、不再发 `data_change`）。用户建边走插件的 raw 通道改 md，随后这里
 * 重算——不调用引擎的 `ADD_ASSOCIATIVE_LINE`，否则一次建边会留两条撤销记录。
 */

import type { MindMap, MindMapNode, MindMapTreeNode } from '../core/engine-types';
import { RELATION_MAX_RENDER_EDGES } from '../core/constants';
import {
	isRelationAnchorDir,
	type RelationAnchorDir,
	type RelationGeometry,
	type RelationPoint2D,
	type RelationRect,
	relationStateOf,
	resolveRelationGraph,
} from '../domain/relation';
import { walkTree } from '../domain/tree';
import { getRenderRoot } from './mindmap-nodes';

/** 本模块拥有的节点 data 键（清除分支遍历的就是它，勿另列一份） */
const RELATION_TARGETS_KEY = 'associativeLineTargets';
const RELATION_TEXT_KEY = 'associativeLineText';
/** 端点（只 `dir` / `range` 会参与重算，绝对坐标由引擎按节点几何现算） */
const RELATION_POINT_KEY = 'associativeLinePoint';
/** 控制点相对端点的差值 */
const RELATION_OFFSET_KEY = 'associativeLineTargetControlOffsets';
/**
 * 每条边的样式覆盖：`{ [目标 uid]: { associativeLineColor: '#rrggbb' } }`。
 *
 * 引擎 `AssociativeLine.getStyleConfig(node, toNode)` 先读这份**按目标 uid** 的
 * 覆盖、缺键才回落到节点样式（＝主题）。故它是「线色」的唯一落点；**宽度 / 虚线 /
 * 标签字号都不写**——那三项仍只由主题表达（单一来源）。
 */
const RELATION_STYLE_KEY = 'associativeLineStyle';

/** 端点锚点：方向 + 沿该边的位移（引擎 `getNodePoint` 的入参） */
interface RelationPoint {
	startPoint: { dir: RelationAnchorDir; range: number };
	endPoint: { dir: RelationAnchorDir; range: number };
}

/** 一个源节点要写进 data 的计划（`applyRelationPlan` 的入参，测试直接构造） */
export interface RelationPlan {
	/** 目标 uid（顺序 = 画线顺序） */
	targets: string[];
	/** uid → 标签（无标签的线不写） */
	texts: Record<string, string>;
	/** 每条边的端点锚点（`null` = 该边没存过几何，走自动计算） */
	points: (RelationPoint | null)[];
	/** 每条边的控制点偏移（同上） */
	offsets: ({ x: number; y: number }[] | null)[];
	/** 每条边的自定义线色（`#rrggbb`；`null` = 跟随主题） */
	colors: (string | null)[];
}

/** 引擎节点 + 它的 data 快照 + 子树（`resolveRelationGraph` 需要的形态） */
interface EngineNodeWrap {
	node: MindMapNode;
	data: Record<string, unknown>;
	children: EngineNodeWrap[];
}

/** 节点 data（`getData()` 是**活引用**，直接持有；引擎节点未就绪时给空对象） */
function dataOf(node: MindMapNode): Record<string, unknown> {
	return (node.getData?.() as Record<string, unknown> | null) ?? {};
}

/** 把引擎渲染树包成「data + children」形态（`resolveRelationGraph` 的输入） */
function wrapEngineTree(root: MindMapNode): EngineNodeWrap {
	const create = (node: MindMapNode): EngineNodeWrap => ({
		node,
		data: dataOf(node),
		children: [],
	});
	const wrapped = create(root);
	// 显式栈：树深度由文档决定，递归在超深层级上会栈溢出（与 domain/tree 同口径）
	const stack: EngineNodeWrap[] = [wrapped];
	while (stack.length > 0) {
		const current = stack.pop()!;
		const children = current.node.children ?? [];
		for (const child of children) {
			const childWrap = create(child);
			current.children.push(childWrap);
			stack.push(childWrap);
		}
	}
	return wrapped;
}

/** 端点锚点的值比较（锚点对象每轮重建，不能按引用比） */
function samePoint(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
		return false;
	}
	const left = a as RelationPoint;
	const right = b as RelationPoint;
	return (
		left.startPoint?.dir === right.startPoint?.dir &&
		left.startPoint?.range === right.startPoint?.range &&
		left.endPoint?.dir === right.endPoint?.dir &&
		left.endPoint?.range === right.endPoint?.range
	);
}

/** 控制点偏移的值比较 */
function sameOffsets(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
		return false;
	}
	return a.every((point, index) => {
		const other = b[index] as { x?: unknown; y?: unknown } | undefined;
		return (
			!!point &&
			!!other &&
			(point as { x?: unknown }).x === other.x &&
			(point as { y?: unknown }).y === other.y
		);
	});
}

/**
 * 两份「目标 uid → 样式覆盖」是否等价。
 *
 * 只比本插件写的那一个键（`associativeLineColor`）而不是整体深比较：data 是人可
 * 编辑的，别的来源可能给同一条边加键；但只要线色没变就没必要重画。
 */
function sameStyleMap(
	prev: unknown,
	next: Record<string, { associativeLineColor: string }>,
): boolean {
	if (!prev || typeof prev !== 'object') {
		return false;
	}
	const prevMap = prev as Record<string, unknown>;
	const uids = Object.keys(next);
	if (Object.keys(prevMap).length !== uids.length) {
		return false;
	}
	return uids.every((uid) => {
		const entry = prevMap[uid];
		return (
			!!entry &&
			typeof entry === 'object' &&
			(entry as { associativeLineColor?: unknown }).associativeLineColor ===
				next[uid]!.associativeLineColor
		);
	});
}

/**
 * 把一份计划写进节点 data；`null` = 该节点不再有任何联系（清除覆盖）。
 *
 * **几何优先级**：Markdown 的 `geo=` 是唯一真相——计划里有几何就照文件写；计划里
 * 没有（文件没写 `geo=`）时**保留同一个目标节点**在 data 里的几何：那可能是用户
 * 刚拖完、正文还没回写的那一轮。清掉只会让曲线在下一帧跳回；而「回到默认走法」
 * 在本插件里已不是一个概念（没有自动选路，也没有恢复自动路线的入口）。
 *
 * @returns 是否真的改动过（调用方据此避免无意义的重绘）
 */
export function applyRelationPlan(
	data: Record<string, unknown>,
	plan: RelationPlan | null,
): boolean {
	const nextTargets = plan?.targets ?? [];
	const nextTexts = plan?.texts ?? {};
	let changed = false;

	const prevTargets = Array.isArray(data[RELATION_TARGETS_KEY])
		? (data[RELATION_TARGETS_KEY] as unknown[])
		: [];
	const sameTargets =
		prevTargets.length === nextTargets.length &&
		prevTargets.every((value, index) => value === nextTargets[index]);
	if (nextTargets.length === 0) {
		if (RELATION_TARGETS_KEY in data) {
			delete data[RELATION_TARGETS_KEY];
			changed = true;
		}
	} else if (!sameTargets) {
		data[RELATION_TARGETS_KEY] = [...nextTargets];
		changed = true;
	}

	// 端点 / 控制点：文件里有 `geo=` 时一律以文件为准；没有时沿用**同一个目标
	// 节点**在 data 里已有的几何（用户刚拖完 / 引擎按节点几何现算的默认端点），
	// 不主动清除——见函数注释。
	//
	// 旧值必须按**目标 uid** 反查再取：两个数组是按 `associativeLineTargets` 的
	// 下标对齐的，目标集合一变（删一条边 / 插入一条带 `geo=` 的边）下标就不再
	// 指向同一目标；按下标复用会把这标的几何安到另一条边上，还会经
	// `features/view-node-relation` 的几何回写把错误几何写进文件。
	const prevPoints = Array.isArray(data[RELATION_POINT_KEY])
		? (data[RELATION_POINT_KEY] as unknown[])
		: [];
	const prevOffsets = Array.isArray(data[RELATION_OFFSET_KEY])
		? (data[RELATION_OFFSET_KEY] as unknown[])
		: [];
	const prevIndexOf = new Map<string, number>();
	prevTargets.forEach((uid, index) => {
		if (typeof uid === 'string' && uid) {
			prevIndexOf.set(uid, index);
		}
	});
	/** 同一目标在旧数组里的那一项；找不到（新加入的边）= null */
	const previousOf = (uid: string, list: unknown[]): unknown => {
		const index = prevIndexOf.get(uid);
		return index === undefined ? null : (list[index] ?? null);
	};
	const nextPoints = nextTargets.map(
		(uid, index) => plan?.points[index] ?? previousOf(uid, prevPoints),
	);
	const nextOffsets = nextTargets.map(
		(uid, index) => plan?.offsets[index] ?? previousOf(uid, prevOffsets),
	);
	// **结构化**比较（不是引用比较）：计划里的锚点每轮都是新对象（`buildPlans`
	// 按文件重建），按引用比会把每一帧都判成"变过"→ 无休止重画
	const geometryChanged =
		prevPoints.length !== nextPoints.length ||
		prevOffsets.length !== nextOffsets.length ||
		nextPoints.some((value, index) => !samePoint(value, prevPoints[index])) ||
		nextOffsets.some((value, index) => !sameOffsets(value, prevOffsets[index]));
	if (geometryChanged) {
		// 全为 null 时删键而不是写一串 null：与 `associativeLineTargets` 的下标
		// 对齐关系里，"看着有、其实没有"的歧义最难排查。删/写都要记 `changed`
		// ——不记就会让「文件里没有 geo=」（最常见的一档）每轮同步都判成"变过"，
		// 于是每次渲染都全量重画线条（且顺带清掉激活态）。
		for (const [key, list] of [
			[RELATION_POINT_KEY, nextPoints],
			[RELATION_OFFSET_KEY, nextOffsets],
		] as const) {
			if (list.some((value) => value !== null)) {
				data[key] = list;
				changed = true;
			} else if (key in data) {
				delete data[key];
				changed = true;
			}
		}
	}

	const prevTexts = data[RELATION_TEXT_KEY];
	const nextKeys = Object.keys(nextTexts);
	const sameTexts =
		prevTexts !== null &&
		typeof prevTexts === 'object' &&
		nextKeys.length === Object.keys(prevTexts).length &&
		nextKeys.every(
			(key) => (prevTexts as Record<string, unknown>)[key] === nextTexts[key],
		);
	if (nextKeys.length === 0) {
		if (RELATION_TEXT_KEY in data) {
			delete data[RELATION_TEXT_KEY];
			changed = true;
		}
	} else if (!sameTexts) {
		data[RELATION_TEXT_KEY] = { ...nextTexts };
		changed = true;
	}

	// 线色：整张映射**整体重建**（Markdown 是唯一真相）——没有着色的边不占键，
	// 所以「删掉 color 段」在下一轮同步里自然回落主题
	const nextStyles: Record<string, { associativeLineColor: string }> = {};
	nextTargets.forEach((uid, index) => {
		const color = plan?.colors[index] ?? null;
		if (color) {
			nextStyles[uid] = { associativeLineColor: color };
		}
	});
	if (Object.keys(nextStyles).length === 0) {
		if (RELATION_STYLE_KEY in data) {
			delete data[RELATION_STYLE_KEY];
			changed = true;
		}
	} else if (!sameStyleMap(data[RELATION_STYLE_KEY], nextStyles)) {
		data[RELATION_STYLE_KEY] = nextStyles;
		changed = true;
	}
	return changed;
}

/** 引擎节点 → 节点盒（`left/top/width/height` 是内部字段，收口在本层） */
function boxOf(node: MindMapNode): RelationRect | null {
	const box = node as unknown as Partial<RelationRect>;
	if (
		typeof box.left !== 'number' ||
		typeof box.top !== 'number' ||
		typeof box.width !== 'number' ||
		typeof box.height !== 'number' ||
		box.width <= 0 ||
		box.height <= 0
	) {
		return null;
	}
	return {
		left: box.left,
		top: box.top,
		width: box.width,
		height: box.height,
	};
}

/** 引擎画布层的**结构性**形态（`draw` / `el` 不在 d.cts 声明面内） */
interface RelationCanvasHost {
	el?: HTMLElement;
	draw?: {
		node?: SVGGElement;
		transform?: () => {
			scaleX?: unknown;
			scaleY?: unknown;
			translateX?: unknown;
			translateY?: unknown;
		};
	};
}

/**
 * 引擎**内容坐标层**（`draw` 组）：手绘锚定的 overlay 挂在这里，随缩放/
 * 平移自动跟随，且不会被 `clearDraw()`（只清四个子容器）清掉。
 */
export function relationCanvasLayer(mindMap: MindMap | null): SVGGElement | null {
	return (
		(mindMap as unknown as RelationCanvasHost | null)?.draw?.node ?? null
	);
}

/** 节点盒（布局/内容坐标）——锚定几何的输入，`null` = 引擎节点尚未布局 */
export function relationNodeBox(node: MindMapNode): RelationRect | null {
	return boxOf(node);
}

/**
 * 屏幕坐标 → 内容坐标（`geo` 与会话几何一律用内容坐标，缩放后重开仍正确）。
 *
 * 公式与引擎 `draw` 组的 transform 同源：`screen = content * scale + translate`，
 * 再减去引擎容器的 `getBoundingClientRect()` 左上角（`toPos` 的口径）。
 */
export function relationClientToContent(
	mindMap: MindMap | null,
	clientX: number,
	clientY: number,
): RelationPoint2D | null {
	const host = mindMap as unknown as RelationCanvasHost | null;
	const el = host?.el;
	const transform = host?.draw?.transform?.();
	if (!el || !transform) {
		return null;
	}
	const scaleX = Number(transform.scaleX);
	const scaleY = Number(transform.scaleY);
	const translateX = Number(transform.translateX);
	const translateY = Number(transform.translateY);
	if (
		!Number.isFinite(scaleX) ||
		!Number.isFinite(scaleY) ||
		!Number.isFinite(translateX) ||
		!Number.isFinite(translateY) ||
		scaleX <= 0 ||
		scaleY <= 0
	) {
		return null;
	}
	const rect = el.getBoundingClientRect();
	return {
		x: (clientX - rect.left - translateX) / scaleX,
		y: (clientY - rect.top - translateY) / scaleY,
	};
}

/** 由关系图算出「源节点 → 计划」（`maxEdges` 已在图解析里截断） */
function buildPlans<N extends { data?: unknown }>(
	graph: ReturnType<typeof resolveRelationGraph<N>>,
): Map<N, RelationPlan> {
	const plans = new Map<N, RelationPlan>();
	for (const edge of graph.edges) {
		const toData = (edge.to.data ?? {}) as Record<string, unknown>;
		const uid = typeof toData.uid === 'string' ? toData.uid : '';
		if (!uid) {
			continue;
		}
		const plan = plans.get(edge.from) ?? {
			targets: [],
			texts: {},
			points: [],
			offsets: [],
			colors: [],
		};
		if (!plan.targets.includes(uid)) {
			plan.targets.push(uid);
			if (edge.ref.label) {
				plan.texts[uid] = edge.ref.label;
			}
			// 几何按**同一下标**对齐 targets（引擎按 targetIndex 取值）。
			// 唯一来源是文件里的 `geo=`（用户手绘）——没有就交回引擎现算端点。
			const geo = edge.ref.geo;
			plan.points.push(
				geo
					? {
							startPoint: { dir: geo.fromDir, range: geo.fromRange },
							endPoint: { dir: geo.toDir, range: geo.toRange },
						}
					: null,
			);
			plan.offsets.push(geo ? [{ ...geo.ctl1 }, { ...geo.ctl2 }] : null);
			// 线色同理：文件里的 `color=` 是唯一来源，没有就跟随主题
			plan.colors.push(edge.ref.color ?? null);
		}
		plans.set(edge.from, plan);
	}
	return plans;
}

/**
 * 引擎创建**之前**把联系写进 data 树（首帧即带线，不额外渲染一次）。
 *
 * 视图加载与 ```mindmap 嵌入两个创建入口都必须在 `createMindMap` 前调用；
 * 引擎 `MindMapNode.handleData` 会克隆数据，创建后再改这棵树不再生效。
 */
export function applyRelationsToTree(tree: MindMapTreeNode): void {
	const graph = resolveRelationGraph(tree, RELATION_MAX_RENDER_EDGES);
	// 没有任何关系时整棵树零改动（绝大多数文档走这条快路径）
	if (graph.edges.length === 0 && graph.ids.size === 0) {
		return;
	}
	const plans = buildPlans(graph);
	walkTree(tree, (node) => {
		const data = node.data as Record<string, unknown> | undefined;
		if (data) {
			applyRelationPlan(data, plans.get(node) ?? null);
		}
	});
}

/**
 * 引擎创建**之后**按实时节点树重算联系（文本编辑 / 插入 / 撤销都会改变指令）。
 *
 * 直接写节点 data（不 execCommand）：这是派生自 Markdown 的显示状态，不该进入
 * 命令历史，也不该触发 `data_change`（否则保存管线与同步逻辑互相唤醒）。
 *
 * 引擎的 `AssociativeLine` 在 `addPlugin` 时就把 `renderAllLines` 绑到了
 * `node_tree_render_end`，**早于**本函数——所以我们改完 data 必须显式补画一次，
 * 否则新加/删掉的线要等下一次渲染才对齐。
 *
 * @returns 是否有节点数据真的变了（调用方据此决定是否额外渲染）
 */
export function syncLiveRelations(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return false;
	}
	const wrapped = wrapEngineTree(root);
	const graph = resolveRelationGraph(wrapped, RELATION_MAX_RENDER_EDGES);
	const plans = buildPlans(graph);
	let changed = false;
	walkTree(wrapped, (node) => {
		if (applyRelationPlan(node.data, plans.get(node) ?? null)) {
			changed = true;
		}
	});
	if (changed) {
		redrawRelationLines(mindMap);
	}
	return changed;
}

/**
 * 读节点 data 里第 `index` 条边的**几何**（端点锚点 + 控制点偏移）。
 *
 * 供「拖完端点/控制点 → 写回 Markdown」使用：引擎把拖动结果存在两个数组的
 * **同一下标**（与 `associativeLineTargets` 对齐）。两数组缺一即返回 undefined
 * ——只有一半数据时无法还原曲线，交给引擎自动计算（不猜）。
 *
 * 私有：唯一消费者是同文件的 `engineRelationsOf`（反向同步的读取面）。
 */
function relationGeometryAt(
	node: MindMapNode,
	index: number,
): RelationGeometry | undefined {
	const data = dataOf(node);
	const points = Array.isArray(data[RELATION_POINT_KEY])
		? data[RELATION_POINT_KEY]
		: [];
	const offsets = Array.isArray(data[RELATION_OFFSET_KEY])
		? data[RELATION_OFFSET_KEY]
		: [];
	const point = points[index] as
		| {
				startPoint?: { dir?: unknown; range?: unknown };
				endPoint?: { dir?: unknown; range?: unknown };
		  }
		| undefined;
	const offset = offsets[index] as { x?: unknown; y?: unknown }[] | undefined;
	if (
		!point?.startPoint ||
		!point.endPoint ||
		!Array.isArray(offset) ||
		offset.length < 2
	) {
		return undefined;
	}
	const { startPoint, endPoint } = point;
	const readNumber = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
	const fromDir = isRelationAnchorDir(startPoint.dir) ? startPoint.dir : null;
	const toDir = isRelationAnchorDir(endPoint.dir) ? endPoint.dir : null;
	const fromRange = readNumber(startPoint.range);
	const toRange = readNumber(endPoint.range);
	const c1 = { x: readNumber(offset[0]?.x), y: readNumber(offset[0]?.y) };
	const c2 = { x: readNumber(offset[1]?.x), y: readNumber(offset[1]?.y) };
	if (
		!fromDir ||
		!toDir ||
		fromRange === null ||
		toRange === null ||
		c1.x === null ||
		c1.y === null ||
		c2.x === null ||
		c2.y === null
	) {
		return undefined;
	}
	return {
		fromDir,
		fromRange,
		toDir,
		toRange,
		ctl1: { x: c1.x, y: c1.y },
		ctl2: { x: c2.x, y: c2.y },
	};
}

/**
 * 引擎侧一条出边**可回读的部分**：目标 uid + 几何（没拖过则无几何）。
 *
 * **没有标签**：线标签的唯一真相是正文的 `%%rel%%`，data 里的
 * `associativeLineText` 由本模块写出，回读只会形成第二份口径。
 */
export interface EngineRelationEdge {
	uid: string;
	geo?: RelationGeometry;
}

/**
 * 读节点 data 里各条出边的几何（按 `associativeLineTargets` 顺序）。
 *
 * 反向同步（拖动端点/控制点后写回 Markdown）的唯一读取面：`associativeLine*`
 * 四个键只在本文件出现（硬规则 2）。
 */
export function engineRelationsOf(node: MindMapNode): EngineRelationEdge[] {
	const data = dataOf(node);
	const targets = Array.isArray(data[RELATION_TARGETS_KEY])
		? (data[RELATION_TARGETS_KEY] as unknown[])
		: [];
	const edges: EngineRelationEdge[] = [];
	targets.forEach((value, index) => {
		if (typeof value !== 'string' || !value) {
			return;
		}
		const geo = relationGeometryAt(node, index);
		edges.push({ uid: value, ...(geo ? { geo } : {}) });
	});
	return edges;
}

/**
 * 联系渲染插件（引擎 `AssociativeLine` 实例）的**结构性访问面**。
 *
 * 只列出本文件消费的成员（`renderAllLines` / `lineList` / `activeLine` /
 * `clearActiveLine`）；插件未注册时整体为 null，各处一律可选链调用——与
 * `removeEngineShortcut` 同口径，不做类型断言穿透声明面。
 */
interface AssociativeLinePlugin {
	/** 已画出的线，条目形态 `[path, clickPath, text, from, to]`（引擎私有形态，只在本文件读） */
	lineList?: unknown;
	/** 当前激活的线，条目形态 `[path, clickPath, text, from, to, markerPath]` */
	activeLine?: unknown;
	renderAllLines?: () => void;
	clearActiveLine?: () => void;
}

/** 取联系渲染插件实例（未注册时为 null） */
function associativeLinePlugin(
	mindMap: MindMap | null,
): AssociativeLinePlugin | null {
	return (
		(mindMap as unknown as { associativeLine?: AssociativeLinePlugin } | null)
			?.associativeLine ?? null
	);
}

/**
 * 重画全部联系线（引擎插件实例方法，结构性访问；插件未注册时静默跳过）。
 *
 * 为什么需要它：插件的 `renderAllLines` 绑在 `node_tree_render_end` 上（先于我们
 * 的同步执行）。重发事件会递归进自己的同步，故直接调插件方法。
 *
 * 私有：唯一消费者是同文件的 `syncLiveRelations`（写完 data 后补画）。
 */
function redrawRelationLines(mindMap: MindMap | null): void {
	associativeLinePlugin(mindMap)?.renderAllLines?.();
}

/** 渲染根（引擎未就绪时 null——所有收集函数的共同前置） */
function renderRootOf(mindMap: MindMap | null): MindMapNode | null {
	return mindMap ? getRenderRoot(mindMap) : null;
}

/**
 * 当前图里已被占用的联系 id 集合（生成新 id 时用来避让冲突）。
 *
 * 只遍历渲染树、只读 data，不构造完整关系图——建边时我们只需要「已有哪些 id」。
 */
export function collectRelationIds(mindMap: MindMap | null): Set<string> {
	const ids = new Set<string>();
	const root = renderRootOf(mindMap);
	if (!root) {
		return ids;
	}
	walkTree(root, (node) => {
		const id = relationStateOf(dataOf(node)).id;
		if (id) {
			ids.add(id);
		}
	});
	return ids;
}

/**
 * 全树里仍被 `%%rel%%` 指向的 id 集合（`collectRelationIds` 的对偶：一个收身份、
 * 一个收引用）。
 *
 * 唯一消费者是 `features/view-node-relation` 的**孤儿 id 回收**：删边 / 删节点
 * 之后，`%%id%%` 若已无任何入边就一并摘掉（否则正文里永久留一条没人引用的
 * `%%id:xxxxxx%%`，还会出现在该节点的原文编辑框预填里）。
 *
 * @param except 调用方**即将改写**的源节点：它那条边此刻还在 data 里，须先排除
 */
export function collectRelationTargets(
	mindMap: MindMap | null,
	except?: MindMapNode | null,
): Set<string> {
	const targets = new Set<string>();
	const root = renderRootOf(mindMap);
	if (!root) {
		return targets;
	}
	walkTree(root, (node) => {
		if (node === except) {
			return;
		}
		for (const ref of relationStateOf(dataOf(node)).refs) {
			targets.add(ref.target);
		}
	});
	return targets;
}

/** 一次「双击选中了某条联系线」的命中结果 */
export interface RelationLineHit {
	from: MindMapNode;
	to: MindMapNode;
}

/** 取 svg.js 元素背后的 DOM 节点（跨 window 安全：按能力判，不用 instanceof Node） */
function domNodeOf(value: unknown): Node | null {
	const node = (value as { node?: unknown } | null)?.node;
	if (!node || typeof node !== 'object') {
		return null;
	}
	const candidate = node as Partial<Node>;
	return typeof candidate.contains === 'function' ? (node as Node) : null;
}

/**
 * 事件目标是否落在某条联系线上；命中返回它的两端节点。
 *
 * 用于「双击改标签」的**捕获拦截**：引擎插件在 `clickPath.dblclick` 上挂了内置
 * 文本框（只改 data、不进文件），不拦就会"改了没保存"。
 */
export function relationLineAt(
	mindMap: MindMap | null,
	target: EventTarget | null,
): RelationLineHit | null {
	if (!mindMap || !target) {
		return null;
	}
	const list = associativeLinePlugin(mindMap)?.lineList;
	if (!Array.isArray(list)) {
		return null;
	}
	const eventNode = target as Node;
	for (const entry of list) {
		if (!Array.isArray(entry)) {
			continue;
		}
		// 插件内部条目形态：[path, clickPath, text, from, to]
		const from = entry[3] as MindMapNode | undefined;
		const to = entry[4] as MindMapNode | undefined;
		if (!from || !to) {
			continue;
		}
		const hit = entry.some((element) => {
			const dom = domNodeOf(element);
			return dom !== null && (dom === eventNode || dom.contains(eventNode));
		});
		if (hit) {
			return { from, to };
		}
	}
	return null;
}

/**
 * 当前被引擎**激活**的那条联系线（点线之后插件记录在 `activeLine` 里的那一条）。
 *
 * 为什么需要它：`Delete` / `Backspace` 的落点是**视图 scope**（`features/view-hotkeys`），
 * 那里只有按键、没有事件目标 ⇒ 不能像双击 / 右键那样按 `event.target` 命中，只能
 * 问引擎「此刻选中了哪条线」。条目形态与 `lineList` 同族（多一个 `markerPath` 尾项）。
 */
export function activeRelationLine(
	mindMap: MindMap | null,
): RelationLineHit | null {
	const active = associativeLinePlugin(mindMap)?.activeLine;
	if (!Array.isArray(active)) {
		return null;
	}
	// 插件内部条目形态：[path, clickPath, text, from, to, markerPath]
	const from = active[3] as MindMapNode | undefined;
	const to = active[4] as MindMapNode | undefined;
	return from && to ? { from, to } : null;
}

/**
 * 取消联系线的激活态（高亮描边 + 控制点）。
 *
 * 插件的 `renderAllLines` 开头也会清一次，但那是**下一次渲染**的事：删线写盘后
 * 若渲染被延后（大图异步渲染、`render` 排队），高亮会停在一条已经不存在的线上。
 * 删线时先显式清一次，写盘失败也不会留下「看起来已选中的孤儿线」。
 */
export function clearActiveRelationLine(mindMap: MindMap | null): void {
	associativeLinePlugin(mindMap)?.clearActiveLine?.();
}
