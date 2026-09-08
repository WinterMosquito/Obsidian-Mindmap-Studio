/**
 * Markdown ⇄ mindmap 往返回归测试（.mindmap.md 渲染层）。
 *
 * 覆盖（对应 docs/markdown-mindmap-standard.md），按场景矩阵组织：
 * - 解析结构：标题/列表/段落/围栏/frontmatter 的树映射
 * - 层级深度：标题跳级、6 级标题下列表降级、深层列表
 * - 往返不动点：parse → serialize → parse → serialize 输出稳定，
 *   未编辑行（含 [[]]/![]/代码围栏）逐字保留
 * - 编辑合成：用户改文本/换图后按节点合成新行、未触碰行保持原文
 * - rawOk 分支矩阵：链接清除/新增/换链不残留、编辑多行保留链接 token
 * - 健壮性回归：深树无栈溢出（显式栈）、代码围栏不被解析成标题/列表
 *
 * （2026-09 结构调整：由单 test() 内嵌软断言改为 describe/it 场景矩阵——
 * 失败定位粒度从「文件级」细化到「场景级」，且单场景失败不再中断其余场景。
 * 断言语义与原版逐一对应，未增删。）
 *
 * 运行：npm test
 */
import { describe, expect, it } from 'vitest';
import { parseMdOutline } from '../src/md-outline';
import { serializeMdBody } from '../src/md-serialize';
import { ensureUniqueUids } from '../src/markdown';
import { ViewStateStore } from '../src/view-state';

type MNode = { data?: Record<string, unknown>; children?: MNode[] };

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 所有节点（含虚拟根）的 {data, depth} 先序列表 */
function collect(root: MNode): { node: MNode; depth: number }[] {
	const out: { node: MNode; depth: number }[] = [];
	const walk = (n: MNode, d: number): void => {
		out.push({ node: n, depth: d });
		for (const c of n.children ?? []) walk(c, d + 1);
	};
	walk(root, 0);
	return out;
}

function textsOf(n: MNode): string[] {
	return collect(n).map(({ node }) =>
		typeof node.data?.text === 'string' ? node.data.text : '',
	);
}

function hasNode(n: MNode, pred: (data: Record<string, unknown>) => boolean): boolean {
	return collect(n).some(({ node }) => pred(node.data ?? {}));
}

const roundTrip = (md: string): { mdRaw: string; md2: string } => {
	const first = parseMdOutline(md, '测试');
	const out1 = serializeMdBody(first.tree, null);
	const second = parseMdOutline(out1, '测试');
	const out2 = serializeMdBody(second.tree, null);
	return { mdRaw: out1, md2: out2 };
};

