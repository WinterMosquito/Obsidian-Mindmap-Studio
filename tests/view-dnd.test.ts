/**
 * view-dnd 回归测试：画布拖拽监听的注册与拦截、库内文件（图片/笔记/附件）
 * 与外部图片导入的分发编排。
 *
 * 模块只导出 setupDragAndDrop，handleFileDrop / handleDroppedVaultFile /
 * handleDroppedAttachment / handleDroppedDocument / handleExternalFilesDrop
 * 均为私有——本测试用「记录式 onDom 桩」捕获 setupDragAndDrop 注册的三类
 * DOM 监听器，再按事件名触发以驱动私有分发链（Node 环境无真实 DOM，
 * 画布/拖拽事件用最小假对象，只实现模块实际访问到的面）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import type { EventBinder } from '../src/event-binder';
import type { SaveImageOptions } from '../src/images-save';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import { setupDragAndDrop } from '../src/features/view-dnd';

const {
	noticeCalls,
	noticeTimeouts,
	applyNodeImage,
	applyNodeAttachment,
	applyDocWikiLink,
	saveImageToVault,
	resolveDroppedFile,
	extractDroppedFileNames,
	getActiveNode,
	getRenderRoot,
	createAspectSetNodeImageOptions,
} = vi.hoisted(() => ({
	/** Notice 文案（按调用顺序） */
	noticeCalls: [] as string[],
	/** Notice 超时参数（未传为 undefined） */
	noticeTimeouts: [] as (number | undefined)[],
	applyNodeImage: vi.fn<
		(view: MindMapViewContext, node: MindMapNode, url: string) => Promise<void>
	>(),
	applyNodeAttachment: vi.fn<
		(view: MindMapViewContext, node: MindMapNode, file: TFile) => void
	>(),
	applyDocWikiLink: vi.fn<
		(
			view: MindMapViewContext,
			node: MindMapNode,
			link: string,
			label: string | undefined,
			oldDisplay: string | null,
		) => void
	>(),
	saveImageToVault: vi.fn<
		(options: SaveImageOptions) => Promise<TFile | null>
	>(),
	resolveDroppedFile: vi.fn<
		(dataTransfer: DataTransfer, app: App) => TFile | null
	>(),
	extractDroppedFileNames: vi.fn<(dataTransfer: DataTransfer) => string[]>(),
	getActiveNode: vi.fn<(mindMap: MindMap | null) => MindMapNode | null>(),
	getRenderRoot: vi.fn<(mindMap: MindMap | null) => MindMapNode | null>(),
	createAspectSetNodeImageOptions: vi.fn<
		(url: string | null) => Promise<{
			url: string;
			title: string;
			width: number;
			height: number;
			custom: boolean;
		}>
	>(),
}));

// Notice 桩替换：断言真实文案（obsidian 包无运行时 JS，alias 到 tests/mocks）
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		Notice: class {
			constructor(message?: string, timeout?: number) {
				noticeCalls.push(message ?? '');
				noticeTimeouts.push(timeout);
			}
		},
	};
});

vi.mock('../src/mindmap', () => ({
	ENGINE_COMMANDS: {
		INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
		SET_NODE_IMAGE: 'SET_NODE_IMAGE',
	},
	getActiveNode: (mindMap: MindMap | null): MindMapNode | null =>
		getActiveNode(mindMap),
	getRenderRoot: (mindMap: MindMap | null): MindMapNode | null =>
		getRenderRoot(mindMap),
}));

vi.mock('../src/features/view-node-actions', () => ({
	applyNodeImage: (
		view: MindMapViewContext,
		node: MindMapNode,
		url: string,
	): Promise<void> => applyNodeImage(view, node, url),
	applyNodeAttachment: (
		view: MindMapViewContext,
		node: MindMapNode,
		file: TFile,
	): void => {
		applyNodeAttachment(view, node, file);
	},
	applyDocWikiLink: (
		view: MindMapViewContext,
		node: MindMapNode,
		link: string,
		label: string | undefined,
		oldDisplay: string | null,
	): void => {
		applyDocWikiLink(view, node, link, label, oldDisplay);
	},
}));

