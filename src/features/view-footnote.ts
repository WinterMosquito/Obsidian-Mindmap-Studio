/**
 * 脚注引用的**唯一交互入口**（文件视图与只读嵌入共用）。
 *
 * 徽标（`sup.mindmap-node-footnote-ref > a[data-footnote-id]`，见
 * `node-inline-html.buildFootnoteRef`）只有两个动作：**点击**定位到定义节点
 * （`revealNodeByUid`：展开祖先 → 选中 → 居中；无定义时提示一次、不静默）、
 * **悬停**在画布内浮一层定义正文（复用节点正文的段管线）。
 * 五条纪律：① 事件一律挂在**画布 capture** 且命中**外层 `<sup>`**（落在上标盒子
 * 边缘时目标是 sup 而不是内层 a；同 `view-tag`），徽标没有 `href` ⇒ 链接三通道
 * 零改动；② 正文**只在事件发生时**查（段序列按原文寻址缓存），索引从**引擎渲染树**
 * 现算（`collectRenderNodeData`：跳转要 uid，而 uid 只在引擎侧存在），按
 * `node_tree_render_end` 失效缓存、不维护第二份快照；③ 浮层挂在**画布内**、**可交互**
 * （内部链接可点、文字可选中；超长时浮层内滚动，滚轮不交给画布）；④ 悬停调度按
 * **元素身份**判重（同 id 可出现多次），渲染落地只失效索引 / 收起浮层，**不清未决
 * 的 show**（两者都经 2026-11-11 实机复现）；⑤ 编号与未定义态由**渲染后置处理**
 * 应用（`applyFootnoteLabels`）——编号依赖全文引用顺序，构建期必须保持
 * 「同一原文 → 同一 DOM」，不能把文档上下文塞进段序列缓存。
 */
import { Notice } from 'obsidian';
import { FOOTNOTE_PREVIEW_CLASS } from '../core/constants';
import { elementFromTarget, type EventBinder } from '../core/event-binder';
import { tf, type Language } from '../core/i18n';
import type { MindMap } from '../core/engine-types';
import { nodeContinuationIndents, nodeInlineSource } from '../domain/md-meta';
import { collectRenderNodeData, revealNodeByUid } from '../engine/mindmap';
import {
	collectFootnoteDefinitions,
	splitFootnoteDefinitions,
	type FootnoteDefinition,
} from '../markdown/md-footnote';
import {
	FOOTNOTE_ID_ATTR,
	FOOTNOTE_IDS_ATTR,
	FOOTNOTE_REF_CLASS,
	FOOTNOTE_SUMMARY_CLASS,
	buildInlineSegments,
	buildInlineTextContent,
	type InlineContentOptions,
} from './node-inline-content';

/**
 * 命中选择器按**外层 `<sup>`** 的类名，而不是 `[data-footnote-id]`。
 *
 * `data-footnote-id` 只写在内层 `<a>` 上；鼠标落在上标盒子的行高 / padding 区域时
 * 目标是 `<sup>`，`closest('[data-footnote-id]')` 从它**向上**找永远落空 ⇒ 悬停和
 * 点击静默失效（2026-11-11 实机复现）。改成命中 `<sup>` 后：从 `<sup>` 或 `<a>`
 * 出发的 closest 都能回到同一个 `<sup>`，且 `ref.contains(related)` 判断徽标内部
 * 移动时也更准（旧实现 ref 是 `<a>`，从 a 移到 sup 会被误判成移出）。
 */
const REF_SELECTOR = `.${FOOTNOTE_REF_CLASS}`;

/** id 存在内层 `<a>` 上；命中的是外层 `<sup>`（属性名与构建侧同一常量） */
function footnoteIdOf(ref: Element): string {
	return (
		ref.querySelector(`[${FOOTNOTE_ID_ATTR}]`)?.getAttribute(FOOTNOTE_ID_ATTR) ??
		''
	);
}

