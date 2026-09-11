/**
 * simple-mind-map 引擎主题配置：亮/暗色配色、视图主题。
 * 从 mindmap.ts 拆出。
 */
import { IMAGE_HEIGHT, IMAGE_WIDTH } from './constants';

const BORDER_RADIUS = 5;
/** 节点水平内边距：略大于引擎默认值（15），仅作左右留白 */
const NODE_PADDING_X = 16;

interface ThemeColors {
	primary: string;
	rootFill: string;
	rootText: string;
	secondFill: string;
	secondText: string;
	nodeFill: string;
	nodeText: string;
	border: string;
	line: string;
}

const LIGHT_COLORS: ThemeColors = {
	primary: '#4a90d9',
	rootFill: '#4a90d9',
	rootText: '#ffffff',
	secondFill: '#f1f5f9',
	secondText: '#1e293b',
	nodeFill: '#f8fafc',
	nodeText: '#64748b',
	border: '#cbd5e1',
	line: '#94a3b8',
};

const DARK_COLORS: ThemeColors = {
	primary: '#555555',
	rootFill: '#2d2d2d',
	rootText: '#e0e0e0',
	secondFill: '#252525',
	secondText: '#d0d0d0',
	nodeFill: '#1e1e1e',
	nodeText: '#a0a0a0',
	border: '#3f3f3f',
	line: '#4a4a4a',
};

/** 判断指定主题偏好下是否使用暗色配色 */
export function isDarkTheme(themePref: string, isDark: boolean): boolean {
	return themePref === 'dark' || (themePref === 'default' && isDark);
}

/**
 * 双链文档自绘图标（节点前缀内容）的描边色：与主题色板同源，
 * 避免在 mindmap.ts 里手写色值。亮色用品牌主蓝，暗色用 nodeText 中性灰。
 */
export function getDocIconColor(isDark: boolean): string {
	return isDark ? DARK_COLORS.nodeText : LIGHT_COLORS.primary;
}

/**
 * 直线连线布局清单（六种布局中四种为直线）：
 * - 组织结构图：须经 `lineStyle: 'straight'` 生效——引擎为该布局实现了三态
 *   renderLine（按 lineStyle 分派 curve/direct/straight），straight 绘制
 *   「父节点底部 → 竖直主干 → 水平分叉 → 子节点顶部」的正交折线；
 * - 目录组织图 / 时间轴 / 鱼骨图：布局类本身即直线绘制（renderLine 只输出
 *   M/L 直线路径、不接受 lineStyle），此处的 straight 对其无副作用，
 *   登记在清单里以如实表达「直线布局」语义；
 * 其余两种（逻辑结构图 / 思维导图）为圆滑曲线。
 * 键必须与 constants.LAYOUT_OPTIONS 的 value 一致。
 */
const STRAIGHT_LINE_LAYOUTS: ReadonlySet<string> = new Set([
	'organizationStructure',
	'catalogOrganization',
	'timeline',
	'fishbone',
]);

/** 指定布局的默认连线样式（curve 圆滑曲线 / straight 直线） */
export function lineStyleForLayout(layout: string): 'curve' | 'straight' {
	return STRAIGHT_LINE_LAYOUTS.has(layout) ? 'straight' : 'curve';
}

/**
 * 支持连线样式三态切换的布局（引擎为其实现 renderLine 的
 * curve/direct/straight 分派）：逻辑结构图、思维导图、组织结构图。
 * 其余三种（目录组织图/时间轴/鱼骨图）的连线由布局类固定为直线，
 * `lineStyle` 对其无效——工具栏据此收窄选项面（只显示「自动」）。
 */
const SWITCHABLE_LINE_STYLE_LAYOUTS: ReadonlySet<string> = new Set([
	'logicalStructure',
	'mindMap',
	'organizationStructure',
]);

/** 该布局是否支持连线样式切换（固定直线布局返回 false） */
export function supportsLineStyleSwitch(layout: string): boolean {
	return SWITCHABLE_LINE_STYLE_LAYOUTS.has(layout);
}

