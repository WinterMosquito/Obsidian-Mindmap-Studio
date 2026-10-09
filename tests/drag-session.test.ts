/**
 * 窗口级拖拽会话原语（`src/features/drag-session.ts`）的直测。
 *
 * 为什么必须直测（2026-10-07）：本原语是 `image-resize`（拖宽手势）与
 * `drag-target`（拖拽换父辅助）共用的**唯一**会话生命周期实现，两处调用方
 * 都只做「业务回调」，一旦原语自身有错（漏摘监听、帧未合、陈旧帧落地），
 * 症状是「拖拽手感跳变 / 监听泄漏 / 视图关闭后报错」——**实机难以稳定复现**。
 * 故用假 Window 把四条不可见的契约钉死：
 *1. 监听挂在传入的 `win`（popout 场景），且注册/摘除的 capture 标志**同款**；
 * 2. `scheduleFrame` 在同一帧内多次调用只执行一次 `onFrame`（rAF 合帧）；
 * 3. `end()` 幂等，且**取消在途帧**——陈旧帧不得落地（引擎重建/视图关闭守卫）；
 * 4. mouseup 的顺序是「先撤监听、后回调 onUp」（onUp 要提交最终状态）。
 *
 * 不依赖 jsdom：环境是 node（vitest.config.ts 固定），故用最小假 Window。
 */
import { describe, expect, it } from 'vitest';
import { startWindowDragSession } from '../src/features/drag-session';

/** 假 Window：只实现本原语用到的事件与 rAF 面，附调用记录供断言 */
interface FakeWin {
	readonly win: Window;
	/** 「已注册」监听（含 capture 标志）；摘除后移除 */
	readonly registered: { type: string; capture: boolean; fn: EventListener }[];
	/** rAF 回调队列（按排期顺序；未 cancel 的会留在里面） */
	readonly frames: { id: number; fn: FrameRequestCallback }[];
	/** 派发一个鼠标事件到已注册监听（模拟浏览器） */
	fire(type: 'mousemove' | 'mouseup'): void;
	/** 推进一帧：执行队首未取消回调 */
	flushFrame(): void;
	/** 当前已注册监听条数（漏摘监听时不为 0） */
	readonly listenerCount: () => number;
	/** 当前未取消的帧数 */
	readonly pendingFrames: () => number;
	/** 全局 requestAnimationFrame 的下一个 id 种子 */
	nextFrameId: number;
}

/** 构造假 Window（capture 标志参与匹配，故按标志分别记录） */
function createFakeWin(): FakeWin {
	const registered: { type: string; capture: boolean; fn: EventListener }[] = [];
	const frames: { id: number; fn: FrameRequestCallback }[] = [];
	let nextId = 1;
	const win = {
		addEventListener(type: string, fn: EventListener, capture?: boolean): void {
			registered.push({ type, capture: capture === true, fn });
		},
		removeEventListener(type: string, fn: EventListener, capture?: boolean): void {
			const index = registered.findIndex(
				(entry) => entry.type === type && entry.fn === fn,
			);
			if (index >= 0) {
				registered.splice(index, 1);
			}
		},
		requestAnimationFrame(fn: FrameRequestCallback): number {
			const id = nextId;
			nextId += 1;
			frames.push({ id, fn });
			return id;
		},
		cancelAnimationFrame(id: number): void {
			const index = frames.findIndex((entry) => entry.id === id);
			if (index >= 0) {
				frames.splice(index, 1);
			}
		},
	} as unknown as Window;
	const self: FakeWin = {
		win,
		registered,
		frames,
		nextFrameId: 1,
		listenerCount: () => registered.length,
		pendingFrames: () => frames.length,
		fire(type: 'mousemove' | 'mouseup'): void {
			const event = { type, clientX: 10, altKey: false } as unknown as MouseEvent;
			// 复制一份再遍历：回调内可能摘除监听（end()）
			for (const entry of [...registered]) {
				if (entry.type === type) {
					entry.fn(event);
				}
			}
		},
		flushFrame(): void {
			const entry = frames.shift();
			entry?.fn(0);
		},
	};
	return self;
}