vi.mock('../src/images-save', () => ({
	saveImageToVault: (
		options: SaveImageOptions,
	): Promise<TFile | null> => saveImageToVault(options),
}));

vi.mock('../src/links-resolve', () => ({
	resolveDroppedFile: (
		dataTransfer: DataTransfer,
		app: App,
	): TFile | null => resolveDroppedFile(dataTransfer, app),
	extractDroppedFileNames: (dataTransfer: DataTransfer): string[] =>
		extractDroppedFileNames(dataTransfer),
}));

// 图片尺寸探测在 Node 下无 DOM（Image 无法加载）：以固定尺寸桩替换
vi.mock('../src/images-path', () => ({
	createAspectSetNodeImageOptions: (url: string | null) =>
		createAspectSetNodeImageOptions(url),
}));

/** 画布桩：只实现模块用到的 addClass / removeClass / contains */
function makeCanvas(innerChild: object) {
	const classes = new Set<string>();
	return {
		classes,
		addClass: (name: string): void => {
			classes.add(name);
		},
		removeClass: (name: string): void => {
			classes.delete(name);
		},
		contains: (node: unknown): boolean => node === innerChild,
	};
}

/** 记录 onDom 注册的监听器，供测试按事件名触发 */
function makeEngineBinder() {
	const listeners = new Map<string, (event: DragEvent) => void>();
	const targets: unknown[] = [];
	return {
		onDom(
			target: unknown,
			type: string,
			listener: (event: DragEvent) => void,
		): void {
			targets.push(target);
			listeners.set(type, listener);
		},
		fire(type: string, event: DragEvent): void {
			listeners.get(type)?.(event);
		},
		types(): string[] {
			return Array.from(listeners.keys());
		},
		targets(): unknown[] {
			return targets;
		},
	};
}

/** 数据搬运桩：types / files / getData 为模块与 links-resolve 实际访问面 */
interface FakeDataTransfer {
	types: string[];
	files: File[];
	dropEffect: string;
	getData(type: string): string;
}

function makeDataTransfer(
	options: {
		types?: string[];
		files?: File[];
		data?: Record<string, string>;
	} = {},
): FakeDataTransfer {
	const data = options.data ?? {};
	return {
		types: options.types ?? [],
		files: options.files ?? [],
		dropEffect: 'none',
		getData: (type: string): string => data[type] ?? '',
	};
}

/** 拖拽事件桩（dataTransfer 传 null 模拟无数据搬运） */
function makeDragEvent(
	dataTransfer: FakeDataTransfer | null,
	relatedTarget: unknown = null,
) {
	const preventDefault = vi.fn();
	const stopPropagation = vi.fn();
	return {
		event: {
			dataTransfer: dataTransfer as unknown as DataTransfer,
			relatedTarget,
			preventDefault,
			stopPropagation,
		} as unknown as DragEvent,
		preventDefault,
		stopPropagation,
	};
}

function fakeFile(name: string, type: string, size = 1024): File {
	return { name, type, size } as unknown as File;
}

function fakeTFile(fields: {
	extension: string;
	name: string;
	basename: string;
	path: string;
}): TFile {
	// 用 Object.assign 而非断言：mock 的 TFile 类可实例化，避免 no-tfile-tfolder-cast
	return Object.assign(new TFile(), fields);
}

/** 节点桩：分发链只做身份传递，不访问节点内部 */
function fakeNode(): MindMapNode {
	return { isRoot: false } as unknown as MindMapNode;
}

