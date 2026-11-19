import { describe, expect, it } from 'vitest';
import { FencedBlockConflictError, fencedNodeBlocks, replaceFencedNodeBlock } from '../../src/markdown/md-codeblocks';

describe('插件围栏定位与原文回写', () => {
	it('四反引号 tab 保留内层 shell，多个相同块由顺序区分', () => {
		const block = '````tab\ntab: A\n```shell\necho hello\n```\n````';
		const raw = `前文\n${block}\n中间\n${block}\n后文`;
		const blocks = fencedNodeBlocks(raw);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.source).toBe('tab: A\n```shell\necho hello\n```');
		const edited = replaceFencedNodeBlock(raw, 1, blocks[1]!.source, 'tab: B\n新内容');
		expect(edited).toBe(`前文\n${block}\n中间\n\`\`\`\`tab\ntab: B\n新内容\n\`\`\`\`\n后文`);
	});
	it('引用前缀与 CRLF 原样保留，关闭围栏长度由现有判据确认', () => {
		const raw = '> ````tab\r\n> tab: A\r\n> 原文\r\n> `````\r\n结尾';
		const blocks = fencedNodeBlocks(raw);
		expect(blocks[0]?.source).toBe('tab: A\n原文');
		expect(replaceFencedNodeBlock(raw, 0, 'tab: A\n原文\n', 'tab: A\n新文')).toBe('> ````tab\r\n> tab: A\r\n> 新文\r\n> `````\r\n结尾');
	});
	it('删除仅移除指定代码块，不清空其他内容；过期内容拒绝回写', () => {
		const raw = '说明\n```tikz\n原文\n```\n后文';
		expect(replaceFencedNodeBlock(raw, 0, '原文', null)).toBe('说明\n后文');
		expect(() => replaceFencedNodeBlock(raw, 0, '过期内容', '新文')).toThrow(FencedBlockConflictError);
	});
	it('语言信息沿用统一首词判据，编辑保留原始信息行', () => {
		const raw = '~~~TaB title="x"\ntab: A\n原文\n~~~';
		expect(fencedNodeBlocks(raw)[0]?.language).toBe('tab');
		expect(replaceFencedNodeBlock(raw, 0, 'tab: A\n原文', 'tab: A\n新文')).toBe('~~~TaB title="x"\ntab: A\n新文\n~~~');
	});
	it('新正文包含更长的内层围栏时延长外层，重开不吞掉后文', () => {
		const raw = '前文\n````tab\ntab: A\n旧文\n````\n后文';
		const next = 'tab: A\n`````shell\necho new\n`````';
		const changed = replaceFencedNodeBlock(raw, 0, 'tab: A\n旧文', next);
		expect(changed).toBe('前文\n``````tab\n' + next + '\n``````\n后文');
		expect(fencedNodeBlocks(changed)[0]?.source).toBe(next);
	});
});
