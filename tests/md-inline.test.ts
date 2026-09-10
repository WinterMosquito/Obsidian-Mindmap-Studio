/**
 * 行内 token 解析（src/md-outline.ts 的 tokenizeInline / splitFrontmatter）边界形态回归。
 *
 * 为什么用「整对象精确比对」而不是逐个字段断言：
 * InlineToken 的 start/end 是**切片语义**（end 排他），调用方（buildInlineData）
 * 靠它把行内 token 之间的原文片段原样搬进节点文本；位置算错一位就会吃掉或重复
 * 半个字符，而「kind/target 对得上」的弱断言完全看不出这类损坏。
 * 因此形态类用例一律 toEqual 完整 token 数组。
 *
 * 覆盖：wikilink / wiki 嵌入（含官方尺寸参数与非法参数）/ md 链接（尖括号目标剥壳）/
 * md 图片（尺寸在标签尾、目标不剥壳）/ autolink / 裸 URL（标点剥离与去重）/
 * 重复调用的状态无关性 / frontmatter 切分（含 CRLF 与重复块）。
 */
import { describe, expect, it, vi } from 'vitest';
import { splitFrontmatter, tokenizeInline } from '../src/md-outline';

describe('tokenizeInline — wikilink', () => {
	it('[[笔记]] → 完整 token（label 空串，位置为切片语义）', () => {
		expect(tokenizeInline('[[笔记]]')).toEqual([
			{ start: 0, end: 6, kind: 'wiki', target: '笔记', label: '' },
		]);
	});

	it('[[目标|别名]] → label 取别名（target 不含别名与管道）', () => {
		expect(tokenizeInline('[[目标|别名]]')).toEqual([
			{ start: 0, end: 9, kind: 'wiki', target: '目标', label: '别名' },
		]);
	});

	it('前后文本保留在 token 之外（start/end 必须精确到字符）', () => {
		const toks = tokenizeInline('你好 [[笔记]] 世界');
		expect(toks).toEqual([
			{ start: 3, end: 9, kind: 'wiki', target: '笔记', label: '' },
		]);
		// 调用方按 [0, start) / [end, len) 取原文片段，位置错则丢字
		const raw = '你好 [[笔记]] 世界';
		expect(raw.slice(0, toks[0]!.start) + raw.slice(toks[0]!.end)).toBe(
			'你好  世界',
		);
	});

	it('路径与 .md 后缀原样存入 target（显示名剥离由消费方负责）', () => {
		expect(tokenizeInline('[[folder/笔记.md]]')[0]!.target).toBe('folder/笔记.md');
	});

	it('target 保留原样空白；label 两侧空白被 trim', () => {
		const tok = tokenizeInline('[[ 目标 | 别名 ]]')[0]!;
		expect(tok.target, 'target 不做 trim（调用方按原文定位）').toBe(' 目标 ');
		expect(tok.label, 'label 是显示文本，两侧空白无意义').toBe('别名');
	});

	it('残缺/空形态不产生 token：[[.. 未闭合、[[]]、[[|别名]]', () => {
		expect(tokenizeInline('[[未闭合')).toEqual([]);
		expect(tokenizeInline('[[]]')).toEqual([]);
		expect(tokenizeInline('[[|别名]]'), 'target 段不可为空').toEqual([]);
	});

	it('同一行多个 wikilink 按出现顺序返回', () => {
		const raw = '[[A]] 与 [[B|b]]';
		expect(tokenizeInline(raw).map((t) => [t.kind, t.target, t.label])).toEqual([
			['wiki', 'A', ''],
			['wiki', 'B', 'b'],
		]);
	});
});

