/**
 * 新交互特性纯函数回归：
 * - drag-target.ts：拖拽换父辅助的识别范围算法（pointToRectDistance /
 *   pickNearestNode）——指针到节点矩形距离、外扩范围命中、并列取先；
 * - image-resize.ts：图片拖拽等比缩放的尺寸计算（computeResizedSize）——
 *   水平驱动、比例保持、上下限钳制。
 *
 * DOM/引擎交互部分（手柄、事件会话、外借落点）不经 Node 环境，由
 * vendor-contract（令牌）与 tsc 类型面覆盖。
 */
import { describe, expect, it, vi } from 'vitest';
import {
	DropAnchor,
	gapCenter,
	nodeViewportCenter,
	pickNearestNode,
} from '../src/features/drag-target';
import { DRAG_TARGET_RADIUS_PX as TARGET_RADIUS_PX } from '../src/constants';
import { computeResizedSize } from '../src/features/image-resize';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';

// 两个特性模块经 import 链加载 vendor bundle（bundle 顶层求值触碰
// document.documentElement，见 vendor-contract.test.ts 同款桩）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

interface RectNode {
	id: string;
	left: number;
	top: number;
	width: number;
	height: number;
}

function rectNode(id: string, left: number, top: number, width: number, height: number): RectNode {
	return { id, left, top, width, height };
}

describe('drag-target.nodeViewportCenter（节点中心锚点）', () => {
	const transform = { scaleX: 2, scaleY: 2, translateX: 10, translateY: 20 };

	it('content 中心经变换映射到画布视口空间', () => {
		const node = rectNode('n', 100, 100, 80, 40); // content 中心 (140, 120)
		// 结构化桩：getNodeLayoutRect 只读取 left/top/width/height
		const c = nodeViewportCenter(node as unknown as MindMapNode, transform);
		// (140*2+10, 120*2+20) = (290, 260)
		expect(c).toEqual({ x: 290, y: 260 });
	});
});

describe('drag-target.pickNearestNode（节点中心均匀圆域）', () => {
	const radius = TARGET_RADIUS_PX; // 120
	const nodes = [
		rectNode('near', 100, 100, 50, 30), // 中心 (125, 115)
		rectNode('far', 600, 600, 50, 30), // 中心 (625, 615)
	];
	const centerOf = (n: RectNode) => ({
		x: n.left + n.width / 2,
		y: n.top + n.height / 2,
	});

	it('指针在中心识别半径内：命中该节点（与节点形状无关）', () => {
		// 指针 (230, 115)：在 near 矩形外（右边缘 150）但距其中心 105 < 120
		const hit = pickNearestNode(nodes, { x: 230, y: 115 }, radius, centerOf);
		expect(hit?.id).toBe('near');
	});

	it('超出均匀半径：不命中（返回 null，不干扰引擎自由拖放）', () => {
		// 距 near 中心 135px（> 120）
		expect(pickNearestNode(nodes, { x: 260, y: 115 }, radius, centerOf)).toBeNull();
		// 远处空旷区域
		expect(pickNearestNode(nodes, { x: 350, y: 350 }, radius, centerOf)).toBeNull();
	});

	it('多个候选在半径内：取中心距离最近者（大小节点锚点等权）', () => {
		// 大节点 wide 中心 (200, 115)，小节点 small 中心 (330, 115)
		const wide = rectNode('wide', 100, 100, 200, 30);
		const small = rectNode('small', 300, 100, 60, 30);
		// 指针 (280, 115)：距 wide 中心 80、距 small 中心 50 → 取 small
		//（矩形方案下此时指针已在 wide 矩形内，形状方案会偏向大节点）
		expect(pickNearestNode([wide, small], { x: 280, y: 115 }, radius, centerOf)?.id).toBe('small');
		// 指针 (180, 115)：距 wide 20、距 small 150 → 取 wide
		expect(pickNearestNode([wide, small], { x: 180, y: 115 }, radius, centerOf)?.id).toBe('wide');
	});

	it('半径参数生效：同一落点随半径缩放命中/脱靶', () => {
		// 指针 (230, 115) 距 near 中心 105
		expect(pickNearestNode(nodes, { x: 230, y: 115 }, 110, centerOf)?.id).toBe('near');
		expect(pickNearestNode(nodes, { x: 230, y: 115 }, 90, centerOf)).toBeNull();
	});
});

