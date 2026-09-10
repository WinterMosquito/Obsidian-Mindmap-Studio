/**
 * domain 层单元测试（纯函数，无需任何桩）：wikilink 契约 + walkTree 遍历语义。
 *
 * 为什么这两个模块值得密集边界覆盖：
 * - wikilink 是 links-tree（重命名/删除引用更新）、view-wikilink（悬停预览）、
 *   view（链接跳转）、md-serialize（合成回写）、modal-link（新建链接）的共同依赖，
 *   此前 5 处各自手写 `[[target|alias]]` 切片且对 `#区块` 处理不一致——这里把
 *   「linkpath / target / block / alias 各自的边界」逐条钉死，防止再次漂移。
 * - walkTree 用显式栈替代递归（树深由导入内容任意构造，递归会 RangeError）
 *   并提供 `visit` 返回 false 的短路，是深树回归与「搜索命中即停」的保障。
 *
 * 断言原则：全部对齐当前 src/domain 实现（含空白/畸形/Unicode/反斜杠/大小写
 * 等真实输入形态），不使用恒真断言。
 */
import { describe, expect, it } from 'vitest';
import {
	formatWikilink,
	isWikilink,
	linkDisplayText,
	parseWikilink,
	wikilinkLinkpath,
	wikilinkTargetIsAttachment,
} from '../src/domain/wikilink';
import { walkTree } from '../src/domain/tree';

/** 测试用树节点：children 声明为可选可空，覆盖解析/编辑中间态 */
interface TNode {
	id: string;
	children?: readonly TNode[] | null;
}

describe('isWikilink', () => {
	it.each([
		// 仅整串 `[[...]]` 形态命中（正则 ^...$ + inner 不含 `]`）
		{ input: '[[note]]', expected: true, why: '最简形态' },
		{ input: '[[note#标题|别名]]', expected: true, why: '区块+别名' },
		{ input: '[[folder/sub/note.md]]', expected: true, why: '路径形态' },
		{ input: '[[  ]]', expected: true, why: '空白 inner：正则只要求非 ] 字符至少一个' },
		{ input: '[[x', expected: false, why: '残缺开头' },
		{ input: 'x]]', expected: false, why: '残缺结尾' },
		{ input: '[[]]', expected: false, why: 'inner 为空（+ 量词要求至少一个字符）' },
		{ input: '', expected: false, why: '空串' },
		{ input: 'text [[x]] text', expected: false, why: '行内嵌在文本中不算（须整串）' },
		{ input: '[[a]b]]', expected: false, why: 'inner 禁止出现 ]' },
		{ input: '[[a]]]', expected: false, why: '多余右括号（尾锚点不匹配）' },
		{ input: '[[a]]\n', expected: false, why: '尾部换行破坏整串匹配' },
		{ input: '[ [a]]', expected: false, why: '方括号间有空格' },
	])('isWikilink($input) === $expected（$why）', ({ input, expected }) => {
		expect(isWikilink(input)).toBe(expected);
	});
});

