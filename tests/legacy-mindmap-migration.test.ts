/**
 * 【一次性迁移，0.4.0 删除】`platform/legacy-mindmap-migration.ts` 的直测。
 *
 * 锁四件事：
 * ① 旧六值全部迁移（`LogicalStructure` / `OrganizationStructure` /
 *    `CatalogOrganization` / `Timeline` / `Fishbone`，以及旧契约里表示「思维导图」
 *    布局的 `Mindmap`）——`Markdown` / 未知值 / 空值不迁；
 * ② **幂等**：已有合法布局键的文件不再命中（否则 `Mindmap: Mindmap` 每次启动都重写 YAML）；
 * ③ **只换写法、不造声明**（2026-11-09）：没有启用键的普通笔记、已被用户切回
 *    `Markdown` 的文件都**不碰**——只带布局键的残渣不得长出启用键；
 * ④ 迁移写侧只碰声明两键，其它属性原样保留；单文件失败不阻断其余文件。
 */
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import {
	legacyMigrationPlanOf,
	migrateLegacyMindmapProperties,
} from '../src/platform/legacy-mindmap-migration';

function fileStub(path: string): TFile {
	return Object.assign(new TFile(), { path, extension: 'md' });
}

interface Entry {
	file: TFile;
	frontmatter: Record<string, unknown> | null;
	/** 可选的「缓存视图」：模拟 MetadataCache 滞后（与磁盘 frontmatter 不同） */
	cache?: Record<string, unknown> | null;
}

function makeApp(entries: Entry[], failPaths: readonly string[] = []) {
	const writes: Array<{ path: string; fm: Record<string, unknown> }> = [];
	const app = {
		vault: {
			getMarkdownFiles: () => entries.map((entry) => entry.file),
		},
		metadataCache: {
			getFileCache: (file: TFile) => {
				const entry = entries.find((candidate) => candidate.file === file);
				if (!entry) {
					return null;
				}
				const frontmatter =
					entry.cache !== undefined ? entry.cache : entry.frontmatter;
				return { frontmatter };
			},
		},
		fileManager: {
			processFrontMatter: vi.fn(
				async (
					file: TFile,
					callback: (fm: Record<string, unknown>) => void,
				) => {
					if (failPaths.includes(file.path)) {
						throw new Error('disk full');
					}
					const entry = entries.find((candidate) => candidate.file === file);
					const fm: Record<string, unknown> = { ...(entry?.frontmatter ?? {}) };
					callback(fm);
					if (entry) {
						entry.frontmatter = fm;
					}
					writes.push({ path: file.path, fm });
				},
			),
		},
	} as unknown as App;
	return { app, writes };
}

describe('legacyMigrationPlanOf：旧值 → 迁移计划', () => {
	it.each([
		// 值 / 目标布局 / 是否还要改写启用键
		['LogicalStructure', 'logical', true],
		['OrganizationStructure', 'organization', true],
		['CatalogOrganization', 'catalog', true],
		['Timeline', 'timeline', true],
		['Fishbone', 'fishbone', true],
		// 旧契约的「思维导图」布局：它同时是新契约的启用值，故**不重写启用键**，
		// 只补布局（迁移时刻「启用 + 无布局键」只可能是旧文件——插件写出的启用
		// 文件恒带布局键）
		['Mindmap', 'mindmap', false],
	] as const)('%s → %s（enable=%s）', (value, layout, enable) => {
		expect(legacyMigrationPlanOf({ Mindmap: value })).toEqual({
			layout,
			enable,
		});
	});

	it('宽容写法：大小写 / 连字符 / 空格；数组取首项；同名变体也认', () => {
		expect(legacyMigrationPlanOf({ Mindmap: 'logical-structure' })).toEqual({
			layout: 'logical',
			enable: true,
		});
		expect(legacyMigrationPlanOf({ Mindmap: 'FISH BONE' })).toEqual({
			layout: 'fishbone',
			enable: true,
		});
		expect(legacyMigrationPlanOf({ Mindmap: ['Timeline'] })).toEqual({
			layout: 'timeline',
			enable: true,
		});
		expect(legacyMigrationPlanOf({ mindmap: 'OrganizationStructure' })).toEqual({
			layout: 'organization',
			enable: true,
		});
	});

	it('不迁：Markdown / 未知值 / 空值 / 无键', () => {
		expect(legacyMigrationPlanOf({ Mindmap: 'Markdown' })).toBeNull();
		expect(legacyMigrationPlanOf({ Mindmap: '笔记' })).toBeNull();
		expect(legacyMigrationPlanOf({ Mindmap: '' })).toBeNull();
		expect(legacyMigrationPlanOf({ Mindmap: [] })).toBeNull();
		expect(legacyMigrationPlanOf({})).toBeNull();
		expect(legacyMigrationPlanOf(null)).toBeNull();
	});

	it('幂等：布局键已合法 ⇒ 一律不命中（含旧启用值 Mindmap）', () => {
		expect(
			legacyMigrationPlanOf({
				Mindmap: 'Mindmap',
				'Mindmap Layout': 'mindmap',
			}),
		).toBeNull();
		expect(
			legacyMigrationPlanOf({
				Mindmap: 'Timeline',
				'Mindmap Layout': 'timeline',
			}),
		).toBeNull();
	});

	it('布局键在、值却是旧写法：只归一布局值，不动启用键', () => {
		expect(
			legacyMigrationPlanOf({
				Mindmap: 'Mindmap',
				'Mindmap Layout': 'LogicalStructure',
			}),
		).toEqual({ layout: 'logical', enable: false });
		// 键名变体同样认（`Timeline` / `Fishbone` 这类单词旧值归一后与新值同形，
		// 新读口本就收，走不到本分支——要用多词旧值才能命中）
		expect(
			legacyMigrationPlanOf({
				Mindmap: 'Mindmap',
				'mindmap-layout': 'OrganizationStructure',
			}),
		).toEqual({ layout: 'organization', enable: false });
	});

	it('布局键在、值认不出：不碰文件（读侧 fail-closed 回落默认布局）', () => {
		// 曾经：启动迁移把这类文件静默改写成 `mindmap`，等于拿旧契约的语义
		// 覆盖用户手写的值（2026-11-08 实机）
		for (const value of ['toString', 'constructor', '书本', '', []]) {
			expect(
				legacyMigrationPlanOf({ Mindmap: 'Mindmap', 'Mindmap Layout': value }),
				String(value),
			).toBeNull();
		}
	});

	it('旧启用值优先于布局键（旧契约不看布局键，脏值不算用户选择）', () => {
		expect(
			legacyMigrationPlanOf({
				Mindmap: 'Timeline',
				'Mindmap Layout': 'toString',
			}),
		).toEqual({ layout: 'timeline', enable: true });
	});

	it('**只换写法，不造声明**：没有启用键 / 已切回 Markdown ⇒ 不碰', () => {
		// 普通笔记只剩一个布局键（删键后的残渣）：迁移不得把它变成导图
		expect(legacyMigrationPlanOf({ 'Mindmap Layout': 'LogicalStructure' })).toBeNull();
		expect(legacyMigrationPlanOf({ 'Mindmap Layout': 'logical' })).toBeNull();
		// 用户主动「切换为 Markdown」：布局键原样留着，迁移不得重新启用
		expect(
			legacyMigrationPlanOf({
				Mindmap: 'Markdown',
				'Mindmap Layout': 'LogicalStructure',
			}),
		).toBeNull();
		// 未知值同理（新契约下本就不启用）
		expect(
			legacyMigrationPlanOf({
				Mindmap: '笔记',
				'Mindmap Layout': 'OrganizationStructure',
			}),
		).toBeNull();
	});
});

