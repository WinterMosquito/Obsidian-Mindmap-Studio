/**
 * 节点文本编辑入口回归（右键菜单「编辑文本」）。
 *
 * 为什么这样断言（两个坑均经引擎 0.14.0-fix.3 vendor 产物实测）：
 * - 右键菜单项的 click 会继续冒泡到 `document.body`，引擎的 `body_click`
 *   （`isEndNodeTextEditOnClickOuter` 默认 true）会立刻把刚打开的编辑框关掉，
 *   故 `startNodeTextEdit` 必须**延后一个宏任务**再 emit `node_dblclick`
 *   ——本文件因此用 fake timers 断言「同步阶段尚未 emit / 推进一个宏任务后才
 *   emit」，而不是只看最终结果（同步 emit 也会「最终」被调用过，断言不出来）；
 * - `isInserting` 必须为 false：引擎核心文本编辑的 `node_dblclick` 监听是
 *   `(node, e, isInserting) => show({node, e, isInserting})`，传 true 会按
 *   「新建节点后的首次编辑」处理（语义错误）。
 *
 * 引擎无 ENTER_TEXT_EDIT 命令，`node_dblclick` 事件是文本编辑的官方入口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import { startNodeTextEdit } from '../src/mindmap';

// mindmap.ts 经 import 链加载真实 vendor bundle（顶层求值触碰 document.documentElement）；
// 静态 import 先于模块体执行，故桩必须放进 vi.hoisted 才会先落地。
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

function makeMindMap(textEditNode: { focus: () => void } | null) {
	const emit = vi.fn<(event: string, ...args: unknown[]) => void>();
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
		const focus = vi.fn<() => void>();
		const { mindMap, emit } = makeMindMap({ focus });
		const node = { uid: 'n1' } as unknown as MindMapNode;

		startNodeTextEdit(mindMap, node);

		// 关键：同步阶段不得触发——菜单 click 的 body_click 正在此刻冒泡到 body，
		// 若此刻已 emit，刚打开的编辑框会被同一个 click 立刻关掉。
		expect(emit).not.toHaveBeenCalled();
		// 且确实挂的是一个定时器（宏任务），不是 microtask（否则 body_click 之前就跑完）
		expect(vi.getTimerCount()).toBe(1);

		vi.advanceTimersByTime(0);

		expect(vi.getTimerCount()).toBe(0);
		expect(emit).toHaveBeenCalledTimes(1);
		// 载荷：事件名 + 节点 + 原生事件占位 null + isInserting=false（第三参即 isInserting）
		expect(emit).toHaveBeenCalledWith('node_dblclick', node, null, false);
		expect(emit.mock.calls[0]![3]).toBe(false);
		// 菜单关闭后浏览器可能把焦点还给画布：补一次焦点，保证可直接输入
		expect(focus).toHaveBeenCalledTimes(1);
	});

	it('先 emit 打开编辑框、再聚焦（顺序不可颠倒）', () => {
		vi.useFakeTimers();
		const focus = vi.fn<() => void>();
		const { mindMap, emit } = makeMindMap({ focus });

		startNodeTextEdit(mindMap, {} as unknown as MindMapNode);
		vi.advanceTimersByTime(0);

		// 编辑框由 emit 创建 → focus 必须晚于 emit，否则聚焦的是尚未存在的 DOM
		expect(emit.mock.invocationCallOrder[0]!).toBeLessThan(
			focus.mock.invocationCallOrder[0]!,
		);
	});

	it('两次调用各自独立延后一次（互不吞并、不合并）', () => {
		vi.useFakeTimers();
		const focus = vi.fn<() => void>();
		const { mindMap, emit } = makeMindMap({ focus });

		startNodeTextEdit(mindMap, {} as unknown as MindMapNode);
		startNodeTextEdit(mindMap, {} as unknown as MindMapNode);
		expect(emit).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(2);

		vi.advanceTimersByTime(0);
		expect(emit).toHaveBeenCalledTimes(2);
		expect(focus).toHaveBeenCalledTimes(2);
	});

	it('编辑框尚未创建（引擎未就绪 / textEditNode 为 null）：不抛异常且仍 emit', () => {
		vi.useFakeTimers();
		const { mindMap, emit } = makeMindMap(null);

		startNodeTextEdit(mindMap, {} as unknown as MindMapNode);

		expect(() => vi.advanceTimersByTime(0)).not.toThrow();
		expect(emit).toHaveBeenCalledTimes(1);
	});
});
