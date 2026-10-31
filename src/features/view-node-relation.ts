/**
 * 节点「联系」（关系连线）：建边 / 删边 / 改标签 / 删节点清入边 / 点选模式。
 *
 * ## 一切以 Markdown 为准
 * 建一条联系**只改两行原文**（源节点的 `%%rel:…%%` + 目标节点的 `%%id:…%%`），
 * 然后交给既有的 raw 通道 `applyRawNodeContents`：重解析 → 样式/关系同步 →
 * 保存调度 → 提交通知全部复用。引擎 `AssociativeLine` 只当**渲染器**，我们不调
 * `ADD_ASSOCIATIVE_LINE`（那会让一次建边留下「引擎命令 + raw 写入」两条历史，
 * Ctrl+Z 要按两次）。
 *
 * ## 入口分工（2026-10-30 用户裁决：一切从**线**出发，节点菜单只留「联系」）
 * - 建边：右键**节点** →「联系」→ 点目标节点（`features/view-context-menu`
 *   只放一个直落条目，不套二级菜单，也不与布局 / 配色同组）；
 * - 删边：右键**线**本身（本文件的捕获拦截）→「删除联系」；或点中线使其激活
 *   （引擎内置行为）后按 `Delete` / `Backspace`（`features/view-hotkeys`）；
 * - 改标签：双击线，或右键线 →「编辑联系标签」。
 *
 * 两条删除都落到同一个 `removeRelation`。`Delete` 这条是**必需**的：引擎插件自己
 * 也绑了同键（`AssociativeLine.removeLine`），但它只发 `SET_NODE_DATA` 改 data——
 * 本插件以 Markdown 为唯一真相，下一轮 `syncLiveRelations` 会照正文把线画回来，
 * 用户观感就是「线删不掉」。那份绑定已由 `createMindMap` 显式摘除
 * （`removeEngineShortcut('Del|Backspace')`），删除因此只有本文件这一条通道。
 *
 * ## 为什么改两行要合并成一次提交
 * 逐行提交会让 5000 节点的图渲染两遍、存两遍、记两条历史。批量入口把「渲染 /
 * 保存 / 历史」各收敛为一次（与多选改色同机理，但不再依赖 100ms 防抖窗口）。
 *
 * ## 删除的两条语义闭包：入边 + 孤儿 id
 * 删除节点会让指向它的 `%%rel%%` 变成悬空引用（读侧不画线、但文件里留垃圾），
 * 也会让**它曾指向的目标**失去最后一条入边。两种残渣都随删除**同一次**提交：
 * - 入边：摘掉别人指向它的 ref；
 * - 孤儿 id：`%%id%%` 是懒加的（只有被指向才发身份），没人指向就一并摘掉——
 *   `removeRelation`（删线）与 `stripInboundRelations`（删节点）走**同一份判定**
 *   （`collectRelationTargets`），且只在该 id 确实再无入边时动手（多入边节点上
 *   的 id 必须留）。
 * 文件里手工写下的悬空边 / 手写 id **不自动清理**（那行没被编辑，静默改动会破坏
 * 逐字保真）；这里清理的都是「本次删除直接造成」的残渣。
 */

import { Menu, Notice, type App } from 'obsidian';
import type { MindMapNode } from '../core/engine-types';
import type { MdNodeData } from '../core/node-data';
import {
	generateRelationId,
	RELATION_GEOMETRY_PERSIST_DELAY_MS,
} from '../core/constants';
import { t } from '../core/i18n';
import {
	applyDirectiveLine,
	relationStateOf,
	renderDirectiveLine,
	sameRelationGeometry,
	type RelationGeometry,
	type RelationRef,
	type RelationState,
} from '../domain/relation';
import { walkTree } from '../domain/tree';
import {
	activeRelationLine,
	clearActiveRelationLine,
	collectRelationIds,
	collectRelationTargets,
	engineRelationsOf,
	getRenderRoot,
	markNodeNeedLayout,
	relationLineAt,
	type RelationLineHit,
} from '../engine/mindmap';
import { composeNodeContent } from '../markdown/md-serialize';
import { applyRawToNode } from '../markdown/md-line-write';
import { applyRawNodeContents } from './node-inline-editor';
import type { MindMapViewContext, ViewNodeEditContext } from './view-context';
import {
	cancelRelationAnchor,
	startRelationAnchor,
	type RelationAnchorHost,
} from './view-relation-anchor';
import {
	addCascadingMenu,
	addCustomColorItem,
	showExclusiveMenu,
} from '../ui/menu-submenu';
import { openRelationLabelModal } from '../ui/modal-relation-label';
import { nodeColorOptions } from './view-node-color';

