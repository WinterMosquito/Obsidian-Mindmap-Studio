/**
 * Markdown ```` ```mindmap ```` 代码块：把块体大纲**只读**渲染为导图
 * （普通笔记里的嵌入形态）。
 *
 * ## 定位（与 `.mindmap.md` 的分工）
 * - 本文件是**只读预览**：不回写文件、不参与保存管线；编辑仍走 `.mindmap.md`
 *   视图（该能力于 0.0.3 连同只读代码块一并移除，本次恢复只读形态）。
 * - 块体与 `.mindmap.md` 正文是**同一份大纲语法**（标题 / 列表），解析走同一个
 *   `parseMdOutline`——不存在第二套格式（标准见 `docs/markdown-mindmap-standard.md`）。
 *
 * ## 与文件视图共享的收口（刻意不另写一份）
 * | 事项 | 收口 |
 * |---|---|
 * | 大纲解析 | `markdown/md-outline.parseMdOutline` |
 * | 图片地址 / 尺寸盒 | `media/images-path`（地址解析 + 默认尺寸） |
 * | uid 去重 | `markdown/markdown.ensureUniqueUids` |
 * | 引擎实例 | `engine/mindmap.createMindMap`（`readonly: true`，不注册交互插件） |
 * | 自绘节点内容（数学/代码块/链接） | `features/node-content-factory` + `node-inline-content` |
 * | 定稿尺寸同步 | `features/content-remeasure`（本嵌入自持一个会话） |
 * | 链接跳转 / 未解析弱化 | `features/view-link-navigator`（宿主面 `MindMapLinkHost`） |
 * | 主题换肤 | `engine/mindmap.applyThemeConfig` |
 * | 事件登记与清理 | `core/event-binder.EventBinder` |
 *
 * ## 六条硬约束（各有实证，勿"顺手优化"）
 * ① **滚轮一律归宿主页面**：引擎 `Event.onMousewheel` 无条件
 *    `stopPropagation + preventDefault`（上游 `core/event/Event.js:148-150`），
 *    不拦就会把**笔记滚动卡死**在嵌入图上。故在引擎容器**外**的 capture 阶段
 *    只做 `stopPropagation`（**不** `preventDefault`）——引擎收不到 wheel，
 *    浏览器默认滚动照常发生。
 * ② **高度随内容，且不放大**（对齐 Obsidian 里 Mermaid 的缺省口径：SVG
 *    `width:100%` + `max-width: 原宽`）：`measureContentFitToWidth` 量出
 *    「按容器宽度缩放（scale ≤ 1）后的内容高」→ 由本文件写进挂载点高度
 *    （`applyEmbedFit`）⇒ 内容**完整可见**且容器不留空白框。⚠ 容器高度是
 *    **输出**（由比例反算），故**不能**用 `fitMindMap` 的双轴适配。
 *    宽度是**输入**：容器变窄即按新宽度重算（观察器常驻，见 `initMindMap`）
 *    ——首帧挂载成功也要建观察器，否则高度口径锁死在首帧。
 * ③ **不可拖动、不可缩放**：引擎侧 `enableViewDrag: false`（原生
 *    `isDisableDrag`，切断左键/中键拖动画布）+ 不注册交互插件；宿主侧滚轮
 *    拦截见 ①；CSS 不提供 resize 手柄。嵌入形态**没有**平移/缩放语义，
 *    内容已完整显示，任何可移动性都只会把内容推出视野。
 * ④ **不写任何状态到 `data.json`**：布局 / 视口 / 打开偏好都不持久化（本文件
 *    完全不触碰 `ViewStateStore`），每次渲染按当前设置重算。布局的唯一「按块」
 *    入口是块体首行的 `%%layout: <值>%%` 指令（`parseEmbedLayoutDirective`），
 *    它只影响这一次渲染，不回写任何地方。
 * ⑤ **超限不建引擎**：节点数 > `CODE_BLOCK_MAX_NODES` 时降级为只读缩进大纲
 *    （一篇笔记可有多个块，每块一个引擎会让打开成本随块数线性叠加）；
 *    降级**可见**（提示行），不静默退化。
 * ⑥ **零尺寸等待不加代际锁**：`RenderChild` 一次性——块体重渲即换新实例、
 *    unload 断开观察器，不存在文件视图那类「过期 tree 覆盖当前文件」的跨文件
 *    竞态，故**刻意**不复刻 `EngineController.initMindMap` 的代际机制。
 *
 * ## 已知限制（2026-10-17 实机登记）
 * 同一 leaf 在「阅读视图 ↔ 源码视图」间来回切换后，Obsidian 会**同时保留**两侧
 * 挂载点（CM 的 `.cm-preview-code-block` 与阅读视图各一份），本模块于是各建一个
 * 只读引擎：隐藏侧高度 0、`isShown()` 为假（尺寸量测已由 content-remeasure 挂起），
 * 残留成本≈一个引擎的内存；切到别的文件即随 RenderChild 卸载回收（实测引擎数
 * 2 → 1）。**刻意不做**「可见才建引擎」的门控：要与宿主双视图的生命周期抢时序，
 * 回归面（可能「切回来仍空白」）大于收益。若将来出现内存问题再按该方案重开，
 * 判据 `containerEl.isShown()` 已具备。
 */
