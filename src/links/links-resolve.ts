/**
 * 库内文件解析：把任意输入（路径 / obsidian:// / file:// / 文件名 /
 * 资源地址 / 拖拽数据）解析为库内 TFile。从 links.ts 拆出。
 *
 * 本模块是「任意地址形态 → TFile」的统一入口：此前 resolvePathToFile
 * （官方解析轨）与 images-save.findAttachmentFile / images-path.lookupIndexedFile
 * （索引轨）双轨并存、覆盖形态互有盲区；现按形态路由收敛到此——
 * 远程/数据地址直接拒绝，obsidian:// 与资源地址（app://）按形态直达，
 * 完整路径走 vault 直查，file:// 绝对路径经官方 FileSystemAdapter.getBasePath()
 * 剥离库根归一为相对路径，basename/链接文本交由官方 getFirstLinkpathDest
 * （与 Obsidian 内部一致），最后以共享缓存索引兜底 URL 编码名/路径后缀等
 * 历史形态。
 */
import { App, FileSystemAdapter, TFile, TFolder, normalizePath } from 'obsidian';
import {
	isAppResourceUrl,
	isRemoteOrDataUrl,
	resourceUrlPathCandidates,
} from '../domain/url';
import { fileLookupIndex, lookupIndexedFile } from './file-lookup';

/**
 * 将任意字符串解析为库内 TFile：
 * 支持库内路径、obsidian:// 链接、资源地址（app://）、file:// 绝对路径、
 * 文件名与 URL 编码/路径后缀等历史形态。
 */