describe('tokenizeInline — 嵌入图片（wiki 语法 + 官方尺寸参数）', () => {
	it('![[图.png]] → wikiImg，target 为图片路径', () => {
		expect(tokenizeInline('![[图.png]]')).toEqual([
			{ start: 0, end: 10, kind: 'wikiImg', target: '图.png', label: '' },
		]);
	});

	it('![[图.png|300]] → 仅宽（高度缺省，由加载校正按比例补齐）', () => {
		expect(tokenizeInline('![[图.png|300]]')).toEqual([
			{
				start: 0,
				end: 14,
				kind: 'wikiImg',
				target: '图.png',
				label: '',
				sizeWidth: 300,
				sizeHeight: undefined,
			},
		]);
	});

	it('![[图.png|300x150]] → 宽高双参数', () => {
		expect(tokenizeInline('![[图.png|300x150]]')[0]).toEqual({
			start: 0,
			end: 18,
			kind: 'wikiImg',
			target: '图.png',
			label: '',
			sizeWidth: 300,
			sizeHeight: 150,
		});
	});

	it('非数字标签保留为说明文本（嵌入不支持别名，但说明要能回写）', () => {
		const tok = tokenizeInline('![[图.png|可爱小猫]]')[0]!;
		expect(tok.label).toBe('可爱小猫');
		expect(tok.sizeWidth, '非数字标签不是尺寸').toBeUndefined();
		expect(tok.sizeHeight).toBeUndefined();
	});

	it('残缺/零值尺寸参数按说明文本处理（数字字面量语法严格匹配）', () => {
		// 终界缺失：|300x 不是合法的 `宽x高` → 整段标签当说明文本
		const bad = tokenizeInline('![[图.png|300x]]')[0]!;
		expect(bad.label).toBe('300x');
		expect(bad.sizeWidth).toBeUndefined();
		// 0 宽/0 高被丢弃（尺寸须 > 0），但标签仍被识别为尺寸位（alt 不残留）
		const zeroW = tokenizeInline('![[图.png|0]]')[0]!;
		expect(zeroW.label).toBe('');
		expect(zeroW.sizeWidth).toBeUndefined();
		const zeroH = tokenizeInline('![[图.png|300x0]]')[0]!;
		expect(zeroH.sizeWidth).toBe(300);
		expect(zeroH.sizeHeight, '高度 0 不成立').toBeUndefined();
	});

	it('空标签（![[图.png|]]）不产生尺寸也不产生 alt', () => {
		const tok = tokenizeInline('![[图.png|]]')[0]!;
		expect(tok.kind).toBe('wikiImg');
		expect(tok.label).toBe('');
		expect(tok.sizeWidth).toBeUndefined();
	});

	it('非图片嵌入仍是 wikiImg（图片与否由扩展名在消费方判定）', () => {
		expect(tokenizeInline('![[报告.pdf]]')[0]).toEqual({
			start: 0,
			end: 11,
			kind: 'wikiImg',
			target: '报告.pdf',
			label: '',
		});
	});
});

describe('tokenizeInline — md 链接', () => {
	it('[text](https://x.com) → mdLink，label/target 就位', () => {
		expect(tokenizeInline('[text](https://x.com)')).toEqual([
			{
				start: 0,
				end: 21,
				kind: 'mdLink',
				target: 'https://x.com',
				label: 'text',
			},
		]);
	});

	it('尖括号目标剥壳（避免回写时二次包裹成 <<url>>）', () => {
		expect(tokenizeInline('[t](<https://x.com>)')[0]).toEqual({
			start: 0,
			end: 20,
			kind: 'mdLink',
			target: 'https://x.com',
			label: 't',
		});
	});

	it('尖括号内可含空格（CommonMark <dest> 形态，裸目标做不到）', () => {
		const tok = tokenizeInline('[笔记](<folder/my note.md>)')[0]!;
		expect(tok.target).toBe('folder/my note.md');
		expect(tok.label).toBe('笔记');
	});

	it('空 label 与 label 两侧空白（trim 后存显示文本）', () => {
		expect(tokenizeInline('[](url)')[0]).toEqual({
			start: 0,
			end: 7,
			kind: 'mdLink',
			target: 'url',
			label: '',
		});
		expect(tokenizeInline('[ t ](url)')[0]!.label).toBe('t');
	});

	it('相对路径目标原样（非 URL 形态不剥壳不加包裹）', () => {
		const tok = tokenizeInline('[笔记](folder/note.md)')[0]!;
		expect(tok.target).toBe('folder/note.md');
		expect(tok.kind).toBe('mdLink');
	});
});

