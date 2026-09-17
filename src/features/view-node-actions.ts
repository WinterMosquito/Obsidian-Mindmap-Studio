/**
 * 节点操作：增删改节点（链接/文本/剪贴板/删除）。
 * 被工具栏（view-toolbar.ts）与右键菜单（view-context-menu.ts）共用。
 *
 * 图片操作已拆至 view-image-actions.ts 并由本文件 re-export 保持调用稳定：
 *   addImageToActiveNode / applyNodeImage / removeNodeImage / normalizeImageReference
 */
import { Notice, TFile, type App } from 'obsidian';
import {
	ENGINE_COMMANDS,
	forceRemoveNodeData,
	getNodeDataString,
	getRenderRoot,
	isCustomNodeContent,
	setNodeText,
	startNodeTextEdit,
} from '../engine/mindmap';
import { openLinkEditorModal } from '../ui/modal-link';
import { openNodeTextModal } from '../ui/modal-text';
import { markNodeNeedLayout } from '../engine/mindmap';
import { notifyError } from '../core/errors';
import { isEmbeddableAttachmentExtension } from '../core/constants';
import { resolvePathToFile } from '../links/links-resolve';
import { t } from '../core/i18n';
import { isHyperlinkProtocolUrl } from '../domain/url';
import { applyRawToNode } from '../markdown/md-line-write';
import { composeNodeContent, isPureLinkNode } from '../markdown/md-serialize';
import {
	ensureDefaultImageSizes,
	resolveImagePath,
	walkCorrectImageSizesByAspect,
} from '../media/images-path';

import {
	formatLinkPath,
	formatWikilink,
	isDocumentExtension,
	linkDisplayText,
	parseWikilink,
	wikilinkTargetIsAttachment,
} from '../domain/wikilink';
import { preferredLinkPathFormat, prefersMarkdownLinks } from '../platform/vault-prefs';
import { inlineContentPreview } from './node-inline-content';
import { requireActiveNode, insertChildNodeWithData } from './view-common';
import type { MdNodeData } from '../core/node-data';
import type { MindMapNode, MindMapNodeData } from '../../vendor/simple-mind-map.cjs';
import type {
	MindMapViewContext,
	ViewNodeEditContext,
} from './view-context';

/** 删除文档双链通道字段（不重绘；调用方按需 render） */
function clearDocWikiLink(node: MindMapNode): void {
	const data = node.getData() as MdNodeData;
	delete data.mdWikiLinkpath;
	delete data.mdLinkText;
}

/**
 * 节点是否已有任何内容（决策 R4 修订的分流依据，2026-09-13）：
 * 文字 / 链接三通道（文档双链、附件、超链接）/ 图片 / 行内额外 token
 * （`mdSegments` 里 `first: false` 的项，见 K52）任一存在即为真。
 *
 * **完全空白**（全无）→ 覆盖（纯双链化）——"拖入即变链接节点"的便捷路径；
 * **其余任何情况** → 链接建为子节点——行内多 token 已保真（见
 * md-meta.MdTokenSegment），拖入/添加链接只是「再挂一个链接」，不得覆盖
 * 节点已有内容（文字 / 原链接 / 行内其它 token / 图片）。
 */
function hasAnyContent(data: MdNodeData): boolean {
	const text = typeof data.text === 'string' ? data.text.trim() : '';
	if (text) {
		return true;
	}
	if (data.image) {
		return true;
	}
	for (const key of ['mdWikiLinkpath', 'attachmentUrl', 'hyperlink'] as const) {
		const value = data[key];
		if (typeof value === 'string' && value) {
			return true;
		}
	}
	// 行内额外 token（多链接 / 多 URL / 多图）：显示上可能不可见（如图片已移除、
	// 行尾仍残留 `![[b.png]]`），但文件层面仍是内容——覆盖会改变该行
	if (data.mdSegments?.some((segment) => !segment.first)) {
		return true;
	}
	return false;
}

