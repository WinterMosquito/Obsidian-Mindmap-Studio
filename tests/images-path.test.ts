/**
 * images-path 回归测试：地址外部性判断、库内/外部地址解析路由、
 * 统一尺寸选项、树级尺寸规范化，以及按原始比例的尺寸探测
 * （stub Image 驱动 onload/onerror，含探测缓存）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, TFile } from 'obsidian';
import { IMAGE_HEIGHT, IMAGE_WIDTH } from '../src/constants';
import { fileLookupIndex } from '../src/file-lookup';
import {
	cacheImageFail,
	computeAspectImageSize,
	createSetNodeImageOptions,
	isExternalUrl,
	isImageFailFresh,
	IMAGE_FAIL_TTL_MS,
	probeImageNaturalSize,
	resolveImagePath,
	walkCorrectImageSizesByAspect,
	walkResolveImagePaths,
} from '../src/images-path';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

function fakeApp(files: TFile[]): App {
	const byPath = new Map(files.map((f) => [f.path, f] as const));
	return Object.assign(new App(), {
		vault: {
			getFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			getFileByPath: (p: string) => byPath.get(p) ?? null,
			getFolderByPath: () => null,
			getResourcePath: (f: TFile) => `app://fake/${f.path}`,
		},
		// resolvePathToFile 兜底链路会调用官方链接解析器（未命中返回 null）
		metadataCache: {
			getFirstLinkpathDest: () => null,
		},
	});
}

function tfile(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		name: path.split('/').pop() ?? path,
		basename: (path.split('/').pop() ?? path).replace(/\.[^.]+$/, ''),
	});
}

function node(
	data: Record<string, unknown>,
	children: MindMapTreeNode[] = [],
): MindMapTreeNode {
	return { data, children };
}

// ---- Image 桩：驱动 probeImageNaturalSize 的 onload/onerror ----
class FakeImage {
	static instances: FakeImage[] = [];
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	src = '';
	naturalWidth = 0;
	naturalHeight = 0;
	constructor() {
		FakeImage.instances.push(this);
	}
	/** 测试辅助：模拟图片加载完成 */
	emitLoad(width: number, height: number): void {
		this.naturalWidth = width;
		this.naturalHeight = height;
		this.onload?.();
	}
	emitError(): void {
		this.onerror?.();
	}
}

describe('isExternalUrl（外部性判断）', () => {
	it('远程/数据/file:// 与库内资源地址均为「外部」', () => {
		expect(isExternalUrl('https://x.com/a.png')).toBe(true);
		expect(isExternalUrl('data:image/png;base64,xx')).toBe(true);
		expect(isExternalUrl('file:///x/a.png')).toBe(true);
		expect(isExternalUrl('app://local/x/a.png')).toBe(true);
	});

	it('库内相对路径非外部', () => {
		expect(isExternalUrl('assets/pic.png')).toBe(false);
		expect(isExternalUrl('pic.png')).toBe(false);
	});
});

describe('resolveImagePath / walkResolveImagePaths（地址解析路由）', () => {
	it('外部地址原样返回', () => {
		const app = fakeApp([]);
		expect(resolveImagePath('https://x.com/a.png', app)).toBe('https://x.com/a.png');
		expect(resolveImagePath('app://local/a.png', app)).toBe('app://local/a.png');
		expect(resolveImagePath('', app)).toBe('');
	});

	it('库内路径经统一入口转资源地址', () => {
		fileLookupIndex.invalidate();
		const app = fakeApp([tfile('assets/pic.png')]);
		expect(resolveImagePath('assets/pic.png', app)).toBe('app://fake/assets/pic.png');
	});

	it('未命中时原样返回（保留原引用）', () => {
		fileLookupIndex.invalidate();
		const app = fakeApp([]);
		expect(resolveImagePath('missing.png', app)).toBe('missing.png');
	});

	it('walkResolveImagePaths 转换树内所有 image/attachmentUrl，外部不动', () => {
		fileLookupIndex.invalidate();
		const app = fakeApp([tfile('assets/pic.png')]);
		const tree = node(
			{ text: 'r' },
			[
				node({ text: 'a', image: 'assets/pic.png' }),
				node({
					text: 'b',
					attachmentUrl: 'assets/pic.png',
					image: 'https://x.com/b.png',
				}),
			],
		);
		walkResolveImagePaths(tree, app);
		expect(tree.children[0]!.data.image).toBe('app://fake/assets/pic.png');
		expect(tree.children[1]!.data.attachmentUrl).toBe('app://fake/assets/pic.png');
		expect(tree.children[1]!.data.image).toBe('https://x.com/b.png');
	});
});

