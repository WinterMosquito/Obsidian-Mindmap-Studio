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
import {
	type EventRef,
	FileView,
	Notice,
	TFile,
	type ViewStateResult,
	WorkspaceLeaf,
} from 'obsidian';
import { Language, t, tf } from '../core/i18n';
import { readNodeDataString } from '../core/node-data';
import { postProcessExportSvg } from '../platform/export-svg-postprocess';
import {
	injectMathStylesIntoExportSvg,
	pinMathContainerHeightsInExportSvg,
} from '../platform/math-jax';
import { refreshPrismTokenColors } from '../platform/prism-code';
import { updatesInternalLinksOnRename } from '../platform/vault-prefs';
import { createDebouncer, createThrottler, type Debouncer } from '../core/concurrency';
import {
	AUTO_SPLIT_CHECK_DELAY_MS,
	DEFAULT_PALETTE,
	headingStartOfSyntax,
	isNodeOnlyColorScope,
	LARGE_MAP_RENDER_HINT_NODES,
	normalizeLineStylePreference,
	normalizePalettePreference,
	normalizeThemeStyle,
	VIEW_TYPE,
} from '../core/constants';
import type {
	MindMap,
	MindMapNode,
	MindMapTreeNode,
} from '../core/engine-types';
import { notifyError } from '../core/errors';
import {
	applyColorDirectivesToTree,
	applyImageSizeCorrectionsToEngine,
	applyRelationsToTree,
	applySessionSnapshot,
	applySummariesToTree,
	countMindMapNodes,
	countTreeNodes,
	getRenderRoot,
	readHistoryAvailability,
	syncLiveRelations,
	syncLiveSummaries,
	syncNodeColorDirectives,
} from '../engine/mindmap';
import {
	resolveFilePreferences,
	type PreferenceKey,
} from '../services/view-state';
import { ContentRemeasureSession } from './content-remeasure';
import { LoadSession } from './view-load-session';
import {
	collectImageSizeCorrections,
	ensureDefaultImageSizes,
	imageSizeKey,
	reuseKnownImageSizes,
	type ImageSizeValue,
} from '../media/images-path';

import { openAsMarkdown, readDeclaredLayout } from '../markdown/md-open';
import {
	normalizeLayoutId,
	setMindMapLayout,
} from '../domain/mindmap-property';
import { registerWikilinkInteractions } from './view-wikilink';
import { setupNodeTaskInteraction } from './view-node-task';
import { cancelNodePick, setupNodePick } from './node-pick';
import { cancelRelationAnchor } from './view-relation-anchor';
import {
	schedulePersistRelationGeometry,
	setupRelationInteractions,
	teardownRelationInteraction,
} from './view-node-relation';
import { registerTagClicks } from './view-tag';
import { setupFootnoteInteractions } from './view-footnote';
import {
	closeInlineEditor,
	isAnyNodeEditing,
} from './node-inline-editor';
import {
	hideCopyButtonsInExportSvg,
	registerCodeBlockInteractions,
} from './node-codeblock';
import {
	buildInlineNodeContent,
	type InlineContentOptions,
} from './node-inline-content';
import { colorDirectiveOf } from './node-inline-tokenize';
import { createInlineContentOptions } from './node-content-factory';
import {
	setupCanvasQuickCreate,
	setupNodeTextEditFallback,
} from './view-node-actions';
import type {
	HyperlinkOpenMode,
	MindMapViewContext,
	ViewPluginContext,
} from './view-context';
import {
	DocumentSession,
	type SessionSaveState,
	type SessionViewPort,
} from '../services/document-session';
import type { SaveState } from '../services/status-bar';
import { EngineController } from '../services/engine-controller';
import {
	buildSearchBar,
	openSearchBar,
	refreshSearchBarLabels,
} from './view-search';
import { exportImage } from './view-export';
import {
	arrangeMindMap,
	buildToolbar,
	refreshToolbar,
	syncHistoryButtons,
} from './view-toolbar';
import { setupDragAndDrop } from './view-dnd';
import { setupContextMenu } from './view-context-menu';
import { registerViewHotkeys } from './view-hotkeys';
import { setupViewportGestures } from './view-viewport';
import { handleWindowPaste, setupPasteHandler } from './view-paste';
import { handleClipboardShortcut } from './view-clipboard';
import {
	cancelStatusBarUpdate,
	updateStatusBar,
} from './view-status';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { setupImageResize, teardownImageResize } from './image-resize';
import {
	refreshMiniMap,
	refreshMiniMapAfterRender,
	setupMiniMap,
	teardownMiniMap,
} from './view-minimap';
import { gateNodeWidthHandles, setupNodeWidthRefresh } from './view-node-width';
import { EventBinder } from '../core/event-binder';
import { TitleRenamer } from './view-title-renamer';
import {
	isResolvedWikiLinkpath,
	openHyperlink as linkNavigatorOpen,
} from './view-link-navigator';
import {
	captureAutoSplitCandidate,
	runAutoSplitCheck,
	splitAllLinksInDocument,
} from './view-split-links';
import {
	applyDocumentSyntax as applyDocumentSyntaxFeature,
	cancelSyntaxGuard,
	resolveDocumentSyntax as resolveDocumentSyntaxFeature,
	scheduleSyntaxGuard,
	setupSyntaxGuard,
} from './view-syntax';
import {
	seedHeadingStart,
	type DocumentSyntax,
} from '../markdown/md-heading-syntax';

/** 视图装配完成信号超时（毫秒）：正常 onOpen 会 resolve；超时表示装配未完成，降级继续加载 */
const READY_TIMEOUT_MS = 10_000;

/**
 * resize 节流窗口（毫秒）：拖动窗口边框 / 侧栏分隔条期间 resize 高频触发，
 * 而引擎 `resize()` 只要画布宽高变化即整树 `render()`（vendor 只有重入保护，
 * 无事件级合并）——限流到至多每窗口一次、尾随保证最后尺寸落地。
 */
const RESIZE_THROTTLE_MS = 100;

/**
 * 大图 resize 的**尾随合并**窗口（毫秒）：停止拖动后这么久再做一次整树重排。
 *
 * 为什么另开一条（2026-11-04 实机实测）：5000 节点图单轮 `render()` 的同步长任务
 * ≈0.4 s，100 ms 节流在 1.2 s 拖动里仍排 **5 轮**（长任务合计 **1.58 s**、4 个
 * >50 ms 卡顿帧）。尾随合并把整段拖动压成一次重排；代价是拖动期间画布仍是旧
 * 尺寸（≤180 ms 的空白 / 裁切），换掉每秒数次的长冻结。
 *
 * 阈值复用 `LARGE_MAP_RENDER_HINT_NODES`（1000）：此规模以下单轮 render 只有
 * 几十毫秒，实时重排的体验更好；之上正是引擎进异步通道、而**布局仍同步**的区间。
 */
const RESIZE_DEFER_MS = 180;

/**
 * 大图首帧提示的兜底摘除时限（毫秒）。
 *
 * 正常路径由首帧渲染结束摘除（大图 2–3 s）。兜底只防「渲染抛错 / 事件没来」时
 * 提示永久盖住画布：宁可多显示几秒，也不能让用户只剩一块空白。
 */
const RENDER_HINT_TIMEOUT_MS = 15_000;

/**
 * 可在**不重建引擎**的前提下完成刷新的 LIVE_REFRESH 键（键集合由 `settings.ts`
 * 的 `diffLiveRefreshKeys` 产出；这里只决定「收到这个键时做什么」）。
 *
 * - `defaultTheme`：引擎 `setThemeConfig` 通道原地生效（与 css-change 同款）；
 * - `defaultThemeStyle` / `defaultLineStyle`：**故意留空**——会话字段在
 *   `loadMindMapFromFile` 里已按「文件显式选择 ?? 默认值」定值，此后默认值
 *   变更对已打开的图**本就不生效**（重建一轮也不会有任何可见变化）⇒ 跳过即
 *   行为等价的优化（省掉整树 `structuredClone` + 全量重渲染，实测口径见 K58）；
 * - `nodeColorScope`：只改「连接线要不要跟着节点色」这层派生样式，重算一次
 *   颜色即可（见 `applySettingsChange`）。
 *
 * `defaultLayout` 已不在 LIVE_REFRESH 键内（2026-10-29）：逐文件布局只存在于
 * 文件属性，它是新建文件的种子值——改它对任何已打开/已存在文件都无影响。
 *
 * 2026-10-09 减法：原 `performanceMode` / `performanceThreshold` 两条在此做
 * 引擎运行时切换（`engine/mindmap.applyPerformanceMode`）——性能模式改为**常开 +
 * 常量阈值**后设置面板不再有滑块，运行时切换没有触发源，该分支随之删除
 * （`applyPerformanceMode` 本身保留：`verify:visual` 的 perf 探针仍在用）。
 *
 * 其余两个键**必须重建**（引擎侧只有创建期通道，2026-09-17 审计结论见 K62）：
 * - `enableDrag`：节点拖拽由引擎 Drag 插件承担，而该插件在本插件创建期按此开关
 *   注册（`engine/mindmap.createMindMap` 的 `addPlugin(Drag)`）；运行时切换需要
 *   `removePlugin`（**未入 d.cts**，属插件生命周期操作）——一个很少切换的布尔
 *   设置不值得承担解绑不完整的风险；
 * - `language`：引擎无 `lang` 选项，语言在创建期被闭包捕获两处（默认节点文案与
 *   自绘钩子的 `lang` 实参），重建才能让两者一致（UI 侧另有 `refreshLanguageUi`）。
 */
const IN_PLACE_REFRESH_KEYS = new Set([
	'defaultTheme',
	'defaultThemeStyle',
	'defaultLineStyle',
	'nodeColorScope',
]);

/**
 * 按文件偏好 → 会话字段名（`MindMapView` 上的私有字段）。
 *
 * 与 `PreferenceKey` 用 `satisfies` 绑死：新增一个按文件记的维度时，漏写这里
 * 或写错字段名都会编译失败（`commitPreference` 靠它定位写入目标）。
 *
 * **布局不在其中**：它不从 `data.json` 读、也不写 `data.json`，走
 * `applyLayout` 的独立实现（写文件属性）。
 */
const SESSION_FIELDS = {
	lineStyle: 'currentLineStyle',
	palette: 'currentPalette',
	themeStyle: 'currentThemeStyle',
} as const satisfies Record<PreferenceKey, string>;

/**
 * 从视图状态读「进入前 md 模式」（唯一的取值 + 白名单判定）。
 *
 * 状态未经校验（用户手改 workspace.json 等可能产生任意值，`state` 本身也可能
 * 是 null / 非对象），非法/缺失一律回退 source（与 ViewStateStore.hydrate 的
 * 防御风格一致）。消费点只有 setState 覆写（读入点），见那里。
 */
function readMdBackMode(state: unknown): 'source' | 'preview' {
	return (state as { mdBackMode?: unknown } | null)?.mdBackMode === 'preview'
		? 'preview'
		: 'source';
}

