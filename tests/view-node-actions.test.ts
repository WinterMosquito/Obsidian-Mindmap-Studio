/**
 * view-node-actions 回归：节点操作编排（链接三通道分流 / 删除兜底 / 视图剪贴板 /
 * 自兜错误）与 view-common 的两个前置守卫。
 *
 * 关注点（模块自身的分支与入参，非 mock 行为）：
 * - 链接通道分流：URL/协议链接 → 引擎 hyperlink；指向 .md 笔记 → mdWikiLinkpath
 *   （自绘文档页图标）；附件/库内路径 → attachmentUrl（原生回形针）。表驱动覆盖
 *   已解析库内文件 / 未解析（按目标串扩展名）两条判定路径与别名、显式 label 的
 *   可见名优先级；
 * - 纯双链化：写入文档/附件双链即无条件覆盖节点文字为显示名（拖入与弹窗同规则），
 *   用户手写正文被顶替（旧的「仅空/旧链名时改写」已废弃）；
 * - 防御：弹窗取消、弹窗期间引擎换代、无激活节点都不触碰引擎；
 * - 删除：根节点拒绝提示 + uid 异常时按对象身份兜底强制清除；
 * - 剪贴板：WeakMap 按视图隔离、深拷贝、粘贴剥离 uid/isActive、未指定父节点挂根；
 * - 自兜错误：内部异常转成用户可见 Notice（工具栏/菜单以 void 调用，不能外抛）。
 *
 * mindmap 防腐层与弹窗/解析模块以 stub 替换：本文件只验证 view-node-actions
 * 自己的编排。Notice 断言用 `t(lang, key)` 取真实文案，手写字符串会让测试与实现脱钩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { t, type Language, type TranslationKey } from '../src/i18n';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	addImageToActiveNode,
	addLinkToActiveNode,
	applyDocWikiLink,
	applyNodeAttachment,
	clearNodeHyperlink,
	copyNode,
	deleteActiveNode,
	pasteNodeAsChild,
	removeNodeImage,
	removeNodeText,
} from '../src/features/view-node-actions';
import {
	insertChildNodeWithData,
	requireActiveNode,
} from '../src/features/view-common';

const {
	noticeCalls,
	ENGINE,
	setNodeTextMock,
	markNodeNeedLayoutMock,
	forceRemoveMock,
	openLinkMock,
	openImageMock,
	resolveMock,
	setImageOptionsMock,
	aspectImageOptionsMock,
} = vi.hoisted(() => ({
	noticeCalls: [] as string[],
	// 命令名取值与 src/mindmap.ts 的 ENGINE_COMMANDS 一致；常量表本身的 token
	// 契约由 vendor-contract 测试把关，这里只验证编排传了哪一个命令。
	ENGINE: {
		BACK: 'BACK',
		FORWARD: 'FORWARD',
		INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
		INSERT_NODE: 'INSERT_NODE',
		REMOVE_NODE: 'REMOVE_NODE',
		RESET_LAYOUT: 'RESET_LAYOUT',
		SET_NODE_DATA: 'SET_NODE_DATA',
		SET_NODE_HYPERLINK: 'SET_NODE_HYPERLINK',
		SET_NODE_IMAGE: 'SET_NODE_IMAGE',
	},
	setNodeTextMock: vi.fn<(...args: unknown[]) => void>(),
	markNodeNeedLayoutMock: vi.fn<(...args: unknown[]) => void>(),
	forceRemoveMock: vi.fn<(...args: unknown[]) => void>(),
	openLinkMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
	openImageMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
	resolveMock: vi.fn<(...args: unknown[]) => unknown>(),
	setImageOptionsMock: vi.fn<(...args: unknown[]) => unknown>(),
	aspectImageOptionsMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		Notice: class {
			constructor(message?: string) {
				noticeCalls.push(message ?? '');
			}
		},
	};
});

vi.mock('../src/mindmap', () => ({
	ENGINE_COMMANDS: ENGINE,
	setNodeText: (...args: unknown[]): void => {
		setNodeTextMock(...args);
	},
	markNodeNeedLayout: (...args: unknown[]): void => {
		markNodeNeedLayoutMock(...args);
	},
	forceRemoveNodeData: (...args: unknown[]): void => {
		forceRemoveMock(...args);
	},
	// 以下三个保持生产语义：桩成常量会让「按节点数据分流」的分支永远走同一路，
	// 断言全部失真（renderer 缺失 ⇒ 无激活节点/无根，与 src/mindmap.ts 一致）。
	getActiveNode: (mindMap: unknown): unknown => {
		const renderer = (
			mindMap as { renderer?: { activeNodeList?: unknown[] } } | null
		)?.renderer;
		return renderer ? (renderer.activeNodeList?.[0] ?? null) : null;
	},
	getRenderRoot: (mindMap: unknown): unknown =>
		(mindMap as { renderer?: { root?: unknown } } | null)?.renderer?.root ?? null,
	getNodeDataString: (node: unknown, key: string): string => {
		const value = (
			node as { getData?: (name: string) => unknown } | null
		)?.getData?.(key);
		return typeof value === 'string' ? value : '';
	},
}));

vi.mock('../src/modal-link', () => ({
	openLinkEditorModal: (...args: unknown[]): Promise<unknown> =>
		openLinkMock(...args),
}));

vi.mock('../src/modal-image', () => ({
	openImageEditorModal: (...args: unknown[]): Promise<unknown> =>
		openImageMock(...args),
}));

// 库内解析结果由用例决定：未解析（null）= 按目标串扩展名判定；
// 返回 TFile 形态对象 = 按真实扩展名判定。真实现依赖全库索引，与编排无关。
vi.mock('../src/links-resolve', () => ({
	resolvePathToFile: (...args: unknown[]): unknown => resolveMock(...args),
}));

// 尺寸探测要读 DOM 图片原始尺寸（node 环境无 Image）：桩掉选项构造器，
// 只验证编排把「显示地址」交给了 SET_NODE_IMAGE。
vi.mock('../src/images-path', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/images-path')>();
	return {
		...actual,
		createSetNodeImageOptions: (...args: unknown[]): unknown =>
			setImageOptionsMock(...args),
		createAspectSetNodeImageOptions: (...args: unknown[]): Promise<unknown> =>
			aspectImageOptionsMock(...args),
	};
});

/** 取真实中文文案（key 拼错即编译失败） */
function zh(key: TranslationKey): string {
	return t('zh', key);
}