/** R4 修订：把链接作为子节点挂到节点下（父节点原样不动） */
function appendLinkChild(
	view: MindMapViewContext,
	node: MindMapNode,
	data: Record<string, unknown>,
): void {
	insertChildNodeWithData(view, node, data);
	view.scheduleSave();
}

/**
 * 文档双链：写 mdWikiLinkpath 通道（**不写**引擎 hyperlink）——引擎会为任何
 * hyperlink 渲染原生链接图标，而文档双链应显示自绘文档页图标（见 mindmap.ts）。
 * 与解析侧（md-outline 的 wiki 分支）保持同一通道，避免"文件里的链接有文档图标、
 * 拖入/弹窗新建的却是原生链条图标"的不一致。
 *
 * 写入语义（决策 R4 修订，2026-09-13）：
 * - **已有任何内容**（文字 / 原链接 / 图片）→ 链接建成子节点，节点原样不动；
 * - **完全空白**（无文字、无链接、无图片）→ 「纯双链化」：节点文字覆盖为链接
 *   显示名（别名优先），底层 md 行只剩 `[[目标|显示名]]`。
 */
export function applyDocWikiLink(
	view: MindMapViewContext,
	node: MindMapNode,
	link: string,
	label: string | undefined,
): void {
	const data = node.getData() as MdNodeData;
	const display = label ?? linkDisplayText(link);
	if (prefersMarkdownLinks(view.app)) {
		// 官方「使用 \[\[Wikilinks\]\]」**关闭** → 也写 md 链接形态 `[显示名](路径.md)`
		// （与 Obsidian 在该设置下插入的链接一致；2026-09-15 对齐官方偏好）。
		// 走 `hyperlink` 通道（引擎原生链接图标）而非 `mdWikiLinkpath`（自绘文档页图标）
		// ——这是跟随官方设置的代价，默认（Wikilinks 开启）行为完全不变。
		applyMdLink(view, node, markdownDocTarget(link), display);
		return;
	}
	if (hasAnyContent(data)) {
		appendLinkChild(view, node, {
			text: display,
			mdWikiLinkpath: link,
			mdLinkStyle: 'wiki',
			mdLinkText: display,
		});
		return;
	}
	delete data.hyperlink;
	delete data.hyperlinkTitle;
	data.mdWikiLinkpath = link;
	data.mdLinkStyle = 'wiki';
	data.mdLinkText = display;
	markNodeNeedLayout(node);
	// 纯双链化：可见文本覆盖节点文字（本路径仅「完全空白」节点可达，见 hasAnyContent）
	if (display) {
		applyNodeText(view, node, display);
	} else {
		// 无文本可写：链接字段已就地改写，需自行重绘一次（有文本时渲染由
		// setNodeText 内部完成——它在 markNodeNeedLayout 之后执行，一次覆盖两处）
		view.mindMap?.render();
	}
	view.scheduleSave();
}

/**
 * 新建文档链接的**路径形态**：跟随官方「New link format」（默认最短路径）。
 *
 * 只影响**新建**——既有链接改写沿用原始前缀（links-tree 的引用更新口径）。
 * `shortest` 的唯一性判据：`getFirstLinkpathDest` 语义下同名文件会**优先命中
 * 当前文件**，官方口径是「最短**唯一**路径」，故库内存在同名文件时退化为完整
 * 路径（否则指向的文件可能与用户所选不同）。
 */
function newDocLinkpath(file: TFile, sourcePath: string, app: App): string {
	const format = preferredLinkPathFormat(app);
	// 官方「最短路径」对 `.md` 省略扩展名（Obsidian 解析规则），其余带扩展名
	const isMarkdown = file.extension.toLowerCase() === 'md';
	const target =
		format === 'shortest' && isMarkdown
			? file.path.replace(/\.md$/i, '')
			: file.path;
	const ambiguous = format === 'shortest' && hasBasenameConflict(file, app);
	return formatLinkPath(target, sourcePath, format, ambiguous);
}

