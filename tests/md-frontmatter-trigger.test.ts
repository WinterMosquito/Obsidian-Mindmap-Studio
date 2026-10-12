/**
 * 导图声明判据回归（domain/mindmap-property.ts）。
 *
 * 判据是「文件是不是导图」的**唯一**凭据（2026-10-12 起取代文件名后缀），
 * 因此这里锁的是它的全部边界：
 * - 读侧**不看语言**：`Type` 与 `类型` 两个键都认；键名大小写不敏感；
 * - 值归一：trim + 大小写不敏感；兼容官方属性面板产出的单元素数组；
 * - `Markdown`（或任何其它值）不是触发值，也**不是否决票**——它只意味着
 *   「没有键等于 mindmap」，故双键并存时任一命中即为导图；
 * - 写侧才看语言：zh → `类型`，en → `Type`，值恒为 `Mindmap`；且 `convergeMindMapPropertyKey`
 *   把两键收敛为**唯一的语言键**（防 `Type`/`类型` 并存——改语言后「只加新键」的根因）。
 *
 * 判据读官方 metadataCache 的 frontmatter 对象，故这里直接用普通对象当输入；
 * `position` 之类官方注入键不应干扰判定。
 */
import { describe, expect, it } from 'vitest';
import {
	buildMindMapFrontmatter,
	convergeMindMapPropertyKey,
	findMindMapPropertyKeys,
	isMindMapProperty,
	isMindMapPropertyKey,
	mindMapPropertyKey,
	MINDMAP_MARKDOWN_VALUE,
	MINDMAP_TYPE_VALUE,
	normalizePropertyValues,
} from '../src/domain/mindmap-property';

describe('isMindMapProperty（读侧判据）', () => {
	it.each([
		{ name: 'zh 键 类型: Mindmap', fm: { 类型: 'Mindmap' }, expected: true },
		{ name: 'en 键 Type: Mindmap', fm: { Type: 'Mindmap' }, expected: true },
		{ name: '小写键 type: mindmap', fm: { type: 'mindmap' }, expected: true },
		{ name: '大写值 Type: MINDMAP', fm: { Type: 'MINDMAP' }, expected: true },
		{ name: '带空白 Type: " Mindmap "', fm: { Type: '  Mindmap  ' }, expected: true },
		{ name: '单元素数组 Type: [Mindmap]', fm: { Type: ['Mindmap'] }, expected: true },
		{ name: '多值含 mindmap Type: [a, mindmap]', fm: { Type: ['a', 'mindmap'] }, expected: true },
		{ name: 'Markdown 值不触发', fm: { 类型: 'Markdown' }, expected: false },
		{ name: '其它值不触发', fm: { type: 'book' }, expected: false },
		{ name: '值为空数组', fm: { type: [] }, expected: false },
		{ name: '值为 null', fm: { type: null }, expected: false },
		{ name: '值近似但不是（mindmap-studio）', fm: { type: 'mindmap-studio' }, expected: false },
		{ name: '无关键', fm: { title: 'Mindmap' }, expected: false },
		{ name: '空 frontmatter', fm: {}, expected: false },
		{ name: 'null frontmatter', fm: null, expected: false },
		{ name: 'undefined frontmatter', fm: undefined, expected: false },
		{ name: '非对象 frontmatter', fm: '类型: Mindmap', expected: false },
	])('$name → $expected', ({ fm, expected }) => {
		expect(isMindMapProperty(fm)).toBe(expected);
	});

	it('两个键并存时：任一命中即导图（Markdown 不是否决票）', () => {
		expect(isMindMapProperty({ 类型: 'Mindmap', Type: 'Markdown' })).toBe(true);
		expect(isMindMapProperty({ 类型: 'Markdown', Type: 'mindmap' })).toBe(true);
		expect(isMindMapProperty({ 类型: 'Markdown', Type: 'markdown' })).toBe(false);
	});

	it('官方注入的 position / frontmatterPosition 不干扰判定', () => {
		expect(
			isMindMapProperty({
				type: 'mindmap',
				position: { start: { line: 0, col: 0, offset: 0 } },
				frontmatterPosition: { start: { line: 0 }, end: { line: 2 } },
			}),
		).toBe(true);
		expect(isMindMapProperty({ position: { start: { line: 0 } } })).toBe(false);
	});

	it('findMindMapPropertyKeys 返回**原文键名**（改写据此保留用户写法）', () => {
		expect(findMindMapPropertyKeys({ 类型: 'Mindmap' })).toEqual(['类型']);
		expect(findMindMapPropertyKeys({ TyPe: 'mindmap' })).toEqual(['TyPe']);
		expect(findMindMapPropertyKeys({ 类型: 'Mindmap', Type: 'Mindmap' })).toEqual([
			'类型',
			'Type',
		]);
		// 非命中的键不返回（Markdown 值 / 无关键）
		expect(findMindMapPropertyKeys({ 类型: 'Markdown', title: 'x' })).toEqual([]);
	});

	it('normalizePropertyValues：数组/单值/空值归一为可比字符串', () => {
		expect(normalizePropertyValues('  MindMap ')).toEqual(['mindmap']);
		expect(normalizePropertyValues(['A', ' B '])).toEqual(['a', 'b']);
		expect(normalizePropertyValues(42)).toEqual(['42']);
		expect(normalizePropertyValues(null)).toEqual([]);
		expect(normalizePropertyValues(undefined)).toEqual([]);
	});
});

