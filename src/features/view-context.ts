/**
 * MindMapViewContext：view-* 功能模块对视图的访问契约（结构化窄接口）。
 *
 * 此前 view-* 模块 `import type { MindMapView } from './view'`——类型图上
 * 全部反向指向 view.ts 巨类（view-paste 更因 `getActiveViewOfType` 需要
 * 类引用而形成 view.ts ↔ view-paste.ts 运行时循环）。收敛为本接口后：
 * - view-* 只依赖本文件（叶子模块，不引 view.ts/main.ts），类型环消失；
 * - 访问面由本契约显式声明——view 之外的能力（未列成员）编译期即拒绝；
 * - MindMapView 结构化实现（implements），无运行时改动。
 */
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import type { MindMap } from '../../vendor/simple-mind-map.cjs';
import type { EventBinder } from '../event-binder';
import type { Language } from '../i18n';
import type { StatusBarService } from '../status-bar';
import type { MindMapStudioSettings } from '../settings';
import type { ViewStateStore } from '../view-state';

/**
 * view-* 模块所需的插件能力窄化视图（结构化匹配，不依赖 main.ts 插件类）。
 *
 * settings 为活引用：插件 loadSettings 时整体替换对象，经插件实例每次
 * 读取的都是当前设置（设置面板保存后立即生效，无需重新装配）。
 */
export interface ViewPluginContext {
	/** 插件设置（活引用，完整设置面） */
	readonly settings: MindMapStudioSettings;
	/** 视图状态存储（布局/视口/打开偏好，按文件路径） */
	readonly viewState: ViewStateStore;
	/** 状态栏服务（节点计数展示/清空；DOM 由插件层持有） */
	readonly statusBar: StatusBarService;
}

/**
 * 引擎面：view-* 对导图实例与事件绑定的窄化访问面。
 * 引擎实例与两类事件绑定器总是一起装配、一起重建，聚合为单一子面。
 */
export interface ViewEngineContext {
	readonly mindMap: MindMap | null;
	readonly engineEvents: EventBinder;
	readonly viewEvents: EventBinder;
}

/**
 * DOM 面：插件自建 UI 元素引用的窄化访问面。
 * builder 模块构建后回填（可写成员）；canvasEl/toolbarEl 由视图生命周期持有。
 * view-* 只允许经本面触碰视图 DOM 元素，不直接访问 FileView 容器树。
 */
export interface ViewDomContext {
	/** 引擎画布容器（引擎重建时替换） */
	readonly canvasEl: HTMLElement | null;
	readonly toolbarEl: HTMLElement | null;
	/** 搜索栏（view-search 构建并持有） */
	searchBarEl: HTMLElement | null;
	searchInput: HTMLInputElement | null;
	searchCountEl: HTMLElement | null;
	/** 布局选择器（view-toolbar 构建并持有） */
	layoutSelect: HTMLSelectElement | null;
}

/**
 * 装配面：Obsidian 基类能力 + 语言 + 行为 + 插件服务，并与各子上下文组合。
 *
 * view-* 模块按需依赖：只碰 DOM 的拿 `ViewDomContext`、只碰引擎的拿
 * `ViewEngineContext`（必要时与 `Pick<MindMapViewContext, …>` 组合），
 * 勿默认依赖整个装配面（R4 上下文瘦身：控制公开面随特性增长的膨胀）。
 * 结构化子集兼容：`MindMapView` 实现装配面，传给子面参数无需适配。
 */
export interface MindMapViewContext extends ViewEngineContext, ViewDomContext {
	// ---- Obsidian 上下文（View/FileView 基类提供）----
	readonly app: App;
	readonly file: TFile | null;
	readonly containerEl: HTMLElement;
	/**
	 * 本视图的叶子。悬停预览（hover-link）的 `hoverParent` 需官方
	 * `HoverParent`（核心把弹窗实例挂在它上面做定位与生命周期管理），
	 * `WorkspaceLeaf` 实现该接口——勿传裸 HTMLElement。
	 */
	readonly leaf: WorkspaceLeaf;

	// ---- 语言 ----
	readonly lang: Language;

	// ---- 行为 ----
	/** 调度防抖保存（data 变更后调用） */
	scheduleSave(): void;
	/** 打开节点超链接（wiki / http / 库内路径） */
	openHyperlink(link: string, openNew?: boolean): void;
	/** 当前文件是否为 .mindmap.md（渲染层模式） */
	isMdDocument(): boolean;
	/** 切回 Markdown 编辑（工具栏/命令入口） */
	backToMarkdown(): void;
	/** 应用指定布局（布局选择器变更时） */
	applyLayout(layout: string): void;

	// ---- 插件能力（窄化）----
	readonly plugin: ViewPluginContext;
}
