/**
 * 「本文件是思维导图」的属性声明（frontmatter 的 `Type` / `类型`）。
 *
 * 2026-10-12 起触发判据由「文件名 `.mindmap.md` 后缀」改为本属性声明
 * （迁移后的文件是普通 `命名.md`）。判据与写法分离是本模块的全部设计：
 * - **读**（`isMindMapProperty` / `findMindMapPropertyKeys`）**不看语言**：两个
 *   键名都查（键名大小写不敏感），值 trim 后大小写不敏感比对 `mindmap`。官方
 *   属性面板会把多值属性解析成数组，故兼容单元素数组形态。中英混用库、用户改过
 *   语言、跨设备同步都不会「看不见」；
 * - **写**（`mindMapPropertyKey`：zh → `类型`，en → `Type`）才看语言。语言以
 *   `string` 传入（domain 是零依赖层，拿不到 core 的 `Language`），不另立第二份
 *   语言联合类型。
 *
 * 值 `Markdown`（`MINDMAP_MARKDOWN_VALUE`）**不是否决票**，只是惰性值：把
 * `类型: Mindmap` 改成 `Markdown` 之所以生效，是因为不再有任何键等于 `mindmap`
 * ——而不是因为 Markdown 有否决权。因此「两个键同时存在」无需定义冲突优先级：
 * 任一命中即为导图。
 *
 * 「以 Markdown 打开」把命中键改写为 `Markdown` 是**持久降级**（见
 * markdown/md-open.downgradeMindMapProperty）。
 *
 * **键名随语言收敛**（2026-10-12）：升级/降级/语言切换都经
 * `convergeMindMapPropertyKey` 把 frontmatter 里的 `Type`/`类型` 收敛为**唯一的
 * 语言目标键**——否则改语言时会「重写 YAML 但只加新键」，导致 `Type` 与 `类型`
 * 并存（文档属性面板里两把键同现）。
 */

/** 触发值：写入时的字面量（读侧归一后比对，大小写不敏感） */
export const MINDMAP_TYPE_VALUE = 'Mindmap';

/** 「不做导图渲染」的显式标记值（「以 Markdown 打开」改写用） */
export const MINDMAP_MARKDOWN_VALUE = 'Markdown';

/** 读取面键名（小写口径；两键都认，不看当前语言） */
const READ_KEYS = ['type', '类型'] as const;

/** 归一后的触发值（避免每次比较都做一次 toLowerCase） */
const NORMALIZED_TYPE_VALUE = MINDMAP_TYPE_VALUE.toLowerCase();

/** 归一后的降级值（迁键时同样属于「插件写的值」，见 `isMindMapDeclarationValue`） */
const NORMALIZED_MARKDOWN_VALUE = MINDMAP_MARKDOWN_VALUE.toLowerCase();

/**
 * 属性值归一为可比较的字符串数组。
 * 数组形态 = 官方属性面板解析出的多值属性；单值按一项处理；`null`/`undefined`
 * （键存在但无值）视为无值而非 `"null"` 字符串。
 */
export function normalizePropertyValues(value: unknown): string[] {
	if (value === null || value === undefined) {
		return [];
	}
	const items = Array.isArray(value) ? value : [value];
	return items.map((item) => String(item).trim().toLowerCase());
}

/**
 * 找出 frontmatter 中**声明了思维导图**的属性键（返回原文键名，0～2 个）。
 */
export function findMindMapPropertyKeys(frontmatter: unknown): string[] {
	if (!frontmatter || typeof frontmatter !== 'object') {
		return [];
	}
	const record = frontmatter as Record<string, unknown>;
	const keys: string[] = [];
	for (const key of Object.keys(record)) {
		if (!isMindMapPropertyKey(key)) {
			continue;
		}
		if (normalizePropertyValues(record[key]).includes(NORMALIZED_TYPE_VALUE)) {
			keys.push(key);
		}
	}
	return keys;
}

/** 是否为「声明为思维导图」的文件（frontmatter 判据唯一收口） */
export function isMindMapProperty(frontmatter: unknown): boolean {
	return findMindMapPropertyKeys(frontmatter).length > 0;
}

/** 是否为读侧认得的属性键名（`Type`/`类型`，大小写不敏感；不看值） */
export function isMindMapPropertyKey(key: string): boolean {
	const lowered = key.trim().toLowerCase();
	return READ_KEYS.some((known) => known === lowered);
}

/**
 * 是否为**本插件写的声明值**（`Mindmap` / `Markdown`，大小写不敏感）。
 *
 * 只给「会改写用户文件」的场合用（语言切换的键名迁移、升级/降级前的权威判据）：
 * 插件两条写入路径只会写这两个值，故值不在此列的同名属性（`类型: wiki`、
 * `类型: 笔记`）是**别人的数据**，任何迁移都必须原样放过——按**键名**全库改名
 * 会连同值一起改写，属破坏性操作（2026-10-23 实测踩到）。
 */
export function isMindMapDeclarationValue(value: unknown): boolean {
	return normalizePropertyValues(value).some(
		(candidate) =>
			candidate === NORMALIZED_TYPE_VALUE ||
			candidate === NORMALIZED_MARKDOWN_VALUE,
	);
}

/**
 * 把 frontmatter 的导图声明键**收敛为唯一的语言目标键**（防 `Type` 与 `类型`
 * 并存——这正是「改语言后重写 YAML 却只加新键」的缺陷根因）。
 *
 * - 目标键 = `mindMapPropertyKey(lang)`（zh `类型` / en `Type`）；
 * - 目标值 = 显式 `value`（升级写 `Mindmap`、降级写 `Markdown`）；**未给则沿用
 *   原有键的值**——语言切换迁移用它「只改键名、不动值」；
 * - 删除所有其它同类键（含大小写变体），并把值迁到目标键上。
 *
 * 返回是否发生语义改动（供调用方与测试判断；`processFrontMatter` 本身一律重
 * 序列化，此返回值不用来决定是否写盘）。纯函数，落在零依赖 domain 层。
 */
export function convergeMindMapPropertyKey(
	frontmatter: Record<string, unknown>,
	lang: string,
	value?: string,
): boolean {
	const target = mindMapPropertyKey(lang);
	const keys = Object.keys(frontmatter).filter(isMindMapPropertyKey);
	const firstKey = keys[0];
	const keptValue =
		value ?? (firstKey === undefined ? undefined : frontmatter[firstKey]);
	let changed = false;
	for (const key of keys) {
		if (key !== target) {
			delete frontmatter[key];
			changed = true;
		}
	}
	if (keptValue !== undefined && frontmatter[target] !== keptValue) {
		frontmatter[target] = keptValue;
		changed = true;
	}
	return changed;
}

/** 写入侧属性键名（读侧两键都认，见本文件头；语言以 string 传入） */
export function mindMapPropertyKey(lang: string): string {
	return lang === 'en' ? 'Type' : '类型';
}

/**
 * 新建文件用的属性块（**含末尾换行**）：`---\n类型: Mindmap\n---\n`。
 * 调用方负责在其后补一个空行再接正文（frontmatter 与正文之间必须有分隔）。
 */
export function buildMindMapFrontmatter(lang: string): string {
	return `---\n${mindMapPropertyKey(lang)}: ${MINDMAP_TYPE_VALUE}\n---\n`;
}
