/**
 * view-wikilink 回归：节点链接的点击跳转与悬停预览路由。
 *
 * 覆盖模块自身的分支决策（不覆盖桩自身行为）：
 * - 点击分流：Ctrl/Cmd+点击（新标签）vs 普通点击（仅命中节点内 <a> 才打开）、
 *   Shift/Alt 让位（保留引擎多选语义）；
 * - 三通道取值：文档双链存 mdWikiLinkpath（自绘图标通道，不写引擎 hyperlink）；
 *   双链附件/嵌入附件/拖入附件存 attachmentUrl + mdAttachmentLinkpath（回形针
 *   通道，同样不写 hyperlink）——attachmentUrl 是「引用仍在」的门控，linkpath
 *   取原始入库文本；其余链接存 hyperlink。三条通道都要能被点击/预览取到，
 *   且 mdWikiLinkpath > 附件通道 > hyperlink；
 * - 锚点优先级：节点内渲染的 <a data-href>（Obsidian MarkdownRenderer 产物）
 *   优先于节点 data 通道；
 * - 悬停预览去重：同一目标元素 400ms 内只触发一次 hover-link；
 * - 悬停预览触发面：外链/协议地址不触发（核心只服务库内目标），
 *   按住鼠标键（拖拽节点经过其它节点 / 框选扫过）不触发；
 * - 悬停预览锚定尺寸：SVG 节点缺 offsetWidth/offsetHeight（HTMLElement 专有），
 *   官方 HoverPopover.position() 的锚定矩形是混合取值（宽高走 offset*、位置走
 *   getBoundingClientRect()），不补齐时 bottom/right 为 NaN → 预览只会出现在
 *   上方、放不下时 top 变成 "NaNpx"（等于不显示）。故触发前必须补上按实时矩形
 *   取值的只读几何，且 HTMLElement 自有的属性不得被覆盖。
 *
 * getNodeGroupEl / getNodeDataString 经 mindmap.ts 防腐层提供，此处以 spy 替换
 * （前者用于注入节点 group 元素，后者按源实现语义归一非字符串）。
 * Node 环境无 DOM：Element / HTMLAnchorElement 判定所需的最小桩在本文件内自建，
 * 并在 afterEach 还原（不要堆进 tests/mocks/obsidian.ts）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEW_TYPE } from '../src/constants';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	ensureOffsetSize,
	registerWikilinkInteractions,
} from '../src/features/view-wikilink';

/** 节点 group 元素注入点：mock 工厂经 vi.hoisted 暴露，spy 可在每个用例里改返回值 */
const { getNodeGroupElMock } = vi.hoisted(() => ({
	getNodeGroupElMock: vi.fn<(node: unknown) => unknown>(),
}));

vi.mock('../src/mindmap', () => ({
	getNodeGroupEl: getNodeGroupElMock,
	// 与生产实现同语义：getData 取字符串，非字符串（含 undefined）归一为空串
	getNodeDataString: (
		node: { getData?: (key: string) => unknown },
		key: string,
	): string => {
		const value = node.getData?.(key);
		return typeof value === 'string' ? value : '';
	},
}));

/** 视口矩形（用例可改尺寸：offsetWidth/offsetHeight 的期望值即来自这里） */
interface FakeRect {
	top: number;
	bottom: number;
	left: number;
	right: number;
	width: number;
	height: number;
}

/**
 * 最小元素桩：contains/closest/getBoundingClientRect 由用例决定。
 * 刻意**不**声明 offsetWidth/offsetHeight——真实 SVG 节点 group 就是这种形态，
 * 断言「补之前 undefined / 补之后等于实时矩形」正是本文件的重点之一。
 */
class FakeElement {
	containsResult = true;
	closestResult: unknown = null;
	rect: FakeRect = {
		top: 400,
		bottom: 440,
		left: 100,
		right: 200,
		width: 100,
		height: 40,
	};

	contains(_node: unknown): boolean {
		return this.containsResult;
	}

	closest(_selector: string): unknown {
		return this.closestResult;
	}

	getBoundingClientRect(): DOMRect {
		return this.rect as unknown as DOMRect;
	}
}

/** 最小锚点桩：承载 MarkdownRenderer 产出的 data-href / href 属性 */
class FakeAnchorElement extends FakeElement {
	private readonly attrs = new Map<string, string>();

	setAttr(name: string, value: string): this {
		this.attrs.set(name, value);
		return this;
	}

	getAttribute(name: string): string | null {
		return this.attrs.get(name) ?? null;
	}
}

/**
 * FakeElement → `Element`：Node 环境没有 DOM 构造器，而 ensureOffsetSize 的形参
 * 声明为 `Element | null`；此处是**类型**断言（无运行时转换），保留用例中
 * offsetWidth 等断言所需的 FakeElement 形状。
 */
function asElement(el: FakeElement): Element {
	return el as unknown as Element;
}

