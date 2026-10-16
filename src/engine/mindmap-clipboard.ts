/**
 * 选中子树的复制/剪切/粘贴（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 语义与实现约束（顶层去重、文档序、剥 uid、过滤根节点、取值面必须是 `nodeData`）
 * 见 `collectSelectedSubtrees`——本模块的唯一取值面收口。
 */
import type {
	MindMap,
	MindMapNode,
	MindMapNodeData,
	MindMapTreeNode,
} from '../../vendor/simple-mind-map.cjs';
import { ENGINE_COMMANDS } from './mindmap-commands';
import { getActiveNodes } from './mindmap-nodes';

/**
 * 收集当前选中节点的**顶层子树数据**（复制到剪贴板的唯一取值面）。
 *
 * 与引擎自带 `Renderer.copyNode()` 同一套语义（顶层去重、文档序、剥激活态、
 * 剥 uid），但用**已入 d.cts 的节点面**（`parent` / `children` / `nodeData`）
 * 重写实现——引擎把 `getTopAncestorsFomNodeList` / `sortNodeList` /
 * `copyNodeTree` 留在内部工具里、未随包导出，直接读 `isAncestor` / `sortIndex`
 * 这类未声明字段属更高风险的私有触点。**唯一有意差异 = 过滤根节点**
 * （2026-10-15：`copyNode` 不过滤而 `cutNode` 过滤，本插件的粘贴落点是子节点，
 * 照搬 copy 口径会让「复制根节点」变成「把整篇文档嵌成自己的子节点」）。
 * 其余语义与 `copyNode` 逐条一致，且判定只在本文件出现。**取值面必须是 `nodeData`**：
 * 实机（2026-10-15）证实节点「收起**并重渲染后**，引擎会摘空其运行期 `children`」
 * （`nodeData.children` 完整保留）——改读运行期实例即「收起一棵子树＝复制/落盘丢整棵子树」。
 *
 * - **顶层去重**：选中的祖先优先（子树随祖先整棵带走，与引擎一致）；
 * - **文档序**：按渲染树先序遍历排名（非选中顺序，保证粘贴顺序稳定）；
 * - **剥 uid**：引擎 `INSERT_MULTI_CHILD_NODE` 对首次目标**保留**已有 uid
 *   （`createUidForAppointNodes(childList, false)`），同一文档内复制粘贴会
 *   产生重复 uid（按 uid 的删除/查找随即失准）；故深拷贝时逐层删除；
 * - 激活态不在此处剥离：插入时引擎会按 `addDataToAppointNodes` 逐层覆盖
 *   `isActive`（见 vendor/upstream `utils/index.js`）。
 *
 * @returns 深拷贝的子树（无选中节点时为空数组）
 */
export function collectSelectedSubtrees(
	mindMap: MindMap | null,
): MindMapTreeNode[] {
	// **过滤根节点**（与剪切路径同口径，2026-10-15 修复）：引擎 `copyNode`
	// 自身不过滤根（`cutNode` 才过滤，见 vendor `core/render/Render.js` 两方法），
	// 而本插件的粘贴落点是「选中节点 ?? 渲染根」的子节点——只选中根
	//（右键根节点「复制节点」/ Ctrl+A）时若把整棵树写进剪贴板，粘贴即把整篇
	// 文档嵌成自己的子节点，反复操作指数级膨胀。空结果交调用方走既有提示。
	const selected = getActiveNodes(mindMap).filter((node) => !node.isRoot);
	if (selected.length === 0) {
		return [];
	}
	const selectedSet = new Set(selected);
	const tops = selected.filter((node) => {
		let cursor = node.parent;
		while (cursor) {
			if (selectedSet.has(cursor)) {
				return false;
			}
			cursor = cursor.parent;
		}
		return true;
	});
	return rankByDocumentOrder(mindMap, tops).map((node) =>
		cloneSubtreeWithoutUid(node.nodeData),
	);
}

/**
 * 剪切选中节点并取回被剪数据（引擎 `CUT_NODE`：去根/去重/排序/移除/重绘）。
 *
 * ⚠ **空结果不得写剪贴板**：只选中根节点时引擎把根过滤掉、仍以空数组回调
 * （上游 `Render.js` 的 `cutNode`），照写会把用户的剪贴板清空。调用方据此
 * 保持剪贴板原样（见 `features/view-clipboard`）。
 *
 * @returns 被剪的顶层子树（无选中 / 仅根节点时为空数组）
 */
