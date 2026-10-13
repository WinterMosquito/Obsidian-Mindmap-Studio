/**
 * 自绘内容「定稿 → 尺寸同步」会话（P4 / K88 / K104 / K116）。
 *
 * 从 `features/view.ts` 外置（2026-10-11，`docs/agents/architecture.md` 早已登记
 * 的偏离项「数学校准会话仍在视图层」）。为什么落 features：它按 holder 反查真实
 * 节点并触发批量重排，依赖 engine 访问面——`platform` 不得依赖 engine（K51），
 * `services` 不得依赖 features，故只能在 features 层。外置后该会话**首次获得直测**
 * （此前只靠 `verify:visual` 的 inline 探针间接覆盖）。
 *
 * 职责单一：只做「按 holder 反查真实节点 → 合并为一次批量重排」+ 字体分批就绪的
 * 再同步 + 渲染窗口失败重试。不关心内容是什么（数学/代码块共用同一机制，K116）。
 *
 * ## 三条不变式（自 view.ts 原样继承，抽取时勿"顺手优化"）
 * ① **批量合并**：同帧多段定稿合并为一次批量重排——`setTimeout(0)` 宏任务合批，
 *    **不用 rAF**（后台/隐藏窗口会被节流，定稿永不落地）；
 * ② **按 holder 反查真实节点**：构建期闭包捕获的 node 可能是引擎**预测量代理**
 *    （vendor 补丁 5：只有 `nodeData`/`getData`，没有 `reRender`），`reRender?.()`
 *    会静默 no-op（K88 实机事故：512px 外框 / 655px 内容，29 次回调全收到代理）；
 * ③ **渲染窗口失败只重试一次**（K104）：`Renderer._render` 期间 `renderer.root`
 *    为 null（K67），两条解析路径必然全空——属预期中间态，暂存等
 *    `node_tree_render_end` 重试；仍失败才告警一次（K85 ①：静默即无痕退化）。
 */
import type { MindMap, MindMapNode } from '../../vendor/simple-mind-map.cjs';
import { createWarnOnce } from '../core/errors';
import {
	findNodesByContentProducts,
	refreshNodesCustomContent,
	resolveNodesByDoms,
} from '../engine/mindmap';

/** 宿主的最窄访问面：引擎实例 + 视图生命周期注册（结构化类型，传入即兼容） */
export interface ContentRemeasureHost {
	/** 当前引擎实例（重建/关闭期间可能为 null；flush 据此静默结束） */
	getMindMap(): MindMap | null;
	/** 注册随视图卸载自动清理的回调（Obsidian `Component.register`） */
	register(cleanup: () => void): void;
}

/** `document.fonts` 的最小形态（只用到 `loadingdone` 监听；可注入以便测试） */
export interface FontSetLike {
	addEventListener?(type: string, listener: () => void): void;
	removeEventListener?(type: string, listener: () => void): void;
}

/** 缺省字体面：全局 `document.fonts`（node 测试环境无 window → null，静默不装） */
function defaultFontSet(): FontSetLike | null {
	if (typeof window === 'undefined') {
		return null;
	}
	const doc = window.document as unknown as { fonts?: FontSetLike };
	return doc.fonts ?? null;
}

export class ContentRemeasureSession {
	/** 当前批次的 holder（首个定稿者排定时器，后续同帧定稿并入） */
	private pending: Set<HTMLElement> | null = null;
	/** 未决批次的定时器（视图关闭时取消，防关闭后空跑；window.setTimeout 返回 number） */
	private pendingTimer: number | null = null;

	/**
	 * 已成功解析并同步过的**真实节点**（**不清空**）。
	 *
	 * 用途：MathJax 字体是**分批**加载的（`document.fonts` 的 `loadingdone` 会
	 * 多次触发）；首批就绪时的测量可能在后续批次变大——内容多的节点尤甚
	 * （实机实测：655px 内容 / 512px 外框）。字体每就绪一批就再同步一次。
	 * （代码块节点也会进入该集合：多一次重测无害，且避免两套并行集合。）
	 */
	private readonly settledNodes = new Set<MindMapNode>();