/** 点选模式（「联系」后等待用户点目标节点）；按视图持有 */
const pendingPick = new WeakMap<object, MindMapNode>();
/** 点选模式的提示（选中目标后立刻收起，避免与新阶段的提示叠在一起） */
const pickNotice = new WeakMap<object, Notice>();

/** 收起「点击目标节点」提示（测试环境的 Notice 桩可能没有 hide） */
function hidePickNotice(view: object): void {
	const notice = pickNotice.get(view);
	pickNotice.delete(view);
	(
		notice as unknown as { hide?: () => void } | undefined
	)?.hide?.();
}

/** 生成本文件内未被占用的新 id */
function nextRelationId(view: ViewNodeEditContext): string {
	return generateRelationId(collectRelationIds(view.mindMap));
}

/**
 * 节点的联系 id（正文里的 `%%id:xxxxxx%%`；没有则 null）。
 *
 * 画布上的线按**引擎 uid** 连，正文里的边按**联系 id** 记；两者之间唯一的翻译
 * 就是目标节点自己声明的 id。所有「线 → 该改哪一行」的入口（双击改标签、右键
 * 删线、Delete 删线）都从这里取，勿各自再解一遍 data。
 */
function relationIdOf(node: MindMapNode): string | null {
	return relationStateOf(node.getData() as MdNodeData).id;
}

/** 把一个节点的「新关系状态」写回原文（不改 data：data 由重解析派生） */
function rawWithState(
	data: MdNodeData,
	app: App,
	state: RelationState,
): string {
	const raw = composeNodeContent(data, app);
	return applyDirectiveLine(raw, renderDirectiveLine(state));
}

/** root（虚拟文档节点）没有正文行，指令无处落笔 */
function rejectRoot(
	view: ViewNodeEditContext,
	...nodes: MindMapNode[]
): boolean {
	if (nodes.some((node) => node.isRoot)) {
		new Notice(t(view.lang, 'nodeRelation.rootUnsupported'));
		return true;
	}
	return false;
}

/**
 * 建立一条联系 `from → to`（带手绘几何）。
 *
 * `geo` 由 {@link startRelationAnchor} 的两次落定产出，写进 `%%rel%%` 的第三段；
 * 之后 `syncLiveRelations` 一律以文件里的 `geo=` 为准（本插件没有自动选路）。
 * 标签一律为空——新流程先建边、再双击线补标签。
 *
 * @returns 是否真的写了文件（已存在同一目标 / 端点非法时 false）
 */
function createRelation(
	view: ViewNodeEditContext,
	from: MindMapNode,
	to: MindMapNode,
	geo?: RelationGeometry,
): boolean {
	if (!view.mindMap || from === to || rejectRoot(view, from, to)) {
		return false;
	}
	const fromData = from.getData() as MdNodeData;
	const toData = to.getData() as MdNodeData;
	const fromState = relationStateOf(fromData);
	const toState = relationStateOf(toData);
	const targetId = toState.id ?? nextRelationId(view);
	if (fromState.refs.some((ref) => ref.target === targetId)) {
		return false;
	}

	const ref: RelationRef = {
		target: targetId,
		label: '',
		...(geo ? { geo } : {}),
	};
	const entries: { node: MindMapNode; raw: string }[] = [
		{
			node: from,
			raw: rawWithState(fromData, view.app, {
				id: fromState.id,
				refs: [...fromState.refs, ref],
			}),
		},
	];
	// 目标节点还没有 id：一并补上（懒加 —— 只有被指向的节点才需要身份）
	if (!toState.id) {
		entries.push({
			node: to,
			raw: rawWithState(toData, view.app, {
				id: targetId,
				refs: toState.refs,
			}),
		});
	}
	// 只加注释，不触发「中心主题改名 / 自动拆链」等提交后编排
	applyRawNodeContents(view, entries, { afterCommit: false });
	return true;
}

