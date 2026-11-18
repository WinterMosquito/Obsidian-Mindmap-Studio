/**
 * 「本文件是否由插件接管、用哪种布局」的 frontmatter 契约（2026-11-07 重构）。
 *
 * 两个键，职责严格分离：
 * - **启用信号** `Mindmap`：值严格为 `Mindmap` 时插件接管并渲染为导图；其它任何
 *   值（含插件默认回写的 `Markdown`）一律视为**不启用**——插件不接管、不改文件、
 *   不写盘，交给 Obsidian 原生渲染。`Markdown` 只是「切换为 Markdown」时的默认
 *   回写值，不是具有特殊语义的终止值。
 * - **布局** `Mindmap Layout`：六种 kebab 短 id（`logical` / `mindmap` /
 *   `organization` / `catalog` / `timeline` / `fishbone`）。缺失或非法时由调用方
 *   回退设置项「默认布局」；本模块只回答「值是不是合法布局」。
 *
 * 读侧归一只有一处（`normalizePropertyToken`：trim → 小写 → 去 `-` / `_` / 空白）：
 * 键名与值都经它比较，故 `Mindmap` / `mindMap` / `mind map`、`Mindmap Layout` /
 * `mindmap-layout` 都是同一个键。官方属性面板会把多值属性解析成数组，故**取首项**
 * （空数组＝无值）。
 *
 * 写侧恒写标准键名（`Mindmap` / `Mindmap Layout`）与标准值（`Mindmap` / kebab id），
 * 与界面语言完全无关。
 *
 * 文件属性与嵌入指令统一经 `layoutIdOfPropertyValue` 读取当前短 id。
 * 不读取或迁移历史布局名称；内部引擎 id 的转换仍由 `normalizeLayoutId` 负责。
 */

/** 启用信号键名（唯一键；比对时大小写/分隔符不敏感） */
export const MINDMAP_PROPERTY_KEY = 'Mindmap';

/** 布局键名（含空格；比对时大小写/分隔符不敏感） */
export const MINDMAP_LAYOUT_PROPERTY_KEY = 'Mindmap Layout';

/** 唯一启用值：`Mindmap: Mindmap` ⇒ 插件接管 */
export const MINDMAP_ENABLED_VALUE = 'Mindmap';

/** 「不启用」的默认回写值（「切换为 Markdown」写入；无特殊语义） */
export const MINDMAP_DISABLED_VALUE = 'Markdown';

/**
 * 引擎 layout id → 布局属性值（kebab 短 id）。
 *
 * 值域的唯一源：`LAYOUT_OPTIONS` 的选项值与嵌入指令都消费本表。**id 发布即冻结**：
 * 已写进用户文件的值一旦改名，那些文件会静默回退到默认布局。
 */
export const MINDMAP_LAYOUT_VALUES = {
	logicalStructure: 'logical',
	mindMap: 'mindmap',
	organizationStructure: 'organization',
	catalogOrganization: 'catalog',
	timeline: 'timeline',
	fishbone: 'fishbone',
} as const;

/** 引擎 layout id（由双向表键派生；勿手写第二份字面量联合） */
export type MindMapLayoutId = keyof typeof MINDMAP_LAYOUT_VALUES;

/** 全部布局 id（`LAYOUT_OPTIONS` 的完整性由测试对本表断言） */
export const MINDMAP_LAYOUT_IDS = Object.keys(
	MINDMAP_LAYOUT_VALUES,
) as MindMapLayoutId[];

/** 出厂默认布局值（新建/升级时的种子值来自设置，此处只兜「调用方没给」） */
export const MINDMAP_DEFAULT_LAYOUT_VALUE: string =
	MINDMAP_LAYOUT_VALUES.mindMap;

/** 归一后的启用键名 */
const NORMALIZED_PROPERTY_KEY = normalizePropertyToken(MINDMAP_PROPERTY_KEY);

