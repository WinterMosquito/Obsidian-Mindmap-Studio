/**
 * view-node-actions 回归测试：requireActiveNode 前置守卫（含提示）、
 * 链接/删除/复制粘贴节点操作流的引擎命令编排。
 *
 * mindmap.ts 防腐层与两个弹窗模块以 stub 替换（本测试只验证
 * view-node-actions 自身的编排与守卫逻辑，不验证引擎封装）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { MindMap, MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	addLinkToActiveNode,
	copyNode,
	deleteActiveNode,
	pasteNodeAsChild,
	requireActiveNode,
} from '../src/features/view-node-actions';

const { noticeCalls, setNodeTextMock, forceRemoveMock, openLinkModal, openImageModal } =
	vi.hoisted(() => ({
		noticeCalls: [] as string[],
		setNodeTextMock: vi.fn<(...args: unknown[]) => void>(),
		forceRemoveMock: vi.fn<(...args: unknown[]) => void>(),
		openLinkModal: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
		openImageModal: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
	ENGINE_COMMANDS: {
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
	getActiveNode: (
		mm: { renderer?: { activeNodeList?: unknown[] } } | null,
	): unknown => (mm?.renderer ? (mm.renderer.activeNodeList?.[0] ?? null) : null),
	getNodeDataString: (node: { getData?: (k: string) => unknown }, key: string) => {
		const value = node.getData?.(key);
		return typeof value === 'string' ? value : '';
	},
	setNodeText: (...args: unknown[]): void => {
		setNodeTextMock(...args);
	},
	forceRemoveNodeData: (...args: unknown[]): void => {
		forceRemoveMock(...args);
	},
	getRenderRoot: () => null,
}));

vi.mock('../src/modal-image', () => ({
	openImageEditorModal: (...args: unknown[]): Promise<unknown> =>
		openImageModal(...args),
}));
vi.mock('../src/modal-link', () => ({
	openLinkEditorModal: (...args: unknown[]): Promise<unknown> =>
		openLinkModal(...args),
}));

/** 构造引擎/节点/视图桩 */
function makeHarness(activeNode: MindMapNode | null) {
	const execCommand = vi.fn();
	const mindMap = {
		renderer: { activeNodeList: activeNode ? [activeNode] : [], root: null },
		execCommand,
	} as unknown as MindMap;
	const scheduleSave = vi.fn();
	const view = {
		mindMap,
		lang: 'zh',
		app: {} as App,
		file: null,
		scheduleSave,
	} as unknown as MindMapViewContext;
	return { execCommand, mindMap, scheduleSave, view };
}

function fakeNode(opts: { data?: Record<string, unknown>; isRoot?: boolean } = {}) {
	const data: Record<string, unknown> = {
		text: '',
		hyperlink: '',
		image: '',
		...opts.data,
	};
	return {
		// 引擎语义：getData() 返回节点 data 对象本身；getData(key) 返回字段值
		getData: (key?: string) => (key === undefined ? data : data[key]),
		isRoot: opts.isRoot ?? false,
		parent: { nodeData: { children: [] } },
		nodeData: { data },
	} as unknown as MindMapNode;
}

describe('requireActiveNode（前置守卫）', () => {
	beforeEach(() => {
		noticeCalls.length = 0;
	});

	it('无激活节点：返回 null 并提示「请先选择一个节点」', () => {
		const { view } = makeHarness(null);
		expect(requireActiveNode(view)).toBeNull();
		expect(noticeCalls).toContain('请先选择一个节点');
	});

	it('有激活节点：返回节点且不提示', () => {
		const node = fakeNode();
		const { view } = makeHarness(node);
		expect(requireActiveNode(view)).toBe(node);
		expect(noticeCalls).toHaveLength(0);
	});
});