describe('migrateLegacyMindmapProperties：批量迁移', () => {
	it('只迁移旧值文件，写 Mindmap + Mindmap Layout，其它属性保留', async () => {
		const legacy = fileStub('旧.md');
		const enabled = fileStub('启用.md');
		const plain = fileStub('普通.md');
		const { app, writes } = makeApp([
			{ file: legacy, frontmatter: { title: 'x', Mindmap: 'Timeline' } },
			// 已是新契约（有布局键）：不再命中
			{
				file: enabled,
				frontmatter: { Mindmap: 'Mindmap', 'Mindmap Layout': 'timeline' },
			},
			{ file: plain, frontmatter: { Mindmap: 'Markdown' } },
		]);

		const count = await migrateLegacyMindmapProperties(app);

		expect(count).toBe(1);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toEqual({
			path: '旧.md',
			fm: {
				title: 'x',
				Mindmap: 'Mindmap',
				'Mindmap Layout': 'timeline',
			},
		});
	});

	it('旧启用值 Mindmap（旧契约的思维导图布局）：补出 mindmap 布局键', async () => {
		const file = fileStub('思维导图.md');
		const { app, writes } = makeApp([
			{ file, frontmatter: { Mindmap: 'Mindmap' } },
		]);

		const count = await migrateLegacyMindmapProperties(app);

		expect(count).toBe(1);
		expect(writes[0]?.fm).toEqual({
			Mindmap: 'Mindmap',
			'Mindmap Layout': 'mindmap',
		});
	});

	it('不把普通笔记 / 已降级文件变成导图（无写入）', async () => {
		const leftovers = fileStub('残渣.md');
		const downgraded = fileStub('已降级.md');
		const { app, writes } = makeApp([
			{ file: leftovers, frontmatter: { 'Mindmap Layout': 'LogicalStructure' } },
			{
				file: downgraded,
				frontmatter: {
					Mindmap: 'Markdown',
					'Mindmap Layout': 'LogicalStructure',
				},
			},
		]);

		const count = await migrateLegacyMindmapProperties(app);

		expect(count).toBe(0);
		// `processFrontMatter` 不会被调用（缓存层就过滤掉，不产生任何写盘）
		expect(writes).toHaveLength(0);
	});

	it('缓存滞后但回调内发现已是新值：不改写、不计入迁移数', async () => {
		const file = fileStub('已迁移.md');
		const { app, writes } = makeApp([
			// 缓存说旧值；回调内的权威 frontmatter 已是新契约
			{
				file,
				frontmatter: { Mindmap: 'Mindmap', 'Mindmap Layout': 'timeline' },
				cache: { Mindmap: 'Timeline' },
			},
		]);

		const count = await migrateLegacyMindmapProperties(app);

		expect(count).toBe(0);
		expect(writes).toHaveLength(1);
		// 回调内没有改动，官方写入仍是原样
		expect(writes[0]?.fm).toEqual({
			Mindmap: 'Mindmap',
			'Mindmap Layout': 'timeline',
		});
	});

	it('单个文件写盘失败：留痕但不阻断其余文件', async () => {
		const bad = fileStub('坏.md');
		const good = fileStub('好.md');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { app, writes } = makeApp(
			[
				{ file: bad, frontmatter: { Mindmap: 'LogicalStructure' } },
				{ file: good, frontmatter: { Mindmap: 'Fishbone' } },
			],
			[bad.path],
		);

		const count = await migrateLegacyMindmapProperties(app);

		expect(count).toBe(1);
		expect(writes.map((entry) => entry.path)).toEqual(['好.md']);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});