/** 悬停到弹出之间的延迟：鼠标扫过节点时不该闪一层浮层 */
const SHOW_DELAY_MS = 140;
/** 移出到收起之间的延迟：给「手抖一下」留余量（浮层不吃指针，无需判进入） */
const HIDE_DELAY_MS = 120;

/** 浮层高度上限（超过就在浮层内部滚动，不再往画布上铺） */
const POPOVER_MAX_HEIGHT = 420;
/** 浮层高度下限：画布再矮也保证基本可读，宁可溢出一点 */
const POPOVER_MIN_HEIGHT = 120;
/** 浮层与画布边缘的留白（四个方向统一） */
const POPOVER_MARGIN = 8;
/** 浮层与徽标之间的间距 */
const POPOVER_GAP = 6;

/**
 * 浮层外观（内联：与节点内容同一条「导出/主题快照不可靠」的纪律，见 CONTENT_STYLES）。
 *
 * **可交互**（2026-11-11 用户裁决）：不再是 `pointer-events: none` 的「一张图」——
 * 里面的链接要能点、文字要能选中复制。代价是收起判定要看得更细（移出徽标后若进入
 * 浮层，`mouseenter` 会撤销待执行的 hide；见 `ensurePopover`）。
 *
 * 尺寸上限都以**画布**为准（`%` 相对画布、`maxHeight` 由 `positionPopover` 按画布
 * 高度改写）：只读嵌入的容器可能只有 200px 高，写死 420px 会让浮层溢出容器被裁。
 */
const POPOVER_STYLES: Partial<CSSStyleDeclaration> = {
	position: 'absolute',
	zIndex: '20',
	boxSizing: 'border-box',
	maxWidth: `min(360px, calc(100% - ${POPOVER_MARGIN * 2}px))`,
	/** 初始值；`positionPopover` 会按画布可用高度改写 */
	maxHeight: `${POPOVER_MAX_HEIGHT}px`,
	padding: '8px 10px',
	borderRadius: '6px',
	border: '1px solid var(--background-modifier-border, rgba(128, 128, 128, 0.35))',
	backgroundColor: 'var(--background-primary, #fff)',
	boxShadow: '0 4px 16px rgba(0, 0, 0, 0.18)',
	color: 'var(--text-normal, #222)',
	fontSize: '12px',
	// 画布通常禁选（拖拽语义）；浮层是「读」的区域，必须显式放开，否则文字选不中
	userSelect: 'text',
	overflowX: 'hidden',
	overflowY: 'auto',
	/** 滚到边界后不把滚动交给画布/页面（与 wheel 的 stopPropagation 两道保险） */
	overscrollBehavior: 'contain',
	display: 'none',
};

/** 浮层顶部那条「这是哪条脚注」的标记（沿用徽标的编号 / 截断 id，与节点上一致） */
const POPOVER_LABEL_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'var(--text-muted, #888)',
	fontSize: '11px',
	marginBottom: '4px',
};

/** 预览正文容器：节点内容的缺省内边距/宽度上限在这里不适用（浮层自带内边距） */
const POPOVER_BODY_STYLES: Partial<CSSStyleDeclaration> = {
	padding: '0',
	maxWidth: '100%',
};

/** 「未找到定义」提示（悬停也要有反馈，否则像是浮层坏了） */
const POPOVER_HINT_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'var(--text-muted, #888)',
	fontSize: '12px',
};

/** 显隐两态（见 `hide` 的 lint 说明） */
const POPOVER_VISIBLE_STYLES: Partial<CSSStyleDeclaration> = { display: 'block' };
const POPOVER_HIDDEN_STYLES: Partial<CSSStyleDeclaration> = { display: 'none' };

/**
 * 未定义引用的弱化样式（后置应用，构建期不知道全文有没有这条定义）。
 * 取值链与 `node-inline-html` 的 `UNRESOLVED_LINK_STYLES` 同款：屏上跟主题、
 * 导出时由 CSS 变量注入真值。
 */
