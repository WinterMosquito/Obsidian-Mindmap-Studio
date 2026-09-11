/**
 * wikilink 交互（方案 A）：导图节点悬停预览 + 链接点击跳转，
 * 行为对齐 Obsidian 阅读视图：
 * - 悬停含**内部链接**的节点 → workspace 'hover-link'（Obsidian 原生页面预览 /
 *   附件预览）。三类节点等价：文档双链与文档嵌入（mdWikiLinkpath）、双链附件 /
 *   嵌入附件 / 拖入的库内附件（attachmentUrl 回形针通道）、外链节点不触发
 *   （core 只服务库内目标）；挂在引擎 node_mouseenter 事件上（事件源在引擎层，
 *   不依赖 DOM 冒泡），按住鼠标键（拖拽/框选）时不触发；
 * - 普通左键点击节点内渲染的 <a> 链接文本（internal-link/external-link）→
 *   当前标签页打开目标（与 Obsidian 点击链接一致）；
 * - Ctrl/Cmd+点击节点 → 新标签页打开（优先取被点击链接的目标，其次节点链接）。
 *
 * 前置：main.ts 已 registerHoverLinkSource(VIEW_TYPE)，否则 core 忽略 hover-link。
 */
import { HOVER_LINK_EVENT, VIEW_TYPE } from '../constants';
import { formatWikilink, wikilinkLinkpath } from '../domain/wikilink';
import { getNodeDataString, getNodeGroupEl } from '../mindmap';
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

/** 节点链接（无锚点时用）的通道取值与核心要的 linktext */
interface NodeLinkRef {
	/** 通道取值：Ctrl/Cmd+点击原样交给 openHyperlink（wiki / 库内路径 / URL 均可） */
	link: string;
	/**
	 * 核心做**库内目标解析**用的 linktext；null = 该值不是有效的库内链接。
	 * - 文档通道：`[[linkpath|别名]]` 形态 → 剥壳取 linkpath；
	 * - 附件通道：**裸 linkpath** → 直通（`wikilinkLinkpath` 只认 `[[…]]` 形态）；
	 * - hyperlink 通道：仅双链形态有效——裸 URL / 协议地址 / 畸形串一律 null
	 *   （核心的页面预览只服务库内目标，与阅读视图一致）。
	 */
	linktext: string | null;
}

/**
 * 节点承载的链接（悬停预览与 Ctrl/Cmd+点击共用），读取顺序与图标分流同源：
 * 1. 文档双链 / 文档嵌入 → `mdWikiLinkpath`（自绘文档页图标通道，
 *    不写引擎 hyperlink，否则与自绘图标双显）；
 * 2. 双链附件 / 嵌入附件 / 拖入的库内附件 → `attachmentUrl`（回形针通道）。
 *    `attachmentUrl` 是「引用仍在」的唯一凭据——「移除引用」只清它、
 *    `mdAttachmentLinkpath` 会残留，故以它为门控（否则残留字段会让已移除的
 *    附件继续可悬停/可打开）；取值优先原始 `mdAttachmentLinkpath`
 *    （`attachmentUrl` 可能已被视图层重写成资源地址，交给核心解析不准）；
 * 3. 其余（URL / 协议链接）→ 引擎 `hyperlink`。
 */
function nodeLink(node: MindMapNode): NodeLinkRef | null {
	const wikiLink = getNodeDataString(node, 'mdWikiLinkpath');
	if (wikiLink) {
		return { link: wikiLink, linktext: wikilinkLinkpath(wikiLink) };
	}
	if (getNodeDataString(node, 'attachmentUrl')) {
		const linkpath =
			getNodeDataString(node, 'mdAttachmentLinkpath') ||
			getNodeDataString(node, 'attachmentUrl');
		return { link: linkpath, linktext: linkpath };
	}
	const hyperlink = getNodeDataString(node, 'hyperlink');
	return hyperlink
		? { link: hyperlink, linktext: wikilinkLinkpath(hyperlink) }
		: null;
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
				anchor !== null
					? resolveAnchorLink(anchor)
					: (nodeLink(node)?.link ?? '');
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
			// 按住鼠标键（拖拽节点 / 框选 / 平移）时不弹预览：此时被拖节点滑过的
			// **其它**链接节点、框选矩形扫过的节点都会触发 node_mouseenter
			// （引擎只在「被拖的那个节点」上抑制），弹预览是纯噪声。
			if (event.buttons) {
				return;
			}
			// 三通道取值（文档双链/嵌入、附件、hyperlink）见 nodeLink；linktext
			// 解析不出库内目标（裸 URL / 畸形串）时不预览。
			const linktext = nodeLink(node)?.linktext;
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
			// 预览弹窗的上下翻转由核心按 targetEl 的矩形决定，而 SVG 节点
			// 缺少 offsetWidth/offsetHeight（见 ensureOffsetSize），必须先补齐，
			// 否则弹窗只会出现在节点上方、上方放不下时干脆不显示。
			ensureOffsetSize(targetEl);
			view.app.workspace.trigger(HOVER_LINK_EVENT, {
				event,
				source: VIEW_TYPE,
				// HoverParent（官方接口，见 view-context）：核心把弹窗实例挂在
				// 它上面做定位与生命周期管理；传裸 HTMLElement 会失配。
				hoverParent: view.leaf,
				targetEl,
				linktext,
				sourcePath: view.file?.path ?? '',
			});
		},
	);
}

/**
 * 给节点渲染 group 补上 `offsetWidth` / `offsetHeight`（HTMLElement 专有属性，
 * SVG 元素没有）。
 *
 * 官方 `HoverPopover.position()` 的锚定矩形是混合取值的——宽高走
 * `targetEl.offsetWidth/offsetHeight`，位置走 `getBoundingClientRect()`：
 *
 * ```js
 * e = { top: a.top, bottom: a.top + i.offsetHeight, left: a.left, right: a.left + i.offsetWidth }
 * ```
 *
 * SVG 元素没有这两个属性（`undefined`），于是 `bottom`/`right` 变成 `NaN`，而官方
 * 定位函数 `dm()` 判据是 `下方空间 M >= 弹窗高 + gap`（`NaN` 比较恒假）→「下方放得下
 * 就放下方」的分支永不成立：**预览只会出现在上方**；节点贴近视口顶部时上方也放不下，
 * 走到 `top = Math.max(NaN, …) + gap` 分支，被写成 `"NaNpx"`（无效值）→ 看起来完全
 * 没有预览。补上按实时 `getBoundingClientRect()` 取值的只读几何后，核心恢复
 * 「下方优先、下方不足才翻到上方、两侧都不足则限高滚动」的官方规则。
 */
export function ensureOffsetSize(el: Element | null): void {
	if (!el) {
		return;
	}
	for (const prop of ['offsetWidth', 'offsetHeight'] as const) {
		// `in` 走原型链：HTMLElement 自带这两个属性（勿覆盖），SVG 元素才需要补
		if (prop in el) {
			continue;
		}
		Object.defineProperty(el, prop, {
			configurable: true,
			get: () =>
				prop === 'offsetWidth'
					? el.getBoundingClientRect().width
					: el.getBoundingClientRect().height,
		});
	}
}
