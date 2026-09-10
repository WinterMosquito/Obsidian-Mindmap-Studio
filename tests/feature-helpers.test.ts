/**
 * 交互特性纯函数回归（表驱动边界用例）：
 * - drag-target.ts：`nodeViewportCenter`（节点中心 → 画布视口空间）、
 *   `gapCenter`（兄弟间隙中点）、`pickNearestNode`（均匀圆域命中与最近仲裁）；
 * - image-resize.ts：`computeResizedSize`（水平拖动 + 等比缩放 + 上下限联动钳制）；
 * - constants.ts：`DRAG_TARGET_RADIUS_PX`（识别域半径取值）。
 *
 * 为什么这些用例全部断言「具体数值」而不是「命中即可」：
 * 识别域与钳制都是**用户可直接感知的几何契约**——半径边界偏 1px 就会
 * 多/少命中一个节点，钳制回推错一点图片就变形。故每个分支都写死距离与
 * 宽高数值，回归时改动会立刻暴露。
 *
 * 边界语义提示：`pickNearestNode` 用 `distSq <= bestDistSq` 比较（闭区间），
 * 因此「恰好等于半径」命中，且**并列时后出现者覆盖先出现者**（见下文用例）。
 */
import { describe, expect, it, vi } from 'vitest';
import { DRAG_TARGET_RADIUS_PX } from '../src/constants';
import {
	gapCenter,
	nodeViewportCenter,
	pickNearestNode,
	type DropAnchor,
} from '../src/features/drag-target';
import { computeResizedSize } from '../src/features/image-resize';
import type { MindMapNode } from '../vendor/simple-mind-map.cjs';

// 特性模块经 import 链加载 vendor bundle（bundle 顶层求值触碰
// document.documentElement），与 vendor-contract.test.ts 同款桩。
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

/**
 * 节点布局矩形桩：`getNodeLayoutRect` 只按字段名读取 left/top/width/height
 * （见 src/mindmap.ts），故结构化桩即可驱动真实几何计算。
 */
interface RectNode {
	id: string;
	left: number;
	top: number;
	width: number;
	height: number;
}

function rectNode(
	id: string,
	left: number,
	top: number,
	width: number,
	height: number,
): RectNode {
	return { id, left, top, width, height };
}

/** 矩形中心（content 空间）：与实现中的中心锚点定义一致 */
function centerOfRect(node: RectNode): { x: number; y: number } {
	return { x: node.left + node.width / 2, y: node.top + node.height / 2 };
}

const IDENTITY = { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };

describe('constants：拖拽识别域半径', () => {
	it('取 120px（覆盖 150–200px 兄弟间距，密集布局下不误命中）', () => {
		expect(DRAG_TARGET_RADIUS_PX).toBe(120);
	});
});

describe('drag-target.nodeViewportCenter（节点中心 → 画布视口空间）', () => {
	const cases: {
		name: string;
		node: RectNode;
		transform: { scaleX: number; scaleY: number; translateX: number; translateY: number };
		expected: { x: number; y: number };
	}[] = [
		{
			name: '缩放 2x + 平移：中心先取 content 中心再乘缩放再加平移',
			node: rectNode('n', 100, 100, 80, 40), // content 中心 (140, 120)
			transform: { scaleX: 2, scaleY: 2, translateX: 10, translateY: 20 },
			expected: { x: 290, y: 260 },
		},
		{
			name: '零尺寸节点：中心即左上角原点',
			node: rectNode('zero', 0, 0, 0, 0),
			transform: IDENTITY,
			expected: { x: 0, y: 0 },
		},
		{
			name: '负坐标（画布左上方向）：中心可为 0/正值',
			node: rectNode('neg', -50, -20, 100, 60), // 中心 (0, 10)
			transform: IDENTITY,
			expected: { x: 0, y: 10 },
		},
		{
			name: '负平移（画布向右下拖动）：平移量直接相加',
			node: rectNode('shift', 100, 200, 80, 40), // 中心 (140, 220)
			transform: { scaleX: 1, scaleY: 1, translateX: -30, translateY: 15 },
			expected: { x: 110, y: 235 },
		},
		{
			name: '缩小到 0.5x：非整数结果保留小数（不做取整）',
			node: rectNode('zoomout', 200, 400, 100, 50), // 中心 (250, 425)
			transform: { scaleX: 0.5, scaleY: 0.5, translateX: 25, translateY: 10 },
			expected: { x: 150, y: 222.5 },
		},
	];

	it.each(cases)('$name', ({ node, transform, expected }) => {
		expect(nodeViewportCenter(node as unknown as MindMapNode, transform)).toEqual(
			expected,
		);
	});

	it('与节点大小无关：共享同一中心的两种尺寸映射到同一点', () => {
		const big = rectNode('big', 0, 0, 200, 40); // 中心 (100, 20)
		const small = rectNode('small', 60, 10, 80, 20); // 中心 (100, 20)
		expect(nodeViewportCenter(big as unknown as MindMapNode, IDENTITY)).toEqual(
			nodeViewportCenter(small as unknown as MindMapNode, IDENTITY),
		);
	});
});

