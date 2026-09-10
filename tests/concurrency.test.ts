/**
 * concurrency 原语回归（src/concurrency.ts）。
 *
 * 串行队列 / 有界并发映射 / 防抖 / 节流是 SavePipeline、ViewStateStore、
 * 搜索防抖、标题重命名防抖、状态栏节流的共同依赖——并发语义
 * （错误传播、尾随保证、拒绝后停止派发、窗口重置）只在这里回归一份。
 *
 * 计时经 window.setTimeout；window 由 tests/setup.ts 桩到 globalThis，
 * 因此 vi.useFakeTimers() 安装的假定时器能拦截这些调用（含假 Date.now，
 * 节流窗口判定依赖它）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createDebouncer,
	createSerialQueue,
	createThrottler,
	mapWithConcurrency,
} from '../src/concurrency';

/**
 * 手动 deferred：竞态用例需要「先断言在途、后放行」，不能靠计时猜时序。
 * 载荷无值（只用完成信号），故不设泛型——`ReturnType<typeof deferred>`
 * 会把未解析的类型参数实例化为 unknown，与 Promise<void> 不兼容。
 */
interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
	reject: (error: unknown) => void;
}

function deferred(): Deferred {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** 冲涮微任务：原语状态机全在微任务里推进（不涉计时） */
async function flushMicrotasks(times = 5): Promise<void> {
	for (let i = 0; i < times; i++) {
		await Promise.resolve();
	}
}

describe('createSerialQueue（串行队列）', () => {
	it('按提交顺序串行执行：前序未完成时后序不开始', async () => {
		const queue = createSerialQueue();
		const order: string[] = [];
		const gate = deferred();
		const first = queue(async () => {
			order.push('first:start');
			await gate.promise;
			order.push('first:end');
			return 'first';
		});
		const second = queue(async () => {
			order.push('second:start');
			return 'second';
		});

		await flushMicrotasks();
		// 队首已启动并挂在 gate 上；队尾任务必须仍在等待（串行而非并发）
		expect(order).toEqual(['first:start']);

		gate.resolve();
		await expect(first).resolves.toBe('first');
		await expect(second).resolves.toBe('second');
		// 顺序证明：second 的起点排在 first 的终点之后
		expect(order).toEqual(['first:start', 'first:end', 'second:start']);
	});

	it('前序失败只传播给它的调用方，后续任务照常执行', async () => {
		const queue = createSerialQueue();
		const boom = new Error('boom');
		const order: string[] = [];
		const failing = queue(async () => {
			order.push('failing');
			throw boom;
		});
		const following = queue(async () => {
			order.push('following');
			return 'ok';
		});

		// 错误对象原样透传（调用方按身份判定错误类型），且不影响队列自身
		await expect(failing).rejects.toBe(boom);
		await expect(following).resolves.toBe('ok');
		expect(order).toEqual(['failing', 'following']);
	});

	it('失败后链不断：连续失败/成功的任务仍按提交顺序推进', async () => {
		const queue = createSerialQueue();
		const order: number[] = [];
		const tasks = [
			queue(async () => {
				order.push(1);
				throw new Error('1 failed');
			}),
			queue(async () => {
				order.push(2);
				throw new Error('2 failed');
			}),
			queue(async () => {
				order.push(3);
				return 3;
			}),
		];

		const settled = await Promise.allSettled(tasks);
		expect(settled.map((r) => r.status)).toEqual([
			'rejected',
			'rejected',
			'fulfilled',
		]);
		// 每次失败都必须推进 tail，否则第 3 个任务永远不会开始
		expect(order).toEqual([1, 2, 3]);
	});

	it('并发提交多个任务时最大在途数为 1', async () => {
		const queue = createSerialQueue();
		let running = 0;
		let maxConcurrent = 0;
		const results = await Promise.all(
			[1, 2, 3, 4].map((n) =>
				queue(async () => {
					running++;
					maxConcurrent = Math.max(maxConcurrent, running);
					await flushMicrotasks(2);
					running--;
					return n * 2;
				}),
			),
		);
		expect(results).toEqual([2, 4, 6, 8]);
		expect(maxConcurrent).toBe(1);
	});
});

describe('mapWithConcurrency（有界并发映射）', () => {
	it('同时在途数不超过 limit，空闲即补位，结果按输入顺序返回', async () => {
		const gates = new Map<number, ReturnType<typeof deferred>>();
		const inFlight = new Set<number>();
		let maxConcurrent = 0;
		const mapping = mapWithConcurrency([0, 1, 2, 3, 4], 2, (n) => {
			inFlight.add(n);
			maxConcurrent = Math.max(maxConcurrent, inFlight.size);
			const gate = deferred();
			gates.set(n, gate);
			// 完成时先从在途集合移除，再交给原语补位
			return gate.promise.then(() => {
				inFlight.delete(n);
				return n * 10;
			});
		});

		await flushMicrotasks();
		expect([...inFlight].sort((a, b) => a - b)).toEqual([0, 1]);

		// 0 完成 → 立刻补位派发 2（不整批等待）
		gates.get(0)?.resolve();
		await flushMicrotasks();
		expect([...inFlight].sort((a, b) => a - b)).toEqual([1, 2]);

		gates.get(1)?.resolve();
		gates.get(2)?.resolve();
		await flushMicrotasks();
		expect([...inFlight].sort((a, b) => a - b)).toEqual([3, 4]);

		gates.get(3)?.resolve();
		gates.get(4)?.resolve();
		// 输入顺序 [0..4] → 结果顺序必须一致（不是完成顺序）
		await expect(mapping).resolves.toEqual([0, 10, 20, 30, 40]);
		expect(maxConcurrent).toBe(2);
	});

	it('快任务不拖慢派发：同步完成的 worker 立刻让出位置', async () => {
		const started: number[] = [];
		const gate = deferred();
		const mapping = mapWithConcurrency([0, 1, 2], 2, async (n) => {
			started.push(n);
			if (n === 1) {
				await gate.promise;
			}
			return n;
		});

		await flushMicrotasks();
		// 0 已同步完成，1 挂在 gate 上 → 2 必须已被派发（而非等 1 完成）
		expect(started).toEqual([0, 1, 2]);

		gate.resolve();
		await expect(mapping).resolves.toEqual([0, 1, 2]);
	});

	it('空数组立即完成且不调用 worker', async () => {
		const worker = vi.fn(async (n: number) => n);
		await expect(mapWithConcurrency([], 3, worker)).resolves.toEqual([]);
		expect(worker).not.toHaveBeenCalled();
	});

	it('limit 小于 1 时钳制为串行执行', async () => {
		const started: number[] = [];
		let running = 0;
		let maxConcurrent = 0;
		const gates = new Map<number, ReturnType<typeof deferred>>();
		const mapping = mapWithConcurrency([1, 2], 0, (n) => {
			started.push(n);
			running++;
			maxConcurrent = Math.max(maxConcurrent, running);
			const gate = deferred();
			gates.set(n, gate);
			// 完成时递减在途计数，再交给原语补位
			return gate.promise.then(() => {
				running--;
				return n;
			});
		});

		await flushMicrotasks();
		// maxActive 钳到 1：后者必须等前者完成才派发
		expect(started).toEqual([1]);

		gates.get(1)?.resolve();
		await flushMicrotasks();
		expect(started).toEqual([1, 2]);

		gates.get(2)?.resolve();
		await expect(mapping).resolves.toEqual([1, 2]);
		expect(maxConcurrent).toBe(1);
	});

	it('任一任务失败整体 reject，且拒绝后不再派发新任务', async () => {
		const started: number[] = [];
		const gate = deferred();
		const boom = new Error('boom');
		const mapping = mapWithConcurrency([0, 1, 2, 3], 2, async (n) => {
			started.push(n);
			if (n === 0) {
				throw boom;
			}
			if (n === 1) {
				await gate.promise;
			}
			return n;
		});

		await expect(mapping).rejects.toBe(boom);
		// 拒绝时 1 仍在途；它完成后不得触发 2/3 的派发
		expect(started).toEqual([0, 1]);
		gate.resolve();
		await flushMicrotasks();
		expect(started).toEqual([0, 1]);
	});

	it('worker 同步抛错（非 async 实现）同样收敛为整体 reject', async () => {
		const boom = new Error('sync boom');
		const worker = (n: number): Promise<number> => {
			if (n === 2) {
				throw boom;
			}
			return Promise.resolve(n);
		};
		// 同步抛错必须被 launch 捕获：逃逸出去会变成未处理拒绝且拒绝标志不置位
		await expect(mapWithConcurrency([1, 2, 3], 2, worker)).rejects.toBe(boom);
	});

	it('非 Error 拒绝值包装为 Error（调用方按消息处理）', async () => {
		const error: unknown = await mapWithConcurrency([1], 1, () =>
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- 有意用非 Error 值验证 toError 的包装分支
			Promise.reject('bad'),
		).catch((reason: unknown) => reason);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('bad');
	});
});

describe('createDebouncer（防抖）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('延迟未到不执行，到期后执行一次', async () => {
		const debouncer = createDebouncer(100);
		const fn = vi.fn();
		debouncer.schedule(fn);
		await vi.advanceTimersByTimeAsync(99);
		expect(fn).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(1);
		// 执行后不再重复触发（定时器已清位）
		await vi.advanceTimersByTimeAsync(1000);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('窗口内重复调度重置计时，且只执行最后提交的函数', async () => {
		const debouncer = createDebouncer(100);
		const stale = vi.fn();
		const latest = vi.fn();
		debouncer.schedule(stale);
		await vi.advanceTimersByTimeAsync(60);
		debouncer.schedule(latest);
		await vi.advanceTimersByTimeAsync(60);
		// 距首次调度已 120ms，但窗口被重置 → 仍未执行
		expect(stale).not.toHaveBeenCalled();
		expect(latest).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(40);
		expect(latest).toHaveBeenCalledTimes(1);
		// 被覆盖的旧回调必须彻底丢弃（clearTimeout 而非叠加）
		expect(stale).not.toHaveBeenCalled();
	});

	it('isPending 反映未决状态，执行后复位', async () => {
		const debouncer = createDebouncer(100);
		expect(debouncer.isPending()).toBe(false);
		debouncer.schedule(() => {});
		expect(debouncer.isPending()).toBe(true);
		await vi.advanceTimersByTimeAsync(100);
		expect(debouncer.isPending()).toBe(false);
	});

	it('cancel：有未决时返回 true 并丢弃任务，无未决时返回 false', async () => {
		const debouncer = createDebouncer(100);
		const fn = vi.fn();
		debouncer.schedule(fn);
		expect(debouncer.cancel()).toBe(true);
		expect(debouncer.isPending()).toBe(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(fn).not.toHaveBeenCalled();
		// 幂等：再次 cancel 无未决任务
		expect(debouncer.cancel()).toBe(false);
	});

	it('delayMs 为 0 时在当前宏任务之后执行', async () => {
		const debouncer = createDebouncer(0);
		const fn = vi.fn();
		debouncer.schedule(fn);
		expect(fn).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(0);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe('createThrottler（节流）', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('首次立即执行；窗口内只排一次尾随执行', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn); // 首跑：lastRunAt=0，elapsed 必 ≥ limit
		expect(fn).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 窗口内 → 排尾随（500ms 处）
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 窗口内且尾随已排 → 忽略
		expect(fn).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(300); // 尾随触发
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('窗口内多次调用只保留最先排入的那个回调', async () => {
		const throttler = createThrottler(500);
		const immediate = vi.fn();
		const trailing = vi.fn();
		const dropped = vi.fn();
		throttler.run(immediate);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(trailing); // 排入尾随
		throttler.run(dropped); // 已有尾随 → 丢弃
		await vi.advanceTimersByTimeAsync(400);
		expect(immediate).toHaveBeenCalledTimes(1);
		expect(trailing).toHaveBeenCalledTimes(1);
		expect(dropped).not.toHaveBeenCalled();
	});

	it('距上次执行满一个窗口后立刻执行（边界 elapsed === limitMs）', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(499);
		throttler.run(fn); // 未满窗口 → 排尾随
		expect(fn).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1); // 500ms：尾随执行
		expect(fn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(500);
		throttler.run(fn); // elapsed 恰为 500 → 立即执行（>= 判定）
		expect(fn).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('默认尾随执行占用新窗口：紧接着的 run 仍被推迟', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(2); // 尾随已执行

		throttler.run(fn); // 距尾随 0ms < 500 → 排新尾随而非立即
		expect(fn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(499);
		expect(fn).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('trailingResetsWindow：尾随执行后下一次 run 立即生效', async () => {
		const throttler = createThrottler(500, { trailingResetsWindow: true });
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(2); // 尾随已执行（lastRunAt 归零）

		throttler.run(fn); // 窗口已重置 → 立即，不再等一个完整窗口
		expect(fn).toHaveBeenCalledTimes(3);

		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn); // 新窗口内 → 排尾随
		expect(fn).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(400);
		expect(fn).toHaveBeenCalledTimes(4);
	});

	it('cancel 取消未决尾随执行；执行完毕后 cancel 是无操作', async () => {
		const throttler = createThrottler(500);
		const fn = vi.fn();
		throttler.run(fn);
		await vi.advanceTimersByTimeAsync(100);
		throttler.run(fn);
		throttler.cancel();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fn).toHaveBeenCalledTimes(1); // 尾随被取消

		throttler.cancel(); // 无未决尾随
		throttler.run(fn); // 距上次执行已 > 500 → 立即
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