describe('startWindowDragSession', () => {
	it('注册两个监听到传入的 win（非全局 window），默认不带 capture', () => {
		const fake = createFakeWin();
		startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => undefined,
		});

		expect(fake.registered.map((entry) => entry.type)).toEqual([
			'mousemove',
			'mouseup',
		]);
		expect(fake.registered.every((entry) => entry.capture === false)).toBe(true);
	});

	it('capture:true 时注册与摘除都带同款标志（否则监听摘不掉）', () => {
		const fake = createFakeWin();
		const session = startWindowDragSession({
			win: fake.win,
			capture: true,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => undefined,
		});
		expect(fake.registered.every((entry) => entry.capture === true)).toBe(true);

		session.end();

		expect(fake.listenerCount()).toBe(0);
	});

	it('onMove 逐事件触发、不做合帧', () => {
		const fake = createFakeWin();
		let moves = 0;
		startWindowDragSession({
			win: fake.win,
			onMove: () => {
				moves += 1;
			},
			onUp: () => undefined,
			onFrame: () => undefined,
		});

		fake.fire('mousemove');
		fake.fire('mousemove');
		fake.fire('mousemove');

		expect(moves).toBe(3);
		expect(fake.pendingFrames()).toBe(0);
	});

	it('scheduleFrame 同一帧内多次调用只执行一次 onFrame', () => {
		const fake = createFakeWin();
		let frames = 0;
		const session = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				frames += 1;
			},
		});

		// 模拟一帧内连来 5 个 move（每次都请求合帧）
		for (let i = 0; i < 5; i++) {
			session.scheduleFrame();
		}
		expect(fake.pendingFrames()).toBe(1);

		fake.flushFrame();

		expect(frames).toBe(1);
		expect(fake.pendingFrames()).toBe(0);
	});

	it('每一帧都能再排期（合帧不吞后续帧）', () => {
		const fake = createFakeWin();
		let frames = 0;
		const session = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				frames += 1;
			},
		});

		session.scheduleFrame();
		fake.flushFrame();
		session.scheduleFrame();
		fake.flushFrame();

		expect(frames).toBe(2);
	});

	it('end() 幂等：重复调用不重复摘监听、也不误取消新帧', () => {
		const fake = createFakeWin();
		const session = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => undefined,
		});

		session.end();
		session.end();
		session.end();

		expect(fake.listenerCount()).toBe(0);
	});

	it('end() 取消在途帧：陈旧 onFrame 不得落地（引擎重建/视图关闭守卫）', () => {
		const fake = createFakeWin();
		let frames = 0;
		const session = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				frames += 1;
			},
		});

		session.scheduleFrame();
		expect(fake.pendingFrames()).toBe(1);

		session.end();
		expect(fake.pendingFrames()).toBe(0);
		expect(frames).toBe(0);
	});

	it('end() 之后再 scheduleFrame 不会重新排期（陈旧会话不得复活）', () => {
		const fake = createFakeWin();
		let frames = 0;
		const session = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				frames += 1;
			},
		});

		session.end();
		session.scheduleFrame();
		fake.flushFrame();

		expect(fake.pendingFrames()).toBe(0);
		expect(frames).toBe(0);
	});

	it('mouseup：先撤监听再回调 onUp（onUp 提交最终状态时不应再有残留监听）', () => {
		const fake = createFakeWin();
		const order: string[] = [];
		const session = startWindowDragSession({
			win: fake.win,
			capture: true,
			onMove: () => undefined,
			onFrame: () => undefined,
			onUp: () => {
				order.push(`onUp:listeners=${String(fake.listenerCount())}`);
			},
		});
		expect(fake.listenerCount()).toBe(2);

		fake.fire('mouseup');

		expect(order).toEqual(['onUp:listeners=0']);
		expect(fake.listenerCount()).toBe(0);
		// 收尾后 onUp 再被调用也不应重复（监听已摘）
		session.end();
		expect(order).toHaveLength(1);
	});

	it('mouseup 会顺带取消在途帧（收尾即终点）', () => {
		const fake = createFakeWin();
		let frames = 0;
		const session = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				frames += 1;
			},
		});

		session.scheduleFrame();
		fake.fire('mouseup');
		fake.flushFrame();

		expect(frames).toBe(0);
		expect(fake.listenerCount()).toBe(0);
	});

	it('两个会话各自独立：收尾一个不影响另一个', () => {
		const fake = createFakeWin();
		let aFrames = 0;
		let bFrames = 0;
		const a = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				aFrames += 1;
			},
		});
		const b = startWindowDragSession({
			win: fake.win,
			onMove: () => undefined,
			onUp: () => undefined,
			onFrame: () => {
				bFrames += 1;
			},
		});

		a.scheduleFrame();
		b.scheduleFrame();
		a.end();
		fake.flushFrame(); // a 的帧被取消，队首是 b 的
		fake.flushFrame();

		expect(aFrames).toBe(0);
		expect(bFrames).toBe(1);
		expect(fake.listenerCount()).toBe(2);
	});
});