/**
 * 用户入口注册：命令面板命令与丝带图标。
 * 生命周期（registerView、事件监听、设置面板）由 main.ts 负责。
 */
import { MarkdownView, Plugin, setTooltip } from 'obsidian';
import { MindMapView } from './features/view';
import { createNewMindMap, type NewMindMapSettings } from './creation';
import { fitMindMap } from './engine/mindmap';
import { declareAndOpenAsMindMap } from './markdown/md-open';
import { t } from './core/i18n';

/**
 * commands 模块对宿主插件的窄化契约。
 * 仅用 addCommand/addRibbonIcon（Obsidian Plugin 基类）+ settings（命令文案
 * 语言 + 新建导图的落点设置，见 `NewMindMapSettings`）。
 * 替代 MindMapStudioPlugin 具体类引用，打破 commands ↔ main 循环。
 */
interface IPluginCommandsHost extends Plugin {
	settings: NewMindMapSettings;
}

/**
 * 命令 id 表（**发布后永不变更**，见 AGENTS.md）：注册点与「语言变更后按 id
 * 先移除再重注册」（refreshCommandLabels）**共用同一份来源**。
 *
 * 此前注册点写字面量、刷新点另抄一份数组：新增/改名命令时漏登记，命令面板会
 * 残留旧语言的重复项，而 id 是运行时字符串——没有任何门禁能发现（2026-10-15
 * 审计的收口项）。
 */
const COMMAND_IDS = {
	createNew: 'create-new-mindmap',
	createHere: 'create-mindmap-here',
	searchNodes: 'search-mindmap-nodes',
	fitView: 'mindmap-fit-view',
	arrange: 'mindmap-arrange',
	splitLinksAll: 'mindmap-split-links-all',
	exportImage: 'mindmap-export-png',
	openMdAsView: 'mindmap-open-md-as-view',
	backToMarkdown: 'mindmap-back-to-markdown',
} as const;

/** 全部已注册命令 id（refreshCommandLabels 批量移除用；顺序即本表的书写顺序） */
const ALL_COMMAND_IDS: readonly string[] = Object.values(COMMAND_IDS);

/**
 * 注册全部命令面板命令（onload 时调用一次；文案取注册时的语言）。
 *
 * 编排壳：按类别分组注册（创建 / 视图 / 导出与文档模式）——纯移动，
 * 调用顺序 = 拆分前的注册顺序，各条命令内容不变。
 */
export function registerCommands(plugin: IPluginCommandsHost): void {
	registerCreateCommands(plugin);
	registerViewCommands(plugin);
	registerDocumentCommands(plugin);
}

/** 创建类：新建导图 / 在当前文件夹新建 */
function registerCreateCommands(plugin: IPluginCommandsHost): void {
	plugin.addCommand({
		id: COMMAND_IDS.createNew,
		name: t(plugin.settings.language, 'command.createMindMap'),
		callback: () => {
			void createNewMindMap(plugin.app, plugin.settings);
		},
	});

	plugin.addCommand({
		id: COMMAND_IDS.createHere,
		name: t(plugin.settings.language, 'command.createInCurrentFolder'),
		checkCallback: (checking) => {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (checking) {
				return Boolean(activeFile);
			}
			if (activeFile) {
				void createNewMindMap(
					plugin.app,
					plugin.settings,
					activeFile.parent?.path ?? '',
				);
			}
			return true;
		},
	});
}

/** 视图类：搜索节点 / 适应画布 / 整理 / 批量拆分混排双链 */
function registerViewCommands(plugin: IPluginCommandsHost): void {
	plugin.addCommand({
		id: COMMAND_IDS.searchNodes,
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
		id: COMMAND_IDS.fitView,
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
		id: COMMAND_IDS.arrange,
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

	// 混排双链拆分（批量）：扫描全文，把所有混排节点的双链一次拆完（含未编辑的存量节点）；
	// 单节点场景由「编辑后自动拆分」覆盖（见 links-split / view-split-links）
	plugin.addCommand({
		id: COMMAND_IDS.splitLinksAll,
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
}

/** 导出与 md 文档模式：导出图片（PNG/SVG）/ md 打开为导图 / 切回 Markdown */
function registerDocumentCommands(plugin: IPluginCommandsHost): void {
	plugin.addCommand({
		// ID 按契约发布后不变（语义已从「导出 PNG」扩展为「导出图片，可选 PNG/SVG」）
		id: COMMAND_IDS.exportImage,
		name: t(plugin.settings.language, 'command.exportImage'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			// 引擎未就绪时导出静默无效果，视为不可用（避免"可用却无反应"）
			if (!view?.mindMap) {
				return false;
			}
			if (checking) {
				return true;
			}
			void view.exportImage();
			return true;
		},
	});

	// 任意 md：当前 markdown 视图（编辑/阅读均可）→ 导图视图
	// （声明为导图的文件已由自动打开切入，本命令服务于「手动预览普通笔记」）
	plugin.addCommand({
		id: COMMAND_IDS.openMdAsView,
		name: t(plugin.settings.language, 'command.openAsMindMap'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file;
			if (!file || file.extension !== 'md') {
				return false;
			}
			if (checking) {
				return true;
			}
			void declareAndOpenAsMindMap(plugin.app, view.leaf, file, plugin.settings.language);
			return true;
		},
	});

	// md 文档：从导图视图切回 Markdown（并把导图声明持久降级为 Markdown）
	plugin.addCommand({
		id: COMMAND_IDS.backToMarkdown,
		name: t(plugin.settings.language, 'command.backToMarkdown'),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			const file = view?.file;
			if (!file || file.extension !== 'md') {
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
 * @returns 图标元素——官方无 removeRibbonIcon，语言变更时就地经官方
 * `setTooltip` 更新提示文案
 */
export function addMindMapRibbonIcon(
	plugin: IPluginCommandsHost,
): HTMLElement {
	return plugin.addRibbonIcon(
		'network',
		t(plugin.settings.language, 'command.createMindMap'),
		() => {
			void createNewMindMap(plugin.app, plugin.settings);
		},
	);
}

/**
 * 语言变更后刷新用户入口文案：命令面板在注册时缓存 `name`，故按 id
 * 先 `removeCommand` 再重注册（官方 1.7.2+ 提供 removeCommand）；
 * 丝带图标无移除 API，经官方 `setTooltip` 就地更新提示文案。
 */
export function refreshCommandLabels(
	plugin: IPluginCommandsHost,
	ribbonEl: HTMLElement | null,
): void {
	for (const id of ALL_COMMAND_IDS) {
		plugin.removeCommand(id);
	}
	registerCommands(plugin);
	// 丝带图标无移除 API：经官方 setTooltip 就地更新提示（aria-label）
	if (ribbonEl) {
		setTooltip(ribbonEl, t(plugin.settings.language, 'command.createMindMap'));
	}
}
