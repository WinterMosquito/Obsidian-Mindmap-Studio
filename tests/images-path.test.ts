/**
 * images-path 回归测试：外部地址判断、图片地址 → vault 资源地址的统一解析、
 * 统一尺寸选项、按图片原始比例的探测与树级校正（含官方嵌入尺寸语法），
 * 以及探测失败/超时/缓存的降级路径。
 *
 * 断言前提：probeImageNaturalSize 经 `new Image()` 探测自然尺寸，本文件用
 * stub Image 手工驱动 onload/onerror，因此「算出的尺寸对不对」与「有没有
 * 重复解码」都可观测，且不依赖真实浏览器。
 * 分支归属用 spy 的调用次数证明：外部地址必须完全绕过库内解析。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { IMAGE_HEIGHT, IMAGE_WIDTH } from '../src/constants';
import { fileLookupIndex } from '../src/file-lookup';
import {
	cacheImageFail,
	computeAspectImageSize,
	createAspectSetNodeImageOptions,
	createSetNodeImageOptions,
	IMAGE_FAIL_TTL_MS,
	isExternalUrl,
	isImageFailFresh,
	probeImageNaturalSize,
	resolveImagePath,
	walkCorrectImageSizesByAspect,
	walkResolveImagePaths,
} from '../src/images-path';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/** 资源地址前缀：fake vault 的 getResourcePath 输出形态（app:// 语义） */
const RESOURCE_PREFIX = 'app://fake/';

/**
 * 探测 URL 命名空间：尺寸缓存与失败缓存都是模块级共享的，
 * URL 逐测试唯一才能避免跨用例互相影响（否则「不重复解码」会假成立）。
 */
function probeUrl(name: string): string {
	return `probe://images-path/${name}`;
}

function tfile(path: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ''),
	});
}

/**
 * 最小 fake App：只铺 images-path 间接触达的 vault/metadataCache 面。
 * getFirstLinkpathDest 恒不命中——本文件不测 basename 消歧（那是
 * links-resolve 的职责），恒不命中可确保命中只来自路径直查或索引。
 */
function fakeApp(files: TFile[]) {
	const byPath = new Map(files.map((f) => [f.path, f] as const));
	const getFileByPath = vi.fn((p: string): TFile | null => byPath.get(p) ?? null);
	const getResourcePath = vi.fn(
		(f: TFile): string => `${RESOURCE_PREFIX}${f.path}`,
	);
	const getFiles = vi.fn((): TFile[] => files);
	const getFirstLinkpathDest = vi.fn((): TFile | null => null);
	const app: App = Object.assign(new App(), {
		vault: { getFiles, getFileByPath, getResourcePath },
		metadataCache: { getFirstLinkpathDest },
	});
	return { app, getFileByPath, getResourcePath, getFiles, getFirstLinkpathDest };
}

function node(
	data: Record<string, unknown>,
	children: MindMapTreeNode[] = [],
): MindMapTreeNode {
	return { data, children };
}

/** 节点 data 的松散视图：md* 元数据未在引擎类型声明，读断言需绕开 any 泄漏 */
function dataOf(target: MindMapTreeNode): Record<string, unknown> {
	return target.data;
}

/** Image 桩：手工驱动 onload/onerror 才能确定「探测到了什么尺寸」 */
class FakeImage {
	static instances: FakeImage[] = [];
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	src = '';
	naturalWidth = 0;
	naturalHeight = 0;
	/** 已结算标记：并发上限用例需要区分「在途」与「已完成」 */
	done = false;

	constructor() {
		FakeImage.instances.push(this);
	}

	emitLoad(width: number, height: number): void {
		if (this.done) return;
		this.done = true;
		this.naturalWidth = width;
		this.naturalHeight = height;
		this.onload?.();
	}

	emitError(): void {
		if (this.done) return;
		this.done = true;
		this.onerror?.();
	}
}

