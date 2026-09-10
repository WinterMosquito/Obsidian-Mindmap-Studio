/**
 * Markdown ⇄ 思维导图 往返回归（.mindmap.md 渲染层核心套件）。
 *
 * 断言策略（为什么这样写）：
 * - 「不动点」用例一律比对**完整字符串**（parse → serialize → parse → serialize
 *   两趟逐字相等）：只有全串相等才能证明「未编辑的原文逐字回写」，
 *   toContain 会放过前缀/缩进/空行漂移这类真正的数据损坏；
 * - 「规范化」用例给出**精确期望串**（空行被吞、缩进统一 2 空格、有序列表重排、
 *   tab 缩进归一），把「允许的规范化」与「数据丢失」区分开；
 * - 会破坏不动点的输入单独断言其降级路径（rawOk 失败 → 走合成/剥离），
 *   并记录当前实现的确切输出——回归被改动时测试会直接失败而不是静默接受。
 *
 * 覆盖：解析结构 / 层级深度（含 5 万级显式栈）/ 往返不动点 / 编辑合成 /
 * 纯双链节点「编辑=改别名」/ rawOk 分支矩阵 / 图片独占节点 / 嵌入尺寸参数 /
 * URL icon-only 与附件双链 / 图文 token 不丢 / uid 修复 / 视图状态 /
 * .mindmap.md 标记与新建正文。
 * 源码依据：src/md-outline.ts、src/md-serialize.ts、src/markdown.ts、
 * src/view-state.ts、src/domain/{md-meta,wikilink}.ts、src/constants.ts。
 */
import { describe, expect, it, vi } from 'vitest';
import { parseMdOutline } from '../src/md-outline';
import { serializeMdBody } from '../src/md-serialize';
import {
	buildDefaultMindMapName,
	createDefaultMarkdownContent,
	ensureUniqueUids,
} from '../src/markdown';
import { ViewStateStore } from '../src/view-state';
import {
	hasMindMapMarker,
	stripMindMapStem,
	withMindMapMarker,
} from '../src/constants';

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 节点 data 的测试视图：收窄为 Record<string, unknown>，避免 any 渗进断言 */
type MdData = Record<string, unknown>;

interface MNode {
	data: MdData;
	children: MNode[];
}

/** 先序收集（显式栈——深树用例不能走递归，否则测试自身先栈溢出） */
function collect(root: MNode): { node: MNode; depth: number }[] {
	const out: { node: MNode; depth: number }[] = [];
	const stack: { node: MNode; depth: number }[] = [{ node: root, depth: 0 }];
	while (stack.length > 0) {
		const current = stack.pop()!;
		out.push(current);
		const children = current.node.children;
		for (let i = children.length - 1; i >= 0; i--) {
			stack.push({ node: children[i]!, depth: current.depth + 1 });
		}
	}
	return out;
}

/** 全树文本（先序，含虚拟根） */
function textsOf(root: MNode): string[] {
	return collect(root).map(({ node }) =>
		typeof node.data.text === 'string' ? node.data.text : '',
	);
}

/** 树中是否存在满足条件的节点 */
function hasNode(root: MNode, pred: (data: MdData) => boolean): boolean {
	return collect(root).some(({ node }) => pred(node.data));
}

/** 首个真实节点（跳过虚拟文档根）：一行输入的编辑合成用例用 */
function firstChild(md: string): { tree: MNode; data: MdData } {
	const tree: MNode = parseMdOutline(md, '根').tree;
	const node = tree.children[0]!;
	return { tree, data: node.data };
}

/** 解析 → 序列化 → 再解析 → 再序列化：不动点比较两趟输出 */
function roundTrip(md: string): { out1: string; out2: string } {
	const out1 = serializeMdBody(parseMdOutline(md, '根').tree, null);
	const out2 = serializeMdBody(parseMdOutline(out1, '根').tree, null);
	return { out1, out2 };
}

// ---------------------------------------------------------------------------
// 一、解析结构
// ---------------------------------------------------------------------------
describe('解析结构', () => {
	it('标题/列表/段落/围栏映射（综合文档的树形状）', () => {
		const md = [
			'# 一级',
			'## 二级',
			'### 三级',
			'- a',
			'  - a1',
			'正文段落。',
			'```',
			'# 代码里的标题',
			'- 代码里的列表',
			'```',
		].join('\n');
		const r = parseMdOutline(md, '根');
		expect(r.frontmatter, '无 frontmatter 时为 null').toBeNull();
		expect(r.tree.data.text, '虚拟根文本 = 传入的文件名').toBe('根');
		// 标题链：根 → 一级 → 二级 → 三级（跳级/嵌套都按祖先链建层）
		const h1 = r.tree.children[0]!;
		const h2 = h1.children[0]!;
		const h3 = h2.children[0]!;
		expect(h1.data.mdType).toBe('heading');
		expect(h1.data.mdLevel).toBe(1);
		expect(h2.data.mdLevel).toBe(2);
		expect(h3.data.mdLevel).toBe(3);
		// 三级标题下的列表项与嵌套子列表
		const li = h3.children[0]!;
		expect(li.data.mdType).toBe('list');
		expect(li.data.mdMarker, '无序标记 -').toBe('-');
		expect(li.data.text).toBe('a');
		expect(li.children[0]!.data.text, '缩进 2 空格的子列表项').toBe('a1');
		// 段落节点：mdType=plain；段落与围栏之间无空行分隔 → 合并为同一个 plain 节点
		const plains = collect(r.tree as MNode).filter(
			({ node }) => node.data.mdType === 'plain',
		);
		expect(plains).toHaveLength(1);
		expect(textsOf(r.tree as MNode)).toContain(
			['正文段落。', '```', '# 代码里的标题', '- 代码里的列表', '```'].join('\n'),
		);
		// 围栏：内容整体落入 plain 节点，其内部 # / - 行不得成为 heading/list 节点
		expect(
			hasNode(
				r.tree as MNode,
				(d) => d.mdType === 'heading' && d.text === '# 代码里的标题',
			),
			'围栏内 # 行不是 heading 节点',
		).toBe(false);
		expect(
			hasNode(
				r.tree as MNode,
				(d) => d.mdType === 'list' && d.text === '- 代码里的列表',
			),
			'围栏内 - 行不是 list 节点',
		).toBe(false);
		expect(plains[0]!.node.data.mdRaw, '围栏块在 plain 节点的 mdRaw 里逐行保留').toBe(
			[
				'正文段落。',
				'```',
				'# 代码里的标题',
				'- 代码里的列表',
				'```',
			].join('\n'),
		);
	});

	it('两个同级 # 都挂在虚拟根下（多根拍平）', () => {
		const r = parseMdOutline('# A\n\n# B\n', '根');
		expect(r.tree.children).toHaveLength(2);
		expect(textsOf(r.tree as MNode)).toEqual(['根', 'A', 'B']);
	});

	it('跳级标题按祖先链建层，mdLevel 保留原始 # 数', () => {
		const r = parseMdOutline('# X\n\n### Y\n', '根');
		const x = r.tree.children[0]!;
		expect(x.children).toHaveLength(1);
		expect(x.children[0]!.data.text, '### Y 挂到 # X 之下（不补虚拟 ## 层）').toBe(
			'Y',
		);
		expect(x.children[0]!.data.mdLevel, 'mdLevel 保留原始 # 数量 3').toBe(3);
	});

	it('frontmatter 原样切出（含首尾 --- 与换行），不进入导图树', () => {
		const r = parseMdOutline(
			'---\ntitle: 测试\ntags: [a, b]\n---\n\n# 正文\n',
			'根',
		);
		expect(r.frontmatter, 'frontmatter 含尾随换行，原样保留').toBe(
			'---\ntitle: 测试\ntags: [a, b]\n---\n',
		);
		expect(r.tree.children, 'frontmatter 不产生任何节点').toHaveLength(1);
		expect(textsOf(r.tree as MNode)).toEqual(['根', '正文']);
	});

	it('分隔线/空行忽略；纯列表文档直接挂虚拟根', () => {
		const r = parseMdOutline('- 一\n\n---\n\n- 二\n', '根');
		expect(textsOf(r.tree as MNode)).toEqual(['根', '一', '二']);
		expect(r.tree.children[0]!.data.mdType).toBe('list');
	});

	it('空标题（`#`/`# `）不产生节点；空列表项（`- `）退化为 plain 段落', () => {
		expect(parseMdOutline('#\n', '根').tree.children, '`#` 无文本').toHaveLength(0);
		expect(parseMdOutline('# \n', '根').tree.children, '`# ` 无文本').toHaveLength(
			0,
		);
		// `- ` 行 trimEnd 后是 `-`，不再满足 LIST_RE（要求标记后有空白+内容）→ 落为 plain 段落。
		// 锁定现状（用户不会写该形态，但空列表行不得被静默当链接/列表处理）。
		const bare = parseMdOutline('- \n', '根').tree.children;
		expect(bare).toHaveLength(1);
		expect(bare[0]!.data.mdType).toBe('plain');
		expect(bare[0]!.data.text).toBe('-');
		expect(roundTrip('- \n').out1).toBe('-');
	});

	it('`#标题`（无空格）不匹配标题行 → 落为 plain 段落节点（源码注释所述「宽容」未实现）', () => {
		// HEADING_RE = /^(#{1,6})(?:[ \t]+(.*))?$/ 要求 # 后有空白；
		// md-outline.ts 顶部注释写「宽容：#标题 无空格亦可」，实际行为是无空格即普通段落。
		// 断言真实现状（并锁定不动点），避免注释与实现继续漂移。
		const r = parseMdOutline('#标题\n', '根');
		expect(r.tree.children).toHaveLength(1);
		expect(r.tree.children[0]!.data.mdType, '不识别为 heading').toBe('plain');
		expect(r.tree.children[0]!.data.text).toBe('#标题');
		expect(roundTrip('#标题\n').out1, '整行按 plain 段落逐字回写').toBe('#标题');
	});

	it('有序列表 marker 归一为 ordered，* / + 标记原样保留', () => {
		const r = parseMdOutline('* a\n+ b\n3. c\n', '根');
		expect(r.tree.children.map((c) => (c.data as MdData).mdMarker)).toEqual([
			'*',
			'+',
			'ordered',
		]);
	});

	it('列表项的续行（缩进大于栈顶）并入同一节点的多行文本与 mdRaw', () => {
		const r = parseMdOutline('- 第一行\n  续行\n', '根');
		const li = r.tree.children[0]!;
		expect(li.children, '续行不新建节点').toHaveLength(0);
		expect(li.data.text).toBe('第一行\n续行');
		expect(li.data.mdDerivedText, 'mdDerivedText 与 text 同步（未被用户编辑）').toBe(
			'第一行\n续行',
		);
		expect(li.data.mdRaw, 'mdRaw 存未加前缀的原始行').toBe('第一行\n续行');
	});

	it('相邻 plain 行合并为一个多行段落节点（段落语义）', () => {
		const r = parseMdOutline('# H\n\n第一行\n第二行\n', '根');
		const plains = collect(r.tree as MNode).filter(
			({ node }) => node.data.mdType === 'plain',
		);
		expect(plains).toHaveLength(1);
		expect(plains[0]!.node.data.text).toBe('第一行\n第二行');
	});
});

