/**
 * 层级语法归一（`markdown/md-heading-syntax`）直测。
 *
 * 关注点：
 * - **可转判据**：单行 / 非任务 / 非有序 / 非段落；**独立指令行不算多行内容**
 *   （带 `%%id%%` / `%%rel%%` / `%%sum%%` 的节点照转且指令原样保留）；
 * - **合法混排不动**：列表在标题之前（手写文件）与列表在标题之后（拖拽落点）
 *   分别对应「不处理」与「升标题」——2026-11-08 实机 P0 的回归位；
 * - **双向归一**（K169）：标题落在列表父下整支降为列表，落在段落父下仍报
 *   blocked 由调用方撤回；
 * - **组原子**（整篇重排）：某层有转不了的节点 ⇒ 整层保持列表并点名阻挡者；
 * - **6 级封顶**：第 7 层起整支回落列表；
 * - **往返保形**：归一后序列化再解析，树形（文本 + 嵌套）不变（性质测试）。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MindMapTreeNode } from '../src/core/engine-types';
import {
	currentDocumentSyntax,
	planDocumentSyntax,
} from '../src/markdown/md-heading-format';
import {
	adaptSubtreesToGroup,
	normalizeSiblingSyntax,
} from '../src/markdown/md-heading-normalize';
import {
	convertBranchToHeadings,
	convertBranchToList,
	headingBlockReason,
	liveNodeTree,
	readHeadingStart,
	seedHeadingStart,
} from '../src/markdown/md-heading-syntax';
import { parseMdOutline } from '../src/markdown/md-outline';
import { serializeMdBody } from '../src/markdown/md-serialize';

type MNode = MindMapTreeNode;

/** 造节点：`data` 直给（text 恒有，其余按需） */
function node(
	text: string,
	extra: Record<string, unknown> = {},
	children: MNode[] = [],
): MNode {
	return { data: { text, ...extra }, children };
}

/** 造虚拟根（无 mdType） */
function root(children: MNode[], extra: Record<string, unknown> = {}): MNode {
	return { data: { text: '根', ...extra }, children };
}

/** 列表项 / 标题项的简写 */
function listItem(text: string, children: MNode[] = []): MNode {
	return node(text, { mdType: 'list', mdMarker: '-' }, children);
}

function heading(text: string, level: number, children: MNode[] = []): MNode {
	return node(text, { mdType: 'heading', mdLevel: level }, children);
}

describe('readHeadingStart（起始级别读取）', () => {
	it('缺失 / 脏值 / 越界一律回落到 1', () => {
		expect(readHeadingStart({})).toBe(1);
		expect(readHeadingStart(null)).toBe(1);
		expect(readHeadingStart({ mdHeadingStart: 'abc' })).toBe(1);
		expect(readHeadingStart({ mdHeadingStart: 0 })).toBe(1);
		expect(readHeadingStart({ mdHeadingStart: 99 })).toBe(6);
		expect(readHeadingStart({ mdHeadingStart: 2 })).toBe(2);
	});
});

describe('seedHeadingStart（空文档跟随设置）', () => {
	it('正文没有节点：按设置写入起始级别（二级）', () => {
		const tree = root([]);
		seedHeadingStart(tree, 2);
		expect(tree.data.mdHeadingStart).toBe(2);
	});

	it('列表档（null）/ 已有内容 / 已记过级别：一律不动', () => {
		const listMode = root([]);
		seedHeadingStart(listMode, null);
		expect(listMode.data.mdHeadingStart).toBeUndefined();

		const withContent = root([listItem('甲')]);
		seedHeadingStart(withContent, 2);
		expect(withContent.data.mdHeadingStart).toBeUndefined();

		const recorded = root([], { mdHeadingStart: 1 });
		seedHeadingStart(recorded, 2);
		expect(recorded.data.mdHeadingStart).toBe(1);
	});
});

