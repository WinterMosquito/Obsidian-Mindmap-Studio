/**
 * 引擎控制器：simple-mind-map 实例的生命周期与防腐收口（EngineAdapter 职责）。
 * 从 view.ts 拆出（第 4 步）。
 *
 * - 引擎创建/销毁、初始化代际锁与零尺寸等待（ResizeObserver 事件驱动）、
 *   主题/布局切换、视口持久化、引用更新预检在此收口；
 * - 对引擎内部的直接访问（renderer.textEdit / renderer.root / view 变换）
 *   全部封装为显式方法（isEditingText / getRootText / 视口存取），
 *   视图层不再触碰引擎内部结构；
 * - 交互特性装配（拖拽/粘贴/右键/wikilink）通过 setupFeatures 回调交还视图。
 */
import { Notice } from 'obsidian';
import {
	MindMap,
	MindMapNode,
	MindMapTreeNode,
} from '../../vendor/simple-mind-map.cjs';
import {
	applyPerformanceMode,
	arrangeMindMap,
	cancelEngineTimers,
	centerContentAtFullScale,
	countTreeNodes,
	createMindMap,
	destroyMindMap,
	fitMindMap,
	getRenderRoot,
	getRootText,
	getThemeConfig,
	isContentVisibleInCanvas,
	isDarkTheme,
	isEditingText,
	replaceMindMapData,
} from '../engine/mindmap';
import { shouldEnablePerformanceMode } from '../core/constants';
import type { NodeContentStyle } from '../engine/mindmap';
import { ensureUniqueUids } from '../markdown/markdown';
import { nodeReferenceMatches } from '../core/node-data';
import {
	removeReferencesOnDelete,
	updateReferencesOnRename,
} from '../links/links-tree';
import { walkTree } from '../domain/tree';
import { EventBinder } from '../core/event-binder';
import { t } from '../core/i18n';
import type { App, TFile } from 'obsidian';
import type { Language } from '../core/i18n';
import type { MindMapNodeData } from '../../vendor/simple-mind-map.cjs';
import type { ViewStateStore } from './view-state';

/** 引擎创建选项（设置读取与布局 fallback 由视图负责） */
interface EngineSetupOptions {
	layout: string;
	/** 连线样式偏好（auto/curve/direct/straight；auto＝随布局） */
	lineStyle: string;
	themePref: string;
	enableDrag: boolean;
	performanceMode: boolean;
	performanceThreshold: number;
}

/** 引擎控制器依赖（窄化回调注入，不持有视图引用） */
export interface EngineControllerDeps {
	app: App;
	/** 引擎挂载容器（视图 DOM 就绪前为 null） */
	getCanvasEl(): HTMLElement | null;
	/** 视图当前文件（视口持久化按文件路径存取） */
	getFile(): TFile | null;
	getLang(): Language;
	/** 当前是否深色主题（css-change 后由视图重算并通知） */
	isDark(): boolean;
	/** 引擎创建选项（含本次布局，视图负责 fallback 与会话回写） */
	getSetupOptions(): EngineSetupOptions;
	/** 布局/视口持久化存储（按文件路径，存插件 data.json） */
	viewState: ViewStateStore;
	/** 引擎超链接点击跳转（onHyperlinkJump 回调） */
	openHyperlink(link: string): void;
	/**
	 * 节点内联内容渲染（方案 B 原型）：返回元素则**完全接管**该节点内容
	 * （引擎跳过默认文本/图标渲染，元素包进 foreignObject 并按离屏克隆测宽）；
	 * 返回 null 的节点走引擎默认 SVG 文本。缺省 = 全部节点走默认渲染。
	 *
	 * 声明为**函数属性**（而非方法语法）：该回调没有 `this` 语义，方法语法在
	 * 透传给引擎时会触发 unbound-method。
	 */
	createNodeContent?:
		| ((
				node: MindMapNode,
				doc: Document,
				style: NodeContentStyle,
				lang: Language,
		  ) => HTMLElement | null)
		| null;
	/** 根数据变更（→ 防抖保存 + 状态栏计数 + 标题重命名调度） */
	onRootDataChanged(): void;
	/**
	 * 引擎数据变更后的附加通知（视图侧：混排双链自动拆分检查）。
	 * 与 onRootDataChanged 同一事件源，但职责不同（后者是保存/状态，本项是内容变换）。
	 */
	onDataChanged(): void;
	/**
	 * 节点文本被编辑（引擎 node_text_edit_change：编辑框 input/paste 时发出，
	 * payload 含节点）。视图侧累积「自动拆分候选」——检查对象为编辑期捕获的
	 * 节点集，而非检查时刻的激活节点（快速切换激活不漏拆）。
	 */
	onNodeTextEdited(node: MindMapNode): void;
	/** 节点图片点击（拖拽抑制在本控制器内处理） */
	onNodeImageClick(node: MindMapNode): void;
	/** 附件图标点击（双链指向附件：引擎 node_attachmentClick 事件，打开目标） */
	onNodeAttachmentClick(node: MindMapNode): void;
	/** 引擎就绪后装配交互特性（拖拽/粘贴/右键/wikilink） */
	setupFeatures(): void;
	/** 引擎就绪后视图侧收尾（工具栏布局/连线样式同步、md 模式工具栏重建） */
	onEngineReady(layout: string, lineStyle: string): void;
	/** 引用更新完成（→ 防抖保存） */
	onReferencesChanged(): void;
}