// ---------------------------------------------------------------------------
// 二、层级深度（标题降级法 + 显式栈回归）
// ---------------------------------------------------------------------------
describe('层级深度', () => {
	it('标题 1–6 级逐级加深；6 级之下用列表缩进表达第 7 级', () => {
		const md = ['# h1', '## h2', '### h3', '#### h4', '##### h5', '###### h6'].join(
			'\n',
		);
		const r = parseMdOutline(md, '根');
		const levels: (number | undefined)[] = [];
		collect(r.tree).forEach(({ node, depth }) => {
			if (depth > 0) levels.push(node.data.mdLevel as number | undefined);
		});
		expect(levels.join(','), '标题链 1→6 逐级嵌套').toBe('1,2,3,4,5,6');
		expect(
			serializeMdBody(r.tree, null),
			'标题链序列化在块之间插空行',
		).toBe(['# h1', '', '## h2', '', '### h3', '', '#### h4', '', '##### h5', '', '###### h6'].join('\n'));

		// 第 7 级：6 级标题下的列表项（列表缩进降级法）
		const deep = parseMdOutline('###### base\n  - level7\n', '根');
		const base = deep.tree.children[0]!;
		expect(base.children).toHaveLength(1);
		expect(base.children[0]!.data.mdType).toBe('list');
		expect(base.children[0]!.data.text).toBe('level7');
	});

	it('深层列表（50 级）：缩进逐级嵌套，深度与序列化缩进精确匹配', () => {
		const depth = 50;
		const lines = ['# 深', ''];
		for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + '- l' + i);
		const r = parseMdOutline(lines.join('\n'), '根');
		const maxDepth = Math.max(...collect(r.tree as MNode).map((e) => e.depth));
		expect(maxDepth, '根(0) + 标题(1) + 50 层列表').toBe(depth + 1);
		const leaf = collect(r.tree as MNode).find((e) => e.depth === depth + 1)!;
		expect(leaf.node.data.text).toBe('l' + (depth - 1));
		// 序列化缩进 = '  '.repeat(listIndent)，与输入逐行一致（标题与首个列表项之间无空行）
		const expected = ['# 深'];
		for (let i = 0; i < depth; i++) expected.push('  '.repeat(i) + '- l' + i);
		const { out1, out2 } = roundTrip(lines.join('\n'));
		expect(out1).toBe(expected.join('\n'));
		expect(out2, '深层列表往返不动点').toBe(out1);
	});

	it('5 万级深树：uid 修复 + 序列化走显式栈，不触发 RangeError', () => {
		const depth = 50000;
		const root: MNode = { data: { text: 'deep0' }, children: [] };
		let cursor = root;
		for (let i = 1; i < depth; i++) {
			const next: MNode = {
				data: { text: 'deep' + i, mdType: 'heading', mdLevel: 1 },
				children: [],
			};
			cursor.children.push(next);
			cursor = next;
		}
		// 递归实现在这一层级会 RangeError（栈溢出）→ 保存崩溃
		expect(ensureUniqueUids(root), '缺 uid 的深链被修复').toBe(true);
		const out = serializeMdBody(root, null);
		const outLines = out.split('\n');
		// 虚拟根自身不输出；49999 个 heading 各自成块，块间插空行 → 2n-1 行
		expect(outLines).toHaveLength(2 * (depth - 1) - 1);
		expect(outLines[0]).toBe('# deep1');
		expect(outLines[outLines.length - 1]).toBe('# deep' + (depth - 1));
	});
});

