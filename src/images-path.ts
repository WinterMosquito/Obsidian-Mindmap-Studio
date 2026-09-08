/**
 * 图片地址处理：外部地址判断、路径解析/序列化、树遍历、
 * 节点图片选项与统一尺寸。从 images.ts 拆出。
 *
 * 库内文件解析统一走 links-resolve.resolvePathToFile（官方轨 + 索引兜底）；
 * 全库查找索引原语在 file-lookup.ts（本模块不再持有）。
 */
import { App } from 'obsidian';
import { IMAGE_HEIGHT, IMAGE_WIDTH } from './constants';
import { mapWithConcurrency } from './concurrency';
import {
	isAppResourceUrl,
	isExternalImageRef,
} from './domain/url';
import { walkTree } from './domain/tree';
import { resolvePathToFile } from './links-resolve';
import type {
	MindMapTreeNode,
	SetNodeImageOptions,
} from '../vendor/simple-mind-map.cjs';
import type { MdNodeData } from './node-data';

/** 是否为外部/绝对地址（无需按库内路径解析）：库内资源地址以外的远程/数据/file:// 形态 */
export function isExternalUrl(url: string): boolean {
	return isAppResourceUrl(url) || isExternalImageRef(url);
}

/**
 * 将节点数据中的图片地址解析为 Obsidian 可访问的资源地址。
 * 库内相对路径（含资源地址以外的历史形态）经统一解析入口转换为
 * vault 资源地址；外部地址原样返回。
 */
export function resolveImagePath(url: string, app: App): string {
	if (!url || isExternalUrl(url)) {
		return url;
	}
	const file = resolvePathToFile(url, app);
	return file ? app.vault.getResourcePath(file) : url;
}

/** 递归解析树中所有节点的图片/附件地址（加载文件时调用）：库内路径 → 资源地址 */
export function walkResolveImagePaths(tree: MindMapTreeNode, app: App): void {
	walkTree(tree, (node) => {
		if (node.data?.image) {
			node.data.image = resolveImagePath(node.data.image, app);
		}
		if (node.data?.attachmentUrl) {
			node.data.attachmentUrl = resolveImagePath(
				node.data.attachmentUrl,
				app,
			);
		}
	});
}

// ---------------------------------------------------------------------------
// 缓存的文件查找索引已迁至 file-lookup.ts（FileLookupIndexService）：
// 索引是图片/附件/链接解析共用的通用原语，不属图片模块。
// ---------------------------------------------------------------------------

/** 生成统一的 SET_NODE_IMAGE 参数 */
export function createSetNodeImageOptions(url: string | null): SetNodeImageOptions {
	if (url === null || url === '') {
		return { url: null, title: '', width: 0, height: 0, custom: false };
	}
	return {
		url,
		title: '',
		width: IMAGE_WIDTH,
		height: IMAGE_HEIGHT,
		custom: false,
	};
}

// ---------------------------------------------------------------------------
// 按图片原始比例计算展示尺寸
//
// 需求：含图片节点的外框比例跟随图片自身比例——所有图片高度统一
// （IMAGE_HEIGHT），宽度按各自宽高比计算（宽度 = 高度 × 原始宽高比），
// 节点内同时含文字时由引擎布局自动把文字放在图片下方并增加外框高度
// （imgPlacement: top + imgTextMargin）。
// ---------------------------------------------------------------------------

/** 图片尺寸探测超时（毫秒）：加载失败/挂起时不阻塞渲染 */
const IMAGE_PROBE_TIMEOUT_MS = 2500;

/**
 * 树级尺寸校正的探测并发上限：图片自然尺寸探测即一次完整解码，
 * 大图打开时整树 Promise.all 会形成解码风暴（几十上百个并发解码
 * 挤占渲染进程主线程与内存带宽、推迟首帧）；固定并发保持探测管线
 * 饱和的同时为布局/渲染留出算力。
 */
const IMAGE_PROBE_CONCURRENCY = 6;

/**
 * 图片自然尺寸探测缓存（url → 原始尺寸，仅缓存成功结果）。
 * 同一导图重复打开、同图多节点引用时避免重复 new Image() 解码探测。
 */
