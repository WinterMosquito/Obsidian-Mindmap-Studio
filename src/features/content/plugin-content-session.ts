/** 插件正文更新仍走节点原文提交管线，不另起 Vault 保存或撤销时间线。 */
import { readNodeDataString } from '../../core/node-data';
import { t } from '../../core/i18n';
import { findRenderNodeByUid, refreshNodesCustomContent, renderWithCallback } from '../../engine/mindmap';
import { FencedBlockConflictError, replaceFencedNodeBlock } from '../../markdown/md-codeblocks';
import { applyRawNodeContent } from './node-content-write';
import { preparePluginContents } from '../../platform/rendering/plugins/bridge';
import type { ViewNodeEditContext } from '../view/view-context';
import type { MindMap } from '../../core/engine-types';

export async function commitPluginBlock(
	view: ViewNodeEditContext, nodeId: string, index: number, expected: string, next: string | null,
): Promise<void> {
	const node = findRenderNodeByUid(view.mindMap, nodeId);
	if (!node) throw new Error(t(view.lang, 'pluginContent.nodeMissing'));
	const data = node.getData?.();
	const raw = readNodeDataString(data, 'mdRaw') || readNodeDataString(data, 'text');
	try {
		const changed = replaceFencedNodeBlock(raw, index, expected, next);
		if (changed !== raw) applyRawNodeContent(view, node, changed);
	} catch (error) {
		if (error instanceof FencedBlockConflictError) throw new Error(t(view.lang, 'pluginContent.blockChanged'));
		throw error;
	}
}

export async function preparePluginExport(mindMap: MindMap): Promise<void> {
	const ids = await preparePluginContents(mindMap);
	const nodes = Array.from(ids, id => findRenderNodeByUid(mindMap, id)).filter(node => node !== null);
	if (nodes.length) {
		refreshNodesCustomContent(mindMap, nodes);
		await renderWithCallback(mindMap);
	}
}
