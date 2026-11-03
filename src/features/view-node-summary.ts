/**
 * 概要（Summary）的**全部编辑入口**：建 / 改文字 / 删。
 *
 * ## 交互（对齐 XMind，也对齐本插件的「联系」）
 * - **建（两条入口，菜单标题自己会说明走哪条）**：
 *   - 已多选到**≥2 个相邻同级**节点 →「概要（覆盖 N 个）」：按选中集合直接建
 *     （跨分支自动拆成多条，XMind 同款；跳跃选中无法用「起点 + 个数」表达，
 *     这种选中不会进这条分支）；
 *   - 其余情况 →「概要…」：进入**两次点选**（起点默认是右键的那个节点，
 *     再点一下落定终点）。为什么要有它：鼠标只能靠 `Ctrl+单击` 一个个加点，
 *     覆盖 10 个兄弟就得点 10 次；两次点选把「长区间」变成 2 次点击；
 * - **改文字**：右键概要节点 →「编辑概要文字」，或双击概要节点 / 选中后按 F2；
 * - **删**：右键概要节点 →「删除概要」，或选中后按 `Delete` / `Backspace`。
 *
 * ## 为什么文字编辑走弹窗、不走引擎内联编辑框
 * 概要的文字只存在于正文的 `%%sum%%` 段里（引擎侧那个盒子是从它派生的**显示
 * 状态**）。引擎的 `SET_NODE_TEXT` 只会改派生 data，下一轮同步就被正文覆盖回来
 * ——用户会看到「打字后一闪就没了」。与联系标签同一取舍：编辑入口统一走插件的
 * raw 通道（写正文 → 重解析 → 渲染），一次提交、一条撤销。
 *
 * ## 写盘
 * 一律 `applyRawNodeContents`（与建边 / 改色同一通道）：一次渲染、一次保存、
 * 一条撤销。**只改 `sum` 段**（`domain/summary.applySummaries`），同节点的
 * `%%id%%` / `%%rel%%` 逐字带回。
 */
import { Menu, Notice } from 'obsidian';
import type { MindMapNode } from '../core/engine-types';
import type { MdNodeData } from '../core/node-data';
import { t, tf } from '../core/i18n';
import {
	applySummaries,
	planSummaryRanges,
	summariesOf,
	summaryEntryIndexOfRange,
	type SummaryEntry,
} from '../domain/summary';
import {
	getNodeDataString,
	isSummaryNode,
	summaryAnchorOf,
} from '../engine/mindmap';
import { composeNodeContent } from '../markdown/md-serialize';
import { showExclusiveMenu } from '../ui/menu-submenu';
import { openSummaryTextModal } from '../ui/modal-summary-text';
import { applyRawNodeContents } from './node-inline-editor';
import { startNodePick } from './node-pick';
import type { ViewNodeEditContext } from './view-context';

/** 同一个父节点下、下标连续的一段兄弟（一次「概要」= 每个分支一条） */
interface SiblingRun {
	parent: MindMapNode;
	nodes: MindMapNode[];
	start: number;
	count: number;
}

/** 节点在自己父节点里的下标（不是真节点 —— 概要节点 / 游离节点 —— 返回 -1） */
function siblingIndexOf(node: MindMapNode): number {
	return (node.parent?.children ?? []).indexOf(node);
}

/**
 * 选中集合 → 每个分支的**连续段**。
 *
 * @returns 任一分支的选中下标不连续时 null（调用方提示并放弃整次操作：只给
 *   「连续的那部分」建概要会让用户以为漏选，不如明确拒绝）
 */
