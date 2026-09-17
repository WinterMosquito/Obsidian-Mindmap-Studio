/**
 * 画布拖拽与文件输入：
 * - **库内**文件拖入：图片挂节点、文档建双链、其余一律挂回形针（判定与**解析侧同一
 *   口径** `wikilinkTargetIsAttachment`，不再用白名单——见 handleDroppedVaultFile）；
 * - **系统**文件拖入：任意文件入库后按同一套类型分流挂节点；按住 `Ctrl`
 *   （Win/Linux）/`Option`（mac）则**不导入**、改插入 `file:///` 绝对链接
 *   （对齐官方帮助「Drag and drop」）。
 * 从 view.ts 拆出。
 */
import { Notice, Platform, type TFile, type TFolder } from 'obsidian';
import {
	isEmbeddableAttachmentExtension,
	isImageExtension,
	isRenderableImageExtension,
	MAX_IMAGE_SIZE_MB,
} from '../core/constants';
import { saveAttachmentToVault, saveImageToVault } from '../media/images-save';
import { createAspectSetNodeImageOptions } from '../media/images-path';
import { notifyError } from '../core/errors';
import {
	extractDroppedFileNames,
	filesUnderFolder,
	resolveDroppedFile,
	resolveDroppedFolder,
} from '../links/links-resolve';
import { getActiveNode, getRenderRoot } from '../engine/mindmap';
import {
	applyDocWikiLink,
	applyMdLink,
	applyNodeAttachment,
	applyNodeImage,
	newDocLinkFor,
} from './view-node-actions';
import { insertChildNodeWithData } from './view-common';
import { t } from '../core/i18n';
import { fileUrlFromAbsolutePath } from '../domain/url';
import {
	formatWikilink,
	isDocumentExtension,
	wikilinkTargetIsAttachment,
} from '../domain/wikilink';
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
	// 文件夹优先：官方 Canvas 拖入文件夹 = 加入其中**所有文件**
	// （`Plugins/Canvas.md`「Add cards from folders」）
	const folder = resolveDroppedFolder(dataTransfer, view.app);
	if (folder) {
		await handleDroppedFolder(view, folder);
		return;
	}
	const file = resolveDroppedFile(dataTransfer, view.app);
	if (!file) {
		// 需求 3：无法解析为库内文件时，按系统文件处理（导入或绝对链接）
		await handleExternalFilesDrop(view, dataTransfer, event);
		return;
	}
	await handleDroppedVaultFile(view, file);
}

/**
 * 拖入**文件夹**：把其中（含子目录）全部文件逐个建为子节点。
 *
 * 落点与单文件拖入同款：有选中节点 → 挂其下；未选中 → 挂到根节点下。
 * 每个文件各占一个节点（不覆盖目标节点内容，避免多文件互相顶掉）。
 */
async function handleDroppedFolder(
	view: MindMapViewContext,
	folder: TFolder,
): Promise<void> {
	const files = filesUnderFolder(view.app.vault.getFiles(), folder.path);
	if (files.length === 0) {
		new Notice(t(view.lang, 'common.noFilesDropped'));
		return;
	}
	const engine = view.mindMap;
	const target = getActiveNode(engine) ?? getRenderRoot(engine);
	if (!target) {
		return;
	}
	for (const file of files) {
		// 保存/探测尺寸期间可能换文件/重建引擎：旧节点已不在新树上（与
		// handleExternalFilesDrop 同款「会话所属引擎」守卫，不能只判 null——
		// 重建后的新引擎实例 ≠ null，往旧节点插入会静默丢失）
		if (view.mindMap !== engine) {
			return;
		}
		await insertFileChildNode(view, target, file);
	}
	new Notice(
		`${t(view.lang, 'common.imported')} ${files.length} ${t(
			view.lang,
			'common.filesStored',
		)}`,
		5000,
	);
}

