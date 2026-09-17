/**
 * 官方库级偏好（`设置 → 文件与链接`）的读取：本插件的**写入形态**跟随官方设置。
 *
 * 两项与写入直接相关的官方偏好：
 * - `useMarkdownLinks`（「使用 \[\[Wikilinks\]\]」）：关闭 → 新建的链接与图片
 *   写 md 形态 `[显示名](路径.md)` / `![alt](路径.png)`（官方帮助
 *   `en/User interface/Settings.md`：该设置同时管 links 与 images）；
 * - `newLinkFormat`（「New link format」）：新建链接的**路径形态**——最短路径 /
 *   相对路径 / 绝对路径（官方帮助 `Settings.md` 三选一，默认最短路径）。
 *
 * `vault.getConfig` 是**内部接口**（obsidian.d.ts 未声明），但它是社区读取这两项
 * 设置的通行方式；读取失败或值非法时按**官方默认**返回（Wikilinks 开 + 最短路径），
 * 不改变既有行为——不可把「读不到设置」变成行为变化。
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
