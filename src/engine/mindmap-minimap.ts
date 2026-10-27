/**
 * 小地图缩略图的引擎侧读取面（F12-M）。
 *
 * 只做四件事：取画布尺寸、从**渲染树已有的布局几何**提取节点盒子/父子关系与
 * 全量包围盒、从当前主题与布局读外观（配色 / 连线样式 / **连线形态**，鱼骨族
 * 走斜脊，见 `connectorModeForLayout`），再把三者交给 `core/minimap-geometry`
 * 拼成 SVG。
 *
 * 刻意**不走引擎的 MiniMap 插件 / getSvgData**：那要克隆整棵 SVG（性能模式下
 * 还会 `forceLoadNode` 把全树物化进 DOM），只为得到一张 220px 宽的缩略图——
 * 节点越多亏得越多，而大图正是必须省的地方。渲染树节点在布局阶段已写入
 * `left/top/width/height`（vendor `MindMapNode` 字段，性能模式下视口外节点
 * 只是被摘下 group，几何仍在），零装配即可取用。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import {
	MINIMAP_LINK_NODE_LIMIT,
	MINIMAP_MAX_HEIGHT_RATIO,
} from '../core/constants';
import {
	buildMiniMapMarks,
	buildMiniMapSvg,
	computeMiniMapSize,
	connectorModeForLayout,
	measureMiniMapBounds,
	pickVisibleColor,
	MINIMAP_FALLBACK_COLORS,
	type MiniMapBox,
	type MiniMapColors,
	type MiniMapConnectorMode,
	type MiniMapLineStyle,
	type MiniMapLinkMode,
	type MiniMapMeasure,
	type MiniMapSize,
} from '../core/minimap-geometry';
import { createWarnOnce } from '../core/errors';
import { getRenderRoot } from './mindmap-nodes';
import { getCanvasSize } from './mindmap-viewport-canvas';

/** 取样失败只告警一次（每帧/每 30s 都可能走到 catch） */
const warnCaptureFailed = createWarnOnce();

/** 一次缩略图取样的完整结果（视图层据此定尺寸、换图、投影视口框） */
export interface MiniMapFrame {
	/** 内容盒（布局坐标） */
	content: MiniMapBox;
	/** 画布尺寸（像素） */
	canvas: MiniMapSize;
	/** 面板尺寸（宽 160–220、高随比例） */
	panel: MiniMapSize;
	/** 标记指纹：判「换没换图」的第三项（见 `sameMiniMapFrame`） */
	signature: number;
	/** 缩略图（`data:image/svg+xml` URL，交给 `<img>` 解码） */
	image: string;
}

/**
 * 全树几何测量（启用判据与取图共用一份）。
 *
 * 收口缘由：`refresh`（判据，节流 1s）与 `captureMiniMap`（取图）都要「全量
 * 节点盒」，各测一遍就是同一份遍历跑两三次（5000+ 节点时可感）。视图层把本函数
 * 的结果同时喂给 `contentExceedsCanvasAtFullScale` 与 `captureMiniMap`，一次搞定。
 */
export function measureMiniMapContent(
	mindMap: MindMap | null,
): MiniMapMeasure | null {
	return mindMap ? measureMiniMapBounds(getRenderRoot(mindMap)) : null;
}

/** 主题的窄面（`themeConfig` 未进 d.cts，防御式读取） */
interface ThemeConfigLike {
	readonly backgroundColor?: unknown;
	readonly lineColor?: unknown;
	/** 连线样式：折线（正交）/ 曲线（平滑） */
	readonly lineStyle?: unknown;
	/**
	 * 节点两色：**描边优先**（填充色常常≈背景，照抄会糊成白块）；
	 * 填充只在描边画不出来时兜底（无边框主题 / 脏值，见 `readInk`）
	 */
	readonly node?: {
		readonly borderColor?: unknown;
		readonly fillColor?: unknown;
	};
	readonly root?: { readonly fillColor?: unknown };
}

/** 一帧缩略图要读的全部外观（一次读完，避免同一份 `themeConfig` 被反复 cast） */
interface MiniMapAppearance {
	colors: MiniMapColors;
	lineStyle: MiniMapLineStyle;
	connector: MiniMapConnectorMode;
}

/**
 * 取一份缩略图。任何一环不可得（引擎中间态、容器零尺寸、渲染树未回填）
 * 返回 null——调用方保持上一帧（不画半张图），等下个事件再试。
 *
 * @param measured 调用方刚为「启用判据」测过的全树几何：传入即省一遍遍历
 *   （判据与取图同一时刻 → 同一份几何，不存在口径差）。
 * @param canvasSize 调用方刚读到的画布尺寸：传入即省一次实时矩形读取
 *   （`getBoundingClientRect` 会强制布局）。视图层让「窄画布门禁 / 启用判据 /
 *   取图」共用这一次读数。
 */
