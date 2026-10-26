/**
 * view-toolbar 回归测试：右缘图标栈的装配与接线。
 *
 * 2026-10-22 第三版排布（对齐 Obsidian Canvas 右栏）：屏上只剩**纯动作**，四组自上而下
 * - 组 1 文档：返回 Markdown / 导出图片
 * - 组 2 外观：边框 / 连线（状态开关）
 * - 组 3 视图：放大 / 重置缩放 / 总览全局 / 整理 / 缩小
 * - 组 4 历史：撤销 / 重做
 *
 * 覆盖：
 * - 四组的 DOM 结构与按钮顺序、图标接线、无障碍标签（官方 setTooltip 写 aria-label）；
 * - 每个按钮的 onclick 真的接到对应动作（引擎命令、导出、缩放收口函数、fitToScreen）；
 * - **反向断言**：外观四项（布局/连线/配色/边框）与节点级动作**都不在屏上**
 *   —— 前者在节点右键的二级菜单、后者一直在右键菜单，防止有人把它们加回屏幕；
 * - arrangeMindMap 三种分支的提示文案；
 * - refreshToolbar 清空后重建、语言切换后 tooltip 跟随。
 *
 * 隔离策略：引擎面（../src/engine/mindmap）、同级模块（view-search / view-export）与
 * obsidian 的 setIcon、Notice 全部 vi.mock；本文件不触碰 vendor bundle。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import { t } from '../src/core/i18n';
import {
	arrangeMindMap,
	buildToolbar,
	refreshToolbar,
} from '../src/features/view-toolbar';
import type { MindMapViewContext } from '../src/features/view-context';

const engineMocks = vi.hoisted(() => ({
	arrangeMindMap: vi.fn<(mindMap: unknown) => boolean>(),
	fitMindMap: vi.fn<(mindMap: unknown) => void>(),
	resetZoom: vi.fn<(mindMap: unknown) => void>(),
	zoomInMindMap: vi.fn<(mindMap: unknown) => void>(),
	zoomOutMindMap: vi.fn<(mindMap: unknown) => void>(),
	// 与真实语义一致（真值由 mindmap-theme.test.ts 锁定）：三态布局可切连线
	supportsLineStyleSwitch: vi.fn<(layout: string) => boolean>((layout) =>
		layout === 'logicalStructure' ||
		layout === 'mindMap' ||
		layout === 'organizationStructure',
	),
}));

const siblingMocks = vi.hoisted(() => ({
	exportImage: vi.fn<(view: unknown) => Promise<void>>(),
}));

const setIconMock = vi.hoisted(() =>
	vi.fn<(parent: unknown, iconId: string) => void>(),
);
/** Notice 是类：用工厂类把「构造时传入的文案」记进 spy */
const noticeMock = vi.hoisted(() => vi.fn<(message?: string) => void>());

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		setIcon: setIconMock,
		Notice: class {
			constructor(message?: string) {
				noticeMock(message);
			}
		},
	};
});

vi.mock('../src/engine/mindmap', () => ({
	// ENGINE_COMMANDS 是常量表：保留真实值才能断言「命令名真的用对了」
	ENGINE_COMMANDS: {
		BACK: 'BACK',
		FORWARD: 'FORWARD',
	},
	arrangeMindMap: engineMocks.arrangeMindMap,
	fitMindMap: engineMocks.fitMindMap,
	// 大图 fit 的计数入口（fitToScreen 经此判断是否提示+让帧）：0 节点 ⇒ 同步 fit
	countMindMapNodes: (): number => 0,
	resetZoom: engineMocks.resetZoom,
	zoomInMindMap: engineMocks.zoomInMindMap,
	zoomOutMindMap: engineMocks.zoomOutMindMap,
	supportsLineStyleSwitch: engineMocks.supportsLineStyleSwitch,
}));

vi.mock('../src/features/view-export', () => ({
	exportImage: siblingMocks.exportImage,
}));

