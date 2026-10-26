/**
 * 选中子树的复制/剪切/粘贴（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 语义与实现约束（顶层去重、文档序、过滤根节点、取值面必须是 `nodeData`）
 * 见 `collectSelectedSubtrees`——本模块的唯一取值面收口。
 *
 * **只读、不克隆**（2026-10-26 优化 A）：返回的是引擎树上的 `nodeData` 本身，
 * 仅供 `serializeSubtreesToOutline` **同步**读出 Markdown 文本。复制/剪切写出的
 * 是字符串，uid 根本不会进文本，深拷贝 + 逐层剥 uid 是纯开销（500 节点实测
 * 0.3ms + 一份整树内存）。调用方**不得改写**返回值；若日后要恢复「复制为数据、
 * 粘贴回引擎」的通道，克隆与剥 uid 必须加在那条通道上，不要加回这里。
 */
import type {
	MindMap,
	MindMapNode,
	MindMapTreeNode,
} from '../../vendor/simple-mind-map.cjs';
import { ENGINE_COMMANDS } from './mindmap-commands';
import { getActiveNodes, getRenderRoot } from './mindmap-nodes';

/**
 * 收集当前选中节点的**顶层子树数据**（复制到剪贴板的唯一取值面）。
 *
 * 与引擎自带 `Renderer.copyNode()` 同一套**选面**语义（顶层去重、文档序），
 * 但用**已入 d.cts 的节点面**（`parent` / `children` / `nodeData`）
 * 重写实现——引擎把 `getTopAncestorsFomNodeList` / `sortNodeList` /
 * `copyNodeTree` 留在内部工具里、未随包导出，直接读 `isAncestor` / `sortIndex`
 * 这类未声明字段属更高风险的私有触点。**唯一有意差异 = 过滤根节点**
 * （2026-10-15：`copyNode` 不过滤而 `cutNode` 过滤，本插件的粘贴落点是子节点，
 * 照搬 copy 口径会让「复制根节点」变成「把整篇文档嵌成自己的子节点」）。
 * 其余选面语义与 `copyNode` 逐条一致，且判定只在本文件出现。**取值面必须是
 * `nodeData`**：实机（2026-10-15）证实节点「收起**并重渲染后**，引擎会摘空其
 * 运行期 `children`」（`nodeData.children` 完整保留）——改读运行期实例即
 * 「收起一棵子树＝复制/落盘丢整棵子树」。
 *
 * - **顶层去重**：选中的祖先优先（子树随祖先整棵带走，与引擎一致）；
 * - **文档序**：按渲染树先序遍历排名（非选中顺序，保证粘贴顺序稳定）；
 * - **不克隆、不剥 uid**：返回值是引擎树上的**只读**数据，仅供同步序列化；
 *   uid 不进 Markdown 文本（2026-10-26 优化 A，见文件头）；
 * - **不碰激活态**：引擎 `copyNode` 剥的是节点实例上的 `isActive`，`nodeData` 无该字段。
 *
 * @returns 引擎树上的只读子树（无选中节点、或**只选中了根**时为空数组；
 *   调用方不得改写。空结果由 `features/view-clipboard.copySelectedNodes` 决定
 *   下一步——它把空结果当「无选中」回退到整图大纲，不再弹「请先选择节点」）
 */
export function collectSelectedSubtrees(
	mindMap: MindMap | null,
): MindMapTreeNode[] {
	// **过滤根节点**（与剪切路径同口径，2026-10-15 修复）：引擎 `copyNode`
	// 自身不过滤根（`cutNode` 才过滤，见 vendor `core/render/Render.js` 两方法），
	// 而本插件的粘贴落点是「选中节点 ?? 渲染根」的子节点——只选中根
	//（右键根节点「复制节点」/ Ctrl+A）时若把整棵树写进剪贴板，粘贴即把整篇
	// 文档嵌成自己的子节点，反复操作指数级膨胀。空结果交调用方决定——现按
	// 「无选中」回退整图（`copySelectedNodes`），因此只选中根时 Ctrl+C = 复制全图。
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
	return rankByDocumentOrder(mindMap, tops).map((node) => node.nodeData);
}

/**
 * 整张图的**大纲源数据**（`Ctrl+C` 无选中时的落点）：根节点整棵子树。
 *
 * 与 `collectSelectedSubtrees` 的唯一差别是**不过滤根**：无选中时用户要的就是
 * 「整张图」，中心主题（即文件标题）必须作首行，否则复制出的文本没有标题。
 * 代价：把这份大纲粘回同一张图的根下会得到「中心主题的副本」子树——这是用户
 * 显式复制全图后的粘贴动作，与「选中子树复制」同语义（复制什么就粘什么），
 * 不再按误操作拦截（2026-10-26 用户裁决）。
 *
 * 返回**引擎树上的只读数据**（不克隆，见文件头）；调用方不得改写。
 *
 * @returns 只含一个元素的数组；渲染树未就绪（首帧前 / 销毁中）时为空
 */
export function collectWholeTreeSubtrees(
	mindMap: MindMap | null,
): MindMapTreeNode[] {
	const root = getRenderRoot(mindMap);
	return root ? [root.nodeData] : [];
}

/**
 * 剪切选中节点并取回被剪数据（引擎 `CUT_NODE`：去根/去重/排序/移除/重绘）。
 *
 * ⚠ **空结果不得写剪贴板**：只选中根节点时引擎把根过滤掉、仍以空数组回调
 * （上游 `Render.js` 的 `cutNode`），照写会把用户的剪贴板清空。调用方据此
 * 保持剪贴板原样（见 `features/view-clipboard`）。
 *
 * 回调数据已是引擎 `copyNodeTree` 产出的**独立副本**（`removeId`/`removeActiveState`
 * 均取默认 true ⇒ 不含 uid / `isActive`，`_` 前缀字段也不带出），且插件只把它
 * **同步**序列化成文本 ⇒ 这里不再二次克隆（2026-10-26 优化 A）。
 *
 * ⚠ 回调是**同步**的（vendor `Render.cutNode` 末尾直接 `callback(copyData)`），
 * 所以 `captured` 在 `execCommand` 返回时就已填好。若日后引擎改成异步回调，
 * 本函数必须改成 Promise——否则会静默返回空数组。
 *
 * @returns 被剪的顶层子树（无选中 / 仅根节点时为空数组；调用方不得改写）
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
	return captured;
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
	// 走防腐面而不是直读 `mindMap.renderer.root`：两级判空只在 `getRenderRoot` 一处
	const root = getRenderRoot(mindMap);
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
