/**
 * 节点操作：增删改节点（链接/文本/剪贴板/删除）。
 * 被工具栏（view-toolbar.ts）与右键菜单（view-context-menu.ts）共用。
 *
 * 图片操作已拆至 view-image-actions.ts 并由本文件 re-export 保持调用稳定：
 *   addImageToActiveNode / applyNodeImage / removeNodeImage / normalizeImageReference
 */
import { Notice, TFile } from 'obsidian';
import {
	ENGINE_COMMANDS,
	forceRemoveNodeData,
	getNodeDataString,
	getRenderRoot,
	setNodeText,
} from '../mindmap';
import { openLinkEditorModal } from '../modal-link';
import { markNodeNeedLayout } from '../mindmap';
import { notifyError } from '../errors';
import { resolvePathToFile } from '../links-resolve';
import { t } from '../i18n';
import { isHyperlinkProtocolUrl } from '../domain/url';

import {
	isDocumentExtension,
	linkDisplayText,
	parseWikilink,
	wikilinkTargetIsAttachment,
} from '../domain/wikilink';
import { requireActiveNode, insertChildNodeWithData } from './view-common';
import type { MdNodeData } from '../node-data';
import type { MindMapNode, MindMapNodeData } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/** 删除文档双链通道字段（不重绘；调用方按需 render） */
function clearDocWikiLink(node: MindMapNode): void {
	const data = node.getData() as MdNodeData;
	delete data.mdWikiLinkpath;
	delete data.mdLinkText;
}

/**
 * 节点是否已有任何内容（决策 R4 修订的分流依据，2026-09-13）：
 * 文字 / 链接三通道（文档双链、附件、超链接）/ 图片 / 行内额外 token
 * （`mdExtraTokens`，见 K49）任一存在即为真。
 *
 * **完全空白**（全无）→ 覆盖（纯双链化）——"拖入即变链接节点"的便捷路径；
 * **其余任何情况** → 链接建为子节点——行内多 token 尾插已保真（见
 * md-meta.mdExtraTokens），拖入/添加链接只是「再挂一个链接」，不得覆盖
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
	// 行内额外 token（多链接 / 多图等）：显示上可能不可见（如图片已移除、
	// 行尾仍残留 `![[b.png]]`），但文件层面仍是内容——覆盖会改变该行
	if (Array.isArray(data.mdExtraTokens) && data.mdExtraTokens.length > 0) {
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
	}
	view.mindMap?.render();
	view.scheduleSave();
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
	// R4 修订：已有内容 → 链接建为子节点（仅完全空白节点覆盖）
	if (hasAnyContent(data)) {
		appendLinkChild(view, node, {
			text: file.name,
			attachmentUrl: view.app.vault.getResourcePath(file),
			attachmentName: file.name,
			mdAttachmentLinkpath: file.path,
			mdLinkStyle: 'wiki',
		});
		return;
	}
	data.attachmentUrl = view.app.vault.getResourcePath(file);
	data.attachmentName = file.name;
	// 回写用完整库内路径（basename 会被 Obsidian 去掉扩展名，无法定位附件）
	data.mdAttachmentLinkpath = file.path;
	data.mdLinkStyle = 'wiki';
	delete data.hyperlink;
	delete data.hyperlinkTitle;
	delete data.mdWikiLinkpath;
	delete data.mdLinkText;
	markNodeNeedLayout(node);
	// 纯双链化：覆盖节点文字为文件名（仅「完全空白」节点可达；与根节点下新建分支同款 text）
	applyNodeText(view, node, data.attachmentName);
	view.mindMap?.render();
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
	if (name) {
		applyNodeText(view, node, name);
	}
	view.mindMap?.render();
	view.scheduleSave();
}

// 图片操作：从 view-image-actions 重新导出，保持既有调用方 import 路径不变
export {
	removeNodeImage,
	addImageToActiveNode,
	applyNodeImage,
	normalizeImageReference,
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
			applyDocWikiLink(view, node, result.link, result.label);
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
	// 「清除链接」= 清**全部**链接：额外 token 中的链接类一并移除
	//（图片类保留——图片嵌入不是链接，见 md-meta.mdExtraTokens 契约）
	const data = node.getData() as MdNodeData;
	if (Array.isArray(data.mdExtraTokens)) {
		const kept = data.mdExtraTokens.filter((token) => token.kind === 'image');
		if (kept.length > 0) {
			data.mdExtraTokens = kept;
		} else {
			delete data.mdExtraTokens;
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
export function deleteActiveNode(view: MindMapViewContext): void {
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
