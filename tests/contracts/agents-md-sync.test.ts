/**
 * 开发文档同步契约：入口链接、分层 bullet 的完整路径登记、文档存在性与豁免漂移。
 * 只解析指定索引段的文件链接；同名文件、旧目录或其它段的提及不能替代登记。
 * 豁免表的行数双向偏差不得超 min(15%, 50 行)。K 区间与交叉引用同步检查。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const AGENTS_SOURCE = readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
const INDEX_SOURCE = readFileSync(path.join(ROOT, 'docs/agents/index.md'), 'utf8');


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

/** 只收指定二级标题内的 bullet 文件链接，目标按 index.md 所在目录解析。 */
function collectIndexedPaths(source: string, heading: string): string[] {
	const paths: string[] = [];
	let active = false;
	let fenced = false;
	for (const line of source.split('\n')) {
		if (/^```/.test(line.trim())) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		if (line.startsWith('## ')) {
			active = line === `## ${heading}`;
			continue;
		}
		if (!active) continue;
		const match = /^\s*- \[[^\]]+\]\(([^)]+)\)/.exec(line);
		const target = match?.[1];
		if (target === undefined || target.includes('<')) continue;
		paths.push(path.posix.normalize(path.posix.join('docs/agents', target)));
	}
	return paths;
}

const CODE_PATHS = collectIndexedPaths(INDEX_SOURCE, '代码结构索引');
const REGISTERED_PATHS = new Set(CODE_PATHS);

function isRegistered(relPath: string): boolean {
	return REGISTERED_PATHS.has(relPath);
}

/**
 * 「文件规模与豁免」表的**登记行数**：`| \`src/x.ts\` | NNN |` →
 * Map<posix 相对路径, 登记行数>。只认带数字的行（表头/无数字行自然不匹配）。
 */
function parseDeclaredLineCounts(): Map<string, number> {
	const declared = new Map<string, number>();
	for (const line of INDEX_SOURCE.split('\n')) {
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

/** 参考文档段内的具体链接；保留 docs/ 相对名称供存在性检查使用。 */
function collectDeclaredDocs(source = INDEX_SOURCE): string[] {
	return collectIndexedPaths(source, '参考文档')
		.filter((file) => file.startsWith('docs/') && file.endsWith('.md'))
		.map((file) => file.slice('docs/'.length));
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
		['docs/agents/index.md', INDEX_SOURCE],
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
			'至少两处声明：index.md 的 docs 清单条目 + conventions.md 的标题',
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

describe('分层索引链接解析', () => {
	it('嵌套 bullet 与同名文件按完整目标路径区分，标题与说明不代替登记', () => {
		const source = [
			'## 代码结构索引', '- **src/**', '  - **features/**',
			'    - [view.ts](../../src/features/view/view.ts)：主视图',
			'    - [view.ts](../../src/ui/view.ts)',
			'    - `src/features/view.ts`',
			'## 参考文档', '- [other.ts](../../src/other.ts)',
		].join('\n');
		const declared = collectIndexedPaths(source, '代码结构索引');
		expect(declared).toEqual(['src/features/view/view.ts', 'src/ui/view.ts']);
		expect(declared).not.toContain('src/features/view.ts');
	});

	it('旧目录链接保留旧目标，不会登记迁移后的同名文件', () => {
		const declared = collectIndexedPaths(
			'## 代码结构索引\n- [view.ts](../../src/features/view.ts)', '代码结构索引',
		);
		expect(declared).toEqual(['src/features/view.ts']);
		expect(declared).not.toContain('src/features/view/view.ts');
	});

	it('参考文档收集嵌套链接，跳过模式条目、代码示例与其它段链接', () => {
		const source = [
			'## 代码结构索引', '- [wrong.md](wrong.md)',
			'## 参考文档', '- **docs/**',
			'  - [standard.md](../standard.md)', '  - **agents/**',
			'    - [index.md](index.md)', '    - [decisions.md](./decisions.md)',
			'  - `release-notes-<tag>.md`',
			'```md', '- [example.md](example.md)', '```',
			'## 其它', '- [ignored.md](ignored.md)',
		].join('\n');
		expect(collectDeclaredDocs(source)).toEqual(['standard.md', 'agents/index.md', 'agents/decisions.md']);
		expect(collectDeclaredDocs('## 其它\n- [index.md](index.md)')).toEqual([]);
	});
});

describe('AGENTS.md 同步契约：代码文件登记完备性', () => {
	it('工具配置与脚本清单中的每个链接都指向真实文件', () => {
		const paths = collectIndexedPaths(INDEX_SOURCE, '工具配置与脚本');
		expect(paths.length).toBeGreaterThan(0);
		expect(paths.filter(file => countSourceLines(path.join(ROOT, file)) === null)).toEqual([]);
	});
	it('开发入口能定位唯一索引，索引清单也登记自身与决策表', () => {
		expect(AGENTS_SOURCE).toContain('[docs/agents/index.md](docs/agents/index.md)');
		expect(collectDeclaredDocs()).toEqual(expect.arrayContaining(['agents/index.md', 'agents/decisions.md']));
	});

	it('src/ 下每个 TS 文件的完整路径都在 docs/agents/index.md 中被登记', () => {
		const files = collectTsFiles('src');
		expect(files.length).toBeGreaterThan(0);
		const missing = files.filter((file) => !isRegistered(file));
		expect(
			missing,
			`以下文件未在 docs/agents/index.md 登记（请同步「代码结构」src 清单）：\n${missing.join('\n')}`,
		).toEqual([]);
	});

	it('tests/ 下每个 TS 文件的完整路径都在 docs/agents/index.md 中被登记', () => {
		const files = collectTsFiles('tests');
		expect(files.length).toBeGreaterThan(0);
		const missing = files.filter((file) => !isRegistered(file));
		expect(
			missing,
			`以下文件未在 docs/agents/index.md 登记（请同步「代码结构」tests 清单）：\n${missing.join('\n')}`,
		).toEqual([]);
	});

	it('代码清单没有陈旧或重复路径（只提及相同 basename 不算登记）', () => {
		const actual = new Set([...collectTsFiles('src'), ...collectTsFiles('tests')]);
		const declared = CODE_PATHS.filter((file) => file.endsWith('.ts'));
		expect(declared.filter((file) => !actual.has(file))).toEqual([]);
		expect(declared.filter((file, index) => declared.indexOf(file) !== index)).toEqual([]);
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
			`以下文件的实测行数与 docs/agents/index.md 豁免表的登记值偏离超阈，` +
				`请更新「文件规模与豁免」表的行数列（阈值 ±min(+15%, +${DRIFT_LINES} 行)）：\n${drifted.join('\n')}`,
		).toEqual([]);
	});

	/**
	 * docs 清单登记完备性：docs/agents/index.md 的 `docs/` 段登记了某个**具体**文档，
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
			`以下文档在 docs/agents/index.md「参考文档」清单中登记，但 docs/ 下不存在：\n${missing.join('\n')}\n` +
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