export function captureMiniMap(
	mindMap: MindMap | null,
	measured?: MiniMapMeasure | null,
	canvasSize?: MiniMapSize | null,
): MiniMapFrame | null {
	if (!mindMap) {
		return null;
	}
	try {
		const size = canvasSize === undefined ? getCanvasSize(mindMap) : canvasSize;
		if (!size) {
			return null;
		}
		// 映射基准 = 全量节点包围盒（`buildMiniMapMarks` 内由 `measureMiniMapBounds`
		// 给出，与启用判据同源）；渲染树未回填时返回 null，调用方保持上一帧。
		const sampled = buildMiniMapMarks(
			getRenderRoot(mindMap),
			undefined,
			measured,
		);
		if (!sampled) {
			return null;
		}
		// 高度上限 = 画布高 × 60%（「开放高度但封顶」，2026-10-24 用户裁决）：
		// 高瘦内容长成可用比例，又不占满左侧整列
		const panel = computeMiniMapSize(
			sampled.bounds,
			size.height * MINIMAP_MAX_HEIGHT_RATIO,
		);
		if (!panel) {
			return null;
		}
		// 连线画到哪一档看**节点数**（2026-10-25 用户裁决，最终版：按性能模式阈值分档
		// ——≤阈值画全部父子连线，>阈值只画前 `MINIMAP_LINK_MAX_DEPTH` 层）。判据用
		// 全量节点数，不是抽样后的标记数；深度过滤在 core 侧只作用于连线，方块全画。
		const linkMode = resolveLinkMode(sampled);
		const appearance = readAppearance(mindMap);
		const svg = buildMiniMapSvg(
			sampled.bounds,
			sampled.marks,
			panel,
			appearance.colors,
			appearance.lineStyle,
			appearance.connector,
			linkMode,
		);
		return {
			// 映射基准与视口框共用**全量节点包围盒**（不是抽样标记的盒子，也不是
			// rbox 口径的内容盒）：三者不一致会让小图一侧留白、比例与主图对不上
			content: sampled.bounds,
			canvas: size,
			panel,
			signature: sampled.signature,
			image: toDataUrl(svg),
		};
	} catch (error) {
		// 同一根因只告警一次：本函数每 30s（及每次用户动作）都会跑，
		// 普通 warn 会在引擎持续异常时刷屏（口径见 core/errors.createWarnOnce）
		warnCaptureFailed('生成小地图缩略图失败', error);
		return null;
	}
}

/**
 * 连线档位：≤ 阈值全画；> 阈值只画前 `MINIMAP_LINK_MAX_DEPTH` 层（2026-10-25 裁决）。
 *
 * 判据用**全量**节点数，不是抽样后的标记数（抽样只在 > `MINIMAP_MAX_MARKS` 2000
 * 时发生）。不配额、不设星形闸：浅宽图（深度不到上限）本来就不受约束。
 */
function resolveLinkMode(sample: MiniMapMeasure): MiniMapLinkMode {
	return sample.total <= MINIMAP_LINK_NODE_LIMIT ? 'all' : 'shallow';
}

/**
 * 读一帧缩略图要用的**全部**外观：配色 + 连线样式 + 布局连线形态。
 *
 * 三者都从 `themeConfig` / `opt.layout` 派生（两处 `unknown` 私有形态），故**只
 * cast 一次、只读一次**：此前拆成三个函数各取一遍，同一份 `themeConfig` 被反复
 * 断言，改字段时容易只改到其中一处。三者的语义约束：
 * - 配色跟随配色/明暗切换，缺失项回落中性灰；描边色并非装饰——白底主题里节点
 *   填充就是 `#f8fafc`，没有描边缩略图上一片白；
 * - 连线样式读 `themeConfig.lineStyle`（引擎里的唯一真相：插件在 `applyThemeConfig`
 *   已按「布局 × 偏好」解析后写入，固定折线的布局由 `resolveLineStyle` 写死
 *   straight），此处不重复判布局；缺失/异常按折线；
 * - 连线形态读 `opt.layout`（`applyThemeConfig` / `setLayout` 写入的唯一真相），
 *   映射本身在 `core/minimap-geometry.connectorModeForLayout`，这里只做取字段与
 *   `unknown` 收窄。
 */
function readAppearance(mindMap: MindMap): MiniMapAppearance {
	const theme = (mindMap as unknown as { themeConfig?: ThemeConfigLike })
		.themeConfig;
	const layout = mindMap.opt?.layout;
	return {
		colors: {
			background: readColor(
				theme?.backgroundColor,
				MINIMAP_FALLBACK_COLORS.background,
			),
			// 墨色有回落链：描边 → 填充 → 连线色（见 readInk）
			nodeBorder: readInk(
				theme?.node?.borderColor,
				theme?.node?.fillColor,
				theme?.lineColor,
			),
			root: readColor(theme?.root?.fillColor, MINIMAP_FALLBACK_COLORS.root),
			line: readColor(theme?.lineColor, MINIMAP_FALLBACK_COLORS.line),
		},
		lineStyle: theme?.lineStyle === 'curve' ? 'curve' : 'straight',
		connector: connectorModeForLayout(
			typeof layout === 'string' ? layout : null,
		),
	};
}

function readColor(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: fallback;
}

/**
 * 取「墨色」（缩略图里节点块的填充）：按 描边 → 填充 → 连线色 依次取第一个**画得出来**的颜色。
 *
 * 为什么需要回落链（2026-10-25 实机）：无边框主题一度把 `node.borderColor` 也写成
 * `transparent`，而缩略图正是拿它当墨——于是切到无边框后节点块整片消失、只剩连线
 * 端点。`readColor` 只判空串，`transparent` 是合法 CSS 值会被照抄，故此处必须显式
 * 排除「看得见但画不出」的颜色。主题侧已改为「只把 `borderWidth` 归零、保留颜色」，
 * 这一层是防御：主题数据再写出透明色时，缩略图退到填充色 / 连线色而不是变瞎。
 */
function readInk(...candidates: readonly unknown[]): string {
	// 「什么是画得出来的颜色」由 core 统一判定（节点自定义颜色的逐块上色共用它）
	return pickVisibleColor(...candidates) ?? MINIMAP_FALLBACK_COLORS.nodeBorder;
}

/** SVG 字符串 → data URL（`<img>` 解码，不注入 DOM，避免污染 `.smm-*` 选择器） */
function toDataUrl(svg: string): string {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