	/**
	 * 「引擎渲染窗口」内解析失败的 holder（K104）：暂存到
	 * `node_tree_render_end`（root 已回填）重试，不在当时告警。
	 */
	private deferred: Set<HTMLElement> | null = null;
	/** 暂存 holders 只重试一次：仍失败才告警（既防静默退化，也防反复重试） */
	private deferredRetried = false;

	/** 字体就绪监听只装一次（经 `host.register` 随视图卸载摘除） */
	private fontsHookInstalled = false;

	/**
	 * 「定稿 holder 未能解析归属节点」告警留痕（同一会话只提示一次）。
	 * 去重与前缀由 `core/errors.createWarnOnce` 统一实现（2026-10-11 收口）。
	 */
	private readonly warnUnresolved = createWarnOnce();

	constructor(
		private readonly host: ContentRemeasureHost,
		private readonly getFontSet: () => FontSetLike | null = defaultFontSet,
	) {}

	/**
	 * 登记「内容定稿（公式替换 / 代码块高亮）后需重测尺寸」的 holder。
	 *
	 * 背景：引擎的内容测量是**同步**的（构建时按字面占位量高），而 MathJax 替换 /
	 * Prism 高亮都是**异步**的——不重测就会出现「块级公式只占一行高度、内容溢出」
	 * /「代码块按字面尺寸定框、替换后被裁」。定稿后重建该节点内容：此时产物缓存
	 * 已命中（同步放置产物），引擎量到的是**真实宽高**。
	 *
	 * 同帧多段定稿合并为一次批量重排（不变式 ①）；首次调用时惰性装配字体监听。
	 */
	schedule(holder: HTMLElement): void {
		if (!this.pending) {
			this.pending = new Set<HTMLElement>();
			// window 计时器（obsidianmd/prefer-window-timers）：弹窗内视图的批次
			// 随弹窗窗口回收；node 单测由 tests/setup.ts 把 window 桩到 globalThis，
			// 照常被 vi.useFakeTimers() 拦截
			this.pendingTimer = window.setTimeout(() => {
				this.pendingTimer = null;
				const holders = this.pending;
				this.pending = null;
				this.flush(holders ? Array.from(holders) : []);
			}, 0);
		}
		this.pending.add(holder);
		this.installFontsHook();
	}

	/**
	 * 渲染完成后重试「渲染窗口内未解析的 holder」（`node_tree_render_end` 时调用）。
	 *
	 * 此刻 `renderer.root` 已回填，holder 与产物两条解析路径恢复可用；只重试
	 * **一次**——仍失败由 `flush` 告警，避免「重排 → 渲染 → 再重排」的循环。
	 */
	retryDeferred(): void {
		const pending = this.deferred;
		if (!pending || pending.size === 0 || !this.host.getMindMap()) {
			return;
		}
		this.deferred = null;
		this.deferredRetried = true;
		this.flush(Array.from(pending));
	}

	/**
	 * 清空「已同步节点」集合（引擎重建 / 换文件 / 视图关闭时调用）。
	 *
	 * 引擎（重）建后节点对象全部是新实例，旧引用已随上一个引擎销毁而失效——
	 * 不清则 ① 旧节点被长期持有（换文件/设置刷新累积成内存泄漏）；② 字体钩子
	 * 会对**已销毁**的节点调重测（2026-09-28 复核修复）。只清集合、不触发任何
	 * 重排（K88 禁止全树重排的约束不变）。
	 */
	resetNodes(): void {
		this.settledNodes.clear();
	}

	/**
	 * 视图关闭：取消未决批次并清空全部状态（幂等）。
	 *
	 * 未决 flush 在关闭后本会因引擎为 null 静默结束；显式取消让「关闭后有宏任务
	 * 在跑」这件事本身不发生（与 teardown 会话收尾同一纪律）。字体监听的摘除仍走
	 * `host.register`（Component 生命周期，与抽取前一致）。
	 */
	dispose(): void {
		if (this.pendingTimer !== null) {
			window.clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
		}
		this.pending = null;
		this.deferred = null;
		this.deferredRetried = false;
		this.settledNodes.clear();
	}