/** 记录 onEngine 监听，供用例按事件名触发（模拟引擎回调） */
function makeEngineBinder() {
	const listeners = new Map<string, (...args: unknown[]) => void>();
	return {
		onEngine(
			_emitter: unknown,
			event: string,
			listener: (...args: unknown[]) => void,
		): void {
			listeners.set(event, listener);
		},
		fire(event: string, ...args: unknown[]): void {
			listeners.get(event)?.(...args);
		},
		has(event: string): boolean {
			return listeners.has(event);
		},
	};
}

/** 节点桩：getData(key) 返回 data 字段（与引擎 MindMapNode.getData 形态一致） */
function fakeNode(data: Record<string, unknown>): MindMapNode {
	return {
		getData: (key?: string) => (key === undefined ? data : data[key]),
	} as unknown as MindMapNode;
}

/** 鼠标事件桩：修饰键可覆盖，preventDefault/stopPropagation 为可断言 spy */
function fakeMouseEvent(
	target: unknown,
	modifiers: Partial<
		Pick<
			MouseEvent,
			| 'ctrlKey'
			| 'metaKey'
			| 'shiftKey'
			| 'altKey'
			| 'clientX'
			| 'clientY'
			| 'buttons'
		>
	> = {},
) {
	return {
		target,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		// 视口坐标：弹窗定位已不依赖指针坐标，保留以覆盖事件原样透传
		clientX: 150,
		clientY: 420,
		...modifiers,
		preventDefault: vi.fn<() => void>(),
		stopPropagation: vi.fn<() => void>(),
	};
}

function makeView(mindMap: unknown = {}) {
	const binder = makeEngineBinder();
	const openHyperlink = vi.fn();
	const trigger = vi.fn();
	// 叶子桩：悬停预览的 hoverParent 应为官方 HoverParent（WorkspaceLeaf 实现该接口）
	const leaf = { hoverPopover: null };
	const view = {
		mindMap,
		engineEvents: binder,
		openHyperlink,
		leaf,
		file: { path: 'notes/x.mindmap.md' },
		app: { workspace: { trigger } },
	} as unknown as MindMapViewContext;
	return { view, binder, openHyperlink, trigger, leaf };
}

/** 把 target 与锚点都摆进同一节点 group（命中路径的前置条件） */
function anchorInGroup(
	anchor: FakeAnchorElement,
	groupEl: FakeElement = new FakeElement(),
): FakeElement {
	anchor.closestResult = anchor; // target.closest('a…') 命中自身
	getNodeGroupElMock.mockReturnValue(groupEl);
	return groupEl;
}

describe('registerWikilinkInteractions（注册）', () => {
	beforeEach(() => {
		getNodeGroupElMock.mockReset();
	});

	it('引擎实例缺失：不注册任何监听', () => {
		const { view, binder } = makeView(null);
		registerWikilinkInteractions(view);
		expect(binder.has('node_click')).toBe(false);
		expect(binder.has('node_mouseenter')).toBe(false);
	});

	it('注册点击与悬停两个引擎事件', () => {
		const { view, binder } = makeView();
		registerWikilinkInteractions(view);
		expect(binder.has('node_click')).toBe(true);
		expect(binder.has('node_mouseenter')).toBe(true);
	});
});

