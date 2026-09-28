/**
 * view-paste 回归：画布/窗口粘贴图片的分发与回显（features/view-paste）。
 *
 * 覆盖：
 * - `setupPasteHandler`：容器 paste 监听注册（无 containerEl 时不注册）；
 * - `handleWindowPaste` 三道豁免：已消费（defaultPrevented）/ 目标在容器内
 *   （容器监听已处理）/ 输入框与文本域内（不劫持）；
 * - `handlePasteEvent`（经两条入口触发）：剪贴板无 items 或无图片不接管；
 *   有图片但无激活节点 → 提示先选节点；成功路径（按 Obsidian 命名约定
 *   `buildPastedImageName` → `saveImageToVault` → `applyNodeImage` + 落盘提示）；
 *   两道守卫——保存返回 null、保存期间引擎换代（旧节点已不在新树上）均不写图；
 *   失败转用户可见提示（`common.pasteImageFailed`）。
 *
 * 隔离策略：引擎（getActiveNode）、图片保存（images-save）、节点写图
 * （view-node-actions）、错误上报（core/errors）全部 mock 为 spy；Notice 记录
 * 文案；`HTMLInputElement` / `HTMLTextAreaElement` 是 Node 环境缺失的 DOM 全局，
 * 用 `vi.stubGlobal` 提供最小桩（instanceof 判定需要类存在）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t, type Language } from '../src/core/i18n';
import type { MindMap } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';

const {
	noticeCalls,
	getActiveNodeMock,
	saveImageMock,
	buildNameMock,
	applyImageMock,
	notifyErrorMock,
} = vi.hoisted(() => ({
	noticeCalls: [] as string[],
	getActiveNodeMock: vi.fn<(mindMap: unknown) => unknown>(() => null),
	saveImageMock: vi.fn<(options: unknown) => Promise<unknown>>(async () => null),
	buildNameMock: vi.fn(() => 'Pasted image 20260928120000'),
	applyImageMock: vi.fn<(view: unknown, node: unknown, url: string) => Promise<void>>(
		async () => {},
	),
	notifyErrorMock: vi.fn<(lang: unknown, key: unknown, error: unknown) => void>(),
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		Notice: class {
			constructor(message?: string) {
				if (message !== undefined) {
					noticeCalls.push(message);
				}
			}
		},
	};
});

vi.mock('../src/engine/mindmap', () => ({ getActiveNode: getActiveNodeMock }));

vi.mock('../src/media/images-save', () => ({
	buildPastedImageName: buildNameMock,
	saveImageToVault: saveImageMock,
}));

vi.mock('../src/features/view-node-actions', () => ({
	applyNodeImage: applyImageMock,
}));

vi.mock('../src/core/errors', () => ({ notifyError: notifyErrorMock }));

import { handleWindowPaste, setupPasteHandler } from '../src/features/view-paste';

/** 排空 microtask 队列（粘贴处理是 void 调用的异步链） */
async function flushAsync(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

/* —— 最小桩 —— */

interface PasteRegistration {
	el: unknown;
	type: string;
	handler: (event: unknown) => void;
}

/** 视图桩：containerEl/engineEvents/mindMap/app/file/lang 仅补被消费的面 */
interface RawViewStub {
	containerEl: unknown;
	engineEvents: { onDom: (el: unknown, type: string, handler: (e: unknown) => void) => void };
	mindMap: unknown;
	app: unknown;
	file: unknown;
	lang: Language;
}

/** Node 环境缺失的 DOM 全局：instanceof 判定需要类存在（不实现行为） */
class HtmlInputElementStub {}
class HtmlTextAreaElementStub {}

function makeView(
	options: { withContainer?: boolean; withEngine?: boolean; filePath?: string | null } = {},
) {
	const registrations: PasteRegistration[] = [];
	/** 容器桩：contains 判定集合由用例填充（「目标在容器内」豁免） */
	const inside = new Set<unknown>();
	const containerEl = {
		contains: (node: unknown): boolean => inside.has(node),
	} as unknown as HTMLElement;
	const mindMap = {} as MindMap;
	const getResourcePath = vi.fn(
		(file: unknown) => `app://local/${(file as { path: string }).path}`,
	);
	const raw: RawViewStub = {
		containerEl: options.withContainer === false ? null : containerEl,
		engineEvents: {
			onDom: (el, type, handler) => registrations.push({ el, type, handler }),
		},
		mindMap: options.withEngine === false ? null : mindMap,
		app: { vault: { getResourcePath } },
		file: options.filePath === null ? null : { path: options.filePath ?? '笔记.md' },
		lang: 'zh',
	};
	return {
		view: raw as unknown as MindMapViewContext,
		raw,
		mindMap,
		getResourcePath,
		registrations,
		markInsideContainer: (node: unknown): void => {
			inside.add(node);
		},
	};
}

/** 剪贴板事件桩：items 为 undefined（无 clipboardData）/ null（无 items）/ 数组 */
function makePasteEvent(options: {
	items?: { type: string; getAsFile: () => unknown }[] | null;
	target?: unknown;
	defaultPrevented?: boolean;
}) {
	const preventDefault = vi.fn();
	const event = {
		clipboardData:
			options.items === undefined ? undefined : { items: options.items },
		target: options.target ?? null,
		defaultPrevented: options.defaultPrevented ?? false,
		preventDefault,
	};
	return { event: event as unknown as ClipboardEvent, preventDefault };
}

beforeEach(() => {
	noticeCalls.length = 0;
	vi.clearAllMocks();
	getActiveNodeMock.mockReturnValue(null);
	saveImageMock.mockResolvedValue(null);
	// instanceof 判定的类存在性（行为不实现）
	vi.stubGlobal('HTMLInputElement', HtmlInputElementStub);
	vi.stubGlobal('HTMLTextAreaElement', HtmlTextAreaElementStub);
});

afterEach(() => {
	noticeCalls.length = 0;
	vi.unstubAllGlobals();
});

describe('setupPasteHandler（容器粘贴监听）', () => {
	it('注册容器 paste 监听（引擎重建时随 initMindMap 重复调用无累积，由注册方保证）', () => {
		const { view, registrations } = makeView();

		setupPasteHandler(view);

		expect(registrations).toHaveLength(1);
		expect(registrations[0]!.type).toBe('paste');
		expect(registrations[0]!.el).toBe(view.containerEl);
	});

	it('无 containerEl：不注册（容器未构建时安全返回）', () => {
		const { view, registrations } = makeView({ withContainer: false });

		setupPasteHandler(view);

		expect(registrations).toHaveLength(0);
	});

	it('容器监听触发：粘贴图片走完整链路（接管 + 写图 + 落盘提示）', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		saveImageMock.mockResolvedValue({ path: '附件/x.png' });
		const { view, mindMap, getResourcePath, registrations } = makeView();
		const imageFile = { name: 'image.png' };
		const { event, preventDefault } = makePasteEvent({
			items: [{ type: 'image/png', getAsFile: () => imageFile }],
		});

		setupPasteHandler(view);
		registrations[0]!.handler(event);
		await flushAsync();

		expect(preventDefault, '图片粘贴被插件接管').toHaveBeenCalledTimes(1);
		expect(applyImageMock).toHaveBeenCalledWith(
			view,
			node,
			`app://local/附件/x.png`,
		);
		expect(getResourcePath).toHaveBeenCalledWith({ path: '附件/x.png' });
		expect(noticeCalls).toContain(`${t('zh', 'common.imageSavedTo')}附件/x.png`);
		expect(mindMap).toBe(view.mindMap);
	});
});

