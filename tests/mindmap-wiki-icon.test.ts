/**
 * 双链文档图标（createNodePrefixContent）回归：图标 SVG 必须由**画布所在的
 * document**（`el.ownerDocument`）创建，而非全局 `document`。
 *
 * 为什么这样断言：同一视图可被拖入 popout 窗口，此时全局 `document` 与画布
 * 所在文档并非同一个；跨文档创建再挂载的 SVG 在 popout 中不渲染、也不响应事件
 * （即官方规则 `obsidianmd/prefer-active-doc` 的语义——而该规则在 recommended
 * 里被关闭，故必须自带护栏）。本文件锁定「图标走 ownerDocument」这一契约，
 * 防止实现退回全局 `document`。
 *
 * vendor cjs 以 vi.mock 桩替代：只验图标构造的文档来源，不需要真实引擎
 * （也避免 Node 下引擎顶层求值触碰 document）。引擎构造参数经 vi.hoisted 捕获。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMapNode, MindMapTreeNode } from '../vendor/simple-mind-map.cjs';
import { createMindMap, type CreateMindMapOptions } from '../src/mindmap';

/** 图标构造签名（引擎 createNodePrefixContent 的最小契约面） */
type PrefixFn = (
	node: MindMapNode,
) => { el: unknown; width: number; height: number } | null;

/** 构造时捕获引擎收到的 createNodePrefixContent（vi.hoisted 供 vi.mock 工厂引用） */
const captured = vi.hoisted(() => ({
	prefix: undefined as
		| ((node: MindMapNode) => { el: unknown; width: number; height: number } | null)
		| undefined,
}));

vi.mock('../vendor/simple-mind-map.cjs', () => ({
	MindMap: class {
		resize = (): void => {};
		constructor(options: {
			createNodePrefixContent?: (
				node: MindMapNode,
			) => { el: unknown; width: number; height: number } | null;
		}) {
			captured.prefix = options.createNodePrefixContent;
		}
		addPlugin(): void {}
		updateConfig(): void {}
	},
	MindMapNode: class {},
	DoExport: class {},
	Select: class {},
	TouchEvent: class {},
	AssociativeLine: class {},
	KeyboardNavigation: class {},
	Search: class {},
	Drag: class {},
}));

/** 最小 SVG 元素桩：只实现图标构造链触碰的成员 */
class FakeSvgEl {
	readonly tagName: string;
	readonly attrs = new Map<string, string>();
	readonly children: FakeSvgEl[] = [];
	readonly classes: string[] = [];
	textContent = '';
	readonly classList = {
		add: (cls: string): void => {
			this.classes.push(cls);
		},
	};
	constructor(tagName: string) {
		this.tagName = tagName;
	}
	setAttribute(name: string, value: string): void {
		this.attrs.set(name, value);
	}
	appendChild(child: FakeSvgEl): void {
		this.children.push(child);
	}
	addEventListener(): void {}
}

/** 伪 document：只提供 SVG 创建（记录调用序列，label 区分来源） */
interface FakeDoc {
	createElementNS: (ns: string, tag: string) => FakeSvgEl;
}

type GlobalWithDocument = { document?: unknown };

const CANVAS_LABEL = 'canvas';
const GLOBAL_LABEL = 'global';

let canvasLog: string[];
let globalLog: string[];
let originalDocument: unknown;

/** 造一个记录调用序列的 document 桩 */
function makeDocStub(label: string, log: string[]): FakeDoc {
	return {
		createElementNS: (_ns: string, tag: string): FakeSvgEl => {
			log.push(`${label}:${tag}`);
			return new FakeSvgEl(tag);
		},
	};
}

beforeEach(() => {
	captured.prefix = undefined;
	canvasLog = [];
	globalLog = [];
	originalDocument = (globalThis as GlobalWithDocument).document;
	// 全局 document 桩：实现若退回全局 document，globalLog 会非空 → 断言失败
	(globalThis as GlobalWithDocument).document = makeDocStub(
		GLOBAL_LABEL,
		globalLog,
	);
});

afterEach(() => {
	// 还原全局：避免把 document 桩泄漏给同进程内的其他测试文件
	if (originalDocument === undefined) {
		delete (globalThis as GlobalWithDocument).document;
	} else {
		(globalThis as GlobalWithDocument).document = originalDocument;
	}
});

/** 最小节点桩：createNodePrefixContent 只读 getData() */
function fakeNode(data: Record<string, unknown>): MindMapNode {
	return {
		getData: (): Record<string, unknown> => data,
	} as unknown as MindMapNode;
}