describe('node_click（点击分流）', () => {
	beforeEach(() => {
		getNodeGroupElMock.mockReset();
		// findAnchorInNode 用 Element / HTMLAnchorElement 做 instanceof 判定；
		// Node 环境没有这两个构造器，注入最小桩（afterEach 还原）
		vi.stubGlobal('Element', FakeElement);
		vi.stubGlobal('HTMLAnchorElement', FakeAnchorElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('参数缺失（无节点/无事件）：不跳转', () => {
		const { view, binder, openHyperlink } = makeView();
		registerWikilinkInteractions(view);
		binder.fire('node_click');
		binder.fire('node_click', fakeNode({}));
		expect(openHyperlink).not.toHaveBeenCalled();
	});

	it('Ctrl+点击（无锚点）：取节点文档双链通道，新标签打开', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(new FakeElement(), { ctrlKey: true });
		binder.fire(
			'node_click',
			fakeNode({ mdWikiLinkpath: '[[笔记]]', hyperlink: 'https://a.com' }),
			event,
		);
		// 双通道取值：mdWikiLinkpath（文档双链，自绘图标通道）优先于 hyperlink
		expect(openHyperlink).toHaveBeenCalledWith('[[笔记]]', true);
		// 修饰键点击接管：必须阻断默认行为与冒泡（否则引擎/浏览器再跳一次）
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('Cmd+点击（macOS）：同样新标签打开', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(new FakeElement(), { metaKey: true });
		binder.fire(
			'node_click',
			fakeNode({ hyperlink: 'https://example.com' }),
			event,
		);
		expect(openHyperlink).toHaveBeenCalledWith('https://example.com', true);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
	});

	it('Ctrl+点击：mdWikiLinkpath 为空时回退 hyperlink', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			fakeNode({ mdWikiLinkpath: '', hyperlink: 'https://b.com' }),
			fakeMouseEvent(new FakeElement(), { ctrlKey: true }),
		);
		expect(openHyperlink).toHaveBeenCalledWith('https://b.com', true);
	});

	it('Ctrl+点击：mdWikiLinkpath 非字符串（通道空值）不得当链接用', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			// 引擎 data 可能写入数字/对象：getNodeDataString 归一为空串 → 回退 hyperlink
			fakeNode({ mdWikiLinkpath: 123, hyperlink: 'https://c.com' }),
			fakeMouseEvent(new FakeElement(), { ctrlKey: true }),
		);
		expect(openHyperlink).toHaveBeenCalledWith('https://c.com', true);
	});

	it('Ctrl+点击附件节点：走回形针通道打开原始 linkpath（新标签）', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			// 双链附件 / 拖入附件：不写 hyperlink，只有 attachmentUrl + 原始 linkpath
			fakeNode({
				attachmentUrl: 'app://local/attachments/report.pdf',
				mdAttachmentLinkpath: 'attachments/report.pdf',
			}),
			fakeMouseEvent(new FakeElement(), { ctrlKey: true }),
		);
		expect(openHyperlink).toHaveBeenCalledWith('attachments/report.pdf', true);
	});

	it('Ctrl+点击：附件通道优先于 hyperlink（双通道并存时的读取顺序）', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			fakeNode({
				attachmentUrl: 'attachments/report.pdf',
				mdAttachmentLinkpath: 'attachments/report.pdf',
				hyperlink: 'https://stale.example.com',
			}),
			fakeMouseEvent(new FakeElement(), { ctrlKey: true }),
		);
		expect(openHyperlink).toHaveBeenCalledWith('attachments/report.pdf', true);
	});

	it('Ctrl+点击但节点无任何链接：不跳转、不阻断事件', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(new FakeElement(), { ctrlKey: true });
		binder.fire('node_click', fakeNode({}), event);
		expect(openHyperlink).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.stopPropagation).not.toHaveBeenCalled();
	});

	it('Ctrl+点击命中节点内锚点：锚点 data-href 包成双链形态（优先于节点链接）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr('data-href', '目标笔记');
		anchorInGroup(anchor);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			fakeNode({ hyperlink: 'https://ignored.com' }),
			fakeMouseEvent(anchor, { ctrlKey: true }),
		);
		// data-href 是原始 linkpath（无 [[ ]]），resolveAnchorLink 包成 wikilink 形态，
		// 交给 openHyperlink 的 parseWikilink 分支；节点自身链接被锚点压过
		expect(openHyperlink).toHaveBeenCalledWith('[[目标笔记]]', true);
	});

	it('Ctrl+点击命中锚点：data-href 优先于 href（Obsidian 内链形态）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement()
			.setAttr('data-href', '目录/笔记#标题')
			.setAttr('href', '目录/笔记#标题');
		anchorInGroup(anchor);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			fakeNode({}),
			fakeMouseEvent(anchor, { ctrlKey: true }),
		);
		// 内部锚点（#标题）随 linkpath 原样透传，不做截断
		expect(openHyperlink).toHaveBeenCalledWith('[[目录/笔记#标题]]', true);
	});

	it('普通点击命中锚点：当前标签页打开（external-link 用 href）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr(
			'href',
			'https://example.com/x',
		);
		anchorInGroup(anchor);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(anchor);
		binder.fire('node_click', fakeNode({}), event);
		// 第二参缺省 = 当前标签页（与 Obsidian 点击链接一致）
		expect(openHyperlink).toHaveBeenCalledWith('https://example.com/x');
		expect(openHyperlink).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalledTimes(1);
		expect(event.stopPropagation).toHaveBeenCalledTimes(1);
	});

	it('普通点击未命中锚点：保持引擎选中语义（不跳转）', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(new FakeElement()); // closest → null
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(new FakeElement());
		binder.fire('node_click', fakeNode({ mdWikiLinkpath: '[[笔记]]' }), event);
		// 节点其余区域的点击不属于链接交互（无修饰键时不得打开节点链接）
		expect(openHyperlink).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('普通点击命中锚点但 Shift/Alt 按下：让位引擎多选语义（不跳转、不阻断）', () => {
		for (const modifiers of [{ shiftKey: true }, { altKey: true }]) {
			const { view, binder, openHyperlink } = makeView();
			const anchor = new FakeAnchorElement().setAttr(
				'href',
				'https://example.com',
			);
			anchorInGroup(anchor);
			registerWikilinkInteractions(view);
			const event = fakeMouseEvent(anchor, modifiers);
			binder.fire('node_click', fakeNode({}), event);
			expect(openHyperlink).not.toHaveBeenCalled();
			expect(event.preventDefault).not.toHaveBeenCalled();
		}
	});

	it('锚点不属于该节点渲染 group：视为未命中（不跨节点误匹配）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr(
			'href',
			'https://example.com',
		);
		const groupEl = new FakeElement();
		groupEl.containsResult = false; // target 不在本节点 group 内
		groupEl.closestResult = anchor;
		getNodeGroupElMock.mockReturnValue(groupEl);
		registerWikilinkInteractions(view);
		binder.fire('node_click', fakeNode({}), fakeMouseEvent(anchor));
		expect(openHyperlink).not.toHaveBeenCalled();
	});

	it('closest 命中的锚点落在 group 之外（跨节点嵌套）：拒绝', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr(
			'href',
			'https://example.com',
		);
		const groupEl = new FakeElement();
		// contains 第一次（target）为 true、第二次（anchor）为 false —— 单测桩模拟
		// 「target 在组内但 closest 爬到组外元素」的畸形结构，应拒绝跳转
		let calls = 0;
		groupEl.contains = () => {
			calls++;
			return calls === 1;
		};
		groupEl.closestResult = anchor;
		getNodeGroupElMock.mockReturnValue(groupEl);
		registerWikilinkInteractions(view);
		binder.fire('node_click', fakeNode({}), fakeMouseEvent(new FakeElement()));
		expect(openHyperlink).not.toHaveBeenCalled();
	});

	it('节点元素缺失（引擎未渲染 group）：即使有链接也不跳转', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(new FakeElement()),
		);
		expect(openHyperlink).not.toHaveBeenCalled();
	});

	it('target 不是元素（如文本节点）：不跳转', () => {
		const { view, binder, openHyperlink } = makeView();
		registerWikilinkInteractions(view);
		// 文本节点对象没有 closest/contains 面，instanceof Element 判定必须挡住它
		binder.fire(
			'node_click',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent({ nodeType: 3, textContent: '文本' }),
		);
		expect(openHyperlink).not.toHaveBeenCalled();
	});

	it('锚点存在但链接文本为空：不跳转、不阻断', () => {
		const { view, binder, openHyperlink } = makeView();
		// 既无 data-href 也无 href（MarkdownRenderer 产物的畸形形态）
		const anchor = new FakeAnchorElement();
		anchorInGroup(anchor);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(anchor);
		binder.fire('node_click', fakeNode({}), event);
		expect(openHyperlink).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('畸形节点 data（getData 抛错之外的异常取值）：通道为空时静默', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		const node = {
			getData: () => undefined,
		} as unknown as MindMapNode;
		binder.fire(
			'node_click',
			node,
			fakeMouseEvent(new FakeElement(), { ctrlKey: true }),
		);
		expect(openHyperlink).not.toHaveBeenCalled();
	});
});