describe('parseWikilink', () => {
	it('解析裸链接：target=linkpath=inner，block/alias 为空串', () => {
		expect(parseWikilink('[[note]]')).toEqual({
			target: 'note',
			block: '',
			alias: '',
			linkpath: 'note',
			inner: 'note',
		});
	});

	it('解析 区块+别名 完整形态：linkpath = `|` 之前整段（含 #）', () => {
		expect(parseWikilink('[[note#标题|别名]]')).toEqual({
			target: 'note',
			block: '标题',
			alias: '别名',
			linkpath: 'note#标题',
			inner: 'note#标题|别名',
		});
	});

	it('alias 取首个 `|` 之后整段（其中的 # 与 | 不参与分段）', () => {
		// 为什么这样断言：Obsidian 的 alias 是「首个 | 之后全部」，
		// 若误用 split('|') 取首段，`a#b|c` 会被截断成 `a`。
		const parts = parseWikilink('[[note|a#b|c]]');
		expect(parts?.target).toBe('note');
		expect(parts?.block).toBe('');
		expect(parts?.alias).toBe('a#b|c');
	});

	it('多个 `|` 时 target/block 仍只看首个 `|` 之前', () => {
		const parts = parseWikilink('[[a#b|c|d]]');
		expect(parts).toMatchObject({ target: 'a', block: 'b', alias: 'c|d', linkpath: 'a#b' });
	});

	it('target 取首个 `#` 之前，block 为其余全部（含二次 #）', () => {
		const parts = parseWikilink('[[note#标题#副标题]]');
		expect(parts?.target).toBe('note');
		expect(parts?.block).toBe('标题#副标题');
		expect(parts?.linkpath).toBe('note#标题#副标题');
	});

	it('空目标 [[|alias]]：target/linkpath 为空串，alias 正常', () => {
		const parts = parseWikilink('[[|alias]]');
		expect(parts).toEqual({
			target: '',
			block: '',
			alias: 'alias',
			linkpath: '',
			inner: '|alias',
		});
	});

	it('纯区块 [[#block]]：target 为空串、linkpath 保留 `#` 前缀', () => {
		const parts = parseWikilink('[[#区块]]');
		expect(parts).toEqual({
			target: '',
			block: '区块',
			alias: '',
			linkpath: '#区块',
			inner: '#区块',
		});
	});

	it('空 alias [[note|]]：alias 为空串（与无 alias 同形，显示名回退）', () => {
		const parts = parseWikilink('[[note|]]');
		expect(parts?.target).toBe('note');
		expect(parts?.alias).toBe('');
		expect(parts?.linkpath).toBe('note');
	});

	it('尾部空区块 [[note#]]：block 为空串但 linkpath 保留 `#`', () => {
		// 为什么这样断言：# 与 | 的分段是「先切 | 再切 #」的纯切片，
		// 空 block 不做归一，故 linkpath 保留原始 `note#`。
		const parts = parseWikilink('[[note#]]');
		expect(parts?.target).toBe('note');
		expect(parts?.block).toBe('');
		expect(parts?.linkpath).toBe('note#');
	});

	it('Unicode 路径与别名逐字保留（不做 URL 解码/消歧）', () => {
		const parts = parseWikilink('[[笔记/日 记#今日|显示名 🎯]]');
		expect(parts?.target).toBe('笔记/日 记');
		expect(parts?.block).toBe('今日');
		expect(parts?.alias).toBe('显示名 🎯');
	});

	it('反斜杠路径不被归一（Windows 风格输入原样保留）', () => {
		const parts = parseWikilink('[[folder\\sub\\note]]');
		expect(parts?.target).toBe('folder\\sub\\note');
		expect(parts?.linkpath).toBe('folder\\sub\\note');
	});

	it('非完整维基链接返回 null（URL / 库内路径 / 残缺 / 空串）', () => {
		expect(parseWikilink('https://example.com/a')).toBeNull();
		expect(parseWikilink('folder/note.md')).toBeNull();
		expect(parseWikilink('[[x')).toBeNull();
		expect(parseWikilink('x]]')).toBeNull();
		expect(parseWikilink('[[]]')).toBeNull();
		expect(parseWikilink('')).toBeNull();
	});
});

describe('wikilinkLinkpath', () => {
	it('保留 `#` 区块、剥离别名（悬停预览 / getFirstLinkpathDest 语义）', () => {
		expect(wikilinkLinkpath('[[note#标题|别名]]')).toBe('note#标题');
		expect(wikilinkLinkpath('[[note]]')).toBe('note');
		expect(wikilinkLinkpath('[[folder/note.md#h]]')).toBe('folder/note.md#h');
	});

	it('linkpath 非空即返回（纯区块 [[#x]] 也有效）', () => {
		// 为什么这样断言：判空针对 linkpath 而非 target——`[[#区块]]` 是
		// 本笔记内的区块引用，交由解析层处理，谓词不得提前否决。
		expect(wikilinkLinkpath('[[#区块]]')).toBe('#区块');
	});

	it('空 linkpath 与非维基链接返回 null', () => {
		expect(wikilinkLinkpath('[[|别名]]')).toBeNull();
		expect(wikilinkLinkpath('[[|]]')).toBeNull();
		expect(wikilinkLinkpath('https://example.com')).toBeNull();
		expect(wikilinkLinkpath('folder/note.md')).toBeNull();
		expect(wikilinkLinkpath('')).toBeNull();
	});
});