describe('headingBlockReason（单节点可转判据）', () => {
	it('单行列表项可转', () => {
		expect(headingBlockReason(listItem('甲').data as never)).toBeNull();
	});

	it('段落 / 任务项 / 有序列表不可转', () => {
		expect(
			headingBlockReason(node('甲', { mdType: 'plain' }).data as never),
		).toBe('plain');
		expect(
			headingBlockReason(node('甲', { mdType: 'list', mdTask: 'todo' }).data as never),
		).toBe('task');
		expect(
			headingBlockReason(
				node('甲', { mdType: 'list', mdMarker: 'ordered' }).data as never,
			),
		).toBe('ordered');
	});

	it('多行内容（项内围栏 / 续行）不可转', () => {
		expect(
			headingBlockReason(
				node('甲', { mdType: 'list', mdRaw: '甲\n```js\nx\n```' }).data as never,
			),
		).toBe('multiline');
	});

	it('**独立指令行不算多行**：带 id/rel/sum 的节点照转（指令随行保留）', () => {
		const withId = node('甲', {
			mdType: 'list',
			mdRaw: '甲\n%%id:aaaa11%%',
		});
		expect(headingBlockReason(withId.data as never)).toBeNull();
		const withRel = node('乙', {
			mdType: 'list',
			mdRaw: '乙\n%%rel:aaaa11 | geo=right,1,right,0,73,-2,74,0%%',
		});
		expect(headingBlockReason(withRel.data as never)).toBeNull();
	});

	it('行内颜色注释不影响判定', () => {
		expect(
			headingBlockReason(
				node('甲', { mdType: 'list', mdRaw: '甲 %%#2e9e8f%%' }).data as never,
			),
		).toBeNull();
	});
});

describe('convertBranchToHeadings / convertBranchToList', () => {
	it('整支升：层级逐级 +1、保留原标记（供转回列表恢复）、内容字段一字不改', () => {
		const branch = listItem('甲', [listItem('甲一', [listItem('甲二')])]);
		branch.data.mdRaw = '甲';
		const converted = convertBranchToHeadings(branch, 2);
		expect(converted).toBe(3);
		expect(branch.data.mdType).toBe('heading');
		expect(branch.data.mdLevel).toBe(2);
		// 标题行不写它；保留是为了「列表 → 标题 → 列表」不把 '*' / '+' 归一成 '-'
		expect(branch.data.mdMarker).toBe('-');
		expect(branch.children[0]!.data.mdLevel).toBe(3);
		expect(branch.children[0]!.children[0]!.data.mdLevel).toBe(4);
		// 内容保真：mdRaw / text 不动（保存时仍走「未编辑逐字回写」）
		expect(branch.data.mdRaw).toBe('甲');
		expect(branch.data.text).toBe('甲');
	});

	it('`*` / `+` 转标题再转列表：原标记恢复（不退化成 `-`）', () => {
		const branch = node('星号', { mdType: 'list', mdMarker: '*' });
		convertBranchToHeadings(branch, 1);
		expect(branch.data.mdMarker).toBe('*');
		convertBranchToList(branch);
		expect(branch.data.mdType).toBe('list');
		expect(branch.data.mdMarker).toBe('*');
	});

	it('指令行原样保留（只改类型与级别）', () => {
		const branch = listItem('甲');
		branch.data.mdRaw = '甲\n%%id:aaaa11%%';
		branch.data.mdDirectiveTail = '%%id:aaaa11%%';
		convertBranchToHeadings(branch, 1);
		expect(branch.data.mdRaw).toBe('甲\n%%id:aaaa11%%');
		expect(branch.data.mdDirectiveTail).toBe('%%id:aaaa11%%');
	});

	it('6 级封顶：第 7 层起整支回落列表', () => {
		let deepest = listItem('L7');
		deepest = listItem('L6', [deepest]);
		const branch = listItem('L5', [deepest]);
		// 从第 5 级开始升：L5→5、L6→6、L7→不可写 ⇒ 列表
		convertBranchToHeadings(branch, 5);
		expect(branch.data.mdLevel).toBe(5);
		expect(branch.children[0]!.data.mdLevel).toBe(6);
		const seventh = branch.children[0]!.children[0]!;
		expect(seventh.data.mdType).toBe('list');
		expect(seventh.data.mdMarker).toBe('-');
	});

	it('降级：整支变列表、保留层级与内容（用于「层级语法 → 无序列表」）', () => {
		const branch = heading('甲', 1, [heading('甲一', 2)]);
		const converted = convertBranchToList(branch);
		expect(converted).toBe(2);
		expect(branch.data.mdType).toBe('list');
		expect(branch.data.mdMarker).toBe('-');
		expect(branch.data.mdLevel).toBeUndefined();
		expect(branch.children[0]!.data.mdType).toBe('list');
	});

	it('降级：段落（plain）也转列表项——列表父链下段落没有层级表达', () => {
		const branch = node('段落', { mdType: 'plain', mdRaw: '段落\n第二行' }, [
			node('子', { mdType: 'plain' }),
		]);
		expect(convertBranchToList(branch)).toBe(2);
		expect(branch.data.mdType).toBe('list');
		expect(branch.data.mdMarker).toBe('-');
		// 内容（含多行原文）不动
		expect(branch.data.mdRaw).toBe('段落\n第二行');
		expect(branch.children[0]!.data.mdType).toBe('list');
	});
});

