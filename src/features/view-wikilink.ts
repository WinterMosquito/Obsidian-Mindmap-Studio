/**
 * wikilink 交互（方案 A）：导图节点悬停预览 + 链接点击跳转，
 * 行为对齐 Obsidian 阅读视图 + 官方修饰键表（User interface / Tabs）：
 * - 悬停含**内部链接**的节点 → workspace 'hover-link'（Obsidian 原生页面预览 /
 *   附件预览）。三类节点等价：文档双链与文档嵌入（mdWikiLinkpath）、双链附件 /
 *   嵌入附件 / 拖入的库内附件（attachmentUrl 回形针通道）、外链节点不触发
 *   （core 只服务库内目标）；挂在引擎 node_mouseenter 事件上（事件源在引擎层，
 *   不依赖 DOM 冒泡），按住鼠标键（拖拽/框选）时不触发；**两级触发面**（2026-09-16
 *   定稿）：指针在节点内某枚锚点上 → 预览**那一枚**（一行多链接 / 首链为外链时的
 *   行内库内 md 链接只有锚点知道目标；节点内移动由画布 mouseover 委托补齐），
 *   锚点不是库内目标或指针不在锚点上 → 节点级兜底（`nodeLink` 三通道）。两条路径
 *   都**不做解析预检**（目标存在性交核心），否则会出现「悬停什么都不弹」;
 * - 点击修饰键（与官方表逐行对应）：无修饰＝当前标签；`Ctrl/Cmd`＝新标签；
 *   `Ctrl/Cmd+Alt`＝新标签组；`Ctrl/Cmd+Alt+Shift`＝新窗口。
 *   `Shift`/`Alt` **单独**按下时不接管（官方表只在 Source 模式下让 Shift 参与
 *   「新标签」，本视图无 Source 模式；节点选择语义交回引擎）；
 * - 普通左键点击节点内渲染的 <a> 链接文本（internal-link/external-link）→
 *   当前标签页打开目标（与 Obsidian 点击链接一致）。
 *
 * 前置：main.ts 已 registerHoverLinkSource(VIEW_TYPE)，否则 core 忽略 hover-link。
 */