describe('formatWikilink', () => {
	it('无别名（含空串）省略 `|` 段', () => {
		expect(formatWikilink('note')).toBe('[[note]]');
		expect(formatWikilink('note', '')).toBe('[[note]]');
		expect(formatWikilink('note', undefined)).toBe('[[note]]');
	});

	it('有别名输出 [[linkpath|alias]]，区块随 linkpath 一同写入', () => {
		expect(formatWikilink('note', '别名')).toBe('[[note|别名]]');
		expect(formatWikilink('folder/note#标题', '别名')).toBe(
			'[[folder/note#标题|别名]]',
		);
	});

	it('format ∘ parse 不动点（区块 + 别名逐段还原）', () => {
		const link = formatWikilink('folder/note#标题', '别名');
		const parts = parseWikilink(link);
		expect(parts).toEqual({
			target: 'folder/note',
			block: '标题',
			alias: '别名',
			linkpath: 'folder/note#标题',
			inner: 'folder/note#标题|别名',
		});
	});

	it('别名含 `|` / `#` 时往返不丢（重新解析仍取同一 alias）', () => {
		expect(formatWikilink('note', 'a|b')).toBe('[[note|a|b]]');
		expect(parseWikilink('[[note|a|b]]')?.alias).toBe('a|b');
		expect(formatWikilink('note', '#标签')).toBe('[[note|#标签]]');
		expect(parseWikilink('[[note|#标签]]')).toEqual({
			target: 'note',
			block: '',
			alias: '#标签',
			linkpath: 'note',
			inner: 'note|#标签',
		});
	});

	it('重命名契约：仅替换 target，`#区块`/`|别名` 尾巴原样拼接（links-tree 场景）', () => {
		const old = parseWikilink('[[folder/old#区块|别名]]');
		const tail = `${old?.block ? `#${old.block}` : ''}${old?.alias ? `|${old.alias}` : ''}`;
		expect(tail).toBe('#区块|别名');
		expect(formatWikilink(`folder/new${tail}`)).toBe('[[folder/new#区块|别名]]');
		// 无区块无别名时尾巴为空，只留新 target
		const bare = parseWikilink('[[old]]');
		const bareTail = `${bare?.block ? `#${bare.block}` : ''}${bare?.alias ? `|${bare.alias}` : ''}`;
		expect(bareTail).toBe('');
		expect(formatWikilink(`new${bareTail}`)).toBe('[[new]]');
	});
});

describe('wikilinkTargetIsAttachment', () => {
	it.each([
		{ input: '报告.pdf', expected: true, why: 'PDF 附件（回形针图标通道）' },
		{ input: 'attachments/音频.mp3', expected: true, why: '带路径的非 md 扩展名' },
		{ input: '图.PNG', expected: true, why: '大小写不敏感：扩展名统一小写后比较' },
		{ input: 'archive.tar.gz', expected: true, why: '只看末段最后一个点之后的扩展名' },
		{ input: 'report.PDF#page=2', expected: true, why: '区块不影响判定（取 # 之前的 target）' },
		{ input: '报告.pdf|800', expected: true, why: '防御式：偶发传入含别名的 linkpath 仍按 target 判定' },
		{ input: 'note.md', expected: false, why: '.md 是文档' },
		{ input: 'folder/sub/note.md', expected: false, why: '路径中 .md 仍是文档' },
		{ input: 'note.MD', expected: false, why: '大小写不敏感：.MD 亦为文档' },
		{ input: 'note.md#标题', expected: false, why: '区块剥离后仍是 .md' },
		{ input: 'note', expected: false, why: '无扩展名 → 按 Obsidian 默认视为文档' },
		{ input: 'folder/note', expected: false, why: '无扩展名路径' },
		{ input: '.gitignore', expected: false, why: '首字符即点（dot<=0）→ 文档，不是扩展名 .gitignore' },
		{ input: 'folder/.gitignore', expected: false, why: '末段点开头同样视为文档' },
		{ input: 'folder/', expected: false, why: '末段为空串' },
		{ input: '', expected: false, why: '空 linkpath（[[]] 非维基链接，回退原串）' },
	])('wikilinkTargetIsAttachment($input) === $expected（$why）', ({ input, expected }) => {
		expect(wikilinkTargetIsAttachment(input)).toBe(expected);
	});

	it('含 `]` 的畸形 linkpath 走回退分支：仍按原串末段扩展名判定', () => {
		// 为什么这样断言：`[[a]b.png]]` 不匹配整串正则 → parseWikilink 返回 null →
		// 实现回退用原串当 target，故 `.png` 仍被判为附件（容错而非抛错）。
		expect(parseWikilink('[[a]b.png]]')).toBeNull();
		expect(wikilinkTargetIsAttachment('a]b.png')).toBe(true);
	});
});

