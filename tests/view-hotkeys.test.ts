/**
 * 视图内 F2「编辑当前节点」回归。
 *
 * 引擎自带的 F2（TextEdit 插件）前置判定苛刻——事件目标须为 `document.body`
 * 且指针须在画布内（`enableShortcutOnlyWhenMouseInSvg` 默认 true），点击节点后
 * 常失效；本处理器由视图 scope 接管，负责吞键、让位与去重。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { ViewEngineContext } from '../src/features/view-context';
import { handleEditNodeHotkey } from '../src/features/view-hotkeys';
import { getActiveNode, isEditingText, startNodeTextEdit } from '../src/mindmap';

vi.mock('../src/mindmap', () => ({
	getActiveNode: vi.fn(),
	isEditingText: vi.fn(),
	startNodeTextEdit: vi.fn(),
}));

/** 最小键盘事件桩：只实现处理器实际访问的面（mock 单独持有，避免 unbound-method） */
function fakeKeyEvent(target: unknown = null) {
	const preventDefault = vi.fn();
	const stopPropagation = vi.fn();
	const evt = { target, preventDefault, stopPropagation } as unknown as KeyboardEvent;
	return { evt, preventDefault, stopPropagation };
}

function fakeView(mindMap: MindMap | null): ViewEngineContext {
	return {
		mindMap,
		engineEvents: {},
		viewEvents: {},
	} as unknown as ViewEngineContext;
}

const node = {} as MindMapNode;

describe('handleEditNodeHotkey（F2 编辑当前节点）', () => {
	beforeEach(() => {
		vi.mocked(getActiveNode).mockReset().mockReturnValue(null);
		vi.mocked(isEditingText).mockReset().mockReturnValue(false);
		vi.mocked(startNodeTextEdit).mockReset();
	});

	it('有激活节点：触发文本编辑，并阻断冒泡（避免引擎 F2 再开一次）', () => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		const mindMap = {} as MindMap;
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		expect(handleEditNodeHotkey(fakeView(mindMap), evt)).toBe(false);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
		expect(startNodeTextEdit).toHaveBeenCalledWith(mindMap, node);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('无激活节点：吞掉 F2（不让核心「重命名文件」接手）但不触发编辑', () => {
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		expect(handleEditNodeHotkey(fakeView({} as MindMap), evt)).toBe(false);
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('引擎未就绪（mindMap 为 null）：不抛异常', () => {
		const { evt } = fakeKeyEvent();

		expect(() => handleEditNodeHotkey(fakeView(null), evt)).not.toThrow();
		expect(handleEditNodeHotkey(fakeView(null), evt)).toBe(false);
		expect(startNodeTextEdit).not.toHaveBeenCalled();
	});

	it('已在编辑文本：不重复触发（避免 hide/show 闪烁丢光标）', () => {
		vi.mocked(isEditingText).mockReturnValue(true);
		vi.mocked(getActiveNode).mockReturnValue(node);
		const { evt, preventDefault } = fakeKeyEvent();

		expect(handleEditNodeHotkey(fakeView({} as MindMap), evt)).toBe(false);
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		expect(preventDefault).toHaveBeenCalledTimes(1);
	});

	it('输入框/搜索框内：让位给输入（返回 true = 未接管，不改默认行为）', () => {
		for (const target of [
			{ tagName: 'INPUT' },
			{ tagName: 'TEXTAREA' },
			{ tagName: 'DIV', isContentEditable: true },
		]) {
			const { evt, preventDefault, stopPropagation } = fakeKeyEvent(target);
			expect(handleEditNodeHotkey(fakeView({} as MindMap), evt)).toBe(true);
			expect(preventDefault).not.toHaveBeenCalled();
			expect(stopPropagation).not.toHaveBeenCalled();
			expect(startNodeTextEdit).not.toHaveBeenCalled();
		}
	});
});
