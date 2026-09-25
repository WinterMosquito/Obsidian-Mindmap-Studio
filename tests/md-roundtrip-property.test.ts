/**
 * Markdown ⇄ 思维导图 往返「生成式」验证（fast-check property-based）。
 *
 * 与 md-roundtrip.test.ts（示例驱动：黄金样本 + rawOk 分支矩阵）互补，本文件
 * 用随机生成输入机械验证四条性质。等价性分级与规范化白名单见
 * docs/markdown-mindmap-standard.md §3.6——下方 canonicalize 与白名单一一
 * 对应，文档与测试不得漂移（P2 失败时先核对是否白名单内规范化，再判缺陷）：
 * - P1 不动点：T∘T = T——白名单规范化在第一趟完成，第二趟必须逐字相等；
 * - P2 内容守恒：canonical 化后行序列（含顺序）相等——顺序保持本身即不变式；
 * - P3 健壮性：任意输入解析+序列化不抛错；
 * - P4 语料与变异：tests/fixtures/roundtrip/ 自建语料 T∘T=T；字符级变异冒烟。
 *
 * 语料为何自建、为何不含 frontmatter：frontmatter 不参与 serializeMdBody
 * 输出（由 md-roundtrip.test.ts 的 frontmatter 用例锁定），语料只覆盖正文；
 * CRLF 形态用程序生成（P4），不落 fixture 文件——仓库无 .gitattributes，
 * Windows 检出（core.autocrlf=true）与 CI（LF）字节不同会让 fixture 漂移。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseMdOutline } from '../src/markdown/md-outline';
import { serializeMdBody } from '../src/markdown/md-serialize';

// ---------------------------------------------------------------------------
// 生成器：标题（含空标题）/ 列表（有序/无序/空项/嵌套）/ 段落 / 围栏 / 空行
// ---------------------------------------------------------------------------

/** 行内文本池：轻标记 / 链接 / 图片 / URL / 混排 / 转义 / 注释 / 多空格 / 空 */
const INLINE_TEXTS = [
	'纯文本',
	'**加粗**',
	'__粗体__',
	'*斜体*',
	'`代码`',
	'``双反引号 ` 内嵌``',
	'~~删除~~',
	'==高亮==',
	'***粗斜***',
	'[[笔记A]]',
	'[[笔记A|别名]]',
	'[[folder/笔记B.md#章节]]',
	'[[folder/笔记B.md#章节|区块别名]]',
	'![[图片.png]]',
	'![[图片.png|300]]',
	'![[报告.pdf]]',
	'[[归档.zip]]',
	'[文本](https://example.com/x)',
	'<https://example.com/auto>',
	'https://example.com/bare',
	'说明 [[双链]] 混排',
	'![[图.png]] 前图后文',
	'\\*转义\\*',
	'%%注释%% 后接文本',
	'a  多  空格  折叠',
	'',
] as const;

const inlineTextArb = fc.constantFrom(...INLINE_TEXTS);

const headingLineArb = fc
	.tuple(fc.constantFrom(1, 2, 3, 4, 5, 6), fc.option(inlineTextArb, { nil: null }))
	.map(([level, text]) =>
		text === null ? `${'#'.repeat(level)} ` : `${'#'.repeat(level)} ${text}`,
	);

const markerArb = fc.oneof(
	fc.constantFrom('-', '*', '+'),
	fc.nat({ max: 20 }).map((n) => `${n + 1}.`),
);

const listLineArb = fc
	.tuple(fc.nat({ max: 3 }), markerArb, fc.option(inlineTextArb, { nil: null }))
	.map(([indent, marker, text]) => {
		// 生成空间收窄（对应 §3.6 白名单 #10 已登记边界）：根层缩进列表保存后
		// 缩进按树深度重排，紧随其后的缩进行会被二次解析并作续行（内容不丢、
		// 第二趟收敛，但首趟非不动点）。生成器里唯一携带缩进的 plain 行是
		// 空列表项（退化为 plain、缩进进 mdRaw；text 为 null 或 '' 时行尾只有
		// 「标记 + 空格」→ trimEnd 后不再匹配 LIST_RE），钉在 0 层以把 P1 空间
		// 限制在白名单内；非空缩进列表保留（嵌套的相对缩进不受影响）。
		const level = text ? indent : 0;
		return `${'  '.repeat(level)}${marker}${text === null ? ' ' : ` ${text}`}`;
	});

const fenceBodyLineArb = fc.constantFrom(
	'const x = 1;',
	'# 不是标题（围栏内容）',
	'- 不是列表（围栏内容）',
	'',
	'  缩进行',
	'    深缩进',
);

const fenceBlockArb = fc
	.tuple(
		fc.constantFrom('```', '~~~'),
		fc.option(fc.constantFrom('ts', 'js', ''), { nil: '' }),
		fc.array(fenceBodyLineArb, { maxLength: 4 }),
	)
	.map(([tick, lang, body]) => [`${tick}${lang}`, ...body, tick].join('\n'));

