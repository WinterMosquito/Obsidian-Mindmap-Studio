/**
 * Stylelint 配置：本地等价于官方社区目录 scanner 的 CSS 检查。
 *
 * **为什么需要它**：`styles.css` 是发布资产之一，而本仓库此前只跑 ESLint
 * （无 CSS 语言块）；官方 `obsidianmd/obsidian-workflows` 在 release 模式下
 * **强制**跑 scanner stylelint（`obsidian-workflows-main/src/lint.ts:246-329`、
 * `:565`，目标 `**\/*.css`）⇒ `styles.css` 是「scanner 会查、本地完全不查」的
 * 唯一资产（见 `docs/compliance-audit-2026-09-17.md` V5）。
 *
 * 规则照抄官方 `src/lint.ts:10-123` 的 `SCANNER_STYLELINT_CONFIG`，有意差异仅三处：
 * 1. 警告文案改为自述口径（官方文案面向主题作者，含其文档链接）；
 * 2. `ignoreFiles` 只保留生成物（官方那份的 ignoreFiles 服务于整仓库扫描）；
 * 3. 结构与官方一致——**独立配置、无 `extends`**（官方那份也不继承任何预设），
 *    故未被列出的规则一律不启用，与 scanner 的检查面相同。
 *
 * `browsers: ['electron >= 39']` 由 `minAppVersion: 1.13.0` 经官方
 * `ELECTRON_VERSIONS` 映射表推得（`src/lint.ts:126-160`：1.11.4 ≤ 1.13.0 → 39）。
 * **修改 minAppVersion 时必须同步此值**，否则浏览器特性判定会偏离官方口径。
 */
export default {
	plugins: ['stylelint-no-unsupported-browser-features'],
	// 官方同样开启：禁止用 stylelint-disable 注释压掉 scanner 规则
	ignoreDisables: true,
	// 只排除生成物：coverage/ 是 lcov 的 HTML 报告（含 base.css / prettify.css），
	// 不属插件资产；node_modules 本就默认排除，此处显式写出以免读者误判。
	ignoreFiles: ['coverage/**', 'node_modules/**'],
	rules: {
		// —— 唯一 error 级规则：禁止外链资源（主题/插件不得从网络加载资源）——
		'function-url-scheme-disallowed-list': [
			['http', 'https', 'file'],
			{
				severity: 'error',
				message:
					'External URLs are not allowed — inline images & fonts as base64 or ship them inside the vault.',
			},
		],
		'function-url-scheme-allowed-list': ['data'],
		// —— 以下均为 warning（官方口径）——
		'declaration-no-important': [
			true,
			{
				severity: 'warning',
				message:
					'Avoid !important — override by raising selector specificity or using Obsidian CSS variables.',
			},
		],
		'color-named': [
			'never',
			{
				severity: 'warning',
				message:
					'Use hex colors or Obsidian CSS variables instead of named colors, so light/dark both work.',
			},
		],
		'declaration-block-no-duplicate-properties': [
			true,
			{ severity: 'warning' },
		],
		'plugin/no-unsupported-browser-features': [
			true,
			{
				severity: 'warning',
				browsers: ['electron >= 39'],
				ignore: ['css-nesting', 'css-cascade-layers'],
			},
		],
		'selector-pseudo-class-disallowed-list': [
			['has'],
			{
				severity: 'warning',
				message:
					'Avoid :has() — broad selector invalidation can cause significant performance issues.',
			},
		],
		'selector-pseudo-class-no-unknown': [
			true,
			{
				ignorePseudoClasses: ['global', 'local'],
				severity: 'warning',
			},
		],
		'selector-pseudo-element-no-unknown': [true, { severity: 'warning' }],
		'selector-type-no-unknown': [
			true,
			{ ignoreTypes: [], severity: 'warning' },
		],
		'at-rule-no-unknown': [
			true,
			{
				ignoreAtRules: ['layer', 'property', 'container'],
				severity: 'warning',
			},
		],
		'unit-no-unknown': [true, { severity: 'warning' }],
		'property-disallowed-list': [['all'], { severity: 'warning' }],
		// 显式关闭（官方同样置 null）：这些规则在标准配置里默认开启，
		// 但 scanner 不管，故此处也保持不管，避免本地比目录更严导致无谓返工。
		'custom-property-no-missing-var-function': null,
		'no-duplicate-selectors': null,
		'no-duplicate-at-import-rules': null,
		'shorthand-property-no-redundant-values': null,
	},
};
