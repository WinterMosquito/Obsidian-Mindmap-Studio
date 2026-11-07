/**
 * 外观数据表：**边框**（`THEME_STYLE_PRESETS`）、**整篇配色**（`PALETTES`）与
 * **节点级配色**（`NODE_COLORS` + 反查 `nodeLineColorOf`）。
 *
 * 前两张表是**纯数据、零分支**；唯一的函数 `nodeLineColorOf` 只回答「这个填充色
 * 配哪条线」（预设查表 / 自定义按同色相深一档派生），不含任何 UI 或渲染决策。
 * 与 `mindmap-theme.ts`（渲染管线）的分工：本文件只声明「长什么样」，管线负责
 * 拼装。新增一套外观 = 本文件加数据 + `core/constants` 的选项表加一条 id +
 * i18n 加中英文案，**渲染代码零改动**。
 *
 * UI 叫「边框」，内部与 `data.json` 沿用 `themeStyle`（键名发布即冻结，不改）。
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
import { hexToHsl, hslToHex } from '../domain/color';

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
	 * `core/constants.DEFAULT_THEME_STYLE`（2026-11-05 起为 `default`＝有边框）。
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
 * 2. `secondFill` / `nodeFill` 取**同色相浅档**：此前只与画布差 2%～5%，整张图
 *    看不出配色，只剩根节点一个色块；现在二级/三级能看出「这是哪一套」，但仍是
 *    浅底（深字对比 ≥ 7:1）；
 * 3. `border` 比 `secondFill` 深一档、`line` 比 `border` 深（连线 2px，太浅会
 *    在 fit 缩放下消失）；
 * 4. 亮 / 暗两档必须成对：暗色 `rootFill` 不能用亮色值（会刺眼）。
 *
 * **色值来源（2026-11-05 重做）**：九套（不含 `default`）不再各自手调，而是
 * **同一套 HSL 阶梯 + 按色相分档的饱和度**——
 * - 亮色 `L` = 46 / 90 / 96 / 82 / 55（root / second / node / border / line）；
 * - 暗色 `L` = 30 / 16 / 12 / 26 / 45；
 * - 色相：青 190、蓝 218、紫 285、绯 355、橙 30、黄 48、绿 145、灰 215、雾白 215；
 *   根的 `S` 落在 42–82 之间（绿压到 42 免发荧光、黄 82 最艳、灰 / 雾白压到
 *   9 / 5 成中性档）。
 *
 * 之前按 Tailwind 固定档位取值，各套的明度其实各不相同（teal-600 比 amber-600
 * 暗一截），**单独看没毛病、并排就显得脏**。统一明度后任意两套并置都协调；
 * 节点色（`NODE_COLORS`）另取 L84 / L50 一档（浅填充 + 深线），与整篇同一语言。
 */
