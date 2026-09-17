/**
 * simple-mind-map 引擎封装：实例创建/销毁、节点工具、自动整理（重置布局）。
 * 主题配置见 mindmap-theme.ts（本文件 re-export，调用方 import './mindmap' 不变）。
 */
import {
	AssociativeLine,
	DoExport,
	Drag,
	KeyboardNavigation,
	MindMap,
	MindMapNode,
	MindMapOptions,
	MindMapTreeNode,
	Search,
	Select,
	TouchEvent,
} from '../../vendor/simple-mind-map.cjs';
import { getThemeConfig, isDarkTheme, getDocIconColor } from './mindmap-theme';
import { t, type Language } from '../core/i18n';
import { walkTree } from '../domain/tree';
import { docWikiLinkDisplay, type WikiAliasSource } from '../domain/wiki-display';
import {
	RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS,
	RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS,
	RESET_LAYOUT_VIEWPORT_DELAY_MS,
	shouldEnablePerformanceMode,
} from '../core/constants';

export {
	getThemeConfig,
	isDarkTheme,
	supportsLineStyleSwitch,
} from './mindmap-theme';

/**
 * 引擎命令名常量：execCommand 的魔法字符串收口于此。
 * 此前命令名散布 7 个文件共 18 处，拼写错误只能运行期发现、
 * 引擎升级时无法编译期定位影响面；统一经本表引用后：
 * - 属性名拼错编译期即报错；
 * - 引擎升级改命令名时只改本表并按引用定位调用点。
 */
export const ENGINE_COMMANDS = {
	/** 撤销 */
	BACK: 'BACK',
	/** 重做 */
	FORWARD: 'FORWARD',
	/**
	 * 清除激活节点（引擎内部命令，**不进历史**——引擎 `setData`/撤销/主题切换
	 * 都用它；换树后旧节点引用作废，留着会让后续操作作用在游离节点上）。
	 */
	CLEAR_ACTIVE_NODE: 'CLEAR_ACTIVE_NODE',
	/** 插入子节点（可 appointNodes 指定父节点与初始数据） */
	INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
	/** 插入同级节点 */
	INSERT_NODE: 'INSERT_NODE',
	/** 删除激活节点 */
	REMOVE_NODE: 'REMOVE_NODE',
	/** 重置布局（清除自由拖拽位置，不打乱 children 顺序） */
	RESET_LAYOUT: 'RESET_LAYOUT',
	/** 更新节点数据字段 */
	SET_NODE_DATA: 'SET_NODE_DATA',
	/** 设置节点超链接（空串清除） */
	SET_NODE_HYPERLINK: 'SET_NODE_HYPERLINK',
	/** 设置节点图片（SetNodeImageOptions） */
	SET_NODE_IMAGE: 'SET_NODE_IMAGE',
} as const;

export interface CreateMindMapOptions {
	layout: string;
	/** 连线样式偏好（auto/curve/direct/straight；auto＝随布局） */
	lineStyle: string;
	themePref: string;
	isDark: boolean;
	enableDrag: boolean;
	performanceMode: boolean;
	performanceThreshold: number;
	lang: Language;
	onHyperlinkJump?: ((link: string, node: MindMapNode) => void) | null;
	/**
	 * **节点内联内容**（方案 B 原型，可选）：返回元素即**完全接管**该节点内容
	 * ——引擎跳过 text/image/icon/hyperlink/tag/note/prefix/postfix 的全部默认
	 * 渲染，元素被包进 foreignObject 并按「离屏克隆 + getBoundingClientRect」
	 * 测宽（引擎 `measureCustomNodeContentSize`）；返回 null 的节点走引擎默认
	 * SVG 文本（纯文本节点零成本）。
	 *
	 * 引擎侧契约（0.14.0-fix.3 bundle 实测）：`opt.isUseCustomNodeContent: true`
	 * + `opt.customCreateNodeContent = (node) => HTMLElement | null`——两键均未入
	 * d.cts，与 createNodePrefixContent 同口径经 Object.assign 注入；
	 * 返回非空时该节点无 `_textData`，`textEdit.show()` 有
	 * `isUseCustomNodeContent()` 守卫 → **双击不进入引擎编辑框**（静默无响应）。
	 *
	 * `doc` 恒为**画布所在 document**（popout 场景见 buildWikiDocIcon 注释）；
	 * `style` 为该节点合并后的主题样式（自绘内容必须自带字号/颜色）；
	 * `lang` 为当前语言（超长截断提示等文案用）。
	 */
	createNodeContent?:
		| ((
				node: MindMapNode,
				doc: Document,
				style: NodeContentStyle,
				lang: Language,
		  ) => HTMLElement | null)
		| null;
}

/** 自绘节点内容可用的主题样式（引擎 style 合并结果，解析收口在 mindmap.ts） */
export interface NodeContentStyle {
	/** CSS 长度（引擎可能给数字，已归一为 '13px' 形态） */
	fontSize?: string;
	color?: string;
	fontWeight?: string;
}

/**
 * 命令历史的**单视图堆内存预算**：引擎逐条保存「整树 JSON 快照」，每条堆占用
 * ≈ 节点数 × `HISTORY_SNAPSHOT_BYTES_PER_NODE`（K65 实测），固定条数上限会让
 * 单视图历史随图规模失控（旧策略：<2000 节点 500 条 ⇒ 500 节点图 ≈ 91MB/视图）。
 *
 * 为什么按预算反推、而不按节点数分档：分档在档位边界有跳变，且档内仍是
 * 「上限 × 每条字节」——旧两档里 500 节点图（≈91MB）反而比 2000 节点图（≈70MB）
 * 更重，最典型的几百节点图恰是缓冲最松的一档（K66）。
 */
export const HISTORY_BUDGET_BYTES = 30 * 1024 * 1024;
/** 单条快照的堆字节 ≈ 节点数 × 本系数（K65 实测 500 节点 ≈ 182KB ⇒ 373B/节点；上取整留字段漂移余量） */
export const HISTORY_SNAPSHOT_BYTES_PER_NODE = 384;
/** 引擎默认上限（vendor `opt.maxHistoryCount` 初值）：预算宽裕时不去抬高它 */
const HISTORY_DEFAULT_MAX_COUNT = 500;
/** 撤销深度下限：预算再紧也保底这么多步（大图上「连改两下就没得撤」不可接受） */
const HISTORY_MIN_COUNT = 30;

/**
 * 按节点数反推命令历史上限（`maxHistoryCount`）：把单视图历史内存钉在
 * `HISTORY_BUDGET_BYTES` 内（条数向下取整），并 clamp 到 [下限, 引擎默认]。
 *
 * 实测对照：500 节点 ⇒ 163 条（91MB→30MB）、2000 节点 ⇒ 40 条（70MB→30MB）；
 * ≥2731 节点落入下限 30 条（地板之上不再封顶——要完全封顶需引擎只存 diff，
 * 属 vendor 内部；见 K66）。
 *
 * 导出供 `--perf` 内存轮断言「预算确实应用」与 `tests/engine-history-limit.test.ts`
 * 使用；生产路径只经 `createMindMap` 调用。
 */
export function resolveHistoryLimit(nodeCount: number): number {
	const perSnapshot = Math.max(1, nodeCount) * HISTORY_SNAPSHOT_BYTES_PER_NODE;
	const affordable = Math.floor(HISTORY_BUDGET_BYTES / perSnapshot);
	return Math.min(
		HISTORY_DEFAULT_MAX_COUNT,
		Math.max(HISTORY_MIN_COUNT, affordable),
	);
}