describe('写入侧（键名按语言选，值恒为 Mindmap）', () => {
	it('键名：zh → 类型，其余 → Type', () => {
		expect(mindMapPropertyKey('zh')).toBe('类型');
		expect(mindMapPropertyKey('en')).toBe('Type');
	});

	it('属性块含末尾换行，且能被 isMindMapProperty 反解（写读自洽）', () => {
		for (const lang of ['zh', 'en'] as const) {
			const block = buildMindMapFrontmatter(lang);
			expect(block.endsWith('\n')).toBe(true);
			const lines = block.trimEnd().split('\n');
			expect(lines[0]).toBe('---');
			expect(lines[2]).toBe('---');
			const key = lines[1]?.split(':')[0];
			expect(key).toBe(mindMapPropertyKey(lang));
			expect(block).toContain(`${MINDMAP_TYPE_VALUE}`);
		}
	});

	it('常量口径：触发值 Mindmap，降级值 Markdown（判定恰相反）', () => {
		expect(MINDMAP_TYPE_VALUE).toBe('Mindmap');
		expect(MINDMAP_MARKDOWN_VALUE).toBe('Markdown');
		expect(isMindMapProperty({ 类型: MINDMAP_TYPE_VALUE })).toBe(true);
		expect(isMindMapProperty({ 类型: MINDMAP_MARKDOWN_VALUE })).toBe(false);
	});
});

describe('isMindMapPropertyKey（键名谓词，不看值）', () => {
	it.each([
		['类型', true],
		['Type', true],
		['type', true],
		['tYpE', true],
		[' 类型 ', true],
		['标题', false],
		['', false],
		['typed', false],
	])('%j → %s', (key, expected) => {
		expect(isMindMapPropertyKey(key)).toBe(expected);
	});
});

describe('convergeMindMapPropertyKey（键名收敛为语言唯一键）', () => {
	it('zh 目标键：en 键被重命名为 类型，值原样保留', () => {
		const fm: Record<string, unknown> = { Type: 'Mindmap', title: 'x' };
		expect(convergeMindMapPropertyKey(fm, 'zh')).toBe(true);
		expect(fm).toEqual({ 类型: 'Mindmap', title: 'x' });
	});

	it('en 目标键：类型 键被重命名为 Type，值原样保留（含 Markdown 值）', () => {
		const fm: Record<string, unknown> = { 类型: 'Markdown' };
		expect(convergeMindMapPropertyKey(fm, 'en')).toBe(true);
		expect(fm).toEqual({ Type: 'Markdown' });
	});

	it('显式 value：写入目标键并删除其它同类键（升级/降级用）', () => {
		const fm: Record<string, unknown> = { 类型: 'Markdown', other: 1 };
		expect(convergeMindMapPropertyKey(fm, 'en', 'Mindmap')).toBe(true);
		expect(fm).toEqual({ Type: 'Mindmap', other: 1 });
	});

	it('两键并存 → 收敛为唯一目标键（取第一个键的值）', () => {
		const fm: Record<string, unknown> = { 类型: 'Mindmap', Type: 'Markdown' };
		expect(convergeMindMapPropertyKey(fm, 'en')).toBe(true);
		expect(fm).toEqual({ Type: 'Mindmap' });
	});

	it('已是唯一目标键且值正确 → 无改动（幂等，免写盘）', () => {
		const fm: Record<string, unknown> = { 类型: 'Mindmap' };
		expect(convergeMindMapPropertyKey(fm, 'zh')).toBe(false);
		expect(fm).toEqual({ 类型: 'Mindmap' });
	});

	it('无同类键且未给 value → 无改动（不凭空造键）', () => {
		const fm: Record<string, unknown> = { title: 'x' };
		expect(convergeMindMapPropertyKey(fm, 'zh')).toBe(false);
		expect(fm).toEqual({ title: 'x' });
	});

	it('无同类键但给了 value → 新建目标键', () => {
		const fm: Record<string, unknown> = { title: 'x' };
		expect(convergeMindMapPropertyKey(fm, 'en', 'Mindmap')).toBe(true);
		expect(fm).toEqual({ title: 'x', Type: 'Mindmap' });
	});
});