describe('addLinkToActiveNode（链接插入编排）', () => {
	beforeEach(() => {
		noticeCalls.length = 0;
		setNodeTextMock.mockClear();
		openLinkModal.mockReset();
	});

	it('弹窗取消（null）不触碰引擎', async () => {
		const node = fakeNode();
		const { execCommand, view } = makeHarness(node);
		openLinkModal.mockResolvedValue(null);
		await addLinkToActiveNode(view);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('确认后写入超链接并同步可见文本', async () => {
		const node = fakeNode();
		const { execCommand, scheduleSave, view } = makeHarness(node);
		openLinkModal.mockResolvedValue({ link: '[[新笔记]]', label: null });
		await addLinkToActiveNode(view);
		expect(execCommand).toHaveBeenCalledWith(
			'SET_NODE_HYPERLINK',
			node,
			'[[新笔记]]',
		);
		// 节点文本为空 → 可见文本同步为链接显示名
		expect(setNodeTextMock).toHaveBeenCalledWith(
			view.mindMap,
			node,
			'新笔记',
		);
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('协议链接（http）只挂超链接图标，不改节点文本', async () => {
		const node = fakeNode({ data: { text: '' } });
		const { execCommand, view } = makeHarness(node);
		openLinkModal.mockResolvedValue({ link: 'https://example.com', label: null });
		await addLinkToActiveNode(view);
		expect(execCommand).toHaveBeenCalledWith(
			'SET_NODE_HYPERLINK',
			node,
			'https://example.com',
		);
		expect(setNodeTextMock).not.toHaveBeenCalled();
	});
});

describe('deleteActiveNode（删除编排与兜底）', () => {
	beforeEach(() => {
		noticeCalls.length = 0;
		forceRemoveMock.mockClear();
	});

	it('执行 REMOVE_NODE + 兜底强制清除 + 保存调度', () => {
		const node = fakeNode();
		const { execCommand, scheduleSave, view } = makeHarness(node);
		deleteActiveNode(view);
		expect(execCommand).toHaveBeenCalledWith('REMOVE_NODE');
		expect(forceRemoveMock).toHaveBeenCalledTimes(1);
		expect(scheduleSave).toHaveBeenCalled();
	});

	it('根节点不可删除：提示且不触碰引擎', () => {
		const node = fakeNode({ isRoot: true });
		const { execCommand, view } = makeHarness(node);
		deleteActiveNode(view);
		expect(noticeCalls).toContain('根节点不可删除');
		expect(execCommand).not.toHaveBeenCalled();
	});
});

describe('copyNode / pasteNodeAsChild（视图剪贴板）', () => {
	beforeEach(() => {
		noticeCalls.length = 0;
	});

	it('未复制时粘贴提示「剪贴板为空」', () => {
		const node = fakeNode();
		const { execCommand, view } = makeHarness(node);
		pasteNodeAsChild(view, node);
		expect(noticeCalls).toContain('剪贴板为空');
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('复制后粘贴：深拷贝数据经 INSERT_CHILD_NODE 挂到指定父节点', () => {
		const parent = fakeNode({ data: { text: '父' } });
		const { execCommand, view } = makeHarness(parent);
		copyNode(
			view,
			fakeNode({ data: { text: '来源', uid: 'u1', isActive: true } }),
		);
		expect(noticeCalls).toContain('节点已复制');
		pasteNodeAsChild(view, parent);
		expect(execCommand).toHaveBeenCalledTimes(1);
		const [command, appointNodesFlag, parents, initialData] =
			execCommand.mock.calls[0] as unknown as [
				string,
				boolean,
				unknown[],
				Record<string, unknown>,
			];
		expect(command).toBe('INSERT_CHILD_NODE');
		expect(appointNodesFlag).toBe(false);
		expect(parents).toEqual([parent]);
		// uid/激活态剥离，文本保留
		expect(initialData['uid']).toBeUndefined();
		expect(initialData['isActive']).toBe(false);
		expect(initialData['text']).toBe('来源');
	});
});
