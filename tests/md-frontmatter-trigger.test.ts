/**
 * 导图声明判据回归（domain/mindmap-property.ts）。
 *
 * 2026-11-07 契约：
 * - **启用信号** `Mindmap`：值严格为 `Mindmap`（容忍大小写/分隔符）才启用；
 *   其它任何值（含默认回写的 `Markdown`）都不启用——不是「终止值」这种特殊语义。
 * - **布局** `Mindmap Layout`：六种 kebab 短 id；缺失/非法由调用方回退默认布局。
 * - 旧键 `Type` / `类型` 完全不认。
 *
 * 判据读官方 metadataCache 的 frontmatter 对象，故这里直接用普通对象当输入；
 * `position` 之类官方注入键不应干扰判定。
 */
import { describe, expect, it } from 'vitest';
import {
	buildMindMapFrontmatter,
	isMindMapDisabled,
	isMindMapEnabled,
	isMindMapLayoutKey,
	isMindMapPropertyKey,
	layoutIdOfPropertyValue,
	layoutPropertyValue,
	legacyLayoutIdOfPropertyValue,
	MINDMAP_DEFAULT_LAYOUT_VALUE,
	MINDMAP_DISABLED_VALUE,
	MINDMAP_ENABLED_VALUE,
	MINDMAP_LAYOUT_IDS,
	MINDMAP_LAYOUT_PROPERTY_KEY,
	MINDMAP_LAYOUT_VALUES,
	MINDMAP_PROPERTY_KEY,
	normalizeLayoutId,
	readLegacyLayout,
	readLegacyMindMapLayout,
	readMindMapLayout,
	setMindMapDisabled,
	setMindMapEnabled,
	setMindMapLayout,
} from '../src/domain/mindmap-property';
import { LAYOUT_OPTIONS } from '../src/core/constants';

describe('isMindMapEnabled（唯一启用信号）', () => {
	it.each([
		['Mindmap', true],
		['mindmap', true],
		['MINDMAP', true],
		['mind map', true],
		['MIND-MAP', true],
		[' MiNdMaP ', true],
		['Markdown', false],
		['Timeline', false],
		['logical', false],
		['书本', false],
		['', false],
	])('%j → %s', (value, expected) => {
		expect(isMindMapEnabled({ Mindmap: value })).toBe(expected);
	});

	it('数组取首项（官方属性面板的多值形态）', () => {
		expect(isMindMapEnabled({ Mindmap: ['Mindmap', 'Markdown'] })).toBe(true);
		// 首项不是启用值 ⇒ 不启用（不再「任一命中即命中」）
		expect(isMindMapEnabled({ Mindmap: ['笔记', 'Mindmap'] })).toBe(false);
		expect(isMindMapEnabled({ Mindmap: ['Markdown', 'Mindmap'] })).toBe(false);
	});

	it.each([
		{ name: '空数组', fm: { Mindmap: [] } },
		{ name: '空串', fm: { Mindmap: '' } },
		{ name: '纯空白', fm: { Mindmap: '   ' } },
		{ name: 'null', fm: { Mindmap: null } },
		{ name: '无键', fm: { title: 'Mindmap' } },
		{ name: '旧键 类型', fm: { 类型: 'Mindmap' } },
		{ name: '旧键 Type', fm: { Type: 'Mindmap' } },
		{ name: '空对象', fm: {} },
		{ name: 'null frontmatter', fm: null },
		{ name: 'undefined frontmatter', fm: undefined },
		{ name: '非对象 frontmatter', fm: 'Mindmap: Mindmap' },
	])('$name → false', ({ fm }) => {
		expect(isMindMapEnabled(fm)).toBe(false);
	});

	it('同名变体并存：按对象键顺序取第一个命中的键', () => {
		expect(
			isMindMapEnabled({ Mindmap: 'Markdown', mindmap: 'Mindmap' }),
		).toBe(false);
		expect(
			isMindMapEnabled({ mindmap: 'Mindmap', Mindmap: 'Markdown' }),
		).toBe(true);
	});

	it('官方注入的 position / frontmatterPosition 不干扰判定', () => {
		expect(
			isMindMapEnabled({
				Mindmap: 'Mindmap',
				position: { start: { line: 0, col: 0, offset: 0 } },
				frontmatterPosition: { start: { line: 0 }, end: { line: 2 } },
			}),
		).toBe(true);
		expect(isMindMapEnabled({ position: { start: { line: 0 } } })).toBe(false);
	});
});

