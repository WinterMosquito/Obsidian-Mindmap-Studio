/**
 * domain 层单元测试：wikilink 解析/构造契约 + walkTree 遍历语义。
 *
 * wikilink 契约是 links-tree（重命名/删除引用更新）、view-wikilink（悬停预览）、
 * view（跳转）、md-serialize（合成回写）、modal-link（新建链接）的共同依赖；
 * walkTree 的显式栈与终止语义是深树回归（5 万级不栈溢出）的保障。
 */
import { describe, expect, it } from 'vitest';
import {
	formatWikilink,
	isWikilink,
	linkDisplayText,
	parseWikilink,
	wikilinkLinkpath,
} from '../src/domain/wikilink';
import { walkTree } from '../src/domain/tree';

interface TNode {
	id: string;
	children?: TNode[];
}

describe('parseWikilink', () => {
	it('解析无别名/无区块的裸链接', () => {
		expect(parseWikilink('[[note]]')).toEqual({
			target: 'note',
			block: '',
			alias: '',
			linkpath: 'note',
			inner: 'note',
		});
	});

	it('解析 带区块+别名 的完整形态', () => {
		expect(parseWikilink('[[note#标题|别名]]')).toEqual({
			target: 'note',
			block: '标题',
			alias: '别名',
			linkpath: 'note#标题',
			inner: 'note#标题|别名',
		});
	});

	it('别名含 # 与 |：别名取首个 | 之后整段', () => {
		const parts = parseWikilink('[[note|a#b|c]]');
		expect(parts?.alias).toBe('a#b|c');
		expect(parts?.target).toBe('note');
	});

	it('空目标 [[|alias]]：target/linkpath 为空串', () => {
		const parts = parseWikilink('[[|alias]]');
		expect(parts?.target).toBe('');
		expect(parts?.alias).toBe('alias');
	});

	it('非维基链接返回 null（URL / 库内路径 / 残缺 [[x）', () => {
		expect(parseWikilink('https://example.com')).toBeNull();
		expect(parseWikilink('folder/note.md')).toBeNull();
		expect(parseWikilink('[[x')).toBeNull();
		expect(parseWikilink('')).toBeNull();
	});

	it('isWikilink：整串匹配，残缺形态不算', () => {
		expect(isWikilink('[[note]]')).toBe(true);
		expect(isWikilink('[[note#h|a]]')).toBe(true);
		expect(isWikilink('[[x')).toBe(false);
		expect(isWikilink('text [[x]] text')).toBe(false);
	});
});

describe('wikilinkLinkpath', () => {
	it('保留 # 区块、剥离别名（悬停预览语义）', () => {
		expect(wikilinkLinkpath('[[note#标题|别名]]')).toBe('note#标题');
		expect(wikilinkLinkpath('[[note]]')).toBe('note');
	});

	it('空目标与非维基链接返回 null', () => {
		expect(wikilinkLinkpath('[[|alias]]')).toBeNull();
		expect(wikilinkLinkpath('https://example.com')).toBeNull();
	});
});

describe('formatWikilink', () => {
	it('无别名省略 | 段；有别名输出 [[path|alias]]', () => {
		expect(formatWikilink('note')).toBe('[[note]]');
		expect(formatWikilink('note', '别名')).toBe('[[note|别名]]');
		expect(formatWikilink('note', '')).toBe('[[note]]');
	});

	it('format ∘ parse 不动点（含区块与别名）', () => {
		const link = formatWikilink('folder/note#标题', '别名');
		const parts = parseWikilink(link);
		expect(link).toBe('[[folder/note#标题|别名]]');
		expect(parts?.target).toBe('folder/note');
		expect(parts?.block).toBe('标题');
		expect(parts?.alias).toBe('别名');
	});

	it('重命名契约：目标替换后保留 #区块/|别名 尾巴（links-tree 场景）', () => {
		const old = parseWikilink('[[folder/old#区块|别名]]');
		const tail = `${old?.block ? `#${old.block}` : ''}${old?.alias ? `|${old.alias}` : ''}`;
		expect(formatWikilink(`folder/new${tail}`)).toBe(
			'[[folder/new#区块|别名]]',
		);
	});
});

describe('linkDisplayText', () => {
	it('别名优先', () => {
		expect(linkDisplayText('[[note|别名]]')).toBe('别名');
	});

	it('无别名取末段并去 .md 扩展（笔记显示名）', () => {
		expect(linkDisplayText('[[folder/note.md]]')).toBe('note');
		expect(linkDisplayText('[[folder/note]]')).toBe('note');
		// 非 .md 扩展保留（附件语义）
		expect(linkDisplayText('[[folder/file.pdf]]')).toBe('file.pdf');
	});

	it('非维基链接原样可见', () => {
		expect(linkDisplayText('https://example.com')).toBe('https://example.com');
		expect(linkDisplayText('folder/note.md')).toBe('folder/note.md');
	});
});

describe('walkTree', () => {
	it('先序遍历：父先于子、子按原顺序', () => {
		const tree: TNode = {
			id: 'root',
			children: [
				{ id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
				{ id: 'b' },
			],
		};
		const order: string[] = [];
		walkTree(tree, (n) => {
			order.push(n.id);
		});
		expect(order).toEqual(['root', 'a', 'a1', 'a2', 'b']);
	});

	it('visit 返回 false 终止整棵树遍历（搜索命中即停）', () => {
		const tree: TNode = {
			id: 'root',
			children: [{ id: 'hit' }, { id: 'after' }],
		};
		const order: string[] = [];
		walkTree(tree, (n) => {
			order.push(n.id);
			return n.id === 'hit' ? false : undefined;
		});
		expect(order).toEqual(['root', 'hit']);
	});

	it('children 缺失/为 undefined 均安全', () => {
		const visited: string[] = [];
		walkTree<TNode>({ id: 'solo' }, (n) => {
			visited.push(n.id);
		});
		walkTree<TNode>({ id: 'null-kids', children: undefined }, (n) => {
			visited.push(n.id);
		});
		expect(visited).toEqual(['solo', 'null-kids']);
	});

	it('5 万级深树不栈溢出（显式栈回归）', () => {
		const depth = 50000;
		let chain: TNode = { id: 'n0' };
		let cursor = chain;
		for (let i = 1; i < depth; i++) {
			const next: TNode = { id: `n${i}` };
			cursor.children = [next];
			cursor = next;
		}
		let count = 0;
		expect(() =>
			walkTree(chain, () => {
				count++;
			}),
		).not.toThrow();
		expect(count).toBe(depth);
	});
});
