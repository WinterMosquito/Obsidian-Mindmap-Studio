/**
 * 任务复选框：渲染契约 + 点击交互回归。
 *
 * 两段证据链：
 * - **渲染**（`node-inline-html`）：自绘内容的首个子元素是 `span.mindmap-node-task`，
 *   带 `role="checkbox"` / `aria-checked` / `data-task`；任务 token 不再作为文字重复；
 *   含图节点不接管（裁决 4：图片节点不画复选框）；
 * - **交互**（`view-node-task`）：画布 capture 的 mousedown/click/dblclick 三个
 *   监听命中复选框时拦下事件；click 触发一次原文写回（`[ ]` ↔ `[x]`），且**不走**
 *   提交后编排（不触发自动拆链）。
 *
 * Node 环境无 DOM：自建最小 Document/Element 桩（同 node-inline-content.test.ts）；
 * 引擎面整体 mock（只保留本特性用到的 `findNodeByDom`）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MindMapNode } from '../src/core/engine-types';

/** `vi.hoisted`：mock 工厂先于 import 求值，避免 TDZ（不能直接引用下方 const） */
const engineMocks = vi.hoisted(() => ({
	findNodeByDom: vi.fn(),
	recordHistory: vi.fn(),
}));

vi.mock('../src/engine/mindmap', () => ({
	findNodeByDom: engineMocks.findNodeByDom,
	recordHistory: engineMocks.recordHistory,
	markNodeNeedLayout: vi.fn(),
	getNodeGroupEl: () => null,
	isEditingText: () => false,
}));

import {
	buildInlineNodeContent,
	NODE_INLINE_CONTENT_CLASS,
	NODE_TASK_CLASS,
} from '../src/features/node-inline-html';
import { setupNodeTaskInteraction } from '../src/features/view-node-task';
import { toggleTaskToken } from '../src/domain/md-task';

const { findNodeByDom, recordHistory } = engineMocks;

// ---------------------------------------------------------------------------
// 最小 DOM 桩
// ---------------------------------------------------------------------------

class FakeTextNode {
	constructor(readonly text: string) {}
}

class FakeElement {
	className = '';
	textContent = '';
	tagName = '';
	readonly style: Record<string, string> = {};
	readonly children: unknown[] = [];
	readonly attributes = new Map<string, string>();

	appendChild(child: unknown): unknown {
		this.children.push(child);
		return child;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
}

class FakeDocument {
	createElement(tag = ''): FakeElement {
		const el = new FakeElement();
		el.tagName = tag;
		return el;
	}

	createTextNode(text: string): FakeTextNode {
		return new FakeTextNode(text);
	}
}

function asDocument(doc: FakeDocument): Document {
	return doc as unknown as Document;
}

function fakeNode(data: Record<string, unknown> | null): MindMapNode {
	return { getData: () => data } as unknown as MindMapNode;
}

/** 任务节点的 data（与解析侧产物同形） */
function taskData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		mdType: 'list',
		mdMarker: '-',
		mdTask: 'todo',
		mdTaskToken: '[ ]',
		mdRaw: '[ ] 写周报',
		text: '写周报',
		mdDerivedText: '写周报',
		...overrides,
	};
}