/**
 * 放行当前所有在途探测，并等待有界并发的下一批派发，直到不再有新探测。
 * 用宏任务（setTimeout 0）而非单次微任务：mapWithConcurrency 的补位发生在
 * then 回调里，可能跨多层微任务。
 */
async function drainProbes(width: number, height: number): Promise<void> {
	for (let round = 0; round < 50; round++) {
		const inFlight = FakeImage.instances.filter((img) => !img.done);
		if (inFlight.length === 0) {
			return;
		}
		for (const img of inFlight) {
			img.emitLoad(width, height);
		}
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	}
	throw new Error('探测未收敛：drainProbes 轮次用尽');
}

function stubImage(): void {
	FakeImage.instances = [];
	vi.stubGlobal('Image', FakeImage);
}

/** 最近一次创建的 Image（未创建则失败） */
function lastImage(): FakeImage {
	const img = FakeImage.instances.at(-1);
	if (!img) {
		throw new Error('没有创建 Image 实例（探测未发起）');
	}
	return img;
}

describe('isExternalUrl（外部性判断）', () => {
	it('远程/数据/file:// 与库内资源地址都算外部（表驱动）', () => {
		const external = [
			'https://x.com/a.png',
			'http://x.com/a.png',
			'data:image/png;base64,xx',
			'blob:https://x.com/uuid',
			'file:///x/a.png',
			// app:// 是库内资源地址，但已是最终形态，无需再经库内解析
			'app://local/x/a.png',
		];
		for (const url of external) {
			expect(isExternalUrl(url), url).toBe(true);
		}
	});

	it('库内路径、空串与 obsidian:// 均非外部（obsidian:// 交统一解析入口处理）', () => {
		const internal = [
			'assets/pic.png',
			'pic.png',
			'',
			// 单斜杠不是 file:// 形态，按普通路径交给统一解析入口
			'file:/x/a.png',
			'obsidian://open?vault=v&file=a.png',
		];
		for (const url of internal) {
			expect(isExternalUrl(url), url).toBe(false);
		}
	});
});

describe('resolveImagePath / walkResolveImagePaths（地址解析路由）', () => {
	beforeEach(() => {
		// 索引是插件级单例：资源地址/变形地址命中会用到，逐用例失效重建
		fileLookupIndex.invalidate();
	});

	it('外部地址与空串原样返回，且完全绕过库内解析（分支归属）', () => {
		const { app, getFileByPath, getFirstLinkpathDest, getFiles } = fakeApp([]);
		expect(resolveImagePath('https://x.com/a.png', app)).toBe(
			'https://x.com/a.png',
		);
		expect(resolveImagePath('app://local/a.png', app)).toBe('app://local/a.png');
		expect(resolveImagePath('', app)).toBe('');
		// 早退分支不应付出任何库内解析成本（连文件列表扫描都不该发生）
		expect(getFileByPath).not.toHaveBeenCalled();
		expect(getFirstLinkpathDest).not.toHaveBeenCalled();
		expect(getFiles).not.toHaveBeenCalled();
	});

	it('库内路径经统一解析入口换算为 vault 资源地址', () => {
		const pic = tfile('assets/pic.png');
		const { app, getResourcePath } = fakeApp([pic]);
		expect(resolveImagePath('assets/pic.png', app)).toBe(
			`${RESOURCE_PREFIX}assets/pic.png`,
		);
		// 资源地址由命中的那个 TFile 计算，参数身份必须正确
		expect(getResourcePath).toHaveBeenCalledTimes(1);
		expect(getResourcePath).toHaveBeenCalledWith(pic);
	});

	it('仅剩文件名（历史形态）也能经索引兜底命中', () => {
		const pic = tfile('assets/pic.png');
		const { app } = fakeApp([pic]);
		expect(resolveImagePath('pic.png', app)).toBe(
			`${RESOURCE_PREFIX}assets/pic.png`,
		);
	});

	it('未命中时原样返回（保留原引用而不是清空）', () => {
		const { app, getResourcePath } = fakeApp([]);
		expect(resolveImagePath('missing.png', app)).toBe('missing.png');
		expect(getResourcePath).not.toHaveBeenCalled();
	});

	it('walkResolveImagePaths 转换树内所有 image/attachmentUrl，外部地址不动', () => {
		const pic = tfile('assets/pic.png');
		const { app } = fakeApp([pic]);
		const tree = node({ text: 'root' }, [
			node({ text: 'a', image: 'assets/pic.png' }),
			node({ text: 'b', attachmentUrl: 'pic.png' }),
			node({ text: 'c', image: 'https://x.com/b.png' }),
			node({ text: 'd' }, [node({ text: 'deep', image: 'assets/pic.png' })]),
		]);
		walkResolveImagePaths(tree, app);
		const children = tree.children;
		expect(dataOf(children[0]!).image).toBe(`${RESOURCE_PREFIX}assets/pic.png`);
		expect(dataOf(children[1]!).attachmentUrl).toBe(
			`${RESOURCE_PREFIX}assets/pic.png`,
		);
		expect(dataOf(children[2]!).image).toBe('https://x.com/b.png');
		// 深层子节点同样被遍历到
		expect(dataOf(children[3]!.children[0]!).image).toBe(
			`${RESOURCE_PREFIX}assets/pic.png`,
		);
	});
});

