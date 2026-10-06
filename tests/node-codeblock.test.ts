/**
 * 代码块复制交互（features/node-codeblock）单元回归。
 *
 * 覆盖 `resolveCodeCopyTarget`（纯函数）的四态：命中 / 非按钮目标 / 非元素目标 /
 * 按钮在而 `<code>` 缺失（异常形态）。
 *
 * 隔离策略：Node 环境没有 DOM 类，`Element`/`HTMLElement` 用同一基类桩出
 * （`instanceof` 判定因此成立）；元素桩只实现该函数实际访问的面
 * （closest / querySelector / textContent）。
 *
 * 另含一条**跨文件契约**用例：屏上「悬停才显形」的规则住在 `styles.css`
 * （构建器零监听、零 hover 属性），删掉它会静默退回「按钮常显并压住首行」——
 * 那是肉眼可见的退化，却没有任何单测会红。故在此读文件把该规则钉住。
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CODE_BLOCK_CLASS,
	CODE_COPY_CLASS,
} from '../src/features/node-inline-content';
import {
	hideCopyButtonsInExportSvg,
	resolveCodeCopyTarget,
} from '../src/features/node-codeblock';

/** Element / HTMLElement 的公共桩类（stubGlobal 后 instanceof 判定成立） */
class StubElement {}

afterEach(() => {
	vi.unstubAllGlobals();
});

/** 基于桩原型建元素：instanceof StubElement 为真，仅带所需方法 */
function stubEl(impl: Record<string, unknown>): StubElement {
	const el = Object.create(StubElement.prototype) as StubElement;
	return Object.assign(el, impl);
}

/** 组装「按钮 → 容器 → pre > code」链（选择器与生产实现同源） */
function buildChain(
	codeText: string | null,
	options: { dataCode?: string } = {},
): {
	target: StubElement;
	button: StubElement;
} {
	const code =
		codeText === null ? null : stubEl({ textContent: codeText });
	const block = stubEl({
		querySelector: (selector: string) => (selector === 'pre code' ? code : null),
	});
	const attrs = new Map<string, string>();
	if (options.dataCode !== undefined) {
		attrs.set('data-code', options.dataCode);
	}
	const button = stubEl({
		closest: (selector: string) =>
			selector === `.${CODE_BLOCK_CLASS}` ? block : null,
		getAttribute: (name: string) => attrs.get(name) ?? null,
	});
	const target = stubEl({
		closest: (selector: string) =>
			selector === `.${CODE_COPY_CLASS}` ? button : null,
	});
	return { target, button };
}

