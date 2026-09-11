/**
 * view-dnd 回归测试：画布拖拽监听的注册与拦截、库内文件（图片/笔记/附件）
 * 与外部图片导入的分发编排，以及「导入附件目录 vs 直接引用库内文件」的分流边界。
 *
 * 模块只导出 setupDragAndDrop；handleFileDrop / handleDroppedVaultFile /
 * handleDroppedDocument / handleDroppedAttachment / handleExternalFilesDrop /
 * insertImageChildNode 均为私有。本测试用「记录式 onDom 桩」捕获
 * setupDragAndDrop 注册的三类 DOM 监听器，再按事件名触发以驱动私有分发链
 * （Node 环境无真实 DOM，画布/拖拽事件用最小假对象，只实现模块实际访问到的面）。
 *
 * 断言取向：不照搬文案原文，而是用 t(lang, key) 取真实字典值后按模块的拼接
 * 方式组合——文案内容属实现细节，但「前缀 + 文件名 / 数字 + 单位 / 换行分段」
 * 这类拼接形态是模块行为，必须钉住。语言维度另用 en 跑一遍，证明 lang 一路
 * 透传到提示与图片入库入参。
 *
 * 分流边界的两条主干：
 * - 引用（库内已有文件）：resolveDroppedFile 命中 TFile → 只写节点数据，
 *   绝不调用 saveImageToVault（不复制、不新写文件）；
 * - 导入（外部文件）：resolveDroppedFile 未命中且 files 含 image/* →
 *   saveImageToVault 入库后再按资源地址挂图。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import { TFile as TFileClass } from 'obsidian';
import type { EventBinder } from '../src/event-binder';
import type { SaveImageOptions } from '../src/images-save';
import type { Language, TranslationKey } from '../src/i18n';
import { t } from '../src/i18n';
import { formatWikilink } from '../src/domain/wikilink';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import { setupDragAndDrop } from '../src/features/view-dnd';

const h = vi.hoisted(() => ({
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

// Notice 桩：obsidian 包无运行时 JS（alias 到 tests/mocks），故在此替换以捕获文案。
// 注意 notifyError（src/errors.ts）也 new Notice，故错误提示同样落在 noticeCalls。
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		Notice: class {
			constructor(message?: string, timeout?: number) {
				h.noticeCalls.push(message ?? '');
				h.noticeTimeouts.push(timeout);
			}
		},
	};
});

// 引擎模块整体以桩替换（真实模块会拉入 vendor 打包产物）。
// ENGINE_COMMANDS 的取值与 src/mindmap.ts 一致——断言用它证明插入走的是
// 「命令名常量表」而非散落的魔法字符串。
vi.mock('../src/mindmap', () => ({
	ENGINE_COMMANDS: {
		INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
		SET_NODE_IMAGE: 'SET_NODE_IMAGE',
	},
	getActiveNode: (mindMap: MindMap | null): MindMapNode | null =>
		h.getActiveNode(mindMap),
	getRenderRoot: (mindMap: MindMap | null): MindMapNode | null =>
		h.getRenderRoot(mindMap),
}));

// 节点挂载动作（图片/附件/文档双链）以桩替换：本文件只验证「分发到哪个函数、
// 入参是什么」，三者内部写数据的形态由 view-node-actions 自己的用例覆盖。
vi.mock('../src/features/view-node-actions', () => ({
	applyNodeImage: (
		view: MindMapViewContext,
		node: MindMapNode,
		url: string,
	): Promise<void> => h.applyNodeImage(view, node, url),
	applyNodeAttachment: (
		view: MindMapViewContext,
		node: MindMapNode,
		file: TFile,
	): void => {
		h.applyNodeAttachment(view, node, file);
	},
	applyDocWikiLink: (
		view: MindMapViewContext,
		node: MindMapNode,
		link: string,
		label: string | undefined,
	): void => {
		h.applyDocWikiLink(view, node, link, label);
	},
}));

// 图片入库以桩替换：断言入参（sourcePath / preferredName / lang / 上限）与
// 「是否发生写入」这一分流判据；真实入库链（串行队列、重名兜底）另有用例。
vi.mock('../src/images-save', () => ({
	saveImageToVault: (options: SaveImageOptions): Promise<TFile | null> =>
		h.saveImageToVault(options),
}));

vi.mock('../src/links-resolve', () => ({
	resolveDroppedFile: (
		dataTransfer: DataTransfer,
		app: App,
	): TFile | null => h.resolveDroppedFile(dataTransfer, app),
	extractDroppedFileNames: (dataTransfer: DataTransfer): string[] =>
		h.extractDroppedFileNames(dataTransfer),
}));

// 图片尺寸探测要真实解码（Node 下 Image 不可用）：以固定尺寸桩替换，
// 用来断言 imageSize 三个字段确实来自探测结果而非写死。
vi.mock('../src/images-path', () => ({
	createAspectSetNodeImageOptions: (url: string | null) =>
		h.createAspectSetNodeImageOptions(url),
}));

/** 引擎插入命令名（与 vi.mock 提供的常量表一致） */
const INSERT_CHILD_NODE = 'INSERT_CHILD_NODE';
/** 尺寸探测桩返回的标题：非空值才能证明 imageTitle 是从探测结果透传的 */
const ASPECT_TITLE = '探测标题';
/** 尺寸探测桩返回的尺寸：非默认值才能证明不是写死的 */
const ASPECT_SIZE = { width: 100, height: 60, custom: true } as const;
const ZH: Language = 'zh';

// ---- 期望文案构造：字典值走 t()，拼接形态按模块实现复刻 ----

/** `已设置节点图片：` + 文件名（前缀与文件名之间无分隔符是模块行为） */
function imageSetOnNode(lang: Language, name: string): string {
	return `${t(lang, 'common.imageSetOnNode')}${name}`;
}

/** `已将节点链接到` + ` [[名]]` */
function linkedTo(lang: Language, name: string): string {
	return `${t(lang, 'common.linkedTo')} [[${name}]]`;
}

/** `已创建节点并链接到` + ` [[名]]` */
function createdAndLinked(lang: Language, name: string): string {
	return `${t(lang, 'common.nodeCreatedAndLinked')} [[${name}]]`;
}

/** `正在导入` + 空格 + 数量 + 空格 + `张图片到仓库中…` */
function importingToVault(lang: Language, count: number): string {
	return `${t(lang, 'common.importing')} ${count} ${t(lang, 'common.imagesToVault')}`;
}

