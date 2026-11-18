/** 搜索业务适配：防抖、引擎查询、结果跳转与计数；DOM/键盘/焦点由 UI 组件持有。 */
import { SearchBar, type SearchBarLabels } from '../../ui/search/search-bar';
import { createDebouncer, type Debouncer } from '../../core/concurrency';
import { t } from '../../core/i18n';
import {
	endMindMapSearch,
	getSearchCurrentIndex,
	getSearchMatchCount,
	jumpToSearchIndex,
	searchMindMap,
	searchNextInMindMap,
} from '../../engine/mindmap';
import type { MindMapViewContext, ViewDomContext, ViewEngineContext } from './view-context';

/**
 * 搜索子系统所需的最窄访问面：DOM 面（搜索栏/画布）+ 引擎面（实例/事件）
 * + 文案。R4 上下文瘦身示范：view-* 按需组合子上下文，不依赖整个装配面
 * （MindMapView 结构化实现装配面，传入即兼容）。
 */
type SearchViewContext = ViewDomContext &
	ViewEngineContext &
	Pick<MindMapViewContext, 'lang'>;

const searchBars = new WeakMap<SearchViewContext, SearchBar>();

function labels(view: SearchViewContext): SearchBarLabels {
	return {
		placeholder: t(view.lang, 'toolbar.searchPlaceholder'),
		prev: t(view.lang, 'search.prev'),
		next: t(view.lang, 'search.next'),
		close: t(view.lang, 'search.close'),
	};
}

/** 装配业务回调；兼容字段引用组件持有的元素。 */
export function buildSearchBar(view: SearchViewContext): void {
	if (!view.searchBarEl) return;
	disposeSearchBar(view);
	const bar = new SearchBar(view.searchBarEl, labels(view), {
		input: () => doSearch(view),
		prev: () => searchPrev(view),
		next: () => searchNext(view),
		close: () => closeSearchBar(view),
	});
	searchBars.set(view, bar);
	view.searchInput = bar.input;
	view.searchCountEl = bar.count;
}

export function openSearchBar(view: SearchViewContext): void {
	if (view.mindMap) searchBars.get(view)?.open();
}

export function refreshSearchBarLabels(view: SearchViewContext): void {
	searchBars.get(view)?.updateLabels(labels(view));
}

export function closeSearchBar(view: SearchViewContext): void {
	if (!view.searchBarEl) return;
	searchDebouncers.get(view)?.cancel();
	searchDebouncers.delete(view);
	searchBars.get(view)?.close();
	endMindMapSearch(view.mindMap);
	view.canvasEl?.focus();
}

/** 关闭/重建前取消搜索与焦点任务，解绑组件自己的监听。 */
export function disposeSearchBar(view: SearchViewContext): void {
	searchDebouncers.get(view)?.cancel();
	searchDebouncers.delete(view);
	searchBars.get(view)?.dispose();
	searchBars.delete(view);
	view.searchInput = null;
	view.searchCountEl = null;
}

/** 防抖器（按视图），避免每键全量重搜 */
const searchDebouncers = new WeakMap<SearchViewContext, Debouncer>();
const SEARCH_DEBOUNCE_MS = 180;

/** 执行搜索（带防抖：停顿后再搜） */
export function doSearch(view: SearchViewContext): void {
	if (!view.mindMap || !view.searchInput) {
		return;
	}
	let debouncer = searchDebouncers.get(view);
	if (!debouncer) {
		debouncer = createDebouncer(SEARCH_DEBOUNCE_MS);
		searchDebouncers.set(view, debouncer);
	}
	debouncer.schedule(() => runSearch(view));
}

function runSearch(view: SearchViewContext): void {
	if (!view.mindMap || !view.searchInput) {
		return;
	}
	const keyword = view.searchInput.value.trim();
	if (!keyword) {
		endMindMapSearch(view.mindMap);
		searchBars.get(view)?.setCount('', false);
		return;
	}
	searchMindMap(view.mindMap, keyword, () => updateSearchCount(view));
	// 引擎命中数为 0 时**不会回调**（Search.searchNext 在空 matchNodeList 上
	// 提前 return），只靠回调会让「无匹配」提示不可达、计数残留上一次结果；
	// 这里无条件刷新一次（引擎搜索为同步执行，此刻 matchNodeList/currentIndex
	// 已就位），有命中的场景与回调重复刷新同值，无副作用。
	updateSearchCount(view);
}

/**
 * 落地未决的防抖搜索（Enter / 上下跳转前调用）。
 * @returns true = 本次已执行搜索（调用方不应再跳转：引擎搜索本身已定位到
 *          首个命中，再跳一次会越过它）
 */
function flushPendingSearch(view: SearchViewContext): boolean {
	const debouncer = searchDebouncers.get(view);
	if (!debouncer?.cancel()) {
		return false;
	}
	runSearch(view);
	return true;
}

/** 跳到下一个匹配 */
export function searchNext(view: SearchViewContext): void {
	// 防抖窗口内按 Enter：先让未决搜索落地，否则会作用于上一次关键词的陈旧结果集
	if (flushPendingSearch(view)) {
		return;
	}
	searchNextInMindMap(view.mindMap, () => updateSearchCount(view));
}

/** 跳到上一个匹配（循环） */
export function searchPrev(view: SearchViewContext): void {
	if (!view.mindMap) {
		return;
	}
	if (flushPendingSearch(view)) {
		return;
	}
	const matches = getSearchMatchCount(view.mindMap);
	if (matches === 0) {
		return;
	}
	let index = getSearchCurrentIndex(view.mindMap) - 1;
	if (index < 0) {
		index = matches - 1;
	}
	jumpToSearchIndex(view.mindMap, index, () => updateSearchCount(view));
}

/** 引擎计数由业务层读取，组件只接收显示状态。 */
export function updateSearchCount(view: SearchViewContext): void {
	const bar = searchBars.get(view);
	if (!bar) return;
	const matches = getSearchMatchCount(view.mindMap);
	const current = getSearchCurrentIndex(view.mindMap);
	bar.setCount(matches === 0 ? t(view.lang, 'common.noMatch') : `${current + 1}/${matches}`, matches === 0);
}