describe('tokenizeInline — md 图片', () => {
	it('![alt](url) → mdImg', () => {
		expect(tokenizeInline('![alt](https://x.com/a.png)')).toEqual([
			{
				start: 0,
				end: 27,
				kind: 'mdImg',
				target: 'https://x.com/a.png',
				label: 'alt',
			},
		]);
	});

	it('![alt|300](url) / ![alt|100x145](url) → 尺寸在标签尾部，alt 与尺寸共存', () => {
		const w = tokenizeInline('![alt|300](https://x.com/a.png)')[0]!;
		expect(w.label).toBe('alt');
		expect(w.sizeWidth).toBe(300);
		expect(w.sizeHeight).toBeUndefined();

		const wh = tokenizeInline('![Engelbart|100x145](https://x.com/a.png)')[0]!;
		expect(wh.label).toBe('Engelbart');
		expect(wh.sizeWidth).toBe(100);
		expect(wh.sizeHeight).toBe(145);
	});

	it('![250](url) → 整段标签即尺寸（alt 为空）', () => {
		const tok = tokenizeInline('![250](https://x.com/b.png)')[0]!;
		expect(tok.label).toBe('');
		expect(tok.sizeWidth).toBe(250);
	});

	it('非数字标签整体作为 alt（含管道字符），不产生尺寸', () => {
		const tok = tokenizeInline('![alt|abc](url)')[0]!;
		expect(tok.label).toBe('alt|abc');
		expect(tok.sizeWidth).toBeUndefined();
	});

	it('图片目标不做尖括号剥壳（与 md 链接不同，回写侧原样保留）', () => {
		const tok = tokenizeInline('![alt](<https://x.com/a.png>)')[0]!;
		expect(tok.target, '图片目标保持原样（renderImage 直接拼接）').toBe(
			'<https://x.com/a.png>',
		);
	});
});

describe('tokenizeInline — 尖括号 autolink 与裸 URL', () => {
	it('<https://x.com/a> → autolink，target 不含尖括号', () => {
		expect(tokenizeInline('<https://x.com/a>')).toEqual([
			{ start: 0, end: 17, kind: 'autolink', target: 'https://x.com/a', label: '' },
		]);
	});

	it('其它 scheme（obsidian://）同样识别；非 scheme 的 <> 内容不识别', () => {
		expect(tokenizeInline('<obsidian://open?vault=x>')[0]).toEqual({
			start: 0,
			end: 25,
			kind: 'autolink',
			target: 'obsidian://open?vault=x',
			label: '',
		});
		expect(tokenizeInline('<not a url>'), '无 scheme:// 不算链接').toEqual([]);
	});

	it('行内裸 URL → bareUrl（http/https/ftp/obsidian 白名单）', () => {
		expect(tokenizeInline('详见 https://x.com/a')).toEqual([
			{ start: 3, end: 18, kind: 'bareUrl', target: 'https://x.com/a', label: '' },
		]);
		expect(tokenizeInline('ftp://files.example.com/x')[0]!.kind).toBe('bareUrl');
		expect(tokenizeInline('obsidian://open')[0]).toEqual({
			start: 0,
			end: 15,
			kind: 'bareUrl',
			target: 'obsidian://open',
			label: '',
		});
	});

	it('尾部标点不属于 URL：end 收缩，标点留给节点文本', () => {
		const period = 'https://x.com/a。';
		const p = tokenizeInline(period)[0]!;
		expect(p.target).toBe('https://x.com/a');
		expect(period.slice(p.end), '中文句号留作正文').toBe('。');

		const paren = '(https://x.com/a.)';
		const q = tokenizeInline(paren)[0]!;
		expect(q.start, '左括号不属于 URL').toBe(1);
		expect(q.target).toBe('https://x.com/a');
		expect(paren.slice(q.end), '右括号与句点都留给正文').toBe('.)');

		const comma = '见 https://x.com/a，然后';
		const r = tokenizeInline(comma)[0]!;
		expect(r.target).toBe('https://x.com/a');
		expect(comma.slice(r.end)).toBe('，然后');
	});

	it('高优先级形态不重复产出裸 URL token', () => {
		const brackets = tokenizeInline('<https://x.com/a>');
		expect(brackets).toHaveLength(1);
		expect(brackets[0]!.kind).toBe('autolink');

		const mdLink = tokenizeInline('[t](https://x.com)');
		expect(mdLink).toHaveLength(1);
		expect(mdLink[0]!.kind).toBe('mdLink');

		const wiki = tokenizeInline('[[https://x.com]]');
		expect(wiki).toHaveLength(1);
		expect(wiki[0]!.kind, 'wikilink 目标恰是 URL 时仍按 wiki 解析').toBe('wiki');
	});
});