describe('handleWindowPaste（窗口级兜底三道豁免）', () => {
	const imageItems = [{ type: 'image/png', getAsFile: () => ({ name: 'i.png' }) }];

	it('事件已被消费（defaultPrevented）：不重复处理', () => {
		const { view } = makeView();
		const { event } = makePasteEvent({ items: imageItems, defaultPrevented: true });

		handleWindowPaste(view, event);

		expect(saveImageMock).not.toHaveBeenCalled();
	});

	it('目标在画布容器内：容器监听已处理，兜底不重复', () => {
		const { view, markInsideContainer } = makeView();
		const target = {};
		markInsideContainer(target);
		const { event } = makePasteEvent({ items: imageItems, target });

		handleWindowPaste(view, event);

		expect(saveImageMock).not.toHaveBeenCalled();
	});

	it('输入框 / 文本域内：不劫持（在输入框粘贴图片属于编辑行为）', () => {
		const { view } = makeView();
		const inInput = makePasteEvent({
			items: imageItems,
			target: new HtmlInputElementStub(),
		});
		const inTextArea = makePasteEvent({
			items: imageItems,
			target: new HtmlTextAreaElementStub(),
		});

		handleWindowPaste(view, inInput.event);
		handleWindowPaste(view, inTextArea.event);

		expect(saveImageMock).not.toHaveBeenCalled();
	});

	it('容器外普通目标：走粘贴链路', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		saveImageMock.mockResolvedValue({ path: 'a.png' });
		const { view } = makeView();
		const { event } = makePasteEvent({ items: imageItems, target: {} });

		handleWindowPaste(view, event);
		await flushAsync();

		expect(saveImageMock).toHaveBeenCalledTimes(1);
	});
});

