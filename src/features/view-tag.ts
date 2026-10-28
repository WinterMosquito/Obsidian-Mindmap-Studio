/**
 * 标签点击的**唯一接管面**（文件视图与只读嵌入共用）。
 *
 * ## 为什么挂画布 capture 而不是引擎事件
 * 标签是自绘内容里的 `<a class="tag" data-tag>`（**刻意没有 href**，见
 * `node-inline-html` 的 TAG_STYLES 说明）：它不该被链接三通道（点击 / 悬停预览 /
 * 中键）当成链接，也不该让引擎的节点点击语义先跑一遍。画布 capture 在目标元素
 * 之前执行，命中即拦下，两条通道都不必改。
 *
 * ## 两个宿主
 * - 文件视图（`view.ts` 的 setupFeatures）；
 * - ` ```mindmap ` 只读嵌入（`mindmap-codeblock.bindEmbedEvents`）——嵌入里的
 *   普通链接可点，标签同理；两处传的是同一个 `EventBinder`，生命周期各自管理。
 *
 * ## 跨 realm
 * 元素来自 popout 时对主窗口构造器的 `instanceof` 恒为 false，故按能力判定
 * ——判定收口在 `core/event-binder.elementFromTarget`（任务复选框共用同一份）。
 */
import type { App } from 'obsidian';
import { elementFromTarget } from '../core/event-binder';
import type { EventBinder } from '../core/event-binder';
import type { Language } from '../core/i18n';
import { openTagSearch } from '../platform/tag-search';

/** 标签 pill 的命中选择器（类名与 `data-tag` 由 node-inline-html 产出） */
const TAG_SELECTOR = 'a.tag[data-tag]';

/**
 * 装配标签点击（随宿主生命周期清理；只读嵌入也装配，与链接可点同口径）。
 *
 * 修饰键**一律忽略**（仍按普通点击处理）：Obsidian 阅读视图没有「Ctrl+点标签
 * 在新标签页搜索」这层语义，插件不发明新键位。
 */
export function registerTagClicks(
	events: EventBinder,
	canvasEl: HTMLElement | null,
	app: App,
	lang: Language,
): void {
	if (!canvasEl) {
		return;
	}
	events.onDom(
		canvasEl,
		'click',
		(event) => {
			const tag = elementFromTarget(event.target)?.closest(TAG_SELECTOR);
			if (!tag) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			openTagSearch(app, tag.getAttribute('data-tag') ?? '', lang);
		},
		true,
	);
}
