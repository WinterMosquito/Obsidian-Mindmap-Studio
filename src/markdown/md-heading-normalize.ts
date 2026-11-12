/**
 * 层级语法的**编辑期一致性守卫**：只修「会被解析成另一棵树」的排布，
 * 以及粘贴落点已定语法时的**插入前**换算。
 *
 * 判据与换算在 `md-heading-syntax`（基础面）；本模块只负责「扫哪一组、改到哪一级」。
 *
 * ## 判什么（2026-11-08 实机订正）
 * 早前按「同一兄弟组语法必须一致」判定——**过头了**：`- 组` + `# 标题甲`
 * 这种「列表在前、标题在后」的排布本来就能逐字往返，却在**打开文件时**被
 * 改写（用户没做任何操作，文件被改 + 提示刷屏）。现只判**真的会改结构**的排布：
 * 1. 列表项排在**同组标题之后** ⇒ 升级成同级标题（它能保住同级位置）；
 *    段落排在标题之后则报 blocked（段落不能写成标题行）；
 * 2. 组内标题级别**递增**（`#` 后接 `##`）⇒ 重定级到前一个标题的级别；
 * 3. 父级是**列表**却有标题子节点 ⇒ 就地整支降为列表（见下）；
 * 4. 父级是**段落**却有标题子节点 ⇒ 段落承载不了子级，报 `downgrade` 撤回；
 * 5. （由 1 派生的）升级目标整支里有围栏 / 任务项 / 有序项 / 段落 ⇒ 报
 *    `upgrade` 撤回；
 * 6. 父级已是 **6 级标题**却又挂标题子节点 ⇒ 就地降为列表（第 7 级没有标题）。
 * 7. **空的**新建节点（无 `mdType` / `mdMarker` 且无子节点）一律不动：序列化本就
 *    按上下文给它写标题（K98），换算只会把「按上下文现算」固化成数据，并在每次
 *    Enter 新建同级节点时弹一条「已改为标题」（屏上没有任何变化）。位置本身由
 *    `md-serialize` 的 `lastWasList` 保证——排在标题之后的未标注节点写标题、
 *    不写列表项。带子节点的新建节点照常换算（子标题要相对它重定级）。
 *
 * ## 双向归一（2026-11-08 用户裁决，K169）
 * 落点父的语法就是该层的语法：拖到 `-` 下的标题必须写成 `-`，否则重开会被
 * 解析到外层、结构必变。此前「只升不降」把这次拖拽整次 `BACK` 撤回，用户
 * 做不到 `# → -`；现在改为**就地降级整支**（`convertBranchToList`，只改 md 字段、
 * 不进撤销栈），与 6 级封顶的降级共用同一实现，Ctrl+Z 仍一步撤掉拖拽。
 * **代价（用户已接受）**：标题行承载的大纲条目与 `[[#标题]]` 锚点随之消失，
 * 插件不提示、不补偿；两类降级各有自己的 Notice 说明「已改为列表 / 可撤销」。
 * 段落父仍撤回：写成 `-` 也挂不到段落节点下，降级同样救不了父子关系。
 *
 * **同批数据保真（K170）**：列表父下的 `plain` **段落**也转列表项（无前缀行
 * 没有层级表达）；标题 / 列表互转保留 `mdMarker`，`*` / `+` 不会退化成 `-`；
 * 有序编号由解析层的 `mdOrderedNumber` 保真。
 */
import type { MindMapTreeNode } from '../core/engine-types';
import {
	MAX_HEADING_LEVEL,
	convertBranchToHeadings,
	convertBranchToList,
	dataOf,
	findHeadingBlocker,
	isHeadingNode,
	labelOf,
	levelOf,
	relevelHeadingBranch,
} from './md-heading-syntax';

/** 守卫里被拦下的节点（调用方据此撤回这次编辑） */
interface SyntaxBlockedAction {
	text: string;
	/**
	 * `upgrade` = 该位置必须是标题但此支转不了；`downgrade` = 段落父下挂着标题。
	 *
	 * `downgrade` 是**防御分支**：解析器不会产出「段落父 + 标题子」，拖拽落点也会
	 * 在写盘前被本分支挡下，正常操作到不了（K171）。
	 */
	kind: 'upgrade' | 'downgrade';
}

