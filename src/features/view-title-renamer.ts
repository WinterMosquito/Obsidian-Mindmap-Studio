/**
 * 标题重命名（从 view.ts 拆分）：中心主题 ⇄ 文件名双向同步。
 * 根节点文本编辑停止（防抖 + 非编辑态）后重命名 .mindmap.md 文件，
 * Obsidian 原生更新链接/反链；外部改名后视图重载，中心随新文件名。
 */
import { App, Notice, TFile } from 'obsidian';
import { createDebouncer } from '../concurrency';
import { isMindMapMarkdownFile } from '../md-open';
import { sanitizeFileName } from '../images-save';
import {
	MD_FILE_SUFFIX,
	stripMindMapStem,
	TITLE_RENAME_DEBOUNCE_MS,
} from '../constants';
import { t } from '../i18n';
import type { Language } from '../i18n';

interface TitleRenamerDeps {
	app: App;
	getFile(): TFile | null;
	isEditingText(): boolean;
	getRootText(): string | null;
	lang: Language;
}

/** 中心主题改名：防抖（TITLE_RENAME_DEBOUNCE_MS）+ 非编辑态守卫 + 目标路径存在性校验 */
export class TitleRenamer {
	private readonly debouncer = createDebouncer(TITLE_RENAME_DEBOUNCE_MS);

	constructor(private readonly deps: TitleRenamerDeps) {}

	/** 调度一次重命名（引擎数据变更回调触发） */
	schedule(): void {
		const file = this.deps.getFile();
		if (!file) return;
		this.debouncer.schedule(() => {
			void this.performRename();
		});
	}

	/** 取消待执行的重命名（文件切换/视图关闭时调用） */
	cancel(): void {
		this.debouncer.cancel();
	}

	private async performRename(): Promise<void> {
		const file = this.deps.getFile();
		if (!file || !isMindMapMarkdownFile(file)) return;

		if (this.deps.isEditingText()) {
			// 仍在文本编辑框内 → 等编辑结束
			this.schedule();
			return;
		}

		const title = (this.deps.getRootText() ?? '').trim();
		const sanitized = sanitizeFileName(title).trim();
		const base = stripMindMapStem(file.basename);
		if (!sanitized || sanitized === base) return;

		const folder = file.parent ? `${file.parent.path}/` : '';
		const newPath = `${folder}${sanitized}${MD_FILE_SUFFIX}`;
		if (newPath === file.path) return;

		// 非解析用途，仅判断路径是否已存在（类型化 getter 成对，官方推荐）
		if (
			this.deps.app.vault.getFileByPath(newPath) ??
			this.deps.app.vault.getFolderByPath(newPath)
		) {
			new Notice(t(this.deps.lang, 'rename.titleConflict'));
			return;
		}
		try {
			// 必须走 FileManager.renameFile（而非 vault.rename）：只有前者会
			// 更新库内其他笔记中指向本文件的链接/反链（官方 d.ts 明确要求，
			// 核心文件浏览器/内联标题/CLI 改名均走此入口）。vault.rename 只做
			// 文件系统改名，会让指向本导图的链接变成断链。
			await this.deps.app.fileManager.renameFile(file, newPath);
		} catch (error) {
			console.error('根据中心主题重命名文件失败', error);
			new Notice(t(this.deps.lang, 'rename.titleFailed'));
		}
	}
}
