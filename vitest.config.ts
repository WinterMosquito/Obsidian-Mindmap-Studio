import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * vitest 配置：
 * - environment: node（回归测试只覆盖解析/序列化纯逻辑，不涉 DOM）
 * - alias obsidian → tests/mocks/obsidian.ts：obsidian 包仅有类型声明（无运行时 JS），
 *   与原先 scratch/md-roundtrip/build-test.mjs 的 esbuild alias 等价。
 */
export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		setupFiles: ['tests/setup.ts'],
		// 回归套件含 5 万级深树用例，放宽单测超时
		testTimeout: 30_000,
		coverage: {
			provider: 'v8',
			// vendor 为预打包产物不测；i18n/constants 为纯文案/常量表
			// （文案键覆盖率无意义），一并排除。
			include: ['src/**/*.ts'],
			exclude: ['src/i18n.ts', 'src/constants.ts'],
			reporter: ['text', 'html', 'lcov'],
			reportsDirectory: 'coverage',
		},
	},
	resolve: {
		alias: {
			obsidian: path.resolve(import.meta.dirname, 'tests/mocks/obsidian.ts'),
		},
	},
});