// ---------------------------------------------------------------------------
// 双链文档节点：文字之前的文档页图标
//
// 链接三类图标策略：URL → 引擎原生链接图标；双链指向附件 → 引擎 attachmentUrl
// （原生回形针）；双链指向文档 → 本前缀内容自绘文档页图标（三类两两可辨）。
// 文档双链不写引擎 hyperlink（否则原生链接图标会与自绘图标双显，见 md-outline）。
//
// 契约（0.14.0-fix.3 bundle 实测，headless 验证）：
// opt.createNodePrefixContent = (node) => { el, width, height } | null，
// 内容排在节点文字**之前**并计入测宽（无需 padding 预留位）；el 被引擎放进
// foreignObject（HTML 上下文），因此必须是 `<svg>` 根元素——裸 `<g>` 不渲染。
// 未入 d.cts，经 Object.assign 注入（防腐透传，与 themeConfig 同口径）。
// ---------------------------------------------------------------------------

/**
 * 性能模式（虚拟渲染）的引擎配置：**创建与运行时切换共用一份**，避免两处漂移。
 * - `time`：引擎对「视口变化后重渲染可见节点」的内部节流窗口——**创建时被
 *   `bindEvent` 捕获**，运行时改它不会生效（切换性能模式无需改它）；
 * - `padding`：视口外判定余量；`removeNodeWhenOutCanvas`：视口外节点是否摘出 DOM。
 */
const PERFORMANCE_CONFIG = {
	time: 200,
	padding: 150,
	removeNodeWhenOutCanvas: true,
} as const;

const WIKI_DOC_ICON_SIZE = 18;
/** 图标 viewBox 边长（路径按 24 网格绘制，缩放到 WIKI_DOC_ICON_SIZE 显示） */
const WIKI_DOC_ICON_VIEWBOX = 24;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 文档页图标（折角页 + 页脚线，feather file-text 风格） */
const WIKI_DOC_ICON_PATH =
	'M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 0v5h5M9 13h6M9 17h6';

/**
 * 构造文档页图标（`<svg>` 根元素，见上方契约说明）。
 *
 * `doc` 必须是**画布所在的 document**（调用点传 `el.ownerDocument`），
 * 不能用全局 `document`：同一视图可被拖入 popout 窗口，此时全局 document
 * 与画布所在文档并非同一个；跨文档创建再挂载的 SVG 在 popout 中不渲染、
 * 也不响应事件。元素级 API 的 `ownerDocument` 永远指向元素自己的文档，
 * 是 popout 场景下的正确来源。
 */
function buildWikiDocIcon(
	doc: Document,
	link: string,
	title: string,
	color: string,
	onOpen: (link: string) => void,
): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('xmlns', SVG_NS);
	svg.setAttribute('width', String(WIKI_DOC_ICON_SIZE));
	svg.setAttribute('height', String(WIKI_DOC_ICON_SIZE));
	svg.setAttribute(
		'viewBox',
		`0 0 ${WIKI_DOC_ICON_VIEWBOX} ${WIKI_DOC_ICON_VIEWBOX}`,
	);
	svg.classList.add('mindmap-wiki-doc-icon');
	const path = doc.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', WIKI_DOC_ICON_PATH);
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', color);
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(path);
	// 透明命中区：扩大可点范围至整个图标方块（细线难点中）
	const hit = doc.createElementNS(SVG_NS, 'rect');
	hit.setAttribute('width', String(WIKI_DOC_ICON_VIEWBOX));
	hit.setAttribute('height', String(WIKI_DOC_ICON_VIEWBOX));
	hit.setAttribute('fill', 'transparent');
	svg.appendChild(hit);
	const tip = doc.createElementNS(SVG_NS, 'title');
	tip.textContent = title || link;
	svg.appendChild(tip);
	svg.addEventListener('click', (event) => {
		// 阻断节点选中语义：图标点击 = 打开目标
		event.stopPropagation();
		onOpen(link);
	});
	return svg;
}

/**
 * 解析节点当前生效的字号/颜色/字重（自绘节点内容用）。
 *
 * 引擎对自绘节点跳过默认文本渲染，故内容必须自带样式；`node.style.merge(key)`
 * 合并「主题配置 + 节点自定义样式」，是节点文本实际使用的样式来源
 * （引擎文本编辑框同款取法）。`style` 为引擎内部字段，访问收口在本文件。
 */
function resolveNodeContentStyle(node: MindMapNode): NodeContentStyle {
	const style = (
		node as unknown as { style?: { merge?: (key: string) => unknown } }
	).style;
	const fontSize = normalizeFontSize(style?.merge?.('fontSize'));
	const color = style?.merge?.('color');
	const fontWeight = style?.merge?.('fontWeight');
	return {
		...(fontSize ? { fontSize } : {}),
		...(typeof color === 'string' && color ? { color } : {}),
		...(typeof fontWeight === 'string' && fontWeight ? { fontWeight } : {}),
	};
}

/** 字号归一为 CSS 长度（引擎可能给数字或字符串；非法值返回空串） */
function normalizeFontSize(value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
		return `${value}px`;
	}
	if (typeof value === 'string' && value.trim()) {
		return value;
	}
	return '';
}

/**
 * 创建思维导图实例并注册引擎插件。
 * 视图场景：选择、触控、关联线、键盘导航、导出、搜索全部启用；
 * 节点拖拽按设置启用。
 */
