/** 实际 vendor 落点判定与提交；只替换 SVG 绘制，真实 DOM 手势另由 verify:visual 覆盖。 */
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { document?: unknown }).document ??= { documentElement: {} };
interface DragApi {
	bindEvent(): void;
	checkOverlapNode(): void;
	onMouseup(event: { clientX: number; clientY: number }): Promise<void>;
	reset(): void;
	unBindEvent(): void;
	nodeTreeToList(): void;
}
const { Drag } = createRequire(import.meta.url)('../../vendor/simple-mind-map.cjs') as {
	Drag: { prototype: DragApi };
};

interface NodeStub {
	uid: string;
	left: number;
	top: number;
	width: number;
	height: number;
	layerIndex: number;
	isRoot: boolean;
	parent: NodeStub | null;
	children: NodeStub[];
	group: { node: { isConnected: boolean } };
	getData(key?: string): unknown;
	isAncestor(node: NodeStub): boolean;
	setOpacity(): void;
	showChildren(): void;
	endDrag(): void;
}
function node(uid: string, left = 100, top = 100): NodeStub {
	const data: Record<string, unknown> = { uid, isActive: false, expand: true, text: uid };
	return {
		uid, left, top, width: 100, height: 40, layerIndex: 1, isRoot: false,
		parent: null, children: [], group: { node: { isConnected: true } },
		getData: key => key ? data[key] : data,
		isAncestor(other) {
			for (let parent = other.parent; parent; parent = parent.parent) if (parent === this) return true;
			return false;
		},
		setOpacity: vi.fn(), showChildren: vi.fn(), endDrag: vi.fn(),
	};
}

