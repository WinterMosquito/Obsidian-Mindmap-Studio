/**
 * 声明驱动自动打开回归（platform/mindmap-auto-open.ts）。
 *
 * 三条入口：
 * - `file-open`（互补兜底）→ `activateDeclaredLeaves` 全叶子扫描；
 * - `active-leaf-change`（运行期主路径，携带已激活 leaf）→ `autoSwitch` 单叶判定
 *   （不扫描：file-open 时序上活动视图可能尚未切到 markdown，会漏判）；
 * - `scheduleStartupRestore`（启动/布局就绪）→ 多档延时（默认 400/1500/3500ms）
 *   反复扫描，覆盖「叶子先建 markdown 视图、稍后才绑定文件」的异步恢复窗口。
 *   `activateDeclaredLeaves` 也是组合根 `metadataCache.on('changed')` 的入口
 *   （属性被就地加上时补判），故该方法是公开的。
 *
 * 判据本身（frontmatter 的 `Mindmap`）由组合根注入，本套件用「声明集合」桩
 * 代替——那样判据回归在 tests/md-frontmatter-trigger.test.ts 单独锁定，两边互不
 * 耦合。
 *
 * 为什么延时用例必须用 fake timers 断言**每一档的精确毫秒**：三档的作用就是
 * 「早/中/晚各试一次」，多一档会重复切换（用户可见的视图抖动）、少一档则
 * 启动恢复在慢机器上失效——只断言「最终切换了」会把档位丢失掩盖掉。
 *
 * 关于「陈旧回调」的防线（当前实现方式）：本模块**没有代为数/代际锁**，而是
 * - 每档回调触发时才读取当前叶子集合与当前声明（决策不缓存）；
 * - 切换成功后该叶子不再是 markdown 叶子，后续档位扫描自然空转（幂等）；
 * - 插件卸载经宿主 `Component.register` 清理未触发的定时器。
 * 故用例按「后档重读最新状态、重复调度会叠加不取代」这一真实行为断言（见文末）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, TFile } from 'obsidian';
import {
	AUTO_OPEN_SCAN_DEBOUNCE_MS,
	CORE_VIEW_TYPE,
	VIEW_TYPE,
} from '../src/core/constants';
import { MindMapAutoOpener } from '../src/platform/mindmap-auto-open';

/** openAsMindMap 的 spy（vi.hoisted 保证先于 mock 工厂可用） */
const openAsMindMapMock = vi.hoisted(() =>
	vi.fn<(...args: unknown[]) => Promise<void>>(),
);

vi.mock('../src/markdown/md-open', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../src/markdown/md-open')>();
	// 仅替换视图切换（副作用单测目标）；其余导出保持真实实现
	return { ...mod, openAsMindMap: openAsMindMapMock };
});

/** TFile 桩（判据由注入的谓词决定，路径即身份） */
function fakeFile(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: path.endsWith('.md') ? 'md' : 'png',
	});
}

/** MarkdownView 桩：instanceof 判定与插件运行时同源，file 由用例注入 */
function markdownViewWith(fields: Record<string, unknown>): MarkdownView {
	return Object.assign(new MarkdownView(null as never), fields);
}

