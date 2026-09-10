/**
 * view-toolbar 回归测试：工具栏按钮装配、命令接线与布局选择器。
 *
 * 覆盖：
 * - 分组结构与按钮顺序（左：编辑/插入；中：布局；右：画布/导入导出），
 *   右侧顺序为「重置缩放 → 适应画布 → 放大 → 缩小 → 导出 PNG」；
 * - 每个按钮的 onclick 真的接到了对应动作上（引擎命令常量、节点操作、
 *   搜索栏、导出、缩放收口函数），并用 aria-label 校验无障碍标签；
 * - md 文档模式（.mindmap.md）多出「切换回 Markdown」入口 + 分隔符；
 * - 布局选择器：六项布局、初始值取设置里的 defaultLayout、变更走 applyLayout；
 * - arrangeMindMap 的三种分支（未加载 / 整理成功 / 整理失败）提示文案；
 * - refreshToolbar 清空后重建。
 *
 * 隔离策略：引擎面（../src/mindmap）、同级特性模块（view-search / view-export /
 * view-node-actions）与 obsidian 的 setIcon、Notice 全部用 vi.mock 替换——
 * 本测试只验证工具栏自身的装配与接线，不触碰 vendor bundle（避免加载引擎）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import { LAYOUT_OPTIONS } from '../src/constants';
import { t } from '../src/i18n';
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
}));

const siblingMocks = vi.hoisted(() => ({
	openSearchBar: vi.fn<(view: unknown) => void>(),
	exportPNG: vi.fn<(view: unknown) => Promise<void>>(),
	addLinkToActiveNode: vi.fn<(view: unknown) => Promise<void>>(),
	addImageToActiveNode: vi.fn<(view: unknown) => Promise<void>>(),
	deleteActiveNode: vi.fn<(view: unknown) => void>(),
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

vi.mock('../src/mindmap', () => ({
	// ENGINE_COMMANDS 是常量表：保留真实值才能断言「命令名真的用对了」
	ENGINE_COMMANDS: {
		BACK: 'BACK',
		FORWARD: 'FORWARD',
		INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
		INSERT_NODE: 'INSERT_NODE',
		REMOVE_NODE: 'REMOVE_NODE',
		RESET_LAYOUT: 'RESET_LAYOUT',
		SET_NODE_DATA: 'SET_NODE_DATA',
		SET_NODE_HYPERLINK: 'SET_NODE_HYPERLINK',
		SET_NODE_IMAGE: 'SET_NODE_IMAGE',
	},
	arrangeMindMap: engineMocks.arrangeMindMap,
	fitMindMap: engineMocks.fitMindMap,
	resetZoom: engineMocks.resetZoom,
	zoomInMindMap: engineMocks.zoomInMindMap,
	zoomOutMindMap: engineMocks.zoomOutMindMap,
}));

vi.mock('../src/features/view-search', () => ({
	openSearchBar: siblingMocks.openSearchBar,
}));

vi.mock('../src/features/view-export', () => ({
	exportPNG: siblingMocks.exportPNG,
}));

vi.mock('../src/features/view-node-actions', () => ({
	addImageToActiveNode: siblingMocks.addImageToActiveNode,
	addLinkToActiveNode: siblingMocks.addLinkToActiveNode,
	deleteActiveNode: siblingMocks.deleteActiveNode,
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

	/** 当前文本（末次 setText） */
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

	/** 模块按 Obsidian 真实签名调用 createSpan('mindmap-toolbar-label') */
	createSpan(cls?: string): FakeEl {
		const child = new FakeEl('span', cls === undefined ? {} : { cls });
		this.children.push(child);
		return child;
	}

	setText(text: string): void {
		this.texts.push(text);
	}

	empty(): void {
		this.emptyCount += 1;
		this.children.length = 0;
	}
}

/** 引擎 execCommand 的 spy：显式标注参数类型，避免 mock.calls 退化成 any */
type ExecCommandMock = ReturnType<
	typeof vi.fn<(command: string, ...args: unknown[]) => void>
