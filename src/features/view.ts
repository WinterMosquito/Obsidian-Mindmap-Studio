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
import { Language, t } from '../core/i18n';
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
	normalizeLineStylePreference,
	normalizePalettePreference,
	normalizeThemeStyle,
	VIEW_TYPE,
} from '../core/constants';
import type { MindMap, MindMapNode } from '../core/engine-types';
import { createWarnOnce, notifyError } from '../core/errors';
import {
	applyColorDirectivesToTree,
	applyImageSizeCorrectionsToEngine,
	getRenderRoot,
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
} from '../media/images-path';
import { openAsMarkdown, readDeclaredLayout } from '../markdown/md-open';
import {
	layoutIdOfPropertyValue,
	layoutPropertyValue,
	setMindMapProperty,
} from '../domain/mindmap-property';
import { registerWikilinkInteractions } from './view-wikilink';
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
import { DocumentService, SavePipeline } from '../services/document-service';
import { EngineController } from '../services/engine-controller';
import {
	buildSearchBar,
	openSearchBar,
	refreshSearchBarLabels,
} from './view-search';
import { exportImage } from './view-export';
import { arrangeMindMap, buildToolbar, refreshToolbar } from './view-toolbar';
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

/** 视图装配完成信号超时（毫秒）：正常 onOpen 会 resolve；超时表示装配未完成，降级继续加载 */
const READY_TIMEOUT_MS = 10_000;

/**
 * resize 节流窗口（毫秒）：拖动窗口边框 / 侧栏分隔条期间 resize 高频触发，
 * 而引擎 `resize()` 只要画布宽高变化即整树 `render()`（vendor 只有重入保护，
 * 无事件级合并）——限流到至多每窗口一次、尾随保证最后尺寸落地。
 */
const RESIZE_THROTTLE_MS = 100;