describe('任务复选框：渲染', () => {
	it('首个子元素是复选框，token 不再作为文字重复', () => {
		const el = buildInlineNodeContent(
			fakeNode(taskData()),
			asDocument(new FakeDocument()),
			{},
			'zh',
		);
		expect(el).not.toBeNull();
		const children = (el as unknown as FakeElement).children;
		const box = children[0] as FakeElement;
		expect(box.className).toBe(NODE_TASK_CLASS);
		expect(box.tagName).toBe('span');
		expect(box.getAttribute('data-task')).toBe('todo');
		expect(box.getAttribute('role')).toBe('checkbox');
		expect(box.getAttribute('aria-checked')).toBe('false');
		// 显示文本来自剥过 token 的渲染源（`写周报`），不会出现 `[ ]`
		const text = children.slice(1).map((child) => (child as FakeTextNode).text ?? '');
		expect(text.join('')).toBe('写周报');
		expect(text.join('')).not.toContain('[ ]');
	});

	it('完成态：aria-checked=true + 对勾，边框/填充内联（导出保真）', () => {
		const el = buildInlineNodeContent(
			fakeNode(taskData({ mdTask: 'done', mdTaskToken: '[x]', mdRaw: '[x] 写周报' })),
			asDocument(new FakeDocument()),
			{},
			'zh',
		)!;
		const box = (el as unknown as FakeElement).children[0] as FakeElement;
		expect(box.getAttribute('aria-checked')).toBe('true');
		expect(box.style.borderColor).toBeTruthy();
		expect(box.style.backgroundColor).toBeTruthy();
		// 对勾是子元素（不是表单控件）
		expect((box.children[0] as FakeElement).textContent).toBe('✓');
	});

	/**
	 * 勾选态切换不得改变节点高度（2026-10-28 实机：26 → 28，整列下移 1px）。
	 * 诱因是 checkbox 盒内出现 `✓` 后 inline-block 基线由「底边」变「字形基线」，
	 * 行盒被撑高 2px。故对勾必须挂在**绝对定位层**、盒本体不含直接文本——无布局
	 * 的 Node 桩测不出像素，但能锁住这条结构前提（改回 `box.textContent = '✓'`
	 * 会立刻红灯）。
	 */
	it('对勾走绝对定位层：盒本体无文本（两态结构一致，行盒不随勾选变化）', () => {
		const build = (state: 'todo' | 'done') =>
			buildInlineNodeContent(
				fakeNode(
					taskData({
						mdTask: state,
						mdTaskToken: state === 'done' ? '[x]' : '[ ]',
						mdRaw: `${state === 'done' ? '[x]' : '[ ]'} 写周报`,
					}),
				),
				asDocument(new FakeDocument()),
				{},
				'zh',
			)!;
		for (const state of ['todo', 'done'] as const) {
			const el = build(state);
			const box = (el as unknown as FakeElement).children[0] as FakeElement;
			// 盒本体只有「对勾层」一个子节点，且没有裸文本
			expect(box.children.length).toBe(1);
			expect(
				box.children.filter((child) => (child as FakeTextNode).text !== undefined).length,
			).toBe(0);
			const glyph = box.children[0] as FakeElement;
			expect(glyph.style.position).toBe('absolute');
			expect(glyph.style.pointerEvents).toBe('none');
			expect(glyph.textContent).toBe(state === 'done' ? '✓' : '');
			// 定位上下文：盒本体 `position: relative`（绝对定位层的包含块）
			expect(box.style.position).toBe('relative');
		}
	});

	it('空正文任务：仍接管并画出复选框', () => {
		const el = buildInlineNodeContent(
			fakeNode(taskData({ mdRaw: '[ ]', text: '', mdDerivedText: '' })),
			asDocument(new FakeDocument()),
			{},
			'zh',
		);
		expect(el).not.toBeNull();
		expect((el as unknown as FakeElement).className).toBe(NODE_INLINE_CONTENT_CLASS);
		expect(((el as unknown as FakeElement).children[0] as FakeElement).className).toBe(
			NODE_TASK_CLASS,
		);
	});

	it('含图节点：不接管（裁决 4），复选框不出现', () => {
		const el = buildInlineNodeContent(
			fakeNode(taskData({ image: 'app://x/a.png' })),
			asDocument(new FakeDocument()),
			{},
			'zh',
		);
		expect(el).toBeNull();
	});

	it('非列表项（标题/段落）即使有 mdTask 字段也不画（判据在 taskStateOf）', () => {
		const el = buildInlineNodeContent(
			fakeNode(taskData({ mdType: 'plain' })),
			asDocument(new FakeDocument()),
			{},
			'zh',
		)!;
		expect((el as unknown as FakeElement).children[0]).not.toBeInstanceOf(FakeElement);
	});

	it('切换 token 的纯逻辑与渲染状态同源', () => {
		expect(toggleTaskToken('[ ]')).toBe('[x]');
		expect(toggleTaskToken('[X]')).toBe('[ ]');
	});
});

