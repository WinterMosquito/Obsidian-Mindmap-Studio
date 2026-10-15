/**
 * view-clipboard 回归：系统剪贴板三入口的编排与让位判定（2026-10-13 裁决）。
 *
 * 关注点（本模块自身的分支，不测引擎与解析实现）：
 * - 复制：子树 → Markdown 大纲写入系统剪贴板 + 提示「复制」；未选中节点提示；
 *   写入失败提示「无法访问剪贴板」；
 * - 剪切：**空结果不动剪贴板**（只选中根节点时引擎回调空数组，照写会清空用户
 *   剪贴板）且不提示；成功时静默写入并调度保存；
 * - 粘贴：菜单入口（异步读）与事件入口（同步 clipboardData）共用同一落点与
 *   插入调用；输入类目标/编辑态/空文本一律**让位**；
 * - 快捷键钩子：`Control+c/x/v` 返回 true（取消引擎行为），其余键放行。
 *
 * 剪贴板 IO 与引擎防腐层以 stub 替换；Markdown 解析/序列化用**真实现**
 * （文本形态契约由 tests/clipboard-outline.test.ts 单独覆盖，此处验证接线）。
 * Notice 断言用 `t(lang, key)` 取真实文案，手写字符串会让测试与实现脱钩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { t, type TranslationKey } from '../src/core/i18n';
import type { PasteClipboardHost } from '../src/features/view-common';
import type { MindMapNode, MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
// 被测模块（vi.mock 由 vitest 提升到 import 之前，故此处导入即拿到桩）
import {
	copySelectedNodes,
	cutSelectedNodes,
	handleClipboardShortcut,
	pasteClipboardIntoNode,
	pasteFromClipboardEvent,
} from '../src/features/view-clipboard';

const {
	noticeCalls,
	collectSelectedSubtreesMock,
	cutSelectedSubtreesMock,
	getActiveNodeMock,
	getRenderRootMock,
	insertSubtreesAsChildrenMock,
	writeClipboardTextMock,
	readClipboardTextMock,
	isAnyNodeEditingMock,
} = vi.hoisted(() => ({
	noticeCalls: [] as string[],
	collectSelectedSubtreesMock: vi.fn<(mindMap: unknown) => unknown>(),
	cutSelectedSubtreesMock: vi.fn<(mindMap: unknown) => unknown>(),
	getActiveNodeMock: vi.fn<(mindMap: unknown) => unknown>(),
	getRenderRootMock: vi.fn<(mindMap: unknown) => unknown>(),
	insertSubtreesAsChildrenMock:
		vi.fn<(mindMap: unknown, parent: unknown, subtrees: unknown) => boolean>(),
	writeClipboardTextMock: vi.fn<(text: string) => Promise<boolean>>(),
	readClipboardTextMock: vi.fn<() => Promise<string | null>>(),
	isAnyNodeEditingMock: vi.fn<(mindMap: unknown) => boolean>(),
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

vi.mock('../src/engine/mindmap', () => ({
	// view-common 在模块加载期读它（插入子节点路径）；取值与生产表一致
	ENGINE_COMMANDS: { INSERT_CHILD_NODE: 'INSERT_CHILD_NODE' },
	getActiveNode: getActiveNodeMock,
	getRenderRoot: getRenderRootMock,
	collectSelectedSubtrees: collectSelectedSubtreesMock,
	cutSelectedSubtrees: cutSelectedSubtreesMock,
	insertSubtreesAsChildren: insertSubtreesAsChildrenMock,
}));

vi.mock('../src/platform/clipboard', () => ({
	writeClipboardText: writeClipboardTextMock,
	readClipboardText: readClipboardTextMock,
}));

vi.mock('../src/features/node-inline-editor', () => ({
	isAnyNodeEditing: isAnyNodeEditingMock,
}));

/** 取真实中文文案（key 拼错即编译失败） */
function zh(key: TranslationKey): string {
	return t('zh', key);
}

/** 等待剪贴板写入的微任务链落地（实现用 `void promise.then` 收尾） */
async function flush(): Promise<void> {
	// window.setTimeout：与插件运行时（Electron 渲染进程 / popout 窗口）同一计时器源
	await new Promise<void>((resolve) => {
		window.setTimeout(resolve, 0);
	});
}

