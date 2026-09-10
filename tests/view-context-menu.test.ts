/**
 * view-context-menu 回归：节点右键菜单与画布空白菜单的条目分流。
 *
 * 关注点（模块自身的条件分支，非 mock 行为）：
 * - 节点菜单条目随节点数据变化：链接（引擎 hyperlink 与文档双链
 *   mdWikiLinkpath 两条通道都要能「清除链接」）、图片（全屏查看/移除图片、
 *   确有文字才给「移除文本」）；
 * - 表驱动覆盖节点形态矩阵（空白/纯文本/文档链接/外链/双通道/纯图/空白文字图片/
 *   图文混合/根节点），逐形态断言条目的**存在与缺失**以及**出现顺序**；
 * - 右键先激活节点（引擎无 ACTIVE_NODE 命令，节点 active() 是官方激活方式）；
 * - 画布空白菜单的粘贴/适应画布/整理/撤销/重做编排；
 * - 每条目点击后委托给哪个动作、携带什么入参（含引擎命令名）。
 *
 * 断言用 `t(lang, key)` 取真实文案：文案改动（如「移除文本」）必须让测试失败，
 * 手写字符串会让测试与实现悄悄脱钩。
 *
 * Menu 以记录型桩替换（官方 Menu 在 tests/mocks/obsidian.ts 中为空壳，不记录条目）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t, type TranslationKey } from '../src/i18n';
import type { MindMapViewContext } from '../src/features/view-context';
import { setupContextMenu } from '../src/features/view-context-menu';

/** 记录型菜单项桩（仅编译期形状，运行时由 FakeMenu 构造） */
interface MenuItemStub {
	title: string;
	icon: string;
	click: (() => void) | null;
	setTitle(title: string): MenuItemStub;
	setIcon(icon: string): MenuItemStub;
	onClick(cb: () => void): MenuItemStub;
}

const { FakeMenu, ENGINE } = vi.hoisted(() => {
	class FakeMenuClass {
		static instances: FakeMenuClass[] = [];
		items: MenuItemStub[] = [];
		separators = 0;
		shownAt: { x: number; y: number } | null = null;

		constructor() {
			FakeMenuClass.instances.push(this);
		}

		addItem(cb: (item: MenuItemStub) => unknown): this {
			const item: MenuItemStub = {
				title: '',
				icon: '',
				click: null,
				setTitle(title) {
					this.title = title;
					return this;
				},
				setIcon(icon) {
					this.icon = icon;
					return this;
				},
				onClick(cb2) {
					this.click = cb2;
					return this;
				},
			};
			cb(item);
			this.items.push(item);
			return this;
		}

		addSeparator(): this {
			this.separators++;
			return this;
		}

		showAtPosition(pos: { x: number; y: number }): void {
			this.shownAt = pos;
		}

		/** 当前菜单条目标题（按添加顺序） */
		titles(): string[] {
			return this.items.map((entry) => entry.title);
		}

		/** 按标题取条目（不存在则抛错，避免静默通过） */
		item(title: string): MenuItemStub {
			const found = this.items.find((entry) => entry.title === title);
			if (!found) {
				throw new Error(`菜单项不存在：${title}`);
			}
			return found;
		}

		/** 按标题点击条目 */
		click(title: string): void {
			const found = this.item(title);
			if (!found.click) {
				throw new Error(`菜单项不可点击：${title}`);
			}
			found.click();
		}
	}
	// 命令名取值与 src/mindmap.ts 的 ENGINE_COMMANDS 一致；常量表本身的
	// token 契约由 vendor-contract 测试把关，这里只验证菜单传了哪一个命令。
	return {
		FakeMenu: FakeMenuClass,
		ENGINE: {
			BACK: 'BACK',
			FORWARD: 'FORWARD',
			INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
			INSERT_NODE: 'INSERT_NODE',
		},
	};
});