describe('isMindMapDisabled（默认回写值，仅用于幂等短路）', () => {
	it.each([
		['Markdown', true],
		['markdown', true],
		['mark down', true],
		['Mindmap', false],
		['Timeline', false],
		['', false],
	])('%j → %s', (value, expected) => {
		expect(isMindMapDisabled({ Mindmap: value })).toBe(expected);
	});
	it('无键 / 非对象 → false', () => {
		expect(isMindMapDisabled({})).toBe(false);
		expect(isMindMapDisabled(null)).toBe(false);
	});
});

describe('readMindMapLayout（布局键 → 引擎 layout id）', () => {
	it.each([
		['logical', 'logicalStructure'],
		['mindmap', 'mindMap'],
		['organization', 'organizationStructure'],
		['catalog', 'catalogOrganization'],
		['timeline', 'timeline'],
		['fishbone', 'fishbone'],
	])('%j → %j', (value, layoutId) => {
		expect(readMindMapLayout({ 'Mindmap Layout': value })).toBe(layoutId);
	});

	it('值宽容大小写/分隔符/空白（写侧仍恒写 kebab）', () => {
		expect(readMindMapLayout({ 'Mindmap Layout': 'Logical' })).toBe(
			'logicalStructure',
		);
		expect(readMindMapLayout({ 'Mindmap Layout': '  TIMELINE  ' })).toBe(
			'timeline',
		);
	});

	it('键名宽容大小写/空格/连字符（属性面板内部会小写化）', () => {
		expect(readMindMapLayout({ 'mindmap layout': 'timeline' })).toBe('timeline');
		expect(readMindMapLayout({ 'Mindmap-Layout': 'fishbone' })).toBe('fishbone');
		expect(readMindMapLayout({ MINDMAP_LAYOUT: 'catalog' })).toBe(
			'catalogOrganization',
		);
	});

	it('数组取首项', () => {
		expect(
			readMindMapLayout({ 'Mindmap Layout': ['timeline', 'fishbone'] }),
		).toBe('timeline');
		expect(
			readMindMapLayout({ 'Mindmap Layout': ['笔记', 'timeline'] }),
		).toBeNull();
	});

	it.each([
		{ name: '无键', fm: {} },
		{ name: '空串', fm: { 'Mindmap Layout': '' } },
		{ name: '空数组', fm: { 'Mindmap Layout': [] } },
		{ name: '未知值', fm: { 'Mindmap Layout': 'logical-structure' } },
		{ name: 'null frontmatter', fm: null },
	])('$name → null', ({ fm }) => {
		expect(readMindMapLayout(fm)).toBeNull();
	});
});