// ---------------------------------------------------------------------------
// 三、往返不动点（parse → serialize → parse → serialize 两趟逐字相等）
// ---------------------------------------------------------------------------
describe('往返不动点', () => {
	const fixedPoints: { name: string; md: string }[] = [
		{
			name: '标题+嵌套列表+段落：空行已规范化，整篇逐字回写',
			md: ['# 主题', '- 项 A', '  - 子项 1', '- 项 B', '', '正文段落。'].join(
				'\n',
			),
		},
		{
			name: '多行段落（plain 整块 mdRaw 保留，空行不被塞回段内）',
			md: ['# H', '', '第一行', '第二行'].join('\n'),
		},
		{
			name: '围栏块（含空行、类标题/列表行、语言信息）逐字回写',
			md: [
				'# 顶',
				'',
				'前文。',
				'',
				'```ts',
				'# 假标题',
				'- 假列表',
				'',
				'const x = 1;',
				'```',
				'',
				'- 后置',
			].join('\n'),
		},
		{
			name: '文档以围栏开头（无前置块 → 无分隔空行叠加）',
			md: ['```', 'code', '```'].join('\n'),
		},
		{
			name: '~~ 围栏与 ``` 不互认（闭合字符必须一致）',
			md: ['~~~', '```', '~~~'].join('\n'),
		},
		{
			name: '行内 [[]] / ![[]] / **轻标记** / 尖括号 autolink 混排',
			md: [
				'# H',
				'- [[目标|显示名]]',
				'- ![[img.png]]',
				'- **加粗**项',
				'- ![[图.png]] 标注',
				'- <https://x.com/a>',
				'- API https://y.com/b',
			].join('\n'),
		},
		{
			name: '区块引用双链（#章节 与 #章节|别名）',
			md: ['# H', '- [[笔记#章节]]', '- [[笔记#章节|别名]]'].join('\n'),
		},
		{
			name: '两个双链同行：仅首链进元数据，第二个靠 mdRaw 保真',
			md: '- [[A]] 与 [[B]]',
		},
		{
			name: '裸 URL 与双链混排（URL 剥出后文本空格折叠，但 mdRaw 逐字回写）',
			md: '- 对比 https://a.com 与 [[笔记B]]',
		},
		{
			name: '混用 * / + / - 列表标记（标记原样回写）',
			md: ['* a', '  + b', '    - c'].join('\n'),
		},
		{
			name: '附件双链与嵌入（非图片走附件通道，符号不得被改写）',
			md: ['- [[报告.pdf]]', '- ![[报告.pdf]]', '- ![[图.png]]'].join('\n'),
		},
		{
			name: '列表项续行（续行缩进 2 空格）',
			md: ['- 第一行', '  续行'].join('\n'),
		},
	];

	it.each(fixedPoints)('$name', ({ md }) => {
		const { out1, out2 } = roundTrip(md);
		expect(out1, '已规范化输入应逐字回写（含缩进/符号/空行）').toBe(md);
		expect(out2, '二次往返必须逐字相等（不动点）').toBe(out1);
	});

	it('规范化：连续空行与 --- 分隔线被丢弃（内容不丢）', () => {
		const md = ['# 主题', '', '', '- 项 A', '', '---', '', '- 项 B', ''].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(['# 主题', '- 项 A', '- 项 B'].join('\n'));
		expect(out2).toBe(out1);
	});

	it('规范化：段落之间的空行被合并（相邻 plain 行合为一个节点）', () => {
		const md = ['# H', '', 'A', '', '', 'B', ''].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(['# H', '', 'A', 'B'].join('\n'));
		expect(out2).toBe(out1);
	});

	it('规范化：无缩进的段落首尾空白与 tab 缩进被归一', () => {
		const md = ['# H', '', '  缩进段落  ', ''].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1, 'plain 行按 trim 后文本回写').toBe(['# H', '', '缩进段落'].join('\n'));
		expect(out2).toBe(out1);
	});

	it('规范化：有序列表重排为 1..n，且无序项打断计数', () => {
		const md = ['# O', '- a', '3. b', '4. c', '- d', '2. e'].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(['# O', '- a', '1. b', '2. c', '- d', '1. e'].join('\n'));
		expect(out2, '重排结果稳定').toBe(out1);
	});

	it('规范化：跳级标题之间补空行（块分隔），层级关系不变', () => {
		const md = ['# h1', '### h3', '###### h6', '  - 七级'].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(
			['# h1', '', '### h3', '', '###### h6', '- 七级'].join('\n'),
		);
		expect(out2).toBe(out1);
	});

	it('综合文档：标题+嵌套列表+有序列表+段落+围栏 二次往返不动点', () => {
		const md = [
			'# 主题',
			'',
			'- 项 A',
			'  - 子项 1',
			'  - 子项 2',
			'- 项 B',
			'',
			'正文段落，含 **强调** 与 [[维基链接]]。',
			'',
			'```ts',
			'# 注释行-不是列表',
			'- 不是列表项',
			'',
			'const x = 1; // code',
			'```',
			'',
			'1. 序一',
			'2. 序二',
		].join('\n');
		const expected = [
			'# 主题',
			'- 项 A',
			'  - 子项 1',
			'  - 子项 2',
			'- 项 B',
			'',
			'正文段落，含 **强调** 与 [[维基链接]]。',
			'',
			'```ts',
			'# 注释行-不是列表',
			'- 不是列表项',
			'',
			'const x = 1; // code',
			'```',
			'',
			'1. 序一',
			'2. 序二',
		].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1, '空行归一后结构完整（围栏内空行属代码内容，必须保留）').toBe(
			expected,
		);
		expect(out2, '综合文档二次往返不动点').toBe(out1);
	});

	it('空义输入：无正文 / 仅 frontmatter / 仅空白 都序列化为空串', () => {
		expect(serializeMdBody(parseMdOutline('', '根').tree, null)).toBe('');
		expect(
			serializeMdBody(parseMdOutline('---\na: 1\n---\n', '根').tree, null),
			'serializeMdBody 只产出正文（frontmatter 由调用方拼接）',
		).toBe('');
		expect(serializeMdBody(parseMdOutline('\n\n  \n', '根').tree, null)).toBe('');
	});

	it('frontmatter 由解析结果承载、不在正文输出中重复', () => {
		const content = '---\ntitle: T\n---\n# 顶\n- a';
		const r = parseMdOutline(content, '根');
		expect(r.frontmatter).toBe('---\ntitle: T\n---\n');
		expect(serializeMdBody(r.tree, null), '正文部分（frontmatter 之外）').toBe(
			['# 顶', '- a'].join('\n'),
		);
	});

	it('已知非幂等：`# 标题` 后紧跟「空行 + 围栏」时每趟往返多一空行（记录现状）', () => {
		// 成因：标题后空行被保留下来成为 plain 块的首行（mdRaw 以 '\n' 开头），
		// 而 serializeMdBody 的 pushBlock 又为该块补一枚分隔空行 → 两者叠加累积。
		// 前有段落文本时不会触发（见「围栏块…逐字回写」用例），故此处只锁定现状：
		// 一旦 pushBlock/空行保留策略被修正，本用例会失败并提示更新期望值。
		const first = roundTrip(['# 顶', '', '```', 'code', '```'].join('\n'));
		expect(first.out1).toBe(['# 顶', '', '', '```', 'code', '```'].join('\n'));
		const second = roundTrip(first.out1);
		expect(second.out1, '第二趟再多一枚空行（非不动点）').toBe(
			['# 顶', '', '', '', '```', 'code', '```'].join('\n'),
		);
	});
});

// ---------------------------------------------------------------------------
// 四、编辑合成（用户改文本/换图后：未触碰行保持原文，触碰行按节点合成）
// ---------------------------------------------------------------------------
describe('编辑合成', () => {
	it('编辑列表项文本：该行合成新文本，未编辑行保持原文', () => {
		const tree: MNode = parseMdOutline('# R\n- 原样一\n- 修改我\n', '根').tree;
		const target = tree.children[0]!.children.find(
			(c) => c.data.text === '修改我',
		)!;
		target.data.text = '改成了';
		expect(serializeMdBody(tree, null)).toBe(
			['# R', '- 原样一', '- 改成了'].join('\n'),
		);
	});

	it('编辑标题文本：按 # + 新文本合成', () => {
		const tree: MNode = parseMdOutline('# 旧标题\n', '根').tree;
		tree.children[0]!.data.text = '新标题';
		expect(serializeMdBody(tree, null)).toBe('# 新标题');
	});

	it('新建节点（无 mdType/mdRaw）默认按 `- ` 输出，保留 mdMarker', () => {
		const tree: MNode = parseMdOutline('# R\n', '根').tree;
		tree.children[0]!.children.push({ data: { text: '新节点' }, children: [] });
		tree.children[0]!.children.push({
			data: { text: '星号项', mdMarker: '*' },
			children: [],
		});
		tree.children[0]!.children.push({
			data: { text: '有序项', mdMarker: 'ordered' },
			children: [],
		});
		expect(serializeMdBody(tree, null)).toBe(
			['# R', '- 新节点', '* 星号项', '1. 有序项'].join('\n'),
		);
	});

	it('换图后合成外链图片（md 语法），旧图引用不残留', () => {
		const { tree, data } = firstChild('- ![[old.png]]\n');
		data.image = 'https://example.com/new.png';
		expect(serializeMdBody(tree, null)).toBe(
			'- ![](https://example.com/new.png)',
		);
	});

	it('深层列表（40 级）叶子编辑：仅该行合成，缩进保持层级深度', () => {
		const depth = 40;
		const lines = ['# 深', ''];
		for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + '- l' + i);
		const tree: MNode = parseMdOutline(lines.join('\n'), '根').tree;
		let leaf: MNode = tree.children[0]!;
		while (leaf.children.length > 0) {
			leaf = leaf.children[leaf.children.length - 1]!;
		}
		leaf.data.text = '已编辑';
		const out = serializeMdBody(tree, null).split('\n');
		expect(out[out.length - 1]).toBe('  '.repeat(depth - 1) + '- 已编辑');
		expect(out[1], '其余层级保持原文').toBe('- l0');
	});

	it('编辑多行文本：首行带链接 token，续行缩进 = 列表缩进 + 2 空格', () => {
		const { tree, data } = firstChild('- [[目标|别名]] 说明\n');
		data.text = '别名 说明\n第二行';
		expect(serializeMdBody(tree, null)).toBe(
			['- 别名 说明 [[目标|别名]]', '  第二行'].join('\n'),
		);
	});

	it('纯 token 节点（文本 == 链接显示名）换链后只输出新 token，旧显示名不残留', () => {
		const { tree, data } = firstChild('- [[旧目标|别名]]\n');
		data.hyperlink = '[[新目标]]';
		data.text = '新目标';
		expect(serializeMdBody(tree, null)).toBe('- [[新目标]]');
	});

	it('纯 token 节点（文本 == 图片文件名）换图后只输出新 token', () => {
		// 历史兼容路径：旧版解析曾把文件名回退为纯图节点文本（imageSelfText 分支）；
		// 「插入/更换图片」会同步文本为新文件名，故此处 text 与 mdImageTarget 末段同名。
		const { tree, data } = firstChild('- ![[a.png]]\n');
		Object.assign(data, {
			text: 'b.png',
			image: 'assets/b.png',
			mdImageTarget: 'assets/b.png',
		});
		expect(serializeMdBody(tree, null), '旧文件名不冗余重复输出').toBe(
			'- ![[assets/b.png]]',
		);
	});
});

