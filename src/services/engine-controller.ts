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
import type {
	MindMap,
	MindMapNode,
	MindMapNodeData,
	MindMapTreeNode,
} from '../core/engine-types';
import {
	applyThemeConfig,
	applyViewportState,
	arrangeMindMap,
	cancelEngineTimers,
	centerContentAtFullScale,
	createMindMap,
	destroyMindMap,
	fitMindMap,
	getRenderRoot,
	getRootText,
	getViewportSignature,
	isContentVisibleInCanvas,
	isEditingText,
	readViewportState,
	replaceMindMapData,
	resizeMindMap,
	syncHistoryLimit,
	viewStateSignature,
} from '../engine/mindmap';
import { createThrottler } from '../core/concurrency';
import { notifyError } from '../core/errors';
import { ensureUniqueUids } from '../markdown/markdown';
import { nodeReferenceMatches } from '../core/node-data';
import { encodedNameForm } from '../domain/url';
import { removeReferencesOnDelete } from '../links/links-tree';
import { renameReferencesInTree } from '../markdown/links-rename';
import { walkTree } from '../domain/tree';
import { EventBinder } from '../core/event-binder';
import { t } from '../core/i18n';
import type { TFile } from 'obsidian';
import type {
	EngineControllerDeps,
	EngineSetupOptions,
} from './engine-controller-deps';
import { ViewportSession } from './engine-controller-viewport';
import { buildCreateOptions } from './engine-controller-options';

// 依赖契约已拆到同模块的 `engine-controller-deps`，此处**转出**保持既有
// import 路径不变（`features/view.ts` 等按 `from './services/engine-controller'` 取类型）。
export type { EngineControllerDeps };

/** 节点图片点击的拖拽抑制窗口（拖拽落点在图片上时浏览器仍触发 click） */
const IMAGE_CLICK_DRAG_SUPPRESS_MS = 300;
/** 首帧后恢复视口的延迟（等待引擎完成首次布局） */
const VIEWPORT_RESTORE_DELAY_MS = 150;
/**
 * 首帧几何晚到变化（图片尺寸回灌等）后的补居中延迟。
 * 必须大于 VIEWPORT_RESTORE_DELAY_MS：补居中要在默认视口设置之后才判定签名。
 */
const VIEWPORT_RECENTER_DELAY_MS = 200;
/**
 * 命令历史上限会话内同步的节流窗口（毫秒）：`data_change` 在连续编辑/拖拽下
 * 高频（引擎 addHistory 自带 100ms 防抖），逐次全树计数没必要；窗口只限制
 * 计数频率，跨过档位才会真正 `updateConfig`（见 syncHistoryLimit）。
 */
const HISTORY_LIMIT_SYNC_THROTTLE_MS = 1000;

