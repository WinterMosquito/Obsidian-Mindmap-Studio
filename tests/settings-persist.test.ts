/**
 * 设置持久化（data.json 写路径）性能回归测试（main.ts / persistence.ts）。
 *
 * 锁定两项优化行为：
 * - 滑块等高频控件防抖：settings 面板逐档触发 scheduleSettingsPersist，
 *   写盘在防抖窗口内合并为一次（此前逐档「整文件重读+重写」突发）；
 * - saveSettings 只写设置键：viewState 由其自身回调合并落盘，设置变更
 *   不携带全量视图状态快照（写前重读合并保证磁盘既有 viewState 不丢）；
 * - 卸载冲刷：onunload 时防抖有挂起则立即落盘（尽力语义，不等待）。
 *
 * 直接实例化 MindMapStudioPlugin：字段初始化（dataWriter/viewState/statusBar）
 * 不依赖 app；loadData/saveData 由测试覆写为内存「磁盘」以观测写盘次数。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MindMapStudioPlugin from '../src/main';
import { DEFAULT_SETTINGS } from '../src/settings';

// main 导入链经 features/view → mindmap 触发 vendor 顶层 document 求值
// （与 feature-helpers.test.ts 同款最小桩）
vi.hoisted(() => {
	(globalThis as { document?: unknown }).document ??= { documentElement: {} };
});

interface PluginStub extends MindMapStudioPlugin {
	loadData: () => Promise<Record<string, unknown>>;
	saveData: (data: unknown) => Promise<void>;
	readonly saved: unknown[];
}

/** 插件桩：内存「磁盘」记录每次 saveData 落下的内容快照 */
function makePlugin(): PluginStub {
	// 真实 obsidian.d.ts 的 Plugin 构造签名要求 (app, manifest)——
	// 本测试不触碰宿主，桩参按项目惯例 `as never` 传入
	const plugin = new MindMapStudioPlugin(
		null as never,
		null as never,
	) as PluginStub;
	const disk: Record<string, unknown> = {};
	const saved: unknown[] = [];
	let failSave = false;
	const stub = plugin as unknown as {
		loadData: () => Promise<Record<string, unknown>>;
		saveData: (data: unknown) => Promise<void>;
		saved: unknown[];
	};
	stub.loadData = async () => {
		if (failSave) {
			throw new Error('disk unavailable');
		}
		return { ...disk };
	};
	stub.saveData = async (data: unknown) => {
		if (failSave) {
			throw new Error('disk unavailable');
		}
		saved.push(data);
		Object.assign(disk, data as Record<string, unknown>);
	};
	stub.saved = saved;
	return plugin;
}

describe('设置持久化（data.json 写路径）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('滑块突发合并：逐档触发 N 次只落盘一次', async () => {
		const plugin = makePlugin();
		plugin.settings = { ...DEFAULT_SETTINGS };
		// 模拟滑块 100→2000（step 100）共 19 档触发
		for (let i = 0; i < 19; i++) {
			plugin.scheduleSettingsPersist();
		}
		// 防抖窗口内不写盘
		await vi.advanceTimersByTimeAsync(399);
		expect(plugin.saved).toHaveLength(0);
		// 窗口结束：合并为一次
		await vi.advanceTimersByTimeAsync(1);
		expect(plugin.saved).toHaveLength(1);
	});

	it('落盘内容为设置键本身；磁盘既有 viewState 不被携带或破坏', async () => {
		const plugin = makePlugin();
		plugin.settings = { ...DEFAULT_SETTINGS, language: 'en' };
		// 预置磁盘上的既有 viewState（另一调用方负责维护）
		await plugin.saveData({
			viewState: { 'a.mindmap.md': { layout: 'mindMap' } },
		});
		plugin.saved.length = 0;
		await plugin.saveSettings();
		const written = plugin.saved[0] as Record<string, unknown>;
		expect(written['language']).toBe('en');
		expect(written['autoSave']).toBe(true);
		// 载荷不含 viewState 快照（不再序列化全量视图状态）；
		// 写前重读合并保证磁盘既有 viewState 原样保留（不被空快照覆盖）
		expect(written['viewState']).toEqual({
			'a.mindmap.md': { layout: 'mindMap' },
		});
	});

	it('onunload 冲刷：防抖挂起的设置变更立即落盘', async () => {
		const plugin = makePlugin();
		plugin.settings = { ...DEFAULT_SETTINGS };
		plugin.scheduleSettingsPersist();
		// 未到防抖窗口即卸载：挂起变更立即写盘（异步链，冲刷微任务后断言）
		plugin.onunload();
		await vi.advanceTimersByTimeAsync(0);
		expect(plugin.saved).toHaveLength(1);
		// 卸载后再推进时间不重复落盘（防抖已取消）
		await vi.advanceTimersByTimeAsync(1000);
		expect(plugin.saved).toHaveLength(1);
	});

	it('无挂起时 onunload 不产生多余写盘', () => {
		const plugin = makePlugin();
		plugin.settings = { ...DEFAULT_SETTINGS };
		plugin.onunload();
		expect(plugin.saved).toHaveLength(0);
	});
});