export function cutSelectedSubtrees(mindMap: MindMap | null): MindMapTreeNode[] {
	if (!mindMap) {
		return [];
	}
	let captured: MindMapTreeNode[] = [];
	mindMap.execCommand(ENGINE_COMMANDS.CUT_NODE, (copyData: unknown) => {
		captured = Array.isArray(copyData)
			? (copyData as MindMapTreeNode[])
			: [];
	});
	return captured.map((subtree) => cloneSubtreeWithoutUid(subtree));
}

/**
 * 把子树批量插入为指定父节点的子节点（粘贴的唯一落点实现）。
 *
 * 走引擎 `INSERT_MULTI_CHILD_NODE`（appointNodes = `[parent]`）：引擎自己补
 * uid、逐层展开与激活态覆盖，插件不需要「插入后取回新节点」（引擎没有该
 * 公开途径，见 `features/view-common.insertChildNodeWithData` 的说明）。
 *
 * @returns 是否已提交给引擎（引擎缺失 / 父节点缺失 / 无内容时为 false）
 */
export function insertSubtreesAsChildren(
	mindMap: MindMap | null,
	parent: MindMapNode | null,
	subtrees: readonly MindMapTreeNode[],
): boolean {
	if (!mindMap || !parent || subtrees.length === 0) {
		return false;
	}
	mindMap.execCommand(
		ENGINE_COMMANDS.INSERT_MULTI_CHILD_NODE,
		[parent],
		subtrees,
	);
	return true;
}

/** 节点在渲染树中的先序排名（未在树上者排在最后）；显式栈，超深树不栈溢出 */
function rankByDocumentOrder(
	mindMap: MindMap | null,
	nodes: readonly MindMapNode[],
): MindMapNode[] {
	const rank = new Map<MindMapNode, number>();
	const root = mindMap?.renderer.root;
	if (root) {
		const stack: MindMapNode[] = [root];
		let index = 0;
		while (stack.length > 0) {
			const node = stack.pop()!;
			rank.set(node, index++);
			const children = node.children ?? [];
			for (let i = children.length - 1; i >= 0; i--) {
				const child = children[i];
				if (child) {
					stack.push(child);
				}
			}
		}
	}
	const last = Number.MAX_SAFE_INTEGER;
	return [...nodes].sort(
		(a, b) => (rank.get(a) ?? last) - (rank.get(b) ?? last),
	);
}

/**
 * 深拷贝子树数据并逐层删除 `uid`（见 collectSelectedSubtrees 的剥 uid 说明）。
 * JSON 往返而非结构化克隆：节点 data 只含可序列化字段（引擎自身也按 JSON
 * 序列化保存），且这是历史剪贴板路径的既有口径。
 */
function cloneSubtreeWithoutUid(source: MindMapTreeNode): MindMapTreeNode {
	const cloneData = (
		data: MindMapNodeData | undefined,
	): MindMapNodeData => {
		const cloned = JSON.parse(
			JSON.stringify(data ?? {}),
		) as MindMapNodeData;
		delete cloned.uid;
		return cloned;
	};
	const root: MindMapTreeNode = {
		data: cloneData(source.data),
		children: [],
	};
	copyExtraNodeDataFields(source, root);
	const stack: { src: readonly MindMapTreeNode[]; dst: MindMapTreeNode[] }[] =
		[{ src: source.children ?? [], dst: root.children }];
	while (stack.length > 0) {
		const { src, dst } = stack.pop()!;
		for (const child of src) {
			const cloned: MindMapTreeNode = {
				data: cloneData(child.data),
				children: [],
			};
			copyExtraNodeDataFields(child, cloned);
			dst.push(cloned);
			stack.push({ src: child.children ?? [], dst: cloned.children });
		}
	}
	return root;
}

/**
 * 顶层字段拷贝：`data` / `children` 之外的**非 `_` 前缀**键一并带出
 * （2026-10-15 与 vendor 对齐）。
 *
 * 口径来源：`vendor/upstream/src/utils/index.js` 的 `copyNodeTree` 末尾会把
 * `nodeData` 上除 `data` / `children` / `_` 前缀以外的字段**浅拷**进结果。此前
 * 我们只拷 `data` + `children` ⇒ 引擎或插件将来在 `nodeData` 顶层加字段时，
 * 复制 / 粘贴会**静默丢字段**（当前 `d.cts` 只声明这两个字段，故无实害——纯契约
 * 对齐；浅拷同样照 vendor）。
 */
function copyExtraNodeDataFields(
	source: MindMapTreeNode,
	target: MindMapTreeNode,
): void {
	const src = source as unknown as Record<string, unknown>;
	const dst = target as unknown as Record<string, unknown>;
	for (const key of Object.keys(src)) {
		if (key === 'data' || key === 'children' || key.startsWith('_')) {
			continue;
		}
		dst[key] = src[key];
	}
}