describe('planDocumentSyntax（整篇重排）', () => {
	it('纯列表 → 标题（一级起）：顶层 `#`、子级 `##`，并写 mdHeadingStart', () => {
		const tree = root([
			listItem('甲', [listItem('甲一', [listItem('甲二')])]),
			listItem('乙'),
		]);
		const plan = planDocumentSyntax(tree, 1);
		expect(plan.converted).toBe(4);
		expect(plan.blocked).toEqual([]);
		expect(tree.data.mdHeadingStart).toBe(1);
		expect(tree.children[0]!.data.mdLevel).toBe(1);
		expect(tree.children[0]!.children[0]!.data.mdLevel).toBe(2);
		expect(serializeMdBody(tree, null)).toBe(
			['# 甲', '', '## 甲一', '', '### 甲二', '', '# 乙'].join('\n'),
		);
	});

	it('起点二级：顶层写 `##`、其子 `###`', () => {
		const tree = root([listItem('甲', [listItem('甲一')])]);
		planDocumentSyntax(tree, 2);
		expect(serializeMdBody(tree, null)).toBe(['## 甲', '', '### 甲一'].join('\n'));
	});

	it('已有标题 + 目标一级：按深度重定级（`##` 起的手写文件也能归一）', () => {
		const tree = root([
			heading('甲', 2, [heading('甲一', 3), listItem('甲二')]),
		]);
		const plan = planDocumentSyntax(tree, 1);
		expect(plan.converted).toBeGreaterThan(0);
		expect(tree.children[0]!.data.mdLevel).toBe(1);
		expect(tree.children[0]!.children[0]!.data.mdLevel).toBe(2);
		expect(tree.children[0]!.children[1]!.data.mdType).toBe('heading');
		expect(serializeMdBody(tree, null)).toBe(
			['# 甲', '', '## 甲一', '', '## 甲二'].join('\n'),
		);
	});

	it('重定级不会把带围栏的列表子节点硬转成标题（内容安全）', () => {
		// 旧实现用「整支转标题」做重定级：甲下的 乙（多行）会被写成标题，
		// 围栏在重解析时裂成多个节点。重定级只动已是标题的节点。
		const tree = root([
			heading('甲', 2, [
				node('乙', { mdType: 'list', mdMarker: '-', mdRaw: '乙\n```js\nx\n```' }),
			]),
		]);
		const plan = planDocumentSyntax(tree, 1);
		expect(plan.converted).toBe(1);
		expect(tree.children[0]!.data.mdLevel).toBe(1);
		expect(tree.children[0]!.children[0]!.data.mdType).toBe('list');
		expect(plan.blocked.map((b) => b.reason)).toEqual(['multiline']);
		expect(serializeMdBody(tree, null)).toBe(
			['# 甲', '- 乙', '  ```js', '  x', '  ```'].join('\n'),
		);
	});

	it('组原子：某层有一个多行节点 ⇒ 整层保持列表，并点名阻挡者', () => {
		const tree = root([
			listItem('甲'),
			node('代码', { mdType: 'list', mdRaw: '代码\n```js\nx\n```' }),
			listItem('乙'),
		]);
		const plan = planDocumentSyntax(tree, 1);
		expect(plan.converted).toBe(0);
		expect(plan.blocked).toHaveLength(1);
		expect(plan.blocked[0]!.text).toBe('代码');
		expect(plan.blocked[0]!.reason).toBe('multiline');
		expect(plan.keptList).toBe(3);
		// 原样（仍是列表；续行按列表项缩进单位补两格）
		expect(serializeMdBody(tree, null)).toBe(
			['- 甲', '- 代码', '  ```js', '  x', '  ```', '- 乙'].join('\n'),
		);
	});

	it('幂等：已是目标形态时 converted = 0', () => {
		const tree = root([listItem('甲')]);
		planDocumentSyntax(tree, 1);
		const again = planDocumentSyntax(tree, 1);
		expect(again.converted).toBe(0);
		expect(again.blocked).toEqual([]);
	});

	it('目标 = 列表：全部标题降级，并清掉 mdHeadingStart', () => {
		const tree = root([heading('甲', 1, [heading('甲一', 2)])]);
		tree.data.mdHeadingStart = 1;
		const plan = planDocumentSyntax(tree, 'list');
		expect(plan.converted).toBe(2);
		expect(tree.data.mdHeadingStart).toBeUndefined();
		expect(serializeMdBody(tree, null)).toBe(['- 甲', '  - 甲一'].join('\n'));
	});

	it('目标 = 列表：段落（plain）也转列表项，保住层级与后续兄弟', () => {
		// 2026-11-08 实机：段落保持 plain 时序列化无前缀，重开掉到根级；
		// 紧跟其后的兄弟也被提升。转成 `- ` 列表项后树形可往返。
		const tree = root([
			heading('甲', 1, [
				heading('甲一', 2, [
					node('段落\n第二行', {
						mdType: 'plain',
						mdRaw: '段落\n第二行',
						mdDerivedText: '段落\n第二行',
					}),
					listItem('乙'),
				]),
			]),
		]);
		const plan = planDocumentSyntax(tree, 'list');
		expect(plan.converted).toBe(3);
		const body = serializeMdBody(tree, null);
		expect(body).toContain('- 段落');
		const reparsed = parseMdOutline(`${body}\n`, '根').tree;
		const shape = (n: MNode): unknown => ({
			text: n.data.text,
			children: (n.children ?? []).map(shape),
		});
		expect(shape(reparsed)).toEqual(shape(tree));
	});
});

