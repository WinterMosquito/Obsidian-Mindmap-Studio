/**
 * 层级语法（Markdown 标题 / 无序列表）的**基础面**：起始级别读取、单节点判据、
 * 整支升降。上层两个入口各自成模块：
 * - `md-heading-normalize.ts`：编辑期一致性守卫（拖拽 / 粘贴 / 撤销后的归一）；
 * - `md-heading-format.ts`：右键「层级语法」级联的整篇重排。
 *
 * ## 为什么需要（一条 Markdown 事实）
 * `# 甲` 之后写同级 `- a`，解析时 `- a` 会挂到**甲名下**（`md-outline` 的
 * `contentParent` 是当前标题）；`- a` 之后写 `# b` 则仍是同级。
 *
 * 于是同一兄弟组里的**合法形态是「列表/段落在前，标题在后」**：
 * - 列表在标题之前 ⇒ 仍归属本层（`listStack` 为空时挂 `contentParent`＝上层标题）；
 * - 列表在标题之后 ⇒ 被读成**前一个标题的子节点**（改结构）；
 * - 标题级别在本组内**递增**（`#` 后接 `##`）⇒ 后者被读成前者的子节点；
 * - 父级是列表/段落时写标题 ⇒ 标题会提升到外层（同样改结构）。
 *
 * 故守卫只判这几种**会改结构**的排布，合法的混排（列表在前）一律不动——
 * 手写文件与拖拽结果都能逐字往返（2026-11-08 实机：早前按「同组语法必须一致」
 * 判定会在**打开文件时**就把合法混排改写掉）。
 *
 * ## 四条口径
 * - **只动 md 字段**（`mdType` / `mdLevel` / `mdMarker` / 根的 `mdHeadingStart`）：
 *   `text` / `mdRaw` 一字不改 ⇒ 行尾注释、链接、图片、独立指令行全部随行保留，
 *   保存时仍走「未编辑逐字回写」。
 * - **段落随列表父链降级**：`plain` 节点写成无前缀行，列表父链下解析不到原层
 *   级 ⇒ `convertBranchToList` 把它一并转成列表项（K170）。
 * - **`mdMarker` 转标题后保留**（标题行不写它）：`*` / `+` 在转回列表时恢复原
 *   标记，不退化成 `-`（K170）；有序编号由 `mdOrderedNumber` 保真。
 * - **独立指令行不算内容**：`%%id:…%%` / `%%rel:…%%` / `%%sum:…%%` 让 `mdRaw`
 *   天然多行（解析时挂在上一节点末行，见 `md-outline.attachDirectiveLine`），
 *   但它们属于结构数据、**可以跟在标题行后面**（库里 `连线A-同列.md` 就是
 *   `# 甲` + `%%rel:…%%`）。故判据是「去掉末尾指令行后仍是单行」，不是
 *   「`mdRaw` 没有换行」——否则带概要/联系/块 id 的节点全被挡，还会拖累整层。
 */
import type { MindMapTreeNode } from '../core/engine-types';
import { readNodeDataString, type MdNodeData } from '../core/node-data';
import { stripTrailingColorDirectiveLines } from '../domain/color';
import { splitDirectiveTail } from '../domain/directive';

/** Markdown 只有 6 级标题 */
export const MAX_HEADING_LEVEL = 6;

/** 整篇重排的目标：无序列表，或「标题 + 顶层级别」 */
export type DocumentSyntax = 'list' | 1 | 2;

/**
 * 单节点**不能**写成标题行的原因（`null` = 可写）。
 * 只对**非标题**节点求值：标题节点可能残留 `mdMarker`（K170 保留供往返恢复），
 * `findHeadingBlocker` / 组原子都先 `isHeadingNode` 跳过。
 */
export type HeadingBlockReason = 'multiline' | 'task' | 'ordered' | 'plain';

/** 引擎渲染节点的**最小结构面**（不引引擎类型：本模块保持 markdown 层的纯度） */
interface LiveNode {
	/** 引擎 `Node.getData()` = **活引用**（见 `core/node-data` 的两侧 getData 对照） */
	getData(): unknown;
	children?: readonly LiveNode[];
}

/**
 * 把**渲染节点树**包装成数据树：`data` 仍是该节点的活数据对象，改写即改引擎数据。
 *
 * 唯一用途：让归一逻辑能**就地**修正引擎里已存在的树——不走 `setData` /
 * `updateData`，因此**不进撤销栈**（用户的 `Ctrl+Z` 仍是一步撤掉「这次编辑 +
 * 语法换算」），也无需重渲染（md 字段不参与绘制）。与「深拷贝 + 整树回灌 +
 * 一条历史」的 `replaceMindMapData` 分工：显式动作走那条。
 */
