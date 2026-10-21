/**
 * 节点查询与工具的防腐收口 + 节点文本编辑（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 覆盖：节点/DOM 反查、节点文本与图片尺寸、自绘内容重建、兄弟上/下移、
 * 以及 `renderer.textEdit` / `node_dblclick` 两个引擎内部状态的收口。
 */
import type {
	MindMap,
	MindMapNode,
	MindMapTreeNode,
} from '../../vendor/simple-mind-map.cjs';
import { walkTree } from '../domain/tree';
import { createWarnOnce } from '../core/errors';
import { readNodeDataString } from '../core/node-data';
import { ENGINE_COMMANDS } from './mindmap-commands';
import { scheduleEngineTimer } from './mindmap-timers';

/** 当前激活（选中）的节点；无则返回 null */
export function getActiveNode(mindMap: MindMap | null): MindMapNode | null {
	return mindMap?.renderer ? mindMap.renderer.activeNodeList[0] ?? null : null;
}

/** 递归统计树节点数量（数据树/渲染节点树同构，均可用） */
export function countTreeNodes<T extends { children?: readonly T[] | null }>(
	tree: T | null,
): number {
	if (!tree) {
		return 0;
	}
	let count = 0;
	walkTree(tree, () => {
		count++;
	});
	return count;
}

/**
 * 根据 DOM 元素查找对应节点：按「节点渲染 group 包含目标元素」的对象身份匹配。
 * 旧实现读取节点 DOM 上的 data-uid 属性——vendor 契约冒烟测试证实引擎
 * 从不写入该属性（bundle 全文零处），旧匹配恒失败；改为遍历渲染树用
 * group 元素身份匹配（group 为引擎内部字段，访问收口在本函数）。
 */
export function findNodeByDom(
	mindMap: MindMap | null,
	el: Element,
): MindMapNode | null {
	if (!mindMap?.renderer) {
		return null;
	}
	const root = mindMap.renderer.root;
	if (!root) {
		return null;
	}
	let result: MindMapNode | null = null;
	walkTree(root, (node) => {
		const group = getNodeGroupEl(node);
		// contains 对元素自身也返回 true，命中 group 本身或其内部子元素
		if (group?.contains(el)) {
			result = node;
			return false; // 命中即终止整树遍历
		}
		return undefined;
	});
	return result;
}

/**
 * **批量**反查多个元素所在节点：一次遍历 + 祖先链查表。
 *
 * ## 为什么需要它
 *
 * `findNodeByDom` 每次调用都独立走一遍全树 `walkTree`，在「一批元素」场景下是
 * O(元素数 × 节点数)：① `view.flushMathRemeasure` 逐个 holder 反查；②
 * `findNodesByMathProducts` 逐个数学产物元素反查。二者都是**同一个渲染树**上的
 * 批量查询，逐个全树遍历是纯浪费（公式节点多的大图上是平方级）。
 *
 * ## 为什么祖先链查表等价于 `contains`
 *
 * `Node.contains(el)` 为真 ⟺ `el` 是该节点的 DOM 后代（含自身）。而「后代」必然
 * 在 `el.parentElement` 构成的祖先链上——所以**沿 el 的祖先链逐级查表**与全树
 * `contains` 扫描在结果上等价：命中的是「最近的、已登记为某节点 group 的祖先」
 * （与 `findNodeByDom` 的 `return false` 命中即停语义一致——先命中者在树上更浅，
 * `walkTree` 先序遍历也是先命中更浅者）。
 *
 * ⚠ **等价性的前提**：`el` 与 `group` 处在**同一棵 DOM 树、其间无 shadow boundary
 * 隔断**。跨越 shadow root 时 `parentElement` 链会在边界处断为 `null`，而
 * `contains` 仍可能为真 ⇒ 查表必然落空并走下面的回落分支。本插件不产出 shadow
 * DOM（自绘内容走 `foreignObject`，其 `parentElement` 链正常穿透到节点 group），
 * 故该前提在当前代码面恒成立；此处的说明只是标明**若将来引入 shadow DOM，这条
 * 快路径会退化为回落路径**（结果仍正确，只是失去 O(d) 优势）。
 *
 * ## 复杂度
 *
 * 一次 `walkTree` 建表 O(n)，每个元素 O(祖先链深度 d)。SVG 嵌套层级有限，d 通常
 * < 20 ⇒ 总体 O(n + 元素数 × d)，取代 O(元素数 × n)。
 *
 * ## 正确性兜底
 *
 * 查表未命中的元素**逐个回落** `findNodeByDom`（全树 `contains` 扫）。这处理了
 * 「group 元素在 `walkTree` 之后被引擎换掉」等建表后树变动的情形——宁可慢，不可错。
 *
 * **返回逐位置对应**（`els[i]` 的结果在 `[i]`），不去重、不改变长度：调用方要能
 * 区分「命中」与「未命中」（`view.flushMathRemeasure` 正是据此把落空的 holder
 * 存入待重试集合）。需要去重列表的调用方自行过滤。
 *
 * @param els 待反查元素（允许重复与已脱离 DOM 的元素）
 * @returns 与 `els` 等长的数组，元素为命中节点或 `null`；引擎未就绪返回全 `null`
 */
