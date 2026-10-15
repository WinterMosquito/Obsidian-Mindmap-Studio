/**
 * 系统剪贴板 IO 收口（`platform/clipboard`）的语义回归。
 *
 * 为什么需要直测：唯一消费方（`features/view-clipboard`）把它整模块 mock 掉，
 * 于是三条**失败语义**此前只验证了 mock 自己——
 * - 成功回 `true`／写失败**留痕一次**并回 `false`（**不抛**，由调用方提示）；
 * - 读失败／`navigator.clipboard` 不可用回 `null`（与「剪贴板为空」区分）；
 * - 写入按**调用方属主文档**取 navigator（popout 场景按钮/菜单挂副窗口文档，
 *   取主窗口 navigator 在焦点判定下可能被拒）。
 *
 * Node 环境的 `navigator` 是只读 getter，故整体 `vi.stubGlobal` 替换。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	readClipboardText,
	writeClipboardText,
} from '../src/platform/clipboard';

/** 属主文档桩：只提供 `defaultView.navigator.clipboard.writeText` 这一条链 */
function ownerDocumentWith(writeText: (text: string) => Promise<void>): Document {
	return {
		defaultView: { navigator: { clipboard: { writeText } } },
	} as unknown as Document;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('writeClipboardText', () => {
	it('成功：把文本交给宿主并回 true', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		await expect(writeClipboardText('hello')).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith('hello');
	});

	it('宿主拒绝：留痕一次、回 false、不外抛', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('denied');
				},
			},
		});

		await expect(writeClipboardText('x')).resolves.toBe(false);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('`navigator.clipboard` 整体缺失（受限宿主/老运行时）：同样回 false 且不外抛', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('navigator', {});

		await expect(writeClipboardText('x')).resolves.toBe(false);
	});

	it('popout：传属主文档时取该文档窗口的 navigator（不碰主窗口）', async () => {
		const mainWrite = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText: mainWrite } });
		const popoutWrite = vi.fn(async () => undefined);

		await expect(
			writeClipboardText('x', ownerDocumentWith(popoutWrite)),
		).resolves.toBe(true);
		expect(popoutWrite).toHaveBeenCalledWith('x');
		expect(mainWrite).not.toHaveBeenCalled();
	});

	it('属主文档缺失窗口（生命周期边界）：回落到全局 navigator 而非抛错', async () => {
		const mainWrite = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText: mainWrite } });

		const detached = { defaultView: null } as unknown as Document;
		await expect(writeClipboardText('x', detached)).resolves.toBe(true);
		expect(mainWrite).toHaveBeenCalledWith('x');
	});
});

describe('readClipboardText', () => {
	it('成功：回宿主给出的文本（含空串——空串与读失败语义不同）', async () => {
		vi.stubGlobal('navigator', {
			clipboard: { readText: async () => 'from clipboard' },
		});
		await expect(readClipboardText()).resolves.toBe('from clipboard');

		vi.stubGlobal('navigator', {
			clipboard: { readText: async () => '' },
		});
		await expect(readClipboardText()).resolves.toBe('');
	});

	it('宿主拒绝 / 不可用：留痕并回 null（调用方据此提示，与「空剪贴板」分开）', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.stubGlobal('navigator', {
			clipboard: {
				readText: async () => {
					throw new Error('denied');
				},
			},
		});
		await expect(readClipboardText()).resolves.toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);

		vi.stubGlobal('navigator', {});
		await expect(readClipboardText()).resolves.toBeNull();
	});
});
