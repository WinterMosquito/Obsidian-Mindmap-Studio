/**
 * 导出 SVG 的 MathJax **字体按需内联**（platform/math-jax-fonts）单元回归。
 *
 * 背景（2026-10-23 实机取证）：导出上下文（`<img>` 解码）禁用 `app://` 外部字体，
 * MathJax 的 stretchy 结构（矩阵竖线 / 根号 / 分式线 / 大括号）整片消失。
 * 把用到字体的 `@font-face` 换成 `data:` URI 后与屏上同形；全量 295 KB，
 * 按 class token 裁剪后仅内联实际用到的族。
 *
 * 本文件锁定：
 * - `@font-face` 解析（含 MathJax 的序号注释形态、带引号的 family）；
 * - 字体族推导：class token 精确匹配 + `ZERO` / `BRK` 恒需；
 * - 内联：用到的替换为 `data:`，未用到 / 缺 base64 的整块删除，其余规则原样；
 * - 快照缺失（未预取）→ null（调用方回退到剥离 @font-face）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

/** 官方字节读取入口（readFontBytes 的第一候选）；默认恒 404 ＝ 读取失败 */
const requestUrlMock = vi.hoisted(() =>
	vi.fn(
		async (
			_request: { url: string },
		): Promise<{ status: number; arrayBuffer: ArrayBuffer }> => ({
			status: 404,
			arrayBuffer: new ArrayBuffer(0),
		}),
	),
);

vi.mock('obsidian', () => ({
	Notice: class {},
	requestUrl: requestUrlMock,
}));

const dir = 'C:/lib/mathjax/tex-font/chtml/woff2/';

const CSS_FIXTURE = [
	`@font-face /* 0 */ { font-family: MJX-TEX-N; src: url("${dir}mjx-tex-n.woff2") format("woff2"); }`,
	`@font-face { font-family: "MJX-TEX-SO"; src: url(${dir}mjx-tex-so.woff2) format("woff2"); }`,
	`@font-face { font-family: MJX-TEX-ZERO; src: url("${dir}mjx-tex-zero.woff2") format("woff2"); }`,
	'mjx-container[jax="CHTML"] { white-space: nowrap; }',
].join('\n');

/** 克隆 SVG 桩：只暴露 `querySelectorAll` + `getAttribute` 两个读取面 */
function rootWithClasses(classes: string[]): Element {
	return {
		querySelectorAll: () =>
			classes.map((value) => ({ getAttribute: () => value })),
	} as unknown as Element;
}

describe('parseFontFaceSources', () => {
	it('解析 family 与 url（注释序号 / 引号 / 无引号三种形态）', async () => {
		const { parseFontFaceSources } = await import('../src/platform/math-jax-fonts');
		const faces = parseFontFaceSources(CSS_FIXTURE);
		expect(faces).toHaveLength(3);
		expect(faces[0]).toEqual({
			family: 'MJX-TEX-N',
			url: `${dir}mjx-tex-n.woff2`,
		});
		expect(faces[1]?.family).toBe('MJX-TEX-SO');
		expect(faces[1]?.url).toBe(`${dir}mjx-tex-so.woff2`);
	});

	it('形态不符（缺 family / 缺 url）的块被忽略', async () => {
		const { parseFontFaceSources } = await import('../src/platform/math-jax-fonts');
		expect(parseFontFaceSources('@font-face { src: url("/x.woff2"); }')).toEqual(
			[],
		);
		expect(parseFontFaceSources('@font-face { font-family: X; }')).toEqual([]);
	});
});

describe('collectUsedMathFontFamilies', () => {
	it('token 精确匹配，并恒加 ZERO / BRK', async () => {
		const { collectUsedMathFontFamilies } = await import(
			'../src/platform/math-jax-fonts'
		);
		const faces = [
			{ family: 'MJX-TEX-N', url: '/n' },
			{ family: 'MJX-TEX-SO', url: '/so' },
			{ family: 'MJX-TEX-S3', url: '/s3' },
			{ family: 'MJX-TEX-ZERO', url: '/zero' },
			{ family: 'MJX-BRK', url: '/brk' },
		];
		const used = collectUsedMathFontFamilies(
			new Set(['TEX-N', 'TEX-S3']),
			faces,
		);
		expect([...used].sort()).toEqual([
			'MJX-BRK',
			'MJX-TEX-N',
			'MJX-TEX-S3',
			'MJX-TEX-ZERO',
		]);
	});

	it('不做前缀误配（TEX-N 不因 TEX-S3 之类出现而放行）', async () => {
		const { collectUsedMathFontFamilies } = await import(
			'../src/platform/math-jax-fonts'
		);
		const used = collectUsedMathFontFamilies(new Set(['TEX-SO']), [
			{ family: 'MJX-TEX-N', url: '/n' },
		]);
		expect(used.size).toBe(0);
	});
});

