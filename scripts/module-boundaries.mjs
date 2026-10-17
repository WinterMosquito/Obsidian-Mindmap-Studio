/**
 * 模块依赖矩阵的**唯一定义**（AGENTS.md K51）。
 *
 * 为什么单独成文件：矩阵此前只以字面量形式存在于 `eslint.config.mts`，而
 * `tests/module-boundaries.test.ts` 要校验的性质（无环、层许可、组合根独占）
 * 必须与 lint **同源**——两份矩阵必然漂移，届时「测试绿、lint 红」或反之，
 * 判定就失去意义（硬规则 5：不造第二份判定）。
 *
 * 消费方（本文件只导出它们实际用到的四组符号，勿凭方便扩大导出面）：
 * - `eslint.config.mts`：`MODULE_GROUPS` / `forbiddenSpecifierPatterns` /
 *   `COMBO_ROOT_SPECIFIER_PATTERN`（生成每组 zone 块）；
 * - `tests/module-boundaries.test.ts`：`MODULE_GROUPS` / `MODULE_DEPENDENCIES` /
 *   `COMBO_ROOT_MODULES` / `allowedTargets` / `forbiddenSpecifierPatterns`
 *   （按解析后的真实路径校验依赖图）。
 *
 * 本文件不参与打包（esbuild 只以 `src/` 为入口），也不在 lint 的检查面内
 * （`scripts/**` 已 globalIgnores），故只写纯数据与纯函数。
 */

/**
 * @typedef {'domain' | 'core' | 'links' | 'markdown' | 'media' | 'engine'
 *   | 'platform' | 'ui' | 'services' | 'features'} ModuleGroup
 */

/**
 * 全部模块组，顺序即层级（domain 在最底层，features 在最上层）。
 *
 * `src/` 下出现未登记的一级目录时，边界测试会红灯——新模块必须先在此定层。
 *
 * @type {readonly ModuleGroup[]}
 */
export const MODULE_GROUPS = Object.freeze([
	'domain',
	'core',
	'links',
	'markdown',
	'media',
	'engine',
	'platform',
	'ui',
	'services',
	'features',
]);

/**
 * 依赖矩阵：每组**允许**依赖的同层其他组（domain 恒被允许，故不重复列出）。
 *
 * 单向性由本表形状保证（下标小的层不依赖下标大的层），边界测试还会额外
 * 断言本表是 DAG——新增一条反向边会同时触发 lint 与测试。
 *
 * @type {Readonly<Record<ModuleGroup, readonly ModuleGroup[]>>}
 */
export const MODULE_DEPENDENCIES = {
	domain: [],
	core: ['domain'],
	links: ['core', 'domain'],
	markdown: ['core', 'links', 'domain'],
	media: ['core', 'links', 'domain'],
	engine: ['core', 'domain'],
	platform: ['core', 'links', 'markdown', 'domain'],
	ui: ['core', 'links', 'media', 'domain'],
	services: [
		'core',
		'links',
		'markdown',
		'media',
		'engine',
		'platform',
		'domain',
	],
	features: [
		'core',
		'links',
		'markdown',
		'media',
		'engine',
		'platform',
		'ui',
		'services',
		'domain',
	],
};

/**
 * 组合根模块（`src/` 根层的文件名，不含扩展名）。
 *
 * 只能被组合根本身引用；下层引入口即违约。唯一豁免是**类型引用**
 * （视图上下文契约需要 settings 的类型，编译期擦除、无运行时耦合）——
 * 该豁免由本文件的 `COMBO_ROOT_SPECIFIER_PATTERN` 与边界测试共同表达。
 *
 * @type {readonly string[]}
 */
export const COMBO_ROOT_MODULES = Object.freeze([
	'main',
	'commands',
	'settings',
	'creation',
]);

/**
 * 某组允许依赖的全部组（含恒许的 domain），按层级顺序返回。
 *
 * @param {ModuleGroup} group 模块组
 * @returns {ModuleGroup[]} 许可集（去重后按 MODULE_GROUPS 顺序）
 */
export function allowedTargets(group) {
	const allowed = new Set(['domain', ...MODULE_DEPENDENCIES[group]]);
	return MODULE_GROUPS.filter((candidate) => allowed.has(candidate));
}

/**
 * 某组**禁止**依赖的同层组（供生成 lint 模式；不导出，属实现细节）。
 *
 * domain 有意不在此列：它是零依赖层，其余每一层都允许依赖它；若把它算进
 * 禁止集，core/links/… 会全部被禁止导入 domain，与矩阵正好相反。
 *
 * @param {ModuleGroup} group 模块组
 * @returns {ModuleGroup[]} 禁止集
 */
function forbiddenTargets(group) {
	const allowed = new Set(allowedTargets(group));
	return MODULE_GROUPS.filter(
		(candidate) => candidate !== group && !allowed.has(candidate),
	);
}

/**
 * 「任意深度的相对说明符」正则：`../x`、`../../x`、`../../../x` 命中同一模式。
 *
 * 为什么不用 `group: ['../x', '../x/*']`：`group` 是**字面量**匹配，只认得
 * 恰好一层 `../`——某组一旦新增子目录（`src/a/sub/x.ts` 写作 `../../x`），
 * 原有模式整体失效且**静默**放过。路径形态只在此处定义一次，跨组禁令与
 * 组合根禁令共用，避免两份正则各自漂移。
 *
 * @param {string} names 组名，或多个组名拼成的正则交替式（`a|b|c`）
 * @returns {string} 正则源码（ESLint patterns 的 `regex` 字段语义）
 */
function relativeSpecifierRegex(names) {
	// `(?:…)` 不可省：交替式必须整体成组，否则 `^…/main|commands|…` 会把
	// `commands` 变成顶层分支——`./commands`、`x/commands` 都会被误命中
	// （2026-10-17 重构时真实踩过：同一目录的 `./mindmap-commands` 被判成
	// 「引用组合根」）。单组名套一层非捕获组无副作用。
	return `^\\.\\./(?:\\.\\./)*(?:${names})(?:/|$)`;
}

/**
 * 该组禁止的 import 说明符模式（ESLint `no-restricted-imports` 的 patterns 片段）。
 *
 * @param {ModuleGroup} group 模块组
 * @returns {{ regex: string, message: string }[]} 模式列表
 */
export function forbiddenSpecifierPatterns(group) {
	// 文案对全组相同，只算一次（permitted 列表不随 target 变化）。
	const message = `src/${group}/ 只允许依赖 ${allowedTargets(group).join(' / ')}（依赖矩阵见 AGENTS.md K51）`;
	return forbiddenTargets(group).map((target) => ({
		regex: relativeSpecifierRegex(target),
		message,
	}));
}

/**
 * 组合根说明符模式：`../settings` 及任意深度形式。
 *
 * `allowTypeImports` 是 K51 的**类型引用豁免**，故与矩阵同置一处——边界测试
 * 判「值依赖」时用的是同一口径（`typeOnly` 边不参与组合根断言）。
 *
 * @type {{ regex: string, allowTypeImports: true, message: string }}
 */
export const COMBO_ROOT_SPECIFIER_PATTERN = Object.freeze({
	regex: relativeSpecifierRegex(COMBO_ROOT_MODULES.join('|')),
	allowTypeImports: true,
	message:
		'组合根（main/commands/settings/creation）只能被组合根本身引用（见 AGENTS.md K51）',
});