export function resolveNodesByDoms(
	mindMap: MindMap | null,
	els: readonly Element[],
): (MindMapNode | null)[] {
	if (!mindMap?.renderer || els.length === 0) {
		return els.map(() => null);
	}
	const root = mindMap.renderer.root;
	if (!root) {
		return els.map(() => null);
	}
	// 一次遍历建「group 元素 → 节点」表
	const byGroup = new Map<Element, MindMapNode>();
	walkTree(root, (node) => {
		const group = getNodeGroupEl(node);
		if (group) {
			byGroup.set(group, node);
		}
		return undefined;
	});
	return els.map((el) => {
		// contains 含自身，故从 el 自身起查
		for (let cur: Element | null = el; cur; cur = cur.parentElement) {
			const hit = byGroup.get(cur);
			if (hit) {
				return hit;
			}
		}
		// 未命中 → 回落全树 contains（覆盖建表后树变动的情形）
		return findNodeByDom(mindMap, el);
	});
}

/**
 * 按**自绘内容产物元素**反查所在渲染节点（K100；2026-10-07 起含代码块）。
 *
 * 用途：**自绘内容替换/高亮定稿后** holder 可能已脱离 DOM——引擎在
 * 「定稿 → 批量重排」的等待窗口内又发生了一次全树重渲染（如图片尺寸回灌，见
 * K96），占位 holder 随重建被丢弃，`findNodeByDom(holder)` 因此落空；而**活 DOM
 * 中的产物元素**可据其反查节点。选择器**三通道**：
 * - `.mindmap-node-inline-math`：数学 holder 类（MathJax 替换后保留、与产物输出
 *   形态无关，稳定锚点）；
 * - `.mjx-container`：CHTML 产物容器（兼容兜底；MathJax 走 tex2svg 时无此类）；
 * - `.tmm-code-hl`：代码块高亮 holder 类（K116 审查修复，见下）。
 *
 * ⚠ K104 修正：此前只查 `.mjx-container`——MathJax 走 **tex2svg** 的环境
 * （产物为 `<svg>`、无该容器类）反查 0 命中，回退整体失效（用户实测：首帧
 * 公式节点尺寸不同步 + 告警「未能定位归属节点」；重开时产物缓存命中、构建期
 * 同步放置，故表现为「仅首次失败」）。
 *
 * ⚠ 2026-10-07 审查修复：代码块高亮定稿复用**同一条**尺寸同步流水线，此前本函数
 * 只认数学产物 ⇒ 代码块 holder 落空时兜底捞不到它，而若地图里存在数学节点，
 * `nodes.length > 0` 会让代码块**被静默跳过、不重测也不告警**（内容裁切且无痕，
 * K85 ① 教训）。现补入 `.tmm-code-hl` 通道。
 *
 * 实现：从渲染树**根节点的 group** 上溯到所属 `<svg>`（同一视图内所有节点
 * DOM 的共同祖先，天然限定本视图、不受同页其它导图干扰），一次查询后逐个
 * `findNodeByDom` 归一。只在 holder 解析失败的回退路径调用（按需、一次、
 * 公式/代码块节点通常很少）。
 */