/**
 * 删除一条出边 `from → to`。
 *
 * 改的可能是**两行**：源节点的 `%%rel%%`，以及——当这条边是目标节点的**最后一条
 * 入边**时——目标节点的 `%%id%%`。`%%id%%` 是懒加的（只有被指向才需要身份），
 * 没人指向了就是正文垃圾：它留在文件里，还会出现在该节点的原文编辑框预填里
 * （用户观感「节点里有残留信息」）。目标仍有别的入边时 id 必须保留。
 *
 * 两行合并成**一次**提交（一次渲染 / 一次保存 / 一条撤销）。
 */
function removeRelation(
	view: ViewNodeEditContext,
	from: MindMapNode,
	to: MindMapNode,
): boolean {
	const targetId = relationIdOf(to);
	if (!targetId) {
		return false;
	}
	const data = from.getData() as MdNodeData;
	const state = relationStateOf(data);
	const refs = state.refs.filter((ref) => ref.target !== targetId);
	if (refs.length === state.refs.length) {
		return false;
	}
	const entries: { node: MindMapNode; raw: string }[] = [
		{ node: from, raw: rawWithState(data, view.app, { id: state.id, refs }) },
	];
	// 孤儿 id 回收：排除源节点后，全树再没有任何 `%%rel%%` 指向它
	if (!collectRelationTargets(view.mindMap, from).has(targetId)) {
		const toData = to.getData() as MdNodeData;
		const toState = relationStateOf(toData);
		if (toState.id === targetId) {
			entries.push({
				node: to,
				raw: rawWithState(toData, view.app, { id: null, refs: toState.refs }),
			});
		}
	}
	applyRawNodeContents(view, entries, { afterCommit: false });
	return true;
}

/** 按目标 id 取一条出边（不存在返回 null）；「线 → 该改哪一行」的取数口 */
function relationRefOf(node: MindMapNode, targetId: string): RelationRef | null {
	return (
		relationStateOf(node.getData() as MdNodeData).refs.find(
			(ref) => ref.target === targetId,
		) ?? null
	);
}

/**
 * 给一条联系设置**线色**（`null` = 默认：删掉 `color=` 段，回落主题）。
 *
 * 与删边 / 改标签同一条通道：只改源节点那一行的 `%%rel%%`，重解析 → 样式同步 →
 * 保存调度全部复用（`applyRawNodeContents`）。线色是**派生数据**：真正画到屏上的
 * 是 `engine/mindmap-relations` 按 `color=` 写进 `associativeLineStyle` 的值。
 *
 * `geo` / 标签原样带走（只换颜色，不动用户手绘的形状）。
 *
 * @returns 是否真的改了（边不存在 / 同色 → false，不写盘）
 */
function setRelationColor(
	view: ViewNodeEditContext,
	from: MindMapNode,
	targetId: string,
	color: string | null,
): boolean {
	const data = from.getData() as MdNodeData;
	const state = relationStateOf(data);
	let changed = false;
	const refs = state.refs.map((ref) => {
		if (ref.target !== targetId) {
			return ref;
		}
		if ((ref.color ?? null) === color) {
			return ref;
		}
		changed = true;
		// 显式重建而不是解构剔除：`color` 是唯一要动的键，其余（标签 / 几何）逐字带走
		const next: RelationRef = {
			target: ref.target,
			label: ref.label,
			...(ref.geo ? { geo: ref.geo } : {}),
		};
		return color ? { ...next, color } : next;
	});
	if (!changed) {
		return false;
	}
	applyRawNodeContents(
		view,
		[{ node: from, raw: rawWithState(data, view.app, { id: state.id, refs }) }],
		{ afterCommit: false },
	);
	return true;
}

