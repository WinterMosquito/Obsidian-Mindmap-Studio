/**
 * 标签点击 → 官方**搜索**核心插件（私有触点，规则 9 登记）。
 *
 * ## 为什么是私有触点
 * Obsidian 没有公开的「打开标签搜索」API：阅读视图里点 `#tag` 的行为由核心
 * `global-search` 插件实例承担，运行时入口是
 * `app.internalPlugins.getPluginById('global-search').instance.openGlobalSearch(query)`
 * （`internalPlugins` 与实例方法都不在 `obsidian.d.ts`）。官方缺口 ⇒ 允许私有
 * 触点，但必须**防御式**：任何一层缺失 / 抛错都降级为一次可见提示，不允许
 * 「点了没反应」。
 *
 * ## 查询串
 * 官方搜索语法为 `tag:#名称`（帮助文档 Search → Tags）。名称来自节点内 `a.tag`
 * 的 `data-tag`（不带 `#`），这里统一补 `tag:#`。
 *
 * ## 提示只报一次
 * 失败是**能力缺失**（插件被禁用 / 版本变更），不是每次点击都值得弹一次
 * Notice；同一次会话内只提示一次，控制台同样只留一条。
 */
import { App, Notice } from 'obsidian';
import { t, type Language } from '../core/i18n';

/** 私有面：核心插件注册表（只声明本模块用到的形状） */
interface InternalSearchPlugin {
	instance?: { openGlobalSearch?: (query: string) => void };
}

interface AppWithInternalPlugins {
	internalPlugins?: {
		getPluginById?: (id: string) => InternalSearchPlugin | null | undefined;
	};
}

/** 本会话是否已经提示过「搜索插件不可用」（避免每次点击都弹） */
let reportedMissing = false;

/**
 * 打开标签搜索。
 *
 * @param app 宿主 App
 * @param tag 标签名（带不带 `#` 均可）
 * @param lang 界面语言（回退提示文案）
 */
export function openTagSearch(app: App, tag: string, lang: Language): void {
	const name = tag.replace(/^#/, '').trim();
	if (!name) {
		return;
	}
	const internal = (app as unknown as AppWithInternalPlugins).internalPlugins;
	const search = internal?.getPluginById?.('global-search')?.instance;
	const open = search?.openGlobalSearch;
	if (typeof open === 'function') {
		try {
			open.call(search, `tag:#${name}`);
			return;
		} catch (error) {
			console.warn('标签搜索调用失败', error);
		}
	}
	if (!reportedMissing) {
		reportedMissing = true;
		console.warn('未找到官方搜索插件，无法打开标签搜索');
		new Notice(t(lang, 'tag.searchUnavailable'));
	}
}
