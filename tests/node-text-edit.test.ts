/**
 * 节点文本编辑入口回归（右键菜单「编辑文本」）。
 *
 * 修复的两个坑（引擎 0.14.0-fix.3 实测）：
 * - 右键菜单项的 click 会继续冒泡到 `document.body`，引擎的 `body_click`
 *   （`isEndNodeTextEditOnClickOuter` 默认 true）会立刻关闭刚打开的编辑框，
 *   故必须延后一个宏任务再触发 `node_dblclick`；
 * - `isInserting` 必须为 false（true 表示「新建节点后的首次编辑」）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import { startNodeTextEdit } from '../src/mindmap';

// mindmap.ts 经 import 链加载 vendor bundle（顶层求值触碰 document.documentElement）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

function makeMindMap(textEditNode: { focus: () => void } | null) {
	const emit = vi.fn();
	const mindMap = {
		emit,
		renderer: textEditNode ? { textEdit: { textEditNode } } : {},
	} as unknown as MindMap;
	return { mindMap, emit };
}

describe('startNodeTextEdit（右键「编辑文本」入口）', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('延后一个宏任务触发 node_dblclick，且 isInserting=false', () => {
		vi.useFakeTimers();
		const focus = vi.fn();
		const { mindMap, emit } = makeMindMap({ focus });
		const node = {} as MindMapNode;

		startNodeTextEdit(mindMap, node);
		// 同步阶段不得触发：菜单点击的 body_click 会在此刻关闭编辑框
		expect(emit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(0);
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledWith('node_dblclick', node, null, false);
		// 菜单关闭后焦点可能回到画布：补一次焦点，保证可直接输入
		expect(focus).toHaveBeenCalledTimes(1);
	});

	it('编辑框尚未创建（引擎未就绪）：不抛异常', () => {
		vi.useFakeTimers();
		const { mindMap, emit } = makeMindMap(null);
		startNodeTextEdit(mindMap, {} as MindMapNode);
		expect(() => vi.advanceTimersByTime(0)).not.toThrow();
		expect(emit).toHaveBeenCalledTimes(1);
	});
});