/**
 * 删除画布上**当前激活**的那条线（`Delete` / `Backspace` 的落点）。
 *
 * 只认「已激活」（点过线、屏上有高亮与控制点），不按指针位置猜：键盘事件没有
 * 落点信息，而「删掉用户没选中的东西」是不可接受的意外。
 *
 * @returns 是否消费了本次按键（true = 屏上确有一条激活的线，调用方应吞键）
 */
export function removeActiveRelationLine(view: ViewNodeEditContext): boolean {
	const hit = activeRelationLine(view.mindMap);
	if (!hit) {
		return false;
	}
	// 先摘高亮与控制点：它们属于「即将消失的元素」。写盘若失败（或正文里本就没有
	// 对应 ref），下一次派生同步会把线画回来——留着的选中态会指向一个看起来已删掉
	// 的旧元素，比「没选中」更让人困惑
	clearActiveRelationLine(view.mindMap);
	removeRelation(view, hit.from, hit.to);
	return true;
}

/** 改一条出边的标签（空串 = 去掉标签） */
function updateRelationLabel(
	view: ViewNodeEditContext,
	from: MindMapNode,
	targetId: string,
	label: string,
): boolean {
	const data = from.getData() as MdNodeData;
	const state = relationStateOf(data);
	let changed = false;
	const refs = state.refs.map((ref) => {
		if (ref.target !== targetId || ref.label === label) {
			return ref;
		}
		changed = true;
		// 必须带上原 ref 的所有字段：`geo` 是用户拖过的形状，改标签不能把它丢掉
		return { ...ref, label };
	});
	if (!changed) {
		return false;
	}
	applyRawNodeContents(
		view,
		[{ node: from, raw: rawWithState(data, view.app, { id: state.id, refs }) }],
		{ afterCommit: false },
	);
	return true;
}

/**
 * 删除节点**之后**清掉全树指向它的边（只改 data，不渲染、不记历史）。
 *
 * 两件事，都是「删除」的语义闭包：
 * 1. 入边：指向它的 `%%rel%%` 变成悬空引用（读侧不画线、但文件里留垃圾）；
 * 2. 孤儿 id：它自己那条出边（随节点一起消失）指向的目标，若因此不再有任何入边，
 *    目标上的 `%%id%%` 一并摘掉——与 {@link removeRelation} 同一份判定。
 *
 * 为什么只改 data：删除本身（`execCommand(REMOVE_NODE)`）已经在历史里留了
 * 「删除前」的快照，把入边的清除**并进那一步**，用户按一次 Ctrl+Z 就能同时拿回
 * 节点与它的入边。若这里再记一条快照，撤销要按两次、且中间态是"节点没了但
 * 别人还指向它"。
 *
 * 调用约定：调用方（`deleteActiveNode`）负责随后的 `scheduleSave()`；那一刻的
 * 数据已经定稿，而画布上的线由删除那次渲染负责（目标缺失的线本来就不画）。
 *
 * ⚠ **实例树不等于数据树**：`REMOVE_NODE` 只把节点从 `parent.nodeData.children`
 * 摘掉（vendor `removeFromParentNodeData`），实例树要等 **`render()`** 才更新——
 * 也就是说本函数运行在「数据已删、实例还在」的那一拍里。故被删节点必须按**对象
 * 身份**显式排除（否则它自己那条出边仍会被算作「还有人指向」，孤儿 id 永远留着；
 * 2026-10-30 实机踩过：删线回收生效、删节点回收不生效）。
 *
 * @param deleted `state` = 被删节点**删除前**的关系状态（`id` 是它的入边 id，
 *                `refs` 是它的出边）；`node` = 它的实例（用于身份排除）
 */