import { Keymap } from 'obsidian';
import { HOVER_LINK_EVENT, VIEW_TYPE } from '../core/constants';
import { formatWikilink, wikilinkLinkpath } from '../domain/wikilink';
import { getNodeDataString, getNodeGroupEl } from '../engine/mindmap';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { HyperlinkOpenMode, MindMapViewContext } from './view-context';

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
export function nodeLink(node: MindMapNode): NodeLinkRef | null {
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

/**
 * 触发页面预览（悬停节点与悬停节点内锚点共用）。
 *
 * 去重按**目标元素**（节点 group 或节点内锚点）：鼠标沿元素边缘抖动会连发
 * mouseenter/mouseover，每次重开弹窗会闪烁，故同一元素 400ms 内只触发一次。
 * 预览弹窗的上下翻转由核心按 targetEl 的矩形决定——锚点自带 offsetWidth/
 * offsetHeight，而 SVG 节点 group 没有，故统一经 ensureOffsetSize 补齐。
 */
function triggerHoverPreview(
	view: MindMapViewContext,
	targetEl: Element,
	linktext: string,
	event: MouseEvent,
): void {
	const now = Date.now();
	const state = hoverPreviewStates.get(view) ?? { el: null, at: 0 };
	hoverPreviewStates.set(view, state);
	if (targetEl === state.el && now - state.at < HOVER_DEBOUNCE_MS) {
		return;
	}
	state.el = targetEl;
	state.at = now;
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
}

/**
 * 节点内锚点的库内 linktext（null = 该锚点不是库内目标）。
 *
 * 复用点击路径的 `resolveAnchorLink`（`data-href` → `[[linkpath]]`），再经
 * `wikilinkLinkpath` 取核心要的 linktext：裸 URL / 协议地址解析不出库内目标 →
 * null（核心只服务库内目标，与阅读视图一致）。
 *
 * **不做解析预检**：目标是否存在交核心判断（插件侧再拦一次会让悬停静默无反应，
 * 见 AGENTS K21 的 2026-09-16 回撤记录）。
 */
function anchorLinktext(anchor: HTMLAnchorElement): string | null {
	return wikilinkLinkpath(resolveAnchorLink(anchor));
}

/**
 * 事件修饰键 → 打开落点（官方 `Keymap.isModEvent`——官方帮助
 * 「User interface / Tabs」修饰键表的**官方实现**：`Cmd/Ctrl`＝新标签、
 * `+Alt`＝新标签组、`+Alt+Shift`＝新窗口，无修饰返回 false）。
 * 返回 null 表示**无修饰键**，走既有的「普通左键点击」分支。
 *
 * 官方对**中键**也返回 'tab'，但中键在本插件有独立通道（画布 `auxclick`
 * → 仅命中节点内锚点时新标签打开，见下方注册处）；此处以 `button === 0`
 * 前置判定隔离，`node_click` 路径不与中键通道重复接管。
 * `Shift`/`Alt` **单独**按下不参与——官方表只在 Source 模式下让 Shift 加入
 * 「新标签」，本视图没有 Source 模式，故交回引擎的节点选择语义。
 */
function hyperlinkOpenMode(event: MouseEvent): HyperlinkOpenMode | null {
	if (event.button !== 0) {
		return null;
	}
	const mode = Keymap.isModEvent(event);
	// 官方返回 `PaneType | boolean`：非字符串即「无修饰键」（false）
	return typeof mode === 'string' ? mode : null;
}

/** 锚点选择器（节点内自绘锚点与引擎原生锚点共用） */
const ANCHOR_SELECTOR = 'a.internal-link, a.external-link, a[href]';

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
		// 修饰键 + 点击：节点任意位置都算（无锚点时退回节点链接，沿用既有行为），
		// 落点按官方修饰键表分流（新标签 / 新标签组 / 新窗口）
		const mode = hyperlinkOpenMode(event);
		if (mode !== null) {
			const link =
				anchor !== null
					? resolveAnchorLink(anchor)
					: (nodeLink(node)?.link ?? '');
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			view.openHyperlink(link, mode);
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
			// 两级取值（**锚点优先，节点级兜底**）：
			//
			// ① 指针落在节点内某枚锚点上 → 预览**那一枚**：一行多链接时每枚目标不同
			//    （md 链接指向库内路径、第二枚双链等），只有锚点自己知道目标——节点级
			//    取「首链」会与所见错位，且首链是外链时（`[站点](https://…) 与 [文档](笔记.md)`）
			//    整个节点都取不到库内目标、悬停「文档」毫无反应（2026-09-16 实测反馈）。
			//    锚点不是库内目标（外链/畸形）时**继续下滑**到节点级兜底，而非直接放弃。
			// ② 否则（节点任意其它位置）→ 预览该节点承载的链接（三通道见 nodeLink）。
			//    自绘节点同样如此：带链接的节点普遍被自绘接管（方案 B），只做锚点级
			//    会让「悬在节点上」什么都不弹（此前的回撤原因）。
			const anchor = findAnchorInNode(node, event);
			if (anchor) {
				const anchorText = anchorLinktext(anchor);
				if (anchorText) {
					triggerHoverPreview(view, anchor, anchorText, event);
					return;
				}
			}
			const linktext = nodeLink(node)?.linktext;
			if (!linktext) {
				return;
			}
			const targetEl = getNodeGroupEl(node);
			if (!targetEl) {
				return;
			}
			triggerHoverPreview(view, targetEl, linktext, event);
		},
	);

	if (view.canvasEl) {
		// 节点内锚点之间的移动：引擎只在「进入节点」时发 node_mouseenter，指针在
		// 节点**内部**从节点体移到某枚锚点、或从一枚锚点移到另一枚，都不会重新触发
		// → 画布委托 mouseover 补齐「锚点优先」这一级（目标识别与点击路径同源：
		// `anchorLinktext` → `resolveAnchorLink`；非库内目标交回节点级，不重复处理）。
		view.engineEvents.onDom(view.canvasEl, 'mouseover', (event) => {
			if (event.buttons) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			const anchor = target.closest(ANCHOR_SELECTOR);
			if (!(anchor instanceof HTMLAnchorElement)) {
				return;
			}
			const linktext = anchorLinktext(anchor);
			if (!linktext) {
				return;
			}
			triggerHoverPreview(view, anchor, linktext, event);
		});
		// 中键点击链接 → 新标签打开（Obsidian 应用行为：阅读视图里中键即新标签；
		// 官方帮助未单列该键位，行为随应用）。走 auxclick（中键不触发 click），
		// 仅命中锚点时接管，其余区域交回引擎（避免破坏中键平移）。
		view.engineEvents.onDom(view.canvasEl, 'auxclick', (event) => {
			if (event.button !== 1) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}
			const anchor = target.closest(ANCHOR_SELECTOR);
			if (!(anchor instanceof HTMLAnchorElement)) {
				return;
			}
			const link = resolveAnchorLink(anchor);
			if (!link) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			view.openHyperlink(link, 'tab');
		});
	}
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
