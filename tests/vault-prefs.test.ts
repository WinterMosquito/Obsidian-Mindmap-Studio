/**
 * 官方库级偏好读取（src/platform/vault-prefs.ts）回归。
 *
 * 这三项决定本插件的**写入形态与引用维护**是否跟随官方设置，故「方法缺失 /
 * 读到非法值」必须落回**官方默认**，绝不能变成行为变化：
 * - `useMarkdownLinks` 缺省 false（写 `[[双链]]`）；
 * - `newLinkFormat` 缺省 `shortest`；
 * - `alwaysUpdateLinks` 缺省 **true**——2026-10-09 起本插件不再自带同名开关
 *   （原 `settings.autoUpdateLinks` 已删），「重命名/删除是否改写引用」的判定
 *   完全落在这一处；读成 false 会让所有存量用户的引用更新静默失效。
 *
 * `vault.getConfig` 是未入 obsidian.d.ts 的内部接口（读取方式收口在本文件、
 * 防御式实现）：这里同时锁「方法不存在」与「调用抛错」两条退化路径。
 */
import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import {
	preferredLinkPathFormat,
	prefersMarkdownLinks,
	updatesInternalLinksOnRename,
} from '../src/platform/vault-prefs';

/** 伪造宿主：只提供 vault.getConfig（缺失 / 抛错两种退化由用例单独构造） */
function fakeApp(getConfig: ((key: string) => unknown) | undefined): App {
	return Object.assign(new App(), {
		vault: getConfig ? { getConfig } : {},
	});
}

/** 按官方配置键返回定值的 getConfig（未登记的键 → undefined，即「用户没动过」） */
function configWith(values: Record<string, unknown>) {
	return vi.fn((key: string): unknown => values[key]);
}

describe('prefersMarkdownLinks（官方「使用 [[Wikilinks]]」）', () => {
	it('关闭（true）才返回 true：官方默认 false = 写双链', () => {
		expect(prefersMarkdownLinks(fakeApp(configWith({ useMarkdownLinks: true })))).toBe(
			true,
		);
		expect(
			prefersMarkdownLinks(fakeApp(configWith({ useMarkdownLinks: false }))),
		).toBe(false);
		// 用户没动过该开关：配置里没有这个键 → 官方默认（双链）
		expect(prefersMarkdownLinks(fakeApp(configWith({})))).toBe(false);
	});

	it('读到非法值 / 方法缺失 / 抛错：一律按官方默认（false）', () => {
		expect(
			prefersMarkdownLinks(fakeApp(configWith({ useMarkdownLinks: 'yes' }))),
		).toBe(false);
		expect(prefersMarkdownLinks(fakeApp(undefined))).toBe(false);
		expect(
			prefersMarkdownLinks(
				fakeApp(() => {
					throw new Error('internal api changed');
				}),
			),
		).toBe(false);
	});
});

describe('preferredLinkPathFormat（官方「New link format」）', () => {
	it('三项白名单：relative / absolute 原样，shortest 与缺失同义', () => {
		expect(
			preferredLinkPathFormat(fakeApp(configWith({ newLinkFormat: 'relative' }))),
		).toBe('relative');
		expect(
			preferredLinkPathFormat(fakeApp(configWith({ newLinkFormat: 'absolute' }))),
		).toBe('absolute');
		expect(
			preferredLinkPathFormat(fakeApp(configWith({ newLinkFormat: 'shortest' }))),
		).toBe('shortest');
		expect(preferredLinkPathFormat(fakeApp(configWith({})))).toBe('shortest');
	});

	it('非法值 / 方法缺失 / 抛错：回退 shortest（不产生第三形态）', () => {
		expect(
			preferredLinkPathFormat(fakeApp(configWith({ newLinkFormat: 'bogus' }))),
		).toBe('shortest');
		expect(preferredLinkPathFormat(fakeApp(undefined))).toBe('shortest');
		expect(
			preferredLinkPathFormat(
				fakeApp(() => {
					throw new Error('internal api changed');
				}),
			),
		).toBe('shortest');
	});
});

describe('updatesInternalLinksOnRename（官方「自动更新内部链接」）', () => {
	it('显式开启 / 关闭按配置取值', () => {
		expect(
			updatesInternalLinksOnRename(fakeApp(configWith({ alwaysUpdateLinks: true }))),
		).toBe(true);
		expect(
			updatesInternalLinksOnRename(fakeApp(configWith({ alwaysUpdateLinks: false }))),
		).toBe(false);
	});

	/**
	 * 判据取 `!== false` 而非 `=== true`：该键在用户从未动过开关时**不存在**
	 * 于配置里（官方 UI 默认即开）——`undefined` 必须读作「开」，否则本插件
	 * 会在升级后静默停止更新引用（正是「读不到设置＝行为变化」那条禁令）。
	 */
	it('缺失（用户没动过开关）= 官方默认开启；非法值同样按开启处理', () => {
		expect(updatesInternalLinksOnRename(fakeApp(configWith({})))).toBe(true);
		expect(
			updatesInternalLinksOnRename(
				fakeApp(configWith({ alwaysUpdateLinks: undefined })),
			),
		).toBe(true);
		expect(updatesInternalLinksOnRename(fakeApp(undefined))).toBe(true);
		expect(
			updatesInternalLinksOnRename(
				fakeApp(() => {
					throw new Error('internal api changed');
				}),
			),
		).toBe(true);
	});
});
