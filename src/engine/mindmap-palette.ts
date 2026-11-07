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
import {
	normalizeCustomPaletteColor,
	normalizePalette,
} from '../core/constants';
import type { PaletteId } from '../core/constants';
import { contrastTextColor, hexToHsl, hslToHex } from '../domain/color';
import {
	NODE_COLORS,
	PALETTES,
	type PaletteColors,
} from './mindmap-theme-presets';

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
 * 双链文档自绘图标（节点前缀内容）的描边色：与**当前配色**同源，
 * 避免在 mindmap.ts 里手写色值。亮色用该配色的根节点主色，暗色用 nodeText 中性灰
 * （暗色下各配色的 rootFill 都很深，拿它当图标色会看不见）。
 *
 * 自定义整篇配色（值本身是十六进制）没有「四档明暗」之分：图标直接用该色
 * （暗色也用——用户选的就是这个色相，回退到中性灰会让图标与整篇脱节）。
 */
export function getDocIconColor(isDark: boolean, palette: string): string {
	const custom = normalizeCustomPaletteColor(palette);
	if (custom) {
		return custom;
	}
	return isDark
		? TEXT_DARK.nodeText
		: PALETTES[normalizePalette(palette)].light.rootFill;
}

/**
 * 节点级配色菜单里「某一套配色」对应的**填充色**：取 `NODE_COLORS[id].fill`
 * （2026-11-05 起与整篇的 `rootFill` 分开——那个是根节点用的中深色，铺满整支
 * 会变成一片实色块，实机已验证难看）。
 *
 * 它既是写进文件的 hex，也是**画布上的填充色本体**（`nodeColorScale` 只补
 * 文字色）。菜单用这个 hex 与正文里的指令做等值比较（勾选态），所以必须是
 * **写进文件的那一个值**；配套的深色线条由 `NODE_COLORS` 的 `line` 给。
 *
 * 这是「配色 → 节点填充色」的唯一定义：新增配色时菜单自动多一项，勿在菜单层
 * 手抄色值。
 */
export function paletteNodeColor(palette: PaletteId): string {
	return NODE_COLORS[palette].fill;
}

/**
 * 自定义整篇配色（值 = 一个十六进制）→ 五档色板。
 *
 * **与预设走同一套明度阶梯**，只把色相与饱和度从用户色带过来：
 * - 亮色 `L` = 90 / 96 / 82 / 55（second / node / border / line），`S` 缩放
 *   0.5 / 0.3 / 0.55 / 0.8；
 * - 暗色 `L` = 16 / 12 / 26 / 45，`S` 缩放 0.4 / 0.3 / 0.4 / 0.7（暗档本色域窄，
 *   缩得少一点才看得出色相）；
 * - 根节点就是用户色本身（`rootFill` = 该十六进制）。
 *
 * 早先按「向画布底混 86% / 93% / 50% / 35%」派生，同一色走两条路径得到两种观感
 * （2026-11-05 实机对照，拿 `#2d62be` 分别走预设「湛蓝」与自定义）：
 * 描边比预设深一档（`#96b1df` vs `#c1cde1`）、连线反而更浅（`#7799d5` vs
 * `#537dc6`，比自己的描边还浅，结构感倒挂）、二级文字也更黑（按亮度算成
 * `#1e293b`，预设是柔和的 `#64748b`）。用户说的「自定义样式不一样」就是这三处。
 *
 * 混白只能调明度、会顺带冲掉饱和度；HSL 改 L 保 S 才是「同一个色的浅档」。
 */
function deriveCustomPalette(hex: string, isDark: boolean): PaletteColors {
	const hsl = hexToHsl(hex) ?? { h: 0, s: 0, l: 0 };
	const step = (lightness: number, saturationScale: number): string =>
		hslToHex(hsl.h, hsl.s * saturationScale, lightness);
	return isDark
		? {
				rootFill: hex,
				secondFill: step(16, 0.4),
				nodeFill: step(12, 0.3),
				border: step(26, 0.4),
				line: step(45, 0.7),
			}
		: {
				rootFill: hex,
				secondFill: step(90, 0.5),
				nodeFill: step(96, 0.3),
				border: step(82, 0.55),
				line: step(55, 0.8),
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
 * 校核过的组合，文字色只按明暗定）；自定义值由主色按**同一套明度阶梯**派生五档，
 * 二级 / 三级文字色也沿用预设那组固定值（浅档上的深字，观感因此一致）——只有
 * **根节点**的文字色必须现算：用户可以给任意色，浅底色上白字会看不见。
 */
export function resolvePaletteTheme(value: string, isDark: boolean): PaletteTheme {
	const custom = normalizeCustomPaletteColor(value);
	if (custom) {
		const colors = deriveCustomPalette(custom, isDark);
		const presetText = isDark ? TEXT_DARK : TEXT_LIGHT;
		return {
			background: isDark ? BACKGROUND_DARK : BACKGROUND_LIGHT,
			colors,
			text: {
				rootText: contrastTextColor(colors.rootFill),
				secondText: presetText.secondText,
				nodeText: presetText.nodeText,
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