export function stripInboundRelations(
	view: ViewNodeEditContext,
	deleted: { node: MindMapNode; state: RelationState },
): void {
	const mindMap = view.mindMap;
	const { node: deletedNode, state: deletedState } = deleted;
	if (
		!mindMap ||
		(!deletedState.id && deletedState.refs.length === 0)
	) {
		return;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return;
	}
	// 引用快照要排除被删节点自己（它此刻仍在实例树上，见上方 ⚠）
	const orphaned = new Set(deletedState.refs.map((ref) => ref.target));
	const stillReferenced = collectRelationTargets(mindMap, deletedNode);
	walkTree(root, (node) => {
		if (node === deletedNode) {
			return;
		}
		const data = node.getData() as MdNodeData;
		const state = relationStateOf(data);
		let id = state.id;
		let refs = state.refs;
		let changed = false;
		if (
			deletedState.id &&
			refs.some((ref) => ref.target === deletedState.id)
		) {
			refs = refs.filter((ref) => ref.target !== deletedState.id);
			changed = true;
		}
		if (id !== null && orphaned.has(id) && !stillReferenced.has(id)) {
			id = null;
			changed = true;
		}
		if (!changed) {
			return;
		}
		applyRawToNode(data, rawWithState(data, view.app, { id, refs }));
		markNodeNeedLayout(node);
	});
}

/**
 * 最近一次画布**真实指针手势**的时间戳（按视图）。
 *
 * 与 `geometryTimers` 同理不能用模块级变量：popout 里的另一个视图点一下画布，
 * 就会给本视图的「刚拖过」闸门开后门，把引擎现算的几何写进本视图的文件。
 */
const gestureAt = new WeakMap<object, number>();

/** 手势窗口：`data_change` 只有落在这个窗口内才回写（拖完到落盘最多 2s） */
const GESTURE_WINDOW_MS = 2000;

/** 在画布上记录一次指针手势（capture：引擎 stopPropagation 也拦不住） */
function noteRelationCanvasGesture(view: object): void {
	gestureAt.set(view, Date.now());
}

/**
 * 几何回写防抖计时器（**按视图**，见 `RELATION_GEOMETRY_PERSIST_DELAY_MS`）。
 *
 * 不能用一个模块级变量：popout 里的第二个视图调动拖线会**清掉**第一个视图的
 * 待写几何——那份拖动结果从此只存在于 data 里，保存一次就丢。视图是弱引用键，
 * 关闭后按下 `teardownRelationInteraction` 收尾。
 */
const geometryTimers = new WeakMap<object, number>();

/** 安排一次「data → Markdown」的几何回写（同一视图内的连发合并成一次） */
export function schedulePersistRelationGeometry(view: ViewNodeEditContext): void {
	const pending = geometryTimers.get(view);
	if (pending !== undefined) {
		window.clearTimeout(pending);
	}
	// 用全局 `window` 而不是视图所在窗口：回调只读写视图状态、不碰 DOM，
	// 计时器挂在哪个窗口上都没有区别（`obsidianmd/prefer-window-timers`）。
	const timer = window.setTimeout(() => {
		geometryTimers.delete(view);
		persistRelationGeometry(view);
	}, RELATION_GEOMETRY_PERSIST_DELAY_MS);
	geometryTimers.set(view, timer);
}

/**
 * 拖动端点 / 控制点后的**几何回写**（data → Markdown）。
 *
 * 为什么需要：引擎把拖动结果存在节点 data 的两个数组里（`associativeLinePoint` /
 * `associativeLineTargetControlOffsets`），而本项目以 Markdown 为唯一真相——
 * 不写回正文的话，重开文件几何就回到自动计算（用户观感：「改了不保存」）。
 *
 * 只补 `geo`，**不动 refs 集合**：正文里有哪些边、标签是什么、什么顺序，全部以
 * 正文为准。若按 data 重建 refs，正文刚删掉的边会被 data 里的旧值「复活」——
 * 而这条通道只是几何的搬运工，不该有编辑语义。
 *
 * 由 uid 译不出关系 id 的边（目标节点还没有 `%%id%%`）没有可落笔的位置，跳过。
 *
 * @returns 是否有节点被改写
 */
