/**
 * 子树剪贴板防腐面回归（`src/engine/mindmap.ts` 的四个入口 + 快捷键闸门）。
 *
 * 为什么必须有直测（硬规则 7）：这四个函数承载「复制 / 剪切 / 粘贴」三键的
 * **取值面与落点语义**，此前只经视图层 mock 间接覆盖——2026-10-15 审查发现的
 * 「复制根节点会把整篇文档嵌成自己的子节点」正是**复制路径不过滤根**漏出的：
 * 剪切口径由引擎 `CUT_NODE` 过滤（`vendor` 的 `cutNode` 过滤 `isRoot`，而
 * `copyNode` 不过滤），只测剪切永远测不出来。
 *
 * 桩形态与 `tests/viewport.test.ts` 同源：假 MindMap + **真** `engine/mindmap`。
 */
import { describe, expect, it, vi } from 'vitest';
import type {
	MindMap,
	MindMapNode,
	MindMapTreeNode,
} from '../vendor/simple-mind-map.cjs';
import {
	collectSelectedSubtrees,
	cutSelectedSubtrees,
	ENGINE_COMMANDS,
	insertSubtreesAsChildren,
	isNodeCollapsed,
	shortcutGateAllows,
} from '../src/engine/mindmap';

// mindmap.ts 经 import 链加载真实 vendor bundle（顶层求值触碰
// document.documentElement）；静态 import 先于模块体执行，故桩必须放进
// vi.hoisted 才会先落地（同 viewport.test.ts）
const stubs = vi.hoisted(() => {
	const body = { nodeType: 1, classList: { contains: (): boolean => false } };
	(globalThis as { document?: unknown }).document = {
		documentElement: {},
		body,
	};
	return { body };
});

/** 节点桩描述（只描述防腐层真正读到的字段） */
interface NodeSpec {
	uid: string;
	text: string;
	isRoot?: boolean;
	children?: NodeSpec[];
}

/**
 * 造节点树：**同时**维护两份镜像——运行期 `children`（`rankByDocumentOrder`
 * 走它）与 `nodeData.children`（`cloneSubtreeWithoutUid` 走它）。两者不同源时
 * 引擎自己的复制也会失真，故桩必须与引擎形态一致。
 */
function build(
	spec: NodeSpec,
	parent: MindMapNode | null,
	registry: MindMapNode[],
): MindMapNode {
	const children: MindMapNode[] = [];
	const dataChildren: unknown[] = [];
	const node = {
		uid: spec.uid,
		parent,
		children,
		isRoot: spec.isRoot ?? parent === null,
		nodeData: {
			data: { text: spec.text, uid: spec.uid },
			children: dataChildren,
		},
	} as unknown as MindMapNode;
	registry.push(node);
	for (const childSpec of spec.children ?? []) {
		const child = build(childSpec, node, registry);
		children.push(child);
		dataChildren.push(child.nodeData);
	}
	return node;
}

function makeMindMap(
	rootSpec: NodeSpec,
	activeUids: readonly string[],
): {
	mindMap: MindMap;
	execCommand: ReturnType<typeof vi.fn>;
	nodes: Map<string, MindMapNode>;
} {
	const registry: MindMapNode[] = [];
	const root = build(rootSpec, null, registry);
	const nodes = new Map(registry.map((node) => [node.uid, node]));
	const active = activeUids.map((uid) => {
		const node = nodes.get(uid);
		if (!node) {
			throw new Error(`桩数据缺少选中节点：${uid}`);
		}
		return node;
	});
	const execCommand = vi.fn<(...args: unknown[]) => void>();
	const mindMap = {
		renderer: { root, activeNodeList: active },
		execCommand,
	} as unknown as MindMap;
	return { mindMap, execCommand, nodes };
}