describe('handlePasteEvent（图片识别与写回守卫）', () => {
	async function paste(
		view: MindMapViewContext,
		options: Parameters<typeof makePasteEvent>[0],
	) {
		const { event, preventDefault } = makePasteEvent(options);
		handleWindowPaste(view, event);
		await flushAsync();
		return { preventDefault };
	}

	it('无 clipboardData（或 items 缺失）：不处理、不接管', async () => {
		const { view } = makeView();
		const noClipboard = await paste(view, {});
		const noItems = await paste(view, { items: null });

		expect(noClipboard.preventDefault).not.toHaveBeenCalled();
		expect(noItems.preventDefault).not.toHaveBeenCalled();
		expect(saveImageMock).not.toHaveBeenCalled();
	});

	it('剪贴板无图片（纯文本等）：不接管（交回默认粘贴行为）', async () => {
		const { view } = makeView();
		const { preventDefault } = await paste(view, {
			items: [{ type: 'text/plain', getAsFile: () => null }],
		});

		expect(preventDefault).not.toHaveBeenCalled();
		expect(saveImageMock).not.toHaveBeenCalled();
		expect(noticeCalls).toHaveLength(0);
	});

	it('有图片但无激活节点：提示先选节点，不落盘', async () => {
		getActiveNodeMock.mockReturnValue(null);
		const { view } = makeView();
		const { preventDefault } = await paste(view, {
			items: [{ type: 'image/png', getAsFile: () => ({ name: 'i.png' }) }],
		});

		expect(preventDefault, '图片已被接管，避免浏览器默认行为').toHaveBeenCalledTimes(1);
		expect(noticeCalls).toEqual([t('zh', 'common.selectNodeBeforePasteImage')]);
		expect(saveImageMock).not.toHaveBeenCalled();
	});

	it('成功路径：按 Obsidian 命名约定保存（覆盖系统临时名）并携带视图上下文', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		const imageFile = { name: 'image.png' };
		const saved = { path: '附件/Pasted image 20260928120000.png' };
		saveImageMock.mockResolvedValue(saved);
		const { view, raw } = makeView({ filePath: '目录/笔记.md' });

		await paste(view, { items: [{ type: 'image/png', getAsFile: () => imageFile }] });

		expect(buildNameMock).toHaveBeenCalledTimes(1);
		expect(saveImageMock).toHaveBeenCalledWith({
			app: raw.app,
			sourcePath: '目录/笔记.md',
			file: imageFile,
			filename: 'Pasted image 20260928120000',
			lang: 'zh',
		});
		expect(applyImageMock).toHaveBeenCalledWith(
			view,
			node,
			'app://local/附件/Pasted image 20260928120000.png',
		);
		expect(noticeCalls).toContain(
			`${t('zh', 'common.savingClipboardImage')}`,
		);
		expect(noticeCalls).toContain(
			`${t('zh', 'common.imageSavedTo')}附件/Pasted image 20260928120000.png`,
		);
	});

	it('无 file（视图未绑定文件）：sourcePath 回退空串（仍可保存）', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		saveImageMock.mockResolvedValue(null);
		const { view, raw } = makeView({ filePath: null });

		await paste(view, { items: [{ type: 'image/png', getAsFile: () => ({}) }] });

		expect(saveImageMock).toHaveBeenCalledWith(
			expect.objectContaining({ sourcePath: '', app: raw.app }),
		);
	});

	it('保存返回 null（未落盘）：不写节点图片', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		saveImageMock.mockResolvedValue(null);
		const { view } = makeView();

		await paste(view, { items: [{ type: 'image/png', getAsFile: () => ({}) }] });

		expect(applyImageMock).not.toHaveBeenCalled();
	});

	it('保存期间引擎换代：旧节点已不在新树上，不写入（静默丢失守卫）', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		const { view, raw } = makeView();
		saveImageMock.mockImplementation(async () => {
			raw.mindMap = {}; // 保存期间换文件/重建引擎（视图切换为新引擎实例）
			return { path: 'a.png' };
		});

		await paste(view, { items: [{ type: 'image/png', getAsFile: () => ({}) }] });

		expect(applyImageMock).not.toHaveBeenCalled();
	});

	it('保存抛错：不外抛，转用户可见提示（console.error 留诊断）', async () => {
		const node = { id: 'n1' };
		getActiveNodeMock.mockReturnValue(node);
		const error = new Error('boom');
		saveImageMock.mockRejectedValue(error);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { view } = makeView();

		await paste(view, { items: [{ type: 'image/png', getAsFile: () => ({}) }] });

		expect(notifyErrorMock).toHaveBeenCalledWith(
			'zh',
			'common.pasteImageFailed',
			error,
		);
		expect(errorSpy).toHaveBeenCalledWith('粘贴图片失败', error);
		expect(applyImageMock).not.toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
