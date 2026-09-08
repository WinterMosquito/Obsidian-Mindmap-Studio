/**
 * links-resolve 回归测试：resolvePathToFile 按形态路由的分支矩阵——
 * 远程拒绝 / 完整路径直查 / basename 官方解析 / obsidian:// /
 * 资源地址索引 / file:// 库根剥离 / URL 编码名兜底 / 空值。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { App, FileSystemAdapter, TFile } from 'obsidian';
import { resolvePathToFile } from '../src/links-resolve';
import { fileLookupIndex } from '../src/file-lookup';

class FakeAdapter extends FileSystemAdapter {
	constructor(private readonly base: string) {
		super();
	}
	override getBasePath(): string {
		return this.base;
	}
}

interface FakeAppOptions {
	basePath?: string;
	/** getFirstLinkpathDest 的 basename → 文件 映射（默认按 basename/name 匹配） */
	linkpathDest?: (linkpath: string) => TFile | null;
}

function fakeApp(files: TFile[], opts: FakeAppOptions = {}): App {
	const byPath = new Map(files.map((f) => [f.path, f] as const));
	const app = Object.assign(new App(), {
		vault: {
			getFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getFolderByPath: () => null,
			getResourcePath: (f: TFile) => `app://fake/${f.path}`,
			adapter: opts.basePath ? new FakeAdapter(opts.basePath) : new FileSystemAdapter(),
		},
		metadataCache: {
			getFirstLinkpathDest:
				opts.linkpathDest ??
				((linkpath: string) =>
					files.find((f) => f.basename === linkpath || f.name === linkpath) ??
					null),
		},
	});
	return app;
}

function file(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		name: path.split('/').pop() ?? path,
		basename: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
	});
}

const FILES = [
	file('assets/pic.png'),
	file('notes/plan.mindmap.md'),
	file('assets/中文 附件.pdf'),
];

describe('resolvePathToFile（形态路由）', () => {
	beforeEach(() => {
		// 资源地址分支走插件级索引单例，测试间失效重建
		fileLookupIndex.invalidate();
	});

	it('空值返回 null', () => {
		const app = fakeApp(FILES);
		expect(resolvePathToFile('', app)).toBeNull();
	});

	it('远程/数据地址直接拒绝', () => {
		const app = fakeApp(FILES);
		expect(resolvePathToFile('https://example.com/a.png', app)).toBeNull();
		expect(resolvePathToFile('http://example.com/a.png', app)).toBeNull();
		expect(resolvePathToFile('data:image/png;base64,xxx', app)).toBeNull();
		expect(resolvePathToFile('blob:xxx', app)).toBeNull();
	});

	it('完整路径直查命中（含首尾空白裁剪）', () => {
		const app = fakeApp(FILES);
		expect(resolvePathToFile('assets/pic.png', app)?.path).toBe('assets/pic.png');
		expect(resolvePathToFile('  assets/pic.png  ', app)?.path).toBe('assets/pic.png');
	});

	it('basename 经官方链接解析器命中', () => {
		const app = fakeApp(FILES);
		// 'plan.mindmap.md' 的 basename 为 'plan.mindmap'（仅去 .md）
		expect(resolvePathToFile('plan.mindmap', app)?.path).toBe(
			'notes/plan.mindmap.md',
		);
	});

	it('官方解析器未命中且无索引兜底时返回 null', () => {
		const app = fakeApp(FILES, { linkpathDest: () => null });
		expect(resolvePathToFile('missing', app)).toBeNull();
	});

	it('obsidian:// 链接按 file 参数解析（URL 解码）', () => {
		const app = fakeApp(FILES);
		const url = `obsidian://open?vault=v&file=${encodeURIComponent('assets/pic.png')}`;
		expect(resolvePathToFile(url, app)?.path).toBe('assets/pic.png');
	});

	it('obsidian:// 无 file 参数返回 null', () => {
		const app = fakeApp(FILES);
		expect(resolvePathToFile('obsidian://open', app)).toBeNull();
	});

	it('资源地址（app://）经索引兜底命中', () => {
		const app = fakeApp(FILES);
		// 先触发一次索引构建（与生产一致：查询时惰性构建）
		expect(resolvePathToFile('app://fake/assets/pic.png', app)?.path).toBe(
			'assets/pic.png',
		);
	});

	it('file:// 绝对路径剥离库根后命中', () => {
		const app = fakeApp(FILES, { basePath: '/home/u/vault' });
		const url = `file://${encodeURIComponent('/home/u/vault/assets/pic.png')}`;
		expect(resolvePathToFile(url, app)?.path).toBe('assets/pic.png');
	});

	it('file:// 路径不在库内时返回 null（官方解析器亦未命中）', () => {
		const app = fakeApp(FILES, {
			basePath: '/home/u/vault',
			linkpathDest: () => null,
		});
		// 文件名同样不在库内（避免索引按名字形态兜底命中）
		const url = `file://${encodeURIComponent('/elsewhere/mystery.png')}`;
		expect(resolvePathToFile(url, app)).toBeNull();
	});

	it('URL 编码名经索引兜底命中', () => {
		const app = fakeApp(FILES, { linkpathDest: () => null });
		const encoded = encodeURIComponent('assets/中文 附件.pdf');
		expect(resolvePathToFile(encoded, app)?.path).toBe('assets/中文 附件.pdf');
	});
});
