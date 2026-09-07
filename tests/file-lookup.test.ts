/**
 * file-lookup 回归测试：全库查找索引的构建键覆盖、缓存复用/失效、
 * 以及 lookupIndexedFile 的形态匹配（直查/URL 解码/路径后缀/远程拒绝）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { App, TFile } from 'obsidian';
import {
	buildFileLookupIndex,
	fileLookupIndex,
	FileLookupIndexService,
	lookupIndexedFile,
} from '../src/file-lookup';

function file(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		name: path.split('/').pop() ?? path,
		basename: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
	});
}

function fakeApp(files: TFile[]): App {
	const byPath = new Map(files.map((f) => [f.path, f] as const));
	return Object.assign(new App(), {
		vault: {
			getFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getResourcePath: (f: TFile) => `app://fake/${f.path}`,
		},
	});
}

describe('buildFileLookupIndex（索引键覆盖）', () => {
	it('索引包含完整路径、文件名、URL 编码名与路径后缀形态', () => {
		const app = fakeApp([]);
		const target = file('assets/sub/图 片.png');
		const index = buildFileLookupIndex(app, [target]);

		expect(index.get('assets/sub/图 片.png')).toBe(target);
		expect(index.get('图 片.png')).toBe(target);
		expect(index.get(encodeURIComponent('图 片.png'))).toBe(target);
		expect(index.get('sub/图 片.png')).toBe(target);
		// 资源地址形态（getResourcePath 输出）
		expect(index.get(`app://fake/${target.path}`)).toBe(target);
	});
});

describe('FileLookupIndexService（缓存判效与失效）', () => {
	// 独立实例做隔离，避免触碰跨测试共享的插件级单例
	const service = new FileLookupIndexService();

	it('文件数量不变时复用同一缓存实例', () => {
		const app = fakeApp([file('a.png')]);
		const first = service.get(app);
		const second = service.get(app);
		expect(second).toBe(first);
	});

	it('文件数量变化后重建', () => {
		const app = fakeApp([file('a.png')]);
		const first = service.get(app);
		const bigger = fakeApp([file('a.png'), file('b.png')]);
		const rebuilt = service.get(bigger);
		expect(rebuilt).not.toBe(first);
		expect(rebuilt.get('b.png')).toBeDefined();
	});

	it('invalidate 后立即重建', () => {
		const app = fakeApp([file('a.png')]);
		const first = service.get(app);
		service.invalidate();
		expect(service.get(app)).not.toBe(first);
	});
});

describe('lookupIndexedFile（形态匹配）', () => {
	beforeEach(() => {
		fileLookupIndex.invalidate();
	});

	const files = [
		file('assets/pic.png'),
		file('assets/sub/中文 附件.pdf'),
	];

	it('完整路径直查命中', () => {
		const app = fakeApp(files);
		expect(lookupIndexedFile('assets/pic.png', app, fileLookupIndex.get(app))?.path).toBe(
			'assets/pic.png',
		);
	});

	it('URL 解码后的候选命中（中文/空格编码名）', () => {
		const app = fakeApp(files);
		const encoded = encodeURIComponent('assets/中文 附件.pdf');
		expect(lookupIndexedFile(encoded, app, fileLookupIndex.get(app))?.path).toBe(
			'assets/sub/中文 附件.pdf',
		);
	});

	it('路径后缀回退命中（绝对路径/历史形态）', () => {
		const app = fakeApp(files);
		expect(
			lookupIndexedFile('C:\\vault\\assets\\pic.png', app, fileLookupIndex.get(app))
				?.path,
		).toBe('assets/pic.png');
	});

	it('资源地址形态命中', () => {
		const app = fakeApp(files);
		expect(
			lookupIndexedFile('app://fake/assets/pic.png', app, fileLookupIndex.get(app))
				?.path,
		).toBe('assets/pic.png');
	});

	it('远程/数据地址直接拒绝', () => {
		const app = fakeApp(files);
		const index = fileLookupIndex.get(app);
		expect(lookupIndexedFile('https://example.com/a.png', app, index)).toBeNull();
		expect(lookupIndexedFile('data:image/png;base64,xxx', app, index)).toBeNull();
	});

	it('无命中返回 null', () => {
		const app = fakeApp(files);
		expect(lookupIndexedFile('nope.png', app, fileLookupIndex.get(app))).toBeNull();
	});
});
