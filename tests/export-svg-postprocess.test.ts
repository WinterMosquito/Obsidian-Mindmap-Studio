/**
 * 导出 SVG 后处理的回归（platform/export-svg-postprocess）：
 *
 * 1. **foreignObject 几何余量**（K106）：克隆 SVG 的每个 FO 宽 +12 / 高 +20。
 *    背景：`<img>` 解码的 SVG 出口渲染与主文档存在文本度量偏差（轻量节点
 *    ~2px、标点密集长文本行可达 ~12px），临界节点换行后被固定高度裁切、
 *    长文本行末字符贴右线（用户实拍）。余量按分布上界取值，实际效果
 *    （padW 2 即恢复单行）已在实机扫描验证。
 * 2. **platform 单入口**（`postProcessExportSvg`）：几何余量 → CSS 变量注入，
 *    顺序由实现保证、原样返回同一对象（引擎要求）。
 *
 * 契约：
 * - 全部 FO 宽 +12、高 +20，且**原样返回同一对象**（引擎要求）；
 * - **横向余量左右各半**（2026-11-11）：x 左移 6（缺省 x 按 0 算）、宽 +12 ⇒
 *   内容盒在节点形状内保持居中。单侧加宽会把右内边距压到 4px（实机：形状
 *   176 / FO 188 / 内容 [16,172]，用户实拍"边框右边比左边窄"）；
 * - 尺寸属性缺失/非法（null / 非数字）→ 跳过该 FO，其余照常处理；
 * - 无 FO / 形态不符（null / 缺 node / 无 querySelectorAll）→ 安全 no-op。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	padForeignObjectsForExport,
	postProcessExportSvg,
} from '../src/platform/export-svg-postprocess';

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
	it('全部 foreignObject 宽 +12、高 +20、x −6（左右各半），并原样返回同一对象', () => {
		const foA = makeFO({ width: '259.3125', height: '26.15625' });
		const foB = makeFO({ width: '100', height: '50' });
		const svgElement = { node: { querySelectorAll: vi.fn(() => [foA, foB]) } };

		const returned = padForeignObjectsForExport(svgElement);

		expect(returned, '原样返回（引擎要求）').toBe(svgElement);
		// x 缺省按 0 算：引擎导出的 FO 不写 x（实测 20/20），按 NaN 跳过会让修正失效
		expect(foA.snapshot()).toEqual({
			x: '-6',
			width: '271.3125',
			height: '46.15625',
		});
		expect(foB.snapshot()).toEqual({ x: '-6', width: '112', height: '70' });
	});

	it('**横向余量左右各半**：已有 x 的 FO 左移 6、宽度 +12（内容盒保持居中）', () => {
		// 实机形态（2026-11-11 导出 SVG 实测）：节点形状 176、FO 宽 188、x 缺省。
		// 原实现只加宽 ⇒ 内容盒 [16,172]：右内边距 4px，观感"边框右边比左边窄"。
		const fo = makeFO({ x: '40', width: '176', height: '38.79' });

		padForeignObjectsForExport({ node: { querySelectorAll: () => [fo] } });

		expect(fo.snapshot()).toEqual({ x: '34', width: '188', height: '58.79' });
		// 对称性：形状 [40,216]，内容盒（16px 内边距）= [50,206] ⇒ 左右各 10px
		const snapshot = fo.snapshot();
		const shapeLeft = 40;
		const shapeRight = 40 + 176;
		const contentLeft = Number(snapshot['x']) + 16;
		const contentRight = Number(snapshot['x']) + Number(snapshot['width']) - 16;
		expect(contentLeft - shapeLeft, '左内边距').toBe(10);
		expect(shapeRight - contentRight, '右内边距（必须与左相等）').toBe(10);
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
		expect(foOk.snapshot()).toEqual({ x: '-6', width: '22', height: '40' });
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

describe('postProcessExportSvg（platform 单入口：几何 → 变量）', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('一次调用完成 FO 加宽与 CSS 变量注入，并原样返回同一对象', () => {
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: (name: string) =>
				name === '--font-interface' ? 'Inter' : '',
		}));
		const fo = makeFO({ width: '100', height: '40' });
		const styleEl = { textContent: '' };
		const root = {
			querySelectorAll: vi.fn(() => [fo]),
			appendChild: vi.fn(),
			ownerDocument: { win: { createSvg: () => styleEl } },
		};
		const svgElement = { node: root };

		const returned = postProcessExportSvg(svgElement);

		expect(returned, '原样返回（引擎要求）').toBe(svgElement);
		expect(fo.snapshot()).toEqual({ x: '-6', width: '112', height: '60' });
		expect(root.appendChild).toHaveBeenCalledTimes(1);
		expect(styleEl.textContent).toBe('svg { --font-interface: Inter; }');
	});

	/**
	 * 白名单是「保守」的：自绘内容新引用的变量必须登记，否则导出图拿不到
	 * 宿主主题值、只能退回内联兜底。任务复选框完成态的勾色（`--text-on-accent`）
	 * 是 2026-10-28 新增的一项——底色改成主题链接色后构建期测不到亮度。
	 */
	it('勾色变量（--text-on-accent）在注入白名单内', () => {
		vi.stubGlobal('document', { body: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: (name: string) =>
				name === '--text-on-accent' ? '#ffffff' : '',
		}));
		const styleEl = { textContent: '' };
		const root = {
			querySelectorAll: vi.fn(() => []),
			appendChild: vi.fn(),
			ownerDocument: { win: { createSvg: () => styleEl } },
		};

		postProcessExportSvg({ node: root });

		expect(styleEl.textContent).toBe('svg { --text-on-accent: #ffffff; }');
	});

	it('两步各自 no-op（形态不符 / 宿主不可用）时仍原样返回、不抛错', () => {
		const malformedA = null;
		const malformedB = { node: {} };

		expect(postProcessExportSvg(malformedA)).toBe(malformedA);
		expect(postProcessExportSvg(malformedB)).toBe(malformedB);
	});
});