import { App, MarkdownRenderChild } from 'obsidian';
import { CODE_BLOCK_MAX_NODES, DEFAULT_PALETTE } from '../core/constants';
import { createThrottler } from '../core/concurrency';
import { EventBinder } from '../core/event-binder';
import { t, tf, type Language } from '../core/i18n';
import {
	applyColorDirectivesToTree,
	applyRelationsToTree,
	applyThemeConfig,
	cancelEngineTimers,
	centerContentAtScale,
	countTreeNodes,
	createMindMap,
	destroyMindMap,
	measureContentFitToWidth,
	resizeMindMap,
} from '../engine/mindmap';
import { layoutIdOfPropertyValue } from '../domain/mindmap-property';
import { parseMdOutline } from '../markdown/md-outline';
import { ensureUniqueUids } from '../markdown/markdown';
import {
	ensureDefaultImageSizes,
	walkResolveImagePaths,
} from '../media/images-path';
import { refreshPrismTokenColors } from '../platform/prism-code';
import { ContentRemeasureSession } from './content-remeasure';
import { registerCodeBlockInteractions } from './node-codeblock';
import { createInlineContentOptions } from './node-content-factory';
import {
	buildInlineNodeContent,
	type InlineContentOptions,
} from './node-inline-content';
import { colorDirectiveOf } from './node-inline-tokenize';
import { isResolvedWikiLinkpath, openHyperlink } from './view-link-navigator';
import { registerTagClicks } from './view-tag';
import type { MindMapLinkHost } from './view-context';
import type { MindMap, MindMapTreeNode } from '../core/engine-types';

/** 外层容器类名（styles.css 的尺寸规则与 verify:visual 断言共用） */
export const EMBED_CONTAINER_CLASS = 'tmm-embed';
/** 引擎挂载点类名（高度由 `applyEmbedFit` 按内容写入；它的尺寸就是引擎画布尺寸） */
export const EMBED_CANVAS_CLASS = 'tmm-embed-canvas';
/** 空态 / 降级 / 失败提示行类名 */
export const EMBED_NOTICE_CLASS = 'tmm-embed-notice';
/** 超限降级的只读大纲类名 */
export const EMBED_OUTLINE_CLASS = 'tmm-embed-outline';

/** 尺寸变化合并窗口（同视图口径：一次侧栏拖动只重建一次布局） */
const EMBED_RESIZE_THROTTLE_MS = 100;
/** 首帧后的补算延时（布局晚变 / 字体就绪；与视图 VIEWPORT_RESTORE_DELAY_MS 同量级） */
const EMBED_FIT_SETTLE_DELAY_MS = 150;
/**
 * 内容四周留白（px）：既进容器高度，也从可用宽度里扣除。
 * 取小值——嵌入是「随内容」的盒子，不是画布（视图的 `fitPadding` 默认 50
 * 是给全屏画布用的，套进来会凭空多出一圈空白）。
 */
const EMBED_FIT_PADDING = 12;

/**
 * 嵌入渲染所需的**最窄设置面**（窄化契约，同 `CommandsHost` 手法）：
 * 只取四项，且由组合根取值——features 不引 `settings`（组合根禁令）。
 *
 * `layout` / `lineStyle` / `themeStyle` 都取**全局默认**（设置项 `defaultLayout` /
 * `defaultLineStyle` / `defaultThemeStyle`，由组合根注入）：嵌入没有「当前文件」
 * 身份、拿不到右栏/右键那份按文件记的值，但仍应遵守用户的默认外观（2026-10-21
 * 用户订正）。**布局另有块体首行的 `%%layout: …%%` 指令可覆盖**，此时这里的值是
 * 回退值（见 `parseEmbedLayoutDirective`）。
 * `palette` **没有全局默认**（只有按文件记），故恒用 `DEFAULT_PALETTE`。
 */
