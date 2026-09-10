/**
 * links-resolve 回归测试：统一解析入口 resolvePathToFile 的按形态路由——
 * 远程拒绝 / obsidian:// / 资源地址（app://）→ 索引 / 路径直查 /
 * file:// → 官方 FileSystemAdapter 剥库根 → 官方解析轨 → 索引兜底，
 * 以及 resolveDroppedFile 的拖拽形态与 dragManager 私有触点。
 *
 * 断言策略：除了「解析出哪个 TFile」（身份比对），还用 spy 断言分支归属——
 * 早退分支不得触碰后序轨（如 app:// 分支不得调用官方解析器、直查命中不得
 * 建索引），并用 getFileByPath 的调用次数区分「file:// 分支是否真的剥了库根」
 * （降级时只会有直查那一次调用）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, FileSystemAdapter, TFile } from 'obsidian';
import { fileLookupIndex } from '../src/file-lookup';
import { resolveDroppedFile, resolvePathToFile } from '../src/links-resolve';

/** 资源地址前缀：fake vault 的 getResourcePath 输出形态 */
const RESOURCE_PREFIX = 'app://fake/';

/** FileSystemAdapter 桩：instanceof 判定走真实 mock 类，只覆写 getBasePath */
class FakeAdapter extends FileSystemAdapter {
	private readonly base: string;

	constructor(base: string) {
		super();
		this.base = base;
	}

	override getBasePath(): string {
		return this.base;
	}
}

function file(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ''),
	});
}

interface FakeAppOptions {
	/** 库根绝对路径：传入即挂 FileSystemAdapter 桩 */
	basePath?: string;
	/** 覆盖 vault.adapter（undefined / 非文件系统适配器用于降级分支） */
	adapter?: unknown;
	/** 官方解析轨 getFirstLinkpathDest；缺省按 basename/name 命中 */
	linkpathDest?: (linkpath: string) => TFile | null;
	/** Obsidian 拖拽私有触点 app.dragManager 的桩 */
	dragManager?: unknown;
}

function fakeApp(files: TFile[], opts: FakeAppOptions = {}) {
	const byPath = new Map(files.map((f) => [f.path, f] as const));
	const getFileByPath = vi.fn((p: string): TFile | null => byPath.get(p) ?? null);
	const getResourcePath = vi.fn(
		(f: TFile): string => `${RESOURCE_PREFIX}${f.path}`,
	);
	const getFiles = vi.fn((): TFile[] => files);
	const getFirstLinkpathDest = vi.fn(
		(linkpath: string): TFile | null =>
			opts.linkpathDest
				? opts.linkpathDest(linkpath)
				: (files.find(
						(f) => f.basename === linkpath || f.name === linkpath,
					) ?? null),
	);
	const adapter: unknown =
		'adapter' in opts
			? opts.adapter
			: opts.basePath === undefined
				? new FileSystemAdapter()
				: new FakeAdapter(opts.basePath);
	const app: App = Object.assign(new App(), {
		vault: { getFiles, getFileByPath, getResourcePath, adapter },
		metadataCache: { getFirstLinkpathDest },
		dragManager: opts.dragManager,
	});
	return {
		app,
		getFileByPath,
		getResourcePath,
		getFiles,
		getFirstLinkpathDest,
	};
}

/** 拖拽事件桩：只铺 resolveDroppedFile 读取的三个面 */
interface FakeDataTransferOptions {
	data?: Record<string, string>;
	types?: string[];
	files?: { name: string }[];
	/** getData 抛错的类型（某些自定义类型无法读取） */
	throwingTypes?: string[];
}

function fakeDataTransfer(opts: FakeDataTransferOptions = {}): DataTransfer {
	const data = opts.data ?? {};
	const throwing = new Set(opts.throwingTypes ?? []);
	const dt = {
		getData: vi.fn((type: string): string => {
			if (throwing.has(type)) {
				throw new Error('无法读取该类型');
			}
			return data[type] ?? '';
		}),
		types: opts.types ?? Object.keys(data),
		files: opts.files ?? [],
	};
	return dt as unknown as DataTransfer;
}

const FILES = [
	file('assets/pic.png'),
	file('notes/plan.mindmap.md'),
	file('assets/中文 附件.pdf'),
];

