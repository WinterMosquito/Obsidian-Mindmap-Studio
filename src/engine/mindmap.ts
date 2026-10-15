/**
 * simple-mind-map 引擎封装：实例创建/销毁、节点工具、自动整理（重置布局）。
 * 主题配置见 mindmap-theme.ts（本文件 re-export，调用方 import './mindmap' 不变）。
 */
import {
	DoExport,
	Drag,
	KeyboardNavigation,
	MindMap,
	MindMapNode,
	MindMapNodeData,
	MindMapOptions,
	MindMapTreeNode,
	Search,
	Select,
	TouchEvent,
} from '../../vendor/simple-mind-map.cjs';
import { getThemeConfig, isDarkTheme, getDocIconColor } from './mindmap-theme';
import type { Language } from '../core/i18n';
import { walkTree } from '../domain/tree';
import { docWikiLinkDisplay, type WikiAliasSource } from '../domain/wiki-display';
import {
	RENDER_ASYNC_NODE_THRESHOLD,
	RESET_LAYOUT_ROOT_WAIT_INTERVAL_MS,
	type ExportImageFormat,
	RESET_LAYOUT_ROOT_WAIT_TIMEOUT_MS,
	RESET_LAYOUT_VIEWPORT_DELAY_MS,
	shouldEnablePerformanceMode,
} from '../core/constants';
import { createWarnOnce } from '../core/errors';
import { readNodeDataString } from '../core/node-data';

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
	/**
	 * 上移节点：与**前一兄弟**交换顺序（`Render.upNode`，同时改实例数组与
	 * `parent.nodeData.children` 后整树 render）。
	 * 只作用于**第一个激活节点**——调用方应显式传 `appointNode`（画布委托
	 * 路径可能处于多选态，激活列表顺序不可依赖）。
	 * 无节点 / 根节点 / 已在首位时**静默 no-op**（用户可见提示由调用方给）。
	 */
	UP_NODE: 'UP_NODE',
	/** 下移节点：与后一兄弟交换；语义与边界同 UP_NODE（`Render.downNode`） */
	DOWN_NODE: 'DOWN_NODE',
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
	/**
	 * 剪切选中节点（引擎已完成「顶层去重 + 文档序排序 + **过滤根节点** +
	 * 从父节点数据移除 + 清激活 + 重绘」，并经回调交回被剪的数据）。
	 * 回调参数形态 = `MindMapTreeNode[]`（见 cutSelectedSubtrees）。
	 */
	CUT_NODE: 'CUT_NODE',
	/** 批量插入子节点（appointNodes, childList；childList 内可带 children 多层） */
	INSERT_MULTI_CHILD_NODE: 'INSERT_MULTI_CHILD_NODE',
} as const;

