/**
 * view-search 回归测试：搜索栏装配、防抖搜索、上下跳转（含回绕）、
 * 零命中计数与「防抖窗口内跳转」的收口。
 *
 * 覆盖策略：
 * - 引擎面（mindmap.ts 的 search* 防腐收口函数）用 vi.mock 换成 spy：
 *   本测试只验证 view-search 自身的编排与 DOM 接线，不验证引擎封装；
 * - obsidian 的 setIcon 换成 spy，用来断言「图标接到哪个按钮上」；
 * - Node 环境无 DOM，故用本地伪元素记录 addClass / removeClass / setText /
 *   attr / focus / 子元素，断言全部落在真实调用痕迹上（而非 mock 行为）；
 * - 定时语义用 fake timers 精确推进：防抖窗口 180ms（SEARCH_DEBOUNCE_MS）、
 *   打开后聚焦延迟 50ms（SEARCH_FOCUS_DELAY_MS）都断言到毫秒边界。
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
		// mock 里的 setIcon 本是空实现：换成 spy 才能断言按钮图标接线
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

/** 防抖窗口（与 src/features/view-search.ts 的 SEARCH_DEBOUNCE_MS 一致） */
const SEARCH_DEBOUNCE_MS = 180;
/** 打开搜索栏后的聚焦延迟（SEARCH_FOCUS_DELAY_MS） */
const SEARCH_FOCUS_DELAY_MS = 50;

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
 * 伪 DOM 元素：只实现 view-search 用到的最小面，并把每次调用记进数组，
 * 供断言「模块真的做了什么」而不是「mock 被调了几次」。
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
	value = '';
	onclick: (() => void) | null = null;
	focusCount = 0;

	constructor(tag: string, init: FakeElInit = {}) {
		this.tag = tag;
		this.cls = init.cls ?? '';
		this.attr = { ...(init.attr ?? {}) };
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

	/** 模块按 Obsidian 真实签名调用 createSpan('mindmap-search-count') */
	createSpan(cls?: string): FakeEl {
		const child = new FakeEl('span', cls === undefined ? {} : { cls });
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
		throw new Error(`缺少下标 ${index} 的元素`);
	}
	return value;
}

/** 构造视图桩（viewEvents/engineEvents 共用一个记录型伪绑定器） */
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

/** 取引擎搜索回调（第 3 个实参）；缺失即失败 */
function searchCallback(): () => void {
	const callback = nth(searchMocks.searchMindMap.mock.calls, 0)[2];
	if (!callback) {
		throw new Error('searchMindMap 未收到回调');
	}
	return callback;
}

beforeEach(() => {
	vi.useFakeTimers();
	// reset 而非 clear：清掉上一个用例遗留的 mockReturnValue(Once) 队列
	vi.resetAllMocks();
	// 默认无命中：单项用例按需覆写
	searchMocks.getSearchMatchCount.mockReturnValue(0);
	searchMocks.getSearchCurrentIndex.mockReturnValue(0);
});

afterEach(() => {
	// 必须还原真实定时器：否则未决的防抖定时器会串到下一个用例
	vi.useRealTimers();
});

