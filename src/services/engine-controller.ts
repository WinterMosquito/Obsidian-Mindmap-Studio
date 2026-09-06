/**
 * 引擎控制器：simple-mind-map 实例的生命周期与防腐收口（EngineAdapter 职责）。
 * 从 view.ts 拆出（第 4 步）。
 *
 * - 引擎创建/销毁、初始化代际锁与零尺寸重试、主题/布局切换、视口持久化、
 *   引用更新预检在此收口；
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
	createMindMap,
	destroyMindMap,
	fitMindMap,
	getThemeConfig,
	isDarkTheme,
} from '../mindmap';
import { ensureUniqueUids } from '../markdown';
import {
	removeReferencesOnDelete,
	updateReferencesOnRename,
} from '../links-tree';
import { walkTree } from '../domain/tree';
import { EventBinder } from '../event-binder';
import { t } from '../i18n';
import type { App, TFile } from 'obsidian';
import type { Language } from '../i18n';
import type { MindMapNodeData } from '../../vendor/simple-mind-map.cjs';
import type { ViewStateStore } from '../view-state';

/** 引擎创建选项（设置读取与布局 fallback 由视图负责） */
export interface EngineSetupOptions {
	layout: string;
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
	/** 根数据变更（→ 防抖保存 + 状态栏计数 + 标题重命名调度） */
	onRootDataChanged(): void;
	/** 节点图片点击（拖拽抑制在本控制器内处理） */
	onNodeImageClick(node: MindMapNode): void;
	/** 引擎就绪后装配交互特性（拖拽/粘贴/右键/wikilink） */
	setupFeatures(): void;
	/** 引擎就绪后视图侧收尾（工具栏布局同步、md 模式工具栏重建） */
	onEngineReady(layout: string): void;
	/** 引用更新完成（→ 防抖保存） */
	onReferencesChanged(): void;
}

/** 节点图片点击的拖拽抑制窗口（拖拽落点在图片上时浏览器仍触发 click） */
const IMAGE_CLICK_DRAG_SUPPRESS_MS = 300;
/** 引擎容器暂时不可见时的零尺寸重试间隔 */
const INIT_RETRY_INTERVAL_MS = 200;
/** 首帧后恢复视口的延迟（等待引擎完成首次布局） */
const VIEWPORT_RESTORE_DELAY_MS = 150;

export class EngineController {
	/** 引擎实例作用域的事件绑定器（initMindMap 时注册，destroy 一次性清理） */
	readonly engineEvents = new EventBinder();
	/** 当前引擎实例（视图经只读转发暴露给 view-* 模块） */
	mindMap: MindMap | null = null;

	/**
	 * 引擎初始化代际锁：每次新的 initMindMap 请求或视图卸载都会递增，
	 * 使之前零尺寸定时重试作废——重试只允许在「仍是最近一次请求」
	 * 且视图仍挂载时执行，避免文件切换/视图关闭后过期 tree 被渲染，
	 * 进而把旧文件内容写进新文件。
	 */
	private initSeq = 0;
	/** 上次节点拖拽结束时间（拖拽后误触 click 的灯箱抑制） */
	private lastNodeDragEndAt = 0;

	constructor(private readonly deps: EngineControllerDeps) {}