// ---------------------------------------------------------------------------
// 五、rawOk「未编辑检测」分支矩阵（md-serialize 的数据无损性核心启发式）
// ---------------------------------------------------------------------------
describe('rawOk 未编辑检测分支矩阵', () => {
	it('① 文本被编辑（text ≠ mdDerivedText）→ 合成，旧 mdRaw 不再回写', () => {
		const { tree, data } = firstChild('- [[目标]] 原文\n');
		data.text = '改过了';
		expect(serializeMdBody(tree, null)).toBe('- 改过了 [[目标]]');
	});

	it('② 链接被清除（heading）→ mdRaw 不原样回写，链接不复活、纯文本保留', () => {
		const { tree, data } = firstChild('# [[旧目标]] 标题\n');
		expect(data.text, '解析：wikilink 剥壳为显示名并入节点文本').toBe('旧目标 标题');
		delete data.hyperlink; // 用户清除链接（clearNodeHyperlink 语义：两通道一并清除）
		delete data.mdWikiLinkpath;
		const out = serializeMdBody(tree, null);
		expect(out).toBe('# 旧目标 标题');
		expect(out).not.toContain('[[');
	});

	it('③ 链接被清除（list，mdWikiLinkpath 文档通道）→ 同样剥离', () => {
		const { tree, data } = firstChild('- [[旧目标]] 标题\n');
		delete data.mdWikiLinkpath;
		expect(serializeMdBody(tree, null)).toBe('- 旧目标 标题');
	});

	it('④ 链接被清除（list，attachmentUrl 附件通道）→ 同样剥离', () => {
		const { tree, data } = firstChild('- [[报告.pdf]]\n');
		delete data.attachmentUrl;
		delete data.mdAttachmentLinkpath;
		expect(serializeMdBody(tree, null)).toBe('- 报告.pdf');
	});

	it('⑤ 有 mdRaw 的节点新增链接 → 走合成（mdRaw 原样覆盖会丢链接）', () => {
		const { tree, data } = firstChild('- 纯文本项\n');
		data.hyperlink = '[[新目标]]';
		expect(serializeMdBody(tree, null)).toBe('- 纯文本项 [[新目标]]');
	});

	it('⑥ 有 mdRaw 的节点新增文档双链 → 走合成', () => {
		const { tree, data } = firstChild('- 纯文本项\n');
		Object.assign(data, {
			mdWikiLinkpath: '[[新目标]]',
			mdLinkStyle: 'wiki',
			mdLinkText: '新目标',
		});
		expect(serializeMdBody(tree, null)).toBe('- 纯文本项 [[新目标]]');
	});

	it('⑦ plain 段落豁免：mdRaw 含 [[..]]/[](url) 但 hyperlink 恒空 → 逐字回写', () => {
		// 段落节点解析时本就不携带 hyperlink（多行文本无引擎单链），
		// 其 mdRaw 里的链接语法是原文的一部分，不能被「链接已清除」判定破坏。
		const md = ['# H', '', '参见 [[设计稿|设计]] 与 [仓库](https://example.com) 说明'].join(
			'\n',
		);
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(md);
		expect(out2).toBe(out1);
	});

	it('⑧ 图片嵌入语法被负向断言 (?<!!)\\[\\[ 排除：纯图行/图文行逐字回写', () => {
		// `![[img]]` 不是链接；若不排除，hyperlink 为空的纯图行会被误判「链接已清除」→ 放弃逐字回写
		const pure = roundTrip('- ![[图.png]]\n');
		expect(pure.out1, '纯图行（无链接字段）逐字回写').toBe('- ![[图.png]]');
		const mixed = roundTrip('- ![[图.png]] 标注\n');
		expect(mixed.out1, '图文混合行（无链接字段）逐字回写').toBe('- ![[图.png]] 标注');
		const withLink = roundTrip('- ![[a.png]] 见 [[笔记]]\n');
		expect(withLink.out1, '图 + 文档双链同行：双链特征命中 mdRaw → 逐字回写').toBe(
			'- ![[a.png]] 见 [[笔记]]',
		);
	});

	it('⑨ 图片被移除（image 清空、md 元数据残留）→ 不逐字回写，旧图不复活', () => {
		const { tree, data } = firstChild('- ![[a.png]]\n');
		// 引擎 SET_NODE_IMAGE(null) 的真实效果：image 置空而 mdImageTarget 仍在
		data.image = null;
		const out = serializeMdBody(tree, null);
		expect(out).not.toContain('![[a.png]]');
		expect(out, '图片独占节点移除图片后只剩空列表行').toBe('- ');
	});

	it('⑩ 尺寸参数不符（拖拽调宽后 mdRaw 还是旧宽度）→ 走合成', () => {
		const { tree, data } = firstChild('- ![[a.png|300]]\n');
		expect(data.mdImageWidth).toBe(300);
		data.imageSize = { width: 250, height: 125, custom: true };
		expect(serializeMdBody(tree, null)).toBe('- ![[a.png|250]]');
	});
});

// ---------------------------------------------------------------------------
// 五点五、纯双链节点：编辑节点 = 改别名（节点内只显示别名 → 编辑即改别名）
// ---------------------------------------------------------------------------
describe('纯双链节点：编辑节点 = 改别名', () => {
	it('原无别名 → 新文本成为别名', () => {
		const { tree, data } = firstChild('- [[目标]]\n');
		expect(data.text, '节点内只显示可见名（无别名时为目标显示名）').toBe('目标');
		data.text = '新别名';
		expect(serializeMdBody(tree, null), '不再产出「新别名 [[目标]]」').toBe(
			'- [[目标|新别名]]',
		);
	});

	it('已有别名 → 别名被替换', () => {
		const { tree, data } = firstChild('- [[目标|旧别名]]\n');
		expect(data.text).toBe('旧别名');
		data.text = '新别名';
		expect(serializeMdBody(tree, null)).toBe('- [[目标|新别名]]');
	});

	it('区块引用 + 别名：目标与 #区块 原样保留', () => {
		const { tree, data } = firstChild('- [[笔记#标题|旧]]\n');
		data.text = '新';
		expect(serializeMdBody(tree, null)).toBe('- [[笔记#标题|新]]');
	});

	it('库内路径目标：只换别名，路径不动', () => {
		const { tree, data } = firstChild('- [[目录/笔记|旧]]\n');
		data.text = '新';
		expect(serializeMdBody(tree, null)).toBe('- [[目录/笔记|新]]');
	});

	it('heading 节点同样适用（# 前缀不影响别名回写）', () => {
		const { tree, data } = firstChild('# [[目标|旧]]\n');
		data.text = '新';
		expect(serializeMdBody(tree, null)).toBe('# [[目标|新]]');
	});

	it('新文本==目标默认显示名 → 不写冗余别名段（无 [[目标|目标]]）', () => {
		const { tree, data } = firstChild('- [[目标|旧]]\n');
		data.text = '目标';
		expect(serializeMdBody(tree, null)).toBe('- [[目标]]');
	});

	it('清空文本 → 去掉别名段，链接保留', () => {
		const { tree, data } = firstChild('- [[目标|旧]]\n');
		data.text = '';
		expect(serializeMdBody(tree, null)).toBe('- [[目标]]');
	});

	it('回写结果再解析：节点文本 = 新别名，二次序列化不动点', () => {
		const { tree, data } = firstChild('- [[目标|旧]]\n');
		data.text = '新别名';
		const out = serializeMdBody(tree, null);
		const re = parseMdOutline(out, '根').tree as unknown as MNode;
		expect(re.children[0]!.data.text, '重载后节点内仍只显示别名').toBe('新别名');
		expect(re.children[0]!.data.mdWikiLinkpath).toBe('[[目标|新别名]]');
		expect(serializeMdBody(re, null)).toBe(out);
	});

	it('会话内二次编辑（mdDerivedText 未刷新）不叠加、不重复 token', () => {
		const { tree, data } = firstChild('- [[目标|旧]]\n');
		data.text = '别名A';
		expect(serializeMdBody(tree, null)).toBe('- [[目标|别名A]]');
		data.text = '别名B';
		expect(serializeMdBody(tree, null)).toBe('- [[目标|别名B]]');
	});

	it('附件双链（原无别名）→ 新文本成为附件别名', () => {
		const { tree, data } = firstChild('- [[报告.pdf]]\n');
		expect(data.text).toBe('报告.pdf');
		data.text = '季度报告';
		expect(serializeMdBody(tree, null)).toBe('- [[报告.pdf|季度报告]]');
	});

	it('附件双链（已有别名）→ 别名被替换', () => {
		const { tree, data } = firstChild('- [[报告.pdf|旧]]\n');
		data.text = '新';
		expect(serializeMdBody(tree, null)).toBe('- [[报告.pdf|新]]');
	});

	it('嵌入语法 ![[附件]] 不适用（管道位是尺寸参数）→ 保持旧合成', () => {
		const { tree, data } = firstChild('- ![[报告.pdf]]\n');
		data.text = '说明书';
		expect(serializeMdBody(tree, null)).toBe('- 说明书 ![[报告.pdf]]');
	});

	it('混合文本节点（非纯双链）→ 保持「文本 + 行尾链接」', () => {
		const { tree, data } = firstChild('- 前置说明 [[目标]] 后置说明\n');
		data.text = '整段重写';
		expect(serializeMdBody(tree, null), '把整段文本当别名会吞掉说明文字').toBe(
			'- 整段重写 [[目标]]',
		);
	});

	it('多行文本（无唯一别名语义）→ 回落旧合成，不丢数据', () => {
		const { tree, data } = firstChild('- [[目标]]\n');
		data.text = '第一行\n第二行';
		expect(serializeMdBody(tree, null)).toBe('- 第一行 [[目标]]\n  第二行');
	});

	it('图文纯双链节点：图片 token 与改写后的双链都在', () => {
		const { tree, data } = firstChild('- ![[a.png]] [[目标]]\n');
		data.text = '新别名';
		expect(serializeMdBody(tree, null)).toBe('- ![[a.png]] [[目标|新别名]]');
	});

	it('URL 链接节点不适用（无别名概念）→ 保持旧合成', () => {
		const { tree, data } = firstChild('- <https://example.com>\n');
		data.text = '改过了';
		expect(serializeMdBody(tree, null)).toBe('- 改过了 <https://example.com>');
	});

	it('文本含 [ ]（手输 [[新目标]]）→ 不写坏链接，回落旧合成', () => {
		const { tree, data } = firstChild('- [[目标]]\n');
		data.text = '[[新目标]]';
		expect(
			serializeMdBody(tree, null),
			'别名位不允许方括号，此时语义上更接近「换链」',
		).toBe('- [[新目标]] [[目标]]');
	});
});