describe('layoutIdOfPropertyValue / normalizeLayoutId / layoutPropertyValue', () => {
	it('布局 id 与属性值互为逆映射（六对全覆盖）', () => {
		for (const layoutId of MINDMAP_LAYOUT_IDS) {
			const value = MINDMAP_LAYOUT_VALUES[layoutId];
			expect(layoutIdOfPropertyValue(value)).toBe(layoutId);
			expect(layoutPropertyValue(layoutId)).toBe(value);
		}
	});

	it('属性读侧只认 kebab 值：多词引擎 id 不是属性值', () => {
		expect(layoutIdOfPropertyValue('logicalStructure')).toBeNull();
		expect(layoutIdOfPropertyValue('organizationStructure')).toBeNull();
		// 单字布局的引擎 id 与属性值归一后同形（`mindMap` → `mindmap`），按属性值处理
		expect(layoutIdOfPropertyValue('mindMap')).toBe('mindMap');
	});

	it('normalizeLayoutId 同时接受引擎 id 与属性值（入口归一用）', () => {
		expect(normalizeLayoutId('logicalStructure')).toBe('logicalStructure');
		expect(normalizeLayoutId('logical')).toBe('logicalStructure');
		expect(normalizeLayoutId('fishbone')).toBe('fishbone');
		expect(normalizeLayoutId('bogus')).toBeNull();
		expect(normalizeLayoutId(null)).toBeNull();
	});

	it('`Markdown` / 未知值 / 无值 → null（嵌入指令与视图共用这一份判定）', () => {
		expect(layoutIdOfPropertyValue('Markdown')).toBeNull();
		expect(layoutIdOfPropertyValue('%%备注%%')).toBeNull();
		expect(layoutIdOfPropertyValue(null)).toBeNull();
		expect(layoutIdOfPropertyValue([])).toBeNull();
	});

	it('layoutPropertyValue 对未知 id 回退出厂默认值，绝不写脏值', () => {
		expect(layoutPropertyValue('bogus')).toBe(MINDMAP_DEFAULT_LAYOUT_VALUE);
		expect(layoutPropertyValue('')).toBe(MINDMAP_DEFAULT_LAYOUT_VALUE);
	});

	it('`Object.prototype` 上的键名不是布局值（查表无原型 ⇒ fail-closed）', () => {
		// 对象字面量查表会命中原型方法：`constructor` / `toString` 曾读到函数，
		// 与「未知值一律 null」的契约相反，脏值会一路传进引擎与写盘值
		const protoKeys = ['constructor', 'toString', '__proto__', 'valueOf'];
		for (const key of protoKeys) {
			expect(layoutIdOfPropertyValue(key), key).toBeNull();
			expect(legacyLayoutIdOfPropertyValue(key), key).toBeNull();
			expect(normalizeLayoutId(key), key).toBeNull();
			expect(layoutPropertyValue(key), key).toBe(MINDMAP_DEFAULT_LAYOUT_VALUE);
			expect(
				readMindMapLayout({ [MINDMAP_LAYOUT_PROPERTY_KEY]: key }),
				key,
			).toBeNull();
		}
	});

	it('写侧归一：属性值 `logical` 与引擎 id `logicalStructure` 写成同一个值', () => {
		expect(layoutPropertyValue('logical')).toBe('logical');
		expect(layoutPropertyValue('logicalStructure')).toBe('logical');
		// 非法值不写：脏值既不能冒充一次用户选择，也不能落进 YAML
		const dirty = { [MINDMAP_LAYOUT_PROPERTY_KEY]: 'logical' };
		expect(setMindMapLayout(dirty, 'constructor')).toBe(false);
		expect(dirty[MINDMAP_LAYOUT_PROPERTY_KEY]).toBe('logical');
		// 新建文件用的属性块同样吃两种形态
		expect(buildMindMapFrontmatter('organization')).toContain(
			`${MINDMAP_LAYOUT_PROPERTY_KEY}: organization`,
		);
	});

	it('LAYOUT_OPTIONS 与 domain 的布局 id 集合一致（漏登记/多登记都报红）', () => {
		expect(LAYOUT_OPTIONS.map((option) => option.value).sort()).toEqual(
			[...MINDMAP_LAYOUT_IDS].sort(),
		);
	});
});