export function createMindMap(
	el: HTMLElement,
	data: MindMapTreeNode,
	options: CreateMindMapOptions,
): MindMap {
	const dark = isDarkTheme(options.themePref, options.isDark);
	// 节点数两处使用：性能模式的阈值判据 + 命令历史上限（见文件末的 addPlugin 之后）
	const nodeCount = countTreeNodes(data);
	const performanceEnabled = shouldEnablePerformanceMode(
		nodeCount,
		options.performanceMode,
		options.performanceThreshold,
	);
	/** 节点内联内容渲染器（方案 B 原型；null = 全部节点走引擎默认文本） */
	const createNodeContent = options.createNodeContent ?? null;

	const mindMap = new MindMap(
		Object.assign(
			{
				el,
				data,
				layout: options.layout,
				theme: 'default',
				themeConfig: getThemeConfig(dark, options.layout, options.lineStyle),
				// 不在创建时 fit 全图：打开后的默认视口由 centerContentAtFullScale
				// 统一设置（100% + **整体内容**居中）。注意引擎布局默认
				// initRootNodePosition=[center,center]，首次布局会把根节点摆在
				// 画布中心，故视口必须在首次布局落地时立即应用（engine-controller
				// 的 node_tree_render_end 处理），否则会先亮「根居中」再跳
				fit: false,
				defaultInsertSecondLevelNodeText: t(options.lang, 'default.secondLevel'),
				defaultInsertBelowSecondLevelNodeText: t(
					options.lang,
					'default.belowSecondLevel',
				),
				openPerformance: performanceEnabled,
				performanceConfig: { ...PERFORMANCE_CONFIG },
				enableFreeDrag: options.enableDrag,
				customHyperlinkJump: options.onHyperlinkJump ?? null,
			} satisfies MindMapOptions,
			{
				// 画布导航（官方 Canvas「Navigate the canvas」）**由引擎实现**，这里显式
				// 钉住官方语义，不依赖「引擎默认值恰好一致」（升级换默认值时行为会悄悄变）：
				// 滚轮 = 平移（官方 :227）、`Ctrl/Cmd + 滚轮` = 以指针为锚缩放（:231，
				// 故 disableMouseWheelZoom 必须为 false）。中键拖拽（:226）走引擎 event
				// 模块的 isMiddleMousedown → drag，无对应选项。
				// 插件侧**不得**再注册 wheel / pointer 平移（会双重生效或成死代码，
				// 见 features/view-viewport.ts 文件头；契约测试 tests/vendor-contract）。
				mousewheelAction: 'move',
				disableMouseWheelZoom: false,
			},
			{
				// 双链文档图标（契约与防腐说明见上方常量区注释）；
				// 字段未入 d.cts，经 Object.assign 注入避免类型断言
				createNodePrefixContent: (node: MindMapNode) => {
					const nodeData = node.getData() as WikiAliasSource | null;
					const wikiLink =
						typeof nodeData?.mdWikiLinkpath === 'string'
							? nodeData.mdWikiLinkpath
							: '';
					if (!nodeData || !wikiLink) {
						return null;
					}
					// tooltip 与节点可见名走**同一入口**（domain/wiki-display）：
					// 未编辑＝原显示名，编辑改别名后＝新别名。图标 <title> 只在
					// 节点前缀创建时写一次，若这里改读 mdLinkText（解析时快照），
					// 编辑后的 tooltip 会停留在旧别名直到重载。
					const title = docWikiLinkDisplay(nodeData) ?? '';
					return {
						el: buildWikiDocIcon(
							el.ownerDocument,
							wikiLink,
							title,
							getDocIconColor(dark),
							(link) => options.onHyperlinkJump?.(link, node),
						),
						width: WIKI_DOC_ICON_SIZE,
						height: WIKI_DOC_ICON_SIZE,
					};
				},
				// 节点内联内容（方案 B 原型）：契约见 CreateMindMapOptions.createNodeContent。
				// `isUseCustomNodeContent` 是引擎开关（默认 false），只有它为真时引擎才会
				// 调用 customCreateNodeContent；后者返回非空 = 完全接管该节点内容，
				// 返回 null 的节点回落引擎默认 SVG 文本。两键均未入 d.cts。
				isUseCustomNodeContent: createNodeContent !== null,
				customCreateNodeContent: createNodeContent
					? (node: MindMapNode) =>
							createNodeContent(
								node,
								el.ownerDocument,
								resolveNodeContentStyle(node),
								options.lang,
							)
					: null,
			},
		),
	);

	// 引擎 resize 在容器宽/高为 0 时直接抛错（Obsidian 布局切换、标签切换等
	// 场景容器可能瞬时 0 尺寸，控制台报「容器元素el的宽高不能为0」）。
	// 包一层守卫：尺寸非法时跳过，避免未捕获异常与无意义的重渲染；
	// 尺寸恢复后的下一次 resize 会正常执行。
	const originalResize = mindMap.resize.bind(mindMap);
	mindMap.resize = () => {
		if (el.offsetWidth > 0 && el.offsetHeight > 0) {
			originalResize();
		}
	};

	mindMap.addPlugin(Select);
	mindMap.addPlugin(TouchEvent);
	mindMap.addPlugin(AssociativeLine);
	mindMap.addPlugin(KeyboardNavigation);
	mindMap.addPlugin(DoExport);
	mindMap.addPlugin(Search);
	if (options.enableDrag) {
		mindMap.addPlugin(Drag);
	}
	// 命令历史内存控制：每步一条「整树 JSON 快照」，固定条数上限会让单视图历史
	// 内存随图规模失控（旧策略 500 条 × 500 节点 ≈ 91MB，见 K65/K66）。上限按
	// 内存预算反推（resolveHistoryLimit），只在低于引擎默认时下调。opt 是活引用，
	// 立即生效（历史此时尚空，无裁剪丢失）。
	const historyLimit = resolveHistoryLimit(nodeCount);
	if (historyLimit < HISTORY_DEFAULT_MAX_COUNT) {
		mindMap.updateConfig({ maxHistoryCount: historyLimit });
	}
	// 引擎 KeyboardNavigation 插件自带 Ctrl+L = RESET_LAYOUT（只重排、不含
	// 「适应画布」、也无提示），与插件「自动整理」命令口径不一；而本插件不定义
	// 默认热键（命令一律由用户在 Hotkeys 中自行分配）。故移除它——自动整理统一
	// 走 mindmap-arrange 命令，用户把它绑到 Ctrl+L 时同样以「适应画布」收尾。
	removeEngineShortcut(mindMap, 'Control+l');
	return mindMap;
}

/**
 * 移除引擎自带的默认热键（本插件不定义默认热键）。
 *
 * `keyCommand` 未入 d.cts（引擎运行时字段）：经结构性类型访问，缺省或换版本时
 * 静默跳过——与现有防腐口径一致，不做类型断言穿透声明面。
 */
function removeEngineShortcut(mindMap: MindMap, shortcut: string): void {
	const keyCommand = (
		mindMap as unknown as {
			keyCommand?: { removeShortcut?: (key: string) => void };
		}
	).keyCommand;
	keyCommand?.removeShortcut?.(shortcut);
}

/**
 * 容器的实时矩形（left/top/width/height，CSS 像素；不可得返回 null）。
 *
 * 引擎只在创建与 `resize()` 时把容器矩形缓存进 `elRect`/`width`/`height`
 * （vendor `getElRectInfo`）；首帧之后工作区布局 settle、md 模式工具栏
 * 重建都会改容器尺寸/位置，缓存随即失真。而首帧居中的缩放锚点与内容
 * 包围盒的换算基准都取容器几何——一旦陈旧，内容就按「旧画布中心 + 旧容器
 * 原点」摆放，表现为打开即偏移（点「适应画布」才拉回）。
 */
function getLiveCanvasRect(
	mindMap: MindMap,
): { left: number; top: number; width: number; height: number } | null {
	const el = (mindMap as unknown as { el?: HTMLElement | null }).el;
	if (!el || typeof el.getBoundingClientRect !== 'function') {
		return null;
	}
	const rect = el.getBoundingClientRect();
	if (!(rect.width > 0) || !(rect.height > 0)) {
		return null;
	}
	return {
		left: rect.left,
		top: rect.top,
		width: rect.width,
		height: rect.height,
	};
}

/**
 * 画布尺寸（居中锚点与平移目标）：优先实时容器，回退引擎缓存
 * `width`/`height`——容器不可得（隐藏叶、引擎中间态）时至少保住比例设置，
 * 与既有语义一致（elRect 缺失也先 setScale，只跳过平移）。
 */
function getCanvasSize(
	mindMap: MindMap,
): { width: number; height: number } | null {
	const live = getLiveCanvasRect(mindMap);
	if (live) {
		return { width: live.width, height: live.height };
	}
	const { width, height } = mindMap;
	if (width > 0 && height > 0) {
		return { width, height };
	}
	const cached = (
		mindMap as unknown as {
			elRect?: { width?: unknown; height?: unknown };
		}
	).elRect;
	const cachedWidth = cached?.width;
	const cachedHeight = cached?.height;
	if (
		typeof cachedWidth === 'number' &&
		typeof cachedHeight === 'number' &&
		cachedWidth > 0 &&
		cachedHeight > 0
	) {
		return { width: cachedWidth, height: cachedHeight };
	}
	return null;
}

/**
 * 页面坐标 → 画布坐标的换算原点：优先实时容器，回退引擎缓存 `elRect`
 * （容器不可得时沿用引擎自身口径，保持既有行为）。
 */
function getCanvasOrigin(
	mindMap: MindMap,
): { left: number; top: number } | null {
	const live = getLiveCanvasRect(mindMap);
	if (live) {
		return { left: live.left, top: live.top };
	}
	const cached = (
		mindMap as unknown as { elRect?: { left?: unknown; top?: unknown } }
	).elRect;
	const { left, top } = cached ?? {};
	if (typeof left === 'number' && typeof top === 'number') {
		return { left, top };
	}
	return null;
}