function persistRelationGeometry(view: ViewNodeEditContext): boolean {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return false;
	}
	// 只回写「用户刚拖过」的几何：引擎在渲染/布局时也会改写这两个数组（默认控制点
	// 就是按当前几何算出来的），不设这道闸门会把自动值也写进文件、而它下次又被
	// 重算——文件被无谓改写，且 `geo=` 会污染本来干净的指令行。
	const gestureTime = gestureAt.get(view) ?? 0;
	if (Date.now() - gestureTime > GESTURE_WINDOW_MS) {
		return false;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return false;
	}
	// ① uid → 关系 id（一次遍历，供第二遍把引擎的 uid 译回正文里的 id）
	const uidToId = new Map<string, string>();
	walkTree(root, (node) => {
		const data = node.getData() as MdNodeData;
		const uid = typeof data.uid === 'string' ? data.uid : '';
		const id = relationStateOf(data).id;
		if (uid && id) {
			uidToId.set(uid, id);
		}
	});
	// ② 逐节点比对几何：只替换变化了的那几条 ref
	const writes: { node: MindMapNode; raw: string }[] = [];
	walkTree(root, (node) => {
		const data = node.getData() as MdNodeData;
		const state = relationStateOf(data);
		if (state.refs.length === 0) {
			return;
		}
		const geometryOf = new Map<string, RelationGeometry>();
		for (const edge of engineRelationsOf(node)) {
			const target = uidToId.get(edge.uid);
			if (target && edge.geo) {
				geometryOf.set(target, edge.geo);
			}
		}
		let changed = false;
		const refs = state.refs.map((ref) => {
			const geo = geometryOf.get(ref.target);
			if (!geo || sameRelationGeometry(ref.geo, geo)) {
				return ref;
			}
			changed = true;
			return { ...ref, geo };
		});
		if (!changed) {
			return;
		}
		writes.push({ node, raw: rawWithState(data, view.app, { id: state.id, refs }) });
	});
	if (writes.length === 0) {
		return false;
	}
	applyRawNodeContents(view, writes, { afterCommit: false });
	return true;
}

/**
 * 视图关闭时的收尾：丢弃点选模式、手绘锚定会话与待写几何。
 *
 * 点选 / 锚定是**瞬时交互会话**，会话期间挂的是原生 `window` 监听（不经
 * `engineEvents` 记账），中途关闭视图收不到 `pointerup` / `keydown` ⇒ 必须显式
 * 清理，否则闭包会一直持有已销毁的视图（与 `teardownImageResize` 同一理由）。
 */
export function teardownRelationInteraction(view: ViewNodeEditContext): void {
	const pending = geometryTimers.get(view);
	if (pending !== undefined) {
		window.clearTimeout(pending);
		geometryTimers.delete(view);
	}
	cancelRelationPicking(view);
	cancelRelationAnchor(view);
}

/** 进入「联系」点选模式（下一次点中节点即建边） */
export function startRelationPicking(
	view: ViewNodeEditContext,
	from: MindMapNode,
): void {
	if (rejectRoot(view, from)) {
		return;
	}
	// 重复进入只留一条提示（否则连续点「联系」会叠出好几条一模一样的 Notice）
	hidePickNotice(view);
	pendingPick.set(view, from);
	pickNotice.set(view, new Notice(t(view.lang, 'nodeRelation.addHint')));
}

/**
 * 退出点选模式（画布空白点击 / `Esc` / 引擎重建）。
 *
 * @returns 是否真的退出了（false = 本来就不在选点模式，`Esc` 据此让位给核心）
 */
export function cancelRelationPicking(view: ViewNodeEditContext): boolean {
	hidePickNotice(view);
	return pendingPick.delete(view);
}

/**
 * 点选模式的落点：命中节点即进入**手绘锚定**（不立即建边）。
 *
 * 建边推迟到两个手柄都落定：`startRelationAnchor` 先只画 overlay 预览，
 * 第二次点击才把 `%%rel:… | geo=…%%` 一次性写进正文。中途 Esc 不产生任何
 * 文件改动——几何一律由用户给出，插件不替用户选路线。
 *
 * @returns 是否消费了本次点击
 */
