/**
 * 错误处理共享件（`core/errors`）单元回归。
 *
 * 覆盖两条导出：
 * - `createWarnOnce`（2026-10-11 收口）：此前「同一根因只告警一次」在
 *   prism-code / math-jax（两处）/ view 各有一份同构实现，连 `MindMap Studio：`
 *   前缀也各写一遍——本文件把收口后的契约钉住；
 * - `notifyError`：i18n 前缀 + 错误消息的拼接（用户可见面）。
 *
 * `createWarnOnce` 的三条契约：
 * ① 首次输出统一前缀 + 正文，此后**同实例**静默（幂等）；
 * ② `detail` 为 `undefined` 时不追加第二参数（避免多写一个空串参数），给出时原样透传；
 * ③ 去重范围＝**返回的函数实例**——模块级实例表达「进程内一次」、视图字段实例表达
 *   「该视图一次」，两种既有语义都必须能表达，故实例之间互不影响。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWarnOnce, notifyError } from '../src/core/errors';
import { t } from '../src/core/i18n';

const h = vi.hoisted(() => ({ noticeCalls: [] as string[] }));

// Notice 桩：obsidian 包无运行时 JS（alias 到 tests/mocks），在此替换以捕获文案
// （与 view-dnd / system-open 两处同款写法）。
vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		Notice: class {
			constructor(message?: string) {
				h.noticeCalls.push(message ?? '');
			}
		},
	};
});

describe('createWarnOnce：内部告警的幂等留痕', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('首次输出统一前缀 + 正文；此后同实例一律静默（含换文案也不再输出）', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const warn = createWarnOnce();

		warn('第一处失败');
		warn('第一处失败');
		warn('同类根因的另一种文案');

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith('MindMap Studio：第一处失败');
	});

	it('detail 省略 / 给出：省略时只传正文一个参数，给出时原样作为第二参数', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const withoutDetail = createWarnOnce();
		withoutDetail('无细节');

		const detail = new Error('boom');
		const withDetail = createWarnOnce();
		withDetail('带细节', detail);

		expect(warnSpy.mock.calls[0]).toEqual(['MindMap Studio：无细节']);
		expect(warnSpy.mock.calls[1]).toEqual(['MindMap Studio：带细节', detail]);
	});

	it('去重范围＝实例：两个实例各告警一次、互不影响（进程级与视图级语义都能表达）', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const processWide = createWarnOnce();
		const perView = createWarnOnce();

		processWide('同一根因');
		perView('同一根因');
		perView('同一根因');

		expect(warnSpy).toHaveBeenCalledTimes(2);
		expect(warnSpy.mock.calls[0]?.[0]).toBe('MindMap Studio：同一根因');
		expect(warnSpy.mock.calls[1]?.[0]).toBe('MindMap Studio：同一根因');
	});
});

describe('notifyError：用户可见提示的文案拼接', () => {
	beforeEach(() => {
		h.noticeCalls.length = 0;
	});

	it('i18n 前缀 + 错误消息（Error 与任意值两种形态都落到 Notice 文案）', () => {
		// 与实现同源取 i18n，避免在测试里硬编码文案
		const prefix = t('zh', 'save.failed');

		notifyError('zh', 'save.failed', new Error('boom'));
		notifyError('zh', 'save.failed', 'plain-error');
		notifyError('en', 'save.failed', new Error('boom'));

		expect(h.noticeCalls).toEqual([
			`${prefix}boom`,
			`${prefix}plain-error`,
			`${t('en', 'save.failed')}boom`,
		]);
	});
});