/** `已导入` + 数量 + `张图片（存放路径…）` */
function importedSummary(lang: Language, count: number): string {
	return `${t(lang, 'common.imported')} ${count} ${t(lang, 'common.imagesStored')}`;
}

/** 多图汇总：在单行汇总后换行追加归属说明 */
function importedWithPlacement(lang: Language, count: number): string {
	return `${importedSummary(lang, count)}\n${t(lang, 'common.imagesPlaced')}`;
}

/** `部分图片导入失败：` + 错误消息 */
function importImageFailed(lang: Language, message: string): string {
	return `${t(lang, 'common.importImageFailed')}${message}`;
}

/** `处理拖入文件失败：` + 错误消息（drop 层兜底） */
function dropFailed(lang: Language, message: string): string {
	return `${t(lang, 'common.dropFailed')}${message}`;
}

function textOf(lang: Language, key: TranslationKey): string {
	return t(lang, key);
}

// ---- 桩件 ----

/** 画布桩：只实现模块用到的 addClass / removeClass / contains */
function makeCanvas(innerChild: object) {
	const classes = new Set<string>();
	return {
		classes,
		addClass(name: string): void {
			classes.add(name);
		},
		removeClass(name: string): void {
			classes.delete(name);
		},
		contains(node: unknown): boolean {
			return node === innerChild;
		},
	};
}

type DomListener = (event: DragEvent) => void;

