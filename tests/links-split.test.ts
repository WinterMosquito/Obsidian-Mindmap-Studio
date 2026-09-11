/**
 * 混排双链拆分（src/links-split.ts）回归。
 *
 * 断言策略：
 * - 输入走**真实解析**（parseMdOutline），产物走**真实序列化**（serializeMdBody）
 *   ——只断言「方案对象」会漏掉回写口径的漂移，而本功能的产物就是 Markdown 本身；
 * - 施加逻辑与 view-split-links.applySplitPlan 同一套字段规则（字段清单直接取
 *   links-split 的 PARENT_LINK_FIELDS），避免测试与实现两处漂移；
 * - 「未编辑不动文件」单列一例：自动触发只作用于被编辑的节点，存量节点不得被改写。
 *
 * 覆盖：混排抽取 / 图片保留 / 外链与 md 链接保留 / 别名与 # 区块 / 附件与嵌入
 * / 去重 / 幂等 / 跳过 plain·多行·纯链接行 / 拆分后文档再往返不动点。
 */
import { App, TFile } from 'obsidian';
import { beforeEach, describe, expect, it } from 'vitest';
import { fileLookupIndex } from '../src/file-lookup';
import { parseMdOutline } from '../src/md-outline';
import { serializeMdBody } from '../src/md-serialize';
import {
	PARENT_LINK_FIELDS,
	planSplitLinks,
	splitAllLinksInTree,
} from '../src/links-split';
import type { MdNodeData } from '../src/node-data';
import type {
	MindMapTreeNode,
} from '../vendor/simple-mind-map.cjs';

type MdData = Record<string, unknown>;
type Plan = NonNullable<ReturnType<typeof planSplitLinks>>;

/** 施加方案（与 view-split-links.applySplitPlan 同规则） */
function applyPlan(node: MindMapTreeNode, plan: Plan): void {
	const data = node.data as MdData;
	if (plan.clearParentLink) {
		for (const key of PARENT_LINK_FIELDS) {
			delete data[key];
		}
		Object.assign(data, plan.parentLinkFields);
	}
	data.text = plan.parentText;
	data.mdRaw = plan.parentRaw;
	data.mdDerivedText = plan.parentText;
	for (const child of plan.children) {
		node.children.push({
			data: { ...child.data },
			children: [],
		});
	}
}

function parse(md: string): MindMapTreeNode {
	return parseMdOutline(md, '根').tree;
}

/** 解析 → 对首个真实节点拆分 → 返回前后文本与方案（app 缺省 null：行内无资源地址的用例） */
function splitOnce(md: string, app: App | null = null) {
	const tree = parse(md);
	const node = tree.children[0]!;
	const before = serializeMdBody(tree, app);
	const plan = planSplitLinks(node.data, [], app);
	if (plan) {
		applyPlan(node, plan);
	}
	return { tree, node, plan, before, after: serializeMdBody(tree, app) };
}

/** 只算方案（不施加） */
function planOf(md: string, childIndex = 0, app: App | null = null) {
	const tree = parse(md);
	return planSplitLinks(tree.children[childIndex]!.data, [], app);
}

/**
 * 最小 App 桩：`resolvePathToFile` 对 app:// 资源地址走共享索引
 * （`file-lookup` 用 getFiles + getResourcePath 建「资源地址 → TFile」表）。
 */
function fakeApp(paths: string[]) {
	const files = paths.map((path) => {
		const name = path.split('/').pop() ?? path;
		return Object.assign(new TFile(), {
			path,
			name,
			basename: name.replace(/\.[^.]+$/, ''),
		});
	});
	const app: App = Object.assign(new App(), {
		vault: {
			getFiles: (): TFile[] => files,
			getResourcePath: (file: TFile): string => `app://fake/${file.path}`,
			// 索引查询先走直查（file-lookup.lookupCandidates），缺它会抛错被吞 → 解析静默失败
			getFileByPath: (path: string): TFile | null =>
				files.find((file) => file.path === path) ?? null,
		},
	});
	return { app, files };
}

/** 模拟 view 加载后的形态：`walkResolveImagePaths` 把库内路径换成资源地址 */
function withResolvedImage(tree: MindMapTreeNode, resourceUrl: string): MindMapTreeNode {
	(tree.children[0]!.data as MdData).image = resourceUrl;
	return tree;
}

