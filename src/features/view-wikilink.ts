/**
 * wikilink 交互（方案 A）：导图节点悬停预览 + 链接点击跳转，
 * 行为对齐 Obsidian 阅读视图：
 * - 悬停含 [[链接]] 的节点 → workspace 'hover-link'（Obsidian 原生页面预览）；
 *   挂在引擎 node_mouseenter 事件上（事件源在引擎层，不依赖 DOM 冒泡）；
 * - 普通左键点击节点内渲染的 <a> 链接文本（internal-link/external-link，
 *   MarkdownRenderer 产物）→ 当前标签页打开目标（与 Obsidian 点击链接一致）；
 * - Ctrl/Cmd+点击节点 → 新标签页打开（优先取被点击链接的目标，其次节点链接）。
 *
 * 前置：main.ts 已 registerHoverLinkSource(VIEW_TYPE)，否则 core 忽略 hover-link。
 */
import { HOVER_LINK_EVENT, VIEW_TYPE } from '../constants';
import { formatWikilink, wikilinkLinkpath } from '../domain/wikilink';
import { getNodeGroupEl } from '../mindmap';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/** 悬停防抖（与附件预览共用状态字段，互斥触发） */
const HOVER_DEBOUNCE_MS = 400;

/** 悬停预览去重状态（WeakMap 按视图持有：上次预览的目标元素与时间） */
interface HoverPreviewState {
	el: Element | null;
	at: number;
}

const hoverPreviewStates = new WeakMap<MindMapViewContext, HoverPreviewState>();

/**
 * 从点击事件定位节点内的链接元素（MarkdownRenderer 渲染产物：
 * <a class="internal-link" data-href="…"> / <a class="external-link" href="…">）。
 * 限定 target 与锚点都落在该节点的渲染 group 内，避免误跨节点匹配。
 */
function findAnchorInNode(
	node: MindMapNode,
	event: MouseEvent,
): HTMLAnchorElement | null {
	const target = event.target;
	if (!(target instanceof Element)) {
		return null;
	}
	const groupEl = getNodeGroupEl(node);
	if (!groupEl || !groupEl.contains(target)) {
		return null;
	}
	const anchor = target.closest('a.internal-link, a.external-link, a[href]');
	if (
		!(anchor instanceof HTMLAnchorElement) ||
		!groupEl.contains(anchor)
	) {
		return null;
	}
	return anchor;
}

/**
 * 解析被点击锚点的跳转目标：
 * - internal-link：data-href 是原始 linkpath（无 [[ ]] 包裹），包成 wikilink
 *   形态交给 openHyperlink 的 parseWikilink 分支（getFirstLinkpathDest 解析）；
 * - external-link / 普通外链：href 即完整地址（URL 走 window.open 分支）。
 */
function resolveAnchorLink(anchor: HTMLAnchorElement): string {
	const dataHref = anchor.getAttribute('data-href');
	if (dataHref) {
		return formatWikilink(dataHref);
	}
	return anchor.getAttribute('href') ?? '';
}

/**
 * 节点承载的链接（无锚点时用）：文档双链存 mdWikiLinkpath（自绘文档图标通道，
 * 不写引擎 hyperlink），其余链接存 hyperlink。
 */
function nodeLink(node: MindMapNode): string {
	const wikiLink = node.getData('mdWikiLinkpath');
	if (typeof wikiLink === 'string' && wikiLink) {
		return wikiLink;
	}
	const hyperlink = node.getData('hyperlink');
	return typeof hyperlink === 'string' ? hyperlink : '';
}

/** 注册 wikilink 的悬停预览与点击跳转（initMindMap 内调用一次） */
export function registerWikilinkInteractions(view: MindMapViewContext): void {
	if (!view.mindMap) {
		return;
	}

	// 链接点击跳转（引擎 node_click 携带原始事件）
	view.engineEvents.onEngine(view.mindMap, 'node_click', (...args: unknown[]) => {
		const node = args[0] as MindMapNode | undefined;
		const event = args[1] as MouseEvent | undefined;
		if (!node || !event) {
			return;
		}
		const anchor = findAnchorInNode(node, event);
		// Ctrl/Cmd + 点击：节点任意位置 → 新标签打开（无锚点时退回节点链接）
		if (event.ctrlKey || event.metaKey) {
			const link =
				anchor !== null ? resolveAnchorLink(anchor) : nodeLink(node);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			view.openHyperlink(link, true);
			return;
		}
		// 普通左键点击：仅当命中节点内渲染的链接元素才打开
		// （节点其余区域维持引擎选中语义；无修饰键 = 当前标签页，同 Obsidian）
		if (!anchor || event.shiftKey || event.altKey) {
			return;
		}
		const link = resolveAnchorLink(anchor);
		if (!link) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		view.openHyperlink(link);
	});

	// 悬停节点（引擎事件）→ 页面预览
	view.engineEvents.onEngine(
		view.mindMap,
		'node_mouseenter',
		(...args: unknown[]) => {
			const node = args[0] as MindMapNode | undefined;
			const event = args[1] as MouseEvent | undefined;
			if (!node || !event) {
				return;
			}
			const link = nodeLink(node);
			if (!link) {
				return;
			}
			const linktext = wikilinkLinkpath(link);
			if (!linktext) {
				return;
			}
			const targetEl = getNodeGroupEl(node);
			if (!targetEl) {
				return;
			}
			const now = Date.now();
			const state = hoverPreviewStates.get(view) ?? { el: null, at: 0 };
			hoverPreviewStates.set(view, state);
			if (
				targetEl === state.el &&
				now - state.at < HOVER_DEBOUNCE_MS
			) {
				return;
			}
			state.el = targetEl;
			state.at = now;
			view.app.workspace.trigger(HOVER_LINK_EVENT, {
				event,
				source: VIEW_TYPE,
				hoverParent: view.containerEl,
				targetEl,
				linktext,
				sourcePath: view.file?.path ?? '',
			});
		},
	);
}
