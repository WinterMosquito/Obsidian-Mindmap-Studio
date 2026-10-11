/**
 * 官方库级偏好（`设置 → 文件与链接`）的读取：本插件的**写入形态与引用维护**都跟随
 * 官方设置，不另设同名开关（2026-10-09 减法删掉了重复的 `autoUpdateLinks`）。
 *
 * 三项与写入/引用直接相关的官方偏好：
 * - `useMarkdownLinks`（「使用 \[\[Wikilinks\]\]」）：关闭 → 新建的链接与图片
 *   写 md 形态 `[显示名](路径.md)` / `![alt](路径.png)`（官方帮助
 *   `en/User interface/Settings.md`：该设置同时管 links 与 images）；
 * - `newLinkFormat`（「New link format」）：新建链接的**路径形态**——最短路径 /
 *   相对路径 / 绝对路径（官方帮助 `Settings.md` 三选一，默认最短路径）；
 * - `alwaysUpdateLinks`（「自动更新内部链接」，官方默认开启）：关闭 → 重命名/删除
 *   文件时不再改写导图内的引用（见 `updatesInternalLinksOnRename`）。
 *
 * `vault.getConfig` 是**内部接口**（obsidian.d.ts 未声明），但它是社区读取这几项
 * 设置的通行方式；读取失败或值非法时按**官方默认**返回（Wikilinks 开 + 最短路径 +
 * 自动更新链接开），不改变既有行为——不可把「读不到设置」变成行为变化。
 */
import type { App } from 'obsidian';
import type { LinkPathFormat } from '../domain/wikilink';

function readVaultConfig(app: App, key: string): unknown {
	// 官方 d.ts 未声明 getConfig；按可选类型收窄，避免 any 扩散
	const vault = app.vault as
		| { getConfig?: (key: string) => unknown }
		| undefined;
	try {
		return vault?.getConfig?.(key);
	} catch {
		return undefined;
	}
}

/**
 * 官方「使用 \[\[Wikilinks\]\]」是否**关闭**（关闭 = 写 md 链接/图片形态）。
 * 默认（false）= 写 `\[\[双链\]\]`，与官方默认一致。
 */
export function prefersMarkdownLinks(app: App): boolean {
	return readVaultConfig(app, 'useMarkdownLinks') === true;
}

/**
 * 官方「New link format」（默认 `shortest`）。
 *
 * 仅在**新建**链接时生效：既有链接改写沿用用户原始前缀（见
 * `view-node-actions.applyDocWikiLink` 与 links-tree 的引用更新口径）。
 */
export function preferredLinkPathFormat(app: App): LinkPathFormat {
	const value = readVaultConfig(app, 'newLinkFormat');
	return value === 'relative' || value === 'absolute' ? value : 'shortest';
}

/**
 * 官方「自动更新内部链接」是否**开启**（默认开启）。
 *
 * 判定取 `!== false` 而非 `=== true`：该键在用户从未动过开关时可能**根本不存在**
 * 于配置里（官方 UI 默认即开），`undefined` 必须读作「开」——否则升级到本版本后
 * 所有用户的引用更新会**静默失效**（正是「读不到设置＝行为变化」那条禁令）。
 *
 * 为什么必须读官方设置而不是各存一份：本插件与官方核心会**同时**改写同一批引用
 * （核心改磁盘、本插件改内存树，见 `view.updateReferencesOnRename` 的长注释），
 * 两侧开关不一致就会出现「核心改了、本插件又写回旧值」的互相覆盖。
 */
export function updatesInternalLinksOnRename(app: App): boolean {
	return readVaultConfig(app, 'alwaysUpdateLinks') !== false;
}
