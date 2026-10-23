/**
 * `EngineController` 的**外部依赖契约**：视图侧要提供的引擎创建选项，以及控制器
 * 反过来回调视图的那一组钩子。
 *
 * 从 `services/engine-controller.ts` 拆出（2026-10-22，纯搬移，零行为改动）。
 * 只有类型、没有运行时代码——放在控制器旁边而不是塞进控制器本体，是因为这份契约
 * 的**读者是 `features/view.ts`**（它 implements 自己那侧的装配）：改这里等于改
 * 视图与控制器之间的接口面，与控制器内部实现（800 行状态编排）不是一回事。
 *
 * `engine-controller.ts` 仍对外转出 `EngineControllerDeps`，既有 import 路径不变。
 */
import type { App, TFile } from 'obsidian';
import type { Language } from '../core/i18n';
import type { MindMapNode } from '../core/engine-types';
import type { NodeContentStyle } from '../engine/mindmap';
import type { ViewStateStore } from './view-state';

/** 引擎创建选项（设置读取与布局 fallback 由视图负责） */
export interface EngineSetupOptions {
	layout: string;
	/** 连线样式偏好（两态：折线 straight / 曲线 curve） */
	lineStyle: string;
	/** 主题色偏好（default/light/dark） */
	themePref: string;
	/** 节点外观主题 id（default/borderless；与 themePref 正交） */
	themeStyle: string;
	/** 配色 id（default/mint/…；与 themePref、themeStyle 三维正交） */
	palette: string;
	enableDrag: boolean;
	// 性能模式与阈值**不经过设置**（2026-10-09 减法：常开 + 常量阈值），
	// 故不在此列——`createMindMap` 的缺省值即判据
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
	 * 快捷键前置钩子（剪贴板三键回收）：返回 `true` 即取消该快捷键的引擎行为。
	 *
	 * 由组合根注入（实现落 `features/view-clipboard`）——services 不依赖
	 * features（K51 依赖矩阵），与 `exportSvgTransforms` 同款注入口径。
	 * 缺省 / null ⇒ 引擎快捷键行为不变（只读嵌入与视觉探针不传）。
	 */
	beforeShortcutRun?:
		| ((key: string, nodes: readonly MindMapNode[]) => boolean)
		| null;
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
				owner: object | null,
		  ) => HTMLElement | null)
		| null;
	/**
	 * 导出 SVG 后处理链（组合根按序注入）：引擎导出 PNG/SVG/PDF 时对**克隆的**
	 * SVG 依次调用（前一项返回值即后一项入参）。
	 *
	 * 为什么注入而非本层 import：后处理项分居两层——`platform/math-jax`
	 * （MathJax 字形样式注入，在 services 许可集内）与 `features/node-codeblock`
	 * （复制按钮隐身，**不在** services 许可集内，K51 依赖矩阵）。故由组合根
	 * 装配后注入，本控制器只负责按序应用；缺省/空链 = 不注册导出钩子。
	 */
	exportSvgTransforms?: ReadonlyArray<(svg: unknown) => unknown> | null;
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
	/** 引擎就绪后视图侧收尾（重建工具栏以同步连线开关可用态、md 模式补返回入口） */
	onEngineReady(): void;
	/**
	 * 引擎实例**即将销毁**（destroyInstance 的唯一通知点）：宿主据此按引擎
	 * 归属清理插件侧登记（未定稿数学段的登记面，见 platform/math-jax 的
	 * `unsettledMath` / `pruneUnsettledMathOwnedBy`）。
	 *
	 * 为什么经回调上抛而非本层直接清：登记面的清理收口在 features 的
	 * `content-remeasure`（services 不依赖 features，K51），且多视图/嵌入
	 * 并存时**只能**按引擎身份清——按 DOM 连接状态判会误清其他引擎尚未
	 * 挂载的条目（2026-10-14 实机定案）。缺省 = 不通知（视觉探针/无宿主）。
	 */
	onEngineDisposed?(mindMap: object): void;
	/** 引用更新完成（→ 防抖保存） */
	onReferencesChanged(): void;
}