/**
 * 把引擎缓存的画布几何同步到实时容器（重读矩形、更新 SVG 尺寸，尺寸变化时
 * 重渲染）。与 `view.onResize` 同一路径——首帧窗口内布局 settle 不触发
 * `onResize`，故取视口前必须主动同步，否则 fit/居中都按旧几何换算。
 * 容器不可得（隐藏叶、引擎中间态）时静默跳过，交调用方回退路径。
 */
function syncCanvasGeometry(mindMap: MindMap): void {
	if (!getLiveCanvasRect(mindMap)) {
		return;
	}
	try {
		(mindMap as unknown as { resize?: () => void }).resize?.();
	} catch (error) {
		console.warn('同步画布几何失败', error);
	}
}

/**
 * 适应画布（性能模式适配）。
 *
 * 引擎 view.fit() 基于可见节点的 SVG 包围盒（rbox）计算缩放；性能模式下
 * 视口外节点已被引擎移除出 DOM（removeNodeWhenOutCanvas），直接 fit 只会
 * 适配「可见子集」，大图会适配错位。故先 forceLoadNode 强制渲染全部节点
 * （引擎导出路径 getSvgData 同款做法），再 fit；fit 后引擎会按新视口自动
 * 回收视口外节点，虚拟渲染继续生效。
 */
export function fitMindMap(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		// 引擎 fit 用缓存的 elRect 换算，先同步到实时容器（首帧窗口内
		// onResize 尚未触发，不同步会按旧画布尺寸适配）
		syncCanvasGeometry(mindMap);
		if (mindMap.opt?.openPerformance) {
			mindMap.renderer.forceLoadNode?.();
		}
		mindMap.view?.fit();
	} catch (error) {
		console.error('适应画布失败', error);
	}
}

/**
 * 打开时的默认视口：100% 缩放 + **整体内容居中**（按渲染内容包围盒居中，
 * 不按根节点——根节点居中会让偏心的树偏向一侧）。
 *
 * 顺序：先 `setScale(1, 画布中心)` 固定比例（锚定画布中心，避免内容跳动），
 * 再按当前包围盒平移，使包围盒中心落在画布中心。
 */
export function centerContentAtFullScale(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		// 性能模式下视口外节点被回收，包围盒会失真：先强制渲染全部节点
		// （与 fitMindMap 同款做法；随后引擎按新视口重新回收）
		if (mindMap.opt?.openPerformance) {
			mindMap.renderer.forceLoadNode?.();
		}
		// 先同步引擎几何（SVG 尺寸与缓存矩形），再取**实时容器**做换算：
		// 首帧后容器尺寸/位置可能已变（布局 settle、工具栏重建），沿用
		// 缓存值会把内容按旧画布中心摆放 → 打开即偏移。
		syncCanvasGeometry(mindMap);
		const size = getCanvasSize(mindMap);
		if (!size) {
			return;
		}
		mindMap.view?.setScale(1, size.width / 2, size.height / 2);
		// 包围盒必须在 setScale(1) 之后测：rbox 含当前变换，1:1 下
		// box 的宽高即内容像素尺寸（居中算式的前提）
		const box = measureContentBox(mindMap);
		if (!box) {
			return;
		}
		mindMap.view?.translateXY(
			(size.width - box.width) / 2 - box.x,
			(size.height - box.height) / 2 - box.y,
		);
	} catch (error) {
		// 引擎尚未就绪等边角情况：回退 fit（至少让内容可见）
		console.error('设置默认视口失败', error);
		fitMindMap(mindMap);
	}
}

/**
 * 渲染内容的包围盒（画布坐标系，左上为原点）。
 * `draw.rbox()` 返回页面坐标（SVG.js 语义，含当前变换），减去容器原点得到
 * 画布内坐标（与引擎 fit 同口径；引擎自身减的是缓存 `elRect`，容器移动过后
 * 会差一个位移量，故这里优先减实时值）。
 */
function measureContentBox(
	mindMap: MindMap,
	origin: { left: number; top: number } | null = getCanvasOrigin(mindMap),
): { x: number; y: number; width: number; height: number } | null {
	const draw = (
		mindMap as unknown as {
			draw?: {
				rbox(): {
					x: number;
					y: number;
					width: number;
					height: number;
				};
			};
		}
	).draw;
	if (!draw?.rbox || !origin) {
		return null;
	}
	const box = draw.rbox();
	return {
		x: box.x - origin.left,
		y: box.y - origin.top,
		width: box.width,
		height: box.height,
	};
}

/**
 * 内容是否还在画布视口内（保存视口恢复后的落界校验）。
 *
 * 保存的变换按「当时的容器尺寸 + 当时的内容布局」记录，容器尺寸大改或内容
 * 布局变化后恢复它，可能把内容推出画布（打开即空白、只剩一角）。
 *
 * @returns `true` 可见；`false` **明确判定**不可见（调用方回退默认居中）；
 *   `null` 无法判定——性能模式下 rbox 只覆盖已加载节点子集，或引擎结构
 *   不可得。调用方对 `null` 应保持原状：fail-open，不误伤合法视口恢复。
 */
export function isContentVisibleInCanvas(
	mindMap: MindMap | null,
	minOverlapPx = 8,
): boolean | null {
	if (!mindMap) {
		return null;
	}
	// 性能模式：视口外节点被引擎回收，rbox 只覆盖已加载子集，判定不可靠
	if (mindMap.opt?.openPerformance) {
		return null;
	}
	try {
		const size = getCanvasSize(mindMap);
		const box = measureContentBox(mindMap);
		if (!size || !box) {
			return null;
		}
		// NaN/零尺寸（保存视口损坏）按不可见处理
		if (!(box.width > 0) || !(box.height > 0)) {
			return false;
		}
		const overlapW =
			Math.min(box.x + box.width, size.width) - Math.max(box.x, 0);
		const overlapH =
			Math.min(box.y + box.height, size.height) - Math.max(box.y, 0);
		return (
			overlapW >= Math.min(minOverlapPx, box.width) &&
			overlapH >= Math.min(minOverlapPx, box.height)
		);
	} catch (error) {
		console.warn('检测内容可见性失败', error);
		return null;
	}
}

/**
 * 重置缩放：回到 100%，**以画布中心为锚点**——屏幕上当前可见的导图内容
 * 保持原位（不漂移、不居中、不改平移基准）。
 *
 * 为什么不能只 `setScale(1)`：引擎的平移量是相对画布原点的，只改比例会让
 * 内容绕原点跳动（表现为「视图乱飘」）。引擎的 `scaleInCenter` 会按新比例
 * 反推平移，使锚点处的画面不动；`setScale(scale, cx, cy)` 即该路径。
 */
export function resetZoom(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		const centerX = mindMap.width / 2;
		const centerY = mindMap.height / 2;
		mindMap.view?.setScale(1, centerX, centerY);
	} catch (error) {
		console.error('重置缩放失败', error);
	}
}

/** 安全销毁思维导图实例 */export function destroyMindMap(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		mindMap.destroy();
	} catch (error) {
		console.error('销毁思维导图实例失败', error);
	}
}

/** 当前激活（选中）的节点；无则返回 null */
export function getActiveNode(mindMap: MindMap | null): MindMapNode | null {
	return mindMap?.renderer ? mindMap.renderer.activeNodeList[0] ?? null : null;
}

