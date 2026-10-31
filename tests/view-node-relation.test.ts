/**
 * view-node-relation 回归：**删线**、**删节点**与**改标签**的入口。
 *
 * 覆盖模块自身的分支（不是引擎行为）：
 * - `removeActiveRelationLine`（`Delete` / `Backspace` 的第一落点）：只认**激活**的线
 *   ——键盘事件没有落点信息，不能按指针位置猜；命中即先摘高亮，再改正文；
 * - **孤儿 id 回收**：删线 / 删节点让某个 `%%id%%` 再无入边时，把它一并摘掉
 *   （`collectRelationTargets` 是判定面，本文件 mock 它来构造「还有 / 没有别的入边」）；
 *   仍有别的入边时 id 必须保留，否则会打断别人那条边；
 * - 右键**线**的 capture 拦截：命中才吞事件（未命中必须放行，否则空白右键菜单
 *   全被吃掉），菜单只有「改标签 / 删除」两项，且都落在正文；
 * - 双击线改标签：同一份预填与回写（`editRelationLabel`）。
 *
 * 引擎面（`activeRelationLine` / `relationLineAt` / `clearActiveRelationLine`）与
 * 原文提交通道（`applyRawNodeContents`）都是 mock：本文件只验证「调了谁、写了什么
 * 原文」，引擎内部行为由 engine 层回归覆盖；原文合成用**真实** `md-serialize`
 * ——否则断言不到「删掉的是哪一行」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/core/i18n';
import type { MindMapNode } from '../src/core/engine-types';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	cancelRelationPicking,
	removeActiveRelationLine,
	schedulePersistRelationGeometry,
	setupRelationInteractions,
	startRelationPicking,
	stripInboundRelations,
} from '../src/features/view-node-relation';
import { nodeColorOptions } from '../src/features/view-node-color';

/** 级联子菜单桩（`setSubmenu()` 的返回值；结构见 FakeMenuClass） */
interface SubmenuStub {
	items: { title: string; checked: boolean; click: (() => void) | null }[];
	titles(): string[];
	click(title: string): void;
}

/** 记录型菜单（官方 Menu 在 tests/mocks/obsidian.ts 中是空壳，不记录条目） */
interface MenuItemStub {
	title: string;
	icon: string;
	checked: boolean;
	click: (() => void) | null;
	/** 原生级联返回的子菜单（未调用 `setSubmenu()` 时为 null） */
	submenu: SubmenuStub | null;
	setTitle(title: string): MenuItemStub;
	setIcon(icon: string): MenuItemStub;
	setChecked(value: boolean): MenuItemStub;
	setSubmenu(): SubmenuStub;
	onClick(cb: () => void): MenuItemStub;
}

