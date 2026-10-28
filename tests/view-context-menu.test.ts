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
 * - 画布空白菜单的粘贴/重置缩放/适应画布/整理/撤销/重做编排；
 * - 每条目点击后委托给哪个动作、携带什么入参（含引擎命令名）。
 *
 * 断言用 `t(lang, key)` 取真实文案：文案改动（如「移除文本」）必须让测试失败，
 * 手写字符串会让测试与实现悄悄脱钩。
 *
 * Menu 以记录型桩替换（官方 Menu 在 tests/mocks/obsidian.ts 中为空壳，不记录条目）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t, type TranslationKey } from '../src/core/i18n';
import { LAYOUT_OPTIONS, PALETTE_OPTIONS } from '../src/core/constants';
import type { MindMapNode } from '../src/core/engine-types';
import type { MindMapViewContext } from '../src/features/view-context';
import { setupContextMenu } from '../src/features/view-context-menu';
import { applyNodeColor, nodeColorOptions } from '../src/features/view-node-color';

/** 记录型菜单项桩（仅编译期形状，运行时由 FakeMenu 构造） */
interface MenuItemStub {
	title: string;
	icon: string;
	/** onClick 回调（级联菜单靠它拿事件坐标） */
	click: ((evt?: MouseEvent) => void) | null;
	/** 勾选态（外观选项用 setChecked 表达「当前生效值」） */
	checked: boolean | null;
	isLabel: boolean;
	/** 原生级联：运行时 `setSubmenu()` 返回的子菜单（未启用该能力时无此方法） */
	nativeSubmenu?: unknown;
	setTitle(title: string): MenuItemStub;
	setIcon(icon: string): MenuItemStub;
	setChecked(checked: boolean | null): MenuItemStub;
	setIsLabel(isLabel: boolean): MenuItemStub;
	onClick(cb: (evt?: MouseEvent) => void): MenuItemStub;
	setSubmenu?: () => unknown;
}

