/**
 * 思维导图树引用更新：文件重命名/删除后，同步树内图片与 [[链接]] 引用。
 * 从 links.ts 拆出。
 *
 * 重命名与清除共享同一遍历实现，仅待匹配形态与替换值不同；
 * **引用只改不删**（删除/回收站场景保留未解析引用，只有内嵌图片例外）——
 * 见 K55 与 `removeReferencesOnDelete` 的契约：
 * - rename：引用改指向新位置（移入回收站场景退化为清除）；
 * - clear：引用一律清空。
 */
import { App, TFile } from 'obsidian';
import { fileLookupIndex } from './file-lookup';
import { isRemoteOrDataUrl } from '../domain/url';
import { walkTree } from '../domain/tree';
import { formatWikilink, parseWikilink } from '../domain/wikilink';
import type { WikilinkParts } from '../domain/wikilink';
import { hasNodeReference } from '../core/node-data';
import type { MindMapTreeNode } from '../../vendor/simple-mind-map.cjs';
import type { MdNodeData } from '../core/node-data';

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

/**
 * 从树里摘除指定节点（**按对象身份**，自底向上遍历，边遍历边 splice 安全）。
 * 仅用于「附件整条删除后已空且无子节点」的叶子节点（见 updateReferences）。
 */
function pruneNodes(
	tree: MindMapTreeNode,
	targets: ReadonlySet<MindMapTreeNode>,
): boolean {
	let removed = false;
	const walk = (parent: MindMapTreeNode): void => {
		const children = parent.children;
		if (!children) {
			return;
		}
		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i]!;
			walk(child);
			if (targets.has(child)) {
				children.splice(i, 1);
				removed = true;
			}
		}
	};
	walk(tree);
	return removed;
}

/**
 * 附件引用**整条删除**：清空附件通道字段，并去掉节点文字（`data.text`）里那段可见名。
 *
 * 为什么必须动 `text`：附件在节点里显示为文件名/别名，而**那串文字就是 `data.text`
 * 的一部分**。只清字段的话，下一次保存的合成会把它当普通文本写进文件——留下一个
 * 既不是链接、也不再指向任何文件的「报告.pdf」（用户实测反馈的同类残留）。
 * 去掉名字后 `text !== mdDerivedText` ⇒ 走合成 ⇒ 引用语法与名字一起从行里消失
 *（合成路径对「字段已无」的段不输出形态，见 md-serialize.composeFirstLineSegmented）。
 *
 * 纯附件节点（`- [[报告.pdf]]`）因此变成空文本节点：序列化写出空列表项 `- `，
 * 重新解析时该行不含内容 → 节点随之消失（= 用户要的「整个删除」）。
 */
function removeAttachmentReference(data: MdNodeData): void {
	const name = typeof data.attachmentName === 'string' ? data.attachmentName : '';
	delete data.attachmentUrl;
	delete data.attachmentName;
	delete data.mdAttachmentLinkpath;
	const text = typeof data.text === 'string' ? data.text : '';
	if (!name || !text) {
		return;
	}
	const lines = text.split('\n');
	lines[0] = (lines[0] ?? '')
		.replace(name, '')
		.replace(/[ \t]{2,}/g, ' ')
		.trimEnd();
	data.text = lines.join('\n');
}

/**
 * md 链接形态的目标（如 `目录/笔记.md`）是否指向本次被重命名的文件。
 *
 * 判定走「去 `.md` 后与旧路径 / 旧文件名（可带目录前缀）比较」——与 `renameTargets`
 * 派生 `linkTargets` 的口径一致，只是这里比的是**链接里存的目标**而非链接文本。
 */
function mdTargetRenamed(dest: string, file: TFile, oldPath: string): boolean {
	if (!dest || isRemoteOrDataUrl(dest)) {
		return false;
	}
	const norm = stripMd(dest);
	if (!norm || norm === stripMd(file.path)) {
		// 已等于新路径：无需改写（幂等）
		return false;
	}
	if (norm === stripMd(oldPath)) {
		return true;
	}
	const oldBase = stripMd(oldPath.split('/').pop() ?? '');
	return oldBase !== '' && (norm === oldBase || norm.endsWith(`/${oldBase}`));
}