// 视口签名与视口状态的读写一律走引擎防腐层（`viewStateSignature` /
// `getViewportSignature` / `readViewportState` / `applyViewportState`）：本层
// 此前自持一份 `view.getTransformData().state` 读法，两套读数（此处 state 与
// 引擎层 transform）在改动时容易各改一边。

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
	/**
	 * 视口会话状态（定时器 / 默认签名 / 重算预算 / 恢复态 / 拖拽时戳）。
	 * 六个字段的三个读写时机（创建 / 销毁 / 交互）见
	 * `engine-controller-viewport.ts` 的文件头；本类只保留算法，状态一律经它读写。
	 */
	readonly viewport = new ViewportSession();
	/** 命令历史上限同步的节流器（随引擎生命周期，销毁时取消） */
	private readonly historyLimitThrottler = createThrottler(
		HISTORY_LIMIT_SYNC_THROTTLE_MS,
	);

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
			this.mindMap = createMindMap(canvasEl, tree, buildCreateOptions(this.deps, options));
			this.engineEvents.onEngine(this.mindMap, 'data_change', () => {
				this.deps.onRootDataChanged();
				this.deps.onDataChanged();
				// 会话内长大的图要让 30MB 历史上限预算随当前节点数收敛（创建期
				// 只反推一次；从空图长到 1000 节点仍留 500 条 ⇒ 最坏 ≈192MB）。
				// 节流 1s：data_change 高频，且跨档位才会真正 updateConfig。
				this.historyLimitThrottler.run(() => {
					if (this.mindMap) {
						syncHistoryLimit(this.mindMap);
					}
				});
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
						Date.now() - this.viewport.lastNodeDragEndAt <
						IMAGE_CLICK_DRAG_SUPPRESS_MS
					) {
						return;
					}
					this.deps.onNodeImageClick(node);
				},
			);
			this.engineEvents.onEngine(this.mindMap, 'node_dragend', () => {
				this.viewport.lastNodeDragEndAt = Date.now();
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
			this.viewport.beginInitialWindow();
			this.engineEvents.onEngine(
				this.mindMap,
				'node_tree_render_end',
				() => {
					// 判定与扣减在会话里（「是否还能重算」只有一份）
					if (this.viewport.canRecalcOnRender(this.viewSignature())) {
						this.restoreOrFitViewport();
					}
				},
			);
			this.mindMap.render();
			this.deps.setupFeatures();
			this.deps.onEngineReady();
			// 兜底：布局晚变（工具栏重建、工作区 settle）而不再有布局事件时，
			// 最后再应用一次（与布局事件里那次幂等：几何未变则平移量为 0）；
			// 并补一次重算预算，覆盖本次 resize 触发的再布局。
			this.viewport.cancelRestore();
			this.viewport.restoreTimer = window.setTimeout(() => {
				this.viewport.restoreTimer = null;
				this.viewport.recalcBudget = Math.max(
					this.viewport.recalcBudget,
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
		// 数据来源：引擎 `getData()` **本身已是深拷贝**（`command.getCopyData()`
		// → `copyRenderTree` + `simpleDeepClone`，契约由 tests/vendor-contract.test.ts
		// 钉住），initMindMap 内部还会再克隆一次（`handleData`）——2026-10-02 删除了
		// 此前的第三份 `structuredClone`（其注释声称「防传活引用被就地修改」，该论据
		// 在当前 vendor 行为下不成立；一轮重建原为 3 次全树拷贝）。
		//
		// 异常防护（2026-09-28 加固，保留）：与 initMindMap 内部同风格——记录并
		// **保留现有引擎可用**，不让异常逃逸出设置应用路径（重建失败远好过
		// 中断后续键的应用）。initMindMap 自身失败时由它内部处理（销毁+提示），
		// 此处不会重复兜底。
		try {
			this.initMindMap(this.mindMap.getData());
		} catch (error) {
			// 用户可感：设置已改但界面停在旧布局，无任何提示会被当成「设置没生效」
			//（AGENTS.md 决策表：静默跳过会让问题无痕退化）。
			console.error('重建引擎失败，保留当前实例', error);
			notifyError(this.deps.getLang(), 'common.refreshFailed', error);
		}
	}

	/** 销毁引擎实例并清理其作用域的全部 DOM/引擎事件 */
	destroyInstance(): void {
		this.disconnectInitObserver();
		this.viewport.reset();
		this.historyLimitThrottler.cancel();
		this.engineEvents.destroy();
		// 在途延时任务（延时 fit / 渲染根轮询链 / 文本编辑宏任务）先取消：
		// 它们的闭包会触碰引擎实例，销毁后到期会在空实例上白跑（轮询链还会续排）。
		cancelEngineTimers(this.mindMap);
		// 引擎归属登记（未定稿数学段）在销毁点清理：此刻该引擎的 holder 必然
		// 不会再挂载，而其他引擎（多视图 / 嵌入）的条目须原样保留 ⇒ 按实例
		// 身份精确清（语义见 deps.onEngineDisposed 与 platform/math-jax 的
		// unsettledMath）。放在 destroyMindMap 之前：实例引用仍有效，且
		// destroy 抛错也不至于把登记面留成孤儿。
		if (this.mindMap) {
			this.deps.onEngineDisposed?.(this.mindMap);
		}
		destroyMindMap(this.mindMap);
		this.mindMap = null;
		this.deps.getCanvasEl()?.empty();
	}

	/** 作废尚未执行的初始化等待（文件切换/视图关闭时） */
	invalidateInit(): void {
		this.initSeq++;
		this.disconnectInitObserver();
		this.viewport.reset();
	}

	// 取消两个视口定时器的方法已随状态移入 `ViewportSession`
	// （`cancelRestore` / `cancelRecenter`），此处不再保留转发壳。

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
		this.writeThemeConfig({ layout: value });
		// 切换后自动整理一次：清掉自由拖拽留下的自定义坐标（否则旧布局下手动摆过的
		// 节点会带着坐标留在新布局里）。**必须 fit**：引擎 setLayout 会把视口变换归零，
		// 不 fit 画面会停在左上角（用户手动「整理」走默认值，保留视口）。
		arrangeMindMap(this.mindMap, { fitView: true });
	}

	/**
	 * 应用连线样式偏好（仅引擎侧；会话字段与持久化由视图负责）。
	 * 布局取当前会话值（工具栏同一事件循环内不会并发切换布局与样式）。
	 */
	setLineStyle(value: string): void {
		if (!this.mindMap) {
			return;
		}
		this.writeThemeConfig({ lineStyle: value });
	}

	/** 应用主题（深色判定按当前主题偏好重算；连线样式随偏好与布局） */
	applyTheme(): void {
		if (!this.mindMap) {
			return;
		}
		this.writeThemeConfig();
	}

	/**
	 * 按「布局 + 连线样式 + 主题色 + 主题」重算主题配置并写入引擎。
	 *
	 * 入参只收**本次要覆盖的维度**：其余键从 `getSetupOptions` 现取，
	 * 调用方不必先取一份完整设置再 spread，也就不会顺手传进 `enableDrag`
	 * 这类与主题无关的键（写主题的函数不该知道拖拽开关）。
	 */
	private writeThemeConfig(
		overrides: Partial<Pick<EngineSetupOptions, 'layout' | 'lineStyle'>> = {},
	): void {
		const setup = { ...this.deps.getSetupOptions(), ...overrides };
		// 引擎内部写入收口在 mindmap.applyThemeConfig（视图与代码块嵌入共用）
		applyThemeConfig(this.mindMap, {
			isDark: this.deps.isDark(),
			themePref: setup.themePref,
			layout: setup.layout,
			lineStyle: setup.lineStyle,
			themeStyle: setup.themeStyle,
			palette: setup.palette,
		});
	}

	resize(): void {
		resizeMindMap(this.mindMap);
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
		if (!file) {
			return;
		}
		// 无引擎/引擎拒绝时返回 null：与旧实现一致，**不触碰**引擎（读取失败
		// 会在引擎层留痕）
		const state = readViewportState(this.mindMap);
		if (!state) {
			return;
		}
		try {
			this.deps.viewState.setView(file.path, state);
		} catch (error) {
			// 引擎尚未就绪等场景：仅记录。视口丢失不影响文档内容，
			// 不打扰用户（下次打开退回 fit 全图）。
			console.warn('持久化视口失败:', error);
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
				// 幂等短路（2026-10-02）：本函数在打开窗口至少被调两次（布局落地
				// 事件 + 150ms 兜底），而 setTransformData **无条件** emit
				// view_data_change——性能模式下该事件触发分片整树渲染（K70④ 给
				// center 分支加过同款短路，savedView 分支此前缺失）。签名
				// （scale|x|y）一致 = 当前已在保存视口上：只维持「恢复态」标记。
				const savedSignature = viewStateSignature(
					(savedView as { state?: unknown }).state,
				);
				if (
					savedSignature !== null &&
					savedSignature === this.viewSignature()
				) {
					this.viewport.defaultSignature = null;
					this.viewport.restoredSaved = true;
					return;
				}
				applyViewportState(mindMap, savedView);
				// 保存的变换按当时的容器/内容记录：尺寸大改或内容布局变化后
				// 恢复它可能把内容推出画布（打开即空白）。明确判定不可见时
				// 放弃恢复、回退默认居中；无法判定则保持（fail-open）。
				if (isContentVisibleInCanvas(mindMap) === false) {
					centerContentAtFullScale(mindMap);
					this.viewport.defaultSignature = this.viewSignature();
					this.viewport.restoredSaved = false;
				} else {
					// 恢复的是用户自己的视口：禁用补居中与首帧重算，不覆盖
					this.viewport.defaultSignature = null;
					this.viewport.restoredSaved = true;
				}
			} else {
				centerContentAtFullScale(mindMap);
				this.viewport.defaultSignature = this.viewSignature();
				this.viewport.restoredSaved = false;
			}
		} catch (error) {
			console.error('恢复视图状态失败', error);
			fitMindMap(mindMap);
			this.viewport.defaultSignature = null;
			this.viewport.restoredSaved = false;
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
		this.viewport.cancelRecenter();
		this.viewport.recenterTimer = window.setTimeout(() => {
			this.viewport.recenterTimer = null;
			const signature = this.viewport.defaultSignature;
			const mindMap = this.mindMap;
			if (!mindMap || signature === null || this.viewport.restoredSaved) {
				return;
			}
			if (this.viewSignature() !== signature) {
				// 用户已移动/缩放视口：不打扰
				this.viewport.defaultSignature = null;
				return;
			}
			// 几何可能又变（图片落定、容器 settle）：重新对齐后居中
			centerContentAtFullScale(mindMap);
			this.viewport.defaultSignature = this.viewSignature();
		}, VIEWPORT_RECENTER_DELAY_MS);
	}

	/** 当前视口签名（scale|x|y；读取失败返回 null）——读取面收口在引擎层 */
	private viewSignature(): string | null {
		return getViewportSignature(this.mindMap);
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
		if (renameReferencesInTree(tree, file, oldPath, this.deps.app)) {
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
		// 编码形态不可得时**不放进 needle 集**（孤立代理对等非法序列；该形态不存在
		// 即不可能命中，且绝不让预检在重命名/删除路径上抛错）。见 domain/url。
		const encodedName = encodedNameForm(file.name);
		const needles = [
			file.name,
			oldPath,
			oldBasename,
			...(encodedName === null ? [] : [encodedName]),
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
