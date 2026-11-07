/**
 * 节点级配色：把 Markdown 里的 `%%#hex%%` 指令落到引擎节点数据上。
 *
 * ## 数据落点（为什么写节点 data 而不是改主题）
 * 引擎 `Style.merge` 的优先级是「**节点自身 data 的样式键** → 层级主题 → 顶层主题」
 *（vendor `core/render/node/Style.js:96-106`），故把 `fillColor` / `lineColor` /
 * `borderColor` / `color` 写进节点 data 即可让**该节点**覆盖 `data.json` 里的整篇
 * 配色，且这些键随节点数据参与布局、导出与小地图取样，不另开渲染通道。
 *
 * ## 指令色就是填充色（2026-11-04 用户裁决）
 * 早先把指令色当「色相锚」、填充洗成 16% 的浅色，结果是**写的和显示的对不上**；
 * 现在由 `domain/color.nodeColorScale` 给填充与原色，四个键的语义：
 * - `fillColor`：节点填充 = **指令色原样**（色板不合适当场换色板，不在渲染期加工）；
 * - `lineColor`：**该节点到父节点**的连线色（引擎 `styleLine(line, childNode)` 读的
 *   是子节点的 `lineColor`）——取**同色相深一档**（`NODE_COLORS` 的 `line`）：细线
 *   贯穿全图，承担「这是哪一支」的辨识度，浅色线在 fit 缩放下会整片消失。
 *   **「仅本节点」档（设置项 `nodeColorScope` 为 `node`）不写这个键**：连接线表达的是
 *   「颜色往哪一支延伸」，范围既然止于本节点，前后的线就不该再带它的色；不写
 *   覆盖即回落整篇配色的连线色。连线归子节点 data，故「本节点 → 子节点」那条
 *   线由子节点决定（哨兵已让它回落），两条线都不会带本节点色；
 * - `borderColor`：与连线同一个深档（用户裁决 2026-10-27「节点颜色覆盖边框色」）。
 *   **`borderWidth` 不动**：是否画边框仍由右缘竖栏的「边框」开关（主题）决定，
 *   描边宽度归零时这个颜色只服务小地图墨色；
 * - `color`：文字色 = `nodeInkColor(fill)`。深底白字、浅底柔和深灰蓝 `#111827`
 *   （判据与兜底链见 `domain/color.nodeInkColor`：首选够 4.5 就用它，否则纯黑/
 *   纯白取对比大的）。**只作用于被指令染色的节点**，不改变「文字色只按明暗定」
 *   的整篇口径。
 *
 * 小地图的节点块读的就是这里的 `borderColor`（`core/minimap-geometry` 的标记
 * `color`）——深色分支在缩略图里最清楚。
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
import { nodeLineColorOf } from './mindmap-theme-presets';
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
 * 指令值 → 四个样式键的派生缓存。
 *
 * 理由与 `domain/color.nodeContentTones` 的缓存同源（2026-11-04 性能批）：本函数
 * 在 `node_tree_render_end` 里**逐节点**调用（`applyLiveColorDirectives`），每次都要
 * 正则归一 + 两次对比度 + 一次色表反查；而同一支子树共用同一个指令色，命中率接近
 * 100%。键是**指令原文**（trim + 小写）——上游 `normalizeHexColor` 会做归一，这里
 * 只需按「写进正文的那个字符串」分桶。条目数上限防御脏数据，LRU 与
 * `nodeContentTones` 同口径。
 */
const NODE_COLOR_STYLE_CACHE_MAX = 64;
const nodeColorStyleCache = new Map<string, NodeColorStyle>();

/**
 * 节点色 → 四个样式键（填充 / 连线 / 描边 / 文字）。
 *
 * - `fillColor` / `color`：由 `domain/color.nodeColorScale` 给（填充就是指令色、
 *   文字按填充亮度算）；
 * - `lineColor` / `borderColor`：走 **同色相深一档**（`NODE_COLORS` 的 `line`）。
 *   浅填充若配浅线，在 fit 缩放下结构线会消失（2026-11-05 实机）；描边同时是
 *   小地图的墨色来源，也要够深。自定义 hex 没在表里 → `nodeLineColorOf` 按同一
 *   比例现算深档（**不是**原样返回：浅色输入会和自己的线同色）。
 *
 * 返回值**共享且只读**——调用方只经 `applyColorStyle` 逐键比较后写入，不得原地改。
 */
function nodeColorStyle(color: string): NodeColorStyle {
	const key = color.trim().toLowerCase();
	const cached = nodeColorStyleCache.get(key);
	if (cached) {
		// LRU 提升：删后重插 → 回到队尾
		nodeColorStyleCache.delete(key);
		nodeColorStyleCache.set(key, cached);
		return cached;
	}
	const { fill, ink } = nodeColorScale(color);
	const line = nodeLineColorOf(fill);
	const style: NodeColorStyle = {
		fillColor: fill,
		lineColor: line,
		borderColor: line,
		color: ink,
	};
	while (nodeColorStyleCache.size >= NODE_COLOR_STYLE_CACHE_MAX) {
		const oldest = nodeColorStyleCache.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		nodeColorStyleCache.delete(oldest);
	}
	nodeColorStyleCache.set(key, style);
	return style;
}

/**
 * 把生效颜色写进一份节点 data（`null` = 清空覆盖、回落主题）。
 *
 * `colorLine = false`（作用范围「仅本节点」）时**不写 `lineColor`**：连接线是
 * 「这一支往哪延伸」的线索，颜色只覆盖本节点时它应回落整篇配色。填充 / 描边 /
 * 文字三键不受影响——尤其 `borderColor` 仍要留着，小地图的墨色读它。
 *
 * @returns 是否真的改动过（调用方据此避免无意义的重渲染）
 */
function applyColorStyle(
	data: Record<string, unknown>,
	style: NodeColorStyle | null,
	colorLine: boolean,
): boolean {
	let changed = false;
	for (const key of NODE_COLOR_KEYS) {
		const next =
			key === 'lineColor' && !colorLine ? undefined : style?.[key];
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
 *
 * @param colorLine 连接线是否跟着节点色（`false` ＝作用范围「仅本节点」）。
 *   省略＝ `true`（含子节点档，历史行为）；两个创建入口都显式传当前设置。
 */
export function applyColorDirectivesToTree(
	tree: MindMapTreeNode,
	readDirective: ColorDirectiveReader,
	colorLine = true,
): void {
	walkColorDirectives(
		tree,
		(node) => readDirective(nodeInlineSource(node.data ?? {})),
		(node, color) => {
			const data = node.data as Record<string, unknown> | undefined;
			if (data) {
				applyColorStyle(data, color ? nodeColorStyle(color) : null, colorLine);
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
 * @param colorLine 连接线是否跟着节点色（与 `applyColorDirectivesToTree` 同口径）
 * @returns 是否有节点样式真的变了（调用方据此决定是否 `render()`）
 */
export function applyLiveColorDirectives(
	root: MindMapNode | null,
	readDirective: ColorDirectiveReader,
	colorLine = true,
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
			if (
				data &&
				applyColorStyle(data, color ? nodeColorStyle(color) : null, colorLine)
			) {
				changed = true;
			}
		},
	);
	return changed;
}
