/**
 * 节点级配色：把 Markdown 里的 `%%#hex%%` 指令落到引擎节点数据上。
 *
 * ## 数据落点（为什么写节点 data 而不是改主题）
 * 引擎 `Style.merge` 的优先级是「**节点自身 data 的样式键** → 层级主题 → 顶层主题」
 *（vendor `core/render/node/Style.js:96-106`），故把 `fillColor` / `lineColor` /
 * `borderColor` / `color` 写进节点 data 即可让**该节点**覆盖 `data.json` 里的整篇
 * 配色，且这些键随节点数据参与布局、导出与小地图取样，不另开渲染通道。
 *
 * ## 指令色是「主色」，不是填充色（2026-10-29 用户裁决，B 方案）
 * 三档由 `domain/color.nodeColorScale` 唯一派生（大面积留浅、饱和留给细线），
 * 四个键的语义：
 * - `fillColor`：节点填充 = 主色向画布白混 84%（L* ≈ 92、深字对比 ≥ 13）——
 *   **不再**把中深色铺满整支子树（那样白字/黑字都被迫贴着 4.5 的底线）；
 * - `lineColor`：**该节点到父节点**的连线色（引擎 `styleLine(line, childNode)` 读的
 *   是子节点的 `lineColor`）——**保留主色**：细线面积小、贯穿全图，由它承担
 *   「这是哪一支」的辨识度；
 * - `borderColor`：描边同色（用户裁决 2026-10-27「节点颜色覆盖边框色」）。
 *   **`borderWidth` 不动**：是否画边框仍由右缘竖栏的「边框」开关（主题）决定，
 *   描边宽度归零时这个颜色只服务小地图墨色；
 * - `color`：文字色 = `nodeInkColor(fill)`。填充恒为浅底 ⇒ 落在柔和深灰蓝
 *   `#111827`（不再出现同一屏里白字/黑字混用）。判据与兜底链见
 *   `domain/color.nodeInkColor`：首选够 4.5 就用它，否则纯黑/纯白取对比大的。
 *   **只作用于被指令染色的节点**，不改变「文字色只按明暗定」的整篇口径。
 *
 * 小地图的节点块读的就是这里的 `borderColor`（`core/minimap-geometry` 的标记
 * `color`）——主色比浅填充深得多，缩略图因此比「整支一个中深色」时更清楚。
 *
 * ## 优先级
 * 节点指令 > 最近祖先指令 > 文件配色（`viewState[<路径>].palette`）> 出厂默认。
 * 继承遍历的唯一实现在 `domain/color.walkColorDirectives`；本文件只负责
 * 「颜色 → 样式键」与「写进哪份数据」。哨兵 `%%none%%` 在**遍历里**就折成 null 且
 * 阻断下传，所以这里只会收到「颜色或 null」——**别在这里再判一次 none**。
 *
 * ## 与 Markdown 的关系
 * 样式键是**渲染期派生数据**，不写回文件：回写仍只读 `mdRaw` / `text`
 *（见 `domain/md-meta.nodeInlineSource`）。指令本身留在正文里，是唯一真相。
 */
import type { MindMapNode, MindMapTreeNode } from '../core/engine-types';
import { nodeColorScale, walkColorDirectives } from '../domain/color';
import { nodeInlineSource } from '../domain/md-meta';

/** 读一行原文里的配色指令（`#rrggbb` / 哨兵 `none` / 未写则 null）；生产实现 = `colorDirectiveOf` */
export type ColorDirectiveReader = (raw: string) => string | null;

/** 本模块拥有（并可清除）的节点样式键 */
const NODE_COLOR_KEYS = [
	'fillColor',
	'lineColor',
	'borderColor',
	'color',
] as const;

/**
 * 每键的取值。**键集从 `NODE_COLOR_KEYS` 派生**（勿另列一遍 interface）：清除
 * 分支遍历的就是那份键表，写入分支若自持一份，增删键时必然漏改一边。
 */
type NodeColorStyle = Record<(typeof NODE_COLOR_KEYS)[number], string>;

/**
 * 主色 → 四个样式键（填充 / 连线 / 描边 / 文字）。
 *
 * 派生在 `domain/color.nodeColorScale`（唯一实现）：填充取浅档、连线与描边取
 * 主色本身、文字色按填充算。这里只做「键名映射」，不再自行混色或判墨色。
 */
function nodeColorStyle(color: string): NodeColorStyle {
	const { fill, line, ink } = nodeColorScale(color);
	return {
		fillColor: fill,
		lineColor: line,
		borderColor: line,
		color: ink,
	};
}

/**
 * 把生效颜色写进一份节点 data（`null` = 清空覆盖、回落主题）。
 * @returns 是否真的改动过（调用方据此避免无意义的重渲染）
 */
function applyColorStyle(
	data: Record<string, unknown>,
	style: NodeColorStyle | null,
): boolean {
	let changed = false;
	for (const key of NODE_COLOR_KEYS) {
		const next = style?.[key];
		if (next === undefined) {
			if (key in data) {
				delete data[key];
				changed = true;
			}
			continue;
		}
		if (data[key] !== next) {
			data[key] = next;
			changed = true;
		}
	}
	return changed;
}

/**
 * 引擎创建**之前**把颜色写进 data 树（首帧即带颜色，不额外渲染一次）。
 *
 * 视图加载与 ```mindmap 嵌入两个创建入口都必须在 `createMindMap` 前调用；
 * 引擎 `MindMapNode.handleData` 会克隆数据，创建后再改这棵树不再生效。
 */
export function applyColorDirectivesToTree(
	tree: MindMapTreeNode,
	readDirective: ColorDirectiveReader,
): void {
	walkColorDirectives(
		tree,
		(node) => readDirective(nodeInlineSource(node.data ?? {})),
		(node, color) => {
			const data = node.data as Record<string, unknown> | undefined;
			if (data) {
				applyColorStyle(data, color ? nodeColorStyle(color) : null);
			}
		},
	);
}

/**
 * 引擎创建**之后**按实时节点树重算颜色（文本编辑 / 插入 / 撤销都会改变指令）。
 *
 * 直接写节点 data（不 execCommand）：这是一份**派生自 Markdown 的显示状态**，
 * 不该进入命令历史、也不该触发 `data_change`（否则保存管线与同步逻辑互相唤醒）。
 *
 * @returns 是否有节点样式真的变了（调用方据此决定是否 `render()`）
 */
export function applyLiveColorDirectives(
	root: MindMapNode | null,
	readDirective: ColorDirectiveReader,
): boolean {
	if (!root) {
		return false;
	}
	// 两次 `getData()`（读数 / 写样式）读的是同一个 `nodeData.data` 引用，
	// 引擎里就是取属性——不必为了「只读一次」在这里加缓存
	let changed = false;
	walkColorDirectives(
		root,
		(node) => {
			const data = node.getData?.() as Record<string, unknown> | undefined;
			return data ? readDirective(nodeInlineSource(data)) : null;
		},
		(node, color) => {
			const data = node.getData?.() as Record<string, unknown> | undefined;
			if (data && applyColorStyle(data, color ? nodeColorStyle(color) : null)) {
				changed = true;
			}
		},
	);
	return changed;
}