export function findNodesByContentProducts(
	mindMap: MindMap | null,
): MindMapNode[] {
	const root = getRenderRoot(mindMap);
	if (!mindMap || !root) {
		return [];
	}
	const svg = getNodeGroupEl(root)?.closest('svg');
	if (!svg) {
		return [];
	}
	// 选择器**三通道**：`.mindmap-node-inline-math` 是**我方 holder 类**
	//（MathJax 替换后仍保留，与产物输出形态无关）∪ `.mjx-container`（CHTML
	// 产物容器，兼容兜底）∪ `.tmm-code-hl`（**代码块高亮 holder**，2026-10-07 审查
	// 修复：代码块定稿回调复用同一条尺寸同步流水线，此前兜底只认数学 → holder 随
	// 全树重建脱离时**静默跳过该代码块的重测**（foreignObject 仍是按字面量的尺寸
	// ⇒ K114 同类裁切），且因「兜底捞到了别的数学节点」而不触发告警）。
	// ⚠ 此前只匹配 `.mjx-container`：MathJax 走 **tex2svg** 的环境（产物为
	// `<svg>`、无该容器类）反查 0 命中 → 回退整体失效 → 首帧公式节点尺寸
	// 不同步（用户实测：告警「未能定位归属节点」+ 公式区域缺失；重开时产物
	// 缓存命中、构建期同步放置，故正常）。holder 类名不受替换影响，是稳定锚点。
	const products = Array.from(
		svg.querySelectorAll(
			'.mindmap-node-inline-math, .mjx-container, .tmm-code-hl',
		),
	);
	// 批量反查：一次遍历建表 + 逐元素沿祖先链查表，取代逐元素全树
	// walkTree（O(产物数 × 节点数)）。未命中元素由 resolveNodesByDoms 内部回落
	// 全树扫描。去重后返回（同一节点可能同时命中 holder 与其产物容器）。
	const out = new Set<MindMapNode>();
	for (const node of resolveNodesByDoms(mindMap, products)) {
		if (node) {
			out.add(node);
		}
	}
	return [...out];
}

/** 当前全部激活（选中）节点（引擎渲染器内部字段的防腐收口） */
export function getActiveNodes(mindMap: MindMap | null): MindMapNode[] {
	return mindMap?.renderer ? [...mindMap.renderer.activeNodeList] : [];
}

/** 当前渲染树的根节点（性能模式/初始化中间态等场景可能为 null） */
export function getRenderRoot(mindMap: MindMap | null): MindMapNode | null {
	return mindMap?.renderer.root ?? null;
}

/**
 * 整棵**渲染树**的节点数（大图判定、状态栏计数共用口径）。
 *
 * 为什么按渲染树而不是 DOM：性能模式的 `removeSelf` 只把 group 摘下、不改
 * `parent.children`（实证见 `features/view-status` 文件头），故渲染树恒为全量
 * ——视口外节点照样计数，也不受剪枝影响，零 DOM 查询。
 *
 * 此前「`countTreeNodes(getRenderRoot(mm))`」这层组合在 3 处各写一遍（状态栏、
 * 大图 fit 提示、fit 比例下限），新增调用方一律走本函数。
 */
export function countMindMapNodes(mindMap: MindMap | null): number {
	return countTreeNodes(getRenderRoot(mindMap));
}

/** 节点渲染 group 的根 DOM 元素（hover-link 等场景的锚点；group 为引擎内部字段） */
export function getNodeGroupEl(node: MindMapNode): Element | null {
	const group = (node as unknown as { group?: { node?: Element } }).group;
	return group?.node ?? null;
}

/**
 * 读取节点 data 的字符串字段（防腐收口：getData 返回 unknown，
 * 此前 `(node.getData?.('x') as string) || ''` 式强转散布于各 view-* 模块；
 * 空值/非字符串一律归一为空串）。
 */
export function getNodeDataString(node: MindMapNode, key: string): string {
	// 归一语义的唯一实现在 core/node-data（本入口只做「按节点取 data」这一步）
	return readNodeDataString(
		node.getData?.() as Record<string, unknown> | null | undefined,
		key,
	);
}

/** 更新节点文本：先改节点数据，再经引擎命令同步并重绘 */
export function setNodeText(
	mindMap: MindMap,
	node: MindMapNode,
	text: string,
): void {
	node.nodeData.data.text = text;
	try {
		mindMap.execCommand(ENGINE_COMMANDS.SET_NODE_DATA, node, { text });
	} catch (error) {
		// SET_NODE_DATA 不可用等情形：数据已直接写入 nodeData，交给随后的
		// render 全量重绘兜底；仅记录，不打扰用户。
		console.warn('SET_NODE_DATA 执行失败，已直接写入节点数据:', error);
	}
	mindMap.render();
}

