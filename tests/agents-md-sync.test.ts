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
 * 契约二（行数漂移，**双向**）：「文件规模与豁免」表的登记行数与实测的偏差
 * 不得超 min(+15%, +50 行)——拦截「快照整体失真」（2026-10-02 修复前 15 个
 * 文件偏离最多 204 行，债务指标已失去度量意义），而非拦截正常演进。
 *
 * 2026-10-16 补**偏小一侧**：原判定只查 `actual > limit`，于是**陈旧偏高的
 * 登记值永不报警**——拆分后 `engine/mindmap.ts` 实测 712 行却仍登记 2911，
 * 门禁全程绿灯（靠人工核对全表才发现）。现两侧同判。
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
 *
 * 2026-10-04：字符类加 `/`（`[\w./-]+`），使**子目录**条目（`agents/architecture.md`
 * 等）也纳入校验。此前 `[\w.-]+` 不匹配斜杠，`docs/agents/` 下的 4 份详录虽在
 * `docs/` 段登记，却因「不匹配即 break」而**永远不会被检查**——AGENTS.md 指向
 * 不存在的详录文件同样抓不到。改动只放宽正则的**匹配范围**（覆盖更广），
 * 不放宽判定标准：`docExists` 仍逐一验证文件真实存在。
 */
function collectDeclaredDocs(): string[] {
	const lines = AGENTS_SOURCE.split('\n');
	const start = lines.findIndex((line) => line.trim() === 'docs/');
	const names: string[] = [];
	if (start < 0) {
		return names;
	}
	for (let i = start + 1; i < lines.length; i++) {
		const match = /^\s\s([\w./-]+\.md)\s+#/.exec(lines[i] ?? '');
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

/**
 * `docs/agents/conventions.md`（K 编号的唯一载体）。
 *
 * 契约三 / 四都只读这一份：K 编号的定义面只有它，其余文件只**引用**。
 */
const CONVENTIONS_SOURCE = readFileSync(
	path.join(ROOT, 'docs/agents/conventions.md'),
	'utf8',
);

/** conventions.md 里已定义的 K 编号（`- [K123]`；`K28b` 这类子编号不参与编号空间） */
function definedKNumbers(): Set<number> {
	const defined = new Set<number>();
	for (const match of CONVENTIONS_SOURCE.matchAll(/^-\s*\[K(\d+)\]/gm)) {
		const value = match[1];
		if (value !== undefined) {
			defined.add(Number(value));
		}
	}
	return defined;
}

/**
 * 「会引用 K 编号」的文本面：src / tests / docs 的 .ts · .md，加根目录两份与 vendor 说明。
 *
 * **刻意排除** `vendor/upstream/` 与 `vendor/simple-mind-map.cjs`：那是压缩后的第三方
 * 代码，`K73` 这类偶然 token 与我们的编号无关，扫进来只会造出假告警。
 */
function collectReferenceSources(): [string, string][] {
	const files = [
		...collectTextFiles('src'),
		...collectTextFiles('tests'),
		...collectTextFiles('docs'),
	];
	const extra = ['AGENTS.md', 'README.md', 'vendor/BUILD.md'];
	const sources: [string, string][] = [];
	for (const rel of [...files, ...extra]) {
		try {
			sources.push([rel, readFileSync(path.join(ROOT, rel), 'utf8')]);
		} catch {
			// 文件不存在（如 README.md 曾缺）：跳过，存在性由 docs 清单契约管
		}
	}
	return sources;
}

/** 递归收集目录下 .ts / .md 文件（返回相对 ROOT 的 posix 路径） */
function collectTextFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(path.join(ROOT, dir), {
		withFileTypes: true,
	})) {
		const rel = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			files.push(...collectTextFiles(rel));
		} else if (entry.name.endsWith('.ts') || entry.name.endsWith('.md')) {
			files.push(rel);
		}
	}
	return files;
}