describe('drag-target.pickNearestNode（均匀圆域：命中边界）', () => {
	const radius = DRAG_TARGET_RADIUS_PX; // 120

	it('恰好落在半径上（闭区间）命中：轴向与斜向都算边界内', () => {
		const anchor = [rectNode('a', 0, 0, 0, 0)]; // 中心 (0, 0)
		// 轴向：距离 = 半径
		expect(pickNearestNode(anchor, { x: 120, y: 0 }, radius, centerOfRect)?.id).toBe('a');
		expect(pickNearestNode(anchor, { x: 0, y: -120 }, radius, centerOfRect)?.id).toBe('a');
		// 斜向 3-4-5：72² + 96² = 14400 = 120²（浮点精确）
		expect(pickNearestNode(anchor, { x: 72, y: 96 }, radius, centerOfRect)?.id).toBe('a');
		// 再多 1px：脱靶
		expect(pickNearestNode(anchor, { x: 121, y: 0 }, radius, centerOfRect)).toBeNull();
		expect(pickNearestNode(anchor, { x: 73, y: 96 }, radius, centerOfRect)).toBeNull();
	});

	it('识别标准是「到中心距离」而非「指针在节点矩形内」', () => {
		// 大节点：left 100、宽 400 → 中心 (300, 115)，矩形覆盖 x∈[100, 500]
		const wide = [rectNode('wide', 100, 100, 400, 30)];
		// 指针在矩形内但距中心 190px → 不命中（形状方案会命中，圆域方案要求靠近中心）
		expect(pickNearestNode(wide, { x: 110, y: 115 }, radius, centerOfRect)).toBeNull();
		// 指针在矩形内、距中心 130px（> 120）→ 仍不命中
		expect(pickNearestNode(wide, { x: 170, y: 115 }, radius, centerOfRect)).toBeNull();
		// 距中心 85px（< 120）→ 命中
		expect(pickNearestNode(wide, { x: 215, y: 115 }, radius, centerOfRect)?.id).toBe('wide');

		// 小节点：left 100、宽 100 → 矩形右缘 200、中心 (150, 115)
		const small = [rectNode('small', 100, 100, 100, 30)];
		// 指针在矩形外 60px（x=260），距中心 110px → 命中（狭小节点不再要求精确压中）
		expect(pickNearestNode(small, { x: 260, y: 115 }, radius, centerOfRect)?.id).toBe('small');
		// 指针距中心 135px → 脱靶
		expect(pickNearestNode(small, { x: 285, y: 115 }, radius, centerOfRect)).toBeNull();
	});

	it('多候选在半径内：取中心距离最近者（大节点不因体积占优）', () => {
		// wide 中心 (200, 115)，small 中心 (330, 115)
		const wide = rectNode('wide', 100, 100, 200, 30);
		const small = rectNode('small', 300, 100, 60, 30);
		// 指针 (390, 115)：距 small 60、距 wide 190（只 small 在半径内）
		expect(pickNearestNode([wide, small], { x: 390, y: 115 }, radius, centerOfRect)?.id).toBe(
			'small',
		);
		// 指针 (280, 115)：距 wide 80、距 small 50 → small
		expect(pickNearestNode([wide, small], { x: 280, y: 115 }, radius, centerOfRect)?.id).toBe(
			'small',
		);
		// 指针 (180, 115)：距 wide 20、距 small 150 → wide
		expect(pickNearestNode([wide, small], { x: 180, y: 115 }, radius, centerOfRect)?.id).toBe(
			'wide',
		);
	});

	it('「矩形内的大节点」不敌「矩形外但中心更近的小节点」', () => {
		// 超大节点：left 0、宽 600 → 中心 (300, 15)，矩形覆盖 x∈[0, 600]
		const huge = rectNode('huge', 0, 0, 600, 30);
		// 小节点：left 400、宽 40 → 中心 (420, 15)，矩形覆盖 x∈[400, 440]
		const tiny = rectNode('tiny', 400, 0, 40, 30);
		// 指针 (390, 15)：在 huge 矩形内、在 tiny 矩形外，但距 tiny 中心 30 < 距 huge 中心 90
		// → 中心距离仲裁选中 tiny（形状方案会因「指针落在 huge 内」而挂到 huge）
		expect(pickNearestNode([huge, tiny], { x: 390, y: 15 }, radius, centerOfRect)?.id).toBe(
			'tiny',
		);
	});

	it('等距并列时后出现者胜（源码 `distSq <= bestDistSq` 的覆盖语义）', () => {
		// 两个候选与指针等距（各 100px），出现顺序决定结果：
		// 注意与函数注释「并列时取先出现者」不符——实现用闭区间比较，后者覆盖前者。
		const a = rectNode('a', 200, 0, 0, 0); // 中心 (200, 0)
		const b = rectNode('b', 0, 0, 0, 0); // 中心 (0, 0)
		expect(pickNearestNode([a, b], { x: 100, y: 0 }, radius, centerOfRect)?.id).toBe('b');
		expect(pickNearestNode([b, a], { x: 100, y: 0 }, radius, centerOfRect)?.id).toBe('a');
	});

	it('半径参数生效：同一落点随半径缩放命中/脱靶', () => {
		const nodes = [rectNode('near', 100, 100, 50, 30)]; // 中心 (125, 115)
		// 指针 (230, 115) 距中心 105
		expect(pickNearestNode(nodes, { x: 230, y: 115 }, 110, centerOfRect)?.id).toBe('near');
		expect(pickNearestNode(nodes, { x: 230, y: 115 }, 105, centerOfRect)?.id).toBe('near');
		expect(pickNearestNode(nodes, { x: 230, y: 115 }, 104, centerOfRect)).toBeNull();
	});

	it('半径 0：仅指针恰好压在中心点命中', () => {
		const nodes = [rectNode('dot', 50, 50, 0, 0)]; // 中心 (50, 50)
		expect(pickNearestNode(nodes, { x: 50, y: 50 }, 0, centerOfRect)?.id).toBe('dot');
		expect(pickNearestNode(nodes, { x: 51, y: 50 }, 0, centerOfRect)).toBeNull();
	});

	it('空候选 / 指针坐标非有限值：返回 null（不干扰引擎自由拖放）', () => {
		expect(pickNearestNode([], { x: 0, y: 0 }, radius, centerOfRect)).toBeNull();
		const nodes = [rectNode('a', 0, 0, 20, 20)];
		// toCanvasPoint 在引擎坐标异常时返回 NaN：NaN 比较恒假 → 不外借落点
		expect(pickNearestNode(nodes, { x: NaN, y: 10 }, radius, centerOfRect)).toBeNull();
		expect(pickNearestNode(nodes, { x: 10, y: Number.POSITIVE_INFINITY }, radius, centerOfRect)).toBeNull();
	});
});