/**
 * 库内是否存在**同名**文件（不同目录）——最短路径会指向歧义目标，官方口径是
 * 「最短**唯一**路径」，故退化为带目录的路径。
 * 读取失败（无 vault 上下文等）时按「无冲突」处理：退回最短路径，不报错。
 */
function hasBasenameConflict(file: TFile, app: App): boolean {
	try {
		const files = app.vault?.getFiles?.() ?? [];
		return files.some(
			(other) => other !== file && other.basename === file.basename,
		);
	} catch {
		return false;
	}
}

/**
 * 把链接改写为**新路径**，保留用户写下的 `#区块` 与 `|别名`
 * （新建链接时由官方「New link format」决定路径，别名/区块是用户意图，不动）。
 */
function withLinkPath(link: string, linkpath: string): string {
	const parsed = parseWikilink(link);
	if (!parsed) {
		return linkpath;
	}
	const hash = parsed.linkpath.indexOf('#');
	const block = hash >= 0 ? parsed.linkpath.slice(hash) : '';
	return formatWikilink(`${linkpath}${block}`, parsed.alias || undefined);
}

/**
 * 新建/拖入**文档**时的链接串：路径形态跟随官方「New link format」，
 * 别名与 `#区块` 保留（`link` 缺省时按文件路径构造）。
 * 供添加链接弹窗与拖入文档两条入口共用（口径必须一致，否则同一操作两种写法）。
 */
export function newDocLinkFor(
	view: MindMapViewContext,
	file: TFile,
	link = file.path,
): string {
	return withLinkPath(
		link,
		newDocLinkpath(file, view.file?.path ?? '', view.app),
	);
}

/**
 * 双链目标 → md 链接的目标（补 `.md`；官方 md 链接需要完整路径+扩展名）。
 * `[[笔记]]` → `笔记.md`；`[[目录/笔记]]` → `目录/笔记.md`；已带扩展名的原样返回。
 */
function markdownDocTarget(link: string): string {
	const target = parseWikilink(link)?.target ?? link.replace(/^\[\[|\]\]$/g, '');
	if (!target) {
		return link;
	}
	return /\.[^./]+$/.test(target) ? target : `${target}.md`;
}

/**
 * 把库内附件挂到节点（拖入附件时调用）：走引擎 attachmentUrl 通道
 * （原生回形针图标，点击经 node_attachmentClick 打开）+ mdAttachmentLinkpath
 * 回写通道，与解析侧 `[[报告.pdf]]` 语义一致。
 * 写入语义（R4 修订）：已有内容 → 建为子节点；仅完全空白节点覆盖为文件名。
 */
export function applyNodeAttachment(
	view: MindMapViewContext,
	node: MindMapNode,
	file: TFile,
): void {
	const data = node.getData() as MdNodeData;
	// 拖入**可嵌入**的附件（PDF / 音频 / 视频）默认写嵌入语法 `![[报告.pdf]]`——
	// 与 Obsidian 拖放一致（官方帮助「Embed files」：拖入支持的文件即嵌入）；
	// 不可嵌入的（zip/epub 等）写普通链接 `[[文件.zip]]`（Obsidian 对这类文件
	// 同样只插入内部链接，官方帮助「Drag and drop」）。
	const embed = isEmbeddableAttachmentExtension(file.extension);
	// R4 修订：已有内容 → 链接建为子节点（仅完全空白节点覆盖）
	if (hasAnyContent(data)) {
		appendLinkChild(view, node, {
			text: file.name,
			attachmentUrl: view.app.vault.getResourcePath(file),
			attachmentName: file.name,
			mdAttachmentLinkpath: file.path,
			mdLinkStyle: 'wiki',
			...(embed ? { mdEmbed: true } : {}),
		});
		return;
	}
	data.attachmentUrl = view.app.vault.getResourcePath(file);
	data.attachmentName = file.name;
	// 回写用完整库内路径（basename 会被 Obsidian 去掉扩展名，无法定位附件）
	data.mdAttachmentLinkpath = file.path;
	data.mdLinkStyle = 'wiki';
	if (embed) {
		data.mdEmbed = true;
	} else {
		delete data.mdEmbed;
	}
	delete data.hyperlink;
	delete data.hyperlinkTitle;
	delete data.mdWikiLinkpath;
	delete data.mdLinkText;
	markNodeNeedLayout(node);
	// 纯双链化：覆盖节点文字为文件名（仅「完全空白」节点可达；与根节点下新建分支同款 text）
	// 渲染口径同 applyDocWikiLink：有文本时由 setNodeText 内部完成，无文本才自行重绘
	if (data.attachmentName) {
		applyNodeText(view, node, data.attachmentName);
	} else {
		view.mindMap?.render();
	}
	view.scheduleSave();
}