export interface MindmapEmbedConfig {
	/** 引擎 layout id：**块体首行没有 `%%layout: …%%` 指令时的回退值** */
	layout: string;
	lineStyle: string;
	/** 主题（明暗配色） */
	themePref: string;
	/** 边框样式：取全局设置 `defaultThemeStyle`（非右栏/右键按文件值） */
	themeStyle: string;
	lang: Language;
}

/**
 * 块体解析出的**展示树**：虚拟文档根只有 1 个子节点时以该子节点为根。
 *
 * 为什么需要：`parseMdOutline` 面向文件，恒造一个"虚拟文档根"（根名 = 文件名）
 * 作为所有顶层块的父节点。代码块没有文件名，而块体最常见的写法就是一个
 * `# 主题` 或一条 `- 主题`（= 单子）——此时把虚拟根显示出来会凭空多出一层
 * 无意义的中心主题。**多个**顶层块（两个 `#`、或平铺多条列表）时保留虚拟根：
 * 那时"唯一中心"才是对的。
 *
 * 根名兜底走 i18n（`mindmapEmbed.root`）：**刻意不另写"首个一级标题"判定**
 * ——标题语法只允许存在一份（`markdown/md-outline`），另写一份必然与之漂移。
 */
export function embedDisplayTree(tree: MindMapTreeNode): MindMapTreeNode {
	if (tree.children.length !== 1) {
		return tree;
	}
	// noUncheckedIndexedAccess：索引取值可能为 undefined，取不到即回退虚拟根
	return tree.children[0] ?? tree;
}

/** 是否降级为只读大纲（超过嵌入上限；纯判据，便于直测） */
export function shouldRenderOutline(nodeCount: number): boolean {
	return nodeCount > CODE_BLOCK_MAX_NODES;
}

/**
 * 块体首行布局指令的外壳：`%%layout: <值>%%`（键名大小写不敏感）。
 * **只认外壳**——值的语义交给 `domain/mindmap-property` 解析（唯一实现）。
 */
const EMBED_LAYOUT_DIRECTIVE_RE = /^\s*%%\s*layout\s*:\s*(.+?)\s*%%\s*$/i;

/**
 * 解析块体**首行**的布局指令（`%%layout: Timeline%%`，允许其前有空行）。
 *
 * 为什么只认首行：指令是「这一块的渲染参数」，写在正文里会与用户的大纲内容
 * 混淆；同形文本出现在后面时就只是内容（可能人家正在讲这条语法）。
 *
 * 返回值：
 * - `source`：剥掉指令行后的块体。**外壳不匹配时原样返回**——`%%备注%%` 之类
 *   是用户注释（行内规则里注释也隐藏），不能因为长得像就被吃掉；
 * - `layoutId`：值命中六种布局之一时的引擎 id，否则 `null`；
 * - `invalidValue`：值解析不出布局（`Markdown` 或未知）时才回填，供块内提示
 *   说明「写了但没用上」——这是可见降级，不静默。
 *
 * **值不可为空**：`%%layout: %%` 会命中外壳（`(.+?)` 吃掉分隔空白那个空格），
 * 故取到值后先判空——空值等同「不是指令」，整行按正文留在块内（既不剥行，
 * 也不弹一条值为空的「忽略指令」提示）。
 */
export function parseEmbedLayoutDirective(source: string): {
	source: string;
	layoutId: string | null;
	invalidValue?: string;
} {
	const lines = source.split('\n');
	let index = 0;
	while (index < lines.length && (lines[index] ?? '').trim() === '') {
		index++;
	}
	const match = EMBED_LAYOUT_DIRECTIVE_RE.exec(lines[index] ?? '');
	if (!match) {
		return { source, layoutId: null };
	}
	const raw = (match[1] ?? '').trim();
	if (raw === '') {
		return { source, layoutId: null };
	}
	const layoutId = layoutIdOfPropertyValue(raw);
	// 只删指令行本身：其前的空行是用户排版，保留
	const rest = [...lines.slice(0, index), ...lines.slice(index + 1)];
	const stripped = rest.join('\n');
	return layoutId === null
		? { source: stripped, layoutId: null, invalidValue: raw }
		: { source: stripped, layoutId };
}