const IMAGE_SIZE_CACHE = new Map<string, { width: number; height: number }>();
/** 缓存上限（按插入序近似 LRU，超出时淘汰最早条目） */
const IMAGE_SIZE_CACHE_MAX = 500;

/**
 * 图片探测失败缓存（url → 首次失败时间戳）。
 * 同一坏图（CORS/网络/已删除）避免反复等待 2500ms 超时。
 * 过期后允许重试（网络抖动/临时不可达的图片可能恢复）。
 */
const IMAGE_FAIL_CACHE = new Map<string, number>();
const IMAGE_FAIL_CACHE_MAX = 200;
/** 失败缓存过期时间（毫秒）：5 分钟后允许重新探测。export 为测试白盒钩子 */
export const IMAGE_FAIL_TTL_MS = 5 * 60 * 1000;

function cacheImageSize(
	url: string,
	size: { width: number; height: number },
): void {
	IMAGE_SIZE_CACHE.set(url, size);
	IMAGE_FAIL_CACHE.delete(url); // 成功后清除失败记录
	if (IMAGE_SIZE_CACHE.size > IMAGE_SIZE_CACHE_MAX) {
		const [oldest] = IMAGE_SIZE_CACHE.keys();
		if (oldest !== undefined) {
			IMAGE_SIZE_CACHE.delete(oldest);
		}
	}
}

/** 失败缓存：写入当前时间戳；超出上限时先清理过期条目再淘汰最早的。export 为测试白盒钩子 */
export function cacheImageFail(url: string): void {
	IMAGE_FAIL_CACHE.set(url, Date.now());
	if (IMAGE_FAIL_CACHE.size > IMAGE_FAIL_CACHE_MAX) {
		// 顺便清理过期条目——长时间没调用 probe 时 Map 可能积满过期项
		const now = Date.now();
		for (const [key, ts] of IMAGE_FAIL_CACHE) {
			if (now - ts > IMAGE_FAIL_TTL_MS) {
				IMAGE_FAIL_CACHE.delete(key);
			}
		}
		// 清理后还超限 → LRU 淘汰最早
		if (IMAGE_FAIL_CACHE.size > IMAGE_FAIL_CACHE_MAX) {
			const [oldest] = IMAGE_FAIL_CACHE.keys();
			if (oldest !== undefined) {
				IMAGE_FAIL_CACHE.delete(oldest);
			}
		}
	}
}

/** 失败缓存过期清理：移除超过 TTL 的条目（惰性，每次调用顺带清理）。export 为测试白盒钩子 */
export function isImageFailFresh(url: string): boolean {
	const failedAt = IMAGE_FAIL_CACHE.get(url);
	if (failedAt === undefined) return false;
	if (Date.now() - failedAt > IMAGE_FAIL_TTL_MS) {
		IMAGE_FAIL_CACHE.delete(url);
		return false;
	}
	return true;
}

/**
 * 探测图片原始尺寸（自然宽高）。
 * 通过独立 Image 对象加载（不影响画布上的图片元素）；失败、非法或超时返回 null。
 * 命中缓存时同步返回（Promise 解析），不重新解码。
 */
export function probeImageNaturalSize(
	url: string,
): Promise<{ width: number; height: number } | null> {
	return new Promise((resolve) => {
		if (!url) {
			resolve(null);
			return;
		}
		const cached = IMAGE_SIZE_CACHE.get(url);
		if (cached) {
			resolve({ ...cached });
			return;
		}
		// 失败缓存命中：同 URL 近期探测过失败，直接返回 null 避免重复等待超时
		if (isImageFailFresh(url)) {
			resolve(null);
			return;
		}
		const img = new Image();
		let settled = false;
		const timer = window.setTimeout(() => settle(null), IMAGE_PROBE_TIMEOUT_MS);
		const settle = (
			value: { width: number; height: number } | null,
		): void => {
			if (settled) {
				return;
			}
			settled = true;
			window.clearTimeout(timer);
			img.onload = null;
			img.onerror = null;
			if (value === null) {
				cacheImageFail(url);
			}
			resolve(value);
		};
		img.onload = () => {
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				const size = { width: img.naturalWidth, height: img.naturalHeight };
				cacheImageSize(url, size);
				settle(size);
			} else {
				settle(null);
			}
		};
		img.onerror = () => settle(null);
		img.src = url;
	});
}