describe('AGENTS.md 同步契约：K 编号（区间声明与交叉引用）', () => {
	/**
	 * 「声明的 K 区间」只查这两份。`line-count-log.md` 里的 `K1–K152` 是**历史批次读数**
	 * （那一批当时的范围），不表达当前范围，纳入会永远红灯。
	 */
	const RANGE_SOURCES: readonly [string, string][] = [
		['AGENTS.md', AGENTS_SOURCE],
		['docs/agents/conventions.md', CONVENTIONS_SOURCE],
	];

	it('声明的 K 区间等于实际最大编号（新增条目后不必手算，但漏改会红灯）', () => {
		const defined = definedKNumbers();
		expect(defined.size, 'conventions.md 里应有 `- [K<n>]` 条目').toBeGreaterThan(0);
		const max = Math.max(...defined);
		const declared: { file: string; end: number }[] = [];
		for (const [file, source] of RANGE_SOURCES) {
			for (const match of source.matchAll(/K1\s*[–—-]\s*K(\d+)/g)) {
				const end = match[1];
				if (end !== undefined) {
					declared.push({ file, end: Number(end) });
				}
			}
		}
		expect(
			declared.length,
			'至少两处声明：AGENTS.md 的 docs 清单条目 + conventions.md 的标题',
		).toBeGreaterThanOrEqual(2);
		const wrong = declared.filter((item) => item.end !== max);
		expect(
			wrong.map((item) => `${item.file}：声明到 K${item.end}，实际最大 K${max}`),
			`K 区间声明与实际最大编号不符（新增 K 条目后同步上述两处；编号不连续时也只写最大编号）：\n` +
				wrong.map((item) => `${item.file}：声明到 K${item.end}`).join('\n'),
		).toEqual([]);
	});

	it('全仓引用的 K 编号都在 conventions.md 有对应条目（防悬空引用）', () => {
		const defined = definedKNumbers();
		const dangling = new Set<string>();
		for (const [file, source] of collectReferenceSources()) {
			for (const match of source.matchAll(/\bK(\d{1,3})\b/g)) {
				const value = match[1];
				if (value !== undefined && !defined.has(Number(value))) {
					dangling.add(`${file}：K${value}`);
				}
			}
		}
		expect(
			[...dangling],
			'以下引用了不存在的 K 编号（K 编号一经分配永不复用：确需删除条目时把编号留空并保留占位，勿让引用悬空）：',
		).toEqual([]);
	});
});

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
			// 两侧共用同一份余量（取原「偏大」口径，见契约二）：
			// 实测偏大 ⇒ 忘了随改动刷新登记值；实测偏小 ⇒ 文件缩小后登记值陈旧。
			const allowance = Math.min(
				Math.round(declaredLines * DRIFT_RATIO),
				DRIFT_LINES,
			);
			if (Math.abs(actual - declaredLines) > allowance) {
				drifted.push(
					`${rel}：登记 ${declaredLines} 行，实测 ${actual} 行` +
						`（偏差 ${actual - declaredLines}，容许 ±${allowance}）`,
				);
			}
		}
		expect(
			drifted,
			`以下文件的实测行数与 AGENTS.md 豁免表的登记值偏离超阈，` +
				`请更新「文件规模与豁免」表的行数列（阈值 ±min(+15%, +${DRIFT_LINES} 行)）：\n${drifted.join('\n')}`,
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

/**
 * 表格内的**未转义**竖线个数（`\|` 不计——GFM 会把它还原成字面 `|`）。
 *
 * 判据只看「前面连续多少个反斜杠」的奇偶：奇数＝已转义。
 */
function unescapedPipeCount(line: string): number {
	let count = 0;
	for (let i = 0; i < line.length; i++) {
		if (line[i] !== '|') {
			continue;
		}
		let backslashes = 0;
		for (let k = i - 1; k >= 0 && line[k] === '\\'; k--) {
			backslashes++;
		}
		if (backslashes % 2 === 0) {
			count++;
		}
	}
	return count;
}

describe('文档契约：Markdown 表格列数一致（`|` 必须转义）', () => {
	/**
	 * 动机（2026-11-06 审计）：**6 行 / 13 个**未转义的 `|` 落在单元格的**行内代码**里——
	 * `%%rel:id | 标签 | geo=…`、`|deltaY| < 50`、`![[图.png|164]]`、含 `|`/`#` 的目标…
	 * GFM 把它当列分隔符 ⇒ 该行凭空多出几列、后续内容被截断。这类问题在源码里
	 * 几乎看不出来（都是「代码示例里的竖线」），只有渲染后才现形，故机械校验。
	 *
	 * 口径：**同一段连续以 `|` 开头的行**视为一张表，表头列数＝首行未转义竖线数；
	 * 围栏代码块内的行跳过（示例代码里出现表格是合法的，且不该被当表头）。
	 */
	it('每张表的每个数据行都与表头同列数', () => {
		const docs = [
			...collectTextFiles('docs'),
			'AGENTS.md',
			'README.md',
			'vendor/BUILD.md',
		];
		const broken: string[] = [];
		for (const rel of docs) {
			let lines: string[];
			try {
				lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
			} catch {
				continue;
			}
			/** 当前表的表头列数；0 ＝ 尚未遇到表头 */
			let headerColumns = 0;
			let fence: string | null = null;
			for (let i = 0; i < lines.length; i++) {
				const raw = lines[i] ?? '';
				const trimmed = raw.trim();
				const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed);
				if (fenceMatch) {
					const marker = fenceMatch[1] ?? '```';
					if (fence === null) {
						fence = marker;
					} else if (marker.startsWith(fence[0] ?? '`')) {
						fence = null;
					}
					headerColumns = 0;
					continue;
				}
				if (fence !== null || !trimmed.startsWith('|')) {
					headerColumns = 0;
					continue;
				}
				const columns = unescapedPipeCount(trimmed);
				if (headerColumns === 0) {
					headerColumns = columns;
					continue;
				}
				if (columns !== headerColumns) {
					broken.push(
						`${rel}:${i + 1} 列数 ${columns} ≠ 表头 ${headerColumns}（行内代码里的 \`|\` 要写成 \`\\|\`）`,
					);
				}
			}
		}
		expect(broken, `以下表格行会被 GFM 拆成多余的列：\n${broken.join('\n')}`).toEqual(
			[],
		);
	});
});
