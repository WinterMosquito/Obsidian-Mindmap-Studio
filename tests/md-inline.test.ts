/**
 * md-outline 行内 token 化白盒测试。
 * 覆盖 wikilink / 嵌入图片（含 Obsidian 官方尺寸参数）/ md link / md img / autolink。
 */
import { describe, expect, it, vi } from 'vitest';
import { tokenizeInline, splitFrontmatter } from '../src/md-outline';

describe('tokenizeInline — wikilink', () => {
	it('[[笔记]] → kind=wiki, target=笔记, label=""', () => {
		expect(tokenizeInline('[[笔记]]')).toEqual([
			expect.objectContaining({ kind: 'wiki', target: '笔记', label: '' }),
		]);
	});

	it('[[目标|别名]] → label 取别名', () => {
		const toks = tokenizeInline('[[目标|别名]]');
		expect(toks[0]!.label).toBe('别名');
		expect(toks[0]!.target).toBe('目标');
	});

	it('纯文本中的 [[链接]] 保留前后文本片段', () => {
		const toks = tokenizeInline('你好 [[笔记]] 世界');
		expect(toks).toHaveLength(1);
		expect(toks[0]!.start).toBe(3);
		expect(toks[0]!.end).toBe(9); // end 是 exclusive（slice 语义）
	});
});

describe('tokenizeInline — 嵌入图片', () => {
	it('![[图.png]] → kind=wikiImg, target=图.png', () => {
		expect(tokenizeInline('![[图.png]]')).toEqual([
			expect.objectContaining({ kind: 'wikiImg', target: '图.png' }),
		]);
	});

	it('![[图.png|300]] → sizeWidth=300（Obsidian 官方宽度参数）', () => {
		const tok = tokenizeInline('![[图.png|300]]')[0]!;
		expect(tok.sizeWidth).toBe(300);
		expect(tok.sizeHeight).toBeUndefined();
		// label 被当作尺寸参数剥离，应为空
		expect(tok.label).toBe('');
	});

	it('![[图.png|300x150]] → 宽高都带', () => {
		const tok = tokenizeInline('![[图.png|300x150]]')[0]!;
		expect(tok.sizeWidth).toBe(300);
		expect(tok.sizeHeight).toBe(150);
	});

	it('![[图.png|别名]] → 非数字标签保留为 alt，不带尺寸', () => {
		const tok = tokenizeInline('![[图.png|可爱小猫]]')[0]!;
		expect(tok.label).toBe('可爱小猫');
		expect(tok.sizeWidth).toBeUndefined();
	});
});

describe('tokenizeInline — md link', () => {
	it('[text](https://x.com) → kind=mdLink', () => {
		const tok = tokenizeInline('[text](https://x.com)')[0]!;
		expect(tok.kind).toBe('mdLink');
		expect(tok.label).toBe('text');
		expect(tok.target).toBe('https://x.com');
	});

	it('[t](<https://x.com>) → 尖括号目标剥壳（不含 <>）', () => {
		const tok = tokenizeInline('[t](<https://x.com>)')[0]!;
		expect(tok.target).toBe('https://x.com'); // 不含 <>
	});
});

describe('tokenizeInline — md img', () => {
	it('![alt](https://x.com/a.png) → kind=mdImg', () => {
		const tok = tokenizeInline('![alt](https://x.com/a.png)')[0]!;
		expect(tok.kind).toBe('mdImg');
		expect(tok.label).toBe('alt');
	});

	it('![alt|300](url) → 宽度参数', () => {
		const tok = tokenizeInline('![alt|300](https://x.com/a.png)')[0]!;
		expect(tok.sizeWidth).toBe(300);
		expect(tok.label).toBe('alt');
	});
});

describe('tokenizeInline — autolink', () => {
	it('<https://x.com> → kind=autolink, target 不含 <>', () => {
		const tok = tokenizeInline('<https://x.com>')[0]!;
		expect(tok.kind).toBe('autolink');
		expect(tok.target).toBe('https://x.com');
	});
});

describe('tokenizeInline — 混合文本', () => {
	it('多 token 按顺序返回', () => {
		const toks = tokenizeInline('见 [[A]] 和 [[B|b]]，以及 ![图](u)');
		expect(toks.map((t) => t.kind)).toEqual(['wiki', 'wiki', 'mdImg']);
		expect(toks[0]!.target).toBe('A');
		expect(toks[1]!.label).toBe('b');
		expect(toks[2]!.target).toBe('u');
	});

	it('空输入返回空数组', () => {
		expect(tokenizeInline('')).toEqual([]);
	});

	it('纯文本无 token 返回空数组', () => {
		expect(tokenizeInline('你好世界')).toEqual([]);
	});
});

// ---- splitFrontmatter ----

describe('splitFrontmatter', () => {
	it('正常 frontmatter + body', () => {
		const content = '---\ntitle: hi\n---\n# 标题\n- item';
		const { frontmatter, body } = splitFrontmatter(content);
		expect(frontmatter).toContain('title: hi');
		expect(body.trim()).toBe('# 标题\n- item');
	});

	it('无 frontmatter → frontmatter=null，body=content', () => {
		const content = '# 标题\n- item';
		const { frontmatter, body } = splitFrontmatter(content);
		expect(frontmatter).toBeNull();
		expect(body).toBe(content);
	});

	it('重复 frontmatter：body 开头又有 ---，仅第一个生效 + warn', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const content = '---\ntitle: hi\n---\n---\nbad: true\n---\n# title';
		const { frontmatter, body } = splitFrontmatter(content);
		expect(frontmatter).toContain('title: hi');
		// body 包含第二个 --- 块（按原逻辑，只取第一个 frontmatter 块）
		expect(body).toContain('bad: true');
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('检测到重复 YAML frontmatter'),
		);
		warn.mockRestore();
	});
});

// ---- tokenizeInline — 裸 URL（icon-only 语义）----

describe('tokenizeInline — 裸 URL', () => {
	it('行内裸 URL → kind=bareUrl，target 为 URL 本体', () => {
		expect(tokenizeInline('详见 https://x.com/a 说明')).toEqual([
			expect.objectContaining({ kind: 'bareUrl', target: 'https://x.com/a' }),
		]);
	});

	it('尾部中文句号不属于 URL（token.end 收缩，句号留给文本）', () => {
		const raw = 'https://x.com/a。';
		const tok = tokenizeInline(raw)[0]!;
		expect(tok.target).toBe('https://x.com/a');
		expect(raw.slice(tok.end)).toBe('。');
	});

	it('尾部英文句点/右括号同样剥离', () => {
		expect(tokenizeInline('(https://x.com/a.)')[0]!.target).toBe(
			'https://x.com/a',
		);
	});

	it('obsidian:// 与 ftp:// scheme 也识别', () => {
		expect(tokenizeInline('obsidian://open')[0]!.kind).toBe('bareUrl');
		expect(tokenizeInline('ftp://files.example.com/x')[0]!.kind).toBe(
			'bareUrl',
		);
	});

	it('尖括号 autolink 优先级更高（<url> 不产生 bareUrl 重复 token）', () => {
		const toks = tokenizeInline('<https://x.com/a>');
		expect(toks).toHaveLength(1);
		expect(toks[0]!.kind).toBe('autolink');
	});

	it('[t](https://x.com) 整体走 mdLink，URL 部分不再重复 token 化', () => {
		const toks = tokenizeInline('[t](https://x.com)');
		expect(toks).toHaveLength(1);
		expect(toks[0]!.kind).toBe('mdLink');
	});
});
