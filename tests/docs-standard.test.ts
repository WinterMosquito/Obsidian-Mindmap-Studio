/**
 * 标准文档一致性门禁：把「文档腐化」从人工发现变成红灯。
 *
 * 背景（2026-10-21 修复批）：`docs/markdown-mindmap-standard.md` 曾同时存在五类可机械
 * 检测的缺陷——① 11 处反引号被替换成 `s…s`（外层定界符损坏）；② 实现指针指向已拆分
 * 的文件（`node-inline-content.ts` 现为 87 行 barrel）、并带越界行号；③ 附录版本与
 * 实际 `manifest.json` 不一致、行数为旧读数；④ `§5.2` 指向不存在的子节；⑤ 已退役的
 * `.mindmap.md` 术语残留。这些都不需要读代码语义，故收敛为八条断言。
 *
 * 判据取向：
 * - **指针用 `path#符号`，不引行号**。行号在每次拆分/插入后即失效，文档自己已记录过
 *   `L299` 失效与本次 `node-inline-content.ts:1145-1155` 越界，故直接禁止 `path:line`。
 * - **目录必须等于标题序列**（顺序一致）：漏改目录会让文档首屏就与正文不符。
 * - **每个编号章节必须有 `> 规则：` 摘要**：这是该文档「一节一句话」的阅读契约。
 * - 行数只校验「区间内条目数一致」，**不校验数值**——附录已声明行数是带读取日的快照，
 *   强制数值同步会把每次源码改动都变成文档红灯。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const DOC_REL = 'docs/markdown-mindmap-standard.md';
const DOC = readFileSync(path.join(ROOT, DOC_REL), 'utf8');
const LINES = DOC.split(/\r?\n/);
const BACKTICK = '`';

interface DocLine {
	readonly text: string;
	/** 1-based 行号（与编辑器一致，便于报错定位） */
	readonly no: number;
}

/**
 * 围栏外的行。围栏按**长度**配对（CommonMark：闭合围栏不短于开启围栏）——
 * §2.4 是四个反引号里嵌三个反引号，只比字符会把内层误判为结束，
 * 于是示例里的 `## 分支 A` 会被当成标题（本门禁首版即栽在此处）。
 */
