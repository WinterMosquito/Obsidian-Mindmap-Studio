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
		// 默认 5 s：只有压力用例需要放宽，超时写在**用例级**
		// （md-roundtrip 的 5 万级深树 30 s / prism-code 的缓存填充 15 s）；
		// 全局放宽会掩盖其它慢/挂用例。
		testTimeout: 5_000,
		coverage: {
			provider: 'v8',
			// vendor 为预打包产物不测；i18n/constants 为纯文案/常量表
			// （文案键覆盖率无意义），一并排除。
			include: ['src/**/*.ts'],
			exclude: ['src/core/i18n.ts', 'src/core/constants.ts'],
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
