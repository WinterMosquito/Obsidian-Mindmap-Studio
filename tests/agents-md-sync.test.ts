/**
 * AGENTS.md 同步契约：代码文件登记完备性 + 豁免表行数漂移。
 *
 * 契约一（登记完备性）：把「新增/重命名/删除源文件必须同步 AGENTS.md」
 * 从口头约定变成红灯：
 * 断言 src/ 与 tests/ 下每个 .ts 文件的 basename 都以**独立 token** 形式
 * 出现在 AGENTS.md 中（对应「代码结构」的 src 清单与 tests 清单）。
 * 漏登记（或文件删除后文档未清理）时，本测试失败并列出具体文件名。
 *
 * 匹配口径：按 `[^\w.-]+` 切分 AGENTS.md 得到 token 集合，用 basename
 * 精确命中——故 `tree.ts` 不会被 `links-tree.ts` 这类粘连子串误命中
 * （朴素 includes 会误判，本文件刻意不用）。
 *
 * 契约二（行数漂移）：「文件规模与豁免」表的登记行数与实测的偏差不得超
 * min(+15%, +50 行)——拦截「快照整体失真」（2026-10-02 修复前 15 个文件
 * 偏离最多 204 行，债务指标已失去度量意义），而非拦截正常演进。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const AGENTS_SOURCE = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
const AGENTS_TOKENS = new Set(AGENTS_SOURCE.split(/[^\w.-]+/));

/** 递归收集目录下全部 .ts 文件（返回相对 ROOT 的 posix 路径） */
function collectTsFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(path.join(ROOT, dir), {
		withFileTypes: true,
	})) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...collectTsFiles(rel));
		} else if (entry.name.endsWith('.ts')) {
			files.push(rel);
		}
	}
	return files;
}

/** 文件是否已登记：basename 作为独立 token 出现在 AGENTS.md 中 */
function isRegistered(relPath: string): boolean {
	return AGENTS_TOKENS.has(path.posix.basename(relPath));
}

/**
 * 「文件规模与豁免」表的**登记行数**：`| \`src/x.ts\` | NNN |` →
 * Map<posix 相对路径, 登记行数>。只认带数字的行（表头/无数字行自然不匹配）。
 */
function parseDeclaredLineCounts(): Map<string, number> {
	const declared = new Map<string, number>();
	for (const line of AGENTS_SOURCE.split('\n')) {
		const match = /^\|\s*`(src\/[^`]+\.ts)`\s*\|\s*(\d+)\s*\|/.exec(line);
		// noUncheckedIndexedAccess 下捕获组是 `string | undefined`：显式收窄，
		// 不用非空断言（保持类型面无损）。
		const relPath = match?.[1];
		const lineCount = match?.[2];
		if (relPath !== undefined && lineCount !== undefined) {
			declared.set(relPath, Number(lineCount));
		}
	}
	return declared;
}

/**
 * 实测行数，口径与 PowerShell `Get-Content` 一致（文件末尾的换行**不**额外计行）。
 * 文件不可读时返回 null，交由「登记完备性」断言报错，此处不重复诊断。
 */
function countSourceLines(absPath: string): number | null {
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

/**
 * AGENTS.md「代码结构」段 `docs/` 清单里登记的**具体**文档名。
 *
 * 口径：逐行读 `docs/` 段内形如 `  name.md  # 说明` 的条目（缩进两格），
 * 遇到第一个不匹配的条目即视为段结束（保守停止，不跨段误抓）。
 * `release-notes-<tag>.md` 这类**模式行**含 `<`，按设计跳过——它不是具体文件。
 *
 * 为什么需要它：src/ 与 tests/ 的登记完备性由前两条断言覆盖，但 docs/ 不在
 * 任何既有断言的检查面内——2026-10-02 的审计发现 AGENTS.md 登记了一个
 * **并不存在**的 `docs/engine-upstream-patch-proposal.md`（且源码注释引用它），
 * 既有护栏在结构上抓不到，故补此条。
 */
