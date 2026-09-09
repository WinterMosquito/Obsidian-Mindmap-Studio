/**
 * view-wikilink 回归：节点链接的点击跳转与悬停预览路由。
 *
 * 关注点（模块自身的分支决策，非 mock 行为）：
 * - 点击分流：Ctrl/Cmd+点击（新标签）vs 普通点击（仅命中节点内 <a> 才打开）；
 * - 链接通道：文档双链存 mdWikiLinkpath（自绘图标通道），其余存 hyperlink——
 *   两条通道都要能被点击/预览取到；
 * - 锚点优先级：节点内渲染的 <a data-href>（Obsidian MarkdownRenderer 产物）
 *   优先于节点链接；
 * - 悬停预览去重：同一节点元素 400ms 内只触发一次 hover-link；
 * - 悬停预览定位：SVG 节点须补上 offsetWidth/offsetHeight，官方弹窗才可能
 *   在下方放不下时翻到上方（否则锚定矩形 bottom 为 NaN，只会出现在上方）。
 *
 * getNodeGroupEl 经 mindmap.ts 防腐层提供，此处 stub 替换；DOM 判定所需的
 * Element/HTMLAnchorElement 以最小桩注入（Node 环境无 DOM）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIEW_TYPE } from '../src/constants';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';
import type { MindMapViewContext } from '../src/features/view-context';
import {
	ensureOffsetSize,
	registerWikilinkInteractions,
} from '../src/features/view-wikilink';

const { getNodeGroupElMock } = vi.hoisted(() => ({
	getNodeGroupElMock: vi.fn<(node: unknown) => unknown>(),
}));

vi.mock('../src/mindmap', () => ({
	getNodeGroupEl: getNodeGroupElMock,
	// 与生产实现同语义（getData 取字符串，非字符串归一为空串）
	getNodeDataString: (node: { getData?: (key: string) => unknown }, key: string) => {
		const value = node.getData?.(key);
		return typeof value === 'string' ? value : '';
	},
}));

/** 最小元素桩：contains/closest/getBoundingClientRect 由用例决定 */
class FakeElement {
	containsResult = true;
	closestResult: unknown = null;
	/** 视口矩形（用例可改尺寸，供 offsetWidth/offsetHeight 断言） */
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
		// 视口坐标（弹窗定位已不依赖指针坐标，保留以覆盖事件透传）
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
		binder.fire(
			'node_mouseenter',
			fakeNode({ mdWikiLinkpath: '[[笔记]]' }),
			fakeMouseEvent(targetEl),
		);

		// 官方 HoverPopover.position() 取 bottom = rect.top + targetEl.offsetHeight：
		// SVG 节点缺这两个属性时该值为 NaN，「下方放得下就放下方」分支永不成立
		const el = targetEl as unknown as {
			offsetWidth: number;
			offsetHeight: number;
		};
		expect(el.offsetWidth).toBe(160);
		expect(el.offsetHeight).toBe(40);
		expect(Number.isFinite(targetEl.rect.top + el.offsetHeight)).toBe(true);
		expect(trigger).toHaveBeenCalledTimes(1);
	});

	it('原始事件原样透传（定位改由 targetEl 矩形决定，不再改写指针坐标）', () => {
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

	it('ensureOffsetSize：元素缺失静默；已具备几何属性的元素不覆盖', () => {
		expect(() => ensureOffsetSize(null)).not.toThrow();
		// 模拟 HTMLElement（原型链上已有 offsetWidth/offsetHeight）：保持原值
		const native = {
			offsetWidth: 7,
			offsetHeight: 9,
			getBoundingClientRect: () => ({ width: 100, height: 40 }),
		};
		ensureOffsetSize(native as unknown as Element);
		expect(native.offsetWidth).toBe(7);
		expect(native.offsetHeight).toBe(9);
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
