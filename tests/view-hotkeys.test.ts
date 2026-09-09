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
import { handleEditNodeHotkey, registerViewHotkeys } from '../src/features/view-hotkeys';
import { getActiveNode, isEditingText, startNodeTextEdit } from '../src/mindmap';

vi.mock('../src/mindmap', () => ({
	ENGINE_COMMANDS: { BACK: 'BACK', FORWARD: 'FORWARD' },
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

describe('registerViewHotkeys（视图 scope 接线）', () => {
	/** 记录式 scope 桩：捕获注册的 modifiers/key/handler */
	function makeScope() {
		const registrations: {
			modifiers: string[] | null;
			key: string | null;
			handler: (evt: KeyboardEvent) => unknown;
		}[] = [];
		const scope = {
			register(
				modifiers: string[] | null,
				key: string | null,
				handler: (evt: KeyboardEvent) => unknown,
			) {
				registrations.push({ modifiers, key, handler });
				return {} as unknown;
			},
		};
		return {
			scope: scope as unknown as import('obsidian').Scope,
			registrations,
			find: (key: string, modifiers: string[]) =>
				registrations.find(
					(entry) =>
						entry.key === key &&
						JSON.stringify(entry.modifiers) === JSON.stringify(modifiers),
				),
		};
	}

	beforeEach(() => {
		vi.mocked(getActiveNode).mockReset().mockReturnValue(null);
		vi.mocked(isEditingText).mockReset().mockReturnValue(false);
		vi.mocked(startNodeTextEdit).mockReset();
	});

	it('注册 Mod+F / Mod+Z / Mod+Shift+Z / Mod+Y / F2 五个快捷键', () => {
		const { scope, registrations, find } = makeScope();
		registerViewHotkeys(scope, {
			mindMap: {} as MindMap,
			engineEvents: {},
			viewEvents: {},
			openSearchBar: vi.fn(),
		} as unknown as Parameters<typeof registerViewHotkeys>[1]);

		expect(find('f', ['Mod']), 'Mod+F 搜索').toBeDefined();
		expect(find('z', ['Mod']), 'Mod+Z 撤销').toBeDefined();
		expect(find('z', ['Mod', 'Shift']), 'Mod+Shift+Z 重做').toBeDefined();
		// 非 macOS（测试环境 Platform.isMacOS 为 undefined）注册 Mod+Y
		expect(find('y', ['Mod']), 'Mod+Y 重做').toBeDefined();
		// F2 用空修饰键数组注册（无修饰键的精确匹配）
		expect(find('F2', []), 'F2 编辑节点').toBeDefined();
		expect(registrations).toHaveLength(5);
	});

	it('Mod+Z / Mod+Shift+Z / Mod+Y 转发到引擎撤销重做命令', () => {
		const { scope, find } = makeScope();
		const execCommand = vi.fn();
		registerViewHotkeys(scope, {
			mindMap: { execCommand } as unknown as MindMap,
			engineEvents: {},
			viewEvents: {},
			openSearchBar: vi.fn(),
		} as unknown as Parameters<typeof registerViewHotkeys>[1]);

		expect(find('z', ['Mod'])!.handler(fakeKeyEvent().evt)).toBe(false);
		expect(execCommand).toHaveBeenLastCalledWith('BACK');
		find('z', ['Mod', 'Shift'])!.handler(fakeKeyEvent().evt);
		expect(execCommand).toHaveBeenLastCalledWith('FORWARD');
		find('y', ['Mod'])!.handler(fakeKeyEvent().evt);
		expect(execCommand).toHaveBeenLastCalledWith('FORWARD');
	});

	it('Mod+F 打开搜索栏；F2 走编辑节点处理器', () => {
		const { scope, find } = makeScope();
		const openSearchBar = vi.fn();
		vi.mocked(getActiveNode).mockReturnValue(node);
		registerViewHotkeys(scope, {
			mindMap: {} as MindMap,
			engineEvents: {},
			viewEvents: {},
			openSearchBar,
		} as unknown as Parameters<typeof registerViewHotkeys>[1]);

		find('f', ['Mod'])!.handler(fakeKeyEvent().evt);
		expect(openSearchBar).toHaveBeenCalledTimes(1);

		find('F2', [])!.handler(fakeKeyEvent().evt);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
	});

	it('scope 为 null（引擎/视图未就绪）：静默不抛异常', () => {
		expect(() =>
			registerViewHotkeys(null, {
				mindMap: null,
				engineEvents: {},
				viewEvents: {},
				openSearchBar: vi.fn(),
			} as unknown as Parameters<typeof registerViewHotkeys>[1]),
		).not.toThrow();
	});
});
