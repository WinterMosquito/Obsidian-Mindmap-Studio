/**
 * 全库文件查找索引：「多种地址形态 → TFile」的构建、缓存与 O(1) 查询。
 *
 * 从 images-path 拆出：索引是通用解析原语（图片/附件/链接解析共用），
 * 不应寄生在图片模块；links-resolve 的统一解析路由以此为兜底层。
 *
 * 全库构建一次索引需要对每个文件调用 getResourcePath（大库下可达数百毫秒）。
 * 而多个高频路径都会触发查询：自动保存（md 图片路径回写）、
 * 文件重命名/删除（引用更新）、附件点击/悬浮、链接跳转兜底。
 * 文件列表在库事件之外不会变化，因此缓存分层保鲜（2026-09-18 性能轮修订）：
 * - 命中快路径：缓存存在即直接复用，不重扫文件列表——getFiles 每次调用
 *   都全量拷贝数组，而保存序列化会逐图片节点反查（O(图片数×文件数)），
 *   快路径把高频命中的成本压回 O(1)；
 * - create **增量补建**（noteCreated）：create 是库事件里最高频的一类
 *   （批量导入/外部同步），原「整体失效」会让风暴期内的每次查询都付一遍
 *   O(文件数 × 路径深度 + getResourcePath) 的全量重建；
 * - rename / delete 整体失效（invalidate）：旧形态键无法安全地增量摘除
 *   （后缀键可被多个文件共享，摘错会误删别人的键），保持全量重建；
 * - 未命中自愈：索引未命中（事件遗漏等罕见场景）时经 validate 按文件
 *   数量比对一次、必要时重建并重试，防陈旧索引漏检新文件；比对本身有
 *   时间窗节流（同一保存批次里逐节点 miss 只扫描一次文件列表）。
 * 失效后下一次查询（含失效事件的同批处理）会重建，时序上无竞态。
 */
import { App, TFile, normalizePath } from 'obsidian';
import {
	encodedNameForm,
	isRemoteOrDataUrl,
	urlComparisonForms,
} from '../domain/url';
import { formatLinkPath, type LinkPathFormat } from '../domain/wikilink';

/**
 * 把**单个文件**的全部形态键写入索引：
 * - 库内路径（folder/name.ext）
 * - 资源地址（app://...，getResourcePath 输出）
 * - 文件名与 URL 编码文件名
 * - 路径后缀（folder/name.ext，兼容绝对路径/历史数据形态）
 *
 * 全量重建（buildFileLookupIndex）与增量补建（FileLookupIndexService.noteCreated）
 * **必须共用本实现**——两处各写一份键形态表必然漂移（漏一种形态＝该形态查不到）。
 */
