/**
 * 全库文件查找索引：「多种地址形态 → TFile」的构建、缓存与 O(1) 查询。
 *
 * 从 images-path 拆出：索引是通用解析原语（图片/附件/链接解析共用），
 * 不应寄生在图片模块；links-resolve 的统一解析路由以此为兜底层。
 *
 * 全库构建一次索引需要对每个文件调用 getResourcePath（大库下可达数百毫秒）。
 * 而多个高频路径都会触发查询：自动保存（md 图片路径回写）、
 * 文件重命名/删除（引用更新）、附件点击/悬浮、链接跳转兜底。
 * 文件列表在 create/rename/delete 事件之外不会变化，因此缓存分层保鲜：
 * - 命中快路径：缓存存在即直接复用，不重扫文件列表——getFiles 每次调用
 *   都全量拷贝数组，而保存序列化会逐图片节点反查（O(图片数×文件数)），
 *   快路径把高频命中的成本压回 O(1)；
 * - 事件失效：vault-sync 在 create/rename/delete 事件里调用
 *   fileLookupIndex.invalidate() 显式失效（修改内容不影响索引，无需失效）；
 * - 未命中自愈：索引未命中（事件遗漏等罕见场景）时经 validate 按文件
 *   数量比对一次、必要时重建并重试，防陈旧索引漏检新文件。
 * 失效后下一次查询（含失效事件的同批处理）会重建，时序上无竞态。
 */
import { App, TFile, normalizePath } from 'obsidian';
import { isRemoteOrDataUrl } from './domain/url';

/**
 * 构建「多种地址形态 → TFile」的查找索引：
 * - 库内路径（folder/name.ext）
 * - 资源地址（app://...，getResourcePath 输出）
 * - 文件名与 URL 编码文件名
 * - 路径后缀（folder/name.ext，兼容绝对路径/历史数据形态）
 * 一次构建后供整树遍历 / 批量查找 O(1) 复用。
 */
export function buildFileLookupIndex(
	app: App,
	allFiles: TFile[],
): Map<string, TFile> {
	const index = new Map<string, TFile>();
	for (const file of allFiles) {
		index.set(file.path, file);
		const name = file.name;
		index.set(name, file);
		try {
			index.set(encodeURIComponent(name), file);
		} catch {
			// 个别文件名编码失败，跳过该形态
		}
		const segments = file.path.split('/');
		for (let i = 2; i <= segments.length; i++) {
			index.set(segments.slice(-i).join('/'), file);
		}
		try {
			index.set(app.vault.getResourcePath(file), file);
		} catch {
			// 个别文件资源地址计算失败，跳过该形态
		}
	}
	return index;
}

/**
 * 全库文件查找索引服务：「多种地址形态 → TFile」的 O(1) 查找缓存。
 * 命中快路径不重扫文件列表（新鲜度由库事件 invalidate 保证）；
 * `validate` 按文件数量比对校验（慢路径，供索引未命中时自愈调用）。
 */
export class FileLookupIndexService {
	private cache: Map<string, TFile> | null = null;
	private cacheCount = 0;

	/** 获取（可能缓存的）全库文件查找索引；缓存存在即复用，无则构建 */
	get(app: App): Map<string, TFile> {
		if (this.cache) {
			return this.cache;
		}
		return this.rebuild(app);
	}

	/**
	 * 带数量比对的校验获取（慢路径）：文件数量与缓存时一致 → 复用；
	 * 数量变化（或无缓存）→ 重建。仅在索引未命中时调用，
	 * 避免高频命中路径反复付出 getFiles 的全量数组拷贝；
	 * 重建复用同一次扫描结果，不重复调用 getFiles。
	 */
	validate(app: App): Map<string, TFile> {
		if (this.cache) {
			const files = app.vault.getFiles();
			if (files.length === this.cacheCount) {
				return this.cache;
			}
			return this.rebuild(app, files);
		}
		return this.rebuild(app);
	}

	/** 构建索引并更新缓存计数（files 可传入已扫描的文件列表避免重复扫描） */
	private rebuild(app: App, files?: TFile[]): Map<string, TFile> {
		const list = files ?? app.vault.getFiles();
		this.cache = buildFileLookupIndex(app, list);
		this.cacheCount = list.length;
		return this.cache;
	}

	/** 库文件列表变化（create/rename/delete）后使缓存失效 */
	invalidate(): void {
		this.cache = null;
		this.cacheCount = 0;
	}
}

/** 插件级单例：全库唯一 vault，缓存全局共享（vault-sync 在库事件时失效） */
export const fileLookupIndex = new FileLookupIndexService();

/**
 * 通过索引把任意地址形态解析为库内 TFile（O(1)，索引缺失键时按后缀回退）。
 * 外部地址（http/data/blob）返回 null。
 * 索引未命中时按文件数量校验一次索引新鲜度（自愈防事件遗漏），
 * 索引被重建则重试一轮候选。
 */
export function lookupIndexedFile(
	url: string,
	app: App,
	index: Map<string, TFile>,
): TFile | null {
	if (!url || isRemoteOrDataUrl(url)) {
		return null;
	}
	try {
		const hit = lookupCandidates(url, app, index);
		if (hit) {
			return hit;
		}
		// 未命中自愈：索引可能已随库事件过期（事件遗漏等罕见场景）。
		// 数量比对重建后与传入索引不同 → 用新索引重试一轮；仍不命中返回 null。
		const fresh = fileLookupIndex.validate(app);
		if (fresh !== index) {
			return lookupCandidates(url, app, fresh);
		}
	} catch (error) {
		console.error('解析附件文件失败:', url, error);
	}
	return null;
}

/** 按直查 → 索引键 → 路径后缀的顺序在单个索引内尝试候选 */
function lookupCandidates(
	url: string,
	app: App,
	index: Map<string, TFile>,
): TFile | null {
	const byPath = app.vault.getAbstractFileByPath(normalizePath(url));
	if (byPath instanceof TFile) {
		return byPath;
	}
	for (const candidate of uniqueCandidates(url)) {
		const hit = index.get(candidate);
		if (hit) {
			return hit;
		}
		const segments = candidate.replace(/\\/g, '/').split('/');
		for (let i = 1; i <= segments.length; i++) {
			const suffixHit = index.get(segments.slice(-i).join('/'));
			if (suffixHit) {
				return suffixHit;
			}
		}
	}
	return null;
}

/** 原样地址 + URL 解码地址（去重）作为索引查询候选 */
function uniqueCandidates(url: string): string[] {
	const candidates = [url];
	try {
		const decoded = decodeURIComponent(url);
		if (decoded !== url) {
			candidates.push(decoded);
		}
	} catch {
		// 含未编码 % 等字符时仅用原样地址
	}
	return candidates;
}
