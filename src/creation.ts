/**
 * 新建思维导图：创建普通 `命名.md` 文件，正文带 `类型: Mindmap` 属性声明。
 *
 * 渲染层定位：新文件是标准 Markdown（属性块 + 提示列表），双击/链接打开落在
 * Obsidian markdown 视图；本模块负责流程（命名、落盘、打开），并在创建后自动
 * 把当前标签切换到导图视图（openAsMindMap）。
 */
import { App, Notice, normalizePath, type TFolder } from 'obsidian';
import { notifyError } from './core/errors';
import { t } from './core/i18n';
import {
	buildDefaultMindMapName,
	createDefaultMarkdownContent,
} from './markdown/markdown';
import { openAsMindMap } from './markdown/md-open';
import type { MindMapStudioSettings } from './settings';
import { openNameInputModal } from './ui/modal-name';

/** `createNewMindMap` 消费的设置子集（窄化契约：命令宿主只需提供这几项） */
export type NewMindMapSettings = Pick<
	MindMapStudioSettings,
	'language' | 'saveLocation' | 'saveFolder'
>;

/**
 * 新建思维导图（需求：新建应为 Markdown 文件而非专有格式）：
 * 默认名称「思维导图+当前日期」（如 思维导图2026-08-21），
 * 创建时弹出名称输入框，允许用户直接修改文件名；重名时自动追加序号。
 *
 * @param folderPath 显式落点（文件浏览器右键文件夹 /「在当前文件夹新建」）。
 *   `undefined` 才是「未指定」，此时按设置 `saveLocation` 解析默认位置
 *   （见 `resolveNewMindMapFolder`）；显式落点不受该设置影响（与官方
 *   「右键文件夹 → 新建」语义一致）。
 */
export async function createNewMindMap(
	app: App,
	settings: NewMindMapSettings,
	folderPath?: string,
): Promise<void> {
	const language = settings.language;
	// 库根目录的 path 是**空串**（不是 '/'）：`||` 会把「显式指定库根」误判成
	// 「未指定」，回落默认解析后文件被静默建到别的目录（文件浏览器里对着库根
	// 点「新建思维导图」即触发）。空串是合法取值，故用 ?? —— 只有 undefined
	// 才表示「未指定」。
	const folder =
		folderPath ?? folderPathOf(resolveNewMindMapFolder(app, settings));
	const defaultName = buildDefaultMindMapName(language);
	const name = await openNameInputModal(
		app,
		defaultName,
		folder,
		language,
	);
	if (name === null) {
		return; // 用户取消
	}
	try {
		// 用户可能在弹窗里连扩展名一起输入：容忍 `.md` 后缀，不产生 `x.md.md`
		const baseName = (name || defaultName).replace(/\.md$/i, '');
		const fileName = await ensureUniqueFileName(
			app,
			folder,
			`${baseName}.md`,
		);
		const path = vaultPath(folder, fileName);
		// 新建内容为标准 Markdown 大纲；中心主题 = 文件名（虚拟文档根）
		const content = createDefaultMarkdownContent(language);
		const file = await app.vault.create(path, content);
		// 打开并自动切入导图视图（Obsidian 默认会以 markdown 打开 .md 文件）
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file);
		await openAsMindMap(leaf, file);
		new Notice(t(language, 'command.created'));
	} catch (error) {
		notifyError(language, 'command.createFailed', error);
	}
}

/**
 * 解析「新建导图的默认位置」（数据源为本插件设置，规则与 Obsidian Canvas
 * 的 `getNewFileParent` 逐条同构）：
 *
 * - `obsidian`：跟随官方「设置 → 文件与链接 → 新建笔记的默认位置」——经官方
 *   `FileManager.getNewFileParent` 完整生效（含核心自己的「指定文件夹」模式），
 *   sourcePath 传当前文件路径（官方 d.ts：无活动文件时传空串）；
 * - `root`：库根；
 * - `current`：当前文件所在文件夹（无活动文件 → 库根）。`MindMapView` 是
 *   `FileView`，故导图视图下取到的就是本导图所在文件夹；
 * - `folder`：设置的 `saveFolder`（被删/改名解析不到 → 库根，**不自动创建**，
 *   对齐 Canvas）。
 */