/**
 * Markdown 代码块渲染子（`ctx.addChild` 托管）：
 * 解析块体 → 建只读引擎 → 随宿主生命周期销毁。
 */
export class MindmapEmbedRenderChild extends MarkdownRenderChild {
	private mindMap: MindMap | null = null;
	/** DOM + 引擎事件的统一绑定器（同视图口径；destroy 幂等） */
	private readonly events = new EventBinder();
	/** 定稿（公式替换 / 代码块高亮）后的尺寸同步会话（宿主 = 本渲染子） */
	private readonly remeasure: ContentRemeasureSession;
	/** 尺寸变化节流器（容器 resize 时重建布局） */
	private readonly resizeThrottler = createThrottler(EMBED_RESIZE_THROTTLE_MS);
	private readonly inlineContentOptions: InlineContentOptions;
	private observer: ResizeObserver | null = null;
	/** 引擎挂载点（高度在首帧后由 `applyEmbedFit` 按内容写入内联样式） */
	private canvasEl: HTMLElement | null = null;
	/** 最近一次由本文件写入的高度（px）：据它区分「自己写的高度」与「外部改宽度」 */
	private appliedHeight: number | null = null;
	/** 最近一次观察到的宽度（px）：宽度变了才需要重建布局 */
	private observedWidth: number | null = null;
	/** 待挂载的展示树（尺寸等待期间复用同一份，避免重复解析） */
	private pendingTree: MindMapTreeNode | null = null;
	/**
	 * 挂载时解析出的**实际布局**（首行指令 ?? 配置回退值）。
	 *
	 * 之后所有用到布局的地方（延迟挂载、`css-change` 换肤）都读这个字段：
	 * 重新问配置会让「指令指定的布局」在换主题时悄悄漂回默认（设置变更本就不
	 * 该改写已渲染块的布局）。
	 */
	private embedLayout: string | null = null;
	/** 待执行的「重建布局 + 重算高度」帧（见 `deferFit`；至多一个在途） */
	private fitFrame: number | null = null;

	constructor(
		private readonly app: App,
		private readonly source: string,
		containerEl: HTMLElement,
		private readonly sourcePath: string,
		private readonly getConfig: () => MindmapEmbedConfig,
	) {
		super(containerEl);
		this.remeasure = new ContentRemeasureSession({
			getMindMap: () => this.mindMap,
			register: (cleanup) => this.register(cleanup),
			// 可见性判据（官方 `Element.isShown()`）：嵌入随宿主笔记被切到后台
			// 时量测恒 0×0，会话据此挂起（同文件视图，见 content-remeasure ④）
			isVisible: () => this.containerEl.isShown(),
			// 画布根（未定稿修复 / 登记面清理的作用域，见 content-remeasure ⑤）：
			// 嵌入挂载点；引擎未建时为 null，会话静默跳过
			getContentRoot: () => this.canvasEl,
		});
		// 自绘内容装配：平台实现固定、宿主相关两项注入（与文件视图同一工厂）
		this.inlineContentOptions = createInlineContentOptions({
			isResolvedLink: (linkpath) =>
				isResolvedWikiLinkpath(this.linkHost(), linkpath),
			onSettled: (holder) => this.remeasure.schedule(holder),
		});
	}

