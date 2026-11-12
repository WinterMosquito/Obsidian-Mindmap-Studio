/**
 * 层级语法的**整篇重排**（右键「层级语法」级联）：把整棵树按 (语法, 起点) 归一，
 * 双向可逆——列表 ⇄ 标题、一级 ⇄ 二级。
 *
 * 判据与整支升降在 `md-heading-syntax`（基础面）；本模块只负责「逐层派发」。
 *
 * ## 组原子
 * 某一层只要有**转不了**的节点（多行 / 任务项 / 有序列表 / 段落），整层保持列表
 * 并点名阻挡者：否则那个节点排在标题之后，重解析时会被读成前一个标题的子节点。
 * 「层内混排」在这里不保留——重排后的层要么全标题、要么全列表（合法的
 * 「列表在前、标题在后」混排是**不重排**时的手写形态，见 `md-heading-syntax`）。
 *
 * ## 为什么允许「重定级」
 * 已有标题按深度重排（`##` 起的手写文件也能一键归一到一级起），这样就不需要
 * 「有标题就锁起点」的特例；代价是选「标题·二级」会把可用标题层级压成 5 级，
 * 第 6 层起回落列表（`plan.keptList` / `converted` 如实计数）。
 *
 * ## 数据保真（K170）
 * 转列表时 `plain` 段落一并转列表项（列表父链下无前缀行无法表达层级）；
 * 转标题保留 `mdMarker`（转回列表恢复 `*` / `+`），有序编号由解析层的
 * `mdOrderedNumber` 保真（不再重排为 1..n）。
 */
import type { MindMapTreeNode } from '../core/engine-types';
import {
	MAX_HEADING_LEVEL,
	convertBranchToList,
	dataOf,
	headingBlockReason,
	isHeadingNode,
	labelOf,
	levelOf,
	readHeadingStart,
	relevelHeadingBranch,
	type DocumentSyntax,
	type HeadingBlockReason,
} from './md-heading-syntax';

/** 整篇重排的结果（供提示文案计数 / 点名阻挡者） */
export interface DocumentSyntaxPlan {
	converted: number;
	/** 目标为标题时，仍保持列表的节点数 */
	keptList: number;
	blocked: { text: string; reason: HeadingBlockReason }[];
}

/** 子树节点数（含自身） */
function countNodes(node: MindMapTreeNode): number {
	let count = 0;
	const stack: MindMapTreeNode[] = [node];
	while (stack.length > 0) {
		const current = stack.pop()!;
		count++;
		for (const child of current.children ?? []) {
			stack.push(child);
		}
	}
	return count;
}

/**
 * 整篇按目标语法重排（**双向**）：目标为标题时已有标题按深度重定级，
 * 目标为列表时全部标题降为列表项。
 */
export function planDocumentSyntax(
	root: MindMapTreeNode,
	target: DocumentSyntax,
): DocumentSyntaxPlan {
	const plan: DocumentSyntaxPlan = { converted: 0, keptList: 0, blocked: [] };
	if (target === 'list') {
		const stack: MindMapTreeNode[] = [root];
		while (stack.length > 0) {
			const current = stack.pop()!;
			// 段落也转列表项：整篇无标题后，无前缀段落行没有层级表达
			if (
				isHeadingNode(dataOf(current)) ||
				dataOf(current).mdType === 'plain'
			) {
				plan.converted += convertBranchToList(current);
				continue;
			}
			for (const child of current.children ?? []) {
				stack.push(child);
			}
		}
		// 已没有任何标题：起始级别随之作废（下次解析按正文重测）。
		// 本函数接收调用方的**深拷贝**；`converted === 0` 时调用方提前返回、
		// 不回灌，故这里删除只影响副本（K171）。
		delete dataOf(root).mdHeadingStart;
		return plan;
	}
	const groups: { node: MindMapTreeNode; level: number }[] = [
		{ node: root, level: target },
	];
	while (groups.length > 0) {
		const frame = groups.pop()!;
		const children = frame.node.children ?? [];
		if (children.length === 0) {
			continue;
		}
		// 父是 list / plain 时该层写不了标题。`plain` 分支生产不可达（解析器不会
		// 产出段落父下的标题，守卫也会撤回），保留作非法内存态的兜底（K171）。
		const parentType = frame.node === root ? null : dataOf(frame.node).mdType;
		const headingsAllowed = parentType !== 'list' && parentType !== 'plain';
		if (!headingsAllowed || frame.level > MAX_HEADING_LEVEL) {
			// 该层写不了标题：已有标题降为列表（列表成员保持原样）
			for (const child of children) {
				if (isHeadingNode(dataOf(child))) {
					plan.converted += convertBranchToList(child);
				}
			}
			continue;
		}
		let blocker: HeadingBlockReason | null = null;
		for (const child of children) {
			const data = dataOf(child);
			if (isHeadingNode(data)) {
				continue;
			}
			blocker = headingBlockReason(data);
			if (blocker) {
				plan.blocked.push({ text: labelOf(data), reason: blocker });
				break;
			}
		}
		if (blocker) {
			for (const child of children) {
				plan.keptList += countNodes(child);
			}
			continue;
		}
		for (const child of children) {
			const data = dataOf(child);
			if (isHeadingNode(data)) {
				// 本层只重定级；**子层**留给下一轮按组原子处理——那一层若有围栏 /
				// 任务项会整层保持列表，不会硬转（在这里顺手递归就会绕开阻挡判据）
				if (levelOf(data) !== frame.level) {
					plan.converted += relevelHeadingBranch(child, frame.level);
				}
			} else {
				data.mdType = 'heading';
				data.mdLevel = frame.level;
				// 保留 mdMarker：标题行不写它，转回列表时恢复原标记
				plan.converted++;
			}
			groups.push({ node: child, level: frame.level + 1 });
		}
	}
	dataOf(root).mdHeadingStart = target;
	return plan;
}

/**
 * 本文件当前属于哪种层级语法（右键级联的勾选态）。
 *
 * 只读**实测**信息：根组没有任何标题 ⇒ 列表；否则按根 data 的
 * `mdHeadingStart` 归到最近的一档（手写的三级起按二级显示，菜单只有两档）。
 * 根级无标题而深层有标题是非法树（解析器不产出、守卫会拦），按列表处理。
 */
export function currentDocumentSyntax(root: MindMapTreeNode): DocumentSyntax {
	const headings = (root.children ?? []).filter((child) =>
		isHeadingNode(dataOf(child)),
	);
	if (headings.length === 0) {
		return 'list';
	}
	return readHeadingStart(root.data) >= 2 ? 2 : 1;
}
