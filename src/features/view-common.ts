/**
 * 跨特性共用的公共 helpers。
 * 从 view-node-actions.ts 迁出 requireActiveNode——view-image-actions 也依赖它，
 * 原先双向依赖形成运行时循环（view-node-actions re-export view-image-actions
 * 的函数，而 view-image-actions import view-node-actions 的 requireActiveNode）。
 * 迁出后两侧都依赖本文件，消除循环。
 */
import { Notice } from 'obsidian';
import { ENGINE_COMMANDS, getActiveNode } from '../mindmap';
import { t } from '../i18n';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/**
 * 取当前激活节点；无则提示「请先选择一个节点」并返回 null。
 * 工具栏/右键各入口共用的前置守卫。
 */
export function requireActiveNode(view: MindMapViewContext): MindMapNode | null {
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
	}
	return node;
}

/**
 * 在指定父节点下插入子节点并携带初始数据（拖入/粘贴/新建承载节点的唯一入口）。
 *
 * 引擎没有「按插入结果取回新节点」的公开途径，初始数据必须一次给全；
 * 统一约定 `appointNodes = [parent]`（不依赖激活列表——引擎在 appointNodes 与
 * 激活列表均为空时直接 return，空数组会静默失效）与 `isActive: false`
 * （新节点不抢激活态）。父节点/引擎缺失时返回 false（调用方据此决定是否提示）。
 */
export function insertChildNodeWithData(
	view: MindMapViewContext,
	parent: MindMapNode | null,
	data: Record<string, unknown>,
): boolean {
	if (!parent) {
		return false;
	}
	const engine = view.mindMap;
	if (!engine) {
		return false;
	}
	engine.execCommand(ENGINE_COMMANDS.INSERT_CHILD_NODE, false, [parent], {
		...data,
		isActive: false,
	});
	return true;
}