describe('buildSearchBar（搜索栏装配）', () => {
	it('searchBarEl 缺失：静默返回（不回填引用、不建图标）', () => {
		const h = makeView({ withBar: false });
		expect(() => buildSearchBar(h.view)).not.toThrow();
		expect(h.view.searchInput).toBeNull();
		expect(h.view.searchCountEl).toBeNull();
		expect(h.bar.children).toEqual([]);
		expect(setIconMock).not.toHaveBeenCalled();
	});

	it('装配输入框与计数元素：类名 / 占位符 / 构建即隐藏', () => {
		const h = makeView();
		const { input, count } = buildBar(h);

		expect(h.bar.addedClasses).toEqual(['mindmap-search-bar-hidden']);
		expect(input.tag).toBe('input');
		expect(input.cls).toBe('mindmap-search-input');
		expect(input.attr).toEqual({
			type: 'text',
			placeholder: '搜索节点…',
			spellcheck: 'false',
		});
		expect(count.tag).toBe('span');
		expect(count.cls).toBe('mindmap-search-count');
		// 引用回填（搜索逻辑依赖这两个字段）
		expect(h.view.searchInput).toBe(input as unknown as HTMLInputElement);
		expect(h.view.searchCountEl).toBe(count as unknown as HTMLElement);
	});

	it('三个按钮：同一类名、tooltip 按 上一个/下一个/关闭 顺序、图标接各自按钮', () => {
		const h = makeView();
		const { buttons } = buildBar(h);

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

	it('上一个 / 下一个按钮接线：跳转到 currentIndex-1 与委托引擎 searchNext', () => {
		const h = makeView();
		const { buttons } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);

		clickButton(nth(buttons, 0)); // 上一个：索引 2 → 1
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledWith(
			h.mindMap,
			1,
			expect.any(Function),
		);

		clickButton(nth(buttons, 1)); // 下一个：交给引擎自增
		expect(searchMocks.searchNextInMindMap).toHaveBeenCalledWith(
			h.mindMap,
			expect.any(Function),
		);
	});

	it('关闭按钮：隐藏搜索栏、清空输入与计数、结束引擎搜索、聚焦画布', () => {
		const h = makeView();
		const { input, count, buttons } = buildBar(h);
		input.value = '关键字';
		count.setText('1/2');

		clickButton(nth(buttons, 2));

		expect(h.bar.addedClasses).toEqual([
			'mindmap-search-bar-hidden', // 构建时
			'mindmap-search-bar-hidden', // 关闭时
		]);
		expect(input.value).toBe('');
		expect(count.texts).toEqual(['1/2', '']);
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(h.canvas.focusCount).toBe(1);
	});

	it('keydown 分流：Enter 阻止默认并跳下一个；Shift+Enter 跳上一个；Escape 关闭', () => {
		const h = makeView();
		const { input } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(2);
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);

		// Enter：阻止默认行为（避免在输入框内换行/提交）并跳下一个
		const enterDefault = vi.fn();
		fireKeydown(h, {
			key: 'Enter',
			shiftKey: false,
			preventDefault: enterDefault,
		});
		expect(enterDefault).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchNextInMindMap).toHaveBeenCalledWith(
			h.mindMap,
			expect.any(Function),
		);
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();

		// Shift+Enter：跳上一个（currentIndex 1 → 0）
		const shiftDefault = vi.fn();
		fireKeydown(h, {
			key: 'Enter',
			shiftKey: true,
			preventDefault: shiftDefault,
		});
		expect(shiftDefault).toHaveBeenCalledTimes(1);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledWith(
			h.mindMap,
			0,
			expect.any(Function),
		);

		// Escape：关闭（不阻止默认行为，交给 Obsidian 处理）
		input.value = '残留';
		const escapeDefault = vi.fn();
		fireKeydown(h, {
			key: 'Escape',
			shiftKey: false,
			preventDefault: escapeDefault,
		});
		expect(escapeDefault).not.toHaveBeenCalled();
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(input.value).toBe('');
	});
});

describe('doSearch（180ms 防抖）', () => {
	it('窗口内连打三次只搜一次：179ms 不触发、180ms 恰好触发一次（关键词已 trim）', () => {
		const h = makeView();
		const { input } = buildBar(h);
		input.value = '  目标  ';

		doSearch(h.view);
		doSearch(h.view);
		doSearch(h.view);
		// 防抖：每次输入都重置定时器，窗口内绝不触发
		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();

		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchMindMap).toHaveBeenCalledWith(
			h.mindMap,
			'目标',
			expect.any(Function),
		);

		// 已落地：继续推进不会有第二次（防抖器不自续）
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 3);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
	});

	it('窗口内再次输入会重新计时（从最后一次输入算起）', () => {
		const h = makeView();
		const { input } = buildBar(h);
		input.value = '关键字';

		doSearch(h.view);
		vi.advanceTimersByTime(100); // t=100，距首次输入 100ms
		doSearch(h.view); // 重新计时 → 新窗口到 t=280

		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1); // t=279
		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1); // t=280
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
	});

	it('引擎搜索完成后经回调刷新计数', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		input.value = '目标';

		doSearch(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);

		// 引擎此刻已定位到第 2 个命中（currentIndex 1）共 5 个
		searchMocks.getSearchMatchCount.mockReturnValue(5);
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);
		searchCallback()();

		expect(count.text).toBe('2/5');
	});

	it('空白关键词：防抖落地后结束引擎搜索并清空计数（不调用引擎搜索）', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		count.setText('1/2');
		input.value = '   \t ';

		doSearch(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();
		expect(searchMocks.endMindMapSearch).toHaveBeenCalledWith(h.mindMap);
		expect(count.texts).toEqual(['1/2', '']);
	});

	it('无引擎或无输入框时静默返回（不排防抖）', () => {
		const bare = makeView({ withMindMap: false });
		expect(() => doSearch(bare.view)).not.toThrow();
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
		expect(searchMocks.searchMindMap).not.toHaveBeenCalled();
	});
});

