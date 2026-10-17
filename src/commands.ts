/**
 * 用户入口注册：命令面板命令与丝带图标。
 * 生命周期（registerView、事件监听、设置面板）由 main.ts 负责。
 */
import { MarkdownView, Plugin, setTooltip, type TFile } from 'obsidian';
import { MindMapView } from './features/view';
import { createNewMindMap, type NewMindMapSettings } from './creation';
import { fitToScreen } from './features/view-viewport';
import { declareAndOpenAsMindMap } from './markdown/md-open';
import { t, type TranslationKey } from './core/i18n';

/**
 * commands 模块对宿主插件的窄化契约。
 * 仅用 addCommand/addRibbonIcon（Obsidian Plugin 基类）+ settings（命令文案
 * 语言 + 新建导图的落点设置，见 `NewMindMapSettings`）。
 * 替代 MindMapStudioPlugin 具体类引用，打破 commands ↔ main 循环。
 */
interface CommandsHost extends Plugin {
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

type CommandId = (typeof COMMAND_IDS)[keyof typeof COMMAND_IDS];

/** 全部已注册命令 id（refreshCommandLabels 批量移除用；顺序即本表的书写顺序） */
const ALL_COMMAND_IDS: readonly CommandId[] = Object.values(COMMAND_IDS);

/**
 * 注册全部命令面板命令（onload 时调用一次；文案取注册时的语言）。
 *
 * 编排壳：按类别分组注册（创建 / 视图 / 导出与文档模式）——纯移动，
 * 调用顺序 = 拆分前的注册顺序，各条命令内容不变。
 */
export function registerCommands(plugin: CommandsHost): void {
	registerCreateCommands(plugin);
	registerViewCommands(plugin);
	registerDocumentCommands(plugin);
}

/** 「作用于当前导图视图」的命令描述 */
interface MindMapViewCommand {
	id: string;
	/** 命令面板文案键（文案取注册时的语言，语言变更经 removeCommand + 重注册刷新） */
	nameKey: TranslationKey;
	/**
	 * 是否要求引擎已就绪才可用（默认 `true`）。
	 * 引擎未就绪时多数动作静默无效果，暴露成「可用却无反应」比不可用更差；
	 * 整理命令例外——它自己会提示「未加载」。
	 */
	requireEngine?: boolean;
	run: (view: MindMapView) => void;
}

/**
 * 注册一条「作用于当前导图视图」的命令：取视图、引擎就绪判定、
 * `checkCallback` 的 checking/执行分流（**唯一实现**）。
 *
 * 此前五条命令各写一遍同一骨架，差异只藏在「判不判 mindMap」「执行什么」两点。
 */
function addMindMapViewCommand(
	plugin: CommandsHost,
	{ id, nameKey, requireEngine = true, run }: MindMapViewCommand,
): void {
	plugin.addCommand({
		id,
		name: t(plugin.settings.language, nameKey),
		checkCallback: (checking) => {
			const view = plugin.app.workspace.getActiveViewOfType(MindMapView);
			if (!view || (requireEngine && !view.mindMap)) {
				return false;
			}
			if (checking) {
				return true;
			}
			run(view);
			return true;
		},
	});
}

/** 创建类：新建导图 / 在当前文件夹新建 */
function registerCreateCommands(plugin: CommandsHost): void {
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
			// 无活动文件即不可用：此前非 checking 分支是「什么都不做却返回 true」
			if (!activeFile) {
				return false;
			}
			if (checking) {
				return true;
			}
			void createNewMindMap(
				plugin.app,
				plugin.settings,
				activeFile.parent?.path ?? '',
			);
			return true;
		},
	});
}

/** 视图类：搜索节点 / 适应画布 / 整理 / 批量拆分混排双链 */
function registerViewCommands(plugin: CommandsHost): void {
	// 搜索栏与 fit 在引擎未就绪时静默无效果 → 按「引擎就绪」判定可用性
	addMindMapViewCommand(plugin, {
		id: COMMAND_IDS.searchNodes,
		nameKey: 'command.searchNodes',
		run: (view) => {
			view.openSearchBar();
		},
	});

	addMindMapViewCommand(plugin, {
		id: COMMAND_IDS.fitView,
		nameKey: 'command.fitCanvas',
		run: (view) => {
			fitToScreen(view);
		},
	});

	// 整理不占用「引擎就绪」判定：它自身会提示「未加载」并中止
	addMindMapViewCommand(plugin, {
		id: COMMAND_IDS.arrange,
		nameKey: 'command.arrange',
		requireEngine: false,
		run: (view) => {
			view.arrangeMindMap();
		},
	});

	// 混排双链拆分（批量）：扫描全文，把所有混排节点的双链一次拆完（含未编辑的存量节点）；
	// 单节点场景由「编辑后自动拆分」覆盖（见 links-split / view-split-links）
	addMindMapViewCommand(plugin, {
		id: COMMAND_IDS.splitLinksAll,
		nameKey: 'command.splitLinksAll',
		run: (view) => {
			view.splitAllLinksInDocument();
		},
	});
}

/**
 * 文档类命令的共同判据：目标视图里必须有 `.md` 文件。
 * 两个入口（以导图打开 / 切回 Markdown）此前各写一遍同样的 `!file || extension` 判定。
 */
function isMarkdownFile(file: TFile | null | undefined): file is TFile {
	if (!file) {
		return false;
	}
	return file.extension === 'md';
}

/** 导出与 md 文档模式：导出图片（PNG/SVG）/ md 打开为导图 / 切回 Markdown */
function registerDocumentCommands(plugin: CommandsHost): void {
	addMindMapViewCommand(plugin, {
		// ID 按契约发布后不变（语义已从「导出 PNG」扩展为「导出图片，可选 PNG/SVG」）
		id: COMMAND_IDS.exportImage,
		nameKey: 'command.exportImage',
		run: (view) => {
			void view.exportImage();
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
			if (!view || !isMarkdownFile(file)) {
				return false;
			}
			if (checking) {
				return true;
			}
			void declareAndOpenAsMindMap(
				plugin.app,
				view.leaf,
				file,
				plugin.settings.language,
			);
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
			if (!view || !isMarkdownFile(file)) {
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
	plugin: CommandsHost,
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
	plugin: CommandsHost,
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