describe('linkDisplayText', () => {
	it('别名优先（含别名是路径/带 # 的情形）', () => {
		expect(linkDisplayText('[[note|别名]]')).toBe('别名');
		expect(linkDisplayText('[[note#h|别名]]')).toBe('别名');
		expect(linkDisplayText('[[folder/a.md|folder/b.md]]')).toBe('folder/b.md');
		expect(linkDisplayText('[[|别名]]')).toBe('别名');
	});

	it('无别名取 linkpath 末段并去掉结尾 .md（笔记显示名）', () => {
		expect(linkDisplayText('[[folder/sub/note.md]]')).toBe('note');
		expect(linkDisplayText('[[folder/sub/note]]')).toBe('note');
		expect(linkDisplayText('[[note.md.md]]')).toBe('note.md');
	});

	it('非 .md 扩展名保留（附件显示名）', () => {
		expect(linkDisplayText('[[folder/file.pdf]]')).toBe('file.pdf');
		expect(linkDisplayText('[[folder/archive.tar.gz]]')).toBe('archive.tar.gz');
	});

	it('.md 去扩展大小写敏感（仅小写 .md 被剥）', () => {
		// 为什么这样断言：显示名用 /\.md$/ 直接替换，文档名大小写原样呈现，
		// 断言此点可防止未来悄悄引入不区分大小写的剥离而改变显示名。
		expect(linkDisplayText('[[Note.MD]]')).toBe('Note.MD');
		expect(linkDisplayText('[[note.Md]]')).toBe('note.Md');
	});

	it('区块引用无别名时 `#区块` 一并进入显示名（不做区块剥离）', () => {
		expect(linkDisplayText('[[note#标题]]')).toBe('note#标题');
		expect(linkDisplayText('[[#纯区块]]')).toBe('#纯区块');
	});

	it('反斜杠路径不分段（只有 `/` 参与末段切分）', () => {
		expect(linkDisplayText('[[folder\\sub\\note.md]]')).toBe('folder\\sub\\note');
	});

	it('末段为空的畸形形态返回空串', () => {
		expect(linkDisplayText('[[folder/]]')).toBe('');
		expect(linkDisplayText('[[|]]')).toBe('');
	});

	it('非维基链接原样可见（URL / 库内路径 / 空串）', () => {
		expect(linkDisplayText('https://example.com')).toBe('https://example.com');
		expect(linkDisplayText('folder/note.md')).toBe('folder/note.md');
		expect(linkDisplayText('')).toBe('');
	});
});

