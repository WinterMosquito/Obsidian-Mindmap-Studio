/**
 * ViewStateStore 回归（src/services/view-state.ts）。
 *
 * 视口与三项外观偏好（连线 / 配色 / 边框）按文件路径存插件 data.json 的顶层
 * `viewState` 键（正文字节保持纯 Markdown）。这里锁定五条易回退的契约：
 * - hydrate 形状校验：只接受含已知字段的条目（lineStyle/palette/themeStyle/view），
 *   手改 data.json 或引擎升级后的畸形结构不得渗入；
 * - **逐文件布局已不在 data.json**（2026-10-29）：hydrate 剔除残留的 `layout` 键、
 *   只剩它的条目整条丢弃，并**告知调用方是否发生过清理**（组合根据此补一次写盘）；
 * - 写盘防抖：连续 patch 合并为一次 persist，且载荷是"当时"的快照
 *   （后续变更不得回头改写已交给写盘器的对象）；
 * - flushNow：取消未决防抖并立即写盘；persist 返回 Promise 时原样透传
 *   （卸载路径靠它持有在途写盘），无未决变更时返回 undefined。
 * - pruneMissingPaths：启动期剔除指向已删文件的键（运行期 `onDelete` 补不到
 *   插件未运行期间的删除），无残留时不写盘（避免每次启动都写一次 data.json）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	resolveFilePreferences,
	ViewStateStore,
} from '../src/services/view-state';
import { VIEW_STATE_PERSIST_MS } from '../src/core/constants';

const PATH_A = 'notes/a.mindmap.md';
const PATH_B = 'notes/b.mindmap.md';

async function flushMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

/** 引擎 `getTransformData()` 的真实形态（{transform, state}，state 含有限 scale/x/y） */
const VIEW = {
	transform: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
	state: { scale: 1, x: 0, y: 0 },
};