interface FakeElInit {
	readonly cls?: string;
	readonly attr?: Record<string, string>;
}

/** 最小伪元素：记录子元素、类名、属性与文本（setIcon 已换 spy，无需真实图标） */
class FakeEl {
	readonly tag: string;
	readonly classes: string[];
	readonly attr: Record<string, string>;
	readonly children: FakeEl[] = [];
	/** setText 调用序列（末项即当前文本） */
	readonly texts: string[] = [];
	value = '';
	onclick: (() => void) | null = null;
	onchange: (() => void) | null = null;
	emptyCount = 0;

	constructor(tag: string, init: FakeElInit = {}) {
		this.tag = tag;
		this.classes = (init.cls ?? '').split(/\s+/).filter(Boolean);
		this.attr = { ...(init.attr ?? {}) };
	}

	get text(): string {
		return this.texts[this.texts.length - 1] ?? '';
	}

	createDiv(cls?: string): FakeEl {
		const child = new FakeEl('div', cls === undefined ? {} : { cls });
		this.children.push(child);
		return child;
	}

	createEl(tag: string, init: FakeElInit = {}): FakeEl {
		const child = new FakeEl(tag, init);
		this.children.push(child);
		return child;
	}

	createSpan(cls?: string): FakeEl {
		const child = new FakeEl('span', cls === undefined ? {} : { cls });
		this.children.push(child);
		return child;
	}

	setText(text: string): void {
		this.texts.push(text);
	}

	/** 按钮置灰时会加类（官方 Element.addClass） */
	addClass(cls: string): void {
		if (!this.classes.includes(cls)) {
			this.classes.push(cls);
		}
	}

	/** 官方 setTooltip 桩（全局 mock）经此写入 aria-label */
	setAttribute(name: string, value: string): void {
		this.attr[name] = value;
	}

	/** 官方 setTooltip 省略落位时会清掉旧值（见 `tests/mocks/obsidian.setTooltip`） */
	removeAttribute(name: string): void {
		delete this.attr[name];
	}

	empty(): void {
		this.emptyCount += 1;
		this.children.length = 0;
	}
}

type ExecCommandMock = ReturnType<
	typeof vi.fn<(command: string, ...args: unknown[]) => void>
>;

interface Harness {
	readonly view: MindMapViewContext;
	readonly toolbarEl: FakeEl;
	readonly mindMap: MindMap;
	readonly execCommand: ExecCommandMock;
	readonly backToMarkdown: ReturnType<typeof vi.fn>;
	readonly applyLineStyle: ReturnType<typeof vi.fn>;
	readonly applyThemeStyle: ReturnType<typeof vi.fn>;
	/** 改写 `resolvePreference('layout')` 的返回值（模拟「建栏时只有默认布局、之后才拿到文件值」） */
	readonly setLayout: (layout: string) => void;
}

/** 构造视图桩（每次新建：工具栏在 toolbarEl 上建 DOM，语言与外观状态可配） */
function makeView(
	options: {
		withToolbar?: boolean;
		layout?: string;
		lineStyle?: string;
		themeStyle?: string;
	} = {},
): Harness {
	const toolbarEl = new FakeEl('div');
	const execCommand = vi.fn<(command: string, ...args: unknown[]) => void>();
	const mindMap = { execCommand } as unknown as MindMap;
	const backToMarkdown = vi.fn();
	// 外观状态：apply* 真的改它，resolvePreference 真的读它——这样「点击后图标跟着变」才可断言
	const appearance = {
		layout: options.layout ?? 'logicalStructure',
		lineStyle: options.lineStyle ?? 'straight',
		themeStyle: options.themeStyle ?? 'default',
		palette: 'default',
	};
	const applyLineStyle = vi.fn((value: string) => {
		appearance.lineStyle = value;
	});
	const applyThemeStyle = vi.fn((value: string) => {
		appearance.themeStyle = value;
	});
	const view = {
		toolbarEl:
			options.withToolbar === false
				? null
				: (toolbarEl as unknown as HTMLElement),
		lang: 'zh',
		mindMap,
		backToMarkdown,
		applyLineStyle,
		applyThemeStyle,
		resolvePreference: (key: keyof typeof appearance): string => appearance[key],
		plugin: {
			settings: { defaultLayout: 'mindMap', defaultLineStyle: 'straight' },
		},
	} as unknown as MindMapViewContext;
	return {
		view,
		toolbarEl,
		mindMap,
		execCommand,
		backToMarkdown,
		applyLineStyle,
		applyThemeStyle,
		setLayout: (layout: string): void => {
			appearance.layout = layout;
		},
	};
}

