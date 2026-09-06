/* 本项目的 ESLint 配置，基于 eslint-plugin-obsidianmd ^0.4.2。
   0.4.2 起 recommended 为自包含清单：已含 ESLint core、typescript-eslint
   recommendedTypeChecked（含 no-floating-promises）、全部 obsidianmd 规则与
   Obsidian globals——勿再展开 tseslint 清单（会报 plugin 重定义）。
   参见插件 docs/configuration.md。 */
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'vendor/**',
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
			'no-restricted-imports': [
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
		files: ['src/system-open.ts'],
		languageOptions: {
			globals: {
				// require('electron') 是 Obsidian 桌面插件获取系统 API 的标准做法，
				// 由 esbuild 按 CommonJS 解析，仅在 Platform.isDesktopApp 分支使用
				require: 'readonly',
			},
		},
	},
	{
		files: ['src/modal-*.ts'],
		rules: {
			// 弹窗样式沿用原版内联样式方案（含动态值：颜色预设、字号选项等），
			// 由样式常量集中管理，故关闭静态样式类检查。
			'obsidianmd/no-static-styles-assignment': 'off',
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
