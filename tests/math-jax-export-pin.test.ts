/**
 * pinMathContainerHeightsInExportSvg 单元回归（K107）：导出克隆内
 * `mjx-container` 与主文档同名元素按文档序配对，height 钉为实测布局高度。
 *
 * 背景：导出渲染环境（`<img>` 解码）里 MJX 字体不可用，回退字体度量把容器
 * 盒子撑大（实测屏上 31.24px → 导出 ~56.3px）→ 数学行行盒变高、下方文字
 * 下移 ~8px，压到节点底边框线（用户实拍）。仅钉高度可使文字回到屏上位置
 * （对照实验 v7 命中）。本文件锁定契约：
 * - 数量一致时：逐个钉 `height: Npx`（屏幕像素 ÷ 画布缩放，2 位小数，
 *   `!important`），并原样返回同一对象（引擎要求）；
 * - 数量不符（多视图等）/ 无 mjx / 形态不符 → 安全 no-op（零样式写入）；
 * - 单元素实测不可用（宽高 0 / 无法归一）→ 跳过该元素，其余照常；
 * - 域选择：`.mindmap-canvas-container` 命中即用，否则退回全文；属主文档
 *   取克隆的 `ownerDocument`（popout 兼容）。
 */
import { describe, expect, it, vi } from 'vitest';
import { pinMathContainerHeightsInExportSvg } from '../src/platform/math-jax';

// vi.mock 经 vitest 提升至文件顶部，先于被测模块的依赖解析生效
vi.mock('obsidian', () => ({
	loadMathJax: async (): Promise<void> => {},
	finishRenderMath: async (): Promise<void> => {},
}));

/** 克隆元素桩：`style.setProperty` 可断言（缺失形态用于异常兜底用例） */
function cloneEl(box: 'set' | 'no-setter' | 'no-style' = 'set') {
	const setProperty = vi.fn();
	const style =
		box === 'set' ? { setProperty } : box === 'no-setter' ? {} : undefined;
	return { style, setProperty };
}

/** 实机元素桩：rect / offsetWidth / closest 三个读取面（`inSvg=false` 模拟测量容器克隆） */
function liveEl(
	rect: { width: number; height: number },
	offsetWidth: number,
	host?: {
		rect: { width: number; height: number };
		offsetWidth: number;
	},
	inSvg = true,
) {
	return {
		getBoundingClientRect: () => ({ ...rect }),
		offsetWidth,
		closest: (selector: string) => {
			if (selector === 'svg') {
				return inSvg ? {} : null;
			}
			if (selector !== '.mindmap-node-inline-content' || !host) {
				return null;
			}
			return {
				getBoundingClientRect: () => ({ ...host.rect }),
				offsetWidth: host.offsetWidth,
			};
		},
	};
}

/** 属主文档桩：按选择器返回两份清单（域优先/退回断言用） */
function fakeDoc(scoped: unknown[], global: unknown[]) {
	return {
		querySelectorAll: vi.fn((selector: string) =>
			selector === 'mjx-container' ? global : scoped,
		),
	};
}

/** svg.js 元素桩：node（克隆根）+ ownerDocument */
function svgElementStub(cloneList: unknown[], doc: unknown) {
	return {
		node: {
			querySelectorAll: vi.fn(() => cloneList),
			ownerDocument: doc,
		},
	};
}