describe('resolvePathToFile：空值与远程拒绝', () => {
	it('空输入返回 null，且不触碰任何库 API（分支归属）', () => {
		const { app, getFileByPath, getFirstLinkpathDest, getFiles } = fakeApp(FILES);
		expect(resolvePathToFile('', app)).toBeNull();
		expect(getFileByPath).not.toHaveBeenCalled();
		expect(getFirstLinkpathDest).not.toHaveBeenCalled();
		expect(getFiles).not.toHaveBeenCalled();
	});

	it('纯空白输入裁剪后为空：返回 null 而不抛错（畸形输入）', () => {
		const { app } = fakeApp(FILES);
		expect(resolvePathToFile('   ', app)).toBeNull();
		expect(resolvePathToFile('\t\n', app)).toBeNull();
	});

	it('远程/数据地址直接拒绝：不进入任何库内解析分支（表驱动）', () => {
		const rejected = [
			'https://example.com/a.png',
			'http://example.com/a.png',
			'data:image/png;base64,xxx',
			'blob:https://example.com/uuid',
		];
		for (const url of rejected) {
			const { app, getFileByPath, getFirstLinkpathDest, getFiles } = fakeApp(
				FILES,
			);
			expect(resolvePathToFile(url, app), url).toBeNull();
			expect(getFileByPath).not.toHaveBeenCalled();
			expect(getFirstLinkpathDest).not.toHaveBeenCalled();
			expect(getFiles).not.toHaveBeenCalled();
		}
	});
});

describe('resolvePathToFile：路径直查', () => {
	it('完整路径命中即返回同一 TFile 实例，不进官方/索引轨（分支归属）', () => {
		const pic = FILES[0]!;
		const { app, getFirstLinkpathDest, getFiles } = fakeApp(FILES);
		expect(resolvePathToFile('assets/pic.png', app)).toBe(pic);
		// 直查命中即返回：不该再问官方解析器、更不该建索引
		expect(getFirstLinkpathDest).not.toHaveBeenCalled();
		expect(getFiles).not.toHaveBeenCalled();
	});

	it('反斜杠路径先经 normalizePath 归一后直查', () => {
		const pic = FILES[0]!;
		const { app, getFileByPath } = fakeApp(FILES);
		expect(resolvePathToFile('assets\\pic.png', app)).toBe(pic);
		expect(getFileByPath).toHaveBeenCalledWith('assets/pic.png');
	});

	it('首尾空白先裁剪，官方轨收到裁剪后的文本与空来源路径', () => {
		const plan = FILES[1]!;
		const { app, getFirstLinkpathDest } = fakeApp(FILES);
		expect(resolvePathToFile('  plan.mindmap  ', app)).toBe(plan);
		// 第二参数是来源文件路径：无来源时恒为 ''
		expect(getFirstLinkpathDest).toHaveBeenCalledWith('plan.mindmap', '');
	});
});

describe('resolvePathToFile：obsidian:// 分支', () => {
	it('file 参数三级依次承接：路径直查 → 补 .md → 官方解析', () => {
		const pic = FILES[0]!;
		const plan = FILES[1]!;

		// 一级：file 参数就是库内完整路径
		const direct = fakeApp(FILES);
		expect(
			resolvePathToFile(
				`obsidian://open?vault=v&file=${encodeURIComponent('assets/pic.png')}`,
				direct.app,
			),
		).toBe(pic);
		// 直查命中即返回，不进官方轨
		expect(direct.getFirstLinkpathDest).not.toHaveBeenCalled();

		// 二级：省略 .md 扩展名的笔记链接
		const suppressed = fakeApp(FILES);
		expect(
			resolvePathToFile('obsidian://open?file=notes/plan.mindmap', suppressed.app),
		).toBe(plan);
		expect(suppressed.getFileByPath).toHaveBeenNthCalledWith(
			1,
			'notes/plan.mindmap',
		);
		expect(suppressed.getFileByPath).toHaveBeenNthCalledWith(
			2,
			'notes/plan.mindmap.md',
		);

		// 三级：只有 basename（无目录）→ 交官方解析器消歧
		const byName = fakeApp(FILES);
		expect(
			resolvePathToFile('obsidian://open?file=plan.mindmap', byName.app),
		).toBe(plan);
		expect(byName.getFirstLinkpathDest).toHaveBeenCalledWith('plan.mindmap', '');
	});

	it('file 参数做 URL 解码（%2F 与二次编码 %2520）', () => {
		const pic = FILES[0]!;
		const spaced = file('assets/a b.png');
		const { app, getFileByPath } = fakeApp([...FILES, spaced]);
		expect(
			resolvePathToFile('obsidian://open?file=assets%2Fpic.png', app),
		).toBe(pic);

		// %2520 先被 searchParams 解成 %20，再被 decodeURIComponent 解成空格
		expect(resolvePathToFile('obsidian://open?file=a%2520b.png', app)).toBe(
			spaced,
		);
		expect(getFileByPath).toHaveBeenCalledWith('a b.png');
	});

	it('无 file 参数（缺失/空值/畸形）返回 null，不落到其它分支', () => {
		const noParam = [
			'obsidian://open?vault=v',
			'obsidian://open?file=',
			'obsidian://',
			'obsidian:///',
		];
		for (const url of noParam) {
			const { app, getFileByPath, getFirstLinkpathDest, getFiles } = fakeApp(
				FILES,
			);
			expect(resolvePathToFile(url, app), url).toBeNull();
			// obsidian:// 是自带语义的形态：缺 file 参数即失败，不做猜测兜底
			expect(getFileByPath).not.toHaveBeenCalled();
			expect(getFirstLinkpathDest).not.toHaveBeenCalled();
			expect(getFiles).not.toHaveBeenCalled();
		}
	});

	it('file 参数含畸形转义（%A）时吞掉解码异常，返回 null 且不做查找', () => {
		const { app, getFileByPath, getFirstLinkpathDest } = fakeApp(FILES);
		// searchParams 把 %E0%A4%A 解成「替换字符 + %A」，再解码即 URIError
		expect(resolvePathToFile('obsidian://open?file=%E0%A4%A', app)).toBeNull();
		expect(getFileByPath).not.toHaveBeenCalled();
		expect(getFirstLinkpathDest).not.toHaveBeenCalled();
	});
});