	/**
	 * 初始化引擎（挂载点尺寸就绪前定时重试）。
	 * 每次新的初始化请求递增代际，令旧的零尺寸重试作废。重试闭包与
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
		const attempt = (): void => {
			const el = this.deps.getCanvasEl();
			if (!el || !el.isConnected || this.initSeq !== seq) {
				return;
			}
			const rect = el.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				// 容器暂时不可见（后台叶/折叠面板）：定时重试而非 rAF 忙循环，
				// 后台标签页由浏览器自动节流，恢复可见后必然初始化成功。
				window.setTimeout(attempt, INIT_RETRY_INTERVAL_MS);
				return;
			}
			this.renderMindMap(tree);
		};
		attempt();
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
			this.mindMap = createMindMap(canvasEl, tree, {
				layout: options.layout,
				themePref: options.themePref,
				isDark: this.deps.isDark(),
				enableDrag: options.enableDrag,
				performanceMode: options.performanceMode,
				performanceThreshold: options.performanceThreshold,
				lang: this.deps.getLang(),
				onHyperlinkJump: (link) => this.deps.openHyperlink(link),
			});
			this.engineEvents.onEngine(this.mindMap, 'data_change', () => {
				this.deps.onRootDataChanged();
			});
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
			this.mindMap.render();
			this.deps.setupFeatures();
			this.deps.onEngineReady(options.layout);
			// 首帧后：有保存的视口（缩放/平移）则恢复，否则适配全图
			window.setTimeout(
				() => this.restoreOrFitViewport(),
				VIEWPORT_RESTORE_DELAY_MS,
			);
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
		this.engineEvents.destroy();
		destroyMindMap(this.mindMap);
		this.mindMap = null;
		this.deps.getCanvasEl()?.empty();
	}

	/** 作废尚未执行的初始化重试（文件切换/视图关闭时） */
	invalidateInit(): void {
		this.initSeq++;
	}

	/** 应用布局（仅引擎侧；会话字段与持久化由视图负责） */
	setLayout(value: string): void {
		this.mindMap?.setLayout(value);
	}

	/** 应用主题（深色判定按当前主题偏好重算） */
	applyTheme(): void {
		if (!this.mindMap) {
			return;
		}
		const dark = isDarkTheme(this.deps.getSetupOptions().themePref, this.deps.isDark());
		this.mindMap.setThemeConfig(getThemeConfig(dark));
	}

	resize(): void {
		this.mindMap?.resize();
	}

	/** 当前树快照（引擎已销毁时为 null） */
	getDataSnapshot(): MindMapTreeNode | null {
		return this.mindMap?.getData() ?? null;
	}

	/** 用户是否正在节点文本编辑框内打字（防腐：renderer.textEdit 内部状态） */
	isEditingText(): boolean {
		const mindMap = this.mindMap;
		if (!mindMap) {
			return false;
		}
		const textEdit = (
			mindMap.renderer as unknown as {
				textEdit?: { isShowTextEdit(): boolean };
			}
		).textEdit;
		return textEdit?.isShowTextEdit() ?? false;
	}

	/** 根（中心主题）节点文本（防腐：renderer.root 内部状态） */
	getRootText(): string | null {
		const rootText = this.mindMap?.renderer.root?.getData('text');
		return typeof rootText === 'string' ? rootText : null;
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
			} catch {
				// 引擎尚未就绪等场景忽略
			}
		}
	}

	/** 打开后恢复保存的视口；无则 fit 全图 */
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
			} else {
				fitMindMap(mindMap);
			}
		} catch (error) {
			console.error('恢复视图状态失败', error);
			fitMindMap(mindMap);
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
			this.mindMap.setData(tree);
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
			this.mindMap.setData(tree);
			return true;
		}
		return false;
	}

	/**
	 * 渲染器树快速预检：树内是否有任何节点的图片/附件/超链接可能指向
	 * 指定文件（重命名/删除）。命中才走 getData() 深拷贝 + 精确匹配 + setData 重渲染；
	 * 未命中（无关文件的重命名/删除）时零拷贝跳过。
	 * 子串匹配是保守近似（宁可误报触发精确路径，不可漏报导致引用残留）。
	 */
	private rendererTreeHasMatchingRef(file: TFile, oldPath: string): boolean {
		const root = this.mindMap?.renderer?.root;
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
			const data = node.getData() as MindMapNodeData;
			if (data?.image || data?.attachmentUrl || data?.hyperlink) {
				const haystack = `${data.image ?? ''}|${data.attachmentUrl ?? ''}|${data.hyperlink ?? ''}`;
				if (needles.some((needle) => haystack.includes(needle))) {
					found = true;
					return false; // 命中即终止整树遍历
				}
			}
			return undefined;
		});
		return found;
	}
}