/** 取第 n 次调用的完整入参（避免 noUncheckedIndexedAccess 噪声与静默 undefined） */
function callArgs(spy: { mock: { calls: unknown[][] } }, index = 0): unknown[] {
	const call = spy.mock.calls[index];
	if (!call) {
		throw new Error(`第 ${index + 1} 次调用不存在`);
	}
	return call;
}

/**
 * 节点桩：getData() 返回节点 data 对象本身、getData(key) 返回字段（引擎语义）；
 * 用例需要断言「数据被改写」时经 dataOf(node) 取同一对象。
 */
function fakeNode(
	options: {
		data?: Record<string, unknown>;
		isRoot?: boolean;
		parent?: unknown;
		/** false = 模拟无 getData 的节点（走 nodeData.data 兜底读法） */
		withGetData?: boolean;
	} = {},
): MindMapNode {
	const data: Record<string, unknown> = { text: '', ...options.data };
	const node: Record<string, unknown> = {
		isRoot: options.isRoot ?? false,
		parent:
			options.parent === undefined
				? { nodeData: { children: [] } }
				: options.parent,
		nodeData: { data },
	};
	if (options.withGetData !== false) {
		node['getData'] = (key?: string): unknown =>
			key === undefined ? data : data[key];
	}
	return node as unknown as MindMapNode;
}

/** 节点数据对象（与 getData() 返回的是同一个引用） */
function dataOf(node: MindMapNode): Record<string, unknown> {
	return (node as unknown as { nodeData: { data: Record<string, unknown> } })
		.nodeData.data;
}

/**
 * 视图原始桩：mindMap 声明为 unknown 且可写——用例需要模拟「弹窗期间引擎被
 * 重建」把它换成另一棵树的引擎（换成具体引擎形状会锁死赋值类型）。
 */
interface RawViewStub {
	mindMap: unknown;
	lang: Language;
	app: App;
	scheduleSave: Mock;
}

/** 引擎桩：execCommand/render 记录调用，renderer 提供激活列表与渲染根 */
function makeEngine(activeNode: MindMapNode | null = null, root: unknown = null) {
	const execCommand = vi.fn<(...args: unknown[]) => void>();
	const render = vi.fn<() => void>();
	return {
		execCommand,
		render,
		renderer: {
			activeNodeList: activeNode ? [activeNode] : [],
			root,
		},
	};
}

/**
 * 视图桩：返回原始对象（非只读 cast），便于用例模拟「弹窗期间引擎被重建」。
 */
function makeView(
	options: {
		activeNode?: MindMapNode | null;
		root?: unknown;
		lang?: Language;
		/** false = 无引擎实例（视图已关闭/重建中） */
		withEngine?: boolean;
	} = {},
) {
	const engine = makeEngine(options.activeNode ?? null, options.root ?? null);
	const scheduleSave = vi.fn<() => void>();
	const getResourcePath = vi.fn<(file: unknown) => string>(
		(file: unknown) => `app://local/${(file as { path: string }).path}`,
	);
	const raw: RawViewStub = {
		mindMap: options.withEngine === false ? null : engine,
		lang: options.lang ?? 'zh',
		app: { vault: { getResourcePath } } as unknown as App,
		scheduleSave,
	};
	return {
		view: raw as unknown as MindMapViewContext,
		raw,
		engine,
		execCommand: engine.execCommand,
		render: engine.render,
		scheduleSave,
		getResourcePath,
	};
}

/** 库内文件桩（按扩展名判定分支只读 extension/path/name） */
function fakeFile(path: string, extension: string): TFile {
	const name = path.split('/').pop() ?? path;
	return Object.assign(new TFile(), { path, name, extension });
}

