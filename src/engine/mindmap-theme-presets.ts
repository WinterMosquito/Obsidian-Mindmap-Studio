/**
 * 边框（节点外观风格）数据表 —— **纯数据，不含任何分支逻辑**。
 *
 * UI 叫「边框」，内部与 `data.json` 沿用 `themeStyle`（键名发布即冻结，不改）。
 * 与 `mindmap-theme.ts`（渲染管线）的分工：本文件只声明「每种边框长什么样」，
 * 管线只负责把它合并进色板。新增一种 = 本表加一条 + `core/constants` 的
 * `THEME_STYLE_OPTIONS` 加一条 id + i18n 加一对中英文案，**渲染代码零改动**。
 *
 * 硬约束：
 * 1. **只能覆盖节点填充 / 描边宽度**——字号、间距、连线样式各由 `variant` 单一来源
 *    表达，边框越权会与「主题色 / 布局 / 连线偏好」三方打架；
 * 2. 与「主题色」（明暗）**正交**：本表不写死任何色板色值——「不绘制」由
 *    `fillColor: 'transparent'` 与 `borderWidth: 0` 表达，颜色一律沿用色板；
 * 3. **不提供 `borderColor` 覆盖位**（类型层面就没有这个键，见下）：描边色必须
 *    始终是色板真色——小地图拿它当节点墨色（`engine/mindmap-minimap.readInk`），
 *    写成 `transparent` 会让无边框下的缩略图节点块整片消失（2026-10-25 实机）；
 * 4. `Record<ThemeStyleId, …>` 把本表绑死到选项表：新增 id 而漏写外观（或反之）
 *    直接编译失败，杜绝「选项存在但渲染无感」的静默退化；
 * 5. id 发布即冻结——它会写进 `data.json`，改名等于让用户的设置失效。
 */
import type { PaletteId, ThemeStyleId } from '../core/constants';

/**
 * 边框可覆盖的节点外观键（其余键一律沿用主题色板）。
 *
 * 刻意**没有** `borderColor`：它表达「若要描边用什么颜色」，与「是否描边」
 * （`borderWidth`）是两件事，且缩略图的节点墨色依赖它保持真色。做成类型约束
 * 而不是只写在注释里——日后想给某个边框调描边色时，编译期就会拦下这个念头。
 */
interface ThemeNodeOverride {
	fillColor?: string;
	borderWidth?: number;
}

/** 按层级声明覆盖；未列出的层级/键一律沿用主题色板 */
interface ThemeStylePreset {
	root?: ThemeNodeOverride;
	second?: ThemeNodeOverride;
	node?: ThemeNodeOverride;
}

/**
 * 无边框节点的共同外观：**填充透明 + 描边宽度归零**，描边色沿用色板。
 *
 * 为什么填充也要去：只去描边会留一层淡灰底——亮色下 second 的 `#f1f5f9` 与画布
 * `#ffffff` 仅差 2%，肉眼仍看得出灰块；暗色下 node 的 `#1e1e1e` 本就与画布同色。
 * 置 `transparent` 后暗色观感与改造前完全一致，亮色下才真正干净。
 *
 * `Object.freeze`：second / node 两级**共用这一份声明**（浅冻结）。某一级要单独
 * 调整就新建对象——就地改会让两级一起漂移，且冻结会在写入时直接抛错。
 */
const BORDERLESS_NODE: ThemeNodeOverride = Object.freeze({
	fillColor: 'transparent',
	borderWidth: 0,
});

export const THEME_STYLE_PRESETS: Record<ThemeStyleId, ThemeStylePreset> = {
	/**
	 * 有边框：完全沿用色板。
	 *
	 * id 仍是 `default`（发布即冻结）——它**不代表出厂默认**，出厂默认见
	 * `core/constants.DEFAULT_THEME_STYLE`（`borderless`）。
	 */
	default: {},
	/**
	 * 无边框：second / node 填充透明 + 描边宽度归零；root 保持主题色填充作视觉
	 * 锚点（root 本就不描边，中心主题也不宜失去锚点）。
	 */
	borderless: {
		second: BORDERLESS_NODE,
		node: BORDERLESS_NODE,
	},
};

