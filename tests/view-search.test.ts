/**
 * view-search 回归测试：搜索栏 DOM 装配、防抖搜索、上下跳转（含回绕）、
 * 计数显示与开关栏行为。
 *
 * mindmap.ts 的搜索防腐收口函数以 stub 替换（本测试只验证 view-search
 * 自身的编排与 DOM 接线，不验证引擎封装）；obsidian 的 setIcon 换成 spy
 * 以断言按钮图标接线。Node 环境无 DOM，故用本地伪元素记录 addClass /
 * removeClass / setText / focus / 子元素，断言落在真实调用痕迹上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import { t, type Language } from '../src/i18n';
import {
	buildSearchBar,
	closeSearchBar,
	doSearch,
	openSearchBar,
	refreshSearchBarLabels,
	searchNext,
	searchPrev,
	updateSearchCount,
} from '../src/features/view-search';

/** view-search 的窄访问面（模块未导出类型，从函数签名取） */
type SearchViewContext = Parameters<typeof buildSearchBar>[0];

const searchMocks = vi.hoisted(() => ({
	endMindMapSearch: vi.fn<(mindMap: MindMap | null) => void>(),
	getSearchCurrentIndex: vi.fn<(mindMap: MindMap | null) => number>(),
	getSearchMatchCount: vi.fn<(mindMap: MindMap | null) => number>(),
	jumpToSearchIndex: vi.fn<
		(mindMap: MindMap | null, index: number, callback?: () => void) => void
	>(),
	searchMindMap: vi.fn<
		(mindMap: MindMap | null, keyword: string, callback?: () => void) => void
	>(),
	searchNextInMindMap: vi.fn<
		(mindMap: MindMap | null, callback?: () => void) => void
	>(),
}));

const setIconMock = vi.hoisted(() =>
	vi.fn<(parent: unknown, iconId: string) => void>(),
);

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		// mock 中 setIcon 本是空实现：换成 spy 以断言按钮图标接线
		setIcon: setIconMock,
	};
});

vi.mock('../src/mindmap', () => ({
	endMindMapSearch: searchMocks.endMindMapSearch,
	getSearchCurrentIndex: searchMocks.getSearchCurrentIndex,
	getSearchMatchCount: searchMocks.getSearchMatchCount,
	jumpToSearchIndex: searchMocks.jumpToSearchIndex,
	searchMindMap: searchMocks.searchMindMap,
	searchNextInMindMap: searchMocks.searchNextInMindMap,
}));

/** 伪键盘事件（keydown 分流所需最小面） */
interface FakeKeyEvent {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly preventDefault: () => void;
}

/** viewEvents.onDom 的注册痕迹 */
interface DomRecord {
	readonly target: unknown;
	readonly type: string;
	readonly listener: (event: FakeKeyEvent) => void;
}

interface FakeElInit {
	readonly cls?: string;
	readonly attr?: Record<string, string>;
}

/**
 * 伪 DOM 元素：只实现 view-search 用到的最小面（createEl/createSpan/
 * addClass/removeClass/setText/focus/value/onclick/addEventListener），
 * 并把每次调用记进数组，供断言「真实行为」而非 mock 行为。
 */
class FakeEl {
	readonly tag: string;
	readonly cls: string;
	readonly attr: Record<string, string>;
	readonly children: FakeEl[] = [];
	readonly addedClasses: string[] = [];
	readonly removedClasses: string[] = [];
	/** setText 调用序列（末项即当前文本） */
	readonly texts: string[] = [];
	readonly domListeners: { type: string; listener: unknown }[] = [];
	value = '';
	onclick: (() => void) | null = null;
	focusCount = 0;

	constructor(tag: string, init: FakeElInit = {}) {
		this.tag = tag;
		this.cls = init.cls ?? '';
		this.attr = init.attr ?? {};
	}

	/** 当前文本（末次 setText） */
	get text(): string {
		return this.texts[this.texts.length - 1] ?? '';
	}

	createEl(tag: string, init: FakeElInit = {}): FakeEl {
		const child = new FakeEl(tag, init);
		this.children.push(child);
		return child;
	}

	createSpan(cls: string): FakeEl {
		// 模块按 Obsidian 真实签名调用 createSpan('mindmap-search-count')
		const child = new FakeEl('span', { cls });
		this.children.push(child);
		return child;
	}

	addClass(cls: string): void {
		this.addedClasses.push(cls);
	}

	removeClass(cls: string): void {
		this.removedClasses.push(cls);
	}

	setText(text: string): void {
		this.texts.push(text);
	}