beforeEach(() => {
	noticeCalls.length = 0;
	vi.clearAllMocks();
	// 默认：弹窗取消、解析失败（按目标串扩展名判定）、图片选项桩吐标记对象
	resolveMock.mockReturnValue(null);
	openLinkMock.mockResolvedValue(null);
	openImageMock.mockResolvedValue(null);
	setImageOptionsMock.mockImplementation((url: unknown) => ({ url }));
	aspectImageOptionsMock.mockResolvedValue({ aspect: true });
});

afterEach(() => {
	noticeCalls.length = 0;
});

describe('insertChildNodeWithData（插入子节点的唯一入口）', () => {
	it('携带初始数据插入到指定父节点，并统一 isActive=false（新节点不抢激活态）', () => {
		const parent = fakeNode({ data: { text: '父' } });
		const { view, execCommand } = makeView();

		expect(
			insertChildNodeWithData(view, parent, { text: '子', image: 'a.png' }),
		).toBe(true);
		// appointNodes=[parent] 是引擎唯一可靠入口（空数组会被静默忽略）
		expect(callArgs(execCommand)).toEqual([
			ENGINE.INSERT_CHILD_NODE,
			false,
			[parent],
			{ text: '子', image: 'a.png', isActive: false },
		]);
	});

	it('调用方传入的 isActive=true 被覆盖：初始数据里的激活态不生效', () => {
		const parent = fakeNode();
		const { view, execCommand } = makeView();

		insertChildNodeWithData(view, parent, { text: '子', isActive: true });
		const [, , , payload] = callArgs(execCommand);
		expect((payload as Record<string, unknown>)['isActive']).toBe(false);
	});

	it('父节点缺失：返回 false 且不调用引擎', () => {
		const { view, execCommand } = makeView();
		expect(insertChildNodeWithData(view, null, { text: 'x' })).toBe(false);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('引擎缺失（视图重建中）：返回 false 且不调用引擎', () => {
		const { view, execCommand } = makeView({ withEngine: false });
		expect(
			insertChildNodeWithData(view, fakeNode(), { text: 'x' }),
		).toBe(false);
		expect(execCommand).not.toHaveBeenCalled();
	});
});

describe('requireActiveNode（前置守卫）', () => {
	it('无激活节点：返回 null 并提示「请先选择一个节点」', () => {
		const { view } = makeView();
		expect(requireActiveNode(view)).toBeNull();
		expect(noticeCalls).toEqual([zh('common.selectNodeFirst')]);
	});

	it('有激活节点：返回节点且不提示', () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		expect(requireActiveNode(view)).toBe(node);
		expect(noticeCalls).toHaveLength(0);
	});

	it('提示文案随视图语言（英文视图弹英文提示）', () => {
		const { view } = makeView({ lang: 'en' });
		requireActiveNode(view);
		expect(noticeCalls).toEqual([t('en', 'common.selectNodeFirst')]);
	});
});

/** 链接通道分流用例：同一条弹窗结果按形态落到不同通道 */
interface LinkChannelCase {
	name: string;
	link: string;
	label?: string;
	/** 库内解析结果（null = 未解析，按目标串扩展名判定） */
	resolved: { path: string; extension: string } | null;
	channel: 'wiki' | 'attachment' | 'hyperlink';
	/** 期望同步到节点文本的可见名（wiki/attachment 通道） */
	display: string;
	/** attachment 通道的引擎字段值 */
	url?: string;
}

const LINK_CHANNEL_CASES: LinkChannelCase[] = [
	{
		name: '文档双链 → mdWikiLinkpath（自绘文档页图标）',
		link: '[[新笔记]]',
		resolved: null,
		channel: 'wiki',
		display: '新笔记',
	},
	{
		name: '文档双链带别名 → 可见名取别名',
		link: '[[笔记|别名]]',
		resolved: null,
		channel: 'wiki',
		display: '别名',
	},
	{
		name: '带区块引用且已解析到库内 .md → mdWikiLinkpath',
		link: '[[归档/笔记#小节]]',
		resolved: { path: '归档/笔记.md', extension: 'md' },
		channel: 'wiki',
		// 可见文本取 linkpath 末段（区块引用保留在文本里），解析才用去掉 # 的 target
		display: '笔记#小节',
	},
	{
		name: '附件双链（[[报告.pdf]]）→ attachmentUrl（回形针）',
		link: '[[报告.pdf]]',
		resolved: null,
		channel: 'attachment',
		display: '报告.pdf',
		url: '报告.pdf',
	},
	{
		name: '附件双链带别名 → 回形针标题与节点文本都用别名',
		link: '[[报告.pdf|说明]]',
		resolved: null,
		channel: 'attachment',
		display: '说明',
		url: '报告.pdf',
	},
	{
		name: '无扩展名目标但库内实际是图片：按真实扩展名走附件通道',
		link: '[[插图]]',
		resolved: { path: '资产/插图.png', extension: 'png' },
		channel: 'attachment',
		display: '插图',
		url: '插图',
	},
	{
		name: '库内路径（非双链）→ attachmentUrl，目标取整串路径',
		link: 'assets/图.png',
		resolved: { path: 'assets/图.png', extension: 'png' },
		channel: 'attachment',
		display: '图.png',
		url: 'assets/图.png',
	},
	{
		name: 'http 外链 → 引擎 hyperlink（原生链接图标）',
		link: 'https://example.com/a',
		resolved: null,
		channel: 'hyperlink',
		display: '',
	},
	{
		name: 'obsidian:// 协议链接 → 引擎 hyperlink',
		link: 'obsidian://open?vault=v&file=n',
		resolved: null,
		channel: 'hyperlink',
		display: '',
	},
];

describe('addLinkToActiveNode：链接通道分流（表驱动）', () => {
	it.each(LINK_CHANNEL_CASES)('$name', async (testCase) => {
		const node = fakeNode();
		const { view, execCommand, render, scheduleSave } = makeView({
			activeNode: node,
		});
		resolveMock.mockReturnValue(
			testCase.resolved ? fakeFile(testCase.resolved.path, testCase.resolved.extension) : null,
		);
		openLinkMock.mockResolvedValue(
			testCase.label === undefined
				? { link: testCase.link }
				: { link: testCase.link, label: testCase.label },
		);

		await addLinkToActiveNode(view);

		const data = dataOf(node);
		expect(markNodeNeedLayoutMock).toHaveBeenCalledWith(node);
		expect(scheduleSave).toHaveBeenCalled();

		if (testCase.channel === 'hyperlink') {
			// URL 只挂超链接图标：写引擎字段、清掉可能残留的文档双链通道
			expect(callArgs(execCommand)).toEqual([
				ENGINE.SET_NODE_HYPERLINK,
				node,
				testCase.link,
			]);
			expect(data.mdWikiLinkpath).toBeUndefined();
			expect(data.mdLinkText).toBeUndefined();
			// 「仅图标」：节点文本不被 URL 污染，也不需要本地重绘
			expect(setNodeTextMock).not.toHaveBeenCalled();
			expect(render).not.toHaveBeenCalled();
			return;
		}

		// 文档双链/附件都不走引擎 hyperlink（否则原生图标与自绘图标/回形针双显）
		expect(execCommand).not.toHaveBeenCalled();
		expect(data.hyperlink).toBeUndefined();
		expect(data.mdLinkStyle).toBe('wiki');
		expect(setNodeTextMock).toHaveBeenCalledWith(
			view.mindMap,
			node,
			testCase.display,
		);
		expect(render).toHaveBeenCalled();

		if (testCase.channel === 'wiki') {
			expect(data.mdWikiLinkpath).toBe(testCase.link);
			expect(data.mdLinkText).toBe(testCase.display);
			expect(data.attachmentUrl).toBeUndefined();
		} else {
			// 附件：点击打开用目标路径，可见名与节点文本同口径
			expect(data.attachmentUrl).toBe(testCase.url);
			expect(data.mdAttachmentLinkpath).toBe(testCase.url);
			expect(data.attachmentName).toBe(testCase.display);
			expect(data.mdWikiLinkpath).toBeUndefined();
		}
	});
});

describe('addLinkToActiveNode：库内解析入参', () => {
	it('解析用去掉 #区块 的 target，通道写入仍用原始链接串', async () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		resolveMock.mockReturnValue(fakeFile('归档/笔记.md', 'md'));
		openLinkMock.mockResolvedValue({ link: '[[归档/笔记#小节]]' });

		await addLinkToActiveNode(view);

		// 区块引用不是路径的一部分，交给解析会找不到文件（退回非 .md 判定）
		expect(resolveMock).toHaveBeenCalledWith('归档/笔记', view.app);
		expect(dataOf(node).mdWikiLinkpath).toBe('[[归档/笔记#小节]]');
	});

	it('非双链的库内路径：整串交给解析，写通道时不做末段裁剪', async () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		resolveMock.mockReturnValue(fakeFile('归档/报告.pdf', 'pdf'));
		openLinkMock.mockResolvedValue({ link: '归档/报告.pdf' });

		await addLinkToActiveNode(view);

		expect(resolveMock).toHaveBeenCalledWith('归档/报告.pdf', view.app);
		expect(dataOf(node).mdAttachmentLinkpath).toBe('归档/报告.pdf');
		expect(dataOf(node).attachmentName).toBe('报告.pdf');
	});
});