const {
	findNodeByDomMock,
	fitMindMapMock,
	getNodeDataStringMock,
	startNodeTextEditMock,
	clearNodeHyperlinkMock,
	copyNodeMock,
	pasteNodeAsChildMock,
	deleteActiveNodeMock,
	removeNodeImageMock,
	removeNodeTextMock,
	addLinkToActiveNodeMock,
	addImageToActiveNodeMock,
	openNodeImageFullscreenMock,
	arrangeMindMapMock,
} = vi.hoisted(() => ({
	findNodeByDomMock: vi.fn<(mindMap: unknown, el: unknown) => unknown>(),
	fitMindMapMock: vi.fn<(mindMap: unknown) => void>(),
	getNodeDataStringMock: vi.fn<(node: unknown, key: string) => string>(),
	startNodeTextEditMock: vi.fn<(mindMap: unknown, node: unknown) => void>(),
	clearNodeHyperlinkMock: vi.fn<(view: unknown, node: unknown) => void>(),
	copyNodeMock: vi.fn<(view: unknown, node: unknown) => void>(),
	pasteNodeAsChildMock: vi.fn<(view: unknown, node: unknown) => void>(),
	deleteActiveNodeMock: vi.fn<(view: unknown) => void>(),
	removeNodeImageMock: vi.fn<(view: unknown, node: unknown) => void>(),
	removeNodeTextMock: vi.fn<(view: unknown, node: unknown) => void>(),
	addLinkToActiveNodeMock: vi.fn<(view: unknown) => Promise<void>>(),
	addImageToActiveNodeMock: vi.fn<(view: unknown) => Promise<void>>(),
	openNodeImageFullscreenMock: vi.fn<(view: unknown, node: unknown) => void>(),
	arrangeMindMapMock: vi.fn<(view: unknown) => void>(),
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, Menu: FakeMenu };
});

vi.mock('../src/mindmap', () => ({
	ENGINE_COMMANDS: ENGINE,
	findNodeByDom: findNodeByDomMock,
	fitMindMap: fitMindMapMock,
	getNodeDataString: getNodeDataStringMock,
	startNodeTextEdit: startNodeTextEditMock,
}));

vi.mock('../src/features/view-node-actions', () => ({
	addImageToActiveNode: addImageToActiveNodeMock,
	addLinkToActiveNode: addLinkToActiveNodeMock,
	clearNodeHyperlink: clearNodeHyperlinkMock,
	copyNode: copyNodeMock,
	deleteActiveNode: deleteActiveNodeMock,
	pasteNodeAsChild: pasteNodeAsChildMock,
	removeNodeImage: removeNodeImageMock,
	removeNodeText: removeNodeTextMock,
}));

vi.mock('../src/features/view-image-fullscreen', () => ({
	openNodeImageFullscreen: openNodeImageFullscreenMock,
}));

vi.mock('../src/features/view-toolbar', () => ({
	arrangeMindMap: arrangeMindMapMock,
}));

/** 取真实中文文案（key 拼错即编译失败） */
function zh(key: TranslationKey): string {
	return t('zh', key);
}

/** 记录 onEngine/onDom 监听，供按事件名触发；并记录 onDom 的目标元素 */
function makeEngineBinder() {
	const engineListeners = new Map<string, (...args: unknown[]) => void>();
	const domListeners = new Map<string, (event: unknown) => void>();
	const domTargets: unknown[] = [];
	return {
		onEngine(
			_emitter: unknown,
			event: string,
			listener: (...args: unknown[]) => void,
		): void {
			engineListeners.set(event, listener);
		},
		onDom(target: unknown, event: string, listener: (event: unknown) => void): void {
			domListeners.set(event, listener);
			domTargets.push(target);
		},
		fireEngine(event: string, ...args: unknown[]): void {
			engineListeners.get(event)?.(...args);
		},
		fireDom(event: string, payload: unknown): void {
			domListeners.get(event)?.(payload);
		},
		hasEngine(event: string): boolean {
			return engineListeners.has(event);
		},
		hasDom(event: string): boolean {
			return domListeners.has(event);
		},
		domTargets,
	};
}