interface OpenerHarness {
	opener: MindMapAutoOpener;
	/** 注册运行期事件（等价插件 onload 的 opener.register(this)） */
	register(): void;
	/** 直接触发全叶子扫描（file-open 与 metadataCache changed 的共同入口） */
	activate(): void;
	/** 触发 file-open（回调恒不带参数） */
	fireFileOpen(): void;
	/** 触发 active-leaf-change */
	fireLeafChange(leaf: unknown): void;
	setLeaves(leaves: unknown[]): void;
	/** 设置某路径是否为「声明为导图」 */
	setDeclared(path: string, declared: boolean): void;
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
	declaredPaths: readonly string[] = [],
): OpenerHarness {
	const declared = new Set<string>(declaredPaths);
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
	const opener = new MindMapAutoOpener(
		workspace as never,
		(file) => declared.has(file.path),
		// 本插件视图判定（main.ts 注入 `view instanceof MindMapView`）；桩用 own 标记
		(view: unknown) => Boolean(view && (view as { own?: boolean }).own),
	);
	const host = makeComponent();
	return {
		opener,
		register(): void {
			opener.register(host.component as never);
		},
		activate(): void {
			opener.activateDeclaredLeaves();
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
		setDeclared: (path, value): void => {
			if (value) {
				declared.add(path);
			} else {
				declared.delete(path);
			}
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

	it('file-open：扫描 markdown 叶子，声明为导图的文件切到导图视图（经合并窗口落地）', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		const file = fakeFile('a.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.setLeaves([leaf]);
		harness.register();

		harness.fireFileOpen();

		// 合并窗口内不立即扫描：file-open 会连发（启动恢复逐叶开文件、批量开标签），
		// 每次全量扫描都要遍历全部 markdown 叶子 + 逐叶读 frontmatter 判据
		expect(openAsMindMapMock).not.toHaveBeenCalled();
		expect(harness.queriedTypes).toEqual([]);

		vi.advanceTimersByTime(AUTO_OPEN_SCAN_DEBOUNCE_MS);

		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
		// 只查询 markdown 类型叶子（导图叶子无需恢复）
		expect(harness.queriedTypes).toEqual([CORE_VIEW_TYPE.MARKDOWN]);
		expect(CORE_VIEW_TYPE.MARKDOWN).toBe('markdown');
		// 目标视图类型为插件导图视图
		expect(VIEW_TYPE).toBe('mindmap-view');
	});

	it('activateDeclaredLeaves（metadataCache changed 入口）与 file-open 同一扫描', () => {
		const harness = setupHarness(['a.md']);
		const file = fakeFile('a.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.setLeaves([leaf]);

		harness.activate();

		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
	});

	it('file-open：多叶子中只切换声明的那些（其余原样保留）', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md', 'c.md']);
		const fileA = fakeFile('a.md');
		const fileC = fakeFile('c.md');
		const leafA = { view: markdownViewWith({ file: fileA }) };
		const leafB = { view: markdownViewWith({ file: fakeFile('b.md') }) }; // 未声明
		const leafC = { view: markdownViewWith({ file: fileC }) };
		harness.setLeaves([leafA, leafB, leafC]);
		harness.register();

		harness.fireFileOpen();
		vi.advanceTimersByTime(AUTO_OPEN_SCAN_DEBOUNCE_MS);

		expect(openAsMindMapMock.mock.calls).toEqual([
			[leafA, fileA],
			[leafC, fileC],
		]);
	});

	it('file-open：跳过矩阵（未声明 / 视图不符 / 无文件）', async () => {
		vi.useFakeTimers();
		const harness = setupHarness(['b.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('note.md') }) }, // 未声明
			{ view: {} }, // 非 MarkdownView 实例
			{ view: markdownViewWith({ file: null }) }, // 无文件
			{ view: markdownViewWith({ file: fakeFile('weird.txt') }) }, // 非 md 扩展名（判据已排除）
		]);
		harness.register();

		harness.fireFileOpen();
		vi.advanceTimersByTime(AUTO_OPEN_SCAN_DEBOUNCE_MS);
		await Promise.resolve();

		// 扫描确实落地（否则本用例会在「根本没扫」的情况下通过）
		expect(harness.queriedTypes).toEqual([CORE_VIEW_TYPE.MARKDOWN]);
		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});

	it('切换失败被捕获并记录（不产生未处理拒绝）', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const harness = setupHarness(['a.md']);
		const file = fakeFile('a.md');
		harness.setLeaves([{ view: markdownViewWith({ file }) }]);
		harness.register();
		openAsMindMapMock.mockRejectedValueOnce(new Error('leaf gone'));

		harness.fireFileOpen();
		await vi.waitFor(() => {
			expect(errorSpy).toHaveBeenCalled();
		});

		// 前缀标识来源 + 文件路径（便于用户报告问题时定位）
		expect(errorSpy.mock.calls[0]?.[0]).toBe('自动切换思维导图视图失败:');
		expect(errorSpy.mock.calls[0]?.[1]).toBe('a.md');
	});
});

describe('active-leaf-change 自动切换（单叶判定，不做全量扫描）', () => {
	it('激活的 markdown 视图文件已声明 → 切换该 leaf', () => {
		const harness = setupHarness(['a.md']);
		const file = fakeFile('a.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.register();

		harness.fireLeafChange(leaf);

		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		expect(openAsMindMapMock).toHaveBeenCalledWith(leaf, file);
		// 走 autoSwitch 而非全量扫描：没有 getLeavesOfType 调用
		expect(harness.queriedTypes).toEqual([]);
	});

	it('跳过矩阵：本插件视图 / 空 leaf / 非 MarkdownView / 无文件 / 未声明', () => {
		const harness = setupHarness(['a.md']);
		harness.register();

		harness.fireLeafChange({ view: markdownViewWith({ own: true, file: fakeFile('a.md') }) });
		harness.fireLeafChange(undefined);
		harness.fireLeafChange({ view: {} });
		harness.fireLeafChange({ view: markdownViewWith({ file: null }) });
		harness.fireLeafChange({ view: markdownViewWith({ file: fakeFile('note.md') }) });

		// 已是本插件视图时不重启视图（导图标签内切换文件不该重开）
		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});
});

describe('scheduleStartupRestore（启动多档延时）', () => {
	it('默认三档 400 / 1500 / 3500ms：每档精确触发一次全量扫描', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		const file = fakeFile('a.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.setLeaves([leaf]);
		harness.register();

		harness.opener.scheduleStartupRestore();
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
		const harness = setupHarness(['a.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.md') }) },
		]);
		harness.register();

		harness.opener.scheduleStartupRestore([100, 250]);
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(99); // t = 199
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(51); // t = 250
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);
		// 默认档位（400/1500/3500）未被注册
		vi.advanceTimersByTime(10_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);

		harness.opener.scheduleStartupRestore([50]);
		vi.advanceTimersByTime(50);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);
		vi.advanceTimersByTime(10_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(3);
	});

	it('插件卸载（宿主清理回调）后：未触发的档位不再扫描视图', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.md') }) },
		]);
		harness.register();
		harness.opener.scheduleStartupRestore();

		vi.advanceTimersByTime(400); // 早档已触发
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 卸载插件：随宿主组件注销清理未触发的定时器
		harness.unloadHost();
		vi.advanceTimersByTime(60_000);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
	});

	it('未 register（无宿主组件）时仍按档扫描且不抛异常', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.md') }) },
		]);
		// 不调用 register：host 为 null（可选链跳过清理登记）
		expect(() => harness.opener.scheduleStartupRestore([100])).not.toThrow();
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
	});

	it('后档触发时重读最新叶子集合与声明：陈旧档位不覆盖新状态', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		const leaf = { view: markdownViewWith({ file: fakeFile('a.md') }) };
		harness.setLeaves([leaf]);
		harness.register();
		harness.opener.scheduleStartupRestore();

		vi.advanceTimersByTime(400); // 早档：切换到导图视图
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 切换完成后该叶子不再是 markdown 叶子（视图类型已变）→ 中/晚档空转
		harness.setLeaves([]);
		vi.advanceTimersByTime(3100); // t = 3500，中档与晚档都已触发
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 用户通过「以 Markdown 打开」把属性降级（声明消失）→ 晚档按最新声明跳过
		harness.setLeaves([leaf]);
		harness.setDeclared('a.md', false);
		harness.opener.scheduleStartupRestore([100]);
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);
	});

	it('重复调度会叠加（无代际锁）：调用两次即两组定时器各自扫描', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.md') }) },
		]);
		harness.register();

		// 每次调用都新注册一组 setTimeout，不取消上一组（故调用方须保证只调一次：
		// main.ts 在 onLayoutReady 里调用一次）——此处按实现断言该边界。
		harness.opener.scheduleStartupRestore([100]);
		harness.opener.scheduleStartupRestore([100]);
		vi.advanceTimersByTime(100);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(2);
	});
});