/** 编辑期归一的结果 */
export interface SyntaxNormalizeResult {
	/** 被改写的节点数（升标题 / 重定级 / 两类降为列表） */
	converted: number;
	/** 首个被升级的节点名（提示用；无升级时为空串） */
	firstUpgraded: string;
	/**
	 * 首个**只是重定级**的节点名（原本已是标题、级别被调到该层）。
	 *
	 * 与 `firstUpgraded` 分列：升级是「列表 → 标题」，重定级是「`##` → `#`」。
	 * 早前只记前者，纯重定级时提示拿到空名字（「已按该层语法把「」改为标题」，
	 * 2026-11-09 实机：`# 甲` + `## 乙` 拖成同级）。
	 */
	firstReleveled: string;
	/** 首个**因落在列表父下而降为列表**的节点名（提示用；无则为空串） */
	firstDowngraded: string;
	/** 首个**因超出 6 级而降为列表**的节点名（提示用；无降级时为空串） */
	firstDemoted: string;
	/**
	 * 本轮被降为列表的**标题节点数**（含列表父降级与超 6 级降级）。
	 *
	 * 与 `firstDowngraded` / `firstDemoted` 的分工：那两个是「首个名字」，本字段
	 * 回答「有多少个标题失去了标题身份」——`[[#标题]]` 锚点失效的范围，提示里
	 * 必须说清（2026-11-09，K178）。
	 */
	demotedHeadings: number;
	/** 无法自动归一、需调用方撤回的节点 */
	blocked: SyntaxBlockedAction[];
}

/** 粘贴换算的结果：`blocked` 非空 ⇒ 调用方不得插入（否则会造出非法排布） */
export interface SubtreeAdaptResult {
	converted: number;
	blocked: string[];
}

/** 一支里还有多少个标题节点（降级前数：降级后 mdType 就没了） */
function countHeadings(node: MindMapTreeNode): number {
	let count = 0;
	const stack: MindMapTreeNode[] = [node];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (isHeadingNode(dataOf(current))) {
			count++;
		}
		for (const child of current.children ?? []) {
			stack.push(child);
		}
	}
	return count;
}

/**
 * 扫全树，修掉会被读成另一棵树的排布（见文件头）。
 *
 * 只在**用户编辑之后**调用：加载出来的树来自 `md-outline`，那些排布
 * 一种都不可能出现（解析器的产物就是它们的反面），此刻判定只会误伤手写文件。
 *
 * 只改写 md 字段、**不进撤销栈**：调用方随后若发现 `blocked` 非空就撤回这次
 * 编辑（`BACK`），用户的 `Ctrl+Z` 因此仍是「一步撤掉拖拽 + 语法换算」。
 */