describe('createSetNodeImageOptions（统一尺寸）', () => {
	it('空引用生成清除参数（url:null + 零尺寸）', () => {
		expect(createSetNodeImageOptions(null)).toEqual({
			url: null,
			title: '',
			width: 0,
			height: 0,
			custom: false,
		});
		expect(createSetNodeImageOptions('')).toEqual(createSetNodeImageOptions(null));
	});

	it('非空引用生成统一固定尺寸参数', () => {
		expect(createSetNodeImageOptions('app://x')).toEqual({
			url: 'app://x',
			title: '',
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			custom: false,
		});
	});
});

describe('computeAspectImageSize（按原始比例探测，stub Image）', () => {
	beforeEach(() => {
		FakeImage.instances = [];
		vi.stubGlobal('Image', FakeImage);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('探测成功：高度统一、宽度按比例取整（custom:true）', async () => {
		const pending = computeAspectImageSize('probe://wide.png', IMAGE_HEIGHT);
		FakeImage.instances.at(-1)!.emitLoad(240, 120);
		await expect(pending).resolves.toEqual({
			width: Math.round((IMAGE_HEIGHT * 240) / 120),
			height: IMAGE_HEIGHT,
			custom: true,
		});
	});

	it('探测失败回退固定尺寸（custom:false）', async () => {
		const pending = computeAspectImageSize('probe://broken.png');
		FakeImage.instances.at(-1)!.emitError();
		await expect(pending).resolves.toEqual({
			width: IMAGE_WIDTH,
			height: IMAGE_HEIGHT,
			custom: false,
		});
	});

	it('探测缓存命中：同 URL 第二次探测不再 new Image', async () => {
		const url = 'probe://cached.png';
		const first = computeAspectImageSize(url);
		FakeImage.instances.at(-1)!.emitLoad(300, 100);
		await first;
		const created = FakeImage.instances.length;

		const second = computeAspectImageSize(url);
		await expect(second).resolves.toEqual({
			width: Math.round((IMAGE_HEIGHT * 300) / 100),
			height: IMAGE_HEIGHT,
			custom: true,
		});
		expect(FakeImage.instances.length).toBe(created);
	});
});

describe('walkCorrectImageSizesByAspect（官方嵌入尺寸参数）', () => {
	beforeEach(() => {
		FakeImage.instances = [];
		vi.stubGlobal('Image', FakeImage);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('mdImageWidth：宽度取参数、高度按原始比例补齐（custom:true）', async () => {
		const tree: MindMapTreeNode = {
			data: {
				text: '',
				image: 'app://fake/pic.png',
				mdImageTarget: 'pic.png',
				mdImageWidth: 300,
			},
			children: [],
		};
		const pending = walkCorrectImageSizesByAspect(tree);
		// 自然尺寸 300x100（比例 3:1）→ 高 = 300 * 100/300 = 100
		FakeImage.instances.at(-1)!.emitLoad(300, 100);
		await pending;
		expect(tree.data?.imageSize).toEqual({ width: 300, height: 100, custom: true });
	});

	it('mdImageWidth + mdImageHeight：双参数直接生效（不探测）', async () => {
		const tree: MindMapTreeNode = {
			data: {
				text: '',
				image: 'app://fake/pic.png',
				mdImageWidth: 120,
				mdImageHeight: 80,
			},
			children: [],
		};
		await walkCorrectImageSizesByAspect(tree);
		expect(tree.data?.imageSize).toEqual({ width: 120, height: 80, custom: true });
		expect(FakeImage.instances).toHaveLength(0); // 双参数无需探测
	});

	it('无参数节点：统一高度按比例；已有 custom 尺寸不覆盖', async () => {
		const tree: MindMapTreeNode = {
			data: { text: '', image: 'app://fake/pic.png' },
			children: [
				{
					data: {
						text: '',
						image: 'app://fake/pic.png',
						imageSize: { width: 999, height: 111, custom: true },
					},
					children: [],
				},
			],
		};
		const pending = walkCorrectImageSizesByAspect(tree);
		FakeImage.instances.at(-1)?.emitLoad(300, 100);
		await pending;
		// 根节点（无参数）：统一高度 IMAGE_HEIGHT、宽度按比例
		expect(tree.data?.imageSize).toEqual({
			width: Math.round((IMAGE_HEIGHT * 300) / 100),
			height: IMAGE_HEIGHT,
			custom: true,
		});
		// 子节点：custom 已存在 → 不覆盖
		expect(tree.children[0]?.data?.imageSize).toEqual({
			width: 999,
			height: 111,
			custom: true,
		});
	});
});

describe('图片探测失败缓存 (白盒)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2025, 0, 1, 12, 0, 0)); // 固定时钟起点
		FakeImage.instances = [];
		vi.stubGlobal('Image', FakeImage);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('缓存失败后，probeImageNaturalSize 同 URL 直接返回 null（不 new Image）', async () => {
		const url = 'probe://bad1.png';
		cacheImageFail(url);
		const before = FakeImage.instances.length;

		const result = await probeImageNaturalSize(url);
		expect(result).toBeNull();
		// 失败缓存命中，没有发起新探测
		expect(FakeImage.instances.length).toBe(before);
	});

	it('失败缓存超过 TTL 后失效，probe 重新发起探测', async () => {
		const url = 'probe://expires.png';
		cacheImageFail(url);
		// 前进 TTL + 1 秒 → 过期
		vi.advanceTimersByTime(IMAGE_FAIL_TTL_MS + 1000);
		expect(isImageFailFresh(url)).toBe(false);

		// 探测会重新 new Image
		const before = FakeImage.instances.length;
		const pending = probeImageNaturalSize(url);
		expect(FakeImage.instances.length).toBe(before + 1);
		FakeImage.instances.at(-1)!.emitLoad(100, 50);
		await expect(pending).resolves.toEqual({ width: 100, height: 50 });
	});

	it('失败→成功 双向覆盖：probeImageNaturalSize 成功后清除失败记录', async () => {
		const url = 'probe://recoverable.png';
		cacheImageFail(url);
		expect(isImageFailFresh(url)).toBe(true);

		// 让失败缓存过期 → probe 会走真正的探测分支
		vi.advanceTimersByTime(IMAGE_FAIL_TTL_MS + 1000);
		expect(isImageFailFresh(url)).toBe(false);

		const pending = probeImageNaturalSize(url);
		FakeImage.instances.at(-1)!.emitLoad(200, 100);
		await pending;

		// 成功缓存写入时 cacheImageSize 内部会 IMAGE_FAIL_CACHE.delete
		// 验证：isImageFailFresh 应该返回 false（已被清除）
		expect(isImageFailFresh(url)).toBe(false);

		// 后续再 probe 命中成功缓存，不再 new Image
		const before = FakeImage.instances.length;
		await probeImageNaturalSize(url);
		expect(FakeImage.instances.length).toBe(before);
	});

	it('LRU 上限：超出 IMAGE_FAIL_CACHE_MAX 时淘汰最早条目', () => {
		// cacheImageFail 内部 IMAGE_FAIL_CACHE_MAX = 200
		// 写入 201 个 URL，第一个应该被淘汰
		for (let i = 0; i < 201; i++) {
			cacheImageFail(`probe://lru-${i}.png`);
			// 每次间隔 1ms，保证 Map 插入序可区分
			vi.advanceTimersByTime(1);
		}
		// 第 0 个应已被淘汰
		expect(isImageFailFresh('probe://lru-0.png')).toBe(false);
		// 最新的还在
		expect(isImageFailFresh('probe://lru-200.png')).toBe(true);
	});

	it('isImageFailFresh 惰性清理过期条目：检查过期 URL 时顺带删除', () => {
		cacheImageFail('probe://will-expire.png');
		vi.advanceTimersByTime(IMAGE_FAIL_TTL_MS + 1000);
		// 过期后首次检查 → 返回 false，并顺带从 Map 里删
		expect(isImageFailFresh('probe://will-expire.png')).toBe(false);
		// 再检查一次还是 false（已清理）
		expect(isImageFailFresh('probe://will-expire.png')).toBe(false);
	});
});
