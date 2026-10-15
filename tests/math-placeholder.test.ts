/**
 * 行内数学「字面占位串」形态回归（`core/math-placeholder`）。
 *
 * 该模块的存在理由就是**构建与撤回共用同一模板**：此前
 * `features/node-inline-content.buildMathElement`（构建）与
 * `platform/math-jax.attemptPlace`（产物未就绪时同步撤回）各写字面模板，
 * 值相同却无约束——断链即出现「撤回后与构建形态不一致」的静默分叉（占位既是
 * 回退态也是屏上可见文本）。
 *
 * 故本文件钉两件事：
 * ① 两种形态的字面（行内 `$…$` / 块级 `$$…$$`，与原文定界符**同形**）；
 * ② 两个消费方**都经本模块**取模板（源码级契约：重新内联字面模板即红灯）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMathPlaceholder } from '../src/core/math-placeholder';

const ROOT = path.resolve(__dirname, '..');

describe('formatMathPlaceholder（占位形态单一来源）', () => {
	it('行内形态：单 `$` 包裹（display 缺省为 false）', () => {
		expect(formatMathPlaceholder('x^2', false)).toBe('$x^2$');
	});

	it('块级形态：双 `$$` 包裹（display === true）', () => {
		expect(formatMathPlaceholder('\\int_0^1 x', true)).toBe(
			'$$\\int_0^1 x$$',
		);
	});

	it('tex 原样嵌入：不转义、不 trim、多行与竖线照旧（占位与原文同形）', () => {
		expect(formatMathPlaceholder(' a | b ', false)).toBe('$ a | b $');
		expect(formatMathPlaceholder('a\nb', true)).toBe('$$a\nb$$');
		// 定界符与 `$`/`$$` 原文一致：未闭合标记按字面的可见形态
		expect(formatMathPlaceholder('a', false).match(/^\$+/)?.[0]).toBe('$');
		expect(formatMathPlaceholder('a', true).match(/^\$+/)?.[0]).toBe('$$');
	});

	it('构建与撤回两处都经本模块（源码级：不得重新内联字面模板）', () => {
		const consumers = [
			'src/features/node-inline-content.ts',
			'src/platform/math-jax.ts',
		];
		for (const rel of consumers) {
			const source = readFileSync(path.join(ROOT, rel), 'utf8');
			expect(
				source.includes('formatMathPlaceholder'),
				`${rel} 未引用 formatMathPlaceholder：占位模板被就地重写会与撤回路径分叉`,
			).toBe(true);
		}
	});
});
