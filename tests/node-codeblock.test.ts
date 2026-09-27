/**
 * 代码块复制交互（features/node-codeblock）单元回归。
 *
 * 覆盖 `resolveCodeCopyTarget`（纯函数）的四态：命中 / 非按钮目标 / 非元素目标 /
 * 按钮在而 `<code>` 缺失（异常形态）。
 *
 * 隔离策略：Node 环境没有 DOM 类，`Element`/`HTMLElement` 用同一基类桩出
 * （`instanceof` 判定因此成立）；元素桩只实现该函数实际访问的面
 * （closest / querySelector / textContent）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	CODE_BLOCK_CLASS,
	CODE_COPY_CLASS,
} from '../src/features/node-inline-content';
import { resolveCodeCopyTarget } from '../src/features/node-codeblock';

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
});