describe('addLinkToActiveNode：可见名与可见文本同步规则', () => {
	it('显式 label（联想选择）优先于双链别名', async () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue({ link: '[[笔记]]', label: '自定义名' });

		await addLinkToActiveNode(view);

		expect(dataOf(node).mdLinkText).toBe('自定义名');
		expect(setNodeTextMock).toHaveBeenCalledWith(
			view.mindMap,
			node,
			'自定义名',
		);
	});

	it('改链场景：节点文本仍是旧链接显示名 → 同步为新显示名', async () => {
		const node = fakeNode({ data: { text: '旧笔记', mdWikiLinkpath: '[[旧笔记]]' } });
		const { view } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue({ link: '[[新笔记]]' });

		await addLinkToActiveNode(view);

		expect(setNodeTextMock).toHaveBeenCalledTimes(1);
		expect(setNodeTextMock).toHaveBeenCalledWith(view.mindMap, node, '新笔记');
		expect(dataOf(node).mdWikiLinkpath).toBe('[[新笔记]]');
	});

	it('已有用户正文：也被覆盖为链接显示名（纯双链化，正文被顶替）', async () => {
		const node = fakeNode({
			data: { text: '我的正文', mdWikiLinkpath: '[[旧笔记]]' },
		});
		const { view } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue({ link: '[[新笔记]]' });

		await addLinkToActiveNode(view);

		expect(setNodeTextMock).toHaveBeenCalledTimes(1);
		expect(setNodeTextMock).toHaveBeenCalledWith(view.mindMap, node, '新笔记');
		expect(dataOf(node).mdWikiLinkpath).toBe('[[新笔记]]');
	});

	it('旧链接是 URL 且文本仍是旧 URL：改链时清空残留文本（保持「仅图标」）', async () => {
		const node = fakeNode({
			data: { text: 'https://old.example.com', hyperlink: 'https://old.example.com' },
		});
		const { view, execCommand } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue({ link: 'https://new.example.com' });

		await addLinkToActiveNode(view);

		expect(setNodeTextMock).toHaveBeenCalledTimes(1);
		expect(setNodeTextMock).toHaveBeenCalledWith(view.mindMap, node, '');
		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_HYPERLINK,
			node,
			'https://new.example.com',
		]);
	});

	it('旧链接是 URL 但文本是用户正文：改链不动文本', async () => {
		const node = fakeNode({
			data: { text: '参考链接', hyperlink: 'https://old.example.com' },
		});
		const { view } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue({ link: 'https://new.example.com' });

		await addLinkToActiveNode(view);

		expect(setNodeTextMock).not.toHaveBeenCalled();
	});

	it('设置 URL 链接时清掉残留的文档双链通道字段（图标不歧义）', async () => {
		const node = fakeNode({
			data: { mdWikiLinkpath: '[[旧笔记]]', mdLinkText: '旧笔记' },
		});
		const { view, execCommand } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue({ link: 'https://example.com' });

		await addLinkToActiveNode(view);

		expect(dataOf(node).mdWikiLinkpath).toBeUndefined();
		expect(dataOf(node).mdLinkText).toBeUndefined();
		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_HYPERLINK,
			node,
			'https://example.com',
		]);
	});
});