describe('node_click（表驱动：链接形态与否决集）', () => {
	beforeEach(() => {
		getNodeGroupElMock.mockReset();
		vi.stubGlobal('Element', FakeElement);
		vi.stubGlobal('HTMLAnchorElement', FakeAnchorElement);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** 节点 data 通道 → 期望跳转入参（null = 不跳转） */
	const nodeChannelCases: {
		name: string;
		data: Record<string, unknown>;
		expected: [string, boolean] | null;
	}[] = [
		{
			name: '文档双链（mdWikiLinkpath 通道）',
			data: { mdWikiLinkpath: '[[笔记]]' },
			expected: ['[[笔记]]', true],
		},
		{
			name: '文档双链带别名',
			data: { mdWikiLinkpath: '[[目录/笔记|别名]]' },
			expected: ['[[目录/笔记|别名]]', true],
		},
		{
			name: '附件链接（引擎 hyperlink 通道）',
			data: { hyperlink: '[[附件.pdf]]' },
			expected: ['[[附件.pdf]]', true],
		},
		{
			name: '外链 http（引擎 hyperlink 通道）',
			data: { hyperlink: 'https://example.com/a?b=1' },
			expected: ['https://example.com/a?b=1', true],
		},
		{
			name: 'obsidian:// 链接',
			data: { hyperlink: 'obsidian://open?vault=V&file=笔记' },
			expected: ['obsidian://open?vault=V&file=笔记', true],
		},
		{
			name: '内部锚点（无目标）',
			data: { hyperlink: '[[#标题]]' },
			expected: ['[[#标题]]', true],
		},
		{
			name: '双通道并存：mdWikiLinkpath 优先',
			data: { mdWikiLinkpath: '[[文档]]', hyperlink: 'https://ignored.com' },
			expected: ['[[文档]]', true],
		},
		{
			name: '畸形输入 [[未闭合',
			data: { hyperlink: '[[未闭合' },
			expected: ['[[未闭合', true],
		},
		{
			name: '畸形输入 别名空目标 [[|别名]]',
			data: { mdWikiLinkpath: '[[|别名]]' },
			expected: ['[[|别名]]', true],
		},
		{
			name: '图片 embed ![[图.png]]',
			data: { mdWikiLinkpath: '![[图.png]]' },
			expected: ['![[图.png]]', true],
		},
		{
			name: '空白链接（空格）',
			data: { hyperlink: '   ' },
			expected: ['   ', true],
		},
		{
			name: '无任何链接',
			data: {},
			expected: null,
		},
		{
			name: '空串链接',
			data: { mdWikiLinkpath: '', hyperlink: '' },
			expected: null,
		},
		{
			name: '非字符串链接值',
			data: { mdWikiLinkpath: null, hyperlink: 42 },
			expected: null,
		},
	];

	it.each(nodeChannelCases)(
		'Ctrl+点击 · $name',
		({ data, expected }: (typeof nodeChannelCases)[number]) => {
			const { view, binder, openHyperlink } = makeView();
			getNodeGroupElMock.mockReturnValue(null); // 无锚点 → 走节点 data 通道
			registerWikilinkInteractions(view);
			binder.fire(
				'node_click',
				fakeNode(data),
				fakeMouseEvent(new FakeElement(), { ctrlKey: true }),
			);
			if (expected) {
				expect(openHyperlink).toHaveBeenCalledWith(...expected);
			} else {
				expect(openHyperlink).not.toHaveBeenCalled();
			}
		},
	);

	/** 锚点属性 → 期望跳转入参（普通左键 = 当前标签页） */
	const anchorCases: {
		name: string;
		attrs: [string, string][];
		expected: string | null;
	}[] = [
		{
			name: 'internal-link（data-href 无包裹）',
			attrs: [['data-href', '目录/笔记']],
			expected: '[[目录/笔记]]',
		},
		{
			name: 'internal-link 带区块引用',
			attrs: [['data-href', '笔记#小节']],
			expected: '[[笔记#小节]]',
		},
		{
			name: 'external-link（href）',
			attrs: [['href', 'https://example.com']],
			expected: 'https://example.com',
		},
		{
			name: 'mailto 外链',
			attrs: [['href', 'mailto:a@b.com']],
			expected: 'mailto:a@b.com',
		},
		{
			name: 'obsidian:// 锚点（href 分支）',
			attrs: [['href', 'obsidian://open?file=x']],
			expected: 'obsidian://open?file=x',
		},
		{
			name: '仅 data-href 为空串时回退 href',
			attrs: [
				['data-href', ''],
				['href', 'https://fallback.com'],
			],
			expected: 'https://fallback.com',
		},
		{
			name: '属性全缺（畸形产物）',
			attrs: [],
			expected: null,
		},
	];

	it.each(anchorCases)('普通点击 · 锚点 $name', ({ attrs, expected }) => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement();
		for (const [name, value] of attrs) {
			anchor.setAttr(name, value);
		}
		anchorInGroup(anchor);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(anchor);
		binder.fire('node_click', fakeNode({ hyperlink: 'https://node.com' }), event);
		if (expected) {
			expect(openHyperlink).toHaveBeenCalledWith(expected);
		} else {
			expect(openHyperlink).not.toHaveBeenCalled();
		}
	});
});

describe('node_mouseenter（悬停预览）', () => {
	beforeEach(() => {
		getNodeGroupElMock.mockReset();
		// 去重按 Date.now() 的时间窗判定：固定系统时间 + 假定时器让 400ms 边界可测
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('含文档双链的节点：触发 hover-link 且携带 linkpath', () => {
		const { view, binder, trigger, leaf } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(targetEl);
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[目录/笔记|别名]]' }),
			event,
		);
		expect(trigger).toHaveBeenCalledWith('hover-link', {
			// 原始事件原样透传（定位改由 targetEl 矩形决定，不再改写指针坐标）
			event,
			source: VIEW_TYPE,
			// hoverParent 必须是官方 HoverParent（叶子）：官方接口
			// `HoverParent { hoverPopover: HoverPopover | null }`，WorkspaceLeaf 实现它；
			// 传裸 HTMLElement 会让核心的弹窗注册/定位失配
			hoverParent: leaf,
			targetEl,
			// 别名剥掉、[[ ]] 剥掉 → 纯 linkpath（核心据此解析目标文件）
			linktext: '目录/笔记',
			sourcePath: 'notes/x.mindmap.md',
		});
		expect(trigger).toHaveBeenCalledTimes(1);
	});

	it('附件/外链通道（hyperlink）也可触发预览，linktext 为 linkpath', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			// 双通道：mdWikiLinkpath 为空 → 取 hyperlink
			fakeNode({ mdWikiLinkpath: '', hyperlink: '[[附件.pdf|说明]]' }),
			fakeMouseEvent(targetEl),
		);
		const payload = trigger.mock.calls[0]?.[1] as { linktext: string };
		expect(payload.linktext).toBe('附件.pdf');
	});

	it('附件通道（回形针）：裸 linkpath 直通触发预览（linktext = 原始入库路径）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			// 双链附件 / 嵌入附件 / 拖入的库内附件：只写 attachmentUrl（资源地址，
			// 可能已被视图层重写成解析后的路径）与原始 linkpath；核心要后者才能在
			// 库内解析到目标（`wikilinkLinkpath` 只认 `[[…]]`，裸路径须直通）
			fakeNode({
				attachmentUrl: 'app://local/attachments/report.pdf',
				mdAttachmentLinkpath: 'attachments/report.pdf',
			}),
			fakeMouseEvent(targetEl),
		);
		const payload = trigger.mock.calls[0]?.[1] as { linktext: string };
		expect(payload.linktext).toBe('attachments/report.pdf');
		expect(trigger).toHaveBeenCalledTimes(1);
	});

	it('附件通道：原始 linkpath 缺失时回退 attachmentUrl', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			fakeNode({ attachmentUrl: 'attachments/report.pdf' }),
			fakeMouseEvent(targetEl),
		);
		const payload = trigger.mock.calls[0]?.[1] as { linktext: string };
		expect(payload.linktext).toBe('attachments/report.pdf');
	});

	it('引用已移除（仅残留 mdAttachmentLinkpath）：不触发预览', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			// 「移除引用」只清 attachmentUrl，linkpath 字段会残留（见 NODE_REFERENCE_FIELDS）
			fakeNode({ mdAttachmentLinkpath: 'attachments/report.pdf' }),
			fakeMouseEvent(targetEl),
		);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('外链节点（hyperlink 为协议地址）：不触发预览（核心只服务库内目标）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		for (const hyperlink of ['https://example.com', 'obsidian://open?file=x']) {
			binder.fire(
				'node_mouseenter',
				fakeNode({ hyperlink }),
				fakeMouseEvent(targetEl),
			);
		}
		expect(trigger).not.toHaveBeenCalled();
	});

	it('按住鼠标键（拖拽节点经过 / 框选扫过）：不触发预览', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl, { buttons: 1 }),
		);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('未按鼠标键（buttons = 0）：正常触发（拖拽守卫不误伤悬停）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl, { buttons: 0 }),
		);
		const payload = trigger.mock.calls[0]?.[1] as { linktext: string };
		expect(payload.linktext).toBe('笔记');
	});

	it('sourcePath 取视图文件路径；文件缺失时为空串', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		(view as unknown as { file: null }).file = null;
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl),
		);
		const payload = trigger.mock.calls[0]?.[1] as { sourcePath: string };
		expect(payload.sourcePath).toBe('');
	});

	it('触发预览前给节点元素补上 offsetWidth/offsetHeight（官方弹窗定位依赖它）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		targetEl.rect = {
			top: 700,
			bottom: 740,
			left: 100,
			right: 260,
			width: 160,
			height: 40,
		};
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);

		// 前置：SVG 元素形态——这两个属性根本不存在（不是 0，是 undefined）
		const el = targetEl as unknown as {
			offsetWidth: number;
			offsetHeight: number;
		};
		expect(el.offsetWidth).toBeUndefined();
		expect(el.offsetHeight).toBeUndefined();

		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl),
		);

		// 官方 HoverPopover.position() 取
		//   bottom = rect.top + targetEl.offsetHeight、right = rect.left + targetEl.offsetWidth
		// SVG 缺属性时 bottom/right 为 NaN → 「下方放得下就放下方」分支恒假（预览只在
		// 上方），上方放不下时 top 被写成 "NaNpx"（等于不显示）。补齐后取实时矩形尺寸
		expect(el.offsetWidth).toBe(160);
		expect(el.offsetHeight).toBe(40);
		expect(Number.isFinite(targetEl.rect.top + el.offsetHeight)).toBe(true);
		expect(Number.isFinite(targetEl.rect.left + el.offsetWidth)).toBe(true);
		expect(trigger).toHaveBeenCalledTimes(1);
	});

	it('补的几何是实时取值（矩形变化后跟着变）而非一次性快照', () => {
		const { view, binder } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl),
		);
		const el = targetEl as unknown as {
			offsetWidth: number;
			offsetHeight: number;
		};
		expect(el.offsetWidth).toBe(100);
		// 节点缩放/文本变化后矩形改变：getter 必须重新读 rect（弹窗定位才不会用旧尺寸）
		targetEl.rect = {
			top: 10,
			bottom: 90,
			left: 0,
			right: 200,
			width: 200,
			height: 80,
		};
		expect(el.offsetWidth).toBe(200);
		expect(el.offsetHeight).toBe(80);
	});

	it('参数缺失：不触发预览', () => {
		const { view, binder, trigger } = makeView();
		registerWikilinkInteractions(view);
		binder.fire('node_mouseenter');
		binder.fire('node_mouseenter', fakeNode({ mdWikiLinkpath: '[[笔记]]' }));
		expect(trigger).not.toHaveBeenCalled();
	});

	it('无链接节点 / 节点元素缺失：不触发预览', () => {
		const { view, binder, trigger } = makeView();
		getNodeGroupElMock.mockReturnValue(new FakeElement());
		registerWikilinkInteractions(view);
		// 两条通道都空
		binder.fire('node_mouseenter', fakeNode({}), fakeMouseEvent(new FakeElement()));
		// 有链接但引擎未渲染节点元素（group 缺失）
		getNodeGroupElMock.mockReturnValue(null);
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(new FakeElement()),
		);
		expect(trigger).not.toHaveBeenCalled();
	});

	/** 非文档链接形态（linkpath 解析不出）→ 不应触发预览 */
	const nonPreviewCases: { name: string; data: Record<string, unknown> }[] = [
		{ name: '裸 URL（无 [[ ]]）', data: { hyperlink: 'https://example.com' } },
		{ name: 'obsidian:// 链接', data: { hyperlink: 'obsidian://open?file=x' } },
		{ name: '畸形 [[未闭合', data: { mdWikiLinkpath: '[[未闭合' } },
		{ name: '畸形 别名空目标 [[|别名]]', data: { mdWikiLinkpath: '[[|别名]]' } },
		{ name: '图片 embed ![[图.png]]', data: { mdWikiLinkpath: '![[图.png]]' } },
		{ name: '空串链接', data: { mdWikiLinkpath: '', hyperlink: '' } },
		{ name: '非字符串链接值', data: { mdWikiLinkpath: null, hyperlink: 7 } },
	];

	it.each(nonPreviewCases)('非双链形态不触发预览：$name', ({ data }) => {
		const { view, binder, trigger } = makeView();
		getNodeGroupElMock.mockReturnValue(new FakeElement());
		registerWikilinkInteractions(view);
		binder.fire('node_mouseenter', fakeNode(data), fakeMouseEvent(new FakeElement()));
		// 核心按 linktext 解析目标文件，裸 URL/畸形形态解析不出文档 → 不预览
		expect(trigger).not.toHaveBeenCalled();
	});

	/** linkpath 形态 → 期望 linktext（别名与 [[ ]] 剥除） */
	const linktextCases: { name: string; link: string; linktext: string }[] = [
		{ name: '无别名', link: '[[笔记]]', linktext: '笔记' },
		{ name: '带别名', link: '[[笔记|别名]]', linktext: '笔记' },
		{ name: '带区块', link: '[[笔记#标题]]', linktext: '笔记#标题' },
		{ name: '带区块与别名', link: '[[笔记#标题|别名]]', linktext: '笔记#标题' },
		{ name: '路径形态', link: '[[a/b/c.md]]', linktext: 'a/b/c.md' },
		{ name: '附件', link: '[[附件.pdf]]', linktext: '附件.pdf' },
		// 纯锚点：target 为空但 linkpath（#标题）非空 → 仍触发预览，
		// linktext 原样带上 #（核心据 sourcePath + 区块预览当前文件对应小节）
		{ name: '纯区块锚点', link: '[[#标题]]', linktext: '#标题' },
	];

	it.each(linktextCases)('linktext 剥除别名与包裹：$name', ({ link, linktext }) => {
		const { view, binder, trigger } = makeView();
		getNodeGroupElMock.mockReturnValue(new FakeElement());
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: link }),
			fakeMouseEvent(new FakeElement()),
		);
		const payload = trigger.mock.calls[0]?.[1] as { linktext: string };
		expect(payload.linktext).toBe(linktext);
	});

	it('同一节点 400ms 内重复悬停：只预览一次（去重）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		const node = fakeNode({ mdWikiLinkpath: '[[笔记]]' });
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		expect(trigger).toHaveBeenCalledTimes(1);

		// 窗口内（200ms）重复进入：鼠标在节点边缘抖动会连发 mouseenter，
		// 每次重开弹窗会闪烁 → 同一目标元素必须去重
		vi.setSystemTime(new Date('2026-01-01T00:00:00.200Z'));
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		expect(trigger).toHaveBeenCalledTimes(1);

		// 超过防抖窗口（500ms > 400ms）后可再次预览
		vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'));
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		expect(trigger).toHaveBeenCalledTimes(2);
	});

	it('去重窗口边界：恰好 400ms 时不再算重复（判定为 `< 400`）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		const node = fakeNode({ mdWikiLinkpath: '[[笔记]]' });
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		vi.setSystemTime(new Date('2026-01-01T00:00:00.399Z'));
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		expect(trigger).toHaveBeenCalledTimes(1);
		vi.setSystemTime(new Date('2026-01-01T00:00:00.400Z'));
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		expect(trigger).toHaveBeenCalledTimes(2);
	});

	it('切换到另一节点：不受去重影响（目标元素不同）', () => {
		const { view, binder, trigger } = makeView();
		const first = new FakeElement();
		const second = new FakeElement();
		registerWikilinkInteractions(view);
		const node = fakeNode({ mdWikiLinkpath: '[[笔记]]' });
		getNodeGroupElMock.mockReturnValue(first);
		binder.fire('node_mouseenter', node, fakeMouseEvent(first));
		// 紧邻时间内换节点：立刻预览新目标（去重按目标元素身份，不按节点）
		vi.setSystemTime(new Date('2026-01-01T00:00:00.100Z'));
		getNodeGroupElMock.mockReturnValue(second);
		binder.fire('node_mouseenter', node, fakeMouseEvent(second));
		expect(trigger).toHaveBeenCalledTimes(2);
	});

	it('不同视图各自去重（状态按视图 WeakMap 持有，互不影响）', () => {
		const a = makeView();
		const b = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(a.view);
		registerWikilinkInteractions(b.view);
		const node = fakeNode({ mdWikiLinkpath: '[[笔记]]' });
		a.binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		b.binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		// 同一元素在 A 视图刚预览过，不影响 B 视图的首次预览
		expect(a.trigger).toHaveBeenCalledTimes(1);
		expect(b.trigger).toHaveBeenCalledTimes(1);
	});

	it('无链接的重复悬停：始终不触发（且不污染去重状态）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		binder.fire('node_mouseenter', fakeNode({}), fakeMouseEvent(targetEl));
		expect(trigger).not.toHaveBeenCalled();
		// 同一元素随后被赋予链接：因无链接时未写去重状态，应立即能预览
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl),
		);
		expect(trigger).toHaveBeenCalledTimes(1);
	});
});