/** 记录 onDom 注册的监听器，供测试按事件名触发 */
function makeEngineBinder() {
	const listeners = new Map<string, DomListener>();
	const targets: unknown[] = [];
	return {
		onDom(target: unknown, type: string, listener: DomListener): void {
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

/**
 * @param options.getDataThrows 指定类型读取即抛错（真实浏览器对个别自定义
 *   类型会拒绝 getData），用于覆盖诊断分支的容错。
 */
function makeDataTransfer(
	options: {
		types?: string[];
		files?: File[];
		data?: Record<string, string>;
		getDataThrows?: string[];
	} = {},
): FakeDataTransfer {
	const data = options.data ?? {};
	const throwing = new Set(options.getDataThrows ?? []);
	return {
		types: options.types ?? [],
		files: options.files ?? [],
		dropEffect: 'none',
		getData(type: string): string {
			if (throwing.has(type)) {
				throw new Error(`读不到 ${type}`);
			}
			return data[type] ?? '';
		},
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

/** 系统拖入的文件桩：分发链只读 name/type/size（arrayBuffer 不需要，入库被桩替换） */
function fakeFile(name: string, type: string, size = 1024): File {
	return { name, type, size } as unknown as File;
}

/** 用 Object.assign 而非类型断言：mock 的 TFile 类可实例化，避免 no-tfile-tfolder-cast */
function fakeTFile(fields: {
	extension: string;
	name: string;
	basename: string;
	path: string;
}): TFile {
	return Object.assign(new TFileClass(), fields);
}

/** 节点桩：分发链只做身份传递，不访问节点内部 */
function fakeNode(): MindMapNode {
	return { isRoot: false } as unknown as MindMapNode;
}

/** 可变视图面：readonly 的 mindMap 需在测试内替换以模拟「换文件 / 引擎重建」 */
interface MutableView {
	mindMap: MindMap | null;
	engineEvents: EventBinder;
	canvasEl: HTMLElement | null;
	app: App;
	lang: Language;
	file: TFile | null;
}

function makeHarness(
	options: { canvas?: boolean; lang?: Language; file?: TFile | null } = {},
) {
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
	const mutable: MutableView = {
		mindMap,
		engineEvents: binder as unknown as EventBinder,
		canvasEl:
			options.canvas === false ? null : (canvas as unknown as HTMLElement),
		app,
		lang: options.lang ?? ZH,
		file: options.file ?? null,
	};
	const view = mutable as unknown as MindMapViewContext;
	return {
		view,
		mutable,
		canvas,
		binder,
		execCommand,
		getResourcePath,
		mindMap,
		innerChild,
	};
}

type Harness = ReturnType<typeof makeHarness>;

/**
 * 让 drop 处理链落地：模块内是 `void handleFileDrop(...).catch(...)`，
 * 无法直接 await；处理链含多次已决议 Promise 与「异步函数内的顺序 await」，
 * 故按宏任务轮次冲洗若干次，保证断言在链尾之后执行。
 * 走 window.setTimeout（插件运行于 Electron 渲染进程，setup.ts 把 window 指向
 * globalThis），与生产代码的定时器出口一致。
 */
async function settle(): Promise<void> {
	for (let round = 0; round < 5; round++) {
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 0);
		});
	}
}

/** 触发 drop 并等分发链落地 */
async function fireDrop(
	binder: Harness['binder'],
	dataTransfer: FakeDataTransfer,
) {
	const { event, preventDefault, stopPropagation } = makeDragEvent(dataTransfer);
	binder.fire('drop', event);
	await settle();
	return { preventDefault, stopPropagation };
}

/** 取第 index 次 saveImageToVault 的入参（缺调用即失败，避免可选链掩盖问题） */
function savedCall(index: number): SaveImageOptions {
	const call = h.saveImageToVault.mock.calls[index];
	if (!call) {
		throw new Error(`第 ${index} 次 saveImageToVault 未发生`);
	}
	return call[0];
}

/** console 桩的调用实参拍平为字符串（断言诊断输出而不泄漏 any） */
function consoleArgs(spy: { mock: { calls: unknown[][] } }): string[][] {
	return spy.mock.calls.map((call) => call.map((value) => String(value)));
}

/** 图片扩展名（constants.IMAGE_EXTENSIONS，另附大小写变体） */
const IMAGE_EXTENSIONS = [
	'png',
	'jpg',
	'jpeg',
	'gif',
	'svg',
	'webp',
	'bmp',
	'ico',
] as const;

/** 可链接附件扩展名（constants.LINK_ATTACHMENT_EXTENSIONS 的抽样） */
const ATTACHMENT_EXTENSIONS = [
	'pdf',
	'epub',
	'zip',
	'mp3',
	'mp4',
	'wav',
	'mkv',
	'mov',
	'avi',
	'flac',
	'3gp',
	'opus',
	'm4a',
	'webm',
	'ogg',
	'wmv',
] as const;

/** 三类都不匹配 → 拒绝（无法写回 Markdown） */
const UNSUPPORTED_FILES: Array<{ extension: string; name: string }> = [
	{ extension: 'docx', name: '合同.docx' },
	{ extension: 'txt', name: '说明.txt' },
	{ extension: 'csv', name: '表格.csv' },
	{ extension: 'exe', name: '工具.exe' },
	// .mindmap 自身既非图片、非 md、也非可链接附件（走不到任何写回通道）
	{ extension: 'mindmap', name: '另一张.mindmap' },
	// 无扩展名：Obsidian 的 TFile.extension 为空串
	{ extension: '', name: 'README' },
];

describe('setupDragAndDrop：画布监听注册与事件拦截', () => {
	beforeEach(() => {
		resetHarnessMocks();
	});

	it('canvasEl 为 null：不注册任何 DOM 监听', () => {
		const { view, binder } = makeHarness({ canvas: false });
		setupDragAndDrop(view);
		expect(binder.types()).toEqual([]);
		expect(binder.targets()).toEqual([]);
	});

	it('canvasEl 存在：仅在画布上注册 dragover / dragleave / drop 三类监听', () => {
		const { view, binder, canvas } = makeHarness();
		setupDragAndDrop(view);
		expect(binder.types()).toEqual(['dragover', 'dragleave', 'drop']);
		// 三类监听全部挂在画布容器上（引擎重建时随 initMindMap 重新注册）
		expect(binder.targets()).toEqual([canvas, canvas, canvas]);
	});

	it('dragover：无 dataTransfer 时早退，不拦截', () => {
		const { view, binder, canvas } = makeHarness();
		setupDragAndDrop(view);
		const { event, preventDefault, stopPropagation } = makeDragEvent(null);

		expect(() => binder.fire('dragover', event)).not.toThrow();
		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
	});

	it('dragover：有文件类数据才拦截（表驱动三形态命中 / 一形态放行）', () => {
		const cases: Array<{
			label: string;
			dataTransfer: FakeDataTransfer;
			expectHit: boolean;
		}> = [
			{
				label: 'files.length > 0',
				dataTransfer: makeDataTransfer({
					files: [fakeFile('a.png', 'image/png')],
				}),
				expectHit: true,
			},
			{
				label: 'types 含 text/plain',
				dataTransfer: makeDataTransfer({ types: ['text/plain'] }),
				expectHit: true,
			},
			{
				label: 'types 含 file（大小写不敏感，浏览器报 Files）',
				dataTransfer: makeDataTransfer({ types: ['Files'] }),
				expectHit: true,
			},
			{
				label: '只有 text/html（非文件类数据）',
				dataTransfer: makeDataTransfer({ types: ['text/html'] }),
				expectHit: false,
			},
		];

		for (const item of cases) {
			const { view, binder, canvas } = makeHarness();
			setupDragAndDrop(view);
			const { event, preventDefault, stopPropagation } = makeDragEvent(
				item.dataTransfer,
			);
			binder.fire('dragover', event);

			expect(preventDefault, item.label).toHaveBeenCalledTimes(
				item.expectHit ? 1 : 0,
			);
			expect(stopPropagation, item.label).toHaveBeenCalledTimes(
				item.expectHit ? 1 : 0,
			);
			expect(canvas.classes.has('mindmap-drag-over'), item.label).toBe(
				item.expectHit,
			);
			expect(item.dataTransfer.dropEffect, item.label).toBe(
				item.expectHit ? 'link' : 'none',
			);
		}
	});

	it('dragleave：relatedTarget 在画布外移除高亮类，在画布内保留', () => {
		const { view, canvas, binder, innerChild } = makeHarness();
		setupDragAndDrop(view);
		canvas.addClass('mindmap-drag-over');

		// 画布内元素（引擎节点）之间移动 → 高亮保留
		binder.fire('dragleave', makeDragEvent(null, innerChild).event);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(true);

		// 移出画布（relatedTarget 为画布外元素）→ 移除高亮
		binder.fire('dragleave', makeDragEvent(null, {}).event);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
	});

	it('drop：无 dataTransfer 时早退（不拦截、不触碰引擎，高亮类保留）', async () => {
		const { view, canvas, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		canvas.addClass('mindmap-drag-over');

		const { event, preventDefault, stopPropagation } = makeDragEvent(null);
		expect(() => binder.fire('drop', event)).not.toThrow();
		await settle();

		expect(preventDefault).not.toHaveBeenCalled();
		expect(stopPropagation).not.toHaveBeenCalled();
		// 早退发生在 removeClass 之前 → 高亮类保留（拖拽中画面不会被清掉）
		expect(canvas.classes.has('mindmap-drag-over')).toBe(true);
		expect(h.resolveDroppedFile).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('drop：正常路径拦截并清高亮；分发链异常时按 notifyError 兜底提示', async () => {
		const { view, canvas, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		canvas.addClass('mindmap-drag-over');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
			// 静默：错误路径本身就是要断言的输出
		});
		const boom = new Error('解析炸了');
		h.resolveDroppedFile.mockImplementation(() => {
			throw boom;
		});

		const { preventDefault, stopPropagation } = await fireDrop(
			binder,
			makeDataTransfer({ types: ['text/plain'], data: { 'text/plain': 'x' } }),
		);

		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(stopPropagation).toHaveBeenCalledTimes(1);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
		// 分发链异常不外泄：控制台留诊断 + 用户可见提示（走 errors.notifyError）
		expect(consoleArgs(errorSpy)).toEqual([
			['处理拖入文件失败', 'Error: 解析炸了'],
		]);
		expect(h.noticeCalls).toEqual([dropFailed(ZH, '解析炸了')]);
		expect(execCommand).not.toHaveBeenCalled();
	});
});

describe('库内文件拖入：分发分支', () => {
	beforeEach(() => {
		resetHarnessMocks();
	});

	it('库内图片（表驱动扩展名，含大小写变体）+ 有激活节点：直接引用并挂图', async () => {
		const cases = [
			...IMAGE_EXTENSIONS.map((extension) => ({
				extension,
				name: `a.${extension}`,
			})),
			{ extension: 'PNG', name: 'b.PNG' },
			{ extension: 'JpEg', name: 'c.JpEg' },
			{ extension: 'SVG', name: 'd.SVG' },
		];

		for (const item of cases) {
			resetHarnessMocks();
			const { view, binder, execCommand, getResourcePath } = makeHarness();
			setupDragAndDrop(view);
			const file = fakeTFile({
				extension: item.extension,
				name: item.name,
				basename: item.name.replace(/\.[^.]+$/, ''),
				path: `assets/${item.name}`,
			});
			const node = fakeNode();
			h.resolveDroppedFile.mockReturnValue(file);
			h.getActiveNode.mockReturnValue(node);

			await fireDrop(
				binder,
				makeDataTransfer({ files: [fakeFile(item.name, 'image/png')] }),
			);

			// 引用分支：只写节点数据，绝不入库（不复制文件）
			expect(h.applyNodeImage, item.name).toHaveBeenCalledWith(
				view,
				node,
				`app://vault/assets/${item.name}`,
			);
			expect(getResourcePath, item.name).toHaveBeenCalledWith(file);
			expect(h.noticeCalls, item.name).toEqual([
				imageSetOnNode(ZH, item.name),
			]);
			expect(h.saveImageToVault, item.name).not.toHaveBeenCalled();
			// 图片分支早退：不查根节点、不插入子节点
			expect(h.getRenderRoot, item.name).not.toHaveBeenCalled();
			expect(execCommand, item.name).not.toHaveBeenCalled();
		}
	});

	it('库内图片 + 无激活节点：提示先选择节点，不挂图不插入', async () => {
		const { view, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		h.resolveDroppedFile.mockReturnValue(
			fakeTFile({
				extension: 'png',
				name: 'a.png',
				basename: 'a',
				path: 'assets/a.png',
			}),
		);
		h.getActiveNode.mockReturnValue(null);

		await fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }),
		);

		expect(h.noticeCalls).toEqual([textOf(ZH, 'common.selectNodeBeforeDrop')]);
		expect(h.applyNodeImage).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
		expect(h.saveImageToVault).not.toHaveBeenCalled();
		// 图片分支不查根节点（有节点与否都走「先选择节点」提示）
		expect(h.getRenderRoot).not.toHaveBeenCalled();
	});

	it('可链接附件（表驱动扩展名）：选中走回形针通道，未选中在根节点下新建并携带附件数据', async () => {
		for (const extension of ATTACHMENT_EXTENSIONS) {
			resetHarnessMocks();
			const name = `报告.${extension}`;

			// 分支一：已选中主题 → applyNodeAttachment（attachmentUrl 通道）
			const active = makeHarness();
			setupDragAndDrop(active.view);
			const activeFile = fakeTFile({
				extension,
				name,
				basename: '报告',
				path: `docs/${name}`,
			});
			const node = fakeNode();
			h.resolveDroppedFile.mockReturnValue(activeFile);
			h.getActiveNode.mockReturnValue(node);

			await fireDrop(
				active.binder,
				makeDataTransfer({
					files: [fakeFile(name, 'application/octet-stream')],
				}),
			);

			expect(h.applyNodeAttachment, extension).toHaveBeenCalledWith(
				active.view,
				node,
				activeFile,
			);
			expect(h.noticeCalls, extension).toEqual([linkedTo(ZH, name)]);
			expect(active.execCommand, extension).not.toHaveBeenCalled();
			expect(h.saveImageToVault, extension).not.toHaveBeenCalled();

			// 分支二：未选中 → 根节点下新建节点，初始数据直接携带附件三元组
			resetNotices();
			const rootHarness = makeHarness();
			setupDragAndDrop(rootHarness.view);
			const rootNode = fakeNode();
			h.getActiveNode.mockReturnValue(null);
			h.getRenderRoot.mockReturnValue(rootNode);

			await fireDrop(
				rootHarness.binder,
				makeDataTransfer({
					files: [fakeFile(name, 'application/octet-stream')],
				}),
			);

			expect(rootHarness.execCommand, extension).toHaveBeenCalledWith(
				INSERT_CHILD_NODE,
				false,
				[rootNode],
				{
					text: name,
					attachmentUrl: `app://vault/docs/${name}`,
					attachmentName: name,
					// 回写用完整库内路径（basename 会被 Obsidian 去掉扩展名）
					mdAttachmentLinkpath: `docs/${name}`,
					mdLinkStyle: 'wiki',
					isActive: false,
				},
			);
			expect(h.applyNodeAttachment, extension).toHaveBeenCalledTimes(1);
			expect(h.noticeCalls, extension).toEqual([createdAndLinked(ZH, name)]);
			// 零入库：附件是库内既有文件，不复制
			expect(h.saveImageToVault, extension).not.toHaveBeenCalled();
		}
	});

	it('不支持的库内文件（表驱动）：不触碰引擎与挂载函数，只提示支持范围', async () => {
		for (const item of UNSUPPORTED_FILES) {
			resetHarnessMocks();
			const { view, binder, execCommand } = makeHarness();
			setupDragAndDrop(view);
			h.resolveDroppedFile.mockReturnValue(
				fakeTFile({
					extension: item.extension,
					name: item.name,
					basename: item.name.replace(/\.[^.]+$/, ''),
					path: `docs/${item.name}`,
				}),
			);
			// 即使有激活节点也不挂载（扩展名分流在节点判断之前）
			h.getActiveNode.mockReturnValue(fakeNode());

			await fireDrop(
				binder,
				makeDataTransfer({
					files: [fakeFile(item.name, 'application/octet-stream')],
				}),
			);

			expect(h.noticeCalls, item.name).toEqual([
				textOf(ZH, 'common.onlySupportedFiles'),
			]);
			expect(h.applyNodeImage, item.name).not.toHaveBeenCalled();
			expect(h.applyNodeAttachment, item.name).not.toHaveBeenCalled();
			expect(h.applyDocWikiLink, item.name).not.toHaveBeenCalled();
			expect(execCommand, item.name).not.toHaveBeenCalled();
		}
	});

	it('库内 .md（表驱动：basename / 扩展名大小写）：选中走文档双链通道，未选中在根节点下新建并写 mdWikiLinkpath', async () => {
		const cases = [
			{ basename: '笔记', extension: 'md' },
			{ basename: 'Meeting Notes', extension: 'md' },
			{ basename: '报告.v2', extension: 'md' },
			// 扩展名大小写不敏感：.MD 仍走文档分支而非落进「不支持」拒绝
			{ basename: '大小写', extension: 'MD' },
			// 官方文档类文件（Canvas / Bases）：同走文档分支
			{ basename: '画布', extension: 'canvas' },
			{ basename: '看板', extension: 'base' },
		];

		for (const item of cases) {
			resetHarnessMocks();
			const { basename, extension } = item;
			const name = `${basename}.${extension}`;
			// 文档链接目标：md 省略扩展名（[[笔记]]），canvas/base 必须带扩展名
			const target = extension.toLowerCase() === 'md' ? basename : name;

			// 分支一：已选中主题 → applyDocWikiLink（自绘文档图标通道，不写 hyperlink）
			const active = makeHarness();
			setupDragAndDrop(active.view);
			const file = fakeTFile({
				extension,
				name,
				basename,
				path: name,
			});
			const node = fakeNode();
			h.resolveDroppedFile.mockReturnValue(file);
			h.getActiveNode.mockReturnValue(node);

			await fireDrop(
				active.binder,
				makeDataTransfer({ files: [fakeFile(name, 'text/markdown')] }),
			);

			expect(h.applyDocWikiLink, name).toHaveBeenCalledWith(
				active.view,
				node,
				formatWikilink(target),
				target,
			);
			// 文档分支用「链接目标」作可见名（md 去扩展名 / canvas·base 带扩展名），
			// 与附件分支一律用全名相对
			expect(h.noticeCalls, name).toEqual([linkedTo(ZH, target)]);
			expect(active.execCommand, name).not.toHaveBeenCalled();
			// 资源地址在分支判定之前无条件解析（md 分支不消费该结果）：
			// 只写双链通道，不落图片/附件语义
			expect(active.getResourcePath, name).toHaveBeenCalledWith(file);
			expect(h.applyNodeImage, name).not.toHaveBeenCalled();
			expect(h.applyNodeAttachment, name).not.toHaveBeenCalled();

			// 分支二：未选中 → 根节点下新建节点并携带双链三元组
			resetNotices();
			const rootHarness = makeHarness();
			setupDragAndDrop(rootHarness.view);
			const rootNode = fakeNode();
			h.getActiveNode.mockReturnValue(null);
			h.getRenderRoot.mockReturnValue(rootNode);

			await fireDrop(
				rootHarness.binder,
				makeDataTransfer({ files: [fakeFile(name, 'text/markdown')] }),
			);

			expect(rootHarness.execCommand, name).toHaveBeenCalledWith(
				INSERT_CHILD_NODE,
				false,
				[rootNode],
				{
					text: target,
					mdWikiLinkpath: formatWikilink(target),
					mdLinkStyle: 'wiki',
					mdLinkText: target,
					isActive: false,
				},
			);
			expect(h.applyDocWikiLink, name).toHaveBeenCalledTimes(1);
			expect(h.noticeCalls, name).toEqual([createdAndLinked(ZH, target)]);
		}
	});

	it('多文件载荷但只解析出一个库内文件：只分发一次，不逐文件重复处理', async () => {
		resetHarnessMocks();
		const { view, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		const attached = fakeTFile({
			extension: 'pdf',
			name: '报告.pdf',
			basename: '报告',
			path: 'docs/报告.pdf',
		});
		h.resolveDroppedFile.mockReturnValue(attached);
		h.getActiveNode.mockReturnValue(fakeNode());

		await fireDrop(
			binder,
			makeDataTransfer({
				files: [
					fakeFile('报告.pdf', 'application/pdf'),
					fakeFile('a.png', 'image/png'),
					fakeFile('笔记.md', 'text/markdown'),
				],
			}),
		);

		expect(h.resolveDroppedFile).toHaveBeenCalledTimes(1);
		expect(h.applyNodeAttachment).toHaveBeenCalledTimes(1);
		expect(h.applyNodeImage).not.toHaveBeenCalled();
		expect(h.applyDocWikiLink).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('根节点不可用（getRenderRoot 为 null）：无「已创建」提示且不插入节点', async () => {
		for (const extension of ['md', 'pdf']) {
			resetHarnessMocks();
			const { view, binder, execCommand } = makeHarness();
			setupDragAndDrop(view);
			h.resolveDroppedFile.mockReturnValue(
				fakeTFile({
					extension,
					name: `文件.${extension}`,
					basename: '文件',
					path: `docs/文件.${extension}`,
				}),
			);
			h.getActiveNode.mockReturnValue(null);
			h.getRenderRoot.mockReturnValue(null);

			await fireDrop(
				binder,
				makeDataTransfer({ files: [fakeFile(`文件.${extension}`, '')] }),
			);

			expect(h.getRenderRoot, extension).toHaveBeenCalled();
			expect(execCommand, extension).not.toHaveBeenCalled();
			// 静默降级：调用方据 insertChildNodeWithData 返回值决定是否提示
			expect(h.noticeCalls, extension).toEqual([]);
		}
	});

	it('挂图失败（applyNodeImage 拒绝）：走 drop 层兜底提示', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
			// 静默：错误路径是要断言的输出
		});
		h.resolveDroppedFile.mockReturnValue(
			fakeTFile({
				extension: 'png',
				name: 'a.png',
				basename: 'a',
				path: 'assets/a.png',
			}),
		);
		h.getActiveNode.mockReturnValue(fakeNode());
		h.applyNodeImage.mockRejectedValueOnce(new Error('节点已销毁'));

		await fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }),
		);

		expect(consoleArgs(errorSpy)).toEqual([
			['处理拖入文件失败', 'Error: 节点已销毁'],
		]);
		expect(h.noticeCalls).toEqual([dropFailed(ZH, '节点已销毁')]);
	});
});