	setAttribute(name: string, value: string): void {
		this.attr[name] = value;
	}

	focus(): void {
		this.focusCount += 1;
	}

	addEventListener(type: string, listener: unknown): void {
		this.domListeners.push({ type, listener });
	}
}

interface Harness {
	readonly view: SearchViewContext;
	/** 搜索栏容器（buildSearchBar 在此建子元素） */
	readonly bar: FakeEl;
	readonly canvas: FakeEl;
	readonly mindMap: MindMap;
	readonly domRecords: DomRecord[];
}

/** 取第 index 项：越界直接失败，避免 noUncheckedIndexedAccess 下静默拿到 undefined */
function nth<T>(items: readonly T[], index: number): T {
	const value = items[index];
	if (value === undefined) {
		throw new Error(`伪 DOM 缺少下标 ${index} 的元素`);
	}
	return value;
}

/** 构造视图桩（viewEvents/engineEvents 用同一个记录型伪绑定器） */
function makeView(
	options: { withBar?: boolean; withMindMap?: boolean } = {},
): Harness {
	const bar = new FakeEl('div', { cls: 'mindmap-search-bar' });
	const canvas = new FakeEl('div', { cls: 'mindmap-canvas-container' });
	const mindMap = { engine: 'fake' } as unknown as MindMap;
	const domRecords: DomRecord[] = [];
	const binder = {
		onDom(target: unknown, type: string, listener: unknown): void {
			domRecords.push({
				target,
				type,
				listener: listener as (event: FakeKeyEvent) => void,
			});
		},
		onEngine(): void {
			// view-search 不注册引擎事件
		},
		destroy(): void {
			// 本测试不触发销毁
		},
	};
	const view = {
		canvasEl: canvas as unknown as HTMLElement,
		toolbarEl: null,
		searchBarEl:
			options.withBar === false ? null : (bar as unknown as HTMLElement),
		searchInput: null,
		searchCountEl: null,
		layoutSelect: null,
		mindMap: options.withMindMap === false ? null : mindMap,
		engineEvents: binder,
		viewEvents: binder,
		lang: 'zh',
	} as unknown as SearchViewContext;
	return { view, bar, canvas, mindMap, domRecords };
}

interface BuiltBar {
	readonly input: FakeEl;
	readonly count: FakeEl;
	readonly buttons: FakeEl[];
}

/** 构建搜索栏并取回伪 DOM 子元素（顺序：input → count → 三个按钮） */
function buildBar(h: Harness): BuiltBar {
	buildSearchBar(h.view);
	return {
		input: nth(
			h.bar.children.filter((child) => child.tag === 'input'),
			0,
		),
		count: nth(
			h.bar.children.filter((child) => child.tag === 'span'),
			0,
		),
		buttons: h.bar.children.filter((child) => child.tag === 'button'),
	};
}

/** 触发按钮 onclick（未接线即失败） */
function clickButton(button: FakeEl): void {
	const handler = button.onclick;
	if (!handler) {
		throw new Error('按钮未接线 onclick');
	}
	handler();
}

