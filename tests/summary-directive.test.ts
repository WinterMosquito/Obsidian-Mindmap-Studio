/**
 * 概要（Summary）指令回归：`%%sum:<count> | 文字%%`。
 *
 * 四处口径：
 * 1. **语法**（`domain/summary`）：值形态、非法值丢弃、写侧渲染；
 * 2. **改写**（`applySummaries`）：只动 `sum` 段，同节点的 `%%id%%` / `%%rel%%`
 *    逐字带回（否则「建一条概要」会把节点上的联系全部抹掉）；
 * 3. **规划**（`planSummaryRanges`）：越界夹到末尾、重叠按文档序丢弃；
 * 4. **反查**（`summaryEntryIndexOfRange`）：画出来的框 → 正文里那条声明
 *    （编辑 / 删除概要靠它认领，见该 describe 的回归说明）。
 *
 * 语法本身（指令行判定 / 一段一行 / 行内兼容形态）由 `domain/directive` 承担，
 * 回归在 `tests/relation-directive.test.ts` 与 `tests/summary-directive.test.ts`
 * 的往返用例里各有覆盖。
 */
import { describe, expect, it } from 'vitest';
import {
	applySummaries,
	isWritableSummaryText,
	parseSummaryValue,
	planSummaryRanges,
	renderSummaryValue,
	summaryEntryIndexOfRange,
	summarySegmentsOf,
	summariesOfSource,
	type SummaryEntry,
} from '../src/domain/summary';
import { parseMdOutline } from '../src/markdown/md-outline';
import { serializeMdBody } from '../src/markdown/md-serialize';

describe('sum 段语法', () => {
	it('值：`<count>` 与 `<count> | <文字>` 都认', () => {
		expect(parseSummaryValue('2')).toEqual({ count: 2, text: '' });
		expect(parseSummaryValue('2 | 本周必须完成')).toEqual({
			count: 2,
			text: '本周必须完成',
		});
		expect(parseSummaryValue(' 1 |空格宽松 ')).toEqual({
			count: 1,
			text: '空格宽松',
		});
	});

	it('值非法即丢（整行仍是指令行，只是这条概要没有语义）', () => {
		expect(parseSummaryValue('0')).toBeNull();
		expect(parseSummaryValue('1000')).toBeNull();
		expect(parseSummaryValue('x2')).toBeNull();
		expect(parseSummaryValue('')).toBeNull();
		// 文字里有注释不能嵌套的 `%%` / 双链 —— 写不回，整条丢弃
		expect(parseSummaryValue('2 | a%%b')).toBeNull();
		expect(parseSummaryValue('2 | [[笔记]]')).toBeNull();
	});

	it('文字可写判定与解析侧同一份', () => {
		expect(isWritableSummaryText('普通文字 | 带竖线')).toBe(true);
		expect(isWritableSummaryText('a%%b')).toBe(false);
		expect(isWritableSummaryText('[[x]]')).toBe(false);
		expect(isWritableSummaryText('a\nb')).toBe(false);
	});

	it('渲染：数量取整并夹到 1..999，空文字不写分隔符', () => {
		expect(renderSummaryValue({ count: 2, text: '依赖' })).toBe('2 | 依赖');
		expect(renderSummaryValue({ count: 2, text: '' })).toBe('2');
		expect(renderSummaryValue({ count: 0, text: 'x' })).toBe('1 | x');
		expect(renderSummaryValue({ count: 5000, text: 'x' })).toBe('999 | x');
		expect(summarySegmentsOf([{ count: 2, text: '依赖' }])[0]?.raw).toBe(
			'%%sum:2 | 依赖%%',
		);
	});

	it('读取：只认末尾指令块里的 sum 段，顺序同文件', () => {
		expect(summariesOfSource('子\n%%sum:2 | 甲%%')).toEqual([
			{ count: 2, text: '甲' },
		]);
		expect(summariesOfSource('子\n%%sum:1 | 甲%%\n%%sum:3 | 乙%%')).toEqual([
			{ count: 1, text: '甲' },
			{ count: 3, text: '乙' },
		]);
		expect(summariesOfSource('子')).toEqual([]);
		// 行中间的注释不算概要
		expect(summariesOfSource('子 %%sum:2 | 甲%% 尾巴')).toEqual([]);
	});
});

