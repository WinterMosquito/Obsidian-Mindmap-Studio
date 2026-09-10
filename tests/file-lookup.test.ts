/**
 * file-lookup 回归测试：全库索引的键形态覆盖、服务层缓存判效与失效，
 * 以及 lookupIndexedFile 的 O(1) 形态命中（直查/解码/路径后缀/远程拒绝/自愈）。
 *
 * 断言策略：除「命中哪个 TFile」外，还用 spy 断言 getFiles 的调用次数——
 * 命中快路径不得重扫文件列表（getFiles 每次全量拷贝数组，大库下是主要成本），
 * 这既是性能契约也是「缓存是否真的生效」的唯一可观测证据。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import {
	buildFileLookupIndex,
	fileLookupIndex,
	FileLookupIndexService,
	lookupIndexedFile,
} from '../src/file-lookup';

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

interface FakeAppOptions {
	/** getResourcePath 抛错：覆盖索引构建时资源地址形态失败的分支 */
	resourcePathThrows?: boolean;
	/** getFileByPath 抛错：覆盖 lookupIndexedFile 的异常兜底分支 */
	getFileByPathThrows?: boolean;
}

function fakeApp(files: TFile[], opts: FakeAppOptions = {}) {
	const byPath = new Map(files.map((f) => [f.path, f] as const));
	const getFileByPath = vi.fn((p: string): TFile | null => {
		if (opts.getFileByPathThrows) {
			throw new Error('vault 不可用');
		}
		return byPath.get(p) ?? null;
	});
	const getResourcePath = vi.fn((f: TFile): string => {
		if (opts.resourcePathThrows) {
			throw new Error('adapter 不可用');
		}
		return `${RESOURCE_PREFIX}${f.path}`;
	});
	const getFiles = vi.fn((): TFile[] => files);
	const app: App = Object.assign(new App(), {
		vault: { getFiles, getFileByPath, getResourcePath },
	});
	return { app, getFiles, getFileByPath, getResourcePath };
}

describe('buildFileLookupIndex（索引键形态）', () => {
	it('完整路径/文件名/URL 编码名/路径后缀/资源地址五种形态都指向同一 TFile', () => {
		const { app } = fakeApp([]);
		const target = file('assets/sub/图 片.png');
		const index = buildFileLookupIndex(app, [target]);

		const hitForms = [
			'assets/sub/图 片.png', // 完整库内路径
			'sub/图 片.png', // 路径后缀（兼容绝对路径/历史数据形态）
			'图 片.png', // 裸文件名
			encodeURIComponent('图 片.png'), // URL 编码文件名
			`${RESOURCE_PREFIX}assets/sub/图 片.png`, // 资源地址
		];
		for (const key of hitForms) {
			expect(index.get(key), key).toBe(target);
		}
		// 键集合是有限闭集：路径+文件名+编码名+两段后缀+资源地址 = 5
		// （三段后缀与完整路径同键、编码名与原名同键时不再新增）
		expect(index.size).toBe(5);
	});

	it('单段路径不产生额外后缀键（后缀从两段起算）', () => {
		const { app } = fakeApp([]);
		const target = file('pic.png');
		const index = buildFileLookupIndex(app, [target]);
		expect(index.get('pic.png')).toBe(target);
		// 仅 路径 与 资源地址 两个键：不存在 'ic.png' 这类伪后缀
		expect(index.size).toBe(2);
	});

	it('同名文件的后缀键后写覆盖：消歧交由官方解析轨，索引只保证可达', () => {
		const { app } = fakeApp([]);
		const first = file('a/x.png');
		const second = file('b/x.png');
		const index = buildFileLookupIndex(app, [first, second]);
		// 完整路径各自独立
		expect(index.get('a/x.png')).toBe(first);
		expect(index.get('b/x.png')).toBe(second);
		// 裸文件名键被后写者覆盖（Map.set 语义，不抛错）
		expect(index.get('x.png')).toBe(second);
	});

	it('文件名含孤立代理项（encodeURIComponent 抛错）时跳过该形态而不中断构建', () => {
		const { app } = fakeApp([]);
		// '\uD800' 是未配对的代理项：encodeURIComponent 抛 URIError
		const target = file('assets/\uD800.png');
		const index = buildFileLookupIndex(app, [target]);
		expect(index.get('assets/\uD800.png')).toBe(target);
		expect(index.get('\uD800.png')).toBe(target);
		// 资源地址形态仍写入（该分支不依赖编码）
		expect(index.get(`${RESOURCE_PREFIX}assets/\uD800.png`)).toBe(target);
	});

	it('getResourcePath 抛错时跳过资源地址形态，其余键仍在', () => {
		const { app } = fakeApp([], { resourcePathThrows: true });
		const target = file('assets/pic.png');
		const index = buildFileLookupIndex(app, [target]);
		expect(index.get('assets/pic.png')).toBe(target);
		expect(index.get('pic.png')).toBe(target);
		expect(index.get(`${RESOURCE_PREFIX}assets/pic.png`)).toBeUndefined();
	});
});