/** 右缘图标栈（.mindmap-hud--rail） */
function railOf(toolbarEl: FakeEl): FakeEl {
	const rail = toolbarEl.children.find((child) =>
		child.classes.includes('mindmap-hud--rail'),
	);
	if (!rail) {
		throw new Error('未找到右缘图标栈 .mindmap-hud--rail');
	}
	return rail;
}

/** 第 n 组（自上而下，从 0 起） */
function groupOf(rail: FakeEl, index: number): FakeEl {
	const group = rail.children[index];
	if (!group) {
		throw new Error(`未找到第 ${index} 组`);
	}
	return group;
}

function buttonsOf(group: FakeEl): FakeEl[] {
	return group.children.filter((child) => child.tag === 'button');
}

/** 按 tooltip 取按钮（官方 setTooltip 写入 aria-label） */
function buttonByTooltip(group: FakeEl, tooltip: string): FakeEl {
	const button = buttonsOf(group).find(
		(child) => child.attr['aria-label'] === tooltip,
	);
	if (!button) {
		throw new Error(`未找到按钮：${tooltip}`);
	}
	return button;
}

/** 触发按钮 onclick（未接线即失败） */
function clickButton(button: FakeEl): void {
	const handler = button.onclick;
	if (!handler) {
		throw new Error(`按钮未接线 onclick：${button.attr['aria-label'] ?? ''}`);
	}
	handler();
}

