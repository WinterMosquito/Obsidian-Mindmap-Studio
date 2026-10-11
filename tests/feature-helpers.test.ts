/**
 * 交互特性纯函数回归（表驱动边界用例）：
 * - image-resize.ts：`computeResizedSize`（水平拖动 + 等比缩放 + 上下限联动钳制）。
 *
 * 为什么这些用例全部断言「具体数值」而不是「命中即可」：
 * 尺寸钳制是**用户可直接感知的几何契约**——回推错一点图片就变形。
 * 故每个分支都写死位移与宽高数值，回归时改动会立刻暴露。
 */
import { describe, expect, it, vi } from 'vitest';
import { computeResizedSize } from '../src/features/image-resize';

// 特性模块经 import 链加载 vendor bundle（bundle 顶层求值触碰
// document.documentElement），与 vendor-contract.test.ts 同款桩。
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
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
