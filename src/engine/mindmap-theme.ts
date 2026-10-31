/**
 * simple-mind-map 引擎主题配置：把「主题色 / 布局 / 连线 / 边框 / 配色」装配成
 * 引擎的 themeConfig。从 mindmap.ts 拆出。
 *
 * 本文件只做**装配与字号/间距口径**：色值来自 `mindmap-palette`（配色解析与
 * 派生，含亮/暗文字色与画布底色）与 `mindmap-theme-presets`（五档填充/线色、
 * 边框预设）——那两处才是色值字面量的归属，此处不新增 hex。
 */
import {
	DEFAULT_LINE_STYLE,
	DEFAULT_PALETTE,
	DEFAULT_THEME_STYLE,
	IMAGE_HEIGHT,
	IMAGE_WIDTH,
	normalizeLineStylePreference,
	normalizeThemeStyle,
} from '../core/constants';
import type { ThemeStyleId } from '../core/constants';
import { resolvePaletteTheme, type ThemeTextColors } from './mindmap-palette';
import {
	THEME_STYLE_PRESETS,
	type PaletteColors,
} from './mindmap-theme-presets';

const BORDER_RADIUS = 5;
/** 节点水平内边距：略大于引擎默认值（15），仅作左右留白 */
const NODE_PADDING_X = 16;

/** 判断指定主题偏好下是否使用暗色配色 */
export function isDarkTheme(themePref: string, isDark: boolean): boolean {
	return themePref === 'dark' || (themePref === 'default' && isDark);
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
 * 色值本体（五档填充/线色 + 三档文字色）由调用方从 `mindmap-palette` 取好传入
 * ——本文件不解析配色。视图主题是唯一调用方。
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
	},
	colors: PaletteColors,
	text: ThemeTextColors,
): Record<string, unknown> {
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
		// 联系（关系连线）：比父子线更轻的辅助线——细、浅、虚线更密，且**不画在
		// 节点之上**（该开关是 opt 不是 theme，见 engine/mindmap.createMindMap）。
		// 标签自带描边光晕（vendor 补丁 14），压在任何元素上都可读。
		associativeLineColor: colors.line,
		associativeLineWidth: 1.5,
		associativeLineDasharray: '4,4',
		associativeLineTextColor: text.nodeText,
		associativeLineTextFontSize: 12,
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
 * palette = 配色（预设 id，或「自定义」写入的十六进制）；与 isDark、themeStyle
 * 三维正交，只换 5 个填充/线色。脏值由 `mindmap-palette.resolvePaletteTheme`
 * 兜住（十六进制归一，其余回退 `default`），十六进制值当场派生五档
 * （文字色按亮度现算）——本文件不做第二道判定。
 */
export function getThemeConfig(
	isDark: boolean,
	layout: string,
	lineStylePreference: string = DEFAULT_LINE_STYLE,
	themeStyle: string = DEFAULT_THEME_STYLE,
	palette: string = DEFAULT_PALETTE,
): Record<string, unknown> {
	const { background, colors, text } = resolvePaletteTheme(palette, isDark);
	return buildThemeConfig(
		isDark,
		{
			background,
			fontSizes: { root: 16, second: 14, node: 13 },
			lineStyle: resolveLineStyle(lineStylePreference, layout),
			themeStyle: normalizeThemeStyle(themeStyle),
		},
		colors,
		text,
	);
}
