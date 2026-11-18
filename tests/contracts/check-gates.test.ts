/**
 * 门禁映射（`scripts/check-gates.mjs` 的 `buildPlan` / `parseExemptionRows`）直测。
 *
 * 为什么值得单独测：本脚本是 AGENTS.md「新增特性 · 校验」链的**可执行形态**，
 * 映射错了的后果是某道门禁**静默不跑**（历史上两次漏跑都是这个后果，见脚本文件头）。
 * 两个被测函数都是纯逻辑（变更集 / 表文本进、清单出），脚本主体有 import 守卫，
 * 因此 `import` 本文件不会真跑 npm 链。类型来自同目录的 `check-gates.d.mts`
 * （脚本是给 `node` 直接跑的 `.mjs`，不迁 TS）。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan, parseExemptionRows } from '../../scripts/check-gates.mjs';
import type { ExemptionRow, GatesPlan } from '../../scripts/check-gates.mjs';
import { buildNodeContentCompareSource } from '../../scripts/visual-node-content.mjs';

const labelsOf = (plan: GatesPlan): string[] =>
	plan.gates.map((gate) => gate.label);

describe('check:gates --fix-lines（真实脚本的索引写入位置）', () => {
	it('只回填 docs/agents/index.md，AGENTS.md 的内容保持逐字不变', () => {
		const fixture = mkdtempSync(join(tmpdir(), 'mindmap-index-gates-'));
		try {
			mkdirSync(join(fixture, 'scripts'));
			mkdirSync(join(fixture, 'src'));
			mkdirSync(join(fixture, 'docs/agents'), { recursive: true });
			writeFileSync(join(fixture, 'scripts/check-gates.mjs'), readFileSync(
				new URL('../../scripts/check-gates.mjs', import.meta.url), 'utf8',
			));
			writeFileSync(join(fixture, 'src/example.ts'), 'line one\nline two\n');
			const table = '| `src/example.ts` | 301 | 原有豁免理由 |\n';
			// 入口也放一张旧表：恢复旧路径时脚本会误改入口，本断言必须抓住它。
			const agents = '# AGENTS.md\n' + table;
			writeFileSync(join(fixture, 'AGENTS.md'), agents);
			writeFileSync(join(fixture, 'docs/agents/index.md'), '# 索引\n' + table);
			const result = spawnSync(process.execPath, [
				join(fixture, 'scripts/check-gates.mjs'), '--fix-lines',
			], { cwd: fixture, encoding: 'utf8' });
			expect(result.status, result.stdout + result.stderr).toBe(0);
			expect(readFileSync(join(fixture, 'docs/agents/index.md'), 'utf8')).toBe(
				'# 索引\n| `src/example.ts` | 2 | 原有豁免理由 |\n',
			);
			expect(readFileSync(join(fixture, 'AGENTS.md'), 'utf8')).toBe(agents);
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});

describe('buildPlan（变更集 → 门禁清单）', () => {
	it('baseline 恒跑且顺序固定（build → test → lint）', () => {
		expect(labelsOf(buildPlan([]))).toEqual([
			'npm run build',
			'npm test',
			'npm run lint',
		]);
	});

	it('styles.css 在变更集 → 加跑 lint:css', () => {
		expect(labelsOf(buildPlan(['styles.css']))).toContain('npm run lint:css');
	});

	it('src/ 或 tests/ 变更 → 加跑 dead-code（导出面无法从路径判断，宁多跑）', () => {
		for (const file of ['src/core/constants.ts', 'tests/setup.ts']) {
			expect(labelsOf(buildPlan([file]))).toContain('npm run check:dead-code');
		}
	});

	it('vendor 源 / 补丁 → 加跑 build:vendor；vendor 下的其它文件不触发', () => {
		for (const file of [
			'vendor/patches/01-x.patch',
			'vendor/upstream/src/utils/index.js',
		]) {
			expect(labelsOf(buildPlan([file]))).toContain('npm run build:vendor');
		}
		expect(labelsOf(buildPlan(['vendor/BUILD.md']))).not.toContain(
			'npm run build:vendor',
		);
	});

	it('自绘判据 / 节点渲染 / 探针 → 加跑 verify:visual，理由带上命中文件', () => {
		const plan = buildPlan(['src/features/content/node-inline-content.ts']);
		const gate = plan.gates.find((item) =>
			item.label.startsWith('npm run verify:visual'),
		);

		expect(gate).toBeDefined();
		expect(gate?.why).toContain('src/features/content/node-inline-content.ts');
	});

	it('发布元数据 → 加跑 check:release（README / manifest / versions / LICENSE / release-notes）', () => {
		for (const file of [
			'README.md',
			'README.zh-CN.md',
			'manifest.json',
			'versions.json',
			'LICENSE',
			'docs/release-notes-0.2.4.md',
		]) {
			expect(labelsOf(buildPlan([file]))).toContain('npm run check:release');
		}
	});

	it('变更集不可读（null）→ 附加门禁全部按全跑处理', () => {
		const plan = buildPlan(null);

		expect(labelsOf(plan)).toHaveLength(8); // 3 个 baseline + 5 个 conditional
		expect(plan.skipped).toEqual([]);
	});

	it('--all → 附加门禁全跑，且不看变更集', () => {
		const plan = buildPlan([], { all: true });

		expect(labelsOf(plan)).toHaveLength(8);
		expect(plan.skipped).toEqual([]);
	});

	it('未触发的门禁进入 skipped，且每条都带跳过理由', () => {
		const plan = buildPlan(['src/core/constants.ts']);

		expect(plan.skipped.map((gate) => gate.label)).toEqual([
			'npm run lint:css',
			'npm run build:vendor',
			'npm run verify:visual -- --require-chrome',
			'npm run check:release',
		]);
		expect(plan.skipped.every((gate) => gate.note.length > 0)).toBe(true);
	});

	it('每条门禁都有可打印的 label / args / 非空字符串理由', () => {
		for (const gate of buildPlan(['styles.css', 'README.md']).gates) {
			expect(typeof gate.label).toBe('string');
			expect(Array.isArray(gate.args)).toBe(true);
			expect(typeof gate.why).toBe('string');
			expect(gate.why.length).toBeGreaterThan(0);
		}
	});
});

describe('parseExemptionRows（豁免表行形态）', () => {
	it('解析路径与登记行数；磁盘上不存在的登记标为 stale', () => {
		const rows: Map<string, ExemptionRow> = parseExemptionRows(
			[
				'| `src/core/constants.ts` | 790 | 理由 |',
				'| `src/nope/missing.ts` | 301 | 理由 |',
				'| 不是表行 | x |',
			].join('\n'),
		);

		expect(rows.get('src/core/constants.ts')).toEqual({
			declared: 790,
			stale: false,
		});
		expect(rows.get('src/nope/missing.ts')).toEqual({
			declared: 301,
			stale: true,
		});
		expect(rows.size).toBe(2);
	});
});


describe('组件 CSS 与构建门禁', () => {
	it.each(['styles.css', 'src/styles/index.css', 'src/ui/toolbar/toolbar.css', 'src/ui/search/search-bar.css', 'config/esbuild.config.mjs'])(
		'%s 同时触发 CSS lint 与真实视觉验证', (file) => {
			const labels = labelsOf(buildPlan([file]));
			expect(labels).toContain('npm run lint:css');
			expect(labels).toContain('npm run verify:visual -- --require-chrome');
		},
	);
	it.each(['src/ui/toolbar/toolbar.ts', 'src/ui/search/search-bar.ts', 'src/features/view/view-toolbar.ts', 'src/features/view/view-search.ts', 'scripts/visual-ui.mjs', 'scripts/visual-canvas-drag.mjs', 'scripts/visual-minimap-sidebar.mjs', 'scripts/chrome-page.mjs', 'src/core/minimap-geometry.ts', 'src/engine/mindmap-minimap.ts', 'src/features/view/view-minimap.ts', 'src/platform/workspace/minimap-sidebar.ts', 'src/ui/node-editor/node-editor.ts', 'src/ui/node-editor/node-editor.styles.ts', 'src/domain/node-edit-key.ts', 'src/ui/node-content/content-quote.ts', 'src/ui/node-content/content-code.styles.ts', 'src/core/node-content-types.ts', 'scripts/visual-node-content.mjs'])(
		'%s 触发组件 DOM 验证', (file) => {
			expect(labelsOf(buildPlan([file]))).toContain('npm run verify:visual -- --require-chrome');
		},
	);
});

describe('工具配置迁移后的门禁', () => {
	it('Stylelint 规则配置变化会运行 CSS 检查', () => {
		expect(labelsOf(buildPlan(['config/stylelint.config.mjs']))).toContain('npm run lint:css');
	});
	it.each(['config/knip.json', 'config/esbuild.config.mjs', 'package.json'])(
		'%s 变化会运行死代码检查', (file) => {
			expect(labelsOf(buildPlan([file]))).toContain('npm run check:dead-code');
		},
	);
});


describe('能力子目录的视觉门禁', () => {
	it.each([
		'src/features/content/node-inline-html.ts',
		'src/features/content/content-remeasure.ts',
		'src/features/editing/node-inline-editor.ts',
		'src/features/canvas/drag-session.ts',
		'src/features/media/image-resize.ts',
		'src/features/relations/node-pick.ts',
		'src/platform/rendering/mermaid.ts',
		'src/platform/rendering/callout-icon.ts',
		'src/platform/rendering/code/prism-code-color-probe.ts',
		'src/platform/rendering/math/math-jax-export.ts',
	])('%s 不因迁移漏跑视觉验证', (file) => {
		expect(labelsOf(buildPlan([file]))).toContain('npm run verify:visual -- --require-chrome');
	});
});

describe('视觉比较的独立 HEAD 快照', () => {
	it.each(['src/features/node-inline-html.ts', 'src/features/content/node-inline-html.ts'])(
		'HEAD 使用 %s 时仍导入基线快照', (entry) => {
			const fixture = mkdtempSync(join(tmpdir(), 'mindmap-content-baseline-'));
			try {
				const baseline = join(fixture, 'baseline');
				const target = join(baseline, entry);
				mkdirSync(join(target, '..'), { recursive: true });
				writeFileSync(target, '// independent snapshot');
				const source = buildNodeContentCompareSource(join(fixture, 'current'), baseline);
				expect(source).toContain(`import * as before from ${JSON.stringify(target.replaceAll('\\', '/'))}`);
				expect(source).toContain('/current/src/features/content/node-inline-html.ts');
			} finally {
				rmSync(fixture, { recursive: true, force: true });
			}
		},
	);
	it('快照入口缺失立即失败，不用当前源码代替基线', () => {
		const fixture = mkdtempSync(join(tmpdir(), 'mindmap-content-baseline-missing-'));
		try {
			expect(() => buildNodeContentCompareSource(fixture, join(fixture, 'missing'))).toThrow('HEAD 快照缺少节点内容入口');
		} finally {
			rmSync(fixture, { recursive: true, force: true });
		}
	});
});