/** 先序文本投影（断言结构与时序用，不含 uid） */
function texts(nodes: readonly MindMapTreeNode[]): string[] {
	return nodes.map((node) => {
		const text = (node.data as Record<string, unknown>).text;
		return typeof text === 'string' ? text : '';
	});
}

const sample: NodeSpec = {
	uid: 'root',
	text: '文档',
	children: [
		{ uid: 'a', text: '甲', children: [{ uid: 'a1', text: '甲一' }] },
		{ uid: 'b', text: '乙' },
	],
};

describe('collectSelectedSubtrees（复制的取值面）', () => {
	it('只选中根节点 ⇒ 空结果（不写剪贴板；调用方走既有提示）', () => {
		const { mindMap } = makeMindMap(sample, ['root']);
		expect(collectSelectedSubtrees(mindMap)).toEqual([]);
	});

	it('根与子节点同时选中 ⇒ 只取非根的那支（根被过滤）', () => {
		const { mindMap } = makeMindMap(sample, ['root', 'a']);
		expect(texts(collectSelectedSubtrees(mindMap))).toEqual(['甲']);
	});

	it('父与子同时选中 ⇒ 顶层去重，只取父（子树已含子）', () => {
		const { mindMap } = makeMindMap(sample, ['a1', 'a']);
		expect(texts(collectSelectedSubtrees(mindMap))).toEqual(['甲']);
	});

	it('乱序激活 ⇒ 按**文档先序**输出（与引擎 sortNodeList 同口径）', () => {
		const { mindMap } = makeMindMap(sample, ['b', 'a1', 'a']);
		expect(texts(collectSelectedSubtrees(mindMap))).toEqual(['甲', '乙']);
	});

	it('uid 逐层剥离（否则粘贴进同一文档会产生重复 uid，删除/查找随即失准）', () => {
		const { mindMap } = makeMindMap(sample, ['a']);
		const subtree = collectSelectedSubtrees(mindMap)[0];
		expect(subtree).toBeDefined();
		const data = subtree!.data as Record<string, unknown>;
		expect(data.uid).toBeUndefined();
		const childData = (subtree!.children[0]?.data ?? {}) as Record<
			string,
			unknown
		>;
		expect(childData.uid).toBeUndefined();
		expect(childData.text).toBe('甲一');
	});

	it('深拷贝：改返回值不影响原树（节点数据不被复制动作篡改）', () => {
		const { mindMap, nodes } = makeMindMap(sample, ['a']);
		const subtree = collectSelectedSubtrees(mindMap)[0]!;
		(subtree.data as Record<string, unknown>).text = '改过的';
		(subtree.children[0]!.data as Record<string, unknown>).text = '也改过的';
		expect(nodes.get('a')?.nodeData.data.text).toBe('甲');
		expect(nodes.get('a1')?.nodeData.data.text).toBe('甲一');
	});

	it('顶层字段与 vendor `copyNodeTree` 同口径：非 `_` 前缀字段带出、`_` 前缀丢弃', () => {
		const { mindMap, nodes } = makeMindMap(sample, ['a']);
		const nodeData = nodes.get('a')!.nodeData as unknown as Record<
			string,
			unknown
		>;
		nodeData.engineFlag = 'kept';
		nodeData._internal = 'dropped';
		const [subtree] = collectSelectedSubtrees(mindMap);
		const clone = subtree as unknown as Record<string, unknown>;
		expect(clone.engineFlag).toBe('kept');
		expect(clone._internal).toBeUndefined();
	});

	it('无选中 / 引擎缺失 ⇒ 空结果（不抛）', () => {
		const { mindMap } = makeMindMap(sample, []);
		expect(collectSelectedSubtrees(mindMap)).toEqual([]);
		expect(collectSelectedSubtrees(null)).toEqual([]);
	});
});

