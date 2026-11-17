/**
 * 节点原文提交的唯一业务管线：解析、图片校正、重排、历史、保存与后续通知。
 * 内联/弹窗、任务勾选、批量配色与联系共用；本模块不持有编辑 UI 或 DOM。
 */
import { markNodeNeedLayout, recordHistory } from '../engine/mindmap';
import { ensureDefaultImageSizes, resolveImagePath, walkImageSizeCorrections } from '../media/images-path';
import { applyRawToNode } from '../markdown/md-line-write';
import type { MdNodeData } from '../core/node-data';
import type { MindMapNode } from '../core/engine-types';
import type { ViewNodeEditContext } from './view-context';

/**
 * 原文写回的收尾选项（只管**提交之后**做什么；写入语义由 `applyRawToNode` 决定）。
 *
 * - `afterCommit`：默认 `true` —— 提交后编排（自动拆链 / 中心主题改名 / 节点
 *   计数）。任务勾选只改行首三个字符，不该触发结构变更，故传 `false`。
 *
 * 历史**没有开关**：本通道一次提交恒记一条快照（见 `engine/mindmap-history.
 * recordHistory`）。批量场景（多选改色）不必逐条跳过——引擎 `addHistory` 自带
 * 100ms 防抖，窗口内的连续写入天然合并成一条。
 */
export interface RawWriteOptions {
	afterCommit?: boolean;
}

/**
 * 原文模式提交：重解析写入 + 图片地址/尺寸校正 + 重渲染 + 保存 + 提交通知。
 *
 * 内联编辑器与弹窗原文模式**共用本入口**（搬迁自 view-node-actions，
 * 弹窗分支 import 本函数——避免两个模块互相 import 成环）。
 *
 * 提交通知（`notifyNodeContentCommitted`，K108）：本入口不改引擎命令通道，
 * 故不派发 `data_change` / `node_text_edit_change`；而中心主题改名文件与
 * 「编辑后自动拆分混排双链」都挂在引擎事件上。提交后显式通知视图补齐编排，
 * 使插件侧两条编辑通道与引擎编辑框行为一致（在此之前这两项功能在默认自绘
 * 渲染下静默失效）。
 *
 * 撤销（K150 ⑤）：本通道同样不走引擎命令，故收尾显式记一条快照——否则历史
 * 序列里没有这次编辑，一次 `Ctrl+Z` 会连带回退更早的改动。
 *
 * 图片：原文里可能新增/更换了引用 —— 库内路径须换成资源地址（与加载期同一入口
 * `resolveImagePath`）；尺寸先填默认值（K97：未设置尺寸一律默认大小），带官方
 * 尺寸参数时异步应用参数尺寸（完成后补一次渲染）。无图片时（绝大多数）不做
 * 任何额外工作。
 */
export function applyRawNodeContent(
	view: ViewNodeEditContext,
	node: MindMapNode,
	raw: string,
	options: RawWriteOptions = {},
): void {
	applyRawNodeContents(view, [{ node, raw }], options);
}

/**
 * **批量**原文提交（多条一次性落地）。
 *
 * 为什么需要它：建立一条联系要改**两行**（源节点的 `%%rel%%` + 目标节点的
 * `%%id%%`），逐条调用会让 5000 节点的图**渲染两遍**、存两遍、记两条历史。
 * 本函数把「渲染 / 保存 / 历史」各收敛为一次；`afterCommit` 的语义与单项版一致。
 *
 * @param entries 要写入的节点与它的**新原文**（顺序即渲染前的应用顺序）
 */
export function applyRawNodeContents(
	view: ViewNodeEditContext,
	entries: readonly { node: MindMapNode; raw: string }[],
	options: RawWriteOptions = {},
): void {
	if (entries.length === 0) {
		return;
	}
	for (const { node, raw } of entries) {
		applyEntry(view, node, raw);
	}
	view.mindMap?.render();
	view.scheduleSave();
	// 历史：本通道不走引擎命令，不显式记一条的话撤销会跳过这次编辑
	//（快照序列里没有它，Ctrl+Z 直接回到更早的状态）
	recordHistory(view.mindMap);
	// K108：补齐引擎命令通道才会派发的后续编排（中心主题改名文件 /
	// 编辑后自动拆分混排双链 / 节点计数）——必须在渲染与保存之后，
	// 与引擎编辑框提交同序。任务勾选、联系建边等结构无关写入可关掉
	//（见 RawWriteOptions）。
	if (options.afterCommit !== false) {
		for (const { node } of entries) {
			view.notifyNodeContentCommitted(node);
		}
	}
}

/** 单项落地：解析写入 + 图片地址/尺寸校正 + 标记需要重排 */
function applyEntry(
	view: ViewNodeEditContext,
	node: MindMapNode,
	raw: string,
): void {
	const data = node.getData() as MdNodeData;
	applyRawToNode(data, raw);
	if (typeof data.image === 'string' && data.image) {
		data.image = resolveImagePath(data.image, view.app);
		// 引擎硬要求 image 节点必有 imageSize（缺失即解构抛错、渲染链中断）：
		// 原本无图的节点被编辑成图片时没有旧值可沿用，先填默认值再渲染
		//（K97：未设置尺寸一律默认大小，故默认值即最终尺寸）；带官方尺寸
		// 参数（![[图|300]]）时异步应用参数尺寸（ensureDefaultImageSizes 注释
		// 有 vendor 证据）
		ensureDefaultImageSizes({ data, children: [] });
		void walkImageSizeCorrections({ data, children: [] })
			.then(() => {
				markNodeNeedLayout(node);
				view.mindMap?.render();
			})
			// 探测失败不致命：默认尺寸已由上行的 ensureDefaultImageSizes 填好，
			// 且本函数末尾已有一次 markNodeNeedLayout + render —— 此处只需把错误
			// 留痕，不能让它变成未处理拒绝（K97：未设尺寸＝默认大小即安全终态）。
			.catch((error: unknown) => {
				console.warn('图片尺寸探测失败，保持默认尺寸', error);
			});
	}
	markNodeNeedLayout(node);
}