const FakeMenu = vi.hoisted(() => {
	class FakeMenuClass {
		static instances: FakeMenuClass[] = [];
		items: MenuItemStub[] = [];
		shownAt: { x: number; y: number } | null = null;

		constructor() {
			FakeMenuClass.instances.push(this);
		}

		addItem(cb: (item: MenuItemStub) => unknown): this {
			const item: MenuItemStub = {
				title: '',
				icon: '',
				checked: false,
				click: null,
				submenu: null,
				setTitle(title) {
					this.title = title;
					return this;
				},
				setIcon(icon) {
					this.icon = icon;
					return this;
				},
				setChecked(value) {
					this.checked = value;
					return this;
				},
				// 与宿主原生级联同形：无参调用，返回**新建的子菜单**
				setSubmenu() {
					const submenu = new FakeMenuClass();
					this.submenu = submenu;
					return submenu;
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

		/** 分隔线不是条目（不进 `items` / `titles()`）：`addCustomColorItem` 会调它 */
		addSeparator(): this {
			return this;
		}

		/** 是否已被关闭（独占菜单：开新的先关旧的，K155） */
		hidden = false;
		hideCallbacks: (() => void)[] = [];

		showAtPosition(pos: { x: number; y: number }): this {
			this.shownAt = pos;
			return this;
		}

		hide(): this {
			this.hidden = true;
			this.hideCallbacks.forEach((cb) => cb());
			return this;
		}

		onHide(cb: () => void): void {
			this.hideCallbacks.push(cb);
		}

		titles(): string[] {
			return this.items.map((entry) => entry.title);
		}

		/** 按标题点击（不存在则抛错，避免静默通过） */
		click(title: string): void {
			const found = this.items.find((entry) => entry.title === title);
			if (!found?.click) {
				throw new Error(`菜单项不存在或不可点击：${title}`);
			}
			found.click();
		}
	}
	return FakeMenuClass;
});

const mocks = vi.hoisted(() => ({
	activeRelationLine: vi.fn<() => unknown>(() => null),
	clearActiveRelationLine: vi.fn<() => void>(),
	relationLineAt: vi.fn<() => unknown>(() => null),
	applyRawNodeContents: vi.fn<(...args: unknown[]) => void>(),
	openRelationLabelModal: vi.fn<() => Promise<string | null>>(() =>
		Promise.resolve(null),
	),
	/** 全树仍被 `%%rel%%` 指向的 id（缺省空集 = 谁都留不住，孤儿 id 会被回收） */
	collectRelationTargets: vi.fn<() => Set<string>>(() => new Set<string>()),
	getRenderRoot: vi.fn<() => unknown>(() => null),
	/** 引擎侧出边（几何回写用；缺省无出边） */
	engineRelationsOf: vi.fn<(node?: unknown) => unknown[]>(() => []),
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return { ...actual, Menu: FakeMenu };
});

// 引擎面：本文件只验证「问引擎要了哪条线」
vi.mock('../src/engine/mindmap', () => ({
	activeRelationLine: mocks.activeRelationLine,
	clearActiveRelationLine: mocks.clearActiveRelationLine,
	collectRelationIds: (): Set<string> => new Set<string>(),
	collectRelationTargets: mocks.collectRelationTargets,
	engineRelationsOf: mocks.engineRelationsOf,
	getRenderRoot: mocks.getRenderRoot,
	markNodeNeedLayout: (): void => {},
	relationLineAt: mocks.relationLineAt,
	// 色族 → 主色：本文件只验证「菜单把哪个值写进正文」，取值只需**互相不同**
	//（同一色会让勾选态断言失去意义——六个预设会同时被勾上）
	paletteNodeColor: (id: string): string =>
		({
			mint: '#22c55e',
			amber: '#f59e0b',
			rose: '#f43f5e',
			wisteria: '#8b5cf6',
			forest: '#15803d',
			slate: '#64748b',
		})[id] ?? '#4a90d9',
}));

// 原文提交通道（真实实现在 node-inline-editor）：只验证写进去的原文
vi.mock('../src/features/node-inline-editor', () => ({
	applyRawNodeContents: mocks.applyRawNodeContents,
}));

vi.mock('../src/ui/modal-relation-label', () => ({
	openRelationLabelModal: mocks.openRelationLabelModal,
}));

/** 取真实中文文案（key 拼错即编译失败） */
function zh(key: Parameters<typeof t>[1]): string {
	return t('zh', key);
}

/** 节点桩：`getData()` 返回活引用（与引擎单节点 `getData()` 同语义） */
function nodeOf(data: Record<string, unknown>): MindMapNode {
	return {
		isRoot: false,
		getData: (key?: string) => (key === undefined ? data : data[key]),
	} as unknown as MindMapNode;
}

/** 源节点：正文里有一条带标签的出边 */
function sourceNode(): MindMapNode {
	return nodeOf({
		text: '支付',
		mdDerivedText: '支付',
		mdRaw: '## 支付\n%%rel:aaaaaa | 依赖%%',
	});
}

/** 源节点（已拖过端点/控制点：正文里存了 geo 段） */
function geoSourceNode(): MindMapNode {
	return nodeOf({
		text: '支付',
		mdDerivedText: '支付',
		mdRaw:
			'## 支付\n%%rel:aaaaaa | 依赖 | geo=right,0,left,8,12,0,-30,-12%%',
	});
}

/** 源节点（已上色：正文里存了 color 段） */
function coloredSourceNode(color = '#ff0000'): MindMapNode {
	return nodeOf({
		text: '支付',
		mdDerivedText: '支付',
		mdRaw: `## 支付\n%%rel:aaaaaa | 依赖 | color=${color}%%`,
	});
}

/** 目标节点：正文里有身份 id（= 画布上那条线指向的节点） */
function targetNode(): MindMapNode {
	return nodeOf({
		text: '结算',
		mdDerivedText: '结算',
		mdRaw: '## 结算\n%%id:aaaaaa%%',
	});
}

/** 记录 onDom / onEngine 的监听，供按事件名触发 */
function makeBinder() {
	const dom = new Map<string, (event: unknown) => void>();
	return {
		onDom(
			_target: unknown,
			type: string,
			listener: (event: unknown) => void,
		): void {
			dom.set(type, listener);
		},
		onEngine(): void {},
		fire(type: string, event: unknown): void {
			dom.get(type)?.(event);
		},
		has(type: string): boolean {
			return dom.has(type);
		},
	};
}

/** 视图桩：交互注册只要引擎 + 画布 + 事件绑定器 + 写原文所需的面 */
function makeView() {
	const binder = makeBinder();
	const view = {
		mindMap: {},
		canvasEl: {},
		engineEvents: binder,
		app: {},
		lang: 'zh',
		scheduleSave: vi.fn(),
		notifyNodeContentCommitted: vi.fn(),
	};
	return { view: view as unknown as MindMapViewContext, binder };
}

/** 鼠标事件桩（右键 / 双击共用；`target` 由 relationLineAt 的 mock 决定是否命中） */
function fakeMouseEvent() {
	return {
		target: { tag: 'path' },
		clientX: 30,
		clientY: 40,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
}

beforeEach(() => {
	FakeMenu.instances = [];
	vi.clearAllMocks();
	mocks.activeRelationLine.mockReturnValue(null);
	mocks.relationLineAt.mockReturnValue(null);
	mocks.openRelationLabelModal.mockResolvedValue(null);
	// 缺省：没有任何 `%%rel%%` 还在引用目标 id（删线 / 删节点都会回收孤儿 id）
	mocks.collectRelationTargets.mockReturnValue(new Set<string>());
	mocks.getRenderRoot.mockReturnValue(null);
});

afterEach(() => {
	FakeMenu.instances = [];
	vi.restoreAllMocks();
});

describe('removeActiveRelationLine（Delete / Backspace 删线）', () => {
	it('没有激活的线：不消费按键、不清选中、不写盘', () => {
		const { view } = makeView();

		expect(removeActiveRelationLine(view)).toBe(false);
		expect(mocks.clearActiveRelationLine).not.toHaveBeenCalled();
		expect(mocks.applyRawNodeContents).not.toHaveBeenCalled();
	});

	it('命中激活线：先摘高亮，再把该边从正文里删掉；目标再无入边时一并回收它的 id', () => {
		const { view } = makeView();
		const from = sourceNode();
		const to = targetNode();
		mocks.activeRelationLine.mockReturnValue({ from, to });

		expect(removeActiveRelationLine(view)).toBe(true);
		// 高亮/控制点先消失：写盘后若渲染被延后，屏上不会留下「选中了一条已删的线」
		expect(mocks.clearActiveRelationLine).toHaveBeenCalledWith(view.mindMap);
		// 行数判断按「排除源节点后还有谁指向它」得出，不是猜的
		expect(mocks.collectRelationTargets).toHaveBeenCalledWith(view.mindMap, from);
		expect(mocks.applyRawNodeContents).toHaveBeenCalledTimes(1);
		expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
			view,
			[
				{ node: from, raw: '## 支付' },
				// `%%id:aaaaaa%%` 已无任何入边：正文里不该再留这条垃圾指令
				{ node: to, raw: '## 结算' },
			],
			{ afterCommit: false },
		);
	});

	it('目标还有别的入边：只改源节点那一行，`%%id%%` 必须保留', () => {
		const { view } = makeView();
		const from = sourceNode();
		const to = targetNode();
		mocks.activeRelationLine.mockReturnValue({ from, to });
		mocks.collectRelationTargets.mockReturnValue(new Set(['aaaaaa']));

		expect(removeActiveRelationLine(view)).toBe(true);
		expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
			view,
			[{ node: from, raw: '## 支付' }],
			{ afterCommit: false },
		);
	});

	it('目标节点没有 id（正文里本就没有这条边）：仍消费按键，但不写半截指令', () => {
		const { view } = makeView();
		const to = nodeOf({ text: '结算', mdDerivedText: '结算', mdRaw: '## 结算' });
		mocks.activeRelationLine.mockReturnValue({ from: sourceNode(), to });

		expect(removeActiveRelationLine(view)).toBe(true);
		expect(mocks.clearActiveRelationLine).toHaveBeenCalledTimes(1);
		expect(mocks.applyRawNodeContents).not.toHaveBeenCalled();
	});
});

describe('删除节点（stripInboundRelations）', () => {
	/**
	 * 渲染树桩：`getRenderRoot` 返回的是渲染根本身（不是包装层），故根也必须是
	 * 带 `getData` 的节点桩——`walkTree` 会先访问它。
	 */
	function treeOf(...nodes: MindMapNode[]): MindMapNode {
		const root = nodeOf({ text: 'root' });
		(root as unknown as { children: MindMapNode[] }).children = nodes;
		return root;
	}

	/** 带身份的节点桩（`data` 是活引用，断言直接读它） */
	function nodeDataOf(raw: string): {
		node: MindMapNode;
		data: Record<string, unknown>;
	} {
		const data: Record<string, unknown> = {
			text: raw.split('\n')[0]!.replace(/^#+\s*/u, ''),
			mdDerivedText: raw.split('\n')[0]!.replace(/^#+\s*/u, ''),
			mdRaw: raw,
		};
		return { node: nodeOf(data), data };
	}

	/** 被删节点桩（`state` 由用例给出，`node` 只用来做身份排除） */
	function doomedNode(): MindMapNode {
		return nodeOf({
			text: '被删',
			mdDerivedText: '被删',
			mdRaw: '## 被删',
		});
	}

	it('清掉指向被删节点的入边（源码节点那一行）', () => {
		const { view } = makeView();
		const { node: from, data: fromData } = nodeDataOf(
			'## 支付\n%%rel:aaaaaa | 依赖%%',
		);
		mocks.getRenderRoot.mockReturnValue(treeOf(from));

		stripInboundRelations(view, {
			node: doomedNode(),
			state: { id: 'aaaaaa', refs: [] },
		});

		expect(fromData.mdRaw).toBe('## 支付');
		expect(fromData.mdDirectiveTail).toBeUndefined();
	});

	/**
	 * 被删节点的**出边**随它一起消失：目标若因此再无入边，它的 `%%id%%` 不能留
	 * （2026-10-30 实机：删线 + 删节点后目标节点里残留 `%%id:aaaa01%%`）。
	 */
	it('回收被删节点曾指向的目标上的孤儿 id', () => {
		const { view } = makeView();
		const { node: to, data: toData } = nodeDataOf('## 结算\n%%id:aaaaaa%%');
		mocks.getRenderRoot.mockReturnValue(treeOf(to));
		mocks.collectRelationTargets.mockReturnValue(new Set<string>());

		stripInboundRelations(view, {
			node: doomedNode(),
			state: { id: null, refs: [{ target: 'aaaaaa', label: '' }] },
		});

		expect(toData.mdRaw).toBe('## 结算');
		expect(toData.mdDirectiveTail).toBeUndefined();
	});

	it('目标仍有别的入边：id 保留，一字不动', () => {
		const { view } = makeView();
		const { node: to, data: toData } = nodeDataOf('## 结算\n%%id:aaaaaa%%');
		mocks.getRenderRoot.mockReturnValue(treeOf(to));
		mocks.collectRelationTargets.mockReturnValue(new Set(['aaaaaa']));

		stripInboundRelations(view, {
			node: doomedNode(),
			state: { id: null, refs: [{ target: 'aaaaaa', label: '' }] },
		});

		expect(toData.mdRaw).toBe('## 结算\n%%id:aaaaaa%%');
	});

	/**
	 * 实例树滞后（`REMOVE_NODE` 只摘数据树，实例要等 `render()` 才更新）：被删节点
	 * 此刻仍在 `getRenderRoot()` 的 children 里 ⇒ 它自己那条出边会被误算成
	 * 「还有人指向」。必须按**对象身份**排除（2026-10-30 实机：删线回收生效、
	 * 删节点回收不生效，根因就在这一拍）。
	 */
	it('被删节点仍留在实例树上时，它自己那条出边不算「还有人指向」', () => {
		const { view } = makeView();
		const { node: to, data: toData } = nodeDataOf('## 汇合\n%%id:bbbb01%%');
		const doomed = nodeOf({
			text: '源二',
			mdDerivedText: '源二',
			mdRaw: '## 源二\n%%rel:bbbb01 | 乙%%',
		});
		mocks.getRenderRoot.mockReturnValue(treeOf(doomed, to));
		// 真实语义：排除被删节点后，全树已无人指向 bbbb01
		mocks.collectRelationTargets.mockReturnValue(new Set<string>());

		stripInboundRelations(view, {
			node: doomed,
			state: { id: null, refs: [{ target: 'bbbb01', label: '乙' }] },
		});

		// 判定面收到身份排除参数
		expect(mocks.collectRelationTargets).toHaveBeenCalledWith(view.mindMap, doomed);
		// 被删节点自己不再被改写（已不在树上）
		expect(doomed.getData('mdRaw')).toBe('## 源二\n%%rel:bbbb01 | 乙%%');
		expect(toData.mdRaw).toBe('## 汇合');
	});

	/** 同一节点既指向被删节点、自己又是孤儿：一次改写同时摘掉 ref 与 id */
	it('同一节点上的入边与孤儿 id 合并成一次改写', () => {
		const { view } = makeView();
		const { node, data } = nodeDataOf(
			'## 双料\n%%id:bbbbbb%% %%rel:aaaaaa | 依赖%%',
		);
		mocks.getRenderRoot.mockReturnValue(treeOf(node));
		mocks.collectRelationTargets.mockReturnValue(new Set<string>());

		stripInboundRelations(view, {
			node: doomedNode(),
			state: { id: 'aaaaaa', refs: [{ target: 'bbbbbb', label: '' }] },
		});

		expect(data.mdRaw).toBe('## 双料');
		expect(data.mdDirectiveTail).toBeUndefined();
	});
});

describe('点选模式（「联系」→ 点目标节点）', () => {
	it('进入后 Esc 可取消；未进入时 Esc 不该被消费（返回 false）', () => {
		const { view } = makeView();
		expect(cancelRelationPicking(view)).toBe(false);

		startRelationPicking(view, sourceNode());
		expect(cancelRelationPicking(view)).toBe(true);
		// 取消是幂等的：再按一次 Esc 已无状态可清
		expect(cancelRelationPicking(view)).toBe(false);
	});

	it('中心主题不能作起点：提示后不进入选点模式', () => {
		const { view } = makeView();
		const root = { ...nodeOf({ text: '我的导图' }), isRoot: true } as MindMapNode;

		startRelationPicking(view, root);
		expect(cancelRelationPicking(view)).toBe(false);
	});

	/**
	 * 引擎重建（换文件 / 切回 Markdown 再回来）后旧节点引用作废：残留的 pending
	 * 会让下一次「点目标节点」写进一个不在树上的节点——文件毫无变化。
	 */
	it('引擎重建时清掉残留的点选状态', () => {
		const { view } = makeView();
		startRelationPicking(view, sourceNode());

		setupRelationInteractions(view);

		expect(cancelRelationPicking(view)).toBe(false);
	});
});

/**
 * 联系线的右键**根菜单**（含「联系配色」父项的那个实例）。
 *
 * 不能取 `instances.at(-1)`：原生级联会在构建父项时**当场再建一个 Menu**（子菜单），
 * 它才是最后创建的那个——取末项会拿到装满色块的子菜单。
 */
function lineMenu(): InstanceType<typeof FakeMenu> {
	// 取**最近**一个（同一用例里可能连开两次菜单做对比）
	const found = FakeMenu.instances
		.filter((menu) =>
			menu.items.some((entry) => entry.title === zh('nodeRelation.color')),
		)
		.at(-1);
	if (!found) {
		throw new Error('没有联系线右键菜单');
	}
	return found;
}

describe('右键联系线（capture 拦截 + 只作用于这一条边）', () => {
	it('注册画布右键的捕获阶段监听', () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		expect(binder.has('contextmenu')).toBe(true);
	});

	it('命中线：吞事件并弹出「配色 / 改标签 / 删除」三项', () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		mocks.relationLineAt.mockReturnValue({
			from: sourceNode(),
			to: targetNode(),
		});

		const event = fakeMouseEvent();
		binder.fire('contextmenu', event);

		// 捕获阶段必须拦下：引擎 svg 上的 contextmenu 会重画全部线、换掉元素
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		const menu = lineMenu();
		expect(menu.titles()).toEqual([
			zh('nodeRelation.color'),
			zh('nodeRelation.editLabel'),
			zh('nodeRelation.delete'),
		]);
		expect(menu.items.map((entry) => entry.icon)).toEqual([
			'palette',
			'pencil',
			'trash-2',
		]);
		expect(menu.shownAt).toEqual({ x: 30, y: 40 });
	});

	it('点「删除联系」：把这条边从源节点正文里摘掉', () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		const from = sourceNode();
		mocks.relationLineAt.mockReturnValue({ from, to: targetNode() });
		// 目标还有别的入边：本用例只关心「删的是哪一行」，id 回收由上面的用例覆盖
		mocks.collectRelationTargets.mockReturnValue(new Set(['aaaaaa']));
		binder.fire('contextmenu', fakeMouseEvent());

		lineMenu().click(zh('nodeRelation.delete'));

		expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
			view,
			[{ node: from, raw: '## 支付' }],
			{ afterCommit: false },
		);
	});

	it('点「编辑联系标签」：弹窗预填当前标签，提交后写回正文', async () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		const from = sourceNode();
		mocks.relationLineAt.mockReturnValue({ from, to: targetNode() });
		mocks.openRelationLabelModal.mockResolvedValue('依赖（强）');
		binder.fire('contextmenu', fakeMouseEvent());

		lineMenu().click(zh('nodeRelation.editLabel'));

		expect(mocks.openRelationLabelModal).toHaveBeenCalledWith(
			view.app,
			'zh',
			'依赖',
		);
		await vi.waitFor(() => {
			expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
				view,
				[{ node: from, raw: '## 支付\n%%rel:aaaaaa | 依赖（强）%%' }],
				{ afterCommit: false },
			);
		});
	});

	it('改标签不能丢掉拖动几何：geo 段原样保留', async () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		const from = geoSourceNode();
		mocks.relationLineAt.mockReturnValue({ from, to: targetNode() });
		mocks.openRelationLabelModal.mockResolvedValue('依赖（强）');
		binder.fire('contextmenu', fakeMouseEvent());

		lineMenu().click(zh('nodeRelation.editLabel'));

		await vi.waitFor(() => {
			expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
				view,
				[
					{
						node: from,
						raw:
							'## 支付\n%%rel:aaaaaa | 依赖（强） | ' +
							'geo=right,0,left,8,12,0,-30,-12%%',
					},
				],
				{ afterCommit: false },
			);
		});
	});

	/**
	 * 独占菜单（K155）：引擎在画布上吞掉 `mousedown`，宿主不会替我们关闭旧菜单
	 * ⇒ 连续右键两条线时旧菜单必须被我们自己关掉（2026-10-31 实机：菜单叠成一片）。
	 */
	it('连续右键两条线：上一个菜单被关闭，不会叠在屏上', () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		mocks.relationLineAt.mockReturnValue({
			from: sourceNode(),
			to: targetNode(),
		});

		binder.fire('contextmenu', fakeMouseEvent());
		const first = FakeMenu.instances.at(-1)!;
		binder.fire('contextmenu', fakeMouseEvent());
		const second = FakeMenu.instances.at(-1)!;

		expect(second).not.toBe(first);
		expect(first.hidden).toBe(true);
		expect(second.hidden).toBe(false);
	});

	it('未命中线：放行给普通画布右键（不吞事件、不弹菜单）', () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);

		const event = fakeMouseEvent();
		binder.fire('contextmenu', event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
		expect(FakeMenu.instances).toHaveLength(0);
	});
});