	/**
	 * 批次执行：holder → 真实 MindMapNode（`resolveNodesByDoms` 批量反查）→ 批量重排。
	 *
	 * 解析失败（holder 已脱离 / 引擎重建中）走两条回退：产物元素反查
	 * （`findNodesByContentProducts`，K100/K104）→ 渲染窗口暂存重试；重试后仍全空
	 * 才**告警一次**——静默跳过会让「尺寸不同步」以无痕方式退化（K85 ① 教训）。
	 */
	private flush(holders: readonly HTMLElement[]): void {
		const mindMap = this.host.getMindMap();
		// 批量窗口（setTimeout）内视图可能已关闭、引擎已销毁：此时既无重测目标，
		// 也不该再走回退并打「未命中」告警（关闭视图时刷误导日志）——静默结束。
		if (!mindMap) {
			return;
		}
		const nodes: MindMapNode[] = [];
		const unresolvedHolders: HTMLElement[] = [];
		// 批量反查：一次遍历建「group → 节点」表 + 逐 holder 沿祖先链查表，取代
		// 逐 holder 全树 walkTree（O(holder 数 × 节点数)）。逐位置对应，故「未命中」
		// 语义与逐个反查完全一致（落空的 holder 仍进 unresolvedHolders，走下面
		// 「产物元素反查 / 延后重试」两条回退）。
		const resolved = resolveNodesByDoms(mindMap, holders);
		for (const [i, holder] of holders.entries()) {
			const node = resolved[i] ?? null;
			if (!node) {
				unresolvedHolders.push(holder);
				continue;
			}
			nodes.push(node);
			this.settledNodes.add(node);
		}
		if (unresolvedHolders.length > 0) {
			// 反查一（K100/K104）：holder 可能已随引擎重渲染脱离（图片回灌 K96 的
			// 补灌触发全树重建），改按**产物元素**反查——选择器三通道覆盖我方数学
			// holder 类、CHTML 容器与**代码块高亮 holder**（2026-10-07 审查修复：
			// 此前缺代码块通道，且兜底「捞到别的数学节点」会让本批代码块静默跳过、
			// 不重测也不告警）。⚠ 兜底是**过包含**的（返回全部产物所在节点）⇒ 若
			// 本批 holder 彻底消失且其产物也不在活 DOM 里，仍会被静默跳过
			//（K100 既有边界，未改设计）。
			// 去重改用 Set：nodes 随循环增长，`includes` 会让本轮退化为 O(n²)
			const seen = new Set(nodes);
			for (const node of findNodesByContentProducts(mindMap)) {
				if (seen.has(node)) {
					continue;
				}
				seen.add(node);
				nodes.push(node);
				this.settledNodes.add(node);
			}
			if (nodes.length === 0) {
				if (!this.deferredRetried) {
					// 全部落空且尚未重试：**大概率是引擎渲染窗口**——`Renderer._render`
					// 期间 `renderer.root` 为 null（K67），两条解析路径必然全空。
					// 暂存 holders，等 node_tree_render_end（root 回填）重试，不告警。
					this.deferred = new Set(unresolvedHolders);
					return;
				}
				// 重试后仍全空：真的定位不到 → 告警一次（静默跳过会让问题无痕退化）
				this.warnUnresolved(
					'自绘内容节点（公式/代码块）尺寸同步未能定位归属节点，内容可能被裁剪',
				);
			}
		}
		// 本轮有命中（或无需重试）：清暂存与重试标记
		this.deferred = null;
		this.deferredRetried = false;
		if (nodes.length > 0) {
			refreshNodesCustomContent(mindMap, nodes);
		}
	}

	/**
	 * 字体每就绪一批就把已同步的数学节点**再同步一次**：字体数据到位后同一
	 * TeX 的产物会更高（多行内容尤甚），首批测量可能偏小。
	 */
	private remeasureSettled(): void {
		const nodes = Array.from(this.settledNodes);
		if (nodes.length > 0) {
			refreshNodesCustomContent(this.host.getMindMap(), nodes);
		}
	}

	/** 一次性装配字体就绪监听（`loadingdone` 会随字体分批多次触发） */
	private installFontsHook(): void {
		if (this.fontsHookInstalled) {
			return;
		}
		this.fontsHookInstalled = true;
		const fonts = this.getFontSet();
		if (!fonts?.addEventListener) {
			return;
		}
		const onFontsLoaded = (): void => this.remeasureSettled();
		fonts.addEventListener('loadingdone', onFontsLoaded);
		this.host.register(() => {
			fonts.removeEventListener?.('loadingdone', onFontsLoaded);
		});
	}
}
