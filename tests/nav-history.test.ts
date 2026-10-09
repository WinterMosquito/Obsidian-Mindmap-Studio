/**
 * 导航历史卫生回归（K111，platform/nav-history）。
 *
 * 背景：打开 .mindmap.md 会在 leaf 历史里留下「同文件 markdown 中间态」，
 * 侧键后退落在它上面后被偏好恢复逻辑切回导图（净效果零）。修复＝视图切换
 * 落定后清理「尾部连续同文件段」内「视图类型 ≠ 目标类型」的冗余条目。
 *
 * 断言重点：
 * - 删除范围只在「尾部连续的同文件段」内——异文件条目即停（不跨段）；
 * - 目标态（keepViewType）保留，但其下更早的中间态仍要删（双条形态）；
 * - 形态异常 / 非数组 / 私有结构抛错 → 保守放弃（返回 0 / 不抛），
 *   退化为修复前行为，绝不因清理失败影响打开流程。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../src/core/constants';
import {
	openAsMarkdown,
	openAsMindMap,
	setViewSwitchDoneHook,
} from '../src/markdown/md-open';
import {
	pruneHistoryStack,
	pruneViewSwitchNoise,
} from '../src/platform/nav-history';

/** 历史条目桩：{state:{type,state:{file}}} 最小形态（与 Navigation 记录同构） */
function entry(file: string, type: string): unknown {
	return { state: { type, state: { file } } };
}

describe('pruneHistoryStack（尾部连续同文件段内删除跨视图冗余）', () => {
	it('单条中间态：尾部同文件、类型非目标 → 删除（实验 removed:1 形态）', () => {
		const stack = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(1);
		expect(stack).toEqual([entry('B.md', 'markdown')]);
	});

	it('双条（中间态 + 目标态）：保留目标态，删除其下更早的中间态', () => {
		const stack = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(1);
		expect(stack).toEqual([
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		]);
	});

	it('切回 Markdown 方向：保留 markdown 态、删除其上的导图态', () => {
		const stack = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
			entry('A.mindmap.md', 'markdown'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'markdown')).toBe(1);
		expect(stack).toEqual([
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
		]);
	});

	it('尾部已是目标态（无冗余）→ 不动', () => {
		const stack = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(0);
		expect(stack).toEqual([
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		]);
	});

	it('不跨异文件：同文件条目被异文件隔开时，更早那条是真实导航点 → 保留', () => {
		const stack = [
			entry('A.mindmap.md', 'markdown'), // 被 B.md 隔开，属更早的导航段
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(0);
		expect(stack).toEqual([
			entry('A.mindmap.md', 'markdown'),
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		]);
	});

	it('多条尾部同文件中间态：连续段内全部删除', () => {
		const stack = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(2);
		expect(stack).toEqual([
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'mindmap-view'),
		]);
	});

	it('幂等：重复清理（打开链路可能并发触发两次）第二次不再删', () => {
		const stack = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
		];
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(1);
		expect(pruneHistoryStack(stack, 'A.mindmap.md', 'mindmap-view')).toBe(0);
		expect(stack).toEqual([entry('B.md', 'markdown')]);
	});

	it('空栈 / 形态异常条目即停（保守不删、不抛）', () => {
		expect(pruneHistoryStack([], 'A.mindmap.md', 'mindmap-view')).toBe(0);

		// 尾条目形状不合（null / 缺 state / file 非字符串）→ 立即停
		expect(
			pruneHistoryStack(
				[entry('A.mindmap.md', 'markdown'), null],
				'A.mindmap.md',
				'mindmap-view',
			),
		).toBe(0);
		const malformed = [
			entry('A.mindmap.md', 'markdown'),
			{ state: { type: 'markdown' } },
		];
		expect(pruneHistoryStack(malformed, 'A.mindmap.md', 'mindmap-view')).toBe(0);
		expect(malformed).toHaveLength(2);
	});

	it('非数组输入 → 0 且不抛', () => {
		expect(pruneHistoryStack(undefined, 'a', 'b')).toBe(0);
		expect(pruneHistoryStack(null, 'a', 'b')).toBe(0);
		expect(pruneHistoryStack('nope', 'a', 'b')).toBe(0);
	});
});

