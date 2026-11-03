/**
 * 概要（Summary）：把 `domain/summary` 规划的区间落到引擎节点数据上。
 *
 * ## 数据落点（全部写在**父节点** data）
 * 引擎把「若干兄弟的概要」建模成父节点持有的数组：
 *
 * ```ts
 * parent.data.generalization = [
 *   { uid: 'sum-1', text: '本周必须完成', range: [0, 1] },
 * ]
 * ```
 *
 * - `range` = **兄弟下标闭区间**（含两端）——与 `domain/summary` 的「起点 + 个数」
 *   互相翻译：`start` = 声明那条指令的兄弟下标，`end` = `start + count - 1`；
 * - `text` = 概要节点的文字（引擎据此画一个盒，盒与括号由 `Render` 现算）；
 * - `uid` 只需**文档内唯一**（引擎用它做 DOM 类名与激活列表的身份）——本模块按
 *   文档序遍历分配 `sum-1`、`sum-2`…，同一份树两次同步得到同一组 uid（不抖动）。
 * - **单节点概要用 `range: [i, i]`**，不用引擎的「挂在节点自己身上」形态：
 *   两种形态渲染相同（2026-11-02 实机比对），但父节点形态让本模块只有一条路径。
 *
 * ## 两个时机（与 `engine/mindmap-relations` 逐条对齐）
 * - **创建引擎前**（{@link applySummariesToTree}）：引擎 `handleData` 会克隆数据，
 *   建好后再改这棵树不再生效 ⇒ 首帧即带概要框，不额外渲染一次；
 * - **创建引擎后**（{@link syncLiveSummaries}）：挂 `node_tree_render_end`（不是
 *   `data_change`——插件内联编辑根本不发它，且撤销时它先于新树落地）。
 *
 * ## 单向数据流
 * Markdown 是唯一真相，data 只是派生显示状态：本模块**只写 data、不走命令**
 * （不进历史、不再发 `data_change`）。引擎的 `ADD_GENERALIZATION` 命令**不调用**
 * ——那会在历史里多留一条「概要」记录，撤销时与正文各走各的。
 *
 * ## 为什么要多渲染一轮
 * 概要框是**布局产物**（括号位置取决于被覆盖兄弟的包围盒），不像联系线那样
 * 只改一条路径即可 `redraw`。故本模块写进 data 后由调用方**再渲染一轮**；
 * 第二轮同步发现无变化即停（不会自激）。
 */

import type { MindMap, MindMapNode, MindMapTreeNode } from '../core/engine-types';
import {
	planSummaryRanges,
	summariesOf,
	type SummaryRange,
} from '../domain/summary';
import { walkTree } from '../domain/tree';
import { getRenderRoot } from './mindmap-nodes';

/** 本模块拥有的节点 data 键（清除分支遍历的就是它，勿另列一份） */
const SUMMARY_KEY = 'generalization';

/**
 * 一条概要的引擎形态。
 *
 * 只给本模块与测试用：其它地方读概要一律走 `domain/summary`（正文是唯一真相）。
 */
export interface GeneralizationEntry {
	/** 文档内唯一（`sum-1`…）；引擎用它做 DOM 类名与激活列表身份 */
	uid: string;
	/** 概要框上的文字 */
	text: string;
	/** 被覆盖的兄弟下标闭区间（含两端） */
	range: [number, number];
}

/** 引擎节点 → `walkTree` 需要的形态（data 是**活引用**：`getData()` 直接改） */
function wrapEngineTree(node: MindMapNode): MindMapTreeNode {
	return {
		data: node.getData() ?? {},
		children: (node.children ?? []).map((child) => wrapEngineTree(child)),
	};
}

/** 两份概要数组是否等价（写入侧据此避免无意义的落盘与重渲染） */
function sameGeneralizations(
	current: unknown,
	next: readonly GeneralizationEntry[],
): boolean {
	if (!Array.isArray(current) || current.length !== next.length) {
		return false;
	}
	for (let i = 0; i < next.length; i += 1) {
		const existing = current[i] as Record<string, unknown> | undefined;
		const entry = next[i]!;
		if (!existing || existing.uid !== entry.uid || existing.text !== entry.text) {
			return false;
		}
		const range = existing.range;
		if (
			!Array.isArray(range) ||
			range[0] !== entry.range[0] ||
			range[1] !== entry.range[1]
		) {
			return false;
		}
	}
	return true;
}

/**
 * 把规划结果写进父节点 data。
 *
 * 空规划 = **删除该键**（不留 `generalization: []`：引擎对空数组的处理与缺键
 * 等价，留着只会让「有没有概要」多一份判据）。
 *
 * @returns data 是否真的变了
 */