describe('旧值兼容读口（嵌入指令 / 升级入口）', () => {
	it('legacyLayoutIdOfPropertyValue：新 kebab 与旧 PascalCase / 连字符都认', () => {
		expect(legacyLayoutIdOfPropertyValue('logical')).toBe('logicalStructure');
		expect(legacyLayoutIdOfPropertyValue('LogicalStructure')).toBe(
			'logicalStructure',
		);
		expect(legacyLayoutIdOfPropertyValue('logical-structure')).toBe(
			'logicalStructure',
		);
		expect(legacyLayoutIdOfPropertyValue('catalog organization')).toBe(
			'catalogOrganization',
		);
		expect(legacyLayoutIdOfPropertyValue('Fishbone')).toBe('fishbone');
		// 未知值仍 fail-closed（嵌入指令据此报 invalidValue）
		expect(legacyLayoutIdOfPropertyValue('%%备注%%')).toBeNull();
		expect(legacyLayoutIdOfPropertyValue(null)).toBeNull();
	});

	it('readLegacyLayout：启用键里的旧布局值 → 引擎 id（排除启用值 Mindmap）', () => {
		expect(readLegacyLayout({ Mindmap: 'Timeline' })).toBe('timeline');
		expect(readLegacyLayout({ mindmap: 'OrganizationStructure' })).toBe(
			'organizationStructure',
		);
		// `Mindmap` 是新契约的开关，不承载布局（旧契约下它才是思维导图布局，
		// 那一层语义只归启动迁移判）
		expect(readLegacyLayout({ Mindmap: 'Mindmap' })).toBeNull();
		expect(readLegacyLayout({ Mindmap: 'Markdown' })).toBeNull();
		expect(readLegacyLayout({ Mindmap: '笔记' })).toBeNull();
		expect(readLegacyLayout({})).toBeNull();
		expect(readLegacyLayout(null)).toBeNull();
	});

	it('readLegacyMindMapLayout：布局键里的旧写法 → 引擎 id（认不出则 null）', () => {
		expect(
			readLegacyMindMapLayout({ 'Mindmap Layout': 'LogicalStructure' }),
		).toBe('logicalStructure');
		expect(
			readLegacyMindMapLayout({ 'mindmap-layout': 'catalog organization' }),
		).toBe('catalogOrganization');
		// 新写法同样能读（升级入口只在本读口为 null 时才写种子值，
		// 故这里不能因为「已经是 kebab」就返回 null）
		expect(readLegacyMindMapLayout({ 'Mindmap Layout': 'timeline' })).toBe(
			'timeline',
		);
		// 认不出 / 无键 / 空值：保持原样，交给读侧 fail-closed
		expect(
			readLegacyMindMapLayout({ 'Mindmap Layout': 'toString' }),
		).toBeNull();
		expect(readLegacyMindMapLayout({ 'Mindmap Layout': '' })).toBeNull();
		expect(readLegacyMindMapLayout({ Mindmap: 'Timeline' })).toBeNull();
		expect(readLegacyMindMapLayout(null)).toBeNull();
	});
});

describe('键名谓词', () => {
	it.each([
		['Mindmap', true],
		['mindmap', true],
		['MINDMAP', true],
		[' MiNdMaP ', true],
		['Mindmap Layout', false],
		['类型', false],
		['Type', false],
		['', false],
		['mindmaps', false],
	])('isMindMapPropertyKey(%j) → %s', (key, expected) => {
		expect(isMindMapPropertyKey(key)).toBe(expected);
	});

	it.each([
		['Mindmap Layout', true],
		['mindmap layout', true],
		['Mindmap-Layout', true],
		['MINDMAP_LAYOUT', true],
		['Mindmap', false],
		['布局', false],
		['', false],
	])('isMindMapLayoutKey(%j) → %s', (key, expected) => {
		expect(isMindMapLayoutKey(key)).toBe(expected);
	});
});