beforeEach(() => {
	vi.resetAllMocks();
	siblingMocks.exportImage.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('buildToolbar（右缘四组结构）', () => {
	it('toolbarEl 缺失：静默返回（不建 DOM、不设图标）', () => {
		const h = makeView({ withToolbar: false });
		expect(() => buildToolbar(h.view)).not.toThrow();
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('只有一个根：右缘图标栈；栈内恰好四组', () => {
		const h = makeView();
		buildToolbar(h.view);

		expect(h.toolbarEl.children).toHaveLength(1);
		const rail = railOf(h.toolbarEl);
		expect(rail.children).toHaveLength(4);
		for (const group of rail.children) {
			expect(group.classes).toContain('mindmap-hud-group');
		}
	});

	it('组 1 文档：返回 Markdown → 导出图片', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 0);

		expect(buttonsOf(group).map((b) => b.attr['aria-label'])).toEqual([
			t('zh', 'toolbar.backToMarkdown'),
			t('zh', 'toolbar.exportImage'),
		]);
		expect(setIconMock.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([
			'file-text',
			'image',
		]);
	});

	it('组 2 外观：边框 / 连线（只有图标，图标＝当前状态）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 1);

		expect(buttonsOf(group)).toHaveLength(2);
		// 屏上不摆文字：按钮内除 svg（setIcon 已 mock，不产生子元素）外无内容
		expect(buttonsOf(group).every((b) => b.children.length === 0)).toBe(true);
		// 图标随状态：有边框 square / 折线 route
		expect(setIconMock.mock.calls.slice(2, 4).map((call) => call[1])).toEqual([
			'square',
			'slash',
		]);
	});

	it('组 3 视图：放大 → 重置缩放 → 总览全局 → 整理 → 缩小（对齐 Canvas 右栏）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 2);

		expect(buttonsOf(group).map((b) => b.attr['aria-label'])).toEqual([
			t('zh', 'toolbar.zoomIn'),
			t('zh', 'toolbar.resetZoom'),
			t('zh', 'toolbar.tipFit'),
			t('zh', 'toolbar.tipArrange'),
			t('zh', 'toolbar.zoomOut'),
		]);
		// 整理夹在「总览」与「缩小」之间（用户 2026-10-23 指定），图标与右键菜单的
		// 「自动整理」同枚 `sparkles`——同一动作不换图标
		expect(setIconMock.mock.calls.slice(4, 9).map((call) => call[1])).toEqual([
			'zoom-in',
			'rotate-ccw',
			'maximize',
			'sparkles',
			'zoom-out',
		]);
	});

	it('组 4 历史：撤销 → 重做', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 3);

		expect(buttonsOf(group).map((b) => b.attr['aria-label'])).toEqual([
			t('zh', 'toolbar.undo'),
			t('zh', 'toolbar.redo'),
		]);
		expect(setIconMock.mock.calls.slice(9).map((call) => call[1])).toEqual([
			'undo',
			'redo',
		]);
	});

	it('屏上只有 11 个按钮；外观下拉与节点级动作**都不在屏上**', () => {
		const h = makeView();
		buildToolbar(h.view);
		const labels = railOf(h.toolbarEl).children.flatMap((group) =>
			buttonsOf(group).map((button) => button.attr['aria-label']),
		);

		expect(labels).toHaveLength(11);
		// 布局 / 配色只在右键菜单（view-context-menu）；连线 / 边框是屏上开关
		expect(labels).not.toContain(t('zh', 'toolbar.layout'));
		expect(labels).not.toContain(t('zh', 'toolbar.palette'));
		expect(labels).toContain(t('zh', 'toolbar.lineStyle'));
		expect(labels).toContain(t('zh', 'toolbar.themeStyle'));
		// 节点级动作：一直在右键菜单，屏上不重复
		expect(labels).not.toContain(t('zh', 'toolbar.addChild'));
		expect(labels).not.toContain(t('zh', 'toolbar.deleteNode'));
		expect(labels).not.toContain(t('zh', 'toolbar.insertLink'));
		expect(labels).not.toContain(t('zh', 'toolbar.insertImage'));
	});

	it('tooltip 统一落在左侧（对齐 Canvas 的 data-tooltip-position="left"）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const buttons = railOf(h.toolbarEl).children.flatMap((group) =>
			buttonsOf(group),
		);

		expect(buttons).toHaveLength(11);
		expect(
			buttons.every(
				(button) => button.attr['data-tooltip-position'] === 'left',
			),
		).toBe(true);
	});

	it('切换状态后 tooltip 仍在左侧（syncState 回写也要带落位）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const border = buttonByTooltip(
			groupOf(railOf(h.toolbarEl), 1),
			t('zh', 'toolbar.themeStyle'),
		);

		clickButton(border);

		// 桩在「省略落位」时会清掉旧值（模拟官方按本次调用定位）：漏传即 undefined
		expect(border.attr['data-tooltip-position']).toBe('left');
	});
});

