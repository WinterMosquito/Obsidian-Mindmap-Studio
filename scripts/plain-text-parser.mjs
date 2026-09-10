/**
 * 纯文本行级 ESLint parser（等价于 eslint-plugin-obsidianmd 内置实现）。
 *
 * 官方 `lib/plainTextParser.ts` 未从包入口导出，也未挂进 `recommended`，
 * 而 `obsidianmd/validate-license` 又必须拿到一份能吐 token 的 AST 才能取到
 * 版权行——故在此自备等价实现，供 eslint.config.mts 的 `files: ['LICENSE']`
 * 语言块使用（scripts/** 已在 globalIgnores 中，本文件自身不参与 lint）。
 *
 * 契约（与官方一致）：每一行是一个 `Line` token，`value` 为不含换行的行内容；
 * AST 为 `body`/`comments` 均空的 `Program`，仅靠 tokens 承载文本。
 */

/** @type {import('eslint').Parser.ParserModule} */
export const plainTextParser = {
	meta: {
		name: 'plain-text-parser',
		version: '1.0.0',
	},

	/**
	 * 把整份文本切成行级 token。
	 *
 * `range` 按「行内容长度」推进、偏移按「原始行长 + 1 个换行符」结转，与官方
 * 实现逐字节对齐，这样规则里按 range 取原文才能命中正确的行（validate-license
 * 正是靠 `token.value.match(/.../)` 拿到版权行的）。
 *
 * 与官方实现的一处有意差异：**兼容 CRLF**。官方 `lib/plainTextParser.ts` 只
 * 按 `\n` 切分，Windows（`core.autocrlf=true`）检出时每行会残留行尾 `\r`；而
 * validate-license 的正则是 `(.+)$`，其中 `.` 不匹配 `\r`，于是版权行匹配失败、
 * 规则**静默失效**（上游亦如此）。此处剥掉行尾 `\r`，使本地这道防线真正生效。
 *
 * @param {string} text 待解析的纯文本（这里恒为 LICENSE 全文）
 * @returns {{ ast: Record<string, unknown> }} 仅含 tokens 的 Program AST
 */
parseForESLint(text) {
	const lines = text.split('\n');

	/** @type {Array<Record<string, unknown>>} */
	const tokens = [];
	let index = 0;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		// CRLF 行尾剥掉 `\r`（LF 行 raw 不含 `\r`，行为与旧实现完全一致）。
		const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
		tokens.push({
			// `Line` 本是多行注释的 token 类型，这里借用它表示一行文本。
			type: 'Line',
			value,
			range: [index, index + value.length],
			loc: {
				start: { line: i + 1, column: 0 },
				end: { line: i + 1, column: value.length },
			},
		});
		index += raw.length + 1; // raw 含 \r 时即「内容 + \r + \n」，偏移仍逐字节对齐
	}

		const first = tokens[0];
		const last = tokens[tokens.length - 1];

		return {
			ast: {
				type: 'Program',
				sourceType: 'script',
				range: [0, text.length],
				loc: {
					// 官方此处直接索引 tokens[len-1]，空文本会抛 TypeError。
					// `''.split('\n')` 恒返回 `['']`，所以这里实际取不到 undefined，
					// 但保留兜底以免将来改成过滤空行的写法时踩坑。
					start: first?.loc?.start ?? { line: 1, column: 0 },
					end: last?.loc?.end ?? { line: 1, column: 0 },
				},
				body: [],
				comments: [],
				tokens,
			},
		};
	},
};

export default plainTextParser;
