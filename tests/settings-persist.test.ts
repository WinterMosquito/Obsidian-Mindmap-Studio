/**
 * 设置写回持久化回归（main.ts 的 scheduleSettingsPersist / saveSettings / onunload）。
 *
 * 设置面板的滑块逐档调用 setControlValue → scheduleSettingsPersist；若逐次
 * 「整文件重读+重写」，拖动一次就会形成串行写盘突发。这里锁定：
 * - 内存即时生效、磁盘写入按 SETTINGS_PERSIST_DEBOUNCE_MS 合并为一次；
 * - saveSettings 只写设置键，磁盘既有 viewState 经写前重读合并原样保留
 *   （不得被空快照/内存快照覆盖）；
 * - onunload 时挂起设置与未落盘视图状态都尽力冲刷（二者各走一次串行写盘，
 *   互不丢键）；无挂起时不产生多余写盘。
 *
 * 直接实例化 MindMapStudioPlugin：字段初始化（dataWriter/viewState/statusBar）
 * 不依赖 app，loadData/saveData 由测试覆写为内存「磁盘」以观测写盘次数与载荷。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MindMapStudioPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/settings';
import {
	SETTINGS_PERSIST_DEBOUNCE_MS,
	VIEW_STATE_PERSIST_MS,
} from '../src/constants';

// main 的导入链（features/view → mindmap）在模块顶层触碰 document，
// Node 环境需最小桩；vi.hoisted 保证桩早于 import 求值建立。
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

const PATH_A = 'notes/a.mindmap.md';
const PATH_B = 'notes/b.mindmap.md';

interface Harness {
	plugin: MindMapStudioPlugin;
	/** 内存 data.json */
	disk: Record<string, unknown>;
	/** 每次 saveData 落下的载荷（按序） */
	saved: Record<string, unknown>[];
	/** 故障注入：模拟磁盘不可用 */
	state: { fail: boolean };
}

function makeHarness(initialDisk: Record<string, unknown> = {}): Harness {
	// 真实 obsidian.d.ts 要求 (app, manifest)：本测试不触碰宿主，桩参按项目惯例传入
	const plugin = new MindMapStudioPlugin(null as never, null as never);
	const disk: Record<string, unknown> = { ...initialDisk };
	const saved: Record<string, unknown>[] = [];
	const state = { fail: false };
	const stub = plugin as unknown as {
		loadData: () => Promise<Record<string, unknown>>;
		saveData: (data: unknown) => Promise<void>;
	};
	stub.loadData = async () => {
		if (state.fail) {
			throw new Error('disk unavailable');
		}
		// 与真实实现一致：返回新对象，避免调用方 delete 掉"盘"上的键
		return { ...disk };
	};
	stub.saveData = async (data: unknown) => {
		if (state.fail) {
			throw new Error('disk unavailable');
		}
		const payload = data as Record<string, unknown>;
		saved.push(payload);
		Object.assign(disk, payload);
	};
	return { plugin, disk, saved, state };
}

async function flushMicrotasks(times = 8): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