describe('file-open 防抖（scheduleDeclaredLeavesScan，2026-10-15）', () => {
	it('连发只落地一次扫描（queriedTypes 只增一条）', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		const file = fakeFile('a.md');
		const leaf = { view: markdownViewWith({ file }) };
		harness.setLeaves([leaf]);
		harness.register();

		// 启动恢复逐叶开文件 / 批量开标签 / 同步回写都会连发 file-open
		harness.fireFileOpen();
		harness.fireFileOpen();
		harness.fireFileOpen();
		expect(harness.queriedTypes).toEqual([]);

		vi.advanceTimersByTime(AUTO_OPEN_SCAN_DEBOUNCE_MS);

		expect(harness.queriedTypes).toEqual([CORE_VIEW_TYPE.MARKDOWN]);
		expect(openAsMindMapMock).toHaveBeenCalledTimes(1);

		// 窗口过后新触发照常调度（不是「只扫一次」的一次性闸门）
		harness.fireFileOpen();
		vi.advanceTimersByTime(AUTO_OPEN_SCAN_DEBOUNCE_MS);
		expect(harness.queriedTypes).toEqual([
			CORE_VIEW_TYPE.MARKDOWN,
			CORE_VIEW_TYPE.MARKDOWN,
		]);
	});

	it('突发跨越窗口仍只落地一次（每次触发重置窗口——这是防抖而非节流）', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.md') }) },
		]);
		harness.register();

		// 每 30ms 连发一次、持续 300ms：节流实现会按窗口数各扫一遍（≥5 次），
		// 防抖实现只在最后一次触发后一个窗口扫一次
		for (let i = 0; i < 10; i += 1) {
			harness.fireFileOpen();
			vi.advanceTimersByTime(30);
		}
		expect(harness.queriedTypes).toEqual([]);

		vi.advanceTimersByTime(AUTO_OPEN_SCAN_DEBOUNCE_MS);
		expect(harness.queriedTypes).toEqual([CORE_VIEW_TYPE.MARKDOWN]);
	});

	it('卸载（宿主清理回调）后：未决的扫描不再触发', () => {
		vi.useFakeTimers();
		const harness = setupHarness(['a.md']);
		harness.setLeaves([
			{ view: markdownViewWith({ file: fakeFile('a.md') }) },
		]);
		harness.register();

		harness.fireFileOpen();
		harness.unloadHost();
		// 清理回调可被多次执行（幂等）：第二次卸载不应抛
		harness.unloadHost();
		vi.advanceTimersByTime(60_000);

		expect(harness.queriedTypes).toEqual([]);
		expect(openAsMindMapMock).not.toHaveBeenCalled();
	});
});
