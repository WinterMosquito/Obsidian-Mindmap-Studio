#!/usr/bin/env node
/**
 * 变更驱动门禁执行器（`npm run check:gates`）。
 *
 * **解决什么**：AGENTS.md「新增特性 · 校验」链是一条散文（「改过 X 加跑 Y」），
 * 历史上多次漏跑（2026-10-11 与 2026-10-23 的两次补记都是「门禁转红而没在提交前
 * 跑到」）。本脚本把该链变成执行题：按 git 变更集算出本次需要哪些门禁并顺序执行，
 * 首败即停（与链的「顺序执行，全绿才提交」同语义）。
 *
 * **与 AGENTS.md 的关系**：本文件的「门禁映射」是校验链的**可执行形态**，不是第二
 * 权威——改校验链（增删门禁 / 改触发条件）必须同步本文件，反之亦然。映射有意取
 * **保守超集**：
 * - `check:dead-code`：链上只在「新增/删除导出或文件」时跑，但导出面是否变更无法
 *   从路径判断，knip 开销小，故 src/tests 任一变更即跑（K57）；
 * - `docs-standard` / `agents-md-sync` / `module-boundaries` / `vendor-contract`
 *   都是 vitest 用例，已在 `npm test` 内，不单列（避免双跑）。
 *
 * **豁免表行数对账**（附带静态核对，每次都跑）：
 * - 行数漂移：登记值 vs 实测（口径 = `tests/agents-md-sync.test.ts` 的
 *   `countSourceLines`；`--fix-lines` 把 AGENTS.md 与 `docs/agents/architecture.md`
 *   两表回填为实测值——两表必须同批，历史数次「漏改表格单元」都出在只改一张）；
 * - 未登记超限：`src/` 下超 300 行的 .ts 而不在豁免表 → 红灯（硬规则 10「未登记的
 *   超限文件数只允许递减」；agents-md-sync 测试只守漂移阈值、不校验总数，这里补上
 *   机器核对）。
 *
 * 用法：
 *   npm run check:gates                 # 算链并执行（提交前跑）
 *   npm run check:gates -- --dry-run    # 只打印计划与静态核对，不执行
 *   npm run check:gates -- --all        # 附加门禁全跑（拿不准触发条件时用）
 *   npm run check:gates -- --fix-lines  # 只做豁免表行数回填（两表同批），不跑门禁
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_REL = 'AGENTS.md';
const ARCHITECTURE_REL = 'docs/agents/architecture.md';

/**
 * 豁免表行（两张表同构）：`| `src/x.ts` | NNN | 理由… |`。
 *
 * 分组固定：1 = 行前缀（到数字前）、2 = 路径、3 = 登记行数、4 = 数字后到竖线。
 * **解析与回填共用这一份**——此前回填另写一条字面正则，改表形态时会只改到一处。
 */
const EXEMPTION_ROW_RE = /^(\|\s*`(src\/[^`]+\.ts)`\s*\|\s*)(\d+)(\s*\|)/;

/** verify:visual 的触发面 = 自绘判据 / 节点渲染 / 探针脚本（AGENTS.md 校验链措辞的路径化） */
const VISUAL_MATCHERS = [
	'scripts/verify-visual.mjs',
	'src/features/node-',
	'src/features/mindmap-codeblock.ts',
	'src/domain/pipe-table.ts',
	'src/platform/prism-code.ts',
	'src/platform/math-jax',
];

const flags = process.argv.slice(2);
if (flags.includes('--help') || flags.includes('-h')) {
	console.log(`用法：
  npm run check:gates                 # 按 git 变更集算门禁并顺序执行
  npm run check:gates -- --dry-run    # 只打印计划与静态核对，不执行
  npm run check:gates -- --all        # 附加门禁全跑
  npm run check:gates -- --fix-lines  # 只回填豁免表行数（AGENTS.md + architecture.md）`);
	process.exit(0);
}

/** 行数口径与 tests/agents-md-sync.test.ts 的 countSourceLines 一致（末尾换行不计行） */
function countSourceLines(absPath) {
	try {
		const lines = readFileSync(absPath, 'utf8').split('\n');
		if (lines.length > 0 && lines[lines.length - 1] === '') {
			lines.pop();
		}
		return lines.length;
	} catch {
		return null;
	}
}