const UNRESOLVED_REF_STYLES: Partial<CSSStyleDeclaration> = {
	color: 'var(--link-unresolved-color, var(--link-color, #7f6df2))',
	opacity: 'var(--link-unresolved-opacity, 0.7)',
};

/** 未定义引用外露 id 的最大字符数（超出的按码点截断 + `…`，全文进 `title`） */
const UNRESOLVED_ID_MAX_CHARS = 12;

/** 按码点截断（emoji 等代理对不会被劈开） */
function truncateFootnoteId(id: string): string {
	const chars = Array.from(id);
	return chars.length > UNRESOLVED_ID_MAX_CHARS
		? `${chars.slice(0, UNRESOLVED_ID_MAX_CHARS - 1).join('')}…`
		: id;
}

/** 一次渲染树遍历产出的两份派生数据：定义索引（id → 定义）与引用编号（id → 序数） */
interface FootnoteContext {
	readonly definitions: Map<string, FootnoteDefinition>;
	readonly labels: Map<string, number>;
}

/** 交互所需的宿主面（视图与只读嵌入结构性满足） */
export interface FootnoteInteractionDeps {
	/** 事件绑定器（随宿主生命周期清理） */
	readonly events: EventBinder;
	/** 引擎画布容器（节点内容与浮层的共同祖先） */
	readonly canvasEl: HTMLElement | null;
	readonly lang: Language;
	/** 引擎实例（索引与定位的同一数据源：渲染树 data 带 uid），重建期间可能为 null */
	readonly getMindMap: () => MindMap | null;
	/** 预览的段构建选项（本模块只取同步通道，见下方 `previewOptions`） */
	readonly contentOptions?: InlineContentOptions;
	/**
	 * 打开浮层里的链接（库内 linkpath / 外部 URL 由宿主既有分流处理）。
	 * 浮层不在节点内，`view-wikilink` 的 `node_click` 委托收不到那里的点击，
	 * 故必须由两个宿主各自注入（视图 = `openHyperlink`，嵌入 = 同一实现）。
	 */
	readonly openLink?: (link: string) => void;
}

type FootnoteInlineSeg = ReturnType<typeof buildInlineSegments>[number];

/** 段序列里的引用（含**轻标记子段** children：`**粗[^1]**` 的徽标在里面） */
const collectFromSegments = (
	segments: readonly FootnoteInlineSeg[],
	out: string[],
	depth: number,
): void => {
	if (depth > 3) {
		return; // 与渲染层的 MAX_QUOTE_DEPTH 同量级，防病态嵌套
	}
	for (const segment of segments) {
		if (segment.kind === 'footnote' && segment.footnote) {
			out.push(segment.footnote);
			continue;
		}
		// 轻标记（粗体 / 斜体 / 删除线 / 高亮）的子段：徽标嵌在标记体里时
		// 顶层只看 kind === 'footnote' 会漏，未定义态与编号整体错位
		if (segment.children) {
			collectFromSegments(segment.children, out, depth + 1);
			continue;
		}
		if (segment.kind === 'table' && segment.table) {
			const cells = [
				...segment.table.header,
				...segment.table.rows.flat(),
			];
			for (const cell of cells) {
				collectReferenceIds(cell, out, depth + 1);
			}
			continue;
		}
		if (segment.kind === 'quote' && segment.quote) {
			// 标题也走段管线（`buildCalloutTitle`），里面的徽标同样要占号
			const title = segment.quote.header?.title;
			if (title) {
				collectReferenceIds(title, out, depth + 1);
			}
			collectReferenceIds(segment.quote.body, out, depth + 1);
		}
	}
};

const collectReferenceIds = (
	source: string,
	out: string[],
	depth = 0,
): void => {
	collectFromSegments(buildInlineSegments(source), out, depth);
};

