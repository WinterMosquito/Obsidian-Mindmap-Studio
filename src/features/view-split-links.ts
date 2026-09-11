/**
 * 节点内混排双链拆分（手动命令 + 自动触发 + 全文批量）的视图侧执行。
 *
 * 判定与方案在 `src/links-split.ts`（纯逻辑，零引擎依赖）；本模块只负责
 * 把方案施加到引擎并给用户反馈：
 * - 单节点：走引擎命令逐条插入（可控，与其它编辑同一条通道）；
 * - 全文批量：改写数据树后一次性 `setData`——与引用更新（`links-tree`）同一
 *   路径，性能模式下也不会漏掉视口外节点。
 */
import { Notice } from 'obsidian';
import { getActiveNode, isEditingText, setNodeText } from '../mindmap';
import {
	planSplitLinks,
	splitAllLinksInTree,
	writeSplitPlanToData,
	type SplitAllResult,
	type SplitLinkPlan,
} from '../links-split';
import { ensureUniqueUids } from '../markdown';
import { insertChildNodeWithData, requireActiveNode } from './view-common';
import { t, tf } from '../i18n';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MdNodeData } from '../node-data';
import type { MindMapViewContext } from './view-context';

/**
 * 施加拆分方案（单节点路径）：改写父节点（文本 + 逐字回写依据 + 链接字段）
 * → 逐个追加子节点。
 *
 * 父节点按「未编辑原文」回写（mdRaw = 方案给出的新行）：未被抽出的 token
 * 保持原文语法（如 `[[秋天.JPEG]]` 仍是链接），格式与链接都不丢。
 *
 * @returns 新增子节点数量
 */
export function applySplitPlan(
	view: MindMapViewContext,
	node: MindMapNode,
	plan: SplitLinkPlan,
): number {
	const mindMap = view.mindMap;
	// 引擎缺失时整体放弃：子节点插不进去，若仍改写父节点会让链接凭空消失
	if (!mindMap) {
		return 0;
	}
	writeSplitPlanToData(node.getData() as MdNodeData, plan);
	setNodeText(mindMap, node, plan.parentText);
	// 追加在末尾：与既有子节点顺序稳定（父行之后逐条列出）
	for (const child of plan.children) {
		insertChildNodeWithData(view, node, child.data);
	}
	view.scheduleSave();
	return plan.children.length;
}

/** 对指定节点执行拆分（无可拆内容返回 0；不提示，由调用方决定反馈方式） */
export function splitNodeLinks(
	view: MindMapViewContext,
	node: MindMapNode,
): number {
	const plan = planSplitLinks(
		node.getData() as MdNodeData,
		(node.children ?? []).map((child) => child.getData() as MdNodeData),
		// app 必须带上：拆分分析与序列化同口径（缺它图片会以 app:// 形态参与判定）
		view.app,
	);
	return plan ? applySplitPlan(view, node, plan) : 0;
}

/** 命令入口：对当前选中节点执行拆分并反馈（无选中节点时 requireActiveNode 已提示） */
export function splitActiveNodeLinks(view: MindMapViewContext): void {
	const node = requireActiveNode(view);
	if (!node) {
		return;
	}
	const count = splitNodeLinks(view, node);
	if (count === 0) {
		new Notice(t(view.lang, 'common.splitLinksNone'));
		return;
	}
	new Notice(tf(view.lang, 'common.splitLinksDone', { count }));
}

/**
 * 批量拆分：扫描当前文档**整棵数据树**，对所有可拆节点执行拆分。
 *
 * 与自动触发不同，本入口是**用户显式发起的批量动作**：不受
 * `autoSplitMixedLinks` 设置约束，也**会**处理未编辑的存量混排节点
 * ——这是把既有笔记一次性规整的手段（自动触发仍严格只碰被编辑的节点）。
 */
export function splitAllLinks(view: MindMapViewContext): SplitAllResult {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return { nodes: 0, links: 0 };
	}
	// getData() 为深拷贝：可安全就地改写，最后一次性全量替换
	const tree = mindMap.getData();
	const result = splitAllLinksInTree(tree, view.app);
	if (result.nodes === 0) {
		return result;
	}
	// 新增节点需要 uid（缺失/重复会让引擎按 uid 查找时误删/漏删）
	ensureUniqueUids(tree);
	mindMap.setData(tree);
	view.scheduleSave();
	return result;
}

/** 命令入口：全文档批量拆分并反馈 */
export function splitAllLinksInDocument(view: MindMapViewContext): void {
	const { nodes, links } = splitAllLinks(view);
	if (links === 0) {
		new Notice(t(view.lang, 'common.splitLinksNone'));
		return;
	}
	new Notice(tf(view.lang, 'common.splitLinksAllDone', { nodes, links }));
}

/**
 * 自动触发（设置 `autoSplitMixedLinks`，默认开）：只处理**文本已被编辑过**的
 * 节点——`text !== mdDerivedText` 是与解析期快照不同的持久信号，存量未编辑的
 * 混排节点绝不会被自动改写（决策 R3「仅被编辑节点」）。
 *
 * 幂等：拆分后父节点不再含可抽链接、子节点是纯链接节点，再触发即 no-op。
 *
 * @returns 新增子节点数量（0 = 未拆分）
 */
export function autoSplitActiveNode(view: MindMapViewContext): number {
	if (!view.plugin.settings.autoSplitMixedLinks) {
		return 0;
	}
	const mindMap = view.mindMap;
	if (!mindMap || isEditingText(mindMap)) {
		return 0;
	}
	const node = getActiveNode(mindMap);
	if (!node) {
		return 0;
	}
	const data = node.getData() as MdNodeData;
	if (
		typeof data.mdDerivedText !== 'string' ||
		data.text === data.mdDerivedText
	) {
		return 0;
	}
	return splitNodeLinks(view, node);
}
