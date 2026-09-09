/**
 * view-context-menu 回归：节点右键菜单与画布空白菜单的条目分流。
 *
 * 关注点（模块自身的条件分支，非 mock 行为）：
 * - 节点菜单条目随节点数据变化：链接（hyperlink 与文档双链 mdWikiLinkpath
 *   两条通道都要能清除）、图片（查看/移除图片、有文字才给「移除文字」）；
 * - 右键先激活节点（引擎无 ACTIVE_NODE 命令，节点 active() 是官方激活方式）；
 * - 画布空白菜单的撤销/重做/整理/粘贴编排；
 * - 菜单动作委托给 view-node-actions（本测试只验证委托与参数）。
 *
 * Menu 以记录型桩替换（官方 Menu 在 tests/mocks/obsidian.ts 中为空壳）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/i18n';
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

/**
 * 记录型 Menu 桩（模块内部 new Menu()，经静态注册表取回）。
 * 必须在 vi.hoisted 内定义——vi.mock 工厂被提升到文件顶部，
 * 引用普通顶层变量会触发「Cannot access before initialization」。
 */
const { FakeMenu } = vi.hoisted(() => {
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
			return this.items.map((item) => item.title);
		}

		/** 按标题点击条目（不存在则抛错，避免静默通过） */
		click(title: string): void {
			const item = this.items.find((entry) => entry.title === title);
			if (!item?.click) {
				throw new Error(`菜单项不存在或不可点击：${title}`);
			}
			item.click();
		}
	}
	return { FakeMenu: FakeMenuClass };
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
	ENGINE_COMMANDS: {
		BACK: 'BACK',
		FORWARD: 'FORWARD',
		INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
		INSERT_NODE: 'INSERT_NODE',
	},
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