describe('tokenizeInline — 混合与状态无关性', () => {
	it('多 token 按位置顺序返回，kind 序列与各 token 字段精确', () => {
		const toks = tokenizeInline('见 [[A]] 和 [[B|b]]，以及 ![图](u)');
		expect(toks.map((t) => t.kind)).toEqual(['wiki', 'wiki', 'mdImg']);
		expect(toks.map((t) => [t.target, t.label])).toEqual([
			['A', ''],
			['B', 'b'],
			['u', '图'],
		]);
	});

	it('空输入与纯文本返回空数组', () => {
		expect(tokenizeInline('')).toEqual([]);
		expect(tokenizeInline('你好世界，没有链接')).toEqual([]);
	});

	it('重复调用结果一致（模块级 /g 正则的 lastIndex 已重置）', () => {
		const raw = '[[A]] 与 ![img](u)';
		const first = tokenizeInline(raw);
		const second = tokenizeInline(raw);
		expect(second).toEqual(first);
		expect(tokenizeInline('[[B]]'), '参数不同的第二次调用仍从行首扫描').toEqual([
			{ start: 0, end: 5, kind: 'wiki', target: 'B', label: '' },
		]);
	});
});

describe('splitFrontmatter', () => {
	it('切出 frontmatter（含首尾 --- 与尾随换行），body 为其余正文', () => {
		const { frontmatter, body } = splitFrontmatter(
			'---\ntitle: hi\n---\n# 标题\n- item',
		);
		expect(frontmatter).toBe('---\ntitle: hi\n---\n');
		expect(body).toBe('# 标题\n- item');
	});

	it('无 frontmatter → frontmatter=null、body 与输入完全相同', () => {
		const content = '# 标题\n- item';
		const r = splitFrontmatter(content);
		expect(r.frontmatter).toBeNull();
		expect(r.body).toBe(content);
	});

	it('未闭合的 --- 块不算 frontmatter（避免吃掉整篇正文）', () => {
		const content = '---\ntitle: hi\n# 标题';
		const r = splitFrontmatter(content);
		expect(r.frontmatter).toBeNull();
		expect(r.body).toBe(content);
	});

	it('CRLF 文件：frontmatter 原样保留 \\r\\n（不静默改写行尾）', () => {
		const r = splitFrontmatter('---\r\ntitle: hi\r\n---\r\nbody');
		expect(r.frontmatter).toBe('---\r\ntitle: hi\r\n---\r\n');
		expect(r.body).toBe('body');
	});

	it('仅有 frontmatter → body 为空串', () => {
		expect(splitFrontmatter('---\na: 1\n---\n')).toEqual({
			frontmatter: '---\na: 1\n---\n',
			body: '',
		});
	});

	it('空内容 → 无 frontmatter、body 为空串', () => {
		expect(splitFrontmatter('')).toEqual({ frontmatter: null, body: '' });
		expect(splitFrontmatter('\n\n')).toEqual({ frontmatter: null, body: '\n\n' });
	});

	it('重复 frontmatter：只取第一个块，body 保留第二个块并给出告警', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { frontmatter, body } = splitFrontmatter(
			'---\ntitle: hi\n---\n---\nbad: true\n---\n# title',
		);
		expect(frontmatter).toBe('---\ntitle: hi\n---\n');
		expect(body).toBe('---\nbad: true\n---\n# title');
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('检测到重复 YAML frontmatter'),
		);
		warn.mockRestore();
	});

	it('重复 frontmatter 之外的正文行首 --- 不告警（仅 body 开头才可能是误加第二块）', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		splitFrontmatter('---\na: 1\n---\n# 标题\n---\n正文');
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});
