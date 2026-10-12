/**
 * 导出子系统：图片（PNG / SVG）导出与下载工具。
 * （导出 JSON / 导入 JSON 已随专有格式支持删除）
 * DoExport 插件访问与导出倍率切换收口在 mindmap.exportMindMapImage。
 */
import type { ExportImageFormat } from '../core/constants';
import { notifyError } from '../core/errors';
import { exportMindMapImage } from '../engine/mindmap';
import type { MindMapViewContext } from './view-context';

const FALLBACK_NAME = 'mindmap';

/** 下载触发后延迟回收 blob URL 的间隔（等待浏览器开始读取，避免中断下载） */
const DOWNLOAD_REVOKE_DELAY_MS = 1000;

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
	try {
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
		}
	} catch (error) {
		// 与其余失败路径（view-paste / view-dnd / view-node-actions /
		// view-image-actions）同款：Notice 给用户，console 留诊断。
		console.error(`导出 ${format.toUpperCase()} 失败`, error);
		notifyError(view.lang, format === 'svg' ? 'export.svgFailed' : 'export.pngFailed', error);
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