export function resolvePathToFile(
	input: string,
	app: App,
): TFile | null {
	if (!input) {
		return null;
	}
	const text = input.trim();

	// 远程/数据地址（http/https/data/blob）不可能映射到库内文件
	if (isRemoteOrDataUrl(text)) {
		return null;
	}

	if (text.startsWith('obsidian://')) {
		try {
			const fileParam = new URL(text).searchParams.get('file');
			if (fileParam) {
				const path = decodeURIComponent(fileParam);
				// 官方推荐的类型化取文件（@since 1.5.7；CHANGELOG v1.5.7 明示
				// getAbstractFileByPath 易混淆，应改用 getFileByPath）
				const direct = app.vault.getFileByPath(path);
				if (direct) {
					return direct;
				}
				const withMd = app.vault.getFileByPath(path + '.md');
				if (withMd) {
					return withMd;
				}
				// 官方链接解析器：basename → 文件（Obsidian 同款同名消歧）
				return app.metadataCache.getFirstLinkpathDest(path, '');
			}
		} catch {
			// 忽略解析错误
		}
		return null;
	}

	// 资源地址（app://...）：先「直解」（提取路径 → 直查 → 校验地址全等），
	// 再回退共享索引（历史 / 非标准形态兜底）。直解的动机：索引是**惰性全库
	// 构建**（10 万文件实测 300ms+，且为同步阻塞），而「打开含图文档」的首个
	// 图片解析就会触发它——直解把该场景从「全库扫描」压到「一次直查 + 一次
	// 地址校验」（~1µs），索引只在直解落空时才付构建成本。
	if (isAppResourceUrl(text)) {
		const direct = resolveResourceUrlDirect(text, app);
		if (direct) {
			return direct;
		}
		return lookupIndexedFile(text, app, fileLookupIndex.get(app));
	}

	const file = app.vault.getFileByPath(normalizePath(text));
	if (file) {
		return file;
	}

	if (text.startsWith('file://')) {
		try {
			const decoded = decodeURIComponent(text.replace(/^file:\/\//, ''));
			// 官方 API：FileSystemAdapter.getBasePath() 返回库根的真实绝对路径。
			// （旧实现按「库显示名」在路径中猜库根——库改名后即失配。）
			const adapter = app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				const rel = stripVaultBase(
					decoded.replace(/\\/g, '/'),
					adapter.getBasePath().replace(/\\/g, '/').replace(/\/+$/, ''),
				);
				if (rel) {
					const hit = app.vault.getFileByPath(normalizePath(rel));
					if (hit) {
						return hit;
					}
				}
			}
		} catch {
			// 路径含未编码 % 等字符时忽略该分支
		}
	}

	// 官方链接解析器（getFirstLinkpathDest）：basename/链接文本 → 文件，
	// 行为与 Obsidian 内部 [[链接]] 解析一致（含大小写、扩展名与同名消歧规则）。
	const official = app.metadataCache.getFirstLinkpathDest(text, '');
	if (official) {
		return official;
	}

	// 索引兜底：URL 编码文件名、路径后缀等历史/异常形态（O(1)）
	return lookupIndexedFile(text, app, fileLookupIndex.get(app));
}

/**
 * 资源地址直解：提取路径候选 → 直查文件 → **校验资源地址与查询全等**。
 *
 * 为什么必须校验：地址可能来自历史数据或手工构造，若只按路径直查，形如
 * `app://x/笔记.md` 的伪地址会命中真实文件（路径巧合），把「解析失败」变成
 * 「解析到别的文件」。全等校验与索引的键匹配同口径：命中 = 该文件的**当前**
 * 资源地址；不命中（含 mtime 缓存串过期）即回退索引——索引对这类地址同样
 * miss，行为与改动前一致。
 *
 * 与索引的一处有意差异（方向为「更正确」）：文件被外部修改后 mtime 变化，
 * 陈旧索引键对**新地址**会 miss（原实现在该窗口返回 null），而直解按当前
 * 资源地址校验可直接命中。
 *
 * @returns 直解命中返回文件；任一环不成立返回 null（调用方回退索引）
 */
function resolveResourceUrlDirect(url: string, app: App): TFile | null {
	for (const candidate of resourceUrlPathCandidates(url)) {
		const file = app.vault.getFileByPath(normalizePath(candidate));
		if (!file) {
			continue;
		}
		try {
			if (app.vault.getResourcePath(file) === url) {
				return file;
			}
		} catch {
			// 该候选的资源地址计算失败：继续下一候选（最终回退索引）
		}
	}
	return null;
}

/**
 * 把库内文件的绝对路径归一为库内相对路径（官方 getBasePath 前缀剥离）。
 * 前缀匹配大小写不敏感（Windows 磁盘路径大小写不保证一致），
 * 按原串长度切片，保留文件真实大小写。
 * @returns 库内相对路径；非绝对路径或不在库内时返回 null
 */
function stripVaultBase(absPath: string, basePath: string): string | null {
	if (!absPath.startsWith('/')) {
		return null; // 需为绝对路径
	}
	const lower = absPath.toLowerCase();
	const lowerBase = basePath.toLowerCase();
	if (!lower.startsWith(`${lowerBase}/`)) {
		return null;
	}
	return absPath.slice(basePath.length + 1);
}

/**
 * 从拖拽事件中解析被拖入的库内文件。
 * 依次尝试 text/plain、text/uri-list、其他自定义类型、
 * dataTransfer.files、以及 Obsidian 的 dragManager。
 */
export function resolveDroppedFile(
	dataTransfer: DataTransfer,
	app: App,
): TFile | null {
	// 性能：一次拖拽多次解析，缓存文件列表避免重复扫描
	const allFiles = app.vault.getFiles();
	const plain = dataTransfer.getData('text/plain').trim();
	if (plain) {
		const file = resolvePathToFile(plain, app);
		if (file) {
			return file;
		}
	}

	const uriList = dataTransfer.getData('text/uri-list').trim();
	if (uriList) {
		for (const line of uriList.split('\n')) {
			const item = line.trim();
			if (item.startsWith('file://')) {
				try {
					const decoded = decodeURIComponent(
						item.replace(/^file:\/\//, ''),
					);
					const file = resolvePathToFile(decoded, app);
					if (file) {
						return file;
					}
				} catch {
					// 个别 URL 解码失败，跳过该行
				}
			}
		}
	}

	for (const type of Array.from(dataTransfer.types)) {
		if (type === 'text/plain' || type === 'text/uri-list') {
			continue;
		}
		try {
			const value = dataTransfer.getData(type).trim();
			if (!value) {
				continue;
			}
			const file = resolvePathToFile(value, app);
			if (file) {
				return file;
			}
			if (value.startsWith('{')) {
				try {
					const parsed = JSON.parse(value) as Record<string, unknown>;
					const candidate =
						(parsed['path'] as string) ||
						((parsed['file'] as Record<string, unknown>)?.path as string) ||
						(parsed['filePath'] as string) ||
						(parsed['url'] as string);
					if (candidate) {
						const fileFromJson = resolvePathToFile(candidate, app);
						if (fileFromJson) {
							return fileFromJson;
						}
					}
				} catch {
					// 非 JSON 数据，忽略
				}
			}
		} catch {
			// 某些自定义类型无法读取，忽略
		}
	}

	if (dataTransfer.files.length > 0) {
		const dropped = dataTransfer.files[0];
		if (dropped) {
			const basename = dropped.name.replace(/\.[^.]+$/, '');
			const matches = allFiles.filter(
				(file) => file.name === dropped.name || file.basename === basename,
			);
			// 同名歧义时拒绝解析，避免操作到错误文件
			if (matches.length === 1 && matches[0]) {
				return matches[0];
			}
		}
	}

	try {
		const dragData = (app as unknown as { dragManager?: { dragData?: unknown } })
			.dragManager?.dragData as
			| { path?: string; file?: { path?: string }; files?: { path?: string }[] }
			| undefined;
		if (dragData) {
			const candidate =
				dragData.path ||
				dragData.file?.path ||
				dragData.files?.[0]?.path;
			if (candidate) {
				const file = resolvePathToFile(candidate, app);
				if (file) {
					return file;
				}
			}
		}
	} catch {
		// dragManager 可能不可用
	}

	return null;
}

/**
 * 文件夹下的**全部文件**（含子目录）——官方 Canvas「拖入文件夹 = 加入其中所有文件」
 * （`en/Plugins/Canvas.md`）的选文件口径。
 *
 * 前缀按 `folder.path + '/'` 构造，**根文件夹必须特判**：vault 根的 `TFolder.path`
 * 是 `'/'`，直接拼接得到 `'//'`，整库拖入会被当成空文件夹（一个文件都匹配不到）。
 * 同理 `'/'` 前缀本身也只匹配库根下的直接文件。
 */
export function filesUnderFolder(
	files: readonly TFile[],
	folderPath: string,
): TFile[] {
	const prefix = folderPath === '' || folderPath === '/' ? '' : `${folderPath}/`;
	return files.filter((file) => file.path.startsWith(prefix));
}

/**
 * 从拖拽事件中解析被拖入的**文件夹**（官方 Canvas：拖入文件夹 = 加入其中
 * 所有文件，`en/Plugins/Canvas.md`「Add cards from folders」）。
 *
 * 数据源与 `resolveDroppedFile` 同口径（`text/plain` 优先）：文件浏览器拖出的
 * 文件夹与文件是同一种载荷，只有路径指向的类型不同，故按 `TFolder` 收窄判定；
 * 解析为文件（或解析不出）时返回 null，由调用方回落到文件/外部文件通道。
 */
export function resolveDroppedFolder(
	dataTransfer: DataTransfer,
	app: App,
): TFolder | null {
	const plain = dataTransfer.getData('text/plain').trim();
	if (!plain) {
		return null;
	}
	const target = app.vault.getAbstractFileByPath(normalizePath(plain));
	return target instanceof TFolder ? target : null;
}

/**
 * 从拖拽事件的 text/uri-list 中提取真实文件名列表。
 *
 * 修复"拖入附件名乱码"：Windows 下部分来源（微信/QQ、压缩包等）通过
 * 系统 ANSI 代码页提供 File.name，Chromium 解码后得到乱码；而
 * text/uri-list 中的 file:// URL 是 URI 编码的 UTF-8，decode 后可还原
 * 真实文件名。调用方可用本结果替代乱码的 File.name 生成附件名。
 *
 * @returns 与 uri-list 行序一致的真实文件名列表（不含路径）；无法解析时为空数组
 */
export function extractDroppedFileNames(dataTransfer: DataTransfer): string[] {
	const uriList = dataTransfer.getData('text/uri-list');
	if (!uriList) {
		return [];
	}
	const names: string[] = [];
	for (const line of uriList.split('\n')) {
		const item = line.trim();
		if (!item || item.startsWith('#')) {
			continue;
		}
		const pathPart = item.startsWith('file://')
			? item.slice('file://'.length)
			: item;
		try {
			const decoded = decodeURIComponent(pathPart);
			const name = decoded.replace(/\\/g, '/').split('/').pop();
			if (name) {
				names.push(name);
			}
		} catch {
			// 个别 URL 解码失败（如含未编码的 %），跳过该行
		}
	}
	return names;
}
