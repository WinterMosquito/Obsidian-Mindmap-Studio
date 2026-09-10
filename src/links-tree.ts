/**
 * 思维导图树引用更新：文件重命名/删除后，同步树内图片与 [[链接]] 引用。
 * 从 links.ts 拆出。
 *
 * 重命名与清除共享同一遍历实现，仅待匹配形态与替换值不同：
 * - rename：引用改指向新位置（移入回收站场景退化为清除）；
 * - clear：引用一律清空。
 */
import { App, TFile } from 'obsidian';
import { fileLookupIndex } from './file-lookup';
import { walkTree } from './domain/tree';
import { formatWikilink, parseWikilink } from './domain/wikilink';
import type { WikilinkParts } from './domain/wikilink';
import { hasNodeReference } from './node-data';
import type { MindMapTreeNode } from '../vendor/simple-mind-map.cjs';

/** Obsidian 库内回收站目录（vault 根下的 .trash） */
const TRASH_DIR = '.trash';

/** 引用更新模式：rename = 改指向新位置；clear = 清除引用 */
type ReferenceUpdateMode = 'rename' | 'clear';

/**
 * 待匹配的旧引用形态集合：资源地址与 [[链接]] 两种载体各一组。
 */
interface ReferenceTargets {
	/** 资源地址的路径形态：相等或后缀匹配即命中 */
	readonly urlPaths: readonly string[];
	/** 资源地址的文件名形态：地址最后一段精确匹配（含 URL 编码形态） */
	readonly urlNames: readonly string[];
	/** [[链接]] target 的合法形态（兼容 [[note]] 与 [[folder/note]]） */
	readonly linkTargets: readonly string[];
}

/** 去除 Markdown 笔记扩展名 */
function stripMd(path: string): string {
	return path.replace(/\.md$/, '');
}

/** 文件是否位于库内回收站 */
function isTrashedPath(path: string): boolean {
	return path === TRASH_DIR || path.startsWith(`${TRASH_DIR}/`);
}

/** 重命名场景：以旧路径/旧名派生待匹配形态（含当前名兜底历史数据） */
function renameTargets(oldPath: string, file: TFile): ReferenceTargets {
	const oldLastSegment = oldPath.split('/').pop() ?? '';
	return {
		urlPaths: [oldPath, stripMd(oldPath)],
		urlNames: [file.name, oldLastSegment.replace(/\.[^.]+$/, '')],
		linkTargets: [stripMd(oldLastSegment), oldPath, stripMd(oldPath)],
	};
}

/** 删除场景：以文件当前路径/名派生待匹配形态 */
function deleteTargets(file: TFile): ReferenceTargets {
	return {
		urlPaths: [file.path, stripMd(file.path)],
		urlNames: [file.name],
		linkTargets: [file.basename, file.path, stripMd(file.path)],
	};
}

/**
 * 判断导图树是否含任何文件引用节点（图片/附件/超链接/文档双链）。
 * 引用更新前先短路：纯文本导图无需建索引、无需遍历整树。
 * 字段清单与引用预检共用 `NODE_REFERENCE_FIELDS`（node-data.ts）。
 */
function treeHasReferences(tree: MindMapTreeNode): boolean {
	let found = false;
	walkTree(tree, (node) => {
		if (hasNodeReference(node.data)) {
			found = true;
			return false; // 命中即终止整树遍历
		}
		return undefined;
	});
	return found;
}

/**
 * 地址比对形态：原样 + URL 解码。
 * 节点里存的是资源地址（app://...），Obsidian 对中文/空格等文件名会做
 * URL 编码；直接与原始文件名比较会失配，导致"删除附件后节点不更新"。
 */
function urlComparisonForms(url: string): string[] {
	const forms = [url];
	try {
		const decoded = decodeURIComponent(url);
		if (decoded !== url) {
			forms.push(decoded);
		}
	} catch {
		// 个别地址含未编码的 %，仅用原样形态
	}
	return forms;
}

/**
 * 判断节点存储的地址是否指向目标文件：
 * 路径按相等/后缀匹配，文件名按地址最后一段精确匹配
 * （避免 `a.png` 这类短名误命中 `ba.png` 的后缀）。
 */
function urlMatchesTarget(
	url: string,
	paths: readonly string[],
	names: readonly string[],
): boolean {
	for (const form of urlComparisonForms(url)) {
		for (const path of paths) {
			if (form === path || form.endsWith(path)) {
				return true;
			}
		}
		const lastSegment = form.split('/').pop() ?? '';
		for (const name of names) {
			if (
				lastSegment === name ||
				lastSegment === encodeURIComponent(name)
			) {
				return true;
			}
		}
	}
	return false;
}

/** 库内路径的文件夹段（vault 路径恒用 `/`；库根为 ''） */
function vaultFolder(path: string): string {
	const at = path.lastIndexOf('/');
	return at === -1 ? '' : path.slice(0, at);
}

/**
 * 重命名/移动后的 [[链接]] 改写：只替换链接目标，保留 #区块 / |别名 等尾巴。
 *
 * 目标**形态跟用户走**：原链接带路径前缀 → 继续写路径，且路径必须取**新位置**
 * （文件可能被移到别的文件夹，只换 basename 会留下 `[[folder/新名]]` 悬空链接）；
 * 原链接是裸名 → 保持裸名。未跨文件夹时保留用户原本的前缀写法（可能是
 * `b/note` 这类仍可解析的短路径，不必擅自扩写）。
 *
 * 文件名：只有 `.md` 可省略扩展名（Obsidian 语义），canvas/base 必须带扩展名。
 */