/**
 * 以 **md 链接形态** `[显示名](地址)` 挂到节点。
 *
 * 写入语义与文档双链/附件同款（R4）：已有内容 → 链接建为子节点；仅完全空白节点
 * 覆盖。区别只在「链接文本」——这里节点文本即显示名（`label`），故回写形态是
 * `[显示名](地址)`（纯 token 节点判定 `isPureLinkNode` + renderHyperlink 的 md 分支），
 * 而不是 URL 的 `<url>` autolink 形态：拖入系统文件按住 Ctrl/Option 时 Obsidian
 * 写出的就是带文件名的 md 链接（官方帮助「Drag and drop」）。
 *
 * 三类调用：
 * - 外部地址（http/https/obsidian:///`file:///…`）；
 * - **库内路径**：官方关闭「使用 \[\[Wikilinks\]\]」时，文档链接也写这种形态
 *   （见 `applyDocWikiLink` 的分支与 `prefersMarkdownLinks`）。
 *
 * @param dest  链接地址（外部 URL / 协议 / 库内路径）
 * @param label 链接显示名（拖入场景取文件名）
 */
export function applyMdLink(
	view: MindMapViewContext,
	node: MindMapNode,
	url: string,
	label: string,
): void {
	const data = node.getData() as MdNodeData;
	if (hasAnyContent(data)) {
		appendLinkChild(view, node, {
			text: label,
			hyperlink: url,
			mdLinkStyle: 'md',
			mdLinkText: label,
			hyperlinkTitle: url,
		});
		return;
	}
	// 与「添加链接」的 URL 分支同一命令（引擎同时维护 hyperlink 与图标状态）
	view.mindMap?.execCommand(ENGINE_COMMANDS.SET_NODE_HYPERLINK, node, url);
	data.mdLinkStyle = 'md';
	data.mdLinkText = label;
	// 其余通道的残留字段（`hasAnyContent` 不把它们算作内容，故本分支可能带残渣）：
	// 不清会让回写凭空多出旧引用（md-line-write 的先清后填是解析侧的同一约束）
	delete data.mdWikiLinkpath;
	delete data.attachmentUrl;
	delete data.attachmentName;
	delete data.mdAttachmentLinkpath;
	delete data.mdEmbed;
	delete data.mdEmbedPipe;
	markNodeNeedLayout(node);
	if (label) {
		// 有文本：渲染由 setNodeText 内部完成（见 applyDocWikiLink 说明）；
		// 无文本时上面那条 SET_NODE_HYPERLINK 命令自带重绘（引擎 setNodeDataRender）
		applyNodeText(view, node, label);
	}
	view.scheduleSave();
}

/**
 * 非 URL、非笔记的链接（附件双链 `[[报告.pdf]]` / 库内路径）→ 引擎 attachmentUrl
 * 通道（原生回形针图标，点击经 node_attachmentClick 打开），与解析侧同通道。
 *
 * 可见名（attachmentName + 节点文本）与文档双链同口径：显式 label > 双链别名
 * > 末段文件名——`[[报告.pdf|说明]]` 显示「说明」，与 Obsidian 别名语义一致。
 *
 * 写入语义（R4 修订）：已有内容 → 建为子节点；仅完全空白节点覆盖为可见名。
 */