/** git 变更集（含未跟踪文件；-z 免转义，重命名占两个字段、两侧都收进触发面） */
function gitChangedFiles() {
	const res = spawnSync(
		'git',
		['status', '--porcelain=v1', '-z', '--untracked-files=all', '--'],
		{ cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
	);
	if (res.error || res.status !== 0 || typeof res.stdout !== 'string') {
		return null;
	}
	const fields = res.stdout.split('\0');
	const files = [];
	for (let i = 0; i < fields.length; i++) {
		const entry = fields[i];
		if (!entry || entry.length < 4) {
			continue;
		}
		const path = entry.slice(3).split('\\').join('/');
		if (path) {
			files.push(path);
		}
		if (entry[0] === 'R' || entry[0] === 'C') {
			const other = (fields[i + 1] ?? '').split('\\').join('/');
			i += 1;
			if (other) {
				files.push(other);
			}
		}
	}
	return [...new Set(files)];
}

/** 递归收集 src/ 下全部 .ts（返回 posix 相对路径） */
function listSrcTsFiles() {
	const out = [];
	const walk = (rel) => {
		for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
			const child = `${rel}/${entry.name}`;
			if (entry.isDirectory()) {
				walk(child);
			} else if (entry.name.endsWith('.ts')) {
				out.push(child);
			}
		}
	};
	walk('src');
	return out;
}

/**
 * 解析一张豁免表：Map<posix 相对路径, { declared, stale }>。
 * stale = 登记的文件在磁盘上已不存在（本次不自动删行，只留痕交人工清理）。
 */
export function parseExemptionRows(text) {
	const rows = new Map();
	for (const line of text.split('\n')) {
		const match = EXEMPTION_ROW_RE.exec(line);
		const rel = match?.[2];
		const declared = match?.[3];
		if (rel === undefined || declared === undefined) {
			continue;
		}
		rows.set(rel, {
			declared: Number(declared),
			stale: countSourceLines(join(ROOT, rel)) === null,
		});
	}
	return rows;
}

/** 回填一张表的行数列（只改既有文件的数字；返回 {text, changed}） */
function fixExemptionTable(relPath) {
	const abs = join(ROOT, relPath);
	const text = readFileSync(abs, 'utf8');
	const lines = text.split('\n');
	const updates = [];
	const fixed = lines.map((line) => {
		const match = EXEMPTION_ROW_RE.exec(line);
		const rel = match?.[2];
		const declared = match?.[3];
		if (rel === undefined || declared === undefined) {
			return line;
		}
		const actual = countSourceLines(join(ROOT, rel));
		if (actual === null || actual === Number(declared)) {
			return line;
		}
		updates.push(`${rel}：${declared} → ${actual}`);
		return line.replace(EXEMPTION_ROW_RE, `$1${actual}$4`);
	});
	if (updates.length === 0) {
		return { updates };
	}
	writeFileSync(abs, fixed.join('\n'));
	return { updates };
}

/**
 * 门禁映射（AGENTS.md「新增特性 · 校验」链的可执行形态）。
 *
 * baseline 恒跑；conditional 按 git 变更集命中触发。返回 `{ gates, skipped }`——
 * 「跳过理由」也由本处**同一条定义**产出（此前 main 里另写了一份 5 条清单，
 * 改门禁名/触发面时要改两处，正是本文件要消除的漂移面）。
 *
 * @param changed git 变更集（posix 相对路径）；`null` = 不可读 ⇒ 附加门禁保守全跑
 * @param options.all 不看变更集，附加门禁全跑
 */