function renamedWikilink(
	parts: WikilinkParts,
	file: TFile,
	oldPath: string,
): string {
	const tail = `${parts.block ? `#${parts.block}` : ''}${
		parts.alias ? `|${parts.alias}` : ''
	}`;
	const userPrefix = parts.target.includes('/')
		? parts.target.split('/').slice(0, -1).join('/')
		: '';
	const movedFolder = vaultFolder(file.path);
	const prefix =
		userPrefix === ''
			? ''
			: vaultFolder(oldPath) === movedFolder
				? userPrefix
				: movedFolder;
	const dot = file.name.lastIndexOf('.');
	const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
	const bare =
		extension === '' || extension === 'md' ? file.basename : file.name;
	const newTarget = prefix ? `${prefix}/${bare}` : bare;
	return formatWikilink(`${newTarget}${tail}`);
}

/** 通过索引把资源地址还原为库内路径（O(1)） */
function resolveVaultPathForCompare(
	url: string,
	index: Map<string, TFile>,
): string {
	const file = index.get(url);
	return file ? file.path : url;
}

/**
 * 引用更新的统一实现（rename/clear 共享同一遍历）。
 * 返回是否有变更。
 */
function updateReferences(
	tree: MindMapTreeNode,
	mode: ReferenceUpdateMode,
	file: TFile,
	app: App,
	oldPath?: string,
): boolean {
	// 短路：纯文本导图（无图片/附件/链接）无需建索引、无需遍历整树
	if (!treeHasReferences(tree)) {
		return false;
	}
	// 性能：复用全库共享缓存索引（文件重命名/删除事件高频触发，避免每次全库重建）
	const resourceIndex = fileLookupIndex.get(app);
	// 特殊场景：文件被移入 Obsidian 库内回收站（.trash/）——用户视角是"删除"，
	// 重命名模式下退化为清除引用，而不是把引用改指向回收站位置
	// （否则节点会继续显示"已删除"的附件/图片，直到重新打开才更新）。
	const trashed = mode === 'rename' && isTrashedPath(file.path);
	const targets =
		mode === 'rename' && oldPath !== undefined
			? renameTargets(oldPath, file)
			: deleteTargets(file);
	// 改写 [[链接]] 需要判断"是否跨文件夹移动"：oldPath 缺失（仅 clear 模式可达，
	// 那时不会调用改写）时按未移动处理
	const previousPath = oldPath ?? file.path;
	// clear 与回收站场景的替换值一律为空串（资源地址同理，不调用 getResourcePath）
	let replacementUrl = '';
	if (mode === 'rename' && !trashed) {
		replacementUrl = app.vault.getResourcePath(file);
	}
	let changed = false;
	walkTree(tree, (node) => {
		if (node.data?.image) {
			const imagePath = resolveVaultPathForCompare(
				node.data.image,
				resourceIndex,
			);
			if (urlMatchesTarget(imagePath, targets.urlPaths, targets.urlNames)) {
				node.data.image = replacementUrl;
				changed = true;
			}
		}
		if (node.data?.attachmentUrl) {
			const attachmentPath = resolveVaultPathForCompare(
				node.data.attachmentUrl,
				resourceIndex,
			);
			if (urlMatchesTarget(attachmentPath, targets.urlPaths, targets.urlNames)) {
				node.data.attachmentUrl = replacementUrl;
				node.data.attachmentName = replacementUrl ? file.name : '';
				changed = true;
			}
		}
		if (node.data?.hyperlink) {
			const parts = parseWikilink(node.data.hyperlink);
			// 兼容 [[note]] 与全路径 [[folder/note]]（后者无 .md 扩展名）
			if (parts && targets.linkTargets.includes(parts.target)) {
				node.data.hyperlink =
					mode === 'rename' && !trashed
						? renamedWikilink(parts, file, previousPath)
						: '';
				changed = true;
			}
		}
		// 文档双链通道（非引擎字段，引擎类型未声明故为 any）：与 hyperlink
		// 同语义更新，否则重命名后引用失联。typeof 收窄以通过 lint 严格类型
		const docData = node.data;
		const docWikiLink: unknown = docData?.mdWikiLinkpath;
		if (docData && typeof docWikiLink === 'string' && docWikiLink) {
			const parts = parseWikilink(docWikiLink);
			if (parts && targets.linkTargets.includes(parts.target)) {
				docData.mdWikiLinkpath =
					mode === 'rename' && !trashed
						? renamedWikilink(parts, file, previousPath)
						: '';
				changed = true;
			}
		}
	});
	return changed;
}

/**
 * 文件重命名后，更新思维导图树中对旧文件的引用（图片、附件与 [[链接]]）。
 * 返回是否有变更。
 */
export function updateReferencesOnRename(
	tree: MindMapTreeNode,
	file: TFile,
	oldPath: string,
	app: App,
): boolean {
	return updateReferences(tree, 'rename', file, app, oldPath);
}

/**
 * 文件删除后，清除思维导图树中对它的引用（图片、附件与 [[链接]]）。
 * 返回是否有变更。
 */
export function removeReferencesOnDelete(
	tree: MindMapTreeNode,
	file: TFile,
	app: App,
): boolean {
	return updateReferences(tree, 'clear', file, app);
}