// ---------------------------------------------------------------------------
// 六、图片独占节点（纯图行 text 为空；渲染层语义：图片即节点内容）
// ---------------------------------------------------------------------------
describe('图片独占节点', () => {
	it('纯图行解析为无文本节点（不回退文件名占位）', () => {
		const { data } = firstChild('- ![[图.png]]\n');
		expect(data.image).toBe('图.png');
		expect(data.mdImageTarget).toBe('图.png');
		expect(data.text, '图片独占：text 为空（纯图节点不参与文本搜索）').toBe('');
		expect(data.mdDerivedText, 'mdDerivedText 与 text 一致 → 判定为未编辑').toBe('');
	});

	it('纯图行与图文混合行都逐字往返', () => {
		const md = ['# 顶', '- ![[图.png]]', '- ![[另一个.png]] 标注'].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(md);
		expect(out2).toBe(md);
	});

	it('混合节点删除文字后合成纯图行（图片独占），再解析仍无文本', () => {
		const { tree, data } = firstChild('- ![[a.png]] 说明文字\n');
		expect(data.text).toBe('说明文字');
		data.text = ''; // 用户编辑文本/移除文字的语义：text 被清空
		const out = serializeMdBody(tree, null);
		expect(out, '整行只含图片 token').toBe('- ![[a.png]]');
		const reparsed: MNode = parseMdOutline(out, '根').tree;
		expect(reparsed.children[0]!.data.text, '再解析仍为图片独占节点').toBe('');
		expect(serializeMdBody(reparsed, null), '合成结果自往返不动点').toBe(out);
	});

	it('图片独占节点补文字后合成图文混合行（图片在前）', () => {
		const { tree, data } = firstChild('- ![[a.png]]\n');
		expect(data.text).toBe('');
		data.text = '补个标题';
		expect(serializeMdBody(tree, null)).toBe('- 补个标题 ![[a.png]]');
	});

	it('首个图片之外的图片剥壳为文本占位（一节点一图）', () => {
		const { data } = firstChild('- ![[a.png]] ![[b.png]]\n');
		expect(data.image, '首个图片进 image').toBe('a.png');
		expect(data.text, '多余图片按显示名剥壳为文本').toBe('b.png');
	});
});

// ---------------------------------------------------------------------------
// 七、嵌入尺寸参数（Obsidian 官方语法：![[图|300]] / ![[图|300x150]] /
// ![alt|300](url)；见官方帮助 Embed files / Basic formatting syntax）
// ---------------------------------------------------------------------------
describe('嵌入尺寸参数', () => {
	it('解析：wiki 嵌入的宽度/宽高参数进入元数据，纯图语义不变', () => {
		const r = parseMdOutline('- ![[a.png|300]]\n- ![[b.png|300x150]]\n', '根');
		const a = r.tree.children[0]!;
		const b = r.tree.children[1]!;
		expect(a.data.mdImageWidth, '仅宽：mdImageWidth').toBe(300);
		expect(a.data.mdImageHeight, '仅宽：高度缺省（由加载校正按比例补齐）').toBeUndefined();
		expect(b.data.mdImageWidth).toBe(300);
		expect(b.data.mdImageHeight).toBe(150);
		expect(a.data.text, '带尺寸的纯图行仍为图片独占').toBe('');
		expect(a.data.mdImageAlt, '数字标签是尺寸参数，不是 alt').toBeUndefined();
	});

	it('解析：非数字标签是说明文本（alt），不产生尺寸', () => {
		const r = parseMdOutline('- ![[a.png|可爱小猫]]\n', '根');
		const a = r.tree.children[0]!;
		expect(a.data.mdImageAlt).toBe('可爱小猫');
		expect(a.data.mdImageWidth).toBeUndefined();
		expect(a.data.text, 'alt 不占节点文本（图片独占）').toBe('');
	});

	it('解析：外链 md 图片的标签尾部尺寸（![alt|300](url) / ![250](url)）', () => {
		const r = parseMdOutline(
			'- ![截图|300](https://x.com/a.png)\n- ![250](https://x.com/b.png)\n',
			'根',
		);
		const a = r.tree.children[0]!;
		const b = r.tree.children[1]!;
		expect(a.data.image).toBe('https://x.com/a.png');
		expect(a.data.mdImageWidth, 'alt|宽 形式').toBe(300);
		expect(a.data.mdImageHeight).toBeUndefined();
		expect(a.data.mdImageAlt, '尺寸前的部分作为 alt 保留').toBe('截图');
		expect(a.data.text, 'alt 不作为节点文本（首图）').toBe('');
		expect(b.data.mdImageWidth, '整段标签即尺寸').toBe(250);
		expect(b.data.mdImageAlt, '纯尺寸标签不留 alt').toBeUndefined();
	});

	it('解析边界：|0 / |300x / |300x0 不产生尺寸（不合法参数按文本标签处理）', () => {
		const zero = parseMdOutline('- ![[a.png|0]]\n', '根').tree.children[0]!;
		expect(zero.data.mdImageWidth, '宽度 0 不算尺寸').toBeUndefined();
		expect(zero.data.mdImageAlt, '标签被尺寸正则吃掉（alt 为空串 → 不写字段）').toBeUndefined();
		const bad = parseMdOutline('- ![[a.png|300x]]\n', '根').tree.children[0]!;
		expect(bad.data.mdImageWidth, '宽高形态残缺 → 不算尺寸').toBeUndefined();
		expect(bad.data.mdImageAlt, '整段标签按说明文本保留').toBe('300x');
		const zeroH = parseMdOutline('- ![[a.png|300x0]]\n', '根').tree.children[0]!;
		expect(zeroH.data.mdImageWidth).toBe(300);
		expect(zeroH.data.mdImageHeight, '高度 0 被丢弃（height > 0 才成立）').toBeUndefined();
	});

	it('带尺寸行未编辑逐字回写（含宽高形式）', () => {
		const md = ['# 顶', '- ![[a.png|300]]', '- ![[b.png|300x150]]'].join('\n');
		const { out1, out2 } = roundTrip(md);
		expect(out1).toBe(md);
		expect(out2).toBe(md);
	});

	it('拖拽调宽后合成回写 |宽度（原无参数），再解析参数进入元数据', () => {
		const { tree, data } = firstChild('- ![[a.png]]\n');
		// 拖拽调宽的引擎侧效果：SET_NODE_DATA imageSize custom
		data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out).toBe('- ![[a.png|250]]');
		const reparsed: MNode = parseMdOutline(out, '根').tree;
		expect(reparsed.children[0]!.data.mdImageWidth).toBe(250);
		expect(serializeMdBody(reparsed, null), '带参合成结果自往返不动点').toBe(out);
	});

	it('拖拽调宽后更新已有宽度参数（|300 → |250），旧参数不残留', () => {
		const { tree, data } = firstChild('- ![[a.png|300]]\n');
		data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out).toBe('- ![[a.png|250]]');
		expect(out).not.toContain('300');
	});

	it('宽度前缀不混淆（|30 vs |300x150）：终界检查使尺寸变更走合成', () => {
		const { tree, data } = firstChild('- ![[a.png|300x150]]\n');
		expect(data.mdImageHeight, '源行有显式高度').toBe(150);
		data.imageSize = { width: 30, height: 15, custom: true };
		const out = serializeMdBody(tree, null);
		// 源行有显式高度 → 回写双参数形态（高度信息不丢）
		expect(out).toBe('- ![[a.png|30x15]]');
		expect(out).not.toContain('300');
	});

	it('显式高度只随源行回写：仅宽源行不凭空补高度', () => {
		const { tree, data } = firstChild('- ![[a.png|300]]\n');
		expect(data.mdImageHeight).toBeUndefined();
		data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out, '维持仅宽（等比）形态').toBe('- ![[a.png|250]]');
		expect(out).not.toContain('x125');
	});

	it('图文混合节点调宽：文本与尺寸参数同时保留', () => {
		const { tree, data } = firstChild('- 标注 ![[a.png|300]]\n');
		expect(data.text).toBe('标注');
		data.imageSize = { width: 250, height: 125, custom: true };
		expect(serializeMdBody(tree, null)).toBe('- 标注 ![[a.png|250]]');
	});

	it('已知降级：外链 md 图片（![alt|300](url)）一经编辑即被改写成 ![[https://…]]（记录现状）', () => {
		// 成因：renderImage 首个分支 `if (target && image === target)` 直接输出 wiki 嵌入，
		// 而解析侧把 mdImg 的 mdImageTarget 也设为同一 URL → 只要图片未被更换就命中该分支，
		// alt 被当作嵌入标签（`|alt`）或尺寸参数写出。`![[https://…]]` 不是 Obsidian 合法
		// 嵌入（wikilink 目标不能是 URL），也未走 renderImage 末尾的外链 md 图分支。
		// 未编辑时由 mdRaw 逐字回写保真，故只在「文本被编辑 / 尺寸被调整」后暴露。
		const md = '- ![截图|300](https://x.com/a.png)';
		expect(roundTrip(md).out1, '未编辑：逐字回写（含 ![] 语法与 alt）').toBe(md);

		const edited = firstChild(md + '\n');
		edited.data.text = '改过';
		expect(serializeMdBody(edited.tree, null), '编辑后 alt 被当作嵌入标签').toBe(
			'- 改过 ![[https://x.com/a.png|截图]]',
		);

		const resized = firstChild(md + '\n');
		resized.data.imageSize = { width: 250, height: 125, custom: true };
		expect(serializeMdBody(resized.tree, null), '调宽后尺寸写在 wiki 形态标签位').toBe(
			'- ![[https://x.com/a.png|250]]',
		);
	});

	it('wiki 嵌入的说明文本（![[a.png|说明]]）编辑文本后仍保留', () => {
		const { tree, data } = firstChild('- ![[a.png|说明]]\n');
		expect(data.mdImageAlt).toBe('说明');
		data.text = '改过';
		expect(serializeMdBody(tree, null)).toBe('- 改过 ![[a.png|说明]]');
	});
});

