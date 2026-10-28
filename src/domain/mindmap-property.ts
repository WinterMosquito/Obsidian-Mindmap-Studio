/**
 * 「本文件以哪种布局渲染」的属性声明（frontmatter 的单键 `Mindmap`）。
 *
 * 判据与写法分离是本模块的全部设计：
 * - **读**（`readMindMapDeclaration`）：只认键 `Mindmap`（键名大小写不敏感），
 *   值的归一在 `normalizePropertyToken` 一处（trim → 小写 → 去 `-` / `_` / 空白），
 *   再查反向表。因此 `Mindmap` / `mindMap` / `mind map` / `MIND-MAP` 都是同一件事；
 *   官方属性面板会把多值属性解析成数组，故**取首项**（空数组＝无值）。
 * - **写**（`setMindMapProperty` / `buildMindMapFrontmatter`）恒写标准键 `Mindmap`
 *   与 PascalCase 标准值（`MINDMAP_LAYOUT_VALUES` 的值），与界面语言**完全无关**。
 *
 * 值域（2026-10-29 重构）：属性值从「布尔开关」改为**布局枚举**——六个布局
 * （`LogicalStructure` / `Mindmap` / `OrganizationStructure` / `CatalogOrganization`
 * / `Timeline` / `Fishbone`）加终止值 `Markdown`。声明因此同时表达两件事：
 * 「是不是导图」与「用哪种布局」——布局只存在于文件属性，`data.json` 不再保存。
 * 未知值 = **不是导图**（fail-closed，静默）：这是刻意的——把写错的值当导图渲染，
 * 会让用户以为「属性没生效」；当普通笔记打开则一眼可见。
 *
 * **断代（2026-10-28）**：旧键 `Type` / `类型` **完全不认**——不读、不写、不删、
 * 不迁移、不提示。存量文件把属性键名改成 `Mindmap` 即可重新成为导图。
 *
 * 「以 Markdown 打开」把命中键改写为 `Markdown` 是**持久降级**（见
 * markdown/md-open.downgradeMindMapProperty）。
 */

/** 声明键名（唯一键；比对时大小写不敏感） */
export const MINDMAP_PROPERTY_KEY = 'Mindmap';

/** 「不做导图渲染」的显式终止值（「以 Markdown 打开」改写用） */
export const MINDMAP_MARKDOWN_VALUE = 'Markdown';

/**
 * 双向表的正向半边：引擎 layout id → 属性标准值。
 *
 * 顺序即 `MINDMAP_LAYOUT_IDS` 的顺序（`LAYOUT_OPTIONS` 的选项值由 `satisfies`
 * 与本表对齐，见 `core/constants.ts`）。**id 发布即冻结**：已写进用户文件的
 * 标准值一旦改名，那些文件会静默变成「不是导图」。
 */
export const MINDMAP_LAYOUT_VALUES = {
	logicalStructure: 'LogicalStructure',
	mindMap: 'Mindmap',
	organizationStructure: 'OrganizationStructure',
	catalogOrganization: 'CatalogOrganization',
	timeline: 'Timeline',
	fishbone: 'Fishbone',
} as const;

/** 引擎 layout id（由双向表键派生；勿手写第二份字面量联合） */
export type MindMapLayoutId = keyof typeof MINDMAP_LAYOUT_VALUES;

/** 全部布局 id（`LAYOUT_OPTIONS` 的完整性由测试对本表断言） */
export const MINDMAP_LAYOUT_IDS = Object.keys(
	MINDMAP_LAYOUT_VALUES,
) as MindMapLayoutId[];

/** 出厂默认属性值（新建文件的种子值来自设置，此处只兜「调用方没给」） */
export const MINDMAP_DEFAULT_VALUE: string = MINDMAP_LAYOUT_VALUES.mindMap;

/** 归一后的声明键名 */
const NORMALIZED_PROPERTY_KEY = MINDMAP_PROPERTY_KEY.toLowerCase();

/** 归一后的终止值（`Markdown` 的写法宽容度与布局值一致） */
const NORMALIZED_MARKDOWN_VALUE = normalizePropertyToken(MINDMAP_MARKDOWN_VALUE);

/** 布局 id 查表（避免每次比较都做一次对象键遍历） */
const LAYOUT_VALUES_BY_ID: Readonly<Record<string, string>> = MINDMAP_LAYOUT_VALUES;

/**
 * 属性值归一（读侧**唯一**实现）：trim → 小写 → 去掉 `-`、`_` 与所有空白。
 *
 * 之所以要吃掉分隔符：属性面板与手写 YAML 里 `logical-structure`、`logical_structure`、
 * `Logical Structure` 都是同一个意思，用户不该被迫记住我们的拼写。
 */
function normalizePropertyToken(value: string): string {
	return value.trim().toLowerCase().replace(/[-_\s]/g, '');
}

/** 反向表：归一值 → 布局 id（双向表的另一半，与 `MINDMAP_LAYOUT_VALUES` 同源） */
const LAYOUT_ID_BY_TOKEN: Readonly<Record<string, MindMapLayoutId>> = (() => {
	const table: Record<string, MindMapLayoutId> = {};
	for (const [id, value] of Object.entries(MINDMAP_LAYOUT_VALUES)) {
		table[normalizePropertyToken(value)] = id as MindMapLayoutId;
	}
	return table;
})();

