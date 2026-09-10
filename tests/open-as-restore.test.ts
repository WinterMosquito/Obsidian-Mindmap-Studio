/**
 * 「以思维导图打开」偏好恢复器回归（open-as-restore.ts）。
 *
 * 三条入口：
 * - `file-open`（互补兜底）→ `restoreMarkdownLeaves` 全叶子扫描；
 * - `active-leaf-change`（运行期主路径，携带已激活 leaf）→ `autoSwitch` 单叶判定
 *   （不扫描：file-open 时序上活动视图可能尚未切到 markdown，会漏判）；
 * - `scheduleStartupRestore`（启动/布局就绪）→ 多档延时（默认 400/1500/3500ms）
 *   反复扫描，覆盖「叶子先建 markdown 视图、稍后才绑定文件」的异步恢复窗口。
 *
 * 为什么延时用例必须用 fake timers 断言**每一档的精确毫秒**：三档的作用就是
 * 「早/中/晚各试一次」，多一档会重复切换（用户可见的视图抖动）、少一档则
 * 启动恢复在慢机器上失效——只断言「最终切换了」会把档位丢失掩盖掉。
 *
 * 关于「陈旧回调」的防线（当前实现方式）：本模块**没有代为数/代际锁**，而是
 * - 每档回调触发时才读取当前叶子集合与当前 openAs 偏好（决策不缓存）；
 * - 切换成功后该叶子不再是 markdown 叶子，后续档位扫描自然空转（幂等）；
 * - 插件卸载经宿主 `Component.register` 清理未触发的定时器。
 * 故用例按「后档重读最新状态、重复调度会叠加不取代」这一真实行为断言（见文末）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, MarkdownView, TFile } from 'obsidian';
import { CORE_VIEW_TYPE, VIEW_TYPE } from '../src/constants';
import { OpenAsPreferenceRestorer } from '../src/open-as-restore';

/** openAsMindMap 的 spy（vi.hoisted 保证先于 mock 工厂可用） */
const openAsMindMapMock = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);

vi.mock('../src/md-open', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../src/md-open')>();
	// 仅替换视图切换（副作用单测目标）；isMindMapMarkdownFile 用真实实现，
	// 保证「.mindmap.md 判定」这条分支与插件运行时同源。
	return { ...mod, openAsMindMap: openAsMindMapMock };
});

/** TFile 桩：extension 与 path 分离，用于验证 isMindMapMarkdownFile 的合取条件 */
function fakeFile(path: string, extension?: string): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: extension ?? (path.endsWith('.md') ? 'md' : 'png'),
	});
}

/** MarkdownView 桩：instanceof 判定与插件运行时同源，file 由用例注入 */
function markdownViewWith(fields: Record<string, unknown>): MarkdownView {
	return Object.assign(new MarkdownView(null as never), fields);
}

interface RestorerHarness {
	restorer: OpenAsPreferenceRestorer;
	/** 注册运行期事件（等价插件 onload 的 restorer.register(this)） */
	register(): void;
	/** 触发 file-open（回调恒不带参数） */
	fireFileOpen(): void;
	/** 触发 active-leaf-change */
	fireLeafChange(leaf: unknown): void;
	setLeaves(leaves: unknown[]): void;
	setOpenAs(path: string, value: 'mindmap' | 'markdown' | undefined): void;
	/** getLeavesOfType 收到的视图类型（验证只查 markdown 叶子） */
	queriedTypes: string[];
	/** 经 Component.registerEvent 登记的事件引用 */
	registeredEvents: unknown[];
	/** 模拟插件卸载：执行 Component.register 登记的清理回调 */
	unloadHost(): void;
}

/** 宿主组件桩（插件 Plugin 即 Component）：记录事件与清理回调 */
function makeComponent() {
	const cleanups: (() => void)[] = [];
	const registeredEvents: unknown[] = [];
	return {
		registeredEvents,
		component: {
			registerEvent: (event: unknown): void => {
				registeredEvents.push(event);
			},
			register: (cleanup: () => void): () => void => {
				cleanups.push(cleanup);
				return cleanup;
			},
		},
		unloadHost: (): void => {
			for (const cleanup of cleanups) {
				cleanup();
			}
		},
	};
}

