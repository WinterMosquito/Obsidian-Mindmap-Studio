/**
 * 画布拖拽与文件输入：库内文件拖入（图片/笔记）、外部图片导入。从 view.ts 拆出。
 */
import { Notice, type TFile } from 'obsidian';
import {
	isImageExtension,
	isLinkAttachmentExtension,
	MAX_IMAGE_SIZE_MB,
} from '../constants';
import { saveImageToVault } from '../images-save';
import { createAspectSetNodeImageOptions } from '../images-path';
import { notifyError } from '../errors';
import { extractDroppedFileNames, resolveDroppedFile } from '../links-resolve';
import { ENGINE_COMMANDS, getActiveNode, getRenderRoot } from '../mindmap';
import { applyDocWikiLink, applyNodeAttachment, applyNodeImage } from './view-node-actions';
import { t } from '../i18n';
import { formatWikilink } from '../domain/wikilink';
import type { MindMapNode } from '../../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from './view-context';

/** 注册画布拖拽监听（引擎重建时随 initMindMap 调用） */
export function setupDragAndDrop(view: MindMapViewContext): void {
	if (!view.canvasEl) {
		return;
	}
	const canvas = view.canvasEl;
	view.engineEvents.onDom(canvas, 'dragover', (event) => {
		if (!event.dataTransfer) {
			return;
		}
		const hasFileData =
			event.dataTransfer.types.includes('text/plain') ||
			event.dataTransfer.files.length > 0 ||
			Array.from(event.dataTransfer.types).some((type) =>
				type.toLowerCase().includes('file'),
			);
		if (hasFileData) {
			event.preventDefault();
			event.stopPropagation();
			canvas.addClass('mindmap-drag-over');
			event.dataTransfer.dropEffect = 'link';
		}
	});
	view.engineEvents.onDom(canvas, 'dragleave', (event) => {
		if (!canvas.contains(event.relatedTarget as Node | null)) {
			canvas.removeClass('mindmap-drag-over');
		}
	});
	view.engineEvents.onDom(canvas, 'drop', (event) => {
		if (!event.dataTransfer) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		canvas.removeClass('mindmap-drag-over');
		void handleFileDrop(view, event).catch((error) => {
			// 用户可见失败（附件写入/图片导入等）：按仓库约定走 notifyError
			console.error('处理拖入文件失败', error);
			notifyError(view.lang, 'common.dropFailed', error);
		});
	});
}

/** 拖入文件分发：库内文件 vs 外部附件 */
async function handleFileDrop(view: MindMapViewContext, event: DragEvent): Promise<void> {
	const dataTransfer = event.dataTransfer;
	if (!dataTransfer) {
		return;
	}
	const file = resolveDroppedFile(dataTransfer, view.app);
	if (!file) {
		// 需求 3：无法解析为库内文件时，识别外部附件并导入库中
		await handleExternalFilesDrop(view, dataTransfer);
		return;
	}
	await handleDroppedVaultFile(view, file);
}

/**
 * 处理拖入的库内文件：
 * - 已选中主题 → 直接归入该主题；
 * - 未选中 → 按原逻辑处理（提示选择或挂到根节点下）。
 */
async function handleDroppedVaultFile(view: MindMapViewContext, file: TFile): Promise<void> {
	const selected = getActiveNode(view.mindMap);
	const url = view.app.vault.getResourcePath(file);
	const extension = file.extension.toLowerCase();

	if (isImageExtension(extension)) {
		if (selected) {
			await applyNodeImage(view, selected, url);
			new Notice(`${t(view.lang, 'common.imageSetOnNode')}${file.name}`);
		} else {
			new Notice(t(view.lang, 'common.selectNodeBeforeDrop'));
		}
		return;
	}

	if (extension === 'md') {
		await handleDroppedDocument(view, file, selected);
		return;
	}

	if (isLinkAttachmentExtension(extension)) {
		handleDroppedAttachment(view, file, selected);
		return;
	}

	// 其余类型（无法写回 Markdown）拒绝
	new Notice(t(view.lang, 'common.onlySupportedFiles'));
}

