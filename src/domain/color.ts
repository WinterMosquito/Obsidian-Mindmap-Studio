/**
 * 颜色值解析、换算、亮度计算与继承遍历（纯逻辑，零依赖）。
 *
 * 服务对象：节点配色指令 `%%#89CFF0%%`（`features/node-inline-tokenize` 解析、
 * `engine/mindmap-colors` 落地）、「自定义」入口的人类输入（`parseColorInput`）、
 * 自定义整篇配色（`engine/mindmap-palette.deriveCustomPalette` 用 `mixHex` 派生
 * 五档）、**节点色阶**（`nodeColorScale`：指令色 → 填充 / 文字；结构线另有出处，
 * 见 `engine/mindmap-theme-presets.nodeLineColorOf`）与着色
 * 节点的内容色阶（`nodeContentTones`）。都是可直测的纯计算，故放 domain。
 */

/** 合法的十六进制颜色（三/六位，必须带 `#`）→ 归一 `#rrggbb`（小写） */
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * 「不跟随上层」哨兵：注释段内容恰为 `none`（正文写 `%%none%%`）时，该节点**显式**
 * 没有节点色，并阻断祖先颜色下传——继承链上的一个**空层**。
 *
 * 没有它，彩色子树里的单个节点无法脱色：删指令＝无事发生（父色照旧继承）。落地上
 * 读到它就是「无自定义颜色」（删四个样式键、回落主题），后代拿到的是 null。
 *
 * 归一在 `features/node-inline-tokenize`（外壳空白与大小写宽容：`%% None %%`），
 * 但必须**裸**写——`%%#none%%` 不是指令（仍按普通注释隐藏）。
 */
export const COLOR_DIRECTIVE_NONE = 'none';

/**
 * `rgb(137, 207, 240)` 形态。
 *
 * 刻意**不接受** `rgba(…)`：带 alpha 的颜色落到节点上无法确定文字对比色，
 * 而十六进制侧同样拒绝 4/8 位（两边口径一致）；需要透明度请先换算成实色。
 */
const RGB_FUNCTION_RE = /^rgb\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)$/i;
/** 裸三元组：`137, 207, 240`（逗号或空白分隔） */
const RGB_TRIPLE_RE = /^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/;

/**
 * 归一十六进制颜色：`#89CFF0` → `#89cff0`，`#0aF` → `#00aaff`；
 * 非「`#` + 3/6 位十六进制」一律返回 null（含 4/8 位带 alpha 形态——
 * 透明度会让文字对比度失去唯一答案，故不接受）。
 */
export function normalizeHexColor(value: string): string | null {
	const match = HEX_COLOR_RE.exec(value.trim());
	if (!match) {
		return null;
	}
	const body = match[1]!.toLowerCase();
	const full =
		body.length === 3
			? body
					.split('')
					.map((char) => char + char)
					.join('')
			: body;
	return `#${full}`;
}

/**
 * 解析**人类输入**的颜色：十六进制（`#89CFF0` / `89CFF0` / `#0af`）或 RGB
 * （`137, 207, 240` / `137 207 240` / `rgb(137,207,240)`）→ `#rrggbb`。
 *
 * 与 `normalizeHexColor` 的分工：后者只认「`#` + 3/6 位」（写进 Markdown 的
 * 严格形态，`%%89CFF0%%` 不算指令）；本函数是「自定义」输入框的宽容入口，
 * 缺 `#`、写成 RGB、包 `rgb()` 都收——**最终写进文件的仍是归一后的 `#rrggbb`**。
 * 非法值（越界 256、缺通道、带 alpha 的十六进制）返回 null。
 */
export function parseColorInput(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const hex = normalizeHexColor(
		trimmed.startsWith('#') ? trimmed : `#${trimmed}`,
	);
	if (hex) {
		return hex;
	}
	const match = RGB_FUNCTION_RE.exec(trimmed) ?? RGB_TRIPLE_RE.exec(trimmed);
	if (!match) {
		return null;
	}
	// 两个正则都限定了 `\d{1,3}`，故只需把住上界（`256, 0, 0` 这类越界值）
	const channels = [match[1], match[2], match[3]].map((part) => Number(part));
	if (channels.some((channel) => channel > 255)) {
		return null;
	}
	return `#${channels
		.map((channel) => channel.toString(16).padStart(2, '0'))
		.join('')}`;
}

