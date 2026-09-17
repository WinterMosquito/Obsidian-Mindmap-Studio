/**
 * links-tree 回归测试：文件重命名/删除后，导图树内图片/附件/双链引用的更新。
 *
 * 断言策略：
 * - 重命名（rename）与清除（clear）共享同一遍历实现、仅 mode 不同，故两模式的用例
 *   成对出现，证明「同一组待匹配形态 + 不同替换值」而不是两套实现；
 * - 「是否有变更」的返回值与节点 data 的具体值同等重要——调用方据此决定是否保存；
 * - 分支归属用 spy 断言：纯文本树必须短路（不建索引 → getFiles 不被调用）、
 *   清除与回收站场景必须不取资源地址（getResourcePath 不被调用）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { fileLookupIndex } from '../src/links/file-lookup';
import { parseMdOutline } from '../src/markdown/md-outline';
import { serializeMdBody } from '../src/markdown/md-serialize';
import {
	removeReferencesOnDelete,
	updateReferencesOnRename,
} from '../src/links/links-tree';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/** 资源地址前缀：fake vault 的 getResourcePath 输出形态 */
const RESOURCE_PREFIX = 'app://fake/';

function file(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ''),
	});
}

/** 构造导图节点：data 为引擎节点数据（AnyObject，可承载任意引用字段） */
function node(
	data: Record<string, unknown>,
	children: MindMapTreeNode[] = [],
): MindMapTreeNode {
	return { data, children };
}

/** 根节点 + 指定子节点（根自身不带引用，遍历必须同时覆盖根与后代） */
function tree(...children: MindMapTreeNode[]): MindMapTreeNode {
	return node({ text: '根' }, children);
}

/** 读取引用字段：引擎 data 为 AnyObject，读回 unknown 便于断言任意键 */
function dataOf(n: MindMapTreeNode): Record<string, unknown> {
	return n.data;
}

function fakeApp(files: TFile[]) {
	const getFiles = vi.fn((): TFile[] => files);
	const getResourcePath = vi.fn(
		(f: TFile): string => `${RESOURCE_PREFIX}${f.path}`,
	);
	const app: App = Object.assign(new App(), {
		vault: { getFiles, getResourcePath },
	});
	return { app, getFiles, getResourcePath };
}

/**
 * `getResourcePath` 的「替换地址」调用（与索引构建调用区分开）。
 *
 * 本模块在非清除路径上会取一次 `app.vault.getResourcePath(file)` 作为新引用值，
 * 但 `buildFileLookupIndex` 为了建「资源地址 → TFile」表，**也会对库内每个文件
 * 各调一次 `getResourcePath`**（见 src/links/file-lookup.ts:50）。于是整段调用里前
 * `vaultFileCount` 次是建索引的副产物，只有其后的才是本模块真正为替换取的值。
 * 不切开两者，「清除/回收站不得取新地址」这类断言就分不清是哪个调用者，
 * 也解释不了「明明只替换一次却看到两次」。
 */
function replacementCalls(
	spy: ReturnType<typeof fakeApp>['getResourcePath'],
	vaultFileCount: number,
): unknown[][] {
	return spy.mock.calls.slice(vaultFileCount);
}

beforeEach(() => {
	// 全库索引是插件级单例：用例间必须显式失效，否则上一个 fake app 的索引会串味
	fileLookupIndex.invalidate();
});