describe('normalizeSiblingSyntax（编辑期守卫）', () => {
	it('列表排在标题之后 → 升为该组级别（拖拽落点最常见的形态）', () => {
		const tree = root([heading('甲', 2), listItem('乙')]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.converted).toBe(1);
		expect(result.firstUpgraded).toBe('乙');
		expect(result.blocked).toEqual([]);
		expect(tree.children[1]!.data.mdType).toBe('heading');
		expect(tree.children[1]!.data.mdLevel).toBe(2);
	});

	it('**列表在标题之前是合法排布**：一动都不动（打开手写文件不被改写）', () => {
		// 2026-11-08 实机 P0：`- 组` + `# 标题甲` 本来能逐字往返，
		// 旧判据（同组语法必须一致）在加载时把它改成了 `# 组` 并落盘。
		const tree = root([listItem('组', [listItem('子')]), heading('标题甲', 1)]);
		expect(normalizeSiblingSyntax(tree)).toEqual({
			converted: 0,
			firstUpgraded: '',
			firstReleveled: '',
			firstDowngraded: '',
			firstDemoted: '',
			demotedHeadings: 0,
			blocked: [],
		});
		expect(tree.children[0]!.data.mdType).toBe('list');
	});

	it('多列表 + 一个标题（标题在后）→ 静默（旧判据会报 downgrade 并刷屏）', () => {
		const tree = root([listItem('甲'), listItem('乙'), heading('丙', 1)]);
		expect(normalizeSiblingSyntax(tree).blocked).toEqual([]);
	});

	it('列表夹在两个标题之间 → 升级（它排在标题之后）', () => {
		const tree = root([heading('甲', 1), listItem('乙'), heading('丙', 1)]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.converted).toBe(1);
		expect(tree.children[1]!.data.mdType).toBe('heading');
	});

	it('**空的**新建节点排在标题之后：不动、不提示', () => {
		// 序列化按上下文写标题（K98），守卫再补 mdType 等于把现算结果固化，
		// 并且每次在标题上按 Enter 新建同级节点都会弹一条「已改为标题」
		const tree = root([heading('甲', 1), node('新')]);
		const result = normalizeSiblingSyntax(tree);
		expect(result).toEqual({
			converted: 0,
			firstUpgraded: '',
			firstReleveled: '',
			firstDowngraded: '',
			firstDemoted: '',
			demotedHeadings: 0,
			blocked: [],
		});
		expect(tree.children[1]!.data.mdType).toBeUndefined();
		// 写盘仍按标题回写：位置（在标题之后）决定语法，结构不变
		expect(serializeMdBody(tree, null)).toBe(['# 甲', '', '# 新'].join('\n'));
	});

	it('新建节点**带子节点**时不跳过：子标题相对它重定级（否则逃到外层）', () => {
		// 拖一个标题分支到刚新建的空节点上：新节点会被写成一级标题，
		// 它的标题子节点必须变成二级，否则重开后被解析成根级兄弟
		const tree = root([heading('甲', 1), node('新', {}, [heading('子', 1)])]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.converted).toBe(2);
		expect(tree.children[1]!.data.mdLevel).toBe(1);
		expect(tree.children[1]!.children[0]!.data.mdLevel).toBe(2);
	});

	it('多行节点排在标题之后 → blocked upgrade，且不转换', () => {
		const tree = root([
			heading('甲', 1),
			node('代码', { mdType: 'list', mdRaw: '代码\n```js\n```' }),
		]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.converted).toBe(0);
		expect(result.blocked).toEqual([{ text: '代码', kind: 'upgrade' }]);
	});

	it('升级目标的**子孙**含围栏 → 也 blocked（不整支硬转，否则内容撕裂）', () => {
		const tree = root([
			heading('甲', 1),
			listItem('乙', [
				node('代码', { mdType: 'list', mdRaw: '代码\n```js\n```' }),
			]),
		]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.converted).toBe(0);
		expect(result.blocked).toEqual([{ text: '代码', kind: 'upgrade' }]);
	});

	it('父是列表：拖入的标题**整支降为列表**（2026-11-08 用户裁决）', () => {
		const tree = root([
			listItem('甲', [heading('乙', 2, [heading('乙一', 3)]), listItem('丙')]),
		]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.blocked).toEqual([]);
		expect(result.converted).toBe(2);
		expect(result.firstDowngraded).toBe('乙');
		expect(result.demotedHeadings).toBe(2);
		const kids = tree.children[0]?.children ?? [];
		expect(kids.map((c) => String(c.data.mdType))).toEqual(['list', 'list']);
		expect(kids[0]!.data.mdMarker).toBe('-');
		expect(kids[0]!.data.mdLevel).toBeUndefined();
		expect(String(kids[0]?.children?.[0]?.data.mdType)).toBe('list');
		// 后面的列表兄弟不能被规则 1（排在标题之后）误升成标题
		expect(kids[1]!.data.mdType).toBe('list');
	});

	it('父是段落：降级也保不住父子关系 → 仍撤回（生产不可达，仅兜底）', () => {
		// 解析器不会产出「段落父 + 标题子」，这里只锁防御分支的行为（K171）
		const tree = root([
			node('段落', { mdType: 'plain' }, [heading('乙', 2)]),
		]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.blocked).toEqual([{ text: '乙', kind: 'downgrade' }]);
		expect(result.converted).toBe(0);
	});

	it('同级标题级别递增 → 重定级到前一个标题的级别', () => {
		const tree = root([heading('甲', 2), heading('乙', 4)]);
		const result = normalizeSiblingSyntax(tree);
		expect(tree.children[1]!.data.mdLevel).toBe(2);
		// 纯重定级要能点名（提示文案据此选 key，否则会拿空名字拼「改为标题」）
		expect(result.firstUpgraded).toBe('');
		expect(result.firstReleveled).toBe('乙');
	});

	it('父级已是 6 级：标题子节点**就地降为列表**（第 7 级没有标题，不能撤回）', () => {
		// 2026-11-08 实机：这里原本报 downgrade 并撤回，用户拖到最深层直接被拒，
		// 还弹「该层是无序列表…」。第 7 级列表本来就是合法形态。
		const tree = root([
			heading('L6', 6, [
				listItem('已有'),
				heading('M6', 2, [heading('M6a', 3)]),
			]),
		]);
		const result = normalizeSiblingSyntax(tree);
		expect(result.blocked).toEqual([]);
		expect(result.firstDemoted).toBe('M6');
		expect(result.converted).toBe(2);
		expect(result.demotedHeadings).toBe(2);
		const kids = tree.children[0]?.children ?? [];
		expect(kids.map((c) => String(c.data.mdType))).toEqual(['list', 'list']);
		// 整支降级：孙节点也不再是标题
		expect(String(kids[1]?.children?.[0]?.data.mdType)).toBe('list');
	});

	it('子标题级别不深于父级 → 重定级到「父级 + 1」（否则解析时会逃到外层）', () => {
		const tree = root([heading('父', 3, [heading('子', 2)])]);
		expect(normalizeSiblingSyntax(tree).converted).toBe(1);
		expect(tree.children[0]!.children[0]!.data.mdLevel).toBe(4);
	});

	it('重定级不把列表子节点也转成标题', () => {
		const tree = root([heading('甲', 1, [listItem('乙')]), heading('丙', 1)]);
		normalizeSiblingSyntax(tree);
		expect(tree.children[0]!.data.mdLevel).toBe(1);
		expect(tree.children[0]!.children[0]!.data.mdType).toBe('list');
	});

	it('无问题排布时静默（幂等）', () => {
		const tree = root([listItem('甲', [listItem('甲一')])]);
		expect(normalizeSiblingSyntax(tree)).toEqual({
			converted: 0,
			firstUpgraded: '',
			firstReleveled: '',
			firstDowngraded: '',
			firstDemoted: '',
			demotedHeadings: 0,
			blocked: [],
		});
	});
});

