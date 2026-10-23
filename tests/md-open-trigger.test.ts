/**
 * 声明式视图切换的属性落盘（硬规则 7：纯逻辑+薄平台依赖，直测）：
 * - 手动「以思维导图打开」→ 升级：无声明时按语言写入 `类型`/`Type` = `Mindmap`；
 *   已声明则免写；其它值被改写为 `Mindmap`（打开方式决定值）。
 * - 「以 Markdown 打开」→ 降级：把命中键改写为 `Markdown`；无命中键时按语言补写。
 * - 语言切换 → 迁移：把已有声明的键**重命名为当前语言的键**（`类型` ⇄ `Type`），
 *   不新增第二把键（防「改语言后两把键并存」）。
 * 行为依据：src/markdown/md-open.ts（upgrade/downgrade/migrateMindMapPropertyKeys）。
 */
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import {
	declareAndOpenAsMindMap,
	migrateMindMapPropertyKeys,
	openAsMarkdown,
} from '../src/markdown/md-open';
import type { Language } from '../src/core/i18n';

/** 轻量 app 桩：metadataCache 读当前 frontmatter，processFrontMatter 调回调并落盘 */
function makeApp(lang: Language, initial: Record<string, unknown> | null) {
	const store: { frontmatter: Record<string, unknown> | null } = {
		frontmatter: initial ? { ...initial } : null,
	};
	const writes: Record<string, unknown>[] = [];
	const app = {
		metadataCache: {
			getFileCache: () => ({ frontmatter: store.frontmatter }),
		},
		fileManager: {
			processFrontMatter: vi.fn(
				async (_file: TFile, cb: (fm: Record<string, unknown>) => void) => {
					const fm: Record<string, unknown> = { ...(store.frontmatter ?? {}) };
					cb(fm);
					store.frontmatter = fm;
					writes.push({ ...fm });
				},
			),
		},
	} as unknown as App;
	return { app, store, writes };
}

function leafStub(): { leaf: unknown; setViewState: ReturnType<typeof vi.fn> } {
	const setViewState = vi.fn(async () => undefined);
	return { leaf: { view: undefined, setViewState }, setViewState };
}

const file = Object.assign(new TFile(), { path: 'a/b.md', extension: 'md' });

