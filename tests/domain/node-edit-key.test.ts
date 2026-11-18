/** 纯键盘语义直测：所有修饰键组合均保持现有节点原文编辑行为。 */
import { describe, expect, it } from 'vitest';
import { resolveInlineEditKey } from '../../src/domain/node-edit-key';

describe('节点编辑按键语义', () => {
	it('Enter 的 16 种修饰键组合：Alt 让位、纯 Shift 换行、其余提交', () => {
		for (let mask = 0; mask < 16; mask++) {
			const event = { key: 'Enter', shiftKey: !!(mask & 1), ctrlKey: !!(mask & 2), metaKey: !!(mask & 4), altKey: !!(mask & 8) };
			const expected = event.altKey ? 'none' : event.shiftKey && !event.ctrlKey && !event.metaKey ? 'newline' : 'commit';
			expect(resolveInlineEditKey(event), `modifiers=${mask}`).toBe(expected);
		}
	});

	it('Escape 与 Tab 停止并保留；常规键和 Process 留给原生输入', () => {
		const modifiers = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
		for (const key of ['Escape', 'Tab']) expect(resolveInlineEditKey({ key, ...modifiers })).toBe('commit');
		for (const key of ['a', 'ArrowDown', 'Backspace', 'Process']) expect(resolveInlineEditKey({ key, ...modifiers })).toBe('none');
	});
});
