/**
 * `Alt`（mac 为 `Option`）+ 拖拽节点 = **复制**而非移动。
 *
 * 对齐官方 Canvas：「Press Alt (or Option on macOS) and drag to duplicate the
 * selection」（`en/Plugins/Canvas.md`）。
 *
 * 为什么不在拖拽**之前**改语义：引擎的 Drag 插件在鼠标松手时自行消费落点
 * （`MOVE_NODE_TO` / `INSERT_AFTER`），插件侧无法在落点消费前插入自己的分支。
 * 故采用「**事后改写**」：
 * 1. 记录拖拽前的原父节点（会话建立时）；
 * 2. 松手后若**确实换了父**，先 `BACK`（引擎把一次拖拽记为一条历史，撤销即
 *    还原位置），再把**副本**插到松手命中的新父节点下；
 * 3. 未换父（原地松手）时不撤销，副本作为同级插入——原地复制同样成立。
 *
 * 边界（有意，与官方 Canvas 对齐）：复制的是**节点本身**（文字/链接/图片/附件
 * 字段），**不含子树**——官方 Canvas 的 Alt+拖复制的是选中的卡片（无层级概念），
 * 而引擎的 `INSERT_CHILD_NODE` 只接受节点数据、无「按子树插入」的命令（与
 * 「粘贴为子节点」同一能力面）。uid 剥除后由引擎重新分配（同 pasteNodeAsChild，
 * 沿用原 uid 会让引擎按 uid 查找/删除时误伤原节点）。
 */
import { ENGINE_COMMANDS } from '../engine/mindmap';
import { insertChildNodeWithData } from './view-common';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/**
 * Alt 拖拽落定后的复制处理。
 *
 * @param dragged      被拖节点（此时已在引擎完成移动）
 * @param originParent 拖拽前的父节点（用于判定「是否真的换了父」）
 */
export function duplicateAfterAltDrag(
	view: MindMapViewContext,
	dragged: MindMapNode,
	originParent: MindMapNode | null,
): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	const newParent = dragged.parent ?? null;
	if (!newParent) {
		return;
	}
	const moved = originParent !== null && originParent !== newParent;
	// 副本先取好（撤销会重建渲染节点，之后再取会拿到过期引用）
	const copy = cloneNodeData(dragged);
	try {
		if (moved) {
			mindMap.execCommand(ENGINE_COMMANDS.BACK);
		}
		insertChildNodeWithData(view, newParent, copy);
		view.scheduleSave();
	} catch (error) {
		console.error('Alt 拖拽复制失败', error);
	}
}

/**
 * 深拷贝节点数据并剥除 uid（与 pasteNodeAsChild 同款：
 * `uid` / `isActive` 由引擎在插入时自行处理，沿用旧值会撞号）。
 */
function cloneNodeData(node: MindMapNode): Record<string, unknown> {
	const data = node.nodeData?.data;
	const clone = (
		data ? JSON.parse(JSON.stringify(data)) : { text: '' }
	) as Record<string, unknown>;
	delete clone['uid'];
	delete clone['isActive'];
	return clone;
}
