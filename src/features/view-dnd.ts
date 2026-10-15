/**
 * 画布拖拽与文件输入：
 * - **库内**文件拖入：图片挂节点（未选中节点则在渲染根下新建图片节点）、文档建双链、
 *   其余一律挂回形针（判定与**解析侧同一口径** `wikilinkTargetIsAttachment`，
 *   不再用白名单——见 handleDroppedVaultFile）；
 * - **系统**文件拖入：任意文件入库后按同一套类型分流挂节点；按住 `Ctrl`
 *   （Win/Linux）/`Option`（mac）则**不导入**、改插入 `file:///` 绝对链接
 *   （对齐官方帮助「Drag and drop」）；**未选中节点且载荷全是图片**时在渲染根下
 *   逐张新建纯图节点（「贴入导图」，与粘贴图片同一条入口，见 handleExternalFilesDrop）。
 * 从 view.ts 拆出。
 */
import { Notice, Platform, type TFile, type TFolder } from 'obsidian';
import {
	isImageExtension,
	isRenderableImageExtension,
	MAX_IMAGE_SIZE_MB,
} from '../core/constants';
import { saveAttachmentToVault, saveImageToVault } from '../media/images-save';
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
	createImageChildNode,
	planAttachmentLink,
	planDocLink,
} from './view-node-actions';
import { insertChildNodeWithData } from './view-common';
import { t } from '../core/i18n';
import { fileUrlFromAbsolutePath } from '../domain/url';
import {
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
		await createImageChildNode(view, target, file);
		return;
	}
	if (wikilinkTargetIsAttachment(file.name)) {
		// 附件载荷与「单文件拖入」共用同一个 plan（字段集收口在 view-node-actions）
		insertChildNodeWithData(view, target, planAttachmentLink(view, file).data);
		return;
	}
	// 文档载荷同样走 planDocLink（单一判定，形态跟随官方「使用 \[\[Wikilinks\]\]」）
	insertChildNodeWithData(view, target, planDocLink(view, file).data);
}

/**
 * 处理拖入的库内文件：
 * - 已选中主题 → 图片设为其节点图片、文档建双链、其余挂回形针；
 * - 未选中 → 图片在渲染根下新建纯图节点（「贴入导图」，与粘贴/系统拖入共用
 *   `createImageChildNode` 入口，2026-10-13）；文档/附件挂到根节点下。
 */