/** 路径末段的扩展名（小写，无扩展名为空串） */
function extensionOfPath(path: string): string {
	const name = path.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * 由重命名后的文件与旧路径推导新目标（md 链接形态），保留用户原有的路径前缀写法。
 * 与 `renamedWikilink` 同源：它是 wiki 形态（`[[…]]`），这里取内层并按需补回扩展名。
 */

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
	// 「附件整条删除后已空」的叶子节点：遍历结束后按对象身份摘除
	//（遍历中直接 splice 会破坏 walkTree 的迭代，故先收集再施加）
	const pruneCandidates = new Set<MindMapTreeNode>();
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
				if (mode === 'rename' && !trashed) {
					node.data.attachmentUrl = replacementUrl;
					node.data.attachmentName = file.name;
					changed = true;
				} else if (!node.children || node.children.length === 0) {
					// 删除 / 回收站：**整条删除**（引用 + 节点内的可见文字），
					// 用户明确要求「附件不纳入保留未解析引用」——见 K55。
					// 带子节点的节点除外：整条删除会连带子树，退化为「保留未解析引用」
					removeAttachmentReference(node.data);
					if (!node.data.text) {
						// 纯附件节点：文字也空了 ⇒ 连节点一并摘除（否则留下空列表项，
						// 重新解析会变成一个 `-` 文本节点）
						pruneCandidates.add(node);
					}
					changed = true;
				}
			}
		}
		if (node.data?.hyperlink) {
			const parts = parseWikilink(node.data.hyperlink);
			// 兼容 [[note]] 与全路径 [[folder/note]]（后者无 .md 扩展名）
			if (parts && targets.linkTargets.includes(parts.target)) {
				// **链接只改不删**（2026-09-15 修订，见 K55）：删除笔记时改写别处的
				// `[[链接]]` 是破坏性的——Obsidian 自己删除笔记同样保留「未解析链接」
				// （同名笔记重建即恢复）。此前 clear 模式把字段清空，而 `text` 与
				// `mdSegments` 不动，于是**下次保存会把 `[[笔记A]]` 静默降级为纯文本
				// `笔记A`**（用户实测反馈）；重命名（含移入回收站）仍照旧改写/清空。
				if (mode === 'rename' && !trashed) {
					node.data.hyperlink = renamedWikilink(parts, file, previousPath);
					changed = true;
				}
			} else if (
				!parts &&
				mdTargetRenamed(node.data.hyperlink, file, previousPath)
			) {
				// md 链接形态 `[显示名](路径.md)`：官方关闭「使用 \[\[Wikilinks\]\]」后
				// 新链接就是这种形态（2026-09-15 对齐官方偏好），重命名必须同样改写，
				// 否则这类链接在重命名后失效（此前只认 `[[…]]` 形态）。
				const renamed = renamedWikilink(
					parseWikilink(`[[${node.data.hyperlink}]]`)!,
					file,
					previousPath,
				);
				const inner = renamed.slice(2, -2);
				const extension = extensionOfPath(node.data.hyperlink);
				node.data.hyperlink =
					extension && !inner.toLowerCase().endsWith(`.${extension}`)
						? `${inner}.${extension}`
						: inner;
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
				// 同 hyperlink：删除模式保留未解析链接（K55）
				if (mode === 'rename' && !trashed) {
					docData.mdWikiLinkpath = renamedWikilink(
						parts,
						file,
						previousPath,
					);
					changed = true;
				}
			}
		}
	});
	// 附件整条删除后已空的叶子节点：连节点一并摘除（「整个删除」）
	if (pruneCandidates.size > 0 && pruneNodes(tree, pruneCandidates)) {
		changed = true;
	}
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
 * 文件删除后，清理思维导图树中对它的**内嵌媒体**引用（仅 `image`）。
 *
 * **链接保留、附件整条删除**（2026-09-15 修订，K55）：
 * - `hyperlink` / `mdWikiLinkpath` → 保留为**未解析链接**（与 Obsidian 一致：删笔记
 *   不改写别处的 `[[链接]]`，同名笔记重建即恢复）。此前一律清空字段但不动 `text` /
 *   `mdSegments`，导致下次保存把 `[[笔记A]]` 静默降级为纯文本（用户实测反馈，不可逆）；
 * - `attachmentUrl` / `attachmentName` / `mdAttachmentLinkpath` → **整条删除**，并
 *   连同节点文字里的可见名一起去掉（用户明确选择：附件不纳入保留策略，见
 *   `removeAttachmentReference`）；
 * - `image` 仍按删除即清除（节点内**内嵌媒体**，目标缺失会留下坏死图块）。
 * 返回是否有变更（仅链接引用的树 → false，不触发无意义保存）。
 */
export function removeReferencesOnDelete(
	tree: MindMapTreeNode,
	file: TFile,
	app: App,
): boolean {
	return updateReferences(tree, 'clear', file, app);
}
