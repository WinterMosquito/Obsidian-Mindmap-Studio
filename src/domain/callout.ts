/**
 * Obsidian **标注（callout）**与**引用块（blockquote）**的识别口径
 * （纯逻辑，零依赖；2026-11-11）。
 *
 * ## 为什么需要这一层
 * `>` 行在本插件的解析层是 `plain` 行（`markdown/md-outline-lines.classifyLines`），
 * 整块并进一个多行文本节点（见标准文档 §2.1）。显示层要把「`>` 前缀 + `[!type]`
 * 头部」还原成盒子，判定就只能发生在这里——解析与回写一律不碰（原文仍由 `mdRaw`
 * 逐字保真，见 AGENTS.md 硬规则 4）：`text` / `mdDerivedText` **一个字符都不改**
 * （把它们剥掉会让该类节点恒判「已编辑」，任务 token 踩过同一个坑）。
 *
 * ## 口径来源（三处，均已取证）
 * - 官方帮助 `Editing and formatting/Callouts`：语法 = 引用块**首行**写
 *   `> [!type] 标题`；13 种类型与别名；`+` / `-` 折叠标记；未登记类型回落 `note`；
 *   类型标识**大小写不敏感**；未写标题时标题 = 类型标识的 Title Case。
 * - 宿主 `app.css`（`obsidian.asar` 实测）：`.callout[data-callout=…]` 只做两件事——
 *   把 `--callout-color` 指到 `--callout-<type>`、把 `--callout-icon` 指到图标 id；
 *   颜色消费形态是 `color-mix(in oklch, var(--callout-color) 10%, transparent)`
 *   （底）与 `color: var(--callout-color)`（标题）；`--callout-<type>` 定义在
 *   **设计令牌层**（body 级，`var(--color-blue)` 一族）。
 * - 宿主解析正则 `\[!([^\]]+)\]([+\-]?)(?:\s|$)`：`|` 之后是 **callout metadata**
 *   （不是别名）；类型归一 = `trim` → 小写 → 空白转 `-`；折叠标记后必须紧跟
 *   空白或行尾（`[!info]标题` 不是标注）。
 *
 * ## 为什么颜色写成 `var()` 而不是解析后的字面量
 * 与 `node-inline-html` 的 `THEME_LINK_COLOR` 同一条纪律：`var()` 由浏览器解析，
 * **不进 `outerHTML`** ⇒ 换主题即时变色、且不污染引擎的离屏测量缓存键（K114）；
 * 导出侧（导出 SVG 内没有 app.css）靠 `platform/export-svg-postprocess` 的
 * `CSS_VARS_TO_EXPORT` 注入宿主实际值——本模块给出的 `var(--callout-<type>, …)`
 * 链路两端对称。
 *
 * ## 已知边界（有意，勿当缺陷）
 * - **自定义类型（CSS 片段定义）不取色**：本插件给节点内容**不加** `.callout` 类
 *   （那会把节点布局交给主题的 `.callout > *` / `mix-blend-mode` 规则，而导出图里
 *   那段 CSS 并不存在），故只有 13 个官方类型走类型色，其余一律按 `note` 呈现——
 *   与官方「未登记类型回落 note」同一兜底。
 * - **折叠标记只是标记**：`+` / `-` 记录在头部里，显示层按**展开**渲染（导图节点
 *   是概要面，隐藏正文会像内容丢失）；折叠态本来也不进文件。
 */

/**
 * 规范类型 id（= 宿主 `--callout-<type>` 变量的 `<type>` 段，13 个）。
 *
 * **发布即冻结**：它们是宿主变量名的一部分，改名等于让颜色静默回落到兜底色。
 */
export type CalloutTypeId =
	| 'note'
	| 'abstract'
	| 'info'
	| 'todo'
	| 'tip'
	| 'success'
	| 'question'
	| 'warning'
	| 'failure'
	| 'danger'
	| 'bug'
	| 'example'
	| 'quote';