export interface PaletteColors {
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
	/**
	 * 默认（蓝）：**回撤到 2026-10-29 的基准值**（2026-11-05 用户裁决）。
	 *
	 * 这套是既有观感的锚：`#4a90d9` + 近白的 `#f1f5f9 / #f8fafc`，读者已经
	 * 习惯了「一张安静的蓝图」。其余九套按统一阶梯重做，但基准这套不动。
	 */
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
	/** 青：H190，S52 */
	teal: {
		light: {
			rootFill: '#389eb2',
			secondFill: '#dfeaec',
			nodeFill: '#f3f6f6',
			border: '#c4dade',
			line: '#5cacbc',
		},
		dark: {
			rootFill: '#296470',
			secondFill: '#202f31',
			nodeFill: '#1a2223',
			border: '#344c50',
			line: '#498e9c',
		},
	},
	/** 蓝：H218，S62 —— 与青拉开色相，补上"正蓝"这一支 */
	blue: {
		light: {
			rootFill: '#2d62be',
			secondFill: '#dee3ed',
			nodeFill: '#f3f4f7',
			border: '#c1cde1',
			line: '#537dc6',
		},
		dark: {
			rootFill: '#224177',
			secondFill: '#1f2633',
			nodeFill: '#191d24',
			border: '#323e53',
			line: '#4166a4',
		},
	},
	/** 橙：H30，S78 */
	orange: {
		light: {
			rootFill: '#c87019',
			secondFill: '#efe6dc',
			nodeFill: '#f7f5f2',
			border: '#e5d1bd',
			line: '#d38c45',
		},
		dark: {
			rootFill: '#824d17',
			secondFill: '#35291c',
			nodeFill: '#261f18',
			border: '#57422e',
			line: '#b27334',
		},
	},
	/** 麦黄：H48，S82 —— 暖黄，补上"橙 → 绿"之间的空档 */
	gold: {
		light: {
			// 黄最亮：L46 时白字只有 2.11，压到 36 才够 3:1（`tests/mindmap-theme`）
			rootFill: '#a78911',
			secondFill: '#f0ecdb',
			nodeFill: '#f7f6f2',
			border: '#e6ddbc',
			line: '#d8ba41',
		},
		dark: {
			rootFill: '#856e14',
			secondFill: '#36311b',
			nodeFill: '#262317',
			border: '#584f2c',
			line: '#b49a31',
		},
	},
	/** 绯红：H355，S70 */
	crimson: {
		light: {
			rootFill: '#c72331',
			secondFill: '#eeddde',
			nodeFill: '#f7f3f3',
			border: '#e3bfc2',
			line: '#cd4c57',
		},
		dark: {
			rootFill: '#7d1c24',
			secondFill: '#341d1f',
			nodeFill: '#251819',
			border: '#553033',
			line: '#ab3b44',
		},
	},
	/** 紫：H285，S55 */
	purple: {
		light: {
			rootFill: '#9635b6',
			secondFill: '#e9deed',
			nodeFill: '#f6f3f7',
			border: '#d8c3df',
			line: '#a55abf',
		},
		dark: {
			rootFill: '#602673',
			secondFill: '#2d2032',
			nodeFill: '#211924',
			border: '#4a3451',
			line: '#8946a0',
		},
	},
	/** 绿：H145，S42（绿色高饱和会发荧光，刻意压低） */
	green: {
		light: {
			rootFill: '#419f68',
			secondFill: '#e0ebe5',
			nodeFill: '#f3f6f5',
			border: '#c7dccf',
			line: '#65b386',
		},
		dark: {
			rootFill: '#2f6a48',
			secondFill: '#223028',
			nodeFill: '#1b231e',
			border: '#374e40',
			line: '#51946d',
		},
	},
	/** 银灰：H215，S9——冷灰（带一点蓝），中性降噪档 */
	grey: {
		light: {
			rootFill: '#6b7480',
			secondFill: '#e4e5e7',
			nodeFill: '#f4f5f5',
			border: '#cfd1d3',
			line: '#848b94',
		},
		dark: {
			rootFill: '#464b53',
			secondFill: '#27292a',
			nodeFill: '#1e1e20',
			border: '#404245',
			line: '#6c727a',
		},
	},
	/**
	 * 雾白：中性无彩（S≈5），一级底色就是用户指定的 `#E7E8EA`。
	 *
	 * 与「银灰」的分工：银灰是**带蓝的冷灰**（H215/S9），雾白是**纯中性**
	 * （#E7E8EA 的灰），放在一起能看出一个是"冷"、一个是"灰"。
	 */
	mist: {
		light: {
			rootFill: '#71767e',
			secondFill: '#e7e8ea',
			nodeFill: '#f3f4f5',
			border: '#d4d6d9',
			line: '#9aa0a8',
		},
		dark: {
			rootFill: '#4a4e55',
			secondFill: '#26282b',
			nodeFill: '#1d1e20',
			border: '#3b3e43',
			line: '#6f757d',
		},
	},
};