describe('pruneViewSwitchNoise（leaf.history 防御式访问）', () => {
	it('back / forward 两个栈都清理', () => {
		const backHistory = [
			entry('B.md', 'markdown'),
			entry('A.mindmap.md', 'markdown'),
		];
		const forwardHistory = [entry('A.mindmap.md', 'markdown')];
		const leaf = { history: { backHistory, forwardHistory } };

		pruneViewSwitchNoise(leaf as never, 'A.mindmap.md', 'mindmap-view');

		expect(backHistory).toEqual([entry('B.md', 'markdown')]);
		expect(forwardHistory).toEqual([]);
	});

	it('history 缺失 / 字段非数组 → 不抛、不动', () => {
		expect(() =>
			pruneViewSwitchNoise({} as never, 'a.mindmap.md', 'mindmap-view'),
		).not.toThrow();
		expect(() =>
			pruneViewSwitchNoise(
				{ history: null } as never,
				'a.mindmap.md',
				'mindmap-view',
			),
		).not.toThrow();
		expect(() =>
			pruneViewSwitchNoise(
				{ history: { backHistory: 'nope', forwardHistory: 0 } } as never,
				'a.mindmap.md',
				'mindmap-view',
			),
		).not.toThrow();
	});

	it('私有结构抛错（getter）→ 吞掉并 warn 记录（退化为修复前行为，不弹 Notice）', () => {
		// 2026-10-07 由 debug 升为 warn：本行是「侧键后退无反应」的唯一诊断线索，
		// 留在 debug 级别会被默认的「隐藏级别」过滤掉。
		// 同时**刻意不弹 Notice**——该探测每次视图切换都跑，私有结构一改就刷屏。
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		const leaf = {
			get history(): never {
				throw new Error('private structure changed');
			},
		};

		expect(() =>
			pruneViewSwitchNoise(leaf as never, 'a.mindmap.md', 'mindmap-view'),
		).not.toThrow();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(debugSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		debugSpy.mockRestore();
	});
});

/**
 * 钩子接线（md-open 编排面 → 组合根注入的 prune 实现）：纯函数之外的接线一旦
 * 被误删或改错（通知挪进 try 内、忘记传「目标视图类型」、失败路径也通知），
 * 历史栈会重新积累同文件中间态、侧键后退故障复发——故在此钉住通知时机、
 * 参数与错误归因。
 */
describe('md-open 视图切换落定钩子接线', () => {
	afterEach(() => {
		// 复位模块级钩子，避免污染同文件其它用例
		setViewSwitchDoneHook(null);
	});

	it('openAsMindMap 落定后通知（leaf / 文件路径 / 目标视图类型；mdBackMode 取进入前模式）', async () => {
		const calls: unknown[][] = [];
		setViewSwitchDoneHook((...args) => {
			calls.push(args);
		});
		const view = Object.assign(new MarkdownView(null as never), {
			getMode: () => 'preview',
		});
		const leaf = { view, setViewState: vi.fn().mockResolvedValue(undefined) };
		const file = Object.assign(new TFile(), {
			path: 'a.mindmap.md',
			extension: 'md',
		});

		await openAsMindMap(leaf as never, file);

		expect(leaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE,
			state: { file: 'a.mindmap.md', mdBackMode: 'preview' },
		});
		expect(calls).toEqual([[leaf, 'a.mindmap.md', VIEW_TYPE]]);
	});

	it('openAsMarkdown 落定后通知（目标视图类型为 markdown）', async () => {
		const calls: unknown[][] = [];
		setViewSwitchDoneHook((...args) => {
			calls.push(args);
		});
		const leaf = { setViewState: vi.fn().mockResolvedValue(undefined) };
		const file = Object.assign(new TFile(), {
			path: 'a.mindmap.md',
			extension: 'md',
		});

		await openAsMarkdown(leaf as never, file, 'preview');

		expect(leaf.setViewState).toHaveBeenCalledWith({
			type: CORE_VIEW_TYPE.MARKDOWN,
			state: { file: 'a.mindmap.md', mode: 'preview' },
		});
		expect(calls).toEqual([[leaf, 'a.mindmap.md', CORE_VIEW_TYPE.MARKDOWN]]);
	});

	it('切换失败（setViewState 拒绝）→ 不通知钩子，且不产生未处理拒绝', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const hook = vi.fn();
		setViewSwitchDoneHook(hook);
		const leaf = { setViewState: vi.fn().mockRejectedValue(new Error('leaf gone')) };
		const file = Object.assign(new TFile(), {
			path: 'a.mindmap.md',
			extension: 'md',
		});

		await expect(openAsMindMap(leaf as never, file)).resolves.toBeUndefined();

		expect(hook).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledTimes(1);
		errorSpy.mockRestore();
	});

	it('钩子抛错被就地兜住：不 reject、不误报「切换失败」（错误归因）', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		setViewSwitchDoneHook(() => {
			throw new Error('hook boom');
		});
		const leaf = { view: {}, setViewState: vi.fn().mockResolvedValue(undefined) };
		const file = Object.assign(new TFile(), {
			path: 'a.mindmap.md',
			extension: 'md',
		});

		await expect(openAsMindMap(leaf as never, file)).resolves.toBeUndefined();

		// 切换本身成功 → 不得出现「切换到思维导图视图失败」日志
		expect(errorSpy).not.toHaveBeenCalled();
		expect(debugSpy).toHaveBeenCalledTimes(1);
		debugSpy.mockRestore();
	});
});
