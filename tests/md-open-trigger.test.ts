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
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../src/core/constants';
import {
	declareAndOpenAsMindMap,
	openAsMarkdown,
	openAsMindMap,
} from '../src/markdown/md-open';

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

/**
 * 切换期间的源视图遮罩（`openAsMindMap`）。
 *
 * 为什么需要：Obsidian 打开文件**先**建 markdown 视图并渲染，之后才走到
 * `setViewState`；启动恢复时叶子逐批恢复，中间能隔数百毫秒 ⇒ 用户看到
 * 「先闪一屏 Markdown 原文，再变成导图」（2026-11-03 实机反馈）。
 * 遮罩必须**成败都摘**：失败时留着 = 该 leaf 永久空白。
 */
describe('openAsMindMap：切换期间的遮罩与并发去重', () => {
	interface HostStub {
		classes: Set<string>;
		addClass: (cls: string) => void;
		removeClass: (cls: string) => void;
	}

	function hostStub(): HostStub {
		const classes = new Set<string>();
		return {
			classes,
			addClass: (cls: string) => void classes.add(cls),
			removeClass: (cls: string) => void classes.delete(cls),
		};
	}

	function leafWithHost(
		host: HostStub,
		impl: () => Promise<void> = async () => undefined,
	) {
		const setViewState = vi.fn(impl);
		const leaf = {
			view: {
				getViewType: () => CORE_VIEW_TYPE.MARKDOWN,
				// 非 MarkdownView 实例 ⇒ 记录的返回模式回落 source，不影响本套用例
				containerEl: { parentElement: host },
			},
			setViewState,
		};
		return { leaf, setViewState };
	}

	it('切换成功：切换期间带遮罩类，落定后摘掉', async () => {
		const host = hostStub();
		const seen: boolean[] = [];
		const { leaf } = leafWithHost(host, async () => {
			seen.push(host.classes.has('mindmap-view-switching'));
		});

		await openAsMindMap(leaf as never, file);

		expect(seen, 'setViewState 执行时必须在遮罩里').toEqual([true]);
		expect(host.classes.has('mindmap-view-switching'), '结束后必须摘').toBe(
			false,
		);
	});

	it('切换失败（叶子已被替换）：同样摘掉遮罩，不把 leaf 留成空白', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const host = hostStub();
		const { leaf } = leafWithHost(host, async () => {
			throw new Error('leaf detached');
		});

		await expect(openAsMindMap(leaf as never, file)).resolves.toBeUndefined();
		expect(host.classes.has('mindmap-view-switching')).toBe(false);
		errorSpy.mockRestore();
	});

	it('并发触发（active-leaf-change 与 file-open 同时命中）：只真正切一次', async () => {
		const host = hostStub();
		const { leaf, setViewState } = leafWithHost(host);

		await Promise.all([
			openAsMindMap(leaf as never, file),
			openAsMindMap(leaf as never, file),
		]);

		expect(setViewState, '重复切换会让画面再闪一次').toHaveBeenCalledTimes(1);
	});

	it('切换挂起（setViewState 永不 settle）：超时后允许重试，不让 leaf 永久卡死', async () => {
		vi.useFakeTimers();
		const host = hostStub();
		let calls = 0;
		const { leaf, setViewState } = leafWithHost(host, () => {
			calls += 1;
			// 第一次永不完成（模拟视图系统中间态），第二次正常
			return calls === 1 ? new Promise<void>(() => undefined) : Promise.resolve();
		});

		void openAsMindMap(leaf as never, file);
		expect(setViewState).toHaveBeenCalledTimes(1);

		// 超时窗口内：仍复用在途切换，不重复发 setViewState
		void openAsMindMap(leaf as never, file);
		expect(setViewState).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(3000);
		await openAsMindMap(leaf as never, file);
		expect(setViewState, '超时后必须能重试').toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it('已经在导图视图：直接返回，不重复切换', async () => {
		const host = hostStub();
		const setViewState = vi.fn(async () => undefined);
		const leaf = {
			view: { getViewType: () => VIEW_TYPE, containerEl: { parentElement: host } },
			setViewState,
		};

		await openAsMindMap(leaf as never, file);

		expect(setViewState).not.toHaveBeenCalled();
		expect(host.classes.has('mindmap-view-switching')).toBe(false);
	});
});
