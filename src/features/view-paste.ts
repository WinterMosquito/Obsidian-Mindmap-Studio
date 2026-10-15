/**
 * 画布粘贴处理：容器内 Ctrl+V 粘贴图片（选中节点 → 设节点图片；未选中 →
 * 根节点下新建纯图节点）、窗口级兜底监听。从 view.ts 拆出。
 *
 * 本模块不 import MindMapView 类（否则与 view.ts 形成运行时循环依赖）：
 * 类型走 MindMapViewContext；「激活视图是否为本视图」的判定由注册方
 * （view.ts，持有类引用）完成后才调用 handleWindowPaste。
 */
import { Notice } from 'obsidian';
import { getActiveNode, getRenderRoot } from '../engine/mindmap';
import { buildPastedImageName, saveImageToVault } from '../media/images-save';
import { notifyError } from '../core/errors';
import { applyNodeImage, createImageChildNode } from './view-node-actions';
import { pasteFromClipboardEvent } from './view-clipboard';
import { isTextEntryTarget } from './view-common';
import { t } from '../core/i18n';
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
 * 前置「激活视图为本视图」判定由注册方完成；这里仅做容器与输入类目标的豁免。
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
	// 输入类目标不劫持：与容器路径同一份判定（`isTextEntryTarget` 含
	// contenteditable——焦点在别处编辑区时粘贴图片/文本都属输入语义，
	// 此前只认 input/textarea，contenteditable 会被误劫持）
	if (isTextEntryTarget(target)) {
		return;
	}
	void handlePasteEvent(view, event);
}

async function handlePasteEvent(
	view: MindMapViewContext,
	event: ClipboardEvent,
): Promise<void> {
	// 输入类目标不劫持——**图片分支与文本分支同一道闸门**（文本分支在
	// pasteFromClipboardEvent 内同判）：搜索框 `input` 就挂在 `containerEl`
	// 下，容器路径漏判时在那里粘贴图片会被当成「导入图片并设节点图片」，
	// 与窗口兜底路径（handleWindowPaste 已判）口径不一致
	if (isTextEntryTarget(event.target)) {
		return;
	}
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
		// 非图片载荷 → **文本粘贴**（Markdown 大纲 → 子树）：与图片分支同一
		// 入口、同一落点规则。优先级「图片 > 文本」与既有行为一致（网页复制
		// 常同时携带两者，图片是更具体的意图）。
		pasteFromClipboardEvent(view, event);
		return;
	}
	event.preventDefault();
	const engine = view.mindMap;
	const node = getActiveNode(engine);
	// 落点分流：选中节点 → 贴入该节点（设为节点图片）；未选中 → 贴入导图
	// （根节点下新建纯图节点，与 view-dnd 的「文档/附件未选中 → 挂根节点下」
	// 降级同构）。仅当渲染根也不可用（引擎初始化中间态）时才提示——那是
	// 「没地方贴」，不是「没选节点」。
	const fallbackRoot = node ? null : getRenderRoot(engine);
	if (!node && !fallbackRoot) {
		new Notice(t(view.lang, 'common.notLoaded'));
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
		// 保存期间可能换文件/重建引擎：旧节点已不在新树上，写入会静默丢失
		if (saved && view.mindMap === engine) {
			if (node) {
				await applyNodeImage(view, node, view.app.vault.getResourcePath(saved));
			} else if (fallbackRoot) {
				// 未选中：根节点下新建纯图节点承载（与拖入同一条建图入口）
				await createImageChildNode(view, fallbackRoot, saved);
			}
			new Notice(`${t(view.lang, 'common.imageSavedTo')}${saved.path}`);
		}
	} catch (error) {
		console.error('粘贴图片失败', error);
		notifyError(view.lang, 'common.pasteImageFailed', error);
	}
}