/**
 * 可在**不重建引擎**的前提下完成刷新的 LIVE_REFRESH 键（键集合由 `settings.ts`
 * 的 `diffLiveRefreshKeys` 产出；这里只决定「收到这个键时做什么」）。
 *
 * - `defaultTheme`：引擎 `setThemeConfig` 通道原地生效（与 css-change 同款）；
 * - `defaultLineStyle`：**故意留空**——会话字段在 `loadMindMapFromFile` 里已按
 *   「文件显式选择 ?? 默认值」定值，此后默认值变更对已打开的图**本就不生效**
 *   （重建一轮也不会有任何可见变化）⇒ 跳过即行为等价的优化（省掉整树
 *   `structuredClone` + 全量重渲染，实测口径见 K58）。
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

const IN_PLACE_REFRESH_KEYS = new Set([
	'defaultTheme',
	'defaultThemeStyle',
	'defaultLineStyle',
]);

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

export class MindMapView extends FileView implements MindMapViewContext {
	plugin: ViewPluginContext;
	canvasEl: HTMLElement | null = null;
	toolbarEl: HTMLElement | null = null;
	searchBarEl: HTMLElement | null = null;
	searchInput: HTMLInputElement | null = null;
	searchCountEl: HTMLElement | null = null;
	// 外观项（布局/连线/配色/边框）都没有屏上下拉，故无 select 字段——
	// 当前值经 `resolveLayout()` / `resolvePreference(key)` 现算给右键勾选态与竖栏开关。
	/** 当前深色主题（css-change 时重算；仅本类与引擎控制器装配面使用） */
	private isDark = false;

	/** md 文档读取/解析（渲染层数据面） */
	private documents: DocumentService;
	/** 保存管线（防抖 + 串行排空 + 卸载快照兜底） */
	private savePipeline: SavePipeline;
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
	 * **唯一持久化位是文件属性**（frontmatter 的 `Mindmap` 值）：加载时读声明
	 * （`readDeclaredLayout`），切换时写属性（`applyLayout`）。
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
	 * resize 节流器（见 RESIZE_THROTTLE_MS）：窗口/侧栏拖动的连续尺寸变化合并到
	 * 每窗口至多一次整树重排；onClose 取消（视图关闭后不再触碰引擎）。
	 */
	private readonly resizeThrottler = createThrottler(RESIZE_THROTTLE_MS);

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
	 * 按文件键保留的 frontmatter 块（保存时拼回文件头；条目在 onUnloadFile
	 * 写盘结束后清理）。**必须按文件取值**：core 切换 FileView 的文件时不 await
	 * onUnloadFile，「最近加载的那一份」在换文件期间已属于新文件——若用单值字段，
	 * 旧文件的写盘会拼上新文件的文件头、或丢掉旧文件的文件头。
	 */
	private readonly frontmatterByPath = new Map<string, string | null>();

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

	/**
	 * 「冗余 leaf 摘除失败」告警留痕（同一视图只提示一次）。
	 *
	 * 失败只留空标签页，用户已经收到「该导图已在其他标签页打开」的提示（不二次
	 * 打扰）；但空 leaf 残留本身**只能靠日志发现**，属无痕退化 ⇒ 必须留痕。
	 */
	private warnDuplicateLeafDetach = createWarnOnce();

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
			// P1a：自动保存检测到外部修改 → 提示跳过（不覆盖他处改动）
			onExternalChange: (file) => {
				notifyError(this.lang, 'save.externalChangeSkipped', file.path);
			},
			// P1b：连续失败挂起自动保存 → 一次性提示（显式保存不受影响）
			onAutoSaveSuspended: () => {
				notifyError(this.lang, 'save.autoSuspended', '');
			},
		});
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
				this.scheduleSave();
				updateStatusBar(this);
				this.titleRenamer.schedule();
			},
			onDataChanged: () => this.scheduleAutoSplitCheck(),
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
		// P0 同文件互斥（2026-09-28 加固）：同一导图文件只允许一个
		// MindMapView 持有引擎——两实例各自独立引擎 + 独立保存管线，防抖窗口
		// 交错时**后写覆盖先写**（保存互踩、丢编辑）。Obsidian 允许同一文件
		// 多标签（Ctrl+点击新开、重启后布局恢复都会走到这里）。
		// 处理：提示 + 激活既有 leaf，本 leaf 延迟摘除（onLoadFile 内同步
		// detach 会与装载流程竞争）；未初始化即摘除的空实例，其 onClose 各步
		// （persistViewport/getDataSnapshot/destroyInstance）均有空守卫，安全。
		const duplicateLeaf = this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.find((leaf) => {
				const other = leaf.view;
				return (
					other instanceof MindMapView &&
					other !== this &&
					(other.loadSession.loadingFilePath ?? other.file?.path) === file.path
				);
			});
		if (duplicateLeaf) {
			new Notice(t(this.lang, 'common.mindMapAlreadyOpen'));
			// 官方契约：revealLeaf 返回 Promise（obsidian.d.ts 明言「await 它以确保视图
			// 已加载」），故挂 catch 兜住拒绝——此处**不另弹 Notice**：上面已提示
			// 「该导图已在其他标签页打开」，再弹一条是重复打扰。
			void this.app.workspace
				.revealLeaf(duplicateLeaf)
				.catch((error: unknown) => {
					console.warn('切换到已打开的导图标签页失败:', error);
				});
			window.setTimeout(() => {
				try {
					this.leaf.detach();
				} catch (error) {
					// 摘除失败（leaf 已被外部关闭等）：不再二次提示用户，但上次
					// 「让位」是否真的生效只能靠日志发现 ⇒ 留痕一次
					this.warnDuplicateLeafDetach(
						'冗余标签页摘除失败（可能残留空标签页）',
						error,
					);
				}
			}, 0);
			return;
		}
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
		this.engine.invalidateInit();
		this.cancelPendingInit();
		this.savePipeline.cancelTimer();
		this.titleRenamer.cancel();
		// 小地图会话持有本引擎引用 + 定时器 + 面板 DOM：与其它会话同期收尾。
		// **必须在 await 之前**——await 期间新文件可能已接管视图并重建了会话，
		// 那时再拆会误拆新的；而漏掉这一步时，旧面板会跨到下一个文件
		// （加载失败的路径更是无人收尾）。
		teardownMiniMap(this);
		// 内联编辑会话必须先提交（用户输入落节点数据 + scheduleSave），
		// 否则随后的写盘拿不到刚输入的内容（引擎随后销毁）
		closeInlineEditor(this);
		// 先保存当前视口，再写盘正文（引擎随后销毁）
		this.engine.persistViewport();
		// 显式传入本文件与**本文件**的树快照（同步抓取，不受后续 await 影响）：
		// core 不 await onUnloadFile，await 期间新文件可能已接管引擎与 this.file，
		// 隐式取值会把新文件的内容写进本文件（见 SavePipeline 归属不变式）。
		await this.savePipeline.save(file, this.engine.getDataSnapshot());
		this.frontmatterByPath.delete(file.path);
		// 挂起的图片尺寸校正属于本文件：文件已卸载，丢弃（引擎随后销毁，
		// 回灌会落空，留着只会在新文件上误判）
		this.loadSession.pendingImageCorrections = null;
		// 数学重测节点同属本引擎：随引擎销毁一并丢弃（否则跨文件累积持有旧节点）
		this.contentRemeasure.resetNodes();
		// 文件切换后允许再次加载同一路径（新会话）。仅清理「仍属于本次卸载」的
		// 标记：await 期间可能已开始加载新文件（onLoadFile），无条件置空会把
		// 新加载的代际标记抹掉，其 rAF 守卫随即判为过期 → 导图不渲染。
		if (this.loadSession.loadingFilePath === unloadingPath) {
			this.loadSession.loadingFilePath = null;
		}
		this.engine.destroyInstance();
	}

	/** 取消尚未执行的引擎初始化帧（幂等） */
	private cancelPendingInit(): void {
		this.loadSession.cancelInitFrame(this.containerEl.win);
	}

	private async loadMindMapFromFile(file: TFile): Promise<void> {
		this.loadSession.loadingFilePath = file.path;
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
			const doc = await this.documents.load(file);
			// 加载期间文件已切换：丢弃过期结果
			if (this.loadSession.loadingFilePath !== file.path) {
				return;
			}
			this.frontmatterByPath.set(file.path, doc.frontmatter);
			// 复问声明：此刻引擎尚未创建（initMindMap 在下一帧的 rAF 里），
			// 更新会话值即可让「竖栏 / 右键勾选态」与「引擎创建用的布局」同时对齐
			// 磁盘真值，不必等一次 `metadataCache.changed` 再重排。
			const declaredNow = readDeclaredLayout(this.app, file);
			if (declaredNow !== null) {
				this.currentLayout = declaredNow;
			}
			// mdBackMode 的读入已前移到 setState 覆写：官方 view.getState() 不保留
			// 传入 state，从此处经 leaf.getViewState() 读回是恒失败链路（2026-10-15）。
			const tree = doc.tree;
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
			applyColorDirectivesToTree(tree, colorDirectiveOf);
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
					this.engine.initMindMap(tree);
				},
			);
		} catch (error) {
			// 文件可能已被删除/损坏：保持视图可用并提示，避免半加载状态
			this.loadSession.loadingFilePath = null;
			console.error('加载思维导图失败:', file.path, error);
			new Notice(`${t(this.lang, 'common.notLoaded')}`);
		}
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
				// 节点配色指令（`%%#hex%%`）：编辑 / 插入 / 撤销后重算，有变化再渲染一次。
				// **必须挂渲染落地**（不是 `data_change`）：插件内联编辑走
				// `applyRawNodeContent` 直接改 data 后 render，根本不发 `data_change`
				// （K108）；撤销时 `data_change` 又在渲染排队前发出，那时 renderer.root
				// 还是旧树。此刻根节点已是新树、数据已定稿，同步一次即覆盖全部通道。
				syncNodeColorDirectives(mindMap, colorDirectiveOf);
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
		// 方法对接口上任意字符串开放。非法值既不能写进文件（会落成默认值、冒充一次
		// 用户选择），也不能交给引擎（未知布局）——直接忽略并留痕。
		const layoutId = layoutIdOfPropertyValue(engineLayoutId);
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
				await this.savePipeline.save();
				await this.app.fileManager.processFrontMatter(
					file,
					(frontmatter: Record<string, unknown>) => {
						setMindMapProperty(frontmatter, layoutPropertyValue(layoutId));
					},
				);
				// 这次写入绕过了保存管线：基线必须作废，否则下一次自动保存会把
				// 它误判成「他处修改」而整轮跳过（此后每次编辑都静默不落盘）。
				// 失败路径不当作废——文件没被改，基线仍然有效。
				this.savePipeline.forgetBaseline(file);
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
	 * 跟随文件属性的**外部**变更：重读本文件声明，值变了就只应用引擎侧，**不回写
	 * 文件**（属性是用户/其它窗格/同步写的，我们只是跟随）。
	 *
	 * 由组合根在 `metadataCache.changed` 时调用（见 main.ts）。四条早退：
	 * - 无文件 / 声明不是布局（`Markdown`、未知值、无键）⇒ 什么都不做。**刻意不
	 *   抽走已打开的视图**：运行中把正在编辑的图踢回 Markdown 会丢上下文；「是不是
	 *   导图」只决定打开时怎么进。
	 * - 本视图正在写这一项的布局（`pendingLayoutWrite`）⇒ 让位，由 `applyLayout`
	 *   收尾统一应用。它的 `await` 与 `changed` 谁先到由宿主实现决定，不挡就会对
	 *   同一布局应用两次（双重重排 + 竖栏连建两次）。
	 * - 声明值 == 会话值 ⇒ 直接返回。**必须幂等**：我们自己的 `applyLayout` 写属性
	 *   同样会触发 `changed`，不早退就是二次重排（小地图也连画两轮）。
	 */
	syncDeclaredLayout(): void {
		const file = this.file;
		const declared = readDeclaredLayout(this.app, file);
		if (declared === null || declared === this.pendingLayoutWrite) {
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
			this.engine.refresh();
			return;
		}
		if (changedKeys.has('defaultTheme')) {
			// 主题（明暗）变更 → 引擎原地换 themeConfig
			// （边框与配色不是设置项：按文件记，走右栏开关 / 右键菜单的 applyThemeStyle、applyPalette；
			//   defaultThemeStyle 只影响新建导图，这里重算也不会改动当前文件）
			this.applyTheme();
		}
	}

	private applyTheme(): void {
		this.engine.applyTheme();
	}

	/** 安排一次防抖自动保存（view-toolbar.ts / view-node-actions.ts 等外部模块调用） */
	scheduleSave(): void {
		this.savePipeline.schedule();
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
		this.scheduleSave();
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
		if (this.file) {
			this.engine.persistViewport();
			void openAsMarkdown(
				this.app,
				this.leaf,
				this.file,
				this.mdBackMode,
				this.lang,
			);
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
		this.engine.invalidateInit();
		this.cancelPendingInit();
		// 关闭后不再允许任何加载结果被应用（rAF 守卫依赖该字段）
		this.loadSession.loadingFilePath = null;
		this.savePipeline.cancelTimer();
		this.cancelAutoSplitCheck();
		this.resizeThrottler.cancel();
		this.titleRenamer.cancel();
		cancelStatusBarUpdate(this);
		// 交互会话收尾（图片调宽）：会话期间的临时 window 监听
		// 不经事件绑定器记录，中途关闭视图收不到 mouseup，须显式清理。
		// 必须在 savePipeline.save() 之前——调宽会话收尾会调度一次保存。
		teardownImageResize(this);
		// 小地图：定时器 + 拖拽会话 + 面板 DOM 一并回收（幂等，引擎换代亦走它）
		teardownMiniMap(this);
		// 挂起装配信号：关闭后到达的 onLoadFile 等待下一次 onOpen（原轮询语义）
		this.loadSession.whenReady = new Promise(() => {});
		// 内联编辑会话提交（同 onUnloadFile：输入必须先落数据再写盘）
		closeInlineEditor(this);
		this.engine.persistViewport();
		await this.savePipeline.save();
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
		// 首次立即执行、窗口内合并 + 尾随（最后尺寸必然落地）：拖动窗口/侧栏期间
		// 不再是每个 resize 事件一次整树 render（见 RESIZE_THROTTLE_MS）
		this.resizeThrottler.run(() => {
			this.engine.resize();
			// 可见性采样（自绘内容尺寸自愈，见 content-remeasure ④）：叶子由隐藏
			// 转可见时容器尺寸 0→非 0，本回调必然触发；先 resize 再自愈——
			// 若 resize 已使尺寸正确，自愈的症状扫描自然为空（幂等、无脏零成本）
			this.contentRemeasure.syncVisibility();
		});
	}
}
