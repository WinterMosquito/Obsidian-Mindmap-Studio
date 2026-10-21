/**
 * simple-mind-map 引擎封装：实例创建/销毁、主题应用、自动整理、性能模式切换。
 *
 * 2026-10-16 模块化拆分：原单文件（2911 行）按内聚子域拆为 engine/ 层内多文件，
 * 本文件保留「实例创建 + 生命周期 + 编排」，并作为**唯一对外 barrel**
 * （re-export 各子模块）——调用方 `import ... from '../engine/mindmap'` 全部不变。
 *
 * 子模块（同 engine/ 层内，vendor 私有形态仍只出现在本层）：
 * - `mindmap-commands`  引擎命令名表 + 快捷键闸门（叶子）
 * - `mindmap-timers`    引擎延时任务登记表（叶子）
 * - `mindmap-history`   命令历史内存预算策略
 * - `mindmap-viewport`  画布几何 / 视口（适配、居中、缩放、平移、视口状态）
 * - `mindmap-nodes`     节点查询与工具 + 节点文本编辑
 * - `mindmap-clipboard` 选中子树的复制/剪切/粘贴
 * - `mindmap-search`    搜索子系统防腐收口
 * - `mindmap-export`    导出（PNG/SVG）
 * 主题配置见 mindmap-theme.ts（本文件 re-export）。
 */