function harness(scale = 1, layout = 'logicalStructure') {
	const root = node('root', 0, 0);
	root.isRoot = true;
	root.layerIndex = 0;
	const target = node('target');
	root.children = [target]; target.parent = root;
	const source = node('source', 10, 10);
	const transform = { scaleX: scale, scaleY: scale, translateX: 23, translateY: 47 };
	const command = vi.fn<(...args: unknown[]) => void>();
	const renderer = { root, activeNodeList: [] };
	const opt = {
		layout, enableFreeDrag: false, autoMoveWhenMouseInEdgeOnDrag: false,
		el: null as { ownerDocument: { defaultView: {
			requestAnimationFrame(callback: () => void): number;
			cancelAnimationFrame(id: number): void;
			setTimeout(callback: () => void, delay: number): number;
			clearTimeout(id: number): void;
		} } } | null,
	};
	const mindMap = {
		opt, renderer, draw: { transform: () => transform },
		toPos: (clientX: number, clientY: number) => ({ x: clientX, y: clientY }),
		on: vi.fn(), off: vi.fn(), emit: vi.fn(), execCommand: command, render: vi.fn(),
	};
	const drag = Object.assign(Object.create(Drag.prototype) as DragApi, {
		mindMap, drawTransform: transform, nodeList: [target], mouseMoveX: 0, mouseMoveY: 0,
		isMousedown: true, isDragging: true, mousedownNode: source, beingDragNodeList: [source],
		overlapNode: null as NodeStub | null, prevNode: null as NodeStub | null, nextNode: null as NodeStub | null,
		placeholder: { size: vi.fn() }, placeHolderLine: { hide: vi.fn() }, clone: {},
		placeholderWidth: 50, placeholderHeight: 10, minOffset: 10,
		removeExtraLines: vi.fn(), handleOverlapNode: vi.fn(), setPlaceholderRect: vi.fn(),
		removeCloneNode: vi.fn(), removeNodeActive: vi.fn(),
	});
	drag.bindEvent();
	const point = (x: number, y: number) => ({ clientX: x * scale + 23, clientY: y * scale + 47 });
	const preview = (x: number, y: number) => {
		const p = point(x, y); drag.mouseMoveX = p.clientX; drag.mouseMoveY = p.clientY;
		drag.checkOverlapNode(); vi.advanceTimersByTime(16);
	};
	return { drag, target, source, root, transform, command, preview, point };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('结构拖动：屏幕缩放不改变分区语义', () => {
	it.each([0.4, 0.5, 1, 1.5, 2.35])('%s 倍下密集同级节点主体仍可挂为子节点', scale => {
		const h = harness(scale);
		const before = node('before', 100, 59); const after = node('after', 100, 141);
		h.root.children = [before, h.target, after]; before.parent = h.root; after.parent = h.root;
		h.preview(150, 120);
		expect(h.drag.overlapNode).toBe(h.target);
		expect(h.drag.prevNode).toBeNull(); expect(h.drag.nextNode).toBeNull();
		expect(h.drag.drawTransform).toBe(h.transform);
		expect(h.command.mock.calls.every(call => call[0] === 'SET_NODE_ACTIVE')).toBe(true);
	});
	it.each([0.5, 1, 1.5])('%s 倍下组织图的水平密集分区同样正确', scale => {
		const h = harness(scale, 'organizationStructure');
		const before = node('before', -1, 100); const after = node('after', 201, 100);
		h.root.children = [before, h.target, after]; before.parent = h.root; after.parent = h.root;
		h.preview(150, 120);
		expect(h.drag.overlapNode).toBe(h.target);
	});
	it.each([0.5, 1, 2.35])('%s 倍下邻近吸附采用固定屏幕容差', scale => {
		const h = harness(scale); h.preview(200 + 10 / scale, 120);
		expect(h.drag.overlapNode).toBe(h.target);
		h.drag.reset(); h.drag.isMousedown = true; h.drag.isDragging = true;
		h.drag.nodeList = [h.target]; h.drag.drawTransform = h.transform;
		h.preview(200 + 18 / scale, 120);
		expect(h.drag.overlapNode).toBeNull();
	});
	it('邻近上边缘保留同级前插，主体表示子节点', () => {
		const h = harness(); h.preview(210, 95);
		expect(h.drag.nextNode).toBe(h.target); expect(h.drag.overlapNode).toBeNull();
		h.preview(210, 120);
		expect(h.drag.overlapNode).toBe(h.target);
	});
	it('邻近水平边缘保留组织图同级后插', () => {
		const h = harness(1, 'organizationStructure'); h.preview(205, 150);
		expect(h.drag.prevNode).toBe(h.target); expect(h.drag.overlapNode).toBeNull();
	});
	it('退出容差略大于进入容差，边缘微动不反复丢失目标', () => {
		const h = harness(); h.preview(210, 120); expect(h.drag.overlapNode).toBe(h.target);
		h.preview(214, 120); expect(h.drag.overlapNode).toBe(h.target);
		h.preview(218, 120); expect(h.drag.overlapNode).toBeNull();
	});
	it('精确进入另一节点主体时立即更换目标', () => {
		const h = harness(); const other = node('other', 215, 100);
		other.parent = h.root; h.root.children.push(other); h.drag.nodeList.push(other);
		h.preview(190, 120); h.preview(225, 120);
		expect(h.drag.overlapNode).toBe(other);
	});
});

describe('结构拖动：检测调度与一次提交', () => {
	it('画布变换已变化时按实时变换检测，不沿用上次移动的缓存', () => {
		const h = harness(0.5); h.drag.drawTransform = { ...h.transform, translateX: -500 };
		h.preview(150, 120); expect(h.drag.overlapNode).toBe(h.target);
		expect(h.drag.drawTransform).toBe(h.transform);
	});
	it('多选拖动排除整支后代，并用同一命令提交全部顶层节点', async () => {
		const h = harness(); const other = node('other-source', 10, 200);
		h.drag.beingDragNodeList.push(other);
		await h.drag.onMouseup(h.point(150, 120));
		expect(h.command.mock.calls.filter(call => call[0] === 'MOVE_NODE_TO')).toEqual([
			['MOVE_NODE_TO', [h.source, other], h.target],
		]);
	});
	it('调度取所属窗口的 rAF，解绑取消同一窗口的帧', () => {
		const h = harness();
		const win = {
			requestAnimationFrame: vi.fn((callback: () => void) => window.setTimeout(callback, 16)),
			cancelAnimationFrame: vi.fn((id: number) => window.clearTimeout(id)),
			setTimeout: (callback: () => void, delay: number) => window.setTimeout(callback, delay),
			clearTimeout: (id: number) => window.clearTimeout(id),
		};
		h.drag.mindMap.opt.el = { ownerDocument: { defaultView: win } };
		h.drag.checkOverlapNode(); h.drag.unBindEvent();
		expect(win.requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(win.cancelAnimationFrame).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('所属窗口未执行 rAF 时 32ms 兜底一次，迟到帧不重复处理', () => {
		const h = harness(); let frame: (() => void) | undefined;
		h.drag.mindMap.opt.el = { ownerDocument: { defaultView: {
			requestAnimationFrame: callback => { frame = callback; return 0; },
			cancelAnimationFrame: vi.fn(),
			setTimeout: (callback, delay) => window.setTimeout(callback, delay),
			clearTimeout: id => window.clearTimeout(id),
		} } };
		const p = h.point(150, 120); h.drag.mouseMoveX = p.clientX; h.drag.mouseMoveY = p.clientY;
		h.drag.checkOverlapNode(); vi.advanceTimersByTime(32); frame?.();
		expect(h.drag.overlapNode).toBe(h.target);
		expect(h.drag.handleOverlapNode).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('一帧内多次移动只处理最新指针，不再等待 300ms', () => {
		const h = harness();
		h.drag.mouseMoveX = 0; h.drag.mouseMoveY = 0; h.drag.checkOverlapNode();
		const p = h.point(150, 120); h.drag.mouseMoveX = p.clientX; h.drag.mouseMoveY = p.clientY;
		h.drag.checkOverlapNode(); expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(16); expect(h.drag.overlapNode).toBe(h.target);
		expect(h.drag.handleOverlapNode).toHaveBeenCalledTimes(1);
	});
	it('松手前未处理的最新位置立即确认，换父命令只提交一次', async () => {
		const h = harness(0.5); h.drag.checkOverlapNode();
		await h.drag.onMouseup(h.point(150, 120));
		expect(h.command.mock.calls.filter(call => call[0] === 'MOVE_NODE_TO')).toEqual([
			['MOVE_NODE_TO', [h.source], h.target],
		]);
		expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(300);
		expect(h.drag.overlapNode).toBeNull();
	});
	it('离开旧目标后松手不会按陈旧预览提交，原坐标不变', async () => {
		const h = harness(); h.preview(150, 120); h.command.mockClear();
		await h.drag.onMouseup(h.point(900, 900));
		expect(h.command).not.toHaveBeenCalled();
		expect(h.source).toMatchObject({ left: 10, top: 10 });
		expect(h.drag.mindMap.render).not.toHaveBeenCalled();
	});
	it.each(['reset', 'unBindEvent'] as const)('%s 时取消未处理帧', action => {
		const h = harness(); h.drag.checkOverlapNode(); h.drag[action]();
		expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(300);
		expect(h.drag.handleOverlapNode).not.toHaveBeenCalled();
	});
	it('目标列表排除被拖分支、折叠后代与未挂载节点', () => {
		const h = harness(); const hidden = node('hidden'); const detached = node('detached');
		const descendant = node('descendant'); descendant.parent = h.source;
		h.source.children = [descendant]; hidden.parent = h.target; h.target.children = [hidden];
		(h.target.getData() as Record<string, unknown>).expand = false;
		detached.group.node.isConnected = false;
		h.root.children = [h.target, h.source, detached]; h.source.parent = h.root; detached.parent = h.root;
		h.drag.nodeTreeToList();
		expect(h.drag.nodeList).toEqual([h.target, h.root]);
	});
});
