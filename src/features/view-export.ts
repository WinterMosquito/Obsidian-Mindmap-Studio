/**
 * 导出子系统：PNG / Markdown 导出与下载工具。
 * （导出 JSON / 导入 JSON 已随专有格式支持删除）
 */
import { Notice } from 'obsidian';
import { errorMessage } from '../errors';
import { runWithExportScale } from '../mindmap';
import { t } from '../i18n';
import type { MindMapViewContext } from './view-context';

const FALLBACK_NAME = 'mindmap';

/** 导出为 PNG 文件（遵循导出倍率设置） */
export async function exportPNG(view: MindMapViewContext): Promise<void> {
	if (!view.mindMap) {
		return;
	}
	// 捕获本地实例：导出期间视图可能被关闭（view.mindMap 被置空），
	// 用局部引用避免空指针。
	const mindMap = view.mindMap;
	const exporter = mindMap.doExport;
	if (!exporter?.export) {
		return;
	}
	try {
		// 导出倍率的临时写入与恢复收口在 mindmap.runWithExportScale
		const result = await runWithExportScale(
			mindMap,
			view.plugin.settings.exportScale,
			() => exporter.export(
				'png',
				false,
				view.file?.basename ?? FALLBACK_NAME,
			),
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
		new Notice(`${t(view.lang, 'export.pngFailed')}${errorMessage(error)}`);
	}
}

/** 触发浏览器下载一个 Blob（延迟回收 URL，避免中断下载） */
function downloadBlob(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = createEl('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 触发浏览器下载一个 data URL */
function downloadDataURL(url: string, fileName: string): void {
	const anchor = createEl('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
}