export class MindMapView
	extends FileView
	implements MindMapViewContext, SessionViewPort
{
	plugin: ViewPluginContext;
	canvasEl: HTMLElement | null = null;
	toolbarEl: HTMLElement | null = null;
	searchBarEl: HTMLElement | null = null;
	searchInput: HTMLInputElement | null = null;
	searchCountEl: HTMLElement | null = null;
	/**
	 * 保存状态（状态栏展示，见 `services/status-bar` 的 `SaveState`）：
	 * 排程 → saving；一轮排空成功 → saved；失败 / 外部冲突 / 自动保存挂起 →
	 * unsaved。写入只在本视图为活动视图时发生（状态栏是共享元素，后台视图的
	 * 写盘结果不该盖掉前台那张图的状态）；切回本视图时由 `updateStatusBar`
	 * 按本字段重新推送。
	 */
	saveState: SaveState = 'idle';
	// 外观项（布局/连线/配色/边框）都没有屏上下拉，故无 select 字段——
	// 当前值经 `resolveLayout()` / `resolvePreference(key)` 现算给右键勾选态与竖栏开关。
	/** 当前深色主题（css-change 时重算；仅本类与引擎控制器装配面使用） */
	private isDark = false;

	/**
	 * 本文件所属的**文档会话**（Level B）：一份权威树 + 一条撤销线 + 一条保存
	 * 管线，同文件其余视图共享它。引擎树只是会话的只读投影。
	 *
	 * 为空表示尚未加载 / 已卸载（`scheduleSave` / 提交 / 撤销都静默跳过）。
	 */
	private session: DocumentSession | null = null;
	/**
	 * 编辑提交是否已「上膛」：引擎首帧渲染结束前置 false。
	 *
	 * 必须挡住这一刻：`seedInitialHistory`（K160）在首帧渲染结束时记一条历史，
	 * 引擎会发一次 `data_change`——若不挡，会话会把**引擎规范化后的树**当成
	 * 一次编辑入栈（多一条按 Ctrl+Z 毫无反应的幽灵历史），并排一次保存。
	 * 用户编辑不可能早于首帧（那时画布上还没有节点）。
	 */
	private commitsArmed = false;
	/** 引擎实例生命周期（防腐收口，引擎内部访问不再出现在本类） */
	private engine: EngineController;
	/**
	 * 布局写入在途的目标值（引擎 layout id）：`applyLayout` 写属性期间置位、收尾清空。
	 *
	 * 用途只有一个——让跟随侧（`syncDeclaredLayout`）让位。写属性必然触发
	 * `metadataCache.changed`，而「事件先到还是 `await` 先恢复」由宿主实现决定；
	 * 不挡就是同一布局被应用两次（双重重排 + 右缘竖栏连建两次）。
	 */
	private pendingLayoutWrite: string | null = null;
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
	 * `css-change` 的 `EventRef`：`registerEvent` 的清理时机是 **Component 卸载**，
	 * 而本视图在 `onClose` 并不卸载，故须自行保存引用并在 `onClose` 显式 `offref`。
	 */
	private cssChangeRef: EventRef | null = null;
	/** `active-leaf-change` 的 `EventRef`（同款：`onClose` 不卸载 Component，须显式 `offref`） */
	private activeLeafRef: EventRef | null = null;
	/** 窗口级 paste 监听器（须按同一函数引用移除；`registerDomEvent` 同样只在卸载时清理） */
	private pasteHandler: ((event: ClipboardEvent) => void) | null = null;
	/**
	 * 加载会话状态（whenReady / 加载去重路径 / 首帧初始化帧 / 挂起的图片校正）。
	 * 四个字段被 onOpen 与 onLoadFile 两个入口读写，时序契约见
	 * view-load-session.ts 的文件头；本类只保留编排。
	 */
	readonly loadSession = new LoadSession();
	/**
	 * 当前布局（引擎 layout id）。
	 *
	 * **唯一持久化位是文件属性**（frontmatter 的 `Mindmap Layout` 键）：加载时
	 * 读布局（`readDeclaredLayout`），切换时写布局键（`applyLayout`）。`Mindmap`
	 * 键只是启用开关，不承载布局（2026-11-07 拆分）。
	 *
	 * 字段初值给 `null` 只为满足构造顺序，构造函数随即赋 `settings.defaultLayout`
	 * （见构造函数注释）——`onOpen` 建工具栏早于文件加载，引擎那时尚未创建，而竖栏
	 * 「连线」开关的可用性要按一个布局先定下来；换文件时由 `loadMindMapFromFile`
	 * 按新文件的声明覆盖。
	 */
	private currentLayout: string | null = null;
	/**
	 * 当前连线样式偏好（straight 折线 / curve 曲线；2026-10-21 收敛为两态）。
	 * **按文件**持久化到视图状态存储，由本类经 `applyLineStyle` /
	 * `resolvePreference` 维护（布局不在此列——它只存文件属性，见 `currentLayout`）。
	 */
	private currentLineStyle: string | null = null;
	/**
	 * 当前配色（色相方案）。**按文件**持久化到视图状态存储（不是全局设置），
	 * 由本类经 `applyPalette` / `resolvePreference` 维护。
	 */
	private currentPalette: string | null = null;
	/**
	 * 当前边框样式（default＝有边框 / borderless＝无边框）。同样**按文件**记在
	 * 视图状态存储，由本类经 `applyThemeStyle` / `resolvePreference` 维护。
	 */
	private currentThemeStyle: string | null = null;
	/**
	 * 自动拆分混排双链的延后检查计时器（引擎 data_change 后触发）。
	 * 视图关闭必须清理：回调会操作引擎与节点数据。
	 */
	private autoSplitDebouncer: Debouncer = createDebouncer(AUTO_SPLIT_CHECK_DELAY_MS);

	/**
	 * 概要框的补渲染是否已排队（`syncLiveSummaries` 改了 data 才排）。
	 *
	 * 概要框是**布局产物**：`node_tree_render_end` 里写进 data 的那一轮，
	 * 括号已经按旧数据画完了，必须再渲染一轮才会出现/移动。用布尔位合并同一
	 * 轮里的多次请求（连续编辑只补一次），回调里按「引擎仍是同一实例」兜底。
	 */
	private summaryRenderQueued = false;

	/**
	 * resize 节流器（见 RESIZE_THROTTLE_MS）：窗口/侧栏拖动的连续尺寸变化合并到
	 * 每窗口至多一次整树重排；onClose 取消（视图关闭后不再触碰引擎）。
	 */
	private readonly resizeThrottler = createThrottler(RESIZE_THROTTLE_MS);

	/**
	 * 大图 resize 的尾随定时器（见 `RESIZE_DEFER_MS`）：拖动中只重排计时器，
	 * 停止后再做一次整树 resize；`onClose` / 换文件时取消。
	 */
	private resizeDeferTimer: number | null = null;

	/**
	 * 内联内容构建选项（**视图实例级一次**，2026-10-02）：内容只依赖视图，与
	 * node/doc/style 无关——此前每个节点内容重建都新建对象 + 4 个闭包
	 * （5000 节点打开 ≈ 2 万临时闭包，恰在打开路径上）。箭头闭包捕获实例 this
	 * （属性读取延迟到调用），无字段初始化顺序问题。
	 *
	 * 2026-10-09 减法：原 `selfDrawPlain` 项（设置 `selfDrawPlainNodes` 的会话中
	 * 可变项，需每次构建就地覆盖）随该设置一并移除——纯文本节点**常开**接管。
	 */
	private readonly inlineContentOptions: InlineContentOptions =
		createInlineContentOptions({
			// 宿主面就是本视图（结构化满足 MindMapLinkHost：app / file / lang）
			isResolvedLink: (linkpath) => isResolvedWikiLinkpath(this, linkpath),
			// 定稿回调交给本视图的尺寸同步会话（平台通道的回调绑定收口见
			// node-content-factory；代码块嵌入用同一个工厂 + 自己的会话）
			onSettled: (holder) => this.contentRemeasure.schedule(holder),
		});

	/**
	 * 文档模式（B3 显式切换）：文件本质是 Markdown（frontmatter 声明为导图，
	 * 或用户手动把普通笔记开为导图），用导图视图编辑并回写为 md 大纲。
	 */
	/**
	 * 进入前 markdown 视图模式（「切换回 Markdown」时恢复）。
	 * 读入点 = setState 覆写（唯一权威来源），写回点 = getState 覆写
	 * （官方 leaf.getViewState() 的 state 只取自 view.getState()）。
	 */
	private mdBackMode: 'source' | 'preview' = 'source';
	/**
	 * 大图首帧渲染提示（`view.renderingLargeMap`）。
	 *
	 * 引擎首帧是**一个同步长任务**（实测 5000 节点 ≈2.2 s），期间画布空白、
	 * 界面完全无响应。提示在加载的 rAF 回调里创建——引擎的 `render()` 排在
	 * `setTimeout(0)`（见 vendor `Render.render`），本次帧末就会绘制，提示因此在
	 * 长任务开始**之前**已经上屏；首帧渲染结束（`node_tree_render_end`）即摘除。
	 * 亦步亦趋地跟引擎生命周期：视图关闭 / 引擎销毁 / 兜底超时都会清掉。
	 */
	private renderHintEl: HTMLElement | null = null;
	/** 提示的兜底摘除定时器（渲染异常时不让它永久留在屏上） */
	private renderHintTimer: number | null = null;

	/**
	 * 自绘内容「定稿 → 尺寸同步」会话（P4 / K88 / K104 / K116）。
	 *
	 * 2026-10-11 外置到 `features/content-remeasure.ts`（架构文档登记的偏离项
	 * 「数学校准会话仍在视图层」就此关闭）：按 holder 反查真实节点、批量合并重排、
	 * 字体分批再同步与渲染窗口重试的完整论证都在该模块文件头，此处不重复。
	 */
	private readonly contentRemeasure = new ContentRemeasureSession({
		getMindMap: () => this.mindMap,
		register: (cleanup) => this.register(cleanup),
		// 可见性判据（官方 `Element.isShown()`）：叶子在后台标签时祖先链为
		// display:none，此刻量测恒 0×0，会话据此挂起（见 content-remeasure ④）
		isVisible: () => this.containerEl.isShown(),
		// 画布根（未定稿修复 / 登记面清理的作用域，见 content-remeasure ⑤）：
		// holder 都在引擎挂载点内；引擎未建（首帧前）时为 null，会话静默跳过
		getContentRoot: () => this.canvasEl,
	});

	/** 引擎实例（view-* 模块经 context 只读访问） */
	get mindMap(): MindMap | null {
		return this.engine.mindMap;
	}

	/** 引擎实例作用域事件绑定器（随引擎销毁清理，view-* 经 context 注册） */
	get engineEvents(): EventBinder {
		return this.engine.engineEvents;
	}

	constructor(leaf: WorkspaceLeaf, plugin: ViewPluginContext) {
		super(leaf);
		this.plugin = plugin;
		// 建栏早于文件加载：先按种子布局显示工具栏（文件加载后由声明覆盖）
		this.currentLayout = plugin.settings.defaultLayout;
		// 官方 API：App.isDarkMode()（@since 1.10.0）；勿用未文档化的
		// body.hasClass('theme-dark')（核心 CSS 类，官方 d.ts 中不存在）
		this.isDark = this.app.isDarkMode();

		// 保存管线归会话（Level B）：同一文件的多个视图共享一条管线，保存的是
		// 会话权威树而非某个视图的陈旧快照；视图只经 `session.scheduleSave()`
		// 请求排程。
		this.titleRenamer = new TitleRenamer({
			app: this.app,
			getFile: () => this.file,
			// 任一编辑通道进行中（引擎编辑框 ∨ 插件内联编辑器）都视为「仍在编辑」
			isEditingText: () => isAnyNodeEditing(this.mindMap),
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
				lineStyle: this.resolvePreference('lineStyle'),
				themePref: this.plugin.settings.defaultTheme,
				// 边框与配色都按文件记（viewState），不是设置项
				themeStyle: this.resolvePreference('themeStyle'),
				palette: this.resolvePreference('palette'),
				enableDrag: this.plugin.settings.enableDrag,
				// 性能模式与阈值不再由设置传入（2026-10-09 减法）：引擎缺省
				// 即「开启 + PERFORMANCE_NODE_THRESHOLD」，无需在此复述
			}),
			viewState: this.plugin.viewState,
			openHyperlink: (link) => this.openHyperlink(link),
			// 引擎销毁通知（未定稿数学段登记面的唯一清理点）：按引擎身份清掉该
			// 实例归属的条目（语义见 content-remeasure 的 forgetEngine；按 DOM
			// 连接状态判归属会在首帧前误清新引擎的全部懒加载段，2026-10-14 实机定案）
			onEngineDisposed: (engine) =>
				this.contentRemeasure.forgetEngine(engine),
			// 节点内联内容（方案 B 原型）：含行内链接 / 轻标记、或超长文本（引擎的
			// SVG 换行是逐字符二次复杂度，长行必须接管）且无图的节点改走自绘 HTML；
			// 其余节点返回 null 走引擎默认文本（点击跳转复用 view-wikilink 既有分流）
			createNodeContent: (node, doc, style, lang, owner) => {
				// 宽度手柄门禁（幂等）：纯文本/含图节点上的拖宽手柄是死的
				// （引擎文本路径不认 customTextWidth），只留在自绘节点上
				gateNodeWidthHandles(node);
				// 选项对象与闭包见 inlineContentOptions（实例级一次构造；
				// 其中 isResolvedLink 注入未解析链接弱化、renderMath 走官方
				// loadMathJax 通道并携带定稿回调——批次执行时经 findNodeByDom
				// 解析真实节点再重排，构建期闭包可能持有预测量代理，见 K88）。
				// 选项**不含任何设置项**（接管判据只看节点数据，见
				// node-inline-content.resolveSelfDrawSource），故无需就地覆盖。
				// `owner`（本次引擎实例）原样透传——数学段的归属登记靠它，
				// 本层不解释（见 InlineContentOptions.renderMath）
				return buildInlineNodeContent(
					node,
					doc,
					style,
					lang,
					this.inlineContentOptions,
					owner,
				);
			},
			// 导出 SVG 后处理链（按序应用）：platform 单入口（几何余量 → CSS 变量
			// 注入，顺序由 postProcessExportSvg 保证，见 K99 / K106）→ MathJax 字形
			// 样式注入 → 数学容器高度钉扎（K107——导出环境 MJX 字体缺失使容器膨胀
			// ~1.8 倍、文字下移压到节点底边框）→ 复制按钮隐身。链尾项分居 platform
			// 与 features（K51），故在组合根装配后注入。
			exportSvgTransforms: [
				postProcessExportSvg,
				injectMathStylesIntoExportSvg,
				pinMathContainerHeightsInExportSvg,
				hideCopyButtonsInExportSvg,
			],
			// 快捷键前置钩子：把 Ctrl+C / Ctrl+X / Ctrl+V 从引擎的「内部 JSON
			// 剪贴板」收回到插件的 Markdown 剪贴板（2026-10-13 裁决）。引擎对
			// 每个快捷键都会问一次，非剪贴板键由 view-clipboard 放行。
			beforeShortcutRun: (key) => handleClipboardShortcut(this, key),
			onRootDataChanged: () => {
				// 先提交到会话（发起视图是唯一提交口；接收视图的应用通道不发
				// `data_change`，故同一次编辑只进会话一次）。
				// **只有真的提交了才排保存**：首帧前的 `data_change` 是引擎自身
				// 规范化（`seedInitialHistory` 播种），不是用户编辑——照旧排程会让
				// 每次打开都空报「保存中…」两秒、再空跑一轮无差异写盘（2026-11-09
				// 实机：刚打开的文件状态栏就是「保存中…」）。
				if (this.commitSession()) {
					this.scheduleSave();
				}
				updateStatusBar(this);
				this.titleRenamer.schedule();
			},
			onDataChanged: () => {
				// 撤销/重做按钮的可用态跟着历史走（引擎在命令收尾 addHistory 后发
				// 本事件）：不刷就会一直是亮的，点了没反应（2026-11-03 实机）
				syncHistoryButtons(this);
				this.scheduleAutoSplitCheck();
				// 层级语法的同级一致性守卫（拖拽 / 粘贴 / 撤销重做后兜底；
				// 拖拽期间由 node_dragend 触发，见 view-syntax 文件头）
				scheduleSyntaxGuard(this);
				// 拖动联系线端点/控制点只改 data（引擎命令），这里把它写回正文——
				// 不写的话重开文件几何就回到自动计算（用户观感「改了不保存」）。
				schedulePersistRelationGeometry(this);
			},
			onNodeTextEdited: (node) => captureAutoSplitCandidate(this, node),
			onNodeImageClick: (node) => openNodeImageFullscreen(this, node),
			onNodeAttachmentClick: (node) => {
				const url = readNodeDataString(
					node.getData() as Record<string, unknown>,
					'attachmentUrl',
				);
				if (url) {
					this.openHyperlink(url);
				}
			},
			setupFeatures: () => {
				setupDragAndDrop(this);
				setupPasteHandler(this);
				setupContextMenu(this);
				registerWikilinkInteractions(this);
				// 任务复选框：画布 capture 接管点击（点一下即切换，见 view-node-task）
				setupNodeTaskInteraction(this);
				// 点选会话（联系 / 概要共用）：node_click 落点 + 空白/Esc 取消。
				// 必须排在两个特性之前：它们只负责「进入会话」，事件绑定点只有这里一处。
				setupNodePick(this);
				// 联系（关系连线）：双击线改标签（capture 拦引擎内联框）
				setupRelationInteractions(this);
				// 标签 pill：画布 capture 接管点击 → 官方标签搜索（私有触点）
				registerTagClicks(this.engineEvents, this.canvasEl, this.app, this.lang);
				// 脚注徽标：点击定位定义节点 + 悬停预览（同一 capture 范式）。
				// 索引读**本视图引擎的渲染树**（uid 只在引擎侧存在；会话树无 uid）
				setupFootnoteInteractions({
					events: this.engineEvents,
					canvasEl: this.canvasEl,
					lang: this.lang,
					getMindMap: () => this.mindMap,
					contentOptions: this.inlineContentOptions,
					// 浮层内的链接可点：与节点超链接同一分流（库内路径 / 外部 URL）
					openLink: (link) => this.openHyperlink(link),
				});
				// 节点内代码块的复制按钮（悬停显形 → 点击复制 → ✓ 反馈）
				registerCodeBlockInteractions(this);
				// 画布视口手势（Ctrl+滚轮缩放 / 滚轮平移 / 中键拖）：对齐官方 Canvas
				setupViewportGestures(this);
				// 双击画布空白 → 在根节点下新建（官方 Canvas「双击画布新建卡片」）
				setupCanvasQuickCreate(this);
				// 自绘（富）节点的双击编辑兜底（引擎编辑框对自绘节点静默 no-op）
				setupNodeTextEditFallback(this);
				setupImageResize(this);
				// 拖左右边框改宽结束 → 重建自绘内容（节点高度方能跟随新宽度）
				setupNodeWidthRefresh(this);
				// 左下角小地图（自动出现/淡出，无手动入口；见 view-minimap 文件头）
				setupMiniMap(this);
				// 层级语法守卫：拖拽开始/结束的时序感知（见 view-syntax 文件头）
				setupSyntaxGuard(this);
			},
			onEngineReady: () => this.onEngineReady(),
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
		this.loadSession.whenReady = new Promise<void>((resolve) => {
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
		// 打开时先采样一次可见性（④ 自愈的**起点**）：启动恢复的后台 leaf 在
		// onOpen 时即不可见、且从未 active 过（active-leaf-change 不因它触发），
		// 若不在内容构建前置脏，后续「从未记脏直接可见」会让 syncVisibility
		// 的自愈分支零成本早退、0×0 内容永不恢复（另两处采样见下方
		// active-leaf-change 与 onResize）
		this.contentRemeasure.syncVisibility();

		this.boundHandleCssChange = () => {
			// 代码块 token 的内联色来自主题（探测后写入，导出 SVG 无 styles.css
			// 也靠它，见 platform/prism-code）：换主题必须重探测+ 就地改写，否则
			// 高亮代码块留着旧调色板。**无条件执行**——明暗未变的主题切换同样改色。
			refreshPrismTokenColors(this.containerEl);
			const dark = this.app.isDarkMode();
			if (dark !== this.isDark) {
				this.isDark = dark;
				this.applyTheme();
			}
		};
		this.cssChangeRef = this.app.workspace.on(
			'css-change',
			this.boundHandleCssChange,
		);
		this.registerEvent(this.cssChangeRef);
		// 可见性采样（自绘内容尺寸自愈，见 content-remeasure ④）：叶子被切到
		// 后台 / 切回时各采样一次。与 onResize 的采样互补——个别情况下标签切换
		// 只发 active-leaf-change；自愈本身幂等，无脏时零成本
		// 引用须保存：onClose 不卸载 Component（见那里的对称回收说明），
		// 不显式 offref 会让每次 onOpen 在 workspace 上叠加一个监听
		this.activeLeafRef = this.app.workspace.on('active-leaf-change', () => {
			this.contentRemeasure.syncVisibility();
		});
		this.registerEvent(this.activeLeafRef);
		// 视图内快捷键（搜索 / 撤销重做 / F2 编辑节点）：内部会按官方要求
		// 确保 this.scope 已创建（View.scope 默认为 null，不创建则全部失效）
		registerViewHotkeys(this);

		// 窗口级粘贴兜底：只注册一次（随视图生命周期由 Component 自动清理，
		// 另在 onClose 按同一引用显式移除——见那里的对称回收说明），
		// 不放在 setupPasteHandler 中，避免每次刷新引擎累积监听。
		// 激活视图判定在此处做（需要 MindMapView 类引用），view-paste 保持无类依赖。
		// 挂在画布所属窗口（popout 窗口里主窗口收不到 paste）
		this.pasteHandler = (event: ClipboardEvent) => {
			if (this.app.workspace.getActiveViewOfType(MindMapView) !== this) {
				return;
			}
			handleWindowPaste(this, event);
		};
		this.registerDomEvent(this.containerEl.win, 'paste', this.pasteHandler);

		resolveReady();
		if (this.file) {
			await this.loadMindMapFromFile(this.file);
		}
	}

	/**
	 * 读入点（唯一）：官方 `setViewState` 把传入 state **原样**交给
	 * `view.setState`（实机源码：`c = e.state || {}` → `n.setState(c, s)`），
	 * 这是 `mdBackMode` 的权威来源，必须**先于** `super.setState` 落字段——
	 * super 内部经 `loadFile` → `onLoadFile` 完成文件装载，onLoadFile 不参与
	 * 模式读回（旧实现在那里从 leaf 读回，恒失败链路，原理见下方 getState
	 * 覆写，2026-10-15）。
	 *
	 * 取值与白名单收敛在 `readMdBackMode` 一处（state 形态未经校验）。
	 */
	override async setState(
		state: unknown,
		result: ViewStateResult,
	): Promise<void> {
		this.mdBackMode = readMdBackMode(state);
		await super.setState(state, result);
	}

	/**
	 * 写回点：官方 `leaf.getViewState()` 的 state 完全取自 `view.getState()`
	 * （实机源码：`{ type, state: e.getState() }`），而基类 `FileView.getState()`
	 * 只回 file——不覆写则 `mdBackMode` 读不回，布局保存（workspace.json）
	 * 也随之丢失模式，重启恢复后退化为编辑视图（2026-10-15 缺陷根因）。
	 * 保留 super 结果：官方字段（如 file）不重复手写、未来新增字段自动跟随。
	 */
	override getState(): Record<string, unknown> {
		return { ...super.getState(), mdBackMode: this.mdBackMode };
	}

	override async onLoadFile(file: TFile): Promise<void> {
		// 同一文件允许多个导图视图并存（2026-11-07）：与 Obsidian 多标签一致，
		// 各自拥有独立引擎与保存管线；关闭时各自保存、后关闭者胜（见 SavePipeline）。
		// 等待装配完成（onOpen 尚未执行时挂起，替代原 10ms 轮询）。
		// 10s 超时降级：正常装配毫秒级完成；超时表示 onOpen 未 resolveReady
		// （异常路径/极端情形），继续加载但 DOM 可能不完整。
		let timeoutId: number | null = null;
		const readyTimeout = new Promise<'timeout'>((resolve) => {
			timeoutId = window.setTimeout(() => resolve('timeout'), READY_TIMEOUT_MS);
		});
		const result = await Promise.race([
			this.loadSession.whenReady.then(() => 'ready' as const),
			readyTimeout,
		]);
		// 正常路径下定时器必须撤掉：否则每次打开文件都留下一个 10s 的空转
		// 定时器（视图关闭后仍在表里，插件卸载前不释放）
		if (timeoutId !== null) {
			window.clearTimeout(timeoutId);
		}
		if (result === 'timeout') {
			console.warn(
				'MindMapView: 等待视图装配超时，降级继续加载',
				file.path,
			);
		}
		// onOpen 已为同一文件启动加载（读取中或已完成）时跳过，
		// 避免同一文件被读取两次、引擎实例被创建两次。
		if (this.loadSession.loadingFilePath === file.path) {
			return;
		}
		await this.loadMindMapFromFile(file);
	}

	override async onUnloadFile(file: TFile): Promise<void> {
		const unloadingPath = this.loadSession.loadingFilePath;
		// 会话引用留到内联编辑提交之后再摘：`closeInlineEditor` 要经会话提交
		// 最后一次输入（先置 null 会把用户刚打的字丢掉）。
		const session = this.session;
		// 提交闸必须在 `closeInlineEditor` **之后**才关：关闭/切文件时编辑器里的
		// 最后一次输入要经 `commitSession` 进会话（2026-11-11 实机：先关闸会丢字）。
		// 本方法后续不会再产生用户编辑，晚置 false 不会引入重复提交。
		const generation = this.loadSession.generation;
		// **必须先于 `invalidateInit`**：它 `viewport.reset()` 会清掉
		// `defaultSignature` / `restoredSaved`，之后 persistViewport 的
		// 「视口仍是打开时自动设置的那个」判据恒不成立（2026-11-11 实机：
		// 判据被清空 ⇒ 纯浏览也会写入 data.json）。视口读取与作废顺序无关。
		this.engine.persistViewport();
		this.engine.invalidateInit();
		this.cancelPendingInit();
		// 未决的大图尾随 resize 属旧文件：留着会在新文件上多跑一轮整树重排
		this.cancelDeferredResize();
		this.titleRenamer.cancel();
		// 小地图会话持有本引擎引用 + 定时器 + 面板 DOM：与其它会话同期收尾。
		// **必须在 await 之前**——await 期间新文件可能已接管视图并重建了会话，
		// 那时再拆会误拆新的；而漏掉这一步时，旧面板会跨到下一个文件
		// （加载失败的路径更是无人收尾）。
		teardownMiniMap(this);
		// 内联编辑会话必须先提交（用户输入落节点数据 + scheduleSave），
		// 否则随后的写盘拿不到刚输入的内容（引擎随后销毁）
		closeInlineEditor(this);
		// 编辑器提交完成：现在才关提交闸、摘引用（await 期间新文件可能已接管本视图；
		// 解绑即 flush）——视口已在上面先行落定
		this.commitsArmed = false;
		this.session = null;
		// 每次解绑都 flush（对齐官方 `TextFileView.onUnloadFile`：关闭即保存，
		// 无差异由管线跳过）；最后一个视图解绑时会话销毁、键移除。
		// core 不 await onUnloadFile，故内容取会话权威树（不读引擎活快照——
		// await 期间引擎可能已交给新文件）。
		if (session) {
			await session.detach(this);
		}
		// 挂起的图片尺寸校正属于本文件：文件已卸载，丢弃（引擎随后销毁，
		// 回灌会落空，留着只会在新文件上误判）
		this.loadSession.pendingImageCorrections = null;
		// 同理：0 尺寸等待期间没来得及消费的「加载基线 / 大图提示」也属于本文件。
		// 留着会让下一个文件用旧路径的基线（基线核对不通过，只是白留）或旧节点数。
		this.loadSession.pendingBaseline = null;
		this.loadSession.pendingRenderHint = null;
		this.clearRenderHint();
		// 数学重测节点同属本引擎：随引擎销毁一并丢弃（否则跨文件累积持有旧节点）
		this.contentRemeasure.resetNodes();
		// 文件切换后允许再次加载同一路径（新会话）。仅清理「仍属于本次卸载」的
		// 标记：await 期间可能已开始加载新文件（onLoadFile），无条件置空会把
		// 新加载的代际标记抹掉，其 rAF 守卫随即判为过期 → 导图不渲染。
		if (this.loadSession.loadingFilePath === unloadingPath) {
			this.loadSession.loadingFilePath = null;
		}
		// await 期间新文件可能已接管并建好新引擎：只有代际未变时才销毁，
		// 否则会把 B 的引擎拆掉（2026-11-11 静态审查定位的生命周期竞态）。
		if (this.loadSession.generation === generation) {
			this.engine.destroyInstance();
		}
	}

	/** 取消尚未执行的引擎初始化帧（幂等） */
	private cancelPendingInit(): void {
		this.loadSession.cancelInitFrame(this.containerEl.win);
	}

	private async loadMindMapFromFile(file: TFile): Promise<void> {
		// 新一次加载 = 新代际：`onUnloadFile` 的 await 后据此判断是否还能销毁引擎
		this.loadSession.generation += 1;
		this.loadSession.loadingFilePath = file.path;
		// 换文件即复位：上一张图的「已保存 / 未保存」不属于本文件。
		// （`idle` 只收起状态段，节点数由随后的渲染结束事件刷新。）
		this.setSaveState('idle');
		// 三项「按文件偏好」一次合成：缺省值统一在 resolveFilePreferences 里给，
		// 避免某一维回落到硬编码默认而漏掉设置项（2026-10-21 themeStyle 踩过此坑）。
		// 布局不在其中——它只认文件属性（`data.json` 不再保存逐文件布局）。
		const prefs = resolveFilePreferences({
			saved: {
				lineStyle: this.plugin.viewState.getPreference(file.path, 'lineStyle'),
				themeStyle: this.plugin.viewState.getPreference(file.path, 'themeStyle'),
				palette: this.plugin.viewState.getPreference(file.path, 'palette'),
			},
			defaults: {
				lineStyle: this.plugin.settings.defaultLineStyle,
				themeStyle: this.plugin.settings.defaultThemeStyle,
				palette: DEFAULT_PALETTE,
			},
		});
		// 归一放在**入口**：脏值止步于此，后续 `resolve*` 只负责兜底，
		// 不再各写一次 normalize（那是「新增维度时漏一处」的高发位置）。
		//
		// 布局 = 文件声明 ?? 种子值。后者**只兜 MetadataCache 滞后**（刚创建文件、
		// 刚写完属性），不是「按文件记忆」的回落：已存在文件的布局永远来自属性。
		//
		// 请求时刻先读一次（`documents.load` 抛错时也保底）；**读完文档还会复问一次**
		// （见下面的 `declaredNow`）：`vault.read` 给了 MetadataCache 追赶的时间，
		// 「打开时缓存尚未就绪」的窗口因此从整段 load 缩到一次 read——否则勾选态与
		// 画面会先停在种子值上，等 `metadataCache.changed` 才跳到真布局。
		this.currentLayout =
			readDeclaredLayout(this.app, file) ?? this.plugin.settings.defaultLayout;
		this.currentLineStyle = normalizeLineStylePreference(prefs.lineStyle);
		this.currentThemeStyle = normalizeThemeStyle(prefs.themeStyle);
		this.currentPalette = normalizePalettePreference(prefs.palette);
		try {
			// 会话是**唯一读取口**：第一个视图读盘并建会话，后续视图直接加入
			// 同一会话（不读磁盘——磁盘可能落后于未保存改动，读了就会覆盖）。
			const session = await this.plugin.sessions.acquire(file);
			// 加载期间文件已切换：丢弃过期结果（会话仍留在注册表，供别的视图用）
			if (this.loadSession.loadingFilePath !== file.path) {
				return;
			}
			this.session = session;
			session.attach(this);
			// 复问声明：此刻引擎尚未创建（initMindMap 在下一帧的 rAF 里），
			// 更新会话值即可让「竖栏 / 右键勾选态」与「引擎创建用的布局」同时对齐
			// 磁盘真值，不必等一次 `metadataCache.changed` 再重排。
			const declaredNow = readDeclaredLayout(this.app, file);
			if (declaredNow !== null) {
				this.currentLayout = declaredNow;
			}
			// mdBackMode 的读入已前移到 setState 覆写：官方 view.getState() 不保留
			// 传入 state，从此处经 leaf.getViewState() 读回是恒失败链路（2026-10-15）。
			//
			// 深拷贝会话树再装饰：配色 / 联系 / 概要 / 图片尺寸都写 data，不能让
			// 这些**显示派生**字段回灌进会话权威树（写盘只读 md 字段，但会话树
			// 要跨视图逐字可比）。引擎 `handleData` 会再克隆一次。
			const tree = session.cloneTree();
			if (!tree) {
				throw new Error('会话树尚未就绪');
			}
			// 空导图的标题起始级别取设置（有内容的文件一律以正文实测为准）。
			// **必须在引擎创建前**写进 data 树：引擎会克隆数据，且建好后再改
			// 这棵树不再生效（与配色 / 联系 / 概要同一时机）。空树在引擎侧不会
			// 补默认节点（实测 kids=0），故「正文没有节点」是可靠判据。
			seedHeadingStart(
				tree,
				headingStartOfSyntax(this.plugin.settings.newMapSyntax),
			);
			// 图片尺寸（2026-09-28 用户裁决 K97）：**未设置尺寸的图片一律按默认
			// 大小展示**（IMAGE_WIDTH×IMAGE_HEIGHT，框内等比留白不变形），只有
			// 官方尺寸参数 `![[图|300]]` 的节点才按参数定尺寸——取消此前的
			// 「按原始比例自适应」（会让不同图片在导图中大小各异）。因此绝大多数
			// 图片节点**完全不探测**，加载期无解码开销。
			//
			// 带参节点的探测仍不挡在首帧前（2026-09-16 优化）：起步探测（不与首帧
			// 串行）→ 首帧先按默认尺寸出画 → 探测完成后按「对象身份 + uid」双通道
			// 回灌并重渲染一次（只影响尺寸确实变了的图片节点，见 K96）。
			// 不变式：参数节点 custom:true 精确渲染；`mdImageAutoSize` 标记不回写
			// 文件（存量兼容，K97 后不再产出新标记）。
			//
			// 先同步填**默认尺寸**（引擎硬要求：`getImgShowSize` 对缺失的 imageSize
			// 直接解构抛错、整图渲染中断——旧流程靠「探测先于引擎」隐式兜底，
			// 见 ensureDefaultImageSizes 注释）：O(n) 指针遍历，不探测不等加载。
			ensureDefaultImageSizes(tree);
			// 节点配色指令（`%%#hex%%`）：必须在 `initMindMap` **之前**写进 data 树
			// （引擎 `MindMapNode.handleData` 会克隆数据，建好后再改这棵树不再生效）。
			// 创建后编辑/撤销引起的变化走 `node_tree_render_end` 的实时同步。
			applyColorDirectivesToTree(tree, colorDirectiveOf, this.colorLine());
			// 联系（关系连线）：同样必须在创建引擎**之前**写进 data 树——引擎会克隆
			// 数据，建好后再改这棵树不再生效（首帧即带线，不额外渲染一次）。
			applyRelationsToTree(tree);
			// 概要（Summary）：同一时机（父节点的 `generalization` 数组），首帧即带
			// 概要框——否则打开文件后要等一次额外渲染才出现。
			applySummariesToTree(tree);
			void collectImageSizeCorrections(tree)
				.then((corrections) => {
					// 加载期间文件已切换：丢弃过期结果
					if (this.loadSession.loadingFilePath !== file.path) {
						return;
					}
					this.loadSession.pendingImageCorrections = corrections;
					if (this.applyPendingImageCorrections()) {
						this.engine.scheduleViewportRecenter();
					}
				})
				// 探测失败不致命：K97 语义下「未设尺寸＝按默认大小展示」本身即是
				// 安全终态，探测只负责把「带官方尺寸参数」的节点校正到实际尺寸。
				// 静默降级为默认尺寸即可，不打断加载、不打扰用户（错误仍留 console）。
				//
				// ⚠ 覆盖状态（2026-10-04 审查登记）：本降级分支**无直接单测**——
				// `MindMapView` 本体（1100+ 行）依赖 DocumentService / EngineController /
				// rAF / 十余个实例字段，仓库无 `tests/view.test.ts` 脚手架，为此新建的
				// 成本远超收益。同一降级语义在 `node-inline-editor.applyRawNodeContent`
				// 有等价用例锁定（含「移除 catch ⇒ 精确 1 例报红 + 产生未处理拒绝」的
				// 负向自检），两处可互为参照。若将来补 `view.test.ts`，此处优先补。
				.catch((error: unknown) => {
					console.warn('图片尺寸探测失败，保持默认尺寸', error);
				});
			// 上一帧若尚未执行（快速切换文件），先取消，避免旧树被渲染
			this.cancelPendingInit();
			// 引擎即将重建：先提交内联编辑（节点对象随重建失效，输入不能丢）
			closeInlineEditor(this);
			this.loadSession.pendingInitRaf = this.containerEl.win.requestAnimationFrame(
				() => {
					this.loadSession.pendingInitRaf = null;
					if (this.loadSession.loadingFilePath !== file.path) {
						return;
					}
					// 首帧渲染结束前不接受编辑提交（挡 `seedInitialHistory` 的
					// `data_change`，见 commitsArmed 字段说明）
					this.commitsArmed = false;
					this.engine.initMindMap(tree);
					// 「加载时序列化基线」与「大图首帧提示」都需要**引擎已存在**这一刻：
					// 前者取树快照、后者要绑首帧事件。而 `initMindMap` 在容器 0 尺寸
					// （后台标签/折叠面板）时**只挂 ResizeObserver 等尺寸**，此刻
					// `getDataSnapshot()` 为 null——直接调 markLoaded 会被它的空守卫
					// 静默吞掉，该文件此后每轮自动保存都不再算「纯浏览」（打开即重排
					// 全文）；提示则会因绑不上 `node_tree_render_end` 而挂到 15 s 兜底。
					// 故两者一律留到 `onEngineReady`（引擎真正建好的那一刻）消费。
					// 原样正文由会话持有（`markLoaded` 的 rawBody 参数），这里只留
					// 「哪个文件还没记基线」——多视图共享会话，只能记一次。
					this.loadSession.pendingBaseline = { path: file.path };
					const hintCount = countTreeNodes(tree);
					this.loadSession.pendingRenderHint =
						hintCount >= LARGE_MAP_RENDER_HINT_NODES ? hintCount : null;
					// 常规路径（尺寸就绪、引擎同步建好）：本文即完成，时序与原先等价——
					// 引擎 render 仍在 setTimeout(0) 里，提示在长任务前上屏。
					this.recordLoadedBaseline(file);
					this.showLargeMapRenderHint();
				},
			);
		} catch (error) {
			// 文件可能已被删除/损坏：保持视图可用并提示，避免半加载状态
			this.loadSession.loadingFilePath = null;
			console.error('加载思维导图失败:', file.path, error);
			new Notice(`${t(this.lang, 'common.notLoaded')}`);
		}
	}

	/**
	 * 记录「加载时序列化」基线（纯浏览不写盘，见 `SavePipeline.markLoaded`）：
	 * 引擎建好后取同一份快照交给会话——此后任何一轮保存若序列化结果与它逐字
	 * 相同，就说明本次会话没有内容级改动，写盘一律跳过。
	 *
	 * 引擎尚未创建（0 尺寸等待）时**不动** `pendingBaseline`，留给 `onEngineReady`
	 * 补记——此时 `getDataSnapshot()` 为 null。
	 *
	 * **只在加载路径调**：设置刷新引起的引擎重建不写 `pendingBaseline`，且会话
	 * 侧只认第一次（`baselineRecorded`）——不会把尚未落盘的编辑误标成基线。
	 * 多视图共享会话时同样只记一次（用哪个视图的引擎快照都一样：同一棵会话树）。
	 */
	private recordLoadedBaseline(file: TFile): void {
		const pending = this.loadSession.pendingBaseline;
		if (pending?.path !== file.path) {
			return;
		}
		const snapshot = this.engine.getDataSnapshot();
		if (!snapshot) {
			return;
		}
		this.session?.markLoadedFromEngine(snapshot);
		this.loadSession.pendingBaseline = null;
	}

	/**
	 * 大图首帧渲染提示：节点数 ≥ `LARGE_MAP_RENDER_HINT_NODES` 才建（小图首帧
	 * 50–100 ms，提示只会闪一下）。
	 *
	 * **为什么此刻建就能看见**：引擎的 `render()` 只是 `setTimeout(0)`（vendor
	 * `Render.render`），本回调返回后浏览器先绘制这一帧、再跑那个长任务 ⇒ 提示
	 * 恰好在冻结之前上屏。反过来，若在长任务**之后**才建（如首帧事件里），就成
	 * 了一句自己都看不到的提示。
	 *
	 * 节点数取自 `pendingRenderHint`（加载路径用解析出的树算好，零拷贝）：引擎
	 * 未建时连 `mindMap` 都没有，`getData()` 更无从谈起。
	 *
	 * **两条调用路径接力消费同一份 pending**：加载回调（rAF 内）先试一次，容器
	 * 0 尺寸时引擎未建、原样保留；`onEngineReady` 再试。谁先看到引擎谁用掉它。
	 *
	 * 摘除走首帧渲染结束（一次性）+ 兜底定时器（防渲染异常时永久盖住画布）。
	 */
	private showLargeMapRenderHint(): void {
		this.clearRenderHint();
		const count = this.loadSession.pendingRenderHint;
		if (count === null || count < LARGE_MAP_RENDER_HINT_NODES) {
			return;
		}
		const mindMap = this.mindMap;
		if (!mindMap) {
			// 引擎尚未建：容器 0 尺寸（后台标签 / 折叠面板）时 `initMindMap` 只挂
			// ResizeObserver 等尺寸（见加载回调的说明），本方法在加载路径上必然
			// 撞到这一刻。这里**保留** pending 交给 `onEngineReady`（引擎真正建好
			// 那一刻会再调本方法消费它）；此刻绝不建提示——绑不上
			// `node_tree_render_end`，只剩 15 s 兜底定时器摘除，等于一块盖住
			// 画布的不透明遮罩。
			return;
		}
		// 一次性：建成就清，免得引擎刷新时重复消费同一份节点数
		this.loadSession.pendingRenderHint = null;
		const el = this.containerEl.createDiv({ cls: 'mindmap-render-hint' });
		el.setText(tf(this.lang, 'view.renderingLargeMap', { count }));
		this.renderHintEl = el;
		this.renderHintTimer = this.containerEl.win.setTimeout(() => {
			this.clearRenderHint();
		}, RENDER_HINT_TIMEOUT_MS);
		this.engineEvents.onEngine(mindMap, 'node_tree_render_end', () => {
			this.clearRenderHint();
		});
	}

	/** 摘除首帧渲染提示（幂等；首帧结束 / 引擎换代 / 视图关闭 / 兜底超时共用） */
	private clearRenderHint(): void {
		if (this.renderHintTimer !== null) {
			this.containerEl.win.clearTimeout(this.renderHintTimer);
			this.renderHintTimer = null;
		}
		this.renderHintEl?.remove();
		this.renderHintEl = null;
	}

	// ---- 「按文件偏好」的读取兜底 ----
	// 会话字段在 `loadMindMapFromFile` 里已按文件合成并归一；这里只兜「引擎在
	// load 之前就被创建」的极端时序（返回默认值，不回写会话字段——回写会让
	// 「尚未读到文件」与「文件就是这么设的」两种状态混为一谈）。
	//
	// 三项同构（会话字段 ?? 默认值），与写入侧 `commitPreference` 以
	// `PreferenceKey` 为中心对称：新增一项偏好时两处各加一行即可。

	resolvePreference(key: PreferenceKey): string {
		switch (key) {
			case 'lineStyle':
				return this.currentLineStyle ?? this.plugin.settings.defaultLineStyle;
			case 'palette':
				return this.currentPalette ?? DEFAULT_PALETTE;
			case 'themeStyle':
				return this.currentThemeStyle ?? this.plugin.settings.defaultThemeStyle;
		}
	}

	/**
	 * 当前生效的布局（引擎 layout id）。
	 *
	 * 不并入 `resolvePreference`：布局已不是「按文件偏好」——它只存在于文件属性，
	 * 既不由 `commitPreference` 提交，也不落 `data.json`。独立方法让「读声明后的
	 * 会话值」这条唯一来源在接口上可见（引擎创建选项仍要 `layout: string`）。
	 */
	resolveLayout(): string {
		return this.currentLayout ?? this.plugin.settings.defaultLayout;
	}

	/**
	 * 回灌挂起的图片尺寸校正（首帧后）。
	 *
	 * 三条调用路径合起来覆盖全部时序（谁最后就绪谁生效）：
	 * ① 探测完成时（`collectImageSizeCorrections().then`）；
	 * ② 引擎创建完成时（`onEngineReady`）；
	 * ③ 首帧渲染完成时（`onEngineReady` 注册的 `node_tree_render_end` 监听）。
	 *
	 * **root 未就绪（首帧渲染异步，中间态 `renderer.root` 为 null）时不消费**：
	 * 保留 pending 交给后续触发点重试。2026-09-28 修复——此前「先清空再回灌」
	 * 在 root 未就绪时把校正**永久丢失**（`applyImageSizeCorrectionsToEngine`
	 * 对 null root 静默返回 0），表现为所有图片节点停在默认 200×120 固定外框、
	 * 宽度不随图片比例变化。
	 * 引擎重建（设置刷新/换文件）后 data 对象不再同一 ⇒ 身份匹配落空，不会盖错节点。
	 *
	 * @returns 是否实际回灌。真实尺寸替换默认尺寸会改动节点包围盒，
	 *   调用方据此排补居中——否则首帧居中会停在旧包围盒上（打开即偏移）。
	 */
	private applyPendingImageCorrections(): boolean {
		const corrections = this.loadSession.pendingImageCorrections;
		const mindMap = this.mindMap;
		if (
			!corrections ||
			corrections.length === 0 ||
			!mindMap ||
			!getRenderRoot(mindMap)
		) {
			return false;
		}
		this.loadSession.pendingImageCorrections = null;
		applyImageSizeCorrectionsToEngine(mindMap, corrections);
		return true;
	}

	/** 引擎就绪收尾：重建工具栏（连线开关态跟随文件布局）；md 模式补返回按钮 */
	private onEngineReady(): void {
		// 加载基线与大图首帧提示：容器 0 尺寸（后台标签）时加载那一刻引擎还没建，
		// 两者都挂在 `LoadSession` 的 pending 字段上等这一刻（见各自字段说明）。
		// 此刻引擎的 `render()` 已排进 setTimeout(0)、尚未执行 ⇒ 提示仍赶得上首帧；
		// 引擎同步建好的常规路径则早在加载回调里就消费掉了，这里是无操作。
		const loadedFile = this.file;
		if (loadedFile) {
			this.recordLoadedBaseline(loadedFile);
		}
		// 引擎就绪即向会话报到：加载期间别的视图可能已提交新内容（本视图拿到的
		// 是当时的会话树），这里补一次「落后就应用」。
		this.session?.onViewReady(this);
		this.showLargeMapRenderHint();
		// 数学重测集合换新：引擎（重）建后节点对象全部是新实例，旧引用已随上一
		// 个引擎销毁而失效——不清则 ① 旧节点被长期持有（换文件/设置刷新累积成
		// 内存泄漏）；② 字体钩子会对**已销毁**的节点调重测（2026-09-28 复核修复）。
		// 只清集合、不触发任何重排（K88 禁止全树重排的约束不变）。
		this.contentRemeasure.resetNodes();
		// 图片尺寸校正回灌（探测在首帧前起步；引擎此刻才存在时在此落地）。
		// 回灌改动节点尺寸 → 内容包围盒变化，排补居中修正默认视口
		if (this.applyPendingImageCorrections()) {
			this.engine.scheduleViewportRecenter();
		}
		// 首帧渲染通常晚于引擎创建（Render 异步：root 在渲染回调前为 null）
		// → 上面那次会保留 pending，这里挂首次渲染完成事件补灌（2026-09-28 修复）。
		// 回调幂等（pending 为空时立即返回），绑定走 engineEvents 随引擎销毁清理。
		const mindMap = this.mindMap;
		if (mindMap) {
			this.engineEvents.onEngine(mindMap, 'node_tree_render_end', () => {
				// 首帧已落地：此后引擎发的 `data_change` 才是真实编辑提交
				// （`seedInitialHistory` 的那一次发生在同一事件里、本回调之前，
				// 因此仍被挡在提交口外）
				this.commitsArmed = true;
				// 状态栏节点计数：加载那一刻引擎还没建（或 renderer.root 仍为 null）
				// ⇒ `updateStatusBar` 算得 0，而此前没有后续刷新点，打开大图后状态栏
				// 一直停在「0 个节点」，直到切走再切回（active-leaf-change）才恢复
				//（2026-11-03 实机）。**不能按「第一次渲染」去重**：引擎初始化会先发
				// 一轮该事件（那时 root 尚未回填，计数仍是 0），去重就把修复吃掉了
				//（实测：加了首次标志仍显示 0）。这里每次都刷，成本由
				// `updateStatusBar` 自带的 300ms 节流兜住。
				updateStatusBar(this);
				// 节点配色指令（`%%#hex%%`）：编辑 / 插入 / 撤销后重算，有变化再渲染一次。
				// **必须挂渲染落地**（不是 `data_change`）：插件内联编辑走
				// `applyRawNodeContent` 直接改 data 后 render，根本不发 `data_change`
				// （K108）；撤销时 `data_change` 又在渲染排队前发出，那时 renderer.root
				// 还是旧树。此刻根节点已是新树、数据已定稿，同步一次即覆盖全部通道。
				syncNodeColorDirectives(mindMap, colorDirectiveOf, this.colorLine());
				// 联系（关系连线）：同一时机重算——编辑 / 插入 / 撤销都会改变指令。
				// 有变化时它会自行补画一次线（插件的 renderAllLines 绑在本事件上但
				// 早于我们执行，不补画就要等下一轮渲染）。几何只认文件里的 `geo=`，
				// 文件没写时保留 data 现有几何（用户刚拖完的那一轮）。
				syncLiveRelations(mindMap);
				// 概要（Summary）：同一时机重算父节点的 `generalization` 数组。
				// 与联系不同，概要框是**布局产物**（括号位置取决于被覆盖兄弟的
				// 包围盒），只改 data 不会让已画好的括号跟着动 ⇒ 有变化就补一轮
				// 渲染；第二轮同步发现无变化即停，不会自激。
				if (syncLiveSummaries(mindMap)) {
					this.scheduleSummaryRender(mindMap);
				}
				if (this.applyPendingImageCorrections()) {
					this.engine.scheduleViewportRecenter();
				}
				// 渲染完成后重试「渲染窗口内未解析的数学 holder」（K104）：
				// 此刻 renderer.root 已回填，holder 与产物两条解析路径恢复可用
				this.contentRemeasure.retryDeferred();
			});
		}
		// 外观项（布局 / 连线 / 配色 / 边框）的选择入口在右键菜单的二级菜单：
		// 勾选态在读菜单时按 `resolve*` 现算，引擎就绪时不再需要回填控件。
		// 但**可用性**不能读时现算：右缘竖栏的连线开关是否置灰由布局决定，它写在
		// 竖栏的构建流程里，而 `onOpen` 建栏早于文件加载（那时 `resolveLayout()`
		// 读到的还是种子布局）。此刻 `currentLayout` 已按文件声明定值，重建一次
		// 让开关态跟上——否则种子值为固定直线布局时，打开任何导图都会永久置灰
		//（2026-10-23 修复）。
		this.refreshToolbar();
	}

	/**
	 * 排一次**概要框**的补渲染（同一轮只排一次）。
	 *
	 * 为什么不能像联系那样「改完 data 立刻补画」：联系线只改一条 SVG 路径，概要框
	 * 要按被覆盖兄弟的新包围盒重新排版（引擎在整树渲染里现算括号），因此只能整树
	 * 再渲染一轮。延后一拍（`setTimeout(0)`）而不是在 `node_tree_render_end` 回调
	 * 里递归调 `render()`：那一拍引擎仍在自己的渲染栈里，递归会打乱它的帧状态。
	 *
	 * 兜底：文件切换 / 设置刷新后引擎已换实例（甚至视图已关闭）——回调里比一次
	 * 实例，不符就丢弃这次补渲染。
	 */
	private scheduleSummaryRender(mindMap: MindMap): void {
		if (this.summaryRenderQueued) {
			return;
		}
		this.summaryRenderQueued = true;
		this.containerEl.win.setTimeout(() => {
			this.summaryRenderQueued = false;
			if (this.mindMap !== mindMap) {
				return;
			}
			mindMap.render();
		}, 0);
	}

	/** 标题重命名已委托 TitleRenamer（view-title-renamer.ts） */

	/**
	 * 提交一项「按文件偏好」：归一 → 会话字段 → 应用引擎 → 持久化 → 通知小地图。
	 *
	 * 三个维度（连线 / 配色 / 边框）是同构的，差异只有三处：归一函数、
	 * 引擎通道（连线有专法，配色与边框共用 `applyTheme`）、会话字段名。
	 * 收在一处后，新增维度不会漏掉这几步。
	 *
	 * **布局不在这里**：它的持久化位是文件属性而不是 `data.json`，写盘还会失败，
	 * 故走 `applyLayout` 的独立实现（顺序与失败语义都不同）；引擎重排落地后
	 * 才补小地图这件事也归那里（`refreshMiniMapAfterRender`），本漏斗的
	 * 三项都是同步换肤、几何不动，立即重画即可。
	 */
	private commitPreference(config: {
		key: PreferenceKey;
		value: string;
		normalize: (value: string) => string;
		applyToEngine: (value: string) => void;
	}): void {
		const next = config.normalize(config.value);
		this[SESSION_FIELDS[config.key]] = next;
		config.applyToEngine(next);
		if (this.file) {
			this.plugin.viewState.setPreference(this.file.path, config.key, next);
		}
		refreshMiniMap(this);
	}

	/**
	 * 切换布局（右键菜单调用）：**写文件属性**，成功之后才动画面。
	 *
	 * 顺序是必需的（不是风格）：
	 * ① 先排空正文——`processFrontMatter` 会重写整个文件，而保存管线可能还压着
	 *    未落盘的节点编辑，不排空就会把旧正文写回去（分屏 Markdown 视图下最明显）；
	 * ② 写属性只改 `Mindmap` 键，正文与其它属性原样保留（官方 `processFrontMatter`）；
	 * ③ 只有写成功才落地画面——失败时文件仍是旧布局，乐观应用会让「看的」与
	 *    「存的」不一致，重开即弹回。
	 * ④ 写属性期间置 `pendingLayoutWrite`，让 `syncDeclaredLayout` 让位：写盘触发的
	 *    `changed` 若先于本方法的 `await` 恢复到达，跟随侧会以**旧** `currentLayout`
	 *    比对而先应用一次，收尾再应用一次（双重重排）。置标记后无论谁先到都只应用一次。
	 *
	 * **已知边界**：属性经 `processFrontMatter` 写，`frontmatterByPath`（保存管线
	 * 「读不到磁盘」时才用的兜底文件头）仍是切换前的快照。刻意不在这里刷新——拼 YAML
	 * 不归本层，而正常写盘一律以磁盘现值为准。
	 *
	 * @param engineLayoutId 引擎 layout id（`LAYOUT_OPTIONS` 的 value）
	 */
	async applyLayout(engineLayoutId: string): Promise<void> {
		// 入口归一（与 `applyLineStyle` 同精神）：值域唯一源是 `LAYOUT_OPTIONS`，而本
		// 方法对接口上任意字符串开放（引擎 id 或属性都接受）。非法值既不能写进文件
		// （会落成默认值、冒充一次用户选择），也不能交给引擎（未知布局）——直接忽略
		// 并留痕。
		const layoutId = normalizeLayoutId(engineLayoutId);
		if (layoutId === null) {
			console.warn('未知的布局 id，已忽略:', engineLayoutId);
			return;
		}
		// 防重复写盘：勾选态点当前值不该产生一次 YAML 重序列化
		if (layoutId === this.currentLayout) {
			return;
		}
		const file = this.file;
		if (file) {
			// 在途标记（见字段注释）：写属性触发的 `changed` 据此让位给本方法
			this.pendingLayoutWrite = layoutId;
			try {
				// 先落正文：属性写入会重写整个文件，未排空的编辑会被旧正文覆盖
				await this.session?.flush();
				await this.app.fileManager.processFrontMatter(
					file,
					(frontmatter: Record<string, unknown>) => {
						setMindMapLayout(frontmatter, layoutId);
					},
				);
			} catch (error) {
				// 用户可感：画面不动、文件不改，重开仍是旧布局——必须提示
				notifyError(this.lang, 'view.layoutWriteFailed', error);
				return;
			} finally {
				// 成功路径到下方应用之间没有 await，不存在新的窗口；失败路径文件未改、
				// `currentLayout` 未动，清掉标记即可让后续 `changed` 走正常早退。
				// **只清自己那一项**：两次切换交叠时（连点两个布局）前者收尾若无条件
				// 清空，后者仍在写盘，期间的 `changed` 会插进来先应用一次、后者再应用
				// 一次（又一次双重重排）。
				if (this.pendingLayoutWrite === layoutId) {
					this.pendingLayoutWrite = null;
				}
			}
		}
		this.applyLayoutToEngine(layoutId);
	}

	/**
	 * 把布局应用到引擎侧并与会话值同步（**顺序即契约**）：
	 * 会话字段 → 引擎重排 → 竖栏重建（连线开关的可用性按布局定）→ 小地图等渲染落地。
	 *
	 * 两个入口共用：`applyLayout`（写属性成功后）与 `syncDeclaredLayout`（跟随外部
	 * 变更）。各写一份时，将来新增第四步就只能改一处、漏一处。
	 */
	private applyLayoutToEngine(layoutId: string): void {
		this.currentLayout = layoutId;
		this.engine.setLayout(layoutId);
		// 连线开关只有「可点 / 置灰」两态，判定（`supportsLineStyleSwitch`）写在
		// 竖栏的构建流程里，故换布局后必须重建一次——否则开关态会停在上一个布局
		//（2026-10-23 修复）。
		this.refreshToolbar();
		// 引擎重排是异步分片：小地图必须等渲染落地再取样
		refreshMiniMapAfterRender(this);
	}

	/**
	 * 跟随 `Mindmap Layout` 的**外部**变更：重读本文件布局，值变了就只应用引擎侧，
	 * **不回写文件**（属性是用户/其它窗格/同步写的，我们只是跟随）。
	 *
	 * 由组合根在 `metadataCache.changed` 时调用（见 main.ts）。三条早退：
	 * - 无文件 ⇒ 什么都不做。**刻意不抽走已打开的视图**：`Mindmap` 开关被外部改成
	 *   非启用值时也不把正在编辑的图踢回 Markdown（「是不是导图」只决定打开时怎么进）。
	 * - 布局键缺失/非法 ⇒ 什么都不做（**不**回落设置项「默认布局」：那个值只做新建
	 *   种子，见下方实现注释）。
	 * - 本视图正在写这一项的布局（`pendingLayoutWrite`）⇒ 让位，由 `applyLayout`
	 *   收尾统一应用。它的 `await` 与 `changed` 谁先到由宿主实现决定，不挡就会对
	 *   同一布局应用两次（双重重排 + 竖栏连建两次）。
	 * - 声明值 == 会话值 ⇒ 直接返回。**必须幂等**：我们自己的 `applyLayout` 写属性
	 *   同样会触发 `changed`，不早退就是二次重排（小地图也连画两轮）。
	 */
	syncDeclaredLayout(): void {
		const file = this.file;
		if (!file) {
			return;
		}
		// 布局键缺失/非法 ⇒ 早退，**不回落设置项**：`defaultLayout` 只是新建文件的
		// 种子值，对已打开的图不生效（见文件头 `LIVE_REFRESH` 说明）。这里回落会
		// 变成「隐式实时生效」——无布局键的文件（手写 `Mindmap: Mindmap`）在用户
		// 改了默认布局之后，随便一次 metadata 变化（含自己的自动保存）就把画面换掉。
		// 打开时的兜底仍由 `loadMindMapFromFile` 负责。
		const declared = readDeclaredLayout(this.app, file);
		if (declared === null) {
			return;
		}
		if (declared === this.pendingLayoutWrite) {
			return;
		}
		if (declared === this.currentLayout) {
			return;
		}
		this.applyLayoutToEngine(declared);
	}

	/**
	 * 切换连线样式偏好（右栏「连线」开关调用；两态：折线 / 曲线，不写入正文）。
	 *
	 * **写入前归一**（不只信调用方）：本方法在 `MindMapViewContext` 上对任意字符串
	 * 开放；若未来新入口传旧词汇（`auto` / `direct`），把旧值写回 `data.json` 会与
	 * 「读取侧归一」分叉，让脏值在文件里复利。归一口径唯一源
	 * `constants.normalizeLineStylePreference`，由 `commitPreference` 统一执行。
	 */
	applyLineStyle(value: string): void {
		this.commitPreference({
			key: 'lineStyle',
			value,
			normalize: normalizeLineStylePreference,
			applyToEngine: (next) => this.engine.setLineStyle(next),
		});
	}

	/**
	 * 切换配色（右键菜单调用）：走 `engine.applyTheme()` 原地换肤（不重建引擎），
	 * 按文件记在 `data.json` 的 `viewState[<路径>].palette`。
	 */
	applyPalette(value: string): void {
		this.commitPreference({
			key: 'palette',
			value,
			normalize: normalizePalettePreference,
			applyToEngine: () => this.engine.applyTheme(),
		});
	}

	/** 切换边框样式（右缘竖栏「边框」开关调用）：与 `applyPalette` 同构，按文件记在 `themeStyle`。 */
	applyThemeStyle(value: string): void {
		this.commitPreference({
			key: 'themeStyle',
			value,
			normalize: normalizeThemeStyle,
			applyToEngine: () => this.engine.applyTheme(),
		});
	}

	/**
	 * 应用层级语法（右键「层级语法」级联调用）：整篇重排正文。
	 *
	 * 与上面三项偏好**不同性质**：它改写正文（列表 ⇄ 标题），因此不进
	 * `commitPreference`、不落 `data.json`——落的是文件本身（见 view-syntax）。
	 */
	applyDocumentSyntax(syntax: DocumentSyntax): void {
		applyDocumentSyntaxFeature(this, syntax);
	}

	/** 本文件当前的层级语法（右键级联勾选态） */
	resolveDocumentSyntax(): DocumentSyntax {
		return resolveDocumentSyntaxFeature(this);
	}

	/**
	 * 应用设置变更（LIVE_REFRESH 键的**变更子集**，由 `diffLiveRefreshKeys` 产出）：
	 * 能原地生效的绝不重建引擎。
	 *
	 * 重建一轮 = 整树 `structuredClone` + 销毁重建引擎 + 全量重渲染（每次全量渲染
	 * 的 DOM 写入量见 K58 实测），故只有「引擎创建期通道」的键才值得付这个代价。
	 */
	applySettingsChange(changedKeys: ReadonlySet<string>): void {
		const requiresRebuild = [...changedKeys].some(
			(key) => !IN_PLACE_REFRESH_KEYS.has(key),
		);
		if (requiresRebuild) {
			// 重建引擎会重新播种历史（发一次 data_change）：挡在提交口外
			this.commitsArmed = false;
			this.engine.refresh();
			return;
		}
		if (changedKeys.has('defaultTheme')) {
			// 主题（明暗）变更 → 引擎原地换 themeConfig
			// （边框与配色不是设置项：按文件记，走右栏开关 / 右键菜单的
			// applyThemeStyle、applyPalette；defaultThemeStyle 只影响新建导图，
			// 这里没有分支，保留在集合里只为避免无谓重建）
			this.applyTheme();
		}
		if (changedKeys.has('nodeColorScope')) {
			// 只增删 `lineColor` 覆盖：颜色内容（填充 / 描边 / 文字）不变，重算一次
			// 即有变化 → 内部自行 render 一轮；引擎与视口都保留。
			syncNodeColorDirectives(
				this.mindMap,
				colorDirectiveOf,
				this.colorLine(),
			);
		}
	}

	/**
	 * 节点配色是否给**连接线**着色（作用范围设置项的渲染侧唯一读数）。
	 *
	 * 「仅本节点」档不染连接线：连线是「颜色往哪一支延伸」的线索，范围止于本节点
	 * 时，进 / 出两条线都应回落整篇配色。创建前写 data 树与渲染落地重算共用它。
	 */
	private colorLine(): boolean {
		return !isNodeOnlyColorScope(this.plugin.settings.nodeColorScope);
	}

	private applyTheme(): void {
		this.engine.applyTheme();
	}

	/** 安排一次 2 秒防抖自动保存（view-toolbar.ts / view-node-actions.ts 等外部模块调用） */
	scheduleSave(): void {
		// 保存归会话（同文件多视图一条管线）：视图只请求排程，不持有管线。
		this.session?.scheduleSave();
	}

	/**
	 * 把本视图的引擎快照提交给会话（**唯一的编辑提交口**）。
	 *
	 * 只在发起编辑的视图上被调用（引擎 `data_change` 只由它的 `addHistory`
	 * 发出）；接收视图的应用通道不发该事件 ⇒ 同一次编辑只提交一次。
	 * 会话未加载 / 基线未记录（引擎首帧前）时静默丢弃——那两种时刻不可能有
	 * 用户编辑。
	 */
	private commitSession(replaceCurrent = false): boolean {
		if (!this.commitsArmed) {
			return false;
		}
		const snapshot = this.engine.getDataSnapshot();
		if (!snapshot) {
			return false;
		}
		// 传本视图作 origin：广播时跳过它（它已经是新内容）
		if (replaceCurrent) {
			// 派生归一（层级语法守卫）：算这次编辑的一部分，不新增历史（K188）
			return this.session?.updateCurrent(snapshot, this) ?? false;
		}
		return this.session?.commit(snapshot, this) ?? false;
	}

	/**
	 * 派生归一后把权威树同步进会话（`view-syntax` 守卫调用）。
	 *
	 * 守卫就地改 md 字段、不发 `data_change`，故保存排程里没有它的改动；
	 * 不同步会让「屏上已升级 / 文件没写」（K188）。
	 */
	commitDerivedTree(): void {
		this.commitSession(true);
	}

	/**
	 * 撤销一步（会话时间线；所有视图同步回退）。
	 *
	 * **方法名必须是接口上的 `undo` / `redo`**：`view-hotkeys` / 竖栏 /
	 * 右键菜单都按 `MindMapViewContext.undo?` 判定，名字对不上时它们是
	 * `undefined`，会静默退回引擎历史（每视图一条、与会话时间线分叉）。
	 * 2026-11-09 实机：会话撤销从未被调用过（`typeof view.undo === 'undefined'`）。
	 */
	undo(): void {
		if (this.session?.undo()) {
			syncHistoryButtons(this);
		}
	}

	/** 重做一步（同上） */
	redo(): void {
		if (this.session?.redo()) {
			syncHistoryButtons(this);
		}
	}

	/** 撤销 / 重做可用态（会话是唯一来源；无会话时退回引擎历史） */
	historyAvailability(): { canUndo: boolean; canRedo: boolean } {
		return (
			this.session?.historyAvailability() ??
			readHistoryAvailability(this.mindMap)
		);
	}

	// ==================== SessionViewPort（会话 → 视图的窄接口） ====================

	/** 会话版路径（视图未绑定文件时为空串） */
	get path(): string {
		return this.file?.path ?? '';
	}

	/** 本视图此刻是否是活动视图（状态栏只由活动视图写，K166） */
	get isActiveView(): boolean {
		return this.app.workspace.getActiveViewOfType(MindMapView) === this;
	}

	/**
	 * 应用快照前：把持有**节点对象引用**的会话全部收干净。
	 *
	 * 快照应用会重建节点实例（`renderer.setData`），旧引用全部失效——内联编辑器
	 * 不提交就会把旧原文写回新树（覆盖对侧改动）；点选 / 联系锚定留着会对
	 * 已销毁节点操作。
	 */
	beforeApplySnapshot(): void {
		closeInlineEditor(this);
		cancelNodePick(this);
		cancelRelationAnchor(this);
	}

	/**
	 * 应用会话快照（引擎层唯一通道：不进历史、不发 `data_change`）。
	 *
	 * 树由会话侧备好：`DocumentSession.applyToPort` 已补齐图片默认尺寸
	 * （外部分支重载的树来自解析器，缺 `imageSize` 会让引擎整图中断）。
	 * 本视图再把自己引擎里**已定稿**的尺寸复用进去：加载期的异步探测回灌
	 * 不会为快照重跑，不复用会让外部写入后图片突然缩回默认盒（K198 ⑤）。
	 */
	applySnapshot(tree: MindMapTreeNode): boolean {
		return applySessionSnapshot(
			this.mindMap,
			reuseKnownImageSizes(tree, this.knownImageSizes()),
		);
	}

	/**
	 * 当前引擎里 `custom:true` 的定稿图片尺寸，按「地址 + 官方尺寸参数」索引。
	 *
	 * 必须在**应用快照之前**读：应用后引擎树就被新树替换了。默认盒
	 * （`custom:false` / 缺字段）不收，否则会把「曾回落到默认」的态固化下来。
	 */
	private knownImageSizes(): Map<string, ImageSizeValue> {
		const known = new Map<string, ImageSizeValue>();
		const root = getRenderRoot(this.mindMap);
		if (!root) {
			return known;
		}
		const stack: MindMapNode[] = [root];
		while (stack.length > 0) {
			const node = stack.pop()!;
			const data = node.getData() as Record<string, unknown> | undefined;
			const size = data?.imageSize as ImageSizeValue | undefined;
			if (typeof data?.image === 'string' && size?.custom) {
				known.set(imageSizeKey(data), { ...size });
			}
			for (const child of node.children ?? []) {
				stack.push(child);
			}
		}
		return known;
	}


	/** 应用后只刷新界面：状态栏计数与历史按钮（不排保存 / 不跑守卫） */
	afterApplySnapshot(): void {
		updateStatusBar(this);
		syncHistoryButtons(this);
	}

	/** 保存状态回写（是否推给共享状态栏由 `setSaveState` 按活动态决定） */
	setSessionSaveState(state: SessionSaveState): void {
		this.setSaveState(state);
	}

	/** 外部写入重载且本地有草稿：提示一次（与官方「已被外部修改」同位置） */
	notifyExternalReload(): void {
		new Notice(t(this.lang, 'save.externalReloaded'));
	}

	/** 本次提交基于旧树、已被会话拒绝：提示一次（不写盘） */
	notifyStaleCommit(): void {
		new Notice(t(this.lang, 'save.staleCommit'));
	}

	/**
	 * 更新保存状态并同步状态栏（幂等）。
	 *
	 * 只在**本视图是活动视图**时写共享状态栏：多个导图标签并存时，后台那张图的
	 * 写盘结果不该覆盖前台显示的状态。切回本视图由 `active-leaf-change` 的
	 * `updateStatusBar` 按 `saveState` 重新推送。
	 */
	private setSaveState(state: SaveState): void {
		if (this.saveState === state) {
			return;
		}
		this.saveState = state;
		if (this.app.workspace.getActiveViewOfType(MindMapView) === this) {
			this.plugin.statusBar.showSaveState(state);
		}
	}

	/**
	 * 插件侧编辑通道（内联编辑器 / 弹窗原文模式）提交完成通知（K108）。
	 *
	 * 这两条通道经 `applyRawNodeContent` 直接改节点 data 后 render，**不走引擎
	 * 命令**，故不派发 `data_change` / `node_text_edit_change`——而视图的后续
	 * 编排（保存、节点计数、中心主题改名文件、编辑后自动拆分混排双链）全部
	 * 挂在这两个引擎事件上。此前缺这一步，导致**默认自绘渲染下中心主题改名
	 * 与自动拆分静默失效**（实机：改了中心主题但文件不重命名；混排节点编辑后
	 * 不拆出子节点，而批量命令正常）。
	 *
	 * 与引擎事件回调逐条对齐（`onRootDataChanged` / `onNodeTextEdited` /
	 * `onDataChanged`），保证两条编辑通道与引擎编辑框行为一致。
	 */
	notifyNodeContentCommitted(node: MindMapNode): void {
		// 插件侧编辑通道同样要先落会话（否则同文件另一视图看不到本次编辑）。
		// 只有真的提交进会话才排保存：广播应用期间（`applying`）或提交基于
		// 旧树被拒时，权威树没变，排保存只会把旧内容写出去（K194）。
		if (this.commitSession()) {
			this.scheduleSave();
		}
		updateStatusBar(this);
		this.titleRenamer.schedule();
		// 候选先入集、再延后一拍检查（与引擎 data_change 路径同序）：
		// runAutoSplitCheck 只处理候选集，顺序颠倒会漏拆本次编辑。
		// pluginChannel：本通道同步刷新 mdDerivedText，须显式放行拆分判据
		captureAutoSplitCandidate(this, node, { pluginChannel: true });
		this.scheduleAutoSplitCheck();
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
	 * 检查对象是**编辑期捕获的候选集**（view-split-links.captureAutoSplitCandidate
	 * 经引擎 node_text_edit_change 累积）——不再是检查时刻的激活节点：编辑提交后
	 * 快速切换激活也不漏拆（2026-09-13 严格化）。
	 */
	private scheduleAutoSplitCheck(): void {
		// createDebouncer 的 schedule 已含「取消未决任务」语义（尾沿防抖），
		// 与原文 cancel-then-setTimeout 等价；此处不再重复 cancel
		this.autoSplitDebouncer.schedule(() => runAutoSplitCheck(this));
	}

	/** 取消尚未执行的自动拆分检查（重复调度 / 视图关闭时） */
	private cancelAutoSplitCheck(): void {
		this.autoSplitDebouncer.cancel();
	}

	// ==================== 工具栏（委托 view-toolbar.ts） ====================

	/** 自动整理：按当前布局重新对齐各主题（保留当前视口） */
	arrangeMindMap(): void {
		arrangeMindMap(this);
	}

	/** 设置变更后重建工具栏 */
	refreshToolbar(): void {
		refreshToolbar(this);
	}

	/** 文档模式：切回 Markdown 编辑/阅读（恢复进入前模式；声明随之降级） */
	backToMarkdown(): void {
		if (!this.file) {
			return;
		}
		this.engine.persistViewport();
		const file = this.file;
		void openAsMarkdown(
			this.app,
			this.leaf,
			file,
			this.mdBackMode,
			this.lang,
		).then(() => {
			// 属性降级是**持久改动**（下次打开不再自动进导图），而界面只表现为换了
			// 个视图 ⇒ 必须说清楚，否则用户以为只是切了显示（2026-11-03 实机：
			// 点「返回」后 `Mindmap: LogicalStructure` 静默变成 `Mindmap: Markdown`）。
			new Notice(t(this.lang, 'view.backToMarkdownDone'));
		});
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

	async exportImage(): Promise<void> {
		await exportImage(this);
	}

	// ==================== 链接跳转 / 引用更新 / 清理 ====================

	/**
	 * 打开节点超链接（wiki / http / 库内路径 / 库外 file://）—— 委托 view-link-navigator。
	 * 保留 MindMapViewContext 接口契约（engine-controller / view-wikilink 依赖）。
	 */
	openHyperlink(link: string, mode: HyperlinkOpenMode = 'current'): void {
		linkNavigatorOpen(this, link, mode);
	}

	updateReferencesOnRename(file: TFile, oldPath: string): void {
		// 引用更新**跟随官方设置**（设置 → 文件与链接 → 「自动更新内部链接」），
		// 本插件不再有同名开关（2026-10-09 减法：与官方设置并排的第二份判定已删）。
		//
		// 官方自己就会改写链接，这里为什么还要自己更新一遍（**不是重复实现**）：
		// 官方核心改的是**磁盘上的文件**，而本视图持有内存树快照（`mdRaw` / `text`），
		// 下一次自动保存会把旧链接**写回去**、覆盖核心的改写。内存树必须与核心同步
		// 更新——两侧产出同一枚新链接，因此收敛；保存管线的外部改动检测是第二道
		// 保险（万一两侧不一致，宁可跳过本轮保存，也不覆盖核心的改写）。
		if (!updatesInternalLinksOnRename(this.app)) {
			this.warnReferencesKept(file, oldPath, 'rename');
			return;
		}
		if (this.engine.updateReferencesOnRename(file, oldPath)) {
			this.scheduleSave();
		}
	}

	updateReferencesOnDelete(file: TFile): void {
		// 同 rename：官方设置关闭后既不改写链接、也不清理附件引用与内嵌图片
		if (!updatesInternalLinksOnRename(this.app)) {
			this.warnReferencesKept(file, file.path, 'delete');
			return;
		}
		if (this.engine.removeReferencesOnDelete(file)) {
			this.scheduleSave();
		}
	}

	/**
	 * 官方「自动更新内部链接」关闭时的**内部痕迹**（控制台告警）。
	 *
	 * 为什么**不再弹 Notice**：官方在该设置关闭后会自己弹「是否更新链接」的确认
	 * （Settings.md：be prompted to update links after renaming）——同一事件上再弹
	 * 一条本插件提示即**二次提示**（K 规范：失败已由被调方提示过的，调用方不得
	 * 二次提示）。留痕仍必要：静默跳过会让「引用为何没更新」无迹可查。
	 * 只在**本图确有可能的引用**时告警（预检与引用更新的短路判定同源），
	 * 避免无关文件的重命名/删除刷屏。
	 */
	private warnReferencesKept(
		file: TFile,
		oldPath: string,
		action: 'rename' | 'delete',
	): void {
		if (!this.engine.hasReferencesFor(file, oldPath)) {
			return;
		}
		console.warn(
			'[mindmap-studio] 官方「自动更新内部链接」已关闭：本图对 %s 的引用保持不变（%s）',
			file.path,
			action,
		);
	}

	override async onClose(): Promise<void> {
		// **必须先于 `invalidateInit`**（同 onUnloadFile）：作废会 `viewport.reset()`
		// 清掉「打开时的默认视口」判据，晚一步调用就会把纯浏览也写成条目。
		this.engine.persistViewport();
		this.clearRenderHint();
		this.engine.invalidateInit();
		this.cancelPendingInit();
		// 关闭后不再允许任何加载结果被应用（rAF 守卫依赖该字段）
		this.loadSession.loadingFilePath = null;
		// 未消费的加载基线与大图提示同样作废（关闭后不会再建引擎）
		this.loadSession.pendingBaseline = null;
		this.loadSession.pendingRenderHint = null;
		// 会话引用留到内联编辑提交之后再摘（同 onUnloadFile：先置 null 会丢输入）
		const session = this.session;
		// 提交闸同样留到 `closeInlineEditor` 之后（同 onUnloadFile：先关闸会丢最后一次输入）
		this.cancelAutoSplitCheck();
		cancelSyntaxGuard(this);
		this.resizeThrottler.cancel();
		this.cancelDeferredResize();
		this.titleRenamer.cancel();
		cancelStatusBarUpdate(this);
		// 交互会话收尾（图片调宽）：会话期间的临时 window 监听
		// 不经事件绑定器记录，中途关闭视图收不到 mouseup，须显式清理。
		// 必须在 savePipeline.save() 之前——调宽会话收尾会调度一次保存。
		teardownImageResize(this);
		// 联系的点选 / 手绘锚定同样是临时 window 监听（同款理由）；顺带丢弃
		// 未落地的几何回写计时器，避免关闭后仍去读写已销毁的引擎。
		teardownRelationInteraction(this);
		// 小地图：定时器 + 拖拽会话 + 面板 DOM 一并回收（幂等，引擎换代亦走它）
		teardownMiniMap(this);
		// 挂起装配信号：关闭后到达的 onLoadFile 等待下一次 onOpen（原轮询语义）
		this.loadSession.whenReady = new Promise(() => {});
		// 内联编辑会话提交（同 onUnloadFile：输入必须先落数据再写盘）
		closeInlineEditor(this);
		// 编辑器提交完成后再关闸/摘引用（同 onUnloadFile 的顺序契约）
		this.commitsArmed = false;
		// 视口已在方法开头先行落定（必须先于 invalidateInit）
		this.session = null;
		// 解绑即 flush（对齐官方 onUnloadFile；最后一个视图解绑时会话销毁）
		if (session) {
			await session.detach(this);
		}
		// 视图级注册的**对称回收**：`onClose` 不触发 Component 卸载，而
		// `registerEvent` / `registerDomEvent` / `scope.register` 的清理时机分别是
		// 卸载与作用域销毁 ⇒ 同一实例经历多次 onClose→onOpen 时这些注册会逐次叠加，
		// 故在此显式注销（卸载路径上的重复注销是幂等 no-op）。
		if (this.cssChangeRef) {
			this.app.workspace.offref(this.cssChangeRef);
			this.cssChangeRef = null;
		}
		if (this.activeLeafRef) {
			this.app.workspace.offref(this.activeLeafRef);
			this.activeLeafRef = null;
		}
		if (this.pasteHandler) {
			this.containerEl.win.removeEventListener('paste', this.pasteHandler);
			this.pasteHandler = null;
		}
		// 作用域置空：下次 onOpen 经 ensureViewScope 重建干净的 Scope，
		// 避免 9 个视图热键处理器在同一 Scope 上重复注册。
		this.scope = null;
		// 清理视图生命周期作用域的事件（搜索输入框 input/keydown 等）
		this.viewEvents.destroy();
		// 数学重测节点随引擎销毁丢弃：视图关闭后不再有任何重测目标，
		// 留着会一直持有已销毁的节点对象（同 onUnloadFile / onEngineReady）。
		// dispose 另取消未决的重排批次（关闭后不再有宏任务在跑）。
		this.contentRemeasure.dispose();
		this.engine.destroyInstance();
		// 清空状态栏，再把**当前活动**的导图视图重新推上去（状态栏是插件级共享
		// 元素：本视图关闭不该清掉别人的计数，也不该把**后台**视图的计数/保存
		// 状态留在前台）。无活动导图（切到普通笔记）就保持清空。
		this.plugin.statusBar.clear();
		const active = this.app.workspace.getActiveViewOfType(MindMapView);
		if (active && active !== this && active.mindMap) {
			updateStatusBar(active);
		}
	}

	override onResize(): void {
		// 大图：拖动期间**不**整树重排（单轮 ≈0.4 s @5000，见 RESIZE_DEFER_MS），
		// 停止拖动后合并成一次；小图仍走 100 ms 节流，保持实时跟手。
		if (countMindMapNodes(this.mindMap) >= LARGE_MAP_RENDER_HINT_NODES) {
			this.scheduleDeferredResize();
			return;
		}
		// 从大图切到小图（换文件 / 删节点跨过阈值）时旧尾随仍在：留着会在
		// 180ms 后再补一轮整树 render，正是本策略要消灭的成本
		this.cancelDeferredResize();
		// 首次立即执行、窗口内合并 + 尾随（最后尺寸必然落地）：拖动窗口/侧栏期间
		// 不再是每个 resize 事件一次整树 render（见 RESIZE_THROTTLE_MS）
		this.resizeThrottler.run(() => this.applyResize());
	}

	/**
	 * 大图 resize 的尾随合并：每次尺寸变化只重置计时器，停止拖动 `RESIZE_DEFER_MS`
	 * 后做一次整树 resize。
	 *
	 * 必须同时取消小图节流器：从大图切到小图（或反过来）时，旧节拍里挂着的尾随
	 * 会在新策略下多跑一轮整树 render，正是本策略要消灭的成本。
	 */
	private scheduleDeferredResize(): void {
		this.resizeThrottler.cancel();
		if (this.resizeDeferTimer !== null) {
			this.containerEl.win.clearTimeout(this.resizeDeferTimer);
		}
		this.resizeDeferTimer = this.containerEl.win.setTimeout(() => {
			this.resizeDeferTimer = null;
			this.applyResize();
		}, RESIZE_DEFER_MS);
	}

	/** 取消未决的大图尾随 resize（幂等；换文件 / 关闭时调用） */
	private cancelDeferredResize(): void {
		if (this.resizeDeferTimer !== null) {
			this.containerEl.win.clearTimeout(this.resizeDeferTimer);
			this.resizeDeferTimer = null;
		}
	}

	/**
	 * 应用一次尺寸变化：引擎 resize + 可见性采样。
	 *
	 * 采样理由（content-remeasure ④）：叶子由隐藏转可见时容器尺寸 0→非 0，
	 * 本回调必然触发；先 resize 再自愈——若 resize 已使尺寸正确，自愈的症状
	 * 扫描自然为空（幂等、无脏零成本）。
	 */
	private applyResize(): void {
		this.engine.resize();
		this.contentRemeasure.syncVisibility();
	}
}