/** 记录 onEngine/onDom 监听，供按事件名触发 */
function makeEngineBinder() {
	const engineListeners = new Map<string, (...args: unknown[]) => void>();
	const domListeners = new Map<string, (event: unknown) => void>();
	return {
		onEngine(
			_emitter: unknown,
			event: string,
			listener: (...args: unknown[]) => void,
		): void {
			engineListeners.set(event, listener);
		},
		onDom(_target: unknown, event: string, listener: (event: unknown) => void): void {
			domListeners.set(event, listener);
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

function makeView(options: { canvasEl?: unknown; mindMap?: unknown } = {}) {
	const binder = makeEngineBinder();
	const execCommand = vi.fn();
	const mindMap = options.mindMap === undefined ? { execCommand } : options.mindMap;
	const canvasEl = options.canvasEl === undefined ? {} : options.canvasEl;
	const view = {
		mindMap,
		canvasEl,
		engineEvents: binder,
		lang: 'zh',
	} as unknown as MindMapViewContext;
	return { view, binder, execCommand };
}

/** 画布右键事件桩：target.closest 返回给定元素 */
function fakeContextMenuEvent(closestResult: unknown) {
	return {
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
		clientX: 120,
		clientY: 240,
		target: { closest: () => closestResult },
	};
}

/** 取最近创建的菜单（不存在则抛错，避免断言静默通过） */
function lastMenu(): InstanceType<typeof FakeMenu> {
	const menu = FakeMenu.instances.at(-1);
	if (!menu) {
		throw new Error('菜单未创建');
	}
	return menu;
}

describe('setupContextMenu（注册）', () => {
	beforeEach(() => {
		FakeMenu.instances = [];
		resetGetNodeDataString();
	});

	it('缺少画布元素或引擎实例：不注册监听', () => {
		const noCanvas = makeView({ canvasEl: null });
		setupContextMenu(noCanvas.view);
		expect(noCanvas.binder.hasEngine('node_contextmenu')).toBe(false);

		const noEngine = makeView({ mindMap: null });
		setupContextMenu(noEngine.view);
		expect(noEngine.binder.hasEngine('node_contextmenu')).toBe(false);
	});

	it('注册引擎 node_contextmenu 与画布 contextmenu', () => {
		const { view, binder } = makeView();
		setupContextMenu(view);
		expect(binder.hasEngine('node_contextmenu')).toBe(true);
		expect(binder.hasDom('contextmenu')).toBe(true);
	});
});

/**
 * getNodeDataString 桩复位：与生产实现同语义（读节点 getData 的字符串值，
 * 非字符串归一为空串）。各 describe 共用——若统一 mockReturnValue('')，
 * 「清除链接/图片」等按节点数据分流的分支会永远走空值路径。
 */
function resetGetNodeDataString(): void {
	getNodeDataStringMock.mockReset().mockImplementation((node, key) => {
		const value = (node as { getData?: (name: string) => unknown }).getData?.(
			key,
		);
		return typeof value === 'string' ? value : '';
	});
}

describe('节点右键菜单（条目随节点数据分流）', () => {
	beforeEach(() => {
		FakeMenu.instances = [];
		vi.clearAllMocks();
		resetGetNodeDataString();
	});

	/** 打开节点菜单并返回记录（node 数据由用例给定） */
	function openNodeMenu(node: unknown) {
		const { view, binder, execCommand } = makeView();
		setupContextMenu(view);
		const event = fakeContextMenuEvent(null);
		binder.fireEngine('node_contextmenu', event, node);
		return { menu: lastMenu(), view, execCommand, event };
	}

	it('无链接无图片节点：只有基础编辑/复制粘贴/删除条目，且先激活节点', () => {
		const node = fakeNode({});
		const { menu, event } = openNodeMenu(node);
		expect(menu.titles()).toEqual([
			t('zh', 'menu.editText'),
			t('zh', 'menu.addChild'),
			t('zh', 'menu.addSibling'),
			t('zh', 'menu.copyNode'),
			t('zh', 'menu.pasteAsChild'),
			t('zh', 'menu.addLink'),
			t('zh', 'menu.addImage'),
			t('zh', 'menu.deleteNode'),
		]);
		expect(menu.separators).toBe(4);
		// 引擎无 ACTIVE_NODE 命令：右键须先经节点 active() 激活
		expect(node.active).toHaveBeenCalledTimes(1);
		expect(menu.shownAt).toEqual({ x: 120, y: 240 });
		expect(event.preventDefault).not.toHaveBeenCalled(); // 引擎已 stopPropagation
	});

	it('已有 hyperlink：提供「清除链接」并委托 clearNodeHyperlink', () => {
		const node = fakeNode({ hyperlink: 'https://example.com' });
		const { menu, view } = openNodeMenu(node);
		expect(menu.titles()).toContain(t('zh', 'modal.link.clear'));
		menu.click(t('zh', 'modal.link.clear'));
		expect(clearNodeHyperlinkMock).toHaveBeenCalledWith(view, node);
	});

	it('文档双链（mdWikiLinkpath 通道）：同样提供「清除链接」', () => {
		const node = fakeNode({ mdWikiLinkpath: '[[笔记]]' });
		const { menu } = openNodeMenu(node);
		expect(menu.titles()).toContain(t('zh', 'modal.link.clear'));
	});

	it('图片节点含文字：提供查看/移除图片与移除文字', () => {
		const node = fakeNode({ image: 'app://local/x.png' });
		getNodeDataStringMock.mockReturnValue('标题文字');
		const { menu, view } = openNodeMenu(node);
		expect(menu.titles()).toEqual(
			expect.arrayContaining([
				t('zh', 'menu.viewImageFullscreen'),
				t('zh', 'menu.removeImage'),
				t('zh', 'menu.removeText'),
			]),
		);
		menu.click(t('zh', 'menu.removeImage'));
		expect(removeNodeImageMock).toHaveBeenCalledWith(view, node);
		menu.click(t('zh', 'menu.removeText'));
		expect(removeNodeTextMock).toHaveBeenCalledWith(view, node);
	});

	it('图片独占节点（无文字）：不给「移除文字」', () => {
		const node = fakeNode({ image: 'app://local/x.png' });
		getNodeDataStringMock.mockReturnValue('   ');
		const { menu } = openNodeMenu(node);
		expect(menu.titles()).toContain(t('zh', 'menu.removeImage'));
		expect(menu.titles()).not.toContain(t('zh', 'menu.removeText'));
	});

	it('编辑文本/增子/增同级：分别委托 startNodeTextEdit 与引擎命令', () => {
		const node = fakeNode({});
		const { menu, execCommand, view } = openNodeMenu(node);
		menu.click(t('zh', 'menu.editText'));
		expect(startNodeTextEditMock).toHaveBeenCalledWith(view.mindMap, node);
		menu.click(t('zh', 'menu.addChild'));
		expect(execCommand).toHaveBeenCalledWith('INSERT_CHILD_NODE');
		menu.click(t('zh', 'menu.addSibling'));
		expect(execCommand).toHaveBeenCalledWith('INSERT_NODE');
	});

	it('复制/粘贴/删除：委托 view-node-actions 并携带节点', () => {
		const node = fakeNode({});
		const { menu, view } = openNodeMenu(node);
		menu.click(t('zh', 'menu.copyNode'));
		expect(copyNodeMock).toHaveBeenCalledWith(view, node);
		menu.click(t('zh', 'menu.pasteAsChild'));
		expect(pasteNodeAsChildMock).toHaveBeenCalledWith(view, node);
		menu.click(t('zh', 'menu.deleteNode'));
		expect(deleteActiveNodeMock).toHaveBeenCalledWith(view);
	});

	it('添加链接/添加图片：委托异步动作（浮动 Promise 由动作自身兜错）', () => {
		const node = fakeNode({});
		const { menu, view } = openNodeMenu(node);
		addLinkToActiveNodeMock.mockResolvedValue(undefined);
		addImageToActiveNodeMock.mockResolvedValue(undefined);
		menu.click(t('zh', 'menu.addLink'));
		menu.click(t('zh', 'menu.addImage'));
		expect(addLinkToActiveNodeMock).toHaveBeenCalledWith(view);
		expect(addImageToActiveNodeMock).toHaveBeenCalledWith(view);
	});

	it('引擎实例缺失时 node_contextmenu 不弹菜单', () => {
		const { view, binder } = makeView({ mindMap: null });
		// canvasEl 存在但 mindMap 为 null：setupContextMenu 直接返回，无监听可触发
		setupContextMenu(view);
		binder.fireEngine('node_contextmenu', fakeContextMenuEvent(null), fakeNode({}));
		expect(FakeMenu.instances).toHaveLength(0);
	});
});

describe('画布空白右键菜单', () => {
	beforeEach(() => {
		FakeMenu.instances = [];
		vi.clearAllMocks();
		resetGetNodeDataString();
	});

	it('未命中节点：画布菜单（粘贴/整理/撤销/重做）并阻止默认菜单', () => {
		const { view, binder, execCommand } = makeView();
		setupContextMenu(view);
		const event = fakeContextMenuEvent(null);
		binder.fireDom('contextmenu', event);
		const menu = lastMenu();
		expect(event.preventDefault).toHaveBeenCalled();
		expect(menu.titles()).toEqual([
			t('zh', 'menu.pasteNode'),
			t('zh', 'command.fitCanvas'),
			t('zh', 'toolbar.arrange'),
			t('zh', 'toolbar.undoShort'),
			t('zh', 'toolbar.redoShort'),
		]);
		menu.click(t('zh', 'menu.pasteNode'));
		expect(pasteNodeAsChildMock).toHaveBeenCalledWith(view, null);
		menu.click(t('zh', 'toolbar.arrange'));
		expect(arrangeMindMapMock).toHaveBeenCalledWith(view);
		menu.click(t('zh', 'toolbar.undoShort'));
		expect(execCommand).toHaveBeenCalledWith('BACK');
		menu.click(t('zh', 'toolbar.redoShort'));
		expect(execCommand).toHaveBeenCalledWith('FORWARD');
	});

	it('命中节点元素：走节点菜单（避免双菜单或菜单丢失）', () => {
		const node = fakeNode({});
		findNodeByDomMock.mockReturnValue(node);
		const { view, binder } = makeView();
		setupContextMenu(view);
		const nodeEl = {};
		binder.fireDom('contextmenu', fakeContextMenuEvent(nodeEl));
		const menu = lastMenu();
		expect(findNodeByDomMock).toHaveBeenCalledWith(view.mindMap, nodeEl);
		expect(menu.titles()).toContain(t('zh', 'menu.editText'));
		expect(menu.titles()).not.toContain(t('zh', 'menu.pasteNode'));
	});

	it('命中节点元素但 findNodeByDom 未解析出节点：退回画布菜单', () => {
		findNodeByDomMock.mockReturnValue(null);
		const { view, binder } = makeView();
		setupContextMenu(view);
		binder.fireDom('contextmenu', fakeContextMenuEvent({}));
		expect(lastMenu().titles()).toContain(t('zh', 'menu.pasteNode'));
	});
});