/** 宿主桩：只提供剪贴板收口声明的最小面 */
function makeHost(): {
	host: PasteClipboardHost;
	scheduleSave: Mock<() => void>;
} {
	const scheduleSave = vi.fn<() => void>();
	const host = {
		mindMap: { renderer: {} },
		app: {},
		lang: 'zh',
		scheduleSave,
	};
	return { host: host as unknown as PasteClipboardHost, scheduleSave };
}

/** 剪贴板事件桩（Node 环境无 ClipboardEvent） */
function fakePasteEvent(
	text: string,
	target: unknown = null,
): { event: ClipboardEvent; preventDefault: Mock<() => void> } {
	const preventDefault = vi.fn<() => void>();
	const event = {
		target,
		clipboardData: {
			getData: (type: string): string => (type === 'text/plain' ? text : ''),
		},
		preventDefault,
	} as unknown as ClipboardEvent;
	return { event, preventDefault };
}

/** 取自解析产物的最小子树（mdRaw/mdDerivedText 齐备 ⇒ 逐字回写形态） */
function subtree(): MindMapTreeNode {
	return {
		data: {
			text: '甲',
			mdRaw: '甲',
			mdDerivedText: '甲',
			mdType: 'list',
			mdMarker: '-',
		},
		children: [],
	};
}