	override onload(): void {
		const container = this.containerEl;
		container.empty();
		container.addClass(EMBED_CONTAINER_CLASS);
		// ① 滚轮一律归宿主页面：capture 阶段拦在引擎容器**之外**，只
		// stopPropagation（不 preventDefault）⇒ 浏览器默认滚动照常发生，
		// 引擎那个无条件 preventDefault 的 wheel 监听收不到事件。
		this.events.onDom(container, 'wheel', (event) => event.stopPropagation(), {
			capture: true,
		});
		this.register(() => this.events.destroy());

		const config = this.getConfig();
		const lang = config.lang;
		// 布局指令必须在解析**之前**剥离：指令行绝不能变成节点（否则用户会看到
		// 一个叫「%%layout: Timeline%%」的主题）。
		const directive = parseEmbedLayoutDirective(this.source);
		this.embedLayout = directive.layoutId ?? config.layout;
		if (directive.invalidValue !== undefined) {
			container.createDiv({
				cls: EMBED_NOTICE_CLASS,
				text: tf(lang, 'mindmapEmbed.unknownLayout', {
					value: directive.invalidValue,
				}),
			});
		}
		let tree: MindMapTreeNode;
		try {
			tree = parseMdOutline(directive.source, t(lang, 'mindmapEmbed.root')).tree;
		} catch (error) {
			this.renderFailure(lang, error);
			return;
		}
		if (tree.children.length === 0) {
			container.createDiv({
				cls: EMBED_NOTICE_CLASS,
				text: t(lang, 'mindmapEmbed.empty'),
			});
			return;
		}
		const display = embedDisplayTree(tree);
		const nodeCount = countTreeNodes(display);
		if (shouldRenderOutline(nodeCount)) {
			container.createDiv({
				cls: EMBED_NOTICE_CLASS,
				text: tf(lang, 'mindmapEmbed.tooMany', {
					count: nodeCount,
					max: CODE_BLOCK_MAX_NODES,
				}),
			});
			buildOutline(container, display);
			return;
		}
		// 图片：库内路径 → 资源地址；随后填**默认尺寸盒**（引擎硬要求：缺失
		// imageSize 会直接解构抛错、整图渲染中断，见 ensureDefaultImageSizes）。
		// 只读预览**不做**「带官方尺寸参数的节点异步校正」：默认盒即安全终态
		// （K97 语义），也避免为嵌入再引一条探测链。
		walkResolveImagePaths(display, this.app);
		ensureDefaultImageSizes(display);
		// uid 去重：引擎按 uid 查找，缺失/重复会误删/漏删（解析层不管 uid）
		ensureUniqueUids(display);
		this.pendingTree = display;
		this.canvasEl = container.createDiv(EMBED_CANVAS_CLASS);
		this.initMindMap();
	}

	override onunload(): void {
		this.disconnectInitObserver();
		this.resizeThrottler.cancel();
		// 会话先收尾（清未决定稿批次），再销毁引擎
		this.remeasure.dispose();
		this.destroyInstance();
		// 卸载即清 DOM（2026-10-14 实机归属分析）：切模式时 Obsidian 会**保留**
		// 另一套视图子树（隐藏的 `.cm-editor` / `.markdown-preview-view`）——
		// 已卸载实例若把 `.tmm-embed-canvas` 骨架留在原地（无 svg、无内联
		// 高度），文档级 `querySelectorAll('.tmm-embed-canvas')` 会把它当成
		// 「第二个嵌入」，自动化断言随之误判。清空是我们的职责：容器里的
		// 内容（canvas / notice / outline）全部由本类创建。
		this.containerEl.empty();
	}

	/**
	 * 尺寸就绪即挂引擎，否则交给 `ResizeObserver` 等待（无轮询）。
	 *
	 * 观察器**先建**且**常驻**：它担两件事——① 尺寸未就绪时的首次挂载；
	 * ② 之后的**宽度**变化重排（笔记栏宽 / 窗口拖动）。首帧同步挂载成功**也
	 * 必须建**（此处不再是「挂载失败才建」的早退）：否则首帧算出的高度会被
	 * 锁死——容器变窄则内容被 `overflow: hidden` 裁掉、变宽则留下空白框，
	 * 而这条路径恰是最常见的一条。
	 *
	 * 只认**宽度**变化：高度是本文件按内容写的（`applyEmbedFit`），把它也当
	 * 输入会与自己打架——写完高度就触发一次回调，重排又改高度，来回不收敛。
	 */
	private initMindMap(): void {
		const observer = new ResizeObserver(() => {
			if (!this.mindMap) {
				this.tryRender();
				return;
			}
			const width = this.canvasWidth();
			if (
				this.observedWidth !== null &&
				Math.abs(width - this.observedWidth) < 1
			) {
				// 只有我们自己写的高度变了：内容与比例都没变，重排属白干
				return;
			}
			this.observedWidth = width;
			this.resizeThrottler.run(() => this.deferFit());
		});
		this.observer = observer;
		observer.observe(this.containerEl);
		this.register(() => this.disconnectInitObserver());
		this.tryRender();
	}