function collectRuns(nodes: readonly MindMapNode[]): SiblingRun[] | null {
	const groups = new Map<MindMapNode, number[]>();
	for (const node of nodes) {
		const parent = node.parent;
		if (!parent) {
			continue;
		}
		const index = siblingIndexOf(node);
		if (index < 0) {
			continue;
		}
		const list = groups.get(parent) ?? [];
		list.push(index);
		groups.set(parent, list);
	}
	const runs: SiblingRun[] = [];
	for (const [parent, indexes] of groups) {
		indexes.sort((a, b) => a - b);
		const contiguous = indexes.every(
			(index, i) => i === 0 || index === indexes[i - 1]! + 1,
		);
		if (!contiguous) {
			return null;
		}
		const start = indexes[0]!;
		const children = parent.children ?? [];
		runs.push({
			parent,
			nodes: indexes.map((index) => children[index]!).filter(Boolean),
			start,
			count: indexes.length,
		});
	}
	return runs;
}

/**
 * 这条概要放得下吗（不与同分支已有的概要重叠）。
 *
 * 复用 `planSummaryRanges` 的判定而不是另写一遍区间比较：规划器加不加得进，
 * 就是唯一判据。`text` 不参与规划，随便给一个占位。
 */
function canPlaceRun(run: SiblingRun): boolean {
	const children = run.parent.children ?? [];
	const entries = children.map((child) => summariesOf(child.getData() as MdNodeData));
	const before = planSummaryRanges(entries).length;
	const withNew = entries.map((list, index) =>
		index === run.start ? [...list, { count: run.count, text: 'x' }] : list,
	);
	return planSummaryRanges(withNew).length === before + 1;
}

/** 节点当前原文 → 换一份概要列表后的原文（其余指令段原样保留） */
function rawWithSummaries(
	view: ViewNodeEditContext,
	node: MindMapNode,
	entries: readonly SummaryEntry[],
): string {
	const data = node.getData() as MdNodeData;
	return applySummaries(composeNodeContent(data, view.app), entries);
}

/**
 * 建立概要（作用于传入的**选中集合**）。
 *
 * 文字先问再写：概要与联系标签不同，它就是概要框上的正文，空框没有信息量；
 * 先弹窗也意味着用户取消时**一个字节都不写**。
 *
 * @returns 是否真的写了文件
 */
async function createSummary(
	view: ViewNodeEditContext,
	nodes: readonly MindMapNode[],
): Promise<boolean> {
	if (!view.mindMap) {
		return false;
	}
	const candidates = nodes.filter(
		(node) => !node.isRoot && !isSummaryNode(node) && node.parent,
	);
	if (candidates.length === 0) {
		new Notice(t(view.lang, 'summary.rootUnsupported'));
		return false;
	}
	const runs = collectRuns(candidates);
	if (!runs || runs.length === 0) {
		new Notice(t(view.lang, 'summary.needSiblings'));
		return false;
	}
	if (runs.some((run) => !canPlaceRun(run))) {
		new Notice(t(view.lang, 'summary.overlap'));
		return false;
	}
	// 创建场景：不预填文字（输入框留空 + 占位符），标题与按钮也用「新建 / 创建」
	const text = await openSummaryTextModal(view.app, view.lang, '', 'create');
	if (text === null) {
		return false;
	}
	const entries = runs.map((run) => {
		const target = run.nodes[0]!;
		const next: SummaryEntry[] = [
			...summariesOf(target.getData() as MdNodeData),
			{ count: run.count, text },
		];
		return { node: target, raw: rawWithSummaries(view, target, next) };
	});
	// 只加注释，不触发「中心主题改名 / 自动拆链」等提交后编排
	applyRawNodeContents(view, entries, { afterCommit: false });
	return true;
}

/**
 * 概要节点 → 「正文里对应的那条条目」。
 *
 * 锚点由 `summaryAnchorOf` 反查（父节点 + `range[0]`），条目由
 * `summaryEntryIndexOfRange` 按**规划器自己的区间**认领——不能拿 `count` 去对
 * 宽度：`count` 越界时会被夹到最后一个兄弟（文件里的数字不改），此后两者不再
 * 相等（见 `domain/summary.summaryEntryIndexOfRange`）。
 *
 * 找不到（父节点 / `range` 缺失，或正文里的 `%%sum%%` 已被手改掉）返回 null，
 * 调用方据此给出可见提示——静默 no-op 会让「右键 / Delete」看起来坏了。
 */