function applyAttachmentLink(
	view: MindMapViewContext,
	node: MindMapNode,
	link: string,
	label: string | undefined,
): void {
	const data = node.getData() as MdNodeData;
	const parsed = parseWikilink(link);
	const linkpath = parsed?.target ?? link;
	// 可见名优先级：显式 label（联想选择）> 双链别名（手输 `[[路径|别名]]`）> 末段文件名
	const fallbackName = linkpath.split('/').pop() ?? linkpath;
	const name = label ?? ((parsed?.alias ?? '') || fallbackName);
	// R4 修订：已有内容 → 链接建为子节点（仅完全空白节点覆盖）
	if (hasAnyContent(data)) {
		appendLinkChild(view, node, {
			text: name,
			attachmentUrl: linkpath,
			attachmentName: name,
			mdAttachmentLinkpath: linkpath,
			mdLinkStyle: 'wiki',
		});
		return;
	}
	delete data.hyperlink;
	delete data.hyperlinkTitle;
	delete data.mdWikiLinkpath;
	data.attachmentUrl = linkpath;
	data.attachmentName = name;
	data.mdAttachmentLinkpath = linkpath;
	data.mdLinkStyle = 'wiki';
	markNodeNeedLayout(node);
	// 纯双链化：可见名覆盖节点文字（本路径仅「完全空白」节点可达，见 hasAnyContent）
	// 渲染口径同 applyDocWikiLink：有文本时由 setNodeText 内部完成，无文本才自行重绘
	if (name) {
		applyNodeText(view, node, name);
	} else {
		view.mindMap?.render();
	}
	view.scheduleSave();
}

// 图片操作：从 view-image-actions 重新导出，保持既有调用方 import 路径不变
export {
	removeNodeImage,
	addImageToActiveNode,
	applyNodeImage,
} from './view-image-actions';

/** 视图剪贴板（WeakMap 按视图持有：视图关闭后可回收；状态不暴露到 context） */
const clipboards = new WeakMap<MindMapViewContext, MindMapNodeData>();

/**
 * 给当前激活节点添加链接（无节点时提示）。
 *
 * 自兜错误：本函数由工具栏/右键菜单以 `void addLinkToActiveNode(view)` 调用，
 * 失败在此转成用户可见提示（与 view-paste / view-export / creation 同一约定），
 * 调用方无需再挂 .catch，也不会产生未处理拒绝。
 */
export async function addLinkToActiveNode(
	view: MindMapViewContext,
): Promise<void> {
	try {
		await performAddLink(view);
	} catch (error) {
		console.error('插入链接失败', error);
		notifyError(view.lang, 'common.insertLinkFailed', error);
	}
}

