/**
 * 导出（PNG/SVG）的防腐收口（2026-10-16 自 `engine/mindmap.ts` 拆出）。
 *
 * 两个入口同处一文件：公开的 `exportMindMapImage` 与私有的 `runWithExportScale`
 * ——后者承载「临时倍率进入 → 任务 → **无论成败恢复**」这一对不变式。
 */
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import type { ExportImageFormat } from '../core/constants';

/**
 * 以临时导出倍率执行导出任务：进入时写入 minExportImgCanvasScale，
 * 任务结束（无论成败）恢复原值；原值不存在时删除该键，避免残留到
 * 后续渲染。引擎销毁等边角情况下恢复失败**留痕告警**（残留会让后续导出
 * 沿用错误倍率，静默即无痕退化）。
 */
async function runWithExportScale<T>(
	mindMap: MindMap,
	scale: number,
	task: () => Promise<T> | T,
): Promise<T> {
	const oldScale = mindMap.opt.minExportImgCanvasScale;
	try {
		mindMap.updateConfig({ minExportImgCanvasScale: scale });
		return await task();
	} finally {
		try {
			if (oldScale !== undefined) {
				mindMap.updateConfig({ minExportImgCanvasScale: oldScale });
			} else {
				delete mindMap.opt.minExportImgCanvasScale;
			}
		} catch (error) {
			// 引擎已销毁等边角情况：**仍要留痕**——恢复失败会让临时倍率残留，
			// 此后导出沿用错误倍率（静默吞掉＝无痕退化，与同文件其它分支口径不一）
			console.warn('恢复导出倍率失败', error);
		}
	}
}

/**
 * 导出图片（DoExport 插件不可用时返回 null）。错误向调用方
 * 传播（由 UI 层弹用户可见提示）。
 * doExport/exporter 为引擎插件内部形态，访问收口在本函数。
 *
 * - `png`：位图光栅化，受导出倍率（minExportImgCanvasScale）影响；
 * - `svg`：矢量直出，与倍率无关（不临时切换 minExportImgCanvasScale）。
 * 两者都走同一条 `handleBeingExportSvg` 导出后处理链（CSS 变量 / MathJax
 * 字形注入等），由 vendor 的 export 插件在 getSvgData 时应用。
 */
export async function exportMindMapImage(
	mindMap: MindMap,
	format: ExportImageFormat,
	scale: number,
	fileName: string,
): Promise<Blob | string | null> {
	const exporter = mindMap.doExport;
	if (!exporter?.export) {
		return null;
	}
	if (format === 'svg') {
		return exporter.export('svg', false, fileName);
	}
	return runWithExportScale(mindMap, scale, () =>
		exporter.export('png', false, fileName),
	);
}