/**
 * 运行时切换性能模式（虚拟渲染）——**不需要销毁重建引擎**。
 *
 * vendor 0.14.0-fix.3 实测：`updateConfig` 只合并 opt 并派发事件，而 Renderer 的
 * `after_update_config` 分支会在 `openPerformance` 变化时**绑定/解绑
 * `view_data_change` 处理器**并 `forceLoadNode()`。`forceLoadNode` 自带一次整树
 * 渲染，但它走的是「强制加载」分支（不裁剪）——`verify:visual` 的两条探针把两个
 * 方向实测清楚了：
 * - **关闭**：`updateConfig` 一次落地即可（DOM 全量在，正是目标状态）⇒ 不补渲染；
 * - **开启**：只 `updateConfig` 会停在「全部节点仍在 DOM」直到下一次视口变化才裁剪
 *   （perf-switch 探针实测 DOM 151→**151**）；补一次 `render()` 立刻收敛到裁剪态
 *   （DOM 151→**11**），代价是这一次落地（render-eco 探针实测 2 次）——开启方向
 *   正是为了把 DOM 压下去，这一次渲染买的是「立刻生效」，值。
 *
 * 裁剪每次渲染现取活值（`Node.render` 解构 `opt.openPerformance` /
 * `opt.performanceConfig` 后按 `checkIsInClient(padding)` 判定，视口外节点
 * `removeSelf()`）。唯一不随运行时切换生效的是节流窗口 `performanceConfig.time`
 * （`bindEvent` 创建时捕获，见 PERFORMANCE_CONFIG 注释）——它只影响视口变化后的
 * 重渲染节流，不影响正确性。
 *
 * @returns 是否已应用到引擎（引擎缺失/更新抛错时为 false）
 */
export function applyPerformanceMode(
	mindMap: MindMap | null,
	enabled: boolean,
): boolean {
	if (!mindMap) {
		return false;
	}
	try {
		mindMap.updateConfig({
			openPerformance: enabled,
			performanceConfig: { ...PERFORMANCE_CONFIG },
		});
		if (enabled) {
			// 见函数头：开启方向补一次裁剪渲染（关闭方向不补，forceLoadNode 已是目标态）
			mindMap.render();
		}
		return true;
	} catch (error) {
		console.error('切换性能模式失败', error);
		return false;
	}
}

/** 递归统计树节点数量（数据树/渲染节点树同构，均可用） */
export function countTreeNodes<T extends { children?: readonly T[] | null }>(
	tree: T | null,
): number {
	if (!tree) {
		return 0;
	}
	let count = 0;
	walkTree(tree, () => {
		count++;
	});
	return count;
}

/**
 * 根据 DOM 元素查找对应节点：按「节点渲染 group 包含目标元素」的对象身份匹配。
 * 旧实现读取节点 DOM 上的 data-uid 属性——vendor 契约冒烟测试证实引擎
 * 从不写入该属性（bundle 全文零处），旧匹配恒失败；改为遍历渲染树用
 * group 元素身份匹配（group 为引擎内部字段，访问收口在本函数）。
 */
export function findNodeByDom(
	mindMap: MindMap | null,
	el: Element,
): MindMapNode | null {
	if (!mindMap?.renderer) {
		return null;
	}
	const root = mindMap.renderer.root;
	if (!root) {
		return null;
	}
	let result: MindMapNode | null = null;
	walkTree(root, (node) => {
		const group = getNodeGroupEl(node);
		// contains 对元素自身也返回 true，命中 group 本身或其内部子元素
		if (group?.contains(el)) {
			result = node;
			return false; // 命中即终止整树遍历
		}
		return undefined;
	});
	return result;
}

/**
 * 自动整理：清除所有节点被自由拖拽后的自定义位置，
 * 重新按当前布局算法计算位置，使各主题以合理间距对齐摆放，
 * 最后适应画布（fit 全图：整体缩放居中，整理结果一览无余）。
 *
 * 注意：使用引擎内置的「重置布局」（RESET_LAYOUT 命令）而非全量 setData。
 * 旧实现 getData()+delete+setData 会经 handleData / renderer.setData 重新初始化
 * 布局，可能重排 children 从而打乱用户手动排好的节点顺序；
 * resetLayout 只逐个节点清除 customLeft/customTop 后重渲染，不触碰 children 顺序，
 * 因此不会打乱手动排好的顺序。
 *
 * 渲染窗口守卫（K67）：引擎 `Renderer._render` 渲染期会**先把 `renderer.root` 置 null**、
 * 再由异步布局回填（分片执行，跨多个宏任务，见 `RESET_LAYOUT_ROOT_WAIT_*` 注释）。
 * 窗口期内执行 RESET_LAYOUT 会遍历 null 根并在回调首行抛
 * `TypeError: Cannot set properties of null (setting 'customLeft')`（用户实测）。
 * 故 root 缺失时不是立即执行，而是等回填后再执行（超上限只记日志、不抛）。
 * 返回 true = 已受理（含延后到本轮渲染结束的情形）。
 */
export function arrangeMindMap(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	try {
		if (typeof mindMap.execCommand !== 'function') {
			return false;
		}
		if (getRenderRoot(mindMap)) {
			execResetLayoutAndFit(mindMap);
			return true;
		}
		waitRenderRootThenArrange(mindMap);
		return true;
	} catch (error) {
		console.error('自动整理失败', error);
		return false;
	}
}

/**
 * 引擎侧延时任务登记表（`execResetLayoutAndFit` 的延时 fit、
 * `waitRenderRootThenArrange` 的轮询链、`startNodeTextEdit` 的宏任务延后）。
 *
 * 存在的理由：这些 `setTimeout` 的闭包会触碰引擎实例，而视图关闭会在它们到期前
 * 销毁引擎（`EngineController.destroyInstance`）——没有登记表就只能等定时器自然到期，
 * 在已销毁的实例上白跑一趟（轮询链还会因此再排下一次）。
 *
 * 用 `WeakMap` 而非模块级 `Map`：引擎实例被回收后条目随之消失，不构成长期驻留。
 */
const engineTimers = new WeakMap<MindMap, Set<number>>();

/** 排一个可被 `cancelEngineTimers` 取消的引擎延时任务（回调执行后自动摘除登记） */
function scheduleEngineTimer(
	mindMap: MindMap,
	callback: () => void,
	delay: number,
): void {
	const id = window.setTimeout(() => {
		engineTimers.get(mindMap)?.delete(id);
		callback();
	}, delay);
	let pending = engineTimers.get(mindMap);
	if (!pending) {
		pending = new Set<number>();
		engineTimers.set(mindMap, pending);
	}
	pending.add(id);
}

/** 取消该引擎实例的全部在途延时任务（销毁路径调用；幂等） */
export function cancelEngineTimers(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	const pending = engineTimers.get(mindMap);
	if (!pending) {
		return;
	}
	for (const id of pending) {
		window.clearTimeout(id);
	}
	pending.clear();
}

/** RESET_LAYOUT + 延时 fit（成功路径唯一实现：即时执行与等待回填两条路径共用） */
function execResetLayoutAndFit(mindMap: MindMap): void {
	mindMap.execCommand(ENGINE_COMMANDS.RESET_LAYOUT);
	scheduleEngineTimer(
		mindMap,
		() => fitMindMap(mindMap),
		RESET_LAYOUT_VIEWPORT_DELAY_MS,
	);
}

/**
 * 渲染窗口期内（root 暂缺）轮询等待回填后再整理（K67）。
 * 超时（渲染链中断等异常态）只记日志：与既有的 catch 口径一致，
 * 不向调用方抛错、不打断视图交互。
 */