// ---------------------------------------------------------------------------
// 一、解析结构
// ---------------------------------------------------------------------------
describe('解析结构', () => {
	it('标题/列表/段落/围栏映射（综合文档）', () => {
		const md = ['# 一级', '## 二级', '### 三级', '', '- a', '  - a1', '', '正文段落。', '', '```', '# 代码里的标题', '- 代码里的列表', '```'].join('\n');
		const r = parseMdOutline(md, '根');
		expect(r.frontmatter, '无 frontmatter').toBeNull();
		const list = collect(r.tree);
		expect(list[0]!.node.data?.text, '虚拟根文本 = 文件名').toBe('根');
		// 标题链：根 → 一级 → 二级 → 三级
		const h1 = r.tree.children[0]!;
		expect(h1.data?.mdType, '第一个节点为 heading').toBe('heading');
		expect(h1.data?.mdLevel, '# → level 1').toBe(1);
		expect(h1.children[0]!.data?.mdLevel, '## → level 2').toBe(2);
		expect(h1.children[0]!.children[0]!.data?.mdLevel, '### → level 3').toBe(3);
		// 三级下的列表
		const h3 = h1.children[0]!.children[0]!;
		expect(h3.children.length >= 1, '三级标题下有内容').toBe(true);
		const li = h3.children[0]!;
		expect(li.data?.mdType, '列表项 mdType=list').toBe('list');
		expect(li.data?.mdMarker, '无序标记 -').toBe('-');
		expect(li.children[0]!.data?.text, '嵌套子列表 a1').toBe('a1');
		// 段落
		const plainNodes = collect(r.tree).filter(({ node }) => node.data?.mdType === 'plain');
		expect(plainNodes.length >= 1, '存在 plain 段落节点').toBe(true);
		expect(textsOf(r.tree).some((t) => t.includes('正文段落')), '段落文本在树中').toBe(true);
		// 围栏：内部 #/- 不得成为 heading/list 节点
		expect(
			!hasNode(r.tree, (d) => d.mdType === 'heading' && d.text === '# 代码里的标题'),
			'围栏内 # 行不是 heading 节点',
		).toBe(true);
		expect(
			!hasNode(r.tree, (d) => d.mdType === 'list' && d.text === '- 代码里的列表'),
			'围栏内 - 行不是 list 节点',
		).toBe(true);
	});

	it('两个同级 # 都挂在虚拟根下（多根拍平）', () => {
		const r = parseMdOutline('# A\n\n# B\n', '根');
		expect(r.tree.children.length, '两个一级标题同挂虚拟根').toBe(2);
		expect(r.tree.children[1]!.data?.text, '第二个根为 B').toBe('B');
	});

	it('跳级标题按祖先链建层，mdLevel 保留原始 # 数', () => {
		const r = parseMdOutline('# X\n\n### Y\n', '根');
		const x = r.tree.children[0]!;
		expect(
			x.children.length === 1 && x.children[0]!.data?.text === 'Y',
			'跳级标题挂到 X 下',
		).toBe(true);
		expect(x.children[0]!.data?.mdLevel, '跳级保留原始 # 数量 3').toBe(3);
	});

	it('frontmatter 原样切出，不进入导图树', () => {
		const fm = '---\ntitle: 测试\ntags: [a, b]\n---\n\n# 正文\n';
		const r = parseMdOutline(fm, '根');
		expect(r.frontmatter, 'frontmatter 原样保留').toBe('---\ntitle: 测试\ntags: [a, b]\n---\n');
		expect(r.tree.children.length, 'frontmatter 不产生节点').toBe(1);
		expect(r.tree.children[0]!.data?.text, '正文标题进入树').toBe('正文');
	});

	it('分隔线与空行忽略；纯列表文档直接挂虚拟根', () => {
		const r = parseMdOutline('- 一\n\n---\n\n- 二\n', '根');
		expect(r.tree.children.length, '空行/--- 不产生节点').toBe(2);
		expect(r.tree.children[0]!.data?.text, '纯列表：根 → 一').toBe('一');
	});

	it('行内 [[]]/![]/**bold** 未编辑往返保留（mdRaw）', () => {
		const md = ['# [[笔记|别名]] 与 **粗体**', '', '- ![[图.png]]', '- 普通 [链接](https://example.com)'].join('\n');
		const r = parseMdOutline(md, '根');
		const { mdRaw } = roundTrip(md);
		expect(mdRaw.includes('# [[笔记|别名]] 与 **粗体**'), '标题 [[..|别名]] 往返保留').toBe(true);
		expect(mdRaw.includes('- ![[图.png]]'), '列表 ![[图]] 往返保留').toBe(true);
		expect(mdRaw.includes('[链接](https://example.com)'), '列表 md 链接往返保留').toBe(true);
		expect(
			!mdRaw.includes('[[') || hasNode(r.tree, (d) => typeof d.hyperlink === 'string'),
			'wikilink 有 hyperlink 承载',
		).toBe(true);
	});

	it('[t](<url>) 解析剥壳与不动点（无双层尖括号）', () => {
		const md = ['- [文本](<https://example.com>)'].join('\n');
		const r = parseMdOutline(md, '根');
		const li = r.tree.children[0]!;
		expect(li.data?.hyperlink, '解析时剥去 [..](<url>) 的外层尖括号').toBe('https://example.com');
		expect(li.data?.mdLinkStyle, 'md 链接样式').toBe('md');
		expect(li.data?.text, '可见文本为标签').toBe('文本');
		const out = serializeMdBody(r.tree, null);
		expect(out.includes('[文本](<https://example.com>)'), '未编辑的 md 链接按原文回写').toBe(true);
		const out2 = serializeMdBody(parseMdOutline(out, '根').tree, null);
		expect(out2, 'md 链接往返不动点（无双层尖括号）').toBe(out);
	});

	it('裸 autolink <url>：解析为链接、不渲染 URL 文本、不动点', () => {
		const md = ['- <https://example.com>'].join('\n');
		const r = parseMdOutline(md, '根');
		expect(r.tree.children[0]!.data?.hyperlink, '解析 <url> 自动链接为超链接').toBe('https://example.com');
		expect(r.tree.children[0]!.data?.text, '节点不渲染 URL 文本（仅图标）').toBe('');
		const out = serializeMdBody(r.tree, null);
		expect(out.includes('<https://example.com>'), 'autolink 回写为 <url>').toBe(true);
		const out2 = serializeMdBody(parseMdOutline(out, '根').tree, null);
		expect(out2, 'autolink 往返不动点').toBe(out);
	});

	it('label 本身是 URL 的 md 链接：节点文本不含 URL（icon-only），不动点', () => {
		const url = 'https://example.com/a/very/long/path';
		const md = `- [${url}](${url})`;
		const r = parseMdOutline(md, '测试');
		const li = r.tree.children[0]!;
		expect(li.data?.hyperlink, '解析 URL-label 链接为超链接').toBe(url);
		expect(li.data?.text, 'URL 本体不进节点文本（icon-only，不撑宽节点）').toBe('');
		const { mdRaw, md2 } = roundTrip(md);
		expect(mdRaw.includes(`[${url}](${url})`), '未编辑按原文回写').toBe(true);
		expect(md2).toBe(mdRaw);
	});

	it('新插入 URL 链接（引擎节点，无 mdRaw）回写 <url>', () => {
		const tree = parseMdOutline('# R\n', '根').tree;
		tree.children[0]!.children.push({
			data: { text: '', hyperlink: 'https://example.com' },
			children: [],
		});
		const out = serializeMdBody(tree, null);
		expect(out.includes('- <https://example.com>'), '新插入的 URL 回写为 <url>').toBe(true);
		expect(!out.includes('<<'), '无双层尖括号').toBe(true);
	});

	it('非 URL 的 md 链接（相对路径）不加尖括号', () => {
		const md = ['- [笔记](folder/note.md)'].join('\n');
		const r = parseMdOutline(md, '根');
		expect(r.tree.children[0]!.data?.hyperlink, '相对路径非 URL').toBe('folder/note.md');
		const out = serializeMdBody(r.tree, null);
		expect(out.includes('[笔记](folder/note.md)'), '非 URL 的 md 链接不加尖括号').toBe(true);
	});

	it('解析 [..](<目标含空格>) 剥壳，未编辑按原文回写', () => {
		const md = ['- [笔记](<folder/my note.md>)'].join('\n');
		const r = parseMdOutline(md, '根');
		expect(r.tree.children[0]!.data?.hyperlink, '解析 <目标含空格>（尖括号内可含空格）').toBe('folder/my note.md');
		expect(r.tree.children[0]!.data?.text, '标签为节点文本').toBe('笔记');
		const out = serializeMdBody(r.tree, null);
		expect(out.includes('[笔记](<folder/my note.md>)'), '含空格目标未编辑按原文回写').toBe(true);
	});

	it('合成：含空格目标用尖括号包裹', () => {
		const t1 = parseMdOutline('# R\n', '根').tree;
		t1.children[0]!.children.push({
			data: { text: '笔记', hyperlink: 'folder/my note.md', mdLinkStyle: 'md', mdLinkText: '笔记' },
			children: [],
		});
		const o1 = serializeMdBody(t1, null);
		expect(o1.includes('[笔记](<folder/my note.md>)'), '合成：含空格目标用尖括号包裹').toBe(true);
	});

	it('合成：含括号目标用尖括号包裹，且可解析回', () => {
		const t2 = parseMdOutline('# R\n', '根').tree;
		t2.children[0]!.children.push({
			data: { text: '笔记', hyperlink: 'folder/a(b).md', mdLinkStyle: 'md', mdLinkText: '笔记' },
			children: [],
		});
		const o2 = serializeMdBody(t2, null);
		expect(o2.includes('[笔记](<folder/a(b).md>)'), '合成：含括号目标用尖括号包裹').toBe(true);
		const rp = parseMdOutline(o2, '根');
		expect(rp.tree.children[0]!.children[0]!.data?.hyperlink, '合成后的含括号目标可解析回').toBe('folder/a(b).md');
	});

	it('段落行内 [[]]/[](url)/轻标记 未编辑逐字回写', () => {
		const md = ['# H', '', '参见 [[设计稿|设计]] 与 [仓库](https://example.com) 说明', '', '另段含 **粗体** 与 [[普通链接]]。'].join('\n');
		const { mdRaw } = roundTrip(md);
		expect(
			mdRaw.includes('参见 [[设计稿|设计]] 与 [仓库](https://example.com) 说明'),
			'段落内 [[]] 与 [](url) 未编辑逐字回写',
		).toBe(true);
		expect(mdRaw.includes('另段含 **粗体** 与 [[普通链接]]。'), '段落轻标记与双链逐字回写').toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 二、层级深度
// ---------------------------------------------------------------------------
describe('层级深度', () => {
	it('标题 1–6 级链；6 级下用列表缩进表达第 7 级', () => {
		// 6 级标题逐级加深
		const md = ['# h1', '## h2', '### h3', '#### h4', '##### h5', '###### h6'].join('\n');
		const r = parseMdOutline(md, '根');
		const levels: (number | undefined)[] = [];
		const walk = (n: MNode, depth: number): void => {
			if (depth > 0) levels.push(n.data?.mdLevel as number | undefined);
			for (const c of n.children ?? []) walk(c, depth + 1);
		};
		walk(r.tree, 0);
		expect(levels.join(','), '标题 1–6 级链').toBe('1,2,3,4,5,6');

		// 6 级标题下用列表缩进表达第 7 级（列表缩进降级法）
		const deep = parseMdOutline(['###### base', '', '  - level7'].join('\n'), '根');
		const base = deep.tree.children[0]!;
		expect(base.children.length === 1, '###### 下挂列表').toBe(true);
		expect(base.children[0]!.data?.text, '第 7 级文本正确').toBe('level7');
	});

	it('深层列表（50 级）解析深度与序列化', () => {
		const depth = 50;
		const lines = ['# 深', ''];
		for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + '- l' + i);
		const r = parseMdOutline(lines.join('\n'), '根');
		const maxDepth = Math.max(...collect(r.tree).map((e) => e.depth));
		expect(maxDepth >= depth + 1, `深层列表深度保留（max=${maxDepth}）`).toBe(true);
		const out = serializeMdBody(r.tree, null);
		expect(out.includes('- l' + (depth - 1)), '深层列表可序列化').toBe(true);
	});

	it('5 万级深树：uid 修复 + 序列化无栈溢出（显式栈回归）', () => {
		const depth = 50000;
		let chain: MNode = { data: { text: 'deep0' } };
		let cursor = chain;
		for (let i = 1; i < depth; i++) {
			const next: MNode = { data: { text: 'deep' + i, mdType: 'heading', mdLevel: 1 } };
			cursor.children = [next];
			cursor = next;
		}
		let ok = false;
		try {
			ensureUniqueUids(chain as never);
			const out = serializeMdBody(chain as never, null);
			ok = out.length > 0;
		} catch {
			ok = false;
		}
		expect(ok, '5 万级深树：uid 修复 + 序列化无栈溢出').toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 三、往返不动点
// ---------------------------------------------------------------------------
describe('往返不动点', () => {
	it('综合文档（标题+嵌套列表+段落+围栏+有序列表）：二次往返不动点', () => {
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
		const { mdRaw, md2 } = roundTrip(md);
		expect(md2, '综合文档：二次往返不动点').toBe(mdRaw);
		expect(mdRaw.includes('```ts'), '围栏起始保留').toBe(true);
		expect(mdRaw.includes('const x = 1; // code'), '围栏代码行保留').toBe(true);
		expect(mdRaw.includes('# 主题'), '标题保留').toBe(true);
		expect(mdRaw.includes('- 子项 2'), '嵌套列表保留').toBe(true);
		expect(mdRaw.includes('1. 序一') && mdRaw.includes('2. 序二'), '有序列表重排稳定').toBe(true);
	});

	it('围栏相邻空行稳定：每趟不多行', () => {
		const md = ['# 顶', '', '前文。', '', '```', 'code', '```', '', '- 后置'].join('\n');
		const { mdRaw, md2 } = roundTrip(md);
		expect(md2, '围栏相邻空行：往返不动点').toBe(mdRaw);
		const blankCount = mdRaw.split('\n').filter((l) => l === '').length;
		expect(blankCount >= 2 && blankCount <= 4, `空行数量稳定（${blankCount}）`).toBe(true);
	});

	it('未编辑行（wikilink/图片/轻标记）逐字回写', () => {
		const md = ['# H', '', '- [[目标|显示名]]', '- ![[img.png]]', '- **加粗**项'].join('\n');
		const { mdRaw } = roundTrip(md);
		expect(mdRaw.includes('- [[目标|显示名]]'), 'wikilink 行逐字回写').toBe(true);
		expect(mdRaw.includes('- ![[img.png]]'), '图片行逐字回写').toBe(true);
		expect(mdRaw.includes('- **加粗**项'), '轻标记行逐字回写').toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 四、编辑合成
// ---------------------------------------------------------------------------
describe('编辑合成', () => {
	it('编辑列表项文本：该行合成，未编辑行保持原文', () => {
		const md = ['# R', '', '- 原样一', '- 修改我'].join('\n');
		const tree = parseMdOutline(md, '根').tree;
		const target = tree.children[0]!.children.find((c) => c.data?.text === '修改我')!;
		target.data.text = '改成了';
		const out = serializeMdBody(tree, null);
		expect(out.includes('- 原样一'), '未编辑项原样保留').toBe(true);
		expect(out.includes('- 改成了'), '编辑项合成新文本').toBe(true);
		expect(!out.includes('修改我'), '旧文本被替换').toBe(true);
	});

	it('编辑标题文本：# 新标题', () => {
		const tree = parseMdOutline('# 旧标题\n', '根').tree;
		tree.children[0]!.data.text = '新标题';
		const out = serializeMdBody(tree, null);
		expect(out.includes('# 新标题'), '编辑后的标题行合成').toBe(true);
	});

	it('新建节点（无 mdType/mdRaw）按列表行输出', () => {
		const tree = parseMdOutline('# R\n', '根').tree;
		tree.children[0]!.children.push({ data: { text: '新节点' }, children: [] });
		const out = serializeMdBody(tree, null);
		expect(out.includes('- 新节点'), '新建节点按列表行输出').toBe(true);
	});

	it('换图后合成外链图片，旧图引用不残留', () => {
		const tree = parseMdOutline('- ![[old.png]]\n', '根').tree;
		const node = tree.children[0]!;
		node.data.image = 'https://example.com/new.png';
		const out = serializeMdBody(tree, null);
		expect(out.includes('![](https://example.com/new.png)'), '换图后合成为外链图片').toBe(true);
		expect(!out.includes('old.png'), '旧图引用不残留').toBe(true);
	});

	it('深层列表（40 级）叶子编辑可合成', () => {
		const depth = 40;
		const lines = ['# 深', ''];
		for (let i = 0; i < depth; i++) lines.push('  '.repeat(i) + '- l' + i);
		const tree = parseMdOutline(lines.join('\n'), '根').tree;
		const findLeaf = (n: MNode): MNode =>
			n.children?.length ? findLeaf(n.children[n.children.length - 1]!) : n;
		findLeaf(tree).data!.text = '已编辑';
		const out = serializeMdBody(tree, null);
		expect(out.includes('- 已编辑'), '深层叶子编辑可合成').toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 五、uid 修复（ensureUniqueUids）
// ---------------------------------------------------------------------------
describe('uid 修复（ensureUniqueUids）', () => {
	it('重复/缺失 uid 修复后全树唯一', () => {
		const dup: MNode = {
			data: { text: 'a', uid: 'x' },
			children: [{ data: { text: 'b', uid: 'x' } }, { data: { text: 'c' } }],
		};
		const changed = ensureUniqueUids(dup as never);
		expect(changed, '检测到重复/缺失 uid 并修复').toBe(true);
		const seen = new Set<string>();
		const walk = (n: MNode): void => {
			if (typeof n.data?.uid === 'string') seen.add(n.data.uid);
			for (const c of n.children ?? []) walk(c);
		};
		walk(dup);
		expect(seen.size, '全部节点 uid 唯一').toBe(3);
	});
});

// ---------------------------------------------------------------------------
// 视图状态 hydration（回归：hydrate 期望「整个 data.json 对象」，而非 viewState 值）
// ---------------------------------------------------------------------------
describe('视图状态 hydration', () => {
	it('hydrate(整个 data.json 对象) 生效；hydrate(viewState 值对象) 不生效（防误用契约）', () => {
		const store = new ViewStateStore(() => {}, 999999);
		// 正确用法：传整个对象（内部读取 data['viewState']）
		store.hydrate({
			viewState: {
				'a/b.mindmap.md': {
					openAs: 'mindmap',
					layout: 'catalogOrganization',
				},
			},
		});
		expect(store.getOpenAs('a/b.mindmap.md'), 'hydrate(整个对象)：读 openAs').toBe('mindmap');
		expect(
			store.getLayout('a/b.mindmap.md'),
			'hydrate(整个对象)：读 layout',
		).toBe('catalogOrganization');
		// 错误用法：直接传 viewState 值对象（loadSettings 曾误传）→ 不生效（锁定契约）
		const wrong = new ViewStateStore(() => {}, 999999);
		wrong.hydrate({
			'a/b.mindmap.md': { openAs: 'mindmap', layout: 'catalogOrganization' },
		});
		expect(
			wrong.getOpenAs('a/b.mindmap.md'),
			'hydrate(viewState 值对象) 不生效——防止误用',
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// 六、图片独占节点（纯图行 text 为空；删文字后图片独占并可往返保持）
// ---------------------------------------------------------------------------
describe('图片独占节点', () => {
	it('纯图行解析为无文本节点（不回退文件名）', () => {
		const r = parseMdOutline('- ![[图.png]]\n', '根');
		const li = r.tree.children[0]!;
		expect(li.data?.image, '图片字段指向目标').toBe('图.png');
		expect(li.data?.text, '纯图节点文本为空（图片独占）').toBe('');
		expect(li.data?.mdDerivedText, 'mdDerivedText 与 text 一致').toBe('');
	});

	it('纯图行往返不动点（逐字回写）', () => {
		const md = ['# 顶', '', '- ![[图.png]]', '- ![[另一个.png]] 标注'].join('\n');
		const { mdRaw, md2 } = roundTrip(md);
		expect(md2, '二次往返不动点').toBe(mdRaw);
		expect(mdRaw.includes('- ![[图.png]]'), '纯图行逐字保留').toBe(true);
		expect(mdRaw.includes('- ![[另一个.png]] 标注'), '图文混合行逐字保留').toBe(true);
	});

	it('混合节点删除文字后合成纯图行（图片独占）', () => {
		const tree = parseMdOutline('- ![[a.png]] 说明文字\n', '根').tree;
		const li = tree.children[0]!;
		expect(li.data?.text, '解析：混合节点有文本').toBe('说明文字');
		li.data.text = ''; // 用户删除全部文字（编辑文本/移除文字语义）
		const out = serializeMdBody(tree, null);
		expect(out.includes('- ![[a.png]]'), '删文字后整行只含图片 token').toBe(true);
		expect(!out.includes('说明文字'), '旧文本不残留').toBe(true);
		// 再解析 → 图片独占节点（text 为空），往返稳定
		const reparsed = parseMdOutline(out, '根');
		expect(reparsed.tree.children[0]!.data?.text, '再解析仍为图片独占节点').toBe('');
		expect(serializeMdBody(reparsed.tree, null), '合成结果往返不动点').toBe(out);
	});

	it('图片独占节点重新加文字 → 合成图文混合行', () => {
		const tree = parseMdOutline('- ![[a.png]]\n', '根').tree;
		const li = tree.children[0]!;
		expect(li.data?.text, '初始为图片独占').toBe('');
		li.data.text = '补个标题';
		const out = serializeMdBody(tree, null);
		expect(out.includes('- 补个标题 ![[a.png]]'), '加文字后合成为图文混合行').toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 七、嵌入尺寸参数（Obsidian 官方语法：![[图|300]] / ![[图|300x150]] /
// ![alt|300](url)，见官方帮助 Embed files / Basic formatting syntax）
// ---------------------------------------------------------------------------
describe('嵌入尺寸参数', () => {
	it('解析：wiki 嵌入的宽度/宽高参数进入元数据', () => {
		const r = parseMdOutline(['- ![[a.png|300]]', '- ![[b.png|300x150]]'].join('\n'), '根');
		const a = r.tree.children[0]!;
		const b = r.tree.children[1]!;
		expect(a.data?.mdImageWidth, '仅宽：mdImageWidth').toBe(300);
		expect(a.data?.mdImageHeight, '仅宽：无高度参数').toBeUndefined();
		expect(b.data?.mdImageWidth, '宽高：mdImageWidth').toBe(300);
		expect(b.data?.mdImageHeight, '宽高：mdImageHeight').toBe(150);
		// 纯图节点语义不受影响
		expect(a.data?.text, '纯图行仍为图片独占').toBe('');
	});

	it('解析：外链 md 图片的标签尾部尺寸（![alt|300](url) / ![250](url)）', () => {
		const r = parseMdOutline(
			['- ![截图|300](https://x.com/a.png)', '- ![250](https://x.com/b.png)'].join('\n'),
			'根',
		);
		const a = r.tree.children[0]!;
		const b = r.tree.children[1]!;
		expect(a.data?.mdImageWidth, 'alt|宽 形式').toBe(300);
		expect(a.data?.mdImageHeight).toBeUndefined();
		expect(a.data?.text, 'alt 不作为节点文本（首图）').toBe('');
		expect(b.data?.mdImageWidth, '整段标签为尺寸形式').toBe(250);
	});

	it('带尺寸行未编辑逐字回写（含宽高形式）', () => {
		const md = ['# 顶', '', '- ![[a.png|300]]', '- ![[b.png|300x150]]'].join('\n');
		const { mdRaw, md2 } = roundTrip(md);
		expect(md2, '二次往返不动点').toBe(mdRaw);
		expect(mdRaw.includes('- ![[a.png|300]]'), '仅宽参数逐字保留').toBe(true);
		expect(mdRaw.includes('- ![[b.png|300x150]]'), '宽高参数逐字保留').toBe(true);
	});

	it('拖拽调宽后合成回写 |宽度（原无参数）', () => {
		const tree = parseMdOutline('- ![[a.png]]\n', '根').tree;
		const li = tree.children[0]!;
		// 拖拽调宽的引擎侧效果：imageSize custom
		li.data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out.includes('- ![[a.png|250]]'), '合成行携带官方宽度参数').toBe(true);
		// 再解析 → 参数进入元数据，往返稳定
		const reparsed = parseMdOutline(out, '根');
		expect(reparsed.tree.children[0]!.data?.mdImageWidth).toBe(250);
		expect(serializeMdBody(reparsed.tree, null), '带参合成结果往返不动点').toBe(out);
	});

	it('拖拽调宽后更新已有宽度参数（|300 → |250）', () => {
		const tree = parseMdOutline('- ![[a.png|300]]\n', '根').tree;
		const li = tree.children[0]!;
		expect(li.data?.mdImageWidth, '原参数被解析').toBe(300);
		li.data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out.includes('- ![[a.png|250]]'), '新宽度合成回写').toBe(true);
		expect(!out.includes('|300'), '旧宽度不残留').toBe(true);
	});

	it('宽度参数前缀不受 |30 vs |300 混淆（终界检查）', () => {
		const tree = parseMdOutline('- ![[a.png|300x150]]\n', '根').tree;
		const li = tree.children[0]!;
		// 调到 30：特征 |30 不得误匹配 |300x 前缀而逐字回写旧尺寸。
		// 源行有显式高度（300x150）→ 回写保留双参数形态 |30x15（高度不丢）
		li.data.imageSize = { width: 30, height: 15, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out.includes('- ![[a.png|30x15]]'), '新宽高正确合成').toBe(true);
		expect(!out.includes('300'), '旧宽高参数不残留').toBe(true);
	});

	it('显式高度只随源行回写：仅宽参数源行不凭空补高度', () => {
		const tree = parseMdOutline('- ![[a.png|300]]\n', '根').tree;
		const li = tree.children[0]!;
		expect(li.data?.mdImageHeight, '仅宽源行无显式高度').toBeUndefined();
		li.data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out.includes('- ![[a.png|250]]'), '维持仅宽（等比）形态').toBe(true);
		expect(!out.includes('x125'), '不凭空补高度').toBe(true);
	});

	it('图文混合节点调宽：文本与尺寸参数同时保留', () => {
		const tree = parseMdOutline('- 标注 ![[a.png|300]]\n', '根').tree;
		const li = tree.children[0]!;
		expect(li.data?.text, '混合节点文本').toBe('标注');
		li.data.imageSize = { width: 250, height: 125, custom: true };
		const out = serializeMdBody(tree, null);
		expect(out.includes('- 标注 ![[a.png|250]]'), '文本与新尺寸合成').toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 八、rawOk「未编辑检测」分支矩阵（md-serialize）：
// 数据无损性核心启发式——文本判定（text === mdDerivedText）、图片判定
// （特征在 mdRaw）、链接判定（新增/更新/清除走合成；plain 豁免）
// ---------------------------------------------------------------------------
describe('rawOk 未编辑检测分支矩阵', () => {
	it('① 链接清除：mdRaw 不原样回写（旧链接不复活），保留纯文本标题', () => {
		const tree = parseMdOutline('# [[旧目标]] 标题\n', '根').tree;
		const h = tree.children[0]!;
		expect(h.data?.text, '解析：wikilink 剥壳，显示名并入节点文本').toBe('旧目标 标题');
		delete h.data.hyperlink; // 用户清除链接（clearNodeHyperlink 语义：两通道一并清除）
		delete h.data.mdWikiLinkpath;
		const out = serializeMdBody(tree, null);
		expect(!out.includes('[['), '链接清除后 mdRaw 不原样回写（旧链接不复活）').toBe(true);
		expect(out.includes('# 旧目标 标题'), '清除链接后保留纯文本标题').toBe(true);
	});

	it('② 有 mdRaw 的节点新增链接：走合成回写（mdRaw 原样覆盖会丢链接）', () => {
		const tree = parseMdOutline('- 纯文本项\n', '根').tree;
		const li = tree.children[0]!;
		li.data.hyperlink = '[[新目标]]';
		const out = serializeMdBody(tree, null);
		expect(out.includes('[[新目标]]'), '新增链接走合成回写（mdRaw 原样覆盖会丢链接）').toBe(true);
		expect(out.includes('纯文本项'), '合成行保留节点文本').toBe(true);
	});

	it('③ 换链 + 可见文本同步：纯 token 节点不残留旧目标与旧显示名', () => {
		const tree = parseMdOutline('- [[旧目标|别名]]\n', '根').tree;
		const li = tree.children[0]!;
		li.data.hyperlink = '[[新目标]]';
		li.data.text = '新目标';
		const out = serializeMdBody(tree, null);
		expect(out.includes('- [[新目标]]'), '换链后纯 token 节点只输出新链接').toBe(true);
		expect(
			!out.includes('旧目标') && !out.includes('别名'),
			'旧目标与旧显示名不残留',
		).toBe(true);
	});

	it('④ 编辑多行文本：合成首行保留链接 token、续行输出', () => {
		const tree = parseMdOutline('- [[目标|别名]] 说明\n', '根').tree;
		const li = tree.children[0]!;
		li.data.text = '别名 说明\n第二行';
		const out = serializeMdBody(tree, null);
		expect(out.includes('- 别名 说明 [[目标|别名]]'), '编辑文本后合成首行保留链接 token').toBe(true);
		expect(out.includes('第二行'), '多行文本续行输出').toBe(true);
	});
	// （plain 段落的 rawOk 豁免——mdRaw 含 [[..]] 但 hyperlink 恒空 → 逐字回写——
	//  已由「段落行内 [[]]/[](url)/轻标记 未编辑逐字回写」用例锁定。）
});

// ---------------------------------------------------------------------------
// URL icon-only 与附件链接（双链指向附件走 attachmentUrl 通道）
// ---------------------------------------------------------------------------

describe('URL icon-only 与附件链接', () => {
	it('裸 URL 行解析：URL 不进节点文本，hyperlink 指向 URL（icon-only）', () => {
		const r = parseMdOutline('- API https://platform.example.com/usage', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.hyperlink).toBe('https://platform.example.com/usage');
		expect(node.data?.text).toBe('API');
		expect(node.data?.hyperlinkTitle).toBe(
			'https://platform.example.com/usage',
		);
	});

	it('裸 URL 行未编辑 → 逐字回写原文', () => {
		const { mdRaw } = roundTrip('- API https://platform.example.com/usage');
		expect(mdRaw).toBe('- API https://platform.example.com/usage');
	});

	it('<url> 尖括号形态与裸 URL 同语义（icon-only，回写 <url>）', () => {
		const r = parseMdOutline('- <https://x.com/a>', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.hyperlink).toBe('https://x.com/a');
		expect(node.data?.text).toBe('');
		const { mdRaw } = roundTrip('- <https://x.com/a>');
		expect(mdRaw).toBe('- <https://x.com/a>');
	});

	it('双链附件：走 attachmentUrl 通道（回形针），hyperlink 缺席，文本保留文件名', () => {
		const r = parseMdOutline('- [[报告.pdf]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.attachmentUrl).toBe('报告.pdf');
		expect(node.data?.attachmentName).toBe('报告.pdf');
		expect(node.data?.mdAttachmentLinkpath).toBe('报告.pdf');
		expect(node.data?.hyperlink).toBeUndefined();
		expect(node.data?.text).toBe('报告.pdf');
	});

	it('双链附件别名：attachmentName 取别名', () => {
		const r = parseMdOutline('- [[报告.pdf|资料]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.attachmentUrl).toBe('报告.pdf');
		expect(node.data?.attachmentName).toBe('资料');
	});

	it('双链附件未编辑 → 逐字回写原文', () => {
		const { mdRaw } = roundTrip('- [[报告.pdf|资料]]');
		expect(mdRaw).toBe('- [[报告.pdf|资料]]');
	});

	it('双链附件编辑文本后合成：重建 wikilink 并保留别名', () => {
		const first = parseMdOutline('- [[报告.pdf|资料]]', '根');
		const node = collect(first.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		// 模拟用户编辑：文本改变 → rawOk 失败 → 合成路径
		node.data!.text = '新标题';
		const out = serializeMdBody(first.tree, null);
		// 别名是链接自身语义（Obsidian `[[目标|别名]]`），编辑节点文本不应丢弃
		expect(out).toBe('- 新标题 [[报告.pdf|资料]]');
	});

	it('双链附件无别名：合成不凭空补别名', () => {
		const r = parseMdOutline('- [[报告.pdf]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		node.data!.text = '新标题';
		expect(serializeMdBody(r.tree, null)).toBe('- 新标题 [[报告.pdf]]');
	});

	it('非图片嵌入 ![[报告.pdf]] → 走附件通道（不当作节点图，往返保留 !）', () => {
		const r = parseMdOutline('- ![[报告.pdf]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.image, '不写 image（否则引擎按图片渲染 → 空白）').toBeUndefined();
		expect(node.data?.attachmentUrl).toBe('报告.pdf');
		expect(node.data?.mdEmbed).toBe(true);
		// 未编辑 → 逐字回写；编辑 → 合成仍保留嵌入语法
		expect(roundTrip('- ![[报告.pdf]]').mdRaw).toBe('- ![[报告.pdf]]');
		node.data!.text = '新标题';
		expect(serializeMdBody(r.tree, null)).toBe('- 新标题 ![[报告.pdf]]');
	});

	it('图片嵌入 ![[图.png]] 仍为节点图（不受附件分流影响）', () => {
		const r = parseMdOutline('- ![[图.png]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.image).toBe('图.png');
		expect(node.data?.attachmentUrl).toBeUndefined();
		expect(node.data?.mdEmbed).toBeUndefined();
	});

	it('Obsidian 可渲染但不在拖拽清单的图片格式（avif）仍按节点图处理', () => {
		const r = parseMdOutline('- ![[图.avif]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.image).toBe('图.avif');
		expect(node.data?.attachmentUrl).toBeUndefined();
	});

	it('双链文档：走 mdWikiLinkpath 通道（自绘文档图标，不写 hyperlink）', () => {
		const r = parseMdOutline('- [[笔记A]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.mdWikiLinkpath).toBe('[[笔记A]]');
		expect(node.data?.hyperlink).toBeUndefined();
		expect(node.data?.attachmentUrl).toBeUndefined();
		expect(node.data?.text).toBe('笔记A');
	});

	it('双链文档别名：mdLinkText 取别名，文本剥壳为别名', () => {
		const r = parseMdOutline('- [[笔记A|别名]]', '根');
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		expect(node.data?.mdWikiLinkpath).toBe('[[笔记A|别名]]');
		expect(node.data?.mdLinkText).toBe('别名');
		expect(node.data?.text).toBe('别名');
	});

	it('双链文档未编辑 → 逐字回写原文', () => {
		const { mdRaw } = roundTrip('- [[笔记A|别名]]');
		expect(mdRaw).toBe('- [[笔记A|别名]]');
	});

	it('双链文档编辑文本后合成：重建 wikilink（保留别名）', () => {
		const first = parseMdOutline('- [[笔记A|别名]]', '根');
		const node = collect(first.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		node.data!.text = '新标题';
		const out = serializeMdBody(first.tree, null);
		expect(out).toBe('- 新标题 [[笔记A|别名]]');
	});

	it('裸 URL 与双链混排行：首链占位，其余剥壳为文本', () => {
		const r = parseMdOutline(
			'- 对比 https://a.com 与 [[笔记B]]',
			'根',
		);
		const node = collect(r.tree).find(
			({ node }) => node.data?.mdType === 'list',
		)!.node;
		// 首个链接 token = 裸 URL（位置在前）→ hyperlink；双链剥壳为文本
		expect(node.data?.hyperlink).toBe('https://a.com');
		expect(node.data?.text).toBe('对比 与 笔记B');
	});
});
