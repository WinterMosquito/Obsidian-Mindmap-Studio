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
import { buildPlan, parseExemptionRows } from '../scripts/check-gates.mjs';
import type { ExemptionRow, GatesPlan } from '../scripts/check-gates.mjs';

const labelsOf = (plan: GatesPlan): string[] =>
	plan.gates.map((gate) => gate.label);

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
		const plan = buildPlan(['src/features/node-inline-content.ts']);
		const gate = plan.gates.find((item) =>
			item.label.startsWith('npm run verify:visual'),
		);

		expect(gate).toBeDefined();
		expect(gate?.why).toContain('src/features/node-inline-content.ts');
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