/** 触发输入框上注册的 keydown 监听 */
function fireKeydown(h: Harness, event: FakeKeyEvent): void {
	nth(
		h.domRecords.filter((record) => record.type === 'keydown'),
		0,
	).listener(event);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	searchMocks.getSearchMatchCount.mockReturnValue(0);
	searchMocks.getSearchCurrentIndex.mockReturnValue(0);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('buildSearchBar（搜索栏装配）', () => {
	it('searchBarEl 为 null：静默返回（不抛异常、不回填视图、不建图标）', () => {
		const h = makeView({ withBar: false });
		expect(() => buildSearchBar(h.view)).not.toThrow();
		expect(h.view.searchInput).toBeNull();
		expect(h.view.searchCountEl).toBeNull();
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('装配输入框 + 计数 + 三个按钮（占位符/标题/图标/初始 hidden 类）', () => {
		const h = makeView();
		const { input, count, buttons } = buildBar(h);

		// 构建即隐藏
		expect(h.bar.addedClasses).toEqual(['mindmap-search-bar-hidden']);
		expect(input.cls).toBe('mindmap-search-input');
		expect(input.attr).toEqual({
			type: 'text',
			placeholder: '搜索节点…',
			spellcheck: 'false',
		});
		expect(count.cls).toBe('mindmap-search-count');
		expect(buttons).toHaveLength(3);
		expect(buttons.map((button) => button.cls)).toEqual([
			'mindmap-search-btn',
			'mindmap-search-btn',
			'mindmap-search-btn',
		]);
		expect(buttons.map((button) => button.attr['title'])).toEqual([
			'上一个 (Shift+Enter)',
			'下一个 (Enter)',
			'关闭 (Escape)',
		]);
		// 图标按按钮顺序接线
		expect(setIconMock.mock.calls.map((call) => call[1])).toEqual([
			'chevron-up',
			'chevron-down',
			'x',
		]);
		expect(setIconMock.mock.calls.map((call) => call[0])).toEqual([
			nth(buttons, 0),
			nth(buttons, 1),
			nth(buttons, 2),
		]);
		// 引用回填（搜索逻辑依赖这两个字段）
		expect(h.view.searchInput).toBe(input as unknown as HTMLInputElement);
		expect(h.view.searchCountEl).toBe(count as unknown as HTMLElement);
	});

	it('经 viewEvents.onDom 在输入框上注册 input 与 keydown 监听', () => {
		const h = makeView();
		const { input } = buildBar(h);

		expect(h.domRecords.map((record) => record.type)).toEqual([
			'input',
			'keydown',
		]);
		expect(h.domRecords.map((record) => record.target)).toEqual([
			input,
			input,
		]);
		expect(
			h.domRecords.every((record) => typeof record.listener === 'function'),
		).toBe(true);
	});

	it('三个按钮 onclick 分别触发 上一个 / 下一个 / 关闭', () => {
		const h = makeView();
		const { input, buttons } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);

		// 上一个：currentIndex 2 → 1
		clickButton(nth(buttons, 0));
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledWith(
			h.mindMap,
			1,
			expect.any(Function),
		);

		// 下一个：委托引擎 searchNext
		clickButton(nth(buttons, 1));
		expect(searchMocks.searchNextInMindMap).toHaveBeenCalledWith(
			h.mindMap,
			expect.any(Function),
		);

		// 关闭：隐藏 + 清空输入 + 结束引擎搜索 + 聚焦画布
		input.value = '关键字';
		clickButton(nth(buttons, 2));
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(input.value).toBe('');
		expect(h.bar.addedClasses).toEqual([
			'mindmap-search-bar-hidden',
			'mindmap-search-bar-hidden',
		]);
		expect(h.canvas.focusCount).toBe(1);
	});

	it('keydown 的 Enter / Shift+Enter / Escape 分流', () => {
		const h = makeView();
		const { input } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(2);
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);

		// Enter：阻止默认行为并跳下一个
		const enterDefault = vi.fn();
		fireKeydown(h, { key: 'Enter', shiftKey: false, preventDefault: enterDefault });
		expect(enterDefault).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchNextInMindMap).toHaveBeenCalledWith(
			h.mindMap,
			expect.any(Function),
		);
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();

		// Shift+Enter：跳上一个（currentIndex 1 → 0）
		const shiftDefault = vi.fn();
		fireKeydown(h, { key: 'Enter', shiftKey: true, preventDefault: shiftDefault });
		expect(shiftDefault).toHaveBeenCalledTimes(1);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledWith(
			h.mindMap,
			0,
			expect.any(Function),
		);

		// Escape：关闭（不阻止默认行为）
		input.value = '残留';
		const escapeDefault = vi.fn();
		fireKeydown(h, { key: 'Escape', shiftKey: false, preventDefault: escapeDefault });
		expect(escapeDefault).not.toHaveBeenCalled();
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(input.value).toBe('');
	});
});

describe('doSearch（防抖搜索）', () => {
	it('连续调用只触发一次引擎搜索，关键词已 trim，完成后回调刷新计数', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		input.value = '  目标  ';

		doSearch(h.view);
		doSearch(h.view);
		doSearch(h.view);
		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();

		// 防抖窗口 180ms：未到期不搜
		vi.advanceTimersByTime(179);
		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchMindMap).toHaveBeenCalledWith(
			h.mindMap,
			'目标',
			expect.any(Function),
		);

		// 引擎搜索完成 → 计数刷新
		searchMocks.getSearchMatchCount.mockReturnValue(5);
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);
		const done = nth(searchMocks.searchMindMap.mock.calls, 0)[2];
		expect(done).toBeTypeOf('function');
		done?.();
		expect(count.text).toBe('2/5');
	});

	it('空白关键词（防抖到期后）结束引擎搜索并清空计数', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		count.setText('1/2');
		input.value = '   \t ';

		doSearch(h.view);
		vi.advanceTimersByTime(180);

		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(count.texts).toEqual(['1/2', '']);
	});
});

