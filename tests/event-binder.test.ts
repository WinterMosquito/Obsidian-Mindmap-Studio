/**
 * EventBinder 回归测试（src/event-binder.ts）。
 *
 * 该模块存在的唯一理由是「注册即记录、销毁即清理」——它替掉了视图里
 * 10+ 个 boundHandle* 字段的手工配对维护。所以本套用例只围绕这条契约取证：
 *
 * - 注册参数（type/listener/options、emitter/event/listener）原样透传，
 *   不做任何包装改写；
 * - destroy 移走的必须是注册时那一个监听器引用（身份一致）：
 *   removeEventListener 靠引用相等匹配，包一层箭头函数就会静默泄漏；
 * - destroy 幂等，且清空记录后新一轮注册仍被正确清理；
 * - 单个目标抛错（元素已脱离 DOM / 引擎已销毁）不阻断其余条目的清理；
 * - DOM 条目与引擎条目在一次 destroy 中都被清掉。
 *
 * target/emitter 都是结构化类型，故用普通对象桩即可，无需 DOM 环境。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBinder } from '../src/event-binder';
import type { EventTargetLike } from '../src/event-binder';

interface DomCall {
	type: string;
	listener: EventListenerOrEventListenerObject;
	options?: boolean | AddEventListenerOptions;
}

/** DOM 目标桩：记录 add/removeEventListener 的完整入参 */
function makeDomTarget(throwOnRemove = false) {
	const added: DomCall[] = [];
	const removed: DomCall[] = [];
	const target: EventTargetLike = {
		addEventListener(type, listener, options) {
			added.push({ type, listener, options });
		},
		removeEventListener(type, listener, options) {
			// 模拟元素已脱离 DOM 时浏览器/框架抛错
			if (throwOnRemove) {
				throw new Error('target detached');
			}
			removed.push({ type, listener, options });
		},
	};
	return { target, added, removed };
}