describe('写入侧', () => {
	it('setMindMapEnabled：写标准键 + 启用值，其它属性不动', () => {
		const fm: Record<string, unknown> = { title: 'x' };
		expect(setMindMapEnabled(fm)).toBe(true);
		expect(fm).toEqual({ title: 'x', Mindmap: 'Mindmap' });
	});

	it('setMindMapEnabled：幂等（已是标准键 + 启用值 → 无改动）', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Mindmap' };
		expect(setMindMapEnabled(fm)).toBe(false);
		expect(fm).toEqual({ Mindmap: 'Mindmap' });
	});

	it('setMindMapEnabled：收敛小写变体', () => {
		const fm: Record<string, unknown> = { mindmap: 'Markdown', title: 'x' };
		expect(setMindMapEnabled(fm)).toBe(true);
		expect(fm).toEqual({ Mindmap: 'Mindmap', title: 'x' });
	});

	it('setMindMapDisabled：写默认回写值，布局键原样保留', () => {
		const fm: Record<string, unknown> = {
			Mindmap: 'Mindmap',
			'Mindmap Layout': 'timeline',
			title: 'x',
		};
		expect(setMindMapDisabled(fm)).toBe(true);
		expect(fm).toEqual({
			Mindmap: 'Markdown',
			'Mindmap Layout': 'timeline',
			title: 'x',
		});
	});

	it('setMindMapDisabled：幂等', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Markdown' };
		expect(setMindMapDisabled(fm)).toBe(false);
	});

	it('setMindMapLayout：写 kebab 值，启用键原样保留', () => {
		const fm: Record<string, unknown> = { Mindmap: 'Mindmap', title: 'x' };
		expect(setMindMapLayout(fm, 'timeline')).toBe(true);
		expect(fm).toEqual({
			Mindmap: 'Mindmap',
			'Mindmap Layout': 'timeline',
			title: 'x',
		});
	});

	it('setMindMapLayout：接受引擎 id（调用方常拿到设置项的原值）', () => {
		const fm: Record<string, unknown> = {};
		expect(setMindMapLayout(fm, 'organizationStructure')).toBe(true);
		expect(fm).toEqual({ 'Mindmap Layout': 'organization' });
	});

	it('setMindMapLayout：收敛同名变体', () => {
		const fm: Record<string, unknown> = {
			'mindmap layout': 'fishbone',
			MINDMAP_LAYOUT: 'catalog',
		};
		expect(setMindMapLayout(fm, 'timeline')).toBe(true);
		expect(fm).toEqual({ 'Mindmap Layout': 'timeline' });
	});

	it('setMindMapLayout：未知 id 不写任何东西', () => {
		const fm: Record<string, unknown> = { 'Mindmap Layout': 'timeline' };
		expect(setMindMapLayout(fm, 'bogus')).toBe(false);
		expect(fm).toEqual({ 'Mindmap Layout': 'timeline' });
	});

	it('断代：旧键 `类型` / `Type` 原样放过（不写、不改、不删）', () => {
		const fm: Record<string, unknown> = { 类型: 'Mindmap', Type: 'Markdown' };
		setMindMapEnabled(fm);
		setMindMapLayout(fm, 'timeline');
		expect(fm).toEqual({
			类型: 'Mindmap',
			Type: 'Markdown',
			Mindmap: 'Mindmap',
			'Mindmap Layout': 'timeline',
		});
	});
});

describe('buildMindMapFrontmatter（新建文件用）', () => {
	it('缺省：两个键逐字写出（含末尾换行）', () => {
		expect(buildMindMapFrontmatter()).toBe(
			'---\nMindmap: Mindmap\nMindmap Layout: mindmap\n---\n',
		);
	});

	it('给引擎 id：写成 kebab 值', () => {
		expect(buildMindMapFrontmatter('logicalStructure')).toBe(
			'---\nMindmap: Mindmap\nMindmap Layout: logical\n---\n',
		);
		expect(buildMindMapFrontmatter('fishbone')).toBe(
			'---\nMindmap: Mindmap\nMindmap Layout: fishbone\n---\n',
		);
	});

	it('给属性值：原样写成该值', () => {
		expect(buildMindMapFrontmatter('catalog')).toBe(
			'---\nMindmap: Mindmap\nMindmap Layout: catalog\n---\n',
		);
	});

	it('属性块能被读侧反解（写读自洽）', () => {
		for (const layoutId of MINDMAP_LAYOUT_IDS) {
			const block = buildMindMapFrontmatter(layoutId);
			const lines = block.split('\n');
			expect(lines[1]).toBe(`${MINDMAP_PROPERTY_KEY}: Mindmap`);
			const layoutLine = lines[2] ?? '';
			expect(
				layoutLine.startsWith(`${MINDMAP_LAYOUT_PROPERTY_KEY}: `),
			).toBe(true);
			const value = layoutLine.slice(MINDMAP_LAYOUT_PROPERTY_KEY.length + 2);
			expect(readMindMapLayout({ 'Mindmap Layout': value })).toBe(layoutId);
			expect(isMindMapEnabled({ Mindmap: 'Mindmap' })).toBe(true);
		}
	});

	it('常量口径', () => {
		expect(MINDMAP_PROPERTY_KEY).toBe('Mindmap');
		expect(MINDMAP_LAYOUT_PROPERTY_KEY).toBe('Mindmap Layout');
		expect(MINDMAP_ENABLED_VALUE).toBe('Mindmap');
		expect(MINDMAP_DISABLED_VALUE).toBe('Markdown');
		expect(MINDMAP_DEFAULT_LAYOUT_VALUE).toBe('mindmap');
		expect(MINDMAP_LAYOUT_VALUES.mindMap).toBe('mindmap');
	});
});