/**
 * 用新数据树**替换**当前内容，且**保留撤销历史**——一次 `Ctrl+Z` 回到替换前。
 *
 * 为什么不用引擎的 `setData`（vendor `simple-mind-map.cjs` 实测）：
 * `setData` = `CLEAR_ACTIVE_NODE` → **`command.clearHistory()`** → `addHistory()`
 * → `renderer.setData()`：历史被清成「只剩新状态一条」，此后 `BACK`/`FORWARD`
 * **永远无事发生**（用户实测：「拆分双链后 Ctrl+Z 失效」）。
 * `updateData` = `renderer.setData()` → `render()` → `command.addHistory()`，
 * 只把新状态**追加**为一条历史（快照取自 `renderer.renderTree`），撤销链完整。
 * `updateData` 未入 d.cts，故按 engine/ 层既有口径做窄化透传。
 *
 * 先 `CLEAR_ACTIVE_NODE`（与 `setData` 同语义，且该命令不进历史）：换树后全部
 * 节点实例重建，旧引用作废——留着会被「删除/编辑激活节点」等命令误用。
 */
export function replaceMindMapData(
	mindMap: MindMap | null,
	tree: MindMapTreeNode,
): void {
	if (!mindMap) {
		return;
	}
	try {
		mindMap.execCommand(ENGINE_COMMANDS.CLEAR_ACTIVE_NODE);
		const target = mindMap as unknown as {
			updateData?: (data: MindMapTreeNode) => void;
		};
		if (typeof target.updateData === 'function') {
			target.updateData(tree);
		} else {
			// 引擎不提供 updateData（版本差异）时退回 setData：能落数据，
			// 代价是撤销链断开——宁可丢历史，不可丢用户操作
			mindMap.setData(tree);
		}
	} catch (error) {
		console.error('替换导图数据失败', error);
	}
}

/**
 * 标记节点需要重建内容：引擎只在节点内部 `needLayout` 为真时重建该节点
 * （前缀图标 / 文本等），仅改 data 不会刷新。影响渲染的数据变更后调用。
 */
export function markNodeNeedLayout(node: MindMapNode): void {
	(node as unknown as { needLayout?: boolean }).needLayout = true;
}

/**
 * 重建节点的**自绘内容**（方案 B：`customCreateNodeContent`）。
 *
 * 引擎只在 `createNodeData` 的 keys **含 'custom'** 时重新调用自绘钩子；整树
 * `render()`、单节点 `needLayout` 都**不会**重建（无头浏览器实测：拖宽后内容元素
 * 的 style 原封不动、节点高度仍是旧值）。而自绘节点的宽度/高度**全部来自该元素
 * 的离屏测宽**——不重建就等于「宽度改了、折行没改、高度不跟随」（2026-09-16
 * 用户实测缺陷：「节点内文字过多时，拖动边框改宽，节点上下高度不变」）。
 *
 * 故插件侧在引擎「拖左右边框改宽」结束（`dragModifyNodeWidthEnd`）后必须补这一下。
 */
export function refreshNodeCustomContent(
	mindMap: MindMap | null,
	node: MindMapNode,
): void {
	// 单节点＝批量入口的一个元素：`reRender` **缺失时的告警**（K88 教训）与
	// 「N 个节点只 render 一次」的收敛都在 refreshNodesCustomContent 里——此前
	// 本入口自写一份 `reRender?.()`（可选链静默 no-op），那道防线只守住了一半。
	// 入参类型非空，故直接构造单元素数组（旧的 `node ? [node] : []` 是死分支）。
	refreshNodesCustomContent(mindMap, [node]);
}

/**
 * 「传入对象不可重排」告警留痕（同一根因整会话只提示一次）。
 * 去重与前缀由 `core/errors.createWarnOnce` 统一实现（2026-10-11 收口）。
 */
const warnMissingReRender = createWarnOnce();