describe('drag-target 锚点仲裁（gapCenter + 挂子/插兄弟）', () => {
	const nodeA = { id: 'A' } as unknown as MindMapNode;
	const nodeB = { id: 'B' } as unknown as MindMapNode;
	const childPoints = [
		{ x: 125, y: 115 }, // 节点 A 中心
		{ x: 375, y: 115 }, // 节点 B 中心
	];

	it('gapCenter：两点几何中心（含负坐标与半像素）', () => {
		const cases: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }][] = [
			[{ x: 100, y: 100 }, { x: 200, y: 300 }, { x: 150, y: 200 }],
			[{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
			[{ x: -80, y: -40 }, { x: 80, y: 40 }, { x: 0, y: 0 }],
			// 奇数差：中点落在半像素上（引擎坐标可含小数）
			[{ x: 0, y: 0 }, { x: 101, y: 5 }, { x: 50.5, y: 2.5 }],
		];
		for (const [a, b, expected] of cases) {
			expect(gapCenter(a, b)).toEqual(expected);
		}
	});

	// 锚点数组顺序与 handleMove 构造顺序一致：先全部「挂子」锚点，再追加「兄弟间隙」锚点
	const anchors: DropAnchor[] = [
		{ kind: 'child', node: nodeA, point: childPoints[0]! },
		{ kind: 'child', node: nodeB, point: childPoints[1]! },
		{ kind: 'after', node: nodeA, point: gapCenter(childPoints[0]!, childPoints[1]!) }, // (250, 115)
	];

	it('落点压在间隙中点：判为「插到兄弟之后」（间隙锚点距离 0 胜出）', () => {
		const hit = pickNearestNode(anchors, { x: 250, y: 115 }, DRAG_TARGET_RADIUS_PX, (a) => a.point);
		expect(hit?.kind).toBe('after');
		expect(hit?.node).toBe(nodeA); // 外借 prevNode = A ⇒ 引擎 INSERT_AFTER(A)
	});

	it('落点压在节点中心：判为「挂为子节点」', () => {
		const hitA = pickNearestNode(anchors, { x: 125, y: 115 }, DRAG_TARGET_RADIUS_PX, (a) => a.point);
		expect(hitA?.kind).toBe('child');
		expect(hitA?.node).toBe(nodeA);

		const hitB = pickNearestNode(anchors, { x: 375, y: 115 }, DRAG_TARGET_RADIUS_PX, (a) => a.point);
		expect(hitB?.kind).toBe('child');
		expect(hitB?.node).toBe(nodeB);
	});

	it('随距离平滑过渡：近间隙端插兄弟，贴节点中心挂子', () => {
		// 指针 (310, 115)：距间隙 60、距 B 中心 65 → 间隙胜出
		expect(
			pickNearestNode(anchors, { x: 310, y: 115 }, DRAG_TARGET_RADIUS_PX, (a) => a.point)?.kind,
		).toBe('after');
		// 指针 (340, 115)：距 B 中心 35、距间隙 90 → B 中心胜出
		const nearB = pickNearestNode(anchors, { x: 340, y: 115 }, DRAG_TARGET_RADIUS_PX, (a) => a.point);
		expect(nearB?.kind).toBe('child');
		expect(nearB?.node).toBe(nodeB);
	});

	it('等距（x = 间隙与 B 中心的中垂线）时后出现的间隙锚点胜出', () => {
		// 间隙 (250, 115) 与 B 中心 (375, 115) 的中垂线 x = 312.5（距离各 62.5）
		const hit = pickNearestNode(anchors, { x: 312.5, y: 115 }, DRAG_TARGET_RADIUS_PX, (a) => a.point);
		expect(hit?.kind).toBe('after');
		expect(hit?.node).toBe(nodeA);
	});

	it('远离全部锚点：返回 null（保持自由拖放）', () => {
		expect(
			pickNearestNode(anchors, { x: 250, y: 400 }, DRAG_TARGET_RADIUS_PX, (a) => a.point),
		).toBeNull();
	});
});

