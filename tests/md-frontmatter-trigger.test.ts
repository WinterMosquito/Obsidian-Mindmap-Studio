/**
 * 导图声明判据回归（domain/mindmap-property.ts）。
 *
 * 判据是「文件是不是导图、用哪种布局」的**唯一**凭据，自 2026-10-29 起为
 * **布局枚举**：
 * - 只认键 `Mindmap`（键名大小写不敏感），值经 trim → 小写 → 去 `-` / `_` /
 *   空白后查反向表；`Mindmap` / `mindMap` / `mind map` / `MIND-MAP` 是同一件事；
 * - `Markdown` 是**终止值**（不是导图），未知值 fail-closed（静默，不是导图）；
 * - 旧键 `Type` / `类型` **完全不认**（断代）——负向断言在此锁死，防误加回兼容；
 * - 写侧恒写标准键 `Mindmap` + PascalCase 标准值，与界面语言无关；
 *   `setMindMapProperty` 顺带收敛同名大小写变体，但**不碰**旧键。
 *
 * 判据读官方 metadataCache 的 frontmatter 对象，故这里直接用普通对象当输入；
 * `position` 之类官方注入键不应干扰判定。
 */
import { describe, expect, it } from 'vitest';
import {
	buildMindMapFrontmatter,
	isMindMapProperty,
	isMindMapPropertyKey,
	layoutIdOfPropertyValue,
	layoutPropertyValue,
	MINDMAP_DEFAULT_VALUE,
	MINDMAP_LAYOUT_IDS,
	MINDMAP_LAYOUT_VALUES,
	MINDMAP_MARKDOWN_VALUE,
	MINDMAP_PROPERTY_KEY,
	readMindMapDeclaration,
	setMindMapProperty,
} from '../src/domain/mindmap-property';
import { LAYOUT_OPTIONS } from '../src/core/constants';

describe('readMindMapDeclaration（读侧判据：值 = 布局枚举）', () => {
	it.each([
		{ value: 'LogicalStructure', layoutId: 'logicalStructure' },
		{ value: 'Mindmap', layoutId: 'mindMap' },
		{ value: 'OrganizationStructure', layoutId: 'organizationStructure' },
		{ value: 'CatalogOrganization', layoutId: 'catalogOrganization' },
		{ value: 'Timeline', layoutId: 'timeline' },
		{ value: 'Fishbone', layoutId: 'fishbone' },
	])('$value → $layoutId', ({ value, layoutId }) => {
		expect(readMindMapDeclaration({ Mindmap: value })).toEqual({
			kind: 'layout',
			layoutId,
			value,
		});
	});

	it('`Markdown` 是终止值：kind 为 markdown（不是 layout）', () => {
		expect(readMindMapDeclaration({ Mindmap: 'Markdown' })).toEqual({
			kind: 'markdown',
		});
		expect(isMindMapProperty({ Mindmap: 'Markdown' })).toBe(false);
	});

	it.each([
		{ name: '全小写', value: 'mindmap', layoutId: 'mindMap' },
		{ name: '驼峰（引擎 id）', value: 'mindMap', layoutId: 'mindMap' },
		{ name: '带空格', value: 'mind map', layoutId: 'mindMap' },
		{ name: '连字符 + 大写', value: 'MIND-MAP', layoutId: 'mindMap' },
		{ name: '下划线 + 空格', value: 'Logical Structure', layoutId: 'logicalStructure' },
		{ name: '连字符', value: 'logical-structure', layoutId: 'logicalStructure' },
		{ name: '下划线', value: 'catalog_organization', layoutId: 'catalogOrganization' },
		{ name: '前后空白', value: '  Timeline  ', layoutId: 'timeline' },
		{ name: '终止值宽容', value: 'mark down', layoutId: null },
	])('$name（$value）→ $layoutId', ({ value, layoutId }) => {
		const declaration = readMindMapDeclaration({ Mindmap: value });
		if (layoutId === null) {
			expect(declaration).toEqual({ kind: 'markdown' });
			return;
		}
		expect(declaration).toMatchObject({ kind: 'layout', layoutId });
	});

	it('数组取第一项（官方属性面板的多值形态）', () => {
		expect(
			readMindMapDeclaration({ Mindmap: ['Timeline', 'Fishbone'] }),
		).toMatchObject({ kind: 'layout', layoutId: 'timeline' });
		// 首项不是布局 ⇒ 不是导图（**不再**「任一命中即命中」）
		expect(readMindMapDeclaration({ Mindmap: ['笔记', 'Timeline'] })).toBeNull();
		expect(readMindMapDeclaration({ Mindmap: ['Markdown', 'Timeline'] })).toEqual({
			kind: 'markdown',
		});
	});

	it.each([
		{ name: '空数组', fm: { Mindmap: [] } },
		{ name: '空串', fm: { Mindmap: '' } },
		{ name: '纯空白', fm: { Mindmap: '   ' } },
		{ name: 'null', fm: { Mindmap: null } },
		{ name: '无键', fm: { title: 'Mindmap' } },
		{ name: '空对象', fm: {} },
		{ name: 'null frontmatter', fm: null },
		{ name: 'undefined frontmatter', fm: undefined },
		{ name: '非对象 frontmatter', fm: 'Mindmap: Mindmap' },
	])('$name → null', ({ fm }) => {
		expect(readMindMapDeclaration(fm)).toBeNull();
		expect(isMindMapProperty(fm)).toBe(false);
	});

	it.each(['书本', 'book', 'mindmap-studio', 'logicalstructure2', '12'])(
		'未知值 %j fail-closed（不是导图）',
		(value) => {
			expect(readMindMapDeclaration({ Mindmap: value })).toBeNull();
			expect(isMindMapProperty({ Mindmap: value })).toBe(false);
		},
	);

	it('断代：旧键 `类型` / `Type` 即便值为布局也**不触发**', () => {
		expect(readMindMapDeclaration({ 类型: 'Mindmap' })).toBeNull();
		expect(readMindMapDeclaration({ Type: 'Timeline' })).toBeNull();
		expect(isMindMapProperty({ type: 'mindmap' })).toBe(false);
	});

	it('同名变体并存：按对象键顺序取**第一个命中的键**', () => {
		expect(
			readMindMapDeclaration({ Mindmap: 'Timeline', mindmap: 'Fishbone' }),
		).toMatchObject({ layoutId: 'timeline' });
		expect(
			readMindMapDeclaration({ mindmap: 'Fishbone', Mindmap: 'Timeline' }),
		).toMatchObject({ layoutId: 'fishbone' });
		// 首个命中的键是终止值 ⇒ 终止（后面的同名变体不翻盘）
		expect(
			readMindMapDeclaration({ mindmap: 'Markdown', Mindmap: 'Timeline' }),
		).toEqual({ kind: 'markdown' });
	});

	it('官方注入的 position / frontmatterPosition 不干扰判定', () => {
		expect(
			readMindMapDeclaration({
				Mindmap: 'Mindmap',
				position: { start: { line: 0, col: 0, offset: 0 } },
				frontmatterPosition: { start: { line: 0 }, end: { line: 2 } },
			}),
		).toMatchObject({ layoutId: 'mindMap' });
		expect(readMindMapDeclaration({ position: { start: { line: 0 } } })).toBeNull();
	});
});