/**
 * 拖入附件（PDF/音视频/压缩包等）：已选中主题 → 挂为节点附件；
 * 未选中 → 挂到根节点下并携带附件数据（与文档拖入同款两分支）。
 */
function handleDroppedAttachment(
	view: MindMapViewContext,
	file: TFile,
	selected: MindMapNode | null,
): void {
	if (selected) {
		applyNodeAttachment(view, selected, file);
		new Notice(`${t(view.lang, 'common.linkedTo')} [[${file.name}]]`);
		return;
	}
	const root = getRenderRoot(view.mindMap);
	if (root) {
		view.mindMap?.execCommand(ENGINE_COMMANDS.INSERT_CHILD_NODE, false, [root], {
			text: file.name,
			attachmentUrl: view.app.vault.getResourcePath(file),
			attachmentName: file.name,
			mdAttachmentLinkpath: file.path,
			mdLinkStyle: 'wiki',
			isActive: false,
		});
		new Notice(
			`${t(view.lang, 'common.nodeCreatedAndLinked')} [[${file.name}]]`,
		);
	}
}

/** 拖入文档：已选中主题 → 链接；未选中 → 挂到根节点下并链接 */
async function handleDroppedDocument(
	view: MindMapViewContext,
	file: TFile,
	selected: MindMapNode | null,
): Promise<void> {
	const link = formatWikilink(file.basename);
	if (selected) {
		// 与解析侧同通道（mdWikiLinkpath）→ 显示自绘文档页图标
		applyDocWikiLink(view, selected, link, file.basename, null);
		new Notice(`${t(view.lang, 'common.linkedTo')} [[${file.basename}]]`);
	} else {
		// 原逻辑：挂到根节点下并链接（通过 appointNodes 指定父节点，
		// 不依赖激活列表；初始数据直接携带文本与链接）
		const root = getRenderRoot(view.mindMap);
		if (root) {
			view.mindMap?.execCommand(ENGINE_COMMANDS.INSERT_CHILD_NODE, false, [root], {
				text: file.basename,
				// 文档双链走 mdWikiLinkpath 通道（自绘文档图标，不写 hyperlink）
				mdWikiLinkpath: link,
				mdLinkStyle: 'wiki',
				mdLinkText: file.basename,
				isActive: false,
			});
			new Notice(`${t(view.lang, 'common.nodeCreatedAndLinked')} [[${file.basename}]]`);
		}
	}
}

/**
 * 外部（系统）文件拖入处理：仅支持图片（渲染层定位——非图片附件无法
 * 写回 Markdown），识别后导入库中，存储路径遵循系统「附件存放位置」规则，
 * 再归入选中的主题（未选中时提示先选择）。
 */