describe('折叠（收起）状态不影响复制取值面（2026-10-15 用户裁决 A）', () => {
	it('收起 a（data.expand=false）前后，复制结果**逐字段一致**且含全部后代', () => {
		const { mindMap, nodes } = makeMindMap(sample, ['a']);
		const before = collectSelectedSubtrees(mindMap);
		const a = nodes.get('a');
		expect(a).toBeDefined();
		a!.nodeData.data.expand = false;
		const after = collectSelectedSubtrees(mindMap);
		// 取值面是**数据树**（nodeData），不看渲染状态/DOM：收起与展开的差别**只有
		// `expand` 字段自身**——它随 data 原样带出（与引擎 `copyNodeTree` 同口径，
		// 即「折叠态也被复制」）；子树结构、后代与文本一字不差
		expect(texts(after)).toEqual(texts(before));
		expect(after[0]!.children).toEqual(before[0]!.children);
		expect(after[0]!.data.expand).toBe(false);
		expect(after[0]!.data.text).toBe('甲');
		expect(texts(after[0]!.children)).toEqual(['甲一']);
	});

	it('收起的是**选中节点本身**：其整棵子树照常进结果（消失的是 DOM，不是数据）', () => {
		const { mindMap, nodes } = makeMindMap(sample, ['a']);
		const a = nodes.get('a')!;
		// 引擎收起语义：只置 expand；⚠ 实机（2026-10-15）证实**渲染后运行期
		// `a.children` 会被引擎摘空**（本桩不模拟该步，故此处仍能读到实例）——
		// 取值面因此只能是 `nodeData`，否则收起一棵子树＝复制丢整棵子树
		a.nodeData.data.expand = false;
		const subtrees = collectSelectedSubtrees(mindMap);
		expect(texts(subtrees)).toEqual(['甲']);
		expect(subtrees[0]!.children).toHaveLength(1);
		expect(a.nodeData.children).toHaveLength(1);
	});
});

describe('cutSelectedSubtrees（剪切的取值面）', () => {
	it('引擎回调数据经深拷贝 + 剥 uid 后返回', () => {
		const { mindMap, execCommand } = makeMindMap(sample, ['a']);
		execCommand.mockImplementation((...args: unknown[]) => {
			const callback = args[1] as (data: unknown) => void;
			callback([
				{
					data: { text: '甲', uid: 'a' },
					children: [{ data: { text: '甲一', uid: 'a1' }, children: [] }],
				},
			]);
		});
		const subtrees = cutSelectedSubtrees(mindMap);
		expect(execCommand.mock.calls[0]?.[0]).toBe(ENGINE_COMMANDS.CUT_NODE);
		expect(texts(subtrees)).toEqual(['甲']);
		expect(subtrees[0]!.data.uid).toBeUndefined();
	});

	it('引擎给非数组（只选中根 ⇒ 引擎过滤后回调空）⇒ 空结果，调用方不动剪贴板', () => {
		const { mindMap, execCommand } = makeMindMap(sample, ['root']);
		execCommand.mockImplementation((...args: unknown[]) => {
			const callback = args[1] as (data: unknown) => void;
			callback([]);
		});
		expect(cutSelectedSubtrees(mindMap)).toEqual([]);
		expect(cutSelectedSubtrees(null)).toEqual([]);
	});
});

describe('insertSubtreesAsChildren（粘贴的唯一落点）', () => {
	it('走 INSERT_MULTI_CHILD_NODE，参数 = [父节点] + 子树', () => {
		const { mindMap, execCommand, nodes } = makeMindMap(sample, []);
		const parent = nodes.get('b')!;
		const subtrees = [{ data: { text: '新' }, children: [] }];
		expect(insertSubtreesAsChildren(mindMap, parent, subtrees)).toBe(true);
		expect(execCommand.mock.calls[0]).toEqual([
			ENGINE_COMMANDS.INSERT_MULTI_CHILD_NODE,
			[parent],
			subtrees,
		]);
	});

	it('空内容 / 无父节点 / 引擎缺失 ⇒ false（不上报引擎）', () => {
		const { mindMap, execCommand, nodes } = makeMindMap(sample, []);
		expect(insertSubtreesAsChildren(mindMap, nodes.get('b')!, [])).toBe(false);
		expect(insertSubtreesAsChildren(mindMap, null, [{ data: {}, children: [] }])).toBe(
			false,
		);
		expect(insertSubtreesAsChildren(null, nodes.get('b')!, [{ data: {}, children: [] }])).toBe(
			false,
		);
		expect(execCommand).not.toHaveBeenCalled();
	});
});