beforeEach(() => {
	noticeCalls.length = 0;
	vi.clearAllMocks();
	collectSelectedSubtreesMock.mockReturnValue([]);
	cutSelectedSubtreesMock.mockReturnValue([]);
	getActiveNodeMock.mockReturnValue(null);
	getRenderRootMock.mockReturnValue(null);
	insertSubtreesAsChildrenMock.mockReturnValue(true);
	writeClipboardTextMock.mockResolvedValue(true);
	readClipboardTextMock.mockResolvedValue(null);
	isAnyNodeEditingMock.mockReturnValue(false);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('复制（copySelectedNodes）', () => {
	it('子树写为 Markdown 大纲并提示「复制」', async () => {
		collectSelectedSubtreesMock.mockReturnValue([subtree()]);
		const { host } = makeHost();

		copySelectedNodes(host);
		await flush();

		expect(writeClipboardTextMock).toHaveBeenCalledWith('- 甲');
		expect(noticeCalls).toEqual([zh('common.nodeCopied')]);
		expect(zh('common.nodeCopied')).toBe('复制');
	});

	it('未选中节点：提示且不触碰剪贴板', () => {
		const { host } = makeHost();

		copySelectedNodes(host);

		expect(noticeCalls).toEqual([zh('common.selectNodeFirst')]);
		expect(writeClipboardTextMock).not.toHaveBeenCalled();
	});

	it('写入失败：提示「无法访问剪贴板」而不是静默', async () => {
		collectSelectedSubtreesMock.mockReturnValue([subtree()]);
		writeClipboardTextMock.mockResolvedValue(false);
		const { host } = makeHost();

		copySelectedNodes(host);
		await flush();

		expect(noticeCalls).toEqual([zh('common.clipboardError')]);
	});
});

describe('剪切（cutSelectedNodes）', () => {
	it('空结果：不动剪贴板、不提示、不保存（只选中根节点时的守卫）', () => {
		cutSelectedSubtreesMock.mockReturnValue([]);
		const { host, scheduleSave } = makeHost();

		cutSelectedNodes(host);

		expect(writeClipboardTextMock).not.toHaveBeenCalled();
		expect(noticeCalls).toHaveLength(0);
		expect(scheduleSave).not.toHaveBeenCalled();
	});

	it('成功：静默写入（不提示「复制」）并调度保存', async () => {
		cutSelectedSubtreesMock.mockReturnValue([subtree()]);
		const { host, scheduleSave } = makeHost();

		cutSelectedNodes(host);
		await flush();

		expect(writeClipboardTextMock).toHaveBeenCalledWith('- 甲');
		expect(noticeCalls).toHaveLength(0);
		expect(scheduleSave).toHaveBeenCalledTimes(1);
	});
});

describe('粘贴：事件入口（pasteFromClipboardEvent）', () => {
	it('文本 → 解析为子树并插入落点，接管事件', () => {
		const target = { uid: 'n1' };
		getActiveNodeMock.mockReturnValue(target);
		const { host, scheduleSave } = makeHost();
		const { event, preventDefault } = fakePasteEvent('# 一\n## 二');

		expect(pasteFromClipboardEvent(host, event)).toBe(true);

		const [, parent, subtrees] = insertSubtreesAsChildrenMock.mock.calls[0]!;
		expect(parent).toBe(target);
		expect(subtrees).toHaveLength(1);
		expect(preventDefault).toHaveBeenCalled();
		expect(scheduleSave).toHaveBeenCalledTimes(1);
	});

	it('输入类目标让位（粘贴进编辑框是文本语义）', () => {
		const { host } = makeHost();
		const { event, preventDefault } = fakePasteEvent('- 甲', {
			isContentEditable: true,
		});

		expect(pasteFromClipboardEvent(host, event)).toBe(false);
		expect(insertSubtreesAsChildrenMock).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
	});

	it('节点编辑态让位（引擎编辑框/内联编辑器）', () => {
		isAnyNodeEditingMock.mockReturnValue(true);
		const { host } = makeHost();
		const { event } = fakePasteEvent('- 甲');

		expect(pasteFromClipboardEvent(host, event)).toBe(false);
		expect(insertSubtreesAsChildrenMock).not.toHaveBeenCalled();
	});

	it('非文本载荷（空文本）让位：图片分支自己处理', () => {
		const { host } = makeHost();
		const { event, preventDefault } = fakePasteEvent('');

		expect(pasteFromClipboardEvent(host, event)).toBe(false);
		expect(insertSubtreesAsChildrenMock).not.toHaveBeenCalled();
		expect(preventDefault).not.toHaveBeenCalled();
	});

	it('未选中节点：挂渲染根；根也没有时提示未就绪', () => {
		const root = { uid: 'root' };
		getRenderRootMock.mockReturnValueOnce(root);
		const { host } = makeHost();
		pasteFromClipboardEvent(host, fakePasteEvent('- 甲').event);
		expect(insertSubtreesAsChildrenMock.mock.calls[0]![1]).toBe(root);

		insertSubtreesAsChildrenMock.mockReturnValue(false);
		noticeCalls.length = 0;
		pasteFromClipboardEvent(host, fakePasteEvent('- 甲').event);
		expect(noticeCalls).toEqual([zh('common.notLoaded')]);
	});
});

describe('粘贴：菜单入口（pasteClipboardIntoNode）', () => {
	it('读取剪贴板文本后插入指定落点', async () => {
		readClipboardTextMock.mockResolvedValue('- 甲');
		const target = { uid: 'n1' } as unknown as MindMapNode;
		const { host } = makeHost();

		pasteClipboardIntoNode(host, target);
		await flush();

		expect(insertSubtreesAsChildrenMock.mock.calls[0]![1]).toBe(target);
	});

	it('读取失败 / 剪贴板为空：分别提示，不插入', async () => {
		const { host } = makeHost();

		readClipboardTextMock.mockResolvedValue(null);
		pasteClipboardIntoNode(host, null);
		await flush();
		expect(noticeCalls).toEqual([zh('common.clipboardError')]);

		noticeCalls.length = 0;
		readClipboardTextMock.mockResolvedValue('   ');
		pasteClipboardIntoNode(host, null);
		await flush();
		expect(noticeCalls).toEqual([zh('common.clipboardEmpty')]);

		expect(insertSubtreesAsChildrenMock).not.toHaveBeenCalled();
	});
});

describe('快捷键钩子（handleClipboardShortcut）', () => {
	it('剪贴板三键取消引擎行为，其余键放行', () => {
		const { host } = makeHost();
		collectSelectedSubtreesMock.mockReturnValue([subtree()]);

		for (const key of ['Control+c', 'Control+x', 'Control+v']) {
			expect(handleClipboardShortcut(host, key)).toBe(true);
		}
		// 非剪贴板键必须放行：否则添加子节点/重做等既有快捷键会一起失效
		for (const key of ['Tab', 'Enter', 'Control+Enter', 'Control+z']) {
			expect(handleClipboardShortcut(host, key)).toBe(false);
		}
	});
});
