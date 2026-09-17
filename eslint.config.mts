/* 本项目的 ESLint 配置，基于 eslint-plugin-obsidianmd ^0.4.2。
   0.4.2 起 recommended 为自包含清单：已含 ESLint core、typescript-eslint
   recommendedTypeChecked（含 no-floating-promises）、全部 obsidianmd 规则与
   Obsidian globals——勿再展开 tseslint 清单（会报 plugin 重定义）。
   参见插件 docs/configuration.md。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { parser } from 'typescript-eslint';
import { plainTextParser } from './scripts/plain-text-parser.mjs';
import { globalIgnores, defineConfig } from 'eslint/config';

/**
 * `manifest.json` 的 `minAppVersion`（唯一真源，不在此重复字面量）。
 *
 * 供下方 `obsidianmd/no-unsupported-api` 块使用：该规则的 `minAppVersion` 默认由
 * 插件从 **cwd** 相对读取 `manifest.json`（`lib/manifest.ts`），换 cwd 会整条静默
 * 关闭。规则 options 优先于 manifest，故显式传入即切断这条 cwd 依赖。
 */
const MIN_APP_VERSION = (
	JSON.parse(
		readFileSync(join(import.meta.dirname, 'manifest.json'), 'utf8'),
	) as { minAppVersion: string }
).minAppVersion;

/**
 * 官方 `@typescript-eslint/no-restricted-imports` 的依赖禁令（7 个包）。
 *
 * **为什么需要它**：ESLint 的规则配置是**替换而非合并**。官方 recommended 以
 * `["warn", ...restrictedImportsOptions]` 配置该规则（legacy 数组形式），而本配置的
 * 9 个模块边界块与 domain 块改用 `['error', { patterns }]` 形式——两种形式不能共存于
 * 同一份配置，于是官方的这 7 条禁令会在 `src/**` 上**整体消失**。
 * 这里按官方 `lib/ruleOptions.ts` 的 7 个包逐一转为 `patterns` 条目（官方用 `name`，
 * 本配置统一用 `group`，语义等价且能一并覆盖子路径），前缀接入各块。
 *
 * **维护底线**：本表条目数不得少于官方——少一条就是一次静默放宽。
 */
const OFFICIAL_RESTRICTED_IMPORT_PATTERNS = [
	{
		group: ['axios'],
		message: 'Use the built-in `requestUrl` function instead of `axios`.',
	},
	{
		group: ['superagent'],
		message: 'Use the built-in `requestUrl` function instead of `superagent`.',
	},
	{
		group: ['got'],
		message: 'Use the built-in `requestUrl` function instead of `got`.',
	},
	{
		group: ['ofetch'],
		message: 'Use the built-in `requestUrl` function instead of `ofetch`.',
	},
	{
		group: ['ky'],
		message: 'Use the built-in `requestUrl` function instead of `ky`.',
	},
	{
		group: ['node-fetch'],
		message: 'Use the built-in `requestUrl` function instead of `node-fetch`.',
	},
	{
		group: ['moment'],
		allowTypeImports: true,
		message:
			"The 'moment' package is bundled with Obsidian. Import the `moment` value from 'obsidian' instead (type-only imports from 'moment' are allowed).",
	},
];

/* —— 模块依赖矩阵（K51）机械强制 ——
   L1/L2 各模块组只允许依赖矩阵许可集（见 AGENTS.md K51）；组内相对引用
   （./x）不受影响。组合根（main/commands/settings/creation）只能被组合根
   引用，下层引入口在此拦下。 */
type ModuleGroup =
	| 'core'
	| 'links'
	| 'markdown'
	| 'media'
	| 'engine'
	| 'platform'
	| 'ui'
	| 'services'
	| 'features';

const ALL_GROUPS: ModuleGroup[] = [
	'core',
	'links',
	'markdown',
	'media',
	'engine',
	'platform',
	'ui',
	'services',
	'features',
];

const COMBO_ROOT_PATTERNS = ['../main', '../commands', '../settings', '../creation'];