export function normalizeSiblingSyntax(
	root: MindMapTreeNode,
): SyntaxNormalizeResult {
	const result: SyntaxNormalizeResult = {
		converted: 0,
		firstUpgraded: '',
		firstReleveled: '',
		firstDowngraded: '',
		firstDemoted: '',
		demotedHeadings: 0,
		blocked: [],
	};
	const parents: { node: MindMapTreeNode; isRoot: boolean }[] = [
		{ node: root, isRoot: true },
	];
	while (parents.length > 0) {
		const frame = parents.pop()!;
		const children = frame.node.children ?? [];
		if (children.length === 0) {
			continue;
		}
		const parentData = dataOf(frame.node);
		// 列表父：标题子节点只能落成列表项（缩进层级能保住父子关系）
		const parentIsList = !frame.isRoot && parentData.mdType === 'list';
		// 段落父：段落行不承载子级，写成 `#` 或 `-` 都会被解析到外层 ⇒ 仍撤回
		const parentIsPlain = !frame.isRoot && parentData.mdType === 'plain';
		// 标题子节点必须**深于**父标题（级别 ≤ 父级时会被解析成父级的兄弟／外层节点）
		const parentLevel =
			!frame.isRoot && isHeadingNode(parentData) ? levelOf(parentData) : 0;
		const minChildLevel = parentLevel + 1;
		let lastHeadingLevel: number | null = null;
		for (const child of children) {
			const data = dataOf(child);
			if (isHeadingNode(data)) {
				if (parentIsList) {
					// 落点是 `-` 层：整支降为列表，text / mdRaw 一字不动（标题
					// 锚点随之失效，2026-11-08 用户裁决接受）。不设
					// lastHeadingLevel ⇒ 该组后面的列表兄弟不会被规则 1 误升。
					result.demotedHeadings += countHeadings(child);
					result.converted += convertBranchToList(child);
					if (!result.firstDowngraded) {
						result.firstDowngraded = labelOf(data);
					}
					// 整支已归一，递归只作幂等复查
					parents.push({ node: child, isRoot: false });
					continue;
				}
				if (parentIsPlain) {
					// 防御分支（生产不可达）：解析器不会产出「段落父 + 标题子」，
					// 拖拽落点会在写盘前被守卫撤回；保留是为了非法内存态 fail-safe
					result.blocked.push({ text: labelOf(data), kind: 'downgrade' });
					return result;
				}
				const current = levelOf(data);
				let target = Math.max(current, minChildLevel);
				// 同级标题级别递增 ⇒ 后者被读成前者的子节点
				if (lastHeadingLevel !== null && target > lastHeadingLevel) {
					target = lastHeadingLevel;
				}
				if (target > MAX_HEADING_LEVEL) {
					// 父已是 6 级：第 7 层起 Markdown 没有标题，这一支**只能**是列表
					// （`###### L6` 下面接缩进一层的 `- M6`，本来就合法）。
					// 这是唯一「结构上必然」的降级，故就地降级而不是撤回——
					// 早前判成 blocked，导致把分支拖到最深层时被拒、还弹
					// 「该层是无序列表…」的错误提示（2026-11-08 实机）。
					result.demotedHeadings += countHeadings(child);
					result.converted += convertBranchToList(child);
					if (!result.firstDemoted) {
						result.firstDemoted = labelOf(data);
					}
					continue;
				}
				if (target !== current) {
					const releveled = relevelHeadingBranch(child, target);
					result.converted += releveled;
					// 只有「真的动了」才记名字：目标级别与现级别相同时上面已跳过，
					// 但子孙可能全部已达标（返回 0）——那时提示不该点名
					if (releveled > 0 && !result.firstReleveled) {
						result.firstReleveled = labelOf(data);
					}
				}
				lastHeadingLevel = target;
				parents.push({ node: child, isRoot: false });
				continue;
			}
			if (parentIsList && data.mdType === 'plain') {
				// 列表父下段落同样没有层级表达（写盘后会被解析到最近的标题 / 根）
				// ⇒ 与标题降级同口径转成列表项
				result.converted += convertBranchToList(child);
				if (!result.firstDowngraded) {
					result.firstDowngraded = labelOf(data);
				}
				parents.push({ node: child, isRoot: false });
				continue;
			}
			if (lastHeadingLevel === null) {
				// 标题之前：合法（解析仍归属本层）——手写混排与既有文件都在这里。
				// 段落父下的列表子节点也落这里：段落行无缩进，序列化后子级会掉一层
				// （用户给段落手动加子节点的已知边界，K171，暂不处理）。
				parents.push({ node: child, isRoot: false });
				continue;
			}
			// **空的**新建节点（无 `mdType` / `mdMarker`，也没有子节点）不换算：
			// 序列化本就按上下文给它写标题（K98，且「排在标题之后」由 md-serialize
			// 的 `lastWasList` 保证不写成列表项），补 `mdType` 只是把「按上下文现算」
			// 固化成数据；而每次在标题节点上按 Enter 新建同级节点都会命中这里，
			// 弹一条「已改为标题」——屏上什么也没变，纯噪音。
			// **带子节点时不跳过**：子节点里已有的标题要相对本节点的层级重定级，
			// 而本节点没有 `mdLevel` 可依，跳过会让它们逃到外层（结构变了）。
			const hasChildren = (child.children ?? []).length > 0;
			if (
				!hasChildren &&
				data.mdType === undefined &&
				data.mdMarker === undefined
			) {
				parents.push({ node: child, isRoot: false });
				continue;
			}
			// 排在标题之后 ⇒ 会被读成前一个标题的子节点：升成同级标题
			const blocker = findHeadingBlocker(child, lastHeadingLevel);
			if (blocker) {
				result.blocked.push({ text: blocker, kind: 'upgrade' });
				return result;
			}
			result.converted += convertBranchToHeadings(child, lastHeadingLevel);
			if (!result.firstUpgraded) {
				result.firstUpgraded = labelOf(data);
			}
			parents.push({ node: child, isRoot: false });
		}
	}
	return result;
}

/**
 * 粘贴**插入前**换算：落点组已是标题语法时，把待插入的子树改成同级标题。
 *
 * 为什么在插入前做：先插列表再由守卫改写，中间会存在一刻非法数据（虽不落盘，
 * 但同一拍内的其它消费者会看到错形态）。`blocked` 非空时调用方必须**放弃这次
 * 插入**并提示——没有第二个安全落点（塞成子节点属擅自改结构）。
 *
 * 注意「落点组有标题」本身就意味着新节点会排在标题之后（追加在末尾），所以
 * 插入前换算就是必需的，不是优化。
 */
export function adaptSubtreesToGroup(
	parent: MindMapTreeNode,
	subtrees: readonly MindMapTreeNode[],
): SubtreeAdaptResult {
	const result: SubtreeAdaptResult = { converted: 0, blocked: [] };
	const siblings = parent.children ?? [];
	const headings = siblings.filter((child) => isHeadingNode(dataOf(child)));
	if (headings.length === 0) {
		return result;
	}
	const level = levelOf(dataOf(headings[0]!));
	for (const subtree of subtrees) {
		const blocker = findHeadingBlocker(subtree, level);
		if (blocker) {
			result.blocked.push(blocker);
			continue;
		}
		result.converted += convertBranchToHeadings(subtree, level);
	}
	return result;
}