const BASE_OPTIONS: CreateMindMapOptions = {
	layout: 'logicalStructure',
	themePref: 'default',
	isDark: false,
	enableDrag: false,
	performanceMode: false,
	performanceThreshold: 100,
	lang: 'zh',
};

/** 以指定画布文档桩创建引擎，并取出被捕获的 createNodePrefixContent */
function buildPrefix(canvasDoc: FakeDoc): PrefixFn {
	captured.prefix = undefined;
	const canvasEl = { ownerDocument: canvasDoc } as unknown as HTMLElement;
	const tree = {
		data: { text: 'root' },
		children: [],
	} as unknown as MindMapTreeNode;
	createMindMap(canvasEl, tree, BASE_OPTIONS);
	const prefix = captured.prefix;
	if (!prefix) {
		throw new Error('createMindMap 未注入 createNodePrefixContent');
	}
	return prefix;
}

describe('双链文档图标：由画布 document 构造（popout 兼容）', () => {
	it('图标 SVG 全部走 el.ownerDocument，不触碰全局 document', () => {
		const prefix = buildPrefix(makeDocStub(CANVAS_LABEL, canvasLog));

		const result = prefix(fakeNode({ mdWikiLinkpath: 'Note', mdLinkText: 'Note' }));

		expect(result).not.toBeNull();
		// svg / path / rect / title 四个元素均由画布文档创建
		expect(canvasLog).toEqual([
			`${CANVAS_LABEL}:svg`,
			`${CANVAS_LABEL}:path`,
			`${CANVAS_LABEL}:rect`,
			`${CANVAS_LABEL}:title`,
		]);
		// 全局 document 一次都不应被使用（popout 下会跨文档挂载）
		expect(globalLog).toEqual([]);
	});

	it('图标是 <svg> 根元素，命名空间/尺寸/类名/子元素齐备', () => {
		const prefix = buildPrefix(makeDocStub(CANVAS_LABEL, canvasLog));

		const result = prefix(fakeNode({ mdWikiLinkpath: 'Note', mdLinkText: 'Tip' }));
		const svg = result?.el as FakeSvgEl;

		expect(svg.tagName).toBe('svg');
		expect(svg.attrs.get('xmlns')).toBe('http://www.w3.org/2000/svg');
		expect(svg.attrs.get('width')).toBe('18');
		expect(svg.attrs.get('height')).toBe('18');
		expect(svg.classes).toContain('mindmap-wiki-doc-icon');
		expect(svg.children.map((child) => child.tagName)).toEqual([
			'path',
			'rect',
			'title',
		]);
	});

	it('非双链节点（无 mdWikiLinkpath）不构造图标，也不触碰任何 document', () => {
		const prefix = buildPrefix(makeDocStub(CANVAS_LABEL, canvasLog));

		expect(prefix(fakeNode({ text: 'plain' }))).toBeNull();
		expect(canvasLog).toEqual([]);
		expect(globalLog).toEqual([]);
	});

	it('tooltip 走「生效显示名」：编辑纯双链节点改别名后不停留在旧别名', () => {
		const prefix = buildPrefix(makeDocStub(CANVAS_LABEL, canvasLog));
		const titleOf = (data: Record<string, unknown>): unknown =>
			((prefix(fakeNode(data))?.el as FakeSvgEl).children[2] as FakeSvgEl)
				.textContent;

		// 纯双链节点被编辑：text 已改、mdDerivedText/mdLinkText 仍是解析时的旧显示名
		expect(
			titleOf({
				mdWikiLinkpath: '[[笔记|旧别名]]',
				mdLinkStyle: 'wiki',
				mdLinkText: '旧别名',
				mdDerivedText: '旧别名',
				text: '新别名',
			}),
		).toBe('新别名');

		// 对照：未编辑 → tooltip ＝原显示名（行为与旧实现一致）
		expect(
			titleOf({
				mdWikiLinkpath: '[[笔记|旧别名]]',
				mdLinkStyle: 'wiki',
				mdLinkText: '旧别名',
				mdDerivedText: '旧别名',
				text: '旧别名',
			}),
		).toBe('旧别名');

		// 边界：混合文本节点（`说明 [[笔记]]`）不是「纯双链」，编辑不改别名，
		// tooltip 仍是链接自身的显示名（而非整段节点文本）
		expect(
			titleOf({
				mdWikiLinkpath: '[[笔记]]',
				mdLinkStyle: 'wiki',
				mdLinkText: '笔记',
				mdDerivedText: '说明 笔记',
				text: '说明 笔记改',
			}),
		).toBe('笔记');
	});
});