describe('零命中计数（引擎不回调也要可见）', () => {
	it('零命中：搜索落地即显示「没有匹配的节点」并加 no-result 类', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(0);
		searchMocks.getSearchCurrentIndex.mockReturnValue(0);
		input.value = '不存在的关键词';

		doSearch(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

		expect(searchMocks.searchMindMap).toHaveBeenCalledWith(
			h.mindMap,
			'不存在的关键词',
			expect.any(Function),
		);
		// 关键：引擎在空命中列表上不会回调（Search.searchNext 提前 return），
		// 计数必须由 runSearch 无条件刷新一次才可见——此处回调从未被调用
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
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
		expect(count.text).toBe('1/3');

		searchMocks.getSearchMatchCount.mockReturnValue(0);
		input.value = '换一个关键词';
		doSearch(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);

		expect(count.text).toBe('没有匹配的节点');
		expect(count.texts).toEqual(['1/3', '没有匹配的节点']);
	});

	it('有命中：显示 当前/总数 并移除 no-result 类', () => {
		const h = makeView();
		const { count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(5);
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);

		updateSearchCount(h.view);

		expect(count.texts).toEqual(['3/5']);
		expect(count.removedClasses).toEqual(['mindmap-search-no-result']);
		expect(count.addedClasses).toEqual([]);
	});

	it('计数元素未装配：静默返回（不查引擎）', () => {
		const bare = makeView();
		expect(() => updateSearchCount(bare.view)).not.toThrow();
		expect(searchMocks.getSearchMatchCount).not.toHaveBeenCalled();
		expect(searchMocks.getSearchCurrentIndex).not.toHaveBeenCalled();
	});
});

