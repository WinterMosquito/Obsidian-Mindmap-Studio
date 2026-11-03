/**
 * 导出子系统：图片（PNG / SVG）导出与下载工具。
 * （导出 JSON / 导入 JSON 已随专有格式支持删除）
 * DoExport 插件访问与导出倍率切换收口在 mindmap.exportMindMapImage。
 */
import { Notice } from 'obsidian';
import type { ExportImageFormat } from '../core/constants';
import { notifyError } from '../core/errors';
import { t, tf, type Language } from '../core/i18n';
import { exportMindMapImage } from '../engine/mindmap';
import { primeExportMathFonts } from '../platform/math-jax';
import type { MindMapViewContext } from './view-context';

const FALLBACK_NAME = 'mindmap';

/** 下载触发后延迟回收 blob URL 的间隔（等待浏览器开始读取，避免中断下载） */
const DOWNLOAD_REVOKE_DELAY_MS = 1000;

/**
 * 导出进度提示的延迟（毫秒）：短导出（小图实测 <120ms、含公式复导出 ~0.7s）
 * 不弹提示，避免每点一次导出都闪一条 Notice。
 */
const EXPORT_PROGRESS_DELAY_MS = 400;

/**
 * 导出期间的常驻提示：**超过阈值才出现**，结束即撤。
 *
 * 为什么需要（2026-11-02 实机）：首次导出要预取数学字体（24 个 woff2 逐字节
 * 取回并内联，实测 385 节点含公式图 **24s**，同会话第二次回落到 0.7s），
 * 而这整段时间界面没有任何反馈——用户会以为卡死并重复点击（重复导出会叠加
 * 同一份字体预取的排空队列）。
 *
 * @returns 撤销函数（调用方在 finally 里调，正常/异常都要撤）
 */
function showExportProgress(lang: Language): () => void {
	let notice: Notice | null = null;
	const timer = window.setTimeout(() => {
		notice = new Notice(t(lang, 'export.exporting'), 0);
	}, EXPORT_PROGRESS_DELAY_MS);
	return () => {
		window.clearTimeout(timer);
		notice?.hide();
	};
}

/** 按指定格式导出并触发下载（PNG 遵循导出倍率设置，SVG 为矢量不受其影响；错误转用户可见提示，不外抛） */
export async function exportImageAs(
	view: MindMapViewContext,
	format: ExportImageFormat,
): Promise<void> {
	if (!view.mindMap) {
		return;
	}
	// 捕获本地实例：导出期间视图可能被关闭（view.mindMap 被置空），
	// 用局部引用避免空指针。
	const mindMap = view.mindMap;
	// 慢路径（首次字体预取可达数十秒）期间的可见反馈；快路径不闪。
	const dismissProgress = showExportProgress(view.lang);
	try {
		// 数学字体内联的前提：导出钩子（handleBeingExportSvg）是同步的，
		// 字体缓存必须先就绪，否则这一次导出仍走「无字体」回退（stretchy 缺失）。
		// 幂等、并发去重、失败不抛（返回 false → 导出自动回退）。
		await primeExportMathFonts();
		const result = await exportMindMapImage(
			mindMap,
			format,
			view.plugin.settings.exportScale,
			view.file?.basename ?? FALLBACK_NAME,
		);
		if (result) {
			const fileName = `${view.file?.basename ?? FALLBACK_NAME}.${format}`;
			if (result instanceof Blob) {
				downloadBlob(result, fileName);
			} else if (typeof result === 'string') {
				downloadDataURL(result, fileName);
			}
			// 下载走浏览器通道（文件落**系统下载目录**，不在库内），界面不产生
			// 任何可见变化 ⇒ 必须报一句「导出了什么、叫什么」，否则用户以为没反应
			//（2026-11-03 实机：无提示，而 ~/Downloads 里已经有文件）。
			new Notice(tf(view.lang, 'export.done', { name: fileName }));
		}
	} catch (error) {
		// 与其余失败路径（view-paste / view-dnd / view-node-actions /
		// view-image-actions）同款：Notice 给用户，console 留诊断。
		console.error(`导出 ${format.toUpperCase()} 失败`, error);
		notifyError(view.lang, format === 'svg' ? 'export.svgFailed' : 'export.pngFailed', error);
	} finally {
		// 完成/失败/视图被关闭都要撤（常驻 Notice 不会自己消失）
		dismissProgress();
	}
}

/**
 * 导出图片入口：按设置中的「导出格式」直接导出（PNG 位图 / SVG 矢量），不弹窗。
 * 格式来源 view.plugin.settings.exportImageFormat（在设置面板中选定）。
 */
export async function exportImage(view: MindMapViewContext): Promise<void> {
	if (!view.mindMap) {
		return;
	}
	await exportImageAs(view, view.plugin.settings.exportImageFormat);
}

/** 触发浏览器下载一个 Blob（延迟回收 URL，避免中断下载） */
function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = createEl('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_REVOKE_DELAY_MS);
}

/** 触发浏览器下载一个 data URL */
function downloadDataURL(url: string, fileName: string): void {
	const anchor = createEl('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
}