describe('addLinkToActiveNode：守卫、取消与自兜错误', () => {
	it('无激活节点：只提示，不打开弹窗（守卫在弹窗之前）', async () => {
		const { view, execCommand } = makeView();
		await addLinkToActiveNode(view);
		expect(noticeCalls).toEqual([zh('common.selectNodeFirst')]);
		expect(openLinkMock).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('弹窗取消（null）：不触碰引擎、不调度保存', async () => {
		const node = fakeNode({ data: { text: '正文' } });
		const { view, execCommand, scheduleSave } = makeView({ activeNode: node });
		openLinkMock.mockResolvedValue(null);

		await addLinkToActiveNode(view);

		expect(execCommand).not.toHaveBeenCalled();
		expect(scheduleSave).not.toHaveBeenCalled();
		expect(dataOf(node).mdWikiLinkpath).toBeUndefined();
		expect(noticeCalls).toHaveLength(0);
	});

	it('弹窗预填当前链接（文档双链通道优先于引擎 hyperlink）', async () => {
		const node = fakeNode({
			data: { mdWikiLinkpath: '[[文档]]', hyperlink: 'https://example.com' },
		});
		const { view } = makeView({ activeNode: node });
		await addLinkToActiveNode(view);
		expect(openLinkMock).toHaveBeenCalledWith(view.app, '[[文档]]', 'zh');
	});

	it('清空输入（空链接）= 清除链接：清两个通道并重绘', async () => {
		const node = fakeNode({ data: { mdWikiLinkpath: '[[旧笔记]]' } });
		const { view, execCommand, render, scheduleSave } = makeView({
			activeNode: node,
		});
		openLinkMock.mockResolvedValue({ link: '' });

		await addLinkToActiveNode(view);

		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_HYPERLINK,
			node,
			'',
		]);
		expect(dataOf(node).mdWikiLinkpath).toBeUndefined();
		expect(render).toHaveBeenCalled();
		expect(scheduleSave).toHaveBeenCalled();
		expect(setNodeTextMock).not.toHaveBeenCalled();
	});

	it('弹窗期间引擎被重建：旧节点不在新树上，不写入也不保存', async () => {
		const node = fakeNode({ data: { text: '正文' } });
		const harness = makeView({ activeNode: node });
		const rebuilt = makeEngine();
		openLinkMock.mockImplementation(async () => {
			// 模拟弹窗打开期间换文件/重建引擎
			harness.raw.mindMap = rebuilt;
			return { link: '[[新笔记]]' };
		});

		await addLinkToActiveNode(harness.view);

		expect(dataOf(node).mdWikiLinkpath).toBeUndefined();
		expect(harness.scheduleSave).not.toHaveBeenCalled();
		expect(setNodeTextMock).not.toHaveBeenCalled();
		// 新引擎同样不该被写入：旧节点已不属于这棵树
		expect(rebuilt.execCommand).not.toHaveBeenCalled();
		expect(rebuilt.render).not.toHaveBeenCalled();
	});

	it('内部异常不外抛：转成用户可见提示（工具栏 void 调用不产生未处理拒绝）', async () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		openLinkMock.mockRejectedValue(new Error('boom'));

		await expect(addLinkToActiveNode(view)).resolves.toBeUndefined();

		expect(noticeCalls).toEqual([`${zh('common.insertLinkFailed')}boom`]);
		expect(errorSpy).toHaveBeenCalledWith('插入链接失败', expect.any(Error));
		errorSpy.mockRestore();
	});

	it('非 Error 抛出（字符串）：经 errorMessage 归一后仍给出提示', async () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		openLinkMock.mockRejectedValue('断网');

		await expect(addLinkToActiveNode(view)).resolves.toBeUndefined();

		expect(noticeCalls).toEqual([`${zh('common.insertLinkFailed')}断网`]);
		errorSpy.mockRestore();
	});
});