describe('scheduleSettingsPersist（滑块突发合并）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('19 档滑块突发（跨越多窗口）只落盘一次，载荷为最后一档', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();

		// 模拟滑块 100→1900（step 100）：每档 40ms，总跨度 720ms > 一个窗口
		for (let i = 0; i < 19; i++) {
			h.plugin.settings.performanceThreshold = 100 + i * 100;
			h.plugin.scheduleSettingsPersist();
			if (i < 18) {
				await vi.advanceTimersByTimeAsync(40);
			}
		}
		// 跨度已超窗口：若未重置计时，首次调度早在 400ms 时就已落盘
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS - 1);
		expect(h.saved).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(1);
		expect(h.saved).toHaveLength(1);
		expect(h.saved[0]?.['performanceThreshold']).toBe(1900);
		// 合并后的载荷就是内存设置本身（每个字段都在，无 undefined 空洞）
		expect(h.saved[0]).toEqual({ ...h.plugin.settings });
	});

	it('落盘载荷只含设置键：磁盘上没有 viewState 时不凭空造一个', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();
		await h.plugin.saveSettings();

		expect(h.saved).toHaveLength(1);
		expect(Object.keys(h.saved[0] ?? {}).sort()).toEqual(
			Object.keys(DEFAULT_SETTINGS).sort(),
		);
		// 设置写盘不携带视图状态快照（否则每次改设置都要序列化整个映射）
		expect('viewState' in (h.saved[0] ?? {})).toBe(false);
	});

	it('内存即时生效：窗口未到不写盘，但设置引用已是新值', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();

		h.plugin.settings.exportScale = 4;
		h.plugin.scheduleSettingsPersist();

		// 视图/导出经活引用读设置：无需等写盘
		expect(h.plugin.settings.exportScale).toBe(4);
		expect(h.saved).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);
		expect(h.saved).toHaveLength(1);
		expect(h.saved[0]?.['exportScale']).toBe(4);
	});

	it('同一窗口内多次变更只写一次，载荷取最后一次的值', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();

		h.plugin.settings.performanceThreshold = 400;
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(200);
		h.plugin.settings.performanceThreshold = 900;
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(200);
		expect(h.saved).toHaveLength(0); // 第二次调度重置了窗口

		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);
		expect(h.saved).toHaveLength(1);
		expect(h.saved[0]?.['performanceThreshold']).toBe(900);
	});

	it('落盘一次后不再重复写盘（防抖定时器不残留）', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();

		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);
		expect(h.saved).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS * 10);
		expect(h.saved).toHaveLength(1);
	});

	it('跨窗口的两次变更各自落盘，载荷快照互不改写', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();

		h.plugin.settings.language = 'zh';
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);

		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);

		expect(h.saved).toHaveLength(2);
		expect(h.saved[0]?.['language']).toBe('zh');
		expect(h.saved[1]?.['language']).toBe('en');
		// 载荷是各自时刻的独立对象：第一次的不会被后来的变更回头改写
		expect(h.saved[0]).not.toBe(h.saved[1]);
	});

	it('磁盘既有 viewState 经写前重读合并原样保留，不被设置写盘抹掉', async () => {
		const h = makeHarness({
			viewState: { [PATH_A]: { layout: 'mindMap' } },
			language: 'zh',
		});
		await h.plugin.loadSettings();
		// 加载路径也把视图状态装进了内存映射
		expect(h.plugin.viewState.getLayout(PATH_A)).toBe('mindMap');

		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);

		expect(h.saved[0]?.['language']).toBe('en');
		// 设置写盘只带设置键，磁盘上的 viewState 靠重读合并保留
		expect(h.saved[0]?.['viewState']).toEqual({
			[PATH_A]: { layout: 'mindMap' },
		});
		expect(h.disk['viewState']).toEqual({
			[PATH_A]: { layout: 'mindMap' },
		});
	});

	it('设置写盘不携带内存 viewState 快照：视图状态由自身防抖随后合并落盘', async () => {
		const h = makeHarness({
			viewState: { [PATH_A]: { layout: 'mindMap' } },
		});
		await h.plugin.loadSettings();

		// 内存即时生效的新布局（尚未到 VIEW_STATE_PERSIST_MS 窗口）
		h.plugin.viewState.setLayout(PATH_A, 'fishbone');
		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();

		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS);
		// 设置先落盘：此刻磁盘上的仍是被保留的旧布局（本轮只写设置键）
		expect(h.disk['language']).toBe('en');
		expect(h.disk['viewState']).toEqual({
			[PATH_A]: { layout: 'mindMap' },
		});

		await vi.advanceTimersByTimeAsync(VIEW_STATE_PERSIST_MS);
		// 视图状态窗口到点后自身落盘：新布局写入，且设置键不被抹掉（重读合并）
		expect(h.disk['viewState']).toEqual({
			[PATH_A]: { layout: 'fishbone' },
		});
		expect(h.disk['language']).toBe('en');
	});

	it('加载时坏值经 sanitize 回退，写回后仍只有合法取值', async () => {
		const h = makeHarness({
			language: 'fr',
			exportScale: 'abc',
			performanceThreshold: 99_999,
		});
		await h.plugin.loadSettings();

		expect(h.plugin.settings.language).toBe(DEFAULT_SETTINGS.language);
		expect(h.plugin.settings.exportScale).toBe(DEFAULT_SETTINGS.exportScale);
		expect(h.plugin.settings.performanceThreshold).toBe(2000);

		await h.plugin.saveSettings();
		expect(h.saved[0]?.['language']).toBe('zh');
		expect(h.saved[0]?.['exportScale']).toBe(DEFAULT_SETTINGS.exportScale);
		expect(h.saved[0]?.['performanceThreshold']).toBe(2000);
	});
});

describe('onunload 冲刷', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('防抖挂起时立即落盘一次，此后推进时间不重复落盘', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();
		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();
		await vi.advanceTimersByTimeAsync(100); // 未到窗口即卸载

		h.plugin.onunload();
		await flushMicrotasks();

		expect(h.saved).toHaveLength(1);
		expect(h.saved[0]?.['language']).toBe('en');

		// 防抖已取消：卸载后时间推进不再触发写盘
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS * 5);
		expect(h.saved).toHaveLength(1);
	});

	it('无挂起变更时不产生多余写盘', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();

		h.plugin.onunload();
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(SETTINGS_PERSIST_DEBOUNCE_MS * 2);

		expect(h.saved).toHaveLength(0);
	});

	it('同时冲刷设置与未落盘视图状态：两次串行写盘，磁盘两类数据都保住', async () => {
		const h = makeHarness({
			viewState: { [PATH_A]: { layout: 'mindMap' } },
			language: 'zh',
		});
		await h.plugin.loadSettings();

		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();
		h.plugin.viewState.setOpenAs(PATH_B, 'markdown'); // 视图状态同样挂起

		h.plugin.onunload();
		await flushMicrotasks();

		// 视图状态排空 + 设置落盘各一次；两者经写前重读合并，先写的键不被后写抹掉
		expect(h.saved).toHaveLength(2);
		expect(h.disk['language']).toBe('en');
		expect(h.disk['viewState']).toEqual({
			[PATH_A]: { layout: 'mindMap' },
			[PATH_B]: { openAs: 'markdown' },
		});
	});

	it('写盘失败（磁盘不可用）不抛出、不阻断后续落盘', async () => {
		const h = makeHarness();
		await h.plugin.loadSettings();
		h.state.fail = true;

		h.plugin.settings.language = 'en';
		h.plugin.scheduleSettingsPersist();
		h.plugin.onunload();
		await flushMicrotasks();

		// PluginDataWriter 内部吞错（onError → notifyError），不产生未处理拒绝
		expect(h.saved).toHaveLength(0);
		expect(h.disk['language']).toBeUndefined();

		// 磁盘恢复后仍能正常落盘
		h.state.fail = false;
		await h.plugin.saveSettings();
		expect(h.saved).toHaveLength(1);
		expect(h.saved[0]?.['language']).toBe('en');
	});
});
