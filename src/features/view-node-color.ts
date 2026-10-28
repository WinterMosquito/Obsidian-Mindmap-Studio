/**
 * 节点级配色：右键「配色」→ 某个颜色 → 把 `%%#hex%%` 写进该节点的 Markdown 行。
 *
 * ## 为什么走「原文提交」而不是直接改样式
 * 颜色只存在于正文，插件侧样式是派生结果（`engine/mindmap-colors`）。所以改色 =
 * **改那一行原文**，交给既有编辑通道 `applyRawNodeContent`：重解析 → 样式同步 →
 * 保存调度 → 提交通知（K108）全部复用，不另开写盘/渲染管线。
 *
 * ## 三条口径
 * - **多选只写最上层**：颜色沿子树继承，给被包含的子孙各写一条只会堆重复注释；
 * - **重复改色是替换**：`setColorDirective` 复用解析侧的保护区语义；
 * - **「默认」= 回到整篇配色**（2026-10-27 用户裁决）：不再看祖先的节点色。落地
 *   有两种、效果等价——上层还在染色就写哨兵 `%%none%%` 挡住继承，否则直接删指令
 *   （不给文件添注释）。**不能一律删指令**：那正是旧语义的坑（删完照旧继承父色）。
 *
 * 落点：无指令时追加到末行行尾；末行是块级语法行（围栏定界符 / 表格行）时另起
 * 一行——缘由见 `node-inline-tokenize.appendColorDirective`。
 */
import { paletteNodeColor, topMostNodes } from '../engine/mindmap';
import type { PaletteId } from '../core/constants';
import { PALETTE_OPTIONS } from '../core/constants';
import type { TranslationKey } from '../core/i18n';
import type { MindMapNode } from '../core/engine-types';
import type { MdNodeData } from '../core/node-data';
import { COLOR_DIRECTIVE_NONE, inheritedColorOf } from '../domain/color';
import { nodeInlineSource } from '../domain/md-meta';
import { composeNodeContent } from '../markdown/md-serialize';
import { applyRawNodeContent } from './node-inline-editor';
import { colorDirectiveOf, setColorDirective } from './node-inline-tokenize';
import { refreshMiniMapAfterRender } from './view-minimap';
import type { MindMapViewContext } from './view-context';

/** 菜单里的一个「颜色」选项：调色板的 id + 它对应的单色 + 文案键 */
export interface NodeColorOption {
	value: PaletteId;
	label: TranslationKey;
	/** 写进 Markdown 的十六进制（各套配色的根节点主色，亮色档） */
	color: string;
}

/**
 * 节点配色菜单的选项表（顺序＝菜单顺序）。
 *
 * 颜色值取 `paletteNodeColor`（`PALETTES[id].light.rootFill`）——**单色**，
 * 因为节点只能记一个 hex；节点颜色不随明暗切换（写进文件的就是用户选的色相）。
 *
 * **不含「默认」配色**（即那枚蓝）：首项「默认」已经表达「跟随整篇」，
 * 再列一枚蓝色会让节点菜单比空白右键的整篇菜单多一项（2026-10-27 用户裁决
 * 「两处样式一致」）。存量文件里若已写着 `%%#4a90d9%%`，它按**自定义色**显示
 * （勾在「自定义」项上），语义正确。
 *
 * **惰性构建**（首次建菜单时才算）：模块导入期不触碰引擎模块——大量测试把
 * `engine/mindmap` 整体桩掉，导入期取色会让「只想加载视图」的用例连模块都起不来。
 */
let cachedOptions: readonly NodeColorOption[] | null = null;

export function nodeColorOptions(): readonly NodeColorOption[] {
	cachedOptions ??= PALETTE_OPTIONS.filter(
		(option) => option.value !== 'default',
	).map((option) => ({
		value: option.value,
		label: `nodeColor.${option.value}` as TranslationKey,
		color: paletteNodeColor(option.value),
	}));
	return cachedOptions;
}

/** 节点**自身**的配色指令（`#rrggbb` / 哨兵 `none` / 未写则 null）；内部用 */
function nodeColorOf(node: MindMapNode): string | null {
	const data = node.getData?.() as MdNodeData | null | undefined;
	if (!data) {
		return null;
	}
	return colorDirectiveOf(nodeInlineSource(data));
}

/**
 * 节点**生效**的颜色：自身指令 → 最近祖先指令 → null（＝跟随整篇配色）。
 *
 * 菜单的勾选态用它，不用 `nodeColorOf`：颜色沿子树继承，子节点视觉上已是琥珀、
 * 自身却没有指令——只读自身会让菜单勾在「默认」上，而屏上明明是一片彩色。
 * 哨兵 `none` 原样返回（`'none'` 非空，不会继续往上找），菜单把它与 null 一起
 * 算作「默认」（见 `addNodeColorMenu` 的 `isDefault`）。
 */
export function effectiveNodeColorOf(node: MindMapNode): string | null {
	return nodeColorOf(node) ?? inheritedColorOf(node, nodeColorOf);
}

/**
 * 给这些节点（及各自子树）上色。
 *
 * `color`：`#rrggbb` 染成该色；`null` ＝「默认」，即回到**整篇配色**。
 * 「默认」按节点分别落地（用户无感，结果等价）：上层还在染色就写哨兵
 * `%%none%%` 挡住继承，否则直接删自身指令（不给文件添注释）。
 *
 * 只处理**最上层**的非根节点：根节点没有正文行（写进去会当场丢失，还会撞上
 * 「中心主题改名文件」），它的颜色由整篇配色决定；被包含的子孙靠继承拿到颜色。
 *
 * 重复点同一个颜色不写盘也不渲染：原文没变就 `continue`。
 */
export function applyNodeColor(
	view: MindMapViewContext,
	nodes: readonly MindMapNode[],
	color: string | null,
): void {
	if (!view.mindMap || nodes.length === 0) {
		return;
	}
	const candidate = nodes.filter((node) => !node.isRoot);
	if (candidate.length === 0) {
		return;
	}
	let colored = false;
	for (const node of topMostNodes(candidate)) {
		const data = node.getData() as MdNodeData;
		// 原文 = 「下次写盘会写出的内容」的唯一来源（未编辑 = mdRaw，已编辑 = 合成）
		const raw = composeNodeContent(data, view.app);
		const target =
			color ??
			(inheritedColorOf(node, nodeColorOf) ? COLOR_DIRECTIVE_NONE : null);
		const next = setColorDirective(raw, target);
		if (next === raw) {
			continue;
		}
		// 历史由 applyRawNodeContent 统一记（引擎 addHistory 自带 100ms 防抖：
		// 同一批多选改色在窗口内合并成**一条**快照，不会按节点数堆历史）
		applyRawNodeContent(view, node, next);
		colored = true;
	}
	if (colored) {
		// 必须等渲染落地：本函数只改原文，节点 data 的 fillColor / borderColor 要等
		// `node_tree_render_end` 里的同步才写入；当场采样只能画出一张没变化的图，
		// 还把 30s 窗口白耗掉（K147）。
		refreshMiniMapAfterRender(view);
	}
}