async function handleExternalFilesDrop(
	view: MindMapViewContext,
	dataTransfer: DataTransfer,
): Promise<void> {
	const files = Array.from(dataTransfer.files);
	const droppedNonImage = files.some((f) => !f.type.startsWith('image/'));
	const images = files.filter((f) => f.type.startsWith('image/'));
	if (droppedNonImage) {
		new Notice(t(view.lang, 'common.onlyImagesSupported'));
	}
	if (images.length === 0) {
		// 诊断信息只进控制台：面向用户的提示不应包含原始 MIME 类型与拖拽载荷
		const details: string[] = [];
		Array.from(dataTransfer.types).forEach((type) => {
			try {
				const value = dataTransfer.getData(type);
				if (value) {
					details.push(`${type}: ${value.slice(0, 100)}`);
				}
			} catch {
				// 忽略
			}
		});
		if (details.length > 0) {
			console.debug('拖入未识别到图片，拖拽数据:', details.join(' | '));
		}
		new Notice(t(view.lang, 'common.noImagesDropped'), 8000);
		return;
	}

	// 需要先选中一个主题作为归属
	const engine = view.mindMap;
	const selected = getActiveNode(engine);
	if (!selected) {
		new Notice(t(view.lang, 'common.selectNodeBeforeDrop'));
		return;
	}

	new Notice(`${t(view.lang, 'common.importing')} ${images.length} ${t(view.lang, 'common.imagesToVault')}`);
	// 修复文件名乱码：优先用 text/uri-list 解码出的真实文件名
	// （File.name 在部分 Windows 来源下被系统 ANSI 代码页错误解码）。
	// 仅当数量一致时按序对应，避免文件名错位。
	const realNames = extractDroppedFileNames(dataTransfer);
	const useRealNames = realNames.length === images.length;
	const sourcePath = view.file?.path ?? '';
	// 顺序保存：文件名保持原名，重名由 saveImageToVault 的序号兜底处理；
	// 顺序写入避免同名文件并发保存时互相覆盖。逐张容错：单张失败不影响其余。
	const saved: TFile[] = [];
	let failedCount = 0;
	let firstError: unknown = null;
	for (let index = 0; index < images.length; index++) {
		const file = images[index];
		if (!file) {
			continue;
		}
		try {
			const result = await saveImageToVault({
				app: view.app,
				sourcePath,
				file,
				maxSizeMB: MAX_IMAGE_SIZE_MB,
				preferredName: useRealNames ? realNames[index] : undefined,
				lang: view.lang,
			});
			if (result) {
				saved.push(result);
			} else {
				failedCount++;
			}
		} catch (error) {
			failedCount++;
			firstError ??= error;
		}
	}
	if (failedCount > 0) {
		console.error('导入拖入的图片失败', firstError);
		notifyError(view.lang, 'common.importImageFailed', firstError);
	}
	// 归属：首张挂到所选节点（保持单图拖入的原行为），其余各新建一个子节点承载。
	// 此前循环对同一节点反复 applyNodeImage（SET_NODE_IMAGE 覆盖图片字段），
	// 多图拖入只有最后一张存活——静默丢图。
	// 保存期间可能换文件/重建引擎：旧节点已不在新树上，直接放弃写入。
	if (view.mindMap !== engine) {
		return;
	}
	const [first, ...rest] = saved;
	if (first) {
		await applyNodeImage(view, selected, view.app.vault.getResourcePath(first));
	}
	for (const extra of rest) {
		await insertImageChildNode(view, selected, extra);
	}
	if (saved.length === 1) {
		new Notice(`${t(view.lang, 'common.imageSetOnNode')}${first?.name ?? ''}`);
		new Notice(
			`${t(view.lang, 'common.imported')} 1 ${t(view.lang, 'common.imagesStored')}`,
			5000,
		);
	} else if (saved.length > 1) {
		new Notice(
			`${t(view.lang, 'common.imported')} ${saved.length} ${t(
				view.lang,
				'common.imagesStored',
			)}\n${t(view.lang, 'common.imagesPlaced')}`,
			5000,
		);
	}
}

/**
 * 在指定父节点下新建承载一张图片的子节点（图片独占节点语义：无文本）。
 *
 * 直接以 INSERT_CHILD_NODE 的初始数据携带引擎渲染所需的字段（与
 * SET_NODE_IMAGE 写入的形态一致：image/imageTitle/imageSize），避免
 * 「插入后再回找新节点」——引擎未提供按插入结果取回节点的公开途径。
 */
async function insertImageChildNode(
	view: MindMapViewContext,
	parent: MindMapNode,
	file: TFile,
): Promise<void> {
	const url = view.app.vault.getResourcePath(file);
	const engine = view.mindMap;
	if (!engine) {
		return;
	}
	const options = await createAspectSetNodeImageOptions(url);
	// 探测尺寸期间可能换文件/重建引擎：父节点已不在新树上
	if (view.mindMap !== engine) {
		return;
	}
	engine.execCommand(ENGINE_COMMANDS.INSERT_CHILD_NODE, false, [parent], {
		text: '',
		image: options.url,
		imageTitle: options.title,
		imageSize: {
			width: options.width,
			height: options.height,
			custom: options.custom,
		},
		mdImageTarget: file.path,
		isActive: false,
	});
}
