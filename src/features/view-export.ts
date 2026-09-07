/**
 * 导出子系统：PNG / Markdown 导出与下载工具。
 * （导出 JSON / 导入 JSON 已随专有格式支持删除）
 * DoExport 插件访问与导出倍率切换收口在 mindmap.exportMindMapPng。
 */
import { notifyError } from '../errors';
import { exportMindMapPng } from '../mindmap';
import type { MindMapViewContext } from './view-context';

const FALLBACK_NAME = 'mindmap';

/** 下载触发后延迟回收 blob URL 的间隔（等待浏览器开始读取，避免中断下载） */
const DOWNLOAD_REVOKE_DELAY_MS = 1000;

/** 导出为 PNG 文件（遵循导出倍率设置） */
export async function exportPNG(view: MindMapViewContext): Promise<void> {
	if (!view.mindMap) {
		return;
	}
	// 捕获本地实例：导出期间视图可能被关闭（view.mindMap 被置空），
	// 用局部引用避免空指针。
	const mindMap = view.mindMap;
	try {
		const result = await exportMindMapPng(
			mindMap,
			view.plugin.settings.exportScale,
			view.file?.basename ?? FALLBACK_NAME,
		);
		if (result) {
			const fileName = `${view.file?.basename ?? FALLBACK_NAME}.png`;
			if (result instanceof Blob) {
				downloadBlob(result, fileName);
			} else if (typeof result === 'string') {
				downloadDataURL(result, fileName);
			}
		}
	} catch (error) {
		notifyError(view.lang, 'export.pngFailed', error);
	}
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