describe('inlineMathFontFaces', () => {
	it('用到的族替换成 data URI，未用到的整块删除，其余规则原样', async () => {
		const { inlineMathFontFaces } = await import('../src/platform/math-jax-fonts');
		const out = inlineMathFontFaces(
			CSS_FIXTURE,
			new Map([
				[`${dir}mjx-tex-n.woff2`, 'AAA'],
				[`${dir}mjx-tex-so.woff2`, 'BBB'],
			]),
			new Set(['MJX-TEX-N']),
		);
		expect(out).toContain('data:font/woff2;base64,AAA');
		expect(out).not.toContain('BBB');
		expect(out).not.toContain('mjx-tex-so.woff2');
		expect(out, '非 @font-face 规则不得改动').toContain(
			'mjx-container[jax="CHTML"] { white-space: nowrap; }',
		);
	});

	it('缺 base64 的族整块删除（不留必然失败的请求）', async () => {
		const { inlineMathFontFaces } = await import('../src/platform/math-jax-fonts');
		const out = inlineMathFontFaces(
			CSS_FIXTURE,
			new Map(),
			new Set(['MJX-TEX-N', 'MJX-TEX-ZERO']),
		);
		expect(out).not.toContain('@font-face');
		expect(out).toContain('mjx-container[jax="CHTML"]');
	});
});

describe('collectClassTokens / withInlinedMathFonts', () => {
	it('class 按空白切分为 token；查询异常返回空集合', async () => {
		const { collectClassTokens } = await import('../src/platform/math-jax-fonts');
		expect(
			[...collectClassTokens(rootWithClasses(['TEX-N mjx-c7B', 'TEX-S3']))].sort(),
		).toEqual(['TEX-N', 'TEX-S3', 'mjx-c7B']);
		const broken = {
			querySelectorAll: () => {
				throw new Error('boom');
			},
		} as unknown as Element;
		expect(collectClassTokens(broken).size).toBe(0);
	});

	it('快照缺失 → null（调用方回退）；快照就绪 → 返回内联后的 CSS', async () => {
		const fonts = await import('../src/platform/math-jax-fonts');
		expect(
			fonts.withInlinedMathFonts(CSS_FIXTURE, rootWithClasses(['TEX-N']), null),
		).toBeNull();

		const snapshot = {
			faces: [{ family: 'MJX-TEX-N', url: `${dir}mjx-tex-n.woff2` }],
			base64ByUrl: new Map([[`${dir}mjx-tex-n.woff2`, 'AAA']]),
		};
		const out = fonts.withInlinedMathFonts(
			CSS_FIXTURE,
			rootWithClasses(['TEX-N']),
			snapshot,
		);
		expect(out).toContain('data:font/woff2;base64,AAA');
	});

	it('无任何命中字体 → null（不注入空壳样式）', async () => {
		const fonts = await import('../src/platform/math-jax-fonts');
		const snapshot = {
			faces: [{ family: 'MJX-TEX-N', url: `${dir}mjx-tex-n.woff2` }],
			base64ByUrl: new Map([[`${dir}mjx-tex-n.woff2`, 'AAA']]),
		};
		expect(
			fonts.withInlinedMathFonts(CSS_FIXTURE, rootWithClasses([]), snapshot),
		).toBeNull();
	});
});

describe('primeMathJaxFonts（预取与失败缓存）', () => {
	/** 逐例取新模块实例：snapshot / failedCss / priming 都是模块级状态 */
	async function freshFonts(): Promise<
		typeof import('../src/platform/math-jax-fonts')
	> {
		requestUrlMock.mockReset();
		requestUrlMock.mockResolvedValue({
			status: 404,
			arrayBuffer: new ArrayBuffer(0),
		});
		vi.resetModules();
		return await import('../src/platform/math-jax-fonts');
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('样式表里没有 @font-face：false 且不发请求；同内容第二次直接 false', async () => {
		const fonts = await freshFonts();
		expect(await fonts.primeMathJaxFonts('')).toBe(false);
		expect(await fonts.primeMathJaxFonts('')).toBe(false);
		expect(requestUrlMock).not.toHaveBeenCalled();
	});

	it('全部读取失败：false；同一份 CSS 再问不再重发请求', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new Error('no network')));
		const fonts = await freshFonts();
		expect(await fonts.primeMathJaxFonts(CSS_FIXTURE)).toBe(false);
		// 3 个 @font-face × 2 个候选（`app://` 前缀 / 裸相对路径）
		expect(requestUrlMock).toHaveBeenCalledTimes(6);
		expect(await fonts.primeMathJaxFonts(CSS_FIXTURE)).toBe(false);
		expect(requestUrlMock, '同一份样式表不得重试').toHaveBeenCalledTimes(6);
	});

	it('样式表内容变化（首次挂载）→ 重试并成功；之后同内容直接 true、不再请求', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new Error('no network')));
		const fonts = await freshFonts();
		expect(await fonts.primeMathJaxFonts(CSS_FIXTURE)).toBe(false);

		requestUrlMock.mockResolvedValue({
			status: 200,
			// 65,65,65 = 'AAA' ⇒ btoa 得 `QUFB`
			arrayBuffer: new Uint8Array([65, 65, 65]).buffer,
		});
		const mounted = `${CSS_FIXTURE}\n/* 样式表后来才挂载 */`;
		expect(await fonts.primeMathJaxFonts(mounted)).toBe(true);

		const afterPrime = requestUrlMock.mock.calls.length;
		expect(await fonts.primeMathJaxFonts(mounted)).toBe(true);
		expect(requestUrlMock.mock.calls.length).toBe(afterPrime);

		// 快照走默认参数：不显式传 snapshot 也能内联出 data URI
		const out = fonts.withInlinedMathFonts(mounted, rootWithClasses(['TEX-N']));
		expect(out).toContain('data:font/woff2;base64,QUFB');
	});
});
