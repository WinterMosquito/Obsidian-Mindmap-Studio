/**
 * view-hotkeys 回归：视图内快捷键注册与 F2「编辑当前节点」处理器。
 *
 * 覆盖模块自身的分支决策：
 * - `ensureViewScope`：`View.scope` 自 Obsidian 1.5.7 起默认为 null，不自行
 *   `new Scope(app.scope)` 时 `scope?.register(...)` 静默失效（视图内 F2 /
 *   Mod+F / 撤销重做全部无效）——幂等创建与复用都要断言；
 * - `registerViewHotkeys`：Mod+F 搜索、Mod+Z/Mod+Shift+Z（+ 非 macOS 的 Mod+Y）
 *   撤销重做（转发 ENGINE_COMMANDS）、F2 用空修饰键注册；
 * - `handleEditNodeHotkey`：有激活节点时吞键（preventDefault + stopPropagation，
 *   避免引擎 window 级 F2 再 hide/show 一次）并编辑该节点；输入框/编辑框内让位
 *   （返回 true = 未接管）；正在编辑时忽略；**无激活节点时让位**——F2 交回核心
 *   「重命名文件」，与 Obsidian 官方语义一致（2026-09-15 对齐）。
 *
 * 引擎侧判定（getActiveNode / isEditingText / startNodeTextEdit / isCustomNodeContent）经
 * `vi.mock('../src/engine/mindmap', …)` 替换为 spy：本文件只验证「何时调用、传什么参数」，
 * 引擎内部行为由 mindmap 自身的回归覆盖。F2 自 2026-09-14 起走**共用编辑入口**
 * （view-node-actions.editNodeText）：默认文本节点仍落 `startNodeTextEdit`（引擎编辑框），
 * 自绘（富）节点落插件**内联编辑器**（2026-09-28 起，`features/node-inline-editor`；
 * 弹窗收编为右键备选入口，编辑器内部行为由 tests/node-inline-editor.test.ts 覆盖）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Platform, Scope } from 'obsidian';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { ViewNodeEditContext } from '../src/features/view-context';
import {
	ensureViewScope,
	handleEditNodeHotkey,
	registerViewHotkeys,
	type ViewHotkeyHost,
} from '../src/features/view-hotkeys';
import {
	fitMindMap,
	getActiveNode,
	isCustomNodeContent,
	isEditingText,
	setNodeText,
	startNodeTextEdit,
} from '../src/engine/mindmap';
import { openNodeTextModal } from '../src/ui/modal-text';
import {
	isAnyNodeEditing,
	openNodeInlineEditor,
} from '../src/features/node-inline-editor';

vi.mock('../src/engine/mindmap', () => ({
	// 与生产常量表同名同值（断言处用字面量核对转发目标）
	ENGINE_COMMANDS: { BACK: 'BACK', FORWARD: 'FORWARD' },
	getActiveNode: vi.fn(),
	isEditingText: vi.fn(),
	// 自绘节点判定：默认 falsy（= 默认 SVG 文本节点，走引擎编辑框）
	isCustomNodeContent: vi.fn(),
	// 编辑入口读节点当前文本（自绘节点分支）
	getNodeDataString: vi.fn((): string => ''),
	startNodeTextEdit: vi.fn(),
	setNodeText: vi.fn(),
	// 原文模式写回路径会标脏重排（真实实现在 engine 层，此处只需不抛错）
	markNodeNeedLayout: vi.fn(),
	// 视口手势（Shift+1/Shift+2 → view-viewport）依赖的面：本文件只验证
	// 「注册了哪些键」，不触发处理器；桩上仅为 import 链完整
	fitMindMap: vi.fn(),
	getActiveNodes: vi.fn((): unknown[] => []),
	getNodeGroupEl: vi.fn((): Element | null => null),
	panMindMap: vi.fn(),
	toCanvasPoint: vi.fn(() => ({ x: NaN, y: NaN })),
	zoomMindMapAt: vi.fn(),
}));

// 插件内联编辑器（自绘节点的编辑入口，2026-09-28 起）：本文件只验证「何时调用」，
// 编辑器内部（定位/键盘/提交）由 tests/node-inline-editor.test.ts 与 verify:visual 覆盖
vi.mock('../src/features/node-inline-editor', () => ({
	isAnyNodeEditing: vi.fn(() => false),
	isInlineNodeEditing: vi.fn(() => false),
	openNodeInlineEditor: vi.fn(),
	closeInlineEditor: vi.fn(),
	applyRawNodeContent: vi.fn(),
}));

// 插件文本弹窗（**备选入口**：右键「在弹窗中编辑」）在 Node 环境无法开窗，替换为 spy
vi.mock('../src/ui/modal-text', () => ({ openNodeTextModal: vi.fn() }));

/**
 * 最小键盘事件桩：只实现处理器实际访问的面。
 * 四个 spy 由本函数单独持有（避免未绑定方法断言），`target` 即事件目标元素。
 */