// ---------------------------------------------------------------------------
// 交互：画布 capture 三监听
// ---------------------------------------------------------------------------

interface Listeners {
	mousedown?: (event: unknown) => void;
	click?: (event: unknown) => void;
	dblclick?: (event: unknown) => void;
}

function createHarness(data: Record<string, unknown>) {
	const listeners: Listeners = {};
	const canvasEl = {
		addEventListener: (type: string, handler: (event: unknown) => void) => {
			listeners[type as keyof Listeners] = handler;
		},
		removeEventListener: vi.fn(),
	};
	const node = fakeNode(data);
	findNodeByDom.mockReturnValue(node);
	const view = {
		mindMap: { render: vi.fn() },
		canvasEl,
		app: null,
		lang: 'zh',
		scheduleSave: vi.fn(),
		notifyNodeContentCommitted: vi.fn(),
		engineEvents: {
			onDom: (
				_target: unknown,
				type: string,
				handler: (event: unknown) => void,
			) => {
				listeners[type as keyof Listeners] = handler;
			},
		},
	};
	setupNodeTaskInteraction(view as never);
	return { listeners, view, node, data };
}

/** 复选框元素桩：`closest` 命中自己（事件目标可以是内部对勾） */
function fakeBox(): { closest: (selector: string) => unknown } {
	return { closest: () => fakeBoxElement };
}
const fakeBoxElement = {};

function fakeEvent(target: unknown) {
	return {
		button: 0,
		target,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	};
}

describe('任务复选框：点击交互', () => {
	beforeEach(() => {
		findNodeByDom.mockReset();
		recordHistory.mockReset();
	});

	it('mousedown 命中：阻止引擎开始拖拽', () => {
		const { listeners } = createHarness(taskData());
		const event = fakeEvent(fakeBox());
		listeners.mousedown!(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
	});

	it('click 命中：`[ ]` → `[x]`，走原文写回且跳过提交后编排', () => {
		const { listeners, data, view } = createHarness(taskData());
		const event = fakeEvent(fakeBox());
		listeners.click!(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(data.mdRaw).toBe('[x] 写周报');
		expect(data.mdTask).toBe('done');
		expect(data.mdTaskToken).toBe('[x]');
		expect(data.text).toBe('写周报');
		// 保存已调度、渲染已发生、历史已记
		expect(view.scheduleSave).toHaveBeenCalledTimes(1);
		expect(view.mindMap.render).toHaveBeenCalledTimes(1);
		expect(recordHistory).toHaveBeenCalledTimes(1);
		// 任务勾选不触发自动拆链 / 中心主题改名
		expect(view.notifyNodeContentCommitted).not.toHaveBeenCalled();
	});

	it('再次点击切回未完成', () => {
		const { listeners, data } = createHarness(
			taskData({ mdTask: 'done', mdTaskToken: '[x]', mdRaw: '[x] 写周报' }),
		);
		listeners.click!(fakeEvent(fakeBox()));
		expect(data.mdTask).toBe('todo');
		expect(data.mdRaw).toBe('[ ] 写周报');
	});

	it('dblclick 命中：只吞事件，不打开编辑器', () => {
		const { listeners } = createHarness(taskData());
		const event = fakeEvent(fakeBox());
		listeners.dblclick!(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.stopPropagation).toHaveBeenCalled();
	});

	it('点击落在普通文本上：不拦（交回引擎选中语义）', () => {
		const { listeners } = createHarness(taskData());
		const event = fakeEvent({ closest: () => null });
		listeners.click!(event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(findNodeByDom).not.toHaveBeenCalled();
	});
});
