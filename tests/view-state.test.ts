/**
 * ViewStateStore 回归（src/view-state.ts）。
 *
 * 布局/视口按文件路径存插件 data.json 的顶层 `viewState` 键（正文字节保持纯
 * Markdown）。这里锁定三条易回退的契约：
 * - hydrate 形状校验：只接受含已知字段的条目（layout/view/openAs），
 *   手改 data.json 或引擎升级后的畸形结构不得渗入（否则 getLayout 返回坏值）；
 * - 写盘防抖：连续 patch 合并为一次 persist，且载荷是"当时"的快照
 *   （后续变更不得回头改写已交给写盘器的对象）；
 * - flushNow：取消未决防抖并立即写盘；persist 返回 Promise 时原样透传
 *   （卸载路径靠它持有在途写盘），无未决变更时返回 undefined。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewStateStore } from '../src/view-state';
import { VIEW_STATE_PERSIST_MS } from '../src/constants';

const PATH_A = 'notes/a.mindmap.md';
const PATH_B = 'notes/b.mindmap.md';

async function flushMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

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
				[PATH_A]: { layout: 'mindMap', view: { transform: { scale: 1 } } },
				[PATH_B]: { openAs: 'markdown' },
			},
			// 顶层设置键不属于视图状态
			language: 'zh',
			autoSave: true,
		});

		expect(store.getLayout(PATH_A)).toBe('mindMap');
		expect(store.getView(PATH_A)).toEqual({ transform: { scale: 1 } });
		expect(store.getOpenAs(PATH_B)).toBe('markdown');
		// 设置键不进入视图状态映射
		expect(store.getLayout('language')).toBeUndefined();
		expect(store.serialize()).toEqual({
			[PATH_A]: { layout: 'mindMap', view: { transform: { scale: 1 } } },
			[PATH_B]: { openAs: 'markdown' },
		});
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('丢弃不含已知字段的畸形条目与非对象条目', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				'junk.mindmap.md': { foo: 1 },
				'null.mindmap.md': null,
				'num.mindmap.md': 42,
				'str.mindmap.md': 'layout',
				[PATH_A]: { layout: 'logicalStructure' },
			},
		});

		expect(store.serialize()).toEqual({
			[PATH_A]: { layout: 'logicalStructure' },
		});
	});

	it('条目内字段类型仍由 getter 兜底：layout 非字符串视为未设置', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { [PATH_A]: { layout: 42 } } });
		// 条目本身有效（含 layout 键）故被保留，但 getter 不返回非字符串
		expect(store.serialize()).toEqual({ [PATH_A]: { layout: 42 } });
		expect(store.getLayout(PATH_A)).toBeUndefined();
	});

	it('openAs 只认 mindmap/markdown，其余取值视为未设置', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				[PATH_A]: { openAs: 'source' },
				[PATH_B]: { openAs: 'mindmap' },
			},
		});
		expect(store.getOpenAs(PATH_A)).toBeUndefined();
		expect(store.getOpenAs(PATH_B)).toBe('mindmap');
	});

	it('非对象载荷与缺失 viewState 键均不加载任何状态', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { [PATH_A]: { layout: 'x' } } });

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

	it('误传单个视图状态对象（顶层带 layout）时给出防御提示', () => {
		const store = new ViewStateStore(() => {});
		// 形如 { layout, view } 的单条状态被误当作完整 data.json：静默不加载
		// 会让"重启后布局丢失"极难定位，必须留可观测提示
		store.hydrate({ layout: 'mindMap', view: { transform: { scale: 1 } } });
		expect(store.serialize()).toEqual({});
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('疑似收到 viewState 子对象'),
		);
	});

	it('按路径为键的映射（不是完整 data.json）静默不加载，不误报提示', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ [PATH_A]: { layout: 'mindMap' } });
		expect(store.serialize()).toEqual({});
		expect(console.warn).not.toHaveBeenCalled();
	});

	it('hydrate 幂等：重复载入先清空旧映射，不残留上一份数据', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { [PATH_A]: { layout: 'x' } } });
		store.hydrate({ viewState: { [PATH_B]: { layout: 'y' } } });

		expect(store.getLayout(PATH_A)).toBeUndefined();
		expect(store.getLayout(PATH_B)).toBe('y');
		expect(store.serialize()).toEqual({ [PATH_B]: { layout: 'y' } });
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
		store.setLayout(PATH_A, 'mindMap');

		await vi.advanceTimersByTimeAsync(VIEW_STATE_PERSIST_MS - 1);
		expect(persist).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_A]: { layout: 'mindMap' } });
	});

	it('同一文件的多次 patch 合并为一次 persist（全量序列化）', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setLayout(PATH_A, 'mindMap');
		store.setView(PATH_A, { transform: { scale: 2 } });
		store.setLayout(PATH_A, 'fishbone');

		await vi.advanceTimersByTimeAsync(100);

		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({
			[PATH_A]: {
				layout: 'fishbone',
				view: { transform: { scale: 2 } },
			},
		});
		// 内存中的读取同样立即生效（不依赖写盘完成）
		expect(store.getLayout(PATH_A)).toBe('fishbone');
		expect(store.getView(PATH_A)).toEqual({ transform: { scale: 2 } });
	});

	it('跨文件的变更在同一个窗口内合并，且后续窗口的快照不被历史变更改写', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setLayout(PATH_A, 'x');
		await vi.advanceTimersByTimeAsync(100);

		store.setLayout(PATH_B, 'y');
		await vi.advanceTimersByTimeAsync(100);

		expect(persist).toHaveBeenCalledTimes(2);
		// 第一次载荷必须保持"当时"的内容（后续 patch 不得回头改写已交出的对象）
		expect(persist.mock.calls[0]?.[0]).toEqual({ [PATH_A]: { layout: 'x' } });
		expect(persist.mock.calls[1]?.[0]).toEqual({
			[PATH_A]: { layout: 'x' },
			[PATH_B]: { layout: 'y' },
		});
	});

	it('renameKey 迁移状态键并排空写盘；无该键时既不动映射也不写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({ viewState: { [PATH_A]: { layout: 'mindMap' } } });

		store.renameKey('missing.mindmap.md', 'other.mindmap.md');
		store.renameKey(PATH_A, PATH_B);

		expect(store.getLayout(PATH_A)).toBeUndefined();
		expect(store.getLayout(PATH_B)).toBe('mindMap');

		await vi.advanceTimersByTimeAsync(100);
		// 无该键的 rename 不触发排空；有该键的触发一次
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_B]: { layout: 'mindMap' } });
	});

	it('removeKey 删除已有键后 persist 不含该键；无该键时不写盘', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({
			viewState: {
				[PATH_A]: { layout: 'x' },
				[PATH_B]: { openAs: 'markdown' },
			},
		});

		store.removeKey('missing.mindmap.md'); // 无该键 → 不排空
		await vi.advanceTimersByTimeAsync(100);
		expect(persist).not.toHaveBeenCalled();

		store.removeKey(PATH_A);
		await vi.advanceTimersByTimeAsync(100);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_B]: { openAs: 'markdown' } });
	});

	it('setOpenAs 的记忆与读取对称（最后一次选择决定）', () => {
		const store = new ViewStateStore(() => {}, 100);
		store.setOpenAs(PATH_A, 'mindmap');
		expect(store.getOpenAs(PATH_A)).toBe('mindmap');
		store.setOpenAs(PATH_A, 'markdown');
		expect(store.getOpenAs(PATH_A)).toBe('markdown');
		// 不改动同一条目的其他字段
		store.setLayout(PATH_A, 'timeline');
		store.setOpenAs(PATH_A, 'mindmap');
		expect(store.getLayout(PATH_A)).toBe('timeline');
		expect(store.serialize()).toEqual({
			[PATH_A]: { layout: 'timeline', openAs: 'mindmap' },
		});
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
		store.setLayout(PATH_A, 'mindMap');

		const flushing = store.flushNow();

		// 同步即写盘（不等防抖窗口）
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith({ [PATH_A]: { layout: 'mindMap' } });
		await expect(flushing).resolves.toBeUndefined();
		// 内存状态不因排空而清空（写盘只是落盘动作）
		expect(store.getLayout(PATH_A)).toBe('mindMap');

		await vi.advanceTimersByTimeAsync(VIEW_STATE_PERSIST_MS * 2);
		expect(persist).toHaveBeenCalledTimes(1); // 防抖已被取消
	});

	it('无未决变更：不写盘且返回 undefined（调用方可选等待）', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, VIEW_STATE_PERSIST_MS);

		expect(store.flushNow()).toBeUndefined();
		expect(persist).not.toHaveBeenCalled();

		// 已排空后再次调用同样无未决
		store.setLayout(PATH_A, 'x');
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
		store.setLayout(PATH_A, 'mindMap');

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
		expect(persist).toHaveBeenCalledWith({ [PATH_A]: { layout: 'mindMap' } });
	});

	it('透传的 Promise 拒绝也返回给调用方（写盘器的拒绝不经此处吞掉）', async () => {
		const boom = new Error('disk unavailable');
		const persist = vi.fn(() => Promise.reject(boom));
		const store = new ViewStateStore(persist, VIEW_STATE_PERSIST_MS);
		store.setLayout(PATH_A, 'x');

		await expect(store.flushNow()).rejects.toBe(boom);
	});
});