function completeRelationPick(
	view: RelationAnchorHost,
	node: MindMapNode,
): boolean {
	const from = pendingPick.get(view);
	if (!from) {
		return false;
	}
	pendingPick.delete(view);
	hidePickNotice(view);
	if (from !== node) {
		// 目标已有 id 且源已指向它：不必再走两次落定（否则用户点完两个柄
		// 才发现文件没变）。目标还没有 id 时无法预判，照常进入锚定。
		const fromState = relationStateOf(from.getData() as MdNodeData);
		const targetId = relationStateOf(node.getData() as MdNodeData).id;
		if (targetId && fromState.refs.some((ref) => ref.target === targetId)) {
			new Notice(t(view.lang, 'nodeRelation.exists'));
			return true;
		}
		const anchored = startRelationAnchor(view, from, node, (geometry) => {
			createRelation(view, from, node, geometry);
		});
		// 节点尚未布局（引擎刚重建 / 极端时序）时拿不到节点盒，锚定无从下笔：
		// 宁可建一条「没有 geo=」的边（端点交回引擎现算），也不能让提示消失而
		// 文件毫无变化——那在用户眼里就是「点了没反应」。
		if (!anchored) {
			createRelation(view, from, node);
		}
	}
	return true;
}

/** 弹标签输入框并写回（双击线 / 右键线两个入口共用同一份预填与回写） */
function editRelationLabel(
	view: ViewNodeEditContext,
	from: MindMapNode,
	targetId: string,
): void {
	const state = relationStateOf(from.getData() as MdNodeData);
	const current = state.refs.find((ref) => ref.target === targetId)?.label ?? '';
	void openRelationLabelModal(view.app, view.lang, current).then((label) => {
		if (label !== null) {
			updateRelationLabel(view, from, targetId, label);
		}
	});
}

/**
 * 线的「配色」子菜单：默认（跟随主题）+ 与**节点配色同一套色族** + 自定义…。
 *
 * 复用 `nodeColorOptions`（色族 → 主色的唯一表）：同一个「薄荷」在节点上与在
 * 连线上是同一个 hex，一支子树和它出边才像同一族。哨兵 `%%none%%` 只服务节点
 * 继承，线没有继承概念，故这里是「有 color 段 / 没有」两态。
 */
function addRelationColorMenu(
	view: ViewNodeEditContext,
	menu: Menu,
	from: MindMapNode,
	targetId: string,
): void {
	const current = relationRefOf(from, targetId)?.color ?? null;
	const options = nodeColorOptions();
	const isCustom =
		!!current && !options.some((option) => option.color === current);
	addCascadingMenu(menu, view.lang, {
		title: 'nodeRelation.color',
		icon: 'palette',
		build: (submenu) => {
			submenu.addItem((item) =>
				item
					.setTitle(t(view.lang, 'menu.color.follow'))
					.setChecked(current === null)
					.onClick(() => setRelationColor(view, from, targetId, null)),
			);
			for (const option of options) {
				submenu.addItem((item) =>
					item
						.setTitle(t(view.lang, option.label))
						.setChecked(option.color === current)
						.onClick(() =>
							setRelationColor(view, from, targetId, option.color),
						),
				);
			}
			addCustomColorItem(submenu, view.app, view.lang, {
				checked: isCustom,
				initial: current,
				onPick: (color) => setRelationColor(view, from, targetId, color),
			});
		},
	});
}

/**
 * 联系线右键菜单：只作用于**这一条边**。
 *
 * 与节点右键的「联系」子菜单分工：那里从节点出发列出全部出边（用于批量清理），
 * 这里从线出发（右键哪条就操作哪条，与官方 Canvas 的连线右键同形）。三个动作都
 * 落在正文：配色 → 重写 `%%rel%%` 的 `color=` 段；改标签 → 重写标签；删除 → 摘掉
 * 该 ref（目标节点再无其它入边时，它的 `%%id%%` 一并回收，见 {@link removeRelation}）。
 */