function fakeKeyEvent(target: unknown = null) {
	const preventDefault = vi.fn();
	const stopPropagation = vi.fn();
	const evt = {
		target,
		preventDefault,
		stopPropagation,
	} as unknown as KeyboardEvent;
	return { evt, preventDefault, stopPropagation };
}

/** 编辑入口最小视图桩（F2 只读 mindMap + 弹窗所需的 app/lang + 保存调度） */
function fakeEngineView(mindMap: MindMap | null): ViewNodeEditContext {
	return {
		mindMap,
		engineEvents: {},
		viewEvents: {},
		app: {},
		lang: 'zh',
		scheduleSave: vi.fn(),
	} as unknown as ViewNodeEditContext;
}

/**
 * 本文件自建的 Scope 桩：只保留 `register` 的记录面。
 *
 * 不直接断言 tests/mocks/obsidian.ts 的 Scope 实例类型——那里的 `registered`
 * 元素是 `unknown`，与本文件用于查表的强类型记录形状不重叠（TS 会拒绝直接断言），
 * 故在测试内自带一份等价 fixture。
 */
class ScopeStub {
	readonly parent: unknown;
	readonly registered: { modifiers: unknown; key: unknown; handler: unknown }[] =
		[];

	constructor(parent?: unknown) {
		this.parent = parent;
	}

	register(modifiers: unknown, key: unknown, handler: unknown): unknown {
		const entry = { modifiers, key, handler };
		this.registered.push(entry);
		return entry;
	}

	unregister(_handler: unknown): void {}
}

/** 建一个 ScopeStub 并取回其记录面（Scope 类的类型面与记录面互不重叠，故分开持有） */
function makeScope(parent?: unknown): {
	scope: Scope;
	stub: ScopeStub;
} {
	const stub = new ScopeStub(parent);
	return { scope: stub as unknown as Scope, stub };
}

/**
 * 把视图作用域收窄成本文件的记录面。
 *
 * `Scope` 类的类型面（`register` 的官方签名）与 `ScopeStub` 的记录面互不重叠，
 * TS 拒绝直接断言，故必须经 `unknown` 中转；收 null 是为了让「尚未创建作用域」
 * 的负向用例也能安全地取记录面（此时 `registered` 不存在，断言自然失败）。
 */
const asScopeStub = (scope: Scope | null): ScopeStub =>
	scope as unknown as ScopeStub;

/** 视图桩：`scope` 默认 null——真实 Obsidian 的 `View.scope` 就是这样 */
function makeHost(
	overrides: {
		mindMap?: unknown;
		scope?: Scope | null;
		openSearchBar?: () => void;
		appScope?: unknown;
	} = {},
) {
	const parentScope = overrides.appScope ?? {};
	const openSearchBar = overrides.openSearchBar ?? vi.fn();
	const view = {
		mindMap: overrides.mindMap === undefined ? {} : overrides.mindMap,
		engineEvents: {},
		viewEvents: {},
		openSearchBar,
		app: { scope: parentScope },
		lang: 'zh',
		scheduleSave: vi.fn(),
		scope: overrides.scope ?? null,
		// 缩放快捷键（Shift+1/Shift+2）所需的画布面（本文件不触发其处理器）
		canvasEl: null,
	};
	return {
		view,
		parentScope,
		openSearchBar,
		/** 视图当前作用域的记录面（注册后即已创建的 Scope 实例） */
		viewScope: (): ScopeStub => view.scope as unknown as ScopeStub,
		host: view as unknown as ViewHotkeyHost,
	};
}