describe('createSetNodeImageOptions（统一固定尺寸）', () => {
	it('空引用生成清除参数（url:null + 零尺寸）', () => {
		expect(createSetNodeImageOptions(null)).toEqual({
			url: null,
			title: '',
			width: 0,
			height: 0,
			custom: false,
		});
		// 空串与 null 同语义：一律理解为「移除图片」
		expect(createSetNodeImageOptions('')).toEqual(createSetNodeImageOptions(null));
	});

	it('非空引用生成统一固定尺寸参数（常量即统一尺寸）', () => {
		expect(createSetNodeImageOptions('app://x')).toEqual({
			url: 'app://x',
			title: '',
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			custom: false,
		});
		// 统一尺寸是有意固定的视觉契约（所有图片同高、框架内等比居中）
		expect([IMAGE_WIDTH, IMAGE_HEIGHT]).toEqual([200, 120]);
	});
});

describe('computeAspectImageSize（按原始比例，stub Image）', () => {
	beforeEach(stubImage);
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('探测成功：高度统一、宽度按比例取整（custom:true 不裁切）', async () => {
		const pending = computeAspectImageSize(probeUrl('wide.png'));
		lastImage().emitLoad(240, 120);
		await expect(pending).resolves.toEqual({
			width: Math.round((IMAGE_HEIGHT * 240) / 120),
			height: IMAGE_HEIGHT,
			custom: true,
		});
	});

	it('自定义目标高度：宽度按同一原始比例换算', async () => {
		const pending = computeAspectImageSize(probeUrl('tall.png'), 60);
		lastImage().emitLoad(100, 400);
		await expect(pending).resolves.toEqual({
			width: Math.round((60 * 100) / 400),
			height: 60,
			custom: true,
		});
	});

	it('探测失败回退固定宽度 + 目标高度（custom:false，由引擎自行约束）', async () => {
		const pending = computeAspectImageSize(probeUrl('broken.png'), 60);
		lastImage().emitError();
		// 回退宽度恒为 IMAGE_WIDTH（不随 targetHeight 缩放），高度取目标高度
		await expect(pending).resolves.toEqual({
			width: IMAGE_WIDTH,
			height: 60,
			custom: false,
		});
	});

	it('空地址直接判定失败：不创建 Image', async () => {
		await expect(probeImageNaturalSize('')).resolves.toBeNull();
		expect(FakeImage.instances).toHaveLength(0);
	});

	it('naturalWidth/Height 为 0 视为探测失败并记入失败缓存', async () => {
		const url = probeUrl('zero.png');
		const pending = probeImageNaturalSize(url);
		lastImage().emitLoad(0, 0);
		await expect(pending).resolves.toBeNull();
		// 记入失败缓存（0 尺寸不可用于比例计算，等同失败）
		expect(isImageFailFresh(url)).toBe(true);
	});

	it('探测成功缓存命中：不再重复解码，且返回副本（调用方改动不污染缓存）', async () => {
		const url = probeUrl('cached.png');
		const first = probeImageNaturalSize(url);
		lastImage().emitLoad(300, 100);
		await first;
		const created = FakeImage.instances.length;

		const second = await probeImageNaturalSize(url);
		expect(second).toEqual({ width: 300, height: 100 });
		expect(FakeImage.instances).toHaveLength(created);

		// 缓存返回的是副本：改返回值不应影响下一次命中
		second!.width = 9999;
		await expect(probeImageNaturalSize(url)).resolves.toEqual({
			width: 300,
			height: 100,
		});
	});

	it('超时视为失败：到期即返回 null、记入失败缓存，迟到的 onload 不再改写结果', async () => {
		vi.useFakeTimers();
		try {
			const url = probeUrl('timeout.png');
			const pending = probeImageNaturalSize(url);
			const img = lastImage();
			// 超时上限 2500ms：推进 3000ms 必定触发
			vi.advanceTimersByTime(3000);
			await expect(pending).resolves.toBeNull();
			expect(isImageFailFresh(url)).toBe(true);

			// settled 守卫：超时后图片才加载完成也不改判（否则会写入成功缓存）
			img.emitLoad(300, 100);
			expect(isImageFailFresh(url)).toBe(true);
			await expect(probeImageNaturalSize(url)).resolves.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('createAspectSetNodeImageOptions（按比例的统一选项）', () => {
	beforeEach(stubImage);
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('空引用复用固定清除参数（不探测）', async () => {
		await expect(createAspectSetNodeImageOptions(null)).resolves.toEqual(
			createSetNodeImageOptions(null),
		);
		await expect(createAspectSetNodeImageOptions('')).resolves.toEqual(
			createSetNodeImageOptions(null),
		);
		expect(FakeImage.instances).toHaveLength(0);
	});

	it('非空引用：按原始比例给尺寸，探测失败时回退固定尺寸', async () => {
		const okUrl = probeUrl('options-ok.png');
		const okPending = createAspectSetNodeImageOptions(okUrl);
		lastImage().emitLoad(200, 400);
		await expect(okPending).resolves.toEqual({
			url: okUrl,
			title: '',
			width: Math.round((IMAGE_HEIGHT * 200) / 400),
			height: IMAGE_HEIGHT,
			custom: true,
		});

		const badUrl = probeUrl('options-bad.png');
		const badPending = createAspectSetNodeImageOptions(badUrl);
		lastImage().emitError();
		await expect(badPending).resolves.toEqual({
			url: badUrl,
			title: '',
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			custom: false,
		});
	});
});

describe('walkCorrectImageSizesByAspect（树级校正）', () => {
	beforeEach(stubImage);
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('无尺寸参数的节点：统一高度 + 按原始比例补宽', async () => {
		const tree = node({ text: '', image: probeUrl('plain.png') });
		const pending = walkCorrectImageSizesByAspect(tree);
		lastImage().emitLoad(300, 100);
		await expect(pending).resolves.toBe(true);
		expect(tree.data.imageSize).toEqual({
			width: Math.round((IMAGE_HEIGHT * 300) / 100),
			height: IMAGE_HEIGHT,
			custom: true,
		});
	});

	it('无参数但已有 custom 尺寸的节点：不覆盖也不探测（拖拽调宽的尺寸是用户意图）', async () => {
		const tree = node({
			text: '',
			image: probeUrl('custom.png'),
			imageSize: { width: 999, height: 111, custom: true },
		});
		await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(false);
		expect(FakeImage.instances).toHaveLength(0);
		expect(tree.data.imageSize).toEqual({
			width: 999,
			height: 111,
			custom: true,
		});
	});

	it('无图片的纯文本节点不参与校正', async () => {
		const tree = node({ text: 'root' }, [node({ text: 'leaf' })]);
		await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(false);
		expect(FakeImage.instances).toHaveLength(0);
	});

	it('官方嵌入语法仅宽度（![[图|300]]）：宽度取参数、高度按原始比例补齐', async () => {
		const tree = node({
			text: '',
			image: probeUrl('md-width.png'),
			mdImageTarget: '图.png',
			mdImageWidth: 300,
		});
		const pending = walkCorrectImageSizesByAspect(tree);
		// 原始 300x100（3:1）→ 高 = 300 × 100/300 = 100
		lastImage().emitLoad(300, 100);
		await expect(pending).resolves.toBe(true);
		expect(tree.data.imageSize).toEqual({
			width: 300,
			height: 100,
			custom: true,
		});
	});

	it('官方嵌入语法宽高双参数（![[图|120x80]]）：直接生效且不探测', async () => {
		const tree = node({
			text: '',
			image: probeUrl('md-both.png'),
			mdImageWidth: 120,
			mdImageHeight: 80,
		});
		await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(true);
		expect(tree.data.imageSize).toEqual({
			width: 120,
			height: 80,
			custom: true,
		});
		expect(FakeImage.instances).toHaveLength(0);
	});

	it('仅宽度参数且探测失败：高度回退统一高度（宽度仍以参数为准）', async () => {
		const tree = node({
			text: '',
			image: probeUrl('md-fail.png'),
			mdImageWidth: 300,
		});
		const pending = walkCorrectImageSizesByAspect(tree);
		lastImage().emitError();
		await expect(pending).resolves.toBe(true);
		expect(tree.data.imageSize).toEqual({
			width: 300,
			height: IMAGE_HEIGHT,
			custom: true,
		});
	});

	it('畸形高度参数 0 不回退探测：参数有值即优先（不按原始比例猜）', async () => {
		const tree = node({
			text: '',
			image: probeUrl('md-zero-height.png'),
			mdImageWidth: 300,
			mdImageHeight: 0,
		});
		await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(true);
		expect(tree.data.imageSize).toEqual({
			width: 300,
			height: 0,
			custom: true,
		});
		// 高度参数已给出（含 0）→ 不探测
		expect(FakeImage.instances).toHaveLength(0);
	});

	it('尺寸与目标一致时返回 false（只在真正变化时置位）', async () => {
		const tree = node({
			text: '',
			image: probeUrl('md-same.png'),
			mdImageWidth: 120,
			mdImageHeight: 80,
			imageSize: { width: 120, height: 80, custom: true },
		});
		await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(false);
		expect(tree.data.imageSize).toEqual({
			width: 120,
			height: 80,
			custom: true,
		});
	});

	it('探测按固定并发上限派发：超限节点等前序完成（防解码风暴）', async () => {
		const children = Array.from({ length: 8 }, (_unused, i) =>
			node({ text: `n${i}`, image: probeUrl(`conc-${i}.png`) }),
		);
		const tree = node({ text: 'root' }, children);
		const pending = walkCorrectImageSizesByAspect(tree);
		// 同步派发阶段只允许 6 个探测在途（IMAGE_PROBE_CONCURRENCY）
		expect(FakeImage.instances).toHaveLength(6);

		await drainProbes(300, 100);
		await expect(pending).resolves.toBe(true);
		// 全部 8 个节点最终都被校正（有界并发不丢任务）
		expect(FakeImage.instances).toHaveLength(8);
		for (const child of children) {
			expect(child.data.imageSize).toEqual({
				width: Math.round((IMAGE_HEIGHT * 300) / 100),
				height: IMAGE_HEIGHT,
				custom: true,
			});
		}
	});

	it('重复校正命中尺寸缓存：同一导图再次打开不再解码', async () => {
		const tree = node({ text: '', image: probeUrl('reopen.png') });
		const first = walkCorrectImageSizesByAspect(tree);
		lastImage().emitLoad(300, 100);
		await expect(first).resolves.toBe(true);
		const created = FakeImage.instances.length;

		// 第二次：尺寸已一致 → 既不新建 Image 也不报告变更
		await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(false);
		expect(FakeImage.instances).toHaveLength(created);
	});

	it('单节点探测抛错：跳过该节点、保留原尺寸、汇总告警一次', async () => {
		class ThrowingImage {
			constructor() {
				throw new Error('解码器不可用');
			}
		}
		vi.stubGlobal('Image', ThrowingImage);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		try {
			const tree = node({ text: '', image: probeUrl('throws.png') });
			await expect(walkCorrectImageSizesByAspect(tree)).resolves.toBe(false);
			expect(tree.data.imageSize).toBeUndefined();
			expect(warn).toHaveBeenCalledTimes(1);
			expect(String(warn.mock.calls[0]?.[0])).toContain('1 个节点探测失败');
		} finally {
			warn.mockRestore();
		}
	});
});

describe('图片探测失败缓存（白盒，TTL 与容量）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2025, 0, 1, 12, 0, 0));
		stubImage();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('失败缓存命中：同 URL 直接返回 null，不重复发起探测', async () => {
		const url = probeUrl('fail-hit.png');
		cacheImageFail(url);
		await expect(probeImageNaturalSize(url)).resolves.toBeNull();
		expect(FakeImage.instances).toHaveLength(0);
	});

	it('失败缓存过期（TTL）后允许重新探测：临时不可达的图片可恢复', async () => {
		const url = probeUrl('fail-expired.png');
		cacheImageFail(url);
		vi.advanceTimersByTime(IMAGE_FAIL_TTL_MS + 1000);
		expect(isImageFailFresh(url)).toBe(false);

		const pending = probeImageNaturalSize(url);
		expect(FakeImage.instances).toHaveLength(1);
		lastImage().emitLoad(100, 50);
		await expect(pending).resolves.toEqual({ width: 100, height: 50 });
	});

	it('探测成功后清除失败记录：同一 URL 由失败态恢复为可用', async () => {
		const url = probeUrl('fail-recover.png');
		cacheImageFail(url);
		expect(isImageFailFresh(url)).toBe(true);

		vi.advanceTimersByTime(IMAGE_FAIL_TTL_MS + 1000);
		const pending = probeImageNaturalSize(url);
		lastImage().emitLoad(200, 100);
		await pending;

		// cacheImageSize 内部清除失败记录
		expect(isImageFailFresh(url)).toBe(false);
		// 后续探测走成功缓存，不再新建 Image
		await probeImageNaturalSize(url);
		expect(FakeImage.instances).toHaveLength(1);
	});

	it('失败缓存容量有界：持续写入后最早的条目被淘汰', async () => {
		// 容量上限 200：写入 251 条（远超容量 + 其它用例可能残留的条目），
		// 保证最早的条目必定已被淘汰，断言不依赖 Map 起始为空
		for (let i = 0; i < 251; i++) {
			cacheImageFail(probeUrl(`lru-${i}.png`));
			vi.advanceTimersByTime(1);
		}
		expect(isImageFailFresh(probeUrl('lru-0.png'))).toBe(false);
		// 最新的仍在（容量上限不会把刚写入的挤掉）
		expect(isImageFailFresh(probeUrl('lru-250.png'))).toBe(true);
	});

	it('isImageFailFresh 惰性清理过期条目：过期即返回 false 并删除记录', () => {
		const url = probeUrl('lazy-expire.png');
		cacheImageFail(url);
		vi.advanceTimersByTime(IMAGE_FAIL_TTL_MS + 1000);
		expect(isImageFailFresh(url)).toBe(false);
		// 再次查询仍为 false（条目已被清理，不会复活）
		expect(isImageFailFresh(url)).toBe(false);
	});
});