export function liveNodeTree(node: LiveNode): MindMapTreeNode {
	return {
		data: node.getData() as MdNodeData & MindMapTreeNode['data'],
		children: (node.children ?? []).map(liveNodeTree),
	};
}

/** 节点 md 数据的合并视图（data 是引擎活对象，就地改写即改引擎数据） */
export function dataOf(node: MindMapTreeNode): MdNodeData {
	return node.data;
}

export function isHeadingNode(data: MdNodeData): boolean {
	return data.mdType === 'heading';
}

/**
 * 读本文档的标题起始级别（`MdNodeMeta.mdHeadingStart` 的**唯一读取面**）。
 *
 * 缺失 / 非数值 / 越界一律回落 1（＝ K98 的历史口径「第 1 层写 `#`」）。
 */
export function readHeadingStart(data: unknown): number {
	const value = (data as { mdHeadingStart?: unknown } | null)?.mdHeadingStart;
	return clampLevel(Number(value));
}

/** 级别归一：非有限值 / 越界 / 小数一律钳到 1..6 的整数（缺省 1） */
function clampLevel(num: number): number {
	if (!Number.isFinite(num)) {
		return 1;
	}
	return Math.min(MAX_HEADING_LEVEL, Math.max(1, Math.round(num)));
}

/** 节点当前的标题级别（脏值钳 1..6，缺省 1） */
export function levelOf(data: MdNodeData): number {
	return clampLevel(Number(data.mdLevel));
}

/**
 * 给**空文档**（正文没有任何节点）播种标题起始级别。
 *
 * 只在此时用设置：有内容的文件一律以自己正文的写法为准（`mdHeadingStart` 由
 * 解析期实测），改设置不会回头影响它们。**必须在引擎创建前**写进 data 树——
 * 引擎会克隆数据，建好后再改这棵树不再生效（与配色 / 联系 / 概要同一时机）。
 *
 * @param headingStart 设置里的起点（`list` 档为 null ⇒ 不播种；空文档 + `list`
 *   首次根级新建会按缺省 1 级写 `#`，K171 已知边界）
 */
export function seedHeadingStart(
	tree: MindMapTreeNode,
	headingStart: number | null,
): void {
	if (headingStart === null || (tree.children ?? []).length > 0) {
		return;
	}
	const data = dataOf(tree);
	if (typeof data.mdHeadingStart === 'number') {
		return;
	}
	data.mdHeadingStart = clampLevel(headingStart);
}

/** 提示文案里的节点名（首行、截断；`text` 为空时回落原文——图片独占节点即如此，空引号「」等于没说清） */
export function labelOf(data: MdNodeData): string {
	const raw = readNodeDataString(data, 'text') || readNodeDataString(data, 'mdRaw');
	const line = (raw.split('\n')[0] ?? '').trim();
	return line.length > 20 ? `${line.slice(0, 20)}…` : line;
}

/** 单节点能否写成标题行（内容层面，不看兄弟） */
export function headingBlockReason(data: MdNodeData): HeadingBlockReason | null {
	if (data.mdType === 'plain') {
		return 'plain';
	}
	if (data.mdTask) {
		return 'task';
	}
	if (data.mdMarker === 'ordered') {
		// 只可能是 list 节点：有序项永远不升标题（转标题时保留 marker 的路径
		// 只对 `*` / `+` / `-` 生效，见 K170）
		return 'ordered';
	}
	// 单行判据：多行内容（项内围栏 / 续行）写成标题会撕裂成多个节点——
	// 标题行后面跟围栏时，围栏被解析成独立段落节点（`#` 只吃首行）
	const raw = readNodeDataString(data, 'mdRaw') || readNodeDataString(data, 'text');
	// 去掉末尾独立指令行（id/rel/sum 与独立行配色）后仍是单行才算可转
	if (splitDirectiveTail(stripTrailingColorDirectiveLines(raw)).content.includes('\n')) {
		return 'multiline';
	}
	return null;
}

/**
 * 把一支改为标题（`level` = 该支根的级别；逐层 +1）。
 *
 * **调用前必须先过 {@link findHeadingBlocker}**：本函数不做可转判定，子孙里有
 * 围栏 / 任务项时会写出丢掉语义甚至撕裂内容的标题行。
 *
 * 超过 6 级的部分**降为列表**（Markdown 没有第 7 级）：从那一层起整支保持列表，
 * 与该层的兄弟语法一致。返回被改写的节点数。
 */
