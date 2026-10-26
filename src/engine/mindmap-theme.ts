/**
 * simple-mind-map 引擎主题配置：亮/暗色配色、视图主题。
 * 从 mindmap.ts 拆出。
 */
import {
	DEFAULT_LINE_STYLE,
	DEFAULT_PALETTE,
	DEFAULT_THEME_STYLE,
	IMAGE_HEIGHT,
	IMAGE_WIDTH,
	normalizeLineStylePreference,
	normalizePalette,
	normalizeThemeStyle,
} from '../core/constants';
import type { PaletteId, ThemeStyleId } from '../core/constants';
import { PALETTES, THEME_STYLE_PRESETS } from './mindmap-theme-presets';

const BORDER_RADIUS = 5;
/** 节点水平内边距：略大于引擎默认值（15），仅作左右留白 */
const NODE_PADDING_X = 16;

/**
 * 文字色三档——**不随配色变**，只按明暗定。
 *
 * 完整九键色板 = `PALETTES[<配色>][<亮|暗>]` 的 5 个填充/线色 + 本处的 3 个
 * 文字色。这样新增配色只需 5 个 hex，且不会出现「某套配色的浅底配错深字」
 * 这类不可读组合（文字色的对比度只需按明暗校核一次）。
 */
const TEXT_LIGHT = {
	rootText: '#ffffff',
	secondText: '#1e293b',
	nodeText: '#64748b',
} as const;

const TEXT_DARK = {
	rootText: '#e0e0e0',
	secondText: '#d0d0d0',
	nodeText: '#a0a0a0',
} as const;

/** 判断指定主题偏好下是否使用暗色配色 */
export function isDarkTheme(themePref: string, isDark: boolean): boolean {
	return themePref === 'dark' || (themePref === 'default' && isDark);
}

/**
 * 双链文档自绘图标（节点前缀内容）的描边色：与**当前配色**同源，
 * 避免在 mindmap.ts 里手写色值。亮色用该配色的根节点主色，暗色用 nodeText 中性灰
 * （暗色下各配色的 rootFill 都很深，拿它当图标色会看不见）。
 */
export function getDocIconColor(isDark: boolean, palette: string): string {
	return isDark
		? TEXT_DARK.nodeText
		: PALETTES[normalizePalette(palette)].light.rootFill;
}

/**
 * 支持连线样式切换的布局：逻辑结构图、思维导图、组织结构图。
 * 引擎为这三种实现 renderLine 的 curve/direct/straight 分派；插件对外只暴露
 * 折线 / 曲线两态（direct 与 auto 已于 2026-10-21 下线，
 * 见 core/constants.LINE_STYLE_OPTIONS）。
 * 其余三种（目录组织图/时间轴/鱼骨图）的连线由布局类固定为直线，
 * `lineStyle` 对其无效——工具栏据此收窄为单项「直线」描述（不是「自动」）。
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
 * 连线样式解析（2026-10-21 收敛为两态）：
 * - 支持切换的布局（逻辑结构图 / 思维导图 / 组织结构图）→ 偏好的归一结果；
 * - 固定直线布局（目录组织图 / 时间轴 / 鱼骨图）→ 恒 `straight`：连线由布局类
 *   自行绘制、`lineStyle` 对其无效，如实表达现状而不是把无效偏好透传给引擎。
 *
 * 脏值（`auto` / `direct` / 未知 / 空串）由 `normalizeLineStylePreference` 归一为
 * 折线——与默认值同源，不再有「随布局」这条第二口径。
 */
export function resolveLineStyle(
	preference: string,
	layout: string,
): 'curve' | 'straight' {
	return supportsLineStyleSwitch(layout)
		? normalizeLineStylePreference(preference)
		: 'straight';
}

/**
 * 主题配置唯一实现：亮/暗配色、字号、布局连线样式与节点外观主题
 * （背景色、三级字号、lineStyle、themeStyle）由 variant 参数统一表达，
 * 视图主题是唯一调用方。
 *
 * 合并顺序固定为「色板默认 → 主题覆盖」：主题只能在节点填充/描边上做减法，
 * 不能改字体度量与连线——那两项分别由 `variant.fontSizes` / `variant.lineStyle`
 * 单一来源表达，主题越权就会与「主题色 / 布局 / 连线偏好」三方打架。
 */
