/**
 * 用户入口注册：命令面板命令与丝带图标。
 * 生命周期（registerView、事件监听、设置面板）由 main.ts 负责。
 */
import { MarkdownView, Plugin } from 'obsidian';
import { MindMapView } from './features/view';
import { createNewMindMap } from './creation';
import { fitMindMap } from './mindmap';
import { isMindMapMarkdownFile, openAsMindMap } from './md-open';
import { Language, t } from './i18n';

/**
 * commands 模块对宿主插件的窄化契约。
 * 仅用 addCommand/addRibbonIcon（Obsidian Plugin 基类）+ settings.language。
 * 替代 MindMapStudioPlugin 具体类引用，打破 commands ↔ main 循环。
 */
interface IPluginCommandsHost extends Plugin {
	settings: { language: Language };
}

/** 命令 id 表（语言变更时按 id 先移除再重注册；id 本身不随语言变化） */
const COMMAND_IDS = [
	'create-new-mindmap',
	'create-mindmap-here',
	'search-mindmap-nodes',
	'mindmap-fit-view',
	'mindmap-arrange',
	'mindmap-split-links',
	'mindmap-split-links-all',
	'mindmap-export-png',
	'mindmap-open-md-as-view',
	'mindmap-back-to-markdown',
] as const;

/** 注册全部命令面板命令（onload 时调用一次；文案取注册时的语言） */
export function registerCommands(plugin: IPluginCommandsHost): void {
	plugin.addCommand({
		id: 'create-new-mindmap',
		name: t(plugin.settings.language, 'command.createMindMap'),
		callback: () => {
			void createNewMindMap(plugin.app, plugin.settings.language);
		},
	});

	plugin.addCommand({
		id: 'create-mindmap-here',
		name: t(plugin.settings.language, 'command.createInCurrentFolder'),
		checkCallback: (checking) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (checking) {
				return Boolean(activeFile);
			}
			if (activeFile) {
				void createNewMindMap(
					plugin.app,
					plugin.settings.language,
					activeFile.parent?.path ?? '',
				);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'search-mindmap-nodes',
		name: t(plugin.settings.language, 'command.searchNodes'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			// 引擎未就绪时搜索栏无法工作（openSearchBar 静默返回），视为不可用
			if (!view?.mindMap) {
				return false;
			}
			if (checking) {
				return true;
			}
			view.openSearchBar();
			return true;
		},
	});

	plugin.addCommand({
		id: 'mindmap-fit-view',
		name: t(plugin.settings.language, 'command.fitCanvas'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			// 引擎未就绪时 fit 静默无效果，视为不可用（避免"可用却无反应"）
			if (!view?.mindMap) {
				return false;
			}
			if (checking) {
				return true;
			}
			fitMindMap(view.mindMap);
			return true;
		},
	});

	plugin.addCommand({
		id: 'mindmap-arrange',
		name: t(plugin.settings.language, 'command.arrange'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (checking) {
				return Boolean(view);
			}
			view?.arrangeMindMap();
			return true;
		},
	});

	// 混排双链拆分：把选中节点行内的文档/附件双链抽成子节点（见 links-split）
	plugin.addCommand({
		id: 'mindmap-split-links',
		name: t(plugin.settings.language, 'command.splitLinks'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			// 引擎未就绪时无可操作节点，视为不可用
			if (!view?.mindMap) {
				return false;
			}
			if (checking) {
				return true;
			}
			view.splitActiveNodeLinks();
			return true;
		},
	});

	// 批量：扫描全文，把所有混排节点的双链一次拆完（含未编辑的存量节点）
	plugin.addCommand({
		id: 'mindmap-split-links-all',
		name: t(plugin.settings.language, 'command.splitLinksAll'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (!view?.mindMap) {
				return false;
			}
			if (checking) {
				return true;
			}
			view.splitAllLinksInDocument();
			return true;
		},
	});

	plugin.addCommand({
		id: 'mindmap-export-png',
		name: t(plugin.settings.language, 'command.exportPng'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			// 引擎未就绪时导出静默无效果，视为不可用（避免"可用却无反应"）
			if (!view?.mindMap) {
				return false;
			}
			if (checking) {
				return true;
			}
			void view.exportPNG();
			return true;
		},
	});

	// .mindmap.md：当前 markdown 视图（编辑/阅读均可）→ 导图视图
	plugin.addCommand({
		id: 'mindmap-open-md-as-view',
		name: t(plugin.settings.language, 'command.openAsMindMap'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!file || !isMindMapMarkdownFile(file)) {
				return false;
			}
			if (checking) {
				return true;
			}
			void openAsMindMap(view.leaf, file);
			return true;
		},
	});

	// md 文档模式：从导图视图切回 Markdown
	plugin.addCommand({
		id: 'mindmap-back-to-markdown',
		name: t(plugin.settings.language, 'command.backToMarkdown'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (!view?.isMdDocument()) {
				return false;
			}
			if (checking) {
				return true;
			}
			view.backToMarkdown();
			return true;
		},
	});
}

/**
 * 创建丝带图标（onload 时调用一次）。
 * @returns 图标元素——官方无 removeRibbonIcon，语言变更时就地更新 aria-label
 */
export function addMindMapRibbonIcon(
	plugin: IPluginCommandsHost,
): HTMLElement {
	return plugin.addRibbonIcon(
		'network',
		t(plugin.settings.language, 'command.createMindMap'),
		() => {
			void createNewMindMap(plugin.app, plugin.settings.language);
		},
	);
}

/**
 * 语言变更后刷新用户入口文案：命令面板在注册时缓存 `name`，故按 id
 * 先 `removeCommand` 再重注册（官方 1.7.2+ 提供 removeCommand）；
 * 丝带图标无移除 API，就地更新提示文案。
 */
export function refreshCommandLabels(
	plugin: IPluginCommandsHost,
	ribbonEl: HTMLElement | null,
): void {
	for (const id of COMMAND_IDS) {
		plugin.removeCommand(id);
	}
	registerCommands(plugin);
	ribbonEl?.setAttribute(
		'aria-label',
		t(plugin.settings.language, 'command.createMindMap'),
	);
}
