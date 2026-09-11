/**
 * 思维导图视图（Controller）：Obsidian 生命周期、DOM 装配与编排委托。
 *
 * 第 6 步拆分后的职责边界（view.ts 已是纯编排壳）：
 * - DocumentService / SavePipeline（services/document-service.ts）
 *   md 文档读取解析与保存管线（防抖 + 串行排空 + 卸载快照兜底）；
 * - EngineController（services/engine-controller.ts）
 *   引擎实例生命周期、初始化代际锁、主题/布局/视口、引用更新（防腐收口）；
 * - TitleRenamer（view-title-renamer.ts） 中心主题 ⇄ 文件名重命名防抖；
 * - openHyperlink（view-link-navigator.ts） 节点超链接跳转路由；
 * - 本类只做编排：生命周期事件 → 装配 services 与 view-* 交互特性。
 */
import { FileView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { Language, t } from '../i18n';
import { AUTO_SPLIT_CHECK_DELAY_MS, VIEW_TYPE } from '../constants';
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import { notifyError } from '../errors';
import { walkCorrectImageSizesByAspect } from '../images-path';
import { openAsMarkdown } from '../md-open';
import { registerWikilinkInteractions } from './view-wikilink';
import type { MindMapViewContext, ViewPluginContext } from './view-context';
import { DocumentService, SavePipeline } from '../services/document-service';
import { EngineController } from '../services/engine-controller';
import {
	buildSearchBar,
	openSearchBar,
	refreshSearchBarLabels,
} from './view-search';
import { exportPNG } from './view-export';
import {
	arrangeMindMap,
	buildToolbar,
	refreshToolbar,
	syncLineStyleOptions,
} from './view-toolbar';
import { setupDragAndDrop } from './view-dnd';
import { setupContextMenu } from './view-context-menu';
import { registerViewHotkeys } from './view-hotkeys';
import { handleWindowPaste, setupPasteHandler } from './view-paste';
import {
	cancelStatusBarUpdate,
	updateStatusBar,
} from './view-status';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { setupImageResize, teardownImageResize } from './image-resize';
import { setupDragTargetAssist, teardownDragTargetAssist } from './drag-target';
import { EventBinder } from '../event-binder';
import { TitleRenamer } from './view-title-renamer';
import { openHyperlink as linkNavigatorOpen } from './view-link-navigator';
import {
	autoSplitActiveNode,
	splitActiveNodeLinks,
	splitAllLinksInDocument,
} from './view-split-links';

/** 视图装配完成信号超时（毫秒）：正常 onOpen 会 resolve；超时表示装配未完成，降级继续加载 */
const READY_TIMEOUT_MS = 10_000;

/** 视图状态里 mdBackMode 的白名单取值（非法/缺失回退 source） */
function readMdBackMode(value: unknown): 'source' | 'preview' {
	return value === 'preview' ? 'preview' : 'source';
}

export class MindMapView extends FileView implements MindMapViewContext {
	plugin: ViewPluginContext;
	canvasEl: HTMLElement | null = null;
	toolbarEl: HTMLElement | null = null;
	searchBarEl: HTMLElement | null = null;
	searchInput: HTMLInputElement | null = null;
	searchCountEl: HTMLElement | null = null;
	layoutSelect: HTMLSelectElement | null = null;
	lineStyleSelect: HTMLSelectElement | null = null;
	/** 当前深色主题（css-change 时重算；仅本类与引擎控制器装配面使用） */
	private isDark = false;

	/** md 文档读取/解析（渲染层数据面） */
	private documents: DocumentService;
	/** 保存管线（防抖 + 串行排空 + 卸载快照兜底） */
	private savePipeline: SavePipeline;
	/** 引擎实例生命周期（防腐收口，引擎内部访问不再出现在本类） */
	private engine: EngineController;
	/** 中心主题 ⇄ 文件名重命名（从 view.ts 拆出，见 view-title-renamer.ts） */
	private readonly titleRenamer: TitleRenamer;

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
	 * 待执行的引擎初始化帧（loadMindMapFromFile 用 rAF 等首帧布局就绪）。
	 * 必须可取消：视图关闭/文件切换后该回调仍会执行，届时容器可能仍在 DOM
	 * 且尺寸非零，会在已关闭的视图上建出完整引擎实例（无人销毁）。
	 */
	private pendingInitRaf: number | null = null;
	/**
	 * 当前布局（持久化到文件的唯一来源；不依赖 getData() 返回活引用还是深拷贝）。
	 * 由本类经 applyLayout/resolveLayout 维护（工具栏变更走 applyLayout 方法）。
	 */
	private currentLayout: string | null = null;
	/**
	 * 当前连线样式偏好（auto/curve/direct/straight，auto＝随布局）。
	 * 与布局同口径：按文件路径持久化到视图状态存储，由本类经
	 * applyLineStyle/resolveLineStyle 维护。
	 */
	private currentLineStyle: string | null = null;
	/**
	 * 自动拆分混排双链的延后检查计时器（引擎 data_change 后触发）。
	 * 视图关闭必须清理：回调会操作引擎与节点数据。
	 */
	private autoSplitTimer: number | null = null;

	/**
	 * .mindmap.md 文档模式（B3 显式切换）：文件本质是 Markdown，用导图视图
	 * 编辑并回写为 md 大纲。
	 */
	/** 进入前 markdown 视图模式（返回「以 Markdown 编辑」时恢复） */
	private mdBackMode: 'source' | 'preview' = 'source';
	/**
	 * 按文件键保留的 frontmatter 块（保存时拼回文件头；条目在 onUnloadFile
	 * 写盘结束后清理）。**必须按文件取值**：core 切换 FileView 的文件时不 await
	 * onUnloadFile，「最近加载的那一份」在换文件期间已属于新文件——若用单值字段，
	 * 旧文件的写盘会拼上新文件的文件头、或丢掉旧文件的文件头。
	 */
	private readonly frontmatterByPath = new Map<string, string | null>();
	/**
	 * 文档模式标记：parseDocument 时按文件名锁定（保存/回写恒为 md 大纲；
	 * 标记用于工具栏返回按钮与相关交互的显示判定）。外部读取走 isMdDocument()。
	 */
	private mdDocumentMode = false;

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

	constructor(leaf: WorkspaceLeaf, plugin: ViewPluginContext) {
		super(leaf);
		this.plugin = plugin;
		// 官方 API：App.isDarkMode()（@since 1.10.0）；勿用未文档化的
		// body.hasClass('theme-dark')（核心 CSS 类，官方 d.ts 中不存在）
		this.isDark = this.app.isDarkMode();

		this.documents = new DocumentService(this.app);
		this.savePipeline = new SavePipeline({
			app: this.app,
			getFile: () => this.file,
			// 内容一律按目标文件取：引擎已交班给别的文件时返回 null，管线改用
			// 排空期提前抓的兜底快照——绝不把新文件的内容写进旧文件（归属不变式）。
			getSnapshotFor: (file) =>
				this.file?.path === file.path ? this.engine.getDataSnapshot() : null,
			getFrontmatterFor: (file) =>
				this.frontmatterByPath.get(file.path) ?? null,
			isAutoSave: () => this.plugin.settings.autoSave,
			onSaveError: (error) => {
				notifyError(this.lang, 'save.failed', error);
			},
		});
		this.titleRenamer = new TitleRenamer({
			app: this.app,
			getFile: () => this.file,
			isEditingText: () => this.engine.isEditingText(),
			getRootText: () => this.engine.getRootText(),
			lang: this.lang,
		});
		this.engine = new EngineController({
			app: this.app,
			getCanvasEl: () => this.canvasEl,
			getFile: () => this.file,
			getLang: () => this.lang,
			isDark: () => this.isDark,
			getSetupOptions: () => ({
				layout: this.resolveLayout(),
				lineStyle: this.resolveLineStyle(),
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
				this.titleRenamer.schedule();
			},
			onDataChanged: () => this.scheduleAutoSplitCheck(),
			onNodeImageClick: (node) => openNodeImageFullscreen(this, node),
			onNodeAttachmentClick: (node) => {
				const data = node.getData() as { attachmentUrl?: unknown };
				const url =
					typeof data?.attachmentUrl === 'string' ? data.attachmentUrl : '';
				if (url) {
					this.openHyperlink(url);
				}
			},
			setupFeatures: () => {
				setupDragAndDrop(this);
				setupPasteHandler(this);
				setupContextMenu(this);
				registerWikilinkInteractions(this);
				setupImageResize(this);
				setupDragTargetAssist(this);
			},
			onEngineReady: (layout, lineStyle) =>
				this.onEngineReady(layout, lineStyle),
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

	override getDisplayText(): string {
		// 中心主题 ⇄ 文件名同步（改中心即重命名）；标题显示即文件名
		return this.file ? this.file.basename : t(this.lang, 'common.mindMap');
	}

	override getIcon(): string {
		return 'dot-network';
	}

	override async onOpen(): Promise<void> {
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
			const dark = this.app.isDarkMode();
			if (dark !== this.isDark) {
				this.isDark = dark;
				this.applyTheme();
			}
		};
		this.registerEvent(
			this.app.workspace.on('css-change', this.boundHandleCssChange),
		);
		// 视图内快捷键（搜索 / 撤销重做 / F2 编辑节点）：内部会按官方要求
		// 确保 this.scope 已创建（View.scope 默认为 null，不创建则全部失效）
		registerViewHotkeys(this);

		// 窗口级粘贴兜底：只注册一次（随视图生命周期由 Component 自动清理），
		// 不放在 setupPasteHandler 中，避免每次刷新引擎累积监听。
		// 激活视图判定在此处做（需要 MindMapView 类引用），view-paste 保持无类依赖。
		// 挂在画布所属窗口（popout 窗口里主窗口收不到 paste）
		this.registerDomEvent(this.containerEl.win, 'paste', (event) => {
			if (this.app.workspace.getActiveViewOfType(MindMapView) !== this) {
				return;
			}
			handleWindowPaste(this, event);
		});

		resolveReady();
		if (this.file) {
			await this.loadMindMapFromFile(this.file);
		}
	}

	override async onLoadFile(file: TFile): Promise<void> {
		// 等待装配完成（onOpen 尚未执行时挂起，替代原 10ms 轮询）。
		// 10s 超时降级：正常装配毫秒级完成；超时表示 onOpen 未 resolveReady
		// （异常路径/极端情形），继续加载但 DOM 可能不完整。
		const readyTimeout = new Promise<'timeout'>((resolve) => {
			window.setTimeout(() => resolve('timeout'), READY_TIMEOUT_MS);
		});
		const result = await Promise.race([
			this.whenReady.then(() => 'ready' as const),
			readyTimeout,
		]);
		if (result === 'timeout') {
			console.warn(
				'MindMapView: 等待视图装配超时，降级继续加载',
				file.path,
			);
		}
		// onOpen 已为同一文件启动加载（读取中或已完成）时跳过，
		// 避免同一文件被读取两次、引擎实例被创建两次。
		if (this.loadingFilePath === file.path) {
			return;
		}
		await this.loadMindMapFromFile(file);
	}

	override async onUnloadFile(file: TFile): Promise<void> {
		const unloadingPath = this.loadingFilePath;
		this.engine.invalidateInit();
		this.cancelPendingInit();
		this.savePipeline.cancelTimer();
		this.titleRenamer.cancel();
		// 先保存当前视口，再写盘正文（引擎随后销毁）
		this.engine.persistViewport();
		// 显式传入本文件与**本文件**的树快照（同步抓取，不受后续 await 影响）：
		// core 不 await onUnloadFile，await 期间新文件可能已接管引擎与 this.file，
		// 隐式取值会把新文件的内容写进本文件（见 SavePipeline 归属不变式）。
		await this.savePipeline.save(file, this.engine.getDataSnapshot());
		this.frontmatterByPath.delete(file.path);
		// 文件切换后允许再次加载同一路径（新会话）。仅清理「仍属于本次卸载」的
		// 标记：await 期间可能已开始加载新文件（onLoadFile），无条件置空会把
		// 新加载的代际标记抹掉，其 rAF 守卫随即判为过期 → 导图不渲染。
		if (this.loadingFilePath === unloadingPath) {
			this.loadingFilePath = null;
		}
		this.engine.destroyInstance();
	}

	/** 取消尚未执行的引擎初始化帧（幂等） */
	private cancelPendingInit(): void {
		if (this.pendingInitRaf !== null) {
			this.containerEl.win.cancelAnimationFrame(this.pendingInitRaf);
			this.pendingInitRaf = null;
		}
	}

	private async loadMindMapFromFile(file: TFile): Promise<void> {
		this.loadingFilePath = file.path;
		// 布局取自视图状态存储（按文件路径）；不再跨文件沿用上一文件的布局
		this.currentLayout =
			this.plugin.viewState.getLayout(file.path) ??
			this.plugin.settings.defaultLayout;
		// 连线样式偏好同口径按文件取（auto＝随布局）
		this.currentLineStyle =
			this.plugin.viewState.getLineStyle(file.path) ??
			this.plugin.settings.defaultLineStyle;
		try {
			const doc = await this.documents.load(file);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadingFilePath !== file.path) {
				return;
			}
			this.frontmatterByPath.set(file.path, doc.frontmatter);
			this.mdDocumentMode = doc.isMdDocument;
			// 记录进入前 markdown 模式（「以 Markdown 编辑」返回时恢复）：
			// 视图状态未经校验（用户手改 workspace.json 等可能产生任意值），
			// 按白名单取值，非法/缺失一律回退 source（与 ViewStateStore.hydrate
			// 的防御风格一致）。
			this.mdBackMode = readMdBackMode(
				this.leaf.getViewState().state?.mdBackMode,
			);
			const tree = doc.tree;
			// 按图片原始宽高比校正尺寸（统一高度、宽度按比例），
			// 在首次渲染前完成，避免首帧用固定比例再跳变。
			// 官方嵌入尺寸参数（![[图|300]]）的节点在此过程中按参数定尺寸。
			await walkCorrectImageSizesByAspect(tree);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadingFilePath !== file.path) {
				return;
			}
			// 上一帧若尚未执行（快速切换文件），先取消，避免旧树被渲染
			this.cancelPendingInit();
			this.pendingInitRaf = this.containerEl.win.requestAnimationFrame(
				() => {
					this.pendingInitRaf = null;
					if (this.loadingFilePath !== file.path) {
						return;
					}
					this.engine.initMindMap(tree);
				},
			);
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

	/** 本次引擎创建所用连线样式偏好（fallback 默认值并回写会话字段） */
	private resolveLineStyle(): string {
		const lineStyle =
			this.currentLineStyle || this.plugin.settings.defaultLineStyle;
		this.currentLineStyle = lineStyle;
		return lineStyle;
	}

	/** 引擎就绪收尾：同步布局/连线样式选择器；md 模式重建工具栏补返回按钮 */
	private onEngineReady(layout: string, lineStyle: string): void {
		if (this.layoutSelect) {
			this.layoutSelect.value = layout;
		}
		syncLineStyleOptions(this, layout, lineStyle);
		// md 文档模式：onOpen 构建工具栏时文件尚未加载（mdDocumentMode=false），
		// 加载完成后重建工具栏以补上「以 Markdown 编辑」返回按钮
		if (this.mdDocumentMode) {
			this.refreshToolbar();
			if (this.layoutSelect && this.currentLayout) {
				this.layoutSelect.value = this.currentLayout;
			}
			// 重建后选项面回到全局默认：按文件会话值重新校正
			syncLineStyleOptions(
				this,
				this.currentLayout ?? layout,
				this.currentLineStyle ?? lineStyle,
			);
		}
	}

	/** 标题重命名已委托 TitleRenamer（view-title-renamer.ts） */

	/**
	 * 切换布局（工具栏调用）：更新会话字段 + 立即写入视图状态存储
	 * （.mindmap.md 布局不写入正文，存 data.json 按文件路径恢复）。
	 */
	applyLayout(value: string): void {
		this.currentLayout = value;
		this.engine.setLayout(value);
		// 连线样式选项面随布局变化（固定直线布局收窄为「自动」单项）
		syncLineStyleOptions(this, value, this.resolveLineStyle());
		if (this.file) {
			this.plugin.viewState.setLayout(this.file.path, value);
		}
	}

	/**
	 * 切换连线样式偏好（工具栏调用）：更新会话字段 + 立即写入视图状态存储
	 * （auto＝随布局；不写入正文）。
	 */
	applyLineStyle(value: string): void {
		this.currentLineStyle = value;
		this.engine.setLineStyle(value);
		if (this.file) {
			this.plugin.viewState.setLineStyle(this.file.path, value);
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

	/**
	 * 拆分当前选中节点内的混排双链（命令入口；提示由 view-split-links 负责）。
	 */
	splitActiveNodeLinks(): void {
		splitActiveNodeLinks(this);
	}

	/**
	 * 拆分文档内全部混排双链（命令入口；提示由 view-split-links 负责）。
	 * 与自动触发不同：这是显式批量动作，会处理未编辑的存量节点。
	 */
	splitAllLinksInDocument(): void {
		splitAllLinksInDocument(this);
		// 批量经 setData 全量替换（不保证派发 data_change）→ 手动刷新节点计数
		updateStatusBar(this);
	}

	/**
	 * 引擎数据变更后的自动拆分检查（延后一拍）：文本编辑提交与数据写入可能
	 * 在同一轮事件里，立刻检查会读到编辑框尚未收起的中间态。
	 * 仅对「被编辑过」的节点生效，判定见 view-split-links.autoSplitActiveNode。
	 */
	private scheduleAutoSplitCheck(): void {
		this.cancelAutoSplitCheck();
		this.autoSplitTimer = window.setTimeout(() => {
			this.autoSplitTimer = null;
			autoSplitActiveNode(this);
		}, AUTO_SPLIT_CHECK_DELAY_MS);
	}

	/** 取消尚未执行的自动拆分检查（重复调度 / 视图关闭时） */
	private cancelAutoSplitCheck(): void {
		if (this.autoSplitTimer !== null) {
			window.clearTimeout(this.autoSplitTimer);
			this.autoSplitTimer = null;
		}
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

	/** 语言变更后刷新搜索栏文案（就地更新，不重建 DOM） */
	refreshSearchBarLabels(): void {
		refreshSearchBarLabels(this);
	}

	// ==================== 导出（委托 view-export.ts） ====================

	async exportPNG(): Promise<void> {
		await exportPNG(this);
	}

	// ==================== 链接跳转 / 引用更新 / 清理 ====================

	/**
	 * 打开节点超链接（wiki / http / 库内路径）—— 委托 view-link-navigator。
	 * 保留 MindMapViewContext 接口契约（engine-controller / view-wikilink 依赖）。
	 */
	openHyperlink(link: string, openNew = false): void {
		linkNavigatorOpen(this, link, openNew);
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

	override async onClose(): Promise<void> {
		this.engine.invalidateInit();
		this.cancelPendingInit();
		// 关闭后不再允许任何加载结果被应用（rAF 守卫依赖该字段）
		this.loadingFilePath = null;
		this.savePipeline.cancelTimer();
		this.cancelAutoSplitCheck();
		this.titleRenamer.cancel();
		cancelStatusBarUpdate(this);
		// 交互会话收尾（拖拽换父 / 图片调宽）：会话期间的临时 window 监听
		// 不经事件绑定器记录，中途关闭视图收不到 mouseup，须显式清理。
		// 必须在 savePipeline.save() 之前——调宽会话收尾会调度一次保存。
		teardownDragTargetAssist(this);
		teardownImageResize(this);
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

	override onResize(): void {
		this.engine.resize();
	}
}