describe('ensureOffsetSize（官方弹窗锚定矩形的几何补齐）', () => {
	it('元素缺失（null）：静默返回', () => {
		expect(() => ensureOffsetSize(null)).not.toThrow();
	});

	it('SVG 形态元素：补上按实时矩形取值的只读几何', () => {
		// 先以 FakeElement 形态持有（用例需要读写 rect），断言处再断言为 Element
		const el = new FakeElement();
		el.rect = {
			top: 700,
			bottom: 740,
			left: 100,
			right: 260,
			width: 160,
			height: 40,
		};
		const target = el as unknown as {
			offsetWidth?: number;
			offsetHeight?: number;
		};
		expect(target.offsetWidth).toBeUndefined();
		ensureOffsetSize(asElement(el));
		expect(target.offsetWidth).toBe(160);
		expect(target.offsetHeight).toBe(40);
		// 只读：无 setter（严格模式下写入抛 TypeError，非严格模式被忽略且值不变）
		expect(() => {
			(target as { offsetWidth: number }).offsetWidth = 999;
		}).toThrow(TypeError);
		expect(target.offsetWidth).toBe(160);
	});

	it('已具备几何属性的元素（HTMLElement）：不覆盖原值', () => {
		// 模拟 HTMLElement：offsetWidth/offsetHeight 在原型链上（`in` 为 true）
		class FakeHTMLElement {
			offsetWidth = 7;
			offsetHeight = 9;
			getBoundingClientRect(): { width: number; height: number } {
				return { width: 100, height: 40 };
			}
		}
		const native = new FakeHTMLElement();
		ensureOffsetSize(native as unknown as Element);
		// 自有属性保持原值（不被按 rect 改写）
		expect(native.offsetWidth).toBe(7);
		expect(native.offsetHeight).toBe(9);
	});

	it('属性存在于原型链（in 判定走原型）：同样不覆盖', () => {
		class WithPrototypeSize {
			getBoundingClientRect(): { width: number; height: number } {
				return { width: 100, height: 40 };
			}
		}
		// 只在原型上定义 offsetHeight，实例上补 offsetWidth
		Object.defineProperty(WithPrototypeSize.prototype, 'offsetHeight', {
			configurable: true,
			get: () => 33,
		});
		const el = new WithPrototypeSize();
		ensureOffsetSize(el as unknown as Element);
		const target = el as unknown as {
			offsetWidth: number;
			offsetHeight: number;
		};
		expect(target.offsetHeight).toBe(33); // 原型上的自有实现未被遮蔽
		expect(target.offsetWidth).toBe(100); // 缺失的那个才补
	});

	it('幂等：重复调用不改变已补的几何，也不抛错', () => {
		const el = new FakeElement();
		ensureOffsetSize(asElement(el));
		const first = (el as unknown as { offsetWidth: number }).offsetWidth;
		expect(() => ensureOffsetSize(asElement(el))).not.toThrow();
		expect((el as unknown as { offsetWidth: number }).offsetWidth).toBe(first);
	});

	it('补齐后的矩形是有限数（弹窗上下翻转分支可成立）', () => {
		const el = new FakeElement();
		el.rect = {
			top: 700,
			bottom: 740,
			left: 100,
			right: 260,
			width: 160,
			height: 40,
		};
		ensureOffsetSize(asElement(el));
		const target = el as unknown as {
			offsetWidth: number;
			offsetHeight: number;
		};
		// 官方 HoverPopover.position() 的锚定矩形（混合取值）
		const anchorRect = {
			top: el.rect.top,
			bottom: el.rect.top + target.offsetHeight,
			left: el.rect.left,
			right: el.rect.left + target.offsetWidth,
		};
		expect(Number.isFinite(anchorRect.bottom)).toBe(true);
		expect(Number.isFinite(anchorRect.right)).toBe(true);
		expect(anchorRect).toEqual({
			top: 700,
			bottom: 740,
			left: 100,
			right: 260,
		});
	});
});
