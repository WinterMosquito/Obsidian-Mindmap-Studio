/**
 * links-rename 回归测试：文件重命名后，导图树引用更新的**字段 + 渲染源**双层。
 *
 * links-tree.updateReferencesOnRename 只改链接通道字段；自绘节点的渲染源是
 * mdRaw（node-inline-content 按行内 token 重建锚点）——本文件钉住包装函数
 * renameReferencesInTree 的第二遍「渲染源重建」：
 * - mdRaw 里的旧链接 token 重写为新形态（保留 #区块 / |别名 / 路径前缀写法）；
 * - text / mdRaw / mdDerivedText / mdSegments（/ mdLinkText）按新行解析值整体
 *   重建，通道字段（attachmentUrl 资源地址等）保留字段层改写结果；
 * - 未编辑守卫（text === mdDerivedText）、回收站退化守卫（K55）、幂等。
 *
 * app 桩与文件工厂沿用 links-tree.test.ts 的同款形态（getResourcePath 前缀 +
 * fileLookupIndex 单例失效）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { fileLookupIndex } from '../src/links/file-lookup';
import { renameReferencesInTree } from '../src/markdown/links-rename';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

const RESOURCE_PREFIX = 'app://fake/';

function file(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ''),
	});
}

function node(
	data: Record<string, unknown>,
	children: MindMapTreeNode[] = [],
): MindMapTreeNode {
	return { data, children };
}

function tree(...children: MindMapTreeNode[]): MindMapTreeNode {
	return node({ text: '根' }, children);
}

function dataOf(n: MindMapTreeNode): Record<string, unknown> {
	return n.data;
}

function fakeApp(files: TFile[]) {
	const getResourcePath = vi.fn(
		(f: TFile): string => `${RESOURCE_PREFIX}${f.path}`,
	);
	const app: App = Object.assign(new App(), {
		vault: {
			getFiles: vi.fn((): TFile[] => files),
			getResourcePath,
		},
	});
	return { app };
}

/**
 * 解析态文档双链节点（与 md-outline 对含 `[[旧名]]` 行的产物同构）。
 * `field` = 首链字段（多 token 行只承载首个链接），缺省取 raw 本身。
 */
function docLinkNode(
	raw: string,
	display: string,
	field?: string,
): MindMapTreeNode {
	return node({
		text: display,
		mdRaw: raw,
		mdDerivedText: display,
		mdWikiLinkpath: field ?? raw,
		mdLinkStyle: 'wiki',
		mdLinkText: display,
		mdSegments: [{ kind: 'link', text: display, raw, first: true }],
	});
}

beforeEach(() => {
	// 全库索引是插件级单例：用例间显式失效，避免上一个 fake app 的索引串味
	fileLookupIndex.invalidate();
});

