/**
 * 思维导图树遍历的唯一实现。
 *
 * 引擎数据树（MindMapTreeNode）与渲染节点树（MindMapNode）同为
 * 「children + 同构子节点」形态，此前 10 处各自手写递归/显式栈遍历；
 * 统一收敛到本模块：
 * - 先序（父先于子，子按原顺序）——与被替换的各处递归 forEach 语义一致；
 * - 显式栈替代递归：树深度由导入内容任意构造（深层 md/JSON），
 *   递归实现会触发 RangeError 栈溢出；
 * - visit 返回 false 可立即终止整棵树遍历（搜索命中即停的短路场景）。
 */

/** 可遍历树节点（运行时 children 可能缺失：解析/编辑中间态，按可选处理） */
export interface TreeNodeLike {
	children?: readonly TreeNodeLike[] | null;
}

/**
 * 先序深度优先遍历树（父节点先于子节点）。
 * @param visit  访问回调；返回 false 时立即终止整棵树的遍历
 */
export function walkTree<T extends { children?: readonly T[] | null }>(
	node: T,
	visit: (node: T) => void | false,
): void {
	// 逆序压栈使出栈顺序与 children 原顺序一致（等价递归先序）
	const stack: T[] = [node];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (visit(current) === false) {
			return;
		}
		const children = current.children;
		if (children) {
			for (let i = children.length - 1; i >= 0; i--) {
				stack.push(children[i]!);
			}
		}
	}
}
