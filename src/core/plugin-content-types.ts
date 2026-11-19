/** 插件代码块的渲染契约；UI 只声明槽位，平台层管理活组件与冻结测量副本。 */
export const PLUGIN_SLOT_CLASS = 'mindmap-plugin-block';
export const PLUGIN_LIVE_CLASS = 'mindmap-plugin-live';
export const PLUGIN_SLOT_ID = 'data-plugin-id';
export const PLUGIN_INTERACTIVE_ATTR = 'data-codeblock-interactive';

export interface PluginBlockRequest {
	nodeId: string;
	index: number;
	language: string;
	source: string;
	holder: HTMLElement;
	owner: object | null;
	availableWidth?: number;
}

export interface PluginContentRenderer {
	supports(language: string): boolean;
	mode(language: string): 'static' | 'live' | null;
	/** 返回冻结副本仅供首次测量；真实挂载后的槽位由平台桥装入活 DOM。 */
	render(request: PluginBlockRequest): HTMLElement | null;
}

/** 跨窗口安全；插件控件的事件与键盘由它自己的组件处理。 */
export function isPluginContentTarget(target: EventTarget | null): boolean {
	const element = target as Partial<Element> | null;
	return typeof element?.closest === 'function' && element.closest(`.${PLUGIN_LIVE_CLASS}`) !== null;
}