/** 插入链接主体（异常由 addLinkToActiveNode 统一兜住） */
async function performAddLink(view: MindMapViewContext): Promise<void> {
	const engine = view.mindMap;
	const node = requireActiveNode(view);
	if (!node) {
		return;
	}
	const current =
		getNodeDataString(node, 'mdWikiLinkpath') ||
		getNodeDataString(node, 'hyperlink');
	const result = await openLinkEditorModal(view.app, current, view.lang);
	if (result === null) {
		return;
	}
	// 弹窗期间可能换文件/重建引擎：旧节点不在新树上，写入会静默丢失
	if (view.mindMap !== engine) {
		return;
	}
	// 清空输入 = 清除链接：两个通道一并清除（文档双链不经引擎 hyperlink 字段）
	if (!result.link) {
		clearNodeHyperlink(view, node);
		return;
	}
	// 图标分流（与解析侧同口径）：
	//   URL / 协议链接 → 引擎 hyperlink（原生链接图标）
	//   双链指向 .md 笔记 → mdWikiLinkpath（自绘文档页图标）
	//   其余（附件双链 / 库内路径）→ attachmentUrl（原生回形针）
	const wiki = parseWikilink(result.link);
	if (!isHyperlinkProtocolUrl(result.link)) {
		const target = wiki?.target ?? result.link;
		// 已解析到库内文件 → 按真实扩展名；未解析（如指向尚不存在的笔记）→ 按
		// 目标串的扩展名判断（无扩展名/.md 视为笔记）
		const file = resolvePathToFile(target, view.app);
		const isDoc = file
			? isDocumentExtension(file.extension)
			: !wikilinkTargetIsAttachment(target);
		if (isDoc) {
			// 新建文档链接：路径形态跟随官方「New link format」（默认最短路径）；
			// 未解析到文件（指向尚不存在的笔记）时按用户原样，无从换算
			const link = file
				? newDocLinkFor(view, file, result.link)
				: result.link;
			applyDocWikiLink(view, node, link, result.label);
		} else {
			applyAttachmentLink(view, node, result.link, result.label);
		}
		return;
	}
	// R4 修订（2026-09-13）：节点已有内容 → 不覆盖，URL 链接建为子节点
	//（仅图标：子节点文本为空、`<url>` 由 hyperlink 通道回写）
	const data = node.getData() as MdNodeData;
	if (hasAnyContent(data)) {
		appendLinkChild(view, node, {
			text: '',
			hyperlink: result.link,
			mdLinkStyle: 'md',
			mdLinkText: result.link,
			hyperlinkTitle: result.link,
		});
		return;
	}
	// 完全空白节点：覆盖为 URL 链接（仅图标——URL 本体不进节点文本）
	markNodeNeedLayout(node);
	view.mindMap?.execCommand(ENGINE_COMMANDS.SET_NODE_HYPERLINK, node, result.link);
	view.scheduleSave();
}

/** 更新节点文本并让引擎重绘该节点（不改写引擎其它状态） */
function applyNodeText(view: MindMapViewContext, node: MindMapNode, text: string): void {
	if (view.mindMap) {
		setNodeText(view.mindMap, node, text);
	}
}

/**
 * 移除节点文字（保留图片/链接等其余数据）：
 * 图片节点移除文字后成为「图片独占节点」（serialize 走纯图 token 合成，
 * 往返保持；见 md-serialize/md-outline 图片独占语义）。
 */
export function removeNodeText(view: MindMapViewContext, node: MindMapNode): void {
	if (view.mindMap) {
		setNodeText(view.mindMap, node, '');
		view.scheduleSave();
	}
}

/**
 * 在指定父节点下新建一个节点（占位名，双击/F2 可改名）。
 *
 * 双击画布空白（官方 Canvas「双击画布新建卡片」，`en/Plugins/Canvas.md`）与
 * 空白处右键「新建节点」的共用实现；父节点由调用方给出（双击空白/空白右键
 * 统一挂根节点下——层级语义下「空白处」没有更近的挂靠点）。
 */
export function createChildNodeBelow(
	view: MindMapViewContext,
	parent: MindMapNode,
): void {
	insertChildNodeWithData(view, parent, {
		text: t(view.lang, 'menu.newNode'),
	});
}

/**
 * 双击画布**空白** → 新建节点（官方 Canvas「Add text cards by double-clicking
 * on the canvas」）。命中节点/链接/输入元素时不接管（节点双击 = 编辑，引擎语义）。
 */
export function setupCanvasQuickCreate(view: MindMapViewContext): void {
	const canvas = view.canvasEl;
	if (!canvas) {
		return;
	}
	view.engineEvents.onDom(canvas, 'dblclick', (event) => {
		const target = event.target;
		if (!(target instanceof Element)) {
			return;
		}
		// 节点区域（引擎双击编辑）、链接与表单元素不接管
		if (target.closest('.smm-node, a, button, input, textarea, [contenteditable]')) {
			return;
		}
		const root = getRenderRoot(view.mindMap);
		if (!root) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		createChildNodeBelow(view, root);
	});
}