beforeEach(() => {
	// 全库索引是插件级单例：用例间显式失效，避免上一个 fake app 的索引串味
	fileLookupIndex.invalidate();
});

describe('混排双链拆分 — 抽取与父节点改写', () => {
	it('列表节点：文档双链抽为子节点，父节点留可见名且删除紧邻空白', () => {
		const { plan, before, after } = splitOnce(
			'- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n',
		);
		expect(before, '未编辑的原文逐字回写（拆分前不动文件）').toBe(
			'- 关于 [[冬天]] 和 [[秋天]] 的相关问题',
		);
		expect(plan?.parentText).toBe('关于冬天和秋天的相关问题');
		expect(plan?.clearParentLink, '首个链接被抽走 → 需清空原字段').toBe(true);
		expect(plan?.children.map((child) => child.text)).toEqual(['冬天', '秋天']);
		expect(after).toBe(
			'- 关于冬天和秋天的相关问题\n  - [[冬天]]\n  - [[秋天]]',
		);
	});

	it('标题节点：抽出的子节点写成其下的列表项', () => {
		const { plan, after } = splitOnce(
			'## 参见 [[设计稿|设计]] 与 [[仓库.canvas]] 说明\n',
		);
		expect(plan?.children.map((child) => child.text)).toEqual([
			'设计',
			'仓库.canvas',
		]);
		expect(after).toBe(
			'## 参见设计与仓库.canvas说明\n- [[设计稿|设计]]\n- [[仓库.canvas]]',
		);
	});

	it('别名与 # 区块：子节点回写保留完整双链', () => {
		const { plan, after } = splitOnce('- 见 [[笔记#标题|别名]] 说明\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['别名']);
		expect(after).toBe('- 见别名说明\n  - [[笔记#标题|别名]]');
	});

	it('三条：按出现顺序逐条抽为子节点', () => {
		const { plan, after } = splitOnce('- 见 [[A]] 与 [[B]] 和 [[C]] 说明\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['A', 'B', 'C']);
		expect(after).toBe(
			'- 见A与B和C说明\n  - [[A]]\n  - [[B]]\n  - [[C]]',
		);
	});

	it('四条混合类型（文档 / 附件 / 嵌入 / 带别名）一次拆完', () => {
		const { plan, after } = splitOnce(
			'- 汇总 [[笔记1]] [[报告.pdf]] ![[笔记2]] [[笔记3|别名]] 完毕\n',
		);
		expect(plan?.children.map((child) => child.text)).toEqual([
			'笔记1',
			'报告.pdf',
			'笔记2',
			'别名',
		]);
		expect(after).toBe(
			[
				'- 汇总笔记1报告.pdf笔记2别名完毕',
				'  - [[笔记1]]',
				'  - [[报告.pdf]]',
				'  - ![[笔记2]]',
				'  - [[笔记3|别名]]',
			].join('\n'),
		);
	});

	it('多条中含重复目标：去重只留一条，其余照常抽取', () => {
		const { plan } = splitOnce('- 见 [[A]] 与 [[B]] 和 [[A]] 说明\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['A', 'B']);
	});

	it('附件双链：走附件通道并保留别名', () => {
		const { plan, after } = splitOnce('- 参见 [[报告.pdf|说明]] 与 [[笔记]]\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['说明', '笔记']);
		expect(after).toBe(
			'- 参见说明与笔记\n  - [[报告.pdf|说明]]\n  - [[笔记]]',
		);
	});

	it('非图片嵌入：子节点保留感叹号与管道位原文，父节点留文件名', () => {
		const { plan, after } = splitOnce('- 见 ![[报告.pdf|300]] 说明\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['报告.pdf']);
		expect(after).toBe(
			'- 见报告.pdf说明\n  - ![[报告.pdf|300]]',
		);
	});
});

describe('混排双链拆分 — 不抽的范围（图片 / 外链 / md 链接）', () => {
	it('图片扩展名不抽：按扩展名判定的图片链接留在父节点且仍是链接', () => {
		const { plan, after } = splitOnce(
			'- 关于 [[冬天]] 和 [[秋天.JPEG]] 的相关问题\n',
		);
		expect(plan?.children.map((child) => child.text)).toEqual(['冬天']);
		expect(plan?.parentRaw, '未抽出的链接保持原文语法').toBe(
			'关于冬天和 [[秋天.JPEG]] 的相关问题',
		);
		expect(
			(plan?.parentLinkFields)?.mdAttachmentLinkpath,
			'图片链接接管父节点字段（回形针图标）',
		).toBe('秋天.JPEG');
		expect(after).toBe(
			'- 关于冬天和 [[秋天.JPEG]] 的相关问题\n  - [[冬天]]',
		);
	});

	it('裸 URL 不抽且不丢：URL 由父节点 hyperlink 字段承载', () => {
		const { plan, after } = splitOnce('- 说明 [[笔记]] 见 https://x.com\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['笔记']);
		expect(
			(plan?.parentLinkFields)?.hyperlink,
			'被抽走首链接后，未抽出的 URL 回填为父节点链接',
		).toBe('https://x.com');
		expect(after).toBe('- 说明笔记见 https://x.com\n  - [[笔记]]');
	});

	it('md 链接（非双链）不抽，父节点保持原行', () => {
		const { plan, after } = splitOnce(
			'- 参见 [仓库](https://github.com/x) 与 [[笔记]]\n',
		);
		expect(plan?.clearParentLink, '首链接是 md 链接 → 父字段不动').toBe(false);
		expect(after).toBe(
			'- 参见 [仓库](https://github.com/x) 与笔记\n  - [[笔记]]',
		);
	});

	it('图片与文档双链同行：图片保持嵌入语法，双链抽为子节点', () => {
		const { plan, after } = splitOnce('- ![[a.png]] 见 [[笔记]]\n');
		expect(plan?.children.map((child) => child.text)).toEqual(['笔记']);
		expect(after).toBe('- ![[a.png]] 见笔记\n  - [[笔记]]');
	});
});

describe('混排双链拆分 — 边界与幂等', () => {
	it('纯链接行不拆（无其它描述文字）', () => {
		expect(planOf('- [[冬天]] [[秋天]]\n')).toBeNull();
		expect(planOf('- [[冬天]]\n')).toBeNull();
	});

	it('plain 段落跳过（无法承载子节点）', () => {
		const tree = parse('# H\n\n参见 [[设计稿|设计]] 说明\n');
		const paragraph = tree.children[0]!.children[0]!;
		expect((paragraph.data as MdData).mdType).toBe('plain');
		expect(
			planSplitLinks(paragraph.data as MdNodeData, [], null),
			'plain 段落不拆',
		).toBeNull();
	});

	it('多行列表节点跳过（续行语义不同）', () => {
		const tree = parse('- 说明 [[笔记]]\n  第二行\n');
		const node = tree.children[0]!;
		expect((node.data as MdData).text).toContain('\n');
		expect(planSplitLinks(node.data as MdNodeData, [], null)).toBeNull();
	});

	it('去重：目标已存在于子节点时跳过，其余照常追加', () => {
		const tree = parse('- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n  - [[冬天]]\n');
		const node = tree.children[0]!;
		const plan = planSplitLinks(
			node.data,
			node.children.map((child) => child.data as MdNodeData),
			null,
		);
		expect(plan?.children.map((child) => child.text)).toEqual(['秋天']);
	});

	it('拆分出的子节点：编辑其文本 = 改别名（与解析出的纯双链节点同语义）', () => {
		const { tree, node } = splitOnce('- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n');
		const child = node.children[0]!;
		expect((child.data as MdData).text).toBe('冬天');
		// 引擎就地编辑的语义：只改 text（双击子节点改名的等价模拟）
		(child.data as MdData).text = '新年';
		expect(serializeMdBody(tree, null)).toBe(
			'- 关于冬天和秋天的相关问题\n  - [[冬天|新年]]\n  - [[秋天]]',
		);
	});

	it('幂等：拆分结果再跑一遍为 no-op（不产生孙节点）', () => {
		const { node, plan } = splitOnce('- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n');
		expect(plan).not.toBeNull();
		const again = planSplitLinks(
			node.data,
			node.children.map((child) => child.data as MdNodeData),
			null,
		);
		expect(again, '父节点已无可抽链接、子节点是纯链接节点').toBeNull();
	});

	it('拆分结果自往返不动点（再解析再序列化逐字相等）', () => {
		const { after } = splitOnce('- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n');
		const reparse = parse(`${after}\n`);
		expect(serializeMdBody(reparse, null)).toBe(after);
	});

	it('全文批量：扫描整棵树，含未编辑的存量节点，一次拆完并给出统计', () => {
		const tree = parse(
			[
				'# 顶',
				'- 关于 [[冬天]] 和 [[秋天]] 的相关问题',
				'- 见 [[A]] 与 [[B]] 说明',
				'- [[C]]',
				'- 纯说明文字',
				'',
			].join('\n'),
		);
		expect(splitAllLinksInTree(tree, null)).toEqual({ nodes: 2, links: 4 });
		expect(serializeMdBody(tree, null)).toBe(
			[
				'# 顶',
				'- 关于冬天和秋天的相关问题',
				'  - [[冬天]]',
				'  - [[秋天]]',
				'- 见A与B说明',
				'  - [[A]]',
				'  - [[B]]',
				'- [[C]]',
				'- 纯说明文字',
			].join('\n'),
		);
	});

	it('全文批量幂等：对已拆分的文档再跑一遍为 no-op', () => {
		const tree = parse('- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n');
		expect(splitAllLinksInTree(tree, null)).toEqual({ nodes: 1, links: 2 });
		expect(splitAllLinksInTree(tree, null)).toEqual({ nodes: 0, links: 0 });
	});

	it('未编辑的存量混排节点：仅解析不改写文件', () => {
		const md = '- 关于 [[冬天]] 和 [[秋天]] 的相关问题\n';
		expect(serializeMdBody(parse(md), null)).toBe(
			'- 关于 [[冬天]] 和 [[秋天]] 的相关问题',
		);
	});
});

/**
 * 2026-09-11 修复：图片节点混排时，拆分会把图片误判为「非图片附件」并抽出，
 * 回写成 `![[app://…#图.png?1789]]`、把 URL 编码片段拼进父节点文本。
 * 根因是拆分分析调用了 `composeNodeFirstLine(data, null)`：缺 app 时序列化会把
 * 加载期解析过的 `image`（资源地址）原样吐出，`rawOk` 也因此把未编辑节点误判。
 */
describe('混排双链拆分 — 图片节点的资源地址（app://）', () => {
	const MD = '- ![[附件/图片.png|164]] [[节点A]]和[[节点B]]\n';

	it('未编辑：图片留在原位、双链抽为子节点，不写资源地址、不留编码片段', () => {
		const { app } = fakeApp(['附件/图片.png']);
		const tree = withResolvedImage(parse(MD), 'app://fake/附件/图片.png');
		const node = tree.children[0]!;
		expect(serializeMdBody(tree, app), '未编辑的原文逐字回写').toBe(
			'- ![[附件/图片.png|164]] [[节点A]]和[[节点B]]',
		);

		const plan = planSplitLinks(node.data, [], app);
		expect(plan?.children.map((child) => child.text)).toEqual([
			'节点A',
			'节点B',
		]);
		expect(
			plan?.parentRaw,
			'图片与文字之间保留一个空格（不粘连），双链处换成可见名',
		).toBe('![[附件/图片.png|164]] 节点A和节点B');
		expect(plan?.parentText).toBe('节点A和节点B');

		if (plan) {
			applyPlan(node, plan);
		}
		const after = serializeMdBody(tree, app);
		expect(after).toBe(
			[
				'- ![[附件/图片.png|164]] 节点A和节点B',
				'  - [[节点A]]',
				'  - [[节点B]]',
			].join('\n'),
		);
		expect(after, '绝不把运行期资源地址写进笔记').not.toContain('app://');
		expect(after, '不得残留 URL 编码片段').not.toContain('%E5%9B%BE');
	});

	it('资源地址无法反查库内路径（图片已不在库中）：整体放弃拆分', () => {
		const { app } = fakeApp([]);
		const tree = withResolvedImage(
			parse(MD),
			'app://fake/附件/图片.png?1789126550688',
		);
		expect(
			planSplitLinks(tree.children[0]!.data, [], app),
			'序列化会回落到 app:// 资源地址 → 宁可不动，也不写进笔记',
		).toBeNull();
		expect(
			planSplitLinks(tree.children[0]!.data, [], null),
			'未带 app：同样拒绝（兜底不看调用方）',
		).toBeNull();
	});

	it('未编辑的图片节点：带 app 时按原文逐字回写（rawOk 依赖 app 反查图片路径）', () => {
		const { app } = fakeApp(['附件/图片.png']);
		const tree = withResolvedImage(parse(MD), 'app://fake/附件/图片.png');
		expect(serializeMdBody(tree, app)).toBe(
			'- ![[附件/图片.png|164]] [[节点A]]和[[节点B]]',
		);
	});
});