describe('image-resize.computeResizedSize（等比缩放与上下限钳制）', () => {
	/** 横向 2:1（200×100），画布 100% */
	const base = { startClientX: 500, startWidth: 200, startHeight: 100, scale: 1 };

	it('水平拖动按画布缩放换算 content 位移（宽高比 2:1 恒定）', () => {
		const cases: {
			name: string;
			session: typeof base;
			clientX: number;
			expected: { width: number; height: number };
		}[] = [
			{ name: '未移动', session: base, clientX: 500, expected: { width: 200, height: 100 } },
			{ name: '右拖 100px（scale 1）', session: base, clientX: 600, expected: { width: 300, height: 150 } },
			{ name: '左拖 50px（scale 1）', session: base, clientX: 450, expected: { width: 150, height: 75 } },
			// scale 2：屏幕 50px = content 25px；高 112.5 四舍五入为 113
			{ name: '右拖 50px（scale 2）', session: { ...base, scale: 2 }, clientX: 550, expected: { width: 225, height: 113 } },
			{ name: '左拖 10px（scale 2）：高 97.5 → 98', session: { ...base, scale: 2 }, clientX: 490, expected: { width: 195, height: 98 } },
			// scale 0.5：屏幕 10px = content 20px
			{ name: '右拖 10px（scale 0.5）', session: { ...base, scale: 0.5 }, clientX: 510, expected: { width: 220, height: 110 } },
		];
		for (const { session, clientX, expected } of cases) {
			expect(computeResizedSize(session, clientX)).toEqual(expected);
		}
	});

	it('缩放下限 24px：宽按比例反推（2:1 ⇒ 宽下限 48），继续拖不再变小', () => {
		// 宽 48 恰为下限（拖动位移 -152）
		expect(computeResizedSize(base, 348)).toEqual({ width: 48, height: 24 });
		// 再多拖 1px 与拖到屏幕另一侧：都停在 48×24（平台期，比例保持）
		expect(computeResizedSize(base, 347)).toEqual({ width: 48, height: 24 });
		expect(computeResizedSize(base, -10_000)).toEqual({ width: 48, height: 24 });
	});

	it('缩放上限 2000px：宽先触顶后被回推，高同步落回界内', () => {
		// 2:1 ⇒ 宽上限 min(2000, 2000/0.5=4000) = 2000，高 1000
		expect(computeResizedSize(base, 2300)).toEqual({ width: 2000, height: 1000 });
		expect(computeResizedSize(base, 2301)).toEqual({ width: 2000, height: 1000 });
		expect(computeResizedSize(base, 999_999)).toEqual({ width: 2000, height: 1000 });
	});

	it('竖向图片（1:3）：由高度界反推宽度界，上限 2000 落在高上', () => {
		const portrait = { startClientX: 500, startWidth: 100, startHeight: 300, scale: 1 };
		// 未钳制区间内正常等比
		expect(computeResizedSize(portrait, 600)).toEqual({ width: 200, height: 600 });
		// 宽上限 = min(2000, 2000/3) ≈ 666.67 → 取整 667；高恰为 2000
		expect(computeResizedSize(portrait, 999_999)).toEqual({ width: 667, height: 2000 });
		// 宽下限 = max(24, 24/3=8) = 24 → 高 72（此时由宽度下限主导）
		expect(computeResizedSize(portrait, -10_000)).toEqual({ width: 24, height: 72 });
	});

	it('正方形（1:1）：上下限同为 24 / 2000', () => {
		const square = { startClientX: 500, startWidth: 100, startHeight: 100, scale: 1 };
		expect(computeResizedSize(square, 550)).toEqual({ width: 150, height: 150 });
		expect(computeResizedSize(square, -10_000)).toEqual({ width: 24, height: 24 });
		expect(computeResizedSize(square, 999_999)).toEqual({ width: 2000, height: 2000 });
	});

	it('钳制全过程保持原始宽高比（含被钳制的两端）', () => {
		const portrait = { startClientX: 500, startWidth: 100, startHeight: 300, scale: 1 };
		const ratio = portrait.startWidth / portrait.startHeight; // 1/3
		for (const clientX of [-10_000, 500, 600, 999_999]) {
			const size = computeResizedSize(portrait, clientX);
			// 容差 3 位：宽被钳到 666.67 后取整为 667，比例末位会偏 ~1.7e-4
			//（钳制只保证比例语义不变，不保证整数取整后逐位精确）
			expect(size.width / size.height).toBeCloseTo(ratio, 3);
		}
	});

	it('同一画布缩放下位移按比例换算：scale 翻倍 ⇒ 位移减半', () => {
		// 右拖 100 屏幕 px：scale 1 → +100 content，scale 2 → +50 content
		expect(computeResizedSize(base, 600).width - base.startWidth).toBe(100);
		expect(
			computeResizedSize({ ...base, scale: 2 }, 600).width - base.startWidth,
		).toBe(50);
	});

	it('纯函数无内部状态：同参数重复调用结果一致', () => {
		const first = computeResizedSize(base, 640);
		const second = computeResizedSize(base, 640);
		expect(second).toEqual(first);
	});
});
