/**
 * concurrency 原语单元测试：串行队列 / 防抖 / 节流。
 *
 * 这三个原语是 SavePipeline、ViewStateStore、搜索防抖、
 * 状态栏节流的共同依赖——并发语义（错误传播、尾随保证、重置行为）
 * 只有这里一份回归。
 *
 * window 桩由 tests/setup.ts 提供（Node 环境指向 globalThis，fake timers 生效）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createDebouncer,
	createSerialQueue,
	createThrottler,
	mapWithConcurrency,
} from '../src/concurrency';

describe('createSerialQueue', () => {
	it('按提交顺序串行执行', async () => {
		const queue = createSerialQueue();
		const order: number[] = [];
		const p1 = queue(async () => {
			await new Promise((r) => window.setTimeout(r, 5));
			order.push(1);
			return 'one';
		});
		const p2 = queue(async () => {
			order.push(2);
			return 'two';
		});
		expect(order).toEqual([]);
		expect(await p1).toBe('one');
		expect(await p2).toBe('two');
		expect(order).toEqual([1, 2]);
	});

	it('前序任务失败不阻塞后续，错误只传播给各自调用方', async () => {
		const queue = createSerialQueue();
		const boom = queue(async () => {
			throw new Error('boom');
		});
		const ok = queue(async () => 'ok');
		await expect(boom).rejects.toThrow('boom');
		expect(await ok).toBe('ok');
	});

	it('并发提交多个任务时严格排队（后任务在前任务完成后才开始）', async () => {
		const queue = createSerialQueue();
		let running = 0;
		let maxConcurrent = 0;
		const tasks = [1, 2, 3].map((n) =>
			queue(async () => {
				running += 1;
				maxConcurrent = Math.max(maxConcurrent, running);
				await new Promise((r) => window.setTimeout(r, 1));
				running -= 1;
				return n;
			}),
		);
		expect(await Promise.all(tasks)).toEqual([1, 2, 3]);
		expect(maxConcurrent).toBe(1);
	});
});

describe('mapWithConcurrency', () => {
	it('结果按输入顺序返回，同时在途数不超过 limit', async () => {
		let running = 0;
		let maxConcurrent = 0;
		const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
			running += 1;
			maxConcurrent = Math.max(maxConcurrent, running);
			await new Promise((r) => window.setTimeout(r, 1));
			running -= 1;
			return n * 2;
		});
		expect(result).toEqual([2, 4, 6, 8, 10, 12, 14]);
		expect(maxConcurrent).toBe(3);
	});

	it('任务完成即补位（无分批等待：快任务不拖慢后续派发）', async () => {
		// 第 1 个任务立即完成，其余挂起：limit=2 时第 3 个任务应立刻补位派发，
		// 无需等第 2 个任务完成
		let thirdStarted = false;
		await mapWithConcurrency([0, 1, 2], 2, async (n) => {
			if (n === 0) {
				return 0; // 同步完成
			}
			if (n === 2) {
				thirdStarted = true;
			}
			await new Promise((r) => window.setTimeout(r, 5));
			return n;
		});
		expect(thirdStarted).toBe(true);
	});

	it('空数组立即完成', async () => {
		await expect(mapWithConcurrency([], 3, async () => 0)).resolves.toEqual([]);
	});

	it('任务失败整体 reject（Promise.all 语义）', async () => {
		await expect(
			mapWithConcurrency([1, 2, 3], 2, async (n) => {
				if (n === 2) {
					throw new Error('boom');
				}
				return n;
			}),
		).rejects.toThrow('boom');
	});

	it('worker 同步抛错（非 async 实现）收敛为整体 reject', async () => {
		await expect(
			mapWithConcurrency([1, 2, 3], 2, (n): Promise<number> => {
				if (n === 2) {
					throw new Error('sync boom');
				}
				return Promise.resolve(n);
			}),
		).rejects.toThrow('sync boom');
	});
});

describe('createDebouncer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('延迟到期后执行一次', async () => {
		const debouncer = createDebouncer(100);
		const fn = vi.fn();
		debouncer.schedule(fn);
		expect(fn).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('窗口内重复调度只执行最后一次（重置计时）', async () => {
		const debouncer = createDebouncer(100);
		const fn = vi.fn();
		debouncer.schedule(fn);
		await vi.advanceTimersByTimeAsync(60);
		debouncer.schedule(fn);
		await vi.advanceTimersByTimeAsync(60);
		expect(fn).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(40);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('cancel 取消未决任务并返回 true；无未决时返回 false', async () => {
		const debouncer = createDebouncer(100);
		const fn = vi.fn();
		expect(debouncer.isPending()).toBe(false);
		debouncer.schedule(fn);
		expect(debouncer.isPending()).toBe(true);
		expect(debouncer.cancel()).toBe(true);
		expect(debouncer.isPending()).toBe(false);
		await vi.advanceTimersByTimeAsync(200);
		expect(fn).not.toHaveBeenCalled();
		expect(debouncer.cancel()).toBe(false);
	});
});

describe('createThrottler', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('首次调用立即执行，窗口内的调用只排一次尾随执行', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn); // 首跑立即
		expect(fn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 窗口内 → 排尾随
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 窗口内且尾随已排 → 忽略
		expect(fn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(300); // 距首跑 500ms，尾随触发
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('尾随执行后重开窗口：距尾随超过 limit 的调用再次立即执行', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 尾随排在 500ms 处
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(2); // 尾随已执行
		throttler.run(fn); // 距尾随 0ms → 排新尾随
		await vi.advanceTimersByTimeAsync(499);
		expect(fn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('cancel 取消未决的尾随执行', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn);
		throttler.cancel();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('trailingResetsWindow：尾随执行后下一次 run 立即执行（状态栏语义）', async () => {
		const throttler = createThrottler(500, { trailingResetsWindow: true });
		const fn = vi.fn();
		throttler.run(fn); // 首跑立即
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 窗口内 → 排尾随（500ms 处）
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(2); // 尾随已执行，窗口已重置
		throttler.run(fn); // 立即执行，不再等窗口
		expect(fn).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 新窗口内 → 排尾随
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(4);
	});

	it('默认行为不变：尾随执行占用新窗口（下一次 run 需再等一个窗口）', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 尾随排在 500ms 处
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(2);
		throttler.run(fn); // 距尾随 0ms < 500 → 排新尾随而非立即执行
		expect(fn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(499);
		expect(fn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(3);
	});
});
