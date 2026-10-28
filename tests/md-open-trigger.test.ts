/**
 * 声明式视图切换的属性落盘（硬规则 7：纯逻辑+薄平台依赖，直测）：
 * - 手动「以思维导图打开」→ 升级：无声明时写入**种子布局**的标准值（设置
 *   `defaultLayout` 对应的属性值，不是恒写 `Mindmap`）；已声明则免写；
 *   终止值 / 未知值被改写为种子值（打开方式决定值）。
 * - 「以 Markdown 打开」→ 降级：把声明键改写为 `Mindmap: Markdown`；无声明值时补写；
 *   只有「值已经是 Markdown」才免写。
 * - 键名与界面语言**完全无关**（2026-10-28 单键化）：zh / en 走同一形态。
 * - 旧键 `Type` / `类型` 不认也不动（断代）。
 * 行为依据：src/markdown/md-open.ts（upgradeMindMapProperty / downgradeMindMapProperty）。
 */
import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { declareAndOpenAsMindMap, openAsMarkdown } from '../src/markdown/md-open';

/**
 * 轻量 app 桩：processFrontMatter 调回调并落盘。
 * `cached` 与 `initial` 分开可模拟 **MetadataCache 滞后**（缓存说「未声明」而磁盘已声明）。
 */
function makeApp(
	initial: Record<string, unknown> | null,
	cached: Record<string, unknown> | null = initial,
) {
	const store: { frontmatter: Record<string, unknown> | null } = {
		frontmatter: initial ? { ...initial } : null,
	};
	const cache: { frontmatter: Record<string, unknown> | null } = {
		frontmatter: cached ? { ...cached } : null,
	};
	const writes: Record<string, unknown>[] = [];
	const app = {
		metadataCache: {
			getFileCache: () => ({ frontmatter: cache.frontmatter }),
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

describe('手动「以思维导图打开」→ 升级声明（键名与语言无关）', () => {
	it.each(['zh', 'en'] as const)(
		'%s 无属性：补写 `Mindmap: Mindmap`，且切到导图视图',
		async (lang) => {
			const { app, store, writes } = makeApp(null);
			const { leaf, setViewState } = leafStub();
			await declareAndOpenAsMindMap(app, leaf as never, file, lang, 'mindMap');
			expect(writes).toHaveLength(1);
			expect(writes[0]).toEqual({ Mindmap: 'Mindmap' });
			expect(store.frontmatter).toEqual({ Mindmap: 'Mindmap' });
			expect(setViewState).toHaveBeenCalledOnce();
		},
	);

	it('种子布局：默认布局为逻辑结构图 → 升级写入 `Mindmap: LogicalStructure`', async () => {
		const { app, store, writes } = makeApp(null);
		await declareAndOpenAsMindMap(
			app,
			leafStub().leaf as never,
			file,
			'zh',
			'logicalStructure',
		);
		expect(writes).toHaveLength(1);
		expect(writes[0]).toEqual({ Mindmap: 'LogicalStructure' });
		expect(store.frontmatter).toEqual({ Mindmap: 'LogicalStructure' });
	});

	it('已是声明：不重写 YAML（避免每次打开都重序列化）', async () => {
		const { app, store, writes } = makeApp({ Mindmap: 'Mindmap' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh', 'mindMap');
		expect(writes).toHaveLength(0);
		expect(store.frontmatter).toEqual({ Mindmap: 'Mindmap' });
	});

	it('有非导图值（如 `Mindmap: 笔记`）：改写为 `Mindmap`（打开方式决定值）', async () => {
		const { app, writes } = makeApp({ Mindmap: '笔记' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh', 'mindMap');
		expect(writes[0]).toEqual({ Mindmap: 'Mindmap' });
	});

	it('同名变体并存且其一已是 Mindmap：已声明，不重写 YAML', async () => {
		const initial = { Mindmap: 'Mindmap', mindmap: 'Markdown' };
		const { app, store, writes } = makeApp(initial);
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh', 'mindMap');
		expect(writes).toHaveLength(0);
		expect(store.frontmatter).toEqual(initial);
	});

	it('缓存滞后 + 变体并存：规范化为声明值，不取同族的 Markdown 值（否则静默降级）', async () => {
		// 磁盘：标准键已是 Markdown、小写变体仍是 Mindmap（缓存仍认为「未声明」）
		const { app, store, writes } = makeApp(
			{ Mindmap: 'Markdown', mindmap: 'Mindmap' },
			null,
		);
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh', 'mindMap');
		expect(writes[0]).toEqual({ Mindmap: 'Mindmap' });
		expect(store.frontmatter, '仍应是导图').toEqual({ Mindmap: 'Mindmap' });
	});

	it('缓存滞后 + 变体并存且已声明某种布局：收敛为该布局，不被种子值重置', async () => {
		// 磁盘：两个变体都写着 Timeline（缓存仍认为「未声明」）。收敛必须写声明值，
		// 用种子值会把用户已选的布局静默换掉。
		const { app, store, writes } = makeApp(
			{ Mindmap: 'Timeline', mindmap: 'Timeline' },
			null,
		);
		await declareAndOpenAsMindMap(
			app,
			leafStub().leaf as never,
			file,
			'zh',
			'logicalStructure',
		);
		expect(writes[0]).toEqual({ Mindmap: 'Timeline' });
		expect(store.frontmatter).toEqual({ Mindmap: 'Timeline' });
	});

	it('断代：旧键 Type 即使值为 Mindmap 也不认 → 另写标准键，旧键原样保留', async () => {
		const { app, writes } = makeApp({ Type: 'Mindmap', title: 'x' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'zh', 'mindMap');
		expect(writes[0]).toEqual({ Type: 'Mindmap', title: 'x', Mindmap: 'Mindmap' });
	});

	it('断代：旧键 类型 即使值为 Mindmap 也不认 → 另写标准键，旧键原样保留', async () => {
		const { app, writes } = makeApp({ 类型: 'Mindmap' });
		await declareAndOpenAsMindMap(app, leafStub().leaf as never, file, 'en', 'mindMap');
		expect(writes[0]).toEqual({ 类型: 'Mindmap', Mindmap: 'Mindmap' });
	});
});

describe('「以 Markdown 打开」→ 降级声明（键名与语言无关）', () => {
	it('有 `Mindmap: Mindmap`：改写为 `Mindmap: Markdown`，切回 Markdown 视图', async () => {
		const { app, store, writes } = makeApp({ Mindmap: 'Mindmap' });
		const { leaf, setViewState } = leafStub();
		await openAsMarkdown(app, leaf as never, file, 'source', 'en');
		expect(writes).toHaveLength(1);
		expect(writes[0]).toEqual({ Mindmap: 'Markdown' });
		expect(store.frontmatter).toEqual({ Mindmap: 'Markdown' });
		expect(setViewState).toHaveBeenCalledOnce();
	});

	it('同名变体（`mindmap: Mindmap`）：降级时收敛到标准键', async () => {
		const { app, writes } = makeApp({ mindmap: 'Mindmap' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes[0]).toEqual({ Mindmap: 'Markdown' });
	});

	it('无声明键（普通笔记）：补写 `Mindmap: Markdown`', async () => {
		const { app, writes } = makeApp(null);
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes[0]).toEqual({ Mindmap: 'Markdown' });
	});

	it('已是 `Mindmap: Markdown`：不重写 YAML', async () => {
		const { app, writes } = makeApp({ Mindmap: 'Markdown' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes).toHaveLength(0);
	});

	it('未知值（如 `Mindmap: 其它`）：改写为 `Markdown`（短路条件只有「已是 Markdown」）', async () => {
		const { app, store, writes } = makeApp({ Mindmap: '其它' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes[0]).toEqual({ Mindmap: 'Markdown' });
		expect(store.frontmatter).toEqual({ Mindmap: 'Markdown' });
	});

	it('布局值（如 `Mindmap: Timeline`）：改写为 `Markdown`', async () => {
		const { app, writes } = makeApp({ Mindmap: 'Timeline' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes[0]).toEqual({ Mindmap: 'Markdown' });
	});

	it('断代：旧键 Type 既不认也不改，另写标准键降级值', async () => {
		const { app, writes } = makeApp({ Type: 'Mindmap' });
		await openAsMarkdown(app, leafStub().leaf as never, file, 'source', 'zh');
		expect(writes[0]).toEqual({ Type: 'Mindmap', Mindmap: 'Markdown' });
	});
});