export function buildPlan(changed, { all } = { all: false }) {
	const baseline = [
		{ args: ['run', 'build'], label: 'npm run build', why: '基线（tsc + esbuild）' },
		{ args: ['test'], label: 'npm test', why: '基线（含 agents-md-sync / module-boundaries / vendor-contract / docs-standard 契约）' },
		{ args: ['run', 'lint'], label: 'npm run lint', why: '基线（依赖矩阵 + domain 零依赖 + 组合根禁令）' },
	];
	const conditionals = [
		{
			args: ['run', 'lint:css'],
			label: 'npm run lint:css',
			match: (f) => f === 'styles.css',
			why: () => 'styles.css 在变更集',
			skipNote: 'styles.css 未变更',
		},
		{
			args: ['run', 'check:dead-code'],
			label: 'npm run check:dead-code',
			match: (f) => f.startsWith('src/') || f.startsWith('tests/'),
			why: () => 'src/ 或 tests/ 有变更（导出面无法从路径判断，宁多跑，K57）',
			skipNote: 'src/tests 未变更',
		},
		{
			args: ['run', 'build:vendor'],
			label: 'npm run build:vendor',
			match: (f) => f.startsWith('vendor/patches/') || f.startsWith('vendor/upstream/'),
			why: () => 'vendor 源/补丁有变更（重打包；同步 BUILD.md 与 tests/vendor-contract 两处 sha256）',
			skipNote: 'vendor/patches、vendor/upstream 未变更',
		},
		{
			args: ['run', 'verify:visual', '--', '--require-chrome'],
			label: 'npm run verify:visual -- --require-chrome',
			match: (f) => VISUAL_MATCHERS.some((m) => f.startsWith(m)),
			why: (hit) => `自绘判据 / 节点渲染 / 探针在变更集：${hit.join('、')}`,
			skipNote: '自绘判据 / 节点渲染 / 探针未变更',
		},
		{
			args: ['run', 'check:release'],
			label: 'npm run check:release',
			match: (f) => f === 'manifest.json' || f === 'versions.json' || f === 'README.md' || f === 'README.zh-CN.md' || f.startsWith('LICENSE') || f.startsWith('docs/release-notes-'),
			why: (hit) => `发布元数据在变更集：${hit.join('、')}`,
			skipNote: '发布元数据未变更',
		},
	];
	/** 只挑打印/执行要的三个字段（不把 match / skipNote 混进 gates） */
	const plan = (gate, why) => ({ args: gate.args, label: gate.label, why });
	const gates = baseline.map((gate) => plan(gate, gate.why));
	const skipped = [];
	if (all) {
		for (const gate of conditionals) {
			gates.push(plan(gate, '--all：全跑'));
		}
		return { gates, skipped };
	}
	if (changed === null) {
		for (const gate of conditionals) {
			gates.push(plan(gate, '变更集不可读，保守全跑'));
		}
		return { gates, skipped };
	}
	for (const gate of conditionals) {
		const matched = changed.filter(gate.match);
		if (matched.length > 0) {
			gates.push(plan(gate, gate.why(matched)));
		} else {
			skipped.push({ label: gate.label, note: gate.skipNote });
		}
	}
	return { gates, skipped };
}