/**
 * 文档序收集脚注引用 id（**纯逻辑**：编号与未定义态的共同输入）。
 *
 * 两个口径与渲染侧同源：
 * - 轻标记里的徽标要递归 `segment.children`（`**粗[^1]**`）；
 * - 先 `splitFootnoteDefinitions` 剥定义行/续行（定义正文里的 `[^2]` 不是引用）。
 *
 * 导出供单测直接钉这两个边界；生产消费方是 `contextOf`（一次遍历同时产定义索引）。
 */
export function collectFootnoteReferenceIds(
	nodes: Iterable<Record<string, unknown>>,
): string[] {
	const ids: string[] = [];
	for (const item of nodes) {
		const source = nodeInlineSource(item);
		if (!source) {
			continue;
		}
		collectReferenceIds(
			splitFootnoteDefinitions(source, nodeContinuationIndents(item)).body,
			ids,
		);
	}
	return ids;
}

/** 装配脚注交互（每个引擎实例一次，随 `events` 销毁；两个宿主各自管理生命周期） */
export function setupFootnoteInteractions(deps: FootnoteInteractionDeps): void {
	const canvasEl = deps.canvasEl;
	if (!canvasEl) {
		return;
	}
	const win = canvasEl.win;
	/**
	 * 只取**同步通道**（链接解析 + 数学/代码的产物缓存）：`renderMath` / `renderCode`
	 * 的异步定稿会走 `content-remeasure` 按 holder 反查引擎节点，浮层不在任何节点里
	 * ⇒ 必然落空。缓存命中则同步放置产物，正是预览想要的效果。
	 */
	const previewOptions: InlineContentOptions = {
		isResolvedLink: deps.contentOptions?.isResolvedLink,
		getCachedMath: deps.contentOptions?.getCachedMath,
		getCachedCode: deps.contentOptions?.getCachedCode,
	};
	/**
	 * 定义索引与引用编号的**合并缓存**：两者都从同一份渲染树数据算，一次遍历
	 * 同时产出（分开算会扫两遍树、读两遍原文）；`node_tree_render_end` 置空，
	 * 下次交互才重建 ⇒ 一次渲染最多一次 O(n)。
	 */
	let cachedContext: FootnoteContext | null = null;
	let renderEndBound = false;
	/**
	 * 引用编号（**按首次引用出现顺序**，与阅读视图一致；命名脚注同样显示数字）。
	 *
	 * 只能后置算：编号依赖全文引用顺序，而段序列按原文寻址缓存——把文档上下文塞进
	 * 构建器会让同一行在不同文档里产出不同段。构建期照旧写 id，渲染落地后由
	 * `applyFootnoteLabels` 改写文本。
	 *
	 * 扫描必须**递归到表格单元格与引用块正文**：那里的脚注段嵌在 `table` / `quote`
	 * 段内部，顶层只看 `kind === 'footnote'` 会漏（实机样本里第 6 枚就在表格里，
	 * 漏掉会让后面所有编号整体前移）。
	 */
	const contextOf = (): FootnoteContext => {
		// `renderEndBound` 为假（拿不到引擎实例的极端时序）⇒ 不缓存，每次交互重算：
		// 没有失效通知时，缓存会把第一份结果永远钉死
		if (cachedContext && renderEndBound) {
			return cachedContext;
		}
		const data = collectRenderNodeData(deps.getMindMap());
		const definitions = collectFootnoteDefinitions(data);
		// 引用 id 的收集（轻标记 children / 定义行剥离）是**纯逻辑**，抽到模块级；
		// 这里只负责与定义索引一起合成编号
		const ids = collectFootnoteReferenceIds(data);
		const labels = new Map<string, number>();
		for (const id of ids) {
			// **只给有定义的引用编号**：未定义引用保持「弱化 + 截断 id」，不能占号
			//（否则它后面所有脚注的编号整体前移，与阅读视图对不上）
			if (!definitions.has(id) || labels.has(id)) {
				continue;
			}
			labels.set(id, labels.size + 1);
		}
		cachedContext = { definitions, labels };
		return cachedContext;
	};
	const indexOf = (): Map<string, FootnoteDefinition> =>
		contextOf().definitions;
	const labelsOf = (): Map<string, number> => contextOf().labels;
	/**
	 * 把编号 / 未定义态**后置**写到已渲染的徽标上（第 3、4 条）。
	 *
	 * 两类写入：有定义的换成编号（**不写 `title` / `aria-label`**：前者弹浏览器原生
	 * 提示、后者被 Obsidian 的全局 tooltip 委托读成黑框，鼠标一停就冒两个提示）；
	 * 没定义的弱化 + 截断 id（全文仍进 `title`）——构建期不知道全文有没有这条定义。
	 * 每次渲染重建 DOM 后都要重跑（文本会被构建期重置回 id）。
	 */
	const applyFootnoteLabels = (): void => {
		const labels = labelsOf();
		const refs = canvasEl.querySelectorAll<HTMLElement>(
			`.${FOOTNOTE_REF_CLASS}`,
		);
		for (const sup of Array.from(refs)) {
			const anchor = sup.querySelector(`[${FOOTNOTE_ID_ATTR}]`);
			const id = anchor?.getAttribute(FOOTNOTE_ID_ATTR) ?? '';
			if (!anchor || !id) {
				continue;
			}
			// 不写 `title`：徽标显示的就是编号，原生白框 `[^1]` 只是已知信息的重复
			const label = labels.get(id);
			const unresolved = label === undefined;
			// 未定义引用：弱化 + 截断（外露原 id 时 193px 的量级会把节点文本撑乱）
			if (unresolved) {
				sup.classList.add('is-unresolved');
			} else {
				sup.classList.remove('is-unresolved');
			}
			if (unresolved) {
				Object.assign(sup.style, UNRESOLVED_REF_STYLES);
			}
			// 只在文本真变化时写：本函数每次渲染都跑，重复写同样文本会触发无谓的
			// 布局失效（引擎重建 DOM 后文本已被重置回 id，这里通常确实要写一次）
			const next = unresolved ? truncateFootnoteId(id) : String(label);
			if (anchor.textContent !== next) {
				anchor.textContent = next;
			}
		}
	};
	let popoverEl: HTMLElement | null = null;
	let showTimer: number | null = null;
	let hideTimer: number | null = null;
	/**
	 * 当前浮层锚定的元素（徽标 `<sup>` 或汇总 chip）。**同一 id 可以在文档里出现
	 * 多次**，判「这次 mouseover 要不要重排」必须看元素身份而不是 id（2026-11-11
	 * 实机复现：从第一枚 `[^1]` 移到第二枚 `[^1]` 时旧实现直接 return，`mouseout`
	 * 排的 hide 照样执行 ⇒ 浮层消失且停在上一个坐标）。
	 */
	let visibleRef: Element | null = null;
	const clearTimers = (): void => {
		if (showTimer !== null) {
			win.clearTimeout(showTimer);
			showTimer = null;
		}
		if (hideTimer !== null) {
			win.clearTimeout(hideTimer);
			hideTimer = null;
		}
	};
	/** 只收起浮层与状态，**不动定时器**（渲染落地时用） */
	const dismiss = (): void => {
		visibleRef = null;
		if (popoverEl) {
			// 逐条 `style.x = '字面量'` 会被 obsidianmd/no-static-styles-assignment
			// 判红（与 node-inline-html 同一写法纪律：一律 Object.assign + 常量表）
			Object.assign(popoverEl.style, POPOVER_HIDDEN_STYLES);
		}
	};
	const hide = (): void => {
		clearTimers();
		dismiss();
	};
	// 渲染落地 = 节点 data 变了（编辑 / 会话广播 / 撤销 / 重排）：失效索引 + 收起已
	// 显示的浮层。⚠ **绝不能在这里 `hide()`**：`node_tree_render_end` 在单节点
	// reRender / 分片渲染上同样派发，而悬停有 140ms 延迟；清掉未决的 showTimer 会让
	// 「鼠标停着、期间恰好重绘一次」的浮层永远不弹（实机复现）。只收起、不清定时器，
	// 排队中的 show 仍会用新索引在新位置弹出来。
	// 引擎重建时本绑定器随宿主销毁；拿不到实例（极端时序）时退化为「每次交互重算」，
	// 正确性不依赖缓存命中（`renderEndBound` 为假 ⇒ indexOf 每次重建）。
	const engine = deps.getMindMap();
	if (engine) {
		renderEndBound = true;
		deps.events.onEngine(engine, 'node_tree_render_end', () => {
			cachedContext = null;
			dismiss();
			// 编号与未定义态后置写入（DOM 已在本事件之前落地；构建期文本是 id）
			applyFootnoteLabels();
		});
	}
	/**
	 * 浮层本体（懒建 + 复用）：只往画布塞一个元素，引擎重建把画布清空时它随之
	 * 消失——`isConnected` 为假就重建，不留悬空引用。
	 */
	const ensurePopover = (): HTMLElement => {
		if (popoverEl?.isConnected) {
			return popoverEl;
		}
		// `createDiv` 是**元素所在窗口**的 Node 原型助手（popout 里也成立），
		// 且直接挂到画布上——不另写 createElement + appendChild
		const el = canvasEl.createDiv({ cls: FOOTNOTE_PREVIEW_CLASS });
		Object.assign(el.style, POPOVER_STYLES);
		// 从徽标移到浮层上不该收起（否则「想点里面的链接」永远够不着）
		el.addEventListener('mouseenter', () => {
			clearTimers();
		});
		el.addEventListener('mouseleave', () => {
			clearTimers();
			hideTimer = win.setTimeout(() => {
				hideTimer = null;
				hide();
			}, HIDE_DELAY_MS);
		});
		// 浮层内滚动归自己：**不** preventDefault（否则滚不动），只挡冒泡——画布上
		// 引擎的 wheel 会 preventDefault 并平移画面
		el.addEventListener(
			'wheel',
			(event) => {
				event.stopPropagation();
			},
			{ passive: true },
		);
		// 浮层里的锚点不在任何节点内，`view-wikilink` 的 node_click 委托收不到，
		// 故由宿主注入的 `openLink` 直接分流（库内 linkpath / 外部 URL 同一入口）
		el.addEventListener('click', (event) => {
			const anchor = elementFromTarget(event.target)?.closest('a');
			if (!anchor) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const link =
				anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '';
			if (link) {
				deps.openLink?.(link);
			}
		});
		popoverEl = el;
		return el;
	};
	/** 浮层条目：`id` + 正文（`body === null` = 未定义，渲染一行提示） */
	const renderPopover = (
		entries: readonly { id: string; body: string | null }[],
	): void => {
		const popover = ensurePopover();
		// 不用 `Element.empty()`：那是宿主打在窗口原型上的助手，popout 场景未必有
		popover.textContent = '';
		// 浮层标签与徽标用**同一套后置编号**：节点上看到 `1`，浮层顶上也是 `1`
		// （2026-11-11 用户反馈：`[^1]` 与实际徽标对不上，像两套系统）；没有编号
		// 的（未定义引用 / 没有引用指向的定义）显示截断 id，与徽标的弱化形态一致
		const labels = labelsOf();
		for (const entry of entries) {
			// `createDiv()` 已经挂到 popover 上，不再 appendChild（真实 DOM 会移动节点、
			// 无痕重复；桩与无头验证则会数出两份）
			const label = popover.createDiv();
			Object.assign(label.style, POPOVER_LABEL_STYLES);
			const number = labels.get(entry.id);
			label.textContent =
				number === undefined ? truncateFootnoteId(entry.id) : String(number);
			if (entry.body === null) {
				// 未定义引用：悬停也要有可见反馈，否则「徽标在、浮层不来」像是坏了。
				// 文案含 `[^id]`，刻意不走段管线（否则会被自己识别成脚注徽标）
				const hint = popover.createDiv();
				Object.assign(hint.style, POPOVER_HINT_STYLES);
				hint.textContent = tf(deps.lang, 'footnote.missingDefinition', {
					id: entry.id,
				});
				continue;
			}
			const body = buildInlineTextContent(
				canvasEl.ownerDocument,
				entry.body,
				deps.lang,
				previewOptions,
			);
			Object.assign(body.style, POPOVER_BODY_STYLES);
			popover.appendChild(body);
		}
	};
	/** 把浮层贴到锚点元素上（画布坐标；下缘放不下时翻到上方） */
	const positionPopover = (ref: Element): void => {
		const popover = ensurePopover();
		// 先可见再量尺寸：display:none 时 offsetWidth 恒 0，钳位会算出负值
		Object.assign(popover.style, POPOVER_VISIBLE_STYLES);
		const canvasRect = canvasEl.getBoundingClientRect();
		const margin = POPOVER_MARGIN;
		// **高度上限按画布收缩**（实机 2026-11-11）：只读嵌入容器可能只有 208px 高，
		// 固定 420px 会让浮层超出容器、被 `overflow: hidden` 裁掉，而 `overflow:auto`
		// 只让浮层内部滚动——超出容器的那截**永远看不到**（实测 211px 浮层裁掉 11px）。
		const maxHeight = Math.max(
			Math.min(POPOVER_MAX_HEIGHT, canvasRect.height - margin * 2),
			POPOVER_MIN_HEIGHT,
		);
		Object.assign(popover.style, { maxHeight: `${maxHeight}px` });
		const refRect = ref.getBoundingClientRect();
		const width = popover.offsetWidth;
		const height = popover.offsetHeight;
		const left = Math.min(
			Math.max(refRect.left - canvasRect.left, margin),
			Math.max(canvasRect.width - width - margin, margin),
		);
		// 默认贴在徽标下方；画布下缘放不下时翻到上方（宁可压住上一行也不越界被裁）
		let top = refRect.bottom - canvasRect.top + POPOVER_GAP;
		if (top + height > canvasRect.height - margin) {
			top = Math.max(
				refRect.top - canvasRect.top - height - POPOVER_GAP,
				margin,
			);
		}
		Object.assign(popover.style, {
			left: `${left}px`,
			top: `${top}px`,
		});
		visibleRef = ref;
	};
	/** 填内容 + 定位（徽标与汇总 chip 的公共动作，避免两处重复这两步） */
	const showEntries = (
		ref: Element,
		entries: readonly { id: string; body: string | null }[],
	): void => {
		renderPopover(entries);
		positionPopover(ref);
	};
	const show = (ref: Element, id: string): void => {
		const def = indexOf().get(id);
		showEntries(ref, [{ id, body: def?.body ?? null }]);
	};
	/** 汇总 chip：一次列出该节点里的**全部定义**（第 6 条的展开入口） */
	const showSummary = (ref: Element, ids: readonly string[]): void => {
		const index = indexOf();
		showEntries(
			ref,
			ids.map((id) => ({ id, body: index.get(id)?.body ?? null })),
		);
	};

	/** 汇总 chip 命中：返回元素与它承载的定义 id 列表（第 6 条的展开入口） */
	const summaryOf = (
		target: EventTarget | null,
	): { el: Element; ids: string[] } | null => {
		const el = elementFromTarget(target)?.closest(`.${FOOTNOTE_SUMMARY_CLASS}`);
		if (!el) {
			return null;
		}
		// 分隔符是换行而不是逗号：id 允许含逗号（见 FOOTNOTE_IDS_ATTR 的说明），
		// 也不能 trim——id 两侧的空白属于 id 本身（`[^ a ]` 是合法 id）
		const ids = (el.getAttribute(FOOTNOTE_IDS_ATTR) ?? '')
			.split('\n')
			.filter((id) => id.length > 0);
		return ids.length > 0 ? { el, ids } : null;
	};

	deps.events.onDom(
		canvasEl,
		'mouseover',
		(event) => {
			const summary = summaryOf(event.target);
			if (summary) {
				clearTimers();
				if (summary.el === visibleRef) {
					return;
				}
				showTimer = win.setTimeout(() => {
					showTimer = null;
					showSummary(summary.el, summary.ids);
				}, SHOW_DELAY_MS);
				return;
			}
			const ref = elementFromTarget(event.target)?.closest(REF_SELECTOR);
			if (!ref) {
				return;
			}
			const id = footnoteIdOf(ref);
			if (!id) {
				return;
			}
			// **先无条件清定时器**：移出后又移回同一枚徽标时，待执行的 hide 必须撤销，
			// 否则浮层会自己消失；同 id 的**不同**徽标则要靠下面的元素身份判据重排。
			clearTimers();
			if (ref === visibleRef) {
				return; // 浮层已锚在这枚徽标上，不用重弹
			}
			showTimer = win.setTimeout(() => {
				showTimer = null;
				show(ref, id);
			}, SHOW_DELAY_MS);
		},
		true,
	);

	deps.events.onDom(
		canvasEl,
		'mouseout',
		(event) => {
			const summary = summaryOf(event.target);
			const ref =
				summary?.el ??
				elementFromTarget(event.target)?.closest(REF_SELECTOR) ??
				null;
			if (!ref) {
				return;
			}
			// 在徽标内部移动（sup → a）不算移出
			const related = elementFromTarget(event.relatedTarget);
			if (related && ref.contains(related)) {
				return;
			}
			clearTimers();
			hideTimer = win.setTimeout(() => {
				hideTimer = null;
				hide();
			}, HIDE_DELAY_MS);
		},
		true,
	);

	/** 目标是否落在浮层内：那里的滚轮/按下是「读」（滚长文、选字），不该收起浮层 */
	const inPopover = (target: EventTarget | null): boolean =>
		!!elementFromTarget(target)?.closest(`.${FOOTNOTE_PREVIEW_CLASS}`);
	// 缩放 / 平移 / 按下都会让浮层的位置失去意义（画布变换后 rect 已过期）
	deps.events.onDom(
		canvasEl,
		'wheel',
		(event) => {
			if (inPopover(event.target)) {
				return;
			}
			hide();
		},
		true,
	);
	deps.events.onDom(
		canvasEl,
		'mousedown',
		(event) => {
			if (inPopover(event.target)) {
				return;
			}
			hide();
		},
		true,
	);

	deps.events.onDom(
		canvasEl,
		'click',
		(event) => {
			const summary = summaryOf(event.target);
			if (summary) {
				event.preventDefault();
				event.stopPropagation();
				hide();
				showSummary(summary.el, summary.ids);
				return;
			}
			const ref = elementFromTarget(event.target)?.closest(REF_SELECTOR);
			if (!ref) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			hide();
			const id = footnoteIdOf(ref);
			const def = indexOf().get(id);
			if (!def) {
				// 未定义引用是**可见事实**（徽标照常显示），点击必须给出解释
				new Notice(tf(deps.lang, 'footnote.missingDefinition', { id }));
				return;
			}
			// **不再闪烁**（2026-11-11 实机裁决）：定义行已折叠成 chip / 被渲染剥离，
			// 跳过去看不到任何脚注正文，「到了」的闪动没有信息价值，只剩视觉噪音；
			// 选中描边 + 居中已经完成定位反馈。
			if (!revealNodeByUid(deps.getMindMap(), def.uid)) {
				// 定义存在但引擎没接住定位（方法缺失 / 渲染树未就绪），与「无定义」区分
				new Notice(tf(deps.lang, 'footnote.revealFailed', { id }));
			}
		},
		true,
	);
}
