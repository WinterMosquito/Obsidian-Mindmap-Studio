/**
 * view-export 回归：PNG 导出的结果分流、文件名与失败上报（features/view-export）。
 *
 * 覆盖：
 * - 引擎未就绪（mindMap 为 null）直接返回，不触发导出与下载；
 * - 结果三态分流：Blob → 对象 URL 下载（**延迟回收**，等待浏览器开始读取）；
 *   data URL 字符串 → 直接下载；null（引擎未产出）→ 不触发下载；
 * - 入参与文件名：导出倍率取自 `plugin.settings.exportScale`、导出名与落盘名取
 *   `file.basename`（无文件时回退 `mindmap`）；
 * - 失败转用户可见提示（`export.pngFailed`），不外抛。
 *
 * 隔离策略：引擎（exportMindMapPng）与错误上报（core/errors）mock 为 spy；
 * `createEl`（Obsidian 全局）与 `URL.createObjectURL` / `revokeObjectURL`
 * （浏览器 API，Node 环境未必存在）用桩覆写并在用例后还原；下载时机用
 * fake timers 断言「1s 后才回收」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';

const { exportMock, notifyErrorMock } = vi.hoisted(() => ({
	exportMock: vi.fn<(mindMap: unknown, scale: number, name: string) => Promise<unknown>>(
		async () => null,
	),
	notifyErrorMock: vi.fn<(lang: unknown, key: unknown, error: unknown) => void>(),
}));

vi.mock('../src/engine/mindmap', () => ({ exportMindMapPng: exportMock }));
vi.mock('../src/core/errors', () => ({ notifyError: notifyErrorMock }));

import { exportPNG } from '../src/features/view-export';

/** 下载锚点桩：createEl('a') 返回它，记录 href/download/click */
const anchor = { href: '', download: '', click: vi.fn<() => void>() };
const createElMock = vi.fn<(tag: string) => unknown>(() => anchor);
const createObjectURLMock = vi.fn<(blob: unknown) => string>(() => 'blob:mock-url');
const revokeObjectURLMock = vi.fn<(url: string) => void>();

// URL 静态方法的原值（Node 是否内置 createObjectURL 依版本而定）：统一覆写 + 精确还原
const urlRecord = URL as unknown as Record<string, unknown>;
const originalCreateObjectURL = urlRecord['createObjectURL'];
const originalRevokeObjectURL = urlRecord['revokeObjectURL'];

function makeView(
	options: { withEngine?: boolean; basename?: string | null; exportScale?: number } = {},
) {
	const raw = {
		mindMap: options.withEngine === false ? null : ({} as MindMap),
		lang: 'zh',
		file: options.basename === null ? null : { basename: options.basename ?? '思维导图' },
		plugin: { settings: { exportScale: options.exportScale ?? 2 } },
	};
	return {
		view: raw as unknown as MindMapViewContext,
		mindMap: raw.mindMap,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	anchor.href = '';
	anchor.download = '';
	vi.stubGlobal('createEl', createElMock);
	urlRecord['createObjectURL'] = createObjectURLMock;
	urlRecord['revokeObjectURL'] = revokeObjectURLMock;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	// 逐个精确还原：原值缺省（Node 无该 API）时删除而不是留 undefined 属性
	if (originalCreateObjectURL === undefined) {
		delete urlRecord['createObjectURL'];
	} else {
		urlRecord['createObjectURL'] = originalCreateObjectURL;
	}
	if (originalRevokeObjectURL === undefined) {
		delete urlRecord['revokeObjectURL'];
	} else {
		urlRecord['revokeObjectURL'] = originalRevokeObjectURL;
	}
});

describe('exportPNG（导出为 PNG 文件）', () => {
	it('引擎未就绪（mindMap 为 null）：直接返回，不调用导出、不建锚点', async () => {
		const { view } = makeView({ withEngine: false });

		await exportPNG(view);

		expect(exportMock).not.toHaveBeenCalled();
		expect(createElMock).not.toHaveBeenCalled();
	});

	it('Blob 结果：对象 URL 下载，且延迟 1s 才回收（避免中断下载）', async () => {
		vi.useFakeTimers();
		const blob = new Blob(['png']);
		exportMock.mockResolvedValue(blob);
		const { view, mindMap } = makeView();

		await exportPNG(view);

		expect(exportMock).toHaveBeenCalledWith(mindMap, 2, '思维导图');
		expect(createObjectURLMock).toHaveBeenCalledWith(blob);
		expect(anchor.href).toBe('blob:mock-url');
		expect(anchor.download).toBe('思维导图.png');
		expect(anchor.click).toHaveBeenCalledTimes(1);
		expect(revokeObjectURLMock, '未到期不回收').not.toHaveBeenCalled();

		vi.advanceTimersByTime(1000);
		expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');
	});

	it('字符串结果（data URL）：直接下载，不创建对象 URL', async () => {
		exportMock.mockResolvedValue('data:image/png;base64,AAAA');
		const { view } = makeView();

		await exportPNG(view);

		expect(anchor.href).toBe('data:image/png;base64,AAAA');
		expect(anchor.download).toBe('思维导图.png');
		expect(anchor.click).toHaveBeenCalledTimes(1);
		expect(createObjectURLMock).not.toHaveBeenCalled();
	});

	it('null 结果（引擎未产出）：不触发下载', async () => {
		exportMock.mockResolvedValue(null);
		const { view } = makeView();

		await exportPNG(view);

		expect(createElMock).not.toHaveBeenCalled();
		expect(anchor.click).not.toHaveBeenCalled();
	});

	it('无文件与倍率设置：导出名回退 mindmap，倍率按设置透传', async () => {
		exportMock.mockResolvedValue('data:x');
		const { view, mindMap } = makeView({ basename: null, exportScale: 3 });

		await exportPNG(view);

		expect(exportMock).toHaveBeenCalledWith(mindMap, 3, 'mindmap');
		expect(anchor.download).toBe('mindmap.png');
	});

	it('导出抛错：不外抛，转用户可见提示', async () => {
		const error = new Error('boom');
		exportMock.mockRejectedValue(error);
		const { view } = makeView();

		await expect(exportPNG(view)).resolves.toBeUndefined();
		expect(notifyErrorMock).toHaveBeenCalledWith('zh', 'export.pngFailed', error);
	});
});