function entryOfSummary(
	node: MindMapNode,
): { target: MindMapNode; entries: SummaryEntry[]; index: number } | null {
	const anchor = summaryAnchorOf(node);
	if (!anchor) {
		return null;
	}
	const range = node.getData('range');
	const end =
		Array.isArray(range) && typeof range[1] === 'number'
			? range[1]
			: anchor.start;
	// 兄弟数组必须与渲染时同一序（规划按它算下标），故取父节点的 children
	const siblings = anchor.target.parent?.children ?? [];
	const start = siblings.indexOf(anchor.target);
	if (start < 0) {
		return null;
	}
	const index = summaryEntryIndexOfRange(
		siblings.map((child) => summariesOf(child.getData() as MdNodeData)),
		start,
		end,
	);
	if (index < 0) {
		return null;
	}
	const entries = summariesOf(anchor.target.getData() as MdNodeData);
	if (index >= entries.length) {
		return null;
	}
	return { target: anchor.target, entries, index };
}

/** 反查失败的用户可见提示（编辑 / 删除共用） */
function notifyUnresolved(view: ViewNodeEditContext): void {
	new Notice(t(view.lang, 'summary.unresolved'));
}

/** 改概要文字（右键 / 双击 / F2 的共用入口） */
export async function editSummaryText(
	view: ViewNodeEditContext,
	node: MindMapNode,
): Promise<boolean> {
	const found = entryOfSummary(node);
	if (!found) {
		notifyUnresolved(view);
		return false;
	}
	const current = found.entries[found.index]!.text;
	const text = await openSummaryTextModal(view.app, view.lang, current);
	if (text === null || text === current) {
		return false;
	}
	const next = found.entries.map((entry, index) =>
		index === found.index ? { ...entry, text } : entry,
	);
	applyRawNodeContents(
		view,
		[{ node: found.target, raw: rawWithSummaries(view, found.target, next) }],
		{ afterCommit: false },
	);
	return true;
}

/** 删除概要（右键 / `Delete` 的共用入口）：只摘这一条 `%%sum%%` 段 */
export function removeSummary(view: ViewNodeEditContext, node: MindMapNode): boolean {
	const found = entryOfSummary(node);
	if (!found) {
		notifyUnresolved(view);
		return false;
	}
	const next = found.entries.filter((_, index) => index !== found.index);
	applyRawNodeContents(
		view,
		[{ node: found.target, raw: rawWithSummaries(view, found.target, next) }],
		{ afterCommit: false },
	);
	return true;
}

/**
 * 概要节点的右键菜单（**独立菜单**：概要不是正文节点，不列编辑文本 / 加子节点 /
 * 删除节点那一套——那些操作会落到派生 data 上，下一轮同步就被正文覆盖）。
 */
export function showSummaryMenu(
	view: ViewNodeEditContext,
	event: MouseEvent,
	node: MindMapNode,
): void {
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'summary.editText'))
			.setIcon('pencil')
			.onClick(() => {
				void editSummaryText(view, node);
			}),
	);
	menu.addItem((item) =>
		item
			.setTitle(t(view.lang, 'summary.delete'))
			.setIcon('trash-2')
			.onClick(() => {
				removeSummary(view, node);
			}),
	);
	showExclusiveMenu(view, menu, { x: event.clientX, y: event.clientY });
}