describe('ViewStateStore.hydrate（形状校验）', () => {
	beforeEach(() => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('接受完整 data.json 对象，读取顶层 viewState 下的已知字段条目', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				[PATH_A]: { palette: 'mint', view: VIEW },
				[PATH_B]: { lineStyle: 'curve' },
			},
			// 顶层设置键不属于视图状态
			language: 'zh',
			autoSave: true,
		});

		expect(store.getPalette(PATH_A)).toBe('mint');
		expect(store.getView(PATH_A)).toEqual(VIEW);
		expect(store.getLineStyle(PATH_B)).toBe('curve');
		// 设置键不进入视图状态映射
		expect(store.getPreference('language', 'palette')).toBeUndefined();
		expect(store.serialize()).toEqual({
			[PATH_A]: { palette: 'mint', view: VIEW },
			[PATH_B]: { lineStyle: 'curve' },
		});
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('view 不可恢复：只丢该字段，保留同条目的其它偏好', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				// state 缺失 / 非对象 / scale 非有限数：前两者会让
				// setTransformData 抛（Object.keys(undefined)），第三者恢复不出视口
				'missing-state.mindmap.md': {
					palette: 'mint',
					view: { transform: { scaleX: 1 } },
				},
				'scalar-state.mindmap.md': {
					palette: 'mint',
					view: { state: 'x' },
				},
				'array-state.mindmap.md': {
					palette: 'mint',
					view: { state: [] },
				},
				'nan-scale.mindmap.md': {
					lineStyle: 'curve',
					view: { state: { scale: Number.NaN, x: 0, y: 0 } },
				},
				'string-scale.mindmap.md': {
					palette: 'mint',
					view: { state: { scale: '1', x: 0, y: 0 } },
				},
			},
		});

		for (const path of [
			'missing-state.mindmap.md',
			'scalar-state.mindmap.md',
			'array-state.mindmap.md',
			'nan-scale.mindmap.md',
			'string-scale.mindmap.md',
		]) {
			expect(store.getView(path), `${path} 的视口应被丢弃`).toBeUndefined();
		}
		// 同条目的其它状态仍然生效
		expect(store.getPalette('missing-state.mindmap.md')).toBe('mint');
		expect(store.getPalette('scalar-state.mindmap.md')).toBe('mint');
		expect(store.getLineStyle('nan-scale.mindmap.md')).toBe('curve');
	});

	it('view 不可恢复且条目再无其它已知字段：整条丢弃（不落盘空壳）', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				'only-view.mindmap.md': { view: { state: 42 } },
			},
		});

		expect(store.getView('only-view.mindmap.md')).toBeUndefined();
		expect(store.serialize()).toEqual({});
	});

	it('丢弃不含已知字段的畸形条目与非对象条目', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				'junk.mindmap.md': { foo: 1 },
				'null.mindmap.md': null,
				'num.mindmap.md': 42,
				'str.mindmap.md': 'layout',
				[PATH_A]: { palette: 'forest' },
			},
		});

		expect(store.serialize()).toEqual({
			[PATH_A]: { palette: 'forest' },
		});
	});

	it('条目内字段类型仍由 getter 兜底：lineStyle 非字符串视为未设置', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { [PATH_A]: { lineStyle: 42 } } });
		// 条目本身有效（含 lineStyle 键）故被保留，但 getter 不返回非字符串
		expect(store.serialize()).toEqual({ [PATH_A]: { lineStyle: 42 } });
		expect(store.getLineStyle(PATH_A)).toBeUndefined();
	});

	it('非对象载荷与缺失 viewState 键均不加载任何状态', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { [PATH_A]: { palette: 'x' } } });

		store.hydrate(null);
		expect(store.serialize()).toEqual({});
		store.hydrate(undefined);
		store.hydrate('viewState');
		store.hydrate(42);
		store.hydrate([]);
		store.hydrate({ language: 'zh' });
		expect(store.serialize()).toEqual({});
		// 载荷本身不是"疑似子对象"，不该产生误报
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('viewState 键存在但不是对象时不加载', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: 'oops' });
		store.hydrate({ viewState: 42 });
		store.hydrate({ viewState: null });
		expect(store.serialize()).toEqual({});
	});

	it('误传单个视图状态对象（顶层带偏好键）时给出防御提示', () => {
		const store = new ViewStateStore(() => {});
		// 形如 { palette, view } 的单条状态被误当作完整 data.json：静默不加载
		// 会让"重启后视口丢失"极难定位，必须留可观测提示
		store.hydrate({ palette: 'mint', view: { transform: { scale: 1 } } });
		expect(store.serialize()).toEqual({});
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('疑似收到 viewState 子对象'),
		);
	});

	it('按路径为键的映射（不是完整 data.json）静默不加载，不误报提示', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ [PATH_A]: { palette: 'mint' } });
		expect(store.serialize()).toEqual({});
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('hydrate 幂等：重复载入先清空旧映射，不残留上一份数据', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { [PATH_A]: { palette: 'mint' } } });
		store.hydrate({ viewState: { [PATH_B]: { palette: 'amber' } } });

		expect(store.getPalette(PATH_A)).toBeUndefined();
		expect(store.getPalette(PATH_B)).toBe('amber');
		expect(store.serialize()).toEqual({ [PATH_B]: { palette: 'amber' } });
	});

	it('lineStyle 是已知字段：条目被接受，getter 只返回字符串', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				[PATH_A]: { lineStyle: 'direct' },
				[PATH_B]: { lineStyle: 7 },
			},
		});
		expect(store.getLineStyle(PATH_A)).toBe('direct');
		// 条目本身有效（含 lineStyle 键）故被保留，坏值由 getter 兜底
		expect(store.getLineStyle(PATH_B)).toBeUndefined();
		expect(store.serialize()).toEqual({
			[PATH_A]: { lineStyle: 'direct' },
			[PATH_B]: { lineStyle: 7 },
		});
	});
});