/** 生成一个模块组的边界块：allowed 之外的同层组与组合根一律禁止 */
function boundary(group: ModuleGroup, allowed: ModuleGroup[]) {
	const forbidden = ALL_GROUPS.filter((g) => g !== group && !allowed.includes(g));
	const patterns = [
		// 官方 7 条依赖禁令必须先接入：该规则是**替换**语义，
		// 只写下面项目自有 patterns 会把官方禁令整体挤掉（见本表注释）。
		...OFFICIAL_RESTRICTED_IMPORT_PATTERNS,
		...(forbidden.length > 0
			? [
					{
						group: forbidden.flatMap((g) => [
							`../${g}`,
							`../${g}/*`,
							`../${g}/**`,
						]),
						message: `src/${group}/ 只允许依赖 ${['domain', ...allowed].join(' / ')}（依赖矩阵见 AGENTS.md K51）`,
					},
				]
			: []),
		{
			group: COMBO_ROOT_PATTERNS,
			// 类型引用豁免：视图上下文契约需要 settings 的类型（编译期擦除、
			// 无运行时耦合）；值导入仍一律禁止。
			allowTypeImports: true,
			message:
				'组合根（main/commands/settings/creation）只能被组合根本身引用（见 K51）',
		},
	];
	return {
		files: [`src/${group}/**/*.ts`],
		rules: {
			'@typescript-eslint/no-restricted-imports': ['error', { patterns }],
		},
	};
}

const moduleBoundaryBlocks = [
	boundary('core', ['domain']),
	boundary('links', ['core', 'domain']),
	boundary('markdown', ['core', 'links', 'domain']),
	boundary('media', ['core', 'links', 'domain']),
	boundary('engine', ['core', 'domain']),
	boundary('platform', ['core', 'links', 'markdown', 'domain']),
	boundary('ui', ['core', 'links', 'media', 'domain']),
	boundary('services', [
		'core',
		'links',
		'markdown',
		'media',
		'engine',
		'platform',
		'domain',
	]),
	boundary('features', [
		'core',
		'links',
		'markdown',
		'media',
		'engine',
		'platform',
		'ui',
		'services',
		'domain',
	]),
];

