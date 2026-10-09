/**
 * `shell.openPath` 结果面化（`src/platform/system-open.ts` 的 `surfaceOpenResult`）直测。
 *
 * 为什么必须直测：Electron 的 `shell.openPath` **从不 reject 表示失败**，而是
 * resolve 一个错误消息串（成功为空串、失败为非空）。原实现 `void shell.openPath(...)`
 * 后直接 return，等于「打不开时零反馈」——用户点「在系统应用中打开」看不出任何反应。
 * 该缺陷**无法用实机稳定复现**（要制造「无关联应用」的环境），故把三条契约钉死：
 * 1. 成功（空串）→ 完全静默（不写 console、不弹提示）；
 * 2. 失败（非空错误串）→ console.error 留痕 + 一条用户可见提示；
 * 3. reject（`shell` 面缺失等）→ 与 2 同一出口，不得产生未处理拒绝。
 *
 * Notice 桩：obsidian 包无运行时 JS（alias 到 tests/mocks），故用 vi.mock 捕获文案。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import { t } from '../src/core/i18n';
import { surfaceOpenResult } from '../src/platform/system-open';

const h = vi.hoisted(() => ({
	/** Notice 文案（按调用顺序） */
	noticeCalls: [] as string[],
}));

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

/** 取出 spy 的全部调用参数并转成字符串，便于整组比对 */
function consoleArgs(spy: { mock: { calls: unknown[][] } }): string[][] {
	return spy.mock.calls.map((call) => call.map((value) => String(value)));
}

const ZH = 'zh' as const;
/** 用户可见的失败提示（与实现同源取 i18n，避免在测试里硬编码文案） */
const systemOpenFailed = t(ZH, 'common.systemOpenFailed');

describe('surfaceOpenResult（shell.openPath 结果面化）', () => {
	let errorSpy: unknown;

	beforeEach(() => {
		h.noticeCalls.length = 0;
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
			// 静默：错误路径本身是要断言的输出
		});
	});

	it('成功（resolve 空串）→ 完全静默：不写 console、不弹提示', async () => {
		surfaceOpenResult(Promise.resolve(''), '笔记/报告.pdf', ZH);
		await vi.waitFor(() => {
			expect(h.noticeCalls).toEqual([]);
		});
		expect(consoleArgs(errorSpy as { mock: { calls: unknown[][] } })).toEqual(
			[],
		);
		expect(Notice).toBeDefined();
	});

	it('失败（resolve 非空错误串）→ console 留痕 + 一条可见提示', async () => {
		surfaceOpenResult(Promise.resolve('No application found'), '报告.pdf', ZH);

		await vi.waitFor(() => {
			expect(h.noticeCalls).toEqual([systemOpenFailed]);
		});
		expect(consoleArgs(errorSpy as { mock: { calls: unknown[][] } })).toEqual([
			['系统应用打开失败:', '报告.pdf', 'No application found'],
		]);
		// 反向护栏：这里的主因是「无关联应用」，不是「文件类型不受支持」，
		// 故不得复用 cannotOpen（语义不同源，见 i18n 注释）
		expect(systemOpenFailed).not.toBe(t(ZH, 'common.cannotOpen'));
	});

	it('reject → 与错误串同一出口（不留未处理拒绝、仍有一条提示）', async () => {
		surfaceOpenResult(Promise.reject(new Error('shell 不可用')), 'a.txt', ZH);

		await vi.waitFor(() => {
			expect(h.noticeCalls).toEqual([systemOpenFailed]);
		});
		const calls = consoleArgs(errorSpy as { mock: { calls: unknown[][] } });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[0]).toBe('系统应用打开失败:');
		expect(calls[0]?.[1]).toBe('a.txt');
	});

	it('英文提示随 lang 切换（双语对齐，硬规则 8）', async () => {
		surfaceOpenResult(Promise.resolve('failed'), 'a.txt', 'en');

		await vi.waitFor(() => {
			expect(h.noticeCalls).toEqual([t('en', 'common.systemOpenFailed')]);
		});
		expect(t('en', 'common.systemOpenFailed')).not.toBe(systemOpenFailed);
	});
});