describe('联系线配色（右键线 →「联系配色」）', () => {
	/** 右键命中那条线，取出「联系配色」原生级联子菜单 */
	function openColorMenu(from: MindMapNode = sourceNode()) {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		mocks.relationLineAt.mockReturnValue({ from, to: targetNode() });
		binder.fire('contextmenu', fakeMouseEvent());
		const parent = lineMenu().items.find(
			(entry) => entry.title === zh('nodeRelation.color'),
		);
		if (!parent?.submenu) {
			throw new Error('没有「联系配色」级联子菜单');
		}
		return { view, from, submenu: parent.submenu };
	}

	/** 子菜单里被勾上的条目（应当恒为一个） */
	function checkedTitles(submenu: SubmenuStub): string[] {
		return submenu.items
			.filter((entry) => entry.checked)
			.map((entry) => entry.title);
	}

	it('子菜单 = 默认 + 与节点配色同一套色族 + 自定义', () => {
		const { submenu } = openColorMenu();
		expect(submenu.titles()).toEqual([
			zh('menu.color.follow'),
			...nodeColorOptions().map((option) => zh(option.label)),
			zh('palette.custom'),
		]);
	});

	it('没有 color 段：勾在「默认」', () => {
		const { submenu } = openColorMenu();
		expect(checkedTitles(submenu)).toEqual([zh('menu.color.follow')]);
	});

	it('已有颜色：勾在该色上（不在预设里则勾「自定义」）', () => {
		expect(checkedTitles(openColorMenu(coloredSourceNode()).submenu)).toEqual([
			zh('palette.custom'),
		]);
		const preset = nodeColorOptions()[0]!;
		expect(
			checkedTitles(openColorMenu(coloredSourceNode(preset.color)).submenu),
		).toEqual([zh(preset.label)]);
	});

	it('点某个色族：把 `color=` 段写进源节点那一行', () => {
		const { view, from, submenu } = openColorMenu();
		const mint = nodeColorOptions()[0]!;

		submenu.click(zh(mint.label));

		expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
			view,
			[{ node: from, raw: `## 支付\n%%rel:aaaaaa | 依赖 | color=${mint.color}%%` }],
			{ afterCommit: false },
		);
	});

	it('上色不动手绘几何：geo 段原样保留', () => {
		const { view, from, submenu } = openColorMenu(geoSourceNode());
		const mint = nodeColorOptions()[0]!;

		submenu.click(zh(mint.label));

		expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
			view,
			[
				{
					node: from,
					raw:
						`## 支付\n%%rel:aaaaaa | 依赖 | geo=right,0,left,8,12,0,-30,-12` +
						` | color=${mint.color}%%`,
				},
			],
			{ afterCommit: false },
		);
	});

	it('点「默认」：摘掉 color 段，回落主题', () => {
		const { view, from, submenu } = openColorMenu(coloredSourceNode());

		submenu.click(zh('menu.color.follow'));

		expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
			view,
			[{ node: from, raw: '## 支付\n%%rel:aaaaaa | 依赖%%' }],
			{ afterCommit: false },
		);
	});

	it('重复选同一个颜色：不写盘', () => {
		const preset = nodeColorOptions()[0]!;
		const { submenu } = openColorMenu(coloredSourceNode(preset.color));

		submenu.click(zh(preset.label));

		expect(mocks.applyRawNodeContents).not.toHaveBeenCalled();
	});
});

