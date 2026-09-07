/**
 * ViewStateStore 回归测试（view-state.ts）。
 *
 * 布局/视口按文件路径存 data.json（正文保持纯 Markdown）。
 * 覆盖：hydrate 形状校验（坏数据不渗入）、防抖写盘、rename/remove
 * 状态迁移、flushNow 立即排空（cancel 返回值决定是否 persist）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewStateStore } from '../src/view-state';

describe('ViewStateStore.hydrate（形状校验）', () => {
	it('接受含已知字段的合法条目', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				'a.mindmap.md': { layout: 'mindMap', view: { transform: {} } },
				'b.mindmap.md': { openAs: 'markdown' },
			},
		});
		expect(store.getLayout('a.mindmap.md')).toBe('mindMap');
		expect(store.getView('a.mindmap.md')).toEqual({ transform: {} });
		expect(store.getOpenAs('b.mindmap.md')).toBe('markdown');
	});

	it('丢弃畸形条目与非对象载荷', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({
			viewState: {
				bad: { foo: 1 },
				nullEntry: null,
				numEntry: 42,
			},
			junk: true,
		});
		expect(store.serialize()).toEqual({});
	});

	it('hydrate 幂等：重复载入先清空旧表', () => {
		const store = new ViewStateStore(() => {});
		store.hydrate({ viewState: { 'a.mindmap.md': { layout: 'x' } } });
		store.hydrate({ viewState: { 'b.mindmap.md': { layout: 'y' } } });
		expect(store.getLayout('a.mindmap.md')).toBeUndefined();
		expect(store.getLayout('b.mindmap.md')).toBe('y');
	});
});

describe('ViewStateStore 写盘防抖', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('变更后按 debounceMs 防抖 persist 全量序列化', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 600);
		store.setLayout('a.mindmap.md', 'mindMap');
		store.setView('a.mindmap.md', { t: 1 });
		await vi.advanceTimersByTimeAsync(599);
		expect(persist).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist.mock.calls[0]?.[0]).toEqual({
			'a.mindmap.md': { layout: 'mindMap', view: { t: 1 } },
		});
	});

	it('连续变更只 persist 最后状态一次', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setLayout('a.mindmap.md', 'one');
		await vi.advanceTimersByTimeAsync(50);
		store.setLayout('a.mindmap.md', 'two');
		await vi.advanceTimersByTimeAsync(100);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(store.getLayout('a.mindmap.md')).toBe('two');
	});

	it('setOpenAs 与 renameKey/removeKey 触发 persist', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.setOpenAs('a.mindmap.md', 'mindmap');
		store.renameKey('a.mindmap.md', 'b.mindmap.md');
		store.removeKey('missing.mindmap.md'); // 无该键：不触发排空
		await vi.advanceTimersByTimeAsync(100);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(store.getOpenAs('b.mindmap.md')).toBe('mindmap');
	});

	it('removeKey 删除已有键后 persist 不含该键', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 100);
		store.hydrate({ viewState: { 'a.mindmap.md': { layout: 'x' } } });
		store.removeKey('a.mindmap.md');
		await vi.advanceTimersByTimeAsync(100);
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

	it('有未决变更：立即 persist 且定时器不再重复触发', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 600);
		store.setLayout('a.mindmap.md', 'mindMap');
		void store.flushNow();
		expect(persist).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1000);
		expect(persist).toHaveBeenCalledTimes(1); // 防抖已取消
	});

	it('无未决变更：不触发 persist', () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 600);
		void store.flushNow();
		expect(persist).not.toHaveBeenCalled();
	});
});

describe('ViewStateStore.flushNow（写盘 Promise 透传）', () => {
	/** 回归：卸载路径经 flushNow 跟踪在途写盘（PluginDataWriter.write 语义） */
	it('persist 返回 Promise 时 flushNow 原样透传，等待即等写盘完成', async () => {
		let resolveWrite: (() => void) | undefined;
		const persist = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveWrite = resolve;
				}),
		);
		const store = new ViewStateStore(persist, 600);
		store.setLayout('a.mindmap.md', 'mindMap');
		const flushing = store.flushNow();
		expect(flushing).toBeInstanceOf(Promise);
		let settled = false;
		void flushing?.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false); // 写盘未完成前 flushNow 不 resolve
		resolveWrite?.();
		await flushing;
		expect(settled).toBe(true);
	});

	it('persist 返回 void 时 flushNow 仍返回已决议的 Promise', async () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 600);
		store.setLayout('a.mindmap.md', 'mindMap');
		await expect(store.flushNow()).resolves.toBeUndefined();
	});

	it('无未决变更时 flushNow 返回 undefined（调用方可选等待）', () => {
		const persist = vi.fn();
		const store = new ViewStateStore(persist, 600);
		expect(store.flushNow()).toBeUndefined();
	});
});
