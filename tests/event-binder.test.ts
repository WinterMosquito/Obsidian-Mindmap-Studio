/**
 * EventBinder 回归测试（event-binder.ts）。
 *
 * 覆盖「注册即记录、销毁即清理」契约：
 * - onDom/onEngine 注册参数原样透传（type/listener/options、emitter/event）；
 * - destroy 移除的与注册的是同一监听器引用（身份一致性）；
 * - destroy 幂等（重复调用不重复移除）；
 * - destroy 中单个目标抛错不阻断其余清理。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBinder } from '../src/event-binder';
import type { EventTargetLike } from '../src/event-binder';

/** DOM 目标桩：记录 add/removeEventListener 调用 */
function makeDomTarget() {
	const added: Array<{
		type: string;
		listener: EventListenerOrEventListenerObject;
		options?: boolean | AddEventListenerOptions;
	}> = [];
	const removed: Array<{ type: string; listener: unknown }> = [];
	const target: EventTargetLike = {
		addEventListener(type, listener, options) {
			added.push({ type, listener, options });
		},
		removeEventListener(type, listener) {
			removed.push({ type, listener });
		},
	};
	return { target, added, removed };
}

/** 引擎 emitter 桩：记录 on/off 调用 */
function makeEmitter(throwOnOff = false) {
	const onCalls: Array<{ event: string; listener: unknown }> = [];
	const offCalls: Array<{ event: string; listener: unknown }> = [];
	return {
		on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
			onCalls.push({ event, listener });
		}),
		off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
			if (throwOnOff) {
				throw new Error('emitter already destroyed');
			}
			offCalls.push({ event, listener });
		}),
		onCalls,
		offCalls,
	};
}

describe('EventBinder.onDom（DOM 事件注册与清理）', () => {
	let binder: EventBinder;
	beforeEach(() => {
		binder = new EventBinder();
	});

	it('注册参数原样透传给 addEventListener', () => {
		const { target, added } = makeDomTarget();
		const listener = vi.fn();
		const options = { passive: true };
		binder.onDom(target, 'click', listener, options);
		expect(added).toHaveLength(1);
		expect(added[0]).toMatchObject({ type: 'click', listener, options });
	});

	it('destroy 移除的是同一监听器引用（身份一致）', () => {
		const { target, added, removed } = makeDomTarget();
		const listener = vi.fn();
		binder.onDom(target, 'keydown', listener);
		expect(removed).toHaveLength(0);
		binder.destroy();
		expect(removed).toHaveLength(1);
		expect(removed[0]!.type).toBe('keydown');
		expect(removed[0]!.listener).toBe(added[0]!.listener);
	});

	it('destroy 幂等：重复调用不重复移除', () => {
		const { target, removed } = makeDomTarget();
		binder.onDom(target, 'click', vi.fn());
		binder.destroy();
		binder.destroy();
		expect(removed).toHaveLength(1);
	});

	it('destroy 后注册的监听器在新一轮记录中正常清理', () => {
		const first = makeDomTarget();
		const second = makeDomTarget();
		binder.onDom(first.target, 'click', vi.fn());
		binder.destroy();
		expect(first.removed).toHaveLength(1);
		binder.onDom(second.target, 'input', vi.fn());
		binder.destroy();
		expect(second.removed).toHaveLength(1);
		expect(second.removed[0]!.type).toBe('input');
	});
});

describe('EventBinder.onEngine（引擎事件注册与清理）', () => {
	let binder: EventBinder;
	beforeEach(() => {
		binder = new EventBinder();
	});

	it('on/off 使用同一 emitter、事件名与监听器引用', () => {
		const emitter = makeEmitter();
		const listener = vi.fn();
		binder.onEngine(emitter, 'data_change', listener);
		expect(emitter.onCalls[0]).toMatchObject({ event: 'data_change' });
		binder.destroy();
		expect(emitter.offCalls).toHaveLength(1);
		expect(emitter.offCalls[0]).toMatchObject({
			event: 'data_change',
			listener: emitter.onCalls[0]!.listener,
		});
	});

	it('多事件混合注册：destroy 逐条清理', () => {
		const a = makeEmitter();
		const b = makeEmitter();
		binder.onEngine(a, 'data_change', vi.fn());
		binder.onEngine(a, 'node_click', vi.fn());
		binder.onEngine(b, 'node_dragend', vi.fn());
		binder.destroy();
		expect(a.offCalls).toHaveLength(2);
		expect(b.offCalls).toHaveLength(1);
	});

	it('单个 emitter.off 抛错不阻断其余清理（引擎已销毁场景）', () => {
		const bad = makeEmitter(true);
		const good = makeEmitter();
		binder.onEngine(bad, 'data_change', vi.fn());
		binder.onEngine(good, 'node_click', vi.fn());
		expect(() => binder.destroy()).not.toThrow();
		expect(good.offCalls).toHaveLength(1);
		// 幂等：再次 destroy 不重复调用
		binder.destroy();
		expect(good.offCalls).toHaveLength(1);
	});
});