import {
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
import type { Language } from '../core/i18n';
import { docWikiLinkDisplay, type WikiAliasSource } from '../domain/wiki-display';
import {
	RENDER_ASYNC_NODE_THRESHOLD,
	RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS,
	RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS,
	RESET_LAYOUT_VIEWPORT_DELAY_MS,
	shouldEnablePerformanceMode,
} from '../core/constants';
import {
	ENGINE_COMMANDS,
	removeEngineShortcut,
	shortcutGateAllows,
} from './mindmap-commands';
import { scheduleEngineTimer } from './mindmap-timers';
import { applyHistoryLimitOnCreate } from './mindmap-history';
import { fitMindMap } from './mindmap-viewport';
import { countTreeNodes, getRenderRoot } from './mindmap-nodes';

// 对外 API 转发（调用方一律 `import ... from '../engine/mindmap'`）。
// 两种写法**各有用途，勿统一**：
// - `export *`：子模块的导出面**恰好等于**公共 API（不含仅供 engine/ 内共享的符号），
//   用于 viewport / nodes / clipboard / search / export；
// - 显式具名：子模块另含**内部共享**符号（`scheduleEngineTimer` /
//   `removeEngineShortcut` / `HISTORY_DEFAULT_MAX_COUNT` 等），逐名列出以免回吐。
export {
	getThemeConfig,
	isDarkTheme,
	supportsLineStyleSwitch,
} from './mindmap-theme';
export { ENGINE_COMMANDS, shortcutGateAllows } from './mindmap-commands';
export { cancelEngineTimers } from './mindmap-timers';
export {
	HISTORY_BUDGET_BYTES,
	HISTORY_SNAPSHOT_BYTES_PER_NODE,
	resolveHistoryLimit,
	syncHistoryLimit,
} from './mindmap-history';
export * from './mindmap-viewport';
export * from './mindmap-nodes';
export * from './mindmap-clipboard';
export * from './mindmap-search';
export * from './mindmap-export';

export interface CreateMindMapOptions {
	layout: string;
	/** 连线样式偏好（折线 straight / 曲线 curve；两态由设置与工具栏共同约束） */
	lineStyle: string;
	/** 主题色偏好（default/light/dark —— 只决定明暗色板） */
	themePref: string;
	/**
	 * 节点外观主题（`core/constants.THEME_STYLE_OPTIONS` 的 id）。
	 * 与 `themePref` **正交**：themePref 管配色，本项管节点形态（填充/边框）。
	 * 设为必填而非缺省：新增调用点漏传会静默丢掉用户的主题选择。
	 */
	themeStyle: string;
	isDark: boolean;
	enableDrag: boolean;
	/**
	 * **只读嵌入**（Markdown ```mindmap 代码块，可选；缺省 = 可编辑视图）。
	 *
	 * 用引擎原生 `readonly`（上游 `constants/defaultOptions.js:13`）而非另造开关：
	 * 阻断**全部命令**（`core/command/Command.js:106/137/157`）与节点双击进入
	 * 编辑框、拖拽、多选、图片调宽、画笔（`MindMapNode` / `Drag` / `Select` /
	 * `NodeImgAdjust` / `Painter` / `TextEdit` 各自早退）；**渲染本身不受影响**
	 * （`Render.selectAll` 之外无 readonly 分支）。
	 *
	 * 为真时 `createMindMap` **不注册任何交互插件**，理由各有实证：
	 * - `Search` / `KeyboardNavigation` 经 `KeyCommand.bindEvent` 在 `window` 上
	 *   注册 keydown（上游 `KeyCommand.js:88`），会与宿主笔记抢 `Ctrl+F` 与方向键；
	 * - `TouchEvent` 抢触屏手势（笔记滚动/手势导航优先）；
	 * - `DoExport` 在嵌入形态没有任何导出入口，注册属纯空转；
	 * - `Select` / `Drag` 在 readonly 下本就恒早退。
	 *
	 * ⚠ 滚轮**不在** readonly 的豁免范围内：`Event.onMousewheel` 无条件
	 * `stopPropagation + preventDefault`（上游 `core/event/Event.js:148-150`），
	 * 嵌入调用方必须自建"滚轮归宿主页面"的拦截（见 `features/mindmap-codeblock`）。
	 */
	readonly?: boolean;
	/**
	 * **画布拖动（视图平移）**（可选；缺省 = 启用，同可编辑视图）。
	 *
	 * 置 `false` ⇒ 引擎原生 `isDisableDrag: true`（上游 `constants/defaultOptions.js:191`）
	 * 在 `core/view/View.js:34` 与 `:44` 两处早退，关掉**左键/中键拖动画布**。
	 * 与 `Drag` 插件（节点自身拖拽）无关——后者由 `enableDrag` 管。
	 *
	 * 只读嵌入（`readonly: true`）**仍须显式传** `false`：`readonly` 只管命令与
	 * 节点编辑，不含画布平移——不关掉的话，用户能在「已完整显示」的嵌入图上
	 * 把内容拖出视野（Mermaid 形态的嵌入没有平移语义）。
	 */
	enableViewDrag?: boolean;
	/**
	 * 快捷键**前置钩子**（可选；引擎 `opt.beforeShortcutRun`，返回 `true` 即
	 * 取消该快捷键的引擎行为）。当前唯一用途：把 `Ctrl+C` / `Ctrl+X` / `Ctrl+V`
	 * 从引擎的「内部 JSON 剪贴板」收回到插件的 Markdown 剪贴板
	 * （2026-10-13 用户裁决，见 `features/view-clipboard`）。
	 *
	 * ⚠ 引擎对**每一个**快捷键都会调用它（Tab / Enter / Ctrl+数字…），
	 * 实现必须只对剪贴板三键返回 `true`，其余返回 `false` 放行——否则
	 * 添加子节点、重做等既有快捷键会一起失效。
	 */
	beforeShortcutRun?:
		| ((key: string, nodes: readonly MindMapNode[]) => boolean)
		| null;
	/**
	 * 性能模式（虚拟渲染）**引擎级覆盖**（可选，2026-10-09 起生产不再传）：
	 * 缺省 = 常开，阈值用 `PERFORMANCE_NODE_THRESHOLD`（见
	 * `core/constants.shouldEnablePerformanceMode`）。保留此通道是给
	 * `verify:visual` 的 perf 探针构造「阈值之上 / 之下」两种局面。
	 */
	performanceMode?: boolean;
	performanceThreshold?: number;
	/**
	 * 打开分片渲染显式覆盖（可选）：不传时按 `RENDER_ASYNC_NODE_THRESHOLD`
	 * 阈值判据（生产默认）；传布尔则强制开/关——bench 对照实验（同步 vs 分片）
	 * 的专用通道，走 `--bench-open` + `BENCH_RENDER_ASYNC` 环境变量。
	 */
	renderAsync?: boolean;
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
	 * `lang` 为当前语言（超长截断提示等文案用）；
	 * `owner` 为**本次创建的引擎实例**（createMindMap 内部注入，非调用方提供）
	 * ——供平台侧把异步渲染的未定稿段登记到引擎归属上（首帧前的预测量与首帧的
	 * 节点内容构建都携带它；不透明 token，调用方只透传）。
	 */
	createNodeContent?:
		| ((
				node: MindMapNode,
				doc: Document,
				style: NodeContentStyle,
				lang: Language,
				owner: object | null,
		  ) => HTMLElement | null)
		| null;
	/**
	 * **导出 SVG 后处理**（可选）：引擎导出 PNG/SVG/PDF 时对**克隆的** SVG
	 * 调用，须原样返回收到的同一对象（vendor `opt.handleBeingExportSvg`，
	 * 未入 d.cts，经 Object.assign 注入，与 createNodePrefixContent 同口径）。
	 *
	 * 用途：把只存在于**文档级**的样式注入导出 SVG——MathJax CHTML 的逐字符
	 * 字形依赖 `<style id="MJX-CHTML-styles">` 的 `mjx-c…::before` 规则，
	 * 而引擎导出只注入自身 CSS，导致导出图中数学元素无内容、渲染为空白
	 * （用户实测：导出 PNG 里 `$E=mc^2$` 节点空白）。
	 *
	 * `svg` 为 @svgdotjs/svg.js 元素对象（原生节点在 `.node`）。
	 */
	handleExportSvg?: ((svg: unknown) => unknown) | null;
}

/** 自绘节点内容可用的主题样式（引擎 style 合并结果，解析收口在 mindmap.ts） */
export interface NodeContentStyle {
	/** CSS 长度（引擎可能给数字，已归一为 '13px' 形态） */
	fontSize?: string;
	color?: string;
	fontWeight?: string;
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
 * 视图场景：选择、触控、键盘导航、导出、搜索全部启用；节点拖拽按设置启用。
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
	/**
	 * 本次创建的引擎实例（未定稿数学段的**归属 token**，经构建回调透传给
	 * `platform/math-jax` 的登记面；语义见那里 `unsettledMath`）。
	 * `new MindMap` 完成前为 null——构建回调的实际调用（首帧前的预测量与
	 * 首帧的节点内容创建）都发生在其后，闭包读取到的恒为已赋值的实例。
	 */
	let engineOwner: object | null = null;
	/** 只读嵌入（见 CreateMindMapOptions.readonly）：命令/编辑全禁 + 不注册交互插件 */
	const isReadonly = options.readonly ?? false;

	const mindMap = new MindMap(
		Object.assign(
			{
				el,
				data,
				layout: options.layout,
				theme: 'default',
				themeConfig: getThemeConfig(
					dark,
					options.layout,
					options.lineStyle,
					options.themeStyle,
				),
				// 不在创建时 fit 全图：打开后的默认视口由 centerContentAtFullScale
				// 统一设置（100% + **整体内容**居中）。注意引擎布局默认
				// initRootNodePosition=[center,center]，首次布局会把根节点摆在
				// 画布中心，故视口必须在首次布局落地时立即应用（engine-controller
				// 的 node_tree_render_end 处理），否则会先亮「根居中」再跳
				fit: false,
				// 新建节点默认**空文本**（2026-09-28 方案 B，K93）：占位文字会干扰
				// 「新建即输入」（此前为 i18n 的「节点」/「子节点」）；空节点由引擎
				// 渲染为空框（含最小尺寸），配合插入路径 openEdit=true（新建即进入
				// 编辑 + 全选）体验完整。
				defaultInsertSecondLevelNodeText: '',
				defaultInsertBelowSecondLevelNodeText: '',
				openPerformance: performanceEnabled,
				performanceConfig: { ...PERFORMANCE_CONFIG },
				enableFreeDrag: options.enableDrag,
				readonly: isReadonly,
				// 画布拖动（视图平移）：嵌入置 false（见 CreateMindMapOptions.enableViewDrag）
				isDisableDrag: options.enableViewDrag === false,
				customHyperlinkJump: options.onHyperlinkJump ?? null,
			} satisfies MindMapOptions,
			{
				// 画布导航（官方 Canvas「Navigate the canvas」）**由引擎实现**，这里显式
				// 钉住官方语义，不依赖「引擎默认值恰好一致」（升级换默认值时行为会悄悄变）：
				// 滚轮 = 平移（官方 :227）、`Ctrl/Cmd + 滚轮` = 以指针为锚缩放（:231，
				// 故 disableMouseWheelZoom 必须为 false）。左键/中键拖拽（:226）
				// 走引擎 event 模块的 isLeft/isMiddleMousedown → 'drag'，由
				// `isDisableDrag` 统一切断（见 CreateMindMapOptions.enableViewDrag）。
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
				// 快捷键前置钩子（剪贴板三键回收）：字段未入 d.cts，与
				// createNodePrefixContent / renderAsync 同口径经 Object.assign 注入。
				// 缺省 null ⇒ 引擎快捷键行为不变（只读嵌入与探针不受影响）
				beforeShortcutRun: options.beforeShortcutRun ?? null,
				// 快捷键**前置闸门**（整份替换引擎默认判定，见 shortcutGateAllows）：
				// 默认实现只在 body / 编辑类元素上放行，而自绘内容里的可聚焦元素
				// （代码块复制按钮、外链锚点）会让三键与其余画布快捷键静默失效。
				// 用 `engineOwner` 做懒引用：闸门在 keydown 时才读引擎
				// （构造期间 engineOwner 尚为 null，见其赋值点）
				customCheckEnableShortcut: (event: KeyboardEvent) =>
					shortcutGateAllows(engineOwner, el, event),
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
								engineOwner,
							)
					: null,
			},
			{
				// 打开分片渲染（性能轮方案 B，补丁 6）：把 `_render` 整树
				// 渲染接入引擎既有 async 通道——**补丁 12 起**该通道为「任务队列 +
				// MessageChannel 批量消费（8ms/批）」，不再是「每子节点一个
				// setTimeout」（后者被嵌套定时器 4ms 下限放大，5000 节点整树可见
				// 实测 20–38s）。打开/重建大图时消除 1s 级 UI 冻结。显式传
				// renderAsync 优先（bench 对照用），否则按节点数阈值判据。字段未入
				// d.cts，经 Object.assign 注入（同 createNodePrefixContent 口径）。
				renderAsync:
					options.renderAsync ?? nodeCount >= RENDER_ASYNC_NODE_THRESHOLD,
				// 导出 SVG 后处理：把文档级 MathJax 样式注入克隆 SVG（契约与背景见
				// CreateMindMapOptions.handleExportSvg）；字段未入 d.cts，经
				// Object.assign 注入（同 createNodePrefixContent 口径）。
				// ⚠ 新增注入键请**并入现有段**：Object.assign 的类型重载只覆盖到
				// 3 个 source，第 4 段起返回 `any` → 触发 no-unsafe-argument。
				handleBeingExportSvg: options.handleExportSvg ?? null,
			},
		),
	);
	// 归属 token 落地：此后的一切内容构建（预测量 / 首帧 / 重建）都携带它
	engineOwner = mindMap;

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

	// 只读嵌入（```mindmap 代码块）不注册任何交互插件：Search / KeyboardNavigation
	// 经 KeyCommand 在 window 上抢宿主笔记的 Ctrl+F 与方向键，TouchEvent 抢触屏手势，
	// DoExport 没有入口，Select / Drag 在 readonly 下恒早退（逐条理由见
	// CreateMindMapOptions.readonly）。
	if (!isReadonly) {
		mindMap.addPlugin(Select);
		mindMap.addPlugin(TouchEvent);
		// 不注册 AssociativeLine（关联线，2026-10-09 减法）：引擎侧唯一的创建入口是
		// 引擎自带右键菜单，而本项目从不配置 `opt.contextmenu`——节点右键走
		// features/view-context-menu 的 Obsidian Menu，故注册了也**没有任何入口能创建**
		// 关联线，属纯空转。若将来要开放该能力，须同时给出显式入口（工具栏/菜单 + i18n），
		// 并注意关联线**不进 Markdown**（渲染层状态，不落文件）。
		mindMap.addPlugin(KeyboardNavigation);
		mindMap.addPlugin(DoExport);
		mindMap.addPlugin(Search);
		if (options.enableDrag) {
			mindMap.addPlugin(Drag);
		}
	}
	// 命令历史内存控制：每步一条「整树 JSON 快照」，固定条数上限会让单视图历史
	// 内存随图规模失控（旧策略 500 条 × 500 节点 ≈ 91MB，见 K65/K66）。
	// 预算怎么算、何时下调收口在 `mindmap-history`（此处只给节点数，不复述策略）。
	applyHistoryLimitOnCreate(mindMap, nodeCount);
	// 引擎 KeyboardNavigation 插件自带 Ctrl+L = RESET_LAYOUT（只重排、不含
	// 「适应画布」、也无提示），与插件「自动整理」命令口径不一；而本插件不定义
	// 默认热键（命令一律由用户在 Hotkeys 中自行分配）。故移除它——自动整理统一
	// 走 mindmap-arrange 命令，用户把它绑到 Ctrl+L 时同样以「适应画布」收尾。
	// 只读嵌入没注册 KeyboardNavigation，无此快捷键可移除。
	if (!isReadonly) {
		removeEngineShortcut(mindMap, 'Control+l');
		// 引擎（核心 Render）另绑 `Del|Backspace` → REMOVE_NODE（上游
		// `core/render/Render.js`，bundle 同源；AssociativeLine / OuterFrame 也有
		// 同键绑定，但本插件不注册这两个插件）。插件 scope 同样注册了这两个键
		// （删除选中节点，见 features/view-hotkeys），两条通道并存只靠「scope 先于
		// 引擎 window 监听」的顺序假设避免双删——引擎先删会自动激活兄弟节点，
		// 随后插件删掉的就不再是原节点。显式摘除引擎那份，**归属唯一**。
		removeEngineShortcut(mindMap, 'Del|Backspace');
	}

	// 首帧前批量预测量 + 元素复用（引擎补丁 5，见 vendor/BUILD.md「补丁清单」）：
	// 用与正式路径同一条构建链（doc / style / lang 全绑定）预生成自绘内容——
	// ① 集中挂载测一次 reflow，尺寸写入内容寻址测量缓存（补丁 4）；② 元素按
	// uid 登记，正式内容创建点（MindMapNode）优先复用 ⇒ 首帧只剩一遍内容构建
	// 且测量零 reflow。构建 / 数据 / 样式任何不一致只导致缓存 miss 或复用失效
	// （回退原路径，无副作用）。时序：`new MindMap` 的首帧渲染只排了
	// setTimeout(0)，本调用发生在其回调之前。
	if (createNodeContent) {
		const preMeasure = (
			MindMap as unknown as {
				preMeasureCustomContents?: (
					map: unknown,
					build: (proxyNode: unknown) => unknown,
				) => void;
			}
		).preMeasureCustomContents;
		preMeasure?.(mindMap, (proxyNode) =>
			createNodeContent(
				proxyNode as MindMapNode,
				el.ownerDocument,
				resolveNodeContentStyle(proxyNode as MindMapNode),
				options.lang,
				engineOwner,
			),
		);
	}
	return mindMap;
}