describe('layoutIdOfPropertyValue / layoutPropertyValue（双向表）', () => {
	it('布局 id 与标准值互为逆映射（六对全覆盖）', () => {
		for (const layoutId of MINDMAP_LAYOUT_IDS) {
			const value = MINDMAP_LAYOUT_VALUES[layoutId];
			expect(layoutIdOfPropertyValue(value)).toBe(layoutId);
			expect(layoutPropertyValue(layoutId)).toBe(value);
		}
	});

	it('`Markdown` / 未知值 / 无值 → null（嵌入指令与视图共用这一份判定）', () => {
		expect(layoutIdOfPropertyValue('Markdown')).toBeNull();
		expect(layoutIdOfPropertyValue('%%备注%%')).toBeNull();
		expect(layoutIdOfPropertyValue(null)).toBeNull();
		expect(layoutIdOfPropertyValue([])).toBeNull();
	});

	it('layoutPropertyValue 对未知 id 回退出厂默认值，绝不写脏值', () => {
		expect(layoutPropertyValue('bogus')).toBe(MINDMAP_DEFAULT_VALUE);
		// 确定性：两次调用同一个未知 id 得到同一个值
		expect(layoutPropertyValue('')).toBe(MINDMAP_DEFAULT_VALUE);
	});

	it('LAYOUT_OPTIONS 与 domain 的布局 id 集合一致（漏登记/多登记都报红）', () => {
		expect(LAYOUT_OPTIONS.map((option) => option.value).sort()).toEqual(
			[...MINDMAP_LAYOUT_IDS].sort(),
		);
	});
});

describe('isMindMapPropertyKey（键名谓词，不看值）', () => {
	it.each([
		['Mindmap', true],
		['mindmap', true],
		['MINDMAP', true],
		[' MiNdMaP ', true],
		['类型', false],
		['Type', false],
		['标题', false],
		['', false],
		['mindmaps', false],
	])('%j → %s', (key, expected) => {
		expect(isMindMapPropertyKey(key)).toBe(expected);
	});
});