describe('ViewStateStore.hydrate（逐文件布局的清理，2026-10-29）', () => {
	it('剔除残留的 layout 键，同条目的其余字段原样保留，并报告「有清理」', () => {
		const store = new ViewStateStore(() => {});
		const cleaned = store.hydrate({
			viewState: {
				[PATH_A]: {
					layout: 'mindMap',
					lineStyle: 'curve',
					palette: 'mint',
					themeStyle: 'borderless',
					view: VIEW,
				},
			},
		});

		expect(cleaned).toBe(true);
		expect(store.serialize()).toEqual({
			[PATH_A]: {
				lineStyle: 'curve',
				palette: 'mint',
				themeStyle: 'borderless',
				view: VIEW,
			},
		});
	});

	it('只剩 layout 的条目被整条丢弃（不留空壳键）', () => {
		const store = new ViewStateStore(() => {});
		const cleaned = store.hydrate({
			viewState: {
				'only-layout.mindmap.md': { layout: 'fishbone' },
				[PATH_A]: { layout: 'timeline', palette: 'slate' },
			},
		});

		expect(cleaned).toBe(true);
		expect(store.serialize()).toEqual({ [PATH_A]: { palette: 'slate' } });
	});

	it('没有残留时不报告清理（启动路径据此不写盘，幂等）', () => {
		const store = new ViewStateStore(() => {});
		expect(
			store.hydrate({ viewState: { [PATH_A]: { lineStyle: 'curve' } } }),
		).toBe(false);
		// 已清理过的数据再 hydrate 一次同样不报告
		const once = new ViewStateStore(() => {});
		once.hydrate({ viewState: { [PATH_A]: { layout: 'mindMap', palette: 'mint' } } });
		expect(once.hydrate({ viewState: once.serialize() })).toBe(false);
		expect(once.serialize()).toEqual({ [PATH_A]: { palette: 'mint' } });
	});

	it('布局清理不牵连 view 与三项偏好（逐字段独立）', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				[PATH_A]: { layout: 'catalogOrganization', view: VIEW },
				[PATH_B]: { layout: 'fishbone', themeStyle: 'default' },
			},
		});

		expect(store.getView(PATH_A)).toEqual(VIEW);
		expect(store.getThemeStyle(PATH_B)).toBe('default');
		expect(store.serialize()).toEqual({
			[PATH_A]: { view: VIEW },
			[PATH_B]: { themeStyle: 'default' },
		});
	});
});

describe('ViewStateStore 连线样式（按文件补丁式存取）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('setLineStyle 与 setPalette 合并为同一条目，写盘载荷同时携带两者', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setLineStyle(PATH_A, 'direct');
		store.setPalette(PATH_A, 'mint');

		expect(store.getLineStyle(PATH_A)).toBe('direct');
		expect(store.getPalette(PATH_A)).toBe('mint');

		await vi.advanceTimersByTimeAsync(100);

		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({
			[PATH_A]: { lineStyle: 'direct', palette: 'mint' },
		});
	});

	it('未设置过 lineStyle 的文件返回 undefined（调用方回落全局默认）', () => {
		const store = new ViewStateStore(() => {});
		store.setPalette(PATH_A, 'mint');
		expect(store.getLineStyle(PATH_A)).toBeUndefined();
	});
});

describe('ViewStateStore 配色（按文件记，非全局设置）', () => {
	it('setPalette / getPalette 按路径读写，与连线共存于同一条目', () => {
		const store = new ViewStateStore(() => {});
		store.setLineStyle(PATH_A, 'curve');
		store.setPalette(PATH_A, 'mint');

		expect(store.getPalette(PATH_A)).toBe('mint');
		expect(store.getPalette(PATH_B)).toBeUndefined();
		expect(store.serialize()).toEqual({
			[PATH_A]: { lineStyle: 'curve', palette: 'mint' },
		});
	});

	it('hydrate 保留 palette 条目；非字符串值由 getter 兜底为 undefined', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				[PATH_A]: { palette: 'forest' },
				[PATH_B]: { palette: 7 },
			},
		});

		expect(store.getPalette(PATH_A)).toBe('forest');
		// 条目本身有效（含 palette 键）故被保留，坏值由 getter 兜底
		expect(store.getPalette(PATH_B)).toBeUndefined();
	});
});

describe('resolveFilePreferences（按文件偏好 + 全局默认的合成）', () => {
	const defaults = {
		lineStyle: 'curve',
		themeStyle: 'borderless',
		palette: 'mint',
	};

	it('文件无任何记录：三项全部取默认（新建导图遵循设置）', () => {
		expect(resolveFilePreferences({ saved: {}, defaults })).toEqual(defaults);
	});

	it('文件记过的维度取记录、未记过的取默认（逐维独立，不互相牵连）', () => {
		const out = resolveFilePreferences({
			saved: { themeStyle: 'default', palette: 'slate' },
			defaults,
		});
		expect(out).toEqual({
			lineStyle: 'curve',
			themeStyle: 'default',
			palette: 'slate',
		});
	});

	it('回归：themeStyle 缺省值必须是 defaults.themeStyle，而不是硬编码 default', () => {
		// 2026-10-21 的缺陷：视图 load 时回落 `DEFAULT_THEME_STYLE`('default')，
		// 使「默认边框样式」设为 borderless 后新建导图仍渲染带框。
		const out = resolveFilePreferences({ saved: {}, defaults });
		expect(out.themeStyle).toBe('borderless');
		expect(out.themeStyle).not.toBe('default');
	});

	it('结果只有三项（布局不在其中：它来自文件属性，不是按文件记忆的偏好）', () => {
		expect(Object.keys(resolveFilePreferences({ saved: {}, defaults })).sort()).toEqual([
			'lineStyle',
			'palette',
			'themeStyle',
		]);
	});
});

