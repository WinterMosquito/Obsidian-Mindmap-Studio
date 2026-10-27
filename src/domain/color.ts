/**
 * 颜色值解析、换算、亮度计算与继承遍历（纯逻辑，零依赖）。
 *
 * 服务对象：节点配色指令 `%%#89CFF0%%`（`features/node-inline-tokenize` 解析、
 * `engine/mindmap-colors` 落地）、「自定义」入口的人类输入（`parseColorInput`）、
 * 自定义整篇配色（`engine/mindmap-palette.deriveCustomPalette` 用 `mixHex` 派生
 * 五档）。都是可直测的纯计算，故放 domain。
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
 *   深底变暗、浅底变亮，文字与底色因此始终拉开；近白/近黑节点退化为向墨色偏 6%
 *   （否则阶差为 0，码块会彻底消失）；
 * - `border`：表格线（45% 墨色混入底色），在任意底色上都能看出网格。
 *
 * 三者都只依赖节点底色与墨色，不读主题变量——导出 SVG 与屏幕因此同一份字面量。
 */
export interface NodeContentTones {
	ink: string;
	chip: string;
	border: string;
}

export function nodeContentTones(fill: string): NodeContentTones {
	const background = normalizeHexColor(fill) ?? '#ffffff';
	const ink = nodeInkColor(background);
	// 码块要与底色拉开，方向必须**背离墨色**（白墨→压暗、黑墨→提亮）
	const awayFromInk = ink === '#ffffff' ? '#000000' : '#ffffff';
	// 近白 / 近黑节点已贴到那一端：继续朝同方向偏等于没偏（阶差 0 ⇒ 码块消失），
	// 退化为朝墨色偏 6%。阈值 0.04 约为「人眼刚好可辨」的明度差。
	const noRoomToShift =
		Math.abs(relativeLuminance(background) - relativeLuminance(awayFromInk)) < 0.04;
	return {
		ink,
		chip: noRoomToShift
			? mixHex(background, ink, 0.06)
			: mixHex(background, awayFromInk, 0.12),
		border: mixHex(background, ink, 0.45),
	};
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
