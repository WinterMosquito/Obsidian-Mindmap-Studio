/**
 * 搜索子系统（Search 插件）的防腐收口（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 运行时 search 插件可能未注册（引擎变体差异），搜索包装函数内部判空静默。
 * matchNodeList/currentIndex 等插件内部状态不再被 view-search 直接触碰。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';

/** 执行关键字搜索（Search 插件未注册时静默） */
export function searchMindMap(
	mindMap: MindMap | null,
	keyword: string,
	callback?: () => void,
): void {
	mindMap?.search?.search(keyword, callback);
}

/** 跳到下一个搜索命中（Search 插件未注册时静默） */
export function searchNextInMindMap(
	mindMap: MindMap | null,
	callback?: () => void,
): void {
	mindMap?.search?.searchNext(callback);
}

/** 结束搜索并清除高亮（Search 插件未注册时静默） */
export function endMindMapSearch(mindMap: MindMap | null): void {
	mindMap?.search?.endSearch();
}

/** 当前搜索命中总数（未搜索/插件未注册时为 0） */
export function getSearchMatchCount(mindMap: MindMap | null): number {
	return mindMap?.search?.matchNodeList?.length ?? 0;
}

/** 当前搜索命中下标（0 起；未搜索/插件未注册时为 0） */
export function getSearchCurrentIndex(mindMap: MindMap | null): number {
	return mindMap?.search?.currentIndex ?? 0;
}

/** 跳转到指定命中（Search 插件未注册时静默） */
export function jumpToSearchIndex(
	mindMap: MindMap | null,
	index: number,
	callback?: () => void,
): void {
	mindMap?.search?.jump(index, callback);
}
