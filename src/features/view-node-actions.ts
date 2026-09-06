/**
 * 节点操作：增删改节点（链接/图片）、复制粘贴、删除。
 * 被工具栏（view-toolbar.ts）与右键菜单（view-context-menu.ts）共用。
 */
import { App, Notice, TFile } from 'obsidian';
import {
	forceRemoveNodeData,
	getActiveNode,
	setNodeText,
} from '../mindmap';
import { createSetNodeImageOptions } from '../images-path';
import { createAspectSetNodeImageOptions } from '../images-path';
import { saveImageToVault } from '../images-save';
import { resolvePathToFile } from '../links-resolve';
import { openImageEditorModal } from '../modal-image';
import { openLinkEditorModal } from '../modal-link';
import { t } from '../i18n';
import {
	isAppResourceUrl,
	isExternalImageRef,
	isHyperlinkProtocolUrl,
} from '../domain/url';
import { linkDisplayText } from '../domain/wikilink';
import type { MdNodeData } from '../node-data';
import type {
	MindMapNode,
	MindMapNodeData,
} from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/** 视图剪贴板（WeakMap 按视图持有：视图关闭后可回收；状态不暴露到 context） */
const clipboards = new WeakMap<MindMapViewContext, MindMapNodeData>();

/** 给当前激活节点添加链接（无节点时提示） */
export async function addLinkToActiveNode(view: MindMapViewContext): Promise<void> {
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
		return;
	}
	const current = (node.getData?.('hyperlink') as string) || '';
	const result = await openLinkEditorModal(view.app, current, view.lang);
	if (result === null) {
		return;
	}
	view.mindMap?.execCommand('SET_NODE_HYPERLINK', node, result.link);
	// URL/协议链接：仅添加超链接图标——不把 <url> 当作节点文本（尖括号内链接不渲染）。
	if (result.link && isHyperlinkProtocolUrl(result.link)) {
		// 保持「仅图标」：若节点文本仍是旧 URL 显示名（历史/旧行为残留），清空，
		// 避免节点内残留一个过期的 URL 文本。
		if (current) {
			const text = (node.getData?.('text') as string | undefined) ?? '';
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
	const oldDisplay = current ? linkDisplayText(current) : null;
	const text = (node.getData?.('text') as string | undefined) ?? '';
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

/** 单独移除节点图片（不影响节点与其他数据） */
export function removeNodeImage(view: MindMapViewContext, node: MindMapNode): void {
	view.mindMap?.execCommand(
		'SET_NODE_IMAGE',
		node,
		createSetNodeImageOptions(null),
	);
}

/** 清除节点超链接（不影响节点其他数据） */
export function clearNodeHyperlink(
	view: MindMapViewContext,
	node: MindMapNode,
): void {
	const current = (node.getData?.('hyperlink') as string) || '';
	if (!current) {
		return;
	}
	view.mindMap?.execCommand('SET_NODE_HYPERLINK', node, '');
	view.scheduleSave();
}

/** 插入图片（需求 1 + 2）：统一固定尺寸；支持本地文件/剪贴板/URL */
export async function addImageToActiveNode(view: MindMapViewContext): Promise<void> {
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
		return;
	}
	const current = (node.getData?.('image') as string) || '';
	const result = await openImageEditorModal(
		view.app,
		current,
		(file, maxSizeMB) =>
			saveImageToVault({
				app: view.app,
				sourcePath: view.file?.path ?? '',
				file,
				maxSizeMB,
				lang: view.lang,
			}),
		view.lang,
	);
	if (result === null) {
		return;
	}
	await applyNodeImage(view, node, result);
}

/**
 * 以统一高度、按图片原始比例设置节点图片（需求 1）：
 * 先探测图片原始尺寸，再以 custom:true 精确指定展示尺寸，
 * 使节点外框比例跟随图片比例（所有图片高度统一，宽度按比例）。
 *
 * 引用归一（与 Obsidian 图片引用语义对齐）：
 * - 库内路径（联想/手动输入/选择本地保存后）→ 显示用资源地址（app://），
 *   同时记录 mdImageTarget=库内路径（保存回写 ![[路径]]）；
 * - 已是 app://（拖入/粘贴）→ 反查库内路径记录 mdImageTarget；
 * - 外链（http/data/blob/file）→ 原样显示，无 md 回写目标。
 */
export async function applyNodeImage(
	view: MindMapViewContext,
	node: MindMapNode,
	url: string,
): Promise<void> {
	const { display, mdTarget } = normalizeImageReference(url, view.app);
	const options = await createAspectSetNodeImageOptions(display);
	view.mindMap?.execCommand('SET_NODE_IMAGE', node, options);
	// 记录/清除 md 回写目标（引擎不识别该字段，仅序列化用）
	const data = node.getData() as MdNodeData;
	const oldTarget = data.mdImageTarget ?? '';
	const text = typeof data.text === 'string' ? data.text : '';
	// 纯图节点的占位文本（旧图文件名）随换图同步，避免回写残留旧名
	const oldName = oldTarget.split('/').pop() ?? '';
	if (oldName && text === oldName) {
		data.text = mdTarget ? (mdTarget.split('/').pop() ?? '') : '';
		data.mdDerivedText = data.text;
	}
	if (mdTarget) {
		data.mdImageTarget = mdTarget;
	} else {
		delete data.mdImageTarget;
	}
	view.scheduleSave();
}

/** 引用归一：显示地址 + md 回写目标 */
function normalizeImageReference(
	url: string,
	app: App,
): { display: string; mdTarget: string | null } {
	if (!url) {
		return { display: '', mdTarget: null };
	}
	if (isAppResourceUrl(url)) {
		// 资源地址：反查库内路径（md 回写目标）
		const file = resolvePathToFile(url, app);
		return { display: url, mdTarget: file?.path ?? null };
	}
	if (isExternalImageRef(url)) {
		return { display: url, mdTarget: null };
	}
	// 其余按库内路径：解析为资源地址显示，记录库内路径
	const hit = app.vault.getAbstractFileByPath(url.trim());
	return {
		display: hit instanceof TFile ? app.vault.getResourcePath(hit) : url,
		mdTarget: url.trim(),
	};
}

/**
 * 删除选中节点（修复 3/4）：
 * 1. 先走引擎 REMOVE_NODE 常规路径（实例清理 + 历史记录 + 渲染）；
 * 2. 兜底：若节点数据因 uid 异常未被清除，按对象身份强制移除，杜绝残留。
 */
export function deleteActiveNode(view: MindMapViewContext): void {
	const mindMap = view.mindMap;
	const node = getActiveNode(mindMap);
	if (!mindMap || !node) {
		new Notice(t(view.lang, 'common.selectNodeFirst'));
		return;
	}
	if (node.isRoot) {
		new Notice(t(view.lang, 'common.rootCannotDelete'));
		return;
	}
	const parent = node.parent;
	const nodeData = node.nodeData;
	mindMap.execCommand('REMOVE_NODE');
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
	// 通过 appointNodes 指定父节点（引擎的 ACTIVE_NODE 命令不存在，
	// 且渲染为异步，不能依赖激活列表）。
	// 未选中节点时挂到根节点下：引擎在 appointNodes 与激活列表均为空时
	// 直接 return，空数组粘贴会静默失效。
	const parent = node ?? view.mindMap?.renderer?.root ?? null;
	view.mindMap?.execCommand(
		'INSERT_CHILD_NODE',
		false,
		parent ? [parent] : [],
		{ ...clipboardData, isActive: false },
	);
}
