/**
 * 概要（Summary）：把**同一父节点下相邻的若干个兄弟节点**括起来，挂一个说明节点。
 *
 * 语法（写在**第一个被覆盖的兄弟节点**的指令块里，见 `domain/directive`）：
 *
 * ```markdown
 * - 需求评审
 *   %%sum:2 | 本周必须完成%%
 * - 方案设计
 * - 联调
 * ```
 *
 * - `sum:<count>`：**从本节点起**连续覆盖的兄弟节点数（含自己，`1..999`）；
 * - `| 文字`：概要节点上的文字（写侧必写；读侧缺失按空串，引擎会画一个空盒）；
 * - 覆盖范围**必须相邻**：跳跃的兄弟节点无法用「起点 + 个数」表达，UI 侧直接
 *   拒绝（XMind 一次可产出多个概要，本插件按**分支分组**各生成一条）；
 * - 越界（`count` 超过剩余兄弟数）时**读到即夹到末尾**：文件里的数字原样保留
 *   （静默改写会破坏逐字保真），只是渲染范围不越界——与悬空 `%%rel%%` 同一取舍；
 * - 重叠（两条概要覆盖到同一个兄弟）时**文档序在前者权威**，后者丢弃；
 * - 被覆盖的节点自己也可以再带一条概要（嵌套/相邻都支持），规划按兄弟逐个消费。
 *
 * ## 为什么锚在「第一个兄弟」而不是父节点
 * 锚在父节点就得写「第几个到第几个」（索引区间）：在前面插入一个兄弟，整段区间
 * 全部错位；锚在第一个兄弟时，前面的兄弟怎么增删都不影响它，只有**区间内部**
 * 的增删才会改变覆盖面——与「这一条起，往后 N 条」的直觉一致。
 *
 * ## 与 text 的关系
 * 与 `%%id%%` / `%%rel%%` 完全一致：段落在 `mdDirectiveTail` 里，不进入
 * `data.text` / `mdDerivedText`；概要文字**真正的内容**只存在于指令里，引擎侧的
 * 概要节点由 `engine/mindmap-summaries` 从这份段派生。
 */

import {
	applyDirectiveBlock,
	type DirectiveSegment,
	splitDirectiveSegments,
} from './directive';
import { nodeInlineSource } from './md-meta';

/** 一条概要：覆盖本节点起连续的 `count` 个兄弟 + 说明文字 */
export interface SummaryEntry {
	count: number;
	text: string;
}

/** 规划结果（相对某个父节点的兄弟数组；`end` 含端点） */
export interface SummaryRange {
	start: number;
	end: number;
	text: string;
}

/** `sum` 段的值形态：`<count>` 或 `<count> | <text>` */
const VALUE_PATTERN = /^(\d{1,3})\s*(?:\|\s*([\s\S]*))?$/;

/** 覆盖数量上限：三位数即够用（再多的兄弟节点本就该分组），也挡住手工写的大数 */
const COUNT_MAX = 999;

/**
 * 概要文字是否可写进注释体（**输入侧与解析侧同一判据**，勿各写一份）。
 *
 * 与 `isWritableRelationLabel` 同规则：注释不能嵌套（禁 `%%`）、不是行内 token 的
 * 保护区（禁 `[[` / `]]`）、不能换行（一行一条指令）。
 */
export function isWritableSummaryText(text: string): boolean {
	return (
		!text.includes('%%') &&
		!text.includes('\n') &&
		!text.includes('[[') &&
		!text.includes(']]')
	);
}

/** 解析 `sum` 段的值；不合法返回 null（该概要丢弃，整行仍是指令行） */
export function parseSummaryValue(value: string): SummaryEntry | null {
	const match = VALUE_PATTERN.exec(value.trim());
	if (!match) {
		return null;
	}
	const count = Number(match[1]);
	if (!Number.isInteger(count) || count < 1 || count > COUNT_MAX) {
		return null;
	}
	const text = (match[2] ?? '').trim();
	// 写错的文字（含 `%%` / `[[`）整条丢弃：它已经无法被忠实写回
	if (!isWritableSummaryText(text)) {
		return null;
	}
	return { count, text };
}

/** 条目 → `sum` 段的值（写侧恒「数量 + 文字」，空文字不写分隔符） */
export function renderSummaryValue(entry: SummaryEntry): string {
	const count = Math.min(COUNT_MAX, Math.max(1, Math.round(entry.count)));
	const text = entry.text.trim();
	return text ? `${count} | ${text}` : String(count);
}

/** 条目 → `sum` 段（写侧原料，交给 `applyDirectiveBlock` 统一排序拼接） */
export function summarySegmentsOf(
	entries: readonly SummaryEntry[],
): DirectiveSegment[] {
	return entries.map((entry) => {
		const value = renderSummaryValue(entry);
		return { key: 'sum', value, raw: `%%sum:${value}%%` };
	});
}

/**
 * 从节点原文读出全部概要（按文件顺序）。
 *
 * 一个节点上多条 `%%sum%%` 是合法输入（覆盖范围不同），是否重叠由
 * {@link planSummaryRanges} 决定——这里只做「段 → 条目」的翻译。
 */
