/**
 * 配色（色相方案）的解析与派生：预设 id 或自定义十六进制 → 一套可用色值。
 *
 * 边界（从 `mindmap-theme` 拆出，2026-10-27）：
 * - **数据**在 `mindmap-theme-presets`（`PALETTES` 的五档填充/线色 + 边框预设）；
 *   本文件不放配色字面量（除亮/暗两套文字色与画布底色），只回答「选哪一套」
 *   与「怎么从一个主色推出一套」；
 * - **落地**在 `mindmap-theme`：把这里的产物拼成引擎 themeConfig；
 * - 零引擎依赖、纯计算：`normalize*` 兜住手改 `data.json` 的脏值，可直接单测。
 */
import { normalizePalette } from '../core/constants';
import type { PaletteId } from '../core/constants';
import {
	contrastTextColor,
	mixHex,
	normalizeHexColor,
} from '../domain/color';
import { PALETTES, type PaletteColors } from './mindmap-theme-presets';

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

/** 画布底色：自定义配色的混色基准（二/三级节点向它靠拢） */
const BACKGROUND_LIGHT = '#ffffff';
const BACKGROUND_DARK = '#1e1e1e';

/** 三档文字色（与 `PALETTES` 的 5 个填充/线色一起构成完整 9 键色板） */
export interface ThemeTextColors {
	rootText: string;
	secondText: string;
	nodeText: string;
}

/**
 * 配色偏好值里的**自定义色**：值是十六进制时返回归一的 `#rrggbb`，否则 null
 * （＝预设 id）。「自定义配色」的唯一识别口——别在调用方各写一遍 `typeof` 防御。
 *
 * 入参声明 `unknown`：验证脚手架 / 引擎中间态可能传进非字符串，若不挡住，
 * `normalizeHexColor` 的 `value.trim()` 会当场抛错、整图渲染中断。
 */
function customPaletteColor(value: unknown): string | null {
	return typeof value === 'string' ? normalizeHexColor(value) : null;
}

/**
 * 双链文档自绘图标（节点前缀内容）的描边色：与**当前配色**同源，
 * 避免在 mindmap.ts 里手写色值。亮色用该配色的根节点主色，暗色用 nodeText 中性灰
 * （暗色下各配色的 rootFill 都很深，拿它当图标色会看不见）。
 *
 * 自定义整篇配色（值本身是十六进制）没有「四档明暗」之分：图标直接用该色
 * （暗色也用——用户选的就是这个色相，回退到中性灰会让图标与整篇脱节）。
 */
export function getDocIconColor(isDark: boolean, palette: string): string {
	const custom = customPaletteColor(palette);
	if (custom) {
		return custom;
	}
	return isDark
		? TEXT_DARK.nodeText
		: PALETTES[normalizePalette(palette)].light.rootFill;
}

/**
 * 节点级配色菜单里「某一套配色」对应的颜色：取该配色的**根节点主色**
 * （亮色档——节点颜色写进 Markdown 后不随明暗变，见 `domain/color` 的口径）。
 *
 * 这是「配色 → 单色」的唯一定义：新增配色时菜单自动多一项，勿在菜单层
 * 手抄色值。
 */
export function paletteNodeColor(palette: PaletteId): string {
	return PALETTES[palette].light.rootFill;
}

/**
 * 自定义整篇配色（值 = 一个十六进制）→ 五档色板。
 *
 * 派生规则：根节点用原色（承载反白字，与已知配色的 rootFill 同角色），
 * 二/三级节点向画布底色靠拢（86% / 93%）、描边 50%、连线 35%——层级递减关系与
 * `PALETTES` 的设计约束一致，只是**从用户给的一个色相推出来**。混色实现在
 * `domain/color.mixHex`（纯函数，可直测）。
 */
function deriveCustomPalette(hex: string, isDark: boolean): PaletteColors {
	const background = isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT;
	return {
		rootFill: hex,
		secondFill: mixHex(hex, background, 0.86),
		nodeFill: mixHex(hex, background, 0.93),
		border: mixHex(hex, background, 0.5),
		line: mixHex(hex, background, 0.35),
	};
}

/** 一次配色解析的完整产物：画布底色 + 五档填充/线色 + 三档文字色 */
export interface PaletteTheme {
	background: string;
	colors: PaletteColors;
	text: ThemeTextColors;
}

/**
 * 配色值（预设 id 或自定义十六进制）→ 一套完整色值。**两种形态的唯一分派点**。
 *
 * 预设 id 走 `normalizePalette` 兜脏值后直接取 `PALETTES` 的亮/暗档（数据即设计
 * 校核过的组合，文字色只按明暗定）；自定义值没有设计校核，故由主色派生五档、
 * 每一档的文字色按该档亮度现算。
 */
export function resolvePaletteTheme(value: string, isDark: boolean): PaletteTheme {
	const custom = customPaletteColor(value);
	if (custom) {
		const colors = deriveCustomPalette(custom, isDark);
		return {
			background: isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT,
			colors,
			// 自定义填充无法预设文字色：按每一档的亮度现算（与节点颜色同一份判定）
			text: {
				rootText: contrastTextColor(colors.rootFill),
				secondText: contrastTextColor(colors.secondFill),
				nodeText: contrastTextColor(colors.nodeFill),
			},
		};
	}
	return {
		background: isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT,
		colors: PALETTES[normalizePalette(value)][isDark ? 'dark' : 'light'],
		// 已知配色的文字色**不随配色变**，只按明暗定（设计约束见 TEXT_LIGHT 注释）
		text: isDark ? TEXT_DARK : TEXT_LIGHT,
	};
}