describe('ViewStateStore 主题（按文件记，非全局设置）', () => {
	it('setThemeStyle / getThemeStyle 按路径读写，与连线/配色共存于同一条目', () => {
		const store = new ViewStateStore(() => {});
		store.setLineStyle(PATH_A, 'curve');
		store.setPalette(PATH_A, 'mint');
		store.setThemeStyle(PATH_A, 'borderless');

		expect(store.getThemeStyle(PATH_A)).toBe('borderless');
		expect(store.getThemeStyle(PATH_B)).toBeUndefined();
		expect(store.serialize()).toEqual({
			[PATH_A]: { lineStyle: 'curve', palette: 'mint', themeStyle: 'borderless' },
		});
	});

	it('hydrate 保留 themeStyle 条目；非字符串值由 getter 兜底为 undefined', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				[PATH_A]: { themeStyle: 'borderless' },
				[PATH_B]: { themeStyle: 1 },
			},
		});

		expect(store.getThemeStyle(PATH_A)).toBe('borderless');
		expect(store.getThemeStyle(PATH_B)).toBeUndefined();
	});
});

describe('ViewStateStore 变更与防抖写盘', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('默认防抖窗口为 VIEW_STATE_PERSIST_MS，窗口内不写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist);
		store.setLineStyle(PATH_A, 'curve');

		await vi.advanceTimersByTimeAsync(VIEW_STATE_PERSIST_MS - 1);
		expect(persist).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_A]: { lineStyle: 'curve' } });
	});

	it('同一文件的多次 patch 合并为一次 persist（全量序列化）', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setLineStyle(PATH_A, 'curve');
		store.setView(PATH_A, { transform: { scale: 2 } });
		store.setLineStyle(PATH_A, 'straight');

		await vi.advanceTimersByTimeAsync(100);

		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({
			[PATH_A]: {
				lineStyle: 'straight',
				view: { transform: { scale: 2 } },
			},
		});
		// 内存中的读取同样立即生效（不依赖写盘完成）
		expect(store.getLineStyle(PATH_A)).toBe('straight');
		expect(store.getView(PATH_A)).toEqual({ transform: { scale: 2 } });
	});

	it('跨文件的变更在同一个窗口内合并，且后续窗口的快照不被历史变更改写', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setLineStyle(PATH_A, 'curve');
		await vi.advanceTimersByTimeAsync(100);

		store.setLineStyle(PATH_B, 'straight');
		await vi.advanceTimersByTimeAsync(100);

		expect(persist).toHaveBeenCalledTimes(2);
		// 第一次载荷必须保持"当时"的内容（后续 patch 不得回头改写已交出的对象）
		expect(persist.mock.calls[0]?.[0]).toEqual({
			[PATH_A]: { lineStyle: 'curve' },
		});
		expect(persist.mock.calls[1]?.[0]).toEqual({
			[PATH_A]: { lineStyle: 'curve' },
			[PATH_B]: { lineStyle: 'straight' },
		});
	});

	it('renameKey 迁移状态键并排空写盘；无该键时既不动映射也不写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({ viewState: { [PATH_A]: { palette: 'mint' } } });

		store.renameKey('missing.mindmap.md', 'other.mindmap.md');
		store.renameKey(PATH_A, PATH_B);

		expect(store.getPalette(PATH_A)).toBeUndefined();
		expect(store.getPalette(PATH_B)).toBe('mint');

		await vi.advanceTimersByTimeAsync(100);
		// 无该键的 rename 不触发排空；有该键的触发一次
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_B]: { palette: 'mint' } });
	});

	it('removeKey 删除已有键后 persist 不含该键；无该键时不写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({
			viewState: {
				[PATH_A]: { palette: 'mint' },
				[PATH_B]: { lineStyle: 'curve' },
			},
		});

		store.removeKey('missing.mindmap.md'); // 无该键 → 不排空
		await vi.advanceTimersByTimeAsync(100);
		expect(persist).not.toHaveBeenCalled();

		store.removeKey(PATH_A);
		await vi.advanceTimersByTimeAsync(100);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_B]: { lineStyle: 'curve' } });
	});
});