/** 节点图片点击的拖拽抑制窗口（拖拽落点在图片上时浏览器仍触发 click） */
const IMAGE_CLICK_DRAG_SUPPRESS_MS = 300;
/** 首帧后恢复视口的延迟（等待引擎完成首次布局） */
const VIEWPORT_RESTORE_DELAY_MS = 150;
/**
 * 首帧几何晚到变化（图片尺寸回灌等）后的补居中延迟。
 * 必须大于 VIEWPORT_RESTORE_DELAY_MS：补居中要在默认视口设置之后才判定签名。
 */
const VIEWPORT_RECENTER_DELAY_MS = 200;

export class EngineController {
	/** 引擎实例作用域的事件绑定器（initMindMap 时注册，destroy 一次性清理） */
	readonly engineEvents = new EventBinder();
	/** 当前引擎实例（视图经只读转发暴露给 view-* 模块） */
	mindMap: MindMap | null = null;

	/**
	 * 引擎初始化代际锁：每次新的 initMindMap 请求或视图卸载都会递增，
	 * 使之前的零尺寸等待作废——初始化只允许在「仍是最近一次请求」
	 * 且视图仍挂载时执行，避免文件切换/视图关闭后过期 tree 被渲染，
	 * 进而把旧文件内容写进新文件。
	 */
	private initSeq = 0;
	/**
	 * 零尺寸等待的 ResizeObserver：容器暂时不可见（后台叶/折叠面板）时
	 * 挂观察器等待尺寸就绪，尺寸恢复（叶被激活/展开）时事件驱动初始化。
	 * 替代此前的 200ms 定时轮询——轮询对长期隐藏的叶形成常驻定时器
	 * （隐藏的 Obsidian 叶不是后台标签页，浏览器不节流）。观察器在
	 * 代际作废/引擎销毁时断开，不会跨生命周期泄漏。
	 */
	private initObserver: ResizeObserver | null = null;
	/** 上次节点拖拽结束时间（拖拽后误触 click 的灯箱抑制） */
	private lastNodeDragEndAt = 0;
	/** 首帧后的视口恢复定时器（销毁/作废时取消，避免对已销毁引擎求值） */
	private viewportTimer: number | null = null;
	/**
	 * 补居中定时器（图片尺寸回灌等首帧后才落定的几何变化）。
	 * 仅当打开时设置的是默认视口（未恢复保存视口、用户未移动）时才生效。
	 */
	private recenterTimer: number | null = null;
	/**
	 * 默认视口签名（scale|x|y；null＝无默认视口：已恢复保存视口、用户已移动
	 * 或读取失败）。补居中据此判定「当前视口是否仍是打开时自动设置的那个」。
	 */
	private defaultViewSignature: string | null = null;
	/**
	 * 首帧窗口剩余的「默认视口重算」次数：引擎布局把根节点摆在与画布尺寸
	 * 相关的位置（initRootNodePosition 默认 [center,center]），首次布局与
	 * resize 触发的再布局都会让内容整体位移——窗口内每次布局落地都重算
	 * （见 renderMindMap）。用尽即停手：之后的重渲染不再抢视口。
	 */
	private initialViewportRecalcBudget = 0;
	/**
	 * 本会话打开时恢复了用户保存的视口：停用一切自动化视口干预
	 * （首帧重算、落界校验回退、补居中），绝不覆盖用户的缩放/平移。
	 */
	private restoredSavedViewport = false;