/**
 * 连线样式解析：显式偏好（curve/direct/straight，仅对支持三态的布局可见效果）
 * 直接采用；auto（以及 data.json 手改出的未知值）回落布局默认——脏值行为仍是
 * 当前布局的稳妥默认，不把非法值透传给引擎。
 */
export function resolveLineStyle(
	preference: string,
	layout: string,
): 'curve' | 'direct' | 'straight' {
	return preference === 'curve' ||
		preference === 'direct' ||
		preference === 'straight'
		? preference
		: lineStyleForLayout(layout);
}

/**
 * 主题配置唯一实现：亮/暗配色、字号与布局连线样式（背景色、三级字号、lineStyle）
 * 由 variant 参数统一表达，视图主题是唯一调用方。
 */
function buildThemeConfig(
	isDark: boolean,
	variant: {
		background: string;
		fontSizes: { root: number; second: number; node: number };
		lineStyle: 'curve' | 'direct' | 'straight';
	},
): Record<string, unknown> {
	const colors: ThemeColors = isDark ? DARK_COLORS : LIGHT_COLORS;
	return {
		backgroundColor: variant.background,
		imgMaxWidth: IMAGE_WIDTH,
		imgMaxHeight: IMAGE_HEIGHT,
		root: {
			fillColor: colors.rootFill,
			color: colors.rootText,
			fontSize: variant.fontSizes.root,
			fontWeight: 'bold',
			borderColor: 'transparent',
			borderWidth: 0,
			borderRadius: BORDER_RADIUS,
			paddingX: NODE_PADDING_X,
		},
		second: {
			fillColor: colors.secondFill,
			color: colors.secondText,
			fontSize: variant.fontSizes.second,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
			paddingX: NODE_PADDING_X,
		},
		node: {
			fillColor: colors.nodeFill,
			color: colors.nodeText,
			fontSize: variant.fontSizes.node,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
			paddingX: NODE_PADDING_X,
		},
		lineColor: colors.line,
		lineWidth: 1.5,
		// 连线样式由布局决定（四种直线布局见 lineStyleForLayout；其中目录组织图/
		// 时间轴/鱼骨图由布局类自行绘制直线、不受本值影响）+ 收紧间距：视觉重量随
		// 层级递减、提升一屏信息量。引擎运行时支持（vendor bundle 已验证
		// marginX/marginY/lineStyle/curve/straight/rootLineStartPositionKeepSameInCurve），
		// d.cts 未声明——与现有防腐口径一致，经 Record<string, unknown> 透传。
		lineStyle: variant.lineStyle,
		marginX: 60,
		marginY: 24,
		// 根节点连线起点改在节点右缘：引擎默认从节点中心起画（false），对上下较远的
		// 子节点，曲线在节点内部就已偏出、从上/下边缘斜穿而出，衔接处呈「斜戳出来」的
		// 观感；其余层级本就以边缘为起点，开启后根节点与其它层级一致：右缘水平出发。
		rootLineStartPositionKeepSameInCurve: true,
		...(isDark
			? {
					expandBtnStyle: {
						color: '#999',
						fill: '#333',
						strokeColor: '#666',
					},
				}
			: {}),
	};
}

/**
 * 思维导图视图的主题配置。
 * imgMaxWidth/imgMaxHeight 使用统一的固定图片尺寸，
 * 保证所有图片等高且完整呈现在子主题框架内。
 * lineStyle = 偏好解析结果（auto 时随布局，见 resolveLineStyle）。
 */
export function getThemeConfig(
	isDark: boolean,
	layout: string,
	lineStylePreference: string = 'auto',
): Record<string, unknown> {
	return buildThemeConfig(isDark, {
		background: isDark ? '#1e1e1e' : '#ffffff',
		fontSizes: { root: 16, second: 14, node: 13 },
		lineStyle: resolveLineStyle(lineStylePreference, layout),
	});
}