function setupHarness(
	openAsMap: Record<string, 'mindmap' | 'markdown' | undefined> = {},
): RestorerHarness {
	const fileOpenCallbacks: (() => void)[] = [];
	const leafChangeCallbacks: ((leaf?: unknown) => void)[] = [];
	const queriedTypes: string[] = [];
	let leaves: unknown[] = [];
	const workspace = {
		on: (name: string, callback: (...args: unknown[]) => void): unknown => {
			if (name === 'file-open') {
				fileOpenCallbacks.push(() => callback());
			} else if (name === 'active-leaf-change') {
				leafChangeCallbacks.push((leaf) => callback(leaf));
			}
			return { name };
		},
		getLeavesOfType: (type: string): unknown[] => {
			queriedTypes.push(type);
			return leaves;
		},
	};
	const restorer = new OpenAsPreferenceRestorer(
		new App(),
		workspace as never,
		{ getOpenAs: (path: string) => openAsMap[path] },
		// 本插件视图判定（main.ts 注入 `view instanceof MindMapView`）；桩用 own 标记
		(view: unknown) => Boolean(view && (view as { own?: boolean }).own),
	);
	const host = makeComponent();
	return {
		restorer,
		register(): void {
			restorer.register(host.component as never);
		},
		fireFileOpen: (): void => {
			for (const callback of fileOpenCallbacks) {
				callback();
			}
		},
		fireLeafChange: (leaf: unknown): void => {
			for (const callback of leafChangeCallbacks) {
				callback(leaf);
			}
		},
		setLeaves: (next: unknown[]): void => {
			leaves = next;
		},
		setOpenAs: (path, value): void => {
			openAsMap[path] = value;
		},
		queriedTypes,
		registeredEvents: host.registeredEvents,
		unloadHost: host.unloadHost,
	};
}

beforeEach(() => {
	openAsMindMapMock.mockReset();
	openAsMindMapMock.mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('register（运行期事件接线）', () => {
	it('登记两个工作区事件：file-open（兜底）与 active-leaf-change（主路径）', () => {
		const harness = setupHarness();
		harness.register();
		expect(harness.registeredEvents).toEqual([
			{ name: 'file-open' },
			{ name: 'active-leaf-change' },
		]);
	});

	it('file-open：扫描 markdown 叶子，偏好为 mindmap 的 .mindmap.md 切回导图视图', () => {
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const file = fakeFile('a.mindmap.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.setLeaves([leaf]);
		harness.register();

		harness.fireFileOpen();

		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
		// 只查询 markdown 类型叶子（导图叶子无需恢复）
		expect(harness.queriedTypes).toEqual([CORE_VIEW_TYPE.MARKDOWN]);
		expect(CORE_VIEW_TYPE.MARKDOWN).toBe('markdown');
		// 目标视图类型为插件导图视图
		expect(VIEW_TYPE).toBe('mindmap-view');
	});

	it('file-open：多叶子中只切换命中的那些（其余原样保留）', () => {
		const harness = setupHarness({
			'a.mindmap.md': 'mindmap',
			'c.mindmap.md': 'mindmap',
			'd.mindmap.md': 'markdown',
		});
		const fileA = fakeFile('a.mindmap.md');
		const fileC = fakeFile('c.mindmap.md');
		const leafA = { view: markdownViewWith({ file: fileA }) };
		const leafB = { view: markdownViewWith({ file: fakeFile('b.mindmap.md') }) }; // 无偏好记录
		const leafC = { view: markdownViewWith({ file: fileC }) };
		const leafD = { view: markdownViewWith({ file: fakeFile('d.mindmap.md') }) }; // 偏好 markdown
		harness.setLeaves([leafA, leafB, leafC, leafD]);
		harness.register();

		harness.fireFileOpen();

		expect(openAsMindMapMock.mock.calls).toEqual([
			[leafA, fileA],
			[leafC, fileC],
		]);
	});

	it('file-open：跳过矩阵（非 .mindmap.md / 偏好非 mindmap / 视图不符 / 无文件）', async () => {
		const harness = setupHarness({
			'note.md': 'mindmap', // 非 .mindmap.md
			'b.mindmap.md': 'markdown', // 偏好不是 mindmap
			'weird.mindmap.md': 'mindmap', // 命中后缀但扩展名非 md（合取条件第二项）
		});
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('note.md') }) },
			{ view: markdownViewWith({ file: fakeFile('b.mindmap.md') }) },
			{ view: markdownViewWith({ file: fakeFile('none.mindmap.md') }) }, // getOpenAs → undefined
			{ view: {} }, // 非 MarkdownView 实例
			{ view: markdownViewWith({ file: null }) }, // 无文件
			{ view: markdownViewWith({ file: fakeFile('weird.mindmap.md', 'txt') }) },
		]);
		harness.register();

		harness.fireFileOpen();
		await Promise.resolve();

		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});

	it('切换失败被捕获并记录（不产生未处理拒绝）', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const file = fakeFile('a.mindmap.md');
		harness.setLeaves([{ view: markdownViewWith({ file }) }]);
		harness.register();
		openAsMindMapMock.mockRejectedValueOnce(new Error('leaf gone'));

		harness.fireFileOpen();
		await vi.waitFor(() => {
			expect(errorSpy).toHaveBeenCalled();
		});

		// 前缀标识来源 + 文件路径（便于用户报告问题时定位）
		expect(errorSpy.mock.calls[0]?.[0]).toBe('自动切换思维导图视图失败:');
		expect(errorSpy.mock.calls[0]?.[1]).toBe('a.mindmap.md');
	});
});