function waitRenderRootThenArrange(mindMap: MindMap): void {
	const deadline = Date.now() + RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS;
	const attempt = (): void => {
		if (getRenderRoot(mindMap)) {
			try {
				execResetLayoutAndFit(mindMap);
			} catch (error) {
				console.error('自动整理失败', error);
			}
			return;
		}
		if (Date.now() >= deadline) {
			console.error('自动整理失败：渲染根在等待上限内未回填');
			return;
		}
		scheduleEngineTimer(mindMap, attempt, RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS);
	};
	scheduleEngineTimer(mindMap, attempt, RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// 引擎内部形态的防腐收口
//
// 视图/特性层禁止直接触碰引擎内部结构（node.group、导出倍率 opt 裸读写等）；
// 需要这些能力时经由本模块的具名函数，内部形态的适配只出现在这里。
// ---------------------------------------------------------------------------

/** 放大画布（工具栏缩放） */
export function zoomInMindMap(mindMap: MindMap | null): void {
	mindMap?.view.enlarge();
}

/** 缩小画布（工具栏缩放） */
export function zoomOutMindMap(mindMap: MindMap | null): void {
	mindMap?.view.narrow();
}

/**
 * 手势缩放的上下限（仅兜底夹紧，正常滚轮/点击缩放不会触边）。
 * 引擎 enlarge/narrow 自带步进与限制，这里只拦住「滚到 0 或无限大」的极端值。
 */
const MIN_GESTURE_SCALE = 0.1;
const MAX_GESTURE_SCALE = 4;

/** 平移画布（相对位移，屏幕像素） */
export function panMindMap(
	mindMap: MindMap | null,
	dx: number,
	dy: number,
): void {
	if (!mindMap?.view) {
		return;
	}
	try {
		mindMap.view.translateXY(dx, dy);
	} catch (error) {
		console.error('平移画布失败', error);
	}
}

/**
 * 以画布内某点为**锚点缩放**（锚点处画面不动）——对齐 Obsidian Canvas 的
 * `Ctrl/Cmd + 滚轮`缩放（官方帮助 `Plugins/Canvas.md`：press Ctrl or Cmd and
 * scroll using the mouse wheel）。锚点走引擎 `setScale(scale, cx, cy)` 的
 * scaleInCenter 路径（与 resetZoom 同一路径）。
 *
 * @param factor  缩放倍率（>1 放大）
 * @param anchorX 锚点 X（画布内坐标，非屏幕坐标）
 */
export function zoomMindMapAt(
	mindMap: MindMap | null,
	factor: number,
	anchorX: number,
	anchorY: number,
): void {
	if (!mindMap?.view) {
		return;
	}
	try {
		const current = getDrawTransform(mindMap).scaleX;
		const next = Math.min(
			MAX_GESTURE_SCALE,
			Math.max(MIN_GESTURE_SCALE, current * factor),
		);
		mindMap.view.setScale(next, anchorX, anchorY);
	} catch (error) {
		console.error('缩放画布失败', error);
	}
}

/** 当前全部激活（选中）节点（引擎渲染器内部字段的防腐收口） */
export function getActiveNodes(mindMap: MindMap | null): MindMapNode[] {
	return mindMap?.renderer ? [...mindMap.renderer.activeNodeList] : [];
}

/** 当前渲染树的根节点（性能模式/初始化中间态等场景可能为 null） */
export function getRenderRoot(mindMap: MindMap | null): MindMapNode | null {
	return mindMap?.renderer.root ?? null;
}

/** 节点渲染 group 的根 DOM 元素（hover-link 等场景的锚点；group 为引擎内部字段） */
export function getNodeGroupEl(node: MindMapNode): Element | null {
	const group = (node as unknown as { group?: { node?: Element } }).group;
	return group?.node ?? null;
}

/**
 * 读取节点 data 的字符串字段（防腐收口：getData 返回 unknown，
 * 此前 `(node.getData?.('x') as string) || ''` 式强转散布于各 view-* 模块；
 * 空值/非字符串一律归一为空串）。
 */
export function getNodeDataString(node: MindMapNode, key: string): string {
	const value = node.getData?.(key);
	return typeof value === 'string' ? value : '';
}

/**
 * 以临时导出倍率执行导出任务：进入时写入 minExportImgCanvasScale，
 * 任务结束（无论成败）恢复原值；原值不存在时删除该键，避免残留到
 * 后续渲染。引擎销毁等边角情况下恢复失败静默忽略。
 */
async function runWithExportScale<T>(
	mindMap: MindMap,
	scale: number,
	task: () => Promise<T> | T,
): Promise<T> {
	const oldScale = mindMap.opt.minExportImgCanvasScale;
	try {
		mindMap.updateConfig({ minExportImgCanvasScale: scale });
		return await task();
	} finally {
		try {
			if (oldScale !== undefined) {
				mindMap.updateConfig({ minExportImgCanvasScale: oldScale });
			} else {
				delete mindMap.opt.minExportImgCanvasScale;
			}
		} catch {
			// 忽略：引擎已销毁等边角情况
		}
	}
}

/**
 * 以导出倍率导出 PNG（DoExport 插件不可用时返回 null）。错误向调用方
 * 传播（由 UI 层弹用户可见提示）。
 * doExport/exporter 为引擎插件内部形态，访问收口在本函数。
 */
export async function exportMindMapPng(
	mindMap: MindMap,
	scale: number,
	fileName: string,
): Promise<Blob | string | null> {
	const exporter = mindMap.doExport;
	if (!exporter?.export) {
		return null;
	}
	return runWithExportScale(mindMap, scale, () =>
		exporter.export('png', false, fileName),
	);
}

/** 更新节点文本：先改节点数据，再经引擎命令同步并重绘 */
export function setNodeText(
	mindMap: MindMap,
	node: MindMapNode,
	text: string,
): void {
	node.nodeData.data.text = text;
	try {
		mindMap.execCommand(ENGINE_COMMANDS.SET_NODE_DATA, node, { text });
	} catch (error) {
		// SET_NODE_DATA 不可用等情形：数据已直接写入 nodeData，交给随后的
		// render 全量重绘兜底；仅记录，不打扰用户。
		console.warn('SET_NODE_DATA 执行失败，已直接写入节点数据:', error);
	}
	mindMap.render();
}

/**
 * 用新数据树**替换**当前内容，且**保留撤销历史**——一次 `Ctrl+Z` 回到替换前。
 *
 * 为什么不用引擎的 `setData`（vendor `simple-mind-map.cjs` 实测）：
 * `setData` = `CLEAR_ACTIVE_NODE` → **`command.clearHistory()`** → `addHistory()`
 * → `renderer.setData()`：历史被清成「只剩新状态一条」，此后 `BACK`/`FORWARD`
 * **永远无事发生**（用户实测：「拆分双链后 Ctrl+Z 失效」）。
 * `updateData` = `renderer.setData()` → `render()` → `command.addHistory()`，
 * 只把新状态**追加**为一条历史（快照取自 `renderer.renderTree`），撤销链完整。
 * `updateData` 未入 d.cts，故按本文件既有口径做窄化透传。
 *
 * 先 `CLEAR_ACTIVE_NODE`（与 `setData` 同语义，且该命令不进历史）：换树后全部
 * 节点实例重建，旧引用作废——留着会被「删除/编辑激活节点」等命令误用。
 */
export function replaceMindMapData(
	mindMap: MindMap | null,
	tree: MindMapTreeNode,
): void {
	if (!mindMap) {
		return;
	}
	try {
		mindMap.execCommand(ENGINE_COMMANDS.CLEAR_ACTIVE_NODE);
		const target = mindMap as unknown as {
			updateData?: (data: MindMapTreeNode) => void;
		};
		if (typeof target.updateData === 'function') {
			target.updateData(tree);
		} else {
			// 引擎不提供 updateData（版本差异）时退回 setData：能落数据，
			// 代价是撤销链断开——宁可丢历史，不可丢用户操作
			mindMap.setData(tree);
		}
	} catch (error) {
		console.error('替换导图数据失败', error);
	}
}

/**
 * 标记节点需要重建内容：引擎只在节点内部 `needLayout` 为真时重建该节点
 * （前缀图标 / 文本等），仅改 data 不会刷新。影响渲染的数据变更后调用。
 */
export function markNodeNeedLayout(node: MindMapNode): void {
	(node as unknown as { needLayout?: boolean }).needLayout = true;
}

/**
 * 重建节点的**自绘内容**（方案 B：`customCreateNodeContent`）。
 *
 * 引擎只在 `createNodeData` 的 keys **含 'custom'** 时重新调用自绘钩子；整树
 * `render()`、单节点 `needLayout` 都**不会**重建（无头浏览器实测：拖宽后内容元素
 * 的 style 原封不动、节点高度仍是旧值）。而自绘节点的宽度/高度**全部来自该元素
 * 的离屏测宽**——不重建就等于「宽度改了、折行没改、高度不跟随」（2026-09-16
 * 用户实测缺陷：「节点内文字过多时，拖动边框改宽，节点上下高度不变」）。
 *
 * 故插件侧在引擎「拖左右边框改宽」结束（`dragModifyNodeWidthEnd`）后必须补这一下。
 */
export function refreshNodeCustomContent(
	mindMap: MindMap | null,
	node: MindMapNode,
): void {
	if (!mindMap || !node) {
		return;
	}
	try {
		const target = node as unknown as {
			reRender?: (
				keys: string[],
				params: { ignoreUpdateCustomTextWidth: boolean },
			) => void;
		};
		// ignoreUpdateCustomTextWidth：本帧的 customTextWidth 还只在**节点字段**上
		//（`setData` 之前的渲染不应把它从 data 覆盖回 undefined）
		target.reRender?.(['custom'], { ignoreUpdateCustomTextWidth: true });
		mindMap.render();
	} catch (error) {
		console.error('重建节点自绘内容失败', error);
	}
}

/**
 * 设置节点图片的自定义展示尺寸（content px，custom:true 引擎按值渲染）。
 * 经 SET_NODE_DATA 合并写入；该命令只合并数据不触发重绘（与 SET_NODE_TEXT
 * 同款语义），末尾须显式 render——否则拖拽调宽期间数据在变、画面不动。
 *
 * **记为一条历史**（引擎 `Command.exec` 对非白名单命令一律 `addHistory()`）：
 * 只应在拖拽**收尾**调用一次。逐帧调用会让一次拖动产生几十条历史（用户要按
 * 几十次 Ctrl+Z 才能撤回一次调宽）——帧内请用 `previewNodeImageSize`。
 */
export function setNodeImageSize(
	mindMap: MindMap,
	node: MindMapNode,
	width: number,
	height: number,
): void {
	try {
		mindMap.execCommand(ENGINE_COMMANDS.SET_NODE_DATA, node, {
			imageSize: { width, height, custom: true },
		});
	} catch (error) {
		console.error('设置节点图片尺寸失败', error);
	}
	mindMap.render();
}

/**
 * 帧内**预览**写入节点图片尺寸：只改节点数据 + 重绘，**不进历史、不派发
 * `data_change`**。
 *
 * 为什么不能逐帧走命令（vendor `simple-mind-map.cjs` 实测）：
 * `Command.exec` 末尾是
 * `if (['BACK','FORWARD','SET_NODE_ACTIVE','CLEAR_ACTIVE_NODE'].includes(cmd)) return; this.addHistory()`，
 * 而 `addHistory()` 会 `getCopyData()`（**整树深拷贝**）+ `JSON.stringify` 比对
 * 后 `emit('data_change')`。拖拽调宽每过一个步长就写一次 ⇒
 * ① 每 8px 一条历史（撤销被切碎）；② 每次变动都触发视图的自动保存调度
 * （`data_change` → `scheduleSave`，防抖被反复重启，慢拖时落盘好几次）与状态栏/
 * 标题重算；③ 全树深拷贝 + 序列化比对正是「拖动卡顿」的主要开销。
 * 数据写入与命令**完全等价**（引擎命令本体就是
 * `Object.keys(data).forEach(k => node.nodeData.data[k] = data[k])`），故帧内直接
 * 改数据、收尾再用 `setNodeImageSize` 记一条历史即可。
 */
export function previewNodeImageSize(
	mindMap: MindMap,
	node: MindMapNode,
	width: number,
	height: number,
): void {
	try {
		const data = node.getData() as Record<string, unknown> | undefined;
		if (!data) {
			return;
		}
		data.imageSize = { width, height, custom: true };
	} catch (error) {
		console.error('预览节点图片尺寸失败', error);
		return;
	}
	mindMap.render();
}

/**
 * 图片尺寸校正条目（**结构类型**）：产出方是 `media/images-path`
 * （`ImageSizeCorrection`），此处按同形声明以免 engine → media 反向依赖。
 */
export interface ImageSizeCorrectionEntry {
	/** 树节点 data 对象**引用**：按对象身份匹配引擎节点（引擎节点 data 即树 data） */
	data: Record<string, unknown>;
	/** 探测时的图片地址（写回前比对，图片已换则丢弃该条） */
	image: string;
	width: number;
	height: number;
	custom: boolean;
	/** true = 自动按比例校正 → 打 `mdImageAutoSize`（序列化跳过尺寸回写） */
	autoSize: boolean;
}

/**
 * 把图片尺寸校正回灌到引擎（**首帧之后**调用，见 K 记录：加载期探测不再挡首帧）。
 *
 * 匹配用**对象身份**（`node.getData() === correction.data`）+ `image` 字段比对：
 * - 加载期 uid 可能尚未分配（`ensureUniqueUids` 在引擎创建时才跑），不能按 uid；
 * - 引擎重建（设置刷新/换文件）后身份自然落空 ⇒ 陈旧条目静默丢弃，
 *   不会把尺寸盖到别的节点上。
 *
 * 有实际改动才 `render()` 一次（局部重建由引擎按数据变更自行判定）；
 * 值相同的条目不写，避免无谓重绘与序列化惊动。
 */
export function applyImageSizeCorrectionsToEngine(
	mindMap: MindMap | null,
	corrections: readonly ImageSizeCorrectionEntry[],
): number {
	if (!mindMap || corrections.length === 0) {
		return 0;
	}
	const root = getRenderRoot(mindMap);
	if (!root) {
		return 0;
	}
	const byData = new Map<Record<string, unknown>, ImageSizeCorrectionEntry>();
	for (const correction of corrections) {
		byData.set(correction.data, correction);
	}
	let applied = 0;
	walkTree(root, (node) => {
		const data = node.getData() as Record<string, unknown> | undefined;
		const correction = data ? byData.get(data) : undefined;
		if (!data || !correction) {
			return;
		}
		// 身份命中还不够：用户可能已经换过图片，旧尺寸不能盖上去
		if (data.image !== correction.image) {
			return;
		}
		const current = data.imageSize as
			| { width?: unknown; height?: unknown; custom?: unknown }
			| undefined;
		if (
			current &&
			current.width === correction.width &&
			current.height === correction.height &&
			current.custom === correction.custom
		) {
			return;
		}
		if (correction.autoSize) {
			data.mdImageAutoSize = true;
		}
		data.imageSize = {
			width: correction.width,
			height: correction.height,
			custom: correction.custom,
		};
		applied++;
	});
	if (applied > 0) {
		mindMap.render();
	}
	return applied;
}

/** 当前画布变换（content ↔ 画布视口坐标换算用；异常时回退恒等） */
export interface DrawTransform {
	scaleX: number;
	scaleY: number;
	translateX: number;
	translateY: number;
}

export function getDrawTransform(mindMap: MindMap | null): DrawTransform {
	try {
		const t = mindMap?.view.getTransformData().transform as
			| Partial<DrawTransform>
			| undefined;
		return {
			scaleX: typeof t?.scaleX === 'number' && t.scaleX > 0 ? t.scaleX : 1,
			scaleY: typeof t?.scaleY === 'number' && t.scaleY > 0 ? t.scaleY : 1,
			translateX: typeof t?.translateX === 'number' ? t.translateX : 0,
			translateY: typeof t?.translateY === 'number' ? t.translateY : 0,
		};
	} catch {
		return { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
	}
}

// ---------------------------------------------------------------------------
// Drag 插件落点判定（features/drag-target.ts 专用，防腐收口）
//
// 引擎拖拽落点要求指针精确落在目标节点矩形内（checkIsOverlap 的闭区间判定），
// 狭小节点/快速拖动时难以命中。drag-target 模块在拖拽期间计算「外扩邻近
// 最近节点」，经 setDragOverlapTarget 外借给引擎作为落点——引擎自身每帧
// checkOverlapNode 重置三态，外借不会被陈旧状态阻塞；松手后由引擎原生
// MOVE_NODE_TO 完成挂接。仅拖拽中生效（见 drag-target.ts）。
// ---------------------------------------------------------------------------

/** 引擎 Drag 插件的落点判定状态（三态，内部形态经本接口收口） */
export interface DragDropState {
	/** 引擎本轮判定的「挂为子节点」目标（null = 未命中） */
	overlapNode: MindMapNode | null;
	/** 引擎本轮判定的「插到其后」目标 */
	prevNode: MindMapNode | null;
	/** 引擎本轮判定的「插到其前」目标 */
	nextNode: MindMapNode | null;
}

/** 读取 Drag 插件实例的落点状态（插件未注册时返回 null） */
export function getDragDropState(mindMap: MindMap): DragDropState | null {
	const drag = (mindMap as unknown as { drag?: DragDropState }).drag;
	return drag ?? null;
}

/** 外借落点：把邻近节点借给引擎作为「挂为子节点」目标（null 撤销外借） */
export function setDragOverlapTarget(
	mindMap: MindMap,
	node: MindMapNode | null,
): void {
	const drag = (mindMap as unknown as { drag?: DragDropState }).drag;
	if (drag) {
		drag.overlapNode = node;
	}
}

/**
 * 外借落点：把兄弟间隙锚点借给引擎作为「插到该节点之后」目标
 * （prevNode，null 撤销外借）。引擎松手走原生 INSERT_AFTER。
 */
export function setDragPrevTarget(
	mindMap: MindMap,
	node: MindMapNode | null,
): void {
	const drag = (mindMap as unknown as { drag?: DragDropState }).drag;
	if (drag) {
		drag.prevNode = node;
	}
}

/** 节点布局矩形（content 坐标，引擎布局字段 left/top/width/height） */
export function getNodeLayoutRect(
	node: MindMapNode,
): { left: number; top: number; width: number; height: number } {
	const n = node as unknown as {
		left?: number;
		top?: number;
		width?: number;
		height?: number;
	};
	return {
		left: typeof n.left === 'number' ? n.left : 0,
		top: typeof n.top === 'number' ? n.top : 0,
		width: typeof n.width === 'number' ? n.width : 0,
		height: typeof n.height === 'number' ? n.height : 0,
	};
}

/** 指针位置（引擎 toPos：相对画布的视口坐标，与变换后的节点矩形同空间） */
export function toCanvasPoint(
	mindMap: MindMap,
	clientX: number,
	clientY: number,
): { x: number; y: number } {
	try {
		// toPos 为引擎运行时方法（d.cts 未声明，防腐收口于此）
		const toPos = (
			mindMap as unknown as {
				toPos?: (x: number, y: number) => { x?: number; y?: number };
			}
		).toPos;
		const p = toPos?.call(mindMap, clientX, clientY);
		return {
			x: typeof p?.x === 'number' ? p.x : NaN,
			y: typeof p?.y === 'number' ? p.y : NaN,
		};
	} catch {
		return { x: NaN, y: NaN };
	}
}

/** 节点是否为根（中心主题）节点 */
export function isRootNode(node: MindMapNode): boolean {
	return node.isRoot === true;
}

/**
 * 删除节点兜底：uid 重复/缺失时引擎按 uid 的删除可能失败，
 * 按对象身份从父节点数据中强制移除并重绘。
 */
export function forceRemoveNodeData(
	mindMap: MindMap,
	parent: MindMapNode,
	nodeData: MindMapTreeNode,
): void {
	const index = parent.nodeData.children.findIndex(
		(child) => child === nodeData,
	);
	if (index !== -1) {
		parent.nodeData.children.splice(index, 1);
		mindMap.render();
	}
}

// ---------------------------------------------------------------------------
// 搜索子系统（Search 插件）的防腐收口
//
// 运行时 search 插件可能未注册（引擎变体差异），搜索包装函数内部判空静默。
// matchNodeList/currentIndex 等插件内部状态不再被 view-search 直接触碰。
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 引擎内部状态的最后收口（renderer.textEdit / node_dblclick 触发）
// ---------------------------------------------------------------------------

/**
 * 节点是否为**自绘内容**节点（引擎 `customCreateNodeContent` 已接管，见本文件
 * createNodeContent 钩子）；`false` = 走引擎默认 SVG 文本渲染。
 *
 * 用途：引擎的节点编辑框对自绘节点**静默 no-op**——`textEdit.show()` 首行即
 * `if (t.isUseCustomNodeContent()) return;`，故视图侧据此改走插件自身的编辑入口
 * （`ui/modal-text`）；引擎内部判定收口在本函数。
 */
export function isCustomNodeContent(node: MindMapNode): boolean {
	const target = node as unknown as {
		isUseCustomNodeContent?: () => boolean;
	};
	return target.isUseCustomNodeContent?.() ?? false;
}

/** 用户是否正在节点文本编辑框内打字（防腐：renderer.textEdit 内部状态） */
export function isEditingText(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	const textEdit = (
		mindMap.renderer as unknown as {
			textEdit?: { isShowTextEdit(): boolean };
		}
	).textEdit;
	return textEdit?.isShowTextEdit() ?? false;
}

/** 根（中心主题）节点文本（防腐：renderer.root 内部状态） */
export function getRootText(mindMap: MindMap | null): string | null {
	const rootText = mindMap?.renderer.root?.getData('text');
	return typeof rootText === 'string' ? rootText : null;
}

/**
 * 触发节点文本编辑（右键菜单「编辑文本」）。
 *
 * 两个坑（0.14.0-fix.3 实测）：
 * - 右键菜单项的 click 会继续冒泡到 `document.body`，引擎的 `body_click`
 *   （`isEndNodeTextEditOnClickOuter` 默认 true）会立刻把刚打开的编辑框关掉
 *   —— 故延后一个宏任务再触发；
 * - `isInserting` 必须是 false：它表示「新建节点后的首次编辑」，传 true 会让
 *   引擎按插入态处理（语义错误）。
 *
 * 引擎无 ENTER_TEXT_EDIT 命令，`node_dblclick` 事件是文本编辑的官方入口。
 */
export function startNodeTextEdit(mindMap: MindMap, node: MindMapNode): void {
	scheduleEngineTimer(
		mindMap,
		() => {
			mindMap.emit('node_dblclick', node, null, false);
			// 菜单关闭后浏览器可能把焦点还给画布：补一次焦点，保证可直接输入
			focusNodeTextEdit(mindMap);
		},
		0,
	);
}

/** 聚焦节点文本编辑框（引擎内部 textEditNode；尚未创建时静默） */
function focusNodeTextEdit(mindMap: MindMap | null): void {
	const textEdit = (
		mindMap?.renderer as
			| { textEdit?: { textEditNode?: HTMLElement | null } }
			| undefined
	)?.textEdit;
	textEdit?.textEditNode?.focus();
}