>;

interface Harness {
	readonly view: MindMapViewContext;
	readonly toolbarEl: FakeEl;
	readonly mindMap: MindMap;
	readonly execCommand: ExecCommandMock;
	readonly applyLayout: ReturnType<typeof vi.fn>;
	readonly backToMarkdown: ReturnType<typeof vi.fn>;
}

/** 构造视图桩（每次新建：工具栏在 toolbarEl 上建 DOM，语言/文档模式可配） */
function makeView(
	options: { isMdDocument?: boolean; withToolbar?: boolean } = {},
): Harness {
	const toolbarEl = new FakeEl('div');
	const execCommand = vi.fn<(command: string, ...args: unknown[]) => void>();
	const applyLayout = vi.fn();
	const backToMarkdown = vi.fn();
	const mindMap = { execCommand } as unknown as MindMap;
	const view = {
		toolbarEl:
			options.withToolbar === false ? null : (toolbarEl as unknown as HTMLElement),
		lang: 'zh',
		mindMap,
		isMdDocument: () => options.isMdDocument === true,
		backToMarkdown,
		applyLayout,
		plugin: { settings: { defaultLayout: 'mindMap' } },
	} as unknown as MindMapViewContext;
	return { view, toolbarEl, mindMap, execCommand, applyLayout, backToMarkdown };
}

/** 按类名取分组（左 / 中 / 右） */
function groupOf(toolbarEl: FakeEl, marker: string): FakeEl {
	const group = toolbarEl.children.find((child) =>
		child.classes.includes(marker),
	);
	if (!group) {
		throw new Error(`未找到工具栏分组 ${marker}`);
	}
	return group;
}

function buttonsOf(group: FakeEl): FakeEl[] {
	return group.children.filter((child) => child.tag === 'button');
}

/** 按 tooltip 取按钮；缺失即失败（按钮未装配或文案变了） */
function buttonByTitle(group: FakeEl, title: string): FakeEl {
	const button = buttonsOf(group).find(
		(child) => child.attr['title'] === title,
	);
	if (!button) {
		throw new Error(`未找到按钮：${title}`);
	}
	return button;
}

/** 触发按钮 onclick（未接线即失败） */
function clickButton(button: FakeEl): void {
	const handler = button.onclick;
	if (!handler) {
		throw new Error(`按钮未接线 onclick：${button.attr['title'] ?? ''}`);
	}
	handler();
}