/** 是否为读侧认得的属性键名（`Mindmap`，大小写不敏感；不看值） */
export function isMindMapPropertyKey(key: string): boolean {
	return key.trim().toLowerCase() === NORMALIZED_PROPERTY_KEY;
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
	// 标量按字符串处理（YAML 的 42 / true 也走同一条归一）；
	// 对象 / 嵌套数组不是有意义的属性值 ⇒ 视同无值（fail-closed）
	if (typeof first === 'number' || typeof first === 'boolean') {
		return String(first);
	}
	if (typeof first !== 'string') {
		return null;
	}
	const text = first.trim();
	return text === '' ? null : text;
}

/**
 * 属性值 → 引擎 layout id；`Markdown`、未知值与无值都返回 `null`（fail-closed）。
 *
 * 嵌入块的 `%%layout: <值>%%` 指令也走这里——「值 → 布局」的判定全仓只有这一份，
 * 视图、升级入口与嵌入分别自己判一次必然漂移（硬规则 5）。
 */
export function layoutIdOfPropertyValue(value: unknown): MindMapLayoutId | null {
	const first = firstPropertyValue(value);
	if (first === null) {
		return null;
	}
	return LAYOUT_ID_BY_TOKEN[normalizePropertyToken(first)] ?? null;
}

/** 布局 id → 属性标准值（写入用）；未知 id 回退出厂默认值，绝不写出脏值 */
export function layoutPropertyValue(layoutId: string): string {
	return LAYOUT_VALUES_BY_ID[layoutId] ?? MINDMAP_DEFAULT_VALUE;
}

/**
 * 声明解析结果：
 * - `kind: 'layout'` ⇒ 是导图，且用哪个布局；
 * - `kind: 'markdown'` ⇒ 显式终止（`Markdown`），不是导图；
 * - `null` ⇒ 不是导图（无键 / 未知值 / 无值）。
 */
export type MindMapDeclaration =
	| { kind: 'layout'; layoutId: MindMapLayoutId; value: string }
	| { kind: 'markdown' };

/**
 * 读声明（**唯一**判定入口）。
 *
 * 同名变体并存（`Mindmap` + `mindmap`）时按**对象键顺序**取第一个命中的键——YAML
 * 里后者覆盖前者的语义由官方解析器决定，这里只按它给出的对象键序，不另立优先级。
 *
 * `value` 回填的是**标准值**（PascalCase）：调用方要写回时直接用，不必再查表。
 */
export function readMindMapDeclaration(
	frontmatter: unknown,
): MindMapDeclaration | null {
	if (!frontmatter || typeof frontmatter !== 'object') {
		return null;
	}
	const record = frontmatter as Record<string, unknown>;
	const key = Object.keys(record).find(isMindMapPropertyKey);
	if (key === undefined) {
		return null;
	}
	const first = firstPropertyValue(record[key]);
	if (first === null) {
		return null;
	}
	const layoutId = layoutIdOfPropertyValue(first);
	if (layoutId !== null) {
		return { kind: 'layout', layoutId, value: MINDMAP_LAYOUT_VALUES[layoutId] };
	}
	return normalizePropertyToken(first) === NORMALIZED_MARKDOWN_VALUE
		? { kind: 'markdown' }
		: null;
}

/**
 * 是否为「声明为思维导图」的文件（`readMindMapDeclaration` 的布尔包装——
 * **不另写一套比较**）。
 */
export function isMindMapProperty(frontmatter: unknown): boolean {
	return readMindMapDeclaration(frontmatter)?.kind === 'layout';
}

/**
 * 写入声明：删除所有同名大小写变体（`mindmap` / `MINDMAP`），把值落到标准键
 * `Mindmap` 上。
 *
 * - 目标值 = 显式 `value`（**属性标准值**，PascalCase：升级写种子布局、降级写
 *   `Markdown`）；**未给则沿用首个变体的值**——用于「只改键名、不动值」的变体收敛；
 * - 只碰 `Mindmap` 一族键：旧键 `Type` / `类型` 原样放过（不再认，也不删）。
 *
 * 返回是否发生语义改动（供调用方与测试判断；`processFrontMatter` 本身一律重
 * 序列化，此返回值不用来决定是否写盘）。纯函数，落在零依赖 domain 层。
 */
export function setMindMapProperty(
	frontmatter: Record<string, unknown>,
	value?: string,
): boolean {
	const keys = Object.keys(frontmatter).filter(isMindMapPropertyKey);
	const firstKey = keys[0];
	const keptValue =
		value ?? (firstKey === undefined ? undefined : frontmatter[firstKey]);
	let changed = false;
	for (const key of keys) {
		if (key !== MINDMAP_PROPERTY_KEY) {
			delete frontmatter[key];
			changed = true;
		}
	}
	if (
		keptValue !== undefined &&
		frontmatter[MINDMAP_PROPERTY_KEY] !== keptValue
	) {
		frontmatter[MINDMAP_PROPERTY_KEY] = keptValue;
		changed = true;
	}
	return changed;
}

/**
 * 新建文件用的属性块（**含末尾换行**）：`---\nMindmap: <value>\n---\n`。
 * 调用方负责在其后补一个空行再接正文（frontmatter 与正文之间必须有分隔）。
 *
 * @param value 属性标准值（种子布局）。缺省为 `Mindmap`（思维导图布局）。
 */
export function buildMindMapFrontmatter(
	value: string = MINDMAP_DEFAULT_VALUE,
): string {
	return `---\n${MINDMAP_PROPERTY_KEY}: ${value}\n---\n`;
}