/**
 * 节点是否**尺寸塌陷**（布局层宽或高为 0）——自绘内容「可见性自愈」的判据。
 *
 * 为什么需要它（2026-10-14 实机复现）：自绘内容的量测容器挂在 `mindMap.el`
 * 内部，叶子不可见（后台标签 / 启动恢复，`display:none`）时任何量测恒为
 * 0×0；这类 0 一旦落到节点上，切回前台**没有任何路径**会重测（`resize()` 只按
 * 现有尺寸重排），表现为公式节点连线收束成一点。自愈需要一个「症状」判据，
 * 本函数即该判据的唯一实现（`width`/`height` 是引擎节点实例字段，未入 d.cts，
 * 故按防腐口径收口在本文件）。
 */
export function isNodeCollapsed(node: MindMapNode): boolean {
	const sized = node as unknown as { width?: unknown; height?: unknown };
	const width = typeof sized.width === 'number' ? sized.width : 0;
	const height = typeof sized.height === 'number' ? sized.height : 0;
	return !(width > 0) || !(height > 0);
}

/**
 * **批量**重建多个节点的自绘内容（同 `refreshNodeCustomContent` 语义）。
 *
 * 用于「数学异步替换定稿后同步节点尺寸」（P4）：含数学的节点可能
 * 在同一帧内成批定稿（一次打开多个公式），若逐个走 `refreshNodeCustomContent`
 * 会各触发一次**全树** `render()`。此处逐节点 `reRender(['custom'])`、
 * **最后一次** `render()`——N 个节点 1 次重排。
 *
 * 收敛性：重建会重新调用 `customCreateNodeContent` → `buildMathElement`；
 * 因 `platform/math-jax` 的产物缓存已命中（定稿即入缓存），重建路径是**同步**
 * 放置产物、**不再触发异步替换**，故不会再回调重排（无循环）。
 *
 * ⚠ `reRender` 缺失时**显式告警**（K85 ① 教训：静默跳过会让功能以无痕方式
 * 退化）。历史事故（K88）：调用方曾传入**预测量轻量代理对象**（只有
 * `nodeData`/`getData`，无 `reRender`）——可选链静默 no-op，数学定稿后尺寸
 * 永不同步（实机 512/655 永不修复）。调用方应先解析为真实 `MindMapNode`
 * （如视图层用 `findNodeByDom`）。
 */
export function refreshNodesCustomContent(
	mindMap: MindMap | null,
	nodes: readonly MindMapNode[],
): void {
	if (!mindMap || nodes.length === 0) {
		return;
	}
	for (const node of nodes) {
		try {
			const target = node as unknown as {
				reRender?: (
					keys: string[],
					params: { ignoreUpdateCustomTextWidth: boolean },
				) => void;
			};
			if (typeof target.reRender !== 'function') {
				warnMissingReRender(
					'节点不支持自绘重排（reRender 缺失），跳过尺寸同步',
				);
				continue;
			}
			target.reRender(['custom'], { ignoreUpdateCustomTextWidth: true });
		} catch (error) {
			console.error('重建节点自绘内容失败', error);
		}
	}
	mindMap.render();
}

/**
 * 设置节点图片的自定义展示尺寸（content px，custom:true 引擎按值渲染）。
 * 经 SET_NODE_DATA 合并写入；该命令只合并数据不触发重绘（与 SET_NODE_TEXT
 * 同款语义），末尾须显式 render——否则拖拽调宽期间数据在变、画面不动。
 *
 * **记为一条历史**（引擎 `Command.exec` 对非白名单命令一律 `addHistory()`）：
 * 只应在拖拽**收尾**调用一次。逐帧调用会让一次拖动产生几十条历史（用户要按
 * 几十次 Ctrl+Z 才能撤回一次调宽）——帧内请用 `previewNodeImageSize`。
 */
export function setNodeImageSize(
	mindMap: MindMap,
	node: MindMapNode,
	width: number,
	height: number,
): void {
	try {
		mindMap.execCommand(ENGINE_COMMANDS.SET_NODE_DATA, node, {
			imageSize: { width, height, custom: true },
		});
	} catch (error) {
		console.error('设置节点图片尺寸失败', error);
	}
	mindMap.render();
}

/**
 * 节点图片元素判定：按**标签名 + 取矩形能力**，不用 `instanceof SVGImageElement`。
 *
 * popout（「在新窗口打开」）里的元素来自**另一个 realm**，对主窗口构造器的
 * `instanceof` 恒为 false。该判定散在调用点会裂成两种半失效：帧内预览静默不生效
 * （图不跟手）、hover 手柄永不出现——同一个图片元素、两条通道。故收在此处：
 * `previewNodeImageSize`（本模块）与 `features/image-resize` 共用同一实现。
 */