describe('updateReferencesOnRename：重命名后引用改指向新位置', () => {
	const OLD_PATH = 'assets/pic.png';
	const NEW_PATH = 'assets/新图.png';

	it('图片：资源地址命中后改指向新的资源地址', () => {
		const renamed = file(NEW_PATH);
		const { app, getFiles, getResourcePath } = fakeApp([renamed]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}${OLD_PATH}` });
		const root = tree(pic);

		expect(updateReferencesOnRename(root, renamed, OLD_PATH, app)).toBe(true);
		expect(dataOf(pic).image).toBe(`${RESOURCE_PREFIX}${NEW_PATH}`);
		// 新地址由官方 getResourcePath 产出（不是手写前缀拼接）：库内 1 个文件的
		// 索引构建各调一次、替换再调一次，故只取切片后的「替换调用」来断言
		expect(replacementCalls(getResourcePath, 1)).toEqual([[renamed]]);
		// 索引经 getFiles 惰性构建一次
		expect(getFiles).toHaveBeenCalledTimes(1);
	});

	it('图片：URL 编码的中文文件名按解码形态命中（否则重命名后引用失联）', () => {
		const oldCn = 'assets/图 片.png';
		const renamed = file('assets/新 图.png');
		const { app } = fakeApp([renamed]);
		const pic = node({
			text: '图片',
			// Obsidian 对含空格/中文的资源地址做 URL 编码，节点里存的可能是编码形态
			image: `${RESOURCE_PREFIX}${encodeURIComponent(oldCn)}`,
		});

		expect(updateReferencesOnRename(tree(pic), renamed, oldCn, app)).toBe(true);
		expect(dataOf(pic).image).toBe(`${RESOURCE_PREFIX}assets/新 图.png`);
	});

	it('图片：地址形态与否决集（表驱动，覆盖路径相等/后缀与文件名末段比较）', () => {
		const renamed = file(NEW_PATH);
		const cases: { label: string; image: string; expected: boolean }[] = [
			// 与旧路径完全相等
			{ label: '旧路径原样', image: OLD_PATH, expected: true },
			// 资源地址后缀匹配旧路径
			{
				label: '资源地址后缀',
				image: `${RESOURCE_PREFIX}${OLD_PATH}`,
				expected: true,
			},
			// 去扩展名形态（urlPaths 的第二项）
			{
				label: '去扩展名后缀',
				image: `${RESOURCE_PREFIX}assets/pic`,
				expected: true,
			},
			// 库外绝对路径后缀（历史数据形态）
			{
				label: '绝对路径后缀',
				image: '/home/u/vault/assets/pic.png',
				expected: true,
			},
			// 末段等于旧裸文件名（去扩展名的 urlNames 项）
			{ label: '末段旧裸名', image: `${RESOURCE_PREFIX}pic`, expected: true },
			// 末段等于当前文件名（改名后已被外部同步过的形态）
			{
				label: '末段当前文件名',
				image: `${RESOURCE_PREFIX}新图.png`,
				expected: true,
			},
			// 否决集：末段是别的文件 → 后缀/末段都不得误命中
			{
				label: '末段别的文件',
				image: `${RESOURCE_PREFIX}other.png`,
				expected: false,
			},
			// 否决集：仅路径前缀相同（同级目录）不算命中
			{
				label: '同级不同文件',
				image: 'assets/sub/pic.png',
				expected: false,
			},
		];
		for (const { label, image, expected } of cases) {
			const pic = node({ text: '图片', image });
			const { app } = fakeApp([renamed]);
			expect(
				updateReferencesOnRename(tree(pic), renamed, OLD_PATH, app),
				label,
			).toBe(expected);
			expect(dataOf(pic).image, label).toBe(
				expected ? `${RESOURCE_PREFIX}${NEW_PATH}` : image,
			);
		}
	});

	it('图片：fileLookupIndex 未覆盖的畸形转义地址仍按原样形态命中', () => {
		// '100%.png' 无法 URL 解码（URIError 被吞），只能靠原样/后缀比较命中
		const renamed = file('assets/100%.png');
		const { app } = fakeApp([renamed]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}assets/100%.png` });
		expect(updateReferencesOnRename(tree(pic), renamed, 'assets/100%.png', app)).toBe(
			true,
		);
		expect(dataOf(pic).image).toBe(`${RESOURCE_PREFIX}assets/100%.png`);
	});

	it('附件：attachmentUrl 改指向新地址，attachmentName 同步为新文件名', () => {
		const renamed = file('files/报 告.pdf');
		const { app } = fakeApp([renamed]);
		const attach = node({
			text: '附件',
			attachmentUrl: `${RESOURCE_PREFIX}files/旧 报 告.pdf`,
			attachmentName: '旧 报 告.pdf',
		});
		expect(
			updateReferencesOnRename(tree(attach), renamed, 'files/旧 报 告.pdf', app),
		).toBe(true);
		expect(dataOf(attach).attachmentUrl).toBe(`${RESOURCE_PREFIX}files/报 告.pdf`);
		// 名称必须跟着换，否则节点显示的还是找不到的旧文件名
		expect(dataOf(attach).attachmentName).toBe('报 告.pdf');
	});

	it('超链接：保留 #区块与 |别名，并沿用原有路径前缀', () => {
		const renamed = file('folder/新名.md');
		const { app } = fakeApp([renamed]);
		const link = node({ text: '链接', hyperlink: '[[folder/旧名#小节|别名]]' });
		expect(
			updateReferencesOnRename(tree(link), renamed, 'folder/旧名.md', app),
		).toBe(true);
		// 前缀沿用 + 尾巴（#区块、|别名）原样保留
		expect(dataOf(link).hyperlink).toBe('[[folder/新名#小节|别名]]');
	});

	it('超链接：无别名时省略 | 段，裸 [[旧名]] 改写为裸 basename', () => {
		const renamed = file('folder/新名.md');
		const { app } = fakeApp([renamed]);
		const link = node({ text: '链接', hyperlink: '[[旧名]]' });
		expect(
			updateReferencesOnRename(tree(link), renamed, 'folder/旧名.md', app),
		).toBe(true);
		expect(dataOf(link).hyperlink).toBe('[[新名]]');
	});

	it('超链接（md 形态 `路径.md`）：官方关闭 Wikilinks 时同样改写', () => {
		const renamed = file('folder/新名.md');
		const { app } = fakeApp([renamed]);
		const link = node({
			text: '链接',
			hyperlink: 'folder/旧名.md',
			mdLinkStyle: 'md',
			mdLinkText: '链接',
		});
		expect(
			updateReferencesOnRename(tree(link), renamed, 'folder/旧名.md', app),
		).toBe(true);
		expect(dataOf(link).hyperlink).toBe('folder/新名.md');
	});

	it('md 形态：裸 dest 也命中；远程地址不误改', () => {
		const renamed = file('folder/新名.md');
		const { app } = fakeApp([renamed]);

		const bare = node({ text: '链接', hyperlink: '旧名.md' });
		expect(
			updateReferencesOnRename(tree(bare), renamed, 'folder/旧名.md', app),
		).toBe(true);
		expect(dataOf(bare).hyperlink).toBe('新名.md');

		const external = node({
			text: '外链',
			hyperlink: 'https://example.com/旧名.md',
		});
		expect(
			updateReferencesOnRename(tree(external), renamed, 'folder/旧名.md', app),
		).toBe(false);
		expect(dataOf(external).hyperlink).toBe('https://example.com/旧名.md');
	});

	it('跨文件夹移动：前缀必须换成新位置（不得留下 [[folder/新名]] 悬空链接）', () => {
		const moved = file('other/新名.md');
		const { app } = fakeApp([moved]);
		const link = node({ text: '链接', hyperlink: '[[folder/旧名]]' });
		expect(
			updateReferencesOnRename(tree(link), moved, 'folder/旧名.md', app),
		).toBe(true);
		expect(dataOf(link).hyperlink, '前缀换成移动后的文件夹').toBe(
			'[[other/新名]]',
		);
	});

	it('跨文件夹移动 + 裸链接：保持裸形态（不擅自补路径）', () => {
		const moved = file('other/新名.md');
		const { app } = fakeApp([moved]);
		const link = node({ text: '链接', hyperlink: '[[旧名]]' });
		expect(updateReferencesOnRename(tree(link), moved, 'folder/旧名.md', app)).toBe(
			true,
		);
		expect(dataOf(link).hyperlink).toBe('[[新名]]');
	});

	it('Canvas 文档移动：文档链接仍带扩展名（前缀与裸形态都不丢 .canvas）', () => {
		const moved = file('other/画板.canvas');
		const { app } = fakeApp([moved]);
		const withPrefix = node({
			text: '画布',
			mdWikiLinkpath: '[[folder/画布.canvas]]',
		});
		expect(
			updateReferencesOnRename(
				tree(withPrefix),
				moved,
				'folder/画布.canvas',
				app,
			),
		).toBe(true);
		expect(dataOf(withPrefix).mdWikiLinkpath).toBe('[[other/画板.canvas]]');

		const bare = node({ text: '画布', mdWikiLinkpath: '[[画布.canvas]]' });
		expect(
			updateReferencesOnRename(tree(bare), moved, 'folder/画布.canvas', app),
		).toBe(true);
		expect(dataOf(bare).mdWikiLinkpath, '裸形态同样保留扩展名').toBe(
			'[[画板.canvas]]',
		);
	});

	it('文档双链 mdWikiLinkpath：与超链接同语义改写', () => {
		const renamed = file('folder/新名.md');
		const { app } = fakeApp([renamed]);
		const doc = node({ text: '文档', mdWikiLinkpath: '[[folder/旧名]]' });
		expect(
			updateReferencesOnRename(tree(doc), renamed, 'folder/旧名.md', app),
		).toBe(true);
		expect(dataOf(doc).mdWikiLinkpath).toBe('[[folder/新名]]');
	});

	it('深层后代节点的引用同样被更新（遍历覆盖整棵树）', () => {
		const renamed = file(NEW_PATH);
		const { app } = fakeApp([renamed]);
		const deep = node({ text: '深层图片', image: `${RESOURCE_PREFIX}${OLD_PATH}` });
		const mid = node({ text: '中间' }, [deep]);
		const root = tree(mid);
		expect(updateReferencesOnRename(root, renamed, OLD_PATH, app)).toBe(true);
		expect(dataOf(deep).image).toBe(`${RESOURCE_PREFIX}${NEW_PATH}`);
		// 无引用的中间节点保持原对象身份（原地更新，不重建树）
		expect(root.children[0]).toBe(mid);
		expect(dataOf(mid).text).toBe('中间');
	});

	it('单节点混合字段：只改命中的字段，未命中字段原样保留', () => {
		const renamed = file(NEW_PATH);
		const { app } = fakeApp([renamed]);
		const mixed = node({
			text: '混合',
			image: `${RESOURCE_PREFIX}${OLD_PATH}`,
			hyperlink: '[[另一个笔记]]',
		});
		expect(updateReferencesOnRename(tree(mixed), renamed, OLD_PATH, app)).toBe(true);
		expect(dataOf(mixed).image).toBe(`${RESOURCE_PREFIX}${NEW_PATH}`);
		expect(dataOf(mixed).hyperlink).toBe('[[另一个笔记]]');
	});

	it('命中但取值未变化时仍返回 true：命中即视为变更，不做相等判断', () => {
		const renamed = file(NEW_PATH);
		const { app } = fakeApp([renamed]);
		// 节点已是新资源地址（外部已同步）→ 命中即改写为同一值，但仍属「有变更」
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}${NEW_PATH}` });
		expect(updateReferencesOnRename(tree(pic), renamed, OLD_PATH, app)).toBe(true);
		expect(dataOf(pic).image).toBe(`${RESOURCE_PREFIX}${NEW_PATH}`);
	});

	it('未引用目标文件的树返回 false，且仍会取一次新资源地址', () => {
		const renamed = file(NEW_PATH);
		const { app, getFiles, getResourcePath } = fakeApp([renamed]);
		// 引用的是另一个文件（路径与末段都不匹配）：既不改值也不误判命中
		const other = node({
			text: '别的图',
			image: `${RESOURCE_PREFIX}assets/other.png`,
		});
		expect(updateReferencesOnRename(tree(other), renamed, OLD_PATH, app)).toBe(
			false,
		);
		expect(dataOf(other).image).toBe(`${RESOURCE_PREFIX}assets/other.png`);
		// 索引已建（预检发现树内有引用），资源地址在遍历前就取好了：
		// 即便一个节点都没命中，替换地址也已取过一次（这是实现顺序，不是缺陷）
		expect(getFiles).toHaveBeenCalledTimes(1);
		expect(replacementCalls(getResourcePath, 1)).toEqual([[renamed]]);
	});

	it('短文件名不因后缀误命中：a.png 不得命中 x/ba.png', () => {
		const target = file('x/ba.png');
		const { app } = fakeApp([target]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}a.png` });
		expect(updateReferencesOnRename(tree(pic), target, 'x/ba.png', app)).toBe(
			false,
		);
		expect(dataOf(pic).image).toBe(`${RESOURCE_PREFIX}a.png`);
	});
});