function makeHarness(options: { canvas?: boolean } = {}) {
	const innerChild = {};
	const canvas = makeCanvas(innerChild);
	const binder = makeEngineBinder();
	const execCommand = vi.fn<
		(
			command: string,
			appointNodes: boolean,
			parents: MindMapNode[],
			data: Record<string, unknown>,
		) => void
	>();
	const getResourcePath = vi.fn<(file: TFile) => string>(
		(file) => `app://vault/${file.path}`,
	);
	const mindMap = { execCommand } as unknown as MindMap;
	const app = { vault: { getResourcePath } } as unknown as App;
	const view = {
		mindMap,
		engineEvents: binder as unknown as EventBinder,
		canvasEl:
			options.canvas === false ? null : (canvas as unknown as HTMLElement),
		app,
		lang: 'zh',
		file: null,
	} as unknown as MindMapViewContext;
	return { view, canvas, binder, execCommand, getResourcePath, innerChild };
}

/** 触发 drop：模块内 `void handleFileDrop(...).catch(...)`，故必须等异步落地 */
function fireDrop(
	binder: ReturnType<typeof makeEngineBinder>,
	dataTransfer: FakeDataTransfer,
) {
	const { event, preventDefault, stopPropagation } = makeDragEvent(
		dataTransfer,
	);
	binder.fire('drop', event);
	return { preventDefault, stopPropagation };
}