// ---------------------------------------------------------------------------
// 八、URL icon-only 与附件双链（三类图标分流的解析契约）
// ---------------------------------------------------------------------------
describe('URL icon-only 与附件/文档双链', () => {
	it('裸 URL 行：URL 不进节点文本（icon-only），hyperlink 指向 URL', () => {
		const { data } = firstChild('- API https://platform.example.com/usage\n');
		expect(data.hyperlink).toBe('https://platform.example.com/usage');
		expect(data.hyperlinkTitle).toBe('https://platform.example.com/usage');
		expect(data.mdLinkStyle).toBe('md');
		expect(data.text, 'URL 本体不渲染（避免长 URL 撑宽节点）').toBe('API');
	});

	it('裸 URL 行未编辑 → 逐字回写', () => {
		const md = '- API https://platform.example.com/usage';
		expect(roundTrip(md).out1).toBe(md);
	});

	it('尖括号 autolink 与裸 URL 同语义（文本为空、回写 <url>）', () => {
		const md = '- <https://x.com/a>';
		const { data } = firstChild(md + '\n');
		expect(data.hyperlink).toBe('https://x.com/a');
		expect(data.text).toBe('');
		expect(roundTrip(md).out1).toBe(md);
	});

	it('label 本身是 URL 的 md 链接（复制粘贴常见形态）→ icon-only 且逐字回写', () => {
		const url = 'https://example.com/a/very/long/path';
		const md = `- [${url}](${url})`;
		const { data } = firstChild(md + '\n');
		expect(data.hyperlink).toBe(url);
		expect(data.text, 'URL 本体不进节点文本').toBe('');
		expect(roundTrip(md).out1).toBe(md);
	});

	it('非 URL 的 md 链接（相对路径/含空格/含括号）解析与合成', () => {
		const rel = firstChild('- [笔记](folder/note.md)\n');
		expect(rel.data.hyperlink, '相对路径保持原样').toBe('folder/note.md');
		expect(roundTrip('- [笔记](folder/note.md)').out1).toBe(
			'- [笔记](folder/note.md)',
		);

		const spaced = firstChild('- [笔记](<folder/my note.md>)\n');
		expect(spaced.data.hyperlink, '尖括号目标剥壳（避免二次包裹 <<url>>）').toBe(
			'folder/my note.md',
		);
		expect(spaced.data.text).toBe('笔记');
		expect(roundTrip('- [笔记](<folder/my note.md>)').out1).toBe(
			'- [笔记](<folder/my note.md>)',
		);

		// 合成路径：目标含空格/括号必须用尖括号包裹，否则破坏 (…) 闭合
		const synth: MNode = parseMdOutline('# R\n', '根').tree;
		synth.children[0]!.children.push({
			data: {
				text: '笔记',
				hyperlink: 'folder/a(b).md',
				mdLinkStyle: 'md',
				mdLinkText: '笔记',
			},
			children: [],
		});
		const out = serializeMdBody(synth, null);
		expect(out).toBe(['# R', '- [笔记](<folder/a(b).md>)'].join('\n'));
		const back: MNode = parseMdOutline(out, '根').tree;
		expect(
			back.children[0]!.children[0]!.data.hyperlink,
			'尖括号包裹的目标可解析回（无回流损失）',
		).toBe('folder/a(b).md');
	});

	it('新插入的 URL 链接（引擎节点，无 mdRaw）回写为 <url>，无双层尖括号', () => {
		const tree: MNode = parseMdOutline('# R\n', '根').tree;
		tree.children[0]!.children.push({
			data: { text: '', hyperlink: 'https://example.com' },
			children: [],
		});
		const out = serializeMdBody(tree, null);
		expect(out).toBe(['# R', '- <https://example.com>'].join('\n'));
		expect(out).not.toContain('<<');
	});

	it('文档双链走 mdWikiLinkpath 通道（自绘文档图标，不写 hyperlink）', () => {
		const { data } = firstChild('- [[笔记A|别名]]\n');
		expect(data.mdWikiLinkpath).toBe('[[笔记A|别名]]');
		expect(data.mdLinkText, 'mdLinkText 存可见文本（别名优先）').toBe('别名');
		expect(data.hyperlink, '写 hyperlink 会与自绘文档图标双显').toBeUndefined();
		expect(data.attachmentUrl).toBeUndefined();
		expect(data.text).toBe('别名');
	});

	it('文档双链未编辑逐字回写；编辑节点 = 改别名回写', () => {
		const md = '- [[笔记A|别名]]';
		expect(roundTrip(md).out1).toBe(md);
		const { tree, data } = firstChild(md + '\n');
		data.text = '新标题';
		expect(
			serializeMdBody(tree, null),
			'纯双链节点内只显示别名 → 编辑节点即改别名，不再追加文本',
		).toBe('- [[笔记A|新标题]]');
	});

	it('双链附件走 attachmentUrl 通道（回形针），hyperlink 缺席、文本保留文件名', () => {
		const plain = firstChild('- [[报告.pdf]]\n');
		expect(plain.data.attachmentUrl).toBe('报告.pdf');
		expect(plain.data.attachmentName).toBe('报告.pdf');
		expect(plain.data.mdAttachmentLinkpath).toBe('报告.pdf');
		expect(plain.data.hyperlink).toBeUndefined();
		expect(plain.data.text).toBe('报告.pdf');

		const aliased = firstChild('- [[报告.pdf|资料]]\n');
		expect(aliased.data.attachmentUrl).toBe('报告.pdf');
		expect(aliased.data.attachmentName, '别名即显示名').toBe('资料');
		expect(aliased.data.text).toBe('资料');
	});

	it('双链附件未编辑逐字回写；编辑节点 = 改别名回写', () => {
		const aliased = '- [[报告.pdf|资料]]';
		expect(roundTrip(aliased).out1).toBe(aliased);
		const a = firstChild(aliased + '\n');
		a.data.text = '新标题';
		expect(
			serializeMdBody(a.tree, null),
			'纯双链附件节点内只显示别名 → 编辑节点即改别名',
		).toBe('- [[报告.pdf|新标题]]');

		const noAlias = firstChild('- [[报告.pdf]]\n');
		noAlias.data.text = '报告.pdf';
		expect(
			serializeMdBody(noAlias.tree, null),
			'新别名与默认显示名相同 → 不写冗余 |别名 段',
		).toBe('- [[报告.pdf]]');
	});

	it('非图片嵌入 ![[报告.pdf]] 走附件通道（不当作节点图），往返保留 !', () => {
		const md = '- ![[报告.pdf]]';
		const { tree, data } = firstChild(md + '\n');
		expect(data.image, '写 image 会让引擎按图片渲染 → 空白').toBeUndefined();
		expect(data.attachmentUrl).toBe('报告.pdf');
		expect(data.mdEmbed, '记录嵌入语法，回写时补回 !').toBe(true);
		expect(data.text).toBe('');
		expect(roundTrip(md).out1).toBe(md);
		data.text = '新标题';
		expect(serializeMdBody(tree, null)).toBe('- 新标题 ![[报告.pdf]]');
	});

	it('图片嵌入 ![[图.png]] 仍为节点图（不受附件分流影响）', () => {
		const { data } = firstChild('- ![[图.png]]\n');
		expect(data.image).toBe('图.png');
		expect(data.attachmentUrl).toBeUndefined();
		expect(data.mdEmbed).toBeUndefined();
	});

	it('Obsidian 可渲染但不在拖拽清单的图片格式（avif/tiff）仍按节点图处理', () => {
		expect(firstChild('- ![[图.avif]]\n').data.image).toBe('图.avif');
		expect(firstChild('- ![[扫描.tiff]]\n').data.image).toBe('扫描.tiff');
	});

	it('已知降级：非图片嵌入的标签（![[报告.pdf|资料]] / |300）在编辑文本后丢失（记录现状）', () => {
		// 附件通道在解析时 continue（不写 mdImageAlt/尺寸），合成侧因 mdEmbed 又不补别名 →
		// 未编辑时靠 mdRaw 逐字回写保真（见上），一旦编辑文本即丢标签。
		// 锁定现状：若附件通道改为保留标签，本用例应更新为「标签保留」。
		const alias = firstChild('- ![[报告.pdf|资料]]\n');
		expect(alias.data.mdEmbed).toBe(true);
		expect(roundTrip('- ![[报告.pdf|资料]]').out1, '未编辑：逐字回写').toBe(
			'- ![[报告.pdf|资料]]',
		);
		alias.data.text = '新标题';
		expect(serializeMdBody(alias.tree, null), '编辑后标签丢失').toBe(
			'- 新标题 ![[报告.pdf]]',
		);

		const sized = firstChild('- ![[报告.pdf|300]]\n');
		expect(sized.data.image).toBeUndefined();
		expect(roundTrip('- ![[报告.pdf|300]]').out1, '未编辑：逐字回写').toBe(
			'- ![[报告.pdf|300]]',
		);
		sized.data.text = '新标题';
		expect(serializeMdBody(sized.tree, null), '编辑后尺寸参数丢失').toBe(
			'- 新标题 ![[报告.pdf]]',
		);
	});

	it('裸 URL 与双链混排：首个链接 token 占 hyperlink，其余剥壳为文本', () => {
		const { data } = firstChild('- 对比 https://a.com 与 [[笔记B]]\n');
		expect(data.hyperlink, '位置在前的裸 URL 成为引擎单链').toBe('https://a.com');
		expect(data.text, 'URL 剥出后相邻空白折叠为单空格').toBe('对比 与 笔记B');
	});

	it('URL token 剥离后相邻空格折叠（多枚 URL 亦然）', () => {
		const { data } = firstChild('- a https://x.com b https://y.com c\n');
		expect(data.hyperlink).toBe('https://x.com');
		expect(data.text).toBe('a b c');
	});
});