/** 节点桩：active() 记录激活；getData(key) 取字段 */
function fakeNode(data: Record<string, unknown>) {
	const active = vi.fn<() => void>();
	return {
		active,
		getData: (key?: string) => (key === undefined ? data : data[key]),
	};
}

/**
 * 视图桩：返回原始对象（非只读 cast），便于用例模拟「引擎被重建」时把
 * mindMap 置空——这正是注册后引擎换代时菜单需要防御的场景。
 */
function makeView(options: { canvasEl?: unknown; mindMap?: unknown } = {}) {
	const binder = makeEngineBinder();
	const execCommand = vi.fn<(command: string) => void>();
	const render = vi.fn<() => void>();
	const mindMap =
		options.mindMap === undefined ? { execCommand, render } : options.mindMap;
	const canvasEl = options.canvasEl === undefined ? { tag: 'canvas' } : options.canvasEl;
	const raw = {
		mindMap,
		canvasEl,
		engineEvents: binder,
		lang: 'zh',
	};
	return {
		view: raw as unknown as MindMapViewContext,
		raw,
		binder,
		execCommand,
		render,
		canvasEl,
	};
}

/** 画布右键事件桩：target.closest 返回给定元素 */
function fakeContextMenuEvent(closestResult: unknown) {
	return {
		preventDefault: vi.fn<() => void>(),
		stopPropagation: vi.fn<() => void>(),
		clientX: 120,
		clientY: 240,
		target: { closest: () => closestResult },
	};
}

type MenuInstance = InstanceType<typeof FakeMenu>;

/** 取最近创建的菜单（不存在则抛错，避免断言静默通过） */
function lastMenu(): MenuInstance {
	const menu = FakeMenu.instances.at(-1);
	if (!menu) {
		throw new Error('菜单未创建');
	}
	return menu;
}

/**
 * getNodeDataString 桩复位：与生产实现同语义（读节点 getData 的字段值，
 * 非字符串归一为空串）。若统一 mockReturnValue('')，「清除链接」「移除文本」
 * 等按节点数据分流的分支会永远走空值路径、断言全部失真。
 */
function resetGetNodeDataString(): void {
	getNodeDataStringMock.mockReset().mockImplementation((node, key) => {
		const value = (node as { getData?: (name: string) => unknown }).getData?.(key);
		return typeof value === 'string' ? value : '';
	});
}

beforeEach(() => {
	FakeMenu.instances = [];
	vi.clearAllMocks();
	resetGetNodeDataString();
	addLinkToActiveNodeMock.mockResolvedValue(undefined);
	addImageToActiveNodeMock.mockResolvedValue(undefined);
});

// 静态注册表跨用例共享：每个用例后清空，避免「上次用例的菜单」被 lastMenu 取到。
afterEach(() => {
	FakeMenu.instances = [];
	vi.restoreAllMocks();
});

describe('setupContextMenu（注册）', () => {
	it('缺少画布元素或引擎实例：不注册任何监听', () => {
		const noCanvas = makeView({ canvasEl: null });
		setupContextMenu(noCanvas.view);
		expect(noCanvas.binder.hasEngine('node_contextmenu')).toBe(false);
		expect(noCanvas.binder.hasDom('contextmenu')).toBe(false);

		const noEngine = makeView({ mindMap: null });
		setupContextMenu(noEngine.view);
		expect(noEngine.binder.hasEngine('node_contextmenu')).toBe(false);
		expect(noEngine.binder.hasDom('contextmenu')).toBe(false);
	});

	it('注册引擎 node_contextmenu 与画布委托 contextmenu（画布元素为目标）', () => {
		const { view, binder, canvasEl } = makeView();
		setupContextMenu(view);
		expect(binder.hasEngine('node_contextmenu')).toBe(true);
		expect(binder.hasDom('contextmenu')).toBe(true);
		expect(binder.domTargets).toEqual([canvasEl]);
	});
});

