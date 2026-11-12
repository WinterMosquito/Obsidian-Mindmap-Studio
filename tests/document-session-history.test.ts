/**
 * 会话撤销栈（`services/document-session-history.ts`）直测。
 *
 * 关注点是**语义**而不是实现：
 * - 初始态是第 0 步（打开时的样子），空栈时撤销 / 重做均为 no-op；
 * - 入栈截断 redo 分支（撤销后再编辑，与常规编辑器一致）；
 * - 与当前状态逐字相同的快照不入栈（`seedInitialHistory` 会发一次
 *   `data_change`，不挡就会多出一条「按 Ctrl+Z 毫无反应」的幽灵历史）；
 * - 超过上限从最旧一端丢弃，游标始终指向最后一项；
 * - 单游标：撤销后重做回到同一状态（官方是每视图镜像游标，会「撤销别人的
 *   撤销」，见 K180 的差异说明）。
 */
import { describe, expect, it, vi } from 'vitest';
import { SessionHistory } from '../src/services/document-session-history';

/** 判等：测试里都是字符串快照 */
const equals = (left: string, right: string): boolean => left === right;

function makeHistory(limit = 5): SessionHistory<string> {
	return new SessionHistory<string>(() => limit);
}

describe('SessionHistory', () => {
	it('reset 后只有一条初始状态：不可撤销 / 不可重做', () => {
		const history = makeHistory();
		history.reset('open');

		expect(history.current).toBe('open');
		expect(history.length).toBe(1);
		expect(history.position).toBe(0);
		expect(history.canUndo()).toBe(false);
		expect(history.canRedo()).toBe(false);
		expect(history.undo()).toBeNull();
		expect(history.redo()).toBeNull();
	});

	it('push 追加并移动游标；撤销 / 重做逐步前进后退', () => {
		const history = makeHistory();
		history.reset('0');
		expect(history.push('1', equals)).toBe(true);
		expect(history.push('2', equals)).toBe(true);

		expect(history.length).toBe(3);
		expect(history.position).toBe(2);
		expect(history.canUndo()).toBe(true);

		expect(history.undo()).toBe('1');
		expect(history.undo()).toBe('0');
		expect(history.undo(), '已到起点：不改状态、返回 null').toBeNull();
		expect(history.position).toBe(0);

		expect(history.redo()).toBe('1');
		expect(history.redo()).toBe('2');
		expect(history.redo(), '已到末端：返回 null').toBeNull();
	});

	it('与当前状态相同的快照不入栈（防幽灵历史）', () => {
		const history = makeHistory();
		history.reset('open');

		expect(history.push('open', equals)).toBe(false);
		expect(history.length).toBe(1);
		expect(history.canUndo()).toBe(false);
	});

	it('knownDistinct：调用方已证明不同就不再做判等（省整树序列化）', () => {
		const history = makeHistory();
		history.reset('0');
		const equalsSpy = vi.fn(equals);

		expect(history.push('0', equalsSpy, true)).toBe(true);
		expect(equalsSpy).not.toHaveBeenCalled();
		expect(history.length).toBe(2);
	});

	it('撤销后再 push：截断 redo 分支', () => {
		const history = makeHistory();
		history.reset('0');
		history.push('1', equals);
		history.push('2', equals);
		history.undo(); // 回到 '1'

		expect(history.push('1b', equals)).toBe(true);
		expect(history.length).toBe(3);
		expect(history.current).toBe('1b');
		expect(history.canRedo(), '新编辑后 redo 分支必须消失').toBe(false);
	});

	it('超过上限从最旧一端丢弃，游标指向最新', () => {
		const history = makeHistory(3);
		history.reset('0');
		history.push('1', equals);
		history.push('2', equals);
		history.push('3', equals);
		history.push('4', equals);

		expect(history.length).toBe(3);
		expect(history.current).toBe('4');
		expect(history.position).toBe(2);
		// 只能退回 '2'（'0'/'1' 已丢弃）
		expect(history.undo()).toBe('3');
		expect(history.undo()).toBe('2');
		expect(history.undo()).toBeNull();
	});

	it('上限为 0 / 负数时至少保留 1 条（永不空栈）', () => {
		const history = makeHistory(0);
		history.reset('0');
		history.push('1', equals);

		expect(history.length).toBe(1);
		expect(history.current).toBe('1');
	});

	it('replaceCurrent：就地改写当前快照，不新增历史、不动游标', () => {
		const history = makeHistory();
		history.reset('open');
		history.push('edit', equals);
		history.push('edit2', equals);

		// 派生归一：编辑后的就地修正（如层级语法守卫改 md 字段）
		expect(history.replaceCurrent('edit2+norm')).toBe(true);

		expect(history.length, '条数不变').toBe(3);
		expect(history.position).toBe(2);
		expect(history.current).toBe('edit2+norm');
		// 撤销一步回到编辑**之前**，而不是归一前的 edit2（否则要按两次）
		expect(history.undo()).toBe('edit');
		expect(history.redo()).toBe('edit2+norm');
	});

	it('replaceCurrent：尚未 reset 时返回 false（不改任何状态）', () => {
		const history = makeHistory();
		expect(history.replaceCurrent('x')).toBe(false);
		expect(history.length).toBe(0);
		expect(history.current).toBeNull();
	});

	it('setData 风格的全量替换只留一条（reset 语义）', () => {
		const history = makeHistory();
		history.reset('0');
		history.push('1', equals);
		history.reset('external');

		expect(history.length).toBe(1);
		expect(history.current).toBe('external');
		expect(history.canUndo()).toBe(false);
	});
});