beforeEach(() => {
	vi.resetAllMocks();
	siblingMocks.exportPNG.mockResolvedValue(undefined);
	siblingMocks.addLinkToActiveNode.mockResolvedValue(undefined);
	siblingMocks.addImageToActiveNode.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('buildToolbar（装配与分组结构）', () => {
	it('toolbarEl 缺失：静默返回（不建 DOM、不设图标）', () => {
		const h = makeView({ withToolbar: false });
		expect(() => buildToolbar(h.view)).not.toThrow();
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('左侧按钮序列（含两个分隔符）：编辑/插入组', () => {
		const h = makeView();
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		// 结构：按钮×3 → 分隔符 → 按钮×3 → 分隔符 → 按钮×3（非 md 文档模式）
		expect(left.children.map((child) => child.tag)).toEqual([
			'button',
			'button',
			'button',
			'div',
			'button',
			'button',
			'button',
			'div',
			'button',
			'button',
			'button',
		]);
		expect(
			buttonsOf(left).map((button) => button.attr['title']),
		).toEqual([
			t('zh', 'toolbar.addChild'),
			t('zh', 'toolbar.addSibling'),
			t('zh', 'toolbar.deleteNode'),
			t('zh', 'toolbar.undo'),
			t('zh', 'toolbar.redo'),
			t('zh', 'toolbar.arrange'),
			t('zh', 'toolbar.search'),
			t('zh', 'toolbar.insertLink'),
			t('zh', 'toolbar.insertImage'),
		]);
		// 每个按钮都有 aria-label，且与 tooltip 一致（无障碍）
		expect(
			buttonsOf(left).every(
				(button) => button.attr['aria-label'] === button.attr['title'],
			),
		).toBe(true);
		// 图标按按钮顺序接线（左组先于中/右组构建，故取前 9 次 setIcon 调用）
		expect(setIconMock.mock.calls.slice(0, 9).map((call) => call[1])).toEqual([
			'plus',
			'circle-plus',
			'trash-2',
			'undo',
			'redo',
			'sparkles',
			'search',
			'link',
			'image',
		]);
	});

	it('md 文档模式：最前面多出「切换回 Markdown」按钮 + 分隔符', () => {
		const h = makeView({ isMdDocument: true });
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		expect(left.children.map((child) => child.tag)).toEqual([
			'button',
			'div',
			'button',
			'button',
			'button',
			'div',
			'button',
			'button',
			'button',
			'div',
			'button',
			'button',
			'button',
		]);
		const backButton = buttonByTitle(left, t('zh', 'toolbar.backToMarkdown'));
		clickButton(backButton);
		expect(h.backToMarkdown).toHaveBeenCalledTimes(1);
	});

	it('非 md 文档模式：不出现「切换回 Markdown」按钮', () => {
		const h = makeView();
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		expect(
			buttonsOf(left).some(
				(button) => button.attr['title'] === t('zh', 'toolbar.backToMarkdown'),
			),
		).toBe(false);
		expect(h.backToMarkdown).not.toHaveBeenCalled();
	});
});

describe('buildToolbar（左侧按钮的动作接线）', () => {
	it('节点增删：添加子节点/同级节点走引擎命令，删除委托 view-node-actions', () => {
		const h = makeView();
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		clickButton(buttonByTitle(left, t('zh', 'toolbar.addChild')));
		clickButton(buttonByTitle(left, t('zh', 'toolbar.addSibling')));
		clickButton(buttonByTitle(left, t('zh', 'toolbar.deleteNode')));

		expect(h.execCommand.mock.calls.map((call) => call[0])).toEqual([
			'INSERT_CHILD_NODE',
			'INSERT_NODE',
		]);
		// 删除走节点操作编排（含中心节点兜底提示），不直接 execCommand
		expect(siblingMocks.deleteActiveNode).toHaveBeenCalledWith(h.view);
	});

	it('撤销/重做：接 BACK / FORWARD 命令', () => {
		const h = makeView();
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		clickButton(buttonByTitle(left, t('zh', 'toolbar.undo')));
		clickButton(buttonByTitle(left, t('zh', 'toolbar.redo')));

		expect(h.execCommand.mock.calls.map((call) => call[0])).toEqual([
			'BACK',
			'FORWARD',
		]);
	});

	it('搜索 / 链接 / 图片：分别委托 openSearchBar、addLinkToActiveNode、addImageToActiveNode', () => {
		const h = makeView();
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		clickButton(buttonByTitle(left, t('zh', 'toolbar.search')));
		expect(siblingMocks.openSearchBar).toHaveBeenCalledWith(h.view);

		clickButton(buttonByTitle(left, t('zh', 'toolbar.insertLink')));
		expect(siblingMocks.addLinkToActiveNode).toHaveBeenCalledWith(h.view);

		clickButton(buttonByTitle(left, t('zh', 'toolbar.insertImage')));
		expect(siblingMocks.addImageToActiveNode).toHaveBeenCalledWith(h.view);
	});

	it('自动整理按钮：提示「已整理思维导图」（引擎返回 true）', () => {
		const h = makeView();
		engineMocks.arrangeMindMap.mockReturnValue(true);
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		clickButton(buttonByTitle(left, t('zh', 'toolbar.arrange')));

		expect(engineMocks.arrangeMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.arrangeDone'));
	});
});

describe('buildToolbar（右侧画布/导出按钮顺序与接线）', () => {
	it('顺序：重置缩放 → 适应画布 → 放大 → 缩小 → 分隔符 → 导出 PNG', () => {
		const h = makeView();
		buildToolbar(h.view);
		const right = groupOf(h.toolbarEl, 'mindmap-toolbar-right');

		expect(right.children.map((child) => child.tag)).toEqual([
			'button',
			'button',
			'button',
			'button',
			'div',
			'button',
		]);
		expect(buttonsOf(right).map((button) => button.attr['title'])).toEqual([
			t('zh', 'toolbar.resetZoom'),
			t('zh', 'command.fitCanvas'),
			t('zh', 'toolbar.zoomIn'),
			t('zh', 'toolbar.zoomOut'),
			t('zh', 'toolbar.exportPng'),
		]);
		// 右组最后构建：取末尾 5 次 setIcon 调用，验证顺序与按钮一一对应
		expect(setIconMock.mock.calls.slice(-5).map((call) => call[1])).toEqual([
			'rotate-ccw',
			'maximize',
			'zoom-in',
			'zoom-out',
			'image',
		]);
	});

	it('重置缩放 → resetZoom(mindMap)（以画布中心为锚点回到 100%）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const right = groupOf(h.toolbarEl, 'mindmap-toolbar-right');

		clickButton(buttonByTitle(right, t('zh', 'toolbar.resetZoom')));

		expect(engineMocks.resetZoom).toHaveBeenCalledTimes(1);
		expect(engineMocks.resetZoom).toHaveBeenCalledWith(h.mindMap);
	});

	it('适应画布 / 放大 / 缩小 → fitMindMap / zoomInMindMap / zoomOutMindMap', () => {
		const h = makeView();
		buildToolbar(h.view);
		const right = groupOf(h.toolbarEl, 'mindmap-toolbar-right');

		clickButton(buttonByTitle(right, t('zh', 'command.fitCanvas')));
		clickButton(buttonByTitle(right, t('zh', 'toolbar.zoomIn')));
		clickButton(buttonByTitle(right, t('zh', 'toolbar.zoomOut')));

		expect(engineMocks.fitMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(engineMocks.zoomInMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(engineMocks.zoomOutMindMap).toHaveBeenCalledWith(h.mindMap);
		// 三者互不串线
		expect(engineMocks.fitMindMap).toHaveBeenCalledTimes(1);
		expect(engineMocks.resetZoom).not.toHaveBeenCalled();
	});

	it('导出 PNG → exportPNG(view)', () => {
		const h = makeView();
		buildToolbar(h.view);
		const right = groupOf(h.toolbarEl, 'mindmap-toolbar-right');

		clickButton(buttonByTitle(right, t('zh', 'toolbar.exportPng')));

		expect(siblingMocks.exportPNG).toHaveBeenCalledWith(h.view);
	});
});

describe('buildToolbar（布局选择器）', () => {
	it('居中分组：标签文案 + select 类名 + 六项布局（值与文案对应 LAYOUT_OPTIONS）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const center = groupOf(h.toolbarEl, 'mindmap-toolbar-center');

		const label = center.children.find((child) => child.tag === 'span');
		expect(label?.text).toBe(t('zh', 'toolbar.layout'));

		const select = h.view.layoutSelect;
		expect(select).not.toBeNull();
		expect((select as unknown as FakeEl).classes).toEqual([
			'mindmap-layout-select',
		]);

		const options = (select as unknown as FakeEl).children.filter(
			(child) => child.tag === 'option',
		);
		expect(options).toHaveLength(LAYOUT_OPTIONS.length);
		expect(options.map((option) => option.value)).toEqual(
			LAYOUT_OPTIONS.map((option) => option.value),
		);
		expect(options.map((option) => option.text)).toEqual(
			LAYOUT_OPTIONS.map((option) => t('zh', option.label)),
		);
	});

	it('初始值取插件设置 defaultLayout，变更时调 applyLayout(当前值)', () => {
		const h = makeView();
		buildToolbar(h.view);
		const select = h.view.layoutSelect as unknown as FakeEl;

		expect(select.value).toBe('mindMap'); // plugin.settings.defaultLayout
		expect(select.onchange).toBeTypeOf('function');

		select.value = 'fishbone';
		select.onchange?.();
		expect(h.applyLayout).toHaveBeenCalledWith('fishbone');
		expect(h.applyLayout).toHaveBeenCalledTimes(1);
	});
});

describe('arrangeMindMap（自动整理分支）', () => {
	it('引擎未加载：提示「思维导图尚未加载」，不调引擎整理', () => {
		const h = makeView();
		const bare = { ...h.view, mindMap: null } as unknown as MindMapViewContext;

		arrangeMindMap(bare);

		expect(engineMocks.arrangeMindMap).not.toHaveBeenCalled();
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.notLoaded'));
	});

	it('引擎整理成功：提示「已整理思维导图」', () => {
		const h = makeView();
		engineMocks.arrangeMindMap.mockReturnValue(true);

		arrangeMindMap(h.view);

		expect(engineMocks.arrangeMindMap).toHaveBeenCalledWith(h.mindMap);
		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.arrangeDone'));
	});

	it('引擎整理失败：提示「无法整理思维导图」', () => {
		const h = makeView();
		engineMocks.arrangeMindMap.mockReturnValue(false);

		arrangeMindMap(h.view);

		expect(noticeMock).toHaveBeenCalledWith(t('zh', 'common.arrangeFailed'));
	});
});

describe('refreshToolbar（设置变更后重建）', () => {
	it('清空后按新设置重建（子元素数量与首次构建一致）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const builtCount = h.toolbarEl.children.length;
		expect(builtCount).toBe(3); // 左 / 中 / 右三个分组
		const firstCallIcons = setIconMock.mock.calls.length;

		refreshToolbar(h.view);

		expect(h.toolbarEl.emptyCount).toBe(1);
		expect(h.toolbarEl.children).toHaveLength(builtCount);
		// 重建即重新接线图标（未复用旧按钮）
		expect(setIconMock.mock.calls.length).toBe(firstCallIcons * 2);
		// 新按钮仍可用：重置缩放仍接到 resetZoom
		const right = groupOf(h.toolbarEl, 'mindmap-toolbar-right');
		clickButton(buttonByTitle(right, t('zh', 'toolbar.resetZoom')));
		expect(engineMocks.resetZoom).toHaveBeenCalledWith(h.mindMap);
	});

	it('toolbarEl 缺失：静默返回（不抛异常）', () => {
		const h = makeView({ withToolbar: false });
		expect(() => refreshToolbar(h.view)).not.toThrow();
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('语言变更后重建：按钮 tooltip 用新语言（由构建期 t(lang) 决定）', () => {
		const h = makeView();
		buildToolbar(h.view);
		(h.view as unknown as { lang: string }).lang = 'en';

		refreshToolbar(h.view);

		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');
		expect(
			buttonsOf(left).map((button) => button.attr['title']),
		).toEqual([
			t('en', 'toolbar.addChild'),
			t('en', 'toolbar.addSibling'),
			t('en', 'toolbar.deleteNode'),
			t('en', 'toolbar.undo'),
			t('en', 'toolbar.redo'),
			t('en', 'toolbar.arrange'),
			t('en', 'toolbar.search'),
			t('en', 'toolbar.insertLink'),
			t('en', 'toolbar.insertImage'),
		]);
	});
});

describe('工具栏按钮的图标接线', () => {
	it('每个按钮各自收到自己的图标元素（不共用同一容器）', () => {
		const h = makeView();
		buildToolbar(h.view);
		const left = groupOf(h.toolbarEl, 'mindmap-toolbar-group');

		const leftIcons = setIconMock.mock.calls.slice(0, 9);
		expect(leftIcons.map((call) => call[0])).toEqual(buttonsOf(left));
	});
});
