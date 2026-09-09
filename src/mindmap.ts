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
} from '../vendor/simple-mind-map.cjs';
import { getThemeConfig, isDarkTheme, getDocIconColor } from './mindmap-theme';
import { t, type Language } from './i18n';
import { walkTree } from './domain/tree';
import { RESET_LAYOUT_VIEWPORT_DELAY_MS } from './constants';

export { getThemeConfig, isDarkTheme } from './mindmap-theme';

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
	themePref: string;
	isDark: boolean;
	enableDrag: boolean;
	performanceMode: boolean;
	performanceThreshold: number;
	lang: Language;
	onHyperlinkJump?: ((link: string, node: MindMapNode) => void) | null;
}

/**
 * 大图内存控制阈值：引擎命令历史默认保留 500 条「整树 JSON 快照」，
 * 大图（数千节点含图）单条可达数百 KB，多开视图内存线性放大；
 * 超过该节点数时把历史上限压到 HISTORY_LIMIT_MAX_COUNT（撤销深度仍充裕）。
 */
const HISTORY_LIMIT_NODE_COUNT = 2000;
const HISTORY_LIMIT_MAX_COUNT = 100;

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

const WIKI_DOC_ICON_SIZE = 18;
/** 图标 viewBox 边长（路径按 24 网格绘制，缩放到 WIKI_DOC_ICON_SIZE 显示） */
const WIKI_DOC_ICON_VIEWBOX = 24;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 文档页图标（折角页 + 页脚线，feather file-text 风格） */
const WIKI_DOC_ICON_PATH =
	'M6 2h8l5 5v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm8 0v5h5M9 13h6M9 17h6';

/** 构造文档页图标（`<svg>` 根元素，见上方契约说明） */
function buildWikiDocIcon(
	link: string,
	title: string,
	color: string,
	onOpen: (link: string) => void,
): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('xmlns', SVG_NS);
	svg.setAttribute('width', String(WIKI_DOC_ICON_SIZE));
	svg.setAttribute('height', String(WIKI_DOC_ICON_SIZE));
	svg.setAttribute(
		'viewBox',
		`0 0 ${WIKI_DOC_ICON_VIEWBOX} ${WIKI_DOC_ICON_VIEWBOX}`,
	);
	svg.classList.add('mindmap-wiki-doc-icon');
	const path = document.createElementNS(SVG_NS, 'path');
	path.setAttribute('d', WIKI_DOC_ICON_PATH);
	path.setAttribute('fill', 'none');
	path.setAttribute('stroke', color);
	path.setAttribute('stroke-width', '2');
	path.setAttribute('stroke-linecap', 'round');
	path.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(path);
	// 透明命中区：扩大可点范围至整个图标方块（细线难点中）
	const hit = document.createElementNS(SVG_NS, 'rect');
	hit.setAttribute('width', String(WIKI_DOC_ICON_VIEWBOX));
	hit.setAttribute('height', String(WIKI_DOC_ICON_VIEWBOX));
	hit.setAttribute('fill', 'transparent');
	svg.appendChild(hit);
	const tip = document.createElementNS(SVG_NS, 'title');
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
	const nodeCount = countTreeNodes(data);
	const performanceEnabled =
		options.performanceMode && nodeCount >= options.performanceThreshold;

	const mindMap = new MindMap(
		Object.assign(
			{
				el,
				data,
				layout: options.layout,
				theme: 'default',
				themeConfig: getThemeConfig(dark),
				// 不在创建时 fit 全图：打开后的默认视口由 centerRootAtFullScale
				// 统一设置（100% + 根节点居中），大图不再被压到看不清文字
				fit: false,
				defaultInsertSecondLevelNodeText: t(options.lang, 'default.secondLevel'),
				defaultInsertBelowSecondLevelNodeText: t(
					options.lang,
					'default.belowSecondLevel',
				),
				openPerformance: performanceEnabled,
				performanceConfig: {
					time: 200,
					padding: 150,
					removeNodeWhenOutCanvas: true,
				},
				enableFreeDrag: options.enableDrag,
				customHyperlinkJump: options.onHyperlinkJump ?? null,
			} satisfies MindMapOptions,
			{
				// 双链文档图标（契约与防腐说明见上方常量区注释）；
				// 字段未入 d.cts，经 Object.assign 注入避免类型断言
				createNodePrefixContent: (node: MindMapNode) => {
					const nodeData = node.getData() as {
						mdWikiLinkpath?: unknown;
						mdLinkText?: unknown;
					} | null;
					const wikiLink =
						typeof nodeData?.mdWikiLinkpath === 'string'
							? nodeData.mdWikiLinkpath
							: '';
					if (!wikiLink) {
						return null;
					}
					const title =
						typeof nodeData?.mdLinkText === 'string' ? nodeData.mdLinkText : '';
					return {
						el: buildWikiDocIcon(
							wikiLink,
							title,
							getDocIconColor(dark),
							(link) => options.onHyperlinkJump?.(link, node),
						),
						width: WIKI_DOC_ICON_SIZE,
						height: WIKI_DOC_ICON_SIZE,
					};
				},
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
	// 大图内存控制：节点数超过阈值时调低命令历史上限（引擎默认 500 条
	// 整树 JSON 快照，大图每条可达数百 KB）。opt 是活引用，立即生效。
	if (nodeCount >= HISTORY_LIMIT_NODE_COUNT) {
		mindMap.updateConfig({ maxHistoryCount: HISTORY_LIMIT_MAX_COUNT });
	}
	return mindMap;
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
		if (mindMap.opt?.openPerformance) {
			mindMap.renderer.forceLoadNode?.();
		}
		mindMap.view?.fit();
	} catch (error) {
		console.error('适应画布失败', error);
	}
}

/**
 * 打开时的默认视口：100% 缩放 + 根（中心）节点居中。
 *
 * 取代「fit 全图」——节点很多时 fit 会把比例压到文字不可读。顺序上先
 * `setScale(1)` 再居中：moveNodeToCenter 用当前 transform 计算偏移，
 * 若先居中后改比例，偏移会失配。
 */
export function centerRootAtFullScale(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		mindMap.view?.setScale(1);
		const root = mindMap.renderer?.root;
		if (root) {
			mindMap.renderer.moveNodeToCenter(root);
		}
	} catch (error) {
		// 引擎尚未就绪等边角情况：回退 fit（至少让内容可见）
		console.error('设置默认视口失败', error);
		fitMindMap(mindMap);
	}
}