export function convertBranchToHeadings(
	node: MindMapTreeNode,
	level: number,
): number {
	let converted = 0;
	const stack: { node: MindMapTreeNode; level: number }[] = [{ node, level }];
	while (stack.length > 0) {
		const frame = stack.pop()!;
		const data = dataOf(frame.node);
		if (frame.level > MAX_HEADING_LEVEL) {
			converted += convertBranchToList(frame.node);
			continue;
		}
		if (isHeadingNode(data)) {
			if (levelOf(data) !== frame.level) {
				data.mdLevel = frame.level;
				converted++;
			}
		} else {
			data.mdType = 'heading';
			data.mdLevel = frame.level;
			// 保留 mdMarker：标题行不写它，转回列表时据此恢复 '*' / '+' / '-'
			// （删掉会把 `*` / `+` 静默归一成 `-`）
			converted++;
		}
		for (const child of frame.node.children ?? []) {
			stack.push({ node: child, level: frame.level + 1 });
		}
	}
	return converted;
}

/**
 * 该支能否**整支**转成标题：返回首个转不了的节点名（`null` = 可以）。
 *
 * 单节点判据（{@link headingBlockReason}）只看了支根。整支转换会把子孙也写成
 * 标题——子孙里藏着一个围栏 / 任务项时，硬转会把它写成 `#### [ ] 任务` 或让
 * 围栏在重解析时裂成多个节点（内容丢失）。故**先查后转**，两个入口（守卫升级、
 * 粘贴换算）都走这一份判据。
 *
 * `level > 6` 之后不再是标题（降为列表），那一段天然安全、无需再查。
 */
export function findHeadingBlocker(
	node: MindMapTreeNode,
	level: number,
): string | null {
	const stack: { node: MindMapTreeNode; level: number }[] = [{ node, level }];
	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.level > MAX_HEADING_LEVEL) {
			continue;
		}
		const data = dataOf(frame.node);
		if (!isHeadingNode(data)) {
			const reason = headingBlockReason(data);
			if (reason) {
				return labelOf(data);
			}
		}
		for (const child of frame.node.children ?? []) {
			stack.push({ node: child, level: frame.level + 1 });
		}
	}
	return null;
}

/**
 * 只给**已是标题**的节点重定级（`level` = 支根目标级别，逐层 +1）。
 *
 * 与 {@link convertBranchToHeadings} 的区别：**不把列表改成标题**。级联「标题·
 * 二级」这类整篇重排只需要把已有标题按深度重排，列表子节点保持列表（标题下面
 * 挂列表本来就合法）；若顺手把列表转成标题，会连任务项 / 多行内容一起改掉。
 *
 * 返回被改写的节点数。
 */
export function relevelHeadingBranch(
	node: MindMapTreeNode,
	level: number,
): number {
	let converted = 0;
	const stack: { node: MindMapTreeNode; level: number }[] = [{ node, level }];
	while (stack.length > 0) {
		const frame = stack.pop()!;
		const data = dataOf(frame.node);
		if (!isHeadingNode(data)) {
			// 非标题节点：正常树里其子孙只会是列表；段落父下挂标题是非法内存态（K171）
			continue;
		}
		if (frame.level > MAX_HEADING_LEVEL) {
			continue;
		}
		if (levelOf(data) !== frame.level) {
			data.mdLevel = frame.level;
			converted++;
		}
		for (const child of frame.node.children ?? []) {
			stack.push({ node: child, level: frame.level + 1 });
		}
	}
	return converted;
}

/**
 * 把一支降为无序列表（递归整支；返回被改写的节点数）。
 *
 * **段落（`plain`）也一并降级**：列表父链下段落行没有层级表达（无前缀行会被
 * 解析到最近的标题 / 根），不转就会在写盘后丢层、并连带提升后续兄弟。转成
 * `- ` 列表项后，`mdRaw` 的多行续行按列表续行表达，树形可往返。
 */
export function convertBranchToList(node: MindMapTreeNode): number {
	let converted = 0;
	const stack: MindMapTreeNode[] = [node];
	while (stack.length > 0) {
		const current = stack.pop()!;
		const data = dataOf(current);
		if (isHeadingNode(data) || data.mdType === 'plain') {
			data.mdType = 'list';
			// 保留原有标记；标题 / 段落没有标记，补一个无序标记
			data.mdMarker = data.mdMarker ?? '-';
			delete data.mdLevel;
			converted++;
		}
		for (const child of current.children ?? []) {
			stack.push(child);
		}
	}
	return converted;
}