describe('setupDragAndDrop（画布监听注册）', () => {
	beforeEach(() => {
		noticeCalls.length = 0;
		noticeTimeouts.length = 0;
		applyNodeImage.mockReset();
		applyNodeAttachment.mockReset();
		applyDocWikiLink.mockReset();
		saveImageToVault.mockReset();
		resolveDroppedFile.mockReset();
		extractDroppedFileNames.mockReset();
		getActiveNode.mockReset();
		getRenderRoot.mockReset();
		// 默认：非库内文件、无激活节点、无根节点、保存失败
		saveImageToVault.mockResolvedValue(null);
		resolveDroppedFile.mockReturnValue(null);
		extractDroppedFileNames.mockReturnValue([]);
		getActiveNode.mockReturnValue(null);
		getRenderRoot.mockReturnValue(null);
		createAspectSetNodeImageOptions.mockImplementation((url) =>
			Promise.resolve({
				url: url ?? '',
				title: '',
				width: 100,
				height: 60,
				custom: true,
			}),
		);
	});

	it('canvasEl 为 null：不注册任何 DOM 监听', () => {
		const { view, binder } = makeHarness({ canvas: false });
		setupDragAndDrop(view);
		expect(binder.types()).toEqual([]);
	});

	it('canvasEl 存在：仅在画布上注册 dragover / dragleave / drop 三类监听', () => {
		const { view, binder, canvas } = makeHarness();
		setupDragAndDrop(view);
		expect(binder.types()).toEqual(['dragover', 'dragleave', 'drop']);
		// 三类监听全部挂在画布容器上（引擎重建时随 initMindMap 重新注册）
		expect(binder.targets()).toEqual([canvas, canvas, canvas]);
	});

	it('dragover：无文件类数据不拦截（不 preventDefault、不加高亮类）', () => {
		const { view, canvas, binder } = makeHarness();
		setupDragAndDrop(view);

		const dataTransfer = makeDataTransfer({ types: ['text/html'] });
		const { event, preventDefault, stopPropagation } =
			makeDragEvent(dataTransfer);
		binder.fire('dragover', event);

		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
		expect(dataTransfer.dropEffect).toBe('none');
	});

	it('dragover：files / text/plain / 含 file 的类型 → 拦截、加高亮类、dropEffect=link', () => {
		const cases: Array<{ label: string; dataTransfer: FakeDataTransfer }> = [
			{
				label: 'files.length > 0',
				dataTransfer: makeDataTransfer({
					files: [fakeFile('a.png', 'image/png')],
				}),
			},
			{
				label: 'types 含 text/plain',
				dataTransfer: makeDataTransfer({ types: ['text/plain'] }),
			},
			{
				label: 'types 含 file（大小写不敏感）',
				dataTransfer: makeDataTransfer({ types: ['application/X-FILES'] }),
			},
		];

		for (const item of cases) {
			const { view, canvas, binder } = makeHarness();
			setupDragAndDrop(view);
			const { event, preventDefault, stopPropagation } = makeDragEvent(
				item.dataTransfer,
			);
			binder.fire('dragover', event);

			expect(preventDefault, item.label).toHaveBeenCalledTimes(1);
			expect(stopPropagation, item.label).toHaveBeenCalledTimes(1);
			expect(canvas.classes.has('mindmap-drag-over'), item.label).toBe(true);
			expect(item.dataTransfer.dropEffect, item.label).toBe('link');
		}
	});

	it('dragleave：relatedTarget 在画布外移除高亮类，在画布内保留', () => {
		const { view, canvas, binder, innerChild } = makeHarness();
		setupDragAndDrop(view);

		// 画布内元素（引擎节点）间移动 → 高亮保留
		canvas.addClass('mindmap-drag-over');
		binder.fire('dragleave', makeDragEvent(null, innerChild).event);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(true);

		// 移出画布 → 移除高亮
		binder.fire('dragleave', makeDragEvent(null, {}).event);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
	});

	it('drop：无 dataTransfer 时早退（不 preventDefault、不触碰引擎、不抛异常）', () => {
		const { view, canvas, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		canvas.addClass('mindmap-drag-over');

		const { event, preventDefault, stopPropagation } = makeDragEvent(null);
		expect(() => binder.fire('drop', event)).not.toThrow();

		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		// 早退发生在移除高亮类之前 → 高亮类保留
		expect(canvas.classes.has('mindmap-drag-over')).toBe(true);
		expect(execCommand).not.toHaveBeenCalled();
		expect(resolveDroppedFile).not.toHaveBeenCalled();
	});

	it('库内图片 + 激活节点：applyNodeImage 挂图并提示文件名', async () => {
		const { view, canvas, binder, execCommand, getResourcePath } =
			makeHarness();
		setupDragAndDrop(view);
		const file = fakeTFile({
			extension: 'png',
			name: 'a.png',
			basename: 'a',
			path: 'assets/a.png',
		});
		const node = fakeNode();
		resolveDroppedFile.mockReturnValue(file);
		getActiveNode.mockReturnValue(node);

		canvas.addClass('mindmap-drag-over');
		const { preventDefault, stopPropagation } = fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }),
		);

		await vi.waitFor(() => {
			expect(applyNodeImage).toHaveBeenCalledWith(
				view,
				node,
				'app://vault/assets/a.png',
			);
		});
		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
		// 资源地址经 app.vault.getResourcePath 解析（非原始路径直传）
		expect(getResourcePath).toHaveBeenCalledWith(file);
		expect(noticeCalls).toEqual(['已设置节点图片：a.png']);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('库内图片无激活节点：不挂图，提示先选择节点', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		resolveDroppedFile.mockReturnValue(
			fakeTFile({
				extension: 'png',
				name: 'a.png',
				basename: 'a',
				path: 'assets/a.png',
			}),
		);
		getActiveNode.mockReturnValue(null);

		fireDrop(binder, makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }));

		await vi.waitFor(() => {
			expect(noticeCalls).toContain('请先选择一个节点，再拖入图片');
		});
		expect(noticeCalls).toEqual(['请先选择一个节点，再拖入图片']);
		expect(applyNodeImage).not.toHaveBeenCalled();
	});

	it('.md 文件：有激活节点走 applyDocWikiLink，无激活节点挂到根节点并写 mdWikiLinkpath', async () => {
		const file = fakeTFile({
			extension: 'md',
			name: '笔记.md',
			basename: '笔记',
			path: '笔记.md',
		});

		// 分支一：已选中主题 → 直接链接到该主题
		const active = makeHarness();
		setupDragAndDrop(active.view);
		const node = fakeNode();
		resolveDroppedFile.mockReturnValue(file);
		getActiveNode.mockReturnValue(node);

		fireDrop(
			active.binder,
			makeDataTransfer({ files: [fakeFile('笔记.md', 'text/markdown')] }),
		);

		await vi.waitFor(() => {
			expect(applyDocWikiLink).toHaveBeenCalledWith(
				active.view,
				node,
				'[[笔记]]',
				'笔记',
				null,
			);
		});
		expect(noticeCalls).toEqual(['已将节点链接到 [[笔记]]']);
		expect(active.execCommand).not.toHaveBeenCalled();

		// 分支二：未选中 → 根节点下新建节点，数据直接携带文档双链
		noticeCalls.length = 0;
		noticeTimeouts.length = 0;
		const rootHarness = makeHarness();
		setupDragAndDrop(rootHarness.view);
		const rootNode = fakeNode();
		getActiveNode.mockReturnValue(null);
		getRenderRoot.mockReturnValue(rootNode);

		fireDrop(
			rootHarness.binder,
			makeDataTransfer({ files: [fakeFile('笔记.md', 'text/markdown')] }),
		);

		await vi.waitFor(() => {
			expect(rootHarness.execCommand).toHaveBeenCalledWith(
				'INSERT_CHILD_NODE',
				false,
				[rootNode],
				{
					text: '笔记',
					mdWikiLinkpath: '[[笔记]]',
					mdLinkStyle: 'wiki',
					mdLinkText: '笔记',
					isActive: false,
				},
			);
		});
		expect(noticeCalls).toEqual(['已创建节点并链接到 [[笔记]]']);
	});

	it('可链接附件（.pdf）：有激活节点挂为节点附件，无激活节点携带附件数据挂到根节点', async () => {
		const file = fakeTFile({
			extension: 'pdf',
			name: '报告.pdf',
			basename: '报告',
			path: 'docs/报告.pdf',
		});

		// 分支一：已选中主题 → attachmentUrl 通道（回形针）
		const active = makeHarness();
		setupDragAndDrop(active.view);
		const node = fakeNode();
		resolveDroppedFile.mockReturnValue(file);
		getActiveNode.mockReturnValue(node);

		fireDrop(
			active.binder,
			makeDataTransfer({ files: [fakeFile('报告.pdf', 'application/pdf')] }),
		);

		await vi.waitFor(() => {
			expect(applyNodeAttachment).toHaveBeenCalledWith(active.view, node, file);
		});
		expect(noticeCalls).toEqual(['已将节点链接到 [[报告.pdf]]']);
		expect(active.execCommand).not.toHaveBeenCalled();

		// 分支二：未选中 → 根节点下新建节点，携带附件地址/名称/回写路径
		noticeCalls.length = 0;
		noticeTimeouts.length = 0;
		const rootHarness = makeHarness();
		setupDragAndDrop(rootHarness.view);
		const rootNode = fakeNode();
		getActiveNode.mockReturnValue(null);
		getRenderRoot.mockReturnValue(rootNode);

		fireDrop(
			rootHarness.binder,
			makeDataTransfer({ files: [fakeFile('报告.pdf', 'application/pdf')] }),
		);

		await vi.waitFor(() => {
			expect(rootHarness.execCommand).toHaveBeenCalledWith(
				'INSERT_CHILD_NODE',
				false,
				[rootNode],
				{
					text: '报告.pdf',
					attachmentUrl: 'app://vault/docs/报告.pdf',
					attachmentName: '报告.pdf',
					mdAttachmentLinkpath: 'docs/报告.pdf',
					mdLinkStyle: 'wiki',
					isActive: false,
				},
			);
		});
		expect(noticeCalls).toEqual(['已创建节点并链接到 [[报告.pdf]]']);
	});

	it('不支持的扩展名（.docx）：不触碰引擎与挂载函数，提示仅支持笔记/图片', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		resolveDroppedFile.mockReturnValue(
			fakeTFile({
				extension: 'docx',
				name: '合同.docx',
				basename: '合同',
				path: 'docs/合同.docx',
			}),
		);
		// 即使有激活节点也不挂载（扩展名不支持）
		getActiveNode.mockReturnValue(fakeNode());

		fireDrop(
			binder,
			makeDataTransfer({
				files: [
					fakeFile(
						'合同.docx',
						'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					),
				],
			}),
		);

		await vi.waitFor(() => {
			expect(noticeCalls).toEqual(['不支持的文件类型（仅支持笔记、图片与可链接的附件）']);
		});
		expect(applyNodeImage).not.toHaveBeenCalled();
		expect(applyNodeAttachment).not.toHaveBeenCalled();
		expect(applyDocWikiLink).not.toHaveBeenCalled();
	});

	it('无库内文件 → 外部图片导入：保存后按资源地址挂图，并给出导入/汇总提示', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		const imageFile = fakeFile('photo.png', 'image/png');
		const saved = fakeTFile({
			extension: 'png',
			name: 'photo.png',
			basename: 'photo',
			path: 'attachments/photo.png',
		});
		resolveDroppedFile.mockReturnValue(null);
		getActiveNode.mockReturnValue(node);
		saveImageToVault.mockResolvedValue(saved);

		fireDrop(binder, makeDataTransfer({ files: [imageFile] }));

		await vi.waitFor(() => {
			expect(applyNodeImage).toHaveBeenCalledWith(
				view,
				node,
				'app://vault/attachments/photo.png',
			);
		});
		// sourcePath 取视图文件路径（无文件时为 ''），上限取自 MAX_IMAGE_SIZE_MB
		expect(saveImageToVault).toHaveBeenCalledWith({
			app: view.app,
			sourcePath: '',
			file: imageFile,
			maxSizeMB: 10,
			preferredName: undefined,
			lang: 'zh',
		});
		expect(noticeCalls).toEqual([
			'正在导入 1 张图片到仓库中…',
			'已设置节点图片：photo.png',
			'已导入 1 张图片（存放路径遵循「附件默认存放路径」设置）',
		]);
		expect(noticeTimeouts).toEqual([undefined, undefined, 5000]);
	});

	it('外部图片导入：数量一致时按序使用 uri-list 解出的真实文件名，不一致则全部放弃', async () => {
		const saved = fakeTFile({
			extension: 'png',
			name: '图.png',
			basename: '图',
			path: 'attachments/图.png',
		});

		// 数量一致 → 真实文件名作为 preferredName（修复 Windows 下 File.name 乱码）
		const matched = makeHarness();
		setupDragAndDrop(matched.view);
		getActiveNode.mockReturnValue(fakeNode());
		saveImageToVault.mockResolvedValue(saved);
		extractDroppedFileNames.mockReturnValue(['真实名.png']);

		fireDrop(
			matched.binder,
			makeDataTransfer({ files: [fakeFile('????.png', 'image/png')] }),
		);
		await vi.waitFor(() => {
			expect(saveImageToVault).toHaveBeenCalledTimes(1);
		});
		expect(saveImageToVault.mock.calls[0]?.[0].preferredName).toBe(
			'真实名.png',
		);

		// 数量不一致 → 不按序对应，避免文件名错位（preferredName 全为 undefined）
		saveImageToVault.mockClear();
		extractDroppedFileNames.mockReturnValue(['只有一个.png']);
		fireDrop(
			matched.binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);
		await vi.waitFor(() => {
			expect(saveImageToVault).toHaveBeenCalledTimes(2);
		});
		expect(
			saveImageToVault.mock.calls.map((call) => call[0].preferredName),
		).toEqual([undefined, undefined]);
	});

	it('外部拖入无图片文件：提示仅支持图片 + 未识别到图片（8s 超时，不含拖拽载荷），不保存', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		resolveDroppedFile.mockReturnValue(null);
		const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

		fireDrop(
			binder,
			makeDataTransfer({
				types: ['text/plain'],
				files: [fakeFile('a.txt', 'text/plain')],
				data: { 'text/plain': 'hello' },
			}),
		);

		await vi.waitFor(() => {
			expect(noticeCalls).toContain('未识别到图片文件');
		});
		// 面向用户的提示不含原始 MIME/载荷；诊断信息只进控制台
		expect(noticeCalls).toEqual([
			'外部拖入仅支持图片文件',
			'未识别到图片文件',
		]);
		expect(noticeTimeouts).toEqual([undefined, 8000]);
		expect(debugSpy).toHaveBeenCalled();
		expect(saveImageToVault).not.toHaveBeenCalled();
		expect(applyNodeImage).not.toHaveBeenCalled();
		debugSpy.mockRestore();
	});

	it('外部图片但未选中主题：提示先选择节点，不保存图片', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		resolveDroppedFile.mockReturnValue(null);
		getActiveNode.mockReturnValue(null);

		fireDrop(binder, makeDataTransfer({ files: [fakeFile('photo.png', 'image/png')] }));

		await vi.waitFor(() => {
			expect(noticeCalls).toContain('请先选择一个节点，再拖入图片');
		});
		expect(noticeCalls).toEqual(['请先选择一个节点，再拖入图片']);
		expect(saveImageToVault).not.toHaveBeenCalled();
		expect(applyNodeImage).not.toHaveBeenCalled();
	});

	it('多图拖入：首张挂所选节点，其余各新建子节点（不再覆盖同一节点）', async () => {
		const { view, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		const first = fakeTFile({
			extension: 'png',
			name: 'a.png',
			basename: 'a',
			path: 'attachments/a.png',
		});
		const second = fakeTFile({
			extension: 'png',
			name: 'b.png',
			basename: 'b',
			path: 'attachments/b.png',
		});
		resolveDroppedFile.mockReturnValue(null);
		getActiveNode.mockReturnValue(node);
		saveImageToVault
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);

		fireDrop(
			binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);

		await vi.waitFor(() => {
			expect(execCommand).toHaveBeenCalledWith(
				'INSERT_CHILD_NODE',
				false,
				[node],
				expect.anything(),
			);
		});
		// 首张保持单图拖入的原行为：挂到所选节点
		expect(applyNodeImage).toHaveBeenCalledTimes(1);
		expect(applyNodeImage).toHaveBeenCalledWith(
			view,
			node,
			'app://vault/attachments/a.png',
		);
		// 其余各建一个承载图片的子节点（图片独占语义：无文本 + 引擎渲染字段 + 回写目标）
		expect(execCommand).toHaveBeenCalledTimes(1);
		expect(execCommand).toHaveBeenCalledWith('INSERT_CHILD_NODE', false, [node], {
			text: '',
			image: 'app://vault/attachments/b.png',
			imageTitle: '',
			imageSize: { width: 100, height: 60, custom: true },
			mdImageTarget: 'attachments/b.png',
			isActive: false,
		});
		// 不再逐张弹「已设置节点图片」：单条汇总提示带归属说明
		expect(noticeCalls).toEqual([
			'正在导入 2 张图片到仓库中…',
			'已导入 2 张图片（存放路径遵循「附件默认存放路径」设置）\n1 张挂到所选节点，其余各新建为子节点',
		]);
	});

	it('逐张容错：单张保存失败不中断其余导入，并给出失败提示', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		const second = fakeTFile({
			extension: 'png',
			name: 'b.png',
			basename: 'b',
			path: 'attachments/b.png',
		});
		resolveDroppedFile.mockReturnValue(null);
		getActiveNode.mockReturnValue(node);
		saveImageToVault
			.mockRejectedValueOnce(new Error('磁盘已满'))
			.mockResolvedValueOnce(second);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		fireDrop(
			binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);

		await vi.waitFor(() => {
			expect(applyNodeImage).toHaveBeenCalledWith(
				view,
				node,
				'app://vault/attachments/b.png',
			);
		});
		// 失败逐项上报（不吞错），成功的仍然挂上
		expect(noticeCalls).toContain('部分图片导入失败：磁盘已满');
		expect(noticeCalls).toContain('已设置节点图片：b.png');
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