/** 按「键 + 修饰键数组」查注册项（修饰键顺序敏感：['Mod','Shift'] 与 ['Shift','Mod'] 是不同绑定） */
const find = (scope: ScopeStub, key: string, modifiers: string[]) =>
	scope.registered.find(
		(entry) =>
			entry.key === key &&
			JSON.stringify(entry.modifiers) === JSON.stringify(modifiers),
	);

/**
 * 编辑入口节点桩：`getData` 供「模式分流」读取（纯链接 → 别名模式；
 * 其余富节点 → 原文模式）。空 data ⇒ 非纯链接节点 ⇒ 走原文模式。
 */
const node = { getData: () => ({}) } as unknown as MindMapNode;

describe('handleEditNodeHotkey（F2 编辑当前节点）', () => {
	beforeEach(() => {
		vi.mocked(getActiveNode).mockReset().mockReturnValue(null);
		vi.mocked(isEditingText).mockReset().mockReturnValue(false);
		vi.mocked(startNodeTextEdit).mockReset();
		// 编辑入口分支：默认按「默认 SVG 文本节点」处理，富节点用例自行开启
		vi.mocked(isCustomNodeContent).mockReset().mockReturnValue(false);
		vi.mocked(setNodeText).mockReset();
		vi.mocked(openNodeTextModal).mockReset();
		// 任一编辑通道判据（引擎编辑框 ∨ 内联编辑器）：默认 false，
		// 用例按需开启（与其余 mock 同款显式重置，防跨用例泄漏）
		vi.mocked(isAnyNodeEditing).mockReset().mockReturnValue(false);
		vi.mocked(openNodeInlineEditor).mockReset();
	});

	it('有激活节点：触发文本编辑，并阻断默认行为与冒泡（避免引擎 F2 再开一次）', () => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		const mindMap = {} as MindMap;
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		// 返回 false = 已消费：否则 Obsidian 会把 F2 交给核心「重命名文件」
		expect(handleEditNodeHotkey(fakeEngineView(mindMap), evt)).toBe(false);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
		expect(startNodeTextEdit).toHaveBeenCalledWith(mindMap, node);
		// 阻断冒泡：引擎自己也绑了 F2（window 级），不阻断会 hide+show 闪一次
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('自绘（富）节点：走插件**内联编辑器**（覆盖层原文编辑，统一原文）', () => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		vi.mocked(isCustomNodeContent).mockReturnValue(true);
		const mindMap = {} as MindMap;
		const view = fakeEngineView(mindMap);

		expect(handleEditNodeHotkey(view, fakeKeyEvent().evt)).toBe(false);
		expect(startNodeTextEdit, '不走引擎编辑框').not.toHaveBeenCalled();
		expect(openNodeInlineEditor).toHaveBeenCalledTimes(1);
		expect(openNodeInlineEditor).toHaveBeenCalledWith(view, node);
		expect(openNodeTextModal, '内联为准，弹窗仅备选入口').not.toHaveBeenCalled();
	});

	it('纯链接节点：同样走内联编辑器（统一原文，无别名分流）', () => {
		const pure = {
			getData: () => ({
				text: '笔记A',
				mdDerivedText: '笔记A',
				mdWikiLinkpath: '[[笔记A]]',
				mdLinkStyle: 'wiki',
				mdLinkText: '笔记A',
			}),
		} as unknown as MindMapNode;
		vi.mocked(getActiveNode).mockReturnValue(pure);
		vi.mocked(isCustomNodeContent).mockReturnValue(true);
		const view = fakeEngineView({} as MindMap);

		expect(handleEditNodeHotkey(view, fakeKeyEvent().evt)).toBe(false);
		expect(openNodeInlineEditor).toHaveBeenCalledWith(view, pure);
		expect(openNodeTextModal, '别名模式只保留在弹窗备选入口').not.toHaveBeenCalled();
		expect(setNodeText, '不再走别名通道').not.toHaveBeenCalled();
	});

	it('任一编辑通道进行中（isAnyNodeEditing）：吞键但不重开编辑器', () => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		vi.mocked(isAnyNodeEditing).mockReturnValue(true);
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		expect(handleEditNodeHotkey(fakeEngineView({} as MindMap), evt)).toBe(false);
		// 编辑中：吞键（防引擎 F2 再开一次），但不重开任何编辑器
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(openNodeInlineEditor).not.toHaveBeenCalled();
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		// 还原默认值：本文件其余用例依赖 isAnyNodeEditing 默认 false
		vi.mocked(isAnyNodeEditing).mockReturnValue(false);
	});

	it('无激活节点：F2 交回 Obsidian（官方语义 = 重命名当前文件）', () => {
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		// 返回 true = 未接管：核心 F2「重命名文件」接手（2026-09-15 对齐官方）
		expect(handleEditNodeHotkey(fakeEngineView({} as MindMap), evt)).toBe(true);
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		expect(openNodeTextModal).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
	});

	it('引擎未就绪（mindMap 为 null）：吞键但不抛异常', () => {
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		expect(() => handleEditNodeHotkey(fakeEngineView(null), evt)).not.toThrow();
		expect(handleEditNodeHotkey(fakeEngineView(null), evt)).toBe(false);
		// mindMap 为空时短路在 isEditingText 之前（不访问引擎内部状态）
		expect(isEditingText).not.toHaveBeenCalled();
		expect(getActiveNode).not.toHaveBeenCalled();
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		expect(preventDefault).toHaveBeenCalledTimes(2);
		expect(stopPropagation).toHaveBeenCalledTimes(2);
	});

	it('已在编辑文本（任一通道）：不重复触发（避免 hide/show 闪烁丢光标），但仍吞键', () => {
		vi.mocked(isAnyNodeEditing).mockReturnValue(true);
		vi.mocked(getActiveNode).mockReturnValue(node);
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();

		expect(handleEditNodeHotkey(fakeEngineView({} as MindMap), evt)).toBe(false);
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		// 正在编辑时不再查激活节点（省一次引擎内部状态读取，也避免误重开）
		expect(getActiveNode).not.toHaveBeenCalled();
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('编辑态判据拿到的是本视图的引擎实例（isAnyNodeEditing）', () => {
		const mindMap = { id: 'mm' } as unknown as MindMap;
		handleEditNodeHotkey(fakeEngineView(mindMap), fakeKeyEvent().evt);
		expect(isAnyNodeEditing).toHaveBeenCalledWith(mindMap);
	});

	/** 文本输入类目标：F2 交回输入框与核心（让位） */
	const yieldCases: { name: string; target: unknown }[] = [
		{ name: 'INPUT（搜索框）', target: { tagName: 'INPUT' } },
		{ name: 'TEXTAREA（多行输入）', target: { tagName: 'TEXTAREA' } },
		{ name: 'SELECT（下拉控件）', target: { tagName: 'SELECT' } },
		{ name: 'contentEditable 元素（引擎文本编辑框）', target: { tagName: 'DIV', isContentEditable: true } },
		{ name: 'contentEditable 非 DIV', target: { tagName: 'SPAN', isContentEditable: true } },
	];

	it.each(yieldCases)('输入类目标让位：$name', ({ target }) => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent(target);

		// 返回 true = 未接管：默认行为不被改写，F2 归输入框/核心处理
		expect(handleEditNodeHotkey(fakeEngineView({} as MindMap), evt)).toBe(true);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(startNodeTextEdit).not.toHaveBeenCalled();
		// 让位先于一切引擎访问：连 isEditingText 都不该查
		expect(isEditingText).not.toHaveBeenCalled();
	});

	/** 非文本输入目标：接管（吞键 + 尝试编辑） */
	const takeoverCases: { name: string; target: unknown }[] = [
		{ name: 'target 为 null（window 级按键）', target: null },
		{ name: 'document.body', target: { tagName: 'BODY' } },
		{ name: '引擎画布 SVG', target: { tagName: 'svg' } },
		{ name: '节点元素 DIV（非编辑态）', target: { tagName: 'DIV' } },
		{ name: 'INPUT 大小写小写标签', target: { tagName: 'input' } },
		{ name: 'isContentEditable 为 false 的 DIV', target: { tagName: 'DIV', isContentEditable: false } },
	];

	it.each(takeoverCases)('非输入目标接管：$name', ({ target }) => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent(target);

		expect(handleEditNodeHotkey(fakeEngineView({} as MindMap), evt)).toBe(false);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
	});

	it('去重：同一处理器连续按两次 F2，不会出现「让位 + 接管」双重路径', () => {
		vi.mocked(getActiveNode).mockReturnValue(node);
		const mindMap = {} as MindMap;
		const first = fakeKeyEvent();
		const second = fakeKeyEvent();

		// 第一次接管并开编辑
		expect(handleEditNodeHotkey(fakeEngineView(mindMap), first.evt)).toBe(false);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
		// 第二次：已处于编辑态（isAnyNodeEditing 返回 true）→ 不重复触发
		vi.mocked(isAnyNodeEditing).mockReturnValue(true);
		expect(handleEditNodeHotkey(fakeEngineView(mindMap), second.evt)).toBe(false);
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
		expect(second.preventDefault).toHaveBeenCalledTimes(1);
	});
});