describe('active-leaf-change 自动切换（单叶判定，不做全量扫描）', () => {
	it('激活的 markdown 视图文件匹配且偏好 mindmap → 切换该 leaf', () => {
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const file = fakeFile('a.mindmap.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.register();

		harness.fireLeafChange(leaf);

		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
		// 走 autoSwitch 而非 restoreMarkdownLeaves：没有 getLeavesOfType 扫描
		expect(harness.queriedTypes).toEqual([]);
	});

	it('跳过矩阵：本插件视图 / 空 leaf / 非 MarkdownView / 文件不符 / 偏好非 mindmap', () => {
		const harness = setupHarness({
			'a.mindmap.md': 'mindmap',
			'c.mindmap.md': 'markdown',
		});
		harness.register();

		harness.fireLeafChange({ view: markdownViewWith({ own: true, file: fakeFile('a.mindmap.md') }) });
		harness.fireLeafChange(undefined);
		harness.fireLeafChange({ view: {} });
		harness.fireLeafChange({ view: markdownViewWith({ file: null }) });
		harness.fireLeafChange({ view: markdownViewWith({ file: fakeFile('note.md') }) });
		harness.fireLeafChange({ view: markdownViewWith({ file: fakeFile('none.mindmap.md') }) });
		harness.fireLeafChange({ view: markdownViewWith({ file: fakeFile('c.mindmap.md') }) });

		// 已是本插件视图时不重启视图（导图标签内切换文件不该重开）
		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});
});

describe('scheduleStartupRestore（启动多档延时）', () => {
	it('默认三档 400 / 1500 / 3500ms：每档精确触发一次全量扫描', () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const file = fakeFile('a.mindmap.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.setLeaves([leaf]);
		harness.register();

		harness.restorer.scheduleStartupRestore();
		// 调度本身不立即扫描（Obsidian 恢复叶子是异步的）
		expect(openAsMindMapMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(399);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(0);
		vi.advanceTimersByTime(1); // t = 400（早）
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(1099); // t = 1499
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1); // t = 1500（中）
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(1999); // t = 3499
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(1); // t = 3500（晚）
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);

		// 只有三档：更晚不再扫描
		vi.advanceTimersByTime(60_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);

		// 三档都是同一次恢复（同一 leaf/file 参数）
		expect(openAsMindMapMock.mock.calls).toEqual([[leaf, file], [leaf, file], [leaf, file]]);
		expect(harness.queriedTypes).toEqual(['markdown', 'markdown', 'markdown']);
	});

	it('自定义档位按传入毫秒触发（含单档），默认档位不参与', () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) },
		]);
		harness.register();

		harness.restorer.scheduleStartupRestore([100, 250]);
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(99); // t = 199
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(51); // t = 250
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);
		// 默认档位（400/1500/3500）未被注册
		vi.advanceTimersByTime(10_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);

		harness.restorer.scheduleStartupRestore([50]);
		vi.advanceTimersByTime(50);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);
		vi.advanceTimersByTime(10_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);
	});

	it('插件卸载（宿主清理回调）后：未触发的档位不再扫描视图', () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) },
		]);
		harness.register();
		harness.restorer.scheduleStartupRestore();

		vi.advanceTimersByTime(400); // 早档已触发
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 卸载插件：随宿主组件注销清理未触发的定时器
		harness.unloadHost();
		vi.advanceTimersByTime(60_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
	});

	it('未 register（无宿主组件）时仍按档扫描且不抛异常', () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) },
		]);
		// 不调用 register：host 为 null（可选链跳过清理登记）
		expect(() => harness.restorer.scheduleStartupRestore([100])).not.toThrow();
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
	});

	it('后档触发时重读最新叶子集合与偏好：陈旧档位不覆盖新状态', () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		const leaf = { view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) };
		harness.setLeaves([leaf]);
		harness.register();
		harness.restorer.scheduleStartupRestore();

		vi.advanceTimersByTime(400); // 早档：切换到导图视图
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 切换完成后该叶子不再是 markdown 叶子（视图类型已变）→ 中/晚档空转
		harness.setLeaves([]);
		vi.advanceTimersByTime(3100); // t = 3500，中档与晚档都已触发
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 用户在晚档前改回 Markdown 且偏好已更新为 markdown → 晚档按最新偏好跳过
		harness.setLeaves([leaf]);
		harness.setOpenAs('a.mindmap.md', 'markdown');
		harness.restorer.scheduleStartupRestore([100]);
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
	});

	it('重复调度会叠加（无代际锁）：调用两次即两组定时器各自扫描', () => {
		vi.useFakeTimers();
		const harness = setupHarness({ 'a.mindmap.md': 'mindmap' });
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.mindmap.md') }) },
		]);
		harness.register();

		// 每次调用都新注册一组 setTimeout，不取消上一组（故调用方须保证只调一次：
		// main.ts 在 onLayoutReady 里调用一次）——此处按实现断言该边界。
		harness.restorer.scheduleStartupRestore([100]);
		harness.restorer.scheduleStartupRestore([100]);
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);
	});
});