describe('searchPrev（回绕跳转）', () => {
	it('无引擎直接返回；无匹配不跳转；首项回绕末项、末项回退一项', () => {
		const h = makeView();
		const { count } = buildBar(h);

		// mindMap 为 null：不查匹配数、不跳转
		const bare = makeView({ withMindMap: false });
		searchPrev(bare.view);
		expect(searchMocks.getSearchMatchCount).not.toHaveBeenCalled();
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();

		// 0 匹配：不跳转
		searchMocks.getSearchMatchCount.mockReturnValue(0);
		searchPrev(h.view);
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();

		// currentIndex 0 → 回绕到末项（matches - 1 = 2）
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(0);
		searchPrev(h.view);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenLastCalledWith(
			h.mindMap,
			2,
			expect.any(Function),
		);

		// currentIndex 2 → 1
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);
		searchPrev(h.view);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenLastCalledWith(
			h.mindMap,
			1,
			expect.any(Function),
		);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledTimes(2);

		// 跳转完成回调 → 计数刷新
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);
		const done = nth(searchMocks.jumpToSearchIndex.mock.calls, 1)[2];
		expect(done).toBeTypeOf('function');
		done?.();
		expect(count.text).toBe('2/3');
	});
});

describe('searchNext（委托引擎）', () => {
	it('委托 searchNextInMindMap 并透传计数回调', () => {
		const h = makeView();
		const { count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(4);
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);

		searchNext(h.view);
		expect(searchMocks.searchNextInMindMap).toHaveBeenCalledWith(
			h.mindMap,
			expect.any(Function),
		);

		const done = nth(searchMocks.searchNextInMindMap.mock.calls, 0)[1];
		expect(done).toBeTypeOf('function');
		done?.();
		expect(count.text).toBe('3/4');
	});
});

describe('updateSearchCount（计数显示）', () => {
	it('0 匹配：显示「无匹配」并加 mindmap-search-no-result 类', () => {
		const h = makeView();
		const { count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(0);
		searchMocks.getSearchCurrentIndex.mockReturnValue(0);

		updateSearchCount(h.view);
		expect(count.texts).toEqual(['没有匹配的节点']);
		expect(count.addedClasses).toEqual(['mindmap-search-no-result']);
		expect(count.removedClasses).toEqual([]);
	});

	it('有匹配：显示 当前/总数 并移除 mindmap-search-no-result 类', () => {
		const h = makeView();
		const { count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(5);
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);

		updateSearchCount(h.view);
		expect(count.texts).toEqual(['3/5']);
		expect(count.removedClasses).toEqual(['mindmap-search-no-result']);
		expect(count.addedClasses).toEqual([]);
	});

	it('无计数元素（未装配搜索栏）：静默返回', () => {
		const bare = makeView();
		expect(() => updateSearchCount(bare.view)).not.toThrow();
		expect(searchMocks.getSearchMatchCount).not.toHaveBeenCalled();
	});
});

describe('closeSearchBar（关闭搜索栏）', () => {
	it('取消未决防抖、清空输入与计数、隐藏、结束搜索、聚焦画布', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		input.value = '关键字';
		count.setText('1/2');

		doSearch(h.view);
		closeSearchBar(h.view);
		// 防抖已取消：到期不再触发引擎搜索
		vi.advanceTimersByTime(1000);

		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();
		expect(h.bar.addedClasses).toEqual([
			'mindmap-search-bar-hidden',
			'mindmap-search-bar-hidden',
		]);
		expect(input.value).toBe('');
		expect(count.texts).toEqual(['1/2', '']);
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(h.canvas.focusCount).toBe(1);
	});

	it('searchBarEl 为 null：静默返回（不结束引擎搜索）', () => {
		searchMocks.endMindMapSearch.mockClear();
		expect(() => closeSearchBar(makeView({ withBar: false }).view)).not.toThrow();
		expect(searchMocks.endMindMapSearch).not.toHaveBeenCalled();
	});
});

describe('refreshSearchBarLabels（语言变更就地刷新）', () => {
	it('更新占位符与三个按钮 tooltip，且不重建 DOM', () => {
		const h = makeView();
		const { input, buttons } = buildBar(h);
		const childCount = h.bar.children.length;

		(h.view as unknown as { lang: Language }).lang = 'en';
		refreshSearchBarLabels(h.view);

		expect(input.attr['placeholder']).toBe(
			t('en', 'toolbar.searchPlaceholder'),
		);
		expect(buttons.map((button) => button.attr['title'])).toEqual([
			t('en', 'search.prev'),
			t('en', 'search.next'),
			t('en', 'search.close'),
		]);
		// 就地更新：不新增子元素（避免重复注册监听）
		expect(h.bar.children.length).toBe(childCount);
	});

	it('未构建搜索栏时静默返回', () => {
		const bare = makeView();
		expect(() => refreshSearchBarLabels(bare.view)).not.toThrow();
	});
});