describe('外部文件拖入：导入分支与「导入 vs 引用」边界', () => {
	beforeEach(() => {
		resetHarnessMocks();
	});

	it('外部图片未命中库内文件 → 导入附件目录后挂图（含入库入参/文案/超时）', async () => {
		const viewFile = fakeTFile({
			extension: 'md',
			name: '图谱.mindmap.md',
			basename: '图谱.mindmap',
			path: 'notes/图谱.mindmap.md',
		});
		const { view, binder, execCommand, getResourcePath } = makeHarness({
			file: viewFile,
		});
		setupDragAndDrop(view);
		const node = fakeNode();
		const dropped = fakeFile('photo.png', 'image/png');
		const saved = fakeTFile({
			extension: 'png',
			name: 'photo.png',
			basename: 'photo',
			path: 'attachments/photo.png',
		});
		h.resolveDroppedFile.mockReturnValue(null);
		h.getActiveNode.mockReturnValue(node);
		h.saveImageToVault.mockResolvedValue(saved);

		const dataTransfer = makeDataTransfer({ files: [dropped] });
		await fireDrop(binder, dataTransfer);

		// 先尝试解析为库内文件（引用优先），未命中才走导入
		expect(h.resolveDroppedFile).toHaveBeenCalledWith(dataTransfer, view.app);
		expect(h.saveImageToVault).toHaveBeenCalledTimes(1);
		expect(savedCall(0)).toEqual({
			app: view.app,
			// sourcePath 取视图文件路径 → 决定「附件存放位置」的解析基准
			sourcePath: 'notes/图谱.mindmap.md',
			file: dropped,
			maxSizeMB: 10,
			preferredName: undefined,
			lang: ZH,
		});
		expect(h.applyNodeImage).toHaveBeenCalledWith(
			view,
			node,
			'app://vault/attachments/photo.png',
		);
		expect(getResourcePath).toHaveBeenCalledWith(saved);
		expect(h.noticeCalls).toEqual([
			importingToVault(ZH, 1),
			imageSetOnNode(ZH, 'photo.png'),
			importedSummary(ZH, 1),
		]);
		// 只有导入汇总带 5s 超时，其余为默认时长
		expect(h.noticeTimeouts).toEqual([undefined, undefined, 5000]);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('外部图片：视图无文件时 sourcePath 回退空串，lang 透传到提示与入库入参', async () => {
		for (const lang of ['zh', 'en'] as const) {
			resetHarnessMocks();
			const { view, binder } = makeHarness({ lang });
			setupDragAndDrop(view);
			h.getActiveNode.mockReturnValue(fakeNode());
			h.saveImageToVault.mockResolvedValue(
				fakeTFile({
					extension: 'png',
					name: 'photo.png',
					basename: 'photo',
					path: 'attachments/photo.png',
				}),
			);

			await fireDrop(
				binder,
				makeDataTransfer({ files: [fakeFile('photo.png', 'image/png')] }),
			);

			expect(savedCall(0).sourcePath, lang).toBe('');
			expect(savedCall(0).lang, lang).toBe(lang);
			expect(h.noticeCalls, lang).toEqual([
				importingToVault(lang, 1),
				imageSetOnNode(lang, 'photo.png'),
				importedSummary(lang, 1),
			]);
			expect(h.noticeTimeouts, lang).toEqual([undefined, undefined, 5000]);
		}
	});

	it('图片在库内已存在 → 走引用分支，完全不发生入库写入', async () => {
		const { view, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		const existing = fakeTFile({
			extension: 'png',
			name: 'photo.png',
			basename: 'photo',
			path: 'attachments/photo.png',
		});
		const node = fakeNode();
		h.resolveDroppedFile.mockReturnValue(existing);
		h.getActiveNode.mockReturnValue(node);
		// 入库桩「可用」也不该被调用：命中库内即引用，不复制
		h.saveImageToVault.mockResolvedValue(existing);

		await fireDrop(
			binder,
			makeDataTransfer({
				types: ['Files'],
				files: [fakeFile('photo.png', 'image/png')],
			}),
		);

		expect(h.saveImageToVault).not.toHaveBeenCalled();
		expect(h.extractDroppedFileNames).not.toHaveBeenCalled();
		expect(h.applyNodeImage).toHaveBeenCalledWith(
			view,
			node,
			'app://vault/attachments/photo.png',
		);
		expect(h.noticeCalls).toEqual([imageSetOnNode(ZH, 'photo.png')]);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('混合载荷（图片 + 非图片）：提示仅支持图片，但不阻断图片导入', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		h.getActiveNode.mockReturnValue(node);
		h.saveImageToVault.mockResolvedValue(
			fakeTFile({
				extension: 'png',
				name: 'a.png',
				basename: 'a',
				path: 'attachments/a.png',
			}),
		);

		await fireDrop(
			binder,
			makeDataTransfer({
				files: [
					fakeFile('a.png', 'image/png'),
					fakeFile('说明.txt', 'text/plain'),
				],
			}),
		);

		expect(h.saveImageToVault).toHaveBeenCalledTimes(1);
		expect(h.applyNodeImage).toHaveBeenCalledWith(
			view,
			node,
			'app://vault/attachments/a.png',
		);
		expect(h.noticeCalls).toEqual([
			textOf(ZH, 'common.onlyImagesSupported'),
			importingToVault(ZH, 1),
			imageSetOnNode(ZH, 'a.png'),
			importedSummary(ZH, 1),
		]);
	});

	it('外链 URL / 全非图片载荷：只提示未识别到图片（8s），诊断信息不进入用户提示', async () => {
		const cases: Array<{
			label: string;
			dataTransfer: FakeDataTransfer;
			expectOnlyImagesNotice: boolean;
			expectDebug: string[][] | null;
		}> = [
			{
				label: '外链图片 URL（远程地址不可能映射到库内文件）',
				dataTransfer: makeDataTransfer({
					types: ['text/plain', 'text/uri-list'],
					data: {
						'text/plain': 'https://example.com/remote.png',
						'text/uri-list': 'https://example.com/remote.png',
					},
				}),
				expectOnlyImagesNotice: false,
				expectDebug: [
					[
						'拖入未识别到图片，拖拽数据:',
						'text/plain: https://example.com/remote.png | text/uri-list: https://example.com/remote.png',
					],
				],
			},
			{
				label: '仅非图片文件',
				dataTransfer: makeDataTransfer({
					types: ['text/plain'],
					files: [fakeFile('a.txt', 'text/plain')],
					data: { 'text/plain': 'hello' },
				}),
				expectOnlyImagesNotice: true,
				expectDebug: [['拖入未识别到图片，拖拽数据:', 'text/plain: hello']],
			},
			{
				label: 'types 为空（无任何可读数据）',
				dataTransfer: makeDataTransfer({ files: [fakeFile('a.bin', '')] }),
				expectOnlyImagesNotice: true,
				expectDebug: null,
			},
			{
				label: 'getData 抛错（个别自定义类型读不到）',
				dataTransfer: makeDataTransfer({
					types: ['application/x-custom'],
					files: [fakeFile('a.bin', '')],
					getDataThrows: ['application/x-custom'],
				}),
				expectOnlyImagesNotice: true,
				expectDebug: null,
			},
			{
				// 诊断载荷按 100 字符截断：超长值不进日志全文，更不进用户提示
				label: '超长载荷只截取前 100 字符',
				dataTransfer: makeDataTransfer({
					types: ['text/plain'],
					data: { 'text/plain': 'y'.repeat(300) },
				}),
				expectOnlyImagesNotice: false,
				expectDebug: [
					['拖入未识别到图片，拖拽数据:', `text/plain: ${'y'.repeat(100)}`],
				],
			},
		];

		for (const item of cases) {
			resetHarnessMocks();
			const { view, binder } = makeHarness();
			setupDragAndDrop(view);
			const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {
				// 静默：诊断输出单独断言
			});

			await fireDrop(binder, item.dataTransfer);

			const expected = [textOf(ZH, 'common.noImagesDropped')];
			if (item.expectOnlyImagesNotice) {
				expected.unshift(textOf(ZH, 'common.onlyImagesSupported'));
			}
			expect(h.noticeCalls, item.label).toEqual(expected);
			expect(h.noticeTimeouts, item.label).toEqual(
				item.expectOnlyImagesNotice ? [undefined, 8000] : [8000],
			);
			expect(h.saveImageToVault, item.label).not.toHaveBeenCalled();
			expect(h.applyNodeImage, item.label).not.toHaveBeenCalled();
			// 面向用户的提示不含原始 MIME 与拖拽载荷
			const userFacing = h.noticeCalls.join(' | ');
			expect(userFacing, item.label).not.toContain('text/plain');
			expect(userFacing, item.label).not.toContain('example.com');
			expect(userFacing, item.label).not.toContain('hello');

			if (item.expectDebug) {
				expect(consoleArgs(debugSpy), item.label).toEqual(item.expectDebug);
			} else {
				expect(debugSpy, item.label).not.toHaveBeenCalled();
			}
		}
	});

	it('外部图片但未选中主题：只提示先选择节点，不保存、不弹导入提示', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		h.getActiveNode.mockReturnValue(null);

		await fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('photo.png', 'image/png')] }),
		);

		// 归属检查在「正在导入」提示之前 → 只留一条提示
		expect(h.noticeCalls).toEqual([textOf(ZH, 'common.selectNodeBeforeDrop')]);
		expect(h.noticeTimeouts).toEqual([undefined]);
		expect(h.saveImageToVault).not.toHaveBeenCalled();
		expect(h.applyNodeImage).not.toHaveBeenCalled();
	});

	it('多图外部导入：首张挂所选节点，其余各新建独占图片子节点', async () => {
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
		h.getActiveNode.mockReturnValue(node);
		h.saveImageToVault
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);

		await fireDrop(
			binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);

		// 首张保持单图拖入的原行为：挂到所选节点
		expect(h.applyNodeImage).toHaveBeenCalledTimes(1);
		expect(h.applyNodeImage).toHaveBeenCalledWith(
			view,
			node,
			'app://vault/attachments/a.png',
		);
		// 其余各建一个承载图片的子节点（图片独占语义：无文本 + 引擎渲染字段）
		expect(h.createAspectSetNodeImageOptions).toHaveBeenCalledWith(
			'app://vault/attachments/b.png',
		);
		expect(execCommand).toHaveBeenCalledTimes(1);
		expect(execCommand).toHaveBeenCalledWith(INSERT_CHILD_NODE, false, [node], {
			text: '',
			image: 'app://vault/attachments/b.png',
			imageTitle: ASPECT_TITLE,
			imageSize: { ...ASPECT_SIZE },
			mdImageTarget: 'attachments/b.png',
			isActive: false,
		});
		// 多图不再逐张弹「已设置节点图片」：单条汇总 + 归属说明（换行分段）
		expect(h.noticeCalls).toEqual([
			importingToVault(ZH, 2),
			importedWithPlacement(ZH, 2),
		]);
		expect(h.noticeTimeouts).toEqual([undefined, 5000]);
	});

	it('多图外部导入：数量一致时按序用 uri-list 解出的真实文件名，不一致则全部放弃', async () => {
		const first = fakeTFile({
			extension: 'png',
			name: '图1.png',
			basename: '图1',
			path: 'attachments/图1.png',
		});
		const second = fakeTFile({
			extension: 'png',
			name: '图2.png',
			basename: '图2',
			path: 'attachments/图2.png',
		});

		// 数量一致 → 真实文件名按序作为 preferredName（修复 Windows 下 File.name 乱码）
		const matched = makeHarness();
		setupDragAndDrop(matched.view);
		h.getActiveNode.mockReturnValue(fakeNode());
		h.saveImageToVault
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		h.extractDroppedFileNames.mockReturnValue(['真实1.png', '真实2.png']);

		await fireDrop(
			matched.binder,
			makeDataTransfer({
				files: [
					fakeFile('??1.png', 'image/png'),
					fakeFile('??2.png', 'image/png'),
				],
			}),
		);

		expect(h.saveImageToVault).toHaveBeenCalledTimes(2);
		expect([savedCall(0).preferredName, savedCall(1).preferredName]).toEqual([
			'真实1.png',
			'真实2.png',
		]);

		// 数量不一致 → 不按序对应（避免文件名错位），preferredName 全部放弃
		h.saveImageToVault.mockReset();
		h.saveImageToVault
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		h.extractDroppedFileNames.mockReturnValue(['只有一个.png']);

		await fireDrop(
			matched.binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);

		expect(h.saveImageToVault).toHaveBeenCalledTimes(2);
		expect([savedCall(0).preferredName, savedCall(1).preferredName]).toEqual([
			undefined,
			undefined,
		]);
	});

	it('逐张容错：单张抛错不中断其余导入，并按 notifyError 汇总失败', async () => {
		const { view, binder } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		const second = fakeTFile({
			extension: 'png',
			name: 'b.png',
			basename: 'b',
			path: 'attachments/b.png',
		});
		h.getActiveNode.mockReturnValue(node);
		h.saveImageToVault
			.mockRejectedValueOnce(new Error('磁盘已满'))
			.mockResolvedValueOnce(second);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
			// 静默：错误路径是要断言的输出
		});

		await fireDrop(
			binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);

		// 失败不吞：错误提示 + 控制台留首个错误；成功的仍挂上
		expect(h.noticeCalls).toContain(importImageFailed(ZH, '磁盘已满'));
		expect(h.noticeCalls).toContain(imageSetOnNode(ZH, 'b.png'));
		expect(consoleArgs(errorSpy)).toEqual([
			['导入拖入的图片失败', 'Error: 磁盘已满'],
		]);
		expect(h.applyNodeImage).toHaveBeenCalledWith(
			view,
			node,
			'app://vault/attachments/b.png',
		);
	});

	it('全部入库失败（返回 null）：上报失败但不挂图、不给导入汇总', async () => {
		const { view, binder, execCommand } = makeHarness();
		setupDragAndDrop(view);
		h.getActiveNode.mockReturnValue(fakeNode());
		// saveImageToVault 内部失败时返回 null（不抛错）→ firstError 记录不到具体错误
		h.saveImageToVault.mockResolvedValue(null);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
			// 静默：错误路径是要断言的输出
		});

		await fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }),
		);

		expect(consoleArgs(errorSpy)).toEqual([['导入拖入的图片失败', 'null']]);
		expect(h.noticeCalls).toEqual([
			importingToVault(ZH, 1),
			// 返回 null 的失败没有错误对象 → errorMessage(null) 为 'null'
			importImageFailed(ZH, 'null'),
		]);
		expect(h.applyNodeImage).not.toHaveBeenCalled();
		expect(h.createAspectSetNodeImageOptions).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('保存期间换文件/重建引擎：放弃写入旧节点（无挂图、无子节点、无汇总）', async () => {
		const { view, binder, execCommand, mutable, canvas } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		h.getActiveNode.mockReturnValue(node);
		h.saveImageToVault.mockImplementation(async () => {
			// 模拟保存期间视图切换文件/引擎重建：旧节点已不在新树上
			mutable.mindMap = { execCommand } as unknown as MindMap;
			return fakeTFile({
				extension: 'png',
				name: 'a.png',
				basename: 'a',
				path: 'attachments/a.png',
			});
		});

		const { preventDefault } = await fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }),
		);

		expect(preventDefault).toHaveBeenCalledTimes(1);
		expect(h.applyNodeImage).not.toHaveBeenCalled();
		expect(h.createAspectSetNodeImageOptions).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
		// 只保留「正在导入」：写入被放弃后不再给任何结果提示
		expect(h.noticeCalls).toEqual([importingToVault(ZH, 1)]);
		expect(canvas.classes.has('mindmap-drag-over')).toBe(false);
	});

	it('尺寸探测期间换文件/重建引擎：放弃新建承载子节点', async () => {
		const { view, binder, execCommand, mutable } = makeHarness();
		setupDragAndDrop(view);
		const node = fakeNode();
		h.getActiveNode.mockReturnValue(node);
		h.saveImageToVault
			.mockResolvedValueOnce(
				fakeTFile({
					extension: 'png',
					name: 'a.png',
					basename: 'a',
					path: 'attachments/a.png',
				}),
			)
			.mockResolvedValueOnce(
				fakeTFile({
					extension: 'png',
					name: 'b.png',
					basename: 'b',
					path: 'attachments/b.png',
				}),
			);
		h.createAspectSetNodeImageOptions.mockImplementation(async (url) => {
			// 探测是异步的（真实实现要解码图片）：期间换引擎 → 父节点已不在新树上
			mutable.mindMap = { execCommand } as unknown as MindMap;
			return {
				url: url ?? '',
				title: ASPECT_TITLE,
				width: ASPECT_SIZE.width,
				height: ASPECT_SIZE.height,
				custom: ASPECT_SIZE.custom,
			};
		});

		await fireDrop(
			binder,
			makeDataTransfer({
				files: [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')],
			}),
		);

		// 首张（挂所选节点）已写入，第二张因引擎变更被放弃
		expect(h.applyNodeImage).toHaveBeenCalledTimes(1);
		expect(h.createAspectSetNodeImageOptions).toHaveBeenCalledTimes(1);
		expect(execCommand).not.toHaveBeenCalled();
		expect(h.noticeCalls).toEqual([
			importingToVault(ZH, 2),
			importedWithPlacement(ZH, 2),
		]);
	});

	it('引擎在入库期间被清空（mindMap 为 null）：不挂图不新建，仅完成入库与提示', async () => {
		const { view, binder, mutable, execCommand } = makeHarness();
		setupDragAndDrop(view);
		h.getActiveNode.mockReturnValue(fakeNode());
		const engine = mutable.mindMap;
		h.saveImageToVault.mockImplementation(async () => {
			mutable.mindMap = null;
			return fakeTFile({
				extension: 'png',
				name: 'a.png',
				basename: 'a',
				path: 'attachments/a.png',
			});
		});

		await fireDrop(
			binder,
			makeDataTransfer({ files: [fakeFile('a.png', 'image/png')] }),
		);

		// 同一处 `view.mindMap !== engine` 守卫：引擎被清空也走「放弃写入」
		expect(engine).not.toBeNull();
		expect(mutable.mindMap).toBeNull();
		expect(h.applyNodeImage).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
		expect(h.noticeCalls).toEqual([importingToVault(ZH, 1)]);
	});
});

