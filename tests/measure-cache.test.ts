/**
 * 离屏测量缓存键（core/measure-cache）单元回归。
 *
 * 实机根因（K114，2026-10-06，Obsidian 1.14.4 / MathJax 4.1.3，测试库 `Mindmap`）：
 * 引擎 `measureCustomNodeContentSize`（vendor `simple-mind-map.cjs` 的 `$l`）把测量
 * 结果按**元素 `outerHTML`** 缓存进 vendor **模块级** `St` Map——键不含字体状态、
 * 不含引擎代际。MathJax 字体渐进加载后同一段公式的自然宽会变而 `outerHTML` 不变
 * ⇒ 重测命中偏小的旧宽度 ⇒ `foreignObject` 宽度小于内容自然宽 ⇒ 内容被迫换行
 * （高度需求翻倍）而 `foreignObject` 高度不变 ⇒ `overflow:hidden` 裁掉底部。
 *
 * 实机量化：宽度只差 4px 即触发（自然宽 119 / foW 115 ⇒ 内容高 28→45、垂直
 * 溢出 17px）。
 *
 * 契约：键 = `<fonts.status>:<epoch>`；epoch 在每次 `loadingdone` 与
 * `fonts.ready` 时递增 ⇒ 字体状态不变时键稳定（缓存命中、零额外测量），字体
 * 状态一变键必变（缓存 miss ⇒ 引擎真实重测）。
 *
 * **每例都 `vi.resetModules()` 后重新 import**：模块的「监听只装配一次」是生产
 * 语义（单 document 生命周期内只装一次），故用真模块隔离，而不是加测试专用重置
 * 导出。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type MeasureCache = typeof import('../src/core/measure-cache');

/** 字体面桩：记录 loadingdone 监听器，便于手动触发 */
interface FontsStub {
	status: string;
	/** 手动触发一次 loadingdone（模拟一批字体加载完成） */
	fireLoadingDone(): void;
	/** loadingdone 监听器注册次数（用于断言只装一次） */
	listenerCount(): number;
}

function setDocument(doc: unknown): void {
	(globalThis as { document?: unknown }).document = doc;
}

function clearDocument(): void {
	delete (globalThis as { document?: unknown }).document;
}

function makeFonts(status: string, withReady = false): FontsStub {
	const listeners: (() => void)[] = [];
	const stub: FontsStub = {
		status,
		fireLoadingDone: () => {
			for (const fn of listeners) {
				fn();
			}
		},
		listenerCount: () => listeners.length,
	};
	setDocument({
		fonts: {
			get status() {
				return stub.status;
			},
			addEventListener: (type: string, fn: () => void) => {
				if (type === 'loadingdone') {
					listeners.push(fn);
				}
			},
			...(withReady ? { ready: Promise.resolve() } : {}),
		},
	});
	return stub;
}

/** 全新模块实例（重置「已装配」标记与 epoch 计数） */
async function freshModule(): Promise<MeasureCache> {
	vi.resetModules();
	return import('../src/core/measure-cache');
}

describe('measure-cache：字体代际缓存键（K114）', () => {
	afterEach(() => {
		clearDocument();
	});

	it('无 document：返回 none:0，不抛错（node 环境安全）', async () => {
		clearDocument();
		const m = await freshModule();
		expect(m.fontMeasureKey()).toBe('none:0');
		expect(m.currentFontEpoch()).toBe(0);
	});

	it('宿主无 document.fonts 面：按 none 处理，键稳定', async () => {
		setDocument({});
		const m = await freshModule();
		const first = m.fontMeasureKey();
		expect(first).toBe(`none:${m.currentFontEpoch()}`);
		expect(m.fontMeasureKey()).toBe(first);
	});

	it('同一字体状态下键恒定 ⇒ 引擎测量缓存照常命中（零额外测量）', async () => {
		makeFonts('loading', false);
		const m = await freshModule();
		const a = m.fontMeasureKey();
		const b = m.fontMeasureKey();
		const c = m.fontMeasureKey();
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('loadingdone 触发后键必变 ⇒ 强制 cache miss（字体分批到达）', async () => {
		const fonts = makeFonts('loading', false);
		const m = await freshModule();
		const before = m.fontMeasureKey();
		fonts.fireLoadingDone();
		const after = m.fontMeasureKey();
		expect(after).not.toBe(before);
		expect(m.currentFontEpoch()).toBe(1);
	});

	it('多次 loadingdone：epoch 逐次递增（MathJax 24 条 @font-face 分批加载）', async () => {
		const fonts = makeFonts('loading', false);
		const m = await freshModule();
		m.fontMeasureKey(); // 先装配监听
		const base = m.currentFontEpoch();
		fonts.fireLoadingDone();
		fonts.fireLoadingDone();
		fonts.fireLoadingDone();
		expect(m.currentFontEpoch()).toBe(base + 3);
	});

	it('字体状态变化（loading → loaded）：键亦改变（状态段参与键）', async () => {
		const fonts = makeFonts('loading', false);
		const m = await freshModule();
		const before = m.fontMeasureKey();
		fonts.status = 'loaded';
		const after = m.fontMeasureKey();
		expect(after).not.toBe(before);
		expect(after.startsWith('loaded:')).toBe(true);
	});

	it('监听只装配一次（多次调用不重复 addEventListener）', async () => {
		const fonts = makeFonts('loading', false);
		const m = await freshModule();
		m.fontMeasureKey();
		m.fontMeasureKey();
		m.fontMeasureKey();
		expect(fonts.listenerCount()).toBe(1);
	});

	it('fonts.ready 兑现后 epoch 递增一次', async () => {
		makeFonts('loading', true);
		const m = await freshModule();
		const base = m.currentFontEpoch();
		m.fontMeasureKey(); // 触发惰性装配
		await Promise.resolve();
		await Promise.resolve();
		expect(m.currentFontEpoch()).toBe(base + 1);
	});

	it('fonts.ready 被拒绝：不抛错、不中断', async () => {
		setDocument({
			fonts: {
				status: 'loading',
				addEventListener: () => {
					/* noop */
				},
				// 惰性 getter：Promise 在模块读取并**同一同步块内**挂上处理器，
				// 避免出现「已拒绝但尚未挂处理器」的窗口（Node 会报未捕获拒绝）
				get ready(): Promise<unknown> {
					return Promise.reject(new Error('boom'));
				},
			},
		});
		const m = await freshModule();
		expect(() => m.fontMeasureKey()).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();
		expect(() => m.fontMeasureKey()).not.toThrow();
	});

	it('addEventListener 抛异常：静默降级（键仍可用、epoch 不递增）', async () => {
		setDocument({
			fonts: {
				status: 'loading',
				addEventListener: () => {
					throw new Error('nope');
				},
			},
		});
		const m = await freshModule();
		expect(m.fontMeasureKey()).toBe('loading:0');
		expect(() => m.fontMeasureKey()).not.toThrow();
	});
});