/**
 * 搜索栏子系统：构建搜索栏 DOM 与搜索/上下跳转/计数逻辑。
 * 从 view.ts 抽取，逻辑以接收 SearchViewContext（最窄访问面，见下方定义）
 * 的模块函数组织；view.ts 中的同名方法保留为外观（委托到这里的实现），
 * 调用方无需改动。
 * 引擎 Search 插件的访问（search/jump/matchNodeList 等）经 mindmap.ts
 * 防腐收口函数进行，本模块不触碰引擎内部状态。
 */
import { setIcon } from 'obsidian';
import { createDebouncer, type Debouncer } from '../concurrency';
import { t } from '../i18n';
import {
	endMindMapSearch,
	getSearchCurrentIndex,
	getSearchMatchCount,
	jumpToSearchIndex,
	searchMindMap,
	searchNextInMindMap,
} from '../mindmap';
import type { MindMapViewContext, ViewDomContext, ViewEngineContext } from './view-context';

/**
 * 搜索子系统所需的最窄访问面：DOM 面（搜索栏/画布）+ 引擎面（实例/事件）
 * + 文案。R4 上下文瘦身示范：view-* 按需组合子上下文，不依赖整个装配面
 * （MindMapView 结构化实现装配面，传入即兼容）。
 */
type SearchViewContext = ViewDomContext &
	ViewEngineContext &
	Pick<MindMapViewContext, 'lang'>;

/** 搜索栏展开后延迟聚焦的间隔（等待隐藏 class 移除与布局生效后再聚焦） */
const SEARCH_FOCUS_DELAY_MS = 50;

/** 构建搜索栏（DOM 与事件监听） */
export function buildSearchBar(view: SearchViewContext): void {
	const searchBar = view.searchBarEl;
	if (!searchBar) {
		return;
	}
	searchBar.addClass('mindmap-search-bar-hidden');
	view.searchInput = searchBar.createEl('input', {
		cls: 'mindmap-search-input',
		attr: {
			type: 'text',
			placeholder: t(view.lang, 'toolbar.searchPlaceholder'),
			spellcheck: 'false',
		},
	});
	view.searchCountEl = searchBar.createSpan('mindmap-search-count');
	const prevButton = searchBar.createEl('button', {
		cls: 'mindmap-search-btn',
		attr: { title: t(view.lang, 'search.prev') },
	});
	setIcon(prevButton, 'chevron-up');
	prevButton.onclick = () => searchPrev(view);
	const nextButton = searchBar.createEl('button', {
		cls: 'mindmap-search-btn',
		attr: { title: t(view.lang, 'search.next') },
	});
	setIcon(nextButton, 'chevron-down');
	nextButton.onclick = () => searchNext(view);
	const closeButton = searchBar.createEl('button', {
		cls: 'mindmap-search-btn',
		attr: { title: t(view.lang, 'search.close') },
	});
	setIcon(closeButton, 'x');
	closeButton.onclick = () => closeSearchBar(view);
	view.viewEvents.onDom(view.searchInput, 'input', () => doSearch(view));
	view.viewEvents.onDom(view.searchInput, 'keydown', (event) => {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (event.shiftKey) {
				searchPrev(view);
			} else {
				searchNext(view);
			}
		} else if (event.key === 'Escape') {
			closeSearchBar(view);
		}
	});
}

/** 打开搜索栏并聚焦输入框 */
export function openSearchBar(view: SearchViewContext): void {
	if (!view.searchBarEl || !view.mindMap) {
		return;
	}
	view.searchBarEl.removeClass('mindmap-search-bar-hidden');
	window.setTimeout(() => view.searchInput?.focus(), SEARCH_FOCUS_DELAY_MS);
}

/** 关闭搜索栏并结束引擎搜索 */
export function closeSearchBar(view: SearchViewContext): void {
	if (!view.searchBarEl) {
		return;
	}
	// 取消未决的防抖搜索，避免关闭后在空结果上继续触发
	searchDebouncers.get(view)?.cancel();
	searchDebouncers.delete(view);
	view.searchBarEl.addClass('mindmap-search-bar-hidden');
	endMindMapSearch(view.mindMap);
	if (view.searchInput) {
		view.searchInput.value = '';
	}
	view.searchCountEl?.setText('');
	view.canvasEl?.focus();
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
		view.searchCountEl?.setText('');
		return;
	}
	searchMindMap(view.mindMap, keyword, () => updateSearchCount(view));
}

/** 跳到下一个匹配 */
export function searchNext(view: SearchViewContext): void {
	searchNextInMindMap(view.mindMap, () => updateSearchCount(view));
}

/** 跳到上一个匹配（循环） */
export function searchPrev(view: SearchViewContext): void {
	if (!view.mindMap) {
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

/** 更新匹配计数显示 */
export function updateSearchCount(view: SearchViewContext): void {
	if (!view.searchCountEl) {
		return;
	}
	const matches = getSearchMatchCount(view.mindMap);
	const current = getSearchCurrentIndex(view.mindMap);
	if (matches === 0) {
		view.searchCountEl.setText(t(view.lang, 'common.noMatch'));
		view.searchCountEl.addClass('mindmap-search-no-result');
		return;
	}
	view.searchCountEl.removeClass('mindmap-search-no-result');
	view.searchCountEl.setText(`${current + 1}/${matches}`);
}
