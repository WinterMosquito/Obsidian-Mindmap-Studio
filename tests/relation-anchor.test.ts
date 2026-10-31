/**
 * 手绘锚定的纯几何回归（`domain/relation-anchor`）。
 *
 * 三组断言：
 * 1. **射线投射**：四边、内部点、中心退化；`range` 的符号必须与引擎
 *    `getNodePoint` 一致（左右用 centerY - y，上下用 centerX - x）；
 * 2. **会话**：第一次落定只冻结起点，第二次才产出 `geo` 的 8 个字段；
 * 3. **预览**：第一阶段只有起点柄，第二阶段起点柄冻结、终点柄跟指针。
 */
import { describe, expect, it } from 'vitest';
import {
	anchorAtPointer,
	commitAnchorSession,
	createAnchorSession,
	cubicCurvePath,
	moveAnchorSession,
	previewOf,
	type RelationAnchorSession,
} from '../src/domain/relation-anchor';
import type { RelationRect } from '../src/domain/relation';

const rect = (left: number, top: number, width = 100, height = 20): RelationRect => ({
	left,
	top,
	width,
	height,
});

describe('anchorAtPointer：射线投射', () => {
	const box = rect(0, 0, 100, 20); // 中心 (50, 10)

	it('正右 / 正左 / 正上 / 正下：落在该边中点，range = 0', () => {
		expect(anchorAtPointer(box, { x: 200, y: 10 })).toEqual({
			dir: 'right',
			range: 0,
			x: 100,
			y: 10,
		});
		expect(anchorAtPointer(box, { x: -100, y: 10 })).toEqual({
			dir: 'left',
			range: 0,
			x: 0,
			y: 10,
		});
		expect(anchorAtPointer(box, { x: 50, y: -100 })).toEqual({
			dir: 'top',
			range: 0,
			x: 50,
			y: 0,
		});
		expect(anchorAtPointer(box, { x: 50, y: 100 })).toEqual({
			dir: 'bottom',
			range: 0,
			x: 50,
			y: 20,
		});
	});

	it('右下方：取射线先穿出的右边，range 与引擎同符号（向下为负）', () => {
		const point = anchorAtPointer(box, { x: 200, y: 20 });
		expect(point.dir).toBe('right');
		expect(point.x).toBeCloseTo(100, 5);
		expect(point.y).toBeCloseTo(13.3333, 3);
		expect(point.range).toBeCloseTo(-3.3333, 3);
	});

	it('指针在盒内：仍给出朝向指针那侧的边（不返回 NaN）', () => {
		const point = anchorAtPointer(box, { x: 70, y: 10 });
		expect(point).toEqual({ dir: 'right', range: 0, x: 100, y: 10 });
	});

	it('指针恰好落在中心：退化到右边中点', () => {
		expect(anchorAtPointer(box, { x: 50, y: 10 })).toEqual({
			dir: 'right',
			range: 0,
			x: 100,
			y: 10,
		});
	});

	it('上边：range 按 centerX - x（向右为负），交点是射线与上边的真实交点', () => {
		const point = anchorAtPointer(box, { x: 80, y: -100 });
		expect(point.dir).toBe('top');
		// 中心 (50,10) → 指针 (80,-100)：上边 t = 10/110 ⇒ x = 50 + 30×(10/110)
		expect(point.x).toBeCloseTo(52.7273, 3);
		expect(point.range).toBeCloseTo(-2.7273, 3);
	});
});

describe('锚定会话：两次落定产出 geo', () => {
	const from = rect(0, 0);
	const to = rect(0, 200);

	function started(): RelationAnchorSession {
		const session = createAnchorSession(from, to, { x: 200, y: 10 });
		expect(commitAnchorSession(session)).toBeNull(); // 只落定起点
		return session;
	}

	it('第一次落定：只冻结起点（终点手柄尚未存在 = 等终点）', () => {
		const session = started();
		expect(session.start).toEqual({
			pointer: { x: 200, y: 10 },
			anchor: { dir: 'right', range: 0, x: 100, y: 10 },
		});
		expect(session.end).toBeUndefined();
	});

	it('第二次落定：产出 8 个字段（端点相对量 + 控制点相对差值）', () => {
		const session = started();
		moveAnchorSession(session, { x: 250, y: 210 });
		const geometry = commitAnchorSession(session);
		expect(geometry).toEqual({
			fromDir: 'right',
			fromRange: 0,
			toDir: 'right',
			toRange: 0,
			ctl1: { x: 100, y: 0 },
			ctl2: { x: 150, y: 0 },
		});
		expect(session.end).toEqual({
			pointer: { x: 250, y: 210 },
			anchor: { dir: 'right', range: 0, x: 100, y: 210 },
		});
	});

	it('第二次落定后再改指针也不会改变已产出的几何（落定即冻结）', () => {
		const session = started();
		moveAnchorSession(session, { x: 250, y: 210 });
		const geometry = commitAnchorSession(session);
		moveAnchorSession(session, { x: 900, y: 900 });
		expect(geometry).not.toBeNull();
		expect(session.end?.pointer).toEqual({ x: 250, y: 210 });
	});
});

describe('预览', () => {
	const from = rect(0, 0);
	const to = rect(0, 200);

	it('第一阶段：只有起点柄，路径是「锚点 → 指针」直线', () => {
		const session = createAnchorSession(from, to, { x: 200, y: 10 });
		const preview = previewOf(session);
		expect(preview.startHandle).toEqual({ x: 200, y: 10 });
		expect(preview.endHandle).toBeNull();
		expect(preview.path).toBe('M 100,10 L 200,10');
	});

	it('第二阶段：起点柄冻结，终点柄跟指针，路径是三次贝塞尔', () => {
		const session = createAnchorSession(from, to, { x: 200, y: 10 });
		commitAnchorSession(session);
		moveAnchorSession(session, { x: 250, y: 210 });
		const preview = previewOf(session);
		expect(preview.startHandle).toEqual({ x: 200, y: 10 });
		expect(preview.endHandle).toEqual({ x: 250, y: 210 });
		expect(preview.path).toBe('M 100,10 C 200,10 250,210 100,210');
	});

	it('cubicCurvePath 与引擎 path 的 `M … C …` 同形', () => {
		expect(
			cubicCurvePath(
				{ x: 0, y: 0 },
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
				{ x: 5, y: 6 },
			),
		).toBe('M 0,0 C 1,2 3,4 5,6');
	});
});
