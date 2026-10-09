/**
 * 系统应用打开：用系统默认应用打开库内文件（仅桌面端）。
 * 从 view-attachments.ts 拆出（该文件其余能力已并入 view-node-actions.ts）。
 */
import { App, FileSystemAdapter, Notice, Platform, TFile } from 'obsidian';
import { t, type Language } from '../core/i18n';

/**
 * 把 `shell.openPath` 的结果面化（两处调用点共用）。
 *
 * **Electron 契约（必须成对阅读）**：`openPath` **从不 reject 表示失败**，而是
 * resolve 一个错误消息串——成功为空串、失败为非空串。故「不读返回值」等于
 * 「打开失败时零反馈」（用户点了「在系统应用中打开」看不出任何反应）。
 * reject 分支另需兜住（`shell` 面缺失等），与 resolved 错误串走同一出口。
 */
export function surfaceOpenResult(
	result: Promise<string>,
	target: string,
	lang: Language,
): void {
	void result
		.then((errorMessage) => {
			if (!errorMessage) {
				return; // 打开成功：静默
			}
			console.error('系统应用打开失败:', target, errorMessage);
			new Notice(t(lang, 'common.systemOpenFailed'));
		})
		.catch((error: unknown) => {
			console.error('系统应用打开失败:', target, error);
			new Notice(t(lang, 'common.systemOpenFailed'));
		});
}

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
				surfaceOpenResult(
					shell.openPath(adapter.getFullPath(file.path)),
					file.path,
					lang,
				);
				return;
			}
		} catch (error) {
			console.error('调用系统默认应用打开失败:', file.path, error);
		}
	}
	new Notice(t(lang, 'common.cannotOpen'));
}

/**
 * 用系统默认应用打开**库外**绝对路径（`file:///` 链接指向的文件，见
 * domain/url.absolutePathFromFileUrl）。与 openFileWithSystemApp 同一实现路径
 * （Electron `shell.openPath`），差别只在输入：这里没有 TFile——文件不在库里。
 */
export function openAbsolutePathWithSystemApp(
	path: string,
	lang: Language,
): void {
	if (Platform.isDesktopApp) {
		try {
			const nodeRequire = require as (id: string) => unknown;
			const { shell } = nodeRequire('electron') as {
				shell: { openPath(path: string): Promise<string> };
			};
			surfaceOpenResult(shell.openPath(path), path, lang);
			return;
		} catch (error) {
			console.error('调用系统默认应用打开失败:', path, error);
		}
	}
	new Notice(t(lang, 'common.cannotOpen'));
}