describe('resolvePathToFile：资源地址（app://）分支', () => {
	beforeEach(() => {
		fileLookupIndex.invalidate();
	});

	it('资源地址经共享索引直达，返回索引中的 TFile 身份', () => {
		const url = `${RESOURCE_PREFIX}assets/pic.png`;
		const { app, getFileByPath, getFiles, getFirstLinkpathDest } = fakeApp(FILES);
		const index = fileLookupIndex.get(app);
		expect(resolvePathToFile(url, app)).toBe(index.get('assets/pic.png'));
		// 分支归属：完全不过官方解析轨（app:// 只由索引承接）
		expect(getFirstLinkpathDest).not.toHaveBeenCalled();
		// 唯一的 getFileByPath 调用来自索引内部的直查候选，地址原样传入
		// （没有库根剥离/归一化，说明没走 file:// 或路径直查分支）
		expect(getFileByPath).toHaveBeenCalledTimes(1);
		expect(getFileByPath).toHaveBeenCalledWith(url);
		// 索引按需惰性构建，且只扫描一次文件列表
		expect(getFiles).toHaveBeenCalledTimes(1);
	});

	it('资源地址未命中返回 null：不误当库内路径、不过官方轨', () => {
		const url = `${RESOURCE_PREFIX}nowhere.png`;
		const { app, getFileByPath, getFirstLinkpathDest } = fakeApp(FILES);
		expect(resolvePathToFile(url, app)).toBeNull();
		expect(getFileByPath).toHaveBeenCalledWith(url);
		expect(getFirstLinkpathDest).not.toHaveBeenCalled();
	});
});