// ---------------------------------------------------------------------------
// 九、图文/链接合成不丢 token（回归：图片引用曾被静默丢弃）
// ---------------------------------------------------------------------------
describe('图文/链接合成不丢 token', () => {
	it('图文 + 链接节点编辑文本：图片与链接都写回', () => {
		const { tree, data } = firstChild('- ![[a.png]] 见 [[笔记]]\n');
		data.text = '见图与笔记';
		// mdRaw 中图片特征在链接之前 → 输出顺序保持 图 → 链接
		expect(serializeMdBody(tree, null)).toBe(
			'- 见图与笔记 ![[a.png]] [[笔记]]',
		);
	});

	it('已有链接的节点插入图片：链接在前（mdRaw 顺序），图片追加在后', () => {
		const { tree, data } = firstChild('- 见 [[笔记]]\n');
		Object.assign(data, { image: 'a.png', mdImageTarget: 'a.png' });
		expect(serializeMdBody(tree, null)).toBe('- 见 笔记 ![[a.png]] [[笔记]]');
	});

	it('已有图片的节点插入链接：图片保留（链接字段新增后 rawOk 失败 → 两枚 token 都写出）', () => {
		const { tree, data } = firstChild('- ![[a.png]]\n');
		Object.assign(data, {
			mdWikiLinkpath: '[[笔记]]',
			mdLinkStyle: 'wiki',
			mdLinkText: '笔记',
		});
		expect(serializeMdBody(tree, null)).toBe('- ![[a.png]] [[笔记]]');
	});

	it('图文混合节点移除图片：文本与链接保留、图片剥离', () => {
		const { tree, data } = firstChild('- 标题 ![[a.png]]\n');
		data.image = null;
		const out = serializeMdBody(tree, null);
		expect(out).not.toContain('![[a.png]]');
		expect(out, '文字保留（图片独占的反向：节点仍有文本）').toBe('- 标题');
	});

	it('文本含同名串时插入图片：特征按嵌入语法边界匹配，仍写入 ![[..]]', () => {
		const { tree, data } = firstChild('- 图 a.png\n');
		Object.assign(data, { image: 'a.png', mdImageTarget: 'a.png' });
		expect(serializeMdBody(tree, null)).toBe('- 图 a.png ![[a.png]]');
	});

	it('文本含同名串时插入链接：特征按 [[..]] 边界匹配，仍写入双链', () => {
		const { tree, data } = firstChild('- 参见 note.md\n');
		Object.assign(data, {
			mdWikiLinkpath: '[[note]]',
			mdLinkStyle: 'wiki',
			mdLinkText: 'note',
		});
		expect(serializeMdBody(tree, null)).toBe('- 参见 note.md [[note]]');
	});
});

// ---------------------------------------------------------------------------
// 十、uid 修复（ensureUniqueUids：导入的 md/JSON 可能缺 uid 或 uid 重复）
// ---------------------------------------------------------------------------
describe('uid 修复（ensureUniqueUids）', () => {
	it('重复 uid 与缺失 uid 一并修复，修复后全树唯一', () => {
		const tree: MNode = {
			data: { text: 'a', uid: 'x' },
			children: [
				{ data: { text: 'b', uid: 'x' }, children: [] },
				{ data: { text: 'c' }, children: [] },
			],
		};
		expect(ensureUniqueUids(tree), '检测到重复/缺失并修复').toBe(true);
		const uids = collect(tree).map(({ node }) => node.data.uid);
		expect(new Set(uids).size, '全树 uid 唯一').toBe(3);
		expect(uids[0], '首个出现的 uid 视为有效，无需改动').toBe('x');
		// 重复的那个与缺失的那个都换成新生成的 uid（generateUid：tmm- + base36）
		expect(uids[1]).toMatch(/^tmm-[0-9a-z]+$/);
		expect(uids[2]).toMatch(/^tmm-[0-9a-z]+$/);
	});

	it('已全部唯一 → 返回 false 且 uid 原样不动', () => {
		const tree: MNode = {
			data: { text: 'a', uid: 'u1' },
			children: [{ data: { text: 'b', uid: 'u2' }, children: [] }],
		};
		expect(ensureUniqueUids(tree)).toBe(false);
		expect(collect(tree).map(({ node }) => node.data.uid)).toEqual(['u1', 'u2']);
	});

	it('data 缺失的节点补齐空数据（引擎按 uid 查找/删除依赖 data 存在）', () => {
		const tree = {
			data: undefined as unknown as MdData,
			children: [{ data: { text: 'b' }, children: [] }],
		} as MNode;
		expect(ensureUniqueUids(tree)).toBe(true);
		expect(tree.data.text, 'data 被补为 { text: "" }').toBe('');
		expect(typeof tree.data.uid).toBe('string');
	});
});

