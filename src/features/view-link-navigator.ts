/**
 * 链接导航（从 view.ts 拆分）：处理节点超链接跳转。
 * 四种入口统一走本模块：[[wikilink]] / http(s) URL / 库内相对路径 / 库外 file:// 绝对路径。
 * 委托 view-context.ts 的 MindMapViewContext 接口（openHyperlink 声明保持不变）。
 */
import { TFile } from 'obsidian';
import { canOpenInObsidian } from '../core/constants';
import {
	absolutePathFromFileUrl,
	isHttpUrl,
} from '../domain/url';
import { parseWikilink } from '../domain/wikilink';
import { resolvePathToFile } from '../links/links-resolve';
import {
	openAbsolutePathWithSystemApp,
	openFileWithSystemApp,
} from '../platform/system-open';
import type { Language } from '../core/i18n';
import type { HyperlinkOpenMode, MindMapViewContext } from './view-context';

/**
 * 打开节点超链接（wiki 链接 / http / 库内路径 / 库外 file://）。
 *
 * `mode` 对应 Obsidian 的修饰键语义（见 view-context.HyperlinkOpenMode）：
 * 无修饰＝当前标签、`Ctrl/Cmd`＝新标签、`Ctrl/Cmd+Alt`＝新标签组、
 * `Ctrl/Cmd+Alt+Shift`＝新窗口。库外绝对路径与系统媒体没有「标签页」概念，
 * 一律交给系统默认应用（mode 不参与）。
 */
export function openHyperlink(
	view: MindMapViewContext,
	link: string,
	mode: HyperlinkOpenMode = 'current',
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
		openResolvedTarget(view, dest, wiki.inner, sourcePath, mode);
		return;
	}
	if (isHttpUrl(link)) {
		window.open(link, '_blank');
		return;
	}
	const file = resolvePathToFile(link, view.app);
	if (!file && link.startsWith('file://')) {
		// 库外 file:// 绝对路径（拖入系统文件时 Ctrl/Option 的形态，见
		// domain/url.fileUrlFromAbsolutePath）：库内解析必然落空，交系统应用打开。
		const path = absolutePathFromFileUrl(link);
		if (path) {
			openAbsolutePathWithSystemApp(path, view.lang);
			return;
		}
	}
	openResolvedTarget(view, file, link, sourcePath, mode);
}

/**
 * 打开已解析的库内目标（wiki 与库内路径两分支共用）：
 * Obsidian 可渲染才开标签页；**其余一律交系统默认应用**（与 Obsidian 对不可预览
 * 文件的行为一致）；目标未解析到时交给 openLinkText（Obsidian 原生"未找到/新建笔记"
 * 行为）。
 *
 * 2026-09-15 放宽：此前只有音视频走系统应用、其余弹「无法预览」——拖入白名单取消后
 * 库内可能出现任意扩展名（zip / txt / docx…），弹提示等于「链了打不开」，故统一外跳
 * （`openFileWithSystemApp` 在非桌面端仍会给出提示）。
 */
function openResolvedTarget(
	view: MindMapViewContext,
	file: TFile | null,
	linkText: string,
	sourcePath: string,
	mode: HyperlinkOpenMode,
): void {
	const lang: Language = view.lang;
	if (file && !canOpenInObsidian(file.extension)) {
		openFileWithSystemApp(view.app, file, lang);
		return;
	}
	// 'current' 是本插件对「false = 当前标签」的命名（官方 PaneType 无 current）
	void view.app.workspace.openLinkText(
		linkText,
		sourcePath,
		mode === 'current' ? false : mode,
	);
}

/**
 * 库内 linkpath 是否**解析到真实文件**（未解析＝Obsidian 阅读视图里的「弱化链接」）。
 *
 * 消费方是**自绘节点渲染**（未解析链接弱化配色）：`node-inline-content` 必须能在
 * 无运行时的页面里打包，故判定经 InlineContentOptions 注入。
 * 悬停预览**不**用它做门禁——预览由核心自行处理目标存在性，插件侧再拦一次会让
 * 常规悬停（悬在节点上而非锚点文字上）静默无反应（2026-09-16 回撤）。
 *
 * `#区块` 与 `|别名` 不参与解析（核心按目标定位，区块由预览方自行处理）。
 * 例外：`[[#标题]]` 这类**同笔记内区块链接**没有目标段——目标就是当前文件，
 * 文件本身存在即视为已解析（否则会被误判为未解析链接）。
 */
export function isResolvedWikiLinkpath(
	view: MindMapViewContext,
	linkpath: string,
): boolean {
	const target = (linkpath.split('#')[0] ?? '').split('|')[0]?.trim() ?? '';
	if (!target) {
		return linkpath.startsWith('#') && view.file !== null;
	}
	return (
		view.app.metadataCache.getFirstLinkpathDest(
			target,
			view.file?.path ?? '',
		) !== null
	);
}