describe('resolvePathToFile：file:// 分支（FileSystemAdapter）', () => {
	it('POSIX 绝对路径剥离库根后命中', () => {
		const pic = FILES[0]!;
		const { app, getFileByPath } = fakeApp(FILES, { basePath: '/home/u/vault' });
		const url = `file://${encodeURIComponent('/home/u/vault/assets/pic.png')}`;
		expect(resolvePathToFile(url, app)).toBe(pic);
		expect(getFileByPath).toHaveBeenLastCalledWith('assets/pic.png');
	});

	it('库根前缀匹配大小写不敏感，且切片保留文件真实大小写', () => {
		// 库根写成小写 + 尾斜杠，绝对路径全大写：前缀匹配必须大小写不敏感，
		// 但返回的相对路径按原串切片，保留 'Assets/Pic.png' 的真实大小写
		const cased = file('Assets/Pic.png');
		const { app, getFileByPath } = fakeApp([...FILES, cased], {
			basePath: '/home/u/vault/',
		});
		const url = `file://${encodeURIComponent('/HOME/U/VAULT/Assets/Pic.png')}`;
		expect(resolvePathToFile(url, app)).toBe(cased);
		expect(getFileByPath).toHaveBeenLastCalledWith('Assets/Pic.png');
	});

	it('Windows 盘符形态（file:///C:/…）不剥库根，由索引后缀兜底（实测行为）', () => {
		// stripVaultBase 要求绝对路径以 '/' 开头，而 'file:///C:/…' 解出的是
		// '/C:/…'（首字符是斜杠、库根却是 'C:/…'）→ 前缀不匹配、相对路径为 null；
		// 因此 Windows 上该形态落到官方轨未命中后由索引按文件名后缀兜底命中。
		const pic = FILES[0]!;
		const url = 'file:///C:/vault/assets/pic.png';
		const { app, getFileByPath, getFirstLinkpathDest } = fakeApp(FILES, {
			basePath: 'C:\\Vault',
		});
		expect(resolvePathToFile(url, app)).toBe(pic);
		// 官方轨确实被咨询过（file:// 分支没有产出相对路径）
		expect(getFirstLinkpathDest).toHaveBeenCalledWith(url, '');
		// 从未用剥出的相对路径去直查
		expect(getFileByPath).not.toHaveBeenCalledWith('assets/pic.png');
	});

	it('库根为空串时按根剥离（getBasePath 返回空的防御边界）', () => {
		const pic = FILES[0]!;
		const { app } = fakeApp(FILES, { basePath: '' });
		expect(resolvePathToFile('file:///assets/pic.png', app)).toBe(pic);
	});

	it('路径不在库内时不命中，落到官方轨（收到原始 file:// 文本）', () => {
		const { app, getFirstLinkpathDest } = fakeApp(FILES, {
			basePath: '/home/u/vault',
			linkpathDest: () => null,
		});
		const url = `file://${encodeURIComponent('/elsewhere/mystery.png')}`;
		expect(resolvePathToFile(url, app)).toBeNull();
		expect(getFirstLinkpathDest).toHaveBeenCalledWith(url, '');
	});

	it('adapter 缺失或非 FileSystemAdapter 时降级到官方轨，不解码库根', () => {
		const pic = FILES[0]!;
		const cases: { label: string; adapter: unknown }[] = [
			{ label: 'adapter 缺失', adapter: undefined },
			{ label: 'adapter 非文件系统适配器', adapter: {} },
		];
		for (const { label, adapter } of cases) {
			const { app, getFileByPath, getFirstLinkpathDest } = fakeApp(FILES, {
				adapter,
				linkpathDest: () => null,
			});
			const url = `file://${encodeURIComponent('/home/u/vault/assets/pic.png')}`;
			// 官方轨未命中 → 索引按文件名后缀兜底命中（file:// 分支已被跳过）
			expect(resolvePathToFile(url, app), label).toBe(pic);
			// 关键证据：从未用剥出的相对路径直查（即未解码库根）
			expect(getFileByPath, label).not.toHaveBeenCalledWith('assets/pic.png');
			// 降级后由官方解析轨承接，收到的是原始 file:// 文本
			expect(getFirstLinkpathDest, label).toHaveBeenCalledWith(url, '');
		}
	});

	it('file:// 路径含畸形转义（未编码 %）时吞掉解码异常，落到官方轨', () => {
		const { app, getFirstLinkpathDest } = fakeApp(FILES, {
			basePath: '/home/u/vault',
			linkpathDest: () => null,
		});
		expect(resolvePathToFile('file://%E0%A4%A', app)).toBeNull();
		expect(getFirstLinkpathDest).toHaveBeenCalledWith('file://%E0%A4%A', '');
	});
});

describe('resolvePathToFile：官方解析轨与索引兜底', () => {
	beforeEach(() => {
		fileLookupIndex.invalidate();
	});

	it('官方解析器承接 basename 消歧（与 Obsidian 内部 [[链接]] 同款规则）', () => {
		const plan = FILES[1]!;
		const { app, getFirstLinkpathDest } = fakeApp(FILES);
		expect(resolvePathToFile('plan.mindmap', app)).toBe(plan);
		expect(getFirstLinkpathDest).toHaveBeenCalledWith('plan.mindmap', '');
	});

	it('官方未命中时索引兜底：URL 编码名与 Windows 绝对路径形态都能命中', () => {
		const attachment = FILES[2]!;
		const pic = FILES[0]!;
		const { app, getFirstLinkpathDest } = fakeApp(FILES, {
			linkpathDest: () => null,
		});
		const encoded = encodeURIComponent('assets/中文 附件.pdf');
		expect(resolvePathToFile(encoded, app)).toBe(attachment);
		expect(resolvePathToFile('C:\\vault\\assets\\pic.png', app)).toBe(pic);
		// 兜底轨确实在官方轨之后被调用过
		expect(getFirstLinkpathDest).toHaveBeenCalledTimes(2);
	});

	it('官方与索引都未命中时返回 null（不抛错）', () => {
		const { app } = fakeApp(FILES, { linkpathDest: () => null });
		expect(resolvePathToFile('missing/nowhere.png', app)).toBeNull();
	});
});