describe('showNodeContextMenu（节点菜单，表驱动形态矩阵）', () => {
	/** 打开节点菜单（右键命中由引擎 node_contextmenu 事件触发） */
	function openNodeMenu(node: unknown) {
		const harness = makeView();
		setupContextMenu(harness.view);
		const event = fakeContextMenuEvent(null);
		harness.binder.fireEngine('node_contextmenu', event, node);
		return { ...harness, menu: lastMenu(), event, node };
	}

	/**
	 * 条目分组：整行顺序在表里逐项手写，避免用「与实现同构的拼装函数」自证。
	 * 文案经 t() 取真值。
	 */
	const G = {
		edit: [zh('menu.editText'), zh('menu.addChild'), zh('menu.addSibling')],
		clip: [zh('menu.copyNode'), zh('menu.pasteAsChild')],
		link: [zh('menu.addLink')],
		clear: [zh('modal.link.clear')],
		imageBtn: [zh('menu.addImage')],
		imageBlock: [zh('menu.viewImageFullscreen'), zh('menu.removeImage')],
		removeText: [zh('menu.removeText')],
		del: [zh('menu.deleteNode')],
	} as const;

	interface FormCase {
		name: string;
		data: Record<string, unknown>;
		/** 期望的完整条目序列（顺序敏感） */
		expected: string[];
		/** 该形态下「清除链接」是否应出现 */
		hasClear: boolean;
		/** 该形态下图片块（全屏查看/移除图片）是否应出现 */
		hasImageBlock: boolean;
		/** 该形态下「移除文本」是否应出现 */
		hasRemoveText: boolean;
		isRoot?: boolean;
	}

	const forms: FormCase[] = [
		{
			name: '空节点（无文本/无链接/无图片）',
			data: {},
			expected: [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.del],
			hasClear: false,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '纯文本节点',
			data: { text: '项目规划' },
			expected: [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.del],
			hasClear: false,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '带文档链接（mdWikiLinkpath 通道）',
			data: { text: '笔记', mdWikiLinkpath: '[[笔记]]', mdLinkStyle: 'wiki' },
			expected: [...G.edit, ...G.clip, ...G.link, ...G.clear, ...G.imageBtn, ...G.del],
			hasClear: true,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '带外链（引擎 hyperlink 通道）',
			data: { text: '示例', hyperlink: 'https://example.com' },
			expected: [...G.edit, ...G.clip, ...G.link, ...G.clear, ...G.imageBtn, ...G.del],
			hasClear: true,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '双通道同时存在（清除链接只给一条）',
			data: {
				mdWikiLinkpath: '[[笔记]]',
				hyperlink: 'https://example.com',
			},
			expected: [...G.edit, ...G.clip, ...G.link, ...G.clear, ...G.imageBtn, ...G.del],
			hasClear: true,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '纯图片节点（文本为空 → 图片独占）',
			data: { text: '', image: 'app://local/x.png' },
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.imageBtn,
				...G.imageBlock,
				...G.del,
			],
			hasClear: false,
			hasImageBlock: true,
			hasRemoveText: false,
		},
		{
			name: '图片 + 空白文字（trim 后为空 → 仍不给移除文本）',
			data: { text: '   ', image: 'app://local/x.png' },
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.imageBtn,
				...G.imageBlock,
				...G.del,
			],
			hasClear: false,
			hasImageBlock: true,
			hasRemoveText: false,
		},
		{
			name: '图文混合（图片 + 非空文字 → 多出移除文本）',
			data: { text: '封面图', image: 'app://local/x.png' },
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.imageBtn,
				...G.imageBlock,
				...G.removeText,
				...G.del,
			],
			hasClear: false,
			hasImageBlock: true,
			hasRemoveText: true,
		},
		{
			name: '图片 + 链接 + 文字（链接与图片块并存）',
			data: {
				text: '封面图',
				image: 'app://local/x.png',
				hyperlink: 'https://example.com',
			},
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.clear,
				...G.imageBtn,
				...G.imageBlock,
				...G.removeText,
				...G.del,
			],
			hasClear: true,
			hasImageBlock: true,
			hasRemoveText: true,
		},
		{
			name: '根节点（中心主题）：条目与普通节点相同',
			data: { text: '中心主题' },
			expected: [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.del],
			hasClear: false,
			hasImageBlock: false,
			hasRemoveText: false,
			isRoot: true,
		},
	];

	it.each(forms)(
		'$name：条目序列与存在/缺失',
		(form: FormCase) => {
			const node = { ...fakeNode(form.data), isRoot: form.isRoot ?? false };
			const { menu } = openNodeMenu(node);
			const titles = menu.titles();

			// 顺序 + 精确集合：多出/缺少/错序的条目都会失败
			expect(titles).toEqual(form.expected);

			// 存在与否显式断言（形态矩阵的可读表达）
			if (form.hasClear) {
				expect(titles).toContain(zh('modal.link.clear'));
			} else {
				expect(titles).not.toContain(zh('modal.link.clear'));
			}
			if (form.hasImageBlock) {
				expect(titles).toContain(zh('menu.viewImageFullscreen'));
				expect(titles).toContain(zh('menu.removeImage'));
			} else {
				expect(titles).not.toContain(zh('menu.viewImageFullscreen'));
				expect(titles).not.toContain(zh('menu.removeImage'));
			}
			if (form.hasRemoveText) {
				expect(titles).toContain(zh('menu.removeText'));
			} else {
				expect(titles).not.toContain(zh('menu.removeText'));
			}
			// 基础条目恒在
			for (const title of [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.del]) {
				expect(titles).toContain(title);
			}
		},
	);

	it('双通道节点：分离器恒为 4 条（链接/图片块只增条目、不改分组）', () => {
		const { menu } = openNodeMenu(
			fakeNode({ mdWikiLinkpath: '[[笔记]]', image: 'app://x.png', text: '图' }),
		);
		expect(menu.separators).toBe(4);
	});

	it('右键先激活节点（引擎无 ACTIVE_NODE 命令），并按指针坐标定位菜单', () => {
		const node = fakeNode({});
		const { menu, event } = openNodeMenu(node);
		expect(node.active).toHaveBeenCalledTimes(1);
		expect(menu.shownAt).toEqual({ x: 120, y: 240 });
		// 引擎已对节点 contextmenu 做 stopPropagation，本模块不重复干预默认行为
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('菜单图标分流：链接/清除链接/图片/移除文本各有专有图标', () => {
		const { menu } = openNodeMenu(
			fakeNode({ hyperlink: 'https://e.com', image: 'app://x.png', text: '图' }),
		);
		expect(menu.item(zh('menu.editText')).icon).toBe('pencil');
		expect(menu.item(zh('menu.addChild')).icon).toBe('plus');
		expect(menu.item(zh('menu.addSibling')).icon).toBe('circle-plus');
		expect(menu.item(zh('menu.copyNode')).icon).toBe('copy');
		expect(menu.item(zh('menu.pasteAsChild')).icon).toBe('clipboard');
		expect(menu.item(zh('menu.addLink')).icon).toBe('link');
		expect(menu.item(zh('modal.link.clear')).icon).toBe('unlink');
		expect(menu.item(zh('menu.addImage')).icon).toBe('image');
		expect(menu.item(zh('menu.viewImageFullscreen')).icon).toBe('maximize');
		expect(menu.item(zh('menu.removeImage')).icon).toBe('image');
		expect(menu.item(zh('menu.removeText')).icon).toBe('eraser');
		expect(menu.item(zh('menu.deleteNode')).icon).toBe('trash-2');
	});

	it('编辑文本：委托 startNodeTextEdit(引擎, 节点)', () => {
		const node = fakeNode({ text: '主题' });
		const { menu, view, execCommand } = openNodeMenu(node);
		menu.click(zh('menu.editText'));
		expect(startNodeTextEditMock).toHaveBeenCalledTimes(1);
		expect(startNodeTextEditMock).toHaveBeenCalledWith(view.mindMap, node);
		// 引擎无 ENTER_TEXT_EDIT 命令：文本编辑只能经官方 node_dblclick 事件进入
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('添加子/同级节点：直接发引擎命令，不带额外参数', () => {
		const { menu, execCommand } = openNodeMenu(fakeNode({}));
		menu.click(zh('menu.addChild'));
		expect(execCommand).toHaveBeenCalledWith(ENGINE.INSERT_CHILD_NODE);
		menu.click(zh('menu.addSibling'));
		expect(execCommand).toHaveBeenCalledWith(ENGINE.INSERT_NODE);
		expect(execCommand).toHaveBeenCalledTimes(2);
	});

	it('复制/粘贴为子节点/删除：委托 view-node-actions 并携带节点', () => {
		const node = fakeNode({});
		const { menu, view } = openNodeMenu(node);
		menu.click(zh('menu.copyNode'));
		expect(copyNodeMock).toHaveBeenCalledWith(view, node);
		menu.click(zh('menu.pasteAsChild'));
		expect(pasteNodeAsChildMock).toHaveBeenCalledWith(view, node);
		menu.click(zh('menu.deleteNode'));
		expect(deleteActiveNodeMock).toHaveBeenCalledWith(view);
	});

	it('根节点的删除条目照常给出：拒绝逻辑在 deleteActiveNode 内部（本层不预判）', () => {
		const node = { ...fakeNode({ text: '中心主题' }), isRoot: true };
		const { menu, view } = openNodeMenu(node);
		expect(menu.titles()).toContain(zh('menu.deleteNode'));
		menu.click(zh('menu.deleteNode'));
		expect(deleteActiveNodeMock).toHaveBeenCalledWith(view);
	});

	it('清除链接：委托 clearNodeHyperlink(视图, 节点)', () => {
		const node = fakeNode({ hyperlink: 'https://example.com' });
		const { menu, view, execCommand } = openNodeMenu(node);
		menu.click(zh('modal.link.clear'));
		expect(clearNodeHyperlinkMock).toHaveBeenCalledWith(view, node);
		// 通道清理由 view-node-actions 负责（本层不直发引擎命令）
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('添加链接/添加图片：委托异步动作（浮动 Promise 由动作自身兜错）', () => {
		const { menu, view } = openNodeMenu(fakeNode({}));
		menu.click(zh('menu.addLink'));
		menu.click(zh('menu.addImage'));
		expect(addLinkToActiveNodeMock).toHaveBeenCalledWith(view);
		expect(addImageToActiveNodeMock).toHaveBeenCalledWith(view);
	});

	it('图片块：全屏查看/移除图片/移除文本分别委托对应动作', () => {
		const node = fakeNode({ text: '封面图', image: 'app://local/x.png' });
		const { menu, view } = openNodeMenu(node);
		menu.click(zh('menu.viewImageFullscreen'));
		expect(openNodeImageFullscreenMock).toHaveBeenCalledWith(view, node);
		menu.click(zh('menu.removeImage'));
		expect(removeNodeImageMock).toHaveBeenCalledWith(view, node);
		menu.click(zh('menu.removeText'));
		expect(removeNodeTextMock).toHaveBeenCalledWith(view, node);
	});

	it('node_contextmenu 未带节点：不弹菜单', () => {
		const { binder, view } = makeView();
		setupContextMenu(view);
		binder.fireEngine('node_contextmenu', fakeContextMenuEvent(null), undefined);
		expect(FakeMenu.instances).toHaveLength(0);
	});

	it('注册后引擎被重建（mindMap 置空）：node_contextmenu 不弹菜单', () => {
		const { binder, view, raw } = makeView();
		setupContextMenu(view);
		raw.mindMap = null;
		binder.fireEngine('node_contextmenu', fakeContextMenuEvent(null), fakeNode({}));
		expect(FakeMenu.instances).toHaveLength(0);
	});
});

describe('画布空白右键菜单', () => {
	/** 触发画布 contextmenu（closest 结果决定是否命中节点） */
	function fireCanvas(closestResult: unknown) {
		const harness = makeView();
		setupContextMenu(harness.view);
		const event = fakeContextMenuEvent(closestResult);
		harness.binder.fireDom('contextmenu', event);
		return { ...harness, event };
	}

	it('未命中节点：画布菜单条目与顺序（粘贴/适应画布/整理/撤销/重做）', () => {
		const { event } = fireCanvas(null);
		const menu = lastMenu();
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(menu.titles()).toEqual([
			zh('menu.pasteNode'),
			zh('command.fitCanvas'),
			zh('toolbar.arrange'),
			zh('toolbar.undoShort'),
			zh('toolbar.redoShort'),
		]);
		expect(menu.separators).toBe(1);
		expect(menu.shownAt).toEqual({ x: 120, y: 240 });
		expect(menu.item(zh('menu.pasteNode')).icon).toBe('clipboard');
		expect(menu.item(zh('command.fitCanvas')).icon).toBe('maximize');
		expect(menu.item(zh('toolbar.arrange')).icon).toBe('sparkles');
		expect(menu.item(zh('toolbar.undoShort')).icon).toBe('undo');
		expect(menu.item(zh('toolbar.redoShort')).icon).toBe('redo');
	});

	it('画布菜单点击：粘贴挂到根（node=null）、适应画布/整理/撤销/重做各就各位', () => {
		const { view, execCommand } = fireCanvas(null);
		const menu = lastMenu();

		menu.click(zh('menu.pasteNode'));
		expect(pasteNodeAsChildMock).toHaveBeenCalledWith(view, null);

		menu.click(zh('command.fitCanvas'));
		expect(fitMindMapMock).toHaveBeenCalledWith(view.mindMap);

		menu.click(zh('toolbar.arrange'));
		expect(arrangeMindMapMock).toHaveBeenCalledWith(view);

		menu.click(zh('toolbar.undoShort'));
		expect(execCommand).toHaveBeenCalledWith(ENGINE.BACK);

		menu.click(zh('toolbar.redoShort'));
		expect(execCommand).toHaveBeenCalledWith(ENGINE.FORWARD);
		expect(execCommand).toHaveBeenCalledTimes(2);
	});

	it('命中节点元素：改走节点菜单（避免双菜单或菜单丢失），仍阻止默认菜单', () => {
		const node = fakeNode({ text: '主题' });
		findNodeByDomMock.mockReturnValue(node);
		const nodeEl = { tag: 'node' };
		const { view, event, binder } = fireCanvas(nodeEl);

		expect(findNodeByDomMock).toHaveBeenCalledWith(view.mindMap, nodeEl);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		// 画布委托路径统一走节点菜单：条目与 node_contextmenu 一致
		expect(node.active).toHaveBeenCalledTimes(1);
		const menu = lastMenu();
		expect(menu.titles()).toContain(zh('menu.editText'));
		expect(menu.titles()).not.toContain(zh('menu.pasteNode'));
		expect(binder.hasEngine('node_contextmenu')).toBe(true);
	});

	it('命中节点元素但 findNodeByDom 未解析出节点：退回画布菜单', () => {
		findNodeByDomMock.mockReturnValue(null);
		fireCanvas({ tag: 'node' });
		const menu = lastMenu();
		expect(findNodeByDomMock).toHaveBeenCalledTimes(1);
		expect(menu.titles()).toContain(zh('menu.pasteNode'));
		expect(menu.titles()).not.toContain(zh('menu.editText'));
	});

	it('画布菜单在引擎缺失时仍弹出（撤销/重做经可选链静默失效）', () => {
		const harness = makeView();
		setupContextMenu(harness.view);
		harness.raw.mindMap = null;
		harness.binder.fireDom('contextmenu', fakeContextMenuEvent(null));
		const menu = lastMenu();
		expect(menu.titles()).toContain(zh('menu.pasteNode'));
		expect(() => menu.click(zh('toolbar.undoShort'))).not.toThrow();
		expect(harness.execCommand).not.toHaveBeenCalled();
	});
});