	constructor(private readonly deps: EngineControllerDeps) {}

	/**
	 * 初始化引擎（挂载点尺寸就绪前经 ResizeObserver 等待）。
	 * 每次新的初始化请求递增代际，令旧的零尺寸等待作废。观察器回调与
	 * 本入口共用同一代际 + isConnected 双重守卫：文件切换（onUnloadFile/
	 * 新的 initMindMap）或视图关闭（onClose）都会让旧请求静默退出，
	 * 杜绝过期 tree 覆盖当前文件内容。
	 */
	initMindMap(tree: MindMapTreeNode): void {
		const canvasEl = this.deps.getCanvasEl();
		if (!canvasEl) {
			return;
		}
		const seq = ++this.initSeq;
		this.disconnectInitObserver();
		// 尺寸就绪即同步创建；0 尺寸（后台叶/折叠面板）转观察器等待
		if (this.tryRender(tree, seq)) {
			return;
		}
		const observer = new ResizeObserver(() => {
			if (this.initSeq !== seq) {
				observer.disconnect();
				return;
			}
			// 容器已被替换/脱离 DOM：本次请求作废
			const el = this.deps.getCanvasEl();
			if (!el || !el.isConnected) {
				observer.disconnect();
				return;
			}
			if (this.tryRender(tree, seq)) {
				observer.disconnect();
			}
			// 仍为 0 尺寸：保持观察，等待下一次尺寸变化（无轮询）
		});
		this.initObserver = observer;
		observer.observe(canvasEl);
	}