/**
 * 编辑节点文本（右键「编辑文本」/ 双击 / F2 的**共用入口**）。
 *
 * 三种节点三条通道：
 * - **默认 SVG 文本节点** → 引擎编辑框（原位内联编辑，`startNodeTextEdit`）；
 * - **纯链接节点**（整行一个链接/图片，文本即其显示名）→ 弹窗**别名模式**：
 *   编辑 `data.text`，提交经 `setNodeText`（纯双链节点即改别名，见 K6）；
 * - **其余自绘（富）节点** → 弹窗**原文模式**：编辑**文件里的那一行**（双链语法、
 *   URL、轻标记全部可见可改），提交重解析写回（`md-line-write.applyRawToNode`）。
 *   此前一律给别名视图 → 混排节点的语法不可见、外链（icon-only）连影子都没有，
 *   用户无从修改（2026-09-15 实测反馈）。
 *
 * 引擎编辑框对自绘节点静默 no-op（`textEdit.show()` 的 `isUseCustomNodeContent()`
 * 守卫），不兜底就等于「双击没反应」。
 */
export function editNodeText(view: ViewNodeEditContext, node: MindMapNode): void {
	const mindMap = view.mindMap;
	if (!mindMap) {
		return;
	}
	if (!isCustomNodeContent(node)) {
		startNodeTextEdit(mindMap, node);
		return;
	}
	const data = node.getData() as MdNodeData;
	// 纯链接节点：别名语义（与序列化的纯 token 判定同源，见 isPureLinkNode）
	if (isPureLinkNode(data)) {
		void openNodeTextModal(
			view.app,
			getNodeDataString(node, 'text'),
			view.lang,
		).then((value) => {
			if (value === null) {
				return;
			}
			setNodeText(mindMap, node, value);
			view.scheduleSave();
		});
		return;
	}
	// 其余富节点：编辑原文行；预填 = 下次写盘会写出的那一行（composeNodeContent）
	const raw = composeNodeContent(data, view.app);
	void openNodeTextModal(view.app, raw, view.lang, {
		rawMode: true,
		// 预览用**渲染器同口径**（URL 显示为地址、轻标记剥壳、超长截断）——
		// 与节点实际外观一致；引擎侧口径（URL icon-only）在这里会误导用户
		preview: (value) => inlineContentPreview(value),
	}).then((value) => {
		// 未改动不写盘（避免无意义的保存与重渲染）
		if (value === null || value === raw) {
			return;
		}
		applyRawNodeContent(view, node, value);
	});
}

/**
 * 原文模式提交：重解析写入 + 图片地址/尺寸校正 + 重渲染 + 保存。
 *
 * 图片：原文里可能新增/更换了引用 —— 库内路径须换成资源地址（与加载期同一入口
 * `resolveImagePath`），尺寸按原始比例校正（异步探测，完成后补一次渲染，与
 * view.ts 的加载流程同款）。无图片时（绝大多数）不做任何额外工作。
 */
function applyRawNodeContent(
	view: ViewNodeEditContext,
	node: MindMapNode,
	raw: string,
): void {
	const data = node.getData() as MdNodeData;
	applyRawToNode(data, raw);
	if (typeof data.image === 'string' && data.image) {
		data.image = resolveImagePath(data.image, view.app);
		// 引擎硬要求 image 节点必有 imageSize（缺失即解构抛错、渲染链中断）：
		// 原本无图的节点被编辑成图片时没有旧值可沿用，先填默认值再渲染，
		// 异步校正随后按比例修正（ensureDefaultImageSizes 注释有 vendor 证据）
		ensureDefaultImageSizes({ data, children: [] });
		void walkCorrectImageSizesByAspect({ data, children: [] }).then(() => {
			markNodeNeedLayout(node);
			view.mindMap?.render();
		});
	}
	markNodeNeedLayout(node);
	view.mindMap?.render();
	view.scheduleSave();
}

/**
 * 自绘节点的双击编辑兜底（引擎 `node_dblclick` 的补充路径）。
 *
 * 引擎双路径对自绘节点都不可用（编辑框静默 no-op），故在视图侧订阅
 * `node_dblclick`：命中自绘节点即弹插件文本弹窗。默认文本节点不受影响
 * ——引擎照常进入编辑框，本监听直接返回。
 */