/**
 * 按图片自身宽高比计算展示尺寸：高度统一为 targetHeight（默认 IMAGE_HEIGHT），
 * 宽度 = 高度 × 原始宽高比（取整，最小 1px）。
 * 探测失败（外部图片无法加载等）时回退到固定尺寸（custom:false，引擎自行约束）。
 */
export async function computeAspectImageSize(
	url: string,
	targetHeight = IMAGE_HEIGHT,
): Promise<{ width: number; height: number; custom: boolean }> {
	const natural = await probeImageNaturalSize(url);
	if (natural && natural.height > 0) {
		return {
			width: Math.max(
				1,
				Math.round((targetHeight * natural.width) / natural.height),
			),
			height: targetHeight,
			custom: true,
		};
	}
	return { width: IMAGE_WIDTH, height: targetHeight, custom: false };
}

/** 生成统一的 SET_NODE_IMAGE 参数：按图片原始比例、统一高度（custom:true 不裁切） */
export async function createAspectSetNodeImageOptions(
	url: string | null,
): Promise<SetNodeImageOptions> {
	if (url === null || url === '') {
		return createSetNodeImageOptions(null);
	}
	const size = await computeAspectImageSize(url);
	return {
		url,
		title: '',
		width: size.width,
		height: size.height,
		custom: size.custom,
	};
}

/**
 * 递归按图片原始比例校正树内所有图片尺寸（有界并发探测）。
 * 返回是否有修改；探测失败的图片保持默认尺寸。
 *
 * 官方嵌入尺寸参数（mdImageWidth/mdImageHeight，来自 `![[图|300]]` /
 * `![[图|300x150]]` / `![alt|300](url)`）优先：
 * - 宽度恒取参数值；
 * - 高度取参数值；仅宽度时按原始比例补齐（探测失败回退统一高度）；
 * - 此类节点为 custom:true，不受默认校正影响。
 */
export async function walkCorrectImageSizesByAspect(
	tree: MindMapTreeNode,
): Promise<boolean> {
	const nodes: MindMapTreeNode[] = [];
	walkTree(tree, (node) => {
		if (node.data?.image) {
			nodes.push(node);
		}
	});
	let changed = false;
	// 单节点探测失败不影响其它节点；只汇总记录一次（避免大图逐条刷屏）
	let failedCount = 0;
	let firstError: unknown = null;
	await mapWithConcurrency(
		nodes,
		IMAGE_PROBE_CONCURRENCY,
		async (node: MindMapTreeNode) => {
			try {
				const data = node.data as MdNodeData;
				let size: { width: number; height: number; custom: boolean };
				if (typeof data.mdImageWidth === 'number' && data.mdImageWidth > 0) {
					// 官方尺寸参数：宽度取参数；高度取参数或按原始比例补齐
					const width = data.mdImageWidth;
					let height = data.mdImageHeight;
					if (height === undefined) {
						const natural = await probeImageNaturalSize(
							typeof data.image === 'string' ? data.image : '',
						);
						height =
							natural && natural.width > 0 && natural.height > 0
								? Math.max(
										1,
										Math.round((width * natural.height) / natural.width),
									)
								: IMAGE_HEIGHT;
					}
					size = { width, height, custom: true };
				} else {
					// 无参数：默认统一高度按原始比例（已有自定义尺寸不覆盖，防御）
					if (node.data?.imageSize?.custom) {
						return;
					}
					size = await computeAspectImageSize(
						typeof data.image === 'string' ? data.image : '',
					);
				}
				const current = node.data?.imageSize;
				if (
					!current ||
					current.width !== size.width ||
					current.height !== size.height ||
					current.custom !== size.custom
				) {
					node.data.imageSize = size;
					changed = true;
				}
			} catch (error) {
				// 单节点探测异常：跳过该节点，保留现有尺寸，不中断整树校正
				failedCount++;
				firstError ??= error;
			}
		},
	);
	if (failedCount > 0) {
		console.warn(
			`图片尺寸校正：${failedCount} 个节点探测失败，已保留默认尺寸`,
			firstError,
		);
	}
	return changed;
}
