/**
 * view-wikilink 回归：节点链接的点击跳转与悬停预览路由。
 *
 * 关注点（模块自身的分支决策，非 mock 行为）：
 * - 点击分流：Ctrl/Cmd+点击（新标签）vs 普通点击（仅命中节点内 <a> 才打开）；
 * - 链接通道：文档双链存 mdWikiLinkpath（自绘图标通道），其余存 hyperlink——
 *   两条通道都要能被点击/预览取到；
 * - 锚点优先级：节点内渲染的 <a data-href>（Obsidian MarkdownRenderer 产物）
 *   优先于节点链接；
 * - 悬停预览去重：同一节点元素 400ms 内只触发一次 hover-link。
 *
 * getNodeGroupEl 经 mindmap.ts 防腐层提供，此处 stub 替换；DOM 判定所需的
 * Element/HTMLAnchorElement 以最小桩注入（Node 环境无 DOM）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEW_TYPE } from '../src/constants';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import { registerWikilinkInteractions } from '../src/features/view-wikilink';

const { getNodeGroupElMock } = vi.hoisted(() => ({
	getNodeGroupElMock: vi.fn<(node: unknown) => unknown>(),
}));

vi.mock('../src/mindmap', () => ({
	getNodeGroupEl: getNodeGroupElMock,
}));

/** 最小元素桩：contains/closest/getBoundingClientRect 由用例决定 */
class FakeElement {
	containsResult = true;
	closestResult: unknown = null;
	/** 视口矩形（默认远离屏幕顶部；用例可改 top 模拟贴顶） */
	rect = { top: 400, bottom: 440, left: 100, right: 200, width: 100, height: 40 };
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

/** 最小锚点桩：承载 data-href / href 属性 */
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

/** 记录 onEngine 监听，供按事件名触发 */
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

/** 节点桩：getData(key) 返回 data 字段 */
function fakeNode(data: Record<string, unknown>): MindMapNode {
	return {
		getData: (key?: string) => (key === undefined ? data : data[key]),
	} as unknown as MindMapNode;
}

/** 鼠标事件桩（含修饰键与阻断断言；preventDefault/stopPropagation 为可断言 spy） */
function fakeMouseEvent(
	target: unknown,
	modifiers: Partial<
		Pick<
			MouseEvent,
			'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'clientX' | 'clientY'
		>
	> = {},
) {
	return {
		target,
		ctrlKey: false,
		metaKey: false,
		shiftKey: false,
		altKey: false,
		// 视口坐标（默认位于节点中部，远离顶部阈值 → 原样透传）
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
	const containerEl = new FakeElement();
	// 叶子桩：悬停预览的 hoverParent 应为官方 HoverParent（WorkspaceLeaf）
	const leaf = { hoverPopover: null };
	const view = {
		mindMap,
		engineEvents: binder,
		openHyperlink,
		containerEl,
		leaf,
		file: { path: 'notes/x.mindmap.md' },
		app: { workspace: { trigger } },
	} as unknown as MindMapViewContext;
	return { view, binder, openHyperlink, trigger, containerEl, leaf };
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
		// 文档双链优先于 hyperlink（自绘图标通道不写引擎 hyperlink）
		expect(openHyperlink).toHaveBeenCalledWith('[[笔记]]', true);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
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

	it('Ctrl+点击但节点无任何链接：不跳转、不阻断事件', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(null);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(new FakeElement(), { ctrlKey: true });
		binder.fire('node_click', fakeNode({}), event);
		expect(openHyperlink).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('Ctrl+点击命中节点内锚点：锚点 data-href 包成双链形态（优先于节点链接）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr('data-href', '目标笔记');
		anchor.closestResult = anchor; // target.closest('a…') 命中自身
		const groupEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(groupEl);
		registerWikilinkInteractions(view);
		binder.fire(
			'node_click',
			fakeNode({ hyperlink: 'https://ignored.com' }),
			fakeMouseEvent(anchor, { ctrlKey: true }),
		);
		expect(openHyperlink).toHaveBeenCalledWith('[[目标笔记]]', true);
	});

	it('普通点击命中锚点：当前标签页打开（external-link 用 href）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr(
			'href',
			'https://example.com/x',
		);
		anchor.closestResult = anchor;
		const groupEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(groupEl);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(anchor);
		binder.fire('node_click', fakeNode({}), event);
		// 第二参缺省 = 当前标签页（与 Obsidian 点击链接一致）
		expect(openHyperlink).toHaveBeenCalledWith('https://example.com/x');
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('普通点击未命中锚点：保持引擎选中语义（不跳转）', () => {
		const { view, binder, openHyperlink } = makeView();
		getNodeGroupElMock.mockReturnValue(new FakeElement()); // closest → null
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(new FakeElement());
		binder.fire(
			'node_click',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			event,
		);
		expect(openHyperlink).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('普通点击 + Shift/Alt：不跳转（保留引擎多选/其他语义）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr('href', 'https://example.com');
		anchor.closestResult = anchor;
		const groupEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(groupEl);
		registerWikilinkInteractions(view);
		binder.fire('node_click', fakeNode({}), fakeMouseEvent(anchor, { shiftKey: true }));
		binder.fire('node_click', fakeNode({}), fakeMouseEvent(anchor, { altKey: true }));
		expect(openHyperlink).not.toHaveBeenCalled();
	});

	it('锚点不属于该节点渲染 group：视为未命中（不跨节点误匹配）', () => {
		const { view, binder, openHyperlink } = makeView();
		const anchor = new FakeAnchorElement().setAttr('href', 'https://example.com');
		const groupEl = new FakeElement();
		groupEl.containsResult = false; // target 不在本节点 group 内
		groupEl.closestResult = anchor;
		getNodeGroupElMock.mockReturnValue(groupEl);
		registerWikilinkInteractions(view);
		binder.fire('node_click', fakeNode({}), fakeMouseEvent(anchor));
		expect(openHyperlink).not.toHaveBeenCalled();
	});
});

describe('node_mouseenter（悬停预览）', () => {
	beforeEach(() => {
		getNodeGroupElMock.mockReset();
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
			event,
			source: VIEW_TYPE,
			// hoverParent 必须是官方 HoverParent（叶子），不是裸 HTMLElement
			hoverParent: leaf,
			targetEl,
			linktext: '目录/笔记',
			sourcePath: 'notes/x.mindmap.md',
		});
	});

	it('节点贴近视口顶部：上报坐标下移到节点下方（弹窗翻转）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		// 顶边 10px（< 64px 阈值），底边 50px
		targetEl.rect = {
			top: 10,
			bottom: 50,
			left: 100,
			right: 200,
			width: 100,
			height: 40,
		};
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(targetEl, { clientX: 150, clientY: 12 });
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			event,
		);

		const payload = trigger.mock.calls[0]?.[1] as { event: MouseEvent };
		// 纵坐标下移到节点下方（50 + 64），横坐标保持不变
		expect(payload.event.clientY).toBe(114);
		expect(payload.event.clientX).toBe(150);
		// 包装对象仍是 MouseEvent 语义：原生方法绑定原事件，可安全调用
		expect(() => payload.event.preventDefault()).not.toThrow();
	});

	it('节点在视口中部：原样透传原始事件（不包装）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement(); // 默认 rect top=400
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		const event = fakeMouseEvent(targetEl, { clientX: 150, clientY: 420 });
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			event,
		);
		const payload = trigger.mock.calls[0]?.[1] as { event: MouseEvent };
		expect(payload.event).toBe(event);
	});

	it('非双链（URL）节点：不触发预览（linkpath 为空）', () => {
		const { view, binder, trigger } = makeView();
		getNodeGroupElMock.mockReturnValue(new FakeElement());
		registerWikilinkInteractions(view);
		binder.fire(
			'node_mouseenter',
			fakeNode({ hyperlink: 'https://example.com' }),
			fakeMouseEvent(new FakeElement()),
		);
		expect(trigger).not.toHaveBeenCalled();
	});

	it('无链接节点 / 节点元素缺失：不触发预览', () => {
		const { view, binder, trigger } = makeView();
		// 无链接节点（mdWikiLinkpath 与 hyperlink 均缺失）
		getNodeGroupElMock.mockReturnValue(new FakeElement());
		registerWikilinkInteractions(view);
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

	it('参数缺失：不触发预览', () => {
		const { view, binder, trigger } = makeView();
		registerWikilinkInteractions(view);
		binder.fire('node_mouseenter');
		binder.fire('node_mouseenter', fakeNode({ mdWikiLinkpath: '[[笔记]]' }));
		expect(trigger).not.toHaveBeenCalled();
	});

	it('同一节点 400ms 内重复悬停：只预览一次（去重）', () => {
		const { view, binder, trigger } = makeView();
		const targetEl = new FakeElement();
		getNodeGroupElMock.mockReturnValue(targetEl);
		registerWikilinkInteractions(view);
		const node = fakeNode({ mdWikiLinkpath: '[[笔记]]' });
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		vi.setSystemTime(new Date('2026-01-01T00:00:00.200Z'));
		binder.fire('node_mouseenter', node, fakeMouseEvent(targetEl));
		expect(trigger).toHaveBeenCalledTimes(1);
		// 超过防抖窗口后可再次预览
		vi.setSystemTime(new Date('2026-01-01T00:00:00.500Z'));
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
		vi.setSystemTime(new Date('2026-01-01T00:00:00.100Z'));
		getNodeGroupElMock.mockReturnValue(second);
		binder.fire('node_mouseenter', node, fakeMouseEvent(second));
		expect(trigger).toHaveBeenCalledTimes(2);
	});
});