/** 清空 Notice 记录（分支二的 harness 与分支一共用同一批全局记录） */
function resetNotices(): void {
	h.noticeCalls.length = 0;
	h.noticeTimeouts.length = 0;
}

/** 每个用例（表驱动每一行）前的统一复位：默认「非库内文件 + 无激活节点 + 无根节点 + 入库失败」 */
function resetHarnessMocks(): void {
	resetNotices();
	h.applyNodeImage.mockReset();
	h.applyNodeAttachment.mockReset();
	h.applyDocWikiLink.mockReset();
	h.saveImageToVault.mockReset();
	h.resolveDroppedFile.mockReset();
	h.extractDroppedFileNames.mockReset();
	h.getActiveNode.mockReset();
	h.getRenderRoot.mockReset();
	h.createAspectSetNodeImageOptions.mockReset();

	h.resolveDroppedFile.mockReturnValue(null);
	h.extractDroppedFileNames.mockReturnValue([]);
	h.getActiveNode.mockReturnValue(null);
	h.getRenderRoot.mockReturnValue(null);
	h.saveImageToVault.mockResolvedValue(null);
	h.createAspectSetNodeImageOptions.mockImplementation((url) =>
		Promise.resolve({
			url: url ?? '',
			title: ASPECT_TITLE,
			width: ASPECT_SIZE.width,
			height: ASPECT_SIZE.height,
			custom: ASPECT_SIZE.custom,
		}),
	);
}

afterEach(() => {
	// 桩与 console spy 都还原，避免跨用例污染（表驱动用例内另有 resetHarnessMocks）
	vi.restoreAllMocks();
	resetNotices();
});