describe('FileLookupIndexService（缓存判效与失效）', () => {
	// 独立实例做隔离，避免触碰跨测试共享的插件级单例
	const service = new FileLookupIndexService();

	it('get 命中快路径：缓存存在即复用，且不重扫文件列表', () => {
		const { app, getFiles } = fakeApp([file('a.png')]);
		const first = service.get(app);
		expect(service.get(app)).toBe(first);
		expect(service.get(app)).toBe(first);
		// 三次取用只扫描一次文件列表（高频路径必须回到 O(1)）
		expect(getFiles).toHaveBeenCalledTimes(1);
	});

	it('get 不做数量比对：库文件数变化但未显式失效时仍复用旧缓存', () => {
		const first = service.get(fakeApp([file('a.png')]).app);
		const app2 = fakeApp([file('a.png'), file('b.png')]);
		// 新鲜度由库事件 invalidate 保证，get 不为此付出全量扫描成本
		expect(service.get(app2.app)).toBe(first);
		expect(app2.getFiles).not.toHaveBeenCalled();
	});

	it('validate 按文件数量判效：数量一致复用、数量变化重建', () => {
		const app1 = fakeApp([file('a.png')]);
		const cached = service.get(app1.app);
		expect(service.validate(app1.app)).toBe(cached);

		const app2 = fakeApp([file('a.png'), file('b.png')]);
		const rebuilt = service.validate(app2.app);
		expect(rebuilt).not.toBe(cached);
		expect(rebuilt.get('b.png')?.path).toBe('b.png');
		// 重建结果本身也被缓存：再次 validate 复用同一实例
		expect(service.validate(app2.app)).toBe(rebuilt);
	});

	it('validate 重建复用同一次扫描结果（getFiles 只调用一次）', () => {
		const app1 = fakeApp([file('a.png')]);
		service.get(app1.app);
		const app2 = fakeApp([file('a.png'), file('b.png')]);
		service.validate(app2.app);
		expect(app2.getFiles).toHaveBeenCalledTimes(1);
	});

	it('无缓存时 validate 也会构建（慢路径可独立使用）', () => {
		const app = fakeApp([file('a.png')]);
		const index = service.validate(app.app);
		expect(index.get('a.png')?.path).toBe('a.png');
	});

	it('invalidate 清空缓存：下次取用即重建（且计数归零，validate 亦重建）', () => {
		const app = fakeApp([file('a.png')]);
		const first = service.get(app.app);
		service.invalidate();
		expect(service.get(app.app)).not.toBe(first);
		service.invalidate();
		const stale = service.get(app.app);
		service.invalidate();
		// 计数归零后即便文件数量一致也必须重建（否则会复用已被丢弃的映射）
		expect(service.validate(app.app)).not.toBe(stale);
	});
});

