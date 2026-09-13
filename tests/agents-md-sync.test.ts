/**
 * AGENTS.md 同步契约：代码文件登记完备性。
 *
 * 把「新增/重命名/删除源文件必须同步 AGENTS.md」从口头约定变成红灯：
 * 断言 src/ 与 tests/ 下每个 .ts 文件的 basename 都以**独立 token** 形式
 * 出现在 AGENTS.md 中（对应「代码结构」的 src 清单与 tests 清单）。
 * 漏登记（或文件删除后文档未清理）时，本测试失败并列出具体文件名。
 *
 * 匹配口径：按 `[^\w.-]+` 切分 AGENTS.md 得到 token 集合，用 basename
 * 精确命中——故 `tree.ts` 不会被 `links-tree.ts` 这类粘连子串误命中
 * （朴素 includes 会误判，本文件刻意不用）。
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
});
