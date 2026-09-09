/**
 * 视图内 F2「编辑当前节点」回归。
 *
 * 引擎自带的 F2（TextEdit 插件）前置判定苛刻——事件目标须为 `document.body`
 * 且指针须在画布内（`enableShortcutOnlyWhenMouseInSvg` 默认 true），点击节点后
 * 常失效；本处理器由视图 scope 接管，负责吞键、让位与去重。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Scope } from 'obsidian';
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

describe('registerViewHotkeys（视图作用域接线）', () => {
	/** mock 的 Scope 形状（真实 d.ts 只有 register/unregister） */
	interface ScopeStub {
		parent: unknown;
		registered: { modifiers: unknown; key: unknown; handler: unknown }[];
	}

	/**
	 * 视图桩：`scope` 默认 null——真实 Obsidian 的 `View.scope` 就是这样
	 * （官方 1.5.7+ 文档：须由视图自行 `new Scope(app.scope)`）。
	 */
	function makeView(
		overrides: {
			mindMap?: unknown;
			scope?: unknown;
			openSearchBar?: () => void;
		} = {},
	) {
		const parentScope = new Scope();
		const view = {
			mindMap: overrides.mindMap ?? {},
			engineEvents: {},
			viewEvents: {},
			openSearchBar: overrides.openSearchBar ?? vi.fn(),
			app: { scope: parentScope },
			scope: overrides.scope ?? null,
		};
		return {
			view,
			parentScope,
			host: view as unknown as Parameters<typeof registerViewHotkeys>[0],
		};
	}

	const find = (scope: ScopeStub, key: string, modifiers: string[]) =>
		scope.registered.find(
			(entry) =>
				entry.key === key &&
				JSON.stringify(entry.modifiers) === JSON.stringify(modifiers),
		);

	beforeEach(() => {
		vi.mocked(getActiveNode).mockReset().mockReturnValue(null);
		vi.mocked(isEditingText).mockReset().mockReturnValue(false);
		vi.mocked(startNodeTextEdit).mockReset();
	});

	it('视图无作用域时按官方要求创建（父作用域 = app.scope），并注册 5 个快捷键', () => {
		const { view, host, parentScope } = makeView();
		expect(view.scope, '前置：Obsidian 里 View.scope 默认为 null').toBeNull();

		registerViewHotkeys(host);

		// 根因回归：不创建 scope 时 `scope?.register` 静默失效，F2/Mod+F/撤销重做全部无效
		expect(view.scope, '已创建视图作用域').toBeInstanceOf(Scope);
		const scope = view.scope as unknown as ScopeStub;
		expect(scope.parent, '父作用域为 app.scope').toBe(parentScope);

		expect(find(scope, 'f', ['Mod']), 'Mod+F 搜索').toBeDefined();
		expect(find(scope, 'z', ['Mod']), 'Mod+Z 撤销').toBeDefined();
		expect(find(scope, 'z', ['Mod', 'Shift']), 'Mod+Shift+Z 重做').toBeDefined();
		// 非 macOS（测试环境 Platform.isMacOS 为 undefined）注册 Mod+Y
		expect(find(scope, 'y', ['Mod']), 'Mod+Y 重做').toBeDefined();
		// F2 用空修饰键数组注册（无修饰键的精确匹配）
		expect(find(scope, 'F2', []), 'F2 编辑节点').toBeDefined();
		expect(scope.registered).toHaveLength(5);
	});

	it('已有作用域时复用（幂等：不重建、不丢已注册项）', () => {
		const existing = new Scope();
		const { host, view } = makeView({ scope: existing });
		registerViewHotkeys(host);
		expect(view.scope).toBe(existing);
		expect((existing as unknown as ScopeStub).registered).toHaveLength(5);
	});

	it('Mod+Z / Mod+Shift+Z / Mod+Y 转发到引擎撤销重做命令', () => {
		const execCommand = vi.fn();
		const { host, view } = makeView({ mindMap: { execCommand } });
		registerViewHotkeys(host);
		const scope = view.scope as unknown as ScopeStub;

		expect(find(scope, 'z', ['Mod'])!.handler).toBeTypeOf('function');
		(
			find(scope, 'z', ['Mod'])!.handler as (e: KeyboardEvent) => unknown
		)(fakeKeyEvent().evt);
		expect(execCommand).toHaveBeenLastCalledWith('BACK');
		(
			find(scope, 'z', ['Mod', 'Shift'])!.handler as (e: KeyboardEvent) => unknown
		)(fakeKeyEvent().evt);
		expect(execCommand).toHaveBeenLastCalledWith('FORWARD');
		(
			find(scope, 'y', ['Mod'])!.handler as (e: KeyboardEvent) => unknown
		)(fakeKeyEvent().evt);
		expect(execCommand).toHaveBeenLastCalledWith('FORWARD');
	});

	it('Mod+F 打开搜索栏；F2 走编辑节点处理器', () => {
		const openSearchBar = vi.fn();
		const { host, view } = makeView({ openSearchBar });
		vi.mocked(getActiveNode).mockReturnValue(node);
		registerViewHotkeys(host);
		const scope = view.scope as unknown as ScopeStub;

		(
			find(scope, 'f', ['Mod'])!.handler as (e: KeyboardEvent) => unknown
		)(fakeKeyEvent().evt);
		expect(openSearchBar).toHaveBeenCalledTimes(1);

		(
			find(scope, 'F2', [])!.handler as (e: KeyboardEvent) => unknown
		)(fakeKeyEvent().evt);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
	});

	it('引擎缺失（mindMap 为 null）：不抛异常', () => {
		const { host } = makeView({ mindMap: null });
		expect(() => registerViewHotkeys(host)).not.toThrow();
	});
});