describe('isNodeCollapsed（零尺寸判定：可见性自愈的症状判据）', () => {
	it('0 / 负数 / NaN / 缺失 ⇒ 塌陷（隐藏叶里量为 0×0 的节点）', () => {
		expect(isNodeCollapsed({ width: 0, height: 10 } as unknown as MindMapNode)).toBe(true);
		expect(isNodeCollapsed({ width: 10, height: 0 } as unknown as MindMapNode)).toBe(true);
		expect(isNodeCollapsed({ width: -1, height: 10 } as unknown as MindMapNode)).toBe(true);
		expect(isNodeCollapsed({ width: NaN, height: NaN } as unknown as MindMapNode)).toBe(true);
		expect(isNodeCollapsed({} as unknown as MindMapNode)).toBe(true);
		expect(isNodeCollapsed({ width: '10', height: 10 } as unknown as MindMapNode)).toBe(
			true,
		);
	});

	it('正常尺寸 ⇒ 未塌陷（不误触发重测）', () => {
		expect(isNodeCollapsed({ width: 1, height: 1 } as unknown as MindMapNode)).toBe(false);
		expect(
			isNodeCollapsed({ width: 120.5, height: 40 } as unknown as MindMapNode),
		).toBe(false);
	});
});

describe('shortcutGateAllows（快捷键前置闸门）', () => {
	const editOwner = { editNodeClassList: ['smm-node-editing'] };
	const canvasInside = {
		nodeType: 1,
		classList: { contains: (): boolean => false },
		contains: (): boolean => true,
	};

	it('body / 无目标 ⇒ 放行（引擎默认口径）', () => {
		const canvas = {
			contains: (): boolean => false,
		} as unknown as HTMLElement;
		expect(
			shortcutGateAllows(editOwner, canvas, {
				target: stubs.body,
			} as unknown as KeyboardEvent),
		).toBe(true);
		expect(
			shortcutGateAllows(editOwner, canvas, {
				target: null,
			} as unknown as KeyboardEvent),
		).toBe(true);
	});

	it('引擎编辑类元素 ⇒ 放行（与默认实现同一来源，不另抄类名表）', () => {
		const canvas = { contains: (): boolean => false } as unknown as HTMLElement;
		const editing = {
			nodeType: 1,
			classList: { contains: (cls: string) => cls === 'smm-node-editing' },
		};
		expect(
			shortcutGateAllows(editOwner, canvas, {
				target: editing,
			} as unknown as KeyboardEvent),
		).toBe(true);
	});

	it('画布内的可聚焦元素（代码块复制按钮 / 外链锚点）⇒ 放行（本插件的放宽点）', () => {
		expect(
			shortcutGateAllows(editOwner, canvasInside as unknown as HTMLElement, {
				target: {
					nodeType: 1,
					classList: { contains: (): boolean => false },
				},
			} as unknown as KeyboardEvent),
		).toBe(true);
	});

	it('画布外 ⇒ 不放行（不抢别的视图的快捷键）', () => {
		const canvas = {
			contains: (): boolean => false,
			nodeType: 1,
			classList: { contains: (): boolean => false },
		} as unknown as HTMLElement;
		expect(
			shortcutGateAllows(editOwner, canvas, {
				target: { nodeType: 1, classList: { contains: (): boolean => false } },
			} as unknown as KeyboardEvent),
		).toBe(false);
	});
});
