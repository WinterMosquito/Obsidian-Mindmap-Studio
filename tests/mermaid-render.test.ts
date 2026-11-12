/**
 * `platform/mermaid` 直测：**内嵌 Pele** 的同步渲染 + 内容寻址缓存 + 回退口径。
 *
 * 为什么能在 node 环境直测：Pele 是纯字符串渲染器，不依赖 DOM（无 `document`
 * 时按缺省字体度量出图）。⚠ 由此**不能锁字面产物**——应用内（有 CSS 字体）与
 * 无 DOM 环境的同一张图 SVG 字节不同（实测 1526 vs 1478），故这里只断言结构
 * 与行为；字面金样由 `verify:visual` 负责。
 *
 * 覆盖的回退面是本模块唯一的失败语义：语法错误 / 未注册类型 / 超限 → null，
 * 调用方（`features/node-inline-html`）据此回落普通代码块，源码不丢。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	MERMAID_SOURCE_MAX_CHARS,
	clearMermaidCache,
	mermaidCacheSize,
	renderMermaidSvg,
} from '../src/platform/mermaid';

/** 最小可渲染源码（Pele 的 flowchart 语法） */
const FLOW = 'flowchart LR\n  A[Pele] --> B[SVG]';

/** 另一张图：用于验证「不同源码是不同缓存条目」 */
const SEQUENCE = 'sequenceDiagram\n  A->>B: hi';

describe('platform/mermaid（内嵌 Pele 同步渲染）', () => {
	beforeEach(() => {
		clearMermaidCache();
		// 失败留痕走 console.warn（createWarnOnce）：单测里静音，避免污染输出
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('合法源码：同步返回以 `<svg` 开头的 Pele 产物', () => {
		const svg = renderMermaidSvg(FLOW);
		expect(svg).not.toBeNull();
		// 形态守卫的前提：Pele 的根元素带 `pele` 与图类型类
		expect(svg?.startsWith('<svg')).toBe(true);
		expect(svg).toContain('pele-flowchart');
		// 同步渲染 ⇒ 无 foreignObject（与阅读视图同构，导出时不会被裁）
		expect(svg).not.toContain('foreignObject');
	});

	it('内容寻址缓存：同一源码只渲染一次、返回同一份字符串', () => {
		const first = renderMermaidSvg(FLOW);
		expect(mermaidCacheSize()).toBe(1);

		const second = renderMermaidSvg(FLOW);
		expect(second).toBe(first);
		expect(mermaidCacheSize()).toBe(1);
	});

	it('不同源码各自成条目（缓存键 = 源码，不含主题：颜色住在 CSS 变量里）', () => {
		renderMermaidSvg(FLOW);
		renderMermaidSvg(SEQUENCE);
		expect(mermaidCacheSize()).toBe(2);
	});

	it('语法错误 / 未注册类型：返回 null（回落代码块）而不是抛穿渲染链', () => {
		expect(renderMermaidSvg('这不是一张图')).toBeNull();
		expect(mermaidCacheSize()).toBe(0);
	});

	it('源码超过长度上限：返回 null 且**不进缓存**', () => {
		const huge = `flowchart LR\n  A[${'x'.repeat(MERMAID_SOURCE_MAX_CHARS)}]-->B`;
		expect(huge.length).toBeGreaterThan(MERMAID_SOURCE_MAX_CHARS);
		expect(renderMermaidSvg(huge)).toBeNull();
		expect(mermaidCacheSize()).toBe(0);
	});

	it('clearMermaidCache：清空后重新渲染得到新产物（可回收，无泄漏）', () => {
		const first = renderMermaidSvg(FLOW);
		clearMermaidCache();
		expect(mermaidCacheSize()).toBe(0);

		const second = renderMermaidSvg(FLOW);
		expect(second).not.toBeNull();
		// 字符串按值比较：重新渲染的产物与原产物内容一致（幂等）
		expect(second).toBe(first);
	});
});