describe('buildToolbar（按钮动作接线）', () => {
	it('文档组：返回委托视图，导出走 exportImage', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 0);

		clickButton(buttonByTooltip(group, t('zh', 'toolbar.backToMarkdown')));
		clickButton(buttonByTooltip(group, t('zh', 'toolbar.exportImage')));
		expect(h.backToMarkdown).toHaveBeenCalledTimes(1);
		expect(siblingMocks.exportImage).toHaveBeenCalledWith(h.view);
	});

	it('视图组：放大/重置/总览/整理/缩小 各走自己的收口函数', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 2);

		clickButton(buttonByTooltip(group, t('zh', 'toolbar.zoomIn')));
		clickButton(buttonByTooltip(group, t('zh', 'toolbar.resetZoom')));
		clickButton(buttonByTooltip(group, t('zh', 'toolbar.tipFit')));
		// 整理复用右键菜单那条 `arrangeMindMap`（同一动作只有一个实现）：受理 ⇒ 提示 done
		engineMocks.arrangeMindMap.mockReturnValueOnce(true);
		clickButton(buttonByTooltip(group, t('zh', 'toolbar.tipArrange')));
		clickButton(buttonByTooltip(group, t('zh', 'toolbar.zoomOut')));

		expect(engineMocks.zoomInMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(engineMocks.resetZoom).toHaveBeenCalledWith(h.mindMap);
		expect(engineMocks.fitMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(engineMocks.arrangeMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.arrangeDone'));
		expect(engineMocks.zoomOutMindMap).toHaveBeenCalledWith(h.mindMap);
	});

	it('历史组：撤销/重做接 BACK / FORWARD 命令', () => {
		const h = makeView();
		buildToolbar(h.view);
		const group = groupOf(railOf(h.toolbarEl), 3);

		clickButton(buttonByTooltip(group, t('zh', 'toolbar.undo')));
		clickButton(buttonByTooltip(group, t('zh', 'toolbar.redo')));
		expect(h.execCommand.mock.calls.map((call) => call[0])).toEqual([
			'BACK',
			'FORWARD',
		]);
	});
});

describe('arrangeMindMap（自动整理分支）', () => {
	it('未加载引擎：提示 notLoaded，不调引擎', () => {
		const h = makeView();
		arrangeMindMap({ ...h.view, mindMap: null });
		expect(engineMocks.arrangeMindMap).not.toHaveBeenCalled();
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.notLoaded'));
	});

	it('引擎返回 true：提示 arrangeDone', () => {
		const h = makeView();
		engineMocks.arrangeMindMap.mockReturnValueOnce(true);
		arrangeMindMap(h.view);
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.arrangeDone'));
	});

	it('引擎返回 false：提示 arrangeFailed', () => {
		const h = makeView();
		engineMocks.arrangeMindMap.mockReturnValueOnce(false);
		arrangeMindMap(h.view);
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.arrangeFailed'));
	});
});

describe('外观开关（边框 / 连线：点一下切到另一个值）', () => {
	/** 组 2 里的两个开关按钮（组内顺序：边框 → 连线） */
	function toggles(h: Harness): { theme: FakeEl; line: FakeEl } {
		const group = groupOf(railOf(h.toolbarEl), 1);
		const rows = buttonsOf(group);
		expect(rows).toHaveLength(2);
		return { theme: rows[0]!, line: rows[1]! };
	}

	it('边框：有边框 → 点击写入 borderless，图标立刻换成虚线框', () => {
		const h = makeView({ themeStyle: 'default' });
		buildToolbar(h.view);
		const { theme } = toggles(h);

		clickButton(theme);
		expect(h.applyThemeStyle).toHaveBeenCalledWith('borderless');
		// 外观变更不重建工具栏 ⇒ 按钮必须自己同步图标（实机踩过：只改数据不改画面）
		expect(setIconMock.mock.calls.at(-1)?.[1]).toBe('square-dashed');
		expect(theme.attr['aria-label']).toBe(t('zh', 'toolbar.themeStyle'));
	});

	it('边框：无边框 → 点击切回 default', () => {
		const h = makeView({ themeStyle: 'borderless' });
		buildToolbar(h.view);

		clickButton(toggles(h).theme);
		expect(h.applyThemeStyle).toHaveBeenCalledWith('default');
	});

	it('连线：折线 → 点击切到 curve；曲线 → 切回 straight', () => {
		const zigzag = makeView({ lineStyle: 'straight' });
		buildToolbar(zigzag.view);
		clickButton(toggles(zigzag).line);
		expect(zigzag.applyLineStyle).toHaveBeenCalledWith('curve');

		const curved = makeView({ lineStyle: 'curve' });
		buildToolbar(curved.view);
		clickButton(toggles(curved).line);
		expect(curved.applyLineStyle).toHaveBeenCalledWith('straight');
	});

	it('固定直线布局：连线开关置灰，点击不触发任何写入', () => {
		const h = makeView({ layout: 'timeline', lineStyle: 'straight' });
		buildToolbar(h.view);
		const { line } = toggles(h);

		expect(line.classes).toContain('is-disabled');
		expect(line.attr['aria-label']).toBe(t('zh', 'toolbar.lineStyle'));
		// 没有 onclick ⇒ 点击不会改任何东西（不给假交互）
		expect(line.onclick).toBeNull();
		expect(h.applyLineStyle).not.toHaveBeenCalled();
	});

	it('悬停文案极简：只报名字，状态由图标表达', () => {
		const h = makeView({ themeStyle: 'borderless', lineStyle: 'curve' });
		buildToolbar(h.view);
		const { theme, line } = toggles(h);

		expect(theme.attr['aria-label']).toBe(t('zh', 'toolbar.themeStyle'));
		expect(line.attr['aria-label']).toBe(t('zh', 'toolbar.lineStyle'));
	});
});