export interface CreateMindMapOptions {
	layout: string;
	/** 连线样式偏好（auto/curve/direct/straight；auto＝随布局） */
	lineStyle: string;
	themePref: string;
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
 * 使用；生产路径经 `createMindMap`（创建期）与 `syncHistoryLimit`（会话内）调用。
 */
export function resolveHistoryLimit(nodeCount: number): number {
	const perSnapshot = Math.max(1, nodeCount) * HISTORY_SNAPSHOT_BYTES_PER_NODE;
	const affordable = Math.floor(HISTORY_BUDGET_BYTES / perSnapshot);
	return Math.min(
		HISTORY_DEFAULT_MAX_COUNT,
		Math.max(HISTORY_MIN_COUNT, affordable),
	);
}

/**
 * 会话内同步命令历史上限：按**当前**渲染树节点数重算（`resolveHistoryLimit`）。
 *
 * 创建期只按「打开那一刻」的节点数反推一次——会话内长大的图（连续编辑 / 粘贴 /
 * 拖入）会让 30MB 预算逐步失效：从空图长到 1000 节点仍保留 500 条 ⇒ 最坏
 * ≈192MB（K65 口径 ≈384B/节点/条，预算本应 30MB）。反向（图变小）不重算只是
 * 撤销深度偏浅，一并覆盖。**下调上限不会立刻裁剪已存历史**（引擎只在 push
 * 时 shift 越过上限的条目），渐进收敛即可；与当前值相同则连 `updateConfig`
 * 都不发（maxHistoryCount 是 opt 活引用，直接读取比较）。
 *
 * 计数本身是一次全树遍历（`countTreeNodes`）——档位判定离不开节点数，引擎
 * 既无 O(1) 计数字段也无结构变更事件可作前置闸门（vendor 实测：无
 * nodeCount，`data_change` 不带原因），故不做「先比较后计数」。成本落在
 * 1s 节流窗口内（消费方已节流），大图实测为亚毫秒级。
 *
 * 消费方：EngineController 的 data_change 通道（已按节流窗口去重），勿逐命令调用。
 */
export function syncHistoryLimit(mindMap: MindMap): void {
	const root = getRenderRoot(mindMap);
	if (!root) {
		return;
	}
	const limit = resolveHistoryLimit(countTreeNodes(root));
	if (mindMap.opt?.maxHistoryCount === limit) {
		return;
	}
	try {
		mindMap.updateConfig({ maxHistoryCount: limit });
	} catch (error) {
		// 引擎中间态（重建窗口）可能拒绝更新：历史预算属尽力而为，不中断事件链
		console.error('同步命令历史上限失败', error);
	}
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
				themeConfig: getThemeConfig(dark, options.layout, options.lineStyle),
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
				// 渲染接入引擎既有 async 通道（每子节点一个宏任务），打开/重建大图时
				// 消除 1s 级 UI 冻结。显式传 renderAsync 优先（bench 对照用），否则按
				// 节点数阈值判据。字段未入 d.cts，经 Object.assign 注入（同
				// createNodePrefixContent 口径）。
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
 * 引擎快捷键的**前置闸门**（`customCheckEnableShortcut`：**整份替换**引擎默认
 * 实现，见 vendor `KeyCommand.onKeydown`）。
 *
 * 为什么要自定义：默认实现只在 `target === document.body` 或命中引擎
 * `editNodeClassList` 时放行。而本插件的自绘内容里存在**可聚焦元素**——代码块
 * 复制 `<button>`、外链 `<a>`——点过它们之后焦点留在按钮上，Ctrl+C/X/V 与其余
 * 画布快捷键**静默失效**，直到点回画布空白（2026-10-15 审计，选项 A）。
 *
 * 放行集合 = 引擎默认（body + 编辑类元素；编辑框挂在 `document.body` 或
 * `customInnerElsAppendTo` 下，**不一定**在画布内）∪ **本引擎画布内**
 * （`canvasEl.contains`）。画布内放行是安全的：剪贴板三键经 `beforeShortcutRun`
 * 由插件接管（引擎那份被取消），其余快捷键本就以画布为操作对象。
 *
 * 放宽的**副作用**（2026-10-15 登记，勿再「顺手收紧」而不读这段）：焦点落在
 * 自绘内容里时，生效的不止剪贴板三键——`Control+a`（引擎全选）、`Control+z/y`
 * （撤销重做）、`Control+g` 等凡引擎注册且以画布为操作对象的快捷键一并由
 * 「静默失效」变为生效；其中 `Control+a` 会压掉浏览器的页面全选。这是**有意**
 * 取舍（自绘内容里的可聚焦元素不应让整张画布的快捷键失灵）。
 *
 * @param owner 引擎实例（懒引用：构造期尚为 null，keydown 时必然就位）；
 *   仅用于读 `editNodeClassList`——与默认实现同一来源，不另抄类名表
 */
export function shortcutGateAllows(
	owner: object | null,
	canvasEl: HTMLElement,
	event: KeyboardEvent,
): boolean {
	const target = event.target as Node | null;
	if (!target) {
		return true; // 无目标（合成事件）：按默认放行
	}
	if (target === document.body) {
		return true;
	}
	const editClasses = (owner as { editNodeClassList?: unknown } | null)
		?.editNodeClassList;
	// `nodeType === ELEMENT_NODE` 而非 `instanceof Element`：后者跨窗口（popout）
	// 会假阴；本文件又必须能脱离 obsidian 打包（verify:visual 的浏览器 IIFE），
	// 不能用官方的 `instanceOf` 助手——故用等价且跨窗口安全的判据
	if (target.nodeType === 1 && Array.isArray(editClasses)) {
		const element = target as Partial<Element>;
		if (
			editClasses.some(
				(cls) =>
					typeof cls === 'string' && element.classList?.contains(cls) === true,
			)
		) {
			return true;
		}
	}
	return canvasEl.contains(target);
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
 *
 * 尺寸**真的变化**时还须把 `resize()` 编排的那次渲染的**启动**提前
 * （`flushPendingLayoutRender`，缩短错配窗口）；调用方（fit / 居中）一律登记
 * 「渲染落地后居中补正」（`scheduleCenteringCorrection`）——布局落地是
 * **异步**的（见 flushPendingLayoutRender 的实测结论），同步块内拿不到新几何。
 */
function syncCanvasGeometry(mindMap: MindMap): void {
	if (!getLiveCanvasRect(mindMap)) {
		return;
	}
	const widthBefore = mindMap.width;
	const heightBefore = mindMap.height;
	try {
		(mindMap as unknown as { resize?: () => void }).resize?.();
	} catch (error) {
		console.warn('同步画布几何失败', error);
	}
	if (mindMap.width !== widthBefore || mindMap.height !== heightBefore) {
		flushPendingLayoutRender(mindMap);
	}
}

/**
 * 把 `resize()` 刚编排、尚未执行的那次渲染的**启动**提前到本次同步块。
 *
 * 存在理由（实机复现的「适应画布 → 重置缩放偏右」）：`resize()` 在「尺寸变化」
 * 分支只调一次 `render()`——而 vendor 的 `Renderer.render()` 是
 * `clearTimeout(renderTimer); renderTimer = setTimeout(() => this._render(), 0)`，
 * 真正的 `_render()` 被推迟到下一个宏任务。于是存在窗口：`mindMap.width/height`
 * 已是实时容器尺寸，渲染树节点的 left/top 仍是上一尺寸基准。性能模式的
 * 「适应画布」用**数据层几何**求内容盒，在该窗口内测量就是旧布局中心，而目标
 * 画布中心是新值——平移残差 `(W新−W旧)/2`（屏幕上被 ×scale 压小、肉眼难辨）；
 * `resetZoom` 随后按 `1/scale` 缩放回 100%，把同一残差**放大**回屏幕（实机
 * 500 节点：容器 1357.33↔1050 变化 ⇒ 重置缩放后偏 153.67px = 变化量的一半），
 * 表现为「视图偏右/偏左」。打开时的默认视口（centerContentAtScale）走同一
 * 入口，同样受影响（实机实测打开即偏 ~16px）。
 *
 * 为什么只是「提前启动」而非「同步落地」：实测（verify:visual 的
 * viewport-geometry 探针）`_render()` 内部的 `layout.doLayout(callback)` 回调
 * 是**异步**触发的——`_render()` 返回后 `renderer.root` 仍为 null、布局几何
 * 尚不可读。故同步块内拿不到新几何，只能把渲染的**启动**提前（`renderTimer`
 * 的宏任务提前到本次同步块；**正常路径零额外渲染**：那次渲染本来就会跑
 *〔若那次渲染因异常未被编排，实现处有一次防御性强制渲染，见下方注释〕），几何补正由
 * `scheduleCenteringCorrection` 在渲染落地后完成。
 *
 * `_render()` 自带重入守卫（渲染在途时只置 `hasWaitRendering` 并返回）——那种
 * 情况下在途渲染的布局已按它启动时的宽度落地，最终一致由引擎自己的补跑保证，
 * 不额外干预。
 *
 * 防御：`_render` / `renderTimer` 是 vendor 私有面（未入 d.cts），缺失时静默
 * 跳过（行为退回「不落地」，不崩）。
 */
function flushPendingLayoutRender(mindMap: MindMap): void {
	const renderer = (
		mindMap as unknown as {
			renderer?: { renderTimer?: unknown; _render?: () => void };
		}
	).renderer;
	if (!renderer || typeof renderer._render !== 'function') {
		return;
	}
	const timer = renderer.renderTimer;
	if (typeof timer === 'number') {
		// 与 vendor 的 `setTimeout` 同一 window（引擎模块在插件上下文求值），
		// 用裸 clearTimeout 会被 obsidianmd/prefer-window-timers 拦下
		window.clearTimeout(timer);
	}
	renderer.renderTimer = null;
	// 正常路径是「**提前**」而非「新增」：唯一调用方 `syncCanvasGeometry` 只在
	// `resize()` 真把尺寸改掉时进来，而 vendor `render()` 的尺寸变化分支必然
	// 同步排过一次渲染（先 clearTimeout 再 setTimeout）⇒ 那次渲染本来就会跑。
	// **防御兜底**：若那次渲染因异常未被编排（timer 非 number），此处强制一次
	// ——宁可多一次渲染，也不要几何停在旧基准（随后的 fit / 居中补正都按新几何算）。
	try {
		renderer._render();
	} catch (error) {
		console.warn('同步落地画布渲染失败', error);
	}
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
 * 按「当前亮暗 + 主题偏好 + 布局 + 连线样式偏好」重算主题配置并写入引擎实例。
 *
 * 收口理由：`mindMap.setThemeConfig` 是引擎**内部形态**的唯一写入通道，
 * 而引擎内部访问只允许出现在 engine/ 层——此前 `services/engine-controller`
 * 直接调它，本次新增的代码块嵌入也要在 `css-change` 时原地换肤，两处各写一次
 * 就是第二份收口，故提到此处。
 *
 * `isDark` 传**宿主当前亮暗**（`App.isDarkMode()`），`themePref` 是设置里的
 * 主题偏好（default/light/dark）——两者经 `isDarkTheme` 合成真正的亮暗。
 */
export function applyThemeConfig(
	mindMap: MindMap | null,
	isDark: boolean,
	themePref: string,
	layout: string,
	lineStyle: string,
): void {
	if (!mindMap) {
		return;
	}
	mindMap.setThemeConfig(
		getThemeConfig(isDarkTheme(themePref, isDark), layout, lineStyle),
	);
}

/**
 * 适应画布（性能模式适配）。
 *
 * 引擎 view.fit() 基于可见节点的 SVG 包围盒（rbox）计算缩放；性能模式下
 * 视口外节点已被引擎移除出 DOM（removeNodeWhenOutCanvas），直接 fit 只会
 * 适配「可见子集」。旧实现先 forceLoadNode 强制渲染全部节点（5000 节点
 * ≈1.1s **同步**装配，K70 实测）再 fit——「自动整理 / 切布局」可重复触发，
 * 是大图上的 1s 级冻结。
 *
 * 现改为**数据层 fit**（2026-10-02，K70 残留消除；与 `centerContentAtFullScale`
 * 同族）：用渲染树布局几何并集算目标缩放与居中平移，零 DOM 装配。语义与 vendor
 * `View.fit` 对齐：`fitPadding`（默认 50）、缩放上限 1、**三种 flag 下内容中心
 * 均落在画布中心**（推导：flag1/2/3 的最终中心均为 `p + (E-2p)/2 = E/2`——故
 * 复刻按中心对齐即可，无需分支）；差异仅在于用**实时容器**而非缓存 `elRect`
 * 换算（方向为「更正确」，同 K64 既有修订）。
 *
 * 数据层几何不可得（渲染树未就绪）时回退旧路径（forceLoadNode + fit）。
 * 常规模式行为不变（DOM 全量在，vendor fit 的 rbox 口径含描边，更精确）。
 *
 * fit 之后**一律**登记一次「渲染落地后居中补正」：居中几何可能有两类滞后——
 * 尺寸刚变化（布局切基准是异步的，见 flushPendingLayoutRender）与首帧几何
 * 未收敛（fit 触发的重渲染会按稳定态尺寸重跑布局）——不补正都会留下残差、
 * 被 resetZoom 按 1/scale 放大（见 scheduleCenteringCorrection）。
 */
export function fitMindMap(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		// 引擎 fit 用缓存的 elRect 换算，先同步到实时容器（首帧窗口内
		// onResize 尚未触发，不同步会按旧画布尺寸适配）
		syncCanvasGeometry(mindMap);
		// 见 JSDoc：只补平移（缩放由内容尺寸决定、与布局基准无关，无需重算）
		scheduleCenteringCorrection(mindMap);
		if (mindMap.opt?.openPerformance) {
			if (fitPerformanceMindMapFromData(mindMap)) {
				return;
			}
			// 数据层几何不可得：回退全量装配（旧路径）
			mindMap.renderer.forceLoadNode?.();
		}
		mindMap.view?.fit();
	} catch (error) {
		console.error('适应画布失败', error);
	}
}

/**
 * 数据层 fit（性能模式专用）：返回是否已处理（false = 调用方回退旧路径）。
 *
 * - 目标缩放 = `min(1, 可用宽/盒宽, 可用高/盒高)`（等价 vendor fit 的 flag 1/2/3）；
 * - 平移 = 内容中心 → 画布中心（见 fitMindMap 的中心推导）；
 * - `setScale` **不传锚点**（vendor fit 同款：只改 scale、位移不变），随之读新
 *   变换再算平移；
 * - **零调用短路**：缩放已对齐时不发 `setScale`、中心已在 ε 内时不发
 *   `translateXY`（居中走共享实现 centerContentByDataBox）——两者都无条件
 *   emit `view_data_change`，性能模式下每次都是一轮分片整树渲染（K70）。
 */
function fitPerformanceMindMapFromData(mindMap: MindMap): boolean {
	const size = getCanvasSize(mindMap);
	const box = measureContentBoxFromData(mindMap);
	const current = readDrawTransform(mindMap);
	if (!size || !box || !current || box.width <= 0 || box.height <= 0) {
		return false;
	}
	const padding = Number(mindMap.opt?.fitPadding ?? 0) || 0;
	const availableWidth = Math.max(1, size.width - padding * 2);
	const availableHeight = Math.max(1, size.height - padding * 2);
	const targetScale = Math.min(
		1,
		availableWidth / box.width,
		availableHeight / box.height,
	);
	const scaleAligned = Math.abs(current.scaleX - targetScale) < 1e-6;
	if (!scaleAligned) {
		mindMap.view?.setScale(targetScale);
	}
	const after = scaleAligned ? current : readDrawTransform(mindMap);
	if (!after) {
		return false; // 变换读取异常：交给调用方回退（旧路径会重新装配，至少功能可用）
	}
	// 居中复用共享实现（含 ε 零调用短路；读数现取，即 setScale 之后的变换）
	centerContentByDataBox(mindMap);
	return true;
}

/**
 * 视口已在目标位置的判定容差（px，亚像素）：平移量小于它时视为「已居中」，
 * 完全不动 view。为什么必须显式短路（K70）：vendor 的 `setScale` **无条件**
 * emit `view_data_change`（`scaleInCenter` 在 Δ=0 时也 `transform() + emit`），
 * 性能模式下该事件经 200ms 节流器触发**分片整树渲染**；而本函数在打开窗口内
 * 被多次调用（首帧渲染结束 / 150ms 兜底 / 图片回灌补居中），几何未变时的
 * 重复调用若不短路就是白渲染一轮（500 节点 ≈ 2495 条属性空写，见 K58）。
 */
const VIEW_CENTER_EPSILON = 0.5;

/**
 * 「渲染落地后居中补正」的观察窗口（ms）：窗口内每次渲染落地都补正，直到
 * 几何指纹连续两轮不变（布局收敛）或轮次/窗口用尽。
 *
 * 为什么是窗口而不是一次性：实机（1000 节点测试图、全新打开）实测布局的
 * **稳定态晚于**打开窗口的既有自愈（`initialViewportRecalcBudget` 2 次 +
 * 200ms recenter）——8s 采样点仍在偏移（dx=-24.97），20s 才自愈；一次性
 * 补正命中不了这类晚到收敛（首帧几何 vs 稳定几何的数据盒中心实测差
 * 24.97px，同族于 500 节点图的 15.9px）。
 */
const CENTER_CORRECTION_WINDOW_MS = 3000;
/** 窗口内最多补正轮次（防病态渲染风暴；正常 ≤2 轮：收敛后再无渲染） */
const CENTER_CORRECTION_MAX_ROUNDS = 6;

/** 居中相关的一次几何采样：画布尺寸 + 数据层内容盒（一起取，避免重复全树遍历） */
interface CenteringGeometry {
	size: { width: number; height: number };
	box: { x: number; y: number; width: number; height: number };
}

/** 采样居中几何；任一不可得返回 null（调用方自行回退） */
function measureCenteringGeometry(mindMap: MindMap): CenteringGeometry | null {
	const size = getCanvasSize(mindMap);
	const box = measureContentBoxFromData(mindMap);
	return size && box ? { size, box } : null;
}

/**
 * 居中几何的指纹（画布尺寸 + 数据盒中心）——「布局是否已收敛」的断言依据：
 * 补正只改平移、不改这些量，故指纹相同 ⇒ 可停手。
 *
 * 入参是**已测得**的几何：`getCanvasSize` 是实时 DOM 读取、
 * `measureContentBoxFromData` 是全树遍历，补正每轮各调一次就是两次全树 walk
 * （见 measureCenteringGeometry）。
 */
function geometrySignature(geometry: CenteringGeometry): string {
	const { size, box } = geometry;
	return `${size.width}x${size.height}|${box.x + box.width / 2}|${box.y + box.height / 2}`;
}

/**
 * 把内容中心对到画布中心（**数据层几何**口径；含 ε 零调用短路）。
 *
 * 自 `fitPerformanceMindMapFromData` 与 `centerContentAtScale` 的同款居中段
 * 抽出（同一判定只留一份），供「落地后补正」（scheduleCenteringCorrection）
 * 复用。**变换一律调用时现取**：调用方若刚改过缩放（`setScale`），本函数
 * 读到的是改后的变换。
 *
 * @param measured 调用方已测得的几何（补正每轮只采样一次，见
 *                 measureCenteringGeometry）；省略则现取
 * @returns 是否已处理：几何不可得（渲染树未就绪）时 false，调用方自行回退；
 *          ε 内为 true 且零调用（不发 `translateXY`——它无条件 emit
 *          `view_data_change`，性能模式下 = 一轮分片整树渲染，K70）
 */
function centerContentByDataBox(
	mindMap: MindMap,
	measured?: CenteringGeometry,
): boolean {
	const geometry = measured ?? measureCenteringGeometry(mindMap);
	const transform = readDrawTransform(mindMap);
	if (!geometry || !transform) {
		return false;
	}
	const { size, box } = geometry;
	const centerX = (box.x + box.width / 2) * transform.scaleX + transform.translateX;
	const centerY = (box.y + box.height / 2) * transform.scaleY + transform.translateY;
	const dx = size.width / 2 - centerX;
	const dy = size.height / 2 - centerY;
	if (
		Math.abs(dx) < VIEW_CENTER_EPSILON &&
		Math.abs(dy) < VIEW_CENTER_EPSILON
	) {
		// 已在目标态：零调用（见 @returns）
		return true;
	}
	mindMap.view?.translateXY(dx, dy);
	return true;
}

/**
 * 登记一次「渲染落地后居中补正」（一次性 + 超时兜底）。
 *
 * 为什么视口操作要在渲染落地后补一次居中——**两类触发**（实机实测）：
 * ① **尺寸刚变化**：`syncCanvasGeometry` 里 `resize()` 触发的重渲染要等
 *    `layout.doLayout` 的**异步回调**才把布局切到新基准（见
 *    flushPendingLayoutRender），同步算出的居中基于旧布局，残差
 *    `(W新−W旧)/2`（实机错配注入复现：fit 后 10.75px ⇒ reset 后 153.67px）；
 * ② **首帧几何未收敛**：打开窗口的布局用首帧节点尺寸，而 fit 自身触发的
 *    重渲染（`view_data_change` → 性能模式节流）会用**稳定态**尺寸重跑布局
 *    ——实机 500 节点：数据盒中心从 1566.4 变到 1550.5（Δ = 15.9 布局坐标），
 *    首次 fit 的残差 = Δ×scale（0.0699 ⇒ 1.11px 屏幕、肉眼难辨），
 *    `resetZoom` 随即按 `1/scale` 放大回 15.91px（实测）。
 * 两类残差都会被 resetZoom 放大，故 fit / 打开视口**一律**登记本补正。
 * 零额外渲染：fit / 居中的 `setScale`/`translateXY`/`setTransformData` 本就
 * 各自触发一轮渲染，补正搭它的车（`node_tree_render_end` 时执行）。
 *
 * 只补「平移」——缩放由内容尺寸决定、与布局基准无关；补正幂等（已居中时
 * ε 短路零调用）。**窗口内跟随**（见 CENTER_CORRECTION_WINDOW_MS）：布局的
 * 晚到收敛（实机 1000 节点图 8s 采样点仍在变、20s 才稳）由多轮补正覆盖，
 * 直到几何指纹连续两轮一致（收敛）或轮次/窗口用尽；视图销毁/引擎缺失时
 * `centerContentByDataBox` 静默返回 false，监听随窗口兜底解除。
 *
 * 两条**生命周期**纪律（否则会叠加监听/悬挂引用）：
 * - **同实例只保留最后一份**：打开流程里 fit 与「居中到全尺度」各自登记一次，
 *   `registerActive` 前先取消上一份——不去重则每次渲染落地都会补正多次、各自
 *   做全树采样，还要多留一份兜底定时器；
 * - **兜底定时器走 `engineTimers`**（`scheduleEngineTimer`）：视图销毁时
 *   `cancelEngineTimers` 一并取消，不留悬挂监听、也不让已销毁的引擎（含历史
 *   记录）被闭包多留一个窗口。
 */
const activeCenteringCorrections = new WeakMap<MindMap, () => void>();

function scheduleCenteringCorrection(mindMap: MindMap): void {
	// 重复登记：先停上一份（含它的监听与指纹状态），避免叠加
	activeCenteringCorrections.get(mindMap)?.();
	const events = mindMap as unknown as {
		on?: (event: string, handler: () => void) => void;
		off?: (event: string, handler: () => void) => void;
	};
	const deadline = Date.now() + CENTER_CORRECTION_WINDOW_MS;
	let rounds = 0;
	let lastSignature: string | null = null;
	let finished = false;
	const stop = (): void => {
		if (finished) {
			return;
		}
		finished = true;
		if (activeCenteringCorrections.get(mindMap) === stop) {
			activeCenteringCorrections.delete(mindMap);
		}
		try {
			events.off?.('node_tree_render_end', onEnd);
		} catch (error) {
			console.warn('解除居中补正监听失败', error);
		}
	};
	function onEnd(): void {
		if (finished) {
			return;
		}
		// 每轮只采样一次：居中与收敛指纹共用（各测一次 = 两次全树遍历 + 两次
		// 实时矩形读取，见 measureCenteringGeometry）
		const geometry = measureCenteringGeometry(mindMap);
		try {
			centerContentByDataBox(mindMap, geometry ?? undefined);
		} catch (error) {
			console.warn('视口居中补正失败', error);
		}
		// 布局指纹连续两轮一致 ⇒ 已收敛，停手；否则继续跟随（覆盖晚到收敛）
		const signature = geometry ? geometrySignature(geometry) : null;
		if (signature !== null && signature === lastSignature) {
			stop();
			return;
		}
		// **轮次只对「布局真的变了」计费**（2026-10-15）：`node_tree_render_end`
		// 在单节点 reRender、分片渲染等**不改内容盒**的局部渲染上同样派发；
		// 无条件计数会让预算被无关渲染吃光、晚到的布局收敛再也补不上
		//（本预算的语义就是「最多跟随几次布局变化」；几何始终不可得的情形
		// 由窗口兜底定时器收尾）
		if (signature !== lastSignature) {
			rounds++;
		}
		lastSignature = signature;
		if (rounds >= CENTER_CORRECTION_MAX_ROUNDS || Date.now() > deadline) {
			stop();
		}
	}
	try {
		events.on?.('node_tree_render_end', onEnd);
		activeCenteringCorrections.set(mindMap, stop);
		// 窗口兜底：窗口内没有渲染落地（或几何始终不可得）时也要停手，不留悬挂监听
		scheduleEngineTimer(mindMap, stop, CENTER_CORRECTION_WINDOW_MS + 50);
	} catch (error) {
		console.warn('登记视口居中补正失败', error);
	}
}

/** 引擎根组（draw）的当前变换；不可得或含非有限值返回 null（调用方回退 DOM 路径） */
function readDrawTransform(mindMap: MindMap): {
	scaleX: number;
	scaleY: number;
	translateX: number;
	translateY: number;
} | null {
	const transform = (
		mindMap as unknown as {
			draw?: {
				transform?: () => {
					scaleX?: unknown;
					scaleY?: unknown;
					translateX?: unknown;
					translateY?: unknown;
				};
			};
		}
	).draw?.transform?.();
	if (!transform) {
		return null;
	}
	const scaleX = Number(transform.scaleX);
	const scaleY = Number(transform.scaleY);
	const translateX = Number(transform.translateX);
	const translateY = Number(transform.translateY);
	if (
		!Number.isFinite(scaleX) ||
		!Number.isFinite(scaleY) ||
		!Number.isFinite(translateX) ||
		!Number.isFinite(translateY)
	) {
		return null;
	}
	return { scaleX, scaleY, translateX, translateY };
}

/**
 * 打开时的默认视口：100% 缩放 + **整体内容居中**（按渲染内容包围盒居中，
 * 不按根节点——根节点居中会让偏心的树偏向一侧）。
 *
 * 语义（含幂等契约、两条测量口径）全在 `centerContentAtScale`，本函数只是
 * `scale = 1` 的具名入口——**视图侧只用它**，勿直接调泛化版（视图的默认视口
 * 恒为 100%，那是产品口径，不是实现细节）。
 */
export function centerContentAtFullScale(mindMap: MindMap | null): void {
	centerContentAtScale(mindMap, 1);
}

/**
 * 按给定比例把**整体内容**居中（`centerContentAtFullScale` 的泛化；供代码块嵌入
 * 的「按宽度适配」复用）。
 *
 * 除比例取值外语义完全一致（含幂等短路的零调用契约、性能模式的数据层几何口径）
 * ——**勿**另写第二份：视图与嵌入的居中判据必须只有一处。
 *
 * 与 `fitMindMap` 的差异：本函数只负责比例与居中，**不做双轴适配**——嵌入的高度
 * 由 `measureContentFitToWidth` 按（比例 × 原高）反算，交本函数对齐即可。
 */
export function centerContentAtScale(
	mindMap: MindMap | null,
	scale: number,
): void {
	if (!mindMap || !(scale > 0)) {
		return;
	}
	try {
		// 先同步引擎几何（SVG 尺寸与缓存矩形），再取**实时容器**做换算：
		// 首帧后容器尺寸/位置可能已变（布局 settle、工具栏重建），沿用
		// 缓存值会把内容按旧画布中心摆放 → 打开即偏移。
		syncCanvasGeometry(mindMap);
		// 一律登记「渲染落地后居中补正」：居中几何可能滞后（尺寸刚变化 / 首帧
		// 未收敛，见 scheduleCenteringCorrection）——先按现有几何走正常流程
		//（即时反馈不变差），渲染落地后补正居中
		scheduleCenteringCorrection(mindMap);
		const size = getCanvasSize(mindMap);
		if (!size) {
			return;
		}
		const transform = readDrawTransform(mindMap);
		const scaleAligned =
			transform !== null &&
			Math.abs(transform.scaleX - scale) < 1e-6 &&
			Math.abs(transform.scaleY - scale) < 1e-6;
		/** 比例未对齐时才 setScale（已对齐时 vendor 也会无条件 emit，属白渲染） */
		const applyScale = (): void => {
			if (!scaleAligned) {
				mindMap.view?.setScale(scale, size.width / 2, size.height / 2);
			}
		};
		// 包围盒口径分两路（性能轮，见 K70）：
		// - 性能模式：**数据层几何并集**（全树、零 DOM）——旧实现先 forceLoadNode
		//   把整树**同步**装配进 DOM 再测 rbox，且打开窗口内被多轮触发（首帧/
		//   重入/兜底/图片回灌），是用户实测「多节点打开卡顿严重」的主因；
		// - 常规模式：DOM 全树在，rbox 精确（含形状描边），行为与旧版一致。
		const dataBox =
			mindMap.opt?.openPerformance && transform !== null
				? measureContentBoxFromData(mindMap)
				: null;
		if (dataBox && transform) {
			// 数据层盒是布局坐标（不含视口变换）：内容中心屏幕位置 =
			// 布局坐标 × scale + translate（引擎 getNodePosInClient 同口径），
			// 平移增量 = 画布中心 - 当前屏幕位置。
			applyScale();
			// 居中复用共享实现：读数在 applyScale 之后现取——setScale 会改变换
			//（scale-in-center 同时移动内容），平移量必须按**改后**的变换算，
			// 否则应用比例那次会少居中一次（同一契约见 fitPerformanceMindMapFromData）
			centerContentByDataBox(mindMap);
			return;
		}
		// 回退：DOM 测量（性能模式下渲染树几何不可得，或常规模式）。
		// rbox 含当前变换（画布内坐标），故本路径与比例无关：先按目标比例
		// setScale，再测「当前变换下的画面盒」，最后把该盒对齐画布中心。
		applyScale();
		const box = measureContentBox(mindMap);
		if (!box) {
			return;
		}
		const dx = (size.width - box.width) / 2 - box.x;
		const dy = (size.height - box.height) / 2 - box.y;
		if (
			Math.abs(dx) < VIEW_CENTER_EPSILON &&
			Math.abs(dy) < VIEW_CENTER_EPSILON
		) {
			// translateXY(0,0) 引擎自身 no-op；显式返回保持「已在目标态零调用」契约
			return;
		}
		mindMap.view?.translateXY(dx, dy);
	} catch (error) {
		// 引擎尚未就绪等边角情况：回退 fit（至少让内容可见）
		console.error('设置默认视口失败', error);
		fitMindMap(mindMap);
	}
}

/**
 * 「按宽度适配」量测（Markdown 代码块嵌入**专用**）：给出容器应有的高度与目标比例。
 *
 * 语义对齐 Obsidian 里 Mermaid 的默认口径（`useMaxWidth` 缺省 true ⇒ SVG
 * `width: 100%` + `max-width: 原宽`）：**只缩不放**（scale ≤ 1），容器高度 =
 * 原高 × scale + 上下留白 ⇒ 内容完整可见且不留空白框（Mermaid 的 mindmap
 * 类型即此口径；Obsidian 只把 flowchart/sequence/git/er 覆盖为绝对尺寸）。
 *
 * ⚠ 与 `fitMindMap` 的差异**必须保留**：vendor fit 是**双轴**适配（宽度与高度
 * 同时塞进画布），而嵌入的高度是由比例**反算**出来的——用双轴适配会自相矛盾
 * （fit 把高度当输入，这里把高度当输出）。
 *
 * @param availableWidth 容器可用宽度（CSS 像素；通常取挂载点的 `clientWidth`）
 * @param padding 四周留白（px）：既进高度，也从可用宽度里扣除
 * @returns `null` = 几何不可得（引擎未就绪 / 渲染树为空），调用方保持现状；
 *          否则给出「挂载点应有的高度 + 与之配套的比例」——不要再回吐输入宽度
 *          （挂载点宽度由 CSS 的 `width: 100%` 决定，回吐属无人消费的第二份真值）
 */
export function measureContentFitToWidth(
	mindMap: MindMap | null,
	availableWidth: number,
	padding = 0,
): { height: number; scale: number } | null {
	if (!mindMap || !(availableWidth > 0)) {
		return null;
	}
	syncCanvasGeometry(mindMap);
	const transform = readDrawTransform(mindMap);
	// **原尺寸**（布局像素）双路：性能模式用数据层并集（零装配），常规模式用
	// DOM rbox 除以当前比例还原（rbox 含当前变换，不还原会把旧缩放当内容尺寸）。
	let natural: { width: number; height: number } | null = null;
	const dataBox = mindMap.opt?.openPerformance
		? measureContentBoxFromData(mindMap)
		: null;
	if (dataBox) {
		natural = { width: dataBox.width, height: dataBox.height };
	} else {
		const box = measureContentBox(mindMap);
		const scaleX = transform?.scaleX ?? 1;
		if (box && scaleX > 0) {
			natural = { width: box.width / scaleX, height: box.height / scaleX };
		}
	}
	if (!natural || !(natural.width > 0) || !(natural.height > 0)) {
		return null;
	}
	const usable = Math.max(1, availableWidth - padding * 2);
	const scale = Math.min(1, usable / natural.width);
	return {
		height: Math.ceil(natural.height * scale + padding * 2),
		scale,
	};
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

/** 渲染树节点的数据层几何面（仅取计算所需字段，缺省时调用方回退 DOM 测量） */
interface DataLayerNode {
	readonly left?: unknown;
	readonly top?: unknown;
	readonly width?: unknown;
	readonly height?: unknown;
	readonly children?: readonly DataLayerNode[];
}

/**
 * 可见性判定用的**画布坐标**内容盒。
 *
 * - 普通模式：`measureContentBox`（rbox / 渲染盒，函数内部已换算到画布坐标）；
 * - **性能模式**：视口外节点被引擎回收 ⇒ rbox 只覆盖已加载子集，判定不可靠，
 *   改用 `measureContentBoxFromData`（全树、零 DOM）——它给的是**布局坐标**，
 *   须按 draw 变换换算到画布坐标（与 `centerContentByDataBox` 同一换算）。
 *   大图（≥500 节点必开性能模式）正是「保存视口落界」这条护栏最需要的场景，
 *   此前直接 `return null`（fail-open）等于**护栏不可达**（2026-10-15 审计）。
 *
 * 任一环不可得返回 null：调用方按「无法判定」处理，不误伤合法视口恢复。
 */
function contentBoxForVisibility(
	mindMap: MindMap,
): { x: number; y: number; width: number; height: number } | null {
	if (!mindMap.opt?.openPerformance) {
		return measureContentBox(mindMap);
	}
	const raw = measureContentBoxFromData(mindMap);
	const transform = readDrawTransform(mindMap);
	if (!raw || !transform) {
		return null;
	}
	return {
		x: raw.x * transform.scaleX + transform.translateX,
		y: raw.y * transform.scaleY + transform.translateY,
		width: raw.width * transform.scaleX,
		height: raw.height * transform.scaleY,
	};
}

/**
 * 内容包围盒（**数据层**：渲染树全树节点的布局几何并集，布局坐标系）。
 *
 * 存在理由（K70，用户实测「多节点打开卡顿严重、加载很久」）：
 * 性能模式下视口外节点被引擎回收出 DOM，`draw.rbox()` 只覆盖可见子集 ⇒
 * 旧实现必须 `forceLoadNode()` 把整树**同步**装配进 DOM 再测量（vendor 的
 * forceLoadNode 是同步递归 render），且打开窗口内被多轮触发（首帧渲染结束、
 * 其自身 emit 重入、150ms 兜底、图片回灌补居中）。而布局阶段已为全树写入
 * `left/top/width/height`（引擎裁剪判定 `checkIsInClient` 同源字段），
 * 直接求并集即可——零 DOM 装配、O(n) 纯计算。
 *
 * 字段语义（vendor 实读）：`get left() { return this.customLeft || this._left }`
 * ——拖拽调整过位置的节点用 customLeft/customTop，渲染与判定同样读它，故一致。
 *
 * @returns 全树几何并集；渲染树不可得或几何全不可用时返回 null（调用方回退）
 */
function measureContentBoxFromData(
	mindMap: MindMap,
): { x: number; y: number; width: number; height: number } | null {
	const root = (
		mindMap as unknown as {
			renderer?: { root?: DataLayerNode | null };
		}
	).renderer?.root;
	if (!root) {
		return null;
	}
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const walk = (node: DataLayerNode): void => {
		const left = Number(node.left);
		const top = Number(node.top);
		const width = Number(node.width);
		const height = Number(node.height);
		if (
			Number.isFinite(left) &&
			Number.isFinite(top) &&
			Number.isFinite(width) &&
			Number.isFinite(height)
		) {
			if (left < minX) minX = left;
			if (top < minY) minY = top;
			if (left + width > maxX) maxX = left + width;
			if (top + height > maxY) maxY = top + height;
		}
		const children = node.children;
		if (children) {
			for (const child of children) {
				walk(child);
			}
		}
	};
	walk(root);
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
		return null;
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
): boolean | null {
	if (!mindMap) {
		return null;
	}
	try {
		const size = getCanvasSize(mindMap);
		const box = contentBoxForVisibility(mindMap);
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
		// 重叠阈值（8px，实现细节不做对外可配置）：内容与画布至少交叠这么多才算「可见」
		const minOverlapPx = 8;
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
 *
 * 锚点取**实时容器中心**（经 syncCanvasGeometry 先同步引擎几何；尺寸刚变化时
 * 渲染被提前启动，但不登记居中补正——本操作只改比例、以画布中心为锚，居中
 * 目标由 fit / 打开视口（centerContentAtScale）的补正承担）：容器变化后
 * （`onResize` 节流窗口内）直接读 `mindMap.width/2` 会用陈旧宽度，把内容按
 * 旧中心定位到屏幕上（实机：性能模式大图表现为明显偏右/偏左，见
 * flushPendingLayoutRender）。
 *
 * 边界（已知且可恢复）：若「容器刚变化、布局尚未落地」时直接点重置缩放
 * （未经过 fit），布局落地会把内容整体平移 (W新−W旧)/2——再点一次「适应画布」
 * 即恢复。fit → resetZoom 的主链路不受影响（fit 的补正在前，reset 随后在
 * 稳定几何上执行）。
 */
export function resetZoom(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		syncCanvasGeometry(mindMap);
		const size = getCanvasSize(mindMap);
		const centerX = (size?.width ?? mindMap.width) / 2;
		const centerY = (size?.height ?? mindMap.height) / 2;
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
 * **批量**反查多个元素所在节点：一次遍历 + 祖先链查表。
 *
 * ## 为什么需要它
 *
 * `findNodeByDom` 每次调用都独立走一遍全树 `walkTree`，在「一批元素」场景下是
 * O(元素数 × 节点数)：① `view.flushMathRemeasure` 逐个 holder 反查；②
 * `findNodesByMathProducts` 逐个数学产物元素反查。二者都是**同一个渲染树**上的
 * 批量查询，逐个全树遍历是纯浪费（公式节点多的大图上是平方级）。
 *
 * ## 为什么祖先链查表等价于 `contains`
 *
 * `Node.contains(el)` 为真 ⟺ `el` 是该节点的 DOM 后代（含自身）。而「后代」必然
 * 在 `el.parentElement` 构成的祖先链上——所以**沿 el 的祖先链逐级查表**与全树
 * `contains` 扫描在结果上等价：命中的是「最近的、已登记为某节点 group 的祖先」
 * （与 `findNodeByDom` 的 `return false` 命中即停语义一致——先命中者在树上更浅，
 * `walkTree` 先序遍历也是先命中更浅者）。
 *
 * ⚠ **等价性的前提**：`el` 与 `group` 处在**同一棵 DOM 树、其间无 shadow boundary
 * 隔断**。跨越 shadow root 时 `parentElement` 链会在边界处断为 `null`，而
 * `contains` 仍可能为真 ⇒ 查表必然落空并走下面的回落分支。本插件不产出 shadow
 * DOM（自绘内容走 `foreignObject`，其 `parentElement` 链正常穿透到节点 group），
 * 故该前提在当前代码面恒成立；此处的说明只是标明**若将来引入 shadow DOM，这条
 * 快路径会退化为回落路径**（结果仍正确，只是失去 O(d) 优势）。
 *
 * ## 复杂度
 *
 * 一次 `walkTree` 建表 O(n)，每个元素 O(祖先链深度 d)。SVG 嵌套层级有限，d 通常
 * < 20 ⇒ 总体 O(n + 元素数 × d)，取代 O(元素数 × n)。
 *
 * ## 正确性兜底
 *
 * 查表未命中的元素**逐个回落** `findNodeByDom`（全树 `contains` 扫）。这处理了
 * 「group 元素在 `walkTree` 之后被引擎换掉」等建表后树变动的情形——宁可慢，不可错。
 *
 * **返回逐位置对应**（`els[i]` 的结果在 `[i]`），不去重、不改变长度：调用方要能
 * 区分「命中」与「未命中」（`view.flushMathRemeasure` 正是据此把落空的 holder
 * 存入待重试集合）。需要去重列表的调用方自行过滤。
 *
 * @param els 待反查元素（允许重复与已脱离 DOM 的元素）
 * @returns 与 `els` 等长的数组，元素为命中节点或 `null`；引擎未就绪返回全 `null`
 */
export function resolveNodesByDoms(
	mindMap: MindMap | null,
	els: readonly Element[],
): (MindMapNode | null)[] {
	if (!mindMap?.renderer || els.length === 0) {
		return els.map(() => null);
	}
	const root = mindMap.renderer.root;
	if (!root) {
		return els.map(() => null);
	}
	// 一次遍历建「group 元素 → 节点」表
	const byGroup = new Map<Element, MindMapNode>();
	walkTree(root, (node) => {
		const group = getNodeGroupEl(node);
		if (group) {
			byGroup.set(group, node);
		}
		return undefined;
	});
	return els.map((el) => {
		// contains 含自身，故从 el 自身起查
		for (let cur: Element | null = el; cur; cur = cur.parentElement) {
			const hit = byGroup.get(cur);
			if (hit) {
				return hit;
			}
		}
		// 未命中 → 回落全树 contains（覆盖建表后树变动的情形）
		return findNodeByDom(mindMap, el);
	});
}

/**
 * 按**自绘内容产物元素**反查所在渲染节点（K100；2026-10-07 起含代码块）。
 *
 * 用途：**自绘内容替换/高亮定稿后** holder 可能已脱离 DOM——引擎在
 * 「定稿 → 批量重排」的等待窗口内又发生了一次全树重渲染（如图片尺寸回灌，见
 * K96），占位 holder 随重建被丢弃，`findNodeByDom(holder)` 因此落空；而**活 DOM
 * 中的产物元素**可据其反查节点。选择器**三通道**：
 * - `.mindmap-node-inline-math`：数学 holder 类（MathJax 替换后保留、与产物输出
 *   形态无关，稳定锚点）；
 * - `.mjx-container`：CHTML 产物容器（兼容兜底；MathJax 走 tex2svg 时无此类）；
 * - `.tmm-code-hl`：代码块高亮 holder 类（K116 审查修复，见下）。
 *
 * ⚠ K104 修正：此前只查 `.mjx-container`——MathJax 走 **tex2svg** 的环境
 * （产物为 `<svg>`、无该容器类）反查 0 命中，回退整体失效（用户实测：首帧
 * 公式节点尺寸不同步 + 告警「未能定位归属节点」；重开时产物缓存命中、构建期
 * 同步放置，故表现为「仅首次失败」）。
 *
 * ⚠ 2026-10-07 审查修复：代码块高亮定稿复用**同一条**尺寸同步流水线，此前本函数
 * 只认数学产物 ⇒ 代码块 holder 落空时兜底捞不到它，而若地图里存在数学节点，
 * `nodes.length > 0` 会让代码块**被静默跳过、不重测也不告警**（内容裁切且无痕，
 * K85 ① 教训）。现补入 `.tmm-code-hl` 通道。
 *
 * 实现：从渲染树**根节点的 group** 上溯到所属 `<svg>`（同一视图内所有节点
 * DOM 的共同祖先，天然限定本视图、不受同页其它导图干扰），一次查询后逐个
 * `findNodeByDom` 归一。只在 holder 解析失败的回退路径调用（按需、一次、
 * 公式/代码块节点通常很少）。
 */
export function findNodesByContentProducts(
	mindMap: MindMap | null,
): MindMapNode[] {
	const root = getRenderRoot(mindMap);
	if (!mindMap || !root) {
		return [];
	}
	const svg = getNodeGroupEl(root)?.closest('svg');
	if (!svg) {
		return [];
	}
	// 选择器**三通道**：`.mindmap-node-inline-math` 是**我方 holder 类**
	//（MathJax 替换后仍保留，与产物输出形态无关）∪ `.mjx-container`（CHTML
	// 产物容器，兼容兜底）∪ `.tmm-code-hl`（**代码块高亮 holder**，2026-10-07 审查
	// 修复：代码块定稿回调复用同一条尺寸同步流水线，此前兜底只认数学 → holder 随
	// 全树重建脱离时**静默跳过该代码块的重测**（foreignObject 仍是按字面量的尺寸
	// ⇒ K114 同类裁切），且因「兜底捞到了别的数学节点」而不触发告警）。
	// ⚠ 此前只匹配 `.mjx-container`：MathJax 走 **tex2svg** 的环境（产物为
	// `<svg>`、无该容器类）反查 0 命中 → 回退整体失效 → 首帧公式节点尺寸
	// 不同步（用户实测：告警「未能定位归属节点」+ 公式区域缺失；重开时产物
	// 缓存命中、构建期同步放置，故正常）。holder 类名不受替换影响，是稳定锚点。
	const products = Array.from(
		svg.querySelectorAll(
			'.mindmap-node-inline-math, .mjx-container, .tmm-code-hl',
		),
	);
	// 批量反查：一次遍历建表 + 逐元素沿祖先链查表，取代逐元素全树
	// walkTree（O(产物数 × 节点数)）。未命中元素由 resolveNodesByDoms 内部回落
	// 全树扫描。去重后返回（同一节点可能同时命中 holder 与其产物容器）。
	const out = new Set<MindMapNode>();
	for (const node of resolveNodesByDoms(mindMap, products)) {
		if (node) {
			out.add(node);
		}
	}
	return [...out];
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

/**
 * 收集当前选中节点的**顶层子树数据**（复制到剪贴板的唯一取值面）。
 *
 * 与引擎自带 `Renderer.copyNode()` 同一套语义（顶层去重、文档序、剥激活态、
 * 剥 uid），但用**已入 d.cts 的节点面**（`parent` / `children` / `nodeData`）
 * 重写实现——引擎把 `getTopAncestorsFomNodeList` / `sortNodeList` /
 * `copyNodeTree` 留在内部工具里、未随包导出，直接读 `isAncestor` / `sortIndex`
 * 这类未声明字段属更高风险的私有触点。**唯一有意差异 = 过滤根节点**
 * （2026-10-15：`copyNode` 不过滤而 `cutNode` 过滤，本插件的粘贴落点是子节点，
 * 照搬 copy 口径会让「复制根节点」变成「把整篇文档嵌成自己的子节点」）。
 * 其余语义与 `copyNode` 逐条一致，且判定只在本文件出现。**取值面必须是 `nodeData`**：
 * 实机（2026-10-15）证实节点「收起**并重渲染后**，引擎会摘空其运行期 `children`」
 * （`nodeData.children` 完整保留）——改读运行期实例即「收起一棵子树＝复制/落盘丢整棵子树」。
 *
 * - **顶层去重**：选中的祖先优先（子树随祖先整棵带走，与引擎一致）；
 * - **文档序**：按渲染树先序遍历排名（非选中顺序，保证粘贴顺序稳定）；
 * - **剥 uid**：引擎 `INSERT_MULTI_CHILD_NODE` 对首次目标**保留**已有 uid
 *   （`createUidForAppointNodes(childList, false)`），同一文档内复制粘贴会
 *   产生重复 uid（按 uid 的删除/查找随即失准）；故深拷贝时逐层删除；
 * - 激活态不在此处剥离：插入时引擎会按 `addDataToAppointNodes` 逐层覆盖
 *   `isActive`（见 vendor/upstream `utils/index.js`）。
 *
 * @returns 深拷贝的子树（无选中节点时为空数组）
 */
export function collectSelectedSubtrees(
	mindMap: MindMap | null,
): MindMapTreeNode[] {
	// **过滤根节点**（与剪切路径同口径，2026-10-15 修复）：引擎 `copyNode`
	// 自身不过滤根（`cutNode` 才过滤，见 vendor `core/render/Render.js` 两方法），
	// 而本插件的粘贴落点是「选中节点 ?? 渲染根」的子节点——只选中根
	//（右键根节点「复制节点」/ Ctrl+A）时若把整棵树写进剪贴板，粘贴即把整篇
	// 文档嵌成自己的子节点，反复操作指数级膨胀。空结果交调用方走既有提示。
	const selected = getActiveNodes(mindMap).filter((node) => !node.isRoot);
	if (selected.length === 0) {
		return [];
	}
	const selectedSet = new Set(selected);
	const tops = selected.filter((node) => {
		let cursor = node.parent;
		while (cursor) {
			if (selectedSet.has(cursor)) {
				return false;
			}
			cursor = cursor.parent;
		}
		return true;
	});
	return rankByDocumentOrder(mindMap, tops).map((node) =>
		cloneSubtreeWithoutUid(node.nodeData),
	);
}

/**
 * 剪切选中节点并取回被剪数据（引擎 `CUT_NODE`：去根/去重/排序/移除/重绘）。
 *
 * ⚠ **空结果不得写剪贴板**：只选中根节点时引擎把根过滤掉、仍以空数组回调
 * （上游 `Render.js` 的 `cutNode`），照写会把用户的剪贴板清空。调用方据此
 * 保持剪贴板原样（见 `features/view-clipboard`）。
 *
 * @returns 被剪的顶层子树（无选中 / 仅根节点时为空数组）
 */
export function cutSelectedSubtrees(mindMap: MindMap | null): MindMapTreeNode[] {
	if (!mindMap) {
		return [];
	}
	let captured: MindMapTreeNode[] = [];
	mindMap.execCommand(ENGINE_COMMANDS.CUT_NODE, (copyData: unknown) => {
		captured = Array.isArray(copyData)
			? (copyData as MindMapTreeNode[])
			: [];
	});
	return captured.map((subtree) => cloneSubtreeWithoutUid(subtree));
}

/**
 * 把子树批量插入为指定父节点的子节点（粘贴的唯一落点实现）。
 *
 * 走引擎 `INSERT_MULTI_CHILD_NODE`（appointNodes = `[parent]`）：引擎自己补
 * uid、逐层展开与激活态覆盖，插件不需要「插入后取回新节点」（引擎没有该
 * 公开途径，见 `features/view-common.insertChildNodeWithData` 的说明）。
 *
 * @returns 是否已提交给引擎（引擎缺失 / 父节点缺失 / 无内容时为 false）
 */
export function insertSubtreesAsChildren(
	mindMap: MindMap | null,
	parent: MindMapNode | null,
	subtrees: readonly MindMapTreeNode[],
): boolean {
	if (!mindMap || !parent || subtrees.length === 0) {
		return false;
	}
	mindMap.execCommand(
		ENGINE_COMMANDS.INSERT_MULTI_CHILD_NODE,
		[parent],
		subtrees,
	);
	return true;
}

/** 节点在渲染树中的先序排名（未在树上者排在最后）；显式栈，超深树不栈溢出 */
function rankByDocumentOrder(
	mindMap: MindMap | null,
	nodes: readonly MindMapNode[],
): MindMapNode[] {
	const rank = new Map<MindMapNode, number>();
	const root = mindMap?.renderer.root;
	if (root) {
		const stack: MindMapNode[] = [root];
		let index = 0;
		while (stack.length > 0) {
			const node = stack.pop()!;
			rank.set(node, index++);
			const children = node.children ?? [];
			for (let i = children.length - 1; i >= 0; i--) {
				const child = children[i];
				if (child) {
					stack.push(child);
				}
			}
		}
	}
	const last = Number.MAX_SAFE_INTEGER;
	return [...nodes].sort(
		(a, b) => (rank.get(a) ?? last) - (rank.get(b) ?? last),
	);
}

/**
 * 深拷贝子树数据并逐层删除 `uid`（见 collectSelectedSubtrees 的剥 uid 说明）。
 * JSON 往返而非结构化克隆：节点 data 只含可序列化字段（引擎自身也按 JSON
 * 序列化保存），且这是历史剪贴板路径的既有口径。
 */
function cloneSubtreeWithoutUid(source: MindMapTreeNode): MindMapTreeNode {
	const cloneData = (
		data: MindMapNodeData | undefined,
	): MindMapNodeData => {
		const cloned = JSON.parse(
			JSON.stringify(data ?? {}),
		) as MindMapNodeData;
		delete cloned.uid;
		return cloned;
	};
		const root: MindMapTreeNode = {
		data: cloneData(source.data),
		children: [],
	};
	copyExtraNodeDataFields(source, root);
	const stack: { src: readonly MindMapTreeNode[]; dst: MindMapTreeNode[] }[] =
		[{ src: source.children ?? [], dst: root.children }];
	while (stack.length > 0) {
		const { src, dst } = stack.pop()!;
		for (const child of src) {
			const cloned: MindMapTreeNode = {
				data: cloneData(child.data),
				children: [],
			};
			copyExtraNodeDataFields(child, cloned);
			dst.push(cloned);
			stack.push({ src: child.children ?? [], dst: cloned.children });
		}
	}
	return root;
}

/**
 * 顶层字段拷贝：`data` / `children` 之外的**非 `_` 前缀**键一并带出
 * （2026-10-15 与 vendor 对齐）。
 *
 * 口径来源：`vendor/upstream/src/utils/index.js` 的 `copyNodeTree` 末尾会把
 * `nodeData` 上除 `data` / `children` / `_` 前缀以外的字段**浅拷**进结果。此前
 * 我们只拷 `data` + `children` ⇒ 引擎或插件将来在 `nodeData` 顶层加字段时，
 * 复制 / 粘贴会**静默丢字段**（当前 `d.cts` 只声明这两个字段，故无实害——纯契约
 * 对齐；浅拷同样照 vendor）。
 */
function copyExtraNodeDataFields(
	source: MindMapTreeNode,
	target: MindMapTreeNode,
): void {
	const src = source as unknown as Record<string, unknown>;
	const dst = target as unknown as Record<string, unknown>;
	for (const key of Object.keys(src)) {
		if (key === 'data' || key === 'children' || key.startsWith('_')) {
			continue;
		}
		dst[key] = src[key];
	}
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
	// 归一语义的唯一实现在 core/node-data（本入口只做「按节点取 data」这一步）
	return readNodeDataString(
		node.getData?.() as Record<string, unknown> | null | undefined,
		key,
	);
}

/**
 * 以临时导出倍率执行导出任务：进入时写入 minExportImgCanvasScale，
 * 任务结束（无论成败）恢复原值；原值不存在时删除该键，避免残留到
 * 后续渲染。引擎销毁等边角情况下恢复失败**留痕告警**（残留会让后续导出
 * 沿用错误倍率，静默即无痕退化）。
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
		} catch (error) {
			// 引擎已销毁等边角情况：**仍要留痕**——恢复失败会让临时倍率残留，
			// 此后导出沿用错误倍率（静默吞掉＝无痕退化，与同文件其它分支口径不一）
			console.warn('恢复导出倍率失败', error);
		}
	}
}

/**
 * 导出图片（DoExport 插件不可用时返回 null）。错误向调用方
 * 传播（由 UI 层弹用户可见提示）。
 * doExport/exporter 为引擎插件内部形态，访问收口在本函数。
 *
 * - `png`：位图光栅化，受导出倍率（minExportImgCanvasScale）影响；
 * - `svg`：矢量直出，与倍率无关（不临时切换 minExportImgCanvasScale）。
 * 两者都走同一条 `handleBeingExportSvg` 导出后处理链（CSS 变量 / MathJax
 * 字形注入等），由 vendor 的 export 插件在 getSvgData 时应用。
 */
export async function exportMindMapImage(
	mindMap: MindMap,
	format: ExportImageFormat,
	scale: number,
	fileName: string,
): Promise<Blob | string | null> {
	const exporter = mindMap.doExport;
	if (!exporter?.export) {
		return null;
	}
	if (format === 'svg') {
		return exporter.export('svg', false, fileName);
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
	// 单节点＝批量入口的一个元素：`reRender` **缺失时的告警**（K88 教训）与
	// 「N 个节点只 render 一次」的收敛都在 refreshNodesCustomContent 里——此前
	// 本入口自写一份 `reRender?.()`（可选链静默 no-op），那道防线只守住了一半
	refreshNodesCustomContent(mindMap, node ? [node] : []);
}

/**
 * 「传入对象不可重排」告警留痕（同一根因整会话只提示一次）。
 * 去重与前缀由 `core/errors.createWarnOnce` 统一实现（2026-10-11 收口）。
 */
const warnMissingReRender = createWarnOnce();

/**
 * 节点是否**尺寸塌陷**（布局层宽或高为 0）——自绘内容「可见性自愈」的判据。
 *
 * 为什么需要它（2026-10-14 实机复现）：自绘内容的量测容器挂在 `mindMap.el`
 * 内部，叶子不可见（后台标签 / 启动恢复，`display:none`）时任何量测恒为
 * 0×0；这类 0 一旦落到节点上，切回前台**没有任何路径**会重测（`resize()` 只按
 * 现有尺寸重排），表现为公式节点连线收束成一点。自愈需要一个「症状」判据，
 * 本函数即该判据的唯一实现（`width`/`height` 是引擎节点实例字段，未入 d.cts，
 * 故按防腐口径收口在本文件）。
 */
export function isNodeCollapsed(node: MindMapNode): boolean {
	const sized = node as unknown as { width?: unknown; height?: unknown };
	const width = typeof sized.width === 'number' ? sized.width : 0;
	const height = typeof sized.height === 'number' ? sized.height : 0;
	return !(width > 0) || !(height > 0);
}

/**
 * **批量**重建多个节点的自绘内容（同 `refreshNodeCustomContent` 语义）。
 *
 * 用于「数学异步替换定稿后同步节点尺寸」（P4）：含数学的节点可能
 * 在同一帧内成批定稿（一次打开多个公式），若逐个走 `refreshNodeCustomContent`
 * 会各触发一次**全树** `render()`。此处逐节点 `reRender(['custom'])`、
 * **最后一次** `render()`——N 个节点 1 次重排。
 *
 * 收敛性：重建会重新调用 `customCreateNodeContent` → `buildMathElement`；
 * 因 `platform/math-jax` 的产物缓存已命中（定稿即入缓存），重建路径是**同步**
 * 放置产物、**不再触发异步替换**，故不会再回调重排（无循环）。
 *
 * ⚠ `reRender` 缺失时**显式告警**（K85 ① 教训：静默跳过会让功能以无痕方式
 * 退化）。历史事故（K88）：调用方曾传入**预测量轻量代理对象**（只有
 * `nodeData`/`getData`，无 `reRender`）——可选链静默 no-op，数学定稿后尺寸
 * 永不同步（实机 512/655 永不修复）。调用方应先解析为真实 `MindMapNode`
 * （如视图层用 `findNodeByDom`）。
 */
export function refreshNodesCustomContent(
	mindMap: MindMap | null,
	nodes: readonly MindMapNode[],
): void {
	if (!mindMap || nodes.length === 0) {
		return;
	}
	for (const node of nodes) {
		try {
			const target = node as unknown as {
				reRender?: (
					keys: string[],
					params: { ignoreUpdateCustomTextWidth: boolean },
				) => void;
			};
			if (typeof target.reRender !== 'function') {
				warnMissingReRender(
					'节点不支持自绘重排（reRender 缺失），跳过尺寸同步',
				);
				continue;
			}
			target.reRender(['custom'], { ignoreUpdateCustomTextWidth: true });
		} catch (error) {
			console.error('重建节点自绘内容失败', error);
		}
	}
	mindMap.render();
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
 * 帧内**预览**节点图片尺寸：直写渲染中 `<image>` 的 `width/height`。
 *
 * 为什么不下沉到引擎数据（2026-10-02 重构）：旧实现是「改 `data.imageSize` +
 * `mindMap.render()`」——每次写入都是**整树**重排，rAF 合帧只能把频率压到
 * 「每帧一次」，大图拖动仍持续卡顿。改直写与引擎渲染**同源**的 SVG 属性
 * （vendor `nodeCreateContents`：`new SVGImage().size(...imgSize)`，用户单位 =
 * content px）后：① 不动数据、不进历史、不派发 `data_change`；② 不触发整树
 * 重排（只重绘图片本身）；③ 节点外框与兄弟布局延后到收尾的那一次
 * `setNodeImageSize`（一条历史、一次布局落地）。
 *
 * 直写值会被任何一次引擎 render 覆盖回数据值——帧内不修改数据（数据在收尾
 * 才写），不存在「渲染拉回旧尺寸」的竞态；节点不在 DOM（性能模式视口外）
 * 或图片元素缺失时静默跳过，由收尾提交兜底。
 *
 * @param node 引擎节点：直写目标为自绘 `node_img` 组内的 `<image>`（不经
 *             引擎实例——本函数只碰 DOM，不写数据、不渲染）。
 */
export function previewNodeImageSize(
	node: MindMapNode,
	width: number,
	height: number,
): void {
	try {
		const group = getNodeGroupEl(node);
		const imageEl = group?.querySelector('image');
		if (!(imageEl instanceof SVGImageElement)) {
			return;
		}
		imageEl.setAttribute('width', String(width));
		imageEl.setAttribute('height', String(height));
	} catch (error) {
		console.error('预览节点图片尺寸失败', error);
	}
}

/**
 * 图片尺寸校正条目（**结构类型**）：产出方是 `media/images-path`
 * （`ImageSizeCorrection`），此处按同形声明以免 engine → media 反向依赖。
 */
export interface ImageSizeCorrectionEntry {
	/**
	 * 树节点 data 对象**引用**。注意：**引擎节点持有的是包装/拷贝数据，与树 data
	 * 非同一对象**（2026-09-28 真实引擎实测 `identitySame=false`）——身份通道只在
	 * 引擎直接持有树 data 的场景命中；真实路径靠 `uid` 回退通道（见下）。
	 */
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
 * 匹配**双通道**（两条都要过 `image` 字段比对：用户已换图则丢弃）：
 * ① **对象身份**（`node.getData() === correction.data`）——引擎直接持有树 data 时命中；
 * ② **uid 回退**（`data.uid === correction.data.uid`，非空才用）——引擎对节点数据
 *    做包装/拷贝时命中。**真实路径实测走这条**（2026-09-28：`identitySame=false`，
 *    此前只有身份通道，校正因此从未生效——图片全停在默认尺寸）。
 *
 * uid 在**回灌时**必然已分配：`ensureUniqueUids` 在引擎创建前同步跑完（此前
 * 「uid 尚未分配」只约束**探测期间**的写回定位，不约束回灌）；引擎重建（设置
 * 刷新/换文件）后 uid 匹配落空 ⇒ 陈旧条目静默丢弃，不会把尺寸盖到别的节点上。
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
	const byUid = new Map<string, ImageSizeCorrectionEntry>();
	for (const correction of corrections) {
		byData.set(correction.data, correction);
		const uid = correction.data.uid;
		if (typeof uid === 'string' && uid) {
			byUid.set(uid, correction);
		}
	}
	let applied = 0;
	walkTree(root, (node) => {
		const data = node.getData() as Record<string, unknown> | undefined;
		if (!data) {
			return;
		}
		// 双通道：对象身份优先（引擎直接持树 data），uid 回退（引擎拷贝包装）
		let correction = byData.get(data);
		if (!correction) {
			const uid = data.uid;
			correction = typeof uid === 'string' && uid ? byUid.get(uid) : undefined;
		}
		if (!correction) {
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

/**
 * 视口状态：`view.getTransformData()` 的原始输出（`{ transform, state }`）。
 *
 * **不解释结构**——形状由引擎定义（`state` 是持久化的 `{scale,x,y}`、
 * `transform` 是实时画布变换）。需要具体数值时用 `getDrawTransform`
 * （transform 四分量）或 `getViewportSignature`（state 三分量）。
 */
export type ViewportState = unknown;

/** 读当前视口状态（持久化用）；引擎不可得/读取异常返回 null（已留痕） */
export function readViewportState(mindMap: MindMap | null): ViewportState {
	try {
		return mindMap?.view.getTransformData() ?? null;
	} catch (error) {
		console.warn('读取视口状态失败', error);
		return null;
	}
}

/**
 * 应用保存的视口状态（`setTransformData`）。**不吞异常**：引擎对畸形 state 会抛
 * （`Object.keys(undefined)`，见 vendor View.setTransformData），调用方按
 * 「恢复失败」回退 fit——那条 catch 是既有契约（restoreOrFitViewport）。
 */
export function applyViewportState(
	mindMap: MindMap | null,
	state: ViewportState,
): void {
	if (!mindMap?.view || !state) {
		return;
	}
	mindMap.view.setTransformData(state);
}

/**
 * 视口签名（`scale|x|y`）：**当前视口**的唯一读取面（引擎内部形态收口于此）。
 *
 * 数据源是 `view.getTransformData().state`——与 `readViewportState` 写进
 * data.json 的那份**同源**（幂等短路必须比同一坐标系下的量）；形态异常/读取
 * 失败返回 null，调用方按「无法判定」处理（宁可多渲染一轮，不做错误跳过）。
 *
 * 与 `getDrawTransform` 的关系：后者读 `transform`（实时画布变换，用于坐标
 * 换算），本函数读 `state`（用于「是否已在目标视口」）——**两处不合并**，
 * 合并等于更换幂等判定的比较基准。
 */
export function getViewportSignature(mindMap: MindMap | null): string | null {
	const state = (
		readViewportState(mindMap) as { state?: unknown } | null
	)?.state;
	return viewStateSignature(state);
}

/**
 * 视口状态 → 签名（非对象 / 非有限值 → null）。持久化值（data.json 里的
 * `savedView.state`）与实时值共用本口径——此前该比较实现在 engine-controller
 * 内（`transformSignatureOf`），现由引擎层承担。
 */
export function viewStateSignature(state: unknown): string | null {
	if (!state || typeof state !== 'object') {
		return null;
	}
	const s = state as { scale?: unknown; x?: unknown; y?: unknown };
	const scale = Number(s.scale);
	const x = Number(s.x);
	const y = Number(s.y);
	if (!Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) {
		return null;
	}
	return `${scale}|${x}|${y}`;
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

/** 兄弟间上/下移的结果：`'moved'` 之外均为引擎会静默 no-op 的拒绝分支 */
export type SiblingMoveOutcome =
	| 'moved'
	| 'root'
	| 'atTop'
	| 'atBottom'
	| 'detached';

/**
 * 兄弟间上/下移的唯一实现（右键菜单「上移节点 / 下移节点」，2026-10-14）：
 * 与相邻兄弟交换顺序，并**清除参与交换两节点的自由拖拽坐标**。
 *
 * 为什么必须清坐标：节点有效位置由 getter `customLeft || _left` 给出——自定义
 * 坐标是「绝对位置」，会凌驾于兄弟顺序之上；只交换 children 顺序而不清它，
 * 画面位置不跟随（上游 `UP_NODE` / `Ctrl+Up` 同款行为，也是「点了没反应」的
 * 根源）。清法对齐上游 `RESET_LAYOUT` 的单节点处理；`SET_NODE_DATA` 只写数据
 * 不渲染，画面由紧随的交换命令内含的 render 收尾。
 *
 * `UP_NODE` / `DOWN_NODE` 只作用于**第一个激活节点**，故显式传 `node`（画布
 * 委托路径可能处于多选态，激活列表顺序不可依赖）。引擎对根节点/首尾一律静默
 * no-op——拒绝原因经返回值交给调用方，用户可见提示归视图层（本文件不产文案）。
 */
export function moveNodeInSiblings(
	mindMap: MindMap,
	node: MindMapNode,
	offset: -1 | 1,
): SiblingMoveOutcome {
	if (node.isRoot) {
		return 'root';
	}
	const siblings = node.parent?.children;
	if (!Array.isArray(siblings)) {
		return 'detached';
	}
	const index = siblings.indexOf(node);
	if (index === -1) {
		return 'detached';
	}
	if (offset < 0 ? index === 0 : index === siblings.length - 1) {
		return offset < 0 ? 'atTop' : 'atBottom';
	}
	// 被移动节点与交换对象都清掉自定义坐标：二者回到布局位置后，交换后的顺序
	// 才如实落在画面上（只清一个会让另一个仍停在手动摆放的绝对位置）
	const swap = siblings[offset < 0 ? index - 1 : index + 1];
	if (swap) {
		clearNodeCustomPosition(mindMap, swap);
	}
	clearNodeCustomPosition(mindMap, node);
	mindMap.execCommand(
		offset < 0 ? ENGINE_COMMANDS.UP_NODE : ENGINE_COMMANDS.DOWN_NODE,
		node,
	);
	return 'moved';
}

/**
 * 清除单个节点的自由拖拽坐标（`customLeft` / `customTop`）：实例字段与节点数据
 * 二者都置 `undefined`——坐标 getter 为 `customLeft || _left`，只清一处可能残留
 * （对齐上游 `RESET_LAYOUT` 的单节点处理）。只写数据、不触发 render。
 */
function clearNodeCustomPosition(mindMap: MindMap, node: MindMapNode): void {
	const inst = node as unknown as { customLeft?: number; customTop?: number };
	inst.customLeft = undefined;
	inst.customTop = undefined;
	mindMap.execCommand(ENGINE_COMMANDS.SET_NODE_DATA, node, {
		customLeft: undefined,
		customTop: undefined,
	});
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