describe('几何回写（拖完端点：data → 正文）', () => {
	/** 渲染树桩（根 + 若干节点）：`getRenderRoot` 返回渲染根本身 */
	function treeOf(...nodes: MindMapNode[]): MindMapNode {
		const root = nodeOf({ text: 'root' });
		(root as unknown as { children: MindMapNode[] }).children = nodes;
		return root;
	}

	/**
	 * 颜色只存在于正文（引擎侧没有可回读的拖动产物）⇒ 重建 refs 时必须从当前
	 * `%%rel%%` 原样搬过去，否则**拖一次端点就把线色抹掉**。
	 */
	it('回写几何时把线色原样带走', () => {
		vi.useFakeTimers();
		try {
			const { view, binder } = makeView();
			setupRelationInteractions(view); // 注册画布 pointerdown（手势时间闸门）
			const geo = {
				fromDir: 'right' as const,
				toDir: 'left' as const,
				fromRange: 0,
				toRange: 0,
				ctl1: { x: 1, y: 2 },
				ctl2: { x: 3, y: 4 },
			};
			const from = nodeOf({
				text: '支付',
				mdDerivedText: '支付',
				mdRaw: '## 支付\n%%rel:aaaaaa | 依赖 | color=#ff8800%%',
			});
			const to = nodeOf({
				text: '结算',
				mdDerivedText: '结算',
				mdRaw: '## 结算\n%%id:aaaaaa%%',
				uid: 'u1',
			});
			mocks.getRenderRoot.mockReturnValue(treeOf(from, to));
			mocks.engineRelationsOf.mockImplementation((node) =>
				node === from ? [{ uid: 'u1', geo }] : [],
			);

			binder.fire('pointerdown', {});
			schedulePersistRelationGeometry(view);
			vi.advanceTimersByTime(500);

			expect(mocks.applyRawNodeContents).toHaveBeenCalledWith(
				view,
				[
					{
						node: from,
						raw:
							'## 支付\n%%rel:aaaaaa | 依赖 | geo=right,0,left,0,1,2,3,4' +
							' | color=#ff8800%%',
					},
				],
				{ afterCommit: false },
			);
		} finally {
			vi.useRealTimers();
		}
	});

	/**
	 * 几何回写只补 `geo`，**不重建 refs**：按 data 重建会让正文刚删掉的边
	 * 在下一轮同步里"复活"（那条边此时还在 data 里，正文已经没有了）。
	 */
	it('正文里已经没有这条边：不写回（几何通道不得复活已删的边）', () => {
		vi.useFakeTimers();
		try {
			const { view, binder } = makeView();
			setupRelationInteractions(view);
			const from = nodeOf({
				text: '支付',
				mdDerivedText: '支付',
				mdRaw: '## 支付',
			});
			const to = nodeOf({
				text: '结算',
				mdDerivedText: '结算',
				mdRaw: '## 结算\n%%id:aaaaaa%%',
				uid: 'u1',
			});
			mocks.getRenderRoot.mockReturnValue(treeOf(from, to));
			mocks.engineRelationsOf.mockImplementation((node) =>
				node === from
					? [
							{
								uid: 'u1',
								geo: {
									fromDir: 'right' as const,
									toDir: 'left' as const,
									fromRange: 0,
									toRange: 0,
									ctl1: { x: 1, y: 2 },
									ctl2: { x: 3, y: 4 },
								},
							},
						]
					: [],
			);

			binder.fire('pointerdown', {});
			schedulePersistRelationGeometry(view);
			vi.advanceTimersByTime(500);

			expect(mocks.applyRawNodeContents).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('双击联系线改标签（capture 拦引擎内联框）', () => {
	it('命中线：吞事件并弹我们自己的弹窗', () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		mocks.relationLineAt.mockReturnValue({
			from: sourceNode(),
			to: targetNode(),
		});

		const event = fakeMouseEvent();
		binder.fire('dblclick', event);

		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
		expect(mocks.openRelationLabelModal).toHaveBeenCalledWith(
			view.app,
			'zh',
			'依赖',
		);
	});

	it('取消（null）：不写盘', async () => {
		const { view, binder } = makeView();
		setupRelationInteractions(view);
		mocks.relationLineAt.mockReturnValue({
			from: sourceNode(),
			to: targetNode(),
		});
		binder.fire('dblclick', fakeMouseEvent());

		await vi.waitFor(() => {
			expect(mocks.openRelationLabelModal).toHaveBeenCalledTimes(1);
		});
		expect(mocks.applyRawNodeContents).not.toHaveBeenCalled();
	});
});
