/* 本项目的 ESLint 配置，基于 eslint-plugin-obsidianmd ^0.4.2。
   0.4.2 起 recommended 为自包含清单：已含 ESLint core、typescript-eslint
   recommendedTypeChecked（含 no-floating-promises）、全部 obsidianmd 规则与
   Obsidian globals——勿再展开 tseslint 清单（会报 plugin 重定义）。
   参见插件 docs/configuration.md。 */
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { parser } from 'typescript-eslint';
import { plainTextParser } from './scripts/plain-text-parser.mjs';
import { globalIgnores, defineConfig } from 'eslint/config';

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
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
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
			// 引擎类型黏合（MdNodeData）放 src/node-data.ts，不放 domain。
			// 用 @typescript-eslint 变体：对 TS 解析更准确，且与 master 推荐的
			// restrictedImportsOptions 同源（core 版不识别 allowTypeImports）。
			'@typescript-eslint/no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['..', '../*', '../**'],
							message: 'domain 不得反向依赖上层模块或 vendor（黏合类型放 src 根层）',
						},
						{
							group: ['obsidian', 'obsidian/*'],
							message: 'domain 不得依赖 Obsidian API',
						},
					],
				},
			],
		},
	},
	{
		files: ['src/features/**/*.ts', 'src/modal-*.ts', 'src/services/**/*.ts'],
		rules: {
			// 库内文件解析统一走 links-resolve.resolvePathToFile（形态路由与索引
			// 兜底只在统一入口维护，散落直调会在新增解析规则时静默掉队）。
			// 确需直调的场景（存在性检查等）用 eslint-disable 注明理由。
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
		// src 根层：与 features/modal/services 同规（统一入口 links-resolve.ts
		// 与其索引原语 file-lookup.ts 豁免——它们就是收口点本体）。
		files: ['src/*.ts'],
		ignores: ['src/links-resolve.ts', 'src/file-lookup.ts'],
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