describe('applyDocWikiLink / applyNodeAttachment（导出通道写入）', () => {
	it('applyDocWikiLink：清引擎通道 + 写双链通道 + 同步可见文本 + 重绘保存', () => {
		const node = fakeNode({ data: { hyperlink: 'https://旧', hyperlinkTitle: '旧' } });
		const { view, execCommand, render, scheduleSave } = makeView();

		applyDocWikiLink(view, node, '[[笔记|别名]]', undefined);

		const data = dataOf(node);
		expect(data.hyperlink).toBeUndefined();
		expect(data.hyperlinkTitle).toBeUndefined();
		expect(data.mdWikiLinkpath).toBe('[[笔记|别名]]');
		expect(data.mdLinkStyle).toBe('wiki');
		expect(data.mdLinkText).toBe('别名');
		expect(execCommand).not.toHaveBeenCalled();
		expect(markNodeNeedLayoutMock).toHaveBeenCalledWith(node);
		expect(setNodeTextMock).toHaveBeenCalledWith(view.mindMap, node, '别名');
		expect(render).toHaveBeenCalled();
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('applyDocWikiLink：显式 label 为空串时不写可见文本、不走节点文本同步', () => {
		const node = fakeNode({ data: { text: '正文' } });
		const { view } = makeView();

		applyDocWikiLink(view, node, '[[笔记]]', '');

		expect(dataOf(node).mdLinkText).toBe('');
		expect(setNodeTextMock).not.toHaveBeenCalled();
	});

	it('applyNodeAttachment：走资源地址 + 回写库内完整路径 + 清链接通道', () => {
		const node = fakeNode({
			data: {
				text: '正文',
				hyperlink: 'https://旧',
				mdWikiLinkpath: '[[旧]]',
				mdLinkText: '旧',
			},
		});
		const file = fakeFile('附件/报告.pdf', 'pdf');
		const { view, render, scheduleSave, getResourcePath } = makeView();

		applyNodeAttachment(view, node, file);

		const data = dataOf(node);
		expect(getResourcePath).toHaveBeenCalledWith(file);
		expect(data.attachmentUrl).toBe('app://local/附件/报告.pdf');
		expect(data.attachmentName).toBe('报告.pdf');
		// basename 会被 Obsidian 去掉扩展名，回写必须用完整库内路径
		expect(data.mdAttachmentLinkpath).toBe('附件/报告.pdf');
		expect(data.mdLinkStyle).toBe('wiki');
		expect(data.hyperlink).toBeUndefined();
		expect(data.mdWikiLinkpath).toBeUndefined();
		expect(markNodeNeedLayoutMock).toHaveBeenCalledWith(node);
		// 纯双链化：拖入附件即覆盖节点文字为文件名（与文档双链同口径）
		expect(setNodeTextMock).toHaveBeenCalledWith(view.mindMap, node, '报告.pdf');
		expect(render).toHaveBeenCalled();
		expect(scheduleSave).toHaveBeenCalled();
	});
});

describe('removeNodeText / clearNodeHyperlink', () => {
	it('移除文字：清空节点文本并调度保存（图片/链接等其余数据保留）', () => {
		const node = fakeNode({ data: { text: '文字', image: 'a.png' } });
		const { view, scheduleSave } = makeView();

		removeNodeText(view, node);

		expect(setNodeTextMock).toHaveBeenCalledWith(view.mindMap, node, '');
		expect(scheduleSave).toHaveBeenCalled();
		expect(dataOf(node).image).toBe('a.png');
	});

	it('移除文字：引擎缺失时静默返回（视图重建中不抛错）', () => {
		const { view, scheduleSave } = makeView({ withEngine: false });
		removeNodeText(view, fakeNode());
		expect(setNodeTextMock).not.toHaveBeenCalled();
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('清除链接：两个通道都为空时直接返回（不重绘、不保存）', () => {
		const node = fakeNode({ data: { text: '正文' } });
		const { view, execCommand, render, scheduleSave } = makeView();

		clearNodeHyperlink(view, node);

		expect(execCommand).not.toHaveBeenCalled();
		expect(render).not.toHaveBeenCalled();
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('清除链接：文档双链通道非引擎字段，先删字段再发引擎清空命令并重绘', () => {
		const node = fakeNode({
			data: { mdWikiLinkpath: '[[笔记]]', mdLinkText: '笔记' },
		});
		const { view, execCommand, render, scheduleSave } = makeView();

		clearNodeHyperlink(view, node);

		expect(dataOf(node).mdWikiLinkpath).toBeUndefined();
		expect(dataOf(node).mdLinkText).toBeUndefined();
		expect(markNodeNeedLayoutMock).toHaveBeenCalledWith(node);
		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_HYPERLINK,
			node,
			'',
		]);
		expect(render).toHaveBeenCalled();
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('清除链接：引擎 hyperlink 通道同样被清空（双通道都识别）', () => {
		const node = fakeNode({ data: { hyperlink: 'https://example.com' } });
		const { view, execCommand } = makeView();

		clearNodeHyperlink(view, node);

		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_HYPERLINK,
			node,
			'',
		]);
	});
});

describe('deleteActiveNode（删除编排与兜底）', () => {
	it('常规路径：引擎 REMOVE_NODE + 按对象身份兜底清除 + 保存调度', () => {
		const node = fakeNode({ data: { text: '待删' } });
		const { view, execCommand, scheduleSave } = makeView({ activeNode: node });

		deleteActiveNode(view);

		expect(callArgs(execCommand)).toEqual([ENGINE.REMOVE_NODE]);
		// 兜底：uid 重复/缺失时引擎删除可能失败，父节点按对象身份再清一次
		expect(forceRemoveMock).toHaveBeenCalledWith(
			view.mindMap,
			node.parent,
			node.nodeData,
		);
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('根节点不可删除：提示且不触碰引擎、不保存', () => {
		const node = fakeNode({ isRoot: true });
		const { view, execCommand, scheduleSave } = makeView({ activeNode: node });

		deleteActiveNode(view);

		expect(noticeCalls).toEqual([zh('common.rootCannotDelete')]);
		expect(execCommand).not.toHaveBeenCalled();
		expect(forceRemoveMock).not.toHaveBeenCalled();
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('无激活节点：提示且不触碰引擎', () => {
		const { view, execCommand } = makeView();
		deleteActiveNode(view);
		expect(noticeCalls).toEqual([zh('common.selectNodeFirst')]);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('无父节点（游离节点）：仍走 REMOVE_NODE，但跳过兜底清除', () => {
		const node = fakeNode({ parent: null });
		const { view, execCommand, scheduleSave } = makeView({ activeNode: node });

		deleteActiveNode(view);

		expect(execCommand).toHaveBeenCalledTimes(1);
		expect(forceRemoveMock).not.toHaveBeenCalled();
		expect(scheduleSave).toHaveBeenCalled();
	});
});

describe('copyNode / pasteNodeAsChild（视图剪贴板）', () => {
	it('复制：深拷贝节点数据并提示「节点已复制」', () => {
		const source = fakeNode({ data: { text: '来源', uid: 'u1' } });
		const parent = fakeNode({ data: { text: '父' } });
		const { view, execCommand } = makeView({ activeNode: source });

		copyNode(view, source);

		expect(noticeCalls).toEqual([zh('common.nodeCopied')]);
		// 深拷贝：复制后修改源节点数据不影响剪贴板内容
		dataOf(source)['text'] = '被改过';
		pasteNodeAsChild(view, parent);
		const [, , , payload] = callArgs(execCommand);
		expect((payload as Record<string, unknown>)['text']).toBe('来源');
	});

	it('复制：节点无 getData 时回退读 nodeData.data', () => {
		const source = fakeNode({
			data: { text: '无 getData' },
			withGetData: false,
		});
		const parent = fakeNode();
		const { view, execCommand } = makeView({ activeNode: parent });

		copyNode(view, source);
		pasteNodeAsChild(view, parent);

		const [, , , payload] = callArgs(execCommand);
		expect((payload as Record<string, unknown>)['text']).toBe('无 getData');
	});

	it('未复制时粘贴：提示「剪贴板为空」且不调用引擎', () => {
		const parent = fakeNode();
		const { view, execCommand } = makeView({ activeNode: parent });

		pasteNodeAsChild(view, parent);

		expect(noticeCalls).toEqual([zh('common.clipboardEmpty')]);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('剪贴板按视图隔离：另一个视图看不到本视图的剪贴板', () => {
		const source = fakeNode({ data: { text: '来源' } });
		const first = makeView({ activeNode: source });
		copyNode(first.view, source);

		const parent = fakeNode();
		const second = makeView({ activeNode: parent });
		pasteNodeAsChild(second.view, parent);

		expect(noticeCalls).toEqual([zh('common.nodeCopied'), zh('common.clipboardEmpty')]);
		expect(second.execCommand).not.toHaveBeenCalled();
	});

	it('粘贴到指定父节点：剥离 uid/isActive，保留其余数据', () => {
		const source = fakeNode({
			data: {
				text: '来源',
				uid: 'u1',
				isActive: true,
				mdWikiLinkpath: '[[笔记]]',
				children: [],
			},
		});
		const parent = fakeNode({ data: { text: '父' } });
		const { view, execCommand } = makeView({ activeNode: source });
		copyNode(view, source);

		pasteNodeAsChild(view, parent);

		const [command, flag, parents, payload] = callArgs(execCommand);
		expect(command).toBe(ENGINE.INSERT_CHILD_NODE);
		expect(flag).toBe(false);
		expect(parents).toEqual([parent]);
		const data = payload as Record<string, unknown>;
		expect(data['uid']).toBeUndefined();
		expect(data['isActive']).toBe(false);
		expect(data['text']).toBe('来源');
		// md 回写通道随节点数据一起带过去（粘贴出来的副本仍是文档链接节点）
		expect(data['mdWikiLinkpath']).toBe('[[笔记]]');
	});

	it('未指定父节点：挂到渲染根节点下（空父节点会静默失效）', () => {
		const source = fakeNode({ data: { text: '来源' } });
		const root = fakeNode({ data: { text: '中心' } });
		const { view, execCommand } = makeView({ activeNode: source, root });
		copyNode(view, source);

		pasteNodeAsChild(view, null);

		const [, , parents] = callArgs(execCommand);
		expect(parents).toEqual([root]);
	});

	it('未指定父节点且渲染根为空：静默失败（不调用引擎也不提示）', () => {
		const source = fakeNode({ data: { text: '来源' } });
		const { view, execCommand } = makeView({ activeNode: source, root: null });
		copyNode(view, source);
		noticeCalls.length = 0;

		pasteNodeAsChild(view, null);

		expect(execCommand).not.toHaveBeenCalled();
		expect(noticeCalls).toHaveLength(0);
	});
});

describe('图片操作（re-export 契约与自兜错误）', () => {
	it('removeNodeImage：SET_NODE_IMAGE 清空图片并删掉 md 回写元数据', () => {
		const node = fakeNode({
			data: {
				text: '图',
				image: 'app://local/a.png',
				mdImageTarget: 'a.png',
				mdImageWidth: 300,
				mdImageHeight: 150,
				mdImageAlt: '说明',
			},
		});
		const { view, execCommand, scheduleSave } = makeView();

		removeNodeImage(view, node);

		// 用 createSetNodeImageOptions(null) 清空：image 已空而 mdImageTarget 仍在
		// 会让序列化的「图片已被移除」判定失效（旧图下次保存复活）
		expect(setImageOptionsMock).toHaveBeenCalledWith(null);
		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_IMAGE,
			node,
			{ url: null },
		]);
		const data = dataOf(node);
		expect(data.mdImageTarget).toBeUndefined();
		expect(data.mdImageWidth).toBeUndefined();
		expect(data.mdImageHeight).toBeUndefined();
		expect(data.mdImageAlt).toBeUndefined();
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('addImageToActiveNode：无激活节点只提示，不打开弹窗', async () => {
		const { view, execCommand } = makeView();

		await addImageToActiveNode(view);

		expect(noticeCalls).toEqual([zh('common.selectNodeFirst')]);
		expect(openImageMock).not.toHaveBeenCalled();
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('addImageToActiveNode：弹窗取消不触碰引擎', async () => {
		const node = fakeNode();
		const { view, execCommand, scheduleSave } = makeView({ activeNode: node });
		openImageMock.mockResolvedValue(null);

		await addImageToActiveNode(view);

		expect(execCommand).not.toHaveBeenCalled();
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('addImageToActiveNode：确认后库内路径归一为资源地址并记录回写目标', async () => {
		const node = fakeNode();
		const { view, execCommand, scheduleSave } = makeView({ activeNode: node });
		const file = fakeFile('assets/图.png', 'png');
		resolveMock.mockReturnValue(file);
		openImageMock.mockResolvedValue('assets/图.png');

		await addImageToActiveNode(view);

		expect(openImageMock).toHaveBeenCalledWith(
			view.app,
			'',
			expect.any(Function),
			'zh',
		);
		// 显示走资源地址（app://），回写目标仍是库内路径
		expect(aspectImageOptionsMock).toHaveBeenCalledWith('app://local/assets/图.png');
		expect(callArgs(execCommand)).toEqual([
			ENGINE.SET_NODE_IMAGE,
			node,
			{ aspect: true },
		]);
		expect(dataOf(node).mdImageTarget).toBe('assets/图.png');
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('addImageToActiveNode：弹窗期间引擎被重建则不写入', async () => {
		const node = fakeNode();
		const harness = makeView({ activeNode: node });
		const rebuilt = makeEngine();
		openImageMock.mockImplementation(async () => {
			harness.raw.mindMap = rebuilt;
			return 'assets/图.png';
		});

		await addImageToActiveNode(harness.view);

		expect(harness.execCommand).not.toHaveBeenCalled();
		expect(rebuilt.execCommand).not.toHaveBeenCalled();
		expect(dataOf(node).mdImageTarget).toBeUndefined();
		expect(harness.scheduleSave).not.toHaveBeenCalled();
	});

	it('addImageToActiveNode：内部异常不外抛，转成用户可见提示', async () => {
		const node = fakeNode();
		const { view } = makeView({ activeNode: node });
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		openImageMock.mockRejectedValue(new Error('boom'));

		await expect(addImageToActiveNode(view)).resolves.toBeUndefined();

		expect(noticeCalls).toEqual([`${zh('common.insertImageFailed')}boom`]);
		expect(errorSpy).toHaveBeenCalledWith('插入图片失败', expect.any(Error));
		errorSpy.mockRestore();
	});
});