describe('openSearchBar（打开搜索栏）', () => {
	it('无搜索栏/无引擎时静默；否则摘掉 hidden 类并延迟 50ms 聚焦输入框', () => {
		// 无搜索栏：不抛异常
		expect(() => openSearchBar(makeView({ withBar: false }).view)).not.toThrow();

		// 无引擎：不摘 hidden 类、不聚焦
		const noEngine = makeView({ withMindMap: false });
		openSearchBar(noEngine.view);
		expect(noEngine.bar.removedClasses).toEqual([]);
		vi.advanceTimersByTime(1000);
		expect(noEngine.bar.removedClasses).toEqual([]);

		// 正常路径：立即摘 hidden，50ms 后聚焦
		const h = makeView();
		const { input } = buildBar(h);
		openSearchBar(h.view);
		expect(h.bar.removedClasses).toEqual(['mindmap-search-bar-hidden']);
		expect(input.focusCount).toBe(0);

		vi.advanceTimersByTime(49);
		expect(input.focusCount).toBe(0);
		vi.advanceTimersByTime(1);
		expect(input.focusCount).toBe(1);
	});
});

describe('零命中计数可见性（不依赖引擎回调）', () => {
	it('引擎命中为 0：搜索落地后立即显示「无匹配」（引擎此时不会回调）', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(0);
		searchMocks.getSearchCurrentIndex.mockReturnValue(0);
		input.value = '不存在的关键词';

		doSearch(h.view);
		vi.advanceTimersByTime(180);

		expect(searchMocks.searchMindMap).toHaveBeenCalledWith(
			h.mindMap,
			'不存在的关键词',
			expect.any(Function),
		);
		// 关键：**没有**调用引擎回调（Search.searchNext 在空列表上提前 return）
		expect(count.text).toBe('没有匹配的节点');
		expect(count.addedClasses).toEqual(['mindmap-search-no-result']);
	});

	it('从有命中切到零命中：计数不残留上一次结果', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(0);
		input.value = '命中';
		doSearch(h.view);
		vi.advanceTimersByTime(180);
		expect(count.text).toBe('1/3');

		searchMocks.getSearchMatchCount.mockReturnValue(0);
		input.value = '换一个关键词';
		doSearch(h.view);
		vi.advanceTimersByTime(180);
		expect(count.text).toBe('没有匹配的节点');
		expect(count.addedClasses).toEqual(['mindmap-search-no-result']);
	});
});

describe('防抖窗口内的跳转（先落地搜索）', () => {
	it('Enter 在防抖未到期时：先执行搜索、不额外跳转（避免作用于陈旧结果集）', () => {
		const h = makeView();
		const { input } = buildBar(h);
		input.value = '关键字';
		doSearch(h.view);

		// 180ms 未到就按 Enter
		fireKeydown(h, {
			key: 'Enter',
			shiftKey: false,
			preventDefault: vi.fn(),
		});
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchMindMap).toHaveBeenCalledWith(
			h.mindMap,
			'关键字',
			expect.any(Function),
		);
		// 引擎搜索本身已定位首个命中 → 不再跳一次（否则会越过它）
		expect(searchMocks.searchNextInMindMap).not.toHaveBeenCalled();
		// 未决防抖已被取消：到期不会重复搜索
		vi.advanceTimersByTime(1000);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
	});

	it('Shift+Enter（上一个）在防抖未到期时：同样先落地搜索、不跳转', () => {
		const h = makeView();
		const { input } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);
		input.value = '关键字';
		doSearch(h.view);

		fireKeydown(h, {
			key: 'Enter',
			shiftKey: true,
			preventDefault: vi.fn(),
		});
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();
	});

	it('搜索已落地后再按 Enter：正常跳下一个（不再重复搜索）', () => {
		const h = makeView();
		const { input } = buildBar(h);
		input.value = '关键字';
		doSearch(h.view);
		vi.advanceTimersByTime(180);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);

		fireKeydown(h, {
			key: 'Enter',
			shiftKey: false,
			preventDefault: vi.fn(),
		});
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchNextInMindMap).toHaveBeenCalledWith(
			h.mindMap,
			expect.any(Function),
		);
	});
});
