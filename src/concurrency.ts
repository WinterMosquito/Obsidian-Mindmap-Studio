/**
 * 并发与调度原语：串行队列、防抖、节流的唯一实现。
 *
 * 此前同类逻辑分散手写：promise 串行链 3 份（ImageSaveQueue / SavePipeline
 * saveChain / 插件 dataCommitChain）、防抖 4 份（保存 / 搜索 / viewState /
 * 标题重命名）、节流 1 份（状态栏）。统一收敛到本模块后：
 * - 并发语义（错误传播、尾随保证）只有一份实现、一份测试；
 * - 调用方不再各自维护 timer/chain 字段。
 *
 * 计时经 window.setTimeout：插件运行于 Electron 渲染进程（window 恒存在）；
 * Node 测试环境下由测试自行把 window 指向 globalThis（fake timers 亦生效）。
 */

/** 串行队列：任务按提交顺序执行，前序失败不阻塞后续（错误由调用方处理） */
export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerialQueue(): SerialQueue {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(task: () => Promise<T>): Promise<T> => {
		const run = tail.then(task);
		// 无论本次成败都推进队列，避免断链
		tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	};
}

export interface Debouncer {
	/** 调度（或重置）一次延迟执行 */
	schedule(fn: () => void): void;
	/** 取消未决任务；返回取消前是否存在未决任务 */
	cancel(): boolean;
	isPending(): boolean;
}

export function createDebouncer(delayMs: number): Debouncer {
	let timer: number | null = null;
	return {
		schedule(fn) {
			if (timer !== null) {
				window.clearTimeout(timer);
			}
			timer = window.setTimeout(() => {
				timer = null;
				fn();
			}, delayMs);
		},
		cancel() {
			if (timer === null) {
				return false;
			}
			window.clearTimeout(timer);
			timer = null;
			return true;
		},
		isPending: () => timer !== null,
	};
}

export interface ThrottlerOptions {
	/**
	 * 尾随执行后重置节流窗口（lastRun 归零）：下一次 run 立即执行。
	 * 适用于「停止高频操作后最终状态必须立即可见，且后续首次调用不应
	 * 被上一窗口再推迟」的场景（如状态栏计数刷新）。默认 false：尾随
	 * 执行占用新窗口，下一次 run 最早在 limitMs 后执行。
	 */
	trailingResetsWindow?: boolean;
}

export interface Throttler {
	/** 首次立即执行；窗口内的后续调用只排一次尾随执行 */
	run(fn: () => void): void;
	cancel(): void;
}

export function createThrottler(
	limitMs: number,
	options: ThrottlerOptions = {},
): Throttler {
	const trailingResetsWindow = options.trailingResetsWindow === true;
	let lastRunAt = 0;
	let trailing: number | null = null;
	return {
		run(fn) {
			const elapsed = Date.now() - lastRunAt;
			if (elapsed >= limitMs) {
				lastRunAt = Date.now();
				fn();
				return;
			}
			if (trailing !== null) {
				return;
			}
			trailing = window.setTimeout(() => {
				trailing = null;
				// 尾随执行即「最新状态已展示」：按需重置窗口，
				// 下一次 run 立即生效而不是再等一个完整窗口
				lastRunAt = trailingResetsWindow ? 0 : Date.now();
				fn();
			}, limitMs - elapsed);
		},
		cancel() {
			if (trailing !== null) {
				window.clearTimeout(trailing);
				trailing = null;
			}
		},
	};
}