describe('adaptSubtreesToGroup（粘贴插入前换算）', () => {
	it('落点组是标题语法 → 子树按该组级别转标题', () => {
		const parent = heading('父', 1, [heading('甲', 2), heading('乙', 2)]);
		const pasted = [listItem('新一', [listItem('新一一')])];
		const result = adaptSubtreesToGroup(parent, pasted);
		expect(result.blocked).toEqual([]);
		expect(result.converted).toBe(2);
		expect(pasted[0]!.data.mdLevel).toBe(2);
		expect(pasted[0]!.children[0]!.data.mdLevel).toBe(3);
	});

	it('落点组是列表语法 → 原样（列表子节点本就合法）', () => {
		const parent = heading('父', 1, [listItem('甲')]);
		const pasted = [listItem('新一')];
		const result = adaptSubtreesToGroup(parent, pasted);
		expect(result.converted).toBe(0);
		expect(pasted[0]!.data.mdType).toBe('list');
	});

	it('粘贴内容含转不了的节点 → 报 blocked（调用方放弃插入）', () => {
		const parent = root([heading('甲', 1)]);
		const pasted = [node('代码', { mdType: 'list', mdRaw: '代码\n```js\n```' })];
		const result = adaptSubtreesToGroup(parent, pasted);
		expect(result.blocked).toEqual(['代码']);
	});

	it('粘贴子树的**子孙**含围栏 → 同样 blocked（不整支硬转）', () => {
		const parent = root([heading('甲', 1)]);
		const pasted = [
			listItem('乙', [node('代码', { mdType: 'list', mdRaw: '代码\n```js\n```' })]),
		];
		const result = adaptSubtreesToGroup(parent, pasted);
		expect(result.blocked).toEqual(['代码']);
		expect(pasted[0]!.data.mdType).toBe('list');
	});
});

