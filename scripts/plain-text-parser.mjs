// LICENSE 等纯文本文件的 ESLint 行级 parser。
// eslint-plugin-obsidianmd 的 validate-license 规则依赖其内置 plainTextParser
// （lib/plainTextParser.ts），该 parser 未被插件导出、也未挂入 recommended
// 配置，故自备等价实现：把文件每一行产出为一个 `Line` token 的空 Program，
// 供规则按行匹配版权声明（Copyright (C) YYYY[-YYYY] by 持有人）。
// 语义与官方 lib/plainTextParser.ts 保持一致，勿引入额外解析行为。

export const plainTextParser = {
	meta: {
		name: 'plain-text-parser',
		version: '1.0.0',
	},
	parseForESLint(text) {
		const lines = text.split('\n');
		const tokens = [];
		let index = 0;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			tokens.push({
				// Line 本是多行注释 token 类型，官方借此表示一行文本（同名实现）
				type: 'Line',
				value: line,
				range: [index, index + line.length],
				loc: {
					start: { line: i + 1, column: 0 },
					end: { line: i + 1, column: line.length },
				},
			});
			index += line.length + 1; // +1 为换行符
		}
		return {
			ast: {
				type: 'Program',
				sourceType: 'script',
				range: [0, text.length],
				loc: {
					start: { line: 1, column: 0 },
					end:
						tokens.length > 0
							? tokens[tokens.length - 1].loc.end
							: { line: 1, column: 0 },
				},
				body: [],
				comments: [],
				tokens,
			},
		};
	},
};

export default plainTextParser;
