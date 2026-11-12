/**
 * 跨视图应用会话快照的**唯一通道**（Level B，2026-11-09 实机探针定案）。
 *
 * ## 为什么不用 `updateData`
 * vendor `updateData(data)` = `handleData` → `renderer.setData` → `render` →
 * **`command.addHistory()`**。最后一步会：
 * 1. 往引擎历史里塞一条整树快照（接收视图的内存随编辑线性增长）；
 * 2. 发出 `data_change` —— 编辑期该事件的**唯一发源**（`Command.addHistory`）。
 * 接收视图的 `onRootDataChanged` / `onDataChanged` 因此会再排一次保存、再跑
 * 一遍标题改名 / 语法守卫 / 自动拆链（双写 + 重复编排）。
 *
 * `Command.pause()` 看似可用，但 `addHistory` 被 100 ms **延时节流**包装：
 * 同步 `pause → updateData → recovery` 之后那次 `addHistory` 仍会在防抖到期时
 * 执行；把暂停窗口拉长又会吞掉窗口内真实编辑的 `data_change`（等于丢保存）。
 *
 * ## 本实现 = `updateData` 去掉 `addHistory`
 * 实测（5000 节点、Obsidian 1.15.0）：历史不增、`data_change` 不发、
 * `node_tree_render_end` 一次、视口 `scale/x/y` 与选中态不变；耗时
 * ≈90–141 ms（与单节点局部编辑的整树渲染 79–103 ms 同量级，**不重建引擎**）。
 *
 * 仍需发 `before_update_data` / `update_data`：它们是引擎插件（协作 / 演示）
 * 依赖的生命周期事件，且**不产生**插件侧编排。
 */
import type { MindMap, MindMapTreeNode } from '../../vendor/simple-mind-map.cjs';

/** 引擎上本模块用到的私有面（防御式读取：版本差异只降级、不抛错） */
interface SnapshotCapableMindMap {
	handleData?: (data: MindMapTreeNode) => MindMapTreeNode | null;
	renderer?: { setData?: (data: MindMapTreeNode) => void };
}

/**
 * 把会话树应用到某个引擎（不发 `data_change`、不进引擎历史）。
 *
 * @param mindMap 目标引擎（未创建 / 已销毁时为 null，直接跳过）
 * @param tree    会话权威树的深拷贝（调用方保证不与会话共享引用）
 * @returns 是否真的应用（引擎未就绪 / 引擎接口缺失时 false，调用方稍后补）
 */
export function applySessionSnapshot(
	mindMap: MindMap | null | undefined,
	tree: MindMapTreeNode | null | undefined,
): boolean {
	if (!mindMap || !tree) {
		return false;
	}
	const target = mindMap as unknown as SnapshotCapableMindMap;
	const renderer = target.renderer;
	if (
		typeof target.handleData !== 'function' ||
		typeof renderer?.setData !== 'function'
	) {
		// 引擎版本差异：返回 false 交调用方走整树替换，不退回 `updateData`——
		// 它同样依赖这两个 API（且会多一条历史 + 一次 `data_change`），
		// 在缺失它们的引擎上必然抛错，属于永远不会成功的降级路径。
		return false;
	}
	try {
		const data = target.handleData(tree);
		if (!data) {
			return false;
		}
		mindMap.emit('before_update_data', data);
		renderer.setData(data);
		mindMap.render();
		mindMap.emit('update_data', data);
		return true;
	} catch (error) {
		console.error('应用会话快照失败', error);
		return false;
	}
}