async function handleDroppedVaultFile(view: MindMapViewContext, file: TFile): Promise<void> {
	const selected = getActiveNode(view.mindMap);
	const url = view.app.vault.getResourcePath(file);
	const extension = file.extension.toLowerCase();

	if (isImageExtension(extension)) {
		if (selected) {
			await applyNodeImage(view, selected, url);
			new Notice(`${t(view.lang, 'common.imageSetOnNode')}${file.name}`);
			return;
		}
		// 未选中：贴入导图——图片可独占一个节点，故不需要先选归属主题
		const root = getRenderRoot(view.mindMap);
		if (!root) {
			// 引擎初始化中间态：没有可挂载的根（与粘贴/系统拖入同口径）
			new Notice(t(view.lang, 'common.notLoaded'));
			return;
		}
		// 探测期间引擎换代 → 返回 false（旧父节点已不在新树上），静默放弃写入
		if (await createImageChildNode(view, root, file)) {
			new Notice(`${t(view.lang, 'common.imageNodeCreated')}${file.name}`);
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
	// 载荷与提示同走一个 plan（字段集与 `!` 判定收口在 view-node-actions）
	const plan = planAttachmentLink(view, file);
	if (selected) {
		applyNodeAttachment(view, selected, file);
		new Notice(`${t(view.lang, 'common.linkedTo')} ${plan.notice}`);
		return;
	}
	if (insertChildNodeWithData(view, getRenderRoot(view.mindMap), plan.data)) {
		new Notice(
			`${t(view.lang, 'common.nodeCreatedAndLinked')} ${plan.notice}`,
		);
	}
}

/** 拖入文档：已选中主题 → 链接；未选中 → 挂到根节点下并链接 */
async function handleDroppedDocument(
	view: MindMapViewContext,
	file: TFile,
	selected: MindMapNode | null,
): Promise<void> {
	// 一次判定：链接串（含官方 New link format 路径形态）、载荷与提示写法同源
	//（扩展名口径、Wikilinks 分支见 view-node-actions.planDocLink）
	const plan = planDocLink(view, file);
	if (selected) {
		// 与解析侧同通道（mdWikiLinkpath）→ 显示自绘文档页图标
		applyDocWikiLink(view, selected, plan.link, plan.target);
		new Notice(`${t(view.lang, 'common.linkedTo')} ${plan.notice}`);
		return;
	}
	// 挂到根节点下并链接（通过 appointNodes 指定父节点，不依赖激活列表）
	if (insertChildNodeWithData(view, getRenderRoot(view.mindMap), plan.data)) {
		new Notice(
			`${t(view.lang, 'common.nodeCreatedAndLinked')} ${plan.notice}`,
		);
	}
}

/**
 * 外部（系统）文件拖入处理。
 *
 * 分支（对齐官方帮助「User interface / Drag and drop」与「Editing and
 * formatting / Attachments」）：
 * 1. 按住 `Ctrl`（Win/Linux）/`Option`（mac）拖入 → **不导入**，插入指向原文件的
 *    绝对链接（官方原文即 `file:///` absolute links）——改写的是**选中节点**，
 *    故仍要求先选中；
 * 2. 有选中主题：图片入库（落点遵循「新附件默认位置」）后首张挂该节点、其余各占
 *    一个子节点；
 * 3. 有选中主题：其余文件（**任意类型**，含 PDF/音视频/笔记/压缩包/无扩展名）→
 *    入库后按 `attachImportedFiles` 分流：文档走双链通道、附件走回形针通道
 *    （可嵌入者写 `![[…]]`）；
 * 4. **未选中主题且载荷全是图片** → 每张在渲染根下新建纯图节点（「贴入导图」，
 *    与粘贴图片同一条 `createImageChildNode` 入口，2026-10-13）。
 *
 * 归属规则：只有 ④ 允许无归属——图片可独占一个节点；**含非图片的载荷**在未选中
 * 时仍提示先选主题，且不做「部分贴入」（文档/附件要挂在某主题下，混合载荷只处理
 * 一部分会让结果难以预期）。
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

	const engine = view.mindMap;
	const selected = getActiveNode(engine);

	// ① 修饰键：不导入，直接写绝对链接（指向文件原位置）
	if (shouldInsertAbsoluteLink(event)) {
		if (selected) {
			insertAbsoluteLinks(view, selected, files);
		} else {
			// 绝对链接落在选中节点上：无选中即无处可写
			new Notice(t(view.lang, 'common.selectNodeBeforeDrop'));
		}
		return;
	}

	// 落点解析：有选中主题 → 全部文件归它；未选中 → 仅「全是图片」可在渲染根下
	// 逐张新建图片节点，其余要求先选中（见上方归属规则）
	const toRoot = selected === null;
	let host: MindMapNode | null = selected;
	if (!host) {
		if (!files.every(isDroppedImage)) {
			new Notice(t(view.lang, 'common.selectNodeBeforeDrop'));
			return;
		}
		host = getRenderRoot(engine);
		if (!host) {
			// 引擎初始化中间态：没有可挂载的根（与粘贴图片同口径提示）
			new Notice(t(view.lang, 'common.notLoaded'));
			return;
		}
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
		const isImage = isDroppedImage(file);
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
	// 只有「抛异常」这一路径才由本层汇总提示。入库通道（images-save）对每个失败
	// 已经弹过Notice（attachment.chooseImage / tooLarge）或 notifyError
	// （attachment.saveFailed）并 return null，那种情况 firstError 仍是 null——
	// 若按failedCount > 0 无条件再弹一次，用户会看到两条提示，且第二条正文是
	// notifyError 拼上的 String(null) 字面量「null」。
	if (firstError !== null) {
		console.error('导入拖入的文件失败', firstError);
		notifyError(view.lang, 'common.importFileFailed', firstError);
	} else if (failedCount > 0) {
		console.warn(
			`导入拖入的文件失败 ${failedCount} 个（原因已由入库通道逐条提示）`,
		);
	}
	// 归属：图片首张挂到所选节点（保持单图拖入的原行为），其余各新建子节点承载。
	// 此前循环对同一节点反复 applyNodeImage（SET_NODE_IMAGE 覆盖图片字段），
	// 多图拖入只有最后一张存活——静默丢图。
	// 保存期间可能换文件/重建引擎：旧节点已不在新树上，直接放弃写入。
	if (view.mindMap !== engine) {
		return;
	}
	if (toRoot) {
		// 未选中：每张各占根下一个纯图节点**且不碰中心主题**（图片独占节点语义）
		for (const image of saved) {
			await createImageChildNode(view, host, image);
		}
	} else {
		await attachImportedFiles(view, host, saved);
	}
	// 提示：单图挂到**所选节点**上时沿用「已设为节点图片」+「已导入 1」两条
	// （历史文案），其余形态统一走「已导入 N 个文件到仓库中…」
	const firstImage = saved.find((file) => isImageExtension(file.extension));
	if (!toRoot && saved.length === 1 && firstImage) {
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
		await createImageChildNode(view, selected, extra);
	}
	for (const document of documents) {
		// 目标名 / 路径形态 / 形态分支同走 planDocLink（单一判定，勿在此重算）
		const plan = planDocLink(view, document);
		applyDocWikiLink(view, selected, plan.link, plan.target);
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
 * 拖入的 `File` 是否为图片：用**可渲染清单**（含 tif/tiff/jxl…），与解析侧
 * `isImageEmbedTarget` 同口径；`file.type` 兜底覆盖无名扩展名的来源。
 * 落点判定（全为图片才允许无归属）与入库通道分流共用本谓词。
 */
function isDroppedImage(file: File): boolean {
	return (
		file.type.startsWith('image/') ||
		isRenderableImageExtension(extensionOf(file))
	);
}
