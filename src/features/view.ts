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
import { type EventRef, FileView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { Language, t, tf } from '../core/i18n';
import type { TranslationKey } from '../core/i18n';
import { injectObsidianCssVarsIntoExportSvg } from '../platform/export-css-vars';
import { padForeignObjectsForExport } from '../platform/export-foreign-object-padding';
import {
	getRenderedMathNode,
	injectMathStylesIntoExportSvg,
	pinMathContainerHeightsInExportSvg,
	renderMathWithMathJax,
} from '../platform/math-jax';
import {
	getRenderedCodeNodes,
	refreshPrismTokenColors,
	renderCodeWithPrism,
} from '../platform/prism-code';
import { createThrottler } from '../core/concurrency';
import { AUTO_SPLIT_CHECK_DELAY_MS, VIEW_TYPE } from '../core/constants';
import type { MindMap, MindMapNode } from '../../vendor/simple-mind-map.cjs';
import { notifyError } from '../core/errors';
import {
	applyImageSizeCorrectionsToEngine,
	findNodesByContentProducts,
	resolveNodesByDoms,
	getRenderRoot,
	refreshNodesCustomContent,
} from '../engine/mindmap';
import {
	collectImageSizeCorrections,
	ensureDefaultImageSizes,
	type ImageSizeCorrection,
} from '../media/images-path';
import { openAsMarkdown } from '../markdown/md-open';
import { registerWikilinkInteractions } from './view-wikilink';
import {
	closeInlineEditor,
	isInlineNodeEditing,
} from './node-inline-editor';
import {
	hideCopyButtonsInExportSvg,
	registerCodeBlockInteractions,
} from './node-codeblock';
import {
	buildInlineNodeContent,
	type InlineContentOptions,
} from './node-inline-content';
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
import { setupViewportGestures } from './view-viewport';
import { handleWindowPaste, setupPasteHandler } from './view-paste';
import {
	cancelStatusBarUpdate,
	updateStatusBar,
} from './view-status';
import { openNodeImageFullscreen } from './view-image-fullscreen';
import { setupImageResize, teardownImageResize } from './image-resize';
import { setupDragTargetAssist, teardownDragTargetAssist } from './drag-target';
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
 * - `defaultLayout` / `defaultLineStyle`：**故意留空**——会话字段在
 *   `loadMindMapFromFile` 里已按「文件显式选择 ?? 默认值」定值，此后默认值变更对
 *   已打开的图**本就不生效**（重建一轮也不会有任何可见变化）⇒ 跳过即行为等价
 *   的优化（省掉整树 `structuredClone` + 全量重渲染，实测口径见 K58）。
 *
 * - `performanceMode` / `performanceThreshold`：引擎显式支持运行时切换
 *   （`updateConfig` → `after_update_config` 重新绑定视口变化处理器 + `forceLoadNode`，
 *   见 `engine/mindmap.applyPerformanceMode`）——性能阈值是设置面板的滑块，收益最直接。
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
	'defaultLayout',
	'defaultLineStyle',
	'performanceMode',
	'performanceThreshold',
]);

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
	 * `css-change` 的 `EventRef`：`registerEvent` 的清理时机是 **Component 卸载**，
	 * 而本视图在 `onClose` 并不卸载，故须自行保存引用并在 `onClose` 显式 `offref`。
	 */
	private cssChangeRef: EventRef | null = null;
	/** 窗口级 paste 监听器（须按同一函数引用移除；`registerDomEvent` 同样只在卸载时清理） */
	private pasteHandler: ((event: ClipboardEvent) => void) | null = null;
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
	 * 挂起的「图片尺寸校正」结果（探测在首帧前起步、首帧后回灌，见加载序列注释）。
	 * 引擎尚未创建时留待 onEngineReady；文件切换/卸载时丢弃。
	 */
	private pendingImageCorrections: ImageSizeCorrection[] | null = null;
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
	 * resize 节流器（见 RESIZE_THROTTLE_MS）：窗口/侧栏拖动的连续尺寸变化合并到
	 * 每窗口至多一次整树重排；onClose 取消（视图关闭后不再触碰引擎）。
	 */
	private readonly resizeThrottler = createThrottler(RESIZE_THROTTLE_MS);

	/**
	 * 内联内容构建选项（**视图实例级一次**，2026-10-02）：内容只依赖视图与设置，
	 * 与 node/doc/style 无关——此前每个节点内容重建都新建对象 + 4 个闭包
	 * （5000 节点打开 ≈ 2 万临时闭包，恰在打开路径上）。箭头闭包捕获实例 this
	 * （属性读取延迟到调用），无字段初始化顺序问题；唯一与设置相关且会话中可变
	 * 的 `selfDrawPlain` 由 `createNodeContent` **每次构建时就地覆盖**（见该处）。
	 */
	private readonly inlineContentOptions: InlineContentOptions = {
		selfDrawPlain: false,
		isResolvedLink: (linkpath) => isResolvedWikiLinkpath(this, linkpath),
		renderMath: (_doc, tex, holder, display) =>
			renderMathWithMathJax(tex, holder, display, (settledHolder) =>
				this.scheduleContentRemeasure(settledHolder),
			),
		getCachedMath: (tex, display) => getRenderedMathNode(tex, display),
		// 代码块 Prism 高亮：与数学同款纪律——官方通道在platform 层、这里只注入；
		// 定稿回调同样交给 scheduleContentRemeasure（换的是尺寸同步机制，不是数学
		// 专属：它只做「按holder 反查真实节点 → 合并为一次批量重排」）
		renderCode: (_doc, code, codeLang, holder) =>
			renderCodeWithPrism(code, codeLang, holder, (settledHolder) =>
				this.scheduleContentRemeasure(settledHolder),
			),
		getCachedCode: (code, codeLang) => getRenderedCodeNodes(code, codeLang),
	};

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

	/**
	 * **自绘内容定稿**（公式替换 / 代码块高亮）后待同步尺寸的 **holder**
	 * （P4，K88 修正；2026-10-07 起含代码块，见 K116）。
	 *
	 * ⚠ 为什么存 holder 而不是构建期捕获的 node：节点内容可能由引擎**预测量**
	 * 路径构建（vendor 补丁 5 的轻量代理对象——只有 `nodeData`/`getData`，没有
	 * `reRender`），A2 元素复用让同一内容进入真实节点 ⇒ 闭包里的 node 是代理 ⇒
	 * `reRender?.()` 静默 no-op ⇒ 尺寸永不同步（实机复现：512px 外框 / 655px
	 * 内容，29 次回调全部收到代理、永不修复）。故批次执行时经 `findNodeByDom`
	 * 从 holder 反查**真实** MindMapNode 再重排。
	 *
	 * 合并到一次批量重排（`refreshNodesCustomContent`）：一次打开多个公式/代码块时
	 * 每段都会定稿，逐个重排会各触发一次全树 render（本字段是性能护栏）。
	 */
	private pendingContentRemeasure: Set<HTMLElement> | null = null;

	/**
	 * 已成功解析并同步过的**真实节点**（**不清空**）。
	 *
	 * 用途：MathJax 字体是**分批**加载的（`document.fonts` 的 `loadingdone` 会
	 * 多次触发）；首批就绪时的测量可能在后续批次变大——内容多的节点尤甚
	 * （实机实测：655px 内容 / 512px 外框）。字体每就绪一批就再同步一次。
	 * （代码块节点也会进入该集合：多一次重测无害，且避免两套并行集合。）
	 */
	private readonly contentRemeasureNodes = new Set<MindMapNode>();

	/**
	 * 「引擎渲染窗口」内解析失败的 holder（K104）：`Renderer._render` 期间
	 * `renderer.root` 被置 null（见 K67 记录），此时 `findNodeByDom` 与产物
	 * 反查**必然**双双落空——属预期中间态。暂存到 `node_tree_render_end`
	 * （root 已回填）重试，不在当时告警。
	 */
	private deferredContentHolders: Set<HTMLElement> | null = null;
	/** 暂存 holders 只重试一次：仍失败才告警（既防静默退化，也防反复重试） */
	private deferredContentRetried = false;

	/** 字体就绪监听只装一次（视图作用域，随 `register` 注销） */
	private mathFontsHookInstalled = false;

	/** 「定稿 holder 未能解析归属节点」告警去重（同一根因只提示一次） */
	private contentRemeasureUnresolvedWarned = false;

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

	/**
	 * 登记「数学定稿后需重测该节点尺寸」（P4，holder 入口见 K88）。
	 *
	 * 背景：引擎的内容测量是**同步**的（构建时按字面占位量高），而 MathJax 替换 /
	 * Prism 高亮都是**异步**的——不重测就会出现「块级公式只占一行高度、内容溢出」
	 * （用户实测）/「代码块按字面尺寸定框、替换后被裁」。定稿后重建该节点内容：此时
	 * 产物缓存已命中（`buildMathElement` / `placeCodeTokens` **同步**放置产物），
	 * 引擎量到的是**真实宽高**。
	 *
	 * 同帧多段定稿合并为一次批量重排（`window.setTimeout(0)`；不用 rAF——后台/
	 * 隐藏窗口会被节流）。
	 */
	private scheduleContentRemeasure(holder: HTMLElement): void {
		if (!this.pendingContentRemeasure) {
			this.pendingContentRemeasure = new Set<HTMLElement>();
			window.setTimeout(() => {
				const holders = this.pendingContentRemeasure;
				this.pendingContentRemeasure = null;
				this.flushContentRemeasure(holders ? Array.from(holders) : []);
			}, 0);
		}
		this.pendingContentRemeasure.add(holder);
		this.installMathFontsHook();
	}

	/**
	 * 批次执行：holder → 真实 MindMapNode（`resolveNodesByDoms` 批量反查）→ 批量重排。
	 *
	 * 解析失败（holder 已脱离 / 引擎重建中）**显式告警一次**并跳过该段——
	 * 静默跳过会让「尺寸不同步」以无痕方式退化（K85 ① 教训）。
	 */
	private flushContentRemeasure(holders: readonly HTMLElement[]): void {
		// 批量窗口（setTimeout）内视图可能已关闭、引擎已销毁：此时既无重测目标，
		// 也不该再走回退并打「未命中」告警（关闭视图时刷误导日志）——静默结束。
		if (!this.mindMap) {
			return;
		}
		const nodes: MindMapNode[] = [];
		const unresolvedHolders: HTMLElement[] = [];
		// 批量反查：一次遍历建「group → 节点」表 + 逐 holder 沿祖先链
		// 查表，取代逐 holder 全树 walkTree（O(holder 数 × 节点数)）。逐位置对应，
		// 故「未命中」语义与原先逐个反查完全一致（落空的 holder 仍进
		// unresolvedHolders，走下面「产物元素反查 / 延后重试」两条回退）。
		const resolved = resolveNodesByDoms(this.mindMap, holders);
		for (const [i, holder] of holders.entries()) {
			const node = resolved[i] ?? null;
			if (!node) {
				unresolvedHolders.push(holder);
				continue;
			}
			nodes.push(node);
			this.contentRemeasureNodes.add(node);
		}
		if (unresolvedHolders.length > 0) {
			// 反查一（K100/K104）：holder 可能已随引擎重渲染脱离（图片回灌 K96 的
			// 补灌触发全树重建），改按**产物元素**反查——选择器三通道覆盖我方
			// 数学 holder 类、CHTML 容器与**代码块高亮 holder**（见
			// findNodesByContentProducts；2026-10-07 审查修复：此前缺代码块通道，
			// 且兜底「捞到别的数学节点」会让本批代码块静默跳过、不重测也不告警）。
			// ⚠ 兜底是**过包含**的（返回全部产物所在节点）⇒ 若本批 holder 彻底消失
			// 且其产物也不在活 DOM里，仍会被静默跳过（K100 既有边界，未改设计）。
			for (const node of findNodesByContentProducts(this.mindMap)) {
				if (nodes.includes(node)) {
					continue;
				}
				nodes.push(node);
				this.contentRemeasureNodes.add(node);
			}
			if (nodes.length === 0) {
				if (!this.deferredContentRetried) {
					// 全部落空且尚未重试：**大概率是引擎渲染窗口**——`Renderer._render`
					// 期间 `renderer.root` 为 null（K67），两条解析路径必然全空。
					// 暂存 holders，等 node_tree_render_end（root 回填）重试，不告警。
					this.deferredContentHolders = new Set(unresolvedHolders);
					return;
				}
				// 重试后仍全空：真的定位不到 → 告警一次（静默跳过会让问题无痕退化）
				if (!this.contentRemeasureUnresolvedWarned) {
					this.contentRemeasureUnresolvedWarned = true;
					console.warn(
						'MindMap Studio：自绘内容节点（公式/代码块）尺寸同步未能定位归属节点，内容可能被裁剪',
					);
				}
			}
		}
		// 本轮有命中（或无需重试）：清暂存与重试标记
		this.deferredContentHolders = null;
		this.deferredContentRetried = false;
		if (nodes.length > 0) {
			refreshNodesCustomContent(this.mindMap, nodes);
		}
	}

	/**
	 * 渲染完成后重试「渲染窗口内未解析的 holder」（K104）。
	 *
	 * `node_tree_render_end` 时 `renderer.root` 已回填，两条解析路径恢复可用；
	 * 只重试**一次**（`deferredContentRetried`）——仍失败由 `flushContentRemeasure`
	 * 告警，避免「重排 → 渲染 → 再重排」的循环。
	 */
	private retryDeferredContentRemeasure(): void {
		const pending = this.deferredContentHolders;
		if (!pending || pending.size === 0 || !this.mindMap) {
			return;
		}
		this.deferredContentHolders = null;
		this.deferredContentRetried = true;
		this.flushContentRemeasure(Array.from(pending));
	}

	/**
	 * 字体每就绪一批就把已同步的数学节点**再同步一次**：字体数据到位后同一
	 * TeX 的产物会更高（多行内容尤甚），首批测量可能偏小。
	 */
	private remeasureSettledContentNodes(): void {
		const nodes = Array.from(this.contentRemeasureNodes);
		if (nodes.length > 0) {
			refreshNodesCustomContent(this.mindMap, nodes);
		}
	}

	/** 一次性装配字体就绪监听（`loadingdone` 会随字体分批多次触发） */
	private installMathFontsHook(): void {
		if (this.mathFontsHookInstalled) {
			return;
		}
		this.mathFontsHookInstalled = true;
		const fonts = (
			window.document as unknown as {
				fonts?: {
					addEventListener?: (type: string, listener: () => void) => void;
					removeEventListener?: (type: string, listener: () => void) => void;
				};
			}
		).fonts;
		if (!fonts?.addEventListener) {
			return;
		}
		const onFontsLoaded = (): void => this.remeasureSettledContentNodes();
		fonts.addEventListener('loadingdone', onFontsLoaded);
		this.register(() => {
			fonts.removeEventListener?.('loadingdone', onFontsLoaded);
		});
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
			isEditingText: () =>
				this.engine.isEditingText() || isInlineNodeEditing(this.mindMap),
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
			// 节点内联内容（方案 B 原型）：含行内链接 / 轻标记、或超长文本（引擎的
			// SVG 换行是逐字符二次复杂度，长行必须接管）且无图的节点改走自绘 HTML；
			// 其余节点返回 null 走引擎默认文本（点击跳转复用 view-wikilink 既有分流）
			createNodeContent: (node, doc, style, lang) => {
				// 宽度手柄门禁（幂等）：纯文本/含图节点上的拖宽手柄是死的
				// （引擎文本路径不认 customTextWidth），只留在自绘节点上
				gateNodeWidthHandles(node);
				// 选项对象与闭包见 inlineContentOptions（实例级一次构造；
				// 其中 isResolvedLink 注入未解析链接弱化、renderMath 走官方
				// loadMathJax 通道并携带定稿回调——批次执行时经 findNodeByDom
				// 解析真实节点再重排，构建期闭包可能持有预测量代理，见 K88）。
				// `selfDrawPlain` 是唯一与设置相关且会话中可变的项：就地覆盖
				// （构建为同步路径，无并发窗口）
				this.inlineContentOptions.selfDrawPlain =
					this.plugin.settings.selfDrawPlainNodes;
				return buildInlineNodeContent(
					node,
					doc,
					style,
					lang,
					this.inlineContentOptions,
				);
			},
			// 导出 SVG 后处理链（按序应用）：foreignObject 几何余量（几何校正
			// 最先落地——`<img>` 解码环境与主文档存在 ~2px 级文本度量偏差，
			// 临界节点会换行被裁，加宽/加高兜底，见 K106）→ Obsidian CSS 变量
			// 注入（字体度量与屏上一致，修复多行节点/LaTeX 节点导出被裁）→
			// MathJax 字形样式注入 → 数学容器高度钉扎（K107——导出环境 MJX
			// 字体缺失使容器盒子膨胀 ~1.8 倍、下方文字下移压到节点底边框线，
			// 钉为屏上实测高度使纵向流一致）→ 复制按钮隐身。后处理项分居
			// platform 与 features，services 层不依赖 features（K51），故链在
			// 组合根装配后注入。
			exportSvgTransforms: [
				padForeignObjectsForExport,
				injectObsidianCssVarsIntoExportSvg,
				injectMathStylesIntoExportSvg,
				pinMathContainerHeightsInExportSvg,
				hideCopyButtonsInExportSvg,
			],
			onRootDataChanged: () => {
				this.scheduleSave();
				updateStatusBar(this);
				this.titleRenamer.schedule();
			},
			onDataChanged: () => this.scheduleAutoSplitCheck(),
			onNodeTextEdited: (node) => captureAutoSplitCandidate(this, node),
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
				// 节点内代码块的复制按钮（悬停显形 → 点击复制 → ✓ 反馈）
				registerCodeBlockInteractions(this);
				// 画布视口手势（Ctrl+滚轮缩放 / 滚轮平移 / 中键拖）：对齐官方 Canvas
				setupViewportGestures(this);
				// 双击画布空白 → 在根节点下新建（官方 Canvas「双击画布新建卡片」）
				setupCanvasQuickCreate(this);
				// 自绘（富）节点的双击编辑兜底（引擎编辑框对自绘节点静默 no-op）
				setupNodeTextEditFallback(this);
				setupImageResize(this);
				setupDragTargetAssist(this);
				// 拖左右边框改宽结束 → 重建自绘内容（节点高度方能跟随新宽度）
				setupNodeWidthRefresh(this);
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

	override async onLoadFile(file: TFile): Promise<void> {
		// P0 同文件互斥（2026-09-28 加固）：同一 .mindmap.md 只允许一个
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
					(other.loadingFilePath ?? other.file?.path) === file.path
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
				} catch {
					// 摘除失败（leaf 已被外部关闭等）：保留空态即可
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
			this.whenReady.then(() => 'ready' as const),
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
		this.pendingImageCorrections = null;
		// 数学重测节点同属本引擎：随引擎销毁一并丢弃（否则跨文件累积持有旧节点）
		this.contentRemeasureNodes.clear();
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
			void collectImageSizeCorrections(tree)
				.then((corrections) => {
					// 加载期间文件已切换：丢弃过期结果
					if (this.loadingFilePath !== file.path) {
						return;
					}
					this.pendingImageCorrections = corrections;
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
		const corrections = this.pendingImageCorrections;
		const mindMap = this.mindMap;
		if (
			!corrections ||
			corrections.length === 0 ||
			!mindMap ||
			!getRenderRoot(mindMap)
		) {
			return false;
		}
		this.pendingImageCorrections = null;
		applyImageSizeCorrectionsToEngine(mindMap, corrections);
		return true;
	}

	/** 引擎就绪收尾：同步布局/连线样式选择器；md 模式重建工具栏补返回按钮 */
	private onEngineReady(layout: string, lineStyle: string): void {
		// 数学重测集合换新：引擎（重）建后节点对象全部是新实例，旧引用已随上一
		// 个引擎销毁而失效——不清则 ① 旧节点被长期持有（换文件/设置刷新累积成
		// 内存泄漏）；② 字体钩子会对**已销毁**的节点调重测（2026-09-28 复核修复）。
		// 只清集合、不触发任何重排（K88 禁止全树重排的约束不变）。
		this.contentRemeasureNodes.clear();
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
				if (this.applyPendingImageCorrections()) {
					this.engine.scheduleViewportRecenter();
				}
				// 渲染完成后重试「渲染窗口内未解析的数学 holder」（K104）：
				// 此刻 renderer.root 已回填，holder 与产物两条解析路径恢复可用
				this.retryDeferredContentRemeasure();
			});
		}
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
			// 主题偏好（默认/强制亮/强制暗）变更 → 引擎原地换 themeConfig
			this.applyTheme();
		}
		if (
			changedKeys.has('performanceMode') ||
			changedKeys.has('performanceThreshold')
		) {
			// 性能模式开关/阈值变更 → 引擎运行时切换虚拟渲染（不重建实例）
			this.engine.applyPerformance(
				this.plugin.settings.performanceMode,
				this.plugin.settings.performanceThreshold,
			);
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
		this.cancelAutoSplitCheck();
		this.autoSplitTimer = window.setTimeout(() => {
			this.autoSplitTimer = null;
			runAutoSplitCheck(this);
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
	 * 打开节点超链接（wiki / http / 库内路径 / 库外 file://）—— 委托 view-link-navigator。
	 * 保留 MindMapViewContext 接口契约（engine-controller / view-wikilink 依赖）。
	 */
	openHyperlink(link: string, mode: HyperlinkOpenMode = 'current'): void {
		linkNavigatorOpen(this, link, mode);
	}

	updateReferencesOnRename(file: TFile, oldPath: string): void {
		// 对齐官方设置「自动更新内部链接」（默认开启）：关闭后重命名不再改写引用
		// ——引用会变成未解析链接，与 Obsidian 关掉该设置后其它笔记的表现一致；
		// 但官方关掉后是**逐个提示**是否更新（Settings.md：be prompted to update
		// links after renaming），静默跳过等于用户无从知晓，故在此告知。
		if (!this.plugin.settings.autoUpdateLinks) {
			this.notifyReferencesKept(file, oldPath, 'common.linksNotUpdatedOnRename');
			return;
		}
		if (this.engine.updateReferencesOnRename(file, oldPath)) {
			this.scheduleSave();
		}
	}

	updateReferencesOnDelete(file: TFile): void {
		// 同上：关闭后既不改写链接、也不清理附件引用与内嵌图片
		if (!this.plugin.settings.autoUpdateLinks) {
			this.notifyReferencesKept(file, file.path, 'common.linksNotUpdatedOnDelete');
			return;
		}
		if (this.engine.removeReferencesOnDelete(file)) {
			this.scheduleSave();
		}
	}

	/**
	 * 「引用保持不变」的告知（仅在**本图确有可能的引用**时提示——无关文件的
	 * 重命名/删除不该弹提示；判据与引用更新的短路预检同源）。
	 */
	private notifyReferencesKept(
		file: TFile,
		oldPath: string,
		key: TranslationKey,
	): void {
		if (!this.engine.hasReferencesFor(file, oldPath)) {
			return;
		}
		new Notice(tf(this.lang, key, { name: file.name }));
	}

	override async onClose(): Promise<void> {
		this.engine.invalidateInit();
		this.cancelPendingInit();
		// 关闭后不再允许任何加载结果被应用（rAF 守卫依赖该字段）
		this.loadingFilePath = null;
		this.savePipeline.cancelTimer();
		this.cancelAutoSplitCheck();
		this.resizeThrottler.cancel();
		this.titleRenamer.cancel();
		cancelStatusBarUpdate(this);
		// 交互会话收尾（拖拽换父 / 图片调宽）：会话期间的临时 window 监听
		// 不经事件绑定器记录，中途关闭视图收不到 mouseup，须显式清理。
		// 必须在 savePipeline.save() 之前——调宽会话收尾会调度一次保存。
		teardownDragTargetAssist(this);
		teardownImageResize(this);
		// 挂起装配信号：关闭后到达的 onLoadFile 等待下一次 onOpen（原轮询语义）
		this.whenReady = new Promise(() => {});
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
		// 留着会一直持有已销毁的节点对象（同 onUnloadFile / onEngineReady）
		this.contentRemeasureNodes.clear();
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
		this.resizeThrottler.run(() => this.engine.resize());
	}
}