describe('resolveDroppedFile（拖拽形态与 dragManager 私有触点）', () => {
	it('text/plain 优先：库内路径直接命中', () => {
		const pic = FILES[0]!;
		const { app } = fakeApp(FILES);
		const dt = fakeDataTransfer({
			data: { 'text/plain': 'assets/pic.png' },
			types: ['text/plain'],
		});
		expect(resolveDroppedFile(dt, app)).toBe(pic);
	});

	it('text/uri-list 的 file:// 行解码后逐条尝试（前面几行落空不阻断）', () => {
		const pic = FILES[0]!;
		const { app } = fakeApp(FILES);
		const dt = fakeDataTransfer({
			data: {
				'text/uri-list':
					'file:///elsewhere/missing.png\r\n' +
					`file://${encodeURIComponent('/elsewhere/assets/pic.png')}`,
			},
			types: ['text/uri-list'],
		});
		// 第二行解码后经索引后缀兜底命中库内文件
		expect(resolveDroppedFile(dt, app)).toBe(pic);
	});

	it('dragManager.dragData 兜底：path / file.path / files[0].path 三种形态（私有触点）', () => {
		const pic = FILES[0]!;
		const shapes: { label: string; dragData: unknown }[] = [
			{ label: 'dragData.path', dragData: { path: 'assets/pic.png' } },
			{
				label: 'dragData.file.path',
				dragData: { file: { path: 'assets/pic.png' } },
			},
			{
				label: 'dragData.files[0].path',
				dragData: { files: [{ path: 'assets/pic.png' }] },
			},
		];
		for (const { label, dragData } of shapes) {
			const { app } = fakeApp(FILES, { dragManager: { dragData } });
			// 事件里没有任何可解析的文本：只能靠 Obsidian 私有拖拽数据
			const dt = fakeDataTransfer();
			expect(resolveDroppedFile(dt, app), label).toBe(pic);
		}
	});

	it('dragManager 缺失、dragData 为空或候选未命中时返回 null（不抛错）', () => {
		const cases: { label: string; dragManager: unknown }[] = [
			{ label: '无 dragManager', dragManager: undefined },
			{ label: '空 dragManager', dragManager: {} },
			{
				label: 'dragData 候选未命中',
				dragManager: { dragData: { path: 'missing.png' } },
			},
		];
		for (const { label, dragManager } of cases) {
			const { app } = fakeApp(FILES, { dragManager });
			expect(resolveDroppedFile(fakeDataTransfer(), app), label).toBeNull();
		}
	});

	it('dragManager.dragData 读取抛错时吞掉异常返回 null', () => {
		// 私有触点可能整体不可用：getter 抛错也必须被吞掉
		const broken: Record<string, unknown> = {};
		Object.defineProperty(broken, 'dragData', {
			get() {
				throw new Error('dragManager 不可用');
			},
		});
		const { app } = fakeApp(FILES, { dragManager: broken });
		expect(resolveDroppedFile(fakeDataTransfer(), app)).toBeNull();
	});

	it('dataTransfer.files 兜底：唯一同名命中、同名歧义则拒绝', () => {
		const pic = FILES[0]!;
		const unique = fakeApp(FILES);
		expect(
			resolveDroppedFile(
				fakeDataTransfer({ files: [{ name: 'pic.png' }] }),
				unique.app,
			),
		).toBe(pic);

		// 两个同名文件：拒绝解析，避免操作到错误文件
		const ambiguous = fakeApp([file('a/dup.png'), file('b/dup.png')]);
		expect(
			resolveDroppedFile(
				fakeDataTransfer({ files: [{ name: 'dup.png' }] }),
				ambiguous.app,
			),
		).toBeNull();
	});

	it('自定义 MIME 类型的 JSON 载荷兜底解析（path/file.path/filePath/url）', () => {
		const pic = FILES[0]!;
		const { app } = fakeApp(FILES);
		const dt = fakeDataTransfer({
			data: {
				'application/x-obsidian': JSON.stringify({
					file: { path: 'assets/pic.png' },
				}),
			},
			types: ['application/x-obsidian'],
		});
		expect(resolveDroppedFile(dt, app)).toBe(pic);
	});
});