describe('currentDocumentSyntax（勾选态）', () => {
	it('无顶层标题 = 列表；一级 = 1；二级 = 2', () => {
		expect(currentDocumentSyntax(root([listItem('甲')]))).toBe('list');
		expect(currentDocumentSyntax(root([heading('甲', 1)]))).toBe(1);
		const two = root([heading('甲', 2)]);
		two.data.mdHeadingStart = 2;
		expect(currentDocumentSyntax(two)).toBe(2);
	});
});

describe('liveNodeTree（渲染节点 → 数据树包装）', () => {
	it('data 是活引用：就地改写即改引擎对象', () => {
		// 引擎 Node.getData() 恒返回同一个对象（活引用），此处按同语义打桩
		const data = { text: '甲', mdType: 'list', mdMarker: '-' };
		const live = { getData: () => data, children: [] };
		const wrapped = liveNodeTree(live);
		wrapped.data.mdType = 'heading';
		expect(data.mdType).toBe('heading');
		expect(wrapped.data).toBe(data);
	});
});

// ---------------------------------------------------------------------------
// 性质测试：归一后「序列化 → 解析」树形（文本 + 嵌套）不变
// ---------------------------------------------------------------------------

type PNode = { data: Record<string, unknown>; children: PNode[] };

const textArb = fc
	.array(fc.constantFrom('甲', '乙', '丙', 'a', 'b', '1'), {
		minLength: 1,
		maxLength: 3,
	})
	.map((parts) => parts.join(''));