/**
 * 重置缩放：回到 100%，**不改变当前平移**（屏幕位置保持原样）。
 * 与 `centerRootAtFullScale` 区分：后者用于「打开时的默认视口」与自动整理
 * 之后的定位；本函数只改比例，不动视口位置。
 */
export function resetZoom(mindMap: MindMap | null): void {
	if (!mindMap) {
		return;
	}
	try {
		mindMap.view?.setScale(1);
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
 * 最后重置视口（100% 缩放 + 根节点居中；不再 fit 全图——大图会被压到不可读）。
 *
 * 注意：使用引擎内置的「重置布局」（RESET_LAYOUT 命令）而非全量 setData。
 * 旧实现 getData()+delete+setData 会经 handleData / renderer.setData 重新初始化
 * 布局，可能重排 children 从而打乱用户手动排好的节点顺序；
 * resetLayout 只逐个节点清除 customLeft/customTop 后重渲染，不触碰 children 顺序，
 * 因此不会打乱手动排好的顺序。
 */
export function arrangeMindMap(mindMap: MindMap | null): boolean {
	if (!mindMap) {
		return false;
	}
	try {
		if (typeof mindMap.execCommand !== 'function') {
			return false;
		}
		mindMap.execCommand(ENGINE_COMMANDS.RESET_LAYOUT);
		window.setTimeout(
			() => resetZoom(mindMap),
			RESET_LAYOUT_VIEWPORT_DELAY_MS,
		);
		return true;
	} catch (error) {
		console.error('自动整理失败', error);
		return false;
	}
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
export async function runWithExportScale<T>(
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
 * 标记节点需要重建内容：引擎只在节点内部 `needLayout` 为真时重建该节点
 * （前缀图标 / 文本等），仅改 data 不会刷新。影响渲染的数据变更后调用。
 */
export function markNodeNeedLayout(node: MindMapNode): void {
	(node as unknown as { needLayout?: boolean }).needLayout = true;
}

/**
 * 设置节点图片的自定义展示尺寸（content px，custom:true 引擎按值渲染）。
 * 经 SET_NODE_DATA 合并写入；该命令只合并数据不触发重绘（与 SET_NODE_TEXT
 * 同款语义），末尾须显式 render——否则拖拽调宽期间数据在变、画面不动。
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
	window.setTimeout(() => {
		mindMap.emit('node_dblclick', node, null, false);
		// 菜单关闭后浏览器可能把焦点还给画布：补一次焦点，保证可直接输入
		focusNodeTextEdit(mindMap);
	}, 0);
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