function writeFileEntries(
	app: App,
	index: Map<string, TFile>,
	file: TFile,
): void {
	index.set(file.path, file);
	const name = file.name;
	index.set(name, file);
	// 编码形态可能不存在（孤立代理对等非法序列，见 domain/url.encodedNameForm）：
	// 该形态跳过，其余键照建
	const encodedName = encodedNameForm(name);
	if (encodedName !== null) {
		index.set(encodedName, file);
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

/** 构建「多种地址形态 → TFile」的查找索引（一次构建后供整树遍历 / 批量查找 O(1) 复用） */
export function buildFileLookupIndex(
	app: App,
	allFiles: TFile[],
): Map<string, TFile> {
	const index = new Map<string, TFile>();
	for (const file of allFiles) {
		writeFileEntries(app, index, file);
	}
	return index;
}

/**
 * `validate` 数量比对的最小间隔（毫秒）：窗口内的重复校验直接复用缓存。
 * 存在的理由：索引未命中的自愈查询在一次保存序列化里可能**逐节点**发生
 * （每个解析不出的图片/附件各触发一次），逐次 getFiles 的全量数组拷贝
 * 在大库下是纯浪费；窗口外的首次校验仍会真实比对（节流不吞事件遗漏，
 * 只把它推迟到窗口外——自愈本就是 best-effort）。
 */
export const VALIDATE_MIN_INTERVAL_MS = 500;

/** 计数表 +1（表缺失时无动作：缓存尚未建立，重建时自然统计） */
function increment(counts: Map<string, number> | null, key: string): void {
	if (!counts) {
		return;
	}
	counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * 同名冲突查询（**basename 与含扩展名两张表共用的唯一实现**）：命中缓存计数
 * 即零扫描；缓存未建立时回落一次 `getFiles` 扫描（读取失败按无冲突处理，
 * fail-open 不阻断新建引用）。
 *
 * @param key     计数表的键（`file.basename` 或 `file.name`）
 * @param sameName 判定「另一个文件是否同名」——必须与 `key` 同一口径
 */
function hasConflict(
	key: string,
	counts: Map<string, number> | null,
	app: App,
	file: TFile,
	sameName: (other: TFile) => boolean,
): boolean {
	if (!counts) {
		try {
			return app.vault.getFiles().some((other) => other !== file && sameName(other));
		} catch {
			return false;
		}
	}
	return (counts.get(key) ?? 0) > 1;
}

/**
 * 全库文件查找索引服务：「多种地址形态 → TFile」的 O(1) 查找缓存。
 * 命中快路径不重扫文件列表（新鲜度由库事件增量/失效保证）；
 * `validate` 按文件数量比对校验（慢路径，供索引未命中时自愈调用）。
 */
export class FileLookupIndexService {
	private cache: Map<string, TFile> | null = null;
	private cacheCount = 0;
	/**
	 * basename（去扩展名）→ 库内文件数：**文档链接**的同名冲突判断用
	 * （`[[笔记]]` 省略扩展名）。
	 * 与 cache 同生命周期——重建时统计、增量补建时递增，查询零扫描
	 * （替代调用方每次新建链接都 getFiles + some 的全量扫描）。
	 */
	private basenameCounts: Map<string, number> | null = null;
	/**
	 * 文件名（**含扩展名**）→ 库内文件数：**图片 / 附件 / 带扩展名引用**的
	 * 同名冲突判断用。
	 *
	 * 为什么必须与 basename 分开：`![[a.png]]` 带扩展名，与 `a.md` / `a.jpg`
	 * **不构成歧义**；用去扩展名计数会把它们误判为冲突、把引用无谓拉成完整路径
	 * （2026-10-21 审核发现，与官方「shortest unique path」相悖）。
	 */
	private nameCounts: Map<string, number> | null = null;
	/** 上次实际执行数量比对的时刻；null = 尚未比对（首次 validate 一定执行） */
	private lastValidateAt: number | null = null;

	/**
	 * @param now 时钟（默认 `Date.now`）。可注入以便测试推进 validate 的
	 *   节流窗口，不依赖真实时间等待。
	 */
	constructor(private readonly now: () => number = Date.now) {}

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
	 *
	 * 校验节流（见 `VALIDATE_MIN_INTERVAL_MS`）：同一时间窗内的重复调用
	 * 直接复用当前缓存；`invalidate` 会重置窗口，使库列表真正变化后的
	 * 第一次校验立即执行。无缓存时不受节流影响（必然重建）。
	 */
	validate(app: App): Map<string, TFile> {
		if (!this.cache) {
			return this.rebuild(app);
		}
		const now = this.now();
		if (
			this.lastValidateAt !== null &&
			now - this.lastValidateAt < VALIDATE_MIN_INTERVAL_MS
		) {
			return this.cache;
		}
		this.lastValidateAt = now;
		const files = app.vault.getFiles();
		if (files.length === this.cacheCount) {
			return this.cache;
		}
		return this.rebuild(app, files);
	}

	/**
	 * 库内新建文件时**增量**补建索引条目（vault `create` 事件调用）。
	 *
	 * 语义与全量重建的键集合一致（`writeFileEntries` 同一实现）；同形态键
	 * 本就后写覆盖、不保证多同名文件的消歧——消歧由官方解析轨承担，与
	 * 全量重建口径完全相同（顺序差异只影响「指向哪个同名文件」的兜底选择）。
	 *
	 * 缓存尚未建立时无需动作（下次构建自然包含新文件）；对同一路径重复
	 * 调用幂等（不重复计数）。
	 */
	noteCreated(app: App, file: TFile): void {
		const cache = this.cache;
		if (!cache || cache.has(file.path)) {
			return;
		}
		writeFileEntries(app, cache, file);
		this.cacheCount++;
		increment(this.basenameCounts, file.basename);
		increment(this.nameCounts, file.name);
	}

	/**
	 * 库内是否存在与 file **同名（basename，去扩展名，另一路径）**的文件。
	 *
	 * 用于**省略扩展名的引用**（`[[笔记]]`）。命中共享索引的 basename 计数
	 * （零扫描）；索引尚未建立时回落一次 `getFiles` 扫描——读取失败按无冲突
	 * 处理（fail-open 不阻断新建链接）。
	 */
	hasBasenameConflict(app: App, file: TFile): boolean {
		const key = file.basename;
		return hasConflict(key, this.basenameCounts, app, file, (other) => other.basename === key);
	}

	/**
	 * 库内是否存在与 file **同名（文件名含扩展名，另一路径）**的文件。
	 *
	 * 用于**带扩展名的引用**（`![[a.png]]` / `[[a.canvas]]`）：`a.png` 与
	 * `a.md`、`a.jpg` **不构成歧义**，不能沿用去扩展名的 basename 计数
	 * （否则引用会被无谓拉成完整路径，与官方「shortest unique path」相悖）。
	 */
	hasNameConflict(app: App, file: TFile): boolean {
		const key = file.name;
		return hasConflict(key, this.nameCounts, app, file, (other) => other.name === key);
	}

	/** 构建索引并更新缓存计数（files 可传入已扫描的文件列表避免重复扫描） */
	private rebuild(app: App, files?: TFile[]): Map<string, TFile> {
		const list = files ?? app.vault.getFiles();
		const index = new Map<string, TFile>();
		const basenames = new Map<string, number>();
		const names = new Map<string, number>();
		for (const file of list) {
			writeFileEntries(app, index, file);
			increment(basenames, file.basename);
			increment(names, file.name);
		}
		this.cache = index;
		this.cacheCount = list.length;
		this.basenameCounts = basenames;
		this.nameCounts = names;
		return index;
	}

	/** 库文件列表变化（rename/delete）后使缓存失效（create 走 noteCreated 增量） */
	invalidate(): void {
		this.cache = null;
		this.cacheCount = 0;
		this.basenameCounts = null;
		this.nameCounts = null;
		this.lastValidateAt = null;
	}
}

/** 插件级单例：全库唯一 vault，缓存全局共享（vault-sync 在库事件时失效） */
export const fileLookupIndex = new FileLookupIndexService();

/**
 * 新建引用的**路径形态**：跟随官方 `设置 → 文件与链接 → New link format`。
 *
 * - `shortest`（默认）：最短**唯一**路径——库内存在同名文件时退化为完整路径，
 *   否则只写文件名（官方帮助 `Settings.md` "shortest unique path"）。**同名的口径
 *   随引用形态**：省略 `.md` 的文档链接按**去扩展名 basename** 判（`[[a]]` ↔ `a.md`）；
 *   带扩展名的图片 / 附件 / `.canvas` 等按**文件名（含扩展名）**判——`a.png` 与
 *   `a.md`、`a.jpg` 不构成歧义，不能共用 basename 口径（2026-10-21 修正）；
 * - `relative`：相对引用方（当前 .md）的路径；
 * - `absolute`：库根起的完整路径。
 *
 * **只用于新建**：既有引用改写沿用用户原始写法（`md-serialize` 保留
 * `mdImageTarget` 的口径、`links-tree` 的引用更新），本函数不参与。
 *
 * **唯一实现**：文档链接（`features/view-node-actions`）与图片引用
 * （`features/view-image-actions`）共用——两侧各写一份「读设置 + 判同名 + 拼路径」
 * 必然漂移（2026-10-20 审计：图片侧此前直接写 `file.path`，无视该设置）。
 *
 * @param options.omitMarkdownExtension 文档链接可省 `.md`（Obsidian 解析规则，
 *        且官方只在 `shortest` 档省略）；图片/附件必须带扩展名，传 false。
 */
export function newReferencePath(
	app: App,
	file: TFile,
	sourcePath: string,
	format: LinkPathFormat,
	options: { omitMarkdownExtension?: boolean } = {},
): string {
	const omitMd =
		options.omitMarkdownExtension === true &&
		format === 'shortest' &&
		/\.md$/i.test(file.path);
	const target = omitMd ? file.path.replace(/\.md$/i, '') : file.path;
	const ambiguous =
		format === 'shortest' &&
		(omitMd
			? fileLookupIndex.hasBasenameConflict(app, file)
			: fileLookupIndex.hasNameConflict(app, file));
	return formatLinkPath(target, sourcePath, format, ambiguous);
}

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
	const byPath = app.vault.getFileByPath(normalizePath(url));
	if (byPath) {
		return byPath;
	}
	for (const candidate of urlComparisonForms(url)) {
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
