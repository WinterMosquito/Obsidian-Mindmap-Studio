/**
 * 标签搜索私有触点（`platform/tag-search`）回归。
 *
 * 两件事：
 * - 命中官方搜索插件时，查询串必须是 `tag:#名称`（`#` 只补一次）；
 * - 私有面缺失时**只提示一次**（每次点击都弹 Notice 属噪声），且不抛错。
 */
import { describe, expect, it, vi } from 'vitest';

/** 每个用例重新加载模块：`reportedMissing` 是模块级会话标记 */
async function loadModule() {
	vi.resetModules();
	return import('../src/platform/tag-search');
}

describe('openTagSearch（私有触点）', () => {
	it('命中官方搜索插件：查询串为 tag:#名称', async () => {
		const openGlobalSearch = vi.fn();
		const app = {
			internalPlugins: {
				getPluginById: (id: string) =>
					id === 'global-search' ? { instance: { openGlobalSearch } } : null,
			},
		};
		const { openTagSearch } = await loadModule();
		openTagSearch(app as never, '#项目/子项目', 'zh');
		expect(openGlobalSearch).toHaveBeenCalledTimes(1);
		expect(openGlobalSearch).toHaveBeenCalledWith('tag:#项目/子项目');
	});

	it('传入不带 # 的名称同样只补一个 #', async () => {
		const openGlobalSearch = vi.fn();
		const app = {
			internalPlugins: {
				getPluginById: () => ({ instance: { openGlobalSearch } }),
			},
		};
		const { openTagSearch } = await loadModule();
		openTagSearch(app as never, '项目', 'zh');
		expect(openGlobalSearch).toHaveBeenCalledWith('tag:#项目');
	});

	it('私有面缺失：只提示一次、不抛错', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { openTagSearch } = await loadModule();
		const app = {};
		expect(() => openTagSearch(app as never, 'a', 'zh')).not.toThrow();
		openTagSearch(app as never, 'b', 'zh');
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('插件存在但实例缺少入口：同缺失路径', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { openTagSearch } = await loadModule();
		const app = {
			internalPlugins: { getPluginById: () => ({ instance: {} }) },
		};
		openTagSearch(app as never, 'a', 'zh');
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	it('空名称直接返回（不查插件、不提示）', async () => {
		const getPluginById = vi.fn();
		const { openTagSearch } = await loadModule();
		openTagSearch({ internalPlugins: { getPluginById } } as never, '#', 'zh');
		expect(getPluginById).not.toHaveBeenCalled();
	});
});