describe('walkTree', () => {
	it('先序遍历：父先于子、子按 children 原顺序（等价递归 forEach）', () => {
		const tree: TNode = {
			id: 'root',
			children: [
				{ id: 'a', children: [{ id: 'a1' }, { id: 'a2' }] },
				{ id: 'b', children: [{ id: 'b1', children: [{ id: 'b1x' }] }] },
				{ id: 'c' },
			],
		};
		const order: string[] = [];
		walkTree(tree, (n) => {
			order.push(n.id);
		});
		expect(order).toEqual([
			'root',
			'a',
			'a1',
			'a2',
			'b',
			'b1',
			'b1x',
			'c',
		]);
	});

	it('每个节点只被访问一次，且 visit 收到的是原节点对象引用', () => {
		const a1: TNode = { id: 'a1' };
		const tree: TNode = { id: 'root', children: [{ id: 'a', children: [a1] }] };
		const seen: TNode[] = [];
		walkTree(tree, (n) => {
			seen.push(n);
		});
		expect(seen).toHaveLength(3);
		expect(seen[2]).toBe(a1);
		expect(new Set(seen).size).toBe(3);
	});

	it('visit 返回 false 立即终止整棵树（命中即停，后续兄弟/子树不再访问）', () => {
		const tree: TNode = {
			id: 'root',
			children: [
				{ id: 'hit', children: [{ id: 'hit-child' }] },
				{ id: 'after' },
			],
		};
		const order: string[] = [];
		walkTree(tree, (n) => {
			order.push(n.id);
			if (n.id === 'hit') {
				return false;
			}
			return undefined;
		});
		expect(order).toEqual(['root', 'hit']);
	});

	it('根节点即返回 false 时只访问一次', () => {
		const tree: TNode = { id: 'root', children: [{ id: 'a' }] };
		let calls = 0;
		walkTree(tree, () => {
			calls++;
			return false;
		});
		expect(calls).toBe(1);
	});

	it('返回非 false 的真值不构成终止——实现按 `=== false` 严格判定', () => {
		// 为什么这样断言：实现用 `visit(current) === false` 判定终止，
		// 若未来改成 falsy 判定（!result），越出契约的 JS 调用方语义会突变。
		const tree: TNode = { id: 'root', children: [{ id: 'a' }, { id: 'b' }] };
		const order: string[] = [];
		// 越出 `void | false` 返回契约的调用方（未经类型检查的 JS 用法），
		// 经 double assertion 复现，确保断言仍指向运行时真实行为。
		const visitor = ((n: TNode) => {
			order.push(n.id);
			return true;
		}) as unknown as (node: TNode) => void | false;
		walkTree(tree, visitor);
		expect(order).toEqual(['root', 'a', 'b']);
	});

	it('children 缺失 / 为 undefined / 为 null / 为空数组均安全', () => {
		const visited: string[] = [];
		walkTree<TNode>({ id: 'missing' }, (n) => {
			visited.push(n.id);
		});
		walkTree<TNode>({ id: 'undefined', children: undefined }, (n) => {
			visited.push(n.id);
		});
		walkTree<TNode>({ id: 'null', children: null }, (n) => {
			visited.push(n.id);
		});
		walkTree<TNode>({ id: 'empty', children: [] }, (n) => {
			visited.push(n.id);
		});
		expect(visited).toEqual(['missing', 'undefined', 'null', 'empty']);
	});

	it('同一子节点被两个父引用时会被访问两次（无去重、无环检测）', () => {
		// 为什么这样断言：walkTree 是纯遍历，不做 visited 集合；共享子节点
		// 的调用方若需去重必须自备集合。锁死此点避免误加去重改变调用方语义。
		const shared: TNode = { id: 'shared' };
		const tree: TNode = {
			id: 'root',
			children: [{ id: 'p1', children: [shared] }, { id: 'p2', children: [shared] }],
		};
		const order: string[] = [];
		walkTree(tree, (n) => {
			order.push(n.id);
		});
		expect(order).toEqual(['root', 'p1', 'shared', 'p2', 'shared']);
	});

	it('5 万级深链不栈溢出（显式栈回归；递归实现会 RangeError）', () => {
		const depth = 50_000;
		let chain: TNode = { id: 'n0' };
		let cursor = chain;
		for (let i = 1; i < depth; i++) {
			const next: TNode = { id: `n${i}` };
			cursor.children = [next];
			cursor = next;
		}
		let count = 0;
		let lastId = '';
		expect(() =>
			walkTree(chain, (n) => {
				count++;
				lastId = n.id;
			}),
		).not.toThrow();
		expect(count).toBe(depth);
		expect(lastId).toBe(`n${depth - 1}`);
	});

	it('深链中提前短路时只访问到命中层（不构建完整遍历）', () => {
		const depth = 1000;
		let chain: TNode = { id: 'n0' };
		let cursor = chain;
		for (let i = 1; i < depth; i++) {
			const next: TNode = { id: `n${i}` };
			cursor.children = [next];
			cursor = next;
		}
		let count = 0;
		walkTree(chain, (n) => {
			count++;
			if (n.id === 'n9') {
				return false;
			}
			return undefined;
		});
		expect(count).toBe(10);
	});
});