/**
 * 请求引擎重建布局与画布几何（容器尺寸变化时调用）。
 *
 * 为什么需要薄封装：`mindMap.resize` 在 `createMindMap` 里被包了一层**零尺寸守卫**
 * （容器宽/高为 0 时引擎直接抛错），而"零尺寸守卫已装好"这件事只在本文件可见——
 * 调用方（视图 / 代码块嵌入）直接调 `mindMap.resize()` 时无法表达这层保证。
 */
export function resizeMindMap(mindMap: MindMap | null): void {
	mindMap?.resize();
}

/**
 * 重算主题配置所需的**全部**外观输入（当前亮暗 + 主题色 + 布局 + 连线样式 +
 * 主题）。
 *
 * 为什么是对象而不是五个位置参数：四个维度里有四个都是 `string`，
 * 漏传/错序在编译期无法发现（`themePref` 与 `themeStyle` 尤其容易互换），
 * 而它们各自对应一个用户可见设置。对象形态让「新增外观维度」只需加一个键，
 * 调用点由类型检查兜住。
 */
export interface ThemeConfigInput {
	/** 宿主当前亮暗（`App.isDarkMode()`），与 `themePref` 经 `isDarkTheme` 合成 */
	isDark: boolean;
	/** 主题色偏好（default/light/dark） */
	themePref: string;
	layout: string;
	/** 连线样式偏好（straight/curve） */
	lineStyle: string;
	/** 节点外观主题 id（default/borderless） */
	themeStyle: string;
}