describe('pinMathContainerHeightsInExportSvg（导出数学容器高度钉扎，K107）', () => {
	it('数量一致：逐个钉 height = 屏幕高度 ÷ 画布缩放（2 位小数，!important）', () => {
		const a = cloneEl();
		const b = cloneEl();
		// a：缩放 100/100 = 1 → 布局高 50；b：缩放 120/100 = 1.2 → 74.976/1.2 = 62.48
		const liveA = liveEl({ width: 100, height: 50 }, 100);
		const liveB = liveEl({ width: 120, height: 74.976 }, 100);
		const doc = fakeDoc([liveA, liveB], []);
		const svg = svgElementStub([a, b], doc);

		const returned = pinMathContainerHeightsInExportSvg(svg);

		expect(returned, '原样返回（引擎要求）').toBe(svg);
		expect(a.setProperty).toHaveBeenCalledWith('height', '50px', 'important');
		expect(b.setProperty).toHaveBeenCalledWith(
			'height',
			'62.48px',
			'important',
		);
	});

	it('域选择：画布域计数不符时退回全文，命中即用', () => {
		const a = cloneEl();
		const liveA = liveEl({ width: 10, height: 10 }, 10);
		// 画布域 2 个（与克隆 1 个不符）→ 退回全文的 1 个
		const doc = fakeDoc([liveEl({ width: 99, height: 99 }, 99), liveA], [liveA]);
		const svg = svgElementStub([a], doc);

		pinMathContainerHeightsInExportSvg(svg);

		expect(doc.querySelectorAll).toHaveBeenCalledWith(
			'.mindmap-canvas-container mjx-container',
		);
		expect(doc.querySelectorAll).toHaveBeenCalledWith('mjx-container');
		expect(a.setProperty).toHaveBeenCalledWith('height', '10px', 'important');
	});

	it('svg 外候选（引擎离屏测量容器）不参与配对：计数以 svg 内收敛', () => {
		const a = cloneEl();
		// 实机 scoped 域：1 个测量容器克隆（svg 外）+ 1 个真实节点（svg 内）
		const measure = liveEl({ width: 99, height: 99 }, 99, undefined, false);
		const real = liveEl({ width: 10, height: 20 }, 10);
		const doc = fakeDoc([measure, real], []);
		const svg = svgElementStub([a], doc);

		pinMathContainerHeightsInExportSvg(svg);

		expect(a.setProperty).toHaveBeenCalledWith('height', '20px', 'important');
	});

	it('数量不符（多视图等无法可靠配对）→ 零样式写入', () => {
		const a = cloneEl();
		const b = cloneEl();
		const doc = fakeDoc([liveEl({ width: 10, height: 10 }, 10)], []);
		const svg = svgElementStub([a, b], doc);

		const returned = pinMathContainerHeightsInExportSvg(svg);

		expect(returned).toBe(svg);
		expect(a.setProperty).not.toHaveBeenCalled();
		expect(b.setProperty).not.toHaveBeenCalled();
	});

	it('单元素实测不可用：跳过该元素，其余照常（含宿主归一退回）', () => {
		const bad = cloneEl();
		const viaHost = cloneEl();
		const ok = cloneEl();
		// bad：宽高 0 → 跳过；viaHost：自身 offsetWidth 0 → 宿主归一（缩放 2 → 20）
		const liveBad = liveEl({ width: 0, height: 0 }, 0);
		const liveViaHost = liveEl({ width: 40, height: 40 }, 0, {
			rect: { width: 20, height: 20 },
			offsetWidth: 10,
		});
		const liveOk = liveEl({ width: 10, height: 10 }, 10);
		const doc = fakeDoc([liveBad, liveViaHost, liveOk], []);
		const svg = svgElementStub([bad, viaHost, ok], doc);

		pinMathContainerHeightsInExportSvg(svg);

		expect(bad.setProperty).not.toHaveBeenCalled();
		expect(viaHost.setProperty).toHaveBeenCalledWith(
			'height',
			'20px',
			'important',
		);
		expect(ok.setProperty).toHaveBeenCalledWith('height', '10px', 'important');
	});

	it('无 mjx-container：不查询主文档、零写入（安全 no-op）', () => {
		const doc = fakeDoc([], []);
		const svg = svgElementStub([], doc);

		expect(pinMathContainerHeightsInExportSvg(svg)).toBe(svg);
		expect(doc.querySelectorAll).not.toHaveBeenCalled();
	});

	it('形态不符（null / 缺 node / 无查询方法 / 缺 ownerDocument）：安全 no-op', () => {
		const malformedA = null;
		const malformedB = {};
		const malformedC = { node: null };
		const malformedD = { node: {} };
		const noDoc = { node: { querySelectorAll: () => [cloneEl()] } };

		expect(pinMathContainerHeightsInExportSvg(malformedA)).toBe(malformedA);
		expect(pinMathContainerHeightsInExportSvg(malformedB)).toBe(malformedB);
		expect(pinMathContainerHeightsInExportSvg(malformedC)).toBe(malformedC);
		expect(pinMathContainerHeightsInExportSvg(malformedD)).toBe(malformedD);
		expect(pinMathContainerHeightsInExportSvg(noDoc)).toBe(noDoc);
	});

	it('style 缺失 / 无 setProperty：跳过该元素，不抛错', () => {
		const noStyle = cloneEl('no-style');
		const noSetter = cloneEl('no-setter');
		const doc = fakeDoc(
			[liveEl({ width: 10, height: 10 }, 10), liveEl({ width: 10, height: 10 }, 10)],
			[],
		);
		const svg = svgElementStub([noStyle, noSetter], doc);

		expect(() => pinMathContainerHeightsInExportSvg(svg)).not.toThrow();
		expect(noStyle.setProperty).not.toHaveBeenCalled();
		expect(noSetter.setProperty).not.toHaveBeenCalled();
	});
});
