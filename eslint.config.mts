import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'vendor/**',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'vitest.config.ts',
	]),
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
	// typescript-eslint recommended + no-floating-promises
	...tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		rules: {
			// 阻止「忘记 await Promise」类静默 bug；项目逐步启用中（src 全量已纳入）
			'@typescript-eslint/no-floating-promises': 'error',
		},
	},
	{
		files: ['src/features/view-attachments.ts'],
		languageOptions: {
			globals: {
				// require('electron') 是 Obsidian 桌面插件获取系统 API 的标准做法，
				// 由 esbuild 按 CommonJS 解析，仅在 Platform.isDesktopApp 分支使用
				require: 'readonly',
			},
		},
	},
	...obsidianmd.configs.recommended,
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
		},
	},
);