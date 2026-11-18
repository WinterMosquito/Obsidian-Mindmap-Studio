/**
 * 画布误新建回归：执行真实 MindMapView 构造器传给 EngineController 的
 * setupFeatures，再派发画布事件。保留真实节点动作和 EventBinder；其它特性
 * 在各自套件直测，这里替换为 no-op，避免引入整套 Obsidian DOM。
 * 恢复旧的空白双击绑定时，本测试会真的插入节点而失败。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { EventBinder } from '../src/core/event-binder';
import type { ViewPluginContext } from '../src/features/view/view-context';
import type { MindMapNode } from '../src/core/engine-types';
import type { NewMapSyntax } from '../src/core/constants';
import type { EngineControllerDeps } from '../src/services/engine-controller';
import { MindMapView } from '../src/features/view/view';
import { createChildNodeBelow } from '../src/features/editing/view-node-actions';

const harness = vi.hoisted<{
	deps: EngineControllerDeps | null;
	engine: unknown;
	events: EventBinder | null;
	openEditor: ReturnType<typeof vi.fn>;
	applySnapshot: ReturnType<typeof vi.fn>;
}>(() => ({
	deps: null,
	engine: null,
	events: null,
	openEditor: vi.fn(),
	applySnapshot: vi.fn(() => true),
}));

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		FileView: class {
			app = { isDarkMode: () => false };
			constructor(_leaf: unknown) {}
		},
	};
});
vi.mock('../src/services/engine-controller', () => ({
	EngineController: class {
		mindMap = harness.engine;
		engineEvents = harness.events;
		constructor(deps: EngineControllerDeps) { harness.deps = deps; }
	},
}));
vi.mock('../src/engine/mindmap', () => ({
	ENGINE_COMMANDS: { INSERT_CHILD_NODE: 'INSERT_CHILD_NODE' },
	getRenderRoot: (engine: { renderer: { root: unknown } } | null) => engine?.renderer.root,
	isCustomNodeContent: () => true,
	isSummaryNode: () => false,
	applySessionSnapshot: harness.applySnapshot,
}));
vi.mock('../src/features/editing/node-inline-editor', () => ({
	openNodeInlineEditor: harness.openEditor,
}));

// 保留真实 view-node-actions 的节点编辑/创建绑定；不测这些独立特性的内部行为。
vi.mock('../src/features/editing/view-dnd');
vi.mock('../src/features/editing/view-paste');
vi.mock('../src/features/view/view-context-menu');
vi.mock('../src/features/navigation/view-wikilink');
vi.mock('../src/features/content/view-node-task');
vi.mock('../src/features/relations/node-pick');
vi.mock('../src/features/relations/view-node-relation');
vi.mock('../src/features/content/view-tag');
vi.mock('../src/features/content/view-footnote');
vi.mock('../src/features/content/node-codeblock');
vi.mock('../src/features/canvas/view-viewport');
vi.mock('../src/features/media/image-resize');
vi.mock('../src/features/canvas/view-node-width');
vi.mock('../src/features/view/view-minimap');
vi.mock('../src/features/editing/view-syntax');

/** EventTarget 带 closest：旧绑定的 instanceof/closest 判据也必须能命中空白。 */
class CanvasTarget extends EventTarget {
	closest(): null { return null; }
}

function setupView(newMapSyntax: NewMapSyntax = 'list') {
	vi.stubGlobal('Element', CanvasTarget);
	const canvas = new CanvasTarget();
	const events = new EventBinder();
	const listeners = new Map<string, (...args: unknown[]) => void>();
	const root = { children: [] as unknown[], getData: () => ({}) };
	const execCommand = vi.fn((command: string, _openEdit: boolean, _parents: unknown, data: unknown) => {
		if (command === 'INSERT_CHILD_NODE') root.children.push(data);
	});
	harness.events = events;
	harness.engine = {
		renderer: { root },
		execCommand,
		on: (name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener),
		off: (name: string) => listeners.delete(name),
	};
	const view = new MindMapView({} as WorkspaceLeaf, {
		settings: { defaultLayout: 'logicalStructure', language: 'zh', newMapSyntax },
	} as ViewPluginContext);
	view.canvasEl = canvas as unknown as HTMLElement;
	expect(harness.deps).not.toBeNull();
	harness.deps!.setupFeatures();
	return { view, canvas, root, execCommand, events, listeners };
}

afterEach(() => {
	harness.events?.destroy();
	harness.deps = null;
	harness.openEditor.mockClear();
	harness.applySnapshot.mockClear();
	vi.unstubAllGlobals();
});

describe('空图快照重新初始化（K201）', () => {
	it.each<[NewMapSyntax, number | null]>([['list', null], ['h1', 1], ['h2', 2]])(
		'撤销或外部修改回到空图：%s 模式重新播种，且不修改会话输入',
		(syntax, start) => {
			const { view } = setupView(syntax);
			const snapshot = { data: { text: '中心' }, children: [] };
			expect(view.applySnapshot(snapshot)).toBe(true);
			expect(harness.applySnapshot).toHaveBeenCalledExactlyOnceWith(
				view.mindMap, { data: { text: '中心', mdHeadingStart: start }, children: [] },
			);
			expect(snapshot).toEqual({ data: { text: '中心' }, children: [] });
		},
	);

	it('已有正文的快照维持其自身语法，不受新建设置覆盖', () => {
		const { view } = setupView('h2');
		const snapshot = {
			data: { text: '中心', mdHeadingStart: 1 },
			children: [{ data: { text: '第一分支', mdType: 'heading', mdLevel: 1 }, children: [] }],
		};
		view.applySnapshot(snapshot);
		expect(harness.applySnapshot.mock.calls[0]![1]).toBe(snapshot);
		expect(snapshot.data.mdHeadingStart).toBe(1);
	});
});

describe('视图画布交互（K200）', () => {
	it('连续点击空白，包括双击，不增加中心节点的子节点或执行编辑命令', () => {
		const { canvas, root, execCommand } = setupView();
		for (let i = 0; i < 3; i++) {
			for (const type of ['mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'click', 'dblclick']) {
				canvas.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
			}
		}
		expect(root.children).toHaveLength(0);
		expect(execCommand).not.toHaveBeenCalled();
		expect(harness.openEditor).not.toHaveBeenCalled();
	});

	it('节点双击仍打开自绘节点的内联编辑器', () => {
		const { view, listeners, execCommand } = setupView();
		const node = {} as MindMapNode;
		expect(listeners.has('node_dblclick')).toBe(true);
		listeners.get('node_dblclick')!(node);
		expect(harness.openEditor).toHaveBeenCalledExactlyOnceWith(view, node);
		expect(execCommand).not.toHaveBeenCalled();
	});

	it('显式新建入口仍在指定父节点下插入空节点并立即编辑', () => {
		const { view, root, execCommand } = setupView();
		createChildNodeBelow(view, root as unknown as MindMapNode);
		expect(root.children).toHaveLength(1);
		expect(root.children[0]).toMatchObject({ text: '' });
		expect(execCommand).toHaveBeenCalledExactlyOnceWith(
			'INSERT_CHILD_NODE', true, [root], expect.objectContaining({ text: '' }),
		);
	});
});