	/**
	 * 尺寸就绪时创建引擎（同步），否则交观察器等待（调用方不消费结果）。
	 *
	 * 与 `services/engine-controller.tryRender` **同名同责**（零尺寸等待 + 就绪即
	 * 同步创建）：新增/修改这两处请成对阅读（差异只在代际锁——嵌入侧刻意不复刻，
	 * 见文件头）。本方法此前叫 `tryMount`，同一职责两个名字在检索时找不到一起。
	 */
	private tryRender(): void {
		if (this.mindMap) {
			return;
		}
		const el = this.canvasEl;
		const tree = this.pendingTree;
		if (!el || !tree || !el.isConnected) {
			return;
		}
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) {
			return;
		}
		this.mount(el, tree);
	}

	/** 引擎实际创建（只读口径，见 CreateMindMapOptions.readonly） */
	private mount(el: HTMLElement, tree: MindMapTreeNode): void {
		const mindMap = this.createEmbedEngine(el, tree);
		if (!mindMap) {
			return;
		}
		this.mindMap = mindMap;
		this.bindEmbedEvents(mindMap, el);
		mindMap.render();
		this.observedWidth = this.canvasWidth();
		this.scheduleEmbedSettleFit();
	}

	/**
	 * 建只读引擎实例（**唯一**创建点）。
	 *
	 * @returns null = 建失败（畸形块体/引擎异常），已由 `renderFailure` 给出
	 *   可见提示并清理半初始化实例；调用方直接放弃本次挂载
	 */
	private createEmbedEngine(
		el: HTMLElement,
		tree: MindMapTreeNode,
	): MindMap | null {
		const config = this.getConfig();
		// 布局取挂载时解析出的值（指令 ?? 回退值）：延迟挂载同样是这一块的渲染
		const layout = this.embedLayout ?? config.layout;
		let mindMap: MindMap;
		try {
			// 节点配色指令（`%%#hex%%`）：在创建**之前**写进 data 树——引擎会克隆
			// 数据，建好后再改这棵树不再生效（只读嵌入没有编辑入口，无需实时同步）。
			applyColorDirectivesToTree(tree, colorDirectiveOf);
			// 联系（关系连线）：同一时机写进 data 树（只读嵌入没有编辑入口，
			// 创建后不需要实时同步；交互副作用由 vendor 补丁 13 整段跳过）
			applyRelationsToTree(tree);
			mindMap = createMindMap(el, tree, {
				layout,
				lineStyle: config.lineStyle,
				themePref: config.themePref,
				// 边框跟随**全局默认**（与 layout / lineStyle 同性质）；配色只有
				// 按文件记的值、没有全局默认，故恒用基准蓝
				themeStyle: config.themeStyle,
				palette: DEFAULT_PALETTE,
				isDark: this.app.isDarkMode(),
				enableDrag: false,
				// 只读嵌入：引擎原生 readonly（命令/编辑全禁）+ 不注册任何交互插件
				readonly: true,
				// 画布拖动（平移）也关掉：readonly 不含它，内容已完整显示，
				// 可拖动只会把内容推出视野（见文件头硬约束 ③）
				enableViewDrag: false,
				lang: config.lang,
				// 链接跳转与文件视图**同一份判定**（含库内路径 / file:// / 外跳系统应用）
				onHyperlinkJump: (link) => openHyperlink(this.linkHost(), link),
				// `owner`（本次引擎实例）原样透传——数学段的归属登记靠它，
				// 本层不解释（见 InlineContentOptions.renderMath）
				createNodeContent: (node, doc, style, lang, owner) =>
					buildInlineNodeContent(
						node,
						doc,
						style,
						lang,
						this.inlineContentOptions,
						owner,
					),
			});
		} catch (error) {
			// 畸形块体/引擎异常：清半初始化实例并给可见提示（异常不逃出渲染管线）
			this.renderFailure(config.lang, error);
			return null;
		}
		return mindMap;
	}

	/**
	 * 绑与引擎同罪的两类事件（引擎生命周期内有效，`destroyInstance` 一次性清理）。
	 *
	 * ① 复制按钮交互（节点内围栏块）——与视图**同一份交互实现**，宿主面窄化为
	 *    「引擎实例 + 绑定器」（否则复制按钮是看得见点不动的死件）；
	 * ② 渲染落地：定稿尺寸重试（渲染窗口内 holder 未定位，K104）+ 按内容重算
	 *    高度并按宽度适配（幂等 K70——已在目标态时零调用）；
	 * ③ 主题换肤：官方 `css-change` → 原地写主题配置 + 重探测 token 内联色
	 *    （不重建引擎）。
	 */
	private bindEmbedEvents(mindMap: MindMap, el: HTMLElement): void {
		registerCodeBlockInteractions({
			mindMap,
			engineEvents: this.events,
		});
		// 标签 pill 与链接同权：只读嵌入里也可点（同一份交互实现）
		registerTagClicks(this.events, el, this.app, this.getConfig().lang);
		this.events.onEngine(mindMap, 'node_tree_render_end', () => {
			this.remeasure.retryDeferred();
			this.applyEmbedFit();
		});
		// 每实例一条监听、由 Component 生命周期摘除——
		// **不建"活动嵌入注册表"**：官方生命周期已保证清理，中央表是第二份收口。
		this.registerEvent(
			this.app.workspace.on('css-change', () => {
				const next = this.getConfig();
				applyThemeConfig(this.mindMap, {
					isDark: this.app.isDarkMode(),
					themePref: next.themePref,
					// 布局用**挂载时**解析出的值：这里重读配置会让指令布局漂回默认
					layout: this.embedLayout ?? next.layout,
					lineStyle: next.lineStyle,
					// 同 mount：边框跟全局默认、配色恒基准蓝（都不读右栏/右键按文件值）
					themeStyle: next.themeStyle,
					palette: DEFAULT_PALETTE,
				});
				refreshPrismTokenColors(el);
			}),
		);
	}

	/**
	 * 兜底补算：布局晚变（面板 settle / 字体就绪）而不再有渲染结束事件时再算
	 * 一次（与事件里那次幂等：已在目标态即零写入）。
	 */
	private scheduleEmbedSettleFit(): void {
		const timer = window.setTimeout(() => {
			this.applyEmbedFit();
		}, EMBED_FIT_SETTLE_DELAY_MS);
		this.register(() => window.clearTimeout(timer));
	}

	/**
	 * 按内容重算挂载点高度并按宽度适配（`node_tree_render_end` / 兜底定时器调用）。
	 *
	 * 两件事必须成对做，且顺序固定：
	 * ① 先量「按宽度缩放后的内容高」并写进容器——容器高度是**输出**，
	 *    所以只能靠 `measureContentFitToWidth` 反算（不能用 `fitMindMap`）；
	 * ② 再按同一比例把内容居中（`centerContentAtScale`，与视图同一份实现）。
	 *
	 * 高度变了要请引擎重建布局：引擎只在创建与 `resize()` 时更新自己的
	 * 画布尺寸，而布局的根节点落位与**性能模式的视口剔除判据**都读它——
	 * 不重排会让高图被判成「视口外」而**裁掉可见节点**。重排会再发渲染结束
	 * 事件，但此时高度已稳定（比例只依赖宽度）⇒ 最多多跑一轮即收敛。
	 */
	private applyEmbedFit(): void {
		const mindMap = this.mindMap;
		const el = this.canvasEl;
		if (!mindMap || !el) {
			return;
		}
		const fit = measureContentFitToWidth(
			mindMap,
			this.canvasWidth(),
			EMBED_FIT_PADDING,
		);
		if (!fit) {
			return;
		}
		if (
			this.appliedHeight === null ||
			Math.abs(this.appliedHeight - fit.height) > 1
		) {
			this.appliedHeight = fit.height;
			el.style.height = `${fit.height}px`;
			// 引擎的画布尺寸（布局根落位 + 视口剔除判据）必须跟上新高度
			resizeMindMap(mindMap);
		}
		centerContentAtScale(mindMap, fit.scale);
	}

	/**
	 * 把「重建布局 + 重算高度」推到**下一帧**执行（同帧内至多一次）。
	 *
	 * 为什么必须隔一帧：本方法由 `ResizeObserver` 回调（经节流器的**首次立即
	 * 执行**语义）触发，而回调里同步改高度会让本次投递循环留下**未投递的通知**
	 * ——Chrome 记一条 `ResizeObserver loop completed with undelivered
	 * notifications`（实机 `obsidian dev:errors` 每个尺寸变化一条；尺寸反馈环
	 * 本身是设计要的，但写布局的时机不该在回调里）。
	 *
	 * 帧内合帧：同一帧里多次宽度变化只落一次；节流窗口语义不变（每窗口至多一次）。
	 */
	private deferFit(): void {
		if (this.fitFrame !== null) {
			return;
		}
		this.fitFrame = window.requestAnimationFrame(() => {
			this.fitFrame = null;
			resizeMindMap(this.mindMap);
			this.applyEmbedFit();
			// 可见性自愈（不变式 ④）：放在帧回调里而非 RO 回调内——在 RO 回调里
			// 同步写布局/重测会留下未投递通知（理由同本方法文件头）；
			// 嵌入的隐藏→可见必经宽度 0→非 0，故本路径必然被走到
			this.remeasure.syncVisibility();
		});
	}

	/** 挂载点当前宽度（CSS 像素；不可得回退 0 = 调用方保持现状） */
	private canvasWidth(): number {
		return this.canvasEl?.clientWidth ?? 0;
	}

	/** 链接导航宿主面（app / 宿主笔记 / 语言）：与文件视图共用同一份判定 */
	private linkHost(): MindMapLinkHost {
		return {
			app: this.app,
			// 宿主笔记；未保存/已删除时为 null（相对链接按库根解析，官方行为）
			file: this.app.vault.getFileByPath(this.sourcePath),
			lang: this.getConfig().lang,
		};
	}

	/**
	 * 渲染失败：清半初始化实例 + **可见**提示行。
	 *
	 * 不走 `notifyError`：一篇笔记可能有多个块，逐块弹通知会刷屏；口径同决策表
	 * 「内部错误 → console，用户可感 → 卡片」——这里的卡片即块内提示行。
	 */
	private renderFailure(lang: Language, error: unknown): void {
		console.error('渲染 mindmap 代码块失败', this.sourcePath, error);
		this.destroyInstance();
		// 尺寸会话一并收尾：创建过程中（字体钩子已装）可能已有定稿入批或在途
		// 定时器，失败态下再无重测目标——不留悬挂监听（与 onunload 同款收尾）
		this.remeasure.dispose();
		// 失败即终态：不再有可挂载的树，摘掉观察器（否则每次容器尺寸变化都会
		// 回调一次必然失败的 tryRender）
		this.disconnectInitObserver();
		const container = this.containerEl;
		container.empty();
		container.addClass(EMBED_CONTAINER_CLASS);
		container.createDiv({
			cls: EMBED_NOTICE_CLASS,
			text: t(lang, 'mindmapEmbed.renderFailed'),
		});
	}

	/** 销毁引擎与其事件（幂等；`destroyMindMap` 自身可空） */
	private destroyInstance(): void {
		this.pendingTree = null;
		// 在途帧同样先取消：闭包会触碰引擎实例（与 cancelEngineTimers 同理）
		if (this.fitFrame !== null) {
			window.cancelAnimationFrame(this.fitFrame);
			this.fitFrame = null;
		}
		this.events.destroy();
		// 在途延时任务（延时居中 / 布局轮询链）先取消：闭包会触碰引擎实例
		cancelEngineTimers(this.mindMap);
		// 引擎归属登记（未定稿数学段）在销毁点按实例身份清（语义见
		// content-remeasure.forgetEngine）；先 dispose 后本方法时同样幂等
		if (this.mindMap) {
			this.remeasure.forgetEngine(this.mindMap);
		}
		destroyMindMap(this.mindMap);
		this.mindMap = null;
	}

	private disconnectInitObserver(): void {
		this.observer?.disconnect();
		this.observer = null;
	}
}

/** 超限降级：只读缩进大纲（`<ul>` 嵌套，零引擎成本、信息不丢） */
function buildOutline(container: HTMLElement, tree: MindMapTreeNode): void {
	const root = container.createDiv({ cls: EMBED_OUTLINE_CLASS });
	buildOutlineList(root, tree);
}

/** 递归建层：每个节点一个 `<li>`，有子节点则在其内再嵌一层 `<ul>` */
function buildOutlineList(parent: HTMLElement, node: MindMapTreeNode): void {
	const list = parent.createEl('ul');
	const item = list.createEl('li', { text: nodeText(node) });
	for (const child of node.children) {
		buildOutlineList(item, child);
	}
}

/** 节点显示文本（缺失按空串——引擎空文本节点即空框，同款容忍） */
function nodeText(node: MindMapTreeNode): string {
	const text: unknown = node.data?.text;
	return typeof text === 'string' ? text : '';
}