/** 一种类型的显示元数据（颜色 / 图标 / 别名） */
interface CalloutTypeMeta {
	/**
	 * 官方 `app.css` 里 `--callout-icon` 的取值（交给宿主的 `getIcon` 解析）。
	 *
	 * 刻意只存 **id**、不存 SVG 路径：官方帮助自己就警告「Lucide 版本会定期更新」，
	 * 抄一份图标几何等于造一份会漂移的判定（硬规则 5）；`question` / `quote`
	 * 两个 id 在宿主里**没有 `lucide-` 前缀**，是官方原样值，勿"规范化"。
	 */
	icon: string;
	/**
	 * 宿主变量缺失时的兜底颜色（无头验证 / 导出环境）。
	 *
	 * 取宿主**亮色主题**的字面值：这些值只在「拿不到 `--callout-<type>`」时生效，
	 * 屏上正常路径永远走变量（见 `calloutVisualOf` 的 `color` 链）。
	 */
	fallbackColor: string;
	/**
	 * 宿主变量里的类型段（缺省 = 类型 id）。
	 *
	 * **四处不得不另列**（`obsidian.asar` 的 `app.css` 实测：类型名与变量名不同名，
	 * 照 id 拼会永远落到兜底色、且屏上丢主题色）：
	 * `note` → `--callout-default`、`abstract` → `--callout-summary`、
	 * `failure` → `--callout-fail`、`danger` → `--callout-error`。
	 *
	 * 这类偏差不能靠"改 id 去迁就变量"消化：id 是用户写在文件里的语义名
	 * （`[!abstract]` / `[!failure]`），变量名是宿主实现细节——两者本就不是同一件事。
	 */
	cssVar?: string;
	/** 官方帮助「Supported types」列出的别名（含自身） */
	aliases: readonly string[];
}

/**
 * 13 种类型的元数据表（**唯一定义**）。
 *
 * `Record<CalloutTypeId, …>` 让漏写一种即编译失败——新增类型必须同时补别名、
 * 图标与兜底色，不存在"只加一半"的中间态。
 */
const CALLOUT_TYPE_META: Record<CalloutTypeId, CalloutTypeMeta> = {
	note: {
		icon: 'lucide-pencil',
		fallbackColor: '#086ddd',
		// 宿主没有 `--callout-note`：`.callout` 的缺省就是 `--callout-default`
		cssVar: 'default',
		aliases: ['note'],
	},
	abstract: {
		icon: 'lucide-clipboard-list',
		fallbackColor: '#00bfbc',
		cssVar: 'summary',
		aliases: ['abstract', 'summary', 'tldr'],
	},
	info: { icon: 'lucide-info', fallbackColor: '#086ddd', aliases: ['info'] },
	todo: { icon: 'lucide-check-circle-2', fallbackColor: '#086ddd', aliases: ['todo'] },
	tip: {
		icon: 'lucide-flame',
		fallbackColor: '#00bfbc',
		// 官方帮助把 `important` 列为 `tip` 的别名；宿主里它另有独立变量
		// （`--callout-important`），但颜色与图标与 tip 逐字相同（cyan / flame）
		aliases: ['tip', 'hint', 'important'],
	},
	success: {
		icon: 'lucide-check',
		fallbackColor: '#08b94e',
		aliases: ['success', 'check', 'done'],
	},
	question: {
		icon: 'help-circle',
		fallbackColor: '#ec7500',
		aliases: ['question', 'help', 'faq'],
	},
	warning: {
		icon: 'lucide-alert-triangle',
		fallbackColor: '#ec7500',
		aliases: ['warning', 'caution', 'attention'],
	},
	failure: {
		icon: 'lucide-x',
		fallbackColor: '#e93147',
		cssVar: 'fail',
		aliases: ['failure', 'fail', 'missing'],
	},
	danger: {
		icon: 'lucide-zap',
		fallbackColor: '#e93147',
		cssVar: 'error',
		aliases: ['danger', 'error'],
	},
	bug: { icon: 'lucide-bug', fallbackColor: '#e93147', aliases: ['bug'] },
	example: { icon: 'lucide-list', fallbackColor: '#7852ee', aliases: ['example'] },
	quote: { icon: 'quote-glyph', fallbackColor: '#9e9e9e', aliases: ['quote', 'cite'] },
};

/**
 * 别名 → 规范类型（无原型对象）。
 *
 * 键来自**用户文件**（`[!任意词]`）：对象字面量命中原型方法会让
 * `[!toString]` 读出函数、`[!constructor]` 读出 `Object`（K172 ⑥ 的同款加固）。
 */
const ALIAS_TO_TYPE: Readonly<Record<string, CalloutTypeId>> = (() => {
	const table: Record<string, CalloutTypeId> = Object.create(null) as Record<
		string,
		CalloutTypeId
	>;
	for (const [type, meta] of Object.entries(CALLOUT_TYPE_META)) {
		for (const alias of meta.aliases) {
			table[alias] = type as CalloutTypeId;
		}
	}
	return table;
})();

