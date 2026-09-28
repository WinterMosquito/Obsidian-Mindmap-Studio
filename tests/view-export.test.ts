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
import { injectObsidianCssVarsIntoExportSvg } from '../src/platform/export-css-vars';

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

// ---------------------------------------------------------------------------
// K99：导出 SVG 的 Obsidian CSS 变量注入（修复导出 PNG 时多行节点/LaTeX 节点被裁）
// ---------------------------------------------------------------------------

/** 伪造 svg.js 元素形态（{ node, ownerDocument.win.createSvg }），捕获注入的样式 */
function makeSvgElementForVars() {
	const injected: { textContent: string }[] = [];
	const styleEl = { textContent: '' };
	const root = {
		appendChild: vi.fn((child: { textContent: string }) => {
			injected.push(child);
		}),
		// ownerDocument 在**原生节点**上（svgElement.node 的属性），与真实 DOM 同构
		ownerDocument: {
			win: { createSvg: vi.fn(() => styleEl) },
		},
	};
	const svgElement = { node: root };
	return { svgElement, root, injected };
}

describe('injectObsidianCssVarsIntoExportSvg（导出 CSS 变量注入，K99）', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('宿主变量有值：以 `svg { … }` 注入克隆 SVG 根并原样返回元素', () => {
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: (name: string) =>
				({
					'--font-interface': 'Inter, Noto Sans SC',
					'--font-monospace': 'JetBrains Mono',
					'--code-background': ' #f4f4f4 ',
				})[name] ?? '',
		}));
		const { svgElement, injected } = makeSvgElementForVars();

		const returned = injectObsidianCssVarsIntoExportSvg(svgElement);

		expect(returned, '原样返回（引擎要求）').toBe(svgElement);
		expect(injected).toHaveLength(1);
		expect(injected[0]!.textContent).toBe(
			'svg { --font-interface: Inter, Noto Sans SC; --font-monospace: JetBrains Mono; --code-background: #f4f4f4; }',
		);
	});

	it('空白值变量跳过（不产出空声明）；其余变量照常注入', () => {
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: (name: string) =>
				({ '--font-interface': 'Inter', '--font-text': '   ' })[name] ?? '',
		}));
		const { svgElement, injected } = makeSvgElementForVars();

		injectObsidianCssVarsIntoExportSvg(svgElement);

		expect(injected[0]!.textContent).toBe('svg { --font-interface: Inter; }');
	});

	it('宿主变量全部为空：不注入任何节点（安全 no-op）', () => {
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: () => '',
		}));
		const { svgElement, root } = makeSvgElementForVars();

		injectObsidianCssVarsIntoExportSvg(svgElement);

		expect(root.appendChild).not.toHaveBeenCalled();
	});

	it('宿主环境不可用（无 getComputedStyle / 无 document）：安全 no-op', () => {
		const { svgElement, root } = makeSvgElementForVars();

		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', undefined);
		expect(injectObsidianCssVarsIntoExportSvg(svgElement)).toBe(svgElement);

		vi.stubGlobal('document', undefined);
		expect(injectObsidianCssVarsIntoExportSvg(svgElement)).toBe(svgElement);
		expect(root.appendChild).not.toHaveBeenCalled();
	});

	it('svg 元素形态不符（缺 node / 无 appendChild）：安全 no-op', () => {
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: () => '--',
		}));
		const malformedA = null;
		const malformedB = { node: null };
		const malformedC = { node: { ownerDocument: undefined } };

		expect(injectObsidianCssVarsIntoExportSvg(malformedA)).toBe(malformedA);
		expect(injectObsidianCssVarsIntoExportSvg(malformedB)).toBe(malformedB);
		expect(injectObsidianCssVarsIntoExportSvg(malformedC)).toBe(malformedC);
	});

	it('值含块闭合 / 注入字符（第三方主题可控值）：跳过该变量，不污染规则块', () => {
		// K99 加固：变量值来自宿主主题（用户可装第三方主题与 CSS 片段）。
		// 形如 `Inter} svg{opacity:0` 的值会闭合 `svg { … }` 并注入任意规则 →
		// 导出图被篡改（内容隐藏等），故必须过滤。
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: (name: string) =>
				({
					'--font-interface': 'Inter} svg{opacity:0',
					'--font-monospace': 'JetBrains Mono',
					'--text-normal': '<script>alert(1)</script>',
				})[name] ?? '',
		}));
		const { svgElement, injected } = makeSvgElementForVars();

		injectObsidianCssVarsIntoExportSvg(svgElement);

		// 只注入安全值：可疑值被丢弃（导出回退内联兜底值，功能仍可用）
		expect(injected[0]!.textContent).toBe(
			'svg { --font-monospace: JetBrains Mono; }',
		);
	});
});