describe('setMindMapProperty（写入侧：恒写标准键 + PascalCase 标准值）', () => {
	it('新建：无同类键 → 写入标准值，其它属性不动', () => {
		const fm: Record<string, unknown> = { title: 'x' };
		expect(setMindMapProperty(fm, 'LogicalStructure')).toBe(true);
		expect(fm).toEqual({ title: 'x', Mindmap: 'LogicalStructure' });
	});

	it('幂等：已是标准键且值相同 → 无改动（免写盘）', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Timeline' };
		expect(setMindMapProperty(fm, 'Timeline')).toBe(false);
		expect(fm).toEqual({ Mindmap: 'Timeline' });
	});

	it('无同类键且未给 value → 无改动（不凭空造键）', () => {
		const fm: Record<string, unknown> = { title: 'x' };
		expect(setMindMapProperty(fm)).toBe(false);
		expect(fm).toEqual({ title: 'x' });
	});

	it('变体收敛：小写变体被改名，值原样保留（未给 value）', () => {
		const fm: Record<string, unknown> = { mindmap: 'Markdown', title: 'x' };
		expect(setMindMapProperty(fm)).toBe(true);
		expect(fm).toEqual({ Mindmap: 'Markdown', title: 'x' });
	});

	it('变体与标准键并存 → 只留标准键（显式 value 覆盖）', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Markdown', mindmap: 'Timeline' };
		expect(setMindMapProperty(fm, 'Fishbone')).toBe(true);
		expect(fm).toEqual({ Mindmap: 'Fishbone' });
	});

	it('多个变体并存且未给 value → 收敛为唯一标准键（取首个键的值）', () => {
		const fm: Record<string, unknown> = { mindmap: 'Timeline', MINDMAP: 'Fishbone' };
		expect(setMindMapProperty(fm)).toBe(true);
		expect(fm).toEqual({ Mindmap: 'Timeline' });
	});

	it('显式覆盖：换布局（Mindmap → Timeline）', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Mindmap', other: 1 };
		expect(setMindMapProperty(fm, 'Timeline')).toBe(true);
		expect(fm).toEqual({ Mindmap: 'Timeline', other: 1 });
	});

	it('降级：写终止值 Markdown', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Timeline' };
		expect(setMindMapProperty(fm, MINDMAP_MARKDOWN_VALUE)).toBe(true);
		expect(fm).toEqual({ Mindmap: 'Markdown' });
	});

	it('断代：旧键 `类型` / `Type` 原样放过（不写、不改、不删）', () => {
		const fm: Record<string, unknown> = { 类型: 'Mindmap', Type: 'Markdown' };
		expect(setMindMapProperty(fm, 'Timeline')).toBe(true);
		expect(fm).toEqual({
			类型: 'Mindmap',
			Type: 'Markdown',
			Mindmap: 'Timeline',
		});
	});

	it('只有旧键且未给 value → 完全不动（旧键不参与收敛）', () => {
		const fm: Record<string, unknown> = { 类型: 'Mindmap' };
		expect(setMindMapProperty(fm)).toBe(false);
		expect(fm).toEqual({ 类型: 'Mindmap' });
	});
});

describe('buildMindMapFrontmatter（参数化）', () => {
	it('缺省：属性块逐字为 `---\\nMindmap: Mindmap\\n---\\n`', () => {
		expect(buildMindMapFrontmatter()).toBe('---\nMindmap: Mindmap\n---\n');
	});

	it('给种子值：逐字写入该标准值（含末尾换行，与语言无关）', () => {
		expect(buildMindMapFrontmatter('LogicalStructure')).toBe(
			'---\nMindmap: LogicalStructure\n---\n',
		);
		expect(buildMindMapFrontmatter('Fishbone')).toBe(
			'---\nMindmap: Fishbone\n---\n',
		);
	});

	it('属性块能被 readMindMapDeclaration 反解（写读自洽）', () => {
		for (const layoutId of MINDMAP_LAYOUT_IDS) {
			const block = buildMindMapFrontmatter(layoutPropertyValue(layoutId));
			const valueLine = block.split('\n')[1] ?? '';
			expect(valueLine.startsWith(`${MINDMAP_PROPERTY_KEY}: `)).toBe(true);
			const value = valueLine.slice(MINDMAP_PROPERTY_KEY.length + 2);
			expect(readMindMapDeclaration({ Mindmap: value })).toMatchObject({
				kind: 'layout',
				layoutId,
			});
		}
	});

	it('常量口径：标准键 Mindmap，默认值 = 思维导图标准值，终止值 Markdown', () => {
		expect(MINDMAP_PROPERTY_KEY).toBe('Mindmap');
		expect(MINDMAP_DEFAULT_VALUE).toBe('Mindmap');
		expect(MINDMAP_LAYOUT_VALUES.mindMap).toBe('Mindmap');
		expect(MINDMAP_MARKDOWN_VALUE).toBe('Markdown');
	});
});
