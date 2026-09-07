/**
 * simple-mind-map 引擎主题配置：亮/暗色配色、视图主题。
 * 从 mindmap.ts 拆出。
 */
import { IMAGE_HEIGHT, IMAGE_WIDTH } from './constants';

const BORDER_RADIUS = 5;

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
	secondFill: '#e8f0fe',
	secondText: '#333333',
	nodeFill: '#ffffff',
	nodeText: '#333333',
	border: '#4a90d9',
	line: '#4a90d9',
};

const DARK_COLORS: ThemeColors = {
	primary: '#555555',
	rootFill: '#2d2d2d',
	rootText: '#e0e0e0',
	secondFill: '#252525',
	secondText: '#d0d0d0',
	nodeFill: '#1e1e1e',
	nodeText: '#c0c0c0',
	border: '#555555',
	line: '#555555',
};

/** 判断指定主题偏好下是否使用暗色配色 */
export function isDarkTheme(themePref: string, isDark: boolean): boolean {
	return themePref === 'dark' || (themePref === 'default' && isDark);
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
		},
		second: {
			fillColor: colors.secondFill,
			color: colors.secondText,
			fontSize: variant.fontSizes.second,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
		},
		node: {
			fillColor: colors.nodeFill,
			color: colors.nodeText,
			fontSize: variant.fontSizes.node,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
		},
		lineColor: colors.line,
		lineWidth: 2,
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