describe('resolveCodeCopyTarget（点击目标 → 复制按钮 + 文本）', () => {
	it('命中复制按钮：data-code 优先（构建期定死的复制源，不依赖 DOM 链）', () => {
		vi.stubGlobal('Element', StubElement);
		vi.stubGlobal('HTMLElement', StubElement);
		const { target, button } = buildChain('DOM 里的旧文本', {
			dataCode: 'const a = 1;\nconsole.log("hello");',
		});
		const resolved = resolveCodeCopyTarget(
			target as unknown as EventTarget,
		);
		expect(resolved).not.toBeNull();
		expect(resolved?.button).toBe(button);
		expect(resolved?.text).toBe('const a = 1;\nconsole.log("hello");');
	});

	it('data-code 缺失：回落 pre > code 的 textContent（旧构建/异常形态兜底）', () => {
		vi.stubGlobal('Element', StubElement);
		vi.stubGlobal('HTMLElement', StubElement);
		const { target } = buildChain('echo hi');
		const resolved = resolveCodeCopyTarget(
			target as unknown as EventTarget,
		);
		expect(resolved?.text).toBe('echo hi');
	});

	it('非按钮目标（closest 未命中）：返回 null（不拦截点击）', () => {
		vi.stubGlobal('Element', StubElement);
		vi.stubGlobal('HTMLElement', StubElement);
		const other = stubEl({ closest: () => null });
		expect(resolveCodeCopyTarget(other as unknown as EventTarget)).toBeNull();
	});

	it('非元素目标（null / 纯对象）：返回 null（防御性）', () => {
		vi.stubGlobal('Element', StubElement);
		vi.stubGlobal('HTMLElement', StubElement);
		expect(resolveCodeCopyTarget(null)).toBeNull();
		expect(resolveCodeCopyTarget({} as unknown as EventTarget)).toBeNull();
	});

	it('按钮命中而 code 缺失（异常形态）：返回空串文本（仍给 ✓ 反馈，不静默）', () => {
		vi.stubGlobal('Element', StubElement);
		vi.stubGlobal('HTMLElement', StubElement);
		const { target } = buildChain(null);
		const resolved = resolveCodeCopyTarget(
			target as unknown as EventTarget,
		);
		expect(resolved).not.toBeNull();
		expect(resolved?.text).toBe('');
	});

	describe('hideCopyButtonsInExportSvg（导出图隐身，第五轮）', () => {
		it('克隆 SVG 内的复制按钮内联 opacity 置 0，并原样返回同一对象', () => {
			// 桩 style 为普通对象：实现用 Object.assign 整体写入（合规写法，
			// 见 HIDDEN_BUTTON_STYLE 注释），故直接断言属性值
			const button = { style: {} as Record<string, string> };
			const svg = {
				node: {
					querySelectorAll: (selector: string) =>
						selector === `.${CODE_COPY_CLASS}` ? [button] : [],
				},
			};
			expect(hideCopyButtonsInExportSvg(svg)).toBe(svg);
			expect(button.style).toEqual({ opacity: '0' });
		});

		it('形态不符（无 node / 无 querySelectorAll）：安全 no-op 原样返回', () => {
			const bare = {};
			expect(hideCopyButtonsInExportSvg(bare)).toBe(bare);
			const half = { node: {} };
			expect(hideCopyButtonsInExportSvg(half)).toBe(half);
		});

		// 导出的 SVG **不含 styles.css** ⇒ 悬停规则不生效 ⇒ 按钮在导出图里是
		// 「常显」态，本函数因此仍是必需的第二道保险（K114b 之后依旧）。
		it('K114b：导出图隐身仍必需（悬停规则在 styles.css，导出图不含它）', () => {
			const button = { style: {} as Record<string, string> };
			const svg = {
				node: {
					querySelectorAll: (selector: string) =>
						selector === `.${CODE_COPY_CLASS}` ? [button] : [],
				},
			};
			hideCopyButtonsInExportSvg(svg);
			expect(button.style).toEqual({ opacity: '0' });
		});
	});

	describe('styles.css 悬停显形契约（K114b，跨文件）', () => {
		/** 剥掉 CSS 注释：本文件注释里引用了原生选择器作对照，不过滤会误命中 */
		const css = readFileSync(
			new URL('../styles.css', import.meta.url),
			'utf8',
		).replace(/\/\*[\s\S]*?\*\//g, '');

		it('悬停规则存在且用 display:none（对齐原生 app.css:11854）', () => {
			expect(css).toContain('@media (hover: hover)');
			expect(css).toMatch(
				/\.tmm-codeblock:not\(:hover\)\s*>\s*\.tmm-code-copy\s*\{\s*display:\s*none;?\s*\}/,
			);
		});

		it('hover 宿主是 codeblock 而非 pre（本插件按钮是 pre 的兄弟，非 pre 子元素）', () => {
			// 原生是 `pre:not(:hover) > button`；若这里误抄成 pre，选择器永不命中
			expect(css).toContain('.tmm-codeblock:not(:hover)');
			expect(css).not.toMatch(/pre:not\(:hover\)/);
		});

		it('不用 opacity 做显隐（opacity 会拦截命中测试，需额外 pointer-events）', () => {
			expect(css).not.toMatch(/\.tmm-code-copy[^{]*\{[^}]*opacity:\s*0/);
		});
	});
});