export function isNodeImageElement(value: unknown): value is SVGImageElement {
	const el = value as
		| { tagName?: unknown; getBoundingClientRect?: unknown }
		| null
		| undefined;
	if (!el || typeof el.tagName !== 'string') {
		return false;
	}
	return (
		el.tagName.toLowerCase() === 'image' &&
		typeof el.getBoundingClientRect === 'function'
	);
}

/**
 * 帧内**预览**节点图片尺寸：直写渲染中 `<image>` 的 `width/height`。
 *
 * 为什么不下沉到引擎数据（2026-10-02 重构）：旧实现是「改 `data.imageSize` +
 * `mindMap.render()`」——每次写入都是**整树**重排，rAF 合帧只能把频率压到
 * 「每帧一次」，大图拖动仍持续卡顿。改直写与引擎渲染**同源**的 SVG 属性
 * （vendor `nodeCreateContents`：`new SVGImage().size(...imgSize)`，用户单位 =
 * content px）后：① 不动数据、不进历史、不派发 `data_change`；② 不触发整树
 * 重排（只重绘图片本身）；③ 节点外框与兄弟布局延后到收尾的那一次
 * `setNodeImageSize`（一条历史、一次布局落地）。
 *
 * 直写值会被任何一次引擎 render 覆盖回数据值——帧内不修改数据（数据在收尾
 * 才写），不存在「渲染拉回旧尺寸」的竞态；节点不在 DOM（性能模式视口外）
 * 或图片元素缺失时静默跳过，由收尾提交兜底。
 *
 * @param node 引擎节点：直写目标为自绘 `node_img` 组内的 `<image>`（不经
 *             引擎实例——本函数只碰 DOM，不写数据、不渲染）。
 */
export function previewNodeImageSize(
	node: MindMapNode,
	width: number,
	height: number,
): void {
	try {
		const group = getNodeGroupEl(node);
		const imageEl = group?.querySelector('image');
		if (!isNodeImageElement(imageEl)) {
			return;
		}
		imageEl.setAttribute('width', String(width));
		imageEl.setAttribute('height', String(height));
	} catch (error) {
		console.error('预览节点图片尺寸失败', error);
	}
}

/**
 * 图片尺寸校正条目（**结构类型**）：产出方是 `media/images-path`
 * （`ImageSizeCorrection`），此处按同形声明以免 engine → media 反向依赖。
 */
export interface ImageSizeCorrectionEntry {
	/**
	 * 树节点 data 对象**引用**。注意：**引擎节点持有的是包装/拷贝数据，与树 data
	 * 非同一对象**（2026-09-28 真实引擎实测 `identitySame=false`）——身份通道只在
	 * 引擎直接持有树 data 的场景命中；真实路径靠 `uid` 回退通道（见下）。
	 */
	data: Record<string, unknown>;
	/** 探测时的图片地址（写回前比对，图片已换则丢弃该条） */
	image: string;
	width: number;
	height: number;
	custom: boolean;
	/** true = 自动按比例校正 → 打 `mdImageAutoSize`（序列化跳过尺寸回写） */
	autoSize: boolean;
}

/**
 * 把图片尺寸校正回灌到引擎（**首帧之后**调用，见 K 记录：加载期探测不再挡首帧）。
 *
 * 匹配**双通道**（两条都要过 `image` 字段比对：用户已换图则丢弃）：
 * ① **对象身份**（`node.getData() === correction.data`）——引擎直接持有树 data 时命中；
 * ② **uid 回退**（`data.uid === correction.data.uid`，非空才用）——引擎对节点数据
 *    做包装/拷贝时命中。**真实路径实测走这条**（2026-09-28：`identitySame=false`，
 *    此前只有身份通道，校正因此从未生效——图片全停在默认尺寸）。
 *
 * uid 在**回灌时**必然已分配：`ensureUniqueUids` 在引擎创建前同步跑完（此前
 * 「uid 尚未分配」只约束**探测期间**的写回定位，不约束回灌）；引擎重建（设置
 * 刷新/换文件）后 uid 匹配落空 ⇒ 陈旧条目静默丢弃，不会把尺寸盖到别的节点上。
 *
 * 有实际改动才 `render()` 一次（局部重建由引擎按数据变更自行判定）；
 * 值相同的条目不写，避免无谓重绘与序列化惊动。
 */