	/**
	 * 尺寸就绪时创建引擎（同步），否则返回 false 交由观察器等待。
	 * 统一承载代际 + isConnected 守卫，供初始尝试与观察器回调共用。
	 */
	private tryRender(tree: MindMapTreeNode, seq: number): boolean {
		const el = this.deps.getCanvasEl();
		if (!el || !el.isConnected || this.initSeq !== seq) {
			return false;
		}
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			return false;
		}
		this.renderMindMap(tree);
		return true;
	}

	/** 断开零尺寸等待的观察器（新请求接管 / 视图卸载 / 引擎销毁时） */
	private disconnectInitObserver(): void {
		this.initObserver?.disconnect();
		this.initObserver = null;
	}

	/** 引擎实际创建（仅在 initMindMap 的守卫通过后调用一次） */
	private renderMindMap(tree: MindMapTreeNode): void {
		const canvasEl = this.deps.getCanvasEl();
		if (!canvasEl) {
			return;
		}
		try {
			// 修复缺失/重复的 uid（避免引擎按 uid 查找节点时误删/漏删）
			ensureUniqueUids(tree);
			this.destroyInstance();
			canvasEl.empty();
			const options = this.deps.getSetupOptions();
			/** 节点内联内容渲染器（缺省 = 不开启引擎自绘节点内容通道） */
			const nodeContentRenderer = this.deps.createNodeContent ?? null;
			this.mindMap = createMindMap(canvasEl, tree, {
				layout: options.layout,
				lineStyle: options.lineStyle,
				themePref: options.themePref,
				isDark: this.deps.isDark(),
				enableDrag: options.enableDrag,
				performanceMode: options.performanceMode,
				performanceThreshold: options.performanceThreshold,
				lang: this.deps.getLang(),
				onHyperlinkJump: (link) => this.deps.openHyperlink(link),
				// 节点内联内容（方案 B 原型）：缺省时引擎两键为 false/null，全部走默认文本。
				// 包一层箭头：方法引用脱离对象会触发 unbound-method（deps 未持有 this 语义）
				createNodeContent: nodeContentRenderer
					? (node, doc, style, lang) =>
							nodeContentRenderer(node, doc, style, lang)
					: null,
			});
			this.engineEvents.onEngine(this.mindMap, 'data_change', () => {
				this.deps.onRootDataChanged();
				this.deps.onDataChanged();
			});
			// 编辑框输入/粘贴：payload 含节点（data_change 不带节点，无法识别
			// 「哪个节点被编辑」）——自动拆分的候选捕获源（防腐：此处取 payload 节点）
			this.engineEvents.onEngine(
				this.mindMap,
				'node_text_edit_change',
				(...args: unknown[]) => {
					const node = (args[0] as { node?: unknown } | undefined)?.node;
					if (node) {
						this.deps.onNodeTextEdited(node as MindMapNode);
					}
				},
			);
			// 点击节点图片 → 全屏查看（灯箱）
			this.engineEvents.onEngine(
				this.mindMap,
				'node_img_click',
				(...args: unknown[]) => {
					const node = args[0] as MindMapNode | undefined;
					if (!node) {
						return;
					}
					// 拖拽刚结束（落点仍在图片上）时浏览器仍会触发 click：
					// 忽略，避免拖拽节点后误开灯箱
					if (
						Date.now() - this.lastNodeDragEndAt <
						IMAGE_CLICK_DRAG_SUPPRESS_MS
					) {
						return;
					}
					this.deps.onNodeImageClick(node);
				},
			);
			this.engineEvents.onEngine(this.mindMap, 'node_dragend', () => {
				this.lastNodeDragEndAt = Date.now();
			});
			// 附件图标点击（双链指向附件）：引擎仅派发事件不自行打开，
			// 由视图按 Obsidian 语义打开目标（ Obsidian 可渲染开标签页 /
			// 系统媒体走系统应用，与 openHyperlink 同一路由）
			this.engineEvents.onEngine(
				this.mindMap,
				'node_attachmentClick',
				(...args: unknown[]) => {
					const node = args[0] as MindMapNode | undefined;
					if (!node) {
						return;
					}
					this.deps.onNodeAttachmentClick(node);
				},
			);
			// 布局落地即应用视口（**本帧内**）：引擎默认 initRootNodePosition=
			// [center,center]，首次布局把**根节点**摆在画布中心——不在布局任务里
			// 纠正，用户会先看到「根居中」、150ms 兜底时才跳成「整体居中」。
			// 该事件在引擎布局任务内发出（renderer.render 是 setTimeout(0) →
			// _render），与布局同帧提交，浏览器不会绘制中间态；再布局（resize
			// 会按新画布尺寸重摆根节点、图片回灌会改节点尺寸）也按此重算。
			// 重算次数由 initialViewportRecalcBudget 限定，用尽即停手。
			this.initialViewportRecalcBudget = 2;
			this.engineEvents.onEngine(
				this.mindMap,
				'node_tree_render_end',
				() => {
					if (
						this.restoredSavedViewport ||
						this.initialViewportRecalcBudget <= 0
					) {
						return;
					}
					const applied = this.defaultViewSignature;
					if (applied !== null && this.viewSignature() !== applied) {
						// 视口已不是打开时自动设置的那个（用户平移/缩放）：停手
						this.initialViewportRecalcBudget = 0;
						return;
					}
					this.initialViewportRecalcBudget--;
					this.restoreOrFitViewport();
				},
			);
			this.mindMap.render();
			this.deps.setupFeatures();
			this.deps.onEngineReady(options.layout, options.lineStyle);
			// 兜底：布局晚变（工具栏重建、工作区 settle）而不再有布局事件时，
			// 最后再应用一次（与布局事件里那次幂等：几何未变则平移量为 0）；
			// 并补一次重算预算，覆盖本次 resize 触发的再布局。
			this.cancelViewportTimer();
			this.viewportTimer = window.setTimeout(() => {
				this.viewportTimer = null;
				this.initialViewportRecalcBudget = Math.max(
					this.initialViewportRecalcBudget,
					1,
				);
				this.restoreOrFitViewport();
			}, VIEWPORT_RESTORE_DELAY_MS);
		} catch (error) {
			// 畸形树/引擎内部异常：记录并保持视图可用，避免异常逃逸出回调
			console.error('渲染思维导图失败:', error);
			this.destroyInstance();
			this.deps.getCanvasEl()?.empty();
			new Notice(`${t(this.deps.getLang(), 'common.notLoaded')}`);
		}
	}

	/** 重建引擎实例（设置变更后调用）：深拷贝当前树后走完整初始化 */
	refresh(): void {
		if (!this.mindMap) {
			return;
		}
		// 深拷贝后重建：initMindMap 会先销毁旧引擎并原地改写 uid（ensureUniqueUids），
		// 传活引用会在销毁期间被就地修改（依赖旧引擎不再回写该对象），存在隐患。
		const data = structuredClone(this.mindMap.getData());
		this.initMindMap(data);
	}

	/** 销毁引擎实例并清理其作用域的全部 DOM/引擎事件 */
	destroyInstance(): void {
		this.disconnectInitObserver();
		this.cancelViewportTimer();
		this.cancelRecenterTimer();
		this.defaultViewSignature = null;
		this.initialViewportRecalcBudget = 0;
		this.restoredSavedViewport = false;
		this.engineEvents.destroy();
		// 在途延时任务（延时 fit / 渲染根轮询链 / 文本编辑宏任务）先取消：
		// 它们的闭包会触碰引擎实例，销毁后到期会在空实例上白跑（轮询链还会续排）。
		cancelEngineTimers(this.mindMap);
		destroyMindMap(this.mindMap);
		this.mindMap = null;
		this.deps.getCanvasEl()?.empty();
	}

	/** 作废尚未执行的初始化等待（文件切换/视图关闭时） */
	invalidateInit(): void {
		this.initSeq++;
		this.disconnectInitObserver();
		this.cancelViewportTimer();
		this.cancelRecenterTimer();
		this.defaultViewSignature = null;
		this.initialViewportRecalcBudget = 0;
		this.restoredSavedViewport = false;
	}

	/** 取消首帧后的视口恢复（幂等） */
	private cancelViewportTimer(): void {
		if (this.viewportTimer !== null) {
			window.clearTimeout(this.viewportTimer);
			this.viewportTimer = null;
		}
	}

	/** 取消挂起的补居中（幂等） */
	private cancelRecenterTimer(): void {
		if (this.recenterTimer !== null) {
			window.clearTimeout(this.recenterTimer);
			this.recenterTimer = null;
		}
	}

	/**
	 * 应用布局（仅引擎侧；会话字段与持久化由视图负责）。
	 * 切换后同步重算主题配置：auto 偏好下连线样式随布局联动
	 * （组织结构图走直线，见 mindmap-theme.resolveLineStyle）；布局名以本次
	 * 入参为准，不依赖视图会话字段（切换瞬间两者可能尚未同步）。
	 */
	setLayout(value: string): void {
		if (!this.mindMap) {
			return;
		}
		this.mindMap.setLayout(value);
		const setup = this.deps.getSetupOptions();
		this.writeThemeConfig(value, setup.lineStyle, setup.themePref);
		// 切换后自动整理一次：清掉自由拖拽留下的自定义坐标（否则旧布局下手动摆过的
		// 节点会带着坐标留在新布局里），并以「适应画布」收尾（引擎 setLayout 内部
		// 会把视口变换归零，不 fit 会让画面停在左上角）。
		arrangeMindMap(this.mindMap);
	}

	/**
	 * 应用连线样式偏好（仅引擎侧；会话字段与持久化由视图负责）。
	 * 布局取当前会话值（工具栏同一事件循环内不会并发切换布局与样式）。
	 */
	setLineStyle(value: string): void {
		if (!this.mindMap) {
			return;
		}
		const setup = this.deps.getSetupOptions();
		this.writeThemeConfig(setup.layout, value, setup.themePref);
	}

	/**
	 * 应用性能模式设置（开关 / 阈值变更）：**运行时切换，不重建实例**。
	 *
	 * 引擎显式支持（`after_update_config` 会在 `openPerformance` 变化时绑定/解绑
	 * `view_data_change` 处理器并 `forceLoadNode`，见 `applyPerformanceMode`），
	 * 故省掉「整树 structuredClone + 引擎销毁重建 + 视口重设」——性能阈值是设置
	 * 面板里的滑块（唯一高频拖拽项），这条路径的收益最直接。
	 *
	 * 阈值判据与创建期同源（`shouldEnablePerformanceMode`）；节点数按**渲染树**
	 * 统计（性能模式下节点实例仍留在 `parent.children`，计数准确，见 count 探针）。
	 */
	applyPerformance(
		performanceMode: boolean,
		performanceThreshold: number,
	): void {
		const mindMap = this.mindMap;
		if (!mindMap) {
			return;
		}
		const root = getRenderRoot(mindMap);
		const nodeCount = root ? countTreeNodes(root) : 0;
		applyPerformanceMode(
			mindMap,
			shouldEnablePerformanceMode(
				nodeCount,
				performanceMode,
				performanceThreshold,
			),
		);
	}

	/** 应用主题（深色判定按当前主题偏好重算；连线样式随偏好与布局） */
	applyTheme(): void {
		if (!this.mindMap) {
			return;
		}
		const setup = this.deps.getSetupOptions();
		this.writeThemeConfig(setup.layout, setup.lineStyle, setup.themePref);
	}

	/** 按布局 + 连线样式偏好 + 主题偏好重算主题配置并写入引擎 */
	private writeThemeConfig(
		layout: string,
		lineStyle: string,
		themePref: string,
	): void {
		if (!this.mindMap) {
			return;
		}
		const dark = isDarkTheme(themePref, this.deps.isDark());
		this.mindMap.setThemeConfig(getThemeConfig(dark, layout, lineStyle));
	}

	resize(): void {
		this.mindMap?.resize();
	}

	/** 当前树快照（引擎已销毁时为 null） */
	getDataSnapshot(): MindMapTreeNode | null {
		return this.mindMap?.getData() ?? null;
	}

	/** 用户是否正在节点文本编辑框内打字（防腐收口在 mindmap.isEditingText） */
	isEditingText(): boolean {
		return isEditingText(this.mindMap);
	}

	/** 根（中心主题）节点文本（防腐收口在 mindmap.getRootText） */
	getRootText(): string | null {
		return getRootText(this.mindMap);
	}

	/** 持久化当前视口（关闭/卸载/切回 Markdown 前调用） */
	persistViewport(): void {
		const file = this.deps.getFile();
		if (file && this.mindMap?.view) {
			try {
				this.deps.viewState.setView(
					file.path,
					this.mindMap.view.getTransformData(),
				);
			} catch (error) {
				// 引擎尚未就绪等场景：仅记录。视口丢失不影响文档内容，
				// 不打扰用户（下次打开退回 fit 全图）。
				console.warn('持久化视口失败:', error);
			}
		}
	}

	/**
	 * 打开后恢复保存的视口；无则默认 100% + 整体内容包围盒居中（大图可读）。
	 *
	 * 居中/适配的几何换算在 mindmap 侧先同步到实时容器：首帧后工作区布局
	 * settle、工具栏重建都会让引擎缓存尺寸失真，是「打开即偏移」的根源。
	 */
	private restoreOrFitViewport(): void {
		const file = this.deps.getFile();
		const mindMap = this.mindMap;
		if (!file || !mindMap) {
			return;
		}
		const savedView = this.deps.viewState.getView(file.path);
		try {
			if (savedView) {
				mindMap.view.setTransformData(savedView);
				// 保存的变换按当时的容器/内容记录：尺寸大改或内容布局变化后
				// 恢复它可能把内容推出画布（打开即空白）。明确判定不可见时
				// 放弃恢复、回退默认居中；无法判定则保持（fail-open）。
				if (isContentVisibleInCanvas(mindMap) === false) {
					centerContentAtFullScale(mindMap);
					this.defaultViewSignature = this.viewSignature();
					this.restoredSavedViewport = false;
				} else {
					// 恢复的是用户自己的视口：禁用补居中与首帧重算，不覆盖
					this.defaultViewSignature = null;
					this.restoredSavedViewport = true;
				}
			} else {
				centerContentAtFullScale(mindMap);
				this.defaultViewSignature = this.viewSignature();
				this.restoredSavedViewport = false;
			}
		} catch (error) {
			console.error('恢复视图状态失败', error);
			fitMindMap(mindMap);
			this.defaultViewSignature = null;
			this.restoredSavedViewport = false;
		}
	}

	/**
	 * 排一次「补居中」：图片尺寸回灌等**首帧之后**才落定的几何变化会改动
	 * 内容包围盒，令首帧居中失效（打开即偏移、点适应画布才回正）。
	 *
	 * 仅对打开时自动设置的默认视口生效：已恢复保存视口、或用户已自行平移/
	 * 缩放（视口签名变化）时跳过，绝不覆盖用户操作。多次调用自动去重。
	 */
	scheduleViewportRecenter(): void {
		if (!this.mindMap) {
			return;
		}
		this.cancelRecenterTimer();
		this.recenterTimer = window.setTimeout(() => {
			this.recenterTimer = null;
			const signature = this.defaultViewSignature;
			const mindMap = this.mindMap;
			if (!mindMap || signature === null || this.restoredSavedViewport) {
				return;
			}
			if (this.viewSignature() !== signature) {
				// 用户已移动/缩放视口：不打扰
				this.defaultViewSignature = null;
				return;
			}
			// 几何可能又变（图片落定、容器 settle）：重新对齐后居中
			centerContentAtFullScale(mindMap);
			this.defaultViewSignature = this.viewSignature();
		}, VIEWPORT_RECENTER_DELAY_MS);
	}

	/** 当前视口签名（scale|x|y；读取失败返回 null） */
	private viewSignature(): string | null {
		const mindMap = this.mindMap;
		if (!mindMap?.view) {
			return null;
		}
		try {
			const state = mindMap.view.getTransformData().state as unknown as {
				scale?: unknown;
				x?: unknown;
				y?: unknown;
			};
			const scale = Number(state.scale);
			const x = Number(state.x);
			const y = Number(state.y);
			if (
				!Number.isFinite(scale) ||
				!Number.isFinite(x) ||
				!Number.isFinite(y)
			) {
				return null;
			}
			return `${scale}|${x}|${y}`;
		} catch (error) {
			console.warn('读取视口签名失败', error);
			return null;
		}
	}

	/**
	 * 文件重命名后，更新引擎树中对旧文件的引用（图片、附件与 [[链接]]）。
	 * 返回是否有变更（由调用方触发保存）。
	 */
	updateReferencesOnRename(file: TFile, oldPath: string): boolean {
		if (!this.mindMap) {
			return false;
		}
		// 性能：渲染器树预检（零拷贝），无关文件的重命名直接跳过，
		// 避免每次全库重命名都对每个打开的导图做深拷贝 + 全量重渲染。
		if (!this.rendererTreeHasMatchingRef(file, oldPath)) {
			return false;
		}
		const tree = this.mindMap.getData();
		if (updateReferencesOnRename(tree, file, oldPath, this.deps.app)) {
			// 保留撤销历史（引擎 setData 会清空历史 → 之后 Ctrl+Z 永久失效）
			replaceMindMapData(this.mindMap, tree);
			return true;
		}
		return false;
	}

	/**
	 * 文件删除后，清除引擎树中对它的引用。
	 * 返回是否有变更（由调用方触发保存）。
	 */
	removeReferencesOnDelete(file: TFile): boolean {
		if (!this.mindMap) {
			return false;
		}
		// 性能：同 updateReferencesOnRename——预检零拷贝，无关文件删除直接跳过
		if (!this.rendererTreeHasMatchingRef(file, file.path)) {
			return false;
		}
		const tree = this.mindMap.getData();
		if (removeReferencesOnDelete(tree, file, this.deps.app)) {
			// 同上：走保留历史的替换入口，Ctrl+Z 仍可回退这次引用清理
			replaceMindMapData(this.mindMap, tree);
			return true;
		}
		return false;
	}

	/**
	 * 本图是否**可能**含指向该文件的引用（渲染器树快速预检，零拷贝）。
	 *
	 * 供「自动更新内部链接关闭时是否提示」使用：无关文件不打扰用户
	 * （与 updateReferencesOnRename / removeReferencesOnDelete 的短路同一判据）。
	 */
	hasReferencesFor(file: TFile, oldPath: string): boolean {
		return this.rendererTreeHasMatchingRef(file, oldPath);
	}

	/**
	 * 渲染器树快速预检：树内是否有任何节点的图片/附件/超链接可能指向
	 * 指定文件（重命名/删除）。命中才走 getData() 深拷贝 + 精确匹配 + setData 重渲染；
	 * 未命中（无关文件的重命名/删除）时零拷贝跳过。
	 * 子串匹配是保守近似（宁可误报触发精确路径，不可漏报导致引用残留）。
	 */
	private rendererTreeHasMatchingRef(file: TFile, oldPath: string): boolean {
		const root = getRenderRoot(this.mindMap);
		if (!root) {
			return false;
		}
		const oldBasename = (oldPath.split('/').pop() ?? '').replace(
			/\.[^.]+$/,
			'',
		);
		const needles = [
			file.name,
			oldPath,
			oldBasename,
			encodeURIComponent(file.name),
		];
		let found = false;
		walkTree(root, (node) => {
			// 零分配匹配（nodeReferenceMatches）：内联「无引用字段即不可能命中」的
			// 短路，不为每节点构造比对串——预检按全树调用、命中率通常为 0
			const data = node.getData() as MindMapNodeData;
			if (nodeReferenceMatches(data, needles)) {
				found = true;
				return false; // 命中即终止整树遍历
			}
			return undefined;
		});
		return found;
	}
}