const { FakeMenu, ENGINE } = vi.hoisted(() => {
	class FakeMenuClass {
		static instances: FakeMenuClass[] = [];
		/** 是否模拟「宿主运行时提供了 MenuItem.setSubmenu」（默认关闭＝走回退路径） */
		static supportSubmenu = false;
		items: MenuItemStub[] = [];
		separators = 0;
		shownAt: { x: number; y: number } | null = null;
		/** 级联菜单：父项点击后子菜单在此记录弹出所用的事件 */
		shownAtMouseEvent: MouseEvent | null = null;
		/** 全局单调序号：区分「创建顺序」与「弹出顺序」（级联菜单两者不同） */
		static seq = 0;
		readonly seq = ++FakeMenuClass.seq;
		/** 弹出序号（0＝从未弹出）；取最近弹出的菜单按它排序 */
		shownSeq = 0;

		constructor() {
			FakeMenuClass.instances.push(this);
		}

		addItem(cb: (item: MenuItemStub) => unknown): this {
			const item: MenuItemStub = {
				title: '',
				icon: '',
				click: null,
				checked: null,
				isLabel: false,
				setTitle(title) {
					this.title = title;
					return this;
				},
				setIcon(icon) {
					this.icon = icon;
					return this;
				},
				setChecked(checked) {
					this.checked = checked;
					return this;
				},
				setIsLabel(isLabel) {
					this.isLabel = isLabel;
					return this;
				},
				onClick(cb2) {
					this.click = cb2;
					return this;
				},
				// 与宿主同语义：**无参**调用、内部新建菜单并返回（不是 setter）
				setSubmenu: FakeMenuClass.supportSubmenu
					? function (this: MenuItemStub) {
							const created = new FakeMenuClass();
							this.nativeSubmenu = created;
							return created;
						}
					: undefined,
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

		/** 级联菜单的官方入口：把子菜单弹在触发事件的光标处 */
		showAtMouseEvent(evt: MouseEvent): this {
			this.shownAtMouseEvent = evt;
			this.shownSeq = ++FakeMenuClass.seq;
			return this;
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

		/** 按标题点击条目（级联菜单的父项会用到事件坐标） */
		click(title: string, evt?: MouseEvent): void {
			const found = this.item(title);
			if (!found.click) {
				throw new Error(`菜单项不可点击：${title}`);
			}
			found.click(evt);
		}
	}
	// 命令名取值与 src/engine/mindmap.ts 的 ENGINE_COMMANDS 一致；常量表本身的
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
	resetZoomMock,
	getNodeDataStringMock,
	startNodeTextEditMock,
	editNodeTextMock,
	editNodeTextInModalMock,
	clearNodeHyperlinkMock,
	copySelectedNodesMock,
	pasteClipboardIntoNodeMock,
	deleteActiveNodeMock,
	moveNodeUpMock,
	moveNodeDownMock,
	removeNodeImageMock,
	removeNodeTextMock,
	addLinkToActiveNodeMock,
	addImageToActiveNodeMock,
	openNodeImageFullscreenMock,
	arrangeMindMapMock,
	applyRawNodeContentMock,
	openColorInputModalMock,
	getActiveNodesMock,
} = vi.hoisted(() => ({
	applyRawNodeContentMock:
		vi.fn<(view: unknown, node: unknown, raw: string) => void>(),
	openColorInputModalMock:
		vi.fn<(app: unknown, lang: string, current: string | null) => Promise<string | null>>(),
	getActiveNodesMock: vi.fn<() => unknown[]>(() => []),
	findNodeByDomMock: vi.fn<(mindMap: unknown, el: unknown) => unknown>(),
	fitMindMapMock: vi.fn<(mindMap: unknown) => void>(),
	resetZoomMock: vi.fn<(mindMap: unknown) => void>(),
	getNodeDataStringMock: vi.fn<(node: unknown, key: string) => string>(),
	startNodeTextEditMock: vi.fn<(mindMap: unknown, node: unknown) => void>(),
	editNodeTextMock: vi.fn<(view: unknown, node: unknown) => void>(),
	editNodeTextInModalMock: vi.fn<(view: unknown, node: unknown) => void>(),
	clearNodeHyperlinkMock: vi.fn<(view: unknown, node: unknown) => void>(),
	copySelectedNodesMock: vi.fn<(view: unknown) => void>(),
	pasteClipboardIntoNodeMock: vi.fn<(view: unknown, node: unknown) => void>(),
	deleteActiveNodeMock: vi.fn<(view: unknown) => void>(),
	moveNodeUpMock: vi.fn<(view: unknown, node: unknown) => void>(),
	moveNodeDownMock: vi.fn<(view: unknown, node: unknown) => void>(),
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

vi.mock('../src/engine/mindmap', () => ({
	ENGINE_COMMANDS: ENGINE,
	findNodeByDom: findNodeByDomMock,
	fitMindMap: fitMindMapMock,
	// 大图 fit 的计数入口（fitToScreen 经此判断是否提示+让帧）：0 节点 ⇒ 同步 fit
	countMindMapNodes: (): number => 0,
	resetZoom: resetZoomMock,
	getNodeDataString: getNodeDataStringMock,
	// 外观「连线」二级菜单按布局现算选项集（三态布局为真，其余固定直线）
	supportsLineStyleSwitch: (layout: string): boolean =>
		layout === 'logicalStructure' ||
		layout === 'mindMap' ||
		layout === 'organizationStructure',
	startNodeTextEdit: startNodeTextEditMock,
	// 节点配色：色值来源与选中集合（真实实现见 engine/mindmap-theme 与 -nodes）
	paletteNodeColor: (palette: string): string =>
		({
			default: '#4a90d9',
			mint: '#2e9e8f',
			amber: '#c2761a',
			wisteria: '#7c5cd6',
			forest: '#2f7d5a',
			slate: '#475569',
		})[palette] ?? '#000000',
	getActiveNodes: getActiveNodesMock,
	// 最上层判定由 color-directive.test.ts 直测真实实现；这里只需恒等
	topMostNodes: (nodes: unknown[]): unknown[] => nodes,
}));

// 节点配色落盘走「原文提交」通道（node-inline-editor）：本文件只验证「写了什么原文」
vi.mock('../src/features/node-inline-editor', () => ({
	applyRawNodeContent: applyRawNodeContentMock,
}));

vi.mock('../src/ui/modal-color', () => ({
	openColorInputModal: openColorInputModalMock,
}));

vi.mock('../src/features/view-node-actions', () => ({
	addImageToActiveNode: addImageToActiveNodeMock,
	addLinkToActiveNode: addLinkToActiveNodeMock,
	clearNodeHyperlink: clearNodeHyperlinkMock,
	deleteActiveNode: deleteActiveNodeMock,
	// 编辑文本的共用入口（默认节点走引擎编辑框、自绘节点走插件内联编辑器）
	editNodeText: editNodeTextMock,
	// 弹窗编辑的备选入口（右键「在弹窗中编辑」）
	editNodeTextInModal: editNodeTextInModalMock,
	// 兄弟间上/下移（根节点/首尾拒绝与提示收口在动作内部，本层只验证委托入参）
	moveNodeUp: moveNodeUpMock,
	moveNodeDown: moveNodeDownMock,
	removeNodeImage: removeNodeImageMock,
	removeNodeText: removeNodeTextMock,
}));

// 剪贴板三入口（复制节点 / 粘贴为子节点 / 粘贴节点）已收口到 view-clipboard：
// 本文件只验证「菜单点了哪一个入口、带了什么落点」，剪贴板内部行为由
// tests/view-clipboard.test.ts 覆盖
vi.mock('../src/features/view-clipboard', () => ({
	copySelectedNodes: copySelectedNodesMock,
	pasteClipboardIntoNode: pasteClipboardIntoNodeMock,
}));

vi.mock('../src/features/view-image-fullscreen', () => ({
	openNodeImageFullscreen: openNodeImageFullscreenMock,
}));

vi.mock('../src/features/view-toolbar', () => ({
	arrangeMindMap: arrangeMindMapMock,
}));

// 小地图：节点配色改完必须走「立即画」通道（否则缩略图要等 30s 节拍）
const minimapMocks = vi.hoisted(() => ({
	refreshMiniMapAfterRender: vi.fn<(view: unknown) => void>(),
}));

vi.mock('../src/features/view-minimap', () => ({
	refreshMiniMapAfterRender: minimapMocks.refreshMiniMapAfterRender,
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
	// 外观四项：屏上已无下拉，菜单勾选态由 resolvePreference 现算、变更走 apply*
	// 布局是异步的（写文件属性）且**必须返回 Promise**——菜单侧对它挂 `.catch` 兜拒绝
	const applyLayout = vi
		.fn<(value: string) => Promise<void>>()
		.mockImplementation(() => Promise.resolve());
	const applyLineStyle = vi.fn<(value: string) => void>();
	const applyPalette = vi.fn<(value: string) => void>();
	const applyThemeStyle = vi.fn<(value: string) => void>();
	// 按文件偏好的当前值（菜单勾选态经 resolvePreference 读这一份）
	const preferences = {
		layout: 'logicalStructure',
		lineStyle: 'straight',
		palette: 'default',
		themeStyle: 'default',
	} as const;
	const raw = {
		mindMap,
		canvasEl,
		engineEvents: binder,
		lang: 'zh',
		applyLayout,
		applyLineStyle,
		applyPalette,
		applyThemeStyle,
		resolvePreference: (key: keyof typeof preferences): string =>
			preferences[key],
		// 布局不在 PreferenceKey 里（它存文件属性），勾选态单独走 resolveLayout
		resolveLayout: (): string => preferences.layout,
	};
	return {
		view: raw as unknown as MindMapViewContext,
		raw,
		binder,
		execCommand,
		render,
		canvasEl,
		applyLayout,
		applyLineStyle,
		applyPalette,
		applyThemeStyle,
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

/**
 * 取最近**显示出来**的菜单（不存在则抛错，避免断言静默通过）。
 *
 * 注意：外观四项是二级菜单，`addChoiceMenu` 会先 `new Menu()` 建子菜单再挂到父项上，
 * 所以「最后创建的实例」往往是子菜单。只有真正 `showAtPosition` 的那个才是主菜单。
 */
function lastMenu(): MenuInstance {
	const menu = [...FakeMenu.instances]
		.reverse()
		.find((entry) => entry.shownAt !== null);
	if (!menu) {
		throw new Error('菜单未创建');
	}
	return menu;
}

/** 最近**弹出**的级联子菜单（按弹出序号，不是创建顺序） */
function lastShownMenu(): MenuInstance | undefined {
	return [...FakeMenu.instances]
		.filter((entry) => entry.shownAtMouseEvent !== null)
		.sort((a, b) => a.shownSeq - b.shownSeq)
		.at(-1);
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
	// 默认模拟「宿主没有 setSubmenu」→ 走回退路径；原生路径的用例自行开启
	FakeMenu.supportSubmenu = false;
	vi.clearAllMocks();
	resetGetNodeDataString();
	addLinkToActiveNodeMock.mockResolvedValue(undefined);
	addImageToActiveNodeMock.mockResolvedValue(undefined);
	// 自定义颜色弹窗：默认「取消」，需要返回值的用例自行 mockResolvedValue
	openColorInputModalMock.mockReset();
	openColorInputModalMock.mockResolvedValue(null);
	getActiveNodesMock.mockReturnValue([]);
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

describe('链接类动作（对齐 Obsidian 阅读视图的链接右键）', () => {
	const writeText = vi.fn<(text: string) => Promise<void>>(() =>
		Promise.resolve(),
	);

	beforeEach(() => {
		writeText.mockClear();
		// node 环境无剪贴板：整体替换 navigator（Node 自带 navigator 为只读 getter）
		vi.stubGlobal('navigator', { clipboard: { writeText } });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** 打开节点菜单（与下方矩阵同款路径：引擎 node_contextmenu 事件） */
	function openMenu(data: Record<string, unknown>) {
		const harness = makeView();
		setupContextMenu(harness.view);
		harness.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			fakeNode(data),
		);
		return lastMenu();
	}

	it('「复制链接」给**文件里的写法**：md 形态含 [显示名](路径)（此前只给裸路径）', () => {
		const menu = openMenu({
			text: '说明书',
			hyperlink: '目录/说明.md',
			mdLinkStyle: 'md',
			mdLinkText: '说明书',
		});

		menu.click(zh('menu.copyLink'));

		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText).toHaveBeenCalledWith('[说明书](目录/说明.md)');
	});

	it('「复制链接」wiki 双链：原样复制 [[linkpath|别名]]', () => {
		const menu = openMenu({
			text: '别名',
			mdWikiLinkpath: '[[笔记|别名]]',
			mdLinkStyle: 'wiki',
			mdLinkText: '别名',
		});

		menu.click(zh('menu.copyLink'));

		expect(writeText).toHaveBeenCalledWith('[[笔记|别名]]');
	});

	it('「复制链接」URL 通道：复制 autolink 写法 <…>（粘回笔记即成链接）', () => {
		const menu = openMenu({ text: '站点', hyperlink: 'https://example.com' });

		menu.click(zh('menu.copyLink'));

		expect(writeText).toHaveBeenCalledWith('<https://example.com>');
	});

	it('「在新标签页打开链接」把原始通道值交给 openHyperlink（mode=tab）', () => {
		const harness = makeView();
		const openHyperlink = vi.fn<(link: string, mode?: string) => void>();
		(harness.raw as { openHyperlink?: unknown }).openHyperlink = openHyperlink;
		setupContextMenu(harness.view);
		const node = fakeNode({ text: '别名', mdWikiLinkpath: '[[笔记|别名]]' });
		harness.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			node,
		);

		lastMenu().click(zh('menu.openLinkNewTab'));

		expect(openHyperlink).toHaveBeenCalledWith('[[笔记|别名]]', 'tab');
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
		edit: [
			zh('menu.editText'),
			zh('menu.editTextModal'),
			zh('menu.addChild'),
			zh('menu.addSibling'),
			zh('menu.moveUp'),
			zh('menu.moveDown'),
		],
		clip: [zh('menu.copyNode'), zh('menu.pasteAsChild')],
		link: [zh('menu.addLink')],
		/** 有链接时追加的链接类动作（对齐 Obsidian 阅读视图的链接右键） */
		linkActions: [zh('menu.openLinkNewTab'), zh('menu.copyLink')],
		clear: [zh('modal.link.clear')],
		imageBtn: [zh('menu.addImage')],
		imageBlock: [zh('menu.viewImageFullscreen'), zh('menu.removeImage')],
		removeText: [zh('menu.removeText')],
		/**
		 * 节点菜单末尾一段：视图级外观（布局 / 配色，与空白右键同一份）→ 删除节点。
		 * 顺序敏感：外观在删除**之前**，删除恒为最后一项。
		 */
		tail: [
			zh('toolbar.layout'),
			zh('toolbar.palette'),
			zh('menu.deleteNode'),
		],
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
			expected: [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.tail],
			hasClear: false,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '纯文本节点',
			data: { text: '项目规划' },
			expected: [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.tail],
			hasClear: false,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '带文档链接（mdWikiLinkpath 通道）',
			data: { text: '笔记', mdWikiLinkpath: '[[笔记]]', mdLinkStyle: 'wiki' },
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.linkActions,
				...G.clear,
				...G.imageBtn,
				...G.tail,
			],
			hasClear: true,
			hasImageBlock: false,
			hasRemoveText: false,
		},
		{
			name: '带外链（引擎 hyperlink 通道）',
			data: { text: '示例', hyperlink: 'https://example.com' },
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.linkActions,
				...G.clear,
				...G.imageBtn,
				...G.tail,
			],
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
			expected: [
				...G.edit,
				...G.clip,
				...G.link,
				...G.linkActions,
				...G.clear,
				...G.imageBtn,
				...G.tail,
			],
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
				...G.tail,
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
				...G.tail,
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
				...G.tail,
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
				...G.linkActions,
				...G.clear,
				...G.imageBtn,
				...G.imageBlock,
				...G.removeText,
				...G.tail,
			],
			hasClear: true,
			hasImageBlock: true,
			hasRemoveText: true,
		},
		{
			name: '根节点（中心主题）：条目与普通节点相同',
			data: { text: '中心主题' },
			expected: [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.tail],
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
			for (const title of [...G.edit, ...G.clip, ...G.link, ...G.imageBtn, ...G.tail]) {
				expect(titles).toContain(title);
			}
		},
	);

	it('双通道节点：分离器恒为 5 条（链接/图片块只增条目、不改分组；外观与删除各占一段）', () => {
		const { menu } = openNodeMenu(
			fakeNode({ mdWikiLinkpath: '[[笔记]]', image: 'app://x.png', text: '图' }),
		);
		expect(menu.separators).toBe(5);
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
		expect(menu.item(zh('menu.moveUp')).icon).toBe('arrow-up');
		expect(menu.item(zh('menu.moveDown')).icon).toBe('arrow-down');
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

	it('编辑文本：委托共用编辑入口 editNodeText(视图, 节点)（默认节点→引擎框、自绘节点→内联编辑器）', () => {
		const node = fakeNode({ text: '主题' });
		const { menu, view, execCommand } = openNodeMenu(node);
		menu.click(zh('menu.editText'));
		expect(editNodeTextMock).toHaveBeenCalledTimes(1);
		expect(editNodeTextMock).toHaveBeenCalledWith(view, node);
		// 引擎无 ENTER_TEXT_EDIT 命令：文本编辑只能经官方 node_dblclick 事件进入
		// （默认文本节点）或插件内联编辑器（自绘节点）——菜单层不再直接碰引擎
		expect(startNodeTextEditMock).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('在弹窗中编辑（备选入口）：委托 editNodeTextInModal(视图, 节点)', () => {
		const node = fakeNode({ text: '主题' });
		const { menu, view } = openNodeMenu(node);
		menu.click(zh('menu.editTextModal'));
		expect(editNodeTextInModalMock).toHaveBeenCalledTimes(1);
		expect(editNodeTextInModalMock).toHaveBeenCalledWith(view, node);
		// 两个入口相互独立：弹窗项不触发内联入口
		expect(editNodeTextMock).not.toHaveBeenCalled();
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
		expect(copySelectedNodesMock).toHaveBeenCalledWith(view);
		menu.click(zh('menu.pasteAsChild'));
		expect(pasteClipboardIntoNodeMock).toHaveBeenCalledWith(view, node);
		menu.click(zh('menu.deleteNode'));
		expect(deleteActiveNodeMock).toHaveBeenCalledWith(view);
	});

	it('上移/下移：委托 view-node-actions 并显式携带该节点（根/首尾拒绝在动作内）', () => {
		const node = fakeNode({ text: 'x' });
		const { menu, view } = openNodeMenu(node);
		menu.click(zh('menu.moveUp'));
		expect(moveNodeUpMock).toHaveBeenCalledWith(view, node);
		menu.click(zh('menu.moveDown'));
		expect(moveNodeDownMock).toHaveBeenCalledWith(view, node);
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

describe('节点右键「配色」：写 Markdown 颜色指令', () => {
	/** 节点桩 + 行数据（text/mdDerivedText 相等 = 「未编辑」，原文取 mdRaw） */
	function colorNode(raw: string, text = '项目') {
		const node = fakeNode({ text, mdDerivedText: text, mdRaw: raw });
		return { ...node, parent: null, children: [] };
	}

	/** 打开节点菜单 → 点「配色」父项，返回弹出的子菜单 */
	function openColorMenu(node: unknown) {
		const harness = makeView();
		setupContextMenu(harness.view);
		harness.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			node,
		);
		lastMenu().click(zh('toolbar.palette'), {
			clientX: 5,
			clientY: 6,
		} as MouseEvent);
		const submenu = lastShownMenu();
		if (!submenu) {
			throw new Error('配色子菜单未弹出');
		}
		return { ...harness, node, menu: lastMenu(), submenu };
	}

	it('条目与空白右键的整篇配色一致：默认 + 五种配色 + 自定义（不列「蓝」）', () => {
		const { submenu } = openColorMenu(colorNode('项目'));
		const titles = submenu.titles();
		// 与空白右键同一组标题（首项「默认」语义不同，但样式一致，2026-10-27 裁决）
		expect(titles).toEqual([
			zh('menu.color.follow'),
			...PALETTE_OPTIONS.filter((option) => option.value !== 'default').map(
				(option) => zh(option.label),
			),
			zh('palette.custom'),
		]);
		// 「默认」配色那枚蓝不再单列（词条已删，故此处只能按字面断言不存在）
		expect(titles).not.toContain('蓝');
		const checked = submenu.items.filter((entry) => entry.checked === true);
		expect(checked.map((entry) => entry.title)).toEqual([
			zh('menu.color.follow'),
		]);
	});

	/**
	 * 勾选态取**生效色**（2026-10-27 修正）：颜色沿子树继承，子节点自身没有
	 * 指令但屏上已经是父色——只读自身会让菜单勾着「默认」，等于对用户说谎。
	 */
	it('继承父色的子节点：勾在父色上，不勾「默认」', () => {
		const amber = nodeColorOptions().find(
			(option) => option.value === 'amber',
		);
		expect(amber).toBeTruthy();
		const parent = colorNode(`父 %%${amber!.color}%%`, '父');
		const child = { ...colorNode('子', '子'), parent };
		const { submenu } = openColorMenu(child);
		const checked = submenu.items.filter((entry) => entry.checked === true);
		expect(checked.map((entry) => entry.title)).toEqual([zh(amber!.label)]);
	});

	/**
	 * 「默认」= 回到**整篇配色**（2026-10-27 裁决）：上层还在染色时由 `%%none%%`
	 * 哨兵挡住继承，否则直接删指令。哨兵是该动作的落地形态，不是独立菜单项。
	 */
	it('点「默认」且上层还在染色：写 `%%none%%` 挡住继承', () => {
		const parent = colorNode('父 %%#c2761a%%', '父');
		const node = { ...colorNode('项目', '项目'), parent };
		const { submenu, view } = openColorMenu(node);
		submenu.click(zh('menu.color.follow'));
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			view,
			node,
			'项目 %%none%%',
		);
	});

	it('点「默认」且上层本就没色：只删指令，不往文件里塞哨兵', () => {
		const node = colorNode('项目 %%#ff0000%%');
		const { submenu, view } = openColorMenu(node);
		submenu.click(zh('menu.color.follow'));
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(view, node, '项目');
		// 已无指令可删 ⇒ 不写盘、也不产生一条多余的哨兵
		applyRawNodeContentMock.mockClear();
		const again = colorNode('项目');
		const second = openColorMenu(again);
		second.submenu.click(zh('menu.color.follow'));
		expect(applyRawNodeContentMock).not.toHaveBeenCalled();
	});

	it('点「默认」且上层已被更上面的哨兵挡住：删掉自身哨兵（不留垃圾）', () => {
		const parent = colorNode('父 %%none%%', '父');
		const child = { ...colorNode('子 %%none%%', '子'), parent };
		const { submenu, view } = openColorMenu(child);
		submenu.click(zh('menu.color.follow'));
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(view, child, '子');
	});

	it('哨兵节点勾在「默认」上（与没写指令同一个勾）', () => {
		const parent = colorNode('父 %%#c2761a%%', '父');
		const child = { ...colorNode('子 %%none%%', '子'), parent };
		const { submenu } = openColorMenu(child);
		const checked = submenu.items.filter((entry) => entry.checked === true);
		expect(checked.map((entry) => entry.title)).toEqual([
			zh('menu.color.follow'),
		]);
	});

	it('哨兵换成颜色：替换原位，不叠加第二条', () => {
		const node = colorNode('项目 %%none%%');
		const { submenu } = openColorMenu(node);
		const mint = nodeColorOptions().find((option) => option.value === 'mint');
		submenu.click(zh('nodeColor.mint'));
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			expect.anything(),
			node,
			`项目 %%${mint?.color}%%`,
		);
	});

	it('宿主提供原生 setSubmenu 时：交给宿主展开，不再绑点击弹出', () => {
		FakeMenu.supportSubmenu = true;
		const harness = makeView();
		setupContextMenu(harness.view);
		harness.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			fakeNode({ text: '甲' }),
		);
		const menu = lastMenu();
		const parent = menu.item(zh('toolbar.palette'));
		// 原生路径不设 onClick：点击/悬停由宿主 Menu 处理（并自带箭头）
		expect(parent.click).toBeNull();
		const native = parent.nativeSubmenu as MenuInstance;
		expect(native).toBeTruthy();
		expect(native.titles()).toEqual([
			zh('menu.color.follow'),
			...nodeColorOptions().map((option) => zh(option.label)),
			zh('palette.custom'),
		]);
		// 只在「自定义」前画一条线（与整篇配色同分组；多一条会增高、观感不同）
		expect(native.separators).toBe(1);
	});

	it('节点与空白两处子菜单结构一致：标题序列 + 分隔线条数', () => {
		FakeMenu.supportSubmenu = true;
		// 空白右键（整篇配色）
		const blank = makeView();
		setupContextMenu(blank.view);
		blank.binder.fireDom('contextmenu', fakeContextMenuEvent(null));
		const paletteSub = lastMenu().item(zh('toolbar.palette'))
			.nativeSubmenu as MenuInstance;
		// 节点右键（节点配色）
		const node = makeView();
		setupContextMenu(node.view);
		node.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			fakeNode({ text: '甲' }),
		);
		const colorSub = lastMenu().item(zh('toolbar.palette'))
			.nativeSubmenu as MenuInstance;
		expect(colorSub.titles()).toEqual(paletteSub.titles());
		expect(colorSub.separators).toBe(paletteSub.separators);
	});

	it('选颜色：指令追加在原文末尾，交给原文提交通道（同一条编辑链）', () => {
		const node = colorNode('项目');
		const { submenu, view } = openColorMenu(node);
		const mint = nodeColorOptions().find((option) => option.value === 'mint');
		submenu.click(zh('nodeColor.mint'));
		expect(applyRawNodeContentMock).toHaveBeenCalledTimes(1);
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			view,
			node,
			`项目 ${`%%${mint?.color}%%`}`,
		);
	});

	it('已有指令：替换原指令，不在后面再叠一条', () => {
		const node = colorNode('项目 %%#ff0000%%');
		const { submenu } = openColorMenu(node);
		submenu.click(zh('nodeColor.amber'));
		const amber = nodeColorOptions().find((option) => option.value === 'amber');
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			expect.anything(),
			node,
			`项目 %%${amber?.color}%%`,
		);
	});

	it('跟随整篇（= 清除节点颜色）：删掉指令并吞掉多余空格', () => {
		const node = colorNode('项目 %%#ff0000%% 说明');
		const { submenu } = openColorMenu(node);
		submenu.click(zh('menu.color.follow'));
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			expect.anything(),
			node,
			'项目 说明',
		);
	});

	it('自定义：弹窗返回值（归一后的十六进制）写进原文', async () => {
		openColorInputModalMock.mockResolvedValue('#123456');
		const node = colorNode('项目');
		const { submenu } = openColorMenu(node);
		submenu.click(zh('palette.custom'));
		await vi.waitFor(() => {
			expect(applyRawNodeContentMock).toHaveBeenCalledWith(
				expect.anything(),
				node,
				'项目 %%#123456%%',
			);
		});
	});

	it('中心主题（虚拟文档根）不写节点指令：配色退回整篇方案', () => {
		const root = {
			...fakeNode({ text: '我的导图.md' }),
			isRoot: true,
			parent: null,
			children: [],
		};
		const harness = makeView();
		setupContextMenu(harness.view);
		harness.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			root,
		);
		lastMenu().click(zh('toolbar.palette'), {
			clientX: 1,
			clientY: 1,
		} as MouseEvent);
		const submenu = lastShownMenu();
		// 整篇方案：6 个预设 + 自定义；首个不是「跟随整篇配色」
		expect(submenu?.items.map((entry) => entry.title)).toEqual([
			...PALETTE_OPTIONS.map((option) => zh(option.label)),
			zh('palette.custom'),
		]);
		// 完整序列已逐项断言（预设名与节点颜色名同文，不能用「包含某个色名」区分，
		// 也不能用「默认」——两套菜单都有这一项）
	});

	it('多选：右键按下时的选中集合全部上色（顶层合并由 engine.topMostNodes 判定）', () => {
		const first = colorNode('甲');
		const second = colorNode('乙');
		getActiveNodesMock.mockReturnValue([first, second]);
		const harness = makeView();
		setupContextMenu(harness.view);
		// 引擎先发 node_mousedown（右键），再发 contextmenu；前者留存多选集合
		harness.binder.fireEngine('node_mousedown', first, {
			button: 2,
			which: 3,
		});
		harness.binder.fireEngine(
			'node_contextmenu',
			fakeContextMenuEvent(null),
			first,
		);
		lastMenu().click(zh('toolbar.palette'), {
			clientX: 1,
			clientY: 1,
		} as MouseEvent);
		lastShownMenu()?.click(zh('nodeColor.forest'));
		const forest = nodeColorOptions().find((option) => option.value === 'forest');
		expect(applyRawNodeContentMock).toHaveBeenCalledTimes(2);
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			expect.anything(),
			first,
			`甲 %%${forest?.color}%%`,
		);
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			expect.anything(),
			second,
			`乙 %%${forest?.color}%%`,
		);
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

	it('未命中节点：画布菜单条目与顺序（新建/粘贴 ─ 缩放三件 ─ 外观四项 ─ 撤销/重做）', () => {
		const { event } = fireCanvas(null);
		const menu = lastMenu();
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(menu.titles()).toEqual([
			zh('menu.newNode'),
			zh('menu.pasteNode'),
			zh('menu.resetZoom'),
			zh('command.fitCanvas'),
			zh('toolbar.arrange'),
			// 视图级外观只剩布局 / 配色（连线与边框已升为右缘竖栏的开关按钮）
			zh('toolbar.layout'),
			zh('toolbar.palette'),
			zh('toolbar.undo'),
			zh('toolbar.redo'),
		]);
		expect(menu.separators).toBe(3);
		expect(menu.shownAt).toEqual({ x: 120, y: 240 });
		expect(menu.item(zh('menu.pasteNode')).icon).toBe('clipboard');
		expect(menu.item(zh('menu.resetZoom')).icon).toBe('rotate-ccw');
		expect(menu.item(zh('command.fitCanvas')).icon).toBe('maximize');
		expect(menu.item(zh('toolbar.arrange')).icon).toBe('sparkles');
		expect(menu.item(zh('toolbar.undo')).icon).toBe('undo');
		expect(menu.item(zh('toolbar.redo')).icon).toBe('redo');
	});

	it('画布菜单点击：粘贴挂到根（node=null）、重置缩放/适应画布/整理/撤销/重做各就各位', () => {
		const { view, execCommand } = fireCanvas(null);
		const menu = lastMenu();

		menu.click(zh('menu.pasteNode'));
		expect(pasteClipboardIntoNodeMock).toHaveBeenCalledWith(view, null);

		menu.click(zh('menu.resetZoom'));
		expect(resetZoomMock).toHaveBeenCalledWith(view.mindMap);

		menu.click(zh('command.fitCanvas'));
		expect(fitMindMapMock).toHaveBeenCalledWith(view.mindMap);

		menu.click(zh('toolbar.arrange'));
		expect(arrangeMindMapMock).toHaveBeenCalledWith(view);

		menu.click(zh('toolbar.undo'));
		expect(execCommand).toHaveBeenCalledWith(ENGINE.BACK);

		menu.click(zh('toolbar.redo'));
		expect(execCommand).toHaveBeenCalledWith(ENGINE.FORWARD);
		expect(execCommand).toHaveBeenCalledTimes(2);
	});

	it('外观四项＝级联菜单：点父项在光标处弹子菜单，选项勾选当前值', async () => {
		const { applyLayout, applyPalette } = fireCanvas(null);
		const menu = lastMenu();

		menu.click(zh('toolbar.layout'), {
			clientX: 30,
			clientY: 40,
		} as MouseEvent);
		const layoutMenu = lastShownMenu();
		expect(layoutMenu?.items).toHaveLength(LAYOUT_OPTIONS.length);
		// 勾选态只有一处为真（当前布局），且落在对应选项上
		const checked = layoutMenu?.items.filter((entry) => entry.checked === true);
		expect(checked).toHaveLength(1);
		expect(checked?.[0]?.title).toBe(zh('layout.logical'));
		expect(layoutMenu?.shownAtMouseEvent).toMatchObject({
			clientX: 30,
			clientY: 40,
		});

		layoutMenu?.click(zh('layout.mindMap'));
		expect(applyLayout).toHaveBeenCalledWith('mindMap');

		menu.click(zh('toolbar.palette'), {
			clientX: 1,
			clientY: 2,
		} as MouseEvent);
		const paletteMenu = lastShownMenu();
		// 预设 6 项 + 「自定义…」一项（2026-10-27 新增）
		expect(paletteMenu?.items).toHaveLength(PALETTE_OPTIONS.length + 1);
		paletteMenu?.click(zh('palette.mint'));
		expect(applyPalette).toHaveBeenCalledWith('mint');

		// 自定义：弹窗返回归一色值后按文件写入（整篇配色）
		openColorInputModalMock.mockResolvedValue('#89cff0');
		paletteMenu?.click(zh('palette.custom'));
		await vi.waitFor(() => {
			expect(applyPalette).toHaveBeenCalledWith('#89cff0');
		});

		// 连线与边框**不在**菜单里：它们已是右缘竖栏的开关按钮（防回潮）
		expect(menu.titles().some((title) => title.startsWith(zh('toolbar.lineStyle')))).toBe(
			false,
		);
		expect(
			menu.titles().some((title) => title.startsWith(zh('toolbar.themeStyle'))),
		).toBe(false);
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
		expect(() => menu.click(zh('toolbar.undo'))).not.toThrow();
		expect(harness.execCommand).not.toHaveBeenCalled();
	});
});

describe('applyNodeColor（写正文 + 小地图等落地补画）', () => {
	/** 只补 applyNodeColor 用得到的字段：引擎 + app（原文合成要经 app 判定可回写） */
	function makeColorView(): MindMapViewContext {
		const harness = makeView();
		return { ...harness.view, app: {} } as unknown as MindMapViewContext;
	}

	/** 节点桩：applyNodeColor 只读 isRoot / getData（最上层判定在 engine 层已 mock） */
	function colorNode(data: Record<string, unknown>): MindMapNode {
		return { isRoot: false, getData: () => data } as unknown as MindMapNode;
	}

	it('写指令后挂「渲染落地补画」（当场采样只有旧色；不刷就得等 30s 节拍）', () => {
		const view = makeColorView();
		const node = colorNode({ text: '项目', mdRaw: '项目', mdDerivedText: '项目' });
		applyNodeColor(view, [node], '#89cff0');
		expect(applyRawNodeContentMock).toHaveBeenCalledWith(
			view,
			node,
			'项目 %%#89cff0%%',
		);
		expect(minimapMocks.refreshMiniMapAfterRender).toHaveBeenCalledWith(view);
	});

	it('原文没变（重复点同一颜色）：不写盘、也不刷小地图', () => {
		const view = makeColorView();
		const node = colorNode({
			text: '项目',
			mdRaw: '项目 %%#89cff0%%',
			mdDerivedText: '项目',
		});
		applyNodeColor(view, [node], '#89cff0');
		expect(applyRawNodeContentMock).not.toHaveBeenCalled();
		expect(minimapMocks.refreshMiniMapAfterRender).not.toHaveBeenCalled();
	});

	it('只选中根节点：根没有正文行，不改也不刷', () => {
		const view = makeColorView();
		const root = {
			isRoot: true,
			getData: () => ({ text: 'root' }),
		} as unknown as MindMapNode;
		applyNodeColor(view, [root], '#89cff0');
		expect(applyRawNodeContentMock).not.toHaveBeenCalled();
		expect(minimapMocks.refreshMiniMapAfterRender).not.toHaveBeenCalled();
	});
});
