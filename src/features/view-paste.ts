/**
 * 画布粘贴处理：容器内 Ctrl+V 粘贴图片（写入附件目录并设置节点图片）、
 * 窗口级兜底监听。从 view.ts 拆出。
 *
 * 本模块不 import MindMapView 类（否则与 view.ts 形成运行时循环依赖）：
 * 类型走 MindMapViewContext；「激活视图是否为本视图」的判定由注册方
 * （view.ts，持有类引用）完成后才调用 handleWindowPaste。
 */
import { Notice } from 'obsidian';
import { getActiveNode } from '../mindmap';
import { buildPastedImageName, saveImageToVault } from '../images-save';
import { notifyError } from '../errors';
import { applyNodeImage } from './view-node-actions';
import { t } from '../i18n';
import type { MindMapViewContext } from './view-context';

/** 注册画布容器粘贴监听（引擎重建时随 initMindMap 调用） */
export function setupPasteHandler(view: MindMapViewContext): void {
	if (!view.containerEl) {
		return;
	}
	// 需求 3：画布任意位置 Ctrl+V 粘贴图片（容器内监听）。
	// 窗口级兜底在 onOpen 注册一次，避免每次刷新引擎累积监听。
	view.engineEvents.onDom(view.containerEl, 'paste', (event) => {
		void handlePasteEvent(view, event);
	});
}

/**
 * 窗口级粘贴兜底（焦点在画布容器外时仍可粘贴）：
 * 前置「激活视图为本视图」判定由注册方完成；这里仅做容器与输入框豁免。
 */
export function handleWindowPaste(
	view: MindMapViewContext,
	event: ClipboardEvent,
): void {
	if (event.defaultPrevented) {
		return;
	}
	const target = event.target as Node | null;
	if (target && view.containerEl?.contains(target)) {
		return; // 容器监听已处理
	}
	if (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement
	) {
		return; // 输入框内不劫持
	}
	void handlePasteEvent(view, event);
}

async function handlePasteEvent(
	view: MindMapViewContext,
	event: ClipboardEvent,
): Promise<void> {
	const items = event.clipboardData?.items;
	if (!items) {
		return;
	}
	let imageFile: File | null = null;
	for (const item of Array.from(items)) {
		if (item.type.startsWith('image/')) {
			imageFile = item.getAsFile();
			break;
		}
	}
	if (!imageFile) {
		return;
	}
	event.preventDefault();
	const node = getActiveNode(view.mindMap);
	if (!node) {
		new Notice(t(view.lang, 'common.selectNodeBeforePasteImage'));
		return;
	}
	new Notice(t(view.lang, 'common.savingClipboardImage'));
	try {
		const saved = await saveImageToVault({
			app: view.app,
			sourcePath: view.file?.path ?? '',
			file: imageFile,
			// 剪贴板粘贴按 Obsidian 核心约定命名（Pasted image YYYYMMDDHHMMSS），
			// 覆盖系统提供的临时名（image.png 等），与官方粘贴行为对齐
			filename: buildPastedImageName(),
			lang: view.lang,
		});
		if (saved) {
			await applyNodeImage(view, node, view.app.vault.getResourcePath(saved));
			new Notice(`${t(view.lang, 'common.imageSavedTo')}${saved.path}`);
		}
	} catch (error) {
		console.error('粘贴图片失败', error);
		notifyError(view.lang, 'common.pasteImageFailed', error);
	}
}