export function applyImageSizeCorrectionsToEngine(
	mindMap: MindMap | null,
	corrections: readonly ImageSizeCorrectionEntry[],
): number {
	if (!mindMap || corrections.length === 0) {
		return 0;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return 0;
	}
	const byData = new Map<Record<string, unknown>, ImageSizeCorrectionEntry>();
	const byUid = new Map<string, ImageSizeCorrectionEntry>();
	for (const correction of corrections) {
		byData.set(correction.data, correction);
		const uid = correction.data.uid;
		if (typeof uid === 'string' && uid) {
			byUid.set(uid, correction);
		}
	}
	let applied = 0;
	walkTree(root, (node) => {
		const data = node.getData() as Record<string, unknown> | undefined;
		if (!data) {
			return;
		}
		// 双通道：对象身份优先（引擎直接持树 data），uid 回退（引擎拷贝包装）
		let correction = byData.get(data);
		if (!correction) {
			const uid = data.uid;
			correction = typeof uid === 'string' && uid ? byUid.get(uid) : undefined;
		}
		if (!correction) {
			return;
		}
		// 身份命中还不够：用户可能已经换过图片，旧尺寸不能盖上去
		if (data.image !== correction.image) {
			return;
		}
		const current = data.imageSize as
			| { width?: unknown; height?: unknown; custom?: unknown }
			| undefined;
		if (
			current &&
			current.width === correction.width &&
			current.height === correction.height &&
			current.custom === correction.custom
		) {
			return;
		}
		if (correction.autoSize) {
			data.mdImageAutoSize = true;
		}
		data.imageSize = {
			width: correction.width,
			height: correction.height,
			custom: correction.custom,
		};
		applied++;
	});
	if (applied > 0) {
		mindMap.render();
	}
	return applied;
}

/**
 * 删除节点兜底：uid 重复/缺失时引擎按 uid 的删除可能失败，
 * 按对象身份从父节点数据中强制移除并重绘。
 */
export function forceRemoveNodeData(
	mindMap: MindMap,
	parent: MindMapNode,
	nodeData: MindMapTreeNode,
): void {
	const index = parent.nodeData.children.findIndex(
		(child) => child === nodeData,
	);
	if (index !== -1) {
		parent.nodeData.children.splice(index, 1);
		mindMap.render();
	}
}

/** 兄弟间上/下移的结果：`'moved'` 之外均为引擎会静默 no-op 的拒绝分支 */
export type SiblingMoveOutcome =
	| 'moved'
	| 'root'
	| 'atTop'
	| 'atBottom'
	| 'detached';

/**
 * 兄弟间上/下移的唯一实现（右键菜单「上移节点 / 下移节点」，2026-10-14）：
 * 与相邻兄弟交换顺序，并**清除参与交换两节点的自由拖拽坐标**。
 *
 * 为什么必须清坐标：节点有效位置由 getter `customLeft || _left` 给出——自定义
 * 坐标是「绝对位置」，会凌驾于兄弟顺序之上；只交换 children 顺序而不清它，
 * 画面位置不跟随（上游 `UP_NODE` / `Ctrl+Up` 同款行为，也是「点了没反应」的
 * 根源）。清法对齐上游 `RESET_LAYOUT` 的单节点处理；`SET_NODE_DATA` 只写数据
 * 不渲染，画面由紧随的交换命令内含的 render 收尾。
 *
 * `UP_NODE` / `DOWN_NODE` 只作用于**第一个激活节点**，故显式传 `node`（画布
 * 委托路径可能处于多选态，激活列表顺序不可依赖）。引擎对根节点/首尾一律静默
 * no-op——拒绝原因经返回值交给调用方，用户可见提示归视图层（本文件不产文案）。
 */
