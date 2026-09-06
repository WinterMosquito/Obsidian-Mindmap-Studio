/**
 * 系统应用打开：用系统默认应用打开库内文件（仅桌面端）。
 * 从 view-attachments.ts 拆出（该文件其余能力已并入 view-node-actions.ts）。
 */
import { App, FileSystemAdapter, Notice, Platform, TFile } from 'obsidian';
import { t, type Language } from './i18n';

/**
 * 用系统默认应用打开库内文件（仅桌面端；移动端无系统应用入口，仅提示）。
 * 官方 API 说明：FileSystemAdapter 是 Obsidian 公开类（obsidian.d.ts），
 * 用 instanceof 收窄 DataAdapter，避免依赖类型断言。
 */
export function openFileWithSystemApp(
	app: App,
	file: TFile,
	lang: Language,
): void {
	if (Platform.isDesktopApp) {
		try {
			const adapter = app.vault.adapter;
			// 桌面端适配器即 FileSystemAdapter，提供 getFullPath（绝对路径）
			if (adapter instanceof FileSystemAdapter) {
				const nodeRequire = require as (id: string) => unknown;
				const { shell } = nodeRequire('electron') as {
					shell: { openPath(path: string): Promise<string> };
				};
				void shell.openPath(adapter.getFullPath(file.path));
				return;
			}
		} catch (error) {
			console.error('调用系统默认应用打开失败:', file.path, error);
		}
	}
	new Notice(t(lang, 'common.cannotOpen'));
}
