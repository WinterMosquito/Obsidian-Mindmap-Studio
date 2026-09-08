/**
 * 节点图片操作（从 view-node-actions.ts 拆分）：
 * 增删节点图片 + 引用归一 + 拖拽/粘贴路径共享入口。
 * 被 view-toolbar.ts / view-context-menu.ts / view-dnd.ts / view-paste.ts 共用。
 */
import { App } from 'obsidian';
import { ENGINE_COMMANDS, getNodeDataString } from '../mindmap';
import {
	createAspectSetNodeImageOptions,
	createSetNodeImageOptions,
} from '../images-path';
import { resolvePathToFile } from '../links-resolve';
import { openImageEditorModal } from '../modal-image';
import { saveImageToVault } from '../images-save';
import { notifyError } from '../errors';
import {
	isAppResourceUrl,
	isExternalImageRef,
} from '../domain/url';
import type { MdNodeData } from '../node-data';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';
import { requireActiveNode } from './view-common';

/** 单独移除节点图片（不影响节点与其他数据） */
export function removeNodeImage(view: MindMapViewContext, node: MindMapNode): void {
	view.mindMap?.execCommand(
		ENGINE_COMMANDS.SET_NODE_IMAGE,
		node,
		createSetNodeImageOptions(null),
	);
}

/**
 * 插入图片：统一固定尺寸；支持本地文件/剪贴板/URL。
 *
 * 自兜错误：由工具栏/右键菜单以 `void addImageToActiveNode(view)` 调用，
 * 失败在此转成用户可见提示（与 view-paste / view-export 同一约定）。
 */
export async function addImageToActiveNode(
	view: MindMapViewContext,
): Promise<void> {
	try {
		await performAddImage(view);
	} catch (error) {
		console.error('插入图片失败', error);
		notifyError(view.lang, 'common.insertImageFailed', error);
	}
}

/** 插入图片主体（异常由 addImageToActiveNode 统一兜住） */
async function performAddImage(view: MindMapViewContext): Promise<void> {
	const node = requireActiveNode(view);
	if (!node) return;
	const current = getNodeDataString(node, 'image');
	const result = await openImageEditorModal(
		view.app,
		current,
		(file, maxSizeMB, nameOverride) =>
			saveImageToVault({
				app: view.app,
				sourcePath: view.file?.path ?? '',
				file,
				maxSizeMB,
				filename: nameOverride,
				lang: view.lang,
			}),
		view.lang,
	);
	if (result === null) return;
	await applyNodeImage(view, node, result);
}

/**
 * 以统一高度、按图片原始比例设置节点图片：
 * 先探测图片原始尺寸，再以 custom:true 精确指定展示尺寸。
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
	view.mindMap?.execCommand(ENGINE_COMMANDS.SET_NODE_IMAGE, node, options);
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
export function normalizeImageReference(
	url: string,
	app: App,
): { display: string; mdTarget: string | null } {
	if (!url) return { display: '', mdTarget: null };
	if (isAppResourceUrl(url)) {
		const file = resolvePathToFile(url, app);
		return { display: url, mdTarget: file?.path ?? null };
	}
	if (isExternalImageRef(url)) return { display: url, mdTarget: null };
	const file = resolvePathToFile(url, app);
	return {
		display: file ? app.vault.getResourcePath(file) : url,
		mdTarget: file ? file.path : url.trim(),
	};
}