function linesOutsideFences(): DocLine[] {
	const out: DocLine[] = [];
	let fence: { ch: string; len: number } | null = null;
	LINES.forEach((text, index) => {
		const match = /^\s{0,3}(`{3,}|~{3,})/.exec(text);
		if (match) {
			const mark = match[1] ?? '';
			const ch = mark.charAt(0);
			const len = mark.length;
			if (fence === null) {
				fence = { ch, len };
			} else if (ch === fence.ch && len >= fence.len) {
				fence = null;
			}
			return;
		}
		if (fence === null) out.push({ text, no: index + 1 });
	});
	return out;
}

/** 编号章节标题（`## 1.` / `### 2.1`），返回 `编号 -> 标题全文` */
function numberedHeadings(): Array<{ no: string; title: string; line: number }> {
	const out: Array<{ no: string; title: string; line: number }> = [];
	for (const { text, no } of linesOutsideFences()) {
		const match = /^#{2,3} (\d+(?:\.\d+)?)[ .](.+)$/.exec(text);
		if (match) out.push({ no: match[1] ?? '', title: (match[2] ?? '').trim(), line: no });
	}
	return out;
}

/** 全部章节标题原文（`##` / `###`，围栏外，排除「目录」自身） */
function allHeadingTitles(): string[] {
	return linesOutsideFences()
		.map(({ text }) => /^#{2,3} (.+)$/.exec(text)?.[1]?.trim())
		.filter((title): title is string => title !== undefined && title !== '目录');
}

/** 目录块条目（`## 目录` 之后连续的 `- ` 行） */
function tocEntries(): string[] {
	const start = LINES.findIndex((line) => line.trim() === '## 目录');
	if (start < 0) return [];
	const out: string[] = [];
	for (let i = start + 1; i < LINES.length; i++) {
		const line = LINES[i] ?? '';
		if (line.startsWith('- ')) out.push(line.slice(2).trim());
		else if (line !== '') break;
	}
	return out;
}

/** 反引号内的路径引用（`src/...` / `tests/...` / `scripts/...`） */
function codePaths(): string[] {
	const out: string[] = [];
	const re = new RegExp(`${BACKTICK}((?:src|tests|scripts)/[\\w./-]+\\.(?:ts|mjs))${BACKTICK}`, 'g');
	for (const match of DOC.matchAll(re)) {
		const ref = match[1];
		if (ref !== undefined) out.push(ref);
	}
	return out;
}

/** `path#symbol` 形式的指针 */
function symbolPointers(): Array<{ file: string; symbol: string }> {
	const out: Array<{ file: string; symbol: string }> = [];
	const re = new RegExp(
		`${BACKTICK}((?:src|tests|scripts)/[\\w./-]+\\.(?:ts|mjs))#(\\w+)${BACKTICK}`,
		'g',
	);
	for (const match of DOC.matchAll(re)) {
		const file = match[1];
		const symbol = match[2];
		if (file !== undefined && symbol !== undefined) out.push({ file, symbol });
	}
	return out;
}

/** 表格中首列为数字的行号集合（用于白名单 ↔ 映射表条目对齐） */
function tableRowNumbers(startMarker: string, endMarker: string): number[] {
	const start = LINES.findIndex((line) => line.includes(startMarker));
	const end = LINES.findIndex((line) => line.includes(endMarker));
	const out: number[] = [];
	if (start < 0) return out;
	const stop = end > start ? end : LINES.length;
	for (let i = start; i < stop; i++) {
		const match = /^\|\s*(\d+)\s*\|/.exec(LINES[i] ?? '');
		const value = match?.[1];
		if (value !== undefined) out.push(Number(value));
	}
	return out;
}

describe('标准文档一致性（docs/markdown-mindmap-standard.md）', () => {
	it('围栏外的行内反引号成对（拦截 s…s 式损坏）', () => {
		const broken = linesOutsideFences()
			.filter(({ text }) => (text.split(BACKTICK).length - 1) % 2 !== 0)
			.map(({ text, no }) => `${no}: ${text.slice(0, 80)}`);
		expect(
			broken,
			`以下行的反引号个数为奇数（外层定界符多半被替换/吞掉）：\n${broken.join('\n')}`,
		).toEqual([]);
	});

	it('每个 §x / §x.y 引用都有对应章节', () => {
		const known = new Set(numberedHeadings().map((heading) => heading.no));
		const refs = [...DOC.matchAll(/§(\d+(?:\.\d+)?)/g)].map((match) => match[1] ?? '');
		const missing = [...new Set(refs)].filter((ref) => !known.has(ref));
		expect(missing, `以下 § 引用在文档内没有对应标题：${missing.join(', ')}`).toEqual([]);
	});

	it('不使用 path:line 形式（行号必失效，改用 path#符号）', () => {
		const refs = [...DOC.matchAll(new RegExp(`${BACKTICK}[\\w./-]+\\.(?:ts|mjs|json):\\d+`, 'g'))].map(
			(match) => match[0],
		);
		expect(
			refs,
			`以下引用带行号，请改为 \`path#符号\`：\n${refs.join('\n')}`,
		).toEqual([]);
	});

	it('反引号内的代码路径都真实存在', () => {
		const missing = [...new Set(codePaths())].filter((rel) => !existsSync(path.join(ROOT, rel)));
		expect(missing, `以下路径在仓库中不存在（文件已改名/拆分？）：\n${missing.join('\n')}`).toEqual(
			[],
		);
	});

	it('path#符号 指针的符号确实出现在该文件', () => {
		const broken = [...new Set(symbolPointers().map(({ file, symbol }) => `${file}#${symbol}`))]
			.filter((ref) => {
				const [file, symbol] = ref.split('#');
				if (file === undefined || symbol === undefined) return true;
				if (!existsSync(path.join(ROOT, file))) return true;
				return !readFileSync(path.join(ROOT, file), 'utf8').includes(symbol);
			});
		expect(broken, `以下符号指针在目标文件中找不到该符号：\n${broken.join('\n')}`).toEqual([]);
	});

	it('附录声明的 manifest 版本与实际一致', () => {
		const declared = /`manifest\.json` 版本 \*\*(\d+\.\d+\.\d+)\*\*/.exec(DOC)?.[1];
		const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')) as {
			version?: string;
		};
		expect(declared, '附录「核对依据」行未声明 manifest 版本').toBeDefined();
		expect(declared).toBe(manifest.version);
	});

	it('目录条目与全部章节标题逐项一致（顺序也一致）', () => {
		const headings = allHeadingTitles();
		const toc = tocEntries();
		expect(toc.length, '目录为空或未找到「## 目录」').toBeGreaterThan(0);
		expect(toc).toEqual(headings);
	});

	it('每个编号章节之后都紧跟一行「> 规则：」摘要', () => {
		const missing: string[] = [];
		for (const heading of numberedHeadings()) {
			const index = heading.line - 1;
			let cursor = index + 1;
			while ((LINES[cursor] ?? '').trim() === '') cursor++;
			if (!(LINES[cursor] ?? '').startsWith('> 规则：')) {
				missing.push(`第 ${heading.line} 行「${heading.title}」之后缺少「> 规则：…」`);
			}
		}
		expect(missing, missing.join('\n')).toEqual([]);
	});

	it('退役后缀 .mindmap.md 只在说明退役的行出现', () => {
		const offenders = LINES.map((line, index) => ({ line, no: index + 1 }))
			.filter(({ line }) => line.includes('.mindmap.md') && !line.includes('退役'))
			.map(({ line, no }) => `${no}: ${line.slice(0, 80)}`);
		expect(
			offenders,
			`以下行仍以 \`.mindmap.md\` 指代导图文件（该后缀已于 2026-10-12 退役）：\n${offenders.join('\n')}`,
		).toEqual([]);
	});

	it('白名单 10 条与「实现 / 锁定用例」映射表逐条对齐', () => {
		const whitelist = tableRowNumbers('白名单（往返中唯一允许', '白名单 → 实现');
		const mapping = tableRowNumbers('白名单 → 实现', '## 4. ');
		expect(whitelist).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(mapping).toEqual(whitelist);
	});

	it('外迁的历史存档文件存在且被附录引用', () => {
		const historyRel = 'docs/markdown-mindmap-history.md';
		expect(existsSync(path.join(ROOT, historyRel)), `缺少历史存档：${historyRel}`).toBe(true);
		expect(DOC.includes('markdown-mindmap-history.md'), '附录未链接历史存档').toBe(true);
	});
});