function buildThemeConfig(
	isDark: boolean,
	variant: {
		background: string;
		fontSizes: { root: number; second: number; node: number };
		lineStyle: 'curve' | 'straight';
		themeStyle: ThemeStyleId;
		palette: PaletteId;
	},
): Record<string, unknown> {
	// 两个 id 均已由 normalize* 归一为合法值；`Record<…, …>` 又保证键完整
	//（漏写即编译失败）——故此处不需要第二道兜底分支
	const colors = PALETTES[variant.palette][isDark ? 'dark' : 'light'];
	const text = isDark ? TEXT_DARK : TEXT_LIGHT;
	const preset = THEME_STYLE_PRESETS[variant.themeStyle];
	return {
		backgroundColor: variant.background,
		imgMaxWidth: IMAGE_WIDTH,
		imgMaxHeight: IMAGE_HEIGHT,
		root: {
			fillColor: colors.rootFill,
			color: text.rootText,
			fontSize: variant.fontSizes.root,
			fontWeight: 'bold',
			borderColor: 'transparent',
			borderWidth: 0,
			borderRadius: BORDER_RADIUS,
			paddingX: NODE_PADDING_X,
			...preset.root,
		},
		second: {
			fillColor: colors.secondFill,
			color: text.secondText,
			fontSize: variant.fontSizes.second,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
			paddingX: NODE_PADDING_X,
			...preset.second,
		},
		node: {
			fillColor: colors.nodeFill,
			color: text.nodeText,
			fontSize: variant.fontSizes.node,
			borderColor: colors.border,
			borderWidth: 1,
			borderRadius: BORDER_RADIUS,
			paddingX: NODE_PADDING_X,
			...preset.node,
		},
		lineColor: colors.line,
		lineWidth: 1.5,
		// 连线样式由偏好解析而来（resolveLineStyle：两态折线/曲线；目录组织图/
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
 *
 * imgMaxWidth/imgMaxHeight（= 默认盒 `IMAGE_WIDTH × IMAGE_HEIGHT`）：**引擎侧
 * 兜底约束**，只作用于 `imageSize.custom:false` 的图（首帧兜底
 * `ensureDefaultImageSizes`、探测失败回退）——`nodeCreateContents.getImgShowSize`
 * 对 `custom:false` **必然读取**这两个值，故**不可删除**（传 undefined 的行为在
 * vendor 未定义）；自然尺寸/参数尺寸路径均走 `custom:true`、完全绕过它
 * （2026-09-28 K97：未设置尺寸按图片原始大小展示、长边超 `IMAGE_MAX_SIDE_PX`
 * 等比缩，见 `media/images-path.fitImageWithinMaxSide`）。
 * lineStyle = 偏好解析结果（两态：折线 / 曲线；固定直线布局恒折线，见 resolveLineStyle）。
 * themeStyle = 边框样式（`default`＝有边框 / `borderless`＝无边框；id 是持久化键，
 * 不随 UI 名变化）；与 isDark 正交，脏值经 `normalizeThemeStyle` 回退出厂默认，
 * 保证渲染入口不因手改 data.json 失败。
 * palette = 配色（色相方案，`default` / `mint` / …）；与 isDark、themeStyle 三维正交，
 * 只换 5 个填充/线色，脏值经 `normalizePalette` 回退 `default`。
 */
export function getThemeConfig(
	isDark: boolean,
	layout: string,
	lineStylePreference: string = DEFAULT_LINE_STYLE,
	themeStyle: string = DEFAULT_THEME_STYLE,
	palette: string = DEFAULT_PALETTE,
): Record<string, unknown> {
	return buildThemeConfig(isDark, {
		background: isDark ? '#1e1e1e' : '#ffffff',
		fontSizes: { root: 16, second: 14, node: 13 },
		lineStyle: resolveLineStyle(lineStylePreference, layout),
		themeStyle: normalizeThemeStyle(themeStyle),
		palette: normalizePalette(palette),
	});
}