function showRelationLineMenu(
	view: ViewNodeEditContext,
	event: MouseEvent,
	hit: RelationLineHit,
	targetId: string,
): void {
	const menu = new Menu();
	addRelationColorMenu(view, menu, hit.from, targetId);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'nodeRelation.editLabel'))
			.setIcon('pencil')
			.onClick(() => editRelationLabel(view, hit.from, targetId)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'nodeRelation.delete'))
			.setIcon('trash-2')
			.onClick(() => removeRelation(view, hit.from, hit.to)),
	);
	// 独占弹出：节点上的右键同样够不到宿主的「点别处即关闭」（引擎吞了 mousedown）
	showExclusiveMenu(view, menu, { x: event.clientX, y: event.clientY });
}

/**
 * 注册联系相关的交互（随引擎重建调用一次）：
 * - 点选模式：`node_click` 落点 / `draw_click` 取消；
 * - **双击联系线改标签**：画布 capture 拦截。引擎插件在 `clickPath.dblclick` 上
 *   挂了内置文本框，它只改 data、不进文件（下一次派生同步就会被覆盖，用户观感是
 *   「改了没保存」），故必须在捕获阶段拦下来，改走我们自己的弹窗；
 * - **右键联系线**：同样是 capture。引擎把 `contextmenu` 绑在 svg 上，其处理器会
 *   `clearActiveLine()` + `renderAllLines()`——重画**换掉了线元素**，冒泡阶段再拿
 *   `event.target` 做命中判定必然落空（新 `lineList` 里没有那个旧节点）。捕获阶段
 *   判定并停止传播，命中结果与选中态都保得住。
 */
export function setupRelationInteractions(
	view: ViewNodeEditContext & Pick<MindMapViewContext, 'canvasEl'>,
): void {
	if (!view.mindMap || !view.canvasEl) {
		return;
	}
	// 引擎重建（换文件 / 切回 Markdown 再回来）后旧节点引用一律作废：留着 pending
	// 会让下一次「点目标节点」作用在一个不在树上的节点上——`applyRawNodeContents`
	// 写的是游离 data，文件不会有任何变化，用户只觉得「点了没用」。重建即视为放弃。
	cancelRelationPicking(view);
	// 手绘锚定会话同样随引擎重建作废：overlay 挂在旧 draw 层上，节点引用也已失效
	cancelRelationAnchor(view);
	// 画布指针手势时间戳（capture）：只有用户真的按过画布，几何才允许回写
	for (const type of ['pointerdown', 'pointerup'] as const) {
		view.engineEvents.onDom(
			view.canvasEl,
			type,
			() => noteRelationCanvasGesture(view),
			true,
		);
	}
	view.engineEvents.onEngine(view.mindMap, 'node_click', (...args: unknown[]) => {
		const node = args[0] as MindMapNode | undefined;
		if (node) {
			completeRelationPick(view, node);
		}
	});
	view.engineEvents.onEngine(view.mindMap, 'draw_click', () => {
		cancelRelationPicking(view);
	});
	view.engineEvents.onDom(
		view.canvasEl,
		'dblclick',
		(event) => {
			const hit = relationLineAt(view.mindMap, event.target);
			const targetId = hit ? relationIdOf(hit.to) : null;
			if (!hit || !targetId) {
				return;
			}
			// 拦在引擎处理之前：否则会打开插件的内联文本框
			event.preventDefault();
			event.stopPropagation();
			editRelationLabel(view, hit.from, targetId);
		},
		{ capture: true },
	);
	view.engineEvents.onDom(
		view.canvasEl,
		'contextmenu',
		(event) => {
			const hit = relationLineAt(view.mindMap, event.target);
			const targetId = hit ? relationIdOf(hit.to) : null;
			// 目标 id 缺失＝data 里有线、正文里没有（理论上不出现）：放行给普通画布菜单，
			// 不提供一个点了没反应的「删除联系」
			if (!hit || !targetId) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			showRelationLineMenu(view, event, hit, targetId);
		},
		{ capture: true },
	);
}