/**
 * 13 个宿主变量名（`--callout-<cssVar|id>`），**唯一定义**。
 *
 * 导出 SVG 的变量注入表（`platform/export-svg-postprocess` 的
 * `CSS_VARS_TO_EXPORT`）直接展开本表：此前那张表手抄了 13 个名字，与本表的
 * 四处不同名（`default` / `summary` / `fail` / `error`）一旦漂移，导出图会静默
 * 回落到兜底色（硬规则 5「同一判定只有一处」）。
 */
export const CALLOUT_CSS_VARS: readonly string[] = Object.entries(
	CALLOUT_TYPE_META,
).map(([id, meta]) => `--callout-${meta.cssVar ?? id}`);

/** 默认类型：未登记（或空）的标识一律按 `note` 呈现（官方口径） */
const DEFAULT_CALLOUT_TYPE: CalloutTypeId = 'note';

/**
 * 类型标识的归一：`trim` → 小写 → 空白转 `-`（与宿主解析逐字同口径）。
 *
 * 只做形态归一、**不查表**：「`[!My  Type]`」这种写法归一后是 `my-type`。
 */
export function normalizeCalloutType(raw: string): string {
	return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * 类型标识 → 规范类型（未登记一律 `note`）。
 *
 * 入参可以是原文（未归一）也可以是已归一的串——归一本身是幂等的。
 */
export function calloutTypeOf(raw: string): CalloutTypeId {
	const type = normalizeCalloutType(raw);
	// `?? ` 而非 `||`：`Object.create(null)` 查不到时才是 undefined，
	// 而空串键在表里不存在，两者都落默认值
	return ALIAS_TO_TYPE[type] ?? DEFAULT_CALLOUT_TYPE;
}

/** 标注头部（首行 `[!type]± 标题` 的解析结果） */
export interface CalloutHeader {
	/** 归一后的类型标识原文（未查表；`custom-question-type` 之类原样保留） */
	type: string;
	/** 取色与取图标的键（别名已归一；未登记 → `note`） */
	canonical: CalloutTypeId;
	/** `|` 之后的 **callout metadata** 原文（官方未定义语义，原样保留不显示） */
	meta: string;
	/** 折叠标记：`+` 展开 / `-` 折叠 / 空串 = 不可折叠 */
	fold: '' | '+' | '-';
	/**
	 * **展示标题**（已 trim）：显式标题，或没写时的类型标识 Title Case。
	 *
	 * 解析期就定稿，不在渲染期算：Title Case 要 split/filter/map/join 四趟，
	 * 而段序列带缓存（同一行只解析一次）、渲染却会随节点重建反复发生。
	 */
	title: string;
}

/**
 * 标注头部正则（与宿主 `\[!([^\]]+)\]([+\-]?)(?:\s|$)` 同口径，末尾的标题为本插件
 * 解析出的消费形态）。
 *
 * `(?:\s+(.*))?$` 是「折叠标记后必须紧跟空白或行尾」的落地：`[!info]标题` 不算
 * 标注（与官方一致），而 `[!info]  标题` 的标题在 `title` 里 trim 掉多余空白。
 */
const CALLOUT_HEADER_RE = /^\[!([^\]]+)\]([+-]?)(?:\s+(.*))?$/;

/**
 * 该行（**已剥掉 `>` 前缀**）是不是标注头部——**廉价谓词**，不产出头部对象。
 *
 * 存在的唯一理由是块扫描的**续行循环**：那里每行都要问一次"这是不是新标注的
 * 开头"，而 `parseCalloutHeader` 会顺带做归一（3 次字符串操作）、查别名表、
 * 算 Title Case 并造一个对象——把它们按行白付一遍没有收益。判据与
 * `parseCalloutHeader` **同一条**（同一个正则 + 同一套"类型段非空"规则），
 * 只是不往下走。
 */
export function isCalloutHeaderLine(line: string): boolean {
	const match = CALLOUT_HEADER_RE.exec(line.trimEnd());
	if (match === null) {
		return false;
	}
	const rawType = match[1] ?? '';
	const bar = rawType.indexOf('|');
	const typePart = bar === -1 ? rawType : rawType.slice(0, bar);
	return typePart.trim().length > 0;
}

/**
 * 一行（**已剥掉 `>` 前缀**）→ 标注头部；不是标注首行则 null。
 *
 * 判定只看这一行：块的分组、`>` 前缀剥离与"首行才算头部"由调用方
 * （`features/node-inline-tokenize.scanQuoteBlocks`）负责。
 * 标题在此**定稿**（见 `CalloutHeader.title`）。
 */
