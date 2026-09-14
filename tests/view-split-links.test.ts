/**
 * view-split-links 自动拆分回归：候选捕获（编辑期节点集）与检查语义。
 *
 * 关注点（模块自身的分支，非 mock 行为）：
 * - `autoSplitNode`：设置关 / 未编辑（text === mdDerivedText）/ 编辑中 → no-op；
 *   被编辑的可拆节点 → 走真实拆分（链接抽为子节点，引擎命令逐条插入）；
 * - `captureAutoSplitCandidate` + `runAutoSplitCheck`：候选集逐个检查（与「当前
 *   激活节点」无关——编辑提交后快速切换激活也不漏拆）；编辑中**保留候选**等
 *   下一次检查（不丢已编辑未拆分的节点）；引擎换代（换文件/重载）整体丢弃。
 *
 * 引擎命令、mindmap 防腐层以桩替换（同 view-node-actions 测试模式）；
 * 节点数据来自**真实解析**（parseMdOutline），拆分逻辑走真实 links-split。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	autoSplitNode,
	captureAutoSplitCandidate,
	runAutoSplitCheck,
} from '../src/features/view-split-links';
import { parseMdOutline } from '../src/markdown/md-outline';

const { execCommandMock, setNodeTextMock, isEditingTextMock, ENGINE } = vi.hoisted(
	() => ({
		execCommandMock: vi.fn<(...args: unknown[]) => void>(),
		setNodeTextMock: vi.fn<(...args: unknown[]) => void>(),
		isEditingTextMock: vi.fn<() => boolean>(() => false),
		// 命令名取值与 src/engine/mindmap.ts 的 ENGINE_COMMANDS 一致；常量表本身的
		// token 契约由 vendor-contract 测试把关，这里只验证编排传了哪一个命令。
		ENGINE: {
			INSERT_CHILD_NODE: 'INSERT_CHILD_NODE',
		},
	}),
);

vi.mock('../src/engine/mindmap', () => ({
	ENGINE_COMMANDS: ENGINE,
	setNodeText: (...args: unknown[]): void => {
		setNodeTextMock(...args);
	},
	isEditingText: (): boolean => isEditingTextMock(),
}));

/** 由真实解析产物构造节点桩（getData 返回同一 data 引用，引擎语义） */
function dataNode(md: string): MindMapNode {
	const source = parseMdOutline(md, '根').tree.children[0]!;
	const data = source.data as Record<string, unknown>;
	const node: Record<string, unknown> = {
		isRoot: false,
		parent: { nodeData: { children: [] } },
		nodeData: { data },
		children: [],
		getData: (key?: string): unknown => (key === undefined ? data : data[key]),
	};
	return node as unknown as MindMapNode;
}

/** 模拟「用户编辑过该节点」（text 与解析期快照 mdDerivedText 不同） */
function editNode(node: MindMapNode, text: string): void {
	(node.getData() as Record<string, unknown>).text = text;
}

function makeHarness(settings = { autoSplitMixedLinks: true }) {
	const raw = {
		mindMap: { execCommand: execCommandMock, render: vi.fn() } as unknown,
		app: {} as unknown,
		plugin: { settings },
		scheduleSave: vi.fn<() => void>(),
		lang: 'zh',
	};
	return { view: raw as unknown as MindMapViewContext, raw };
}

beforeEach(() => {
	vi.clearAllMocks();
	isEditingTextMock.mockReturnValue(false);
});

describe('autoSplitNode：自动拆分判定', () => {
	it('设置开启 + 被编辑的可拆节点 → 真实拆分（链接逐条抽为子节点）', () => {
		const { view } = makeHarness();
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');
		editNode(node, '关于问题和');

		expect(autoSplitNode(view, node)).toBe(2);
		expect(setNodeTextMock, '父节点文本同步为拆分后的新行').toHaveBeenCalledTimes(1);
		expect(execCommandMock).toHaveBeenCalledTimes(2);
		expect(execCommandMock.mock.calls[0]![0]).toBe(ENGINE.INSERT_CHILD_NODE);
	});

	it('设置关闭 → 不拆分、不触碰引擎', () => {
		const { view } = makeHarness({ autoSplitMixedLinks: false });
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');
		editNode(node, '关于问题和');

		expect(autoSplitNode(view, node)).toBe(0);
		expect(execCommandMock).not.toHaveBeenCalled();
		expect(setNodeTextMock).not.toHaveBeenCalled();
	});

	it('未被编辑（text === mdDerivedText）→ no-op（决策 R3：只碰被编辑节点）', () => {
		const { view } = makeHarness();
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');

		expect(autoSplitNode(view, node)).toBe(0);
		expect(execCommandMock).not.toHaveBeenCalled();
	});

	it('编辑框仍开着 → no-op（延迟窗口内用户又在编辑）', () => {
		const { view } = makeHarness();
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');
		editNode(node, '关于问题和');
		isEditingTextMock.mockReturnValue(true);

		expect(autoSplitNode(view, node)).toBe(0);
		expect(execCommandMock).not.toHaveBeenCalled();
	});
});

describe('候选捕获与检查（captureAutoSplitCandidate / runAutoSplitCheck）', () => {
	it('按捕获集检查（与「当前激活节点」无关）：提交后切换激活也不漏拆', () => {
		const { view } = makeHarness();
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');
		editNode(node, '关于问题和');
		captureAutoSplitCandidate(view, node);

		// 检查时刻：view 桩中不存在任何激活节点——旧实现（取激活）会漏拆
		runAutoSplitCheck(view);
		expect(execCommandMock).toHaveBeenCalledTimes(2);
	});

	it('编辑中保留候选：本次不拆，编辑结束后的下一次检查补拆', () => {
		const { view } = makeHarness();
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');
		editNode(node, '关于问题和');
		captureAutoSplitCandidate(view, node);
		isEditingTextMock.mockReturnValue(true);

		runAutoSplitCheck(view);
		expect(execCommandMock, '编辑中不拆').not.toHaveBeenCalled();

		isEditingTextMock.mockReturnValue(false);
		runAutoSplitCheck(view);
		expect(execCommandMock, '候选未丢：下次检查补拆').toHaveBeenCalledTimes(2);
	});

	it('引擎换代：旧引擎捕获的候选整体丢弃（不拆游离节点）', () => {
		const { view, raw } = makeHarness();
		const node = dataNode('- 关于 [[冬天]] 和 [[秋天]] 的问题\n');
		editNode(node, '关于问题和');
		captureAutoSplitCandidate(view, node);
		// 120ms 检查窗口内换文件/重载：引擎被重建（旧节点不属于当前文档）
		raw.mindMap = { execCommand: vi.fn(), render: vi.fn() };

		runAutoSplitCheck(view);
		expect(execCommandMock, '旧引擎不被写入').not.toHaveBeenCalled();
		// 候选已作废：新引擎上同样无动作（本用例无从产生新候选）
		runAutoSplitCheck(view);
		expect(execCommandMock).not.toHaveBeenCalled();
	});
});