describe('searchPrev / searchNext（回绕与委托）', () => {
	it('searchPrev：首项回绕到末项（索引 0 → matches-1）', () => {
		const h = makeView();
		buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(0);

		searchPrev(h.view);

		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledTimes(1);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledWith(
			h.mindMap,
			2, // 末项
			expect.any(Function),
		);
	});

	it('searchPrev：中间项回退一项（2 → 1），跳转回调刷新计数 2/3', () => {
		const h = makeView();
		const { count } = buildBar(h);
		searchMocks.getSearchMatchCount.mockReturnValue(3);
		searchMocks.getSearchCurrentIndex.mockReturnValue(2);

		searchPrev(h.view);
		expect(searchMocks.jumpToSearchIndex).toHaveBeenCalledWith(
			h.mindMap,
			1,
			expect.any(Function),
		);

		// 跳转完成：引擎把 currentIndex 挪到 1
		searchMocks.getSearchCurrentIndex.mockReturnValue(1);
		const done = nth(searchMocks.jumpToSearchIndex.mock.calls, 0)[2];
		expect(done).toBeTypeOf('function');
		done?.();
		expect(count.text).toBe('2/3');
	});

	it('searchPrev：0 命中不跳转；无引擎时直接返回（连匹配数都不查）', () => {
		const h = makeView();
		buildBar(h);

		searchMocks.getSearchMatchCount.mockReturnValue(0);
		searchPrev(h.view);
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();

		// 换一个无引擎视图：早退发生在查匹配数之前
		searchMocks.getSearchMatchCount.mockClear();
		const bare = makeView({ withMindMap: false });
		searchPrev(bare.view);
		expect(searchMocks.getSearchMatchCount).not.toHaveBeenCalled();
		expect(searchMocks.jumpToSearchIndex).not.toHaveBeenCalled();
	});

	it('searchNext：委托引擎并透传计数回调', () => {
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

describe('防抖窗口内的跳转（先落地搜索）', () => {
	it('Enter 在防抖未到期时：先执行搜索、不额外跳转，且原定时器不再重复触发', () => {
		const h = makeView();
		const { input } = buildBar(h);
		input.value = '关键字';
		doSearch(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1); // 仍差 1ms 到期

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
		// 引擎搜索本身已定位首个命中 → 再跳一次会越过它
		expect(searchMocks.searchNextInMindMap).not.toHaveBeenCalled();

		// 未决防抖已被 cancel：到期不会重复搜索同一关键词
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
	});

	it('Shift+Enter 在防抖未到期时：同样只落地搜索、不跳转', () => {
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
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2);
		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
	});

	it('「下一个」按钮在防抖未到期时：同样先落地搜索、不额外跳转', () => {
		const h = makeView();
		const { input, buttons } = buildBar(h);
		input.value = '关键字';
		doSearch(h.view);

		clickButton(nth(buttons, 1));

		expect(searchMocks.searchMindMap).toHaveBeenCalledTimes(1);
		expect(searchMocks.searchNextInMindMap).not.toHaveBeenCalled();
	});

	it('搜索已落地后再按 Enter：正常跳下一个，不重复搜索', () => {
		const h = makeView();
		const { input } = buildBar(h);
		input.value = '关键字';
		doSearch(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
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

describe('closeSearchBar（关闭搜索栏）', () => {
	it('取消未决防抖：关闭后到期不再触发引擎搜索', () => {
		const h = makeView();
		const { input, count } = buildBar(h);
		input.value = '关键字';
		count.setText('1/2');

		doSearch(h.view); // 排下防抖
		closeSearchBar(h.view);
		vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 5);

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

	it('searchBarEl 缺失：静默返回（不结束引擎搜索）', () => {
		const bare = makeView({ withBar: false });
		expect(() => closeSearchBar(bare.view)).not.toThrow();
		expect(searchMocks.endMindMapSearch).not.toHaveBeenCalled();
		expect(bare.canvas.focusCount).toBe(0);
	});
});

describe('openSearchBar（打开搜索栏）', () => {
	it('无搜索栏或无引擎：静默返回（不摘 hidden 类、不聚焦）', () => {
		const noBar = makeView({ withBar: false });
		expect(() => openSearchBar(noBar.view)).not.toThrow();

		const noEngine = makeView({ withMindMap: false });
		openSearchBar(noEngine.view);
		vi.advanceTimersByTime(SEARCH_FOCUS_DELAY_MS * 4);
		expect(noEngine.bar.removedClasses).toEqual([]);
	});

	it('正常路径：立即摘掉 hidden 类，49ms 不聚焦、50ms 聚焦输入框', () => {
		const h = makeView();
		const { input } = buildBar(h);

		openSearchBar(h.view);
		expect(h.bar.removedClasses).toEqual(['mindmap-search-bar-hidden']);
		// 延迟聚焦：等隐藏 class 移除与布局生效后再 focus
		expect(input.focusCount).toBe(0);

		vi.advanceTimersByTime(SEARCH_FOCUS_DELAY_MS - 1);
		expect(input.focusCount).toBe(0);

		vi.advanceTimersByTime(1);
		expect(input.focusCount).toBe(1);
	});
});

describe('refreshSearchBarLabels（语言变更就地刷新）', () => {
	it('更新占位符与三个按钮 tooltip，且不重建 DOM', () => {
		const h = makeView();
		const { input, buttons } = buildBar(h);
		const childCount = h.bar.children.length;

		(h.view as unknown as { lang: Language }).lang = 'en';
		refreshSearchBarLabels(h.view);

		expect(input.attr['placeholder']).toBe(t('en', 'toolbar.searchPlaceholder'));
		expect(buttons.map((button) => button.attr['title'])).toEqual([
			t('en', 'search.prev'),
			t('en', 'search.next'),
			t('en', 'search.close'),
		]);
		// 就地更新：子元素数量不变（避免重复注册监听）
		expect(h.bar.children.length).toBe(childCount);
	});

	it('未构建搜索栏时静默返回（不抛异常）', () => {
		const bare = makeView();
		expect(() => refreshSearchBarLabels(bare.view)).not.toThrow();
	});
});
