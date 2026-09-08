/**
 * 文件浏览器「新建」菜单注入（file-explorer 的 fileCreator 菜单）。
 * 从 main.ts 拆出（原 MindMapStudioPlugin.injectIntoFileCreator）。
 *
 * ⚠️ 私有 API 风险说明：Obsidian 未公开注入 fileCreator 菜单的公共 API
 * （obsidian.d.ts 仅有 file-menu / files-menu 事件，且无 fileCreator 类型），
 * 本实现采用社区通行的防御式访问（Templater 等插件同款做法）：
 * - 特性检测：fileCreator / menu 缺失或结构变化时静默跳过，不崩溃；
 * - 菜单重建检测：以菜单对象引用作为注入标记，Obsidian 重建菜单对象后
 *   引用变化会自动重新注入（旧标记为布尔值，菜单重建后会失效）；
 * - 整体 try/catch：私有 API 变更抛异常时静默降级，不影响插件其他功能。
 * 若未来 Obsidian 提供公共 API，应优先替换为公共实现。
 */
import { App, Menu, TFolder } from 'obsidian';
import { CORE_VIEW_TYPE } from '../constants';
import { t, type Language } from '../i18n';

/**
 * 已注入的菜单对象引用（按核心视图实例记录）。
 * 用 WeakMap 而非在核心视图对象上写自有属性：后者会污染 Obsidian 的
 * 视图实例（官方无此约定，且可能与核心属性冲突）；WeakMap 随视图回收，
 * 语义相同（菜单重建 → 引用变化 → 重新注入）。
 */
const injectedMenus = new WeakMap<object, Menu>();

/**
 * 向文件浏览器的「新建」菜单注入「新建思维导图」。
 * @param createInFolder 在指定目录（空串 = 库根）新建思维导图
 */
export function injectIntoFileCreator(
	app: App,
	lang: Language,
	createInFolder: (folderPath: string) => void,
): void {
	try {
		app.workspace
			.getLeavesOfType(CORE_VIEW_TYPE.FILE_EXPLORER)
			.forEach((leaf) => {
				const explorerView = leaf.view as unknown as {
					fileCreator?: { menu?: Menu; folder?: TFolder | null } | null;
				};
				const fileCreator = explorerView.fileCreator;
				// 特性检测：私有 API 不存在或结构变化时静默跳过
				if (!fileCreator?.menu) {
					return;
				}
				// 同一菜单对象已注入过则跳过；
				// 菜单对象被 Obsidian 重建（引用变化）时重新注入
				if (injectedMenus.get(explorerView) === fileCreator.menu) {
					return;
				}
				fileCreator.menu.addItem((item) =>
					item
						.setTitle(t(lang, 'command.createMindMap'))
						.setIcon('dot-network')
						.onClick(() => {
							createInFolder(fileCreator.folder?.path ?? '');
						}),
				);
				injectedMenus.set(explorerView, fileCreator.menu);
			});
	} catch (error) {
		// 私有 API 变更时静默降级：命令面板 / 文件夹右键 / 丝带图标
		// 等公共入口不受影响
		console.debug(
			'注入文件浏览器「新建」菜单失败（Obsidian 私有 API 可能已变更）',
			error,
		);
	}
}