/** 归一后的布局键名 */
const NORMALIZED_LAYOUT_KEY = normalizePropertyToken(MINDMAP_LAYOUT_PROPERTY_KEY);

/** 归一后的启用值 */
const NORMALIZED_ENABLED_VALUE = normalizePropertyToken(MINDMAP_ENABLED_VALUE);

/**
 * 属性键名/值归一（读侧**唯一**实现）：trim → 小写 → 去掉 `-`、`_` 与所有空白。
 *
 * 键名与值共用：属性面板与手写 YAML 里 `Mindmap Layout`、`mindmap-layout`、
 * `Mindmap_Layout` 都是同一个键；布局值 `logical`、`Logical` 同样归一。
 */
function normalizePropertyToken(value: string): string {
	return value.trim().toLowerCase().replace(/[-_\s]/g, '');
}

/** 用户输入作键时使用无原型表，防止 constructor/toString 命中继承属性。 */
function createLookup<T>(
	entries: Iterable<readonly [string, T]>,
): Readonly<Record<string, T>> {
	const table: Record<string, T> = Object.create(null) as Record<string, T>;
	for (const [key, value] of entries) {
		table[key] = value;
	}
	return table;
}

/** 布局 id 查表（避免每次比较都做一次对象键遍历；无原型见 `createLookup`） */
const LAYOUT_VALUES_BY_ID: Readonly<Record<string, string>> = createLookup(
	Object.entries(MINDMAP_LAYOUT_VALUES),
);

/** 反向表：归一值 → 布局 id（双向表的另一半，与 `MINDMAP_LAYOUT_VALUES` 同源） */
const LAYOUT_ID_BY_TOKEN: Readonly<Record<string, MindMapLayoutId>> = createLookup(
	Object.entries(MINDMAP_LAYOUT_VALUES).map(
		([id, value]) =>
			[normalizePropertyToken(value), id as MindMapLayoutId] as const,
	),
);

/** 是否为启用信号键名（`Mindmap`，大小写/分隔符不敏感；不看值） */
export function isMindMapPropertyKey(key: string): boolean {
	return normalizePropertyToken(key) === NORMALIZED_PROPERTY_KEY;
}

/** 是否为布局键名（`Mindmap Layout`，大小写/分隔符不敏感；不看值） */
export function isMindMapLayoutKey(key: string): boolean {
	return normalizePropertyToken(key) === NORMALIZED_LAYOUT_KEY;
}

/**
 * 属性值的**首项**（数组形态 = 官方属性面板的多值属性）。
 * `null` / `undefined` / 空数组 / 空白串一律视为无值。
 */
function firstPropertyValue(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	// `Array.isArray` 把 `unknown` 收窄成 `any[]`：显式落到 `unknown[]`，
	// 免得 `any` 顺着首项渗进后续判定（lint 的 no-unsafe-assignment 也会拦）
	const items = Array.isArray(value) ? (value as unknown[]) : [value];
	const first: unknown = items[0];
	if (typeof first !== 'string') {
		return null;
	}
	const text = first.trim();
	return text === '' ? null : text;
}

/** 在 frontmatter 里找第一个命中的键（键名归一；同名变体按对象键序取首个） */
function findKey(
	frontmatter: Record<string, unknown>,
	matches: (key: string) => boolean,
): string | undefined {
	return Object.keys(frontmatter).find(matches);
}

/**
 * 属性值 → 引擎 layout id；未知值与无值都返回 `null`（fail-closed）。
 *
 * **只收新契约的 kebab 值**：文件属性里的布局键由插件写入，恒为 kebab；读侧放宽会让
 * 未知值在文件里长期有效；内部引擎 id 只在调用入口转换。
 */
export function layoutIdOfPropertyValue(value: unknown): MindMapLayoutId | null {
	const first = firstPropertyValue(value);
	if (first === null) {
		return null;
	}
	return LAYOUT_ID_BY_TOKEN[normalizePropertyToken(first)] ?? null;
}