describe('改写：只动 sum 段', () => {
	it('写入时把其它指令段逐字带回', () => {
		const source =
			'子\n%%id:7f3a11%%\n%%rel:9c2e22 | 依赖 | geo=right,0,left,8,12,0,-30,-12%%';
		const next = applySummaries(source, [{ count: 2, text: '核心' }]);
		expect(next).toBe(
			[
				'子',
				'%%id:7f3a11%%',
				'%%rel:9c2e22 | 依赖 | geo=right,0,left,8,12,0,-30,-12%%',
				'%%sum:2 | 核心%%',
			].join('\n'),
		);
	});

	it('替换已有概要（不同步、幂等）', () => {
		const source = '子\n%%sum:2 | 旧%%';
		const next = applySummaries(source, [{ count: 3, text: '新' }]);
		expect(next).toBe('子\n%%sum:3 | 新%%');
		expect(applySummaries(next, [{ count: 3, text: '新' }])).toBe(next);
	});

	it('清除：空列表 = 把 sum 段整段摘掉（其余段保留）', () => {
		expect(applySummaries('子\n%%id:7f3a11%%\n%%sum:2 | 核心%%', [])).toBe(
			'子\n%%id:7f3a11%%',
		);
	});

	it('列表项：写出的指令行由序列化器补续行缩进', () => {
		const md = '- 甲\n%%sum:2 | 核心%%\n- 乙\n- 丙';
		const { tree } = parseMdOutline(md, 'root');
		expect(tree.children).toHaveLength(3);
		expect(tree.children[0]!.data?.mdDirectiveTail).toBe('%%sum:2 | 核心%%');
		expect(serializeMdBody(tree, null)).toBe(
			'- 甲\n  %%sum:2 | 核心%%\n- 乙\n- 丙',
		);
	});
});

describe('规划：范围', () => {
	/** 第 i 个兄弟声明了 `counts[i]` 条概要（0 = 没有） */
	const at = (...counts: number[]): SummaryEntry[][] =>
		counts.map((count) => (count ? [{ count, text: String(count) }] : []));

	it('起点 = 声明者下标，`end` 含端点', () => {
		expect(planSummaryRanges(at(0, 2, 0))).toEqual([
			{ start: 1, end: 2, text: '2' },
		]);
		expect(planSummaryRanges(at(1, 0, 0))).toEqual([
			{ start: 0, end: 0, text: '1' },
		]);
	});

	it('越界夹到最后一个兄弟（文件里的数字不改）', () => {
		expect(planSummaryRanges(at(1, 5))).toEqual([
			{ start: 0, end: 0, text: '1' },
			{ start: 1, end: 1, text: '5' },
		]);
	});

	it('重叠按文档序丢弃后者', () => {
		expect(planSummaryRanges(at(3, 2, 0))).toEqual([
			{ start: 0, end: 2, text: '3' },
		]);
		// 同一节点上的两条：先出现者权威
		expect(
			planSummaryRanges([
				[
					{ count: 2, text: '先' },
					{ count: 1, text: '后' },
				],
				[],
				[],
			]),
		).toEqual([{ start: 0, end: 1, text: '先' }]);
	});

	it('相邻不重叠的两条都保留', () => {
		expect(planSummaryRanges(at(2, 0, 0, 2))).toEqual([
			{ start: 0, end: 1, text: '2' },
			{ start: 3, end: 3, text: '2' },
		]);
	});
});

/**
 * 概要节点 → 正文里那条声明：反查必须用**规划器自己的区间**。
 *
 * 回归的事故路径（2026-11-03 审查）：先给 4 个兄弟建概要、再删掉其中 1 个 ——
 * 文件里的 `count` 仍是 4，规划读到即夹到 3，框的宽度因此**不再等于 `count`**。
 * 按「count == 宽度」认领会返回 null，用户右键概要 / 按 Delete 都毫无反应。
 */
describe('反查：概要框是哪条声明画的', () => {
	const at = (...counts: number[]): SummaryEntry[][] =>
		counts.map((count) => (count ? [{ count, text: String(count) }] : []));

	it('命中：区间与规划结果逐字一致', () => {
		expect(summaryEntryIndexOfRange(at(0, 2, 0), 1, 2)).toBe(0);
		expect(summaryEntryIndexOfRange(at(2, 0, 0, 2), 3, 3)).toBe(0);
	});

	it('越界夹取后仍能认领（宽度 ≠ `count` 也不影响）', () => {
		// 只剩 2 个兄弟、文件里写着 5 ⇒ 框是 [1,1]，宽度 1
		expect(summaryEntryIndexOfRange(at(1, 5), 1, 1)).toBe(0);
	});

	it('同节点多条：只有被画出来的那条（文档序第一条）算命中', () => {
		const entries = [
			[
				{ count: 2, text: '先' },
				{ count: 1, text: '后' },
			],
			[],
			[],
		];
		expect(summaryEntryIndexOfRange(entries, 0, 1)).toBe(0);
		// 被丢弃的那条（[0,0]）没有对应的框
		expect(summaryEntryIndexOfRange(entries, 0, 0)).toBe(-1);
	});

	it('区间对不上 ⇒ -1（调用方据此给可见提示，不静默）', () => {
		expect(summaryEntryIndexOfRange(at(1, 0), 0, 1)).toBe(-1);
		expect(summaryEntryIndexOfRange([], 0, 0)).toBe(-1);
	});
});
