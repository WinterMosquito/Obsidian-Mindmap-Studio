/**
 * export-foreign-object-padding 回归（K106）：导出前为克隆 SVG 的每个
 * foreignObject 增加几何余量（宽 +12 / 高 +20）。
 *
 * 背景：`<img>` 解码的 SVG 出口渲染与主文档存在文本度量偏差（轻量节点
 * ~2px、标点密集长文本行可达 ~12px），临界节点换行后被 foreignObject
 * 固定高度裁切、长文本行末字符贴右线（用户实拍）。余量按分布上界取值，
 * 实际效果（padW 2 即恢复单行）已在实机扫描验证；本文件锁定契约：
 * - 全部 FO 宽 +12、高 +20，且**原样返回同一对象**（引擎要求）；
 * - 尺寸属性缺失/非法（null / 非数字）→ 跳过该 FO，其余照常处理；
 * - 无 FO / 形态不符（null / 缺 node / 无 querySelectorAll）→ 安全 no-op。
 */
import { describe, expect, it, vi } from 'vitest';
import { padForeignObjectsForExport } from '../src/platform/export-foreign-object-padding';

/** 伪造 FO 元素（getAttribute/setAttribute 基于内存 store，写入可断言） */
function makeFO(attrs: Record<string, string | null>) {
	const store: Record<string, string | null> = { ...attrs };
	return {
		getAttribute: (name: string): string | null => store[name] ?? null,
		setAttribute: vi.fn((name: string, value: string) => {
			store[name] = value;
		}),
		/** 当前属性快照（断言写入结果） */
		snapshot: (): Record<string, string | null> => ({ ...store }),
	};
}

describe('padForeignObjectsForExport（导出 FO 几何余量，K106）', () => {
	it('全部 foreignObject 宽 +12、高 +20，并原样返回同一对象', () => {
		const foA = makeFO({ width: '259.3125', height: '26.15625' });
		const foB = makeFO({ width: '100', height: '50' });
		const svgElement = { node: { querySelectorAll: vi.fn(() => [foA, foB]) } };

		const returned = padForeignObjectsForExport(svgElement);

		expect(returned, '原样返回（引擎要求）').toBe(svgElement);
		expect(foA.snapshot()).toEqual({ width: '271.3125', height: '46.15625' });
		expect(foB.snapshot()).toEqual({ width: '112', height: '70' });
	});

	it('尺寸缺失或非法（null / 非数字）：跳过该 FO，其余照常处理', () => {
		const foBadA = makeFO({ width: null, height: '26' });
		const foBadB = makeFO({ width: 'abc', height: '26' });
		const foOk = makeFO({ width: '10', height: '20' });
		const svgElement = {
			node: { querySelectorAll: vi.fn(() => [foBadA, foBadB, foOk]) },
		};

		padForeignObjectsForExport(svgElement);

		expect(foBadA.setAttribute).not.toHaveBeenCalled();
		expect(foBadB.setAttribute).not.toHaveBeenCalled();
		expect(foOk.snapshot()).toEqual({ width: '22', height: '40' });
	});

	it('无 foreignObject：不做任何写入（安全 no-op）', () => {
		const svgElement = { node: { querySelectorAll: vi.fn(() => []) } };

		expect(padForeignObjectsForExport(svgElement)).toBe(svgElement);
	});

	it('对象形态不符（null / 缺 node / 无 querySelectorAll）：安全 no-op', () => {
		const malformedA = null;
		const malformedB = {};
		const malformedC = { node: null };
		const malformedD = { node: {} };

		expect(padForeignObjectsForExport(malformedA)).toBe(malformedA);
		expect(padForeignObjectsForExport(malformedB)).toBe(malformedB);
		expect(padForeignObjectsForExport(malformedC)).toBe(malformedC);
		expect(padForeignObjectsForExport(malformedD)).toBe(malformedD);
	});
});