export function setupNodeTextEditFallback(view: ViewNodeEditContext): void {
	if (!view.mindMap) {
		return;
	}
	view.engineEvents.onEngine(
		view.mindMap,
		'node_dblclick',
		(...args: unknown[]) => {
			const node = args[0] as MindMapNode | undefined;
			if (!node || !isCustomNodeContent(node)) {
				return;
			}
			editNodeText(view, node);
		},
	);
}

/** 清除节点超链接（不影响节点其他数据） */
export function clearNodeHyperlink(
	view: MindMapViewContext,
	node: MindMapNode,
): void {
	const current =
		getNodeDataString(node, 'hyperlink') ||
		getNodeDataString(node, 'mdWikiLinkpath');
	if (!current) {
		return;
	}
	// 文档双链通道非引擎字段，先删；引擎命令只清 hyperlink
	clearDocWikiLink(node);
	// 「清除链接」= 清**全部**链接：台账里链接类的**额外** token 段一并移除
	//（图片类保留——图片嵌入不是链接，见 K9；首链段保留——字段已清，合成时自然
	// 跳过，日后新增链接可复用其位置锚点）
	const data = node.getData() as MdNodeData;
	if (Array.isArray(data.mdSegments)) {
		const kept = data.mdSegments.filter(
			(segment) => segment.kind === 'image' || segment.first === true,
		);
		if (kept.length > 0) {
			data.mdSegments = kept;
		} else {
			delete data.mdSegments;
		}
	}
	markNodeNeedLayout(node);
	view.mindMap?.execCommand(ENGINE_COMMANDS.SET_NODE_HYPERLINK, node, '');
	view.mindMap?.render();
	view.scheduleSave();
}

/**
 * 删除选中节点（修复 3/4）：
 * 1. 先走引擎 REMOVE_NODE 常规路径（实例清理 + 历史记录 + 渲染）；
 * 2. 兜底：若节点数据因 uid 异常未被清除，按对象身份强制移除，杜绝残留。
 */
export function deleteActiveNode(view: ViewNodeEditContext): void {
	const node = requireActiveNode(view);
	const mindMap = view.mindMap;
	if (!node || !mindMap) {
		return;
	}
	if (node.isRoot) {
		new Notice(t(view.lang, 'common.rootCannotDelete'));
		return;
	}
	const parent = node.parent;
	const nodeData = node.nodeData;
	mindMap.execCommand(ENGINE_COMMANDS.REMOVE_NODE);
	// 兜底：uid 重复/缺失时引擎按 uid 的删除可能失败，按对象身份强制清除
	if (parent) {
		forceRemoveNodeData(mindMap, parent, nodeData);
	}
	view.scheduleSave();
}

/** 复制节点（深拷贝节点数据到视图剪贴板） */
export function copyNode(view: MindMapViewContext, node: MindMapNode): void {
	const data = node.getData
		? (node.getData() as MindMapNodeData)
		: node.nodeData.data;
	clipboards.set(view, JSON.parse(JSON.stringify(data)) as MindMapNodeData);
	new Notice(t(view.lang, 'common.nodeCopied'));
}

/** 粘贴剪贴板节点为指定节点的子节点（未指定时挂到根节点） */
export function pasteNodeAsChild(
	view: MindMapViewContext,
	node: MindMapNode | null,
): void {
	const cached = clipboards.get(view);
	if (!cached) {
		new Notice(t(view.lang, 'common.clipboardEmpty'));
		return;
	}
	// 复制的是节点数据；剥离 uid 与激活状态后作为新节点的初始数据
	const { uid: _uid, isActive: _isActive, ...clipboardData } = cached;
	// 未选中节点时挂到根节点下（引擎在 appointNodes 与激活列表均为空时
	// 直接 return，空数组粘贴会静默失效）
	insertChildNodeWithData(view, node ?? getRenderRoot(view.mindMap), clipboardData);
}