const docLineArb = fc.oneof(
	{ weight: 3, arbitrary: headingLineArb },
	{ weight: 5, arbitrary: listLineArb },
	{ weight: 3, arbitrary: inlineTextArb },
	{ weight: 2, arbitrary: fenceBlockArb },
	{ weight: 2, arbitrary: fc.constant('') },
);

const docArb = fc
	.array(docLineArb, { minLength: 0, maxLength: 24 })
	.map((lines) => lines.join('\n'));

// ---------------------------------------------------------------------------
// canonical 化：§3.6 白名单的机器化（P2 对输入与输出双侧归一后按行序比较）
// ---------------------------------------------------------------------------

const STANDALONE_DASH_RE = /^\s*---+\s*$/;

function canonicalize(md: string): string[] {
	return md
		.split('\n')
		// 白名单 #1/#2/#9：空行归一（块分隔由序列化统一补一枚）
		.filter((line) => line.trim() !== '')
		// 白名单 #3：独立 `---` 丢弃（setext 下划线两侧同样过滤，不影响等价）
		.filter((line) => !STANDALONE_DASH_RE.test(line))
		// 白名单 #4：有序编号重排 1..n → 双侧统一映射为 N.
		.map((line) => line.replace(/^(\s*)(\d+)\.(?=[ \t])/, '$1N.'))
		// 白名单（§3.4 续行缩进归一的同族）：列表缩进 = 树深度 × 2 空格，
		// tab / 多空格不参与比较（段落行首缩进字节级保真，同样不参与比较）
		.map((line) => line.replace(/^[ \t]+/, ''))
		// 行尾空格：内容侧逐字保真（含硬换行语义），不参与等价比较
		.map((line) => line.trimEnd());
}

function roundTripBody(md: string): { out1: string; out2: string } {
	const out1 = serializeMdBody(parseMdOutline(md, '根').tree, null);
	const out2 = serializeMdBody(parseMdOutline(out1, '根').tree, null);
	return { out1, out2 };
}

// ---------------------------------------------------------------------------
// 性质
// ---------------------------------------------------------------------------

describe('P1 不动点：T∘T = T', () => {
	it('任意生成的 Markdown，第二趟往返逐字等于第一趟输出', () => {
		fc.assert(
			fc.property(docArb, (md) => {
				const { out1, out2 } = roundTripBody(md);
				expect(out2).toBe(out1);
			}),
			{ numRuns: 300 },
		);
	});
});

describe('P2 内容守恒：canonical（§3.6 白名单机器化）后行序列相等', () => {
	it('顺序保持 + 行内容守恒（白名单内的归一除外）', () => {
		fc.assert(
			fc.property(docArb, (md) => {
				const out1 = serializeMdBody(parseMdOutline(md, '根').tree, null);
				expect(canonicalize(out1)).toEqual(canonicalize(md));
			}),
			{ numRuns: 300 },
		);
	});
});

describe('P3 健壮性', () => {
	it('任意输入解析与序列化不抛错', () => {
		fc.assert(
			fc.property(docArb, (md) => {
				expect(() => roundTripBody(md)).not.toThrow();
			}),
			{ numRuns: 300 },
		);
	});
});

describe('P4 自建语料与变异冒烟', () => {
	const fixturesDir = path.resolve(import.meta.dirname, 'fixtures/roundtrip');
	const corpus = readdirSync(fixturesDir)
		.filter((name) => name.endsWith('.md'))
		.sort()
		.map((name) => ({
			name,
			content: readFileSync(path.join(fixturesDir, name), 'utf8'),
		}));

	it('语料不动点 + canonical 守恒（每份语料）', () => {
		expect(corpus.length, '语料文件数').toBe(8);
		for (const { name, content } of corpus) {
			const { out1, out2 } = roundTripBody(content);
			expect(out2, `${name}: T∘T=T`).toBe(out1);
			expect(canonicalize(out1), `${name}: canonical 守恒`).toEqual(
				canonicalize(content),
			);
		}
	});

	it('CRLF 形态（程序生成，规避 autocrlf 检出漂移）：canonical 守恒 + 不动点', () => {
		const lf = ['# 顶', '- 项', '', '段落'].join('\n');
		const crlf = lf.split('\n').join('\r\n');
		const out1 = serializeMdBody(parseMdOutline(crlf, '根').tree, null);
		const out2 = serializeMdBody(parseMdOutline(out1, '根').tree, null);
		expect(canonicalize(out1)).toEqual(canonicalize(crlf));
		expect(out2, 'CRLF 输入的不动点').toBe(out1);
	});

	it('变异冒烟：语料字符级插入不抛错', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...corpus.map((c) => c.content)),
				fc.nat({ max: 6 }),
				fc.constantFrom(...'`#-*[]!|=\\ \t<>'),
				fc.nat({ max: 4000 }),
				(base, count, ch, seed) => {
					let s = base;
					for (let i = 0; i < count; i++) {
						const pos = (seed + i * 137) % (s.length + 1);
						s = s.slice(0, pos) + ch + s.slice(pos);
					}
					expect(() => roundTripBody(s)).not.toThrow();
				},
			),
			{ numRuns: 200 },
		);
	});
});
