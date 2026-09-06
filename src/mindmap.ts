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
import { getThemeConfig, isDarkTheme } from './mindmap-theme';
import { t, type Language } from './i18n';
import { walkTree } from './domain/tree';

export { getCodeBlockThemeConfig, getThemeConfig, isDarkTheme } from './mindmap-theme';

export interface CreateMindMapOptions {
	layout: string;
	themePref: string;
	isDark: boolean;
	enableDrag: boolean;
	performanceMode: boolean;
	performanceThreshold: number;
	lang: Language;
	/**
	 * 代码块渲染：无导出/搜索 UI，不注册 DoExport/Search 插件，
	 * 减少每代码块的实例化与监听成本（交互能力不受影响）。
	 */
	forCodeBlock?: boolean;
	onHyperlinkJump?: ((link: string, node: MindMapNode) => void) | null;
}

/**
 * 大图内存控制阈值：引擎命令历史默认保留 500 条「整树 JSON 快照」，
 * 大图（数千节点含图）单条可达数百 KB，多开视图内存线性放大；
 * 超过该节点数时把历史上限压到 HISTORY_LIMIT_MAX_COUNT（撤销深度仍充裕）。
 */
const HISTORY_LIMIT_NODE_COUNT = 2000;
const HISTORY_LIMIT_MAX_COUNT = 100;

/**
 * 创建思维导图实例并注册引擎插件。
 * 视图场景：选择、触控、关联线、键盘导航、导出、搜索全部启用；
 * 代码块场景（forCodeBlock）不注册导出/搜索插件，减少每代码块成本；
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

	const mindMap = new MindMap({
		el,
		data,
		layout: options.layout,
		theme: 'default',
		themeConfig: getThemeConfig(dark),
		fit: true,
		defaultInsertSecondLevelNodeText: t(options.lang, 'default.secondLevel'),
		defaultInsertBelowSecondLevelNodeText: t(options.lang, 'default.belowSecondLevel'),
		openPerformance: performanceEnabled,
		performanceConfig: {
			time: 200,
			padding: 150,
			removeNodeWhenOutCanvas: true,
		},
		enableFreeDrag: options.enableDrag,
		customHyperlinkJump: options.onHyperlinkJump ?? null,
	} satisfies MindMapOptions);

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
	// 代码块（只读展示）不需要导出/搜索插件：去掉它们省掉每代码块的
	// 实例化与监听注册成本（vendor 为预打包单文件，不影响 bundle 体积）。
	if (!options.forCodeBlock) {
		mindMap.addPlugin(DoExport);
		mindMap.addPlugin(Search);
	}
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

/** 根据 DOM 元素查找对应节点（通过 data-uid） */
export function findNodeByDom(
	mindMap: MindMap | null,
	el: HTMLElement,
): MindMapNode | null {
	if (!mindMap?.renderer) {
		return null;
	}
	const uid =
		el.getAttribute('data-uid') ??
		el.querySelector('[data-uid]')?.getAttribute('data-uid');
	if (!uid) {
		return null;
	}
	let result: MindMapNode | null = null;
	const root = mindMap.renderer.root;
	if (root) {
		walkTree(root, (node) => {
			if (node.uid === uid || node.getData('uid') === uid) {
				result = node;
				return false; // 命中即终止整树遍历
			}
			return undefined;
		});
	}
	return result;
}

/**
 * 自动整理：清除所有节点被自由拖拽后的自定义位置，
 * 重新按当前布局算法计算位置，使各主题以合理间距对齐摆放，
 * 最后将画布适配到窗口。
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
		mindMap.execCommand('RESET_LAYOUT');
		window.setTimeout(() => fitMindMap(mindMap), 80);
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

/** 更新节点文本：先改节点数据，再经引擎命令同步并重绘 */
export function setNodeText(
	mindMap: MindMap,
	node: MindMapNode,
	text: string,
): void {
	node.nodeData.data.text = text;
	try {
		mindMap.execCommand('SET_NODE_DATA', node, { text });
	} catch {
		// SET_NODE_DATA 不可用等情形：直接数据已改，交由重绘
	}
	mindMap.render();
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