export default defineConfig(
	globalIgnores([
		'node_modules',
		'coverage',
		'dist',
		// 只排除预打包的第三方产物；手写的类型声明 vendor/simple-mind-map.d.cts
		// 是项目维护的公共契约面（见下方 vendor 块），不随之一并排除。
		'vendor/*.cjs',
		'scripts/**',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package-lock.json',
		'tsconfig.json',
		'vitest.config.ts',
	]),
	...obsidianmd.configs.recommended,
	{
		// 官方 recommended 仅给 package.json 挂 JSON 语言块，manifest.json 不会被
		// `eslint .` 自动拾取；显式纳入以激活 obsidianmd/validate-manifest
		// （必填键/类型/禁词 obsidian·plugin/描述格式校验，warning 级与官方一致）。
		files: ['manifest.json'],
		languageOptions: {
			parser,
			parserOptions: {
				extraFileExtensions: ['.json'],
			},
		},
		rules: {
			'obsidianmd/validate-manifest': 'warn',
		},
	},
	{
		// LICENSE 校验：官方 validate-license 依赖插件内置的 plain-text parser，
		// 该 parser 未导出且未挂入 recommended 配置，故自备等价行级 parser
		// （scripts/plain-text-parser.mjs）。防止未来误换回官方样板版权行
		// （Dynalist Inc.）或版权年份过期。
		files: ['LICENSE'],
		languageOptions: {
			parser: plainTextParser,
		},
		rules: {
			'obsidianmd/validate-license': 'warn',
		},
	},
	{
		// 手写类型声明 vendor/simple-mind-map.d.cts（项目维护，非第三方产物）
		// 纳入 lint——由上方 globalIgnores 收窄为只排除 vendor/*.cjs 而来。
		// 引擎节点数据面本质是任意 JSON，`AnyObject = Record<string, any>` 必须
		// 用 any 表达，无法改成 unknown（带具名属性的对象不可赋给
		// Record<string, unknown>，改动会波及全插件）。这里用**配置级 off**，
		// 而非 eslint-disable 注释：recommended 的
		// eslint-comments/no-restricted-disable 禁止 disable no-explicit-any。
		files: ['vendor/**/*.d.cts', 'vendor/*.d.cts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
						// 项目自撰的 stylelint 配置（规则面照抄官方 scanner，
						// 见该文件顶部说明）。模板照抄来的 esbuild.config.mjs /
						// version-bump.mjs 走 globalIgnores，本文件不属那一类。
						'stylelint.config.mjs',
					],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	{
		files: ['src/domain/**/*.ts'],
		rules: {
			// domain 是纯领域逻辑层：零依赖（标准库除外），可在纯 Node 环境单测。
			// 引擎类型黏合（MdNodeData）放 src/core/node-data.ts，不放 domain。
			// 用 @typescript-eslint 变体：对 TS 解析更准确，且 core 版不识别
			// allowTypeImports（组合根的类型引用要豁免）。
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						// 官方 7 条依赖禁令（替换语义下必须自带，见本表注释）
						...OFFICIAL_RESTRICTED_IMPORT_PATTERNS,
						{
							group: ['..', '../*', '../**'],
							message: 'domain 不得反向依赖上层模块或 vendor（黏合类型放 src 根层）',
						},
						{
							group: ['obsidian', 'obsidian/*'],
							message: 'domain 不得依赖 Obsidian API',
						},
						{
							// 「零依赖」的**裸说明符**闭包：上面两条只管相对路径与
							// obsidian，npm 包与 node 内建此前无人拦；而本可兜底的
							// `obsidianmd/no-nodejs-modules` 因 manifest 的
							// `isDesktopOnly: true` 被判为 off（见插件 lib/index.ts）。
							//
							// 用 `regex` 而不是 `group: ['*']`：core 的 group 匹配以
							// `allowRelativePaths: true` 配置 ignore（见 eslint/lib/
							// rules/no-restricted-imports.js），实测 `['*']` **会**命中
							// `./md-meta` 这类组内相对引用（曾据此误报 2 处）。故用正则
							// 排除「相对 / 绝对 / obsidian」三种前缀，只留裸说明符——
							// 覆盖 `lodash`、`node:fs/promises` 等。
							regex: '^(?!\\.)(?!/)(?!obsidian(?:/|$)).+$',
							message:
								'domain 是零依赖层：不得导入任何外部包（npm 包 / node 内建）',
						},
					],
				},
			],
		},
	},
	...moduleBoundaryBlocks,
	{
		// 库内文件解析统一走 links-resolve.resolvePathToFile（形态路由与索引
		// 兜底只在统一入口维护，散落直调会在新增解析规则时静默掉队）。
		// 确需直调的场景（存在性检查等）用 eslint-disable 注明理由。
		// 覆盖全部插件代码；收口点本体 links-resolve / file-lookup 豁免。
		files: ['src/**/*.ts'],
		ignores: ['src/links/links-resolve.ts', 'src/links/file-lookup.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector: "MemberExpression[property.name='getAbstractFileByPath']",
					message:
						'库内文件解析请走 links-resolve.resolvePathToFile；存在性检查等特例需 eslint-disable 并注明理由',
				},
			],
		},
	},
	{
		// `no-unsupported-api` 判定基准的**显式化**：规则默认从 cwd 相对读取
		// `manifest.json`（插件 lib/manifest.ts 用裸相对路径 + 模块级缓存）。
		// 任何 cwd ≠ 仓库根的调用（IDE/编辑器 ESLint 集成、从上级目录跑 eslint）
		// 会让读盘失败 → resolvedVersion undefined → 规则 `return {}` **整条静默
		// 关闭**，同时 manifest 为 null 还会把 `no-nodejs-modules` 由 off 翻成 warn、
		// 撤掉 globals.node，从而把 src/platform/system-open.ts 的裸 `require`
		// 报成 no-undef（假阳性）。
		// 规则内为 `options.minAppVersion ?? manifest.minAppVersion`，故在此显式传入
		// 即切断 cwd 依赖（值取自 manifest.json 本身，见文件头的 MIN_APP_VERSION）。
		files: ['src/**/*.ts'],
		rules: {
			'obsidianmd/no-unsupported-api': [
				'error',
				{ minAppVersion: MIN_APP_VERSION },
			],
		},
	},
	{
		files: ['tests/**/*.ts'],
		rules: {
			// 测试桩与回归脚本不在 Obsidian 插件运行时上下文，无需遵守「避免 console」条款。
			'obsidianmd/rule-custom-message': 'off',
			// tests/setup.ts 把 window 桩到 globalThis（Node 测试环境无 window，
			// concurrency 原语的 window.setTimeout 需落到可被 fake timers 拦截的定时器）。
			'obsidianmd/no-global-this': 'off',
		},
	},
);