/**
 * 配色（色相方案）——同样**只放数据、零分支**。
 *
 * 每套只给 5 个「填充 / 线」色：`rootFill` / `secondFill` / `nodeFill` /
 * `border` / `line`。**文字色不在此表**（三档共用、按明暗定，见
 * `mindmap-theme.ts` 的 `TEXT_LIGHT` / `TEXT_DARK`）——这样新增配色只需
 * 5 个 hex，且不会因某套配色的浅色底配错深字而不可读。
 *
 * 设计约束（新增配色照此校验）：
 * 1. `rootFill` 必须是中深色——它承载反白字（对比度 ≥ 3:1，加粗大字可读）；
 * 2. `secondFill` / `nodeFill` 与画布底色只差 2%～5%（亮色近白、暗色近背景）；
 * 3. `border` 比 `secondFill` 深一档、`line` 比 `border` 浅一档——层级递减；
 * 4. 亮 / 暗两档必须成对：暗色 `rootFill` 不能用亮色值（会刺眼）。
 */
interface PaletteColors {
	rootFill: string;
	secondFill: string;
	nodeFill: string;
	border: string;
	line: string;
}

/** 每套配色必须给出亮 / 暗两档（暗色不能复用亮色的 root，会刺眼） */
interface PalettePair {
	light: PaletteColors;
	dark: PaletteColors;
}

export const PALETTES: Record<PaletteId, PalettePair> = {
	/** 默认（蓝）：本特性引入前的基准（与改造前逐值一致） */
	default: {
		light: {
			rootFill: '#4a90d9',
			secondFill: '#f1f5f9',
			nodeFill: '#f8fafc',
			border: '#cbd5e1',
			line: '#94a3b8',
		},
		dark: {
			rootFill: '#2d2d2d',
			secondFill: '#252525',
			nodeFill: '#1e1e1e',
			border: '#3f3f3f',
			line: '#4a4a4a',
		},
	},
	/** 薄荷：青绿低饱和 */
	mint: {
		light: {
			rootFill: '#2e9e8f',
			secondFill: '#eaf7f4',
			nodeFill: '#f5fbfa',
			border: '#bfe3dc',
			line: '#93c9bf',
		},
		dark: {
			rootFill: '#1f5c54',
			secondFill: '#1b2a28',
			nodeFill: '#16211f',
			border: '#2f4a45',
			line: '#3e5f59',
		},
	},
	/** 琥珀：暖橙棕 */
	amber: {
		light: {
			rootFill: '#c2761a',
			secondFill: '#fdf3e6',
			nodeFill: '#fffaf2',
			border: '#ebd3ae',
			line: '#d2b084',
		},
		dark: {
			rootFill: '#7a4a12',
			secondFill: '#2a2118',
			nodeFill: '#1f1a14',
			border: '#4a3b29',
			line: '#5e4c36',
		},
	},
	/** 紫藤：偏亮的蓝紫 */
	wisteria: {
		light: {
			rootFill: '#7c5cd6',
			secondFill: '#f3effc',
			nodeFill: '#faf8fe',
			border: '#d8ccf2',
			line: '#b8a6e0',
		},
		dark: {
			rootFill: '#4a3a7a',
			secondFill: '#241f33',
			nodeFill: '#1b1826',
			border: '#3b3352',
			line: '#4f4470',
		},
	},
	/** 森林：深绿稳重 */
	forest: {
		light: {
			rootFill: '#2f7d5a',
			secondFill: '#e9f5ef',
			nodeFill: '#f5faf7',
			border: '#c2e0d0',
			line: '#94c2ac',
		},
		dark: {
			rootFill: '#20563d',
			secondFill: '#1b2620',
			nodeFill: '#151d18',
			border: '#2c4237',
			line: '#3b5647',
		},
	},
	/** 石板：降噪灰蓝（second / node 与蓝相同，只换 root 与线） */
	slate: {
		light: {
			rootFill: '#475569',
			secondFill: '#f1f5f9',
			nodeFill: '#f8fafc',
			border: '#cbd5e1',
			line: '#94a3b8',
		},
		dark: {
			rootFill: '#3a4048',
			secondFill: '#252525',
			nodeFill: '#1e1e1e',
			border: '#3f3f3f',
			line: '#4a4a4a',
		},
	},
};