describe('lookupIndexedFile（形态匹配）', () => {
	const files = [file('assets/pic.png'), file('assets/中文 附件.pdf')];

	beforeEach(() => {
		// 自愈分支读插件级单例，逐用例失效重建
		fileLookupIndex.invalidate();
	});

	it('完整路径直查优先命中（传空索引也能命中，证明直查在索引之前）', () => {
		const { app, getFileByPath } = fakeApp(files);
		const hit = lookupIndexedFile('assets/pic.png', app, new Map());
		expect(hit?.path).toBe('assets/pic.png');
		expect(getFileByPath).toHaveBeenCalledWith('assets/pic.png');
	});

	it('资源地址形态经索引命中，且返回索引中的 TFile 身份', () => {
		const { app } = fakeApp(files);
		const index = fileLookupIndex.get(app);
		const hit = lookupIndexedFile(
			`${RESOURCE_PREFIX}assets/pic.png`,
			app,
			index,
		);
		expect(hit).toBe(index.get('assets/pic.png'));
	});

	it('URL 编码名候选命中（中文/空格编码形态）', () => {
		const { app } = fakeApp(files);
		const encoded = encodeURIComponent('assets/中文 附件.pdf');
		expect(lookupIndexedFile(encoded, app, fileLookupIndex.get(app))?.path).toBe(
			'assets/中文 附件.pdf',
		);
	});

	it('路径后缀回退命中（Windows 绝对路径形态）', () => {
		const { app } = fakeApp(files);
		expect(
			lookupIndexedFile('C:\\vault\\assets\\pic.png', app, fileLookupIndex.get(app))
				?.path,
		).toBe('assets/pic.png');
	});

	it('含未编码 % 的地址：解码候选被跳过，仍按原样地址命中', () => {
		// 该文件名含裸 %：decodeURIComponent 抛错，若未吞掉异常整次查询会失败
		const weird = file('assets/weird%name.png');
		const { app } = fakeApp([weird]);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			expect(
				lookupIndexedFile('weird%name.png', app, fileLookupIndex.get(app)),
			).toBe(weird);
			expect(error).not.toHaveBeenCalled();
		} finally {
			error.mockRestore();
		}
	});

	it('空值与远程/数据地址直接拒绝，不触碰库 API', () => {
		const { app, getFileByPath } = fakeApp(files);
		const index = fileLookupIndex.get(app);
		const rejected = [
			'',
			'https://example.com/a.png',
			'http://example.com/a.png',
			'data:image/png;base64,xxx',
			'blob:https://example.com/uuid',
		];
		for (const url of rejected) {
			expect(lookupIndexedFile(url, app, index), url).toBeNull();
		}
		expect(getFileByPath).not.toHaveBeenCalled();
	});

	it('未命中且索引未过期时返回 null（不误报、不抛错）', () => {
		const { app } = fakeApp(files);
		const index = fileLookupIndex.get(app);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			expect(lookupIndexedFile('nope.png', app, index)).toBeNull();
			expect(error).not.toHaveBeenCalled();
		} finally {
			error.mockRestore();
		}
	});

	it('索引过期自愈：数量比对重建后用新索引重试命中（防事件遗漏）', () => {
		const app1 = fakeApp([file('assets/pic.png')]);
		const stale = fileLookupIndex.get(app1.app);
		// 库新增文件（模拟 create 事件遗漏）：陈旧索引查不到 other.png
		const app2 = fakeApp([file('assets/pic.png'), file('assets2/other.png')]);
		expect(lookupIndexedFile('other.png', app2.app, stale)?.path).toBe(
			'assets2/other.png',
		);
	});

	it('传入索引未命中时退回插件级单例缓存重试（共享索引语义）', () => {
		const { app } = fakeApp(files);
		const shared = fileLookupIndex.get(app);
		// 传入空索引：未命中 → validate 返回单例缓存（对象不同）→ 重试命中
		expect(lookupIndexedFile('pic.png', app, new Map())).toBe(
			shared.get('pic.png'),
		);
	});

	it('直查抛错时吞掉异常返回 null 并记录错误（不向调用方抛出）', () => {
		const { app } = fakeApp(files, { getFileByPathThrows: true });
		const index = fileLookupIndex.get(app);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		try {
			expect(lookupIndexedFile('assets/pic.png', app, index)).toBeNull();
			expect(error).toHaveBeenCalledTimes(1);
		} finally {
			error.mockRestore();
		}
	});
});
