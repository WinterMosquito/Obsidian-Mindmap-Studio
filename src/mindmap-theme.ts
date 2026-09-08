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
 * 主题配置唯一实现：亮/暗配色与字号差异（背景色、三级字号）由 variant 参数
 * 统一表达，视图主题是唯一调用方。
 */
function buildThemeConfig(
	isDark: boolean,
	variant: {
		background: string;
		fontSizes: { root: number; second: number; node: number };
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
		// 连线圆滑曲线 + 收紧间距：视觉重量随层级递减、提升一屏信息量。
		// 引擎运行时支持（vendor bundle 已验证 marginX/marginY/lineStyle/curve），
		// d.cts 未声明——与现有防腐口径一致，经 Record<string, unknown> 透传。
		lineStyle: 'curve',
		marginX: 60,
		marginY: 24,
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
 */
export function getThemeConfig(isDark: boolean): Record<string, unknown> {
	return buildThemeConfig(isDark, {
		background: isDark ? '#1e1e1e' : '#ffffff',
		fontSizes: { root: 16, second: 14, node: 13 },
	});
}