export function moveNodeInSiblings(
	mindMap: MindMap,
	node: MindMapNode,
	offset: -1 | 1,
): SiblingMoveOutcome {
	if (node.isRoot) {
		return 'root';
	}
	const siblings = node.parent?.children;
	if (!Array.isArray(siblings)) {
		return 'detached';
	}
	const index = siblings.indexOf(node);
	if (index === -1) {
		return 'detached';
	}
	if (offset < 0 ? index === 0 : index === siblings.length - 1) {
		return offset < 0 ? 'atTop' : 'atBottom';
	}
	// 被移动节点与交换对象都清掉自定义坐标：二者回到布局位置后，交换后的顺序
	// 才如实落在画面上（只清一个会让另一个仍停在手动摆放的绝对位置）
	const swap = siblings[offset < 0 ? index - 1 : index + 1];
	if (swap) {
		clearNodeCustomPosition(mindMap, swap);
	}
	clearNodeCustomPosition(mindMap, node);
	mindMap.execCommand(
		offset < 0 ? ENGINE_COMMANDS.UP_NODE : ENGINE_COMMANDS.DOWN_NODE,
		node,
	);
	return 'moved';
}

/**
 * 清除单个节点的自由拖拽坐标（`customLeft` / `customTop`）：实例字段与节点数据
 * 二者都置 `undefined`——坐标 getter 为 `customLeft || _left`，只清一处可能残留
 * （对齐上游 `RESET_LAYOUT` 的单节点处理）。只写数据、不触发 render。
 */
function clearNodeCustomPosition(mindMap: MindMap, node: MindMapNode): void {
	const inst = node as unknown as { customLeft?: number; customTop?: number };
	inst.customLeft = undefined;
	inst.customTop = undefined;
	mindMap.execCommand(ENGINE_COMMANDS.SET_NODE_DATA, node, {
		customLeft: undefined,
		customTop: undefined,
	});
}

// ---------------------------------------------------------------------------
// 引擎内部状态的最后收口（renderer.textEdit / node_dblclick 触发）
// ---------------------------------------------------------------------------

/**
 * 节点是否为**自绘内容**节点（引擎 `customCreateNodeContent` 已接管，见本文件
 * createNodeContent 钩子）；`false` = 走引擎默认 SVG 文本渲染。
 *
 * 用途：引擎的节点编辑框对自绘节点**静默 no-op**——`textEdit.show()` 首行即
 * `if (t.isUseCustomNodeContent()) return;`，故视图侧据此改走插件自身的编辑入口
 * （`ui/modal-text`）；引擎内部判定收口在本函数。
 */
export function isCustomNodeContent(node: MindMapNode): boolean {
	const target = node as unknown as {
		isUseCustomNodeContent?: () => boolean;
	};
	return target.isUseCustomNodeContent?.() ?? false;
}

/** 用户是否正在节点文本编辑框内打字（防腐：renderer.textEdit 内部状态） */
export function isEditingText(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	const textEdit = (
		mindMap.renderer as unknown as {
			textEdit?: { isShowTextEdit(): boolean };
		}
	).textEdit;
	return textEdit?.isShowTextEdit() ?? false;
}

/** 根（中心主题）节点文本（防腐：renderer.root 内部状态） */
export function getRootText(mindMap: MindMap | null): string | null {
	const rootText = mindMap?.renderer.root?.getData('text');
	return typeof rootText === 'string' ? rootText : null;
}

/**
 * 触发节点文本编辑（右键菜单「编辑文本」）。
 *
 * 两个坑（0.14.0-fix.3 实测）：
 * - 右键菜单项的 click 会继续冒泡到 `document.body`，引擎的 `body_click`
 *   （`isEndNodeTextEditOnClickOuter` 默认 true）会立刻把刚打开的编辑框关掉
 *   —— 故延后一个宏任务再触发；
 * - `isInserting` 必须是 false：它表示「新建节点后的首次编辑」，传 true 会让
 *   引擎按插入态处理（语义错误）。
 *
 * 引擎无 ENTER_TEXT_EDIT 命令，`node_dblclick` 事件是文本编辑的官方入口。
 */
export function startNodeTextEdit(mindMap: MindMap, node: MindMapNode): void {
	scheduleEngineTimer(
		mindMap,
		() => {
			mindMap.emit('node_dblclick', node, null, false);
			// 菜单关闭后浏览器可能把焦点还给画布：补一次焦点，保证可直接输入
			focusNodeTextEdit(mindMap);
		},
		0,
	);
}

/** 聚焦节点文本编辑框（引擎内部 textEditNode；尚未创建时静默） */
function focusNodeTextEdit(mindMap: MindMap | null): void {
	const textEdit = (
		mindMap?.renderer as
			| { textEdit?: { textEditNode?: HTMLElement | null } }
			| undefined
	)?.textEdit;
	textEdit?.textEditNode?.focus();
}