describe('连线开关的可用态同步时机（2026-10-23 修复）', () => {
	/** 组 2 的连线按钮（组内顺序：边框 → 连线） */
	function lineButton(h: Harness): FakeEl {
		const button = buttonsOf(groupOf(railOf(h.toolbarEl), 1))[1];
		if (!button) {
			throw new Error('组 2 缺少连线按钮');
		}
		return button;
	}

	it('建栏早于文件加载（只有全局默认布局）：重建后置灰态双向跟随新布局', () => {
		// onOpen 建栏时 resolvePreference('layout') 只能拿到 settings.defaultLayout
		const h = makeView({ layout: 'timeline', lineStyle: 'straight' });
		buildToolbar(h.view);
		expect(lineButton(h).classes).toContain('is-disabled');
		expect(lineButton(h).onclick).toBeNull();

		// 文件 viewState 到位（逻辑结构图）→ onEngineReady 后重建，开关恢复可点
		h.setLayout('logicalStructure');
		refreshToolbar(h.view);
		expect(lineButton(h).classes).not.toContain('is-disabled');
		clickButton(lineButton(h));
		expect(h.applyLineStyle).toHaveBeenCalledWith('curve');

		// 菜单切到固定直线布局 → applyLayout 后重建，必须重新置灰（不给假交互）
		h.setLayout('timeline');
		refreshToolbar(h.view);
		expect(lineButton(h).classes).toContain('is-disabled');
		expect(lineButton(h).onclick).toBeNull();
	});
});

describe('refreshToolbar（设置变更后重建）', () => {
	it('清空后重建：仍是四组、11 个按钮', () => {
		const h = makeView();
		buildToolbar(h.view);
		refreshToolbar(h.view);

		expect(h.toolbarEl.emptyCount).toBe(1);
		expect(h.toolbarEl.children).toHaveLength(1);
		const rail = railOf(h.toolbarEl);
		expect(rail.children).toHaveLength(4);
		expect(
			rail.children.flatMap((group) => buttonsOf(group)),
		).toHaveLength(11);
	});

	it('语言变更后重建：按钮 tooltip 用新语言（构建期 t(lang) 决定）', () => {
		const h = makeView();
		buildToolbar(h.view);
		refreshToolbar({ ...h.view, lang: 'en' } as unknown as MindMapViewContext);

		const first = groupOf(railOf(h.toolbarEl), 0);
		expect(buttonsOf(first)[0]?.attr['aria-label']).toBe(
			t('en', 'toolbar.backToMarkdown'),
		);
	});
});

describe('工具栏按钮的图标接线', () => {
	it('每个按钮各自收到自己的图标元素（不共用同一容器）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const buttons = railOf(h.toolbarEl).children.flatMap((group) =>
			buttonsOf(group),
		);

		expect(buttons).toHaveLength(11);
		expect(setIconMock).toHaveBeenCalledTimes(buttons.length);
		const parents = new Set(setIconMock.mock.calls.map((call) => call[0]));
		expect(parents.size).toBe(buttons.length);
	});
});