/**
 * 布局标识归一：同时接受**引擎 layout id**（`logicalStructure`）与**属性值**
 * （`logical`）。用于「调用方拿到的是引擎 id 还是用户写的值说不清」的入口
 * （`applyLayout`、升级种子、`setMindMapLayout`）。
 *
 * 属性读侧仍走 `layoutIdOfPropertyValue`——文件里只认 kebab 值，不认引擎 id。
 */
export function normalizeLayoutId(value: unknown): MindMapLayoutId | null {
	const first = firstPropertyValue(value);
	if (first === null) {
		return null;
	}
	if (LAYOUT_VALUES_BY_ID[first] !== undefined) {
		return first as MindMapLayoutId;
	}
	return LAYOUT_ID_BY_TOKEN[normalizePropertyToken(first)] ?? null;
}

/**
 * 布局标识 → 属性值（写入用）；未知值回退出厂默认值，绝不写出脏值。
 *
 * 入参先经 `normalizeLayoutId`：引擎 id（`logicalStructure`）与属性值（`logical`）
 * 都能写对。此前只查引擎 id 表，传属性值会**静默退回默认布局**——同样是「布局
 * 值 → 布局值」的调用，两种形态不该有两种结果。
 */
export function layoutPropertyValue(layoutId: string): string {
	const id = normalizeLayoutId(layoutId);
	const value = id === null ? undefined : LAYOUT_VALUES_BY_ID[id];
	return value ?? MINDMAP_DEFAULT_LAYOUT_VALUE;
}

/**
 * 是否启用插件（**唯一判定入口**）：`Mindmap` 键的首项归一等值于 `Mindmap`。
 *
 * `Markdown`、未知值、无键、空值一律 `false`——不启用即完全不碰文件。
 */
export function isMindMapEnabled(frontmatter: unknown): boolean {
	if (!frontmatter || typeof frontmatter !== 'object') {
		return false;
	}
	const record = frontmatter as Record<string, unknown>;
	const key = findKey(record, isMindMapPropertyKey);
	if (key === undefined) {
		return false;
	}
	const first = firstPropertyValue(record[key]);
	return (
		first !== null &&
		normalizePropertyToken(first) === NORMALIZED_ENABLED_VALUE
	);
}

/**
 * 是否已显式写为「不启用」（`Mindmap: Markdown`，容忍写法变体）。
 *
 * 只用于「切换为 Markdown」的幂等短路：值已经是默认回写值时不必再重序列化 YAML。
 * 判定与 `isMindMapEnabled` 同源（都经 `firstPropertyValue` + 归一）。
 */
export function isMindMapDisabled(frontmatter: unknown): boolean {
	if (!frontmatter || typeof frontmatter !== 'object') {
		return false;
	}
	const record = frontmatter as Record<string, unknown>;
	const key = findKey(record, isMindMapPropertyKey);
	if (key === undefined) {
		return false;
	}
	const first = firstPropertyValue(record[key]);
	return (
		first !== null &&
		normalizePropertyToken(first) ===
			normalizePropertyToken(MINDMAP_DISABLED_VALUE)
	);
}

/**
 * 读布局声明；无键 / 无值 / 非法值都返回 `null`（调用方回退默认布局）。
 *
 * 只在**已启用**的文件上有意义：不启用的文件插件根本不渲染，布局无人消费。
 */
export function readMindMapLayout(
	frontmatter: unknown,
): MindMapLayoutId | null {
	if (!frontmatter || typeof frontmatter !== 'object') {
		return null;
	}
	const record = frontmatter as Record<string, unknown>;
	const key = findKey(record, isMindMapLayoutKey);
	if (key === undefined) {
		return null;
	}
	return layoutIdOfPropertyValue(record[key]);
}