describe('renameReferencesInTree：渲染源重建（字段 + mdRaw 双层）', () => {
	it('纯文档双链：mdRaw 重写为新形态，text/mdDerivedText/mdLinkText 跟随新名', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = docLinkNode('[[旧名]]', '旧名');
		const root = tree(link);

		expect(renameReferencesInTree(root, renamed, '旧名.md', app)).toBe(true);

		const data = dataOf(link);
		// 字段层（links-tree）：通道字段改指向新位置
		expect(data.mdWikiLinkpath).toBe('[[新名]]');
		// 渲染源层：mdRaw 与按新行解析的字段同步重建（屏上锚点立即更新）
		expect(data.mdRaw).toBe('[[新名]]');
		expect(data.text).toBe('新名');
		expect(data.mdDerivedText).toBe('新名');
		expect(data.mdLinkText).toBe('新名');
		expect(data.mdSegments).toEqual([
			{ kind: 'link', text: '新名', raw: '[[新名]]', first: true },
		]);
	});

	it('带别名：别名保留，节点文本不变（别名是用户意图）', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = docLinkNode('[[旧名|自定义]]', '自定义');
		const root = tree(link);

		renameReferencesInTree(root, renamed, '旧名.md', app);

		const data = dataOf(link);
		expect(data.mdWikiLinkpath).toBe('[[新名|自定义]]');
		expect(data.mdRaw).toBe('[[新名|自定义]]');
		expect(data.text).toBe('自定义');
		expect(data.mdDerivedText).toBe('自定义');
		expect(data.mdLinkText).toBe('自定义');
	});

	it('带区块引用：区块随链接保留，显示名含区块', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = docLinkNode('[[旧名#小节]]', '旧名#小节');
		const root = tree(link);

		renameReferencesInTree(root, renamed, '旧名.md', app);

		const data = dataOf(link);
		expect(data.mdWikiLinkpath).toBe('[[新名#小节]]');
		expect(data.mdRaw).toBe('[[新名#小节]]');
		expect(data.text).toBe('新名#小节');
	});

	it('多 token 行：只改命中的链接 token，其余原文保持', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = docLinkNode('说明 [[旧名]] 尾', '说明 旧名 尾', '[[旧名]]');
		const root = tree(link);

		renameReferencesInTree(root, renamed, '旧名.md', app);

		const data = dataOf(link);
		expect(data.mdRaw).toBe('说明 [[新名]] 尾');
		expect(data.text).toBe('说明 新名 尾');
		expect(data.mdDerivedText).toBe('说明 新名 尾');
	});

	it('嵌入附件：mdRaw 重写为嵌入语法，通道字段保留字段层的资源地址', () => {
		const renamed = file('附件/新报告.pdf');
		const { app } = fakeApp([renamed]);
		const attach = node({
			text: '',
			mdRaw: '![[附件/旧报告.pdf]]',
			mdDerivedText: '',
			attachmentUrl: `${RESOURCE_PREFIX}附件/旧报告.pdf`,
			attachmentName: '旧报告.pdf',
			mdAttachmentLinkpath: '附件/旧报告.pdf',
			mdLinkStyle: 'wiki',
			mdEmbed: true,
		});
		const root = tree(attach);

		renameReferencesInTree(root, renamed, '附件/旧报告.pdf', app);

		const data = dataOf(attach);
		expect(data.mdRaw).toBe('![[附件/新报告.pdf]]');
		// 通道字段保留字段层改写结果：attachmentUrl 是新的**资源地址**（解析态
		// 的裸 linkpath 照搬会打断回形针通道），mdAttachmentLinkpath 为新路径
		expect(data.attachmentUrl).toBe(`${RESOURCE_PREFIX}附件/新报告.pdf`);
		expect(data.mdAttachmentLinkpath).toBe('附件/新报告.pdf');
		// 附件嵌入不占节点文本、无台账（与解析侧同口径）
		expect(data.text).toBe('');
		expect(data.mdDerivedText).toBe('');
		expect(data.mdSegments).toBeUndefined();
	});

	it('md 链接形态：目标重写、扩展名补回，显示文本（label）不动', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = node({
			text: '说明',
			mdRaw: '[说明](旧名.md)',
			mdDerivedText: '说明',
			hyperlink: '旧名.md',
			mdLinkStyle: 'md',
			mdLinkText: '说明',
		});
		const root = tree(link);

		renameReferencesInTree(root, renamed, '旧名.md', app);

		const data = dataOf(link);
		expect(data.hyperlink).toBe('新名.md');
		expect(data.mdRaw).toBe('[说明](新名.md)');
		expect(data.text).toBe('说明');
		expect(data.mdDerivedText).toBe('说明');
	});

	it('已编辑节点（text ≠ mdDerivedText）：渲染源不动，仅字段层改写', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = node({
			text: '我的说明',
			mdRaw: '[[旧名]]',
			mdDerivedText: '旧名',
			mdWikiLinkpath: '[[旧名]]',
			mdLinkStyle: 'wiki',
			mdLinkText: '旧名',
		});
		const root = tree(link);

		renameReferencesInTree(root, renamed, '旧名.md', app);

		const data = dataOf(link);
		// 字段层照常改指向新位置（保存由合成路径承载）
		expect(data.mdWikiLinkpath).toBe('[[新名]]');
		// 渲染源保持原状：编辑态的渲染源是 data.text，字段 + 保存合成已覆盖
		expect(data.mdRaw).toBe('[[旧名]]');
		expect(data.text).toBe('我的说明');
	});

	it('行内代码里的同名串同样被改写（与解析侧同一扫描器，行为一致不放大不收窄）', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const raw = '看 `[[旧名]]` 与 [[旧名]]';
		const link = docLinkNode(raw, '看 [[旧名]] 与 旧名', '[[旧名]]');
		const root = tree(link);

		renameReferencesInTree(root, renamed, '旧名.md', app);

		const data = dataOf(link);
		// tokenizeInline 不感知行内代码上下文——解析侧本就把 code span 里的
		// `[[..]]` 当链接 token、反引号作为相邻 prose 保留，重建与其保持
		// **同一行为**（重解析后亦同形）
		expect(data.mdRaw).toBe('看 `[[新名]]` 与 [[新名]]');
		expect(data.text).toBe('看 `新名` 与 新名');
	});

	it('跨目录移动：裸名链接保持裸名、带路径前缀的改写为新目录', () => {
		const renamed = file('b/新.md');
		const { app } = fakeApp([renamed]);
		const bare = docLinkNode('[[旧]]', '旧');
		const prefixed = docLinkNode('[[a/旧]]', '旧');
		const root = tree(bare, prefixed);

		renameReferencesInTree(root, renamed, 'a/旧.md', app);

		// 改写形态跟用户走（renamedWikilink 口径）：裸名 → 裸名，前缀 → 新目录
		expect(dataOf(bare).mdRaw).toBe('[[新]]');
		expect(dataOf(prefixed).mdRaw).toBe('[[b/新]]');
	});

	it('幂等：第二次运行无变更（返回 false，树不再变动）', () => {
		const renamed = file('新名.md');
		const { app } = fakeApp([renamed]);
		const link = docLinkNode('[[旧名]]', '旧名');
		const root = tree(link);

		expect(renameReferencesInTree(root, renamed, '旧名.md', app)).toBe(true);
		const snapshot = JSON.stringify(dataOf(link));
		expect(renameReferencesInTree(root, renamed, '旧名.md', app)).toBe(false);
		expect(JSON.stringify(dataOf(link))).toBe(snapshot);
	});

	it('移入回收站：链接字段与渲染源都保持原状（K55 保留未解析引用）', () => {
		// 同一文件旧路径 → 移入 .trash：附件被整条清除（changed=true），
		// 链接保留未解析引用——字段不改写、渲染源也不重建
		const trashed = file('.trash/新报告.pdf');
		const { app } = fakeApp([trashed]);
		const attach = node({
			text: '',
			mdRaw: '![[附件/旧报告.pdf]]',
			mdDerivedText: '',
			attachmentUrl: `${RESOURCE_PREFIX}附件/旧报告.pdf`,
			attachmentName: '旧报告.pdf',
			mdAttachmentLinkpath: '附件/旧报告.pdf',
			mdLinkStyle: 'wiki',
			mdEmbed: true,
		});
		const link = docLinkNode('[[附件/旧报告.pdf]]', '附件/旧报告.pdf');
		const root = tree(attach, link);

		expect(renameReferencesInTree(root, trashed, '附件/旧报告.pdf', app)).toBe(
			true,
		);

		const data = dataOf(link);
		expect(data.mdWikiLinkpath).toBe('[[附件/旧报告.pdf]]');
		expect(data.mdRaw).toBe('[[附件/旧报告.pdf]]');
		expect(data.text).toBe('附件/旧报告.pdf');
	});
});