describe('ensureViewScope（View.scope 默认 null 的兜底创建）', () => {
	it('scope 为空时按官方要求创建（父作用域 = app.scope）', () => {
		const appScope = { name: 'app' };
		const { host, view } = makeHost({ appScope });

		expect(view.scope, '前置：Obsidian 里 View.scope 默认为 null').toBeNull();
		const scope = ensureViewScope(host);
		expect(view.scope, '已创建视图作用域').toBe(scope);
		const stub = view.scope as unknown as ScopeStub;
		expect(stub.parent, '父作用域取 app.scope').toBe(appScope);
		expect(stub.registered, '创建后尚无注册项').toHaveLength(0);
	});

	it('已有 scope：复用实例（幂等，不重建、父链不变）', () => {
		const { scope: existing, stub } = makeScope({ name: 'app' });
		const { host, view } = makeHost({ scope: existing });

		const scope = ensureViewScope(host);
		expect(scope).toBe(existing);
		expect(view.scope).toBe(existing);
		// 再次调用仍返回同一实例（注册项不会被清空）
		expect(ensureViewScope(host)).toBe(existing);
		expect(stub.registered).toHaveLength(0);
	});
});

describe('registerViewHotkeys（视图作用域接线）', () => {
	beforeEach(() => {
		vi.mocked(getActiveNode).mockReset().mockReturnValue(null);
		vi.mocked(isEditingText).mockReset().mockReturnValue(false);
		vi.mocked(startNodeTextEdit).mockReset();
		vi.mocked(isCustomNodeContent).mockReset().mockReturnValue(false);
		vi.mocked(setNodeText).mockReset();
		vi.mocked(openNodeTextModal).mockReset();
		vi.mocked(isAnyNodeEditing).mockReset().mockReturnValue(false);
		vi.mocked(openNodeInlineEditor).mockReset();
	});

	it('视图无作用域时自行创建（否则 scope?.register 静默失效）并注册 9 个快捷键', () => {
		const { view, host, parentScope } = makeHost();
		expect(view.scope, '前置：Obsidian 里 View.scope 默认为 null').toBeNull();

		registerViewHotkeys(host);

		// 根因回归：不创建 scope 时 `scope?.register` 静默失效，F2/Mod+F/撤销重做全废
		expect(view.scope, '已创建视图作用域').not.toBeNull();
		const scope = asScopeStub(view.scope);
		expect(scope.parent, '父作用域为 app.scope').toBe(parentScope);

		expect(find(scope, 'f', ['Mod']), 'Mod+F 搜索').toBeDefined();
		expect(find(scope, 'z', ['Mod']), 'Mod+Z 撤销').toBeDefined();
		expect(find(scope, 'z', ['Mod', 'Shift']), 'Mod+Shift+Z 重做').toBeDefined();
		// 测试环境 Platform.isMacOS 为假 → 注册 Mod+Y 重做
		expect(find(scope, 'y', ['Mod']), 'Mod+Y 重做').toBeDefined();
		// F2 无修饰键：必须用空数组注册（['Mod'] 之类会改变匹配语义）
		expect(find(scope, 'F2', []), 'F2 编辑节点').toBeDefined();
		// 删除节点（官方 Canvas：Backspace/Delete）与画布缩放（Shift+1/Shift+2）
		expect(find(scope, 'Delete', []), 'Delete 删除节点').toBeDefined();
		expect(find(scope, 'Backspace', []), 'Backspace 删除节点').toBeDefined();
		expect(find(scope, '1', ['Shift']), 'Shift+1 缩放到全览').toBeDefined();
		expect(find(scope, '2', ['Shift']), 'Shift+2 缩放到选区').toBeDefined();
		expect(scope.registered).toHaveLength(9);
	});

	it('已有作用域时复用（幂等：不重建、不丢已注册项）', () => {
		const { host, view } = makeHost();
		registerViewHotkeys(host);
		const first = view.scope;
		registerViewHotkeys(host);
		// 两次注册都落到同一实例上（视图 onOpen 重复调用不会各建一份 scope）
		expect(view.scope).toBe(first);
		expect(asScopeStub(first).registered).toHaveLength(18);
	});

	it('F2 只注册一条（去重：不得同时存在空修饰键与 Mod 变体）', () => {
		const { host, view } = makeHost();
		registerViewHotkeys(host);
		const scope = asScopeStub(view.scope);
		const f2Entries = scope.registered.filter((entry) => entry.key === 'F2');
		expect(f2Entries).toHaveLength(1);
		expect(f2Entries[0]?.modifiers).toEqual([]);
	});

	it('Mod+Z / Mod+Shift+Z / Mod+Y 转发到引擎撤销重做命令', () => {
		const execCommand = vi.fn();
		const { host, view } = makeHost({ mindMap: { execCommand } });
		registerViewHotkeys(host);
		const scope = asScopeStub(view.scope);

		// 处理器返回 false（已消费）——返回 true 会让按键继续下传
		const modZ = find(scope, 'z', ['Mod'])?.handler as (
			e: KeyboardEvent,
		) => unknown;
		expect(modZ(fakeKeyEvent().evt)).toBe(false);
		expect(execCommand).toHaveBeenLastCalledWith('BACK');

		const modShiftZ = find(scope, 'z', ['Mod', 'Shift'])?.handler as (
			e: KeyboardEvent,
		) => unknown;
		expect(modShiftZ(fakeKeyEvent().evt)).toBe(false);
		expect(execCommand).toHaveBeenLastCalledWith('FORWARD');

		const modY = find(scope, 'y', ['Mod'])?.handler as (
			e: KeyboardEvent,
		) => unknown;
		expect(modY(fakeKeyEvent().evt)).toBe(false);
		expect(execCommand).toHaveBeenLastCalledWith('FORWARD');
		expect(execCommand).toHaveBeenCalledTimes(3);
	});

	it('Mod+Z 的处理器不阻断默认行为（由作用域链自行消费）', () => {
		const execCommand = vi.fn();
		const { host, view } = makeHost({ mindMap: { execCommand } });
		registerViewHotkeys(host);
		const handler = find(asScopeStub(view.scope), 'z', ['Mod'])
			?.handler as (e: KeyboardEvent) => unknown;
		const { evt, preventDefault, stopPropagation } = fakeKeyEvent();
		handler(evt);
		// 撤销/重做只转发命令：不 preventDefault（避免影响浏览器原生编辑行为）
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
	});

	it('Mod+F 打开搜索栏（返回 false = 已消费）', () => {
		const { host, view, openSearchBar } = makeHost();
		registerViewHotkeys(host);
		const handler = find(asScopeStub(view.scope), 'f', ['Mod'])
			?.handler as (e: KeyboardEvent) => unknown;

		expect(handler(fakeKeyEvent().evt)).toBe(false);
		expect(openSearchBar).toHaveBeenCalledTimes(1);
	});

	it('Shift+1 / Shift+2：画布上缩放（全览 / 选区），输入框内让位（打 `!`/`@`）', () => {
		const { host, view } = makeHost();
		registerViewHotkeys(host);
		const scope = asScopeStub(view.scope);
		const plusOne = find(scope, '1', ['Shift'])?.handler as (
			e: KeyboardEvent,
		) => unknown;
		const plusTwo = find(scope, '2', ['Shift'])?.handler as (
			e: KeyboardEvent,
		) => unknown;

		// 画布上：Shift+1 = 适应画布（返回 false = 已消费）
		expect(plusOne(fakeKeyEvent({ tagName: 'svg' }).evt)).toBe(false);
		expect(fitMindMap).toHaveBeenCalledTimes(1);

		// 输入类目标让位：Shift+1/Shift+2 在输入框里是打 `!` / `@`
		for (const target of [
			{ tagName: 'INPUT' },
			{ tagName: 'TEXTAREA' },
			{ tagName: 'DIV', isContentEditable: true },
		]) {
			const one = fakeKeyEvent(target);
			expect(plusOne(one.evt), 'Shift+1 不劫持输入').toBe(true);
			expect(one.preventDefault).not.toHaveBeenCalled();
			const two = fakeKeyEvent(target);
			expect(plusTwo(two.evt), 'Shift+2 不劫持输入').toBe(true);
			expect(two.preventDefault).not.toHaveBeenCalled();
		}
		expect(fitMindMap, '让位期间不触碰视口').toHaveBeenCalledTimes(1);

		// 画布上 Shift+2：本桩 canvasEl 为 null → 选区不可得 → 回落「适应画布」
		expect(plusTwo(fakeKeyEvent({ tagName: 'svg' }).evt)).toBe(false);
		expect(fitMindMap).toHaveBeenCalledTimes(2);
	});

	it('F2 的注册处理器即 handleEditNodeHotkey（走吞键/让位分支）', () => {
		const { host, view } = makeHost();
		vi.mocked(getActiveNode).mockReturnValue(node);
		registerViewHotkeys(host);
		const handler = find(asScopeStub(view.scope), 'F2', [])
			?.handler as (e: KeyboardEvent) => unknown;
		const mindMap = view.mindMap as MindMap;

		const taken = fakeKeyEvent();
		expect(handler(taken.evt)).toBe(false);
		expect(startNodeTextEdit).toHaveBeenCalledWith(mindMap, node);
		expect(taken.preventDefault).toHaveBeenCalledTimes(1);

		// 输入框内按 F2：让位（返回 true，不阻断、不编辑）
		const yielded = fakeKeyEvent({ tagName: 'INPUT' });
		expect(handler(yielded.evt)).toBe(true);
		expect(yielded.preventDefault).not.toHaveBeenCalled();
		expect(startNodeTextEdit).toHaveBeenCalledTimes(1);
	});

	it('引擎缺失（mindMap 为 null）：注册照常完成，不抛异常', () => {
		const { host, view } = makeHost({ mindMap: null });
		expect(() => registerViewHotkeys(host)).not.toThrow();
		const scope = asScopeStub(view.scope);
		expect(scope.registered).toHaveLength(9);
		// 撤销/重做处理器用可选链兜底：引擎为空时静默（不抛错）
		const handler = find(scope, 'z', ['Mod'])?.handler as (
			e: KeyboardEvent,
		) => unknown;
		expect(() => handler(fakeKeyEvent().evt)).not.toThrow();
	});

	describe('macOS 分支（Platform.isMacOS）', () => {
		// 官方 macOS 未提供 Mod+Y 重做（Cmd+Y 是其他语义）→ 不注册以免冲突
		const original = Platform.isMacOS;

		afterEach(() => {
			(Platform as { isMacOS: boolean }).isMacOS = original;
		});

		it('macOS：不注册 Mod+Y（其余 8 条照常）', () => {
			(Platform as { isMacOS: boolean }).isMacOS = true;
			const { host, view } = makeHost();
			registerViewHotkeys(host);
			const scope = asScopeStub(view.scope);

			expect(find(scope, 'y', ['Mod']), 'macOS 不注册 Mod+Y').toBeUndefined();
			expect(find(scope, 'f', ['Mod'])).toBeDefined();
			// macOS 官方仅 Mod+Shift+Z 一种重做
			expect(find(scope, 'z', ['Mod', 'Shift'])).toBeDefined();
			expect(find(scope, 'F2', [])).toBeDefined();
			expect(scope.registered).toHaveLength(8);
		});

		it('非 macOS：注册 Mod+Y（Windows/Linux 重做）', () => {
			(Platform as { isMacOS: boolean }).isMacOS = false;
			const { host, view } = makeHost();
			registerViewHotkeys(host);
			expect(find(asScopeStub(view.scope), 'y', ['Mod'])).toBeDefined();
		});
	});
});