export function applySummaryPlan(
	data: Record<string, unknown>,
	entries: readonly GeneralizationEntry[],
): boolean {
	const current = data[SUMMARY_KEY];
	if (entries.length === 0) {
		if (current === undefined) {
			return false;
		}
		delete data[SUMMARY_KEY];
		return true;
	}
	if (sameGeneralizations(current, entries)) {
		return false;
	}
	data[SUMMARY_KEY] = entries.map((entry) => ({ ...entry }));
	return true;
}

/**
 * 一个父节点的子节点数组 → 引擎条目（uid 由调用方按文档序分配）。
 *
 * 单独导出给测试：规划（domain）与落地（引擎形态）之间的唯一翻译点。
 */
export function generalizationsOf(
	ranges: readonly SummaryRange[],
	startUid = 1,
): GeneralizationEntry[] {
	return ranges.map((range, index) => ({
		uid: `sum-${startUid + index}`,
		text: range.text,
		range: [range.start, range.end] as [number, number],
	}));
}

/**
 * 一棵树（md 树或引擎树的包装）的**每一个父节点**的概要规划。
 *
 * `uid` 按遍历顺序分配，故要求树序稳定（md 树与引擎树都是文档序）。
 */
function planTree(
	tree: MindMapTreeNode,
): Map<Record<string, unknown>, GeneralizationEntry[]> {
	const plans = new Map<Record<string, unknown>, GeneralizationEntry[]>();
	let uid = 1;
	walkTree(tree, (node) => {
		const children = node.children ?? [];
		const data = node.data as Record<string, unknown> | undefined;
		if (!data) {
			return;
		}
		if (children.length === 0) {
			plans.set(data, []);
			return;
		}
		const entries = children.map((child) =>
			summariesOf(child.data as Record<string, unknown> | undefined),
		);
		const ranges = planSummaryRanges(entries);
		const generalizations = generalizationsOf(ranges, uid);
		uid += generalizations.length;
		plans.set(data, generalizations);
	});
	return plans;
}

/**
 * 引擎创建**之前**把概要写进 data 树（首帧即带概要框，不额外渲染一次）。
 *
 * 视图加载与 ```mindmap 嵌入两个创建入口都必须在 `createMindMap` 前调用；
 * 引擎 `MindMapNode.handleData` 会克隆数据，创建后再改这棵树不再生效。
 */
export function applySummariesToTree(tree: MindMapTreeNode): void {
	const plans = planTree(tree);
	for (const [data, entries] of plans) {
		applySummaryPlan(data, entries);
	}
}

/**
 * 引擎创建**之后**按实时节点树重算概要（编辑 / 插入 / 撤销都会改变指令）。
 *
 * 直接写节点 data（不 execCommand）：这是派生自 Markdown 的显示状态，不该进入
 * 命令历史。**有变化时由调用方再渲染一轮**——概要框是布局产物，只改 data
 * 不会让已画好的括号跟着动。
 *
 * @returns 是否有节点数据真的变了（调用方据此决定是否补一次渲染）
 */
export function syncLiveSummaries(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return false;
	}
	const wrapped = wrapEngineTree(root);
	const plans = planTree(wrapped);
	let changed = false;
	for (const [data, entries] of plans) {
		if (applySummaryPlan(data, entries)) {
			changed = true;
		}
	}
	return changed;
}

/**
 * 该节点是不是**概要节点**（引擎为每条概要另建的实例，不在 `children` 里）。
 *
 * 防腐收口：`features/` 不得直接读 `node.isGeneralization`（引擎内部字段）。
 */
export function isSummaryNode(node: MindMapNode | null | undefined): boolean {
	return node?.isGeneralization === true;
}

/**
 * 概要节点 → 「它压着哪一个正文节点」。
 *
 * 概要在正文里的落点是**第一个被覆盖的兄弟**（`%%sum%%` 写在它身上），故从
 * 父节点 + `range[0]` 反查：`generalizationBelongNode` 是父 Node 实例，
 * `range` 由本模块写进 data。
 *
 * @returns 找不到（父节点缺失 / range 非法 / 下标越界）时 null
 */
export function summaryAnchorOf(
	node: MindMapNode | null | undefined,
): { target: MindMapNode; start: number } | null {
	if (!node || !isSummaryNode(node)) {
		return null;
	}
	const parent = node.generalizationBelongNode;
	if (!parent) {
		return null;
	}
	const range = node.getData('range');
	const start: unknown = Array.isArray(range) ? range[0] : undefined;
	if (typeof start !== 'number' || !Number.isInteger(start) || start < 0) {
		return null;
	}
	const target = (parent.children ?? [])[start];
	return target ? { target, start } : null;
}