function collectDeclaredDocs(): string[] {
	const lines = AGENTS_SOURCE.split('\n');
	const start = lines.findIndex((line) => line.trim() === 'docs/');
	const names: string[] = [];
	if (start < 0) {
		return names;
	}
	for (let i = start + 1; i < lines.length; i++) {
		const match = /^\s\s([\w.-]+\.md)\s+#/.exec(lines[i] ?? '');
		const name = match?.[1];
		if (name === undefined) {
			break;
		}
		if (!name.includes('<')) {
			names.push(name);
		}
	}
	return names;
}

/** docs 下的文件是否真实存在（用 readFileSync 探测，避免引入新的 import） */
function docExists(name: string): boolean {
	try {
		readFileSync(path.join(ROOT, 'docs', name), 'utf8');
		return true;
	} catch {
		return false;
	}
}

describe('AGENTS.md 同步契约：代码文件登记完备性', () => {
	it('src/ 下每个 TS 文件的文件名都在 AGENTS.md 中被提及', () => {
		const files = collectTsFiles('src');
		expect(files.length).toBeGreaterThan(0);
		const missing = files.filter((file) => !isRegistered(file));
		expect(
			missing,
			`以下文件未在 AGENTS.md 登记（请同步「代码结构」src 清单）：\n${missing.join('\n')}`,
		).toEqual([]);
	});

	it('tests/ 下每个 TS 文件的文件名都在 AGENTS.md 中被提及', () => {
		const files = collectTsFiles('tests');
		expect(files.length).toBeGreaterThan(0);
		const missing = files.filter((file) => !isRegistered(file));
		expect(
			missing,
			`以下文件未在 AGENTS.md 登记（请同步「代码结构」tests 清单）：\n${missing.join('\n')}`,
		).toEqual([]);
	});

	/**
	 * 行数漂移护栏：登记值与实测的偏差不得超阈值。
	 *
	 * 阈值 = min(登记值 +15%, 登记值 +50 行)，取小者——给正常演进留余量，
	 * 只拦截「快照整体失真」。2026-10-02 的审计修复的正是这类：15 个文件的
	 * 登记值已偏离实测最多 204 行（`view.ts` 996→1200），使 AGENTS.md 的
	 * 「未登记的超限文件数只允许递减」债务指标失去度量意义。
	 */
	const DRIFT_RATIO = 0.15;
	const DRIFT_LINES = 50;

	it('豁免表登记行数与实测无超阈值漂移', () => {
		const declared = parseDeclaredLineCounts();
		expect(declared.size).toBeGreaterThan(0);
		const drifted: string[] = [];
		for (const [rel, declaredLines] of declared) {
			const actual = countSourceLines(path.join(ROOT, rel));
			if (actual === null) {
				continue;
			}
			const limit = Math.min(
				Math.round(declaredLines * (1 + DRIFT_RATIO)),
				declaredLines + DRIFT_LINES,
			);
			if (actual > limit) {
				drifted.push(
					`${rel}：登记 ${declaredLines} 行，实测 ${actual} 行（上限 ${limit}）`,
				);
			}
		}
		expect(
			drifted,
			`以下文件实际行数已明显超过 AGENTS.md 豁免表的登记值，` +
				`请更新「文件规模与豁免」表的行数列（阈值 min(+15%, +${DRIFT_LINES} 行)）：\n${drifted.join('\n')}`,
		).toEqual([]);
	});

	/**
	 * docs 清单登记完备性：AGENTS.md 的 `docs/` 段登记了某个**具体**文档，
	 * 该文件就必须真实存在。
	 *
	 * 动机见 collectDeclaredDocs 的注释：既有两条断言只覆盖 src/ 与 tests/ 的
	 * `.ts` 文件，docs/ 长期在检查面之外——2026-10-02 审计据此发现一个
	 * 被登记、被源码注释引用、却不存在的文档（Q-08）。
	 */
	it('docs 清单里登记的文档都真实存在', () => {
		const declared = collectDeclaredDocs();
		expect(declared.length).toBeGreaterThan(0);
		const missing = declared.filter((name) => !docExists(name));
		expect(
			missing,
			`以下文档在 AGENTS.md「代码结构」docs 清单中登记，但 docs/ 下不存在：\n${missing.join('\n')}\n` +
				'（若该文档确已废弃，请连同源码中的引用一并删除登记；' +
				'`release-notes-<tag>.md` 属模式行，不参与本检查）',
		).toEqual([]);
	});
});