describe('drag-target 锚点仲裁（挂子 vs 插兄弟）', () => {
	const nodeA = { id: 'A' } as unknown as MindMapNode;
	const nodeB = { id: 'B' } as unknown as MindMapNode;
	const childAnchors: DropAnchor[] = [
		{ kind: 'child', node: nodeA, point: { x: 125, y: 115 } }, // 节点 A 中心
		{ kind: 'child', node: nodeB, point: { x: 375, y: 115 } }, // 节点 B 中心
	];
	const gap = gapCenter(childAnchors[0]!.point, childAnchors[1]!.point); // (250, 115)
	const anchors: DropAnchor[] = [
		...childAnchors,
		{ kind: 'after', node: nodeA, point: gap }, // A、B 之间的兄弟间隙
	];

	it('gapCenter：两点几何中心', () => {
		expect(gapCenter({ x: 100, y: 100 }, { x: 200, y: 300 })).toEqual({
			x: 150,
			y: 200,
		});
	});

	it('落点在间隙中点：判为「插到兄弟之后」（gap 锚点距离 0 胜出）', () => {
		const hit = pickNearestNode(anchors, gap, TARGET_RADIUS_PX, (a) => a.point);
		expect(hit?.kind).toBe('after');
		expect(hit?.node).toBe(nodeA);
	});

	it('落点靠近节点中心：判为「挂为子节点」（child 锚点胜出）', () => {
		const hit = pickNearestNode(anchors, { x: 125, y: 115 }, TARGET_RADIUS_PX, (a) => a.point);
		expect(hit?.kind).toBe('child');
		expect(hit?.node).toBe(nodeA);
	});

	it('间隙与节点中心的仲裁随距离平滑过渡（近 B 端仍插兄弟，贴 B 中心挂子）', () => {
		// 指针 (310, 115)：距 gap 60、距 B 中心 65 → gap 胜出（插兄弟）
		expect(pickNearestNode(anchors, { x: 310, y: 115 }, TARGET_RADIUS_PX, (a) => a.point)?.kind).toBe('after');
		// 指针 (340, 115)：距 B 中心 35、距 gap 90 → B 胜出（挂子）
		const hit = pickNearestNode(anchors, { x: 340, y: 115 }, TARGET_RADIUS_PX, (a) => a.point);
		expect(hit?.kind).toBe('child');
		expect(hit?.node).toBe(nodeB);
	});

	it('远离全部锚点：返回 null（保持自由拖放）', () => {
		expect(pickNearestNode(anchors, { x: 250, y: 400 }, TARGET_RADIUS_PX, (a) => a.point)).toBeNull();
	});
});

describe('image-resize.computeResizedSize（等比缩放计算）', () => {
	const base = {
		startClientX: 500,
		startWidth: 200,
		startHeight: 100, // 宽高比 2:1
		scale: 1,
	};

	it('水平拖动按画布缩放换算 content 尺寸并保持宽高比', () => {
		// 向右拖 100 屏幕 px（scale 1）→ 宽 300、高 150
		expect(computeResizedSize(base, 600)).toEqual({ width: 300, height: 150 });
		// 缩放 2x：屏幕 50px = content 25px → 宽 225、高 112.5→113
		const zoomed = { ...base, scale: 2 };
		expect(computeResizedSize(zoomed, 550)).toEqual({ width: 225, height: 113 });
	});

	it('缩小到下限钳制（宽高联动，比例不变）', () => {
		// 高≥MIN(24) ⇒ 宽≥48（2:1），高度落在下限
		const size = computeResizedSize(base, 500 - 500);
		expect(size.width).toBe(48);
		expect(size.height).toBe(24);
		expect(size.width / size.height).toBeCloseTo(2, 1);
	});

	it('放大到上限钳制（保持比例回推宽度）', () => {
		// 上限 2000：宽 2000 → 高按比例应为 1000；宽先触顶被回推
		const size = computeResizedSize(base, 500 + 5000);
		expect(size.width).toBeLessThanOrEqual(2000);
		expect(size.height).toBeLessThanOrEqual(2000);
		expect(size.width / size.height).toBeCloseTo(2, 1);
	});

	it('向左拖动收缩尺寸', () => {
		expect(computeResizedSize(base, 450)).toEqual({ width: 150, height: 75 });
	});
});