/**
 * 两色线性混合：`ratioTo` = 混入 `to` 的比例（0 → `from`，1 → `to`）。
 *
 * 用途：自定义整篇配色从一个主色派生五档（越浅的层级越靠近画布底色，
 * 见 `engine/mindmap-palette.deriveCustomPalette`）。入参非法时原样返回 `from`
 * ——派生失败不该让整篇渲染中断。
 */
export function mixHex(from: string, to: string, ratioTo: number): string {
	const a = normalizeHexColor(from);
	const b = normalizeHexColor(to);
	if (!a || !b) {
		// `from` 能归一就交归一值（调用方拿到的恒是 `#rrggbb`），否则原样返回
		return a ?? from;
	}
	const ratio = Math.min(1, Math.max(0, ratioTo));
	const mix = (start: number): string => {
		const left = Number.parseInt(a.slice(start, start + 2), 16);
		const right = Number.parseInt(b.slice(start, start + 2), 16);
		return Math.round(left * (1 - ratio) + right * ratio)
			.toString(16)
			.padStart(2, '0');
	};
	return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/**
 * `#rrggbb` → HSL（H 0–360、S / L 0–100）；非法输入返回 null。
 *
 * 用途：自定义整篇配色要**只改明度、保留色相**（见
 * `engine/mindmap-palette.deriveCustomPalette`），混白会把饱和度一起冲掉。
 */
export function hexToHsl(
	hex: string,
): { h: number; s: number; l: number } | null {
	const color = normalizeHexColor(hex);
	if (!color) {
		return null;
	}
	const r = Number.parseInt(color.slice(1, 3), 16) / 255;
	const g = Number.parseInt(color.slice(3, 5), 16) / 255;
	const b = Number.parseInt(color.slice(5, 7), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const lightness = (max + min) / 2;
	const delta = max - min;
	if (delta === 0) {
		return { h: 0, s: 0, l: lightness * 100 };
	}
	const saturation = delta / (1 - Math.abs(2 * lightness - 1));
	let hue: number;
	if (max === r) {
		hue = ((g - b) / delta) % 6;
	} else if (max === g) {
		hue = (b - r) / delta + 2;
	} else {
		hue = (r - g) / delta + 4;
	}
	hue *= 60;
	return {
		h: hue < 0 ? hue + 360 : hue,
		s: saturation * 100,
		l: lightness * 100,
	};
}

/** HSL（H 0–360、S / L 0–100）→ `#rrggbb`；S / L 会被夹到合法区间 */
export function hslToHex(h: number, s: number, l: number): string {
	const hue = ((h % 360) + 360) % 360;
	const saturation = Math.min(100, Math.max(0, s)) / 100;
	const lightness = Math.min(100, Math.max(0, l)) / 100;
	const k = (n: number): number => (n + hue / 30) % 12;
	const a = saturation * Math.min(lightness, 1 - lightness);
	const channel = (n: number): number =>
		lightness -
		a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	const toHex = (value: number): string =>
		Math.round(value * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${toHex(channel(0))}${toHex(channel(8))}${toHex(channel(4))}`;
}

/**
 * **自定义整篇配色**的三档文字色：浅底用深字、深底用白字。
 *
 * 深字取亮色主题的正文色 `#1e293b`（与 `mindmap-palette.TEXT_LIGHT.secondText`
 * 同族，自定义方案与已知配色的观感因此一致）。已知配色的文字色仍按明暗三档
 * ——那是设计校核过的组合，不进本判定。
 *
 * 与 `nodeInkColor` 的分工（两个判定各有各的达标线，**勿合并**）：本函数只有
 * 「浅底 / 深底」一刀切，服务于整篇色板的三个层级；`nodeInkColor` 服务**单个
 * 节点**的自定义填充，判据是「首选柔和墨色够不够 4.5」——它要保住浅色节点上
 * 不刺眼，故不是纯阈值二分。
 */
const TEXT_ON_LIGHT_FILL = '#1e293b';
const TEXT_ON_DARK_FILL = '#ffffff';

/** 判定「浅底」的相对亮度阈值（`#89cff0` ≈ 0.56 → 深字） */
const LIGHT_FILL_LUMINANCE = 0.5;

/** 按填充色亮度选深/浅文字色（**整篇配色**的三档用；节点单色的墨色见 `nodeInkColor`） */
export function contrastTextColor(fill: string): string {
	return relativeLuminance(fill) > LIGHT_FILL_LUMINANCE
		? TEXT_ON_LIGHT_FILL
		: TEXT_ON_DARK_FILL;
}

/** sRGB 单通道线性化（WCAG 2.x 定义） */
function linearize(channel: number): number {
	return channel <= 0.04045
		? channel / 12.92
		: ((channel + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 相对亮度（0 = 纯黑，1 = 纯白）。
 *
 * 内部先归一（三位缩写、大小写都收）；归一失败按 0（纯黑）返回——宁可把非法
 * 颜色当最暗，也不让 `NaN` 流进 `contrastRatio` 的阈值比较（那里 NaN 恒不满足
 * `>=`，会静默选中错误的文字色）。
 */
export function relativeLuminance(color: string): number {
	const hex = normalizeHexColor(color);
	if (!hex) {
		return 0;
	}
	const channel = (start: number): number =>
		linearize(Number.parseInt(hex.slice(start, start + 2), 16) / 255);
	return (
		0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
	);
}

/**
 * WCAG 对比度（1–21）。入参应是 `normalizeHexColor` 归一后的颜色。
 */
export function contrastRatio(a: string, b: string): number {
	const x = relativeLuminance(a);
	const y = relativeLuminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * 节点墨色的**首选**柔和深灰蓝（与整篇观感同族）。
 *
 * 判据是「首选够不够 4.5」而不是「三者谁对比度最大」：`#89cff0` 上纯黑有 12.2、
 * 柔和色也有 9.9，取最大会把所有浅色节点都写成刺眼的纯黑。顺序因此是：
 * **首选 ≥ 4.5 → 用它；否则在纯黑/纯白里取对比度更大的那个**。
 * 纯黑/纯白的最大对比度恒 ≥ 4.58（最差是中间调），故任意自定义色都有 4.5 答案。
 */
const NODE_INK_PREFERRED = '#111827';

/**
 * 节点色阶：`%%#hex%%` 的**原色** → 填充 / 文字两档。
 *
 * ## 写的颜色就是画布上的填充色（2026-11-04 用户裁决）
 * 早先把指令色当「色相锚」、填充洗成 16% 的浅色（2026-10-29 方案），换来的是
 * **写的和显示的对不上**：选 `#2e9e8f` 得到 `#deefed`，看着像没生效（「显示不
 * 清楚是我们设定的颜色不合理，而不是颜色的问题」）。现在直出——颜色不合适当场
 * 换色板，不在渲染期偷偷加工。
 *
 * ## 两档
 * - `fill`：就是这个色；
 * - `ink`：`nodeInkColor(fill)` —— 深底白字、浅底柔和深字，按填充亮度现算，
 *   任何 hex 都有 ≥4.5 的文字（最差退纯黑/纯白）。
 *
 * **结构线（连线 / 描边）不在这里**：那是「同色相深一档」，需要预设配对表
 * （`engine/mindmap-theme-presets.NODE_COLORS` + `nodeLineColorOf`）。把它塞进
 * domain 只能是「线 = 填充」这一种退化答案，与画布上的实际取色相反——2026-11-06
 * 审核删掉了这个字段（留着就是第二份「线是什么」的定义）。
 *
 * **不读主题**：写进文件的实色不随明暗变（既有口径），深色主题下同一份文件
 * 得到同一组颜色。
 */
export interface NodeColorScale {
	fill: string;
	ink: string;
}

/**
 * 原色 → 两档色阶（节点填充与文字的**唯一**派生点）。
 *
 * 入参是归一后的 `#rrggbb`（脏值兜底为柔和墨色，保证永不返回非法值）。
 * `lineColor` / `borderColor` 由 `engine/mindmap-colors` 经 `nodeLineColorOf`
 * 取（预设查表 / 自定义按同色相深一档），本函数不参与。
 */
export function nodeColorScale(base: string): NodeColorScale {
	const color = normalizeHexColor(base) ?? NODE_INK_PREFERRED;
	return { fill: color, ink: nodeInkColor(color) };
}

/** 节点正文墨色（节点级配色专用）：首选柔和色，不达标才退纯黑/纯白 */
export function nodeInkColor(fill: string): string {
	const background = normalizeHexColor(fill);
	if (!background) {
		return NODE_INK_PREFERRED;
	}
	if (contrastRatio(NODE_INK_PREFERRED, background) >= 4.5) {
		return NODE_INK_PREFERRED;
	}
	return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
		? '#000000'
		: '#ffffff';
}

/**
 * 着色节点内「轻渲染」的派生色（码块 / 表头 / 表格线共用）。
 *
 * - `ink`：正文墨色（`nodeInkColor`）；
 * - `chip`：码块与表头底色——从节点底色**朝远离墨色的方向**偏 12%：
 *   深底变暗、浅底变亮，文字与底色因此始终拉开；偏完仍不到 `CHIP_MIN_CONTRAST`
 *   （1.12）时改朝墨色偏 10% 兜底——判据是**实际达成的阶差**，不是亮度阈值：
 *   色阶落地后填充恒在 L*≈92，朝白偏 12% 只有 1.01–1.05，等于没偏；
 * - `border`：表格线（45% 墨色混入底色），在任意底色上都能看出网格。
 *
 * 三者都只依赖节点底色与墨色，不读主题变量——导出 SVG 与屏幕因此同一份字面量。
 */
export interface NodeContentTones {
	readonly ink: string;
	readonly chip: string;
	readonly border: string;
}

/** 码块与底色的最小可见阶差（WCAG 比值；1.12 ≈ 一眼能看出「这里有一块」） */
const CHIP_MIN_CONTRAST = 1.12;
/** 朝「背离墨色」方向偏的比例（深底提亮 / 浅底压暗） */
const CHIP_SHIFT = 0.12;
/** 已贴边时的反向兜底：朝墨色偏，保证码块仍有一块可辨的底 */
const CHIP_SHIFT_TOWARD_INK = 0.1;
/** 表格线与表格外框的墨色比例（45% 起步；深底上不够时按步进加深，见 `tableLineTone`） */
const BORDER_INK_MIX = 0.45;
/** 表格线与底色的最小对比（结构线索，宁可重一点也不该消失） */
const TABLE_LINE_MIN_CONTRAST = 2;
/** 深底兜底的最大墨色比例（再深就等于把网格画成实线） */
const TABLE_LINE_MAX_MIX = 0.7;

/**
 * 表格线 / 外框色：45% 墨色起步，**深底上按 5% 步进加深到 ≥2:1**。
 *
 * 固定 45% 在浅底上够用，但节点色直出后底色普遍变深（2026-11-05 新色板的
 * `#e11d48` 实测只有 1.88:1），网格线会糊成一片。判据是**实际达成的对比**，
 * 不是亮度阈值——与 `nodeContentTones` 里 chip 的兜底同一思路。
 */
function tableLineTone(background: string, ink: string): string {
	let mix = BORDER_INK_MIX;
	let color = mixHex(background, ink, mix);
	while (
		mix < TABLE_LINE_MAX_MIX &&
		contrastRatio(color, background) < TABLE_LINE_MIN_CONTRAST
	) {
		mix += 0.05;
		color = mixHex(background, ink, mix);
	}
	return color;
}

/**
 * 派生色阶缓存（2026-11-04 性能批，见 nodeContentTones 的说明）。
 *
 * 键是**归一后**的 `#rrggbb`（`#89CFF0` / `#89cff0` / `#8cf` 共用一条）：节点填充
 * 只有「整篇配色五档 + 节点级主色混白」少数几种，命中率接近 100%。
 * 条目数上限防御脏数据；LRU 提升与 `features/node-inline-tokenize` 的段缓存同口径。
 */
const CONTENT_TONES_CACHE_MAX = 64;
const contentTonesCache = new Map<string, NodeContentTones>();

/**
 * 着色节点内的内容色阶（码块 / 表头 / 网格线）。返回值**共享且只读**——调用方
 * 不得原地修改（`NodeContentTones` 的字段均为 readonly）。
 *
 * 缓存理由（2026-11-04 实测）：单次 ≈2.36 µs（正则 + 两次对比度 + 两次混色），
 * 而每个自绘节点在「首帧前预测量」与「正式内容构建」各读一次——5000 节点全着色图
 * 单次打开约 1 万次同值重算（≈24 ms），节点拖宽 / 字体重测还会再付。
 */
export function nodeContentTones(fill: string): NodeContentTones {
	const background = normalizeHexColor(fill) ?? '#ffffff';
	const cached = contentTonesCache.get(background);
	if (cached) {
		// LRU 提升：删后重插 → 回到队尾
		contentTonesCache.delete(background);
		contentTonesCache.set(background, cached);
		return cached;
	}
	const ink = nodeInkColor(background);
	// 码块要与底色拉开，方向必须**背离墨色**（白墨→压暗、黑墨→提亮）
	const awayFromInk = ink === '#ffffff' ? '#000000' : '#ffffff';
	const lifted = mixHex(background, awayFromInk, CHIP_SHIFT);
	const tones: NodeContentTones = {
		ink,
		chip:
			contrastRatio(lifted, background) >= CHIP_MIN_CONTRAST
				? lifted
				: mixHex(background, ink, CHIP_SHIFT_TOWARD_INK),
		border: tableLineTone(background, ink),
	};
	while (contentTonesCache.size >= CONTENT_TONES_CACHE_MAX) {
		const oldest = contentTonesCache.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		contentTonesCache.delete(oldest);
	}
	contentTonesCache.set(background, tones);
	return tones;
}

/**
 * 一条指令的**生效值**：哨兵折 null（＝无自定义颜色），其余原样。
 *
 * 全仓只有这里把哨兵翻成 null——两条继承路径（遍历 / 往上看）都经它。
 */
function effectiveDirective(directive: string | null): string | null {
	return directive === COLOR_DIRECTIVE_NONE ? null : directive;
}

/**
 * 「就近覆盖」的配色继承遍历（先序，显式栈）。
 *
 * 与 `domain/tree.walkTree` 的分工：后者**不携带祖先状态**，本函数是唯一需要
 * 「继承值」的场景（节点的颜色 = 自身指令 ?? 最近祖先的指令）。勿在渲染层或
 * 解析层另写一份继承判定。
 *
 * @param root         树根（data 树或引擎渲染节点树均可：只要求 `children` 同构）
 * @param readDirective 读节点自身的配色指令（`#rrggbb` / 哨兵 `none` / null = 未写）
 * @param apply        写入节点最终生效颜色（null = 无自定义颜色，应清空覆盖）
 */
export function walkColorDirectives<T extends { children?: readonly T[] | null }>(
	root: T,
	readDirective: (node: T) => string | null,
	apply: (node: T, color: string | null) => void,
): void {
	const stack: Array<{ node: T; inherited: string | null }> = [
		{ node: root, inherited: null },
	];
	while (stack.length > 0) {
		const { node, inherited } = stack.pop()!;
		// 没写指令才继承上层；哨兵折 null 后**不再回落到 inherited**，
		// 既「自己回落主题」，也「不让祖先色传给后代」
		const own = readDirective(node);
		const color = own === null ? inherited : effectiveDirective(own);
		apply(node, color);
		const children = node.children;
		if (children) {
			// 逆序压栈使出栈顺序与 children 原顺序一致（与 walkTree 同口径）
			for (let index = children.length - 1; index >= 0; index--) {
				stack.push({ node: children[index]!, inherited: color });
			}
		}
	}
}

/**
 * 节点**从上层继承到的**颜色：沿 `parent` 链找最近一条指令的生效值。
 *
 * 与 `walkColorDirectives` 同口径（哨兵折 null 并**终止**），只是不遍历子树。
 * 用途单一：判断「这个节点此刻会不会吃到祖先色」＝「默认」要不要落哨兵
 * （`features/view-node-color.applyNodeColor`）。
 */
export function inheritedColorOf<T extends { parent?: T | null }>(
	node: T,
	readDirective: (node: T) => string | null,
): string | null {
	for (let cursor = node.parent ?? null; cursor; cursor = cursor.parent ?? null) {
		const own = readDirective(cursor);
		if (own !== null) {
			// 哨兵折 null 即「到此为止」：更上面的颜色也到不了这棵子树
			return effectiveDirective(own);
		}
	}
	return null;
}

/**
 * 子树里**已经没人可挡**的哨兵 `%%none%%`：把某个节点的颜色撤掉之后，它那些
 * 「当初只为挡住这一支父色」的哨兵不再表达任何东西——屏上照旧是整篇配色，
 * 文件里却白留一行注释（2026-11-04 实机：删掉父色后 `%%none%%` 仍在）。
 *
 * 判据与 `walkColorDirectives` 同源，只是只看**自己这一支**：
 * - 自身是 `%%none%%` → 收下，并继续下探（它的子孙当初也靠它挡住同一个色源）；
 * - 自身是 `#rrggbb` → **整支止步**：它重新成了色源，子孙的哨兵挡的是它，
 *   删掉会让那些子孙反而吃到它的颜色（与本次操作无关）；
 * - 自身没写指令 → 继续下探。
 *
 * `root` 自身不进结果，它的语义由 `rootDirective` 显式告知——**必须传「即将写入
 * 的那个指令」而不是让本函数去读**：调用方据此可以在**同一次批量**里同时写主改动
 * 与清理（读实时数据就等于要求先落地，多付一轮整树重渲，2026-11-06 收敛）。
 * `rootDirective` 是十六进制时直接返回空：它成了新色源，子孙的哨兵挡的正是它。
 *
 * 返回顺序＝先序（children 原顺序），调用方按此批量写回，落盘顺序稳定。
 */
export function orphanSentinels<T extends { children?: readonly T[] | null }>(
	root: T,
	readDirective: (node: T) => string | null,
	rootDirective: string | null,
): T[] {
	// 本节点即将成为色源（换了某个颜色）：子孙的哨兵挡的正是它，删掉等于让它们
	// 反而吃到这个颜色（与本次操作无关，用户也没选它们）。
	if (rootDirective !== null && rootDirective !== COLOR_DIRECTIVE_NONE) {
		return [];
	}
	const found: T[] = [];
	const stack: T[] = [];
	/** 逆序压栈 ⇒ 出栈顺序与 children 原顺序一致（与 walkColorDirectives 同口径） */
	const descend = (node: T): void => {
		const children = node.children;
		if (!children) {
			return;
		}
		for (let index = children.length - 1; index >= 0; index--) {
			stack.push(children[index]!);
		}
	};
	descend(root);
	while (stack.length > 0) {
		const node = stack.pop()!;
		const own = readDirective(node);
		if (own === null) {
			descend(node);
			continue;
		}
		// 非空只有两种：哨兵（可删，继续下探）与十六进制（新色源，整支保留）
		if (own === COLOR_DIRECTIVE_NONE) {
			found.push(node);
			descend(node);
		}
	}
	return found;
}

/**
 * 「仅本节点」作用域（设置项 `nodeColorScope === 'node'`）的哨兵落点：给这些节点的
 * **直接子节点**各补一条 `%%none%%`，让本次上色不外溢到子树。
 *
 * ## 为什么改子节点，而不是改渲染
 * 继承（自身指令 → 最近祖先）是正文语义的一部分，不是视图偏好：同一个文件换个库、
 * 换台机器、发给别人都得是同一个样子。因此「只给这一个节点上色」只能**在正文里**
 * 表达，而白话里唯一能说「到此为止」的句式就是哨兵（`COLOR_DIRECTIVE_NONE`：
 * 显式无节点色 + 阻断祖先色下传）。渲染侧一个字都不用改。
 *
 * ## 只补一层，不补整片
 * 哨兵把 `null` 传给后代，继续往下写等于重复注释（`walkColorDirectives` 同口径）。
 *
 * ## 跳过谁
 * - **本次也要上色的节点**（`colored`，多选时父子同选）：它马上就有自己的指令，
 *   哨兵会被同批覆盖，写了也是白写；
 * - **自己已经有指令的节点**：十六进制是「这一支我另有安排」，哨兵是「我显式要
 *   默认」，两者都是用户此前的显式选择——本动作不越权改写（与 `orphanSentinels`
 *   同一条口径）。
 *
 * ## 代价（调用方要认）
 * 哨兵让子节点**回落到整篇配色**，而不是「保持它原本从更高祖先继承到的颜色」——
 * 注释语法里没有「只挡这一层、继续吃上上层的色」这种表达。所以给一个深处节点
 * 上色并选「仅本节点」时，它下面那一支会变成整篇配色，而不是祖上的颜色。
 *
 * ## 回收
 * 本节点一旦撤色（改写成哨兵或删掉指令），这些哨兵就再没东西可挡，
 * `orphanSentinels` 会把它们一并删掉——两条判据互为对偶，勿在别处另写一份。
 *
 * 返回顺序＝`roots` 的给定顺序 × 各自 `children` 的原顺序（写入顺序因此稳定）。
 */
export function scopeSentinels<T extends { children?: readonly T[] | null }>(
	roots: readonly T[],
	readDirective: (node: T) => string | null,
	colored: ReadonlySet<T>,
): T[] {
	const found: T[] = [];
	const seen = new Set<T>();
	for (const root of roots) {
		for (const child of root.children ?? []) {
			if (seen.has(child) || colored.has(child)) {
				continue;
			}
			if (readDirective(child) !== null) {
				continue;
			}
			seen.add(child);
			found.push(child);
		}
	}
	return found;
}