/** 引擎 emitter 桩：记录 on/off 的 (event, listener) */
function makeEmitter(throwOnOff = false) {
	const onCalls: { event: string; listener: unknown }[] = [];
	const offCalls: { event: string; listener: unknown }[] = [];
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

	it('注册入参原样透传给 addEventListener（type/listener/options）', () => {
		const { target, added } = makeDomTarget();
		const listener = vi.fn();
		const options = { passive: true };
		binder.onDom(target, 'click', listener, options);

		expect(added).toHaveLength(1);
		// listener 是同一个函数对象（不是包装后的 handler）
		expect(added[0]!.listener).toBe(listener);
		expect(added[0]!.type).toBe('click');
		expect(added[0]!.options).toBe(options);
	});

	it('不传 options 时注册与移除都保持 undefined（不伪造默认值）', () => {
		const { target, added, removed } = makeDomTarget();
		binder.onDom(target, 'keydown', vi.fn());

		expect(added[0]!.options).toBeUndefined();
		binder.destroy();
		// removeEventListener 的第三参必须与注册时一致：布尔/对象形态不匹配时
		// 浏览器不保证移除（capture 标记参与匹配），故这里断言同为 undefined
		expect(removed[0]!.options).toBeUndefined();
	});

	it('destroy 移除的是同一监听器与同一 options 引用（身份一致）', () => {
		const { target, added, removed } = makeDomTarget();
		const options: AddEventListenerOptions = { capture: true };
		binder.onDom(target, 'pointerdown', vi.fn(), options);
		// 注册即记录，但不提前清理
		expect(removed).toHaveLength(0);

		binder.destroy();
		expect(removed).toHaveLength(1);
		expect(removed[0]!.type).toBe('pointerdown');
		expect(removed[0]!.listener).toBe(added[0]!.listener);
		expect(removed[0]!.options).toBe(options);
	});

	it('多条注册按注册顺序逐条移除（不同目标、不同类型）', () => {
		const a = makeDomTarget();
		const b = makeDomTarget();
		binder.onDom(a.target, 'click', vi.fn());
		binder.onDom(a.target, 'keydown', vi.fn());
		binder.onDom(b.target, 'input', vi.fn());

		binder.destroy();
		expect(a.removed.map((c) => c.type)).toEqual(['click', 'keydown']);
		expect(b.removed.map((c) => c.type)).toEqual(['input']);
	});

	it('destroy 幂等：重复调用不重复移除', () => {
		const { target, removed } = makeDomTarget();
		binder.onDom(target, 'click', vi.fn());

		binder.destroy();
		binder.destroy();
		binder.destroy();
		expect(removed).toHaveLength(1);
	});

	it('destroy 后记录已清空：新一轮注册在新作用域内被正常清理', () => {
		const first = makeDomTarget();
		const second = makeDomTarget();
		binder.onDom(first.target, 'click', vi.fn());
		binder.destroy();

		// 引擎/视图重建后复用同一 binder：旧条目不得再被移除第二次
		binder.onDom(second.target, 'input', vi.fn());
		binder.destroy();

		expect(first.removed).toHaveLength(1);
		expect(second.removed).toHaveLength(1);
		expect(second.removed[0]!.type).toBe('input');
	});

	it('单个目标的移除抛错不阻断其余条目的清理', () => {
		const bad = makeDomTarget(true);
		const good = makeDomTarget();
		binder.onDom(bad.target, 'click', vi.fn());
		binder.onDom(good.target, 'input', vi.fn());

		expect(() => binder.destroy()).not.toThrow();
		expect(good.removed).toHaveLength(1);
		// 抛错条目也被丢弃记录：再次 destroy 不重复尝试
		binder.destroy();
		expect(good.removed).toHaveLength(1);
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

		expect(emitter.onCalls).toHaveLength(1);
		expect(emitter.onCalls[0]!.event).toBe('data_change');
		expect(emitter.onCalls[0]!.listener).toBe(listener);
		expect(emitter.offCalls).toHaveLength(0);

		binder.destroy();
		expect(emitter.offCalls).toHaveLength(1);
		// 引擎按引用 off：事件名与监听器都必须是注册时那一份
		expect(emitter.offCalls[0]!.event).toBe('data_change');
		expect(emitter.offCalls[0]!.listener).toBe(listener);
	});

	it('多 emitter 多事件混合注册：逐条 off 到各自的 emitter', () => {
		const a = makeEmitter();
		const b = makeEmitter();
		binder.onEngine(a, 'data_change', vi.fn());
		binder.onEngine(a, 'node_img_click', vi.fn());
		binder.onEngine(b, 'node_dragend', vi.fn());

		binder.destroy();
		expect(a.offCalls.map((c) => c.event)).toEqual([
			'data_change',
			'node_img_click',
		]);
		expect(b.offCalls.map((c) => c.event)).toEqual(['node_dragend']);
	});

	it('同一监听器注册到不同事件时按条目各自 off（条目独立于监听器身份）', () => {
		const emitter = makeEmitter();
		const shared = vi.fn();
		binder.onEngine(emitter, 'data_change', shared);
		binder.onEngine(emitter, 'node_dragend', shared);

		binder.destroy();
		expect(emitter.offCalls).toHaveLength(2);
		expect(emitter.offCalls.map((c) => c.event)).toEqual([
			'data_change',
			'node_dragend',
		]);
		expect(emitter.offCalls.every((c) => c.listener === shared)).toBe(true);
	});

	it('单个 emitter.off 抛错不阻断其余清理（引擎已销毁场景）', () => {
		const bad = makeEmitter(true);
		const good = makeEmitter();
		binder.onEngine(bad, 'data_change', vi.fn());
		binder.onEngine(good, 'node_click', vi.fn());

		expect(() => binder.destroy()).not.toThrow();
		expect(good.offCalls).toHaveLength(1);
		// 幂等：再次 destroy 不重复 off
		binder.destroy();
		expect(good.offCalls).toHaveLength(1);
	});

	it('destroy 幂等：引擎条目同样不重复 off', () => {
		const emitter = makeEmitter();
		binder.onEngine(emitter, 'data_change', vi.fn());

		binder.destroy();
		binder.destroy();
		expect(emitter.offCalls).toHaveLength(1);
	});
});

describe('EventBinder.destroy（两类事件一次性收口）', () => {
	it('DOM 条目与引擎条目在同一轮 destroy 中都被清理', () => {
		const binder = new EventBinder();
		const log: string[] = [];
		const target: EventTargetLike = {
			addEventListener: () => {},
			removeEventListener: (type) => {
				log.push(`dom:${type}`);
			},
		};
		const emitter = {
			on: () => {},
			off: (event: string) => {
				log.push(`engine:${event}`);
			},
		};
		binder.onDom(target, 'click', vi.fn());
		binder.onEngine(emitter, 'data_change', vi.fn());

		binder.destroy();
		// 两类都清掉了（顺序即实现顺序：先 DOM 后引擎，视图侧只依赖"都清掉"）
		expect(log).toEqual(['dom:click', 'engine:data_change']);
	});

	it('未注册任何事件时 destroy 无副作用', () => {
		const binder = new EventBinder();
		expect(() => binder.destroy()).not.toThrow();
	});
});