describe('重命名与清除的 mode 差异（共享同一遍历实现）', () => {
	it('纯文本树短路：不建索引、不取资源地址、直接返回 false', () => {
		const renamed = file('assets/新图.png');
		const { app, getFiles, getResourcePath } = fakeApp([renamed]);
		const plain = node({ text: '纯文本', tag: ['x'] });
		const root = tree(node({ text: '子' }, [plain]));

		expect(
			updateReferencesOnRename(root, renamed, 'assets/旧图.png', app),
		).toBe(false);
		// 分支归属：预检短路发生在建索引之前（getFiles 每次全量拷贝，必须省掉）
		expect(getFiles).not.toHaveBeenCalled();
		expect(getResourcePath).not.toHaveBeenCalled();
	});

	it('空串引用字段不构成引用：同样短路（不建索引）', () => {
		const renamed = file('assets/新图.png');
		const { app, getFiles } = fakeApp([renamed]);
		const empty = node({
			text: '空引用',
			image: '',
			hyperlink: '',
			mdWikiLinkpath: '',
		});
		expect(
			updateReferencesOnRename(tree(empty), renamed, 'assets/旧图.png', app),
		).toBe(false);
		expect(getFiles).not.toHaveBeenCalled();
	});

	it('回收站内的重命名：图片清空、链接与附件保留、不调用 getResourcePath', () => {
		// 用户视角是「删除」：图片引用改指向 .trash/ 只会让节点继续显示已删除的图片，
		// 故清空；而**链接与附件**按 K55 保留为未解析引用（Obsidian 语义，
		// 可随文件恢复而复原）
		const trashed = file('.trash/pic.png');
		const { app, getResourcePath } = fakeApp([trashed]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}assets/pic.png` });
		// 链接与附件按真实形态指向该图片文件（linkTargets 用 stripMd，只剥 .md，
		// 故 [[pic.png]] 命中而 [[pic]] 是「另一篇笔记」、不该命中）
		const link = node({ text: '链接', hyperlink: '[[pic.png]]' });
		const attach = node({
			text: '附件 pic.png',
			attachmentUrl: `${RESOURCE_PREFIX}assets/pic.png`,
			attachmentName: 'pic.png',
		});

		expect(
			updateReferencesOnRename(
				tree(pic, link, attach),
				trashed,
				'assets/pic.png',
				app,
			),
		).toBe(true);
		expect(dataOf(pic).image).toBe('');
		expect(dataOf(link).hyperlink, '链接只改不删（K55）').toBe('[[pic.png]]');
		expect(dataOf(attach).attachmentUrl, '附件整条删除（K55）').toBeUndefined();
		expect(dataOf(attach).text, '可见名一并去掉').toBe('附件');
		// 分支归属：回收站场景不产出替换地址（索引构建那 1 次不算替换）
		expect(replacementCalls(getResourcePath, 1)).toEqual([]);
	});

	it('库根目录下的 .trash 自身也算回收站（相等形态）', () => {
		const trashed = file('.trash');
		const { app, getResourcePath } = fakeApp([trashed]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}a.png` });
		expect(updateReferencesOnRename(tree(pic), trashed, 'a.png', app)).toBe(true);
		expect(dataOf(pic).image).toBe('');
		expect(replacementCalls(getResourcePath, 1)).toEqual([]);
	});

	it('形似回收站的普通目录（.trashcan/）不触发退化：仍取新资源地址', () => {
		const moved = file('.trashcan/pic.png');
		const { app, getResourcePath } = fakeApp([moved]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}assets/pic.png` });
		expect(
			updateReferencesOnRename(tree(pic), moved, 'assets/pic.png', app),
		).toBe(true);
		expect(dataOf(pic).image).toBe(`${RESOURCE_PREFIX}.trashcan/pic.png`);
		expect(replacementCalls(getResourcePath, 1)).toEqual([[moved]]);
	});
});

describe('removeReferencesOnDelete：删除后清除引用', () => {
	it('图片清空为空串并返回 true，且从不调用 getResourcePath', () => {
		const gone = file('assets/pic.png');
		const { app, getFiles, getResourcePath } = fakeApp([gone]);
		const pic = node({ text: '图片', image: `${RESOURCE_PREFIX}assets/pic.png` });

		expect(removeReferencesOnDelete(tree(pic), gone, app)).toBe(true);
		expect(dataOf(pic).image).toBe('');
		// 删除模式没有「新地址」，绝不允许取资源地址（索引构建那 1 次不算替换）
		expect(replacementCalls(getResourcePath, 1)).toEqual([]);
		expect(getFiles).toHaveBeenCalledTimes(1);
	});

	it('附件删除：**整条删除**——字段清空、节点文字里的可见名一并去掉', () => {
		// 用户明确要求（2026-09-15）：附件不纳入「保留未解析引用」，删除后引用与
		// 文字一起去掉。只清字段会让名字在下次保存变成普通文本残留（K55）
		const gone = file('files/报 告.pdf');
		const { app } = fakeApp([gone]);
		const attach = node({
			text: '见 报 告.pdf 的说明',
			mdDerivedText: '见 报 告.pdf 的说明',
			attachmentUrl: `${RESOURCE_PREFIX}files/报 告.pdf`,
			attachmentName: '报 告.pdf',
			mdAttachmentLinkpath: 'files/报 告.pdf',
		});
		expect(removeReferencesOnDelete(tree(attach), gone, app)).toBe(true);
		const data = dataOf(attach);
		expect(data.attachmentUrl).toBeUndefined();
		expect(data.attachmentName).toBeUndefined();
		expect(data.mdAttachmentLinkpath).toBeUndefined();
		expect(data.text, '可见名去掉、双空格归一').toBe('见 的说明');
		expect(data.mdDerivedText, '保留旧派生值 ⇒ 视为已编辑 ⇒ 走合成').toBe(
			'见 报 告.pdf 的说明',
		);
	});

	it('回归：删除附件后行内只剩文字（引用与该段文字一起消失）', () => {
		const md = ['# 测试', '- 见 [[报告.pdf]] 的说明'].join('\n');
		const parsed = parseMdOutline(`${md}\n`, '测试').tree;
		const gone = file('报告.pdf');
		const { app } = fakeApp([gone]);

		expect(removeReferencesOnDelete(parsed, gone, app)).toBe(true);
		expect(serializeMdBody(parsed, null)).toBe(
			['# 测试', '- 见 的说明'].join('\n'),
		);
	});

	it('回归：纯附件节点被整条删除 → 节点一并摘除（不留空行）', () => {
		// 「整个删除」：引用、可见文字、以及已空的节点本身一起消失。若只清文字，
		// 序列化会留下空列表项 `- `，重新解析又变成一个 `-` 文本节点（脏数据）
		const md = ['# 测试', '- [[报告.pdf]]', '- 保留的节点'].join('\n');
		const parsed = parseMdOutline(`${md}\n`, '测试').tree;
		const gone = file('报告.pdf');
		const { app } = fakeApp([gone]);

		expect(removeReferencesOnDelete(parsed, gone, app)).toBe(true);
		const out = serializeMdBody(parsed, null);
		expect(out, '附件节点整条消失、邻节点不受影响').toBe(
			['# 测试', '- 保留的节点'].join('\n'),
		);
		expect(out).not.toContain('报告.pdf');
	});

	it('链接引用**保留**（未解析链接）且不算变更 → 不触发无意义保存', () => {
		// 2026-09-15 修订（K55）：删笔记不再清链接字段——此前清空字段但不动
		// text/mdSegments，下次保存会把 `[[笔记A]]` 静默降级为纯文本 `笔记A`
		const gone = file('folder/旧名.md');
		const { app } = fakeApp([gone]);
		const link = node({ text: '链接', hyperlink: '[[folder/旧名#小节|别名]]' });
		const doc = node({ text: '文档', mdWikiLinkpath: '[[旧名]]' });

		expect(
			removeReferencesOnDelete(tree(link, doc), gone, app),
			'仅链接引用的树：无改动',
		).toBe(false);
		expect(dataOf(link).hyperlink).toBe('[[folder/旧名#小节|别名]]');
		expect(dataOf(doc).mdWikiLinkpath).toBe('[[旧名]]');
	});

	it('删除模式：命中与否都保留链接（匹配判定由重命名模式体现）', () => {
		const gone = file('folder/旧名.md');
		const cases = [
			{ label: '裸名', link: '[[旧名]]' },
			{ label: '目录加裸名', link: '[[folder/旧名]]' },
			{ label: '完整路径含扩展名', link: '[[folder/旧名.md]]' },
			{ label: '别名形态', link: '[[旧名|看这里]]' },
			{ label: '不命中的链接', link: '[[另一个笔记]]' },
		];
		for (const { label, link } of cases) {
			const { app } = fakeApp([gone]);
			const target = node({ text: '链接', hyperlink: link });
			expect(removeReferencesOnDelete(tree(target), gone, app), label).toBe(
				false,
			);
			expect(dataOf(target).hyperlink, label).toBe(link);
		}
	});

	it('重命名模式：linkTargets 三形态仍照旧改写、非目标不动', () => {
		// 保留原有「匹配形态」覆盖——删除模式不再改写链接，故改由重命名模式锁定
		const renamed = file('folder/新名.md');
		const cases = [
			{ label: '裸名', link: '[[旧名]]', expected: '[[新名]]' },
			{ label: '目录加裸名', link: '[[folder/旧名]]', expected: '[[folder/新名]]' },
			{ label: '不命中：别的笔记', link: '[[另一个笔记]]', expected: null },
			{ label: '不命中：非维基链接', link: 'https://example.com/a', expected: null },
		];
		for (const { label, link, expected } of cases) {
			const { app } = fakeApp([renamed]);
			const target = node({ text: '链接', hyperlink: link });
			const changed = updateReferencesOnRename(
				tree(target),
				renamed,
				'folder/旧名.md',
				app,
			);
			expect(changed, label).toBe(expected !== null);
			expect(dataOf(target).hyperlink, label).toBe(expected ?? link);
		}
	});

	it('回归（用户实测）：删掉行内某个目标 → 整行**逐字不变**', () => {
		// 原样复现报告：`[[笔记A]]` 出现两次，其中一次是混排行的首链。删除
		// 笔记A.md 后，此处曾把两处 `[[笔记A]]` 都降级为纯文本 `笔记A`
		//（其余链接因台账仍在而保留语法）——首链字段被清、text/台账不动，
		// 下次保存的合成结果就是那个形状（K55）
		const md = [
			'# 测试',
			'- 单链接混排：见 [[笔记A]] 的说明',
			'- 多链接混排：见 [[笔记A]] 与 [[笔记B|乙]] 以及 [[笔记C]]',
		].join('\n');
		const parsed = parseMdOutline(`${md}\n`, '测试').tree;
		const gone = file('笔记A.md');
		const { app } = fakeApp([gone]);

		expect(removeReferencesOnDelete(parsed, gone, app)).toBe(false);
		expect(serializeMdBody(parsed, null), '文件逐字不变').toBe(md);
	});

	it('仅剩 mdAttachmentLinkpath 的节点：预检通过但该字段不被更新', () => {
		// mdAttachmentLinkpath 在 NODE_REFERENCE_FIELDS 中只用于「是否需要更新」的
		// 预检（漏在清单外会让仅剩它的节点被整体跳过），本模块不负责改写它。
		const gone = file('files/报 告.pdf');
		const { app, getFiles } = fakeApp([gone]);
		const attach = node({
			text: '附件',
			mdAttachmentLinkpath: 'files/报 告.pdf',
		});
		expect(removeReferencesOnDelete(tree(attach), gone, app)).toBe(false);
		expect(dataOf(attach).mdAttachmentLinkpath).toBe('files/报 告.pdf');
		// 关键证据：预检未被短路跳过（索引确实建了）
		expect(getFiles).toHaveBeenCalledTimes(1);
	});

	it('畸形与非字符串引用字段不抛错、不被改写', () => {
		const gone = file('folder/旧名.md');
		const { app } = fakeApp([gone]);
		const bad = node({
			text: '畸形',
			hyperlink: '[[旧名', // 未闭合：parseWikilink 返回 null
			mdWikiLinkpath: 42, // 非字符串：typeof 收窄后跳过
		});
		expect(removeReferencesOnDelete(tree(bad), gone, app)).toBe(false);
		expect(dataOf(bad).hyperlink).toBe('[[旧名');
		expect(dataOf(bad).mdWikiLinkpath).toBe(42);
	});

	it('未引用目标文件的树返回 false，各节点保持原值', () => {
		const gone = file('folder/旧名.md');
		const { app } = fakeApp([gone]);
		const other = node({
			text: '别的文件',
			image: `${RESOURCE_PREFIX}assets/other.png`,
			hyperlink: '[[另一个笔记]]',
		});
		expect(removeReferencesOnDelete(tree(other), gone, app)).toBe(false);
		expect(dataOf(other).image).toBe(`${RESOURCE_PREFIX}assets/other.png`);
		expect(dataOf(other).hyperlink).toBe('[[另一个笔记]]');
	});
});
