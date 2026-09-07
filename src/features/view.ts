/**
 * 思维导图视图（Controller）：Obsidian 生命周期、DOM 装配、跳转与外观委托。
 *
 * 第 4 步拆分后的职责边界：
 * - DocumentService / SavePipeline（services/document-service.ts）
 *   md 文档读取解析与保存管线（防抖 + 串行排空 + 卸载快照兜底）；
 * - EngineController（services/engine-controller.ts）
 *   引擎实例生命周期、初始化代际锁、主题/布局/视口、引用更新（防腐收口，
 *   renderer 内部状态不再被视图触碰）；
 * - 本类只做编排：生命周期事件 → 装配 services 与 view-* 交互特性，
 *   中心主题 ⇄ 文件名重命名调度，链接跳转。
 * 功能模块（从本文件拆出）：
 * - view-toolbar.ts      工具栏
 * - view-dnd.ts          拖拽/外部文件导入/附件悬浮
 * - view-context-menu.ts 右键菜单
 * - view-node-actions.ts 节点操作与附件
 * - view-paste.ts        粘贴处理
 * - view-status.ts       状态栏
 * - view-search.ts       搜索栏
 * - view-export.ts       导入导出
 */
import {
	FileView,
	Notice,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type MindMapStudioPlugin from '../main';
import { Language, t } from '../i18n';
import {
	canOpenInObsidian,
	isSystemMediaExtension,
	MD_FILE_SUFFIX,
	stripMindMapStem,
	VIEW_TYPE,
} from '../constants';
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import { isHttpUrl } from '../domain/url';
import { createDebouncer } from '../concurrency';
import { notifyError } from '../errors';
import { resolvePathToFile } from '../links-resolve';
import { walkCorrectImageSizesByAspect } from '../images-path';
import { sanitizeFileName } from '../images-save';
import { isMindMapMarkdownFile, openAsMarkdown } from '../md-open';
import { registerWikilinkInteractions } from './view-wikilink';
import type { MindMapViewContext } from './view-context';
import { parseWikilink } from '../domain/wikilink';
import { ENGINE_COMMANDS } from '../mindmap';
import { DocumentService, SavePipeline } from '../services/document-service';
import { EngineController } from '../services/engine-controller';
import {
	buildSearchBar,
	openSearchBar,
} from './view-search';
import { exportPNG } from './view-export';
import { arrangeMindMap, buildToolbar, refreshToolbar } from './view-toolbar';
import { setupDragAndDrop } from './view-dnd';
import { setupContextMenu } from './view-context-menu';
import { openFileWithSystemApp } from '../system-open';
import { handleWindowPaste, setupPasteHandler } from './view-paste';
import {
	cancelStatusBarUpdate,
	updateStatusBar,
} from './view-status';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { EventBinder } from '../event-binder';

export class MindMapView extends FileView implements MindMapViewContext {
	plugin: MindMapStudioPlugin;
	canvasEl: HTMLElement | null = null;
	toolbarEl: HTMLElement | null = null;
	searchBarEl: HTMLElement | null = null;
	searchInput: HTMLInputElement | null = null;
	searchCountEl: HTMLElement | null = null;
	layoutSelect: HTMLSelectElement | null = null;
	isDark = false;
	ready = false;

	/** md 文档读取/解析（渲染层数据面） */
	private documents: DocumentService;
	/** 保存管线（防抖 + 串行排空 + 卸载快照兜底） */
	private savePipeline: SavePipeline;
	/** 引擎实例生命周期（防腐收口，引擎内部访问不再出现在本类） */
	private engine: EngineController;

	/**
	 * 视图生命周期作用域的事件绑定器：
	 * onOpen 时注册的搜索输入框等事件挂在这里，onClose 时清理。
	 * 跨文件（view-search）共享，故公开。
	 */
	viewEvents = new EventBinder();
	private boundHandleCssChange: (() => void) | null = null;
	/**
	 * 视图装配完成信号：onOpen 进入时重建、DOM 装配完成后 resolve。
	 * onLoadFile 与 onOpen 的调用时序 Obsidian 不保证，onLoadFile 据此
	 * 等待装配完成（替代原 10ms setTimeout 轮询的 waitForReady）。
	 */
	private whenReady: Promise<void> = new Promise(() => {});
	/**
	 * 文件加载去重：onOpen 与 onLoadFile 都会为同一文件触发加载
	 * （Obsidian 对 FileView 的调用时序不保证），记录进行中的加载路径，
	 * 避免同一文件被重复读取、重复创建引擎实例。
	 */
	private loadingFilePath: string | null = null;
	/**
	 * 当前布局（持久化到文件的唯一来源；不依赖 getData() 返回活引用还是深拷贝）。
	 * 由 view-toolbar.ts 写入、本类与引擎初始化读写。
	 */
	currentLayout: string | null = null;

	/**
	 * .mindmap.md 文档模式（B3 显式切换）：文件本质是 Markdown，用导图视图
	 * 编辑并回写为 md 大纲。
	 */
	/** 进入前 markdown 视图模式（返回「以 Markdown 编辑」时恢复） */
	mdBackMode: 'source' | 'preview' = 'source';
	/** 原样保留的 frontmatter 块（保存时拼回文件头） */
	mdFrontmatter: string | null = null;
	/**
	 * 文档模式标记：parseDocument 时按文件名锁定（保存/回写恒为 md 大纲；
	 * 标记用于工具栏返回按钮与相关交互的显示判定）。
	 */
	mdDocumentMode = false;

	/** 引擎实例（view-* 模块经 context 只读访问） */
	get mindMap(): MindMap | null {
		return this.engine.mindMap;
	}

	/** 引擎实例作用域事件绑定器（随引擎销毁清理，view-* 经 context 注册） */
	get engineEvents(): EventBinder {
		return this.engine.engineEvents;
	}

	/** 当前文件是否为 .mindmap.md 文档模式（由文档加载锁定） */
	isMdDocument(): boolean {
		return this.mdDocumentMode;
	}

	constructor(leaf: WorkspaceLeaf, plugin: MindMapStudioPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.isDark = document.body.hasClass('theme-dark');

		this.documents = new DocumentService(this.app);
		this.savePipeline = new SavePipeline({
			app: this.app,
			getFile: () => this.file,
			getSnapshot: () => this.engine.getDataSnapshot(),
			getFrontmatter: () => this.mdFrontmatter,
			isAutoSave: () => this.plugin.settings.autoSave,
			// 写盘失败弹用户可见提示（管线内部已 console.error 记录详情）
			onSaveError: (error) => {
				notifyError(this.lang, 'save.failed', error);
			},
		});
		this.engine = new EngineController({
			app: this.app,
			getCanvasEl: () => this.canvasEl,
			getFile: () => this.file,
			getLang: () => this.lang,
			isDark: () => this.isDark,
			getSetupOptions: () => ({
				layout: this.resolveLayout(),
				themePref: this.plugin.settings.defaultTheme,
				enableDrag: this.plugin.settings.enableDrag,
				performanceMode: this.plugin.settings.performanceMode,
				performanceThreshold: this.plugin.settings.performanceThreshold,
			}),
			viewState: this.plugin.viewState,
			openHyperlink: (link) => this.openHyperlink(link),
			onRootDataChanged: () => {
				this.scheduleSave();
				updateStatusBar(this);
				this.scheduleTitleRename();
			},
			onNodeImageClick: (node) => openNodeImageFullscreen(this, node),
			setupFeatures: () => {
				setupDragAndDrop(this);
				setupPasteHandler(this);
				setupContextMenu(this);
				registerWikilinkInteractions(this);
			},
			onEngineReady: (layout) => this.onEngineReady(layout),
			onReferencesChanged: () => {
				this.scheduleSave();
			},
		});
	}

	/** 当前界面语言 */
	get lang(): Language {
		return this.plugin.settings.language;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		// 中心主题 ⇄ 文件名同步（改中心即重命名）；标题显示即文件名
		return this.file ? this.file.basename : t(this.lang, 'common.mindMap');
	}

	getIcon(): string {
		return 'dot-network';
	}

	async onOpen(): Promise<void> {
		// 重建装配信号（onClose→onOpen 周期中旧信号作废）
		let resolveReady!: () => void;
		this.whenReady = new Promise<void>((resolve) => {
			resolveReady = resolve;
		});
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('mindmap-view-container');
		this.toolbarEl = containerEl.createDiv('mindmap-toolbar');
		buildToolbar(this);
		this.searchBarEl = containerEl.createDiv('mindmap-search-bar');
		this.buildSearchBar();
		this.canvasEl = containerEl.createDiv('mindmap-canvas-container');

		this.boundHandleCssChange = () => {
			const dark = document.body.hasClass('theme-dark');
			if (dark !== this.isDark) {
				this.isDark = dark;
				this.applyTheme();
			}
		};
		this.registerEvent(
			this.app.workspace.on('css-change', this.boundHandleCssChange),
		);
		this.scope?.register(['Mod'], 'f', () => {
			this.openSearchBar();
			return false;
		});
		// 对齐 Obsidian 官方编辑约定（help: Editing shortcuts）：
		// Undo = Mod+Z；Redo = Mod+Shift+Z 或 Mod+Y。属系统级编辑快捷键
		// （非命令默认热键，不违反社区规范的 no-default-hotkeys），
		// 引擎自身未绑定这两个键，此处接管并阻止冒泡。
		this.scope?.register(['Mod'], 'z', () => {
			this.mindMap?.execCommand(ENGINE_COMMANDS.BACK);
			return false;
		});
		this.scope?.register(['Mod', 'Shift'], 'z', () => {
			this.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD);
			return false;
		});
		this.scope?.register(['Mod'], 'y', () => {
			this.mindMap?.execCommand(ENGINE_COMMANDS.FORWARD);
			return false;
		});

		// 窗口级粘贴兜底：只注册一次（随视图生命周期由 Component 自动清理），
		// 不放在 setupPasteHandler 中，避免每次刷新引擎累积监听。
		// 激活视图判定在此处做（需要 MindMapView 类引用），view-paste 保持无类依赖。
		this.registerDomEvent(window, 'paste', (event) => {
			if (this.app.workspace.getActiveViewOfType(MindMapView) !== this) {
				return;
			}
			handleWindowPaste(this, event);
		});

		this.ready = true;
		resolveReady();
		if (this.file) {
			await this.loadMindMapFromFile(this.file);
		}
	}

	async onLoadFile(file: TFile): Promise<void> {
		// 等待装配完成（onOpen 尚未执行时挂起，替代原 10ms 轮询）
		await this.whenReady;
		// onOpen 已为同一文件启动加载（读取中或已完成）时跳过，
		// 避免同一文件被读取两次、引擎实例被创建两次。
		if (this.loadingFilePath === file.path) {
			return;
		}
		await this.loadMindMapFromFile(file);
	}

	async onUnloadFile(): Promise<void> {
		// 文件切换：作废本文件尚未执行的初始化重试，防止过期 tree 随后渲染
		this.engine.invalidateInit();
		this.savePipeline.cancelTimer();
		this.titleRenameDebouncer.cancel();
		// 先保存当前视口，再写盘正文（引擎随后销毁）
		this.engine.persistViewport();
		await this.savePipeline.save();
		// 文件切换后允许再次加载同一路径（新会话）
		this.loadingFilePath = null;
		this.engine.destroyInstance();
	}

	private async loadMindMapFromFile(file: TFile): Promise<void> {
		this.loadingFilePath = file.path;
		// 布局取自视图状态存储（按文件路径）；不再跨文件沿用上一文件的布局
		this.currentLayout =
			this.plugin.viewState.getLayout(file.path) ??
			this.plugin.settings.defaultLayout;
		try {
			const doc = await this.documents.load(file);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadingFilePath !== file.path) {
				return;
			}
			this.mdFrontmatter = doc.frontmatter;
			this.mdDocumentMode = doc.isMdDocument;
			// 记录进入前 markdown 模式（「以 Markdown 编辑」返回时恢复）
			const state = this.leaf.getViewState().state as {
				mdBackMode?: 'source' | 'preview';
			};
			this.mdBackMode = state?.mdBackMode ?? 'source';
			const tree = doc.tree;
			// 按图片原始宽高比校正尺寸（统一高度、宽度按比例），
			// 在首次渲染前完成，避免首帧用固定比例再跳变。
			await walkCorrectImageSizesByAspect(tree);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadingFilePath !== file.path) {
				return;
			}
			window.requestAnimationFrame(() => {
				if (this.loadingFilePath !== file.path) {
					return;
				}
				this.engine.initMindMap(tree);
			});
		} catch (error) {
			// 文件可能已被删除/损坏：保持视图可用并提示，避免半加载状态
			this.loadingFilePath = null;
			console.error('加载思维导图失败:', file.path, error);
			new Notice(`${t(this.lang, 'common.notLoaded')}`);
		}
	}

	/** 本次引擎创建所用布局（fallback 默认值并回写会话字段） */
	private resolveLayout(): string {
		const layout = this.currentLayout || this.plugin.settings.defaultLayout;
		this.currentLayout = layout;
		return layout;
	}

	/** 引擎就绪收尾：同步布局选择器；md 模式重建工具栏补「以 Markdown 编辑」按钮 */
	private onEngineReady(layout: string): void {
		if (this.layoutSelect) {
			this.layoutSelect.value = layout;
		}
		// md 文档模式：onOpen 构建工具栏时文件尚未加载（mdDocumentMode=false），
		// 加载完成后重建工具栏以补上「以 Markdown 编辑」返回按钮
		if (this.mdDocumentMode) {
			this.refreshToolbar();
			if (this.layoutSelect && this.currentLayout) {
				this.layoutSelect.value = this.currentLayout;
			}
		}
	}

	/**
	 * 中心主题 ⇄ 文件名同步：根节点文本编辑停止（防抖 + 非编辑态）后，
	 * 把 .mindmap.md 文件重命名为该文本（Obsidian 原生更新链接/反链）。
	 * 双向：外部改名后视图重载，中心随新文件名。md 正文不承载根行。
	 */
	/** 中心主题改名防抖（1.5s，连续编辑只取最后一次） */
	private titleRenameDebouncer = createDebouncer(1500);

	private scheduleTitleRename(): void {
		if (!this.file) {
			return;
		}
		this.titleRenameDebouncer.schedule(() => {
			void this.performTitleRename();
		});
	}

	private async performTitleRename(): Promise<void> {
		const file = this.file;
		if (!file || !this.engine.mindMap || !isMindMapMarkdownFile(file)) {
			return;
		}
		// 仍在文本编辑框内（用户正打字）→ 等编辑结束后再触发
		if (this.engine.isEditingText()) {
			this.scheduleTitleRename();
			return;
		}
		const title = (this.engine.getRootText() ?? '').trim();
		const sanitized = sanitizeFileName(title).trim();
		const base = stripMindMapStem(file.basename);
		if (!sanitized || sanitized === base) {
			return; // 未改名或非法名
		}
		const folder = file.parent ? `${file.parent.path}/` : '';
		const newPath = `${folder}${sanitized}${MD_FILE_SUFFIX}`;
		if (newPath === file.path) {
			return;
		}
		// 存在性检查（非文件解析）：判断重命名目标是否已被占用，无需统一入口
		// eslint-disable-next-line no-restricted-syntax -- 非解析用途，仅判断路径是否已存在
		if (this.app.vault.getAbstractFileByPath(newPath)) {
			new Notice(t(this.lang, 'rename.titleConflict'));
			return;
		}
		try {
			await this.app.vault.rename(file, newPath);
		} catch (error) {
			console.error('根据中心主题重命名文件失败', error);
			new Notice(t(this.lang, 'rename.titleFailed'));
		}
	}

	/**
	 * 切换布局（工具栏调用）：更新会话字段 + 立即写入视图状态存储
	 * （.mindmap.md 布局不写入正文，存 data.json 按文件路径恢复）。
	 */
	applyLayout(value: string): void {
		this.currentLayout = value;
		this.engine.setLayout(value);
		if (this.file) {
			this.plugin.viewState.setLayout(this.file.path, value);
		}
	}

	/** 重建思维导图实例（设置变更后调用） */
	refreshMindMap(): void {
		this.engine.refresh();
	}

	private applyTheme(): void {
		this.engine.applyTheme();
	}

	/** 安排一次防抖自动保存（view-toolbar.ts / view-node-actions.ts 等外部模块调用） */
	scheduleSave(): void {
		this.savePipeline.schedule();
	}

	// ==================== 工具栏（委托 view-toolbar.ts） ====================

	/** 自动整理（需求 3）：重新按布局算法对齐摆放各主题并适配画布 */
	arrangeMindMap(): void {
		arrangeMindMap(this);
	}

	/** 设置变更后重建工具栏 */
	refreshToolbar(): void {
		refreshToolbar(this);
	}

	/** md 文档模式：切回 Markdown 编辑/阅读（恢复进入前模式） */
	backToMarkdown(): void {
		if (this.file) {
			this.engine.persistViewport();
			// 双向偏好：显式选择以 Markdown 查看 → 下次默认打开方式
			this.plugin.viewState.setOpenAs(this.file.path, 'markdown');
			void openAsMarkdown(this.leaf, this.file, this.mdBackMode);
		}
	}

	// ==================== 搜索栏（委托 view-search.ts） ====================

	private buildSearchBar(): void {
		buildSearchBar(this);
	}

	openSearchBar(): void {
		openSearchBar(this);
	}

	// ==================== 导出（委托 view-export.ts） ====================

	async exportPNG(): Promise<void> {
		await exportPNG(this);
	}

	// ==================== 链接跳转 / 引用更新 / 清理 ====================

	/**
	 * 打开节点超链接（wiki 链接 / http / 库内路径）。
	 * @param openNew true = 新标签页打开（Ctrl/Cmd+点击语义）
	 */
	openHyperlink(link: string, openNew = false): void {
		if (!link) {
			return;
		}
		const sourcePath = this.file?.path ?? '';
		const wiki = parseWikilink(link);
		if (wiki) {
			// 解析 [[目标]] 到具体库内文件
			const dest = this.app.metadataCache.getFirstLinkpathDest(
				wiki.target,
				sourcePath,
			);
			this.openResolvedTarget(dest, wiki.inner, sourcePath, openNew);
			return;
		}
		if (isHttpUrl(link)) {
			window.open(link, '_blank');
			return;
		}
		// 其余按库内路径处理
		const file = resolvePathToFile(link, this.app);
		this.openResolvedTarget(file, link, sourcePath, openNew);
	}

	/**
	 * 打开已解析的库内目标（wiki 与库内路径两分支共用）：
	 * Obsidian 可渲染才开标签页；系统媒体（音频/视频）走系统应用；
	 * 其余类型不开空白页；目标未解析到时交给 openLinkText
	 * （Obsidian 原生"未找到/新建笔记"行为）。
	 */
	private openResolvedTarget(
		file: TFile | null,
		linkText: string,
		sourcePath: string,
		openNew: boolean,
	): void {
		if (file && !canOpenInObsidian(file.extension)) {
			if (isSystemMediaExtension(file.extension)) {
				openFileWithSystemApp(this.app, file, this.lang);
			} else {
				new Notice(t(this.lang, 'common.cannotPreview'));
			}
			return;
		}
		void this.app.workspace.openLinkText(
			linkText,
			sourcePath,
			openNew ? 'tab' : false,
		);
	}

	updateReferencesOnRename(file: TFile, oldPath: string): void {
		if (this.engine.updateReferencesOnRename(file, oldPath)) {
			this.scheduleSave();
		}
	}

	updateReferencesOnDelete(file: TFile): void {
		if (this.engine.removeReferencesOnDelete(file)) {
			this.scheduleSave();
		}
	}

	async onClose(): Promise<void> {
		// 视图关闭：作废尚未执行的初始化重试（容器即将脱离 DOM）
		this.engine.invalidateInit();
		this.savePipeline.cancelTimer();
		this.titleRenameDebouncer.cancel();
		cancelStatusBarUpdate(this);
		// 挂起装配信号：关闭后到达的 onLoadFile 等待下一次 onOpen（原轮询语义）
		this.whenReady = new Promise(() => {});
		this.engine.persistViewport();
		await this.savePipeline.save();
		// 清理视图生命周期作用域的事件（搜索输入框 input/keydown 等）
		this.viewEvents.destroy();
		this.engine.destroyInstance();
		// 清空状态栏后，若仍有其他打开的思维导图视图则恢复其计数
		//（状态栏为插件级共享元素，本视图关闭不应清空其他视图的计数）。
		this.plugin.statusBar.clear();
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			const other = leaf.view;
			if (other instanceof MindMapView && other !== this && other.mindMap) {
				updateStatusBar(other);
			}
		});
	}

	onResize(): void {
		this.engine.resize();
	}
}