/**
 * 按 `ThemeConfigInput` 重算主题配置并写入引擎实例。
 *
 * 收口理由：`mindMap.setThemeConfig` 是引擎**内部形态**的唯一写入通道，
 * 而引擎内部访问只允许出现在 engine/ 层——此前 `services/engine-controller`
 * 直接调它，本次新增的代码块嵌入也要在 `css-change` 时原地换肤，两处各写一次
 * 就是第二份收口，故提到此处。
 */
export function applyThemeConfig(
	mindMap: MindMap | null,
	input: ThemeConfigInput,
): void {
	if (!mindMap) {
		return;
	}
	mindMap.setThemeConfig(
		getThemeConfig(
			isDarkTheme(input.themePref, input.isDark),
			input.layout,
			input.lineStyle,
			input.themeStyle,
		),
	);
}

/** 安全销毁思维导图实例 */
export function destroyMindMap(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		mindMap.destroy();
	} catch (error) {
		console.error('销毁思维导图实例失败', error);
	}
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
 * @public 自 2026-10-09（K117）起**生产路径不再调用**：`performanceMode` /
 * `performanceThreshold` 设置项已删（性能模式常开 + 常量阈值），运行时切换没有
 * 触发源。保留它是给 `scripts/verify-visual.mjs` 的 perf-switch / render-eco 探针
 * ——那两个探针把引擎侧「运行时切换」的语义（含开启方向要补一次渲染）钉成回归闸门，
 * 一旦将来重新暴露开关，可直接复用。该脚本在**页内生成的模块字符串**里 import
 * （静态分析看不见），故用 `@public` 显式声明为受支持的对外面（`check:dead-code`
 * 的 knip 认这个标记）。
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