/** 提示里展示的节点名（过长截断；空节点用省略号，避免「从「」开始」） */
function nodeLabel(node: MindMapNode): string {
	const text = getNodeDataString(node, 'text').trim() || '…';
	return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

/**
 * 两次点选的落点 → 一段可写的兄弟区间。
 *
 * 起点由菜单给（右键的那个节点），终点是用户点的那一下：
 * - 终点可以点在起点**前面**（区间取两端之间，锚点仍是靠前的那个兄弟）；
 * - 不同父节点 / 概要框 / 中心主题 → 提示后**留在选点态**（换个终点即可）；
 * - 与同分支已有概要重叠 → 同样留在选点态（范围缩小一点再来）。
 */
function planPickedRun(
	view: ViewNodeEditContext,
	anchor: MindMapNode,
	to: MindMapNode,
): SiblingRun | null {
	if (to.isRoot || isSummaryNode(to)) {
		new Notice(t(view.lang, 'summary.pickInvalid'));
		return null;
	}
	if (!anchor.parent || to.parent !== anchor.parent) {
		new Notice(t(view.lang, 'summary.pickNotSibling'));
		return null;
	}
	const from = siblingIndexOf(anchor);
	const toIndex = siblingIndexOf(to);
	if (from < 0 || toIndex < 0) {
		return null;
	}
	const start = Math.min(from, toIndex);
	const children = anchor.parent.children ?? [];
	const nodes = children.slice(start, Math.max(from, toIndex) + 1);
	const run: SiblingRun = {
		parent: anchor.parent,
		nodes,
		start,
		count: nodes.length,
	};
	if (!canPlaceRun(run)) {
		new Notice(t(view.lang, 'summary.pickOverlap'));
		return null;
	}
	return run;
}

/**
 * 进入「概要」的**两次点选**：起点 = 右键的那个节点，再点一下落定终点。
 *
 * 与「联系」共用 `features/node-pick` 的会话（同一时刻只可能有一个选点态；
 * `Esc` / 点画布空白 / 引擎重建由它统一收尾）。
 */
function startSummaryPicking(
	view: ViewNodeEditContext,
	anchor: MindMapNode,
): void {
	if (anchor.isRoot || isSummaryNode(anchor) || siblingIndexOf(anchor) < 0) {
		new Notice(t(view.lang, 'summary.rootUnsupported'));
		return;
	}
	startNodePick(view, {
		hint: tf(view.lang, 'summary.pickHint', { node: nodeLabel(anchor) }),
		onPick: (node) => {
			const run = planPickedRun(view, anchor, node);
			if (!run) {
				// 起点不变，换个终点再点。错误原因由 `planPickedRun` 另起一条
				// 短提示（5 s 自散），常驻的「怎么操作」指引留在原处——把它
				// 改写成错误文案，用户反而看不到下一步该点什么。
				return 'continue';
			}
			void createSummary(view, run.nodes);
			return 'done';
		},
	});
}

/**
 * 节点右键菜单里的「概要」条目（与联系同组：都是**结构编辑**，不是外观）。
 *
 * 标题即说明走哪条路（见文件头）：选中够用就报覆盖数直接建（`概要（覆盖 N 个）`），
 * 否则带省略号进两次点选（`概要…`）。中心主题不能作对象 ⇒ 置灰。
 *
 * @param node    右键命中的节点（两次点选的**默认起点**）
 * @param targets 右键按下时的选中集合（见 `view-context-menu` 的快照逻辑）
 */
export function addSummaryItem(
	menu: Menu,
	view: ViewNodeEditContext,
	node: MindMapNode,
	targets: readonly MindMapNode[],
): void {
	// 中心主题（虚拟文档根）没有正文行 ⇒ 置灰（与「联系」同一裁决）
	const usable = targets.filter((item) => !item.isRoot && !isSummaryNode(item));
	const runs = usable.length >= 2 ? collectRuns(usable) : null;
	const ready = !!runs && runs.length > 0 && runs.every(canPlaceRun);
	const count =
		runs?.reduce((total, run) => total + run.count, 0) ?? usable.length;
	menu.addItem((item) => {
		const entry = item
			.setTitle(
				usable.length === 0
					? t(view.lang, 'summary.add')
					: ready
						? tf(view.lang, 'summary.addCount', { count })
						: t(view.lang, 'summary.addPick'),
			)
			.setIcon('brackets');
		if (usable.length === 0) {
			return entry.setDisabled(true);
		}
		return ready
			? entry.onClick(() => {
					void createSummary(view, usable);
				})
			: entry.onClick(() => {
					startSummaryPicking(view, node);
				});
	});
}
