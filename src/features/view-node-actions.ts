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
 * 文档双链：写 mdWikiLinkpath 通道（**不写**引擎 hyperlink）——引擎会为任何
 * hyperlink 渲染原生链接图标，而文档双链应显示自绘文档页图标（见 mindmap.ts）。
 * 与解析侧（md-outline 的 wiki 分支）保持同一通道，避免"文件里的链接有文档图标、
 * 拖入/弹窗新建的却是原生链条图标"的不一致。
 *
 * @param oldDisplay 旧链接的可见文本：节点文本仍等于它时同步为新显示名
 */
export function applyDocWikiLink(
	view: MindMapViewContext,
	node: MindMapNode,
	link: string,
	label: string | undefined,
	oldDisplay: string | null,
): void {
	const data = node.getData() as MdNodeData;
	delete data.hyperlink;
	delete data.hyperlinkTitle;
	data.mdWikiLinkpath = link;
	data.mdLinkStyle = 'wiki';
	const display = label ?? linkDisplayText(link);
	data.mdLinkText = display;
	markNodeNeedLayout(node);
	// 与 Obsidian 双链对齐：可见文本同步到节点文本（仅空文本或仍是旧显示名时）
	const text = getNodeDataString(node, 'text');
	if (display && (!text.trim() || text.trim() === oldDisplay)) {
		applyNodeText(view, node, display);
	}
	view.mindMap?.render();
	view.scheduleSave();
}

/**
 * 把库内附件挂到节点（拖入附件时调用）：走引擎 attachmentUrl 通道
 * （原生回形针图标，点击经 node_attachmentClick 打开）+ mdAttachmentLinkpath
 * 回写通道，与解析侧 `[[报告.pdf]]` 语义一致；同时清掉超链接字段，
 * 避免回形针与链接图标双显。
 */
export function applyNodeAttachment(
	view: MindMapViewContext,
	node: MindMapNode,
	file: TFile,
): void {
	const data = node.getData() as MdNodeData;
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
 * @param oldDisplay 旧链接的可见文本：节点文本仍等于它时同步为新显示名
 */
function applyAttachmentLink(
	view: MindMapViewContext,
	node: MindMapNode,
	link: string,
	label: string | undefined,
	oldDisplay: string | null,
): void {
	const data = node.getData() as MdNodeData;
	delete data.hyperlink;
	delete data.hyperlinkTitle;
	delete data.mdWikiLinkpath;
	const parsed = parseWikilink(link);
	const linkpath = parsed?.target ?? link;
	// 可见名优先级：显式 label（联想选择）> 双链别名（手输 `[[路径|别名]]`）> 末段文件名
	const fallbackName = linkpath.split('/').pop() ?? linkpath;
	const name = label ?? ((parsed?.alias ?? '') || fallbackName);
	data.attachmentUrl = linkpath;
	data.attachmentName = name;
	data.mdAttachmentLinkpath = linkpath;
	data.mdLinkStyle = 'wiki';
	markNodeNeedLayout(node);
	const text = getNodeDataString(node, 'text');
	if (name && (!text.trim() || text.trim() === oldDisplay)) {
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
	const oldDisplay = current ? linkDisplayText(current) : null;
	if (!isHyperlinkProtocolUrl(result.link)) {
		const target = wiki?.target ?? result.link;
		// 已解析到库内文件 → 按真实扩展名；未解析（如指向尚不存在的笔记）→ 按
		// 目标串的扩展名判断（无扩展名/.md 视为笔记）
		const file = resolvePathToFile(target, view.app);
		const isDoc = file
			? isDocumentExtension(file.extension)
			: !wikilinkTargetIsAttachment(target);
		if (isDoc) {
			applyDocWikiLink(view, node, result.link, result.label, oldDisplay);
		} else {
			applyAttachmentLink(view, node, result.link, result.label, oldDisplay);
		}
		return;
	}
	// 设置新链接前清除可能残留的文档双链通道，避免图标/序列化歧义
	clearDocWikiLink(node);
	markNodeNeedLayout(node);
	view.mindMap?.execCommand(ENGINE_COMMANDS.SET_NODE_HYPERLINK, node, result.link);
	// URL/协议链接：仅添加超链接图标——不把 <url> 当作节点文本（尖括号内链接不渲染）。
	if (result.link && isHyperlinkProtocolUrl(result.link)) {
		// 保持「仅图标」：若节点文本仍是旧 URL 显示名（历史/旧行为残留），清空，
		// 避免节点内残留一个过期的 URL 文本。
		if (current) {
			const text = getNodeDataString(node, 'text');
			if (text.trim() !== '' && text.trim() === linkDisplayText(current)) {
				applyNodeText(view, node, '');
			}
		}
		view.scheduleSave();
		return;
	}
	// 与 Obsidian 双链对齐：链接的「可见文本」同步到节点文本——
	// 仅当节点文本为空、或文本仍是旧链接的可见名（改链场景）时更新，
	// 保留用户已有正文（正文节点只附加链接）。
	const newDisplay = result.label ?? linkDisplayText(result.link);
	const text = getNodeDataString(node, 'text');
	if (newDisplay && (!text.trim() || text.trim() === oldDisplay)) {
		applyNodeText(view, node, newDisplay);
	}
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