export function parseCalloutHeader(line: string): CalloutHeader | null {
	const match = CALLOUT_HEADER_RE.exec(line.trimEnd());
	if (!match) {
		return null;
	}
	// `|` 之后是 metadata：只在**类型标识内部**切一次，标题里允许继续出现 `|`
	const rawType = match[1] ?? '';
	const bar = rawType.indexOf('|');
	const typePart = bar === -1 ? rawType : rawType.slice(0, bar);
	const meta = bar === -1 ? '' : rawType.slice(bar + 1).trim();
	const type = normalizeCalloutType(typePart);
	if (!type) {
		// `[!]` / `[! | ]`：空类型不是标注（`[^\]]+` 允许全空白，此处兜住）
		return null;
	}
	const explicit = (match[3] ?? '').trim();
	return {
		type,
		canonical: calloutTypeOf(type),
		meta,
		fold: match[2] === '+' || match[2] === '-' ? match[2] : '',
		title: explicit || titleCaseOf(type),
	};
}

/**
 * 类型标识 → **Title Case**（官方口径：没写标题时显示类型标识本身）。
 *
 * 用**归一后的原文**（`custom-question-type` → 「Custom Question Type」）而不是
 * 规范类型——否则自定义类型会全显示成 `Note`。只大写每个词的首字符、不碰其余
 * 字符（不做 locale 相关的标题化）；连续 `-` 产生的空段跳过。
 */
function titleCaseOf(type: string): string {
	return type
		.split('-')
		.filter((word) => word.length > 0)
		.map((word) => word[0]!.toUpperCase() + word.slice(1))
		.join(' ');
}

/** 类型的**显示元数据**（标注渲染需要的全部取色 / 取图标信息） */
export interface CalloutVisual {
	/**
	 * 颜色取值链：`var(--callout-<宿主变量名>, <兜底色>)`。
	 *
	 * 写成 `var()` 而不是解析后的字面量：屏上跟随主题即时变色、不污染引擎的
	 * 测量缓存键（`var()` 不进 `outerHTML`，K114）；导出侧由
	 * `CSS_VARS_TO_EXPORT` 注入宿主实际值，链路两端对称（见文件头）。
	 */
	readonly color: string;
	/** 交给宿主 `getIcon` 的图标 id（官方 `app.css` 里的原样取值） */
	readonly icon: string;
}

/**
 * 类型 → 显示元数据（**初始化一次**的表）。
 *
 * 取代原先的两个访问器（取色 / 取图标）：标注每次重建都要这两项，而它们只随
 * 类型变——现取现拼 `var()` 字符串等于每个节点每次重建都白造一个字符串，而节点
 * 重建是热点路径（K58 的 perf 探针实测一次操作可触发数十次构建器调用）。
 * 派生放进模块初始化，渲染期只剩一次查表。
 */
const CALLOUT_VISUAL: Readonly<Record<CalloutTypeId, CalloutVisual>> = (() => {
	const table = Object.create(null) as Record<CalloutTypeId, CalloutVisual>;
	for (const [type, meta] of Object.entries(CALLOUT_TYPE_META) as [
		CalloutTypeId,
		CalloutTypeMeta,
	][]) {
		table[type] = {
			color: `var(--callout-${meta.cssVar ?? type}, ${meta.fallbackColor})`,
			icon: meta.icon,
		};
	}
	return table;
})();

/** 类型 → 显示元数据（**唯一**取色 / 取图标入口） */
export function calloutVisualOf(type: CalloutTypeId): CalloutVisual {
	return CALLOUT_VISUAL[type];
}

/**
 * 引用行前缀：≤3 空格缩进 + `>` + **至多一个**可选空白（CommonMark 口径）。
 *
 * 4 空格起首是**缩进代码块**（`core/constants.isIndentedCodeLine`），这里不匹配它
 * 是正确的——那种行不是引用。
 */
const QUOTE_PREFIX_RE = /^[ \t]{0,3}>[ \t]?/;

/**
 * 剥掉一层引用前缀；不是引用行返回 null。
 *
 * 返回值可能是空串（单独一个 `>` = 引用块内的空行），调用方**必须**用
 * `=== null` 判非引用，不能按假值判。
 *
 * 实现是**单趟** `exec` + `slice`：`test` + `replace` 会把同一个锚定正则跑两遍并
 * 多产出一个替换字符串，而本函数在块扫描里按行调用（大节点的引用块每行一次）。
 */
export function stripQuotePrefix(line: string): string | null {
	const match = QUOTE_PREFIX_RE.exec(line);
	return match === null ? null : line.slice(match[0].length);
}