/**
 * 删除某键的所有同名变体（**标准键本身保留**，返回是否删除过）。
 *
 * 标准键不能一起删：删掉再写回会让幂等判断失效（`setMindMapEnabled` 对
 * 已经是 `Mindmap: Mindmap` 的文件也报告「有改动」，每次打开都重序列化 YAML）。
 */
function dropKeyVariants(
	frontmatter: Record<string, unknown>,
	matches: (key: string) => boolean,
	standardKey: string,
): boolean {
	let changed = false;
	for (const key of Object.keys(frontmatter)) {
		if (key !== standardKey && matches(key)) {
			delete frontmatter[key];
			changed = true;
		}
	}
	return changed;
}

/**
 * 写启用信号：删除所有同名变体，把 `Mindmap` 落到标准键上（值为启用值）。
 * 返回是否发生语义改动。
 */
export function setMindMapEnabled(frontmatter: Record<string, unknown>): boolean {
	const changed = dropKeyVariants(
		frontmatter,
		isMindMapPropertyKey,
		MINDMAP_PROPERTY_KEY,
	);
	if (frontmatter[MINDMAP_PROPERTY_KEY] !== MINDMAP_ENABLED_VALUE) {
		frontmatter[MINDMAP_PROPERTY_KEY] = MINDMAP_ENABLED_VALUE;
		return true;
	}
	return changed;
}

/**
 * 写「不启用」：删除所有同名变体，标准键写默认值 `Markdown`。
 * 返回是否发生语义改动。
 */
export function setMindMapDisabled(frontmatter: Record<string, unknown>): boolean {
	const changed = dropKeyVariants(
		frontmatter,
		isMindMapPropertyKey,
		MINDMAP_PROPERTY_KEY,
	);
	if (frontmatter[MINDMAP_PROPERTY_KEY] !== MINDMAP_DISABLED_VALUE) {
		frontmatter[MINDMAP_PROPERTY_KEY] = MINDMAP_DISABLED_VALUE;
		return true;
	}
	return changed;
}

/**
 * 写布局键：删除所有同名变体，标准键写 kebab 值。
 *
 * `layoutId` 允许是引擎 id（`logicalStructure`）或属性值（`logical`），经
 * `normalizeLayoutId` 归一；**归一不了就不写**（返回值与「值本来就对」一样是
 * `false`）——绝不把未知值写进文件。
 */
export function setMindMapLayout(
	frontmatter: Record<string, unknown>,
	layoutId: string,
): boolean {
	const normalized = normalizeLayoutId(layoutId);
	if (normalized === null) {
		return false;
	}
	const value = LAYOUT_VALUES_BY_ID[normalized];
	const changed = dropKeyVariants(
		frontmatter,
		isMindMapLayoutKey,
		MINDMAP_LAYOUT_PROPERTY_KEY,
	);
	if (frontmatter[MINDMAP_LAYOUT_PROPERTY_KEY] !== value) {
		frontmatter[MINDMAP_LAYOUT_PROPERTY_KEY] = value;
		return true;
	}
	return changed;
}

/**
 * 新建文件用的属性块（**含末尾换行**）：
 * `---\nMindmap: Mindmap\nMindmap Layout: <value>\n---\n`。
 *
 * 调用方负责在其后补一个空行再接正文（frontmatter 与正文之间必须有分隔）。
 *
 * @param layoutId 种子布局（引擎 layout id）；缺省为思维导图布局。
 */
export function buildMindMapFrontmatter(
	layoutId: string = MINDMAP_DEFAULT_LAYOUT_VALUE,
): string {
	// 归一 + 兜底两步都在 `layoutPropertyValue` 里（引擎 id 与属性值都认，
	// 未知 / 空值回退出厂默认）——此处不再叠一层 normalize
	const value = layoutPropertyValue(layoutId);
	return `---\n${MINDMAP_PROPERTY_KEY}: ${MINDMAP_ENABLED_VALUE}\n${MINDMAP_LAYOUT_PROPERTY_KEY}: ${value}\n---\n`;
}
