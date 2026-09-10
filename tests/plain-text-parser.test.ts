/**
 * LICENSE 校验用纯文本 parser 回归（`scripts/plain-text-parser.mjs`）。
 *
 * 该 parser 是 eslint 配置 `files: ['LICENSE']` 的支撑件，供
 * `obsidianmd/validate-license` 按行取出版权行。它有一处**与官方实现的有意差异**：
 * 官方只按 `\n` 切分，Windows（`core.autocrlf=true`）检出的 CRLF 会让每行残留
 * 行尾 `\r`；而规则正则是
 * `^(?: |\t)*Copyright \(C\) (\d{4})(?:-(\d{4}))? by (.+)$`，
 * 其中 JS 正则的 `.` **不匹配** `\r` → 行匹配失败 → 规则**静默通过**（假合规）。
 *
 * 本文件锁两件事：
 * 1. 不论 LF 还是 CRLF，行 token 的 `value` 都不含 `\r`，版权行能被正则命中；
 * 2. CRLF 下 `range` / `loc` 仍逐字节对齐（换行符按 2 字符结转）。
 *
 * 若将来有人把 parser「改回与官方逐字一致」，本文件会失败——这是刻意的防回退。
 */
import { describe, expect, it } from 'vitest';
import { plainTextParser as rawPlainTextParser } from '../scripts/plain-text-parser.mjs';

/**
 * parser 的公开形状。`scripts/*.mjs` 是 lint 配置的支撑脚本（不在 `src` 内、
 * 无独立类型声明），类型化 lint 无法从 JS 文件推导其导出类型，故在此显式收窄，
 * 只声明本测试真正用到的 `parseForESLint`。
 */
interface PlainTextParser {
	parseForESLint(text: string): { ast: Record<string, unknown> };
}

const plainTextParser = rawPlainTextParser as unknown as PlainTextParser;

/** `obsidianmd/validate-license` 使用的同一条正则（与插件实现保持一致） */
const COPYRIGHT_RE = /^(?: |\t)*Copyright \(C\) (\d{4})(?:-(\d{4}))? by (.+)$/;

const COPYRIGHT_LINE = 'Copyright (C) 2026 by Winter Mosquito';

interface LineToken {
	type: string;
	value: string;
	range: [number, number];
	loc: { start: { line: number; column: number }; end: { line: number; column: number } };
}

/** 取 parser 产出的行 token 列表 */
function parse(text: string): LineToken[] {
	const { ast } = plainTextParser.parseForESLint(text);
	return ast.tokens as LineToken[];
}

const LF_TEXT = `MIT License\n\n${COPYRIGHT_LINE}\n\nPermission is hereby granted\n`;
const CRLF_TEXT = `MIT License\r\n\r\n${COPYRIGHT_LINE}\r\n\r\nPermission is hereby granted\r\n`;

describe('plainTextParser（LICENSE 行级 token）', () => {
	it('LF：每行一个 Line token，版权行可被 validate-license 正则命中', () => {
		const tokens = parse(LF_TEXT);
		// `split('\n')` 语义：末尾换行后还有一个空行 token
		expect(tokens).toHaveLength(6);
		expect(tokens.every((token) => token.type === 'Line')).toBe(true);

		const hit = tokens.map((token) => token.value.match(COPYRIGHT_RE)).find(Boolean);
		expect(hit?.[1]).toBe('2026');
		expect(hit?.[3]).toBe('Winter Mosquito');
	});

	it('CRLF：行尾 \\r 被剥离，版权行同样命中（官方实现会残留 \\r 而失配）', () => {
		const tokens = parse(CRLF_TEXT);
		expect(tokens.every((token) => !token.value.includes('\r'))).toBe(true);

		const hit = tokens.map((token) => token.value.match(COPYRIGHT_RE)).find(Boolean);
		expect(hit?.[3]).toBe('Winter Mosquito');
	});

	it('防回退护栏：保留 \\r 时正则必然失配——这正是必须剥离的原因', () => {
		expect(`${COPYRIGHT_LINE}\r`.match(COPYRIGHT_RE)).toBeNull();
		expect(COPYRIGHT_LINE.match(COPYRIGHT_RE)).not.toBeNull();
	});

	it('CRLF 下 range / loc 仍逐字节对齐（换行符按 2 字符结转）', () => {
		const tokens = parse(CRLF_TEXT);
		for (const token of tokens) {
			expect(CRLF_TEXT.slice(token.range[0], token.range[1])).toBe(token.value);
		}

		const copyrightToken = tokens[2];
		expect(copyrightToken?.range[0]).toBe(CRLF_TEXT.indexOf(COPYRIGHT_LINE));
		expect(copyrightToken?.loc.start).toEqual({ line: 3, column: 0 });
		expect(copyrightToken?.loc.end).toEqual({ line: 3, column: COPYRIGHT_LINE.length });
	});
});
