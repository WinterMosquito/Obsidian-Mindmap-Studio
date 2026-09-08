/**
 * 跨特性共用的公共 helpers。
 * 从 view-node-actions.ts 迁出 requireActiveNode——view-image-actions 也依赖它，
 * 原先双向依赖形成运行时循环（view-node-actions re-export view-image-actions
 * 的函数，而 view-image-actions import view-node-actions 的 requireActiveNode）。
 * 迁出后两侧都依赖本文件，消除循环。
 */
import { Notice } from 'obsidian';
import { getActiveNode } from '../mindmap';
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