describe('手动「以思维导图打开」→ 升级声明', () => {
	it('zh 无属性：补写 `类型: Mindmap`，且切到导图视图', async () => {
		const { app, store, writes } = makeApp('zh', null);
		const { leaf, setViewState } = leafStub();
		await declareAndOpenAsMindMap(app, leaf as never, file, 'zh');
		expect(writes).toHaveLength(1);
		expect(writes[0]).toEqual({ 类型: 'Mindmap' });
		expect(store.frontmatter).toEqual({ 类型: 'Mindmap' });
		expect(setViewState).toHaveBeenCalledOnce();
	});

	it('en 无属性：补写 `Type: Mindmap`（写侧看语言）', async () => {
		const { app, writes } = makeApp('en', null);
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'en');
		expect(writes[0]).toEqual({ Type: 'Mindmap' });
	});

	it('已是声明：不重写 YAML（避免每次打开都重序列化）', async () => {
		const { app, store, writes } = makeApp('zh', { 类型: 'Mindmap' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh');
		expect(writes).toHaveLength(0);
		expect(store.frontmatter).toEqual({ 类型: 'Mindmap' });
	});

	it('有非导图值（如 `类型: 笔记`）：改写为 `Mindmap`（打开方式决定值）', async () => {
		const { app, writes } = makeApp('zh', { 类型: '笔记' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh');
		expect(writes[0]).toEqual({ 类型: 'Mindmap' });
	});

	it('双键并存且其一已是 Mindmap：已声明，不重写 YAML（`Type: Markdown` 留原样）', async () => {
		const { app, store, writes } = makeApp('zh', { 类型: 'Mindmap', Type: 'Markdown' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh');
		expect(writes).toHaveLength(0);
		expect(store.frontmatter).toEqual({ 类型: 'Mindmap', Type: 'Markdown' });
	});
});

describe('「以 Markdown 打开」→ 降级声明', () => {
	it('zh 有 `类型: Mindmap`：改写为 `类型: Markdown`，切回 Markdown 视图', async () => {
		const { app, store, writes } = makeApp('zh', { 类型: 'Mindmap' });
		const { leaf, setViewState } = leafStub();
		await openAsMarkdown(app, leaf as never, file, 'source', 'zh');
		expect(writes).toHaveLength(1);
		expect(writes[0]).toEqual({ 类型: 'Markdown' });
		expect(store.frontmatter).toEqual({ 类型: 'Markdown' });
		expect(setViewState).toHaveBeenCalledOnce();
	});

	it('无命中键（普通笔记）：按语言补写 `类型: Markdown`', async () => {
		const { app, writes } = makeApp('zh', null);
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes[0]).toEqual({ 类型: 'Markdown' });
	});

	it('en 且命中 `Type`：保留原键，改写为 `Markdown`（不另创 `类型`）', async () => {
		const { app, writes } = makeApp('en', { Type: 'Mindmap' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'en');
		expect(writes[0]).toEqual({ Type: 'Markdown' });
	});

	it('已是 `Markdown`：不重写 YAML', async () => {
		const { app, writes } = makeApp('zh', { 类型: 'Markdown' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes).toHaveLength(0);
	});

	it('非导图偏移值（如 `类型: 其它`）：属性已存在 → 不重写 YAML（目的已达：非导图）', async () => {
		const { app, store, writes } = makeApp('zh', { 类型: '其它' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes).toHaveLength(0);
		expect(store.frontmatter).toEqual({ 类型: '其它' });
	});
});

/** 多文件 app 桩：vault.getMarkdownFiles + 按文件键的 metadataCache/processFrontMatter */
function makeVaultApp(
	entries: { path: string; frontmatter: Record<string, unknown> | null }[],
) {
	const files = entries.map((e) =>
		Object.assign(new TFile(), { path: e.path, extension: 'md' }),
	);
	const store = new Map<TFile, Record<string, unknown> | null>();
	files.forEach((f, i) => store.set(f, entries[i]?.frontmatter ?? null));
	const writes: { path: string; frontmatter: Record<string, unknown> }[] = [];
	const app = {
		vault: { getMarkdownFiles: () => files },
		metadataCache: {
			getFileCache: (f: TFile) => ({ frontmatter: store.get(f) ?? null }),
		},
		fileManager: {
			processFrontMatter: vi.fn(
				async (f: TFile, cb: (fm: Record<string, unknown>) => void) => {
					const fm: Record<string, unknown> = { ...(store.get(f) ?? {}) };
					cb(fm);
					store.set(f, fm);
					writes.push({ path: f.path, frontmatter: { ...fm } });
				},
			),
		},
	} as unknown as App;
	return { app, writes };
}

describe('语言切换迁移 migrateMindMapPropertyKeys（键名随语言收敛）', () => {
	it('zh：`Type: Mindmap` → 重命名为 `类型: Mindmap`，其它属性与值不动', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'a.md', frontmatter: { Type: 'Mindmap', title: 'x' } },
		]);
		await migrateMindMapPropertyKeys(app, 'zh');
		expect(writes).toEqual([
			{ path: 'a.md', frontmatter: { 类型: 'Mindmap', title: 'x' } },
		]);
	});

	it('en：`类型: Markdown` → 重命名为 `Type: Markdown`（只改键名、值保留）', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'a.md', frontmatter: { 类型: 'Markdown' } },
		]);
		await migrateMindMapPropertyKeys(app, 'en');
		expect(writes).toEqual([{ path: 'a.md', frontmatter: { Type: 'Markdown' } }]);
	});

	it('已是唯一目标键 → 免写（迁移的常见路径）', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'a.md', frontmatter: { 类型: 'Mindmap' } },
		]);
		await migrateMindMapPropertyKeys(app, 'zh');
		expect(writes).toHaveLength(0);
	});

	it('无声明键的文件被跳过', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'a.md', frontmatter: { title: 'x' } },
			{ path: 'b.md', frontmatter: null },
		]);
		await migrateMindMapPropertyKeys(app, 'en');
		expect(writes).toHaveLength(0);
	});

	it('同名但不是声明值（`类型: wiki`）→ 一律不动（只认 Mindmap / Markdown）', async () => {
		// 2026-10-23 实机踩到：按键名全库扫描会把 `类型: wiki` 改成 `Type: wiki`，
		// 值与键一起被改、用户笔记被破坏。
		const { app, writes } = makeVaultApp([
			{ path: 'wiki.md', frontmatter: { 类型: 'wiki', title: 'x' } },
			{ path: 'en-wiki.md', frontmatter: { Type: 'wiki' } },
			{ path: 'num.md', frontmatter: { 类型: 42 } },
		]);
		await migrateMindMapPropertyKeys(app, 'en');
		expect(writes).toHaveLength(0);
	});

	it('目标键被非声明值占用 → 整文件跳过并留痕，不覆盖用户属性', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { app, writes } = makeVaultApp([
			{ path: 'mix.md', frontmatter: { 类型: 'wiki', Type: 'Mindmap' } },
		]);
		await migrateMindMapPropertyKeys(app, 'zh');
		expect(writes, '覆盖会把 `类型: wiki` 抹成 Mindmap').toHaveLength(0);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('两键并存 → 收敛为唯一语言键（取首个键的值）', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'a.md', frontmatter: { 类型: 'Mindmap', Type: 'Markdown' } },
		]);
		await migrateMindMapPropertyKeys(app, 'en');
		expect(writes).toEqual([{ path: 'a.md', frontmatter: { Type: 'Mindmap' } }]);
	});

	it('混合文件：只改写需要改的，已是目标键的文件免写', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'zh-already.md', frontmatter: { 类型: 'Mindmap' } },
			{ path: 'en-key.md', frontmatter: { Type: 'Mindmap' } },
		]);
		await migrateMindMapPropertyKeys(app, 'zh');
		expect(writes).toEqual([
			{ path: 'en-key.md', frontmatter: { 类型: 'Mindmap' } },
		]);
	});

	it('单文件失败只留痕：不影响其余文件继续迁移', async () => {
		const { app, writes } = makeVaultApp([
			{ path: 'bad.md', frontmatter: { Type: 'Mindmap' } },
			{ path: 'ok.md', frontmatter: { Type: 'Mindmap' } },
		]);
		const original = (app.fileManager.processFrontMatter as ReturnType<typeof vi.fn>)
			.getMockImplementation() as (
			f: TFile,
			cb: (fm: Record<string, unknown>) => void,
		) => Promise<void>;
		(app.fileManager.processFrontMatter as ReturnType<typeof vi.fn>).mockImplementation(
			async (f: TFile, cb: (fm: Record<string, unknown>) => void) => {
				if (f.path === 'bad.md') {
					throw new Error('boom');
				}
				return original(f, cb);
			},
		);
		await migrateMindMapPropertyKeys(app, 'zh');
		expect(writes).toEqual([
			{ path: 'ok.md', frontmatter: { 类型: 'Mindmap' } },
		]);
	});
});