function resolveNewMindMapFolder(
	app: App,
	settings: NewMindMapSettings,
): TFolder {
	const activeFile = app.workspace.getActiveFile();
	switch (settings.saveLocation) {
		case 'root':
			return app.vault.getRoot();
		case 'current':
			return activeFile?.parent ?? app.vault.getRoot();
		case 'folder':
			return (
				app.vault.getFolderByPath(settings.saveFolder) ?? app.vault.getRoot()
			);
		default:
			// 第二参只用于**按扩展名**选设置（obsidian.d.ts:4370-4371：
			// 「The path to the file that will be newly created, used to infer
			// what settings to use based on the path's extension」）：本插件新建
			// 的永远是 `.md`，而 sourcePath 可能是 `.canvas` / `.base`——不传时
			// 官方会按**源**扩展名选到「新 canvas 的位置」。目标文件夹正是本函数
			// 的求解目标（鸡生蛋）且不参与该推断，故只传不含目录的占位名。
			return app.fileManager.getNewFileParent(
				activeFile?.path ?? '',
				'UNTITLED.md',
			);
	}
}

/**
 * TFolder → 落点路径：库根归一为**空串**（库内相对路径不带前导斜杠）。
 *
 * 为什么要归一：`vault.getRoot()`（以及官方 `getNewFileParent` 的回落分支）
 * 返回的根 TFolder，其 `path` 实机是 `'/'`。官方 `normalizePath` **确实**承诺
 * 剥离前导斜杠（obsidian.d.ts：*removes duplicate, leading and trailing
 * slashes*，示例 `normalizePath('/foo/bar'); // foo/bar`；此前本注释写作
 * 「官方未承诺」，与 d.ts 相反），但本函数刻意不依赖它：用官方
 * `TFolder.isRoot()` 判定并归一，不比较路径字符串（路径比较还要处理大小写与
 * NFC，而 `getFolderByPath` 自称 case sensitive）。
 */
function folderPathOf(folder: TFolder): string {
	return folder.isRoot() ? '' : folder.path;
}

/**
 * 库内路径拼接：库根目录的 folder 是**空串**，故不能无条件`${folder}/${name}`
 * —— 那会产出带前导斜杠的 `/name.mindmap.md`。有前导斜杠**并非不可用**（官方
 * `normalizePath` 承诺剥离，见 d.ts 示例），此处只是不想让「库根」这一档在
 * 落点字符串里留下前导斜杠，保持与库内相对路径同一形态。
 *
 * 全库只有本文件需要「folder + 文件名 → 新建目标路径」，故就地定义，
 * 不另立收口（AGENTS.md硬规则 5：不造第二份判定）。
 */
function vaultPath(folder: string, name: string): string {
	return normalizePath(folder ? `${folder}/${name}` : name);
}

/** 同一目录下重名时自动追加序号（Obsidian 惯例：名称 1、名称 2...）。
 *  序号插在扩展名之前（名称 1.md）。 */
async function ensureUniqueFileName(
	app: App,
	folder: string,
	fileName: string,
): Promise<string> {
	// 拆分 stem 与扩展名（调用方保证传入 `*.md`；无扩展名时整体当 stem）
	const stem = fileName.replace(/\.[^.]+$/, '') || fileName;
	const extension = fileName.slice(stem.length);
	let candidate = fileName;
	let index = 1;
	// 性能：候选路径存在性检查代替全库路径 Set 构建（大库下每次创建 O(1)）；
	// 类型化 getter 成对使用（官方推荐，替代易混淆的 getAbstractFileByPath）
	while (
		app.vault.getFileByPath(vaultPath(folder, candidate)) ??
		app.vault.getFolderByPath(vaultPath(folder, candidate))
	) {
		candidate = `${stem} ${index}${extension}`;
		index++;
	}
	return candidate;
}