/**
 * 节点级配色的**填充 / 线条**成对表（2026-11-05 实机定色）。
 *
 * 与 `PALETTES` 的分工：`PALETTES` 管"整篇方案"（根 / 一 / 二级的层级色），
 * 本表只管**用户点给某个节点的那个色**。二者色相一致、明度分工不同：
 *
 * - `fill` 是写进正文的 `%%#hex%%`，也是画布上的填充——**柔和浅色**。中深色
 *   铺满整支会变成一片实色块（2026-11-05 实机：6 个分支的深紫/深绿/深橙
 *   并排，像六张色卡压在一起），浅色大面积铺开才不刺眼，深字对比 ≥ 9:1；
 * - `line` 是同色相深一档，只用于**连线与描边**——细线面积小，由它承担
 *   「这是哪一支」的识别度（浅色线在 fit 缩放下几乎消失，实机已验证）。
 *
 * 因此「写的颜色 = 填充色」这条契约不变：用户设的是 `fill`，屏幕上的块就是
 * `fill`；`line` 是同一个色的深档，不是另一种颜色。自定义 hex 不在表里，但
 * `nodeLineColorOf` 会按同一比例现算深档（**不**原样返回：浅色输入配同色线，
 * 在 fit 缩放下等于没有结构线）。
 */
export const NODE_COLORS: Record<PaletteId, { fill: string; line: string }> = {
	/** 默认蓝（节点菜单不列它，类型上必须有） */
	default: { fill: '#a8c7f0', line: '#4a90d9' },
	teal: { fill: '#c8e0e5', line: '#44a7bb' },
	blue: { fill: '#c5d2e8', line: '#386cc7' },
	purple: { fill: '#dec6e6', line: '#9f40bf' },
	orange: { fill: '#edd6c0', line: '#d98026' },
	gold: { fill: '#ede4bf', line: '#deb821' },
	crimson: { fill: '#eac2c6', line: '#d02f3d' },
	green: { fill: '#cae2d4', line: '#4fb077' },
	grey: { fill: '#d4d6d9', line: '#757e8a' },
	/** 雾白：填充就是用户指定的 `#E7E8EA` */
	mist: { fill: '#e7e8ea', line: '#71767e' },
};

/**
 * 填充色 → 线条色的**反查表**（模块加载时建一次）。
 *
 * 为什么不是每次 `Object.values(NODE_COLORS).find(...)`：`nodeLineColorOf` 在
 * `node_tree_render_end` 里**逐节点**被 `engine/mindmap-colors` 调用，而
 * `Object.values` 每次都会新建一个 10 项数组。表只有 10 条，建一次即可。
 */
const LINE_BY_FILL = new Map<string, string>(
	Object.values(NODE_COLORS).map((pair) => [pair.fill, pair.line]),
);

/**
 * 节点填充色 → 配套线条色。
 *
 * 两条路径：
 * 1. **预设色**：表里有精确配对，直接取（浅填充 L84 / 深线 L50 是设计值）；
 * 2. **自定义 hex**：同色相**深一档**（`S×0.9`、`L×0.6`，L 下限 22）。
 *    早先这里原样返回 → 自定义节点是自己和自己的线同色，浅色输入（`#c5d2e8`
 *    这种）线几乎看不见，深色输入又糊成一块，与预设「浅底 + 深线」完全两种观感
 *    （2026-11-05 用户指出：节点自定义未跟预设对齐）。
 *
 * 反查而不是让调用方多传一个参数：正文里只有一个 hex（`%%#hex%%`），
 * `engine/mindmap-colors` 拿到的也只有它。
 */
export function nodeLineColorOf(fill: string): string {
	const key = fill.trim().toLowerCase();
	const matched = LINE_BY_FILL.get(key);
	if (matched) {
		return matched;
	}
	const hsl = hexToHsl(key);
	if (!hsl) {
		return key;
	}
	// 与预设同一比例：填充 L84 → 线条 L50（约 ×0.6）；下限 22 防止深色输入变纯黑
	return hslToHex(hsl.h, hsl.s * 0.9, Math.max(hsl.l * 0.6, 22));
}