describe('ViewStateStore.pruneMissingPaths（启动期清理离线删除的残留键）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('只剔除指向不存在文件的键，保留其余并写盘一次', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({
			viewState: {
				[PATH_A]: { palette: 'mint' },
				'gone.mindmap.md': { palette: 'amber' },
				[PATH_B]: { lineStyle: 'curve' },
			},
		});

		const removed = store.pruneMissingPaths((path) => path !== 'gone.mindmap.md');

		expect(removed).toEqual(['gone.mindmap.md']);
		expect(store.getPalette('gone.mindmap.md')).toBeUndefined();
		expect(store.getPalette(PATH_A)).toBe('mint');

		await vi.advanceTimersByTimeAsync(100);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({
			[PATH_A]: { palette: 'mint' },
			[PATH_B]: { lineStyle: 'curve' },
		});
	});

	it('全部仍存在：不剔除、不写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({ viewState: { [PATH_A]: { palette: 'mint' } } });

		expect(store.pruneMissingPaths(() => true)).toEqual([]);

		await vi.advanceTimersByTimeAsync(100);
		expect(persist).not.toHaveBeenCalled();
	});

	it('空映射：返回空数组且不写盘（全新库 / 无历史状态）', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);

		expect(store.pruneMissingPaths(() => false)).toEqual([]);

		await vi.advanceTimersByTimeAsync(100);
		expect(persist).not.toHaveBeenCalled();
	});

	it('幂等：连续两次调用，第二次无残留可剔除也不重复写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({ viewState: { gone: { palette: 'x' } } });

		expect(store.pruneMissingPaths(() => false)).toEqual(['gone']);
		expect(store.pruneMissingPaths(() => false)).toEqual([]);

		await vi.advanceTimersByTimeAsync(100);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({});
	});
});

describe('ViewStateStore.flushNow（立即排空）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('有未决变更：立即写盘并保留内存状态，原防抖不再重复触发', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, VIEW_STATE_PERSIST_MS);
		store.setPalette(PATH_A, 'mint');

		const flushing = store.flushNow();

		// 同步即写盘（不等防抖窗口）
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_A]: { palette: 'mint' } });
		await expect(flushing).resolves.toBeUndefined();
		// 内存状态不因排空而清空（写盘只是落盘动作）
		expect(store.getPalette(PATH_A)).toBe('mint');

		await vi.advanceTimersByTimeAsync(VIEW_STATE_PERSIST_MS * 2);
		expect(persist).toHaveBeenCalledTimes(1); // 防抖已被取消
	});

	it('无未决变更：不写盘且返回 undefined（调用方可选等待）', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, VIEW_STATE_PERSIST_MS);

		expect(store.flushNow()).toBeUndefined();
		expect(persist).not.toHaveBeenCalled();

		// 已排空后再次调用同样无未决
		store.setPalette(PATH_A, 'mint');
		await store.flushNow();
		expect(store.flushNow()).toBeUndefined();
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('persist 返回 Promise 时原样透传：等待即等写盘完成', async () => {
		let releaseWrite: (() => void) | undefined;
		const persist = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseWrite = resolve;
				}),
		);
		const store = new ViewStateStore(persist, VIEW_STATE_PERSIST_MS);
		store.setPalette(PATH_A, 'mint');

		const flushing = store.flushNow();
		expect(flushing).toBeInstanceOf(Promise);

		let settled = false;
		void flushing?.then(() => {
			settled = true;
		});
		await flushMicrotasks();
		// PluginDataWriter.write 在途：flushNow 不得提前 resolve（否则卸载路径
		// 无从判断写盘是否落地）
		expect(settled).toBe(false);

		releaseWrite?.();
		await flushing;
		expect(settled).toBe(true);
		expect(persist).toHaveBeenCalledWith({ [PATH_A]: { palette: 'mint' } });
	});

	it('透传的 Promise 拒绝也返回给调用方（写盘器的拒绝不经此处吞掉）', async () => {
		const boom = new Error('disk unavailable');
		const persist = vi.fn(() => Promise.reject(boom));
		const store = new ViewStateStore(persist, VIEW_STATE_PERSIST_MS);
		store.setPalette(PATH_A, 'mint');

		await expect(store.flushNow()).rejects.toBe(boom);
	});
});