export function summariesOfSource(source: string): SummaryEntry[] {
	// 快路径：绝大多数节点没有任何注释（每次渲染每个节点都会走到这里）
	if (!source.includes('%%sum')) {
		return [];
	}
	const entries: SummaryEntry[] = [];
	for (const segment of splitDirectiveSegments(source).segments) {
		if (segment.key !== 'sum') {
			continue;
		}
		const entry = parseSummaryValue(segment.value);
		if (entry) {
			entries.push(entry);
		}
	}
	return entries;
}

/** 节点数据 → 概要列表（读的是 `nodeInlineSource`，与配色/联系同一份原文） */
export function summariesOf(
	data: Record<string, unknown> | null | undefined,
): SummaryEntry[] {
	return data ? summariesOfSource(nodeInlineSource(data)) : [];
}

/**
 * 改写节点原文里的概要段（**只动 `sum` 段**，`id` / `rel` 逐字带回）。
 *
 * 与 `view-node-relation.rawWithState` 同构：两个特性各自只替换自己的 key，
 * 谁的编辑都不会抹掉对方。
 */
export function applySummaries(
	source: string,
	entries: readonly SummaryEntry[],
): string {
	const { segments } = splitDirectiveSegments(source);
	const kept = segments.filter((segment) => segment.key !== 'sum');
	return applyDirectiveBlock(source, [...kept, ...summarySegmentsOf(entries)]);
}

/** 规划的内部形态：范围 + **产出它的那条声明**（起始兄弟的 `entries` 下标） */
interface SummaryDeclaration extends SummaryRange {
	entry: number;
}

/**
 * 规划的**唯一实现**：{@link planSummaryRanges}（区间）与
 * {@link summaryEntryIndexOfRange}（反查是哪条声明）都是它的投影。
 *
 * 规则（顺序即文档序，行为可预测）：
 * - 起点 = 声明它的兄弟下标；`count` 越界夹到最后一个兄弟；
 * - 已被前面的概要覆盖的兄弟不再开启新区间（后写的整条丢弃）；
 * - 返回值按 `start` 升序，供引擎按顺序渲染概要框。
 */
function planSummaryDeclarations(
	entriesPerSibling: readonly (readonly SummaryEntry[])[],
): SummaryDeclaration[] {
	const total = entriesPerSibling.length;
	const taken = new Array<boolean>(total).fill(false);
	const declarations: SummaryDeclaration[] = [];
	for (let index = 0; index < total; index += 1) {
		const entries = entriesPerSibling[index] ?? [];
		for (let entry = 0; entry < entries.length; entry += 1) {
			const start = index;
			const end = Math.min(
				total - 1,
				start + Math.max(1, entries[entry]!.count) - 1,
			);
			let overlaps = false;
			for (let i = start; i <= end; i += 1) {
				if (taken[i]) {
					overlaps = true;
					break;
				}
			}
			if (overlaps) {
				continue;
			}
			for (let i = start; i <= end; i += 1) {
				taken[i] = true;
			}
			declarations.push({ start, end, text: entries[entry]!.text, entry });
		}
	}
	return declarations;
}

/**
 * 把「每个兄弟节点自己声明的概要」规划成**互不重叠、不越界**的区间（引擎落点）。
 *
 * @param entriesPerSibling 第 i 项 = 第 i 个兄弟自己声明的概要列表
 */
export function planSummaryRanges(
	entriesPerSibling: readonly (readonly SummaryEntry[])[],
): SummaryRange[] {
	return planSummaryDeclarations(entriesPerSibling).map(
		({ start, end, text }) => ({ start, end, text }),
	);
}

/**
 * 「画在 `[start, end]` 上的那条概要框」是起始兄弟的**第几条声明**（`-1` = 没有）。
 *
 * 概要节点是引擎的派生实例，正文里对应的那一条 `%%sum%%` 只能靠**区间**反查。
 * 判据必须是**规划器自己的结果**，不能拿「`count` 与原值相等」去认领：
 * `count` 越界时读到即夹到最后一个兄弟（文件里的数字不改），此后框的宽度与
 * `count` **不再相等**——按值认领会失败，表现为「右键概要 / 按 Delete 毫无反应」
 * （用户先给 4 个兄弟加概要、再删掉其中 1 个就必然踩到）。
 *
 * 同区间不可能有两条声明（规划按文档序丢弃重叠者），故区间足以定身份；
 * 同一节点上的重复声明取**文档序第一条**——正是被画出来的那一条。
 *
 * @param entriesPerSibling 第 i 项 = 第 i 个兄弟自己声明的概要列表（与渲染同一数组）
 */
export function summaryEntryIndexOfRange(
	entriesPerSibling: readonly (readonly SummaryEntry[])[],
	start: number,
	end: number,
): number {
	const found = planSummaryDeclarations(entriesPerSibling).find(
		(declaration) => declaration.start === start && declaration.end === end,
	);
	return found ? found.entry : -1;
}