// ---------------------------------------------------------------------------
// 十一、视图状态（ViewStateStore：布局/视口/打开偏好存 data.json，不写入 md 正文）
// ---------------------------------------------------------------------------
describe('视图状态（ViewStateStore）', () => {
	const path = 'a/b.mindmap.md';

	it('hydrate(整个 data.json 对象) 生效：读取 viewState 子对象', () => {
		const store = new ViewStateStore(() => {}, 999999);
		store.hydrate({
			viewState: {
				[path]: { openAs: 'mindmap', layout: 'catalogOrganization' },
			},
		});
		expect(store.getOpenAs(path)).toBe('mindmap');
		expect(store.getLayout(path)).toBe('catalogOrganization');
		expect(store.getView(path), '未存的字段为 undefined').toBeUndefined();
	});

	it('hydrate(viewState 子对象) 不生效——锁定「必须传整个 data.json」契约', () => {
		const store = new ViewStateStore(() => {}, 999999);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// 误用形态 1：path → state 的映射（loadSettings 曾误传）→ 静默不加载
		store.hydrate({ [path]: { layout: 'mindmap' } });
		expect(store.getLayout(path), '不生效').toBeUndefined();
		// 误用形态 2：单个 PathState（顶层含 layout）→ 额外给防御告警
		const other = new ViewStateStore(() => {}, 999999);
		other.hydrate({ layout: 'mindmap' });
		expect(other.getLayout(path)).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('疑似收到 viewState 子对象'),
		);
		warn.mockRestore();
	});

	it('hydrate 形状校验：丢弃畸形条目，只保留含已知字段的对象', () => {
		const store = new ViewStateStore(() => {}, 999999);
		store.hydrate({
			viewState: {
				'dropped-string.mindmap.md': 'not-an-object',
				'dropped-null.mindmap.md': null,
				'dropped-unknown.mindmap.md': { foo: 1 },
				'kept-layout.mindmap.md': { layout: 'mindmap' },
				'kept-openas.mindmap.md': { openAs: 'markdown' },
				'kept-view.mindmap.md': { view: { transform: { scale: 1 } } },
			},
		});
		expect(Object.keys(store.serialize()).sort()).toEqual([
			'kept-layout.mindmap.md',
			'kept-openas.mindmap.md',
			'kept-view.mindmap.md',
		]);
		expect(store.getOpenAs('kept-layout.mindmap.md'), '缺 openAs → undefined').toBeUndefined();
		// 形状合法但取值非法：getLayout 的 typeof 收窄兜底
		store.hydrate({ viewState: { 'bad-value.mindmap.md': { layout: 42 } } });
		expect(store.getLayout('bad-value.mindmap.md')).toBeUndefined();
		expect(store.getOpenAs('kept-openas.mindmap.md'), '重新 hydrate 会清空旧状态').toBeUndefined();
		expect(store.getOpenAs('bad-value.mindmap.md'), '非法 openAs 取值被拒').toBeUndefined();
		expect(store.serialize()['bad-value.mindmap.md'], '条目本身仍保留（形状合法）').toEqual({
			layout: 42,
		});
	});

	it('setLayout/setOpenAs/setView 是补丁式合并，serialize 输出完整映射', () => {
		const store = new ViewStateStore(() => {}, 999999);
		store.setLayout(path, 'fishbone');
		store.setOpenAs(path, 'markdown');
		store.setView(path, { transform: { scale: 2 } });
		expect(store.serialize()).toEqual({
			[path]: {
				layout: 'fishbone',
				openAs: 'markdown',
				view: { transform: { scale: 2 } },
			},
		});
		expect(store.getOpenAs(path)).toBe('markdown');
	});

	it('renameKey 迁移状态键；removeKey 清理状态键', () => {
		const store = new ViewStateStore(() => {}, 999999);
		store.setLayout('old.mindmap.md', 'mindmap');
		store.renameKey('old.mindmap.md', 'new.mindmap.md');
		expect(store.getLayout('old.mindmap.md')).toBeUndefined();
		expect(store.getLayout('new.mindmap.md')).toBe('mindmap');
		// 不存在的键：renameKey/removeKey 都是 no-op
		store.renameKey('missing.mindmap.md', 'other.mindmap.md');
		expect(store.serialize()['other.mindmap.md']).toBeUndefined();
		store.removeKey('new.mindmap.md');
		expect(store.getLayout('new.mindmap.md')).toBeUndefined();
		expect(store.serialize()).toEqual({});
	});

	it('flushNow：有未决变更时排空并透传 persist，无变更时返回 undefined', async () => {
		const writes: Record<string, unknown>[] = [];
		const store = new ViewStateStore((state) => {
			writes.push(state);
			return Promise.resolve();
		}, 999999);
		store.setLayout(path, 'timeline');
		const pending = store.flushNow();
		expect(pending, '有未决变更 → 返回 Promise（卸载路径可持有在途写盘）').toBeInstanceOf(
			Promise,
		);
		await pending;
		expect(writes, 'persist 收到完整序列化状态').toEqual([
			{ [path]: { layout: 'timeline' } },
		]);
		expect(store.flushNow(), '无未决变更 → undefined').toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 十二、.mindmap.md 标记与新建正文（constants.ts 唯一实现 + markdown.ts 默认内容）
// ---------------------------------------------------------------------------
describe('.mindmap.md 标记与新建正文', () => {
	it.each([
		{ name: '标准后缀', input: '笔记.mindmap.md', marker: true },
		{ name: '大小写不敏感', input: 'NOTE.MINDMAP.MD', marker: true },
		{ name: '普通 md 不算', input: '笔记.md', marker: false },
		{ name: '后缀不在结尾不算', input: '笔记.mindmap.md.bak', marker: false },
		{ name: '目录名含标记不算（按整串结尾判定）', input: 'x.mindmap.md/笔记', marker: false },
	])('hasMindMapMarker：$name', ({ input, marker }) => {
		expect(hasMindMapMarker(input)).toBe(marker);
	});

	it.each([
		{ name: '剥离 stem 段', input: '笔记.mindmap', expected: '笔记' },
		{ name: '无标记原样', input: '笔记', expected: '笔记' },
		{ name: '完整后缀不在剥离范围（只剥 .mindmap 段）', input: '笔记.mindmap.md', expected: '笔记.mindmap.md' },
		{ name: '大小写不敏感', input: 'A.MINDMAP', expected: 'A' },
	])('stripMindMapStem：$name', ({ input, expected }) => {
		expect(stripMindMapStem(input)).toBe(expected);
	});

	it.each([
		{ name: '补全后缀', input: '笔记', expected: '笔记.mindmap.md' },
		{ name: '容忍只写 .mindmap', input: '笔记.mindmap', expected: '笔记.mindmap.md' },
		{ name: '已有完整后缀 → 幂等', input: '笔记.mindmap.md', expected: '笔记.mindmap.md' },
		{ name: '已有完整后缀（大写）→ 幂等', input: 'A.MINDMAP.MD', expected: 'A.MINDMAP.MD' },
	])('withMindMapMarker：$name', ({ input, expected }) => {
		expect(withMindMapMarker(input)).toBe(expected);
	});

	it('三个标记助手互相自洽：补标记后必然命中判定，剥 stem 可还原', () => {
		for (const stem of ['笔记', 'folder/笔记', '带 空格 的名字']) {
			const file = withMindMapMarker(stem);
			expect(hasMindMapMarker(file), `${file} 应命中标记判定`).toBe(true);
			expect(stripMindMapStem(file.replace(/\.md$/, ''))).toBe(stem);
		}
	});

	it('新建默认正文是标准 Markdown：解析为 3 个列表子主题且往返稳定', () => {
		const content = createDefaultMarkdownContent('zh');
		expect(content).toBe(
			[
				'- 示例：把想法拆成子节点',
				'- Tab：添加子节点',
				'- Enter：添加同级节点',
				'',
			].join('\n'),
		);
		const r = parseMdOutline(content, '根');
		expect(r.tree.children).toHaveLength(3);
		expect(r.tree.children.map((c) => (c.data as MdData).mdMarker)).toEqual([
			'-',
			'-',
			'-',
		]);
		// 文本行不带前导 '- '（标记由 mdMarker 承载）
		expect(r.tree.children.map((c) => c.data.text)).toEqual([
			'示例：把想法拆成子节点',
			'Tab：添加子节点',
			'Enter：添加同级节点',
		]);
		const out = serializeMdBody(r.tree, null);
		expect(out, '逐字回写（仅丢掉文件末尾的空行）').toBe(content.trimEnd());
		expect(serializeMdBody(parseMdOutline(out, '根').tree, null)).toBe(out);
	});

	it('默认文件名 + 标记拼接：思维导图YYYY-MM-DD.mindmap.md', () => {
		const name = buildDefaultMindMapName('zh', new Date(2026, 0, 5));
		expect(name).toBe('思维导图2026-01-05');
		const file = withMindMapMarker(name);
		expect(file).toBe('思维导图2026-01-05.mindmap.md');
		expect(hasMindMapMarker(file)).toBe(true);
		expect(stripMindMapStem(file.replace(/\.md$/, ''))).toBe(name);
	});
});