/** 单个库内文件 → 目标节点下的子节点（按类型走与单文件拖入同一套通道） */
async function insertFileChildNode(
	view: MindMapViewContext,
	target: MindMapNode,
	file: TFile,
): Promise<void> {
	if (isRenderableImageExtension(file.extension)) {
		await insertImageChildNode(view, target, file);
		return;
	}
	const embed = isEmbeddableAttachmentExtension(file.extension);
	if (wikilinkTargetIsAttachment(file.name)) {
		insertChildNodeWithData(view, target, {
			text: file.name,
			attachmentUrl: view.app.vault.getResourcePath(file),
			attachmentName: file.name,
			mdAttachmentLinkpath: file.path,
			mdLinkStyle: 'wiki',
			...(embed ? { mdEmbed: true } : {}),
		});
		return;
	}
	// 文档：`.md` 可省略扩展名（与 handleDroppedDocument 同口径）
	const text =
		file.extension.toLowerCase() === 'md' ? file.basename : file.name;
	insertChildNodeWithData(view, target, {
		text,
		mdWikiLinkpath: newDocLinkFor(view, file, formatWikilink(text)),
		mdLinkStyle: 'wiki',
		mdLinkText: text,
	});
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

	if (isDocumentExtension(extension)) {
		await handleDroppedDocument(view, file, selected);
		return;
	}

	// 文档 / 附件分流与**解析侧同一判据**（`wikilinkTargetIsAttachment`：非文档类
	// 扩展名即附件；无扩展名视为文档，同 Obsidian 默认）。故手写的 `[[说明.txt]]`
	// 能显示、拖入 `.txt` / `.zip` / 任意库内文件也同样能挂上——此前用的是「可链接
	// 附件」白名单，比解析侧窄，同一文件「拖入被拒、手写却行」（2026-09-15 对齐）。
	// 不可在 Obsidian 中渲染的类型点击时交系统默认应用（见 view-link-navigator）。
	if (!wikilinkTargetIsAttachment(file.name)) {
		await handleDroppedDocument(view, file, selected);
		return;
	}
	handleDroppedAttachment(view, file, selected);
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
	// 可嵌入的附件（PDF/音视频）默认写嵌入语法 `![[…]]`，与 Obsidian 拖放一致
	// （见 view-node-actions.applyNodeAttachment 与 core/constants）
	const embed = isEmbeddableAttachmentExtension(file.extension);
	if (
		insertChildNodeWithData(view, root, {
			text: file.name,
			attachmentUrl: view.app.vault.getResourcePath(file),
			attachmentName: file.name,
			mdAttachmentLinkpath: file.path,
			mdLinkStyle: 'wiki',
			...(embed ? { mdEmbed: true } : {}),
		})
	) {
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
	// 官方链接语法：`.md` 可省略扩展名（`[[笔记]]` ≡ `[[笔记.md]]`），canvas/base
	// 等非 Markdown 文件**必须带扩展名**（`[[画布.canvas]]`），否则 Obsidian 会
	// 当作不存在的笔记 —— 故文档链接目标一律按扩展名取，勿统一用 basename。
	const target = file.extension.toLowerCase() === 'md' ? file.basename : file.name;
	// 路径形态跟随官方「New link format」：默认 shortest ＝ 上面的 basename 口径；
	// 用户选了相对/绝对路径（或存在同名文件）时按官方换算（见 newDocLinkFor）
	const link = newDocLinkFor(view, file, formatWikilink(target));
	if (selected) {
		// 与解析侧同通道（mdWikiLinkpath）→ 显示自绘文档页图标
		applyDocWikiLink(view, selected, link, target);
		new Notice(`${t(view.lang, 'common.linkedTo')} [[${target}]]`);
	} else {
		// 原逻辑：挂到根节点下并链接（通过 appointNodes 指定父节点，
		// 不依赖激活列表；初始数据直接携带文本与链接）
		const root = getRenderRoot(view.mindMap);
		if (
			insertChildNodeWithData(view, root, {
				text: target,
				// 文档双链走 mdWikiLinkpath 通道（自绘文档图标，不写 hyperlink）
				mdWikiLinkpath: link,
				mdLinkStyle: 'wiki',
				mdLinkText: target,
			})
		) {
			new Notice(`${t(view.lang, 'common.nodeCreatedAndLinked')} [[${target}]]`);
		}
	}
}

/**
 * 外部（系统）文件拖入处理。
 *
 * 三条分支（对齐官方帮助「User interface / Drag and drop」与「Editing and
 * formatting / Attachments」）：
 * 1. 按住 `Ctrl`（Win/Linux）/`Option`（mac）拖入 → **不导入**，插入指向原文件的
 *    绝对链接（官方原文即 `file:///` absolute links）；
 * 2. 图片 → 入库（落点遵循「新附件默认位置」）后按既有规则挂图：首张挂所选节点、
 *    其余各占一个子节点；
 * 3. 其余文件（**任意类型**，含 PDF/音视频/笔记/压缩包/无扩展名）→ 入库后按
 *    `attachImportedFiles` 分流挂到所选节点：文档走双链通道、附件走回形针通道
 *    （可嵌入者写 `![[…]]`）。
 *
 * 三种分支都要求先选中归属主题（图片分支的历史约定，统一沿用）。
 */
async function handleExternalFilesDrop(
	view: MindMapViewContext,
	dataTransfer: DataTransfer,
	event: DragEvent,
): Promise<void> {
	const files = Array.from(dataTransfer.files);
	if (files.length === 0) {
		logUnrecognizedDrop(dataTransfer);
		new Notice(t(view.lang, 'common.noFilesDropped'), 8000);
		return;
	}

	// 需要先选中一个主题作为归属
	const engine = view.mindMap;
	const selected = getActiveNode(engine);
	if (!selected) {
		new Notice(t(view.lang, 'common.selectNodeBeforeDrop'));
		return;
	}

	// ① 修饰键：不导入，直接写绝对链接（指向文件原位置）
	if (shouldInsertAbsoluteLink(event)) {
		insertAbsoluteLinks(view, selected, files);
		return;
	}

	// ② / ③ 入库：**任意文件都导入**（与 Obsidian 的拖放一致——它会把文件复制进
	// 「附件默认位置」再插入链接；解析侧对「非文档扩展名」一视同仁按附件处理，
	// 故不存在「引不了」的类型，白名单已于 2026-09-15 取消）。
	const incoming: readonly File[] = files;
	new Notice(
		`${t(view.lang, 'common.importing')} ${incoming.length} ${t(
			view.lang,
			'common.filesToVault',
		)}`,
	);
	// 修复文件名乱码：优先用 text/uri-list 解码出的真实文件名
	// （File.name 在部分 Windows 来源下被系统 ANSI 代码页错误解码）。
	// 仅当数量一致时按序对应，避免文件名错位。
	const realNames = extractDroppedFileNames(dataTransfer);
	const useRealNames = realNames.length === incoming.length;
	const sourcePath = view.file?.path ?? '';
	// 顺序保存：文件名保持原名，重名由入库通道的序号兜底处理；
	// 顺序写入避免同名文件并发保存时互相覆盖。逐个容错：单个失败不影响其余。
	const saved: TFile[] = [];
	let failedCount = 0;
	let firstError: unknown = null;
	for (let index = 0; index < incoming.length; index++) {
		const file = incoming[index];
		if (!file) {
			continue;
		}
		const preferredName = useRealNames ? realNames[index] : undefined;
		// 图片判定用**可渲染清单**（含 tif/tiff/jxl…），与解析侧 `isImageEmbedTarget`
		// 同口径；`file.type` 兜底覆盖无名扩展名的来源。
		const isImage =
			file.type.startsWith('image/') ||
			isRenderableImageExtension(extensionOf(file));
		try {
			// 图片与附件共用入库通道（同一串行队列 + 同一落点规则）
			const result = isImage
				? await saveImageToVault({
						app: view.app,
						sourcePath,
						file,
						maxSizeMB: MAX_IMAGE_SIZE_MB,
						preferredName,
						lang: view.lang,
					})
				: await saveAttachmentToVault({
						app: view.app,
						sourcePath,
						file,
						preferredName,
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
		console.error('导入拖入的文件失败', firstError);
		notifyError(view.lang, 'common.importFileFailed', firstError);
	}
	// 归属：图片首张挂到所选节点（保持单图拖入的原行为），其余各新建子节点承载。
	// 此前循环对同一节点反复 applyNodeImage（SET_NODE_IMAGE 覆盖图片字段），
	// 多图拖入只有最后一张存活——静默丢图。
	// 保存期间可能换文件/重建引擎：旧节点已不在新树上，直接放弃写入。
	if (view.mindMap !== engine) {
		return;
	}
	await attachImportedFiles(view, selected, saved);
	// 提示：单图沿用「已设为节点图片」+「已导入 1」两条（历史文案），
	// 其余形态统一走「已导入 N 个文件到仓库中…」
	const firstImage = saved.find((file) => isImageExtension(file.extension));
	if (saved.length === 1 && firstImage) {
		new Notice(`${t(view.lang, 'common.imageSetOnNode')}${firstImage.name}`);
		new Notice(
			`${t(view.lang, 'common.imported')} 1 ${t(view.lang, 'common.filesStored')}`,
			5000,
		);
		return;
	}
	if (saved.length > 0) {
		const lines = [
			`${t(view.lang, 'common.imported')} ${saved.length} ${t(
				view.lang,
				'common.filesStored',
			)}`,
		];
		if (saved.length > 1) {
			lines.push(t(view.lang, 'common.filesPlaced'));
		}
		new Notice(lines.join('\n'), 5000);
	}
}

/**
 * 已入库文件 → 节点（按类型分流，与库内拖入**同一套判据**）。
 *
 * 图片：首张挂所选节点、其余各占一个子节点（图片独占节点语义）；
 * 文档（md/canvas/base，或无扩展名）：文档双链通道（`.md` 省扩展名、其余带扩展名）；
 * 其余附件：回形针通道（可嵌入者写 `![[…]]`）。
 */
async function attachImportedFiles(
	view: MindMapViewContext,
	selected: MindMapNode,
	saved: readonly TFile[],
): Promise<void> {
	const isImageFile = (file: TFile): boolean =>
		isRenderableImageExtension(file.extension);
	const images = saved.filter(isImageFile);
	const documents = saved.filter(
		(file) => !isImageFile(file) && !wikilinkTargetIsAttachment(file.name),
	);
	const attachments = saved.filter(
		(file) => !isImageFile(file) && wikilinkTargetIsAttachment(file.name),
	);
	const [firstImage, ...restImages] = images;
	if (firstImage) {
		await applyNodeImage(
			view,
			selected,
			view.app.vault.getResourcePath(firstImage),
		);
	}
	for (const extra of restImages) {
		await insertImageChildNode(view, selected, extra);
	}
	for (const document of documents) {
		// 官方链接语法：`.md` 可省略扩展名（与 handleDroppedDocument 同口径）
		const target =
			document.extension.toLowerCase() === 'md'
				? document.basename
				: document.name;
		applyDocWikiLink(
			view,
			selected,
			newDocLinkFor(view, document, formatWikilink(target)),
			target,
		);
	}
	for (const attachment of attachments) {
		applyNodeAttachment(view, selected, attachment);
	}
}

/**
 * 拖入时的「不导入、改用绝对链接」修饰键：`Ctrl`（Win/Linux）/`Option`（mac）——
 * 官方帮助「Drag and drop」原文（Hold Ctrl on Windows/Linux or Option on macOS
 * to create `file:///` absolute links to those files instead of importing a copy）。
 */
function shouldInsertAbsoluteLink(event: DragEvent): boolean {
	return Platform.isMacOS ? event.altKey : event.ctrlKey;
}

/**
 * 插入指向**库外原文件**的绝对链接（不导入）。
 *
 * 节点数据形态与「添加链接」的 URL 分支一致（hyperlink + mdLinkStyle 'md' +
 * mdLinkText = 显示名），只是显示名取文件名——回写为 `[名](<file:///…>)`，与
 * Obsidian 拖入系统文件按住 Ctrl/Option 时写出的形态相同（见 md-serialize
 * renderHyperlink 的 scheme 分支）；点击由 openHyperlink 的 file:// 分支交给
 * 系统默认应用打开。
 */
function insertAbsoluteLinks(
	view: MindMapViewContext,
	node: MindMapNode,
	files: readonly File[],
): void {
	let inserted = 0;
	for (const file of files) {
		const path = droppedAbsolutePath(file);
		if (!path) {
			continue;
		}
		applyMdLink(view, node, fileUrlFromAbsolutePath(path), file.name);
		inserted++;
	}
	if (inserted > 0) {
		new Notice(t(view.lang, 'common.absoluteLinkInserted'));
	}
}

/** 系统拖入文件的本地绝对路径（Electron 在 File 上挂的非标准 `path`；无则 null） */
function droppedAbsolutePath(file: File): string | null {
	const path = (file as File & { path?: unknown }).path;
	return typeof path === 'string' && path ? path : null;
}

/** 拖入未识别出文件时的**控制台**诊断（面向用户的提示不含拖拽载荷原文） */
function logUnrecognizedDrop(dataTransfer: DataTransfer): void {
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
		console.debug('拖入未识别到文件，拖拽数据:', details.join(' | '));
	}
}

/** 文件名末段扩展名（小写；无扩展名返回空串） */
function extensionOf(file: File): string {
	const dot = file.name.lastIndexOf('.');
	return dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
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
	insertChildNodeWithData(view, parent, {
		text: '',
		image: options.url,
		imageTitle: options.title,
		imageSize: {
			width: options.width,
			height: options.height,
			custom: options.custom,
		},
		mdImageTarget: file.path,
	});
}