/** 随机树：`mdType` 也随机（故意造混排），归一负责收拾 */
function treeArb(depth = 0): fc.Arbitrary<PNode> {
	const children =
		depth >= 3
			? fc.constant<PNode[]>([])
			: fc.array(treeArb(depth + 1), { maxLength: 2 });
	return fc
		.record({
			text: textArb,
			kind: fc.constantFrom('list', 'heading'),
			level: fc.integer({ min: 1, max: 6 }),
			children,
		})
		.map(({ text, kind, level, children: kids }) => ({
			data:
				kind === 'heading'
					? { text, mdType: 'heading', mdLevel: level }
					: { text, mdType: 'list', mdMarker: '-' },
			children: kids,
		}));
}

/** 树形（文本 + 嵌套；虚拟根文本不写盘，故从子级开始比） */
function shape(children: readonly MindMapTreeNode[]): unknown {
	return children.map((child) => ({
		text: child.data?.text ?? '',
		children: shape(child.children ?? []),
	}));
}

describe('性质：归一后的树往返保形', () => {
	it('随机树 → 归一 → 序列化 → 解析，树形不变（无可撤回项时）', () => {
		fc.assert(
			fc.property(fc.array(treeArb(), { maxLength: 3 }), (kids) => {
				const tree: MNode = root(kids);
				const result = normalizeSiblingSyntax(tree);
				// 有 blocked ⇒ 生产里靠「撤回这次编辑」兜底，不在本性质的覆盖范围。
				// 列表父下挂标题现在会就地降级（不再 blocked），故这类随机树
				// 也进入下面的「序列化 → 解析」保形验证。
				fc.pre(result.blocked.length === 0);
				const body = serializeMdBody(tree, null);
				const reparsed = parseMdOutline(`${body}\n`, '根').tree;
				expect(shape(reparsed.children)).toEqual(shape(tree.children));
			}),
			{ numRuns: 300 },
		);
	});
});

describe('独立行配色指令与层级语法互转（2026-11-11 修复回归）', () => {
	it('headingBlockReason 不把独立配色行算作多行内容', () => {
		const data = {
			text: '甲',
			mdRaw: '甲\n%%#89CFF0%%',
			mdType: 'list',
			mdMarker: '-',
		} as const;
		expect(headingBlockReason(data)).toBeNull();
	});

	it('带独立行 %%#hex%% 的标题可转列表并转回标题', () => {
		const md = ['# 甲', '%%#89CFF0%%', '', '- 乙'].join('\n');
		const first = parseMdOutline(md, '根');
		const plan = planDocumentSyntax(first.tree, 'list');
		expect(plan.blocked).toEqual([]);
		const listed = serializeMdBody(first.tree, null);
		expect(listed).toContain('- 甲');
		expect(listed).toContain('%%#89CFF0%%');

		const again = parseMdOutline(listed, '根');
		const back = planDocumentSyntax(again.tree, 1);
		expect(back.blocked, '上色后的标题必须还能转回标题').toEqual([]);
		const out = serializeMdBody(again.tree, null);
		expect(out.startsWith('# 甲')).toBe(true);
		expect(out).toContain('%%#89CFF0%%');
	});
});