function main() {
	const fixOnly = flags.includes('--fix-lines');
	const dryRun = flags.includes('--dry-run');
	const all = flags.includes('--all');

	const agentsText = readFileSync(join(ROOT, AGENTS_REL), 'utf8');
	const archText = readFileSync(join(ROOT, ARCHITECTURE_REL), 'utf8');
	const agentsRows = parseExemptionRows(agentsText);
	const archRows = parseExemptionRows(archText);

	// ---- 豁免表行数对账 ----
	if (fixOnly) {
		const a = fixExemptionTable(AGENTS_REL);
		const b = fixExemptionTable(ARCHITECTURE_REL);
		if (a.updates.length === 0 && b.updates.length === 0) {
			console.log('✔ 豁免表两表行数与实测一致，无需回填');
		} else {
			for (const u of [...a.updates, ...b.updates]) {
				console.log(`✔ 回填 ${u}`);
			}
			console.log('回填完成——两表已同批对齐实测值，请把改动并入本次提交。');
		}
		const stale = [...agentsRows].filter(([, row]) => row.stale);
		for (const [rel] of stale) {
			console.log(`⚠ 登记的文件已不存在：${rel}（请人工清理两表该行及理由）`);
		}
		return;
	}

	// ---- 静态核对 1：未登记超限（硬规则 10 的机器核对） ----
	const exemptPaths = new Set([...agentsRows.keys(), ...archRows.keys()]);
	const overLimit = listSrcTsFiles().filter(
		(rel) => (countSourceLines(join(ROOT, rel)) ?? 0) > 300,
	);
	const unregistered = overLimit.filter((rel) => !exemptPaths.has(rel));

	// ---- 静态核对 2：行数漂移报告（精确差；超阈漂移由 npm test 红灯兜底） ----
	const drifted = [];
	for (const [rel, row] of agentsRows) {
		const actual = countSourceLines(join(ROOT, rel));
		if (actual !== null && actual !== row.declared) {
			drifted.push(`${rel}：登记 ${row.declared}，实测 ${actual}`);
		}
	}

	// ---- 计划 ----
	const changed = gitChangedFiles();
	if (changed === null) {
		console.log('⚠ 无法读取 git 变更集（非 git 仓库或 git 不可用）→ 附加门禁按全跑处理');
	}
	const { gates, skipped } = buildPlan(changed, { all });
	console.log(
		changed === null
			? '== git 变更集：不可读 =='
			: `== git 变更集：${changed.length} 个文件 ==`,
	);
	console.log('== 门禁计划（顺序执行，首败即停） ==');
	for (const gate of gates) {
		console.log(`  ▶ ${gate.label}\n      ${gate.why}`);
	}
	for (const gate of skipped) {
		console.log(`  （跳过 ${gate.label}：${gate.note}；拿不准请 --all）`);
	}

	console.log('== 静态核对 ==');
	if (unregistered.length === 0) {
		console.log(
			`✔ line-budget：src/ 超限文件 ${overLimit.length} 个全部已登记豁免（未登记超限数 0，只允许递减）`,
		);
	} else {
		console.error(
			`✘ line-budget：以下文件超 300 行且未在「文件规模与豁免」表登记` +
				`（登记并写明理由，或拆分收敛；未登记超限数只允许递减）：\n${unregistered.join('\n')}`,
		);
	}
	if (drifted.length === 0) {
		console.log('✔ 豁免表行数与实测逐行一致');
	} else {
		console.log(
			`ℹ 豁免表行数漂移（npm test 的 agents-md-sync 会在超阈时红灯；` +
				`精确回填跑 npm run check:gates -- --fix-lines）：\n  ${drifted.join('\n  ')}`,
		);
	}
	if (changed !== null) {
		if (changed.includes(AGENTS_REL)) {
			console.log('ℹ AGENTS.md 在变更集：agents-md-sync 契约在 npm test 内，已覆盖');
		}
		if (changed.includes('docs/markdown-mindmap-standard.md')) {
			console.log('ℹ 权威标准在变更集：docs-standard 契约在 npm test 内，已覆盖');
		}
	}

	if (unregistered.length > 0) {
		process.exit(1);
	}
	if (dryRun) {
		console.log('== dry-run 结束（未执行门禁） ==');
		return;
	}

	// ---- 执行（与校验链同序，首败即停） ----
	console.log('== 执行 ==');
	for (const gate of gates) {
		const startedAt = Date.now();
		console.log(`▶ ${gate.label}`);
		// args 全部是本文件内的字面量（无用户输入），拼串 + shell 是安全的，
		// 且避开 spawnSync(args 数组 + shell) 的 DEP0190 弃用告警。
		const res = spawnSync(['npm', ...gate.args].join(' '), {
			cwd: ROOT,
			stdio: 'inherit',
			shell: true,
		});
		const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
		if (res.error || res.status !== 0) {
			console.error(`✘ ${gate.label} 失败（${seconds}s，退出码 ${res.status ?? '?'}）`);
			process.exit(res.status ?? 1);
		}
		console.log(`✔ ${gate.label}（${seconds}s）`);
	}
	console.log('== 全部门禁通过 ==');
	console.log('实机验证（人工/AI）：obsidian reload（重载库）→ 装新 main.js → obsidian dev:errors');
}

// 只在**直接执行**时跑门禁：被 `tests/check-gates.test.ts` import 时仅提供纯函数
// （buildPlan / parseExemptionRows），否则一 import 就会真跑 npm 链。
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	main();
}
