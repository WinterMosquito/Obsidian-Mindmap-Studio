/**
 * 链接导航（从 view.ts 拆分）：处理节点超链接跳转。
 * 三种入口统一走本模块：[[wikilink]] / http(s) URL / 库内相对路径。
 * 委托 view-context.ts 的 MindMapViewContext 接口（openHyperlink 声明保持不变）。
 */
import { Notice, TFile } from 'obsidian';
import {
	canOpenInObsidian,
	isSystemMediaExtension,
} from '../constants';
import { isHttpUrl } from '../domain/url';
import { parseWikilink } from '../domain/wikilink';
import { resolvePathToFile } from '../links-resolve';
import { openFileWithSystemApp } from '../system-open';
import { t } from '../i18n';
import type { Language } from '../i18n';
import type { MindMapViewContext } from './view-context';

/**
 * 打开节点超链接（wiki 链接 / http / 库内路径）。
 * @param openNew true = 新标签页打开（Ctrl/Cmd+点击语义）
 */
export function openHyperlink(
	view: MindMapViewContext,
	link: string,
	openNew = false,
): void {
	if (!link) {
		return;
	}
	const sourcePath = view.file?.path ?? '';
	const wiki = parseWikilink(link);
	if (wiki) {
		const dest = view.app.metadataCache.getFirstLinkpathDest(
			wiki.target,
			sourcePath,
		);
		openResolvedTarget(view, dest, wiki.inner, sourcePath, openNew);
		return;
	}
	if (isHttpUrl(link)) {
		window.open(link, '_blank');
		return;
	}
	const file = resolvePathToFile(link, view.app);
	openResolvedTarget(view, file, link, sourcePath, openNew);
}

/**
 * 打开已解析的库内目标（wiki 与库内路径两分支共用）：
 * Obsidian 可渲染才开标签页；系统媒体（音频/视频）走系统应用；
 * 其余类型不开空白页；目标未解析到时交给 openLinkText
 * （Obsidian 原生"未找到/新建笔记"行为）。
 */
function openResolvedTarget(
	view: MindMapViewContext,
	file: TFile | null,
	linkText: string,
	sourcePath: string,
	openNew: boolean,
): void {
	const lang: Language = view.lang;
	if (file && !canOpenInObsidian(file.extension)) {
		if (isSystemMediaExtension(file.extension)) {
			openFileWithSystemApp(view.app, file, lang);
		} else {
			new Notice(t(lang, 'common.cannotPreview'));
		}
		return;
	}
	void view.app.workspace.openLinkText(
		linkText,
		sourcePath,
		openNew ? 'tab' : false,
	);
}
